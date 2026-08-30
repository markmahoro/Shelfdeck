'use strict';

const DV_SDR_FILTER = 'setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc:range=limited,zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p';
const SDR_PROFILE_ID = 'ordinary_to_hevc@1';
const DV_SDR_PROFILE_ID = 'pq_bt2020_base_to_sdr_bt709_hevc@1';

class CleanFfmpegPipelineError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CleanFfmpegPipelineError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new CleanFfmpegPipelineError(code, message, details);
}

function backend(deviceClass, platform = process.platform, vaapiDevice = process.env.VAAPI_DEVICE) {
  if (deviceClass === 'nvidia_nvenc') return Object.freeze({
    encoder:'hevc_nvenc', hardwareDecode:true,
    inputArgs:Object.freeze(['-hwaccel','cuda','-hwaccel_output_format','cuda']),
    qualityArgs:Object.freeze(['-preset','p6','-tune','hq','-spatial_aq','1','-temporal_aq','1','-rc-lookahead','20']),
  });
  if (deviceClass === 'intel_qsv') return Object.freeze({
    encoder:'hevc_qsv', hardwareDecode:true,
    inputArgs:Object.freeze(['-hwaccel','qsv','-hwaccel_output_format','qsv']),
    qualityArgs:Object.freeze([]),
  });
  if (deviceClass === 'amd_vaapi') {
    if (platform !== 'linux') fail('PLATFORM_MEDIA_DEVICE_UNSUPPORTED',
      'VAAPI media execution is available only on Linux.', { deviceClass, platform });
    const device = typeof vaapiDevice === 'string' && vaapiDevice.trim() ? vaapiDevice.trim() : '/dev/dri/renderD128';
    return Object.freeze({ encoder:'hevc_vaapi', hardwareDecode:true,
      inputArgs:Object.freeze(['-vaapi_device',device,'-hwaccel','vaapi','-hwaccel_output_format','vaapi']), qualityArgs:Object.freeze([]) });
  }
  if (deviceClass === 'software_cpu') return Object.freeze({
    encoder:'libx265', hardwareDecode:false, inputArgs:Object.freeze([]), qualityArgs:Object.freeze(['-preset','medium']),
  });
  fail('PLATFORM_MEDIA_DEVICE_UNSUPPORTED', 'Selected compute device has no local FFmpeg backend.', { deviceClass, platform });
}

function bitrate(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) fail('PLATFORM_MEDIA_RATE_CONTROL_INVALID',
    'FFmpeg bitrate intent is invalid.', { field, value });
  return String(value);
}

function quality(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 63) fail('PLATFORM_MEDIA_RATE_CONTROL_INVALID',
    'FFmpeg quality intent is invalid.', { value });
  return String(value);
}

function rateControlArgs(video, deviceClass) {
  const mode = video?.rateControlMode;
  if (mode === 'quality_bound') {
    const bound = quality(video.qualityBound);
    if (deviceClass === 'nvidia_nvenc') return ['-rc','vbr','-cq',bound,'-b:v','0'];
    if (deviceClass === 'intel_qsv') return ['-global_quality',bound];
    if (deviceClass === 'amd_vaapi') return ['-qp',bound];
    if (deviceClass === 'software_cpu') return ['-crf',bound];
  }
  if (!['target_size','two_pass_abr','strict_abr'].includes(mode)) fail('PLATFORM_MEDIA_RATE_CONTROL_INVALID',
    'FFmpeg rate-control mode is unsupported.', { mode, deviceClass });
  const target = bitrate(video.targetVideoBitrateBps, 'targetVideoBitrateBps');
  if (mode === 'strict_abr') {
    const common = ['-b:v',target,'-maxrate',target,'-bufsize',String(Number(target) * 2)];
    return deviceClass === 'nvidia_nvenc' ? ['-rc','cbr',...common] : common;
  }
  if (deviceClass === 'nvidia_nvenc') {
    return ['-rc','vbr','-b:v',target,'-maxrate',String(Number(target) * 2),'-bufsize',String(Number(target) * 2)];
  }
  return ['-b:v',target];
}

function profileArgs(video) {
  if (video?.dynamicRangeOperation !== 'tone_map_to_sdr_bt709') return [];
  if (video.pipelineProfileId !== DV_SDR_PROFILE_ID) fail('PLATFORM_MEDIA_PIPELINE_PROFILE_INVALID',
    'Tone mapping requires the closed PQ/BT.2020 to SDR pipeline.', { pipelineProfileId:video.pipelineProfileId });
  return ['-vf',DV_SDR_FILTER,'-pix_fmt','yuv420p','-color_range','tv','-color_primaries','bt709',
    '-color_trc','bt709','-colorspace','bt709','-map_metadata','-1'];
}

function compileFfmpegPipeline(value) {
  const deviceClass = value?.deviceClass;
  const video = value?.video;
  const selected = backend(deviceClass, value?.platform, value?.vaapiDevice);
  const softwareFilter = video?.dynamicRangeOperation === 'tone_map_to_sdr_bt709';
  const inputArgs = selected.hardwareDecode && !softwareFilter ? [...selected.inputArgs] : [];
  const executionPath = deviceClass === 'software_cpu' ? 'cpu_decode_cpu_encode' : softwareFilter
    ? 'cpu_decode_cpu_filter_gpu_encode' : 'gpu_decode_gpu_encode';
  return Object.freeze({
    deviceClass,
    encoder:selected.encoder,
    executionPath,
    hardwareDecode:inputArgs.length > 0,
    inputArgs:Object.freeze(inputArgs),
    videoArgs:Object.freeze([...profileArgs(video),'-c:v',selected.encoder,...selected.qualityArgs,...rateControlArgs(video,deviceClass)]),
  });
}

module.exports = Object.freeze({
  CleanFfmpegPipelineError,
  DV_SDR_FILTER,
  SDR_PROFILE_ID,
  DV_SDR_PROFILE_ID,
  backend,
  compileFfmpegPipeline,
  profileArgs,
  rateControlArgs,
});
