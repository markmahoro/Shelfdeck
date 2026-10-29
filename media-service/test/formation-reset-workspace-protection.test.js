'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const Database = require('better-sqlite3');
const { readRetainedWorkspaceProtection, assertRetainedWorkspaceProtection, deriveWorkspaceStorage, verifyWorkspaceStorage } = require('../scripts/formation-reset-workspace-protection');
const { inspectTemporaryStorage } = require('../scripts/formation-reset-storage');
const { cleanTemporaryStorage } = require('../scripts/formation-reset-cleanup');

function fixture(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'reset-owner-files-')));
  const file = path.join(root, 'retained.db'), write = new Database(file);
  const ddl = fs.readFileSync(path.join(__dirname, '../src/helix/foundation/persistence/generated/clean-schema.sql'), 'utf8');
  for (const table of ['fx_command_receipts', 'fx_commit_markers']) {
    const definition = ddl.match(new RegExp('CREATE TABLE "' + table + '" \\([\\s\\S]*?\\n\\);'));
    assert.ok(definition); write.exec(definition[0]);
  }
  t.after(() => { write.close(); fs.rmSync(root, { recursive: true, force: true }); });
  write.exec(`CREATE TABLE fx_workspace_registry(workspace_id TEXT PRIMARY KEY,owner_domain TEXT,process_type TEXT,process_id TEXT,root_handle_ref TEXT,state TEXT);
    CREATE TABLE libra_workspaces(workspace_id TEXT PRIMARY KEY,libra_run_id TEXT,root_handle_ref TEXT,state TEXT);
    CREATE TABLE arca_aftercare_cases(aftercare_case_id TEXT PRIMARY KEY);
    CREATE TABLE arca_series_presentation_builds(build_id TEXT PRIMARY KEY);
    CREATE TABLE arca_jav_identity_corrections(correction_id TEXT PRIMARY KEY);
    CREATE TABLE proc_field_access_revisions(root_location TEXT);
    CREATE TABLE arca_shelf_target_bindings(root_location TEXT);
    CREATE TABLE arca_shelves(target_root_location TEXT);
    CREATE TABLE arca_inventory_materials(location TEXT);
    CREATE TABLE arca_inventory_related_references(location TEXT);
    CREATE TABLE platform_workspace_roots(root_id TEXT PRIMARY KEY,root_handle_ref TEXT,state TEXT,owner_scope TEXT,root_kind TEXT,resolved_root TEXT);`);
  const production = path.join(root, 'production'), maintenance = path.join(root, 'maintenance'), source = path.join(root, 'source');
  for (const folder of [production, maintenance, source]) fs.mkdirSync(folder);
  for (const [id, owner, kind, location] of [['prod', 'libra', 'production-workspace', production], ['care', 'arca', 'aftercare-workspace', maintenance]])
    write.prepare('INSERT INTO platform_workspace_roots VALUES(?,?,?,?,?,?)').run(id, id, 'active', owner, kind, location);
  function snapshot() {
    const db = new Database(file, { readonly: true });
    try { db.exec('BEGIN'); return readRetainedWorkspaceProtection(db); }
    finally { if (db.inTransaction) db.exec('ROLLBACK'); db.close(); }
  }
  return { root, file, write, snapshot, production, maintenance, source,
    storage: { roots: [production, maintenance], protectedDirectories: [source], retainedPaths: [] } };
}

test('collection maintenance survives cleanup while reclaimed historical and unfinished files leave private roots', t => {
  const f = fixture(t);
  f.write.exec(`INSERT INTO arca_aftercare_cases VALUES('case-1');
    INSERT INTO fx_workspace_registry VALUES('case-1','arca','aftercare_case','case-1','care','active');
    INSERT INTO libra_workspaces VALUES('old-workspace','old-run','prod','reclaimed');`);
  const kept = path.join(f.maintenance, 'case-1'); fs.mkdirSync(kept);
  fs.writeFileSync(path.join(kept, 'maintenance.mkv'), 'needed collection output');
  fs.mkdirSync(path.join(f.production, 'old-workspace'));
  fs.writeFileSync(path.join(f.production, 'old-workspace', 'poster.jpg'), 'historical artifact has no physical retention');
  fs.writeFileSync(path.join(f.production, 'unfinished.mkv'), 'unfinished');
  fs.writeFileSync(path.join(f.source, 'original.mkv'), 'source');
  const protection = f.snapshot();
  assert.equal(protection.workspaces.length, 1);
  assert.throws(() => assertRetainedWorkspaceProtection(protection, f.storage), { code: 'RESET_WORKSPACE_RETENTION_MISSING' });
  const storage = { ...f.storage, retainedPaths: [kept] };
  assertRetainedWorkspaceProtection(protection, storage);
  const manifest = inspectTemporaryStorage(storage);
  cleanTemporaryStorage({ storage, manifest, journalPath: path.join(f.root, 'cleanup.json'), generationId: 'a'.repeat(64), assertStopped() {} });
  assert.deepEqual(fs.readdirSync(f.production), []);
  assert.equal(fs.readFileSync(path.join(kept, 'maintenance.mkv'), 'utf8'), 'needed collection output');
  assert.equal(fs.readFileSync(path.join(f.source, 'original.mkv'), 'utf8'), 'source');
});

test('active Libra evidence requires exact registry and retained private subtree', t => {
  const f = fixture(t);
  f.write.exec("INSERT INTO libra_workspaces VALUES('workspace-1','run-1','prod','reclaiming')");
  assert.throws(f.snapshot, { code: 'LIBRA_RESET_WORKSPACE_OWNER_INVALID' });
  f.write.exec("INSERT INTO fx_workspace_registry VALUES('workspace-1','libra','libra_run','run-1','prod','active')");
  assert.equal(f.snapshot().workspaces[0].location, path.join(f.production, 'workspace-1'));
  f.write.exec("UPDATE fx_workspace_registry SET process_id='another-run'");
  assert.throws(f.snapshot, { code: 'LIBRA_RESET_WORKSPACE_OWNER_INVALID' });
});

test('Arca Series and correction Workspaces use their exact assets scope, including historical maintenance', t => {
  const f = fixture(t);
  f.write.exec(`INSERT INTO arca_series_presentation_builds VALUES('build-1');
    INSERT INTO arca_jav_identity_corrections VALUES('fix-1');
    INSERT INTO fx_workspace_registry VALUES('build-1-assets','arca','series_presentation','build-1','care','active');
    INSERT INTO fx_workspace_registry VALUES('fix-1-assets','arca','jav_identity_correction','fix-1','care','active');`);
  assert.equal(f.snapshot().workspaces.length, 2);
  f.write.exec("UPDATE fx_workspace_registry SET workspace_id='wrong-assets' WHERE process_id='build-1'");
  assert.throws(f.snapshot, { code: 'ARCA_RESET_WORKSPACE_OWNER_INVALID' });
});

test('missing, ambiguous, foreign, and escaping Platform roots block cleanup', t => {
  const f = fixture(t);
  f.write.exec(`INSERT INTO arca_aftercare_cases VALUES('case-1');
    INSERT INTO fx_workspace_registry VALUES('case-1','arca','aftercare_case','case-1','missing','active');`);
  assert.throws(f.snapshot, { code: 'RESET_WORKSPACE_ROOT_UNRESOLVED' });
  f.write.exec("UPDATE fx_workspace_registry SET root_handle_ref='care'; UPDATE platform_workspace_roots SET owner_scope='libra' WHERE root_id='care'");
  assert.throws(f.snapshot, { code: 'RESET_WORKSPACE_ROOT_UNRESOLVED' });
  f.write.exec("UPDATE platform_workspace_roots SET owner_scope='arca' WHERE root_id='care'");
  f.write.prepare('UPDATE platform_workspace_roots SET resolved_root=? WHERE root_id=?').run('relative/root', 'care');
  assert.throws(f.snapshot, { code: 'RESET_WORKSPACE_LOCATION_UNSAFE' });
  f.write.prepare('UPDATE platform_workspace_roots SET resolved_root=? WHERE root_id=?').run(f.maintenance, 'care');
  f.write.exec("INSERT INTO platform_workspace_roots SELECT 'duplicate',root_handle_ref,state,owner_scope,root_kind,resolved_root FROM platform_workspace_roots WHERE root_id='care'");
  assert.throws(f.snapshot, { code: 'RESET_WORKSPACE_ROOT_UNRESOLVED' });
});

test('a broad retain-root declaration cannot substitute for precise Owner dependencies', t => {
  const f = fixture(t);
  assert.throws(() => assertRetainedWorkspaceProtection(f.snapshot(), { ...f.storage, retainedPaths: [f.production] }),
    { code: 'RESET_WORKSPACE_RETENTION_UNPROVEN' });
  f.write.exec("INSERT INTO fx_workspace_registry VALUES('unknown','people','unknown','unknown','care','active')");
  assert.throws(f.snapshot, { code: 'RESET_WORKSPACE_OWNER_UNREVIEWED' });
});

test('Owner source, historical target and People roots enter the frozen protection boundary', t => {
  const f = fixture(t);
  const formal = path.join(f.root, 'formal'), historical = path.join(f.root, 'historical'), people = path.join(f.root, 'people');
  for (const location of [formal, historical, people]) fs.mkdirSync(location);
  f.write.prepare('INSERT INTO proc_field_access_revisions VALUES(?)').run(f.source);
  f.write.prepare('INSERT INTO arca_shelves VALUES(?)').run(formal);
  f.write.prepare('INSERT INTO arca_shelf_target_bindings VALUES(?)').run(historical);
  f.write.prepare('INSERT INTO platform_workspace_roots VALUES(?,?,?,?,?,?)').run('people', 'people-ref', 'active', 'people', 'reference-artifact', people);
  const input = { roots: [f.production], protectedDirectories: [f.source] };
  const options = { Database, targetPath: f.file };
  const derived = deriveWorkspaceStorage({ ...options, storage: input });
  assert.deepEqual(derived.storage.roots, [f.production, f.maintenance].sort());
  assert.deepEqual(derived.storage.protectedDirectories, [f.source, formal, historical, people].sort());
  assert.throws(() => verifyWorkspaceStorage({ ...options, storage: input }), { code: 'RESET_STORAGE_OWNER_BOUNDARIES_CHANGED' });
  verifyWorkspaceStorage({ ...options, storage: derived.storage });
  const attempted = deriveWorkspaceStorage({ ...options, storage: { ...input, roots: [...input.roots, historical] } });
  assert.throws(() => inspectTemporaryStorage(attempted.storage), { code: 'RESET_STORAGE_BOUNDARY_OVERLAP' });
});

test('a collection Inventory binding blocks a conflicting private-root cleanup, including historical locations', t => {
  const f = fixture(t);
  const options = { Database, targetPath: f.file, storage: f.storage };
  f.write.prepare('INSERT INTO arca_inventory_materials VALUES(?)').run(path.join(f.production, 'owned.mkv'));
  assert.throws(() => deriveWorkspaceStorage(options), { code: 'RESET_COLLECTION_FILE_INSIDE_TEMPORARY_ROOT' });
  f.write.exec('DELETE FROM arca_inventory_materials');
  f.write.prepare('INSERT INTO arca_inventory_related_references VALUES(?)').run(path.join(f.production, 'poster.jpg'));
  assert.throws(() => deriveWorkspaceStorage(options), { code: 'RESET_COLLECTION_FILE_INSIDE_TEMPORARY_ROOT' });
});
