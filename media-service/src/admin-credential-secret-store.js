'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  CREDENTIAL_ID,
  SECRET_REF,
} = require('./helix/platform/application/admin-credential-runtime');

const SECRET_FILE_NAME = 'admin-credential-secret.json';
const SECRET_SCHEMA = 'helix-admin-credential-secret@1';

class AdminCredentialSecretStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AdminCredentialSecretStoreError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new AdminCredentialSecretStoreError(code, message, details);
}

function apiKeyDigest(apiKey) {
  if (typeof apiKey !== 'string' || apiKey.length < 24 || apiKey.length > 512) {
    fail('ADMIN_CREDENTIAL_FORMAT_INVALID', 'Admin credential must be a bounded secret string.');
  }
  return crypto.createHash('sha256').update(apiKey, 'utf8').digest('hex');
}

function encryptionKey(secretRoot) {
  if (typeof secretRoot !== 'string' || Buffer.byteLength(secretRoot, 'utf8') < 32) {
    fail('ADMIN_SECRET_ROOT_REQUIRED', 'SHELFDECK_SECRET_ROOT must provide at least 32 UTF-8 bytes.');
  }
  return crypto.createHash('sha256').update(secretRoot, 'utf8').digest();
}

function aad(credentialId, revision) {
  return Buffer.from([SECRET_SCHEMA, credentialId, revision].join(':'), 'utf8');
}

function filePath(dataDir, secretRef = SECRET_REF) {
  if (secretRef !== SECRET_REF) {
    fail('ADMIN_SECRET_REFERENCE_INVALID', 'Admin credential uses an unexpected Secret Handle.');
  }
  const root = path.resolve(dataDir);
  const resolved = path.resolve(root, SECRET_FILE_NAME);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    fail('ADMIN_SECRET_REFERENCE_ESCAPE', 'Admin credential Secret Handle escapes the data root.');
  }
  return resolved;
}

function createEnvelope(options) {
  const nonce = options.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(options.secretRoot), nonce);
  cipher.setAAD(aad(CREDENTIAL_ID, options.revision));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ signingSecret: options.signingSecret }), 'utf8'),
    cipher.final(),
  ]);
  return Object.freeze({
    schema: SECRET_SCHEMA,
    credentialId: CREDENTIAL_ID,
    revision: options.revision,
    apiKeyDigest: apiKeyDigest(options.apiKey),
    nonce: nonce.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    authenticationTag: cipher.getAuthTag().toString('base64url'),
    createdAtMs: options.createdAtMs,
  });
}

function writeAdminCredentialSecret(options) {
  const envelope = createEnvelope({
    ...options,
    randomBytes: options.randomBytes || crypto.randomBytes,
  });
  const target = filePath(options.dataDir);
  fs.writeFileSync(target, JSON.stringify(envelope, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  fs.chmodSync(target, 0o600);
  return Object.freeze({ secretRef: SECRET_REF, envelope });
}

function createAdminCredentialSecretStore(options) {
  if (!options || typeof options.dataDir !== 'string') {
    throw new TypeError('Admin credential Secret Store data root is required.');
  }
  return Object.freeze({
    read(secretRef) {
      let envelope;
      try {
        envelope = JSON.parse(fs.readFileSync(filePath(options.dataDir, secretRef), 'utf8'));
      } catch (error) {
        if (error instanceof AdminCredentialSecretStoreError) throw error;
        fail('ADMIN_SECRET_ENVELOPE_UNAVAILABLE', 'Admin credential secret envelope is unavailable.');
      }
      if (
        !envelope ||
        envelope.schema !== SECRET_SCHEMA ||
        envelope.credentialId !== CREDENTIAL_ID ||
        !Number.isSafeInteger(envelope.revision) ||
        !/^[0-9a-f]{64}$/.test(envelope.apiKeyDigest || '')
      ) {
        fail('ADMIN_SECRET_ENVELOPE_INVALID', 'Admin credential secret envelope is invalid.');
      }
      try {
        const decipher = crypto.createDecipheriv(
          'aes-256-gcm',
          encryptionKey(options.secretRoot),
          Buffer.from(envelope.nonce, 'base64url'),
        );
        decipher.setAAD(aad(envelope.credentialId, envelope.revision));
        decipher.setAuthTag(Buffer.from(envelope.authenticationTag, 'base64url'));
        const plaintext = Buffer.concat([
          decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
          decipher.final(),
        ]);
        const value = JSON.parse(plaintext.toString('utf8'));
        if (typeof value.signingSecret !== 'string' || value.signingSecret.length < 32) {
          fail('ADMIN_SIGNING_SECRET_INVALID', 'Admin session signing secret is invalid.');
        }
        return Object.freeze({
          credentialId: envelope.credentialId,
          revision: envelope.revision,
          apiKeyDigest: envelope.apiKeyDigest,
          signingSecret: value.signingSecret,
        });
      } catch (error) {
        if (error instanceof AdminCredentialSecretStoreError) throw error;
        fail('ADMIN_SECRET_DECRYPTION_FAILED', 'Admin credential secret cannot be authenticated.');
      }
    },
  });
}

module.exports = Object.freeze({
  AdminCredentialSecretStoreError,
  apiKeyDigest,
  createAdminCredentialSecretStore,
  writeAdminCredentialSecret,
});
