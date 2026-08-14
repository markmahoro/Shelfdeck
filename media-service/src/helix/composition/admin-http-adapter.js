'use strict';

const { match } = require('./admin-route-registry');

const mutating = new Set(['POST', 'PATCH', 'DELETE']);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function createAdminHttpAdapter(options) {
  if (!options || !options.facades || !options.sessionTokens) {
    throw new TypeError('Facade and Session token dependencies are required.');
  }
  return Object.freeze({
    async dispatch(request) {
      const route = match(request.method, request.path);
      if (!route) {
        return {
          status: 404,
          body: {
            error: {
              code: 'ROUTE_NOT_FOUND',
              message: '未找到请求入口',
              details: {},
              correlationId: request.correlationId,
            },
          },
        };
      }

      let actor;
      if (route.authentication === 'api_key_exchange') {
        actor = options.sessionTokens.verifyApiKey(request.apiKey);
      } else if (route.authentication === 'admin_session') {
        actor = options.sessionTokens.authenticate({
          apiKey: request.apiKey,
          sessionToken: request.sessionToken,
          nowMs: request.nowMs,
        });
      }
      if (route.sideEffect === 'none' && request.body !== undefined) {
        fail('GET_SIDE_EFFECT_INPUT_REJECTED');
      }
      if (
        mutating.has(route.method) &&
        route.path !== '/v1/admin/session' &&
        !request.body?.idempotencyKey
      ) {
        fail('IDEMPOTENCY_KEY_REQUIRED');
      }
      const facade = options.facades[route.facade];
      if (!facade || typeof facade[route.facadeMethod] !== 'function') {
        fail('FACADE_METHOD_UNAVAILABLE');
      }
      const result = await facade[route.facadeMethod]({
        params: route.params || {},
        query: request.query || {},
        body: request.body,
        actor,
        nowMs: request.nowMs,
        correlationId: request.correlationId,
      });
      return {
        status: result.status || 200,
        body: result.body,
        contentType: result.contentType,
        sessionToken: result.sessionToken,
        clearSession: result.clearSession === true,
      };
    },
  });
}

module.exports = Object.freeze({ createAdminHttpAdapter });
