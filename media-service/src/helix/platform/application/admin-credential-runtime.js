'use strict';

const CREDENTIAL_ID = 'admin-primary';
const SECRET_REF = 'file:admin-credential-secret.json';

class AdminCredentialRuntimeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AdminCredentialRuntimeError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new AdminCredentialRuntimeError(code, message, details);
}

function readCredential(repository, secretStore) {
  const snapshot = repository.readActiveSnapshot();
  if (
    !snapshot.marker ||
    snapshot.marker.schema_name !== snapshot.expected.schemaName ||
    snapshot.marker.generation !== snapshot.expected.generation ||
    snapshot.marker.schema_digest !== snapshot.expected.schemaDigest
  ) {
    fail('SCHEMA_GENERATION_MISMATCH', 'Clean schema marker does not match the frozen runtime.');
  }
  if (snapshot.credentials.length !== 1) {
    fail(
      'ADMIN_ACTIVE_CREDENTIAL_CARDINALITY',
      'Clean service requires exactly one active Admin credential.',
      { count: snapshot.credentials.length },
    );
  }
  const credential = snapshot.credentials[0];
  if (credential.credential_id !== CREDENTIAL_ID) {
    fail('ADMIN_CREDENTIAL_ID_INVALID', 'Active Admin credential identity is invalid.');
  }
  const reference = snapshot.reference;
  if (
    !reference ||
    reference.owner_scope_type !== 'admin_credential' ||
    reference.owner_scope_id !== CREDENTIAL_ID ||
    reference.secret_kind !== 'admin_api_key' ||
    reference.revision !== credential.revision ||
    reference.state !== 'active' ||
    reference.encrypted_ref !== SECRET_REF
  ) {
    fail('ADMIN_SECRET_REFERENCE_MISMATCH', 'Admin credential and Secret Handle are inconsistent.');
  }
  const secret = secretStore.read(reference.encrypted_ref);
  if (secret.credentialId !== CREDENTIAL_ID || secret.revision !== credential.revision) {
    fail('ADMIN_SECRET_REVISION_MISMATCH', 'Admin credential and encrypted secret revisions differ.');
  }
  return Object.freeze({
    credentialId: credential.credential_id,
    revision: credential.revision,
    apiKeyDigest: secret.apiKeyDigest,
    signingSecret: secret.signingSecret,
    createdAtMs: credential.created_at_ms,
    lastUsedAtMs: credential.last_used_at_ms,
  });
}

function createAdminCredentialRuntime(options) {
  if (
    !options ||
    !options.repository ||
    typeof options.repository.readActiveSnapshot !== 'function' ||
    !options.secretStore ||
    typeof options.secretStore.read !== 'function' ||
    !options.readinessBasis
  ) {
    throw new TypeError('Admin credential Repository, Secret Store, and readiness basis are required.');
  }

  function inspectReadiness() {
    const findings = [...options.readinessBasis.findings];
    try {
      readCredential(options.repository, options.secretStore);
    } catch (error) {
      findings.push(error.code || 'ADMIN_CREDENTIAL_RUNTIME_UNAVAILABLE');
    }
    return Object.freeze({
      state: findings.length ? 'not_ready' : 'ready',
      generation: options.readinessBasis.generation,
      tableCount: options.readinessBasis.tableCount,
      routeCount: options.readinessBasis.routeCount,
      uiSurfaceCount: options.readinessBasis.uiSurfaceCount,
      findings: Object.freeze([...new Set(findings)]),
    });
  }

  return Object.freeze({
    inspectReadiness,
    readActiveCredential: () => readCredential(options.repository, options.secretStore),
  });
}

module.exports = Object.freeze({
  AdminCredentialRuntimeError,
  CREDENTIAL_ID,
  SECRET_REF,
  createAdminCredentialRuntime,
});
