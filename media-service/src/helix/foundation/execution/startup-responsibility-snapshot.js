'use strict';

const { createRepositoryDefinition } = require('../persistence/owner-repository');

// Startup roots are current responsibility, including unresolved Effects on
// terminal Work. Closed, unrelated history is visited by the separate audit.
const STARTUP_ROOT_STATES = Object.freeze({
  works: Object.freeze(['admitted', 'ready', 'running', 'blocked']),
  workAttempts: Object.freeze(['ready', 'running', 'blocked']),
  events: Object.freeze(['pending', 'ready', 'executing', 'waiting_for_external', 'waiting_for_resource', 'waiting_for_approval']),
  attempts: Object.freeze(['executing']),
  effects: Object.freeze(['intended', 'effect_observed', 'reconcile_required']),
  defers: Object.freeze(['waiting']),
});

const TABLES = {
  works: ['fx_supporting_works', 'work_id', ['work_id', 'owner_domain', 'process_type', 'process_id', 'work_kind', 'state'], []],
  workAttempts: ['fx_work_attempts', 'attempt_id', ['attempt_id', 'work_id', 'ordinal', 'state'], ['work_id']],
  plans: ['fx_workflow_plans', 'plan_id', ['plan_id', 'attempt_id', 'catalog_digest', 'state'], ['attempt_id']],
  events: ['fx_workflow_events', 'event_id', ['event_id', 'plan_id', 'node_id', 'work_id', 'attempt_id', 'owner_domain', 'capability_ref', 'state', 'retry_at_ms'], ['plan_id']],
  nodes: ['fx_plan_nodes', null, ['plan_id', 'node_id', 'capability_ref', 'contract_version', 'effect_class', 'input_bindings_json', 'parameters_json'], ['plan_id']],
  attempts: ['fx_event_attempts', 'event_attempt_id', ['event_attempt_id', 'event_id', 'ordinal', 'state', 'outcome_kind', 'failure_class', 'failure_code', 'started_at_ms'], ['event_id']],
  effects: ['fx_effect_journal', 'effect_id', ['effect_id', 'event_attempt_id', 'effect_class', 'state', 'external_receipt_ref', 'output_digest'], ['event_attempt_id']],
  defers: ['fx_resource_defer', 'event_id', ['event_id', 'resource_key', 'state', 'retry_at_ms'], []],
  circuits: ['fx_circuit_states', 'circuit_key', ['circuit_key', 'state', 'reason_code', 'evidence_digest'], []],
};

function createStartupResponsibilitySnapshot({ schemaManifest, unitOfWork }) {
  const definitions = Object.fromEntries(Object.entries(TABLES).map(([name, [tableId, key, columns, parents]]) => {
    const keys = [...new Set([key, ...parents, ...(columns.includes('state') ? ['state'] : [])].filter(Boolean))];
    return [name, createRepositoryDefinition({ repositoryId: 'startup_responsibility_' + name.toLowerCase(),
      owner: 'execution-foundation', schemaManifest, statements: { ...Object.fromEntries(keys.map(column => ['by_' + column,
        { kind: 'select-in', tableId, columns, keyColumn: column, maxItems: 500 }])),
      ...(name === 'effects' ? { standalone: { kind: 'select-page-after', tableId, columns, keyColumn: 'effect_id',
        nullKeyColumns: ['event_attempt_id'], maxItems: 500 } } : {}) } })];
  }));
  return Object.freeze({ read() {
    return unitOfWork.execute([{ participantId: 'startup_responsibility_snapshot', owner: 'execution-foundation',
      repositories: Object.values(definitions), execute(context) {
        const rows = Object.fromEntries(Object.keys(TABLES).map(name => [name, new Map()]));
        function read(name, column, values, retain = true) {
          const selected = [], ids = [...new Set(values.filter(value => value !== null && value !== undefined))];
          for (let offset = 0; offset < ids.length; offset += 500) selected.push(...context.repository(definitions[name].repositoryId)
            .invoke('by_' + column, { values: ids.slice(offset, offset + 500) }));
          for (const row of retain ? selected : []) {
            const key = name === 'nodes' ? row.plan_id + '\0' + row.node_id
              : name === 'defers' ? row.event_id + '\0' + row.resource_key : row[TABLES[name][1]];
            rows[name].set(key, row);
          }
          return selected;
        }
        const values = (name, column) => [...rows[name].values()].map(row => row[column]);
        const activeWorks = read('works', 'state', STARTUP_ROOT_STATES.works);
        read('workAttempts', 'state', STARTUP_ROOT_STATES.workAttempts);
        read('events', 'state', STARTUP_ROOT_STATES.events);
        read('attempts', 'state', STARTUP_ROOT_STATES.attempts);
        read('effects', 'state', STARTUP_ROOT_STATES.effects);
        let cursor = null;
        for (;;) {
          const page = context.repository(definitions.effects.repositoryId).invoke('standalone', { cursor, limit: 500 });
          for (const row of page) rows.effects.set(row.effect_id, row);
          if (page.length < 500) break;
          cursor = page.at(-1).effect_id;
        }
        read('defers', 'state', STARTUP_ROOT_STATES.defers);
        read('circuits', 'state', ['open', 'recovering']);
        read('attempts', 'event_attempt_id', values('effects', 'event_attempt_id'));
        read('events', 'event_id', [...values('attempts', 'event_id'), ...values('defers', 'event_id')]);
        read('workAttempts', 'attempt_id', values('events', 'attempt_id'));
        const latestAttempts = new Map();
        for (const attempt of read('workAttempts', 'work_id', activeWorks.map(row => row.work_id), false)) {
          const latest = latestAttempts.get(attempt.work_id);
          if (!latest || attempt.ordinal > latest.ordinal) latestAttempts.set(attempt.work_id, attempt);
        }
        read('workAttempts', 'attempt_id', [...latestAttempts.values()].map(row => row.attempt_id));
        read('plans', 'plan_id', values('events', 'plan_id'));
        read('plans', 'attempt_id', values('workAttempts', 'attempt_id'));
        read('workAttempts', 'attempt_id', values('plans', 'attempt_id'));
        read('works', 'work_id', [...values('workAttempts', 'work_id'), ...values('events', 'work_id')]);
        read('nodes', 'plan_id', values('plans', 'plan_id'));
        read('events', 'plan_id', values('plans', 'plan_id'));
        read('attempts', 'event_id', values('events', 'event_id'));
        read('effects', 'event_attempt_id', values('attempts', 'event_attempt_id'));
        return Object.freeze(Object.fromEntries(Object.entries(rows).map(([name, records]) => [name, [...records.values()]])));
      } }]).startup_responsibility_snapshot;
  } });
}

module.exports = Object.freeze({ createStartupResponsibilitySnapshot, STARTUP_ROOT_STATES });
