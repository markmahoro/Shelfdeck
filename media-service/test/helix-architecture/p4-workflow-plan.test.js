'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { createRepositoryDefinition } = require('../../src/helix/foundation/persistence/owner-repository');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createWorkflowPlanPublisher, executionCatalogDigest,
  validateWorkflowPlan } = require('../../src/helix/foundation/execution/workflow-plan');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));

const manifests = Object.freeze({
  'libra.fixture.observe@1': Object.freeze({
    capabilityRef: 'libra.fixture.observe@1', contractVersion: 1, ownerScope: 'libra', effectClass: 'pure_observation',
    parametersSchemaRef: 'helix://fixture/observe/parameters', resultSchemaRef: 'helix://fixture/observe/result',
    evidenceSchemaRef: 'helix://fixture/observe/evidence', fenceSchemaRef: 'helix://fixture/observe/fence',
    resourceDemandSchemaRef: 'helix://fixture/observe/resource-demand', executorCompatibility: { minimumVersion: 1 }
  }),
  'libra.fixture.commit@1': Object.freeze({
    capabilityRef: 'libra.fixture.commit@1', contractVersion: 1, ownerScope: 'libra', effectClass: 'domain_fact_commit',
    parametersSchemaRef: 'helix://fixture/commit/parameters', resultSchemaRef: 'helix://fixture/commit/result',
    evidenceSchemaRef: 'helix://fixture/commit/evidence', fenceSchemaRef: 'helix://fixture/commit/fence',
    resourceDemandSchemaRef: 'helix://fixture/commit/resource-demand', approvalRequirementRef: 'helix://fixture/approval',
    executorCompatibility: { minimumVersion: 1 }
  })
});

const registry = Object.freeze({
  snapshot: Object.freeze(Object.values(manifests).map((manifest) => Object.freeze({
    capabilityRef: manifest.capabilityRef, contractVersion: 1, effectClass: manifest.effectClass
  }))),
  resolve(capabilityRef, ownerDomain) {
    const manifest = manifests[capabilityRef];
    if (!manifest) throw Object.assign(new Error('missing capability'), { code: 'P4_CAPABILITY_NOT_REGISTERED' });
    if (manifest.ownerScope !== ownerDomain) throw Object.assign(new Error('owner mismatch'), { code: 'P4_CAPABILITY_NOT_VISIBLE' });
    return { manifest };
  }
});
const policyBindings = Object.freeze({
  'libra.fixture.observe@1': Object.freeze({ retryPolicyRef: 'helix://foundation/retry-policies/pure_observation/v1',
    timeoutPolicyRef: 'helix://foundation/timeout-policies/fixture/v1', compensationContractRefs: [] }),
  'libra.fixture.commit@1': Object.freeze({ retryPolicyRef: 'helix://foundation/retry-policies/domain_fact_commit/v1',
    timeoutPolicyRef: 'helix://foundation/timeout-policies/fixture/v1',
    compensationContractRefs: ['helix://fixture/compensation/v1'] })
});
const policyRegistry = Object.freeze({
  digest: 'c'.repeat(64),
  bindingFor(capabilityRef) { return policyBindings[capabilityRef]; },
  compensation(contractRef) {
    if (contractRef !== 'helix://fixture/compensation/v1') throw Object.assign(new Error('unknown compensation'), { code: 'P4_COMPENSATION_CONTRACT_UNKNOWN' });
    return { ref: contractRef, targetEffectClasses: ['domain_fact_commit'],
      compensationCapabilityRefs: ['libra.fixture.observe@1'], requiredDecision: 'compensate' };
  }
});
const CATALOG_DIGEST = executionCatalogDigest(registry, policyRegistry);
const contractValidator = Object.freeze({ validate(ref, value) {
  if (ref.includes('/inputs') && (!value || typeof value.inputId !== 'string')) throw Object.assign(new Error('input rejected'), { code: 'TEST_SCHEMA_REJECTED' });
  return value;
} });

function node(kind, overrides = {}) {
  const manifest = kind === 'commit' ? manifests['libra.fixture.commit@1'] : manifests['libra.fixture.observe@1'];
  return {
    nodeId: 'node-' + kind, eventId: 'event-' + kind, capabilityRef: manifest.capabilityRef, contractVersion: 1,
    inputBindingsSchemaRef: manifest.parametersSchemaRef.replace('/parameters', '/inputs'), inputBindings: { inputId: kind },
    parametersSchemaRef: manifest.parametersSchemaRef, parameters: {}, dependsOn: [], whenSchemaRef: null, when: null,
    effectClass: manifest.effectClass, resourceDemandSchemaRef: manifest.resourceDemandSchemaRef, resourceDemand: {},
    approvalRequirementRef: manifest.approvalRequirementRef || null, authorizationRequirementRef: null,
    fenceSchemaRef: manifest.fenceSchemaRef, fenceBasis: {},
    retryPolicyRef: 'helix://foundation/retry-policies/' + manifest.effectClass + '/v1',
    timeoutPolicyRef: 'helix://foundation/timeout-policies/fixture/v1', outputContractRef: manifest.resultSchemaRef,
    ...overrides
  };
}

function plan(overrides = {}) {
  const observe = node('observe');
  const commit = node('commit', { dependsOn: [{ eventId: observe.eventId, satisfaction: 'success' }] });
  return {
    schemaRef: 'helix://foundation/types/WorkflowPlanDefinition/v1', schemaVersion: 1, planId: 'plan-1',
    workAttemptId: 'attempt-1', ownerDomain: 'libra', plannerContractRef: 'helix://libra/planners/Fixture/v1', plannerVersion: 1,
    workObjectiveTypeRef: 'helix://libra/work/Fixture/v1', workObjectiveVersion: 1, executionBasisDigest: 'a'.repeat(64),
    capabilityCatalogDigest: CATALOG_DIGEST, resolution: 'planned', diagnosticClassification: null, nodes: [observe, commit], ...overrides
  };
}

test('validator freezes a deterministic acyclic Plan with exact Capability contracts', () => {
  const first = validateWorkflowPlan(plan(), { registry, contractValidator, policyRegistry });
  const second = validateWorkflowPlan(plan({ nodes: plan().nodes.map((entry) => ({ ...entry })) }), { registry, contractValidator, policyRegistry });
  assert.equal(first.graphDigest, second.graphDigest);
  assert.match(first.graphDigest, /^[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(first.plan.nodes), true);
});

test('validator rejects cycle, missing/duplicate dependency, duplicate identity, and contract drift', () => {
  const base = plan();
  const cyclic = base.nodes.map((entry) => ({ ...entry, dependsOn: entry.nodeId === 'node-observe'
    ? [{ eventId: 'event-commit', satisfaction: 'success' }] : entry.dependsOn }));
  assert.throws(() => validateWorkflowPlan(plan({ nodes: cyclic }), { registry, contractValidator, policyRegistry }), (error) => error.code === 'P4_PLAN_DAG_CYCLE');
  assert.throws(() => validateWorkflowPlan(plan({ nodes: [node('observe', { dependsOn: [{ eventId: 'missing', satisfaction: 'success' }] })] }),
    { registry, contractValidator, policyRegistry }), (error) => error.code === 'P4_PLAN_DEPENDENCY_INVALID');
  assert.throws(() => validateWorkflowPlan(plan({ nodes: [node('observe'), node('commit', { eventId: 'event-observe' })] }),
    { registry, contractValidator, policyRegistry }), (error) => error.code === 'P4_PLAN_DUPLICATE_NODE_OR_EVENT');
  assert.throws(() => validateWorkflowPlan(plan({ nodes: [node('observe', { effectClass: 'workspace_write' })] }),
    { registry, contractValidator, policyRegistry }), (error) => error.code === 'P4_PLAN_CAPABILITY_CONTRACT_MISMATCH');
  assert.throws(() => validateWorkflowPlan(plan({ nodes: [node('observe', { inputBindings: {} })] }),
    { registry, contractValidator, policyRegistry }), (error) => error.code === 'TEST_SCHEMA_REJECTED');
  assert.throws(() => validateWorkflowPlan(plan({ capabilityCatalogDigest: 'b'.repeat(64) }),
    { registry, contractValidator, policyRegistry }), (error) => error.code === 'P4_PLAN_CATALOG_DIGEST_MISMATCH');
  assert.throws(() => validateWorkflowPlan(plan({ nodes: [node('observe'), node('commit', {
    dependsOn: [{ eventId: 'event-observe', satisfaction: 'terminal' }]
  })] }), { registry, contractValidator, policyRegistry }), (error) => error.code === 'P4_PLAN_TERMINAL_DEPENDENCY_UNDECLARED');
  assert.throws(() => validateWorkflowPlan(plan({ nodes: [node('observe'), node('commit', {
    compensationForEventId: 'event-observe', compensationContractRef: 'helix://fixture/compensation'
  })] }), { registry, contractValidator, policyRegistry }), (error) => error.code === 'P4_PLAN_COMPENSATION_DEPENDENCY_REQUIRED');
});

test('non-planned Resolutions contain zero nodes and planned contains a non-empty DAG', () => {
  for (const resolution of ['no_effect_required', 'temporarily_unplannable', 'contract_unplannable']) {
    const validated = validateWorkflowPlan(plan({ resolution, diagnosticClassification: 'fixture.' + resolution, nodes: [] }), { registry, contractValidator, policyRegistry });
    assert.equal(validated.plan.nodes.length, 0);
  }
  assert.throws(() => validateWorkflowPlan(plan({ nodes: [] }), { registry, contractValidator, policyRegistry }),
    (error) => error.code === 'P4_RUNTIME_PLAN_RESOLUTION_NODE_MISMATCH');
});

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-workflow-plan-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  let clock = 1700000001200;
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => clock++ });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const seed = createRepositoryDefinition({
    repositoryId: 'plan_seed', owner: 'execution-foundation', schemaManifest,
    statements: {
      work: { kind: 'insert', tableId: 'fx_supporting_works', columns: [
        'work_id', 'owner_domain', 'priority_class', 'state', 'idempotency_key', 'basis_digest'
      ] },
      attempt: { kind: 'insert', tableId: 'fx_work_attempts', columns: ['attempt_id', 'work_id', 'ordinal', 'basis_digest', 'state'] }
    }
  });
  unitOfWork.execute([{
    participantId: 'plan_seed', owner: 'execution-foundation', repositories: [seed], execute(context) {
      const repository = context.repository('plan_seed');
      repository.invoke('work', {
        work_id: 'work-1', owner_domain: 'libra', priority_class: 'normal_foreground', state: 'admitted',
        idempotency_key: 'work-key-1', basis_digest: 'a'.repeat(64)
      });
      repository.invoke('attempt', { attempt_id: 'attempt-1', work_id: 'work-1', ordinal: 1, basis_digest: 'a'.repeat(64), state: 'ready' });
    }
  }]);
  const publisher = createWorkflowPlanPublisher({ schemaManifest, unitOfWork, registry, contractValidator, policyRegistry });
  try { return run({ publisher, databasePath }); }
  finally { kernel.close(); fs.rmSync(root, { recursive: true, force: true }); }
}

function rows(databasePath, table) {
  const database = new Database(databasePath, { readonly: true });
  try { return database.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all(); }
  finally { database.close(); }
}

test('publisher atomically normalizes Plan, Nodes, Edges and initial Events with stable replay', () => {
  fixture(({ publisher, databasePath }) => {
    const first = publisher.publish(plan());
    assert.equal(first.replayed, false);
    assert.equal(publisher.publish(plan()).replayed, true);
    assert.equal(rows(databasePath, 'fx_workflow_plans').length, 1);
    const persistedPlan = rows(databasePath, 'fx_workflow_plans')[0];
    assert.equal(persistedPlan.work_objective_type_ref, 'helix://libra/work/Fixture/v1');
    assert.equal(persistedPlan.work_objective_version, 1);
    assert.equal(persistedPlan.diagnostic_classification, null);
    const persistedNodes = rows(databasePath, 'fx_plan_nodes');
    assert.equal(persistedNodes.length, 2);
    assert.equal(persistedNodes[1].approval_requirement_ref, 'helix://fixture/approval');
    assert.equal(persistedNodes[1].retry_policy_ref, 'helix://foundation/retry-policies/domain_fact_commit/v1');
    assert.equal(persistedNodes[1].timeout_policy_ref, 'helix://foundation/timeout-policies/fixture/v1');
    assert.equal(persistedNodes[1].output_contract_ref, 'helix://fixture/commit/result');
    assert.equal(rows(databasePath, 'fx_plan_edges').length, 1);
    const events = rows(databasePath, 'fx_workflow_events');
    assert.deepEqual(events.map((entry) => [entry.event_id, entry.state]), [['event-observe', 'ready'], ['event-commit', 'pending']]);
    assert.equal(events[0].ready_at_ms !== null, true);
    assert.equal(events[1].ready_at_ms, null);
  });
});

test('publisher persists an explicit same-Plan compensation target and contract', () => {
  fixture(({ publisher, databasePath }) => {
    const base = plan();
    const compensation = node('observe', {
      nodeId: 'node-compensation', eventId: 'event-compensation',
      dependsOn: [{ eventId: 'event-commit', satisfaction: 'terminal' }],
      compensationForEventId: 'event-commit', compensationContractRef: 'helix://fixture/compensation/v1'
    });
    publisher.publish(plan({ nodes: [...base.nodes, compensation] }));
    const persisted = rows(databasePath, 'fx_plan_nodes').find((entry) => entry.node_id === 'node-compensation');
    assert.equal(persisted.compensation_for_event_id, 'event-commit');
    assert.equal(persisted.compensation_contract_ref, 'helix://fixture/compensation/v1');
    assert.equal(rows(databasePath, 'fx_plan_edges').find((entry) => entry.to_node_id === 'node-compensation').dependency_kind, 'terminal');
  });
});

test('different Plan for one Attempt conflicts and a failed publish leaves zero normalized facts', () => {
  fixture(({ publisher, databasePath }) => {
    publisher.publish(plan());
    assert.throws(() => publisher.publish(plan({ planId: 'plan-2' })), (error) => error.code === 'P4_PLAN_ATTEMPT_ALREADY_PLANNED');
    assert.equal(rows(databasePath, 'fx_workflow_plans').length, 1);
  });
  fixture(({ publisher, databasePath }) => {
    assert.throws(() => publisher.publish(plan({ executionBasisDigest: 'c'.repeat(64) })),
      (error) => error.code === 'P4_PLAN_ATTEMPT_FENCE_REJECTED');
    for (const table of ['fx_workflow_plans', 'fx_plan_nodes', 'fx_plan_edges', 'fx_workflow_events']) {
      assert.equal(rows(databasePath, table).length, 0, table);
    }
  });
});

test('Plan publication writes no Domain facts and source exposes no Planner execution or generic JSON graph store', () => {
  fixture(({ publisher, databasePath }) => {
    publisher.publish(plan());
    for (const table of ['libra_runs', 'libra_subjects', 'arca_shelf_entries', 'proc_procurement_runs']) {
      assert.equal(rows(databasePath, table).length, 0, table);
    }
  });
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/helix/foundation/execution/workflow-plan.js'), 'utf8');
  for (const parts of [['planner', '.execute'], ['graph_', 'json'], ['flow', 'Kind'], ['action', 'Type']]) {
    assert.equal(source.includes(parts.join('')), false, parts.join(''));
  }
});
