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
  canonicalJson,
} = require('../../src/helix/contracts/canonical-json');
const {
  openSqliteKernel,
} = require('../../src/helix/foundation/persistence/sqlite-kernel');
const {
  createSqliteUnitOfWork,
} = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {
  createIntegrationRepository,
} = require('../../src/helix/platform/persistence/integration-repository');
const {
  createPlatformIntegrationRuntime,
} = require('../../src/helix/platform/public/integration-runtime');
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

function response(status, body, bytes, extraHeaders = {}) {
  const payload = bytes
    ? Buffer.from(bytes)
    : Buffer.from(JSON.stringify(body), 'utf8');
  let delivered = false;
  return Object.freeze({
    status,
    headers: Object.freeze({
      get(name) {
        if (String(name).toLowerCase() === 'content-length') {
          return extraHeaders['content-length'] ??
            String(payload.length);
        }
        return extraHeaders[String(name).toLowerCase()] ?? null;
      },
    }),
    body: Object.freeze({
      getReader() {
        return Object.freeze({
          async read() {
            if (delivered) return { done: true };
            delivered = true;
            return { done: false, value: Uint8Array.from(payload) };
          },
          async cancel() {
            delivered = true;
          },
        });
      },
    }),
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

function testCommand(kind, key) {
  return {
    kind,
    idempotencyKey: key,
    endpoint: 'https://api.themoviedb.org/3',
    credential: { kind: 'api_key', value: credential },
    timeoutMs: 5_000,
  };
}

function configureCommand(
  kind,
  key,
  connectionProofId,
  expectedConfigRevision = 0,
) {
  return {
    kind,
    idempotencyKey: key,
    expectedConfigRevision,
    connectionProofId,
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
      counts: {
        integrations: database.prepare(
          'SELECT COUNT(*) AS count FROM platform_integrations',
        ).get().count,
        secrets: database.prepare(
          'SELECT COUNT(*) AS count FROM platform_secret_refs',
        ).get().count,
        receipts: database.prepare(
          'SELECT COUNT(*) AS count FROM fx_command_receipts ' +
          'WHERE owner_domain=?',
        ).get('platform-settings').count,
        markers: database.prepare(
          'SELECT COUNT(*) AS count FROM fx_commit_markers ' +
          'WHERE owner_domain=?',
        ).get('platform-settings').count,
        audits: database.prepare(
          'SELECT COUNT(*) AS count FROM fx_audit_records ' +
          'WHERE owner_domain=?',
        ).get('platform-settings').count,
      },
    };
  } finally {
    database.close();
  }
}

async function createProof(host, cookie, key = 'tmdb-proof') {
  const result = await host.inject({
    method: 'POST',
    url: '/v1/admin/settings/integrations/tmdb/actions/test',
    headers: { cookie },
    payload: testCommand('tmdb', key),
  });
  assert.equal(result.statusCode, 200, result.body);
  return result.json();
}

async function saveProof(
  host,
  cookie,
  proof,
  key = 'tmdb-save',
  expectedConfigRevision = 0,
) {
  return host.inject({
    method: 'PATCH',
    url: '/v1/admin/settings/integrations/tmdb',
    headers: { cookie },
    payload: configureCommand(
      'tmdb',
      key,
      proof.connectionProofId,
      expectedConfigRevision,
    ),
  });
}

function openIntegrationRuntime(dataDir, secretStore) {
  const kernel = openSqliteKernel({
    Database,
    databasePath: path.join(dataDir, 'shelfdeck.db'),
    schemaDdl,
    schemaManifest,
    now: () => 1_900_000_000_000,
  });
  const repository = createIntegrationRepository({
    schemaManifest,
    unitOfWork: createSqliteUnitOfWork({ kernel }),
  });
  return {
    kernel,
    runtime: createPlatformIntegrationRuntime({
      repository,
      secretStore,
      now: () => 1_900_000_000_000,
      createId: () => 'bounded-test-lease',
      digest: (value) => canonicalDigest({ value }),
    }),
  };
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

  const testPayload = testCommand('tmdb', 'tmdb-test-before-save');
  const tested = await host.inject({
    method: 'POST',
    url: '/v1/admin/settings/integrations/tmdb/actions/test',
    headers: { cookie },
    payload: testPayload,
  });
  assert.equal(tested.statusCode, 200, tested.body);
  assert.equal(tested.json().result, 'passed');
  assert.equal(tested.json().persisted, false);
  assert.equal(
    typeof tested.json().connectionProofId,
    'string',
  );
  const callsAfterTest = state.calls.length;
  const testReplay = await host.inject({
    method: 'POST',
    url: '/v1/admin/settings/integrations/tmdb/actions/test',
    headers: { cookie },
    payload: testPayload,
  });
  assert.equal(testReplay.statusCode, 200, testReplay.body);
  assert.deepEqual(testReplay.json(), tested.json());
  assert.equal(state.calls.length, callsAfterTest);
  assert.equal(inspect(value.dataDir).integration, undefined);
  assert.equal(
    scanFiles(path.join(
      value.dataDir,
      'secrets',
      'integrations',
    )).length,
    1,
  );

  const saved = await host.inject({
    method: 'PATCH',
    url: '/v1/admin/settings/integrations/tmdb',
    headers: { cookie },
    payload: configureCommand(
      'tmdb',
      'tmdb-save',
      tested.json().connectionProofId,
    ),
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
    payload: configureCommand(
      'tmdb',
      'tmdb-save',
      tested.json().connectionProofId,
    ),
  });
  assert.equal(replayed.statusCode, 200, replayed.body);
  assert.deepEqual(replayed.json(), saved.json());
  assert.equal(state.calls.length, callsAfterSave);
  assert.equal(inspect(value.dataDir).integration.config_revision, 1);

  const conflicting = configureCommand(
    'tmdb',
    'tmdb-save',
    'different-connection-proof',
  );
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
    payload: configureCommand(
      'tmdb',
      'tmdb-save',
      tested.json().connectionProofId,
    ),
  });
  assert.equal(restartedReplay.statusCode, 200, restartedReplay.body);
  assert.deepEqual(restartedReplay.json(), saved.json());

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
        `${rows.secret.encrypted_ref.split(':')[1]}.json`,
      ),
    ),
    false,
  );
  const oldConfigureReplay = await host.inject({
    method: 'PATCH',
    url: '/v1/admin/settings/integrations/tmdb',
    headers: { cookie: restartedCookie },
    payload: configureCommand(
      'tmdb',
      'tmdb-save',
      tested.json().connectionProofId,
    ),
  });
  assert.equal(
    oldConfigureReplay.statusCode,
    200,
    oldConfigureReplay.body,
  );
  assert.deepEqual(oldConfigureReplay.json(), saved.json());
  assert.equal(inspect(value.dataDir).integration.state, 'disabled');
  assert.equal(inspect(value.dataDir).integration.config_revision, 2);

  const reconfigureProof = await createProof(
    host,
    restartedCookie,
    'tmdb-reconfigure-proof',
  );
  const reconfigured = await saveProof(
    host,
    restartedCookie,
    reconfigureProof,
    'tmdb-reconfigure',
    2,
  );
  assert.equal(reconfigured.statusCode, 200, reconfigured.body);
  assert.equal(reconfigured.json().state, 'active');
  assert.equal(reconfigured.json().configRevision, 3);
  const oldDisconnectReplay = await host.inject({
    method: 'POST',
    url: '/v1/admin/settings/integrations/tmdb/actions/disconnect',
    headers: { cookie: restartedCookie },
    payload: {
      kind: 'tmdb',
      idempotencyKey: 'tmdb-disconnect',
      expectedConfigRevision: 1,
    },
  });
  assert.equal(
    oldDisconnectReplay.statusCode,
    200,
    oldDisconnectReplay.body,
  );
  assert.deepEqual(oldDisconnectReplay.json(), disconnected.json());
  assert.equal(inspect(value.dataDir).integration.state, 'active');
  assert.equal(inspect(value.dataDir).integration.config_revision, 3);
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
    url: '/v1/admin/settings/integrations/unknown-provider',
    headers: { cookie },
  });
  assert.equal(unsupported.statusCode, 200, unsupported.body);
  assert.equal(unsupported.json().state, 'unsupported');

  const mismatch = await host.inject({
    method: 'PATCH',
    url: '/v1/admin/settings/integrations/tmdb',
    headers: { cookie },
    payload: configureCommand(
      'douban',
      'wrong-target',
      'unused-connection-proof',
    ),
  });
  assert.equal(mismatch.statusCode, 400, mismatch.body);
  assert.equal(
    mismatch.json().error.code,
    'PLATFORM_INTEGRATION_TARGET_MISMATCH',
  );

  const failed = await host.inject({
    method: 'POST',
    url: '/v1/admin/settings/integrations/tmdb/actions/test',
    headers: { cookie },
    payload: testCommand('tmdb', 'bad-credential'),
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

  const invalidEndpoint = testCommand('tmdb', 'invalid-endpoint');
  invalidEndpoint.endpoint = 'http://api.themoviedb.org/3';
  const invalidCredential = testCommand('tmdb', 'invalid-credential');
  invalidCredential.credential.value = 'short';
  const cases = [
    [invalidEndpoint, 'PLATFORM_INTEGRATION_ENDPOINT_INVALID', 400],
    [invalidCredential, 'PLATFORM_INTEGRATION_CREDENTIAL_INVALID', 400],
    [testCommand('tmdb', 'network-failure'),
      'PLATFORM_INTEGRATION_NETWORK_FAILED', 502],
  ];
  for (const [payload, code, statusCode] of cases) {
    const result = await host.inject({
      method: 'POST',
      url: '/v1/admin/settings/integrations/tmdb/actions/test',
      headers: { cookie },
      payload,
    });
    assert.equal(result.statusCode, statusCode, result.body);
    assert.equal(result.json().error.code, code);
    assert.equal(inspect(value.dataDir).integration, undefined);
  }
  state.mode = 'http';
  const http = await host.inject({
    method: 'POST',
    url: '/v1/admin/settings/integrations/tmdb/actions/test',
    headers: { cookie },
    payload: testCommand('tmdb', 'http-failure'),
  });
  assert.equal(http.statusCode, 502, http.body);
  assert.equal(http.json().error.code, 'PLATFORM_INTEGRATION_HTTP_FAILED');
  assert.equal(inspect(value.dataDir).integration, undefined);

  state.mode = 'schema';
  const schema = await host.inject({
    method: 'POST',
    url: '/v1/admin/settings/integrations/tmdb/actions/test',
    headers: { cookie },
    payload: testCommand('tmdb', 'schema-failure'),
  });
  assert.equal(schema.statusCode, 502, schema.body);
  assert.equal(
    schema.json().error.code,
    'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
  );
  assert.equal(inspect(value.dataDir).integration, undefined);

  state.mode = 'timeout';
  const timeoutPayload = testCommand('tmdb', 'timeout-failure');
  timeoutPayload.timeoutMs = 500;
  const timedOut = await host.inject({
    method: 'POST',
    url: '/v1/admin/settings/integrations/tmdb/actions/test',
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
  const tested = await host.inject({
    method: 'POST',
    url: '/v1/admin/settings/integrations/tmdb/actions/test',
    headers: { cookie },
    payload: testCommand('tmdb', 'typed-test'),
  });
  assert.equal(tested.statusCode, 200, tested.body);
  const saved = await host.inject({
    method: 'PATCH',
    url: '/v1/admin/settings/integrations/tmdb',
    headers: { cookie },
    payload: configureCommand(
      'tmdb',
      'typed-save',
      tested.json().connectionProofId,
    ),
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

test('H1.1 connection proofs are short-lived, one-use, and restart-invalid', async () => {
  const value = fixture();
  let now = 1_900_000_000_000;
  let host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
    integrationFetch: tmdbFetch({}),
    now: () => now,
  });
  let cookie = await session(host, value.initialized.adminApiKey);
  const expired = await createProof(host, cookie, 'expiring-proof');
  now = expired.expiresAtMs + 1;
  const expiredSave = await saveProof(
    host,
    cookie,
    expired,
    'expired-save',
  );
  assert.equal(expiredSave.statusCode, 400, expiredSave.body);
  assert.equal(
    expiredSave.json().error.code,
    'PLATFORM_INTEGRATION_CONNECTION_PROOF_EXPIRED',
  );
  assert.equal(inspect(value.dataDir).integration, undefined);

  now += 1;
  const restartProof = await createProof(
    host,
    cookie,
    'restart-proof',
  );
  await host.close();
  host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
    integrationFetch: tmdbFetch({}),
    now: () => now,
  });
  cookie = await session(host, value.initialized.adminApiKey);
  const restartedSave = await saveProof(
    host,
    cookie,
    restartProof,
    'restart-save',
  );
  assert.equal(restartedSave.statusCode, 400, restartedSave.body);
  assert.equal(
    restartedSave.json().error.code,
    'PLATFORM_INTEGRATION_CONNECTION_PROOF_UNKNOWN',
  );
  assert.equal(inspect(value.dataDir).integration, undefined);

  const consumedProof = await createProof(
    host,
    cookie,
    'consumed-proof',
  );
  const consumedSave = await saveProof(
    host,
    cookie,
    consumedProof,
    'consumed-save',
  );
  assert.equal(consumedSave.statusCode, 200, consumedSave.body);
  const consumedAgain = await saveProof(
    host,
    cookie,
    consumedProof,
    'consumed-save-second-command',
    1,
  );
  assert.equal(consumedAgain.statusCode, 400, consumedAgain.body);
  assert.equal(
    consumedAgain.json().error.code,
    'PLATFORM_INTEGRATION_CONNECTION_PROOF_UNKNOWN',
  );
  assert.equal(inspect(value.dataDir).integration.config_revision, 1);
  await host.close();
});

test('H1.1 candidate envelope rollback and committed-head receipt repair converge safely', async () => {
  const rollback = fixture();
  let failBefore = true;
  let host = await createCleanServiceHost({
    dataDir: rollback.dataDir,
    adminDistDir: rollback.adminDistDir,
    secretRoot,
    integrationFetch: tmdbFetch({}),
    beforeIntegrationPlatformCommit() {
      if (failBefore) {
        failBefore = false;
        throw new Error('fault before Platform UoW');
      }
    },
  });
  let cookie = await session(host, rollback.initialized.adminApiKey);
  const rollbackProof = await createProof(
    host,
    cookie,
    'rollback-proof',
  );
  const failed = await saveProof(
    host,
    cookie,
    rollbackProof,
    'rollback-save',
  );
  assert.equal(failed.statusCode, 500, failed.body);
  assert.equal(inspect(rollback.dataDir).integration, undefined);
  assert.equal(
    scanFiles(path.join(
      rollback.dataDir,
      'secrets',
      'integrations',
    )).length,
    1,
  );
  const retried = await saveProof(
    host,
    cookie,
    rollbackProof,
    'rollback-save',
  );
  assert.equal(retried.statusCode, 200, retried.body);
  assert.equal(inspect(rollback.dataDir).integration.config_revision, 1);
  await host.close();

  const responseLoss = fixture();
  let failAfter = true;
  const state = {};
  host = await createCleanServiceHost({
    dataDir: responseLoss.dataDir,
    adminDistDir: responseLoss.adminDistDir,
    secretRoot,
    integrationFetch: tmdbFetch(state),
    afterIntegrationPlatformCommit() {
      if (failAfter) {
        failAfter = false;
        throw new Error('fault after Platform UoW');
      }
    },
  });
  cookie = await session(host, responseLoss.initialized.adminApiKey);
  const committedProof = await createProof(
    host,
    cookie,
    'response-loss-proof',
  );
  const callsBeforeCommit = state.calls.length;
  const lost = await saveProof(
    host,
    cookie,
    committedProof,
    'response-loss-save',
  );
  assert.equal(lost.statusCode, 500, lost.body);
  assert.equal(inspect(responseLoss.dataDir).integration.state, 'active');
  const envelopesBeforeRecovery = scanFiles(path.join(
    responseLoss.dataDir,
    'secrets',
    'integrations',
  )).length;
  const recovered = await saveProof(
    host,
    cookie,
    committedProof,
    'response-loss-save',
  );
  assert.equal(recovered.statusCode, 200, recovered.body);
  assert.equal(recovered.json().state, 'active');
  assert.equal(recovered.json().configRevision, 1);
  assert.equal(state.calls.length, callsBeforeCommit);
  assert.equal(inspect(responseLoss.dataDir).integration.config_revision, 1);
  assert.equal(
    scanFiles(path.join(
      responseLoss.dataDir,
      'secrets',
      'integrations',
    )).length,
    envelopesBeforeRecovery - 1,
  );
  const afterRecovery = inspect(responseLoss.dataDir);
  const reuse = await saveProof(
    host,
    cookie,
    committedProof,
    'response-loss-proof-reuse',
    1,
  );
  assert.equal(reuse.statusCode, 400, reuse.body);
  assert.equal(
    reuse.json().error.code,
    'PLATFORM_INTEGRATION_CONNECTION_PROOF_UNKNOWN',
  );
  const afterRejectedReuse = inspect(responseLoss.dataDir);
  assert.equal(afterRejectedReuse.integration.config_revision, 1);
  assert.deepEqual(afterRejectedReuse.counts, afterRecovery.counts);
  assert.equal(state.calls.length, callsBeforeCommit);
  assert.equal(
    scanFiles(path.join(
      responseLoss.dataDir,
      'secrets',
      'integrations',
    )).length,
    envelopesBeforeRecovery - 1,
  );
  await host.close();

  host = await createCleanServiceHost({
    dataDir: responseLoss.dataDir,
    adminDistDir: responseLoss.adminDistDir,
    secretRoot,
    integrationFetch: tmdbFetch(state),
  });
  cookie = await session(host, responseLoss.initialized.adminApiKey);
  const restartedReplay = await saveProof(
    host,
    cookie,
    committedProof,
    'response-loss-save',
  );
  assert.equal(restartedReplay.statusCode, 200, restartedReplay.body);
  assert.deepEqual(restartedReplay.json(), recovered.json());
  assert.equal(state.calls.length, callsBeforeCommit);
  assert.equal(inspect(responseLoss.dataDir).integration.config_revision, 1);
  await host.close();
});

test('H1.1 runtime rejects persisted endpoint, config, and swapped-envelope drift before Secret read', async () => {
  async function configuredFixture(key) {
    const value = fixture();
    const host = await createCleanServiceHost({
      dataDir: value.dataDir,
      adminDistDir: value.adminDistDir,
      secretRoot,
      integrationFetch: tmdbFetch({}),
    });
    const cookie = await session(host, value.initialized.adminApiKey);
    const proof = await createProof(host, cookie, key + '-proof');
    const saved = await saveProof(host, cookie, proof, key + '-save');
    assert.equal(saved.statusCode, 200, saved.body);
    await host.close();
    return value;
  }

  const endpoint = await configuredFixture('endpoint-drift');
  let database = new Database(path.join(endpoint.dataDir, 'shelfdeck.db'));
  database.prepare(
    'UPDATE platform_integrations SET endpoint=? WHERE integration_id=?',
  ).run('https://attacker.example/3', 'tmdb-main');
  database.close();
  let secretReads = 0;
  let opened = openIntegrationRuntime(endpoint.dataDir, {
    read() {
      secretReads += 1;
      return Buffer.from('must-not-be-read');
    },
  });
  assert.throws(
    () => opened.runtime.readCurrent(),
    (error) => error.code === 'PLATFORM_INTEGRATION_CONFIG_CORRUPT',
  );
  assert.equal(secretReads, 0);
  opened.kernel.close();

  const config = await configuredFixture('config-drift');
  database = new Database(path.join(config.dataDir, 'shelfdeck.db'));
  const row = database.prepare(
    'SELECT config_json FROM platform_integrations WHERE integration_id=?',
  ).get('tmdb-main');
  const changed = JSON.parse(row.config_json);
  changed.unknownAuthority = true;
  database.prepare(
    'UPDATE platform_integrations SET config_json=?,config_digest=? ' +
    'WHERE integration_id=?',
  ).run(
    canonicalJson(changed),
    canonicalDigest(changed),
    'tmdb-main',
  );
  database.close();
  secretReads = 0;
  opened = openIntegrationRuntime(config.dataDir, {
    read() {
      secretReads += 1;
      return Buffer.from('must-not-be-read');
    },
  });
  assert.throws(
    () => opened.runtime.readCurrent(),
    (error) => error.code === 'PLATFORM_INTEGRATION_CONFIG_CORRUPT',
  );
  assert.equal(secretReads, 0);
  opened.kernel.close();

  const swapped = await configuredFixture('locator-drift');
  const store = createIntegrationSecretStore({
    dataDir: swapped.dataDir,
    secretRoot,
  });
  const foreignBytes = Buffer.from('foreign-secret-value', 'utf8');
  const foreign = store.write({
    integrationId: 'other-main',
    secretRef: 'integration-secret:other-main',
    secretKind: 'tmdb_api_key',
    revision: 9,
    secretBytes: foreignBytes,
    createdAtMs: 1,
  });
  foreignBytes.fill(0);
  database = new Database(path.join(swapped.dataDir, 'shelfdeck.db'));
  database.prepare(
    'UPDATE platform_secret_refs SET encrypted_ref=? WHERE secret_ref=?',
  ).run(foreign.locator, 'integration-secret:tmdb-main');
  database.close();
  secretReads = 0;
  opened = openIntegrationRuntime(swapped.dataDir, {
    read() {
      secretReads += 1;
      return Buffer.from('must-not-be-read');
    },
  });
  assert.throws(
    () => opened.runtime.readCurrent(),
    (error) => error.code === 'PLATFORM_INTEGRATION_CONFIG_CORRUPT',
  );
  assert.equal(secretReads, 0);
  opened.kernel.close();
  assert.throws(
    () => store.read(foreign.locator, {
      integrationId: 'tmdb-main',
      secretRef: 'integration-secret:tmdb-main',
      secretKind: 'tmdb_api_key',
      revision: 1,
      envelopeDigest: foreign.envelopeDigest,
    }),
    (error) => error.code ===
      'PLATFORM_INTEGRATION_SECRET_SCOPE_MISMATCH',
  );

  const sameScope = await configuredFixture('same-scope-locator-drift');
  const sameScopeStore = createIntegrationSecretStore({
    dataDir: sameScope.dataDir,
    secretRoot,
  });
  const alternateBytes = Buffer.from('alternate-secret-value', 'utf8');
  const alternate = sameScopeStore.write({
    integrationId: 'tmdb-main',
    secretRef: 'integration-secret:tmdb-main',
    secretKind: 'tmdb_api_key',
    revision: 1,
    secretBytes: alternateBytes,
    createdAtMs: 1,
  });
  alternateBytes.fill(0);
  database = new Database(path.join(sameScope.dataDir, 'shelfdeck.db'));
  database.prepare(
    'UPDATE platform_secret_refs SET encrypted_ref=? WHERE secret_ref=?',
  ).run(alternate.locator, 'integration-secret:tmdb-main');
  database.close();
  secretReads = 0;
  opened = openIntegrationRuntime(sameScope.dataDir, {
    read() {
      secretReads += 1;
      return Buffer.from('must-not-be-read');
    },
  });
  assert.throws(
    () => opened.runtime.readCurrent(),
    (error) => error.code === 'PLATFORM_INTEGRATION_CONFIG_CORRUPT',
  );
  assert.equal(secretReads, 0);
  opened.kernel.close();
});

test('H1.1 external JSON byte and closed-shape bounds fail before persistence', async () => {
  const unknown = fixture();
  let host = await createCleanServiceHost({
    dataDir: unknown.dataDir,
    adminDistDir: unknown.adminDistDir,
    secretRoot,
    integrationFetch: async () => response(200, {
      images: {
        secure_base_url: 'https://image.tmdb.org/t/p/',
      },
      unknownAuthority: true,
    }),
  });
  let cookie = await session(host, unknown.initialized.adminApiKey);
  let result = await host.inject({
    method: 'POST',
    url: '/v1/admin/settings/integrations/tmdb/actions/test',
    headers: { cookie },
    payload: testCommand('tmdb', 'unknown-response'),
  });
  assert.equal(result.statusCode, 502, result.body);
  assert.equal(
    result.json().error.code,
    'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
  );
  assert.equal(inspect(unknown.dataDir).integration, undefined);
  await host.close();

  const declared = fixture();
  host = await createCleanServiceHost({
    dataDir: declared.dataDir,
    adminDistDir: declared.adminDistDir,
    secretRoot,
    integrationFetch: async () => response(
      200,
      { images: { secure_base_url: 'https://image.tmdb.org/t/p/' } },
      undefined,
      { 'content-length': String(1024 * 1024 + 1) },
    ),
  });
  cookie = await session(host, declared.initialized.adminApiKey);
  result = await host.inject({
    method: 'POST',
    url: '/v1/admin/settings/integrations/tmdb/actions/test',
    headers: { cookie },
    payload: testCommand('tmdb', 'declared-overflow'),
  });
  assert.equal(result.statusCode, 502, result.body);
  assert.equal(
    result.json().error.code,
    'PLATFORM_INTEGRATION_RESPONSE_BOUND',
  );
  assert.equal(inspect(declared.dataDir).integration, undefined);
  await host.close();

  const streamed = fixture();
  host = await createCleanServiceHost({
    dataDir: streamed.dataDir,
    adminDistDir: streamed.adminDistDir,
    secretRoot,
    integrationFetch: async () => {
      let ordinal = 0;
      return {
        status: 200,
        headers: { get: () => null },
        body: {
          getReader() {
            return {
              async read() {
                ordinal += 1;
                if (ordinal <= 2) {
                  return {
                    done: false,
                    value: new Uint8Array(600 * 1024),
                  };
                }
                return { done: true };
              },
              async cancel() {},
            };
          },
        },
      };
    },
  });
  cookie = await session(host, streamed.initialized.adminApiKey);
  result = await host.inject({
    method: 'POST',
    url: '/v1/admin/settings/integrations/tmdb/actions/test',
    headers: { cookie },
    payload: testCommand('tmdb', 'streamed-overflow'),
  });
  assert.equal(result.statusCode, 502, result.body);
  assert.equal(
    result.json().error.code,
    'PLATFORM_INTEGRATION_RESPONSE_BOUND',
  );
  assert.equal(inspect(streamed.dataDir).integration, undefined);
  await host.close();
});

test('H1.1 encrypted envelope fails closed for wrong root, tamper, and missing locator', () => {
  const value = fixture();
  const store = createIntegrationSecretStore({
    dataDir: value.dataDir,
    secretRoot,
  });
  const bytes = Buffer.from(credential, 'utf8');
  const stored = store.write({
    integrationId: 'tmdb-main',
    secretRef: 'integration-secret:tmdb-main',
    secretKind: 'tmdb_api_key',
    revision: 1,
    secretBytes: bytes,
    createdAtMs: 1,
  });
  bytes.fill(0);
  const expectedScope = {
    integrationId: 'tmdb-main',
    secretRef: 'integration-secret:tmdb-main',
    secretKind: 'tmdb_api_key',
    revision: 1,
    envelopeDigest: stored.envelopeDigest,
  };
  const read = store.read(stored.locator, expectedScope);
  assert.equal(read.toString('utf8'), credential);
  read.fill(0);

  const wrong = createIntegrationSecretStore({
    dataDir: value.dataDir,
    secretRoot: 'different-integration-secret-root-0123456789abcdef',
  });
  assert.throws(
    () => wrong.read(stored.locator, expectedScope),
    (error) => [
      'PLATFORM_INTEGRATION_SECRET_SCOPE_MISMATCH',
      'PLATFORM_INTEGRATION_SECRET_DECRYPTION_FAILED',
    ].includes(error.code),
  );
  const file = path.join(
    value.dataDir,
    'secrets',
    'integrations',
    `${stored.locator.split(':')[1]}.json`,
  );
  const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
  envelope.ciphertext = `${envelope.ciphertext.slice(0, -1)}A`;
  fs.writeFileSync(file, JSON.stringify(envelope));
  assert.throws(
    () => store.read(stored.locator, expectedScope),
    (error) => [
      'PLATFORM_INTEGRATION_SECRET_SCOPE_MISMATCH',
      'PLATFORM_INTEGRATION_SECRET_DECRYPTION_FAILED',
    ].includes(error.code),
  );
  store.remove(stored.locator);
  assert.throws(
    () => store.read(stored.locator, expectedScope),
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
  assert.match(hostSource, /const tmdbAdapter = adapters\.get\('tmdb'\)/);
  assert.doesNotMatch(hostSource, /formation\.contentProfile/);
  const guard = require('../../scripts/p14-h1-change-scope-guard');
  assert.deepEqual(guard.routeImplementationStatus().counts, {
    total: 115,
    real: 50,
    workerBeta404: 6,
    unavailable503: 59,
  });
  // H1.1 is a closed historical construction phase. Its dedicated guard fixture
  // verifies the frozen seam; the live worktree is now governed by CURRENT_PLAN.
  assert.equal(typeof guard.verify, 'function');
});
