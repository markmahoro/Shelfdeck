'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const { createSecretLeaseBroker, MAX_LEASE_MS } = require('../../src/helix/platform/application/secret-lease-broker');
const { createSecretReferenceRepository } = require('../../src/helix/platform/persistence/secret-reference-repository');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-secret-lease-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  let now = 1_700_000_000_000;
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => now });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const repository = createSecretReferenceRepository({ schemaManifest, unitOfWork });
  const sourceValues = new Map([['testvault:entry-1', Buffer.from('synthetic-secret')]]);
  let issued = 0;
  const broker = createSecretLeaseBroker({
    repository,
    now: () => now,
    createId: () => `lease-${++issued}`,
    digest,
    purposePolicy: { allows: ({ ownerScopeId, secretKind, purpose }) =>
      ownerScopeId === 'integration-1' && secretKind === 'access-token' && purpose === 'metadata-query' },
    secretSource: { read: (locator) => Buffer.from(sourceValues.get(locator)) }
  });
  const cleanup = () => {
    kernel.close();
    fs.rmSync(root, { recursive: true, force: true });
  };
  try {
    const result = run({ broker, databasePath, repository, setNow: (value) => { now = value; } });
    if (result && typeof result.then === 'function') return result.finally(cleanup);
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

const activeReference = Object.freeze({
  secretRef: 'secret-ref-1', ownerScopeType: 'integration', ownerScopeId: 'integration-1',
  secretKind: 'access-token', secretLocator: 'testvault:entry-1', revision: 3, state: 'active',
  updatedAtMs: 1_700_000_000_000
});
const exactRequest = Object.freeze({
  secretRef: 'secret-ref-1', ownerScopeType: 'integration', ownerScopeId: 'integration-1',
  secretKind: 'access-token', expectedRevision: 3, purpose: 'metadata-query', ttlMs: 5000
});

test('persists only opaque metadata and issues a bounded handle without secret material', () => {
  fixture(({ broker, databasePath, repository }) => {
    repository.save(activeReference);
    const handle = broker.issue(exactRequest);
    assert.equal(Object.isFrozen(handle), true);
    assert.equal(handle.revision, 3);
    assert.equal(handle.expiresAtMs - handle.issuedAtMs, 5000);
    assert.equal(JSON.stringify(handle).includes('synthetic-secret'), false);
    assert.equal(JSON.stringify(handle).includes(activeReference.secretLocator), false);

    const inspected = new Database(databasePath, { readonly: true });
    const row = inspected.prepare('SELECT * FROM platform_secret_refs WHERE secret_ref=?').get(activeReference.secretRef);
    inspected.close();
    assert.equal(JSON.stringify(row).includes('synthetic-secret'), false);
    assert.equal(row.encrypted_ref, activeReference.secretLocator);
  });
});

test('consumes one exact lease once and wipes the owned byte buffer', () => {
  fixture(({ broker, repository }) => {
    repository.save(activeReference);
    const handle = broker.issue(exactRequest);
    let retained;
    const result = broker.consume(handle, (bytes) => {
      retained = bytes;
      assert.equal(bytes.toString('utf8'), 'synthetic-secret');
      return Object.freeze({ accepted: true });
    });
    assert.deepEqual(result, { accepted: true });
    assert.ok(retained.every((value) => value === 0));
    assert.throws(() => broker.consume(handle, () => null), (error) => error.code === 'P5_SECRET_LEASE_UNKNOWN');
  });
});

test('fails closed for wrong scope, stale revision, inactive reference, expiry, and excessive lifetime', () => {
  fixture(({ broker, repository, setNow }) => {
    repository.save(activeReference);
    for (const replacement of [
      { ownerScopeId: 'integration-2' }, { secretKind: 'password' }, { expectedRevision: 2 }
    ]) {
      assert.throws(() => broker.issue({ ...exactRequest, ...replacement }), (error) => error.code === 'P5_SECRET_LEASE_SCOPE_MISMATCH');
    }
    assert.throws(() => broker.issue({ ...exactRequest, purpose: 'unapproved-operation' }),
      (error) => error.code === 'P5_SECRET_LEASE_PURPOSE_DENIED');
    assert.throws(() => broker.issue({ ...exactRequest, ttlMs: MAX_LEASE_MS + 1 }), (error) => error.code === 'P5_SECRET_LEASE_REQUEST_INVALID');
    const handle = broker.issue({ ...exactRequest, ttlMs: 1 });
    setNow(handle.expiresAtMs + 1);
    assert.throws(() => broker.consume(handle, () => null), (error) => error.code === 'P5_SECRET_LEASE_EXPIRED');
  });

  fixture(({ broker, repository }) => {
    repository.save({ ...activeReference, state: 'revoked' });
    assert.throws(() => broker.issue(exactRequest), (error) => error.code === 'P5_SECRET_LEASE_UNAVAILABLE');
  });
});

test('does not leak invocation failures and rejects asynchronous secret retention', () => {
  fixture(({ broker, repository }) => {
    repository.save(activeReference);
    const first = broker.issue(exactRequest);
    assert.throws(
      () => broker.consume(first, (bytes) => { throw new Error(bytes.toString('utf8')); }),
      (error) => error.code === 'P5_SECRET_LEASE_INVOCATION_FAILED' && !error.message.includes('synthetic-secret')
    );
    const second = broker.issue(exactRequest);
    assert.throws(() => broker.consume(second, async () => null), (error) => error.code === 'P5_SECRET_LEASE_ASYNC_CONSUMER');
  });
});

test('bounded asynchronous invocation holds one lease until settlement and always wipes bytes', async () => {
  await fixture(async ({ broker, repository }) => {
    repository.save(activeReference);
    const handle = broker.issue(exactRequest);
    let retained;
    const result = await broker.consumeAsync(handle, async (bytes) => {
      retained = bytes;
      await Promise.resolve();
      assert.equal(bytes.toString('utf8'), 'synthetic-secret');
      return Object.freeze({ requestId: 'provider-request-1' });
    });
    assert.deepEqual(result, { requestId: 'provider-request-1' });
    assert.ok(retained.every((value) => value === 0));
    assert.throws(() => broker.consume(handle, () => null), (error) => error.code === 'P5_SECRET_LEASE_UNKNOWN');
  });
});

test('bounded asynchronous invocation redacts failure and wipes bytes', async () => {
  await fixture(async ({ broker, repository }) => {
    repository.save(activeReference);
    const handle = broker.issue(exactRequest);
    let retained;
    await assert.rejects(() => broker.consumeAsync(handle, async (bytes) => {
      retained = bytes;
      throw new Error(bytes.toString('utf8'));
    }), (error) => error.code === 'P5_SECRET_LEASE_INVOCATION_FAILED' && !error.message.includes('synthetic-secret'));
    assert.ok(retained.every((value) => value === 0));
  });
});

test('implementation has no ambient environment access or secret serialization field', () => {
  const sources = [
    path.resolve(__dirname, '../../src/helix/platform/application/secret-lease-broker.js'),
    path.resolve(__dirname, '../../src/helix/platform/persistence/secret-reference-repository.js')
  ].map((file) => fs.readFileSync(file, 'utf8'));
  assert.equal(sources.some((source) => source.includes('process.env')), false);
  assert.equal(sources.some((source) => /secret(Value|Bytes)|password\s*:/.test(source)), false);
});
