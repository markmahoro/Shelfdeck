'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const sharp = require('sharp');
const { originalNameProvenance, buildUsAdultTitle, buildUsAdultName } = require('../../src/helix/contracts/us-adult-presentation');
const { renderUsAdultPoster } = require('../../src/helix/integrations/us-adult-poster-renderer');

test('preserves the complete original stem and replaces only the actor prefix across refreshes', () => {
  const originalName = originalNameProvenance('Studio.2024-05-21.Scene.Title.1080p.HEVC.mp4');
  const first = buildUsAdultName({ actorName: 'Actor One', originalName, outputExtension: '.mkv' });
  const refreshed = buildUsAdultName({ actorName: 'Actor Two', originalName, outputExtension: '.mkv' });
  assert.equal(first.fileName, 'Actor One Studio.2024-05-21.Scene.Title.1080p.HEVC.mkv');
  assert.equal(refreshed.fileName, 'Actor Two Studio.2024-05-21.Scene.Title.1080p.HEVC.mkv');
  assert.equal(refreshed.originalName.provenanceDigest, first.originalName.provenanceDigest);
  assert.equal(refreshed.title.includes('Actor One'), false);
});

test('rejects missing provenance, path traversal and unrepresentable names without silent truncation', () => {
  assert.throws(() => originalNameProvenance('../video.mp4'), { code: 'US_ADULT_ORIGINAL_NAME_INVALID' });
  assert.throws(() => originalNameProvenance('C:\\video.mp4'), { code: 'US_ADULT_ORIGINAL_NAME_INVALID' });
  const originalName = originalNameProvenance('video.mp4');
  assert.throws(() => buildUsAdultName({ actorName: 'Actor', originalName: { ...originalName, originalFileName: 'changed.mp4' }, outputExtension: '.mkv' }),
    { code: 'US_ADULT_ORIGINAL_NAME_PROOF_INVALID' });
  assert.throws(() => buildUsAdultName({ actorName: 'A'.repeat(250), originalName, outputExtension: '.mkv' }), { code: 'US_ADULT_NAME_TOO_LONG' });
  assert.throws(() => buildUsAdultName({ actorName: '../Actor', originalName, outputExtension: '.mkv' }), { code: 'US_ADULT_ACTOR_NAME_INVALID' });
});

test('title projection does not invent an output extension when the actual container decides the filename budget', () => {
  const originalName=originalNameProvenance('x'.repeat(250)+'.mp4'),input={actorName:'A',originalName};
  assert.equal(Buffer.byteLength(buildUsAdultTitle(input).title),252);
  assert.equal(Buffer.byteLength(buildUsAdultName({...input,outputExtension:'.ts'}).fileName),255);
  assert.throws(()=>buildUsAdultName({...input,outputExtension:'.mkv'}),{code:'US_ADULT_NAME_TOO_LONG'});
});

test('renders all four large screenshots in a two-by-two grid without portrait or text overlap', async () => {
  const solid = background => sharp({ create: { width: 160, height: 90, channels: 3, background } }).png().toBuffer();
  const frames = await Promise.all(['#ff0000', '#00ff00', '#0000ff', '#ffff00'].map(solid));
  const result = await renderUsAdultPoster({ actorName: 'Actor & Name', originalTitle: 'Studio <Original> Title', portrait: await solid('#ffffff'), frames });
  const { data, info } = await sharp(result.bytes).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 1000); assert.equal(info.height, 1500);
  const pixel = (x, y) => Array.from(data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3));
  const expected = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
  for (const [index, [x, y]] of [[257, 770], [743, 770], [257, 1242], [743, 1242]].entries()) {
    assert.ok(pixel(x, y).every((value, channel) => Math.abs(value - expected[index][channel]) < 8));
  }
  // Each screenshot spans over twice the old 218-pixel thumbnail width.
  assert.ok(pixel(40, 770)[0] > 240); assert.ok(pixel(470, 770)[0] > 240);
});
