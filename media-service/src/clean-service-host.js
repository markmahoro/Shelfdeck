'use strict';
const { createFailureEvidenceStore } = require('./helix/integrations/failure-evidence-store');

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const Fastify = require('fastify');
const {registerAdminStatic} = require('./clean-admin-static');
const { createCleanPosterRenderer } = require('./clean-poster-renderer');
const routeRegistry = require('./helix/composition/admin-route-registry');
const { canonicalDigest } = require('./helix/contracts/canonical-json');
const {providerRecoveryDigest,computeRecoveryDigest}=require('./helix/platform/application/failure-recovery-projection');
const { createHelixApplication } = require('./helix/composition/createHelixApplication');
const { createCleanFacades } = require('./helix/composition/create-clean-facades');
const { createRuntimeOperations } = require('./clean-runtime-operations');
const { createMaintenanceWindow } = require('./clean-maintenance-window');
const { reconcilerCategory, workCategory, maintenanceTaskTitle, maintenanceExecutionTitle } = require('./helix/composition/maintenance-admission-policy');
const { createOverviewProjectionHost } = require('./helix/projections/overview-projection-host');
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
const { createProcurementAdminApplication,createMaterialExclusionCommandPort } = require('./helix/domains/procurement/public/admin-application');
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
const {
  createFailedPreparationRetryAdminService,
} = require('./helix/domains/procurement/application/failed-preparation-retry-admin-service');
const {
  createDefaultTriageRuleRegistry,
} = require('./helix/domains/procurement/model/procurement-run-contracts');
const { createOutboxDispatcherHost } = require('./helix/foundation/execution/outbox-dispatcher-host');
const {
  createSynchronousDomainWork,
} = require('./helix/foundation/execution/synchronous-domain-work');
const {
  createHandoffBOutcomeConsumer,
} = require('./helix/domains/libra/application/handoff-b-outcome-consumer');
const {
  createArcaRuleTemplateAdminApplication,
  createArcaShelfAdminApplication,
} = require('./helix/domains/arca/public/admin-application');
const { createShelfRoutingTargetProjection } = require('./helix/domains/arca/public/routing-target-projection');
const { createArcaCollectionQuery } = require('./helix/domains/arca/application/collection-query');
const {createSourceCleanupStore}=require('./helix/domains/arca/persistence/source-cleanup-store');
const {createRecycleStore}=require('./helix/domains/arca/persistence/recycle-store');
const {createRecycleApplication}=require('./helix/domains/arca/application/recycle-application');
const recycleFiles=require('./clean-arca-recycle-port');
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
const { createFieldIntakeAdmissionAdminService } = require('./helix/domains/libra/application/field-intake-admission-admin-service');
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
const { createCleanWorkspaceRootAdmin } = require('./clean-workspace-root-admin');
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
  TARGET_SCHEMA_DIGEST: UAT_MIGRATION_TARGET_SCHEMA_DIGEST,
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
const { SESSION_COOKIE, cookieValue, sessionCookie, clearSessionCookie } = require('./clean-session-cookies');
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

function resolveAftercareWorkspaceRoot({ explicitRoot, durableRoot, dataDir } = {}) {
  return path.resolve(explicitRoot || durableRoot || path.join(dataDir, 'workspaces', 'aftercare'));
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
  const networkPolicy = require('./helix/platform/public/integration-runtime').createNetworkPolicy({ repository, receiptRepository, now: options.now });
  const networkFetch = require('./helix/integrations/network-fetch').createNetworkFetch({ networkPolicy, fetchImpl: options.fetchImpl });
  const runtimes = new Map();
  const adapters = new Map();
  const admins = new Map();
  for (const profile of PROFILES) {
    const runtime = createPlatformIntegrationRuntime({
      profile,
      networkPolicy,
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
    const adapter = profile.kind === 'stashbox'
      ? require('./helix/integrations/stashbox-provider-adapter').createStashBoxProviderAdapter({ runtime, fetchImpl: networkFetch, now: options.now })
      : profile.siteRef
      ? require('./helix/integrations/jav-source-provider-adapter').createJavSourceProviderAdapter({ runtime, networkPolicy, fetchImpl: networkFetch, now: options.now })
      : profile.kind === 'tmdb'
      ? createTmdbProviderAdapter({
          integrationQueryPort: runtime.integrationQueryPort,
          integrationHandleResolverPort:
            runtime.integrationHandleResolverPort,
          secretLeaseResolverPort:
            runtime.secretLeaseResolverPort,
          secretLeaseConsumer: runtime.broker,
          fetchImpl: networkFetch,
          now: options.now,
        })
      : createProviderAdapter(profile.kind, {
          runtime,
          fetchImpl: networkFetch,
          now: options.now,
          doubanRequestPaceMs: options.doubanRequestPaceMs,
          doubanDelay: options.doubanDelay,
        });
    const admin = createIntegrationAdminApplication({
      profile,
      networkPolicy,
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
  const stashBoxAdapter = adapters.get('stashbox');
  const peopleImageSearch = require('./helix/integrations/people-image-search').createPeopleImageSearch({
    fetchImpl: networkFetch, readNetworkRoute: () => networkPolicy.route(),
    readStashBoxConfiguration: stashBoxAdapter.configuration, withStashBoxCredential: stashBoxAdapter.withCredential,
    tokenKey: crypto.createHmac('sha256', options.secretRoot).update('shelfdeck.people-image-selection@1').digest(), now: options.now,
  });
  const javProductAdapter = createJavProductProviderAdapter({
    runtime: javRuntime,
    fetchImpl: networkFetch,
    now: options.now,
  });

  const admin = Object.freeze({
    configure(kind, body) {
      if (kind === 'network') return networkPolicy.configure(kind, body);
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
      if (kind === 'network') return networkPolicy.get();
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

  function javBindingHandle(binding,operationId,artifactKind=null) {
    const {assertJavSelectedSource}=require('./helix/contracts/jav-selected-source');
    assertJavSelectedSource(binding);
    const handle=handleFor('jav-'+binding.siteRef,operationId,artifactKind);
    if(!handle || ['integrationId','configRevision','siteRef','endpointProfileDigest','networkRouteDigest','authMode'].some(key=>handle[key]!==binding[key]))
      throw new CleanServiceHostError('CLEAN_PRODUCT_INTEGRATION_UNAVAILABLE','The selected JAV source configuration is unavailable or changed.');
    return handle;
  }
  async function observeJavBinding(binding,operationId,integrationHandle) {
    javBindingHandle(binding,operationId);
    const adapter=adapters.get('jav-'+binding.siteRef),observed=await adapter.observationPort.execute({operationId,integrationHandle,
      input:{queryAnchor:binding.queryAnchor,resourceKey:binding.resourceKey}});
    if(observed.result!=='qualified' || observed.resourceKey!==binding.resourceKey || observed.cover.byteDigest!==binding.coverDigest ||
        observed.descriptiveEntries.find(entry=>entry.key==='title')?.value!==binding.title ||
        observed.resolvedProviderIdentity?.providerKey!==binding.queryAnchor.javCode)
      throw new CleanServiceHostError('JAV_SOURCE_ARTIFACT_CHANGED','The selected JAV source qualification changed.');
    return observed;
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
    close: networkFetch.close,
    admin,
    integrationHandleResolverPort:
      tmdbRuntime.integrationHandleResolverPort,
    isActive(kind) {
      return runtimeFor(kind)?.isActive() === true;
    },
    isTmdbActive: tmdbRuntime.isTmdbActive,
    providerAdapters: adapters,
    providerRuntimes: runtimes,
    resolveJavSourceHandle(request) {
      return handleFor('jav-' + request.siteRef, request.operationId, request.artifactKind ?? null);
    },
    async observeJavSource(request) {
      const adapter = adapters.get('jav-' + request?.siteRef);
      if (!adapter) throw new CleanServiceHostError('PLATFORM_INTEGRATION_KIND_UNSUPPORTED', 'JAV source is unsupported.');
      const operationId = request.operationId || 'libra.product_identity.evidence.observe@1';
      const integrationHandle = request.integrationHandle || handleFor('jav-' + request.siteRef, operationId);
      return adapter.observationPort.execute({ operationId, integrationHandle, input: request.input, timeoutMs: request.timeoutMs });
    },
    async previewJavSource(request) {
      const adapter=adapters.get('jav-'+request?.siteRef);
      if(!adapter)throw new CleanServiceHostError('PLATFORM_INTEGRATION_KIND_UNSUPPORTED','JAV source is unsupported.');
      const operationId=request.operationId||'libra.product_identity.evidence.observe@1',integrationHandle=request.integrationHandle||handleFor('jav-'+request.siteRef,operationId);
      return adapter.preview({operationId,integrationHandle,input:request.input,timeoutMs:request.timeoutMs});
    },
    async prepareJavSourceArtifact(request) {
      const adapter = adapters.get('jav-' + request?.siteRef);
      if (!adapter) throw new CleanServiceHostError('PLATFORM_INTEGRATION_KIND_UNSUPPORTED', 'JAV source is unsupported.');
      const operationId = 'libra.product_artifact.acquire@1';
      const integrationHandle = request.integrationHandle || handleFor('jav-' + request.siteRef, operationId, request.input?.artifactKind);
      return adapter.prepareArtifact({ operationId, integrationHandle, input: request.input, timeoutMs: request.timeoutMs });
    },
    async acquireJavCorrectionCover(request) {
      const adapter=adapters.get('jav-'+request?.siteRef);
      if(!adapter)throw new CleanServiceHostError('PLATFORM_INTEGRATION_KIND_UNSUPPORTED','JAV source is unsupported.');
      if(!['arca.jav_correction.assets.prepare@1','arca.jav_correction.source.verify@1'].includes(request.operationId))throw new CleanServiceHostError('P5_PROVIDER_INPUT_INVALID','Correction cover operation is invalid.');
      return adapter.acquireCover({operationId:request.operationId,integrationHandle:request.integrationHandle,input:request.input,timeoutMs:request.timeoutMs});
    },
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
    assertExternalLandingRootAvailable(request) {
      const runtime = runtimeFor('moviepilot');
      return runtime
        ? runtime.assertExternalLandingRootAvailable(request)
        : Object.freeze({ available:true });
    },
    async observeRoutingProvider({ intent, integrationHandle, operationId = 'libra.routing.fact.observe@1' }) {
      return tmdbAdapter.observationPort.execute({ operationId, integrationHandle,
        input: { contentProfile: intent.contentProfile, title: intent.candidateDisplayTitle, yearHint: intent.yearHint,
          ...(intent.contentProfile==='series'?{seasonNumber:intent.seasonNumber}:{}),
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
    async observeEpisodeMetadataCandidates(input) {
      const operationId = 'libra.episode_metadata.candidates.observe@1', handle = handleFor('tmdb', operationId);
      if (!handle) throw new CleanServiceHostError('PLATFORM_INTEGRATION_NOT_CONFIGURED', 'TMDB integration is not configured.');
      return tmdbAdapter.observationPort.execute({ operationId, integrationHandle: handle, input, timeoutMs: 10000 });
    },
    async fetchProviderMetadata(request) {
      if(request.metadataFetchIntent.contentProfile==='jav') {
        const binding=request.metadataFetchIntent.javSelectedSource;
        const observed=await observeJavBinding(binding,'libra.product_metadata.fetch@1',request.integrationHandle);
        return Object.freeze({providerKind:'jav',integrationId:binding.integrationId,configRevision:binding.configRevision,
          descriptiveEntries:[...observed.descriptiveEntries,{key:'jav_code',value:observed.resolvedProviderIdentity.providerKey}],
          providerIdentities:[observed.resolvedProviderIdentity],peopleHints:observed.peopleHints});
      }
      return tmdbAdapter.observationPort.execute({
        operationId: 'libra.product_metadata.fetch@1',
        integrationHandle: request.integrationHandle,
        input: {
          resolvedProviderIdentity:
            request.metadataFetchIntent.resolvedProviderIdentity,
          requestedFields:
            request.metadataFetchIntent.requestedFields,
          ...(request.metadataFetchIntent.episodeScope ? { episodeScope:request.metadataFetchIntent.episodeScope } : {}),
          ...(request.metadataFetchIntent.episodePlotPolicyRef?{episodePlotPolicyRef:request.metadataFetchIntent.episodePlotPolicyRef}:{}),
          ...(request.metadataFetchIntent.episodeMapping ? { providerEpisodeReference: request.metadataFetchIntent.episodeMapping.providerEpisode } : {}),
        },
        timeoutMs: 10_000,
      });
    },
    resolveSeriesImageSource(source) {
      const snapshot=runtimeFor('tmdb')?.readCurrent(),integration=snapshot?.integration;
      if(integration?.state!=='active')throw new CleanServiceHostError('PLATFORM_INTEGRATION_NOT_CONFIGURED','Show image provider is not configured.');
      return require('./helix/contracts/series-image-source').buildImageSource({...source,integrationId:integration.integrationId,configRevision:integration.configRevision,language:integration.settings?.language||source.language});
    },
    async fetchSeriesPresentationMetadata(basis) {
      const source=basis.sourceObservation,operationId='arca.series_presentation.source.observe@1',handle=handleFor('tmdb',operationId);
      if(!handle||handle.integrationId!==source.integrationId||handle.configRevision!==source.configRevision)
        throw new CleanServiceHostError('ARCA_SERIES_SOURCE_STALE','Shared metadata integration changed.');
      return tmdbAdapter.observationPort.execute({operationId,integrationHandle:handle,input:{metadataRequest:basis},timeoutMs:20000});
    },
    async fetchSeriesPresentationArtifact(request) {
      const source=request.source,handle=handleFor('tmdb',request.operationId,request.artifactKind);
      if(!handle||handle.integrationId!==source.integrationId||handle.configRevision!==source.configRevision)
        throw new CleanServiceHostError('ARCA_SERIES_SOURCE_STALE','Show presentation integration changed.');
      const port=request.operationId==='arca.series_presentation.source.observe@1'
        ?tmdbAdapter.observationPort:tmdbAdapter.artifactPort;
      return port.execute({operationId:request.operationId,integrationHandle:handle,
        input:{seriesPresentationSource:source,artifactKind:request.artifactKind,...(request.imagePath?{imagePath:request.imagePath}:{})},timeoutMs:20000});
    },
    async fetchProviderArtifact(request) {
      if(request.operationId==='arca.aftercare.binary_artifact.acquire@1'&&request.javSelectedSource) {
        const binding=request.javSelectedSource;
        if(!['poster','fanart'].includes(request.artifactKind)||request.resolvedProviderIdentity?.provider!=='jav'||
          request.resolvedProviderIdentity.namespace!=='jav_code'||request.resolvedProviderIdentity.providerKey!==binding.queryAnchor.javCode)
          throw new CleanServiceHostError('P5_PROVIDER_INPUT_INVALID','Aftercare JAV Artifact identity is invalid.');
        const acquired=await adapters.get('jav-'+binding.siteRef).acquireAftercareCover(request);
        return {resultKind:'acquired',sourceCoverBytes:acquired.coverBytes,javSelectedSource:binding,
          sourceObservation:acquired.observation,sourceObservationDigest:acquired.observation.observationDigest,artifactKind:request.artifactKind,mediaType:'image/jpeg',
          integrationId:request.integrationHandle.integrationId,configRevision:request.integrationHandle.configRevision,resolvedProviderIdentity:request.resolvedProviderIdentity};
      }
      if(request.productMetadataDraft?.javSelectedSource) {
        const binding=request.productMetadataDraft.javSelectedSource,operationId='libra.product_artifact.acquire@1';
        javBindingHandle(binding,operationId,request.artifactKind);
        const adapter=adapters.get('jav-'+binding.siteRef),observationHandle=handleFor('jav-'+binding.siteRef,'libra.product_metadata.fetch@1');
        const observed=await observeJavBinding(binding,'libra.product_metadata.fetch@1',observationHandle);
        const acquired=await adapter.acquireCover({operationId,integrationHandle:request.integrationHandle,
          input:{queryAnchor:binding.queryAnchor,qualifiedObservation:observed,artifactKind:request.artifactKind}});
        return {resultKind:'acquired',sourceCoverBytes:acquired.coverBytes,sourceObservationDigest:acquired.observation.observationDigest,
          artifactKind:request.artifactKind,mediaType:'image/jpeg',integrationId:binding.integrationId,
          configRevision:binding.configRevision,resolvedProviderIdentity:observed.resolvedProviderIdentity,
        };
      }
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
          ...(request.resolvedProviderIdentity?.namespace==='tmdb_series'?{artifactScope:request.artifactScope||
            (request.artifactKind==='poster'?{scopeKind:'season',seasonNumber:request.resolvedProviderIdentity.seasonNumber}:{scopeKind:'series'})}:{}),
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
    searchPeopleImages: name => peopleImageSearch.search(name),
    readSelectedPersonImage: token => peopleImageSearch.readSelectedImage(token),
    async fetchJavProviderMetadata(request) {
      return javProductAdapter.fetchProviderMetadata(request);
    },
    async fetchJavProviderArtifact(request) {
      return javProductAdapter.fetchProviderArtifact(request);
    },
    resolveProductHandle(value) {
      const intent = value.intent;
      if(intent?.providerKind==='jav' && intent.javSelectedSource)return javBindingHandle(intent.javSelectedSource,value.operationId,value.artifactKind||null);
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
      if(value.providerKind==='jav' && value.javSelectedSource) {
        if(value.operationId==='arca.aftercare.binary_artifact.acquire@1') {
          const source=require('./helix/contracts/jav-selected-source').assertJavSelectedSource(value.javSelectedSource),
            handle=handleFor('jav-'+source.siteRef,value.operationId,value.artifactKind||null);
          return handle&&handle.integrationId===source.integrationId&&handle.authMode===source.authMode?handle:undefined;
        }
        return javBindingHandle(value.javSelectedSource,value.operationId,value.artifactKind||null);
      }
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
    readRecoveryCondition(kind) {
      if(!['tmdb','moviepilot'].includes(kind)&&getIntegrationProfile(kind)?.integrationType!=='jav_source')
        throw new TypeError('Unknown provider recovery condition.');
      return Object.freeze({conditionKind:kind,snapshotDigest:providerRecoveryDigest(runtimeFor(kind)?.readCurrent(),networkPolicy.route())});
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
  const { readBoundedFileSnapshot } = require('./helix/integrations/bounded-material-fingerprint');
  const snapshot = await readBoundedFileSnapshot(handle.location, 256 * 1024);
  return snapshot.bytes.toString('utf8');
}

function errorResponse(error, correlationId, context = {}) {
  let status = 500;
  if (AUTH_ERROR_CODES.has(error.code)) status = 401;
  else if (['MAINTENANCE_INPUT_INVALID', 'MAINTENANCE_TIME_INVALID', 'MAINTENANCE_CONFIG_INVALID'].includes(error.code)) status = 400;
  else if (['MAINTENANCE_REVISION_CONFLICT', 'MAINTENANCE_COMMAND_CONFLICT'].includes(error.code)) status = 409;
  else if(error.code==='RUNTIME_OPERATION_INPUT_INVALID'||error.code==='RUNTIME_RESET_CONFIRMATION_REQUIRED')status=400;
  else if(typeof error.code==='string'&&error.code.startsWith('RUNTIME_'))status=error.statusCode||409;
  else if(typeof error.code==='string'&&/^RESET_[A-Z0-9_]+$/.test(error.code))status=409;
  else if(typeof error.code==='string'&&error.code.startsWith('LIBRA_EPISODE_')) {
    status=error.code.endsWith('_NOT_FOUND')?404:/(?:_INPUT|_INVALID|_SELECTION_REQUIRED|_MULTIPART_UNSUPPORTED)$/.test(error.code)?400:409;
  }
  else if (error.code === 'OVERVIEW_PROJECTION_REBUILDING') status = 503;
  else if (['LIBRA_REPROCESS_INTENT_STALE','LIBRA_REPROCESS_ALREADY_REQUESTED','LIBRA_DEFECT_AUTHORIZATION_STALE',
    'ARCA_DEFECT_AUTHORIZATION_STALE','ARCA_DEFECT_BASIS_STALE','ARCA_DEFECT_PREVIEW_STALE','ARCA_DEFECT_CONTROL_CHANGED',
    'ARCA_DEFECT_MATERIAL_CHANGED','ARCA_DEFECT_INELIGIBLE','ARCA_DEFECT_COMMAND_KEY_CONFLICT','ARCA_DEFECT_REPAIR_KEY_CONFLICT'].includes(error.code)) status=409;
  else if (['LIBRA_REPROCESS_SOURCE_MISSING','ARCA_DEFECT_ENTRY_MISSING'].includes(error.code)) status=404;
  else if (['LIBRA_DEFECT_AUTHORIZATION_INPUT','ARCA_DEFECT_COMMAND_INVALID','ARCA_DEFECT_SCOPE_TOO_LARGE',
    'ARCA_DEFECT_REPAIR_SCOPE_TOO_LARGE'].includes(error.code)) status=400;
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
  else if (typeof error.code==='string'&&error.code.startsWith('ARCA_US_ADULT_')) {
    if(error.code.endsWith('_NOT_FOUND'))status=404;
    else if(error.code==='ARCA_US_ADULT_REFRESH_REQUEST_INVALID')status=400;
    else status=409;
  }
  else if (typeof error.code === 'string' && error.code.startsWith('ARCA_JAV_CORRECTION_')) {
    if(error.code==='ARCA_JAV_CORRECTION_NOT_FOUND')status=404;
    else if(error.code==='ARCA_JAV_CORRECTION_INPUT_INVALID'||error.code==='ARCA_JAV_CORRECTION_PREVIEW_TOO_LARGE')status=400;
    else if(error.code==='ARCA_JAV_CORRECTION_PREVIEW_TIMEOUT')status=504;
    else status=409;
  }
  else if(typeof error.code==='string'&&error.code.startsWith('ARCA_SERIES_')) {
    status=/SUPPLEMENT_INVALID|IMAGE_BOUND|IMAGE_UNDECODABLE|IMAGE_ROLE_INVALID/.test(error.code)?400:409;
  }
  else if (typeof error.code === 'string' && error.code.startsWith('ARCA_RECYCLE_')) {
    if (error.code.endsWith('_NOT_FOUND')) status = 404;
    else if (/(?:_STALE|_CONFLICT|_CHANGED|_EXISTS|_IN_USE|_QUEUED|_OVERLAP)$/.test(error.code)) status = 409;
    else status = 400;
  }
  else if (['PERCEPTION_RATING_COMMAND_INVALID','PERCEPTION_WATCHED_COMMAND_INVALID','PERCEPTION_ACQUISITION_COMMAND_INVALID','PERCEPTION_DOUBAN_NOT_CONFIGURED',
    'PERCEPTION_DIRECT_RATING_NOT_FOUND','PERCEPTION_DIRECT_WATCHED_NOT_FOUND'].includes(error.code)) status = 400;
  else if (['PERCEPTION_RATING_REVISION_CONFLICT','PERCEPTION_WATCHED_REVISION_CONFLICT','PERCEPTION_SOURCE_REVISION_CONFLICT','PERCEPTION_DIRECT_INPUT_IDEMPOTENCY_CONFLICT',
    'PERCEPTION_RESUME_COMMAND_CONFLICT','PERCEPTION_RESUME_BASIS_CONFLICT','P3_COMMAND_IDEMPOTENCY_CONFLICT'].includes(error.code)) status = 409;
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
  else if(error.code==='US_ADULT_RECOMMENDATION_SOURCE_STALE')status=409;
  else if(['PEOPLE_RECOMMENDATION_INPUT_INVALID','PEOPLE_RECOMMENDATION_CLAIM_INVALID'].includes(error.code))status=400;
  else if(['PEOPLE_RECOMMENDATION_NOT_FOUND','PEOPLE_RECOMMENDATION_CLAIM_NOT_FOUND'].includes(error.code))status=404;
  else if(['PEOPLE_RECOMMENDATION_REVISION_CONFLICT','PEOPLE_RECOMMENDATION_WINDOW_CLOSED','PEOPLE_RECOMMENDATION_CLAIM_REVISION_CONFLICT','PEOPLE_RECOMMENDATION_CLAIM_COMMAND_CONFLICT','PEOPLE_RECOMMENDATION_CLAIM_IN_PROGRESS','PEOPLE_US_ACTOR_SNAPSHOT_STALE'].includes(error.code))status=409;
  else if(['PEOPLE_RECOMMENDATION_RECORD_INVALID','PEOPLE_RECOMMENDATION_EVIDENCE_INVALID','PEOPLE_RECOMMENDATION_CLAIM_CORRUPT'].includes(error.code))status=500;
  else if (['PEOPLE_IMAGE_SEARCH_INPUT_INVALID', 'PEOPLE_IMAGE_SELECTION_INVALID', 'PEOPLE_REGISTRATION_INPUT_INVALID', 'PEOPLE_IMAGE_UPLOAD_INVALID', 'PEOPLE_IMAGE_BYTES_INVALID','PEOPLE_PROFILE_INPUT_INVALID'].includes(error.code)) status = 400;
  else if (['PEOPLE_IMAGE_SELECTION_STALE', 'PEOPLE_IMAGE_SOURCE_CHANGED', 'PEOPLE_LIBRARY_READ_ONLY', 'PEOPLE_IMAGE_OPERATION_COMMAND_CONFLICT', 'PEOPLE_IMAGE_OPERATION_STALE','PEOPLE_PROFILE_REVISION_CONFLICT','PEOPLE_LAST_REFERENCE_REQUIRED','PEOPLE_REFERENCE_IMAGE_EXISTS','PEOPLE_REFERENCE_IMAGE_LIMIT','PEOPLE_REFERENCE_PROJECTION_TOO_LARGE','PEOPLE_REFERENCE_LIBRARY_CHANGED'].includes(error.code)) status = 409;
  else if (['PEOPLE_IMAGE_SOURCE_INVALID', 'PEOPLE_IMAGE_SOURCE_UNAVAILABLE'].includes(error.code)) status = 502;
  else if (typeof error.code === 'string' && error.code.startsWith('PEOPLE_')) status = 404;
  else if (error.code === 'ADMIN_ROUTING_MANUAL_STATE_CONFLICT' || error.code === 'ADMIN_ROUTING_MANUAL_HEAD_CONFLICT') status = 409;
  else if (error.code === 'ADMIN_FIELD_COMMAND_REJECTED' || error.code === 'ADMIN_FIELD_TARGET_MISMATCH' ||
    error.code === 'ADMIN_MEDIA_PROFILE_UNSUPPORTED') status = 400;
  else if (error.code === 'ADMIN_FIELD_IDEMPOTENCY_CONFLICT') status = 409;
  else if (error.code === 'ADMIN_FIELD_CONFLICT') status = 409;
  else if(error.code==='US_ADULT_ACTOR_CHOICE_INVALID')status=400;
  else if(['US_ADULT_ACTOR_CHOICE_STALE','US_ADULT_ACTOR_HANDOFF_CONFLICT'].includes(error.code))status=409;
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
    error.code === 'ADMIN_SECONDARY_WORKSHOP_INVALID' ||
    error.code === 'GET_SIDE_EFFECT_INPUT_REJECTED' ||
    error.code === 'ADMIN_SESSION_ISSUE_INVALID'
  ) status = 400;
  else if (error.code === 'HELIX_NOT_READY') status = 503;
  if (error.code?.startsWith('PLATFORM_NETWORK_')) status = error.code.endsWith('_CORRUPT') ? 500 : 400;
  const code = status === 500 ? 'CLEAN_SERVICE_INTERNAL_ERROR' : error.code;
  const message = status === 500 ? 'Clean Service请求处理失败。' : code?.startsWith('RESET_') ? require('./clean-reset-error-copy').resetErrorMessage(code,
    { preflight: context.method === 'GET' && context.path === '/v1/admin/runtime/reset-preview' }) : error.message;
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
  if (routeManifest.status !== 'active' || routeManifest.entries.length !== 168) {
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
    // Historical upgrades apply only to their frozen target. New development
    // requires exact kernel schema admission before any repair may write data.
    if (schemaManifest.ddlDigest === UAT_MIGRATION_TARGET_SCHEMA_DIGEST)
      migrateUatIdentitySelectionSchema({ Database, databasePath, schemaManifest, now: options.now });
    kernel = openSqliteKernel({
      Database,
      databasePath,
      schemaDdl,
      schemaManifest,
      now: options.now,
    });
    repairTerminalResourceDefers({ Database, databasePath, now: options.now });
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
        storageMaintenance: kernel.storageMaintenance,
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
  require('./clean-reset-generation-fence').assertBusinessGenerationOpenAllowed(options.dataDir);
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
  const peopleImagePort = require('./clean-people-image-port').createCleanPeopleImagePort({
    ...constructed.applicationDependencies, locationRegistryRepository, rootPath: path.join(options.dataDir, 'artifacts', 'people'), now: options.now || Date.now,
    afterPhysicalEffect: options.afterPeopleImagePhysicalEffect,afterReclamationPhysicalEffect:options.afterPeopleReferenceReclamationPhysicalEffect,
  });
  const localFaceModel = require('./helix/integrations/local-face-model').createLocalFaceModel({ modelRoot: options.faceModelRoot });
  const peopleReferencePreparation = require('./helix/integrations/people-reference-preparation').createPeopleReferencePreparation({ imagePort: peopleImagePort, faceModel: localFaceModel });
  const durableLibraWorkspaceRoot=locationRegistryRepository.getWorkspaceRoot('service-libra-production-workspace');
  const libraWorkspaceRoot=path.resolve(durableLibraWorkspaceRoot?.resolvedRoot||options.libraWorkspaceRoot||
    path.join(options.dataDir,'workspaces','libra'));
  const localMountScopeResolver = createLocalFilesystemMountScopeResolver({
    repository: locationRegistryRepository,
    inspectRoot: (rootLocation) => localMountProbe.inspectRoot(rootLocation),
    now: options.now || Date.now,
  });
  const durableAftercareWorkspaceRoot = locationRegistryRepository.getWorkspaceRoot('service-arca-aftercare-workspace');
  let aftercareWorkspaceRoot = resolveAftercareWorkspaceRoot({
    explicitRoot: options.aftercareWorkspaceRoot,
    durableRoot: durableAftercareWorkspaceRoot?.resolvedRoot,
    dataDir: options.dataDir,
  });
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
      resolvedRoot:libraWorkspaceRoot },
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
      libraWorkspaceRoot,
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
  try {
    arcaRuleTemplateAdmin.publishSystemRecommendedRevision();
  } catch (error) {
    constructed.close();
    throw error;
  }
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
  let arcaCare = null, arcaRecycle = null, collectionContractValidator=null;
  const posterRenderer = createCleanPosterRenderer();
  const arcaCollectionQuery = createArcaCollectionQuery({
    ...constructed.applicationDependencies,
    contractValidator:{validate(schemaRef,value){
      if(!collectionContractValidator)throw new CleanServiceHostError('CLEAN_SERVICE_NOT_READY','Contract validation is not ready.');
      return collectionContractValidator.validate(schemaRef,value);
    }},
    readAcceptedSubjectOrigin:reference=>{
      const result=productDeliveryPort.readAcceptedRequirements({queryContract:'libra.accepted-product-requirements@1',packages:[reference],includeAcceptedSubjectOrigin:true});
      const item=result.items.find(item=>item.onDeckPackageId===reference.onDeckPackageId);
      if(item?.resultKind!=='found'||!item.acceptedSubjectOrigin)throw Object.assign(new Error('Accepted Subject origin is unavailable.'),{code:'ARCA_JAV_PERCEPTION_CONTINUITY_UNAVAILABLE'});
      return item.acceptedSubjectOrigin;
    },
    posterReader: options.arcaPosterReader || (async (reference, query = {}) => {
      const root = path.resolve(reference.shelfTargetRoot);
      let target = path.resolve(reference.location);
      if(reference.retainedRead&&fs.existsSync(reference.retainedRead.location)) {
        const retained=path.resolve(reference.retainedRead.location);
        if(path.dirname(retained)!==path.dirname(target)||fs.lstatSync(retained).isSymbolicLink())throw new Error('Correction retained poster escaped its exact owned binding.');
        const observed=await require('./helix/integrations/bounded-material-fingerprint').computeBoundedMaterialFingerprint(retained,{requireStableSnapshot:true}),identity=reference.retainedRead.physicalIdentity;
        if(String(observed.stat.ino)!==identity.inode||Number(observed.stat.size)!==identity.sizeBytes||observed.contentFingerprint!==identity.contentFingerprint)
          throw new Error('Correction retained poster no longer matches the current Inventory identity.');
        target=retained;
      }
      if (target !== root && !target.startsWith(root + path.sep)) {
        throw new Error('Shelf Entry poster escaped its Shelf Target.');
      }
      const before = await fs.promises.stat(target);
      if (!before.isFile() || before.size !== reference.sizeBytes || before.size > 16 * 1024 * 1024) {
        throw new Error('Shelf Entry poster violates its bounded Inventory read contract.');
      }
      const originalBytes = await fs.promises.readFile(target);
      const after = await fs.promises.stat(target);
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || originalBytes.length !== before.size) {
        throw new Error('Shelf Entry poster changed during its bounded read.');
      }
      const extension = path.extname(target).toLowerCase();
      const variant = query.size === 'wall' || query.size === 'detail';
      const bytes = await posterRenderer.render(originalBytes, query.size);
      const contentType = variant ? 'image/webp' : extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
      const etag = `"${crypto.createHash('sha256').update(bytes).digest('hex')}"`;
      return Object.freeze({ contentType, bytes, headers: Object.freeze({
        'Cache-Control': query.revision ? 'private, max-age=31536000, immutable' : 'private, max-age=300',
        ETag: etag,
      }) });
    }),
    healthReader:(shelfEntryId)=>arcaCare?.detail(shelfEntryId)?.health||Object.freeze({state:'never_assessed'}),
    healthReaderMany:(shelfEntryIds)=>arcaCare?.summaries(shelfEntryIds)||new Map(),
  });
  const workspaceProductPort = options.workspaceProductPort ||
    createCleanWorkspaceProductPort({
      ...constructed.applicationDependencies,
      rootPath: libraWorkspaceRoot,
      externalLandingResolver: (request) =>
        platformIntegrations.resolveExternalLandingLocation(request),
      now: options.now || Date.now,
      statfsSync: options.workspaceStatfsSync,
      afterPhysicalEffect: options.workspaceAfterPhysicalEffect,
      afterMediaPhysicalEffect: options.workspaceAfterMediaPhysicalEffect,
      afterMediaEffectCommit: options.workspaceAfterMediaEffectCommit,
      afterCleanupPhysicalEffect: options.workspaceAfterCleanupPhysicalEffect,
    });
  const workspaceRootAdmin=createCleanWorkspaceRootAdmin({
    ...constructed.applicationDependencies,locationRegistryRepository,mountScopeResolver:localMountScopeResolver,
    effectiveRootPath:workspaceProductPort.rootPath,statfsSync:options.workspaceStatfsSync,now:options.now||Date.now,
    reservedRoots:()=>{
      let landing=[];
      try{
        const binding=platformIntegrations.admin.get('moviepilot')?.landingBinding;
        landing=binding?[binding.providerRequestSaveRoot,binding.providerOrganizedRoot,binding.shelfDeckVisibleRoot]
          .filter(Boolean).map((resolvedRoot,index)=>({kind:'external-landing',rootId:`moviepilot-landing-${index+1}`,resolvedRoot,revision:1})):[];
      }catch{}
      return [
        {kind:'aftercare-workspace',rootId:'service-arca-aftercare-workspace',resolvedRoot:aftercareWorkspaceRoot,revision:1},
        ...materialFieldStore.listMaterialFields().filter((field)=>field.status==='active').map((field)=>({kind:'material-field',
          rootId:field.fieldId,resolvedRoot:field.access.rootLocation,revision:field.currentAccessRevision||1})),
        ...arcaShelfAdmin.listShelves().items.filter((shelf)=>shelf.status==='active').map((shelf)=>({kind:'shelf-target',
          rootId:shelf.shelfId,resolvedRoot:shelf.target.rootLocation,revision:shelf.target.revision||1})),
        ...landing,
      ];
    },
  });
  workspaceRootAdmin.initialize();
  workspaceProductPort.rootSnapshot();
  const productDeliveryPort = ProductDeliveryPort(createProductDeliveryReader(
    constructed.applicationDependencies,
  ));
  const arcaInventoryPort = options.arcaInventoryPort || createCleanArcaInventoryPort({
    ...constructed.applicationDependencies,
    readSeriesRootBinding:require('./helix/domains/arca/public').createSeriesPresentationQuery(constructed.applicationDependencies).readRootBinding,
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
  const usAdultFrameExtractor=require('./clean-us-adult-frame-extractor').createCleanUsAdultFrameExtractor({
    mediaProbe,ffmpegPath:options.ffmpegPath,ffmpegProcessRegistry});
  const usAdultReferenceCache=new Map();
  function createUsAdultAnalysisPort({context,basis,actorPresentation}){
    const runtimeEffectAuthority=Object.freeze({effectClass:'workspace_write',eventAttemptId:context.eventAttemptId,
      idempotencyKey:context.idempotencyKey,recoveryDecision:context.recoveryDecision});
    const scopedWorkspacePort=Object.freeze({
      materializeArtifact:request=>workspaceProductPort.materializeArtifact({...request,runtimeEffectAuthority}),
      openFrameCompositeSink:request=>workspaceProductPort.openFrameCompositeSink({...request,runtimeEffectAuthority}),
      recoverMaterializedArtifact:request=>workspaceProductPort.recoverMaterializedArtifact({...request,runtimeEffectAuthority}),
      readArtifactBytes:handle=>workspaceProductPort.readArtifactBytes(handle),
    });
    const engine=require('./helix/integrations/us-adult-analysis-engine').createUsAdultAnalysisEngine({context,actorPresentation,
      frameExtractor:usAdultFrameExtractor,faceModel:localFaceModel,referencePort:peopleImagePort,referenceCache:usAdultReferenceCache});
    return require('./clean-western-analysis-port').createCleanWesternAnalysisPort({workspaceProductPort:scopedWorkspacePort,engine,
      configuration:{faceModelRef:basis.faceModelRef,clusterParameters:basis.clusterParameters},now:options.now||Date.now});
  }
  const arcaMediaAcceptanceScratchRoot = path.join(
    path.resolve(options.dataDir), 'runtime', 'arca-acceptance-observation');
  fs.rmSync(arcaMediaAcceptanceScratchRoot, { recursive:true, force:true });
  fs.mkdirSync(arcaMediaAcceptanceScratchRoot, { recursive:true });
  const mediaEffectPort = options.mediaProductionEffectPort ||
    createCleanMediaProductionEffectPort({
      now: options.now || Date.now,
      workspaceProductPort,
      ffmpegPath: options.ffmpegPath,
      ffmpegProcessRegistry,
      mediaProbe,
      acceptanceScratchRoot:arcaMediaAcceptanceScratchRoot,
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
  const libraFieldIntakeAdmissionAdmin = createFieldIntakeAdmissionAdminService({
    ...constructed.applicationDependencies,
    now: options.now || Date.now,
    onSecondaryPolicyChanged(){
      for(const reconcilerKey of ['active-routing-subjects','active-libra-runs','frozen-libra-outcomes'])
        routingExecution?.host.wakeBackground({ownerDomain:'libra',reconcilerKey});
    },
  });
  let formationRatingReader = () => new Map(), formationAcceptanceReader = () => null,
    formationAcceptanceAttention = () => [], formationArcaStatusReader = () => new Map(), formationProjectionHost = null,
    procurementExecution = null, maintenanceWindow = null;
  const formationProjectionStore = createFormationProjectionStore(constructed.applicationDependencies);
  const formationRunHistoryStore = createFormationRunHistoryStore(constructed.applicationDependencies);
  const executionProgressProjectionReader = createExecutionProgressProjectionReader(constructed.applicationDependencies);
  const formationProjectionSource = createFormationProjectionSource({
    ...constructed.applicationDependencies,
    progressProjectionReader: executionProgressProjectionReader,
    readPerceptionRatings: (targets) => formationRatingReader(targets),
    readShelfTargets: () => arcaShelfAdmin.listShelfNames().items,
    isExternalMaterialIntegrationReady: options.externalMaterialIntegrationReadinessReader ||
      (() => platformIntegrations.isActive('moviepilot')),
    readAcceptanceRecoveries: (offerIds) => new Map(offerIds.map((offerId) => [offerId, formationAcceptanceReader(offerId)])),
    readArcaFormationStatuses: (offerIds) => formationArcaStatusReader(offerIds),
    readJavIdentityStage: (libraRunId) => procurementExecution?.libraRunCoordinator.readJavIdentityStage(libraRunId),
  });
  const formationQuery = createFormationQuery({ store: formationProjectionStore, historyStore: formationRunHistoryStore,
    detailSource: formationProjectionSource,
    now: options.now || Date.now,
    readAcceptanceRecovery:(offerId)=>formationAcceptanceReader(offerId),
    readProcessFailures:(scope)=>procurementExecution?.readProcessFailures(scope)||[],
    readPreparationFailure:subjectId=>procurementExecution?.libraPreparationRecovery.readSubject(subjectId)||null,
    readIntakeTasks:()=>procurementExecution?.libraPreparationRecovery.readIntakeTasks()||[],
    listAcceptanceAttention:(limit)=>formationAcceptanceAttention(limit),
    readPipelineSubjectIds:()=>procurementExecution?.pipelineAdmission.tokenSubjectIds() || new Set(),
    state: () => formationProjectionHost?.state() || Object.freeze({ status: 'rebuilding', asOfMs: (options.now || Date.now)() }) });
  const fieldEnumerator = options.fieldObservationEnumerator || createCleanFieldObservationEnumerator({
    now: options.now || Date.now,
    onFingerprintRead: options.onPhysicalMaterialFingerprintRead,
  });
  procurementExecution = createHelixExecutionRuntime({
    captureUsAdultInventorySource:({assertAuthority,...request})=>require('./helix/integrations/us-adult-inventory-source')
      .createUsAdultInventorySource({assertAuthority,now:options.now||Date.now}).issueReadHandle(request),
    createUsAdultInventoryAnalysisPort:request=>require('./clean-us-adult-inventory-analysis-port').createCleanUsAdultInventoryAnalysisPort({
      ...request,aftercareWorkspaceRoot,frameExtractor:usAdultFrameExtractor,faceModel:localFaceModel,referencePort:peopleImagePort,
      referenceCache:usAdultReferenceCache,mediaProbe,now:options.now||Date.now}),
    createUsAdultAnalysisPort,
    createUsAdultRecommendationImagePort:sourceQuery=>require('./clean-us-adult-recommendation-image-port').createCleanUsAdultRecommendationImagePort({
      sourceQuery,workspaceProductPort,
    }),
    peopleImagePort, peopleReferencePreparation,
    readSelectedPersonImage: token => platformIntegrations.readSelectedPersonImage(token),
    afterRegistrationCommit: options.afterPeopleRegistrationCommit,
    afterRecommendationSourceConfirmation:options.afterRecommendationSourceConfirmation,
    onRecommendationClaimFailure:options.onRecommendationClaimFailure,
    onHistoricalCatalogRejected: options.onHistoricalCatalogRejected,
    recycleTick:()=>arcaRecycle?.tick(),
    recycleExpiryTick:()=>arcaRecycle?.expire(),
    maintenanceWindowKey:()=>maintenanceWindow?.snapshot().windowEndAtMs || null,
    maintenanceBatchAllowed:()=>Boolean(maintenanceWindow?.allows('maintenance')),
    executionEligibilityProvider:{check:scope=>!maintenanceWindow||maintenanceWindow.allows(workCategory(scope,
      acquisitionId=>procurementExecution.perception.acquisitionSchedulingClass(acquisitionId)))},
    reconcileEligibilityProvider:{check:scope=>!maintenanceWindow||maintenanceWindow.allows(reconcilerCategory(scope))},
    onReconcileScopeStarted:scope=>maintenanceWindow?.beginScope(maintenanceTaskTitle(scope)),
    onExecutionScopeStarted:scope=>maintenanceWindow?.beginScope(maintenanceExecutionTitle(scope)),
    onCorrectionCleanupCompleted:()=>executionRuntimeHost.wakeBackground({ownerDomain:'arca',reconcilerKey:'recycle-maintenance'}),
    failureEvidenceStore:createFailureEvidenceStore(path.join(options.dataDir, 'diagnostics', 'execution-failures')),
    ...constructed.applicationDependencies,
    now: options.now || Date.now,
    materialFieldStore,
    validateCancellationExclusions:request=>createMaterialExclusionCommandPort({materialFieldStore}).validateSourceExclusions(request),
    applyCancellationExclusions:request=>createMaterialExclusionCommandPort({materialFieldStore}).excludeSourceMaterials(request),
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
    observeJavSource: options.javSourceObservation || platformIntegrations.observeJavSource,
    acquireJavCover:options.javCorrectionCoverAcquisition||platformIntegrations.acquireJavCorrectionCover,
    observeJavSourceForPreview:options.javSourcePreview||platformIntegrations.previewJavSource,
    resolveJavSourceHandle: options.javSourceHandleResolver || platformIntegrations.resolveJavSourceHandle,
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
    onContractValidatorReady:validator=>{collectionContractValidator=validator;},
    targetProjectionReader: options.perceptionTargetProjectionReader || ((targetType, targetId) => {
      if (targetType === 'shelf_entry') return arcaCollectionQuery.targetProjection(targetId);
      if (targetType !== 'subject') return null;
      return routingExecution?.routingContextReader.ratingTarget(targetId)||null;
    }),
    workspaceProductPort,
    productProductionPort,
    observeEpisodeMetadataCandidates: options.observeEpisodeMetadataCandidates || platformIntegrations.observeEpisodeMetadataCandidates,
    mediaEffectPort,
    ffmpegProcessRegistry,
    progressProjectionReader: executionProgressProjectionReader,
    platformComputeRuntime,
    readFailureRecoveryConditions:options.readFailureRecoveryConditions || (kinds=>kinds.map(kind=>kind==='media_compute'
      ?Object.freeze({conditionKind:kind,snapshotDigest:computeRecoveryDigest(platformComputeRuntime)})
      :platformIntegrations.readRecoveryCondition(kind))),
    productDeliveryPort,
    inventoryPort: arcaInventoryPort,
    createSeriesRootRelocationIo:()=>require('./clean-series-root-relocation-port').createCleanSeriesRootRelocationPort({afterRename:options.afterSeriesRootRename}),
    offdeckDeletionPort: options.offdeckDeletionPort || createCleanOffdeckDeletionPort({
      afterPhysicalEffect: options.afterOffdeckPhysicalEffect,
    }),
    resolveSeriesImageSource:options.seriesImageSourceResolver||platformIntegrations.resolveSeriesImageSource,
    afterSeriesPhysicalEffect:options.afterSeriesPhysicalEffect,
    fetchSeriesPresentationMetadata:options.fetchSeriesPresentationMetadata||platformIntegrations.fetchSeriesPresentationMetadata,
    fetchSeriesPresentationArtifact: options.fetchSeriesPresentationArtifact || platformIntegrations.fetchSeriesPresentationArtifact,
    fetchAftercareArtifact: options.aftercareArtifactFetch || options.productProviderArtifactFetch ||
      platformIntegrations.fetchProviderArtifact,
    aftercarePlaybackRunner:options.aftercarePlaybackRunner,
    resolveAftercareIntegrationHandle: options.aftercareIntegrationHandleResolver ||
      options.currentProductIntegrationHandleResolver || ((request) =>
        platformIntegrations.resolveCurrentProductHandle({
          providerKind: request.providerKind || request.intent?.providerKind,
          ...(request.intent?.javSelectedSource?{javSelectedSource:request.intent.javSelectedSource}:{}),
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
    shutdownTimeoutMs:options.shutdownTimeoutMs,
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
    pipelineAdmission: procurementExecution.pipelineAdmission,
    onPipelineSeatReleased: () => {
      procurementExecution.intakeCoordinator.reconcilePending({ admissionLimit:3 });
      procurementExecution.host.wake();
    },
  });
  const failedPreparationRetryWorkRuntime = createSynchronousDomainWork(
    constructed.applicationDependencies,
  );
  const failedPreparationRetryService = createFailedPreparationRetryAdminService({
    ...constructed.applicationDependencies,
    triageRegistry: createDefaultTriageRuleRegistry(),
    workRuntime: failedPreparationRetryWorkRuntime,
  });
  const outboxDispatcherFactory = options.outboxDispatcherFactory || createOutboxDispatcherHost;
  const outboxDispatcher = outboxDispatcherFactory({
    ...constructed.applicationDependencies,
    now: options.now || Date.now,
    intakeCoordinator: procurementExecution.intakeCoordinator,
    readPublishedRuleTemplate: (templateId, revision) => arcaRuleTemplateAdmin.readPublishedRevision(templateId, revision),
    acceptanceConsumer: candidateAcceptance,
    rejectionConsumer: candidateRejection,
    failedPreparationRetryService,
    procurementAutomation: procurementExecution.procurementAutomation,
    routingCoordinator: procurementExecution.routingCoordinator,
    perceptionCoordinator: procurementExecution.perception,
    peopleCoordinator: procurementExecution.people,
    arcaCoordinator: procurementExecution.arcaCoordinator,
    handoffBOutcomeConsumer,
    wakeWorkspaceReclaimer: () => procurementExecution.wakeWorkspaceReclaimer(),
    deferredDeliveryKeys: options.deferredDeliveryKeys || [],
    executionRuntimeHost: procurementExecution.host,
    onError: options.onExecutionRuntimeError,
  });
  let runtimeOperations;
  let transportClosing=false;
  const refreshStoppedViews=async()=>{await formationProjectionHost.refreshQuiesced();await overviewQuery.refreshQuiesced();};
  const executionRuntimeHost = Object.freeze({
    async start() {
      if(runtimeOperations.shouldStartStopped()){
        const execution=await procurementExecution.host.start({quiesced:true});await refreshStoppedViews();await runtimeOperations.started();await maintenanceWindow.start();return execution;
      }
      await outboxDispatcher.recoverCommittedRetryIntents();
      const execution = await procurementExecution.host.start();
      try {
        await outboxDispatcher.start();
        await formationProjectionHost.start();
        void overviewQuery.start().catch(error=>options.onExecutionRuntimeError?.(error));
        runtimeOperations.started();
        await maintenanceWindow.start();
        return execution;
      } catch (error) {
        await outboxDispatcher.stop().catch(() => {});
        await procurementExecution.host.stop().catch(() => {});
        throw error;
      }
    },
    wake() { const execution=procurementExecution.host.wake(); outboxDispatcher.wake(); formationProjectionHost.wake(); return execution; },
    wakeBackground(request){return procurementExecution.host.wakeBackground(request);},
    async quiesce() {
      const execution=procurementExecution.host.quiesce();
      await Promise.all([execution,ffmpegProcessRegistry.quiesce?.(),formationProjectionHost.stop(),overviewQuery.stop(),outboxDispatcher.stop(),runtimeOperations.waitForBusinessCommands()]);
      if(!transportClosing)await refreshStoppedViews();
    },
    async resume() {
      ffmpegProcessRegistry.resume?.();
      await outboxDispatcher.recoverCommittedRetryIntents();
      try {
        await procurementExecution.host.start();await outboxDispatcher.start();await formationProjectionHost.start();
        void overviewQuery.start().catch(error=>options.onExecutionRuntimeError?.(error));
      }catch(error){
        const state=procurementExecution.host.readiness().state;
        if(['ready','draining','faulted'].includes(state))await procurementExecution.host.quiesce();
        await Promise.all([formationProjectionHost.stop(),overviewQuery.stop(),outboxDispatcher.stop()]);throw error;
      }
    },
    async stop() {
      // Stop dispatch synchronously before waiting for observers or child processes.
      const executionStop=procurementExecution.host.stop();
      try {
        // Interrupt owned media processes after dispatch stops, before awaiting
        // their Event promises. Waiting first makes long encodes consume the
        // entire shutdown budget and prevents their durable recovery checkpoint.
        const [result]=await Promise.all([executionStop,ffmpegProcessRegistry.close(),mediaEffectPort.close?.(),
          formationProjectionHost.stop(),overviewQuery.stop(),outboxDispatcher.stop(),maintenanceWindow.stop()]);
        return result;
      } finally {
        await ffmpegProcessRegistry.close();
        await mediaEffectPort.close?.();
      }
    },
  });
  arcaCare=createArcaCareApplication({contextReader:procurementExecution.arcaAftercareContextReader,
    coordinator:procurementExecution.arcaAftercareCoordinator,wake:()=>executionRuntimeHost.wake()});
  arcaRecycle=createRecycleApplication({
    root:path.join(options.dataDir,'recycle'),now:options.now||Date.now,
    cleanupStore:createSourceCleanupStore(constructed.applicationDependencies),
    directoryStore:procurementExecution.arcaJavCorrection.directoryStore,
    prepareCorrectionDirectory:correctionId=>procurementExecution.arcaJavCorrection.directoryPreparation.prepare(correctionId,
      [...materialFieldStore.listMaterialFields().map(field=>field.access.rootLocation),...(options.externalProviderScanRoots||[])]),
    store:createRecycleStore({...constructed.applicationDependencies,now:options.now||Date.now}),
    port:recycleFiles.createRecycleEffectPort(constructed.applicationDependencies),files:recycleFiles,
    wake:()=>{executionRuntimeHost.wake();executionRuntimeHost.wakeBackground({ownerDomain:'arca',reconcilerKey:'recycle-maintenance'});},
    readScope(shelfEntryId,purpose='recycle'){
      const store=procurementExecution.arcaAftercareContextReader.store,c=store.currentContext(shelfEntryId);
      if(!c)return null;
      if(c.correctionGate)throw Object.assign(new Error('Identity correction is still holding this Entry.'),{code:'ARCA_JAV_CORRECTION_BUSY'});
      const protection=store.recycleProtection();
      const additionalRoots=[...materialFieldStore.listMaterialFields().map(field=>field.access.rootLocation),...(options.externalProviderScanRoots||[])],
        correction=procurementExecution.arcaJavCorrection,scopes=purpose==='on_deck_cleanup'?[]:correction.directoryStore.forEntry(shelfEntryId).map(row=>correction.directoryPreparation.prepare(row.correction_id,additionalRoots)),
        directories=[...new Set([...c.oldBindings.filter(row=>row.role?.startsWith('offload:')&&path.isAbsolute(row.location)).map(row=>path.dirname(row.location)),...scopes.flatMap(scope=>scope.directories.map(row=>row.sourceLocation))])];
      if(directories.length>32)throw Object.assign(new Error('Entry directory scope exceeds its explicit budget.'),{code:'ARCA_RECYCLE_SCOPE_TOO_LARGE'});
      return {...protection,onDeckRunId:c.onDeckCommit?.on_deck_run_id,knownSourceDirectories:directories,
        scanRoots:[...protection.scanRoots,...materialFieldStore.listMaterialFields().map(field=>field.access.rootLocation),...(options.externalProviderScanRoots||[])]};
    },
  });
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
    readArcaFormationStatus:offerIds=>formationArcaStatusReader(offerIds),
    validateCancellationExclusions:request=>createMaterialExclusionCommandPort({materialFieldStore}).validateSourceExclusions(request),
    applyCancellationExclusions:request=>createMaterialExclusionCommandPort({materialFieldStore}).excludeSourceMaterials(request),
    cancelProcessWorks: procurementExecution.cancelProcessWorks,
    libraRunExecutionProjection: procurementExecution.libraRunExecutionProjection,
    pipelineAdmission: procurementExecution.pipelineAdmission,
    onPipelineSeatReleased: () => {
      procurementExecution.intakeCoordinator.reconcilePending({ admissionLimit:3 });
    },
    wake: () => executionRuntimeHost.wake(),
    now: options.now || Date.now,
  });
  const libraRunAdmin = Object.freeze({
    abandonSubject(subjectId,body){const result=libraRunAdminService.abandonSubject(subjectId,body);formationProjectionHost.enqueue(subjectId);return result;},
    readOutcome:libraRunAdminService.readOutcome,
    reprocessSourceFieldIds:libraRunAdminService.reprocessSourceFieldIds,
    requestReprocess:libraRunAdminService.requestReprocess,
    readAutomaticAuthorization: () => libraRunAdminService.readAutomaticAuthorization(),
    setAutomaticAuthorization: body => libraRunAdminService.setAutomaticAuthorization(body),
    expedite(libraRunId, body) { const result=libraRunAdminService.expedite(libraRunId,body); formationProjectionHost.enqueue(formationProjectionSource.findSubjectByRun(libraRunId)); return result; },
    cancelExpedite(libraRunId, body) { const result=libraRunAdminService.cancelExpedite(libraRunId,body); formationProjectionHost.enqueue(formationProjectionSource.findSubjectByRun(libraRunId)); return result; },
    discard(libraRunId, body) { const result=libraRunAdminService.discard(libraRunId,body); formationProjectionHost.enqueue(formationProjectionSource.findSubjectByRun(libraRunId)); return result; },
    previewDefects(libraRunId) { return libraRunAdminService.previewDefects(libraRunId); },
    admitWithDefects(libraRunId, body) {
      const result=libraRunAdminService.admitWithDefects(libraRunId,body);
      formationProjectionHost.enqueue(formationProjectionSource.findSubjectByRun(libraRunId));
      procurementExecution.libraRunCoordinator.reconcile(libraRunId);
      executionRuntimeHost.wake();
      return result;
    },
  });
  const productIdentitySelection = Object.freeze({
    preview(libraRunId, tmdbMovieId) { return procurementExecution.productIdentitySelection.preview(libraRunId, tmdbMovieId); },
    choose(libraRunId, body, actor) {
      const result = procurementExecution.productIdentitySelection.choose(libraRunId, body, actor);
      formationProjectionHost.enqueue(formationProjectionSource.findSubjectByRun(libraRunId));
      procurementExecution.libraRunCoordinator.reconcile(libraRunId);
      executionRuntimeHost.wake();
      return result;
    },
  });
  const arcaAcceptanceRecovery = Object.freeze({
    async retry(offerId,body) { const result=await procurementExecution.arcaCoordinator.retryAcceptanceWithSupplements(offerId,body);
      executionRuntimeHost.wake(); return result; },
  });
  const usAdultActorChoice=Object.freeze({choose(libraRunId,body,actorId){
    const result=procurementExecution.usAdultActorChoice.choose(libraRunId,body,actorId);
    formationProjectionHost.enqueue(formationProjectionSource.findSubjectByRun(libraRunId));
    executionRuntimeHost.wake();return result;
  }});
  const perceptionAdmin = Object.freeze({
    createRecord(body) { const result=procurementExecution.perception.createRecord(body); if(body?.targetType==='subject')formationProjectionHost.enqueue(body.targetId); executionRuntimeHost.wake(); return result; },
    listRecords(query) { const result=procurementExecution.perception.listRecords(query);
      if(!query?.targetType||!query?.targetId)return result;
      return Object.freeze({...result,currentRating:procurementExecution.perception.readCurrentRating(query.targetType,query.targetId),
        currentWatched:procurementExecution.perception.readCurrentWatched(query.targetType,query.targetId)}); },
    listAcquisitions() { return procurementExecution.perception.listAcquisitions(); },
    requestAcquisition(body,actor) { const result=procurementExecution.perception.requestAcquisition(body,{actorId:actor?.credentialId||'admin'}); executionRuntimeHost.wake(); return result; },
    syncState() { return procurementExecution.perception.syncState(); },
  });
  const fieldAccessProbe = createCleanFieldAccessBindingProbe();
  const procurementAdmin = createProcurementAdminApplication({
    ...constructed.applicationDependencies,
    materialFieldStore,
    executionRuntimeHost,
    workRuntime: failedPreparationRetryWorkRuntime,
    failedPreparationRetryService,
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
    readReferenceAvatar: input => peopleImagePort.readReferenceImage(input),
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
  const overviewQuery = createOverviewProjectionHost({
    onError: options.onExecutionRuntimeError,
    readMaterialFields: () => procurementAdmin.overviewStats(),
    readShelves: () => arcaShelfAdmin.overviewStats(),
    readStandingAuthorization: () => inputSettlementAuthorizationStore.current(),
    readFormation: () => formationQuery.overview(),
    readCollectionStats: (nowMs) => arcaCollectionQuery.overviewStats(nowMs),
    readOffdeck: () => arcaOffdeck.overviewStats(),
    readPeopleSummary: () => peopleAdminQuery.summary(),
    readBackgroundOperations: () => procurementExecution.host.backgroundOperations(),
    readHealth: () => ({ kind: procurementExecution.host.readiness().state }),
    now: options.now || Date.now,
  });
  const peopleAdmin = Object.freeze({
    recommendations:()=>procurementExecution.people.recommendationQuery.current(),
    recommendationImage:id=>procurementExecution.people.recommendationQuery.image(id),
    claimRecommendation:(id,body,actor)=>procurementExecution.people.recommendationClaims.begin(id,body,actor?.credentialId||'admin'),
    recommendationClaim:id=>procurementExecution.people.recommendationClaims.get(id),
    searchImages: name => platformIntegrations.searchPeopleImages(name),
    previewImage: token => platformIntegrations.readSelectedPersonImage(token),
    register(body, actor) {
      return procurementExecution.people.registerPerson(body, actor?.credentialId || 'admin');
    },
    imageOperation: operationId => procurementExecution.people.imageOperations.get(operationId),
    updateProfile:(personId,body,actor)=>procurementExecution.people.updateProfile(personId,body,actor?.credentialId||'admin'),
    addReference:(personId,body,actor)=>procurementExecution.people.addReference(personId,body,actor?.credentialId||'admin'),
    releaseReference:(personId,assetId,body,actor)=>procurementExecution.people.releaseReference(personId,assetId,body,actor?.credentialId||'admin'),
    accept(body, actor) {
      return procurementExecution.people.acceptRegistration(body, actor?.credentialId || 'admin');
    },
    dismiss(body, actor) {
      return procurementExecution.people.dismissRegistration(body, actor?.credentialId || 'admin');
    },
  });
  const userReset=(options.createFormationResetPort || (()=>{
    const unavailable=()=>{throw Object.assign(new Error('重置管理进程尚未配置，请先完成作业配置。'),{code:'RESET_SUPERVISOR_REQUIRED',statusCode:409});};
    return {preview:unavailable,apply:unavailable,recover:unavailable};
  }))({dataDir:options.dataDir,workspaceRoot:libraWorkspaceRoot,
    readRuntime:()=>runtimeOperations.snapshot(),
    captureResetManagementCredential:runtime.captureResetManagementCredential,
    assertWorkspaceAvailable(){const root=locationRegistryRepository.getWorkspaceRoot('service-libra-production-workspace');
      const activity=procurementExecution.host.activity();
      if(activity.state!=='quiesced'||activity.inFlightEvents||activity.inFlightPlanning||activity.inFlightRecoveries||activity.inFlightOwnerReconciliations||ffmpegProcessRegistry.size())
        throw Object.assign(new Error('执行器尚未停止，暂不能重置工作台。'),{code:'RESET_EXECUTION_NOT_DRAINED'});
      if(!root)throw Object.assign(new Error('生产工作区未注册。'),{code:'RESET_WORKSPACE_UNAVAILABLE'});
      localMountScopeResolver.validateReference({endpointId:root.endpointId,rootLocation:root.resolvedRoot,
        mountScopeId:root.mountScopeId,mountScopeRevision:root.mountScopeRevision});
      fs.accessSync(libraWorkspaceRoot,fs.constants.R_OK|fs.constants.W_OK);
      return Object.freeze({allFileWritersStopped:true,runtimeRevision:runtimeOperations.snapshot().revision});
    }});
  runtimeOperations=createRuntimeOperations({dataDir:options.dataDir,
    initialOperation:options.runtimeInitialOperation,
    onOperationSettled:options.onRuntimeOperationSettled,
    onDesiredModeChanged:()=>maintenanceWindow?.tick(),
    normalSupplyAllowed:()=>maintenanceWindow?.normalSupplyAllowed()!==false,
    readMaintenance:()=>maintenanceWindow?.snapshot() || null,
    activity:()=>procurementExecution.host.activity(),quiesce:()=>executionRuntimeHost.quiesce(),resume:()=>executionRuntimeHost.resume(),
    previewReset:()=>userReset.preview(),reset:async(preview,beforeApply)=>{
      const result=await userReset.apply(preview,beforeApply);
      if(!transportClosing){for(const runId of result.retiredRunIds||[])procurementExecution.libraRunExecutionProjection.invalidate(runId);
        await refreshStoppedViews();}return result;
    },recoverReset:async(resetId)=>{
      const result=await userReset.recover(resetId);
      if(!transportClosing){for(const runId of result.retiredRunIds||[])procurementExecution.libraRunExecutionProjection.invalidate(runId);
        await refreshStoppedViews();}return result;
    },onError:options.onExecutionRuntimeError});
  maintenanceWindow=createMaintenanceWindow({dataDir:options.dataDir,now:options.now||Date.now,
    desiredMode:()=>runtimeOperations.desiredMode(),
    setAdmission:()=>procurementExecution.host.wake(),
    isDrained:()=>{const activity=runtimeOperations.snapshot().activity;
      return !activity.inFlightEvents&&!activity.inFlightPlanning&&!activity.inFlightRecoveries&&!activity.inFlightOwnerReconciliations&&
        !activity.deferredRecoveryActions&&!activity.inFlightAdminCommands;},
    onError:options.onExecutionRuntimeError,
  });
  const facades = createCleanFacades({
    runtimeOperations,
    maintenanceWindow,
    sessionTokens,
    readiness,
    credentialMetadata: runtime.readActiveCredential,
    overviewQuery,
    setupReadinessQuery,
    peopleAdminQuery,
    peopleAvatarQuery,
    peopleAdmin,
    procurementAdmin,
    libraPreparationRecovery:{list:procurementExecution.libraPreparationRecovery.list,retry(workId){const result=procurementExecution.libraPreparationRecovery.retry(workId);executionRuntimeHost.wake();return result;}},
    arcaShelfAdmin,
    arcaRuleTemplateAdmin,
    libraRoutingAdmin,
    libraFieldIntakeAdmissionAdmin,
    formationQuery,
    arcaCollectionQuery,
    arcaUsAdultActorRefresh:procurementExecution.arcaUsAdultActorRefresh,
    arcaJavCorrectionAdmin:{list:query=>procurementExecution.arcaJavCorrection.workQuery.list(query),preview:procurementExecution.arcaJavCorrection.admin.preview,status:procurementExecution.arcaJavCorrection.admin.status,
      latest:shelfEntryId=>procurementExecution.arcaJavCorrection.admin.latest(shelfEntryId),
      cancel(...args){const result=procurementExecution.arcaJavCorrection.admin.cancel(...args);executionRuntimeHost.wake();return result;},
      async recover(...args){const result=await procurementExecution.arcaJavCorrection.admin.recover(...args);executionRuntimeHost.wake();return result;},
      confirm(...args){const result=procurementExecution.arcaJavCorrection.admin.confirm(...args);executionRuntimeHost.wake();return result;}},
    arcaCare,
    arcaDefectAdmission:procurementExecution.arcaDefectAdmission,
    arcaRecycle,
    arcaOffdeck,
    routingManualSelection,
    libraRunAdmin,
    productIdentitySelection,
    usAdultActorChoice,
    episodeMetadataMappingService: procurementExecution.episodeMetadataMapping,
    usAdultActorSelectionQuery:procurementExecution.usAdultActorSelectionQuery,
    arcaAcceptanceRecovery,
    platformIntegrationAdmin: platformIntegrations.admin,
    workspaceRootAdmin,
    perceptionAdmin,
    nonce: crypto.randomUUID,
  });
  const application = createHelixApplication({
    facades,
    sessionTokens,
    executionRuntimeHost,
    runtimeOperations,
  });

  const server = Fastify({ logger: false, trustProxy: false });
  await registerAdminStatic(server, options.adminDistDir);
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
      ...(route.method === 'POST' && (route.path === '/v1/admin/people'||route.path === '/v1/admin/people/:personId/reference-assets'||
        route.path==='/v1/admin/people/recommendations/:recommendationId/actions/claim') ? { bodyLimit: 14 * 1024 * 1024 } : ['/v1/admin/formation/acceptance/:offerId/actions/retry','/v1/admin/care/:shelfEntryId/actions/check'].includes(route.path)?{bodyLimit:24*1024*1024}:{}),
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
          response = errorResponse(error, correlationId, { method: request.method, path: request.url.split('?')[0] });
        }
        if (response.sessionToken) reply.header('set-cookie', sessionCookie(response.sessionToken));
        if (response.clearSession) reply.header('set-cookie', clearSessionCookie());
        if (response.contentType) reply.type(response.contentType);
        if (response.headers) {
          for (const [name, value] of Object.entries(response.headers)) reply.header(name, value);
        }
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

  let closingPromise = null;
  let resetGenerationId = null;
  let resetRuntimeRevision = null;
  function closeGeneration(waitForOperation) {
    if (closingPromise) return closingPromise;
    transportClosing = true;
    closingPromise = (async () => {
      await Promise.all([application.stop(), ...(waitForOperation
        ? [runtimeOperations.waitForShutdown(options.shutdownTimeoutMs || 60000)] : [])]);
      // Fastify must finish every authenticated read as well as business writes
      // before its shared Kernel is closed. Old ports keep the closed Kernel;
      // they must never be rebound to the next database generation.
      await server.close();
      try {
        await platformIntegrations.close();
        peopleReferencePreparation.clearCache();
        await localFaceModel.close();
      } finally {
        constructed.close();
      }
    })();
    return closingPromise;
  }
  return Object.freeze({
    generation: application.generation,
    routeCount: application.routeCount,
    readiness: () => application.readiness(),
    inject: (request) => server.inject(request),
    listen: (address) => server.listen(address),
    // Operator-only transport lifecycle port; this is not an Admin HTTP action.
    // A reset cannot await its own pending Runtime operation while closing the
    // business generation. Its durable receipt is finalized outside that DB.
    async closeDatabaseGeneration({ generationId, expectedRuntimeRevision }) {
      if (!/^[a-f0-9]{64}$/.test(generationId) || !Number.isSafeInteger(expectedRuntimeRevision))
        throw Object.assign(new Error('Invalid stopped-generation fence.'), { code: 'RESET_HOST_FENCE_INVALID' });
      if (resetGenerationId === generationId && closingPromise) {
        if (resetRuntimeRevision !== expectedRuntimeRevision)
          throw Object.assign(new Error('Stopped-generation replay changed its runtime fence.'), { code: 'RESET_HOST_FENCE_INVALID' });
        await closingPromise;
        return Object.freeze({ generationId, allBusinessConnectionsClosed: true });
      }
      const state = runtimeOperations.snapshot(), activity = state.activity;
      if (closingPromise || state.desiredMode !== 'stopped' || !['stopped', 'resetting'].includes(state.mode) ||
          state.revision !== expectedRuntimeRevision || activity.state !== 'quiesced' ||
          activity.inFlightEvents || activity.inFlightPlanning || activity.inFlightRecoveries ||
          activity.inFlightOwnerReconciliations || activity.inFlightAdminCommands || ffmpegProcessRegistry.size())
        throw Object.assign(new Error('Reset requires the exact drained runtime generation.'), { code: 'RESET_HOST_NOT_DRAINED' });
      resetGenerationId = generationId;
      resetRuntimeRevision = expectedRuntimeRevision;
      await closeGeneration(false);
      return Object.freeze({ generationId, allBusinessConnectionsClosed: true });
    },
    close: () => closeGeneration(true),
  });
}

module.exports = Object.freeze({
  CleanServiceHostError,
  SESSION_COOKIE,
  createCleanServiceHost,
  createIntegrationSecretStore,
  createPlatformIntegrationServices,
  resolveAftercareWorkspaceRoot,
  assertAftercareWorkspaceRootAvailable,
  normalizePerceptionSourceId,
  inspectCleanRuntimeReadiness,
});
