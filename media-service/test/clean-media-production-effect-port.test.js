'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const ffmpegPath = require('ffmpeg-static');
const { runProcess } = require('../src/clean-media-production-effect-port');

test('contains progress persistence failures inside the media effect promise', async () => {
  const failure = Object.assign(new Error('progress conflict'), {
    code: 'P4_PROGRESS_SOURCE_SEQUENCE_CONFLICT',
  });
  await assert.rejects(runProcess(ffmpegPath, [
    '-hide_banner', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'color=c=black:s=16x16:r=1',
    '-t', '0.1', '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null',
  ], 10_000, {
    prefix: 'test-progress',
    report() { throw failure; },
  }), (error) => error === failure);
});
