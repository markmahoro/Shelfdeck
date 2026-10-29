'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { createColdResetFence, assertBusinessGenerationOpenAllowed, finalizeCompletedColdReset } = require('../src/clean-reset-generation-fence');
const { createCleanServiceHost } = require('../src/clean-service-host');

function fixture(t) {
  const dataDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'cold-reset-fence-')));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dataDir, 'operator-runtime'));
  const generationId = 'a'.repeat(64), expectedRuntimeRevision = 4;
  const intent = { schema: 'shelfdeck.runtime-intent@1', desiredMode: 'stopped', revision: expectedRuntimeRevision,
    pendingReset: { operationId: 'b'.repeat(64), previewDigest: 'c'.repeat(64), backupId: 'approved-backup', resetId: generationId } };
  const intentPath = path.join(dataDir, 'operator-runtime/intent.json');
  const saveIntent = () => fs.writeFileSync(intentPath, JSON.stringify(intent));
  saveIntent();
  const options = { dataDir, generationId, expectedRuntimeRevision }, fence = createColdResetFence(options);
  function marker(candidateDigest = 'd'.repeat(64)) {
    const value = { generationId, requestDigest: 'e'.repeat(64), retainedDigest: 'f'.repeat(64), candidateDigest };
    fs.writeFileSync(path.join(dataDir, 'database-generation.json'), JSON.stringify({ ...value, receiptDigest: canonicalDigest(value) }));
  }
  return { options, dataDir, generationId, fence, intent, saveIntent, marker,
    closeReceipt: { generationId, allBusinessConnectionsClosed: true },
    receipt: { generationId, databaseGeneration: generationId, phase: 'complete', desiredMode: 'stopped', candidateDigest: 'd'.repeat(64) } };
}

test('a durable closing fence prevents a new native Host from opening the database', async t => {
  const f = fixture(t);
  assertBusinessGenerationOpenAllowed(f.dataDir);
  const first = f.fence.begin();
  assert.equal(first.phase, 'closing');
  assert.deepEqual(f.fence.begin(), first);
  assert.throws(() => f.fence.assertClosed(), { code: 'RESET_FENCE_CONNECTIONS_NOT_CLOSED' });
  await assert.rejects(createCleanServiceHost({ dataDir: f.dataDir, adminDistDir: f.dataDir }), { code: 'RESET_COLD_RECOVERY_REQUIRED' });
  assert.equal(fs.existsSync(path.join(f.dataDir, 'shelfdeck.db')), false, 'the gate must precede Kernel construction');
  assert.throws(() => f.fence.markClosed({ generationId: f.generationId, allBusinessConnectionsClosed: false }), { code: 'RESET_FENCE_CLOSE_NOT_PROVEN' });
  f.fence.markClosed(f.closeReceipt);
  f.fence.assertClosed();
  assert.throws(() => assertBusinessGenerationOpenAllowed(f.dataDir), { code: 'RESET_COLD_RECOVERY_REQUIRED' });
});

test('a dangling fence link cannot masquerade as an absent generation barrier', t => {
  const f = fixture(t), file = path.join(f.dataDir, 'operator-runtime/generation-fence.json');
  fs.symlinkSync(path.join(f.dataDir, 'missing'), file, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => assertBusinessGenerationOpenAllowed(f.dataDir), { code: 'RESET_FENCE_PATH_UNSAFE' });
  assert.throws(() => f.fence.begin(), { code: 'RESET_FENCE_PATH_UNSAFE' });
});

test('completion requires the exact switched generation and Runtime finalization before startup', t => {
  const f = fixture(t); f.fence.begin(); f.fence.markClosed(f.closeReceipt); f.marker();
  assert.throws(() => f.fence.complete({ ...f.receipt, phase: 'database_switched' }), { code: 'RESET_FENCE_COMPLETION_NOT_PROVEN' });
  const completed = f.fence.complete(f.receipt);
  assert.deepEqual(createColdResetFence(f.options).complete(f.receipt), completed);
  assert.throws(() => assertBusinessGenerationOpenAllowed(f.dataDir), { code: 'RESET_COLD_FINALIZATION_REQUIRED' });
  f.intent.pendingReset = null; f.intent.revision++; f.saveIntent();
  assertBusinessGenerationOpenAllowed(f.dataDir);
  assert.equal(f.intent.desiredMode, 'stopped');
  // A later explicit Resume is not overwritten by the completed reset fence.
  f.intent.desiredMode = 'running'; f.intent.revision++; f.saveIntent();
  assertBusinessGenerationOpenAllowed(f.dataDir);
});

test('a changed Runtime intent rejects old callbacks even when its revision was maliciously reused', t => {
  const f = fixture(t); f.fence.begin(); f.fence.markClosed(f.closeReceipt);
  f.intent.pendingReset.previewDigest = '9'.repeat(64); f.saveIntent();
  assert.throws(() => f.fence.assertClosed(), { code: 'RESET_FENCE_RUNTIME_CHANGED' });
  assert.throws(() => f.fence.complete(f.receipt), { code: 'RESET_FENCE_RUNTIME_CHANGED' });
});

test('another generation cannot take over an interrupted transition', t => {
  const f = fixture(t); f.fence.begin();
  const generationId = '1'.repeat(64); f.intent.pendingReset.resetId = generationId; f.intent.revision++; f.saveIntent();
  const next = createColdResetFence({ ...f.options, generationId, expectedRuntimeRevision: f.intent.revision });
  assert.throws(() => next.begin(), { code: 'RESET_COLD_RECOVERY_REQUIRED' });
});

test('corrupted marker and mismatched candidate cannot make the new generation openable', t => {
  const f = fixture(t); f.fence.begin(); f.fence.markClosed(f.closeReceipt); f.marker('2'.repeat(64));
  assert.throws(() => f.fence.complete(f.receipt), { code: 'RESET_FENCE_GENERATION_CHANGED' });
  f.marker(); f.fence.complete(f.receipt); f.intent.pendingReset = null; f.saveIntent();
  const file = path.join(f.dataDir, 'database-generation.json'), value = JSON.parse(fs.readFileSync(file));
  value.candidateDigest = '3'.repeat(64); fs.writeFileSync(file, JSON.stringify(value));
  assert.throws(() => assertBusinessGenerationOpenAllowed(f.dataDir), { code: 'RESET_FENCE_MARKER_CORRUPT' });
});

for (const phase of ['runtime_receipt_completed', 'runtime_intent_finalized']) {
  test('cold startup finalization survives interruption at ' + phase + ' and stays stopped', t => {
    const f = fixture(t); f.fence.begin(); f.fence.markClosed(f.closeReceipt); f.marker(); f.fence.complete(f.receipt);
    const operationPath = path.join(f.dataDir, 'operator-runtime', f.intent.pendingReset.operationId + '.json');
    const operation = { operationId: f.intent.pendingReset.operationId, kind: 'reset', requestDigest: '8'.repeat(64),
      state: 'failed', error: { code: 'PROCESS_EXITED' }, createdAt: '2026-10-26T00:00:00Z' };
    fs.writeFileSync(operationPath, JSON.stringify(operation));
    assert.throws(() => finalizeCompletedColdReset(f.dataDir, { checkpoint(point) { if (point === phase) throw Error('crash'); } }), /crash/);
    const firstReceipt = fs.readFileSync(operationPath, 'utf8');
    finalizeCompletedColdReset(f.dataDir);
    assert.equal(fs.readFileSync(operationPath, 'utf8'), firstReceipt, 'completed receipt is not rewritten on replay');
    const intent = JSON.parse(fs.readFileSync(path.join(f.dataDir, 'operator-runtime/intent.json')));
    assert.equal(intent.desiredMode, 'stopped'); assert.equal(intent.pendingReset, null); assert.equal(intent.revision, 5);
    assert.equal(JSON.parse(firstReceipt).error, undefined);
    assertBusinessGenerationOpenAllowed(f.dataDir);
    assert.equal(fs.existsSync(path.join(f.dataDir, 'shelfdeck.db')), false, 'finalization never opens a business database');
  });
}

test('cold startup never finalizes incomplete cleanup or changed completion evidence', t => {
  const f = fixture(t); f.fence.begin(); f.fence.markClosed(f.closeReceipt); f.marker();
  assert.throws(() => finalizeCompletedColdReset(f.dataDir), { code: 'RESET_COLD_RECOVERY_REQUIRED' });
  f.fence.complete(f.receipt);
  const resultPath = path.join(f.dataDir, 'operator-runtime', 'generation-' + f.generationId + '-result.json');
  fs.writeFileSync(resultPath, JSON.stringify({ ...f.receipt, phase: 'database_switched' }));
  assert.throws(() => finalizeCompletedColdReset(f.dataDir), { code: 'RESET_FENCE_COMPLETION_NOT_PROVEN' });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dataDir, 'operator-runtime/intent.json'))), f.intent);
});
