'use strict';

const { canonicalDigest } = require('../contracts/canonical-json');
const {
  ExternalProviderArtifactPort,
  ExternalProviderObservationPort,
} = require('./index');

const SUPPORTED_OPERATIONS = new Set([
  'shared.integration.search@1',
  'libra.routing.fact.observe@1',
  'libra.product_identity.evidence.observe@1',
  'libra.product_metadata.fetch@1',
  'libra.product_artifact.acquire@1',
]);
const JSON_RESPONSE_MAX_BYTES = 1024 * 1024;
const ARTIFACT_RESPONSE_MAX_BYTES = 16 * 1024 * 1024;
const REQUESTED_FIELDS = new Set([
  'director',
  'genre',
  'plot',
  'release_date',
  'title',
  'tmdb_movie_id',
  'tmdb_series_id',
  'year_or_release_date',
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

function validateMetadataResponse(value) {
  allowed(
    value,
    ['id'],
    METADATA_FIELDS.filter((field) => field !== 'id'),
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
    allowed(
      value.credits,
      [],
      ['cast', 'crew'],
      'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
    );
    for (const [collectionKind, collection] of [
      ['cast', value.credits.cast || []],
      ['crew', value.credits.crew || []],
    ]) {
      if (!Array.isArray(collection) || collection.length > 256) {
        fail(
          'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
          'TMDB people set exceeds its bound.',
        );
      }
      const identities = new Set();
      for (const item of collection) {
        allowed(
          item,
          ['id', 'name'],
          PERSON_FIELDS.filter((field) =>
            !['id', 'name'].includes(field)),
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
    allowed(value.alternative_titles, ['titles'], [], 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID');
    if (!Array.isArray(value.alternative_titles.titles) || value.alternative_titles.titles.length > 64) {
      fail('PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID', 'TMDB alternative title set exceeds its bound.');
    }
    for (const item of value.alternative_titles.titles) {
      allowed(item, ['title'], ['iso_3166_1', 'type'], 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID');
      boundedString(item.title, 1024, 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID');
      boundedString(item.iso_3166_1, 16, 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID', true);
      boundedString(item.type, 128, 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID', true);
    }
  }
  if (value.translations !== undefined) {
    allowed(value.translations, ['translations'], [], 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID');
    if (!Array.isArray(value.translations.translations) || value.translations.translations.length > 64) {
      fail('PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID', 'TMDB translation set exceeds its bound.');
    }
    for (const item of value.translations.translations) {
      allowed(item, ['data'], ['iso_3166_1', 'iso_639_1', 'name', 'english_name'], 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID');
      allowed(item.data, [], ['title', 'name', 'overview', 'homepage', 'runtime', 'tagline'], 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID');
      boundedString(item.data.title, 1024, 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID', true);
      boundedString(item.data.name, 1024, 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID', true);
      boundedString(item.iso_3166_1, 16, 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID', true);
      boundedString(item.iso_639_1, 16, 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID', true);
    }
  }
}

function aliasEvidence(item) {
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
  for (const alternate of item.alternative_titles?.titles || []) {
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
    return withSavedSecret({
      integrationId: expected.integrationId,
      configRevision: expected.configRevision,
      operationId: request.operationId,
      timeoutMs: timeout(request.timeoutMs),
    }, async (snapshot, secretBytes) => {
      const language = snapshot.settings?.language || 'zh-CN';
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
          const item = await fetchJson(snapshot.endpoint, snapshot.secretKind, secretBytes, '/movie/' + request.input.strongProviderKey, {
            timeoutMs: timeout(request.timeoutMs), query: { language, append_to_response:'alternative_titles,translations' },
          });
          validateMetadataResponse(item); result = { results:[item] };
        } else {
          result = await fetchJson(snapshot.endpoint, snapshot.secretKind, secretBytes, '/search/movie', {
            timeoutMs: timeout(request.timeoutMs), query: { query: request.input.title.trim(), include_adult: 'false',
              language, page: 1, ...(request.input.yearHint === null ? {} : { year: request.input.yearHint }) },
          });
          validateSearchResponse(result, true);
          const expanded = [];
          for (const candidate of result.results.slice(0, 10)) {
            const detail = await fetchJson(snapshot.endpoint, snapshot.secretKind, secretBytes, '/movie/' + candidate.id, {
              timeoutMs: timeout(request.timeoutMs), query: { language, append_to_response:'alternative_titles,translations' },
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
          releaseYear: typeof item.release_date === 'string' && /^\d{4}/.test(item.release_date) ? Number(item.release_date.slice(0, 4)) : null,
          regionCodes: Object.freeze(Array.isArray(item.origin_country) ? [...new Set(item.origin_country.filter((value) => typeof value === 'string'))].sort() : []),
          genreCodes: Object.freeze(Array.isArray(item.genre_ids) ? [...new Set(item.genre_ids.filter(Number.isSafeInteger).map(String))].sort() : []),
        })));
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
            !Array.isArray(request.input.requestedFields) ||
            request.input.requestedFields.length < 1 ||
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
        const body = await fetchJson(
          snapshot.endpoint,
          snapshot.secretKind,
          secretBytes,
          '/' + (series ? 'tv' : 'movie') +
            '/' + resolved.providerKey,
          {
            timeoutMs: timeout(request.timeoutMs),
            query: {
              append_to_response: 'credits,alternative_titles,translations',
              language,
            },
          },
        );
        validateMetadataResponse(body);
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
      validateImagesResponse(images);
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
    if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(language)) fail('PLATFORM_TMDB_TEST_SHAPE', 'TMDB test language is invalid.');
    const configuration = await fetchJson(
      endpoint,
      value.secretKind,
      value.secretBytes,
      '/configuration',
      { timeoutMs, query: {} },
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
});
