'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  RULE_REVISION,
  deriveTitleEvidence,
  deriveTitleYearEvidence,
  normalizeAlias,
  stripReleaseSuffix,
  titleAssociationAliases,
  titleAliases,
} = require('../src/helix/domains/perception/model/perception-aliases');

test('Perception alias rule revision 3 projects historical multilingual title-year evidence to titles', () => {
  assert.equal(RULE_REVISION, 3);
  const historical = deriveTitleYearEvidence('肖申克的救赎 / The Shawshank Redemption' + '\0' + '1994', {
    providerDelimited: true,
  });
  assert.deepEqual(historical.map((item) => item.anchorValue), [
    '肖申克的救赎' + '\0' + '1994',
    'The Shawshank Redemption' + '\0' + '1994',
  ]);
  const current = deriveTitleEvidence('肖申克的救赎 / The Shawshank Redemption' + '\0' + '1994', {
    providerDelimited: true,
  });
  assert.deepEqual(current.map((item) => item.anchorValue), ['肖申克的救赎','The Shawshank Redemption']);
  assert.ok(current.every((item) => item.aliasRuleRevision === 3));
});

test('Subject release labels and terminal years are removed from rating association titles', () => {
  assert.equal(stripReleaseSuffix('The Matrix - 2160p Remux DTS-HD'), 'The Matrix');
  assert.equal(stripReleaseSuffix('看不见的朋友 (2023) - 1080p H.264 CHDWEB'), '看不见的朋友');
  assert.deepEqual(titleAliases('The Matrix - 2160p Remux DTS-HD', { stripTechnical: true }), [
    'The Matrix - 2160p Remux DTS-HD',
    'The Matrix',
  ]);
  assert.deepEqual(titleAssociationAliases('看不见的朋友 (2023) - 1080p H.264 CHDWEB'), ['看不见的朋友']);
  assert.deepEqual(titleAssociationAliases('看不见的朋友 (2024) - 1080p H.264 CHDWEB'), ['看不见的朋友']);
  assert.equal(normalizeAlias('  ＴＨＥ   Matrix  '), 'the matrix');
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
