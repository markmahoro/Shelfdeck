'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const {
  initializeCleanData,
} = require('../../scripts/helix-operational-safety');
const {
  createCleanServiceHost,
  createIntegrationSecretStore,
  createPlatformIntegrationServices,
} = require('../../src/clean-service-host');
const {
  canonicalDigest,
} = require('../../src/helix/contracts/canonical-json');
const {
  openSqliteKernel,
} = require('../../src/helix/foundation/persistence/sqlite-kernel');
const {
  createSqliteUnitOfWork,
} = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const schemaManifest = require(
  '../../src/helix/foundation/persistence/generated/clean-schema.manifest.json'
);

const serviceRoot = path.resolve(__dirname, '../..');
const schemaDdl = fs.readFileSync(
  path.join(
    serviceRoot,
    'src/helix/foundation/persistence/generated/clean-schema.sql',
  ),
  'utf8',
);
const secretRoot = 'h1-tmdb-integration-secret-root-0123456789abcdef';
const credential = 'tmdb-test-credential-value-never-persisted';
const roots = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-h1-tmdb-'));
  roots.push(root);
  const dataDir = path.join(root, 'data');
  const adminDistDir = path.join(root, 'admin');
  fs.mkdirSync(adminDistDir, { recursive: true });
  fs.writeFileSync(
    path.join(adminDistDir, 'index.html'),
    '<!doctype html><html><body>H1</body></html>',
  );
  const initialized = initializeCleanData({
    dataDir,
    confirmation: 'INITIALIZE_HELIX_CLEAN_V1',
    secretRoot,
  });
  return { root, dataDir, adminDistDir, initialized };
}

function response(status, body, bytes) {
  return Object.freeze({
    status,
    async json() {
      if (body instanceof Error) throw body;
      return body;
    },
    async arrayBuffer() {
      return Uint8Array.from(bytes || []).buffer;
    },
  });
}

function tmdbFetch(state = {}) {
  return async (input, init) => {
    const url = new URL(String(input));
    const authorized = url.searchParams.get('api_key') === credential ||
      init?.headers?.authorization === `Bearer ${credential}`;
    if (url.hostname === 'image.tmdb.org') {
      return response(200, null, [0xff, 0xd8, 0xff, 0xd9]);
    }
    if (!authorized) return response(401, { status_code: 7 });
    state.calls ||= [];
    state.calls.push({
      pathname: url.pathname,
      hasApiKey: url.searchParams.has('api_key'),
      hasAuthorization: Boolean(init?.headers?.authorization),
    });
    if (url.pathname === '/3/configuration') {
      return response(200, {
        images: { secure_base_url: 'https://image.tmdb.org/t/p/' },
      });
    }
    if (url.pathname === '/3/search/movie') {
      return response(200, {
        results: [{ id: 550, title: 'Fight Club' }],
      });
    }
    if (url.pathname === '/3/movie/550/images') {
      return response(200, {
        posters: [{ file_path: '/poster.jpg' }],
        backdrops: [{ file_path: '/fanart.jpg' }],
      });
    }
    if (url.pathname === '/3/movie/550') {
      return response(200, {
        id: 550,
        title: 'Fight Club',
        release_date: '1999-10-15',
        overview: 'An insomniac meets a soap maker.',
        genres: [{ id: 18, name: 'Drama' }],
        credits: {
          cast: [{ id: 819, name: 'Edward Norton' }],
          crew: [{ id: 7467, name: 'David Fincher', job: 'Director' }],
        },
      });
    }
    return response(404, { status_code: 34 });
  };
}

async function session(host, apiKey) {
  const result = await host.inject({
    method: 'POST',
    url: '/v1/admin/session',
    headers: { 'x-api-key': apiKey },
  });
  assert.equal(result.statusCode, 204, result.body);
  return result.headers['set-cookie'];
}

function command(kind, key, expectedConfigRevision = 0) {
  return {
    kind,
    idempotencyKey: key,
    expectedConfigRevision,
    endpoint: 'https://api.themoviedb.org/3',
    credential: { kind: 'api_key', value: credential },
    timeoutMs: 5_000,
  };
}

function scanFiles(root) {
  const pending = [root];
  const files = [];
  while (pending.length) {
    const current = pending.pop();
    if (!fs.existsSync(current)) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else files.push(target);
    }
  }
  return files;
}

function inspect(dataDir) {
  const database = new Database(path.join(dataDir, 'shelfdeck.db'), {
    readonly: true,
  });
  try {
    return {
      integration: database.prepare(
        'SELECT * FROM platform_integrations WHERE integration_id=?',
      ).get('tmdb-main'),
      secret: database.prepare(
        'SELECT * FROM platform_secret_refs WHERE secret_ref=?',
      ).get('integration-secret:tmdb-main'),
    };
  } finally {
    database.close();
  }
}

test.after(() => {
  for (const root of roots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H1.1 Admin TMDB routes test before save, redact secrets, CAS, and replay', async () => {
  const value = fixture();
  const state = {};
  let host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
    integrationFetch: tmdbFetch(state),
    now: () => 1_900_000_000_000,
  });
  const cookie = await session(host, value.initialized.adminApiKey);

  const unauthorized = await host.inject({
    method: 'GET',
    url: '/v1/admin/settings/integrations/tmdb',
  });
  assert.equal(unauthorized.statusCode, 401);

  const initial = await host.inject({
    method: 'GET',
    url: '/v1/admin/settings/integrations/tmdb',
    headers: { cookie },
  });
  assert.equal(initial.statusCode, 200, initial.body);
  assert.deepEqual(initial.json(), {
    kind: 'tmdb',
    supported: true,
    configured: false,
    state: 'unconfigured',
    configRevision: 0,
    endpoint: null,
    configDigest: null,
    capabilityCodes: ['identity', 'metadata'],
    lastTestSummary: null,
  });

  const testPayload = command('tmdb', 'tmdb-test-before-save');
  delete testPayload.expectedConfigRevision;
  const tested = await host.inject({
    method: 'POST',
    url: '/v1/admin/settings/integrations/tmdb/actions/test',
    headers: { cookie },
    payload: testPayload,
  });
  assert.equal(tested.statusCode, 200, tested.body);
  assert.equal(tested.json().result, 'passed');
  assert.equal(tested.json().persisted, false);
  assert.equal(inspect(value.dataDir).integration, undefined);
  assert.equal(
    fs.existsSync(path.join(value.dataDir, 'secrets', 'integrations')),
    false,
  );

  const saved = await host.inject({
    method: 'PATCH',
    url: '/v1/admin/settings/integrations/tmdb',
    headers: { cookie },
    payload: command('tmdb', 'tmdb-save'),
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().configRevision, 1);
  assert.equal(saved.json().configured, true);
  assert.equal(saved.body.includes(credential), false);
  assert.equal(saved.body.includes('integration-envelope:'), false);

  const rows = inspect(value.dataDir);
  assert.equal(rows.integration.state, 'active');
  assert.equal(rows.integration.config_revision, 1);
  assert.equal(rows.integration.config_json.includes(credential), false);
  assert.equal(rows.secret.state, 'active');
  assert.match(rows.secret.encrypted_ref, /^integration-envelope:/);
  for (const file of scanFiles(value.dataDir)) {
    assert.equal(
      fs.readFileSync(file).includes(Buffer.from(credential, 'utf8')),
      false,
      `plaintext secret leaked to ${path.basename(file)}`,
    );
  }

  const callsAfterSave = state.calls.length;
  const replayed = await host.inject({
    method: 'PATCH',
    url: '/v1/admin/settings/integrations/tmdb',
    headers: { cookie },
    payload: command('tmdb', 'tmdb-save'),
  });
  assert.equal(replayed.statusCode, 200, replayed.body);
  assert.equal(replayed.json().replayed, true);
  assert.equal(state.calls.length, callsAfterSave);
  assert.equal(inspect(value.dataDir).integration.config_revision, 1);

  const conflicting = command('tmdb', 'tmdb-save');
  conflicting.credential.value = 'different-tmdb-credential-value';
  const conflict = await host.inject({
    method: 'PATCH',
    url: '/v1/admin/settings/integrations/tmdb',
    headers: { cookie },
    payload: conflicting,
  });
  assert.equal(conflict.statusCode, 409, conflict.body);
  assert.equal(inspect(value.dataDir).integration.config_revision, 1);

  await host.close();
  host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
    integrationFetch: tmdbFetch(state),
    now: () => 1_900_000_000_100,
  });
  const restartedCookie = await session(
    host,
    value.initialized.adminApiKey,
  );
  const restartedReplay = await host.inject({
    method: 'PATCH',
    url: '/v1/admin/settings/integrations/tmdb',
    headers: { cookie: restartedCookie },
    payload: command('tmdb', 'tmdb-save'),
  });
  assert.equal(restartedReplay.statusCode, 200, restartedReplay.body);
  assert.equal(restartedReplay.json().replayed, true);

  const disconnected = await host.inject({
    method: 'POST',
    url: '/v1/admin/settings/integrations/tmdb/actions/disconnect',
    headers: { cookie: restartedCookie },
    payload: {
      kind: 'tmdb',
      idempotencyKey: 'tmdb-disconnect',
      expectedConfigRevision: 1,
    },
  });
  assert.equal(disconnected.statusCode, 200, disconnected.body);
  assert.equal(disconnected.json().state, 'disabled');
  assert.equal(disconnected.json().configRevision, 2);
  const disconnectedRows = inspect(value.dataDir);
  assert.equal(disconnectedRows.secret.state, 'revoked');
  assert.equal(disconnectedRows.secret.revision, 2);
  assert.equal(
    fs.existsSync(
      path.join(
        value.dataDir,
        'secrets',
        'integrations',
        `${rows.secret.encrypted_ref.slice('integration-envelope:'.length)}.json`,
      ),
    ),
    false,
  );
  await host.close();
});

test('H1.1 routes reject target drift, unsupported providers, and failed tests without persistence', async () => {
  const value = fixture();
  const host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
    integrationFetch: async () => response(401, { status_code: 7 }),
  });
  const cookie = await session(host, value.initialized.adminApiKey);

  const unsupported = await host.inject({
    method: 'GET',
    url: '/v1/admin/settings/integrations/douban',
    headers: { cookie },
  });
  assert.equal(unsupported.statusCode, 200, unsupported.body);
  assert.equal(unsupported.json().state, 'unsupported');

  const mismatch = await host.inject({
    method: 'PATCH',
    url: '/v1/admin/settings/integrations/tmdb',
    headers: { cookie },
    payload: command('douban', 'wrong-target'),
  });
  assert.equal(mismatch.statusCode, 400, mismatch.body);
  assert.equal(
    mismatch.json().error.code,
    'PLATFORM_INTEGRATION_TARGET_MISMATCH',
  );

  const failed = await host.inject({
    method: 'PATCH',
    url: '/v1/admin/settings/integrations/tmdb',
    headers: { cookie },
    payload: command('tmdb', 'bad-credential'),
  });
  assert.equal(failed.statusCode, 400, failed.body);
  assert.equal(
    failed.json().error.code,
    'PLATFORM_INTEGRATION_CREDENTIAL_REJECTED',
  );
  assert.equal(inspect(value.dataDir).integration, undefined);
  assert.equal(
    fs.existsSync(path.join(value.dataDir, 'secrets', 'integrations')),
    false,
  );
  await host.close();
});

test('H1.1 invalid endpoint, credential, network, HTTP, schema, and timeout leave no half commit', async () => {
  const value = fixture();
  const state = { mode: 'network' };
  const fetchImpl = async (_input, init) => {
    if (state.mode === 'network') throw new Error('network unavailable');
    if (state.mode === 'http') return response(500, { status: 'failed' });
    if (state.mode === 'schema') {
      return response(200, { images: null });
    }
    if (state.mode === 'timeout') {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          'abort',
          () => reject(Object.assign(new Error('aborted'), {
            name: 'AbortError',
          })),
          { once: true },
        );
      });
    }
    throw new Error('unexpected test mode');
  };
  const host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
    integrationFetch: fetchImpl,
  });
  const cookie = await session(host, value.initialized.adminApiKey);

  const invalidEndpoint = command('tmdb', 'invalid-endpoint');
  invalidEndpoint.endpoint = 'http://api.themoviedb.org/3';
  const invalidCredential = command('tmdb', 'invalid-credential');
  invalidCredential.credential.value = 'short';
  const cases = [
    [invalidEndpoint, 'PLATFORM_INTEGRATION_ENDPOINT_INVALID', 400],
    [invalidCredential, 'PLATFORM_INTEGRATION_CREDENTIAL_INVALID', 400],
    [command('tmdb', 'network-failure'),
      'PLATFORM_INTEGRATION_NETWORK_FAILED', 502],
  ];
  for (const [payload, code, statusCode] of cases) {
    const result = await host.inject({
      method: 'PATCH',
      url: '/v1/admin/settings/integrations/tmdb',
      headers: { cookie },
      payload,
    });
    assert.equal(result.statusCode, statusCode, result.body);
    assert.equal(result.json().error.code, code);
    assert.equal(inspect(value.dataDir).integration, undefined);
  }
  state.mode = 'http';
  const http = await host.inject({
    method: 'PATCH',
    url: '/v1/admin/settings/integrations/tmdb',
    headers: { cookie },
    payload: command('tmdb', 'http-failure'),
  });
  assert.equal(http.statusCode, 502, http.body);
  assert.equal(http.json().error.code, 'PLATFORM_INTEGRATION_HTTP_FAILED');
  assert.equal(inspect(value.dataDir).integration, undefined);

  state.mode = 'schema';
  const schema = await host.inject({
    method: 'PATCH',
    url: '/v1/admin/settings/integrations/tmdb',
    headers: { cookie },
    payload: command('tmdb', 'schema-failure'),
  });
  assert.equal(schema.statusCode, 502, schema.body);
  assert.equal(
    schema.json().error.code,
    'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
  );
  assert.equal(inspect(value.dataDir).integration, undefined);

  state.mode = 'timeout';
  const timeoutPayload = command('tmdb', 'timeout-failure');
  timeoutPayload.timeoutMs = 500;
  const timedOut = await host.inject({
    method: 'PATCH',
    url: '/v1/admin/settings/integrations/tmdb',
    headers: { cookie },
    payload: timeoutPayload,
  });
  assert.equal(timedOut.statusCode, 502, timedOut.body);
  assert.equal(
    timedOut.json().error.code,
    'PLATFORM_INTEGRATION_TIMEOUT',
  );
  assert.equal(inspect(value.dataDir).integration, undefined);
  assert.equal(
    fs.existsSync(path.join(value.dataDir, 'secrets', 'integrations')),
    false,
  );
  await host.close();
});

test('H1.1 Platform ports fence real TMDB identity and metadata reads across restart', async () => {
  const value = fixture();
  const state = {};
  const fetchImpl = tmdbFetch(state);
  const host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
    integrationFetch: fetchImpl,
    now: () => 1_900_000_000_000,
  });
  const cookie = await session(host, value.initialized.adminApiKey);
  const saved = await host.inject({
    method: 'PATCH',
    url: '/v1/admin/settings/integrations/tmdb',
    headers: { cookie },
    payload: command('tmdb', 'typed-save'),
  });
  assert.equal(saved.statusCode, 200, saved.body);
  await host.close();

  const kernel = openSqliteKernel({
    Database,
    databasePath: path.join(value.dataDir, 'shelfdeck.db'),
    schemaDdl,
    schemaManifest,
    now: () => 1_900_000_000_100,
  });
  try {
    const runtime = createPlatformIntegrationServices({
      schemaManifest,
      unitOfWork: createSqliteUnitOfWork({ kernel }),
      dataDir: value.dataDir,
      secretRoot,
      fetchImpl,
      now: () => 1_900_000_000_100,
    });
    const resolved = await runtime.searchProviderIdentity({
      operationId: 'shared.integration.search@1',
      contentProfile: 'movie',
      title: 'Fight Club',
      candidateDeliverySnapshotDigest: 'a'.repeat(64),
    });
    assert.deepEqual(resolved, {
      provider: 'tmdb',
      namespace: 'tmdb_movie',
      providerKey: '550',
      seasonNumber: null,
      integrationId: 'tmdb-main',
      configRevision: 1,
    });
    const identityBasis = {
      provider: 'tmdb',
      namespace: 'tmdb_movie',
      providerKey: '550',
      seasonNumber: null,
    };
    const resolvedProviderIdentity = {
      ...identityBasis,
      identityAnchorDigest: canonicalDigest(identityBasis),
    };
    const handle = runtime.integrationHandleResolverPort.resolve({
      integrationId: 'tmdb-main',
      integrationType: 'tmdb',
      configRevision: 1,
      allowedOperation: 'libra.product_metadata.fetch@1',
      artifactKind: null,
    });
    const metadata = await runtime.fetchProviderMetadata({
      metadataFetchIntent: {
        resolvedProviderIdentity,
        requestedFields: [
          'director',
          'genre',
          'plot',
          'title',
          'year_or_release_date',
        ],
      },
      integrationHandle: handle,
    });
    assert.equal(metadata.providerKind, 'tmdb');
    assert.deepEqual(metadata.providerIdentities, [
      resolvedProviderIdentity,
    ]);
    assert.ok(metadata.descriptiveEntries.some(
      (item) => item.key === 'title' && item.value === 'Fight Club',
    ));
    assert.ok(metadata.peopleHints.some(
      (item) => item.displayName === 'Edward Norton',
    ));
    assert.throws(
      () => runtime.integrationHandleResolverPort.resolve({
        integrationId: 'tmdb-main',
        integrationType: 'tmdb',
        configRevision: 2,
        allowedOperation: 'libra.product_metadata.fetch@1',
        artifactKind: null,
      }),
      (error) => error.code ===
        'PLATFORM_INTEGRATION_REVISION_MISMATCH',
    );
  } finally {
    kernel.close();
  }
});

test('H1.1 encrypted envelope fails closed for wrong root, tamper, and missing locator', () => {
  const value = fixture();
  const store = createIntegrationSecretStore({
    dataDir: value.dataDir,
    secretRoot,
  });
  const bytes = Buffer.from(credential, 'utf8');
  const locator = store.write({
    integrationId: 'tmdb-main',
    secretRef: 'integration-secret:tmdb-main',
    secretKind: 'tmdb_api_key',
    revision: 1,
    secretBytes: bytes,
    createdAtMs: 1,
  });
  bytes.fill(0);
  const read = store.read(locator);
  assert.equal(read.toString('utf8'), credential);
  read.fill(0);

  const wrong = createIntegrationSecretStore({
    dataDir: value.dataDir,
    secretRoot: 'different-integration-secret-root-0123456789abcdef',
  });
  assert.throws(
    () => wrong.read(locator),
    (error) => error.code ===
      'PLATFORM_INTEGRATION_SECRET_DECRYPTION_FAILED',
  );
  const file = path.join(
    value.dataDir,
    'secrets',
    'integrations',
    `${locator.slice('integration-envelope:'.length)}.json`,
  );
  const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
  envelope.ciphertext = `${envelope.ciphertext.slice(0, -1)}A`;
  fs.writeFileSync(file, JSON.stringify(envelope));
  assert.throws(
    () => store.read(locator),
    (error) => error.code ===
      'PLATFORM_INTEGRATION_SECRET_DECRYPTION_FAILED',
  );
  store.remove(locator);
  assert.throws(
    () => store.read(locator),
    (error) => error.code ===
      'PLATFORM_INTEGRATION_SECRET_ENVELOPE_UNAVAILABLE',
  );
});

test('H1.1 source and route inventory prove no production fixture or scope expansion', () => {
  const hostSource = fs.readFileSync(
    path.join(serviceRoot, 'src/clean-service-host.js'),
    'utf8',
  );
  const serverSource = fs.readFileSync(
    path.join(serviceRoot, 'src/server.js'),
    'utf8',
  );
  const adapterSource = fs.readFileSync(
    path.join(
      serviceRoot,
      'src/helix/integrations/tmdb-provider-adapter.js',
    ),
    'utf8',
  );
  assert.doesNotMatch(serverSource, /TMDB_API_KEY|TMDB_TOKEN|DOUBAN|JAV_API/);
  assert.doesNotMatch(
    adapterSource,
    /process\.env|config\.json|fixture|fallback|media-worker|python|ollama/i,
  );
  assert.match(hostSource, /platformIntegrations\.isTmdbActive\(\)/);
  const guard = require('../../scripts/p14-h1-change-scope-guard');
  assert.deepEqual(guard.routeImplementationStatus().counts, {
    total: 114,
    real: 40,
    workerBeta404: 6,
    unavailable503: 68,
  });
  const report = guard.verify('H1.1');
  assert.equal(report.ok, true, JSON.stringify(report.violations));
});
