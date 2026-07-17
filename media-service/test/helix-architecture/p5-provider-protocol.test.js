'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  canonicalJson, createProviderArtifactAdapter, createProviderObservationAdapter, createProviderRequestAdapter
} = require('../../src/helix/integrations/provider-protocol');
const operationCatalog = require('../../src/helix/contracts/ports/p5-provider-operation-contracts.json');

const NOW = 1_700_000_000_000;
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const ref = (name) => Object.freeze({ objectType: name, objectId: name + '-1', revision: 1, digest: digest(name) });

function handle(operation, providerType) {
  return Object.freeze({
    schemaRef: 'helix://contracts/types/IntegrationHandle/v1', schemaVersion: 1,
    handleId: 'handle-1', integrationId: 'integration-1', integrationType: providerType,
    configRevision: 3, secretRef: 'secret-ref-1', allowedOperation: operation,
    expiresAtMs: NOW + 60_000, fenceDigest: digest('integration-fence')
  });
}

function lease(operation) {
  return Object.freeze({
    schemaRef: 'helix://contracts/ports/platform.secret-lease.resolve/v1/output', schemaVersion: 1,
    handleId: 'lease-1', secretRef: 'secret-ref-1', ownerScopeType: 'integration', ownerScopeId: 'integration-1',
    secretKind: 'access-token', purpose: operation, revision: 4, issuedAtMs: NOW,
    expiresAtMs: NOW + 30_000, fenceDigest: digest('lease-fence')
  });
}

const inputs = Object.freeze({
  'shared.integration.availability.observe@1': Object.freeze({}),
  'perception.source.acquire@1': Object.freeze({ sourceRef: ref('perception-source'), cursor: null, limit: 20 }),
  'people.registration_evidence.observe@1': Object.freeze({ personHintRef: ref('person-hint'), limit: 10 }),
  'libra.product_metadata.fetch@1': Object.freeze({ productIdentityRef: ref('product-identity'), locale: 'zh-CN' }),
  'libra.external_material.search@1': Object.freeze({ acquisitionQueryRef: ref('acquisition-query'), limit: 25 }),
  'libra.product_artifact.acquire@1': Object.freeze({ sourceRef: ref('provider-asset'), workspaceTargetRef: ref('workspace-target') }),
  'arca.aftercare.binary_artifact.acquire@1': Object.freeze({ sourceRef: ref('provider-asset'), workspaceTargetRef: ref('workspace-target') }),
  'libra.external_material.acquire.request@1': Object.freeze({ candidateRef: ref('candidate'), deliveryContractRef: ref('delivery-contract') })
});

function artifactHandle() {
  return Object.freeze({
    schemaRef: 'helix://contracts/types/ArtifactHandle/v1', schemaVersion: 1,
    artifactHandleId: 'artifact-1', artifactKind: 'provider-asset', ownerDomain: 'libra',
    ownerScope: Object.freeze({ scopeType: 'libra-run', scopeId: 'run-1' }), storageRef: 'artifact:one',
    digestAlgorithm: 'sha256', digestHex: digest('artifact'), sizeBytes: 42, mediaType: 'image/jpeg',
    provenanceRef: ref('provider-response'), referenceRevision: 1
  });
}

function resultFor(operation, request) {
  if (operation.resultKind === 'availability') return Object.freeze({ availabilityEvidenceRef: ref('availability') });
  if (operation.resultKind === 'reference') return Object.freeze({ resultRef: ref('metadata-observation') });
  if (operation.resultKind === 'reference-list') return Object.freeze({ resultRefs: Object.freeze([ref('provider-observation')]), nextCursor: null });
  if (operation.resultKind === 'artifact') return Object.freeze({ artifactHandle: artifactHandle() });
  return Object.freeze({ externalJobReceipt: Object.freeze({
    schemaRef: 'helix://contracts/types/ExternalJobReceipt/v1', schemaVersion: 1,
    receiptId: 'receipt-1', integrationId: request.integrationHandle.integrationId, externalJobId: 'job-1',
    operationKind: request.operationId, idempotencyKey: request.idempotencyKey, requestDigest: request.requestDigest,
    configRevision: request.integrationHandle.configRevision, createdAtMs: NOW
  }) });
}

function requestFor(operation, providerType) {
  const integrationHandle = handle(operation.operationId, providerType);
  const input = inputs[operation.operationId];
  const idempotencyKey = 'idem-' + operation.operationId.replaceAll('@', '-').replaceAll('.', '-');
  const requestDigest = digest(canonicalJson({
    integrationId: integrationHandle.integrationId, integrationType: integrationHandle.integrationType,
    configRevision: integrationHandle.configRevision, operationId: operation.operationId, idempotencyKey, input
  }));
  return Object.freeze({
    integrationHandle, secretLeaseHandle: lease(operation.operationId), operationId: operation.operationId,
    idempotencyKey, requestDigest, timeoutMs: operation.maxTimeoutMs, input
  });
}

function fixture(operation, overrides = {}) {
  const calls = [];
  let retainedSecret;
  let timeoutSeen;
  const transport = overrides.transport || { execute: async (transportRequest) => {
    calls.push(transportRequest);
    retainedSecret = transportRequest.secretBytes;
    const result = resultFor(operation, overrides.request);
    const resultJson = canonicalJson(result);
    return Object.freeze({ transportRequestId: 'transport-request-1', statusCode: 200,
      responseBytes: Buffer.byteLength(resultJson), responseDigest: digest(resultJson), result });
  } };
  const secretLeaseBroker = {
    async consumeAsync(secretLeaseHandle, consumer) {
      assert.equal(secretLeaseHandle, overrides.request.secretLeaseHandle);
      const bytes = Buffer.from('synthetic-provider-secret');
      try { return await consumer(bytes); } finally { bytes.fill(0); }
    }
  };
  const timeoutController = { async run(promise, timeoutMs) { timeoutSeen = timeoutMs; return promise; } };
  const factory = operation.effectClass === 'pure_observation' ? createProviderObservationAdapter
    : operation.effectClass === 'workspace_write' ? createProviderArtifactAdapter : createProviderRequestAdapter;
  return {
    adapter: factory({ transport, secretLeaseBroker, timeoutController, now: () => NOW, digest }), calls,
    retained: () => retainedSecret, timeoutSeen: () => timeoutSeen
  };
}

test('operation catalog exactly traces all eight IntegrationHandle Capability contracts and their Effect Classes', () => {
  const manifestRoot = path.resolve(__dirname, '../../src/helix/contracts/capabilities');
  const manifests = [];
  (function walk(root) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.name === 'manifest.json') {
        const manifest = JSON.parse(fs.readFileSync(target, 'utf8'));
        if (Object.keys(manifest.inputPorts || {}).includes('integrationHandle')) manifests.push(manifest);
      }
    }
  })(manifestRoot);
  const actual = operationCatalog.operations.map(({ operationId, effectClass }) => ({ operationId, effectClass }))
    .sort((left, right) => left.operationId.localeCompare(right.operationId));
  const expected = manifests.map((manifest) => ({ operationId: manifest.capabilityRef, effectClass: manifest.effectClass }))
    .sort((left, right) => left.operationId.localeCompare(right.operationId));
  assert.deepEqual(actual, expected);
  assert.deepEqual([...new Set(actual.map((item) => item.effectClass))].sort(), ['external_request', 'pure_observation', 'workspace_write']);
  const atoms = operationCatalog.operations.flatMap((operation) => Object.entries(operation.atoms));
  assert.equal(new Set(atoms.map(([, atomId]) => atomId)).size, atoms.length);
  for (const [providerType, atomId] of atoms) {
    assert.ok(operationCatalog.providerTypes.includes(providerType));
    assert.match(atomId, new RegExp('^' + providerType.replace('-', '\\-') + '\\..+@1$'));
  }
});

test('all provider-specific operations execute through the exact Effect Class port with bounded typed results', async () => {
  for (const operation of operationCatalog.operations) {
    const providerType = Object.keys(operation.atoms)[0];
    const request = requestFor(operation, providerType);
    const f = fixture(operation, { request });
    const output = await f.adapter.execute(request);
    assert.equal(output.operationId, operation.operationId);
    assert.equal(output.effectClass, operation.effectClass);
    assert.equal(output.requestDigest, request.requestDigest);
    assert.ok(output.responseBytes > 0);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].providerType, providerType);
    assert.equal(f.calls[0].protocolAtomId, operation.atoms[providerType]);
    assert.equal(f.calls[0].idempotencyKey, request.idempotencyKey);
    assert.equal(f.timeoutSeen(), operation.maxTimeoutMs);
    assert.ok(f.retained().every((value) => value === 0));
    assert.equal(JSON.stringify(output).includes('synthetic-provider-secret'), false);
  }
});

test('wrong Effect Class, provider type, operation scope, expiry, or Secret Lease fails before transport', async () => {
  const operation = operationCatalog.operations.find((item) => item.operationId === 'libra.product_metadata.fetch@1');
  const request = requestFor(operation, 'tmdb');
  const f = fixture(operation, { request });
  const wrongFactory = createProviderRequestAdapter({
    transport: { execute: async () => assert.fail('transport must not run') },
    secretLeaseBroker: { consumeAsync: async () => assert.fail('secret must not resolve') },
    timeoutController: { run: async () => assert.fail('timeout must not run') }, now: () => NOW, digest
  });
  await assert.rejects(() => wrongFactory.execute(request), (error) => error.code === 'P5_PROVIDER_OPERATION_DENIED');
  await assert.rejects(() => f.adapter.execute({ ...request, integrationHandle: { ...request.integrationHandle, integrationType: 'moviepilot' } }),
    (error) => error.code === 'P5_PROVIDER_HANDLE_DENIED');
  await assert.rejects(() => f.adapter.execute({ ...request, integrationHandle: { ...request.integrationHandle, allowedOperation: 'other@1' } }),
    (error) => error.code === 'P5_PROVIDER_HANDLE_DENIED');
  await assert.rejects(() => f.adapter.execute({ ...request, integrationHandle: { ...request.integrationHandle, expiresAtMs: NOW - 1 } }),
    (error) => error.code === 'P5_PROVIDER_HANDLE_DENIED');
  await assert.rejects(() => f.adapter.execute({ ...request, secretLeaseHandle: { ...request.secretLeaseHandle, purpose: 'other@1' } }),
    (error) => error.code === 'P5_PROVIDER_LEASE_DENIED');
  assert.equal(f.calls.length, 0);
});

test('digest drift, excess timeout, open input, and response bound fail closed', async () => {
  const operation = operationCatalog.operations.find((item) => item.operationId === 'libra.external_material.search@1');
  const request = requestFor(operation, 'moviepilot');
  let f = fixture(operation, { request });
  await assert.rejects(() => f.adapter.execute({ ...request, requestDigest: digest('wrong') }),
    (error) => error.code === 'P5_PROVIDER_REQUEST_DIGEST_MISMATCH');
  await assert.rejects(() => f.adapter.execute({ ...request, timeoutMs: operation.maxTimeoutMs + 1 }),
    (error) => error.code === 'P5_PROVIDER_REQUEST_FENCE');
  await assert.rejects(() => f.adapter.execute({ ...request, input: { ...request.input, arbitraryPayload: true } }),
    (error) => error.code === 'P5_PROVIDER_INPUT_SHAPE');
  f = fixture(operation, { request, transport: { execute: async () => ({
    transportRequestId: 'transport-request-1', statusCode: 200, responseBytes: operation.maxResponseBytes + 1,
    responseDigest: digest(canonicalJson(resultFor(operation, request))), result: resultFor(operation, request)
  }) } });
  await assert.rejects(() => f.adapter.execute(request), (error) => error.code === 'P5_PROVIDER_RESPONSE_INVALID');
});

test('external job receipt must match exact integration, operation, idempotency, digest, and revision', async () => {
  const operation = operationCatalog.operations.find((item) => item.resultKind === 'job');
  const request = requestFor(operation, 'moviepilot');
  const bad = resultFor(operation, request);
  const transport = { execute: async () => ({
    transportRequestId: 'transport-request-1', statusCode: 200,
    responseBytes: Buffer.byteLength(canonicalJson({ externalJobReceipt: { ...bad.externalJobReceipt, requestDigest: digest('other') } })),
    responseDigest: digest(canonicalJson({ externalJobReceipt: { ...bad.externalJobReceipt, requestDigest: digest('other') } })),
    result: { externalJobReceipt: { ...bad.externalJobReceipt, requestDigest: digest('other') } }
  }) };
  const f = fixture(operation, { request, transport });
  await assert.rejects(() => f.adapter.execute(request), (error) => error.code === 'P5_PROVIDER_JOB_MISMATCH');
});

test('transport failures are redacted and secret bytes never enter outputs or errors', async () => {
  const operation = operationCatalog.operations[0];
  const request = requestFor(operation, 'emby');
  const f = fixture(operation, { request, transport: { execute: async ({ secretBytes }) => {
    throw new Error('transport leaked ' + secretBytes.toString('utf8'));
  } } });
  await assert.rejects(() => f.adapter.execute(request),
    (error) => error.code === 'P5_PROVIDER_TRANSPORT_FAILED' && !error.message.includes('synthetic-provider-secret'));
});

test('provider protocol implementation has no network, filesystem, Domain Store, legacy adapter, or ambient credential access', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/helix/integrations/provider-protocol.js'), 'utf8').toLowerCase();
  for (const forbidden of [
    'node:' + 'http', 'node:' + 'https', 'fetch' + '(', 'axios', 'node:' + 'fs', 'process.' + 'env',
    '/domains/', 'metadata' + 'provideradapter', 'emby' + 'service', 'moviepilot' + 'service', 'douban' + 'service'
  ]) assert.equal(source.includes(forbidden), false, forbidden);
});
