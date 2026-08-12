'use strict';

const cheerio = require('cheerio');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const {
  canonicalJson,
  createProviderArtifactAdapter,
  createProviderObservationAdapter,
  createProviderRequestAdapter,
} = require('./provider-protocol');
const {
  randomUUID,
  requireIntegrationProfile,
  sha256,
} = require('../platform/public/integration-adapter-support');
const {
  createThePornDbRestClient,
} = require('./theporndb-rest-client');

const JSON_LIMIT = 64 * 1024;
const TEXT_LIMIT = 128 * 1024;
const EXTERNAL_JSON_LIMIT = 2 * 1024 * 1024;
const EXTERNAL_VIDEO_EXTENSIONS = new Set([
  '.avi', '.m2ts', '.m4v', '.mkv', '.mov', '.mp4', '.mpeg', '.mpg',
  '.mts', '.ts', '.webm', '.wmv',
]);
const PROVIDER_ERROR = 'P5_PROVIDER_TRANSPORT_FAILED';

class H1ProviderAdapterError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'H1ProviderAdapterError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new H1ProviderAdapterError(code, message, details);
}

function digest(value) {
  return sha256(value);
}

function exactObject(value, required, optional = [], message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(PROVIDER_ERROR, message);
  }
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (required.some((key) => !Object.hasOwn(value, key)) ||
      keys.some((key) => !allowed.has(key))) {
    fail(PROVIDER_ERROR, message);
  }
  return value;
}

function boundedText(value, maximum, message, options = {}) {
  if (options.optional && (value === undefined || value === null)) {
    return null;
  }
  if (typeof value !== 'string' ||
      (!options.allowEmpty && value.length < 1) ||
      Buffer.byteLength(value, 'utf8') > maximum) {
    fail(PROVIDER_ERROR, message);
  }
  return value;
}

function boundedRows(value, maximum, message) {
  if (!Array.isArray(value) || value.length > maximum) {
    fail(PROVIDER_ERROR, message);
  }
  return value;
}

function frozenRef(objectType, objectId, revision, value) {
  return Object.freeze({
    objectType,
    objectId,
    revision,
    digest: digest(canonicalJson(value)),
  });
}

async function readBounded(response, maximum) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maximum) {
    fail(PROVIDER_ERROR, 'Provider response exceeds its byte bound.');
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    const raw = new Uint8Array(await response.arrayBuffer());
    const bytes = Buffer.from(raw);
    raw.fill(0);
    if (bytes.length > maximum) {
      bytes.fill(0);
      fail(PROVIDER_ERROR, 'Provider response exceeds its byte bound.');
    }
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximum) {
      await reader.cancel().catch(() => {});
      fail(PROVIDER_ERROR, 'Provider response exceeds its byte bound.');
    }
    chunks.push(Buffer.from(value));
    if (value && typeof value.fill === 'function') value.fill(0);
  }
  const combined = Buffer.concat(chunks, total);
  for (const chunk of chunks) chunk.fill(0);
  return combined;
}

async function fetchBytes(fetchImpl, url, init, maximum) {
  let response;
  try {
    response = await fetchImpl(url, init);
  } catch (_error) {
    fail(PROVIDER_ERROR, 'Provider request failed.');
  }
  const bytes = await readBounded(response, maximum);
  if (!response.ok) {
    bytes.fill(0);
    fail(PROVIDER_ERROR, 'Provider returned a non-success response.', {
      statusCode: response.status,
    });
  }
  return Object.freeze({
    bytes,
    contentType: String(response.headers?.get?.('content-type') || ''),
    responseUrl: String(response.url || url),
    statusCode: response.status,
  });
}

async function fetchJson(fetchImpl, url, init, maximum = JSON_LIMIT) {
  const response = await fetchBytes(fetchImpl, url, init, maximum);
  try {
    return JSON.parse(response.bytes.toString('utf8'));
  } catch (_error) {
    fail(PROVIDER_ERROR, 'Provider response is not valid JSON.');
  } finally {
    response.bytes.fill(0);
  }
}

function summary(profile, endpoint, identityNamespace, identityProviderKey,
  observed, now) {
  return Object.freeze({
    capabilityCodes: Object.freeze([...profile.capabilityCodes]),
    endpointDigest: digest(canonicalJson({ endpoint })),
    identityNamespace,
    identityProviderKey,
    observationDigest: digest(canonicalJson(observed)),
    checkedAtMs: now(),
  });
}

function normalized(profile, value) {
  return profile.normalizeEndpoint(value);
}

function bearer(value) {
  return 'Bearer ' + value;
}

function endpointUrl(endpoint, relative) {
  return new URL(
    String(relative).replace(/^\//, ''),
    endpoint.replace(/\/+$/, '') + '/',
  );
}

function parseEmbyLogin(secretBytes) {
  let value;
  try {
    value = JSON.parse(secretBytes.toString('utf8'));
  } catch (_error) {
    fail(
      'PLATFORM_INTEGRATION_CREDENTIAL_INVALID',
      'Emby login credential is invalid.',
    );
  }
  if (!value || Object.keys(value).sort().join(',') !==
      'password,username' ||
      typeof value.username !== 'string' ||
      typeof value.password !== 'string') {
    fail(
      'PLATFORM_INTEGRATION_CREDENTIAL_INVALID',
      'Emby login credential is invalid.',
    );
  }
  return value;
}

function createTestAdapter(profile, options) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now || Date.now;
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('Provider adapter requires fetch.');
  }

  async function tmdb(value) {
    const secret = value.secretBytes.toString('utf8');
    const url = endpointUrl(value.endpoint, 'movie/550');
    const headers = { accept: 'application/json' };
    if (value.secretKind === 'tmdb_api_key') {
      url.searchParams.set('api_key', secret);
    } else {
      headers.authorization = bearer(secret);
    }
    const found = await fetchJson(fetchImpl, url, {
      headers,
      signal: AbortSignal.timeout(value.timeoutMs),
    });
    if (String(found.id) !== '550' ||
        typeof found.title !== 'string') {
      fail(PROVIDER_ERROR, 'TMDB test response is invalid.');
    }
    return summary(
      profile,
      value.endpoint,
      'tmdb_movie',
      '550',
      { id: String(found.id), title: found.title },
      now,
    );
  }

  async function douban(value) {
    const userId = value.settings.userId;
    const url = endpointUrl(
      value.endpoint,
      'people/' + encodeURIComponent(userId) +
        '/collect?start=0&mode=grid&type=movie&sort=time',
    );
    const response = await fetchBytes(fetchImpl, url, {
      headers: {
        accept: 'text/html',
        cookie: value.secretBytes.toString('utf8'),
        'user-agent': 'ShelfDeck/1.0',
      },
      signal: AbortSignal.timeout(value.timeoutMs),
    }, TEXT_LIMIT);
    const text = response.bytes.toString('utf8');
    if (!text.includes('/subject/') &&
        !text.includes('/people/' + userId)) {
      fail(PROVIDER_ERROR, 'Douban test response is invalid.');
    }
    return summary(
      profile,
      value.endpoint,
      'douban_user',
      userId,
      { userId, pageDigest: digest(response.bytes) },
      now,
    );
  }

  async function adult(value) {
    const found = await fetchJson(
      fetchImpl,
      endpointUrl(value.endpoint, 'auth/user'),
      {
      headers: {
        accept: 'application/json',
          authorization: bearer(value.secretBytes.toString('utf8')),
      },
      signal: AbortSignal.timeout(value.timeoutMs),
      },
    );
    if (!found || typeof found !== 'object' || Array.isArray(found) ||
        !Number.isSafeInteger(found.id) ||
        typeof found.name !== 'string' ||
        !found.name.trim()) {
      fail(PROVIDER_ERROR, 'Adult Provider test response is invalid.');
    }
    return summary(
      profile,
      value.endpoint,
      'adult_provider_account',
      String(found.id),
      { accountId: found.id, accountName: found.name.trim() },
      now,
    );
  }

  async function moviepilot(value) {
    const url = endpointUrl(value.endpoint, 'api/v1/download/');
    url.searchParams.set('token', value.secretBytes.toString('utf8'));
    const found = await fetchJson(fetchImpl, url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(value.timeoutMs),
    });
    const list = Array.isArray(found)
      ? found
      : Array.isArray(found?.data)
        ? found.data
        : null;
    if (!list) {
      fail(PROVIDER_ERROR, 'MoviePilot test response is invalid.');
    }
    return summary(
      profile,
      value.endpoint,
      'moviepilot_instance',
      new URL(value.endpoint).host,
      { downloads: list.length },
      now,
    );
  }

  async function emby(value) {
    const login = parseEmbyLogin(value.secretBytes);
    const loginUrl = endpointUrl(
      value.endpoint,
      'Users/AuthenticateByName',
    );
    const authenticated = await fetchJson(fetchImpl, loginUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-emby-authorization':
          'MediaBrowser Client="ShelfDeck", Device="Service", ' +
          'DeviceId="shelfdeck-service", Version="1.0.0"',
      },
      body: canonicalJson({
        Username: login.username,
        Pw: login.password,
      }),
      signal: AbortSignal.timeout(value.timeoutMs),
    });
    if (!authenticated || typeof authenticated !== 'object' ||
        Array.isArray(authenticated) ||
        !authenticated.User ||
        typeof authenticated.User !== 'object' ||
        Array.isArray(authenticated.User)) {
      fail(PROVIDER_ERROR, 'Emby authentication response is invalid.');
    }
    const token = boundedText(String(
      authenticated.AccessToken ||
      authenticated.accessToken ||
      '',
    ).trim(), 4096, 'Emby authentication response is invalid.');
    const userId = boundedText(String(
      authenticated.User?.Id ||
      authenticated.User?.id ||
      '',
    ).trim(), 256, 'Emby authentication response is invalid.');
    const info = await fetchJson(
      fetchImpl,
      endpointUrl(value.endpoint, 'System/Info'),
      {
        headers: {
          accept: 'application/json',
          'x-emby-token': token,
        },
        signal: AbortSignal.timeout(value.timeoutMs),
      },
    );
    if (!info || typeof info !== 'object' || Array.isArray(info)) {
      fail(PROVIDER_ERROR, 'Emby system response is invalid.');
    }
    const serverId = boundedText(String(
      info.Id || info.ServerId || authenticated.ServerId || '',
    ).trim(), 256, 'Emby server identity is missing.');
    boundedText(
      String(info.Version || ''),
      128,
      'Emby system response is invalid.',
    );
    return Object.freeze({
      summary: summary(
        profile,
        value.endpoint,
        'emby_server',
        serverId,
        { serverId, userId, version: String(info.Version || '') },
        now,
      ),
      persistedSecretBytes: Buffer.from(token, 'utf8'),
      persistedSecretKind: 'emby_access_token',
      persistedCredentialKind: 'access_token',
    });
  }

  const implementations = {
    tmdb,
    douban,
    'adult-provider': adult,
    moviepilot,
    emby,
  };
  return Object.freeze({
    normalizedEndpoint(value) {
      return normalized(profile, value);
    },
    testCandidate(value) {
      return implementations[profile.kind](value);
    },
  });
}

function protocolResponse(result) {
  const resultJson = canonicalJson(result);
  return Object.freeze({
    transportRequestId: randomUUID(),
    statusCode: 200,
    responseBytes: Buffer.byteLength(resultJson, 'utf8'),
    responseDigest: digest(resultJson),
    result,
  });
}

function createProtocolTransport(profile, options) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const runtime = options.runtime;
  const now = options.now || Date.now;
  const observationPayloads = new Map();
  const MAX_PENDING_OBSERVATIONS = 200;
  const moviePilotSavePath = typeof options.moviePilotSavePath === 'string' &&
      options.moviePilotSavePath.trim()
    ? options.moviePilotSavePath.trim() : null;
  const moviePilotMappings = Object.freeze([
    ...(options.moviePilotDownloadMappings || []),
    ...(options.moviePilotDownloadRoots || []).map((root) => ({
      providerRoot: root,
      localRoot: root,
    })),
  ].map((item) => {
    if (!item || typeof item.providerRoot !== 'string' ||
        typeof item.localRoot !== 'string' || !item.providerRoot.trim() ||
        !item.localRoot.trim()) {
      fail(PROVIDER_ERROR, 'MoviePilot download path mapping is invalid.');
    }
    return Object.freeze({
      providerRoot: item.providerRoot.replaceAll('\\', '/').replace(/\/+$/, ''),
      localRoot: path.resolve(item.localRoot),
    });
  }));

  function moviePilotLocalPath(providerLocation) {
    if (typeof providerLocation !== 'string' || !providerLocation.trim()) {
      fail(PROVIDER_ERROR, 'MoviePilot output location is absent.');
    }
    const normalized = providerLocation.replaceAll('\\', '/').replace(/\/+$/, '');
    const match = moviePilotMappings.find((item) =>
      normalized === item.providerRoot ||
      normalized.startsWith(item.providerRoot + '/'));
    if (!match) {
      fail(PROVIDER_ERROR,
        'MoviePilot output is outside the configured isolated download roots.');
    }
    const relativeParts = normalized.slice(match.providerRoot.length)
      .replace(/^\/+/, '').split('/').filter(Boolean);
    if (relativeParts.some((part) => part === '.' || part === '..')) {
      fail(PROVIDER_ERROR, 'MoviePilot output path escapes its mapped root.');
    }
    const resolved = path.resolve(match.localRoot, ...relativeParts);
    if (resolved !== match.localRoot &&
        !resolved.startsWith(match.localRoot + path.sep)) {
      fail(PROVIDER_ERROR, 'MoviePilot output path escapes its mapped root.');
    }
    return resolved;
  }

  async function fileSha256(filePath) {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    for await (const chunk of stream) hash.update(chunk);
    return hash.digest('hex');
  }

  function moviePilotMediaFiles(location) {
    const found = [];
    const pending = [location];
    let visited = 0;
    while (pending.length) {
      const currentPath = pending.pop();
      const stat = fs.lstatSync(currentPath);
      if (stat.isSymbolicLink()) {
        fail(PROVIDER_ERROR, 'MoviePilot output contains a symbolic link.');
      }
      if (stat.isFile()) {
        if (EXTERNAL_VIDEO_EXTENSIONS.has(path.extname(currentPath).toLowerCase())) {
          found.push(Object.freeze({ location:currentPath, stat }));
        }
        continue;
      }
      if (!stat.isDirectory()) continue;
      const entries = fs.readdirSync(currentPath, { withFileTypes:true })
        .sort((left, right) => Buffer.compare(
          Buffer.from(left.name, 'utf8'), Buffer.from(right.name, 'utf8')));
      visited += entries.length;
      if (visited > 4096) {
        fail(PROVIDER_ERROR, 'MoviePilot output exceeds the bounded directory scope.');
      }
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        pending.push(path.join(currentPath, entries[index].name));
      }
    }
    if (!found.length || found.length > 256) {
      fail(PROVIDER_ERROR,
        'MoviePilot output does not contain a bounded media file set.');
    }
    return found.sort((left, right) =>
      Number(right.stat.size) - Number(left.stat.size) ||
      Buffer.compare(Buffer.from(left.location, 'utf8'),
        Buffer.from(right.location, 'utf8')));
  }

  function moviePilotIdentityAnchors(observed) {
    const raw = observed || {};
    const providerKey = raw.tmdbid ||
      (['themoviedb', 'tmdb'].includes(String(raw.media_source || '').toLowerCase())
        ? raw.media_id : null);
    if (providerKey === null || providerKey === undefined ||
        !String(providerKey).trim()) return Object.freeze([]);
    const basis = {
      provider: 'tmdb',
      namespace: String(raw.type || '').toLowerCase().includes('tv')
        ? 'tmdb_series' : 'tmdb_movie',
      providerKey: String(providerKey),
      seasonNumber: null,
    };
    if (basis.namespace === 'tmdb_series') {
      const match = String(raw.seasons || '').match(/[0-9]+/);
      if (!match || Number(match[0]) < 1) return Object.freeze([]);
      basis.seasonNumber = Number(match[0]);
    }
    return Object.freeze([Object.freeze({
      ...basis,
      identityAnchorDigest: digest(canonicalJson(basis)),
    })]);
  }

  async function moviePilotOutputSnapshot(value) {
    const local = moviePilotLocalPath(value.providerLocation);
    if (!fs.existsSync(local)) {
      fail(PROVIDER_ERROR, 'MoviePilot output is not visible at its mapped root.');
    }
    const selected = moviePilotMediaFiles(local)[0];
    const checksumHex = await fileSha256(selected.location);
    const memberBasis = {
      ordinal: 0,
      externalMemberId: digest(canonicalJson({
        schema: 'moviepilot.external-member-id@1',
        externalObjectRef: value.externalObjectRef,
        location: selected.location,
        sizeBytes: Number(selected.stat.size),
        checksumHex,
      })),
      relativePath: path.basename(selected.location),
      sizeBytes: Number(selected.stat.size),
      checksumAlgorithm: 'sha256',
      checksumHex,
      episodeClaims: Object.freeze([]),
    };
    const member = Object.freeze({
      ...memberBasis,
      memberDigest: digest(canonicalJson(memberBasis)),
    });
    const members = Object.freeze([member]);
    const identityAnchors = moviePilotIdentityAnchors(value.observed);
    const observedAtMs = now();
    const snapshotBasis = {
      integrationId: value.integrationId,
      configRevision: value.configRevision,
      externalObjectRef: value.externalObjectRef,
      endpointId: 'moviepilot-download-' + digest(canonicalJson({
        location: selected.location,
      })).slice(0, 40),
      location: selected.location,
      structureKind: value.structureKind,
      members,
      identityAnchors,
      ...(typeof value.observed?.title === 'string' && value.observed.title.trim()
        ? { observedTitle:value.observed.title.trim() } : {}),
      ...(Number(value.observed?.year) > 0
        ? { releaseYear:Number(value.observed.year) } : {}),
      observedAtMs,
      newestMutationAtMs: Math.max(0, Math.floor(selected.stat.mtimeMs)),
      memberSetDigest: digest(canonicalJson({
        schema: 'provider-external-material-members@1',
        items: members,
      })),
    };
    snapshotBasis.manifestDigest = digest(canonicalJson({
      schema: 'provider-external-material-manifest@1',
      structureKind: snapshotBasis.structureKind,
      memberSetDigest: snapshotBasis.memberSetDigest,
    }));
    return Object.freeze({
      ...snapshotBasis,
      snapshotDigest: digest(canonicalJson(snapshotBasis)),
    });
  }

  function rememberObservation(reference, observation) {
    if (observationPayloads.size >= MAX_PENDING_OBSERVATIONS) {
      fail(PROVIDER_ERROR, 'Provider observation reader exceeded its bounded in-flight set.');
    }
    observationPayloads.set(reference.digest, observation);
  }

  function readObservation(reference) {
    const value = observationPayloads.get(reference?.digest);
    if (!value) fail(PROVIDER_ERROR, 'Provider observation reference is absent or already consumed.');
    observationPayloads.delete(reference.digest);
    return value;
  }

  function current(request) {
    const snapshot = runtime.readCurrent();
    if (!snapshot ||
        snapshot.integration.integrationId !== request.integrationId ||
        snapshot.integration.integrationType !== request.providerType ||
        snapshot.integration.configRevision !== request.configRevision ||
        snapshot.integration.state !== 'active') {
      fail(PROVIDER_ERROR, 'Provider runtime fence is stale.');
    }
    const endpoint = profile.normalizeEndpoint(
      snapshot.integration.endpoint,
    );
    return Object.freeze({ endpoint, snapshot });
  }

  async function availability(request, state) {
    let value;
    if (profile.kind === 'emby') {
      const info = await fetchJson(
        fetchImpl,
        endpointUrl(state.endpoint, 'System/Info'),
        {
          headers: {
            accept: 'application/json',
            'x-emby-token': request.secretBytes.toString('utf8'),
          },
          signal: AbortSignal.timeout(request.timeoutMs),
        },
      );
      const serverId = boundedText(
        String(info.Id || info.ServerId || '').trim(),
        256,
        'Emby server identity is missing.',
      );
      boundedText(
        String(info.Version || ''),
        128,
        'Emby system response is invalid.',
      );
      value = summary(
        profile,
        state.endpoint,
        'emby_server',
        serverId,
        { serverId, version: String(info.Version || '') },
        now,
      );
    } else {
      const tested = await createTestAdapter(profile, {
        fetchImpl,
        now,
      }).testCandidate({
        endpoint: state.endpoint,
        secretKind: state.snapshot.secret.secretKind,
        secretBytes: request.secretBytes,
        settings: profile.kind === 'douban'
          ? {
              userId:
                state.snapshot.integration.config.lastTestSummary
                  .identityProviderKey,
            }
          : {},
        timeoutMs: request.timeoutMs,
      });
      value = tested.summary || tested;
    }
    return protocolResponse({
      availabilityEvidenceRef: frozenRef(
        'integration_availability',
        profile.integrationId,
        request.configRevision,
        value,
      ),
    });
  }

  async function doubanObservation(request, state) {
    const sourceId = request.input.sourceRef.objectId;
    const configuredUserId =
      state.snapshot.integration.config.lastTestSummary
        .identityProviderKey;
    if (request.input.sourceRef.objectType !== 'perception-source' ||
        sourceId !== configuredUserId) {
      fail(
        PROVIDER_ERROR,
        'Douban source identity does not match the configured user.',
      );
    }
    const cursor = request.input.cursor === null
      ? 0
      : Number(request.input.cursor);
    if (!Number.isSafeInteger(cursor) || cursor < 0) {
      fail(PROVIDER_ERROR, 'Douban cursor is invalid.');
    }
    const url = endpointUrl(
      state.endpoint,
      'people/' + encodeURIComponent(sourceId) +
        '/collect?start=' + cursor + '&mode=grid&type=movie&sort=time',
    );
    const page = await fetchBytes(fetchImpl, url, {
      headers: {
        accept: 'text/html',
        cookie: request.secretBytes.toString('utf8'),
        'user-agent': 'ShelfDeck/1.0',
      },
      signal: AbortSignal.timeout(request.timeoutMs),
    }, TEXT_LIMIT);
    const text = page.bytes.toString('utf8');
    let responseUrl;
    try {
      responseUrl = new URL(page.responseUrl);
    } catch (_error) {
      page.bytes.fill(0);
      fail(PROVIDER_ERROR, 'Douban response URL is invalid.');
    }
    const expectedPath = '/people/' + encodeURIComponent(configuredUserId) +
      '/collect';
    if (responseUrl.origin !== new URL(state.endpoint).origin ||
        responseUrl.pathname.replace(/\/+$/, '') !== expectedPath) {
      page.bytes.fill(0);
      fail(
        PROVIDER_ERROR,
        'Douban response belongs to a foreign source identity.',
      );
    }
    let parsed;
    try {
      parsed = cheerio.load(text);
    } catch (_error) {
      page.bytes.fill(0);
      fail(PROVIDER_ERROR, 'Douban response HTML cannot be parsed.');
    }
    const observations = [];
    const seen = new Set();
    parsed('li.item, div.item, a[href*="/subject/"]').each((_index, element) => {
      if (observations.length >= request.input.limit) return false;
      const item = parsed(element);
      const link = item.is('a[href*="/subject/"]') ? item : item.find('a[href*="/subject/"]').first();
      const match = String(link.attr('href') || '').match(/\/subject\/([0-9]+)\//);
      if (!match || seen.has(match[1])) return undefined;
      const providerKey = match[1];
      seen.add(providerKey);
      const ratingClass = item.find('[class*="rating"][class*="-t"]').toArray()
        .map((node) => String(parsed(node).attr('class') || '').match(/(?:^|\s)rating([1-5])-t(?:\s|$)/))
        .find(Boolean);
      const rating = ratingClass ? Number(ratingClass[1]) : null;
      const title = String(item.find('.title em').first().text() || link.attr('title') || link.text())
        .normalize('NFKC').replace(/\s+/g, ' ').trim();
      if (!title) {
        fail(PROVIDER_ERROR, 'Douban interest title is absent.');
      }
      const descriptiveText = item.find('.intro').text() + ' ' + item.find('.title').text();
      const year = Number(descriptiveText.match(/(?:18|19|20|21)\d{2}/)?.[0] || 0) || null;
      const entries = [
        { key: 'doubanSubjectId', value: providerKey },
        { key: 'rating', value: rating },
        { key: 'ratingScale', value: 'douban_1_5' },
        { key: 'title', value: title },
        { key: 'watched', value: true },
        { key: 'year', value: year },
      ];
      const payloadBody = { schemaRef: 'helix://contracts/types/DoubanInterestObservation/v1', schemaVersion: 1,
        recordKind: 'perception-observation-inline-payload', entries };
      const inlinePayload = Object.freeze({ ...payloadBody, recordDigest: digest(canonicalJson(payloadBody)) });
      const sourceRecordDigest = digest(canonicalJson({ providerKey, rating, title, year, watched: true }));
      const sourceRecordRevision = Number(BigInt('0x' + sourceRecordDigest.slice(0, 12))) + 1;
      const observedAtMs = now();
      const observation = Object.freeze({ observationId: 'douban-observation-' + sourceRecordDigest.slice(0, 40),
        sourceRecordKey: 'douban:' + providerKey, sourceRecordRevision, sourceRecordDigest, observedAtMs,
        payloadSchemaRef: inlinePayload.schemaRef, payloadDigest: digest(canonicalJson(inlinePayload)), inlinePayload,
        provenanceDigest: digest(canonicalJson({ source: 'douban_collect', configuredUserId, providerKey,
          sourceRecordRevision, sourceRecordDigest })) });
      const reference = frozenRef('douban_interest_observation', providerKey, sourceRecordRevision, observation);
      rememberObservation(reference, observation);
      observations.push(Object.freeze({ reference, providerKey }));
      return undefined;
    });
    const nextHref = parsed('.paginator .next a[href]').first().attr('href');
    let nextCursor = null;
    if (nextHref) {
      try {
        const candidate = new URL(nextHref, state.endpoint).searchParams.get('start');
        if (candidate !== null && Number.isSafeInteger(Number(candidate)) && Number(candidate) > cursor) nextCursor = String(Number(candidate));
      } catch (_error) {
        page.bytes.fill(0);
        fail(PROVIDER_ERROR, 'Douban pagination cursor is invalid.');
      }
    }
    const pageDigest = digest(page.bytes);
    page.bytes.fill(0);
    const refs = observations.map((item) => item.reference);
    return protocolResponse({
      resultRefs: refs,
      nextCursor,
    });
  }

  async function metadataReference(request, state) {
    const objectId = request.input.productIdentityRef.objectId;
    let observed;
    if (profile.kind === 'emby') {
      observed = await fetchJson(
        fetchImpl,
        endpointUrl(state.endpoint, 'Items/' + encodeURIComponent(objectId)),
        {
          headers: {
            accept: 'application/json',
            'x-emby-token': request.secretBytes.toString('utf8'),
          },
          signal: AbortSignal.timeout(request.timeoutMs),
        },
      );
      if (!observed || typeof observed !== 'object' ||
          Array.isArray(observed)) {
        fail(PROVIDER_ERROR, 'Emby metadata response is invalid.');
      }
      const observedId = boundedText(
        String(observed.Id || ''),
        256,
        'Emby metadata identity is invalid.',
      );
      if (observedId !== objectId) {
        fail(PROVIDER_ERROR, 'Emby metadata identity is foreign.');
      }
      boundedText(
        observed.Name,
        1024,
        'Emby metadata response is invalid.',
      );
    } else {
      const code = boundedText(
        objectId,
        64,
        'Adult Provider metadata identity is invalid.',
      );
      observed = await createThePornDbRestClient({
        fetchImpl,
        fetchJson,
        endpoint: state.endpoint,
        authorization: bearer(request.secretBytes.toString('utf8')),
        timeoutMs: request.timeoutMs,
        fail(_code, message) {
          fail(PROVIDER_ERROR, message);
        },
      }).readExactJav(code);
    }
    return protocolResponse({
      resultRef: frozenRef(
        profile.kind + '_metadata',
        objectId,
        request.configRevision,
        observed,
      ),
    });
  }

  async function peopleReferences(request, state) {
    const query = request.input.personHintRef.objectId;
    let rows;
    if (profile.kind === 'emby') {
      const found = await fetchJson(
        fetchImpl,
        endpointUrl(state.endpoint, 'Persons/' + encodeURIComponent(query)),
        {
          headers: {
            accept: 'application/json',
            'x-emby-token': request.secretBytes.toString('utf8'),
          },
          signal: AbortSignal.timeout(request.timeoutMs),
        },
      );
      if (!found || typeof found !== 'object' || Array.isArray(found)) {
        fail(PROVIDER_ERROR, 'Emby person response is invalid.');
      }
      rows = [found];
    } else {
      fail(
        'P5_PROVIDER_OPERATION_UNAVAILABLE',
        'Adult Provider performer detail search is outside H1.2.',
      );
    }
    const seen = new Set();
    const refs = rows.slice(0, request.input.limit)
      .map((row) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
          fail(PROVIDER_ERROR, 'Provider person response is invalid.');
        }
        const personId = boundedText(
          String(row.Id || row.id || ''),
          256,
          'Provider person identity is invalid.',
        );
        boundedText(
          String(row.Name || row.name || ''),
          512,
          'Provider person name is invalid.',
        );
        if (seen.has(personId)) {
          fail(PROVIDER_ERROR, 'Provider person response is duplicated.');
        }
        seen.add(personId);
        return frozenRef(
          profile.kind + '_person',
          personId,
          request.configRevision,
          row,
        );
      });
    return protocolResponse({ resultRefs: refs, nextCursor: null });
  }

  async function moviepilotSearchRows(request, state) {
    const term = request.input.acquisitionQuery.queryTerms[0].value;
    const url = endpointUrl(state.endpoint, 'api/v1/search/title');
    url.searchParams.set('token', request.secretBytes.toString('utf8'));
    url.searchParams.set('keyword', term);
    url.searchParams.set('mtype', request.input.acquisitionQuery.contentProfile ===
      'series' ? 'tv' : 'movie');
    const found = await fetchJson(fetchImpl, url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(request.timeoutMs),
    }, EXTERNAL_JSON_LIMIT);
    if (found?.success === false) return Object.freeze([]);
    const rows = (Array.isArray(found)
      ? found
      : Array.isArray(found?.data)
        ? found.data
        : []).filter((row) => row && typeof row === 'object' &&
          !Array.isArray(row) && row.torrent_info &&
          typeof row.torrent_info === 'object');
    return Object.freeze(rows);
  }

  async function moviepilotSearch(request, state) {
    const rows = await moviepilotSearchRows(request, state);
    const candidates = rows.slice(0, request.input.limit)
      .map((row, index) => {
        const rowDigest = digest(canonicalJson(row));
        const providerRef = frozenRef(
          'acquisition_candidate',
          'moviepilot-' + rowDigest.slice(0, 40),
          1,
          row,
        );
        const basis = {
          integrationId: request.integrationId,
          configRevision: request.configRevision,
          providerCandidateRef: providerRef,
          providerRank: index,
          identityAnchors:
            request.input.acquisitionQuery.providerIdentityAnchors,
          structureKind:
            request.input.acquisitionQuery.structureKind,
          episodeKeys:
            request.input.acquisitionQuery.requestedEpisodeKeys,
          availability: 'available',
        };
        const candidateId = digest(canonicalJson({
          schema: 'provider-acquisition-candidate-id@1',
          integrationId: request.integrationId,
          configRevision: request.configRevision,
          providerCandidateRef: providerRef,
        }));
        const ordered = { candidateId, ...basis };
        return Object.freeze({
          ...ordered,
          candidateDigest: digest(canonicalJson(ordered)),
        });
      });
    const queryDigest =
      request.input.acquisitionQuery.queryDigest;
    return protocolResponse({
      queryDigest,
      candidates,
      candidateSetDigest: digest(canonicalJson({
        schema: 'libra.external-acquisition-candidate-set@1',
        queryDigest,
        integrationId: request.integrationId,
        configRevision: request.configRevision,
        items: candidates,
      })),
    });
  }

  async function moviepilotRequest(request, state) {
    const selected =
      request.input.selectedCandidate.selectedCandidate;
    const rows = await moviepilotSearchRows({
      ...request,
      input: {
        acquisitionQuery: request.input.acquisitionQuery,
        limit: 100,
      },
    }, state);
    const selectedRow = rows.find((row) => {
      const reference = frozenRef('acquisition_candidate',
        'moviepilot-' + digest(canonicalJson(row)).slice(0, 40), 1, row);
      return reference.objectId === selected.providerCandidateRef.objectId &&
        reference.digest === selected.providerCandidateRef.digest;
    });
    if (!selectedRow) {
      fail(PROVIDER_ERROR,
        'Selected MoviePilot candidate is no longer exactly resolvable.');
    }
    const url = endpointUrl(state.endpoint, 'api/v1/download/add');
    url.searchParams.set('token', request.secretBytes.toString('utf8'));
    const identity = request.input.acquisitionQuery.providerIdentityAnchors
      .find((item) => item.namespace === 'tmdb_movie' ||
        item.namespace === 'tmdb_series');
    const body = {
      torrent_in: selectedRow.torrent_info,
      ...(identity ? {
        tmdbid: Number(identity.providerKey),
        media_source: 'themoviedb',
        media_id: identity.providerKey,
      } : {}),
      ...(moviePilotSavePath ? { save_path:moviePilotSavePath } : {}),
    };
    const found = await fetchJson(fetchImpl, url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: canonicalJson(body),
      signal: AbortSignal.timeout(request.timeoutMs),
    }, EXTERNAL_JSON_LIMIT);
    if (found?.success !== true) {
      fail(PROVIDER_ERROR, 'MoviePilot rejected the selected download request.');
    }
    const externalJobId = String(
      found?.data?.download_id || found?.data?.id || found?.id ||
      found?.task_id || '',
    );
    if (!externalJobId) {
      fail(PROVIDER_ERROR, 'MoviePilot request receipt is invalid.');
    }
    return protocolResponse({
      externalJobReceipt: {
        schemaRef:
          'helix://contracts/types/ExternalJobReceipt/v1',
        schemaVersion: 1,
        receiptId: digest(canonicalJson({
          schema: 'moviepilot.external-job-receipt-id@1',
          integrationId: request.integrationId,
          externalJobId,
          requestDigest: request.requestDigest,
        })),
        integrationId: request.integrationId,
        externalJobId,
        operationKind: request.operationId,
        idempotencyKey: request.idempotencyKey,
        requestDigest: request.requestDigest,
        configRevision: request.configRevision,
        createdAtMs: now(),
      },
    });
  }

  async function moviepilotTasks(request, state) {
    const url = endpointUrl(state.endpoint, 'api/v1/download/');
    url.searchParams.set('token', request.secretBytes.toString('utf8'));
    const value = await fetchJson(fetchImpl, url, {
      headers: { accept:'application/json' },
      signal: AbortSignal.timeout(request.timeoutMs),
    }, EXTERNAL_JSON_LIMIT);
    if (!Array.isArray(value)) {
      fail(PROVIDER_ERROR, 'MoviePilot download task response is invalid.');
    }
    return value;
  }

  async function moviepilotHistory(request, state, externalJobId) {
    for (let page = 1; page <= 10; page += 1) {
      const url = endpointUrl(state.endpoint, 'api/v1/history/download');
      url.searchParams.set('token', request.secretBytes.toString('utf8'));
      url.searchParams.set('page', String(page));
      url.searchParams.set('count', '100');
      const rows = await fetchJson(fetchImpl, url, {
        headers: { accept:'application/json' },
        signal: AbortSignal.timeout(request.timeoutMs),
      }, EXTERNAL_JSON_LIMIT);
      if (!Array.isArray(rows)) {
        fail(PROVIDER_ERROR, 'MoviePilot download history response is invalid.');
      }
      const found = rows.find((item) =>
        String(item?.download_hash || '') === externalJobId);
      if (found) return found;
      if (rows.length < 100) break;
    }
    return null;
  }

  async function moviepilotObserve(request, state) {
    const receipt = request.input.externalJobReceipt;
    const tasks = await moviepilotTasks(request, state);
    const task = tasks.find((item) => String(item?.hash || '') ===
      receipt.externalJobId) || null;
    const history = await moviepilotHistory(request, state,
      receipt.externalJobId);
    const revision = Math.max(1, Math.floor(now()));
    const pending = () => {
      const basis = {
        externalJobReceiptId: receipt.receiptId,
        requestDigest: receipt.requestDigest,
        providerObservationRevision: revision,
        state: 'pending',
      };
      return Object.freeze({
        ...basis,
        snapshotDigest: digest(canonicalJson(basis)),
      });
    };
    const taskState = String(task?.state || '').toLowerCase();
    const completed = Boolean(task &&
      (Number(task.progress) >= 100 || taskState === 'completed'));
    if (task && !completed) return protocolResponse(pending());
    if (!task && !history) {
      if (now() - receipt.createdAtMs < 10 * 60 * 1000) {
        return protocolResponse(pending());
      }
      const basis = {
        externalJobReceiptId: receipt.receiptId,
        requestDigest: receipt.requestDigest,
        providerObservationRevision: revision,
        state: 'failed',
        reasonCode: 'job_not_found',
      };
      return protocolResponse(Object.freeze({
        ...basis,
        snapshotDigest: digest(canonicalJson(basis)),
      }));
    }
    const observed = history || task?.media || {};
    const providerLocation = String(task?.content_path || task?.path ||
      history?.path || '');
    const outputSnapshot = await moviePilotOutputSnapshot({
      providerLocation,
      externalObjectRef: receipt.externalJobId,
      integrationId: request.integrationId,
      configRevision: request.configRevision,
      structureKind: observed?.type === '电视剧' ||
        String(observed?.type || '').toLowerCase().includes('tv')
        ? 'season' : 'single',
      observed,
    });
    const basis = {
      externalJobReceiptId: receipt.receiptId,
      requestDigest: receipt.requestDigest,
      providerObservationRevision: revision,
      state: 'ready',
      outputSnapshot,
    };
    return protocolResponse(Object.freeze({
      ...basis,
      snapshotDigest: digest(canonicalJson(basis)),
    }));
  }

  async function moviepilotStability(request) {
    const handle = request.input.externalMaterialHandle;
    const outputSnapshot = await moviePilotOutputSnapshot({
      providerLocation: handle.location,
      externalObjectRef: handle.externalObjectRef,
      integrationId: handle.integrationId,
      configRevision: handle.configRevision,
      structureKind: handle.structureKind,
      observed: {
        title: handle.outputSnapshot.observedTitle,
        year: handle.outputSnapshot.releaseYear,
        tmdbid: handle.outputSnapshot.identityAnchors.find((item) =>
          item.namespace === 'tmdb_movie' || item.namespace === 'tmdb_series')
          ?.providerKey,
        type: handle.structureKind === 'season' ? 'tv' : 'movie',
        seasons: handle.outputSnapshot.identityAnchors.find((item) =>
          item.namespace === 'tmdb_series')?.seasonNumber,
      },
    });
    const basis = {
      sourceExternalMaterialHandleId: handle.handleId,
      providerObservationRevision: Math.max(1, Math.floor(now())),
      outputSnapshot,
    };
    return protocolResponse(Object.freeze({
      ...basis,
      snapshotDigest: digest(canonicalJson(basis)),
    }));
  }

  return Object.freeze({
    readObservation,
    async execute(request) {
      const state = current(request);
      if (request.operationId ===
          'shared.integration.availability.observe@1') {
        return availability(request, state);
      }
      if (profile.kind === 'douban' &&
          request.operationId === 'perception.source.acquire@1') {
        return doubanObservation(request, state);
      }
      if (profile.kind === 'moviepilot' &&
          request.operationId === 'libra.external_material.search@1') {
        return moviepilotSearch(request, state);
      }
      if (profile.kind === 'moviepilot' &&
          request.operationId ===
            'libra.external_material.acquire.request@1') {
        return moviepilotRequest(request, state);
      }
      if (profile.kind === 'moviepilot' &&
          request.operationId ===
            'libra.external_material.acquire.observe@1') {
        return moviepilotObserve(request, state);
      }
      if (profile.kind === 'moviepilot' &&
          request.operationId ===
            'libra.external_material.stability.observe@1') {
        return moviepilotStability(request, state);
      }
      if (profile.kind === 'emby' &&
          request.operationId ===
            'people.registration_evidence.observe@1') {
        return peopleReferences(request, state);
      }
      if (['emby', 'adult-provider'].includes(profile.kind) &&
          request.operationId === 'libra.product_metadata.fetch@1') {
        return metadataReference(request, state);
      }
      fail(
        'P5_PROVIDER_OPERATION_UNAVAILABLE',
        'Provider operation is not implemented by this H1.2 adapter.',
      );
    },
  });
}

function createProviderAdapter(kind, options) {
  const profile = requireIntegrationProfile(kind);
  const testAdapter = createTestAdapter(profile, options);
  if (!options.runtime) {
    return Object.freeze({ ...testAdapter, profile });
  }
  const transport = createProtocolTransport(profile, options);
  const common = {
    transport,
    secretLeaseBroker: Object.freeze({
      consumeAsync(handle, consumer) {
        const snapshot = options.runtime.readCurrent();
        if (!snapshot ||
            snapshot.integration.integrationId !==
              handle.ownerScopeId ||
            snapshot.integration.configRevision !==
              handle.revision ||
            snapshot.secret.secretRef !== handle.secretRef ||
            snapshot.secret.secretKind !== handle.secretKind) {
          fail(
            'P5_PROVIDER_RUNTIME_FENCE_MISMATCH',
            'Provider runtime changed before Secret consumption.',
          );
        }
        return options.runtime.broker.consumeAsync(handle, consumer);
      },
    }),
    timeoutController: Object.freeze({
      async run(promise, timeoutMs) {
        let timer;
        try {
          return await Promise.race([
            promise,
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(new Error('provider timeout')),
                timeoutMs,
              );
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      },
    }),
    now: options.now || Date.now,
    digest,
  };
  return Object.freeze({
    ...testAdapter,
    artifactPort: createProviderArtifactAdapter(common),
    observationPort: createProviderObservationAdapter(common),
    observationReader: Object.freeze({ read: (reference) => transport.readObservation(reference) }),
    profile,
    requestPort: createProviderRequestAdapter(common),
  });
}

module.exports = Object.freeze({
  H1ProviderAdapterError,
  createProviderAdapter,
  fetchBytes,
  fetchJson,
});
