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
const { createOverviewQuery } = require('./helix/projections/overview-query');
const { createSetupReadinessQuery } = require('./helix/projections/setup-readiness-query');
const { createInputSettlementAuthorizationStore } = require('./helix/domains/arca/persistence/input-settlement-authorization-store');
const { createPeopleAdminQuery } = require('./helix/domains/people/application/admin-query');
const { createPeopleAvatarQuery } = require('./helix/domains/people/application/avatar-query');
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
const moviePilotLandingAccessAdapter = require(
  './helix/integrations/moviepilot-landing-access-adapter'
);
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
  createCandidateDeliveryService,
} = require('./helix/domains/procurement/application/candidate-delivery-service');
const {
  createCandidateDeliveryReader,
} = require('./helix/domains/procurement/persistence/candidate-delivery-reader');
const {
  createCandidateAcceptanceConsumer,
} = require('./helix/domains/procurement/application/candidate-acceptance-consumer');
const { createCandidateRejectionConsumer } = require('./helix/domains/procurement/application/candidate-rejection-consumer');
const { createOutboxDispatcherHost } = require('./helix/foundation/execution/outbox-dispatcher-host');
const {
  createHandoffBOutcomeConsumer,
} = require('./helix/domains/libra/application/handoff-b-outcome-consumer');
const {
  createArcaRuleTemplateAdminApplication,
  createArcaShelfAdminApplication,
} = require('./helix/domains/arca/public/admin-application');
const { createShelfRoutingTargetProjection } = require('./helix/domains/arca/public/routing-target-projection');
const { createArcaCollectionQuery } = require('./helix/domains/arca/application/collection-query');
const { createArcaCareApplication } = require('./helix/domains/arca/application/care-query');
const { createOffdeckAdminApplication } = require('./helix/domains/arca/application/offdeck-admin-application');
const { ProductDeliveryPort } = require('./helix/domains/libra/public');
const { createProductDeliveryReader } = require('./helix/domains/libra/persistence/product-delivery-reader');
const { createCleanArcaInventoryPort } = require('./clean-arca-inventory-port');
const { createCleanOffdeckDeletionPort } = require('./clean-offdeck-deletion-port');
const { createLibraRoutingAdminApplication } = require('./helix/domains/libra/public/admin-application');
const { createFormationProjectionSource, createFormationQuery } = require('./helix/domains/libra/application/formation-query');
const { createFormationProjectionHost } = require('./helix/domains/libra/application/formation-projection-host');
const { createFormationProjectionStore } = require('./helix/domains/libra/persistence/formation-projection-store');
const { createFormationRunHistoryStore } = require('./helix/domains/libra/persistence/formation-run-history-store');
const { createExecutionProgressProjectionReader } = require('./helix/foundation/execution/progress-projection-reader');
const { createRoutingManualSelectionService } = require('./helix/domains/libra/application/routing-manual-selection-service');
const { createLibraRunAdminService } = require('./helix/domains/libra/application/libra-run-admin-service');
const {
  buildRatingTargetIdentity,
} = require('./helix/domains/libra/model/decision-identity-evidence-contracts');
const { createSessionTokenService } = require('./helix/platform/public/session-token-service');
const {
  createAdminCredentialRuntime,
} = require('./helix/platform/public/admin-credential-runtime');
const {
  createAdminCredentialRepository,
} = require('./helix/platform/persistence/admin-credential-repository');
const {
  createLocationRegistryRepository,
} = require('./helix/platform/persistence/location-registry-repository');
const {
  createPathAuthority,
} = require('./helix/platform/model/path-authority');
const {
  createLocalFilesystemMountScopeResolver,
} = require('./helix/platform/application/local-filesystem-mount-scope-resolver');
const {
  createCleanLocalFilesystemMountProbe,
} = require('./clean-local-filesystem-mount-probe');
const {
  createCleanShelfTargetFolderProbe,
} = require('./clean-shelf-target-folder-probe');
const {
  createCleanFieldObservationEnumerator,
  inspectObservationRootSync,
} = require('./clean-field-observation-enumerator');
const {
  createCleanFieldAccessBindingProbe,
} = require('./clean-field-access-binding-probe');
const {
  createHelixExecutionRuntime,
} = require('./helix/composition/create-procurement-execution-runtime');
const {
  createMaterialFieldStore,
} = require('./helix/domains/procurement/persistence/material-field-store');
const { createCleanMediaProbe } = require('./clean-media-probe');
const {
  createCleanWorkspaceProductPort,
} = require('./clean-workspace-product-port');
const {
  createCleanProductProductionPort,
} = require('./clean-product-production-port');
const {
  createCleanMediaProductionEffectPort,
} = require('./clean-media-production-effect-port');
const { createFfmpegProcessRegistry } = require('./clean-ffmpeg-process-registry');
const {
  createCleanComputeDeviceRuntime,
} = require('./clean-compute-device-runtime');
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
  migrateUatIdentitySelectionSchema,
} = require('./helix/foundation/persistence/uat-identity-selection-migration');
const {
  repairTerminalResourceDefers,
} = require('./helix/foundation/persistence/execution-consistency-repair');
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

function assertAftercareWorkspaceRootAvailable(aftercareWorkspaceRoot, reservedRoots) {
  const authority = createPathAuthority(path);
  const canonicalize = (candidate) => {
    const lexical = authority.canonicalize(candidate);
    const missingSegments = [];
    let existing = lexical;
    while (!fs.existsSync(existing)) {
      const parent = path.dirname(existing);
      if (parent === existing) return lexical;
      missingSegments.unshift(path.basename(existing));
      existing = parent;
    }
    const realpath = fs.realpathSync.native || fs.realpathSync;
    return authority.canonicalize(path.join(realpath(existing), ...missingSegments));
  };
  const root = canonicalize(aftercareWorkspaceRoot);
  if (!Array.isArray(reservedRoots) || reservedRoots.length > 4096) {
    throw new CleanServiceHostError(
      'ARCA_AFTERCARE_WORKSPACE_ROOT_PROJECTION_INVALID',
      'Aftercare Workspace root safety projection is invalid.',
    );
  }
  for (const item of reservedRoots) {
    if (!item || typeof item.kind !== 'string' || typeof item.rootId !== 'string' ||
        typeof item.resolvedRoot !== 'string') {
      throw new CleanServiceHostError(
        'ARCA_AFTERCARE_WORKSPACE_ROOT_PROJECTION_INVALID',
        'Aftercare Workspace root safety projection is invalid.',
      );
    }
    if (authority.overlaps(root, canonicalize(item.resolvedRoot))) {
      throw new CleanServiceHostError(
        'ARCA_AFTERCARE_WORKSPACE_ROOT_OVERLAP',
        'Aftercare Workspace root overlaps another active physical root.',
        { reservedKind:item.kind, reservedRootId:item.rootId },
      );
    }
  }
  return root;
}

function normalizePerceptionSourceId(providerKey) {
  if (providerKey === null || providerKey === undefined) return null;
  const sourceId = String(providerKey).trim();
  return sourceId || null;
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
      landingAccessAdapter: profile.kind === 'moviepilot'
        ? moviePilotLandingAccessAdapter
        : undefined,
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
          doubanRequestPaceMs: options.doubanRequestPaceMs,
          doubanDelay: options.doubanDelay,
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
      reservedRoots: options.reservedRoots,
      landingAccessAdapter: profile.kind === 'moviepilot'
        ? moviePilotLandingAccessAdapter
        : undefined,
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
    resolveRoutingHandle(intent) {
      if (!intent || intent.providerKind !== 'tmdb') return undefined;
      return handleFor(
        'tmdb',
        intent.operationId || 'libra.routing.fact.observe@1',
      );
    },
    resolveExternalMaterialHandle(request) {
      if (!request || typeof request.operationId !== 'string' ||
          !request.operationId.startsWith('libra.external_material.')) {
        return undefined;
      }
      return handleFor('moviepilot', request.operationId);
    },
    resolveExternalLandingLocation(request) {
      const runtime = runtimeFor('moviepilot');
      if (!runtime) {
        throw new CleanServiceHostError(
          'PLATFORM_EXTERNAL_LANDING_UNAVAILABLE',
          'MoviePilot External Landing is unavailable.',
        );
      }
      return runtime.resolveExternalLandingLocation(request);
    },
    readExternalLandingBinding(request) {
      const runtime = runtimeFor('moviepilot');
      const snapshot = runtime?.readCurrent();
      if (!snapshot || snapshot.integration.state !== 'active' ||
          request?.integrationId !== snapshot.integration.integrationId ||
          request?.configRevision !== snapshot.integration.configRevision) {
        throw new CleanServiceHostError(
          'PLATFORM_EXTERNAL_LANDING_FENCE_STALE',
          'MoviePilot External Landing binding is unavailable or stale.',
        );
      }
      return snapshot.integration.config.landingBinding;
    },
    readExternalAcquisitionSettings(request) {
      const runtime=runtimeFor('moviepilot'),snapshot=runtime?.readCurrent();
      if(!snapshot||snapshot.integration.state!=='active'||
          request?.integrationId!==snapshot.integration.integrationId||
          request?.configRevision!==snapshot.integration.configRevision){
        throw new CleanServiceHostError('PLATFORM_EXTERNAL_ACQUISITION_FENCE_STALE',
          'MoviePilot acquisition settings are unavailable or stale.');
      }
      const value=snapshot.integration.config.settings;
      return Object.freeze({maxDownloadAttempts:value?.maxDownloadAttempts??3});
    },
    assertExternalLandingRootAvailable(request) {
      const runtime = runtimeFor('moviepilot');
      return runtime
        ? runtime.assertExternalLandingRootAvailable(request)
        : Object.freeze({ available:true });
    },
    async observeRoutingProvider({ intent, integrationHandle, operationId = 'libra.routing.fact.observe@1' }) {
      return tmdbAdapter.observationPort.execute({ operationId, integrationHandle,
        input: { contentProfile: intent.contentProfile, title: intent.candidateDisplayTitle, yearHint: intent.yearHint,
          strongProviderKey: intent.strongProviderAnchor?.providerKey || null }, timeoutMs: 10_000 });
    },
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
      const operationId = request.integrationHandle?.allowedOperation;
      if (request.operationId !== operationId) {
        throw new CleanServiceHostError(
          'PLATFORM_INTEGRATION_HANDLE_INVALID',
          'Provider artifact request does not match its frozen Integration Handle operation.',
        );
      }
      if (!['libra.product_artifact.acquire@1',
        'arca.aftercare.binary_artifact.acquire@1'].includes(operationId)) {
        throw new CleanServiceHostError(
          'PLATFORM_INTEGRATION_HANDLE_INVALID',
          'Provider artifact acquisition requires an artifact-scoped Integration Handle.',
        );
      }
      return tmdbAdapter.artifactPort.execute({
        operationId,
        integrationHandle: request.integrationHandle,
        input: {
          artifactKind: request.artifactKind,
          resolvedProviderIdentity:
            request.resolvedProviderIdentity,
        },
        timeoutMs: 20_000,
      });
    },
    async readPersonAvatar(providerIdentity) {
      const handle = handleFor(
        'tmdb',
        'people.registration_evidence.observe@1',
      );
      if (!handle) {
        throw new CleanServiceHostError(
          'PLATFORM_INTEGRATION_NOT_CONFIGURED',
          'TMDB integration is not configured.',
        );
      }
      return tmdbAdapter.observationPort.execute({
        operationId: 'people.registration_evidence.observe@1',
        integrationHandle: handle,
        input: { providerIdentity },
        timeoutMs: 10_000,
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
      if (!intent.integrationId || !Number.isSafeInteger(intent.configRevision)) {
        return handleFor('tmdb', value.operationId, value.artifactKind || null);
      }
      return tmdbRuntime.integrationHandleResolverPort.resolve({
        integrationId: intent.integrationId,
        integrationType: intent.providerKind,
        configRevision: intent.configRevision,
        allowedOperation: value.operationId,
        artifactKind: value.artifactKind || null,
      });
    },
    resolveCurrentProductHandle(value) {
      if (!value || typeof value.operationId !== 'string') return undefined;
      if (value.providerKind === 'tmdb') {
        return handleFor('tmdb', value.operationId, value.artifactKind || null);
      }
      if (value.providerKind === 'jav' && javRuntime.isActive()) {
        return javProductHandle(value.operationId, value.artifactKind || null);
      }
      return undefined;
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
    resolvePerceptionHandle(source) {
      if (!source || source.sourceKind !== 'douban') return undefined;
      return handleFor('douban', 'perception.source.acquire@1');
    },
    readDoubanSourceConfiguration() {
      const snapshot = runtimeFor('douban')?.readCurrent();
      const providerKey = snapshot?.integration?.config?.lastTestSummary?.identityProviderKey;
      if (!snapshot || snapshot.integration.state !== 'active') return null;
      // Platform provider summaries may carry numeric external identities, while
      // Perception owns a durable TEXT identity. Normalize at the Platform ->
      // Perception boundary so automation can compare current configuration with
      // its persisted Acquisition facts exactly.
      const sourceId = normalizePerceptionSourceId(providerKey);
      if (!sourceId) return null;
      return Object.freeze({ sourceId, integrationId:snapshot.integration.integrationId,
        configRevision:snapshot.integration.configRevision });
    },
    readAcceptanceConnectionRevision() {
      return canonicalDigest(PROFILES.map((profile) => {
        const snapshot = runtimeFor(profile.kind)?.readCurrent();
        return Object.freeze({ kind:profile.kind, state:snapshot?.integration?.state || 'absent',
          configRevision:snapshot?.integration?.configRevision || 0 });
      }));
    },
    async acquirePerceptionProvider(request) {
      return this.executeProvider('douban', { operationId:'perception.source.acquire@1', effectClass:'pure_observation',
        idempotencyKey:request.idempotencyKey, timeoutMs:request.timeoutMs, input:request.input });
    },
    async readPerceptionObservation(reference) {
      const adapter = adapters.get('douban');
      if (!adapter?.observationReader?.read) throw new CleanServiceHostError('PLATFORM_INTEGRATION_RESPONSE_INVALID', 'Douban Observation reader is unavailable.');
      return adapter.observationReader.read(reference);
    },
  });
}

async function readBoundedRoutingNfo(handle) {
  if (!handle || typeof handle.location !== 'string') throw new CleanServiceHostError('LIBRA_ROUTING_NFO_HANDLE_INVALID', 'Routing NFO Read Handle is invalid.');
  const opened = await fs.promises.open(handle.location, 'r');
  try {
    const before = await opened.stat({ bigint: true });
    if (!before.isFile() || before.size > 256n * 1024n || Number(before.size) !== Number(handle.expectedSizeBytes)) {
      throw new CleanServiceHostError('LIBRA_ROUTING_NFO_BOUND', 'Routing NFO must be one bounded regular file.');
    }
    const buffer = Buffer.alloc(Number(before.size));
    const read = await opened.read(buffer, 0, buffer.length, 0);
    if (read.bytesRead !== buffer.length) throw new CleanServiceHostError('LIBRA_ROUTING_NFO_SHORT_READ', 'Routing NFO changed during bounded read.');
    const after = await opened.stat({ bigint: true });
    if (before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
      throw new CleanServiceHostError('LIBRA_ROUTING_NFO_STAT_FENCE', 'Routing NFO changed during bounded read.');
    }
    return buffer.toString('utf8');
  } finally {
    await opened.close();
  }
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
    error.code === 'ADMIN_SHELF_CONFLICT' ||
    error.code === 'ADMIN_AUTOMATION_IDEMPOTENCY_CONFLICT' ||
    error.code === 'ADMIN_AUTOMATION_CONFLICT'
  ) status = 409;
  else if (error.code === 'ADMIN_AUTOMATION_COMMAND_REJECTED' || error.code === 'ADMIN_AUTOMATION_PROJECTION_UNAVAILABLE') status = 400;
  else if (error.code === 'ADMIN_RULE_TEMPLATE_NOT_FOUND') status = 404;
  else if (error.code === 'ARCA_SHELF_ENTRY_NOT_FOUND' || error.code === 'PERCEPTION_TARGET_NOT_FOUND') status = 404;
  else if (error.code === 'PERCEPTION_RATING_COMMAND_INVALID' || error.code === 'PERCEPTION_ACQUISITION_COMMAND_INVALID' || error.code === 'PERCEPTION_DOUBAN_NOT_CONFIGURED') status = 400;
  else if (error.code === 'PERCEPTION_RATING_REVISION_CONFLICT' || error.code === 'PERCEPTION_SOURCE_REVISION_CONFLICT') status = 409;
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
  else if (error.code === 'ADMIN_ROUTING_MANUAL_INPUT_INVALID') status = 400;
  else if (error.code === 'FORMATION_SUBJECT_NOT_FOUND') status = 404;
  else if (typeof error.code === 'string' && error.code.startsWith('PEOPLE_')) status = 404;
  else if (error.code === 'ADMIN_ROUTING_MANUAL_STATE_CONFLICT' || error.code === 'ADMIN_ROUTING_MANUAL_HEAD_CONFLICT') status = 409;
  else if (error.code === 'ADMIN_FIELD_COMMAND_REJECTED' || error.code === 'ADMIN_FIELD_TARGET_MISMATCH' ||
    error.code === 'ADMIN_MEDIA_PROFILE_UNSUPPORTED') status = 400;
  else if (error.code === 'ADMIN_FIELD_IDEMPOTENCY_CONFLICT') status = 409;
  else if (error.code === 'ADMIN_FIELD_CONFLICT') status = 409;
  else if (typeof error.code === 'string' && error.code.startsWith('ARCA_OFFDECK_')) {
    if (error.code.endsWith('_NOT_FOUND')) status = 404;
    else if (/(?:_STALE|_CONFLICT|_NOT_OPEN|_NOT_ACTIVE|_NOT_READY|_NOT_CANCELLABLE)$/.test(error.code)) status = 409;
    else status = 400;
  }
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
      error.code.startsWith('PLATFORM_MOVIEPILOT_') ||
      error.code.startsWith('PLATFORM_EXTERNAL_LANDING_') ||
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
  if (routeManifest.status !== 'active' || routeManifest.entries.length !== 121) {
    findings.push('ROUTE_INVENTORY_INCOMPLETE');
  }
  if (uiManifest.status !== 'active' || uiManifest.entries.length !== 17) {
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
    migrateUatIdentitySelectionSchema({ Database, databasePath, schemaManifest, now: options.now });
    repairTerminalResourceDefers({ Database, databasePath, now: options.now });
    kernel = openSqliteKernel({
      Database,
      databasePath,
      schemaDdl,
      schemaManifest,
      now: options.now,
    });
    const baseUnitOfWork = createSqliteUnitOfWork({ kernel });
    const unitOfWork = typeof options.unitOfWorkDecorator === 'function'
      ? options.unitOfWorkDecorator(baseUnitOfWork)
      : baseUnitOfWork;
    if (!unitOfWork || typeof unitOfWork.execute !== 'function') {
      throw new TypeError('Unit of Work decorator must preserve execute(participants).');
    }
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
      applicationDependencies: Object.freeze({
        schemaManifest,
        unitOfWork,
        procurementMetrics: options.procurementMetrics || null,
      }),
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
  const materialFieldStore = createMaterialFieldStore(
    constructed.applicationDependencies,
  );
  const localMountProbe = createCleanLocalFilesystemMountProbe();
  const locationRegistryRepository = createLocationRegistryRepository(
    constructed.applicationDependencies,
  );
  const localMountScopeResolver = createLocalFilesystemMountScopeResolver({
    repository: locationRegistryRepository,
    inspectRoot: (rootLocation) => localMountProbe.inspectRoot(rootLocation),
    now: options.now || Date.now,
  });
  let aftercareWorkspaceRoot = path.resolve(options.aftercareWorkspaceRoot ||
    path.join(options.dataDir, 'workspaces', 'aftercare'));
  let platformIntegrations = null;
  let shelfDeregistrationExecution = null;
  let setupReadinessQuery = null;
  const inputSettlementAuthorizationStore = createInputSettlementAuthorizationStore(
    constructed.applicationDependencies,
  );
  const arcaShelfAdmin = createArcaShelfAdminApplication({
    ...constructed.applicationDependencies,
    inputSettlementAuthorizationStore,
    readSetupReadiness: () => setupReadinessQuery.get(),
    targetFolderProbe: createCleanShelfTargetFolderProbe({
      mountScopeResolver: localMountScopeResolver,
    }),
    assertLocationAvailable: (request) =>
      platformIntegrations?.assertExternalLandingRootAvailable(request),
    onDeregistrationIntent: (intent) => {
      queueMicrotask(() => {
        try {
          shelfDeregistrationExecution?.arcaShelfDeregistrationCoordinator.reconcile(intent.deregistrationId);
          shelfDeregistrationExecution?.host.wake();
        } catch (error) {
          options.onExecutionRuntimeError?.(error);
        }
      });
    },
  });
  const aftercareReservedRoots = [
    { kind:'libra-workspace', rootId:'service-libra-production-workspace',
      resolvedRoot:path.resolve(options.libraWorkspaceRoot || path.join(options.dataDir, 'workspaces', 'libra')) },
    ...materialFieldStore.listMaterialFields()
      .filter((field) => field.status === 'active')
      .map((field) => ({ kind:'material-field', rootId:field.fieldId, resolvedRoot:field.access.rootLocation })),
    ...arcaShelfAdmin.listShelves().items
      .filter((shelf) => shelf.status === 'active')
      .map((shelf) => ({ kind:'shelf-target', rootId:shelf.shelfId, resolvedRoot:shelf.target.rootLocation })),
    ...locationRegistryRepository.listWorkspaceRoots()
      .filter((root) => root.state === 'active' && root.rootId !== 'service-arca-aftercare-workspace')
      .map((root) => ({ kind:'platform-workspace', rootId:root.rootId, resolvedRoot:root.resolvedRoot })),
  ];
  assertAftercareWorkspaceRootAvailable(aftercareWorkspaceRoot, aftercareReservedRoots);
  fs.mkdirSync(aftercareWorkspaceRoot, { recursive:true });
  aftercareWorkspaceRoot = localMountProbe.inspectRoot(aftercareWorkspaceRoot).resolvedRoot;
  assertAftercareWorkspaceRootAvailable(aftercareWorkspaceRoot, aftercareReservedRoots);
  const aftercareWorkspaceMount = localMountScopeResolver.resolveRoot({
    rootLocation: aftercareWorkspaceRoot,
  });
  platformIntegrations = createPlatformIntegrationServices({
    ...constructed.applicationDependencies,
    dataDir: options.dataDir,
    secretRoot: options.secretRoot,
    now: options.now || Date.now,
    fetchImpl: options.integrationFetch,
    doubanRequestPaceMs: options.doubanRequestPaceMs,
    doubanDelay: options.doubanDelay,
    reservedRoots: () => [
      options.libraWorkspaceRoot ||
        path.join(options.dataDir, 'workspaces', 'libra'),
      aftercareWorkspaceRoot,
      ...(options.integrationReservedRoots || []),
      ...materialFieldStore.listMaterialFields()
        .filter((field) => field.status === 'active')
        .map((field) => field.access.rootLocation),
      ...arcaShelfAdmin.listShelves().items
        .filter((shelf) => shelf.status === 'active')
        .map((shelf) => shelf.target.rootLocation),
    ],
    beforeIntegrationPlatformCommit:
      options.beforeIntegrationPlatformCommit,
    afterIntegrationPlatformCommit:
      options.afterIntegrationPlatformCommit,
  });
  const arcaRuleTemplateAdmin = createArcaRuleTemplateAdminApplication(
    constructed.applicationDependencies,
  );
  const candidateDeliveryPort = CandidateDeliveryPort(createCandidateDeliveryService({
    ...constructed.applicationDependencies,
    candidateDeliveryReader: createCandidateDeliveryReader(constructed.applicationDependencies),
    contractValidator: Object.freeze({ validate(_schemaRef, value) {
      if (!value || typeof value !== 'object') {
        throw new CleanServiceHostError(
          'CANDIDATE_DELIVERY_CONTRACT_INVALID',
          'Candidate Delivery contract value is absent.',
        );
      }
    } }),
  }));
  const candidateAcceptance = createCandidateAcceptanceConsumer(constructed.applicationDependencies);
  const arcaRoutingTargets = createShelfRoutingTargetProjection(constructed.applicationDependencies);
  let arcaCare = null;
  const arcaCollectionQuery = createArcaCollectionQuery({
    ...constructed.applicationDependencies,
    posterReader: options.arcaPosterReader || ((reference) => {
      const root = path.resolve(reference.shelfTargetRoot);
      const target = path.resolve(reference.location);
      if (target !== root && !target.startsWith(root + path.sep)) {
        throw new Error('Shelf Entry poster escaped its Shelf Target.');
      }
      const before = fs.statSync(target);
      if (!before.isFile() || before.size !== reference.sizeBytes || before.size > 16 * 1024 * 1024) {
        throw new Error('Shelf Entry poster violates its bounded Inventory read contract.');
      }
      const bytes = fs.readFileSync(target);
      const after = fs.statSync(target);
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || bytes.length !== before.size) {
        throw new Error('Shelf Entry poster changed during its bounded read.');
      }
      const extension = path.extname(target).toLowerCase();
      const contentType = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
      return Object.freeze({ contentType, bytes });
    }),
    healthReader:(shelfEntryId)=>arcaCare?.detail(shelfEntryId)?.health||Object.freeze({state:'never_assessed'}),
    healthReaderMany:(shelfEntryIds)=>arcaCare?.summaries(shelfEntryIds)||new Map(),
  });
  const workspaceProductPort = options.workspaceProductPort ||
    createCleanWorkspaceProductPort({
      ...constructed.applicationDependencies,
      rootPath: options.libraWorkspaceRoot ||
        path.join(options.dataDir, 'workspaces', 'libra'),
      externalLandingResolver: (request) =>
        platformIntegrations.resolveExternalLandingLocation(request),
      now: options.now || Date.now,
      statfsSync: options.workspaceStatfsSync,
      afterPhysicalEffect: options.workspaceAfterPhysicalEffect,
      afterMediaPhysicalEffect: options.workspaceAfterMediaPhysicalEffect,
      afterMediaEffectCommit: options.workspaceAfterMediaEffectCommit,
      afterCleanupPhysicalEffect: options.workspaceAfterCleanupPhysicalEffect,
    });
  const productDeliveryPort = ProductDeliveryPort(createProductDeliveryReader(
    constructed.applicationDependencies,
  ));
  const arcaInventoryPort = options.arcaInventoryPort || createCleanArcaInventoryPort({
    ...constructed.applicationDependencies,
    workspaceRoot: workspaceProductPort.rootPath,
    now: options.now || Date.now,
    statfsSync: options.arcaStatfsSync,
    afterPhysicalEffect: options.arcaAfterPhysicalEffect,
  });
  const mediaProbe = options.mediaProbe || createCleanMediaProbe({
    workspaceMaterialLocationResolver: (handle) => workspaceProductPort.resolveMaterialLocation(handle),
  });
  const productProductionPort = options.productProductionPort ||
    createCleanProductProductionPort({
      mediaProbe,
      workspaceProductPort,
      now: options.now || Date.now,
      fetchProviderMetadata: (request) =>
        (options.productProviderMetadataFetch || platformIntegrations.fetchProviderMetadata)(request),
      fetchProviderArtifact: (request) =>
        (options.productProviderArtifactFetch || platformIntegrations.fetchProviderArtifact)(request),
      searchProviderIdentity: (request) =>
        platformIntegrations.searchProviderIdentity(request),
      resolveProductIntegrationHandle: (request) =>
        (options.productIntegrationHandleResolver || platformIntegrations.resolveProductHandle)(request),
      resolveCurrentProductIntegrationHandle: options.currentProductIntegrationHandleResolver ||
        ((request) => platformIntegrations.resolveCurrentProductHandle(request)),
    });
  const ffmpegProcessRegistry = options.ffmpegProcessRegistry || createFfmpegProcessRegistry();
  const mediaEffectPort = options.mediaProductionEffectPort ||
    createCleanMediaProductionEffectPort({
      workspaceProductPort,
      ffmpegPath: options.ffmpegPath,
      ffmpegProcessRegistry,
    });
  const platformComputeRuntime = options.platformComputeRuntime || (options.mediaProbe ? undefined :
    await createCleanComputeDeviceRuntime({
      ...constructed.applicationDependencies,
      ffmpegPath: options.ffmpegPath,
      now: options.now || Date.now,
    }));
  let routingExecution = null;
  const libraRoutingAdmin = createLibraRoutingAdminApplication({
    ...constructed.applicationDependencies,
    readArcaRoutingTargets: arcaRoutingTargets.list,
    readArcaShelfStandard: arcaRoutingTargets.getStandard,
    onPolicyPublished(policy) { routingExecution?.routingCoordinator.reconcileField(policy.fieldId, 100); routingExecution?.host.wake(); },
  });
  let formationRatingReader = () => new Map(), formationAcceptanceReader = () => null,
    formationAcceptanceAttention = () => [], formationArcaStatusReader = () => new Map(), formationProjectionHost = null;
  const formationProjectionStore = createFormationProjectionStore(constructed.applicationDependencies);
  const formationRunHistoryStore = createFormationRunHistoryStore(constructed.applicationDependencies);
  const executionProgressProjectionReader = createExecutionProgressProjectionReader(constructed.applicationDependencies);
  const formationProjectionSource = createFormationProjectionSource({
    ...constructed.applicationDependencies,
    progressProjectionReader: executionProgressProjectionReader,
    readPerceptionRatings: (targets) => formationRatingReader(targets),
    readShelfTargets: () => arcaShelfAdmin.listShelves().items,
    isExternalMaterialIntegrationReady: options.externalMaterialIntegrationReadinessReader ||
      (() => platformIntegrations.isActive('moviepilot')),
    readAcceptanceRecoveries: (offerIds) => new Map(offerIds.map((offerId) => [offerId, formationAcceptanceReader(offerId)])),
    readArcaFormationStatuses: (offerIds) => formationArcaStatusReader(offerIds),
  });
  const formationQuery = createFormationQuery({ store: formationProjectionStore, historyStore: formationRunHistoryStore,
    detailSource: formationProjectionSource,
    now: options.now || Date.now,
    readAcceptanceRecovery:(offerId)=>formationAcceptanceReader(offerId),
    listAcceptanceAttention:(limit)=>formationAcceptanceAttention(limit),
    state: () => formationProjectionHost?.state() || Object.freeze({ status: 'rebuilding', asOfMs: (options.now || Date.now)() }) });
  const fieldEnumerator = options.fieldObservationEnumerator || createCleanFieldObservationEnumerator({
    onFingerprintRead: options.onPhysicalMaterialFingerprintRead,
  });
  const procurementExecution = createHelixExecutionRuntime({
    ...constructed.applicationDependencies,
    materialFieldStore,
    pageObserverFactory: createFieldPageObserver,
    enumerator: fieldEnumerator,
    inspectFieldRoot: inspectObservationRootSync,
    mediaProbe,
    candidateDeliveryPort,
    readArcaRoutingTargets: arcaRoutingTargets.list,
    readArcaShelfStandard: arcaRoutingTargets.getStandard,
    readRelatedNfo: options.readRelatedNfo || readBoundedRoutingNfo,
    observeRoutingProvider: options.routingProviderObservation || platformIntegrations.observeRoutingProvider,
    resolveRoutingIntegrationHandle: options.routingIntegrationHandleResolver || platformIntegrations.resolveRoutingHandle,
    resolveExternalMaterialIntegrationHandle: options.externalMaterialIntegrationHandleResolver ||
      platformIntegrations.resolveExternalMaterialHandle,
    readExternalMaterialLandingBinding: options.externalMaterialLandingBindingReader ||
      platformIntegrations.readExternalLandingBinding,
    readExternalAcquisitionSettings: options.externalAcquisitionSettingsReader ||
      platformIntegrations.readExternalAcquisitionSettings,
    executeExternalProvider: options.externalMaterialProviderExecution ||
      ((request) => platformIntegrations.executeProvider('moviepilot', request)),
    resolvePerceptionIntegrationHandle: options.perceptionIntegrationHandleResolver || platformIntegrations.resolvePerceptionHandle,
    acquirePerceptionProvider: options.perceptionProviderAcquisition || ((request) => platformIntegrations.acquirePerceptionProvider(request)),
    readPerceptionObservation: options.perceptionObservationReader || ((reference) => platformIntegrations.readPerceptionObservation(reference)),
    readDoubanSourceConfiguration: options.readDoubanSourceConfiguration || platformIntegrations.readDoubanSourceConfiguration,
    readAcceptanceConnectionRevision: options.readAcceptanceConnectionRevision || platformIntegrations.readAcceptanceConnectionRevision,
    targetProjectionReader: options.perceptionTargetProjectionReader || ((targetType, targetId) => {
      if (targetType === 'shelf_entry') return arcaCollectionQuery.targetProjection(targetId);
      if (targetType !== 'subject') return null;
      const context = routingExecution?.routingContextReader.read(targetId);
      if (!context) return null;
      const claim = context.deliverySnapshot?.candidatePackage?.identityClaim || {};
      const derivedIdentity = buildRatingTargetIdentity({
        title: claim.claimedTitle || claim.displayTitle || targetId,
        year: claim.claimedYear,
        providerIdentity: null,
      });
      const body = { targetType:'subject', targetId, targetRevision:context.subject.intakeRevision,
        title:derivedIdentity.title, year:derivedIdentity.year, providerIdentity:derivedIdentity.providerIdentity,
        subjectSnapshotDigest:context.subject.snapshotDigest };
      return Object.freeze({ ...body, targetDigest:canonicalDigest(body) });
    }),
    workspaceProductPort,
    productProductionPort,
    mediaEffectPort,
    ffmpegProcessRegistry,
    progressProjectionReader: executionProgressProjectionReader,
    platformComputeRuntime,
    productDeliveryPort,
    inventoryPort: arcaInventoryPort,
    offdeckDeletionPort: options.offdeckDeletionPort || createCleanOffdeckDeletionPort({
      afterPhysicalEffect: options.afterOffdeckPhysicalEffect,
    }),
    fetchAftercareArtifact: options.aftercareArtifactFetch || options.productProviderArtifactFetch ||
      platformIntegrations.fetchProviderArtifact,
    resolveAftercareIntegrationHandle: options.aftercareIntegrationHandleResolver ||
      options.currentProductIntegrationHandleResolver || ((request) =>
        platformIntegrations.resolveCurrentProductHandle({
          providerKind: request.providerKind || request.intent?.providerKind,
          operationId: request.operationId,
          artifactKind: request.artifactKind || null,
        })),
    aftercareWorkspaceRoot,
    aftercareWorkspaceEndpointId: aftercareWorkspaceMount.endpointId,
    aftercareWorkspaceMountScopeId: aftercareWorkspaceMount.mountScopeId,
    aftercareWorkspaceMountScopeRevision: aftercareWorkspaceMount.mountScopeRevision,
    ffmpegPath: options.ffmpegPath,
    now: options.now || Date.now,
    onFormationSubjectChanged: (subjectId) => formationProjectionHost?.enqueue(subjectId),
    onFormationRunChanged: (libraRunId) => formationProjectionHost?.enqueue(formationProjectionSource.findSubjectByRun(libraRunId)),
    afterOnDeckCommit: (value) => { formationProjectionHost?.enqueue(value.subjectId); options.afterOnDeckCommit?.(value); },
    onError: options.onExecutionRuntimeError,
  });
  routingExecution = procurementExecution;
  shelfDeregistrationExecution = procurementExecution;
  formationRatingReader = (targets) => procurementExecution.perception.readCurrentRatings('subject', targets);
  formationAcceptanceReader = (offerId) => procurementExecution.arcaCoordinator.readAcceptanceRecovery(offerId);
  formationAcceptanceAttention = (limit) => procurementExecution.arcaCoordinator.listAcceptanceAttention(limit);
  formationArcaStatusReader = (offerIds) => procurementExecution.arcaFormationStatusProjection.read(offerIds);
  formationProjectionHost = createFormationProjectionHost({
    ...constructed.applicationDependencies,
    source: formationProjectionSource,
    store: formationProjectionStore,
    now: options.now || Date.now,
    onError: options.onExecutionRuntimeError,
  });
  const routingManualSelectionService = createRoutingManualSelectionService({
    ...constructed.applicationDependencies,
    contextReader: procurementExecution.routingContextReader,
  });
  const routingManualSelection = Object.freeze({ choose(subjectId, body) {
    const result = routingManualSelectionService.choose(subjectId, body); formationProjectionHost.enqueue(subjectId); return result;
  } });
  const candidateRejection = createCandidateRejectionConsumer(constructed.applicationDependencies);
  const handoffBOutcomeConsumer = createHandoffBOutcomeConsumer({
    ...constructed.applicationDependencies,
    libraRunExecutionProjection:
      procurementExecution.libraRunExecutionProjection,
  });
  const outboxDispatcherFactory = options.outboxDispatcherFactory || createOutboxDispatcherHost;
  const outboxDispatcher = outboxDispatcherFactory({
    ...constructed.applicationDependencies,
    now: options.now || Date.now,
    intakeCoordinator: procurementExecution.intakeCoordinator,
    acceptanceConsumer: candidateAcceptance,
    rejectionConsumer: candidateRejection,
    procurementAutomation: procurementExecution.procurementAutomation,
    routingCoordinator: procurementExecution.routingCoordinator,
    perceptionCoordinator: procurementExecution.perception,
    arcaCoordinator: procurementExecution.arcaCoordinator,
    handoffBOutcomeConsumer,
    deferredDeliveryKeys: options.deferredDeliveryKeys || [],
    executionRuntimeHost: procurementExecution.host,
    onError: options.onExecutionRuntimeError,
  });
  const executionRuntimeHost = Object.freeze({
    async start() {
      const execution = await procurementExecution.host.start();
      try {
        await outboxDispatcher.start();
        await formationProjectionHost.start();
        return execution;
      } catch (error) {
        await outboxDispatcher.stop().catch(() => {});
        await procurementExecution.host.stop().catch(() => {});
        throw error;
      }
    },
    wake() { const execution=procurementExecution.host.wake(); outboxDispatcher.wake(); formationProjectionHost.wake(); return execution; },
    async stop() {
      await ffmpegProcessRegistry.close();
      await mediaEffectPort.close?.();
      await formationProjectionHost.stop();
      await outboxDispatcher.stop();
      return procurementExecution.host.stop();
    },
  });
  arcaCare=createArcaCareApplication({contextReader:procurementExecution.arcaAftercareContextReader,
    coordinator:procurementExecution.arcaAftercareCoordinator,wake:()=>executionRuntimeHost.wake()});
  const arcaOffdeck=createOffdeckAdminApplication({...constructed.applicationDependencies,
    contextReader:procurementExecution.arcaOffdeckContextReader,
    automationCoordinator:procurementExecution.arcaOffdeckAutomationCoordinator,
    caseCoordinator:procurementExecution.arcaOffdeckCoordinator,
    aftercareCoordinator:procurementExecution.arcaAftercareCoordinator,
    cancelProcessWorks:procurementExecution.cancelProcessWorks,
    onError:options.onExecutionRuntimeError,
    wake:()=>executionRuntimeHost.wake(),now:options.now||Date.now});
  const libraRunAdminService = createLibraRunAdminService({
    ...constructed.applicationDependencies,
    libraRunExecutionProjection: procurementExecution.libraRunExecutionProjection,
    wake: () => executionRuntimeHost.wake(),
    now: options.now || Date.now,
  });
  const libraRunAdmin = Object.freeze({
    expedite(libraRunId, body) { const result=libraRunAdminService.expedite(libraRunId,body); formationProjectionHost.enqueue(formationProjectionSource.findSubjectByRun(libraRunId)); return result; },
    cancelExpedite(libraRunId, body) { const result=libraRunAdminService.cancelExpedite(libraRunId,body); formationProjectionHost.enqueue(formationProjectionSource.findSubjectByRun(libraRunId)); return result; },
    discard(libraRunId, body) { const result=libraRunAdminService.discard(libraRunId,body); formationProjectionHost.enqueue(formationProjectionSource.findSubjectByRun(libraRunId)); return result; },
    previewDefects(libraRunId) { return libraRunAdminService.previewDefects(libraRunId); },
    admitWithDefects(libraRunId, body) { const result=libraRunAdminService.admitWithDefects(libraRunId,body); formationProjectionHost.enqueue(formationProjectionSource.findSubjectByRun(libraRunId)); return result; },
  });
  const productIdentitySelection = Object.freeze({
    choose(libraRunId, body) {
      const result = procurementExecution.productIdentitySelection.choose(libraRunId, body);
      formationProjectionHost.enqueue(formationProjectionSource.findSubjectByRun(libraRunId));
      procurementExecution.libraRunCoordinator.reconcile(libraRunId);
      executionRuntimeHost.wake();
      return result;
    },
  });
  const arcaAcceptanceRecovery = Object.freeze({
    retry(offerId) { const result=procurementExecution.arcaCoordinator.retryAcceptance(offerId);
      executionRuntimeHost.wake(); return result; },
  });
  const perceptionAdmin = Object.freeze({
    createRecord(body) { const result=procurementExecution.perception.createRecord(body); if(body?.targetType==='subject')formationProjectionHost.enqueue(body.targetId); executionRuntimeHost.wake(); return result; },
    listRecords(query) { const result=procurementExecution.perception.listRecords(query);
      if(!query?.targetType||!query?.targetId)return result;
      return Object.freeze({...result,currentRating:procurementExecution.perception.readCurrentRating(query.targetType,query.targetId)}); },
    listAcquisitions() { return procurementExecution.perception.listAcquisitions(); },
    requestAcquisition(body) { const result=procurementExecution.perception.requestAcquisition(body); executionRuntimeHost.wake(); return result; },
    syncState() { return procurementExecution.perception.syncState(); },
  });
  const fieldAccessProbe = createCleanFieldAccessBindingProbe();
  const procurementAdmin = createProcurementAdminApplication({
    ...constructed.applicationDependencies,
    materialFieldStore,
    executionRuntimeHost,
    assertLocationAvailable: (request) =>
      platformIntegrations.assertExternalLandingRootAvailable(request),
    probeFieldAccess: (request) => Object.freeze({
      ...fieldAccessProbe.inspect(request),
      ...localMountScopeResolver.resolveRoot({ rootLocation: request.rootLocation }),
    }),
  });
  try {
    for (const field of procurementAdmin.listMaterialFields().items
      .filter((item) => item.status === 'active')) {
      localMountScopeResolver.validateReference({
        endpointId: field.access.endpointId,
        rootLocation: field.access.rootLocation,
        mountScopeId: field.access.mountScopeId,
        mountScopeRevision: field.access.mountScopeRevision,
        allowUnavailable: true,
      });
    }
    for (const shelf of arcaShelfAdmin.listShelves().items
      .filter((item) => item.status !== 'deregistered')) {
      localMountScopeResolver.validateReference({
        endpointId: shelf.target.endpointId,
        rootLocation: shelf.target.rootLocation,
        mountScopeId: shelf.target.mountScopeId,
        mountScopeRevision: shelf.target.mountScopeRevision,
        allowUnavailable: true,
      });
    }
  } catch (error) {
    constructed.close();
    throw new CleanServiceHostError(
      'HELIX_MOUNT_SCOPE_UNSAFE',
      'Clean service refuses startup because a configured Field or Shelf Mount Scope is unsafe.',
      { reasonCode: error.code || 'HELIX_MOUNT_SCOPE_UNSAFE' },
    );
  }
  const peopleAdminQuery = createPeopleAdminQuery({
    store: procurementExecution.people.store,
  });
  const peopleAvatarQuery = createPeopleAvatarQuery({
    store: procurementExecution.people.store,
    readProviderAvatar: (identity) => platformIntegrations.readPersonAvatar(identity),
  });
  setupReadinessQuery = createSetupReadinessQuery({
    readMaterialFields: () => procurementAdmin.listMaterialFields(),
    readShelves: () => arcaShelfAdmin.listShelves(),
    readStandingAuthorization: () => inputSettlementAuthorizationStore.current(),
    readRouting: (fieldId) => libraRoutingAdmin.get(fieldId),
    readIntegration: (kind) => platformIntegrations.admin.get(kind),
    readWorkspace: () => {
      const rootPath = workspaceProductPort.rootPath;
      try {
        return Object.freeze({
          ready: typeof rootPath === 'string' && rootPath.length > 0 && fs.existsSync(rootPath) && fs.statSync(rootPath).isDirectory(),
          rootPath,
        });
      } catch {
        return Object.freeze({ ready: false, rootPath });
      }
    },
    now: options.now || Date.now,
  });
  const overviewQuery = createOverviewQuery({
    readMaterialFields: () => procurementAdmin.listMaterialFields(),
    readShelves: () => arcaShelfAdmin.listShelves(),
    readStandingAuthorization: () => inputSettlementAuthorizationStore.current(),
    readFormation: () => {
      const summary = formationQuery.list({ section:'active', limit:1 }).summary;
      return {
        summary,
        attentionItems: formationQuery.list({ section:'active', classification:'attention_required', limit:5 }).items,
        inProgressItems: formationQuery.list({ section:'active', classification:'in_progress', limit:5 }).items,
        completedItems: formationQuery.list({ section:'completed', limit:5 }).items,
      };
    },
    readCollectionStats: (nowMs) => arcaCollectionQuery.overviewStats(nowMs),
    readOffdeck: () => arcaOffdeck.candidates(),
    readPeopleSummary: () => peopleAdminQuery.list({ limit:1 }).summary,
    readHealth: () => ({ kind: 'ready' }),
    now: options.now || Date.now,
  });
  const peopleAdmin = Object.freeze({
    register(body, actor) {
      return procurementExecution.people.registerPerson(body, actor?.credentialId || 'admin');
    },
    accept(body, actor) {
      return procurementExecution.people.acceptRegistration(body, actor?.credentialId || 'admin');
    },
    dismiss(body, actor) {
      return procurementExecution.people.dismissRegistration(body, actor?.credentialId || 'admin');
    },
  });
  const facades = createCleanFacades({
    sessionTokens,
    readiness,
    credentialMetadata: runtime.readActiveCredential,
    overviewQuery,
    setupReadinessQuery,
    peopleAdminQuery,
    peopleAvatarQuery,
    peopleAdmin,
    procurementAdmin,
    arcaShelfAdmin,
    arcaRuleTemplateAdmin,
    libraRoutingAdmin,
    formationQuery,
    arcaCollectionQuery,
    arcaCare,
    arcaOffdeck,
    routingManualSelection,
    libraRunAdmin,
    productIdentitySelection,
    arcaAcceptanceRecovery,
    platformIntegrationAdmin: platformIntegrations.admin,
    perceptionAdmin,
    nonce: crypto.randomUUID,
  });
  const application = createHelixApplication({
    facades,
    sessionTokens,
    executionRuntimeHost,
  });

  const server = Fastify({ logger: false, trustProxy: false });
  await server.register(fastifyStatic, {
    root: path.resolve(options.adminDistDir),
    prefix: '/',
    wildcard: false,
    cacheControl: false,
    setHeaders(response, filePath) {
      if (path.basename(filePath) === 'index.html') {
        response.setHeader('Cache-Control', 'no-store');
      }
    },
  });
  const sendAdminIndex = (_request, reply) =>
    reply.header('Cache-Control', 'no-store').sendFile('index.html');
  for (const pagePath of ['/material-fields', '/shelves', '/collection', '/formation', '/offdeck', '/people', '/settings']) {
    server.get(pagePath, sendAdminIndex);
  }
  server.get('/admin', sendAdminIndex);
  server.get('/admin/*', sendAdminIndex);

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
          options.onRequestError?.(error, Object.freeze({
            method: request.method,
            path: request.url.split('?')[0],
            correlationId,
          }));
          response = errorResponse(error, correlationId);
        }
        if (response.sessionToken) reply.header('set-cookie', sessionCookie(response.sessionToken));
        if (response.clearSession) reply.header('set-cookie', clearSessionCookie());
        if (response.contentType) reply.type(response.contentType);
        reply.code(response.status);
        return response.status === 204 ? reply.send() : response.body;
      },
    });
  }
  try {
    await server.ready();
  } catch (error) {
    constructed.close();
    throw error;
  }
  try {
    // Build the complete HTTP surface before normal Work supply starts. A
    // recovered live backlog may keep the event loop busy, but it must not
    // consume Fastify's bounded plugin-registration window.
    await application.start();
  } catch (error) {
    await application.stop();
    await server.close();
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
      await application.stop();
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
  assertAftercareWorkspaceRootAvailable,
  normalizePerceptionSourceId,
  inspectCleanRuntimeReadiness,
});
