'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
const media=require('../../src/helix/domains/libra/model/media-production-contracts');
const {createMediaProductionCoordinator}=require('../../src/helix/domains/libra/application/media-production-coordinator');
const {createMediaProductionCapabilityPorts}=require('../../src/helix/domains/libra/capabilities/media-production-capability-ports');
const {OUTPUT_SELECTION,createWorkspaceMediaProductionProjections}=
  require('../../src/helix/domains/libra/planning/media-production-planner');
const {transcodeStrategyAssessmentWork,transcodeMediaSelectionWork}=
  require('../../src/helix/domains/libra/planning/media-production-work');

const D=(value)=>canonicalDigest({value});
const contractRoot=path.resolve(__dirname,'../../src/helix/contracts');
const schemas=['types','domain-types','application-types'].flatMap((group)=>fs.readdirSync(path.join(contractRoot,group)).map((name)=>{
  const version=fs.readdirSync(path.join(contractRoot,group,name)).find((entry)=>/^v[0-9]+$/.test(entry));
  return JSON.parse(fs.readFileSync(path.join(contractRoot,group,name,version,'schema.json'),'utf8'));
}));
const schemaValidator=createCapabilityContractValidator({schemas});
const valid=(ref,value)=>{try{return schemaValidator.validate(ref,value);}catch(error){error.message+=' '+JSON.stringify(error.details?.errors);throw error;}};
function spec(){return {schemaRef:'libra.acceptance-spec@1',schemaVersion:1,acceptanceSpecId:'spec-1',specRevision:2,recordDigest:D('spec-record'),
  contentProfile:'movie',structureKind:'single',requirements:{mandatoryMedia:{mediaForm:'stream_file',videoCodec:'hevc',container:'matroska',
    fileExtension:'mkv',minimumRasterClass:'none',acceptedPrimaryAudioClasses:['truehd'],forbidSystemUpscaleFor4k:true},
  space:{unit:'product',maxSizeGiB:1,maxSizeBytes:1073741824}}};}
function source(){return valid('helix://contracts/types/PhysicalMaterialReadHandle/v1',{schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',schemaVersion:1,handleId:D('source-handle'),
  identity:{schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,materialKey:D('material'),mountScopeId:'mount-1',inode:'1',
    sizeBytes:100,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:D('source-bytes')},ownerDomain:'libra',ownerScope:{scopeType:'libra_run',scopeId:'run-1'},
  bindingRevision:1,endpointId:'endpoint-1',location:'input.mkv',mountScopeRevision:1,expectedSizeBytes:100,expectedMtimeNs:1,
  expectedCtimeNs:1,fingerprintVerifiedAtMs:1,readScope:'material_read',expiresAtMs:9999999999999,fenceDigest:D('source-fence')});}
function probe(handle,id='probe-1',overrides={}){const value={schemaRef:'helix://contracts/types/MediaProbeEvidence/v1',schemaVersion:1,evidenceId:id,
  evidenceKind:'media_probe',producerRef:'fake-media-port',basisDigest:D(id+'-basis'),payloadDigest:'',observedAtMs:1,
  sourceHandleDigest:canonicalDigest(handle),resultKind:'probed',container:'matroska',durationMs:1000,sizeBytes:handle.sizeBytes??handle.expectedSizeBytes,
  videoStreams:[{streamIndex:0,dispositionDefault:true,codec:'hevc',codecProfile:'main',pixelFormat:'yuv420p',bitDepth:8,chroma:'4:2:0',
    colorRange:'limited',colorPrimaries:'bt709',colorTransfer:'bt709',colorMatrix:'bt709',dynamicRangeKind:'sdr',
    codedWidth:3840,codedHeight:2160,sampleAspectRatio:'1:1',rotation:0,displayWidth:3840,displayHeight:2160,longEdge:3840,shortEdge:2160}],
  audioStreams:[{streamIndex:1,dispositionDefault:true,codec:'truehd',profile:'truehd',channels:8,channelLayout:'7.1',formatTags:[],normalizedAudioClass:'truehd',language:'eng'}],subtitleStreams:[],...overrides};
  value.payloadDigest=canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key])=>key!=='payloadDigest')));
  return valid('helix://contracts/types/MediaProbeEvidence/v1',value);}
function rootSnapshot(label='root'){return {rootId:'workspace-root-1',ownerScope:'libra',rootKind:'production-workspace',
  endpointId:'endpoint-1',mountScopeId:'mount-1',mountScopeRevision:1,configRevision:1,capabilityDigest:D(label+'-capability'),
  state:'active',rootHandleRef:D(label+'-handle'),snapshotDigest:D(label)};}
function device(){const value={deviceId:'device-1',deviceClass:'nvidia_nvenc',probeRevision:3,capabilitySchemaRef:'platform.compute-device-capability@1',
  capabilityPayload:{supportedVideoCodecs:['hevc'],supportedRateControlModes:['quality_bound'],validatedConcurrentSlots:1,
    validatedVideoPipelines:[{pipelineProfileId:'ordinary_to_hevc@1',inputDynamicRangeKinds:['sdr'],inputPixelFormats:['yuv420p'],
      outputCodec:'hevc',outputDynamicRangeKind:'unknown',outputPixelFormat:'encoder_selected',
      outputColorProfile:{range:'source',primaries:'source',transfer:'source',matrix:'source'},selfTestDigest:D('device-self-test')}]},
  capabilityDigest:'',enabled:true,state:'ready'};
  value.capabilityDigest=canonicalDigest(value.capabilityPayload);value.snapshotDigest=canonicalDigest(value);return value;}
function dvPipeline(){return {pipelineProfileId:'pq_bt2020_base_to_sdr_bt709_hevc@1',inputDynamicRangeKinds:['dolby_vision'],
  inputPixelFormats:['yuv420p10le'],outputCodec:'hevc',outputDynamicRangeKind:'sdr',outputPixelFormat:'yuv420p',
  outputColorProfile:{range:'limited',primaries:'bt709',transfer:'bt709',matrix:'bt709'},selfTestDigest:D('dv-self-test')};}
function withDevice(value,overrides={}){const result={...value,...overrides,
  capabilityPayload:{...value.capabilityPayload,...(overrides.capabilityPayload||{})}};
  result.capabilityDigest=canonicalDigest(result.capabilityPayload);delete result.snapshotDigest;
  result.snapshotDigest=canonicalDigest(result);return result;}
function dvProbe(handle,id='dv-probe',baseLayerKind='pq_bt2020_compatible',profile=8){return probe(handle,id,{
  videoStreams:[{streamIndex:0,dispositionDefault:true,codec:'hevc',codecProfile:'main 10',pixelFormat:'yuv420p10le',bitDepth:10,
    chroma:'4:2:0',colorRange:'limited',colorPrimaries:'bt2020',colorTransfer:'pq',colorMatrix:'bt2020nc',
    dynamicRangeKind:'dolby_vision',dolbyVision:{profile,level:6,rpuPresent:true,elPresent:profile===7,blPresent:true,
      compatibilityId:profile===8?1:6,baseLayerKind},codedWidth:3840,codedHeight:2160,sampleAspectRatio:'1:1',rotation:0,
    displayWidth:3840,displayHeight:2160,longEdge:3840,shortEdge:2160}],
  audioStreams:[{streamIndex:1,dispositionDefault:true,codec:'truehd',profile:'truehd',channels:8,channelLayout:'7.1',
    formatTags:[],normalizedAudioClass:'truehd',language:'eng'}]});}
function dvIntent(handle,requirement,deviceClass='nvidia_nvenc',strategyOrdinal=1,previousIntentDigest=undefined){return media.buildEncodeIntent({
  revision:1,libraRunId:'run-1',sourceHandleDigest:canonicalDigest(handle),mediaRequirementDigest:requirement.requirementDigest,
  rateControlMode:deviceClass==='software_cpu'?'two_pass_abr':'target_size',targetVideoBitrateBps:4_000_000,deviceClass,strategyOrdinal,
  dynamicRangeOperation:'tone_map_to_sdr_bt709',pipelineProfileId:'pq_bt2020_base_to_sdr_bt709_hevc@1',
  outputDynamicRangeKind:'sdr',outputPixelFormat:'yuv420p',
  outputColorProfile:{range:'limited',primaries:'bt709',transfer:'bt709',matrix:'bt709'},
  ...(previousIntentDigest?{previousIntentDigest}:{})});}
function encodeIntent(handle,requirement){return media.buildEncodeIntent({revision:1,libraRunId:'run-1',sourceHandleDigest:canonicalDigest(handle),
  mediaRequirementDigest:requirement.requirementDigest,rateControlMode:'quality_bound',qualityBound:20,deviceClass:'nvidia_nvenc',strategyOrdinal:1,
  dynamicRangeOperation:'preserve',pipelineProfileId:'ordinary_to_hevc@1',outputDynamicRangeKind:'sdr',outputPixelFormat:'yuv420p',
  outputColorProfile:{range:'source',primaries:'source',transfer:'source',matrix:'source'}});}
const preflight=()=>({sampleCount:24,passedSampleCount:24,reasonCode:null,preflightDigest:D('preflight')});

test('compiles exact media requirements and mutually exclusive production intents',()=>{
  const handle=source(),requirement=media.buildMediaRequirement(spec()),encoded=encodeIntent(handle,requirement),remuxed=media.buildRemuxIntent({revision:1,
    libraRunId:'run-1',sourceHandleDigest:canonicalDigest(handle),mediaRequirementDigest:requirement.requirementDigest});
  valid('helix://contracts/domain-types/MediaRequirement/v1',requirement);
  valid('helix://contracts/domain-types/EncodeIntent/v1',encoded);
  valid('helix://contracts/domain-types/RemuxIntent/v1',remuxed);
  assert.equal(requirement.schemaRef,'MediaRequirement@1');assert.equal(requirement.schemaVersion,undefined);
  assert.equal(encoded.schemaRef,'EncodeIntent@1');assert.equal(encoded.video.targetVideoBitrateBps,null);
  assert.equal(encoded.planningPolicyRef,'LibraMediaPlanningPolicy@1');assert.equal(encoded.strategyOrdinal,1);
  assert.equal(remuxed.schemaRef,'RemuxIntent@1');assert.equal(remuxed.video,undefined);
  assert.throws(()=>media.buildEncodeIntent({revision:1,libraRunId:'run-1',sourceHandleDigest:canonicalDigest(handle),
    mediaRequirementDigest:requirement.requirementDigest,rateControlMode:'quality_bound',qualityBound:64,deviceClass:'nvidia_nvenc',strategyOrdinal:1}),
  (error)=>error.code==='P9_MEDIA_RATE_CONTROL');
});

test('derives a conservative size budget and freezes retry attempts as new intents',()=>{
  const handle=source(),requirement=media.buildMediaRequirement(spec());
  const planningLimit=14*1073741824,budget=media.deriveTargetSizeBudget({maxSizeBytes:planningLimit,durationMs:7_200_000,
    audioStreams:[{normalizedAudioClass:'truehd'}],subtitleStreams:[{}]});
  assert.equal(budget.containerReserveBytes,Math.ceil(planningLimit*0.02));
  assert.equal(budget.feasible,true);assert.ok(budget.targetVideoBitrateBps>=100000);
  const allCopy=media.deriveTargetSizeBudget({maxSizeBytes:planningLimit,durationMs:6_300_000,audioStreams:[
    {streamIndex:1,dispositionDefault:true,normalizedAudioClass:'truehd'},
    {streamIndex:2,dispositionDefault:false,normalizedAudioClass:'truehd'},
    {streamIndex:3,dispositionDefault:false,normalizedAudioClass:'other'},
    {streamIndex:4,dispositionDefault:false,normalizedAudioClass:'other'},
    {streamIndex:5,dispositionDefault:false,normalizedAudioClass:'other'},
    {streamIndex:6,dispositionDefault:false,normalizedAudioClass:'other'}],subtitleStreams:[{},{}]});
  assert.equal(allCopy.feasible,false);
  const selected=media.selectCopyAudioStreamsForSizeBudget({maxSizeBytes:planningLimit,durationMs:6_300_000,audioStreams:[
    {streamIndex:1,dispositionDefault:true,normalizedAudioClass:'truehd'},
    {streamIndex:2,dispositionDefault:false,normalizedAudioClass:'truehd'},
    {streamIndex:3,dispositionDefault:false,normalizedAudioClass:'other'},
    {streamIndex:4,dispositionDefault:false,normalizedAudioClass:'other'},
    {streamIndex:5,dispositionDefault:false,normalizedAudioClass:'other'},
    {streamIndex:6,dispositionDefault:false,normalizedAudioClass:'other'}],subtitleStreams:[{},{}],
    acceptedPrimaryAudioClasses:[]});
  assert.equal(selected.feasible,true);
  assert.deepEqual(selected.audioStreams.map((item)=>item.streamIndex),[1,2]);
  const fiveStar=media.selectCopyAudioStreamsForSizeBudget({maxSizeBytes:50*1073741824,durationMs:6_300_000,audioStreams:[
    {streamIndex:1,dispositionDefault:true,normalizedAudioClass:'truehd'},
    {streamIndex:2,dispositionDefault:false,normalizedAudioClass:'other'}],subtitleStreams:[],
    acceptedPrimaryAudioClasses:['truehd','truehd_atmos','dts_hd_ma','dts_x','eac3_atmos']});
  assert.equal(fiveStar.feasible,true);
  assert.deepEqual(fiveStar.audioStreams.map((item)=>item.streamIndex),[1,2]);
  const extraLossless=media.selectCopyAudioStreamsForSizeBudget({maxSizeBytes:planningLimit,durationMs:6_300_000,audioStreams:[
    {streamIndex:1,dispositionDefault:true,normalizedAudioClass:'truehd'},
    {streamIndex:2,dispositionDefault:false,normalizedAudioClass:'truehd'},
    {streamIndex:3,dispositionDefault:false,normalizedAudioClass:'truehd'}],subtitleStreams:[],
    acceptedPrimaryAudioClasses:[]});
  assert.equal(extraLossless.feasible,true);
  assert.deepEqual(extraLossless.audioStreams.map((item)=>item.streamIndex),[1]);
  const first=media.buildEncodeIntent({revision:1,libraRunId:'run-1',sourceHandleDigest:canonicalDigest(handle),
    mediaRequirementDigest:requirement.requirementDigest,rateControlMode:'target_size',targetVideoBitrateBps:budget.targetVideoBitrateBps,
    deviceClass:'nvidia_nvenc',strategyOrdinal:1,dynamicRangeOperation:'preserve',pipelineProfileId:'ordinary_to_hevc@1',
    outputDynamicRangeKind:'sdr',outputPixelFormat:'yuv420p',outputColorProfile:{range:'source',primaries:'source',transfer:'source',matrix:'source'}});
  const retryBitrate=media.deriveRetryTargetVideoBitrate({previousTargetVideoBitrateBps:budget.targetVideoBitrateBps,
    maxSizeBytes:requirement.space.maxSizeBytes,actualSizeBytes:requirement.space.maxSizeBytes*2});
  const retry=media.buildEncodeIntent({revision:2,libraRunId:'run-1',sourceHandleDigest:canonicalDigest(handle),
    mediaRequirementDigest:requirement.requirementDigest,rateControlMode:'target_size',targetVideoBitrateBps:retryBitrate,
    deviceClass:'nvidia_nvenc',strategyOrdinal:2,previousIntentDigest:first.intentDigest,dynamicRangeOperation:'preserve',
    pipelineProfileId:'ordinary_to_hevc@1',outputDynamicRangeKind:'sdr',outputPixelFormat:'yuv420p',
    outputColorProfile:{range:'source',primaries:'source',transfer:'source',matrix:'source'}});
  valid('helix://contracts/domain-types/EncodeIntent/v1',first);valid('helix://contracts/domain-types/EncodeIntent/v1',retry);
  assert.notEqual(first.intentDigest,retry.intentDigest);assert.equal(retry.previousIntentDigest,first.intentDigest);
  const indexed=media.buildEncodeIntent({revision:1,libraRunId:'run-1',sourceHandleDigest:canonicalDigest(handle),
    mediaRequirementDigest:requirement.requirementDigest,rateControlMode:'target_size',targetVideoBitrateBps:budget.targetVideoBitrateBps,
    deviceClass:'nvidia_nvenc',strategyOrdinal:1,dynamicRangeOperation:'preserve',pipelineProfileId:'ordinary_to_hevc@1',
    outputDynamicRangeKind:'sdr',outputPixelFormat:'yuv420p',outputColorProfile:{range:'source',primaries:'source',transfer:'source',matrix:'source'},
    audioStreamIndexes:[1,2]});
  valid('helix://contracts/domain-types/EncodeIntent/v1',indexed);
  assert.deepEqual(indexed.audio.streamIndexes,[1,2]);
  assert.throws(()=>media.buildEncodeIntent({revision:1,libraRunId:'run-1',sourceHandleDigest:canonicalDigest(handle),
    mediaRequirementDigest:requirement.requirementDigest,rateControlMode:'target_size',targetVideoBitrateBps:budget.targetVideoBitrateBps,
    deviceClass:'nvidia_nvenc',strategyOrdinal:1,dynamicRangeOperation:'preserve',pipelineProfileId:'ordinary_to_hevc@1',
    outputDynamicRangeKind:'sdr',outputPixelFormat:'yuv420p',outputColorProfile:{range:'source',primaries:'source',transfer:'source',matrix:'source'},
    audioStreamIndexes:[2,1]}),(error)=>error.code==='P9_MEDIA_STREAM_INDEXES');
});

test('freezes transcode verification from the exact probe, intent, and device snapshot',()=>{
  const handle=source(),requirement=media.buildMediaRequirement(spec()),intent=encodeIntent(handle,requirement),snapshot=device();
  const result=media.buildTranscodeInputVerification({sourceHandle:handle,probeEvidence:probe(handle),encodeIntent:intent,deviceSnapshot:snapshot,preflight:preflight(),verifiedAtMs:5});
  valid('helix://contracts/types/TranscodeInputVerification/v1',result);
  assert.equal(result.result,'passed');assert.equal(result.selectedDeviceClass,'nvidia_nvenc');
  const failed=media.buildTranscodeInputVerification({sourceHandle:handle,probeEvidence:probe(handle),encodeIntent:{...intent,deviceClass:'intel_qsv'},deviceSnapshot:snapshot,preflight:preflight(),verifiedAtMs:5});
  assert.equal(failed.result,'failed');assert.deepEqual(failed.reasonCodes,['device_class_mismatch']);
});

test('D09-D10 accepts only a DV-compatible PQ base layer for the closed SDR normalization pipeline',()=>{
  const handle=source(),requirement=media.buildMediaRequirement(spec()),intent=dvIntent(handle,requirement),
    gpu=withDevice(device(),{capabilityPayload:{supportedRateControlModes:['target_size','strict_abr','quality_bound'],
      validatedVideoPipelines:[device().capabilityPayload.validatedVideoPipelines[0],dvPipeline()]}});
  const compatible=media.buildTranscodeInputVerification({sourceHandle:handle,probeEvidence:dvProbe(handle,'dv-p8'),
    encodeIntent:intent,deviceSnapshot:gpu,preflight:preflight(),verifiedAtMs:5});
  valid('helix://contracts/types/TranscodeInputVerification/v1',compatible);
  assert.equal(compatible.disposition,'compatible');assert.equal(compatible.result,'passed');
  const profile5=media.buildTranscodeInputVerification({sourceHandle:handle,
    probeEvidence:dvProbe(handle,'dv-p5','non_compatible',5),encodeIntent:intent,deviceSnapshot:gpu,
    preflight:{sampleCount:0,passedSampleCount:0,reasonCode:null,preflightDigest:D('not-run')},verifiedAtMs:6});
  valid('helix://contracts/types/TranscodeInputVerification/v1',profile5);
  assert.equal(profile5.disposition,'strategy_rejected');
  assert.ok(profile5.reasonCodes.includes('dolby_vision_base_layer_unsupported'));
  assert.equal(profile5.rejectionScope,'device_pipeline');
  assert.equal(profile5.coveredStrategyKeys.length,gpu.capabilityPayload.supportedRateControlModes.length);
});

test('R09 keeps GPU source rejection and CPU replacement as separate immutable Works and Intents',()=>{
  const snapshot={run:{libraRunId:'run-1',executionBasisDigest:D('basis'),acceptanceSpecId:'spec-1',priorityClass:'normal_foreground'},
    materialInputForm:'stream_file'},assessment=transcodeStrategyAssessmentWork(snapshot,1),selection=transcodeMediaSelectionWork(snapshot,1),
    handle=source(),requirement=media.buildMediaRequirement(spec()),gpuIntent=dvIntent(handle,requirement),
    cpuIntent=dvIntent(handle,requirement,'software_cpu',2,gpuIntent.intentDigest),gpu=withDevice(device(),{
      capabilityPayload:{supportedRateControlModes:['target_size','strict_abr','quality_bound']}}),
    rejection=media.buildTranscodeInputVerification({sourceHandle:handle,probeEvidence:dvProbe(handle),encodeIntent:gpuIntent,
      deviceSnapshot:gpu,preflight:{sampleCount:0,passedSampleCount:0,reasonCode:null,preflightDigest:D('not-run')},verifiedAtMs:7});
  assert.notEqual(assessment.workId,selection.workId);
  assert.ok(selection.dependencyRefs.some((item)=>item.objectId===assessment.workId));
  assert.equal(rejection.disposition,'strategy_rejected');
  assert.ok(rejection.reasonCodes.includes('required_pipeline_profile_unavailable'));
  assert.equal(cpuIntent.previousIntentDigest,gpuIntent.intentDigest);
  assert.notEqual(cpuIntent.intentDigest,gpuIntent.intentDigest);
  assert.equal(cpuIntent.deviceClass,'software_cpu');
});

test('DV normalized output passes only with SDR BT.709 yuv420p, no DOVI, and three decodable points',()=>{
  const handle=source(),requirement=media.buildMediaRequirement(spec()),intent=dvIntent(handle,requirement),
    gpu=withDevice(device(),{capabilityPayload:{supportedRateControlModes:['target_size','strict_abr','quality_bound'],
      validatedVideoPipelines:[device().capabilityPayload.validatedVideoPipelines[0],dvPipeline()]}}),
    workspaceId=D('dv-workspace'),target=media.buildWorkspaceMediaOutputTarget({libraRunId:'run-1',executionBasisDigest:D('basis'),workspaceId,
      expectedWorkspaceRevision:2,expectedWorkspaceStateDigest:D('workspace-state'),rootSnapshot:rootSnapshot(),workspaceScopeDigest:D('scope'),
      targetRelativePath:'products/dv-sdr.mkv',productionIntentDigest:intent.intentDigest}),
    output={schemaRef:'helix://contracts/types/WorkspaceMaterialHandle/v1',schemaVersion:1,handleId:D('dv-output'),workspaceId,
      ownerDomain:'libra',processId:'run-1',endpointId:'endpoint-1',materialKey:D('dv-output-material'),
      physicalIdentity:{mountScopeId:'mount-1',inode:'9',sizeBytes:100,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,
        contentFingerprint:D('dv-output-bytes')},rootHandleRef:'root-handle',relativePath:'products/dv-sdr.mkv',digestAlgorithm:'sha256',
      digestHex:D('dv-output-bytes'),sizeBytes:100,referenceRevision:1,accessScope:'workspace_material_read',fenceDigest:D('dv-output-fence')},
    mediaHandle=media.buildWorkspaceMediaHandle({sourceHandle:handle,outputTarget:target,workspaceMaterialHandle:output,
      productionIntentKind:'encode',productionIntent:intent,deviceSnapshot:gpu,producingEventId:'dv-event',
      effectReceipt:{effectId:'dv-effect',effectReceiptId:'dv-receipt',effectReceiptDigest:D('dv-receipt'),effectScopeDigest:target.effectScopeDigest}}),
    outputProbe=probe(output,'dv-output-probe'),input=media.buildProductMediaCandidateInput({candidateKind:'workspace_output',
      candidateNodeId:'dv-output',libraRunId:'run-1',mediaRequirement:requirement,workspaceMediaHandle:mediaHandle,
      sourceProbeEvidence:dvProbe(handle),outputProbeEvidence:outputProbe}),playback={samplePointsPercent:[5,50,95],
      passedSamplePointsPercent:[5,50,95],decodeDigest:D('dv-decode')};
  const passed=media.buildProductMediaVerification({input,playbackVerification:playback,verifiedAtMs:9});
  valid('helix://contracts/types/ProductMediaVerification/v1',passed);
  assert.equal(passed.result,'passed');assert.equal(passed.dynamicRangeSummary.outputDynamicRangeKind,'sdr');
  const badProbe=probe(output,'dv-bad-output',{videoStreams:[{...outputProbe.videoStreams[0],colorTransfer:'pq',
    colorPrimaries:'bt2020',colorMatrix:'bt2020nc',pixelFormat:'yuv420p10le',dynamicRangeKind:'hdr10_compatible'}]});
  const badInput=media.buildProductMediaCandidateInput({candidateKind:'workspace_output',candidateNodeId:'dv-bad-output',libraRunId:'run-1',
    mediaRequirement:requirement,workspaceMediaHandle:mediaHandle,sourceProbeEvidence:dvProbe(handle),outputProbeEvidence:badProbe});
  const rejected=media.buildProductMediaVerification({input:badInput,playbackVerification:playback,verifiedAtMs:10});
  assert.ok(rejected.reasonCodes.includes('dynamic_range_conversion_unmet'));
  assert.ok(rejected.reasonCodes.includes('output_color_profile_unmet'));
});

test('builds one target-bound workspace result and verifies it without hidden path or device selection',()=>{
  const handle=source(),requirement=media.buildMediaRequirement(spec()),intent=encodeIntent(handle,requirement),snapshot=device(),workspaceId=D('workspace');
  const root=rootSnapshot(),target=media.buildWorkspaceMediaOutputTarget({libraRunId:'run-1',executionBasisDigest:D('basis'),workspaceId,
    expectedWorkspaceRevision:2,expectedWorkspaceStateDigest:D('workspace-state'),rootSnapshot:root,workspaceScopeDigest:D('scope'),
    targetRelativePath:'products/movie.mkv',productionIntentDigest:intent.intentDigest});
  const output={schemaRef:'helix://contracts/types/WorkspaceMaterialHandle/v1',schemaVersion:1,handleId:D('output-handle'),workspaceId,ownerDomain:'libra',processId:'run-1',
    endpointId:'endpoint-1',materialKey:D('output-material'),physicalIdentity:{mountScopeId:'mount-1',inode:'2',sizeBytes:100,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:D('bytes')},
    rootHandleRef:'root-handle',relativePath:'products/movie.mkv',digestAlgorithm:'sha256',digestHex:D('bytes'),sizeBytes:100,referenceRevision:1,
    accessScope:'workspace_material_read',fenceDigest:D('output-fence')};
  const result=media.buildWorkspaceMediaHandle({sourceHandle:handle,outputTarget:target,workspaceMaterialHandle:output,productionIntentKind:'encode',productionIntent:intent,
    deviceSnapshot:snapshot,producingEventId:'event-1',effectReceipt:{effectId:'effect-1',effectReceiptId:'receipt-1',effectReceiptDigest:D('receipt'),effectScopeDigest:target.effectScopeDigest}});
  valid('helix://contracts/domain-types/WorkspaceMediaOutputTarget/v1',target);
  valid('helix://contracts/types/WorkspaceMediaHandle/v1',result);
  assert.equal(result.workspaceMaterialHandle.handleId,output.handleId);assert.equal(result.outputTargetId,target.targetId);
  const input=media.buildProductMediaCandidateInput({candidateKind:'workspace_output',candidateNodeId:'node-1',libraRunId:'run-1',mediaRequirement:requirement,
    workspaceMediaHandle:result,sourceProbeEvidence:probe(handle,'source-probe'),outputProbeEvidence:probe(output,'output-probe')});
  const verification=media.buildProductMediaVerification({input,verifiedAtMs:9});
  valid('helix://contracts/domain-types/ProductMediaCandidateInput/v1',input);
  valid('helix://contracts/types/ProductMediaVerification/v1',verification);
  assert.equal(verification.result,'passed');assert.equal(verification.workspaceMediaHandleId,result.workspaceMediaHandleId);
});

test('selects by declared rank and never by caller order or size',()=>{
  const requirement=media.buildMediaRequirement(spec()),handle=source(),inputA=media.buildProductMediaCandidateInput({candidateKind:'direct_input',candidateNodeId:'node-a',
    libraRunId:'run-1',mediaRequirement:requirement,sourceMaterialHandle:handle,sourceProbeEvidence:probe(handle,'probe-a')}),
    inputB=media.buildProductMediaCandidateInput({candidateKind:'direct_input',candidateNodeId:'node-b',libraRunId:'run-1',mediaRequirement:requirement,
      sourceMaterialHandle:handle,sourceProbeEvidence:probe(handle,'probe-b')}),a=media.buildProductMediaVerification({input:inputA,verifiedAtMs:2}),
    b=media.buildProductMediaVerification({input:inputB,verifiedAtMs:2}),candidates=[a,b].sort((x,y)=>Buffer.from(x.verificationId).compare(Buffer.from(y.verificationId)));
  const selectionInput=media.buildProductOutputSelectionInput({libraRunId:'run-1',acceptanceSpecId:'spec-1',acceptanceSpecRecordDigest:D('spec-record'),
    mediaRequirementDigest:requirement.requirementDigest,rankedCandidates:[{rank:1,candidateId:b.candidateId,candidateNodeId:b.candidateNodeId},
      {rank:2,candidateId:a.candidateId,candidateNodeId:a.candidateNodeId}],candidates});
  const selected=media.selectProductOutput({input:selectionInput,producedAtMs:3});
  valid('helix://contracts/domain-types/ProductOutputSelectionInput/v1',selectionInput);
  valid('helix://contracts/types/SelectedProductOutput/v1',selected);
  assert.equal(selected.selectedVerificationId,b.verificationId);assert.equal(selected.selectionReasonCode,'selected_by_declared_rank');
});

test('D08 freezes multi-output rank before the Selection Event and executes the real Capability port',async()=>{
  const specValue=spec(),requirement=media.buildMediaRequirement(specValue),handle=source();
  const inputA=media.buildProductMediaCandidateInput({candidateKind:'direct_input',candidateNodeId:'plan-node-a',
    libraRunId:'run-1',mediaRequirement:requirement,sourceMaterialHandle:handle,sourceProbeEvidence:probe(handle,'plan-probe-a')});
  const inputB=media.buildProductMediaCandidateInput({candidateKind:'direct_input',candidateNodeId:'plan-node-b',
    libraRunId:'run-1',mediaRequirement:requirement,sourceMaterialHandle:handle,sourceProbeEvidence:probe(handle,'plan-probe-b')});
  const verificationA=media.buildProductMediaVerification({input:inputA,verifiedAtMs:2});
  const verificationB=media.buildProductMediaVerification({input:inputB,verifiedAtMs:2});
  const rankedCandidates=[
    media.buildPlannedProductCandidateReference({rank:1,candidateKind:'direct_input',candidateNodeId:'plan-node-b',
      mediaRequirementDigest:requirement.requirementDigest,sourceMaterialHandle:handle}),
    media.buildPlannedProductCandidateReference({rank:2,candidateKind:'direct_input',candidateNodeId:'plan-node-a',
      mediaRequirementDigest:requirement.requirementDigest,sourceMaterialHandle:handle}),
  ];
  assert.equal(rankedCandidates[0].candidateId,verificationB.candidateId);
  assert.equal(rankedCandidates[1].candidateId,verificationA.candidateId);
  const projections=createWorkspaceMediaProductionProjections({
    movieProductionReader:{readRun:()=>null,readRunSnapshot:()=>({run:{libraRunId:'run-1'},spec:specValue})},
    productProductionPort:{issuePhysicalReadHandle:()=>null},workResultReader:{},workspaceProductPort:{},
  });
  const projection=projections.find((item)=>item.projectionRef===OUTPUT_SELECTION).projection;
  const selectionInput=projection.project({
    sourceResults:Object.freeze([{result:verificationA},{result:verificationB}]),
    parameters:Object.freeze({rankedCandidates:Object.freeze(rankedCandidates)}),targetEventId:'selection-event',
  });
  valid('helix://contracts/domain-types/ProductOutputSelectionInput/v1',selectionInput);
  const ports=createMediaProductionCapabilityPorts({now:()=>3,
    mediaEffectPort:{executeRemux:async()=>{},executeTranscode:async()=>{},verifyTranscodeInput:async()=>preflight(),
      verifyPlayback:async()=>({samplePointsPercent:[5,50,95],passedSamplePointsPercent:[5,50,95],decodeDigest:D('decode')})},
    resolveProductionSourceScope:()=>{}});
  const context=Object.freeze({eventId:'selection-event',idempotencyKey:'selection-execution',
    namedInputs:Object.freeze({productOutputSelectionInput:selectionInput})});
  ports['libra.product_output.select@1'].validateInputs(context);
  const outcome=await ports['libra.product_output.select@1'].execute(context);
  ports['libra.product_output.select@1'].validateResult(context,outcome);
  valid('helix://contracts/types/SelectedProductOutput/v1',outcome.result);
  assert.equal(outcome.result.selectedVerificationId,verificationB.verificationId);
  assert.equal(outcome.result.selectionReasonCode,'selected_by_declared_rank');
});

test('accepts SSOT 4K-class raster and DTS-HD MA primary audio',()=>{
  const specValue=spec();
  specValue.requirements.mandatoryMedia.minimumRasterClass='4k';
  specValue.requirements.mandatoryMedia.acceptedPrimaryAudioClasses=['dts_hd_ma'];
  const requirement=media.buildMediaRequirement(specValue),handle=source();
  const cinema=probe(handle,'cinema-4k',{
    videoStreams:[{streamIndex:0,dispositionDefault:true,codec:'hevc',codedWidth:3800,codedHeight:1600,
      codecProfile:'main',pixelFormat:'yuv420p',bitDepth:8,chroma:'4:2:0',colorRange:'limited',colorPrimaries:'bt709',
      colorTransfer:'bt709',colorMatrix:'bt709',dynamicRangeKind:'sdr',sampleAspectRatio:'1:1',rotation:0,displayWidth:3800,displayHeight:1600,longEdge:3800,shortEdge:1600}],
    audioStreams:[{streamIndex:1,dispositionDefault:true,codec:'dts',profile:'DTS-HD MA',channels:6,
      channelLayout:'5.1(side)',formatTags:[],normalizedAudioClass:'dts_hd_ma',language:'eng'}]});
  const passed=media.buildProductMediaVerification({input:media.buildProductMediaCandidateInput({
    candidateKind:'direct_input',candidateNodeId:'cinema-4k',libraRunId:'run-1',mediaRequirement:requirement,
    sourceMaterialHandle:handle,sourceProbeEvidence:cinema}),verifiedAtMs:4});
  assert.equal(passed.result,'passed');
  assert.deepEqual(passed.qualitySummary.displayRasterClass,'4k');
  assert.deepEqual(passed.qualitySummary.primaryAudioClasses,['dts_hd_ma']);
  const crop=probe(handle,'below-4k',{
    videoStreams:[{streamIndex:0,dispositionDefault:true,codec:'hevc',codedWidth:3799,codedHeight:1600,
      codecProfile:'main',pixelFormat:'yuv420p',bitDepth:8,chroma:'4:2:0',colorRange:'limited',colorPrimaries:'bt709',
      colorTransfer:'bt709',colorMatrix:'bt709',dynamicRangeKind:'sdr',sampleAspectRatio:'1:1',rotation:0,displayWidth:3799,displayHeight:1600,longEdge:3799,shortEdge:1600}],
    audioStreams:[{streamIndex:1,dispositionDefault:true,codec:'dts',profile:'DTS-HD MA',channels:6,
      channelLayout:'5.1(side)',formatTags:[],normalizedAudioClass:'dts_hd_ma',language:'eng'}]});
  const failed=media.buildProductMediaVerification({input:media.buildProductMediaCandidateInput({
    candidateKind:'direct_input',candidateNodeId:'below-4k',libraRunId:'run-1',mediaRequirement:requirement,
    sourceMaterialHandle:handle,sourceProbeEvidence:crop}),verifiedAtMs:4});
  assert.equal(failed.result,'failed');
  assert.deepEqual(failed.reasonCodes,['minimum_raster_unmet']);
});

test('evaluates only Primary streams and rejects legacy normalizedClass fixtures',()=>{
  const specValue=spec();specValue.requirements.mandatoryMedia.minimumRasterClass='4k';
  const requirement=media.buildMediaRequirement(specValue),handle=source(),mixedProbe=probe(handle,'mixed-probe',{
    videoStreams:[
      {streamIndex:0,dispositionDefault:true,codec:'h264',codecProfile:'high',pixelFormat:'yuv420p',bitDepth:8,chroma:'4:2:0',colorRange:'limited',colorPrimaries:'bt709',colorTransfer:'bt709',colorMatrix:'bt709',dynamicRangeKind:'sdr',codedWidth:1920,codedHeight:1080,sampleAspectRatio:'1:1',rotation:0,displayWidth:1920,displayHeight:1080,longEdge:1920,shortEdge:1080},
      {streamIndex:1,dispositionDefault:false,codec:'hevc',codecProfile:'main',pixelFormat:'yuv420p',bitDepth:8,chroma:'4:2:0',colorRange:'limited',colorPrimaries:'bt709',colorTransfer:'bt709',colorMatrix:'bt709',dynamicRangeKind:'sdr',codedWidth:3840,codedHeight:2160,sampleAspectRatio:'1:1',rotation:0,displayWidth:3840,displayHeight:2160,longEdge:3840,shortEdge:2160}],
    audioStreams:[
      {streamIndex:2,dispositionDefault:true,codec:'aac',profile:'lc',channels:2,channelLayout:'stereo',formatTags:[],normalizedAudioClass:'other',language:'eng'},
      {streamIndex:3,dispositionDefault:false,codec:'truehd',profile:'truehd',channels:8,channelLayout:'7.1',formatTags:[],normalizedAudioClass:'truehd',language:'eng'}]});
  const input=media.buildProductMediaCandidateInput({candidateKind:'direct_input',candidateNodeId:'primary-only-node',libraRunId:'run-1',
    mediaRequirement:requirement,sourceMaterialHandle:handle,sourceProbeEvidence:mixedProbe});
  const result=media.buildProductMediaVerification({input,verifiedAtMs:4});
  assert.equal(result.result,'failed');
  assert.deepEqual(result.reasonCodes,['video_codec_unmet','minimum_raster_unmet','primary_audio_unmet']);
  const wrong=JSON.parse(JSON.stringify(mixedProbe));wrong.audioStreams[0].normalizedClass=wrong.audioStreams[0].normalizedAudioClass;
  delete wrong.audioStreams[0].normalizedAudioClass;wrong.payloadDigest=canonicalDigest(Object.fromEntries(Object.entries(wrong).filter(([key])=>key!=='payloadDigest')));
  assert.throws(()=>valid('helix://contracts/types/MediaProbeEvidence/v1',wrong),(error)=>error.code==='P4_CAPABILITY_SCHEMA_REJECTED');
});

test('rejects a forged MediaRequirement before candidate publication',()=>{
  const requirement=media.buildMediaRequirement(spec()),forged={...requirement,acceptanceSpecId:'foreign-spec'};
  assert.throws(()=>media.buildProductMediaCandidateInput({candidateKind:'direct_input',candidateNodeId:'forged-node',libraRunId:'run-1',
    mediaRequirement:forged,sourceMaterialHandle:source(),sourceProbeEvidence:probe(source(),'forged-probe')}),
  (error)=>error.code==='P9_MEDIA_REQUIREMENT_INTEGRITY');
});

test('coordinator accepts only a receipt bound to the frozen target and a passed transcode verification',async()=>{
  const handle=source(),requirement=media.buildMediaRequirement(spec()),intent=encodeIntent(handle,requirement),snapshot=device(),workspaceId=D('workspace-coordinator');
  const target=media.buildWorkspaceMediaOutputTarget({libraRunId:'run-1',executionBasisDigest:D('basis'),workspaceId,
    expectedWorkspaceRevision:2,expectedWorkspaceStateDigest:D('workspace-state'),rootSnapshot:rootSnapshot(),workspaceScopeDigest:D('scope'),
    targetRelativePath:'products/coordinator.mkv',productionIntentDigest:intent.intentDigest});
  const workspaceMaterialHandle={schemaRef:'helix://contracts/types/WorkspaceMaterialHandle/v1',schemaVersion:1,handleId:D('coordinator-output'),workspaceId,
    ownerDomain:'libra',processId:'run-1',endpointId:'endpoint-1',materialKey:D('coordinator-material'),
    physicalIdentity:{mountScopeId:'mount-1',inode:'3',sizeBytes:100,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:D('coordinator-bytes')},rootHandleRef:'root-handle',
    relativePath:target.targetRelativePath,digestAlgorithm:'sha256',digestHex:D('coordinator-bytes'),sizeBytes:100,referenceRevision:1,
    accessScope:'workspace_material_read',fenceDigest:D('coordinator-fence')};
  const receipt={effectId:'effect-1',effectReceiptId:'receipt-1',effectReceiptDigest:D('receipt-1'),effectScopeDigest:target.effectScopeDigest,
    outputTargetId:target.targetId,outputTargetDigest:target.targetDigest,workspaceMaterialHandle};
  const coordinator=createMediaProductionCoordinator({mediaEffectPort:{executeRemux:async()=>receipt,executeTranscode:async()=>receipt}}),
    transcodeInputVerification=media.buildTranscodeInputVerification({sourceHandle:handle,probeEvidence:probe(handle),encodeIntent:intent,deviceSnapshot:snapshot,preflight:preflight(),verifiedAtMs:5});
  const result=await coordinator.executeTranscode({sourceHandle:handle,productionIntent:intent,deviceSnapshot:snapshot,transcodeInputVerification,
    outputTarget:target,producingEventId:'event-1'});
  assert.equal(result.outputTargetId,target.targetId);
  await assert.rejects(()=>coordinator.executeTranscode({sourceHandle:handle,productionIntent:intent,deviceSnapshot:snapshot,
    transcodeInputVerification:{...transcodeInputVerification,result:'failed'},outputTarget:target,producingEventId:'event-1'}),
  (error)=>error.code==='P9_TRANSCODE_INPUT_NOT_VERIFIED');
  const forged=createMediaProductionCoordinator({mediaEffectPort:{executeRemux:async()=>({...receipt,outputTargetId:D('wrong')}),executeTranscode:async()=>receipt}});
  await assert.rejects(()=>forged.executeRemux({sourceHandle:handle,productionIntent:{...intent,intentDigest:target.productionIntentDigest},
    outputTarget:target,producingEventId:'event-2'}),(error)=>error.code==='P9_MEDIA_EFFECT_RECEIPT');
});

test('restart replays one journaled media effect without producing a second Workspace output',async()=>{
  const handle=source(),requirement=media.buildMediaRequirement(spec()),intent=media.buildRemuxIntent({revision:1,libraRunId:'run-1',
    sourceHandleDigest:canonicalDigest(handle),mediaRequirementDigest:requirement.requirementDigest}),workspaceId=D('workspace-replay'),
    target=media.buildWorkspaceMediaOutputTarget({libraRunId:'run-1',executionBasisDigest:D('basis-replay'),workspaceId,
      expectedWorkspaceRevision:2,expectedWorkspaceStateDigest:D('workspace-state-replay'),rootSnapshot:rootSnapshot('root-replay'),
      workspaceScopeDigest:D('scope-replay'),targetRelativePath:'products/replay.mkv',productionIntentDigest:intent.intentDigest});
  const output={schemaRef:'helix://contracts/types/WorkspaceMaterialHandle/v1',schemaVersion:1,handleId:D('replay-output'),workspaceId,
    ownerDomain:'libra',processId:'run-1',endpointId:'endpoint-1',materialKey:D('replay-material'),physicalIdentity:{mountScopeId:'mount-1',
      inode:'4',sizeBytes:100,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:D('replay-bytes')},rootHandleRef:'root-handle',relativePath:target.targetRelativePath,
    digestAlgorithm:'sha256',digestHex:D('replay-bytes'),sizeBytes:100,referenceRevision:1,accessScope:'workspace_material_read',fenceDigest:D('replay-fence')};
  const journal=new Map();let physicalWrites=0,crashOnce=true;
  const effectPort={async executeRemux(value){let receipt=journal.get(value.outputTarget.effectScopeDigest);if(!receipt){physicalWrites+=1;
    receipt={effectId:'effect-replay',effectReceiptId:'receipt-replay',effectReceiptDigest:D('receipt-replay'),
      effectScopeDigest:target.effectScopeDigest,outputTargetId:target.targetId,outputTargetDigest:target.targetDigest,workspaceMaterialHandle:output};
    journal.set(value.outputTarget.effectScopeDigest,receipt);}if(crashOnce){crashOnce=false;throw Object.assign(new Error('post-effect crash'),{code:'FIXTURE_CRASH'});}return receipt;},
    async executeTranscode(){throw new Error('unexpected');}};
  const coordinator=createMediaProductionCoordinator({mediaEffectPort:effectPort}),command={sourceHandle:handle,productionIntent:intent,
    outputTarget:target,producingEventId:'event-replay'};
  await assert.rejects(()=>coordinator.executeRemux(command),(error)=>error.code==='FIXTURE_CRASH');
  const recovered=await coordinator.executeRemux(command),replayed=await coordinator.executeRemux(command);
  assert.equal(physicalWrites,1);assert.deepEqual(recovered,replayed);assert.equal(recovered.outputTargetId,target.targetId);
});
