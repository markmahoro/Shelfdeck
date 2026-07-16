'use strict';

const OWNER_SCOPE_TYPES = new Set(['integration', 'worker', 'admin_credential']);
const STATES = new Set(['active', 'rotated', 'revoked']);
const TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/;

class SecretReferenceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SecretReferenceError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new SecretReferenceError(code, message, details);
}

function token(value, field) {
  if (typeof value !== 'string' || !TOKEN.test(value)) fail('P5_SECRET_REFERENCE_INVALID_FIELD', 'Secret Reference field is invalid.', { field });
  return value;
}

function createSecretReference(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('P5_SECRET_REFERENCE_REQUIRED', 'Secret Reference metadata is required.');
  const keys = Object.keys(value).sort();
  const expected = ['ownerScopeId', 'ownerScopeType', 'revision', 'secretKind', 'secretLocator', 'secretRef', 'state', 'updatedAtMs'].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) fail('P5_SECRET_REFERENCE_SHAPE', 'Secret Reference metadata must match the exact contract.');
  if (!OWNER_SCOPE_TYPES.has(value.ownerScopeType)) fail('P5_SECRET_REFERENCE_OWNER_SCOPE', 'Secret Reference owner scope is invalid.');
  if (!STATES.has(value.state)) fail('P5_SECRET_REFERENCE_STATE', 'Secret Reference state is invalid.');
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) fail('P5_SECRET_REFERENCE_REVISION', 'Secret Reference revision must be positive.');
  if (!Number.isSafeInteger(value.updatedAtMs) || value.updatedAtMs < 0) fail('P5_SECRET_REFERENCE_TIME', 'Secret Reference update time is invalid.');
  return Object.freeze({
    secretRef: token(value.secretRef, 'secretRef'),
    ownerScopeType: value.ownerScopeType,
    ownerScopeId: token(value.ownerScopeId, 'ownerScopeId'),
    secretKind: token(value.secretKind, 'secretKind'),
    secretLocator: token(value.secretLocator, 'secretLocator'),
    revision: value.revision,
    state: value.state,
    updatedAtMs: value.updatedAtMs
  });
}

module.exports = Object.freeze({ SecretReferenceError, createSecretReference });
