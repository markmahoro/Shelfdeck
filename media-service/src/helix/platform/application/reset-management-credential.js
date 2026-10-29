'use strict';

const crypto = require('node:crypto');
const { canonicalJson, canonicalDigest } = require('../../contracts/canonical-json');
const SCHEMA = 'platform.reset-management-credential@1';
const SHA = /^[a-f0-9]{64}$/;
function fail() { throw Object.assign(new Error('Reset management credential authority is invalid.'), { code: 'RESET_MANAGEMENT_AUTHORITY_INVALID' }); }
function signature(body, secret) { return crypto.createHmac('sha256', secret).update(canonicalJson(body)).digest('hex'); }
function credentialDigest(value) { return canonicalDigest({ credentialId: value.credentialId, revision: value.revision, apiKeyDigest: value.apiKeyDigest }); }

// Platform captures this from an already verified active credential before
// closing its Repository. The durable descriptor contains no credential or
// signing Secret and grants only the stopped Reset management surface.
function captureResetManagementCredential(credential, generationId) {
  if (!SHA.test(generationId || '') || credential?.credentialId !== 'admin-primary' ||
      !Number.isSafeInteger(credential.revision) || credential.revision < 1 || !SHA.test(credential.apiKeyDigest || '') ||
      typeof credential.signingSecret !== 'string' || !credential.signingSecret)
    fail();
  const body = { schemaRef: SCHEMA, scope: 'stopped_reset_management', generationId,
    credentialId: credential.credentialId, revision: credential.revision, credentialDigest: credentialDigest(credential) };
  return Object.freeze({ ...body, authorizationDigest: signature(body, credential.signingSecret) });
}

function createResetManagementCredentialReader({ descriptor, secretStore, assertStoppedGeneration }) {
  if (typeof secretStore?.read !== 'function' || typeof assertStoppedGeneration !== 'function' || !descriptor) fail();
  const frozen = Object.freeze({ ...descriptor });
  return function readCredential() {
    const { authorizationDigest, ...body } = frozen;
    if (body.schemaRef !== SCHEMA || body.scope !== 'stopped_reset_management' || !SHA.test(body.generationId || '') ||
        body.credentialId !== 'admin-primary' || !Number.isSafeInteger(body.revision) || body.revision < 1 || !SHA.test(authorizationDigest || '') ||
        !SHA.test(body.credentialDigest || '') ||
        Object.keys(body).sort().join(',') !== 'credentialDigest,credentialId,generationId,revision,schemaRef,scope') fail();
    assertStoppedGeneration(body.generationId);
    const credential = secretStore.read('file:admin-credential-secret.json');
    if (credential.credentialId !== body.credentialId || credential.revision !== body.revision ||
        credentialDigest(credential) !== body.credentialDigest ||
        !crypto.timingSafeEqual(Buffer.from(signature(body, credential.signingSecret)), Buffer.from(authorizationDigest))) fail();
    return Object.freeze({ credentialId: credential.credentialId, revision: credential.revision,
      apiKeyDigest: credential.apiKeyDigest, signingSecret: credential.signingSecret });
  };
}

module.exports = Object.freeze({ captureResetManagementCredential, createResetManagementCredentialReader });
