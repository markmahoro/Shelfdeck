'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalDigest } = require('./helix/contracts/canonical-json');
const { writeAtomic } = require('./clean-runtime-operations');

const SCHEMA = 'shelfdeck.cold-reset-fence@1';
const DIGEST = /^[a-f0-9]{64}$/;
function fail(code) { throw Object.assign(new Error(code), { code }); }
function present(file) { return fs.lstatSync(file, { throwIfNoEntry: false }) !== undefined; }
function paths(dataDir) {
  return { root: path.join(dataDir, 'operator-runtime'), intent: path.join(dataDir, 'operator-runtime', 'intent.json'),
    fence: path.join(dataDir, 'operator-runtime', 'generation-fence.json'), marker: path.join(dataDir, 'database-generation.json') };
}
function read(file) {
  if (fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile()) fail('RESET_FENCE_PATH_UNSAFE');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function readFence(file) {
  const value = read(file), { recordDigest, ...body } = value;
  if (value.schema !== SCHEMA || !DIGEST.test(value.generationId) || canonicalDigest(body) !== recordDigest ||
      !['closing', 'closed', 'complete'].includes(value.phase)) fail('RESET_FENCE_CORRUPT');
  return value;
}
function readMarker(file) {
  const { receiptDigest, ...body } = read(file);
  if (receiptDigest !== canonicalDigest(body)) fail('RESET_FENCE_MARKER_CORRUPT');
  return body;
}
function stoppedIntent(file) {
  const value = read(file);
  if (value.schema !== 'shelfdeck.runtime-intent@1' || value.desiredMode !== 'stopped' ||
      !Number.isSafeInteger(value.revision)) fail('RESET_FENCE_RUNTIME_NOT_STOPPED');
  return value;
}
function safeRoot(dataDir, p) {
  const same = value => process.platform === 'win32' ? value.toLowerCase() : value;
  if (!path.isAbsolute(dataDir) || same(fs.realpathSync.native(dataDir)) !== same(path.resolve(dataDir)) ||
      fs.lstatSync(p.root).isSymbolicLink() || same(fs.realpathSync.native(p.root)) !== same(p.root)) fail('RESET_FENCE_PATH_UNSAFE');
}

// This gate runs before constructing a Kernel. An interrupted cold transition
// is recovered by the independent Operator, never by opening whichever DB file
// happens to exist and resuming its old execution graph.
function assertBusinessGenerationOpenAllowed(dataDir) {
  const p = paths(dataDir);
  if (present(p.root) && fs.lstatSync(p.root).isSymbolicLink()) fail('RESET_FENCE_PATH_UNSAFE');
  if (!present(p.fence)) return;
  safeRoot(dataDir, p);
  const fence = readFence(p.fence);
  if (fence.phase !== 'complete') fail('RESET_COLD_RECOVERY_REQUIRED');
  const marker = readMarker(p.marker);
  if (marker.generationId !== fence.generationId || marker.candidateDigest !== fence.candidateDigest)
    fail('RESET_FENCE_GENERATION_CHANGED');
  if (read(p.intent).pendingReset) fail('RESET_COLD_FINALIZATION_REQUIRED');
  // Completion never grants supply. An explicit later Runtime Resume owns
  // that decision, so startup must not rewrite the user's durable intent.
}

function createColdResetFence({ dataDir, generationId, expectedRuntimeRevision }) {
  if (!DIGEST.test(generationId) || !Number.isSafeInteger(expectedRuntimeRevision)) fail('RESET_FENCE_INPUT_INVALID');
  const p = paths(dataDir); safeRoot(dataDir, p);
  function save(body) { writeAtomic(p.fence, { ...body, recordDigest: canonicalDigest(body) }); }
  function current() {
    const value = readFence(p.fence);
    if (value.generationId !== generationId || value.runtimeRevision !== expectedRuntimeRevision) fail('RESET_FENCE_GENERATION_CHANGED');
    return value;
  }
  function assertIntent() {
    const value = stoppedIntent(p.intent);
    if (value.revision !== expectedRuntimeRevision || value.pendingReset?.resetId !== generationId)
      fail('RESET_FENCE_RUNTIME_CHANGED');
    if (present(p.fence)) {
      const saved = readFence(p.fence);
      if (saved.generationId === generationId && saved.runtimeIntentDigest !== canonicalDigest(value))
        fail('RESET_FENCE_RUNTIME_CHANGED');
    }
    return value;
  }
  function begin() {
    const intent = assertIntent();
    if (present(p.fence)) {
      const prior = readFence(p.fence);
      if (prior.generationId === generationId) return current();
      if (prior.phase !== 'complete') fail('RESET_COLD_RECOVERY_REQUIRED');
      // A completed prior transition may be replaced only under a new,
      // explicitly pending Runtime operation, after its marker is verified.
      const marker = readMarker(p.marker);
      if (marker.generationId !== prior.generationId || marker.candidateDigest !== prior.candidateDigest)
        fail('RESET_FENCE_GENERATION_CHANGED');
    }
    const body = { schema: SCHEMA, generationId, runtimeRevision: expectedRuntimeRevision,
      runtimeIntentDigest: canonicalDigest(intent), phase: 'closing', candidateDigest: null };
    save(body); return current();
  }
  function markClosed(receipt) {
    assertIntent(); const value = current();
    if (receipt?.generationId !== generationId || receipt.allBusinessConnectionsClosed !== true ||
        !['closing', 'closed'].includes(value.phase)) fail('RESET_FENCE_CLOSE_NOT_PROVEN');
    const { recordDigest, ...body } = value;
    save({ ...body, phase: 'closed' }); return current();
  }
  function assertClosed(requestedGeneration = generationId) {
    assertIntent(); const value = current();
    if (requestedGeneration !== generationId || value.phase !== 'closed') fail('RESET_FENCE_CONNECTIONS_NOT_CLOSED');
  }
  function complete(receipt) {
    assertIntent();
    const prior = current();
    if (prior.phase === 'complete' && prior.receiptDigest === canonicalDigest(receipt)) return prior;
    assertClosed();
    if (receipt?.generationId !== generationId || receipt.databaseGeneration !== generationId ||
        receipt.phase !== 'complete' || receipt.desiredMode !== 'stopped' || !DIGEST.test(receipt.candidateDigest))
      fail('RESET_FENCE_COMPLETION_NOT_PROVEN');
    const marker = readMarker(p.marker);
    if (marker.generationId !== generationId || marker.candidateDigest !== receipt.candidateDigest)
      fail('RESET_FENCE_GENERATION_CHANGED');
    const { recordDigest, ...body } = current();
    const resultPath = path.join(p.root, 'generation-' + generationId + '-result.json');
    if (present(resultPath)) {
      if (canonicalDigest(read(resultPath)) !== canonicalDigest(receipt)) fail('RESET_FENCE_COMPLETION_NOT_PROVEN');
    } else writeAtomic(resultPath, receipt);
    save({ ...body, phase: 'complete', candidateDigest: receipt.candidateDigest, receiptDigest: canonicalDigest(receipt) });
    return current();
  }
  function completedReceipt() {
    assertIntent(); const value = current();
    if (value.phase !== 'complete') return null;
    const marker = readMarker(p.marker), receipt = read(path.join(p.root, 'generation-' + generationId + '-result.json'));
    if (marker.generationId !== generationId || marker.candidateDigest !== value.candidateDigest ||
        canonicalDigest(receipt) !== value.receiptDigest) fail('RESET_FENCE_COMPLETION_NOT_PROVEN');
    return receipt;
  }
  return Object.freeze({ begin, markClosed, assertClosed, complete, completedReceipt });
}

// Runs before any business Kernel is constructed. Only the final bookkeeping
// of a proven complete cold operation is recovered here. An unfinished switch
// or cleanup must remain fenced for the independent Operator to continue.
function finalizeCompletedColdReset(dataDir, { checkpoint = () => {}, now = () => new Date().toISOString() } = {}) {
  const p = paths(dataDir);
  if (!present(p.fence)) return null;
  safeRoot(dataDir, p);
  const fence = readFence(p.fence);
  if (fence.phase !== 'complete') fail('RESET_COLD_RECOVERY_REQUIRED');
  const marker = readMarker(p.marker);
  if (marker.generationId !== fence.generationId || marker.candidateDigest !== fence.candidateDigest)
    fail('RESET_FENCE_GENERATION_CHANGED');
  const intent = read(p.intent);
  if (!intent.pendingReset) return null;
  if (intent.desiredMode !== 'stopped' || intent.revision !== fence.runtimeRevision ||
      canonicalDigest(intent) !== fence.runtimeIntentDigest || intent.pendingReset.resetId !== fence.generationId ||
      !DIGEST.test(intent.pendingReset.operationId)) fail('RESET_FENCE_RUNTIME_CHANGED');
  const result = read(path.join(p.root, 'generation-' + fence.generationId + '-result.json'));
  if (canonicalDigest(result) !== fence.receiptDigest || result.phase !== 'complete' ||
      result.generationId !== fence.generationId || result.databaseGeneration !== fence.generationId ||
      result.candidateDigest !== fence.candidateDigest || result.desiredMode !== 'stopped')
    fail('RESET_FENCE_COMPLETION_NOT_PROVEN');
  const operationPath = path.join(p.root, intent.pendingReset.operationId + '.json'), operation = read(operationPath);
  if (operation.kind !== 'reset' || operation.operationId !== intent.pendingReset.operationId ||
      !DIGEST.test(operation.requestDigest) || !['pending', 'failed', 'completed'].includes(operation.state))
    fail('RESET_FENCE_OPERATION_CHANGED');
  if (operation.state === 'completed') {
    if (canonicalDigest(operation.result) !== canonicalDigest(result)) fail('RESET_FENCE_OPERATION_CHANGED');
  } else {
    const { error, ...prior } = operation;
    writeAtomic(operationPath, { ...prior, state: 'completed', result, finishedAt: now() });
  }
  checkpoint('runtime_receipt_completed');
  // Clearing intent is last: interruption between these writes is idempotent,
  // and never grants supply or causes an old execution graph to reopen.
  writeAtomic(p.intent, { ...intent, pendingReset: null, revision: intent.revision + 1 });
  checkpoint('runtime_intent_finalized');
  return result;
}

function readColdResetState(dataDir) {
  const p = paths(dataDir);
  if (!present(p.fence)) return null;
  safeRoot(dataDir, p);
  const fence = readFence(p.fence), intent = read(p.intent);
  if (fence.phase === 'complete') {
    const marker = readMarker(p.marker);
    if (marker.generationId !== fence.generationId || marker.candidateDigest !== fence.candidateDigest)
      fail('RESET_FENCE_GENERATION_CHANGED');
  }
  return Object.freeze({ fence, intent });
}

module.exports = Object.freeze({ createColdResetFence, assertBusinessGenerationOpenAllowed, finalizeCompletedColdReset, readColdResetState });
