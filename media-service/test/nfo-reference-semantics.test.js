'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { observeNfoReferenceSemantics:observe, preservesNfoReferenceSemantics:preserves } =
  require('../src/helix/contracts/nfo-reference-semantics');

const original = '<movie><title>A &amp; B</title><year>2025</year><tmdbid>123</tmdbid>' +
  '<genre>Drama / Crime</genre><plot>Original plot</plot>' +
  '<actor><name>Actor</name><tmdbid>42</tmdbid></actor></movie>';

test('source NFO facts survive XML representation changes, sets and unrelated enrichment', () => {
  const changed = original.replace('A &amp; B', '<![CDATA[A & B]]>')
    .replace('<genre>Drama / Crime</genre>', '<genre>Crime</genre><genre>Drama</genre><genre>Drama</genre>')
    .replace('</movie>', '<dateadded>2026-09-07</dateadded><rating>8</rating></movie>');
  assert.deepEqual(observe(original), observe(changed));
  assert.equal(preserves(observe(original), observe(changed)), true);
  assert.equal(preserves(observe(original), observe(changed.replace('</movie>', '<studio>New studio</studio></movie>'))), true);
});

test('source NFO identity, owned values and actor identity cannot disappear or conflict', () => {
  for (const changed of [original.replace('123', '999'), original.replace('Original plot', 'Wrong plot'),
    original.replace('<year>2025</year>', ''), original.replace('42', '99'),
    original.replace('</movie>', '<uniqueid type="tmdb">999</uniqueid></movie>'), '<movie/>']) {
    assert.equal(preserves(observe(original), observe(changed)), false);
  }
  const basis = observe(original);
  assert.equal(preserves({...basis,recordDigest:'0'.repeat(64)}, observe(original)), false);
  assert.equal(preserves(null, observe(original)), false);
});

test('release-date aliases preserve one fact and cannot hide changed or conflicting dates', () => {
  const dated = original.replace('</movie>', '<premiered>2025-06-12</premiered></movie>');
  const renamed = dated.replaceAll('premiered', 'releasedate');
  assert.deepEqual(observe(dated), observe(renamed));
  assert.equal(preserves(observe(dated), observe(renamed)), true);
  assert.equal(preserves(observe(dated), observe(original)), false);
  assert.equal(preserves(observe(dated), observe(renamed.replace('2025-06-12','2025-06-13'))), false);
  assert.equal(observe(dated.replace('</movie>', '<releasedate>2025-06-13</releasedate></movie>')), null);
  assert.deepEqual(observe(dated.replace('</movie>', '<releasedate>2025-06-12</releasedate></movie>')), observe(dated));
});

test('an actor identity remains protected when its source display name is absent', () => {
  const idOnly = original.replace('<name>Actor</name>', '');
  assert.equal(preserves(observe(idOnly), observe(original)), true);
  assert.equal(preserves(observe(idOnly), observe(idOnly.replace('42','99'))), false);
  assert.equal(preserves(observe(idOnly), observe(idOnly.replace('<tmdbid>42</tmdbid>',''))), false);
});
