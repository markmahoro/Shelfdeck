'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createWorkerProtocolAdapter } = require('../../src/helix/integrations/worker-protocol');
const catalog = require('../../src/helix/contracts/ports/p5-worker-operation-contracts.json');

const SHA = 'a'.repeat(64);
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function canonical(value) { if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'; return JSON.stringify(value); }
function workerHandle(operationId, changes = {}) { return { schemaRef: 'helix://contracts/types/WorkerHandle/v1', schemaVersion: 1,
  handleId: 'handle-1', workerId: 'worker-1', workerRevision: 2, protocolVersion: 'worker-v1', secretRef: 'secret-1',
  capabilityDigest: SHA, allowedOperation: operationId, expiresAtMs: 2000, fenceDigest: SHA, ...changes }; }
function lease(operationId, changes = {}) { return { handleId: 'lease-1', secretRef: 'secret-1', ownerScopeType: 'worker', ownerScopeId: 'worker-1',
  purpose: operationId, expiresAtMs: 1900, ...changes }; }
function assetReceipt() { return { schemaRef: 'helix://contracts/types/WorkerAssetReceipt/v1', schemaVersion: 1, workerAssetId: 'asset-1',
  workerId: 'worker-1', sourceHandleDigest: SHA, registrationReceipt: 'register-1', configRevision: 2, createdAtMs: 1000 }; }
function uploadReceipt() { return { schemaRef: 'helix://contracts/types/WorkerUploadReceipt/v1', schemaVersion: 1, workerAssetId: 'asset-1',
  workerId: 'worker-1', uploadReceipt: 'upload-1', uploadedDigest: SHA, sizeBytes: 10, completedAtMs: 1000 }; }
function input(operationId) { if (operationId === 'worker.asset.register@1') return { sourceHandleDigest: SHA };
  if (operationId === 'worker.asset.upload@1') return { workerAssetReceipt: assetReceipt(), materialHandleDigest: SHA, sizeBytes: 10 };
  return { workerUploadReceipt: uploadReceipt(), analysisSpecDigest: SHA }; }
function request(operation, changes = {}) {
  const handle = workerHandle(operation.operationId); const body = input(operation.operationId); const idempotencyKey = 'idem-1';
  const requestDigest = digest(canonical({ operationId: operation.operationId, capabilityRef: operation.capabilityRef, idempotencyKey,
    workerId: handle.workerId, workerRevision: handle.workerRevision, capabilityDigest: handle.capabilityDigest, input: body }));
  return { operationId: operation.operationId, capabilityRef: operation.capabilityRef, effectClass: 'external_request', idempotencyKey,
    requestDigest, workerHandle: handle, secretLeaseHandle: lease(operation.operationId), input: body, ...changes };
}
function fixture(records = {}) {
  return createWorkerProtocolAdapter({ digest, now: () => 1000,
    secretLeaseBroker: { consumeAsync: async (handle, callback) => { const bytes = Buffer.from('synthetic-secret'); records.secret = bytes;
      try { return await callback(bytes); } finally { bytes.fill(0); } } },
    transport: { execute: async (command) => { records.command = command;
      if (command.protocolAtomId === 'worker.asset.register@1') return { workerAssetId: 'asset-1', sourceHandleDigest: SHA, registrationReceipt: 'register-1', configRevision: 2, createdAtMs: 1001 };
      if (command.protocolAtomId === 'worker.asset.upload@1') return { workerAssetId: 'asset-1', uploadReceipt: 'upload-1', uploadedDigest: SHA, sizeBytes: 10, completedAtMs: 1002 };
      return { receiptId: 'receipt-1', externalJobId: 'job-1', createdAtMs: 1003 };
    } } });
}

test('Worker catalog reverse-traces exact external_request Capability manifests', () => {
  assert.equal(catalog.operations.length, 3);
  for (const operation of catalog.operations) {
    const manifestPath = path.resolve(__dirname, '../../src/helix/contracts/capabilities', ...operation.capabilityRef.replace(/@1$/, '').split('.'), 'v1', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.capabilityRef, operation.capabilityRef);
    assert.equal(manifest.effectClass, 'external_request');
    assert.match(operation.protocolAtomId, /@1$/);
  }
});

test('passive Worker accepts one typed operation and returns exact typed receipts', async () => {
  for (const operation of catalog.operations) {
    const records = {}; const result = await fixture(records).execute(request(operation));
    assert.equal(records.command.protocolAtomId, operation.protocolAtomId);
    assert.equal(records.command.workerHandleId, 'handle-1');
    assert.equal(records.command.timeoutMs, operation.timeoutMs);
    assert.equal(Object.hasOwn(records.command, 'url'), false);
    assert.equal(Object.hasOwn(records.command, 'argv'), false);
    assert.equal(result.schemaRef.endsWith('/' + operation.resultKind + '/v1'), true);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(records.secret.every((byte) => byte === 0), true);
  }
});

test('wrong Capability, Effect Class, operation, expiry, or secret scope fails before transport', async () => {
  const operation = catalog.operations[0];
  for (const changes of [
    { capabilityRef: 'shared.worker.asset.upload@1' }, { effectClass: 'workspace_write' },
    { workerHandle: workerHandle('worker.asset.upload@1') },
    { workerHandle: workerHandle(operation.operationId, { expiresAtMs: 1000 }) },
    { secretLeaseHandle: lease(operation.operationId, { ownerScopeId: 'worker-2' }) }
  ]) {
    const records = {};
    await assert.rejects(fixture(records).execute(request(operation, changes)), (error) => /^P5_WORKER_PROTOCOL_/.test(error.code));
    assert.equal(records.command, undefined);
  }
});

test('request digest and upstream receipt Worker identity are immutable fences', async () => {
  const register = catalog.operations[0];
  await assert.rejects(fixture().execute(request(register, { requestDigest: SHA })), (error) => error.code === 'P5_WORKER_PROTOCOL_REQUEST_DIGEST');
  const upload = catalog.operations[1]; const badInput = { ...input(upload.operationId), workerAssetReceipt: { ...assetReceipt(), workerId: 'worker-2' } };
  await assert.rejects(fixture().execute(request(upload, { input: badInput })), (error) => error.code === 'P5_WORKER_PROTOCOL_RECEIPT_WORKER');
});

test('open input, mismatched result, and transport error are rejected/redacted', async () => {
  const operation = catalog.operations[0];
  await assert.rejects(fixture().execute(request(operation, { input: { sourceHandleDigest: SHA, argv: ['escape'] } })),
    (error) => error.code === 'P5_WORKER_PROTOCOL_INPUT_SHAPE');
  const bad = createWorkerProtocolAdapter({ digest, now: () => 1000, secretLeaseBroker: { consumeAsync: (_h, cb) => cb(Buffer.from('x')) },
    transport: { execute: async () => ({ workerAssetId: 'asset-1', sourceHandleDigest: 'b'.repeat(64), registrationReceipt: 'r', configRevision: 2, createdAtMs: 1 }) } });
  await assert.rejects(bad.execute(request(operation)), (error) => error.code === 'P5_WORKER_PROTOCOL_RESULT_BINDING');
  const leaking = createWorkerProtocolAdapter({ digest, now: () => 1000, secretLeaseBroker: { consumeAsync: (_h, cb) => cb(Buffer.from('x')) },
    transport: { execute: async () => { throw new Error('http://worker secret path'); } } });
  await assert.rejects(leaking.execute(request(operation)), (error) => error.code === 'P5_WORKER_PROTOCOL_EXECUTION_FAILED' && !error.message.includes('http'));
});

test('clean Worker protocol has no Store polling, direct network/process, queue, or legacy import', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/helix/integrations/worker-protocol.js'), 'utf8').toLowerCase();
  for (const fragment of ['node:http', 'node:child_process', "require('fs')", 'taskstore', 'workflowstore', 'setinterval', 'poll(', 'jobs = new map', 'media-worker']) {
    assert.equal(source.includes(fragment), false, fragment);
  }
});
