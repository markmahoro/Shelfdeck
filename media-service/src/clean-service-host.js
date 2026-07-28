'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');
const routeRegistry = require('./helix/composition/admin-route-registry');
const { canonicalDigest } = require('./helix/contracts/canonical-json');
const { createHelixApplication } = require('./helix/composition/createHelixApplication');
const { createCleanFacades } = require('./helix/composition/create-clean-facades');
const {
  createIntegrationAdminApplication,
  createPlatformIntegrationRuntime,
} = require('./helix/platform/public/integration-runtime');
const {
  createIntegrationRepository,
} = require('./helix/platform/persistence/integration-repository');
const {
  createTmdbProviderAdapter,
} = require('./helix/integrations/tmdb-provider-adapter');
const {
  createProviderAdapter,
} = require('./helix/integrations/h1-provider-adapters');
const {
  createJavProductProviderAdapter,
} = require('./helix/integrations/jav-product-provider-adapter');
const {
  PROFILES,
  getIntegrationProfile,
} = require(
  './helix/platform/application/integration-profile-catalog'
);
const {
  buildProductIntegrationHandle,
} = require(
  './helix/platform/public/integration-adapter-support'
);
const {
  createIntegrationCommandReceiptRepository,
} = require(
  './helix/platform/persistence/integration-command-receipt-repository'
);
const { createProcurementAdminApplication } = require('./helix/domains/procurement/public/admin-application');
const { CandidateDeliveryPort } = require('./helix/domains/procurement/public');
const {
  LibraIntakeFacade,
  ProductDeliveryPort,
} = require('./helix/domains/libra/public');
const {
  createArcaAcceptanceFacade,
} = require('./helix/domains/arca/public/acceptance');
const { PerceptionResolutionFacade } = require('./helix/domains/perception/public');
const {
  PersonReferenceQueryFacade,
} = require('./helix/domains/people/public');
const {
  createCandidateDeliveryService,
} = require('./helix/domains/procurement/application/candidate-delivery-service');
const {
  createCandidateDeliveryReader,
} = require('./helix/domains/procurement/persistence/candidate-delivery-reader');
const {
  createCandidateAcceptanceConsumer,
} = require('./helix/domains/procurement/application/candidate-acceptance-consumer');
const { createInboxCoordinator } = require('./helix/foundation/persistence/outbox-inbox');
const {
  createMovieRunCoordinator,
} = require('./helix/domains/procurement/application/movie-run-coordinator');
const {
  createIntakeAcceptanceCoordinator,
} = require('./helix/domains/libra/application/intake-acceptance-coordinator');
const {
  createMovieFormationCoordinator,
} = require('./helix/domains/libra/application/movie-formation-coordinator');
const {
  createMovieProductionCoordinator,
} = require('./helix/domains/libra/application/movie-production-coordinator');
const {
  createMovieResponsibilityClosureCoordinator,
} = require('./helix/domains/libra/application/movie-responsibility-closure-coordinator');
const {
  createProductDeliveryReader,
} = require('./helix/domains/libra/persistence/product-delivery-reader');
const {
  createMovieOnDeckCoordinator,
} = require('./helix/domains/arca/application/movie-ondeck-coordinator');
const {
  createOffloadCompletionPort,
} = require('./helix/domains/arca/public/offload-completion-port');
const {
  createPerceptionResolutionApplication,
} = require('./helix/domains/perception/application/perception-resolution-application');
const {
  createPersonReferenceQuery,
} = require('./helix/domains/people/capabilities/people-reference-lifecycle');
const {
  createPeopleStore,
} = require('./helix/domains/people/persistence/people-store');
const {
  createArcaRuleTemplateAdminApplication,
  createArcaShelfAdminApplication,
} = require('./helix/domains/arca/public/admin-application');
const { createShelfRoutingTargetProjection } = require('./helix/domains/arca/public/routing-target-projection');
const { createLibraRoutingAdminApplication } = require('./helix/domains/libra/public/admin-application');
const { createSessionTokenService } = require('./helix/platform/public/session-token-service');
const {
  createAdminCredentialRuntime,
} = require('./helix/platform/public/admin-credential-runtime');
const {
  createAdminCredentialRepository,
} = require('./helix/platform/persistence/admin-credential-repository');
const {
  createCleanShelfTargetFolderProbe,
} = require('./clean-shelf-target-folder-probe');
const {
  createCleanFieldObservationEnumerator,
} = require('./clean-field-observation-enumerator');
const { createCleanMediaProbe } = require('./clean-media-probe');
const {
  createCleanProductProductionPort,
} = require('./clean-product-production-port');
const {
  createCleanWorkspaceProductPort,
} = require('./clean-workspace-product-port');
const {
  createCleanWesternAnalysisPort,
} = require('./clean-western-analysis-port');
const {
  createCleanArcaInventoryPort,
} = require('./clean-arca-inventory-port');
const {
  createSynchronousDomainWork,
} = require('./helix/foundation/execution/synchronous-domain-work');
const {
  createFieldPageObserver,
} = require('./helix/domains/procurement/capabilities/field-page-observer');
const {
  GENERATION,
  SCHEMA_NAME,
  openSqliteKernel,
} = require('./helix/foundation/persistence/sqlite-kernel');
const {
  createSqliteUnitOfWork,
} = require('./helix/foundation/persistence/sqlite-unit-of-work');
const {
  createAdminCredentialSecretStore,
} = require('./admin-credential-secret-store');
const schemaManifest = require('./helix/foundation/persistence/generated/clean-schema.manifest.json');
const routeManifest = require('./helix/contracts/manifests/route-inventory.json');
const uiManifest = require('./helix/contracts/manifests/ui-surface-inventory.json');

const schemaDdl = fs.readFileSync(
  path.join(__dirname, 'helix/foundation/persistence/generated/clean-schema.sql'),
  'utf8',
);
const SESSION_COOKIE = 'shelfdeck_admin_session';
const AUTH_ERROR_CODES = new Set([
  'ADMIN_CREDENTIAL_INVALID',
  'ADMIN_SESSION_INVALID',
  'ADMIN_SESSION_EXPIRED',
]);
const INTEGRATION_SECRET_SCHEMA =
  'helix-platform-integration-secret@1';
const INTEGRATION_LOCATOR_PREFIX = 'integration-envelope:';
const INTEGRATION_LOCATOR =
  /^integration-envelope:([0-9a-f-]{36}):([0-9a-f]{64})$/;

class CleanServiceHostError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CleanServiceHostError';
    this.code = code;
    this.details = details;
  }
}

function integrationSecretKey(secretRoot) {
  if (typeof secretRoot !== 'string' ||
      Buffer.byteLength(secretRoot, 'utf8') < 32) {
    throw new CleanServiceHostError(
      'PLATFORM_INTEGRATION_SECRET_ROOT_REQUIRED',
      'SHELFDECK_SECRET_ROOT must provide at least 32 UTF-8 bytes.',
    );
  }
  return crypto.createHash('sha256')
    .update('shelfdeck:integration-secret:v1\0', 'utf8')
    .update(secretRoot, 'utf8')
    .digest();
}

function integrationSecretPath(root, locator) {
  const match = INTEGRATION_LOCATOR.exec(locator || '');
  if (!match) {
    throw new CleanServiceHostError(
      'PLATFORM_INTEGRATION_SECRET_LOCATOR_INVALID',
      'Integration Secret locator is invalid.',
    );
  }
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, match[1] + '.json');
  const relative = path.relative(resolvedRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new CleanServiceHostError(
      'PLATFORM_INTEGRATION_SECRET_LOCATOR_ESCAPE',
      'Integration Secret locator escapes its configured root.',
    );
  }
  return target;
}

function integrationSecretAad(value) {
  return Buffer.from([
    INTEGRATION_SECRET_SCHEMA,
    value.locatorId,
    value.integrationId,
    value.secretRef,
    value.secretKind,
    value.revision,
  ].join('\0'), 'utf8');
}

function integrationEnvelopeDigest(key, envelope) {
  return crypto.createHmac('sha256', key)
    .update(
      'shelfdeck:integration-secret-envelope:v1\0',
      'utf8',
    )
    .update(JSON.stringify(envelope), 'utf8')
    .digest('hex');
}

function createIntegrationSecretStore(options) {
  const root = path.join(
    options.dataDir,
    'secrets',
    'integrations',
  );
  const key = integrationSecretKey(options.secretRoot);

  return Object.freeze({
    write(value) {
      if (!Buffer.isBuffer(value?.secretBytes) ||
          value.secretBytes.length < 1 ||
          value.secretBytes.length > 4096 ||
          !Number.isSafeInteger(value.revision) ||
          value.revision < 1) {
        throw new CleanServiceHostError(
          'PLATFORM_INTEGRATION_SECRET_WRITE_INVALID',
          'Integration Secret write input is invalid.',
        );
      }
      const locatorId = crypto.randomUUID();
      const nonce = crypto.randomBytes(12);
      const basis = {
        locatorId,
        integrationId: value.integrationId,
        secretRef: value.secretRef,
        secretKind: value.secretKind,
        revision: value.revision,
      };
      const cipher = crypto.createCipheriv(
        'aes-256-gcm',
        key,
        nonce,
      );
      cipher.setAAD(integrationSecretAad(basis));
      const ciphertext = Buffer.concat([
        cipher.update(value.secretBytes),
        cipher.final(),
      ]);
      const envelope = {
        schema: INTEGRATION_SECRET_SCHEMA,
        ...basis,
        nonce: nonce.toString('base64url'),
        ciphertext: ciphertext.toString('base64url'),
        authenticationTag:
          cipher.getAuthTag().toString('base64url'),
        createdAtMs: value.createdAtMs,
      };
      const envelopeDigest =
        integrationEnvelopeDigest(key, envelope);
      const locator = INTEGRATION_LOCATOR_PREFIX +
        locatorId + ':' + envelopeDigest;
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
      const target = integrationSecretPath(root, locator);
      const temporary = target + '.' + process.pid + '.' +
        crypto.randomUUID() + '.tmp';
      try {
        fs.writeFileSync(
          temporary,
          JSON.stringify(envelope) + '\n',
          { encoding: 'utf8', mode: 0o600, flag: 'wx' },
        );
        fs.renameSync(temporary, target);
        fs.chmodSync(target, 0o600);
      } catch (_error) {
        try {
          fs.rmSync(temporary, { force: true });
        } catch (_ignored) {
          // The original bounded write error is authoritative.
        }
        throw new CleanServiceHostError(
          'PLATFORM_INTEGRATION_SECRET_WRITE_FAILED',
          'Integration Secret envelope could not be committed.',
        );
      } finally {
        nonce.fill(0);
        ciphertext.fill(0);
      }
      return Object.freeze({ locator, envelopeDigest });
    },
    read(locator, expected) {
      const locatorMatch = INTEGRATION_LOCATOR.exec(locator || '');
      const expectedKeys = expected &&
        Object.keys(expected).sort();
      if (!locatorMatch ||
          !expected ||
          typeof expected !== 'object' ||
          Array.isArray(expected) ||
          ![
            JSON.stringify([
              'integrationId',
              'revision',
              'secretKind',
              'secretRef',
            ]),
            JSON.stringify([
              'envelopeDigest',
              'integrationId',
              'revision',
              'secretKind',
              'secretRef',
            ]),
          ].includes(JSON.stringify(expectedKeys)) ||
          !Number.isSafeInteger(expected.revision) ||
          expected.revision < 1) {
        throw new CleanServiceHostError(
          'PLATFORM_INTEGRATION_SECRET_SCOPE_REQUIRED',
          'Integration Secret read requires one exact expected scope.',
        );
      }
      let envelope;
      try {
        envelope = JSON.parse(fs.readFileSync(
          integrationSecretPath(root, locator),
          'utf8',
        ));
      } catch (error) {
        if (error instanceof CleanServiceHostError) throw error;
        throw new CleanServiceHostError(
          'PLATFORM_INTEGRATION_SECRET_ENVELOPE_UNAVAILABLE',
          'Integration Secret envelope is unavailable.',
        );
      }
      const envelopeKeys = [
        'schema',
        'locatorId',
        'integrationId',
        'secretRef',
        'secretKind',
        'revision',
        'nonce',
        'ciphertext',
        'authenticationTag',
        'createdAtMs',
      ].sort();
      if (!envelope || typeof envelope !== 'object' ||
          Array.isArray(envelope) ||
          JSON.stringify(Object.keys(envelope).sort()) !==
            JSON.stringify(envelopeKeys) ||
          envelope.schema !== INTEGRATION_SECRET_SCHEMA ||
          envelope.locatorId !== locatorMatch[1] ||
          !Number.isSafeInteger(envelope.revision) ||
          envelope.revision < 1) {
        throw new CleanServiceHostError(
          'PLATFORM_INTEGRATION_SECRET_ENVELOPE_INVALID',
          'Integration Secret envelope is invalid.',
        );
      }
      const actualEnvelopeDigest =
        integrationEnvelopeDigest(key, envelope);
      if (actualEnvelopeDigest !== locatorMatch[2] ||
          (expected.envelopeDigest !== undefined &&
            expected.envelopeDigest !== actualEnvelopeDigest) ||
          envelope.integrationId !== expected.integrationId ||
          envelope.secretRef !== expected.secretRef ||
          envelope.secretKind !== expected.secretKind ||
          envelope.revision !== expected.revision) {
        throw new CleanServiceHostError(
          'PLATFORM_INTEGRATION_SECRET_SCOPE_MISMATCH',
          'Integration Secret envelope does not match its exact reference.',
        );
      }
      let nonce;
      let ciphertext;
      let tag;
      try {
        nonce = Buffer.from(envelope.nonce, 'base64url');
        ciphertext = Buffer.from(
          envelope.ciphertext,
          'base64url',
        );
        tag = Buffer.from(
          envelope.authenticationTag,
          'base64url',
        );
        if (nonce.length !== 12 || tag.length !== 16 ||
            ciphertext.length < 1 ||
            ciphertext.length > 4096) {
          throw new Error('invalid envelope');
        }
        const decipher = crypto.createDecipheriv(
          'aes-256-gcm',
          key,
          nonce,
        );
        decipher.setAAD(integrationSecretAad(envelope));
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([
          decipher.update(ciphertext),
          decipher.final(),
        ]);
        if (plaintext.length < 1 || plaintext.length > 4096) {
          plaintext.fill(0);
          throw new Error('invalid plaintext');
        }
        return plaintext;
      } catch (_error) {
        throw new CleanServiceHostError(
          'PLATFORM_INTEGRATION_SECRET_DECRYPTION_FAILED',
          'Integration Secret envelope cannot be authenticated.',
        );
      } finally {
        nonce?.fill(0);
        ciphertext?.fill(0);
        tag?.fill(0);
      }
    },
    remove(locator) {
      try {
        fs.rmSync(integrationSecretPath(root, locator), {
          force: true,
        });
      } catch (error) {
        if (error instanceof CleanServiceHostError) throw error;
        throw new CleanServiceHostError(
          'PLATFORM_INTEGRATION_SECRET_REMOVE_FAILED',
          'Integration Secret envelope could not be removed.',
        );
      }
    },
    requestDigest(value) {
      return crypto.createHmac('sha256', key)
        .update('shelfdeck:integration-command:v1\0', 'utf8')
        .update(value, 'utf8')
        .digest('hex');
    },
  });
}

function createPlatformIntegrationServices(options) {
  const repository = createIntegrationRepository(options);
  const secretStore = createIntegrationSecretStore(options);
  const receiptRepository =
    createIntegrationCommandReceiptRepository({
      schemaManifest: options.schemaManifest,
      unitOfWork: options.unitOfWork,
    });
  const runtimes = new Map();
  const adapters = new Map();
  const admins = new Map();
  for (const profile of PROFILES) {
    const runtime = createPlatformIntegrationRuntime({
      profile,
      repository,
      secretStore,
      now: options.now,
      createId: crypto.randomUUID,
      digest: (value) => crypto.createHash('sha256')
        .update(value, 'utf8')
        .digest('hex'),
    });
    const adapter = profile.kind === 'tmdb'
      ? createTmdbProviderAdapter({
          integrationQueryPort: runtime.integrationQueryPort,
          integrationHandleResolverPort:
            runtime.integrationHandleResolverPort,
          secretLeaseResolverPort:
            runtime.secretLeaseResolverPort,
          secretLeaseConsumer: runtime.broker,
          fetchImpl: options.fetchImpl,
          now: options.now,
        })
      : createProviderAdapter(profile.kind, {
          runtime,
          fetchImpl: options.fetchImpl,
          now: options.now,
        });
    const admin = createIntegrationAdminApplication({
      profile,
      repository,
      secretStore,
      adapter,
      receiptRepository,
      now: options.now,
      createId: crypto.randomUUID,
      beforePlatformCommit:
        options.beforeIntegrationPlatformCommit,
      afterPlatformCommit:
        options.afterIntegrationPlatformCommit,
    });
    runtimes.set(profile.kind, runtime);
    adapters.set(profile.kind, adapter);
    admins.set(profile.kind, admin);
  }
  const tmdbRuntime = runtimes.get('tmdb');
  const tmdbAdapter = adapters.get('tmdb');
  const javRuntime = runtimes.get('adult-provider');
  const javProductAdapter = createJavProductProviderAdapter({
    runtime: javRuntime,
    fetchImpl: options.fetchImpl,
    now: options.now,
  });

  const admin = Object.freeze({
    configure(kind, body) {
      const selected = admins.get(kind);
      if (!selected) {
        throw new CleanServiceHostError(
          'PLATFORM_INTEGRATION_KIND_UNSUPPORTED',
          'Integration kind is unsupported.',
        );
      }
      return selected.configure(kind, body);
    },
    disconnect(kind, body) {
      const selected = admins.get(kind);
      if (!selected) {
        throw new CleanServiceHostError(
          'PLATFORM_INTEGRATION_KIND_UNSUPPORTED',
          'Integration kind is unsupported.',
        );
      }
      return selected.disconnect(kind, body);
    },
    get(kind) {
      const selected = admins.get(kind);
      if (!selected) {
        return Object.freeze({
          kind: String(kind || ''),
          supported: false,
          configured: false,
          state: 'unsupported',
          configRevision: 0,
          endpoint: null,
          configDigest: null,
          capabilityCodes: Object.freeze([]),
          lastTestSummary: null,
        });
      }
      return selected.get(kind);
    },
    test(kind, body) {
      const selected = admins.get(kind);
      if (!selected) {
        throw new CleanServiceHostError(
          'PLATFORM_INTEGRATION_KIND_UNSUPPORTED',
          'Integration kind is unsupported.',
        );
      }
      return selected.test(kind, body);
    },
  });

  function runtimeFor(kind) {
    return runtimes.get(kind);
  }

  function handleFor(kind, operationId, artifactKind = null) {
    const runtime = runtimeFor(kind);
    if (!runtime) return undefined;
    const snapshot = runtime.readCurrent();
    if (!snapshot || snapshot.integration.state !== 'active') {
      return undefined;
    }
    return runtime.integrationHandleResolverPort.resolve({
      integrationId: snapshot.integration.integrationId,
      integrationType: snapshot.integration.integrationType,
      configRevision: snapshot.integration.configRevision,
      allowedOperation: operationId,
      artifactKind,
    });
  }

  function javProductHandle(operationId, artifactKind = null) {
    const snapshot = javRuntime.readCurrent();
    if (!snapshot || snapshot.integration.state !== 'active') {
      return undefined;
    }
    return buildProductIntegrationHandle({
      integrationId: snapshot.integration.integrationId,
      integrationType: 'jav',
      configRevision: snapshot.integration.configRevision,
      secretRef: snapshot.secret.secretRef,
      allowedOperation: operationId,
      artifactKind,
      expiresAtMs: 4_102_444_800_000,
    });
  }

  return Object.freeze({
    admin,
    integrationHandleResolverPort:
      tmdbRuntime.integrationHandleResolverPort,
    isActive(kind) {
      return runtimeFor(kind)?.isActive() === true;
    },
    isTmdbActive: tmdbRuntime.isTmdbActive,
    providerAdapters: adapters,
    providerRuntimes: runtimes,
    async searchProviderIdentity(request) {
      const handle = handleFor(
        'tmdb',
        'shared.integration.search@1',
      );
      if (!handle) {
        throw new CleanServiceHostError(
          'PLATFORM_INTEGRATION_NOT_CONFIGURED',
          'TMDB integration is not configured.',
        );
      }
      return tmdbAdapter.observationPort.execute({
        operationId: 'shared.integration.search@1',
        integrationHandle: handle,
        input: {
          contentProfile: request.contentProfile,
          title: request.title,
        },
        timeoutMs: 10_000,
      });
    },
    async searchJavProviderIdentity(request) {
      if (!javRuntime.isActive()) {
        throw new CleanServiceHostError(
          'PLATFORM_INTEGRATION_NOT_CONFIGURED',
          'Adult Provider integration is not configured.',
        );
      }
      return javProductAdapter.searchProviderIdentity(request);
    },
    async fetchProviderMetadata(request) {
      return tmdbAdapter.observationPort.execute({
        operationId: 'libra.product_metadata.fetch@1',
        integrationHandle: request.integrationHandle,
        input: {
          resolvedProviderIdentity:
            request.metadataFetchIntent.resolvedProviderIdentity,
          requestedFields:
            request.metadataFetchIntent.requestedFields,
        },
        timeoutMs: 10_000,
      });
    },
    async fetchProviderArtifact(request) {
      return tmdbAdapter.artifactPort.execute({
        operationId: 'libra.product_artifact.acquire@1',
        integrationHandle: request.integrationHandle,
        input: {
          artifactKind: request.artifactKind,
          resolvedProviderIdentity:
            request.resolvedProviderIdentity,
        },
        timeoutMs: 20_000,
      });
    },
    async fetchJavProviderMetadata(request) {
      return javProductAdapter.fetchProviderMetadata(request);
    },
    async fetchJavProviderArtifact(request) {
      return javProductAdapter.fetchProviderArtifact(request);
    },
    resolveProductHandle(value) {
      const intent = value.intent;
      if (intent?.providerKind !== 'tmdb' ||
          !tmdbRuntime.isTmdbActive()) {
        if (intent?.providerKind === 'jav' &&
            javRuntime.isActive() &&
            intent.integrationId ===
              javRuntime.profile.integrationId) {
          return javProductHandle(
            value.operationId,
            value.artifactKind || null,
          );
        }
        return undefined;
      }
      return tmdbRuntime.integrationHandleResolverPort.resolve({
        integrationId: intent.integrationId,
        integrationType: intent.providerKind,
        configRevision: intent.configRevision,
        allowedOperation: value.operationId,
        artifactKind: value.artifactKind || null,
      });
    },
    async executeProvider(kind, request) {
      const profile = getIntegrationProfile(kind);
      const runtime = runtimeFor(kind);
      const adapter = adapters.get(kind);
      if (!profile || !runtime || !adapter ||
          !runtime.isActive()) {
        throw new CleanServiceHostError(
          'PLATFORM_INTEGRATION_NOT_CONFIGURED',
          'Integration is not configured.',
        );
      }
      const snapshot = runtime.readCurrent();
      const handle = handleFor(
        kind,
        request.operationId,
        request.artifactKind || null,
      );
      const lease = runtime.secretLeaseResolverPort.resolve({
        secretRef: snapshot.secret.secretRef,
        ownerScopeType: 'integration',
        ownerScopeId: snapshot.integration.integrationId,
        secretKind: snapshot.secret.secretKind,
        expectedRevision: snapshot.secret.revision,
        purpose: request.operationId,
        ttlMs: Math.min(request.timeoutMs, 60_000),
      });
      const input = request.input;
      const idempotencyKey = request.idempotencyKey;
      const requestDigest = canonicalDigest({
        integrationId: handle.integrationId,
        integrationType: handle.integrationType,
        configRevision: handle.configRevision,
        operationId: request.operationId,
        idempotencyKey,
        input,
      });
      const port = request.effectClass === 'external_request'
        ? adapter.requestPort
        : request.effectClass === 'workspace_write'
          ? adapter.artifactPort
          : adapter.observationPort;
      return port.execute({
        integrationHandle: handle,
        secretLeaseHandle: lease,
        operationId: request.operationId,
        idempotencyKey,
        requestDigest,
        timeoutMs: request.timeoutMs,
        input,
      });
    },
  });
}

function cookieValue(header, name) {
  for (const item of String(header || '').split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) {
      return decodeURIComponent(item.slice(separator + 1).trim());
    }
  }
  return undefined;
}

function sessionCookie(token) {
  return [
    SESSION_COOKIE,
    '=',
    encodeURIComponent(token),
    '; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800',
  ].join('');
}

function clearSessionCookie() {
  return SESSION_COOKIE + '=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0';
}

function errorResponse(error, correlationId) {
  let status = 500;
  if (AUTH_ERROR_CODES.has(error.code)) status = 401;
  else if (error.code === 'ADMIN_FIELD_NOT_FOUND') status = 404;
  else if (error.code === 'ADMIN_SHELF_NOT_FOUND') status = 404;
  else if (error.code === 'ADMIN_SHELF_COMMAND_REJECTED' || error.code === 'ADMIN_SHELF_TARGET_MISMATCH') status = 400;
  else if (
    error.code === 'ADMIN_SHELF_IDEMPOTENCY_CONFLICT' ||
    error.code === 'ADMIN_SHELF_CONFLICT'
  ) status = 409;
  else if (error.code === 'ADMIN_RULE_TEMPLATE_NOT_FOUND') status = 404;
  else if (
    error.code === 'ADMIN_RULE_TEMPLATE_COMMAND_REJECTED' ||
    error.code === 'ADMIN_RULE_TEMPLATE_TARGET_MISMATCH'
  ) status = 400;
  else if (
    error.code === 'ADMIN_RULE_TEMPLATE_CONFLICT' ||
    error.code === 'ADMIN_RULE_TEMPLATE_IDEMPOTENCY_CONFLICT' ||
    error.code === 'SYSTEM_TEMPLATE_IMMUTABLE'
  ) status = 409;
  else if (error.code === 'ADMIN_ROUTING_COMMAND_REJECTED' || error.code === 'ADMIN_ROUTING_TARGET_MISMATCH') status = 400;
  else if (error.code === 'ADMIN_ROUTING_IDEMPOTENCY_CONFLICT') status = 409;
  else if (error.code === 'ADMIN_FIELD_COMMAND_REJECTED' || error.code === 'ADMIN_FIELD_TARGET_MISMATCH') status = 400;
  else if (error.code === 'ADMIN_FIELD_IDEMPOTENCY_CONFLICT') status = 409;
  else if (error.code === 'ADMIN_FIELD_CONFLICT') status = 409;
  else if (
    error.code === 'PLATFORM_INTEGRATION_KIND_UNSUPPORTED' ||
    error.code === 'PLATFORM_INTEGRATION_NOT_CONFIGURED'
  ) status = 404;
  else if (
    error.code === 'PLATFORM_INTEGRATION_IDEMPOTENCY_CONFLICT' ||
    error.code === 'PLATFORM_INTEGRATION_CAS_CONFLICT' ||
    error.code === 'PLATFORM_INTEGRATION_REVISION_MISMATCH'
  ) status = 409;
  else if (
    typeof error.code === 'string' &&
    (
      error.code.startsWith('PLATFORM_INTEGRATION_') ||
      error.code.startsWith('PLATFORM_TMDB_')
    )
  ) {
    status = [
      'PLATFORM_INTEGRATION_NETWORK_FAILED',
      'PLATFORM_INTEGRATION_HTTP_FAILED',
      'PLATFORM_INTEGRATION_RESPONSE_INVALID',
      'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
      'PLATFORM_INTEGRATION_RESPONSE_BOUND',
      'PLATFORM_INTEGRATION_TIMEOUT',
    ].includes(error.code) ? 502 : 400;
  }
  else if (
    typeof error.code === 'string' &&
    error.code.startsWith('P5_PROVIDER_')
  ) {
    status = [
      'P5_PROVIDER_TRANSPORT_FAILED',
      'P5_PROVIDER_OPERATION_UNAVAILABLE',
    ].includes(error.code) ? 502 : 400;
  }
  else if (
    error.code === 'IDEMPOTENCY_KEY_REQUIRED' ||
    error.code === 'GET_SIDE_EFFECT_INPUT_REJECTED' ||
    error.code === 'ADMIN_SESSION_ISSUE_INVALID'
  ) status = 400;
  else if (error.code === 'HELIX_NOT_READY') status = 503;
  const code = status === 500 ? 'CLEAN_SERVICE_INTERNAL_ERROR' : error.code;
  const message = status === 500 ? 'Clean Service请求处理失败。' : error.message;
  return {
    status,
    body: {
      error: {
        code,
        message,
        details: status === 500 ? {} : (error.details || {}),
        correlationId,
      },
    },
  };
}

function createRuntime(options) {
  const findings = [];
  const databasePath = path.join(options.dataDir, 'shelfdeck.db');
  if (!fs.existsSync(databasePath)) findings.push('CLEAN_DATABASE_MISSING');
  if (!fs.existsSync(path.join(options.adminDistDir, 'index.html'))) {
    findings.push('ADMIN_WEB_BUILD_MISSING');
  }
  if (routeManifest.status !== 'active' || routeManifest.entries.length !== 114) {
    findings.push('ROUTE_INVENTORY_INCOMPLETE');
  }
  if (uiManifest.status !== 'active' || uiManifest.entries.length !== 18) {
    findings.push('UI_SURFACE_INVENTORY_INCOMPLETE');
  }
  if (findings.length) {
    return Object.freeze({
      findings: Object.freeze(findings),
      close() {},
    });
  }

  let kernel;
  try {
    kernel = openSqliteKernel({
      Database,
      databasePath,
      schemaDdl,
      schemaManifest,
      now: options.now,
    });
    const unitOfWork = createSqliteUnitOfWork({ kernel });
    const expected = Object.freeze({
      schemaName: SCHEMA_NAME,
      generation: GENERATION,
      schemaDigest: schemaManifest.ddlDigest,
    });
    const repository = createAdminCredentialRepository({
      schemaManifest,
      unitOfWork,
      expected,
    });
    const secretStore = createAdminCredentialSecretStore({
      dataDir: options.dataDir,
      secretRoot: options.secretRoot,
    });
    const runtime = createAdminCredentialRuntime({
      repository,
      secretStore,
      readinessBasis: Object.freeze({
        findings: Object.freeze([]),
        generation: GENERATION,
        tableCount: schemaManifest.tableCount,
        routeCount: routeManifest.entries.length,
        uiSurfaceCount: uiManifest.entries.length,
      }),
    });
    return Object.freeze({
      runtime,
      applicationDependencies: Object.freeze({ schemaManifest, unitOfWork }),
      findings: Object.freeze([]),
      close: () => kernel.close(),
    });
  } catch (error) {
    kernel?.close();
    return Object.freeze({
      findings: Object.freeze([error.code || 'DATABASE_INTEGRITY_UNAVAILABLE']),
      close() {},
    });
  }
}

function inspectCleanRuntimeReadiness(options) {
  const constructed = createRuntime(options);
  try {
    if (constructed.findings.length) {
      return Object.freeze({ state: 'not_ready', findings: constructed.findings });
    }
    return constructed.runtime.inspectReadiness();
  } finally {
    constructed.close();
  }
}

async function createCleanServiceHost(options) {
  if (!options || typeof options.dataDir !== 'string' || typeof options.adminDistDir !== 'string') {
    throw new TypeError('Clean service data and Admin Web roots are required.');
  }
  const constructed = createRuntime(options);
  if (constructed.findings.length) {
    throw new CleanServiceHostError(
      'CLEAN_SERVICE_NOT_READY',
      'Clean service refuses startup until readiness is complete.',
      { findings: constructed.findings },
    );
  }
  const runtime = constructed.runtime;
  const readiness = runtime.inspectReadiness();
  if (readiness.state !== 'ready') {
    constructed.close();
    throw new CleanServiceHostError(
      'CLEAN_SERVICE_NOT_READY',
      'Clean service refuses startup until readiness is complete.',
      { findings: readiness.findings },
    );
  }
  const sessionTokens = createSessionTokenService({
    readActiveCredential: runtime.readActiveCredential,
  });
  const platformIntegrations = createPlatformIntegrationServices({
    ...constructed.applicationDependencies,
    dataDir: options.dataDir,
    secretRoot: options.secretRoot,
    now: options.now || Date.now,
    fetchImpl: options.integrationFetch,
    beforeIntegrationPlatformCommit:
      options.beforeIntegrationPlatformCommit,
    afterIntegrationPlatformCommit:
      options.afterIntegrationPlatformCommit,
  });
  const arcaShelfAdmin = createArcaShelfAdminApplication({
    ...constructed.applicationDependencies,
    targetFolderProbe: createCleanShelfTargetFolderProbe(),
  });
  const arcaRuleTemplateAdmin = createArcaRuleTemplateAdminApplication(
    constructed.applicationDependencies,
  );
  const candidateDeliveryPort = CandidateDeliveryPort(createCandidateDeliveryService({
    ...constructed.applicationDependencies,
    candidateDeliveryReader: createCandidateDeliveryReader(constructed.applicationDependencies),
    contractValidator: Object.freeze({ validate(_schemaRef, value) {
      if (!value || typeof value !== 'object') {
        throw new CleanServiceHostError('CANDIDATE_DELIVERY_CONTRACT_INVALID',
          'Candidate Delivery contract value is absent.');
      }
    } }),
  }));
  const libraIntakeApplication = createIntakeAcceptanceCoordinator({
    ...constructed.applicationDependencies,
    candidateDeliveryPort,
  });
  const libraIntake = LibraIntakeFacade({
    offerCandidate: libraIntakeApplication.offerCandidate,
  });
  const candidateAcceptance = createCandidateAcceptanceConsumer(constructed.applicationDependencies);
  const outboxInbox = createInboxCoordinator(constructed.applicationDependencies);
  const arcaRoutingTargets = createShelfRoutingTargetProjection(constructed.applicationDependencies);
  const perceptionResolutionApplication =
    createPerceptionResolutionApplication({
      ...constructed.applicationDependencies,
      now: options.now,
      afterResolutionCommit: options.afterPerceptionResolutionCommit,
    });
  const perceptionResolution = PerceptionResolutionFacade({
    resolveDecisionFact:
      perceptionResolutionApplication.resolveDecisionFact,
  });
  const peopleStore = createPeopleStore(
    constructed.applicationDependencies,
  );
  const personReferenceProjectionFacade = PersonReferenceQueryFacade(
    createPersonReferenceQuery(peopleStore),
  );
  const workRuntime = createSynchronousDomainWork(
    constructed.applicationDependencies,
  );
  const mediaProbe = options.mediaProbe || createCleanMediaProbe();
  const workspaceProductPort = createCleanWorkspaceProductPort({
    ...constructed.applicationDependencies,
    rootPath: options.workspaceRoot || path.join(options.dataDir, 'workspace'),
    afterPhysicalEffect: options.afterWorkspacePhysicalEffect,
    afterCleanupPhysicalEffect: options.afterCleanupPhysicalEffect,
  });
  const configuredSearchProviderIdentity = async (request) => {
    if (request.contentProfile === 'movie' &&
        platformIntegrations.isTmdbActive()) {
      return platformIntegrations.searchProviderIdentity(request);
    }
    if (request.contentProfile === 'jav' &&
        platformIntegrations.isActive('adult-provider')) {
      return platformIntegrations.searchJavProviderIdentity(request);
    }
    if (typeof options.searchProviderIdentity === 'function') {
      return options.searchProviderIdentity(request);
    }
    const error = new CleanServiceHostError(
      'CLEAN_PRODUCT_IDENTITY_PROVIDER_UNAVAILABLE',
      'The required typed Provider identity search is unavailable.',
    );
    throw error;
  };
  const configuredFetchProviderMetadata = async (request) => {
    if (request.metadataFetchIntent?.providerKind === 'tmdb' &&
        platformIntegrations.isTmdbActive()) {
      return platformIntegrations.fetchProviderMetadata(request);
    }
    if (request.metadataFetchIntent?.providerKind === 'jav' &&
        platformIntegrations.isActive('adult-provider')) {
      return platformIntegrations.fetchJavProviderMetadata(request);
    }
    if (typeof options.fetchProviderMetadata === 'function') {
      return options.fetchProviderMetadata(request);
    }
    throw new CleanServiceHostError(
      'CLEAN_PRODUCT_PROVIDER_UNAVAILABLE',
      'The required typed Product Metadata provider is unavailable.',
    );
  };
  const configuredFetchProviderArtifact = async (request) => {
    if (request.integrationHandle?.integrationType === 'tmdb' &&
        platformIntegrations.isTmdbActive()) {
      return platformIntegrations.fetchProviderArtifact(request);
    }
    if (request.integrationHandle?.integrationType === 'jav' &&
        platformIntegrations.isActive('adult-provider')) {
      return platformIntegrations.fetchJavProviderArtifact(request);
    }
    if (typeof options.fetchProviderArtifact === 'function') {
      return options.fetchProviderArtifact(request);
    }
    throw new CleanServiceHostError(
      'CLEAN_PRODUCT_ARTIFACT_PROVIDER_UNAVAILABLE',
      'The required typed Product Artifact provider is unavailable.',
    );
  };
  const rawProductProductionPort = createCleanProductProductionPort({
    mediaProbe,
    workspaceProductPort,
    now: options.now,
    searchProviderIdentity: configuredSearchProviderIdentity,
    fetchProviderMetadata: configuredFetchProviderMetadata,
    fetchProviderArtifact: configuredFetchProviderArtifact,
  });
  const productProductionPort = Object.freeze({
    ...rawProductProductionPort,
    resolveIntegrationHandle(value) {
      return platformIntegrations.resolveProductHandle(value) ||
        rawProductProductionPort.resolveIntegrationHandle(value);
    },
  });
  const westernAnalysisPort =
    options.westernAnalysisEngine || options.westernModelPack
      ? createCleanWesternAnalysisPort({
        workspaceProductPort,
        engine: options.westernAnalysisEngine,
        modelPack: options.westernModelPack,
        now: options.now,
      })
      : null;
  const movieFormationCoordinator = createMovieFormationCoordinator({
    ...constructed.applicationDependencies,
    readArcaRoutingTargets: arcaRoutingTargets.list,
    readArcaShelfStandard: arcaRoutingTargets.getStandard,
    resolvePerceptionDecisionFact:
      perceptionResolution.resolveDecisionFact,
  });
  const movieProductionCoordinator = createMovieProductionCoordinator({
    ...constructed.applicationDependencies,
    workRuntime,
    productionPort: productProductionPort,
    workspaceProductPort,
    westernAnalysisPort,
    personReferenceProjectionFacade,
    now: options.now,
    afterCapabilityResultCommit: options.afterCapabilityResultCommit,
    afterProductFactsCommit: options.afterProductFactsCommit,
    afterPackageCommit: options.afterPackageCommit,
  });
  const productDeliveryPort = ProductDeliveryPort(
    createProductDeliveryReader(constructed.applicationDependencies),
  );
  const arcaInventoryPort = createCleanArcaInventoryPort({
    ...constructed.applicationDependencies,
    workspaceRoot:
      options.workspaceRoot || path.join(options.dataDir, 'workspace'),
    afterPhysicalEffect: options.afterArcaInventoryPhysicalEffect,
  });
  const movieOnDeckApplication = createMovieOnDeckCoordinator({
    ...constructed.applicationDependencies,
    productDeliveryPort,
    inventoryPort: arcaInventoryPort,
    afterAttemptAcceptedCas: options.afterAttemptAcceptedCas,
    afterAcceptedResponsibilityInsert:
      options.afterAcceptedResponsibilityInsert,
    afterHandoffBControlTransfer:
      options.afterHandoffBControlTransfer,
    afterHandoffBReceiptInsert: options.afterHandoffBReceiptInsert,
    afterHandoffBOutboxInsert: options.afterHandoffBOutboxInsert,
    afterHandoffBAccepted: options.afterHandoffBAccepted,
    afterOnDeckCommit: options.afterOnDeckCommit,
  });
  const arcaAcceptance = createArcaAcceptanceFacade({
    acceptProductOffer: movieOnDeckApplication.acceptProductOffer,
  });
  const responsibilityClosure =
    createMovieResponsibilityClosureCoordinator({
      ...constructed.applicationDependencies,
      offloadCompletionPort:
        createOffloadCompletionPort(constructed.applicationDependencies),
      workspaceProductPort,
      now: options.cleanupNow || options.now || Date.now,
      offloadWakeVisible: options.offloadWakeVisible,
      afterRunCompletion: options.afterRunCompletion,
      beforeCleanupAdmission: options.beforeCleanupAdmission,
      afterCleanupAdmission: options.afterCleanupAdmission,
      afterCleanupCommit: options.afterCleanupCommit,
    });
  const advanceRunProduction = async (libraRunId) => {
    const production = await movieProductionCoordinator.advance(libraRunId);
    if (production.stage !== 'handoff_b_offer_open') return production;
    const arca = arcaAcceptance.acceptProductOffer(
      production.offerMessage,
    );
    let closure;
    try {
      closure = responsibilityClosure.advance({
        libraRunId,
        onDeckProductPackage:
          production.productDelivery.onDeckProductPackage,
      });
    } catch (error) {
      if (error.code !== 'P14_CLEANUP_GRACE_ACTIVE') throw error;
      closure = Object.freeze({
        stage: 'workspace_cleanup_grace_active',
        graceDeadlineMs: error.details.graceDeadlineMs,
      });
    }
    return Object.freeze({
      ...production,
      offerStage: production.stage,
      stage: arca.stage,
      handoffB: arca.handoffB,
      onDeck: arca.onDeck,
      responsibilityClosure: closure,
    });
  };
  const advanceProduction = async (formation) => {
    if (formation.stage !== 'libra_run_active') return null;
    const libraRunId = formation.libraRunId || formation.libraRun?.libraRunId;
    if (!libraRunId) {
      throw new CleanServiceHostError(
        'CLEAN_MOVIE_RUN_ID_MISSING',
        'Movie formation did not expose the exact Libra Run identity.',
      );
    }
    if (['series', 'jav'].includes(formation.contentProfile) &&
        typeof options.searchProviderIdentity !== 'function' &&
        (formation.contentProfile !== 'jav' ||
          !platformIntegrations.isActive('adult-provider'))) {
      return null;
    }
    if (formation.contentProfile === 'movie' &&
        !platformIntegrations.isTmdbActive() &&
        typeof options.searchProviderIdentity !== 'function') {
      return null;
    }
    if (formation.contentProfile === 'western_adult' &&
        !westernAnalysisPort) {
      return null;
    }
    return advanceRunProduction(libraRunId);
  };
  const handoffOffer = async (offer) => {
    const accepted = libraIntake.offerCandidate(offer);
    const message = accepted.acceptedMessage;
    const dedupKey = 'libra_candidate_accepted:' + message.offerId;
    const procurementClosure = candidateAcceptance.consume(Object.freeze({
      messageId: canonicalDigest({
        schema: 'foundation.outbox-message-id@1', producerDomain: 'libra', dedupKey,
      }),
      dedupKey,
      producerDomain: 'libra',
      consumerDomain: 'procurement',
      payloadSchemaRef: message.schemaRef,
      payloadDigest: canonicalDigest(message),
      payload: message,
    }));
    const acknowledgement = outboxInbox.acknowledge({
      messageId: canonicalDigest({
        schema: 'foundation.outbox-message-id@1', producerDomain: 'libra', dedupKey,
      }),
      consumerDomain: 'procurement',
    });
    const formation = movieFormationCoordinator.advance(accepted.receipt.subjectId);
    const production = await advanceProduction(formation);
    return Object.freeze({
      intake: accepted,
      procurementClosure,
      acknowledgement,
      formation,
      production,
    });
  };
  const resumeAcceptedHandoff = async (offer) => {
    const intake = libraIntakeApplication.resumeAcceptedOffer(offer);
    const completed =
      responsibilityClosure.findCompletedRun(intake.receipt.subjectId);
    if (completed) {
      const delivery = productDeliveryPort.readPackage({
        queryContract: 'libra.product-delivery@1',
        readPurpose: 'historical',
        offerId: completed.package.offerId,
        onDeckPackageId: completed.package.onDeckPackageId,
        expectedPackageRevision: completed.package.packageRevision,
        expectedPackageDigest: completed.package.packageDigest,
      });
      if (delivery.resultKind !== 'found') {
        throw new CleanServiceHostError(
          'CLEAN_MOVIE_PRODUCT_DELIVERY_MISSING',
          'Completed Movie Run cannot reconstruct its Product Delivery.',
        );
      }
      const packageValue = delivery.onDeckProductPackage;
      const messageId = canonicalDigest({
        schema: 'libra.product-offer-message-id@1',
        offerId: completed.package.offerId,
        packageDigest: completed.package.packageDigest,
      });
      const offerMessage = Object.freeze({
        messageKind: 'libra.product-offer.available@1',
        messageId,
        offerId: completed.package.offerId,
        onDeckPackageId: completed.package.onDeckPackageId,
        packageRevision: completed.package.packageRevision,
        packageDigest: completed.package.packageDigest,
        libraRunId: completed.libraRunId,
        subjectId: packageValue.subjectId,
        shelfId: packageValue.shelfId,
        acceptanceSpecId: packageValue.acceptanceSpecRef.id,
        dedupKey: messageId,
      });
      const arca = arcaAcceptance.acceptProductOffer(offerMessage);
      let closure;
      try {
        closure = responsibilityClosure.advance({
          libraRunId: completed.libraRunId,
          onDeckProductPackage: packageValue,
        });
      } catch (error) {
        if (error.code !== 'P14_CLEANUP_GRACE_ACTIVE') throw error;
        closure = Object.freeze({
          stage: 'workspace_cleanup_grace_active',
          graceDeadlineMs: error.details.graceDeadlineMs,
        });
      }
      return Object.freeze({
        intake,
        formation: Object.freeze({
          stage: 'libra_run_completed',
          libraRunId: completed.libraRunId,
          replayed: true,
        }),
        production: Object.freeze({
          stage: arca.stage,
          offerStage: 'handoff_b_offer_open',
          replayed: true,
          libraRunId: completed.libraRunId,
          contentProfile:
            packageValue.productStructureSnapshot.contentProfile,
          onDeckPackageId: completed.package.onDeckPackageId,
          packageRevision: completed.package.packageRevision,
          packageDigest: completed.package.packageDigest,
          offerId: completed.package.offerId,
          offerMessage,
          productDelivery: delivery,
          handoffB: arca.handoffB,
          onDeck: arca.onDeck,
          responsibilityClosure: closure,
        }),
      });
    }
    const formation = movieFormationCoordinator.advance(intake.receipt.subjectId);
    return Object.freeze({
      intake,
      formation,
      production: await advanceProduction(formation),
    });
  };
  const movieRunCoordinator = createMovieRunCoordinator({
    ...constructed.applicationDependencies,
    triageRegistry: require('./helix/domains/procurement/model/procurement-run-contracts').createDefaultTriageRuleRegistry(),
    workRuntime,
    mediaProbe,
    faultInjector: options.movieRunFaultInjector,
    offerCandidate: handoffOffer,
    resumeAcceptedHandoff,
  });
  const libraRoutingAdmin = createLibraRoutingAdminApplication({
    ...constructed.applicationDependencies,
    readArcaRoutingTargets: arcaRoutingTargets.list,
  });
  const facades = createCleanFacades({
    sessionTokens,
    readiness,
    credentialMetadata: runtime.readActiveCredential,
    procurementAdmin: createProcurementAdminApplication({
      ...constructed.applicationDependencies,
      enumerator: createCleanFieldObservationEnumerator(),
      pageObserverFactory: createFieldPageObserver,
      workRuntime,
      movieRunCoordinator,
    }),
    arcaShelfAdmin,
    arcaRuleTemplateAdmin,
    libraRoutingAdmin,
    platformIntegrationAdmin: platformIntegrations.admin,
    nonce: crypto.randomUUID,
  });
  const application = createHelixApplication({ facades, sessionTokens });
  application.start();

  const server = Fastify({ logger: false, trustProxy: false });
  await server.register(fastifyStatic, {
    root: path.resolve(options.adminDistDir),
    prefix: '/',
    wildcard: false,
  });
  server.get('/admin', (_request, reply) => reply.sendFile('index.html'));
  server.get('/admin/*', (_request, reply) => reply.sendFile('index.html'));

  for (const route of routeRegistry.entries) {
    server.route({
      method: route.method,
      url: route.path,
      handler: async (request, reply) => {
        const correlationId = request.headers['x-correlation-id'] || crypto.randomUUID();
        let response;
        try {
          response = await application.dispatch({
            method: request.method,
            path: request.url.split('?')[0],
            query: request.query,
            body: request.body,
            apiKey: request.headers['x-api-key'],
            sessionToken: cookieValue(request.headers.cookie, SESSION_COOKIE),
            nowMs: Date.now(),
            correlationId,
          });
        } catch (error) {
          response = errorResponse(error, correlationId);
        }
        if (response.sessionToken) reply.header('set-cookie', sessionCookie(response.sessionToken));
        if (response.clearSession) reply.header('set-cookie', clearSessionCookie());
        reply.code(response.status);
        return response.status === 204 ? reply.send() : response.body;
      },
    });
  }
  try {
    await server.ready();
  } catch (error) {
    application.stop();
    constructed.close();
    throw error;
  }

  let closed = false;
  return Object.freeze({
    generation: application.generation,
    routeCount: application.routeCount,
    readiness: () => application.readiness(),
    inject: (request) => server.inject(request),
    listen: (address) => server.listen(address),
    async close() {
      if (closed) return;
      closed = true;
      application.stop();
      try {
        await server.close();
      } finally {
        constructed.close();
      }
    },
  });
}

module.exports = Object.freeze({
  CleanServiceHostError,
  SESSION_COOKIE,
  createCleanServiceHost,
  createIntegrationSecretStore,
  createPlatformIntegrationServices,
  inspectCleanRuntimeReadiness,
});
