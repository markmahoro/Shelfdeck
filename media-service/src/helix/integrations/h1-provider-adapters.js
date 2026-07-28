'use strict';

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
    if (!text.includes(
      '/people/' + encodeURIComponent(configuredUserId),
    )) {
      page.bytes.fill(0);
      fail(
        PROVIDER_ERROR,
        'Douban response belongs to a foreign source identity.',
      );
    }
    const ids = [...text.matchAll(/\/subject\/([0-9]+)\//g)]
      .map((match) => match[1])
      .filter((value, index, values) =>
        values.indexOf(value) === index)
      .slice(0, request.input.limit)
      .sort();
    const pageDigest = digest(page.bytes);
    page.bytes.fill(0);
    const refs = ids.map((id) => frozenRef(
      'douban_interest',
      id,
      1,
      { id, pageDigest },
    ));
    return protocolResponse({
      resultRefs: refs,
      nextCursor: refs.length === request.input.limit
        ? String(cursor + refs.length)
        : null,
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

  async function moviepilotSearch(request, state) {
    const term = request.input.acquisitionQuery.queryTerms[0].value;
    const url = endpointUrl(state.endpoint, 'api/v1/search/title');
    url.searchParams.set('token', request.secretBytes.toString('utf8'));
    url.searchParams.set('keyword', term);
    const found = await fetchJson(fetchImpl, url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(request.timeoutMs),
    });
    const rows = Array.isArray(found)
      ? found
      : Array.isArray(found?.data)
        ? found.data
        : [];
    const candidates = rows.slice(0, request.input.limit)
      .map((row, index) => {
        const providerRef = frozenRef(
          'acquisition_candidate',
          String(row.id || row.hash || row.title || index),
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
    const url = endpointUrl(state.endpoint, 'api/v1/download/add');
    url.searchParams.set('token', request.secretBytes.toString('utf8'));
    const found = await fetchJson(fetchImpl, url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: canonicalJson({
        torrent_in: selected.providerCandidateRef.objectId,
      }),
      signal: AbortSignal.timeout(request.timeoutMs),
    });
    const externalJobId = String(
      found?.data?.id || found?.id || found?.task_id || '',
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

  return Object.freeze({
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
              timer.unref?.();
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
