'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { digest } = require('../src/helix/foundation/persistence/ddl-compiler');
const { migrateUatIdentitySelectionSchema, PRE_SECONDARY_TARGET_SCHEMA_DIGEST, TARGET_SCHEMA_DIGEST } = require('../src/helix/foundation/persistence/uat-identity-selection-migration');
const { rollbackSecondaryTargetSchema } = require('../src/helix/foundation/persistence/secondary-target-schema-rollback');
const generated = path.resolve(__dirname, '../src/helix/foundation/persistence/generated');
const schemaManifest = require(path.join(generated, 'clean-schema.manifest.json'));
const ddl = fs.readFileSync(path.join(generated, 'clean-schema.sql'), 'utf8');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-secondary-rollback-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const baselinePath = path.join(root, 'baseline.db'), databasePath = path.join(root, 'candidate.db');
  const db = new Database(baselinePath);
  db.exec(ddl.replace("'frozen', 'secondary_target', 'defect_admitted'", "'frozen', 'defect_admitted'"));
  db.exec("INSERT INTO libra_runs(libra_run_id,state) VALUES('preserved','frozen')");
  db.exec("INSERT INTO libra_run_revisions(libra_run_id,state_revision,transition_kind,expected_admission_head_revision) VALUES('preserved',1,'frozen',0)");
  const catalog = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all().map(row => ({ ...row, sql: row.sql && row.sql.replaceAll('\r\n','\n') }));
  db.prepare('INSERT INTO platform_schema_marker(schema_name,generation,schema_digest,catalog_digest,applied_at_ms) VALUES(?,?,?,?,?)')
    .run('shelfdeck', 'helix-clean-v3', PRE_SECONDARY_TARGET_SCHEMA_DIGEST, digest(catalog), 100);
  db.close(); fs.copyFileSync(baselinePath, databasePath);
  migrateUatIdentitySelectionSchema({ Database, databasePath, schemaManifest });
  return { Database, databasePath, baselinePath };
}
test('bounded offline rollback restores original DDL and marker without replacing any business row', t => {
  const f = fixture(t);
  assert.deepEqual(rollbackSecondaryTargetSchema(f), { eligible:true, applied:false, verifiedTables:197 });
  assert.deepEqual(rollbackSecondaryTargetSchema({ ...f, apply:true }), { eligible:true, applied:true, verifiedTables:197 });
  const db = new Database(f.databasePath), old = new Database(f.baselinePath);
  assert.deepEqual(db.prepare('SELECT * FROM libra_run_revisions').all(), old.prepare('SELECT * FROM libra_run_revisions').all());
  assert.deepEqual(db.prepare('SELECT * FROM platform_schema_marker').all(), old.prepare('SELECT * FROM platform_schema_marker').all());
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.equal(db.pragma('integrity_check', {simple:true}), 'ok');
  db.close(); old.close();
  assert.equal(migrateUatIdentitySelectionSchema({ ...f, schemaManifest }).migrated, true);
});
for (const [name, sql] of [
  ['new secondary revision', "INSERT INTO libra_run_revisions(libra_run_id,state_revision,transition_kind,expected_admission_head_revision) VALUES('preserved',2,'secondary_target',0)"],
  ['changed business fact', "UPDATE libra_runs SET state='discarded' WHERE libra_run_id='preserved'"],
  ['new unrelated fact', "INSERT INTO libra_runs(libra_run_id,state) VALUES('new','frozen')"],
]) test('rollback refuses ' + name + ' and preserves it', t => {
  const f = fixture(t), db = new Database(f.databasePath); db.exec(sql); db.close();
  assert.throws(() => rollbackSecondaryTargetSchema({ ...f, apply:true }), {code:'UAT_ROLLBACK_NEW_OR_CHANGED_FACTS'});
  const check = new Database(f.databasePath);
  assert.equal(check.prepare('SELECT schema_digest FROM platform_schema_marker').get().schema_digest, TARGET_SCHEMA_DIGEST);
  if (name === 'new secondary revision') assert.equal(check.prepare("SELECT count(*) n FROM libra_run_revisions WHERE transition_kind='secondary_target'").get().n, 1);
  check.close();
});
