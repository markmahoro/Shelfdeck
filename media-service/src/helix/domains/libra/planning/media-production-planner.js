'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { executionCatalogDigest } = require('../../../foundation/execution/workflow-plan');
const {
  buildMediaRequirement,
  buildEncodeIntent,
  buildTranscodeInputVerification,
  buildProductMediaCandidateInput,
  buildPlannedProductCandidateReference,
  buildProductOutputSelectionInput,
  buildProductionSourceScopeReference,
  buildRemuxIntent,
  deriveRetryTargetVideoBitrate,
  deriveTargetSizeBudget,
  observedSourceVideoBitrateBps,
  selectCopyAudioStreamsForSizeBudget,
  rasterClass,
  videoBitrateFloorBps,
  buildWorkspaceMediaOutputTarget,
  LIBRA_MEDIA_PLANNING_POLICY,
} = require('../model/media-production-contracts');
const {
  externalImportSelectionWork,
} = require('./external-material-work');
const { classifyVerifyGap } = require('../model/media-production-routing');
const {
  seriesFinalSelectionWork,
  directMediaSelectionWork,
  remuxMediaSelectionWork,
  sourceMediaObservationWork,
  transcodeStrategyAssessmentWork,
  transcodeMediaSelectionWork,
} = require('./media-production-work');
const { createProductionSourceScopeResolver } = require('./production-source-scope-resolver');
const { readSourceMediaObservations } = require('./source-media-observations');
const { directCandidateNodeId, directRequirement, buildDirectMediaInput, seriesSpaceBasisFor } = require('./direct-media-selections');
const { workspaceId } = require('../model/workspace-admission-contracts');

const PROBE = 'shared.material.media.probe@1';
const VERIFY = 'libra.product_media.verify@1';
const SELECT = 'libra.product_output.select@1';
const REMUX = 'libra.media.remux@1';
const TRANSCODE_INPUT_VERIFY = 'libra.transcode.input.verify@1';
const TRANSCODE = 'libra.media.transcode@1';
const IMPORT = 'libra.workspace.material.import@1';
const SOURCE_HANDLE = 'helix://libra/input-projections/ProductionSourcePrimaryReadHandle/v1';
const SERIES_FINAL_CANDIDATE='helix://libra/input-projections/SeriesFinalProductMediaCandidateInput/v1';
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

function readExactTranscodeAssessment(options,snapshot,ordinal,member,source) {
  const work=transcodeStrategyAssessmentWork(snapshot,ordinal,member),results=options.workResultReader.read(work.workId),
    matches=results.filter(item=>item.outcomeKind==='succeeded'&&item.capabilityRef===TRANSCODE_INPUT_VERIFY);
  if(matches.length!==1)throw new Error('Transcode Assessment requires one exact durable Result.');
  const execution=matches[0],intent=literalInput(execution,'encodeIntent'),device=literalInput(execution,'mediaExecutionDeviceSnapshot'),
    handle=literalInput(execution,'physicalMaterialReadHandleOrWorkspaceMaterialHandle'),probe=literalInput(execution,'mediaProbeEvidence'),
    verification=execution.result;
  if(!intent||!device||!handle||!probe||!verification||canonicalJson(handle)!==canonicalJson(source.handle)||
      canonicalJson(probe)!==canonicalJson(source.inputProbe)||intent.libraRunId!==snapshot.run.libraRunId||
      intent.strategyOrdinal!==ordinal||intent.mediaRequirementDigest!==buildMediaRequirement(snapshot.spec).requirementDigest)
    throw new Error('Transcode Assessment differs from its frozen member, Probe, strategy, or Requirement.');
  const expected=buildTranscodeInputVerification({sourceHandle:handle,probeEvidence:probe,encodeIntent:intent,
    deviceSnapshot:device,verifiedAtMs:verification.verifiedAtMs,preflight:{sampleCount:verification.sampleCount,
      passedSampleCount:verification.passedSampleCount,preflightDigest:verification.preflightDigest,
      reasonCode:verification.reasonCodes.includes('encoder_rejected_source_pipeline')?'encoder_rejected_source_pipeline':null}});
  if(canonicalJson(expected)!==canonicalJson(verification))throw new Error('Transcode Assessment Result continuity is invalid.');
  return Object.freeze({work,results,intent,device,verification,
    key:device.deviceId+'\0'+device.probeRevision+'\0'+intent.video.pipelineProfileId+'\0'+intent.video.rateControlMode});
}

function priorTranscodeAssessments(options,snapshot,ordinal,member,source) {
  const items=[];
  for(let current=1;current<ordinal;current+=1)items.push(readExactTranscodeAssessment(options,snapshot,current,member,source));
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

function transcodeSourceFromExternalImport(options,snapshot) {
  const importWork=externalImportSelectionWork(snapshot);
  const status=options.workResultReader.status?.(importWork.workId);
  if(status?.state!=='succeeded')return null;
  const results=options.workResultReader.read(importWork.workId);
  const media=results.find((item)=>item.outcomeKind==='succeeded'&&item.capabilityRef===IMPORT)?.result;
  const probe=results.find((item)=>item.outcomeKind==='succeeded'&&item.capabilityRef===PROBE)?.result;
  const verify=results.find((item)=>item.outcomeKind==='succeeded'&&item.capabilityRef===VERIFY)?.result;
  const handle=media?.schemaRef==='helix://contracts/types/WorkspaceMaterialHandle/v1'?media:null;
  if(!handle||!probe||!verify)return null;
  const gap=classifyVerifyGap(verify);
  if(gap==='volume_only'||gap==='transcode_fixable'){
    return Object.freeze({handle,inputProbe:probe,originalProbe:probe,sourceKind:'external_workspace',editionEvidence:verify.qualitySummary?.editionEvidence||null});
  }
  return null;
}

function transcodeSource(options,snapshot,member) {
  if(snapshot.spec.contentProfile==='series') {
    if(!member)throw new Error('Series Transcode requires an exact frozen Primary Work.');
    const sources=readSourceMediaObservations(options,snapshot),selected=sources.find(item=>
      item.member.materialKey===member.materialKey&&canonicalDigest(item.member)===canonicalDigest(member));
    if(!selected)throw new Error('Series Transcode source differs from its frozen Primary.');
    return Object.freeze({handle:selected.readHandle,inputProbe:selected.record.result,originalProbe:selected.record.result,
      seriesSpaceBasis:seriesSpaceBasisFor(snapshot,sources)});
  }
  const external=transcodeSourceFromExternalImport(options,snapshot);
  if(external)return external;
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

function transcodePlanning(options,snapshot,ordinal,member) {
  const source=transcodeSource(options,snapshot,member),requirement=buildMediaRequirement(snapshot.spec),prior=priorTranscodeAssessments(options,snapshot,ordinal,member,source),
    primary=(source.inputProbe.videoStreams||[]).filter((item)=>item.dispositionDefault===true),streams=primary.length?primary:(source.inputProbe.videoStreams||[]).slice(0,1),
    hasDolbyVision=streams.some((item)=>item.dynamicRangeKind==='dolby_vision'),pipelineProfileId=hasDolbyVision
      ?'pq_bt2020_base_to_sdr_bt709_hevc@1':'ordinary_to_hevc@1';
  const attempted=new Set(prior.flatMap((item)=>item.verification.coveredStrategyKeys||[item.key])),
    strategy=readyDeviceStrategies(options,requirement,attempted,pipelineProfileId)[0]||null;
  if(!strategy)return prior.length
    ?Object.freeze({kind:'contract_unplannable',diagnosticClassification:'media_device_strategies_exhausted'})
    :Object.freeze({kind:'temporarily_unplannable',diagnosticClassification:'media_device_strategies_unavailable'});
  const maxSizeBytes=member?require('../model/series-media-space').deriveSeriesMemberSizeBudget({basis:source.seriesSpaceBasis,
    materialKey:member.materialKey,maxSizeBytes:requirement.space.maxSizeBytes}):requirement.space.maxSizeBytes;
  if(maxSizeBytes===0)return Object.freeze({kind:'contract_unplannable',diagnosticClassification:'media_size_budget_infeasible'});
  const audioStreams=source.inputProbe.audioStreams||[];
  const displayRaster=rasterClass(source.inputProbe);
  const selectedAudio=maxSizeBytes===null
    ?Object.freeze({audioStreams,budget:null,feasible:true})
    :selectCopyAudioStreamsForSizeBudget({maxSizeBytes,durationMs:source.inputProbe.durationMs,
      audioStreams,subtitleStreams:source.inputProbe.subtitleStreams,
      acceptedPrimaryAudioClasses:requirement.mandatoryMedia.acceptedPrimaryAudioClasses,
      rasterClass:displayRaster,sourceProbe:source.inputProbe,
      ...(member?{videoBitrateFloorBps:videoBitrateFloorBps(requirement.space.maxSizeBytes,displayRaster)}:{}),
      ...(Number.isSafeInteger(source.inputProbe.sizeBytes)&&source.inputProbe.sizeBytes>0?{sourceSizeBytes:source.inputProbe.sizeBytes}:{})});
  const budget=selectedAudio.budget;
  const previous=prior.at(-1)||null,previousSelection=previous?options.workResultReader.read(
    transcodeMediaSelectionWork(snapshot,ordinal-1,member).workId):[],previousVerifications=previousSelection.filter(item=>
      item.outcomeKind==='succeeded'&&item.capabilityRef===VERIFY),previousVerification=previousVerifications[0]?.result||null;
  if(previousVerifications.length>1||previousVerification&&(previousVerification.libraRunId!==snapshot.run.libraRunId||
      previousVerification.mediaRequirementDigest!==requirement.requirementDigest||
      previousVerification.sourceProbeEvidenceDigest!==canonicalDigest(source.originalProbe)))
    throw new Error('Transcode retry measurement differs from the exact member source and Requirement.');
  let targetVideoBitrateBps=budget?.targetVideoBitrateBps||null;
  if(previous&&previousVerification?.reasonCodes?.includes('max_size_exceeded')&&previous.intent.video.targetVideoBitrateBps){
    const retried=deriveRetryTargetVideoBitrate({previousTargetVideoBitrateBps:previous.intent.video.targetVideoBitrateBps,
      maxSizeBytes,actualSizeBytes:previousVerification.spaceSummary.actualSizeBytes});
    targetVideoBitrateBps=retried;
  }
  const qualityFloorVideoBitrateBps=budget?.videoBitrateFloorBps||
    observedSourceVideoBitrateBps(source.inputProbe)||1;
  const intent=buildEncodeIntent({revision:1,libraRunId:snapshot.run.libraRunId,sourceHandleDigest:canonicalDigest(source.handle),
    mediaRequirementDigest:requirement.requirementDigest,strategyOrdinal:ordinal,rateControlMode:strategy.mode,
    ...(strategy.mode==='quality_bound'?{qualityBound:23}:{targetVideoBitrateBps}),deviceClass:strategy.device.deviceClass,
    qualityFloorVideoBitrateBps,
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

function assessedTranscodePlanning(options,snapshot,ordinal,member){
  const source=transcodeSource(options,snapshot,member),requirement=buildMediaRequirement(snapshot.spec),
    {intent,device,verification}=readExactTranscodeAssessment(options,snapshot,ordinal,member,source);
  if(verification.disposition!=='compatible')throw new Error('Transcode Selection cannot reuse an incompatible Assessment.');
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
    let remuxMember=snapshot.spec.contentProfile==='series'?snapshot.members.filter(item=>item.role==='primary_payload')
      .find(member=>remuxMediaSelectionWork(snapshot,member).workId===request.workId):undefined;
    let externalRemuxSource=null;
    if(snapshot.spec.contentProfile==='series'&&!remuxMember&&request.workId.startsWith('libra-workspace-media-remux_selection-work-')) {
      externalRemuxSource=require('./series-external-processing-source').readProcessingSources(options,snapshot)
        .find(source=>remuxMediaSelectionWork(snapshot,source.member).workId===request.workId)||null;
      remuxMember=externalRemuxSource?.member;
    }
    const sourceWork=sourceMediaObservationWork(snapshot),directWork=directMediaSelectionWork(snapshot),
      remuxWork=remuxMediaSelectionWork(snapshot,remuxMember);
    if(request.workId.startsWith('libra-workspace-media-series_final_selection-work-')) {
      const {readSeriesProductionCandidates,candidateSetDigest,finalCandidateInput}=require('./series-production-candidates'),
        candidates=readSeriesProductionCandidates(options,snapshot),basis=candidateSetDigest(candidates),
        work=seriesFinalSelectionWork(snapshot,basis,candidates.map(item=>item.work));
      if(request.workId!==work.workId)throw new Error('Final Series Work differs from the complete candidate basis.');
      const nodes=candidates.flatMap((candidate,index)=>{
        const input=finalCandidateInput(snapshot,candidates,candidate),parameters={materialKey:candidate.member.materialKey,
          memberDigest:canonicalDigest(candidate.member),candidateSetDigest:basis},
          verifyEventId=stable('libra-series-final-verify-event-',{attempt:request.workAttemptId,...parameters}),
          selectEventId=stable('libra-series-final-select-event-',{attempt:request.workAttemptId,...parameters});
        return [planNode({...options,request,nodeId:'series_final_verify_'+index,eventId:verifyEventId,capabilityRef:VERIFY,
          inputBindings:[owner('productMediaCandidateInput',request,SERIES_FINAL_CANDIDATE,parameters)],resourceKinds:['cpu','disk_io']}),
          planNode({...options,request,nodeId:'series_final_select_'+index,eventId:selectEventId,capabilityRef:SELECT,
            inputBindings:[selectionBinding(options,[verifyEventId],[{rank:1,candidateId:input.candidateId,candidateNodeId:input.candidateNodeId}])],
            dependsOn:[{eventId:verifyEventId,satisfaction:'success'}],resourceKinds:['cpu']})];
      });
      return planEnvelope({plannerContractRef,catalogDigest},request,work,nodes);
    }
    if(request.workId===sourceWork.workId){
      const isSeries=snapshot.spec.contentProfile==='series';
      const resolver=createProductionSourceScopeResolver({movieProductionReader:options.movieProductionReader,
        productionPort:options.productProductionPort});
      const nodes=resolver.primarySources(snapshot).map((item,index)=>{
        const parameters=isSeries?{materialKey:item.member.materialKey,memberDigest:canonicalDigest(item.member)}:{};
        const eventId=stable('libra-source-media-probe-event-',isSeries
          ?{attempt:request.workAttemptId,...parameters}:{attempt:request.workAttemptId});
        return planNode({...options,request,nodeId:isSeries?'source_media_probe_'+index:'source_media_probe',
          eventId,capabilityRef:PROBE,
          inputBindings:[owner('physicalMaterialReadHandleOrWorkspaceMaterialHandle',request,SOURCE_HANDLE,parameters)],
          resourceKinds:['cpu','disk_io']});
      });
      return planEnvelope({plannerContractRef,catalogDigest},request,sourceWork,nodes);
    }
    if(request.workId===directWork.workId){
      if(snapshot.materialInputForm!=='stream_file')throw new Error('Direct media selection only accepts stream-file input.');
      const sourceScopeResolver=createProductionSourceScopeResolver({movieProductionReader:options.movieProductionReader,
        productionPort:options.productProductionPort});
      const sources=sourceScopeResolver.primarySources(snapshot);
      const requirement=directRequirement(snapshot,sources),isSeries=snapshot.spec.contentProfile==='series';
      const nodes=sources.flatMap((source,index)=>{
      const sourceHandle=source.readHandle,candidateNodeId=directCandidateNodeId(snapshot,source.member);
      const memberParameters=isSeries?{materialKey:source.member.materialKey,memberDigest:canonicalDigest(source.member)}:{};
      const candidateRef=buildPlannedProductCandidateReference({rank:1,candidateKind:'direct_input',
        candidateNodeId,mediaRequirementDigest:requirement.requirementDigest,
        sourceMaterialHandle:sourceHandle});
      const verifyEventId=stable('libra-direct-media-verify-event-',{attempt:request.workAttemptId,...memberParameters});
      const selectEventId=stable('libra-direct-media-select-event-',{attempt:request.workAttemptId,...memberParameters});
      const verify=planNode({...options,request,nodeId:isSeries?'direct_media_verification_'+index:'direct_media_verification',eventId:verifyEventId,capabilityRef:VERIFY,
        inputBindings:[owner('productMediaCandidateInput',request,DIRECT_CANDIDATE,{sourceWorkId:sourceWork.workId,...memberParameters})],
        resourceKinds:['cpu','disk_io']});
      const select=planNode({...options,request,nodeId:isSeries?'direct_output_selection_'+index:'direct_output_selection',eventId:selectEventId,capabilityRef:SELECT,
        inputBindings:[selectionBinding(options,[verifyEventId],[candidateRef])],
        dependsOn:[{eventId:verifyEventId,satisfaction:'success'}],resourceKinds:['cpu']});
      return [verify,select];
      });
      return planEnvelope({plannerContractRef,catalogDigest},request,directWork,nodes);
    }
    if(request.workId===remuxWork.workId){
      const sourceScopeResolver=createProductionSourceScopeResolver({movieProductionReader:options.movieProductionReader,
        productionPort:options.productProductionPort});
      if(snapshot.spec.contentProfile==='series'&&!remuxMember)throw new Error('Series Remux requires one frozen Primary Work.');
      const memberParameters=remuxMember?{materialKey:remuxMember.materialKey,memberDigest:canonicalDigest(remuxMember)}:{};
      const candidateNodeId=remuxMember?stable('remux_output_',memberParameters):'remux_output';
      const importedSource=externalRemuxSource||(remuxMember?null:transcodeSourceFromExternalImport(options,snapshot));
      const reference=importedSource?require('./production-source-scope-resolver').workspaceReferenceFor(snapshot,importedSource.handle):remuxMember?sourceScopeResolver.primaryReferenceFor(snapshot,memberParameters)
        :buildProductionSourceScopeReference(sourceScopeResolver.referenceFor(snapshot));
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
        targetRelativePath:'media/remux-'+(remuxMember?canonicalDigest(memberParameters):snapshot.run.libraRunId)+'.mkv',productionIntentDigest:intent.intentDigest});
      const candidateRef=buildPlannedProductCandidateReference({rank:1,candidateKind:'workspace_output',
        candidateNodeId,mediaRequirementDigest:requirement.requirementDigest,
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
        ],WORKSPACE_CANDIDATE,{sourceWorkId:externalRemuxSource?externalRemuxSource.set.work.workId:sourceWork.workId,candidateNodeId,...memberParameters})],
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
      const member=snapshot.spec.contentProfile==='series'?snapshot.members.filter(item=>item.role==='primary_payload')
        .find(item=>(kind==='assessment'?transcodeStrategyAssessmentWork(snapshot,ordinal,item):
          transcodeMediaSelectionWork(snapshot,ordinal,item)).workId===request.workId):undefined;
      if(snapshot.spec.contentProfile==='series'&&!member)throw new Error('Series Transcode Work does not bind a frozen Primary.');
      const memberParameters=member?{materialKey:member.materialKey,memberDigest:canonicalDigest(member)}:{};
      const candidateNodeId=member?stable('transcode_output_'+ordinal+'_',memberParameters):'transcode_output_'+ordinal;
      if(kind==='assessment'){
        const assessmentWork=transcodeStrategyAssessmentWork(snapshot,ordinal,member);
        if(request.workId!==assessmentWork.workId)throw new Error('Transcode Assessment Work identity does not match its strategy ordinal.');
        const planning=transcodePlanning(options,snapshot,ordinal,member);
        if(planning.kind!=='ready')return planEnvelope({plannerContractRef,catalogDigest},request,assessmentWork,[],planning.kind,
          planning.diagnosticClassification);
        const inputVerifyEventId=stable('libra-transcode-input-verify-event-',{attempt:request.workAttemptId});
        const inputVerify=planNode({...options,request,nodeId:'transcode_strategy_assessment',eventId:inputVerifyEventId,
          capabilityRef:TRANSCODE_INPUT_VERIFY,inputBindings:[literal('physicalMaterialReadHandleOrWorkspaceMaterialHandle',planning.source.handle),
            literal('mediaProbeEvidence',planning.source.inputProbe),literal('encodeIntent',planning.intent),
            literal('mediaExecutionDeviceSnapshot',planning.device)],resourceKinds:['compute_device','cpu','disk_io']});
        return planEnvelope({plannerContractRef,catalogDigest},request,assessmentWork,[inputVerify]);
      }
      const transcodeWork=transcodeMediaSelectionWork(snapshot,ordinal,member);
      if(request.workId!==transcodeWork.workId)throw new Error('Transcode Selection Work identity does not match its strategy ordinal.');
      const planning=assessedTranscodePlanning(options,snapshot,ordinal,member);
      const transcodeEventId=stable('libra-transcode-media-event-',{attempt:request.workAttemptId});
      const probeEventId=stable('libra-transcode-output-probe-event-',{attempt:request.workAttemptId});
      const verifyEventId=stable('libra-transcode-output-verify-event-',{attempt:request.workAttemptId});
      const selectEventId=stable('libra-transcode-output-select-event-',{attempt:request.workAttemptId});
      const candidateRef=buildPlannedProductCandidateReference({rank:1,candidateKind:'workspace_output',
        candidateNodeId,mediaRequirementDigest:planning.requirement.requirementDigest,
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
        ],WORKSPACE_CANDIDATE,{sourceWorkId:sourceWork.workId,candidateNodeId,...memberParameters})],
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
    Object.freeze({projectionRef:SERIES_FINAL_CANDIDATE,projection:Object.freeze({project:({ownerScope,parameters})=>{
      const value=snapshot(ownerScope),{readSeriesProductionCandidates,candidateSetDigest,finalCandidateInput}=require('./series-production-candidates'),
        candidates=readSeriesProductionCandidates(options,value),candidate=candidates.find(item=>item.member.materialKey===parameters.materialKey);
      if(Object.keys(parameters).length!==3||!candidate||canonicalDigest(candidate.member)!==parameters.memberDigest||
          candidateSetDigest(candidates)!==parameters.candidateSetDigest)
        throw new Error('Final Series projection differs from its immutable candidate set.');
      return finalCandidateInput(value,candidates,candidate);
    }})}),
    Object.freeze({projectionRef:SOURCE_HANDLE,projection:Object.freeze({project:({ownerScope,parameters={}})=>{
      const value=snapshot(ownerScope);
      if(value.spec.contentProfile!=='series') {
        if(Object.keys(parameters).length)throw new Error('Single source Probe cannot carry Series member parameters.');
        return source(value).primaryReadHandle;
      }
      return sourceScopeResolver.primarySource(value,parameters).readHandle;
    }})}),
    Object.freeze({projectionRef:DIRECT_CANDIDATE,projection:Object.freeze({project:({ownerScope,parameters})=>{
      const value=snapshot(ownerScope);
      if(parameters.sourceWorkId!==sourceMediaObservationWork(value).workId)
        throw new Error('Direct Candidate must reference the exact frozen Run Source Work.');
      const {sourceWorkId,...memberParameters}=parameters;
      const frozen=value.spec.contentProfile==='series'?sourceScopeResolver.primarySource(value,memberParameters):null;
      const sources=readSourceMediaObservations(options,value);
      let selected;
      if(value.spec.contentProfile==='series') {
        selected=sources.find(item=>item.member.materialKey===frozen.member.materialKey);
      } else {
        if(Object.keys(memberParameters).length)throw new Error('Single Direct Candidate cannot carry Series member parameters.');
        selected=sources[0];
      }
      return buildDirectMediaInput(value,sources,selected);
    }})}),
    Object.freeze({projectionRef:SOURCE_SCOPE,projection:Object.freeze({project:({ownerScope})=>sourceReference(snapshot(ownerScope))})}),
    Object.freeze({projectionRef:REMUX_INTENT,projection:Object.freeze({project:({ownerScope})=>remuxIntent(snapshot(ownerScope))})}),
    Object.freeze({projectionRef:REMUX_OUTPUT_TARGET,projection:Object.freeze({project:({ownerScope})=>remuxTarget(snapshot(ownerScope))})}),
    Object.freeze({projectionRef:WORKSPACE_HANDLE,projection:Object.freeze({project:({sourceResult})=>sourceResult.workspaceMaterialHandle})}),
    Object.freeze({projectionRef:WORKSPACE_CANDIDATE,projection:Object.freeze({project:({sourceResults,parameters})=>{
      const media=sourceResults.find((item)=>item.result?.workspaceMediaHandleId)?.result;
      const outputProbe=sourceResults.find((item)=>item.result?.schemaRef==='helix://contracts/types/MediaProbeEvidence/v1')?.result;
      if(!media||!outputProbe)throw new Error('Workspace media Candidate requires durable media and Probe Results.');
      const value=options.movieProductionReader.readRunSnapshot(media.workspaceMaterialHandle.processId);
      if(value.spec.contentProfile==='series') {
        if(parameters.sourceWorkId!==sourceMediaObservationWork(value).workId) {
          const {exactProcessingSource,processingSpaceBasis}=require('./series-external-processing-source');
          const source=exactProcessingSource(options,value,parameters);
          if(Object.keys(parameters).sort().join(',')!=='candidateNodeId,materialKey,memberDigest,sourceWorkId'||
              parameters.candidateNodeId!==stable('remux_output_',{materialKey:source.member.materialKey,memberDigest:canonicalDigest(source.member)}))
            throw new Error('External Remux candidate identity differs from its frozen member.');
          if(media.sourceMaterialHandleDigest!==canonicalDigest(source.handle))throw new Error('External output source Handle drifted.');
          return buildProductMediaCandidateInput({libraRunId:value.run.libraRunId,candidateNodeId:parameters.candidateNodeId,
            candidateKind:'workspace_output',mediaRequirement:buildMediaRequirement(value.spec),workspaceMediaHandle:media,
            sourceProbeEvidence:source.probe,outputProbeEvidence:outputProbe,seriesSpaceBasis:processingSpaceBasis(value,source,media,outputProbe)});
        }
        const {sourceWorkId,candidateNodeId,...memberParameters}=parameters;
        const frozen=sourceScopeResolver.primarySource(value,memberParameters),sources=readSourceMediaObservations(options,value),
          selected=sources.find(item=>item.member.materialKey===frozen.member.materialKey);
        if(media.sourceMaterialHandleDigest!==canonicalDigest(selected.readHandle)||
            media.workspaceMaterialHandle.processId!==value.run.libraRunId)
          throw new Error('Series output does not derive from the declared Primary.');
        const seriesSpaceBasis=seriesSpaceBasisFor(value,sources,[{materialKey:selected.member.materialKey,media,probe:outputProbe}]);
        return buildProductMediaCandidateInput({libraRunId:value.run.libraRunId,candidateNodeId,candidateKind:'workspace_output',
          mediaRequirement:buildMediaRequirement(value.spec),workspaceMediaHandle:media,
          sourceProbeEvidence:selected.record.result,outputProbeEvidence:outputProbe,seriesSpaceBasis});
      }
      const externalSource=transcodeSourceFromExternalImport(options,value);
      const probe=externalSource && canonicalDigest(externalSource.handle)===media.sourceMaterialHandleDigest
        ? externalSource.inputProbe : sourceProbe(value,parameters.sourceWorkId);
      if(externalSource && probe.sourceHandleDigest!==media.sourceMaterialHandleDigest)
        throw new Error('Workspace verification must use the actual production input Probe.');
      return buildProductMediaCandidateInput({libraRunId:value.run.libraRunId,candidateNodeId:parameters.candidateNodeId,
        candidateKind:'workspace_output',mediaRequirement:buildMediaRequirement(value.spec),workspaceMediaHandle:media,
        sourceProbeEvidence:probe,outputProbeEvidence:outputProbe,
        ...(externalSource&&canonicalDigest(externalSource.handle)===media.sourceMaterialHandleDigest&&externalSource.editionEvidence
          ?{editionEvidence:externalSource.editionEvidence}:{})});
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
