'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Ajv2020 = require('ajv/dist/2020');
const Database = require('better-sqlite3');
const { initializeCleanData } = require('../../scripts/helix-operational-safety');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const {
  createCleanServiceHost,
} = require('../../src/clean-service-host');
const {
  createWorkAdmission,
} = require('../../src/helix/foundation/execution/work-admission');
const {
  createSynchronousDomainWork,
} = require('../../src/helix/foundation/execution/synchronous-domain-work');
const {
  openSqliteKernel,
} = require('../../src/helix/foundation/persistence/sqlite-kernel');
const {
  createSqliteUnitOfWork,
} = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {
  createProcurementRunSealStore,
} = require('../../src/helix/domains/procurement/persistence/procurement-run-seal-store');
const {
  buildQuery,
  createCandidateDeliveryService,
} = require('../../src/helix/domains/procurement/application/candidate-delivery-service');
const {
  createCandidateDeliveryReader,
} = require('../../src/helix/domains/procurement/persistence/candidate-delivery-reader');
const {
  createProductDeliveryReader,
} = require('../../src/helix/domains/libra/persistence/product-delivery-reader');
const cleanSchemaManifest = require(
  '../../src/helix/foundation/persistence/generated/clean-schema.manifest.json'
);

const serviceRoot = path.resolve(__dirname, '../..');
const secretRoot = 'p14-clean-entrypoint-secret-root-0123456789abcdef';
const roots = [];
const cleanSchemaDdl = fs.readFileSync(
  path.join(
    serviceRoot,
    'src/helix/foundation/persistence/generated/clean-schema.sql',
  ),
  'utf8',
);
const validateDeregistrationReceipt = new Ajv2020({ allErrors: true, strict: false }).compile(
  require('../../src/helix/contracts/types/DeregistrationReceipt/v1/schema.json'),
);

function contractValidator(schemaId) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const pending = [path.join(serviceRoot, 'src', 'helix', 'contracts')];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (entry.name === 'schema.json') ajv.addSchema(JSON.parse(fs.readFileSync(entryPath, 'utf8')));
    }
  }
  const validate = ajv.getSchema(schemaId);
  assert.ok(validate, `missing machine schema ${schemaId}`);
  return validate;
}

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
  for (let attempt = 0; attempt < 400; attempt += 1) {
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
        relative === 'src/clean-local-filesystem-mount-probe.js' ||
        relative === 'src/clean-shelf-target-folder-probe.js' ||
        relative === 'src/clean-field-access-binding-probe.js' ||
        relative === 'src/clean-field-observation-enumerator.js' ||
        relative === 'src/clean-media-probe.js' ||
        relative === 'src/clean-compute-device-runtime.js' ||
        relative === 'src/clean-ffmpeg-pipeline.js' ||
        relative === 'src/clean-ffmpeg-process-registry.js' ||
        relative === 'src/clean-media-production-effect-port.js' ||
        relative === 'src/clean-layout-observer.js' ||
        relative === 'src/clean-product-production-port.js' ||
        relative === 'src/clean-workspace-product-port.js' ||
        relative === 'src/clean-workspace-root-admin.js' ||
        relative === 'src/clean-western-analysis-port.js' ||
        relative === 'src/clean-arca-inventory-port.js' ||
        relative === 'src/clean-offdeck-deletion-port.js' ||
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

test('Shelf Target Folder probe is a read-only Clean Service adapter', () => {
  const probeSource = fs.readFileSync(
    path.join(
      serviceRoot,
      'src/clean-shelf-target-folder-probe.js',
    ),
    'utf8',
  );
  assert.doesNotMatch(
    probeSource,
    /\.(?:writeFile|rename|copyFile|unlink|mkdir|rm|rmdir)Sync\(/,
  );
  assert.match(probeSource, /realpathSync/);
  assert.match(probeSource, /statSync/);
  assert.match(probeSource, /accessSync/);
  const compositionSource = fs.readFileSync(
    path.join(serviceRoot, 'src/helix/composition/create-clean-facades.js'),
    'utf8',
  );
  assert.doesNotMatch(compositionSource, /shelf-query-store|better-sqlite3|node:fs/);
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

test('legacy Movie formation coordinator remains disconnected while Intake uses the formal execution runtime', () => {
  const source = fs.readFileSync(
    path.join(
      serviceRoot,
      'src/helix/domains/libra/application/movie-formation-coordinator.js',
    ),
    'utf8',
  );
  const hostSource = fs.readFileSync(
    path.join(serviceRoot, 'src/clean-service-host.js'),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /domains\/arca|arca_shelves|people|domains\/perception|perception-store|provider-store|workspace|handoff_b|better-sqlite3/i,
  );
  assert.doesNotMatch(source, /SELECT\s+|MAX\s*\(|latest|current.*scan/i);
  assert.match(source, /owner: 'libra'/);
  assert.match(source, /find_subject:[\s\S]*?keyColumns: \['subject_id'\]/);
  assert.match(source, /find_intake:[\s\S]*?keyColumns: \['intake_decision_id'\]/);
  assert.match(source, /find_spec:[\s\S]*?keyColumns: \['acceptance_spec_id'\]/);
  assert.doesNotMatch(hostSource, /createMovieFormationCoordinator|movie-formation-coordinator/);
  assert.doesNotMatch(hostSource, /domains\/arca\/application\/shelf-store/);
  assert.match(hostSource, /readArcaShelfStandard: arcaRoutingTargets\.getStandard/);
  assert.match(hostSource, /createHelixExecutionRuntime/);
  assert.match(hostSource, /createFormationQuery/);
  assert.match(hostSource, /candidateDeliveryPort/);
});

test('Movie responsibility closure uses only formal Owner-local ports and exact message consumers', () => {
  const coordinatorSource = fs.readFileSync(
    path.join(
      serviceRoot,
      'src/helix/domains/libra/application/movie-responsibility-closure-coordinator.js',
    ),
    'utf8',
  );
  const cleanupStoreSource = fs.readFileSync(
    path.join(
      serviceRoot,
      'src/helix/domains/libra/persistence/workspace-cleanup-store.js',
    ),
    'utf8',
  );
  const offloadPortSource = fs.readFileSync(
    path.join(
      serviceRoot,
      'src/helix/domains/arca/application/offload-completion-projection.js',
    ),
    'utf8',
  );
  assert.doesNotMatch(
    coordinatorSource,
    /domains\/(?:arca|procurement)\/persistence|better-sqlite3|SELECT\s+|MAX\s*\(|ORDER\s+BY[\s\S]*?DESC/i,
  );
  assert.doesNotMatch(cleanupStoreSource, /\b(?:arca|proc)_/);
  assert.match(coordinatorSource, /arca\.product\.accepted@1/);
  assert.match(coordinatorSource, /arca\.offload\.completed@1/);
  assert.match(coordinatorSource, /offloadCompletionPort\.readCompletion/);
  assert.match(offloadPortSource, /owner: 'arca'/);
  assert.match(offloadPortSource, /readOnly: true/);
});

test('Procurement automation advances only through terminal Work reconcile and owner-local formal contracts', () => {
  const source = fs.readFileSync(
    path.join(
      serviceRoot,
      'src',
      'helix',
      'domains',
      'procurement',
      'application',
      'procurement-automation-service.js',
    ),
    'utf8',
  );
  const facade = fs.readFileSync(
    path.join(
      serviceRoot,
      'src',
      'helix',
      'domains',
      'procurement',
      'application',
      'admin-facade.js',
    ),
    'utf8',
  );
  const runtimeComposition = fs.readFileSync(path.join(serviceRoot, 'src', 'helix', 'composition',
    'create-procurement-execution-runtime.js'), 'utf8');
  assert.match(source, /createEligibilityReconcileStore/);
  assert.match(source, /createProcurementRunAdmissionStore/);
  assert.match(source, /procurement\.material\.control\.acquire@1/);
  assert.doesNotMatch(facade, /automation\.(?:advanceFromObservation|reconcileFromObservation)/);
  assert.match(runtimeComposition, /procurementAutomation\.reconcileFromObservation/);
  assert.doesNotMatch(
    source,
    /better-sqlite3|node:fs|domains\/(?:libra|arca)|\bSELECT\b|\bMAX\s*\(/,
  );
  assert.doesNotMatch(source, /legacy|fallback|dual[-_ ](?:read|write|run|path)/i);
});

test('clean host recovers dependent Owner Work before durable message delivery can enlarge scope', () => {
  const source = fs.readFileSync(path.join(serviceRoot, 'src', 'clean-service-host.js'), 'utf8');
  const start=source.slice(source.indexOf('const executionRuntimeHost = Object.freeze'),source.indexOf('arcaCare=createArcaCareApplication'));
  assert.ok(start.indexOf('await procurementExecution.host.start()')<start.indexOf('await outboxDispatcher.start()'));
});

test('clean host serves public health and Admin UI, then requires API key or HttpOnly session', async () => {
  const value = fixture();
  const host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
  });
  try {
    assert.equal(host.routeCount, 121);
    const health = await host.inject({ method: 'GET', url: '/v1/health' });
    assert.equal(health.statusCode, 200);
    assert.deepEqual(Object.keys(health.json()).sort(), ['generation', 'normalSupplyAllowed', 'status']);
    assert.doesNotMatch(health.body, /credential|secret|collection/i);

    const admin = await host.inject({ method: 'GET', url: '/admin' });
    assert.equal(admin.statusCode, 200);
    assert.match(admin.body, /id="root"/);
    for (const pagePath of ['/material-fields', '/shelves', '/collection', '/formation', '/offdeck', '/people', '/settings']) {
      const page = await host.inject({ method: 'GET', url: pagePath });
      assert.equal(page.statusCode, 200, pagePath);
      assert.match(page.body, /id="root"/);
      assert.equal(page.headers['cache-control'], 'no-store');
    }
    const unknownPage = await host.inject({ method: 'GET', url: '/not-a-shelfdeck-page' });
    assert.equal(unknownPage.statusCode, 404);

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

    const overview = await host.inject({
      method: 'GET',
      url: '/v1/admin/overview',
      headers: { cookie },
    });
    assert.equal(overview.statusCode, 200);
    assert.deepEqual(overview.json().metrics.map((item) => item.value), [0, 0, 0]);
    assert.equal(overview.json().systemState.kind, 'unconfigured');
    assert.deepEqual(overview.json().setup, {
      activeMaterialFieldCount: 0,
      activeShelfCount: 0,
      productChoice: 'key_step_confirmation',
    });
    assert.ok(['normal','running'].includes(overview.json().backgroundOperations.state));
    assert.equal(overview.json().backgroundOperations.cadenceMs, 30000);
    assert.ok(overview.json().backgroundOperations.registrations.some((item) =>
      item.ownerDomain === 'people' && item.reconcilerKey === 'ondeck-person-evidence'));
    assert.ok(overview.json().backgroundOperations.registrations.some((item) =>
      item.ownerDomain === 'libra' && item.reconcilerKey === 'completed-workspace-reclamation'));
    assert.ok(overview.json().backgroundOperations.registrations.some((item) =>
      item.ownerDomain === 'libra' && item.reconcilerKey === 'discarded-workspace-leftovers'));

    const workspaceSettings=await host.inject({method:'GET',url:'/v1/admin/settings/workspaces',headers:{cookie}});
    assert.equal(workspaceSettings.statusCode,200);
    assert.equal(workspaceSettings.json().restartRequired,false);
    assert.equal(path.isAbsolute(workspaceSettings.json().current.rootPath),true);
    const workspaceProbe=await host.inject({method:'POST',url:'/v1/admin/settings/workspaces/actions/probe',headers:{cookie},
      payload:{rootPath:path.join(value.dataDir,'custom-production-workspace'),idempotencyKey:'workspace-probe-entrypoint'}});
    assert.equal(workspaceProbe.statusCode,200,workspaceProbe.body);
    assert.equal(workspaceProbe.json().validation,'passed');
    const workspaceConfigured=await host.inject({method:'PATCH',url:'/v1/admin/settings/workspaces',headers:{cookie},
      payload:{rootPath:path.join(value.dataDir,'custom-production-workspace'),expectedConfigRevision:1,
        idempotencyKey:'workspace-configure-entrypoint'}});
    assert.equal(workspaceConfigured.statusCode,200,workspaceConfigured.body);
    assert.equal(workspaceConfigured.json().restartRequired,true);
    assert.equal(workspaceConfigured.json().pending.rootPath,workspaceProbe.json().rootPath);

    const people = await host.inject({
      method: 'GET',
      url: '/v1/admin/people',
      headers: { cookie },
    });
    assert.equal(people.statusCode, 200);
    assert.deepEqual(people.json().items, []);
    assert.deepEqual(people.json().summary, {
      activePersonCount: 0,
      mergedPersonCount: 0,
      openRegistrationCandidateCount: 0,
      openMergeCandidateCount: 0,
    });

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
  const fieldRoot = path.join(path.dirname(value.dataDir), 'field-http-1');
  const revisedRoot = path.join(path.dirname(value.dataDir), 'field-http-1-revised');
  fs.mkdirSync(path.join(fieldRoot, 'incoming'), { recursive: true });
  fs.mkdirSync(revisedRoot, { recursive: true });
  const policyValue = {
    includedDirectories: ['incoming'], excludedDirectories: [], allowedExtensions: ['.mkv'],
    minimumSizeBytes: 0, excludedMaterialKeys: [],
  };
  const policyBasis = {
    extractionPolicyId: 'policy-http-1', revision: 1, ...policyValue,
  };
  const accessBasis = {
    fieldId: 'field-http-1', revision: 1, endpointId: 'endpoint-http-1', rootLocation: fieldRoot,
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
    assert.deepEqual(created.json().materialField.currentProfileHintSnapshot, {
      fieldId:'field-http-1',
      revision:1,
      contentProfileHint:'mixed',
      hintDigest:canonicalDigest({
        schema:'procurement.material-field-profile-hint@1',
        fieldId:'field-http-1',
        revision:1,
        contentProfileHint:'mixed',
      }),
    });
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
    const accessRevisionBasis = { ...accessBasis, revision: 2, rootLocation: revisedRoot, mountScopeRevision: 2 };
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
    const profileRevisionCommand = {
      idempotencyKey:'field-http-profile-western-2',
      operation:'revise_profile_hint',
      fieldId:'field-http-1',
      expectedProfileHintRevision:1,
      newContentProfileHint:'western_adult',
    };
    const profileRevision = await host.inject({
      method:'PATCH',
      url:'/v1/admin/material-fields/field-http-1',
      headers:{ cookie },
      payload:profileRevisionCommand,
    });
    assert.equal(profileRevision.statusCode, 200);
    assert.equal(
      profileRevision.json().materialField.currentProfileHintSnapshot.contentProfileHint,
      'western_adult',
    );
    assert.equal(
      profileRevision.json().materialField.currentProfileHintSnapshot.revision,
      2,
    );
    const profileReplay = await host.inject({
      method:'PATCH',
      url:'/v1/admin/material-fields/field-http-1',
      headers:{ cookie },
      payload:profileRevisionCommand,
    });
    assert.equal(profileReplay.statusCode, 200);
    assert.deepEqual(profileReplay.json(), profileRevision.json());
    const profileConflict = await host.inject({
      method:'PATCH',
      url:'/v1/admin/material-fields/field-http-1',
      headers:{ cookie },
      payload:{ ...profileRevisionCommand, newContentProfileHint:'jav' },
    });
    assert.equal(profileConflict.statusCode, 409);
    assert.equal(profileConflict.json().error.code, 'ADMIN_FIELD_IDEMPOTENCY_CONFLICT');
    const profileTargetMismatch = await host.inject({
      method:'PATCH',
      url:'/v1/admin/material-fields/field-http-1',
      headers:{ cookie },
      payload:{
        ...profileRevisionCommand,
        idempotencyKey:'field-http-profile-target-mismatch',
        fieldId:'field-other',
        expectedProfileHintRevision:2,
      },
    });
    assert.equal(profileTargetMismatch.statusCode, 400);
    assert.equal(profileTargetMismatch.json().error.code, 'ADMIN_FIELD_TARGET_MISMATCH');
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
    assert.equal(response.json().materialField.access.endpointId,
      'local-filesystem-' + process.platform);
    assert.match(response.json().materialField.access.mountScopeId,
      /^local-mount-[0-9a-f]{32}$/);
    assert.equal(
      response.json().materialField.currentProfileHintSnapshot.contentProfileHint,
      'western_adult',
    );
    const inspect = new Database(path.join(value.dataDir, 'shelfdeck.db'), { readonly:true });
    assert.equal(
      inspect.prepare('SELECT COUNT(*) count FROM proc_field_profile_hint_revisions WHERE field_id=?').get('field-http-1').count,
      2,
    );
    inspect.close();
  } finally {
    await restarted.close();
  }
});

test.skip('superseded synchronous Field Observation journey (background Work coverage lives in procurement-only-movie-journey)', async () => {
  const value = fixture();
  const fieldRoot = path.join(path.dirname(value.dataDir), 'observation-field');
  const nested = path.join(fieldRoot, 'nested');
  fs.mkdirSync(nested, { recursive: true });
  const sourceFiles = [
    path.join(fieldRoot, 'movie-a.mkv'),
    path.join(nested, 'movie-b.mkv'),
    path.join(nested, 'movie-c.mkv'),
  ];
  sourceFiles.forEach((file, index) => fs.writeFileSync(file, Buffer.from('immutable-source-' + index)));
  const before = sourceFiles.map((file) => ({
    content: fs.readFileSync(file),
    mtimeMs: fs.statSync(file).mtimeMs,
  }));
  const policyValue = {
    includedDirectories: [],
    excludedDirectories: [],
    allowedExtensions: ['.mkv'],
    minimumSizeBytes: 0,
    excludedMaterialKeys: [],
  };
  const policyBasis = { extractionPolicyId: 'policy-observe-1', revision: 1, ...policyValue };
  const accessBasis = {
    fieldId: 'field-observe-1',
    revision: 1,
    endpointId: 'endpoint-observe-1',
    rootLocation: fieldRoot,
    mountScopeId: 'mount-observe-1',
    mountScopeRevision: 1,
    accessSchemaRef: 'helix://fixtures/http-observation-access/v1',
  };
  const registration = {
    idempotencyKey: 'field-observe-registration-1',
    fieldId: 'field-observe-1',
    name: 'Observation Source',
    contentProfileHint: 'movie',
    policy: {
      extractionPolicyId: 'policy-observe-1',
      revision: 1,
      policySchemaRef: 'helix://contracts/domain-types/ExtractionPolicy/v1',
      policy: policyValue,
      policyDigest: canonicalDigest(policyBasis),
    },
    access: { ...accessBasis, accessDigest: canonicalDigest(accessBasis) },
  };
  const observation = {
    idempotencyKey: 'field-observe-work-1',
    fieldId: 'field-observe-1',
    expectedAccessRevision: 1,
    expectedObservationRevision: 0,
    pageBudget: 1,
  };

  let host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
  });
  let cookie;
  try {
    const exchange = await host.inject({
      method: 'POST',
      url: '/v1/admin/session',
      headers: { 'x-api-key': value.initialized.adminApiKey },
    });
    cookie = exchange.headers['set-cookie'];
    const created = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields',
      headers: { cookie },
      payload: registration,
    });
    assert.equal(created.statusCode, 201, created.body);
    const unauthenticated = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields/field-observe-1/actions/observe',
      payload: observation,
    });
    assert.equal(unauthenticated.statusCode, 401);
    const mismatch = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields/field-observe-1/actions/observe',
      headers: { cookie },
      payload: { ...observation, idempotencyKey: 'observe-mismatch', fieldId: 'other-field' },
    });
    assert.equal(mismatch.statusCode, 400, mismatch.body);
    assert.equal(mismatch.json().error.code, 'ADMIN_FIELD_TARGET_MISMATCH');
    const closed = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields/field-observe-1/actions/observe',
      headers: { cookie },
      payload: { ...observation, idempotencyKey: 'observe-closed', unexpected: true },
    });
    assert.equal(closed.statusCode, 400);

    const fault = new Database(path.join(value.dataDir, 'shelfdeck.db'));
    fault.exec(`
      CREATE TRIGGER p14_observation_page_fault
      BEFORE INSERT ON proc_field_observations
      WHEN NEW.page_ordinal = 1
      BEGIN
        SELECT RAISE(ABORT, 'p14-observation-page-fault');
      END
    `);
    fault.close();
    const interrupted = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields/field-observe-1/actions/observe',
      headers: { cookie },
      payload: observation,
    });
    assert.equal(interrupted.statusCode, 400, interrupted.body);
    assert.equal(interrupted.json().error.details.reasonCode, 'SQLITE_CONSTRAINT_TRIGGER');
  } finally {
    await host.close();
  }

  const interruptedEvidence = new Database(path.join(value.dataDir, 'shelfdeck.db'));
  assert.deepEqual(
    interruptedEvidence.prepare(
      'SELECT revision,page_ordinal,completed FROM proc_field_observations ORDER BY revision'
    ).all(),
    [{ revision: 1, page_ordinal: 0, completed: 0 }],
  );
  assert.equal(
    interruptedEvidence.prepare(
      "SELECT current_observation_revision FROM proc_material_fields WHERE field_id='field-observe-1'"
    ).get().current_observation_revision,
    1,
  );
  assert.equal(
    interruptedEvidence.prepare(
      "SELECT state FROM fx_supporting_works WHERE owner_domain='procurement' AND process_id='field-observe-1'"
    ).get().state,
    'running',
  );
  assert.equal(interruptedEvidence.prepare('SELECT count(*) count FROM proc_field_materials').get().count, 1);
  assert.equal(interruptedEvidence.prepare(
    "SELECT count(*) count FROM fx_commit_markers WHERE owner_domain='procurement' AND scope_type='material_field_observation'"
  ).get().count, 1);
  interruptedEvidence.exec('DROP TRIGGER p14_observation_page_fault');
  interruptedEvidence.close();

  host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
  });
  try {
    const exchange = await host.inject({
      method: 'POST',
      url: '/v1/admin/session',
      headers: { 'x-api-key': value.initialized.adminApiKey },
    });
    cookie = exchange.headers['set-cookie'];
    const runCompletionFault = new Database(
      path.join(value.dataDir, 'shelfdeck.db'),
    );
    runCompletionFault.exec(`
      CREATE TRIGGER p14_run_admission_event_completion_fault
      BEFORE UPDATE OF state ON fx_workflow_events
      WHEN NEW.state = 'succeeded'
        AND OLD.capability_ref = 'procurement.material.control.acquire@1'
      BEGIN
        SELECT RAISE(ABORT, 'p14-run-admission-event-completion-fault');
      END
    `);
    runCompletionFault.close();
    const resumed = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields/field-observe-1/actions/observe',
      headers: { cookie },
      payload: observation,
    });
    assert.equal(resumed.statusCode, 400, resumed.body);
    assert.equal(
      resumed.json().error.details.reasonCode,
      'SQLITE_CONSTRAINT_TRIGGER',
    );
  } finally {
    await host.close();
  }

  const runCrashEvidence = new Database(
    path.join(value.dataDir, 'shelfdeck.db'),
  );
  assert.equal(
    runCrashEvidence.prepare(
      "SELECT count(*) count FROM proc_procurement_runs WHERE field_id='field-observe-1' AND state='active'"
    ).get().count,
    1,
  );
  assert.deepEqual(
    runCrashEvidence.prepare(
      "SELECT state FROM fx_workflow_events WHERE capability_ref='procurement.material.control.acquire@1'"
    ).all(),
    [{ state: 'executing' }],
  );
  assert.equal(
    runCrashEvidence.prepare(
      "SELECT count(*) count FROM fx_event_result_bindings result JOIN fx_workflow_events event ON event.event_id=result.event_id WHERE event.capability_ref='procurement.material.control.acquire@1'"
    ).get().count,
    1,
  );
  runCrashEvidence.exec('DROP TRIGGER p14_run_admission_event_completion_fault');
  runCrashEvidence.close();

  host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
  });
  try {
    const exchange = await host.inject({
      method: 'POST',
      url: '/v1/admin/session',
      headers: { 'x-api-key': value.initialized.adminApiKey },
    });
    cookie = exchange.headers['set-cookie'];
    const resumed = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields/field-observe-1/actions/observe',
      headers: { cookie },
      payload: observation,
    });
    assert.equal(resumed.statusCode, 200, resumed.body);
    assert.equal(resumed.json().observation.state, 'succeeded');
    assert.equal(resumed.json().observation.replayed, true);
    assert.equal(resumed.json().observation.sourceFileCount, 3);
    assert.equal(resumed.json().observation.pageCount, 3);
    assert.equal(resumed.json().observation.terminalObservationRevision, 3);
    assert.equal(
      resumed.json().procurementAutomation.stage,
      'procurement_run_active',
    );
    assert.equal(
      resumed.json().procurementAutomation.selectedMaterialCount,
      3,
    );
    assert.equal(resumed.json().procurementAutomation.recovered, true);
    assert.deepEqual(
      resumed.json().observation.pages.map((page) => [
        page.pageOrdinal,
        page.committedObservationRevision,
        page.acceptedMaterialCount,
        page.hasMore,
      ]),
      [[0, 1, 1, true], [1, 2, 1, true], [2, 3, 1, false]],
    );
    const exactReplay = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields/field-observe-1/actions/observe',
      headers: { cookie },
      payload: observation,
    });
    assert.equal(exactReplay.statusCode, 200);
    assert.equal(exactReplay.json().observation.replayed, true);
    assert.equal(exactReplay.json().observation.terminalObservationRevision, 3);
    assert.equal(exactReplay.json().procurementAutomation.replayed, true);
    const conflict = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields/field-observe-1/actions/observe',
      headers: { cookie },
      payload: { ...observation, pageBudget: 2 },
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().error.code, 'ADMIN_FIELD_IDEMPOTENCY_CONFLICT');
    const staleNewKey = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields/field-observe-1/actions/observe',
      headers: { cookie },
      payload: { ...observation, idempotencyKey: 'field-observe-stale-new-key' },
    });
    assert.equal(staleNewKey.statusCode, 409);
    assert.equal(staleNewKey.json().error.code, 'ADMIN_FIELD_CONFLICT');
  } finally {
    await host.close();
  }

  const committed = new Database(path.join(value.dataDir, 'shelfdeck.db'), { readonly: true });
  assert.deepEqual(
    committed.prepare(
      'SELECT revision,page_ordinal,expected_revision,cursor_in,cursor_out,completed FROM proc_field_observations ORDER BY revision'
    ).all().map((row) => ({
      ...row,
      cursor_in: row.cursor_in === null ? null : 'cursor',
      cursor_out: row.cursor_out === null ? null : 'cursor',
    })),
    [
      { revision: 1, page_ordinal: 0, expected_revision: 0, cursor_in: null, cursor_out: 'cursor', completed: 0 },
      { revision: 2, page_ordinal: 1, expected_revision: 1, cursor_in: 'cursor', cursor_out: 'cursor', completed: 0 },
      { revision: 3, page_ordinal: 2, expected_revision: 2, cursor_in: 'cursor', cursor_out: null, completed: 1 },
    ],
  );
  assert.equal(committed.prepare('SELECT count(*) count FROM proc_field_materials').get().count, 3);
  assert.equal(committed.prepare(
    `SELECT count(*) count
       FROM fx_event_result_bindings result
       JOIN fx_workflow_events event ON event.event_id=result.event_id
      WHERE event.capability_ref IN (
        'shared.material.media.probe@1',
        'procurement.triage.playability.inspect@1',
        'procurement.triage.structure.inspect@1',
        'procurement.triage.identity_claim.resolve@1',
        'procurement.triage.primary_manifest.build@1'
      )`
  ).get().count, 5);
  assert.equal(committed.prepare(
    `SELECT count(*) count
       FROM fx_event_result_bindings result
       JOIN fx_workflow_events event ON event.event_id=result.event_id
      WHERE event.capability_ref NOT IN (
        'shared.material.media.probe@1',
        'procurement.triage.playability.inspect@1',
        'procurement.triage.structure.inspect@1',
        'procurement.triage.identity_claim.resolve@1',
        'procurement.triage.primary_manifest.build@1'
      )`
  ).get().count, 4);
  assert.equal(committed.prepare(
    "SELECT count(*) count FROM fx_commit_markers WHERE owner_domain='procurement' AND scope_type='material_field_observation'"
  ).get().count, 3);
  assert.equal(committed.prepare('SELECT count(*) count FROM fx_outbox').get().count, 0);
  assert.equal(committed.prepare("SELECT state FROM fx_supporting_works WHERE process_id='field-observe-1'").get().state, 'succeeded');
  assert.equal(
    committed.prepare(
      "SELECT count(*) count FROM fx_supporting_works WHERE work_kind LIKE 'candidate_assembly_%' AND state='succeeded'"
    ).get().count,
    5,
  );
  assert.equal(
    committed.prepare(
      "SELECT count(*) count FROM fx_supporting_works WHERE work_kind NOT LIKE 'candidate_assembly_%' AND state='succeeded'"
    ).get().count,
    2,
  );
  assert.equal(
    committed.prepare(
      "SELECT count(*) count FROM fx_workflow_events WHERE state='succeeded'"
    ).get().count,
    9,
  );
  assert.equal(
    committed.prepare(
      "SELECT count(*) count FROM proc_procurement_runs WHERE field_id='field-observe-1' AND state='active'"
    ).get().count,
    1,
  );
  assert.equal(
    committed.prepare(
      "SELECT count(*) count FROM proc_run_materials WHERE selection_state='run_selection'"
    ).get().count,
    3,
  );
  committed.close();
  sourceFiles.forEach((file, index) => {
    assert.deepEqual(fs.readFileSync(file), before[index].content);
    assert.equal(fs.statSync(file).mtimeMs, before[index].mtimeMs);
  });
});

test.skip('failed-preparation synchronous product journey is outside the Procurement Foundation closure scope', async () => {
  const value = fixture();
  const databasePath = path.join(value.dataDir, 'shelfdeck.db');
  const fieldRoot = path.join(path.dirname(value.dataDir), 'retry-field');
  const sourceFile = path.join(fieldRoot, 'retry-title.mkv');
  fs.mkdirSync(fieldRoot, { recursive: true });
  fs.writeFileSync(sourceFile, Buffer.from('immutable-retry-source'));
  const sourceBefore = fs.readFileSync(sourceFile);
  const policyValue = {
    includedDirectories: [],
    excludedDirectories: [],
    allowedExtensions: ['.mkv'],
    minimumSizeBytes: 0,
    excludedMaterialKeys: [],
  };
  const policyBasis = {
    extractionPolicyId: 'policy-retry-http-1',
    revision: 1,
    ...policyValue,
  };
  const accessBasis = {
    fieldId: 'field-retry-http-1',
    revision: 1,
    endpointId: 'endpoint-retry-http-1',
    rootLocation: fieldRoot,
    mountScopeId: 'mount-retry-http-1',
    mountScopeRevision: 1,
    accessSchemaRef: 'helix://fixtures/http-retry-access/v1',
  };
  const registration = {
    idempotencyKey: 'field-retry-registration-1',
    fieldId: 'field-retry-http-1',
    name: 'Retry Source',
    contentProfileHint: 'movie',
    policy: {
      extractionPolicyId: 'policy-retry-http-1',
      revision: 1,
      policySchemaRef: 'helix://contracts/domain-types/ExtractionPolicy/v1',
      policy: policyValue,
      policyDigest: canonicalDigest(policyBasis),
    },
    access: { ...accessBasis, accessDigest: canonicalDigest(accessBasis) },
  };
  const observeCommand = {
    idempotencyKey: 'field-retry-observation-1',
    fieldId: 'field-retry-http-1',
    expectedAccessRevision: 1,
    expectedObservationRevision: 0,
    pageBudget: 10,
  };
  let host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
  });
  let cookie;
  try {
    let exchange = await host.inject({
      method: 'POST',
      url: '/v1/admin/session',
      headers: { 'x-api-key': value.initialized.adminApiKey },
    });
    cookie = exchange.headers['set-cookie'];
    let response = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields',
      headers: { cookie },
      payload: registration,
    });
    assert.equal(response.statusCode, 201, response.body);
    response = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields/field-retry-http-1/actions/observe',
      headers: { cookie },
      payload: observeCommand,
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().observation.state, 'succeeded');
  } finally {
    await host.close();
  }

  let kernel = openSqliteKernel({
    Database,
    databasePath,
    schemaDdl: cleanSchemaDdl,
    schemaManifest: cleanSchemaManifest,
  });
  let unitOfWork = createSqliteUnitOfWork({ kernel });
  const read = new Database(databasePath, { readonly: true });
  const material = read.prepare(
    `SELECT material_key
       FROM proc_field_materials
      WHERE field_id=?`
  ).get('field-retry-http-1');
  const originalRun = read.prepare(
    `SELECT procurement_run_id,run_basis_digest,state,state_revision
       FROM proc_procurement_runs
      WHERE field_id=?`
  ).get('field-retry-http-1');
  read.close();
  assert.equal(originalRun.state, 'active');
  assert.equal(originalRun.state_revision, 1);

  const failedSealValue = {
    decisionId: 'p14-http-failed-run-seal-decision',
    procurementRunId: originalRun.procurement_run_id,
    expectedStateRevision: 1,
    expectedRunBasisDigest: originalRun.run_basis_digest,
    sealOutcome: 'failed',
    publishedCandidates: [],
    releasedMembers: [{
      materialKey: material.material_key,
      disposition: 'triage_failed',
      evidenceDigest: canonicalDigest({
        schema: 'p14.formal-preparation-failure@1',
        procurementRunId: originalRun.procurement_run_id,
        materialKey: material.material_key,
      }),
    }],
  };
  const failedSealDecision = {
    ...failedSealValue,
    decisionDigest: canonicalDigest(failedSealValue),
  };
  const setupWorkId = 'p14-http-formal-failed-run-work';
  const setupBasisDigest = canonicalDigest({
    schema: 'p14.formal-failed-run-setup@1',
    runBasisDigest: originalRun.run_basis_digest,
    sealDecisionDigest: failedSealDecision.decisionDigest,
  });
  const setupAdmission = createWorkAdmission({
    schemaManifest: cleanSchemaManifest,
    unitOfWork,
    eligibilityProvider: {
      check: () => ({
        eligible: true,
        basisDigest: setupBasisDigest,
        reasonCode: 'NOT_APPLICABLE',
      }),
    },
    limits: { globalOpenWorks: 1_000, ownerOpenWorks: 500, openEvents: 100_000 },
  });
  assert.equal(setupAdmission.submit({
    schemaRef: 'helix://foundation/types/SupportingWorkDefinition/v1',
    schemaVersion: 1,
    workId: setupWorkId,
    ownerDomain: 'procurement',
    processType: 'procurement_run',
    processId: originalRun.procurement_run_id,
    workKind: 'p14_formal_failed_preparation',
    workObjectiveTypeRef: 'helix://procurement/work/Preparation/v1',
    workObjectiveVersion: 1,
    executionBasisId: 'p14-http-formal-failed-run-basis',
    executionBasisDigest: setupBasisDigest,
    dependencyRefs: [],
    priorityClass: 'normal_foreground',
    priorityRevision: 1,
    capabilityCatalogScope: 'procurement',
    workspaceMaterialScope: [],
    idempotencyKey: 'p14-http-formal-failed-run',
    concurrencyScope: 'field-retry-http-1/p14-formal-preparation',
    outputContractRef:
      'helix://contracts/application-types/ProcurementRunSealReceipt/v1',
  }).kind, 'admitted');
  const demand = { resourceKinds: ['cpu'] };
  const setupStep = (
    nodeId,
    eventId,
    capabilityRef,
    input,
    stepBasisDigest = setupBasisDigest,
  ) => ({
    nodeId,
    eventId,
    capabilityRef,
    effectClass: 'domain_fact_commit',
    inputSchemaRef: 'helix://fixtures/p14/formal-run-command/v1',
    input,
    parametersSchemaRef: 'helix://fixtures/p14/empty-parameters/v1',
    parameters: {},
    fenceSchemaRef: 'helix://fixtures/p14/formal-run-fence/v1',
    fenceBasis: {
      basisDigest: stepBasisDigest,
      inputSetDigest: canonicalDigest(input),
      eventFenceDigest: canonicalDigest({ schema: 'p14.event-fence@1', eventId }),
      effectScopeDigest: canonicalDigest({
        schema: 'p14.effect-scope@1',
        procurementRunId: originalRun.procurement_run_id,
        capabilityRef,
      }),
    },
    resourceDemandSchemaRef: 'helix://fixtures/p14/cpu-demand/v1',
    resourceDemand: { ...demand, demandDigest: canonicalDigest(demand) },
  });
  let setupRuntime = createSynchronousDomainWork({
    schemaManifest: cleanSchemaManifest,
    unitOfWork,
  });
  setupRuntime.activate({
    workId: setupWorkId,
    ownerDomain: 'procurement',
    basisDigest: setupBasisDigest,
    plannerRef: 'p14.formal-failed-run-planner@1',
    catalogDigest: canonicalDigest({
      schema: 'p14.formal-failed-run-catalog@1',
      capabilities: ['procurement.run.seal@1'],
    }),
    steps: [
      setupStep(
        'run-seal',
        'p14-http-failed-run-seal-event',
        'procurement.run.seal@1',
        { sealDecisionDigest: failedSealDecision.decisionDigest },
      ),
    ],
  });
  kernel.close();

  const retryCommand = {
    idempotencyKey: 'p14-http-failed-run-retry-1',
    fieldId: 'field-retry-http-1',
    failedProcurementRunId: originalRun.procurement_run_id,
    expectedFailedRunStateRevision: 2,
    expectedFailedRunBasisDigest: originalRun.run_basis_digest,
  };
  host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
  });
  try {
    const exchange = await host.inject({
      method: 'POST',
      url: '/v1/admin/session',
      headers: { 'x-api-key': value.initialized.adminApiKey },
    });
    cookie = exchange.headers['set-cookie'];
    const unauthorized = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields/field-retry-http-1/actions/retry-failed-preparation',
      payload: retryCommand,
    });
    assert.equal(unauthorized.statusCode, 401);
    const mismatch = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields/field-retry-http-1/actions/retry-failed-preparation',
      headers: { cookie },
      payload: {
        ...retryCommand,
        idempotencyKey: 'p14-http-retry-target-mismatch',
        fieldId: 'another-field',
      },
    });
    assert.equal(mismatch.statusCode, 400);
    assert.equal(mismatch.json().error.code, 'ADMIN_FIELD_TARGET_MISMATCH');
    const closed = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields/field-retry-http-1/actions/retry-failed-preparation',
      headers: { cookie },
      payload: {
        ...retryCommand,
        idempotencyKey: 'p14-http-retry-closed',
        unexpected: true,
      },
    });
    assert.equal(closed.statusCode, 400);
    const running = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields/field-retry-http-1/actions/retry-failed-preparation',
      headers: { cookie },
      payload: {
        ...retryCommand,
        idempotencyKey: 'p14-http-retry-running',
        expectedFailedRunStateRevision: 1,
      },
    });
    assert.equal(running.statusCode, 409, running.body);
  } finally {
    await host.close();
  }

  kernel = openSqliteKernel({
    Database,
    databasePath,
    schemaDdl: cleanSchemaDdl,
    schemaManifest: cleanSchemaManifest,
  });
  unitOfWork = createSqliteUnitOfWork({ kernel });
  setupRuntime = createSynchronousDomainWork({
    schemaManifest: cleanSchemaManifest,
    unitOfWork,
  });
  setupRuntime.beginEvent('p14-http-failed-run-seal-event');
  createProcurementRunSealStore({
    schemaManifest: cleanSchemaManifest,
    unitOfWork,
  }).seal({
    decision: failedSealDecision,
    commitMarker: {
      commitMarker: 'p14-http-failed-run-seal-marker',
      commitDigest: canonicalDigest({
        schema: 'p14.failed-run-seal-command@1',
        decisionDigest: failedSealDecision.decisionDigest,
      }),
    },
    resultBinding: {
      resultId: 'p14-http-failed-run-seal-result',
      eventId: 'p14-http-failed-run-seal-event',
    },
  });
  setupRuntime.completeEvent(
    'p14-http-failed-run-seal-event',
    'p14-http-failed-run-seal-result',
  );
  setupRuntime.complete(setupWorkId);
  kernel.close();

  host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
  });
  try {
    const exchange = await host.inject({
      method: 'POST',
      url: '/v1/admin/session',
      headers: { 'x-api-key': value.initialized.adminApiKey },
    });
    cookie = exchange.headers['set-cookie'];
    const fault = new Database(databasePath);
    fault.exec(`
      CREATE TRIGGER p14_retry_admission_fault
      BEFORE INSERT ON proc_procurement_runs
      WHEN NEW.retry_intent_id IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'p14-retry-admission-fault');
      END
    `);
    fault.close();
    const interrupted = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields/field-retry-http-1/actions/retry-failed-preparation',
      headers: { cookie },
      payload: retryCommand,
    });
    assert.equal(interrupted.statusCode, 400, interrupted.body);
    assert.equal(interrupted.json().error.details.reasonCode, 'SQLITE_CONSTRAINT_TRIGGER');
  } finally {
    await host.close();
  }
  const interruptedEvidence = new Database(databasePath);
  assert.deepEqual(
    interruptedEvidence.prepare(
      `SELECT state,state_revision,new_run_id
         FROM proc_procurement_retry_intents`
    ).get(),
    { state: 'open', state_revision: 1, new_run_id: null },
  );
  assert.equal(
    interruptedEvidence.prepare('SELECT count(*) count FROM proc_procurement_runs').get().count,
    1,
  );
  assert.deepEqual(
    interruptedEvidence.prepare(
      `SELECT state
         FROM fx_supporting_works
        WHERE work_kind='failed_preparation_retry'`
    ).get(),
    { state: 'running' },
  );
  assert.deepEqual(
    interruptedEvidence.prepare(
      `SELECT capability_ref,state
         FROM fx_workflow_events
        WHERE work_id=(SELECT work_id FROM fx_supporting_works
                        WHERE work_kind='failed_preparation_retry')
        ORDER BY capability_ref`
    ).all(),
    [
      { capability_ref: 'procurement.retry.admit@1', state: 'executing' },
      { capability_ref: 'procurement.retry.intent.create@1', state: 'succeeded' },
    ],
  );
  assert.equal(
    interruptedEvidence.prepare(
      `SELECT count(*) count
         FROM fx_commit_markers
        WHERE scope_type='procurement_retry_intent'`
    ).get().count,
    1,
  );
  interruptedEvidence.exec('DROP TRIGGER p14_retry_admission_fault');
  interruptedEvidence.close();

  let createdResult;
  host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
  });
  try {
    const exchange = await host.inject({
      method: 'POST',
      url: '/v1/admin/session',
      headers: { 'x-api-key': value.initialized.adminApiKey },
    });
    cookie = exchange.headers['set-cookie'];
    const resumed = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields/field-retry-http-1/actions/retry-failed-preparation',
      headers: { cookie },
      payload: retryCommand,
    });
    assert.equal(resumed.statusCode, 200, resumed.body);
    createdResult = resumed.json().retry;
    assert.equal(createdResult.state, 'succeeded');
    assert.equal(createdResult.retryIntentReceipt.intentState, 'open');
    assert.equal(createdResult.retryAdmissionResult.resultKind, 'created');
    const replay = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields/field-retry-http-1/actions/retry-failed-preparation',
      headers: { cookie },
      payload: retryCommand,
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.deepEqual(
      replay.json().retry.retryAdmissionResult,
      createdResult.retryAdmissionResult,
    );
    const conflict = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields/field-retry-http-1/actions/retry-failed-preparation',
      headers: { cookie },
      payload: {
        ...retryCommand,
        expectedFailedRunStateRevision: 3,
      },
    });
    assert.equal(conflict.statusCode, 409, conflict.body);
    assert.equal(conflict.json().error.code, 'ADMIN_FIELD_IDEMPOTENCY_CONFLICT');
    const duplicate = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields/field-retry-http-1/actions/retry-failed-preparation',
      headers: { cookie },
      payload: {
        ...retryCommand,
        idempotencyKey: 'p14-http-failed-run-retry-duplicate',
      },
    });
    assert.equal(duplicate.statusCode, 409, duplicate.body);
    const absent = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields/field-retry-http-1/actions/retry-failed-preparation',
      headers: { cookie },
      payload: {
        ...retryCommand,
        idempotencyKey: 'p14-http-failed-run-retry-absent',
        failedProcurementRunId: 'missing-run',
      },
    });
    assert.equal(absent.statusCode, 409, absent.body);
  } finally {
    await host.close();
  }

  host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
  });
  try {
    const exchange = await host.inject({
      method: 'POST',
      url: '/v1/admin/session',
      headers: { 'x-api-key': value.initialized.adminApiKey },
    });
    const restartedReplay = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields/field-retry-http-1/actions/retry-failed-preparation',
      headers: { cookie: exchange.headers['set-cookie'] },
      payload: retryCommand,
    });
    assert.equal(restartedReplay.statusCode, 200, restartedReplay.body);
    assert.deepEqual(
      restartedReplay.json().retry.retryAdmissionResult,
      createdResult.retryAdmissionResult,
    );
  } finally {
    await host.close();
  }

  const completedEvidence = new Database(databasePath, { readonly: true });
  const runs = completedEvidence.prepare(
    `SELECT procurement_run_id,retry_intent_id,state,state_revision,run_basis_digest
       FROM proc_procurement_runs
      ORDER BY created_at_ms,procurement_run_id`
  ).all();
  assert.equal(runs.length, 2);
  const retryRun = runs.find((run) => run.retry_intent_id !== null);
  assert.equal(retryRun.state, 'active');
  assert.equal(retryRun.state_revision, 1);
  assert.equal(
    completedEvidence.prepare(
      `SELECT count(*) count
         FROM proc_procurement_runs
        WHERE retry_intent_id IS NOT NULL`
    ).get().count,
    1,
  );
  assert.deepEqual(
    completedEvidence.prepare(
      `SELECT state,state_revision,new_run_id
         FROM proc_procurement_retry_intents`
    ).get(),
    {
      state: 'consumed',
      state_revision: 2,
      new_run_id: retryRun.procurement_run_id,
    },
  );
  assert.equal(
    completedEvidence.prepare(
      `SELECT state
         FROM fx_supporting_works
        WHERE work_kind='failed_preparation_retry'`
    ).get().state,
    'succeeded',
  );
  const retryAdmissionPlanInput = completedEvidence.prepare(
    `SELECT input_bindings_json
       FROM fx_plan_nodes
      WHERE capability_ref='procurement.retry.admit@1'`
  ).get();
  assert.ok(retryAdmissionPlanInput);
  assert.ok(Buffer.byteLength(retryAdmissionPlanInput.input_bindings_json) <= 16 * 1024);
  assert.equal(
    Object.hasOwn(
      JSON.parse(retryAdmissionPlanInput.input_bindings_json).admissionRequest,
      'controlHandle',
    ),
    false,
  );
  completedEvidence.close();

  kernel = openSqliteKernel({
    Database,
    databasePath,
    schemaDdl: cleanSchemaDdl,
    schemaManifest: cleanSchemaManifest,
  });
  unitOfWork = createSqliteUnitOfWork({ kernel });
  const completedSealValue = {
    decisionId: 'p14-http-retry-run-completed-decision',
    procurementRunId: retryRun.procurement_run_id,
    expectedStateRevision: 1,
    expectedRunBasisDigest: retryRun.run_basis_digest,
    sealOutcome: 'completed',
    publishedCandidates: [],
    releasedMembers: [{
      materialKey: material.material_key,
      disposition: 'completed_without_candidate',
      evidenceDigest: canonicalDigest({
        schema: 'p14.retry-run-completed@1',
        procurementRunId: retryRun.procurement_run_id,
        materialKey: material.material_key,
      }),
    }],
  };
  const completedSealDecision = {
    ...completedSealValue,
    decisionDigest: canonicalDigest(completedSealValue),
  };
  const completedWorkBasis = canonicalDigest({
    schema: 'p14.completed-run-seal-work@1',
    decisionDigest: completedSealDecision.decisionDigest,
  });
  const completedWorkId = 'p14-http-retry-run-completed-work';
  const completedWorkAdmission = createWorkAdmission({
    schemaManifest: cleanSchemaManifest,
    unitOfWork,
    eligibilityProvider: {
      check: () => ({
        eligible: true,
        basisDigest: completedWorkBasis,
        reasonCode: 'NOT_APPLICABLE',
      }),
    },
    limits: { globalOpenWorks: 1_000, ownerOpenWorks: 500, openEvents: 100_000 },
  });
  assert.equal(completedWorkAdmission.submit({
    schemaRef: 'helix://foundation/types/SupportingWorkDefinition/v1',
    schemaVersion: 1,
    workId: completedWorkId,
    ownerDomain: 'procurement',
    processType: 'procurement_run',
    processId: retryRun.procurement_run_id,
    workKind: 'p14_formal_completed_preparation',
    workObjectiveTypeRef: 'helix://procurement/work/Preparation/v1',
    workObjectiveVersion: 1,
    executionBasisId: 'p14-http-retry-run-completed-basis',
    executionBasisDigest: completedWorkBasis,
    dependencyRefs: [],
    priorityClass: 'normal_foreground',
    priorityRevision: 1,
    capabilityCatalogScope: 'procurement',
    workspaceMaterialScope: [],
    idempotencyKey: 'p14-http-retry-run-completed',
    concurrencyScope: 'field-retry-http-1/p14-completed-preparation',
    outputContractRef:
      'helix://contracts/application-types/ProcurementRunSealReceipt/v1',
  }).kind, 'admitted');
  const completedRuntime = createSynchronousDomainWork({
    schemaManifest: cleanSchemaManifest,
    unitOfWork,
  });
  const completedEventId = 'p14-http-retry-run-completed-event';
  completedRuntime.activate({
    workId: completedWorkId,
    ownerDomain: 'procurement',
    basisDigest: completedWorkBasis,
    plannerRef: 'p14.completed-run-seal-planner@1',
    catalogDigest: canonicalDigest({
      schema: 'p14.completed-run-seal-catalog@1',
      capabilities: ['procurement.run.seal@1'],
    }),
    steps: [setupStep(
      'completed-run-seal',
      completedEventId,
      'procurement.run.seal@1',
      { decisionDigest: completedSealDecision.decisionDigest },
      completedWorkBasis,
    )],
  });
  completedRuntime.beginEvent(completedEventId);
  createProcurementRunSealStore({
    schemaManifest: cleanSchemaManifest,
    unitOfWork,
  }).seal({
    decision: completedSealDecision,
    commitMarker: {
      commitMarker: 'p14-http-retry-run-completed-marker',
      commitDigest: canonicalDigest({
        schema: 'p14.completed-run-seal-command@1',
        decisionDigest: completedSealDecision.decisionDigest,
      }),
    },
    resultBinding: {
      resultId: 'p14-http-retry-run-completed-result',
      eventId: completedEventId,
    },
  });
  completedRuntime.completeEvent(
    completedEventId,
    'p14-http-retry-run-completed-result',
  );
  completedRuntime.complete(completedWorkId);
  kernel.close();

  host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
  });
  try {
    const exchange = await host.inject({
      method: 'POST',
      url: '/v1/admin/session',
      headers: { 'x-api-key': value.initialized.adminApiKey },
    });
    const completedTarget = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields/field-retry-http-1/actions/retry-failed-preparation',
      headers: { cookie: exchange.headers['set-cookie'] },
      payload: {
        idempotencyKey: 'p14-http-completed-run-retry',
        fieldId: 'field-retry-http-1',
        failedProcurementRunId: retryRun.procurement_run_id,
        expectedFailedRunStateRevision: 2,
        expectedFailedRunBasisDigest: retryRun.run_basis_digest,
      },
    });
    assert.equal(completedTarget.statusCode, 409, completedTarget.body);
  } finally {
    await host.close();
  }
  assert.deepEqual(fs.readFileSync(sourceFile), sourceBefore);
});

test('Arca Shelf projection reads use the authenticated public HTTP path and owner-local query repository', async () => {
  const value = fixture();
  const placementValue = { folderTemplate: '{title} ({year})', primaryTemplate:'{stem}{ext}',
    nfoTemplate:'{stem}.nfo', subtitleTemplate:'{stem}{language}{forced}{sdh}{ext}',
    posterTemplate:'poster{ext}', fanartTemplate:'fanart{ext}', collisionPolicy: 'reject' };
  const physicalShelfRoot = path.join(path.dirname(value.dataDir), 'physical-shelf');
  const physicalSentinel = path.join(physicalShelfRoot, 'movie.mkv');
  const nextPhysicalShelfRoot = path.join(path.dirname(value.dataDir), 'next-physical-shelf');
  const nextPhysicalSentinel = path.join(nextPhysicalShelfRoot, 'existing.txt');
  fs.mkdirSync(physicalShelfRoot);
  fs.mkdirSync(nextPhysicalShelfRoot);
  fs.writeFileSync(physicalSentinel, Buffer.from('immutable-physical-media-snapshot'));
  fs.writeFileSync(nextPhysicalSentinel, Buffer.from('immutable-target-folder-snapshot'));
  const physicalBefore = fs.readFileSync(physicalSentinel);
  const nextPhysicalBefore = fs.readFileSync(nextPhysicalSentinel);
  const body = {
    idempotencyKey: 'shelf-http-create-1', shelfId: 'shelf-http-1', name: 'Movies',
    targetRootLocation: physicalShelfRoot,
    ruleTemplateId: 'system-beta-recommended', expectedTemplateRevision: 1,
    placementPolicy: placementValue,
  };
  let deregistrationCommand;
  let deregistrationId;
  let placementCommand;
  let resolvedPlacementTarget;
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
      ruleTemplateId: 'missing-template',
    } });
    assert.equal(rejected.statusCode, 400);
    assert.equal(rejected.json().error.code, 'ADMIN_SHELF_COMMAND_REJECTED');
    const standardCommand = {
      idempotencyKey: 'shelf-http-standard-2', shelfId: 'shelf-http-1', expectedStandardRevision: 1, expectedRoutingProjectionRevision: 1,
      ruleTemplateId: 'system-beta-recommended', expectedTemplateRevision: 1,
    };
    const standardRevision = await host.inject({ method: 'POST', url: '/v1/admin/shelves/shelf-http-1/actions/bind-template', headers: { cookie }, payload: standardCommand });
    assert.equal(standardRevision.statusCode, 200);
    assert.equal(standardRevision.json().binding.standard.standardRevision, 2);
    assert.equal(standardRevision.json().binding.routingProjection.revision, 2);
    const standardReplay = await host.inject({ method: 'POST', url: '/v1/admin/shelves/shelf-http-1/actions/bind-template', headers: { cookie }, payload: standardCommand });
    assert.equal(standardReplay.statusCode, 200);
    assert.equal(standardReplay.json().binding.standard.ruleTemplateId, 'system-beta-recommended');
    const standardMismatch = await host.inject({ method: 'POST', url: '/v1/admin/shelves/shelf-http-1/actions/bind-template', headers: { cookie }, payload: { ...standardCommand, idempotencyKey: 'standard-target-mismatch', shelfId: 'other-shelf' } });
    assert.equal(standardMismatch.statusCode, 400);
    assert.equal(standardMismatch.json().error.code, 'ADMIN_SHELF_TARGET_MISMATCH');
    const standardStale = await host.inject({ method: 'POST', url: '/v1/admin/shelves/shelf-http-1/actions/bind-template', headers: { cookie }, payload: { ...standardCommand, idempotencyKey: 'standard-stale' } });
    assert.equal(standardStale.statusCode, 409);
    const renameCommand = {
      idempotencyKey: 'shelf-http-rename-1', shelfId: 'shelf-http-1',
      expectedUpdatedAtMs: (await host.inject({ method: 'GET', url: '/v1/admin/shelves/shelf-http-1', headers: { cookie } })).json().shelf.updatedAtMs, name: 'Movie Library',
    };
    const renameUnauthenticated = await host.inject({ method: 'PATCH', url: '/v1/admin/shelves/shelf-http-1', payload: renameCommand });
    assert.equal(renameUnauthenticated.statusCode, 401);
    const renamed = await host.inject({ method: 'PATCH', url: '/v1/admin/shelves/shelf-http-1', headers: { cookie }, payload: renameCommand });
    assert.equal(renamed.statusCode, 200);
    assert.equal(renamed.json().shelf.name, 'Movie Library');
    assert.ok(renamed.json().shelf.updatedAtMs > renameCommand.expectedUpdatedAtMs);
    const renameReplay = await host.inject({ method: 'PATCH', url: '/v1/admin/shelves/shelf-http-1', headers: { cookie }, payload: renameCommand });
    assert.equal(renameReplay.statusCode, 200);
    assert.equal(renameReplay.json().replayed, true);
    const renameConflict = await host.inject({ method: 'PATCH', url: '/v1/admin/shelves/shelf-http-1', headers: { cookie }, payload: { ...renameCommand, name: 'Conflicting Name' } });
    assert.equal(renameConflict.statusCode, 409);
    const renameMismatch = await host.inject({ method: 'PATCH', url: '/v1/admin/shelves/shelf-http-1', headers: { cookie }, payload: { ...renameCommand, idempotencyKey: 'rename-target-mismatch', shelfId: 'other-shelf' } });
    assert.equal(renameMismatch.statusCode, 400);
    const renameClosed = await host.inject({ method: 'PATCH', url: '/v1/admin/shelves/shelf-http-1', headers: { cookie }, payload: { ...renameCommand, idempotencyKey: 'rename-closed-input', unexpected: true } });
    assert.equal(renameClosed.statusCode, 400);
    const renameStale = await host.inject({ method: 'PATCH', url: '/v1/admin/shelves/shelf-http-1', headers: { cookie }, payload: { ...renameCommand, idempotencyKey: 'rename-stale' } });
    assert.equal(renameStale.statusCode, 400);
    const placementValue2 = { ...placementValue, collisionPolicy: 'suffix' };
    const placementDraft = {
      shelfId: 'shelf-http-1', expectedPlacementRevision: 1,
      target: {
        endpointId: 'shelf-endpoint-2',
        rootLocation: nextPhysicalShelfRoot,
        mountScopeId: 'shelf-mount-2',
        mountScopeRevision: 2,
      },
      placement: {
        schemaRef: 'helix://contracts/policies/ArcaShelfPlacementPolicy/v1',
        value: placementValue2,
        digest: canonicalDigest(placementValue2),
      },
    };
    const unavailableTarget = path.join(path.dirname(value.dataDir), 'missing-target');
    const unavailablePreview = await host.inject({
      method: 'POST',
      url: '/v1/admin/shelves/shelf-http-1/placement/actions/preview',
      headers: { cookie },
      payload: {
        idempotencyKey: 'placement-preview-unavailable-target',
        ...placementDraft,
        target: { ...placementDraft.target, rootLocation: unavailableTarget },
      },
    });
    assert.equal(unavailablePreview.statusCode, 400);
    assert.equal(
      unavailablePreview.json().error.details.reasonCode,
      'P14_SHELF_TARGET_UNAVAILABLE',
    );
    assert.equal(fs.existsSync(unavailableTarget), false);
    const placementPreview = await host.inject({ method: 'POST', url: '/v1/admin/shelves/shelf-http-1/placement/actions/preview', headers: { cookie }, payload: {
      idempotencyKey: 'shelf-http-placement-preview-2', ...placementDraft,
    } });
    assert.equal(placementPreview.statusCode, 200, placementPreview.body);
    assert.equal(placementPreview.json().physicalEffect, 'none');
    assert.equal(placementPreview.json().affectedActiveEntryCount, 0);
    assert.equal(placementPreview.json().proposedTarget.rootLocation, fs.realpathSync(nextPhysicalShelfRoot));
    assert.equal(placementPreview.json().targetReadinessEvidence.observationMode, 'read_only');
    assert.equal(placementPreview.json().targetReadinessEvidence.safeMaterialCommit, true);
    resolvedPlacementTarget = placementPreview.json().proposedTarget;
    const placementPreviewReplay = await host.inject({ method: 'POST', url: '/v1/admin/shelves/shelf-http-1/placement/actions/preview', headers: { cookie }, payload: {
      idempotencyKey: 'shelf-http-placement-preview-2', ...placementDraft,
    } });
    assert.equal(placementPreviewReplay.statusCode, 200);
    assert.equal(placementPreviewReplay.json().replayed, true);
    assert.equal(placementPreviewReplay.json().previewDigest, placementPreview.json().previewDigest);
    const placementPreviewConflict = await host.inject({ method: 'POST', url: '/v1/admin/shelves/shelf-http-1/placement/actions/preview', headers: { cookie }, payload: {
      idempotencyKey: 'shelf-http-placement-preview-2', ...placementDraft,
      placement: { ...placementDraft.placement, value: placementValue },
    } });
    assert.equal(placementPreviewConflict.statusCode, 409);
    const placementPreviewMismatch = await host.inject({ method: 'POST', url: '/v1/admin/shelves/shelf-http-1/placement/actions/preview', headers: { cookie }, payload: {
      idempotencyKey: 'placement-preview-target-mismatch', ...placementDraft, shelfId: 'other-shelf',
    } });
    assert.equal(placementPreviewMismatch.statusCode, 400);
    const placementPreviewClosed = await host.inject({ method: 'POST', url: '/v1/admin/shelves/shelf-http-1/placement/actions/preview', headers: { cookie }, payload: {
      idempotencyKey: 'placement-preview-closed', ...placementDraft, unexpected: true,
    } });
    assert.equal(placementPreviewClosed.statusCode, 400);
    placementCommand = {
      idempotencyKey: 'shelf-http-placement-2', ...placementDraft,
      expectedCurrentTargetDigest: placementPreview.json().currentTargetDigest,
      previewId: placementPreview.json().previewId, previewDigest: placementPreview.json().previewDigest,
    };
    const placementFaultDatabase = new Database(path.join(value.dataDir, 'shelfdeck.db'));
    placementFaultDatabase.exec(`
      CREATE TRIGGER p14_placement_publish_fault
      BEFORE INSERT ON arca_placement_policy_revisions
      BEGIN
        SELECT RAISE(ABORT, 'p14-placement-publish-fault');
      END
    `);
    placementFaultDatabase.close();
    const placementCrash = await host.inject({ method: 'PATCH', url: '/v1/admin/shelves/shelf-http-1/placement', headers: { cookie }, payload: {
      ...placementCommand, idempotencyKey: 'placement-publish-crash',
    } });
    assert.equal(placementCrash.statusCode, 400);
    const placementCrashEvidence = new Database(path.join(value.dataDir, 'shelfdeck.db'));
    assert.equal(placementCrashEvidence.prepare("SELECT count(*) AS count FROM arca_placement_policy_revisions WHERE shelf_id='shelf-http-1' AND revision=2").get().count, 0);
    assert.equal(placementCrashEvidence.prepare("SELECT count(*) AS count FROM fx_command_receipts WHERE owner_domain='arca' AND idempotency_key='placement-publish-crash'").get().count, 0);
    assert.deepEqual(
      placementCrashEvidence.prepare('SELECT target_endpoint_id,target_root_location,target_mount_scope_id,target_mount_scope_revision,current_placement_revision FROM arca_shelves WHERE shelf_id=?').get('shelf-http-1'),
      {
        target_endpoint_id: created.json().shelf.target.endpointId,
        target_root_location: created.json().shelf.target.rootLocation,
        target_mount_scope_id: created.json().shelf.target.mountScopeId,
        target_mount_scope_revision: created.json().shelf.target.mountScopeRevision,
        current_placement_revision: 1,
      },
    );
    placementCrashEvidence.exec('DROP TRIGGER p14_placement_publish_fault');
    placementCrashEvidence.close();
    const placementRevision = await host.inject({ method: 'PATCH', url: '/v1/admin/shelves/shelf-http-1/placement', headers: { cookie }, payload: placementCommand });
    assert.equal(placementRevision.statusCode, 200, placementRevision.body);
    assert.equal(placementRevision.json().shelf.currentPlacementRevision, 2);
    assert.deepEqual(placementRevision.json().shelf.target, resolvedPlacementTarget);
    const placementReplay = await host.inject({ method: 'PATCH', url: '/v1/admin/shelves/shelf-http-1/placement', headers: { cookie }, payload: placementCommand });
    assert.equal(placementReplay.statusCode, 200);
    assert.equal(placementReplay.json().replayed, true);
    const placementConflict = await host.inject({ method: 'PATCH', url: '/v1/admin/shelves/shelf-http-1/placement', headers: { cookie }, payload: { ...placementCommand, placement: { ...placementCommand.placement, value: placementValue } } });
    assert.equal(placementConflict.statusCode, 409);
    const invalidPlacement = await host.inject({ method: 'PATCH', url: '/v1/admin/shelves/shelf-http-1/placement', headers: { cookie }, payload: { ...placementCommand, idempotencyKey: 'placement-invalid', placement: { ...placementCommand.placement, digest: '0'.repeat(64) } } });
    assert.equal(invalidPlacement.statusCode, 400);
    const stalePlacement = await host.inject({ method: 'PATCH', url: '/v1/admin/shelves/shelf-http-1/placement', headers: { cookie }, payload: { ...placementCommand, idempotencyKey: 'placement-stale' } });
    assert.equal(stalePlacement.statusCode, 409);
    const listed = await host.inject({ method: 'GET', url: '/v1/admin/shelves', headers: { cookie } });
    assert.equal(listed.statusCode, 200);
    assert.deepEqual(listed.json().items.map((item) => item.shelfId), ['shelf-http-1']);
    const exact = await host.inject({ method: 'GET', url: '/v1/admin/shelves/shelf-http-1', headers: { cookie } });
    assert.equal(exact.statusCode, 200);
    assert.equal(exact.json().shelf.name, 'Movie Library');
    assert.equal(
      exact.json().shelf.standard.digest,
      standardRevision.json().binding.standard.standardDigest,
    );
    assert.equal(exact.json().shelf.placement.digest, canonicalDigest(placementValue2));
    const currentStandard = await host.inject({ method: 'GET', url: '/v1/admin/shelves/shelf-http-1/standard', headers: { cookie } });
    assert.equal(currentStandard.statusCode, 200);
    assert.equal(currentStandard.json().standard.revision, 2);
    const currentPlacement = await host.inject({ method: 'GET', url: '/v1/admin/shelves/shelf-http-1/placement', headers: { cookie } });
    assert.equal(currentPlacement.statusCode, 200);
    assert.equal(currentPlacement.json().placement.revision, 2);
    assert.equal(currentPlacement.json().target.rootLocation, fs.realpathSync(nextPhysicalShelfRoot));
    assert.deepEqual(fs.readFileSync(physicalSentinel), physicalBefore);
    assert.deepEqual(fs.readdirSync(physicalShelfRoot), ['movie.mkv']);
    assert.deepEqual(fs.readFileSync(nextPhysicalSentinel), nextPhysicalBefore);
    assert.deepEqual(fs.readdirSync(nextPhysicalShelfRoot), ['existing.txt']);
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
    deregistrationCommand = {
      idempotencyKey: 'shelf-http-deregister-1',
      shelfId: 'shelf-http-1',
      expectedStatus: 'active',
      expectedUpdatedAtMs: exact.json().shelf.updatedAtMs,
      expectedRoutingProjectionRevision: 2,
      confirmation: {
        decision: 'deregister_shelf',
        enteredShelfName: 'Movie Library',
        preservePhysicalFilesAcknowledged: true,
        releaseControlAcknowledged: true,
      },
    };
    const deregistrationUnauthenticated = await host.inject({
      method: 'POST',
      url: '/v1/admin/shelves/shelf-http-1/actions/deregister',
      payload: deregistrationCommand,
    });
    assert.equal(deregistrationUnauthenticated.statusCode, 401);
    const deregistrationTargetMismatch = await host.inject({
      method: 'POST',
      url: '/v1/admin/shelves/shelf-http-1/actions/deregister',
      headers: { cookie },
      payload: { ...deregistrationCommand, idempotencyKey: 'deregister-target-mismatch', shelfId: 'other-shelf' },
    });
    assert.equal(deregistrationTargetMismatch.statusCode, 400);
    const deregistrationClosed = await host.inject({
      method: 'POST',
      url: '/v1/admin/shelves/shelf-http-1/actions/deregister',
      headers: { cookie },
      payload: { ...deregistrationCommand, idempotencyKey: 'deregister-closed-input', unexpected: true },
    });
    assert.equal(deregistrationClosed.statusCode, 400);
    const deregistrationAcknowledgementMissing = await host.inject({
      method: 'POST',
      url: '/v1/admin/shelves/shelf-http-1/actions/deregister',
      headers: { cookie },
      payload: {
        ...deregistrationCommand,
        idempotencyKey: 'deregister-acknowledgement-missing',
        confirmation: { ...deregistrationCommand.confirmation, preservePhysicalFilesAcknowledged: false },
      },
    });
    assert.equal(deregistrationAcknowledgementMissing.statusCode, 400);
    const deregistrationStale = await host.inject({
      method: 'POST',
      url: '/v1/admin/shelves/shelf-http-1/actions/deregister',
      headers: { cookie },
      payload: { ...deregistrationCommand, idempotencyKey: 'deregister-stale', expectedUpdatedAtMs: deregistrationCommand.expectedUpdatedAtMs - 1 },
    });
    assert.equal(deregistrationStale.statusCode, 400);
    const deregistered = await host.inject({
      method: 'POST',
      url: '/v1/admin/shelves/shelf-http-1/actions/deregister',
      headers: { cookie },
      payload: deregistrationCommand,
    });
    assert.equal(deregistered.statusCode, 202, deregistered.body);
    assert.equal(typeof deregistered.json().deregistrationId, 'string');
    deregistrationId = deregistered.json().deregistrationId;
    let deregisteredShelf = null;
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const response = await host.inject({ method:'GET', url:'/v1/admin/shelves/shelf-http-1', headers:{ cookie } });
      if (response.statusCode === 200 && response.json().shelf.status === 'deregistered') { deregisteredShelf = response.json().shelf; break; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(deregisteredShelf?.status, 'deregistered');
    assert.equal(deregisteredShelf.routingProjection.revision, 4);
    const deregistrationReplay = await host.inject({
      method: 'POST',
      url: '/v1/admin/shelves/shelf-http-1/actions/deregister',
      headers: { cookie },
      payload: deregistrationCommand,
    });
    assert.equal(deregistrationReplay.statusCode, 202);
    assert.equal(deregistrationReplay.json().replayed, true);
    assert.equal(deregistrationReplay.json().deregistrationId, deregistrationId);
    const deregistrationConflict = await host.inject({
      method: 'POST',
      url: '/v1/admin/shelves/shelf-http-1/actions/deregister',
      headers: { cookie },
      payload: {
        ...deregistrationCommand,
        confirmation: { ...deregistrationCommand.confirmation, enteredShelfName: 'Conflicting Shelf' },
      },
    });
    assert.equal(deregistrationConflict.statusCode, 409);
    const inactivePlacementPreview = await host.inject({
      method: 'POST',
      url: '/v1/admin/shelves/shelf-http-1/placement/actions/preview',
      headers: { cookie },
      payload: {
        idempotencyKey: 'placement-preview-inactive-shelf',
        shelfId: 'shelf-http-1',
        expectedPlacementRevision: 2,
        target: placementDraft.target,
        placement: placementDraft.placement,
      },
    });
    assert.equal(inactivePlacementPreview.statusCode, 409);
    assert.equal(inactivePlacementPreview.json().error.code, 'ADMIN_SHELF_CONFLICT');
    const inactiveRoutingPreview = await host.inject({
      method: 'POST',
      url: '/v1/admin/routing/material-fields/field-http-1/actions/preview',
      headers: { cookie },
      payload: {
        idempotencyKey: 'routing-preview-deregistered-shelf',
        fieldId: 'field-http-1',
        policy: routingPolicy,
        facts: [],
      },
    });
    assert.equal(inactiveRoutingPreview.statusCode, 400);
    assert.equal(inactiveRoutingPreview.json().error.details.reasonCode, 'P14_ROUTING_TARGET_INACTIVE');
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const evidence = new Database(path.join(value.dataDir, 'shelfdeck.db'), { readonly:true });
      const count = evidence.prepare("SELECT count(*) AS count FROM fx_event_result_bindings WHERE result_schema_ref='helix://contracts/types/DeregistrationReceipt/v1'").get().count;
      evidence.close();
      if (count === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.deepEqual(fs.readFileSync(physicalSentinel), physicalBefore);
    assert.deepEqual(fs.readdirSync(physicalShelfRoot), ['movie.mkv']);
    assert.deepEqual(fs.readFileSync(nextPhysicalSentinel), nextPhysicalBefore);
    assert.deepEqual(fs.readdirSync(nextPhysicalShelfRoot), ['existing.txt']);
  } finally { await host.close(); }
  const ownerEvidence = new Database(path.join(value.dataDir, 'shelfdeck.db'), { readonly: true });
  try {
    assert.deepEqual(ownerEvidence.prepare('SELECT revision FROM arca_shelf_standard_revisions WHERE shelf_id=? ORDER BY revision').all('shelf-http-1').map((row) => row.revision), [1, 2]);
    assert.deepEqual(ownerEvidence.prepare('SELECT revision FROM arca_placement_policy_revisions WHERE shelf_id=? ORDER BY revision').all('shelf-http-1').map((row) => row.revision), [1, 2]);
    assert.deepEqual(ownerEvidence.prepare('SELECT current_standard_revision,current_placement_revision,routing_projection_revision FROM arca_shelves WHERE shelf_id=?').get('shelf-http-1'), {
      current_standard_revision: 2, current_placement_revision: 2, routing_projection_revision: 4,
    });
    assert.deepEqual(
      ownerEvidence.prepare('SELECT target_endpoint_id,target_root_location,target_mount_scope_id,target_mount_scope_revision FROM arca_shelves WHERE shelf_id=?').get('shelf-http-1'),
      {
        target_endpoint_id: 'local-filesystem-' + process.platform,
        target_root_location: fs.realpathSync(nextPhysicalShelfRoot),
        target_mount_scope_id: resolvedPlacementTarget.mountScopeId,
        target_mount_scope_revision: resolvedPlacementTarget.mountScopeRevision,
      },
    );
    assert.equal(ownerEvidence.prepare("SELECT count(*) AS count FROM fx_command_receipts WHERE owner_domain='arca' AND target_id='shelf-http-1'").get().count, 5);
    assert.equal(ownerEvidence.prepare('SELECT state,release_manifest_digest FROM arca_deregistrations WHERE shelf_id=?').get('shelf-http-1').state, 'committed');
    assert.equal(ownerEvidence.prepare('SELECT count(*) AS count FROM arca_deregistration_releases').get().count, 0);
    assert.equal(ownerEvidence.prepare('SELECT count(*) AS count FROM arca_deregistration_receipts WHERE shelf_id=?').get('shelf-http-1').count, 1);
    const deregistrationBindings=ownerEvidence.prepare("SELECT event_id,result_schema_ref,outcome_kind FROM fx_event_result_bindings WHERE event_id IN (SELECT event_id FROM fx_workflow_events WHERE capability_ref='arca.shelf_deregistration.commit@1')").all();
    assert.equal(deregistrationBindings.length, 1, JSON.stringify({deregistrationBindings,events:ownerEvidence.prepare("SELECT event_id,state FROM fx_workflow_events WHERE capability_ref='arca.shelf_deregistration.commit@1'").all()}));
    assert.equal(deregistrationBindings[0].result_schema_ref,'helix://contracts/capabilities/arca.shelf_deregistration.commit/v1/result');
    const deregistrationMarkers=ownerEvidence.prepare("SELECT commit_marker,scope_type,scope_id,result_schema_ref FROM fx_commit_markers WHERE owner_domain='arca'").all();
    assert.equal(deregistrationMarkers.filter((row)=>row.commit_marker.startsWith('arca-deregistration-effect-marker-')&&row.scope_type==='arca_shelf_deregistration').length,1,JSON.stringify(deregistrationMarkers));
    assert.equal(ownerEvidence.prepare('SELECT count(*) AS count FROM arca_shelf_entries WHERE shelf_id=?').get('shelf-http-1').count, 0);
    assert.equal(ownerEvidence.prepare('SELECT count(*) AS count FROM fx_material_controls').get().count, 0);
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
    assert.equal(exact.json().shelf.routingProjection.revision, 4);
    assert.equal(exact.json().shelf.status, 'deregistered');
    assert.equal(exact.json().shelf.name, 'Movie Library');
    assert.equal(exact.json().shelf.standard.revision, 2);
    assert.equal(exact.json().shelf.placement.revision, 2);
    assert.equal(exact.json().shelf.target.rootLocation, fs.realpathSync(nextPhysicalShelfRoot));
    const placementReplay = await restarted.inject({
      method: 'PATCH',
      url: '/v1/admin/shelves/shelf-http-1/placement',
      headers: { cookie: exchange.headers['set-cookie'] },
      payload: placementCommand,
    });
    assert.equal(placementReplay.statusCode, 200);
    assert.equal(placementReplay.json().replayed, true);
    assert.equal(placementReplay.json().shelf.target.endpointId,
      resolvedPlacementTarget.endpointId);
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
    const deregistrationReplay = await restarted.inject({
      method: 'POST',
      url: '/v1/admin/shelves/shelf-http-1/actions/deregister',
      headers: { cookie: exchange.headers['set-cookie'] },
      payload: deregistrationCommand,
    });
    assert.equal(deregistrationReplay.statusCode, 202);
    assert.equal(deregistrationReplay.json().replayed, true);
    assert.equal(deregistrationReplay.json().deregistrationId, deregistrationId);
    assert.deepEqual(fs.readFileSync(physicalSentinel), physicalBefore);
    assert.deepEqual(fs.readFileSync(nextPhysicalSentinel), nextPhysicalBefore);
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
    assert.equal((await health.json()).generation, 'helix-clean-v3');
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
    const fieldRoot = path.join(path.dirname(value.dataDir), 'formal-http');
    fs.mkdirSync(path.join(fieldRoot, 'formal-http'), { recursive: true });
    const policyValue = {
      includedDirectories: ['formal-http'], excludedDirectories: [], allowedExtensions: ['.mkv'],
      minimumSizeBytes: 0, excludedMaterialKeys: [],
    };
    const policyBasis = { extractionPolicyId: 'policy-formal-http-1', revision: 1, ...policyValue };
    const accessBasis = {
      fieldId: 'field-formal-http-1', revision: 1, endpointId: 'endpoint-formal-http-1', rootLocation: fieldRoot,
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

test('service entrypoint accepts explicit isolated Libra and Aftercare Workspace roots', () => {
  const { runtimeOptions } = require('../../src/server');
  const options=runtimeOptions({MEDIA_SERVICE_DATA_DIR:'F:/uat/data',MEDIA_SERVICE_ADMIN_DIST_DIR:'F:/uat/admin',
    LIBRA_WORKSPACE_ROOT:'F:/uat/libra-workspace',ARCA_AFTERCARE_WORKSPACE_ROOT:'F:/uat/aftercare-workspace',
    FFMPEG_PATH:'F:/tools/ffmpeg.exe',FFPROBE_PATH:'F:/tools/ffprobe.exe',SHELFDECK_SECRET_ROOT:'x'.repeat(32)});
  assert.equal(options.libraWorkspaceRoot,path.resolve('F:/uat/libra-workspace'));
  assert.equal(options.aftercareWorkspaceRoot,path.resolve('F:/uat/aftercare-workspace'));
  assert.equal(options.ffmpegPath,'F:/tools/ffmpeg.exe');
  assert.equal(options.ffprobePath,'F:/tools/ffprobe.exe');
});

test.skip('Libra Handoff B is accepted and committed through the Arca execution path', async () => {
  const value = fixture();
  const sourceRoot = path.join(path.dirname(value.dataDir), 'movie-handoff-a-source');
  fs.mkdirSync(sourceRoot, { recursive: true });
  const source = path.join(sourceRoot, 'Example.Movie.mkv');
  const relatedNfo = path.join(sourceRoot, 'Example.Movie.nfo');
  const relatedNfoLocation = relatedNfo.replace(/\\/g, '/');
  const unrelatedNfo = path.join(sourceRoot, 'Other.Title.nfo');
  fs.writeFileSync(source, Buffer.from('disposable-movie-source'));
  fs.writeFileSync(relatedNfo, Buffer.from('<movie><title>Example Movie</title></movie>'));
  fs.writeFileSync(unrelatedNfo, Buffer.from('<movie><title>Other Title</title></movie>'));
  const before = {
    bytes: fs.readFileSync(source),
    mtimeMs: fs.statSync(source).mtimeMs,
    nfoBytes: fs.readFileSync(relatedNfo),
    nfoMtimeMs: fs.statSync(relatedNfo).mtimeMs,
    unrelatedNfoBytes: fs.readFileSync(unrelatedNfo),
    unrelatedNfoMtimeMs: fs.statSync(unrelatedNfo).mtimeMs,
  };
  const policy = {
    includedDirectories: [], excludedDirectories: [], allowedExtensions: ['.mkv', '.nfo'],
    minimumSizeBytes: 0, excludedMaterialKeys: [],
  };
  const policyBasis = { extractionPolicyId: 'movie-handoff-policy', revision: 1, ...policy };
  const access = {
    fieldId: 'movie-handoff-field', revision: 1, endpointId: 'movie-handoff-endpoint',
    rootLocation: sourceRoot, mountScopeId: 'movie-handoff-mount', mountScopeRevision: 1,
    accessSchemaRef: 'helix://fixtures/movie-handoff-access/v1',
  };
  const register = {
    idempotencyKey: 'movie-handoff-register', fieldId: access.fieldId, name: 'Movie Handoff Source',
    policy: {
      extractionPolicyId: policyBasis.extractionPolicyId, revision: 1,
      policySchemaRef: 'helix://contracts/domain-types/ExtractionPolicy/v1', policy,
      policyDigest: canonicalDigest(policyBasis),
    },
    access: { ...access, accessDigest: canonicalDigest(access) },
  };
  const observe = {
    idempotencyKey: 'movie-handoff-observe', fieldId: access.fieldId,
    expectedAccessRevision: 1, expectedObservationRevision: 0, pageBudget: 8,
  };
  const probedLocations = [];
  const mediaProbe = Object.freeze({
    async probe(readHandle) {
      probedLocations.push(readHandle.location);
      const result = {
        resultKind: 'probed', sourceHandleDigest: canonicalDigest(readHandle), durationMs: 1000,
        videoStreams: [{ streamIndex: 0, codec: 'hevc', dispositionDefault: true, width: 1920, height: 1080 }],
        audioStreams: [], subtitleStreams: [], discTopology: null, payloadDigest: '',
      };
      result.payloadDigest = canonicalDigest(Object.fromEntries(
        Object.entries(result).filter(([key]) => key !== 'payloadDigest'),
      ));
      return Object.freeze(result);
    },
  });
  const tmdbMovieIdentityBasis = {
    provider: 'tmdb',
    namespace: 'tmdb_movie',
    providerKey: '550',
    seasonNumber: null,
  };
  const tmdbMovieIdentity = Object.freeze({
    ...tmdbMovieIdentityBasis,
    identityAnchorDigest: canonicalDigest(tmdbMovieIdentityBasis),
  });
  const productionOptions = Object.freeze({
    async searchProviderIdentity() {
      return Object.freeze({
        provider: 'tmdb',
        namespace: 'tmdb_movie',
        providerKey: '550',
        integrationId: 'tmdb-main',
        configRevision: 1,
      });
    },
    async fetchProviderMetadata({ metadataFetchIntent:intent }) {
      return Object.freeze({
        providerKind: 'tmdb',
        integrationId: intent.integrationId,
        configRevision: intent.configRevision,
        sourceRef: 'tmdb:movie:550',
        descriptiveEntries: Object.freeze([
          { key: 'director', value: 'Example Director' },
          { key: 'genre', value: 'Drama' },
          { key: 'plot', value: 'A disposable Movie journey fixture.' },
          { key: 'title', value: 'Example Movie' },
          { key: 'tmdb_movie_id', value: '550' },
          { key: 'year_or_release_date', value: '1999' },
        ]),
        providerIdentities: Object.freeze([tmdbMovieIdentity]),
        peopleHints: Object.freeze([{
          displayName: 'Example Actor',
          role: 'actor',
          providerIdentities: Object.freeze([{
            provider: 'tmdb',
            namespace: 'tmdb_person',
            providerKey: '819',
          }]),
        }]),
      });
    },
    async fetchProviderArtifact(request) {
      return Object.freeze({
        resultKind: 'acquired',
        artifactKind: request.artifactKind,
        integrationId: request.integrationHandle.integrationId,
        configRevision: request.integrationHandle.configRevision,
        resolvedProviderIdentity: tmdbMovieIdentity,
        mediaType: 'image/jpeg',
        bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      });
    },
  });
  async function session(host) {
    return (await host.inject({
      method: 'POST', url: '/v1/admin/session',
      headers: { 'x-api-key': value.initialized.adminApiKey },
    })).headers['set-cookie'];
  }
  async function requestObservation(host) {
    return host.inject({
      method: 'POST', url: `/v1/admin/material-fields/${access.fieldId}/actions/observe`,
      headers: { cookie: await session(host) }, payload: observe,
    });
  }
  async function establishMovieShelfAndRouting(host) {
    const cookie = await session(host);
    const shelfRoot = path.join(path.dirname(value.dataDir), 'movie-handoff-a-shelf');
    fs.mkdirSync(shelfRoot, { recursive: true });
    const placement = { folderTemplate: '{title}', primaryTemplate:'{stem}{ext}',
      nfoTemplate:'{stem}.nfo', subtitleTemplate:'{stem}{language}{forced}{sdh}{ext}',
      posterTemplate:'poster{ext}', fanartTemplate:'fanart{ext}', collisionPolicy: 'reject' };
    const created = await host.inject({
      method: 'POST', url: '/v1/admin/shelves', headers: { cookie },
      payload: {
        idempotencyKey: 'movie-handoff-shelf-create',
        shelfId: 'movie-handoff-shelf',
        name: 'Movie Shelf',
        targetRootLocation: shelfRoot,
        ruleTemplateId: 'system-beta-recommended',
        expectedTemplateRevision: 1,
        placementPolicy: placement,
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const expression = {
      nodeKind: 'predicate',
      factKind: 'content_profile',
      operator: 'eq',
      expectedValue: 'movie',
    };
    const routed = await host.inject({
      method: 'PATCH',
      url: `/v1/admin/routing/material-fields/${access.fieldId}`,
      headers: { cookie },
      payload: {
        idempotencyKey: 'movie-handoff-routing-publish',
        fieldId: access.fieldId,
        expectedPolicyId: null,
        expectedRevision: 0,
        policy: {
          routingPolicyId: 'movie-handoff-routing-policy',
          mode: 'sorting',
          targets: [{
            shelfId: 'movie-handoff-shelf',
            rank: 1,
            matchExpression: expression,
          }],
        },
      },
    });
    assert.equal(routed.statusCode, 200, routed.body);
    return { shelfRoot };
  }

  let injectResolutionCrash = true;
  let shelfRoot;
  let host = await createCleanServiceHost({
    dataDir: value.dataDir, adminDistDir: value.adminDistDir, secretRoot, mediaProbe,
    ...productionOptions,
    afterPerceptionResolutionCommit() {
      if (!injectResolutionCrash) return;
      injectResolutionCrash = false;
      throw Object.assign(
        new Error('fault after Perception Resolution commit'),
        { code: 'P14_FAULT_AFTER_PERCEPTION_RESOLUTION_COMMIT' },
      );
    },
  });
  try {
    ({ shelfRoot } = await establishMovieShelfAndRouting(host));
    const created = await host.inject({
      method: 'POST', url: '/v1/admin/material-fields', headers: { cookie: await session(host) }, payload: register,
    });
    assert.equal(created.statusCode, 201, created.body);
    const first = await requestObservation(host);
    assert.equal(first.statusCode, 400, first.body);
    assert.deepEqual(probedLocations, [source.replace(/\\/g, '/')]);
  } finally {
    await host.close();
  }

  const interrupted = new Database(
    path.join(value.dataDir, 'shelfdeck.db'),
    { readonly: true },
  );
  assert.equal(interrupted.prepare(
    "SELECT count(*) count FROM libra_intake_decisions WHERE decision_kind='accepted_resolution'"
  ).get().count, 1);
  assert.equal(interrupted.prepare(
    "SELECT count(*) count FROM perception_resolution_revisions WHERE result_kind='not_found'"
  ).get().count, 1);
  assert.equal(interrupted.prepare(
    "SELECT count(*) count FROM libra_decision_basis_revisions WHERE basis_kind='acceptance_spec'"
  ).get().count, 0);
  assert.equal(interrupted.prepare(
    'SELECT count(*) count FROM libra_acceptance_specs'
  ).get().count, 0);
  assert.equal(interrupted.prepare(
    'SELECT count(*) count FROM libra_runs'
  ).get().count, 0);
  interrupted.close();

  async function interruptProduction(hookName, reasonCode) {
    let inject = true;
    host = await createCleanServiceHost({
      dataDir: value.dataDir,
      adminDistDir: value.adminDistDir,
      secretRoot,
      mediaProbe,
      ...productionOptions,
      [hookName]() {
        if (!inject) return;
        inject = false;
        throw Object.assign(new Error(`fault at ${hookName}`), { code: reasonCode });
      },
    });
    try {
      const interruptedResponse = await requestObservation(host);
      assert.equal(interruptedResponse.statusCode, 400, interruptedResponse.body);
      assert.equal(
        interruptedResponse.json().error.details.reasonCode,
        reasonCode,
        interruptedResponse.body,
      );
    } finally {
      await host.close();
    }
  }

  await interruptProduction(
    'afterWorkspacePhysicalEffect',
    'P14_FAULT_AFTER_WORKSPACE_PHYSICAL_EFFECT',
  );
  let crashDatabase = new Database(
    path.join(value.dataDir, 'shelfdeck.db'),
    { readonly: true },
  );
  assert.equal(crashDatabase.prepare(
    'SELECT count(*) count FROM libra_product_packages',
  ).get().count, 0);
  crashDatabase.close();

  await interruptProduction(
    'afterProductFactsCommit',
    'P14_FAULT_AFTER_PRODUCT_FACTS_COMMIT',
  );
  crashDatabase = new Database(
    path.join(value.dataDir, 'shelfdeck.db'),
    { readonly: true },
  );
  assert.equal(crashDatabase.prepare(
    'SELECT count(*) count FROM libra_product_packages',
  ).get().count, 0);
  assert.equal(crashDatabase.prepare(
    'SELECT count(*) count FROM libra_product_fact_revisions',
  ).get().count, 3);
  crashDatabase.close();

  await interruptProduction(
    'afterPackageCommit',
    'P14_FAULT_AFTER_PACKAGE_COMMIT',
  );
  crashDatabase = new Database(
    path.join(value.dataDir, 'shelfdeck.db'),
    { readonly: true },
  );
  assert.equal(crashDatabase.prepare(
    'SELECT count(*) count FROM libra_product_packages',
  ).get().count, 1);
  assert.equal(crashDatabase.prepare(
    "SELECT count(*) count FROM fx_outbox WHERE message_kind='libra.product-offer.available@1'",
  ).get().count, 1);
  crashDatabase.close();

  for (const [hookName, reasonCode] of [
    [
      'afterAttemptAcceptedCas',
      'P14_FAULT_AFTER_HANDOFF_B_ATTEMPT_CAS',
    ],
    [
      'afterAcceptedResponsibilityInsert',
      'P14_FAULT_AFTER_HANDOFF_B_RESPONSIBILITY_INSERT',
    ],
    [
      'afterHandoffBControlTransfer',
      'P14_FAULT_AFTER_HANDOFF_B_CONTROL_TRANSFER',
    ],
    [
      'afterHandoffBReceiptInsert',
      'P14_FAULT_AFTER_HANDOFF_B_RECEIPT_INSERT',
    ],
    [
      'afterHandoffBOutboxInsert',
      'P14_FAULT_AFTER_HANDOFF_B_OUTBOX_INSERT',
    ],
  ]) {
    await interruptProduction(hookName, reasonCode);
    crashDatabase = new Database(
      path.join(value.dataDir, 'shelfdeck.db'),
      { readonly: true },
    );
    assert.equal(crashDatabase.prepare(
      "SELECT count(*) count FROM arca_acceptance_attempts WHERE state='active' AND finished_at_ms IS NULL",
    ).get().count, 1);
    for (const table of [
      'arca_acceptance_decisions',
      'arca_ondeck_custodies',
      'arca_handoff_b_receipts',
      'arca_ondeck_runs',
      'arca_final_inventory_decisions',
    ]) {
      assert.equal(crashDatabase.prepare(
        `SELECT count(*) count FROM ${table}`,
      ).get().count, 0, `${hookName}: ${table}`);
    }
    assert.equal(crashDatabase.prepare(
      "SELECT count(*) count FROM fx_material_controls WHERE owner_domain='arca' AND owner_scope_type='on_deck_custody'",
    ).get().count, 0);
    assert.equal(crashDatabase.prepare(
      "SELECT count(*) count FROM fx_outbox WHERE message_kind='arca.product.accepted@1'",
    ).get().count, 0);
    assert.equal(crashDatabase.prepare(
      "SELECT count(*) count FROM fx_commit_markers WHERE owner_domain='arca' AND scope_type='acceptance_decision'",
    ).get().count, 0);
    crashDatabase.close();
  }

  await interruptProduction(
    'afterHandoffBAccepted',
    'P14_FAULT_AFTER_HANDOFF_B_ACCEPTED',
  );
  crashDatabase = new Database(
    path.join(value.dataDir, 'shelfdeck.db'),
    { readonly: true },
  );
  assert.equal(crashDatabase.prepare(
    'SELECT count(*) count FROM arca_acceptance_decisions',
  ).get().count, 1);
  assert.equal(crashDatabase.prepare(
    'SELECT count(*) count FROM arca_ondeck_custodies',
  ).get().count, 1);
  assert.equal(crashDatabase.prepare(
    "SELECT count(*) count FROM arca_acceptance_attempts WHERE state='accepted' AND finished_at_ms IS NOT NULL",
  ).get().count, 1);
  assert.equal(crashDatabase.prepare(
    "SELECT count(*) count FROM arca_ondeck_runs WHERE state='ready'",
  ).get().count, 1);
  assert.equal(crashDatabase.prepare(
    'SELECT count(*) count FROM arca_final_inventory_decisions',
  ).get().count, 1);
  assert.equal(crashDatabase.prepare(
    'SELECT count(*) count FROM arca_shelf_entries',
  ).get().count, 0);
  assert.equal(crashDatabase.prepare(
    "SELECT count(*) count FROM fx_material_controls WHERE owner_domain='arca' AND owner_scope_type='on_deck_custody'",
  ).get().count, 3);
  crashDatabase.close();

  await interruptProduction(
    'afterArcaInventoryPhysicalEffect',
    'P14_FAULT_AFTER_ARCA_INVENTORY_PHYSICAL_EFFECT',
  );
  crashDatabase = new Database(
    path.join(value.dataDir, 'shelfdeck.db'),
    { readonly: true },
  );
  assert.equal(crashDatabase.prepare(
    'SELECT count(*) count FROM arca_shelf_entries',
  ).get().count, 0);
  assert.equal(crashDatabase.prepare(
    "SELECT count(*) count FROM fx_effect_journal WHERE effect_class='material_commit' AND state='intended'",
  ).get().count, 1);
  crashDatabase.close();

  await interruptProduction(
    'afterOnDeckCommit',
    'P14_FAULT_AFTER_ONDECK_COMMIT',
  );
  crashDatabase = new Database(
    path.join(value.dataDir, 'shelfdeck.db'),
    { readonly: true },
  );
  assert.equal(crashDatabase.prepare(
    'SELECT count(*) count FROM arca_shelf_entries',
  ).get().count, 1);
  assert.equal(crashDatabase.prepare(
    "SELECT count(*) count FROM arca_ondeck_runs WHERE state='offloading'",
  ).get().count, 1);
  assert.equal(crashDatabase.prepare(
    'SELECT count(*) count FROM arca_ondeck_commit_receipts',
  ).get().count, 1);
  crashDatabase.close();

  let committedJourney;
  host = await createCleanServiceHost({
    dataDir: value.dataDir, adminDistDir: value.adminDistDir, secretRoot, mediaProbe,
    ...productionOptions,
  });
  try {
    const resumed = await requestObservation(host);
    assert.equal(resumed.statusCode, 200, resumed.body);
    assert.equal(resumed.json().observation.replayed, true);
    assert.equal(resumed.json().movieJourney.stage, 'handoff_a_accepted');
    assert.equal(resumed.json().movieJourney.replayed, true);
    assert.equal(resumed.json().movieJourney.handoff.formation.stage, 'libra_run_active');
    assert.equal(
      resumed.json().movieJourney.handoff.production.stage,
      'movie_on_deck_committed',
    );
    assert.equal(
      resumed.json().movieJourney.handoff.production.packageRevision,
      1,
    );
    assert.equal(resumed.json().movieJourney.handoff.production.replayed, true);
    assert.equal(
      resumed.json().movieJourney.handoff.production
        .responsibilityClosure.stage,
      'workspace_cleanup_grace_active',
    );
    committedJourney =
      resumed.json().movieJourney.handoff.production;
    for (const [schemaId, typedValue] of [
      [
        'helix://contracts/types/CustodyAndTransferReceipt/v1',
        committedJourney.handoffB.receipt,
      ],
      [
        'helix://contracts/domain-types/FinalInventoryDecision/v1',
        committedJourney.onDeck.finalInventoryDecision,
      ],
      [
        'helix://contracts/types/StagedInventoryManifest/v1',
        committedJourney.onDeck.stagedInventoryManifest,
      ],
      [
        'helix://contracts/types/StagedInventoryVerification/v1',
        committedJourney.onDeck.stagedVerification,
      ],
      [
        'helix://contracts/types/FulfillmentVerification/v1',
        committedJourney.onDeck.fulfillmentVerification,
      ],
      [
        'helix://contracts/types/OnDeckCommitResult/v1',
        committedJourney.onDeck.result,
      ],
    ]) {
      const validate = contractValidator(schemaId);
      assert.equal(validate(typedValue), true,
        `${schemaId}: ${JSON.stringify(validate.errors)}`);
    }
  } finally {
    await host.close();
  }

  host = await createCleanServiceHost({
    dataDir: value.dataDir, adminDistDir: value.adminDistDir, secretRoot, mediaProbe,
    ...productionOptions,
  });
  try {
    const replay = await requestObservation(host);
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().observation.replayed, true);
    assert.equal(replay.json().movieJourney.stage, 'handoff_a_accepted');
    assert.equal(replay.json().movieJourney.replayed, true);
    assert.equal(replay.json().movieJourney.handoff.formation.stage, 'libra_run_completed');
    assert.equal(replay.json().movieJourney.handoff.formation.replayed, true);
    assert.equal(
      replay.json().movieJourney.handoff.production.stage,
      'movie_on_deck_committed',
    );
    assert.equal(replay.json().movieJourney.handoff.production.replayed, true);
    assert.deepEqual(
      replay.json().movieJourney.handoff.production.handoffB.receipt,
      committedJourney.handoffB.receipt,
    );
    assert.deepEqual(
      replay.json().movieJourney.handoff.production.onDeck.result,
      committedJourney.onDeck.result,
    );
  } finally {
    await host.close();
  }

  const database = new Database(path.join(value.dataDir, 'shelfdeck.db'), { readonly: true });
  assert.equal(database.prepare('SELECT count(*) count FROM proc_procurement_runs').get().count, 1);
  assert.equal(database.prepare('SELECT count(*) count FROM proc_candidate_packages').get().count, 1);
  assert.equal(database.prepare('SELECT count(*) count FROM proc_candidate_primary_materials').get().count, 1);
  assert.deepEqual(database.prepare(
    'SELECT role,location FROM proc_candidate_related_references'
  ).all(), [{ role: 'nfo', location: relatedNfoLocation }]);
  assert.equal(database.prepare("SELECT count(*) count FROM proc_candidate_deliveries WHERE state='accepted'").get().count, 1);
  assert.equal(database.prepare('SELECT count(*) count FROM libra_subjects').get().count, 1);
  assert.equal(database.prepare('SELECT count(*) count FROM libra_routing_decisions').get().count, 1);
  assert.equal(database.prepare('SELECT count(*) count FROM libra_acceptance_specs').get().count, 1);
  assert.equal(database.prepare("SELECT count(*) count FROM libra_runs WHERE state='completed'").get().count, 1);
  const intakeEvidence = database.prepare(
    `SELECT intake_decision_id,candidate_package_id,package_revision,package_digest,
            candidate_delivery_snapshot_digest,candidate_identity_claim_digest,
            decision_identity_evidence_schema_ref,decision_identity_evidence_json,
            decision_identity_evidence_digest
       FROM libra_intake_decisions`
  ).get();
  const parsedIntakeEvidence = JSON.parse(
    intakeEvidence.decision_identity_evidence_json,
  );
  assert.equal(
    parsedIntakeEvidence.snapshotDigest,
    intakeEvidence.decision_identity_evidence_digest,
  );
  assert.equal(
    parsedIntakeEvidence.identityEvidence[0].anchorValue,
    'example.movie.mkv',
  );
  assert.equal(
    parsedIntakeEvidence.identityClaimDigest,
    intakeEvidence.candidate_identity_claim_digest,
  );
  const resolutionRows = database.prepare(
    `SELECT revision,result_kind,reason_code,result_json,result_digest
       FROM perception_resolution_revisions`
  ).all();
  assert.equal(resolutionRows.length, 1);
  assert.equal(resolutionRows[0].revision, 1);
  assert.equal(resolutionRows[0].result_kind, 'not_found');
  assert.equal(resolutionRows[0].reason_code, 'no_matching_record');
  const perceptionBasisRows = database.prepare(
    `SELECT input_kind,provider_domain,query_contract,query_version,
            query_input_digest,result_kind,result_revision,result_digest
       FROM libra_decision_basis_inputs
      WHERE input_kind IN ('decision_fact','query_result')
      ORDER BY input_kind`
  ).all();
  assert.equal(perceptionBasisRows.length, 2);
  assert.deepEqual(
    perceptionBasisRows.map((row) => row.input_kind),
    ['decision_fact', 'query_result'],
  );
  assert.equal(perceptionBasisRows[1].provider_domain, 'perception');
  assert.equal(perceptionBasisRows[1].query_contract, 'perception.rating.resolve@1');
  assert.equal(perceptionBasisRows[1].query_version, 1);
  assert.equal(perceptionBasisRows[1].result_kind, 'not_found');
  assert.equal(perceptionBasisRows[1].result_revision, 1);
  assert.equal(
    perceptionBasisRows[1].result_digest,
    JSON.parse(resolutionRows[0].result_json).factDigest,
  );
  assert.equal(database.prepare('SELECT head_revision FROM libra_subject_decision_heads').get().head_revision, 4);
  assert.equal(database.prepare('SELECT head_revision FROM libra_run_admission_heads').get().head_revision, 2);
  assert.equal(database.prepare(
    "SELECT count(*) count FROM fx_material_controls WHERE owner_domain='libra' AND owner_scope_type='subject'"
  ).get().count, 0);
  assert.equal(database.prepare('SELECT count(*) count FROM libra_product_packages').get().count, 1);
  assert.equal(database.prepare(
    "SELECT count(*) count FROM fx_material_controls WHERE owner_domain='libra' AND owner_scope_type='on_deck_package'"
  ).get().count, 0);
  assert.equal(database.prepare(
    "SELECT count(*) count FROM fx_material_controls WHERE owner_domain='arca' AND owner_scope_type='shelf_entry' AND state='controlled'"
  ).get().count, 3);
  assert.equal(database.prepare(
    "SELECT count(*) count FROM libra_workspace_material_refs WHERE reference_state='product_staging'"
  ).get().count, 2);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM proc_run_materials WHERE candidate_package_id IS NOT NULL'
  ).get().count, 1);
  assert.equal(database.prepare(
    "SELECT count(*) count FROM proc_run_materials WHERE location=? AND candidate_package_id IS NULL AND selection_state='run_selection'"
  ).get(relatedNfoLocation).count, 1);
  assert.deepEqual(database.prepare('SELECT message_kind,state FROM fx_outbox ORDER BY message_kind').all(), [
    { message_kind: 'arca.offload.completed@1', state: 'pending' },
    { message_kind: 'arca.product.accepted@1', state: 'fully_acked' },
    { message_kind: 'field_routing_policy_published', state: 'pending' },
    { message_kind: 'libra.product-offer.available@1', state: 'fully_acked' },
    { message_kind: 'libra_candidate_accepted', state: 'fully_acked' },
    { message_kind: 'procurement_candidate_offer_available', state: 'fully_acked' },
  ]);
  assert.equal(database.prepare(
    "SELECT count(*) count FROM fx_outbox_deliveries WHERE state='acked'"
  ).get().count, 4);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM fx_inbox WHERE consumed_at_ms IS NOT NULL'
  ).get().count, 4);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM arca_acceptance_decisions'
  ).get().count, 1);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM arca_ondeck_custodies'
  ).get().count, 1);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM arca_ondeck_runs WHERE state=?'
  ).get('committed').count, 1);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM arca_shelf_entries WHERE status=?'
  ).get('active').count, 1);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM arca_inventory_materials'
  ).get().count, 3);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM arca_deck_fact_revisions WHERE state=?'
  ).get('active').count, 1);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM arca_ondeck_commit_receipts'
  ).get().count, 1);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM arca_offload_completions'
  ).get().count, 1);
  const delivery = database.prepare(
    `SELECT offer_id,candidate_package_id,package_revision,package_digest,acceptance_basis_digest
       FROM proc_candidate_deliveries`
  ).get();
  const productPackage = database.prepare(
    `SELECT offer_id,on_deck_package_id,package_revision,package_digest
       FROM libra_product_packages`
  ).get();
  const finalInventoryRows = database.prepare(
    `SELECT material_key,role,location
       FROM arca_inventory_materials
      ORDER BY material_key`
  ).all();
  assert.equal(finalInventoryRows.length, 3);
  assert.equal(new Set(finalInventoryRows.map((row) => row.location)).size, 3);
  for (const row of finalInventoryRows) {
    assert.equal(
      path.resolve(row.location).startsWith(`${path.resolve(shelfRoot)}${path.sep}`),
      true,
    );
    assert.equal(fs.existsSync(row.location), true);
  }
  const primaryInventory = finalInventoryRows.find((row) =>
    row.role === 'primary');
  assert.ok(primaryInventory);
  assert.deepEqual(fs.readFileSync(primaryInventory.location), before.bytes);
  const cleanupAtMs = Number(database.prepare(
    'SELECT committed_at_ms FROM arca_offload_completions'
  ).get().committed_at_ms) + 86_400_000 + 60_000;
  const workspaceFiles = database.prepare(
    'SELECT workspace_id,relative_path FROM fx_workspace_materials ORDER BY relative_path'
  ).all().map((row) => path.join(
    value.dataDir, 'workspace', row.workspace_id, ...row.relative_path.split('/'),
  ));
  database.close();

  const kernel = openSqliteKernel({
    Database,
    databasePath: path.join(value.dataDir, 'shelfdeck.db'),
    schemaDdl: cleanSchemaDdl,
    schemaManifest: cleanSchemaManifest,
  });
  try {
    const candidateDelivery = createCandidateDeliveryService({
      candidateDeliveryReader: createCandidateDeliveryReader({
        schemaManifest: cleanSchemaManifest,
        unitOfWork: createSqliteUnitOfWork({ kernel }),
      }),
      contractValidator: { validate() {} },
    }).readSnapshot(buildQuery({
      offerId: delivery.offer_id,
      candidatePackageId: delivery.candidate_package_id,
      packageRevision: Number(delivery.package_revision),
      packageDigest: delivery.package_digest,
      acceptanceBasisDigest: delivery.acceptance_basis_digest,
    }));
    assert.equal(candidateDelivery.resultKind, 'found');
    assert.equal(candidateDelivery.snapshot.primaryInputManifest.memberCount, 1);
    assert.equal(candidateDelivery.snapshot.candidatePackage.relatedReferences.length, 1);
    assert.equal(candidateDelivery.snapshot.candidatePackage.relatedReferences[0].role, 'nfo');
    assert.equal(candidateDelivery.snapshot.candidatePackage.relatedReferences[0].location, relatedNfoLocation);

    const productDelivery = createProductDeliveryReader({
      schemaManifest: cleanSchemaManifest,
      unitOfWork: createSqliteUnitOfWork({ kernel }),
    }).readPackage({
      queryContract: 'libra.product-delivery@1',
      readPurpose: 'historical',
      offerId: productPackage.offer_id,
      onDeckPackageId: productPackage.on_deck_package_id,
      expectedPackageRevision: Number(productPackage.package_revision),
      expectedPackageDigest: productPackage.package_digest,
    });
    assert.equal(productDelivery.resultKind, 'found');
    const validatePackage = contractValidator(
      'helix://contracts/types/OnDeckProductPackage/v1',
    );
    assert.equal(
      validatePackage(productDelivery.onDeckProductPackage),
      true,
      JSON.stringify(validatePackage.errors),
    );
  } finally {
    kernel.close();
  }
  let cleanupPhysicalEffects = 0;
  let cleanupClock = cleanupAtMs;
  host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
    mediaProbe,
    ...productionOptions,
    cleanupNow: () => cleanupClock,
    offloadWakeVisible: false,
  });
  try {
    const firstAudit = await requestObservation(host);
    assert.equal(firstAudit.statusCode, 200, firstAudit.body);
    assert.equal(
      firstAudit.json().movieJourney.handoff.production
        .responsibilityClosure.stage,
      'workspace_cleanup_audit_pending',
    );
  } finally {
    await host.close();
  }
  let cleanupCrashDatabase = new Database(
    path.join(value.dataDir, 'shelfdeck.db'), { readonly: true },
  );
  assert.equal(cleanupCrashDatabase.prepare(
    'SELECT count(*) count FROM libra_workspace_cleanup_scopes'
  ).get().count, 0);
  assert.equal(cleanupCrashDatabase.prepare(
    "SELECT count(*) count FROM fx_effect_journal WHERE effect_class='libra_workspace_material_reclaim'"
  ).get().count, 0);
  cleanupCrashDatabase.close();

  host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
    mediaProbe,
    ...productionOptions,
    cleanupNow: () => cleanupClock,
    offloadWakeVisible: false,
    afterCleanupPhysicalEffect() {
      cleanupPhysicalEffects += 1;
      throw Object.assign(new Error('cleanup physical effect interruption'), {
        code: 'P14_TEST_CLEANUP_PHYSICAL_EFFECT_INTERRUPTION',
      });
    },
  });
  try {
    const restartedFirstAudit = await requestObservation(host);
    assert.equal(restartedFirstAudit.statusCode, 200,
      restartedFirstAudit.body);
    assert.equal(
      restartedFirstAudit.json().movieJourney.handoff.production
        .responsibilityClosure.stage,
      'workspace_cleanup_audit_pending',
    );
    cleanupClock = cleanupAtMs + 60_000 - 1;
    const earlySecondAudit = await requestObservation(host);
    assert.equal(earlySecondAudit.statusCode, 200, earlySecondAudit.body);
    assert.equal(
      earlySecondAudit.json().movieJourney.handoff.production
        .responsibilityClosure.stage,
      'workspace_cleanup_audit_pending',
    );
    cleanupClock = cleanupAtMs + 60_000;
    const interrupted = await requestObservation(host);
    assert.equal(interrupted.statusCode, 400, interrupted.body);
  } finally {
    await host.close();
  }
  cleanupCrashDatabase = new Database(
    path.join(value.dataDir, 'shelfdeck.db'), { readonly: true },
  );
  assert.equal(cleanupCrashDatabase.prepare(
    "SELECT count(*) count FROM libra_workspace_cleanup_scopes WHERE state='active'"
  ).get().count, 1);
  assert.equal(cleanupCrashDatabase.prepare(
    "SELECT count(*) count FROM libra_workspace_cleanup_members WHERE state='completed'"
  ).get().count, 0);
  assert.equal(cleanupCrashDatabase.prepare(
    "SELECT count(*) count FROM fx_effect_journal WHERE effect_class='libra_workspace_material_reclaim' AND state='intended'"
  ).get().count, 1);
  assert.equal(cleanupCrashDatabase.prepare(
    "SELECT count(*) count FROM fx_outbox WHERE message_kind='arca.offload.completed@1' AND state='pending'"
  ).get().count, 1);
  cleanupCrashDatabase.close();
  assert.equal(cleanupPhysicalEffects, 1);
  assert.equal(workspaceFiles.filter((file) => !fs.existsSync(file)).length, 1);

  host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
    mediaProbe,
    ...productionOptions,
    cleanupNow: () => cleanupClock,
    afterCleanupCommit() {
      throw Object.assign(new Error('cleanup commit interruption'), {
        code: 'P14_TEST_CLEANUP_COMMIT_INTERRUPTION',
      });
    },
  });
  try {
    const interrupted = await requestObservation(host);
    assert.equal(interrupted.statusCode, 400, interrupted.body);
  } finally {
    await host.close();
  }
  cleanupCrashDatabase = new Database(
    path.join(value.dataDir, 'shelfdeck.db'), { readonly: true },
  );
  assert.equal(cleanupCrashDatabase.prepare(
    "SELECT count(*) count FROM libra_workspace_cleanup_members WHERE state='completed'"
  ).get().count, 1);
  assert.equal(cleanupCrashDatabase.prepare(
    "SELECT count(*) count FROM fx_effect_journal WHERE effect_class='libra_workspace_material_reclaim' AND state='committed'"
  ).get().count, 1);
  cleanupCrashDatabase.close();

  host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
    mediaProbe,
    ...productionOptions,
    cleanupNow: () => cleanupClock,
    afterCleanupPhysicalEffect() {
      cleanupPhysicalEffects += 1;
    },
  });
  try {
    const cleaned = await requestObservation(host);
    assert.equal(cleaned.statusCode, 200, cleaned.body);
    assert.equal(
      cleaned.json().movieJourney.handoff.production
        .responsibilityClosure.stage,
      'workspace_cleanup_completed',
    );
  } finally {
    await host.close();
  }
  const cleanedDatabase = new Database(
    path.join(value.dataDir, 'shelfdeck.db'), { readonly: true },
  );
  assert.equal(cleanedDatabase.prepare(
    "SELECT count(*) count FROM libra_workspace_cleanup_scopes WHERE state='completed'"
  ).get().count, 1);
  assert.equal(cleanedDatabase.prepare(
    "SELECT count(*) count FROM libra_workspace_cleanup_members WHERE state='completed'"
  ).get().count, workspaceFiles.length);
  assert.equal(cleanedDatabase.prepare(
    "SELECT count(*) count FROM libra_workspace_material_refs WHERE reference_state='released'"
  ).get().count, workspaceFiles.length);
  assert.equal(cleanedDatabase.prepare(
    "SELECT count(*) count FROM fx_workspace_materials WHERE state='reclaimed'"
  ).get().count, workspaceFiles.length);
  assert.equal(cleanedDatabase.prepare(
    "SELECT count(*) count FROM libra_workspaces WHERE state='reclaimed'"
  ).get().count, 1);
  assert.equal(cleanedDatabase.prepare(
    "SELECT count(*) count FROM fx_workspace_registry WHERE state='reclaimed'"
  ).get().count, 1);
  assert.equal(cleanedDatabase.prepare(
    "SELECT count(*) count FROM fx_outbox WHERE message_kind IN ('arca.product.accepted@1','arca.offload.completed@1') AND state='fully_acked'"
  ).get().count, 2);
  cleanedDatabase.close();
  assert.equal(cleanupPhysicalEffects, workspaceFiles.length);
  assert.equal(workspaceFiles.every((file) => !fs.existsSync(file)), true);
  assert.equal(finalInventoryRows.every((row) => fs.existsSync(row.location)), true);
  assert.deepEqual(fs.readFileSync(source), before.bytes);
  assert.equal(fs.statSync(source).mtimeMs, before.mtimeMs);
  assert.deepEqual(fs.readFileSync(relatedNfo), before.nfoBytes);
  assert.equal(fs.statSync(relatedNfo).mtimeMs, before.nfoMtimeMs);
  assert.deepEqual(fs.readFileSync(unrelatedNfo), before.unrelatedNfoBytes);
  assert.equal(fs.statSync(unrelatedNfo).mtimeMs, before.unrelatedNfoMtimeMs);
});
