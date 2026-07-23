'use strict';

const { canonicalDigest, canonicalJson } = require('../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../persistence/owner-repository');

class SynchronousDomainWorkError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SynchronousDomainWorkError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new SynchronousDomainWorkError(code, message, details);
}

function definitions(schemaManifest) {
  return Object.freeze({
    works: createRepositoryDefinition({
      repositoryId: 'synchronous_work_works',
      owner: 'execution-foundation',
      schemaManifest,
      statements: {
        find: {
          kind: 'select-one',
          tableId: 'fx_supporting_works',
          columns: ['work_id', 'owner_domain', 'basis_digest', 'state'],
          keyColumns: ['work_id'],
        },
        transition: {
          kind: 'update',
          tableId: 'fx_supporting_works',
          setColumns: ['state', 'updated_at_ms'],
          keyColumns: ['work_id'],
          compareColumns: [{ column: 'state', parameter: 'expected_state' }],
        },
      },
    }),
    attempts: createRepositoryDefinition({
      repositoryId: 'synchronous_work_attempts',
      owner: 'execution-foundation',
      schemaManifest,
      statements: {
        find: {
          kind: 'select-one',
          tableId: 'fx_work_attempts',
          columns: ['attempt_id', 'work_id', 'basis_digest', 'state'],
          keyColumns: ['work_id', 'ordinal'],
        },
        insert: {
          kind: 'insert',
          tableId: 'fx_work_attempts',
          columns: [
            'attempt_id', 'work_id', 'ordinal', 'basis_digest', 'state',
            'started_at_ms', 'finished_at_ms', 'failure_code',
          ],
        },
        transition: {
          kind: 'update',
          tableId: 'fx_work_attempts',
          setColumns: ['state', 'finished_at_ms', 'failure_code'],
          keyColumns: ['attempt_id'],
          compareColumns: [{ column: 'state', parameter: 'expected_state' }],
        },
      },
    }),
    plans: createRepositoryDefinition({
      repositoryId: 'synchronous_work_plans',
      owner: 'execution-foundation',
      schemaManifest,
      statements: {
        find: {
          kind: 'select-one',
          tableId: 'fx_workflow_plans',
          columns: ['plan_id', 'attempt_id', 'basis_digest', 'graph_digest', 'state'],
          keyColumns: ['attempt_id'],
        },
        insert: {
          kind: 'insert',
          tableId: 'fx_workflow_plans',
          columns: [
            'plan_id', 'attempt_id', 'planner_ref', 'planner_version',
            'catalog_digest', 'basis_digest', 'graph_digest', 'state', 'created_at_ms',
          ],
        },
      },
    }),
    nodes: createRepositoryDefinition({
      repositoryId: 'synchronous_work_nodes',
      owner: 'execution-foundation',
      schemaManifest,
      statements: {
        list: {
          kind: 'select-all',
          tableId: 'fx_plan_nodes',
          columns: ['node_id', 'input_bindings_json'],
          keyColumns: ['plan_id'],
        },
        insert: {
          kind: 'insert',
          tableId: 'fx_plan_nodes',
          columns: [
            'plan_id', 'node_id', 'capability_ref', 'contract_version',
            'input_binding_schema_ref', 'input_bindings_json',
            'parameter_schema_ref', 'parameters_json', 'when_schema_ref', 'when_json',
            'effect_class', 'fence_schema_ref', 'fence_basis_json',
            'resource_demand_schema_ref', 'resource_demand_json',
          ],
        },
      },
    }),
    events: createRepositoryDefinition({
      repositoryId: 'synchronous_work_events',
      owner: 'execution-foundation',
      schemaManifest,
      statements: {
        find: {
          kind: 'select-one',
          tableId: 'fx_workflow_events',
          columns: ['event_id', 'node_id', 'state', 'result_id'],
          keyColumns: ['event_id'],
        },
        list: {
          kind: 'select-all',
          tableId: 'fx_workflow_events',
          columns: ['event_id', 'node_id', 'state', 'result_id'],
          keyColumns: ['work_id'],
        },
        insert: {
          kind: 'insert',
          tableId: 'fx_workflow_events',
          columns: [
            'event_id', 'plan_id', 'node_id', 'work_id', 'attempt_id',
            'owner_domain', 'capability_ref', 'contract_version', 'state',
            'priority_class', 'ready_at_ms', 'retry_at_ms', 'result_id',
            'current_progress_revision',
          ],
        },
        transition: {
          kind: 'update',
          tableId: 'fx_workflow_events',
          setColumns: ['state', 'result_id'],
          keyColumns: ['event_id'],
          compareColumns: [{ column: 'state', parameter: 'expected_state' }],
        },
      },
    }),
    results: createRepositoryDefinition({
      repositoryId: 'synchronous_work_results',
      owner: 'execution-foundation',
      schemaManifest,
      statements: {
        find_event: {
          kind: 'select-one',
          tableId: 'fx_event_result_bindings',
          columns: ['result_id'],
          keyColumns: ['event_id'],
        },
      },
    }),
  });
}

function orderedRows(rows) {
  return [...rows].sort((left, right) => left.node_id.localeCompare(right.node_id));
}

function parseInputs(row) {
  try {
    return JSON.parse(row.input_bindings_json);
  } catch {
    fail('SYNCHRONOUS_WORK_INPUT_CORRUPT', 'Frozen Workflow input is not valid JSON.', {
      nodeId: row.node_id,
    });
  }
}

function createSynchronousDomainWork(options) {
  if (!options?.schemaManifest || !options.unitOfWork) {
    fail('SYNCHRONOUS_WORK_DEPENDENCIES_REQUIRED', 'Synchronous Work requires clean Foundation persistence.');
  }
  const repositories = definitions(options.schemaManifest);
  const execute = (participantId, body) => options.unitOfWork.execute([{
    participantId,
    owner: 'execution-foundation',
    repositories: Object.values(repositories),
    execute: body,
  }])[participantId];

  function snapshot(workId) {
    return execute('synchronous_work_snapshot', (context) => {
      const work = context.repository(repositories.works.repositoryId).invoke('find', {
        work_id: workId,
      });
      if (!work) return null;
      const attempt = context.repository(repositories.attempts.repositoryId).invoke('find', {
        work_id: workId,
        ordinal: 1,
      });
      if (!attempt) return Object.freeze({ work, attempt: null, plan: null, pages: [], events: [] });
      const plan = context.repository(repositories.plans.repositoryId).invoke('find', {
        attempt_id: attempt.attempt_id,
      });
      if (!plan) return Object.freeze({ work, attempt, plan: null, pages: [], events: [] });
      const nodes = orderedRows(context.repository(repositories.nodes.repositoryId).invoke('list', {
        plan_id: plan.plan_id,
      }));
      const events = orderedRows(context.repository(repositories.events.repositoryId).invoke('list', {
        work_id: workId,
      }));
      return Object.freeze({
        work,
        attempt,
        plan,
        pages: Object.freeze(nodes.map(parseInputs)),
        events: Object.freeze(events),
      });
    });
  }

  function activate(request) {
    if (!request || !Array.isArray(request.steps) || request.steps.length < 1) {
      fail('SYNCHRONOUS_WORK_PLAN_INVALID', 'Synchronous Work requires at least one frozen step.');
    }
    const graphDigest = canonicalDigest({
      schema: 'helix.foundation.synchronous-domain-work-graph@1',
      workId: request.workId,
      basisDigest: request.basisDigest,
      steps: request.steps,
    });
    const existing = snapshot(request.workId);
    if (existing?.plan) {
      if (existing.work.basis_digest !== request.basisDigest ||
          existing.plan.graph_digest !== graphDigest) {
        fail('SYNCHRONOUS_WORK_PLAN_CONFLICT', 'Supporting Work already owns a different frozen graph.');
      }
      return Object.freeze({ replayed: true, graphDigest, snapshot: existing });
    }
    execute('synchronous_work_activate', (context) => {
      const works = context.repository(repositories.works.repositoryId);
      const work = works.invoke('find', { work_id: request.workId });
      if (!work || work.owner_domain !== request.ownerDomain ||
          work.basis_digest !== request.basisDigest || work.state !== 'admitted') {
        fail('SYNCHRONOUS_WORK_ADMISSION_FENCE', 'Supporting Work is absent or no longer admitted on the same Basis.');
      }
      const attemptId = request.workId + ':attempt:1';
      const planId = request.workId + ':plan:1';
      context.repository(repositories.attempts.repositoryId).invoke('insert', {
        attempt_id: attemptId,
        work_id: request.workId,
        ordinal: 1,
        basis_digest: request.basisDigest,
        state: 'running',
        started_at_ms: context.commitTimeMs,
        finished_at_ms: null,
        failure_code: null,
      });
      context.repository(repositories.plans.repositoryId).invoke('insert', {
        plan_id: planId,
        attempt_id: attemptId,
        planner_ref: request.plannerRef,
        planner_version: 1,
        catalog_digest: request.catalogDigest,
        basis_digest: request.basisDigest,
        graph_digest: graphDigest,
        state: 'planned',
        created_at_ms: context.commitTimeMs,
      });
      request.steps.forEach((step, ordinal) => {
        const nodeId = String(ordinal).padStart(6, '0') + ':' + step.nodeId;
        context.repository(repositories.nodes.repositoryId).invoke('insert', {
          plan_id: planId,
          node_id: nodeId,
          capability_ref: step.capabilityRef,
          contract_version: 1,
          input_binding_schema_ref: step.inputSchemaRef,
          input_bindings_json: canonicalJson(step.input),
          parameter_schema_ref: step.parametersSchemaRef,
          parameters_json: canonicalJson(step.parameters),
          when_schema_ref: null,
          when_json: null,
          effect_class: step.effectClass,
          fence_schema_ref: step.fenceSchemaRef,
          fence_basis_json: canonicalJson(step.fenceBasis),
          resource_demand_schema_ref: step.resourceDemandSchemaRef,
          resource_demand_json: canonicalJson(step.resourceDemand),
        });
        context.repository(repositories.events.repositoryId).invoke('insert', {
          event_id: step.eventId,
          plan_id: planId,
          node_id: nodeId,
          work_id: request.workId,
          attempt_id: attemptId,
          owner_domain: request.ownerDomain,
          capability_ref: step.capabilityRef,
          contract_version: 1,
          state: 'ready',
          priority_class: 'normal_foreground',
          ready_at_ms: context.commitTimeMs,
          retry_at_ms: null,
          result_id: null,
          current_progress_revision: null,
        });
      });
      if (works.invoke('transition', {
        work_id: request.workId,
        state: 'ready',
        updated_at_ms: context.commitTimeMs,
        expected_state: 'admitted',
      }).changes !== 1 || works.invoke('transition', {
        work_id: request.workId,
        state: 'running',
        updated_at_ms: context.commitTimeMs,
        expected_state: 'ready',
      }).changes !== 1) {
        fail('SYNCHRONOUS_WORK_ADMISSION_FENCE', 'Supporting Work activation CAS failed.');
      }
    });
    return Object.freeze({ replayed: false, graphDigest, snapshot: snapshot(request.workId) });
  }

  function beginEvent(eventId) {
    return execute('synchronous_work_begin_event', (context) => {
      const events = context.repository(repositories.events.repositoryId);
      let event = events.invoke('find', { event_id: eventId });
      if (!event) fail('SYNCHRONOUS_WORK_EVENT_MISSING', 'Frozen Workflow Event does not exist.', { eventId });
      if (event.state === 'succeeded') return Object.freeze({ state: 'succeeded', resultId: event.result_id });
      const result = context.repository(repositories.results.repositoryId).invoke('find_event', {
        event_id: eventId,
      });
      if (result) {
        if (event.state !== 'executing') {
          fail('SYNCHRONOUS_WORK_EVENT_RESULT_STATE_MISMATCH', 'Durable Event Result has an invalid Event state.', {
            eventId,
            state: event.state,
          });
        }
        if (events.invoke('transition', {
          event_id: eventId,
          state: 'succeeded',
          result_id: result.result_id,
          expected_state: 'executing',
        }).changes !== 1) {
          fail('SYNCHRONOUS_WORK_EVENT_CAS', 'Event recovery CAS failed.', { eventId });
        }
        return Object.freeze({ state: 'succeeded', resultId: result.result_id, recovered: true });
      }
      if (event.state === 'executing') return Object.freeze({ state: 'executing' });
      if (event.state !== 'ready') {
        fail('SYNCHRONOUS_WORK_EVENT_NOT_RUNNABLE', 'Frozen Workflow Event is not runnable.', {
          eventId,
          state: event.state,
        });
      }
      if (events.invoke('transition', {
        event_id: eventId,
        state: 'executing',
        result_id: null,
        expected_state: 'ready',
      }).changes !== 1) {
        fail('SYNCHRONOUS_WORK_EVENT_CAS', 'Event start CAS failed.', { eventId });
      }
      return Object.freeze({ state: 'executing' });
    });
  }

  function completeEvent(eventId, resultId) {
    return execute('synchronous_work_complete_event', (context) => {
      const events = context.repository(repositories.events.repositoryId);
      const event = events.invoke('find', { event_id: eventId });
      if (!event) fail('SYNCHRONOUS_WORK_EVENT_MISSING', 'Frozen Workflow Event does not exist.', { eventId });
      if (event.state === 'succeeded') {
        if (event.result_id !== resultId) {
          fail('SYNCHRONOUS_WORK_EVENT_RESULT_CONFLICT', 'Event already binds another immutable Result.', { eventId });
        }
        return Object.freeze({ replayed: true, eventId, resultId });
      }
      const result = context.repository(repositories.results.repositoryId).invoke('find_event', {
        event_id: eventId,
      });
      if (!result || result.result_id !== resultId || event.state !== 'executing') {
        fail('SYNCHRONOUS_WORK_EVENT_RESULT_MISSING', 'Event completion requires its exact durable Result.', { eventId });
      }
      if (events.invoke('transition', {
        event_id: eventId,
        state: 'succeeded',
        result_id: resultId,
        expected_state: 'executing',
      }).changes !== 1) {
        fail('SYNCHRONOUS_WORK_EVENT_CAS', 'Event completion CAS failed.', { eventId });
      }
      return Object.freeze({ replayed: false, eventId, resultId });
    });
  }

  function complete(workId) {
    return execute('synchronous_work_complete', (context) => {
      const works = context.repository(repositories.works.repositoryId);
      const attempts = context.repository(repositories.attempts.repositoryId);
      const events = context.repository(repositories.events.repositoryId).invoke('list', { work_id: workId });
      const work = works.invoke('find', { work_id: workId });
      const attempt = attempts.invoke('find', { work_id: workId, ordinal: 1 });
      if (!work || !attempt) fail('SYNCHRONOUS_WORK_FACT_MISSING', 'Supporting Work completion facts are missing.', { workId });
      if (work.state === 'succeeded' && attempt.state === 'succeeded') {
        return Object.freeze({ replayed: true, workId, state: 'succeeded' });
      }
      if (events.length < 1 || events.some((event) => event.state !== 'succeeded')) {
        fail('SYNCHRONOUS_WORK_EVENTS_INCOMPLETE', 'Supporting Work cannot complete before every Event succeeds.', { workId });
      }
      if (attempts.invoke('transition', {
        attempt_id: attempt.attempt_id,
        state: 'succeeded',
        finished_at_ms: context.commitTimeMs,
        failure_code: null,
        expected_state: 'running',
      }).changes !== 1 || works.invoke('transition', {
        work_id: workId,
        state: 'succeeded',
        updated_at_ms: context.commitTimeMs,
        expected_state: 'running',
      }).changes !== 1) {
        fail('SYNCHRONOUS_WORK_COMPLETION_CAS', 'Supporting Work completion CAS failed.', { workId });
      }
      return Object.freeze({ replayed: false, workId, state: 'succeeded' });
    });
  }

  return Object.freeze({ activate, beginEvent, complete, completeEvent, snapshot });
}

module.exports = Object.freeze({
  SynchronousDomainWorkError,
  createSynchronousDomainWork,
});
