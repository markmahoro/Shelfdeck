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
const libraAutomationEngine = require('../src/libraAutomationEngine');

function createFixtures() {
  let config = {
    subLibraries: [],
    embyServers: { server: { userId: 'user', baseUrl: 'http://emby', accessToken: 'token' } },
  };
  const configs = {
    loadConfig: () => structuredClone(config),
    saveConfig(next) { config = structuredClone(next); return structuredClone(config); },
  };
  const sources = new Map();
  const bound = new Map();
  const admissions = new Map();
  const staged = new Map();
  const pages = [
    { observations: [{ sourceReference: { source: 'emby', subLib: { uuid: 'auto-lib', embyServerId: 'server', sectionId: 'section' }, sourceRefId: 'emby-1', item: { type: 'Movie', name: '测试电影' } } }], cursor: { startIndex: 1 }, done: false, total: 2 },
    { observations: [{ sourceReference: { source: 'emby', subLib: { uuid: 'auto-lib', embyServerId: 'server', sectionId: 'section' }, sourceRefId: 'emby-2', item: { type: 'Movie', name: '测试电影' } } }], cursor: { startIndex: 2 }, done: true, total: 2 },
  ];
  const nexoraService = {
    observeLibraryPage: async ({ cursor }) => pages[cursor.startIndex || 0],
    stageObservationPage({ workId, observations }) { staged.set(workId, [...(staged.get(workId) || []), ...observations]); },
    finalizeObservationWork({ workId }) { return (staged.get(workId) || []).map((entry) => ({ sourceSubjectKey: `emby:server:${entry.sourceReference.sourceRefId}`, subjectKind: 'movie', displayName: entry.sourceReference.item.name, observations: [entry], assets: [{ assetId: `asset-${entry.sourceReference.sourceRefId}`, assetKind: 'movie', seasonKey: '', episodeKey: '', partKey: '', assetRevision: 1, canonicalLocator: { path: `Z:/${entry.sourceReference.sourceRefId}.mkv` } }] })); },
    resolveBoundSubjectId(reference) { return bound.get(reference.sourceRefId) || ''; },
    ensureOnboarding(command) {
      bound.set(command.sourceReference.sourceRefId, command.subjectId);
      const projection = { subjectId: command.subjectId, readiness: 'ready', sourceRevision: `source-${command.sourceReference.sourceRefId}`, sourceAccessDescriptor: { sourceType: 'emby', subLibraryId: 'auto-lib', identityPayload: { serverId: 'server', embyItemId: command.sourceReference.sourceRefId }, observedStructure: { mediaKind: 'movie', playable: true, displayName: '测试电影' } } };
      sources.set(command.subjectId, projection);
      return projection;
    },
    diagnoseSource: ({ subjectId }) => sources.get(subjectId),
    ensureOffboarding: () => ({}),
    getSourceProjection: (subjectId) => sources.get(subjectId) || { subjectId, readiness: 'unresolved' },
    getSourceProjections: (subjectIds) => Object.fromEntries(subjectIds.map((subjectId) => [subjectId, sources.get(subjectId) || { subjectId, readiness: 'unresolved' }])),
  };
  const kairoxService = {
    reconcileMaintenance(command) {
      const projection = { subjectId: command.subjectId, admissionCurrent: true, admission: { ...command, status: 'active' }, maintenanceRevision: `maintenance-${command.admissionGeneration}` };
      admissions.set(command.subjectId, projection);
      return projection;
    },
    suspendMaintenance: () => ({}),
    requestMaintenance: () => ({}),
    updateUserPerception: () => ({}),
    getMaintenanceProjection: (subjectId) => admissions.get(subjectId) || { subjectId, admissionCurrent: false },
    getMaintenanceProjections: (subjectIds) => Object.fromEntries(subjectIds.map((subjectId) => [subjectId, admissions.get(subjectId) || { subjectId, admissionCurrent: false }])),
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
  assert.strictEqual(created.subLibrary.adultRegion, undefined);
  assert.strictEqual(created.subLibrary.scraperType, undefined);
  const first = await runtime.runLibraryWork(created.observationWork.workId, { limit: 1 });
  assert.strictEqual(first.status, 'pending');
  assert.strictEqual(first.cursor.startIndex, 1);
  const second = await runtime.runLibraryWork(created.observationWork.workId, { limit: 1 });
  assert.strictEqual(second.status, 'done');
  assert.deepStrictEqual(second.payload, created.observationWork.payload, 'idempotent request payload must remain immutable');
  const items = libraStore.getLibrarySubjects();
  assert.strictEqual(items.length, 2);
  assert.ok(items.every((item) => item.subjectKind === 'movie'));
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
  const duplicateOpen = runtime.requestLibraryObservation({ subLibraryId: 'manual-lib', idempotencyKey: 'manual-observe-2' });
  assert.strictEqual(duplicateOpen.workId, work.workId);
});

test('Libra work priority keeps observation ahead of reconcile and perception enrichment', () => {
  assert.ok(libraAutomationEngine._workPriorityForTests({ workKind: 'observe_library' })
    < libraAutomationEngine._workPriorityForTests({ workKind: 'reconcile_library' }));
  assert.ok(libraAutomationEngine._workPriorityForTests({ workKind: 'reconcile_library' })
    < libraAutomationEngine._workPriorityForTests({ workKind: 'sync_user_perception' }));
});

test('Douban user perception sync waits for observation and resumes from durable apply cursor', async () => {
  libraStore.resetForTests();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
  const fixtures = createFixtures();
  const updates = [];
  fixtures.kairoxService.updateUserPerception = (command) => {
    updates.push(command);
    return { factRevision: updates.length, facts: command.facts };
  };
  const doubanService = {
    getSession: () => ({ userId: 'tester', cookieHeader: 'cookie', interestsRssUrl: '' }),
    fetchRatingsPage: async (_session, cursor) => cursor.collectType === 'movie'
      ? { collectType: 'movie', start: 0, entries: [{ subjectId: '123', title: '测试电影', stars: 5, collectType: 'movie' }], typeDone: true, nextStart: 15 }
      : { collectType: 'tv', start: 0, entries: [], typeDone: true, nextStart: 15 },
  };
  const runtime = createLibraRuntime({ ...fixtures, store: libraStore, doubanService });
  const created = runtime.createSubLibrary({
    uuid: 'auto-lib', name: 'Auto', source: 'emby', embyServerId: 'server', sectionId: 'section',
    libraryAutomationMode: 'auto', maintenanceAutomationMode: 'auto', doubanEnabled: true,
  });
  const deferred = await runtime.runLibraryWork(created.userPerceptionSyncWork.workId, { limit: 1 });
  assert.strictEqual(deferred.status, 'retrying');
  await runtime.runLibraryWork(created.observationWork.workId, { limit: 1 });
  await runtime.runLibraryWork(created.observationWork.workId, { limit: 1 });
  const items = libraStore.getLibrarySubjects();
  fixtures.kairoxService.getMaintenanceProjections = (subjectIds) => Object.fromEntries(subjectIds.map((subjectId) => [subjectId, {
    subjectId,
    maintenanceSubject: { subjectKind: 'movie' },
    metadataFacts: { title: '测试电影' },
    userPerceptionFacts: {},
  }]));
  const fetchedMovie = await runtime.runLibraryWork(created.userPerceptionSyncWork.workId, { limit: 1 });
  assert.strictEqual(fetchedMovie.status, 'retrying');
  await new Promise((resolve) => setTimeout(resolve, 810));
  const fetched = await runtime.runLibraryWork(created.userPerceptionSyncWork.workId, { limit: 1 });
  assert.strictEqual(fetched.status, 'pending');
  assert.strictEqual(fetched.cursor.phase, 'apply');
  const appliedOne = await runtime.runLibraryWork(created.userPerceptionSyncWork.workId, { limit: 1 });
  assert.strictEqual(appliedOne.status, 'pending');
  await runtime.runLibraryWork(created.userPerceptionSyncWork.workId, { limit: 1 });
  const completed = await runtime.runLibraryWork(created.userPerceptionSyncWork.workId, { limit: 1 });
  assert.strictEqual(completed.status, 'done');
  assert.strictEqual(updates.length, 2);
  assert.deepStrictEqual(updates[0].facts, { doubanRating: 5, watched: true });
});
