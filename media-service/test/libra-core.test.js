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
      getSourceProjection(itemId) {
        return sourceByItem[itemId] || { itemId, sourceRevision: '', readiness: 'unresolved' };
      },
      getSourceProjections(itemIds) {
        return itemIds.reduce((out, itemId) => {
          out[itemId] = this.getSourceProjection(itemId);
          return out;
        }, {});
      },
      ensureOnboarding(command) {
        return sourceByItem[command.itemId] || { itemId: command.itemId, sourceRevision: 's1', readiness: 'ready' };
      },
      diagnoseSource(command) {
        return sourceByItem[command.itemId] || { itemId: command.itemId, sourceRevision: command.sourceRevision || '', readiness: 'unresolved' };
      },
      ensureOffboarding(command) {
        return { itemId: command.itemId, cleanupMode: command.cleanupMode, completed: true, sourceProjection: sourceByItem[command.itemId] || {} };
      },
    },
    kairoxService: {
      getMaintenanceProjection(itemId) {
        return maintenanceByItem[itemId] || { itemId, maintenanceRevision: 'm1', maintenanceState: 'maintaining', maintenanceComplete: false };
      },
      getMaintenanceProjections(itemIds) {
        return itemIds.reduce((out, itemId) => {
          out[itemId] = this.getMaintenanceProjection(itemId);
          return out;
        }, {});
      },
      reconcileMaintenance(command) { return { itemId: command.itemId, maintenanceRevision: `m:${command.admissionGeneration}`, maintenanceComplete: false }; },
      suspendMaintenance(command) { return { admission: { itemId: command.itemId, status: 'suspended', admissionGeneration: command.admissionGeneration } }; },
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
  const command = { itemId: 'item-idempotent', idempotencyKey: 'onboard-1', sourceReference: { source: 'emby', sourceRefId: 'a' } };
  const first = runtime.acceptSource(command);
  const second = runtime.acceptSource(command);
  assert.strictEqual(first.operation.operationId, second.operation.operationId);
  assert.throws(() => runtime.acceptSource({ ...command, sourceReference: { source: 'emby', sourceRefId: 'b' } }), (error) => error.code === 'LIBRA_IDEMPOTENCY_CONFLICT');
});

test('Libra reconcile advances ready source to maintenance and quarantines a later incident', () => {
  const state = {
    'item-reconcile': { itemId: 'item-reconcile', sourceRevision: 's1', readiness: 'ready', activeBindings: [{ bindingId: 'b1' }] },
  };
  const { nexoraService, kairoxService } = fakes(state);
  const runtime = createLibraRuntime({ nexoraService, kairoxService });
  runtime.acceptSource({ itemId: 'item-reconcile', idempotencyKey: 'onboard-reconcile', sourceReference: {} });
  let projection = runtime.reconcileItem('item-reconcile');
  assert.strictEqual(projection.phase, 'maintenance');
  assert.strictEqual(projection.admissionGeneration, 1);
  state['item-reconcile'] = { itemId: 'item-reconcile', sourceRevision: 's2', readiness: 'missing', latestObservation: { reason: 'source_missing' } };
  projection = runtime.reconcileItem('item-reconcile');
  assert.strictEqual(projection.phase, 'maintenance');
  assert.strictEqual(projection.quarantineStatus, 'source_incident');
  assert.strictEqual(projection.admissionGeneration, 2);
  assert.strictEqual(projection.membershipStatus, 'active');
});

test('Libra phase stays maintenance while reads compose the latest Kairox maintenance state', () => {
  const source = {
    'item-live-projection': { itemId: 'item-live-projection', sourceRevision: 's1', readiness: 'ready' },
  };
  const maintenance = {
    'item-live-projection': {
      itemId: 'item-live-projection', maintenanceRevision: 'm1', maintenanceState: 'maintaining',
      metadataPassed: false, maintenanceComplete: false,
    },
  };
  const { nexoraService, kairoxService } = fakes(source, maintenance);
  const runtime = createLibraRuntime({ nexoraService, kairoxService });
  runtime.acceptSource({ itemId: 'item-live-projection', idempotencyKey: 'onboard-live-projection', sourceReference: {} });
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
  assert.strictEqual(Object.prototype.hasOwnProperty.call(libraStore.getLibraryItem('item-live-projection'), 'maintenanceProjection'), false);
});

test('Libra offboarding requires explicit physical-delete authorization', async () => {
  const { nexoraService, kairoxService } = fakes({
    'item-offboard': { itemId: 'item-offboard', sourceRevision: 's1', readiness: 'ready' },
  });
  const runtime = createLibraRuntime({ nexoraService, kairoxService });
  runtime.acceptSource({ itemId: 'item-offboard', idempotencyKey: 'onboard-offboard', sourceReference: {} });
  runtime.reconcileItem('item-offboard');
  await assert.rejects(() => runtime.requestOffboarding({ itemId: 'item-offboard', idempotencyKey: 'offboard-denied', cleanupMode: 'delete_source' }), (error) => error.code === 'LIBRA_DESTRUCTIVE_AUTHORIZATION_REQUIRED');
  const accepted = await runtime.requestOffboarding({ itemId: 'item-offboard', idempotencyKey: 'offboard-ok', cleanupMode: 'delete_source', destructiveAuthorization: true });
  assert.strictEqual(accepted.projection.phase, 'closed');
  assert.strictEqual(accepted.projection.membership.status, 'closed');
});

test('Libra library query composes Membership, Nexora and Kairox facts without media_items', () => {
  const sources = {
    'query-item': {
      itemId: 'query-item',
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
      itemId: 'query-item',
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
    itemId: 'query-item',
    idempotencyKey: 'query-onboarding',
    sourceReference: { source: 'emby', subLib: { uuid: 'library-query' } },
  });
  const result = runtime.queryLibraryProjections({ subLibraryId: 'library-query', search: 'query title' }, { limit: 10 });
  assert.strictEqual(result.total, 1);
  assert.strictEqual(result.items[0].itemId, 'query-item');
  assert.strictEqual(result.items[0].subLibraryId, 'library-query');
  assert.strictEqual(result.items[0].name, 'Query Title');
  assert.strictEqual(result.items[0].codec, 'h265');
  assert.strictEqual(result.items[0].maintenanceComplete, true);
});
