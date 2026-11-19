'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { openSqliteKernel } = require('../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createIntegrationRepository } = require('../src/helix/platform/persistence/integration-repository');
const { createIntegrationCommandReceiptRepository } = require('../src/helix/platform/persistence/integration-command-receipt-repository');
const { createIntegrationSecretStore } = require('../src/clean-service-host');
const { requireIntegrationProfile } = require('../src/helix/platform/application/integration-profile-catalog');
const { createNetworkPolicy, createPlatformIntegrationRuntime, createIntegrationAdminApplication } = require('../src/helix/platform/public/integration-runtime');
const { normalizeProxyServer } = require('../src/helix/platform/application/network-policy');
const { javSourceProfileDefinitions } = require('../src/helix/platform/application/jav-source-integration');
const { createNetworkFetch } = require('../src/helix/integrations/network-fetch');
const { createTmdbProviderAdapter } = require('../src/helix/integrations/tmdb-provider-adapter');
const { createJavSourceProviderAdapter } = require('../src/helix/integrations/jav-source-provider-adapter');

const CONFIRM = 'APPLY_PLATFORM_PROXY_MIGRATION_V1';
const RECEIPT_SCHEMA = 'platform.proxy-migration@1';
const GENERATED_ROOT = path.join(__dirname, '..', 'src', 'helix', 'foundation', 'persistence', 'generated');

class PlatformProxyMigrationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PlatformProxyMigrationError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new PlatformProxyMigrationError(code, message, details);
}

function assertNotFrozen(dataDir) {
  const resolved = path.resolve(dataDir);
  const parts = resolved.split(path.sep);
  if (parts.includes('frozen') || parts.includes('coldbackup') || resolved.includes(`${path.sep}frozen${path.sep}`)) {
    fail('PLATFORM_PROXY_MIGRATION_FROZEN_PATH', 'Platform proxy migration refuses a frozen or cold-backup data directory.');
  }
}

function parseArgs(argv) {
  const out = { dataDir: '', proxy: '', retestJav: false, apply: false, confirm: '', receipt: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') out.apply = true;
    else if (arg === '--retest-jav') out.retestJav = true;
    else if (arg === '--data-dir') out.dataDir = argv[++i] || '';
    else if (arg.startsWith('--data-dir=')) out.dataDir = arg.slice('--data-dir='.length);
    else if (arg === '--proxy') out.proxy = argv[++i] || '';
    else if (arg.startsWith('--proxy=')) out.proxy = arg.slice('--proxy='.length);
    else if (arg === '--confirm') out.confirm = argv[++i] || '';
    else if (arg.startsWith('--confirm=')) out.confirm = arg.slice('--confirm='.length);
    else if (arg === '--receipt') out.receipt = argv[++i] || '';
    else if (arg.startsWith('--receipt=')) out.receipt = arg.slice('--receipt='.length);
    else fail('PLATFORM_PROXY_MIGRATION_ARG_INVALID', `Unknown argument: ${arg}`);
  }
  if (!out.dataDir || !path.isAbsolute(out.dataDir)) {
    fail('PLATFORM_PROXY_MIGRATION_DATA_DIR', 'An explicit absolute --data-dir is required.');
  }
  assertNotFrozen(out.dataDir);
  if (out.proxy === '' && !argv.some((a) => a === '--proxy' || a.startsWith('--proxy='))) {
    fail('PLATFORM_PROXY_MIGRATION_PROXY_REQUIRED', 'An explicit --proxy origin (or empty string for direct) is required.');
  }
  return out;
}

function loadSchemaFiles() {
  return {
    schemaDdl: fs.readFileSync(path.join(GENERATED_ROOT, 'clean-schema.sql'), 'utf8'),
    schemaManifest: JSON.parse(fs.readFileSync(path.join(GENERATED_ROOT, 'clean-schema.manifest.json'), 'utf8')),
  };
}

function inspectReadonlyPlan(databasePath, targetProxy) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const rows = database.prepare(
      'SELECT integration_id, integration_type, endpoint, config_revision, state, config_json FROM platform_integrations ORDER BY integration_id',
    ).all();
    const byId = new Map();
    for (const row of rows) {
      let config = {};
      try { config = JSON.parse(row.config_json); } catch {}
      byId.set(row.integration_id, { ...row, config });
    }
    const net = byId.get('network-main');
    const netProxy = net?.config?.proxyServer || '';
    const tmdb = byId.get('tmdb-main');
    const tmdbProxy = tmdb?.config?.settings?.proxyServer || '';
    const javProfiles = javSourceProfileDefinitions().map((def) => requireIntegrationProfile(def.kind));
    const jav = javProfiles.map((profile) => {
      const row = byId.get(profile.integrationId);
      const currentEndpoint = row?.config?.settings?.networkRoute?.proxyEndpoint || null;
      return {
        kind: profile.kind,
        integrationId: profile.integrationId,
        state: row?.state || 'unconfigured',
        configRevision: row?.config_revision || 0,
        currentProxyEndpoint: currentEndpoint,
        needsUpdate: row?.state === 'active' && currentEndpoint !== (targetProxy || null),
      };
    });
    return {
      network: {
        integrationId: 'network-main',
        state: net?.state || 'unconfigured',
        configRevision: net?.config_revision || 0,
        currentProxyServer: netProxy,
        needsUpdate: netProxy !== targetProxy,
      },
      tmdb: {
        integrationId: 'tmdb-main',
        state: tmdb?.state || 'unconfigured',
        configRevision: tmdb?.config_revision || 0,
        language: tmdb?.config?.settings?.language || 'zh-CN',
        currentProxyServer: tmdbProxy,
        needsUpdate: tmdb?.state === 'active' && tmdbProxy !== targetProxy,
      },
      jav,
    };
  } finally {
    database.close();
  }
}

async function migratePlatformProxy(options) {
  const dataDir = path.resolve(options.dataDir);
  assertNotFrozen(dataDir);
  const databasePath = path.join(dataDir, 'shelfdeck.db');
  if (!fs.existsSync(databasePath)) {
    fail('PLATFORM_PROXY_MIGRATION_DB_MISSING', 'shelfdeck.db does not exist under dataDir.');
  }
  const targetProxy = normalizeProxyServer(options.proxy);
  const plan = inspectReadonlyPlan(databasePath, targetProxy);
  const hasPending = plan.network.needsUpdate || plan.tmdb.needsUpdate || (options.retestJav && plan.jav.some((item) => item.needsUpdate));

  if (!options.apply) {
    return Object.freeze({
      schema: RECEIPT_SCHEMA,
      mode: hasPending ? 'dry-run' : 'already-applied',
      changed: false,
      targetProxy,
      retestJav: Boolean(options.retestJav),
      plan,
    });
  }

  if (options.confirm !== CONFIRM) {
    fail('PLATFORM_PROXY_MIGRATION_CONFIRMATION_REQUIRED', 'Explicit migration confirmation is required.');
  }

  const secretRoot = options.secretRoot || process.env.SHELFDECK_SECRET_ROOT || '';
  if (typeof secretRoot !== 'string' || Buffer.byteLength(secretRoot, 'utf8') < 32) {
    fail('PLATFORM_INTEGRATION_SECRET_ROOT_REQUIRED', 'SHELFDECK_SECRET_ROOT must provide at least 32 UTF-8 bytes.');
  }

  const now = options.now || Date.now;
  const { schemaDdl, schemaManifest } = loadSchemaFiles();
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const repository = createIntegrationRepository({ schemaManifest, unitOfWork });
  const receiptRepository = createIntegrationCommandReceiptRepository({ schemaManifest, unitOfWork });
  const secretStore = createIntegrationSecretStore({ dataDir, secretRoot });
  const networkPolicy = createNetworkPolicy({ repository, receiptRepository, now });
  const networkFetch = createNetworkFetch({ networkPolicy, fetchImpl: options.fetchImpl });

  try {
    const proxyHash = crypto.createHash('sha256').update(targetProxy || 'direct').digest('hex').slice(0, 12);
    let changed = false;

    const netBefore = networkPolicy.get();
    let netAfter = netBefore;
    if (netBefore.settings.proxyServer !== targetProxy) {
      netAfter = networkPolicy.configure('network', {
        kind: 'network',
        expectedConfigRevision: netBefore.configRevision,
        idempotencyKey: `proxy-mig-net:rev-${netBefore.configRevision}:${proxyHash}`,
        settings: { proxyServer: targetProxy },
      });
      changed = true;
    }

    const tmdbProfile = requireIntegrationProfile('tmdb');
    const tmdbRuntime = createPlatformIntegrationRuntime({
      profile: tmdbProfile,
      networkPolicy,
      repository,
      secretStore,
      now,
      createId: crypto.randomUUID,
      digest: (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex'),
    });
    const tmdbAdapter = createTmdbProviderAdapter({
      integrationQueryPort: tmdbRuntime.integrationQueryPort,
      integrationHandleResolverPort: tmdbRuntime.integrationHandleResolverPort,
      secretLeaseResolverPort: tmdbRuntime.secretLeaseResolverPort,
      secretLeaseConsumer: tmdbRuntime.broker,
      fetchImpl: networkFetch,
      now,
    });
    const tmdbAdmin = createIntegrationAdminApplication({
      profile: tmdbProfile,
      networkPolicy,
      repository,
      secretStore,
      adapter: tmdbAdapter,
      receiptRepository,
      now,
      createId: crypto.randomUUID,
    });

    const tmdbBefore = tmdbAdmin.get('tmdb');
    let tmdbAfter = tmdbBefore;
    if (tmdbBefore.configured && tmdbBefore.state === 'active' && tmdbBefore.settings?.proxyServer !== targetProxy) {
      tmdbAfter = tmdbAdmin.updateSettings('tmdb', {
        kind: 'tmdb',
        expectedConfigRevision: tmdbBefore.configRevision,
        idempotencyKey: `proxy-mig-tmdb:rev-${tmdbBefore.configRevision}:${proxyHash}`,
        settings: {
          language: tmdbBefore.settings?.language || 'zh-CN',
          proxyServer: targetProxy,
        },
      });
      changed = true;
    }

    const javResults = [];
    if (options.retestJav) {
      const buildJavAdapter = options.createJavAdapter || createJavSourceProviderAdapter;
      for (const def of javSourceProfileDefinitions()) {
        const profile = requireIntegrationProfile(def.kind);
        const javRuntime = createPlatformIntegrationRuntime({
          profile,
          networkPolicy,
          repository,
          secretStore,
          now,
          createId: crypto.randomUUID,
          digest: (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex'),
        });
        const javAdapter = buildJavAdapter({ runtime: javRuntime, networkPolicy, fetchImpl: networkFetch, now });
        const javAdmin = createIntegrationAdminApplication({
          profile,
          networkPolicy,
          repository,
          secretStore,
          adapter: javAdapter,
          receiptRepository,
          now,
          createId: crypto.randomUUID,
        });
        const javBefore = javAdmin.get(profile.kind);
        if (!javBefore.configured || javBefore.state !== 'active') {
          javResults.push({ kind: profile.kind, status: 'unchanged', state: javBefore.state });
          continue;
        }
        const expectedEndpoint = targetProxy || null;
        if (javBefore.settings?.networkRoute?.proxyEndpoint === expectedEndpoint) {
          javResults.push({ kind: profile.kind, status: 'already-aligned', configRevision: javBefore.configRevision });
          continue;
        }
        try {
          const testRes = await javAdmin.test(profile.kind, {
            kind: profile.kind,
            idempotencyKey: `proxy-mig-test:${profile.kind}:rev-${javBefore.configRevision}:${proxyHash}`,
            endpoint: javBefore.endpoint,
            credential: { kind: 'anonymous' },
            timeoutMs: options.javTimeoutMs || 20_000,
          });
          const configured = javAdmin.configure(profile.kind, {
            kind: profile.kind,
            idempotencyKey: `proxy-mig-cfg:${profile.kind}:rev-${javBefore.configRevision}:${proxyHash}`,
            expectedConfigRevision: javBefore.configRevision,
            connectionProofId: testRes.connectionProofId,
          });
          changed = true;
          javResults.push({
            kind: profile.kind,
            status: 'updated',
            previousRevision: javBefore.configRevision,
            configRevision: configured.configRevision,
            proxyEndpoint: configured.settings?.networkRoute?.proxyEndpoint || null,
          });
        } catch (error) {
          javResults.push({
            kind: profile.kind,
            status: 'retest_skipped',
            errorCode: error.code || 'JAV_RETEST_FAILED',
            message: error.message,
          });
        }
      }
    }

    return Object.freeze({
      schema: RECEIPT_SCHEMA,
      mode: changed ? 'applied' : 'already-applied',
      changed,
      targetProxy,
      network: {
        previousRevision: netBefore.configRevision,
        configRevision: netAfter.configRevision,
        proxyServer: netAfter.settings.proxyServer,
      },
      tmdb: {
        state: tmdbAfter.state,
        previousRevision: tmdbBefore.configRevision,
        configRevision: tmdbAfter.configRevision,
        language: tmdbAfter.settings?.language || null,
        proxyServer: tmdbAfter.settings?.proxyServer || '',
      },
      javResults,
    });
  } finally {
    await networkFetch.close();
    kernel.close();
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const receipt = await migratePlatformProxy(args);
  if (args.receipt) {
    fs.mkdirSync(path.dirname(args.receipt), { recursive: true });
    fs.writeFileSync(args.receipt, `${JSON.stringify(receipt, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      code: error.code || 'PLATFORM_PROXY_MIGRATION_FAILED',
      message: error.message,
      details: error.details || {},
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({ CONFIRM, RECEIPT_SCHEMA, PlatformProxyMigrationError, migratePlatformProxy, parseArgs });
