'use strict';

const { digest } = require('../persistence/ddl-compiler');
const { createRepositoryDefinition } = require('../persistence/owner-repository');
const {
  isExecutionInputUnavailable,
} = require('./execution-input-readiness');
const { createProgressReporter } = require('./progress-reporter');

class EventRuntimeError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'EventRuntimeError'; this.code = code; this.details = details; }
}

function fail(code, message, details) { throw new EventRuntimeError(code, message, details); }

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonical(value[key]); return result;
  }, {});
  return value;
}

function json(value) { return JSON.stringify(canonical(value)); }
function valueDigest(value) { return digest(json(value)); }
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
      ], keyColumns: [] },
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
      ], keyColumns: [] }
    } }),
    edges: createRepositoryDefinition({ repositoryId: 'runtime_edges', owner: 'execution-foundation', schemaManifest, statements: {
      list: { kind: 'select-all', tableId: 'fx_plan_edges', columns: ['plan_id', 'from_node_id', 'to_node_id', 'dependency_kind'], keyColumns: [] }
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
      ], keyColumns: [] },
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
        'result_id', 'event_id', 'result_schema_ref', 'result_json', 'result_digest',
        'evidence_schema_ref', 'evidence_json', 'evidence_digest', 'effect_receipt_id'
      ], keyColumns: ['event_id'] },
      list: { kind: 'select-all', tableId: 'fx_event_result_bindings', columns: [
        'event_id', 'outcome_kind', 'result_schema_ref', 'result_json', 'evidence_schema_ref', 'evidence_json', 'effect_receipt_id'
      ], keyColumns: [] },
      insert: { kind: 'insert', tableId: 'fx_event_result_bindings', columns: [
        'result_id', 'event_id', 'outcome_kind', 'result_schema_ref', 'result_json', 'result_digest', 'evidence_schema_ref',
        'evidence_json', 'evidence_digest', 'effect_receipt_id', 'committed_at_ms'
      ] }
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
  if (!options || !options.schemaManifest || !options.unitOfWork || !options.scheduler || !options.governor || !options.registry ||
      !options.dispatcher || !options.executionInputProvider || !options.fenceValidator || !options.resourceDemandResolver ||
      !options.attemptPolicy || typeof options.attemptPolicy.prepare !== 'function' ||
      typeof options.attemptPolicy.bindingFor !== 'function' ||
      typeof options.attemptPolicy.decideFailure !== 'function' || typeof options.attemptPolicy.decideDeferred !== 'function' ||
      !options.timeoutController || typeof options.timeoutController.execute !== 'function' ||
      !options.circuitBreaker || typeof options.circuitBreaker.allows !== 'function' ||
      !options.whenEvaluator || typeof options.whenEvaluator.evaluate !== 'function' ||
      requiredFunctions.some((name) => typeof options[name] !== 'function')) fail(
    'P4_EVENT_RUNTIME_DEPENDENCIES_REQUIRED', 'Event Runtime requires exact persistence, scheduler, Governor, Registry, Dispatcher, typed providers, IDs, and clock.'
  );
  const repositories = definitions(options.schemaManifest);

  function advancePlan(context, planId) {
    const events = context.repository('runtime_events').invoke('list').filter((event) => event.plan_id === planId);
    const nodes = context.repository('runtime_nodes').invoke('list').filter((node) => node.plan_id === planId);
    const edges = context.repository('runtime_edges').invoke('list').filter((edge) => edge.plan_id === planId);
    const results = new Map(context.repository('runtime_results').invoke('list').map((result) => [result.event_id, result]));
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
        const attempts = context.repository('runtime_event_attempts').invoke('list').filter((attempt) => attempt.event_id === eventId);
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
        const attempts = context.repository('runtime_event_attempts').invoke('list').filter((attempt) => attempt.event_id === eventId);
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

  function clock() {
    const atMs = options.now();
    if (!Number.isSafeInteger(atMs) || atMs < 0) fail('P4_EVENT_RUNTIME_CLOCK_INVALID', 'Event Runtime clock must return epoch milliseconds.');
    return atMs;
  }

  function assertId(value, kind) {
    if (typeof value !== 'string' || !value) fail('P4_EVENT_RUNTIME_ID_INVALID', 'Runtime ID source returned invalid identity.', { kind });
    return value;
  }

  function recordFenceRejected(snapshot, entry, attemptId, startedAtMs, fence) {
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
    }]);
    return Object.freeze({ kind: 'fence_rejected', eventId: snapshot.event.event_id, eventAttemptId: attemptId });
  }

  function recordInputPreparationOutcome(snapshot, error) {
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
          const attempts = context.repository('runtime_event_attempts').invoke('list')
            .filter((attempt) => attempt.event_id === event.event_id);
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
    }]);
    if(!unavailable&&typeof options.governor.abandon==='function')options.governor.abandon(snapshot.event.event_id);
    return Object.freeze({
      kind: unavailable ? 'input_waiting' : 'input_failed',
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

  function promoteExternalWaitToReady(snapshot) {
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
    }]);
  }

  function beginAttempt(snapshot, entry, attemptId, startedAtMs, inputs, fence) {
    options.unitOfWork.execute([{
      participantId: 'event_runtime_begin', owner: 'execution-foundation', repositories: Object.values(repositories), execute(context) {
        const event = context.repository('runtime_events').invoke('find', { event_id: snapshot.event.event_id });
        if (!event || !DISPATCHABLE_EVENT_STATES.has(event.state))
          fail('P4_EVENT_BEGIN_STATE_CHANGED', 'Event changed before Attempt creation.');
        const attempts = context.repository('runtime_event_attempts').invoke('list').filter((attempt) => attempt.event_id === event.event_id);
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
    }]);
  }

  function complete(snapshot, attemptId, outcome, policyDecision = null) {
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

  async function recover(request) {
    const allowed = new Set(['safe_retry', 'safe_retry_before_intent', 'continue_forward', 'already_committed']);
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
    const inputs = options.executionInputProvider.prepare(Object.freeze({ snapshot }));
    if (valueDigest(inputs.namedInputs) !== attempt.input_snapshot_digest) fail(
      'P4_EVENT_RECOVERY_INPUT_DRIFT', 'Recovery inputs differ from the durable Event Attempt snapshot.'
    );
    const fence = options.fenceValidator.validate(Object.freeze({ phase: 'protected_effect', snapshot, inputs }));
    if (!fence || fence.valid !== true || fence.digest !== attempt.fence_snapshot_digest) fail(
      'P4_EVENT_RECOVERY_FENCE_DRIFT', 'Recovery Fence no longer matches the durable Event Attempt.'
    );
    const demand = options.resourceDemandResolver.resolve(Object.freeze({ snapshot, inputs }));
    if (!demand || demand.eventId !== request.eventId) fail(
      'P4_EVENT_RECOVERY_RESOURCE_BINDING_MISMATCH', 'Recovery Resource Demand must bind the exact Event.'
    );
    const acquired = options.governor.acquire(demand);
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
      const startedAtMs = clock();
      const attemptContract = options.attemptPolicy.prepare(Object.freeze({ capabilityRef: snapshot.event.capability_ref,
        effectClass: snapshot.node.effect_class, retryPolicyRef: policyBinding.retryPolicyRef,
        timeoutPolicyRef: policyBinding.timeoutPolicyRef, startedAtMs }));
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
      const progressReporter = createProgressReporter({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork,
        eventId: request.eventId, eventAttemptId: attempt.event_attempt_id, now: clock });
      Object.defineProperty(context, 'reportProgress', {
        configurable: false, enumerable: false, writable: false,
        value: (sample) => { const result=progressReporter.report(sample); options.onProgress?.(Object.freeze({
          ownerDomain:snapshot.work.owner_domain,processType:snapshot.work.process_type,processId:snapshot.work.process_id,
          workId:snapshot.work.work_id,eventId:request.eventId })); return result; }
      });
      if (inputs.approvalHandle !== undefined) context.approvalHandle = inputs.approvalHandle;
      if (inputs.authorizationHandle !== undefined) context.authorizationHandle = inputs.authorizationHandle;
      let outcome;
      try {
        outcome = await options.timeoutController.execute(Object.freeze({ executionHandleId: attempt.event_attempt_id,
          deadlineAtMs: attemptContract.deadlineAtMs, operation: () => options.dispatcher.dispatch({
            capabilityRef: snapshot.event.capability_ref, context: Object.freeze(context), ownerDomain: snapshot.event.owner_domain
          }) }));
      } catch (error) {
        if (entry.manifest.effectClass !== 'pure_observation') throw error;
        outcome = Object.freeze({ kind:'failed', failureClass:error?.code === 'P4_EXECUTION_TIMEOUT'?'timeout':'executor',
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
      return complete(snapshot, attempt.event_attempt_id, outcome, null);
    } finally {
      options.governor.release(permit);
    }
  }

  return Object.freeze({
    recover,
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
        let inputs;
        try {
          inputs = options.executionInputProvider.prepare(Object.freeze({ snapshot }));
        } catch (error) {
          options.scheduler.release(request.schedulerLease);
          schedulerReleased = true;
          return recordInputPreparationOutcome(snapshot, error);
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
          options.scheduler.release(request.schedulerLease); schedulerReleased = true;
          return recordFenceRejected(snapshot, entry, attemptId, startedAtMs, firstFence || { actualDigest: valueDigest({ missing: true }) });
        }
        demand = options.resourceDemandResolver.resolve(Object.freeze({ snapshot, inputs }));
        if (!demand || demand.eventId !== eventId) fail('P4_EVENT_RESOURCE_DEMAND_BINDING_MISMATCH', 'Resolved Resource Demand must bind the current Event.');
        promoteExternalWaitToReady(snapshot);
        resourceRequestedAtMs = clock();
        const acquired = options.governor.acquire(demand);
        if (acquired.kind !== 'permitted') {
          options.scheduler.release(request.schedulerLease); schedulerReleased = true;
          return acquired;
        }
        permit = acquired.permit;
        const commitFence = options.fenceValidator.validate(Object.freeze({ phase: 'protected_effect', snapshot, inputs }));
        if (!commitFence || commitFence.valid !== true) {
          options.scheduler.release(request.schedulerLease); schedulerReleased = true;
          return recordFenceRejected(snapshot, entry, attemptId, startedAtMs, commitFence || { actualDigest: valueDigest({ missing: true }) });
        }
        if (firstFence.digest !== commitFence.digest) {
          options.scheduler.release(request.schedulerLease); schedulerReleased = true;
          const rejected = recordFenceRejected(snapshot, entry, attemptId, startedAtMs, {
            actualDigest: commitFence.digest,
            evidence: { reasonCode: 'FENCE_CHANGED_BEFORE_EFFECT', expectedDigest: firstFence.digest, actualDigest: commitFence.digest }
          });
          persistedAttemptId = attemptId; resourceOutcome = 'fence_rejected';
          return rejected;
        }
        beginAttempt(snapshot, entry, attemptId, startedAtMs, inputs, commitFence);
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
        const progressReporter = createProgressReporter({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork,
          eventId, eventAttemptId: attemptId, now: clock });
        // Runtime-only ports remain non-enumerable so the exact serializable
        // CapabilityExecutionContext contract stays unchanged.
        Object.defineProperty(context, 'reportProgress', {
          configurable: false, enumerable: false, writable: false,
          value: (sample) => { const result=progressReporter.report(sample); options.onProgress?.(Object.freeze({
            ownerDomain:snapshot.work.owner_domain,processType:snapshot.work.process_type,processId:snapshot.work.process_id,
            workId:snapshot.work.work_id,eventId })); return result; }
        });
        if (inputs.approvalHandle !== undefined) context.approvalHandle = inputs.approvalHandle;
        if (inputs.authorizationHandle !== undefined) context.authorizationHandle = inputs.authorizationHandle;
        context.deadlineAtMs = attemptContract.deadlineAtMs;
        let outcome;
        try {
          outcome = await options.timeoutController.execute(Object.freeze({
            executionHandleId: attemptId, deadlineAtMs: attemptContract.deadlineAtMs,
            operation: () => options.dispatcher.dispatch({ capabilityRef: snapshot.event.capability_ref,
              context: Object.freeze(context), ownerDomain: snapshot.event.owner_domain })
          }));
        } catch (error) {
          if (error?.code === 'P4_EXECUTION_TIMEOUT') {
            outcome = Object.freeze({ kind: 'failed', failureClass: 'timeout', code: 'EXECUTION_TIMEOUT',
              message: 'Capability execution exceeded its frozen timeout.', retryDirective: 'contract_policy',
              evidence: Object.freeze({ deadlineAtMs: attemptContract.deadlineAtMs }) });
          } else if (!requiresJournal) {
            // A pure observation has no external effect to reconcile.  Leaving
            // its durable Attempt in `executing` would manufacture an
            // unrecoverable crash window, so preserve the failure as an
            // ordinary policy-controlled Capability outcome.
            outcome = Object.freeze({ kind:'failed', failureClass:'executor',
              code:typeof error?.code === 'string' && error.code ? error.code : 'EXECUTOR_ERROR',
              message:String(error?.message || 'Pure observation executor failed.'),
              retryDirective:'contract_policy', evidence:Object.freeze({
                errorName:String(error?.name || 'Error'),
                errorCode:typeof error?.code === 'string' && error.code ? error.code : 'EXECUTOR_ERROR',
              }) });
          } else throw error;
        }
        if (effect) {
          if (outcome.kind === 'succeeded') await options.effectJournal.settle(Object.freeze({
            effectId: effect.effect_id, receipt: outcome.effectReceipt,
            scope: Object.freeze({ ownerDomain: inputs.ownerScope.domain, scopeType: inputs.ownerScope.processType, scopeId: inputs.ownerScope.processId })
          }));
          else {
            if (outcome.kind === 'deferred' && outcome.externalReceipt !== undefined) {
              options.effectJournal.noteExternalPending(effect.effect_id, outcome.externalReceipt);
            }
            options.effectJournal.requireReconcile(effect.effect_id);
          }
        }
        let policyDecision = null;
        if (outcome.kind === 'failed') policyDecision = options.attemptPolicy.decideFailure(Object.freeze({
          capabilityRef: snapshot.event.capability_ref, effectClass: snapshot.node.effect_class,
          retryPolicyRef: policyBinding.retryPolicyRef, timeoutPolicyRef: policyBinding.timeoutPolicyRef,
          failureAttemptCount: snapshot.attempts.filter((attempt) => attempt.outcome_kind === 'failed').length + 1,
          outcome, recoveryDecision: null
        }));
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
        return complete(snapshot, attemptId, outcome, policyDecision);
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

module.exports = Object.freeze({ EventRuntimeError, createEventRuntime });
