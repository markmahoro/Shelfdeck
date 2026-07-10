'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const srcRoot = path.join(__dirname, '..', 'src');

function source(file) {
  return fs.readFileSync(path.join(srcRoot, file), 'utf8');
}

test('Helix service facades expose the accepted in-process contracts', () => {
  const nexora = require('../src/nexoraService');
  const { createKairoxService } = require('../src/kairoxService');
  const { createLibraService } = require('../src/libraService');
  const kairox = createKairoxService({ implementation: {
    getMaintenanceProjection: (itemId) => ({ itemId }),
  } });
  const libra = createLibraService({ nexoraService: nexora, kairoxService: kairox });

  for (const name of ['ensureOnboarding', 'diagnoseSource', 'ensureOffboarding', 'getSourceProjection', 'getSourceProjections']) {
    assert.strictEqual(typeof nexora[name], 'function', `missing NexoraService.${name}`);
  }
  for (const name of ['reconcileMaintenance', 'suspendMaintenance', 'requestMaintenance', 'startMaintenanceRun', 'setMaintenancePriority', 'clearMaintenancePriority', 'reconcileMaintenanceRun', 'requestMetadataRefresh', 'getMaintenanceProjection', 'getMaintenanceProjections']) {
    assert.strictEqual(typeof kairox[name], 'function', `missing KairoxService.${name}`);
  }
  for (const name of ['acceptSource', 'requestMaintenance', 'requestMaintenanceRun', 'setMaintenancePriority', 'clearMaintenancePriority', 'requestMetadataRefresh', 'requestOffboarding', 'requestOffboardingBatch', 'reconcileItem', 'reconcileBatch', 'getLibraryProjection', 'getLibraryProjections', 'queryLibraryProjections']) {
    assert.strictEqual(typeof libra[name], 'function', `missing LibraService.${name}`);
  }
});

test('only the Libra composition root imports both Helix capability facades', () => {
  const offenders = fs.readdirSync(srcRoot)
    .filter((name) => name.endsWith('.js'))
    .filter((name) => {
      const text = source(name);
      return text.includes("require('./nexoraService')") && text.includes("require('./kairoxService')");
    });
  assert.deepStrictEqual(offenders, ['libraCompositionRoot.js']);
});

test('Nexora and Kairox service facades do not depend on each other', () => {
  assert.doesNotMatch(source('nexoraService.js'), /require\(['"]\.\/kairoxService['"]\)/);
  assert.doesNotMatch(source('kairoxService.js'), /require\(['"]\.\/nexoraService['"]\)/);
  assert.doesNotMatch(source('libraService.js'), /require\(['"]\.\/(nexoraService|kairoxService)['"]\)/);
});

test('Nexora runtime owns source writes and no longer writes legacy Membership', () => {
  assert.match(source('nexoraService.js'), /require\(['"]\.\/nexoraStore['"]\)/);
  assert.doesNotMatch(source('nexoraService.js'), /require\(['"]\.\/libraryStore['"]\)/);
  assert.doesNotMatch(source('nexoraService.js'), /upsertNexoraMembership/);
  assert.strictEqual(fs.existsSync(path.join(srcRoot, 'mediaLibraryService.js')), false);
  assert.strictEqual(fs.existsSync(path.join(srcRoot, 'adultLibraryService.js')), false);
});

test('Libra composes live capability projections without persisting capability snapshots', () => {
  const runtime = source('libraRuntime.js');
  const reconciler = source('libraReconciler.js');
  assert.match(runtime, /nexoraService\.getSourceProjections\(ids\)/);
  assert.match(runtime, /kairoxService\.getMaintenanceProjections\(ids\)/);
  assert.match(runtime, /store\.getCurrentOperationsForItems\(ids\)/);
  assert.doesNotMatch(runtime, /sourceProjection\s*:/);
  assert.doesNotMatch(runtime, /maintenanceProjection\s*:/);
  assert.doesNotMatch(reconciler, /sourceProjection\s*:/);
  assert.doesNotMatch(reconciler, /maintenanceProjection\s*:/);
});

test('public Helix path exposes only clean maintenance targets and no legacy disposal routes', () => {
  const appSource = source('app.js');
  assert.doesNotMatch(appSource, /app\.post\('\/v1\/tasks'/);
  assert.match(appSource, /actions\/start-maintenance/);
  assert.match(appSource, /actions\/prioritize-maintenance/);
  assert.doesNotMatch(appSource, /actions\/execute|actions\/retry|actions\/pause/);
  assert.doesNotMatch(appSource, /priorityManuallyAdjusted/);
  assert.doesNotMatch(appSource, /HELIX_LEGACY_TARGET_REMOVED/);
  assert.doesNotMatch(appSource, /\/v1\/admin\/delete-candidates/);
  assert.doesNotMatch(appSource, /\/actions\/scan/);
  assert.doesNotMatch(appSource, /\/v1\/library\/actions\/ingest/);
  assert.doesNotMatch(appSource, /\/v1\/library\/actions\/refresh/);
  assert.doesNotMatch(appSource, /\/v1\/library\/cache/);
  assert.doesNotMatch(appSource, /recompute-strategy/);
});

test('Kairox Runtime and Basedata executor write only Kairox-owned facts', () => {
  const runtime = source('kairoxRuntime.js');
  const basedata = source('basedataFlowExecutor.js');
  assert.match(runtime, /require\('\.\/kairoxStore'\)/);
  assert.match(basedata, /kairoxStore\.publishBasedata/);
  assert.doesNotMatch(runtime, /require\('\.\/libraryStore'\)/);
  assert.doesNotMatch(basedata, /require\('\.\/libraryStore'\)/);
  assert.doesNotMatch(basedata, /libraryStore\./);
});

test('Task Scheduler dispatches task snapshots without reading or writing Library domain facts', () => {
  const scheduler = source('taskScheduler.js');
  assert.doesNotMatch(scheduler, /require\(['"]\.\/mediaLibraryService['"]\)/);
  assert.doesNotMatch(scheduler, /require\(['"]\.\/libraryStore['"]\)/);
  assert.doesNotMatch(scheduler, /getLibraryItem|loadLibrary|saveLibrary/);
});

test('gate invalidation writes Kairox freshness and never mutates Library domain facts', () => {
  const invalidation = source('gateInvalidationService.js');
  assert.match(invalidation, /require\(['"]\.\/kairoxStore['"]\)/);
  assert.doesNotMatch(invalidation, /mediaLibraryService|libraryStore/);
  assert.doesNotMatch(invalidation, /ingest|archive|delete/);
});

test('optimize executors publish Kairox facts after a durable mutation boundary', () => {
  for (const file of ['transcodeFlowExecutor.js', 'upgradeFlowExecutor.js']) {
    const executor = source(file);
    assert.match(executor, /mediaMutation:\s*\{ status: 'committed'/);
    assert.match(executor, /recordPostOptimizeReplacement/);
  }
  const recovery = source('flowRecoveryContract.js');
  assert.match(recovery, /transcode_publish/);
  assert.match(recovery, /upgrade_publish/);
  assert.doesNotMatch(recovery, /\bingest\b|\barchive\b|\bdelete\b/);
});

test('Metadata executor publishes Kairox facts without reading or writing mixed Library facts', () => {
  const executor = source('scrapeFlowExecutor.js');
  assert.match(executor, /kairoxStore\.publishMetadata/);
  assert.match(executor, /pendingMetadataPublication/);
  assert.match(executor, /scrape_publish/);
  assert.doesNotMatch(executor, /mediaLibraryService|adultLibraryService|libraryStore|factsFreshnessService|strategyEngine/);
  assert.doesNotMatch(executor, /recordGateInvalidation|invalidatedGate:\s*'ingest'/);
});
