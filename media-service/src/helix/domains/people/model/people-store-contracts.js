'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');

const DIGEST = /^[a-f0-9]{64}$/;
const PERSON_STATES = new Set(['active', 'merged']);
const CANDIDATE_STATES = new Set(['open', 'accepted', 'dismissed', 'superseded']);
const REFERENCE_STATES = new Set(['active', 'released']);
const PEOPLE_CANDIDATE_DRAFT_SCHEMA = 'helix://contracts/types/PeopleCandidateDraft/v1';

class PeopleStoreContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PeopleStoreContractError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) { throw new PeopleStoreContractError(code, message, details); }
function exact(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('P6_PEOPLE_VALUE_REQUIRED', 'A typed People value is required.');
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  const unknown = keys.filter((key) => !allowed.has(key));
  const missing = required.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (unknown.length || missing.length) fail('P6_PEOPLE_VALUE_SHAPE', 'People value does not match its closed contract.', { unknown, missing });
}
function text(value, field, maxLength = 4096) {
  if (typeof value !== 'string' || value.length < 1 || value.length > maxLength) {
    fail('P6_PEOPLE_TEXT_INVALID', 'People text is empty or exceeds its contract.', { field, maxLength });
  }
  return value;
}
function digest(value, field) {
  if (typeof value !== 'string' || !DIGEST.test(value)) fail('P6_PEOPLE_DIGEST_INVALID', 'People digest must be lowercase SHA-256.', { field });
  return value;
}
function revision(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) fail('P6_PEOPLE_REVISION_INVALID', 'People revision must be a positive safe integer.', { field });
  return value;
}
function time(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) fail('P6_PEOPLE_TIME_INVALID', 'People time must be a non-negative UTC epoch millisecond.', { field });
  return value;
}
function nullableRevision(value, field) { return value === null ? null : revision(value, field); }
function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (value && typeof value === 'object') return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freeze(item)])));
  return value;
}
function unique(items, key, code) {
  if (new Set(items.map(key)).size !== items.length) fail(code, 'People value contains duplicate identities.');
}
function boundedArray(value, field, maxItems = 256) {
  if (!Array.isArray(value) || value.length > maxItems) fail('P6_PEOPLE_ARRAY_INVALID', 'People array exceeds its closed contract.', { field, maxItems });
  return value;
}

function createAlias(value) {
  exact(value, ['aliasDisplay', 'aliasNormalized', 'provenanceDigest']);
  return freeze({ aliasDisplay: text(value.aliasDisplay, 'aliasDisplay', 1024), aliasNormalized: text(value.aliasNormalized, 'aliasNormalized', 1024),
    provenanceDigest: digest(value.provenanceDigest, 'provenanceDigest') });
}

function createProviderIdentity(value) {
  exact(value, ['provider', 'namespace', 'providerKey', 'provenanceDigest']);
  return freeze({ provider: text(value.provider, 'provider', 128), namespace: text(value.namespace, 'namespace', 256),
    providerKey: text(value.providerKey, 'providerKey', 2048), provenanceDigest: digest(value.provenanceDigest, 'provenanceDigest') });
}

function createPersonRef(value) {
  exact(value, ['personId', 'revision', 'factDigest', 'preferenceRevision']);
  return freeze({ personId: text(value.personId, 'personId', 256), revision: revision(value.revision, 'revision'),
    factDigest: digest(value.factDigest, 'factDigest'), preferenceRevision: nullableRevision(value.preferenceRevision, 'preferenceRevision') });
}

function createOriginCandidateRef(value) {
  if (value === null) return null;
  exact(value, ['candidateKind', 'candidateId', 'candidateRevision', 'candidatePayloadDigest']);
  if (!['registration', 'merge'].includes(value.candidateKind)) fail('P6_PEOPLE_CANDIDATE_KIND_INVALID', 'Origin Candidate kind is invalid.');
  return freeze({ candidateKind: value.candidateKind, candidateId: text(value.candidateId, 'candidateId', 256),
    candidateRevision: revision(value.candidateRevision, 'candidateRevision'), candidatePayloadDigest: digest(value.candidatePayloadDigest, 'candidatePayloadDigest') });
}

function createPersonRevision(value) {
  exact(value, ['personId', 'revision', 'personStatus', 'canonicalName', 'mergedIntoPersonId', 'originKind', 'originDecisionRef', 'originCandidateRef', 'factDigest',
    'committedAtMs', 'aliases', 'providerIdentities']);
  if (!PERSON_STATES.has(value.personStatus)) fail('P6_PEOPLE_PERSON_STATE_INVALID', 'Person state is invalid.', { status: value.personStatus });
  if ((value.personStatus === 'merged') !== (value.mergedIntoPersonId !== null)) {
    fail('P6_PEOPLE_PERSON_MERGE_TARGET_INVALID', 'Only a merged Person revision names its merge target.');
  }
  const aliases = boundedArray(value.aliases, 'aliases').map(createAlias);
  const providerIdentities = boundedArray(value.providerIdentities, 'providerIdentities').map(createProviderIdentity);
  unique(aliases, (item) => item.aliasNormalized, 'P6_PEOPLE_ALIAS_DUPLICATE');
  unique(providerIdentities, (item) => [item.provider, item.namespace, item.providerKey].join('\u0000'), 'P6_PEOPLE_PROVIDER_IDENTITY_DUPLICATE');
  if (!['direct', 'candidate'].includes(value.originKind) || (value.originKind === 'direct') !== (value.originDecisionRef !== null) ||
      (value.originKind === 'candidate') !== (value.originCandidateRef !== null)) {
    fail('P6_PEOPLE_PERSON_ORIGIN_INVALID', 'Person revision must have exactly one direct or Candidate origin.');
  }
  return freeze({ personId: text(value.personId, 'personId', 256), revision: revision(value.revision, 'revision'), personStatus: value.personStatus,
    canonicalName: text(value.canonicalName, 'canonicalName', 1024),
    mergedIntoPersonId: value.mergedIntoPersonId === null ? null : text(value.mergedIntoPersonId, 'mergedIntoPersonId', 256),
    originKind: value.originKind,
    originDecisionRef: value.originDecisionRef === null ? null : freeze({ decisionId: text(value.originDecisionRef.decisionId, 'decisionId', 256),
      decisionDigest: digest(value.originDecisionRef.decisionDigest, 'decisionDigest') }),
    originCandidateRef: createOriginCandidateRef(value.originCandidateRef), factDigest: digest(value.factDigest, 'factDigest'),
    committedAtMs: time(value.committedAtMs, 'committedAtMs'), aliases, providerIdentities });
}

function createPerson(value) {
  exact(value, ['personId', 'status', 'currentRevision', 'currentPreferenceRevision', 'currentReferenceRevision',
    'currentReferenceProjectionRevision', 'currentReferenceProjectionDigest', 'createdAtMs', 'terminalAtMs', 'revision']);
  if (!PERSON_STATES.has(value.status)) fail('P6_PEOPLE_PERSON_STATE_INVALID', 'Person state is invalid.', { status: value.status });
  if ((value.status === 'active') !== (value.terminalAtMs === null)) fail('P6_PEOPLE_PERSON_TERMINAL_INVALID', 'Only an active Person has no terminal time.');
  const current = revision(value.currentRevision, 'currentRevision');
  const personRevision = createPersonRevision(value.revision);
  if (personRevision.personId !== value.personId || personRevision.revision !== current || personRevision.personStatus !== value.status) {
    fail('P6_PEOPLE_PERSON_HEAD_MISMATCH', 'Person head must point to its exact immutable revision and state.');
  }
  return freeze({ personId: text(value.personId, 'personId', 256), status: value.status, currentRevision: current,
    currentPreferenceRevision: nullableRevision(value.currentPreferenceRevision, 'currentPreferenceRevision'),
    currentReferenceRevision: nullableRevision(value.currentReferenceRevision, 'currentReferenceRevision'),
    currentReferenceProjectionRevision: revision(value.currentReferenceProjectionRevision, 'currentReferenceProjectionRevision'),
    currentReferenceProjectionDigest: digest(value.currentReferenceProjectionDigest, 'currentReferenceProjectionDigest'),
    createdAtMs: time(value.createdAtMs, 'createdAtMs'), terminalAtMs: value.terminalAtMs === null ? null : time(value.terminalAtMs, 'terminalAtMs'),
    revision: personRevision });
}

function createPreference(value) {
  exact(value, ['personId', 'revision', 'preferenceLevel', 'reason', 'originKind', 'originRef', 'committedAtMs']);
  if (!Number.isInteger(value.preferenceLevel) || value.preferenceLevel < -2 || value.preferenceLevel > 2) {
    fail('P6_PEOPLE_PREFERENCE_LEVEL_INVALID', 'Person Preference must be one integer from -2 through 2.');
  }
  return freeze({ personId: text(value.personId, 'personId', 256), revision: revision(value.revision, 'revision'),
    preferenceLevel: value.preferenceLevel, reason: text(value.reason, 'reason', 4096), originKind: text(value.originKind, 'originKind', 128),
    originRef: text(value.originRef, 'originRef', 256), committedAtMs: time(value.committedAtMs, 'committedAtMs') });
}

function createReferenceAsset(value) {
  exact(value, ['referenceAssetId', 'personId', 'artifactHandleId', 'artifactDigest', 'state', 'createdReferenceRevision',
    'releasedReferenceRevision', 'createdAtMs', 'releasedAtMs']);
  if (!REFERENCE_STATES.has(value.state)) fail('P6_PEOPLE_REFERENCE_STATE_INVALID', 'Reference Asset state is invalid.', { state: value.state });
  return freeze({ referenceAssetId: text(value.referenceAssetId, 'referenceAssetId', 256), personId: text(value.personId, 'personId', 256),
    artifactHandleId: text(value.artifactHandleId, 'artifactHandleId', 256), artifactDigest: digest(value.artifactDigest, 'artifactDigest'),
    state: value.state, createdReferenceRevision: revision(value.createdReferenceRevision, 'createdReferenceRevision'),
    releasedReferenceRevision: value.releasedReferenceRevision === null ? null : revision(value.releasedReferenceRevision, 'releasedReferenceRevision'),
    createdAtMs: time(value.createdAtMs, 'createdAtMs'), releasedAtMs: value.releasedAtMs === null ? null : time(value.releasedAtMs, 'releasedAtMs') });
}

function createReferenceFace(value) {
  exact(value, ['referenceFaceId', 'personId', 'referenceAssetId', 'embeddingHandleId', 'embeddingDigest', 'modelRef', 'state',
    'createdReferenceRevision', 'releasedReferenceRevision', 'createdAtMs', 'releasedAtMs']);
  if (!REFERENCE_STATES.has(value.state)) fail('P6_PEOPLE_REFERENCE_STATE_INVALID', 'Reference Face state is invalid.', { state: value.state });
  return freeze({ referenceFaceId: text(value.referenceFaceId, 'referenceFaceId', 256), personId: text(value.personId, 'personId', 256),
    referenceAssetId: text(value.referenceAssetId, 'referenceAssetId', 256), embeddingHandleId: text(value.embeddingHandleId, 'embeddingHandleId', 256),
    embeddingDigest: digest(value.embeddingDigest, 'embeddingDigest'), modelRef: text(value.modelRef, 'modelRef', 512), state: value.state,
    createdReferenceRevision: revision(value.createdReferenceRevision, 'createdReferenceRevision'),
    releasedReferenceRevision: value.releasedReferenceRevision === null ? null : revision(value.releasedReferenceRevision, 'releasedReferenceRevision'),
    createdAtMs: time(value.createdAtMs, 'createdAtMs'), releasedAtMs: value.releasedAtMs === null ? null : time(value.releasedAtMs, 'releasedAtMs') });
}

function createRegistrationPayload(value) {
  exact(value, ['proposedName', 'aliases', 'providerIdentities', 'referenceHints']);
  const aliases = boundedArray(value.aliases, 'aliases').map(createAlias);
  const providerIdentities = boundedArray(value.providerIdentities, 'providerIdentities').map(createProviderIdentity);
  const referenceHints = boundedArray(value.referenceHints, 'referenceHints').map((hint) => {
    exact(hint, ['hintKind', 'referenceValue', 'provenanceDigest']);
    return freeze({ hintKind: text(hint.hintKind, 'hintKind', 128), referenceValue: text(hint.referenceValue, 'referenceValue'),
      provenanceDigest: digest(hint.provenanceDigest, 'provenanceDigest') });
  });
  unique(aliases, (item) => item.aliasNormalized, 'P6_PEOPLE_ALIAS_DUPLICATE');
  unique(providerIdentities, (item) => [item.provider, item.namespace, item.providerKey].join('\u0000'), 'P6_PEOPLE_PROVIDER_IDENTITY_DUPLICATE');
  return freeze({ proposedName: text(value.proposedName, 'proposedName', 1024), aliases, providerIdentities, referenceHints });
}

function createMergePayload(value) {
  exact(value, ['leftPersonRef', 'rightPersonRef', 'matchSignals', 'conflictSummary', 'evidenceRefs']);
  const leftPersonRef = createPersonRef(value.leftPersonRef);
  const rightPersonRef = createPersonRef(value.rightPersonRef);
  if (leftPersonRef.personId >= rightPersonRef.personId) fail('P6_PEOPLE_MERGE_PAIR_NOT_NORMALIZED', 'Merge Candidate pair must be sorted and distinct.');
  const matchSignals = boundedArray(value.matchSignals, 'matchSignals').map((signal) => {
    exact(signal, ['objectId', 'revision', 'schemaRef', 'snapshotDigest', 'objectKind']);
    if (signal.objectKind !== 'person-match-signal') fail('P6_PEOPLE_MATCH_SIGNAL_KIND', 'Merge match signal kind is invalid.');
    return freeze({ objectId: text(signal.objectId, 'objectId', 256), revision: revision(signal.revision, 'revision'),
      schemaRef: text(signal.schemaRef, 'schemaRef'), snapshotDigest: digest(signal.snapshotDigest, 'snapshotDigest'), objectKind: signal.objectKind });
  });
  exact(value.conflictSummary, ['schemaRef', 'schemaVersion', 'recordKind', 'recordDigest', 'entries']);
  if (value.conflictSummary.recordKind !== 'merge-conflict-summary' || !Number.isSafeInteger(value.conflictSummary.schemaVersion) || value.conflictSummary.schemaVersion < 1) {
    fail('P6_PEOPLE_CONFLICT_SUMMARY_INVALID', 'Merge conflict summary contract is invalid.');
  }
  const entries = boundedArray(value.conflictSummary.entries, 'conflictSummary.entries').map((entry) => {
    exact(entry, ['key', 'value']);
    if (!['string', 'number', 'boolean'].includes(typeof entry.value) && entry.value !== null) fail('P6_PEOPLE_CONFLICT_VALUE_INVALID', 'Conflict value must be scalar.');
    return freeze({ key: text(entry.key, 'key'), value: entry.value });
  });
  const conflictSummary = freeze({ schemaRef: text(value.conflictSummary.schemaRef, 'schemaRef'), schemaVersion: value.conflictSummary.schemaVersion,
    recordKind: value.conflictSummary.recordKind, recordDigest: digest(value.conflictSummary.recordDigest, 'recordDigest'), entries });
  const evidenceRefs = boundedArray(value.evidenceRefs, 'evidenceRefs').map((item) => text(item, 'evidenceRef', 256));
  unique(evidenceRefs, (item) => item, 'P6_PEOPLE_EVIDENCE_REF_DUPLICATE');
  return freeze({ leftPersonRef, rightPersonRef, matchSignals, conflictSummary, evidenceRefs });
}

function createCandidateDraft(value) {
  exact(value, ['schemaRef', 'schemaVersion', 'draftId', 'draftKind', 'basisDigest', 'draftDigest', 'producedAtMs',
    'candidateKind', 'evidenceDigest', 'candidatePayload', 'candidatePayloadDigest']);
  if (value.schemaRef !== PEOPLE_CANDIDATE_DRAFT_SCHEMA || value.schemaVersion !== 1 || !['registration', 'merge'].includes(value.candidateKind)) {
    fail('P6_PEOPLE_CANDIDATE_DRAFT_CONTRACT', 'People Candidate Draft nominal identity is invalid.');
  }
  const candidatePayload = value.candidateKind === 'registration' ? createRegistrationPayload(value.candidatePayload) : createMergePayload(value.candidatePayload);
  const candidatePayloadDigest = digest(value.candidatePayloadDigest, 'candidatePayloadDigest');
  if (canonicalDigest(candidatePayload) !== candidatePayloadDigest) fail('P6_PEOPLE_CANDIDATE_PAYLOAD_DIGEST', 'Candidate payload digest does not match its exact typed payload.');
  return freeze({ schemaRef: value.schemaRef, schemaVersion: 1, draftId: text(value.draftId, 'draftId', 256),
    draftKind: text(value.draftKind, 'draftKind', 256), basisDigest: digest(value.basisDigest, 'basisDigest'),
    draftDigest: digest(value.draftDigest, 'draftDigest'), producedAtMs: time(value.producedAtMs, 'producedAtMs'), candidateKind: value.candidateKind,
    evidenceDigest: digest(value.evidenceDigest, 'evidenceDigest'), candidatePayload, candidatePayloadDigest });
}

function createCandidateRevision(value) {
  exact(value, ['candidateId', 'revision', 'state', 'decisionOrigin', 'decisionRef', 'decisionDigest', 'committedAtMs']);
  if (!CANDIDATE_STATES.has(value.state)) fail('P6_PEOPLE_CANDIDATE_STATE_INVALID', 'People Candidate state is invalid.', { state: value.state });
  const terminal = value.state !== 'open';
  if (terminal !== (value.decisionOrigin !== null && value.decisionRef !== null && value.decisionDigest !== null)) {
    fail('P6_PEOPLE_CANDIDATE_DECISION_INVALID', 'Only a terminal Candidate revision carries its complete Decision reference.');
  }
  return freeze({ candidateId: text(value.candidateId, 'candidateId', 256), revision: revision(value.revision, 'revision'), state: value.state,
    decisionOrigin: value.decisionOrigin === null ? null : text(value.decisionOrigin, 'decisionOrigin', 128),
    decisionRef: value.decisionRef === null ? null : text(value.decisionRef, 'decisionRef', 256),
    decisionDigest: value.decisionDigest === null ? null : digest(value.decisionDigest, 'decisionDigest'),
    committedAtMs: time(value.committedAtMs, 'committedAtMs') });
}

function createCandidate(value, kind) {
  const required = kind === 'registration'
    ? ['candidateId', 'currentRevision', 'currentState', 'proposedName', 'evidenceDigest', 'candidateSchemaRef', 'candidatePayload',
      'candidatePayloadDigest', 'createdAtMs', 'terminalAtMs', 'revision']
    : ['candidateId', 'currentRevision', 'currentState', 'leftPersonId', 'leftPersonRevision', 'rightPersonId', 'rightPersonRevision',
      'evidenceDigest', 'candidateSchemaRef', 'candidatePayload', 'candidatePayloadDigest', 'createdAtMs', 'terminalAtMs', 'revision'];
  exact(value, required);
  const currentRevision = revision(value.currentRevision, 'currentRevision');
  const current = createCandidateRevision(value.revision);
  if (current.candidateId !== value.candidateId || current.revision !== currentRevision || current.state !== value.currentState) {
    fail('P6_PEOPLE_CANDIDATE_HEAD_MISMATCH', 'Candidate head must point to its exact immutable state revision.');
  }
  if ((value.currentState === 'open') !== (value.terminalAtMs === null)) fail('P6_PEOPLE_CANDIDATE_TERMINAL_INVALID', 'Only an open Candidate has no terminal time.');
  const candidatePayload = kind === 'registration' ? createRegistrationPayload(value.candidatePayload) : createMergePayload(value.candidatePayload);
  const candidatePayloadDigest = digest(value.candidatePayloadDigest, 'candidatePayloadDigest');
  if (canonicalDigest(candidatePayload) !== candidatePayloadDigest) fail('P6_PEOPLE_CANDIDATE_PAYLOAD_DIGEST', 'Stored Candidate payload digest is corrupt.');
  if (kind === 'registration' && value.proposedName !== candidatePayload.proposedName) fail('P6_PEOPLE_REGISTRATION_HOT_FIELD_MISMATCH', 'Registration hot field differs from immutable payload.');
  if (kind === 'merge' && (value.leftPersonId !== candidatePayload.leftPersonRef.personId || value.leftPersonRevision !== candidatePayload.leftPersonRef.revision ||
      value.rightPersonId !== candidatePayload.rightPersonRef.personId || value.rightPersonRevision !== candidatePayload.rightPersonRef.revision)) {
    fail('P6_PEOPLE_MERGE_HOT_FIELD_MISMATCH', 'Merge hot fields differ from immutable payload.');
  }
  return freeze({ ...value, candidateId: text(value.candidateId, 'candidateId', 256), currentRevision, currentState: current.state,
    evidenceDigest: digest(value.evidenceDigest, 'evidenceDigest'), candidateSchemaRef: text(value.candidateSchemaRef, 'candidateSchemaRef', 256),
    candidatePayload, candidatePayloadDigest, createdAtMs: time(value.createdAtMs, 'createdAtMs'),
    terminalAtMs: value.terminalAtMs === null ? null : time(value.terminalAtMs, 'terminalAtMs'), revision: current });
}

module.exports = Object.freeze({
  PEOPLE_CANDIDATE_DRAFT_SCHEMA, PeopleStoreContractError, createCandidate, createCandidateDraft, createCandidateRevision, createPerson,
  createPersonRevision, createPreference, createReferenceAsset, createReferenceFace
});
