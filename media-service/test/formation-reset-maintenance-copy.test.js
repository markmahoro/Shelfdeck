'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const Database = require('better-sqlite3');
const { openSqliteKernel } = require('../src/helix/foundation/persistence/sqlite-kernel');
const { createRetainedDatabase } = require('../scripts/formation-reset-copy');
const { buildOwnerRetentionPolicy } = require('../scripts/formation-reset-owner-policy');
const targetSchema = { schemaManifest: require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),
  schemaDdl: fs.readFileSync(path.join(__dirname, '../src/helix/foundation/persistence/generated/clean-schema.sql'), 'utf8') };

test('exact collection maintenance workspaces survive without retaining an unrelated Artifact consumer', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maintenance-copy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source.db'), targetPath = path.join(root, 'new.db');
  openSqliteKernel({ Database, databasePath: sourcePath, ...targetSchema }).close();
  const source = new Database(sourcePath);
  try {
    // Relation-level fixture: the test proves dependency selection, not a
    // committed media journey or validity of these minimal collection facts.
    source.exec(`INSERT INTO arca_shelves(shelf_id,status) VALUES('shelf','active');
      INSERT INTO arca_shelf_entries(shelf_entry_id,shelf_id,status) VALUES('collection','shelf','active');
      INSERT INTO arca_aftercare_cases(aftercare_case_id,shelf_entry_id,state) VALUES('care','collection','active');
      INSERT INTO fx_workspace_registry(workspace_id,owner_domain,process_type,process_id,state)
        VALUES('care-workspace','arca','aftercare_case','care','active'),('orphan-workspace','arca','aftercare_case','orphan','active');
      INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,state)
        VALUES('maintenance-work','arca','arca_shelf_entry','collection','running'),('orphan-work','arca','arca_shelf_entry','missing','running');
      INSERT INTO fx_artifact_registry(artifact_handle_id,owner_domain,owner_scope_type,owner_scope_id,artifact_kind,state)
        VALUES('poster','arca','aftercare_case','care','poster','active');
      INSERT INTO fx_artifact_references(artifact_handle_id,consumer_domain,consumer_scope_type,consumer_scope_id,reference_kind,reference_revision,state)
        VALUES('poster','arca','aftercare_case','care','input',1,'active'),('poster','libra','libra_run','uncommitted','input',1,'active');`);
  } finally { source.close(); }
  createRetainedDatabase({ Database, sourcePath, targetPath, targetSchema, policy: buildOwnerRetentionPolicy(targetSchema.schemaManifest) });
  const copied = new Database(targetPath, { readonly: true });
  try {
    assert.deepEqual(copied.prepare('SELECT workspace_id FROM fx_workspace_registry').all(), [{ workspace_id: 'care-workspace' }]);
    assert.deepEqual(copied.prepare('SELECT work_id FROM fx_supporting_works').all(), [{ work_id: 'maintenance-work' }]);
    assert.deepEqual(copied.prepare('SELECT consumer_scope_id FROM fx_artifact_references').all(), [{ consumer_scope_id: 'care' }]);
    assert.equal(copied.prepare('SELECT count(*) n FROM fx_artifact_registry').get().n, 1);
    assert.deepEqual(copied.pragma('foreign_key_check'), []);
  } finally { copied.close(); }
});
