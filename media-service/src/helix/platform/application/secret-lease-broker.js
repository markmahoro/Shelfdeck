'use strict';

const MAX_LEASE_MS = 60_000;

class SecretLeaseError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SecretLeaseError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new SecretLeaseError(code, message, details);
}

function createSecretLeaseBroker(options) {
  if (!options || !options.repository || typeof options.repository.find !== 'function' ||
      !options.secretSource || typeof options.secretSource.read !== 'function' ||
      !options.purposePolicy || typeof options.purposePolicy.allows !== 'function' ||
      typeof options.now !== 'function' || typeof options.createId !== 'function' || typeof options.digest !== 'function') {
    fail('P5_SECRET_LEASE_INVALID_DEPENDENCIES', 'Explicit repository, secret source, clock, ID and digest dependencies are required.');
  }
  const leases = new Map();

  function issue(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) fail('P5_SECRET_LEASE_REQUEST_REQUIRED', 'Secret lease request is required.');
    const required = ['secretRef', 'ownerScopeType', 'ownerScopeId', 'secretKind', 'expectedRevision', 'purpose', 'ttlMs'];
    if (JSON.stringify(Object.keys(request).sort()) !== JSON.stringify([...required].sort())) {
      fail('P5_SECRET_LEASE_REQUEST_SHAPE', 'Secret lease request must match the exact contract.');
    }
    if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 1 ||
        !Number.isSafeInteger(request.ttlMs) || request.ttlMs < 1 || request.ttlMs > MAX_LEASE_MS ||
        typeof request.purpose !== 'string' || request.purpose.length < 1 || request.purpose.length > 128) {
      fail('P5_SECRET_LEASE_REQUEST_INVALID', 'Secret lease revision, purpose, or lifetime is invalid.');
    }
    const reference = options.repository.find(request.secretRef);
    if (!reference || reference.state !== 'active') fail('P5_SECRET_LEASE_UNAVAILABLE', 'Secret Reference is unavailable.');
    const exact = reference.ownerScopeType === request.ownerScopeType && reference.ownerScopeId === request.ownerScopeId &&
      reference.secretKind === request.secretKind && reference.revision === request.expectedRevision;
    if (!exact) fail('P5_SECRET_LEASE_SCOPE_MISMATCH', 'Secret lease scope or revision does not match.');
    if (options.purposePolicy.allows(Object.freeze({
      ownerScopeType: reference.ownerScopeType, ownerScopeId: reference.ownerScopeId,
      secretKind: reference.secretKind, purpose: request.purpose
    })) !== true) fail('P5_SECRET_LEASE_PURPOSE_DENIED', 'Secret lease purpose is not allowed for this exact scope.');
    const issuedAtMs = options.now();
    if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs < 0) fail('P5_SECRET_LEASE_TIME', 'Secret lease clock is invalid.');
    const handleId = options.createId();
    const expiresAtMs = issuedAtMs + request.ttlMs;
    if (typeof handleId !== 'string' || handleId.length < 1 || handleId.length > 256 || leases.has(handleId) ||
        !Number.isSafeInteger(expiresAtMs)) fail('P5_SECRET_LEASE_IDENTITY', 'Secret lease identity or expiry is invalid.');
    const fenceDigest = options.digest(JSON.stringify({
      secretRef: reference.secretRef, revision: reference.revision, ownerScopeType: reference.ownerScopeType,
      ownerScopeId: reference.ownerScopeId, secretKind: reference.secretKind, purpose: request.purpose, expiresAtMs
    }));
    if (typeof fenceDigest !== 'string' || !/^[0-9a-f]{64}$/.test(fenceDigest)) {
      fail('P5_SECRET_LEASE_FENCE_DIGEST', 'Secret lease fence digest is invalid.');
    }
    const handle = Object.freeze({
      schemaRef: 'helix://contracts/ports/platform.secret-lease.resolve/v1/output', schemaVersion: 1,
      handleId, secretRef: reference.secretRef, ownerScopeType: reference.ownerScopeType,
      ownerScopeId: reference.ownerScopeId, secretKind: reference.secretKind, purpose: request.purpose,
      revision: reference.revision, issuedAtMs, expiresAtMs, fenceDigest
    });
    leases.set(handleId, Object.freeze({ handle, secretLocator: reference.secretLocator, consumed: false }));
    return handle;
  }

  function consume(handle, consumer) {
    if (!handle || typeof consumer !== 'function') fail('P5_SECRET_LEASE_CONSUMER_REQUIRED', 'Secret lease handle and consumer are required.');
    const lease = leases.get(handle.handleId);
    if (!lease || lease.handle !== handle) fail('P5_SECRET_LEASE_UNKNOWN', 'Secret lease is unknown or already consumed.');
    leases.delete(handle.handleId);
    const consumedAtMs = options.now();
    if (!Number.isSafeInteger(consumedAtMs) || consumedAtMs < 0) fail('P5_SECRET_LEASE_TIME', 'Secret lease clock is invalid.');
    if (consumedAtMs > handle.expiresAtMs) fail('P5_SECRET_LEASE_EXPIRED', 'Secret lease has expired.');
    let bytes;
    try {
      bytes = options.secretSource.read(lease.secretLocator);
    } catch (error) {
      fail('P5_SECRET_SOURCE_READ_FAILED', 'Secret source could not satisfy the bounded invocation.');
    }
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) fail('P5_SECRET_SOURCE_INVALID_RESULT', 'Secret source must return non-empty owned bytes.');
    try {
      const result = consumer(bytes);
      if (result && typeof result.then === 'function') fail('P5_SECRET_LEASE_ASYNC_CONSUMER', 'Secret lease consumer must complete synchronously.');
      return result;
    } catch (error) {
      if (error instanceof SecretLeaseError) throw error;
      fail('P5_SECRET_LEASE_INVOCATION_FAILED', 'Secret-backed invocation failed.');
    } finally {
      bytes.fill(0);
    }
  }

  async function consumeAsync(handle, consumer) {
    if (!handle || typeof consumer !== 'function') fail('P5_SECRET_LEASE_CONSUMER_REQUIRED', 'Secret lease handle and consumer are required.');
    const lease = leases.get(handle.handleId);
    if (!lease || lease.handle !== handle) fail('P5_SECRET_LEASE_UNKNOWN', 'Secret lease is unknown or already consumed.');
    leases.delete(handle.handleId);
    const consumedAtMs = options.now();
    if (!Number.isSafeInteger(consumedAtMs) || consumedAtMs < 0) fail('P5_SECRET_LEASE_TIME', 'Secret lease clock is invalid.');
    if (consumedAtMs > handle.expiresAtMs) fail('P5_SECRET_LEASE_EXPIRED', 'Secret lease has expired.');
    let bytes;
    try {
      bytes = options.secretSource.read(lease.secretLocator);
    } catch (error) {
      fail('P5_SECRET_SOURCE_READ_FAILED', 'Secret source could not satisfy the bounded invocation.');
    }
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) fail('P5_SECRET_SOURCE_INVALID_RESULT', 'Secret source must return non-empty owned bytes.');
    try {
      return await consumer(bytes);
    } catch (error) {
      if (error instanceof SecretLeaseError) throw error;
      fail('P5_SECRET_LEASE_INVOCATION_FAILED', 'Secret-backed invocation failed.');
    } finally {
      bytes.fill(0);
    }
  }

  return Object.freeze({ issue, consume, consumeAsync });
}

module.exports = Object.freeze({ MAX_LEASE_MS, SecretLeaseError, createSecretLeaseBroker });
