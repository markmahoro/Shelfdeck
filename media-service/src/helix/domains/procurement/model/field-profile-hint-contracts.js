'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');

const PROFILE_HINT_SCHEMA =
  'helix://contracts/application-types/MaterialFieldProfileHintSnapshot/v1';
const PROFILE_HINTS = Object.freeze([
  'mixed',
  'movie',
  'series',
  'jav',
  'western_adult',
]);
const SHA256 = /^[0-9a-f]{64}$/;

class FieldProfileHintContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FieldProfileHintContractError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new FieldProfileHintContractError(code, message, details);
}

function assertProfileHint(value, field = 'contentProfileHint') {
  if (!PROFILE_HINTS.includes(value)) {
    fail(
      'PBF22_FIELD_PROFILE_HINT_INVALID',
      field + ' must be a closed Material Field profile hint.',
      { field },
    );
  }
  return value;
}

function hintDigest(fieldId, revision, contentProfileHint) {
  return canonicalDigest({
    schema: 'procurement.material-field-profile-hint@1',
    fieldId,
    revision,
    contentProfileHint,
  });
}

function createProfileHintSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== 4 ||
      !['fieldId', 'revision', 'contentProfileHint', 'hintDigest'].every(
        (key) => Object.hasOwn(value, key),
      ) ||
      typeof value.fieldId !== 'string' || value.fieldId.length === 0 ||
      !Number.isSafeInteger(value.revision) || value.revision < 1 ||
      !SHA256.test(value.hintDigest || '')) {
    fail(
      'PBF22_FIELD_PROFILE_HINT_SNAPSHOT_INVALID',
      'MaterialFieldProfileHintSnapshot@1 does not match its closed shape.',
    );
  }
  assertProfileHint(value.contentProfileHint);
  if (value.hintDigest !== hintDigest(
    value.fieldId,
    value.revision,
    value.contentProfileHint,
  )) {
    fail(
      'PBF22_FIELD_PROFILE_HINT_DIGEST_MISMATCH',
      'Material Field profile hint digest does not match its immutable value.',
    );
  }
  return Object.freeze({ ...value });
}

function sameProfileHintSnapshot(left, right) {
  return canonicalJson(createProfileHintSnapshot(left)) ===
    canonicalJson(createProfileHintSnapshot(right));
}

module.exports = Object.freeze({
  PROFILE_HINT_SCHEMA,
  PROFILE_HINTS,
  FieldProfileHintContractError,
  assertProfileHint,
  createProfileHintSnapshot,
  hintDigest,
  sameProfileHintSnapshot,
});
