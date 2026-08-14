'use strict';

const { canonicalDigest } = require('../../contracts/canonical-json');

const ACCESS_MODE = 'provider_rw_shelfdeck_ro';
const TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]*$/;

class MoviePilotLandingBindingError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MoviePilotLandingBindingError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new MoviePilotLandingBindingError(code, message, details);
}

function providerRoot(value, field) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 4096) {
    fail('PLATFORM_MOVIEPILOT_LANDING_PATH_INVALID',
      'MoviePilot Landing provider path is invalid.', { field });
  }
  const normalized = value.replaceAll('\\', '/').replace(/\/+$/, '') || '/';
  if (!normalized.startsWith('/') ||
      normalized.split('/').some((part) => part === '..' || part === '.')) {
    fail('PLATFORM_MOVIEPILOT_LANDING_PATH_INVALID',
      'MoviePilot Landing provider path must be canonical and absolute.',
      { field });
  }
  return normalized;
}

function settings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
        'providerOrganizedRoot',
        'providerRequestSaveRoot',
        'shelfDeckVisibleRoot',
      ])) {
    fail('PLATFORM_MOVIEPILOT_LANDING_SETTINGS_SHAPE',
      'MoviePilot Landing settings must match the exact closed shape.');
  }
  if (typeof value.shelfDeckVisibleRoot !== 'string' ||
      value.shelfDeckVisibleRoot.length < 1 ||
      value.shelfDeckVisibleRoot.length > 4096) {
    fail('PLATFORM_MOVIEPILOT_LANDING_PATH_INVALID',
      'MoviePilot Landing local path is invalid.',
      { field: 'shelfDeckVisibleRoot' });
  }
  return Object.freeze({
    providerRequestSaveRoot: providerRoot(
      value.providerRequestSaveRoot, 'providerRequestSaveRoot'),
    providerOrganizedRoot: providerRoot(
      value.providerOrganizedRoot, 'providerOrganizedRoot'),
    shelfDeckVisibleRoot: value.shelfDeckVisibleRoot,
  });
}

function buildMoviePilotLandingBinding(input) {
  const normalized = settings(input.probe?.settings);
  if (!Number.isSafeInteger(input.configRevision) || input.configRevision < 1 ||
      !input.probe || typeof input.probe.deviceId !== 'string' ||
      input.probe.deviceId.length < 1 || input.probe.deviceId.length > 256) {
    fail('PLATFORM_MOVIEPILOT_LANDING_REVISION_INVALID',
      'MoviePilot Landing probe or config revision is invalid.');
  }
  const basis = {
    schemaRef: 'helix://contracts/types/MoviePilotLandingBinding/v1',
    schemaVersion: 1,
    bindingId: canonicalDigest({
      schema: 'platform.moviepilot-landing-binding-id@1',
      integrationId: input.integrationId,
    }),
    bindingRevision: input.configRevision,
    integrationId: input.integrationId,
    configRevision: input.configRevision,
    providerRequestSaveRoot: normalized.providerRequestSaveRoot,
    providerOrganizedRoot: normalized.providerOrganizedRoot,
    shelfDeckVisibleRoot: normalized.shelfDeckVisibleRoot,
    endpointId: 'moviepilot-landing-' + canonicalDigest({
      schema: 'platform.moviepilot-landing-endpoint@1',
      integrationId: input.integrationId,
      providerOrganizedRoot: normalized.providerOrganizedRoot,
      shelfDeckVisibleRoot: normalized.shelfDeckVisibleRoot,
    }).slice(0, 40),
    mountScopeId: canonicalDigest({
      schema: 'platform.moviepilot-landing-mount-scope@1',
      deviceId: input.probe.deviceId,
      shelfDeckVisibleRoot: normalized.shelfDeckVisibleRoot,
    }),
    mountScopeRevision: 1,
    accessMode: ACCESS_MODE,
  };
  return Object.freeze({
    ...basis,
    bindingDigest: canonicalDigest(basis),
  });
}

function assertBinding(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('PLATFORM_MOVIEPILOT_LANDING_BINDING_INVALID',
      'MoviePilot Landing binding is absent.');
  }
  const keys = [
    'accessMode', 'bindingDigest', 'bindingId', 'bindingRevision',
    'configRevision', 'endpointId', 'integrationId', 'mountScopeId',
    'mountScopeRevision', 'providerOrganizedRoot',
    'providerRequestSaveRoot', 'schemaRef', 'schemaVersion',
    'shelfDeckVisibleRoot',
  ];
  if (JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify(keys.sort()) ||
      value.schemaRef !==
        'helix://contracts/types/MoviePilotLandingBinding/v1' ||
      value.schemaVersion !== 1 ||
      !Number.isSafeInteger(value.bindingRevision) ||
      value.bindingRevision < 1 ||
      value.configRevision !== value.bindingRevision ||
      value.mountScopeRevision !== 1 ||
      value.accessMode !== ACCESS_MODE ||
      !TOKEN.test(value.endpointId || '') ||
      !/^[0-9a-f]{64}$/.test(value.bindingId || '') ||
      !/^[0-9a-f]{64}$/.test(value.mountScopeId || '') ||
      !/^[0-9a-f]{64}$/.test(value.bindingDigest || '')) {
    fail('PLATFORM_MOVIEPILOT_LANDING_BINDING_INVALID',
      'MoviePilot Landing binding shape or fence is invalid.');
  }
  settings({
    providerRequestSaveRoot: value.providerRequestSaveRoot,
    providerOrganizedRoot: value.providerOrganizedRoot,
    shelfDeckVisibleRoot: value.shelfDeckVisibleRoot,
  });
  const basis = { ...value };
  delete basis.bindingDigest;
  if (value.bindingId !== canonicalDigest({
    schema: 'platform.moviepilot-landing-binding-id@1',
    integrationId: value.integrationId,
  }) || value.endpointId !== 'moviepilot-landing-' + canonicalDigest({
    schema: 'platform.moviepilot-landing-endpoint@1',
    integrationId: value.integrationId,
    providerOrganizedRoot: value.providerOrganizedRoot,
    shelfDeckVisibleRoot: value.shelfDeckVisibleRoot,
  }).slice(0, 40) || value.bindingDigest !== canonicalDigest(basis)) {
    fail('PLATFORM_MOVIEPILOT_LANDING_BINDING_INVALID',
      'MoviePilot Landing binding identity or digest is invalid.');
  }
  return Object.freeze({ ...value });
}

module.exports = Object.freeze({
  ACCESS_MODE,
  MoviePilotLandingBindingError,
  assertBinding,
  buildMoviePilotLandingBinding,
  providerRoot,
  settings,
});
