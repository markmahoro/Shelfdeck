'use strict';

const {
  canonicalDigest,
  canonicalJson,
} = require('../contracts/canonical-json');
const {
  fetchBytes,
  fetchJson,
} = require('./h1-provider-adapters');

const JAV_CODE = /^[A-Z0-9]{2,16}-[0-9]{2,8}$/;
const GRAPHQL_LIMIT = 64 * 1024;
const IMAGE_LIMIT = 16 * 1024 * 1024;

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

function exact(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(
      'P5_PROVIDER_RESPONSE_INVALID',
      'JAV Provider response is not one closed object.',
    );
  }
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (required.some((key) => !Object.hasOwn(value, key)) ||
      keys.some((key) => !allowed.has(key))) {
    fail(
      'P5_PROVIDER_RESPONSE_INVALID',
      'JAV Provider response contains an unknown or missing field.',
    );
  }
}

function boundedString(value, maximum, optional = false) {
  if (optional && (value === undefined || value === null)) return;
  if (typeof value !== 'string' ||
      (!optional && value.length < 1) ||
      Buffer.byteLength(value, 'utf8') > maximum) {
    fail(
      'P5_PROVIDER_RESPONSE_INVALID',
      'JAV Provider response string exceeds its closed bound.',
    );
  }
}

function normalizedCode(value) {
  const code = String(value || '')
    .normalize('NFKC')
    .trim()
    .toUpperCase();
  if (!JAV_CODE.test(code)) {
    fail(
      'P5_PROVIDER_INPUT_INVALID',
      'JAV Provider code is invalid.',
    );
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

function sceneQuery(code) {
  return Object.freeze({
    query:
      'query ShelfDeckJavScene($code: String!) {' +
      ' findScenes(' +
      'scene_filter: { code: { value: $code, modifier: EQUALS } },' +
      'filter: { per_page: 2 }) {' +
      ' scenes { id code title date details studio { name }' +
      ' tags { name } performers { id name }' +
      ' images { url width height } } } }',
    variables: Object.freeze({ code }),
  });
}

function validateSceneResponse(value) {
  exact(value, ['data'], []);
  exact(value.data, ['findScenes'], []);
  exact(value.data.findScenes, ['scenes'], []);
  const scenes = value.data.findScenes.scenes;
  if (!Array.isArray(scenes) || scenes.length > 2) {
    fail(
      'P5_PROVIDER_RESPONSE_INVALID',
      'JAV Provider scene result exceeds its closed bound.',
    );
  }
  const sceneIds = new Set();
  for (const scene of scenes) {
    exact(
      scene,
      [
        'id',
        'code',
        'title',
        'date',
        'studio',
        'tags',
        'performers',
        'images',
      ],
      ['details'],
    );
    boundedString(scene.id, 256);
    boundedString(scene.code, 64);
    boundedString(scene.title, 2048);
    boundedString(scene.date, 64, true);
    boundedString(scene.details, 32 * 1024, true);
    if (sceneIds.has(scene.id)) {
      fail(
        'P5_PROVIDER_RESPONSE_INVALID',
        'JAV Provider scene identities are duplicated.',
      );
    }
    sceneIds.add(scene.id);
    if (scene.studio !== null) {
      exact(scene.studio, ['name']);
      boundedString(scene.studio.name, 512);
    }
    for (const [items, maximum, fields] of [
      [scene.tags, 64, ['name']],
      [scene.performers, 256, ['id', 'name']],
      [scene.images, 64, ['url', 'width', 'height']],
    ]) {
      if (!Array.isArray(items) || items.length > maximum) {
        fail(
          'P5_PROVIDER_RESPONSE_INVALID',
          'JAV Provider nested result exceeds its closed bound.',
        );
      }
      const identities = new Set();
      for (const item of items) {
        exact(item, fields);
        const identity = fields.includes('id')
          ? String(item.id)
          : fields.includes('url')
            ? String(item.url)
            : String(item.name);
        boundedString(identity, fields.includes('url') ? 4096 : 512);
        if (fields.includes('name')) boundedString(item.name, 512);
        if (fields.includes('url') &&
            (!Number.isSafeInteger(item.width) ||
             !Number.isSafeInteger(item.height) ||
             item.width < 1 || item.height < 1)) {
          fail(
            'P5_PROVIDER_RESPONSE_INVALID',
            'JAV Provider image dimensions are invalid.',
          );
        }
        if (identities.has(identity)) {
          fail(
            'P5_PROVIDER_RESPONSE_INVALID',
            'JAV Provider nested identities are duplicated.',
          );
        }
        identities.add(identity);
      }
    }
  }
  return scenes;
}

function normalizeScene(value, expectedCode) {
  const matches = validateSceneResponse(value).filter((item) =>
    normalizedCode(item.code) === expectedCode);
  if (matches.length !== 1) {
    fail(
      'P5_PROVIDER_IDENTITY_UNRESOLVED',
      'JAV Provider did not return one exact code match.',
    );
  }
  const scene = matches[0];
  if (typeof scene.id !== 'string' ||
      !scene.id ||
      typeof scene.title !== 'string' ||
      !scene.title.trim()) {
    fail(
      'P5_PROVIDER_RESPONSE_INVALID',
      'JAV Provider scene result is incomplete.',
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
  const host = target.hostname.toLowerCase();
  if (target.protocol !== 'https:' ||
      target.username || target.password ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host) ||
      /^169\.254\./.test(host)) {
    fail(
      'P5_PROVIDER_RESPONSE_INVALID',
      'JAV Provider artifact URL is outside the public HTTPS boundary.',
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
    if (!snapshot || snapshot.integration.state !== 'active') {
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
      consumer({
        endpoint,
        secretBytes,
        snapshot,
      }));
  }

  async function findScene(code, operationId, timeoutMs) {
    return withSecret(operationId, timeoutMs, async (value) => {
      const response = await fetchJson(
        fetchImpl,
        value.endpoint,
        {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            apikey: value.secretBytes.toString('utf8'),
          },
          body: canonicalJson(sceneQuery(code)),
          signal: AbortSignal.timeout(timeoutMs),
        },
        GRAPHQL_LIMIT,
      );
      if (response.errors) {
        fail(
          'P5_PROVIDER_RESPONSE_INVALID',
          'JAV Provider returned a GraphQL error.',
        );
      }
      return Object.freeze({
        scene: normalizeScene(response, code),
        snapshot: value.snapshot,
      });
    });
  }

  function validateProductHandle(handle, operationId, artifactKind) {
    const snapshot = current();
    if (!handle ||
        handle.integrationId !== snapshot.integration.integrationId ||
        handle.integrationType !== 'jav' ||
        handle.configRevision !==
          snapshot.integration.configRevision ||
        handle.secretRef !== snapshot.secret.secretRef ||
        handle.allowedOperation !== operationId ||
        handle.expiresAtMs < now() ||
        (artifactKind
          ? !['poster', 'fanart'].includes(artifactKind)
          : false)) {
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
      const found = await findScene(
        code,
        'shared.integration.search@1',
        10_000,
      );
      return Object.freeze({
        provider: 'jav',
        namespace: 'jav_code',
        providerKey: code,
        integrationId: found.snapshot.integration.integrationId,
        configRevision:
          found.snapshot.integration.configRevision,
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
          intent.contentProfile !== 'jav') {
        fail(
          'P5_PROVIDER_INPUT_INVALID',
          'JAV Metadata input is invalid.',
        );
      }
      const identity = resolvedIdentity(
        normalizedCode(
          intent.resolvedProviderIdentity?.providerKey,
        ),
      );
      exactIdentity(intent.resolvedProviderIdentity, identity);
      const found = await findScene(
        identity.providerKey,
        'libra.product_metadata.fetch@1',
        30_000,
      );
      const scene = found.scene;
      const entries = [
        {
          key: 'genre',
          value: (scene.tags || [])
            .map((item) => String(item.name || '').trim())
            .filter(Boolean)
            .sort()
            .join(', ') || 'Adult',
        },
        { key: 'jav_code', value: identity.providerKey },
        { key: 'release_date', value: String(scene.date || '') },
        { key: 'studio', value: String(scene.studio?.name || '') },
        { key: 'title', value: scene.title.trim() },
      ].filter((item) => item.value)
        .sort((left, right) =>
          Buffer.compare(Buffer.from(left.key), Buffer.from(right.key)));
      const requested = new Set(intent.requestedFields);
      if ([...requested].some((field) =>
        !entries.some((entry) => entry.key === field))) {
        fail(
          'P5_PROVIDER_RESPONSE_INVALID',
          'JAV Provider metadata does not satisfy requested fields.',
        );
      }
      const peopleHints = (scene.performers || [])
        .slice(0, 256)
        .map((person) => Object.freeze({
          displayName: String(person.name || '').trim(),
          role: 'actor',
          providerIdentities: Object.freeze([]),
        }))
        .filter((item) => item.displayName);
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
        normalizedCode(
          request?.resolvedProviderIdentity?.providerKey,
        ),
      );
      exactIdentity(request.resolvedProviderIdentity, identity);
      const found = await findScene(
        identity.providerKey,
        'libra.product_artifact.acquire@1',
        30_000,
      );
      const images = (found.scene.images || [])
        .filter((item) => typeof item?.url === 'string' && item.url);
      const selected = kind === 'poster'
        ? images.find((item) =>
            Number(item.height) >= Number(item.width)) || images[0]
        : images.find((item) =>
            Number(item.width) > Number(item.height)) || images[1];
      if (!selected) {
        return Object.freeze({
          resultKind: 'not_available',
          reasonCode: 'provider_artifact_not_available',
        });
      }
      const image = await fetchBytes(
        fetchImpl,
        safeArtifactUrl(selected.url),
        {
          headers: { accept: 'image/jpeg,image/*' },
          signal: AbortSignal.timeout(30_000),
        },
        IMAGE_LIMIT,
      );
      if (!image.bytes.length ||
          !image.contentType.toLowerCase().startsWith('image/')) {
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
