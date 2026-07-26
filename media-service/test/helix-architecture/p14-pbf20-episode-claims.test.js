'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  canonicalDigest,
  canonicalJson,
} = require('../../src/helix/contracts/canonical-json');
const {
  buildArcaMaterialEpisodeClaims,
  emptyArcaMaterialEpisodeClaims,
  fromProductMember,
  parseArcaMaterialEpisodeClaims,
} = require('../../src/helix/domains/arca/model/material-episode-claims');
const {
  buildArcaApplicationSchemas,
} = require('../../scripts/helix-architecture/arca-application-schema-builder');

const serviceRoot = path.resolve(__dirname, '../..');
const contractsRoot = path.join(serviceRoot, 'src', 'helix', 'contracts');

function claim(episodeKey) {
  const seasonClaimDigest = canonicalDigest({
    schema: 'test.season-claim@1',
    episodeKey,
  });
  return {
    episodeKey,
    seasonClaimDigest,
    claimDigest: canonicalDigest({
      schema: 'libra.production-material-episode-claim@1',
      episodeKey,
      seasonClaimDigest,
    }),
  };
}

function set(items) {
  return {
    items,
    episodeClaimSetDigest: canonicalDigest({
      schema: 'libra.production-material-episode-claims@1',
      items,
    }),
  };
}

test('materializes the exact PBF-20 Arca claim-set and table contracts', () => {
  const expected = buildArcaApplicationSchemas()
    .ArcaMaterialEpisodeClaims;
  const stored = JSON.parse(fs.readFileSync(path.join(
    contractsRoot,
    'application-types',
    'ArcaMaterialEpisodeClaims',
    'v1',
    'schema.json',
  ), 'utf8'));
  assert.deepEqual(stored, expected);
  assert.equal(stored['x-helix-maxCanonicalBytes'], 16384);
  assert.equal(stored.properties.items.maxItems, 32);

  for (const tableId of [
    'arca_material_bindings',
    'arca_inventory_materials',
  ]) {
    const table = JSON.parse(fs.readFileSync(path.join(
      contractsRoot,
      'table-contracts',
      tableId,
      'v1',
      'contract.json',
    ), 'utf8')).contract;
    const names = table.columns.map((column) => column.name);
    assert.equal(names.includes('episode_key'), false);
    assert.equal(names.includes('episode_claims_schema_ref'), true);
    assert.equal(names.includes('episode_claims_json'), true);
    assert.equal(names.includes('episode_claim_set_digest'), true);
    const json = table.jsonContracts.find((item) =>
      item.column === 'episode_claims_json');
    assert.equal(json.maxBytes, 16384);
    assert.equal(json.schemaRefColumn, 'episode_claims_schema_ref');
  }
});

test('accepts one physical Series member with E001+E002 and Movie empty-set', () => {
  const value = set([claim('E001'), claim('E002')]);
  assert.deepEqual(buildArcaMaterialEpisodeClaims(value, {
    requireNonEmpty: true,
  }), value);
  assert.deepEqual(fromProductMember({
    role: 'primary_payload',
    episodeClaims: value.items,
    episodeClaimSetDigest: value.episodeClaimSetDigest,
  }, 'series'), value);
  assert.deepEqual(emptyArcaMaterialEpisodeClaims().items, []);
  assert.deepEqual(fromProductMember({
    role: 'primary_payload',
    episodeClaims: [],
    episodeClaimSetDigest:
      emptyArcaMaterialEpisodeClaims().episodeClaimSetDigest,
  }, 'movie').items, []);
});

test('rejects missing, duplicate, unsorted, tampered, and non-primary claims', () => {
  const first = claim('E001');
  const second = claim('E002');
  assert.throws(() => buildArcaMaterialEpisodeClaims(
    set([]), { requireNonEmpty: true }),
  /requires Episode Claims/);
  assert.throws(() => buildArcaMaterialEpisodeClaims(
    set([first, first])),
  /unique and UTF-8 ordered/);
  assert.throws(() => buildArcaMaterialEpisodeClaims(
    set([second, first])),
  /unique and UTF-8 ordered/);
  assert.throws(() => buildArcaMaterialEpisodeClaims({
    items: [{ ...first, claimDigest: '0'.repeat(64) }],
    episodeClaimSetDigest: set([first]).episodeClaimSetDigest,
  }), /digest is invalid/);
  assert.throws(() => buildArcaMaterialEpisodeClaims(
    set([first]), { requireEmpty: true }),
  /requires an empty Episode Claim set/);

  const legal = set([first]);
  assert.throws(() => parseArcaMaterialEpisodeClaims({
    episode_claims_schema_ref:
      'helix://contracts/application-types/ArcaMaterialEpisodeClaims/v1',
    episode_claims_json: canonicalJson(legal),
    episode_claim_set_digest: '0'.repeat(64),
  }), /persistence digest is invalid/);
});

test('rejects closed-shape drift and an Episode key longer than 256 code points', () => {
  const first = claim('E001');
  const legal = set([first]);
  assert.throws(() => buildArcaMaterialEpisodeClaims({
    ...legal,
    unexpected: true,
  }), /exact closed schema/);
  assert.throws(() => buildArcaMaterialEpisodeClaims({
    ...legal,
    items: [{ ...first, unexpected: true }],
  }), /identity is invalid/);

  const episodeKey = 'E'.repeat(257);
  const seasonClaimDigest = first.seasonClaimDigest;
  const oversized = {
    episodeKey,
    seasonClaimDigest,
    claimDigest: canonicalDigest({
      schema: 'libra.production-material-episode-claim@1',
      episodeKey,
      seasonClaimDigest,
    }),
  };
  assert.throws(() => buildArcaMaterialEpisodeClaims(set([oversized])),
    /identity is invalid/);
});
