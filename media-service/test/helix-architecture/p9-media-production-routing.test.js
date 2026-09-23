'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  classifyVerifyGap,
  onlyRemuxGapFromVerification,
  shouldTranscodeExternalImport,
} = require('../../src/helix/domains/libra/model/media-production-routing');

test('classifyVerifyGap distinguishes volume, spec external, and transcode-fixable gaps', () => {
  assert.equal(classifyVerifyGap({ result: 'passed', reasonCodes: [] }), 'passed');
  assert.equal(classifyVerifyGap({ result: 'failed', reasonCodes: ['max_size_exceeded'] }), 'volume_only');
  assert.equal(classifyVerifyGap({ result: 'failed', reasonCodes: ['minimum_raster_unmet'] }), 'spec_external');
  assert.equal(classifyVerifyGap({ result: 'failed', reasonCodes: ['video_codec_unmet'] }), 'transcode_fixable');
  assert.equal(classifyVerifyGap({ result: 'failed', reasonCodes: ['playback_decode_failed'] }), 'hard_block');
});

test('container or extension-only gaps use a lossless remux', () => {
  assert.equal(onlyRemuxGapFromVerification({ result: 'failed', reasonCodes: ['container_unmet'] }), true);
  assert.equal(onlyRemuxGapFromVerification({ result: 'failed', reasonCodes: ['file_extension_unmet'] }), true);
  assert.equal(onlyRemuxGapFromVerification({ result: 'failed', reasonCodes: ['container_unmet', 'file_extension_unmet'] }), true);
  assert.equal(onlyRemuxGapFromVerification({ result: 'failed', reasonCodes: ['video_codec_unmet'] }), false);
  assert.equal(onlyRemuxGapFromVerification({ result: 'failed', reasonCodes: ['file_extension_unmet', 'max_size_exceeded'] }), false);
  assert.equal(onlyRemuxGapFromVerification({ result: 'passed', reasonCodes: [] }), false);
});

test('external import routing hints follow measured verification gaps', () => {
  const volume = { result: 'failed', reasonCodes: ['max_size_exceeded'] };
  const spec = { result: 'failed', reasonCodes: ['minimum_raster_unmet'] };
  assert.equal(shouldTranscodeExternalImport(volume), true);
  assert.equal(shouldTranscodeExternalImport(spec), false);
});
