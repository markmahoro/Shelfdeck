'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const Database = require('better-sqlite3');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createFreshResetWorkspaceArchive } = require('../../src/helix/domains/libra/persistence/fresh-reset-workspace-archive');
const { describeFreshResetWorkspaceRetention } = require('../../src/helix/domains/libra/model/fresh-reset-workspace-retention');
const { createMovieResponsibilityClosureCoordinator } = require('../../src/helix/domains/libra/application/movie-responsibility-closure-coordinator');
const schemaManifest = require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const schemaDdl = fs.readFileSync(path.join(__dirname, '../../src/helix/foundation/persistence/generated/clean-schema.sql'), 'utf8');
const D = 'a'.repeat(64);
function fixture(t, workspaceState = 'active') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-workspace-archive-')), databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaManifest, schemaDdl, now: () => 5000 });
  const db = new Database(databasePath); db.pragma('foreign_keys=ON');
  t.after(() => { db.close(); kernel.close(); fs.rmSync(root, { recursive: true, force: true }); });
  db.exec(`BEGIN; PRAGMA defer_foreign_keys=ON;
    INSERT INTO libra_subjects(subject_id,status) VALUES('subject','administratively_retired');
    INSERT INTO libra_runs(libra_run_id,subject_id,state,state_revision,execution_basis_record_json) VALUES('run','subject','completed',1,'{}');
    INSERT INTO libra_workspace_revisions(workspace_id,workspace_revision,state) VALUES('workspace',1,'reclaiming');
    INSERT INTO libra_workspaces(workspace_id,libra_run_id,root_handle_ref,current_revision,state,space_admission_evidence_json)
      VALUES('workspace','run','prod',1,'${workspaceState}','{}');
    INSERT INTO fx_workspace_registry(workspace_id,owner_domain,process_type,process_id,root_handle_ref,state)
      VALUES('workspace','libra','libra_run','run','prod','active'); COMMIT;`);
  const dependencies = { schemaManifest, unitOfWork: createSqliteUnitOfWork({ kernel }) };
  const store = createFreshResetWorkspaceArchive({ ...dependencies, assertIsolated() {} });
  const request = { workspaceId: 'workspace', generationId: D, backupDigest: D, manifestDigest: D };
  const evidence = () => ['libra_workspaces', 'libra_workspace_revisions', 'fx_workspace_registry', 'libra_runs']
    .map(table => db.prepare('SELECT * FROM ' + table).all());
  return { db, dependencies, store, request, evidence };
}
for (const state of ['active', 'reclaimed']) test('cold archive preserves '+state+' historical states without inventing reclamation', t => {
  const f = fixture(t, state), original = f.evidence();
  const receipt = f.store.archive(f.request).receipt;
  assert.equal(receipt.resultRef.disposition, 'historical_evidence_only');
  assert.equal(receipt.resultRef.physicalCleanup, 'operator_receipt_required');
  assert.deepEqual(f.evidence(), original);
  assert.equal(f.store.archive(f.request).replayed, true);
  const archivedWorkspaceIds = f.store.readArchivedIds();
  assert.deepEqual([...archivedWorkspaceIds], ['workspace']);
  const input = { workspaces: original[0], registries: original[2], archivedWorkspaceIds };
  assert.deepEqual(describeFreshResetWorkspaceRetention(input), []);
  if (state === 'reclaimed') assert.throws(() => describeFreshResetWorkspaceRetention({ ...input, archivedWorkspaceIds: new Set() }),
    { code: 'LIBRA_RESET_WORKSPACE_OWNER_INVALID' });
  const coordinator = createMovieResponsibilityClosureCoordinator({ ...f.dependencies, now: () => 5000,
    offloadCompletionPort: {}, workspaceProductPort: {} });
  const entries = coordinator.listCompletedWorkspacePage(null, 100);
  assert.ok(entries.every(row => row.scope.skipped));
  assert.equal(f.db.pragma('integrity_check', { simple: true }), 'ok');
  assert.deepEqual(f.db.pragma('foreign_key_check'), []);
});
test('archive rejects active execution, foreign identity, absent cold authority, and changed evidence', t => {
  const f = fixture(t);
  assert.throws(() => createFreshResetWorkspaceArchive(f.dependencies).archive(f.request), { code: 'LIBRA_RESET_WORKSPACE_ARCHIVE_INVALID' });
  f.db.exec("UPDATE libra_runs SET state='active'");
  assert.throws(() => f.store.archive(f.request), { code: 'LIBRA_RESET_WORKSPACE_ARCHIVE_INVALID' });
  f.db.exec("UPDATE libra_runs SET state='discarded'; UPDATE fx_workspace_registry SET process_id='foreign'");
  assert.throws(() => f.store.archive(f.request), { code: 'LIBRA_RESET_WORKSPACE_ARCHIVE_INVALID' });
  f.db.exec("UPDATE fx_workspace_registry SET process_id='run'"); f.store.archive(f.request);
  f.db.exec("UPDATE fx_workspace_registry SET state='reclaimed'");
  assert.throws(f.store.readArchivedIds, { code: 'LIBRA_RESET_WORKSPACE_ARCHIVE_INVALID' });
});
test('archive receipt and marker are required, not just an ended Subject or terminal Run', t => {
  const f = fixture(t);
  assert.equal(f.store.readArchivedIds().size, 0);
  f.store.archive(f.request);
  f.db.exec("UPDATE fx_commit_markers SET scope_id='foreign'");
  assert.throws(f.store.readArchivedIds, { code: 'LIBRA_RESET_WORKSPACE_ARCHIVE_INVALID' });
});
