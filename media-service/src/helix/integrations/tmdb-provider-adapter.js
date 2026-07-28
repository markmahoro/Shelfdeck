'use strict';

const { canonicalDigest } = require('../contracts/canonical-json');
const {
  ExternalProviderArtifactPort,
  ExternalProviderObservationPort,
} = require('./index');

const SUPPORTED_OPERATIONS = new Set([
  'shared.integration.search@1',
  'libra.product_metadata.fetch@1',
  'libra.product_artifact.acquire@1',
]);

class TmdbProviderAdapterError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TmdbProviderAdapterError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new TmdbProviderAdapterError(code, message, details);
}

function exact(value, fields, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !==
        JSON.stringify([...fields].sort())) {
    fail(code, 'TMDB input must match the exact closed shape.');
  }
}

function normalizedEndpoint(value) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch (_error) {
    fail(
      'PLATFORM_INTEGRATION_ENDPOINT_INVALID',
      'TMDB endpoint must be an absolute HTTPS URL.',
    );
  }
  if (endpoint.protocol !== 'https:' ||
      endpoint.hostname !== 'api.themoviedb.org' ||
      !['/3', '/3/'].includes(endpoint.pathname) ||
      endpoint.username || endpoint.password ||
      endpoint.search || endpoint.hash) {
    fail(
      'PLATFORM_INTEGRATION_ENDPOINT_INVALID',
      'TMDB endpoint must be the official HTTPS API v3 root.',
    );
  }
  return 'https://api.themoviedb.org/3';
}

function timeout(value) {
  const timeoutMs = value ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 500 || timeoutMs > 30_000) {
    fail(
      'PLATFORM_INTEGRATION_TIMEOUT_INVALID',
      'TMDB timeout must be between 500 and 30000 milliseconds.',
    );
  }
  return timeoutMs;
}

function identity(providerKey, namespace, seasonNumber = null) {
  const basis = {
    provider: 'tmdb',
    namespace,
    providerKey: String(providerKey),
    seasonNumber,
  };
  return Object.freeze({
    ...basis,
    identityAnchorDigest: canonicalDigest(basis),
  });
}

function createTmdbProviderAdapter(options) {
  if (!options?.integrationQueryPort ||
      typeof options.integrationQueryPort.query !== 'function' ||
      !options?.integrationHandleResolverPort ||
      typeof options.integrationHandleResolverPort.resolve !== 'function' ||
      !options?.secretLeaseResolverPort ||
      typeof options.secretLeaseResolverPort.resolve !== 'function' ||
      !options?.secretLeaseConsumer ||
      typeof options.secretLeaseConsumer.consumeAsync !== 'function') {
    throw new TypeError(
      'TMDB adapter requires Platform query, Handle, and Secret Lease ports.',
    );
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('TMDB adapter requires a Fetch implementation.');
  }
  const now = options.now || Date.now;

  async function fetchJson(endpoint, secretKind, secretBytes, relative, init) {
    const target = new URL(endpoint + relative);
    const headers = {
      accept: 'application/json',
      'user-agent': 'ShelfDeck-Helix/1',
    };
    const secret = secretBytes.toString('utf8');
    if (secretKind === 'tmdb_api_key') {
      target.searchParams.set('api_key', secret);
    } else if (secretKind === 'tmdb_access_token') {
      headers.authorization = 'Bearer ' + secret;
    } else {
      fail(
        'PLATFORM_INTEGRATION_CREDENTIAL_KIND_INVALID',
        'TMDB credential kind is unsupported.',
      );
    }
    for (const [key, value] of Object.entries(init.query || {})) {
      if (value !== undefined && value !== null) {
        target.searchParams.set(key, String(value));
      }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs);
    let response;
    try {
      response = await fetchImpl(target, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
    } catch (_error) {
      if (controller.signal.aborted) {
        fail(
          'PLATFORM_INTEGRATION_TIMEOUT',
          'TMDB request exceeded its bounded timeout.',
        );
      }
      fail(
        'PLATFORM_INTEGRATION_NETWORK_FAILED',
        'TMDB request failed before a valid response was received.',
      );
    } finally {
      clearTimeout(timer);
      delete headers.authorization;
    }
    if (!response || !Number.isSafeInteger(response.status)) {
      fail(
        'PLATFORM_INTEGRATION_RESPONSE_INVALID',
        'TMDB returned an invalid HTTP response.',
      );
    }
    if (response.status < 200 || response.status > 299) {
      fail(
        response.status === 401 || response.status === 403
          ? 'PLATFORM_INTEGRATION_CREDENTIAL_REJECTED'
          : 'PLATFORM_INTEGRATION_HTTP_FAILED',
        'TMDB rejected the bounded request.',
        { statusCode: response.status },
      );
    }
    let body;
    try {
      body = await response.json();
    } catch (_error) {
      fail(
        'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
        'TMDB response was not valid JSON.',
      );
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      fail(
        'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
        'TMDB response did not match the expected object shape.',
      );
    }
    return body;
  }

  async function withSavedSecret(value, consumer) {
    const snapshot = options.integrationQueryPort.query({
      integrationId: value.integrationId,
      expectedConfigRevision: value.configRevision,
    });
    if (snapshot.state !== 'active' ||
        snapshot.integrationType !== 'tmdb') {
      fail(
        'PLATFORM_INTEGRATION_UNAVAILABLE',
        'TMDB integration is not active at the requested revision.',
      );
    }
    const lease = options.secretLeaseResolverPort.resolve({
      secretRef: snapshot.secretRef,
      ownerScopeType: 'integration',
      ownerScopeId: snapshot.integrationId,
      secretKind: snapshot.secretKind,
      expectedRevision: snapshot.configRevision,
      purpose: value.operationId,
      ttlMs: Math.min(value.timeoutMs + 1_000, 60_000),
    });
    return options.secretLeaseConsumer.consumeAsync(
      lease,
      (secretBytes) => consumer(snapshot, secretBytes),
    );
  }

  async function execute(request) {
    exact(
      request,
      [
        'operationId',
        'integrationHandle',
        'input',
        'timeoutMs',
      ],
      'PLATFORM_TMDB_REQUEST_SHAPE',
    );
    if (!SUPPORTED_OPERATIONS.has(request.operationId) ||
        request.integrationHandle.allowedOperation !== request.operationId ||
        request.integrationHandle.integrationType !== 'tmdb') {
      fail(
        'PLATFORM_TMDB_OPERATION_DENIED',
        'TMDB operation is not authorized by the Integration Handle.',
      );
    }
    const expected = options.integrationHandleResolverPort.resolve({
      integrationId: request.integrationHandle.integrationId,
      integrationType: 'tmdb',
      configRevision: request.integrationHandle.configRevision,
      allowedOperation: request.operationId,
      artifactKind: request.input?.artifactKind || null,
    });
    if (JSON.stringify(expected) !==
        JSON.stringify(request.integrationHandle)) {
      fail(
        'PLATFORM_TMDB_HANDLE_FENCE_MISMATCH',
        'TMDB Integration Handle is stale or foreign.',
      );
    }
    return withSavedSecret({
      integrationId: expected.integrationId,
      configRevision: expected.configRevision,
      operationId: request.operationId,
      timeoutMs: timeout(request.timeoutMs),
    }, async (snapshot, secretBytes) => {
      if (request.operationId === 'shared.integration.search@1') {
        exact(
          request.input,
          ['contentProfile', 'title'],
          'PLATFORM_TMDB_SEARCH_SHAPE',
        );
        if (!['movie', 'series'].includes(request.input.contentProfile) ||
            typeof request.input.title !== 'string' ||
            !request.input.title.trim() ||
            request.input.title.length > 512) {
          fail(
            'PLATFORM_TMDB_SEARCH_INVALID',
            'TMDB search input is invalid.',
          );
        }
        const series = request.input.contentProfile === 'series';
        const result = await fetchJson(
          snapshot.endpoint,
          snapshot.secretKind,
          secretBytes,
          '/search/' + (series ? 'tv' : 'movie'),
          {
            timeoutMs: timeout(request.timeoutMs),
            query: {
              query: request.input.title.trim(),
              include_adult: 'false',
              language: 'en-US',
              page: 1,
            },
          },
        );
        if (!Array.isArray(result.results) || !result.results.length ||
            !Number.isSafeInteger(result.results[0].id)) {
          fail(
            'PLATFORM_TMDB_IDENTITY_NOT_FOUND',
            'TMDB did not resolve one provider identity.',
          );
        }
        if (series) {
          fail(
            'PLATFORM_TMDB_SERIES_SEASON_REQUIRED',
            'H1.1 TMDB search cannot invent a Series season number.',
          );
        }
        return Object.freeze({
          provider: 'tmdb',
          namespace: 'tmdb_movie',
          providerKey: String(result.results[0].id),
          seasonNumber: null,
          integrationId: snapshot.integrationId,
          configRevision: snapshot.configRevision,
        });
      }

      if (request.operationId === 'libra.product_metadata.fetch@1') {
        exact(
          request.input,
          ['resolvedProviderIdentity', 'requestedFields'],
          'PLATFORM_TMDB_METADATA_SHAPE',
        );
        const resolved = request.input.resolvedProviderIdentity;
        const namespace = resolved?.namespace;
        if (resolved?.provider !== 'tmdb' ||
            !['tmdb_movie', 'tmdb_series'].includes(namespace) ||
            typeof resolved.providerKey !== 'string' ||
            !/^[0-9]+$/.test(resolved.providerKey) ||
            !Array.isArray(request.input.requestedFields)) {
          fail(
            'PLATFORM_TMDB_IDENTITY_INVALID',
            'TMDB metadata requires one exact Provider identity.',
          );
        }
        const series = namespace === 'tmdb_series';
        const body = await fetchJson(
          snapshot.endpoint,
          snapshot.secretKind,
          secretBytes,
          '/' + (series ? 'tv' : 'movie') +
            '/' + resolved.providerKey,
          {
            timeoutMs: timeout(request.timeoutMs),
            query: {
              append_to_response: 'credits',
              language: 'en-US',
            },
          },
        );
        if (String(body.id) !== resolved.providerKey) {
          fail(
            'PLATFORM_TMDB_IDENTITY_MISMATCH',
            'TMDB metadata response belongs to a foreign identity.',
          );
        }
        const requested = new Set(request.input.requestedFields);
        const values = new Map();
        const title = series ? body.name : body.title;
        const releaseDate = series
          ? body.first_air_date
          : body.release_date;
        if (title) values.set('title', String(title));
        if (releaseDate) {
          values.set('release_date', String(releaseDate));
          values.set(
            'year_or_release_date',
            String(releaseDate).slice(0, 4),
          );
        }
        if (body.overview) values.set('plot', String(body.overview));
        if (Array.isArray(body.genres) && body.genres.length) {
          values.set(
            'genre',
            body.genres.map((item) => item.name).filter(Boolean).join(', '),
          );
        }
        const crew = Array.isArray(body.credits?.crew)
          ? body.credits.crew
          : [];
        const director = crew.find((item) => item.job === 'Director')?.name;
        if (director) values.set('director', String(director));
        values.set(
          series ? 'tmdb_series_id' : 'tmdb_movie_id',
          resolved.providerKey,
        );
        const descriptiveEntries = [...values]
          .filter(([key]) =>
            requested.has(key) || key.startsWith('tmdb_'))
          .map(([key, value]) => Object.freeze({ key, value }))
          .sort((left, right) =>
            Buffer.compare(Buffer.from(left.key), Buffer.from(right.key)));
        const peopleHints = (Array.isArray(body.credits?.cast)
          ? body.credits.cast
          : [])
          .filter((item) =>
            Number.isSafeInteger(item.id) &&
            typeof item.name === 'string' &&
            item.name)
          .slice(0, 16)
          .map((item) => Object.freeze({
            displayName: item.name,
            role: 'actor',
            providerIdentities: Object.freeze([Object.freeze({
              provider: 'tmdb',
              namespace: 'tmdb_person',
              providerKey: String(item.id),
            })]),
          }));
        return Object.freeze({
          providerKind: 'tmdb',
          integrationId: snapshot.integrationId,
          configRevision: snapshot.configRevision,
          sourceRef: 'tmdb:' + (series ? 'tv' : 'movie') +
            ':' + resolved.providerKey,
          descriptiveEntries: Object.freeze(descriptiveEntries),
          providerIdentities: Object.freeze([
            Object.freeze({ ...resolved }),
          ]),
          peopleHints: Object.freeze(peopleHints),
        });
      }

      exact(
        request.input,
        ['artifactKind', 'resolvedProviderIdentity'],
        'PLATFORM_TMDB_ARTIFACT_SHAPE',
      );
      const artifactKind = request.input.artifactKind;
      const resolved = request.input.resolvedProviderIdentity;
      if (!['poster', 'fanart'].includes(artifactKind) ||
          resolved?.provider !== 'tmdb' ||
          !['tmdb_movie', 'tmdb_series'].includes(resolved.namespace) ||
          !/^[0-9]+$/.test(resolved.providerKey || '')) {
        fail(
          'PLATFORM_TMDB_ARTIFACT_INVALID',
          'TMDB artifact request is invalid.',
        );
      }
      const series = resolved.namespace === 'tmdb_series';
      const images = await fetchJson(
        snapshot.endpoint,
        snapshot.secretKind,
        secretBytes,
        '/' + (series ? 'tv' : 'movie') +
          '/' + resolved.providerKey + '/images',
        { timeoutMs: timeout(request.timeoutMs), query: {} },
      );
      const collection = artifactKind === 'poster'
        ? images.posters
        : images.backdrops;
      const imagePath = Array.isArray(collection)
        ? collection.find((item) =>
          typeof item.file_path === 'string')?.file_path
        : undefined;
      if (!imagePath) {
        return Object.freeze({
          resultKind: 'not_available',
          reasonCode: artifactKind + '_not_available',
        });
      }
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        timeout(request.timeoutMs),
      );
      let imageResponse;
      try {
        imageResponse = await fetchImpl(
          'https://image.tmdb.org/t/p/original' + imagePath,
          {
            headers: {
              accept: 'image/jpeg',
              'user-agent': 'ShelfDeck-Helix/1',
            },
            signal: controller.signal,
          },
        );
      } catch (_error) {
        fail(
          'PLATFORM_INTEGRATION_NETWORK_FAILED',
          'TMDB image request failed.',
        );
      } finally {
        clearTimeout(timer);
      }
      if (!imageResponse || imageResponse.status < 200 ||
          imageResponse.status > 299) {
        fail(
          'PLATFORM_INTEGRATION_HTTP_FAILED',
          'TMDB image request was rejected.',
        );
      }
      const bytes = Buffer.from(await imageResponse.arrayBuffer());
      if (!bytes.length || bytes.length > 16 * 1024 * 1024) {
        bytes.fill(0);
        fail(
          'PLATFORM_INTEGRATION_RESPONSE_BOUND',
          'TMDB image exceeds the bounded response size.',
        );
      }
      return Object.freeze({
        resultKind: 'acquired',
        artifactKind,
        integrationId: snapshot.integrationId,
        configRevision: snapshot.configRevision,
        resolvedProviderIdentity: Object.freeze({ ...resolved }),
        mediaType: 'image/jpeg',
        bytes,
      });
    });
  }

  const observationPort = ExternalProviderObservationPort({
    execute(request) {
      if (request?.operationId ===
          'libra.product_artifact.acquire@1') {
        fail(
          'PLATFORM_TMDB_EFFECT_CLASS_MISMATCH',
          'TMDB Artifact acquisition requires the workspace-write port.',
        );
      }
      return execute(request);
    },
  });
  const artifactPort = ExternalProviderArtifactPort({
    execute(request) {
      if (request?.operationId !==
          'libra.product_artifact.acquire@1') {
        fail(
          'PLATFORM_TMDB_EFFECT_CLASS_MISMATCH',
          'TMDB Artifact port accepts only the workspace-write operation.',
        );
      }
      return execute(request);
    },
  });

  async function testCandidate(value) {
    exact(
      value,
      ['endpoint', 'secretKind', 'secretBytes', 'timeoutMs'],
      'PLATFORM_TMDB_TEST_SHAPE',
    );
    if (!Buffer.isBuffer(value.secretBytes) ||
        value.secretBytes.length < 1 || value.secretBytes.length > 4096) {
      fail(
        'PLATFORM_INTEGRATION_CREDENTIAL_INVALID',
        'TMDB credential bytes are invalid.',
      );
    }
    const endpoint = normalizedEndpoint(value.endpoint);
    const timeoutMs = timeout(value.timeoutMs);
    const configuration = await fetchJson(
      endpoint,
      value.secretKind,
      value.secretBytes,
      '/configuration',
      { timeoutMs, query: {} },
    );
    if (!configuration.images ||
        typeof configuration.images.secure_base_url !== 'string') {
      fail(
        'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
        'TMDB configuration response is incomplete.',
      );
    }
    const movie = await fetchJson(
      endpoint,
      value.secretKind,
      value.secretBytes,
      '/movie/550',
      {
        timeoutMs,
        query: { append_to_response: 'credits', language: 'en-US' },
      },
    );
    if (movie.id !== 550 || typeof movie.title !== 'string' ||
        !movie.title) {
      fail(
        'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
        'TMDB typed identity/metadata response is incomplete.',
      );
    }
    const checkedAtMs = now();
    return Object.freeze({
      provider: 'tmdb',
      checkedAtMs,
      endpointDigest: canonicalDigest({ endpoint }),
      capabilityCodes: Object.freeze(['identity', 'metadata']),
      identityNamespace: 'tmdb_movie',
      identityProviderKey: '550',
      observationDigest: canonicalDigest({
        schema: 'platform.tmdb-live-test@1',
        endpoint,
        identity: identity('550', 'tmdb_movie'),
        title: movie.title,
        checkedAtMs,
      }),
    });
  }

  return Object.freeze({
    artifactPort,
    observationPort,
    normalizedEndpoint,
    testCandidate,
  });
}

module.exports = Object.freeze({
  TmdbProviderAdapterError,
  createTmdbProviderAdapter,
  normalizedEndpoint,
});
