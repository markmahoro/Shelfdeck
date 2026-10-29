'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { createOfflineFormationReset } = require('../scripts/formation-reset-offline');
const { fileDigest } = require('../scripts/formation-reset-generation');

function fixture(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'reset-offline-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['data', 'operations', 'backup', 'workspace', 'source', 'collection']) fs.mkdirSync(path.join(root, name));
  const activePath = path.join(root, 'data', 'shelfdeck.db'), db = new Database(activePath);
  db.exec(`CREATE TABLE subject(id TEXT PRIMARY KEY); CREATE TABLE run(id TEXT PRIMARY KEY,subject_id TEXT REFERENCES subject(id));
    CREATE TABLE collection(id TEXT PRIMARY KEY,run_id TEXT REFERENCES run(id)); CREATE TABLE offer(id TEXT PRIMARY KEY);
    INSERT INTO subject VALUES('series'); INSERT INTO run VALUES('committed','series'),('unfinished-season','series');
    INSERT INTO collection VALUES('season-one','committed'); INSERT INTO offer VALUES('old-queue');`);
  db.close();
  const backupPath = path.join(root, 'backup', 'shelfdeck.db'); fs.copyFileSync(activePath, backupPath);
  const backupDigest = fileDigest(backupPath);
  fs.writeFileSync(path.join(root, 'workspace', 'partial.mp4'), 'incomplete encode');
  fs.writeFileSync(path.join(root, 'source', 'source.mkv'), 'source bytes');
  fs.writeFileSync(path.join(root, 'collection', 'owned.mkv'), 'collection bytes');
  const options = { Database, activePath, operationRoot: path.join(root, 'operations'), generationId: 'a'.repeat(64),
    policy: { tables: { subject: { owner: 'libra', disposition: 'dependent' }, run: { owner: 'libra', disposition: 'dependent' },
      collection: { owner: 'arca', disposition: 'root' }, offer: { owner: 'procurement', disposition: 'clear' } }, edges: [] },
    storage: { roots: [path.join(root, 'workspace')], protectedDirectories: [path.join(root, 'source'), path.join(root, 'collection')] },
    backup: { databasePath: backupPath, receiptDigest: backupDigest, async verify() {
      assert.equal(fileDigest(backupPath), backupDigest);
    } },
    assertStopped: () => {}, normalizeRetained: () => ({ ownerNormalization: 'fixture-has-no-runtime-heads' }),
    verifyRetained({ sourcePath, targetPath }) {
      const before = new Database(sourcePath, { readonly: true }), after = new Database(targetPath, { readonly: true });
      try {
        const records = before.prepare('SELECT * FROM collection ORDER BY id').all();
        assert.deepEqual(after.prepare('SELECT * FROM collection ORDER BY id').all(), records);
        assert.deepEqual(after.prepare('SELECT id FROM run').all(), [{ id: 'committed' }]);
        assert.deepEqual(after.pragma('foreign_key_check'), []);
        return { digest: canonicalDigest(records) };
      } finally { before.close(); after.close(); }
    }, reserveBytes: 0n };
  return { root, options, backupDigest };
}

test('cold Reset composes exact collection retention, switch and private cleanup while leaving stopped', async t => {
  const f = fixture(t), operator = createOfflineFormationReset(f.options), preview = await operator.prepare();
  assert.equal(preview.counts.find(row => row.table === 'offer').removed, 1);
  assert.equal(preview.counts.find(row => row.table === 'run').removed, 1);
  assert.equal(fileDigest(f.options.activePath), f.backupDigest, 'preview cannot change the active database');
  const request = { previewDigest: preview.previewDigest, idempotencyKey: 'once' }, receipt = await operator.apply(request);
  assert.equal(receipt.phase, 'complete'); assert.equal(receipt.desiredMode, 'stopped');
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'workspace')), []);
  assert.equal(fs.readFileSync(path.join(f.root, 'source', 'source.mkv'), 'utf8'), 'source bytes');
  assert.equal(fs.readFileSync(path.join(f.root, 'collection', 'owned.mkv'), 'utf8'), 'collection bytes');
  assert.equal(fileDigest(f.options.backup.databasePath), f.backupDigest);
  assert.deepEqual(await operator.apply(request), receipt);
  await assert.rejects(operator.apply({ ...request, idempotencyKey: 'another-request' }), { code: 'RESET_OPERATOR_KEY_CONFLICT' });
});

for (const phase of ['database_copy_staged', 'database_stage_published', 'old_database_moved', 'new_database_moved', 'database_switched']) {
  test('Operator resumes interruption at ' + phase + ' without replaying old business work', async t => {
    const f = fixture(t), operator = createOfflineFormationReset(f.options), preview = await operator.prepare();
    const request = { previewDigest: preview.previewDigest, idempotencyKey: 'crash' };
    const crashing = createOfflineFormationReset({ ...f.options, checkpoint: point => { if (point === phase) throw Error('injected crash'); } });
    await assert.rejects(crashing.apply(request), /injected crash/);
    assert.equal(fs.readFileSync(path.join(f.root, 'workspace', 'partial.mp4'), 'utf8'), 'incomplete encode');
    const result = await createOfflineFormationReset(f.options).apply(request);
    assert.equal(result.phase, 'complete'); assert.equal(result.desiredMode, 'stopped');
  });
}

test('insufficient space and failed backup verification precede any generation write', async t => {
  const f = fixture(t);
  await assert.rejects(createOfflineFormationReset({ ...f.options, reserveBytes: 2n ** 62n }).prepare(), { code: 'RESET_OPERATOR_SPACE_INSUFFICIENT' });
  assert.deepEqual(fs.readdirSync(f.options.operationRoot), []);
  await assert.rejects(createOfflineFormationReset({ ...f.options, backup: { ...f.options.backup, verify() { throw Error('backup failed'); } } }).prepare(), /backup failed/);
  assert.deepEqual(fs.readdirSync(f.options.operationRoot), []);
  assert.equal(fileDigest(f.options.activePath), f.backupDigest);
});

test('a stale preview cannot authorize database switching or delete late worker output', async t => {
  const f = fixture(t), operator = createOfflineFormationReset(f.options), preview = await operator.prepare();
  fs.writeFileSync(path.join(f.root, 'workspace', 'late.mp4'), 'late output');
  await assert.rejects(operator.apply({ previewDigest: preview.previewDigest, idempotencyKey: 'stale' }), { code: 'RESET_STORAGE_CHANGED' });
  assert.equal(fileDigest(f.options.activePath), f.backupDigest);
  assert.equal(fs.readdirSync(path.join(f.root, 'workspace')).length, 2);
});

test('losing the stopped fence refuses both preparation and an approved apply', async t => {
  const f = fixture(t), operator = createOfflineFormationReset(f.options), preview = await operator.prepare();
  const stopped = createOfflineFormationReset({ ...f.options, assertStopped() { throw Error('generation fence lost'); } });
  await assert.rejects(stopped.prepare(), /generation fence lost/);
  await assert.rejects(stopped.apply({ previewDigest: preview.previewDigest, idempotencyKey: 'stopped' }), /generation fence lost/);
  assert.equal(fileDigest(f.options.activePath), f.backupDigest);
});

for (const phase of ['database_copied', 'owners_normalized', 'preview_verified']) {
  test('preparation interrupted at ' + phase + ' retries from a verified source without deleting evidence', async t => {
    const f = fixture(t);
    const crashing = createOfflineFormationReset({ ...f.options, checkpoint: point => { if (point === phase) throw Error('preparation crash'); } });
    await assert.rejects(crashing.prepare(), /preparation crash/);
    const first = path.join(crashing.paths.directory, 'retained-attempt-1.db'), digest = fileDigest(first);
    const operator = createOfflineFormationReset(f.options), preview = await operator.prepare();
    assert.equal(fileDigest(first), digest, 'an interrupted attempt stays available as evidence');
    assert.equal(fileDigest(f.options.activePath), f.backupDigest);
    assert.equal(path.basename(preview.candidatePath), phase === 'preview_verified' ? 'retained-attempt-1.db' : 'retained-attempt-2.db');
    const receipt = await operator.apply({ previewDigest: preview.previewDigest, idempotencyKey: 'retry-preparation' });
    assert.equal(receipt.phase, 'complete'); assert.equal(receipt.desiredMode, 'stopped');
  });
}

test('preparation retry does not accept changed inputs or a tampered verified candidate', async t => {
  const f = fixture(t), operator = createOfflineFormationReset(f.options), preview = await operator.prepare();
  fs.appendFileSync(preview.candidatePath, 'tampering');
  await assert.rejects(operator.prepare(), { code: 'RESET_OPERATOR_CANDIDATE_CHANGED' });
  assert.equal(fileDigest(f.options.activePath), f.backupDigest);
});

test('an interrupted partial staging copy remains evidence and is never switched into production', async t => {
  const f = fixture(t), operator = createOfflineFormationReset(f.options), preview = await operator.prepare();
  let partial;
  const interrupted = createOfflineFormationReset({ ...f.options, checkpoint(point) {
    if (point !== 'database_copy_staged') return;
    const journal = JSON.parse(fs.readFileSync(operator.paths.staging));
    partial = journal.attempts.at(-1).path;
    fs.truncateSync(partial, 123); // Model a process exit during a large file copy.
    throw Error('interrupted copy');
  } });
  const request = { previewDigest: preview.previewDigest, idempotencyKey: 'partial-stage' };
  await assert.rejects(interrupted.apply(request), /interrupted copy/);
  assert.equal(fileDigest(f.options.activePath), f.backupDigest);
  const result = await operator.apply(request);
  assert.equal(result.phase, 'complete');
  assert.equal(fs.statSync(partial).size, 123);
  assert.equal(result.staging.attempts[0].state, 'abandoned');
  assert.equal(result.staging.attempts[1].state, 'closed');
  assert.equal(fileDigest(f.options.activePath), preview.candidateDigest);
});
