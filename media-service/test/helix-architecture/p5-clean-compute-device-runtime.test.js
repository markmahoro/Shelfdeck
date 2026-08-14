'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DEVICE_PROBE_LAVFI_SOURCE,
  DV_SDR_FILTER,
  DV_SDR_PROFILE_ID,
  PROBES,
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
