'use strict';

const DIGEST = /^[a-f0-9]{64}$/;
const PERSON_STATES = new Set(['active', 'merged', 'archived']);
const CANDIDATE_STATES = new Set(['open', 'accepted', 'dismissed', 'superseded']);
const REFERENCE_STATES = new Set(['active', 'superseded', 'rejected']);
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
function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (value && typeof value === 'object') return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freeze(item)])));
  return value;
}
function unique(items, key, code) {
  const identities = items.map(key);
  if (new Set(identities).size !== identities.length) fail(code, 'People value contains duplicate identities.');
}

function createAlias(value) {
  exact(value, ['aliasNormalized', 'aliasDisplay', 'provenanceDigest']);
  return freeze({
    aliasNormalized: text(value.aliasNormalized, 'aliasNormalized', 1024),
    aliasDisplay: text(value.aliasDisplay, 'aliasDisplay', 1024),
    provenanceDigest: digest(value.provenanceDigest, 'provenanceDigest')
  });
}

function createProviderIdentity(value) {
  exact(value, ['provider', 'namespace', 'providerKey', 'provenanceDigest']);
  return freeze({
    provider: text(value.provider, 'provider', 128), namespace: text(value.namespace, 'namespace', 256),
    providerKey: text(value.providerKey, 'providerKey', 2048), provenanceDigest: digest(value.provenanceDigest, 'provenanceDigest')
  });
}

function createPersonRevision(value) {
  exact(value, ['personId', 'revision', 'canonicalName', 'contentScope', 'factDigest', 'committedAtMs', 'aliases', 'providerIdentities']);
  if (!Array.isArray(value.aliases) || value.aliases.length > 256 || !Array.isArray(value.providerIdentities) || value.providerIdentities.length > 256) {
    fail('P6_PEOPLE_PERSON_FACT_SET_INVALID', 'Person aliases and provider identities must be bounded arrays.');
  }
  const aliases = value.aliases.map(createAlias);
  const providerIdentities = value.providerIdentities.map(createProviderIdentity);
  unique(aliases, (item) => item.aliasNormalized, 'P6_PEOPLE_ALIAS_DUPLICATE');
  unique(providerIdentities, (item) => [item.provider, item.namespace, item.providerKey].join('\u0000'), 'P6_PEOPLE_PROVIDER_IDENTITY_DUPLICATE');
  return freeze({
    personId: text(value.personId, 'personId', 256), revision: revision(value.revision, 'revision'),
    canonicalName: text(value.canonicalName, 'canonicalName', 1024), contentScope: text(value.contentScope, 'contentScope', 512),
    factDigest: digest(value.factDigest, 'factDigest'), committedAtMs: time(value.committedAtMs, 'committedAtMs'), aliases, providerIdentities
  });
}

function createPerson(value) {
  exact(value, ['personId', 'status', 'currentRevision', 'createdAtMs', 'terminalAtMs', 'revision']);
  if (!PERSON_STATES.has(value.status)) fail('P6_PEOPLE_PERSON_STATE_INVALID', 'Person state is invalid.', { status: value.status });
  if ((value.status === 'active') !== (value.terminalAtMs === null)) fail('P6_PEOPLE_PERSON_TERMINAL_INVALID', 'Only a non-active Person has a terminal time.');
  const current = revision(value.currentRevision, 'currentRevision');
  const personRevision = createPersonRevision(value.revision);
  if (personRevision.personId !== value.personId || personRevision.revision !== current) {
    fail('P6_PEOPLE_PERSON_HEAD_MISMATCH', 'Person head must point to its exact immutable revision.');
  }
  return freeze({
    personId: text(value.personId, 'personId', 256), status: value.status, currentRevision: current,
    createdAtMs: time(value.createdAtMs, 'createdAtMs'), terminalAtMs: value.terminalAtMs === null ? null : time(value.terminalAtMs, 'terminalAtMs'),
    revision: personRevision
  });
}

function createPreference(value) {
  exact(value, ['personId', 'revision', 'preferenceLevel', 'reason', 'committedAtMs']);
  if (!Number.isInteger(value.preferenceLevel) || value.preferenceLevel < -2 || value.preferenceLevel > 2) {
    fail('P6_PEOPLE_PREFERENCE_LEVEL_INVALID', 'Person Preference must be one integer from -2 through 2.');
  }
  return freeze({
    personId: text(value.personId, 'personId', 256), revision: revision(value.revision, 'revision'),
    preferenceLevel: value.preferenceLevel, reason: text(value.reason, 'reason', 4096), committedAtMs: time(value.committedAtMs, 'committedAtMs')
  });
}

function createReferenceAsset(value) {
  exact(value, ['referenceAssetId', 'personId', 'artifactHandleId', 'artifactDigest', 'state', 'createdAtMs']);
  if (!REFERENCE_STATES.has(value.state)) fail('P6_PEOPLE_REFERENCE_STATE_INVALID', 'Reference Asset state is invalid.', { state: value.state });
  return freeze({
    referenceAssetId: text(value.referenceAssetId, 'referenceAssetId', 256), personId: text(value.personId, 'personId', 256),
    artifactHandleId: text(value.artifactHandleId, 'artifactHandleId', 256), artifactDigest: digest(value.artifactDigest, 'artifactDigest'),
    state: value.state, createdAtMs: time(value.createdAtMs, 'createdAtMs')
  });
}

function createReferenceFace(value) {
  exact(value, ['referenceFaceId', 'personId', 'referenceAssetId', 'embeddingHandleId', 'modelRef', 'state', 'createdAtMs']);
  if (!REFERENCE_STATES.has(value.state)) fail('P6_PEOPLE_REFERENCE_STATE_INVALID', 'Reference Face state is invalid.', { state: value.state });
  return freeze({
    referenceFaceId: text(value.referenceFaceId, 'referenceFaceId', 256), personId: text(value.personId, 'personId', 256),
    referenceAssetId: text(value.referenceAssetId, 'referenceAssetId', 256), embeddingHandleId: text(value.embeddingHandleId, 'embeddingHandleId', 256),
    modelRef: text(value.modelRef, 'modelRef', 512), state: value.state, createdAtMs: time(value.createdAtMs, 'createdAtMs')
  });
}

function validateCandidateState(state, terminalAtMs) {
  if (!CANDIDATE_STATES.has(state)) fail('P6_PEOPLE_CANDIDATE_STATE_INVALID', 'People Candidate state is invalid.', { state });
  if ((state === 'open') !== (terminalAtMs === null)) fail('P6_PEOPLE_CANDIDATE_TERMINAL_INVALID', 'Only an open Candidate has no terminal time.');
}

function createCandidateDraft(value) {
  exact(value, ['schemaRef', 'schemaVersion', 'draftId', 'draftKind', 'basisDigest', 'draftDigest', 'producedAtMs',
    'candidateKind', 'candidatePayloadDigest', 'evidenceDigest']);
  if (value.schemaRef !== PEOPLE_CANDIDATE_DRAFT_SCHEMA || value.schemaVersion !== 1 || !['registration', 'merge'].includes(value.candidateKind)) {
    fail('P6_PEOPLE_CANDIDATE_DRAFT_CONTRACT', 'People Candidate Draft nominal identity is invalid.');
  }
  return freeze({
    schemaRef: value.schemaRef, schemaVersion: 1, draftId: text(value.draftId, 'draftId', 256),
    draftKind: text(value.draftKind, 'draftKind', 256), basisDigest: digest(value.basisDigest, 'basisDigest'),
    draftDigest: digest(value.draftDigest, 'draftDigest'), producedAtMs: time(value.producedAtMs, 'producedAtMs'),
    candidateKind: value.candidateKind, candidatePayloadDigest: digest(value.candidatePayloadDigest, 'candidatePayloadDigest'),
    evidenceDigest: digest(value.evidenceDigest, 'evidenceDigest')
  });
}

function createRegistrationCandidate(value) {
  exact(value, ['registrationCandidateId', 'proposedName', 'evidenceDigest', 'candidateSchemaRef', 'candidatePayload', 'state', 'createdAtMs', 'terminalAtMs']);
  validateCandidateState(value.state, value.terminalAtMs);
  const candidatePayload = createCandidateDraft(value.candidatePayload);
  if (value.candidateSchemaRef !== PEOPLE_CANDIDATE_DRAFT_SCHEMA || candidatePayload.candidateKind !== 'registration') {
    fail('P6_PEOPLE_REGISTRATION_CANDIDATE_CONTRACT', 'Registration Candidate must contain the exact People-owned Candidate Draft, not a Foundation Result.');
  }
  return freeze({
    registrationCandidateId: text(value.registrationCandidateId, 'registrationCandidateId', 256),
    proposedName: text(value.proposedName, 'proposedName', 1024), evidenceDigest: digest(value.evidenceDigest, 'evidenceDigest'),
    candidateSchemaRef: value.candidateSchemaRef, candidatePayload, state: value.state,
    createdAtMs: time(value.createdAtMs, 'createdAtMs'), terminalAtMs: value.terminalAtMs === null ? null : time(value.terminalAtMs, 'terminalAtMs')
  });
}

function createMergeCandidate(value) {
  exact(value, ['mergeCandidateId', 'leftPersonId', 'rightPersonId', 'evidenceDigest', 'state', 'createdAtMs', 'terminalAtMs']);
  validateCandidateState(value.state, value.terminalAtMs);
  const pair = [text(value.leftPersonId, 'leftPersonId', 256), text(value.rightPersonId, 'rightPersonId', 256)].sort();
  if (pair[0] === pair[1]) fail('P6_PEOPLE_MERGE_SELF', 'Merge Candidate requires two different Persons.');
  return freeze({
    mergeCandidateId: text(value.mergeCandidateId, 'mergeCandidateId', 256), leftPersonId: pair[0], rightPersonId: pair[1],
    evidenceDigest: digest(value.evidenceDigest, 'evidenceDigest'), state: value.state,
    createdAtMs: time(value.createdAtMs, 'createdAtMs'), terminalAtMs: value.terminalAtMs === null ? null : time(value.terminalAtMs, 'terminalAtMs')
  });
}

function createMergeRecord(value) {
  exact(value, ['mergeRecordId', 'sourcePersonId', 'targetPersonId', 'decisionDigest', 'committedAtMs']);
  if (value.sourcePersonId === value.targetPersonId) fail('P6_PEOPLE_MERGE_SELF', 'Merge Record requires different source and target Persons.');
  return freeze({
    mergeRecordId: text(value.mergeRecordId, 'mergeRecordId', 256), sourcePersonId: text(value.sourcePersonId, 'sourcePersonId', 256),
    targetPersonId: text(value.targetPersonId, 'targetPersonId', 256), decisionDigest: digest(value.decisionDigest, 'decisionDigest'),
    committedAtMs: time(value.committedAtMs, 'committedAtMs')
  });
}

module.exports = Object.freeze({
  PEOPLE_CANDIDATE_DRAFT_SCHEMA, PeopleStoreContractError, createMergeCandidate, createMergeRecord, createPerson,
  createPersonRevision, createPreference, createReferenceAsset, createReferenceFace, createRegistrationCandidate
});
