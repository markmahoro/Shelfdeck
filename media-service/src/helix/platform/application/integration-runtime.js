'use strict';

const { canonicalDigest, canonicalJson } =
  require('../../contracts/canonical-json');
const { createSecretLeaseBroker } = require('./secret-lease-broker');

const TMDB_INTEGRATION_ID = 'tmdb-main';
const TMDB_SECRET_REF = 'integration-secret:tmdb-main';
const CONFIG_SCHEMA_REF =
  'helix://implementation-contracts/platform-integrations/tmdb/v1';
const OFFICIAL_TMDB_ENDPOINT = 'https://api.themoviedb.org/3';
const SHA256 = /^[0-9a-f]{64}$/;
const SECRET_LOCATOR =
  /^integration-envelope:[0-9a-f-]{36}:([0-9a-f]{64})$/;
const HANDLE_OPERATIONS = new Set([
  'shared.integration.search@1',
  'libra.product_metadata.fetch@1',
  'libra.product_artifact.acquire@1',
]);

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

function validateTestSummary(value) {
  exact(
    value,
    [
      'result',
      'checkedAtMs',
      'endpointDigest',
      'observationDigest',
      'identityNamespace',
      'identityProviderKey',
    ],
    'PLATFORM_INTEGRATION_CONFIG_CORRUPT',
  );
  if (value.result !== 'passed' ||
      !Number.isSafeInteger(value.checkedAtMs) ||
      value.checkedAtMs < 0 ||
      !SHA256.test(value.endpointDigest || '') ||
      value.endpointDigest !== canonicalDigest({
        endpoint: OFFICIAL_TMDB_ENDPOINT,
      }) ||
      !SHA256.test(value.observationDigest || '') ||
      value.identityNamespace !== 'tmdb_movie' ||
      typeof value.identityProviderKey !== 'string' ||
      value.identityProviderKey.length > 64 ||
      !/^[0-9]+$/.test(value.identityProviderKey)) {
    fail(
      'PLATFORM_INTEGRATION_CONFIG_CORRUPT',
      'Integration test summary is invalid.',
    );
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
  if (!['configure', 'disconnect'].includes(value.commandKind) ||
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

function validateConfig(snapshot) {
  const integration = snapshot?.integration;
  const secret = snapshot?.secret;
  if (!integration) {
    fail(
      'PLATFORM_INTEGRATION_NOT_CONFIGURED',
      'Integration is not configured.',
    );
  }
  const config = integration.config;
  exact(
    config,
    [
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
    ],
    'PLATFORM_INTEGRATION_CONFIG_CORRUPT',
  );
  const locatorMatch = SECRET_LOCATOR.exec(
    secret?.secretLocator || '',
  );
  if (integration.integrationId !== TMDB_INTEGRATION_ID ||
      integration.integrationType !== 'tmdb' ||
      integration.configSchemaRef !== CONFIG_SCHEMA_REF ||
      integration.endpoint !== OFFICIAL_TMDB_ENDPOINT ||
      integration.configDigest !== canonicalDigest(config) ||
      !Number.isSafeInteger(integration.configRevision) ||
      integration.configRevision < 1 ||
      !Number.isSafeInteger(integration.updatedAtMs) ||
      integration.updatedAtMs < 0 ||
      !['active', 'disabled'].includes(integration.state) ||
      config.schemaRef !== CONFIG_SCHEMA_REF ||
      config.schemaVersion !== 1 ||
      config.kind !== 'tmdb' ||
      config.endpoint !== OFFICIAL_TMDB_ENDPOINT ||
      config.configRevision !== integration.configRevision ||
      config.secretRef !== TMDB_SECRET_REF ||
      !SHA256.test(config.secretEnvelopeDigest || '') ||
      !['api_key', 'access_token'].includes(
        config.credentialKind,
      ) ||
      JSON.stringify(config.capabilityCodes) !==
        JSON.stringify(['identity', 'metadata']) ||
      !secret ||
      secret.secretRef !== TMDB_SECRET_REF ||
      secret.ownerScopeType !== 'integration' ||
      secret.ownerScopeId !== TMDB_INTEGRATION_ID ||
      !['tmdb_api_key', 'tmdb_access_token'].includes(
        secret.secretKind,
      ) ||
      secret.revision !== integration.configRevision ||
      !locatorMatch ||
      locatorMatch[1] !== config.secretEnvelopeDigest) {
    fail(
      'PLATFORM_INTEGRATION_CONFIG_CORRUPT',
      'Integration configuration identity or digest is invalid.',
    );
  }
  validateTestSummary(config.lastTestSummary);
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
  const now = options.now || Date.now;
  const broker = createSecretLeaseBroker({
    repository: Object.freeze({
      find: (secretRef) => options.repository.findSecret(secretRef),
    }),
    secretSource: options.secretStore,
    purposePolicy: Object.freeze({
      allows(value) {
        return value.ownerScopeType === 'integration' &&
          value.ownerScopeId === TMDB_INTEGRATION_ID &&
          ['tmdb_api_key', 'tmdb_access_token'].includes(
            value.secretKind,
          ) &&
          HANDLE_OPERATIONS.has(value.purpose);
      },
    }),
    now,
    createId: options.createId,
    digest: options.digest,
  });

  const integrationQueryPort = Object.freeze({
    query(input) {
      exact(
        input,
        ['integrationId', 'expectedConfigRevision'],
        'PLATFORM_INTEGRATION_QUERY_SHAPE',
      );
      if (input.integrationId !== TMDB_INTEGRATION_ID ||
          !Number.isSafeInteger(input.expectedConfigRevision) ||
          input.expectedConfigRevision < 1) {
        fail(
          'PLATFORM_INTEGRATION_QUERY_INVALID',
          'Integration query identity or revision is invalid.',
        );
      }
      const snapshot = validateConfig(options.repository.find(
        TMDB_INTEGRATION_ID,
        TMDB_SECRET_REF,
      ));
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
        secretRef: snapshot.secret?.secretRef || null,
        secretKind: snapshot.secret?.secretKind || null,
        secretRevision: snapshot.secret?.revision || null,
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
      if (input.integrationId !== TMDB_INTEGRATION_ID ||
          input.integrationType !== 'tmdb' ||
          !Number.isSafeInteger(input.configRevision) ||
          input.configRevision < 1 ||
          !HANDLE_OPERATIONS.has(input.allowedOperation) ||
          (input.allowedOperation ===
            'libra.product_artifact.acquire@1'
            ? !['poster', 'fanart'].includes(input.artifactKind)
            : input.artifactKind !== null)) {
        fail(
          'PLATFORM_INTEGRATION_HANDLE_INVALID',
          'Integration Handle request is invalid.',
        );
      }
      const snapshot = validateConfig(options.repository.find(
        input.integrationId,
        TMDB_SECRET_REF,
      ));
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

  function readCurrent() {
    const raw = options.repository.find(
      TMDB_INTEGRATION_ID,
      TMDB_SECRET_REF,
    );
    if (!raw.integration) return undefined;
    return validateConfig(raw);
  }

  return Object.freeze({
    broker,
    integrationHandleResolverPort,
    integrationQueryPort,
    isTmdbActive() {
      const snapshot = readCurrent();
      return snapshot?.integration.state === 'active';
    },
    readCurrent,
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
