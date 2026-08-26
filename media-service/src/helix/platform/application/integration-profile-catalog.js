'use strict';

const OPERATION_CATALOG =
  require('../../contracts/ports/p5-provider-operation-contracts.json');
const { settings: moviePilotLandingSettings } =
  require('./moviepilot-landing-binding');

const SHA256 = /^[0-9a-f]{64}$/;
const TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]*$/;

class IntegrationProfileError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'IntegrationProfileError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new IntegrationProfileError(code, message, details);
}

function exact(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(
      'PLATFORM_INTEGRATION_CREDENTIAL_SHAPE',
      'Integration credential must be a JSON object.',
    );
  }
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (required.some((key) => !Object.hasOwn(value, key)) ||
      keys.some((key) => !allowed.has(key))) {
    fail(
      'PLATFORM_INTEGRATION_CREDENTIAL_SHAPE',
      'Integration credential must match its exact closed shape.',
    );
  }
}

function boundedString(value, field, minimum = 1, maximum = 4096) {
  if (typeof value !== 'string' ||
      value.length < minimum ||
      value.length > maximum) {
    fail(
      'PLATFORM_INTEGRATION_CREDENTIAL_INVALID',
      'Integration credential field is invalid.',
      { field },
    );
  }
  return value;
}

function normalizedUrl(value, options = {}) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_error) {
    fail(
      'PLATFORM_INTEGRATION_ENDPOINT_INVALID',
      'Integration endpoint is not a valid URL.',
    );
  }
  if (parsed.username || parsed.password ||
      parsed.search || parsed.hash) {
    fail(
      'PLATFORM_INTEGRATION_ENDPOINT_INVALID',
      'Integration endpoint cannot contain credentials, query, or fragment.',
    );
  }
  const host = parsed.hostname.toLowerCase();
  const privateHttp = parsed.protocol === 'http:' && (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)
  );
  if (parsed.protocol !== 'https:' &&
      !(options.allowPrivateHttp && privateHttp)) {
    fail(
      'PLATFORM_INTEGRATION_ENDPOINT_INVALID',
      'Integration endpoint must use HTTPS or an explicit private-loopback HTTP endpoint.',
    );
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return parsed.toString().replace(/\/$/, '');
}

function exactEndpoint(expected) {
  return (value) => {
    const actual = normalizedUrl(value);
    if (actual !== expected) {
      fail(
        'PLATFORM_INTEGRATION_ENDPOINT_INVALID',
        'Integration endpoint is not the accepted official endpoint.',
      );
    }
    return actual;
  };
}

function secret(value, secretKind, credentialKind) {
  return Object.freeze({
    secretKind,
    credentialKind,
    secretBytes: Buffer.from(value, 'utf8'),
    settings: Object.freeze({}),
  });
}

function normalizedProxyServer(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > 2048) {
    fail(
      'PLATFORM_INTEGRATION_CREDENTIAL_INVALID',
      'TMDB proxy server must be an HTTP or HTTPS URL.',
      { field: 'settings.proxyServer' },
    );
  }
  const trimmed = value.trim();
  if (!trimmed) return '';
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (_error) {
    fail(
      'PLATFORM_INTEGRATION_CREDENTIAL_INVALID',
      'TMDB proxy server must be an HTTP or HTTPS URL.',
      { field: 'settings.proxyServer' },
    );
  }
  if (!['http:', 'https:'].includes(parsed.protocol) ||
      !parsed.hostname || parsed.username || parsed.password ||
      parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)) {
    fail(
      'PLATFORM_INTEGRATION_CREDENTIAL_INVALID',
      'TMDB proxy server must be an HTTP or HTTPS origin without credentials.',
      { field: 'settings.proxyServer' },
    );
  }
  return parsed.origin;
}

function tmdbSettings(value) {
  if (value === undefined) {
    return Object.freeze({ language: 'zh-CN', proxyServer: '' });
  }
  exact(value, ['language'], ['proxyServer']);
  if (typeof value.language !== 'string' ||
      !/^[a-z]{2}(?:-[A-Z]{2})?$/.test(value.language)) {
    fail(
      'PLATFORM_INTEGRATION_CREDENTIAL_INVALID',
      'TMDB language must be a language or language-region code.',
      { field: 'settings.language' },
    );
  }
  return Object.freeze({
    language: value.language,
    proxyServer: normalizedProxyServer(value.proxyServer),
  });
}

function tmdbCredential(value, settings) {
  exact(value, ['kind', 'value']);
  const raw = boundedString(value.value, 'credential.value', 8);
  const preparedSettings = tmdbSettings(settings);
  if (value.kind === 'api_key') {
    return Object.freeze({
      ...secret(raw, 'tmdb_api_key', 'api_key'),
      settings: preparedSettings,
    });
  }
  if (value.kind === 'access_token') {
    return Object.freeze({
      ...secret(raw, 'tmdb_access_token', 'access_token'),
      settings: preparedSettings,
    });
  }
  fail(
    'PLATFORM_INTEGRATION_CREDENTIAL_INVALID',
    'TMDB credential kind is invalid.',
  );
}

function doubanCredential(value, settings) {
  exact(value, ['kind', 'value']);
  exact(settings, ['userId']);
  if (value.kind !== 'cookie') {
    fail(
      'PLATFORM_INTEGRATION_CREDENTIAL_INVALID',
      'Douban requires one Cookie credential.',
    );
  }
  const userId = boundedString(settings.userId, 'settings.userId', 1, 128);
  if (!/^[a-zA-Z0-9_-]+$/.test(userId)) {
    fail(
      'PLATFORM_INTEGRATION_CREDENTIAL_INVALID',
      'Douban user identity is invalid.',
    );
  }
  const prepared = secret(
    boundedString(value.value, 'credential.value', 8, 8192),
    'douban_cookie',
    'cookie',
  );
  return Object.freeze({
    ...prepared,
    settings: Object.freeze({ userId }),
  });
}

function tokenCredential(value, settings, definition) {
  if (settings !== undefined) exact(settings, []);
  exact(value, ['kind', 'value']);
  if (value.kind !== definition.credentialKind) {
    fail(
      'PLATFORM_INTEGRATION_CREDENTIAL_INVALID',
      'Integration credential kind is invalid.',
    );
  }
  return secret(
    boundedString(value.value, 'credential.value', 8, 8192),
    definition.secretKind,
    definition.credentialKind,
  );
}

function moviePilotCredential(value, valueSettings) {
  exact(value, ['kind', 'value']);
  if (value.kind !== 'api_key') {
    fail(
      'PLATFORM_INTEGRATION_CREDENTIAL_INVALID',
      'MoviePilot requires one API key credential.',
    );
  }
  const prepared = secret(
    boundedString(value.value, 'credential.value', 8, 8192),
    'moviepilot_api_key',
    'api_key',
  );
  return Object.freeze({
    ...prepared,
    settings: moviePilotLandingSettings(valueSettings),
  });
}

function moviePilotSettings(value){
  if(value===undefined)return Object.freeze({maxDownloadAttempts:3});
  if(!value||typeof value!=='object'||Array.isArray(value))
    fail('PLATFORM_INTEGRATION_CREDENTIAL_SHAPE','MoviePilot settings are invalid.');
  const maxDownloadAttempts=value.maxDownloadAttempts??3;
  if(!Number.isSafeInteger(maxDownloadAttempts)||maxDownloadAttempts<1||maxDownloadAttempts>5)
    fail('PLATFORM_INTEGRATION_CREDENTIAL_INVALID','MoviePilot download attempt limit must be between 1 and 5.',
      {field:'settings.maxDownloadAttempts'});
  return Object.freeze({maxDownloadAttempts});
}

function embyCredential(value, settings) {
  if (settings !== undefined) exact(settings, []);
  exact(value, ['kind', 'username', 'password']);
  if (value.kind !== 'username_password') {
    fail(
      'PLATFORM_INTEGRATION_CREDENTIAL_INVALID',
      'Emby requires one-time username/password authentication.',
    );
  }
  const payload = {
    username: boundedString(value.username, 'credential.username', 1, 256),
    password: boundedString(value.password, 'credential.password', 1, 4096),
  };
  return Object.freeze({
    secretKind: 'emby_login',
    credentialKind: 'username_password',
    secretBytes: Buffer.from(JSON.stringify(payload), 'utf8'),
    settings: Object.freeze({}),
  });
}

function operationsFor(integrationType) {
  return Object.freeze(OPERATION_CATALOG.operations
    .filter((operation) =>
      Object.hasOwn(operation.atoms, integrationType))
    .map((operation) => operation.operationId));
}

function profile(value) {
  return Object.freeze({
    ...value,
    configSchemaRef:
      'helix://implementation-contracts/platform-integrations/' +
      value.kind + '/v1',
    integrationId: value.kind + '-main',
    secretRef: 'integration-secret:' + value.kind + '-main',
    allowedOperations: Object.freeze([
      ...new Set([
        ...operationsFor(value.integrationType),
        ...(value.extraOperations || []),
      ]),
    ]),
  });
}

const PROFILES = Object.freeze([
  profile({
    kind: 'tmdb',
    integrationType: 'tmdb',
    capabilityCodes: Object.freeze(['identity', 'metadata']),
    normalizeEndpoint: exactEndpoint('https://api.themoviedb.org/3'),
    prepareCredential: tmdbCredential,
    normalizeSettings: tmdbSettings,
    acceptedSecretKinds: Object.freeze([
      'tmdb_api_key',
      'tmdb_access_token',
    ]),
    credentialKindsBySecret: Object.freeze({
      tmdb_api_key: 'api_key',
      tmdb_access_token: 'access_token',
    }),
    identityNamespaces: Object.freeze(['tmdb_movie']),
    artifactKinds: Object.freeze(['poster', 'fanart']),
    extraOperations: Object.freeze(['shared.integration.search@1', 'libra.routing.fact.observe@1']),
  }),
  profile({
    kind: 'douban',
    integrationType: 'douban',
    capabilityCodes: Object.freeze(['perception']),
    normalizeEndpoint: exactEndpoint('https://movie.douban.com'),
    prepareCredential: doubanCredential,
    acceptedSecretKinds: Object.freeze(['douban_cookie']),
    credentialKindsBySecret: Object.freeze({
      douban_cookie: 'cookie',
    }),
    identityNamespaces: Object.freeze(['douban_user']),
    artifactKinds: Object.freeze([]),
  }),
  profile({
    kind: 'adult-provider',
    integrationType: 'adult-provider',
    capabilityCodes: Object.freeze([
      'identity',
      'metadata',
      'people',
      'artifact',
    ]),
    normalizeEndpoint:
      exactEndpoint('https://api.theporndb.net'),
    prepareCredential: (value, settings) =>
      tokenCredential(value, settings, {
        credentialKind: 'api_key',
        secretKind: 'adult_provider_api_key',
      }),
    acceptedSecretKinds: Object.freeze([
      'adult_provider_api_key',
    ]),
    credentialKindsBySecret: Object.freeze({
      adult_provider_api_key: 'api_key',
    }),
    identityNamespaces: Object.freeze([
      'adult_provider_account',
      'jav_code',
    ]),
    artifactKinds: Object.freeze(['poster', 'fanart']),
    extraOperations: Object.freeze(['shared.integration.search@1']),
  }),
  profile({
    kind: 'moviepilot',
    integrationType: 'moviepilot',
    capabilityCodes: Object.freeze(['acquisition']),
    normalizeEndpoint: (value) =>
      normalizedUrl(value, { allowPrivateHttp: true }),
    prepareCredential: moviePilotCredential,
    normalizeSettings: moviePilotSettings,
    acceptedSecretKinds: Object.freeze(['moviepilot_api_key']),
    credentialKindsBySecret: Object.freeze({
      moviepilot_api_key: 'api_key',
    }),
    identityNamespaces: Object.freeze(['moviepilot_instance']),
    artifactKinds: Object.freeze([]),
  }),
  profile({
    kind: 'emby',
    integrationType: 'emby',
    capabilityCodes: Object.freeze([
      'identity',
      'metadata',
      'people',
      'artifact',
    ]),
    normalizeEndpoint: (value) =>
      normalizedUrl(value, { allowPrivateHttp: true }),
    prepareCredential: embyCredential,
    acceptedSecretKinds: Object.freeze(['emby_access_token']),
    credentialKindsBySecret: Object.freeze({
      emby_access_token: 'access_token',
    }),
    identityNamespaces: Object.freeze(['emby_server']),
    artifactKinds: Object.freeze(['poster', 'fanart']),
  }),
]);

const BY_KIND = new Map(PROFILES.map((item) => [item.kind, item]));
const BY_ID = new Map(PROFILES.map((item) => [item.integrationId, item]));

function getIntegrationProfile(kind) {
  return BY_KIND.get(kind);
}

function requireIntegrationProfile(kind) {
  const found = getIntegrationProfile(kind);
  if (!found) {
    fail(
      'PLATFORM_INTEGRATION_KIND_UNSUPPORTED',
      'Integration kind is unsupported.',
      { kind },
    );
  }
  return found;
}

function profileForIntegrationId(integrationId) {
  return BY_ID.get(integrationId);
}

function validateSummary(profileValue, value) {
  const keys = [
    'result',
    'checkedAtMs',
    'endpointDigest',
    'observationDigest',
    'identityNamespace',
    'identityProviderKey',
  ];
  if (!value || value.result !== 'passed' ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !==
        JSON.stringify(keys.sort()) ||
      !Number.isSafeInteger(value.checkedAtMs) ||
      value.checkedAtMs < 0 ||
      !SHA256.test(value.endpointDigest || '') ||
      !SHA256.test(value.observationDigest || '') ||
      !profileValue.identityNamespaces.includes(
        value.identityNamespace,
      ) ||
      typeof value.identityProviderKey !== 'string' ||
      value.identityProviderKey.length < 1 ||
      value.identityProviderKey.length > 256 ||
      !TOKEN.test(value.identityProviderKey)) {
    fail(
      'PLATFORM_INTEGRATION_CONFIG_CORRUPT',
      'Integration test summary is invalid.',
    );
  }
}

module.exports = Object.freeze({
  IntegrationProfileError,
  PROFILES,
  SHA256,
  getIntegrationProfile,
  profileForIntegrationId,
  requireIntegrationProfile,
  validateSummary,
});
