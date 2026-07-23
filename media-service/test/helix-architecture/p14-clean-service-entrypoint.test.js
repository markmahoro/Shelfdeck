'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
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
    const listed = await host.inject({ method: 'GET', url: '/v1/admin/material-fields', headers: { cookie } });
    assert.equal(listed.statusCode, 200);
    assert.deepEqual(listed.json().items.map((item) => item.fieldId), ['field-http-1']);
    const duplicate = await host.inject({ method: 'POST', url: '/v1/admin/material-fields', headers: { cookie }, payload: body });
    assert.equal(duplicate.statusCode, 400);
    assert.equal(duplicate.json().error.code, 'ADMIN_FIELD_COMMAND_REJECTED');
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
