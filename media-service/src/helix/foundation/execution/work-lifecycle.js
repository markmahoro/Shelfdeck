'use strict';

const { createRepositoryDefinition } = require('../persistence/owner-repository');

const TERMINAL_EVENTS = new Set(['succeeded', 'skipped', 'failed', 'cancelled']);

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

function definitions(schemaManifest) {
  return Object.freeze({
    works: createRepositoryDefinition({ repositoryId: 'work_lifecycle_works', owner: 'execution-foundation', schemaManifest, statements: {
      find: { kind: 'select-one', tableId: 'fx_supporting_works', columns: [
        'work_id', 'owner_domain', 'process_type', 'process_id', 'work_kind', 'basis_digest', 'priority_class', 'state',
        'idempotency_key'
      ], keyColumns: ['work_id'] },
      list: { kind: 'select-all', tableId: 'fx_supporting_works', columns: [
        'work_id', 'owner_domain', 'process_type', 'process_id', 'work_kind', 'basis_digest', 'priority_class', 'state',
        'idempotency_key'
      ], keyColumns: [] },
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
      list_work: { kind: 'select-all', tableId: 'fx_workflow_events', columns: ['event_id', 'work_id', 'state', 'result_id'], keyColumns: ['work_id'] },
      find: { kind: 'select-one', tableId: 'fx_workflow_events', columns: ['event_id', 'work_id', 'state', 'result_id'], keyColumns: ['event_id'] }
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
      const work = works.invoke('find', { work_id: workId });
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
      return Object.freeze({ workId, attemptId, state: workState, attemptState, resolution: plan.state, replayed: false });
    });
  }

  function aggregate(workId) {
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
      const active = attempts.invoke('list', { work_id: workId }).filter((attempt) => attempt.state === 'running');
      if (active.length !== 1) fail('P4_WORK_RUNNING_ATTEMPT_CARDINALITY', 'Running Work must own exactly one running Attempt.', { workId });
      const events = context.repository('work_lifecycle_events').invoke('list_work', { work_id: workId });
      if (events.length < 1 || events.some((event) => !TERMINAL_EVENTS.has(event.state))) {
        return Object.freeze({ attemptTerminal: false, workTerminal: false, work: Object.freeze(work),
          eventCount: events.length, replayed: false });
      }
      const state = events.some((event) => event.state === 'failed') ? 'failed'
        : events.some((event) => event.state === 'cancelled') ? 'cancelled' : 'succeeded';
      const failureCode = state === 'failed' ? 'EVENT_TERMINAL_FAILURE' : null;
      if (attempts.invoke('transition', {
        attempt_id: active[0].attempt_id, state, started_at_ms: active[0].started_at_ms,
        finished_at_ms: context.commitTimeMs, failure_code: failureCode, expected_state: 'running',
      }).changes !== 1) fail('P4_WORK_ATTEMPT_TERMINAL_CAS', 'Work Attempt terminal aggregation fence changed.');
      return Object.freeze({ attemptTerminal: true, workTerminal: false, work: Object.freeze(work),
        attemptId: active[0].attempt_id, attemptState: state, eventCount: events.length, replayed: false });
    });
  }

  function settleWork(request) {
    if (!request || typeof request.workId !== 'string' || !request.workId ||
        !['succeeded', 'failed', 'cancelled', 'blocked', 'replan'].includes(request.disposition)) {
      fail('P4_WORK_DISPOSITION_INVALID', 'Domain Owner returned an invalid Work disposition.');
    }
    return execute('work_lifecycle_settle', (context) => {
      const works = context.repository('work_lifecycle_works');
      const work = works.invoke('find', { work_id: request.workId });
      if (!work) fail('P4_WORK_FACT_MISSING', 'Supporting Work does not exist.', { workId: request.workId });
      const desired = request.disposition === 'replan' ? 'ready' : request.disposition;
      if (work.state === desired) return Object.freeze({ workId: request.workId, state: desired, replayed: true });
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
    const workId = execute('work_lifecycle_event_owner', (context) => {
      const event = context.repository('work_lifecycle_events').invoke('find', { event_id: eventId });
      return event?.work_id || null;
    });
    if (!workId) fail('P4_WORK_EVENT_FACT_MISSING', 'Workflow Event does not exist.', { eventId });
    return aggregate(workId);
  }

  function pendingOwnerReconciliations(limit = 16) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) {
      fail('P4_WORK_RECONCILE_LIMIT_INVALID', 'Owner reconciliation scan limit is invalid.');
    }
    return execute('work_lifecycle_pending_owner_reconcile', (context) => {
      const attempts = context.repository('work_lifecycle_attempts');
      return context.repository('work_lifecycle_works').invoke('list', {})
        .filter((work) => work.state === 'running')
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

  return Object.freeze({ aggregate, aggregateEvent, ensurePlanningAttempt, pendingOwnerReconciliations,
    settleWork, startPlanned });
}

module.exports = Object.freeze({ WorkLifecycleError, createWorkLifecycle });
