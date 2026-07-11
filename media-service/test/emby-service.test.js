'use strict';

const assert = require('node:assert');
const test = require('node:test');

const embyService = require('../src/services/embyService');
const basedataFlowExecutor = require('../src/basedataFlowExecutor');

test('Emby technical extraction uses item-level fields when nested stream dimensions are absent', () => {
  const item = embyService._internals.extractItemFields({
    Id: 'movie-1',
    Name: 'Movie',
    Type: 'Movie',
    Path: '/media/Movie.mkv',
    RunTimeTicks: 1200_000_000,
    Size: 600_000_000,
    Bitrate: 4_000_000,
    Width: 1920,
    Height: 1080,
    MediaStreams: [{ Type: 'Video', Codec: 'hevc' }],
    MediaSources: [{ Path: '/media/Movie.mkv' }],
  });

  assert.strictEqual(item.duration, 120);
  assert.strictEqual(item.size, 600_000_000);
  assert.strictEqual(item.bitrate, 4_000_000);
  assert.strictEqual(item.resolution, '1920x1080');
  assert.strictEqual(item.codec, 'h265');
});

test('Emby technical extraction never invents h264 when codec evidence is absent', () => {
  const item = embyService._internals.extractItemFields({
    Id: 'movie-2',
    Name: 'Disc image',
    Type: 'Movie',
    Path: '/media/disc.iso',
    Width: 1920,
    Height: 1080,
    MediaSources: [{ Path: '/media/disc.iso' }],
  });

  assert.strictEqual(item.codec, '');
});

test('Basedata aggregation preserves the best Emby resolution from an empty accumulator', () => {
  const facts = basedataFlowExecutor.aggregateEmbyFacts([{
    type: 'movie',
    path: '/media/Movie.mkv',
    size: 600_000_000,
    duration: 120,
    bitrate: 4_000_000,
    resolution: '1920x1080',
    codec: 'h265',
  }]);

  assert.strictEqual(facts.resolution, '1920x1080');
});
