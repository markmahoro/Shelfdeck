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

function definition(capability, inputContract, outputContract) {
  return { capability, contractVersion: 1, inputContract, outputContract, execute: async () => ({}) };
}

test('Planner rejects a nominally incompatible Capability connection', () => {
  registry.resetForTests();
  registry.register(definition('producer', {}, { type: 'StagedMediaAsset', version: 1 }));
  registry.register(definition('consumer', { metadata: { type: 'MetadataObservation', version: 1 } }, { type: 'FactPublication', version: 1 }));
  const plan = graph.buildPlan({ taskId: 'typed-task', itemId: 'typed-item', targetGate: 'metadata' }, [
    { eventId: 'producer-event', capability: 'producer' },
    { eventId: 'consumer-event', capability: 'consumer', dependsOn: ['producer-event'], inputBindings: { metadata: { source: 'event', eventId: 'producer-event' } } },
  ]);
  assert.throws(() => graph.validateGraph(plan, registry), { code: 'KAIROX_CAPABILITY_CONTRACT_MISMATCH' });
});

test('every registered built-in has one canonical versioned contract', () => {
  registry.resetForTests();
  builtIns.registerBuiltIns();
  for (const capability of registry.inventory()) {
    assert.strictEqual(capability.contractVersion, 1, capability.capability);
    assert.ok(capability.outputContract.type, capability.capability);
    assert.ok(catalog.get(capability.capability), capability.capability);
  }
});

test('Planner advertised inventory cannot drift from the canonical Catalog', () => {
  const advertised = new Set(Object.values(planner.REQUIRED).flatMap((values) => [...values]));
  const missing = [...advertised].filter((capability) => !catalog.get(capability));
  assert.deepStrictEqual(missing, ['subtitle.search', 'subtitle.download', 'subtitle.verify', 'container.remux']);
});

test('Capability executors cannot inspect the Workflow Event list or dispatch another capability', () => {
  const roots = [path.join(__dirname, '..', 'src', 'builtInCapabilities.js'), path.join(__dirname, '..', 'src', 'capabilities')];
  const files = roots.flatMap((entry) => fs.statSync(entry).isDirectory() ? fs.readdirSync(entry).filter((name) => name.endsWith('.js')).map((name) => path.join(entry, name)) : [entry]);
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /context\.events|\bevents\.find\(|\.execute\s*\(/, file);
  }
});
