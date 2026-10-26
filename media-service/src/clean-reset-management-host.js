'use strict';

const Fastify = require('fastify'), crypto = require('node:crypto');
const { createSessionTokenService, MAX_SESSION_TTL_MS } = require('./helix/platform/public/session-token-service');
const { cookieValue, sessionCookie, clearSessionCookie } = require('./clean-session-cookies');

// A deliberately small transport for an independent stopped Operator. It has
// no business facade, Repository, event supply, or Kernel constructor. The
// Supervisor must provide Platform's generation-bound credential reader.
async function createResetManagementHost({ readCredential, readStatus, retryReset, previewReset, adminDistDir }) {
  if (typeof readCredential !== 'function' || typeof readStatus !== 'function') throw new TypeError('Cold management ports are required.');
  const server = Fastify({ logger: false, trustProxy: false, bodyLimit: 16384 });
  const sessions = createSessionTokenService({ readActiveCredential: readCredential });
  function reject(reply, status, code, message) {
    return reply.code(status).send({ error: { code, message, correlationId: crypto.randomUUID() } });
  }
  function status() {
    const value = readStatus();
    if (value?.desiredMode !== 'stopped' || value.normalSupplyAllowed !== false || !['resetting', 'error', 'stopped'].includes(value.mode))
      throw Object.assign(new Error('Cold status authority is unavailable.'), { code: 'RESET_MANAGEMENT_STATE_INVALID' });
    return value;
  }
  server.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(request.method) && request.headers.origin) {
      let origin;
      try { origin = new URL(request.headers.origin); } catch {}
      if (!origin || !['http:', 'https:'].includes(origin.protocol) || origin.host !== request.headers.host)
        return reject(reply, 403, 'ADMIN_ORIGIN_INVALID', '请求来源无效。');
    }
    if (request.url.split('?')[0] === '/v1/health' && request.method === 'GET') return;
    if (adminDistDir && ['GET', 'HEAD'].includes(request.method) && !request.url.startsWith('/v1/')) return;
    try {
      request.resetActor = request.headers['x-api-key'] ? sessions.verifyApiKey(request.headers['x-api-key']) :
        sessions.verify(cookieValue(request.headers.cookie), Date.now());
    } catch {
      return reject(reply, 401, 'ADMIN_SESSION_INVALID', '请重新登录。');
    }
  });
  server.setErrorHandler((error, _request, reply) => {
    const code = /^[A-Z][A-Z0-9_]{1,100}$/.test(error.code || '') ? error.code : 'RESET_MANAGEMENT_UNAVAILABLE';
    return reject(reply, [400, 401, 403, 409].includes(error.statusCode) ? error.statusCode : 503, code, require('./clean-reset-error-copy').resetErrorMessage(code));
  });
  server.get('/v1/health', async () => ({ status: 'maintenance', normalSupplyAllowed: false, runtimeMode: status().mode }));
  server.get('/v1/admin/runtime', async () => status());
  server.get('/v1/admin/runtime/reset-preview', async (_request, reply) => {
    if (typeof previewReset !== 'function') return reject(reply, 409, 'RESET_COLD_RECOVERY_REQUIRED', '重置尚未完成，系统保持停止。');
    return previewReset();
  });
  server.post('/v1/admin/session', async (request, reply) => {
    if (request.body && (typeof request.body !== 'object' || Array.isArray(request.body) || Object.keys(request.body).some(key => key !== 'ttlMs')))
      return reject(reply, 400, 'ADMIN_SESSION_ISSUE_INVALID', '登录请求无效。');
    const token = sessions.issueAuthenticated({ credentialRevision: request.resetActor.credentialRevision, nowMs: Date.now(),
      ttlMs: request.body?.ttlMs ?? MAX_SESSION_TTL_MS, nonce: crypto.randomUUID() });
    return reply.header('Set-Cookie', sessionCookie(token)).code(204).send();
  });
  server.delete('/v1/admin/session', async (_request, reply) => reply.header('Set-Cookie', clearSessionCookie()).code(204).send());
  server.post('/v1/admin/runtime/actions/reset', async (request, reply) => {
    if (typeof retryReset !== 'function') return reject(reply, 409, 'RESET_COLD_RECOVERY_REQUIRED', '重置尚未完成，系统保持停止。');
    return reply.code(202).send(await retryReset(request.body, request.resetActor));
  });
  if (adminDistDir) await require('./clean-admin-static').registerAdminStatic(server, adminDistDir);
  server.setNotFoundHandler((request, reply) => {
    if (adminDistDir && request.method === 'GET' && !request.url.startsWith('/v1/')) return reply.sendFile('index.html');
    return reject(reply, 503, 'RESET_BUSINESS_DATABASE_CLOSED', '重置期间业务服务不可用，系统保持停止。');
  });
  await server.ready();
  return Object.freeze({ inject: request => server.inject(request), listen: address => server.listen(address), close: () => server.close() });
}

module.exports = Object.freeze({ createResetManagementHost });
