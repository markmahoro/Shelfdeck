'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  RULE_REVISION,
  deriveTitleYearEvidence,
  normalizeAlias,
  stripReleaseSuffix,
  titleAliases,
} = require('../src/helix/domains/perception/model/perception-aliases');

test('Perception alias rule revision 2 expands Douban multilingual titles with the same year', () => {
  assert.equal(RULE_REVISION, 2);
  const evidence = deriveTitleYearEvidence('肖申克的救赎 / The Shawshank Redemption' + '\0' + '1994', {
    providerDelimited: true,
  });
  assert.deepEqual(evidence.map((item) => item.anchorValue), [
    '肖申克的救赎' + '\0' + '1994',
    'The Shawshank Redemption' + '\0' + '1994',
  ]);
  assert.ok(evidence.every((item) => item.aliasRuleRevision === 2));
});

test('Subject release labels are removed without weakening exact title and year matching', () => {
  assert.equal(stripReleaseSuffix('The Matrix - 2160p Remux DTS-HD'), 'The Matrix');
  assert.deepEqual(titleAliases('The Matrix - 2160p Remux DTS-HD', { stripTechnical: true }), [
    'The Matrix - 2160p Remux DTS-HD',
    'The Matrix',
  ]);
  assert.equal(normalizeAlias('  ＴＨＥ   Matrix  '), 'the matrix');
  assert.notEqual(normalizeAlias('The Matrix' + '\0' + '1999'), normalizeAlias('The Matrix' + '\0' + '2021'));
});

test('Provider title splitting does not invent fuzzy aliases', () => {
  assert.deepEqual(titleAliases('同名电影 / Same Name', { providerDelimited: true }), [
    '同名电影',
    'Same Name',
  ]);
  assert.deepEqual(titleAliases('同名电影/Same Name', { providerDelimited: true }), [
    '同名电影/Same Name',
  ]);
});
