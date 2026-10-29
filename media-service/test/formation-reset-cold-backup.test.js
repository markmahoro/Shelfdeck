'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { createRetainedDatabase } = require('../scripts/formation-reset-copy');
const { measureBackupSources } = require('../scripts/formation-reset-backup');
const { inspectTemporaryStorage, buildStorageBudget } = require('../scripts/formation-reset-storage');
const { buildResetPreflight } = require('../scripts/formation-reset-preflight');
const { ensureColdResetBackup } = require('../scripts/formation-reset-cold-backup');

function fixture(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'reset-cold-backup-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['data', 'operations', 'backup', 'workspace', 'source']) fs.mkdirSync(path.join(root, name));
  const dataDir = path.join(root, 'data'), operationRoot = path.join(root, 'operations'), backupParent = path.join(root, 'backup');
  const file = path.join(dataDir, 'shelfdeck.db'), database = new Database(file);
  database.exec("CREATE TABLE owned(id TEXT PRIMARY KEY); CREATE TABLE queued(id TEXT PRIMARY KEY,value TEXT); INSERT INTO owned VALUES('collection'); INSERT INTO queued VALUES('offer','original')");
  database.close();
  fs.writeFileSync(path.join(dataDir, 'operator-audit.json'), 'before');
  fs.writeFileSync(path.join(root, 'workspace', 'unfinished.mkv'), 'private');
  const storage = { roots: [path.join(root, 'workspace')], protectedDirectories: [path.join(root, 'source')], retainedPaths: [] };
  const policy = { tables: { owned: { owner: 'arca', disposition: 'root' }, queued: { owner: 'procurement', disposition: 'clear' } }, edges: [] };
  const copy = createRetainedDatabase({ Database, sourcePath: file, targetPath: path.join(operationRoot, 'inspect.db'), policy });
  const backupSourceOptions = { roots: [{ id: 'data', path: dataDir }, { id: 'workspace', path: storage.roots[0] }] };
  const measured = measureBackupSources(backupSourceOptions);
  const preflightInput = { runtimeRevision: 2, copy, policy, storage, storageManifest: inspectTemporaryStorage(storage),
    backupPlanDigest: canonicalDigest({ sources: measured.sources, exclusions: measured.exclusions, backupParent }), protectedSummary: { collections: 1 },
    volumeBudget: buildStorageBudget({ allocations: [{ directory: operationRoot, purpose: 'test-budget', bytes: 100000n }], reserveBytes: 0n }) };
  const approvedPreflight = buildResetPreflight(preflightInput);
  const spec = { dataDir, operationRoot, backupParent, storage, backupSourceOptions, approvedPreflight,
    generationId: 'a'.repeat(64), expectedRuntimeRevision: 3 };
  return { Database, spec, assertStopped() {}, file, root, preflightInput };
}

for (const phase of ['backup_attempt_allocated', 'backup_manifest_frozen', 'file_copy_staged', 'backup_files_verified']) {
  test('cold full backup retries after ' + phase + ' without overwriting previous attempt evidence', async t => {
    const f = fixture(t);
    await assert.rejects(ensureColdResetBackup({ ...f, checkpoint(at) { if (at === phase) throw Error('injected interruption'); } }), /injected interruption/);
    const first = JSON.parse(fs.readFileSync(path.join(f.spec.operationRoot, f.spec.generationId + '-backup.json'), 'utf8'));
    assert.equal(first.attempts[0].phase, 'copying');
    fs.writeFileSync(path.join(f.spec.dataDir, 'operator-audit.json'), 'failure was recorded while stopped');
    const result = await ensureColdResetBackup(f);
    assert.ok(result.backupRoot.endsWith('-attempt-2'));
    assert.equal(fs.readFileSync(path.join(result.backupRoot, 'data/operator-audit.json'), 'utf8'), 'failure was recorded while stopped');
    assert.equal(fs.readFileSync(path.join(result.backupRoot, 'workspace/unfinished.mkv'), 'utf8'), 'private');
    assert.deepEqual(await ensureColdResetBackup(f), result, 'verified baseline is reused without a third copy');
    const state = JSON.parse(fs.readFileSync(path.join(f.spec.operationRoot, f.spec.generationId + '-backup.json'), 'utf8'));
    assert.deepEqual(state.attempts.map(row => row.phase), ['copying', 'verified']);
    if (phase !== 'backup_attempt_allocated') assert.ok(fs.existsSync(path.join(f.spec.operationRoot, f.spec.generationId + '-backup-1.json')));
  });
}

test('changed discarded business data or changed private files reject a replacement backup before copy', async t => {
  const f = fixture(t), database = new Database(f.file);
  database.exec("UPDATE queued SET value='changed'"); database.close();
  await assert.rejects(ensureColdResetBackup(f), { code: 'RUNTIME_RESET_PREVIEW_STALE' });
  assert.deepEqual(fs.readdirSync(f.spec.backupParent), []);
  const restored = new Database(f.file); restored.exec("UPDATE queued SET value='original'"); restored.close();
  fs.writeFileSync(path.join(f.spec.storage.roots[0], 'unfinished.mkv'), 'changed');
  await assert.rejects(ensureColdResetBackup(f), { code: 'RUNTIME_RESET_PREVIEW_STALE' });
});

test('verified archive corruption blocks replay and does not silently create a replacement', async t => {
  const f = fixture(t), result = await ensureColdResetBackup(f);
  fs.writeFileSync(path.join(result.backupRoot, 'workspace/unfinished.mkv'), 'corrupt');
  await assert.rejects(ensureColdResetBackup(f), { code: 'RESET_BACKUP_VERIFICATION_FAILED' });
  assert.equal(fs.readdirSync(f.spec.backupParent).filter(name => fs.statSync(path.join(f.spec.backupParent, name)).isDirectory()).length, 1);
});

test('capacity is resampled before allocating a backup attempt, not trusted from approved free space', async t => {
  const f = fixture(t);
  const volumeBudget = buildStorageBudget({ allocations: [{ directory: f.spec.operationRoot, purpose: 'backup-peak', bytes: 1000000000000000n }],
    reserveBytes: 0n, statfs: () => ({ bavail: 2000000000000000n, bsize: 1n }) });
  f.spec.approvedPreflight = buildResetPreflight({ ...f.preflightInput, volumeBudget });
  await assert.rejects(ensureColdResetBackup(f), { code: 'RESET_OPERATOR_SPACE_INSUFFICIENT' });
  assert.deepEqual(fs.readdirSync(f.spec.backupParent), []);
  assert.equal(fs.existsSync(path.join(f.spec.operationRoot, f.spec.generationId + '-backup.json')), false);
});
