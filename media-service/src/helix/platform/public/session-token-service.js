'use strict';

const crypto = require('node:crypto');

const MAX_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MIN_SESSION_TTL_MS = 60 * 1000;
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function digestApiKey(apiKey) {
  if (typeof apiKey !== 'string' || apiKey.length < 24 || apiKey.length > 512) {
    fail('ADMIN_CREDENTIAL_INVALID');
  }
  return crypto.createHash('sha256').update(apiKey, 'utf8').digest('hex');
}

function equalText(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createSessionTokenService(options) {
  if (!options || typeof options.readActiveCredential !== 'function') {
    throw new TypeError('Active Admin credential reader is required.');
  }
  const credential = () => options.readActiveCredential();

  function verifyApiKey(apiKey) {
    const current = credential();
    if (!current || !equalText(digestApiKey(apiKey), current.apiKeyDigest)) {
      fail('ADMIN_CREDENTIAL_INVALID');
    }
    return Object.freeze({
      actorType: 'admin_owner',
      actorId: current.credentialId,
      credentialRevision: current.revision,
    });
  }

  function issueAuthenticated(value) {
    const current = credential();
    if (
      !current ||
      value.credentialRevision !== current.revision ||
      !Number.isSafeInteger(value.nowMs) ||
      !Number.isSafeInteger(value.ttlMs) ||
      value.ttlMs < MIN_SESSION_TTL_MS ||
      value.ttlMs > MAX_SESSION_TTL_MS ||
      typeof value.nonce !== 'string' ||
      value.nonce.length < 8 ||
      value.nonce.length > 256
    ) {
      fail('ADMIN_SESSION_ISSUE_INVALID');
    }
    const payload = {
      credentialRevision: current.revision,
      issuedAt: value.nowMs,
      expiresAt: value.nowMs + value.ttlMs,
      nonce: value.nonce,
    };
    const body = encode(payload);
    const signature = crypto
      .createHmac('sha256', current.signingSecret)
      .update(body)
      .digest('base64url');
    return body + '.' + signature;
  }

  function issue(value) {
    const actor = verifyApiKey(value.apiKey);
    return issueAuthenticated({ ...value, credentialRevision: actor.credentialRevision });
  }

  function verify(token, nowMs) {
    const [body, signature, extra] = String(token || '').split('.');
    if (!body || !signature || extra) fail('ADMIN_SESSION_INVALID');
    const current = credential();
    if (!current) fail('ADMIN_SESSION_INVALID');
    const expected = crypto
      .createHmac('sha256', current.signingSecret)
      .update(body)
      .digest('base64url');
    if (!equalText(signature, expected)) fail('ADMIN_SESSION_INVALID');
    let payload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch (_error) {
      fail('ADMIN_SESSION_INVALID');
    }
    if (
      payload.credentialRevision !== current.revision ||
      !Number.isSafeInteger(nowMs) ||
      nowMs >= payload.expiresAt
    ) {
      fail('ADMIN_SESSION_EXPIRED');
    }
    return Object.freeze({
      actorType: 'admin_owner',
      actorId: current.credentialId,
      credentialRevision: current.revision,
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt,
    });
  }

  function authenticate(value) {
    if (value.apiKey) return verifyApiKey(value.apiKey);
    return verify(value.sessionToken, value.nowMs);
  }

  return Object.freeze({
    authenticate,
    issue,
    issueAuthenticated,
    verify,
    verifyApiKey,
  });
}

module.exports = Object.freeze({
  MAX_SESSION_TTL_MS,
  MIN_SESSION_TTL_MS,
  createSessionTokenService,
});
