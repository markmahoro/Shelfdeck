'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { openSqliteKernel } = require('../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createIntegrationRepository } = require('../src/helix/platform/persistence/integration-repository');
const { createIntegrationCommandReceiptRepository } = require('../src/helix/platform/persistence/integration-command-receipt-repository');
const { createIntegrationSecretStore } = require('../src/clean-service-host');
const { requireIntegrationProfile } = require('../src/helix/platform/application/integration-profile-catalog');
const { createNetworkPolicy, createPlatformIntegrationRuntime, createIntegrationAdminApplication } = require('../src/helix/platform/public/integration-runtime');
const { createNetworkFetch } = require('../src/helix/integrations/network-fetch');
const { createTmdbProviderAdapter } = require('../src/helix/integrations/tmdb-provider-adapter');
const { CONFIRM, migratePlatformProxy } = require('../scripts/helix-platform-proxy-migration');

const GENERATED_ROOT = path.join(__dirname, '..', 'src', 'helix', 'foundation', 'persistence', 'generated');

async function seedFixture(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-proxy-migration-'));
  const dataDir = path.join(rootDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const secretRoot = 'fixture-secret-root-at-least-32-bytes-long-0123456789';
  const databasePath = path.join(dataDir, 'shelfdeck.db');
  const schemaDdl = fs.readFileSync(path.join(GENERATED_ROOT, 'clean-schema.sql'), 'utf8');
  const schemaManifest = JSON.parse(fs.readFileSync(path.join(GENERATED_ROOT, 'clean-schema.manifest.json'), 'utf8'));
  const kernel = openSqliteKernel({ Database: require('better-sqlite3'), databasePath, schemaDdl, schemaManifest, now: () => 1700000000000 });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const repository = createIntegrationRepository({ schemaManifest, unitOfWork });
  const receiptRepository = createIntegrationCommandReceiptRepository({ schemaManifest, unitOfWork });
  const secretStore = createIntegrationSecretStore({ dataDir, secretRoot });
  const networkPolicy = createNetworkPolicy({ repository, receiptRepository, now: () => 1700000000000 });

  networkPolicy.configure('network', {
    kind: 'network',
    expectedConfigRevision: 0,
    idempotencyKey: 'seed-net-1',
    settings: { proxyServer: 'http://192.168.12.230:7890' },
  });

  const tmdbProfile = requireIntegrationProfile('tmdb');
  const tmdbRuntime = createPlatformIntegrationRuntime({
    profile: tmdbProfile,
    networkPolicy,
    repository,
    secretStore,
    now: () => 1700000000000,
    createId: crypto.randomUUID,
    digest: (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex'),
  });
  const fakeFetch = async (url) => {
    const href = String(url);
    if (href.includes('/configuration')) {
      return new Response(JSON.stringify({ images: { secure_base_url: 'https://image.tmdb.org/t/p/', poster_sizes: ['w500'], backdrop_sizes: ['w1280'], profile_sizes: ['w185'] } }), { status: 200 });
    }
    if (href.includes('/movie/550')) {
      return new Response(JSON.stringify({ id: 550, title: 'Fight Club', release_date: '1999-10-15', overview: 'ok', genres: [{ id: 18, name: 'Drama' }], credits: { cast: [], crew: [] } }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
  const networkFetch = createNetworkFetch({ networkPolicy, fetchImpl: fakeFetch });
  const tmdbAdapter = createTmdbProviderAdapter({
    integrationQueryPort: tmdbRuntime.integrationQueryPort,
    integrationHandleResolverPort: tmdbRuntime.integrationHandleResolverPort,
    secretLeaseResolverPort: tmdbRuntime.secretLeaseResolverPort,
    secretLeaseConsumer: tmdbRuntime.broker,
    fetchImpl: networkFetch,
    now: () => 1700000000000,
  });
  const tmdbAdmin = createIntegrationAdminApplication({
    profile: tmdbProfile,
    networkPolicy,
    repository,
    secretStore,
    adapter: tmdbAdapter,
    receiptRepository,
    now: () => 1700000000000,
    createId: crypto.randomUUID,
  });

  const tested = await tmdbAdmin.test('tmdb', {
    kind: 'tmdb',
    idempotencyKey: 'seed-tmdb-test-1',
    endpoint: 'https://api.themoviedb.org/3',
    credential: { kind: 'api_key', value: 'tmdb-fixture-key-1234567890' },
    settings: { language: 'zh-CN', proxyServer: 'http://192.168.12.230:7890' },
  });
  tmdbAdmin.configure('tmdb', {
    kind: 'tmdb',
    idempotencyKey: 'seed-tmdb-cfg-1',
    expectedConfigRevision: 0,
    connectionProofId: tested.connectionProofId,
  });

  await networkFetch.close();
  kernel.close();
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  return { dataDir, databasePath, secretRoot };
}

test('dry-run reports pending network and tmdb proxy updates without mutating sqlite', async (t) => {
  const fixture = await seedFixture(t);
  const beforeBytes = fs.readFileSync(fixture.databasePath);
  const receipt = await migratePlatformProxy({ dataDir: fixture.dataDir, proxy: 'http://192.168.12.219:7890' });
  assert.equal(receipt.mode, 'dry-run');
  assert.equal(receipt.changed, false);
  assert.equal(receipt.plan.network.currentProxyServer, 'http://192.168.12.230:7890');
  assert.equal(receipt.plan.network.needsUpdate, true);
  assert.equal(receipt.plan.tmdb.currentProxyServer, 'http://192.168.12.230:7890');
  assert.equal(receipt.plan.tmdb.needsUpdate, true);
  assert.deepEqual(fs.readFileSync(fixture.databasePath), beforeBytes);
});

test('apply updates network and tmdb proxy preserving secret and is idempotent on replay', async (t) => {
  const fixture = await seedFixture(t);
  const receipt = await migratePlatformProxy({
    dataDir: fixture.dataDir,
    proxy: 'http://192.168.12.219:7890',
    secretRoot: fixture.secretRoot,
    apply: true,
    confirm: CONFIRM,
  });
  assert.equal(receipt.mode, 'applied');
  assert.equal(receipt.changed, true);
  assert.equal(receipt.network.configRevision, 2);
  assert.equal(receipt.network.proxyServer, 'http://192.168.12.219:7890');
  assert.equal(receipt.tmdb.configRevision, 2);
  assert.equal(receipt.tmdb.proxyServer, 'http://192.168.12.219:7890');
  assert.equal(receipt.tmdb.language, 'zh-CN');

  // Verify the TMDB secret envelope at revision 2 still decrypts cleanly to the original key.
  const secretStore = createIntegrationSecretStore({ dataDir: fixture.dataDir, secretRoot: fixture.secretRoot });
  const schemaManifest = JSON.parse(fs.readFileSync(path.join(GENERATED_ROOT, 'clean-schema.manifest.json'), 'utf8'));
  const Database = require('better-sqlite3');
  const db = new Database(fixture.databasePath, { readonly: true });
  const tmdbSecretRef = requireIntegrationProfile('tmdb').secretRef;
  const row = db.prepare("SELECT config_json FROM platform_integrations WHERE integration_id='tmdb-main'").get();
  const sec = db.prepare('SELECT * FROM platform_secret_refs WHERE secret_ref = ?').get(tmdbSecretRef);
  db.close();
  const config = JSON.parse(row.config_json);
  const plain = secretStore.read(sec.encrypted_ref, {
    integrationId: 'tmdb-main',
    secretRef: tmdbSecretRef,
    secretKind: 'tmdb_api_key',
    revision: 2,
    envelopeDigest: config.secretEnvelopeDigest,
  });
  assert.equal(plain.toString('utf8'), 'tmdb-fixture-key-1234567890');
  plain.fill(0);

  const replay = await migratePlatformProxy({
    dataDir: fixture.dataDir,
    proxy: 'http://192.168.12.219:7890',
    secretRoot: fixture.secretRoot,
    apply: true,
    confirm: CONFIRM,
  });
  assert.equal(replay.mode, 'already-applied');
  assert.equal(replay.changed, false);
  assert.equal(schemaManifest.tableCount > 0, true);
});

test('frozen path and missing confirmation fail closed', async (t) => {
  const fixture = await seedFixture(t);
  await assert.rejects(
    () => migratePlatformProxy({ dataDir: path.join(fixture.dataDir, 'coldbackup'), proxy: 'http://192.168.12.219:7890' }),
    { code: 'PLATFORM_PROXY_MIGRATION_FROZEN_PATH' },
  );
  await assert.rejects(
    () => migratePlatformProxy({ dataDir: fixture.dataDir, proxy: 'http://192.168.12.219:7890', secretRoot: fixture.secretRoot, apply: true, confirm: 'WRONG' }),
    { code: 'PLATFORM_PROXY_MIGRATION_CONFIRMATION_REQUIRED' },
  );
});

test('retestJav inspects and updates active anonymous JAV source integrations', async (t) => {
  const fixture = await seedFixture(t);
  const javProfile = requireIntegrationProfile('jav-javdb');
  const stubJavAdapter = () => ({
    normalizedEndpoint: (v) => javProfile.normalizeEndpoint(v),
    async testCandidate(candidate) {
      return {
        result: 'passed',
        checkedAtMs: 1700000000000,
        endpointDigest: canonicalDigest({ endpoint: javProfile.normalizeEndpoint(candidate.endpoint) }),
        observationDigest: 'a'.repeat(64),
        identityNamespace: 'jav_code',
        identityProviderKey: javProfile.probeCode,
      };
    },
  });

  const schemaDdl = fs.readFileSync(path.join(GENERATED_ROOT, 'clean-schema.sql'), 'utf8');
  const schemaManifest = JSON.parse(fs.readFileSync(path.join(GENERATED_ROOT, 'clean-schema.manifest.json'), 'utf8'));
  const kernel = openSqliteKernel({ Database, databasePath: fixture.databasePath, schemaDdl, schemaManifest, now: () => 1700000000000 });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const repository = createIntegrationRepository({ schemaManifest, unitOfWork });
  const receiptRepository = createIntegrationCommandReceiptRepository({ schemaManifest, unitOfWork });
  const secretStore = createIntegrationSecretStore({ dataDir: fixture.dataDir, secretRoot: fixture.secretRoot });
  const networkPolicy = createNetworkPolicy({ repository, receiptRepository, now: () => 1700000000000 });
  const javRuntime = createPlatformIntegrationRuntime({
    profile: javProfile,
    networkPolicy,
    repository,
    secretStore,
    now: () => 1700000000000,
    createId: crypto.randomUUID,
    digest: (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex'),
  });
  const javAdmin = createIntegrationAdminApplication({
    profile: javProfile,
    networkPolicy,
    repository,
    secretStore,
    adapter: stubJavAdapter(),
    receiptRepository,
    now: () => 1700000000000,
    createId: crypto.randomUUID,
  });
  const tested = await javAdmin.test('jav-javdb', {
    kind: 'jav-javdb',
    idempotencyKey: 'seed-javdb-test-1',
    endpoint: 'https://javdb.com',
    credential: { kind: 'anonymous' },
  });
  javAdmin.configure('jav-javdb', {
    kind: 'jav-javdb',
    idempotencyKey: 'seed-javdb-cfg-1',
    expectedConfigRevision: 0,
    connectionProofId: tested.connectionProofId,
  });
  kernel.close();

  const dryRun = await migratePlatformProxy({
    dataDir: fixture.dataDir,
    proxy: 'http://192.168.12.219:7890',
    retestJav: true,
  });
  const javdbPlan = dryRun.plan.jav.find((item) => item.kind === 'jav-javdb');
  assert.equal(javdbPlan.integrationId, 'jav-javdb-main');
  assert.equal(javdbPlan.state, 'active');
  assert.equal(javdbPlan.currentProxyEndpoint, 'http://192.168.12.230:7890');
  assert.equal(javdbPlan.needsUpdate, true);

  const applied = await migratePlatformProxy({
    dataDir: fixture.dataDir,
    proxy: 'http://192.168.12.219:7890',
    secretRoot: fixture.secretRoot,
    retestJav: true,
    createJavAdapter: stubJavAdapter,
    apply: true,
    confirm: CONFIRM,
  });
  assert.equal(applied.mode, 'applied');
  assert.equal(applied.changed, true);
  const javdbResult = applied.javResults.find((item) => item.kind === 'jav-javdb');
  assert.deepEqual(javdbResult, {
    kind: 'jav-javdb',
    status: 'updated',
    previousRevision: 1,
    configRevision: 2,
    proxyEndpoint: 'http://192.168.12.219:7890',
  });

  const replay = await migratePlatformProxy({
    dataDir: fixture.dataDir,
    proxy: 'http://192.168.12.219:7890',
    secretRoot: fixture.secretRoot,
    retestJav: true,
    createJavAdapter: stubJavAdapter,
    apply: true,
    confirm: CONFIRM,
  });
  assert.equal(replay.mode, 'already-applied');
  assert.equal(replay.changed, false);
  const javdbReplay = replay.javResults.find((item) => item.kind === 'jav-javdb');
  assert.deepEqual(javdbReplay, {
    kind: 'jav-javdb',
    status: 'already-aligned',
    configRevision: 2,
  });
});
