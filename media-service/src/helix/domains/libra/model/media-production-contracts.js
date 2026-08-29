'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');

class MediaProductionContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MediaProductionContractError';
    this.code = code;
    this.details = details;
  }
}
const fail = (code, message, details) => { throw new MediaProductionContractError(code, message, details); };
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

const LIBRA_MEDIA_PLANNING_POLICY = freeze({
  schemaRef:'LibraMediaPlanningPolicy@1', revision:2,
  ordinaryDeviceOrder:Object.freeze(['nvidia_nvenc','intel_qsv','amd_vaapi','remote_worker']),
  cpuPolicy:'backup_only', sizeBudgetRevision:1,
  strategyLadder:Object.freeze(['controlled_vbr','device_cbr','cpu_two_pass_abr','cpu_strict_abr']),
  dolbyVisionTranscodePolicy:'compatible_bl_to_sdr_bt709_8bit_hevc'
});
const LIBRA_MEDIA_PLANNING_POLICY_DIGEST = canonicalDigest(LIBRA_MEDIA_PLANNING_POLICY);

function buildMediaRequirement(spec) {
  if (!spec || spec.schemaRef !== 'libra.acceptance-spec@1' || spec.schemaVersion !== 1 ||
      !['movie', 'series', 'jav', 'western_adult'].includes(spec.contentProfile) || !['single', 'season'].includes(spec.structureKind))
    fail('P9_MEDIA_SPEC', 'Acceptance Spec is not the immutable accepted contract.');
  const requirements = spec.requirements;
  if (!requirements?.mandatoryMedia || !requirements?.space) fail('P9_MEDIA_SPEC', 'Acceptance Spec lacks media or space requirements.');
  const mandatoryMedia=JSON.parse(canonicalJson(requirements.mandatoryMedia)),space=JSON.parse(canonicalJson(requirements.space));
  sortedUnique(mandatoryMedia.acceptedPrimaryAudioClasses, 'acceptedPrimaryAudioClasses');
  const hasLimit=space.maxSizeGiB!==null||space.maxSizeBytes!==null;
  if((space.maxSizeGiB===null)!==(space.maxSizeBytes===null)||
      (hasLimit&&(!Number.isSafeInteger(space.maxSizeGiB)||space.maxSizeGiB<1||space.maxSizeBytes!==space.maxSizeGiB*1073741824)))
    fail('P9_MEDIA_REQUIREMENT_SPACE','Media Requirement space limit is not exact.');
  const result = { requirementId:'', revision:integer(spec.specRevision, 'specRevision', 1), schemaRef:'MediaRequirement@1',
    acceptanceSpecId:text(spec.acceptanceSpecId, 'acceptanceSpecId'), acceptanceSpecRecordDigest:digest(spec.recordDigest, 'recordDigest'),
    contentProfile:spec.contentProfile, structureKind:spec.structureKind,
    mandatoryMedia, space };
  result.requirementId = canonicalDigest({ schema:'libra.media-requirement-id@1', acceptanceSpecId:result.acceptanceSpecId,
    revision:result.revision, mandatoryMedia:result.mandatoryMedia, space:result.space });
  result.requirementDigest = canonicalDigest(result);
  return limited(result, 16 * 1024, 'P9_MEDIA_REQUIREMENT_SIZE');
}

function assertExactMediaRequirement(value) {
  const rebuilt=buildMediaRequirement({schemaRef:'libra.acceptance-spec@1',schemaVersion:1,specRevision:value?.revision,
    acceptanceSpecId:value?.acceptanceSpecId,recordDigest:value?.acceptanceSpecRecordDigest,contentProfile:value?.contentProfile,
    structureKind:value?.structureKind,requirements:{mandatoryMedia:value?.mandatoryMedia,space:value?.space}});
  if(canonicalJson(rebuilt)!==canonicalJson(value))fail('P9_MEDIA_REQUIREMENT_INTEGRITY','Media Requirement identity or digest is invalid.');
  return value;
}

function assertProbeEvidence(value) {
  if(!value||value.schemaRef!=='helix://contracts/types/MediaProbeEvidence/v1'||value.schemaVersion!==1||
      !Array.isArray(value.videoStreams)||!Array.isArray(value.audioStreams)||!Array.isArray(value.subtitleStreams))
    fail('P9_MEDIA_PROBE_INTEGRITY','Media Probe Evidence shape is invalid.');
  for(const streams of [value.videoStreams,value.audioStreams,value.subtitleStreams]){
    if(new Set(streams.map((item)=>item.streamIndex)).size!==streams.length||streams.some((item,index)=>index&&item.streamIndex<=streams[index-1].streamIndex))
      fail('P9_MEDIA_PROBE_INTEGRITY','Media Probe streams must be unique and sorted by streamIndex.');
  }
  if(value.videoStreams.some((item)=>typeof item.dispositionDefault!=='boolean')||value.audioStreams.some((item)=>
    typeof item.dispositionDefault!=='boolean'||!['eac3_atmos','truehd','truehd_atmos','dts_hd_ma','dts_x','other'].includes(item.normalizedAudioClass)))
    fail('P9_MEDIA_PROBE_INTEGRITY','Media Probe primary stream facts are incomplete.');
  for(const stream of value.videoStreams){
    if(!['sdr','hdr10_compatible','hlg','dolby_vision','unknown'].includes(stream.dynamicRangeKind)||
        !Number.isSafeInteger(stream.bitDepth)||stream.bitDepth<1||typeof stream.pixelFormat!=='string'||!stream.pixelFormat)
      fail('P9_MEDIA_PROBE_INTEGRITY','Media Probe video technical facts are incomplete.');
    if(stream.dynamicRangeKind==='dolby_vision'){
      const dv=stream.dolbyVision;
      if(!dv||!Number.isSafeInteger(dv.profile)||!Number.isSafeInteger(dv.level)||typeof dv.blPresent!=='boolean'||
          !['pq_bt2020_compatible','non_compatible','unknown'].includes(dv.baseLayerKind))
        fail('P9_MEDIA_PROBE_INTEGRITY','Dolby Vision evidence is incomplete.');
    }else if(stream.dolbyVision!==undefined)fail('P9_MEDIA_PROBE_INTEGRITY','Non-Dolby stream cannot carry Dolby Vision evidence.');
  }
  if(value.resultKind==='probed'){
    if(!value.container||!Number.isSafeInteger(value.durationMs)||value.durationMs<0||value.reasonCode!==undefined)
      fail('P9_MEDIA_PROBE_INTEGRITY','Probed Evidence branch is invalid.');
  }else if(value.resultKind!=='not_media'||value.reasonCode!=='probe_not_media'||value.videoStreams.length||value.audioStreams.length||value.subtitleStreams.length){
    fail('P9_MEDIA_PROBE_INTEGRITY','Not-media Evidence branch is invalid.');
  }
  const withoutPayload=Object.fromEntries(Object.entries(value).filter(([key])=>key!=='payloadDigest'));
  if(canonicalDigest(withoutPayload)!==value.payloadDigest)fail('P9_MEDIA_PROBE_INTEGRITY','Media Probe payload digest is invalid.');
  return value;
}

function finalizeProductionIntent(value) {
  const semanticIntent = Object.fromEntries(Object.entries(value).filter(([key]) => !['intentId','intentDigest'].includes(key)));
  value.intentId = canonicalDigest({ schema:'libra.media-production-intent-id@1', semanticIntent });
  value.intentDigest = canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'intentDigest')));
  return limited(value, 16 * 1024, 'P9_MEDIA_INTENT_SIZE');
}

function buildProductionSourceScopeReference(value) {
  const scopeKind=value?.scopeKind;
  if(!['stream_file','bdmv','dvd','iso'].includes(scopeKind))fail('P9_MEDIA_SOURCE_SCOPE_KIND','Production source scope kind is invalid.');
  const memberCount=integer(value.memberCount,'memberCount',1);
  if(memberCount>1024||(scopeKind==='stream_file'||scopeKind==='iso')&&memberCount!==1)
    fail('P9_MEDIA_SOURCE_SCOPE_MEMBERS','Production source scope member count is invalid.');
  const result={schemaRef:'ProductionSourceScopeReference@1',schemaVersion:1,libraRunId:text(value.libraRunId,'libraRunId'),
    scopeKind,scopeId:text(value.scopeId,'scopeId'),scopeDigest:digest(value.scopeDigest,'scopeDigest'),
    memberSetDigest:digest(value.memberSetDigest,'memberSetDigest'),memberCount,
    selectedPayloadSetDigest:digest(value.selectedPayloadSetDigest,'selectedPayloadSetDigest')};
  result.sourceReferenceDigest=canonicalDigest(result);
  return limited(result,16*1024,'P9_MEDIA_SOURCE_SCOPE_SIZE');
}

const SIZE_BUDGET_HIGH_BITRATE_AUDIO = Object.freeze(['dts_hd_ma', 'dts_x', 'truehd', 'truehd_atmos']);
const STAR_SIZE_GIB = Object.freeze([2, 4, 8, 14, 50]);
const VIDEO_BITRATE_FLOOR_BELOW_4K_BPS = Object.freeze([
  1_500_000, 2_000_000, 2_500_000, 4_000_000, 15_000_000,
]);
const VIDEO_BITRATE_FLOOR_4K_BPS = Object.freeze([
  8_000_000, 8_000_000, 10_000_000, 12_000_000, 15_000_000,
]);

function starIndexFromMaxSizeBytes(maxSizeBytes) {
  const gib = Number(maxSizeBytes) / 1073741824;
  const index = STAR_SIZE_GIB.findIndex((item) => Math.abs(item - gib) < 1e-9);
  return index >= 0 ? index : 2;
}

function videoBitrateFloorBps(maxSizeBytes, rasterClassValue) {
  const index = starIndexFromMaxSizeBytes(maxSizeBytes);
  return rasterClassValue === '4k'
    ? VIDEO_BITRATE_FLOOR_4K_BPS[index]
    : VIDEO_BITRATE_FLOOR_BELOW_4K_BPS[index];
}

function predictedProductBytes(value) {
  const durationSeconds = Number(value?.durationMs) / 1000;
  const video = Number(value?.targetVideoBitrateBps);
  const nonVideo = Number(value?.nonVideoBitrateBps);
  const reserve = Number(value?.containerReserveBytes) || 0;
  if (!(durationSeconds > 0) || !Number.isSafeInteger(video) || video < 1 ||
      !Number.isSafeInteger(nonVideo) || nonVideo < 0) return null;
  return Math.ceil(((video + nonVideo) * durationSeconds) / 8) + reserve;
}

function estimatedAudioBitrateBps(stream) {
  if (Number.isSafeInteger(stream?.bitRateBps) && stream.bitRateBps > 0) return stream.bitRateBps;
  return SIZE_BUDGET_HIGH_BITRATE_AUDIO.includes(stream?.normalizedAudioClass) ? 8000000 : 1536000;
}

function uniqueIncreasingIndexes(values, name) {
  if (!Array.isArray(values) || !values.length || values.length > 64 ||
      values.some((item, index) => !Number.isSafeInteger(item) || item < 0 || (index && item <= values[index - 1])))
    fail('P9_MEDIA_STREAM_INDEXES', name + ' must be a strictly increasing integer array.');
  return Object.freeze([...values]);
}

function sameAudioSet(left, right) {
  return left.length === right.length && left.every((item, index) => item.streamIndex === right[index].streamIndex);
}

function preferRetainedPrimaryAudio(audioStreams, acceptedPrimaryAudioClasses) {
  const ordered = [...audioStreams].sort((a, b) => a.streamIndex - b.streamIndex);
  if (!ordered.length) return Object.freeze([]);
  const defaults = ordered.filter((item) => item.dispositionDefault === true);
  const accepted = Array.isArray(acceptedPrimaryAudioClasses) ? acceptedPrimaryAudioClasses : [];
  if (accepted.length) {
    const qualifying = ordered.filter((item) => accepted.includes(item.normalizedAudioClass));
    if (qualifying.length) {
      const defaultQualifying = qualifying.filter((item) => item.dispositionDefault === true);
      return Object.freeze(defaultQualifying.length ? defaultQualifying.slice(0, 1) : qualifying.slice(0, 1));
    }
  }
  const highBitrate = ordered.filter((item) => SIZE_BUDGET_HIGH_BITRATE_AUDIO.includes(item.normalizedAudioClass));
  const defaultHigh = highBitrate.filter((item) => item.dispositionDefault === true);
  if (defaultHigh.length) return Object.freeze(defaultHigh.slice(0, 1));
  if (highBitrate.length) return Object.freeze(highBitrate.slice(0, 1));
  if (defaults.length) return Object.freeze(defaults.slice(0, 1));
  return Object.freeze(ordered.slice(0, 1));
}

function deriveTargetSizeBudget(value) {
  const maxSizeBytes=integer(value?.maxSizeBytes,'maxSizeBytes',1),durationMs=integer(value?.durationMs,'durationMs',1);
  const containerReserveBytes=Math.max(16*1024*1024,Math.ceil(maxSizeBytes*0.02));
  const audioStreams=Array.isArray(value.audioStreams)?value.audioStreams:[],subtitleStreams=Array.isArray(value.subtitleStreams)?value.subtitleStreams:[];
  const audioBitrateBps=audioStreams.reduce((sum,item)=>sum+estimatedAudioBitrateBps(item),0);
  const subtitleBitrateBps=subtitleStreams.length*64000;
  const nonVideoBitrateBps=audioBitrateBps+subtitleBitrateBps;
  const durationSeconds=durationMs/1000;
  const capVideoBitrateBps=Math.floor(((maxSizeBytes-containerReserveBytes)*8/durationSeconds)-nonVideoBitrateBps);
  const sourceSizeBytes=Number.isSafeInteger(value?.sourceSizeBytes)&&value.sourceSizeBytes>0?value.sourceSizeBytes:null;
  const fillBytes=sourceSizeBytes!==null?Math.min(maxSizeBytes,sourceSizeBytes):maxSizeBytes;
  const fillReserveBytes=Math.max(16*1024*1024,Math.ceil(fillBytes*0.02));
  let targetVideoBitrateBps=Math.floor(((fillBytes-fillReserveBytes)*8/durationSeconds)-nonVideoBitrateBps);
  if(targetVideoBitrateBps<100000)targetVideoBitrateBps=Math.max(100000,Math.floor(fillBytes*8/durationSeconds*0.7));
  if(capVideoBitrateBps>=100000)targetVideoBitrateBps=Math.min(targetVideoBitrateBps,capVideoBitrateBps);
  const raster = value.rasterClass === '4k' ? '4k' : 'below_4k';
  const floorBps = Number.isSafeInteger(value.videoBitrateFloorBps) && value.videoBitrateFloorBps > 0
    ? value.videoBitrateFloorBps
    : videoBitrateFloorBps(maxSizeBytes, raster);
  const exceedsSizeCap = capVideoBitrateBps < floorBps;
  if (exceedsSizeCap) targetVideoBitrateBps = floorBps;
  const predictedBytes = predictedProductBytes({
    durationMs, targetVideoBitrateBps, nonVideoBitrateBps, containerReserveBytes,
  });
  return freeze({sizeBudgetRevision:1,maxSizeBytes,containerReserveBytes,nonVideoBitrateBps,targetVideoBitrateBps,
    capVideoBitrateBps, videoBitrateFloorBps:floorBps, rasterClass:raster, predictedBytes, exceedsSizeCap,
    feasible:capVideoBitrateBps>=100000,sourceSizeBytes,budgetDigest:canonicalDigest({schema:'libra.target-size-budget@1',maxSizeBytes,
      containerReserveBytes,nonVideoBitrateBps,targetVideoBitrateBps,sourceSizeBytes})});
}

function selectCopyAudioStreamsForSizeBudget(value) {
  const audioStreams=[...(Array.isArray(value?.audioStreams)?value.audioStreams:[])].sort((a,b)=>a.streamIndex-b.streamIndex);
  const subtitleStreams=Array.isArray(value?.subtitleStreams)?value.subtitleStreams:[];
  const maxSizeBytes=integer(value?.maxSizeBytes,'maxSizeBytes',1),durationMs=integer(value?.durationMs,'durationMs',1);
  const evaluate=(streams)=>{
    const selected=[...streams].sort((a,b)=>a.streamIndex-b.streamIndex);
    return {audioStreams:Object.freeze(selected),budget:deriveTargetSizeBudget({maxSizeBytes,durationMs,audioStreams:selected,subtitleStreams,
      rasterClass:value?.rasterClass,
      ...(Number.isSafeInteger(value?.sourceSizeBytes)&&value.sourceSizeBytes>0?{sourceSizeBytes:value.sourceSizeBytes}:{})})};
  };
  const ladder=[];
  const push=(streams)=>{if(!ladder.some((item)=>sameAudioSet(item,streams)))ladder.push(Object.freeze([...streams]));};
  push(audioStreams);
  const withoutOther=audioStreams.filter((item)=>item.normalizedAudioClass!=='other');
  if(withoutOther.length)push(withoutOther);
  const retained=preferRetainedPrimaryAudio(audioStreams,value?.acceptedPrimaryAudioClasses);
  if(retained.length)push(retained);
  for(const candidate of ladder){
    const result=evaluate(candidate);
    if(result.budget.feasible)return freeze({...result,feasible:true});
  }
  const last=evaluate(ladder.at(-1)||[]);
  return freeze({...last,feasible:false});
}

function deriveRetryTargetVideoBitrate(value) {
  const previousTarget=integer(value?.previousTargetVideoBitrateBps,'previousTargetVideoBitrateBps',1),
    maxSizeBytes=integer(value?.maxSizeBytes,'maxSizeBytes',1),actualSizeBytes=integer(value?.actualSizeBytes,'actualSizeBytes',1);
  return Math.floor(previousTarget*maxSizeBytes/actualSizeBytes*0.98);
}

function buildEncodeIntent(value) {
  const mode = value?.rateControlMode;
  if (!['target_size','quality_bound','two_pass_abr','strict_abr'].includes(mode)) fail('P9_MEDIA_RATE_CONTROL', 'Encode rate-control mode is invalid.');
  const bitrateMode=['target_size','two_pass_abr','strict_abr'].includes(mode);
  const targetVideoBitrateBps = bitrateMode ? integer(value.targetVideoBitrateBps, 'targetVideoBitrateBps', 1) : null;
  const qualityBound = mode === 'quality_bound' ? integer(value.qualityBound, 'qualityBound') : null;
  if (qualityBound !== null && qualityBound > 63) fail('P9_MEDIA_RATE_CONTROL', 'Encode quality bound is invalid.');
  const strategyOrdinal=integer(value.strategyOrdinal,'strategyOrdinal',1);
  if(strategyOrdinal===1&&value.previousIntentDigest!==undefined)fail('P9_MEDIA_PREVIOUS_INTENT','The first Encode Intent cannot reference a previous Intent.');
  if(strategyOrdinal>1)digest(value.previousIntentDigest,'previousIntentDigest');
  const operation=value.dynamicRangeOperation||'preserve';
  if(!['preserve','tone_map_to_sdr_bt709'].includes(operation))fail('P9_MEDIA_DYNAMIC_RANGE','Dynamic-range operation is invalid.');
  const pipelineProfileId=text(value.pipelineProfileId,'pipelineProfileId');
  const outputDynamicRangeKind=value.outputDynamicRangeKind||'unknown',outputPixelFormat=text(value.outputPixelFormat||'encoder_selected','outputPixelFormat');
  if(!['sdr','hdr10_compatible','hlg','dolby_vision','unknown'].includes(outputDynamicRangeKind))fail('P9_MEDIA_DYNAMIC_RANGE','Output dynamic range is invalid.');
  const outputColorProfile=operation==='tone_map_to_sdr_bt709'
    ?freeze({range:'limited',primaries:'bt709',transfer:'bt709',matrix:'bt709'})
    :freeze(value.outputColorProfile||{range:'source',primaries:'source',transfer:'source',matrix:'source'});
  if(operation==='tone_map_to_sdr_bt709'&&(pipelineProfileId!=='pq_bt2020_base_to_sdr_bt709_hevc@1'||
      outputDynamicRangeKind!=='sdr'||outputPixelFormat!=='yuv420p'||canonicalJson(outputColorProfile)!==canonicalJson({range:'limited',primaries:'bt709',transfer:'bt709',matrix:'bt709'})))
    fail('P9_MEDIA_DYNAMIC_RANGE','DV normalization Intent is not the closed SDR BT.709 profile.');
  const result={ intentId:'', revision:integer(value.revision, 'revision', 1), schemaRef:'EncodeIntent@1',
    libraRunId:text(value.libraRunId, 'libraRunId'), sourceHandleDigest:digest(value.sourceHandleDigest, 'sourceHandleDigest'),
    mediaRequirementDigest:digest(value.mediaRequirementDigest, 'mediaRequirementDigest'),planningPolicyRef:'LibraMediaPlanningPolicy@1',
    planningPolicyRevision:2,planningPolicyDigest:LIBRA_MEDIA_PLANNING_POLICY_DIGEST,strategyOrdinal,sizeBudgetRevision:1,
    outputContainer:'matroska', outputExtension:'mkv',
    video:{codec:'hevc',rateControlMode:mode,targetVideoBitrateBps,qualityBound,preserveRaster:true,forbidUpscale:true,
      dynamicRangeOperation:operation,pipelineProfileId,outputDynamicRangeKind,outputPixelFormat,outputColorProfile},
    audio:{mode:'copy'},subtitle:{mode:'copy'},deviceClass:text(value.deviceClass, 'deviceClass') };
  if(value.audioStreamIndexes!==undefined)
    result.audio={mode:'copy',streamIndexes:uniqueIncreasingIndexes(value.audioStreamIndexes,'audioStreamIndexes')};
  if(strategyOrdinal>1)result.previousIntentDigest=value.previousIntentDigest;
  return finalizeProductionIntent(result);
}

function buildRemuxIntent(value) {
  return finalizeProductionIntent({ intentId:'', revision:integer(value.revision, 'revision', 1), schemaRef:'RemuxIntent@1',
    libraRunId:text(value.libraRunId, 'libraRunId'), sourceHandleDigest:digest(value.sourceHandleDigest, 'sourceHandleDigest'),
    mediaRequirementDigest:digest(value.mediaRequirementDigest, 'mediaRequirementDigest'), outputContainer:'matroska', outputExtension:'mkv',
    streamPolicy:'copy_all_supported' });
}

function validateDeviceSnapshot(value) {
  if (!value || !['software_cpu','intel_qsv','nvidia_nvenc','amd_vaapi','remote_worker'].includes(value.deviceClass) ||
      value.enabled !== true || value.state !== 'ready' || canonicalDigest(value.capabilityPayload) !== value.capabilityDigest)
    fail('P9_MEDIA_DEVICE', 'Device Snapshot is unavailable or has invalid capability continuity.');
  digest(value.snapshotDigest, 'deviceSnapshotDigest');
  if (canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'snapshotDigest'))) !== value.snapshotDigest)
    fail('P9_MEDIA_DEVICE', 'Device Snapshot digest is invalid.');
  if(!Array.isArray(value.capabilityPayload?.validatedVideoPipelines)||!value.capabilityPayload.validatedVideoPipelines.length)
    fail('P9_MEDIA_DEVICE','Device Snapshot has no validated video pipeline.');
  return value;
}

function buildTranscodeInputVerification(value) {
  const sourceHandleDigest = canonicalDigest(value.sourceHandle), intent = value.encodeIntent, probe = assertProbeEvidence(value.probeEvidence),
    device = validateDeviceSnapshot(value.deviceSnapshot), reasons = [];
  if (probe?.sourceHandleDigest !== sourceHandleDigest) reasons.push('source_handle_mismatch');
  if (probe?.resultKind !== 'probed') reasons.push(probe?.resultKind === 'not_media' ? 'source_not_media' : 'probe_integrity_failure');
  if (intent?.sourceHandleDigest !== sourceHandleDigest) reasons.push('input_fence_mismatch');
  if (intent?.deviceClass !== device.deviceClass) reasons.push('device_class_mismatch');
  const codecs = device.capabilityPayload?.supportedVideoCodecs || [], modes = device.capabilityPayload?.supportedRateControlModes || [],
    pipelines=device.capabilityPayload?.validatedVideoPipelines||[],pipeline=pipelines.find((item)=>item.pipelineProfileId===intent?.video?.pipelineProfileId);
  if (!codecs.includes(intent?.video?.codec)) reasons.push('output_profile_unsupported');
  if (!modes.includes(intent?.video?.rateControlMode)) reasons.push('rate_control_unsupported');
  if(!pipeline)reasons.push('required_pipeline_profile_unavailable');
  const primary=primaryStreams(probe.videoStreams);
  if(!primary.length)reasons.push('source_not_media');
  if(intent?.video?.dynamicRangeOperation==='tone_map_to_sdr_bt709'){
    if(primary.some((stream)=>stream.dynamicRangeKind!=='dolby_vision'))reasons.push('source_dynamic_range_unsupported');
    if(primary.some((stream)=>!stream.dolbyVision?.blPresent||stream.dolbyVision?.baseLayerKind!=='pq_bt2020_compatible'))
      reasons.push('dolby_vision_base_layer_unsupported');
  }
  if(pipeline&&primary.some((stream)=>!(pipeline.inputDynamicRangeKinds||[]).includes(stream.dynamicRangeKind)))
    reasons.push('source_dynamic_range_unsupported');
  if(pipeline&&primary.some((stream)=>!(pipeline.inputPixelFormats||[]).includes(stream.pixelFormat)))reasons.push('source_pixel_format_unsupported');
  const preflight=value.preflight||{sampleCount:0,passedSampleCount:0,reasonCode:null,preflightDigest:canonicalDigest({schema:'libra.empty-preflight@1'})};
  if(preflight.reasonCode==='encoder_rejected_source_pipeline')reasons.push('encoder_rejected_source_pipeline');
  const integrityReasons=new Set(['source_handle_mismatch','probe_integrity_failure','device_class_mismatch','input_fence_mismatch']);
  const disposition=reasons.some((item)=>integrityReasons.has(item))?'integrity_rejected':reasons.length?'strategy_rejected':'compatible';
  const rejectionScope=disposition==='compatible'?null:(reasons.some((item)=>['required_pipeline_profile_unavailable','source_dynamic_range_unsupported',
    'dolby_vision_base_layer_unsupported','source_pixel_format_unsupported','output_profile_unsupported','encoder_rejected_source_pipeline'].includes(item))
    ?'device_pipeline':'rate_control_strategy');
  const strategyKey=device.deviceId+'\0'+device.probeRevision+'\0'+intent.video.pipelineProfileId+'\0'+intent.video.rateControlMode;
  const coveredStrategyKeys=rejectionScope==='device_pipeline'?(device.capabilityPayload.supportedRateControlModes||[]).map((mode)=>
    device.deviceId+'\0'+device.probeRevision+'\0'+intent.video.pipelineProfileId+'\0'+mode).sort((a,b)=>Buffer.from(a).compare(Buffer.from(b))):[strategyKey];
  const reasonCodes = Object.freeze([...new Set(reasons)]), probeEvidenceDigest = canonicalDigest(probe),
    encodeIntentDigest = digest(intent?.intentDigest, 'encodeIntentDigest'), deviceSnapshotDigest = device.snapshotDigest;
  const basisDigest = canonicalDigest({ schema:'libra.transcode-input-verification-basis@1', sourceHandleDigest,
    encodeIntentDigest, probeEvidenceDigest, deviceSnapshotDigest });
  const result = { schemaRef:'helix://contracts/types/TranscodeInputVerification/v1', schemaVersion:1,
    verificationId:canonicalDigest({ schema:'libra.transcode-input-verification-id@1', basisDigest }),
    verificationKind:'libra_transcode_input', basisDigest, result:disposition==='compatible' ? 'passed' : 'failed', reasonCodes,
    evidenceRefs:Object.freeze([text(probe.evidenceId, 'probeEvidenceId')]), verifiedAtMs:integer(value.verifiedAtMs, 'verifiedAtMs'),
    sourceHandleDigest, encodeIntentDigest, probeEvidenceId:probe.evidenceId, probeEvidenceDigest,
    deviceId:text(device.deviceId, 'deviceId'), deviceSnapshotDigest, selectedDeviceClass:device.deviceClass,disposition,rejectionScope,
    coveredStrategyKeys:Object.freeze(coveredStrategyKeys),sampleCount:integer(preflight.sampleCount,'sampleCount'),
    passedSampleCount:integer(preflight.passedSampleCount,'passedSampleCount'),preflightDigest:digest(preflight.preflightDigest,'preflightDigest') };
  if(result.disposition==='compatible'&&(result.sampleCount!==24||result.passedSampleCount!==24))
    fail('P9_MEDIA_PREFLIGHT','Compatible verification requires all 24 bounded sample frames.');
  return limited(result, 16 * 1024, 'P9_TRANSCODE_VERIFICATION_SIZE');
}

function buildWorkspaceMediaOutputTarget(value) {
  const target = { targetId:'', libraRunId:text(value.libraRunId, 'libraRunId'), executionBasisDigest:digest(value.executionBasisDigest, 'executionBasisDigest'),
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
  const mismatches = [];
  if (!target) mismatches.push('target_missing');
  else {
    if (target.productionIntentDigest !== intent?.intentDigest) mismatches.push('production_intent_digest');
    if (handle?.workspaceId !== target.workspaceId) mismatches.push('workspace_id');
    if (handle?.ownerDomain !== 'libra') mismatches.push('owner_domain');
    if (handle?.processId !== target.libraRunId) mismatches.push('process_id');
    if (handle?.endpointId !== target.rootSnapshot?.endpointId) mismatches.push('endpoint_id');
    if (handle?.physicalIdentity?.mountScopeId !== target.rootSnapshot?.mountScopeId) mismatches.push('mount_scope_id');
    if (handle?.relativePath !== target.targetRelativePath) mismatches.push('relative_path');
    if (value.effectReceipt?.effectScopeDigest !== target.effectScopeDigest) mismatches.push('effect_scope_digest');
  }
  if (mismatches.length)
    fail('P9_MEDIA_OUTPUT_CONTINUITY', 'Workspace output does not match its frozen target and Effect scope.', {
      mismatches,
      handleEndpointId: handle?.endpointId || null,
      targetEndpointId: target?.rootSnapshot?.endpointId || null,
      handleMountScopeId: handle?.physicalIdentity?.mountScopeId || null,
      targetMountScopeId: target?.rootSnapshot?.mountScopeId || null,
      handleRelativePath: handle?.relativePath || null,
      targetRelativePath: target?.targetRelativePath || null,
    });
  const kind = value.productionIntentKind;
  if (!['remux','encode'].includes(kind) || (kind === 'encode') !== Boolean(value.deviceSnapshot)) fail('P9_MEDIA_OUTPUT_KIND', 'Production intent kind is invalid.');
  const executionDeviceRef = kind === 'encode' ? { deviceId:value.deviceSnapshot.deviceId, deviceClass:value.deviceSnapshot.deviceClass,
    deviceSnapshotDigest:value.deviceSnapshot.snapshotDigest } : null;
  const productionVideoProfile=kind==='encode'?freeze({dynamicRangeOperation:intent.video.dynamicRangeOperation,
    pipelineProfileId:intent.video.pipelineProfileId,outputDynamicRangeKind:intent.video.outputDynamicRangeKind,
    outputPixelFormat:intent.video.outputPixelFormat,outputColorProfile:intent.video.outputColorProfile,
    profileDigest:canonicalDigest({dynamicRangeOperation:intent.video.dynamicRangeOperation,pipelineProfileId:intent.video.pipelineProfileId,
      outputDynamicRangeKind:intent.video.outputDynamicRangeKind,outputPixelFormat:intent.video.outputPixelFormat,
      outputColorProfile:intent.video.outputColorProfile})}):null;
  const result = { schemaRef:'helix://contracts/types/WorkspaceMediaHandle/v1', schemaVersion:1, workspaceMediaHandleId:'',
    sourceMaterialHandleDigest, workspaceMaterialHandle:handle, workspaceMaterialHandleDigest:canonicalDigest(handle),
    outputTargetId:target.targetId, outputTargetDigest:target.targetDigest, producingEventId:text(value.producingEventId, 'producingEventId'),
    productionIntentKind:kind, productionIntentDigest:intent.intentDigest, executionDeviceRef,productionVideoProfile,
    effectReceiptRef:{ effectId:text(value.effectReceipt.effectId, 'effectId'), effectReceiptId:text(value.effectReceipt.effectReceiptId, 'effectReceiptId'),
      effectReceiptDigest:digest(value.effectReceipt.effectReceiptDigest, 'effectReceiptDigest') } };
  result.workspaceMediaHandleId = canonicalDigest({ schema:'libra.workspace-media-handle-id@1', sourceMaterialHandleDigest,
    workspaceMaterialHandleId:handle.handleId, outputTargetId:result.outputTargetId, producingEventId:result.producingEventId,
    productionIntentDigest:result.productionIntentDigest, executionDeviceRefOrNull:executionDeviceRef });
  result.resultDigest = canonicalDigest(result);
  return limited(result, 16 * 1024, 'P9_WORKSPACE_MEDIA_HANDLE_SIZE');
}

function buildProductMediaCandidateInput(value) {
  const requirement = assertExactMediaRequirement(value.mediaRequirement), kind = value.candidateKind;
  if (!['direct_input','workspace_output'].includes(kind)) fail('P9_MEDIA_CANDIDATE_KIND', 'Candidate kind is invalid.');
  const common = { schemaRef:'helix://contracts/domain-types/ProductMediaCandidateInput/v1', schemaVersion:1, candidateId:'',
    candidateNodeId:text(value.candidateNodeId, 'candidateNodeId'), candidateBasisDigest:'', libraRunId:text(value.libraRunId, 'libraRunId'),
    mediaRequirement:requirement, candidateKind:kind };
  let result;
  if (kind === 'direct_input') {
    common.candidateBasisDigest = canonicalDigest(value.sourceMaterialHandle);
    result = { ...common, sourceMaterialHandle:value.sourceMaterialHandle, sourceProbeEvidence:assertProbeEvidence(value.sourceProbeEvidence) };
  } else {
    const workspace = value.workspaceMediaHandle;
    common.candidateBasisDigest = canonicalDigest({ schema:'libra.workspace-product-candidate-basis@1', outputTargetId:workspace.outputTargetId,
      outputTargetDigest:workspace.outputTargetDigest, productionIntentDigest:workspace.productionIntentDigest });
    result = { ...common, workspaceMediaHandle:workspace, sourceProbeEvidence:assertProbeEvidence(value.sourceProbeEvidence),
      outputProbeEvidence:assertProbeEvidence(value.outputProbeEvidence) };
  }
  result.candidateId = canonicalDigest({ schema:'libra.product-media-candidate-id@1', candidateNodeId:common.candidateNodeId,
    candidateKind:kind, candidateBasisDigest:common.candidateBasisDigest, mediaRequirementDigest:requirement.requirementDigest });
  result.inputDigest = canonicalDigest(result);
  return limited(result, 64 * 1024, 'P9_MEDIA_CANDIDATE_SIZE');
}

function buildPlannedProductCandidateReference(value) {
  const candidateKind = value?.candidateKind;
  const candidateNodeId = text(value?.candidateNodeId, 'candidateNodeId');
  const mediaRequirementDigest = digest(
    value?.mediaRequirementDigest,
    'mediaRequirementDigest',
  );
  let candidateBasisDigest;
  if (candidateKind === 'direct_input') {
    if (!value.sourceMaterialHandle) {
      fail('P9_MEDIA_CANDIDATE_PLAN',
        'Direct Product Candidate planning requires its frozen source Handle.');
    }
    candidateBasisDigest = canonicalDigest(value.sourceMaterialHandle);
  } else if (candidateKind === 'workspace_output') {
    candidateBasisDigest = canonicalDigest({
      schema: 'libra.workspace-product-candidate-basis@1',
      outputTargetId: text(value?.outputTargetId, 'outputTargetId'),
      outputTargetDigest: digest(value?.outputTargetDigest, 'outputTargetDigest'),
      productionIntentDigest: digest(
        value?.productionIntentDigest,
        'productionIntentDigest',
      ),
    });
  } else {
    fail('P9_MEDIA_CANDIDATE_PLAN',
      'Planned Product Candidate kind is invalid.');
  }
  const rank = integer(value?.rank, 'rank', 1);
  if (rank > 32) {
    fail('P9_MEDIA_CANDIDATE_PLAN',
      'Planned Product Candidate rank exceeds the closed selection bound.');
  }
  return Object.freeze({
    rank,
    candidateId: canonicalDigest({
      schema: 'libra.product-media-candidate-id@1',
      candidateNodeId,
      candidateKind,
      candidateBasisDigest,
      mediaRequirementDigest,
    }),
    candidateNodeId,
  });
}

function primaryStreams(streams) {
  const defaults=(streams||[]).filter((item)=>item.dispositionDefault===true);
  if(defaults.length)return defaults;
  return [...(streams||[])].sort((a,b)=>a.streamIndex-b.streamIndex).slice(0,1);
}
function rasterClass(probe) {
  const streams=primaryStreams(probe?.videoStreams);
  return streams.length&&streams.every((item)=>item.longEdge>=3800&&item.shortEdge>=1600)?'4k':streams.length?'below_4k':'none';
}

function sizeCapAdmissionForecast(value) {
  const maxSizeBytes = value?.maxSizeBytes;
  const probe = value?.probe;
  if (!Number.isSafeInteger(maxSizeBytes) || maxSizeBytes < 1 || !probe) return null;
  const raster = rasterClass(probe);
  const indexes = Array.isArray(value?.intent?.audio?.streamIndexes)
    ? new Set(value.intent.audio.streamIndexes) : null;
  const audioStreams = (probe.audioStreams || []).filter((item) =>
    !indexes || indexes.has(item.streamIndex));
  const budget = deriveTargetSizeBudget({
    maxSizeBytes,
    durationMs: probe.durationMs,
    audioStreams,
    subtitleStreams: probe.subtitleStreams,
    rasterClass: raster,
    ...(Number.isSafeInteger(probe.sizeBytes) && probe.sizeBytes > 0
      ? { sourceSizeBytes: probe.sizeBytes } : {}),
  });
  if (!budget.exceedsSizeCap) return null;
  return freeze({
    maxSizeBytes,
    predictedBytes: budget.predictedBytes,
    overshootBytes: Math.max(0, (budget.predictedBytes || 0) - maxSizeBytes),
    videoBitrateFloorBps: budget.videoBitrateFloorBps,
    targetVideoBitrateBps: budget.targetVideoBitrateBps,
    rasterClass: raster,
  });
}
function primaryVideoCodec(probe){const codecs=[...new Set(primaryStreams(probe?.videoStreams).map((item)=>item.codec))];return codecs.length===1?codecs[0]:codecs.length?'mixed':'none';}
function primaryDynamicRangeKind(probe){const kinds=[...new Set(primaryStreams(probe?.videoStreams).map((item)=>item.dynamicRangeKind||'unknown'))];
  return kinds.length===1?kinds[0]:kinds.length?'unknown':'unknown';}
function primaryAudioClasses(probe) { return sortedUnique([...new Set(primaryStreams(probe?.audioStreams).map((item) => item.normalizedAudioClass))]
  .sort((a,b)=>Buffer.from(a).compare(Buffer.from(b))), 'primaryAudioClasses'); }

function sourceRequiresExternalSearch(probe, mandatoryMedia) {
  const mandatory = mandatoryMedia || {};
  const raster = rasterClass(probe);
  if (mandatory.minimumRasterClass === '4k' && raster !== '4k') return true;
  const accepted = mandatory.acceptedPrimaryAudioClasses || [];
  if (accepted.length) {
    const audio = primaryAudioClasses(probe);
    if (!audio.some((item) => accepted.includes(item))) return true;
  }
  return false;
}

function buildProductMediaVerification(value) {
  const input = value.input;let requirementIntegrity=true;try{assertExactMediaRequirement(input.mediaRequirement);}catch{requirementIntegrity=false;}
  const requirement = input.mediaRequirement, mandatory = requirement.mandatoryMedia, outputProbe =
    input.candidateKind === 'direct_input' ? input.sourceProbeEvidence : input.outputProbeEvidence,
    handle = input.candidateKind === 'direct_input' ? input.sourceMaterialHandle : input.workspaceMediaHandle.workspaceMaterialHandle;
  const reasons = [];
  const inputValue=Object.fromEntries(Object.entries(input).filter(([key])=>key!=='inputDigest'));
  if(canonicalDigest(inputValue)!==input.inputDigest)requirementIntegrity=false;
  const expectedCandidateBasis=input.candidateKind==='direct_input'?canonicalDigest(input.sourceMaterialHandle):canonicalDigest({
    schema:'libra.workspace-product-candidate-basis@1',outputTargetId:input.workspaceMediaHandle?.outputTargetId,
    outputTargetDigest:input.workspaceMediaHandle?.outputTargetDigest,productionIntentDigest:input.workspaceMediaHandle?.productionIntentDigest});
  const expectedCandidateId=canonicalDigest({schema:'libra.product-media-candidate-id@1',candidateNodeId:input.candidateNodeId,
    candidateKind:input.candidateKind,candidateBasisDigest:expectedCandidateBasis,mediaRequirementDigest:requirement?.requirementDigest});
  if(input.candidateBasisDigest!==expectedCandidateBasis||input.candidateId!==expectedCandidateId)requirementIntegrity=false;
  try{assertProbeEvidence(input.sourceProbeEvidence);assertProbeEvidence(outputProbe);}catch{reasons.push('output_not_media');}
  if(!requirementIntegrity)reasons.push('requirement_integrity_failure');
  if (outputProbe?.sourceHandleDigest !== canonicalDigest(handle)) reasons.push('output_handle_mismatch');
  if (outputProbe?.resultKind !== 'probed') reasons.push('output_not_media');
  if (mandatory.mediaForm === 'stream_file' && outputProbe?.discTopology) reasons.push('media_form_unmet');
  const videoCodec = primaryVideoCodec(outputProbe), container = outputProbe?.container || 'none', extension = (handle.relativePath || handle.location || '').split('.').pop().toLowerCase();
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
  const sourceDynamicRangeKind=primaryDynamicRangeKind(input.sourceProbeEvidence),outputDynamicRangeKind=primaryDynamicRangeKind(outputProbe),
    outputVideo=primaryStreams(outputProbe?.videoStreams)[0]||{},profile=input.candidateKind==='workspace_output'
      ?input.workspaceMediaHandle.productionVideoProfile:null,conversionOperation=profile?.dynamicRangeOperation||'none',
    outputColorProfile={range:outputVideo.colorRange||'unknown',primaries:outputVideo.colorPrimaries||'unknown',
      transfer:outputVideo.colorTransfer||'unknown',matrix:outputVideo.colorMatrix||'unknown'},
    dolbyVisionMetadataPresent=primaryStreams(outputProbe?.videoStreams).some((stream)=>stream.dynamicRangeKind==='dolby_vision'||stream.dolbyVision),
    playback=value.playbackVerification||{samplePointsPercent:[],passedSamplePointsPercent:[],decodeDigest:canonicalDigest({schema:'libra.playback-not-required@1'})};
  if(profile?.dynamicRangeOperation==='tone_map_to_sdr_bt709'){
    if(outputDynamicRangeKind!=='sdr')reasons.push('dynamic_range_conversion_unmet');
    if(outputVideo.pixelFormat!=='yuv420p'||canonicalJson(outputColorProfile)!==canonicalJson({range:'limited',primaries:'bt709',transfer:'bt709',matrix:'bt709'}))
      reasons.push('output_color_profile_unmet');
    if(dolbyVisionMetadataPresent)reasons.push('dolby_vision_metadata_not_removed');
    if(canonicalJson(playback.samplePointsPercent)!==canonicalJson([5,50,95])||
        canonicalJson(playback.passedSamplePointsPercent)!==canonicalJson([5,50,95]))reasons.push('playback_decode_failed');
  }
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
    spaceSummary:{unit:requirement.space.unit,actualSizeBytes,maxSizeBytes:maxSizeBytes??null,withinLimit},
    dynamicRangeSummary:{sourceDynamicRangeKind,outputDynamicRangeKind,conversionOperation,outputPixelFormat:outputVideo.pixelFormat||'unknown',
      outputColorProfile,dolbyVisionMetadataPresent},decodeSummary:{samplePointsPercent:Object.freeze([...(playback.samplePointsPercent||[])]),
      passedSamplePointsPercent:Object.freeze([...(playback.passedSamplePointsPercent||[])]),decodeDigest:digest(playback.decodeDigest,'decodeDigest')} };
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
  const result={criteria,candidates:Object.freeze(candidates),candidateSetDigest:canonicalDigest({schema:'libra.product-media-verification-set@1',items:candidates})};
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

module.exports=Object.freeze({MediaProductionContractError,LIBRA_MEDIA_PLANNING_POLICY,LIBRA_MEDIA_PLANNING_POLICY_DIGEST,
  buildMediaRequirement,buildProductionSourceScopeReference,deriveTargetSizeBudget,selectCopyAudioStreamsForSizeBudget,
  deriveRetryTargetVideoBitrate,videoBitrateFloorBps,sizeCapAdmissionForecast,rasterClass,predictedProductBytes,
  buildEncodeIntent,buildRemuxIntent,buildTranscodeInputVerification,
  buildWorkspaceMediaOutputTarget,buildWorkspaceMediaHandle,buildProductMediaCandidateInput,
  buildPlannedProductCandidateReference,buildProductMediaVerification,
  buildProductOutputSelectionInput,selectProductOutput,assertExactMediaRequirement,assertProbeEvidence,
  sourceRequiresExternalSearch});
