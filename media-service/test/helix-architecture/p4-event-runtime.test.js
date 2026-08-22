'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { createEventRuntime, observationFailureClass } = require('../../src/helix/foundation/execution/event-runtime');
const {
  executionInputUnavailable,
} = require('../../src/helix/foundation/execution/execution-input-readiness');
const { createRepositoryDefinition } = require('../../src/helix/foundation/persistence/owner-repository');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));
const HASH_A = 'a'.repeat(64); const HASH_B = 'b'.repeat(64);

test('maps Douban page transport failure to a retryable integration class', () => {
  assert.equal(observationFailureClass({ code: 'P5_PROVIDER_TRANSPORT_FAILED' }), 'integration');
  assert.equal(observationFailureClass({ code: 'P4_EXECUTION_TIMEOUT' }), 'timeout');
  assert.equal(observationFailureClass({ code: 'EXECUTOR_ERROR' }), 'executor');
});
const EMPTY_INPUT_DIGEST = require('node:crypto').createHash('sha256').update('{}').digest('hex');

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
      'plan_id', 'attempt_id', 'basis_digest', 'state'
    ] },
    node: { kind: 'insert', tableId: 'fx_plan_nodes', columns: [
      'plan_id', 'node_id', 'capability_ref', 'contract_version', 'input_binding_schema_ref', 'input_bindings_json',
      'parameter_schema_ref', 'parameters_json', 'when_schema_ref', 'when_json', 'effect_class', 'fence_schema_ref', 'fence_basis_json',
      'resource_demand_schema_ref', 'resource_demand_json'
    ] },
    event: { kind: 'insert', tableId: 'fx_workflow_events', columns: [
      'event_id', 'plan_id', 'node_id', 'work_id', 'attempt_id', 'owner_domain', 'capability_ref', 'contract_version',
      'priority_class', 'state', 'ready_at_ms', 'retry_at_ms', 'result_id'
    ] },
    event_attempt: { kind: 'insert', tableId: 'fx_event_attempts', columns: [
      'event_attempt_id', 'event_id', 'ordinal', 'executor_ref', 'executor_version',
      'input_snapshot_schema_ref', 'input_snapshot_digest', 'fence_snapshot_digest',
      'state', 'outcome_kind', 'retry_after_ms', 'failure_class', 'failure_code',
      'evidence_digest', 'started_at_ms', 'finished_at_ms'
    ] },
    edge: { kind: 'insert', tableId: 'fx_plan_edges', columns: ['plan_id', 'from_node_id', 'to_node_id', 'dependency_kind'] }
  } });
  unitOfWork.execute([{ participantId: 'event_runtime_seed', owner: 'execution-foundation', repositories: [seed], execute(context) {
    const repository = context.repository('event_runtime_seed');
    repository.invoke('work', { work_id: 'work', owner_domain: 'libra', process_type: 'libra_run', process_id: 'run', basis_digest: HASH_A,
      priority_class: 'normal_foreground', state: 'running', idempotency_key: 'work' });
    repository.invoke('work_attempt', { attempt_id: 'work-attempt', work_id: 'work', basis_digest: HASH_A, state: 'running' });
    repository.invoke('plan', { plan_id: 'plan', attempt_id: 'work-attempt', basis_digest: HASH_A, state: 'planned' });
    repository.invoke('node', { plan_id: 'plan', node_id: 'node', capability_ref: 'libra.test.observe@1', contract_version: 1,
      input_binding_schema_ref: 'helix://test/inputs', input_bindings_json: '{}', parameter_schema_ref: 'helix://test/parameters',
      parameters_json: '{}', when_schema_ref: null, when_json: null, effect_class: settings.effectClass || 'pure_observation',
      fence_schema_ref: 'helix://test/fence', fence_basis_json: '{}',
      resource_demand_schema_ref: 'helix://test/resources', resource_demand_json: '{}' });
    repository.invoke('event', { event_id: 'event', plan_id: 'plan', node_id: 'node', work_id: 'work', attempt_id: 'work-attempt',
      owner_domain: 'libra', capability_ref: 'libra.test.observe@1', contract_version: 1, priority_class: 'normal_foreground',
      state: settings.initialEventState || 'ready', ready_at_ms: 1,
      retry_at_ms: settings.initialEventState === 'waiting_for_external' ? 999 : null,
      result_id: null });
    if (settings.seedDeferredAttempt) {
      repository.invoke('event_attempt', {
        event_attempt_id: 'event-attempt-1', event_id: 'event', ordinal: 1,
        executor_ref: 'libra.test.observe@1', executor_version: 1,
        input_snapshot_schema_ref: 'helix://test/inputs',
        input_snapshot_digest: HASH_A, fence_snapshot_digest: HASH_A,
        state: 'completed', outcome_kind: 'deferred', retry_after_ms: 30_000,
        failure_class: null, failure_code: null, evidence_digest: HASH_B,
        started_at_ms: 1, finished_at_ms: 2,
      });
    }
    if (settings.seedExecutingAttempt) {
      repository.invoke('event_attempt', {
        event_attempt_id:'event-attempt', event_id:'event', ordinal:1,
        executor_ref:'libra.test.observe@1', executor_version:1,
        input_snapshot_schema_ref:'helix://test/inputs', input_snapshot_digest:EMPTY_INPUT_DIGEST,
        fence_snapshot_digest:HASH_A, state:'executing', outcome_kind:null, retry_after_ms:null,
        failure_class:null, failure_code:null, evidence_digest:null, started_at_ms:1, finished_at_ms:null,
      });
    }
    if (settings.addDependent) {
      repository.invoke('node', { plan_id: 'plan', node_id: 'node-dependent', capability_ref: 'libra.test.observe@1', contract_version: 1,
        input_binding_schema_ref: 'helix://test/inputs', input_bindings_json: '{}', parameter_schema_ref: 'helix://test/parameters',
        parameters_json: '{}', when_schema_ref: settings.dependentWhen ? 'helix://test/when' : null,
        when_json: settings.dependentWhen ? '{}' : null, effect_class: 'pure_observation', fence_schema_ref: 'helix://test/fence',
        fence_basis_json: '{}', resource_demand_schema_ref: 'helix://test/resources', resource_demand_json: '{}' });
      repository.invoke('event', { event_id: 'event-dependent', plan_id: 'plan', node_id: 'node-dependent', work_id: 'work',
        attempt_id: 'work-attempt', owner_domain: 'libra', capability_ref: 'libra.test.observe@1', contract_version: 1,
        priority_class: 'normal_foreground', state: 'pending', ready_at_ms: null, retry_at_ms: null, result_id: null });
      repository.invoke('edge', { plan_id: 'plan', from_node_id: 'node', to_node_id: 'node-dependent', dependency_kind: 'success' });
    }
  } }]);
  let schedulerReleased = 0; let governorReleased = 0; let dispatchContext; const journalCalls = [];
  const lease = Object.freeze({ leaseId: 'lease', targetType: 'event', targetId: 'event', issuedAtMs: 1, expiresAtMs: 999999, fenceDigest: HASH_A });
  const scheduler = { assertCurrent(value) { assert.equal(value, lease); }, release(value) { assert.equal(value, lease); schedulerReleased += 1; } };
  const permit = Object.freeze({ permitId: 'permit', eventId: 'event', resources: Object.freeze([{ resourceKey: 'cpu_heavy', units: 1 }]), profileRevision: 1, issuedAtMs: 1000 });
  const governor = { acquire: () => {
    if (settings.assertReadyBeforeAcquire) {
      const database = new Database(databasePath, { readonly: true });
      try { assert.equal(database.prepare('SELECT state FROM fx_workflow_events WHERE event_id=?').get('event').state, 'ready'); }
      finally { database.close(); }
    }
    return settings.governorDecision || ({ kind: 'permitted', permit });
  }, release(value) { assert.equal(value, permit); governorReleased += 1; return { grants: [] }; } };
  const fences = settings.fences || [{ valid: true, digest: HASH_A, snapshot: {} }, { valid: true, digest: HASH_A, snapshot: {} }];
  let fenceIndex = 0;
  const dispatcher = { async dispatch(request) {
    dispatchContext = request.context;
    if (!settings.seedExecutingAttempt) {
      assert.equal(schedulerReleased, 1, 'technical scheduler lease must end before Executor call');
    }
    if (settings.effectClass && settings.effectClass !== 'pure_observation') assert.equal(journalCalls[0], 'intend');
    if (settings.dispatchError) throw settings.dispatchError;
    const outcome = settings.outcome || { kind: 'succeeded', resultSchemaRef: 'helix://test/result', result: { value: 1 },
      evidenceSchemaRef: 'helix://test/evidence', evidence: { proof: true } };
    if (settings.prebindResult) {
      const database = new Database(databasePath);
      try {
        const resultJson = JSON.stringify(outcome.result); const evidenceJson = JSON.stringify(outcome.evidence);
        const crypto = require('node:crypto');
        const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
        database.prepare(`INSERT INTO fx_event_result_bindings
          (result_id,event_id,outcome_kind,result_schema_ref,result_json,result_digest,evidence_schema_ref,evidence_json,evidence_digest,effect_receipt_id,committed_at_ms)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run('atomic-result', 'event', 'succeeded', outcome.resultSchemaRef,
          resultJson, hash(resultJson), outcome.evidenceSchemaRef, evidenceJson, hash(evidenceJson),
          outcome.effectReceipt?.effectReceiptId || null, 1000);
      } finally { database.close(); }
    }
    return outcome;
  } };
  const runtime = createEventRuntime({ schemaManifest, unitOfWork, scheduler, governor,
    registry: { resolve: () => ({ manifest: { capabilityRef: 'libra.test.observe@1', resultSchemaRef: 'helix://test/result',
      effectClass: settings.effectClass || 'pure_observation', approvalRequirementRef: settings.approvalRequirementRef }, executor: { version: 1 } }) }, dispatcher,
    ...(settings.effectJournal === false ? {} : { effectJournal: {
      intend(request) { journalCalls.push('intend'); return { effect_id: request.eventAttemptId,
        state: settings.effectIntentState || 'intended', event_attempt_id: settings.effectIntentAttemptId || request.eventAttemptId,
        effect_class: request.effectClass, idempotency_key: request.idempotencyKey, intent_digest: request.intentDigest }; },
      read(effectId) { journalCalls.push('read'); return settings.effectJournalRead
        ? { ...settings.effectJournalRead, effect_id: effectId || settings.effectJournalRead.effect_id }
        : null; },
      async settle() { journalCalls.push('settle'); },
      noteExternalPending() { journalCalls.push('external-receipt'); },
      requireReconcile() { journalCalls.push('reconcile'); },
      abandonUncommitted() { journalCalls.push('abandon'); }
    } }),
    attemptPolicy: {
      bindingFor: () => ({ retryPolicyRef: 'helix://foundation/retry-policies/pure_observation/v1',
        timeoutPolicyRef: 'helix://foundation/timeout-policies/test/v1' }),
      prepare: () => ({ deadlineAtMs: 2000 }),
      decideFailure: () => settings.failurePolicyDecision || ({ decision: settings.effectClass && settings.effectClass !== 'pure_observation'
        ? 'reconcile_required' : 'terminal_failure' }),
      decideDeferred: () => settings.deferredPolicyDecision || ({ decision: 'observe', retryAtMs: 1700000031700 })
    },
    timeoutController: { async execute(request) {
      if (settings.timeout) throw Object.assign(new Error('timeout'), { code: 'P4_EXECUTION_TIMEOUT' });
      return request.operation();
    } },
    circuitBreaker: { allows: () => settings.circuitDecision || ({ allowed: true, reason: 'closed' }) },
    executionInputProvider: { prepare: () => {
      if (settings.inputError) throw settings.inputError;
      return ({ ownerScope: { domain: 'libra', processType: 'libra_run', processId: 'run', objectRefs: [] },
      basisRefs: [{ basisType: 'execution_basis', basisId: 'basis', revision: 1, digest: HASH_A }], namedInputs: {},
      idempotencyKey: 'event-attempt', traceContext: { traceId: 'trace', spanId: 'span' },
      ...(settings.inputDeadline !== undefined ? { deadlineAtMs: settings.inputDeadline } : {}),
      ...(settings.includeApprovalHandle ? { approvalHandle: { approvalId: 'approval' } } : {}) });
    } },
    fenceValidator: { validate: () => fences[fenceIndex++] },
    whenEvaluator: { evaluate: () => settings.whenDecision || 'run' },
    resourceDemandResolver: { resolve: () => ({ eventId: settings.demandEventId || 'event', queueClass: 'normal_foreground',
      localPriority: 0, priorityRevision: 1, resources: [{ resourceKey: 'cpu_heavy', units: 1 }] }) },
    nextEventAttemptId: () => settings.seedDeferredAttempt
      ? 'event-attempt-2' : 'event-attempt',
    nextExecutionId: () => 'execution', nextResultId: () => 'result', now: () => 1000 });
  const cleanup = () => { kernel.close(); fs.rmSync(root, { recursive: true, force: true }); };
  try {
    const result = run({ runtime, lease, databasePath, state: () => ({ schedulerReleased, governorReleased, dispatchContext, journalCalls }) });
    if (result && typeof result.then === 'function') return result.finally(cleanup);
    cleanup(); return result;
  } catch (error) { cleanup(); throw error; }
}

function databaseFacts(databasePath) {
  const database = new Database(databasePath, { readonly: true });
  try {
    return {
      event: database.prepare('SELECT state,retry_at_ms,result_id FROM fx_workflow_events WHERE event_id=?').get('event'),
      attempt: database.prepare('SELECT state,outcome_kind,retry_after_ms,failure_class,failure_code FROM fx_event_attempts WHERE event_id=? ORDER BY ordinal DESC LIMIT 1').get('event'),
      attempts: database.prepare('SELECT COUNT(*) count FROM fx_event_attempts WHERE event_id=?').get('event').count,
      results: database.prepare('SELECT COUNT(*) count FROM fx_event_result_bindings').get().count
    };
  } finally { database.close(); }
}

test('succeeded Outcome binds one immutable Result and least-authority Context', async () => {
  await fixture(async ({ runtime, lease, databasePath, state }) => {
    const completed = await runtime.run({ schedulerLease: lease });
    assert.deepEqual(completed, { kind: 'succeeded', eventId: 'event', eventAttemptId: 'event-attempt', eventState: 'succeeded', resultId: 'result', retryAtMs: null });
    assert.deepEqual(databaseFacts(databasePath), { event: { state: 'succeeded', retry_at_ms: null, result_id: 'result' },
      attempt: { state: 'completed', outcome_kind: 'succeeded', retry_after_ms: null, failure_class: null, failure_code: null },
      attempts: 1, results: 1 });
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

test('atomic Domain commit may pre-bind the exact typed Result before Event terminal transition', async () => {
  await fixture(async ({ runtime, lease, databasePath }) => {
    const completed = await runtime.run({ schedulerLease: lease });
    assert.equal(completed.resultId, 'atomic-result');
    assert.equal(databaseFacts(databasePath).results, 1);
  }, { prebindResult: true });
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

test('temporarily unavailable execution input waits durably without Attempt, Permit, or queue hot loop', async () => {
  await fixture(async ({ runtime, lease, databasePath, state }) => {
    const completed = await runtime.run({ schedulerLease: lease });
    assert.deepEqual(completed, {
      kind: 'input_waiting', eventId: 'event',
      eventAttemptId: null,
      eventState: 'waiting_for_external', retryAtMs: 31_000,
      failureCode: 'P4_EXECUTION_INPUT_TEMPORARILY_UNAVAILABLE',
      failureMessage: null,
      dependencyKind: 'integration',
    });
    assert.deepEqual(databaseFacts(databasePath), {
      event: { state: 'waiting_for_external', retry_at_ms: 31_000, result_id: null },
      attempt: undefined, attempts: 0, results: 0,
    });
    assert.deepEqual({ schedulerReleased:state().schedulerReleased, governorReleased:state().governorReleased },
      { schedulerReleased:1, governorReleased:0 });
  }, { inputError:executionInputUnavailable('Integration unavailable.', {
    dependencyKind:'integration', dependencyRef:'tmdb-main', retryAtMs:31_000,
  }) });
});

test('deterministic input projection failure terminates Event with one auditable failed Attempt', async () => {
  await fixture(async ({ runtime, lease, databasePath, state }) => {
    const completed = await runtime.run({ schedulerLease: lease });
    assert.equal(completed.kind, 'input_failed');
    assert.equal(completed.failureCode, 'P4_EVENT_INPUT_PREPARATION_FAILED');
    assert.deepEqual(databaseFacts(databasePath), {
      event: { state: 'failed', retry_at_ms: null, result_id: null },
      attempt: {
        state: 'completed', outcome_kind: 'failed', retry_after_ms: null,
        failure_class: 'input_projection', failure_code: 'P4_EVENT_INPUT_PREPARATION_FAILED',
      },
      attempts: 1, results: 0,
    });
    const database = new Database(databasePath, { readonly:true });
    try {
      assert.equal(database.prepare('SELECT state FROM fx_workflow_events WHERE event_id=?').get('event-dependent').state, 'cancelled');
    } finally { database.close(); }
    assert.deepEqual({ schedulerReleased:state().schedulerReleased, governorReleased:state().governorReleased },
      { schedulerReleased:1, governorReleased:0 });
  }, { inputError:new Error('projection bug'), addDependent:true });
});

test('due external observation wait creates the next Attempt and can become terminal', async () => {
  await fixture(async ({ runtime, lease, databasePath }) => {
    const completed = await runtime.run({ schedulerLease: lease });
    assert.equal(completed.kind, 'succeeded');
    assert.equal(completed.eventAttemptId, 'event-attempt-2');
    const facts = databaseFacts(databasePath);
    assert.equal(facts.event.state, 'succeeded');
    assert.equal(facts.attempts, 2);
    assert.equal(facts.attempt.outcome_kind, 'succeeded');
  }, {
    initialEventState: 'waiting_for_external',
    seedDeferredAttempt: true,
    assertReadyBeforeAcquire: true,
  });
});

test('failed Outcome is technical failure only and never creates Result', async () => {
  await fixture(async ({ runtime, lease, databasePath }) => {
    await runtime.run({ schedulerLease: lease });
    assert.deepEqual(databaseFacts(databasePath), { event: { state: 'failed', retry_at_ms: null, result_id: null },
      attempt: { state: 'completed', outcome_kind: 'failed', retry_after_ms: null, failure_class: 'integration', failure_code: 'DOWN' },
      attempts: 1, results: 0 });
  }, { outcome: { kind: 'failed', failureClass: 'integration', code: 'DOWN', message: 'down', retryDirective: 'never', evidence: {} } });
});

test('pure technical failure retries within frozen policy without changing Plan or Result', async () => {
  await fixture(async ({ runtime, lease, databasePath }) => {
    const completed = await runtime.run({ schedulerLease: lease });
    assert.equal(completed.eventState, 'ready'); assert.equal(completed.retryAtMs, 1700000009000);
    assert.equal(databaseFacts(databasePath).results, 0);
  }, { failurePolicyDecision: { decision: 'retry', retryAtMs: 1700000009000 },
    outcome: { kind: 'failed', failureClass: 'integration', code: 'DOWN', message: 'down', retryDirective: 'contract_policy', evidence: {} } });
});

test('hard timeout completes Attempt, releases Permit, and follows Effect-specific policy', async () => {
  await fixture(async ({ runtime, lease, databasePath, state }) => {
    const completed = await runtime.run({ schedulerLease: lease });
    assert.equal(completed.eventState, 'ready');
    assert.equal(databaseFacts(databasePath).attempt.failure_code, 'EXECUTION_TIMEOUT');
    assert.equal(state().governorReleased, 1);
  }, { timeout: true, failurePolicyDecision: { decision: 'retry', retryAtMs: 1700000009000 } });
});

test('non-pure timeout never retries before Effect reconciliation', async () => {
  await fixture(async ({ runtime, lease, state }) => {
    const completed = await runtime.run({ schedulerLease: lease });
    assert.equal(completed.eventState, 'waiting_for_external');
    assert.deepEqual(state().journalCalls, ['intend', 'reconcile']);
    assert.equal(state().governorReleased, 1);
  }, { effectClass: 'external_request', timeout: true });
});

test('caller cannot override deadline derived from immutable Timeout Policy', async () => {
  await fixture(async ({ runtime, lease, databasePath }) => {
    await assert.rejects(runtime.run({ schedulerLease: lease }), { code: 'P4_EVENT_TIMEOUT_POLICY_MISMATCH' });
    const database = new Database(databasePath, { readonly: true });
    try { assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_event_attempts').get().count, 0); }
    finally { database.close(); }
  }, { inputDeadline: 9999 });
});

test('open Circuit blocks unstarted Event before Permit, Attempt, or effect intent', async () => {
  await fixture(async ({ runtime, lease, databasePath, state }) => {
    assert.equal((await runtime.run({ schedulerLease: lease })).kind, 'circuit_deferred');
    assert.equal(state().governorReleased, 0); assert.deepEqual(state().journalCalls, []);
    const database = new Database(databasePath, { readonly: true });
    try { assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_event_attempts').get().count, 0); }
    finally { database.close(); }
  }, { effectClass: 'domain_fact_commit', circuitDecision: { allowed: false, reason: 'circuit_blocks_new_effect' } });
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

test('pure observation executor error completes its Attempt under failure policy', async () => {
  await fixture(async ({ runtime, lease, databasePath, state }) => {
    const result = await runtime.run({ schedulerLease: lease });
    assert.equal(result.kind, 'failed');
    const facts = databaseFacts(databasePath);
    assert.equal(facts.event.state, 'failed'); assert.equal(facts.attempt.state, 'completed');
    assert.equal(facts.attempt.outcome_kind, 'failed'); assert.equal(facts.attempt.failure_code, 'EXECUTOR_ERROR');
    assert.equal(facts.results, 0);
    assert.deepEqual({ schedulerReleased: state().schedulerReleased, governorReleased: state().governorReleased }, { schedulerReleased: 1, governorReleased: 1 });
  }, { dispatchError: new Error('executor crash') });
});

test('non-pure Executor crash leaves durable executing Attempt for effect-specific recovery while releasing in-memory guards', async () => {
  await fixture(async ({ runtime, lease, databasePath, state }) => {
    await assert.rejects(runtime.run({ schedulerLease: lease }), /executor crash/);
    const facts = databaseFacts(databasePath);
    assert.equal(facts.event.state, 'executing'); assert.equal(facts.attempt.state, 'executing'); assert.equal(facts.results, 0);
    assert.deepEqual({ schedulerReleased: state().schedulerReleased, governorReleased: state().governorReleased }, { schedulerReleased: 1, governorReleased: 1 });
  }, { effectClass:'external_request', dispatchError: new Error('executor crash') });
});

test('abandoned non-pure failed Outcome with retryDirective never fail-closes the Event', async () => {
  await fixture(async ({ runtime, lease, databasePath, state }) => {
    const result = await runtime.run({ schedulerLease: lease });
    assert.equal(result.kind, 'failed');
    assert.equal(result.eventState, 'failed');
    const facts = databaseFacts(databasePath);
    assert.equal(facts.event.state, 'failed');
    assert.equal(facts.attempt.state, 'completed');
    assert.equal(facts.attempt.outcome_kind, 'failed');
    assert.equal(facts.attempt.failure_code, 'FIELD_OBSERVATION_ROOT_UNAVAILABLE');
    assert.deepEqual(state().journalCalls, ['intend', 'abandon']);
  }, { effectClass:'domain_fact_commit', outcome: {
    kind:'failed', failureClass:'executor', code:'FIELD_OBSERVATION_ROOT_UNAVAILABLE',
    message:'Material Field当前物理访问位置不可读。', retryDirective:'never',
    evidence:{ errorCode:'FIELD_OBSERVATION_ROOT_UNAVAILABLE' },
  } });
});

test('non-pure Capability failed Outcome completes the Attempt and abandons the uncommitted Effect', async () => {
  await fixture(async ({ runtime, lease, databasePath, state }) => {
    const result = await runtime.run({ schedulerLease: lease });
    assert.equal(result.kind, 'failed');
    assert.equal(result.eventState, 'waiting_for_external');
    const facts = databaseFacts(databasePath);
    assert.equal(facts.attempt.state, 'completed');
    assert.equal(facts.attempt.outcome_kind, 'failed');
    assert.equal(facts.attempt.failure_code, 'LIBRA_MEDIA_FFMPEG_FAILED');
    assert.deepEqual(state().journalCalls, ['intend', 'abandon']);
  }, { effectClass:'external_request', outcome: {
    kind:'failed', failureClass:'executor', code:'LIBRA_MEDIA_FFMPEG_FAILED',
    message:'FFmpeg failed.', retryDirective:'contract_policy',
    evidence:{ errorCode:'LIBRA_MEDIA_FFMPEG_FAILED' },
  } });
});

test('already-failed recovery completes the executing Attempt without re-dispatch', async () => {
  await fixture(async ({ runtime, databasePath, state }) => {
    const result = await runtime.recover({ eventId: 'event', effectId: 'effect', decision: 'already_failed' });
    assert.equal(result.kind, 'failed');
    const facts = databaseFacts(databasePath);
    assert.equal(facts.attempt.state, 'completed');
    assert.equal(facts.attempt.failure_code, 'P4_EVENT_RECOVERY_EFFECT_ABANDONED');
    assert.equal(facts.event.state, 'waiting_for_external');
    assert.equal(state().governorReleased, 0);
  }, { effectClass: 'external_request', initialEventState: 'executing', seedExecutingAttempt: true,
    failurePolicyDecision: { decision: 'reconcile_required' },
    effectJournalRead: { effect_id: 'effect', event_attempt_id: 'event-attempt', effect_class: 'external_request', state: 'failed' } });
});

test('startup recovery records a non-pure failed Outcome instead of looping as not converged', async () => {
  await fixture(async ({ runtime, databasePath, state }) => {
    const result = await runtime.recover({ eventId:'event', decision:'safe_retry_before_intent' });
    assert.equal(result.kind, 'failed');
    const facts = databaseFacts(databasePath);
    assert.equal(facts.attempt.state, 'completed');
    assert.equal(facts.attempt.failure_code, 'LIBRA_MEDIA_FFMPEG_FAILED');
    assert.equal(state().governorReleased, 1);
  }, { effectClass:'external_request', initialEventState:'executing', seedExecutingAttempt:true, outcome: {
    kind:'failed', failureClass:'executor', code:'LIBRA_MEDIA_FFMPEG_FAILED',
    message:'FFmpeg failed.', retryDirective:'contract_policy',
    evidence:{ errorCode:'LIBRA_MEDIA_FFMPEG_FAILED' },
  } });
});

test('startup recovery settles an old pure observation executor error instead of deferring it forever', async () => {
  await fixture(async ({ runtime, databasePath, state }) => {
    const result = await runtime.recover({ eventId:'event', decision:'safe_retry' });
    assert.equal(result.kind, 'failed');
    const facts = databaseFacts(databasePath);
    assert.equal(facts.event.state, 'failed'); assert.equal(facts.attempt.state, 'completed');
    assert.equal(facts.attempt.failure_code, 'EXECUTOR_ERROR');
    assert.equal(state().governorReleased, 1);
  }, { initialEventState:'executing', seedExecutingAttempt:true,
    dispatchError:new Error('old pure observation crash') });
});

test('non-pure Event persists intent before dispatch and settles verified receipt before Result commit', async () => {
  const effectReceipt = { effectReceiptId: 'receipt', effectId: 'event-attempt', effectClass: 'external_request', idempotencyKey: 'event-attempt' };
  await fixture(async ({ runtime, lease, state, databasePath }) => {
    assert.equal((await runtime.run({ schedulerLease: lease })).kind, 'succeeded');
    assert.deepEqual(state().journalCalls, ['intend', 'settle']);
    assert.equal(databaseFacts(databasePath).event.state, 'succeeded');
  }, { effectClass: 'external_request', outcome: { kind: 'succeeded', resultSchemaRef: 'helix://test/result', result: { value: 1 },
    evidenceSchemaRef: 'helix://test/evidence', evidence: { proof: true }, effectReceipt } });
});

test('non-pure Event fails before Attempt creation when Effect Journal is unavailable', async () => {
  await fixture(async ({ runtime, lease, databasePath }) => {
    await assert.rejects(runtime.run({ schedulerLease: lease }), { code: 'P4_EVENT_EFFECT_JOURNAL_REQUIRED' });
    const database = new Database(databasePath, { readonly: true });
    try { assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_event_attempts').get().count, 0); }
    finally { database.close(); }
  }, { effectClass: 'external_request', effectJournal: false });
});

test('non-pure deferred Outcome enters effect-specific reconciliation instead of ordinary retry', async () => {
  await fixture(async ({ runtime, lease, state }) => {
    assert.equal((await runtime.run({ schedulerLease: lease })).kind, 'deferred');
    assert.deepEqual(state().journalCalls, ['intend', 'reconcile']);
  }, { effectClass: 'external_request', outcome: { kind: 'deferred', reasonCode: 'PENDING', retryAfterMs: 1000, evidence: {} } });
});

test('external deferred Outcome journals typed external identity before reconciliation', async () => {
  await fixture(async ({ runtime, lease, state }) => {
    assert.equal((await runtime.run({ schedulerLease: lease })).kind, 'deferred');
    assert.deepEqual(state().journalCalls, ['intend', 'external-receipt', 'reconcile']);
  }, { effectClass: 'external_request', outcome: { kind: 'deferred', reasonCode: 'PENDING', retryAfterMs: 1000, evidence: {},
    externalReceipt: { receiptId: 'external-receipt', idempotencyKey: 'event-attempt', requestDigest: HASH_A } } });
});

test('existing non-pure intent cannot re-enter ordinary dispatch even with the same idempotency key', async () => {
  await fixture(async ({ runtime, lease, state }) => {
    await assert.rejects(runtime.run({ schedulerLease: lease }), { code: 'P4_EVENT_EFFECT_RECOVERY_REQUIRED' });
    assert.equal(state().dispatchContext, undefined);
    assert.deepEqual(state().journalCalls, ['intend']);
  }, { effectClass: 'external_request', effectIntentState: 'reconcile_required', effectIntentAttemptId: 'older-attempt' });
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
