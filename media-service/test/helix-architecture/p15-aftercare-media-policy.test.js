'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  primaryVideoStreams,
  primaryAudioStreams,
  deriveAftercareSizeBudget,
  evaluateAftercareConformance,
  verifyOutputContinuity,
} = require('../../src/helix/domains/arca/model/aftercare-media-policy');

function video(streamIndex, codec, dispositionDefault, width = 1920, height = 1080) {
  return Object.freeze({ streamIndex, codec, dispositionDefault, width, height });
}

function audio(streamIndex, codec, dispositionDefault, extra = {}) {
  return Object.freeze({ streamIndex, codec, dispositionDefault, channels:6,
    channelLayout:'5.1', language:'eng', ...extra });
}

function probe(overrides = {}) {
  return Object.freeze({ resultKind:'probed', container:'matroska', durationMs:6_062_624,
    videoStreams:Object.freeze([video(0, 'hevc', true)]),
    audioStreams:Object.freeze([audio(1, 'eac3', true, { bitRateBps:768_000 })]),
    subtitleStreams:Object.freeze([]), discTopology:null, ...overrides });
}

test('Aftercare primary stream selection is default-first instead of array-first', () => {
  const value = probe({
    videoStreams:Object.freeze([video(0, 'h264', false), video(3, 'hevc', true)]),
    audioStreams:Object.freeze([
      audio(1, 'ac3', false),
      audio(5, 'truehd', true, { normalizedAudioClass:'truehd' }),
    ]),
  });
  assert.deepEqual(primaryVideoStreams(value).map((item) => item.streamIndex), [3]);
  assert.deepEqual(primaryAudioStreams(value).map((item) => item.streamIndex), [5]);
});

test('Aftercare target bitrate is capped to source size while retaining copied stream bitrate', () => {
  const maxSizeBytes = 14 * 1024 ** 3;
  const sourceSizeBytes = 2_077_884_000;
  const result = deriveAftercareSizeBudget({
    maxSizeBytes,
    sourceSizeBytes,
    durationMs:6_062_624,
    audioStreams:[
      audio(1, 'eac3', true, { bitRateBps:768_000 }),
      audio(2, 'eac3', false, { bitRateBps:768_000 }),
    ],
    subtitleStreams:[{ streamIndex:3, codec:'subrip', language:'zho' }],
  });
  assert.equal(result.targetFillBytes, sourceSizeBytes);
  assert.equal(result.audioBitrateBps, 1_536_000);
  assert.equal(result.subtitleBitrateBps, 64_000);
  assert.equal(result.feasible, true);
  assert.ok(result.targetVideoBitrateBps < 2_000_000);
  assert.ok(result.targetVideoBitrateBps < result.capVideoBitrateBps);
});

test('Aftercare size budget preserves measured audio bitrate and fails closed when the cap is infeasible', () => {
  const measured = deriveAftercareSizeBudget({
    maxSizeBytes:1_000_000_000,
    sourceSizeBytes:800_000_000,
    durationMs:3_600_000,
    audioStreams:[audio(1, 'aac', true, { bitRateBps:192_000 })],
    subtitleStreams:[],
  });
  assert.equal(measured.audioBitrateBps, 192_000);
  assert.equal(measured.targetFillBytes, 800_000_000);

  const infeasible = deriveAftercareSizeBudget({
    maxSizeBytes:32 * 1024 * 1024,
    sourceSizeBytes:32 * 1024 * 1024,
    durationMs:7_200_000,
    audioStreams:[audio(1, 'truehd', true, { bitRateBps:8_000_000 })],
    subtitleStreams:[],
  });
  assert.equal(infeasible.feasible, false);
  assert.equal(infeasible.targetVideoBitrateBps, null);
});

test('Aftercare conformance uses default video and rejects stream form and primary audio gaps', () => {
  const mandatoryMedia = {
    mediaForm:'stream_file', videoCodec:'hevc', container:'matroska', fileExtension:'mkv',
    minimumRasterClass:'none', acceptedPrimaryAudioClasses:['truehd'],
  };
  const value = probe({
    discTopology:{ topologyKind:'bluray' },
    videoStreams:Object.freeze([video(0, 'h264', false), video(2, 'hevc', true)]),
    audioStreams:Object.freeze([
      audio(1, 'truehd', false, { normalizedAudioClass:'truehd' }),
      audio(3, 'ac3', true, { normalizedAudioClass:'other' }),
    ]),
  });
  const result = evaluateAftercareConformance({ mandatoryMedia, space:{ maxSizeBytes:50 * 1024 ** 3 },
    probe:value, location:'movie.mkv', sizeBytes:4 * 1024 ** 3 });
  assert.deepEqual(result.reasonCodes, ['media_form_unmet', 'primary_audio_unmet']);
});

test('Aftercare accepts a premium default audio class and detects a real size breach', () => {
  const mandatoryMedia = {
    mediaForm:'stream_file', videoCodec:'hevc', container:'matroska', fileExtension:'mkv',
    minimumRasterClass:'4k', acceptedPrimaryAudioClasses:['truehd'],
  };
  const value = probe({
    videoStreams:Object.freeze([video(0, 'hevc', true, 3840, 2160)]),
    audioStreams:Object.freeze([audio(1, 'truehd', true, { normalizedAudioClass:'truehd' })]),
  });
  const healthy = evaluateAftercareConformance({ mandatoryMedia, space:{ maxSizeBytes:10_000 },
    probe:value, location:'movie.mkv', sizeBytes:9_999 });
  assert.deepEqual(healthy, { passed:true, reasonCodes:[] });
  const oversized = evaluateAftercareConformance({ mandatoryMedia, space:{ maxSizeBytes:10_000 },
    probe:value, location:'movie.mkv', sizeBytes:10_001 });
  assert.deepEqual(oversized.reasonCodes, ['max_size_exceeded']);
});

test('Aftercare rejects a system-upscaled 4K result against its frozen source probe', () => {
  const mandatoryMedia = {
    mediaForm:'stream_file', videoCodec:'hevc', container:'matroska', fileExtension:'mkv',
    minimumRasterClass:'4k', forbidSystemUpscaleFor4k:true, acceptedPrimaryAudioClasses:[],
  };
  const source = probe({ videoStreams:Object.freeze([video(0, 'hevc', true, 1920, 1080)]) });
  const output = probe({ videoStreams:Object.freeze([video(0, 'hevc', true, 3840, 2160)]) });
  const result = evaluateAftercareConformance({ mandatoryMedia, space:{ maxSizeBytes:50 * 1024 ** 3 },
    probe:output, sourceProbe:source, location:'movie.mkv', sizeBytes:4 * 1024 ** 3 });
  assert.deepEqual(result.reasonCodes, ['system_upscale_forbidden']);
});

test('Aftercare output continuity compares copied streams independent of stream ordering', () => {
  const firstAudio = audio(1, 'truehd', true, { normalizedAudioClass:'truehd' });
  const secondAudio = audio(2, 'aac', false, { channels:2, channelLayout:'stereo', language:'zho' });
  const firstSubtitle = Object.freeze({ streamIndex:3, codec:'subrip', language:'zho', dispositionDefault:true });
  const source = probe({ audioStreams:Object.freeze([firstAudio, secondAudio]),
    subtitleStreams:Object.freeze([firstSubtitle]) });
  const output = probe({ audioStreams:Object.freeze([{ ...secondAudio, streamIndex:1 }, { ...firstAudio, streamIndex:2 }]),
    subtitleStreams:Object.freeze([{ ...firstSubtitle, streamIndex:3 }]), durationMs:6_063_000 });
  assert.deepEqual(verifyOutputContinuity({ sourceProbe:source, outputProbe:output }),
    { passed:true, reasonCodes:[] });
});

test('Aftercare output continuity fails closed on lost streams and duration drift', () => {
  const source = probe({
    audioStreams:Object.freeze([
      audio(1, 'truehd', true, { normalizedAudioClass:'truehd' }),
      audio(2, 'aac', false, { channels:2, channelLayout:'stereo', language:'zho' }),
    ]),
    subtitleStreams:Object.freeze([{ streamIndex:3, codec:'subrip', language:'zho' }]),
  });
  const output = probe({ audioStreams:Object.freeze(source.audioStreams.slice(0, 1)),
    subtitleStreams:Object.freeze([]), durationMs:source.durationMs - 30_000 });
  assert.deepEqual(verifyOutputContinuity({ sourceProbe:source, outputProbe:output }).reasonCodes, [
    'audio_stream_set_changed',
    'duration_continuity_unmet',
    'subtitle_stream_set_changed',
  ]);
});

test('Aftercare output continuity rejects a lost secondary video or changed default video', () => {
  const source = probe({ videoStreams:Object.freeze([
    video(0, 'h264', true),
    video(4, 'h264', false, 1280, 720),
  ]) });
  const lost = probe({ videoStreams:Object.freeze([video(0, 'hevc', true)]) });
  assert.deepEqual(verifyOutputContinuity({ sourceProbe:source, outputProbe:lost }).reasonCodes,
    ['video_stream_set_changed']);

  const changedDefault = probe({ videoStreams:Object.freeze([
    video(0, 'hevc', false),
    video(4, 'hevc', false, 1280, 720),
  ]) });
  assert.deepEqual(verifyOutputContinuity({ sourceProbe:source, outputProbe:changedDefault }).reasonCodes,
    ['video_stream_set_changed']);
});
