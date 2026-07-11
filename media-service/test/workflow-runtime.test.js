'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const workflowGraph = require('../src/workflowGraph');
const workflowStore = require('../src/workflowStore');
const capabilityRegistry = require('../src/capabilityRegistry');
const workflowPlanner = require('../src/workflowPlanner');
const capabilityCatalog = require('../src/capabilityCatalog');

function registerPlannerInventory() {
  capabilityRegistry.resetForTests();
  for (const capability of [...workflowPlanner.REQUIRED.optimize, 'workflow.blocked']) {
    const catalog = capabilityCatalog.get(capability);
    if (catalog) capabilityRegistry.register(capabilityCatalog.apply({ capability, execute: async () => ({}) }));
  }
}
function registerMetadataInventory() {
  capabilityRegistry.resetForTests();
  for (const capability of [...workflowPlanner.REQUIRED.metadata, 'workflow.blocked']) {
    if (capabilityCatalog.get(capability)) capabilityRegistry.register(capabilityCatalog.apply({ capability, execute: async () => ({}) }));
  }
}

function testCapability(capability) {
  return { capability, contractVersion: 1, inputContract: {}, outputContract: { type: 'object', version: 1 }, execute: async () => ({}) };
}

test('Optimize planning composes capabilities from objective gaps without a flow-kind route', () => {
  registerPlannerInventory();
  const task = {
    id: 'objective-task', itemId: 'objective-item', targetGate: 'optimize', objectiveRevisionSnapshot: 'objective-1',
    taskTarget: { targetGate: 'optimize', gateObjective: { targetMediaFacts: { minResolution: '1080p', targetCodec: 'h265' } } },
    itemInfo: { subLibraryId: 'library-1', resolution: '720p', codec: 'h264', bitrate: 20 },
  };
  const plan = workflowPlanner.planTask(task, { subLibraries: [{ uuid: 'library-1', allowedCapabilities: { optimize: ['source.upgrade.request', 'media.transcode', 'media.replace'] } }] });
  const capabilities = plan.nodes.map((node) => node.capability);
  assert.deepStrictEqual(capabilities.slice(0, 8), ['source.upgrade.search', 'source.upgrade.request', 'source.upgrade.observe-download', 'source.upgrade.observe-transfer', 'source.upgrade.output.resolve', 'media.identity.inspect', 'media.identity.accept', 'output.media.verify']);
  assert.strictEqual(plan.classification, 'composite_maintenance');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(plan, 'flowKind'), false);
});

test('source organization ends the current graph before materialization and publication', () => {
  registerPlannerInventory();
  const plan = workflowPlanner.planTask({
    id: 'organize-task', itemId: 'organize-item', targetGate: 'optimize',
    taskTarget: { targetGate: 'optimize', gateObjective: { targetMediaFacts: { storageLayout: 'organized', metadataArtifacts: 'materialized' } } },
    itemInfo: { subLibraryId: 'adult', layoutFacts: { compliant: false }, metadataArtifactsReady: true, metadataArtifactsMaterialized: false },
  }, { subLibraries: [{ uuid: 'adult', allowedCapabilities: { optimize: ['source.organize', 'metadata.artifacts.materialize'] } }] });
  assert.deepStrictEqual(plan.nodes.map((node) => node.capability), ['source.organize']);
  assert.strictEqual(plan.classification, 'source_mutation');
});

test('western adult metadata uses atomic local and worker graphs instead of a complex provider executor', () => {
  registerMetadataInventory();
  const base = { id: 'western-task', itemId: 'western-item', targetGate: 'metadata', taskTarget: { targetGate: 'metadata', gateObjective: {} }, itemInfo: { subLibraryId: 'western' }, helixAdmission: { sourceAccessDescriptor: { sourceType: 'folder', subLibraryId: 'western' } } };
  const local = workflowPlanner.planTask(base, { subLibraries: [{ uuid: 'western', adultRegion: 'western_adult', western: { computeMode: 'local' }, allowedCapabilities: { metadata: [], optimize: [] } }] });
  assert.deepStrictEqual(local.nodes.slice(1, 7).map((node) => node.capability), ['media.frames.extract', 'person.faces.embed', 'person.faces.cluster', 'person.faces.match', 'metadata.poster.compose', 'adult.metadata.compose']);
  assert.ok(!local.nodes.some((node) => node.capability === 'metadata.provider.fetch'));
  assert.strictEqual(workflowGraph.validateGraph(local, capabilityRegistry), local);
  const worker = workflowPlanner.planTask({ ...base, id: 'western-worker-task' }, { subLibraries: [{ uuid: 'western', adultRegion: 'western_adult', western: { computeMode: 'worker' }, allowedCapabilities: { metadata: [], optimize: [] } }] });
  assert.deepStrictEqual(worker.nodes.slice(1, 6).map((node) => node.capability), ['compute.asset.register', 'compute.asset.upload', 'adult.analysis.request', 'adult.analysis.observe', 'adult.metadata.normalize']);
  assert.strictEqual(workflowGraph.validateGraph(worker, capabilityRegistry), worker);
});

test('workflow graph validates branches and rejects cycles and arbitrary condition paths', () => {
  capabilityRegistry.resetForTests();
  for (const capability of ['a', 'b', 'c']) capabilityRegistry.register(testCapability(capability));
  const plan = workflowGraph.buildPlan({ taskId: 't1', itemId: 'i1', targetGate: 'optimize' }, [
    { eventId: 'a', capability: 'a' },
    { eventId: 'b', capability: 'b', dependsOn: ['a'], when: { op: 'eq', path: 'events.a.result.ok', value: true } },
    { eventId: 'c', capability: 'c', dependsOn: ['a', 'b'] },
  ]);
  assert.strictEqual(workflowGraph.validateGraph(plan, capabilityRegistry), plan);
  assert.strictEqual(workflowGraph.evaluateCondition({ op: 'and', conditions: [{ op: 'exists', path: 'facts.codec' }, { op: 'eq', path: 'facts.codec', value: 'h265' }] }, { facts: { codec: 'h265' } }), true);
  assert.throws(() => workflowGraph.evaluateCondition({ op: 'eq', path: 'process.env.SECRET', value: 'x' }, {}), { code: 'KAIROX_CONDITION_PATH_INVALID' });
  const cyclic = { ...plan, nodes: plan.nodes.map((node) => node.eventId === 'a' ? { ...node, dependsOn: ['c'] } : node) };
  assert.throws(() => workflowGraph.validateGraph(cyclic, capabilityRegistry), { code: 'KAIROX_WORKFLOW_CYCLE' });
});

test('workflow store persists immutable plan and first-class event transitions without duplicate audit', () => {
  const old = process.env.MEDIA_SERVICE_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-workflow-'));
  process.env.MEDIA_SERVICE_DATA_DIR = dir;
  workflowStore.resetForTests();
  try {
    capabilityRegistry.resetForTests();
    capabilityRegistry.register(testCapability('a'));
    const plan = workflowGraph.buildPlan({ taskId: 'task-store', itemId: 'item-store', targetGate: 'basedata' }, [{ eventId: 'observe', capability: 'a' }]);
    workflowStore.createPlan(plan, capabilityRegistry);
    assert.deepStrictEqual(workflowStore.getPlanForTask('task-store'), plan);
    assert.strictEqual(workflowStore.listEvents('task-store')[0].status, 'pending');
    workflowStore.transition('observe', 'ready', { readyAt: new Date().toISOString() });
    workflowStore.transition('observe', 'ready', {});
    workflowStore.transition('observe', 'succeeded', { result: { ok: true }, finishedAt: new Date().toISOString() });
    const event = workflowStore.getEvent('observe');
    assert.strictEqual(event.status, 'succeeded');
    assert.deepStrictEqual(event.result, { ok: true });
  } finally {
    workflowStore.resetForTests();
    if (old === undefined) delete process.env.MEDIA_SERVICE_DATA_DIR; else process.env.MEDIA_SERVICE_DATA_DIR = old;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
