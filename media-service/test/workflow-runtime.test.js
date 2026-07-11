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
    id: 'objective-task', subjectId: 'objective-item', targetGate: 'optimize', objectiveRevisionSnapshot: 'objective-1',
    taskTarget: { targetGate: 'optimize', gateObjective: { targetMediaFacts: { minResolution: '1080p', targetCodec: 'h265' } } },
    subjectInfo: { subLibraryId: 'library-1', resolution: '720p', codec: 'h264', bitrate: 20 },
  };
  const plan = workflowPlanner.planTask(task, { transcodeEncodingDevices: [{ stableKey: 'cpu:libx265', inPool: true, priority: 1 }], subLibraries: [{ uuid: 'library-1', allowedCapabilities: { optimize: ['source.upgrade.request', 'media.transcode', 'media.file.replace'] } }] });
  const capabilities = plan.nodes.map((node) => node.capability);
  assert.deepStrictEqual(capabilities.slice(0, 8), ['integration.moviepilot.check', 'media.upgrade.identity.resolve', 'source.upgrade.search', 'source.upgrade.request', 'source.upgrade.observe-download', 'source.upgrade.observe-transfer', 'source.upgrade.output.resolve', 'source.upgrade.output.settle']);
  assert.strictEqual(plan.classification, 'composite_maintenance');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(plan, 'flowKind'), false);
});

test('source organization ends the current graph before materialization and publication', () => {
  registerPlannerInventory();
  const plan = workflowPlanner.planTask({
    id: 'organize-task', subjectId: 'organize-item', targetGate: 'optimize',
    taskTarget: { targetGate: 'optimize', gateObjective: { targetMediaFacts: { storageLayout: 'organized', metadataArtifacts: 'materialized' } } },
    subjectInfo: { subLibraryId: 'adult', layoutFacts: { compliant: false }, metadataArtifactsReady: true, metadataArtifactsMaterialized: false },
  }, { subLibraries: [{ uuid: 'adult', allowedCapabilities: { optimize: ['source.organize', 'metadata.artifacts.materialize'] } }] });
  assert.deepStrictEqual(plan.nodes.map((node) => node.capability), ['source.organize']);
  assert.strictEqual(plan.classification, 'source_mutation');
});

test('Transcode FlowPlan predeclares typed rate-control attempts and verify-driven fallthrough', () => {
  registerPlannerInventory();
  const plan = workflowPlanner.planTask({
    id: 'rate-task', subjectId: 'rate-item', targetGate: 'optimize',
    taskTarget: { targetGate: 'optimize', gateObjective: { targetMediaFacts: { targetCodec: 'h265', targetBitrateProfileByBucket: { '1080p': { minMbps: 2, targetMbps: 3, maxMbps: 4 } } } } },
    subjectInfo: { subLibraryId: 'rate-library', codec: 'h264', bitrate: 10, resolution: '1920x1080' },
  }, {
    transcodeCpuParticipationStrategy: 'backup_only',
    transcodeEncodingDevices: [{ stableKey: 'qsv:0', inPool: true, priority: 1 }, { stableKey: 'cpu:libx265', inPool: true, priority: 2 }],
    subLibraries: [{ uuid: 'rate-library', allowedCapabilities: { optimize: ['media.transcode', 'media.file.replace'] } }],
  });
  const attempts = plan.nodes.filter((node) => node.capability === 'media.transcode');
  assert.deepStrictEqual(attempts.map((node) => node.parameters.strategy), ['qsv_vbr', 'qsv_cbr', 'cpu_two_pass_abr', 'cpu_strict_fallback']);
  assert.strictEqual(attempts[0].runWhen, null);
  assert.deepStrictEqual(attempts[1].runWhen, { port: 'previousAttempt', path: 'objectiveSatisfied', equals: false });
  assert.strictEqual(plan.nodes.filter((node) => node.capability === 'output.media.verify').length, 4);
  assert.strictEqual(workflowGraph.validateGraph(plan, capabilityRegistry), plan);
});

test('disc-like Transcode composes the shared container.remux before typed precheck', () => {
  registerPlannerInventory();
  const plan = workflowPlanner.planTask({ id: 'disc-task', subjectId: 'disc-item', targetGate: 'optimize', taskTarget: { targetGate: 'optimize', gateObjective: { targetMediaFacts: { targetCodec: 'h265' } } }, subjectInfo: { subLibraryId: 'disc-library', isDiscLike: true, codec: 'mpeg2video', bitrate: 20 } }, {
    transcodeEncodingDevices: [{ stableKey: 'cpu:libx265', inPool: true }],
    subLibraries: [{ uuid: 'disc-library', allowedCapabilities: { optimize: ['container.remux', 'media.transcode', 'media.file.replace'] } }],
  });
  assert.deepStrictEqual(plan.nodes.slice(0, 3).map((node) => node.capability), ['container.remux', 'media.transcode.precheck', 'transcode.tonemap.accept']);
  assert.deepStrictEqual(plan.nodes[1].inputBindings.sourceAsset, { source: 'event', eventId: 'disc-task:disc-remux' });
  assert.strictEqual(workflowGraph.validateGraph(plan, capabilityRegistry), plan);
});

test('an unimplemented subtitle objective is explicitly blocked instead of advertising schema-only capabilities', () => {
  registerPlannerInventory();
  const plan = workflowPlanner.planTask({ id: 'subtitle-task', subjectId: 'subtitle-item', targetGate: 'optimize', taskTarget: { targetGate: 'optimize', gateObjective: { targetMediaFacts: { requireChineseSubtitles: true } } }, subjectInfo: { subLibraryId: 'subtitle-library' } }, { subLibraries: [{ uuid: 'subtitle-library', allowedCapabilities: { optimize: [] } }] });
  assert.deepStrictEqual(plan.nodes.map((node) => node.capability), ['workflow.blocked']);
  assert.deepStrictEqual(plan.explanation.rejected, [{ capability: 'subtitle.download', reason: 'objective_capability_not_implemented' }]);
});

test('western adult metadata uses atomic local and worker graphs instead of a complex provider executor', () => {
  registerMetadataInventory();
  const base = { id: 'western-task', subjectId: 'western-item', targetGate: 'metadata', taskTarget: { targetGate: 'metadata', gateObjective: {} }, subjectInfo: { subLibraryId: 'western' }, helixAdmission: { sourceAccessDescriptor: { sourceType: 'folder', subLibraryId: 'western' } } };
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
  const plan = workflowGraph.buildPlan({ taskId: 't1', subjectId: 'i1', targetGate: 'optimize' }, [
    { eventId: 'a', capability: 'a' },
    { eventId: 'b', capability: 'b', dependsOn: ['a'], when: { op: 'eq', path: 'events.a.result.ok', value: true } },
    { eventId: 'c', capability: 'c', dependsOn: ['a', 'b'] },
  ], capabilityRegistry);
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
    const plan = workflowGraph.buildPlan({ taskId: 'task-store', subjectId: 'item-store', targetGate: 'basedata' }, [{ eventId: 'observe', capability: 'a' }], capabilityRegistry);
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

test('event performance keeps parameterized encode strategies diagnostically separate', () => {
  const old = process.env.MEDIA_SERVICE_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-workflow-performance-'));
  process.env.MEDIA_SERVICE_DATA_DIR = dir;
  workflowStore.resetForTests();
  try {
    capabilityRegistry.resetForTests();
    capabilityRegistry.register({
      ...testCapability('encode'),
      parameterContract: { strategy: { type: 'enum', values: ['qsv_vbr', 'cpu_two_pass_abr'] } },
    });
    const plan = workflowGraph.buildPlan({ taskId: 'performance-task', subjectId: 'performance-item', targetGate: 'optimize' }, [
      { eventId: 'qsv', capability: 'encode', parameters: { strategy: 'qsv_vbr' } },
      { eventId: 'cpu', capability: 'encode', parameters: { strategy: 'cpu_two_pass_abr' } },
    ], capabilityRegistry);
    workflowStore.createPlan(plan, capabilityRegistry);
    const startedAt = new Date(Date.now() - 25).toISOString();
    const finishedAt = new Date().toISOString();
    for (const eventId of ['qsv', 'cpu']) workflowStore.transition(eventId, 'succeeded', { resourceKey: 'local:ffmpeg', startedAt, finishedAt, result: {} });
    const groups = workflowStore.performanceSnapshot().filter((entry) => entry.capability === 'encode');
    assert.strictEqual(groups.length, 2);
    assert.deepStrictEqual(new Set(groups.map((entry) => entry.parameters.strategy)), new Set(['qsv_vbr', 'cpu_two_pass_abr']));
  } finally {
    workflowStore.resetForTests();
    if (old === undefined) delete process.env.MEDIA_SERVICE_DATA_DIR; else process.env.MEDIA_SERVICE_DATA_DIR = old;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
