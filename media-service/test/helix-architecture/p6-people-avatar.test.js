'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createTmdbProviderAdapter,
  TmdbProviderAdapterError,
} = require('../../src/helix/integrations/tmdb-provider-adapter');
const {
  createPeopleAvatarQuery,
  PeopleAvatarQueryError,
} = require('../../src/helix/domains/people/application/avatar-query');
const { createAdminHttpAdapter } = require('../../src/helix/composition/admin-http-adapter');

const OPERATION = 'people.registration_evidence.observe@1';
const identity = Object.freeze({ provider: 'tmdb', namespace: 'tmdb_person', providerKey: '819' });

function handle(revision = 1) {
  return Object.freeze({
    integrationId: 'tmdb-main',
    integrationType: 'tmdb',
    configRevision: revision,
    allowedOperation: OPERATION,
  });
}

function adapterFixture(fetchImpl, now = () => 1_900_000_000_000) {
  return createTmdbProviderAdapter({
    integrationQueryPort: {
      query(input) {
        return Object.freeze({
          integrationId: input.integrationId,
          integrationType: 'tmdb',
          configRevision: input.expectedConfigRevision,
          state: 'active',
          endpoint: 'https://api.themoviedb.org/3',
          secretRef: 'integration-secret:tmdb-main',
          secretKind: 'tmdb_api_key',
          settings: { language: 'zh-CN' },
        });
      },
    },
    integrationHandleResolverPort: {
      resolve(input) {
        return handle(input.configRevision);
      },
    },
    secretLeaseResolverPort: { resolve: () => Object.freeze({ leaseId: 'lease-1' }) },
    secretLeaseConsumer: {
      consumeAsync(_lease, consume) {
        const bytes = Buffer.from('tmdb-test-secret');
        return Promise.resolve(consume(bytes)).finally(() => bytes.fill(0));
      },
    },
    fetchImpl,
    now,
  });
}

function request(adapter, revision = 1, timeoutMs = 10_000) {
  return adapter.observationPort.execute({
    operationId: OPERATION,
    integrationHandle: handle(revision),
    input: { providerIdentity: identity },
    timeoutMs,
  });
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('TMDB Person avatar is fetched through w185 and cached by Integration revision plus Provider key', async () => {
  const calls = [];
  const adapter = adapterFixture(async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.hostname === 'image.tmdb.org') {
      return new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    }
    return jsonResponse({ id: 819, profile_path: '/person-819.jpg', name: 'Edward Norton' });
  });
  const first = await request(adapter, 1);
  assert.equal(first.mediaType, 'image/jpeg');
  assert.equal(first.cacheStatus, 'miss');
  assert.deepEqual(calls, ['/3/person/819', '/t/p/w185/person-819.jpg']);
  const cached = await request(adapter, 1);
  assert.equal(cached.cacheStatus, 'hit');
  assert.equal(calls.length, 2);
  const nextRevision = await request(adapter, 2);
  assert.equal(nextRevision.cacheStatus, 'miss');
  assert.equal(calls.length, 4);
});

test('TMDB Person avatar returns not-available when profile_path is null', async () => {
  const adapter = adapterFixture(async () => jsonResponse({ id: 819, profile_path: null }));
  const result = await request(adapter);
  assert.equal(result.resultKind, 'not_available');
  assert.equal(result.reasonCode, 'person_avatar_not_available');
});

test('TMDB Person avatar rejects over-limit and non-image responses', async (context) => {
  await context.test('declared payload over 4 MiB', async () => {
    const adapter = adapterFixture(async (input) => {
      if (new URL(String(input)).hostname !== 'image.tmdb.org') {
        return jsonResponse({ id: 819, profile_path: '/large.jpg' });
      }
      return new Response(Uint8Array.from([1]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg', 'content-length': String(4 * 1024 * 1024 + 1) },
      });
    });
    await assert.rejects(() => request(adapter), (error) =>
      error instanceof TmdbProviderAdapterError && error.code === 'PLATFORM_INTEGRATION_RESPONSE_BOUND');
  });
  await context.test('wrong MIME', async () => {
    const adapter = adapterFixture(async (input) => {
      if (new URL(String(input)).hostname !== 'image.tmdb.org') {
        return jsonResponse({ id: 819, profile_path: '/wrong.svg' });
      }
      return new Response('<svg/>', { status: 200, headers: { 'content-type': 'image/svg+xml' } });
    });
    await assert.rejects(() => request(adapter), (error) =>
      error instanceof TmdbProviderAdapterError && error.code === 'PLATFORM_TMDB_PERSON_AVATAR_MEDIA_TYPE_INVALID');
  });
});

test('TMDB Person avatar enforces its bounded timeout', async () => {
  const adapter = adapterFixture(async (input, init) => {
    if (new URL(String(input)).hostname !== 'image.tmdb.org') {
      return jsonResponse({ id: 819, profile_path: '/slow.jpg' });
    }
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  });
  await assert.rejects(() => request(adapter, 1, 500), (error) =>
    error instanceof TmdbProviderAdapterError && error.code === 'PLATFORM_INTEGRATION_TIMEOUT');
});

test('People avatar lookup is limited to active registered TMDB Persons', async () => {
  const active = Object.freeze({
    personId: 'person-1',
    status: 'active',
    revision: Object.freeze({ providerIdentities: Object.freeze([identity]) }),
  });
  const query = createPeopleAvatarQuery({
    store: { getPerson: (personId) => personId === 'person-1' ? active : undefined },
    readProviderAvatar: async (providerIdentity) => Object.freeze({
      resultKind: 'acquired', mediaType: 'image/webp', bytes: Buffer.from([1, 2]), providerIdentity,
    }),
  });
  const result = await query.get('person-1');
  assert.equal(result.contentType, 'image/webp');
  await assert.rejects(() => query.get('missing'), (error) =>
    error instanceof PeopleAvatarQueryError && error.code === 'PEOPLE_PERSON_NOT_FOUND');
  const noIdentity = createPeopleAvatarQuery({
    store: { getPerson: () => ({ status: 'active', revision: { providerIdentities: [] } }) },
    readProviderAvatar: async () => { throw new Error('must not be called'); },
  });
  await assert.rejects(() => noIdentity.get('person-2'), (error) =>
    error instanceof PeopleAvatarQueryError && error.code === 'PEOPLE_AVATAR_IDENTITY_NOT_AVAILABLE');
});

test('Person avatar route requires an authenticated Admin session', async () => {
  const adapter = createAdminHttpAdapter({
    facades: { PeopleAdminFacade: { get_people_personid_avatar: async () => ({ body: Buffer.from([1]), contentType: 'image/png' }) } },
    sessionTokens: {
      authenticate() {
        const error = new Error('Admin session is required.');
        error.code = 'ADMIN_SESSION_REQUIRED';
        throw error;
      },
    },
  });
  await assert.rejects(() => adapter.dispatch({
    method: 'GET', path: '/v1/admin/people/person-1/avatar', nowMs: 1, correlationId: 'test-correlation',
  }), (error) => error.code === 'ADMIN_SESSION_REQUIRED');
});
