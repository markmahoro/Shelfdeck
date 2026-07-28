'use strict';

const {
  canonicalDigest,
  canonicalJson,
} = require('../contracts/canonical-json');
const {
  validateProductIntegrationHandle,
} = require('../platform/public/integration-adapter-support');
const {
  fetchBytes,
  fetchJson,
} = require('./h1-provider-adapters');
const {
  createThePornDbRestClient,
  normalizeThePornDbJavCode,
} = require('./theporndb-rest-client');

const IMAGE_LIMIT = 16 * 1024 * 1024;
const APPROVED_ARTIFACT_HOSTS = new Set([
  'cdn.theporndb.net',
  'thumb.theporndb.net',
]);

class JavProductProviderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'JavProductProviderError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new JavProductProviderError(code, message, details);
}

function resolvedIdentity(code) {
  const basis = {
    provider: 'jav',
    namespace: 'jav_code',
    providerKey: code,
    seasonNumber: null,
  };
  return Object.freeze({
    ...basis,
    identityAnchorDigest: canonicalDigest(basis),
  });
}

function exactIdentity(actual, expected) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail(
      'P5_PROVIDER_IDENTITY_MISMATCH',
      'JAV Provider identity does not match the exact request.',
    );
  }
}

function safeArtifactUrl(value) {
  let target;
  try {
    target = new URL(value);
  } catch (_error) {
    fail(
      'P5_PROVIDER_RESPONSE_INVALID',
      'JAV Provider artifact URL is invalid.',
    );
  }
  const hostname = target.hostname
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .toLowerCase();
  if (target.protocol !== 'https:' ||
      target.username ||
      target.password ||
      (target.port && target.port !== '443') ||
      !APPROVED_ARTIFACT_HOSTS.has(hostname)) {
    fail(
      'P5_PROVIDER_RESPONSE_INVALID',
      'JAV Provider artifact URL is outside the approved host boundary.',
    );
  }
  return target.toString();
}

function createJavProductProviderAdapter(options) {
  if (!options?.runtime ||
      typeof options.runtime.readCurrent !== 'function' ||
      !options.runtime.broker ||
      typeof options.runtime.broker.issue !== 'function' ||
      typeof options.runtime.broker.consumeAsync !== 'function' ||
      typeof (options.fetchImpl || globalThis.fetch) !== 'function') {
    throw new TypeError(
      'JAV Product Provider requires runtime, Secret Lease, and fetch.',
    );
  }
  const runtime = options.runtime;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now || Date.now;

  function current() {
    const snapshot = runtime.readCurrent();
    if (!snapshot ||
        snapshot.integration.state !== 'active' ||
        snapshot.integration.integrationType !== 'adult-provider') {
      fail(
        'PLATFORM_INTEGRATION_NOT_CONFIGURED',
        'Adult Provider integration is not active.',
      );
    }
    return snapshot;
  }

  async function withSecret(operationId, timeoutMs, consumer) {
    const snapshot = current();
    const endpoint = runtime.profile.normalizeEndpoint(
      snapshot.integration.endpoint,
    );
    const lease = runtime.broker.issue({
      secretRef: snapshot.secret.secretRef,
      ownerScopeType: 'integration',
      ownerScopeId: snapshot.integration.integrationId,
      secretKind: snapshot.secret.secretKind,
      expectedRevision: snapshot.secret.revision,
      purpose: operationId,
      ttlMs: Math.min(timeoutMs, 60_000),
    });
    return runtime.broker.consumeAsync(lease, (secretBytes) =>
      consumer({ endpoint, secretBytes, snapshot }));
  }

  function restClient(value, timeoutMs) {
    return createThePornDbRestClient({
      fetchImpl,
      fetchJson,
      endpoint: value.endpoint,
      authorization: 'Bearer ' + value.secretBytes.toString('utf8'),
      timeoutMs,
      fail,
    });
  }

  async function searchScene(code, operationId, timeoutMs) {
    return withSecret(operationId, timeoutMs, async (value) => {
      return Object.freeze({
        scene: await restClient(value, timeoutMs)
          .searchExactJav(code),
        snapshot: value.snapshot,
      });
    });
  }

  async function readScene(code, operationId, timeoutMs) {
    return withSecret(operationId, timeoutMs, async (value) => {
      return Object.freeze({
        scene: await restClient(value, timeoutMs)
          .readExactJav(code),
        snapshot: value.snapshot,
      });
    });
  }

  function validateProductHandle(handle, operationId, artifactKind) {
    const snapshot = current();
    const valid = validateProductIntegrationHandle(
      handle,
      {
        integrationId: snapshot.integration.integrationId,
        integrationType: 'jav',
        configRevision: snapshot.integration.configRevision,
        secretRef: snapshot.secret.secretRef,
        allowedOperation: operationId,
        artifactKind,
      },
      now(),
    );
    if (!valid ||
        (artifactKind !== null &&
          !['poster', 'fanart'].includes(artifactKind))) {
      fail(
        'P5_PROVIDER_HANDLE_DENIED',
        'JAV Product Integration Handle is stale or invalid.',
      );
    }
    return snapshot;
  }

  return Object.freeze({
    async searchProviderIdentity(request) {
      if (!request ||
          request.operationId !== 'shared.integration.search@1' ||
          request.contentProfile !== 'jav') {
        fail(
          'P5_PROVIDER_INPUT_INVALID',
          'JAV identity search input is invalid.',
        );
      }
      const code = normalizeThePornDbJavCode(request.javCode, fail);
      const found = await searchScene(
        code,
        'shared.integration.search@1',
        10_000,
      );
      return Object.freeze({
        provider: 'jav',
        namespace: 'jav_code',
        providerKey: found.scene.sku,
        integrationId: found.snapshot.integration.integrationId,
        configRevision: found.snapshot.integration.configRevision,
      });
    },

    async fetchProviderMetadata(request) {
      const intent = request?.metadataFetchIntent;
      const handle = request?.integrationHandle;
      validateProductHandle(
        handle,
        'libra.product_metadata.fetch@1',
        null,
      );
      if (!intent ||
          intent.providerKind !== 'jav' ||
          intent.integrationId !== handle.integrationId ||
          intent.configRevision !== handle.configRevision ||
          intent.contentProfile !== 'jav' ||
          !Array.isArray(intent.requestedFields) ||
          intent.requestedFields.length > 32) {
        fail(
          'P5_PROVIDER_INPUT_INVALID',
          'JAV Metadata input is invalid.',
        );
      }
      const identity = resolvedIdentity(
        normalizeThePornDbJavCode(
          intent.resolvedProviderIdentity?.providerKey,
          fail,
        ),
      );
      exactIdentity(intent.resolvedProviderIdentity, identity);
      const found = await readScene(
        identity.providerKey,
        'libra.product_metadata.fetch@1',
        30_000,
      );
      const scene = found.scene;
      const entries = [
        {
          key: 'genre',
          value: scene.tags.slice().sort().join(', ') || 'Adult',
        },
        { key: 'jav_code', value: identity.providerKey },
        { key: 'release_date', value: String(scene.date || '') },
        { key: 'studio', value: String(scene.studio || '') },
        { key: 'title', value: scene.title.trim() },
      ].filter((item) => item.value)
        .sort((left, right) =>
          Buffer.compare(Buffer.from(left.key), Buffer.from(right.key)));
      const requested = new Set(intent.requestedFields);
      if (requested.size !== intent.requestedFields.length ||
          [...requested].some((field) =>
            !entries.some((entry) => entry.key === field))) {
        fail(
          'P5_PROVIDER_RESPONSE_INVALID',
          'JAV Provider metadata does not satisfy requested fields.',
        );
      }
      const peopleHints = scene.performers.map((person) =>
        Object.freeze({
          displayName: person.name,
          role: 'actor',
          providerIdentities: Object.freeze([]),
        }));
      return Object.freeze({
        providerKind: 'jav',
        integrationId: handle.integrationId,
        configRevision: handle.configRevision,
        sourceRef: 'adult-provider:' + scene.id,
        descriptiveEntries: Object.freeze(entries),
        providerIdentities: Object.freeze([identity]),
        peopleHints: Object.freeze(peopleHints),
      });
    },

    async fetchProviderArtifact(request) {
      const handle = request?.integrationHandle;
      const kind = request?.artifactKind;
      validateProductHandle(
        handle,
        'libra.product_artifact.acquire@1',
        kind,
      );
      const identity = resolvedIdentity(
        normalizeThePornDbJavCode(
          request?.resolvedProviderIdentity?.providerKey,
          fail,
        ),
      );
      exactIdentity(request.resolvedProviderIdentity, identity);
      const found = await readScene(
        identity.providerKey,
        'libra.product_artifact.acquire@1',
        30_000,
      );
      const selected = kind === 'poster'
        ? found.scene.posterUrl
        : found.scene.fanartUrl;
      if (!selected) {
        return Object.freeze({
          resultKind: 'not_available',
          reasonCode: 'provider_artifact_not_available',
        });
      }
      const image = await fetchBytes(
        fetchImpl,
        safeArtifactUrl(selected),
        {
          headers: { accept: 'image/jpeg,image/*' },
          redirect: 'error',
          signal: AbortSignal.timeout(30_000),
        },
        IMAGE_LIMIT,
      );
      if (!image.bytes.length ||
          !image.contentType.toLowerCase().startsWith('image/')) {
        image.bytes.fill(0);
        fail(
          'P5_PROVIDER_RESPONSE_INVALID',
          'JAV Provider artifact response is invalid.',
        );
      }
      return Object.freeze({
        resultKind: 'acquired',
        artifactKind: kind,
        integrationId: handle.integrationId,
        configRevision: handle.configRevision,
        resolvedProviderIdentity: identity,
        mediaType: image.contentType.split(';')[0].toLowerCase(),
        bytes: image.bytes,
      });
    },
  });
}

module.exports = Object.freeze({
  JavProductProviderError,
  createJavProductProviderAdapter,
});
