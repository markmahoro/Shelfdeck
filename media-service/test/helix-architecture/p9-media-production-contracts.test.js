'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
const media=require('../../src/helix/domains/libra/model/media-production-contracts');
const {createMediaProductionCoordinator}=require('../../src/helix/domains/libra/application/media-production-coordinator');

const D=(value)=>canonicalDigest({value});
const contractRoot=path.resolve(__dirname,'../../src/helix/contracts');
const schemas=['types','domain-types','application-types'].flatMap((group)=>fs.readdirSync(path.join(contractRoot,group)).map((name)=>
  JSON.parse(fs.readFileSync(path.join(contractRoot,group,name,'v1/schema.json'),'utf8'))));
const schemaValidator=createCapabilityContractValidator({schemas});
const valid=(ref,value)=>{try{return schemaValidator.validate(ref,value);}catch(error){error.message+=' '+JSON.stringify(error.details?.errors);throw error;}};
function spec(){return {schemaRef:'libra.acceptance-spec@1',schemaVersion:1,acceptanceSpecId:'spec-1',specRevision:2,recordDigest:D('spec-record'),
  contentProfile:'movie',structureKind:'single',requirements:{mandatoryMedia:{mediaForm:'stream_file',videoCodec:'hevc',container:'matroska',
    fileExtension:'mkv',minimumRasterClass:'none',acceptedPrimaryAudioClasses:['truehd'],forbidSystemUpscaleFor4k:true},
  space:{unit:'product',maxSizeGiB:1,maxSizeBytes:1073741824}}};}
function source(){return valid('helix://contracts/types/PhysicalMaterialReadHandle/v1',{schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',schemaVersion:1,handleId:D('source-handle'),
  identity:{schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v1',schemaVersion:1,materialKey:D('material'),mountScopeId:'mount-1',inode:'1',
    contentHashAlgorithm:'sha256',contentHash:D('source-bytes')},ownerDomain:'libra',ownerScope:{scopeType:'libra_run',scopeId:'run-1'},
  bindingRevision:1,endpointId:'endpoint-1',location:'input.mkv',mountScopeRevision:1,expectedSizeBytes:100,expectedMtimeNs:1,
  expectedCtimeNs:1,hashVerifiedAtMs:1,readScope:'material_read',expiresAtMs:9999999999999,fenceDigest:D('source-fence')});}
function probe(handle,id='probe-1',overrides={}){const value={schemaRef:'helix://contracts/types/MediaProbeEvidence/v1',schemaVersion:1,evidenceId:id,
  evidenceKind:'media_probe',producerRef:'fake-media-port',basisDigest:D(id+'-basis'),payloadDigest:'',observedAtMs:1,
  sourceHandleDigest:canonicalDigest(handle),resultKind:'probed',container:'matroska',durationMs:1000,sizeBytes:handle.sizeBytes??handle.expectedSizeBytes,
  videoStreams:[{streamIndex:0,dispositionDefault:true,codec:'hevc',codedWidth:3840,codedHeight:2160,sampleAspectRatio:'1:1',rotation:0,displayWidth:3840,displayHeight:2160,longEdge:3840,shortEdge:2160}],
  audioStreams:[{streamIndex:1,dispositionDefault:true,codec:'truehd',profile:'truehd',channels:8,channelLayout:'7.1',formatTags:[],normalizedAudioClass:'truehd',language:'eng'}],subtitleStreams:[],...overrides};
  value.payloadDigest=canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key])=>key!=='payloadDigest')));
  return valid('helix://contracts/types/MediaProbeEvidence/v1',value);}
function rootSnapshot(label='root'){return {workspaceRootId:'workspace-root-1',rootRevision:1,endpointId:'endpoint-1',mountScopeId:'mount-1',
  rootLocation:'workspace',containmentDigest:D(label+'-containment'),capacitySnapshotDigest:D(label+'-capacity'),snapshotDigest:D(label)};}
function device(){const value={deviceId:'device-1',deviceClass:'nvidia_nvenc',probeRevision:3,capabilitySchemaRef:'platform.compute-device-capability@1',
  capabilityPayload:{supportedVideoCodecs:['hevc'],supportedRateControlModes:['quality_bound']},capabilityDigest:'',enabled:true,state:'ready'};
  value.capabilityDigest=canonicalDigest(value.capabilityPayload);value.snapshotDigest=canonicalDigest(value);return value;}
function encodeIntent(handle,requirement){return media.buildEncodeIntent({revision:1,libraRunId:'run-1',sourceHandleDigest:canonicalDigest(handle),
  mediaRequirementDigest:requirement.requirementDigest,rateControlMode:'quality_bound',qualityBound:20,deviceClass:'nvidia_nvenc'});}

test('compiles exact media requirements and mutually exclusive production intents',()=>{
  const handle=source(),requirement=media.buildMediaRequirement(spec()),encoded=encodeIntent(handle,requirement),remuxed=media.buildRemuxIntent({revision:1,
    libraRunId:'run-1',sourceHandleDigest:canonicalDigest(handle),mediaRequirementDigest:requirement.requirementDigest});
  valid('helix://contracts/domain-types/MediaRequirement/v1',requirement);
  valid('helix://contracts/domain-types/EncodeIntent/v1',encoded);
  valid('helix://contracts/domain-types/RemuxIntent/v1',remuxed);
  assert.equal(requirement.schemaRef,'MediaRequirement@1');assert.equal(requirement.schemaVersion,undefined);
  assert.equal(encoded.schemaRef,'EncodeIntent@1');assert.equal(encoded.video.targetVideoBitrateBps,null);
  assert.equal(remuxed.schemaRef,'RemuxIntent@1');assert.equal(remuxed.video,undefined);
  assert.throws(()=>media.buildEncodeIntent({revision:1,libraRunId:'run-1',sourceHandleDigest:canonicalDigest(handle),
    mediaRequirementDigest:requirement.requirementDigest,rateControlMode:'quality_bound',qualityBound:64,deviceClass:'nvidia_nvenc'}),
  (error)=>error.code==='P9_MEDIA_RATE_CONTROL');
});

test('freezes transcode verification from the exact probe, intent, and device snapshot',()=>{
  const handle=source(),requirement=media.buildMediaRequirement(spec()),intent=encodeIntent(handle,requirement),snapshot=device();
  const result=media.buildTranscodeInputVerification({sourceHandle:handle,probeEvidence:probe(handle),encodeIntent:intent,deviceSnapshot:snapshot,verifiedAtMs:5});
  valid('helix://contracts/types/TranscodeInputVerification/v1',result);
  assert.equal(result.result,'passed');assert.equal(result.selectedDeviceClass,'nvidia_nvenc');
  const failed=media.buildTranscodeInputVerification({sourceHandle:handle,probeEvidence:probe(handle),encodeIntent:{...intent,deviceClass:'intel_qsv'},deviceSnapshot:snapshot,verifiedAtMs:5});
  assert.equal(failed.result,'failed');assert.deepEqual(failed.reasonCodes,['device_class_mismatch']);
});

test('builds one target-bound workspace result and verifies it without hidden path or device selection',()=>{
  const handle=source(),requirement=media.buildMediaRequirement(spec()),intent=encodeIntent(handle,requirement),snapshot=device(),workspaceId=D('workspace');
  const root=rootSnapshot(),target=media.buildWorkspaceMediaOutputTarget({libraRunId:'run-1',executionBasisDigest:D('basis'),workspaceId,
    expectedWorkspaceRevision:2,expectedWorkspaceStateDigest:D('workspace-state'),rootSnapshot:root,workspaceScopeDigest:D('scope'),
    targetRelativePath:'products/movie.mkv',productionIntentDigest:intent.intentDigest});
  const output={schemaRef:'helix://contracts/types/WorkspaceMaterialHandle/v1',schemaVersion:1,handleId:D('output-handle'),workspaceId,ownerDomain:'libra',processId:'run-1',
    endpointId:'endpoint-1',materialKey:D('output-material'),physicalIdentity:{mountScopeId:'mount-1',inode:'2',contentHashAlgorithm:'sha256',contentHash:D('bytes')},
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

test('evaluates only Primary streams and rejects legacy normalizedClass fixtures',()=>{
  const specValue=spec();specValue.requirements.mandatoryMedia.minimumRasterClass='4k';
  const requirement=media.buildMediaRequirement(specValue),handle=source(),mixedProbe=probe(handle,'mixed-probe',{
    videoStreams:[
      {streamIndex:0,dispositionDefault:true,codec:'h264',codedWidth:1920,codedHeight:1080,sampleAspectRatio:'1:1',rotation:0,displayWidth:1920,displayHeight:1080,longEdge:1920,shortEdge:1080},
      {streamIndex:1,dispositionDefault:false,codec:'hevc',codedWidth:3840,codedHeight:2160,sampleAspectRatio:'1:1',rotation:0,displayWidth:3840,displayHeight:2160,longEdge:3840,shortEdge:2160}],
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
    physicalIdentity:{mountScopeId:'mount-1',inode:'3',contentHashAlgorithm:'sha256',contentHash:D('coordinator-bytes')},rootHandleRef:'root-handle',
    relativePath:target.targetRelativePath,digestAlgorithm:'sha256',digestHex:D('coordinator-bytes'),sizeBytes:100,referenceRevision:1,
    accessScope:'workspace_material_read',fenceDigest:D('coordinator-fence')};
  const receipt={effectId:'effect-1',effectReceiptId:'receipt-1',effectReceiptDigest:D('receipt-1'),effectScopeDigest:target.effectScopeDigest,
    outputTargetId:target.targetId,outputTargetDigest:target.targetDigest,workspaceMaterialHandle};
  const coordinator=createMediaProductionCoordinator({mediaEffectPort:{executeRemux:async()=>receipt,executeTranscode:async()=>receipt}}),
    transcodeInputVerification=media.buildTranscodeInputVerification({sourceHandle:handle,probeEvidence:probe(handle),encodeIntent:intent,deviceSnapshot:snapshot,verifiedAtMs:5});
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
      inode:'4',contentHashAlgorithm:'sha256',contentHash:D('replay-bytes')},rootHandleRef:'root-handle',relativePath:target.targetRelativePath,
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
