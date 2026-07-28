'use strict';

const { canonicalDigest, canonicalJson } =
  require('../../contracts/canonical-json');
const {
  CONFIG_SCHEMA_REF,
  TMDB_INTEGRATION_ID,
  TMDB_SECRET_REF,
} = require('./integration-runtime');

const SUPPORTED_KIND = 'tmdb';
const RECEIPT_KIND_CONFIGURE = 'configure';
const RECEIPT_KIND_DISCONNECT = 'disconnect';

class IntegrationAdminError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'IntegrationAdminError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new IntegrationAdminError(code, message, details);
}

function exact(value, required, optional, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(code, 'Integration command must be a JSON object.');
  }
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (required.some((key) => !Object.hasOwn(value, key)) ||
      keys.some((key) => !allowed.has(key))) {
    fail(code, 'Integration command must match the exact closed shape.');
  }
}

function idempotencyKey(value) {
  if (typeof value !== 'string' || value.length < 1 ||
      value.length > 256 ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value)) {
    fail(
      'PLATFORM_INTEGRATION_COMMAND_INVALID',
      'Integration idempotency key is invalid.',
    );
  }
  return value;
}

function expectedRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(
      'PLATFORM_INTEGRATION_COMMAND_INVALID',
      'Integration expected revision is invalid.',
    );
  }
  return value;
}

function kind(value) {
  if (typeof value !== 'string' || !value ||
      value.length > 64) {
    fail(
      'PLATFORM_INTEGRATION_KIND_INVALID',
      'Integration kind is invalid.',
    );
  }
  return value;
}

function assertSupported(value) {
  if (kind(value) !== SUPPORTED_KIND) {
    fail(
      'PLATFORM_INTEGRATION_KIND_UNSUPPORTED',
      'This H1.1 runtime supports TMDB only.',
      { kind: value },
    );
  }
}

function publicSnapshot(snapshot) {
  if (!snapshot?.integration) {
    return Object.freeze({
      kind: SUPPORTED_KIND,
      supported: true,
      configured: false,
      state: 'unconfigured',
      configRevision: 0,
      endpoint: null,
      configDigest: null,
      capabilityCodes: Object.freeze(['identity', 'metadata']),
      lastTestSummary: null,
    });
  }
  const value = snapshot.integration;
  return Object.freeze({
    kind: SUPPORTED_KIND,
    supported: true,
    configured: value.state === 'active',
    state: value.state,
    configRevision: value.configRevision,
    endpoint: value.endpoint,
    configDigest: value.configDigest,
    capabilityCodes: Object.freeze([
      ...value.config.capabilityCodes,
    ]),
    lastTestSummary: value.config.lastTestSummary
      ? Object.freeze({ ...value.config.lastTestSummary })
      : null,
  });
}

function createIntegrationAdminApplication(options) {
  if (!options?.repository ||
      typeof options.repository.find !== 'function' ||
      typeof options.repository.commit !== 'function' ||
      !options?.secretStore ||
      typeof options.secretStore.write !== 'function' ||
      typeof options.secretStore.requestDigest !== 'function' ||
      !options?.tmdbAdapter ||
      typeof options.tmdbAdapter.testCandidate !== 'function') {
    throw new TypeError(
      'Integration Admin requires Platform Repository, Secret Store, and TMDB adapter.',
    );
  }
  const now = options.now || Date.now;
  const tests = new Map();

  function current() {
    return options.repository.find(
      TMDB_INTEGRATION_ID,
      TMDB_SECRET_REF,
    );
  }

  function requestDigest(value) {
    return options.secretStore.requestDigest(canonicalJson(value));
  }

  function replay(snapshot, key, digest) {
    const receipt = snapshot?.integration?.config?.lastCommand;
    if (!receipt || receipt.idempotencyKey !== key) return undefined;
    if (receipt.requestDigest !== digest) {
      fail(
        'PLATFORM_INTEGRATION_IDEMPOTENCY_CONFLICT',
        'Integration idempotency key was used for another request.',
      );
    }
    return Object.freeze({
      ...publicSnapshot(snapshot),
      replayed: true,
    });
  }

  async function test(inputKind, body) {
    assertSupported(inputKind);
    exact(
      body,
      ['kind', 'idempotencyKey', 'endpoint', 'credential'],
      ['timeoutMs'],
      'PLATFORM_INTEGRATION_TEST_SHAPE',
    );
    if (body.kind !== inputKind) {
      fail(
        'PLATFORM_INTEGRATION_TARGET_MISMATCH',
        'URL and body Integration kinds differ.',
      );
    }
    idempotencyKey(body.idempotencyKey);
    exact(
      body.credential,
      ['kind', 'value'],
      [],
      'PLATFORM_INTEGRATION_CREDENTIAL_SHAPE',
    );
    const secretKind = body.credential.kind === 'api_key'
      ? 'tmdb_api_key'
      : body.credential.kind === 'access_token'
        ? 'tmdb_access_token'
        : null;
    if (!secretKind || typeof body.credential.value !== 'string' ||
        body.credential.value.length < 8 ||
        body.credential.value.length > 4096) {
      fail(
        'PLATFORM_INTEGRATION_CREDENTIAL_INVALID',
        'TMDB credential is invalid.',
      );
    }
    const digest = requestDigest({
      kind: body.kind,
      idempotencyKey: body.idempotencyKey,
      endpoint: body.endpoint,
      credentialKind: body.credential.kind,
      credentialValue: body.credential.value,
      timeoutMs: body.timeoutMs ?? 10_000,
    });
    const prior = tests.get(body.idempotencyKey);
    if (prior) {
      if (prior.requestDigest !== digest) {
        fail(
          'PLATFORM_INTEGRATION_IDEMPOTENCY_CONFLICT',
          'Integration test idempotency key was reused.',
        );
      }
      return Object.freeze({ ...prior.result, replayed: true });
    }
    const secretBytes = Buffer.from(body.credential.value, 'utf8');
    try {
      const summary = await options.tmdbAdapter.testCandidate({
        endpoint: body.endpoint,
        secretKind,
        secretBytes,
        timeoutMs: body.timeoutMs ?? 10_000,
      });
      const result = Object.freeze({
        kind: SUPPORTED_KIND,
        result: 'passed',
        persisted: false,
        capabilityCodes: summary.capabilityCodes,
        endpointDigest: summary.endpointDigest,
        identityNamespace: summary.identityNamespace,
        identityProviderKey: summary.identityProviderKey,
        observationDigest: summary.observationDigest,
        checkedAtMs: summary.checkedAtMs,
        replayed: false,
      });
      tests.set(
        body.idempotencyKey,
        Object.freeze({ requestDigest: digest, result }),
      );
      return result;
    } finally {
      secretBytes.fill(0);
    }
  }

  async function configure(inputKind, body) {
    assertSupported(inputKind);
    exact(
      body,
      [
        'kind',
        'idempotencyKey',
        'expectedConfigRevision',
        'endpoint',
        'credential',
      ],
      ['timeoutMs'],
      'PLATFORM_INTEGRATION_CONFIGURE_SHAPE',
    );
    if (body.kind !== inputKind) {
      fail(
        'PLATFORM_INTEGRATION_TARGET_MISMATCH',
        'URL and body Integration kinds differ.',
      );
    }
    const key = idempotencyKey(body.idempotencyKey);
    const expected = expectedRevision(body.expectedConfigRevision);
    exact(
      body.credential,
      ['kind', 'value'],
      [],
      'PLATFORM_INTEGRATION_CREDENTIAL_SHAPE',
    );
    const secretKind = body.credential.kind === 'api_key'
      ? 'tmdb_api_key'
      : body.credential.kind === 'access_token'
        ? 'tmdb_access_token'
        : null;
    if (!secretKind || typeof body.credential.value !== 'string' ||
        body.credential.value.length < 8 ||
        body.credential.value.length > 4096) {
      fail(
        'PLATFORM_INTEGRATION_CREDENTIAL_INVALID',
        'TMDB credential is invalid.',
      );
    }
    const normalizedEndpoint =
      options.tmdbAdapter.normalizedEndpoint(body.endpoint);
    const digest = requestDigest({
      command: RECEIPT_KIND_CONFIGURE,
      kind: body.kind,
      idempotencyKey: key,
      expectedConfigRevision: expected,
      endpoint: normalizedEndpoint,
      credentialKind: body.credential.kind,
      credentialValue: body.credential.value,
      timeoutMs: body.timeoutMs ?? 10_000,
    });
    const before = current();
    const prior = replay(before, key, digest);
    if (prior) return prior;
    const actualRevision = before.integration?.configRevision || 0;
    if (actualRevision !== expected) {
      fail(
        'PLATFORM_INTEGRATION_CAS_CONFLICT',
        'Integration configuration revision changed.',
        { expectedRevision: expected, actualRevision },
      );
    }

    const secretBytes = Buffer.from(body.credential.value, 'utf8');
    let locator;
    try {
      const summary = await options.tmdbAdapter.testCandidate({
        endpoint: normalizedEndpoint,
        secretKind,
        secretBytes,
        timeoutMs: body.timeoutMs ?? 10_000,
      });
      const revision = expected + 1;
      const committedAtMs = now();
      locator = options.secretStore.write({
        integrationId: TMDB_INTEGRATION_ID,
        secretRef: TMDB_SECRET_REF,
        secretKind,
        revision,
        secretBytes,
        createdAtMs: committedAtMs,
      });
      const lastTestSummary = {
        result: 'passed',
        checkedAtMs: summary.checkedAtMs,
        endpointDigest: summary.endpointDigest,
        observationDigest: summary.observationDigest,
        identityNamespace: summary.identityNamespace,
        identityProviderKey: summary.identityProviderKey,
      };
      const config = {
        schemaRef: CONFIG_SCHEMA_REF,
        schemaVersion: 1,
        kind: SUPPORTED_KIND,
        credentialKind: body.credential.kind,
        capabilityCodes: ['identity', 'metadata'],
        lastTestSummary,
        lastCommand: {
          commandKind: RECEIPT_KIND_CONFIGURE,
          idempotencyKey: key,
          requestDigest: digest,
          committedRevision: revision,
        },
      };
      const configJson = canonicalJson(config);
      if (Buffer.byteLength(configJson, 'utf8') > 16 * 1024) {
        fail(
          'PLATFORM_INTEGRATION_CONFIG_TOO_LARGE',
          'Integration configuration exceeds its table contract.',
        );
      }
      const committed = options.repository.commit({
        expectedRevision: expected,
        integration: {
          integration_id: TMDB_INTEGRATION_ID,
          integration_type: SUPPORTED_KIND,
          endpoint: normalizedEndpoint,
          config_revision: revision,
          config_schema_ref: CONFIG_SCHEMA_REF,
          config_json: configJson,
          config_digest: canonicalDigest(config),
          state: 'active',
          updated_at_ms: committedAtMs,
        },
        secret: {
          secret_ref: TMDB_SECRET_REF,
          owner_scope_type: 'integration',
          owner_scope_id: TMDB_INTEGRATION_ID,
          secret_kind: secretKind,
          encrypted_ref: locator,
          revision,
          state: 'active',
          updated_at_ms: committedAtMs,
        },
      });
      const oldLocator = before.secret?.secretLocator;
      if (oldLocator && oldLocator !== locator) {
        try {
          options.secretStore.remove(oldLocator);
        } catch (_ignored) {
          // The superseded locator is no longer reachable from an active
          // Secret Reference. Physical cleanup is best-effort post-commit.
        }
      }
      return Object.freeze({
        ...publicSnapshot(committed),
        replayed: false,
      });
    } catch (error) {
      if (locator) {
        try {
          options.secretStore.remove(locator);
        } catch (_ignored) {
          // The authoritative configuration error remains unchanged.
        }
      }
      throw error;
    } finally {
      secretBytes.fill(0);
    }
  }

  function disconnect(inputKind, body) {
    assertSupported(inputKind);
    exact(
      body,
      ['kind', 'idempotencyKey', 'expectedConfigRevision'],
      [],
      'PLATFORM_INTEGRATION_DISCONNECT_SHAPE',
    );
    if (body.kind !== inputKind) {
      fail(
        'PLATFORM_INTEGRATION_TARGET_MISMATCH',
        'URL and body Integration kinds differ.',
      );
    }
    const key = idempotencyKey(body.idempotencyKey);
    const expected = expectedRevision(body.expectedConfigRevision);
    const digest = requestDigest({
      command: RECEIPT_KIND_DISCONNECT,
      kind: body.kind,
      idempotencyKey: key,
      expectedConfigRevision: expected,
    });
    const before = current();
    const prior = replay(before, key, digest);
    if (prior) return prior;
    if (!before.integration) {
      if (expected !== 0) {
        fail(
          'PLATFORM_INTEGRATION_CAS_CONFLICT',
          'Integration configuration revision changed.',
          { expectedRevision: expected, actualRevision: 0 },
        );
      }
      return Object.freeze({
        ...publicSnapshot(before),
        replayed: true,
      });
    }
    if (before.integration.configRevision !== expected) {
      fail(
        'PLATFORM_INTEGRATION_CAS_CONFLICT',
        'Integration configuration revision changed.',
        {
          expectedRevision: expected,
          actualRevision: before.integration.configRevision,
        },
      );
    }
    if (before.integration.state === 'disabled') {
      return Object.freeze({
        ...publicSnapshot(before),
        replayed: true,
      });
    }
    const revision = expected + 1;
    const committedAtMs = now();
    const config = {
      ...before.integration.config,
      lastCommand: {
        commandKind: RECEIPT_KIND_DISCONNECT,
        idempotencyKey: key,
        requestDigest: digest,
        committedRevision: revision,
      },
    };
    const committed = options.repository.commit({
      expectedRevision: expected,
      integration: {
        integration_id: TMDB_INTEGRATION_ID,
        integration_type: SUPPORTED_KIND,
        endpoint: before.integration.endpoint,
        config_revision: revision,
        config_schema_ref: CONFIG_SCHEMA_REF,
        config_json: canonicalJson(config),
        config_digest: canonicalDigest(config),
        state: 'disabled',
        updated_at_ms: committedAtMs,
      },
      secret: {
        secret_ref: TMDB_SECRET_REF,
        owner_scope_type: 'integration',
        owner_scope_id: TMDB_INTEGRATION_ID,
        secret_kind: before.secret.secretKind,
        encrypted_ref: before.secret.secretLocator,
        revision,
        state: 'revoked',
        updated_at_ms: committedAtMs,
      },
    });
    try {
      options.secretStore.remove(before.secret.secretLocator);
    } catch (_ignored) {
      // Revocation is authoritative in the Owner transaction. The opaque
      // envelope is unreachable even if post-commit deletion is interrupted.
    }
    return Object.freeze({
      ...publicSnapshot(committed),
      replayed: false,
    });
  }

  return Object.freeze({
    configure,
    disconnect,
    get(inputKind) {
      if (inputKind !== SUPPORTED_KIND) {
        return Object.freeze({
          kind: kind(inputKind),
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
      return publicSnapshot(current());
    },
    test,
  });
}

module.exports = Object.freeze({
  IntegrationAdminError,
  createIntegrationAdminApplication,
});
