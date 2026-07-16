'use strict';

const { digest } = require('../persistence/ddl-compiler');
const { createRepositoryDefinition } = require('../persistence/owner-repository');

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

function definitions(schemaManifest) {
  return Object.freeze({
    events: createRepositoryDefinition({ repositoryId: 'runtime_events', owner: 'execution-foundation', schemaManifest, statements: {
      find: { kind: 'select-one', tableId: 'fx_workflow_events', columns: [
        'event_id', 'plan_id', 'node_id', 'work_id', 'attempt_id', 'owner_domain', 'capability_ref', 'contract_version',
        'state', 'ready_at_ms', 'retry_at_ms', 'result_id'
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
        'resource_demand_schema_ref', 'resource_demand_json', 'approval_requirement_ref', 'authorization_requirement_ref',
        'retry_policy_ref', 'timeout_policy_ref', 'output_contract_ref', 'compensation_for_event_id', 'compensation_contract_ref'
      ], keyColumns: ['plan_id', 'node_id'] },
      list: { kind: 'select-all', tableId: 'fx_plan_nodes', columns: [
        'plan_id', 'node_id', 'when_schema_ref', 'when_json', 'compensation_for_event_id', 'compensation_contract_ref'
      ], keyColumns: [] }
    } }),
    edges: createRepositoryDefinition({ repositoryId: 'runtime_edges', owner: 'execution-foundation', schemaManifest, statements: {
      list: { kind: 'select-all', tableId: 'fx_plan_edges', columns: ['plan_id', 'from_node_id', 'to_node_id', 'dependency_kind'], keyColumns: [] }
    } }),
    works: createRepositoryDefinition({ repositoryId: 'runtime_works', owner: 'execution-foundation', schemaManifest, statements: {
      find: { kind: 'select-one', tableId: 'fx_supporting_works', columns: [
        'work_id', 'owner_domain', 'process_type', 'process_id', 'basis_digest', 'state'
      ], keyColumns: ['work_id'] }
    } }),
    workAttempts: createRepositoryDefinition({ repositoryId: 'runtime_work_attempts', owner: 'execution-foundation', schemaManifest, statements: {
      find: { kind: 'select-one', tableId: 'fx_work_attempts', columns: ['attempt_id', 'work_id', 'basis_digest', 'state'], keyColumns: ['attempt_id'] }
    } }),
    plans: createRepositoryDefinition({ repositoryId: 'runtime_plans', owner: 'execution-foundation', schemaManifest, statements: {
      find: { kind: 'select-one', tableId: 'fx_workflow_plans', columns: [
        'plan_id', 'attempt_id', 'work_objective_type_ref', 'work_objective_version', 'basis_digest', 'state', 'diagnostic_classification'
      ], keyColumns: ['plan_id'] }
    } }),
    eventAttempts: createRepositoryDefinition({ repositoryId: 'runtime_event_attempts', owner: 'execution-foundation', schemaManifest, statements: {
      list: { kind: 'select-all', tableId: 'fx_event_attempts', columns: [
        'event_attempt_id', 'event_id', 'ordinal', 'state', 'outcome_kind', 'failure_class', 'started_at_ms'
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
      find: { kind: 'select-one', tableId: 'fx_event_result_bindings', columns: ['result_id', 'event_id', 'result_digest'], keyColumns: ['event_id'] },
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
      typeof options.attemptPolicy.decideFailure !== 'function' || typeof options.attemptPolicy.decideDeferred !== 'function' ||
      !options.timeoutController || typeof options.timeoutController.execute !== 'function' ||
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
          if (node.compensation_for_event_id !== null) continue;
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
        if (!event || event.state !== 'ready') fail('P4_EVENT_NOT_READY', 'Event Runtime advances only a ready Event.', { eventId });
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
        if (!event || event.state !== 'ready') fail('P4_EVENT_FENCE_STATE_CHANGED', 'Event changed before Fence rejection could be recorded.');
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

  function beginAttempt(snapshot, entry, attemptId, startedAtMs, inputs, fence) {
    options.unitOfWork.execute([{
      participantId: 'event_runtime_begin', owner: 'execution-foundation', repositories: Object.values(repositories), execute(context) {
        const event = context.repository('runtime_events').invoke('find', { event_id: snapshot.event.event_id });
        if (!event || event.state !== 'ready') fail('P4_EVENT_BEGIN_STATE_CHANGED', 'Event changed before Attempt creation.');
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
          if (context.repository('runtime_results').invoke('find', { event_id: event.event_id })) fail(
            'P4_EVENT_RESULT_ALREADY_BOUND', 'Event already owns an immutable Result binding.'
          );
          resultId = assertId(options.nextResultId(), 'result');
          const resultJson = json(outcome.result); const evidenceJson = json(outcome.evidence);
          context.repository('runtime_results').invoke('insert', {
            result_id: resultId, event_id: event.event_id, outcome_kind: 'succeeded', result_schema_ref: outcome.resultSchemaRef,
            result_json: resultJson, result_digest: digest(resultJson), evidence_schema_ref: outcome.evidenceSchemaRef,
            evidence_json: evidenceJson, evidence_digest: digest(evidenceJson),
            effect_receipt_id: outcome.effectReceipt ? outcome.effectReceipt.effectReceiptId : null, committed_at_ms: finishedAtMs
          });
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

  return Object.freeze({
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
        if (snapshot.node.output_contract_ref !== entry.manifest.resultSchemaRef ||
            snapshot.node.effect_class !== entry.manifest.effectClass ||
            snapshot.node.approval_requirement_ref !== (entry.manifest.approvalRequirementRef || null) ||
            snapshot.node.authorization_requirement_ref !== (entry.manifest.authorizationRequirementRef || null)) fail(
          'P4_EVENT_FROZEN_CONTRACT_MISMATCH', 'Durable Plan execution contracts do not match the exact Capability version.'
        );
        const requiresJournal = entry.manifest.effectClass !== 'pure_observation';
        if (requiresJournal && (!options.effectJournal || typeof options.effectJournal.intend !== 'function' ||
            typeof options.effectJournal.settle !== 'function' || typeof options.effectJournal.requireReconcile !== 'function' ||
            typeof options.effectJournal.noteExternalPending !== 'function')) fail(
          'P4_EVENT_EFFECT_JOURNAL_REQUIRED', 'Every non-pure Event requires the Effect Journal before dispatch.'
        );
        const inputs = options.executionInputProvider.prepare(Object.freeze({ snapshot }));
        if ((snapshot.node.approval_requirement_ref !== null) !== (inputs.approvalHandle !== undefined) ||
            (snapshot.node.authorization_requirement_ref !== null) !== (inputs.authorizationHandle !== undefined)) fail(
          'P4_EVENT_REQUIRED_HANDLE_MISMATCH', 'Execution inputs must carry exactly the approval and authorization required by the durable Plan.'
        );
        const startedAtMs = clock();
        const attemptContract = options.attemptPolicy.prepare(Object.freeze({
          capabilityRef: snapshot.event.capability_ref, effectClass: snapshot.node.effect_class,
          retryPolicyRef: snapshot.node.retry_policy_ref, timeoutPolicyRef: snapshot.node.timeout_policy_ref, startedAtMs
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
          if (!error || error.code !== 'P4_EXECUTION_TIMEOUT') throw error;
          outcome = Object.freeze({ kind: 'failed', failureClass: 'timeout', code: 'EXECUTION_TIMEOUT',
            message: 'Capability execution exceeded its frozen timeout.', retryDirective: 'contract_policy',
            evidence: Object.freeze({ deadlineAtMs: attemptContract.deadlineAtMs }) });
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
          retryPolicyRef: snapshot.node.retry_policy_ref, timeoutPolicyRef: snapshot.node.timeout_policy_ref,
          failureAttemptCount: snapshot.attempts.filter((attempt) => attempt.outcome_kind === 'failed').length + 1,
          outcome, recoveryDecision: null
        }));
        if (outcome.kind === 'deferred') {
          const prior = snapshot.attempts.filter((attempt) => attempt.outcome_kind === 'deferred');
          policyDecision = options.attemptPolicy.decideDeferred(Object.freeze({
            capabilityRef: snapshot.event.capability_ref, effectClass: snapshot.node.effect_class,
            retryPolicyRef: snapshot.node.retry_policy_ref, timeoutPolicyRef: snapshot.node.timeout_policy_ref,
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
