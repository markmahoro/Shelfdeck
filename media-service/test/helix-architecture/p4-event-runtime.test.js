'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { createEventRuntime, observationFailureClass } = require('../../src/helix/foundation/execution/event-runtime');
const { createWorkLifecycle } = require('../../src/helix/foundation/execution/work-lifecycle');
const { createExecutionRuntimeHost } = require('../../src/helix/foundation/execution/execution-runtime-host');
const { createTimeoutController } = require('../../src/helix/foundation/execution/timeout-controller');
const { createCooperativeExecutionIsolation } = require('../../src/helix/foundation/execution/cooperative-execution-isolation');
const { createAttemptPolicyController } = require('../../src/helix/foundation/execution/execution-policy');
const {
  executionInputUnavailable, executionInputSuperseded,
} = require('../../src/helix/foundation/execution/execution-input-readiness');
const { createRepositoryDefinition } = require('../../src/helix/foundation/persistence/owner-repository');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));
const HASH_A = 'a'.repeat(64); const HASH_B = 'b'.repeat(64);

function manualTimers(startedAtMs) {
  let current=startedAtMs,sequence=0;const pending=new Map();
  return Object.freeze({now:()=>current,setTimeout(callback,delay){const id=++sequence;pending.set(id,{at:current+delay,callback});return id;},
    clearTimeout(id){pending.delete(id);},advanceBy(elapsedMs){current+=elapsedMs;let found=true;while(found){found=false;
      for(const [id,item] of [...pending].sort((left,right)=>left[1].at-right[1].at)){if(item.at<=current){pending.delete(id);item.callback();found=true;break;}}}},
    pending:()=>pending.size});
}

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
      'work_id', 'owner_domain', 'process_type', 'process_id', 'work_kind', 'basis_digest', 'priority_class', 'state', 'idempotency_key'
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
      'priority_class', 'state', 'ready_at_ms', 'retry_at_ms', 'result_id', 'current_progress_revision'
    ] },
    point: { kind:'update', tableId:'fx_workflow_events', setColumns:['current_progress_revision'], keyColumns:['event_id'] },
    event_attempt: { kind: 'insert', tableId: 'fx_event_attempts', columns: [
      'event_attempt_id', 'event_id', 'ordinal', 'executor_ref', 'executor_version',
      'input_snapshot_schema_ref', 'input_snapshot_digest', 'fence_snapshot_digest',
      'state', 'outcome_kind', 'retry_after_ms', 'failure_class', 'failure_code',
      'evidence_digest', 'started_at_ms', 'finished_at_ms'
    ] },
    result: { kind:'insert',tableId:'fx_event_result_bindings',columns:[
      'result_id','event_id','outcome_kind','result_schema_ref','result_json','result_digest','evidence_schema_ref',
      'evidence_json','evidence_digest','effect_receipt_id','committed_at_ms'
    ] },
    marker:{kind:'insert',tableId:'fx_commit_markers',columns:['commit_marker','effect_id','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest','committed_at_ms']},
    edge: { kind: 'insert', tableId: 'fx_plan_edges', columns: ['plan_id', 'from_node_id', 'to_node_id', 'dependency_kind'] },
    progress: { kind:'insert', tableId:'fx_event_progress', columns:[
      'event_id','event_attempt_id','revision','mode','current_value','total_value','unit','rate','eta_ms',
      'source_sequence','progress_bucket','sampled_at_ms'
    ] }
  } });
  unitOfWork.execute([{ participantId: 'event_runtime_seed', owner: 'execution-foundation', repositories: [seed], execute(context) {
    const repository = context.repository('event_runtime_seed');
    repository.invoke('work', { work_id: 'work', owner_domain: 'libra', process_type: 'libra_run', process_id: 'run', work_kind:'test_work', basis_digest: HASH_A,
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
      result_id: null, current_progress_revision:null });
    for (let ordinal = 1; ordinal <= (settings.seedFailureAttempts || 0); ordinal += 1) {
      repository.invoke('event_attempt', {
        event_attempt_id:'prior-failure-' + ordinal, event_id:'event', ordinal,
        executor_ref:'libra.test.observe@1', executor_version:1,
        input_snapshot_schema_ref:'helix://test/inputs', input_snapshot_digest:EMPTY_INPUT_DIGEST,
        fence_snapshot_digest:HASH_A, state:'completed', outcome_kind:'failed', retry_after_ms:null,
        failure_class:'integration', failure_code:'FIXTURE_NETWORK_FAILED', evidence_digest:HASH_B,
        started_at_ms:ordinal, finished_at_ms:ordinal + 1,
      });
    }
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
      if (settings.seedPriorProgress) repository.invoke('progress', {
        event_id:'event', event_attempt_id:'event-attempt-1', revision:1,
        mode:'determinate', current_value:63, total_value:100, unit:'percent', rate:8.58, eta_ms:241155,
        source_sequence:'attempt-1-63', progress_bucket:'percent-63', sampled_at_ms:900,
      });
      if (settings.seedPriorProgress) repository.invoke('point', { event_id:'event', current_progress_revision:1 });
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
    if(settings.seedPreboundRecovery){
      const resultValue=settings.preboundResult||{effectReceiptRef:'atomic-receipt',ownerDomain:'libra',scopeId:'run',scopeType:'libra_run',value:1},
        resultSchemaRef=settings.preboundResultSchemaRef||'helix://test/result',resultJson=JSON.stringify(resultValue),
        evidenceJson=JSON.stringify({proof:true}),resultDigest=require('node:crypto').createHash('sha256').update(resultJson).digest('hex'),
        commitDigest=settings.preboundCommitDigest||resultDigest;
      repository.invoke('result',{result_id:'atomic-result',event_id:'event',outcome_kind:'succeeded',
        result_schema_ref:resultSchemaRef,result_json:resultJson,result_digest:resultDigest,
        evidence_schema_ref:'helix://test/evidence',evidence_json:evidenceJson,evidence_digest:require('node:crypto').createHash('sha256').update(evidenceJson).digest('hex'),
        effect_receipt_id:'atomic-receipt',committed_at_ms:1000});
      if(settings.seedPreboundMarker!==false)repository.invoke('marker',{commit_marker:'atomic-marker',effect_id:'effect',owner_domain:'libra',
        scope_type:settings.preboundMarkerScopeType||'libra_run',scope_id:'run',commit_digest:commitDigest,result_id:'atomic-result',result_schema_ref:resultSchemaRef,
        result_digest:resultDigest,committed_at_ms:1000});
    }
    if (settings.addDependent) {
      repository.invoke('node', { plan_id: 'plan', node_id: 'node-dependent', capability_ref: 'libra.test.observe@1', contract_version: 1,
        input_binding_schema_ref: 'helix://test/inputs', input_bindings_json: '{}', parameter_schema_ref: 'helix://test/parameters',
        parameters_json: '{}', when_schema_ref: settings.dependentWhen ? 'helix://test/when' : null,
        when_json: settings.dependentWhen ? '{}' : null, effect_class: 'pure_observation', fence_schema_ref: 'helix://test/fence',
        fence_basis_json: '{}', resource_demand_schema_ref: 'helix://test/resources', resource_demand_json: '{}' });
      repository.invoke('event', { event_id: 'event-dependent', plan_id: 'plan', node_id: 'node-dependent', work_id: 'work',
        attempt_id: 'work-attempt', owner_domain: 'libra', capability_ref: 'libra.test.observe@1', contract_version: 1,
        priority_class: 'normal_foreground', state: 'pending', ready_at_ms: null, retry_at_ms: null, result_id: null,
        current_progress_revision:null });
      repository.invoke('edge', { plan_id: 'plan', from_node_id: 'node', to_node_id: 'node-dependent', dependency_kind: 'success' });
    }
  } }]);
  let schedulerReleased = 0; let governorReleased = 0; let recoveryAcquireCount = 0; let journalEffect = null;
  const dispatchOutcomes = [];
  let dispatchContext; const journalCalls = [];
  const lease = Object.freeze({ leaseId: 'lease', targetType: 'event', targetId: 'event', issuedAtMs: 1, expiresAtMs: 999999, fenceDigest: HASH_A });
  const scheduler = {
    assertCurrent(value) { assert.equal(value, lease); },
    noteDispatchOutcome(value, outcome) {
      assert.equal(value, lease);
      dispatchOutcomes.push(outcome.kind);
      if (settings.dispatchOutcomeError && outcome.kind === 'started') throw settings.dispatchOutcomeError;
      return { recorded: false };
    },
    release(value) { assert.equal(value, lease); schedulerReleased += 1; },
  };
  const permit = Object.freeze({ permitId: 'permit', eventId: 'event', resources: Object.freeze([{ resourceKey: 'cpu_heavy', units: 1 }]), profileRevision: 1, issuedAtMs: 1000 });
  const acquire = () => {
    if (settings.assertReadyBeforeAcquire) {
      const database = new Database(databasePath, { readonly: true });
      try { assert.equal(database.prepare('SELECT state FROM fx_workflow_events WHERE event_id=?').get('event').state, 'ready'); }
      finally { database.close(); }
    }
    return settings.governorDecision || ({ kind: 'permitted', permit });
  };
  const governor = { abandonWaiters(){return {abandonedWaiters:0};}, acquire, preparationWait:() => settings.preparationWait || null, acquireRecovery: () => {
    recoveryAcquireCount += 1;
    return acquire();
  }, release(value) { assert.equal(value, permit); governorReleased += 1; return { grants: [] }; } };
  const fences = settings.fences || [{ valid: true, digest: HASH_A, snapshot: {} }, { valid: true, digest: HASH_A, snapshot: {} }];
  let fenceIndex = 0;
  const dispatcher = { async dispatch(request) {
    dispatchContext = request.context;
    if (!settings.seedExecutingAttempt) {
      assert.equal(schedulerReleased, 1, 'technical scheduler lease must end before Executor call');
    }
    if (settings.effectClass && settings.effectClass !== 'pure_observation') {
      if (settings.seedExecutingAttempt) {
        assert.ok(['intend','read','reconcile'].includes(journalCalls[0]));
        assert.ok(journalCalls.some(call=>['intend','read'].includes(call)),
          'recovery must create or read its exact intent before dispatch');
      }
      else assert.equal(journalCalls[0], 'intend');
    }
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
        if(outcome.effectReceipt)database.prepare(`INSERT INTO fx_commit_markers
          (commit_marker,effect_id,owner_domain,scope_type,scope_id,commit_digest,result_id,result_schema_ref,result_digest,committed_at_ms)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(outcome.effectReceipt.commitMarker,outcome.effectReceipt.effectId,'libra','libra_run','run',
            outcome.effectReceipt.verificationEvidenceDigest,'atomic-result',outcome.resultSchemaRef,hash(resultJson),outcome.effectReceipt.committedAtMs);
      } finally { database.close(); }
    }
    return outcome;
  } };
  const runtime = createEventRuntime({ schemaManifest, unitOfWork, scheduler, governor, failureEvidenceStore:settings.failureEvidenceStore,onDiagnosticError:settings.onDiagnosticError,
    ...(settings.incidentObserver ? { incidentObserver:settings.incidentObserver } : {}),
    registry: { resolve: () => ({ manifest: { capabilityRef: 'libra.test.observe@1',ownerScope:'libra',resultSchemaRef: 'helix://test/result',evidenceSchemaRef:'helix://test/evidence',
      effectClass: settings.effectClass || 'pure_observation', approvalRequirementRef: settings.approvalRequirementRef },
      executor: { version: 1, cooperativeAbortSafe:settings.cooperativeAbortSafe===true } }) }, dispatcher,
    contractValidator:settings.contractValidator||{validate:(_schemaRef,value)=>value},
    ...(settings.effectJournal === false ? {} : { effectJournal: {
      intend(request) { journalCalls.push('intend'); journalEffect = { effect_id: request.eventAttemptId,
        state: settings.effectIntentState || 'intended', event_attempt_id: settings.effectIntentAttemptId || request.eventAttemptId,
        effect_class: request.effectClass, idempotency_key: request.idempotencyKey, intent_digest: request.intentDigest };
        return journalEffect; },
      read(effectId) { journalCalls.push('read'); return settings.effectJournalRead
        ? { ...settings.effectJournalRead, effect_id: effectId || settings.effectJournalRead.effect_id }
        : (journalEffect?.effect_id === effectId ? journalEffect : null); },
      beginRecoveryExecution(effectId) { journalCalls.push('begin-recovery'); return {
        ...settings.effectJournalRead, effect_id:effectId,
        verified_at_ms:settings.recoveryStartedAtMs ?? 1000,
      }; },
      async settle() { journalCalls.push('settle'); },
      noteExternalPending() { journalCalls.push('external-receipt'); },
      requireReconcile(effectId) { journalCalls.push('reconcile');
        const current = settings.effectJournalRead
          ? { ...settings.effectJournalRead, effect_id:effectId || settings.effectJournalRead.effect_id }
          : journalEffect;
        if (!current || current.effect_id !== effectId) return null;
        journalEffect = { ...current, state:'reconcile_required' };
        return journalEffect; },
      abandonUncommitted() { journalCalls.push('abandon'); }
    } }),
    effectReconciler:settings.effectReconciler||{async reconcile(effectClass,{effect}){
      return {decision:'safe_retry',action:effectClass === 'workspace_write'
        ? 'rebuild_workspace_output':'submit_once_after_proven_absent',evidenceDigest:HASH_B,effectState:effect.state};
    }},
    attemptPolicy: settings.attemptPolicy || {
      bindingFor: () => ({ retryPolicyRef: 'helix://foundation/retry-policies/pure_observation/v1',
        timeoutPolicyRef: 'helix://foundation/timeout-policies/test/v1' }),
      prepare: (request) => { settings.onAttemptPrepare?.(request);return { deadlineAtMs: 2000 }; },
      decideFailure: (request) => settings.failurePolicyDecision || ({ decision: settings.effectClass && settings.effectClass !== 'pure_observation' && request.recoveryDecision !== 'safe_retry'
        ? 'reconcile_required' : 'terminal_failure' }),
      decideDeferred: () => settings.deferredPolicyDecision || ({ decision: 'observe', retryAtMs: 1700000031700 })
    },
    timeoutController: settings.timeoutController || { async execute(request) {
      if (settings.timeout) throw Object.assign(new Error('timeout'), { code: 'P4_EXECUTION_TIMEOUT' });
      return request.operation();
    } },
    circuitBreaker: { allows: () => settings.circuitDecision || ({ allowed: true, reason: 'closed' }) },
    executionInputProvider: { prepare: () => {
      if (settings.inputError) throw settings.inputError;
      return ({ ownerScope: { domain: 'libra', processType: 'libra_run', processId: 'run', objectRefs: [] },
      basisRefs: [{ basisType: 'execution_basis', basisId: 'basis', revision: 1, digest: HASH_A }], namedInputs: settings.namedInputs || {},
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
    nextExecutionId: () => 'execution', nextResultId: () => 'result', now: () => settings.nowMs ?? 1000 });
  const cleanup = () => { kernel.close(); fs.rmSync(root, { recursive: true, force: true }); };
  try {
    const result = run({ runtime, lease, databasePath, unitOfWork, state: () => ({ schedulerReleased,
      governorReleased, recoveryAcquireCount, dispatchContext, journalCalls, dispatchOutcomes }) });
    if (result && typeof result.then === 'function') return result.finally(cleanup);
    cleanup(); return result;
  } catch (error) { cleanup(); throw error; }
}

test('known resource wait avoids input preparation without creating an Attempt or holding a scheduler lease', async () => {
  await fixture(async ({ runtime, lease, databasePath, state }) => {
    const outcome = await runtime.run({ schedulerLease:lease });
    assert.equal(outcome.kind, 'waiting');
    assert.equal(databaseFacts(databasePath).attempts, 0);
    assert.equal(databaseFacts(databasePath).event.state, 'waiting_for_resource');
    assert.equal(state().schedulerReleased, 1);
    assert.deepEqual(state().dispatchOutcomes, ['resource_wait']);
    assert.equal(state().dispatchContext, undefined);
  }, { initialEventState:'waiting_for_resource',
    preparationWait:{ kind:'waiting', eventId:'event', replayed:true, retryAtMs:6000 },
    inputError:new Error('blocked preparation must not project inputs') });
});

test('resource wait without a current hint still prepares fresh inputs and executes', async () => {
  await fixture(async ({ runtime, lease, databasePath }) => {
    await runtime.run({ schedulerLease:lease });
    assert.equal(databaseFacts(databasePath).event.state, 'succeeded');
    assert.equal(databaseFacts(databasePath).attempts, 1);
  }, { initialEventState:'waiting_for_resource' });
});

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

test('Host scan and synchronous input failure callback aggregate one real Attempt and settle its Owner once', async () => {
  await fixture(async ({ runtime, lease, databasePath, unitOfWork, state }) => {
    const lifecycle = createWorkLifecycle({ schemaManifest, unitOfWork, nextWorkAttemptId: () => assert.fail('unexpected replan') });
    const errors = [], aggregations = [], phases = [];
    let available = true;
    let finish;
    const finished = new Promise((resolve) => { finish = resolve; });
    const host = createExecutionRuntimeHost({ tickIntervalMs: 60000,
      startupRecovery: { async recover() { return { state: 'ready', normalSupplyAllowed: true }; } },
      scheduler: { acquire({ targetType }) {
        if (targetType !== 'event' || !available) return { kind: 'idle' };
        available = false; return { kind: 'leased', lease };
      }, release() {} },
      plannerRegistry: { resolve() { assert.fail('unexpected planning'); } }, planPublisher: { publish() {} },
      workLifecycle: { ...lifecycle, aggregateEvent(eventId) {
        const result = lifecycle.aggregateEvent(eventId);
        aggregations.push(result); return result;
      } },
      eventRuntime: runtime,
      domainReconciler: { async reconcile(request) {
        phases.push(request.reconcilePhase);
        if (request.reconcilePhase === 'attempt_terminal') {
          assert.equal(request.workAttemptFailureCode, 'PHYSICAL_MATERIAL_FINGERPRINT_IO_FAILED');
          await new Promise((resolve) => setImmediate(resolve));
          return { workId: request.workId, disposition: 'failed' };
        }
        finish(); return null;
      } },
      fallbackReconciler: { async start() {}, async stop() {} }, onError(error) { errors.push(error.code); },
    });
    try {
      await host.start();
      await finished;
    } finally { await host.stop(); }
    assert.deepEqual(errors, ['PHYSICAL_MATERIAL_FINGERPRINT_IO_FAILED']);
    assert.deepEqual(aggregations.map((item) => [item.replayed, item.work.state, item.attemptState]),
      [[false, 'running', 'failed'], [true, 'running', 'failed']]);
    assert.deepEqual(phases, ['attempt_terminal', 'work_terminal']);
    assert.equal(databaseFacts(databasePath).attempt.failure_code, 'PHYSICAL_MATERIAL_FINGERPRINT_IO_FAILED');
    assert.equal(state().dispatchContext, undefined);
    const database = new Database(databasePath, { readonly: true });
    try {
      assert.equal(database.prepare('SELECT state FROM fx_supporting_works').get().state, 'failed');
      assert.equal(database.prepare('SELECT COUNT(*) n FROM fx_work_attempts').get().n, 1);
    } finally { database.close(); }
  }, { inputError: Object.assign(new Error('Physical Material fingerprint I/O failed.'),
    { code: 'PHYSICAL_MATERIAL_FINGERPRINT_IO_FAILED' }) });
});

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
  const result={value:1},resultDigest=require('node:crypto').createHash('sha256').update(JSON.stringify(result)).digest('hex'),
    effectReceipt={schemaRef:'helix://contracts/types/EffectReceipt/v1',schemaVersion:1,effectReceiptId:'atomic-receipt',
      effectId:'event-attempt',effectClass:'domain_fact_commit',idempotencyKey:'event-attempt',commitMarker:'atomic-marker',
      externalReceiptRef:null,outputDigest:resultDigest,verificationEvidenceDigest:resultDigest,committedAtMs:1000};
  await fixture(async ({ runtime, lease, databasePath }) => {
    const completed = await runtime.run({ schedulerLease: lease });
    assert.equal(completed.resultId, 'atomic-result');
    assert.equal(databaseFacts(databasePath).results, 1);
  }, { prebindResult:true,effectClass:'domain_fact_commit',outcome:{kind:'succeeded',resultSchemaRef:'helix://test/result',result,
    evidenceSchemaRef:'helix://test/evidence',evidence:{proof:true},effectReceipt} });
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
    assert.deepEqual(state().dispatchOutcomes, ['circuit_wait']);
    assert.equal(state().governorReleased, 0); assert.deepEqual(state().journalCalls, []);
    const database = new Database(databasePath, { readonly: true });
    try { assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_event_attempts').get().count, 0); }
    finally { database.close(); }
  }, { effectClass: 'domain_fact_commit', circuitDecision: { allowed: false, reason: 'circuit_blocks_new_effect' } });
});

test('Foundation Incident gate receives the exact frozen Work scope and typed Resource demand before Permit', async () => {
  const requests=[];
  await fixture(async ({ runtime, lease, databasePath, state }) => {
    assert.equal((await runtime.run({ schedulerLease:lease })).kind,'circuit_deferred');
    assert.deepEqual(state().dispatchOutcomes,['circuit_wait']);
    assert.deepEqual(requests,[{ownerDomain:'libra',processType:'libra_run',workKind:'test_work',workId:'work',resourceKeys:['cpu_heavy']}]);
    assert.equal(state().governorReleased,0);
    const database=new Database(databasePath,{readonly:true});
    try{assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_event_attempts').get().count,0);}
    finally{database.close();}
  },{incidentObserver:{prepareExecution(request){requests.push(request);return {allowed:false,reason:'resource_recovery_in_progress'};}}});
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

test('scheduler dispatch feedback failure releases an already granted Resource Permit exactly once', async () => {
  await fixture(async ({ runtime, lease, state }) => {
    await assert.rejects(runtime.run({ schedulerLease: lease }), /dispatch feedback failed/);
    assert.deepEqual(
      { schedulerReleased: state().schedulerReleased, governorReleased: state().governorReleased },
      { schedulerReleased: 1, governorReleased: 1 },
    );
  }, { dispatchOutcomeError: new Error('dispatch feedback failed') });
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

test('non-pure Executor crash enters exact online Effect recovery while releasing in-memory guards', async () => {
  await fixture(async ({ runtime, lease, databasePath, state }) => {
    const outcome = await runtime.run({ schedulerLease: lease });
    assert.deepEqual(outcome, {kind:'effect_recovery_required',eventId:'event',effectId:'event-attempt',
      failureCode:'EXECUTOR_ERROR',failureMessage:'executor crash'});
    const facts = databaseFacts(databasePath);
    assert.equal(facts.event.state, 'executing'); assert.equal(facts.attempt.state, 'executing'); assert.equal(facts.results, 0);
    const action=await runtime.classifyRecovery({eventId:'event',effectId:'event-attempt'});
    assert.deepEqual(action,{eventId:'event',effectId:'event-attempt',decision:'safe_retry',
      action:'submit_once_after_proven_absent',evidenceDigest:HASH_B,effectState:'reconcile_required'});
    assert.deepEqual(state().journalCalls,['intend','reconcile','reconcile']);
    assert.deepEqual({ schedulerReleased: state().schedulerReleased, governorReleased: state().governorReleased }, { schedulerReleased: 1, governorReleased: 1 });
  }, { effectClass:'external_request', dispatchError: new Error('executor crash') });
});

test('abort-safe non-pure recovery hard-closes after its one durable recovery deadline', async () => {
  const timers=manualTimers(1000);
  const timeoutController=createTimeoutController({now:timers.now,isolation:createCooperativeExecutionIsolation({
    now:timers.now,setTimeout:timers.setTimeout,clearTimeout:timers.clearTimeout,settlementGraceMs:10})});
  await fixture(async({runtime,databasePath,state})=>{
    const recovery=runtime.recover({eventId:'event',effectId:'effect',decision:'safe_retry'});
    await new Promise((resolve)=>setImmediate(resolve));
    assert.equal(timers.pending()>0,true);
    timers.advanceBy(1000);await new Promise((resolve)=>setImmediate(resolve));
    timers.advanceBy(10);
    const completed=await recovery;
    assert.equal(completed.eventState,'failed');
    assert.deepEqual(databaseFacts(databasePath),{event:{state:'failed',retry_at_ms:null,result_id:null},
      attempt:{state:'completed',outcome_kind:'failed',retry_after_ms:null,failure_class:'integration',
        failure_code:'COOPERATIVE_EXECUTION_DEADLINE_EXCEEDED'},attempts:1,results:0});
    assert.deepEqual(state().journalCalls,['read','begin-recovery','abandon']);
  },{effectClass:'domain_fact_commit',initialEventState:'executing',seedExecutingAttempt:true,
    cooperativeAbortSafe:true,timeoutController,dispatchError:null,
    recoveryStartedAtMs:1000,
    onAttemptPrepare:(request)=>assert.equal(request.startedAtMs,1000),
    outcome:new Promise(()=>{}),effectJournalRead:{event_attempt_id:'event-attempt',effect_class:'domain_fact_commit',
      idempotency_key:'event-attempt',intent_digest:require('node:crypto').createHash('sha256').update(JSON.stringify({
        capabilityRef:'libra.test.observe@1',contractVersion:1,eventId:'event',fenceSnapshotDigest:HASH_A,
        inputSnapshotDigest:EMPTY_INPUT_DIGEST})).digest('hex'),state:'intended'},
    failurePolicyDecision:{decision:'terminal_failure'}});
});

test('expired Attempt deadline does not prevent classified continue-forward Effect recovery', async () => {
  await fixture(async ({ runtime, databasePath, state }) => {
    const recovered = await runtime.recover({
      eventId:'event', effectId:'effect', decision:'continue_forward',
    });
    assert.equal(recovered.kind, 'succeeded');
    assert.equal(databaseFacts(databasePath).event.state, 'succeeded');
    assert.equal(state().dispatchContext.eventAttemptId, 'event-attempt');
    assert.equal(state().dispatchContext.deadlineAtMs, 2000);
    assert.equal(state().dispatchContext.effectOccurredAtMs, 1);
    assert.equal(state().dispatchContext.recoveryDecision, 'continue_forward');
    assert.deepEqual(state().journalCalls, ['read', 'begin-recovery', 'settle']);
  }, {
    effectClass:'material_commit', initialEventState:'executing', seedExecutingAttempt:true,
    recoveryStartedAtMs:1000,
    onAttemptPrepare:(request)=>assert.equal(request.startedAtMs, 1000),
    timeoutController:{ async execute(request) {
      assert.equal(request.deadlineAtMs, 2000);
      return request.operation();
    } },
    effectJournalRead:{ event_attempt_id:'event-attempt', effect_class:'material_commit',
      idempotency_key:'event-attempt', intent_digest:require('node:crypto').createHash('sha256').update(JSON.stringify({
        capabilityRef:'libra.test.observe@1', contractVersion:1, eventId:'event', fenceSnapshotDigest:HASH_A,
        inputSnapshotDigest:EMPTY_INPUT_DIGEST,
      })).digest('hex'), state:'intended' },
  });
});

test('expired Attempt deadline does not prevent classified safe-retry Effect recovery', async () => {
  await fixture(async ({ runtime, databasePath, state }) => {
    const recovered = await runtime.recover({
      eventId:'event', effectId:'effect', decision:'safe_retry',
    });
    assert.equal(recovered.kind, 'succeeded');
    assert.equal(databaseFacts(databasePath).event.state, 'succeeded');
    assert.equal(state().dispatchContext.eventAttemptId, 'event-attempt');
    assert.equal(state().dispatchContext.deadlineAtMs, 2000);
    assert.equal(state().dispatchContext.effectOccurredAtMs, 1);
    assert.equal(state().dispatchContext.recoveryDecision, 'safe_retry');
    assert.deepEqual(state().journalCalls, ['read', 'begin-recovery', 'settle']);
  }, {
    effectClass:'workspace_write', initialEventState:'executing', seedExecutingAttempt:true,
    recoveryStartedAtMs:1000,
    onAttemptPrepare:(request)=>assert.equal(request.startedAtMs, 1000),
    timeoutController:{ async execute(request) {
      assert.equal(request.deadlineAtMs, 2000);
      return request.operation();
    } },
    effectJournalRead:{ event_attempt_id:'event-attempt', effect_class:'workspace_write',
      idempotency_key:'event-attempt', intent_digest:require('node:crypto').createHash('sha256').update(JSON.stringify({
        capabilityRef:'libra.test.observe@1', contractVersion:1, eventId:'event', fenceSnapshotDigest:HASH_A,
        inputSnapshotDigest:EMPTY_INPUT_DIGEST,
      })).digest('hex'), state:'intended' },
  });
});

test('expired safe-retry recovery budget fail-closes before non-pure dispatch', async () => {
  let dispatched=false;let isolated=0;
  const timeoutController=createTimeoutController({now:()=>3000,isolation:{
    async run({operation}){dispatched=true;return operation();},
    async terminateAndIsolate(){isolated+=1;},
  }});
  await fixture(async ({ runtime, databasePath, state }) => {
    const recovered=await runtime.recover({eventId:'event',effectId:'effect',decision:'safe_retry'});
    assert.equal(recovered.kind,'failed');
    assert.equal(recovered.eventState,'failed');
    assert.equal(dispatched,false);
    assert.equal(isolated,1);
    assert.deepEqual(databaseFacts(databasePath),{event:{state:'failed',retry_at_ms:null,result_id:null},
      attempt:{state:'completed',outcome_kind:'failed',retry_after_ms:null,failure_class:'integration',
        failure_code:'RECOVERY_EXECUTION_BUDGET_EXHAUSTED'},attempts:1,results:0});
    assert.deepEqual(state().journalCalls,['read','begin-recovery','abandon']);
  },{effectClass:'workspace_write',initialEventState:'executing',seedExecutingAttempt:true,
    recoveryStartedAtMs:1000,nowMs:3000,timeoutController,
    failurePolicyDecision:{decision:'terminal_failure'},effectJournalRead:{
      event_attempt_id:'event-attempt',effect_class:'workspace_write',idempotency_key:'event-attempt',
      intent_digest:require('node:crypto').createHash('sha256').update(JSON.stringify({
        capabilityRef:'libra.test.observe@1',contractVersion:1,eventId:'event',fenceSnapshotDigest:HASH_A,
        inputSnapshotDigest:EMPTY_INPUT_DIGEST})).digest('hex'),state:'intended'},
  });
});

test('expired continue-forward recovery budget never abandons uncertain Effect reality', async () => {
  let isolated=0;
  const timeoutController=createTimeoutController({now:()=>3000,isolation:{
    async run(){throw new Error('expired recovery must not dispatch');},
    async terminateAndIsolate(){isolated+=1;},
  }});
  await fixture(async ({ runtime, databasePath, state }) => {
    const result = await runtime.recover({eventId:'event',effectId:'effect',decision:'continue_forward'});
    assert.equal(result.kind,'failed');
    assert.equal(isolated,1);
    assert.equal(databaseFacts(databasePath).event.state,'failed');
    assert.equal(databaseFacts(databasePath).attempt.failure_code,'RECOVERY_EXECUTION_BUDGET_EXHAUSTED');
    assert.deepEqual(state().journalCalls,['read','begin-recovery','reconcile']);
  },{effectClass:'workspace_write',initialEventState:'executing',seedExecutingAttempt:true,
    failurePolicyDecision:{decision:'terminal_failure'},recoveryStartedAtMs:1000,nowMs:3000,timeoutController,effectJournalRead:{
      event_attempt_id:'event-attempt',effect_class:'workspace_write',idempotency_key:'event-attempt',
      intent_digest:require('node:crypto').createHash('sha256').update(JSON.stringify({
        capabilityRef:'libra.test.observe@1',contractVersion:1,eventId:'event',fenceSnapshotDigest:HASH_A,
        inputSnapshotDigest:EMPTY_INPUT_DIGEST})).digest('hex'),state:'intended'},
  });
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

test('UAT-251 typed workspace admission rejection completes recovery and releases Case cancellation', async () => {
  await fixture(async ({runtime,databasePath,unitOfWork,state})=>{
    const classified=await runtime.classifyRecovery({eventId:'event',effectId:'effect'});
    assert.equal(classified.decision,'safe_retry');
    const result=await runtime.recover({eventId:'event',effectId:'effect',decision:classified.decision});
    assert.equal(result.eventState,'failed');
    assert.equal(databaseFacts(databasePath).attempt.failure_code,'ARCA_AFTERCARE_MANUAL_DEFECT_INTENT_REQUIRED');
    assert.equal(databaseFacts(databasePath).results,0);
    assert.equal(state().journalCalls.includes('abandon'),true);
    assert.equal(state().journalCalls.includes('settle'),false);
    const lifecycle=createWorkLifecycle({schemaManifest,unitOfWork,nextWorkAttemptId:()=>assert.fail('no repair retry')});
    const cancelled=lifecycle.cancelProcess({ownerDomain:'libra',processType:'libra_run',processId:'run',
      reasonCode:'ARCA_AFTERCARE_MANUAL_DEFECT_INTENT_REQUIRED'});
    assert.equal(cancelled.drainingWorks,0);
    assert.equal(cancelled.cancelledWorks,1);
  },{effectClass:'workspace_write',initialEventState:'executing',seedExecutingAttempt:true,
    failurePolicyDecision:{decision:'reconcile_required'},
    outcome:{kind:'failed',failureClass:'executor',code:'ARCA_AFTERCARE_MANUAL_DEFECT_INTENT_REQUIRED',
      message:'Accepted defects require an explicit manual repair intent.',retryDirective:'never',
      evidence:{stage:'before_workspace_write',recoveryDecision:'safe_retry'}},
    effectJournalRead:{event_attempt_id:'event-attempt',effect_class:'workspace_write',idempotency_key:'event-attempt',
      intent_digest:require('node:crypto').createHash('sha256').update(JSON.stringify({capabilityRef:'libra.test.observe@1',
        contractVersion:1,eventId:'event',fenceSnapshotDigest:HASH_A,inputSnapshotDigest:EMPTY_INPUT_DIGEST})).digest('hex'),
      state:'reconcile_required'},
  });
});

test('recovery before intent also terminates an abandoned no-retry Workspace attempt',async()=>{
  await fixture(async({runtime,databasePath,state})=>{
    const result=await runtime.recover({eventId:'event',decision:'safe_retry_before_intent'});
    assert.equal(result.eventState,'failed');
    assert.equal(databaseFacts(databasePath).attempt.state,'completed');
    assert.equal(databaseFacts(databasePath).results,0);
    assert.deepEqual(state().journalCalls,['intend','abandon']);
  },{effectClass:'workspace_write',initialEventState:'executing',seedExecutingAttempt:true,
    outcome:{kind:'failed',failureClass:'executor',code:'WORKSPACE_ADMISSION_REJECTED',
      message:'Workspace admission is no longer valid.',retryDirective:'never',evidence:{stage:'before_workspace_write'}}});
});

test('non-pure Capability failed Outcome completes the Attempt and abandons the uncommitted Effect', async () => {
  await fixture(async ({ runtime, lease, databasePath, state }) => {
    const result = await runtime.run({ schedulerLease: lease });
    assert.equal(result.kind, 'failed');
    assert.equal(result.eventState, 'failed');
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

function boundedWorkspaceFailurePolicy() {
  return createAttemptPolicyController({ now:() => 1000, registry:{
    bindingFor:() => ({ retryPolicyRef:'helix://foundation/retry-policies/pure_observation/v1',
      timeoutPolicyRef:'helix://foundation/timeout-policies/test/v1' }),
    retryFor:() => ({ maxFailureAttempts:2, backoffMs:[250], retryableFailureClasses:['integration'] }),
    timeoutFor:() => ({ timeoutMs:1000 }),
  } });
}

test('abandoned Workspace failure preserves backoff and exhausts the real retry policy', async () => {
  for (const priorFailures of [0, 1]) {
    await fixture(async ({ runtime, lease, databasePath, state }) => {
      const result = await runtime.run({ schedulerLease:lease });
      assert.equal(result.eventState, priorFailures === 0 ? 'ready' : 'failed');
      assert.equal(result.retryAtMs, priorFailures === 0 ? 1250 : null);
      assert.equal(databaseFacts(databasePath).attempts, priorFailures + 1);
      assert.deepEqual(state().journalCalls, ['intend', 'abandon']);
    }, { effectClass:'workspace_write', seedFailureAttempts:priorFailures,
      attemptPolicy:boundedWorkspaceFailurePolicy(), outcome:{
        kind:'failed', failureClass:'integration', code:'FIXTURE_NETWORK_FAILED',
        message:'Transport failed before publishing an output.', retryDirective:'contract_policy', evidence:{},
      } });
  }
});

test('FFmpeg executor failure terminates under the real policy instead of becoming an external wait', async () => {
  await fixture(async ({ runtime, lease, databasePath }) => {
    const result = await runtime.run({ schedulerLease:lease });
    assert.equal(result.eventState, 'failed');
    assert.equal(databaseFacts(databasePath).attempt.failure_code, 'LIBRA_MEDIA_FFMPEG_FAILED');
    await assert.rejects(() => runtime.run({ schedulerLease:lease }), { code:'P4_EVENT_NOT_READY' });
    assert.equal(databaseFacts(databasePath).attempts, 1);
  }, { effectClass:'workspace_write', attemptPolicy:boundedWorkspaceFailurePolicy(), outcome:{
    kind:'failed', failureClass:'executor', code:'LIBRA_MEDIA_FFMPEG_FAILED',
    message:'Video dimensions are unavailable.', retryDirective:'contract_policy', evidence:{},
  } });
});

test('recovery before intent applies the same bounded policy to a retired Workspace Effect', async () => {
  await fixture(async ({ runtime, databasePath, state }) => {
    const result = await runtime.recover({ eventId:'event', decision:'safe_retry_before_intent' });
    assert.equal(result.eventState, 'failed');
    assert.equal(databaseFacts(databasePath).attempt.state, 'completed');
    assert.deepEqual(state().journalCalls, ['intend', 'abandon']);
  }, { effectClass:'workspace_write', initialEventState:'executing', seedExecutingAttempt:true,
    attemptPolicy:boundedWorkspaceFailurePolicy(), outcome:{
      kind:'failed', failureClass:'executor', code:'LIBRA_MEDIA_FFMPEG_FAILED',
      message:'Video dimensions are unavailable.', retryDirective:'contract_policy', evidence:{},
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

test('already-committed recovery completes from the atomic pre-bound Result without reprojecting inputs', async () => {
  await fixture(async ({runtime,databasePath,state})=>{
    const result=await runtime.recover({eventId:'event',effectId:'effect',decision:'already_committed'});
    assert.equal(result.kind,'succeeded');
    assert.equal(result.resultId,'atomic-result');
    assert.deepEqual(databaseFacts(databasePath),{event:{state:'succeeded',retry_at_ms:null,result_id:'atomic-result'},
      attempt:{state:'completed',outcome_kind:'succeeded',retry_after_ms:null,failure_class:null,failure_code:null},attempts:1,results:1});
    assert.equal(state().dispatchContext,undefined);
    assert.equal(state().governorReleased,0);
    assert.deepEqual(state().journalCalls,['read','settle']);
  },{effectClass:'responsibility_control_commit',initialEventState:'executing',seedExecutingAttempt:true,
    seedPreboundRecovery:true,inputError:new Error('mutable owner projection must not be recomputed'),
    effectJournalRead:{event_attempt_id:'event-attempt',effect_class:'responsibility_control_commit',state:'intended',
      idempotency_key:'event-attempt',external_receipt_ref:null}});
});

test('already-settled effect recovery completes the Event from the same atomic Result chain', async () => {
  await fixture(async ({runtime,databasePath,state})=>{
    const result=await runtime.recover({eventId:'event',effectId:'effect',decision:'already_committed'});
    assert.equal(result.kind,'succeeded');
    assert.equal(result.resultId,'atomic-result');
    assert.equal(databaseFacts(databasePath).event.state,'succeeded');
    assert.equal(state().dispatchContext,undefined);
    assert.deepEqual(state().journalCalls,['read','settle']);
  },{effectClass:'responsibility_control_commit',initialEventState:'executing',seedExecutingAttempt:true,
    seedPreboundRecovery:true,inputError:new Error('settled effect recovery must not reproject mutable inputs'),
    effectJournalRead:{event_attempt_id:'event-attempt',effect_class:'responsibility_control_commit',state:'committed',
      idempotency_key:'event-attempt',external_receipt_ref:null}});
});

test('atomic recovery keeps output and verified business reality digests independent', async () => {
  await fixture(async ({runtime,databasePath,state})=>{
    const result=await runtime.recover({eventId:'event',effectId:'effect',decision:'already_committed'});
    assert.equal(result.resultId,'atomic-result');
    assert.equal(databaseFacts(databasePath).event.state,'succeeded');
    assert.deepEqual(state().journalCalls,['read','settle']);
  },{effectClass:'responsibility_control_commit',initialEventState:'executing',seedExecutingAttempt:true,
    seedPreboundRecovery:true,preboundCommitDigest:HASH_A,
    effectJournalRead:{event_attempt_id:'event-attempt',effect_class:'responsibility_control_commit',state:'intended',
      idempotency_key:'event-attempt',external_receipt_ref:null}});
});

test('legacy typed atomic Result keeps the existing capability replay recovery path', async () => {
  const result={effectReceiptRef:'atomic-receipt',ownerDomain:'libra',schemaRef:'helix://test/type',scopeId:'run',scopeType:'libra_run',value:1},
    hash=(value)=>require('node:crypto').createHash('sha256').update(value).digest('hex'),resultDigest=hash(JSON.stringify(result)),
    intentDigest=hash(JSON.stringify({capabilityRef:'libra.test.observe@1',contractVersion:1,eventId:'event',
      fenceSnapshotDigest:HASH_A,inputSnapshotDigest:EMPTY_INPUT_DIGEST})),effectReceipt={
      schemaRef:'helix://contracts/types/EffectReceipt/v1',schemaVersion:1,effectReceiptId:'atomic-receipt',effectId:'effect',
      effectClass:'responsibility_control_commit',idempotencyKey:'event-attempt',commitMarker:'atomic-marker',externalReceiptRef:null,
      outputDigest:resultDigest,verificationEvidenceDigest:HASH_A,committedAtMs:1000};
  await fixture(async ({runtime,databasePath,state})=>{
    const recovered=await runtime.recover({eventId:'event',effectId:'effect',decision:'already_committed'});
    assert.equal(recovered.resultId,'atomic-result');
    assert.equal(databaseFacts(databasePath).event.state,'succeeded');
    assert.notEqual(state().dispatchContext,undefined);
    assert.deepEqual(state().journalCalls,['read','settle']);
  },{effectClass:'responsibility_control_commit',initialEventState:'executing',seedExecutingAttempt:true,
    seedPreboundRecovery:true,preboundResult:result,preboundResultSchemaRef:'helix://test/type',preboundCommitDigest:HASH_A,
    outcome:{kind:'succeeded',resultSchemaRef:'helix://test/result',result,evidenceSchemaRef:'helix://test/evidence',
      evidence:{proof:true},effectReceipt},effectJournalRead:{event_attempt_id:'event-attempt',
      effect_class:'responsibility_control_commit',state:'committed',idempotency_key:'event-attempt',
      intent_digest:intentDigest,external_receipt_ref:null}});
});

test('exact atomic recovery rejects marker scope or Effect Receipt reference drift', async () => {
  const settings={effectClass:'responsibility_control_commit',initialEventState:'executing',seedExecutingAttempt:true,
    seedPreboundRecovery:true,effectJournalRead:{event_attempt_id:'event-attempt',effect_class:'responsibility_control_commit',
      state:'intended',idempotency_key:'event-attempt',external_receipt_ref:null}};
  await fixture(async ({runtime})=>{
    await assert.rejects(runtime.recover({eventId:'event',effectId:'effect',decision:'already_committed'}),
      (error)=>error.code==='P4_EVENT_PREBOUND_RESULT_CORRUPT');
  },{...settings,preboundMarkerScopeType:'other_scope'});
  await fixture(async ({runtime})=>{
    await assert.rejects(runtime.recover({eventId:'event',effectId:'effect',decision:'already_committed'}),
      (error)=>error.code==='P4_EVENT_PREBOUND_RESULT_CORRUPT');
  },{...settings,preboundResult:{effectReceiptRef:'other-receipt',ownerDomain:'libra',scopeId:'run',scopeType:'libra_run',value:1}});
});

test('already-committed recovery rejects an orphan Result without the exact Effect Marker', async () => {
  await fixture(async ({runtime,databasePath,state})=>{
    await assert.rejects(runtime.recover({eventId:'event',effectId:'effect',decision:'already_committed'}),
      (error)=>error.code==='P4_EVENT_PREBOUND_RESULT_CORRUPT');
    assert.equal(databaseFacts(databasePath).event.state,'executing');
    assert.deepEqual(state().journalCalls,['read']);
  },{effectClass:'responsibility_control_commit',initialEventState:'executing',seedExecutingAttempt:true,
    seedPreboundRecovery:true,seedPreboundMarker:false,
    effectJournalRead:{event_attempt_id:'event-attempt',effect_class:'responsibility_control_commit',state:'intended',
      idempotency_key:'event-attempt',external_receipt_ref:null}});
});

test('already-committed recovery rejects self-consistent JSON that violates the frozen Result schema', async () => {
  const invalid=Object.assign(new Error('invalid typed result'),{code:'P4_CAPABILITY_SCHEMA_REJECTED'});
  await fixture(async ({runtime,databasePath,state})=>{
    await assert.rejects(runtime.recover({eventId:'event',effectId:'effect',decision:'already_committed'}),invalid);
    assert.equal(databaseFacts(databasePath).event.state,'executing');
    assert.deepEqual(state().journalCalls,['read']);
  },{effectClass:'responsibility_control_commit',initialEventState:'executing',seedExecutingAttempt:true,
    seedPreboundRecovery:true,contractValidator:{validate:(schemaRef,value)=>{if(schemaRef==='helix://test/result')throw invalid;return value;}},
    effectJournalRead:{event_attempt_id:'event-attempt',effect_class:'responsibility_control_commit',state:'intended',
      idempotency_key:'event-attempt',external_receipt_ref:null}});
});

test('startup recovery records a non-pure failed Outcome instead of looping as not converged', async () => {
  await fixture(async ({ runtime, databasePath, state }) => {
    const result = await runtime.recover({ eventId:'event', decision:'safe_retry_before_intent' });
    assert.equal(result.kind, 'failed');
    const facts = databaseFacts(databasePath);
    assert.equal(facts.attempt.state, 'completed');
    assert.equal(facts.attempt.failure_code, 'LIBRA_MEDIA_FFMPEG_FAILED');
    assert.equal(state().governorReleased, 1);
    assert.equal(state().recoveryAcquireCount, 1);
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

test('startup recovery exposes the exact persisted progress floor only as runtime context', async () => {
  await fixture(async ({runtime,databasePath,state})=>{
    const database=new Database(databasePath);
    try {
      database.prepare(`INSERT INTO fx_event_progress
        (event_id,event_attempt_id,revision,mode,current_value,total_value,unit,rate,eta_ms,source_sequence,progress_bucket,sampled_at_ms)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('event','event-attempt',1,'determinate',42,100,'percent',2,29000,'persisted-42','percent-42',900);
      database.prepare('UPDATE fx_workflow_events SET current_progress_revision=1 WHERE event_id=?').run('event');
    } finally { database.close(); }
    await runtime.recover({eventId:'event',decision:'safe_retry'});
    assert.deepEqual(state().dispatchContext.progressFloor,{
      revision:1,mode:'determinate',currentValue:42,totalValue:100,unit:'percent',rate:2,etaMs:29000,
      sourceSequence:'persisted-42',progressBucket:'percent-42',sampledAtMs:900,
    });
    assert.equal(Object.keys(state().dispatchContext).includes('progressFloor'),false);
  },{initialEventState:'executing',seedExecutingAttempt:true});
});

test('ordinary retry exposes the prior Event Attempt progress floor without resetting it', async () => {
  await fixture(async ({runtime,lease,state}) => {
    await runtime.run({ schedulerLease:lease });
    assert.deepEqual(state().dispatchContext.progressFloor, {
      revision:1, mode:'determinate', currentValue:63, totalValue:100, unit:'percent', rate:8.58, etaMs:241155,
      sourceSequence:'attempt-1-63', progressBucket:'percent-63', sampledAtMs:900,
    });
    assert.equal(state().dispatchContext.eventAttemptId, 'event-attempt-2');
    assert.equal(Object.keys(state().dispatchContext).includes('progressFloor'), false);
  }, { initialEventState:'waiting_for_external', seedDeferredAttempt:true, seedPriorProgress:true });
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


test('terminal failure retains digest-bound diagnostics across evidence store restart', async () => {
  const {createFailureEvidenceStore}=require('../../src/helix/integrations/failure-evidence-store');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'failure-evidence-'));
  const evidence={errorCode:'CLEAN_ARCA_SETTLEMENT_UNKNOWN_MEMBER',diagnostics:{sourceDirectory:'/media/movie',unknownNames:['other.mkv']}};
  try { await fixture(async ({runtime,lease,databasePath,unitOfWork})=>{
    await runtime.run({schedulerLease:lease});
    const db=new Database(databasePath,{readonly:true});
    try { const row=db.prepare('SELECT evidence_digest FROM fx_event_attempts').get();
      assert.deepEqual(createFailureEvidenceStore(root).read(row.evidence_digest),evidence);
      const {createWorkResultReader}=require('../../src/helix/foundation/execution/work-result-reader');
      const reader=createWorkResultReader({schemaManifest,unitOfWork,failureEvidenceStore:createFailureEvidenceStore(root)});
      const workId=db.prepare('SELECT work_id FROM fx_workflow_events').get().work_id;
      assert.deepEqual(reader.readFailures(workId)[0].diagnostics,evidence.diagnostics);
      fs.writeFileSync(path.join(root,row.evidence_digest+'.json'),'{}');
      assert.equal(reader.readFailures(workId)[0].diagnosticsUnavailable,true);
      assert.equal(databaseFacts(databasePath).event.state,'failed');
    } finally {db.close();}
  },{failureEvidenceStore:createFailureEvidenceStore(root),outcome:{kind:'failed',failureClass:'settlement_precondition',
    code:evidence.errorCode,message:'Unknown member',retryDirective:'never',evidence}}); }
  finally {fs.rmSync(root,{recursive:true,force:true});}
});

 test('diagnostic storage failure cannot keep a terminal failed Event executing',async()=>{
  const errors=[];await fixture(async({runtime,lease,databasePath})=>{
    await runtime.run({schedulerLease:lease});assert.equal(databaseFacts(databasePath).event.state,'failed');
    assert.equal(errors[0].code,'EXECUTION_FAILURE_DIAGNOSTICS_UNAVAILABLE');
  },{failureEvidenceStore:{write(){throw new Error('disk full');}},onDiagnosticError:e=>errors.push(e),
    outcome:{kind:'failed',failureClass:'settlement_precondition',code:'UNKNOWN_MEMBER',message:'Unknown member',
      retryDirective:'never',evidence:{diagnostics:{unknownNames:['other.mkv']}}}});
});

const { canonicalDigest: recoveryDigest } = require('../../src/helix/contracts/canonical-json');
function absentFactRecoverySettings(extra={}) {
  return { effectClass:'domain_fact_commit', initialEventState:'executing', seedExecutingAttempt:true,
    namedInputs:{ changed:true }, failurePolicyDecision:{decision:'terminal_failure'},
    effectJournalRead:{effect_id:'effect',event_attempt_id:'event-attempt',effect_class:'domain_fact_commit',
      state:'reconcile_required',intent_digest:recoveryDigest({eventId:'event',capabilityRef:'libra.test.observe@1',
        contractVersion:1,inputSnapshotDigest:EMPTY_INPUT_DIGEST,fenceSnapshotDigest:HASH_A})},
    effectReconciler:{async reconcile(){return {decision:'safe_retry',action:'revalidate_and_commit',evidenceDigest:HASH_B};}},
    ...extra };
}
for(const inputError of [null,Object.assign(new Error('stale owner evidence'),{code:'OWNER_BASIS_STALE'})]) {
  test('absent atomic commit input failure ends the original attempt without dispatch: '+Boolean(inputError),async()=>{
    await fixture(async({runtime,databasePath,state})=>{
      const before=databaseFacts(databasePath).attempt.input_snapshot_digest;
      const result=await runtime.recover({eventId:'event',effectId:'effect',decision:'safe_retry'});
      assert.equal(result.kind,'failed');const facts=databaseFacts(databasePath);
      assert.equal(facts.event.state,'failed');assert.equal(facts.attempt.state,'completed');
      assert.equal(facts.attempt.input_snapshot_digest,before);
      assert.equal(facts.attempt.failure_code,inputError?'OWNER_BASIS_STALE':'P4_EVENT_RECOVERY_INPUT_DRIFT');
      assert.equal(state().dispatchContext,undefined);assert.equal(state().recoveryAcquireCount,0);
      assert.equal(state().journalCalls.filter(x=>x==='abandon').length,1);
    },absentFactRecoverySettings({inputError}));
  });
}
for(const classification of ['already_committed','terminal_failure']) {
  test('drift cannot abandon an atomic commit without fresh absence proof: '+classification,async()=>{
    await fixture(async({runtime,state})=>{
      await assert.rejects(runtime.recover({eventId:'event',effectId:'effect',decision:'safe_retry'}),
        e=>e.code==='P4_EVENT_RECOVERY_INPUT_DRIFT');
      assert.equal(state().journalCalls.includes('abandon'),false);
    },absentFactRecoverySettings({effectReconciler:{async reconcile(){return {decision:classification,action:'reuse_commit_marker',evidenceDigest:HASH_B};}}}));
  });
}
test('drift cannot abandon another intent or a file effect',async()=>{
  for(const extra of [{effectJournalRead:{...absentFactRecoverySettings().effectJournalRead,intent_digest:HASH_B}},
    {effectClass:'workspace_write',effectJournalRead:{...absentFactRecoverySettings().effectJournalRead,effect_class:'workspace_write'}}]) {
    await fixture(async({runtime,state})=>{
      await assert.rejects(runtime.recover({eventId:'event',effectId:'effect',decision:'safe_retry'}),e=>e.code==='P4_EVENT_RECOVERY_INPUT_DRIFT');
      assert.equal(state().journalCalls.includes('abandon'),false);
    },absentFactRecoverySettings(extra));
  }
});
test('abandoned commit settles after restart even if owner projection now fails',async()=>{
  const settings=absentFactRecoverySettings();settings.effectJournalRead.state='failed';
  settings.inputError=new Error('owner facts have changed');
  await fixture(async({runtime,databasePath,state})=>{
    assert.equal((await runtime.recover({eventId:'event',effectId:'effect',decision:'already_failed'})).kind,'failed');
    assert.equal(databaseFacts(databasePath).event.state,'failed');assert.equal(state().dispatchContext,undefined);
  },settings);
});


test('superseded input basis closes an auditable Attempt without dispatching stale Capability input',async()=>{
  await fixture(async({runtime,lease,databasePath})=>{
    const outcome=await runtime.run({schedulerLease:lease});
    assert.equal(outcome.kind,'input_superseded');
    assert.equal(outcome.failureCode,'P4_EXECUTION_INPUT_BASIS_SUPERSEDED');
    const facts=databaseFacts(databasePath);
    assert.equal(facts.event.state,'failed');assert.equal(facts.attempts,1);assert.equal(facts.results,0);
    assert.equal(facts.attempt.failure_class,'input_projection');
    assert.equal(facts.attempt.failure_code,'P4_EXECUTION_INPUT_BASIS_SUPERSEDED');
  },{inputError:executionInputSuperseded('Owner basis advanced before dispatch.')});
});

test('pure observation recovery terminates an explicitly superseded input without dispatch or Effect writes',async()=>{
  await fixture(async({runtime,databasePath,state})=>{
    const result=await runtime.recover({eventId:'event',decision:'safe_retry'});
    assert.equal(result.eventState,'failed');
    const facts=databaseFacts(databasePath);assert.equal(facts.attempt.state,'completed');
    assert.equal(facts.attempt.failure_code,'P4_EXECUTION_INPUT_BASIS_SUPERSEDED');assert.equal(facts.results,0);
    assert.equal(state().dispatchContext,undefined);assert.deepEqual(state().journalCalls,[]);
  },{initialEventState:'executing',seedExecutingAttempt:true,inputError:executionInputSuperseded('Owner retired the input.')});
});

for(const [effectClass,error] of [['workspace_write',executionInputSuperseded('Old input with an unknown file effect.')],
  ['pure_observation',executionInputUnavailable('Owner temporarily unavailable.')],['pure_observation',new Error('Corrupt input.')]])
  test('recovery preserves unresolved '+effectClass+' input '+error.message,async()=>{
    await fixture(async({runtime,databasePath,state})=>{
      await assert.rejects(runtime.recover({eventId:'event',decision:'safe_retry'}),value=>value===error);
      assert.equal(databaseFacts(databasePath).attempt.state,'executing');
      assert.equal(state().dispatchContext,undefined);assert.deepEqual(state().journalCalls,[]);
    },{effectClass,initialEventState:'executing',seedExecutingAttempt:true,inputError:error});
  });


for(const effectClass of ['pure_observation','workspace_write','material_commit','destructive_commit'])test('shutdown interruption preserves nonterminal execution for '+effectClass,async()=>{
  await fixture(async({runtime,lease,databasePath,state})=>{
    await assert.rejects(runtime.run({schedulerLease:lease}),{code:'P4_EXECUTION_SHUTDOWN_INTERRUPTED'});
    const facts=databaseFacts(databasePath);
    assert.equal(facts.event.state,'executing');
    assert.equal(facts.attempt.state,'executing');
    assert.equal(facts.attempt.failure_code,null);
    assert.equal(facts.results,0);
    assert.equal(state().journalCalls.includes('abandon'),false);
    assert.equal(state().journalCalls.includes('settle'),false);
  },{effectClass,dispatchError:Object.assign(new Error('shutdown'),{code:'P4_EXECUTION_SHUTDOWN_INTERRUPTED'})});
});
