'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { createAdminCredentialSecretStore, writeAdminCredentialSecret } = require('../src/admin-credential-secret-store');
const { createAdminCredentialRuntime, createResetManagementCredentialReader } = require('../src/helix/platform/public/admin-credential-runtime');
const { createSessionTokenService } = require('../src/helix/platform/public/session-token-service');

function fixture(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-management-auth-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const secretRoot = 'isolated-management-root-' + crypto.randomBytes(32).toString('hex');
  const apiKey = 'isolated-' + crypto.randomBytes(32).toString('hex'), signingSecret = crypto.randomBytes(48).toString('hex');
  writeAdminCredentialSecret({ dataDir, secretRoot, revision: 1, apiKey, signingSecret, createdAtMs: 1 });
  const secretStore = createAdminCredentialSecretStore({ dataDir, secretRoot });
  let open = true, stopped = true;
  const runtime = createAdminCredentialRuntime({ secretStore, readinessBasis: { findings: [] }, repository: {
    readActiveSnapshot() {
      assert.equal(open, true, 'closed business Repository must not be read');
      return { marker: { schema_name: 'test', generation: 'test', schema_digest: 'test' },
        expected: { schemaName: 'test', generation: 'test', schemaDigest: 'test' },
        credentials: [{ credential_id: 'admin-primary', revision: 1 }],
        reference: { owner_scope_type: 'admin_credential', owner_scope_id: 'admin-primary', secret_kind: 'admin_api_key',
          revision: 1, state: 'active', encrypted_ref: 'file:admin-credential-secret.json' } };
    },
  } });
  const generationId = 'a'.repeat(64), descriptor = runtime.captureResetManagementCredential(generationId);
  function reader(value = descriptor) {
    return createResetManagementCredentialReader({ descriptor: value, secretStore, assertStoppedGeneration(generation) {
      if (!stopped || generation !== generationId) throw Object.assign(new Error('stopped generation changed'), { code: 'RESET_AUTH_GENERATION_CHANGED' });
    } });
  }
  return { apiKey, signingSecret, descriptor, runtime, reader, dataDir, close() { open = false; }, resume() { stopped = false; } };
}

test('Platform grants stopped management authentication without persisting secrets or reopening a business Repository', t => {
  const f = fixture(t), now = Date.now();
  const sessions = createSessionTokenService({ readActiveCredential: f.runtime.readActiveCredential });
  const token = sessions.issue({ apiKey: f.apiKey, nowMs: now, ttlMs: 60000, nonce: 'isolated-session-nonce' });
  const serialized = JSON.stringify(f.descriptor);
  assert.equal(serialized.includes(f.apiKey), false); assert.equal(serialized.includes(f.signingSecret), false);
  f.close();
  const coldSessions = createSessionTokenService({ readActiveCredential: f.reader(JSON.parse(serialized)) });
  assert.equal(coldSessions.verify(token, now + 1).actorId, 'admin-primary');
  assert.equal(coldSessions.verifyApiKey(f.apiKey).actorId, 'admin-primary');
  f.resume();
  assert.throws(() => coldSessions.verify(token, now + 2), { code: 'RESET_AUTH_GENERATION_CHANGED' });
});

test('generation, scope, revision or signature edits cannot widen a frozen management grant', t => {
  const f = fixture(t); f.close();
  for (const changes of [{ scope: 'business_runtime' }, { revision: 2 }, { authorizationDigest: 'b'.repeat(64) },
    { credentialDigest: 'c'.repeat(64) }, { extra: true }]) {
    assert.throws(f.reader({ ...f.descriptor, ...changes }), { code: 'RESET_MANAGEMENT_AUTHORITY_INVALID' });
  }
  assert.throws(f.reader({ ...f.descriptor, generationId: 'b'.repeat(64) }), { code: 'RESET_AUTH_GENERATION_CHANGED' });
});

test('changing the encrypted credential file API digest revokes even a formerly valid frozen grant', t => {
  const f = fixture(t), file = path.join(f.dataDir, 'admin-credential-secret.json'); f.close();
  const envelope = JSON.parse(fs.readFileSync(file, 'utf8')); envelope.apiKeyDigest = 'f'.repeat(64);
  fs.writeFileSync(file, JSON.stringify(envelope));
  assert.throws(f.reader(), { code: 'RESET_MANAGEMENT_AUTHORITY_INVALID' });
});
