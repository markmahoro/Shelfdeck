'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');

class MediaProductionContractError extends Error {
  constructor(code, message) { super(message); this.name = 'MediaProductionContractError'; this.code = code; }
}
const fail = (code, message) => { throw new MediaProductionContractError(code, message); };
const DIGEST = /^[a-f0-9]{64}$/;
const text = (value, name) => { if (typeof value !== 'string' || !value) fail('P9_MEDIA_VALUE', name + ' is required.'); return value; };
const digest = (value, name) => { if (!DIGEST.test(value || '')) fail('P9_MEDIA_DIGEST', name + ' is invalid.'); return value; };
const integer = (value, name, minimum = 0) => { if (!Number.isSafeInteger(value) || value < minimum) fail('P9_MEDIA_NUMBER', name + ' is invalid.'); return value; };
const sortedUnique = (values, name) => {
  if (!Array.isArray(values) || new Set(values).size !== values.length || values.some((item) => typeof item !== 'string' || !item))
    fail('P9_MEDIA_SET', name + ' must be a unique string array.');
  const sorted = [...values].sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
  if (canonicalJson(values) !== canonicalJson(sorted)) fail('P9_MEDIA_SET_ORDER', name + ' must use UTF-8 byte order.');
  return Object.freeze(sorted);
};
const freeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
};
const limited = (value, maximum, code) => {
  if (Buffer.byteLength(canonicalJson(value), 'utf8') > maximum) fail(code, 'Canonical value exceeds its contract bound.');
  return freeze(value);
};

function buildMediaRequirement(spec) {
  if (!spec || spec.schemaRef !== 'libra.acceptance-spec@1' || spec.schemaVersion !== 1 ||
      !['movie', 'series', 'jav', 'western_adult'].includes(spec.contentProfile) || !['single', 'season'].includes(spec.structureKind))
    fail('P9_MEDIA_SPEC', 'Acceptance Spec is not the immutable accepted contract.');
  const requirements = spec.requirements;
  if (!requirements?.mandatoryMedia || !requirements?.space) fail('P9_MEDIA_SPEC', 'Acceptance Spec lacks media or space requirements.');
  const result = { requirementId:'', revision:integer(spec.specRevision, 'specRevision', 1), schemaRef:'libra.media-requirement@1', schemaVersion:1,
    acceptanceSpecId:text(spec.acceptanceSpecId, 'acceptanceSpecId'), acceptanceSpecRecordDigest:digest(spec.recordDigest, 'recordDigest'),
    contentProfile:spec.contentProfile, structureKind:spec.structureKind,
    mandatoryMedia:JSON.parse(canonicalJson(requirements.mandatoryMedia)), space:JSON.parse(canonicalJson(requirements.space)) };
  result.requirementId = canonicalDigest({ schema:'libra.media-requirement-id@1', acceptanceSpecId:result.acceptanceSpecId,
    revision:result.revision, mandatoryMedia:result.mandatoryMedia, space:result.space });
  result.requirementDigest = canonicalDigest(result);
  return limited(result, 16 * 1024, 'P9_MEDIA_REQUIREMENT_SIZE');
}

function validateDeviceSnapshot(value) {
  if (!value || !['software_cpu','intel_qsv','nvidia_nvenc','amd_vaapi','remote_worker'].includes(value.deviceClass) ||
      value.enabled !== true || value.state !== 'ready' || canonicalDigest(value.capabilityPayload) !== value.capabilityDigest)
    fail('P9_MEDIA_DEVICE', 'Device Snapshot is unavailable or has invalid capability continuity.');
  digest(value.snapshotDigest, 'deviceSnapshotDigest');
  if (canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'snapshotDigest'))) !== value.snapshotDigest)
    fail('P9_MEDIA_DEVICE', 'Device Snapshot digest is invalid.');
  return value;
}

function buildTranscodeInputVerification(value) {
  const sourceHandleDigest = canonicalDigest(value.sourceHandle), intent = value.encodeIntent, probe = value.probeEvidence,
    device = validateDeviceSnapshot(value.deviceSnapshot), reasons = [];
  if (probe?.sourceHandleDigest !== sourceHandleDigest) reasons.push('source_handle_mismatch');
  if (probe?.resultKind !== 'probed') reasons.push(probe?.resultKind === 'not_media' ? 'source_not_media' : 'probe_integrity_failure');
  if (intent?.sourceHandleDigest !== sourceHandleDigest) reasons.push('input_fence_mismatch');
  if (intent?.deviceClass !== device.deviceClass) reasons.push('device_class_mismatch');
  const codecs = device.capabilityPayload?.supportedVideoCodecs || [], modes = device.capabilityPayload?.supportedRateControlModes || [];
  if (!codecs.includes(intent?.video?.codec) || !modes.includes(intent?.video?.rateControlMode)) reasons.push('encode_intent_unsupported');
  const reasonCodes = Object.freeze([...new Set(reasons)]), probeEvidenceDigest = canonicalDigest(probe),
    encodeIntentDigest = digest(intent?.intentDigest, 'encodeIntentDigest'), deviceSnapshotDigest = device.snapshotDigest;
  const basisDigest = canonicalDigest({ schema:'libra.transcode-input-verification-basis@1', sourceHandleDigest,
    encodeIntentDigest, probeEvidenceDigest, deviceSnapshotDigest });
  const result = { schemaRef:'helix://contracts/types/TranscodeInputVerification/v1', schemaVersion:1,
    verificationId:canonicalDigest({ schema:'libra.transcode-input-verification-id@1', basisDigest }),
    verificationKind:'libra_transcode_input', basisDigest, result:reasonCodes.length ? 'failed' : 'passed', reasonCodes,
    evidenceRefs:Object.freeze([text(probe.evidenceId, 'probeEvidenceId')]), verifiedAtMs:integer(value.verifiedAtMs, 'verifiedAtMs'),
    sourceHandleDigest, encodeIntentDigest, probeEvidenceId:probe.evidenceId, probeEvidenceDigest,
    deviceId:text(device.deviceId, 'deviceId'), deviceSnapshotDigest, selectedDeviceClass:device.deviceClass };
  return limited(result, 16 * 1024, 'P9_TRANSCODE_VERIFICATION_SIZE');
}

function buildWorkspaceMediaOutputTarget(value) {
  const target = { schemaRef:'helix://contracts/domain-types/WorkspaceMediaOutputTarget/v1', schemaVersion:1,
    targetId:'', libraRunId:text(value.libraRunId, 'libraRunId'), executionBasisDigest:digest(value.executionBasisDigest, 'executionBasisDigest'),
    workspaceId:digest(value.workspaceId, 'workspaceId'), expectedWorkspaceRevision:integer(value.expectedWorkspaceRevision, 'expectedWorkspaceRevision', 1),
    expectedWorkspaceStateDigest:digest(value.expectedWorkspaceStateDigest, 'expectedWorkspaceStateDigest'), rootSnapshot:value.rootSnapshot,
    workspaceScopeDigest:digest(value.workspaceScopeDigest, 'workspaceScopeDigest'), targetRelativePath:text(value.targetRelativePath, 'targetRelativePath'),
    outputRole:'product_media', productionIntentDigest:digest(value.productionIntentDigest, 'productionIntentDigest') };
  if (/^(?:[a-zA-Z]:|[\\/])/.test(target.targetRelativePath) || target.targetRelativePath.split(/[\\/]/).some((part) => part === '..' || part === '.'))
    fail('P9_MEDIA_TARGET_PATH', 'Output target must stay inside the Workspace root.');
  target.targetId = canonicalDigest({ schema:'libra.workspace-media-output-target-id@1', workspaceId:target.workspaceId,
    targetRelativePath:target.targetRelativePath, productionIntentDigest:target.productionIntentDigest });
  target.effectScopeDigest = canonicalDigest({ schema:'libra.workspace-media-output-effect-scope@1', targetId:target.targetId,
    libraRunId:target.libraRunId, executionBasisDigest:target.executionBasisDigest, workspaceId:target.workspaceId,
    expectedWorkspaceRevision:target.expectedWorkspaceRevision, expectedWorkspaceStateDigest:target.expectedWorkspaceStateDigest,
    rootSnapshotDigest:digest(target.rootSnapshot?.snapshotDigest, 'rootSnapshotDigest'), workspaceScopeDigest:target.workspaceScopeDigest });
  target.targetDigest = canonicalDigest(target);
  return limited(target, 16 * 1024, 'P9_MEDIA_TARGET_SIZE');
}

function buildWorkspaceMediaHandle(value) {
  const target = value.outputTarget, handle = value.workspaceMaterialHandle, intent = value.productionIntent,
    sourceMaterialHandleDigest = canonicalDigest(value.sourceHandle);
  if (!target || target.productionIntentDigest !== intent?.intentDigest || handle?.workspaceId !== target.workspaceId ||
      handle?.relativePath !== target.targetRelativePath || value.effectReceipt?.effectScopeDigest !== target.effectScopeDigest)
    fail('P9_MEDIA_OUTPUT_CONTINUITY', 'Workspace output does not match its frozen target and Effect scope.');
  const kind = value.productionIntentKind;
  if (!['remux','encode'].includes(kind) || (kind === 'encode') !== Boolean(value.deviceSnapshot)) fail('P9_MEDIA_OUTPUT_KIND', 'Production intent kind is invalid.');
  const executionDeviceRef = kind === 'encode' ? { deviceId:value.deviceSnapshot.deviceId, deviceClass:value.deviceSnapshot.deviceClass,
    deviceSnapshotDigest:value.deviceSnapshot.snapshotDigest } : null;
  const result = { schemaRef:'helix://contracts/types/WorkspaceMediaHandle/v1', schemaVersion:1, workspaceMediaHandleId:'',
    sourceMaterialHandleDigest, workspaceMaterialHandle:handle, workspaceMaterialHandleDigest:canonicalDigest(handle),
    outputTargetId:target.targetId, outputTargetDigest:target.targetDigest, producingEventId:text(value.producingEventId, 'producingEventId'),
    productionIntentKind:kind, productionIntentDigest:intent.intentDigest, executionDeviceRef,
    effectReceiptRef:{ effectId:text(value.effectReceipt.effectId, 'effectId'), effectReceiptId:text(value.effectReceipt.effectReceiptId, 'effectReceiptId'),
      effectReceiptDigest:digest(value.effectReceipt.effectReceiptDigest, 'effectReceiptDigest') } };
  result.workspaceMediaHandleId = canonicalDigest({ schema:'libra.workspace-media-handle-id@1', sourceMaterialHandleDigest,
    workspaceMaterialHandleId:handle.handleId, outputTargetId:result.outputTargetId, producingEventId:result.producingEventId,
    productionIntentDigest:result.productionIntentDigest, executionDeviceRefOrNull:executionDeviceRef });
  result.resultDigest = canonicalDigest(result);
  return limited(result, 16 * 1024, 'P9_WORKSPACE_MEDIA_HANDLE_SIZE');
}

function buildProductMediaCandidateInput(value) {
  const requirement = value.mediaRequirement, kind = value.candidateKind;
  if (!['direct_input','workspace_output'].includes(kind)) fail('P9_MEDIA_CANDIDATE_KIND', 'Candidate kind is invalid.');
  const common = { schemaRef:'helix://contracts/domain-types/ProductMediaCandidateInput/v1', schemaVersion:1, candidateId:'',
    candidateNodeId:text(value.candidateNodeId, 'candidateNodeId'), candidateBasisDigest:'', libraRunId:text(value.libraRunId, 'libraRunId'),
    mediaRequirement:requirement, candidateKind:kind };
  let result;
  if (kind === 'direct_input') {
    common.candidateBasisDigest = canonicalDigest(value.sourceMaterialHandle);
    result = { ...common, sourceMaterialHandle:value.sourceMaterialHandle, sourceProbeEvidence:value.sourceProbeEvidence };
  } else {
    const workspace = value.workspaceMediaHandle;
    common.candidateBasisDigest = canonicalDigest({ schema:'libra.workspace-product-candidate-basis@1', outputTargetId:workspace.outputTargetId,
      outputTargetDigest:workspace.outputTargetDigest, productionIntentDigest:workspace.productionIntentDigest });
    result = { ...common, workspaceMediaHandle:workspace, sourceProbeEvidence:value.sourceProbeEvidence, outputProbeEvidence:value.outputProbeEvidence };
  }
  result.candidateId = canonicalDigest({ schema:'libra.product-media-candidate-id@1', candidateNodeId:common.candidateNodeId,
    candidateKind:kind, candidateBasisDigest:common.candidateBasisDigest, mediaRequirementDigest:requirement.requirementDigest });
  result.inputDigest = canonicalDigest(result);
  return limited(result, 64 * 1024, 'P9_MEDIA_CANDIDATE_SIZE');
}

function rasterClass(probe) {
  const streams = probe?.videoStreams || [], maximum = streams.reduce((result, item) => Math.max(result, item.longEdge || 0), 0);
  return maximum >= 3840 ? '4k' : maximum > 0 ? 'below_4k' : 'none';
}
function primaryAudioClasses(probe) { return sortedUnique((probe?.audioStreams || []).map((item) => item.normalizedClass || item.codec), 'primaryAudioClasses'); }

function buildProductMediaVerification(value) {
  const input = value.input, requirement = input.mediaRequirement, mandatory = requirement.mandatoryMedia, outputProbe =
    input.candidateKind === 'direct_input' ? input.sourceProbeEvidence : input.outputProbeEvidence,
    handle = input.candidateKind === 'direct_input' ? input.sourceMaterialHandle : input.workspaceMediaHandle.workspaceMaterialHandle;
  const reasons = [];
  if (outputProbe?.sourceHandleDigest !== canonicalDigest(handle)) reasons.push('output_handle_mismatch');
  if (outputProbe?.resultKind !== 'probed') reasons.push('output_not_media');
  if (mandatory.mediaForm === 'stream_file' && outputProbe?.discTopology) reasons.push('media_form_unmet');
  const videoCodec = outputProbe?.videoStreams?.[0]?.codec || 'none', container = outputProbe?.container || 'none', extension = (handle.relativePath || handle.location || '').split('.').pop().toLowerCase();
  if (mandatory.videoCodec !== 'any' && videoCodec !== mandatory.videoCodec) reasons.push('video_codec_unmet');
  if (mandatory.container !== 'any' && container !== mandatory.container) reasons.push('container_unmet');
  if (mandatory.fileExtension !== 'any' && extension !== mandatory.fileExtension) reasons.push('file_extension_unmet');
  const outputRaster = rasterClass(outputProbe), sourceRaster = rasterClass(input.sourceProbeEvidence);
  if (mandatory.minimumRasterClass === '4k' && outputRaster !== '4k') reasons.push('minimum_raster_unmet');
  if (mandatory.forbidSystemUpscaleFor4k && outputRaster === '4k' && sourceRaster !== '4k') reasons.push('system_upscale_forbidden');
  const audio = primaryAudioClasses(outputProbe), accepted = mandatory.acceptedPrimaryAudioClasses || [];
  if (accepted.length && !audio.some((item) => accepted.includes(item))) reasons.push('primary_audio_unmet');
  const actualSizeBytes=handle.sizeBytes??handle.expectedSizeBytes,maxSizeBytes = requirement.space.maxSizeBytes,
    withinLimit = maxSizeBytes === null || maxSizeBytes === undefined || actualSizeBytes <= maxSizeBytes;
  if (!withinLimit) reasons.push('max_size_exceeded');
  const reasonCodes = Object.freeze([...new Set(reasons)]), productMaterialHandleDigest = canonicalDigest(handle),
    productMaterialFenceDigest = digest(handle.fenceDigest, 'productMaterialFenceDigest'), sourceProbeEvidenceDigest = canonicalDigest(input.sourceProbeEvidence),
    outputProbeEvidenceDigest = canonicalDigest(outputProbe);
  const result = { schemaRef:'helix://contracts/types/ProductMediaVerification/v1',schemaVersion:1,verificationId:'',
    verificationKind:'libra_product_media',basisDigest:input.inputDigest,result:reasonCodes.length?'failed':'passed',reasonCodes,
    evidenceRefs:Object.freeze([input.sourceProbeEvidence.evidenceId, outputProbe.evidenceId]),verifiedAtMs:integer(value.verifiedAtMs,'verifiedAtMs'),
    candidateId:input.candidateId,candidateNodeId:input.candidateNodeId,candidateBasisDigest:input.candidateBasisDigest,candidateKind:input.candidateKind,
    libraRunId:input.libraRunId,producingEventId:input.candidateKind==='workspace_output'?input.workspaceMediaHandle.producingEventId:null,
    productMaterialHandleId:handle.handleId,productMaterialHandleDigest,productMaterialFenceDigest,
    workspaceMediaHandleId:input.candidateKind==='workspace_output'?input.workspaceMediaHandle.workspaceMediaHandleId:null,
    mediaRequirementId:requirement.requirementId,mediaRequirementDigest:requirement.requirementDigest,
    sourceProbeEvidenceId:input.sourceProbeEvidence.evidenceId,sourceProbeEvidenceDigest,
    outputProbeEvidenceId:outputProbe.evidenceId,outputProbeEvidenceDigest,
    qualitySummary:{videoCodec,container,fileExtension:extension,displayRasterClass:outputRaster,primaryAudioClasses:audio,
      sourceDisplayRasterClass:sourceRaster,systemUpscaleDetected:outputRaster==='4k'&&sourceRaster!=='4k'},
    spaceSummary:{unit:requirement.space.unit,actualSizeBytes,maxSizeBytes:maxSizeBytes??null,withinLimit} };
  result.verificationId=canonicalDigest({schema:'libra.product-media-verification-id@1',candidateId:result.candidateId,candidateNodeId:result.candidateNodeId,
    candidateBasisDigest:result.candidateBasisDigest,candidateKind:result.candidateKind,libraRunId:result.libraRunId,
    productMaterialHandleId:result.productMaterialHandleId,productMaterialFenceDigest,mediaRequirementDigest:result.mediaRequirementDigest,
    sourceProbeEvidenceDigest,outputProbeEvidenceDigest});
  return limited(result,16*1024,'P9_PRODUCT_MEDIA_VERIFICATION_SIZE');
}

function buildProductOutputSelectionInput(value) {
  const ranked = value.rankedCandidates.map((item,index)=>({rank:index+1,candidateId:text(item.candidateId,'candidateId'),candidateNodeId:text(item.candidateNodeId,'candidateNodeId')}));
  if (!ranked.length || ranked.length>32 || value.rankedCandidates.some((item,index)=>item.rank!==index+1) ||
      new Set(ranked.map((item)=>item.candidateId)).size!==ranked.length || new Set(ranked.map((item)=>item.candidateNodeId)).size!==ranked.length)
    fail('P9_OUTPUT_CRITERIA','Output criteria must be a complete unique rank sequence.');
  const criteria={criteriaId:'',libraRunId:text(value.libraRunId,'libraRunId'),acceptanceSpecId:text(value.acceptanceSpecId,'acceptanceSpecId'),
    acceptanceSpecRecordDigest:digest(value.acceptanceSpecRecordDigest,'acceptanceSpecRecordDigest'),mediaRequirementDigest:digest(value.mediaRequirementDigest,'mediaRequirementDigest'),
    rankedCandidates:Object.freeze(ranked),tieBreak:'verification_id_utf8'};
  criteria.criteriaId=canonicalDigest({schema:'libra.product-output-selection-criteria-id@1',libraRunId:criteria.libraRunId,
    acceptanceSpecId:criteria.acceptanceSpecId,mediaRequirementDigest:criteria.mediaRequirementDigest,rankedCandidates:criteria.rankedCandidates});
  criteria.criteriaDigest=canonicalDigest(criteria);
  const candidates=[...value.candidates].sort((a,b)=>Buffer.from(a.verificationId).compare(Buffer.from(b.verificationId)));
  if(canonicalJson(candidates)!==canonicalJson(value.candidates)||candidates.length!==ranked.length||candidates.some((item)=>
    !ranked.some((rank)=>rank.candidateId===item.candidateId&&rank.candidateNodeId===item.candidateNodeId))) fail('P9_OUTPUT_CANDIDATES','Candidate set does not match criteria.');
  const result={schemaRef:'helix://contracts/domain-types/ProductOutputSelectionInput/v1',schemaVersion:1,criteria,
    candidates:Object.freeze(candidates),candidateSetDigest:canonicalDigest({schema:'libra.product-media-verification-set@1',items:candidates})};
  result.inputDigest=canonicalDigest(result);return limited(result,512*1024,'P9_OUTPUT_INPUT_SIZE');
}

function selectProductOutput(value) {
  const input=value.input, rank=new Map(input.criteria.rankedCandidates.map((item)=>[item.candidateId,item.rank]));
  const passed=input.candidates.filter((item)=>item.result==='passed').sort((a,b)=>rank.get(a.candidateId)-rank.get(b.candidateId)||Buffer.from(a.verificationId).compare(Buffer.from(b.verificationId))), selected=passed[0]||null;
  const result={schemaRef:'helix://contracts/types/SelectedProductOutput/v1',schemaVersion:1,draftId:'',draftKind:'selected_product_output',
    basisDigest:input.inputDigest,draftDigest:'',producedAtMs:integer(value.producedAtMs,'producedAtMs'),libraRunId:input.criteria.libraRunId,
    acceptanceSpecId:input.criteria.acceptanceSpecId,mediaRequirementDigest:input.criteria.mediaRequirementDigest,criteriaId:input.criteria.criteriaId,
    criteriaDigest:input.criteria.criteriaDigest,candidateSetDigest:input.candidateSetDigest,result:selected?'selected':'not_selected',
    selectedCandidateKind:selected?.candidateKind??null,selectedHandleId:selected?.productMaterialHandleId??null,
    selectedWorkspaceMediaHandleId:selected?.workspaceMediaHandleId??null,selectedVerificationId:selected?.verificationId??null,
    selectedVerificationDigest:selected?canonicalDigest(selected):null,selectionReasonCode:selected?'selected_by_declared_rank':'no_passed_candidate'};
  result.draftId=canonicalDigest({schema:'libra.selected-product-output-id@1',libraRunId:result.libraRunId,criteriaId:result.criteriaId,candidateSetDigest:result.candidateSetDigest});
  const draftValue={...result};delete draftValue.draftDigest;result.draftDigest=canonicalDigest(draftValue);
  return limited(result,16*1024,'P9_SELECTED_OUTPUT_SIZE');
}

module.exports=Object.freeze({MediaProductionContractError,buildMediaRequirement,buildTranscodeInputVerification,
  buildWorkspaceMediaOutputTarget,buildWorkspaceMediaHandle,buildProductMediaCandidateInput,buildProductMediaVerification,
  buildProductOutputSelectionInput,selectProductOutput});
