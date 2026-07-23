'use strict';

const routeRegistry = require('./admin-route-registry');
const { MAX_SESSION_TTL_MS } = require('../platform/public/session-token-service');

function unavailable(route) {
  const workerUnavailable = route.facade === 'PlatformAdminFacade' &&
    route.facadeMethod.includes('workers');
  const code = workerUnavailable
    ? 'REMOTE_WORKER_NOT_AVAILABLE_IN_BETA'
    : 'CLEAN_FACADE_NOT_IMPLEMENTED';
  const message = workerUnavailable
    ? 'ShelfDeck Service Beta不包含Remote Worker。'
    : '该Clean Facade尚未完成Product实现。';
  return async () => ({
    status: workerUnavailable ? 404 : 503,
    body: {
      error: {
        code,
        message,
        details: { routeId: route.routeId },
      },
    },
  });
}

function createCleanFacades(options) {
  if (!options || !options.sessionTokens || !options.readiness) {
    throw new TypeError('Session token and readiness dependencies are required.');
  }
  const facades = {};
  for (const route of routeRegistry.entries) {
    facades[route.facade] ||= {};
    facades[route.facade][route.facadeMethod] ||= unavailable(route);
  }

  facades.HealthFacade.read_health = async () => ({
    body: {
      status: 'ok',
      generation: options.readiness.generation,
      normalSupplyAllowed: true,
    },
  });
  facades.PlatformAdminFacade.post_session = async (input) => {
    const ttlMs = input.body?.ttlMs ?? MAX_SESSION_TTL_MS;
    const token = options.sessionTokens.issueAuthenticated({
      credentialRevision: input.actor.credentialRevision,
      nowMs: input.nowMs,
      ttlMs,
      nonce: options.nonce(),
    });
    return {
      status: 204,
      body: null,
      sessionToken: token,
    };
  };
  facades.PlatformAdminFacade.delete_session = async () => ({
    status: 204,
    body: null,
    clearSession: true,
  });
  facades.PlatformAdminFacade.get_settings_security = async () => {
    const metadata = options.credentialMetadata();
    return {
      body: {
        credentialConfigured: true,
        credentialRevision: metadata.revision,
        createdAtMs: metadata.createdAtMs,
        lastUsedAtMs: metadata.lastUsedAtMs,
      },
    };
  };

  return Object.freeze(Object.fromEntries(
    Object.entries(facades).map(([name, methods]) => [name, Object.freeze(methods)]),
  ));
}

module.exports = Object.freeze({ createCleanFacades });
