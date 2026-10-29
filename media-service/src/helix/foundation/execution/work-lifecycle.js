'use strict';

const { digest } = require('../persistence/ddl-compiler');
const { createRepositoryDefinition } = require('../persistence/owner-repository');
const { validateSupportingWorkDefinition } = require('./runtime-contracts');

const TERMINAL_EVENTS = new Set(['succeeded', 'skipped', 'failed', 'cancelled']);
const ACTIVE_ATTEMPTS = new Set(['ready', 'running', 'blocked']);
const NONTERMINAL_EFFECTS = new Set(['intended', 'effect_observed', 'reconcile_required']);

class WorkLifecycleError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WorkLifecycleError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new WorkLifecycleError(code, message, details);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonical(value[key]); return result;
  }, {});
  return value;
}

function materializeWork(row) {
  if (!row || row.definition_schema_ref !== 'helix://foundation/types/SupportingWorkDefinition/v1' ||
      typeof row.definition_json !== 'string' || typeof row.definition_digest !== 'string') {
    fail('P4_WORK_DEFINITION_FACT_MISSING', 'Supporting Work is missing its durable immutable Definition.', { workId: row?.work_id });
  }
  let raw;
  try { raw = JSON.parse(row.definition_json); } catch (_error) {
    fail('P4_WORK_DEFINITION_CORRUPT', 'Supporting Work Definition is invalid JSON.', { workId: row.work_id });
  }
  const canonicalJson = JSON.stringify(canonical(raw));
  if (digest(canonicalJson) !== row.definition_digest || Buffer.byteLength(canonicalJson, 'utf8') > 256 * 1024) {
    fail('P4_WORK_DEFINITION_CORRUPT', 'Supporting Work Definition digest or size fence is invalid.', { workId: row.work_id });
  }
  let definition;
  try { definition = validateSupportingWorkDefinition(raw); } catch (error) {
    fail('P4_WORK_DEFINITION_CORRUPT', 'Supporting Work Definition no longer satisfies its nominal contract.', {
      workId: row.work_id, causeCode: error.code,
    });
  }
  const hotProjection = {
    work_id: definition.workId, owner_domain: definition.ownerDomain, process_type: definition.processType,
    process_id: definition.processId, work_kind: definition.workKind, basis_digest: definition.executionBasisDigest,
    priority_class: definition.priorityClass, idempotency_key: definition.idempotencyKey,
  };
  for (const [column, expected] of Object.entries(hotProjection)) {
    if (row[column] !== expected) fail('P4_WORK_DEFINITION_PROJECTION_DRIFT',
      'Supporting Work hot projection differs from its immutable Definition.', { workId: row.work_id, column });
  }
  return Object.freeze({ ...row, definition });
}

function definitions(schemaManifest) {
  return Object.freeze({
    works: createRepositoryDefinition({ repositoryId: 'work_lifecycle_works', owner: 'execution-foundation', schemaManifest, statements: {
      find: { kind: 'select-one', tableId: 'fx_supporting_works', columns: [
        'work_id', 'owner_domain', 'process_type', 'process_id', 'work_kind', 'basis_digest', 'priority_class', 'state',
        'definition_schema_ref', 'definition_json', 'definition_digest', 'idempotency_key'
      ], keyColumns: ['work_id'] },
      list: { kind: 'select-all', tableId: 'fx_supporting_works', columns: [
        'work_id', 'owner_domain', 'process_type', 'process_id', 'work_kind', 'basis_digest', 'priority_class', 'state',
        'definition_schema_ref', 'definition_json', 'definition_digest', 'idempotency_key'
      ], keyColumns: [] },
      list_process: { kind: 'select-all', tableId: 'fx_supporting_works', columns: [
        'work_id', 'owner_domain', 'process_type', 'process_id', 'work_kind', 'basis_digest', 'priority_class', 'state',
        'definition_schema_ref', 'definition_json', 'definition_digest', 'idempotency_key'
      ], keyColumns: ['owner_domain', 'process_type', 'process_id'] },
      list_running: { kind: 'select-all', tableId: 'fx_supporting_works', columns: [
        'work_id', 'owner_domain', 'process_type', 'process_id', 'work_kind', 'basis_digest', 'priority_class', 'state',
        'definition_schema_ref', 'definition_json', 'definition_digest', 'idempotency_key'
      ], keyColumns: ['state'] },
      transition: { kind: 'update', tableId: 'fx_supporting_works', setColumns: ['state', 'updated_at_ms'], keyColumns: ['work_id'],
        compareColumns: [{ column: 'state', parameter: 'expected_state' }] }
    } }),
    attempts: createRepositoryDefinition({ repositoryId: 'work_lifecycle_attempts', owner: 'execution-foundation', schemaManifest, statements: {
      list: { kind: 'select-all', tableId: 'fx_work_attempts', columns: [
        'attempt_id', 'work_id', 'ordinal', 'basis_digest', 'state', 'started_at_ms', 'finished_at_ms', 'failure_code'
      ], keyColumns: ['work_id'] },
      find: { kind: 'select-one', tableId: 'fx_work_attempts', columns: [
        'attempt_id', 'work_id', 'ordinal', 'basis_digest', 'state', 'started_at_ms', 'finished_at_ms', 'failure_code'
      ], keyColumns: ['attempt_id'] },
      insert: { kind: 'insert', tableId: 'fx_work_attempts', columns: [
        'attempt_id', 'work_id', 'ordinal', 'basis_digest', 'state', 'started_at_ms', 'finished_at_ms', 'failure_code'
      ] },
      transition: { kind: 'update', tableId: 'fx_work_attempts', setColumns: [
        'state', 'started_at_ms', 'finished_at_ms', 'failure_code'
      ], keyColumns: ['attempt_id'], compareColumns: [{ column: 'state', parameter: 'expected_state' }] }
    } }),
    plans: createRepositoryDefinition({ repositoryId: 'work_lifecycle_plans', owner: 'execution-foundation', schemaManifest, statements: {
      find: { kind: 'select-one', tableId: 'fx_workflow_plans', columns: ['plan_id', 'attempt_id', 'state'], keyColumns: ['attempt_id'] }
    } }),
    events: createRepositoryDefinition({ repositoryId: 'work_lifecycle_events', owner: 'execution-foundation', schemaManifest, statements: {
      list_work: { kind: 'select-all', tableId: 'fx_workflow_events', columns: [
        'event_id', 'work_id', 'attempt_id', 'plan_id', 'state', 'retry_at_ms', 'result_id'
      ], keyColumns: ['work_id'] },
      find: { kind: 'select-one', tableId: 'fx_workflow_events', columns: ['event_id', 'work_id', 'attempt_id', 'state', 'result_id'], keyColumns: ['event_id'] },
      transition: { kind: 'update', tableId: 'fx_workflow_events', setColumns: ['state'], keyColumns: ['event_id'],
        compareColumns: [{ column: 'state', parameter: 'expected_state' }] },
      cancel: { kind: 'update', tableId: 'fx_workflow_events', setColumns: ['state', 'retry_at_ms'], keyColumns: ['event_id'],
        compareColumns: [{ column: 'state', parameter: 'expected_state' }] }
    } }),
    resourceDefers: createRepositoryDefinition({ repositoryId: 'work_lifecycle_resource_defers', owner: 'execution-foundation', schemaManifest,
      statements: {
        list: { kind: 'select-all', tableId: 'fx_resource_defer', columns: ['event_id', 'resource_key', 'state'], keyColumns: [] },
        list_waiting_event: { kind:'select-all', tableId:'fx_resource_defer', columns:['event_id','resource_key','state'], keyColumns:['event_id','state'] },
        cancel: { kind: 'update', tableId: 'fx_resource_defer', setColumns: ['state'], keyColumns: ['event_id', 'resource_key'],
          compareColumns: [{ column: 'state', parameter: 'expected_state' }] }
      } }),
    eventAttempts: createRepositoryDefinition({ repositoryId:'work_lifecycle_event_attempts', owner:'execution-foundation', schemaManifest, statements:{
      list:{kind:'select-all',tableId:'fx_event_attempts',columns:['event_attempt_id','event_id','ordinal','state','outcome_kind','failure_code'],keyColumns:['event_id'],safeIntegers:true}
    } }),
    effects: createRepositoryDefinition({ repositoryId:'work_lifecycle_effects', owner:'execution-foundation', schemaManifest, statements:{
      list:{kind:'select-all',tableId:'fx_effect_journal',columns:['effect_id','event_attempt_id','state'],keyColumns:['event_attempt_id']}
    } }),
  });
}

function createWorkLifecycle(options) {
  if (!options?.schemaManifest || !options.unitOfWork || typeof options.nextWorkAttemptId !== 'function') {
    fail('P4_WORK_LIFECYCLE_DEPENDENCIES_REQUIRED', 'Work lifecycle requires scoped persistence and a Work Attempt identity source.');
  }
  const repositories = definitions(options.schemaManifest);
  const execute = (participantId, body) => options.unitOfWork.execute([{
    participantId,
    owner: 'execution-foundation',
    repositories: Object.values(repositories),
    execute: body,
  }])[participantId];

  function ensurePlanningAttempt(workId) {
    return execute('work_lifecycle_ensure_attempt', (context) => {
      const works = context.repository('work_lifecycle_works');
      const attempts = context.repository('work_lifecycle_attempts');
      const storedWork = works.invoke('find', { work_id: workId });
      const work = storedWork ? materializeWork(storedWork) : null;
      if (!work || !['admitted', 'ready'].includes(work.state)) {
        fail('P4_WORK_NOT_PLANNABLE', 'Scheduler lease no longer identifies an admitted or ready Work.', { workId });
      }
      const existing = attempts.invoke('list', { work_id: workId });
      const active = existing.filter((attempt) => ['ready', 'running', 'blocked'].includes(attempt.state));
      if (active.length > 1) fail('P4_WORK_ATTEMPT_CARDINALITY', 'Supporting Work owns multiple active Attempts.', { workId });
      if (active.length === 1) {
        if (active[0].state !== 'ready' || work.state !== 'ready' || active[0].basis_digest !== work.basis_digest) {
          fail('P4_WORK_PLANNING_STATE_MISMATCH', 'Ready Work and its planning Attempt are inconsistent.', { workId });
        }
        return Object.freeze({ work: Object.freeze(work), attempt: Object.freeze(active[0]), replayed: true });
      }
      const ordinal = existing.reduce((maximum, attempt) => Math.max(maximum, attempt.ordinal), 0) + 1;
      const attemptId = options.nextWorkAttemptId(workId, ordinal);
      if (typeof attemptId !== 'string' || !attemptId) fail('P4_WORK_ATTEMPT_ID_INVALID', 'Work Attempt identity must be non-empty text.');
      attempts.invoke('insert', {
        attempt_id: attemptId, work_id: workId, ordinal, basis_digest: work.basis_digest, state: 'ready',
        started_at_ms: null, finished_at_ms: null, failure_code: null,
      });
      if (work.state === 'admitted' && works.invoke('transition', {
        work_id: workId, state: 'ready', updated_at_ms: context.commitTimeMs, expected_state: 'admitted',
      }).changes !== 1) {
        fail('P4_WORK_ACTIVATION_CAS', 'Supporting Work activation fence changed.');
      }
      return Object.freeze({ work: Object.freeze({ ...work, state: 'ready' }), attempt: Object.freeze({
        attempt_id: attemptId, work_id: workId, ordinal, basis_digest: work.basis_digest, state: 'ready',
        started_at_ms: null, finished_at_ms: null, failure_code: null,
      }), replayed: false });
    });
  }

  function startPlanned(workId, attemptId, diagnosticClassification = null) {
    return execute('work_lifecycle_start_planned', (context) => {
      const works = context.repository('work_lifecycle_works');
      const attempts = context.repository('work_lifecycle_attempts');
      const work = works.invoke('find', { work_id: workId });
      const attempt = attempts.invoke('find', { attempt_id: attemptId });
      const plan = context.repository('work_lifecycle_plans').invoke('find', { attempt_id: attemptId });
      if (!work || !attempt || attempt.work_id !== workId || !plan) {
        fail('P4_WORK_PLAN_FACT_MISSING', 'Work start requires its exact Attempt and immutable Plan.');
      }
      if (work.state === 'running' && attempt.state === 'running') {
        return Object.freeze({ workId, attemptId, state: 'running', resolution: plan.state, replayed: true });
      }
      if (work.state !== 'ready' || attempt.state !== 'ready') {
        fail('P4_WORK_START_STATE_MISMATCH', 'Work start requires ready Work and Attempt.');
      }
      let attemptState = 'running';
      let failureCode = null;
      if (plan.state === 'no_effect_required') attemptState = 'succeeded';
      else if (plan.state === 'contract_unplannable') {
        attemptState = 'failed';
        failureCode = typeof diagnosticClassification === 'string' && diagnosticClassification.length > 0
          ? diagnosticClassification
          : 'CONTRACT_UNPLANNABLE';
      }
      else if (plan.state === 'temporarily_unplannable') attemptState = 'blocked';
      const workState = attemptState === 'blocked' ? 'blocked' : 'running';
      if (attempts.invoke('transition', {
        attempt_id: attemptId, state: attemptState, started_at_ms: context.commitTimeMs,
        finished_at_ms: ['succeeded', 'failed'].includes(attemptState) ? context.commitTimeMs : null,
        failure_code: failureCode, expected_state: 'ready',
      }).changes !== 1 || works.invoke('transition', {
        work_id: workId, state: workState, updated_at_ms: context.commitTimeMs, expected_state: 'ready',
      }).changes !== 1) fail('P4_WORK_START_CAS', 'Work start fence changed.');
      return Object.freeze({ workId, attemptId, state: workState, attemptState,
        attemptFailureCode: failureCode, resolution: plan.state, replayed: false });
    });
  }

  function aggregate(workId, expectedAttemptId = null) {
    return execute('work_lifecycle_aggregate', (context) => {
      const works = context.repository('work_lifecycle_works');
      const attempts = context.repository('work_lifecycle_attempts');
      const work = works.invoke('find', { work_id: workId });
      if (!work) fail('P4_WORK_FACT_MISSING', 'Supporting Work does not exist.', { workId });
      if (['succeeded', 'failed', 'cancelled'].includes(work.state)) {
        return Object.freeze({ attemptTerminal: true, workTerminal: true, work: Object.freeze(work), replayed: true });
      }
      if (work.state !== 'running') return Object.freeze({ attemptTerminal: false, workTerminal: false,
        work: Object.freeze(work), replayed: true });
      const rows = attempts.invoke('list', { work_id: workId }).sort((left, right) => right.ordinal - left.ordinal);
      const active = rows.filter((attempt) => ACTIVE_ATTEMPTS.has(attempt.state));
      const latest = rows[0];
      const events = context.repository('work_lifecycle_events').invoke('list_work', { work_id: workId })
        .filter((event) => event.attempt_id === latest?.attempt_id);
      // Attempt aggregation and the Owner's Work disposition are separate commits.
      // Only durable evidence of that exact interval permits a replay with no running Attempt.
      if (active.length === 0 && latest && ['succeeded', 'failed', 'cancelled'].includes(latest.state) &&
          latest.finished_at_ms !== null && latest.basis_digest === work.basis_digest) {
        const plan = context.repository('work_lifecycle_plans').invoke('find', { attempt_id: latest.attempt_id });
        const eventState = events.some((event) => event.state === 'failed') ? 'failed'
          : events.some((event) => event.state === 'cancelled') ? 'cancelled' : 'succeeded';
        const proven = plan && (plan.state === 'planned'
          ? events.length > 0 && events.every((event) => event.plan_id === plan.plan_id && TERMINAL_EVENTS.has(event.state)) &&
            latest.state === eventState
          : events.length === 0 && ((plan.state === 'no_effect_required' && latest.state === 'succeeded') ||
            (plan.state === 'contract_unplannable' && latest.state === 'failed')));
        if (proven) {
          if (expectedAttemptId !== null && expectedAttemptId !== latest.attempt_id) {
            return Object.freeze({ attemptTerminal: false, workTerminal: false, work: Object.freeze(work),
              replayed: true, staleAttempt: true });
          }
          return Object.freeze({ attemptTerminal: true, workTerminal: false, work: Object.freeze(work),
            attemptId: latest.attempt_id, attemptState: latest.state, attemptFailureCode: latest.failure_code,
            eventCount: events.length, replayed: true });
        }
      }
      if (active.length !== 1 || active[0].state !== 'running' || active[0].attempt_id !== latest?.attempt_id) {
        fail('P4_WORK_RUNNING_ATTEMPT_CARDINALITY',
          'Running Work requires one running Attempt or a proven terminal Attempt awaiting its Owner.', { workId });
      }
      if (expectedAttemptId !== null && expectedAttemptId !== latest.attempt_id) {
        return Object.freeze({ attemptTerminal: false, workTerminal: false, work: Object.freeze(work),
          replayed: true, staleAttempt: true });
      }
      if (events.length < 1 || events.some((event) => !TERMINAL_EVENTS.has(event.state))) {
        return Object.freeze({ attemptTerminal: false, workTerminal: false, work: Object.freeze(work),
          eventCount: events.length, replayed: false });
      }
      const state = events.some((event) => event.state === 'failed') ? 'failed'
        : events.some((event) => event.state === 'cancelled') ? 'cancelled' : 'succeeded';
      const failedCodes=state==='failed'?[...new Set(events.filter((event)=>event.state==='failed').flatMap((event)=>
        context.repository('work_lifecycle_event_attempts').invoke('list',{event_id:event.event_id})
          .filter((attempt)=>attempt.state==='completed'&&attempt.outcome_kind==='failed')
          .sort((left,right)=>Number(right.ordinal)-Number(left.ordinal)).slice(0,1).map((attempt)=>attempt.failure_code)).filter(Boolean))]:[];
      const failureCode = state === 'failed' ? failedCodes.length===1?failedCodes[0]:'EVENT_TERMINAL_FAILURE' : null;
      if (attempts.invoke('transition', {
        attempt_id: active[0].attempt_id, state, started_at_ms: active[0].started_at_ms,
        finished_at_ms: context.commitTimeMs, failure_code: failureCode, expected_state: 'running',
      }).changes !== 1) fail('P4_WORK_ATTEMPT_TERMINAL_CAS', 'Work Attempt terminal aggregation fence changed.');
      return Object.freeze({ attemptTerminal: true, workTerminal: false, work: Object.freeze(work),
        attemptId: active[0].attempt_id, attemptState: state, attemptFailureCode:failureCode, eventCount: events.length, replayed: false });
    });
  }

  function settleWork(request) {
    if (!request || typeof request.workId !== 'string' || !request.workId ||
        (request.workAttemptId!==undefined&&(typeof request.workAttemptId !== 'string' || !request.workAttemptId)) ||
        !['succeeded', 'failed', 'cancelled', 'blocked', 'replan'].includes(request.disposition)) {
      fail('P4_WORK_DISPOSITION_INVALID', 'Domain Owner returned an invalid Work disposition.');
    }
    return execute('work_lifecycle_settle', (context) => {
      const works = context.repository('work_lifecycle_works');
      const attempts = context.repository('work_lifecycle_attempts');
      const work = works.invoke('find', { work_id: request.workId });
      if (!work) fail('P4_WORK_FACT_MISSING', 'Supporting Work does not exist.', { workId: request.workId });
      const latestAttempt=attempts.invoke('list',{work_id:request.workId})
        .sort((left,right)=>Number(right.ordinal)-Number(left.ordinal))[0]||null;
      if(request.workAttemptId!==undefined&&(!latestAttempt||latestAttempt.attempt_id!==request.workAttemptId)){
        return Object.freeze({workId:request.workId,state:work.state,replayed:true,staleAttempt:true});
      }
      const desired = request.disposition === 'replan' ? 'ready' : request.disposition;
      if (work.state === desired) return Object.freeze({ workId: request.workId, state: desired, replayed: true });
      if (request.disposition === 'replan' && work.state === 'blocked') {
        if (latestAttempt && latestAttempt.state === 'blocked' && attempts.invoke('transition', {
          attempt_id: latestAttempt.attempt_id, state: 'cancelled', started_at_ms: latestAttempt.started_at_ms,
          finished_at_ms: context.commitTimeMs, failure_code: latestAttempt.failure_code,
          expected_state: 'blocked',
        }).changes !== 1) fail('P4_WORK_REPLAN_CAS', 'Work replan fence changed.');
        if (works.invoke('transition', {
          work_id: request.workId, state: 'ready', updated_at_ms: context.commitTimeMs, expected_state: 'blocked',
        }).changes !== 1) fail('P4_WORK_REPLAN_CAS', 'Work replan fence changed.');
        return Object.freeze({ workId: request.workId, state: 'ready', replayed: false });
      }
      if (work.state !== 'running') fail('P4_WORK_DISPOSITION_FENCE', 'Only a running Work can accept an Owner disposition.', {
        workId: request.workId, state: work.state,
      });
      if (request.disposition === 'replan') {
        if (works.invoke('transition', { work_id: request.workId, state: 'blocked', updated_at_ms: context.commitTimeMs,
          expected_state: 'running' }).changes !== 1 || works.invoke('transition', {
          work_id: request.workId, state: 'ready', updated_at_ms: context.commitTimeMs, expected_state: 'blocked',
        }).changes !== 1) fail('P4_WORK_REPLAN_CAS', 'Work replan fence changed.');
      } else if (works.invoke('transition', {
        work_id: request.workId, state: desired, updated_at_ms: context.commitTimeMs, expected_state: 'running',
      }).changes !== 1) fail('P4_WORK_DISPOSITION_CAS', 'Work disposition fence changed.');
      return Object.freeze({ workId: request.workId, state: desired, replayed: false });
    });
  }

  function aggregateEvent(eventId) {
    const event = execute('work_lifecycle_event_owner', (context) => {
      const event = context.repository('work_lifecycle_events').invoke('find', { event_id: eventId });
      return event || null;
    });
    if (!event) fail('P4_WORK_EVENT_FACT_MISSING', 'Workflow Event does not exist.', { eventId });
    if (typeof event.attempt_id !== 'string' || !event.attempt_id) fail('P4_WORK_EVENT_ATTEMPT_FACT_MISSING',
      'Workflow Event requires its exact Work Attempt binding.', { eventId });
    return aggregate(event.work_id, event.attempt_id);
  }

  function pendingOwnerReconciliations(limit = 16) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) {
      fail('P4_WORK_RECONCILE_LIMIT_INVALID', 'Owner reconciliation scan limit is invalid.');
    }
    return execute('work_lifecycle_pending_owner_reconcile', (context) => {
      const attempts = context.repository('work_lifecycle_attempts');
      return context.repository('work_lifecycle_works').invoke('list_running', { state:'running' })
        .map((work) => {
          const rows = attempts.invoke('list', { work_id: work.work_id })
            .sort((left, right) => right.ordinal - left.ordinal);
          const latest = rows[0];
          return latest && ['succeeded', 'failed', 'cancelled'].includes(latest.state)
            ? Object.freeze({ work:Object.freeze(work), attempt:Object.freeze(latest) }) : null;
        })
        .filter(Boolean)
        .sort((left, right) => left.work.work_id.localeCompare(right.work.work_id))
        .slice(0, limit);
    });
  }

  function pendingTerminalEventAggregations(limit = 16) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) {
      fail('P4_WORK_AGGREGATION_SCAN_LIMIT_INVALID', 'Terminal Event aggregation scan limit is invalid.');
    }
    return execute('work_lifecycle_pending_event_aggregation', (context) => {
      const attempts = context.repository('work_lifecycle_attempts');
      const events = context.repository('work_lifecycle_events');
      return context.repository('work_lifecycle_works').invoke('list_running', { state:'running' })
        .map((work) => {
          const active = attempts.invoke('list', { work_id:work.work_id })
            .filter((attempt) => attempt.state === 'running');
          if (active.length !== 1) return null;
          const rows = events.invoke('list_work', { work_id:work.work_id })
            .filter((event) => event.attempt_id === active[0].attempt_id);
          if (rows.length < 1 || rows.some((event) => !TERMINAL_EVENTS.has(event.state))) return null;
          return Object.freeze({ workId:work.work_id, attemptId:active[0].attempt_id,
            eventId:[...rows].sort((left, right) => left.event_id.localeCompare(right.event_id))[0].event_id });
        })
        .filter(Boolean)
        .sort((left, right) => left.workId.localeCompare(right.workId))
        .slice(0, limit);
    });
  }

  function cancelProcess(request) {
    if (!request || typeof request.ownerDomain !== 'string' || !request.ownerDomain ||
        typeof request.processType !== 'string' || !request.processType ||
        typeof request.processId !== 'string' || !request.processId ||
        typeof request.reasonCode !== 'string' || !request.reasonCode) {
      fail('P4_WORK_CANCELLATION_SCOPE_INVALID', 'Process Work cancellation requires an exact Owner scope and reason.');
    }
    const result = execute('work_lifecycle_cancel_process', (context) => {
      const works = context.repository('work_lifecycle_works');
      const attempts = context.repository('work_lifecycle_attempts');
      const events = context.repository('work_lifecycle_events');
      const resourceDefers = context.repository('work_lifecycle_resource_defers');
      const selected = works.invoke('list_process', { owner_domain:request.ownerDomain,
        process_type:request.processType, process_id:request.processId }).filter((work) =>
        !['succeeded', 'failed', 'cancelled'].includes(work.state));
      let cancelledWorks = 0; let drainingWorks = 0; let cancelledEvents = 0;
      for (const work of selected) {
        const workAttempts = attempts.invoke('list', { work_id: work.work_id });
        const activeAttempt = [...workAttempts].sort((left, right) => right.ordinal - left.ordinal)
          .find((attempt) => ['ready', 'running', 'blocked'].includes(attempt.state));
        const workEvents = events.invoke('list_work', { work_id: work.work_id });
        const executing = workEvents.some((event) => event.state === 'executing');
        for (const event of workEvents.filter((item) =>
          ['pending', 'ready', 'waiting_for_resource', 'waiting_for_external', 'waiting_for_approval'].includes(item.state))) {
          const waitingDefers = resourceDefers.invoke('list_waiting_event', {event_id:event.event_id,state:'waiting'});
          for (const defer of waitingDefers) {
            if (resourceDefers.invoke('cancel', { event_id:event.event_id, resource_key:defer.resource_key,
              state:'cancelled', expected_state:'waiting' }).changes !== 1) {
              fail('P4_WORK_CANCELLATION_RESOURCE_DEFER_CAS',
                'Resource defer changed during Process Work cancellation.', {
                  eventId:event.event_id, resourceKey:defer.resource_key,
                });
            }
          }
          if (events.invoke('cancel', { event_id:event.event_id, state:'cancelled', retry_at_ms:null,
            expected_state:event.state }).changes !== 1) {
            fail('P4_WORK_CANCELLATION_EVENT_CAS', 'Event changed during Process Work cancellation.', { eventId:event.event_id });
          }
          cancelledEvents += 1;
        }
        if (executing) { drainingWorks += 1; continue; }
        if (activeAttempt && attempts.invoke('transition', { attempt_id:activeAttempt.attempt_id, state:'cancelled',
          started_at_ms:activeAttempt.started_at_ms, finished_at_ms:context.commitTimeMs, failure_code:request.reasonCode,
          expected_state:activeAttempt.state }).changes !== 1) {
          fail('P4_WORK_CANCELLATION_ATTEMPT_CAS', 'Work Attempt changed during Process Work cancellation.',
            { attemptId:activeAttempt.attempt_id });
        }
        if (works.invoke('transition', { work_id:work.work_id, state:'cancelled', updated_at_ms:context.commitTimeMs,
          expected_state:work.state }).changes !== 1) {
          fail('P4_WORK_CANCELLATION_WORK_CAS', 'Work changed during Process Work cancellation.', { workId:work.work_id });
        }
        cancelledWorks += 1;
      }
      return Object.freeze({ownerDomain:request.ownerDomain,processType:request.processType,processId:request.processId,
        reasonCode:request.reasonCode,selectedWorks:selected.length,cancelledWorks,drainingWorks,cancelledEvents});
    });
    // Notify after commit; startup reconciliation covers an exit before this callback.
    options.onProcessCancelled?.(request);
    return result;
  }

  function repairCancelledWorkAttempt(request) {
    if (!request || typeof request.workId !== 'string' || !request.workId ||
        typeof request.attemptId !== 'string' || !request.attemptId ||
        typeof request.reasonCode !== 'string' || !request.reasonCode) {
      fail('P4_WORK_ATTEMPT_REPAIR_SCOPE_INVALID',
        'Cancelled Work Attempt repair requires an exact Work, Attempt, and reason.');
    }
    return execute('work_lifecycle_repair_cancelled_attempt', (context) => {
      const work = context.repository('work_lifecycle_works').invoke('find', { work_id:request.workId });
      const attempt = context.repository('work_lifecycle_attempts').invoke('find', { attempt_id:request.attemptId });
      if (!work || !attempt || attempt.work_id !== request.workId) {
        fail('P4_WORK_ATTEMPT_REPAIR_FACT_MISSING',
          'Cancelled Work Attempt repair requires the exact durable facts.', request);
      }
      if (work.state !== 'cancelled') {
        fail('P4_WORK_ATTEMPT_REPAIR_WORK_NOT_CANCELLED',
          'Only an already-cancelled Work can close a residual active Attempt.', {
            workId:request.workId, workState:work.state,
          });
      }
      if (attempt.state === 'cancelled') {
        return Object.freeze({ workId:request.workId, attemptId:request.attemptId,
          state:'cancelled', replayed:true });
      }
      if (!ACTIVE_ATTEMPTS.has(attempt.state)) {
        fail('P4_WORK_ATTEMPT_REPAIR_ATTEMPT_NOT_ACTIVE',
          'Cancelled Work Attempt repair cannot rewrite another terminal disposition.', {
            attemptId:request.attemptId, attemptState:attempt.state,
          });
      }
      const events = context.repository('work_lifecycle_events').invoke('list_work', { work_id:request.workId })
        .filter((event) => event.attempt_id === request.attemptId);
      if (events.some((event) => !TERMINAL_EVENTS.has(event.state))) {
        fail('P4_WORK_ATTEMPT_REPAIR_EVENT_NONTERMINAL',
          'Cancelled Work Attempt repair found a nonterminal child Event.', { attemptId:request.attemptId });
      }
      const waitingDefers = context.repository('work_lifecycle_resource_defers').invoke('list')
        .filter((defer) => defer.state === 'waiting' && events.some((event) => event.event_id === defer.event_id));
      if (waitingDefers.length > 0) {
        fail('P4_WORK_ATTEMPT_REPAIR_DEFER_NONTERMINAL',
          'Cancelled Work Attempt repair found a live Resource Defer.', { attemptId:request.attemptId });
      }
      for (const event of events) {
        const eventAttempts = context.repository('work_lifecycle_event_attempts').invoke('list', { event_id:event.event_id });
        if (eventAttempts.some((eventAttempt) => eventAttempt.state !== 'completed')) {
          fail('P4_WORK_ATTEMPT_REPAIR_EVENT_ATTEMPT_NONTERMINAL',
            'Cancelled Work Attempt repair found an executing Event Attempt.', { attemptId:request.attemptId });
        }
        for (const eventAttempt of eventAttempts) {
          const effects = context.repository('work_lifecycle_effects').invoke('list', {
            event_attempt_id:eventAttempt.event_attempt_id,
          });
          if (effects.some((effect) => NONTERMINAL_EFFECTS.has(effect.state))) {
            fail('P4_WORK_ATTEMPT_REPAIR_EFFECT_NONTERMINAL',
              'Cancelled Work Attempt repair found an unresolved Effect.', { attemptId:request.attemptId });
          }
        }
      }
      if (context.repository('work_lifecycle_attempts').invoke('transition', {
        attempt_id:request.attemptId, state:'cancelled', started_at_ms:attempt.started_at_ms,
        finished_at_ms:context.commitTimeMs, failure_code:request.reasonCode,
        expected_state:attempt.state,
      }).changes !== 1) {
        fail('P4_WORK_ATTEMPT_REPAIR_CAS', 'Cancelled Work Attempt repair fence changed.', {
          attemptId:request.attemptId,
        });
      }
      return Object.freeze({ workId:request.workId, attemptId:request.attemptId,
        state:'cancelled', replayed:false });
    });
  }

  return Object.freeze({ aggregate, aggregateEvent, cancelProcess, ensurePlanningAttempt, pendingOwnerReconciliations,
    pendingTerminalEventAggregations, repairCancelledWorkAttempt, settleWork, startPlanned });
}

module.exports = Object.freeze({ WorkLifecycleError, createWorkLifecycle });
