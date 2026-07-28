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
const schemaManifest = require(
  '../../src/helix/foundation/persistence/generated/clean-schema.manifest.json'
);

const serviceRoot = path.resolve(__dirname, '../..');
const schemaDdl = fs.readFileSync(path.join(
  serviceRoot,
  'src/helix/foundation/persistence/generated/clean-schema.sql',
), 'utf8');
const secretRoot =
  'h1-provider-integration-secret-root-0123456789abcdef';
const secrets = Object.freeze({
  douban: 'douban-cookie-value-never-persisted',
  'adult-provider': 'adult-provider-key-never-persisted',
  moviepilot: 'moviepilot-key-never-persisted',
  embyPassword: 'emby-password-never-persisted',
  embyToken: 'emby-issued-token-never-plaintext',
});
const roots = [];

function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'helix-h1-providers-'),
  );
  roots.push(root);
  const dataDir = path.join(root, 'data');
  const adminDistDir = path.join(root, 'admin');
  fs.mkdirSync(adminDistDir, { recursive: true });
  fs.writeFileSync(
    path.join(adminDistDir, 'index.html'),
    '<!doctype html><html><body>H1.2</body></html>',
  );
  const initialized = initializeCleanData({
    dataDir,
    confirmation: 'INITIALIZE_HELIX_CLEAN_V1',
    secretRoot,
  });
  return { root, dataDir, adminDistDir, initialized };
}

function response(status, body, contentType = 'application/json') {
  const bytes = Buffer.isBuffer(body)
    ? Buffer.from(body)
    : Buffer.from(
        contentType === 'application/json'
          ? JSON.stringify(body)
          : String(body),
        'utf8',
      );
  let delivered = false;
  return Object.freeze({
    ok: status >= 200 && status <= 299,
    status,
    headers: Object.freeze({
      get(name) {
        if (String(name).toLowerCase() === 'content-length') {
          return String(bytes.length);
        }
        if (String(name).toLowerCase() === 'content-type') {
          return contentType;
        }
        return null;
      },
    }),
    body: Object.freeze({
      getReader() {
        return Object.freeze({
          async read() {
            if (delivered) return { done: true };
            delivered = true;
            return {
              done: false,
              value: Uint8Array.from(bytes),
            };
          },
          async cancel() {
            delivered = true;
          },
        });
      },
    }),
    async arrayBuffer() {
      return Uint8Array.from(bytes).buffer;
    },
  });
}

function providerFetch(state) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(
      Object.entries(init.headers || {})
        .map(([key, value]) => [key.toLowerCase(), value]),
    );
    state.calls.push({
      host: url.host,
      path: url.pathname,
      method: init.method || 'GET',
      redirect: init.redirect || null,
      hasSecret: Boolean(
        headers.cookie ||
        headers.apikey ||
        headers.authorization ||
        headers['x-emby-token'] ||
        url.searchParams.has('token'),
      ),
    });
    if (url.host === 'movie.douban.com') {
      if (headers.cookie !== secrets.douban) {
        return response(401, 'denied', 'text/plain');
      }
      return response(
        200,
        '<a href="/people/' +
        (state.doubanResponseUser || 'test-user') +
        '">User</a>' +
        '<a href="/subject/1292052/">Movie</a>',
        'text/html',
      );
    }
    if (url.host === 'api.theporndb.net') {
      if (headers.authorization !==
          'Bearer ' + secrets['adult-provider']) {
        return response(401, { message: 'denied' });
      }
      if (url.pathname === '/auth/user') {
        return response(200, {
          id: 42,
          name: 'ShelfDeck test account',
          email: 'ignored@example.invalid',
        });
      }
      const scene = {
        id: 'scene-1',
        sku: state.adultForeignCode || 'SDKI-001',
        title: state.adultLongTitle || 'JAV title',
        date: '2020-01-02',
        description: 'Description',
        site: { id: 7, name: 'Studio', url: 'ignored' },
        tags: [{ id: 1, name: 'Drama', ignored: true }],
        performers: [{
          id: 'performer-1',
          name: 'Actor',
          gender: 'female',
        }],
        posters: {
          full: state.artifactUrl ||
            'https://cdn.theporndb.net/poster.jpg',
          large: 'ignored',
        },
        background: {
          full: 'https://cdn.theporndb.net/fanart.jpg',
          large: 'ignored',
        },
        duration: 7200,
      };
      if (url.pathname === '/jav') {
        if (url.searchParams.get('q') !== 'SDKI-001' ||
            url.searchParams.get('per_page') !== '2') {
          return response(400, { message: 'invalid search' });
        }
        const rows = state.adultDuplicate
          ? [scene, { ...scene }]
          : state.adultSearchOverflow
            ? [scene, { ...scene, id: 'scene-2' }, {
                ...scene,
                id: 'scene-3',
              }]
            : [scene];
        return response(200, {
          data: rows,
          meta: { current_page: 1, per_page: 2, total: 1 },
        });
      }
      if (url.pathname === '/jav/SDKI-001') {
        return response(200, { data: scene });
      }
      return response(404, { message: 'not found' });
    }
    if (url.host === 'cdn.theporndb.net') {
      if (state.artifactRedirect) {
        return response(302, 'redirect', 'text/plain');
      }
      return response(
        200,
        Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
        'image/jpeg',
      );
    }
    if (url.host === 'moviepilot.test') {
      if (url.searchParams.get('token') !== secrets.moviepilot) {
        return response(401, { detail: 'denied' });
      }
      if (url.pathname === '/api/v1/download/') {
        return response(200, []);
      }
      if (url.pathname === '/api/v1/search/title') {
        return response(200, [{
          id: 'torrent-1',
          title: 'Movie',
        }]);
      }
      if (url.pathname === '/api/v1/download/add') {
        return response(200, { data: { id: 'job-1' } });
      }
    }
    if (url.host === 'emby.test') {
      if (url.pathname === '/Users/AuthenticateByName') {
        const login = JSON.parse(init.body);
        if (login.Username !== 'operator' ||
            login.Pw !== secrets.embyPassword) {
          return response(401, { error: 'denied' });
        }
        return response(200, {
          AccessToken: secrets.embyToken,
          User: {
            Id: 'emby-user-1',
            Name: 'Operator',
            HasPassword: true,
            Policy: { IsAdministrator: true },
          },
          ServerId: 'emby-server-1',
          SessionInfo: {
            Id: 'session-1',
            ServerId: 'emby-server-1',
            UserId: 'emby-user-1',
          },
        });
      }
      if (headers['x-emby-token'] !== secrets.embyToken) {
        return response(401, { error: 'denied' });
      }
      if (url.pathname === '/System/Info') {
        return response(200, {
          Id: 'emby-server-1',
          Version: '4.9.0',
          ServerName: 'ShelfDeck Test Emby',
          OperatingSystem: 'Linux',
        });
      }
      if (url.pathname.startsWith('/Persons/')) {
        return response(200, {
          Id: 'emby-person-1',
          Name: 'Person',
          Type: 'Person',
          ImageTags: {},
        });
      }
      if (url.pathname.startsWith('/Items/')) {
        return response(200, {
          Id: 'emby-item-1',
          Name: 'Movie',
          Type: 'Movie',
          ProductionYear: 2020,
          ImageTags: {},
        });
      }
    }
    return response(404, { error: 'not found' });
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

const commands = Object.freeze({
  douban: Object.freeze({
    endpoint: 'https://movie.douban.com',
    credential: {
      kind: 'cookie',
      value: secrets.douban,
    },
    settings: { userId: 'test-user' },
  }),
  'adult-provider': Object.freeze({
    endpoint: 'https://api.theporndb.net',
    credential: {
      kind: 'api_key',
      value: secrets['adult-provider'],
    },
  }),
  moviepilot: Object.freeze({
    endpoint: 'https://moviepilot.test',
    credential: {
      kind: 'api_key',
      value: secrets.moviepilot,
    },
  }),
  emby: Object.freeze({
    endpoint: 'https://emby.test',
    credential: {
      kind: 'username_password',
      username: 'operator',
      password: secrets.embyPassword,
    },
  }),
});

async function configure(host, cookie, kind, suffix = '') {
  const command = commands[kind];
  const tested = await host.inject({
    method: 'POST',
    url: '/v1/admin/settings/integrations/' +
      kind + '/actions/test',
    headers: { cookie },
    payload: {
      kind,
      idempotencyKey: kind + '-test' + suffix,
      endpoint: command.endpoint,
      credential: command.credential,
      ...(command.settings
        ? { settings: command.settings }
        : {}),
      timeoutMs: 5_000,
    },
  });
  assert.equal(tested.statusCode, 200, tested.body);
  const saved = await host.inject({
    method: 'PATCH',
    url: '/v1/admin/settings/integrations/' + kind,
    headers: { cookie },
    payload: {
      kind,
      idempotencyKey: kind + '-save' + suffix,
      expectedConfigRevision: 0,
      connectionProofId: tested.json().connectionProofId,
    },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  return saved.json();
}

function inspect(dataDir) {
  const database = new Database(
    path.join(dataDir, 'shelfdeck.db'),
    { readonly: true },
  );
  try {
    return {
      integrations: database.prepare(
        'SELECT * FROM platform_integrations ORDER BY integration_id',
      ).all(),
      secrets: database.prepare(
        'SELECT * FROM platform_secret_refs ' +
        'WHERE owner_scope_type=? ORDER BY secret_ref',
      ).all('integration'),
      receipts: database.prepare(
        'SELECT COUNT(*) AS count FROM fx_command_receipts ' +
        'WHERE owner_domain=? AND command_contract LIKE ?',
      ).get('platform-settings', 'platform.integration.%').count,
    };
  } finally {
    database.close();
  }
}

function openServices(value, fetchImpl) {
  const kernel = openSqliteKernel({
    Database,
    databasePath: path.join(value.dataDir, 'shelfdeck.db'),
    schemaDdl,
    schemaManifest,
    now: () => 1_900_000_000_000,
  });
  return {
    kernel,
    services: createPlatformIntegrationServices({
      schemaManifest,
      unitOfWork: createSqliteUnitOfWork({ kernel }),
      dataDir: value.dataDir,
      secretRoot,
      now: () => 1_900_000_000_000,
      fetchImpl,
    }),
  };
}

function ref(type, id) {
  return Object.freeze({
    objectType: type,
    objectId: id,
    revision: 1,
    digest: canonicalDigest({ type, id }),
  });
}

function acquisitionQuery() {
  const identity = Object.freeze({
    provider: 'tmdb',
    namespace: 'tmdb_movie',
    providerKey: '550',
    seasonNumber: null,
    identityAnchorDigest: canonicalDigest({ identity: '550' }),
  });
  const term = {
    ordinal: 0,
    termKind: 'title',
    value: 'Movie',
  };
  term.termDigest = canonicalDigest({
    schema: 'libra.external-acquisition-query-term@1',
    termKind: term.termKind,
    value: term.value,
  });
  const query = {
    schemaRef: 'helix://contracts/types/AcquisitionQuery/v1',
    schemaVersion: 1,
    draftId: 'query-1',
    draftKind: 'external-acquisition-query',
    basisDigest: canonicalDigest({ basis: 'query' }),
    producedAtMs: 1_900_000_000_000,
    libraRunId: 'run-1',
    runExecutionBasisDigest: canonicalDigest({ run: 1 }),
    resolvedIdentityDigest: canonicalDigest({ identity: 1 }),
    productStructureDigest: canonicalDigest({ structure: 1 }),
    structureKind: 'single',
    contentProfile: 'movie',
    providerIdentityAnchors: [identity],
    requestedEpisodeKeys: [],
    queryTerms: [term],
    hardConstraints: {
      requiredStructureKind: 'single',
      requiredEpisodeKeys: [],
    },
  };
  query.queryDigest = canonicalDigest({
    schema: 'libra.external-acquisition-query@1',
    libraRunId: query.libraRunId,
    runExecutionBasisDigest: query.runExecutionBasisDigest,
    resolvedIdentityDigest: query.resolvedIdentityDigest,
    productStructureDigest: query.productStructureDigest,
    structureKind: query.structureKind,
    contentProfile: query.contentProfile,
    providerIdentityAnchors: query.providerIdentityAnchors,
    requestedEpisodeKeys: query.requestedEpisodeKeys,
    queryTerms: query.queryTerms,
    hardConstraints: query.hardConstraints,
  });
  query.draftDigest = canonicalDigest(query);
  return Object.freeze(query);
}

test.after(() => {
  for (const root of roots) {
    fs.rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
});

test('H1.2 four providers share test-proof-save-read and never persist operator credentials', async () => {
  const value = fixture();
  const state = { calls: [] };
  let host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
    integrationFetch: providerFetch(state),
    now: () => 1_900_000_000_000,
  });
  const cookie = await session(host, value.initialized.adminApiKey);

  for (const kind of Object.keys(commands)) {
    const initial = await host.inject({
      method: 'GET',
      url: '/v1/admin/settings/integrations/' + kind,
      headers: { cookie },
    });
    assert.equal(initial.statusCode, 200, initial.body);
    assert.equal(initial.json().state, 'unconfigured');
    const saved = await configure(host, cookie, kind);
    assert.equal(saved.kind, kind);
    assert.equal(saved.state, 'active');
    assert.equal(saved.configRevision, 1);
  }
  const rows = inspect(value.dataDir);
  assert.equal(rows.integrations.length, 4);
  assert.equal(rows.secrets.length, 4);
  assert.equal(rows.receipts, 4);
  const persisted = JSON.stringify(rows);
  for (const value of Object.values(secrets)) {
    assert.equal(persisted.includes(value), false);
  }
  const files = fs.readdirSync(
    path.join(value.dataDir, 'secrets', 'integrations'),
  );
  assert.ok(files.length >= 4);
  for (const file of files) {
    const bytes = fs.readFileSync(path.join(
      value.dataDir,
      'secrets',
      'integrations',
      file,
    ));
    for (const value of Object.values(secrets)) {
      assert.equal(bytes.includes(Buffer.from(value, 'utf8')), false);
    }
  }

  await host.close();
  host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
    integrationFetch: providerFetch(state),
    now: () => 1_900_000_000_000,
  });
  const restarted = await session(
    host,
    value.initialized.adminApiKey,
  );
  for (const kind of Object.keys(commands)) {
    const read = await host.inject({
      method: 'GET',
      url: '/v1/admin/settings/integrations/' + kind,
      headers: { cookie: restarted },
    });
    assert.equal(read.statusCode, 200, read.body);
    assert.equal(read.json().state, 'active');
    assert.equal(read.body.includes('integration-envelope:'), false);
  }
  await host.close();
});

test('H1.2 provider operations execute through exact P5 ports and revision-fenced Secret leases', async () => {
  const value = fixture();
  const state = { calls: [] };
  const fetchImpl = providerFetch(state);
  const host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
    integrationFetch: fetchImpl,
    now: () => 1_900_000_000_000,
  });
  const cookie = await session(host, value.initialized.adminApiKey);
  for (const kind of Object.keys(commands)) {
    await configure(host, cookie, kind, '-ports');
  }
  await host.close();

  const opened = openServices(value, fetchImpl);
  try {
    const douban = await opened.services.executeProvider('douban', {
      operationId: 'perception.source.acquire@1',
      effectClass: 'pure_observation',
      idempotencyKey: 'douban-page',
      timeoutMs: 5_000,
      input: {
        sourceRef: ref('perception-source', 'test-user'),
        cursor: null,
        limit: 20,
      },
    });
    assert.equal(douban.result.resultRefs.length, 1);
    assert.equal(douban.result.resultRefs[0].objectId, '1292052');

    const adult = await opened.services.executeProvider(
      'adult-provider',
      {
        operationId: 'libra.product_metadata.fetch@1',
        effectClass: 'pure_observation',
        idempotencyKey: 'adult-metadata',
        timeoutMs: 5_000,
        input: {
          productIdentityRef: ref(
            'product-identity',
            'SDKI-001',
          ),
          locale: 'en-US',
        },
      },
    );
    assert.equal(adult.result.resultRef.objectId, 'SDKI-001');

    const emby = await opened.services.executeProvider('emby', {
      operationId: 'people.registration_evidence.observe@1',
      effectClass: 'pure_observation',
      idempotencyKey: 'emby-person',
      timeoutMs: 5_000,
      input: {
        personHintRef: ref('person-hint', 'Person'),
        limit: 10,
      },
    });
    assert.equal(emby.result.resultRefs.length, 1);
    const embyMetadata = await opened.services.executeProvider(
      'emby',
      {
        operationId: 'libra.product_metadata.fetch@1',
        effectClass: 'pure_observation',
        idempotencyKey: 'emby-metadata',
        timeoutMs: 5_000,
        input: {
          productIdentityRef: ref(
            'product-identity',
            'emby-item-1',
          ),
          locale: 'en-US',
        },
      },
    );
    assert.equal(
      embyMetadata.result.resultRef.objectId,
      'emby-item-1',
    );
    await assert.rejects(
      () => opened.services.executeProvider(
        'adult-provider',
        {
          operationId: 'people.registration_evidence.observe@1',
          effectClass: 'pure_observation',
          idempotencyKey: 'adult-unsupported-people',
          timeoutMs: 5_000,
          input: {
            personHintRef: ref('person-hint', 'Actor'),
            limit: 10,
          },
        },
      ),
      (error) => error.code === 'P5_PROVIDER_TRANSPORT_FAILED',
    );

    const moviepilot = await opened.services.executeProvider(
      'moviepilot',
      {
        operationId: 'libra.external_material.search@1',
        effectClass: 'pure_observation',
        idempotencyKey: 'moviepilot-search',
        timeoutMs: 5_000,
        input: {
          acquisitionQuery: acquisitionQuery(),
          limit: 25,
        },
      },
    );
    assert.equal(moviepilot.result.candidates.length, 1);
    assert.equal(
      moviepilot.result.candidates[0].providerRank,
      0,
    );
  } finally {
    opened.kernel.close();
  }
});

test('H1.2 Adult Provider supplies the real JAV Product identity, metadata, and artifact seam without a construction fallback', async () => {
  const value = fixture();
  const state = { calls: [] };
  const fetchImpl = providerFetch(state);
  const host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
    integrationFetch: fetchImpl,
    now: () => 1_900_000_000_000,
  });
  const cookie = await session(host, value.initialized.adminApiKey);
  await configure(host, cookie, 'adult-provider', '-jav');
  await host.close();

  const opened = openServices(value, fetchImpl);
  try {
    const searched =
      await opened.services.searchJavProviderIdentity({
        operationId: 'shared.integration.search@1',
        contentProfile: 'jav',
        javCode: 'SDKI-001',
      });
    assert.deepEqual(searched, {
      provider: 'jav',
      namespace: 'jav_code',
      providerKey: 'SDKI-001',
      integrationId: 'adult-provider-main',
      configRevision: 1,
    });
    const identityBasis = {
      provider: 'jav',
      namespace: 'jav_code',
      providerKey: 'SDKI-001',
      seasonNumber: null,
    };
    const identity = {
      ...identityBasis,
      identityAnchorDigest: canonicalDigest(identityBasis),
    };
    const intent = {
      sourceKind: 'provider',
      contentProfile: 'jav',
      providerKind: 'jav',
      integrationId: 'adult-provider-main',
      configRevision: 1,
      requestedFields: [
        'genre',
        'jav_code',
        'release_date',
        'studio',
        'title',
      ],
      resolvedProviderIdentity: identity,
    };
    const metadataHandle = opened.services.resolveProductHandle({
      intent,
      operationId: 'libra.product_metadata.fetch@1',
    });
    assert.equal(metadataHandle.integrationType, 'jav');
    const metadata =
      await opened.services.fetchJavProviderMetadata({
        metadataFetchIntent: intent,
        integrationHandle: metadataHandle,
      });
    assert.equal(metadata.providerKind, 'jav');
    assert.deepEqual(
      metadata.descriptiveEntries.map((entry) => entry.key),
      intent.requestedFields,
    );
    assert.equal(metadata.peopleHints.length, 1);
    assert.equal(metadata.peopleHints[0].displayName, 'Actor');

    const artifactHandle = opened.services.resolveProductHandle({
      intent,
      operationId: 'libra.product_artifact.acquire@1',
      artifactKind: 'poster',
    });
    const artifact =
      await opened.services.fetchJavProviderArtifact({
        integrationHandle: artifactHandle,
        artifactKind: 'poster',
        resolvedProviderIdentity: identity,
      });
    assert.equal(artifact.resultKind, 'acquired');
    assert.equal(artifact.mediaType, 'image/jpeg');
    assert.ok(Buffer.isBuffer(artifact.bytes));
    assert.ok(state.calls.some((call) =>
      call.host === 'cdn.theporndb.net'));
  } finally {
    opened.kernel.close();
  }
});

test('H1.2 JAV Product handles and artifact URLs fail closed before foreign transport', async () => {
  const value = fixture();
  const state = { calls: [] };
  const fetchImpl = providerFetch(state);
  const host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
    integrationFetch: fetchImpl,
    now: () => 1_900_000_000_000,
  });
  const cookie = await session(host, value.initialized.adminApiKey);
  await configure(host, cookie, 'adult-provider', '-fences');
  await host.close();

  const opened = openServices(value, fetchImpl);
  try {
    const identityBasis = {
      provider: 'jav',
      namespace: 'jav_code',
      providerKey: 'SDKI-001',
      seasonNumber: null,
    };
    const identity = {
      ...identityBasis,
      identityAnchorDigest: canonicalDigest(identityBasis),
    };
    const intent = {
      sourceKind: 'provider',
      contentProfile: 'jav',
      providerKind: 'jav',
      integrationId: 'adult-provider-main',
      configRevision: 1,
      requestedFields: [
        'genre',
        'jav_code',
        'release_date',
        'studio',
        'title',
      ],
      resolvedProviderIdentity: identity,
    };
    const metadataHandle = opened.services.resolveProductHandle({
      intent,
      operationId: 'libra.product_metadata.fetch@1',
    });
    const metadataMutations = [
      { handleId: '0'.repeat(64) },
      { fenceDigest: '0'.repeat(64) },
      { integrationType: 'adult-provider' },
      { secretRef: 'integration-secret:foreign' },
      { configRevision: 9 },
      { allowedOperation: 'libra.product_artifact.acquire@1' },
    ];
    for (const mutation of metadataMutations) {
      const before = state.calls.length;
      await assert.rejects(
        () => opened.services.fetchJavProviderMetadata({
          metadataFetchIntent: intent,
          integrationHandle: {
            ...metadataHandle,
            ...mutation,
          },
        }),
        (error) => error.code === 'P5_PROVIDER_HANDLE_DENIED',
      );
      assert.equal(state.calls.length, before);
    }

    const artifactHandle = opened.services.resolveProductHandle({
      intent,
      operationId: 'libra.product_artifact.acquire@1',
      artifactKind: 'poster',
    });
    for (const mutation of [
      { handleId: 'f'.repeat(64) },
      { fenceDigest: 'f'.repeat(64) },
      { secretRef: 'integration-secret:foreign' },
      { allowedOperation: 'libra.product_metadata.fetch@1' },
    ]) {
      const before = state.calls.length;
      await assert.rejects(
        () => opened.services.fetchJavProviderArtifact({
          integrationHandle: {
            ...artifactHandle,
            ...mutation,
          },
          artifactKind: 'poster',
          resolvedProviderIdentity: identity,
        }),
        (error) => error.code === 'P5_PROVIDER_HANDLE_DENIED',
      );
      assert.equal(state.calls.length, before);
    }
    await assert.rejects(
      () => opened.services.fetchJavProviderArtifact({
        integrationHandle: artifactHandle,
        artifactKind: 'fanart',
        resolvedProviderIdentity: identity,
      }),
      (error) => error.code === 'P5_PROVIDER_HANDLE_DENIED',
    );
    await assert.rejects(
      () => opened.services.fetchJavProviderArtifact({
        integrationHandle: artifactHandle,
        artifactKind: 'subtitle',
        resolvedProviderIdentity: identity,
      }),
      (error) => error.code === 'P5_PROVIDER_HANDLE_DENIED',
    );

    state.adultDuplicate = true;
    await assert.rejects(
      () => opened.services.searchJavProviderIdentity({
        operationId: 'shared.integration.search@1',
        contentProfile: 'jav',
        javCode: 'SDKI-001',
      }),
      (error) => error.code === 'P5_SECRET_LEASE_INVOCATION_FAILED',
    );
    state.adultDuplicate = false;
    state.adultSearchOverflow = true;
    await assert.rejects(
      () => opened.services.searchJavProviderIdentity({
        operationId: 'shared.integration.search@1',
        contentProfile: 'jav',
        javCode: 'SDKI-001',
      }),
      (error) => error.code === 'P5_SECRET_LEASE_INVOCATION_FAILED',
    );
    state.adultSearchOverflow = false;
    state.adultForeignCode = 'ABCD-999';
    await assert.rejects(
      () => opened.services.fetchJavProviderMetadata({
        metadataFetchIntent: intent,
        integrationHandle: metadataHandle,
      }),
      (error) => error.code === 'P5_SECRET_LEASE_INVOCATION_FAILED',
    );
    state.adultForeignCode = null;
    state.adultLongTitle = 'x'.repeat(2049);
    await assert.rejects(
      () => opened.services.fetchJavProviderMetadata({
        metadataFetchIntent: intent,
        integrationHandle: metadataHandle,
      }),
      (error) => error.code === 'P5_SECRET_LEASE_INVOCATION_FAILED',
    );
    state.adultLongTitle = null;

    for (const artifactUrl of [
      'https://[::1]/poster.jpg',
      'https://[fc00::1]/poster.jpg',
      'https://[fe80::1]/poster.jpg',
      'https://[::ffff:127.0.0.1]/poster.jpg',
      'https://user@cdn.theporndb.net/poster.jpg',
      'https://attacker.example/poster.jpg',
    ]) {
      state.artifactUrl = artifactUrl;
      const before = state.calls.length;
      await assert.rejects(
        () => opened.services.fetchJavProviderArtifact({
          integrationHandle: artifactHandle,
          artifactKind: 'poster',
          resolvedProviderIdentity: identity,
        }),
        (error) => error.code === 'P5_PROVIDER_RESPONSE_INVALID',
      );
      assert.equal(state.calls.length, before + 1);
      assert.equal(
        state.calls.slice(before).some((call) =>
          call.host !== 'api.theporndb.net'),
        false,
      );
    }

    state.artifactUrl = 'https://cdn.theporndb.net/poster.jpg';
    state.artifactRedirect = true;
    const beforeRedirect = state.calls.length;
    await assert.rejects(
      () => opened.services.fetchJavProviderArtifact({
        integrationHandle: artifactHandle,
        artifactKind: 'poster',
        resolvedProviderIdentity: identity,
      }),
      (error) => error.code === 'P5_PROVIDER_TRANSPORT_FAILED',
    );
    const redirectCalls = state.calls.slice(beforeRedirect);
    assert.equal(redirectCalls.length, 2);
    assert.equal(redirectCalls[1].host, 'cdn.theporndb.net');
    assert.equal(redirectCalls[1].redirect, 'error');
  } finally {
    opened.kernel.close();
  }
});

test('H1.2 Douban observations are fenced to the configured user before transport and after response', async () => {
  const value = fixture();
  const state = { calls: [] };
  const fetchImpl = providerFetch(state);
  const host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
    integrationFetch: fetchImpl,
    now: () => 1_900_000_000_000,
  });
  const cookie = await session(host, value.initialized.adminApiKey);
  await configure(host, cookie, 'douban', '-identity');
  await host.close();
  const opened = openServices(value, fetchImpl);
  try {
    const before = state.calls.length;
    await assert.rejects(
      () => opened.services.executeProvider('douban', {
        operationId: 'perception.source.acquire@1',
        effectClass: 'pure_observation',
        idempotencyKey: 'foreign-douban-user',
        timeoutMs: 5_000,
        input: {
          sourceRef: ref('perception-source', 'other-user'),
          cursor: null,
          limit: 20,
        },
      }),
      (error) => error.code === 'P5_PROVIDER_TRANSPORT_FAILED',
    );
    assert.equal(state.calls.length, before);

    state.doubanResponseUser = 'other-user';
    await assert.rejects(
      () => opened.services.executeProvider('douban', {
        operationId: 'perception.source.acquire@1',
        effectClass: 'pure_observation',
        idempotencyKey: 'foreign-douban-page',
        timeoutMs: 5_000,
        input: {
          sourceRef: ref('perception-source', 'test-user'),
          cursor: null,
          limit: 20,
        },
      }),
      (error) => error.code === 'P5_PROVIDER_TRANSPORT_FAILED',
    );
  } finally {
    opened.kernel.close();
  }
});

test('H1.2 target, credential, endpoint, and provider boundaries fail closed without fallback', async () => {
  const value = fixture();
  const state = { calls: [] };
  const host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
    integrationFetch: providerFetch(state),
    now: () => 1_900_000_000_000,
  });
  const cookie = await session(host, value.initialized.adminApiKey);

  const mismatch = await host.inject({
    method: 'POST',
    url: '/v1/admin/settings/integrations/douban/actions/test',
    headers: { cookie },
    payload: {
      kind: 'moviepilot',
      idempotencyKey: 'target-mismatch',
      ...commands.douban,
    },
  });
  assert.equal(mismatch.statusCode, 400);
  assert.equal(
    mismatch.json().error.code,
    'PLATFORM_INTEGRATION_TARGET_MISMATCH',
  );

  const publicEndpoint = await host.inject({
    method: 'POST',
    url: '/v1/admin/settings/integrations/moviepilot/actions/test',
    headers: { cookie },
    payload: {
      kind: 'moviepilot',
      idempotencyKey: 'insecure-endpoint',
      endpoint: 'http://example.com',
      credential: commands.moviepilot.credential,
    },
  });
  assert.equal(publicEndpoint.statusCode, 400);
  assert.equal(state.calls.length, 0);

  const unknown = await host.inject({
    method: 'GET',
    url: '/v1/admin/settings/integrations/unknown-provider',
    headers: { cookie },
  });
  assert.equal(unknown.statusCode, 200);
  assert.equal(unknown.json().state, 'unsupported');
  assert.equal(inspect(value.dataDir).integrations.length, 0);
  await host.close();
});

test('H1.2 historical provider commands replay without reusing proofs or rolling back the active head', async () => {
  const value = fixture();
  const state = { calls: [] };
  const host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
    integrationFetch: providerFetch(state),
    now: () => 1_900_000_000_000,
  });
  const cookie = await session(host, value.initialized.adminApiKey);
  const command = commands.douban;
  const tested = await host.inject({
    method: 'POST',
    url: '/v1/admin/settings/integrations/douban/actions/test',
    headers: { cookie },
    payload: {
      kind: 'douban',
      idempotencyKey: 'douban-history-test',
      endpoint: command.endpoint,
      credential: command.credential,
      settings: command.settings,
      timeoutMs: 5_000,
    },
  });
  assert.equal(tested.statusCode, 200, tested.body);
  const savePayload = {
    kind: 'douban',
    idempotencyKey: 'douban-history-save',
    expectedConfigRevision: 0,
    connectionProofId: tested.json().connectionProofId,
  };
  const saved = await host.inject({
    method: 'PATCH',
    url: '/v1/admin/settings/integrations/douban',
    headers: { cookie },
    payload: savePayload,
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const disconnected = await host.inject({
    method: 'POST',
    url: '/v1/admin/settings/integrations/douban/actions/disconnect',
    headers: { cookie },
    payload: {
      kind: 'douban',
      idempotencyKey: 'douban-history-disconnect',
      expectedConfigRevision: 1,
    },
  });
  assert.equal(disconnected.statusCode, 200, disconnected.body);
  assert.equal(disconnected.json().configRevision, 2);
  assert.equal(disconnected.json().state, 'disabled');
  const networkCount = state.calls.length;
  const replay = await host.inject({
    method: 'PATCH',
    url: '/v1/admin/settings/integrations/douban',
    headers: { cookie },
    payload: savePayload,
  });
  assert.equal(replay.statusCode, 200, replay.body);
  assert.deepEqual(replay.json(), saved.json());
  assert.equal(state.calls.length, networkCount);
  const current = await host.inject({
    method: 'GET',
    url: '/v1/admin/settings/integrations/douban',
    headers: { cookie },
  });
  assert.equal(current.statusCode, 200, current.body);
  assert.equal(current.json().configRevision, 2);
  assert.equal(current.json().state, 'disabled');
  await host.close();
});

test('H1.2 persisted endpoint and cross-provider envelope drift fail before Secret consumption or network', async () => {
  const value = fixture();
  const state = { calls: [] };
  const fetchImpl = providerFetch(state);
  const host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
    integrationFetch: fetchImpl,
    now: () => 1_900_000_000_000,
  });
  const cookie = await session(host, value.initialized.adminApiKey);
  await configure(host, cookie, 'adult-provider', '-drift');
  await configure(host, cookie, 'moviepilot', '-drift');
  await host.close();
  const database = new Database(path.join(value.dataDir, 'shelfdeck.db'));
  try {
    database.prepare(
      'UPDATE platform_integrations SET endpoint=? ' +
      'WHERE integration_id=?',
    ).run('https://attacker.example', 'moviepilot-main');
    const moviepilotLocator = database.prepare(
      'SELECT encrypted_ref FROM platform_secret_refs ' +
      'WHERE secret_ref=?',
    ).get('integration-secret:moviepilot-main').encrypted_ref;
    database.prepare(
      'UPDATE platform_secret_refs SET encrypted_ref=? ' +
      'WHERE secret_ref=?',
    ).run(
      moviepilotLocator,
      'integration-secret:adult-provider-main',
    );
  } finally {
    database.close();
  }
  state.calls.length = 0;
  const opened = openServices(value, fetchImpl);
  try {
    assert.throws(
      () => opened.services.isActive('moviepilot'),
      (error) => error.code ===
        'PLATFORM_INTEGRATION_CONFIG_CORRUPT',
    );
    assert.throws(
      () => opened.services.isActive('adult-provider'),
      (error) => error.code ===
        'PLATFORM_INTEGRATION_CONFIG_CORRUPT',
    );
    assert.equal(state.calls.length, 0);
  } finally {
    opened.kernel.close();
  }
});

test('H1.2 official response projections accept bounded documented extras and source contains no legacy protocol', async () => {
  const value = fixture();
  const state = { calls: [] };
  const fetchImpl = providerFetch(state);
  const host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
    integrationFetch: fetchImpl,
    now: () => 1_900_000_000_000,
  });
  const cookie = await session(host, value.initialized.adminApiKey);
  await configure(host, cookie, 'adult-provider', '-closed');
  await host.close();
  const opened = openServices(value, fetchImpl);
  try {
    const projected = await opened.services.executeProvider(
      'adult-provider',
      {
        operationId: 'libra.product_metadata.fetch@1',
        effectClass: 'pure_observation',
        idempotencyKey: 'adult-official-response',
        timeoutMs: 5_000,
        input: {
          productIdentityRef: ref(
            'product-identity',
            'SDKI-001',
          ),
          locale: 'en-US',
        },
      },
    );
    assert.equal(projected.result.resultRef.objectId, 'SDKI-001');
  } finally {
    opened.kernel.close();
  }

  for (const relative of [
    '../../src/helix/integrations/h1-provider-adapters.js',
    '../../src/helix/integrations/jav-product-provider-adapter.js',
    '../../src/helix/platform/application/integration-profile-catalog.js',
  ]) {
    const source = fs.readFileSync(
      path.resolve(__dirname, relative),
      'utf8',
    ).toLowerCase();
    for (const forbidden of [
      'process.' + 'env',
      '/services/',
      'config' + 'store',
      'metadata' + 'provideradapter',
      'moviepilot' + 'service',
      'emby' + 'service',
      'douban' + 'service',
      'fallback',
      '/graph' + 'ql',
      'find' + 'scenes',
      'find' + 'scene(',
      'search' + 'performer',
    ]) {
      assert.equal(source.includes(forbidden), false, relative + ':' + forbidden);
    }
  }
  const adminSource = fs.readFileSync(
    path.resolve(
      __dirname,
      '../../src/helix/platform/application/' +
        'integration-admin-application.js',
    ),
    'utf8',
  );
  assert.match(
    adminSource,
    /returnedPersistedSecretBytes\.fill\(0\)/,
  );
  const providerSource = fs.readFileSync(
    path.resolve(
      __dirname,
      '../../src/helix/integrations/h1-provider-adapters.js',
    ),
    'utf8',
  );
  assert.match(providerSource, /response\.bytes\.fill\(0\)/);
});
