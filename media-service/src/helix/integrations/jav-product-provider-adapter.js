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

const JAV_CODE = /^[A-Z0-9]{2,16}-[0-9]{2,8}$/;
const JSON_LIMIT = 128 * 1024;
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

function object(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('P5_PROVIDER_RESPONSE_INVALID', message);
  }
  return value;
}

function boundedString(value, maximum, optional = false) {
  if (optional && (value === undefined || value === null)) return null;
  if (typeof value !== 'string' ||
      (!optional && value.length < 1) ||
      Buffer.byteLength(value, 'utf8') > maximum) {
    fail(
      'P5_PROVIDER_RESPONSE_INVALID',
      'JAV Provider response string exceeds its bound.',
    );
  }
  return value;
}

function normalizedCode(value) {
  const code = String(value || '')
    .normalize('NFKC')
    .trim()
    .toUpperCase();
  if (!JAV_CODE.test(code)) {
    fail('P5_PROVIDER_INPUT_INVALID', 'JAV Provider code is invalid.');
  }
  return code;
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

function boundedArray(value, maximum, name) {
  if (!Array.isArray(value) || value.length > maximum) {
    fail(
      'P5_PROVIDER_RESPONSE_INVALID',
      'JAV Provider ' + name + ' exceeds its bound.',
    );
  }
  return value;
}

function optionalNestedUrl(value, key) {
  if (typeof value?.[key] === 'string' && value[key]) return value[key];
  return null;
}

function projectScene(value) {
  const scene = object(value, 'JAV Provider SceneResource is invalid.');
  const id = boundedString(String(scene.id || ''), 256);
  const sku = normalizedCode(scene.sku);
  const title = boundedString(scene.title, 2048);
  const date = boundedString(scene.date, 64, true);
  const description = boundedString(scene.description, 32 * 1024, true);
  const tags = boundedArray(scene.tags || [], 64, 'tag collection')
    .map((item) => {
      object(item, 'JAV Provider tag is invalid.');
      return boundedString(item.name, 512);
    });
  const performers = boundedArray(
    scene.performers || [],
    256,
    'performer collection',
  ).map((item) => {
    object(item, 'JAV Provider performer is invalid.');
    return Object.freeze({
      id: boundedString(String(item.id || item.uuid || ''), 256),
      name: boundedString(item.name, 512),
    });
  });
  let studio = null;
  if (scene.site !== undefined && scene.site !== null) {
    object(scene.site, 'JAV Provider site is invalid.');
    studio = boundedString(scene.site.name, 512);
  }
  const posters = scene.posters === undefined || scene.posters === null
    ? null
    : object(scene.posters, 'JAV Provider poster projection is invalid.');
  const background =
    scene.background === undefined || scene.background === null
      ? null
      : object(
          scene.background,
          'JAV Provider background projection is invalid.',
        );
  const posterUrl = optionalNestedUrl(posters, 'full') ||
    boundedString(scene.poster || scene.poster_image, 4096, true);
  const fanartUrl = optionalNestedUrl(background, 'full') ||
    boundedString(
      scene.back_image || scene.image,
      4096,
      true,
    );
  return Object.freeze({
    id,
    sku,
    title,
    date,
    description,
    studio,
    tags: Object.freeze(tags),
    performers: Object.freeze(performers),
    posterUrl,
    fanartUrl,
  });
}

function searchResult(value, code) {
  const root = object(value, 'JAV Provider search response is invalid.');
  const rows = boundedArray(root.data, 2, 'search result')
    .map(projectScene)
    .filter((scene) => scene.sku === code);
  if (rows.length !== 1) {
    fail(
      'P5_PROVIDER_IDENTITY_UNRESOLVED',
      'JAV Provider did not return one exact code match.',
    );
  }
  return rows[0];
}

function exactResult(value, code) {
  const root = object(value, 'JAV Provider metadata response is invalid.');
  const scene = projectScene(root.data);
  if (scene.sku !== code) {
    fail(
      'P5_PROVIDER_IDENTITY_MISMATCH',
      'JAV Provider metadata returned a foreign identity.',
    );
  }
  return scene;
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

  function providerUrl(endpoint, relative) {
    return new URL(
      String(relative).replace(/^\//, ''),
      endpoint.replace(/\/+$/, '') + '/',
    );
  }

  function authorization(secretBytes) {
    return 'Bearer ' + secretBytes.toString('utf8');
  }

  async function searchScene(code, operationId, timeoutMs) {
    return withSecret(operationId, timeoutMs, async (value) => {
      const url = providerUrl(value.endpoint, 'jav');
      url.searchParams.set('q', code);
      url.searchParams.set('per_page', '2');
      const response = await fetchJson(fetchImpl, url, {
        headers: {
          accept: 'application/json',
          authorization: authorization(value.secretBytes),
        },
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      }, JSON_LIMIT);
      return Object.freeze({
        scene: searchResult(response, code),
        snapshot: value.snapshot,
      });
    });
  }

  async function readScene(code, operationId, timeoutMs) {
    return withSecret(operationId, timeoutMs, async (value) => {
      const response = await fetchJson(
        fetchImpl,
        providerUrl(
          value.endpoint,
          'jav/' + encodeURIComponent(code),
        ),
        {
          headers: {
            accept: 'application/json',
            authorization: authorization(value.secretBytes),
          },
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
        },
        JSON_LIMIT,
      );
      return Object.freeze({
        scene: exactResult(response, code),
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
      const code = normalizedCode(request.javCode);
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
        normalizedCode(intent.resolvedProviderIdentity?.providerKey),
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
        normalizedCode(request?.resolvedProviderIdentity?.providerKey),
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
