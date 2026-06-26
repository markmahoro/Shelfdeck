'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const embyService = require('../src/services/embyService');
const transcodeService = require('../src/services/transcodeService');

function writeMinimalMpls(filePath, clipId, durationSec) {
  const b = Buffer.alloc(128);
  const playlistStart = 40;
  const itemOffset = playlistStart + 10;
  b.write('MPLS', 0, 'ascii');
  b.writeUInt32BE(playlistStart, 8);
  b.writeUInt16BE(1, playlistStart + 6);
  b.writeUInt16BE(20, itemOffset);
  b.write(clipId, itemOffset + 2, 'ascii');
  b.write('M2TS', itemOffset + 7, 'ascii');
  b.writeUInt32BE(0, itemOffset + 14);
  b.writeUInt32BE(Math.round(durationSec * 45000), itemOffset + 18);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, b);
}

test('Emby disc detection uses explicit source container, not BluRay release names', () => {
  const { inferIsDiscLike } = embyService._internals;

  assert.strictEqual(inferIsDiscLike({
    Path: '/volume1/Media/Film/Movie (2020)',
    MediaSources: [{ Container: 'bluray', Path: '/volume1/Media/Film/Movie (2020)' }],
  }), true);

  assert.strictEqual(inferIsDiscLike({
    Path: '/volume1/Media/Film/Movie (2020)/Movie.2020.1080p.BluRay.x264.mkv',
    MediaSources: [{ Container: 'mkv', Path: '/volume1/Media/Film/Movie (2020)/Movie.2020.1080p.BluRay.x264.mkv' }],
  }), false);

  assert.strictEqual(inferIsDiscLike({
    Path: '/volume1/Media/Film/Movie (2020)/VIDEO_TS',
    MediaSources: [{ Path: '/volume1/Media/Film/Movie (2020)/VIDEO_TS' }],
  }), true);

  assert.strictEqual(inferIsDiscLike({
    MediaSources: [{ Container: 'iso', Path: '/volume1/Media/Film/Movie (2020)/Movie.iso' }],
  }), true);
});

test('probeDiscMetadata derives Blu-ray folder bitrate from selected playlist', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-bdmv-probe-'));
  const bdmv = path.join(root, 'BDMV');
  const stream = path.join(bdmv, 'STREAM');
  const playlist = path.join(bdmv, 'PLAYLIST');
  fs.mkdirSync(stream, { recursive: true });
  fs.mkdirSync(playlist, { recursive: true });

  writeMinimalMpls(path.join(playlist, '00000.mpls'), '00001', 60);
  fs.writeFileSync(path.join(stream, '00001.m2ts'), Buffer.alloc(90_000));

  const meta = await transcodeService.probeDiscMetadata({}, root);

  assert.strictEqual(meta.isDiscLike, true);
  assert.strictEqual(meta.sourceKind, 'bluray_playlist');
  assert.strictEqual(meta.selectedPlaylist, '00000.mpls');
  assert.strictEqual(meta.durationSec, 60);
  assert.strictEqual(meta.sizeBytes, 90_000);
  assert.strictEqual(meta.bitrate, 12_000);

  try { fs.rmSync(root, { recursive: true }); } catch (_) {}
});
