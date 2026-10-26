'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { initializeCleanData } = require('../scripts/helix-operational-safety');
const { createColdResetFence, assertBusinessGenerationOpenAllowed } = require('../src/clean-reset-generation-fence');
const { inventoryBackupSources, createVerifiedBackup } = require('../scripts/formation-reset-backup');
const { runFreshResetProcess } = require('../scripts/formation-reset-process');
const { createCleanServiceHost } = require('../src/clean-service-host');
const { stageResetDatabase } = require('../scripts/formation-reset-stage');
const { fileDigest } = require('../scripts/formation-reset-generation');

async function fixture(t, { preflight = false } = {}) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'reset-process-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const folder of ['data', 'operations', 'archives', 'workspace', 'sources', 'collection', 'admin']) fs.mkdirSync(path.join(root, folder));
  const dataDir = path.join(root, 'data'), secretRoot = 'isolated-cold-operator-test-secret';
  const initialized = initializeCleanData({ dataDir, secretRoot, confirmation: 'INITIALIZE_HELIX_CLEAN_V1' });
  fs.mkdirSync(path.join(dataDir, 'operator-runtime'));
  fs.writeFileSync(path.join(root, 'workspace', 'unfinished.bin'), 'discarded private output');
  fs.writeFileSync(path.join(root, 'sources', 'source.mkv'), 'original source');
  fs.writeFileSync(path.join(root, 'collection', 'owned.mkv'), 'formal file');
  fs.writeFileSync(path.join(root, 'admin', 'index.html'), '<main>test</main>');
  const generationId = 'a'.repeat(64), expectedRuntimeRevision = 2;
  const intent = { schema: 'shelfdeck.runtime-intent@1', desiredMode: 'stopped', revision: expectedRuntimeRevision,
    pendingReset: { operationId: 'b'.repeat(64), previewDigest: 'c'.repeat(64), backupId: 'reset-test', resetId: generationId } };
  const intentPath = path.join(dataDir, 'operator-runtime/intent.json');
  if (preflight) intent.pendingReset = null;
  fs.writeFileSync(intentPath, JSON.stringify(intent));
  if (preflight) return { root, secretRoot, intentPath, apiKey: initialized.adminApiKey, spec: { dataDir, generationId, expectedRuntimeRevision,
    operationRoot: path.join(root, 'operations'), backupParent: path.join(root, 'archives'),
    backupSourceOptions: { roots: [{ id: 'data', path: dataDir }, { id: 'workspace', path: path.join(root, 'workspace') }] },
    storage: { roots: [path.join(root, 'workspace')], protectedDirectories: [path.join(root, 'sources'), path.join(root, 'collection')] } } };
  const fence = createColdResetFence({ dataDir, generationId, expectedRuntimeRevision }); fence.begin();
  // initializeCleanData has closed its native Kernel. The separate native Host
  // close test covers draining requests/encodes before producing this receipt.
  fence.markClosed({ generationId, allBusinessConnectionsClosed: true });
  const sourceOptions = { roots: [{ id: 'data', path: dataDir }, { id: 'workspace', path: path.join(root, 'workspace') }] };
  const manifest = inventoryBackupSources(sourceOptions), backupRoot = path.join(root, 'archives', 'reset-test');
  await createVerifiedBackup({ sourceOptions, manifest, targetRoot: backupRoot, assertStopped: fence.assertClosed });
  const backupManifestPath = path.join(root, 'archives', 'reset-test-manifest.json');
  fs.writeFileSync(backupManifestPath, JSON.stringify(manifest));
  const spec = { dataDir, generationId, expectedRuntimeRevision, operationRoot: path.join(root, 'operations'),
    backupManifestPath, backupRoot, backupInventoryDigest: manifest.inventoryDigest, backupDataRootId: 'data',
    storage: { roots: [path.join(root, 'workspace')], protectedDirectories: [path.join(root, 'sources'), path.join(root, 'collection')] } };
  return { root, spec, fence, intent, intentPath, secretRoot };
}

async function approvedColdFixture(t) {
  const f = await fixture(t, { preflight: true });
  const approved = await runFreshResetProcess({ spec: f.spec, action: 'inspect' });
  const spec = { ...f.spec, expectedRuntimeRevision: f.spec.expectedRuntimeRevision + 1,
    storage: approved.storage, approvedPreflight: approved };
  const intent = JSON.parse(fs.readFileSync(f.intentPath, 'utf8'));
  intent.revision = spec.expectedRuntimeRevision;
  intent.pendingReset = { operationId: 'b'.repeat(64), previewDigest: approved.previewDigest,
    backupId: 'reset-' + spec.generationId, resetId: spec.generationId };
  fs.writeFileSync(f.intentPath, JSON.stringify(intent));
  const fence = createColdResetFence(spec); fence.begin();
  // initializeCleanData closed its Kernel. No Host was started in this fixture.
  fence.markClosed({ generationId: spec.generationId, allBusinessConnectionsClosed: true });
  return { ...f, spec, fence };
}

test('isolated Operator process uses the approved temp volume and switches a native schema while stopped', async t => {
  const f = await fixture(t), previousTemp = process.env.SQLITE_TMPDIR;
  const preview = await runFreshResetProcess({ spec: f.spec, action: 'prepare' });
  assert.equal(preview.ready, true); assert.equal(preview.counts.length, 239);
  assert.equal(process.env.SQLITE_TMPDIR, previousTemp, 'the Host environment cannot be changed by SQLite temp selection');
  assert.throws(() => assertBusinessGenerationOpenAllowed(f.spec.dataDir), { code: 'RESET_COLD_RECOVERY_REQUIRED' });
  const receipt = await runFreshResetProcess({ spec: f.spec, action: 'apply',
    request: { previewDigest: preview.previewDigest, idempotencyKey: 'cold-process' } });
  assert.equal(receipt.phase, 'complete'); f.fence.complete(receipt);
  assert.equal(receipt.verification.reconstructedCommits, 0, 'empty-native fixture is not media acceptance');
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'workspace')), []);
  assert.equal(fs.readFileSync(path.join(f.root, 'sources/source.mkv'), 'utf8'), 'original source');
  assert.equal(fs.readFileSync(path.join(f.root, 'collection/owned.mkv'), 'utf8'), 'formal file');
  f.intent.pendingReset = null; f.intent.revision++; fs.writeFileSync(f.intentPath, JSON.stringify(f.intent));
  assertBusinessGenerationOpenAllowed(f.spec.dataDir);
  const host = await createCleanServiceHost({ dataDir: f.spec.dataDir, secretRoot: f.secretRoot, adminDistDir: path.join(f.root, 'admin') });
  try {
    const health = await host.inject({ method: 'GET', url: '/v1/health' });
    assert.equal(health.statusCode, 200, health.body);
    assert.equal(health.json().normalSupplyAllowed, false);
  } finally { await host.close(); }
});

test('the child rejects an unclosed fence and a changed verified backup without touching source files', async t => {
  const f = await fixture(t);
  f.intent.revision++; fs.writeFileSync(f.intentPath, JSON.stringify(f.intent));
  await assert.rejects(runFreshResetProcess({ spec: f.spec, action: 'prepare' }), { code: 'RESET_FENCE_RUNTIME_CHANGED' });
  f.intent.revision--; fs.writeFileSync(f.intentPath, JSON.stringify(f.intent));
  fs.writeFileSync(path.join(f.spec.backupRoot, 'workspace/unfinished.bin'), 'changed backup');
  await assert.rejects(runFreshResetProcess({ spec: f.spec, action: 'prepare' }), { code: 'RESET_BACKUP_VERIFICATION_FAILED' });
  assert.equal(fs.readFileSync(path.join(f.root, 'workspace/unfinished.bin'), 'utf8'), 'discarded private output');
});

test('a killed private inspection copy is retained and the actual Operator process can retry', async t => {
  const f = await fixture(t);
  const privateRoot = path.join(f.spec.operationRoot, f.spec.generationId + '-operator');
  fs.mkdirSync(privateRoot);
  const backupPath = path.join(f.spec.backupRoot, 'data', 'shelfdeck.db');
  const digest = fileDigest(backupPath);
  const partial = path.join(privateRoot, '.reset-stage-' + f.spec.generationId + '-1.db');
  assert.throws(() => stageResetDatabase({ sourcePath: backupPath, stagePath: path.join(privateRoot, 'verified-source.db'),
    journalPath: path.join(privateRoot, 'inspection-copy.json'), generationId: f.spec.generationId,
    candidateDigest: digest, assertStopped: f.fence.assertClosed, checkpoint(phase) {
      if (phase === 'database_copy_staged') { fs.truncateSync(partial, 123); throw Error('killed during inspection copy'); }
    } }), /killed during inspection copy/);
  const preview = await runFreshResetProcess({ spec: f.spec, action: 'prepare' });
  assert.equal(preview.ready, true);
  assert.equal(fs.statSync(partial).size, 123, 'the failed copy remains evidence');
  assert.equal(fileDigest(backupPath), digest, 'the verified archive remains byte-for-byte unchanged');
  assert.equal(fileDigest(path.join(privateRoot, 'verified-source.db')), digest);
  const journal = JSON.parse(fs.readFileSync(path.join(privateRoot, 'inspection-copy.json'), 'utf8'));
  assert.deepEqual(journal.attempts.map(item => item.state), ['abandoned', 'closed']);
  assert.throws(() => assertBusinessGenerationOpenAllowed(f.spec.dataDir), { code: 'RESET_COLD_RECOVERY_REQUIRED' });
});

test('actual preflight child reads the stopped native Host without closing it or changing its intent and data', async t => {
  const f = await fixture(t, { preflight: true });
  const host = await createCleanServiceHost({ dataDir: f.spec.dataDir, secretRoot: f.secretRoot, adminDistDir: path.join(f.root, 'admin') });
  const Database = require('better-sqlite3');
  const { digestResetSnapshot } = require('../scripts/formation-reset-snapshot-digest');
  function logicalSnapshot() {
    const db = new Database(path.join(f.spec.dataDir, 'shelfdeck.db'), { readonly: true });
    try { db.exec('BEGIN'); return digestResetSnapshot(db).digest; }
    finally { if (db.inTransaction) db.exec('ROLLBACK'); db.close(); }
  }
  try {
    const before = logicalSnapshot(), intent = fs.readFileSync(f.intentPath, 'utf8');
    const [preview, health] = await Promise.all([runFreshResetProcess({ spec: f.spec, action: 'inspect' }),
      host.inject({ method: 'GET', url: '/v1/health' })]);
    assert.equal(health.statusCode, 200); assert.equal(health.json().normalSupplyAllowed, false);
    assert.equal(preview.ready, true); assert.equal(preview.counts.length, 239);
    assert.equal(preview.sourceSnapshotDigest, before);
    assert.equal(logicalSnapshot(), before, 'preflight cannot mutate any business row');
    assert.equal(fs.readFileSync(f.intentPath, 'utf8'), intent);
    assert.equal(preview.protectedSummary.collectionCount, 0, 'empty collection fixture is not production acceptance');
    assert.equal(fs.readFileSync(path.join(f.root, 'workspace', 'unfinished.bin'), 'utf8'), 'discarded private output');
    assert.equal(fs.existsSync(path.join(f.spec.dataDir, 'database-generation.json')), false);
    assert.deepEqual(fs.readdirSync(f.spec.backupParent), [], 'preflight does not create a backup');
    assert.equal(fs.readdirSync(path.join(f.spec.operationRoot, f.spec.generationId + '-operator')).some(name => name.startsWith('preflight-')), false);
    const second = await runFreshResetProcess({ spec: f.spec, action: 'inspect' });
    assert.equal(second.previewDigest, preview.previewDigest, 'new disposable file paths and disk availability do not change scope');
  } finally { await host.close(); }
});

test('one leased cold child backs up, switches, cleans, and replays the completed receipt while still stopped', async t => {
  const f = await approvedColdFixture(t), { spec } = f;
  const request = { idempotencyKey: 'whole-cold-process' };
  const receipt = await runFreshResetProcess({ spec, action: 'run', request });
  assert.equal(receipt.phase, 'complete'); assert.equal(receipt.desiredMode, 'stopped');
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'workspace')), []);
  assert.equal(fs.readFileSync(path.join(f.root, 'sources/source.mkv'), 'utf8'), 'original source');
  assert.equal(fs.readFileSync(path.join(f.root, 'collection/owned.mkv'), 'utf8'), 'formal file');
  const backups = fs.readdirSync(spec.backupParent);
  const backupDirectories = backups.filter(name => fs.statSync(path.join(spec.backupParent, name)).isDirectory());
  assert.equal(backupDirectories.length, 1);
  assert.equal(fs.readFileSync(path.join(spec.backupParent, backupDirectories[0], 'workspace/unfinished.bin'), 'utf8'), 'discarded private output');
  assert.deepEqual(await runFreshResetProcess({ spec, action: 'run', request }), receipt);
  assert.deepEqual(fs.readdirSync(spec.backupParent), backups, 'completed replay does not back up or clear again');
  await assert.rejects(runFreshResetProcess({ spec, action: 'run', request: { idempotencyKey: 'different-key' } }),
    { code: 'RESET_OPERATOR_KEY_CONFLICT' });
  assert.throws(() => assertBusinessGenerationOpenAllowed(spec.dataDir), { code: 'RESET_COLD_FINALIZATION_REQUIRED' });
  assert.equal(JSON.parse(fs.readFileSync(f.intentPath, 'utf8')).desiredMode, 'stopped');
});

for (const phase of ['old_database_moved', 'deleted']) {
  test('the real cold child recovers a prior interrupted full pipeline at ' + phase, async t => {
    const f = await approvedColdFixture(t), { spec } = f;
    const Database = require('better-sqlite3');
    const { withResetOperatorLease } = require('../scripts/formation-reset-operator-lease');
    const { executeLeased } = require('../scripts/formation-reset-process-child');
    const request = { idempotencyKey: 'interrupted-pipeline' };
    await assert.rejects(withResetOperatorLease({ Database, operationRoot: spec.operationRoot, dataDir: spec.dataDir,
      run: () => executeLeased({ Database, spec, body: { action: 'run', request },
        temporaryRoot: path.join(spec.operationRoot, spec.generationId + '-operator', 'sqlite-temp'),
        checkpoint(point) { if (point === phase) throw Error('injected pipeline interruption'); } }) }), /injected pipeline interruption/);
    assert.throws(() => assertBusinessGenerationOpenAllowed(spec.dataDir), { code: 'RESET_COLD_RECOVERY_REQUIRED' });
    if (phase === 'old_database_moved') assert.equal(fs.existsSync(path.join(spec.dataDir, 'shelfdeck.db')), false);
    else assert.ok(fs.existsSync(path.join(spec.dataDir, 'database-generation.json')));
    const receipt = await runFreshResetProcess({ spec, action: 'run', request });
    assert.equal(receipt.phase, 'complete'); assert.equal(receipt.cleanup.complete, true);
    assert.deepEqual(fs.readdirSync(path.join(f.root, 'workspace')), []);
    assert.equal(fs.readFileSync(path.join(f.root, 'sources/source.mkv'), 'utf8'), 'original source');
    assert.equal(fs.readFileSync(path.join(f.root, 'collection/owned.mkv'), 'utf8'), 'formal file');
    assert.equal(JSON.parse(fs.readFileSync(f.intentPath, 'utf8')).desiredMode, 'stopped');
  });
}

test('authenticated Runtime hands a stopped real Host to the cold Operator and a fresh Host opens stopped', async t => {
  const f = await fixture(t, { preflight: true });
  const { createFreshFormationResetPort } = require('../scripts/formation-reset-runtime-port');
  let host, reopened, activeReset, previewError;
  const options = { dataDir: f.spec.dataDir, secretRoot: f.secretRoot, adminDistDir: path.join(f.root, 'admin'),
    libraWorkspaceRoot: f.spec.storage.roots[0] };
  host = await createCleanServiceHost({ ...options, createFormationResetPort(hostPorts) {
    const port = createFreshFormationResetPort({ ...hostPorts, buildSpec: () => ({
      dataDir: f.spec.dataDir, operationRoot: f.spec.operationRoot, backupParent: f.spec.backupParent,
      backupSourceOptions: f.spec.backupSourceOptions, storage: f.spec.storage,
    }), closeGeneration: request => host.closeDatabaseGeneration(request) });
    return { ...port, async preview() {
      try { return await port.preview(); } catch (error) { previewError = { code: error.code, message: error.message }; throw error; }
    }, apply(preview, beforeApply) {
      activeReset = port.apply(preview, beforeApply); activeReset.catch(() => {}); return activeReset;
    } };
  } });
  try {
    const preview = await host.inject({ method: 'GET', url: '/v1/admin/runtime/reset-preview', headers: { 'x-api-key': f.apiKey } });
    assert.equal(preview.statusCode, 200, JSON.stringify({ body: preview.json(), previewError })); assert.equal(preview.json().ready, true);
    const response = await host.inject({ method: 'POST', url: '/v1/admin/runtime/actions/reset', headers: { 'x-api-key': f.apiKey },
      payload: { idempotencyKey: 'http-cold-reset', confirmed: true, previewDigest: preview.json().previewDigest } });
    assert.equal(response.statusCode, 202, response.body);
    await activeReset;
    const operationId = response.json().operationId;
    let receipt;
    for (let i = 0; i < 100; i++) {
      receipt = JSON.parse(fs.readFileSync(path.join(f.spec.dataDir, 'operator-runtime', operationId + '.json'), 'utf8'));
      if (receipt.state !== 'pending') break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(receipt.state, 'completed', JSON.stringify(receipt.error));
    assert.equal(receipt.result.phase, 'complete');
    assert.equal(JSON.parse(fs.readFileSync(f.intentPath, 'utf8')).pendingReset, null);
    assertBusinessGenerationOpenAllowed(f.spec.dataDir);
    reopened = await createCleanServiceHost(options);
    const runtime = await reopened.inject({ method: 'GET', url: '/v1/admin/runtime', headers: { 'x-api-key': f.apiKey } });
    assert.equal(runtime.statusCode, 200, runtime.body);
    assert.equal(runtime.json().mode, 'stopped'); assert.equal(runtime.json().normalSupplyAllowed, false);
    assert.equal(fs.readFileSync(path.join(f.root, 'sources/source.mkv'), 'utf8'), 'original source');
    assert.equal(fs.readFileSync(path.join(f.root, 'collection/owned.mkv'), 'utf8'), 'formal file');
  } finally { await activeReset?.catch(() => {}); await reopened?.close(); await host.close(); }
});
