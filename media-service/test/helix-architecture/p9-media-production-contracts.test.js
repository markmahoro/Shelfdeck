'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const media=require('../../src/helix/domains/libra/model/media-production-contracts');
const {createMediaProductionCoordinator}=require('../../src/helix/domains/libra/application/media-production-coordinator');

const D=(value)=>canonicalDigest({value});
function spec(){return {schemaRef:'libra.acceptance-spec@1',schemaVersion:1,acceptanceSpecId:'spec-1',specRevision:2,recordDigest:D('spec-record'),
  contentProfile:'movie',structureKind:'single',requirements:{mandatoryMedia:{mediaForm:'stream_file',videoCodec:'hevc',container:'matroska',
    fileExtension:'mkv',minimumRasterClass:'none',acceptedPrimaryAudioClasses:['truehd'],forbidSystemUpscaleFor4k:true},
  space:{unit:'product',maxSizeGiB:1,maxSizeBytes:1073741824}}};}
function source(){return {schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',schemaVersion:1,handleId:D('source-handle'),
  identity:{materialKey:D('material')},ownerDomain:'libra',ownerScope:'run-1',bindingRevision:1,endpointId:'endpoint-1',location:'input.mkv',
  expectedSizeBytes:100,readScope:'material_read',fenceDigest:D('source-fence')};}
function probe(handle,id='probe-1'){return {schemaRef:'helix://contracts/types/MediaProbeEvidence/v1',schemaVersion:1,evidenceId:id,
  evidenceKind:'media_probe',producerRef:'fake-media-port',basisDigest:D(id+'-basis'),payloadDigest:D(id+'-payload'),observedAtMs:1,
  sourceHandleDigest:canonicalDigest(handle),resultKind:'probed',container:'matroska',durationMs:1000,sizeBytes:handle.sizeBytes??handle.expectedSizeBytes,
  videoStreams:[{streamIndex:0,codec:'hevc',codedWidth:3840,codedHeight:2160,sampleAspectRatio:'1:1',rotation:0,displayWidth:3840,displayHeight:2160,longEdge:3840,shortEdge:2160}],
  audioStreams:[{streamIndex:1,codec:'truehd',normalizedClass:'truehd',language:'eng'}],subtitleStreams:[]};}
function device(){const value={deviceId:'device-1',deviceClass:'nvidia_nvenc',probeRevision:3,capabilitySchemaRef:'platform.compute-device-capability@1',
  capabilityPayload:{supportedVideoCodecs:['hevc'],supportedRateControlModes:['quality_bound']},capabilityDigest:'',enabled:true,state:'ready'};
  value.capabilityDigest=canonicalDigest(value.capabilityPayload);value.snapshotDigest=canonicalDigest(value);return value;}
function encodeIntent(handle,requirement){return media.buildEncodeIntent({revision:1,libraRunId:'run-1',sourceHandleDigest:canonicalDigest(handle),
  mediaRequirementDigest:requirement.requirementDigest,rateControlMode:'quality_bound',qualityBound:20,deviceClass:'nvidia_nvenc'});}

test('compiles exact media requirements and mutually exclusive production intents',()=>{
  const handle=source(),requirement=media.buildMediaRequirement(spec()),encoded=encodeIntent(handle,requirement),remuxed=media.buildRemuxIntent({revision:1,
    libraRunId:'run-1',sourceHandleDigest:canonicalDigest(handle),mediaRequirementDigest:requirement.requirementDigest});
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
  assert.equal(result.result,'passed');assert.equal(result.selectedDeviceClass,'nvidia_nvenc');
  const failed=media.buildTranscodeInputVerification({sourceHandle:handle,probeEvidence:probe(handle),encodeIntent:{...intent,deviceClass:'intel_qsv'},deviceSnapshot:snapshot,verifiedAtMs:5});
  assert.equal(failed.result,'failed');assert.deepEqual(failed.reasonCodes,['device_class_mismatch']);
});

test('builds one target-bound workspace result and verifies it without hidden path or device selection',()=>{
  const handle=source(),requirement=media.buildMediaRequirement(spec()),intent=encodeIntent(handle,requirement),snapshot=device(),workspaceId=D('workspace');
  const rootSnapshot={snapshotDigest:D('root')},target=media.buildWorkspaceMediaOutputTarget({libraRunId:'run-1',executionBasisDigest:D('basis'),workspaceId,
    expectedWorkspaceRevision:2,expectedWorkspaceStateDigest:D('workspace-state'),rootSnapshot,workspaceScopeDigest:D('scope'),
    targetRelativePath:'products/movie.mkv',productionIntentDigest:intent.intentDigest});
  const output={schemaRef:'helix://contracts/types/WorkspaceMaterialHandle/v1',schemaVersion:1,handleId:D('output-handle'),workspaceId,ownerDomain:'libra',processId:'run-1',
    endpointId:'endpoint-1',materialKey:D('output-material'),physicalIdentity:{mountScopeId:'mount-1',inode:'2',contentHashAlgorithm:'sha256',contentHash:D('bytes')},
    rootHandleRef:'root-handle',relativePath:'products/movie.mkv',digestAlgorithm:'sha256',digestHex:D('bytes'),sizeBytes:100,referenceRevision:1,
    accessScope:'workspace_material_read',fenceDigest:D('output-fence')};
  const result=media.buildWorkspaceMediaHandle({sourceHandle:handle,outputTarget:target,workspaceMaterialHandle:output,productionIntentKind:'encode',productionIntent:intent,
    deviceSnapshot:snapshot,producingEventId:'event-1',effectReceipt:{effectId:'effect-1',effectReceiptId:'receipt-1',effectReceiptDigest:D('receipt'),effectScopeDigest:target.effectScopeDigest}});
  assert.equal(result.workspaceMaterialHandle.handleId,output.handleId);assert.equal(result.outputTargetId,target.targetId);
  const input=media.buildProductMediaCandidateInput({candidateKind:'workspace_output',candidateNodeId:'node-1',libraRunId:'run-1',mediaRequirement:requirement,
    workspaceMediaHandle:result,sourceProbeEvidence:probe(handle,'source-probe'),outputProbeEvidence:probe(output,'output-probe')});
  const verification=media.buildProductMediaVerification({input,verifiedAtMs:9});
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
  assert.equal(selected.selectedVerificationId,b.verificationId);assert.equal(selected.selectionReasonCode,'selected_by_declared_rank');
});

test('coordinator accepts only a receipt bound to the frozen target and a passed transcode verification',async()=>{
  const handle=source(),requirement=media.buildMediaRequirement(spec()),intent=encodeIntent(handle,requirement),snapshot=device(),workspaceId=D('workspace-coordinator');
  const target=media.buildWorkspaceMediaOutputTarget({libraRunId:'run-1',executionBasisDigest:D('basis'),workspaceId,
    expectedWorkspaceRevision:2,expectedWorkspaceStateDigest:D('workspace-state'),rootSnapshot:{snapshotDigest:D('root')},workspaceScopeDigest:D('scope'),
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
      expectedWorkspaceRevision:2,expectedWorkspaceStateDigest:D('workspace-state-replay'),rootSnapshot:{snapshotDigest:D('root-replay')},
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
