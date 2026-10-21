'use strict';
const { failureDiagnostics } = require('../contracts/failure-diagnostics');

const { ProxyAgent } = require('undici');
const { canonicalDigest } = require('../contracts/canonical-json');
const { buildEpisodeMetadataScope } = require('../contracts/episode-metadata-scope');
const {
  ExternalProviderArtifactPort,
  ExternalProviderObservationPort,
} = require('./index');

const SUPPORTED_OPERATIONS = new Set([
  'shared.integration.search@1',
  'people.registration_evidence.observe@1',
  'libra.routing.fact.observe@1',
  'libra.product_identity.evidence.observe@1',
  'libra.product_metadata.fetch@1',
  'libra.product_artifact.acquire@1',
  'arca.aftercare.binary_artifact.acquire@1',
  'arca.series_presentation.source.observe@1',
  'arca.series_presentation.assets.prepare@1',
]);
const JSON_RESPONSE_MAX_BYTES = 1024 * 1024;
const SERIES_METADATA_CACHE_TTL_MS = 5 * 60 * 1000;
const SERIES_METADATA_CACHE_MAX_ITEMS = 16;
const SERIES_METADATA_CACHE_MAX_BYTES = 16 * 1024 * 1024;
const ARTIFACT_RESPONSE_MAX_BYTES = 16 * 1024 * 1024;
const PERSON_AVATAR_MAX_BYTES = 4 * 1024 * 1024;
const PERSON_AVATAR_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PERSON_AVATAR_CACHE_MAX_ITEMS = 64;
const PERSON_AVATAR_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const PERSON_AVATAR_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const REQUESTED_FIELDS = new Set([
  'director',
  'episode_number',
  'episode_plot',
  'episode_title',
  'genre',
  'plot',
  'release_date',
  'season_number',
  'series_title',
  'title',
  'tmdb_movie_id',
  'tmdb_series_id',
  'year_or_release_date',
]);
const proxyAgents = new Map();

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

// Keep premiere and theatrical years as provider evidence, not identity decisions.
function releaseYears(item) {
  const dates = [item.release_date];
  if (item.release_dates != null) {
    if (!Array.isArray(item.release_dates.results) || item.release_dates.results.length > 300) {
      fail('PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID', 'TMDB release dates are invalid.');
    }
    for (const region of item.release_dates.results) {
      if (!Array.isArray(region.release_dates) || region.release_dates.length > 300) {
        fail('PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID', 'TMDB regional release dates are invalid.');
      }
      for (const release of region.release_dates) dates.push(release.release_date);
    }
  }
  return Object.freeze([...new Set(dates.filter(value => typeof value === 'string' && /^(?:18|19|20|21)\d{2}-\d{2}-\d{2}(?:T.*)?$/.test(value))
    .map(value => Number(value.slice(0, 4))))].sort((a, b) => a - b));
}

function exact(value, fields, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !==
        JSON.stringify([...fields].sort())) {
    fail(code, 'TMDB input must match the exact closed shape.');
  }
}

function allowed(value, required, optional, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(code, 'TMDB response must be one bounded object.');
  }
  const permitted = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (required.some((key) => !Object.hasOwn(value, key)) ||
      keys.some((key) => !permitted.has(key))) {
    fail(code, 'TMDB response contains an unknown or missing field.');
  }
}

function requireFields(value, required, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(code, 'TMDB response must be one bounded object.');
  }
  if (required.some((key) => !Object.hasOwn(value, key))) {
    fail(code, 'TMDB response is missing a required field.');
  }
}

function boundedString(value, maxBytes, code, optional = false) {
  if (optional && (value === null || value === undefined)) return;
  const minimum = optional ? 0 : 1;
  if (typeof value !== 'string' ||
      Buffer.byteLength(value, 'utf8') < minimum ||
      Buffer.byteLength(value, 'utf8') > maxBytes) {
    fail(code, 'TMDB response string exceeds its closed bound.');
  }
}

async function boundedResponseBytes(response, maxBytes) {
  const lengthValue = response?.headers?.get?.('content-length');
  if (lengthValue !== null && lengthValue !== undefined &&
      lengthValue !== '') {
    const declared = Number(lengthValue);
    if (!Number.isSafeInteger(declared) ||
        declared < 0 ||
        declared > maxBytes) {
      fail(
        'PLATFORM_INTEGRATION_RESPONSE_BOUND',
        'TMDB response exceeds its declared byte bound.',
      );
    }
  }
  if (!response?.body ||
      typeof response.body.getReader !== 'function') {
    fail(
      'PLATFORM_INTEGRATION_RESPONSE_INVALID',
      'TMDB response does not expose a bounded byte stream.',
    );
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      const chunk = Buffer.from(item.value);
      total += chunk.length;
      if (total > maxBytes) {
        await reader.cancel();
        fail(
          'PLATFORM_INTEGRATION_RESPONSE_BOUND',
          'TMDB response exceeds its streamed byte bound.',
        );
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, total);
  } finally {
    for (const chunk of chunks) chunk.fill(0);
  }
}

function validateConfigurationResponse(value) {
  allowed(
    value,
    ['images'],
    ['change_keys'],
    'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
  );
  allowed(
    value.images,
    ['secure_base_url'],
    [
      'base_url',
      'backdrop_sizes',
      'logo_sizes',
      'poster_sizes',
      'profile_sizes',
      'still_sizes',
    ],
    'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
  );
  boundedString(
    value.images.secure_base_url,
    2048,
    'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
  );
}

const SEARCH_RESULT_FIELDS = Object.freeze([
  'adult',
  'backdrop_path',
  'first_air_date',
  'genre_ids',
  'id',
  'media_type',
  'name',
  'origin_country',
  'original_language',
  'original_name',
  'original_title',
  'overview',
  'popularity',
  'poster_path',
  'release_date',
  'softcore',
  'title',
  'video',
  'vote_average',
  'vote_count',
]);

function validateSearchResponse(value, allowEmpty = false) {
  allowed(
    value,
    ['results'],
    ['page', 'total_pages', 'total_results'],
    'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
  );
  if (!Array.isArray(value.results) ||
      (!allowEmpty && value.results.length < 1) ||
      value.results.length > 20) {
    fail(
      'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
      'TMDB search result count is invalid.',
    );
  }
  for (const item of value.results) {
    allowed(
      item,
      ['id'],
      SEARCH_RESULT_FIELDS.filter((field) => field !== 'id'),
      'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
    );
    if (!Number.isSafeInteger(item.id) || item.id < 1) {
      fail(
        'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
        'TMDB search identity is invalid.',
      );
    }
    for (const field of [
      'name',
      'original_name',
      'original_title',
      'overview',
      'release_date',
      'title',
    ]) {
      boundedString(
        item[field],
        field === 'overview' ? 16 * 1024 : 1024,
        'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
        true,
      );
    }
  }
  const ids = value.results.map((item) => item.id);
  if (new Set(ids).size !== ids.length) {
    fail(
      'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
      'TMDB search response contains duplicate identities.',
    );
  }
}

const METADATA_FIELDS = Object.freeze([
  'adult',
  'backdrop_path',
  'belongs_to_collection',
  'budget',
  'created_by',
  'credits',
  'alternative_titles',
  'episode_run_time',
  'first_air_date',
  'genres',
  'homepage',
  'id',
  'imdb_id',
  'in_production',
  'languages',
  'last_air_date',
  'last_episode_to_air',
  'name',
  'networks',
  'next_episode_to_air',
  'number_of_episodes',
  'number_of_seasons',
  'origin_country',
  'original_language',
  'original_name',
  'original_title',
  'overview',
  'popularity',
  'poster_path',
  'production_companies',
  'production_countries',
  'release_date',
  'revenue',
  'runtime',
  'seasons',
  'softcore',
  'spoken_languages',
  'status',
  'tagline',
  'title',
  'translations',
  'type',
  'video',
  'vote_average',
  'vote_count',
]);
const PERSON_FIELDS = Object.freeze([
  'adult',
  'cast_id',
  'character',
  'credit_id',
  'department',
  'gender',
  'id',
  'job',
  'known_for_department',
  'name',
  'order',
  'original_name',
  'popularity',
  'profile_path',
]);

function validateMetadataResponse(value, profile = 'movie') {
  requireFields(
    value,
    ['id'],
    'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
  );
  if (!Number.isSafeInteger(value.id) || value.id < 1) {
    fail(
      'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
      'TMDB metadata identity is invalid.',
    );
  }
  for (const [field, max] of [
    ['name', 1024],
    ['original_name', 1024],
    ['original_title', 1024],
    ['overview', 64 * 1024],
    ['release_date', 64],
    ['first_air_date', 64],
    ['title', 1024],
  ]) {
    boundedString(
      value[field],
      max,
      'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
      true,
    );
  }
  if (value.genres !== undefined) {
    if (!Array.isArray(value.genres) || value.genres.length > 64) {
      fail(
        'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
        'TMDB genre set exceeds its bound.',
      );
    }
    const genreIds = new Set();
    for (const item of value.genres) {
      allowed(
        item,
        ['id', 'name'],
        [],
        'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
      );
      if (!Number.isSafeInteger(item.id) ||
          genreIds.has(item.id)) {
        fail(
          'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
          'TMDB genre set contains an invalid duplicate.',
        );
      }
      genreIds.add(item.id);
      boundedString(
        item.name,
        256,
        'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
      );
    }
  }
  if (value.credits !== undefined) {
    requireFields(
      value.credits,
      [],
      'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
    );
    for (const [collectionKind, collection] of [
      ['cast', value.credits.cast || []],
      ['crew', value.credits.crew || []],
    ]) {
      if (!Array.isArray(collection) || collection.length > 1024) {
        fail(
          'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
          'TMDB people set exceeds its bound.',
        );
      }
      const identities = new Set();
      for (const item of collection) {
        requireFields(
          item,
          ['id', 'name'],
          'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
        );
        const identityKey = collectionKind === 'cast'
          ? String(item.id)
          : String(item.id) + '\0' +
            String(item.credit_id || '') + '\0' +
            String(item.job || '');
        if (!Number.isSafeInteger(item.id) ||
            identities.has(identityKey)) {
          fail(
            'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
            'TMDB people set contains an invalid duplicate.',
          );
        }
        identities.add(identityKey);
        boundedString(
          item.name,
          512,
          'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
        );
      }
    }
  }
  if (value.alternative_titles !== undefined) {
    const field=profile==='series'?'results':'titles';
    requireFields(value.alternative_titles, [field], 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID');
    if (!Array.isArray(value.alternative_titles[field]) || value.alternative_titles[field].length > 256) {
      fail('PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID', 'TMDB alternative title set exceeds its bound.');
    }
    for (const item of value.alternative_titles[field]) {
      requireFields(item, ['title'], 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID');
      boundedString(item.title, 1024, 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID');
      boundedString(item.iso_3166_1, 16, 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID', true);
      boundedString(item.type, 128, 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID', true);
    }
  }
  if (value.translations !== undefined) {
    requireFields(value.translations, ['translations'], 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID');
    if (!Array.isArray(value.translations.translations) || value.translations.translations.length > 128) {
      fail('PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID', 'TMDB translation set exceeds its bound.');
    }
    for (const item of value.translations.translations) {
      requireFields(item, ['data'], 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID');
      if (!item.data || typeof item.data !== 'object' || Array.isArray(item.data)) {
        fail('PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID', 'TMDB translation data is invalid.');
      }
      boundedString(item.data.title, 1024, 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID', true);
      boundedString(item.data.name, 1024, 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID', true);
      boundedString(item.iso_3166_1, 16, 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID', true);
      boundedString(item.iso_639_1, 16, 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID', true);
    }
  }
}

function aliasEvidence(item, profile = 'movie') {
  const aliases = [];
  const seen = new Set();
  function add(value, sourceKind, language = null, region = null) {
    const title = typeof value === 'string' ? value.normalize('NFKC').trim() : '';
    if (!title || Buffer.byteLength(title, 'utf8') > 1024) return;
    const key = title.toLocaleLowerCase('und');
    if (seen.has(key) || aliases.length >= 32) return;
    seen.add(key);
    aliases.push(Object.freeze({ value:title, sourceKind, language, region }));
  }
  add(item.title || item.name, 'localized', item.original_language || null);
  add(item.original_title || item.original_name, 'original', item.original_language || null);
  for (const alternate of item.alternative_titles?.[profile==='series'?'results':'titles'] || []) {
    add(alternate.title, 'alternative_title', null, alternate.iso_3166_1 || null);
  }
  for (const translation of item.translations?.translations || []) {
    add(translation.data?.title || translation.data?.name, 'translation', translation.iso_639_1 || null, translation.iso_3166_1 || null);
  }
  return Object.freeze(aliases);
}

function validateImagesResponse(value) {
  allowed(
    value,
    [],
    ['backdrops', 'id', 'logos', 'posters', 'profiles', 'stills'],
    'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
  );
  for (const collection of [
    value.posters || [],
    value.backdrops || [],
    value.stills || [],
  ]) {
    if (!Array.isArray(collection) || collection.length > 512) {
      fail(
        'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
        'TMDB image set exceeds its bound.',
      );
    }
    const paths = new Set();
    for (const item of collection) {
      allowed(
        item,
        ['file_path'],
        [
          'aspect_ratio',
          'height',
          'iso_3166_1',
          'iso_639_1',
          'vote_average',
          'vote_count',
          'width',
        ],
        'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
      );
      boundedString(
        item.file_path,
        2048,
        'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
      );
      if (paths.has(item.file_path)) {
        fail(
          'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
          'TMDB image response contains duplicate paths.',
        );
      }
      paths.add(item.file_path);
    }
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

function dispatcherFor(proxyServer) {
  const value = String(proxyServer || '').trim();
  if (!value) return undefined;
  if (!proxyAgents.has(value)) {
    try {
      proxyAgents.set(value, new ProxyAgent(value));
    } catch (_error) {
      fail(
        'PLATFORM_INTEGRATION_CREDENTIAL_INVALID',
        'TMDB proxy server is invalid.',
        { field: 'settings.proxyServer' },
      );
    }
  }
  return proxyAgents.get(value);
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
  // Protocol response reuse only; every call still resolves its current Handle and
  // Secret Lease, and each Episode produces its own typed durable observation.
  const seriesMetadataCache = new Map();
  function removeSeriesMetadata(key) { seriesMetadataCache.delete(key); }
  async function seriesMetadata(key, load) {
    for (const [entryKey, entry] of seriesMetadataCache) {
      if (entry.expiresAtMs <= now()) removeSeriesMetadata(entryKey);
    }
    if (seriesMetadataCache.has(key)) return seriesMetadataCache.get(key).promise;
    while (seriesMetadataCache.size >= SERIES_METADATA_CACHE_MAX_ITEMS)
      removeSeriesMetadata(seriesMetadataCache.keys().next().value);
    const entry = { expiresAtMs: now() + SERIES_METADATA_CACHE_TTL_MS, bytes: 0 };
    entry.promise = Promise.resolve().then(load).then(value => {
      entry.bytes = Buffer.byteLength(JSON.stringify(value));
      if (seriesMetadataCache.get(key) === entry) {
        entry.expiresAtMs = now() + SERIES_METADATA_CACHE_TTL_MS;
        let total = [...seriesMetadataCache.values()].reduce((sum, item) => sum + item.bytes, 0);
        while (total > SERIES_METADATA_CACHE_MAX_BYTES && seriesMetadataCache.size) {
          const oldest = seriesMetadataCache.keys().next().value;
          total -= seriesMetadataCache.get(oldest).bytes;
          removeSeriesMetadata(oldest);
        }
      }
      return value;
    }, error => {
      if (seriesMetadataCache.get(key) === entry) removeSeriesMetadata(key);
      throw error;
    });
    seriesMetadataCache.set(key, entry);
    return entry.promise;
  }
  const personAvatarCache = new Map();
  let personAvatarCacheBytes = 0;

  function deleteCachedPersonAvatar(key) {
    const entry = personAvatarCache.get(key);
    if (!entry) return;
    personAvatarCache.delete(key);
    personAvatarCacheBytes -= entry.bytes.length;
    entry.bytes.fill(0);
  }

  function cachedPersonAvatar(key) {
    const entry = personAvatarCache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAtMs <= now()) {
      deleteCachedPersonAvatar(key);
      return undefined;
    }
    personAvatarCache.delete(key);
    personAvatarCache.set(key, entry);
    return Object.freeze({
      ...entry.result,
      bytes: Buffer.from(entry.bytes),
      cacheStatus: 'hit',
    });
  }

  function cachePersonAvatar(key, result) {
    deleteCachedPersonAvatar(key);
    while (personAvatarCache.size >= PERSON_AVATAR_CACHE_MAX_ITEMS ||
        personAvatarCacheBytes + result.bytes.length > PERSON_AVATAR_CACHE_MAX_BYTES) {
      const oldestKey = personAvatarCache.keys().next().value;
      if (oldestKey === undefined) break;
      deleteCachedPersonAvatar(oldestKey);
    }
    const bytes = Buffer.from(result.bytes);
    personAvatarCache.set(key, {
      result: Object.freeze({ ...result, bytes: undefined }),
      bytes,
      expiresAtMs: now() + PERSON_AVATAR_CACHE_TTL_MS,
    });
    personAvatarCacheBytes += bytes.length;
  }

  async function fetchJson(endpoint, secretKind, secretBytes, relative, init) {
    const exactEndpoint = normalizedEndpoint(endpoint);
    const target = new URL(exactEndpoint + relative);
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
    const dispatcher = dispatcherFor(init.proxyServer);
    let response;
    try {
      response = await fetchImpl(target, {
        method: 'GET',
        headers,
        signal: controller.signal,
        ...(dispatcher ? { dispatcher } : {}),
      });
    } catch (_error) {
      if (controller.signal.aborted) {
        fail(
          'PLATFORM_INTEGRATION_TIMEOUT',
          'TMDB request exceeded its bounded timeout.',
          { stage:'json_request', timeout:true },
        );
      }
      fail(
        'PLATFORM_INTEGRATION_NETWORK_FAILED',
        'TMDB request failed before a valid response was received.',
        { stage:'json_request', ...failureDiagnostics(_error) },
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
    let responseBytes;
    try {
      responseBytes = await boundedResponseBytes(
        response,
        JSON_RESPONSE_MAX_BYTES,
      );
      const body = JSON.parse(responseBytes.toString('utf8'));
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error('invalid object');
      }
      return body;
    } catch (_error) {
      if (_error instanceof TmdbProviderAdapterError) throw _error;
      fail(
        'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
        'TMDB response was not valid JSON.',
      );
    } finally {
      responseBytes?.fill(0);
    }
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
    normalizedEndpoint(snapshot.endpoint);
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
    const personAvatarCacheKey = request.operationId ===
        'people.registration_evidence.observe@1'
      ? [
          expected.integrationId,
          expected.configRevision,
          request.input?.providerIdentity?.providerKey,
        ].join(':')
      : null;
    if (personAvatarCacheKey) {
      const cached = cachedPersonAvatar(personAvatarCacheKey);
      if (cached) return cached;
    }
    return withSavedSecret({
      integrationId: expected.integrationId,
      configRevision: expected.configRevision,
      operationId: request.operationId,
      timeoutMs: timeout(request.timeoutMs),
    }, async (snapshot, secretBytes) => {
      const language = snapshot.settings?.language || 'zh-CN';
      const proxyServer = snapshot.settings?.proxyServer || '';
      const proxyDispatcher = dispatcherFor(proxyServer);
      if (request.operationId === 'people.registration_evidence.observe@1') {
        exact(
          request.input,
          ['providerIdentity'],
          'PLATFORM_TMDB_PERSON_AVATAR_SHAPE',
        );
        const resolved = request.input.providerIdentity;
        if (resolved?.provider !== 'tmdb' ||
            resolved.namespace !== 'tmdb_person' ||
            typeof resolved.providerKey !== 'string' ||
            !/^[0-9]+$/.test(resolved.providerKey)) {
          fail(
            'PLATFORM_TMDB_PERSON_IDENTITY_INVALID',
            'TMDB Person avatar requires one exact Provider Person identity.',
          );
        }
        const person = await fetchJson(
          snapshot.endpoint,
          snapshot.secretKind,
          secretBytes,
          '/person/' + resolved.providerKey,
          {
            timeoutMs: timeout(request.timeoutMs),
            query: { language },
            proxyServer,
          },
        );
        requireFields(
          person,
          ['id', 'profile_path'],
          'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
        );
        if (String(person.id) !== resolved.providerKey) {
          fail(
            'PLATFORM_TMDB_IDENTITY_MISMATCH',
            'TMDB Person response belongs to a foreign identity.',
          );
        }
        if (person.profile_path === null) {
          return Object.freeze({
            resultKind: 'not_available',
            reasonCode: 'person_avatar_not_available',
            integrationId: snapshot.integrationId,
            configRevision: snapshot.configRevision,
          });
        }
        if (typeof person.profile_path !== 'string' ||
            !/^\/[A-Za-z0-9._-]+$/.test(person.profile_path)) {
          fail(
            'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
            'TMDB Person profile path is invalid.',
          );
        }
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(),
          timeout(request.timeoutMs),
        );
        let imageResponse;
        try {
          imageResponse = await fetchImpl(
            'https://image.tmdb.org/t/p/w185' + person.profile_path,
            {
              headers: {
                accept: 'image/jpeg, image/png, image/webp',
                'user-agent': 'ShelfDeck-Helix/1',
              },
              signal: controller.signal,
              ...(proxyDispatcher
                ? { dispatcher: proxyDispatcher }
                : {}),
            },
          );
        } catch (_error) {
          fail(
            controller.signal.aborted
              ? 'PLATFORM_INTEGRATION_TIMEOUT'
              : 'PLATFORM_INTEGRATION_NETWORK_FAILED',
            controller.signal.aborted
              ? 'TMDB Person avatar request exceeded its bounded timeout.'
              : 'TMDB Person avatar request failed.',
            { stage:'image_request', ...failureDiagnostics(_error), timeout:controller.signal.aborted },
          );
        } finally {
          clearTimeout(timer);
        }
        if (!imageResponse || imageResponse.status < 200 ||
            imageResponse.status > 299) {
          fail(
            'PLATFORM_INTEGRATION_HTTP_FAILED',
            'TMDB Person avatar request was rejected.',
          );
        }
        const mediaType = String(
          imageResponse.headers?.get?.('content-type') || '',
        ).split(';', 1)[0].trim().toLowerCase();
        if (!PERSON_AVATAR_MEDIA_TYPES.has(mediaType)) {
          fail(
            'PLATFORM_TMDB_PERSON_AVATAR_MEDIA_TYPE_INVALID',
            'TMDB Person avatar media type is not allowed.',
          );
        }
        const bytes = await boundedResponseBytes(
          imageResponse,
          PERSON_AVATAR_MAX_BYTES,
        );
        if (!bytes.length) {
          fail(
            'PLATFORM_INTEGRATION_RESPONSE_INVALID',
            'TMDB Person avatar is empty.',
          );
        }
        const result = Object.freeze({
          resultKind: 'acquired',
          integrationId: snapshot.integrationId,
          configRevision: snapshot.configRevision,
          resolvedProviderIdentity: Object.freeze({ ...resolved }),
          mediaType,
          bytes,
          cacheStatus: 'miss',
        });
        cachePersonAvatar(personAvatarCacheKey, result);
        return result;
      }
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
              language,
              page: 1,
            },
            proxyServer,
          },
        );
        validateSearchResponse(result);
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

      if (['libra.product_identity.evidence.observe@1', 'libra.routing.fact.observe@1'].includes(request.operationId) &&
          request.input?.contentProfile === 'series') {
        const input=request.input;
        exact(input,['contentProfile','title','yearHint','strongProviderKey','seasonNumber'],'PLATFORM_TMDB_ROUTING_SHAPE');
        if(typeof input.title!=='string'||!input.title.trim()||input.title.length>512||
            !Number.isSafeInteger(input.seasonNumber)||input.seasonNumber<1||
            (input.yearHint!==null&&(!Number.isSafeInteger(input.yearHint)||input.yearHint<1800||input.yearHint>9999))||
            (input.strongProviderKey!==null&&(typeof input.strongProviderKey!=='string'||!/^\d+$/.test(input.strongProviderKey))))
          fail('PLATFORM_TMDB_ROUTING_INVALID','TMDB Series identity requires a frozen positive Season.');
        let candidates;
        if(input.strongProviderKey!==null)candidates=[{id:input.strongProviderKey}];
        else {
          const search=await fetchJson(snapshot.endpoint,snapshot.secretKind,secretBytes,'/search/tv',{
            timeoutMs:timeout(request.timeoutMs),query:{query:input.title.trim(),include_adult:'false',language,page:1,
              ...(input.yearHint===null?{}:{first_air_date_year:input.yearHint})},proxyServer});
          validateSearchResponse(search,true);
          candidates=search.results.slice(0,10);
        }
        const observed=[];
        for(const candidate of candidates) {
          let show,season;
          try {
            show=await fetchJson(snapshot.endpoint,snapshot.secretKind,secretBytes,'/tv/'+candidate.id,{
              timeoutMs:timeout(request.timeoutMs),query:{language,append_to_response:'alternative_titles,translations'},proxyServer});
            validateMetadataResponse(show,'series');
            if(String(show.id)!==String(candidate.id))fail('PLATFORM_TMDB_IDENTITY_MISMATCH','TMDB Series response belongs to a foreign identity.');
            if(typeof show.name!=='string'||!show.name.trim())fail('PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID','TMDB identity response is not a TV object.');
            season=await fetchJson(snapshot.endpoint,snapshot.secretKind,secretBytes,'/tv/'+candidate.id+'/season/'+input.seasonNumber,{
              timeoutMs:timeout(request.timeoutMs),query:{language},proxyServer});
          } catch(error) {
            if(error.code==='PLATFORM_INTEGRATION_HTTP_FAILED'&&error.details?.statusCode===404)continue;
            throw error;
          }
          validateMetadataResponse(season);
          if(season.season_number!==input.seasonNumber)fail('PLATFORM_TMDB_IDENTITY_MISMATCH','TMDB identity response belongs to a foreign Season.');
          const year=typeof show.first_air_date==='string'&&/^\d{4}/.test(show.first_air_date)?Number(show.first_air_date.slice(0,4)):null;
          observed.push(Object.freeze({providerKey:String(show.id),namespace:'tmdb_series',seasonNumber:input.seasonNumber,
            title:show.name,originalTitle:show.original_name||'',aliases:aliasEvidence(show,'series'),releaseYear:year,
            releaseYears:Object.freeze(year===null?[]:[year]),
            posterUrl:typeof show.poster_path==='string'&&/^\/[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/.test(show.poster_path)?'https://image.tmdb.org/t/p/w342'+show.poster_path:null,
            regionCodes:Object.freeze(Array.isArray(show.origin_country)?[...new Set(show.origin_country.filter(value=>typeof value==='string'))].sort():[]),
            genreCodes:Object.freeze(Array.isArray(show.genres)?show.genres.map(item=>String(item.id)).sort():[])}));
        }
        return Object.freeze(observed);
      }

      if (request.operationId === 'libra.routing.fact.observe@1' ||
          request.operationId === 'libra.product_identity.evidence.observe@1') {
        exact(request.input, ['contentProfile', 'title', 'yearHint', 'strongProviderKey'], 'PLATFORM_TMDB_ROUTING_SHAPE');
        if (request.input.contentProfile !== 'movie' || typeof request.input.title !== 'string' ||
            !request.input.title.trim() || request.input.title.length > 512 ||
            (request.input.yearHint !== null && (!Number.isSafeInteger(request.input.yearHint) || request.input.yearHint < 1800 || request.input.yearHint > 9999)) ||
            (request.input.strongProviderKey !== null && !/^\d+$/.test(request.input.strongProviderKey))) {
          fail('PLATFORM_TMDB_ROUTING_INVALID', 'TMDB Routing observation input is invalid.');
        }
        let result;
        if (request.input.strongProviderKey !== null) {
          let item;
          try {
            item = await fetchJson(snapshot.endpoint, snapshot.secretKind, secretBytes, '/movie/' + request.input.strongProviderKey, {
              timeoutMs: timeout(request.timeoutMs), query: { language, append_to_response:'alternative_titles,translations,release_dates' }, proxyServer,
            });
          } catch (error) {
            if (error.code === 'PLATFORM_INTEGRATION_HTTP_FAILED' && error.details?.statusCode === 404) return Object.freeze([]);
            throw error;
          }
          validateMetadataResponse(item);
          if (String(item.id) !== request.input.strongProviderKey) fail('PLATFORM_TMDB_IDENTITY_MISMATCH', 'TMDB exact response belongs to a foreign identity.');
          result = { results:[item] };
        } else {
          result = await fetchJson(snapshot.endpoint, snapshot.secretKind, secretBytes, '/search/movie', {
            timeoutMs: timeout(request.timeoutMs), query: { query: request.input.title.trim(), include_adult: 'false',
              language, page: 1, ...(request.input.yearHint === null ? {} : { year: request.input.yearHint }) },
            proxyServer,
          });
          validateSearchResponse(result, true);
          const expanded = [];
          for (const candidate of result.results.slice(0, 10)) {
            const detail = await fetchJson(snapshot.endpoint, snapshot.secretKind, secretBytes, '/movie/' + candidate.id, {
              timeoutMs: timeout(request.timeoutMs), query: { language, append_to_response:'alternative_titles,translations,release_dates' },
              proxyServer,
            });
            validateMetadataResponse(detail);
            if (detail.id !== candidate.id) fail('PLATFORM_TMDB_IDENTITY_MISMATCH', 'TMDB candidate detail belongs to a foreign identity.');
            expanded.push(detail);
          }
          result = { results: expanded };
        }
        return Object.freeze(result.results.map((item) => Object.freeze({
          providerKey: String(item.id), title: item.title || '', originalTitle: item.original_title || '',
          aliases: aliasEvidence(item),
          releaseYears: releaseYears(item),
          posterUrl: typeof item.poster_path === 'string' && /^\/[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/.test(item.poster_path) ? 'https://image.tmdb.org/t/p/w342' + item.poster_path : null,
          releaseYear: typeof item.release_date === 'string' && /^\d{4}/.test(item.release_date) ? Number(item.release_date.slice(0, 4)) : null,
          regionCodes: Object.freeze(Array.isArray(item.origin_country) ? [...new Set(item.origin_country.filter((value) => typeof value === 'string'))].sort() : []),
          genreCodes: Object.freeze(Array.isArray(item.genre_ids) ? [...new Set(item.genre_ids.filter(Number.isSafeInteger).map(String))].sort() : []),
        })));
      }

      if(request.operationId==='arca.series_presentation.source.observe@1'&&request.input?.metadataRequest){
        exact(request.input,['metadataRequest'],'PLATFORM_TMDB_SERIES_PRESENTATION_SHAPE');
        const basis=require('../contracts/series-maintenance-basis').assertMaintenanceBasis(request.input.metadataRequest),source=basis.sourceObservation;
        if(source.integrationId!==snapshot.integrationId||source.configRevision!==snapshot.configRevision||source.language!==language)
          fail('PLATFORM_TMDB_SERIES_PRESENTATION_STALE','Shared metadata qualification changed.');
        const body=await fetchJson(snapshot.endpoint,snapshot.secretKind,secretBytes,'/tv/'+source.providerKey,
          {timeoutMs:timeout(request.timeoutMs),query:{language,append_to_response:'credits'},proxyServer});
        validateMetadataResponse(body,'series');
        if(String(body.id)!==source.providerKey)fail('PLATFORM_TMDB_IDENTITY_MISMATCH','Shared metadata belongs to another show.');
        return require('../contracts/series-presentation-basis').buildSeriesPresentationSource({provider:'tmdb',namespace:'tmdb_series',providerKey:source.providerKey,
          seasonIdentityAnchorDigest:source.seasonIdentityAnchorDigest,integrationId:snapshot.integrationId,configRevision:snapshot.configRevision,language,sourceRef:'tmdb:tv:'+source.providerKey,
          title:String(body.name||''),originalTitle:String(body.original_name||''),originalLanguage:String(body.original_language||''),firstAirDate:String(body.first_air_date||''),plot:String(body.overview||''),
          genres:(body.genres||[]).map(item=>item.name).filter(value=>typeof value==='string').sort((a,b)=>Buffer.from(a).compare(Buffer.from(b))),
          cast:(body.credits?.cast||[]).filter(actor=>Number.isSafeInteger(actor.id)&&actor.id>0&&typeof actor.name==='string'&&actor.name).slice(0,64)
            .map((actor,index)=>({providerKey:String(actor.id),name:actor.name,role:typeof actor.character==='string'?actor.character:'',order:Number.isSafeInteger(actor.order)&&actor.order>=0?actor.order:index}))});
      }
      if (request.operationId === 'libra.product_metadata.fetch@1') {
        exact(
          request.input,
          ['resolvedProviderIdentity', 'requestedFields', ...(Object.hasOwn(request.input || {}, 'episodeScope') ? ['episodeScope'] : [])],
          'PLATFORM_TMDB_METADATA_SHAPE',
        );
        const resolved = request.input.resolvedProviderIdentity;
        const namespace = resolved?.namespace;
        if (resolved?.provider !== 'tmdb' ||
            !['tmdb_movie', 'tmdb_series'].includes(namespace) ||
            typeof resolved.providerKey !== 'string' ||
            !/^[0-9]+$/.test(resolved.providerKey) ||
            !Array.isArray(request.input.requestedFields) ||
            request.input.requestedFields.length > 16 ||
            request.input.requestedFields.some((field) =>
              typeof field !== 'string' ||
              !REQUESTED_FIELDS.has(field)) ||
            new Set(request.input.requestedFields).size !==
              request.input.requestedFields.length ||
            JSON.stringify([...request.input.requestedFields].sort()) !==
              JSON.stringify(request.input.requestedFields)) {
          fail(
            'PLATFORM_TMDB_IDENTITY_INVALID',
            'TMDB metadata requires one exact Provider identity.',
          );
        }
        const series = namespace === 'tmdb_series';
        let episodeScope;
        if (Object.hasOwn(request.input, 'episodeScope')) {
          try { episodeScope = buildEpisodeMetadataScope(request.input.episodeScope); }
          catch { fail('PLATFORM_TMDB_IDENTITY_INVALID', 'TMDB metadata Episode scope is invalid.'); }
          if (!series || episodeScope.seasonNumber !== resolved.seasonNumber)
            fail('PLATFORM_TMDB_IDENTITY_INVALID', 'TMDB metadata Episode scope belongs to a foreign Season.');
        }
        if (request.input.requestedFields.some(field => field.startsWith('episode_')) && !episodeScope)
          fail('PLATFORM_TMDB_IDENTITY_INVALID', 'Episode metadata requires an explicit Episode scope.');
        if ((series && (!Number.isSafeInteger(resolved.seasonNumber) ||
            resolved.seasonNumber < 1 || resolved.identityAnchorDigest !== canonicalDigest({
              provider: resolved.provider, namespace, providerKey: resolved.providerKey,
              seasonNumber: resolved.seasonNumber,
            }))) || (!series &&
            request.input.requestedFields.some((field) =>
              field === 'series_title' || field === 'season_number'))) {
          fail('PLATFORM_TMDB_IDENTITY_INVALID',
            'Series metadata requires an explicit positive Season identity.');
        }
        const loadShow = async () => {
          const body = await fetchJson(snapshot.endpoint, snapshot.secretKind, secretBytes,
            '/' + (series ? 'tv' : 'movie') + '/' + resolved.providerKey,
            { timeoutMs: timeout(request.timeoutMs),
              query: { append_to_response: 'credits,alternative_titles,translations', language }, proxyServer });
          validateMetadataResponse(body, series ? 'series' : 'movie');
          if (String(body.id) !== resolved.providerKey)
            fail('PLATFORM_TMDB_IDENTITY_MISMATCH', 'TMDB metadata response belongs to a foreign identity.');
          return body;
        };
        const shared = series ? await seriesMetadata(canonicalDigest({
          integrationId:snapshot.integrationId,configRevision:snapshot.configRevision,endpoint: snapshot.endpoint,
          secretRef: snapshot.secretRef, language, proxyServer: proxyServer || null,
          identity: resolved, timeoutMs: timeout(request.timeoutMs),
        }), async () => {
          const body = await loadShow();
          const season = await fetchJson(snapshot.endpoint, snapshot.secretKind, secretBytes,
            '/tv/' + resolved.providerKey + '/season/' + resolved.seasonNumber,
            { timeoutMs: timeout(request.timeoutMs), query: { language }, proxyServer });
          requireFields(season, ['id', 'season_number'], 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID');
          if (!Number.isSafeInteger(season.id) || season.id < 1 ||
              season.season_number !== resolved.seasonNumber)
            fail('PLATFORM_TMDB_IDENTITY_MISMATCH', 'TMDB Season metadata does not match the resolved Season identity.');
          if (season.episodes !== undefined && !Array.isArray(season.episodes))
            fail('PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID', 'TMDB Season Episodes must be an array.');
          const episodeNumbers = new Set();
          for (const episode of season.episodes || []) {
            requireFields(episode, ['id', 'season_number', 'episode_number'], 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID');
            validateMetadataResponse(episode);
            if (!Number.isSafeInteger(episode.id) || episode.id < 1 ||
                !Number.isSafeInteger(episode.episode_number) || episode.episode_number < 1 ||
                episode.season_number !== resolved.seasonNumber ||
                (episode.show_id !== undefined && String(episode.show_id) !== resolved.providerKey) ||
                episodeNumbers.has(episode.episode_number))
              fail('PLATFORM_TMDB_IDENTITY_MISMATCH', 'TMDB Season Episode identities are invalid or duplicated.');
            episodeNumbers.add(episode.episode_number);
          }
          return { body, season };
        }) : null;
        const body = shared ? shared.body : await loadShow();
        const requested = new Set(request.input.requestedFields);
        const values = new Map();
        const title = series ? body.name : body.title;
        const releaseDate = series
          ? body.first_air_date
          : body.release_date;
        if (title) values.set('title', String(title));
        if (series) {
          if (title) values.set('series_title', String(title));
          const season = shared.season;
          values.set('season_number', season.season_number);
          if (episodeScope) {
            const matches = (season.episodes || []).filter(item => item?.episode_number === episodeScope.episodeNumber);
            if (matches.length > 1)
              fail('PLATFORM_TMDB_IDENTITY_MISMATCH', 'TMDB Season contains duplicate requested Episodes.');
            let episode = matches[0];
            if (episode) {
              requireFields(episode, ['id', 'season_number', 'episode_number'], 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID');
              validateMetadataResponse(episode);
              if (!Number.isSafeInteger(episode.id) || episode.id < 1 ||
                  episode.season_number !== resolved.seasonNumber ||
                  (episode.show_id !== undefined && String(episode.show_id) !== resolved.providerKey))
                fail('PLATFORM_TMDB_IDENTITY_MISMATCH', 'TMDB Season Episode belongs to a foreign identity.');
            }
            // Missing requested data may be supplemented only from the same exact
            // Provider Episode, never from another Episode or the Series synopsis.
            if (!episode || (requested.has('episode_title') && !episode.name) ||
                (requested.has('episode_plot') && !episode.overview)) {
              const detail = await fetchJson(snapshot.endpoint, snapshot.secretKind, secretBytes,
                '/tv/' + resolved.providerKey + '/season/' + resolved.seasonNumber + '/episode/' + episodeScope.episodeNumber,
                { timeoutMs: timeout(request.timeoutMs), query: { language }, proxyServer });
              if (episode && detail.id !== episode.id)
                fail('PLATFORM_TMDB_IDENTITY_MISMATCH', 'TMDB Episode detail differs from its Season member.');
              episode = detail;
            }
            requireFields(episode, ['id', 'season_number', 'episode_number'], 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID');
            validateMetadataResponse(episode);
            if (!Number.isSafeInteger(episode.id) || episode.id < 1 ||
                episode.season_number !== episodeScope.seasonNumber || episode.episode_number !== episodeScope.episodeNumber)
              fail('PLATFORM_TMDB_IDENTITY_MISMATCH', 'TMDB Episode response does not match the frozen Episode scope.');
            values.set('episode_number', episode.episode_number);
            if (episode.name) values.set('episode_title', episode.name);
            if (episode.overview) values.set('episode_plot', episode.overview);
          }
        }
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
            ':' + resolved.providerKey + (series ? ':season:' + resolved.seasonNumber : '') +
            (episodeScope ? ':episode:' + episodeScope.episodeNumber : ''),
          ...(episodeScope ? { episodeScope } : {}),
          ...(series&&!episodeScope?{seriesPresentationSource:require('../contracts/series-presentation-basis').buildSeriesPresentationSource({
            provider:'tmdb',namespace:'tmdb_series',providerKey:resolved.providerKey,seasonIdentityAnchorDigest:resolved.identityAnchorDigest,
            integrationId:snapshot.integrationId,configRevision:snapshot.configRevision,language,sourceRef:'tmdb:tv:'+resolved.providerKey,
            title:String(body.name||''),originalTitle:String(body.original_name||''),originalLanguage:String(body.original_language||''),
            firstAirDate:String(body.first_air_date||''),plot:String(body.overview||''),
            cast:(body.credits?.cast||[]).filter(actor=>Number.isSafeInteger(actor.id)&&actor.id>0&&typeof actor.name==='string'&&actor.name).slice(0,64)
              .map((actor,index)=>({providerKey:String(actor.id),name:actor.name,role:typeof actor.character==='string'?actor.character:'',order:Number.isSafeInteger(actor.order)&&actor.order>=0?actor.order:index})),
            genres:(body.genres||[]).map(item=>item.name).filter(value=>typeof value==='string').sort((a,b)=>Buffer.from(a).compare(Buffer.from(b))),
          })}:{}),
          descriptiveEntries: Object.freeze(descriptiveEntries),
          providerIdentities: Object.freeze([
            Object.freeze({ ...resolved }),
          ]),
          peopleHints: Object.freeze(peopleHints),
        });
      }

      const sharedPresentation=['arca.series_presentation.source.observe@1','arca.series_presentation.assets.prepare@1'].includes(request.operationId);
      let artifactInput=request.input;
      if(sharedPresentation){
        const acquire=request.operationId==='arca.series_presentation.assets.prepare@1';
        exact(request.input,['seriesPresentationSource','artifactKind',...(acquire?['imagePath']:[])],'PLATFORM_TMDB_SERIES_PRESENTATION_SHAPE');
        const source=require('../contracts/series-image-source').assertImageSource(request.input.seriesPresentationSource);
        if(source.integrationId!==snapshot.integrationId||source.configRevision!==snapshot.configRevision||
            (acquire&&!/^\/[A-Za-z0-9._-]+$/.test(request.input.imagePath||'')))
          fail('PLATFORM_TMDB_SERIES_PRESENTATION_STALE','Series presentation source no longer matches its exact configuration or image locator.');
        artifactInput={artifactKind:request.input.artifactKind,resolvedProviderIdentity:{provider:'tmdb',namespace:'tmdb_series',providerKey:source.providerKey},
          artifactScope:{scopeKind:'series'}};
      }
      exact(
        artifactInput,
        ['artifactKind', 'resolvedProviderIdentity',...(Object.hasOwn(artifactInput||{},'artifactScope')?['artifactScope']:[])],
        'PLATFORM_TMDB_ARTIFACT_SHAPE',
      );
      const artifactKind = artifactInput.artifactKind;
      const resolved = artifactInput.resolvedProviderIdentity;
      if (!['poster', 'fanart','still'].includes(artifactKind) ||
          resolved?.provider !== 'tmdb' ||
          !['tmdb_movie', 'tmdb_series'].includes(resolved.namespace) ||
          !/^[0-9]+$/.test(resolved.providerKey || '')) {
        fail(
          'PLATFORM_TMDB_ARTIFACT_INVALID',
          'TMDB artifact request is invalid.',
        );
      }
      const series = resolved.namespace === 'tmdb_series';
      const artifactScope=artifactInput.artifactScope;
      if((series&&!artifactScope)||(artifactKind==='still'&&(!series||artifactScope?.scopeKind!=='episode')))
        fail('PLATFORM_TMDB_ARTIFACT_SCOPE_INVALID','Series image retrieval requires its explicit exact image scope.');
      if(artifactScope){
        exact(artifactScope,artifactScope.scopeKind==='series'?['scopeKind']:artifactScope.scopeKind==='season'?['scopeKind','seasonNumber']:
          ['scopeKind','seasonNumber','episodeNumber'],'PLATFORM_TMDB_ARTIFACT_SCOPE_INVALID');
        if(!series||!['series','season','episode'].includes(artifactScope.scopeKind)||
          (artifactScope.scopeKind!=='series'&&(!Number.isSafeInteger(artifactScope.seasonNumber)||artifactScope.seasonNumber<1||artifactScope.seasonNumber!==resolved.seasonNumber))||
          (artifactScope.scopeKind==='episode'&&(!Number.isSafeInteger(artifactScope.episodeNumber)||artifactScope.episodeNumber<1))||
          (artifactScope.scopeKind==='season'&&artifactKind!=='poster')||
          (artifactScope.scopeKind==='episode'&&artifactKind!=='still'))
          fail('PLATFORM_TMDB_ARTIFACT_SCOPE_INVALID','TMDB image role does not match its exact Series scope.');
      }
      const imageSuffix=artifactScope?.scopeKind==='season'?'/season/'+artifactScope.seasonNumber:
        artifactScope?.scopeKind==='episode'?'/season/'+artifactScope.seasonNumber+'/episode/'+artifactScope.episodeNumber:'';
      const exactImagePath=sharedPresentation&&request.operationId==='arca.series_presentation.assets.prepare@1'?request.input.imagePath:null;
      const images = exactImagePath?{}:await fetchJson(
        snapshot.endpoint,
        snapshot.secretKind,
        secretBytes,
        '/' + (series ? 'tv' : 'movie') +
          '/' + resolved.providerKey + imageSuffix + '/images',
        {
          timeoutMs: timeout(request.timeoutMs),
          query: {},
          proxyServer,
        },
      );
      validateImagesResponse(images);
      if(images.id!==undefined&&String(images.id)!==resolved.providerKey&&(!artifactScope||artifactScope.scopeKind==='series'))
        fail('PLATFORM_TMDB_IDENTITY_MISMATCH','TMDB images belong to a foreign Series identity.');
      const collection = artifactScope?.scopeKind==='episode'?images.stills:artifactKind === 'poster'
        ? images.posters
        : images.backdrops;
      const imagePath = exactImagePath||(series?require('../contracts/tmdb-image-selection').selectTmdbImage(collection||[],{
        artifactKind:artifactScope?.scopeKind==='episode'?'still':artifactKind,language,
        originalLanguage:sharedPresentation?request.input.seriesPresentationSource.originalLanguage:null})?.file_path:Array.isArray(collection)
        ? collection.find((item) =>
          typeof item.file_path === 'string')?.file_path
        : undefined);
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
            ...(proxyDispatcher
              ? { dispatcher: proxyDispatcher }
              : {}),
          },
        );
      } catch (_error) {
        fail(
          'PLATFORM_INTEGRATION_NETWORK_FAILED',
          'TMDB image request failed.',
          { stage:'image_request', ...failureDiagnostics(_error), timeout:controller.signal.aborted },
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
      const bytes = await boundedResponseBytes(
        imageResponse,
        ARTIFACT_RESPONSE_MAX_BYTES,
      );
      if (!bytes.length) {
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
        ...(sharedPresentation?{imagePath,sourceDigest:request.input.seriesPresentationSource.qualificationDigest}:{}),
        bytes,
      });
    });
  }

  const observationPort = ExternalProviderObservationPort({
    execute(request) {
      if (['libra.product_artifact.acquire@1',
        'arca.aftercare.binary_artifact.acquire@1','arca.series_presentation.assets.prepare@1'].includes(request?.operationId)) {
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
      if (!['libra.product_artifact.acquire@1',
        'arca.aftercare.binary_artifact.acquire@1','arca.series_presentation.assets.prepare@1'].includes(request?.operationId)) {
        fail(
          'PLATFORM_TMDB_EFFECT_CLASS_MISMATCH',
          'TMDB Artifact port accepts only workspace-write artifact operations.',
        );
      }
      return execute(request);
    },
  });

  async function testCandidate(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        !['endpoint','secretKind','secretBytes','timeoutMs','settings'].every((field) => Object.hasOwn(value, field)) ||
        Object.keys(value).some((field) => !['endpoint','secretKind','secretBytes','timeoutMs','settings'].includes(field))) {
      fail('PLATFORM_TMDB_TEST_SHAPE', 'TMDB test input must match the exact closed shape.');
    }
    if (!Buffer.isBuffer(value.secretBytes) ||
        value.secretBytes.length < 1 || value.secretBytes.length > 4096) {
      fail(
        'PLATFORM_INTEGRATION_CREDENTIAL_INVALID',
        'TMDB credential bytes are invalid.',
      );
    }
    const endpoint = normalizedEndpoint(value.endpoint);
    const timeoutMs = timeout(value.timeoutMs);
    const language = value.settings?.language || 'zh-CN';
    const proxyServer = value.settings?.proxyServer || '';
    if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(language)) fail('PLATFORM_TMDB_TEST_SHAPE', 'TMDB test language is invalid.');
    const configuration = await fetchJson(
      endpoint,
      value.secretKind,
      value.secretBytes,
      '/configuration',
      { timeoutMs, query: {}, proxyServer },
    );
    validateConfigurationResponse(configuration);
    const movie = await fetchJson(
      endpoint,
      value.secretKind,
      value.secretBytes,
      '/movie/550',
      {
        timeoutMs,
        query: { append_to_response: 'credits,alternative_titles,translations', language },
        proxyServer,
      },
    );
    validateMetadataResponse(movie);
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
  validateMetadataResponse,
});
