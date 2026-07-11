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
    getMaintenanceProjection: (subjectId) => ({ subjectId }),
  } });
  const libra = createLibraService({ nexoraService: nexora, kairoxService: kairox });

  for (const name of ['ensureOnboarding', 'diagnoseSource', 'ensureOffboarding', 'getSourceProjection', 'getSourceProjections']) {
    assert.strictEqual(typeof nexora[name], 'function', `missing NexoraService.${name}`);
  }
  for (const name of ['reconcileMaintenance', 'suspendMaintenance', 'requestMaintenance', 'startMaintenanceRun', 'setMaintenancePriority', 'clearMaintenancePriority', 'reconcileMaintenanceRun', 'requestMetadataRefresh', 'getMaintenanceProjection', 'getMaintenanceProjections', 'getMaintenanceSummaryProjections']) {
    assert.strictEqual(typeof kairox[name], 'function', `missing KairoxService.${name}`);
  }
  for (const name of ['acceptSource', 'requestMaintenance', 'requestMaintenanceRun', 'setMaintenancePriority', 'clearMaintenancePriority', 'requestMetadataRefresh', 'requestOffboarding', 'requestOffboardingBatch', 'reconcileItem', 'reconcileBatch', 'getLibraryProjection', 'getLibraryProjections', 'queryLibraryProjections', 'getLibraryMaintenanceSummaries']) {
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

test('Nexora folder observation yields network filesystem reads and caches each directory per page', () => {
  const nexora = source('nexoraService.js');
  assert.match(nexora, /async function folderObservationPage/);
  assert.match(nexora, /await fs\.promises\.readdir/);
  assert.match(nexora, /entriesByDirectory\.get/);
  assert.doesNotMatch(nexora, /function folderObservationPage[\s\S]*?fs\.readdirSync[\s\S]*?async function observeLibraryPage/);
});

test('operational event-loop metrics use the same rolling window as HTTP metrics', () => {
  const metrics = source('operationalMetrics.js');
  assert.match(metrics, /eventLoopSamples/);
  assert.match(metrics, /setInterval\(sampleEventLoop, EVENT_LOOP_SAMPLE_MS\)/);
  assert.match(metrics, /while \(eventLoopSamples\.length && eventLoopSamples\[0\]\.at < cutoff\)/);
  assert.doesNotMatch(metrics, /p95Ms: Number\(eventLoop\.percentile/);
});

test('Kairox objective reconciliation uses Kairox Store batch facts without per-item bundle reloads', () => {
  const runtime = source('kairoxRuntime.js');
  const objectiveBody = runtime.match(/function reconcileObjectives[\s\S]*?\n  function suspendMaintenance/)[0];
  assert.match(objectiveBody, /facts\.getBundles\(ids\)/);
  assert.doesNotMatch(objectiveBody, /facts\.getBundle\(subjectId\)/);
});

test('Kairox batch projection reads Maintenance Runs in one Store query', () => {
  const runtime = source('kairoxRuntime.js');
  const projectionsBody = runtime.match(/function getMaintenanceProjections[\s\S]*?\n  function reconcileMaintenance/)[0];
  assert.match(projectionsBody, /facts\.getMaintenanceRuns\(ids\)/);
  assert.doesNotMatch(projectionsBody, /facts\.getMaintenanceRun\(subjectId\)/);
});

test('Task Creator scopes authoritative TaskAdmission reads inside the Task Store transaction', () => {
  const creator = source('kairoxTaskCreator.js');
  const store = source('taskStore.js');
  assert.match(creator, /admitAndCreateTask\(\{[\s\S]*?subjectId:[\s\S]*?targetGate/);
  assert.match(store, /function queryTaskAdmissionRowsInner\(db = getDb\(\), scope = \{\}\)/);
  assert.match(store, /WHERE status NOT IN/);
  assert.match(store, /WHERE subject_id=\? AND target_gate=\? AND status IN/);
});

test('Libra stages bounded pages and reconciles only finalized Subject Manifests', () => {
  const runtime = source('libraRuntime.js');
  assert.match(runtime, /nexoraService\.stageObservationPage/);
  assert.match(runtime, /if \(page\.done\)/);
  assert.match(runtime, /nexoraService\.finalizeObservationWork/);
  assert.match(runtime, /reconciler\.reconcileBatch\(observedSubjectIds\)/);
});

test('Libra aggregates one row per active maintenance Subject and yields between batches', () => {
  const runtime = source('libraRuntime.js');
  const summaryBody = runtime.match(/async function getLibraryMaintenanceSummaries[\s\S]*?\n  function acceptSource/)[0];
  assert.match(summaryBody, /item\.membershipStatus === 'active'/);
  assert.doesNotMatch(summaryBody, /item\.playable/);
  assert.match(summaryBody, /kairoxService\.getMaintenanceProjections/);
  assert.match(summaryBody, /setImmediate/);
});

test('Kairox batch projection batch-reads Person preference facts', () => {
  const runtime = source('kairoxRuntime.js');
  const projectionsBody = runtime.match(/function getMaintenanceProjections[\s\S]*?\n  function reconcileMaintenance/)[0];
  assert.match(projectionsBody, /personCatalogStore\.getSubjectPreferenceProjections\(ids\)/);
  assert.match(projectionsBody, /peopleMap\[subjectId\]/);
});

test('Kairox summary projection owns Gate results without querying Task or Run facts', () => {
  const runtime = source('kairoxRuntime.js');
  const summaryBody = runtime.match(/function getMaintenanceSummaryProjections[\s\S]*?\n  function reconcileMaintenance/)[0];
  assert.match(summaryBody, /lifecycle\.decorateItem/);
  assert.match(summaryBody, /buildMaintenanceProjection/);
  assert.doesNotMatch(summaryBody, /taskSummaries|queryLatestAutomaticFailures|getMaintenanceRuns/);
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
  assert.match(runtime, /store\.getCurrentOperationsForSubjects\(ids\)/);
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

test('Kairox Runtime and Basedata capability write only Kairox-owned facts', () => {
  const runtime = source('kairoxRuntime.js');
  const basedata = source('capabilities/basedataCapabilities.js');
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
  assert.doesNotMatch(scheduler, /getLibrarySubject|loadLibrary|saveLibrary/);
});

test('gate invalidation writes Kairox freshness and never mutates Library domain facts', () => {
  const invalidation = source('gateInvalidationService.js');
  assert.match(invalidation, /require\(['"]\.\/kairoxStore['"]\)/);
  assert.doesNotMatch(invalidation, /mediaLibraryService|libraryStore/);
  assert.doesNotMatch(invalidation, /ingest|archive|delete/);
});

test('optimize mutation is owned by atomic capabilities and durable Workflow Events', () => {
  const capabilities = source('capabilities/maintenanceCapabilities.js');
  const runtime = source('eventRuntime.js');
  const postEffects = source('capabilityPostEffects.js');
  assert.match(capabilities, /capability: 'media\.file\.replace'/);
  assert.match(source('capabilities/seriesUpgradeCapabilities.js'), /capability: 'series\.season\.replace'/);
  assert.doesNotMatch(capabilities, /recordGateInvalidation|markBasedataStale|recordMutation|kairoxSignalBus/);
  assert.match(postEffects, /markBasedataStale/);
  assert.match(postEffects, /recordMutation/);
  assert.match(runtime, /workflowStore\.transition/);
  assert.doesNotMatch(runtime, /executorForFlowKind/);
});

test('Metadata capability publishes Kairox facts without mixed Library facts', () => {
  const capabilities = source('capabilities/metadataCapabilities.js');
  assert.match(capabilities, /capability: 'metadata\.publish'/);
  assert.match(capabilities, /kairoxStore\.publishMetadata/);
  assert.doesNotMatch(capabilities, /mediaLibraryService|adultLibraryService|libraryStore|factsFreshnessService|strategyEngine/);
});
