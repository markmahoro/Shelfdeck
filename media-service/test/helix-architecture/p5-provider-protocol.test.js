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
const identity = Object.freeze({ provider: 'tmdb', namespace: 'tmdb_movie', providerKey: '550', seasonNumber: null,
  identityAnchorDigest: digest('identity-anchor') });

function acquisitionQuery() {
  const term = Object.freeze({ ordinal: 0, termKind: 'provider_key', value: '550',
    termDigest: digest(canonicalJson({ schema: 'libra.external-acquisition-query-term@1', termKind: 'provider_key', value: '550' })) });
  const value = {
    schemaRef: 'helix://contracts/types/AcquisitionQuery/v1', schemaVersion: 1, draftId: 'query-1',
    draftKind: 'external-acquisition-query', basisDigest: digest('query-basis'),
    producedAtMs: NOW, libraRunId: 'run-1', runExecutionBasisDigest: digest('run-basis'),
    resolvedIdentityDigest: digest('resolved-identity'), productStructureDigest: digest('product-structure'),
    structureKind: 'single', contentProfile: 'movie', providerIdentityAnchors: [identity], requestedEpisodeKeys: [],
    queryTerms: [term], hardConstraints: { requiredStructureKind: 'single', requiredEpisodeKeys: [] }
  };
  value.queryDigest = digest(canonicalJson({ schema: 'libra.external-acquisition-query@1', libraRunId: value.libraRunId,
    runExecutionBasisDigest: value.runExecutionBasisDigest, resolvedIdentityDigest: value.resolvedIdentityDigest,
    productStructureDigest: value.productStructureDigest, structureKind: value.structureKind, contentProfile: value.contentProfile,
    providerIdentityAnchors: value.providerIdentityAnchors, requestedEpisodeKeys: value.requestedEpisodeKeys,
    queryTerms: value.queryTerms, hardConstraints: value.hardConstraints }));
  value.draftDigest = digest(canonicalJson(value));
  return Object.freeze(value);
}

function candidate() {
  const providerCandidateRef = ref('acquisition_candidate');
  const value = { integrationId: 'integration-1', configRevision: 3, providerCandidateRef, providerRank: 0,
    identityAnchors: [identity], structureKind: 'single', episodeKeys: [], availability: 'available' };
  value.candidateId = digest(canonicalJson({ schema: 'provider-acquisition-candidate-id@1', integrationId: value.integrationId,
    configRevision: value.configRevision, providerCandidateRef }));
  const ordered = { candidateId: value.candidateId, integrationId: value.integrationId, configRevision: value.configRevision,
    providerCandidateRef, providerRank: value.providerRank, identityAnchors: value.identityAnchors,
    structureKind: value.structureKind, episodeKeys: value.episodeKeys, availability: value.availability };
  return Object.freeze({ ...ordered, candidateDigest: digest(canonicalJson(ordered)) });
}

function selectedCandidate() {
  const selected = candidate(), queryDigest = acquisitionQuery().queryDigest, candidateSetDigest = digest('candidate-set'),
    selectionCriteriaDigest = digest('selection-criteria');
  const value = { schemaRef: 'helix://contracts/types/SelectedCandidate/v1', schemaVersion: 1,
    draftId: digest(canonicalJson({ schema: 'libra.external-selected-candidate-id@1', queryDigest, candidateSetDigest,
      selectionCriteriaDigest })), draftKind: 'external-selected-candidate',
    basisDigest: digest(canonicalJson({ schema: 'libra.external-candidate-selection-basis@1', queryDigest, candidateSetDigest,
      selectionCriteriaDigest })), producedAtMs: NOW, queryDigest, candidateSetDigest, selectionCriteriaDigest, result: 'selected',
    selectedCandidate: selected, selectedCandidateId: selected.candidateId, selectionReasonCode: 'selected_by_provider_rank' };
  return Object.freeze({ ...value, draftDigest: digest(canonicalJson(value)) });
}

function outputSnapshot() {
  const memberBasis = { ordinal: 0, externalMemberId: 'member-1', relativePath: 'movie.mkv', sizeBytes: 42,
    checksumAlgorithm: 'sha256', checksumHex: digest('movie'), episodeClaims: [] };
  const members = [Object.freeze({ ...memberBasis, memberDigest: digest(canonicalJson(memberBasis)) })];
  const memberSetDigest = digest(canonicalJson({ schema: 'provider-external-material-members@1', items: members }));
  const value = { integrationId: 'integration-1', configRevision: 3, externalObjectRef: 'external-1', endpointId: 'endpoint-1',
    location: '/provider/external-1', structureKind: 'single', members, identityAnchors: [identity], observedTitle: 'Movie',
    releaseYear: 1999, observedAtMs: NOW, newestMutationAtMs: NOW - 60_000, memberSetDigest,
    manifestDigest: digest(canonicalJson({ schema: 'provider-external-material-manifest@1', structureKind: 'single', memberSetDigest })) };
  return Object.freeze({ ...value, snapshotDigest: digest(canonicalJson(value)) });
}

function externalMaterialHandle() {
  const snapshot = outputSnapshot();
  const handleId = digest(canonicalJson({ schema: 'libra.external-material-handle-id@1', integrationId: snapshot.integrationId,
    configRevision: snapshot.configRevision, externalObjectRef: snapshot.externalObjectRef, observationRevision: 1,
    manifestDigest: snapshot.manifestDigest }));
  return Object.freeze({ schemaRef: 'helix://contracts/types/ExternalMaterialHandle/v1', schemaVersion: 1,
    handleId, integrationId: snapshot.integrationId, configRevision: snapshot.configRevision,
    externalObjectRef: snapshot.externalObjectRef, endpointId: snapshot.endpointId, location: snapshot.location,
    structureKind: snapshot.structureKind, outputSnapshot: snapshot, manifestDigest: snapshot.manifestDigest,
    observationRevision: 1, accessFenceDigest: digest(canonicalJson({ schema: 'libra.external-material-access-fence@1',
      handleId, endpointId: snapshot.endpointId, location: snapshot.location, outputSnapshotDigest: snapshot.snapshotDigest })) });
}

function jobReceipt(operationId = 'libra.external_material.acquire.request@1', requestDigest = digest('acquire-request')) {
  return Object.freeze({ schemaRef: 'helix://contracts/types/ExternalJobReceipt/v1', schemaVersion: 1,
    receiptId: 'receipt-1', integrationId: 'integration-1', externalJobId: 'job-1', operationKind: operationId,
    idempotencyKey: 'acquire-idem', requestDigest, configRevision: 3, createdAtMs: NOW });
}

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
  'libra.routing.fact.observe@1': Object.freeze({ contentProfile: 'movie', title: 'Chungking Express', yearHint: 1994 }),
  'libra.product_metadata.fetch@1': Object.freeze({ productIdentityRef: ref('product-identity'), locale: 'zh-CN' }),
  'libra.external_material.search@1': Object.freeze({ acquisitionQuery: acquisitionQuery(), limit: 25 }),
  'libra.external_material.acquire.observe@1': Object.freeze({ externalJobReceipt: jobReceipt(), phase: 'download' }),
  'libra.external_material.stability.observe@1': Object.freeze({ externalMaterialHandle: externalMaterialHandle(), quietWindowMs: 60_000 }),
  'libra.product_artifact.acquire@1': Object.freeze({ sourceRef: ref('provider-asset'), workspaceTargetRef: ref('workspace-target') }),
  'arca.aftercare.binary_artifact.acquire@1': Object.freeze({ sourceRef: ref('provider-asset'), workspaceTargetRef: ref('workspace-target') }),
  'libra.external_material.acquire.request@1': Object.freeze({ acquisitionQuery: acquisitionQuery(), selectedCandidate: selectedCandidate() })
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
  if (operation.resultKind === 'acquisition-candidate-list') {
    const candidates = [candidate()];
    return Object.freeze({ queryDigest: request.input.acquisitionQuery.queryDigest, candidates,
      candidateSetDigest: digest(canonicalJson({ schema: 'libra.external-acquisition-candidate-set@1',
        queryDigest: request.input.acquisitionQuery.queryDigest, integrationId: request.integrationHandle.integrationId,
        configRevision: request.integrationHandle.configRevision, items: candidates })) });
  }
  if (operation.resultKind === 'acquisition-job-snapshot') {
    const value = { externalJobReceiptId: request.input.externalJobReceipt.receiptId,
      requestDigest: request.input.externalJobReceipt.requestDigest, providerObservationRevision: 1,
      state: 'ready', outputSnapshot: outputSnapshot() };
    return Object.freeze({ ...value, snapshotDigest: digest(canonicalJson(value)) });
  }
  if (operation.resultKind === 'external-material-snapshot') {
    const value = { sourceExternalMaterialHandleId: request.input.externalMaterialHandle.handleId,
      providerObservationRevision: 2, outputSnapshot: outputSnapshot() };
    return Object.freeze({ ...value, snapshotDigest: digest(canonicalJson(value)) });
  }
  if (operation.resultKind === 'routing-candidate-list') return Object.freeze([Object.freeze({
    providerKey: '11104', title: 'Chungking Express', originalTitle: '重慶森林', releaseYear: 1994,
    regionCodes: Object.freeze(['HK']), genreCodes: Object.freeze(['18', '35'])
  })]);
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

test('operation catalog exactly traces all eleven IntegrationHandle Capability contracts and their Effect Classes', () => {
  const manifestRoot = path.resolve(__dirname, '../../src/helix/contracts/capabilities');
  const manifests = [];
  (function walk(root) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.name === 'manifest.json') {
        const manifest = JSON.parse(fs.readFileSync(target, 'utf8'));
        if (Object.keys(manifest.inputPorts || {}).some((name) => name.toLowerCase().includes('integrationhandle'))) manifests.push(manifest);
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
  for (const operation of operationCatalog.operations) {
    assert.ok(Number.isSafeInteger(operation.maxInputBytes) && operation.maxInputBytes > 0);
    assert.ok(Number.isSafeInteger(operation.maxResponseBytes) && operation.maxResponseBytes > 0);
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

test('old acquisition refs, forged candidate sets, and foreign material snapshots fail closed', async () => {
  const search = operationCatalog.operations.find((item) => item.operationId === 'libra.external_material.search@1');
  let request = requestFor(search, 'moviepilot');
  let f = fixture(search, { request });
  await assert.rejects(() => f.adapter.execute({ ...request, input: { acquisitionQueryRef: ref('acquisition-query'), limit: 25 } }),
    (error) => error.code === 'P5_PROVIDER_INPUT_SHAPE');

  const forged = resultFor(search, request);
  const forgedResult = { ...forged, candidates: [{ ...forged.candidates[0], candidateDigest: digest('forged') }] };
  f = fixture(search, { request, transport: { execute: async () => ({ transportRequestId: 'transport-request-1', statusCode: 200,
    responseBytes: Buffer.byteLength(canonicalJson(forgedResult)), responseDigest: digest(canonicalJson(forgedResult)), result: forgedResult }) } });
  await assert.rejects(() => f.adapter.execute(request), (error) => error.code === 'P5_PROVIDER_CANDIDATE_DIGEST');

  const observe = operationCatalog.operations.find((item) => item.operationId === 'libra.external_material.stability.observe@1');
  request = requestFor(observe, 'moviepilot');
  const foreign = resultFor(observe, request);
  const foreignBasis = { ...foreign, outputSnapshot: { ...foreign.outputSnapshot, externalObjectRef: 'foreign-object' } };
  delete foreignBasis.snapshotDigest;
  const foreignResult = { ...foreignBasis, snapshotDigest: digest(canonicalJson(foreignBasis)) };
  f = fixture(observe, { request, transport: { execute: async () => ({ transportRequestId: 'transport-request-1', statusCode: 200,
    responseBytes: Buffer.byteLength(canonicalJson(foreignResult)), responseDigest: digest(canonicalJson(foreignResult)), result: foreignResult }) } });
  await assert.rejects(() => f.adapter.execute(request), (error) =>
    ['P5_PROVIDER_OUTPUT_DIGEST', 'P5_PROVIDER_EXTERNAL_MATERIAL_CONTINUITY'].includes(error.code));
});

test('material observation rejects forged Handle fence and escaping or duplicate member paths before transport', async () => {
  const operation = operationCatalog.operations.find((item) => item.operationId === 'libra.external_material.stability.observe@1');
  let request = requestFor(operation, 'moviepilot');
  let f = fixture(operation, { request });
  await assert.rejects(() => f.adapter.execute({ ...request, input: { ...request.input,
    externalMaterialHandle: { ...request.input.externalMaterialHandle, accessFenceDigest: digest('forged-fence') } } }),
  (error) => error.code === 'P5_PROVIDER_EXTERNAL_HANDLE_FENCE');

  const snapshot = outputSnapshot(), badMember = { ...snapshot.members[0], relativePath: '../escape.mkv' };
  const { memberDigest: ignored, ...memberBasis } = badMember;
  badMember.memberDigest = digest(canonicalJson(memberBasis));
  const members = [badMember], memberSetDigest = digest(canonicalJson({ schema: 'provider-external-material-members@1', items: members }));
  const snapshotBasis = { ...snapshot, members, memberSetDigest,
    manifestDigest: digest(canonicalJson({ schema: 'provider-external-material-manifest@1', structureKind: snapshot.structureKind, memberSetDigest })) };
  delete snapshotBasis.snapshotDigest;
  const badSnapshot = { ...snapshotBasis, snapshotDigest: digest(canonicalJson(snapshotBasis)) };
  request = requestFor(operation, 'moviepilot');
  f = fixture(operation, { request });
  await assert.rejects(() => f.adapter.execute({ ...request, input: { ...request.input,
    externalMaterialHandle: { ...request.input.externalMaterialHandle, outputSnapshot: badSnapshot } } }),
  (error) => error.code === 'P5_PROVIDER_OUTPUT_MEMBER');
  assert.equal(f.calls.length, 0);
});

test('job observation closed union rejects payload on pending and unknown terminal reason', async () => {
  const operation = operationCatalog.operations.find((item) => item.operationId === 'libra.external_material.acquire.observe@1');
  const request = requestFor(operation, 'moviepilot');
  for (const result of [
    { externalJobReceiptId: request.input.externalJobReceipt.receiptId, requestDigest: request.input.externalJobReceipt.requestDigest,
      providerObservationRevision: 1, state: 'pending', outputSnapshot: outputSnapshot(), snapshotDigest: digest('pending') },
    { externalJobReceiptId: request.input.externalJobReceipt.receiptId, requestDigest: request.input.externalJobReceipt.requestDigest,
      providerObservationRevision: 1, state: 'failed', reasonCode: 'unknown', snapshotDigest: digest('failed') }
  ]) {
    const f = fixture(operation, { request, transport: { execute: async () => ({ transportRequestId: 'transport-request-1', statusCode: 200,
      responseBytes: Buffer.byteLength(canonicalJson(result)), responseDigest: digest(canonicalJson(result)), result }) } });
    await assert.rejects(() => f.adapter.execute(request), (error) =>
      ['P5_PROVIDER_ACQUISITION_JOB_SNAPSHOT_SHAPE', 'P5_PROVIDER_ACQUISITION_JOB_REASON'].includes(error.code));
  }
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
