'use strict';

const routeRegistry = require('./admin-route-registry');
const { createAdminHttpAdapter } = require('./admin-http-adapter');

const REQUIRED_FACADES = Object.freeze([
  ...new Set(routeRegistry.entries.map((entry) => entry.facade)),
].sort());

class HelixCompositionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'HelixCompositionError';
    this.code = code;
    this.details = details;
  }
}

function createHelixApplication(options = {}) {
  const missing = REQUIRED_FACADES.filter((name) => !options.facades?.[name]);
  if (missing.length || !options.sessionTokens) {
    throw new HelixCompositionError(
      'HELIX_COMPOSITION_INCOMPLETE',
      'Clean Helix composition requires every frozen Facade and Session token service.',
      { missing },
    );
  }

  for (const route of routeRegistry.entries) {
    const method = options.facades[route.facade]?.[route.facadeMethod];
    if (typeof method !== 'function') {
      throw new HelixCompositionError(
        'HELIX_FACADE_METHOD_MISSING',
        'A frozen Admin route has no Facade method.',
        { routeId: route.routeId, facade: route.facade, facadeMethod: route.facadeMethod },
      );
    }
  }

  const adapter = createAdminHttpAdapter({
    facades: options.facades,
    sessionTokens: options.sessionTokens,
  });
  let state = 'created';

  return Object.freeze({
    generation: 'helix-clean-v1',
    routeCount: routeRegistry.entries.length,
    start() {
      if (state !== 'created') {
        throw new HelixCompositionError(
          'HELIX_LIFECYCLE_CONFLICT',
          'Application can start exactly once.',
        );
      }
      state = 'ready';
      return { state, normalSupplyAllowed: true };
    },
    readiness() {
      return Object.freeze({
        state,
        normalSupplyAllowed: state === 'ready',
        generation: 'helix-clean-v1',
      });
    },
    dispatch(request) {
      if (state !== 'ready') {
        throw new HelixCompositionError('HELIX_NOT_READY', 'Application is not ready.');
      }
      return adapter.dispatch(request);
    },
    stop() {
      if (state !== 'stopped') state = 'stopped';
    },
  });
}

module.exports = Object.freeze({
  HelixCompositionError,
  REQUIRED_FACADES,
  createHelixApplication,
});
