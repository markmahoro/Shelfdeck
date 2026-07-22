'use strict';

const catalog = require('../contracts/ports/p5-provider-operation-contracts.json');

const SHA256 = /^[0-9a-f]{64}$/;
const TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,255}$/;
const operations = new Map(catalog.operations.map((operation) => [operation.operationId, Object.freeze(operation)]));

class ProviderProtocolError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProviderProtocolError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) { throw new ProviderProtocolError(code, message, details); }
function exact(value, fields, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) fail(code, 'Provider value must match the exact contract.');
}
function token(value, field) {
  if (typeof value !== 'string' || !TOKEN.test(value)) fail('P5_PROVIDER_FIELD', 'Provider field is invalid.', { field });
  return value;
}
function positive(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) fail('P5_PROVIDER_INTEGER', 'Provider integer must be positive.', { field });
  return value;
}
function nonNegative(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) fail('P5_PROVIDER_INTEGER', 'Provider integer must be non-negative.', { field });
  return value;
}
function sha(value, field) {
  if (!SHA256.test(value || '')) fail('P5_PROVIDER_DIGEST', 'Provider digest is invalid.', { field });
  return value;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function canonicalJson(value) { return JSON.stringify(canonical(value)); }
function compareUtf8(left, right) { return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')); }
function requireSortedUnique(values, keyOf, code) {
  for (let index = 0; index < values.length; index += 1) {
    const key = keyOf(values[index]);
    if (index > 0 && compareUtf8(keyOf(values[index - 1]), key) >= 0) fail(code, 'Provider collection is not canonically sorted and unique.');
  }
}
function freezeClone(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeClone));
  if (value && typeof value === 'object') {
    if (Buffer.isBuffer(value)) fail('P5_PROVIDER_BINARY_RESULT_FORBIDDEN', 'Provider results must use typed Artifact handles, not inline bytes.');
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freezeClone(item)])));
  }
  return value;
}

function typedRef(value, field) {
  exact(value, ['objectType', 'objectId', 'revision', 'digest'], 'P5_PROVIDER_TYPED_REF_SHAPE');
  token(value.objectType, field + '.objectType');
  token(value.objectId, field + '.objectId');
  positive(value.revision, field + '.revision');
  if (!SHA256.test(value.digest || '')) fail('P5_PROVIDER_TYPED_REF_DIGEST', 'Provider typed reference digest is invalid.', { field });
  return Object.freeze({ ...value });
}

function validateResolvedIdentity(value, field) {
  exact(value, ['provider', 'namespace', 'providerKey', 'seasonNumber', 'identityAnchorDigest'], 'P5_PROVIDER_IDENTITY_SHAPE');
  const pairs = { tmdb_movie: 'tmdb', tmdb_series: 'tmdb', jav_code: 'jav', internal_identity: 'internal' };
  if (!Object.prototype.hasOwnProperty.call(pairs, value.namespace) || pairs[value.namespace] !== value.provider) fail('P5_PROVIDER_IDENTITY_KIND', 'Provider identity namespace is invalid.', { field });
  token(value.providerKey, field + '.providerKey');
  if (value.namespace === 'tmdb_series') positive(value.seasonNumber, field + '.seasonNumber');
  else if (value.seasonNumber !== null) fail('P5_PROVIDER_IDENTITY_SEASON', 'Provider identity season is invalid.', { field });
  sha(value.identityAnchorDigest, field + '.identityAnchorDigest');
}

function validateAcquisitionQuery(value, digest) {
  exact(value, ['schemaRef', 'schemaVersion', 'draftId', 'draftKind', 'basisDigest', 'draftDigest', 'producedAtMs',
    'libraRunId', 'runExecutionBasisDigest', 'resolvedIdentityDigest', 'productStructureDigest', 'structureKind',
    'contentProfile', 'providerIdentityAnchors', 'requestedEpisodeKeys', 'queryTerms', 'hardConstraints', 'queryDigest'], 'P5_PROVIDER_ACQUISITION_QUERY_SHAPE');
  if (value.schemaRef !== 'helix://contracts/types/AcquisitionQuery/v1' || value.schemaVersion !== 1 ||
      !['single', 'season'].includes(value.structureKind) || !['movie', 'series', 'jav', 'western_adult'].includes(value.contentProfile)) fail('P5_PROVIDER_ACQUISITION_QUERY_KIND', 'Acquisition Query type is invalid.');
  ['basisDigest', 'draftDigest', 'runExecutionBasisDigest', 'resolvedIdentityDigest', 'productStructureDigest', 'queryDigest'].forEach((field) => sha(value[field], field));
  nonNegative(value.producedAtMs, 'producedAtMs');
  [value.draftId, value.draftKind, value.libraRunId].forEach((item, index) => token(item, ['draftId', 'draftKind', 'libraRunId'][index]));
  if (!Array.isArray(value.providerIdentityAnchors) || value.providerIdentityAnchors.length < 1 || value.providerIdentityAnchors.length > 16) fail('P5_PROVIDER_ACQUISITION_QUERY_BOUND', 'Acquisition Query identity anchors are invalid.');
  value.providerIdentityAnchors.forEach((item, index) => validateResolvedIdentity(item, 'providerIdentityAnchors.' + index));
  requireSortedUnique(value.providerIdentityAnchors,
    (item) => [item.provider, item.namespace, item.providerKey, String(item.seasonNumber || 0).padStart(10, '0')].join('\u0000'),
    'P5_PROVIDER_ACQUISITION_QUERY_IDENTITY_ORDER');
  if (!Array.isArray(value.requestedEpisodeKeys) || value.requestedEpisodeKeys.length > 256) fail('P5_PROVIDER_ACQUISITION_QUERY_BOUND', 'Acquisition Query episode keys are invalid.');
  value.requestedEpisodeKeys.forEach((item, index) => token(item, 'requestedEpisodeKeys.' + index));
  requireSortedUnique(value.requestedEpisodeKeys, (item) => item, 'P5_PROVIDER_ACQUISITION_QUERY_EPISODE_ORDER');
  if (!Array.isArray(value.queryTerms) || value.queryTerms.length < 1 || value.queryTerms.length > 32) fail('P5_PROVIDER_ACQUISITION_QUERY_BOUND', 'Acquisition Query terms are invalid.');
  value.queryTerms.forEach((term, index) => {
    exact(term, ['ordinal', 'termKind', 'value', 'termDigest'], 'P5_PROVIDER_ACQUISITION_TERM_SHAPE');
    if (term.ordinal !== index || !['provider_key', 'title', 'season'].includes(term.termKind) || !String(term.value || '').trim()) fail('P5_PROVIDER_ACQUISITION_TERM', 'Acquisition Query term is invalid.');
    const expected = digest(canonicalJson({ schema: 'libra.external-acquisition-query-term@1', termKind: term.termKind, value: term.value }));
    if (term.termDigest !== expected) fail('P5_PROVIDER_ACQUISITION_TERM_DIGEST', 'Acquisition Query term digest is invalid.');
  });
  exact(value.hardConstraints, ['requiredStructureKind', 'requiredEpisodeKeys'], 'P5_PROVIDER_ACQUISITION_CONSTRAINT_SHAPE');
  if (value.hardConstraints.requiredStructureKind !== value.structureKind || !Array.isArray(value.hardConstraints.requiredEpisodeKeys) ||
      canonicalJson(value.hardConstraints.requiredEpisodeKeys) !== canonicalJson(value.requestedEpisodeKeys)) fail('P5_PROVIDER_ACQUISITION_CONSTRAINT', 'Acquisition Query constraints are invalid.');
  const expectedQueryDigest = digest(canonicalJson({ schema: 'libra.external-acquisition-query@1', libraRunId: value.libraRunId,
    runExecutionBasisDigest: value.runExecutionBasisDigest, resolvedIdentityDigest: value.resolvedIdentityDigest,
    productStructureDigest: value.productStructureDigest, structureKind: value.structureKind, contentProfile: value.contentProfile,
    providerIdentityAnchors: value.providerIdentityAnchors, requestedEpisodeKeys: value.requestedEpisodeKeys,
    queryTerms: value.queryTerms, hardConstraints: value.hardConstraints }));
  const { draftDigest, ...draftBasis } = value;
  if (value.queryDigest !== expectedQueryDigest || draftDigest !== digest(canonicalJson(draftBasis))) fail('P5_PROVIDER_ACQUISITION_QUERY_DIGEST', 'Acquisition Query or Draft digest is invalid.');
  return freezeClone(value);
}

function validateCandidate(value, integrationId, configRevision, digest) {
  exact(value, ['candidateId', 'integrationId', 'configRevision', 'providerCandidateRef', 'providerRank', 'identityAnchors',
    'structureKind', 'episodeKeys', 'availability', 'candidateDigest'], 'P5_PROVIDER_CANDIDATE_SHAPE');
  if (value.integrationId !== integrationId || value.configRevision !== configRevision || !['single', 'season'].includes(value.structureKind) || !['available', 'unavailable'].includes(value.availability)) fail('P5_PROVIDER_CANDIDATE_FENCE', 'Provider candidate fence is invalid.');
  exact(value.providerCandidateRef, ['objectType', 'objectId', 'revision', 'digest'], 'P5_PROVIDER_CANDIDATE_REF_SHAPE');
  if (value.providerCandidateRef.objectType !== 'acquisition_candidate') fail('P5_PROVIDER_CANDIDATE_REF', 'Provider candidate reference is invalid.');
  token(value.providerCandidateRef.objectId, 'providerCandidateRef.objectId'); positive(value.providerCandidateRef.revision, 'providerCandidateRef.revision'); sha(value.providerCandidateRef.digest, 'providerCandidateRef.digest');
  if (!Number.isSafeInteger(value.providerRank) || value.providerRank < 0 || value.providerRank > 99) fail('P5_PROVIDER_CANDIDATE_RANK', 'Provider candidate rank is invalid.');
  if (!Array.isArray(value.identityAnchors) || value.identityAnchors.length > 16 || !Array.isArray(value.episodeKeys) || value.episodeKeys.length > 256) fail('P5_PROVIDER_CANDIDATE_BOUND', 'Provider candidate collection is invalid.');
  value.identityAnchors.forEach((item, index) => validateResolvedIdentity(item, 'identityAnchors.' + index));
  value.episodeKeys.forEach((item, index) => token(item, 'episodeKeys.' + index));
  requireSortedUnique(value.identityAnchors,
    (item) => [item.provider, item.namespace, item.providerKey, String(item.seasonNumber || 0).padStart(10, '0')].join('\u0000'),
    'P5_PROVIDER_CANDIDATE_IDENTITY_ORDER');
  requireSortedUnique(value.episodeKeys, (item) => item, 'P5_PROVIDER_CANDIDATE_EPISODE_ORDER');
  const expectedId = digest(canonicalJson({ schema: 'provider-acquisition-candidate-id@1', integrationId, configRevision, providerCandidateRef: value.providerCandidateRef }));
  const { candidateDigest, ...candidateBasis } = value;
  if (value.candidateId !== expectedId || candidateDigest !== digest(canonicalJson(candidateBasis))) fail('P5_PROVIDER_CANDIDATE_DIGEST', 'Provider candidate identity or digest is invalid.');
}

function validateSelectedCandidate(value, digest) {
  exact(value, ['schemaRef', 'schemaVersion', 'draftId', 'draftKind', 'basisDigest', 'draftDigest', 'producedAtMs',
    'queryDigest', 'candidateSetDigest', 'selectionCriteriaDigest', 'result', 'selectedCandidate', 'selectedCandidateId',
    'selectionReasonCode'], 'P5_PROVIDER_SELECTED_CANDIDATE_SHAPE');
  if (value.schemaRef !== 'helix://contracts/types/SelectedCandidate/v1' || value.schemaVersion !== 1 || value.result !== 'selected' || value.selectionReasonCode !== 'selected_by_provider_rank') fail('P5_PROVIDER_SELECTED_CANDIDATE_REQUIRED', 'Acquire Request requires the selected candidate variant.');
  validateCandidate(value.selectedCandidate, value.selectedCandidate.integrationId, value.selectedCandidate.configRevision, digest);
  const expectedBasisDigest = digest(canonicalJson({ schema: 'libra.external-candidate-selection-basis@1', queryDigest: value.queryDigest,
    candidateSetDigest: value.candidateSetDigest, selectionCriteriaDigest: value.selectionCriteriaDigest }));
  const expectedDraftId = digest(canonicalJson({ schema: 'libra.external-selected-candidate-id@1', queryDigest: value.queryDigest,
    candidateSetDigest: value.candidateSetDigest, selectionCriteriaDigest: value.selectionCriteriaDigest }));
  const { draftDigest, ...draftBasis } = value;
  if (value.selectedCandidateId !== value.selectedCandidate.candidateId || value.selectedCandidate.availability !== 'available' ||
      value.basisDigest !== expectedBasisDigest || value.draftId !== expectedDraftId || draftDigest !== digest(canonicalJson(draftBasis))) fail('P5_PROVIDER_SELECTED_CANDIDATE_ID', 'Selected candidate identity or Draft digest is invalid.');
  ['basisDigest', 'draftDigest', 'queryDigest', 'candidateSetDigest', 'selectionCriteriaDigest'].forEach((field) => sha(value[field], field));
  return freezeClone(value);
}

function validateJobReceiptInput(value) {
  exact(value, ['schemaRef', 'schemaVersion', 'receiptId', 'integrationId', 'externalJobId', 'operationKind',
    'idempotencyKey', 'requestDigest', 'configRevision', 'createdAtMs'], 'P5_PROVIDER_JOB_SHAPE');
  if (value.schemaRef !== 'helix://contracts/types/ExternalJobReceipt/v1' || value.schemaVersion !== 1) fail('P5_PROVIDER_JOB_SHAPE', 'External Job Receipt is invalid.');
  [value.receiptId, value.integrationId, value.externalJobId, value.operationKind, value.idempotencyKey].forEach((item) => token(item, 'externalJobReceipt'));
  sha(value.requestDigest, 'externalJobReceipt.requestDigest'); positive(value.configRevision, 'externalJobReceipt.configRevision'); nonNegative(value.createdAtMs, 'externalJobReceipt.createdAtMs');
  return freezeClone(value);
}

function validateExternalMaterialHandleInput(value, digest) {
  exact(value, ['schemaRef', 'schemaVersion', 'handleId', 'integrationId', 'configRevision', 'externalObjectRef', 'endpointId',
    'location', 'structureKind', 'outputSnapshot', 'manifestDigest', 'observationRevision', 'accessFenceDigest'], 'P5_PROVIDER_EXTERNAL_HANDLE_SHAPE');
  if (value.schemaRef !== 'helix://contracts/types/ExternalMaterialHandle/v1' || value.schemaVersion !== 1) fail('P5_PROVIDER_EXTERNAL_HANDLE_KIND', 'External Material Handle is invalid.');
  [value.handleId, value.integrationId, value.externalObjectRef, value.endpointId].forEach((item) => token(item, 'externalMaterialHandle'));
  positive(value.configRevision, 'configRevision'); positive(value.observationRevision, 'observationRevision'); sha(value.manifestDigest, 'manifestDigest'); sha(value.accessFenceDigest, 'accessFenceDigest');
  validateOutputSnapshot(value.outputSnapshot, value.integrationId, value.configRevision, digest);
  if (value.externalObjectRef !== value.outputSnapshot.externalObjectRef || value.endpointId !== value.outputSnapshot.endpointId ||
      value.location !== value.outputSnapshot.location || value.structureKind !== value.outputSnapshot.structureKind ||
      value.manifestDigest !== value.outputSnapshot.manifestDigest) fail('P5_PROVIDER_EXTERNAL_HANDLE_CONTINUITY', 'External Material Handle does not conserve its output snapshot.');
  const expectedHandleId = digest(canonicalJson({ schema: 'libra.external-material-handle-id@1', integrationId: value.integrationId,
    configRevision: value.configRevision, externalObjectRef: value.externalObjectRef, observationRevision: value.observationRevision,
    manifestDigest: value.manifestDigest }));
  const expectedFence = digest(canonicalJson({ schema: 'libra.external-material-access-fence@1', handleId: value.handleId,
    endpointId: value.endpointId, location: value.location, outputSnapshotDigest: value.outputSnapshot.snapshotDigest }));
  if (value.handleId !== expectedHandleId || value.accessFenceDigest !== expectedFence) fail('P5_PROVIDER_EXTERNAL_HANDLE_FENCE', 'External Material Handle identity or access fence is invalid.');
  return freezeClone(value);
}

function validateInput(kind, input, digest) {
  if (kind === 'empty') { exact(input, [], 'P5_PROVIDER_INPUT_SHAPE'); return Object.freeze({}); }
  if (kind === 'perception-source') {
    exact(input, ['sourceRef', 'cursor', 'limit'], 'P5_PROVIDER_INPUT_SHAPE');
    if (input.cursor !== null) token(input.cursor, 'cursor');
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) fail('P5_PROVIDER_LIMIT', 'Provider page limit is invalid.');
    return Object.freeze({ sourceRef: typedRef(input.sourceRef, 'sourceRef'), cursor: input.cursor, limit: input.limit });
  }
  if (kind === 'person-hint') {
    exact(input, ['personHintRef', 'limit'], 'P5_PROVIDER_INPUT_SHAPE');
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 50) fail('P5_PROVIDER_LIMIT', 'Provider person limit is invalid.');
    return Object.freeze({ personHintRef: typedRef(input.personHintRef, 'personHintRef'), limit: input.limit });
  }
  if (kind === 'product-identity') {
    exact(input, ['productIdentityRef', 'locale'], 'P5_PROVIDER_INPUT_SHAPE');
    return Object.freeze({ productIdentityRef: typedRef(input.productIdentityRef, 'productIdentityRef'), locale: token(input.locale, 'locale') });
  }
  if (kind === 'acquisition-query-snapshot') {
    exact(input, ['acquisitionQuery', 'limit'], 'P5_PROVIDER_INPUT_SHAPE');
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) fail('P5_PROVIDER_LIMIT', 'Provider search limit is invalid.');
    return Object.freeze({ acquisitionQuery: validateAcquisitionQuery(input.acquisitionQuery, digest), limit: input.limit });
  }
  if (kind === 'artifact-target') {
    exact(input, ['sourceRef', 'workspaceTargetRef'], 'P5_PROVIDER_INPUT_SHAPE');
    return Object.freeze({ sourceRef: typedRef(input.sourceRef, 'sourceRef'), workspaceTargetRef: typedRef(input.workspaceTargetRef, 'workspaceTargetRef') });
  }
  if (kind === 'acquisition-request-snapshot') {
    exact(input, ['acquisitionQuery', 'selectedCandidate'], 'P5_PROVIDER_INPUT_SHAPE');
    const acquisitionQuery = validateAcquisitionQuery(input.acquisitionQuery, digest);
    const selectedCandidate = validateSelectedCandidate(input.selectedCandidate, digest);
    if (selectedCandidate.queryDigest !== acquisitionQuery.queryDigest) fail('P5_PROVIDER_ACQUISITION_REQUEST_CONTINUITY', 'Acquire Request Query continuity is invalid.');
    return Object.freeze({ acquisitionQuery, selectedCandidate });
  }
  if (kind === 'acquisition-job-observation') {
    exact(input, ['externalJobReceipt', 'phase'], 'P5_PROVIDER_INPUT_SHAPE');
    if (!['download', 'transfer'].includes(input.phase)) fail('P5_PROVIDER_ACQUISITION_PHASE', 'Acquisition observation phase is invalid.');
    return Object.freeze({ externalJobReceipt: validateJobReceiptInput(input.externalJobReceipt), phase: input.phase });
  }
  if (kind === 'external-material-observation') {
    exact(input, ['externalMaterialHandle', 'quietWindowMs'], 'P5_PROVIDER_INPUT_SHAPE');
    if (!Number.isSafeInteger(input.quietWindowMs) || input.quietWindowMs < 1 || input.quietWindowMs > 86400000) fail('P5_PROVIDER_QUIET_WINDOW', 'External material quiet window is invalid.');
    return Object.freeze({ externalMaterialHandle: validateExternalMaterialHandleInput(input.externalMaterialHandle, digest), quietWindowMs: input.quietWindowMs });
  }
  fail('P5_PROVIDER_INPUT_KIND', 'Provider input kind is unsupported.');
}

function validateHandle(handle, operation, now) {
  exact(handle, ['schemaRef', 'schemaVersion', 'handleId', 'integrationId', 'integrationType', 'configRevision',
    'secretRef', 'allowedOperation', 'expiresAtMs', 'fenceDigest'], 'P5_PROVIDER_HANDLE_SHAPE');
  if (handle.schemaRef !== 'helix://contracts/types/IntegrationHandle/v1' || handle.schemaVersion !== 1 ||
      !Object.prototype.hasOwnProperty.call(operation.atoms, handle.integrationType) || handle.allowedOperation !== operation.operationId ||
      !Number.isSafeInteger(handle.expiresAtMs) || handle.expiresAtMs < now || !SHA256.test(handle.fenceDigest || '')) {
    fail('P5_PROVIDER_HANDLE_DENIED', 'Integration Handle is stale or does not authorize this provider operation.');
  }
  token(handle.handleId, 'handleId'); token(handle.integrationId, 'integrationId'); token(handle.secretRef, 'secretRef');
  positive(handle.configRevision, 'configRevision');
}

function validateLease(lease, handle, operation, now) {
  exact(lease, ['schemaRef', 'schemaVersion', 'handleId', 'secretRef', 'ownerScopeType', 'ownerScopeId', 'secretKind',
    'purpose', 'revision', 'issuedAtMs', 'expiresAtMs', 'fenceDigest'], 'P5_PROVIDER_LEASE_SHAPE');
  if (lease.schemaRef !== 'helix://contracts/ports/platform.secret-lease.resolve/v1/output' || lease.schemaVersion !== 1 ||
      lease.secretRef !== handle.secretRef || lease.ownerScopeType !== 'integration' || lease.ownerScopeId !== handle.integrationId ||
      lease.purpose !== operation.operationId || !Number.isSafeInteger(lease.issuedAtMs) || lease.issuedAtMs < 0 ||
      !Number.isSafeInteger(lease.expiresAtMs) || lease.expiresAtMs < now || lease.expiresAtMs <= lease.issuedAtMs ||
      !SHA256.test(lease.fenceDigest || '')) {
    fail('P5_PROVIDER_LEASE_DENIED', 'Secret lease does not match the exact provider operation.');
  }
  token(lease.handleId, 'lease.handleId'); token(lease.secretRef, 'lease.secretRef'); token(lease.secretKind, 'lease.secretKind');
  positive(lease.revision, 'lease.revision');
}

function validateArtifact(value) {
  exact(value, ['schemaRef', 'schemaVersion', 'artifactHandleId', 'artifactKind', 'ownerDomain', 'ownerScope', 'storageRef',
    'digestAlgorithm', 'digestHex', 'sizeBytes', 'mediaType', 'provenanceRef', 'referenceRevision'], 'P5_PROVIDER_ARTIFACT_SHAPE');
  if (value.schemaRef !== 'helix://contracts/types/ArtifactHandle/v1' || value.schemaVersion !== 1 ||
      value.digestAlgorithm !== 'sha256' || !SHA256.test(value.digestHex || '') || !Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 0) {
    fail('P5_PROVIDER_ARTIFACT_INVALID', 'Provider Artifact Handle is invalid.');
  }
  return value;
}

function validateJob(value, request) {
  exact(value, ['schemaRef', 'schemaVersion', 'receiptId', 'integrationId', 'externalJobId', 'operationKind',
    'idempotencyKey', 'requestDigest', 'configRevision', 'createdAtMs'], 'P5_PROVIDER_JOB_SHAPE');
  if (value.schemaRef !== 'helix://contracts/types/ExternalJobReceipt/v1' || value.schemaVersion !== 1 ||
      value.integrationId !== request.integrationHandle.integrationId || value.operationKind !== request.operationId ||
      value.idempotencyKey !== request.idempotencyKey || value.requestDigest !== request.requestDigest ||
      value.configRevision !== request.integrationHandle.configRevision) fail('P5_PROVIDER_JOB_MISMATCH', 'External Job Receipt does not match the request fence.');
  token(value.receiptId, 'receiptId'); token(value.externalJobId, 'externalJobId');
  positive(value.configRevision, 'configRevision'); nonNegative(value.createdAtMs, 'createdAtMs'); sha(value.requestDigest, 'requestDigest');
  return value;
}

function validateOutputSnapshot(value, integrationId, configRevision, digest) {
  const fields = ['integrationId', 'configRevision', 'externalObjectRef', 'endpointId', 'location', 'structureKind', 'members',
    'identityAnchors', 'observedAtMs', 'newestMutationAtMs', 'memberSetDigest', 'manifestDigest', 'snapshotDigest'];
  if (Object.prototype.hasOwnProperty.call(value || {}, 'observedTitle')) fields.push('observedTitle');
  if (Object.prototype.hasOwnProperty.call(value || {}, 'releaseYear')) fields.push('releaseYear');
  exact(value, fields, 'P5_PROVIDER_OUTPUT_SNAPSHOT_SHAPE');
  if (value.integrationId !== integrationId || value.configRevision !== configRevision || !['single', 'season'].includes(value.structureKind)) fail('P5_PROVIDER_OUTPUT_SNAPSHOT_FENCE', 'External output snapshot fence is invalid.');
  [value.externalObjectRef, value.endpointId].forEach((item) => token(item, 'outputSnapshot'));
  if (typeof value.location !== 'string' || !value.location) fail('P5_PROVIDER_OUTPUT_LOCATION', 'External output location is invalid.');
  if (!Array.isArray(value.members) || value.members.length < 1 || value.members.length > 256) fail('P5_PROVIDER_OUTPUT_MEMBERS', 'External output members are invalid.');
  const memberIds = new Set(), memberPaths = new Set();
  value.members.forEach((member, index) => {
    exact(member, ['ordinal', 'externalMemberId', 'relativePath', 'sizeBytes', 'checksumAlgorithm', 'checksumHex', 'episodeClaims', 'memberDigest'], 'P5_PROVIDER_OUTPUT_MEMBER_SHAPE');
    const pathParts = typeof member.relativePath === 'string' ? member.relativePath.split('/') : [];
    if (member.ordinal !== index || member.checksumAlgorithm !== 'sha256' || !member.relativePath || member.relativePath.includes('\\') ||
        member.relativePath.startsWith('/') || /^[A-Za-z]:/.test(member.relativePath) || pathParts.some((part) => !part || part === '.' || part === '..') ||
        memberIds.has(member.externalMemberId) || memberPaths.has(member.relativePath)) fail('P5_PROVIDER_OUTPUT_MEMBER', 'External output member is invalid or escapes Endpoint containment.');
    token(member.externalMemberId, 'externalMemberId'); nonNegative(member.sizeBytes, 'sizeBytes'); sha(member.checksumHex, 'checksumHex');
    memberIds.add(member.externalMemberId); memberPaths.add(member.relativePath);
    if (!Array.isArray(member.episodeClaims) || member.episodeClaims.length > 32) fail('P5_PROVIDER_OUTPUT_EPISODES', 'External output episode claims are invalid.');
    const seen = new Set();
    member.episodeClaims.forEach((claim) => {
      exact(claim, ['episodeKey', 'claimDigest'], 'P5_PROVIDER_OUTPUT_EPISODE_SHAPE'); token(claim.episodeKey, 'episodeKey');
      const expected = digest(canonicalJson({ schema: 'provider-external-member-episode-claim@1', episodeKey: claim.episodeKey }));
      if (claim.claimDigest !== expected || seen.has(claim.episodeKey)) fail('P5_PROVIDER_OUTPUT_EPISODE_DIGEST', 'External output episode claim is invalid.');
      seen.add(claim.episodeKey);
    });
    requireSortedUnique(member.episodeClaims, (claim) => claim.episodeKey, 'P5_PROVIDER_OUTPUT_EPISODE_ORDER');
    const { memberDigest, ...memberBasis } = member;
    if (memberDigest !== digest(canonicalJson(memberBasis))) fail('P5_PROVIDER_OUTPUT_MEMBER_DIGEST', 'External output member digest is invalid.');
  });
  if (!Array.isArray(value.identityAnchors) || value.identityAnchors.length > 16) fail('P5_PROVIDER_OUTPUT_IDENTITIES', 'External output identities are invalid.');
  value.identityAnchors.forEach((item, index) => validateResolvedIdentity(item, 'identityAnchors.' + index));
  requireSortedUnique(value.identityAnchors,
    (item) => [item.provider, item.namespace, item.providerKey, String(item.seasonNumber || 0).padStart(10, '0')].join('\u0000'),
    'P5_PROVIDER_OUTPUT_IDENTITY_ORDER');
  if (Object.prototype.hasOwnProperty.call(value, 'observedTitle') && (typeof value.observedTitle !== 'string' || !value.observedTitle.trim())) fail('P5_PROVIDER_OUTPUT_TITLE', 'External output title is invalid.');
  if (Object.prototype.hasOwnProperty.call(value, 'releaseYear')) positive(value.releaseYear, 'releaseYear');
  nonNegative(value.observedAtMs, 'observedAtMs'); nonNegative(value.newestMutationAtMs, 'newestMutationAtMs');
  const memberSetDigest = digest(canonicalJson({ schema: 'provider-external-material-members@1', items: value.members }));
  const manifestDigest = digest(canonicalJson({ schema: 'provider-external-material-manifest@1', structureKind: value.structureKind, memberSetDigest }));
  const { snapshotDigest, ...snapshotBasis } = value;
  if (value.memberSetDigest !== memberSetDigest || value.manifestDigest !== manifestDigest || snapshotDigest !== digest(canonicalJson(snapshotBasis))) fail('P5_PROVIDER_OUTPUT_DIGEST', 'External output snapshot digest is invalid.');
  return value;
}

function validateAcquisitionCandidates(value, request, digest) {
  exact(value, ['queryDigest', 'candidates', 'candidateSetDigest'], 'P5_PROVIDER_ACQUISITION_CANDIDATES_SHAPE');
  if (value.queryDigest !== request.input.acquisitionQuery.queryDigest || !Array.isArray(value.candidates) || value.candidates.length > 100) fail('P5_PROVIDER_ACQUISITION_CANDIDATES_FENCE', 'Acquisition candidate list is invalid.');
  const ids = new Set();
  value.candidates.forEach((candidate, index) => {
    validateCandidate(candidate, request.integrationHandle.integrationId, request.integrationHandle.configRevision, digest);
    if (candidate.providerRank !== index || ids.has(candidate.candidateId)) fail('P5_PROVIDER_ACQUISITION_CANDIDATES_ORDER', 'Acquisition candidates are not the canonical set.');
    ids.add(candidate.candidateId);
  });
  const expected = digest(canonicalJson({ schema: 'libra.external-acquisition-candidate-set@1', queryDigest: value.queryDigest,
    integrationId: request.integrationHandle.integrationId, configRevision: request.integrationHandle.configRevision, items: value.candidates }));
  if (value.candidateSetDigest !== expected) fail('P5_PROVIDER_ACQUISITION_CANDIDATES_DIGEST', 'Acquisition candidate set digest is invalid.');
}

function validateAcquisitionJobSnapshot(value, request, digest) {
  const common = ['externalJobReceiptId', 'requestDigest', 'providerObservationRevision', 'state', 'snapshotDigest'];
  if (value && value.state === 'ready') common.push('outputSnapshot');
  else if (value && value.state === 'failed') common.push('reasonCode');
  exact(value, common, 'P5_PROVIDER_ACQUISITION_JOB_SNAPSHOT_SHAPE');
  const receipt = request.input.externalJobReceipt;
  if (value.externalJobReceiptId !== receipt.receiptId || value.requestDigest !== receipt.requestDigest || !['pending', 'ready', 'failed'].includes(value.state)) fail('P5_PROVIDER_ACQUISITION_JOB_FENCE', 'Acquisition job snapshot fence is invalid.');
  positive(value.providerObservationRevision, 'providerObservationRevision');
  if (value.state === 'ready') validateOutputSnapshot(value.outputSnapshot, receipt.integrationId, receipt.configRevision, digest);
  if (value.state === 'failed' && !['job_not_found', 'job_failed', 'job_cancelled', 'provider_observation_invalid'].includes(value.reasonCode)) fail('P5_PROVIDER_ACQUISITION_JOB_REASON', 'Acquisition job failure reason is invalid.');
  const { snapshotDigest, ...basis } = value;
  if (snapshotDigest !== digest(canonicalJson(basis))) fail('P5_PROVIDER_ACQUISITION_JOB_DIGEST', 'Acquisition job snapshot digest is invalid.');
}

function validateExternalMaterialSnapshot(value, request, digest) {
  exact(value, ['sourceExternalMaterialHandleId', 'providerObservationRevision', 'outputSnapshot', 'snapshotDigest'], 'P5_PROVIDER_EXTERNAL_MATERIAL_SNAPSHOT_SHAPE');
  const handle = request.input.externalMaterialHandle;
  if (value.sourceExternalMaterialHandleId !== handle.handleId) fail('P5_PROVIDER_EXTERNAL_MATERIAL_FENCE', 'External material snapshot Handle is invalid.');
  positive(value.providerObservationRevision, 'providerObservationRevision');
  validateOutputSnapshot(value.outputSnapshot, handle.integrationId, handle.configRevision, digest);
  if (value.outputSnapshot.externalObjectRef !== handle.externalObjectRef || value.outputSnapshot.endpointId !== handle.endpointId || value.outputSnapshot.location !== handle.location) fail('P5_PROVIDER_EXTERNAL_MATERIAL_CONTINUITY', 'External material snapshot containment is invalid.');
  const { snapshotDigest, ...basis } = value;
  if (snapshotDigest !== digest(canonicalJson(basis))) fail('P5_PROVIDER_EXTERNAL_MATERIAL_DIGEST', 'External material snapshot digest is invalid.');
}

function validateResult(kind, value, request, digest) {
  if (kind === 'availability') {
    exact(value, ['availabilityEvidenceRef'], 'P5_PROVIDER_RESULT_SHAPE');
    typedRef(value.availabilityEvidenceRef, 'availabilityEvidenceRef');
  } else if (kind === 'reference') {
    exact(value, ['resultRef'], 'P5_PROVIDER_RESULT_SHAPE'); typedRef(value.resultRef, 'resultRef');
  } else if (kind === 'reference-list') {
    exact(value, ['resultRefs', 'nextCursor'], 'P5_PROVIDER_RESULT_SHAPE');
    if (!Array.isArray(value.resultRefs) || value.resultRefs.length > 100) fail('P5_PROVIDER_RESULT_BOUND', 'Provider result reference list is invalid.');
    value.resultRefs.forEach((item, index) => typedRef(item, 'resultRefs.' + index));
    if (value.nextCursor !== null) token(value.nextCursor, 'nextCursor');
  } else if (kind === 'artifact') {
    exact(value, ['artifactHandle'], 'P5_PROVIDER_RESULT_SHAPE'); validateArtifact(value.artifactHandle);
  } else if (kind === 'job') {
    exact(value, ['externalJobReceipt'], 'P5_PROVIDER_RESULT_SHAPE'); validateJob(value.externalJobReceipt, request);
  } else if (kind === 'acquisition-candidate-list') {
    validateAcquisitionCandidates(value, request, digest);
  } else if (kind === 'acquisition-job-snapshot') {
    validateAcquisitionJobSnapshot(value, request, digest);
  } else if (kind === 'external-material-snapshot') {
    validateExternalMaterialSnapshot(value, request, digest);
  } else fail('P5_PROVIDER_RESULT_KIND', 'Provider result kind is unsupported.');
  return freezeClone(value);
}

function validateOperationContinuity(operation, input, integrationHandle) {
  if (operation.inputKind === 'acquisition-request-snapshot') {
    if (input.selectedCandidate.selectedCandidate.integrationId !== integrationHandle.integrationId ||
        input.selectedCandidate.selectedCandidate.configRevision !== integrationHandle.configRevision) {
      fail('P5_PROVIDER_ACQUISITION_REQUEST_FENCE', 'Selected candidate does not match the Integration Handle fence.');
    }
  } else if (operation.inputKind === 'acquisition-job-observation') {
    const receipt = input.externalJobReceipt;
    if (receipt.integrationId !== integrationHandle.integrationId || receipt.configRevision !== integrationHandle.configRevision ||
        receipt.operationKind !== 'libra.external_material.acquire.request@1') {
      fail('P5_PROVIDER_ACQUISITION_JOB_INPUT_FENCE', 'External Job Receipt does not match the observation Integration Handle.');
    }
  } else if (operation.inputKind === 'external-material-observation') {
    const handle = input.externalMaterialHandle;
    if (handle.integrationId !== integrationHandle.integrationId || handle.configRevision !== integrationHandle.configRevision) {
      fail('P5_PROVIDER_EXTERNAL_MATERIAL_INPUT_FENCE', 'External Material Handle does not match the observation Integration Handle.');
    }
  }
}

function createAdapter(effectClass, options) {
  if (!options || !options.transport || typeof options.transport.execute !== 'function' ||
      !options.secretLeaseBroker || typeof options.secretLeaseBroker.consumeAsync !== 'function' ||
      !options.timeoutController || typeof options.timeoutController.run !== 'function' ||
      typeof options.now !== 'function' || typeof options.digest !== 'function') {
    fail('P5_PROVIDER_DEPENDENCIES', 'Provider transport, async Secret Lease broker, timeout controller, and clock are required.');
  }
  return Object.freeze({
    async execute(request) {
      exact(request, ['integrationHandle', 'secretLeaseHandle', 'operationId', 'idempotencyKey', 'requestDigest', 'timeoutMs', 'input'],
        'P5_PROVIDER_REQUEST_SHAPE');
      const operation = operations.get(request.operationId);
      if (!operation || operation.effectClass !== effectClass) fail('P5_PROVIDER_OPERATION_DENIED', 'Provider operation is unknown or uses the wrong Effect Class port.');
      const now = options.now();
      if (!Number.isSafeInteger(now) || now < 0) fail('P5_PROVIDER_TIME', 'Provider clock is invalid.');
      validateHandle(request.integrationHandle, operation, now);
      validateLease(request.secretLeaseHandle, request.integrationHandle, operation, now);
      token(request.idempotencyKey, 'idempotencyKey');
      if (!SHA256.test(request.requestDigest || '') || !Number.isSafeInteger(request.timeoutMs) ||
          request.timeoutMs < 1 || request.timeoutMs > operation.maxTimeoutMs) fail('P5_PROVIDER_REQUEST_FENCE', 'Provider request digest or timeout is invalid.');
      const input = validateInput(operation.inputKind, request.input, options.digest);
      validateOperationContinuity(operation, input, request.integrationHandle);
      const digestBasis = Object.freeze({
        integrationId: request.integrationHandle.integrationId, integrationType: request.integrationHandle.integrationType,
        configRevision: request.integrationHandle.configRevision, operationId: request.operationId,
        idempotencyKey: request.idempotencyKey, input
      });
      if (options.digest(canonicalJson(digestBasis)) !== request.requestDigest) fail('P5_PROVIDER_REQUEST_DIGEST_MISMATCH', 'Provider request digest does not match the exact normalized request.');
      if (Buffer.byteLength(canonicalJson(input), 'utf8') > operation.maxInputBytes) fail('P5_PROVIDER_INPUT_BOUND', 'Provider input exceeds the operation bound.');
      let response;
      try {
        response = await options.secretLeaseBroker.consumeAsync(request.secretLeaseHandle, (secretBytes) =>
          options.timeoutController.run(options.transport.execute(Object.freeze({
            protocolVersion: 1, providerType: request.integrationHandle.integrationType,
            protocolAtomId: operation.atoms[request.integrationHandle.integrationType],
            integrationId: request.integrationHandle.integrationId, configRevision: request.integrationHandle.configRevision,
            operationId: request.operationId, effectClass, idempotencyKey: request.idempotencyKey,
            requestDigest: request.requestDigest, timeoutMs: request.timeoutMs, input, secretBytes
          })), request.timeoutMs));
      } catch (error) {
        if (error instanceof ProviderProtocolError) throw error;
        fail('P5_PROVIDER_TRANSPORT_FAILED', 'External Provider invocation failed.');
      }
      exact(response, ['transportRequestId', 'statusCode', 'responseBytes', 'responseDigest', 'result'], 'P5_PROVIDER_RESPONSE_SHAPE');
      token(response.transportRequestId, 'transportRequestId');
      const result = validateResult(operation.resultKind, response.result, Object.freeze({ ...request, input }), options.digest);
      const resultJson = canonicalJson(result);
      const actualResponseBytes = Buffer.byteLength(resultJson, 'utf8');
      if (!Number.isSafeInteger(response.statusCode) || response.statusCode < 200 || response.statusCode > 299 ||
          response.responseBytes !== actualResponseBytes || actualResponseBytes > operation.maxResponseBytes ||
          response.responseDigest !== options.digest(resultJson)) fail('P5_PROVIDER_RESPONSE_INVALID', 'Provider response status, size, or digest is invalid.');
      return Object.freeze({
        schemaRef: 'helix://contracts/ports/integration.external-provider-' +
          (effectClass === 'pure_observation' ? 'observation' : effectClass === 'workspace_write' ? 'artifact' : 'request') + '.execute/v1/output',
        schemaVersion: 1, operationId: operation.operationId, effectClass, integrationId: request.integrationHandle.integrationId,
        configRevision: request.integrationHandle.configRevision, idempotencyKey: request.idempotencyKey,
        requestDigest: request.requestDigest, transportRequestId: response.transportRequestId,
        responseDigest: response.responseDigest, responseBytes: response.responseBytes, result
      });
    }
  });
}

function createProviderObservationAdapter(options) { return createAdapter('pure_observation', options); }
function createProviderArtifactAdapter(options) { return createAdapter('workspace_write', options); }
function createProviderRequestAdapter(options) { return createAdapter('external_request', options); }

module.exports = Object.freeze({
  ProviderProtocolError, canonicalJson, createProviderArtifactAdapter,
  createProviderObservationAdapter, createProviderRequestAdapter
});
