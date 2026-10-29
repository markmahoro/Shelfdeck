'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { createCleanPosterRenderer } = require('../src/clean-poster-renderer');

async function picture(color) {
  return sharp({ create: { width: 900, height: 1350, channels: 3, background: color } }).png().toBuffer();
}

test('poster rendering coalesces concurrent variants and keys replacement by actual bytes', async () => {
  let calls = 0;
  const renderer = createCleanPosterRenderer({ sharp(bytes) { calls++; return sharp(bytes); } });
  const red = await picture('red'), blue = await picture('blue');
  const results = await Promise.all(Array.from({ length: 8 }, () => renderer.render(red, 'wall')));
  assert.equal(calls, 1);
  for (const result of results) assert.deepEqual(result, results[0]);
  assert.equal((await sharp(results[0]).metadata()).width, 360);
  await renderer.render(Buffer.from(red), 'wall');
  assert.equal(calls, 1);
  const replacement = await renderer.render(blue, 'wall');
  assert.equal(calls, 2); assert.notDeepEqual(replacement, results[0]);
  const detail = await renderer.render(red, 'detail');
  assert.equal(calls, 3); assert.equal((await sharp(detail).metadata()).width, 720);
  assert.deepEqual(await renderer.render(red), red); assert.equal(calls, 3);
});

test('poster cache evicts by byte budget and never retains an encoding failure', async () => {
  const red = await picture('red'), blue = await picture('blue');
  const sizes = await Promise.all([red, blue].map(bytes => createCleanPosterRenderer().render(bytes, 'wall')));
  let calls = 0;
  const renderer = createCleanPosterRenderer({ maxBytes: Math.max(...sizes.map(bytes => bytes.length)), sharp(bytes) { calls++; return sharp(bytes); } });
  await renderer.render(red, 'wall');
  await renderer.render(blue, 'wall');
  await renderer.render(red, 'wall');
  assert.equal(calls, 3);
  for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(renderer.render(Buffer.from('invalid'), 'wall'));
  assert.equal(calls, 5);
});

test('poster cache entry bound respects recent use', async () => {
  const colors = await Promise.all(['red', 'blue', 'green'].map(picture));
  let calls = 0;
  const renderer = createCleanPosterRenderer({ maxEntries: 2, sharp(bytes) { calls++; return sharp(bytes); } });
  await renderer.render(colors[0], 'wall'); await renderer.render(colors[1], 'wall');
  await renderer.render(colors[0], 'wall'); await renderer.render(colors[2], 'wall');
  assert.equal(calls, 3);
  await renderer.render(colors[0], 'wall'); assert.equal(calls, 3);
  await renderer.render(colors[1], 'wall'); assert.equal(calls, 4);
});
