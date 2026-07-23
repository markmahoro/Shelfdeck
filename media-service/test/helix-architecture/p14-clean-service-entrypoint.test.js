'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { initializeCleanData } = require('../../scripts/helix-operational-safety');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const {
  createCleanServiceHost,
} = require('../../src/clean-service-host');

const serviceRoot = path.resolve(__dirname, '../..');
const secretRoot = 'p14-clean-entrypoint-secret-root-0123456789abcdef';
const roots = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-p14-entry-'));
  roots.push(root);
  const dataDir = path.join(root, 'data');
  const adminDistDir = path.join(root, 'admin');
  fs.mkdirSync(adminDistDir, { recursive: true });
  fs.writeFileSync(
    path.join(adminDistDir, 'index.html'),
    '<!doctype html><html><body><div id="root"></div></body></html>',
  );
  const initialized = initializeCleanData({
    dataDir,
    confirmation: 'INITIALIZE_HELIX_CLEAN_V1',
    secretRoot,
  });
  return { dataDir, adminDistDir, initialized };
}

function dependencyGraph(entry) {
  const visited = new Set();
  const pending = [entry];
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    const source = fs.readFileSync(file, 'utf8');
    for (const found of source.matchAll(/require\((['"])(\.[^'"]+)\1\)/g)) {
      const base = path.resolve(path.dirname(file), found[2]);
      const candidates = [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')];
      const target = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      if (target) pending.push(target);
    }
  }
  return [...visited];
}

async function reservePort() {
  const server = net.createServer();
  server.unref();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForHealth(url, child, stderr) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`service exited before health: ${stderr()}`);
    }
    try {
      const response = await fetch(url);
      if (response.status === 200) return response;
    } catch (_error) {
      // Startup is bounded by the loop.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`service health timeout: ${stderr()}`);
}

test.after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

test('formal server dependency graph reaches only the clean Helix root', () => {
  const serverPath = path.join(serviceRoot, 'src', 'server.js');
  const graph = dependencyGraph(serverPath);
  assert.ok(graph.length > 8);
  for (const file of graph) {
    const relative = path.relative(serviceRoot, file).split(path.sep).join('/');
    assert.ok(
      relative === 'src/server.js' ||
        relative === 'src/clean-service-host.js' ||
        relative === 'src/admin-credential-secret-store.js' ||
        relative.startsWith('src/helix/'),
      `unexpected runtime dependency: ${relative}`,
    );
  }
  const names = graph.map((file) => path.basename(file));
  assert.equal(names.includes('app.js'), false);
  const source = graph.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(
    source,
    /services\/transcodeService|helixRuntimePreflight|all-in-one-supervisor|face-service|19110|ollama/i,
  );
});

test('Libra Routing reads only its exact head and the formal Arca public projection', () => {
  const storeSource = fs.readFileSync(
    path.join(serviceRoot, 'src', 'helix', 'domains', 'libra', 'persistence', 'field-routing-policy-store.js'),
    'utf8',
  );
  const applicationSource = fs.readFileSync(
    path.join(serviceRoot, 'src', 'helix', 'domains', 'libra', 'application', 'routing-admin-facade.js'),
    'utf8',
  );
  const hostSource = fs.readFileSync(path.join(serviceRoot, 'src', 'clean-service-host.js'), 'utf8');
  assert.doesNotMatch(storeSource, /\barca_/);
  assert.doesNotMatch(applicationSource, /persistence\/shelf|arca_shelves|createShelfQueryStore/);
  assert.match(hostSource, /createShelfRoutingTargetProjection/);
  assert.match(storeSource, /find_head:[\s\S]*?keyColumns: \['field_id'\]/);
  assert.match(storeSource, /find_revision:[\s\S]*?keyColumns: \['routing_policy_id', 'revision'\]/);
  assert.doesNotMatch(storeSource, /SELECT\s+|MAX\s*\(|ORDER\s+BY[\s\S]*?DESC/i);
});

test('clean host serves public health and Admin UI, then requires API key or HttpOnly session', async () => {
  const value = fixture();
  const host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
  });
  try {
    assert.equal(host.routeCount, 114);
    const health = await host.inject({ method: 'GET', url: '/v1/health' });
    assert.equal(health.statusCode, 200);
    assert.deepEqual(Object.keys(health.json()).sort(), ['generation', 'normalSupplyAllowed', 'status']);
    assert.doesNotMatch(health.body, /credential|secret|collection/i);

    const admin = await host.inject({ method: 'GET', url: '/admin' });
    assert.equal(admin.statusCode, 200);
    assert.match(admin.body, /id="root"/);

    const unauthorized = await host.inject({ method: 'GET', url: '/v1/admin/overview' });
    assert.equal(unauthorized.statusCode, 401);
    assert.equal(unauthorized.json().error.code, 'ADMIN_SESSION_INVALID');

    const exchange = await host.inject({
      method: 'POST',
      url: '/v1/admin/session',
      headers: { 'x-api-key': value.initialized.adminApiKey },
    });
    assert.equal(exchange.statusCode, 204);
    const cookie = exchange.headers['set-cookie'];
    assert.match(cookie, /shelfdeck_admin_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);

    const security = await host.inject({
      method: 'GET',
      url: '/v1/admin/settings/security',
      headers: { cookie },
    });
    assert.equal(security.statusCode, 200);
    assert.equal(security.json().credentialRevision, 1);

    const apiClient = await host.inject({
      method: 'GET',
      url: '/v1/admin/settings/security',
      headers: { 'x-api-key': value.initialized.adminApiKey },
    });
    assert.equal(apiClient.statusCode, 200);
    assert.equal(apiClient.json().credentialConfigured, true);

    const failClosed = await host.inject({
      method: 'GET',
      url: '/v1/admin/overview',
      headers: { cookie },
    });
    assert.equal(failClosed.statusCode, 503);
    assert.equal(failClosed.json().error.code, 'CLEAN_FACADE_NOT_IMPLEMENTED');

    const legacy = await host.inject({ method: 'GET', url: '/v1/admin/tasks', headers: { cookie } });
    assert.equal(legacy.statusCode, 404);
    const worker = await host.inject({
      method: 'GET',
      url: '/v1/admin/settings/workers',
      headers: { cookie },
    });
    assert.equal(worker.statusCode, 404);
    assert.equal(worker.json().error.code, 'REMOTE_WORKER_NOT_AVAILABLE_IN_BETA');
  } finally {
    await host.close();
  }
});

test('clean host restarts with the same credential and fails closed on readiness or secret mismatch', async () => {
  const value = fixture();
  const first = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
  });
  const exchange = await first.inject({
    method: 'POST',
    url: '/v1/admin/session',
    headers: { 'x-api-key': value.initialized.adminApiKey },
  });
  const cookie = exchange.headers['set-cookie'];
  await first.close();

  const restarted = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
  });
  try {
    const response = await restarted.inject({
      method: 'GET',
      url: '/v1/admin/settings/security',
      headers: { cookie },
    });
    assert.equal(response.statusCode, 200);
  } finally {
    await restarted.close();
  }

  await assert.rejects(
    createCleanServiceHost({
      dataDir: value.dataDir,
      adminDistDir: value.adminDistDir,
      secretRoot: 'different-p14-secret-root-0123456789abcdef',
    }),
    (error) => error.code === 'CLEAN_SERVICE_NOT_READY' &&
      error.details.findings.includes('ADMIN_SECRET_DECRYPTION_FAILED'),
  );
  await assert.rejects(
    createCleanServiceHost({
      dataDir: path.join(path.dirname(value.dataDir), 'missing'),
      adminDistDir: value.adminDistDir,
      secretRoot,
    }),
    (error) => error.code === 'CLEAN_SERVICE_NOT_READY' &&
      error.details.findings.includes('CLEAN_DATABASE_MISSING'),
  );
});

test('Procurement Material Field registration is a real authenticated Owner-local HTTP journey', async () => {
  const value = fixture();
  const policyValue = {
    includedDirectories: ['incoming'], excludedDirectories: [], allowedExtensions: ['.mkv'],
    minimumSizeBytes: 0, excludedMaterialKeys: [],
  };
  const policyBasis = {
    extractionPolicyId: 'policy-http-1', revision: 1, ...policyValue,
  };
  const accessBasis = {
    fieldId: 'field-http-1', revision: 1, endpointId: 'endpoint-http-1', rootLocation: 'incoming',
    mountScopeId: 'mount-http-1', mountScopeRevision: 1, accessSchemaRef: 'helix://fixtures/http-access/v1',
  };
  const body = {
    idempotencyKey: 'field-http-registration-1', fieldId: 'field-http-1', name: 'Incoming HTTP',
    policy: {
      extractionPolicyId: policyBasis.extractionPolicyId, revision: policyBasis.revision,
      policySchemaRef: 'helix://contracts/domain-types/ExtractionPolicy/v1', policy: policyValue,
      policyDigest: canonicalDigest(policyBasis),
    },
    access: { ...accessBasis, accessDigest: canonicalDigest(accessBasis) },
  };
  const host = await createCleanServiceHost({ dataDir: value.dataDir, adminDistDir: value.adminDistDir, secretRoot });
  try {
    const unauthenticated = await host.inject({ method: 'POST', url: '/v1/admin/material-fields', payload: body });
    assert.equal(unauthenticated.statusCode, 401);
    const exchange = await host.inject({ method: 'POST', url: '/v1/admin/session', headers: { 'x-api-key': value.initialized.adminApiKey } });
    const cookie = exchange.headers['set-cookie'];
    const created = await host.inject({ method: 'POST', url: '/v1/admin/material-fields', headers: { cookie }, payload: body });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().materialField.fieldId, 'field-http-1');
    const registrationReplay = await host.inject({ method: 'POST', url: '/v1/admin/material-fields', headers: { cookie }, payload: body });
    assert.equal(registrationReplay.statusCode, 201);
    assert.deepEqual(registrationReplay.json(), created.json());
    const registrationConflict = await host.inject({ method: 'POST', url: '/v1/admin/material-fields', headers: { cookie }, payload: { ...body, name: 'Incoming HTTP changed' } });
    assert.equal(registrationConflict.statusCode, 409);
    assert.equal(registrationConflict.json().error.code, 'ADMIN_FIELD_IDEMPOTENCY_CONFLICT');
    const listed = await host.inject({ method: 'GET', url: '/v1/admin/material-fields', headers: { cookie } });
    assert.equal(listed.statusCode, 200);
    assert.deepEqual(listed.json().items.map((item) => item.fieldId), ['field-http-1']);
    const policyRead = await host.inject({ method: 'GET', url: '/v1/admin/material-fields/field-http-1/extraction-policy', headers: { cookie } });
    assert.equal(policyRead.statusCode, 200);
    assert.equal(policyRead.json().extractionPolicy.revision, 1);
    const accessRevisionBasis = { ...accessBasis, revision: 2, rootLocation: 'incoming-revised', mountScopeRevision: 2 };
    const accessRevision = await host.inject({
      method: 'PATCH', url: '/v1/admin/material-fields/field-http-1', headers: { cookie }, payload: {
        idempotencyKey: 'field-http-access-2', operation: 'revise_access', fieldId: 'field-http-1', expectedAccessRevision: 1,
        access: { ...accessRevisionBasis, accessDigest: canonicalDigest(accessRevisionBasis) },
      },
    });
    assert.equal(accessRevision.statusCode, 200);
    assert.equal(accessRevision.json().materialField.currentAccessRevision, 2);
    const accessTargetMismatch = await host.inject({
      method: 'PATCH', url: '/v1/admin/material-fields/field-http-1', headers: { cookie }, payload: {
        idempotencyKey: 'field-http-access-mismatch', operation: 'revise_access', fieldId: 'field-other', expectedAccessRevision: 2,
        access: { ...accessRevisionBasis, revision: 3, accessDigest: canonicalDigest({ ...accessRevisionBasis, revision: 3 }) },
      },
    });
    assert.equal(accessTargetMismatch.statusCode, 400);
    assert.equal(accessTargetMismatch.json().error.code, 'ADMIN_FIELD_TARGET_MISMATCH');
    const accessReplay = await host.inject({ method: 'PATCH', url: '/v1/admin/material-fields/field-http-1', headers: { cookie }, payload: {
      idempotencyKey: 'field-http-access-2', operation: 'revise_access', fieldId: 'field-http-1', expectedAccessRevision: 1,
      access: { ...accessRevisionBasis, accessDigest: canonicalDigest(accessRevisionBasis) },
    } });
    assert.equal(accessReplay.statusCode, 200);
    assert.equal(accessReplay.json().materialField.currentAccessRevision, 2);
    const policyRevisionValue = { ...policyValue, includedDirectories: ['incoming-revised'] };
    const policyRevisionBasis = { extractionPolicyId: 'policy-http-1', revision: 2, ...policyRevisionValue };
    const policyRevision = await host.inject({
      method: 'PATCH', url: '/v1/admin/material-fields/field-http-1/extraction-policy', headers: { cookie }, payload: {
        idempotencyKey: 'field-http-policy-2', fieldId: 'field-http-1', expectedPolicyId: 'policy-http-1', expectedPolicyRevision: 1,
        policy: {
          extractionPolicyId: 'policy-http-1', revision: 2, policySchemaRef: 'helix://contracts/domain-types/ExtractionPolicy/v1',
          policy: policyRevisionValue, policyDigest: canonicalDigest(policyRevisionBasis),
        },
      },
    });
    assert.equal(policyRevision.statusCode, 200);
    assert.equal(policyRevision.json().materialField.extractionPolicyRevision, 2);
    const policyTargetMismatch = await host.inject({
      method: 'PATCH', url: '/v1/admin/material-fields/field-http-1/extraction-policy', headers: { cookie }, payload: {
        idempotencyKey: 'field-http-policy-mismatch', fieldId: 'field-other', expectedPolicyId: 'policy-http-1', expectedPolicyRevision: 2,
        policy: { ...policyRevision.json().materialField.policy, revision: 3 },
      },
    });
    assert.equal(policyTargetMismatch.statusCode, 400);
    assert.equal(policyTargetMismatch.json().error.code, 'ADMIN_FIELD_TARGET_MISMATCH');
    const deregistered = await host.inject({
      method: 'POST', url: '/v1/admin/material-fields/field-http-1/actions/deregister', headers: { cookie }, payload: {
        idempotencyKey: 'field-http-deregister-1', fieldId: 'field-http-1', expectedAccessRevision: 2, expectedPolicyRevision: 2,
      },
    });
    assert.equal(deregistered.statusCode, 200);
    assert.equal(deregistered.json().materialField.status, 'deregistered');
    const deregisterTargetMismatch = await host.inject({
      method: 'POST', url: '/v1/admin/material-fields/field-http-1/actions/deregister', headers: { cookie }, payload: {
        idempotencyKey: 'field-http-deregister-mismatch', fieldId: 'field-other', expectedAccessRevision: 2, expectedPolicyRevision: 2,
      },
    });
    assert.equal(deregisterTargetMismatch.statusCode, 400);
    assert.equal(deregisterTargetMismatch.json().error.code, 'ADMIN_FIELD_TARGET_MISMATCH');
    const deregisterReplay = await host.inject({
      method: 'POST', url: '/v1/admin/material-fields/field-http-1/actions/deregister', headers: { cookie }, payload: {
        idempotencyKey: 'field-http-deregister-1', fieldId: 'field-http-1', expectedAccessRevision: 2, expectedPolicyRevision: 2,
      },
    });
    assert.equal(deregisterReplay.statusCode, 200);
    assert.equal(deregisterReplay.json().materialField.status, 'deregistered');
    const staleRevision = await host.inject({
      method: 'PATCH', url: '/v1/admin/material-fields/field-http-1', headers: { cookie }, payload: {
        idempotencyKey: 'field-http-access-stale', operation: 'revise_access', fieldId: 'field-http-1', expectedAccessRevision: 2,
        access: { ...accessRevisionBasis, revision: 3, mountScopeRevision: 3, accessDigest: canonicalDigest({ ...accessRevisionBasis, revision: 3, mountScopeRevision: 3 }) },
      },
    });
    assert.equal(staleRevision.statusCode, 400);
  } finally {
    await host.close();
  }
  const restarted = await createCleanServiceHost({ dataDir: value.dataDir, adminDistDir: value.adminDistDir, secretRoot });
  try {
    const exchange = await restarted.inject({ method: 'POST', url: '/v1/admin/session', headers: { 'x-api-key': value.initialized.adminApiKey } });
    const response = await restarted.inject({ method: 'GET', url: '/v1/admin/material-fields/field-http-1', headers: { cookie: exchange.headers['set-cookie'] } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().materialField.access.endpointId, 'endpoint-http-1');
  } finally {
    await restarted.close();
  }
});

test('Arca Shelf projection reads use the authenticated public HTTP path and owner-local query repository', async () => {
  const value = fixture();
  const standardValue = { profileRuleSets: [{ contentProfile: 'movie', mandatoryMedia: [], quality: {}, space: {} }] };
  const placementValue = { folderTemplate: '{title} ({year})', collisionPolicy: 'reject' };
  const body = {
    idempotencyKey: 'shelf-http-create-1', shelfId: 'shelf-http-1', name: 'Movies',
    target: { endpointId: 'shelf-endpoint-1', rootLocation: 'movies', mountScopeId: 'shelf-mount-1', mountScopeRevision: 1 },
    standard: { ruleTemplateId: 'template-http-1', ruleTemplateRevision: 1, schemaRef: 'helix://fixtures/shelf-standard/v1', value: standardValue, digest: canonicalDigest(standardValue) },
    placement: { schemaRef: 'helix://fixtures/placement-policy/v1', value: placementValue, digest: canonicalDigest(placementValue) },
  };
  const host = await createCleanServiceHost({ dataDir: value.dataDir, adminDistDir: value.adminDistDir, secretRoot });
  try {
    const unauthenticated = await host.inject({ method: 'POST', url: '/v1/admin/shelves', payload: body });
    assert.equal(unauthenticated.statusCode, 401);
    const exchange = await host.inject({ method: 'POST', url: '/v1/admin/session', headers: { 'x-api-key': value.initialized.adminApiKey } });
    const cookie = exchange.headers['set-cookie'];
    const created = await host.inject({ method: 'POST', url: '/v1/admin/shelves', headers: { cookie }, payload: body });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().shelf.shelfId, 'shelf-http-1');
    assert.equal(created.json().shelf.currentStandardRevision, 1);
    assert.equal(created.json().shelf.currentPlacementRevision, 1);
    const replay = await host.inject({ method: 'POST', url: '/v1/admin/shelves', headers: { cookie }, payload: body });
    assert.equal(replay.statusCode, 201);
    assert.equal(replay.json().shelf.routingProjection.digest, created.json().shelf.routingProjection.digest);
    const conflict = await host.inject({ method: 'POST', url: '/v1/admin/shelves', headers: { cookie }, payload: { ...body, name: 'Changed' } });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().error.code, 'ADMIN_SHELF_IDEMPOTENCY_CONFLICT');
    const rejected = await host.inject({ method: 'POST', url: '/v1/admin/shelves', headers: { cookie }, payload: {
      ...body, idempotencyKey: 'shelf-http-create-invalid', shelfId: 'shelf-invalid',
      standard: { ...body.standard, digest: '0'.repeat(64) },
    } });
    assert.equal(rejected.statusCode, 400);
    assert.equal(rejected.json().error.code, 'ADMIN_SHELF_COMMAND_REJECTED');
    const standardValue2 = { ...standardValue, profileRuleSets: [{ ...standardValue.profileRuleSets[0], quality: { minimumHeight: 1080 } }] };
    const standardCommand = {
      idempotencyKey: 'shelf-http-standard-2', shelfId: 'shelf-http-1', expectedStandardRevision: 1, expectedRoutingProjectionRevision: 1,
      standard: { ...body.standard, value: standardValue2, digest: canonicalDigest(standardValue2) },
    };
    const standardRevision = await host.inject({ method: 'POST', url: '/v1/admin/shelves/shelf-http-1/actions/bind-template', headers: { cookie }, payload: standardCommand });
    assert.equal(standardRevision.statusCode, 200);
    assert.equal(standardRevision.json().shelf.currentStandardRevision, 2);
    assert.equal(standardRevision.json().shelf.routingProjection.revision, 2);
    const standardReplay = await host.inject({ method: 'POST', url: '/v1/admin/shelves/shelf-http-1/actions/bind-template', headers: { cookie }, payload: standardCommand });
    assert.equal(standardReplay.statusCode, 200);
    assert.equal(standardReplay.json().shelf.standard.digest, canonicalDigest(standardValue2));
    const standardMismatch = await host.inject({ method: 'POST', url: '/v1/admin/shelves/shelf-http-1/actions/bind-template', headers: { cookie }, payload: { ...standardCommand, idempotencyKey: 'standard-target-mismatch', shelfId: 'other-shelf' } });
    assert.equal(standardMismatch.statusCode, 400);
    assert.equal(standardMismatch.json().error.code, 'ADMIN_SHELF_TARGET_MISMATCH');
    const standardStale = await host.inject({ method: 'POST', url: '/v1/admin/shelves/shelf-http-1/actions/bind-template', headers: { cookie }, payload: { ...standardCommand, idempotencyKey: 'standard-stale' } });
    assert.equal(standardStale.statusCode, 400);
    const placementValue2 = { ...placementValue, collisionPolicy: 'suffix' };
    const placementCommand = {
      idempotencyKey: 'shelf-http-placement-2', shelfId: 'shelf-http-1', expectedPlacementRevision: 1,
      placement: { ...body.placement, value: placementValue2, digest: canonicalDigest(placementValue2) },
    };
    const placementRevision = await host.inject({ method: 'PATCH', url: '/v1/admin/shelves/shelf-http-1/placement', headers: { cookie }, payload: placementCommand });
    assert.equal(placementRevision.statusCode, 200);
    assert.equal(placementRevision.json().shelf.currentPlacementRevision, 2);
    const placementReplay = await host.inject({ method: 'PATCH', url: '/v1/admin/shelves/shelf-http-1/placement', headers: { cookie }, payload: placementCommand });
    assert.equal(placementReplay.statusCode, 200);
    const placementConflict = await host.inject({ method: 'PATCH', url: '/v1/admin/shelves/shelf-http-1/placement', headers: { cookie }, payload: { ...placementCommand, placement: { ...placementCommand.placement, value: placementValue } } });
    assert.equal(placementConflict.statusCode, 409);
    const invalidPlacement = await host.inject({ method: 'PATCH', url: '/v1/admin/shelves/shelf-http-1/placement', headers: { cookie }, payload: { ...placementCommand, idempotencyKey: 'placement-invalid', placement: { ...placementCommand.placement, digest: '0'.repeat(64) } } });
    assert.equal(invalidPlacement.statusCode, 400);
    const listed = await host.inject({ method: 'GET', url: '/v1/admin/shelves', headers: { cookie } });
    assert.equal(listed.statusCode, 200);
    assert.deepEqual(listed.json().items.map((item) => item.shelfId), ['shelf-http-1']);
    const exact = await host.inject({ method: 'GET', url: '/v1/admin/shelves/shelf-http-1', headers: { cookie } });
    assert.equal(exact.statusCode, 200);
    assert.equal(exact.json().shelf.standard.digest, canonicalDigest(standardValue2));
    assert.equal(exact.json().shelf.placement.digest, canonicalDigest(placementValue2));
    const currentStandard = await host.inject({ method: 'GET', url: '/v1/admin/shelves/shelf-http-1/standard', headers: { cookie } });
    assert.equal(currentStandard.statusCode, 200);
    assert.equal(currentStandard.json().standard.revision, 2);
    const currentPlacement = await host.inject({ method: 'GET', url: '/v1/admin/shelves/shelf-http-1/placement', headers: { cookie } });
    assert.equal(currentPlacement.statusCode, 200);
    assert.equal(currentPlacement.json().placement.revision, 2);
    const routingPolicy = { routingPolicyId: 'routing-http-1', mode: 'sorting', targets: [
      { shelfId: 'shelf-http-1', rank: 1, matchExpression: { nodeKind: 'always' } },
    ] };
    const unauthenticatedRouting = await host.inject({
      method: 'POST',
      url: '/v1/admin/routing/material-fields/field-http-1/actions/preview',
      payload: { idempotencyKey: 'routing-unauthenticated', fieldId: 'field-http-1', policy: routingPolicy, facts: [] },
    });
    assert.equal(unauthenticatedRouting.statusCode, 401);
    const preview = await host.inject({ method: 'POST', url: '/v1/admin/routing/material-fields/field-http-1/actions/preview', headers: { cookie }, payload: {
      idempotencyKey: 'routing-preview-1', fieldId: 'field-http-1', policy: routingPolicy, facts: [],
    } });
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.json().result, 'resolved');
    assert.equal(preview.json().targetShelfId, 'shelf-http-1');
    assert.equal(preview.json().replayed, false);
    const previewReplay = await host.inject({ method: 'POST', url: '/v1/admin/routing/material-fields/field-http-1/actions/preview', headers: { cookie }, payload: {
      idempotencyKey: 'routing-preview-1', fieldId: 'field-http-1', policy: routingPolicy, facts: [],
    } });
    assert.equal(previewReplay.statusCode, 200);
    assert.equal(previewReplay.json().replayed, true);
    assert.equal(previewReplay.json().previewDigest, preview.json().previewDigest);
    const previewConflict = await host.inject({ method: 'POST', url: '/v1/admin/routing/material-fields/field-http-1/actions/preview', headers: { cookie }, payload: {
      idempotencyKey: 'routing-preview-1', fieldId: 'field-http-1', policy: routingPolicy,
      facts: [{ factKind: 'release_year', year: 2021 }],
    } });
    assert.equal(previewConflict.statusCode, 409);
    const unresolvedPolicy = { routingPolicyId: 'routing-preview-unresolved', mode: 'sorting', targets: [
      { shelfId: 'shelf-http-1', rank: 1, matchExpression: { nodeKind: 'predicate', factKind: 'release_year', operator: 'eq', expectedValue: 2020 } },
    ] };
    const unresolvedPreview = await host.inject({ method: 'POST', url: '/v1/admin/routing/material-fields/field-http-1/actions/preview', headers: { cookie }, payload: {
      idempotencyKey: 'routing-preview-unresolved', fieldId: 'field-http-1', policy: unresolvedPolicy, facts: [],
    } });
    assert.equal(unresolvedPreview.statusCode, 200);
    assert.equal(unresolvedPreview.json().result, 'unresolved');
    assert.equal(unresolvedPreview.json().unresolvedReasonCode, 'higher_priority_rule_unknown');
    const noMatchPreview = await host.inject({ method: 'POST', url: '/v1/admin/routing/material-fields/field-http-1/actions/preview', headers: { cookie }, payload: {
      idempotencyKey: 'routing-preview-no-match', fieldId: 'field-http-1', policy: unresolvedPolicy,
      facts: [{ factKind: 'release_year', year: 2021 }],
    } });
    assert.equal(noMatchPreview.statusCode, 200);
    assert.equal(noMatchPreview.json().result, 'unresolved');
    assert.equal(noMatchPreview.json().unresolvedReasonCode, 'no_matching_shelf');
    const previewClosedInput = await host.inject({ method: 'POST', url: '/v1/admin/routing/material-fields/field-http-1/actions/preview', headers: { cookie }, payload: {
      idempotencyKey: 'routing-preview-extra', fieldId: 'field-http-1', policy: routingPolicy, facts: [], unexpected: true,
    } });
    assert.equal(previewClosedInput.statusCode, 400);
    const previewTargetMismatch = await host.inject({ method: 'POST', url: '/v1/admin/routing/material-fields/field-http-1/actions/preview', headers: { cookie }, payload: {
      idempotencyKey: 'routing-preview-target-mismatch', fieldId: 'other-field', policy: routingPolicy, facts: [],
    } });
    assert.equal(previewTargetMismatch.statusCode, 400);
    const invalidDirectPolicy = await host.inject({ method: 'POST', url: '/v1/admin/routing/material-fields/field-http-1/actions/preview', headers: { cookie }, payload: {
      idempotencyKey: 'routing-preview-invalid-direct', fieldId: 'field-http-1',
      policy: { ...unresolvedPolicy, routingPolicyId: 'invalid-direct', mode: 'direct' }, facts: [],
    } });
    assert.equal(invalidDirectPolicy.statusCode, 400);

    const faultDatabase = new Database(path.join(value.dataDir, 'shelfdeck.db'));
    faultDatabase.exec(`
      CREATE TRIGGER p14_routing_publish_fault
      BEFORE INSERT ON libra_routing_policy_targets
      BEGIN
        SELECT RAISE(ABORT, 'p14-routing-publish-fault');
      END
    `);
    faultDatabase.close();
    const crashedPublish = await host.inject({ method: 'PATCH', url: '/v1/admin/routing/material-fields/field-http-1', headers: { cookie }, payload: {
      idempotencyKey: 'routing-publish-crash', fieldId: 'field-http-1', expectedPolicyId: null, expectedRevision: 0,
      policy: { ...routingPolicy, routingPolicyId: 'routing-crash' },
    } });
    assert.equal(crashedPublish.statusCode, 400);
    const crashEvidence = new Database(path.join(value.dataDir, 'shelfdeck.db'));
    assert.equal(crashEvidence.prepare("SELECT count(*) AS count FROM libra_routing_policy_revisions WHERE routing_policy_id='routing-crash'").get().count, 0);
    assert.equal(crashEvidence.prepare("SELECT count(*) AS count FROM libra_routing_policy_targets WHERE routing_policy_id='routing-crash'").get().count, 0);
    assert.equal(crashEvidence.prepare("SELECT count(*) AS count FROM libra_field_routing_heads WHERE field_id='field-http-1'").get().count, 0);
    assert.equal(crashEvidence.prepare("SELECT count(*) AS count FROM fx_command_receipts WHERE owner_domain='libra' AND idempotency_key='routing-publish-crash'").get().count, 0);
    assert.equal(crashEvidence.prepare("SELECT count(*) AS count FROM fx_outbox WHERE aggregate_id='routing-crash'").get().count, 0);
    crashEvidence.exec('DROP TRIGGER p14_routing_publish_fault');
    crashEvidence.close();

    const publishCommand = { idempotencyKey: 'routing-publish-1', fieldId: 'field-http-1', expectedPolicyId: null, expectedRevision: 0, policy: routingPolicy };
    const published = await host.inject({ method: 'PATCH', url: '/v1/admin/routing/material-fields/field-http-1', headers: { cookie }, payload: publishCommand });
    assert.equal(published.statusCode, 200, JSON.stringify(published.json()));
    assert.equal(published.json().policy.revision, 1);
    const publishReplay = await host.inject({ method: 'PATCH', url: '/v1/admin/routing/material-fields/field-http-1', headers: { cookie }, payload: publishCommand });
    assert.equal(publishReplay.statusCode, 200);
    const publishConflict = await host.inject({ method: 'PATCH', url: '/v1/admin/routing/material-fields/field-http-1', headers: { cookie }, payload: { ...publishCommand, policy: { ...routingPolicy, mode: 'direct' } } });
    assert.equal(publishConflict.statusCode, 409);
    const routingMismatch = await host.inject({ method: 'PATCH', url: '/v1/admin/routing/material-fields/field-http-1', headers: { cookie }, payload: { ...publishCommand, idempotencyKey: 'routing-mismatch', fieldId: 'other-field' } });
    assert.equal(routingMismatch.statusCode, 400);
    const stalePublish = await host.inject({ method: 'PATCH', url: '/v1/admin/routing/material-fields/field-http-1', headers: { cookie }, payload: {
      ...publishCommand, idempotencyKey: 'routing-publish-stale',
    } });
    assert.equal(stalePublish.statusCode, 400);
    const publishRevision2 = await host.inject({ method: 'PATCH', url: '/v1/admin/routing/material-fields/field-http-1', headers: { cookie }, payload: {
      idempotencyKey: 'routing-publish-2', fieldId: 'field-http-1', expectedPolicyId: 'routing-http-1', expectedRevision: 1,
      policy: { routingPolicyId: 'routing-http-1', mode: 'direct', targets: [
        { shelfId: 'shelf-http-1', rank: 1, matchExpression: { nodeKind: 'always' } },
      ] },
    } });
    assert.equal(publishRevision2.statusCode, 200, JSON.stringify(publishRevision2.json()));
    assert.equal(publishRevision2.json().policy.revision, 2);
    const currentRouting = await host.inject({ method: 'GET', url: '/v1/admin/routing/material-fields/field-http-1', headers: { cookie } });
    assert.equal(currentRouting.statusCode, 200);
    assert.equal(currentRouting.json().policy.revision, 2);
    const routingHistory = await host.inject({ method: 'GET', url: '/v1/admin/routing/material-fields/field-http-1/revisions', headers: { cookie } });
    assert.equal(routingHistory.statusCode, 200);
    assert.deepEqual(routingHistory.json().items.map((item) => item.revision), [1, 2]);
    assert.equal(routingHistory.json().items[0].policyDigest, published.json().policy.policyDigest);
    const missing = await host.inject({ method: 'GET', url: '/v1/admin/shelves/missing-shelf', headers: { cookie } });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error.code, 'ADMIN_SHELF_NOT_FOUND');
  } finally { await host.close(); }
  const ownerEvidence = new Database(path.join(value.dataDir, 'shelfdeck.db'), { readonly: true });
  try {
    assert.deepEqual(ownerEvidence.prepare('SELECT revision FROM arca_shelf_standard_revisions WHERE shelf_id=? ORDER BY revision').all('shelf-http-1').map((row) => row.revision), [1, 2]);
    assert.deepEqual(ownerEvidence.prepare('SELECT revision FROM arca_placement_policy_revisions WHERE shelf_id=? ORDER BY revision').all('shelf-http-1').map((row) => row.revision), [1, 2]);
    assert.deepEqual(ownerEvidence.prepare('SELECT current_standard_revision,current_placement_revision,routing_projection_revision FROM arca_shelves WHERE shelf_id=?').get('shelf-http-1'), {
      current_standard_revision: 2, current_placement_revision: 2, routing_projection_revision: 2,
    });
    assert.equal(ownerEvidence.prepare("SELECT count(*) AS count FROM fx_command_receipts WHERE owner_domain='arca' AND target_id='shelf-http-1'").get().count, 3);
    assert.equal(ownerEvidence.prepare("SELECT count(*) AS count FROM libra_routing_policy_revisions WHERE field_id='field-http-1'").get().count, 2);
    assert.equal(ownerEvidence.prepare("SELECT count(*) AS count FROM libra_routing_policy_targets WHERE routing_policy_id='routing-http-1'").get().count, 2);
    assert.equal(ownerEvidence.prepare("SELECT count(*) AS count FROM fx_outbox WHERE producer_domain='libra' AND aggregate_id='routing-http-1'").get().count, 2);
    assert.equal(ownerEvidence.prepare("SELECT current_routing_policy_id,current_policy_revision FROM libra_field_routing_heads WHERE field_id='field-http-1'").get().current_policy_revision, 2);
  } finally { ownerEvidence.close(); }
  const restarted = await createCleanServiceHost({ dataDir: value.dataDir, adminDistDir: value.adminDistDir, secretRoot });
  try {
    const exchange = await restarted.inject({ method: 'POST', url: '/v1/admin/session', headers: { 'x-api-key': value.initialized.adminApiKey } });
    const exact = await restarted.inject({ method: 'GET', url: '/v1/admin/shelves/shelf-http-1', headers: { cookie: exchange.headers['set-cookie'] } });
    assert.equal(exact.statusCode, 200);
    assert.equal(exact.json().shelf.routingProjection.revision, 2);
    assert.equal(exact.json().shelf.standard.revision, 2);
    assert.equal(exact.json().shelf.placement.revision, 2);
    const routing = await restarted.inject({ method: 'GET', url: '/v1/admin/routing/material-fields/field-http-1', headers: { cookie: exchange.headers['set-cookie'] } });
    assert.equal(routing.statusCode, 200);
    assert.equal(routing.json().policy.routingPolicyId, 'routing-http-1');
    assert.equal(routing.json().policy.revision, 2);
    const replayAfterRestart = await restarted.inject({ method: 'PATCH', url: '/v1/admin/routing/material-fields/field-http-1', headers: { cookie: exchange.headers['set-cookie'] }, payload: {
      idempotencyKey: 'routing-publish-1', fieldId: 'field-http-1', expectedPolicyId: null, expectedRevision: 0,
      policy: { routingPolicyId: 'routing-http-1', mode: 'sorting', targets: [
        { shelfId: 'shelf-http-1', rank: 1, matchExpression: { nodeKind: 'always' } },
      ] },
    } });
    assert.equal(replayAfterRestart.statusCode, 200);
    assert.equal(replayAfterRestart.json().policy.revision, 1);
    assert.equal(replayAfterRestart.json().replayed, true);
  } finally { await restarted.close(); }
});

test('formal node entrypoint starts, authenticates and shuts down through public HTTP', async () => {
  const value = fixture();
  const port = await reservePort();
  let stdout = '';
  let stderr = '';
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: serviceRoot,
    windowsHide: true,
    env: {
      ...process.env,
      MEDIA_SERVICE_PORT: String(port),
      MEDIA_SERVICE_HOST: '127.0.0.1',
      MEDIA_SERVICE_DATA_DIR: value.dataDir,
      MEDIA_SERVICE_ADMIN_DIST_DIR: value.adminDistDir,
      SHELFDECK_SECRET_ROOT: secretRoot,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    const base = `http://127.0.0.1:${port}`;
    const health = await waitForHealth(`${base}/v1/health`, child, () => stderr);
    assert.equal((await health.json()).generation, 'helix-clean-v1');
    const admin = await fetch(`${base}/admin`);
    assert.equal(admin.status, 200);
    assert.match(await admin.text(), /id="root"/);
    const exchange = await fetch(`${base}/v1/admin/session`, {
      method: 'POST',
      headers: { 'x-api-key': value.initialized.adminApiKey },
    });
    assert.equal(exchange.status, 204);
    const cookie = exchange.headers.get('set-cookie');
    const security = await fetch(`${base}/v1/admin/settings/security`, {
      headers: { cookie },
    });
    assert.equal(security.status, 200);
    assert.equal((await security.json()).credentialConfigured, true);
    const policyValue = {
      includedDirectories: ['formal-http'], excludedDirectories: [], allowedExtensions: ['.mkv'],
      minimumSizeBytes: 0, excludedMaterialKeys: [],
    };
    const policyBasis = { extractionPolicyId: 'policy-formal-http-1', revision: 1, ...policyValue };
    const accessBasis = {
      fieldId: 'field-formal-http-1', revision: 1, endpointId: 'endpoint-formal-http-1', rootLocation: 'formal-http',
      mountScopeId: 'mount-formal-http-1', mountScopeRevision: 1, accessSchemaRef: 'helix://fixtures/formal-http-access/v1',
    };
    const fieldCreate = await fetch(`${base}/v1/admin/material-fields`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({
        idempotencyKey: 'formal-http-field-1', fieldId: accessBasis.fieldId, name: 'Formal HTTP Field',
        policy: {
          extractionPolicyId: policyBasis.extractionPolicyId, revision: 1,
          policySchemaRef: 'helix://contracts/domain-types/ExtractionPolicy/v1', policy: policyValue,
          policyDigest: canonicalDigest(policyBasis),
        },
        access: { ...accessBasis, accessDigest: canonicalDigest(accessBasis) },
      }),
    });
    assert.equal(fieldCreate.status, 201);
    const fields = await fetch(`${base}/v1/admin/material-fields`, { headers: { cookie } });
    assert.equal(fields.status, 200);
    assert.deepEqual((await fields.json()).items.map((item) => item.fieldId), ['field-formal-http-1']);
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    await Promise.race([
      once(child, 'exit'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('service shutdown timeout')), 5000)),
    ]);
  }
  assert.match(stdout, /clean service listening/);
  assert.doesNotMatch(stdout + stderr, /apiKey|SHELFDECK_SECRET_ROOT|signingSecret/);
});

test('Windows and Docker artifacts select the service-only clean entrypoint', () => {
  const docker = fs.readFileSync(path.join(serviceRoot, 'Dockerfile'), 'utf8');
  assert.match(docker, /CMD \["node", "src\/server\.js"\]/);
  assert.match(docker, /COPY media-service\/src\/clean-service-host\.js/);
  assert.match(docker, /COPY media-service\/src\/helix \.\/src\/helix/);
  assert.match(docker, /FROM service-base AS service-dependencies/);
  assert.match(docker, /FROM service-base AS service-runtime/);
  assert.match(docker, /COPY --from=service-dependencies \/app\/node_modules \.\/node_modules/);
  assert.match(docker, /remove the interpreter\/runtime from the final image/i);
  assert.doesNotMatch(docker, /media-worker|face-service|fastapi|19110|ollama|all-in-one/i);
  assert.doesNotMatch(
    docker.slice(docker.indexOf('FROM service-base AS service-runtime')),
    /apt-get install[^\n]*(python|make|g\+\+)/i,
  );

  const windows = fs.readFileSync(path.join(serviceRoot, 'scripts', 'package-win.js'), 'utf8');
  assert.match(windows, /CLEAN_RUNTIME_FILES/);
  assert.match(windows, /cleanHelixSource/);
  assert.doesNotMatch(windows, /^\s*['"]src['"],?\s*$/m);
  assert.doesNotMatch(windows, /media-worker|face-service|19110|ollama/i);
});
