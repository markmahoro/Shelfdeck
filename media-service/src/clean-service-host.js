'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');
const routeRegistry = require('./helix/composition/admin-route-registry');
const { createHelixApplication } = require('./helix/composition/createHelixApplication');
const { createCleanFacades } = require('./helix/composition/create-clean-facades');
const { createProcurementAdminApplication } = require('./helix/domains/procurement/public/admin-application');
const {
  createArcaRuleTemplateAdminApplication,
  createArcaShelfAdminApplication,
} = require('./helix/domains/arca/public/admin-application');
const { createShelfRoutingTargetProjection } = require('./helix/domains/arca/public/routing-target-projection');
const { createLibraRoutingAdminApplication } = require('./helix/domains/libra/public/admin-application');
const { createSessionTokenService } = require('./helix/platform/public/session-token-service');
const {
  createAdminCredentialRuntime,
} = require('./helix/platform/public/admin-credential-runtime');
const {
  createAdminCredentialRepository,
} = require('./helix/platform/persistence/admin-credential-repository');
const {
  GENERATION,
  SCHEMA_NAME,
  openSqliteKernel,
} = require('./helix/foundation/persistence/sqlite-kernel');
const {
  createSqliteUnitOfWork,
} = require('./helix/foundation/persistence/sqlite-unit-of-work');
const {
  createAdminCredentialSecretStore,
} = require('./admin-credential-secret-store');
const schemaManifest = require('./helix/foundation/persistence/generated/clean-schema.manifest.json');
const routeManifest = require('./helix/contracts/manifests/route-inventory.json');
const uiManifest = require('./helix/contracts/manifests/ui-surface-inventory.json');

const schemaDdl = fs.readFileSync(
  path.join(__dirname, 'helix/foundation/persistence/generated/clean-schema.sql'),
  'utf8',
);
const SESSION_COOKIE = 'shelfdeck_admin_session';
const AUTH_ERROR_CODES = new Set([
  'ADMIN_CREDENTIAL_INVALID',
  'ADMIN_SESSION_INVALID',
  'ADMIN_SESSION_EXPIRED',
]);

class CleanServiceHostError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CleanServiceHostError';
    this.code = code;
    this.details = details;
  }
}

function cookieValue(header, name) {
  for (const item of String(header || '').split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) {
      return decodeURIComponent(item.slice(separator + 1).trim());
    }
  }
  return undefined;
}

function sessionCookie(token) {
  return [
    SESSION_COOKIE,
    '=',
    encodeURIComponent(token),
    '; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800',
  ].join('');
}

function clearSessionCookie() {
  return SESSION_COOKIE + '=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0';
}

function errorResponse(error, correlationId) {
  let status = 500;
  if (AUTH_ERROR_CODES.has(error.code)) status = 401;
  else if (error.code === 'ADMIN_FIELD_NOT_FOUND') status = 404;
  else if (error.code === 'ADMIN_SHELF_NOT_FOUND') status = 404;
  else if (error.code === 'ADMIN_SHELF_COMMAND_REJECTED' || error.code === 'ADMIN_SHELF_TARGET_MISMATCH') status = 400;
  else if (error.code === 'ADMIN_SHELF_IDEMPOTENCY_CONFLICT') status = 409;
  else if (error.code === 'ADMIN_RULE_TEMPLATE_NOT_FOUND') status = 404;
  else if (
    error.code === 'ADMIN_RULE_TEMPLATE_COMMAND_REJECTED' ||
    error.code === 'ADMIN_RULE_TEMPLATE_TARGET_MISMATCH'
  ) status = 400;
  else if (
    error.code === 'ADMIN_RULE_TEMPLATE_CONFLICT' ||
    error.code === 'ADMIN_RULE_TEMPLATE_IDEMPOTENCY_CONFLICT' ||
    error.code === 'SYSTEM_TEMPLATE_IMMUTABLE'
  ) status = 409;
  else if (error.code === 'ADMIN_ROUTING_COMMAND_REJECTED' || error.code === 'ADMIN_ROUTING_TARGET_MISMATCH') status = 400;
  else if (error.code === 'ADMIN_ROUTING_IDEMPOTENCY_CONFLICT') status = 409;
  else if (error.code === 'ADMIN_FIELD_COMMAND_REJECTED' || error.code === 'ADMIN_FIELD_TARGET_MISMATCH') status = 400;
  else if (error.code === 'ADMIN_FIELD_IDEMPOTENCY_CONFLICT') status = 409;
  else if (
    error.code === 'IDEMPOTENCY_KEY_REQUIRED' ||
    error.code === 'GET_SIDE_EFFECT_INPUT_REJECTED' ||
    error.code === 'ADMIN_SESSION_ISSUE_INVALID'
  ) status = 400;
  else if (error.code === 'HELIX_NOT_READY') status = 503;
  const code = status === 500 ? 'CLEAN_SERVICE_INTERNAL_ERROR' : error.code;
  const message = status === 500 ? 'Clean Service请求处理失败。' : error.message;
  return {
    status,
    body: {
      error: {
        code,
        message,
        details: status === 500 ? {} : (error.details || {}),
        correlationId,
      },
    },
  };
}

function createRuntime(options) {
  const findings = [];
  const databasePath = path.join(options.dataDir, 'shelfdeck.db');
  if (!fs.existsSync(databasePath)) findings.push('CLEAN_DATABASE_MISSING');
  if (!fs.existsSync(path.join(options.adminDistDir, 'index.html'))) {
    findings.push('ADMIN_WEB_BUILD_MISSING');
  }
  if (routeManifest.status !== 'active' || routeManifest.entries.length !== 114) {
    findings.push('ROUTE_INVENTORY_INCOMPLETE');
  }
  if (uiManifest.status !== 'active' || uiManifest.entries.length !== 18) {
    findings.push('UI_SURFACE_INVENTORY_INCOMPLETE');
  }
  if (findings.length) {
    return Object.freeze({
      findings: Object.freeze(findings),
      close() {},
    });
  }

  let kernel;
  try {
    kernel = openSqliteKernel({
      Database,
      databasePath,
      schemaDdl,
      schemaManifest,
    });
    const unitOfWork = createSqliteUnitOfWork({ kernel });
    const expected = Object.freeze({
      schemaName: SCHEMA_NAME,
      generation: GENERATION,
      schemaDigest: schemaManifest.ddlDigest,
    });
    const repository = createAdminCredentialRepository({
      schemaManifest,
      unitOfWork,
      expected,
    });
    const secretStore = createAdminCredentialSecretStore({
      dataDir: options.dataDir,
      secretRoot: options.secretRoot,
    });
    const runtime = createAdminCredentialRuntime({
      repository,
      secretStore,
      readinessBasis: Object.freeze({
        findings: Object.freeze([]),
        generation: GENERATION,
        tableCount: schemaManifest.tableCount,
        routeCount: routeManifest.entries.length,
        uiSurfaceCount: uiManifest.entries.length,
      }),
    });
    return Object.freeze({
      runtime,
      applicationDependencies: Object.freeze({ schemaManifest, unitOfWork }),
      findings: Object.freeze([]),
      close: () => kernel.close(),
    });
  } catch (error) {
    kernel?.close();
    return Object.freeze({
      findings: Object.freeze([error.code || 'DATABASE_INTEGRITY_UNAVAILABLE']),
      close() {},
    });
  }
}

function inspectCleanRuntimeReadiness(options) {
  const constructed = createRuntime(options);
  try {
    if (constructed.findings.length) {
      return Object.freeze({ state: 'not_ready', findings: constructed.findings });
    }
    return constructed.runtime.inspectReadiness();
  } finally {
    constructed.close();
  }
}

async function createCleanServiceHost(options) {
  if (!options || typeof options.dataDir !== 'string' || typeof options.adminDistDir !== 'string') {
    throw new TypeError('Clean service data and Admin Web roots are required.');
  }
  const constructed = createRuntime(options);
  if (constructed.findings.length) {
    throw new CleanServiceHostError(
      'CLEAN_SERVICE_NOT_READY',
      'Clean service refuses startup until readiness is complete.',
      { findings: constructed.findings },
    );
  }
  const runtime = constructed.runtime;
  const readiness = runtime.inspectReadiness();
  if (readiness.state !== 'ready') {
    constructed.close();
    throw new CleanServiceHostError(
      'CLEAN_SERVICE_NOT_READY',
      'Clean service refuses startup until readiness is complete.',
      { findings: readiness.findings },
    );
  }
  const sessionTokens = createSessionTokenService({
    readActiveCredential: runtime.readActiveCredential,
  });
  const arcaShelfAdmin = createArcaShelfAdminApplication(constructed.applicationDependencies);
  const arcaRuleTemplateAdmin = createArcaRuleTemplateAdminApplication(
    constructed.applicationDependencies,
  );
  const arcaRoutingTargets = createShelfRoutingTargetProjection(constructed.applicationDependencies);
  const libraRoutingAdmin = createLibraRoutingAdminApplication({
    ...constructed.applicationDependencies,
    readArcaRoutingTargets: arcaRoutingTargets.list,
  });
  const facades = createCleanFacades({
    sessionTokens,
    readiness,
    credentialMetadata: runtime.readActiveCredential,
    procurementAdmin: createProcurementAdminApplication(constructed.applicationDependencies),
    arcaShelfAdmin,
    arcaRuleTemplateAdmin,
    libraRoutingAdmin,
    nonce: crypto.randomUUID,
  });
  const application = createHelixApplication({ facades, sessionTokens });
  application.start();

  const server = Fastify({ logger: false, trustProxy: false });
  await server.register(fastifyStatic, {
    root: path.resolve(options.adminDistDir),
    prefix: '/',
    wildcard: false,
  });
  server.get('/admin', (_request, reply) => reply.sendFile('index.html'));
  server.get('/admin/*', (_request, reply) => reply.sendFile('index.html'));

  for (const route of routeRegistry.entries) {
    server.route({
      method: route.method,
      url: route.path,
      handler: async (request, reply) => {
        const correlationId = request.headers['x-correlation-id'] || crypto.randomUUID();
        let response;
        try {
          response = await application.dispatch({
            method: request.method,
            path: request.url.split('?')[0],
            query: request.query,
            body: request.body,
            apiKey: request.headers['x-api-key'],
            sessionToken: cookieValue(request.headers.cookie, SESSION_COOKIE),
            nowMs: Date.now(),
            correlationId,
          });
        } catch (error) {
          response = errorResponse(error, correlationId);
        }
        if (response.sessionToken) reply.header('set-cookie', sessionCookie(response.sessionToken));
        if (response.clearSession) reply.header('set-cookie', clearSessionCookie());
        reply.code(response.status);
        return response.status === 204 ? reply.send() : response.body;
      },
    });
  }
  try {
    await server.ready();
  } catch (error) {
    application.stop();
    constructed.close();
    throw error;
  }

  let closed = false;
  return Object.freeze({
    generation: application.generation,
    routeCount: application.routeCount,
    readiness: () => application.readiness(),
    inject: (request) => server.inject(request),
    listen: (address) => server.listen(address),
    async close() {
      if (closed) return;
      closed = true;
      application.stop();
      try {
        await server.close();
      } finally {
        constructed.close();
      }
    },
  });
}

module.exports = Object.freeze({
  CleanServiceHostError,
  SESSION_COOKIE,
  createCleanServiceHost,
  inspectCleanRuntimeReadiness,
});
