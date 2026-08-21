'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { openSqliteKernel } = require('../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createFormationStatusProjection } = require('../src/helix/domains/arca/application/formation-status-projection');

const generatedRoot = path.resolve(__dirname, '../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const digest = (value) => String(value).padStart(64, '0').slice(-64);

test('Arca Formation completion requires one On-deck Commit, Shelf Entry, and matching active Deck Fact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-formation-arca-status-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 100 });
  const database = new Database(databasePath);
  database.pragma('foreign_keys = OFF');
  const receipt = database.prepare(`INSERT INTO arca_handoff_b_receipts(
    receipt_id,acceptance_decision_id,outcome,offer_id,custody_id,on_deck_package_id,package_digest,
    arca_binding_set_digest,control_revision_set_digest,related_disposition_set_digest,rejection_code,
    acceptance_evidence_set_digest,rejection_digest,receipt_digest,committed_at_ms)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  receipt.run('receipt-rejected','decision-rejected','rejected','offer-rejected',null,'package-rejected',digest(1),
    null,null,digest(2),'mandatory_media_failed',digest(3),digest(4),digest(5),10);
  receipt.run('receipt-pending','decision-pending','accepted','offer-pending','custody-pending','package-pending',digest(6),
    digest(7),digest(8),digest(9),null,digest(10),null,digest(11),11);
  receipt.run('receipt-complete','decision-complete','accepted','offer-complete','custody-complete','package-complete',digest(12),
    digest(13),digest(14),digest(15),null,digest(16),null,digest(17),12);
  const run = database.prepare('INSERT INTO arca_ondeck_runs(on_deck_run_id,custody_id,final_inventory_decision_digest,state,created_at_ms,terminal_at_ms) VALUES(?,?,?,?,?,?)');
  run.run('run-pending','custody-pending',digest(18),'offloading',20,20);
  run.run('run-complete','custody-complete',digest(19),'committed',21,30);
  database.prepare('INSERT INTO arca_shelf_entries(shelf_entry_id,shelf_id,structure_kind,status,canonical_identity_revision,canonical_identity_key,current_inventory_revision,current_deck_fact_revision,created_at_ms,terminal_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run('entry-complete','shelf','single','active',1,digest(20),1,1,30,null);
  database.prepare('INSERT INTO arca_deck_fact_revisions(shelf_entry_id,revision,state,inventory_revision,standard_revision,fact_digest,committed_at_ms) VALUES(?,?,?,?,?,?,?)')
    .run('entry-complete',1,'active',1,1,digest(21),30);
  database.prepare('INSERT INTO arca_ondeck_commit_receipts(receipt_id,on_deck_run_id,shelf_entry_id,inventory_revision,deck_fact_revision,control_revision_set_digest,related_disposition_completion_digest,commit_digest,committed_at_ms) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('commit-complete','run-complete','entry-complete',1,1,digest(22),digest(23),digest(24),30);
  database.close();
  try {
    const projection = createFormationStatusProjection({ schemaManifest, unitOfWork:createSqliteUnitOfWork({ kernel }) });
    const result = projection.read(['offer-rejected', 'offer-pending', 'offer-complete', 'offer-without-receipt']);
    assert.equal(result.get('offer-rejected').stage, 'attention_required');
    assert.equal(result.get('offer-pending').stage, 'in_progress');
    assert.deepEqual(result.get('offer-complete'), {
      stage:'completed', reasonCode:null, completedAtMs:30, shelfEntryId:'entry-complete', onDeckRunId:'run-complete',
    });
    assert.equal(result.has('offer-without-receipt'), false);
  } finally {
    kernel.close();
    fs.rmSync(root, { recursive:true, force:true });
  }
});
