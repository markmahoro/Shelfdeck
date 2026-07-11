'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const registry = require('../src/capabilityRegistry');
const graph = require('../src/workflowGraph');
const catalog = require('../src/capabilityCatalog');
const planner = require('../src/workflowPlanner');
const builtIns = require('../src/builtInCapabilities');
const contracts = require('../src/capabilityContract');

function definition(capability, inputContract, outputContract) {
  return { capability, contractVersion: 1, inputContract, outputContract, execute: async () => ({}) };
}

test('Planner rejects a nominally incompatible Capability connection', () => {
  registry.resetForTests();
  registry.register(definition('producer', {}, { type: 'StagedMediaAsset', version: 1 }));
  registry.register(definition('consumer', { metadata: { type: 'MetadataObservation', version: 1 } }, { type: 'FactPublication', version: 1 }));
  const plan = graph.buildPlan({ taskId: 'typed-task', subjectId: 'typed-item', targetGate: 'metadata' }, [
    { eventId: 'producer-event', capability: 'producer' },
    { eventId: 'consumer-event', capability: 'consumer', dependsOn: ['producer-event'], inputBindings: { metadata: { source: 'event', eventId: 'producer-event' } } },
  ], registry);
  assert.throws(() => graph.validateGraph(plan, registry), { code: 'KAIROX_CAPABILITY_CONTRACT_MISMATCH' });
});

test('persisted Graph rejects Capability contract version or signature drift', () => {
  registry.resetForTests();
  registry.register(definition('versioned', {}, { type: 'object', version: 1 }));
  const plan = graph.buildPlan({ taskId: 'versioned-task', subjectId: 'item', targetGate: 'metadata' }, [{ eventId: 'event', capability: 'versioned' }], registry);
  assert.throws(() => graph.validateGraph({ ...plan, nodes: [{ ...plan.nodes[0], capabilityContractVersion: 2 }] }, registry), { code: 'KAIROX_CAPABILITY_CONTRACT_VERSION_DRIFT' });
  assert.throws(() => graph.validateGraph({ ...plan, nodes: [{ ...plan.nodes[0], outputContractSnapshot: { type: 'array', version: 1 } }] }, registry), { code: 'KAIROX_CAPABILITY_CONTRACT_SIGNATURE_DRIFT' });
});

test('every registered built-in has one canonical versioned contract', () => {
  registry.resetForTests();
  builtIns.registerBuiltIns();
  for (const capability of registry.inventory()) {
    assert.strictEqual(capability.contractVersion, 1, capability.capability);
    assert.ok(capability.outputContract.type, capability.capability);
    assert.ok(catalog.get(capability.capability), capability.capability);
    if (!['string', 'number', 'boolean', 'object', 'array'].includes(capability.outputContract.type)) assert.ok(contracts.TYPE_SCHEMAS[capability.outputContract.type], capability.outputContract.type);
  }
});

test('Runtime rejects a nominal output whose required structural fields are missing', () => {
  assert.throws(() => contracts.assertOutput({ type: 'StagedMediaAsset', version: 1 }, { assetId: 'a' }, 'test.staged'), { code: 'KAIROX_CAPABILITY_STRUCTURAL_TYPE_VIOLATION' });
  assert.doesNotThrow(() => contracts.assertOutput({ type: 'StagedMediaAsset', version: 1 }, { assetId: 'a', sourcePath: 'x', workDir: 'w', replacementScope: 'file', producingEventId: 'e' }, 'test.staged'));
});

test('Planner advertised inventory cannot drift from the canonical Catalog', () => {
  const advertised = new Set(Object.values(planner.REQUIRED).flatMap((values) => [...values]));
  const missing = [...advertised].filter((capability) => !catalog.get(capability));
  assert.deepStrictEqual(missing, []);
});

test('Capability executors cannot inspect the Workflow Event list or dispatch another capability', () => {
  const roots = [path.join(__dirname, '..', 'src', 'builtInCapabilities.js'), path.join(__dirname, '..', 'src', 'capabilities')];
  const files = roots.flatMap((entry) => fs.statSync(entry).isDirectory() ? fs.readdirSync(entry).filter((name) => name.endsWith('.js')).map((name) => path.join(entry, name)) : [entry]);
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /context\.events|\bevents\.find\(|\.execute\s*\(/, file);
  }
});

test('western adult provider adapter cannot hide the legacy multi-stage analyzeVideo flow', () => {
  const adapter = fs.readFileSync(path.join(__dirname, '..', 'src', 'metadataProviderAdapter.js'), 'utf8');
  assert.doesNotMatch(adapter, /analyzeVideo\s*\(/);
  assert.match(adapter, /WESTERN_ATOMIC_WORKFLOW_REQUIRED/);
});

test('external progress Capabilities perform one observation and contain no internal polling loop', () => {
  for (const name of ['upgradeCapabilities.js', 'westernAdultCapabilities.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'capabilities', name), 'utf8');
    assert.doesNotMatch(source, /for\s*\(\s*;;\s*\)|while\s*\(\s*Date\.now|await\s+sleep\s*\(|setInterval\s*\(/, name);
  }
});

test('atomic Capability executors cannot write Task/Event state or emit cross-domain signals', () => {
  const files = fs.readdirSync(path.join(__dirname, '..', 'src', 'capabilities')).filter((name) => name.endsWith('.js'));
  for (const name of files) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'capabilities', name), 'utf8');
    assert.doesNotMatch(source, /require\(['"]\.\.\/taskStore|require\(['"]\.\.\/workflowStore|kairoxSignalBus|markBasedataStale/, name);
  }
});

test('shared effects have one canonical Capability identity', () => {
  const names = catalog.list().map((entry) => entry.capability);
  assert.strictEqual(names.filter((name) => name === 'media.file.replace').length, 1);
  assert.strictEqual(names.filter((name) => name === 'series.season.replace').length, 1);
  assert.strictEqual(names.filter((name) => name === 'output.media.verify').length, 1);
  assert.strictEqual(names.filter((name) => name === 'output.preview.generate').length, 1);
  assert.strictEqual(names.filter((name) => name === 'metadata.image.acquire').length, 1);
  assert.ok(!names.some((name) => /^(transcode|upgrade)\.(replace|verify|preview)$/.test(name)));
});

test('every admission-fenced commit Capability checks the Runtime fence immediately before its effect', () => {
  const files = fs.readdirSync(path.join(__dirname, '..', 'src', 'capabilities')).filter((name) => name.endsWith('.js'));
  const source = files.map((name) => fs.readFileSync(path.join(__dirname, '..', 'src', 'capabilities', name), 'utf8')).join('\n');
  const fenced = catalog.list().filter((entry) => entry.effectKind === 'commit_once' && entry.fencingContract.admission).map((entry) => entry.capability);
  assert.deepStrictEqual(catalog.list().filter((entry) => entry.effectKind === 'commit_once' && !entry.fencingContract.admission).map((entry) => entry.capability).sort(), ['staged.asset.discard', 'workspace.cleanup']);
  for (const capability of fenced) {
    const marker = `capability: '${capability}'`;
    const capabilityAt = source.indexOf(marker);
    assert.notStrictEqual(capabilityAt, -1, capability);
    const blockStart = source.lastIndexOf('register(', capabilityAt);
    const blockEnd = source.indexOf('\n  register(', capabilityAt + marker.length);
    const block = source.slice(blockStart, blockEnd === -1 ? source.length : blockEnd);
    assert.match(block, /assertFence\s*\(/, `${capability} must invoke the Runtime fence`);
  }
});

test('long-running local and Worker effects expose the common cancellation contract', () => {
  registry.resetForTests();
  builtIns.registerBuiltIns();
  for (const capability of ['media.frames.extract', 'person.faces.embed', 'compute.asset.upload', 'container.remux', 'media.transcode', 'source.upgrade.request', 'source.upgrade.observe-download']) {
    assert.strictEqual(registry.inventory().find((entry) => entry.capability === capability).cancellable, true, capability);
  }
});
