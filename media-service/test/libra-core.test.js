'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-libra-'));
process.env.CONTROL_PLANE_DATA_DIR = dataDir;

const libraStore = require('../src/libraStore');
const { createLibraRuntime } = require('../src/libraRuntime');

test.after(() => {
  libraStore.resetForTests();
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {}
});

function fakes(sourceByItem = {}, maintenanceByItem = {}) {
  return {
    nexoraService: {
      getSourceProjection(subjectId) {
        return sourceByItem[subjectId] || { subjectId, sourceRevision: '', readiness: 'unresolved' };
      },
      getSourceProjections(subjectIds) {
        return subjectIds.reduce((out, subjectId) => {
          out[subjectId] = this.getSourceProjection(subjectId);
          return out;
        }, {});
      },
      ensureOnboarding(command) {
        return sourceByItem[command.subjectId] || { subjectId: command.subjectId, sourceRevision: 's1', readiness: 'ready' };
      },
      diagnoseSource(command) {
        return sourceByItem[command.subjectId] || { subjectId: command.subjectId, sourceRevision: command.sourceRevision || '', readiness: 'unresolved' };
      },
      ensureOffboarding(command) {
        return { subjectId: command.subjectId, cleanupMode: command.cleanupMode, completed: true, sourceProjection: sourceByItem[command.subjectId] || {} };
      },
    },
    kairoxService: {
      getMaintenanceProjection(subjectId) {
        return maintenanceByItem[subjectId] || { subjectId, maintenanceRevision: 'm1', maintenanceState: 'maintaining', maintenanceComplete: false };
      },
      getMaintenanceProjections(subjectIds) {
        return subjectIds.reduce((out, subjectId) => {
          out[subjectId] = this.getMaintenanceProjection(subjectId);
          return out;
        }, {});
      },
      reconcileMaintenance(command) { return { subjectId: command.subjectId, maintenanceRevision: `m:${command.admissionGeneration}`, maintenanceComplete: false }; },
      suspendMaintenance(command) { return { admission: { subjectId: command.subjectId, status: 'suspended', admissionGeneration: command.admissionGeneration } }; },
      requestMaintenance(command) { return { accepted: true, command }; },
    },
  };
}

test('Libra does not migrate legacy media_items into clean Membership facts', () => {
  assert.strictEqual(fs.existsSync(path.join(__dirname, '..', 'src', 'libraryStore.js')), false);
  const { nexoraService, kairoxService } = fakes();
  const runtime = createLibraRuntime({ nexoraService, kairoxService });
  const projection = runtime.getLibraryProjection('legacy-1');
  assert.strictEqual(projection, null);
});

test('Libra onboarding commands are idempotent and reject payload reuse', () => {
  const { nexoraService, kairoxService } = fakes();
  const runtime = createLibraRuntime({ nexoraService, kairoxService });
  const command = { subjectId: 'item-idempotent', idempotencyKey: 'onboard-1', sourceReference: { source: 'emby', sourceRefId: 'a' } };
  const first = runtime.acceptSource(command);
  const second = runtime.acceptSource(command);
  assert.strictEqual(first.operation.operationId, second.operation.operationId);
  assert.throws(() => runtime.acceptSource({ ...command, sourceReference: { source: 'emby', sourceRefId: 'b' } }), (error) => error.code === 'LIBRA_IDEMPOTENCY_CONFLICT');
});

test('Libra reconcile advances ready source to maintenance and quarantines a later incident', () => {
  const state = {
    'item-reconcile': { subjectId: 'item-reconcile', sourceRevision: 's1', readiness: 'ready', activeBindings: [{ bindingId: 'b1' }] },
  };
  const { nexoraService, kairoxService } = fakes(state);
  const runtime = createLibraRuntime({ nexoraService, kairoxService });
  runtime.acceptSource({ subjectId: 'item-reconcile', idempotencyKey: 'onboard-reconcile', sourceReference: {} });
  let projection = runtime.reconcileItem('item-reconcile');
  assert.strictEqual(projection.phase, 'maintenance');
  assert.strictEqual(projection.admissionGeneration, 1);
  state['item-reconcile'] = { subjectId: 'item-reconcile', sourceRevision: 's2', readiness: 'missing', latestObservation: { reason: 'source_missing' } };
  projection = runtime.reconcileItem('item-reconcile');
  assert.strictEqual(projection.phase, 'maintenance');
  assert.strictEqual(projection.quarantineStatus, 'source_incident');
  assert.strictEqual(projection.admissionGeneration, 2);
  assert.strictEqual(projection.membershipStatus, 'active');
});

test('Libra phase stays maintenance while reads compose the latest Kairox maintenance state', () => {
  const source = {
    'item-live-projection': { subjectId: 'item-live-projection', sourceRevision: 's1', readiness: 'ready' },
  };
  const maintenance = {
    'item-live-projection': {
      subjectId: 'item-live-projection', maintenanceRevision: 'm1', maintenanceState: 'maintaining',
      metadataPassed: false, maintenanceComplete: false,
    },
  };
  const { nexoraService, kairoxService } = fakes(source, maintenance);
  const runtime = createLibraRuntime({ nexoraService, kairoxService });
  runtime.acceptSource({ subjectId: 'item-live-projection', idempotencyKey: 'onboard-live-projection', sourceReference: {} });
  let projection = runtime.getLibraryProjection('item-live-projection');
  assert.strictEqual(projection.phase, 'maintenance');
  assert.strictEqual(projection.maintenance.metadataPassed, false);

  maintenance['item-live-projection'] = {
    ...maintenance['item-live-projection'], maintenanceRevision: 'm2', metadataPassed: true,
  };
  projection = runtime.getLibraryProjection('item-live-projection');
  assert.strictEqual(projection.phase, 'maintenance');
  assert.strictEqual(projection.maintenance.metadataPassed, true);
  assert.strictEqual(projection.maintenance.maintenanceState, 'maintaining');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(libraStore.getLibrarySubject('item-live-projection'), 'maintenanceProjection'), false);
});

test('Libra offboarding requires explicit physical-delete authorization', async () => {
  const { nexoraService, kairoxService } = fakes({
    'item-offboard': { subjectId: 'item-offboard', sourceRevision: 's1', readiness: 'ready' },
  });
  const runtime = createLibraRuntime({ nexoraService, kairoxService });
  runtime.acceptSource({ subjectId: 'item-offboard', idempotencyKey: 'onboard-offboard', sourceReference: {} });
  runtime.reconcileItem('item-offboard');
  await assert.rejects(() => runtime.requestOffboarding({ subjectId: 'item-offboard', idempotencyKey: 'offboard-denied', cleanupMode: 'delete_source' }), (error) => error.code === 'LIBRA_DESTRUCTIVE_AUTHORIZATION_REQUIRED');
  const accepted = await runtime.requestOffboarding({ subjectId: 'item-offboard', idempotencyKey: 'offboard-ok', cleanupMode: 'delete_source', destructiveAuthorization: true });
  assert.strictEqual(accepted.projection.phase, 'closed');
  assert.strictEqual(accepted.projection.membership.status, 'closed');
});

test('Libra library query composes Membership, Nexora and Kairox facts without media_items', () => {
  const sources = {
    'query-item': {
      subjectId: 'query-item',
      sourceRevision: 'source-query',
      readiness: 'ready',
      sourceAccessDescriptor: {
        sourceType: 'emby',
        subLibraryId: 'library-query',
        identityPayload: { embyItemId: 'emby-query' },
      },
    },
  };
  const maintenance = {
    'query-item': {
      subjectId: 'query-item',
      maintenanceRevision: 'maintenance-query',
      maintenanceState: 'complete',
      maintenanceComplete: true,
      metadataPassed: true,
      basedataFacts: { path: '/media/query.mkv', codec: 'h265', resolution: '1920x1080' },
      metadataFacts: { title: 'Query Title', type: 'movie' },
    },
  };
  const { nexoraService, kairoxService } = fakes(sources, maintenance);
  const runtime = createLibraRuntime({ nexoraService, kairoxService });
  runtime.acceptSource({
    subjectId: 'query-item',
    idempotencyKey: 'query-onboarding',
    sourceReference: { source: 'emby', subLib: { uuid: 'library-query' }, item: { type: 'movie' } },
  });
  const result = runtime.queryLibraryProjections({ subLibraryId: 'library-query', search: 'query title' }, { limit: 10 });
  assert.strictEqual(result.total, 1);
  assert.strictEqual(result.items[0].subjectId, 'query-item');
  assert.strictEqual(result.items[0].subLibraryId, 'library-query');
  assert.strictEqual(result.items[0].name, 'Query Title');
  assert.strictEqual(result.items[0].codec, 'h265');
  assert.strictEqual(result.items[0].maintenanceComplete, true);
});

test('Series is one maintenance Subject and never expands user intent into Episode Runs', () => {
  const subLibraryId = 'series-scope-library';
  const sourceByItem = {};
  const maintenanceByItem = {};
  const startedSubjects = [];
  const prioritizedSubjects = [];
  const services = fakes(sourceByItem, maintenanceByItem);
  services.kairoxService.startMaintenanceRun = (command) => {
    startedSubjects.push(command.subjectId);
    return { run: { subjectId: command.subjectId, status: 'ready' } };
  };
  services.kairoxService.setMaintenancePriority = (command) => {
    prioritizedSubjects.push(command.subjectId);
    return { media: { subjectId: command.subjectId, maintenancePriorityClass: 'expedited' } };
  };

  const runtime = createLibraRuntime({
    ...services,
    configs: {
      loadConfig: () => ({
        embyServers: {},
        subLibraries: [{
          uuid: subLibraryId,
          source: 'emby',
          libraryAutomationMode: 'auto',
          maintenanceAutomationMode: 'manual',
          priorityWeight: 100,
          ruleTemplateId: 'default',
        }],
      }),
    },
    resourceGovernor: { runWithPermit: (_request, work) => work() },
  });

  const put = (subjectId) => {
    sourceByItem[subjectId] = { subjectId, sourceRevision: 'scope-source-1', readiness: 'ready' };
    maintenanceByItem[subjectId] = { subjectId, maintenanceRevision: 'scope-maintenance-1', maintenanceState: 'maintaining', maintenanceComplete: false };
    return libraStore.upsertLibrarySubject({
      subjectId,
      subLibraryId,
      membershipStatus: 'active',
      desiredState: 'managed',
      phase: 'maintenance',
      quarantineStatus: 'none',
      admissionGeneration: 1,
      sourceRevision: 'scope-source-1',
      sourceSubjectKey: 'emby:server:series-ref',
      subjectKind: 'series',
      displayName: 'Scope Series',
    });
  };

  put('scope-series');

  const started = runtime.requestMaintenanceRun({ subjectId: 'scope-series', idempotencyKey: 'scope-start' });
  const prioritized = runtime.setMaintenancePriority({ subjectId: 'scope-series', idempotencyKey: 'scope-priority', reason: 'series_expedited' });
  assert.strictEqual(started.affected, 1);
  assert.strictEqual(prioritized.affected, 1);
  assert.deepStrictEqual(startedSubjects, ['scope-series']);
  assert.deepStrictEqual(prioritizedSubjects, ['scope-series']);
});
