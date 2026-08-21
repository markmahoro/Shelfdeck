'use strict';

const { canonicalDigest } =
  require('../../contracts/canonical-json');
const { createSecretLeaseBroker } = require('./secret-lease-broker');
const {
  SHA256,
  requireIntegrationProfile,
  validateSummary,
} = require('./integration-profile-catalog');
const {
  assertBinding: assertMoviePilotLandingBinding,
} = require('./moviepilot-landing-binding');

const TMDB_PROFILE = requireIntegrationProfile('tmdb');
const TMDB_INTEGRATION_ID = TMDB_PROFILE.integrationId;
const TMDB_SECRET_REF = TMDB_PROFILE.secretRef;
const CONFIG_SCHEMA_REF = TMDB_PROFILE.configSchemaRef;
const OFFICIAL_TMDB_ENDPOINT =
  TMDB_PROFILE.normalizeEndpoint('https://api.themoviedb.org/3');
const HANDLE_OPERATIONS = new Set(TMDB_PROFILE.allowedOperations);
const SECRET_LOCATOR =
  /^integration-envelope:[0-9a-f-]{36}:([0-9a-f]{64})$/;

class IntegrationRuntimeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'IntegrationRuntimeError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new IntegrationRuntimeError(code, message, details);
}

function exact(value, fields, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !==
        JSON.stringify([...fields].sort())) {
    fail(code, 'Integration runtime input must match the exact shape.');
  }
}

function validateLastCommand(value, revision) {
  exact(
    value,
    [
      'commandKind',
      'idempotencyKey',
      'requestDigest',
      'committedRevision',
    ],
    'PLATFORM_INTEGRATION_CONFIG_CORRUPT',
  );
  if (!['configure', 'settings_update', 'disconnect'].includes(value.commandKind) ||
      typeof value.idempotencyKey !== 'string' ||
      value.idempotencyKey.length < 1 ||
      value.idempotencyKey.length > 256 ||
      !SHA256.test(value.requestDigest || '') ||
      value.committedRevision !== revision) {
    fail(
      'PLATFORM_INTEGRATION_CONFIG_CORRUPT',
      'Integration command continuity is invalid.',
    );
  }
}

function validateConfig(snapshot, selectedProfile = TMDB_PROFILE) {
  const integration = snapshot?.integration;
  const secret = snapshot?.secret;
  if (!integration) {
    fail(
      'PLATFORM_INTEGRATION_NOT_CONFIGURED',
      'Integration is not configured.',
    );
  }
  const profile = selectedProfile;
  const config = integration.config;
  const configFields = [
    'schemaRef',
    'schemaVersion',
    'kind',
    'endpoint',
    'configRevision',
    'secretRef',
    'secretEnvelopeDigest',
    'credentialKind',
    'capabilityCodes',
    'lastTestSummary',
    'lastCommand',
    'landingBinding',
  ];
  if (Object.hasOwn(config, 'settings')) configFields.push('settings');
  exact(
    config,
    configFields,
    'PLATFORM_INTEGRATION_CONFIG_CORRUPT',
  );
  let endpoint;
  try {
    endpoint = profile.normalizeEndpoint(integration.endpoint);
  } catch (_error) {
    fail(
      'PLATFORM_INTEGRATION_CONFIG_CORRUPT',
      'Persisted Integration endpoint is invalid.',
    );
  }
  const locatorMatch = SECRET_LOCATOR.exec(
    secret?.secretLocator || '',
  );
  if (integration.integrationId !== profile.integrationId ||
      integration.integrationType !== profile.integrationType ||
      integration.configSchemaRef !== profile.configSchemaRef ||
      integration.endpoint !== endpoint ||
      integration.configDigest !== canonicalDigest(config) ||
      !Number.isSafeInteger(integration.configRevision) ||
      integration.configRevision < 1 ||
      !Number.isSafeInteger(integration.updatedAtMs) ||
      integration.updatedAtMs < 0 ||
      !['active', 'disabled'].includes(integration.state) ||
      config.schemaRef !== profile.configSchemaRef ||
      config.schemaVersion !== 1 ||
      config.kind !== profile.kind ||
      config.endpoint !== endpoint ||
      config.configRevision !== integration.configRevision ||
      config.secretRef !== profile.secretRef ||
      !SHA256.test(config.secretEnvelopeDigest || '') ||
      config.credentialKind !==
        profile.credentialKindsBySecret[secret?.secretKind] ||
      JSON.stringify(config.capabilityCodes) !==
        JSON.stringify(profile.capabilityCodes) ||
      (profile.kind === 'moviepilot'
        ? !config.landingBinding
        : config.landingBinding !== null) ||
      !secret ||
      secret.secretRef !== profile.secretRef ||
      secret.ownerScopeType !== 'integration' ||
      secret.ownerScopeId !== profile.integrationId ||
      !profile.acceptedSecretKinds.includes(secret.secretKind) ||
      secret.revision !== integration.configRevision ||
      !locatorMatch ||
      locatorMatch[1] !== config.secretEnvelopeDigest) {
    fail(
      'PLATFORM_INTEGRATION_CONFIG_CORRUPT',
      'Integration configuration identity or digest is invalid.',
    );
  }
  validateSummary(profile, config.lastTestSummary);
  if (typeof profile.normalizeSettings === 'function') {
    profile.normalizeSettings(config.settings);
  }
  if (profile.kind === 'moviepilot') {
    assertMoviePilotLandingBinding(config.landingBinding);
  }
  if (config.lastTestSummary.endpointDigest !==
      canonicalDigest({ endpoint })) {
    fail(
      'PLATFORM_INTEGRATION_CONFIG_CORRUPT',
      'Integration test summary endpoint fence is invalid.',
    );
  }
  validateLastCommand(
    config.lastCommand,
    integration.configRevision,
  );
  if (integration.state === 'active') {
    if (secret.state !== 'active') {
      fail(
        'PLATFORM_INTEGRATION_SECRET_FENCE_MISMATCH',
        'Integration and Secret Reference are inconsistent.',
      );
    }
  } else if (secret.state !== 'revoked') {
    fail(
      'PLATFORM_INTEGRATION_SECRET_FENCE_MISMATCH',
      'Disabled Integration must have one revoked Secret Reference.',
    );
  }
  return Object.freeze({ integration, secret });
}

function createIntegrationRuntime(options) {
  if (!options?.repository ||
      typeof options.repository.find !== 'function' ||
      typeof options.repository.findSecret !== 'function' ||
      !options?.secretStore ||
      typeof options.secretStore.read !== 'function' ||
      typeof options.createId !== 'function' ||
      typeof options.digest !== 'function') {
    throw new TypeError(
      'Integration runtime requires Platform Repository and Secret Store.',
    );
  }
  const profile = options.profile || TMDB_PROFILE;
  const landingAccessAdapter = options.landingAccessAdapter;
  if (profile.kind === 'moviepilot' &&
      (!landingAccessAdapter ||
       typeof landingAccessAdapter.resolve !== 'function' ||
       typeof landingAccessAdapter.assertRootDoesNotOverlap !== 'function')) {
    throw new TypeError(
      'MoviePilot Integration runtime requires an External Landing access adapter.',
    );
  }
  const operationSet = new Set(profile.allowedOperations);
  const now = options.now || Date.now;
  const broker = createSecretLeaseBroker({
    repository: Object.freeze({
      find: (secretRef) => options.repository.findSecret(secretRef),
    }),
    secretSource: options.secretStore,
    purposePolicy: Object.freeze({
      allows(value) {
        return value.ownerScopeType === 'integration' &&
          value.ownerScopeId === profile.integrationId &&
          profile.acceptedSecretKinds.includes(value.secretKind) &&
          operationSet.has(value.purpose);
      },
    }),
    now,
    createId: options.createId,
    digest: options.digest,
  });

  function readCurrent() {
    const raw = options.repository.find(
      profile.integrationId,
      profile.secretRef,
    );
    if (!raw.integration) return undefined;
    return validateConfig(raw, profile);
  }

  const integrationQueryPort = Object.freeze({
    query(input) {
      exact(
        input,
        ['integrationId', 'expectedConfigRevision'],
        'PLATFORM_INTEGRATION_QUERY_SHAPE',
      );
      if (input.integrationId !== profile.integrationId ||
          !Number.isSafeInteger(input.expectedConfigRevision) ||
          input.expectedConfigRevision < 1) {
        fail(
          'PLATFORM_INTEGRATION_QUERY_INVALID',
          'Integration query identity or revision is invalid.',
        );
      }
      const snapshot = readCurrent();
      if (snapshot.integration.configRevision !==
          input.expectedConfigRevision) {
        fail(
          'PLATFORM_INTEGRATION_REVISION_MISMATCH',
          'Integration query revision is stale.',
        );
      }
      return Object.freeze({
        schemaRef:
          'helix://contracts/ports/platform.integration.query/v1/output',
        schemaVersion: 1,
        integrationId: snapshot.integration.integrationId,
        integrationType: snapshot.integration.integrationType,
        endpoint: snapshot.integration.endpoint,
        configRevision: snapshot.integration.configRevision,
        configDigest: snapshot.integration.configDigest,
        state: snapshot.integration.state,
        secretRef: snapshot.secret.secretRef,
        secretKind: snapshot.secret.secretKind,
        secretRevision: snapshot.secret.revision,
        ...(typeof profile.normalizeSettings === 'function'
          ? { settings: profile.normalizeSettings(
              snapshot.integration.config.settings,
            ) }
          : {}),
      });
    },
  });

  const integrationHandleResolverPort = Object.freeze({
    resolve(input) {
      exact(
        input,
        [
          'integrationId',
          'integrationType',
          'configRevision',
          'allowedOperation',
          'artifactKind',
        ],
        'PLATFORM_INTEGRATION_HANDLE_SHAPE',
      );
      if (input.integrationId !== profile.integrationId ||
          input.integrationType !== profile.integrationType ||
          !Number.isSafeInteger(input.configRevision) ||
          input.configRevision < 1 ||
          !operationSet.has(input.allowedOperation) ||
          (input.allowedOperation.endsWith(
            'artifact.acquire@1',
          )
            ? !profile.artifactKinds.includes(input.artifactKind)
            : input.artifactKind !== null)) {
        fail(
          'PLATFORM_INTEGRATION_HANDLE_INVALID',
          'Integration Handle request is invalid.',
        );
      }
      const snapshot = readCurrent();
      if (snapshot.integration.state !== 'active') {
        fail(
          'PLATFORM_INTEGRATION_UNAVAILABLE',
          'Integration is not active.',
        );
      }
      if (snapshot.integration.configRevision !== input.configRevision) {
        fail(
          'PLATFORM_INTEGRATION_REVISION_MISMATCH',
          'Integration Handle revision is stale.',
        );
      }
      const basis = {
        schemaRef: 'helix://contracts/types/IntegrationHandle/v1',
        schemaVersion: 1,
        handleId: canonicalDigest({
          schema: 'platform.integration-handle-id@1',
          integrationId: input.integrationId,
          configRevision: input.configRevision,
          allowedOperation: input.allowedOperation,
          artifactKind: input.artifactKind,
        }),
        integrationId: input.integrationId,
        integrationType: input.integrationType,
        configRevision: input.configRevision,
        secretRef: snapshot.secret.secretRef,
        allowedOperation: input.allowedOperation,
        expiresAtMs: 4_102_444_800_000,
      };
      return Object.freeze({
        ...basis,
        fenceDigest: canonicalDigest({
          schema: 'platform.integration-handle-fence@1',
          ...basis,
        }),
      });
    },
  });

  const secretLeaseResolverPort = Object.freeze({
    resolve(input) {
      return broker.issue(input);
    },
  });

  function isActive() {
    const snapshot = readCurrent();
    return snapshot?.integration.state === 'active';
  }

  function resolveExternalLandingLocation(input) {
    exact(
      input,
      [
        'integrationId',
        'configRevision',
        'bindingId',
        'bindingRevision',
        'bindingDigest',
        'endpointId',
        'mountScopeId',
        'mountScopeRevision',
        'location',
      ],
      'PLATFORM_EXTERNAL_LANDING_RESOLVE_SHAPE',
    );
    if (profile.kind !== 'moviepilot') {
      fail('PLATFORM_EXTERNAL_LANDING_UNSUPPORTED',
        'This Integration does not publish an External Landing binding.');
    }
    const snapshot = readCurrent();
    const binding = snapshot.integration.config.landingBinding;
    if (snapshot.integration.state !== 'active' ||
        input.integrationId !== snapshot.integration.integrationId ||
        input.configRevision !== snapshot.integration.configRevision ||
        input.bindingId !== binding.bindingId ||
        input.bindingRevision !== binding.bindingRevision ||
        input.bindingDigest !== binding.bindingDigest ||
        input.endpointId !== binding.endpointId ||
        input.mountScopeId !== binding.mountScopeId ||
        input.mountScopeRevision !== binding.mountScopeRevision) {
      fail('PLATFORM_EXTERNAL_LANDING_FENCE_STALE',
        'External Landing binding is stale.');
    }
    return Object.freeze({
      absolutePath: landingAccessAdapter.resolve(binding, input.location),
      endpointId: binding.endpointId,
      mountScopeId: binding.mountScopeId,
      mountScopeRevision: binding.mountScopeRevision,
      bindingDigest: binding.bindingDigest,
      accessMode: binding.accessMode,
    });
  }

  function assertExternalLandingRootAvailable(request) {
    exact(
      request,
      ['requestedRoot'],
      'PLATFORM_EXTERNAL_LANDING_RESERVATION_SHAPE',
    );
    if (profile.kind !== 'moviepilot') return Object.freeze({ available:true });
    const snapshot = readCurrent();
    if (!snapshot || snapshot.integration.state !== 'active') {
      return Object.freeze({ available:true });
    }
    landingAccessAdapter.assertRootDoesNotOverlap(
      snapshot.integration.config.landingBinding,
      request.requestedRoot,
    );
    return Object.freeze({ available:true });
  }

  return Object.freeze({
    broker,
    integrationHandleResolverPort,
    integrationQueryPort,
    isActive,
    isTmdbActive() {
      return profile.kind === 'tmdb' &&
        isActive();
    },
    profile,
    readCurrent,
    assertExternalLandingRootAvailable,
    resolveExternalLandingLocation,
    secretLeaseResolverPort,
  });
}

module.exports = Object.freeze({
  CONFIG_SCHEMA_REF,
  HANDLE_OPERATIONS,
  IntegrationRuntimeError,
  OFFICIAL_TMDB_ENDPOINT,
  TMDB_INTEGRATION_ID,
  TMDB_SECRET_REF,
  createIntegrationRuntime,
  validateConfig,
});
