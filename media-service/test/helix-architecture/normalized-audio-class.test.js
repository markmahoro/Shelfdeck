'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  collectFormatTags,
  normalizeAudioClass,
} = require('../../src/helix/contracts/normalized-audio-class');

test('maps MediaProbeEvidence audio class from folded codec, profile, and tags', () => {
  assert.equal(normalizeAudioClass({
    codec: 'EAC3', profile: 'Dolby Digital Plus', formatTags: ['JOC'],
  }), 'eac3_atmos');
  assert.equal(normalizeAudioClass({
    codec: 'eac3', profile: 'unknown', formatTags: ['Dolby Atmos'],
  }), 'eac3_atmos');
  assert.equal(normalizeAudioClass({
    codec: 'eac3', profile: 'unknown', formatTags: [],
  }), 'other');
  assert.equal(normalizeAudioClass({
    codec: 'truehd', profile: 'TrueHD', formatTags: ['Atmos'],
  }), 'truehd_atmos');
  assert.equal(normalizeAudioClass({
    codec: 'TrueHD', profile: 'truehd', formatTags: [],
  }), 'truehd');
  assert.equal(normalizeAudioClass({
    codec: 'dts', profile: 'DTS', formatTags: ['DTS:X'],
  }), 'dts_x');
  assert.equal(normalizeAudioClass({
    codec: 'DTS', profile: 'DTS-HD MA', formatTags: [],
  }), 'dts_hd_ma');
  assert.equal(normalizeAudioClass({
    codec: 'dts', profile: 'DTS-HD Master Audio', formatTags: [],
  }), 'dts_hd_ma');
  assert.equal(normalizeAudioClass({
    codec: 'dts', profile: 'DTS', formatTags: [],
  }), 'other');
  assert.equal(normalizeAudioClass({
    codec: 'aac', profile: 'lc', formatTags: ['Atmos'],
  }), 'other');
});

test('collects bounded unique format tags in UTF-8 byte order', () => {
  assert.deepEqual(collectFormatTags({
    tags: { title: 'Atmos', language: 'eng', titleDup: 'Atmos', empty: '  ' },
  }), ['Atmos', 'eng']);
  assert.deepEqual(collectFormatTags({ formatTags: ['JOC', 'Atmos', 'JOC'] }), ['Atmos', 'JOC']);
});
