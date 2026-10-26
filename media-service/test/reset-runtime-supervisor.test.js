'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { initializeCleanData } = require('../scripts/helix-operational-safety');
const { createRuntimeSupervisor } = require('../src/clean-runtime-supervisor');
const { createCleanServiceHost } = require('../src/clean-service-host');
const { runFreshResetProcess } = require('../scripts/formation-reset-process');
const { readColdResetState } = require('../src/clean-reset-generation-fence');

async function fixture(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'reset-supervisor-')));
  const dataDir = path.join(root, 'data'), workspace = path.join(root, 'workspace');
  for (const name of ['data', 'workspace', 'operations', 'archives', 'admin', 'sources']) fs.mkdirSync(path.join(root, name));
  const secretRoot = 'isolated-reset-supervisor-secret-material';
  const initialized = await initializeCleanData({ dataDir, secretRoot, confirmation: 'INITIALIZE_HELIX_CLEAN_V1' });
  const intentPath = path.join(dataDir, 'operator-runtime/intent.json');
  fs.mkdirSync(path.dirname(intentPath), { recursive: true });
  fs.writeFileSync(intentPath, JSON.stringify({ schema: 'shelfdeck.runtime-intent@1', desiredMode: 'stopped', revision: 1, pendingReset: null }));
  fs.writeFileSync(path.join(workspace, 'unfinished.bin'), 'private output');
  fs.writeFileSync(path.join(root, 'sources', 'source.mkv'), 'source preserved');
  fs.writeFileSync(path.join(root, 'admin', 'index.html'), '<main>Isolated Supervisor test</main>');
  const options = { dataDir, secretRoot, libraWorkspaceRoot: workspace, adminDistDir: path.join(root, 'admin'), port: 0,
    resetConfiguration: { schema: 'shelfdeck.reset-configuration@1', operationRoot: path.join(root, 'operations'), backupParent: path.join(root, 'archives'),
      backupSourceOptions: { roots: [{ id: 'data', path: dataDir }, { id: 'workspace', path: workspace }] },
      storage: { roots: [workspace], protectedDirectories: [path.join(root, 'sources')] } } };
  const supervisors = [];
  t.after(async () => { for (const supervisor of supervisors.reverse()) await supervisor.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, options, intentPath, supervisors, headers: { 'x-api-key': initialized.adminApiKey } };
}
async function requestReset(supervisor, headers) {
  const preview = await supervisor.inject({ method: 'GET', url: '/v1/admin/runtime/reset-preview', headers });
  assert.equal(preview.statusCode, 200, preview.body);
  const payload = { idempotencyKey: 'confirmed-fresh-reset', previewDigest: preview.json().previewDigest, confirmed: true };
  const response = await supervisor.inject({ method: 'POST', url: '/v1/admin/runtime/actions/reset', headers, payload });
  assert.equal(response.statusCode, 202, response.body);
  return { payload, response: response.json() };
}
async function until(predicate) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) { const result = await predicate(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.fail('Supervisor transition did not finish within the bounded test wait.');
}

async function bootstrapFixture(t) {
  const f = await fixture(t), host = await createCleanServiceHost(f.options);
  const stopped = await host.inject({ method: 'POST', url: '/v1/admin/runtime/actions/stop', headers: f.headers,
    payload: { idempotencyKey: 'deployment-safe-stop' } });
  assert.equal(stopped.statusCode, 202, stopped.body);
  await until(async () => (await host.inject({ method: 'GET', url: '/v1/admin/runtime', headers: f.headers })).json().mode === 'stopped');
  await host.close();
  // Reconstruct the accepted old schema only in this empty isolated fixture.
  // The new business Host must refuse it, while the cold Operator may import.
  const Database = require('better-sqlite3'), oldSchema = require('./helpers/plan-contract-target-schema');
  const current = path.join(f.options.dataDir, 'shelfdeck.db'), oldPath = path.join(f.root, 'old.db');
  require('../src/helix/foundation/persistence/sqlite-kernel').openSqliteKernel({ Database, databasePath: oldPath, ...oldSchema }).close();
  const old = new Database(oldPath), source = new Database(current, { readonly: true });
  try {
    old.pragma('foreign_keys=OFF'); old.exec('BEGIN');
    for (const { name } of old.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='platform_schema_marker'").all()) {
      const columns = old.pragma('table_info(' + name + ')').map(c => c.name);
      const insert = old.prepare('INSERT INTO ' + name + '(' + columns.join(',') + ') VALUES(' + columns.map(() => '?').join(',') + ')');
      for (const row of source.prepare('SELECT ' + columns.join(',') + ' FROM ' + name).iterate()) insert.run(...columns.map(c => row[c]));
    }
    old.exec('COMMIT');
  } finally { source.close(); old.close(); }
  fs.copyFileSync(oldPath, current);
  fs.writeFileSync(path.join(f.options.dataDir, 'runtime-generation.json'), JSON.stringify({ generation: 'helix-clean-v3', schemaDigest: oldSchema.schemaManifest.ddlDigest }));
  const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
  const intent = JSON.parse(fs.readFileSync(f.intentPath, 'utf8'));
  const stop = JSON.parse(fs.readFileSync(path.join(path.dirname(f.intentPath), stopped.json().operationId + '.json'), 'utf8'));
  const closure = { schema: 'shelfdeck.deployment-closure@1', oldContainerId: 'a'.repeat(64), oldImageId: 'sha256:' + 'b'.repeat(64),
    oldContainerRemoved: true, remainingDataMounts: [], inventoryDigest: canonicalDigest([]), closedAt: new Date().toISOString(),
    runtimeRevision: intent.revision, intentDigest: canonicalDigest(intent), stopOperationId: stop.operationId, stopReceiptDigest: canonicalDigest(stop) };
  const configuration = require('../src/clean-runtime-supervisor').resetConfiguration(f.options);
  const configFiles = ['docker-compose.yml', 'secret.env'].map(name => ({ name, path: path.join(f.root, name) }));
  for (const row of configFiles) fs.writeFileSync(row.path, 'isolated original configuration');
  const backup = await require('../scripts/formation-reset-deployment-backup').createDeploymentBackup({
    dataDir: f.options.dataDir, sourceOptions: configuration.backupSourceOptions, configFiles,
    operationRoot: configuration.operationRoot, backupParent: configuration.backupParent, closure });
  closure.backupReceiptDigest = backup.receiptDigest;
  const outputFile = path.join(configuration.operationRoot, 'bootstrap.json');
  const preparation = { dataDir: f.options.dataDir, configuration, closure, secretRoot: f.options.secretRoot,
    outputFile, qualificationPath: path.join(configuration.operationRoot, 'qualification.db') };
  return { ...f, preparation, options: { ...f.options, resetBootstrapFile: outputFile } };
}

test('cold bootstrap validates a private copy without creating missing source SQLite sidecars', async t => {
  const f = await bootstrapFixture(t);
  const { prepareColdResetBootstrap } = require('../scripts/formation-reset-bootstrap');
  const { databaseFiles } = require('../src/clean-reset-bootstrap');
  const current = path.join(f.options.dataDir, 'shelfdeck.db');
  for (const suffix of ['-wal', '-shm', '-journal']) {
    if (!fs.existsSync(current + suffix)) continue;
    if (suffix !== '-shm') assert.equal(fs.statSync(current + suffix).size, 0);
    fs.unlinkSync(current + suffix);
  }
  const before = databaseFiles(f.options.dataDir);
  const Database = require('better-sqlite3');
  function PrivateDatabase(file, options) {
    assert.notEqual(file, current, 'bootstrap must not open the stopped source database');
    return new Database(file, options);
  }
  prepareColdResetBootstrap({ ...f.preparation, Database: PrivateDatabase });
  assert.deepEqual(databaseFiles(f.options.dataDir), before);
  assert.equal(fs.existsSync(current + '-shm'), false);
});

test('explicit deployment closure opens confirmation on schema 235 without a business Host and switches to stopped schema 239', async t => {
  const f = await bootstrapFixture(t);
  const { prepareColdResetBootstrap } = require('../scripts/formation-reset-bootstrap');
  prepareColdResetBootstrap(f.preparation);
  let businessOpened = 0, switched = false;
  const supervisor = createRuntimeSupervisor(f.options, {
    async createHost(options) { assert.equal(switched, true, 'old schema must never enter the business Host'); businessOpened++; return createCleanServiceHost(options); },
    async runOperator(input) { const result = await runFreshResetProcess(input); if (input.action === 'run') switched = true; return result; },
  }); f.supervisors.push(supervisor); await supervisor.start();
  const initial = (await supervisor.inject({ method: 'GET', url: '/v1/admin/runtime', headers: f.headers })).json();
  assert.equal(initial.resetStage, 'awaiting_confirmation'); assert.equal(initial.normalSupplyAllowed, false);
  assert.equal(businessOpened, 0);
  assert.equal((await supervisor.inject({ method: 'POST', url: '/v1/admin/runtime/actions/resume', headers: f.headers, payload: { idempotencyKey: 'no-resume' } })).statusCode, 503);
  await requestReset(supervisor, f.headers);
  await until(async () => {
    try { const state = (await supervisor.inject({ method: 'GET', url: '/v1/admin/runtime', headers: f.headers })).json();
      return state.mode === 'stopped' && state.operation?.state === 'completed' && !state.resetStage;
    } catch { return false; }
  });
  assert.equal(businessOpened, 1);
  await supervisor.close();
  const restarted = createRuntimeSupervisor(f.options); f.supervisors.push(restarted); await restarted.start();
  const result = (await restarted.inject({ method: 'GET', url: '/v1/admin/runtime', headers: f.headers })).json();
  assert.equal(result.mode, 'stopped'); assert.equal(result.normalSupplyAllowed, false); assert.equal(result.resetStage, undefined);
});

test('cold deployment bootstrap rejects incomplete closure and changed source instead of falling back to business startup', async t => {
  const f = await bootstrapFixture(t), { prepareColdResetBootstrap } = require('../scripts/formation-reset-bootstrap');
  assert.throws(() => prepareColdResetBootstrap({ ...f.preparation, closure: { ...f.preparation.closure, oldContainerRemoved: false } }), { code: 'RESET_BOOTSTRAP_CLOSURE_INVALID' });
  assert.throws(() => prepareColdResetBootstrap({ ...f.preparation, closure: { ...f.preparation.closure, backupReceiptDigest: 'f'.repeat(64) } }), { code: 'RESET_BOOTSTRAP_BACKUP_UNVERIFIED' });
  prepareColdResetBootstrap(f.preparation);
  const Database = require('better-sqlite3'), db = new Database(path.join(f.options.dataDir, 'shelfdeck.db'));
  db.prepare('UPDATE platform_admin_credentials SET last_used_at_ms=123').run(); db.close();
  const supervisor = createRuntimeSupervisor(f.options, { createHost() { assert.fail('changed bootstrap cannot open a Host'); } });
  await assert.rejects(supervisor.start(), { code: 'RESET_BOOTSTRAP_SOURCE_CHANGED' });
});

test('an interrupted first-upgrade Reset restarts from its confirmed cold workflow without opening the old schema', async t => {
  const f = await bootstrapFixture(t);
  require('../scripts/formation-reset-bootstrap').prepareColdResetBootstrap(f.preparation);
  const first = createRuntimeSupervisor(f.options, { createHost() { assert.fail('no old business Host'); },
    runOperator(input) {
      if (input.action === 'run') throw Object.assign(new Error('isolated interruption'), { code: 'RESET_TEST_INTERRUPTION' });
      return runFreshResetProcess(input);
    } });
  f.supervisors.push(first); await first.start(); const { response } = await requestReset(first, f.headers);
  await until(async () => {
    try { return (await first.inject({ method: 'GET', url: '/v1/admin/runtime', headers: f.headers })).json().mode === 'error'; }
    catch { return false; }
  });
  await first.close(); let switched = false;
  const replacement = createRuntimeSupervisor(f.options, {
    async runOperator(input) { const result = await runFreshResetProcess(input); switched = true; return result; },
    createHost(options) { assert.equal(switched, true); return createCleanServiceHost(options); },
  }); f.supervisors.push(replacement); await replacement.start(); await replacement.wait();
  const result = (await replacement.inject({ method: 'GET', url: '/v1/admin/runtime', headers: f.headers })).json();
  assert.equal(result.mode, 'stopped'); assert.equal(result.normalSupplyAllowed, false);
  assert.equal(result.operation.operationId, response.operationId); assert.equal(result.operation.state, 'completed');
});

test('Supervisor keeps authenticated management available while a real cold child replaces the closed business generation', async t => {
  const f = await fixture(t);
  let begin, release, calls = 0;
  const entered = new Promise(resolve => { begin = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const supervisor = createRuntimeSupervisor(f.options, { async runOperator(input) {
    if (input.action === 'run') { calls++; begin(); await gate; }
    return runFreshResetProcess(input);
  } }); f.supervisors.push(supervisor);
  await supervisor.start(); const originalAddress = supervisor.address();
  const { payload, response } = await requestReset(supervisor, f.headers); await entered;
  try {
    const runtime = await supervisor.inject({ method: 'GET', url: '/v1/admin/runtime', headers: f.headers });
    assert.equal(runtime.statusCode, 200); assert.equal(runtime.json().mode, 'resetting');
    assert.equal(runtime.json().normalSupplyAllowed, false); assert.equal(runtime.json().resetStage, 'closed');
    assert.equal((await supervisor.inject({ method: 'GET', url: '/v1/admin/runtime' })).statusCode, 401);
    assert.equal((await supervisor.inject({ method: 'POST', url: '/v1/admin/runtime/actions/resume', headers: f.headers, payload: { idempotencyKey: 'no' } })).statusCode, 503);
    assert.equal((await supervisor.inject({ method: 'POST', url: '/v1/admin/runtime/actions/reset', headers: f.headers, payload: { ...payload, idempotencyKey: 'changed' } })).statusCode, 409);
    assert.equal((await supervisor.inject({ method: 'POST', url: '/v1/admin/runtime/actions/reset', headers: f.headers, payload })).statusCode, 202);
    assert.equal(calls, 1, 'replaying confirmation cannot launch a second cold child');
  } finally { release(); }
  const runtime = await until(async () => {
    try { const r = await supervisor.inject({ method: 'GET', url: '/v1/admin/runtime', headers: f.headers });
      return r.statusCode === 200 && r.json().mode === 'stopped' && !r.json().resetStage ? r.json() : null;
    } catch { return null; }
  });
  assert.deepEqual(supervisor.address(), originalAddress);
  assert.equal(runtime.operation.operationId, response.operationId); assert.equal(runtime.operation.state, 'completed');
  assert.equal(runtime.normalSupplyAllowed, false); assert.equal(readColdResetState(f.options.dataDir).fence.phase, 'complete');
  assert.deepEqual(fs.readdirSync(f.options.libraWorkspaceRoot), []);
  assert.equal(fs.readFileSync(path.join(f.root, 'sources/source.mkv'), 'utf8'), 'source preserved');
});

test('a restarted Supervisor recovers the same proven-closed operation before constructing another business Host', async t => {
  const f = await fixture(t); let started = false;
  const supervisor = createRuntimeSupervisor(f.options, { async runOperator(input) {
    if (input.action === 'run') { started = true; throw Object.assign(new Error('injected'), { code: 'RESET_TEST_INTERRUPTION' }); }
    return runFreshResetProcess(input);
  } }); f.supervisors.push(supervisor); await supervisor.start(); await requestReset(supervisor, f.headers);
  await until(async () => {
    if (!started) return false;
    try { return (await supervisor.inject({ method: 'GET', url: '/v1/admin/runtime', headers: f.headers })).json().mode === 'error'; } catch { return false; }
  });
  await supervisor.close(); let businessOpened = 0, childClosed = false;
  const replacement = createRuntimeSupervisor(f.options, {
    async runOperator(input) { const result = await runFreshResetProcess(input); childClosed = true; return result; },
    async createHost(options) { assert.equal(childClosed, true, 'the old Kernel cannot be constructed during recovery'); businessOpened++; return createCleanServiceHost(options); },
  }); f.supervisors.push(replacement); await replacement.start(); await replacement.wait();
  const runtime = await replacement.inject({ method: 'GET', url: '/v1/admin/runtime', headers: f.headers });
  assert.equal(runtime.statusCode, 200, runtime.body); assert.equal(runtime.json().mode, 'stopped');
  assert.equal(runtime.json().operation.state, 'completed'); assert.equal(businessOpened, 1);
});

test('a restart without the durable close proof exposes a stopped error and cannot open or retry the business generation', async t => {
  const f = await fixture(t);
  const supervisor = createRuntimeSupervisor(f.options, { async createHost(options) {
    const host = await createCleanServiceHost({ ...options, createFormationResetPort(ports) {
      return options.createFormationResetPort({ ...ports, assertWorkspaceAvailable() { ports.assertWorkspaceAvailable(); } });
    } });
    return { ...host, async closeDatabaseGeneration() { throw Object.assign(new Error('injected before close'), { code: 'RESET_TEST_INTERRUPTION' }); } };
  } }); f.supervisors.push(supervisor); await supervisor.start(); const { payload } = await requestReset(supervisor, f.headers);
  await until(async () => (await supervisor.inject({ method: 'GET', url: '/v1/admin/runtime', headers: f.headers })).json().mode === 'error');
  await supervisor.close();
  const replacement = createRuntimeSupervisor(f.options, { createHost() { assert.fail('unproven generation must remain closed'); }, runOperator() { assert.fail('unproven closure cannot be retried'); } });
  f.supervisors.push(replacement); await replacement.start();
  const runtime = await replacement.inject({ method: 'GET', url: '/v1/admin/runtime', headers: f.headers });
  assert.equal(runtime.statusCode, 200); assert.equal(runtime.json().error.code, 'RESET_FENCE_CLOSE_NOT_PROVEN');
  assert.equal(runtime.json().normalSupplyAllowed, false);
  const retry = await replacement.inject({ method: 'POST', url: '/v1/admin/runtime/actions/reset', headers: f.headers, payload });
  assert.equal(retry.statusCode, 409); assert.equal(retry.json().error.code, 'RESET_FENCE_CLOSE_NOT_PROVEN');
});

test('a persisted writer-drain receipt and a newly acquired lifetime lease close the interrupted closing phase', async t => {
  const f = await fixture(t);
  const supervisor = createRuntimeSupervisor(f.options, { async createHost(options) {
    const host = await createCleanServiceHost(options);
    return { ...host, async closeDatabaseGeneration() { throw Object.assign(new Error('injected after drain'), { code: 'RESET_TEST_INTERRUPTION' }); } };
  } }); f.supervisors.push(supervisor); await supervisor.start(); await requestReset(supervisor, f.headers);
  await until(async () => (await supervisor.inject({ method: 'GET', url: '/v1/admin/runtime', headers: f.headers })).json().mode === 'error');
  assert.equal(readColdResetState(f.options.dataDir).fence.phase, 'closing');
  const overlapping = createRuntimeSupervisor(f.options);
  await assert.rejects(overlapping.start(), { code: 'RESET_SUPERVISOR_ALREADY_ACTIVE' });
  await supervisor.close();
  const replacement = createRuntimeSupervisor(f.options); f.supervisors.push(replacement);
  await replacement.start(); await replacement.wait();
  const state = (await replacement.inject({ method: 'GET', url: '/v1/admin/runtime', headers: f.headers })).json();
  assert.equal(state.mode, 'stopped'); assert.equal(state.operation.state, 'completed'); assert.equal(state.normalSupplyAllowed, false);
});

for (const priorReset of [false, true]) test(`atomic pending intent recovers before its fence exists (prior Reset: ${priorReset})`, async t => {
  const f = await fixture(t);
  if (priorReset) {
    const first = createRuntimeSupervisor(f.options); f.supervisors.push(first);
    await first.start(); await requestReset(first, f.headers);
    await until(async () => {
      try { const state = (await first.inject({ method: 'GET', url: '/v1/admin/runtime', headers: f.headers })).json();
        return state.mode === 'stopped' && state.operation?.state === 'completed' && !state.resetStage;
      } catch { return false; }
    });
    await first.close();
  }
  const supervisor = createRuntimeSupervisor(f.options, { createHost(options) {
    return createCleanServiceHost({ ...options, createFormationResetPort(ports) {
      const port = options.createFormationResetPort(ports);
      return { ...port, apply(preview, persistIntent) {
        return port.apply(preview, async (...args) => {
          await persistIntent(...args);
          throw Object.assign(new Error('injected after atomic intent, before fence'), { code: 'RESET_TEST_INTERRUPTION' });
        });
      } };
    } });
  } }); f.supervisors.push(supervisor); await supervisor.start();
  const preview = (await supervisor.inject({ method: 'GET', url: '/v1/admin/runtime/reset-preview', headers: f.headers })).json();
  const response = await supervisor.inject({ method: 'POST', url: '/v1/admin/runtime/actions/reset', headers: f.headers,
    payload: { idempotencyKey: 'interrupted-atomic-reset', previewDigest: preview.previewDigest, confirmed: true } });
  assert.equal(response.statusCode, 202, response.body);
  await until(async () => (await supervisor.inject({ method: 'GET', url: '/v1/admin/runtime', headers: f.headers })).json().mode === 'error');
  const intent = JSON.parse(fs.readFileSync(f.intentPath, 'utf8'));
  assert.equal(intent.pendingReset.resetId, intent.resetWorkflow.spec.generationId);
  assert.equal(intent.resetWorkflow.drainReceipt.allFileWritersStopped, true);
  assert.notEqual(readColdResetState(f.options.dataDir)?.fence.generationId, intent.pendingReset.resetId);
  await supervisor.close();
  let recovered = false;
  const replacement = createRuntimeSupervisor(f.options, {
    async runOperator(input) { const result = await runFreshResetProcess(input); recovered = true; return result; },
    createHost(options) { assert.equal(recovered, true, 'no business Kernel before the pending generation is recovered'); return createCleanServiceHost(options); },
  }); f.supervisors.push(replacement); await replacement.start(); await replacement.wait();
  const result = (await replacement.inject({ method: 'GET', url: '/v1/admin/runtime', headers: f.headers })).json();
  assert.equal(result.mode, 'stopped'); assert.equal(result.normalSupplyAllowed, false);
  assert.equal(result.operation.operationId, response.json().operationId);
  assert.equal(result.operation.state, 'completed');
});
