'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyInventoryPlayback } = require('../../src/helix/domains/arca/capabilities/aftercare-capability-ports');
const context = { shelfEntryId: 'entry' };
const material = { material_key: 'a'.repeat(64), endpoint_id: 'endpoint', location: '/movie.mkv', binding_revision: 2 };
const probe = { durationMs: 100000 };

test('Inventory playback uses all three samples and binds evidence to the exact material', async () => {
  const calls = [];
  const options = { aftercarePlaybackRunner: async (_binary, args) => calls.push(args) };
  const result = await verifyInventoryPlayback(options, context, material, probe);
  assert.deepEqual(result.passedSamplePointsPercent, [5, 50, 95]);
  assert.deepEqual(calls.map(args => args[args.indexOf('-ss') + 1]), ['5.000', '50.000', '95.000']);
  assert.ok(calls.every(args => args[args.indexOf('-i') + 1] === material.location));
  const changed = await verifyInventoryPlayback(options, context, { ...material, binding_revision: 3 }, probe);
  assert.notEqual(changed.decodeDigest, result.decodeDigest);
});

test('Inventory playback distinguishes decoding failure from unavailable verification infrastructure', async () => {
  let calls = 0;
  const result = await verifyInventoryPlayback({ aftercarePlaybackRunner: async () => {
    if (++calls === 2) throw Object.assign(new Error('decode failed'), { code: 'ARCA_AFTERCARE_MEDIA_FAILED' });
  } }, context, material, probe);
  assert.deepEqual(result.passedSamplePointsPercent, [5, 95]);
  for (const code of ['ENOENT', 'EACCES', 'ARCA_AFTERCARE_MEDIA_TIMEOUT']) {
    await assert.rejects(verifyInventoryPlayback({ aftercarePlaybackRunner: async () => {
      throw Object.assign(new Error('verification unavailable'), { code });
    } }, context, material, probe), { code });
  }
});
