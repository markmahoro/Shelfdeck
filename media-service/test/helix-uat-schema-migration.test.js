'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { digest } = require('../src/helix/foundation/persistence/ddl-compiler');
const { openSqliteKernel } = require('../src/helix/foundation/persistence/sqlite-kernel');
const {
  SOURCE_GENERATION,
  SOURCE_SCHEMA_DIGEST,
  TARGET_GENERATION,
  TARGET_SCHEMA_DIGEST,
  migrateUatIdentitySelectionSchema,
} = require('../src/helix/foundation/persistence/uat-identity-selection-migration');

const generatedRoot = path.resolve(__dirname, '../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));

function catalogRows(database) {
  return database.prepare(
    "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
  ).all().map((row) => ({ ...row, sql: row.sql && row.sql.replaceAll('\r\n', '\n') }));
}

function sourceFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-uat-schema-migration-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 100 });
  kernel.close();
  const database = new Database(databasePath);
  database.exec('DROP TABLE libra_product_identity_selection_intents');
  database.prepare('INSERT INTO fx_audit_records(audit_id,occurred_at_ms) VALUES(?,?)').run('preserved-audit', 101);
  const sourceCatalogDigest = digest(catalogRows(database));
  database.prepare(
    'UPDATE platform_schema_marker SET generation=?,schema_digest=?,catalog_digest=?,applied_at_ms=? WHERE schema_name=?',
  ).run(SOURCE_GENERATION, SOURCE_SCHEMA_DIGEST, sourceCatalogDigest, 102, 'shelfdeck');
  database.close();
  try { return run({ root, databasePath }); } finally { fs.rmSync(root, { recursive:true, force:true }); }
}

test('the exact live v1 catalog upgrades once to v2 without changing durable business facts', () => sourceFixture(({ databasePath }) => {
  const first = migrateUatIdentitySelectionSchema({ Database, databasePath, schemaManifest, now: () => 200 });
  assert.deepEqual(first, {
    migrated:true,
    sourceSchemaDigest:SOURCE_SCHEMA_DIGEST,
    targetSchemaDigest:TARGET_SCHEMA_DIGEST,
  });
  const database = new Database(databasePath, { readonly:true });
  const marker = database.prepare(
    'SELECT generation,schema_digest FROM platform_schema_marker WHERE schema_name=?',
  ).get('shelfdeck');
  assert.deepEqual(marker, { generation:TARGET_GENERATION, schema_digest:TARGET_SCHEMA_DIGEST });
  assert.equal(database.prepare(
    "SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name='libra_product_identity_selection_intents'",
  ).get().count, 1);
  assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_audit_records WHERE audit_id=?').get('preserved-audit').count, 1);
  assert.equal(database.pragma('integrity_check', { simple:true }), 'ok');
  database.close();
  assert.deepEqual(
    migrateUatIdentitySelectionSchema({ Database, databasePath, schemaManifest, now: () => 201 }),
    { migrated:false, reason:'already_current' },
  );
}));

test('an unapproved source digest is rejected before schema mutation', () => sourceFixture(({ databasePath }) => {
  const database = new Database(databasePath);
  database.prepare('UPDATE platform_schema_marker SET schema_digest=? WHERE schema_name=?')
    .run('0'.repeat(64), 'shelfdeck');
  database.close();
  assert.throws(
    () => migrateUatIdentitySelectionSchema({ Database, databasePath, schemaManifest, now: () => 300 }),
    (error) => error?.code === 'UAT_MIGRATION_SOURCE_SCHEMA_UNSUPPORTED',
  );
  const check = new Database(databasePath, { readonly:true });
  assert.equal(check.prepare(
    "SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name='libra_product_identity_selection_intents'",
  ).get().count, 0);
  assert.equal(check.prepare('SELECT COUNT(*) count FROM fx_audit_records WHERE audit_id=?').get('preserved-audit').count, 1);
  check.close();
}));
