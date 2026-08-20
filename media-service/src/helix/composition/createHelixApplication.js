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
  const executionRuntimeHost = options.executionRuntimeHost || null;
  if (executionRuntimeHost &&
      (typeof executionRuntimeHost.start !== 'function' ||
       typeof executionRuntimeHost.stop !== 'function')) {
    throw new HelixCompositionError(
      'HELIX_EXECUTION_RUNTIME_HOST_INVALID',
      'Execution Runtime Host must expose start and stop lifecycle methods.',
    );
  }
  let state = 'created';

  return Object.freeze({
    generation: 'helix-clean-v2',
    routeCount: routeRegistry.entries.length,
    async start() {
      if (state !== 'created') {
        throw new HelixCompositionError(
          'HELIX_LIFECYCLE_CONFLICT',
          'Application can start exactly once.',
        );
      }
      state = 'starting';
      try {
        if (executionRuntimeHost) await executionRuntimeHost.start();
      } catch (error) {
        state = 'failed';
        throw error;
      }
      state = 'ready';
      return { state, normalSupplyAllowed: true };
    },
    readiness() {
      return Object.freeze({
        state,
        normalSupplyAllowed: state === 'ready',
        generation: 'helix-clean-v2',
      });
    },
    dispatch(request) {
      if (state !== 'ready') {
        throw new HelixCompositionError('HELIX_NOT_READY', 'Application is not ready.');
      }
      return adapter.dispatch(request);
    },
    async stop() {
      if (state === 'stopped') return;
      state = 'stopping';
      try {
        if (executionRuntimeHost) await executionRuntimeHost.stop();
      } finally {
        state = 'stopped';
      }
    },
  });
}

module.exports = Object.freeze({
  HelixCompositionError,
  REQUIRED_FACADES,
  createHelixApplication,
});
