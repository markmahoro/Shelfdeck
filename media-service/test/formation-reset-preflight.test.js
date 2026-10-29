'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { createRetainedDatabase } = require('../scripts/formation-reset-copy');
const { inspectTemporaryStorage, buildStorageBudget } = require('../scripts/formation-reset-storage');
const { buildResetPreflight, assertResetPreflight, assertResetPreflightApplicable, buildCapacityBlockedPreflight } = require('../scripts/formation-reset-preflight');
const { createOfflineFormationReset } = require('../scripts/formation-reset-offline');
const { fileDigest } = require('../scripts/formation-reset-generation');

function fixture(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'reset-preflight-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['data', 'backup', 'operations', 'workspace', 'source']) fs.mkdirSync(path.join(root, name));
  const activePath = path.join(root, 'data', 'shelfdeck.db'), db = new Database(activePath);
  db.exec("CREATE TABLE owned(id TEXT PRIMARY KEY); CREATE TABLE queue(id TEXT PRIMARY KEY,value TEXT); INSERT INTO owned VALUES('collection'); INSERT INTO queue VALUES('offer','old')");
  db.close();
  fs.writeFileSync(path.join(root, 'workspace', 'partial.mp4'), 'private temp');
  const sourceFile = path.join(root, 'source', 'original.mkv'); fs.writeFileSync(sourceFile, 'source');
  const storage = { roots: [path.join(root, 'workspace')], protectedDirectories: [path.join(root, 'source')] };
  const policy = { tables: { owned: { owner: 'arca', disposition: 'root' }, queue: { owner: 'procurement', disposition: 'clear' } }, edges: [] };
  let ordinal = 0;
  function input(available = 1000000000n) {
    return { runtimeRevision: 2, policy, storage,
      copy: createRetainedDatabase({ Database, sourcePath: activePath, targetPath: path.join(root, 'operations', 'inspect-' + ++ordinal + '.db'), policy }),
      storageManifest: inspectTemporaryStorage(storage), backupPlanDigest: canonicalDigest({ roots: ['data', 'workspace'] }),
      protectedSummary: { collections: 1 },
      volumeBudget: buildStorageBudget({ allocations: [{ directory: path.join(root, 'operations'), purpose: 'backup-and-retained-database', bytes: 100000n }],
        reserveBytes: 100n, stat: () => ({ dev: 1n }), statfs: () => ({ bavail: available, bsize: 1n }) }) };
  }
  function options(approvedPreflight) {
    const backupPath = path.join(root, 'backup', 'shelfdeck.db'); fs.copyFileSync(activePath, backupPath);
    const backupDigest = fileDigest(backupPath);
    return { Database, activePath, operationRoot: path.join(root, 'operations'), generationId: 'a'.repeat(64), policy, storage, approvedPreflight,
      backup: { databasePath: backupPath, receiptDigest: backupDigest, verify() { assert.equal(fileDigest(backupPath), backupDigest); } },
      assertStopped() {}, normalizeRetained: () => ({ fixture: true }), verifyRetained: () => ({ fixture: true }), reserveBytes: 0n };
  }
  return { root, activePath, sourceFile, input, options };
}

test('preflight binds actual selection and boundaries while resampling available space', t => {
  const f = fixture(t), input = f.input(), approved = buildResetPreflight(input);
  assert.equal(approved.counts.find(row => row.table === 'queue').removed, 1);
  assert.equal(approved.expectedReleasedBytes, '12');
  const current = buildResetPreflight(f.input(200000n));
  assert.equal(approved.previewDigest, current.previewDigest);
  assertResetPreflightApplicable(approved, current);
  assert.throws(() => { approved.counts[0].removed = 100; }, TypeError);
  assert.equal(Object.isFrozen(input.protectedSummary), false, 'input evidence is not mutated');
  const boundaryChange = f.input(); boundaryChange.storage = { ...boundaryChange.storage, protectedFiles: [f.sourceFile] };
  assert.throws(() => assertResetPreflightApplicable(approved, buildResetPreflight(boundaryChange)), { code: 'RUNTIME_RESET_PREVIEW_STALE' });
});

test('low space cannot be approved by editing ready or reusing a previous capacity sample', t => {
  const f = fixture(t), approved = buildResetPreflight(f.input()), low = buildResetPreflight(f.input(10n));
  assert.equal(low.ready, false);
  assert.throws(() => assertResetPreflightApplicable(approved, low), { code: 'RESET_PREFLIGHT_NOT_APPROVED' });
  const forged = { ...low, ready: true, blockers: [] };
  assert.throws(() => assertResetPreflight(forged), { code: 'RESET_OPERATOR_SPACE_INSUFFICIENT' });
  const changed = structuredClone(approved); changed.volumeBudget.volumes[0].requiredBytes = '0';
  assert.throws(() => assertResetPreflight(changed), { code: 'RESET_PREFLIGHT_BUDGET_INVALID' });
});

test('capacity refusal returns exact volume requirements without inventing uncomputed retention counts', t => {
  const f = fixture(t), input = f.input(10n);
  const blocked = buildCapacityBlockedPreflight(input);
  assert.equal(blocked.ready, false);
  assert.equal(blocked.selectionStatus, 'not_evaluated');
  assert.equal(blocked.counts, null);
  assert.equal(blocked.protectedSummary, null);
  assert.equal(blocked.volumeBudget.volumes[0].availableBytes, '10');
  assert.equal(blocked.volumeRequirements[0].requiredBytes, '100100');
  assert.throws(() => assertResetPreflight(blocked), { code: 'RESET_PREFLIGHT_NOT_APPROVED' });
});

test('discarded content, Runtime revision and policy changes each invalidate an earlier approval', t => {
  const f = fixture(t), approved = buildResetPreflight(f.input());
  const revision = f.input(); revision.runtimeRevision++;
  assert.throws(() => assertResetPreflightApplicable(approved, buildResetPreflight(revision)), { code: 'RUNTIME_RESET_PREVIEW_STALE' });
  const policy = f.input(); policy.policy = { ...policy.policy, seeds: [] };
  assert.throws(() => assertResetPreflightApplicable(approved, buildResetPreflight(policy)), { code: 'RUNTIME_RESET_PREVIEW_STALE' });
  const db = new Database(f.activePath); db.exec("UPDATE queue SET value='new'"); db.close();
  const current = buildResetPreflight(f.input());
  assert.deepEqual(current.counts, approved.counts);
  assert.throws(() => assertResetPreflightApplicable(approved, current), { code: 'RUNTIME_RESET_PREVIEW_STALE' });
});

test('the cold Operator refuses changed discarded input even if a new complete backup now matches it', async t => {
  const f = fixture(t), approved = buildResetPreflight(f.input());
  const db = new Database(f.activePath); db.exec("UPDATE queue SET value='new'"); db.close();
  const options = f.options(approved), before = fileDigest(f.activePath);
  await assert.rejects(createOfflineFormationReset(options).prepare(), { code: 'RUNTIME_RESET_PREVIEW_STALE' });
  assert.equal(fileDigest(f.activePath), before);
  assert.equal(fs.readFileSync(path.join(f.root, 'workspace', 'partial.mp4'), 'utf8'), 'private temp');
  assert.equal(fs.existsSync(path.join(f.root, 'data', 'database-generation.json')), false);
});

test('a matching preflight authorizes the tested cold copy and frozen private cleanup', async t => {
  const f = fixture(t), approved = buildResetPreflight(f.input()), operator = createOfflineFormationReset(f.options(approved));
  const prepared = await operator.prepare();
  const receipt = await operator.apply({ previewDigest: prepared.previewDigest, idempotencyKey: 'approved' });
  assert.equal(receipt.phase, 'complete');
  assert.equal(receipt.desiredMode, 'stopped');
  assert.equal(fs.readFileSync(f.sourceFile, 'utf8'), 'source');
  const db = new Database(f.activePath, { readonly: true });
  try { assert.equal(db.prepare('SELECT count(*) n FROM queue').get().n, 0); assert.equal(db.prepare('SELECT count(*) n FROM owned').get().n, 1); }
  finally { db.close(); }
});
