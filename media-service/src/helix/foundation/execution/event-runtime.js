'use strict';
const { failureDiagnostics } = require('../../contracts/failure-diagnostics');

const { digest } = require('../persistence/ddl-compiler');
const { createRepositoryDefinition } = require('../persistence/owner-repository');
const {
  isExecutionInputUnavailable, isExecutionInputSuperseded,
} = require('./execution-input-readiness');
const { createProgressReporter } = require('./progress-reporter');

class EventRuntimeError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'EventRuntimeError'; this.code = code; this.details = details; }
}

function fail(code, message, details) { throw new EventRuntimeError(code, message, details); }

function observationFailureClass(error) {
  if (error?.code === 'P4_EXECUTION_TIMEOUT') return 'timeout';
  if (error?.code === 'P5_PROVIDER_TRANSPORT_FAILED') return 'integration';
  return 'executor';
}

function cooperativeDeadlineOutcome(entry, error, deadlineAtMs) {
  if (error?.code !== 'P4_EXECUTION_TIMEOUT' || entry?.executor?.cooperativeAbortSafe !== true) return null;
  return Object.freeze({ kind:'failed', failureClass:'integration', code:'COOPERATIVE_EXECUTION_DEADLINE_EXCEEDED',
    message:'Abort-safe Capability execution did not settle within its frozen deadline.', retryDirective:'never',
    evidence:Object.freeze({ deadlineAtMs, cooperativeAbortSafe:true }) });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonical(value[key]); return result;
  }, {});
  return value;
}

function json(value) { return JSON.stringify(canonical(value)); }
function valueDigest(value) { return digest(json(value)); }

function boundedObservationOutcome(entry, outcome) {
  if (entry.manifest.effectClass !== 'pure_observation' || outcome?.kind !== 'succeeded') return outcome;
  const resultBytes = Buffer.byteLength(json(outcome.result), 'utf8');
  const evidenceBytes = Buffer.byteLength(json(outcome.evidence), 'utf8');
  // Enforce the durable Result contract before the completion transaction. A
  // SQLite CHECK failure here otherwise strands an executing pure Attempt even
  // though its executor and Permit have already ended. Never truncate evidence
  // or apply this conversion to a Capability with a physical/committed Effect.
  if (resultBytes <= 65536 && evidenceBytes <= 65536) return outcome;
  return Object.freeze({ kind:'failed', failureClass:'contract',
    code:'P4_OBSERVATION_RESULT_STORAGE_BOUND_EXCEEDED',
    message:'Pure observation Result or Evidence exceeds its durable byte limit.',
    retryDirective:'never', evidence:Object.freeze({ resultBytes, evidenceBytes, maximumBytes:65536,
      resultDigest:valueDigest(outcome.result), evidenceDigest:valueDigest(outcome.evidence) }) });
}
const DISPATCHABLE_EVENT_STATES = new Set([
  'ready',
  'waiting_for_resource',
  'waiting_for_external',
]);

function definitions(schemaManifest) {
  return Object.freeze({
    events: createRepositoryDefinition({ repositoryId: 'runtime_events', owner: 'execution-foundation', schemaManifest, statements: {
      find: { kind: 'select-one', tableId: 'fx_workflow_events', columns: [
        'event_id', 'plan_id', 'node_id', 'work_id', 'attempt_id', 'owner_domain', 'capability_ref', 'contract_version',
        'state', 'priority_class', 'ready_at_ms', 'retry_at_ms', 'result_id'
      ], keyColumns: ['event_id'] },
      list: { kind: 'select-all', tableId: 'fx_workflow_events', columns: [
        'event_id', 'plan_id', 'node_id', 'state', 'result_id'
      ], keyColumns: ['plan_id'] },
      update: { kind: 'update', tableId: 'fx_workflow_events', setColumns: ['state', 'ready_at_ms', 'retry_at_ms', 'result_id'], keyColumns: ['event_id'] }
    } }),
    nodes: createRepositoryDefinition({ repositoryId: 'runtime_nodes', owner: 'execution-foundation', schemaManifest, statements: {
      find: { kind: 'select-one', tableId: 'fx_plan_nodes', columns: [
        'plan_id', 'node_id', 'capability_ref', 'contract_version', 'input_binding_schema_ref', 'input_bindings_json',
        'parameter_schema_ref', 'parameters_json', 'effect_class', 'fence_schema_ref', 'fence_basis_json',
        'resource_demand_schema_ref', 'resource_demand_json'
      ], keyColumns: ['plan_id', 'node_id'] },
      list: { kind: 'select-all', tableId: 'fx_plan_nodes', columns: [
        'plan_id', 'node_id', 'when_schema_ref', 'when_json'
      ], keyColumns: ['plan_id'] }
    } }),
    edges: createRepositoryDefinition({ repositoryId: 'runtime_edges', owner: 'execution-foundation', schemaManifest, statements: {
      list: { kind: 'select-all', tableId: 'fx_plan_edges', columns: ['plan_id', 'from_node_id', 'to_node_id', 'dependency_kind'], keyColumns: ['plan_id'] }
    } }),
    works: createRepositoryDefinition({ repositoryId: 'runtime_works', owner: 'execution-foundation', schemaManifest, statements: {
      find: { kind: 'select-one', tableId: 'fx_supporting_works', columns: [
        'work_id', 'owner_domain', 'process_type', 'process_id', 'work_kind', 'basis_digest', 'priority_class', 'state'
      ], keyColumns: ['work_id'] }
    } }),
    workAttempts: createRepositoryDefinition({ repositoryId: 'runtime_work_attempts', owner: 'execution-foundation', schemaManifest, statements: {
      find: { kind: 'select-one', tableId: 'fx_work_attempts', columns: ['attempt_id', 'work_id', 'basis_digest', 'state'], keyColumns: ['attempt_id'] }
    } }),
    plans: createRepositoryDefinition({ repositoryId: 'runtime_plans', owner: 'execution-foundation', schemaManifest, statements: {
      find: { kind: 'select-one', tableId: 'fx_workflow_plans', columns: [
        'plan_id', 'attempt_id', 'basis_digest', 'state'
      ], keyColumns: ['plan_id'] }
    } }),
    eventAttempts: createRepositoryDefinition({ repositoryId: 'runtime_event_attempts', owner: 'execution-foundation', schemaManifest, statements: {
      list: { kind: 'select-all', tableId: 'fx_event_attempts', columns: [
        'event_attempt_id', 'event_id', 'ordinal', 'executor_ref', 'executor_version', 'input_snapshot_schema_ref',
        'input_snapshot_digest', 'fence_snapshot_digest', 'state', 'outcome_kind', 'failure_class', 'started_at_ms'
      ], keyColumns: ['event_id'] },
      insert: { kind: 'insert', tableId: 'fx_event_attempts', columns: [
        'event_attempt_id', 'event_id', 'ordinal', 'executor_ref', 'executor_version', 'input_snapshot_schema_ref', 'input_snapshot_digest',
        'fence_snapshot_digest', 'state', 'outcome_kind', 'retry_after_ms', 'failure_class', 'failure_code', 'evidence_digest',
        'started_at_ms', 'finished_at_ms'
      ] },
      complete: { kind: 'update', tableId: 'fx_event_attempts', setColumns: [
        'state', 'outcome_kind', 'retry_after_ms', 'failure_class', 'failure_code', 'evidence_digest', 'finished_at_ms'
      ], keyColumns: ['event_attempt_id'] }
    } }),
    results: createRepositoryDefinition({ repositoryId: 'runtime_results', owner: 'execution-foundation', schemaManifest, statements: {
      find: { kind: 'select-one', tableId: 'fx_event_result_bindings', columns: [
        'result_id', 'event_id', 'outcome_kind', 'result_schema_ref', 'result_json', 'result_digest',
        'evidence_schema_ref', 'evidence_json', 'evidence_digest', 'effect_receipt_id', 'committed_at_ms'
      ], keyColumns: ['event_id'] },
      list: { kind: 'select-in', tableId: 'fx_event_result_bindings', keyColumn:'event_id', maxItems:500, columns: [
        'event_id', 'outcome_kind', 'result_schema_ref', 'result_json', 'evidence_schema_ref', 'evidence_json', 'effect_receipt_id'
      ] },
      insert: { kind: 'insert', tableId: 'fx_event_result_bindings', columns: [
        'result_id', 'event_id', 'outcome_kind', 'result_schema_ref', 'result_json', 'result_digest', 'evidence_schema_ref',
        'evidence_json', 'evidence_digest', 'effect_receipt_id', 'committed_at_ms'
      ] }
    } }),
    markers: createRepositoryDefinition({ repositoryId:'runtime_commit_markers',owner:'execution-foundation',schemaManifest,statements:{
      list:{kind:'select-all',tableId:'fx_commit_markers',columns:['commit_marker','effect_id','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest','committed_at_ms'],keyColumns:['effect_id']}
    } }),
    timings: createRepositoryDefinition({ repositoryId: 'runtime_resource_timings', owner: 'execution-foundation', schemaManifest, statements: {
      insert: { kind: 'insert', tableId: 'fx_event_resource_timings', columns: [
        'event_attempt_id', 'resource_key', 'queue_class', 'enqueued_at_ms', 'acquired_at_ms', 'released_at_ms',
        'wait_duration_ms', 'hold_duration_ms', 'outcome'
      ] }
    } })
  });
}

function createEventRuntime(options) {
  const requiredFunctions = ['nextEventAttemptId', 'nextExecutionId', 'nextResultId', 'now'];
  if (!options || !options.schemaManifest || !options.unitOfWork || !options.scheduler || !options.governor ||
      typeof options.governor.acquire !== 'function' || typeof options.governor.acquireRecovery !== 'function' || !options.registry ||
      !options.dispatcher || !options.contractValidator || typeof options.contractValidator.validate !== 'function' ||
      !options.executionInputProvider || !options.fenceValidator || !options.resourceDemandResolver ||
      !options.attemptPolicy || typeof options.attemptPolicy.prepare !== 'function' ||
      typeof options.attemptPolicy.bindingFor !== 'function' ||
      typeof options.attemptPolicy.decideFailure !== 'function' || typeof options.attemptPolicy.decideDeferred !== 'function' ||
      !options.timeoutController || typeof options.timeoutController.execute !== 'function' ||
      !options.circuitBreaker || typeof options.circuitBreaker.allows !== 'function' ||
      (options.incidentObserver && typeof options.incidentObserver.prepareExecution !== 'function') ||
      (options.dispatchGuard && typeof options.dispatchGuard.check !== 'function') ||
      !options.whenEvaluator || typeof options.whenEvaluator.evaluate !== 'function' ||
      requiredFunctions.some((name) => typeof options[name] !== 'function')) fail(
    'P4_EVENT_RUNTIME_DEPENDENCIES_REQUIRED', 'Event Runtime requires exact persistence, scheduler, Governor, Registry, Dispatcher, typed providers, IDs, and clock.'
  );
  const repositories = definitions(options.schemaManifest);
  const pendingCompletions = new Map();

  function advancePlan(context, planId) {
    const events = context.repository('runtime_events').invoke('list',{plan_id:planId});
    const nodes = context.repository('runtime_nodes').invoke('list',{plan_id:planId});
    const edges = context.repository('runtime_edges').invoke('list',{plan_id:planId});
    const results = new Map();
    for(let offset=0;offset<events.length;offset+=500){
      for(const result of context.repository('runtime_results').invoke('list',{values:events.slice(offset,offset+500).map(event=>event.event_id)}))results.set(result.event_id,result);
    }
    const eventByNode = new Map(events.map((event) => [event.node_id, event]));
    const nodeById = new Map(nodes.map((node) => [node.node_id, node]));
    const terminal = new Set(['succeeded', 'skipped', 'failed', 'cancelled']);
    let changed = true;
    while (changed) {
      changed = false;
      for (const event of events.filter((candidate) => candidate.state === 'pending')) {
        const inbound = edges.filter((edge) => edge.to_node_id === event.node_id);
        const predecessors = inbound.map((edge) => ({ edge, event: eventByNode.get(edge.from_node_id) }));
        if (predecessors.some((item) => !item.event)) fail('P4_EVENT_DEPENDENCY_FACT_MISSING', 'Plan edge has no predecessor Event.');
        const impossible = predecessors.some((item) => item.edge.dependency_kind === 'success' && terminal.has(item.event.state) && item.event.state !== 'succeeded');
        const satisfied = predecessors.every((item) => item.edge.dependency_kind === 'success'
          ? item.event.state === 'succeeded' : terminal.has(item.event.state));
        let nextState = null;
        if (impossible) nextState = 'cancelled';
        else if (satisfied) {
          const node = nodeById.get(event.node_id);
          if (!node) fail('P4_EVENT_NODE_FACT_MISSING', 'Pending Event has no Plan Node.');
          if (inbound.some((edge) => edge.dependency_kind === 'terminal')) continue;
          if (node.when_schema_ref === null) nextState = 'ready';
          else {
            const decision = options.whenEvaluator.evaluate(Object.freeze({
              schemaRef: node.when_schema_ref, expression: JSON.parse(node.when_json),
              dependencies: Object.freeze(predecessors.map((item) => Object.freeze({
                eventId: item.event.event_id, state: item.event.state, result: results.get(item.event.event_id) || null
              })))
            }));
            if (!['run', 'skip'].includes(decision)) fail('P4_EVENT_WHEN_DECISION_INVALID', 'Restricted when evaluator must return run or skip.');
            nextState = decision === 'run' ? 'ready' : 'skipped';
          }
        }
        if (nextState) {
          context.repository('runtime_events').invoke('update', {
            event_id: event.event_id, state: nextState, ready_at_ms: nextState === 'ready' ? context.commitTimeMs : null,
            retry_at_ms: null, result_id: null
          });
          event.state = nextState; changed = true;
        }
      }
    }
  }

  function recordResourceTimings(eventAttemptId, permit, demand, requestedAtMs, releasedAtMs, outcome) {
    options.unitOfWork.execute([{
      participantId: 'event_runtime_resource_timing', owner: 'execution-foundation', repositories: [repositories.timings], execute(context) {
        for (const resource of permit.resources) context.repository('runtime_resource_timings').invoke('insert', {
          event_attempt_id: eventAttemptId, resource_key: resource.resourceKey, queue_class: demand.queueClass,
          enqueued_at_ms: requestedAtMs, acquired_at_ms: permit.issuedAtMs, released_at_ms: releasedAtMs,
          wait_duration_ms: Math.max(0, permit.issuedAtMs - requestedAtMs), hold_duration_ms: Math.max(0, releasedAtMs - permit.issuedAtMs), outcome
        });
      }
    }]);
  }

  function readSnapshot(eventId) {
    return options.unitOfWork.execute([{
      participantId: 'event_runtime_snapshot', owner: 'execution-foundation', repositories: Object.values(repositories), execute(context) {
        const event = context.repository('runtime_events').invoke('find', { event_id: eventId });
        if (!event || !DISPATCHABLE_EVENT_STATES.has(event.state))
          fail('P4_EVENT_NOT_READY', 'Event Runtime advances only a ready, resource-waiting, or due external-waiting Event.', { eventId });
        const node = context.repository('runtime_nodes').invoke('find', { plan_id: event.plan_id, node_id: event.node_id });
        const work = context.repository('runtime_works').invoke('find', { work_id: event.work_id });
        const workAttempt = context.repository('runtime_work_attempts').invoke('find', { attempt_id: event.attempt_id });
        const plan = context.repository('runtime_plans').invoke('find', { plan_id: event.plan_id });
        if (!node || !work || !workAttempt || !plan || node.capability_ref !== event.capability_ref ||
            node.contract_version !== event.contract_version || work.owner_domain !== event.owner_domain || workAttempt.work_id !== work.work_id ||
            plan.attempt_id !== workAttempt.attempt_id || plan.state !== 'planned' || !['ready', 'running'].includes(workAttempt.state) ||
            !['ready', 'running'].includes(work.state)) fail('P4_EVENT_RUNTIME_FACT_MISMATCH', 'Event, Plan, Work, and Capability facts are not mutually consistent.');
        const attempts = context.repository('runtime_event_attempts').invoke('list',{event_id:eventId});
        if (attempts.some((attempt) => attempt.state === 'executing')) fail('P4_EVENT_ATTEMPT_ALREADY_EXECUTING', 'Event already has an executing Attempt.');
        return Object.freeze({ event, node, work, workAttempt, plan, attempts: Object.freeze(attempts), nextOrdinal: attempts.length + 1 });
      }
    }]).event_runtime_snapshot;
  }

  function readRecoverySnapshot(eventId) {
    return options.unitOfWork.execute([{
      participantId: 'event_runtime_recovery_snapshot', owner: 'execution-foundation', repositories: Object.values(repositories), execute(context) {
        const event = context.repository('runtime_events').invoke('find', { event_id: eventId });
        if (!event || event.state !== 'executing') fail(
          'P4_EVENT_RECOVERY_STATE_INVALID', 'Effect recovery requires one durable executing Event.', { eventId }
        );
        const node = context.repository('runtime_nodes').invoke('find', { plan_id: event.plan_id, node_id: event.node_id });
        const work = context.repository('runtime_works').invoke('find', { work_id: event.work_id });
        const workAttempt = context.repository('runtime_work_attempts').invoke('find', { attempt_id: event.attempt_id });
        const plan = context.repository('runtime_plans').invoke('find', { plan_id: event.plan_id });
        const attempts = context.repository('runtime_event_attempts').invoke('list',{event_id:eventId});
        const active = attempts.filter((attempt) => attempt.state === 'executing');
        if (!node || !work || !workAttempt || !plan || active.length !== 1 ||
            node.capability_ref !== event.capability_ref || node.contract_version !== event.contract_version ||
            work.owner_domain !== event.owner_domain || workAttempt.work_id !== work.work_id ||
            plan.attempt_id !== workAttempt.attempt_id || plan.state !== 'planned' ||
            !['ready', 'running'].includes(workAttempt.state) || !['ready', 'running'].includes(work.state)) fail(
          'P4_EVENT_RECOVERY_FACT_MISMATCH', 'Recovery Event, Attempt, Plan, Work, and Capability facts are not mutually consistent.'
        );
        return Object.freeze({ event, node, work, workAttempt, plan, attempts: Object.freeze(attempts), activeAttempt: active[0] });
      }
    }]).event_runtime_recovery_snapshot;
  }

  function readPreboundCommittedOutcome(eventId, effectId, attempt, entry) {
    const binding=options.unitOfWork.execute([{participantId:'event_runtime_prebound_result_read',owner:'execution-foundation',
      repositories:[repositories.results,repositories.markers],execute(context){return Object.freeze({
        row:context.repository('runtime_results').invoke('find',{event_id:eventId}),
        markers:Object.freeze(context.repository('runtime_commit_markers').invoke('list',{effect_id:effectId})),
      });}}]).event_runtime_prebound_result_read,row=binding.row;
    if(!row)return null;
    if(row.result_schema_ref!==entry.manifest.resultSchemaRef||
        row.evidence_schema_ref!==entry.manifest.evidenceSchemaRef)return null;
    const effect=options.effectJournal?.read(effectId),marker=binding.markers.length===1?binding.markers[0]:null;
    if(!effect||effect.event_attempt_id!==attempt.event_attempt_id||effect.effect_class!==entry.manifest.effectClass||
        !['intended','effect_observed','reconcile_required','committed'].includes(effect.state)||
        typeof effect.idempotency_key!=='string'||!effect.idempotency_key||!marker||marker.owner_domain!==entry.manifest.ownerScope||
        marker.result_id!==row.result_id||marker.result_schema_ref!==row.result_schema_ref||
        marker.result_digest!==row.result_digest||
        !Number.isSafeInteger(marker.committed_at_ms)||marker.committed_at_ms<Number(attempt.started_at_ms)||
        !Number.isSafeInteger(row.committed_at_ms)||row.committed_at_ms<marker.committed_at_ms||
        typeof row.effect_receipt_id!=='string'||!row.effect_receipt_id)
      fail('P4_EVENT_PREBOUND_RESULT_CORRUPT','Atomic Capability Result is not linked to the exact Effect and Commit Marker.');
    let result,evidence;
    try{if(typeof row.result_json!=='string'||typeof row.evidence_json!=='string')throw new Error('non-json');result=JSON.parse(row.result_json);evidence=JSON.parse(row.evidence_json);}catch{
      fail('P4_EVENT_PREBOUND_RESULT_CORRUPT','Atomic Capability pre-bound invalid Result JSON.');
    }
    if(row.outcome_kind!=='succeeded'||row.result_schema_ref!==entry.manifest.resultSchemaRef||
        row.evidence_schema_ref!==entry.manifest.evidenceSchemaRef||json(result)!==row.result_json||
        json(evidence)!==row.evidence_json||digest(row.result_json)!==row.result_digest||
        digest(row.evidence_json)!==row.evidence_digest||result.ownerDomain!==marker.owner_domain||
        result.scopeType!==marker.scope_type||result.scopeId!==marker.scope_id||
        result.effectReceiptRef!==row.effect_receipt_id)
      fail('P4_EVENT_PREBOUND_RESULT_CORRUPT','Atomic Capability pre-bound Result does not match its frozen contract.');
    options.contractValidator.validate(entry.manifest.resultSchemaRef,result);
    options.contractValidator.validate(row.evidence_schema_ref,evidence);
    const effectReceipt=Object.freeze({schemaRef:'helix://contracts/types/EffectReceipt/v1',schemaVersion:1,
      effectReceiptId:row.effect_receipt_id,effectId:effect.effect_id,effectClass:effect.effect_class,
      idempotencyKey:effect.idempotency_key,commitMarker:marker.commit_marker,
      externalReceiptRef:effect.external_receipt_ref||null,outputDigest:row.result_digest,
      verificationEvidenceDigest:marker.commit_digest,committedAtMs:marker.committed_at_ms});
    options.contractValidator.validate('helix://contracts/types/EffectReceipt/v1',effectReceipt);
    const outcome=Object.freeze({kind:'succeeded',resultSchemaRef:entry.manifest.resultSchemaRef,result:Object.freeze(result),
      evidenceSchemaRef:row.evidence_schema_ref,evidence:Object.freeze(evidence),
      effectReceipt});
    options.contractValidator.validate('helix://contracts/types/CapabilityOutcome/v1',outcome);
    return Object.freeze({outcome,scope:Object.freeze({ownerDomain:marker.owner_domain,scopeType:marker.scope_type,scopeId:marker.scope_id})});
  }

  function clock() {
    const atMs = options.now();
    if (!Number.isSafeInteger(atMs) || atMs < 0) fail('P4_EVENT_RUNTIME_CLOCK_INVALID', 'Event Runtime clock must return epoch milliseconds.');
    return atMs;
  }

  function assertId(value, kind) {
    if (typeof value !== 'string' || !value) fail('P4_EVENT_RUNTIME_ID_INVALID', 'Runtime ID source returned invalid identity.', { kind });
    return value;
  }

  function recordFenceRejected(snapshot, entry, attemptId, startedAtMs, fence, readFence=null) {
    const evidence = fence.evidence || { reasonCode: 'FENCE_REJECTED' };
    options.unitOfWork.execute([{
      participantId: 'event_runtime_fence_rejected', owner: 'execution-foundation', repositories: Object.values(repositories), execute(context) {
        const event = context.repository('runtime_events').invoke('find', { event_id: snapshot.event.event_id });
        if (!event || !DISPATCHABLE_EVENT_STATES.has(event.state)) fail(
          'P4_EVENT_FENCE_STATE_CHANGED',
          'Event changed before Fence rejection could be recorded.',
        );
        context.repository('runtime_event_attempts').invoke('insert', {
          event_attempt_id: attemptId, event_id: event.event_id, ordinal: snapshot.nextOrdinal, executor_ref: entry.manifest.capabilityRef,
          executor_version: entry.executor.version, input_snapshot_schema_ref: snapshot.node.input_binding_schema_ref,
          input_snapshot_digest: valueDigest(JSON.parse(snapshot.node.input_bindings_json)), fence_snapshot_digest: fence.actualDigest,
          state: 'completed', outcome_kind: 'fence_rejected', retry_after_ms: null, failure_class: null,
          failure_code: 'FENCE_REJECTED', evidence_digest: valueDigest(evidence), started_at_ms: startedAtMs, finished_at_ms: context.commitTimeMs
        });
        context.repository('runtime_events').invoke('update', {
          event_id: event.event_id, state: 'failed', ready_at_ms: event.ready_at_ms, retry_at_ms: null, result_id: null
        });
        advancePlan(context, event.plan_id);
      }
    }],{readFence});
    return Object.freeze({ kind: 'fence_rejected', eventId: snapshot.event.event_id, eventAttemptId: attemptId });
  }

  function recordInputPreparationOutcome(snapshot, error, readFence=null) {
    const unavailable = isExecutionInputUnavailable(error);
    const nowMs = clock();
    const retryAtMs = unavailable && Number.isSafeInteger(error.retryAtMs) &&
      error.retryAtMs > nowMs
      ? error.retryAtMs
      : unavailable
        ? nowMs + 30_000
        : null;
    const failureCode = typeof error?.code === 'string' && error.code
      ? error.code
      : 'P4_EVENT_INPUT_PREPARATION_FAILED';
    const failedAttemptId = unavailable ? null : options.nextEventAttemptId(snapshot.event.event_id, snapshot.nextOrdinal);
    options.unitOfWork.execute([{
      participantId: 'event_runtime_input_preparation',
      owner: 'execution-foundation',
      repositories: Object.values(repositories),
      execute(context) {
        const event = context.repository('runtime_events').invoke('find', {
          event_id: snapshot.event.event_id,
        });
        if (!event || !DISPATCHABLE_EVENT_STATES.has(event.state)) {
          fail(
            'P4_EVENT_INPUT_PREPARATION_STATE_CHANGED',
            'Event changed before its input preparation outcome could be recorded.',
          );
        }
        if (!unavailable) {
          const entry = options.registry.resolve(event.capability_ref, event.owner_domain);
          const attempts = context.repository('runtime_event_attempts').invoke('list',{event_id:event.event_id});
          if (attempts.some((attempt) => attempt.state === 'executing') || attempts.length + 1 !== snapshot.nextOrdinal) {
            fail('P4_EVENT_INPUT_FAILURE_ATTEMPT_RACE', 'Input failure Attempt ordinal or active uniqueness changed.');
          }
          const inputFailureEvidence = { failureCode, failureMessage:String(error?.message || 'Event input preparation failed.') };
          context.repository('runtime_event_attempts').invoke('insert', {
            event_attempt_id: failedAttemptId, event_id:event.event_id, ordinal:snapshot.nextOrdinal,
            executor_ref:entry.manifest.capabilityRef, executor_version:entry.executor.version,
            input_snapshot_schema_ref:snapshot.node.input_binding_schema_ref,
            input_snapshot_digest:valueDigest({ eventId:event.event_id, inputPreparationFailed:true }),
            fence_snapshot_digest:valueDigest(JSON.parse(snapshot.node.fence_basis_json)), state:'completed',
            outcome_kind:'failed', retry_after_ms:null, failure_class:'input_projection', failure_code:failureCode,
            evidence_digest:valueDigest(inputFailureEvidence), started_at_ms:nowMs, finished_at_ms:nowMs
          });
        }
        context.repository('runtime_events').invoke('update', {
          event_id: event.event_id,
          state: unavailable ? 'waiting_for_external' : 'failed',
          ready_at_ms: event.ready_at_ms,
          retry_at_ms: retryAtMs,
          result_id: null,
        });
        if (!unavailable) advancePlan(context, event.plan_id);
      },
    }],{readFence});
    if(!unavailable&&typeof options.governor.abandon==='function')options.governor.abandon(snapshot.event.event_id);
    return Object.freeze({
      kind: unavailable ? 'input_waiting' : isExecutionInputSuperseded(error) ? 'input_superseded' : 'input_failed',
      eventId: snapshot.event.event_id,
      eventState: unavailable ? 'waiting_for_external' : 'failed',
      eventAttemptId: failedAttemptId,
      retryAtMs,
      failureCode,
      failureMessage: unavailable ? null : String(error?.message || 'Event input preparation failed.'),
      dependencyKind: unavailable
        ? error.details?.dependencyKind || 'external_dependency'
        : null,
    });
  }

  function promoteExternalWaitToReady(snapshot, readFence=null) {
    if (snapshot.event.state !== 'waiting_for_external') return;
    options.unitOfWork.execute([{
      participantId: 'event_runtime_external_wait_ready',
      owner: 'execution-foundation',
      repositories: [repositories.events],
      execute(context) {
        const event = context.repository('runtime_events').invoke('find', {
          event_id: snapshot.event.event_id,
        });
        if (!event || !DISPATCHABLE_EVENT_STATES.has(event.state)) {
          fail(
            'P4_EVENT_EXTERNAL_WAIT_STATE_CHANGED',
            'Event changed before its external wait could be resumed.',
          );
        }
        if (event.state === 'waiting_for_external') {
          context.repository('runtime_events').invoke('update', {
            event_id: event.event_id,
            state: 'ready',
            ready_at_ms: event.ready_at_ms === null
              ? context.commitTimeMs : event.ready_at_ms,
            retry_at_ms: null,
            result_id: null,
          });
        }
      },
    }],{readFence});
  }

  function beginAttempt(snapshot, entry, attemptId, startedAtMs, inputs, fence, readFence=null) {
    options.unitOfWork.execute([{
      participantId: 'event_runtime_begin', owner: 'execution-foundation', repositories: Object.values(repositories), execute(context) {
        const event = context.repository('runtime_events').invoke('find', { event_id: snapshot.event.event_id });
        if (!event || !DISPATCHABLE_EVENT_STATES.has(event.state))
          fail('P4_EVENT_BEGIN_STATE_CHANGED', 'Event changed before Attempt creation.');
        const attempts = context.repository('runtime_event_attempts').invoke('list',{event_id:event.event_id});
        if (attempts.some((attempt) => attempt.state === 'executing') || attempts.length + 1 !== snapshot.nextOrdinal) fail(
          'P4_EVENT_ATTEMPT_RACE', 'Event Attempt ordinal or active uniqueness changed before creation.'
        );
        context.repository('runtime_event_attempts').invoke('insert', {
          event_attempt_id: attemptId, event_id: event.event_id, ordinal: snapshot.nextOrdinal, executor_ref: entry.manifest.capabilityRef,
          executor_version: entry.executor.version, input_snapshot_schema_ref: snapshot.node.input_binding_schema_ref,
          input_snapshot_digest: valueDigest(inputs.namedInputs), fence_snapshot_digest: fence.digest, state: 'executing', outcome_kind: null,
          retry_after_ms: null, failure_class: null, failure_code: null, evidence_digest: null,
          started_at_ms: startedAtMs, finished_at_ms: null
        });
        context.repository('runtime_events').invoke('update', {
          event_id: event.event_id, state: 'executing', ready_at_ms: event.ready_at_ms, retry_at_ms: null, result_id: null
        });
      }
    }],{readFence});
  }

  function complete(snapshot, attemptId, outcome, policyDecision = null) {
    if (outcome.kind === 'failed' && outcome.evidence?.diagnostics && options.failureEvidenceStore) {
      try { options.failureEvidenceStore.write(outcome.evidence); }
      catch {
        // Diagnostic storage must not keep an already failed physical effect executing.
        options.onDiagnosticError?.(Object.assign(new Error('Failure diagnostics could not be persisted.'),
          {code:'EXECUTION_FAILURE_DIAGNOSTICS_UNAVAILABLE'}));
      }
    }
    return options.unitOfWork.execute([{
      participantId: 'event_runtime_complete', owner: 'execution-foundation', repositories: Object.values(repositories), execute(context) {
        const event = context.repository('runtime_events').invoke('find', { event_id: snapshot.event.event_id });
        if (!event || event.state !== 'executing') fail('P4_EVENT_COMPLETE_STATE_CHANGED', 'Event is not executing at Outcome commit.');
        let eventState; let retryAtMs = null; let resultId = null; let failureClass = null; let failureCode = null;
        const finishedAtMs = context.commitTimeMs;
        if (outcome.kind === 'succeeded') {
          const resultJson = json(outcome.result); const evidenceJson = json(outcome.evidence);
          const existing = context.repository('runtime_results').invoke('find', { event_id: event.event_id });
          if (existing) {
            const expectedReceiptId = outcome.effectReceipt ? outcome.effectReceipt.effectReceiptId : null;
            const evidenceMatches = existing.evidence_schema_ref === outcome.evidenceSchemaRef &&
              existing.evidence_json === evidenceJson && existing.evidence_digest === digest(evidenceJson);
            const canonicalEvidenceBound = outcome.evidence && outcome.evidence.payloadDigest === existing.evidence_digest;
            const resultSchemaMatches = existing.result_schema_ref === outcome.resultSchemaRef ||
              existing.result_schema_ref === outcome.result?.schemaRef;
            if (!resultSchemaMatches || existing.result_json !== resultJson ||
                existing.result_digest !== digest(resultJson) || (!evidenceMatches && !canonicalEvidenceBound) ||
                existing.effect_receipt_id !== expectedReceiptId) {
              fail('P4_EVENT_PREBOUND_RESULT_CONFLICT', 'Atomic Capability commit pre-bound a different Event Result.');
            }
            const linkedMarkers=outcome.effectReceipt?context.repository('runtime_commit_markers').invoke('list',{effect_id:outcome.effectReceipt.effectId}).filter((marker)=>
              marker.commit_marker===outcome.effectReceipt.commitMarker&&marker.effect_id===outcome.effectReceipt.effectId&&
              marker.owner_domain===event.owner_domain&&marker.result_id===existing.result_id&&
              marker.result_schema_ref===existing.result_schema_ref&&marker.result_digest===existing.result_digest&&
              marker.commit_digest===outcome.effectReceipt.verificationEvidenceDigest&&
              marker.committed_at_ms===outcome.effectReceipt.committedAtMs):[];
            if(linkedMarkers.length!==1)fail('P4_EVENT_PREBOUND_RESULT_CONFLICT','Atomic Capability Result lacks its exact Effect Commit Marker.');
            resultId = existing.result_id;
          } else {
            resultId = assertId(options.nextResultId(), 'result');
            context.repository('runtime_results').invoke('insert', {
              result_id: resultId, event_id: event.event_id, outcome_kind: 'succeeded', result_schema_ref: outcome.resultSchemaRef,
              result_json: resultJson, result_digest: digest(resultJson), evidence_schema_ref: outcome.evidenceSchemaRef,
              evidence_json: evidenceJson, evidence_digest: digest(evidenceJson),
              effect_receipt_id: outcome.effectReceipt ? outcome.effectReceipt.effectReceiptId : null, committed_at_ms: finishedAtMs
            });
          }
          eventState = 'succeeded';
        } else if (outcome.kind === 'deferred') {
          if (policyDecision && policyDecision.decision === 'observe') {
            eventState = 'waiting_for_external'; retryAtMs = policyDecision.retryAtMs;
          } else {
            eventState = 'failed'; failureClass = 'observation';
            failureCode = policyDecision && policyDecision.code || 'DEFERRED_NOT_DECLARED';
          }
        } else {
          if (policyDecision && policyDecision.decision === 'retry') {
            eventState = 'ready'; retryAtMs = policyDecision.retryAtMs;
          } else if (policyDecision && policyDecision.decision === 'reconcile_required') eventState = 'waiting_for_external';
          else eventState = 'failed';
          failureClass = outcome.kind === 'failed' ? outcome.failureClass : 'fence';
          failureCode = outcome.kind === 'failed' ? outcome.code : 'FENCE_REJECTED';
        }
        context.repository('runtime_event_attempts').invoke('complete', {
          event_attempt_id: attemptId, state: 'completed', outcome_kind: outcome.kind,
          retry_after_ms: outcome.kind === 'deferred' ? outcome.retryAfterMs : null, failure_class: failureClass,
          failure_code: failureCode, evidence_digest: valueDigest(outcome.evidence), finished_at_ms: finishedAtMs
        });
        context.repository('runtime_events').invoke('update', {
          event_id: event.event_id, state: eventState, ready_at_ms: event.ready_at_ms, retry_at_ms: retryAtMs, result_id: resultId
        });
        advancePlan(context, event.plan_id);
        return Object.freeze({ kind: outcome.kind, eventId: event.event_id, eventAttemptId: attemptId, eventState, resultId, retryAtMs });
      }
    }]).event_runtime_complete;
  }

  function completeCommittedEffect(snapshot, attemptId, outcome) {
    pendingCompletions.set(snapshot.event.event_id, Object.freeze({ snapshot, attemptId, outcome }));
    const completed = complete(snapshot, attemptId, outcome, null);
    pendingCompletions.delete(snapshot.event.event_id);
    return completed;
  }

  function retryPendingCompletion(eventId) {
    const pending = pendingCompletions.get(eventId);
    if (!pending) return Object.freeze({ kind:'no_pending_completion', eventId });
    return completeCommittedEffect(pending.snapshot, pending.attemptId, pending.outcome);
  }

  async function classifyRecovery(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request) ||
        JSON.stringify(Object.keys(request).sort()) !== JSON.stringify(['effectId', 'eventId'])) fail(
      'P4_EVENT_RECOVERY_CLASSIFICATION_REQUEST_INVALID',
      'Online Effect recovery classification requires the exact Event and Effect identities.'
    );
    if (!options.effectJournal || typeof options.effectJournal.requireReconcile !== 'function' ||
        !options.effectReconciler || typeof options.effectReconciler.reconcile !== 'function') fail(
      'P4_EVENT_RECOVERY_CLASSIFIER_UNAVAILABLE',
      'Online Effect recovery requires the durable Effect Journal and exact reality reconciler.'
    );
    const snapshot = readRecoverySnapshot(request.eventId);
    const attempt = snapshot.activeAttempt;
    const entry = options.registry.resolve(snapshot.event.capability_ref, snapshot.event.owner_domain);
    if (snapshot.node.effect_class === 'pure_observation' || snapshot.node.effect_class !== entry.manifest.effectClass) fail(
      'P4_EVENT_RECOVERY_CLASSIFICATION_CONTRACT_MISMATCH',
      'Online Effect recovery must preserve the frozen non-pure Capability contract.'
    );
    const effect = options.effectJournal.requireReconcile(request.effectId);
    if (!effect || effect.effect_id !== request.effectId || effect.event_attempt_id !== attempt.event_attempt_id ||
        effect.effect_class !== snapshot.node.effect_class) fail(
      'P4_EVENT_RECOVERY_EFFECT_DRIFT',
      'Online Effect recovery does not bind the exact durable Effect and Event Attempt.'
    );
    const recovery = await options.effectReconciler.reconcile(effect.effect_class, {
      effect, event:snapshot.event, node:snapshot.node, work:snapshot.work, attempt,
    });
    if (!recovery || typeof recovery.decision !== 'string') fail(
      'P4_EVENT_RECOVERY_CLASSIFICATION_INVALID',
      'Online Effect recovery classification did not return one typed decision.'
    );
    return Object.freeze({ eventId: request.eventId, effectId: request.effectId, ...recovery });
  }

  async function recover(request) {
    const allowed = new Set(['safe_retry', 'safe_retry_before_intent', 'continue_forward', 'observe_again', 'already_committed', 'already_failed', 'terminal_failure']);
    if (!request || typeof request !== 'object' || Array.isArray(request) ||
        typeof request.eventId !== 'string' || !allowed.has(request.decision)) fail(
      'P4_EVENT_RECOVERY_REQUEST_INVALID', 'Event recovery requires one classified recoverable action.'
    );
    const snapshot = readRecoverySnapshot(request.eventId);
    const attempt = snapshot.activeAttempt;
    const entry = options.registry.resolve(snapshot.event.capability_ref, snapshot.event.owner_domain);
    const policyBinding = options.attemptPolicy.bindingFor(snapshot.event.capability_ref, snapshot.node.effect_class);
    if (snapshot.node.effect_class !== entry.manifest.effectClass || !policyBinding ||
        attempt.executor_ref !== entry.manifest.capabilityRef || attempt.executor_version !== entry.executor.version) fail(
      'P4_EVENT_RECOVERY_CONTRACT_MISMATCH', 'Recovery cannot change the frozen Capability or Executor contract.'
    );
    if(request.decision==='already_committed'){
      const prebound=readPreboundCommittedOutcome(request.eventId,request.effectId,attempt,entry);
      if(prebound){await options.effectJournal.settle(Object.freeze({effectId:request.effectId,receipt:prebound.outcome.effectReceipt,scope:prebound.scope}));return completeCommittedEffect(snapshot,attempt.event_attempt_id,prebound.outcome);}
    }
    if(request.decision==='observe_again') {
      const effect=options.effectJournal.read(request.effectId),expectedIntent=valueDigest({eventId:request.eventId,capabilityRef:snapshot.event.capability_ref,
        contractVersion:snapshot.event.contract_version,inputSnapshotDigest:attempt.input_snapshot_digest,fenceSnapshotDigest:attempt.fence_snapshot_digest});
      if(!/^[a-f0-9]{64}$/.test(request.evidenceDigest||'')||!effect||effect.event_attempt_id!==attempt.event_attempt_id||
          effect.effect_class!==entry.manifest.effectClass||effect.intent_digest!==expectedIntent||
          !['workspace_write','material_commit'].includes(effect.effect_class)||
          !['intended','effect_observed','reconcile_required'].includes(effect.state))
        fail('P4_EVENT_RECOVERY_EFFECT_DRIFT','Observation-only recovery requires the exact active file Effect and immutable evidence.');
      const budget=options.effectJournal.beginRecoveryExecution(effect.effect_id),startedAtMs=Number(budget?.verified_at_ms);
      if(budget?.effect_id!==effect.effect_id||budget.event_attempt_id!==attempt.event_attempt_id||budget.effect_class!==effect.effect_class||
          budget.verified_at_ms===null||budget.verified_at_ms===undefined||!Number.isSafeInteger(startedAtMs)||startedAtMs<0)
        fail('P4_EVENT_RECOVERY_BUDGET_DRIFT','Observation-only recovery cannot change or renew its original durable budget.');
      const timing=options.attemptPolicy.prepare({capabilityRef:snapshot.event.capability_ref,effectClass:effect.effect_class,
        retryPolicyRef:policyBinding.retryPolicyRef,timeoutPolicyRef:policyBinding.timeoutPolicyRef,startedAtMs});
      if(options.now()<timing.deadlineAtMs)return Object.freeze({kind:'recovery_deferred',eventId:request.eventId,effectId:effect.effect_id});
      const outcome=Object.freeze({kind:'failed',failureClass:'integration',code:'P4_EVENT_RECOVERY_OBSERVATION_UNAVAILABLE',
        message:'File reality could not be observed within the original recovery budget.',retryDirective:'never',
        evidence:Object.freeze({effectId:effect.effect_id,recoveryEvidenceDigest:request.evidenceDigest,
          realityStatus:'unobservable',dispatchStarted:false,recoveryStartedAtMs:startedAtMs,deadlineAtMs:timing.deadlineAtMs})});
      options.effectJournal.abandonUncommitted(effect.effect_id);
      return complete(snapshot,attempt.event_attempt_id,outcome,Object.freeze({decision:'terminal_failure'}));
    }
    if(request.decision==='terminal_failure') {
      const effect=options.effectJournal.read(request.effectId),expectedIntent=valueDigest({eventId:request.eventId,capabilityRef:snapshot.event.capability_ref,
        contractVersion:snapshot.event.contract_version,inputSnapshotDigest:attempt.input_snapshot_digest,fenceSnapshotDigest:attempt.fence_snapshot_digest});
      if(!/^[a-f0-9]{64}$/.test(request.evidenceDigest||'')||!effect||effect.event_attempt_id!==attempt.event_attempt_id||
          effect.effect_class!==entry.manifest.effectClass||effect.intent_digest!==expectedIntent||
          !['intended','effect_observed','reconcile_required','failed'].includes(effect.state))
        fail('P4_EVENT_RECOVERY_EFFECT_DRIFT','Terminal recovery requires exact uncommitted intent and classified reality evidence.');
      const outcome=Object.freeze({kind:'failed',failureClass:'executor',code:'P4_EVENT_RECOVERY_REALITY_CONFLICT',
        message:'Recovery found conflicting effect reality.',retryDirective:'never',
        evidence:Object.freeze({effectId:effect.effect_id,recoveryEvidenceDigest:request.evidenceDigest,dispatchStarted:false})});
      const policyDecision=options.attemptPolicy.decideFailure(Object.freeze({capabilityRef:snapshot.event.capability_ref,effectClass:snapshot.node.effect_class,
        retryPolicyRef:policyBinding.retryPolicyRef,timeoutPolicyRef:policyBinding.timeoutPolicyRef,
        failureAttemptCount:snapshot.attempts.filter(item=>item.outcome_kind==='failed').length+1,outcome,recoveryDecision:request.decision}));
      if(effect.state!=='failed')options.effectJournal.abandonUncommitted(effect.effect_id);
      return complete(snapshot,attempt.event_attempt_id,outcome,policyDecision);
    }
    if (request.decision === 'already_failed') {
      const abandoned = options.effectJournal.read(request.effectId);
      if (!abandoned || abandoned.event_attempt_id !== attempt.event_attempt_id ||
          abandoned.effect_class !== entry.manifest.effectClass || abandoned.state !== 'failed') fail(
        'P4_EVENT_RECOVERY_EFFECT_DRIFT', 'Recovery Effect does not match the exact durable intent and Event Attempt.'
      );
      const outcome = Object.freeze({
        kind: 'failed', failureClass: 'executor', code: 'P4_EVENT_RECOVERY_EFFECT_ABANDONED',
        message: 'Recovery found the Event Attempt Effect already abandoned.',
        retryDirective: 'never',
        evidence: Object.freeze({ effectId: abandoned.effect_id, effectState: abandoned.state }),
      });
      const policyDecision = options.attemptPolicy.decideFailure(Object.freeze({
        capabilityRef: snapshot.event.capability_ref, effectClass: snapshot.node.effect_class,
        retryPolicyRef: policyBinding.retryPolicyRef, timeoutPolicyRef: policyBinding.timeoutPolicyRef,
        failureAttemptCount: snapshot.attempts.filter((item) => item.outcome_kind === 'failed').length + 1,
        outcome, recoveryDecision: request.decision,
      }));
      return complete(snapshot, attempt.event_attempt_id, outcome, policyDecision);
    }
    let preparationScope = Object.freeze({});
    let inputs;
    try {
      inputs = options.executionInputProvider.prepare(Object.freeze({ snapshot, preparationScope }));
      if (valueDigest(inputs.namedInputs) !== attempt.input_snapshot_digest) fail(
        'P4_EVENT_RECOVERY_INPUT_DRIFT', 'Recovery inputs differ from the durable Event Attempt snapshot.'
      );
    } catch (error) {
      if (error?.code === 'P4_EVENT_RECOVERY_INPUT_DRIFT' && entry.manifest.effectClass === 'pure_observation') {
        // Pure observation has no physical Effect to preserve. Re-prepare its
        // inputs on a new Attempt so a short-lived Platform Handle can rotate
        // across a restart/TTL without becoming a terminal identity failure.
        const outcome = Object.freeze({kind:'failed',failureClass:'input_projection',code:'P4_EVENT_RECOVERY_INPUT_DRIFT',
          message:'Recovery inputs differ from the durable Event Attempt snapshot.',retryDirective:'contract_policy',
          evidence:Object.freeze({originalInputDigest:attempt.input_snapshot_digest,dispatchStarted:false})});
        return complete(snapshot,attempt.event_attempt_id,outcome,Object.freeze({decision:'retry',retryAtMs:options.now()+30_000}));
      }
      if (error?.code === 'P4_EVENT_RECOVERY_INPUT_DRIFT' &&
          ['destructive_commit','workspace_write'].includes(entry.manifest.effectClass)) {
        // A recovered file or observation Effect cannot be replayed from
        // reconstructed inputs. Retrying would reproduce the same deterministic
        // drift forever. Fail the Event with explicit evidence and retain any
        // unresolved Effect for audit.
        const effect = request.effectId && options.effectJournal?.read ? options.effectJournal.read(request.effectId) : null,
          outcome = Object.freeze({kind:'failed',failureClass:'input_projection',code:'P4_EVENT_RECOVERY_INPUT_DRIFT',
            message:'Recovery inputs differ from the durable Event Attempt snapshot.',retryDirective:'never',
            evidence:Object.freeze({effectId:effect?.effect_id||null,effectState:effect?.state||null,
              originalInputDigest:attempt.input_snapshot_digest,dispatchStarted:effect?.state==='intended'?false:null})});
        return complete(snapshot,attempt.event_attempt_id,outcome,Object.freeze({decision:'terminal'}));
      }
      if(entry.manifest.effectClass==='pure_observation'&&request.decision==='safe_retry'&&isExecutionInputSuperseded(error)) {
        const outcome=Object.freeze({kind:'failed',failureClass:'input_projection',code:error.code,
          message:error.message,retryDirective:'never',evidence:Object.freeze({
            originalInputDigest:attempt.input_snapshot_digest,dispatchStarted:false})});
        const policyDecision=options.attemptPolicy.decideFailure(Object.freeze({
          capabilityRef:snapshot.event.capability_ref,effectClass:snapshot.node.effect_class,
          retryPolicyRef:policyBinding.retryPolicyRef,timeoutPolicyRef:policyBinding.timeoutPolicyRef,
          failureAttemptCount:snapshot.attempts.filter(item=>item.outcome_kind==='failed').length+1,
          outcome,recoveryDecision:request.decision}));
        return complete(snapshot,attempt.event_attempt_id,outcome,policyDecision);
      }
      // Only an exact, freshly proven absent atomic fact commit can end here.
      // Never infer absence for file effects or requests, or rebind old inputs.
      if (entry.manifest.effectClass !== 'domain_fact_commit' || request.decision !== 'safe_retry' ||
          isExecutionInputUnavailable(error) || typeof request.effectId !== 'string') throw error;
      const classification = await classifyRecovery({ eventId:request.eventId, effectId:request.effectId });
      if (classification.decision !== 'safe_retry' || classification.action !== 'revalidate_and_commit') throw error;
      const effect = options.effectJournal.read(request.effectId);
      const expectedIntent = valueDigest({ eventId:request.eventId, capabilityRef:snapshot.event.capability_ref,
        contractVersion:snapshot.event.contract_version, inputSnapshotDigest:attempt.input_snapshot_digest,
        fenceSnapshotDigest:attempt.fence_snapshot_digest });
      if (!effect || effect.event_attempt_id !== attempt.event_attempt_id ||
          effect.effect_class !== 'domain_fact_commit' || effect.intent_digest !== expectedIntent ||
          !['intended','effect_observed','reconcile_required'].includes(effect.state)) throw error;
      const outcome = Object.freeze({ kind:'failed', failureClass:'input_projection',
        code:typeof error?.code === 'string' ? error.code : 'P4_EVENT_RECOVERY_INPUT_PREPARATION_FAILED',
        message:String(error?.message || 'Recovery input preparation failed.'), retryDirective:'never',
        evidence:Object.freeze({ effectId:effect.effect_id, recoveryEvidenceDigest:classification.evidenceDigest,
          originalInputDigest:attempt.input_snapshot_digest, dispatchStarted:false }) });
      const policyDecision = options.attemptPolicy.decideFailure(Object.freeze({
        capabilityRef:snapshot.event.capability_ref, effectClass:snapshot.node.effect_class,
        retryPolicyRef:policyBinding.retryPolicyRef, timeoutPolicyRef:policyBinding.timeoutPolicyRef,
        failureAttemptCount:snapshot.attempts.filter(item=>item.outcome_kind === 'failed').length + 1,
        outcome, recoveryDecision:request.decision,
      }));
      options.effectJournal.abandonUncommitted(effect.effect_id);
      return complete(snapshot, attempt.event_attempt_id, outcome, policyDecision);
    }
    const fence = options.fenceValidator.validate(Object.freeze({ phase: 'protected_effect', snapshot, inputs }));
    if (!fence || fence.valid !== true || fence.digest !== attempt.fence_snapshot_digest) fail(
      'P4_EVENT_RECOVERY_FENCE_DRIFT', 'Recovery Fence no longer matches the durable Event Attempt.'
    );
    const demand = options.resourceDemandResolver.resolve(Object.freeze({ snapshot, inputs, preparationScope }));
    preparationScope = null;
    if (!demand || demand.eventId !== request.eventId) fail(
      'P4_EVENT_RECOVERY_RESOURCE_BINDING_MISMATCH', 'Recovery Resource Demand must bind the exact Event.'
    );
    const acquired = options.governor.acquireRecovery(demand);
    if (acquired.kind !== 'permitted') return Object.freeze({ kind: 'recovery_deferred', eventId: request.eventId, demand: acquired });
    const permit = acquired.permit;
    try {
      let effect = null;
      if (entry.manifest.effectClass !== 'pure_observation') {
        const intentDigest = valueDigest({ eventId: request.eventId, capabilityRef: snapshot.event.capability_ref,
          contractVersion: snapshot.event.contract_version, inputSnapshotDigest: valueDigest(inputs.namedInputs),
          fenceSnapshotDigest: fence.digest });
        if (request.decision === 'safe_retry_before_intent') effect = options.effectJournal.intend(Object.freeze({
          eventAttemptId: attempt.event_attempt_id, effectClass: entry.manifest.effectClass,
          idempotencyKey: inputs.idempotencyKey, intentDigest
        }));
        else {
          if (typeof request.effectId !== 'string') fail('P4_EVENT_RECOVERY_EFFECT_REQUIRED', 'Classified non-pure recovery requires its durable Effect identity.');
          effect = options.effectJournal.read(request.effectId);
        }
        if (!effect || effect.event_attempt_id !== attempt.event_attempt_id || effect.effect_class !== entry.manifest.effectClass ||
            effect.idempotency_key !== inputs.idempotencyKey || effect.intent_digest !== intentDigest || effect.state === 'failed') fail(
          'P4_EVENT_RECOVERY_EFFECT_DRIFT', 'Recovery Effect does not match the exact durable intent and Event Attempt.'
        );
      }
      const startedAtMs = Number(attempt.started_at_ms);
      if(!Number.isSafeInteger(startedAtMs)||startedAtMs<0)fail('P4_EVENT_RECOVERY_ATTEMPT_TIME_INVALID',
        'Recovery requires the original durable Event Attempt start time.');
      let timeoutStartedAtMs = startedAtMs;
      const requiresEffectRecoveryBudget = request.decision === 'continue_forward' ||
        (request.decision === 'safe_retry' && effect && entry.manifest.effectClass !== 'pure_observation');
      if (requiresEffectRecoveryBudget) {
        if (!effect || typeof options.effectJournal.beginRecoveryExecution !== 'function') fail(
          'P4_EVENT_RECOVERY_BUDGET_UNAVAILABLE',
          'Classified non-pure Effect recovery requires one durable recovery execution budget.'
        );
        const recoveryEffect = options.effectJournal.beginRecoveryExecution(effect.effect_id);
        const recoveryStartedAtMs = Number(recoveryEffect?.verified_at_ms);
        if (recoveryEffect?.effect_id !== effect.effect_id ||
            recoveryEffect.event_attempt_id !== attempt.event_attempt_id ||
            recoveryEffect.effect_class !== entry.manifest.effectClass ||
            !Number.isSafeInteger(recoveryStartedAtMs) || recoveryStartedAtMs < 0) fail(
          'P4_EVENT_RECOVERY_BUDGET_DRIFT',
          'Effect recovery budget does not bind the exact durable Effect and Event Attempt.'
        );
        timeoutStartedAtMs = recoveryStartedAtMs;
      }
      const attemptContract = options.attemptPolicy.prepare(Object.freeze({ capabilityRef: snapshot.event.capability_ref,
        effectClass: snapshot.node.effect_class, retryPolicyRef: policyBinding.retryPolicyRef,
        timeoutPolicyRef: policyBinding.timeoutPolicyRef, startedAtMs:timeoutStartedAtMs }));
      const context = {
        executionId: assertId(options.nextExecutionId(), 'recovery-execution'), workId: snapshot.work.work_id,
        workAttemptId: snapshot.workAttempt.attempt_id, planId: snapshot.plan.plan_id, eventId: request.eventId,
        eventAttemptId: attempt.event_attempt_id, capabilityRef: snapshot.event.capability_ref,
        contractVersion: snapshot.event.contract_version, executorVersion: entry.executor.version,
        ownerScope: inputs.ownerScope, basisRefs: inputs.basisRefs, namedInputs: inputs.namedInputs,
        parameters: JSON.parse(snapshot.node.parameters_json), fenceSnapshot: fence.snapshot,
        resourceLease: { leaseId: permit.permitId, resourceKeys: permit.resources.map((resource) => resource.resourceKey), issuedAtMs: permit.issuedAtMs },
        idempotencyKey: inputs.idempotencyKey, traceContext: inputs.traceContext, deadlineAtMs: attemptContract.deadlineAtMs
      };
      const executionGuard = { signal:null };
      const progressReporter = createProgressReporter({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork,
        eventId: request.eventId, eventAttemptId: attempt.event_attempt_id, now: clock });
      Object.defineProperty(context, 'reportProgress', {
        configurable: false, enumerable: false, writable: false,
        value: (sample) => { const result=progressReporter.report(sample);if(result.sampled)options.onProgress?.(Object.freeze({
          ownerDomain:snapshot.work.owner_domain,processType:snapshot.work.process_type,processId:snapshot.work.process_id,
          workId:snapshot.work.work_id,eventId:request.eventId })); return result; }
      });
      Object.defineProperties(context, {
        effectOccurredAtMs:{ configurable:false, enumerable:false, writable:false, value:attempt.started_at_ms },
        recoveryDecision:{ configurable:false, enumerable:false, writable:false, value:request.decision },
        progressFloor:{ configurable:false, enumerable:false, writable:false, value:progressReporter.floor() },
        abortSignal:{ configurable:false, enumerable:false, get:()=>executionGuard.signal },
        assertExecutionActive:{ configurable:false, enumerable:false, writable:false, value:()=>{
          if(executionGuard.signal?.aborted)throw executionGuard.signal.reason||Object.assign(
            new Error('Capability execution is no longer active.'),{code:'P4_COOPERATIVE_DEADLINE_EXCEEDED'});
        } },
      });
      if (inputs.approvalHandle !== undefined) context.approvalHandle = inputs.approvalHandle;
      if (inputs.authorizationHandle !== undefined) context.authorizationHandle = inputs.authorizationHandle;
      let outcome;
      let dispatchStarted = false;
      const recoveryBudgetExpiredBeforeDispatch = ['safe_retry','continue_forward'].includes(request.decision) &&
        entry.manifest.effectClass !== 'pure_observation' && clock() >= attemptContract.deadlineAtMs;
      try {
        outcome = await options.timeoutController.execute(Object.freeze({ executionHandleId: attempt.event_attempt_id,
          deadlineAtMs: attemptContract.deadlineAtMs, cooperativeAbortSafe:entry.executor.cooperativeAbortSafe===true,
          operation: (signal) => {
            dispatchStarted=true;
            executionGuard.signal=signal||null;
            return options.dispatcher.dispatch({ capabilityRef: snapshot.event.capability_ref,
              context: Object.freeze(context), ownerDomain: snapshot.event.owner_domain });
          } }));
        outcome = boundedObservationOutcome(entry, outcome);
      } catch (error) {
        if(error?.code==='P4_EXECUTION_SHUTDOWN_INTERRUPTED')throw error;
        outcome=cooperativeDeadlineOutcome(entry,error,attemptContract.deadlineAtMs);
        if (!outcome && error?.code === 'P4_EXECUTION_TIMEOUT' && recoveryBudgetExpiredBeforeDispatch && !dispatchStarted) {
          outcome = Object.freeze({ kind:'failed', failureClass:request.decision === 'continue_forward' ? 'timeout' : 'integration',
            code:'RECOVERY_EXECUTION_BUDGET_EXHAUSTED',
            message:'Effect recovery exhausted its durable execution budget before dispatch; unresolved effects require owner attention.',
            retryDirective:'never', evidence:Object.freeze({
              effectId:effect.effect_id, deadlineAtMs:attemptContract.deadlineAtMs,
              recoveryDecision:request.decision, dispatchStarted:false,
            }) });
        }
        if (!outcome && entry.manifest.effectClass !== 'pure_observation') throw error;
        if(!outcome)outcome = Object.freeze({ kind:'failed', failureClass:observationFailureClass(error),
          code:error?.code === 'P4_EXECUTION_TIMEOUT'?'EXECUTION_TIMEOUT':
            (typeof error?.code === 'string' && error.code ? error.code : 'EXECUTOR_ERROR'),
          message:String(error?.message || 'Pure observation recovery failed.'), retryDirective:'contract_policy',
          evidence:Object.freeze({ errorName:String(error?.name || 'Error'),
            errorCode:typeof error?.code === 'string' && error.code ? error.code : 'EXECUTOR_ERROR' }) });
      }
      if (entry.manifest.effectClass === 'pure_observation' && outcome?.kind !== 'succeeded') {
        let policyDecision = null;
        if (outcome?.kind === 'failed') policyDecision = options.attemptPolicy.decideFailure(Object.freeze({
          capabilityRef:snapshot.event.capability_ref,effectClass:snapshot.node.effect_class,
          retryPolicyRef:policyBinding.retryPolicyRef,timeoutPolicyRef:policyBinding.timeoutPolicyRef,
          failureAttemptCount:snapshot.attempts.filter((item)=>item.outcome_kind === 'failed').length + 1,
          outcome,recoveryDecision:request.decision,
        }));
        if (outcome?.kind === 'deferred') policyDecision = options.attemptPolicy.decideDeferred(Object.freeze({
          capabilityRef:snapshot.event.capability_ref,effectClass:snapshot.node.effect_class,
          retryPolicyRef:policyBinding.retryPolicyRef,timeoutPolicyRef:policyBinding.timeoutPolicyRef,
          observationCount:snapshot.attempts.filter((item)=>item.outcome_kind === 'deferred').length + 1,
          firstObservedAtMs:attempt.started_at_ms,retryAfterMs:outcome.retryAfterMs,
        }));
        if (!outcome || !['failed','deferred'].includes(outcome.kind)) fail(
          'P4_EVENT_RECOVERY_OUTCOME_INVALID', 'Pure observation recovery returned an invalid Outcome.');
        return complete(snapshot, attempt.event_attempt_id, outcome, policyDecision);
      }
      if (outcome?.kind === 'failed') {
        let abandonedUncommitted = false;
        if (effect) {
          if (request.decision !== 'continue_forward' && outcome.failureClass !== 'timeout' && typeof options.effectJournal.abandonUncommitted === 'function') {
            options.effectJournal.abandonUncommitted(effect.effect_id);
            abandonedUncommitted = true;
          } else {
            options.effectJournal.requireReconcile(effect.effect_id);
          }
        }
        let policyDecision = options.attemptPolicy.decideFailure(Object.freeze({
          capabilityRef:snapshot.event.capability_ref,effectClass:snapshot.node.effect_class,
          retryPolicyRef:policyBinding.retryPolicyRef,timeoutPolicyRef:policyBinding.timeoutPolicyRef,
          failureAttemptCount:snapshot.attempts.filter((item)=>item.outcome_kind === 'failed').length + 1,
          outcome,recoveryDecision:abandonedUncommitted ? 'safe_retry' : request.decision,
        }));
        // Match normal dispatch: a retired intent and explicit no-retry Outcome
        // cannot retain an executing Event, including recovery before intent.
        if (abandonedUncommitted && outcome.retryDirective === 'never')
          policyDecision = Object.freeze({ decision:'terminal_failure' });
        return complete(snapshot, attempt.event_attempt_id, outcome, policyDecision);
      }
      if (!outcome || outcome.kind !== 'succeeded') {
        if (effect) {
          if (outcome?.kind === 'deferred' && outcome.externalReceipt !== undefined)
            options.effectJournal.noteExternalPending(effect.effect_id, outcome.externalReceipt);
          options.effectJournal.requireReconcile(effect.effect_id);
        }
        fail('P4_EVENT_RECOVERY_NOT_CONVERGED', 'Recovery replay did not produce a terminal successful Outcome.', {
          eventId: request.eventId, outcomeKind: outcome && outcome.kind
        });
      }
      if (effect) await options.effectJournal.settle(Object.freeze({ effectId: effect.effect_id, receipt: outcome.effectReceipt,
        scope: Object.freeze({ ownerDomain: inputs.ownerScope.domain, scopeType: inputs.ownerScope.processType, scopeId: inputs.ownerScope.processId }) }));
      return effect
        ? completeCommittedEffect(snapshot, attempt.event_attempt_id, outcome)
        : complete(snapshot, attempt.event_attempt_id, outcome, null);
    } finally {
      options.governor.release(permit);
    }
  }

  return Object.freeze({
    classifyRecovery,
    recover,
    retryPendingCompletion,
    beginShutdown() { return options.governor.abandonWaiters(); },
    async run(request) {
      if (!request || typeof request !== 'object' || Array.isArray(request) ||
          JSON.stringify(Object.keys(request)) !== JSON.stringify(['schedulerLease'])) fail(
        'P4_EVENT_RUNTIME_REQUEST_INVALID', 'Event Runtime accepts only one Scheduler technical lease.'
      );
      options.scheduler.assertCurrent(request.schedulerLease);
      const eventId = request.schedulerLease.targetType === 'event' ? request.schedulerLease.targetId : null;
      if (!eventId) fail('P4_EVENT_RUNTIME_LEASE_TARGET_INVALID', 'Event Runtime requires an Event technical lease.');
      let schedulerReleased = false; let permit = null; let persistedAttemptId = null; let demand = null;
      let resourceRequestedAtMs = null; let resourceOutcome = 'executor_error';
      try {
        const snapshot = readSnapshot(eventId);
        function checkOwner(){
          if(!options.dispatchGuard)return {kind:'not_applicable',readFence:null};
          let decision;
          try{decision=options.dispatchGuard.check(Object.freeze({ownerDomain:snapshot.work.owner_domain,processType:snapshot.work.process_type,
            processId:snapshot.work.process_id,workKind:snapshot.work.work_kind,executionBasisDigest:snapshot.work.basis_digest,
            workId:snapshot.work.work_id,eventId}));}
          catch(error){if(error?.code==='P3_UOW_READ_FENCE_CHANGED')return {kind:'pending',reasonCode:'owner_view_changed'};throw error;}
          if(!decision||typeof decision!=='object'||Array.isArray(decision)||!['ready','pending','not_applicable'].includes(decision.kind))
            fail('P4_EVENT_OWNER_GUARD_INVALID','Owner dispatch guard returned an invalid decision.');
          const keys=Object.keys(decision).sort().join(',');
          if(decision.kind==='pending'){
            if(keys!=='kind,reasonCode'||typeof decision.reasonCode!=='string'||!/^[-a-zA-Z0-9_.]{1,128}$/.test(decision.reasonCode))
              fail('P4_EVENT_OWNER_GUARD_INVALID','Owner dispatch deferral requires a bounded reason.');
            return decision;
          }
          if(decision.kind==='ready'){
            if(keys!=='kind,readFence'||!decision.readFence||typeof decision.readFence!=='object'||
                !/^[a-f0-9]{64}$/.test(snapshot.work.basis_digest||''))
              fail('P4_EVENT_OWNER_GUARD_INVALID','Ready Owner dispatch requires an opaque read fence.');
            let current;
            try{current=options.unitOfWork.execute([{participantId:'event_owner_scope_read',owner:'execution-foundation',
              repositories:[repositories.works,repositories.workAttempts,repositories.plans],execute(context){return {
                work:context.repository('runtime_works').invoke('find',{work_id:snapshot.work.work_id}),
                attempt:context.repository('runtime_work_attempts').invoke('find',{attempt_id:snapshot.workAttempt.attempt_id}),
                plan:context.repository('runtime_plans').invoke('find',{plan_id:snapshot.plan.plan_id})};}}],
              {readFence:decision.readFence}).event_owner_scope_read;}
            catch(error){if(error?.code==='P3_UOW_READ_FENCE_CHANGED')return {kind:'pending',reasonCode:'owner_view_changed'};throw error;}
            if(!current.work||['owner_domain','process_type','process_id','work_kind','basis_digest'].some(key=>current.work[key]!==snapshot.work[key])||
                !['ready','running'].includes(current.work.state)||!current.attempt||current.attempt.work_id!==snapshot.work.work_id||
                !['ready','running'].includes(current.attempt.state)||current.attempt.basis_digest!==snapshot.work.basis_digest||
                !current.plan||current.plan.attempt_id!==current.attempt.attempt_id||current.plan.state!=='planned'||
                current.plan.basis_digest!==snapshot.work.basis_digest)
              fail('P4_EVENT_OWNER_SCOPE_CHANGED','The Event Work scope changed before Owner qualification.');
            return decision;
          }
          if(keys!=='kind')fail('P4_EVENT_OWNER_GUARD_INVALID','Unscoped Owner dispatch must be explicit.');
          return {kind:'not_applicable',readFence:null};
        }
        function ownerWait(reasonCode){
          options.scheduler.noteDispatchOutcome?.(request.schedulerLease,Object.freeze({kind:'owner_wait'}));
          options.scheduler.release(request.schedulerLease);schedulerReleased=true;
          return Object.freeze({kind:'owner_deferred',eventId,reasonCode});
        }
        function guardedOwnerWrite(write){
          const decision=checkOwner();
          if(decision.kind==='pending')return {deferred:true,result:ownerWait(decision.reasonCode)};
          try{return {deferred:false,result:write(decision.readFence)};}
          catch(error){
            if(decision.readFence&&error?.code==='P3_UOW_READ_FENCE_CHANGED')
              return {deferred:true,result:ownerWait('owner_view_changed')};
            throw error;
          }
        }
        const entry = options.registry.resolve(snapshot.event.capability_ref, snapshot.event.owner_domain);
        const policyBinding = options.attemptPolicy.bindingFor(snapshot.event.capability_ref, snapshot.node.effect_class);
        if (snapshot.node.effect_class !== entry.manifest.effectClass || !policyBinding) fail(
          'P4_EVENT_FROZEN_CONTRACT_MISMATCH', 'Durable Plan execution contracts do not match the exact Capability version.'
        );
        const requiresJournal = entry.manifest.effectClass !== 'pure_observation';
        if (requiresJournal && (!options.effectJournal || typeof options.effectJournal.intend !== 'function' ||
            typeof options.effectJournal.settle !== 'function' || typeof options.effectJournal.requireReconcile !== 'function' ||
            typeof options.effectJournal.noteExternalPending !== 'function')) fail(
          'P4_EVENT_EFFECT_JOURNAL_REQUIRED', 'Every non-pure Event requires the Effect Journal before dispatch.'
        );
        const preparationWait = snapshot.event.state === 'waiting_for_resource'
          ? options.governor.preparationWait?.(eventId) : null;
        if (preparationWait) {
          options.scheduler.noteDispatchOutcome?.(request.schedulerLease, Object.freeze({ kind:'resource_wait' }));
          options.scheduler.release(request.schedulerLease); schedulerReleased = true;
          return preparationWait;
        }
        const initialOwner=checkOwner();
        if(initialOwner.kind==='pending')return ownerWait(initialOwner.reasonCode);
        let preparationScope = Object.freeze({});
        let inputs;
        try {
          inputs = options.executionInputProvider.prepare(Object.freeze({ snapshot, preparationScope }));
        } catch (error) {
          const recorded=guardedOwnerWrite(readFence=>recordInputPreparationOutcome(snapshot,error,readFence));
          if(recorded.deferred)return recorded.result;
          options.scheduler.release(request.schedulerLease);
          schedulerReleased = true;
          return recorded.result;
        }
        if (((entry.manifest.approvalRequirementRef || null) !== null) !== (inputs.approvalHandle !== undefined) ||
            ((entry.manifest.authorizationRequirementRef || null) !== null) !== (inputs.authorizationHandle !== undefined)) fail(
          'P4_EVENT_REQUIRED_HANDLE_MISMATCH', 'Execution inputs must carry exactly the approval and authorization required by the durable Plan.'
        );
        for (const circuitKey of ['foundation/event-dispatch', 'owner/' + snapshot.event.owner_domain + '/event-dispatch']) {
          const decision = options.circuitBreaker.allows(Object.freeze({ circuitKey, mode: 'ordinary',
            priorityClass: snapshot.event.priority_class, effectClass: snapshot.node.effect_class,
            started: false, irreversibleBoundaryCrossed: false }));
          if (!decision || decision.allowed !== true) {
            options.scheduler.noteDispatchOutcome?.(request.schedulerLease, Object.freeze({ kind:'circuit_wait' }));
            options.scheduler.release(request.schedulerLease); schedulerReleased = true;
            return Object.freeze({ kind: 'circuit_deferred', eventId, circuitKey, reason: decision && decision.reason || 'circuit_fail_closed' });
          }
        }
        const startedAtMs = clock();
        const attemptContract = options.attemptPolicy.prepare(Object.freeze({
          capabilityRef: snapshot.event.capability_ref, effectClass: snapshot.node.effect_class,
          retryPolicyRef: policyBinding.retryPolicyRef, timeoutPolicyRef: policyBinding.timeoutPolicyRef, startedAtMs
        }));
        if (!attemptContract || !Number.isSafeInteger(attemptContract.deadlineAtMs) || attemptContract.deadlineAtMs <= startedAtMs ||
            (inputs.deadlineAtMs !== undefined && inputs.deadlineAtMs !== attemptContract.deadlineAtMs)) fail(
          'P4_EVENT_TIMEOUT_POLICY_MISMATCH', 'Execution deadline must come only from the frozen Timeout Policy.'
        );
        const attemptId = assertId(options.nextEventAttemptId(), 'event-attempt');
        const firstFence = options.fenceValidator.validate(Object.freeze({ phase: 'dispatch', snapshot, inputs }));
        if (!firstFence || firstFence.valid !== true) {
          const recorded=guardedOwnerWrite(readFence=>recordFenceRejected(snapshot,entry,attemptId,startedAtMs,
            firstFence||{actualDigest:valueDigest({missing:true})},readFence));
          if(recorded.deferred)return recorded.result;
          options.scheduler.release(request.schedulerLease); schedulerReleased = true;
          return recorded.result;
        }
        demand = options.resourceDemandResolver.resolve(Object.freeze({ snapshot, inputs, preparationScope }));
        preparationScope = null;
        if (!demand || demand.eventId !== eventId) fail('P4_EVENT_RESOURCE_DEMAND_BINDING_MISMATCH', 'Resolved Resource Demand must bind the current Event.');
        if(options.incidentObserver){const decision=options.incidentObserver.prepareExecution(Object.freeze({
          ownerDomain:snapshot.work.owner_domain,processType:snapshot.work.process_type,workKind:snapshot.work.work_kind,
          workId:snapshot.work.work_id,resourceKeys:Object.freeze(demand.resources.map((item)=>item.resourceKey))}));
          if(!decision?.allowed){options.scheduler.noteDispatchOutcome?.(request.schedulerLease,Object.freeze({kind:'circuit_wait'}));
            options.scheduler.release(request.schedulerLease);schedulerReleased=true;return Object.freeze({kind:'circuit_deferred',eventId,
            circuitKey:decision?.circuitKey||null,reason:decision?.reason||'incident_circuit_open'});}}
        if(snapshot.event.state==='waiting_for_external'){
          const promoted=guardedOwnerWrite(readFence=>promoteExternalWaitToReady(snapshot,readFence));
          if(promoted.deferred)return promoted.result;
        }
        resourceRequestedAtMs = clock();
        const acquired = options.governor.acquire(demand);
        if (acquired.kind !== 'permitted') {
          options.scheduler.noteDispatchOutcome?.(request.schedulerLease, Object.freeze({ kind:'resource_wait' }));
          options.scheduler.release(request.schedulerLease); schedulerReleased = true;
          return acquired;
        }
        permit = acquired.permit;
        const commitFence = options.fenceValidator.validate(Object.freeze({ phase: 'protected_effect', snapshot, inputs }));
        if (!commitFence || commitFence.valid !== true) {
          const recorded=guardedOwnerWrite(readFence=>recordFenceRejected(snapshot,entry,attemptId,startedAtMs,
            commitFence||{actualDigest:valueDigest({missing:true})},readFence));
          if(recorded.deferred)return recorded.result;
          options.scheduler.release(request.schedulerLease); schedulerReleased = true;
          return recorded.result;
        }
        if (firstFence.digest !== commitFence.digest) {
          const recorded=guardedOwnerWrite(readFence=>recordFenceRejected(snapshot, entry, attemptId, startedAtMs, {
            actualDigest: commitFence.digest,
            evidence: { reasonCode: 'FENCE_CHANGED_BEFORE_EFFECT', expectedDigest: firstFence.digest, actualDigest: commitFence.digest }
          },readFence));
          if(recorded.deferred)return recorded.result;
          options.scheduler.release(request.schedulerLease); schedulerReleased = true;
          persistedAttemptId = attemptId; resourceOutcome = 'fence_rejected';
          return recorded.result;
        }
        const begun=guardedOwnerWrite(readFence=>{
          options.scheduler.noteDispatchOutcome?.(request.schedulerLease,Object.freeze({kind:'started'}));
          return beginAttempt(snapshot,entry,attemptId,startedAtMs,inputs,commitFence,readFence);
        });
        if(begun.deferred)return begun.result;
        persistedAttemptId = attemptId;
        let effect = null;
        if (requiresJournal) {
          effect = options.effectJournal.intend(Object.freeze({
            eventAttemptId: attemptId, effectClass: entry.manifest.effectClass, idempotencyKey: inputs.idempotencyKey,
            intentDigest: valueDigest({ eventId, capabilityRef: snapshot.event.capability_ref, contractVersion: snapshot.event.contract_version,
              inputSnapshotDigest: valueDigest(inputs.namedInputs), fenceSnapshotDigest: commitFence.digest })
          }));
          if (!effect || effect.state !== 'intended' || effect.event_attempt_id !== attemptId) fail(
            'P4_EVENT_EFFECT_RECOVERY_REQUIRED', 'An existing or terminal Effect intent must return to effect-specific recovery, not ordinary dispatch.'
          );
        }
        options.scheduler.release(request.schedulerLease); schedulerReleased = true;
        const context = {
          executionId: assertId(options.nextExecutionId(), 'execution'), workId: snapshot.work.work_id,
          workAttemptId: snapshot.workAttempt.attempt_id, planId: snapshot.plan.plan_id, eventId,
          eventAttemptId: attemptId, capabilityRef: snapshot.event.capability_ref, contractVersion: snapshot.event.contract_version,
          executorVersion: entry.executor.version, ownerScope: inputs.ownerScope, basisRefs: inputs.basisRefs,
          namedInputs: inputs.namedInputs, parameters: JSON.parse(snapshot.node.parameters_json), fenceSnapshot: commitFence.snapshot,
          resourceLease: { leaseId: permit.permitId, resourceKeys: permit.resources.map((resource) => resource.resourceKey), issuedAtMs: permit.issuedAtMs },
          idempotencyKey: inputs.idempotencyKey, traceContext: inputs.traceContext
        };
        const executionGuard = { signal:null };
        const progressReporter = createProgressReporter({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork,
          eventId, eventAttemptId: attemptId, now: clock });
        // Runtime-only ports remain non-enumerable so the exact serializable
        // CapabilityExecutionContext contract stays unchanged.
        Object.defineProperty(context, 'reportProgress', {
          configurable: false, enumerable: false, writable: false,
          value: (sample) => { const result=progressReporter.report(sample);if(result.sampled)options.onProgress?.(Object.freeze({
            ownerDomain:snapshot.work.owner_domain,processType:snapshot.work.process_type,processId:snapshot.work.process_id,
            workId:snapshot.work.work_id,eventId })); return result; }
        });
        Object.defineProperties(context, {
          effectOccurredAtMs:{ configurable:false, enumerable:false, writable:false, value:startedAtMs },
          recoveryDecision:{ configurable:false, enumerable:false, writable:false, value:null },
          progressFloor:{ configurable:false, enumerable:false, writable:false, value:progressReporter.floor() },
          abortSignal:{ configurable:false, enumerable:false, get:()=>executionGuard.signal },
          assertExecutionActive:{ configurable:false, enumerable:false, writable:false, value:()=>{
            if(executionGuard.signal?.aborted)throw executionGuard.signal.reason||Object.assign(
              new Error('Capability execution is no longer active.'),{code:'P4_COOPERATIVE_DEADLINE_EXCEEDED'});
          } },
        });
        if (inputs.approvalHandle !== undefined) context.approvalHandle = inputs.approvalHandle;
        if (inputs.authorizationHandle !== undefined) context.authorizationHandle = inputs.authorizationHandle;
        context.deadlineAtMs = attemptContract.deadlineAtMs;
        let outcome;
        try {
          outcome = await options.timeoutController.execute(Object.freeze({
            executionHandleId: attemptId, deadlineAtMs: attemptContract.deadlineAtMs,
            cooperativeAbortSafe:entry.executor.cooperativeAbortSafe===true,
            operation: (signal) => { executionGuard.signal=signal||null;return options.dispatcher.dispatch({ capabilityRef: snapshot.event.capability_ref,
              context: Object.freeze(context), ownerDomain: snapshot.event.owner_domain }); }
          }));
          outcome = boundedObservationOutcome(entry, outcome);
        } catch (error) {
          if(error?.code==='P4_EXECUTION_SHUTDOWN_INTERRUPTED')throw error;
          outcome=cooperativeDeadlineOutcome(entry,error,attemptContract.deadlineAtMs);
          if(!outcome){
            if (error?.code === 'P4_EXECUTION_TIMEOUT') {
              outcome = Object.freeze({ kind: 'failed', failureClass: 'timeout', code: 'EXECUTION_TIMEOUT',
                message: 'Capability execution exceeded its frozen timeout.', retryDirective: 'contract_policy',
                evidence: Object.freeze({ deadlineAtMs: attemptContract.deadlineAtMs }) });
            } else if (!requiresJournal) {
              // A pure observation has no external effect to reconcile.  Leaving
              // its durable Attempt in `executing` would manufacture an
              // unrecoverable crash window, so preserve the failure as an
              // ordinary policy-controlled Capability outcome.
              outcome = Object.freeze({ kind:'failed', failureClass:observationFailureClass(error),
                code:typeof error?.code === 'string' && error.code ? error.code : 'EXECUTOR_ERROR',
                message:String(error?.message || 'Pure observation executor failed.'),
                retryDirective:'contract_policy', evidence:Object.freeze({
                  errorName:String(error?.name || 'Error'),
                  errorCode:typeof error?.code === 'string' && error.code ? error.code : 'EXECUTOR_ERROR',
                  diagnostics:failureDiagnostics(error),
                }) });
            } else {
              const uncertain = options.effectJournal.requireReconcile(effect.effect_id);
              resourceOutcome = 'reconcile_required';
              return Object.freeze({
                kind:'effect_recovery_required', eventId, effectId:uncertain.effect_id,
                failureCode:typeof error?.code === 'string' && error.code ? error.code : 'EXECUTOR_ERROR',
                failureMessage:String(error?.message || 'Non-pure Capability execution became uncertain.'),
              });
            }
          }
        }
        let abandonedUncommitted = false;
        if (effect) {
          if (outcome.kind === 'succeeded') await options.effectJournal.settle(Object.freeze({
            effectId: effect.effect_id, receipt: outcome.effectReceipt,
            scope: Object.freeze({ ownerDomain: inputs.ownerScope.domain, scopeType: inputs.ownerScope.processType, scopeId: inputs.ownerScope.processId })
          }));
          else if (outcome.kind === 'failed' && outcome.failureClass !== 'timeout' &&
              typeof options.effectJournal.abandonUncommitted === 'function') {
            options.effectJournal.abandonUncommitted(effect.effect_id);
            abandonedUncommitted = true;
          } else {
            if (outcome.kind === 'deferred' && outcome.externalReceipt !== undefined) {
              options.effectJournal.noteExternalPending(effect.effect_id, outcome.externalReceipt);
            }
            options.effectJournal.requireReconcile(effect.effect_id);
          }
        }
        let policyDecision = null;
        if (outcome.kind === 'failed') {
          policyDecision = options.attemptPolicy.decideFailure(Object.freeze({
            capabilityRef: snapshot.event.capability_ref, effectClass: snapshot.node.effect_class,
            retryPolicyRef: policyBinding.retryPolicyRef, timeoutPolicyRef: policyBinding.timeoutPolicyRef,
            failureAttemptCount: snapshot.attempts.filter((attempt) => attempt.outcome_kind === 'failed').length + 1,
            // A failed Capability has explicitly ended its uncommitted Effect.
            // Apply the frozen retry budget instead of waiting for a reconcile
            // that cannot resume this terminal journal row.
            outcome, recoveryDecision: abandonedUncommitted ? 'safe_retry' : null
          }));
          // Capability returned failed before any durable Effect and forbade
          // retry.  The uncommitted journal row is already abandoned, so the
          // Event can fail closed instead of waiting for reconcile.
          if (abandonedUncommitted && outcome.retryDirective === 'never') {
            policyDecision = Object.freeze({ decision: 'terminal_failure' });
          }
        }
        if (outcome.kind === 'deferred') {
          const prior = snapshot.attempts.filter((attempt) => attempt.outcome_kind === 'deferred');
          policyDecision = options.attemptPolicy.decideDeferred(Object.freeze({
            capabilityRef: snapshot.event.capability_ref, effectClass: snapshot.node.effect_class,
            retryPolicyRef: policyBinding.retryPolicyRef, timeoutPolicyRef: policyBinding.timeoutPolicyRef,
            observationCount: prior.length + 1,
            firstObservedAtMs: prior.length ? Math.min(...prior.map((attempt) => attempt.started_at_ms)) : startedAtMs,
            retryAfterMs: outcome.retryAfterMs
          }));
        }
        resourceOutcome = outcome.kind;
        return effect && outcome.kind === 'succeeded'
          ? completeCommittedEffect(snapshot, attemptId, outcome)
          : complete(snapshot, attemptId, outcome, policyDecision);
      } finally {
        if (permit) {
          options.governor.release(permit);
          if (persistedAttemptId) recordResourceTimings(persistedAttemptId, permit, demand, resourceRequestedAtMs, clock(), resourceOutcome);
        }
        if (!schedulerReleased) options.scheduler.release(request.schedulerLease);
      }
    }
  });
}

module.exports = Object.freeze({ EventRuntimeError, createEventRuntime, observationFailureClass });
