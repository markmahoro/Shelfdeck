'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { basis } = require('./helpers/series-basis');
const { describeFreshResetMetadataRetention } = require('../../src/helix/domains/libra/public');
const { buildOwnerRetentionPolicy } = require('../../scripts/formation-reset-owner-policy');
const manifest = require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
function fixture() {
  const source = basis(), metadataBases = [{ buildId: 'owned-shared-build', basis: source.value }];
  const row = { result: source.observation, resultId: 'exact-result', resultDigest: canonicalDigest(source.observation),
    resultSchemaRef: 'helix://contracts/capabilities/libra.product_metadata.fetch/v1/result',
    outcomeKind: 'succeeded', capabilityRef: 'libra.product_metadata.fetch@1', ownerDomain: 'libra',
    processType: 'libra_run', processId: 'uncommitted-origin-run', workKind: 'product_metadata_observation' };
  const value = { schemaRef: 'arca.fresh-reset-series-retention@1', preservedBuilders: [], droppedHeads: [], metadataBases };
  return { metadataBases, row, seriesRetention: { ...value, digest: canonicalDigest(value) } };
}

test('retained shared metadata selects exact durable evidence without retaining the uncommitted source Run', () => {
  const f = fixture(), metadataRetention = describeFreshResetMetadataRetention({ metadataBases: f.metadataBases, observations: [f.row] });
  const policy = buildOwnerRetentionPolicy(manifest, { seriesRetention: f.seriesRetention, metadataRetention });
  assert.deepEqual(policy.seeds, [{ owner: 'execution-foundation', table: 'fx_event_result_bindings', key: { result_id: 'exact-result' } }]);
  assert.equal(metadataRetention.dependencies[0].libraRunId, 'uncommitted-origin-run');
});

test('missing, changed or foreign shared metadata cannot silently weaken collection evidence', () => {
  const f = fixture();
  assert.throws(() => describeFreshResetMetadataRetention({ metadataBases: f.metadataBases, observations: [] }),
    { code: 'LIBRA_RESET_SHARED_METADATA_MISSING' });
  for (const row of [{ ...f.row, resultDigest: '1'.repeat(64) }, { ...f.row, ownerDomain: 'arca' },
    { ...f.row, result: { ...f.row.result, observedAtMs: f.row.result.observedAtMs + 1 } }])
    assert.throws(() => describeFreshResetMetadataRetention({ metadataBases: f.metadataBases, observations: [row] }),
      { code: 'LIBRA_RESET_SHARED_METADATA_CHANGED' });
  const other = basis(4), row = { ...f.row, result: other.observation, resultDigest: canonicalDigest(other.observation) };
  assert.throws(() => describeFreshResetMetadataRetention({ metadataBases: f.metadataBases, observations: [row] }),
    { code: 'LIBRA_RESET_SHARED_METADATA_MISSING' });
});

test('a missing Owner dependency description or empty substitute blocks the copy policy', () => {
  const f = fixture();
  assert.throws(() => buildOwnerRetentionPolicy(manifest, { seriesRetention: f.seriesRetention }), { code: 'RESET_RETENTION_OWNER_DESCRIPTION_INVALID' });
  const body = { schemaRef: 'libra.fresh-reset-metadata-retention@1', dependencies: [] };
  assert.throws(() => buildOwnerRetentionPolicy(manifest, { seriesRetention: f.seriesRetention,
    metadataRetention: { ...body, digest: canonicalDigest(body) } }), { code: 'RESET_RETENTION_OWNER_DESCRIPTION_INVALID' });
});
