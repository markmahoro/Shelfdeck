'use strict';

const DIGEST = /^[a-f0-9]{64}$/;
const WATCHED_STATES = new Set(['unknown', 'unwatched', 'watched']);
const RESULT_KINDS = new Set(['found', 'not_found']);
const SOURCE_STATES = new Set(['active', 'disabled']);

class PerceptionStoreContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PerceptionStoreContractError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) { throw new PerceptionStoreContractError(code, message, details); }
function exact(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('P6_PERCEPTION_VALUE_REQUIRED', 'A typed Perception value is required.');
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  const unknown = keys.filter((key) => !allowed.has(key));
  const missing = required.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (unknown.length || missing.length) fail('P6_PERCEPTION_VALUE_SHAPE', 'Perception value does not match its closed contract.', { unknown, missing });
}
function text(value, field, maxLength = 256) {
  if (typeof value !== 'string' || value.length < 1 || value.length > maxLength) {
    fail('P6_PERCEPTION_TEXT_INVALID', 'Perception text is empty or exceeds its contract.', { field, maxLength });
  }
  return value;
}
function digest(value, field) {
  if (typeof value !== 'string' || !DIGEST.test(value)) fail('P6_PERCEPTION_DIGEST_INVALID', 'Perception digest must be lowercase SHA-256.', { field });
  return value;
}
function revision(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) fail('P6_PERCEPTION_REVISION_INVALID', 'Perception revision must be a positive safe integer.', { field });
  return value;
}
function time(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) fail('P6_PERCEPTION_TIME_INVALID', 'Perception time must be a non-negative UTC epoch millisecond.', { field });
  return value;
}
function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (value && typeof value === 'object') return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freeze(item)])));
  return value;
}

function createSource(value) {
  exact(value, ['perceptionSourceId', 'sourceKind', 'integrationId', 'status', 'configRevision', 'currentCursorRevision', 'createdAtMs', 'updatedAtMs']);
  if (!SOURCE_STATES.has(value.status)) fail('P6_PERCEPTION_SOURCE_STATE_INVALID', 'Perception Source state is invalid.', { status: value.status });
  return freeze({
    perceptionSourceId: text(value.perceptionSourceId, 'perceptionSourceId'),
    sourceKind: text(value.sourceKind, 'sourceKind', 128),
    integrationId: value.integrationId === null ? null : text(value.integrationId, 'integrationId'),
    status: value.status, configRevision: revision(value.configRevision, 'configRevision'),
    currentCursorRevision: value.currentCursorRevision === null ? null : revision(value.currentCursorRevision, 'currentCursorRevision'),
    createdAtMs: time(value.createdAtMs, 'createdAtMs'), updatedAtMs: time(value.updatedAtMs, 'updatedAtMs')
  });
}

function createCursor(value) {
  exact(value, ['perceptionSourceId', 'revision', 'cursorValue', 'observationDigest', 'committedAtMs']);
  return freeze({
    perceptionSourceId: text(value.perceptionSourceId, 'perceptionSourceId'), revision: revision(value.revision, 'revision'),
    cursorValue: text(value.cursorValue, 'cursorValue', 65536), observationDigest: digest(value.observationDigest, 'observationDigest'),
    committedAtMs: time(value.committedAtMs, 'committedAtMs')
  });
}

function createAnchor(value) {
  exact(value, ['anchorKind', 'anchorValue', 'confidenceClass', 'evidenceDigest']);
  return freeze({
    anchorKind: text(value.anchorKind, 'anchorKind', 128), anchorValue: text(value.anchorValue, 'anchorValue', 2048),
    confidenceClass: text(value.confidenceClass, 'confidenceClass', 128), evidenceDigest: digest(value.evidenceDigest, 'evidenceDigest')
  });
}

function createRecord(value) {
  exact(value, ['perceptionId', 'perceptionSourceId', 'sourceKind', 'sourceRecordKey', 'sourceRecordRevision', 'sourceRecordDigest',
    'rating', 'watchedState', 'observedTitle', 'provenanceDigest', 'observedAtMs', 'committedAtMs', 'anchors']);
  if (value.rating !== null && (typeof value.rating !== 'number' || !Number.isFinite(value.rating) || value.rating < 1 || value.rating > 5)) {
    fail('P6_PERCEPTION_RATING_INVALID', 'Persisted rating must be null or within the SSOT 1..5 range.');
  }
  if (!WATCHED_STATES.has(value.watchedState)) fail('P6_PERCEPTION_WATCHED_STATE_INVALID', 'Watched state is invalid.', { watchedState: value.watchedState });
  if (!Array.isArray(value.anchors) || value.anchors.length > 128) fail('P6_PERCEPTION_ANCHORS_INVALID', 'Identity anchors must be a bounded array.');
  const anchors = value.anchors.map(createAnchor);
  const identities = anchors.map((item) => item.anchorKind + '\u0000' + item.anchorValue);
  if (new Set(identities).size !== identities.length) fail('P6_PERCEPTION_ANCHOR_DUPLICATE', 'Record anchors must be unique by kind and value.');
  return freeze({
    perceptionId: text(value.perceptionId, 'perceptionId'), perceptionSourceId: text(value.perceptionSourceId, 'perceptionSourceId'),
    sourceKind: text(value.sourceKind, 'sourceKind', 128), sourceRecordKey: text(value.sourceRecordKey, 'sourceRecordKey', 2048),
    sourceRecordRevision: revision(value.sourceRecordRevision, 'sourceRecordRevision'),
    sourceRecordDigest: digest(value.sourceRecordDigest, 'sourceRecordDigest'), rating: value.rating,
    watchedState: value.watchedState, observedTitle: text(value.observedTitle, 'observedTitle', 4096),
    provenanceDigest: digest(value.provenanceDigest, 'provenanceDigest'), observedAtMs: time(value.observedAtMs, 'observedAtMs'),
    committedAtMs: time(value.committedAtMs, 'committedAtMs'), anchors
  });
}

function createRelation(value) {
  exact(value, ['relationId', 'leftPerceptionId', 'rightPerceptionId', 'ruleRevision', 'relation', 'evidenceDigest', 'committedAtMs']);
  const pair = [text(value.leftPerceptionId, 'leftPerceptionId'), text(value.rightPerceptionId, 'rightPerceptionId')].sort();
  if (pair[0] === pair[1]) fail('P6_PERCEPTION_RELATION_SELF', 'A Perception relation requires two different Records.');
  return freeze({
    relationId: text(value.relationId, 'relationId'), leftPerceptionId: pair[0], rightPerceptionId: pair[1],
    ruleRevision: revision(value.ruleRevision, 'ruleRevision'), relation: text(value.relation, 'relation', 128),
    evidenceDigest: digest(value.evidenceDigest, 'evidenceDigest'), committedAtMs: time(value.committedAtMs, 'committedAtMs')
  });
}

function createResolution(value) {
  exact(value, ['resolutionId', 'queryContract', 'queryInputDigest', 'revision', 'resultKind', 'winningPerceptionId', 'resultDigest', 'resolvedAtMs']);
  if (!RESULT_KINDS.has(value.resultKind)) fail('P6_PERCEPTION_RESULT_KIND_INVALID', 'Resolution result must be found or not_found.');
  if ((value.resultKind === 'found') !== (typeof value.winningPerceptionId === 'string' && value.winningPerceptionId.length > 0)) {
    fail('P6_PERCEPTION_WINNER_INVALID', 'Only found Resolution requires one winning Perception Record.');
  }
  return freeze({
    resolutionId: text(value.resolutionId, 'resolutionId'), queryContract: text(value.queryContract, 'queryContract', 512),
    queryInputDigest: digest(value.queryInputDigest, 'queryInputDigest'), revision: revision(value.revision, 'revision'),
    resultKind: value.resultKind, winningPerceptionId: value.resultKind === 'found' ? text(value.winningPerceptionId, 'winningPerceptionId') : null,
    resultDigest: digest(value.resultDigest, 'resultDigest'), resolvedAtMs: time(value.resolvedAtMs, 'resolvedAtMs')
  });
}

module.exports = Object.freeze({
  PerceptionStoreContractError, createAnchor, createCursor, createRecord, createRelation, createResolution, createSource
});
