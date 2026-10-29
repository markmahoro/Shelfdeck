'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { openSqliteKernel, verifyReadOnlySqliteSnapshot } = require('../src/helix/foundation/persistence/sqlite-kernel');
const { initializeResetTarget } = require('../scripts/formation-reset-schema');
const { createRetainedDatabase } = require('../scripts/formation-reset-copy');
const { buildOwnerRetentionPolicy } = require('../scripts/formation-reset-owner-policy');
const { readResetOwnerSnapshot } = require('../scripts/formation-reset-owner-snapshot');
const { verifyRetainedCollections } = require('../scripts/formation-reset-verify');
const olderSchema = require('./helpers/plan-contract-target-schema');
const sourceSchema = require('./helpers/formation-reset-239-schema');

const targetSchema = {
  schemaDdl: fs.readFileSync(path.join(__dirname, '../src/helix/foundation/persistence/generated/clean-schema.sql'), 'utf8'),
  schemaManifest: require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),
};

function fixture(t, schema = sourceSchema) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-239-transition-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source.db'), targetPath = path.join(root, 'target.db');
  openSqliteKernel({ Database, databasePath: sourcePath, ...schema }).close();
  return { sourcePath, targetPath };
}

function initialize({ sourcePath, targetPath }, schema = targetSchema) {
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    source.pragma('query_only=ON');
    source.exec('BEGIN');
    return initializeResetTarget({ Database, targetPath, source, ...schema });
  } finally {
    if (source.inTransaction) source.exec('ROLLBACK');
    source.close();
  }
}

test('the exact 239-table production schema can create an isolated 244-table cold target', t => {
  const f = fixture(t), before = fs.readFileSync(f.sourcePath), transition = initialize(f);
  assert.deepEqual(transition.addedTables, [
    'arca_offer_withdrawal_receipts', 'libra_custom_target_heads', 'libra_custom_target_intents',
    'libra_custom_target_previews', 'libra_us_adult_catalogue_bases',
  ]);
  assert.deepEqual(transition.addedNullableColumns, {});
  assert.deepEqual(fs.readFileSync(f.sourcePath), before);
  const target = new Database(f.targetPath, { readonly: true, fileMustExist: true });
  try {
    target.exec('BEGIN');
    verifyReadOnlySqliteSnapshot({ database: target, ...targetSchema });
    for (const table of transition.addedTables) assert.equal(target.prepare('SELECT count(*) n FROM ' + table).get().n, 0);
  } finally {
    if (target.inTransaction) target.exec('ROLLBACK');
    target.close();
  }
});

test('a 239 source with an unreviewed object cannot use the cold transition', t => {
  const f = fixture(t), source = new Database(f.sourcePath);
  source.exec('CREATE INDEX reset_unreviewed ON arca_shelf_entries(status)');
  source.close();
  assert.throws(() => initialize(f), { code: 'RESET_SOURCE_SCHEMA_UNREVIEWED' });
});

test('a 239 source with an altered marker cannot use the cold transition', t => {
  const f = fixture(t), source = new Database(f.sourcePath);
  source.prepare('UPDATE platform_schema_marker SET schema_digest=?').run('a'.repeat(64));
  source.close();
  assert.throws(() => initialize(f), { code: 'RESET_SOURCE_SCHEMA_MARKER_INVALID' });
});

test('a 239 catalog with the older 235 marker cannot claim the reviewed transition', t => {
  const f = fixture(t), source = new Database(f.sourcePath);
  source.prepare('UPDATE platform_schema_marker SET schema_digest=?').run(olderSchema.schemaManifest.ddlDigest);
  source.close();
  assert.throws(() => initialize(f), { code: 'RESET_SOURCE_SCHEMA_UNREVIEWED' });
});

test('a current 244-table source needs no structural transition', t => {
  const f = fixture(t, targetSchema), transition = initialize(f);
  assert.deepEqual(transition.addedTables, []);
  assert.deepEqual(transition.addedNullableColumns, {});
});

test('the existing 235-to-239 cold qualification remains available', t => {
  const f = fixture(t, olderSchema), transition = initialize(f, sourceSchema);
  assert.deepEqual(transition.addedTables, ['libra_episode_metadata_mapping_heads',
    'libra_episode_metadata_mapping_intents', 'libra_episode_metadata_reviews', 'proc_field_reset_barriers']);
  assert.deepEqual(transition.addedNullableColumns, { libra_runs: ['episode_metadata_mapping_intent_id'] });
});

test('an isolated empty 239 source can copy and verify a 244 candidate under the Owner classifications', t => {
  const f=fixture(t),before=fs.readFileSync(f.sourcePath),owner=readResetOwnerSnapshot({Database,sourcePath:f.sourcePath}),
    policy=buildOwnerRetentionPolicy(targetSchema.schemaManifest,owner);
  const copy=createRetainedDatabase({Database,...f,targetSchema,policy});
  assert.equal(copy.schemaTransition.addedTables.length,5);
  assert.deepEqual(fs.readFileSync(f.sourcePath),before);
  const result=verifyRetainedCollections({Database,...f,...targetSchema});
  assert.equal(result.withdrawals.count,0);
  assert.equal(result.customTargets.count,0);
  assert.equal(result.reconstructedCommits,0);
});
