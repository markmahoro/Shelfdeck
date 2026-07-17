'use strict';

const DIGEST = /^[a-f0-9]{64}$/;
const SOURCE_STATES = new Set(['active', 'disabled']);
const ACQUISITION_STATES = new Set(['active', 'completed', 'failed']);
const RECORD_KINDS = new Set(['observation', 'correction', 'retraction']);
const RELATION_KINDS = new Set(['duplicate_of', 'supersedes', 'retracts']);
const RESULT_KINDS = new Set(['found', 'not_found']);

class PerceptionStoreContractError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'PerceptionStoreContractError'; this.code = code; this.details = details; }
}
function fail(code, message, details) { throw new PerceptionStoreContractError(code, message, details); }
function exact(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('P6_PERCEPTION_VALUE_REQUIRED', 'A typed Perception value is required.');
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  if (unknown.length || missing.length) fail('P6_PERCEPTION_VALUE_SHAPE', 'Perception value does not match its closed contract.', { unknown, missing });
}
function text(value, field, max = 4096) { if (typeof value !== 'string' || value.length < 1 || value.length > max) fail('P6_PERCEPTION_TEXT_INVALID', 'Perception text is invalid.', { field }); return value; }
function digest(value, field) { if (typeof value !== 'string' || !DIGEST.test(value)) fail('P6_PERCEPTION_DIGEST_INVALID', 'Perception digest must be lowercase SHA-256.', { field }); return value; }
function integer(value, field, minimum = 0) { if (!Number.isSafeInteger(value) || value < minimum) fail('P6_PERCEPTION_INTEGER_INVALID', 'Perception integer is outside its contract.', { field }); return value; }
function nullableText(value, field, max) { return value === null ? null : text(value, field, max); }
function freeze(value) { return Array.isArray(value) ? Object.freeze(value.map(freeze)) : value && typeof value === 'object' ? Object.freeze(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, freeze(v)]))) : value; }

function createSource(value) {
  exact(value, ['perceptionSourceId', 'sourceKind', 'integrationId', 'status', 'configRevision', 'currentCursorRevision', 'createdAtMs', 'updatedAtMs']);
  if (!SOURCE_STATES.has(value.status)) fail('P6_PERCEPTION_SOURCE_STATE_INVALID', 'Perception Source state is invalid.');
  return freeze({ ...value, perceptionSourceId: text(value.perceptionSourceId, 'perceptionSourceId', 256), sourceKind: text(value.sourceKind, 'sourceKind', 128),
    integrationId: nullableText(value.integrationId, 'integrationId', 256), configRevision: integer(value.configRevision, 'configRevision', 1),
    currentCursorRevision: value.currentCursorRevision === null ? null : integer(value.currentCursorRevision, 'currentCursorRevision', 1),
    createdAtMs: integer(value.createdAtMs, 'createdAtMs'), updatedAtMs: integer(value.updatedAtMs, 'updatedAtMs') });
}

function createAcquisition(value) {
  exact(value, ['perceptionAcquisitionId', 'perceptionSourceId', 'sourceConfigRevision', 'scopeSchemaRef', 'scopeJson', 'scopeDigest',
    'initialCursorRevision', 'initialCursorValue', 'state', 'createdAtMs', 'terminalAtMs']);
  if (!ACQUISITION_STATES.has(value.state) || (value.state === 'active') !== (value.terminalAtMs === null)) fail('P6_PERCEPTION_ACQUISITION_STATE_INVALID', 'Acquisition state/terminal time is invalid.');
  return freeze({ ...value, perceptionAcquisitionId: text(value.perceptionAcquisitionId, 'perceptionAcquisitionId', 256),
    perceptionSourceId: text(value.perceptionSourceId, 'perceptionSourceId', 256), sourceConfigRevision: integer(value.sourceConfigRevision, 'sourceConfigRevision', 1),
    scopeSchemaRef: text(value.scopeSchemaRef, 'scopeSchemaRef', 512), scopeJson: text(value.scopeJson, 'scopeJson', 16384), scopeDigest: digest(value.scopeDigest, 'scopeDigest'),
    initialCursorRevision: integer(value.initialCursorRevision, 'initialCursorRevision'), initialCursorValue: nullableText(value.initialCursorValue, 'initialCursorValue', 65536),
    createdAtMs: integer(value.createdAtMs, 'createdAtMs'), terminalAtMs: value.terminalAtMs === null ? null : integer(value.terminalAtMs, 'terminalAtMs') });
}

function createCursor(value) {
  exact(value, ['perceptionSourceId', 'revision', 'perceptionAcquisitionId', 'cursorIn', 'cursorOut', 'observationPageDigest', 'hasMore', 'committedAtMs']);
  if (typeof value.hasMore !== 'boolean') fail('P6_PERCEPTION_CURSOR_HAS_MORE_INVALID', 'Cursor hasMore must be boolean.');
  return freeze({ ...value, perceptionSourceId: text(value.perceptionSourceId, 'perceptionSourceId', 256), revision: integer(value.revision, 'revision', 1),
    perceptionAcquisitionId: text(value.perceptionAcquisitionId, 'perceptionAcquisitionId', 256), cursorIn: nullableText(value.cursorIn, 'cursorIn', 65536),
    cursorOut: text(value.cursorOut, 'cursorOut', 65536), observationPageDigest: digest(value.observationPageDigest, 'observationPageDigest'), committedAtMs: integer(value.committedAtMs, 'committedAtMs') });
}

function createAnchor(value) { exact(value, ['anchorKind', 'anchorValue', 'confidenceClass', 'evidenceDigest']); return freeze({
  anchorKind: text(value.anchorKind, 'anchorKind', 128), anchorValue: text(value.anchorValue, 'anchorValue', 2048),
  confidenceClass: text(value.confidenceClass, 'confidenceClass', 128), evidenceDigest: digest(value.evidenceDigest, 'evidenceDigest') }); }

function createRecord(value) {
  exact(value, ['perceptionId', 'perceptionSourceId', 'perceptionAcquisitionId', 'acquisitionCommitReceiptId', 'recordKind', 'sourceKind',
    'sourceRecordKey', 'sourceRecordRevision', 'sourceRecordDigest', 'normalizationRuleRef', 'rating', 'watchedState', 'observedTitle',
    'recordDigest',
    'provenanceRef', 'provenanceDigest', 'observedAtMs', 'committedAtMs', 'anchors']);
  if (!RECORD_KINDS.has(value.recordKind)) fail('P6_PERCEPTION_RECORD_KIND_INVALID', 'Record kind is invalid.');
  if (value.rating !== null && (!Number.isInteger(value.rating) || value.rating < 1 || value.rating > 5)) fail('P6_PERCEPTION_RATING_INVALID', 'Canonical rating must be integer 1..5 or null.');
  if (value.watchedState !== null && typeof value.watchedState !== 'boolean') fail('P6_PERCEPTION_WATCHED_STATE_INVALID', 'Watched state must be boolean or null.');
  if (!Array.isArray(value.anchors) || value.anchors.length > 16) fail('P6_PERCEPTION_ANCHORS_INVALID', 'Identity anchors must be bounded to 16.');
  const anchors = value.anchors.map(createAnchor); const keys = anchors.map((a) => a.anchorKind + '\0' + a.anchorValue);
  if (new Set(keys).size !== keys.length) fail('P6_PERCEPTION_ANCHOR_DUPLICATE', 'Identity anchors must be unique.');
  return freeze({ ...value, perceptionId: text(value.perceptionId, 'perceptionId', 256), perceptionSourceId: text(value.perceptionSourceId, 'perceptionSourceId', 256),
    perceptionAcquisitionId: text(value.perceptionAcquisitionId, 'perceptionAcquisitionId', 256), acquisitionCommitReceiptId: text(value.acquisitionCommitReceiptId, 'acquisitionCommitReceiptId', 256),
    sourceKind: text(value.sourceKind, 'sourceKind', 128), sourceRecordKey: text(value.sourceRecordKey, 'sourceRecordKey', 2048),
    sourceRecordRevision: integer(value.sourceRecordRevision, 'sourceRecordRevision', 1), sourceRecordDigest: digest(value.sourceRecordDigest, 'sourceRecordDigest'),
    normalizationRuleRef: text(value.normalizationRuleRef, 'normalizationRuleRef', 512), observedTitle: text(value.observedTitle, 'observedTitle', 4096),
    recordDigest: digest(value.recordDigest, 'recordDigest'),
    provenanceRef: text(value.provenanceRef, 'provenanceRef', 2048), provenanceDigest: digest(value.provenanceDigest, 'provenanceDigest'),
    observedAtMs: integer(value.observedAtMs, 'observedAtMs'), committedAtMs: integer(value.committedAtMs, 'committedAtMs'), anchors });
}

function createRelation(value) {
  exact(value, ['relationId', 'relationKind', 'sourcePerceptionId', 'targetPerceptionId', 'ruleRevision', 'evidenceDigest', 'committedAtMs']);
  if (!RELATION_KINDS.has(value.relationKind)) fail('P6_PERCEPTION_RELATION_KIND_INVALID', 'Relation kind is invalid.');
  let source = text(value.sourcePerceptionId, 'sourcePerceptionId', 256); let target = text(value.targetPerceptionId, 'targetPerceptionId', 256);
  if (source === target) fail('P6_PERCEPTION_RELATION_SELF', 'Relation requires two records.');
  if (value.relationKind === 'duplicate_of' && source > target) [source, target] = [target, source];
  return freeze({ relationId: text(value.relationId, 'relationId', 256), relationKind: value.relationKind, sourcePerceptionId: source,
    targetPerceptionId: target, ruleRevision: integer(value.ruleRevision, 'ruleRevision', 1), evidenceDigest: digest(value.evidenceDigest, 'evidenceDigest'),
    committedAtMs: integer(value.committedAtMs, 'committedAtMs') });
}

function createResolution(value) {
  exact(value, ['resolutionId', 'queryContract', 'queryInputDigest', 'revision', 'resultKind', 'winningPerceptionId', 'resultDigest', 'resolvedAtMs']);
  if (!RESULT_KINDS.has(value.resultKind) || (value.resultKind === 'found') !== (typeof value.winningPerceptionId === 'string' && value.winningPerceptionId.length > 0)) fail('P6_PERCEPTION_WINNER_INVALID', 'Resolution winner/result kind mismatch.');
  return freeze({ ...value, resolutionId: text(value.resolutionId, 'resolutionId', 256), queryContract: text(value.queryContract, 'queryContract', 512),
    revision: integer(value.revision, 'revision', 1), queryInputDigest: digest(value.queryInputDigest, 'queryInputDigest'),
    resultDigest: digest(value.resultDigest, 'resultDigest'), resolvedAtMs: integer(value.resolvedAtMs, 'resolvedAtMs'),
    winningPerceptionId: value.resultKind === 'found' ? text(value.winningPerceptionId, 'winningPerceptionId', 256) : null });
}

module.exports = Object.freeze({ PerceptionStoreContractError, createAcquisition, createAnchor, createCursor, createRecord, createRelation, createResolution, createSource });
