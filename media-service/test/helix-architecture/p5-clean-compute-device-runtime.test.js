'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {
  DEVICE_PROBE_LAVFI_SOURCE,
  DV_SDR_FILTER,
  DV_SDR_PROFILE_ID,
  PROBES,
  SDR_PROFILE_ID,
  probeStreamMatchesProfile,
  runValidatedPipelineProbe,
} = require('../../src/clean-compute-device-runtime');
const ffmpeg = require('ffmpeg-static');

test('P5 clean compute discovery uses a bounded frame accepted by NVENC HEVC', () => {
  assert.equal(DEVICE_PROBE_LAVFI_SOURCE, 'color=c=black:s=256x256:r=1:d=0.1');
  assert.ok(PROBES.some((probe) => probe.deviceKind === 'nvidia_nvenc' &&
    probe.encoder === 'hevc_nvenc'));
  assert.ok(PROBES.some((probe) => probe.deviceKind === 'software_cpu' &&
    probe.encoder === 'libx265'));
});

test('ordinary SDR probe accepts HEVC output that omits color primaries and transfer tags', () => {
  const hevcSdr = { codec_name: 'hevc', pix_fmt: 'yuv420p', color_range: 'tv', color_space: 'bt709' };
  assert.equal(probeStreamMatchesProfile(SDR_PROFILE_ID, 'sdr', hevcSdr), true);
  assert.equal(probeStreamMatchesProfile(SDR_PROFILE_ID, 'unknown', {
    codec_name: 'hevc', pix_fmt: 'yuv420p10le',
  }), true);
  assert.equal(probeStreamMatchesProfile(SDR_PROFILE_ID, 'sdr', { codec_name: 'h264', pix_fmt: 'yuv420p' }), false);
  assert.equal(probeStreamMatchesProfile(DV_SDR_PROFILE_ID, 'hdr10_compatible', hevcSdr), false);
  assert.equal(probeStreamMatchesProfile(DV_SDR_PROFILE_ID, 'hdr10_compatible', {
    codec_name: 'hevc', pix_fmt: 'yuv420p', color_range: 'tv', color_primaries: 'bt709',
    color_transfer: 'bt709', color_space: 'bt709',
  }), true);
});

test('active Libra Runs replan blocked transcode assessments after a ready encode device appears', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/helix/composition/create-procurement-execution-runtime.js'), 'utf8');
  assert.match(source, /function hasReadyEncodeDevice\(\)/);
  assert.match(source, /function resumeBlockedTranscodeAssessments\(libraRunId\)/);
  assert.match(source, /resumeBlockedTranscodeAssessments\(libraRunId\);/);
  assert.match(source, /libra-workspace-media-transcode_\\d\+_assessment-work-/);
  assert.match(source, /disposition: 'replan'/);
});

test('P5 publishes the DV normalization profile only after the complete CPU pipeline self-test closes', {
  timeout:60_000,
}, async () => {
  assert.match(DV_SDR_FILTER, /zscale=t=linear/);
  assert.match(DV_SDR_FILTER, /tonemap=hable/);
  assert.match(DV_SDR_FILTER, /format=yuv420p/);
  assert.equal(DV_SDR_PROFILE_ID, 'pq_bt2020_base_to_sdr_bt709_hevc@1');
  const result = await runValidatedPipelineProbe(ffmpeg, 'libx265', 30_000);
  assert.equal(result.passed, true, JSON.stringify(result));
  assert.equal(result.reasonCode, null);
  assert.match(result.evidenceDigest, /^[a-f0-9]{64}$/);
});
