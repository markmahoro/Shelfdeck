'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const workflowGraph = require('../src/workflowGraph');
const workflowStore = require('../src/workflowStore');
const capabilityRegistry = require('../src/capabilityRegistry');

test('workflow graph validates branches and rejects cycles and arbitrary condition paths', () => {
  capabilityRegistry.resetForTests();
  for (const capability of ['a', 'b', 'c']) capabilityRegistry.register({ capability, execute: async () => ({}) });
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
