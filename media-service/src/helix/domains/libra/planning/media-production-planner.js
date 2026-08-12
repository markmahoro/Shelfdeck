'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { executionCatalogDigest } = require('../../../foundation/execution/workflow-plan');
const {
  buildMediaRequirement,
  buildEncodeIntent,
  buildProductMediaCandidateInput,
  buildProductOutputSelectionInput,
  buildProductionSourceScopeReference,
  buildRemuxIntent,
  deriveRetryTargetVideoBitrate,
  deriveTargetSizeBudget,
  buildWorkspaceMediaOutputTarget,
  LIBRA_MEDIA_PLANNING_POLICY,
} = require('../model/media-production-contracts');
const {
  directMediaSelectionWork,
  remuxMediaSelectionWork,
  sourceMediaObservationWork,
  transcodeMediaSelectionWork,
} = require('./media-production-work');
const { createProductionSourceScopeResolver } = require('./production-source-scope-resolver');
const { workspaceId } = require('../model/workspace-admission-contracts');

const PROBE = 'shared.material.media.probe@1';
const VERIFY = 'libra.product_media.verify@1';
const SELECT = 'libra.product_output.select@1';
const REMUX = 'libra.media.remux@1';
const TRANSCODE_INPUT_VERIFY = 'libra.transcode.input.verify@1';
const TRANSCODE = 'libra.media.transcode@1';
const SOURCE_HANDLE = 'helix://libra/input-projections/ProductionSourcePrimaryReadHandle/v1';
const DIRECT_CANDIDATE = 'helix://libra/input-projections/DirectProductMediaCandidateInput/v1';
const OUTPUT_SELECTION = 'helix://libra/input-projections/ProductOutputSelectionInput/v1';
const SOURCE_SCOPE = 'helix://libra/input-projections/ProductionSourceScopeReference/v1';
const REMUX_INTENT = 'helix://libra/input-projections/RemuxIntent/v1';
const REMUX_OUTPUT_TARGET = 'helix://libra/input-projections/RemuxWorkspaceMediaOutputTarget/v1';
const WORKSPACE_HANDLE = 'helix://libra/input-projections/WorkspaceMaterialHandleFromMediaOutput/v1';
const WORKSPACE_CANDIDATE = 'helix://libra/input-projections/WorkspaceProductMediaCandidateInput/v1';

function stable(prefix, value) { return prefix + canonicalDigest(value).slice(0, 40); }
function literal(portName,value){return Object.freeze({portName,bindingKind:'literal',value});}
function bindings(values) { return Object.freeze({ schemaRef:'helix://foundation/types/EventInputBindingSet/v1', schemaVersion:1,
  bindings:Object.freeze(values) }); }
function demand(resourceKinds) { const value={resourceKinds:Object.freeze(resourceKinds)};
  return Object.freeze({...value,demandDigest:canonicalDigest(value)}); }
function owner(portName,request,projectionRef,parameters={}) { return Object.freeze({portName,bindingKind:'projected_owner_facts',
  ownerDomain:request.ownerDomain,processType:request.processType,processId:request.processId,projectionRef,
  parameters:Object.freeze(parameters)}); }
function projected(portName,eventId,resultSchemaRef,projectionRef,parameters={}) { return Object.freeze({portName,
  bindingKind:'projected_event_result',eventId,resultSchemaRef,projectionRef,parameters:Object.freeze(parameters)}); }
function eventResult(portName,eventId,resultSchemaRef) { return Object.freeze({portName,
  bindingKind:'event_result',eventId,resultSchemaRef}); }
function projectedResults(portName,eventResults,projectionRef,parameters={}) { return Object.freeze({portName,
  bindingKind:'projected_event_results',eventResults:Object.freeze(eventResults),projectionRef,parameters:Object.freeze(parameters)}); }

function planNode(options) {
  const manifest=options.registry.resolve(options.capabilityRef,'libra').manifest;
  const policy=options.policyRegistry.bindingFor(options.capabilityRef,manifest.effectClass);
  const fence={basisDigest:options.request.executionBasisDigest,inputSetDigest:canonicalDigest(options.inputBindings),
    eventFenceDigest:canonicalDigest({schema:'libra.media-production-event-fence@1',eventId:options.eventId,
      workId:options.request.workId}),effectScopeDigest:canonicalDigest({schema:'libra.media-production-event-scope@1',
      eventId:options.eventId,libraRunId:options.request.processId,capabilityRef:options.capabilityRef})};
  return Object.freeze({nodeId:options.nodeId,eventId:options.eventId,capabilityRef:options.capabilityRef,contractVersion:1,
    inputBindingsSchemaRef:manifest.parametersSchemaRef.replace(/\/parameters$/,'/inputs'),inputBindings:bindings(options.inputBindings),
    parametersSchemaRef:manifest.parametersSchemaRef,parameters:Object.freeze({}),dependsOn:Object.freeze(options.dependsOn||[]),
    whenSchemaRef:null,when:null,effectClass:manifest.effectClass,resourceDemandSchemaRef:manifest.resourceDemandSchemaRef,
    resourceDemand:demand(options.resourceKinds),approvalRequirementRef:null,authorizationRequirementRef:null,
    fenceSchemaRef:manifest.fenceSchemaRef,fenceBasis:Object.freeze(fence),retryPolicyRef:policy.retryPolicyRef,
    timeoutPolicyRef:policy.timeoutPolicyRef,outputContractRef:manifest.resultSchemaRef});
}

function planEnvelope(options, request, work, nodes, resolution='planned', diagnosticClassification=null) {
  return Object.freeze({schemaRef:'helix://foundation/types/WorkflowPlanDefinition/v1',schemaVersion:1,
    planId:stable('libra-workspace-media-plan-',{workId:request.workId,attempt:request.workAttemptId}),
    workAttemptId:request.workAttemptId,ownerDomain:'libra',plannerContractRef:options.plannerContractRef,
    plannerVersion:1,workObjectiveTypeRef:work.workObjectiveTypeRef,workObjectiveVersion:1,
    executionBasisDigest:request.executionBasisDigest,capabilityCatalogDigest:options.catalogDigest,resolution,
    diagnosticClassification,nodes:Object.freeze(nodes)});
}

function transcodeOrdinal(workId) {
  const match=/^libra-workspace-media-transcode_(\d+)_selection-work-/.exec(workId);
  return match ? Number(match[1]) : null;
}

function literalInput(item, portName) {
  return item?.inputBindings?.bindings?.find((binding)=>binding.portName===portName&&binding.bindingKind==='literal')?.value||null;
}

function priorTranscodeExecutions(options,snapshot,ordinal) {
  const items=[];
  for(let current=1;current<ordinal;current+=1){
    const work=transcodeMediaSelectionWork(snapshot,current),results=options.workResultReader.read(work.workId);
    const execution=results.find((item)=>item.capabilityRef===TRANSCODE);
    if(!execution)throw new Error('Prior Transcode Work has no immutable execution Plan.');
    const intent=literalInput(execution,'encodeIntent'),device=literalInput(execution,'mediaExecutionDeviceSnapshot');
    if(!intent||!device)throw new Error('Prior Transcode Plan does not freeze its Intent and Device Snapshot.');
    items.push(Object.freeze({work,results,intent,device,key:device.deviceId+'\0'+device.probeRevision+'\0'+intent.video.rateControlMode}));
  }
  return Object.freeze(items);
}

function readyDeviceStrategies(options,requirement,attempted) {
  if(!options.platformComputeRuntime||typeof options.platformComputeRuntime.listReadyDeviceRefs!=='function'||
      typeof options.platformComputeRuntime.readDeviceSnapshot!=='function')return Object.freeze([]);
  const listQuery={queryContract:'platform.compute-ready-device-refs@1',limit:64};listQuery.queryDigest=canonicalDigest(listQuery);
  const listed=options.platformComputeRuntime.listReadyDeviceRefs(listQuery);
  if(listed.resultKind!=='available')return Object.freeze([]);
  const snapshots=listed.items.map((ref)=>{
    const query={deviceId:ref.deviceId,expectedProbeRevision:ref.probeRevision,expectedCapabilityDigest:ref.capabilityDigest};
    query.queryDigest=canonicalDigest(query);const result=options.platformComputeRuntime.readDeviceSnapshot(query);
    if(result.resultKind!=='found')return null;
    return result.snapshot;
  }).filter(Boolean);
  const order=new Map([...LIBRA_MEDIA_PLANNING_POLICY.ordinaryDeviceOrder,'software_cpu'].map((kind,index)=>[kind,index]));
  snapshots.sort((left,right)=>(order.get(left.deviceClass)??999)-(order.get(right.deviceClass)??999)||
    Buffer.from(left.deviceId).compare(Buffer.from(right.deviceId)));
  const hasSizeLimit=requirement.space.maxSizeBytes!==null,strategies=[];
  for(const device of snapshots){
    if(device.deviceClass==='remote_worker')continue;
    if(!(device.capabilityPayload.supportedVideoCodecs||[]).includes('hevc'))continue;
    const supported=device.capabilityPayload.supportedRateControlModes||[];
    const modes=device.deviceClass==='software_cpu'
      ?(hasSizeLimit?['two_pass_abr','strict_abr']:['quality_bound'])
      :(hasSizeLimit?['target_size','strict_abr']:['quality_bound']);
    for(const mode of modes){const key=device.deviceId+'\0'+device.probeRevision+'\0'+mode;
      if(supported.includes(mode)&&!attempted.has(key))strategies.push(Object.freeze({device,mode,key}));}
  }
  return Object.freeze(strategies);
}

function transcodeSource(options,snapshot) {
  const sourceScopeResolver=createProductionSourceScopeResolver({movieProductionReader:options.movieProductionReader,
    productionPort:options.productProductionPort});
  const original=sourceScopeResolver.resolve(sourceScopeResolver.referenceFor(snapshot)),sourceWork=sourceMediaObservationWork(snapshot);
  const sourceResults=options.workResultReader.read(sourceWork.workId).filter((item)=>item.outcomeKind==='succeeded'&&item.capabilityRef===PROBE);
  if(sourceResults.length!==1)throw new Error('Transcode planning requires one source Probe Result.');
  if(snapshot.materialInputForm==='stream_file')return Object.freeze({handle:original.primaryReadHandle,
    inputProbe:sourceResults[0].result,originalProbe:sourceResults[0].result});
  const remuxWork=remuxMediaSelectionWork(snapshot),remuxResults=options.workResultReader.read(remuxWork.workId);
  const media=remuxResults.find((item)=>item.outcomeKind==='succeeded'&&item.capabilityRef===REMUX)?.result;
  const probe=remuxResults.find((item)=>item.outcomeKind==='succeeded'&&item.capabilityRef===PROBE)?.result;
  if(!media||!probe)throw new Error('Container Transcode planning requires durable Remux media and Probe Results.');
  return Object.freeze({handle:media.workspaceMaterialHandle,inputProbe:probe,originalProbe:sourceResults[0].result});
}

function transcodePlanning(options,snapshot,ordinal) {
  const source=transcodeSource(options,snapshot),requirement=buildMediaRequirement(snapshot.spec),prior=priorTranscodeExecutions(options,snapshot,ordinal);
  const attempted=new Set(prior.map((item)=>item.key)),strategy=readyDeviceStrategies(options,requirement,attempted)[0]||null;
  if(!strategy)return prior.length
    ?Object.freeze({kind:'contract_unplannable',diagnosticClassification:'media_device_strategies_exhausted'})
    :Object.freeze({kind:'temporarily_unplannable',diagnosticClassification:'media_device_strategies_unavailable'});
  const budget=requirement.space.maxSizeBytes===null?null:deriveTargetSizeBudget({maxSizeBytes:requirement.space.maxSizeBytes,
    durationMs:source.inputProbe.durationMs,audioStreams:source.inputProbe.audioStreams,subtitleStreams:source.inputProbe.subtitleStreams});
  if(budget&&!budget.feasible)return Object.freeze({kind:'contract_unplannable',diagnosticClassification:'media_size_budget_infeasible'});
  const previous=prior.at(-1)||null,previousVerification=previous?.results.find((item)=>item.capabilityRef===VERIFY)?.result||null;
  let targetVideoBitrateBps=budget?.targetVideoBitrateBps||null;
  if(previous&&previousVerification?.reasonCodes?.includes('max_size_exceeded')&&previous.intent.video.targetVideoBitrateBps){
    targetVideoBitrateBps=deriveRetryTargetVideoBitrate({previousTargetVideoBitrateBps:previous.intent.video.targetVideoBitrateBps,
      maxSizeBytes:requirement.space.maxSizeBytes,actualSizeBytes:previousVerification.spaceSummary.actualSizeBytes});
  }
  const intent=buildEncodeIntent({revision:1,libraRunId:snapshot.run.libraRunId,sourceHandleDigest:canonicalDigest(source.handle),
    mediaRequirementDigest:requirement.requirementDigest,strategyOrdinal:ordinal,rateControlMode:strategy.mode,
    ...(strategy.mode==='quality_bound'?{qualityBound:23}:{targetVideoBitrateBps}),deviceClass:strategy.device.deviceClass,
    ...(previous?{previousIntentDigest:previous.intent.intentDigest}:{})});
  const workspace=options.movieProductionReader.readWorkspace(workspaceId(snapshot.run.libraRunId));
  if(!workspace||workspace.state!=='active')throw new Error('Active Libra Workspace is unavailable for Transcode planning.');
  const root=options.workspaceProductPort.rootSnapshot(),target=buildWorkspaceMediaOutputTarget({libraRunId:snapshot.run.libraRunId,
    executionBasisDigest:snapshot.run.executionBasisDigest,workspaceId:workspace.workspaceId,
    expectedWorkspaceRevision:workspace.currentRevision,expectedWorkspaceStateDigest:workspace.stateDigest,rootSnapshot:root,
    workspaceScopeDigest:workspace.workspaceScopeDigest,targetRelativePath:'media/transcode-'+ordinal+'-'+intent.intentId.slice(0,16)+'.mkv',
    productionIntentDigest:intent.intentDigest});
  return Object.freeze({kind:'ready',source,requirement,intent,device:strategy.device,target});
}

function createWorkspaceMediaProductionPlanner(options) {
  const catalogDigest=executionCatalogDigest(options.registry,options.policyRegistry);
  const plannerContractRef='helix://libra/planners/WorkspaceMediaProduction/v1';
  return Object.freeze({plannerContractRef,plannerVersion:1,plan(request) {
    const snapshot=options.movieProductionReader.readRunSnapshot(request.processId);
    if(snapshot.run.executionBasisDigest!==request.executionBasisDigest)throw new Error('Workspace Media planning basis changed.');
    const sourceWork=sourceMediaObservationWork(snapshot),directWork=directMediaSelectionWork(snapshot),remuxWork=remuxMediaSelectionWork(snapshot);
    if(request.workId===sourceWork.workId){
      const eventId=stable('libra-source-media-probe-event-',{attempt:request.workAttemptId});
      const node=planNode({...options,request,nodeId:'source_media_probe',eventId,capabilityRef:PROBE,
        inputBindings:[owner('physicalMaterialReadHandleOrWorkspaceMaterialHandle',request,SOURCE_HANDLE)],
        resourceKinds:['cpu','disk_io']});
      return planEnvelope({plannerContractRef,catalogDigest},request,sourceWork,[node]);
    }
    if(request.workId===directWork.workId){
      if(snapshot.materialInputForm!=='stream_file')throw new Error('Direct media selection only accepts stream-file input.');
      const verifyEventId=stable('libra-direct-media-verify-event-',{attempt:request.workAttemptId});
      const selectEventId=stable('libra-direct-media-select-event-',{attempt:request.workAttemptId});
      const verify=planNode({...options,request,nodeId:'direct_media_verification',eventId:verifyEventId,capabilityRef:VERIFY,
        inputBindings:[owner('productMediaCandidateInput',request,DIRECT_CANDIDATE,{sourceWorkId:sourceWork.workId})],
        resourceKinds:['cpu','disk_io']});
      const select=planNode({...options,request,nodeId:'direct_output_selection',eventId:selectEventId,capabilityRef:SELECT,
        inputBindings:[projected('productOutputSelectionInput',verifyEventId,
          options.registry.resolve(VERIFY,'libra').manifest.resultSchemaRef,OUTPUT_SELECTION)],
        dependsOn:[{eventId:verifyEventId,satisfaction:'success'}],resourceKinds:['cpu']});
      return planEnvelope({plannerContractRef,catalogDigest},request,directWork,[verify,select]);
    }
    if(request.workId===remuxWork.workId){
      const remuxEventId=stable('libra-remux-media-event-',{attempt:request.workAttemptId});
      const probeEventId=stable('libra-remux-output-probe-event-',{attempt:request.workAttemptId});
      const verifyEventId=stable('libra-remux-output-verify-event-',{attempt:request.workAttemptId});
      const selectEventId=stable('libra-remux-output-select-event-',{attempt:request.workAttemptId});
      const remux=planNode({...options,request,nodeId:'remux_media',eventId:remuxEventId,capabilityRef:REMUX,
        inputBindings:[owner('productionSourceScopeReference',request,SOURCE_SCOPE),owner('remuxIntent',request,REMUX_INTENT),
          owner('workspaceMediaOutputTarget',request,REMUX_OUTPUT_TARGET)],resourceKinds:['compute_device','cpu','disk_io']});
      const outputProbe=planNode({...options,request,nodeId:'remux_output_probe',eventId:probeEventId,capabilityRef:PROBE,
        inputBindings:[projected('physicalMaterialReadHandleOrWorkspaceMaterialHandle',remuxEventId,
          options.registry.resolve(REMUX,'libra').manifest.resultSchemaRef,WORKSPACE_HANDLE)],
        dependsOn:[{eventId:remuxEventId,satisfaction:'success'}],resourceKinds:['cpu','disk_io']});
      const verification=planNode({...options,request,nodeId:'remux_output_verification',eventId:verifyEventId,capabilityRef:VERIFY,
        inputBindings:[projectedResults('productMediaCandidateInput',[
          {eventId:remuxEventId,resultSchemaRef:options.registry.resolve(REMUX,'libra').manifest.resultSchemaRef},
          {eventId:probeEventId,resultSchemaRef:options.registry.resolve(PROBE,'libra').manifest.resultSchemaRef},
        ],WORKSPACE_CANDIDATE,{sourceWorkId:sourceWork.workId,candidateNodeId:'remux_output'})],
        dependsOn:[{eventId:remuxEventId,satisfaction:'success'},{eventId:probeEventId,satisfaction:'success'}],
        resourceKinds:['cpu','disk_io']});
      const select=planNode({...options,request,nodeId:'remux_output_selection',eventId:selectEventId,capabilityRef:SELECT,
        inputBindings:[projected('productOutputSelectionInput',verifyEventId,
          options.registry.resolve(VERIFY,'libra').manifest.resultSchemaRef,OUTPUT_SELECTION)],
        dependsOn:[{eventId:verifyEventId,satisfaction:'success'}],resourceKinds:['cpu']});
      return planEnvelope({plannerContractRef,catalogDigest},request,remuxWork,[remux,outputProbe,verification,select]);
    }
    const ordinal=transcodeOrdinal(request.workId);
    if(ordinal!==null){
      const transcodeWork=transcodeMediaSelectionWork(snapshot,ordinal);
      if(request.workId!==transcodeWork.workId)throw new Error('Transcode Work identity does not match its strategy ordinal.');
      const planning=transcodePlanning(options,snapshot,ordinal);
      if(planning.kind!=='ready')return planEnvelope({plannerContractRef,catalogDigest},request,transcodeWork,[],planning.kind,
        planning.diagnosticClassification);
      const inputVerifyEventId=stable('libra-transcode-input-verify-event-',{attempt:request.workAttemptId});
      const transcodeEventId=stable('libra-transcode-media-event-',{attempt:request.workAttemptId});
      const probeEventId=stable('libra-transcode-output-probe-event-',{attempt:request.workAttemptId});
      const verifyEventId=stable('libra-transcode-output-verify-event-',{attempt:request.workAttemptId});
      const selectEventId=stable('libra-transcode-output-select-event-',{attempt:request.workAttemptId});
      const inputVerify=planNode({...options,request,nodeId:'transcode_input_verification',eventId:inputVerifyEventId,
        capabilityRef:TRANSCODE_INPUT_VERIFY,inputBindings:[literal('physicalMaterialReadHandleOrWorkspaceMaterialHandle',planning.source.handle),
          literal('mediaProbeEvidence',planning.source.inputProbe),literal('encodeIntent',planning.intent),
          literal('mediaExecutionDeviceSnapshot',planning.device)],resourceKinds:['compute_device','cpu','disk_io']});
      const transcode=planNode({...options,request,nodeId:'transcode_media',eventId:transcodeEventId,capabilityRef:TRANSCODE,
        inputBindings:[literal('materialHandle',planning.source.handle),literal('encodeIntent',planning.intent),
          literal('mediaExecutionDeviceSnapshot',planning.device),eventResult('transcodeInputVerification',inputVerifyEventId,
            options.registry.resolve(TRANSCODE_INPUT_VERIFY,'libra').manifest.resultSchemaRef),
          literal('workspaceMediaOutputTarget',planning.target)],
        dependsOn:[{eventId:inputVerifyEventId,satisfaction:'success'}],resourceKinds:['compute_device','cpu','disk_io']});
      const outputProbe=planNode({...options,request,nodeId:'transcode_output_probe',eventId:probeEventId,capabilityRef:PROBE,
        inputBindings:[projected('physicalMaterialReadHandleOrWorkspaceMaterialHandle',transcodeEventId,
          options.registry.resolve(TRANSCODE,'libra').manifest.resultSchemaRef,WORKSPACE_HANDLE)],
        dependsOn:[{eventId:transcodeEventId,satisfaction:'success'}],resourceKinds:['cpu','disk_io']});
      const verification=planNode({...options,request,nodeId:'transcode_output_verification',eventId:verifyEventId,capabilityRef:VERIFY,
        inputBindings:[projectedResults('productMediaCandidateInput',[
          {eventId:transcodeEventId,resultSchemaRef:options.registry.resolve(TRANSCODE,'libra').manifest.resultSchemaRef},
          {eventId:probeEventId,resultSchemaRef:options.registry.resolve(PROBE,'libra').manifest.resultSchemaRef},
        ],WORKSPACE_CANDIDATE,{sourceWorkId:sourceWork.workId,candidateNodeId:'transcode_output_'+ordinal})],
        dependsOn:[{eventId:transcodeEventId,satisfaction:'success'},{eventId:probeEventId,satisfaction:'success'}],
        resourceKinds:['cpu','disk_io']});
      const select=planNode({...options,request,nodeId:'transcode_output_selection',eventId:selectEventId,capabilityRef:SELECT,
        inputBindings:[projected('productOutputSelectionInput',verifyEventId,
          options.registry.resolve(VERIFY,'libra').manifest.resultSchemaRef,OUTPUT_SELECTION)],
        dependsOn:[{eventId:verifyEventId,satisfaction:'success'}],resourceKinds:['cpu']});
      return planEnvelope({plannerContractRef,catalogDigest},request,transcodeWork,[inputVerify,transcode,outputProbe,verification,select]);
    }
    throw new Error('Workspace Media Work stage is not recognized by its exact immutable definition.');
  }});
}

function createWorkspaceMediaProductionProjections(options) {
  const sourceScopeResolver=createProductionSourceScopeResolver({movieProductionReader:options.movieProductionReader,
    productionPort:options.productProductionPort});
  function snapshot(ownerScope){return options.movieProductionReader.readRunSnapshot(ownerScope.processId);}
  function source(snapshotValue){return sourceScopeResolver.resolve(sourceScopeResolver.referenceFor(snapshotValue));}
  function sourceProbe(snapshotValue,sourceWorkId){
    const results=options.workResultReader.read(sourceWorkId).filter((item)=>item.outcomeKind==='succeeded'&&item.capabilityRef===PROBE);
    if(results.length!==1)throw new Error('Workspace Media source Observation is absent or ambiguous.');
    return results[0].result;
  }
  function sourceReference(snapshotValue){
    const reference=sourceScopeResolver.referenceFor(snapshotValue);
    return buildProductionSourceScopeReference(reference);
  }
  function remuxIntent(snapshotValue){
    const reference=sourceReference(snapshotValue),requirement=buildMediaRequirement(snapshotValue.spec);
    return buildRemuxIntent({revision:1,libraRunId:snapshotValue.run.libraRunId,
      sourceHandleDigest:reference.sourceReferenceDigest,mediaRequirementDigest:requirement.requirementDigest});
  }
  function remuxTarget(snapshotValue){
    const workspace=options.movieProductionReader.readWorkspace(workspaceId(snapshotValue.run.libraRunId));
    if(!workspace||workspace.state!=='active')throw new Error('Active Libra Workspace is unavailable for Remux planning.');
    const intent=remuxIntent(snapshotValue),root=options.workspaceProductPort.rootSnapshot();
    return buildWorkspaceMediaOutputTarget({libraRunId:snapshotValue.run.libraRunId,
      executionBasisDigest:snapshotValue.run.executionBasisDigest,workspaceId:workspace.workspaceId,
      expectedWorkspaceRevision:workspace.currentRevision,expectedWorkspaceStateDigest:workspace.stateDigest,
      rootSnapshot:root,workspaceScopeDigest:workspace.workspaceScopeDigest,
      targetRelativePath:'media/remux-' + snapshotValue.run.libraRunId + '.mkv',productionIntentDigest:intent.intentDigest});
  }
  return Object.freeze([
    Object.freeze({projectionRef:SOURCE_HANDLE,projection:Object.freeze({project:({ownerScope})=>source(snapshot(ownerScope)).primaryReadHandle})}),
    Object.freeze({projectionRef:DIRECT_CANDIDATE,projection:Object.freeze({project:({ownerScope,parameters})=>{
      const value=snapshot(ownerScope),handle=source(value).primaryReadHandle,probe=sourceProbe(value,parameters.sourceWorkId);
      return buildProductMediaCandidateInput({libraRunId:value.run.libraRunId,candidateNodeId:'direct_input',candidateKind:'direct_input',
        mediaRequirement:buildMediaRequirement(value.spec),sourceMaterialHandle:handle,sourceProbeEvidence:probe});
    }})}),
    Object.freeze({projectionRef:SOURCE_SCOPE,projection:Object.freeze({project:({ownerScope})=>sourceReference(snapshot(ownerScope))})}),
    Object.freeze({projectionRef:REMUX_INTENT,projection:Object.freeze({project:({ownerScope})=>remuxIntent(snapshot(ownerScope))})}),
    Object.freeze({projectionRef:REMUX_OUTPUT_TARGET,projection:Object.freeze({project:({ownerScope})=>remuxTarget(snapshot(ownerScope))})}),
    Object.freeze({projectionRef:WORKSPACE_HANDLE,projection:Object.freeze({project:({sourceResult})=>sourceResult.workspaceMaterialHandle})}),
    Object.freeze({projectionRef:WORKSPACE_CANDIDATE,projection:Object.freeze({project:({sourceResults,parameters})=>{
      const media=sourceResults.find((item)=>item.result?.workspaceMediaHandleId)?.result;
      const outputProbe=sourceResults.find((item)=>item.result?.schemaRef==='helix://contracts/types/MediaProbeEvidence/v1')?.result;
      if(!media||!outputProbe)throw new Error('Workspace media Candidate requires durable media and Probe Results.');
      const value=options.movieProductionReader.readRunSnapshot(media.workspaceMaterialHandle.processId),probe=sourceProbe(value,parameters.sourceWorkId);
      return buildProductMediaCandidateInput({libraRunId:value.run.libraRunId,candidateNodeId:parameters.candidateNodeId,
        candidateKind:'workspace_output',mediaRequirement:buildMediaRequirement(value.spec),workspaceMediaHandle:media,
        sourceProbeEvidence:probe,outputProbeEvidence:outputProbe});
    }})}),
    Object.freeze({projectionRef:OUTPUT_SELECTION,projection:Object.freeze({project:({sourceResult,parameters,sourceEventId,targetEventId})=>{
      void parameters;void sourceEventId;void targetEventId;
      const value=options.movieProductionReader.readRunSnapshot(sourceResult.libraRunId);
      const candidate={rank:1,candidateId:sourceResult.candidateId,candidateNodeId:sourceResult.candidateNodeId};
      return buildProductOutputSelectionInput({libraRunId:value.run.libraRunId,acceptanceSpecId:value.spec.acceptanceSpecId,
        acceptanceSpecRecordDigest:value.spec.recordDigest,mediaRequirementDigest:sourceResult.mediaRequirementDigest,
        rankedCandidates:[candidate],candidates:[sourceResult]});
    }})}),
  ]);
}

module.exports=Object.freeze({DIRECT_CANDIDATE,OUTPUT_SELECTION,SOURCE_HANDLE,SOURCE_SCOPE,REMUX_INTENT,REMUX_OUTPUT_TARGET,
  WORKSPACE_HANDLE,WORKSPACE_CANDIDATE,
  createWorkspaceMediaProductionPlanner,createWorkspaceMediaProductionProjections});
