'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { createEventRuntime } = require('../../src/helix/foundation/execution/event-runtime');
const { createRepositoryDefinition } = require('../../src/helix/foundation/persistence/owner-repository');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));
const HASH_A = 'a'.repeat(64); const HASH_B = 'b'.repeat(64);

function fixture(run, settings = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-event-runtime-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 1700000001700 });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const seed = createRepositoryDefinition({ repositoryId: 'event_runtime_seed', owner: 'execution-foundation', schemaManifest, statements: {
    work: { kind: 'insert', tableId: 'fx_supporting_works', columns: [
      'work_id', 'owner_domain', 'process_type', 'process_id', 'basis_digest', 'priority_class', 'state', 'idempotency_key'
    ] },
    work_attempt: { kind: 'insert', tableId: 'fx_work_attempts', columns: ['attempt_id', 'work_id', 'basis_digest', 'state'] },
    plan: { kind: 'insert', tableId: 'fx_workflow_plans', columns: [
      'plan_id', 'attempt_id', 'work_objective_type_ref', 'work_objective_version', 'basis_digest', 'state', 'diagnostic_classification'
    ] },
    node: { kind: 'insert', tableId: 'fx_plan_nodes', columns: [
      'plan_id', 'node_id', 'capability_ref', 'contract_version', 'input_binding_schema_ref', 'input_bindings_json',
      'parameter_schema_ref', 'parameters_json', 'when_schema_ref', 'when_json', 'effect_class', 'fence_schema_ref', 'fence_basis_json',
      'resource_demand_schema_ref', 'resource_demand_json', 'approval_requirement_ref', 'authorization_requirement_ref',
      'retry_policy_ref', 'timeout_policy_ref', 'output_contract_ref', 'compensation_for_event_id', 'compensation_contract_ref'
    ] },
    event: { kind: 'insert', tableId: 'fx_workflow_events', columns: [
      'event_id', 'plan_id', 'node_id', 'work_id', 'attempt_id', 'owner_domain', 'capability_ref', 'contract_version',
      'priority_class', 'state', 'ready_at_ms', 'retry_at_ms', 'result_id'
    ] },
    edge: { kind: 'insert', tableId: 'fx_plan_edges', columns: ['plan_id', 'from_node_id', 'to_node_id', 'dependency_kind'] }
  } });
  unitOfWork.execute([{ participantId: 'event_runtime_seed', owner: 'execution-foundation', repositories: [seed], execute(context) {
    const repository = context.repository('event_runtime_seed');
    repository.invoke('work', { work_id: 'work', owner_domain: 'libra', process_type: 'libra_run', process_id: 'run', basis_digest: HASH_A,
      priority_class: 'normal_foreground', state: 'running', idempotency_key: 'work' });
    repository.invoke('work_attempt', { attempt_id: 'work-attempt', work_id: 'work', basis_digest: HASH_A, state: 'running' });
    repository.invoke('plan', { plan_id: 'plan', attempt_id: 'work-attempt', work_objective_type_ref: 'helix://libra/work/Test/v1',
      work_objective_version: 1, basis_digest: HASH_A, state: 'planned', diagnostic_classification: null });
    repository.invoke('node', { plan_id: 'plan', node_id: 'node', capability_ref: 'libra.test.observe@1', contract_version: 1,
      input_binding_schema_ref: 'helix://test/inputs', input_bindings_json: '{}', parameter_schema_ref: 'helix://test/parameters',
      parameters_json: '{}', when_schema_ref: null, when_json: null, effect_class: 'pure_observation',
      fence_schema_ref: 'helix://test/fence', fence_basis_json: '{}',
      resource_demand_schema_ref: 'helix://test/resources', resource_demand_json: '{}',
      approval_requirement_ref: settings.approvalRequirementRef || null, authorization_requirement_ref: null,
      retry_policy_ref: 'helix://foundation/retry-policies/pure_observation/v1',
      timeout_policy_ref: 'helix://foundation/timeout-policies/test/v1', output_contract_ref: 'helix://test/result',
      compensation_for_event_id: null, compensation_contract_ref: null });
    repository.invoke('event', { event_id: 'event', plan_id: 'plan', node_id: 'node', work_id: 'work', attempt_id: 'work-attempt',
      owner_domain: 'libra', capability_ref: 'libra.test.observe@1', contract_version: 1, priority_class: 'normal_foreground',
      state: 'ready', ready_at_ms: 1, retry_at_ms: null, result_id: null });
    if (settings.addDependent) {
      repository.invoke('node', { plan_id: 'plan', node_id: 'node-dependent', capability_ref: 'libra.test.observe@1', contract_version: 1,
        input_binding_schema_ref: 'helix://test/inputs', input_bindings_json: '{}', parameter_schema_ref: 'helix://test/parameters',
        parameters_json: '{}', when_schema_ref: settings.dependentWhen ? 'helix://test/when' : null,
        when_json: settings.dependentWhen ? '{}' : null, effect_class: 'pure_observation', fence_schema_ref: 'helix://test/fence',
        fence_basis_json: '{}', resource_demand_schema_ref: 'helix://test/resources', resource_demand_json: '{}',
        approval_requirement_ref: null, authorization_requirement_ref: null,
        retry_policy_ref: 'helix://foundation/retry-policies/pure_observation/v1',
        timeout_policy_ref: 'helix://foundation/timeout-policies/test/v1', output_contract_ref: 'helix://test/result',
        compensation_for_event_id: null, compensation_contract_ref: null });
      repository.invoke('event', { event_id: 'event-dependent', plan_id: 'plan', node_id: 'node-dependent', work_id: 'work',
        attempt_id: 'work-attempt', owner_domain: 'libra', capability_ref: 'libra.test.observe@1', contract_version: 1,
        priority_class: 'normal_foreground', state: 'pending', ready_at_ms: null, retry_at_ms: null, result_id: null });
      repository.invoke('edge', { plan_id: 'plan', from_node_id: 'node', to_node_id: 'node-dependent', dependency_kind: 'success' });
    }
  } }]);
  let schedulerReleased = 0; let governorReleased = 0; let dispatchContext;
  const lease = Object.freeze({ leaseId: 'lease', targetType: 'event', targetId: 'event', issuedAtMs: 1, expiresAtMs: 999999, fenceDigest: HASH_A });
  const scheduler = { assertCurrent(value) { assert.equal(value, lease); }, release(value) { assert.equal(value, lease); schedulerReleased += 1; } };
  const permit = Object.freeze({ permitId: 'permit', eventId: 'event', resources: Object.freeze([{ resourceKey: 'cpu_heavy', units: 1 }]), profileRevision: 1, issuedAtMs: 1000 });
  const governor = { acquire: () => settings.governorDecision || ({ kind: 'permitted', permit }), release(value) { assert.equal(value, permit); governorReleased += 1; return { grants: [] }; } };
  const fences = settings.fences || [{ valid: true, digest: HASH_A, snapshot: {} }, { valid: true, digest: HASH_A, snapshot: {} }];
  let fenceIndex = 0;
  const dispatcher = { async dispatch(request) {
    dispatchContext = request.context;
    assert.equal(schedulerReleased, 1, 'technical scheduler lease must end before Executor call');
    if (settings.dispatchError) throw settings.dispatchError;
    return settings.outcome || { kind: 'succeeded', resultSchemaRef: 'helix://test/result', result: { value: 1 },
      evidenceSchemaRef: 'helix://test/evidence', evidence: { proof: true } };
  } };
  const runtime = createEventRuntime({ schemaManifest, unitOfWork, scheduler, governor,
    registry: { resolve: () => ({ manifest: { capabilityRef: 'libra.test.observe@1', resultSchemaRef: 'helix://test/result',
      approvalRequirementRef: settings.approvalRequirementRef }, executor: { version: 1 } }) }, dispatcher,
    executionInputProvider: { prepare: () => ({ ownerScope: { domain: 'libra', processType: 'libra_run', processId: 'run', objectRefs: [] },
      basisRefs: [{ basisType: 'execution_basis', basisId: 'basis', revision: 1, digest: HASH_A }], namedInputs: {},
      idempotencyKey: 'event-attempt', traceContext: { traceId: 'trace', spanId: 'span' },
      ...(settings.includeApprovalHandle ? { approvalHandle: { approvalId: 'approval' } } : {}) }) },
    fenceValidator: { validate: () => fences[fenceIndex++] },
    whenEvaluator: { evaluate: () => settings.whenDecision || 'run' },
    resourceDemandResolver: { resolve: () => ({ eventId: settings.demandEventId || 'event', queueClass: 'normal_foreground',
      localPriority: 0, priorityRevision: 1, resources: [{ resourceKey: 'cpu_heavy', units: 1 }] }) },
    nextEventAttemptId: () => 'event-attempt', nextExecutionId: () => 'execution', nextResultId: () => 'result', now: () => 1000 });
  const cleanup = () => { kernel.close(); fs.rmSync(root, { recursive: true, force: true }); };
  try {
    const result = run({ runtime, lease, databasePath, state: () => ({ schedulerReleased, governorReleased, dispatchContext }) });
    if (result && typeof result.then === 'function') return result.finally(cleanup);
    cleanup(); return result;
  } catch (error) { cleanup(); throw error; }
}

function databaseFacts(databasePath) {
  const database = new Database(databasePath, { readonly: true });
  try {
    return {
      event: database.prepare('SELECT state,retry_at_ms,result_id FROM fx_workflow_events WHERE event_id=?').get('event'),
      attempt: database.prepare('SELECT state,outcome_kind,retry_after_ms,failure_class,failure_code FROM fx_event_attempts WHERE event_id=?').get('event'),
      results: database.prepare('SELECT COUNT(*) count FROM fx_event_result_bindings').get().count
    };
  } finally { database.close(); }
}

test('succeeded Outcome binds one immutable Result and least-authority Context', async () => {
  await fixture(async ({ runtime, lease, databasePath, state }) => {
    const completed = await runtime.run({ schedulerLease: lease });
    assert.deepEqual(completed, { kind: 'succeeded', eventId: 'event', eventAttemptId: 'event-attempt', eventState: 'succeeded', resultId: 'result', retryAtMs: null });
    assert.deepEqual(databaseFacts(databasePath), { event: { state: 'succeeded', retry_at_ms: null, result_id: 'result' },
      attempt: { state: 'completed', outcome_kind: 'succeeded', retry_after_ms: null, failure_class: null, failure_code: null }, results: 1 });
    assert.deepEqual(state().dispatchContext.resourceLease, { leaseId: 'permit', resourceKeys: ['cpu_heavy'], issuedAtMs: 1000 });
    for (const forbidden of ['task', 'config', 'repository', 'store', 'facade', 'planner', 'runtime', 'governor']) {
      assert.equal(Object.keys(state().dispatchContext).some((key) => key.toLowerCase() === forbidden), false, forbidden);
    }
    assert.deepEqual({ schedulerReleased: state().schedulerReleased, governorReleased: state().governorReleased }, { schedulerReleased: 1, governorReleased: 1 });
    const database = new Database(databasePath, { readonly: true });
    try {
      assert.deepEqual(database.prepare('SELECT resource_key,queue_class,outcome FROM fx_event_resource_timings').all(),
        [{ resource_key: 'cpu_heavy', queue_class: 'normal_foreground', outcome: 'succeeded' }]);
    } finally { database.close(); }
  });
});

test('deferred Outcome completes Attempt without Result and persists external retry wait', async () => {
  await fixture(async ({ runtime, lease, databasePath }) => {
    const completed = await runtime.run({ schedulerLease: lease });
    assert.equal(completed.kind, 'deferred');
    const facts = databaseFacts(databasePath);
    assert.equal(facts.event.state, 'waiting_for_external'); assert.equal(facts.results, 0);
    assert.equal(facts.attempt.retry_after_ms, 30000); assert.equal(facts.event.retry_at_ms, 1700000031700);
  }, { outcome: { kind: 'deferred', reasonCode: 'NOT_READY', retryAfterMs: 30000, evidence: { observed: true } } });
});

test('failed Outcome is technical failure only and never creates Result', async () => {
  await fixture(async ({ runtime, lease, databasePath }) => {
    await runtime.run({ schedulerLease: lease });
    assert.deepEqual(databaseFacts(databasePath), { event: { state: 'failed', retry_at_ms: null, result_id: null },
      attempt: { state: 'completed', outcome_kind: 'failed', retry_after_ms: null, failure_class: 'integration', failure_code: 'DOWN' }, results: 0 });
  }, { outcome: { kind: 'failed', failureClass: 'integration', code: 'DOWN', message: 'down', retryDirective: 'never', evidence: {} } });
});

test('Fence rejection before or after Permit records completed Attempt and never dispatches', async () => {
  await fixture(async ({ runtime, lease, databasePath, state }) => {
    assert.equal((await runtime.run({ schedulerLease: lease })).kind, 'fence_rejected');
    assert.equal(databaseFacts(databasePath).attempt.outcome_kind, 'fence_rejected');
    assert.equal(state().dispatchContext, undefined); assert.equal(state().governorReleased, 0);
  }, { fences: [{ valid: false, actualDigest: HASH_B, evidence: { stale: true } }] });
  await fixture(async ({ runtime, lease, databasePath, state }) => {
    assert.equal((await runtime.run({ schedulerLease: lease })).kind, 'fence_rejected');
    assert.equal(databaseFacts(databasePath).attempt.outcome_kind, 'fence_rejected');
    assert.equal(state().dispatchContext, undefined); assert.equal(state().governorReleased, 1);
  }, { fences: [{ valid: true, digest: HASH_A, snapshot: {} }, { valid: true, digest: HASH_B, snapshot: {} }] });
});

test('Executor crash leaves durable executing Attempt for effect-specific recovery while releasing in-memory guards', async () => {
  await fixture(async ({ runtime, lease, databasePath, state }) => {
    await assert.rejects(runtime.run({ schedulerLease: lease }), /executor crash/);
    const facts = databaseFacts(databasePath);
    assert.equal(facts.event.state, 'executing'); assert.equal(facts.attempt.state, 'executing'); assert.equal(facts.results, 0);
    assert.deepEqual({ schedulerReleased: state().schedulerReleased, governorReleased: state().governorReleased }, { schedulerReleased: 1, governorReleased: 1 });
  }, { dispatchError: new Error('executor crash') });
});

test('resolved demand cannot claim another Event identity', async () => {
  await fixture(async ({ runtime, lease, state }) => {
    await assert.rejects(runtime.run({ schedulerLease: lease }), { code: 'P4_EVENT_RESOURCE_DEMAND_BINDING_MISMATCH' });
    assert.equal(state().schedulerReleased, 1); assert.equal(state().governorReleased, 0);
  }, { demandEventId: 'other-event' });
});

test('durable Plan approval requirement accepts exactly one matching injected Handle shape', async () => {
  await fixture(async ({ runtime, lease }) => {
    await assert.rejects(runtime.run({ schedulerLease: lease }), { code: 'P4_EVENT_REQUIRED_HANDLE_MISMATCH' });
  }, { approvalRequirementRef: 'helix://requirements/exact/v1' });
  await fixture(async ({ runtime, lease }) => {
    assert.equal((await runtime.run({ schedulerLease: lease })).kind, 'succeeded');
  }, { approvalRequirementRef: 'helix://requirements/exact/v1', includeApprovalHandle: true });
  await fixture(async ({ runtime, lease }) => {
    await assert.rejects(runtime.run({ schedulerLease: lease }), { code: 'P4_EVENT_REQUIRED_HANDLE_MISMATCH' });
  }, { includeApprovalHandle: true });
});

test('terminal predecessor atomically advances success dependency to ready, cancelled, or when-skipped', async () => {
  await fixture(async ({ runtime, lease, databasePath }) => {
    await runtime.run({ schedulerLease: lease });
    const database = new Database(databasePath, { readonly: true });
    try { assert.equal(database.prepare('SELECT state FROM fx_workflow_events WHERE event_id=?').get('event-dependent').state, 'ready'); }
    finally { database.close(); }
  }, { addDependent: true });
  await fixture(async ({ runtime, lease, databasePath }) => {
    await runtime.run({ schedulerLease: lease });
    const database = new Database(databasePath, { readonly: true });
    try { assert.equal(database.prepare('SELECT state FROM fx_workflow_events WHERE event_id=?').get('event-dependent').state, 'cancelled'); }
    finally { database.close(); }
  }, { addDependent: true, outcome: { kind: 'failed', failureClass: 'system', code: 'FAILED', message: 'failed', retryDirective: 'never', evidence: {} } });
  await fixture(async ({ runtime, lease, databasePath }) => {
    await runtime.run({ schedulerLease: lease });
    const database = new Database(databasePath, { readonly: true });
    try { assert.equal(database.prepare('SELECT state FROM fx_workflow_events WHERE event_id=?').get('event-dependent').state, 'skipped'); }
    finally { database.close(); }
  }, { addDependent: true, dependentWhen: true, whenDecision: 'skip' });
});

test('Executor fence_rejected Outcome completes Attempt without immutable Result', async () => {
  await fixture(async ({ runtime, lease, databasePath }) => {
    assert.equal((await runtime.run({ schedulerLease: lease })).kind, 'fence_rejected');
    const facts = databaseFacts(databasePath);
    assert.equal(facts.event.state, 'failed'); assert.equal(facts.results, 0);
    assert.equal(facts.attempt.failure_class, 'fence');
  }, { outcome: { kind: 'fence_rejected', fenceSlice: {}, expectedDigest: HASH_A, actualDigest: HASH_B, evidence: { stale: true } } });
});

test('Event Runtime source does not route by classification, access Domain Store, or create Business Process', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/helix/foundation/execution/event-runtime.js'), 'utf8').toLowerCase();
  for (const forbidden of ['flowkind', 'diagnosticclassification', '../domains', 'createprocess', 'fallback']) assert.equal(source.includes(forbidden), false, forbidden);
});
