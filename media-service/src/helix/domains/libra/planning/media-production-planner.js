'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { executionCatalogDigest } = require('../../../foundation/execution/workflow-plan');
const {
  buildMediaRequirement,
  buildEncodeIntent,
  buildProductMediaCandidateInput,
  buildPlannedProductCandidateReference,
  buildProductOutputSelectionInput,
  buildProductionSourceScopeReference,
  buildRemuxIntent,
  deriveRetryTargetVideoBitrate,
  deriveTargetSizeBudget,
  selectCopyAudioStreamsForSizeBudget,
  rasterClass,
  buildWorkspaceMediaOutputTarget,
  LIBRA_MEDIA_PLANNING_POLICY,
} = require('../model/media-production-contracts');
const {
  directMediaSelectionWork,
  remuxMediaSelectionWork,
  sourceMediaObservationWork,
  transcodeStrategyAssessmentWork,
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

function selectionBinding(options, verificationEvents, rankedCandidates) {
  return projectedResults('productOutputSelectionInput', verificationEvents.map((eventId) => Object.freeze({
    eventId,
    resultSchemaRef: options.registry.resolve(VERIFY, 'libra').manifest.resultSchemaRef,
  })), OUTPUT_SELECTION, { rankedCandidates:Object.freeze(rankedCandidates) });
}

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

function transcodeWorkIdentity(workId) {
  const match=/^libra-workspace-media-transcode_(\d+)_(assessment|selection)-work-/.exec(workId);
  return match ? Object.freeze({ordinal:Number(match[1]),kind:match[2]}) : null;
}

function literalInput(item, portName) {
  return item?.inputBindings?.bindings?.find((binding)=>binding.portName===portName&&binding.bindingKind==='literal')?.value||null;
}

function priorTranscodeAssessments(options,snapshot,ordinal) {
  const items=[];
  for(let current=1;current<ordinal;current+=1){
    const work=transcodeStrategyAssessmentWork(snapshot,current),results=options.workResultReader.read(work.workId);
    const execution=results.find((item)=>item.capabilityRef===TRANSCODE_INPUT_VERIFY);
    if(!execution)throw new Error('Prior Transcode Assessment has no immutable Compatibility Result.');
    const intent=literalInput(execution,'encodeIntent'),device=literalInput(execution,'mediaExecutionDeviceSnapshot');
    if(!intent||!device||!execution.result)throw new Error('Prior Assessment does not freeze its Intent, Device, and Result.');
    items.push(Object.freeze({work,results,intent,device,verification:execution.result,
      key:device.deviceId+'\0'+device.probeRevision+'\0'+intent.video.pipelineProfileId+'\0'+intent.video.rateControlMode}));
  }
  return Object.freeze(items);
}

function readyDeviceStrategies(options,requirement,attempted,pipelineProfileId) {
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
    for(const mode of modes){const key=device.deviceId+'\0'+device.probeRevision+'\0'+pipelineProfileId+'\0'+mode;
      if(supported.includes(mode)&&!attempted.has(key))strategies.push(Object.freeze({device,mode,key,pipelineProfileId}));}
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
  const source=transcodeSource(options,snapshot),requirement=buildMediaRequirement(snapshot.spec),prior=priorTranscodeAssessments(options,snapshot,ordinal),
    primary=(source.inputProbe.videoStreams||[]).filter((item)=>item.dispositionDefault===true),streams=primary.length?primary:(source.inputProbe.videoStreams||[]).slice(0,1),
    hasDolbyVision=streams.some((item)=>item.dynamicRangeKind==='dolby_vision'),pipelineProfileId=hasDolbyVision
      ?'pq_bt2020_base_to_sdr_bt709_hevc@1':'ordinary_to_hevc@1';
  const attempted=new Set(prior.flatMap((item)=>item.verification.coveredStrategyKeys||[item.key])),
    strategy=readyDeviceStrategies(options,requirement,attempted,pipelineProfileId)[0]||null;
  if(!strategy)return prior.length
    ?Object.freeze({kind:'contract_unplannable',diagnosticClassification:'media_device_strategies_exhausted'})
    :Object.freeze({kind:'temporarily_unplannable',diagnosticClassification:'media_device_strategies_unavailable'});
  const audioStreams=source.inputProbe.audioStreams||[];
  const displayRaster=rasterClass(source.inputProbe);
  const selectedAudio=requirement.space.maxSizeBytes===null
    ?Object.freeze({audioStreams,budget:null,feasible:true})
    :selectCopyAudioStreamsForSizeBudget({maxSizeBytes:requirement.space.maxSizeBytes,durationMs:source.inputProbe.durationMs,
      audioStreams,subtitleStreams:source.inputProbe.subtitleStreams,
      acceptedPrimaryAudioClasses:requirement.mandatoryMedia.acceptedPrimaryAudioClasses,
      rasterClass:displayRaster,
      ...(Number.isSafeInteger(source.inputProbe.sizeBytes)&&source.inputProbe.sizeBytes>0?{sourceSizeBytes:source.inputProbe.sizeBytes}:{})});
  const budget=selectedAudio.budget;
  const sizeWaived=Array.isArray(snapshot.run.authorizedDefectManifest?.waivedRequirementCodes)
    && snapshot.run.authorizedDefectManifest.waivedRequirementCodes.includes('max_size_exceeded');
  const previous=prior.at(-1)||null,previousSelection=previous?options.workResultReader.read(
    transcodeMediaSelectionWork(snapshot,ordinal-1).workId):[],previousVerification=previousSelection.find((item)=>item.capabilityRef===VERIFY)?.result||null;
  let targetVideoBitrateBps=budget?.targetVideoBitrateBps||null;
  if(previous&&previousVerification?.reasonCodes?.includes('max_size_exceeded')&&previous.intent.video.targetVideoBitrateBps){
    const retried=deriveRetryTargetVideoBitrate({previousTargetVideoBitrateBps:previous.intent.video.targetVideoBitrateBps,
      maxSizeBytes:requirement.space.maxSizeBytes,actualSizeBytes:previousVerification.spaceSummary.actualSizeBytes});
    const floorBps=budget?.videoBitrateFloorBps||0;
    targetVideoBitrateBps=sizeWaived&&retried<floorBps?floorBps:retried;
  }
  const intent=buildEncodeIntent({revision:1,libraRunId:snapshot.run.libraRunId,sourceHandleDigest:canonicalDigest(source.handle),
    mediaRequirementDigest:requirement.requirementDigest,strategyOrdinal:ordinal,rateControlMode:strategy.mode,
    ...(strategy.mode==='quality_bound'?{qualityBound:23}:{targetVideoBitrateBps}),deviceClass:strategy.device.deviceClass,
    dynamicRangeOperation:hasDolbyVision?'tone_map_to_sdr_bt709':'preserve',pipelineProfileId,
    outputDynamicRangeKind:hasDolbyVision?'sdr':(streams[0]?.dynamicRangeKind||'unknown'),
    outputPixelFormat:hasDolbyVision?'yuv420p':(streams[0]?.pixelFormat||'encoder_selected'),
    outputColorProfile:hasDolbyVision?{range:'limited',primaries:'bt709',transfer:'bt709',matrix:'bt709'}:
      {range:'source',primaries:'source',transfer:'source',matrix:'source'},
    ...(previous?{previousIntentDigest:previous.intent.intentDigest}:{}),
    ...(selectedAudio.audioStreams.length?{audioStreamIndexes:selectedAudio.audioStreams.map((item)=>item.streamIndex)}:{})});
  const workspace=options.movieProductionReader.readWorkspace(workspaceId(snapshot.run.libraRunId));
  if(!workspace||workspace.state!=='active')throw new Error('Active Libra Workspace is unavailable for Transcode planning.');
  const root=options.workspaceProductPort.rootSnapshot(),target=buildWorkspaceMediaOutputTarget({libraRunId:snapshot.run.libraRunId,
    executionBasisDigest:snapshot.run.executionBasisDigest,workspaceId:workspace.workspaceId,
    expectedWorkspaceRevision:workspace.currentRevision,expectedWorkspaceStateDigest:workspace.stateDigest,rootSnapshot:root,
    workspaceScopeDigest:workspace.workspaceScopeDigest,targetRelativePath:'media/transcode-'+ordinal+'-'+intent.intentId.slice(0,16)+'.mkv',
    productionIntentDigest:intent.intentDigest});
  return Object.freeze({kind:'ready',source,requirement,intent,device:strategy.device,target});
}

function assessedTranscodePlanning(options,snapshot,ordinal){
  const work=transcodeStrategyAssessmentWork(snapshot,ordinal),results=options.workResultReader.read(work.workId),
    execution=results.find((item)=>item.outcomeKind==='succeeded'&&item.capabilityRef===TRANSCODE_INPUT_VERIFY);
  if(!execution)throw new Error('Transcode Selection requires one terminal Assessment Result.');
  const intent=literalInput(execution,'encodeIntent'),device=literalInput(execution,'mediaExecutionDeviceSnapshot'),verification=execution.result,
    source=transcodeSource(options,snapshot),requirement=buildMediaRequirement(snapshot.spec);
  if(!intent||!device||verification?.disposition!=='compatible'||verification.encodeIntentDigest!==intent.intentDigest||
      verification.deviceSnapshotDigest!==device.snapshotDigest)throw new Error('Transcode Selection cannot reuse an incompatible or stale Assessment.');
  const workspace=options.movieProductionReader.readWorkspace(workspaceId(snapshot.run.libraRunId));
  if(!workspace||workspace.state!=='active')throw new Error('Active Libra Workspace is unavailable for Transcode planning.');
  const root=options.workspaceProductPort.rootSnapshot(),target=buildWorkspaceMediaOutputTarget({libraRunId:snapshot.run.libraRunId,
    executionBasisDigest:snapshot.run.executionBasisDigest,workspaceId:workspace.workspaceId,expectedWorkspaceRevision:workspace.currentRevision,
    expectedWorkspaceStateDigest:workspace.stateDigest,rootSnapshot:root,workspaceScopeDigest:workspace.workspaceScopeDigest,
    targetRelativePath:'media/transcode-'+ordinal+'-'+intent.intentId.slice(0,16)+'.mkv',productionIntentDigest:intent.intentDigest});
  return Object.freeze({kind:'ready',source,requirement,intent,device,target,verification});
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
      const sourceScopeResolver=createProductionSourceScopeResolver({movieProductionReader:options.movieProductionReader,
        productionPort:options.productProductionPort});
      const sourceHandle=sourceScopeResolver.resolve(sourceScopeResolver.referenceFor(snapshot)).primaryReadHandle;
      const requirement=buildMediaRequirement(snapshot.spec);
      const candidateRef=buildPlannedProductCandidateReference({rank:1,candidateKind:'direct_input',
        candidateNodeId:'direct_input',mediaRequirementDigest:requirement.requirementDigest,
        sourceMaterialHandle:sourceHandle});
      const verifyEventId=stable('libra-direct-media-verify-event-',{attempt:request.workAttemptId});
      const selectEventId=stable('libra-direct-media-select-event-',{attempt:request.workAttemptId});
      const verify=planNode({...options,request,nodeId:'direct_media_verification',eventId:verifyEventId,capabilityRef:VERIFY,
        inputBindings:[owner('productMediaCandidateInput',request,DIRECT_CANDIDATE,{sourceWorkId:sourceWork.workId})],
        resourceKinds:['cpu','disk_io']});
      const select=planNode({...options,request,nodeId:'direct_output_selection',eventId:selectEventId,capabilityRef:SELECT,
        inputBindings:[selectionBinding(options,[verifyEventId],[candidateRef])],
        dependsOn:[{eventId:verifyEventId,satisfaction:'success'}],resourceKinds:['cpu']});
      return planEnvelope({plannerContractRef,catalogDigest},request,directWork,[verify,select]);
    }
    if(request.workId===remuxWork.workId){
      const sourceScopeResolver=createProductionSourceScopeResolver({movieProductionReader:options.movieProductionReader,
        productionPort:options.productProductionPort});
      const reference=buildProductionSourceScopeReference(sourceScopeResolver.referenceFor(snapshot));
      const requirement=buildMediaRequirement(snapshot.spec);
      const intent=buildRemuxIntent({revision:1,libraRunId:snapshot.run.libraRunId,
        sourceHandleDigest:reference.sourceReferenceDigest,mediaRequirementDigest:requirement.requirementDigest});
      const workspace=options.movieProductionReader.readWorkspace(workspaceId(snapshot.run.libraRunId));
      if(!workspace||workspace.state!=='active')throw new Error('Active Libra Workspace is unavailable for Remux planning.');
      const root=options.workspaceProductPort.rootSnapshot();
      const target=buildWorkspaceMediaOutputTarget({libraRunId:snapshot.run.libraRunId,
        executionBasisDigest:snapshot.run.executionBasisDigest,workspaceId:workspace.workspaceId,
        expectedWorkspaceRevision:workspace.currentRevision,expectedWorkspaceStateDigest:workspace.stateDigest,
        rootSnapshot:root,workspaceScopeDigest:workspace.workspaceScopeDigest,
        targetRelativePath:'media/remux-'+snapshot.run.libraRunId+'.mkv',productionIntentDigest:intent.intentDigest});
      const candidateRef=buildPlannedProductCandidateReference({rank:1,candidateKind:'workspace_output',
        candidateNodeId:'remux_output',mediaRequirementDigest:requirement.requirementDigest,
        outputTargetId:target.targetId,outputTargetDigest:target.targetDigest,
        productionIntentDigest:intent.intentDigest});
      const remuxEventId=stable('libra-remux-media-event-',{attempt:request.workAttemptId});
      const probeEventId=stable('libra-remux-output-probe-event-',{attempt:request.workAttemptId});
      const verifyEventId=stable('libra-remux-output-verify-event-',{attempt:request.workAttemptId});
      const selectEventId=stable('libra-remux-output-select-event-',{attempt:request.workAttemptId});
      const remux=planNode({...options,request,nodeId:'remux_media',eventId:remuxEventId,capabilityRef:REMUX,
        inputBindings:[literal('productionSourceScopeReference',reference),literal('remuxIntent',intent),
          literal('workspaceMediaOutputTarget',target)],resourceKinds:['compute_device','cpu','disk_io']});
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
        inputBindings:[selectionBinding(options,[verifyEventId],[candidateRef])],
        dependsOn:[{eventId:verifyEventId,satisfaction:'success'}],resourceKinds:['cpu']});
      return planEnvelope({plannerContractRef,catalogDigest},request,remuxWork,[remux,outputProbe,verification,select]);
    }
    const transcodeIdentity=transcodeWorkIdentity(request.workId);
    if(transcodeIdentity!==null){
      const {ordinal,kind}=transcodeIdentity;
      if(kind==='assessment'){
        const assessmentWork=transcodeStrategyAssessmentWork(snapshot,ordinal);
        if(request.workId!==assessmentWork.workId)throw new Error('Transcode Assessment Work identity does not match its strategy ordinal.');
        const planning=transcodePlanning(options,snapshot,ordinal);
        if(planning.kind!=='ready')return planEnvelope({plannerContractRef,catalogDigest},request,assessmentWork,[],planning.kind,
          planning.diagnosticClassification);
        const inputVerifyEventId=stable('libra-transcode-input-verify-event-',{attempt:request.workAttemptId});
        const inputVerify=planNode({...options,request,nodeId:'transcode_strategy_assessment',eventId:inputVerifyEventId,
          capabilityRef:TRANSCODE_INPUT_VERIFY,inputBindings:[literal('physicalMaterialReadHandleOrWorkspaceMaterialHandle',planning.source.handle),
            literal('mediaProbeEvidence',planning.source.inputProbe),literal('encodeIntent',planning.intent),
            literal('mediaExecutionDeviceSnapshot',planning.device)],resourceKinds:['compute_device','cpu','disk_io']});
        return planEnvelope({plannerContractRef,catalogDigest},request,assessmentWork,[inputVerify]);
      }
      const transcodeWork=transcodeMediaSelectionWork(snapshot,ordinal);
      if(request.workId!==transcodeWork.workId)throw new Error('Transcode Selection Work identity does not match its strategy ordinal.');
      const planning=assessedTranscodePlanning(options,snapshot,ordinal);
      const transcodeEventId=stable('libra-transcode-media-event-',{attempt:request.workAttemptId});
      const probeEventId=stable('libra-transcode-output-probe-event-',{attempt:request.workAttemptId});
      const verifyEventId=stable('libra-transcode-output-verify-event-',{attempt:request.workAttemptId});
      const selectEventId=stable('libra-transcode-output-select-event-',{attempt:request.workAttemptId});
      const candidateRef=buildPlannedProductCandidateReference({rank:1,candidateKind:'workspace_output',
        candidateNodeId:'transcode_output_'+ordinal,mediaRequirementDigest:planning.requirement.requirementDigest,
        outputTargetId:planning.target.targetId,outputTargetDigest:planning.target.targetDigest,
        productionIntentDigest:planning.intent.intentDigest});
      const transcode=planNode({...options,request,nodeId:'transcode_media',eventId:transcodeEventId,capabilityRef:TRANSCODE,
        inputBindings:[literal('materialHandle',planning.source.handle),literal('encodeIntent',planning.intent),
          literal('mediaExecutionDeviceSnapshot',planning.device),literal('transcodeInputVerification',planning.verification),
          literal('workspaceMediaOutputTarget',planning.target)],
        resourceKinds:['compute_device','cpu','disk_io']});
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
        inputBindings:[selectionBinding(options,[verifyEventId],[candidateRef])],
        dependsOn:[{eventId:verifyEventId,satisfaction:'success'}],resourceKinds:['cpu']});
      return planEnvelope({plannerContractRef,catalogDigest},request,transcodeWork,[transcode,outputProbe,verification,select]);
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
    Object.freeze({projectionRef:OUTPUT_SELECTION,projection:Object.freeze({project:({sourceResults,parameters,targetEventId})=>{
      void targetEventId;
      const candidates=(sourceResults||[]).map((item)=>item.result)
        .sort((left,right)=>Buffer.from(left.verificationId).compare(Buffer.from(right.verificationId)));
      if(!candidates.length)throw new Error('Product Output Selection requires durable Verification Results.');
      const value=options.movieProductionReader.readRunSnapshot(candidates[0].libraRunId);
      if(candidates.some((item)=>item.libraRunId!==value.run.libraRunId||
        item.mediaRequirementDigest!==candidates[0].mediaRequirementDigest))
        throw new Error('Product Output Selection candidates cross one frozen Run or Requirement.');
      return buildProductOutputSelectionInput({libraRunId:value.run.libraRunId,acceptanceSpecId:value.spec.acceptanceSpecId,
        acceptanceSpecRecordDigest:value.spec.recordDigest,mediaRequirementDigest:candidates[0].mediaRequirementDigest,
        rankedCandidates:parameters.rankedCandidates,candidates});
    }})}),
  ]);
}

module.exports=Object.freeze({DIRECT_CANDIDATE,OUTPUT_SELECTION,SOURCE_HANDLE,SOURCE_SCOPE,REMUX_INTENT,REMUX_OUTPUT_TARGET,
  WORKSPACE_HANDLE,WORKSPACE_CANDIDATE,
  createWorkspaceMediaProductionPlanner,createWorkspaceMediaProductionProjections});
