'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-libra-automation-'));
process.env.CONTROL_PLANE_DATA_DIR = dataDir;

const libraStore = require('../src/libraStore');
const { createLibraRuntime } = require('../src/libraRuntime');

function createFixtures() {
  let config = {
    subLibraries: [],
    embyServers: { server: { userId: 'user', baseUrl: 'http://emby', apiKey: 'key' } },
  };
  const configs = {
    loadConfig: () => structuredClone(config),
    saveConfig(next) { config = structuredClone(next); return structuredClone(config); },
  };
  const sources = new Map();
  const bound = new Map();
  const admissions = new Map();
  const pages = [
    { observations: [{ sourceReference: { source: 'emby', subLib: { uuid: 'auto-lib', embyServerId: 'server', sectionId: 'section' }, sourceRefId: 'emby-1' } }], cursor: { startIndex: 1 }, done: false, total: 2 },
    { observations: [{ sourceReference: { source: 'emby', subLib: { uuid: 'auto-lib', embyServerId: 'server', sectionId: 'section' }, sourceRefId: 'emby-2' } }], cursor: { startIndex: 2 }, done: true, total: 2 },
  ];
  const nexoraService = {
    observeLibraryPage: async ({ cursor }) => pages[cursor.startIndex || 0],
    resolveBoundItemId(reference) { return bound.get(reference.sourceRefId) || ''; },
    ensureOnboarding(command) {
      bound.set(command.sourceReference.sourceRefId, command.itemId);
      const projection = { itemId: command.itemId, readiness: 'ready', sourceRevision: `source-${command.sourceReference.sourceRefId}`, sourceAccessDescriptor: { sourceType: 'emby', subLibraryId: 'auto-lib', identityPayload: { serverId: 'server', embyItemId: command.sourceReference.sourceRefId } } };
      sources.set(command.itemId, projection);
      return projection;
    },
    diagnoseSource: ({ itemId }) => sources.get(itemId),
    ensureOffboarding: () => ({}),
    getSourceProjection: (itemId) => sources.get(itemId) || { itemId, readiness: 'unresolved' },
    getSourceProjections: (itemIds) => Object.fromEntries(itemIds.map((itemId) => [itemId, sources.get(itemId) || { itemId, readiness: 'unresolved' }])),
  };
  const kairoxService = {
    reconcileMaintenance(command) {
      const projection = { itemId: command.itemId, admissionCurrent: true, admission: { ...command, status: 'active' }, maintenanceRevision: `maintenance-${command.admissionGeneration}` };
      admissions.set(command.itemId, projection);
      return projection;
    },
    suspendMaintenance: () => ({}),
    requestMaintenance: () => ({}),
    updateUserPerception: () => ({}),
    getMaintenanceProjection: (itemId) => admissions.get(itemId) || { itemId, admissionCurrent: false },
    getMaintenanceProjections: (itemIds) => Object.fromEntries(itemIds.map((itemId) => [itemId, admissions.get(itemId) || { itemId, admissionCurrent: false }])),
  };
  return { configs, nexoraService, kairoxService };
}

test.after(() => {
  libraStore.resetForTests();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('Libra auto library creates durable paged observation work and resumes its cursor', async () => {
  const fixtures = createFixtures();
  const runtime = createLibraRuntime({ ...fixtures, store: libraStore });
  const created = runtime.createSubLibrary({
    uuid: 'auto-lib', name: 'Auto', source: 'emby', embyServerId: 'server', sectionId: 'section',
    libraryAutomationMode: 'auto', maintenanceAutomationMode: 'auto',
  });
  assert.ok(created.observationWork);
  const first = await runtime.runLibraryWork(created.observationWork.workId, { limit: 1 });
  assert.strictEqual(first.status, 'pending');
  assert.strictEqual(first.cursor.startIndex, 1);
  const second = await runtime.runLibraryWork(created.observationWork.workId, { limit: 1 });
  assert.strictEqual(second.status, 'done');
  assert.deepStrictEqual(second.payload, created.observationWork.payload, 'idempotent request payload must remain immutable');
  const items = libraStore.getLibraryItems();
  assert.strictEqual(items.length, 2);
  assert.ok(items.every((item) => item.phase === 'maintenance' && item.subLibraryId === 'auto-lib'));
});

test('Libra manual library waits for an explicit durable observe intent', () => {
  libraStore.resetForTests();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
  const fixtures = createFixtures();
  const runtime = createLibraRuntime({ ...fixtures, store: libraStore });
  const created = runtime.createSubLibrary({ uuid: 'manual-lib', name: 'Manual', source: 'folder', watchRoot: dataDir });
  assert.strictEqual(created.observationWork, null);
  const work = runtime.requestLibraryObservation({ subLibraryId: 'manual-lib', idempotencyKey: 'manual-observe-1' });
  assert.strictEqual(work.workKind, 'observe_library');
  assert.strictEqual(work.status, 'pending');
});
