'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compileFfmpegPipeline, DV_SDR_PROFILE_ID, SDR_PROFILE_ID } = require('../src/clean-ffmpeg-pipeline');

function video(overrides = {}) {
  return { rateControlMode:'quality_bound', qualityBound:23, targetVideoBitrateBps:null,
    dynamicRangeOperation:'preserve', pipelineProfileId:SDR_PROFILE_ID, ...overrides };
}

test('ordinary NVENC pipeline keeps decode and encode on the GPU', () => {
  const pipeline=compileFfmpegPipeline({deviceClass:'nvidia_nvenc',platform:'win32',video:video()});
  assert.equal(pipeline.executionPath,'gpu_decode_gpu_encode');
  assert.deepEqual(pipeline.inputArgs,['-hwaccel','cuda','-hwaccel_output_format','cuda']);
  assert.ok(pipeline.videoArgs.includes('hevc_nvenc'));
  assert.deepEqual(pipeline.videoArgs.slice(-6),['-rc','vbr','-cq','23','-b:v','0']);
});

test('software tone map plus NVENC is explicit hybrid execution, not false full-GPU decode', () => {
  const pipeline=compileFfmpegPipeline({deviceClass:'nvidia_nvenc',platform:'win32',video:video({
    dynamicRangeOperation:'tone_map_to_sdr_bt709',pipelineProfileId:DV_SDR_PROFILE_ID,
  })});
  assert.equal(pipeline.executionPath,'cpu_decode_cpu_filter_gpu_encode');
  assert.deepEqual(pipeline.inputArgs,[]);
  assert.ok(pipeline.videoArgs.includes('-vf'));
  assert.ok(pipeline.videoArgs.includes('hevc_nvenc'));
});

test('CPU fallback remains an explicit software device pipeline', () => {
  const pipeline=compileFfmpegPipeline({deviceClass:'software_cpu',platform:'linux',video:video({
    rateControlMode:'two_pass_abr',qualityBound:null,targetVideoBitrateBps:2_000_000,
  })});
  assert.equal(pipeline.executionPath,'cpu_decode_cpu_encode');
  assert.deepEqual(pipeline.inputArgs,[]);
  assert.deepEqual(pipeline.videoArgs,['-c:v','libx265','-preset','medium','-b:v','2000000']);
});

test('strict NVENC ABR compiles CBR controls and VAAPI is never advertised on Windows', () => {
  const pipeline=compileFfmpegPipeline({deviceClass:'nvidia_nvenc',platform:'win32',video:video({
    rateControlMode:'strict_abr',qualityBound:null,targetVideoBitrateBps:1_000_000,
  })});
  assert.deepEqual(pipeline.videoArgs.slice(-8),['-rc','cbr','-b:v','1000000','-maxrate','1000000','-bufsize','2000000']);
  assert.throws(()=>compileFfmpegPipeline({deviceClass:'amd_vaapi',platform:'win32',video:video()}),
    (error)=>error.code==='PLATFORM_MEDIA_DEVICE_UNSUPPORTED');
});
