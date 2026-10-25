'use strict';

// Frozen graph reader for pre-evidence offline structural tools.
// The live service and new evidence import use the current Foundation reader.

const { createRepositoryDefinition } = require('../../../src/helix/foundation/persistence/owner-repository');

function createCatalogPlanProofReader({ schemaManifest, unitOfWork }) {
  const select = (tableId, columns, keyColumns, one = false) => ({
    kind: one ? 'select-one' : 'select-all', tableId, columns, keyColumns,
  });
  const selectMany = (tableId, columns, keyColumn) => ({
    kind:'select-in', tableId, columns, keyColumn, maxItems:500,
  });
  const repositoryDefinition = {
    repositoryId: 'catalog_plan_proof', owner: 'execution-foundation', schemaManifest,
    statements: {
      plan: select('fx_workflow_plans', ['plan_id', 'attempt_id', 'catalog_digest', 'basis_digest', 'graph_digest', 'state'], ['plan_id'], true),
      work_attempt: select('fx_work_attempts', ['attempt_id', 'work_id', 'ordinal', 'basis_digest', 'state'], ['attempt_id'], true),
      work: select('fx_supporting_works', ['work_id', 'owner_domain', 'process_type', 'process_id', 'work_kind', 'state',
        'definition_json', 'definition_digest'], ['work_id'], true),
      nodes: select('fx_plan_nodes', ['plan_id', 'node_id', 'capability_ref', 'contract_version', 'effect_class',
        'input_binding_schema_ref', 'input_bindings_json', 'parameter_schema_ref', 'parameters_json',
        'when_schema_ref', 'when_json', 'fence_schema_ref', 'fence_basis_json', 'resource_demand_schema_ref', 'resource_demand_json'], ['plan_id']),
      edges: select('fx_plan_edges', ['plan_id', 'from_node_id', 'to_node_id', 'dependency_kind'], ['plan_id']),
      events: select('fx_workflow_events', ['event_id', 'plan_id', 'node_id', 'work_id', 'attempt_id', 'owner_domain',
        'capability_ref', 'contract_version', 'state', 'result_id'], ['plan_id']),
      work_events: select('fx_workflow_events', ['event_id', 'plan_id', 'work_id'], ['work_id']),
      attempts: select('fx_event_attempts', ['event_attempt_id', 'event_id', 'ordinal', 'state', 'outcome_kind',
        'input_snapshot_digest', 'fence_snapshot_digest', 'evidence_digest', 'started_at_ms', 'finished_at_ms'], ['event_id']),
      effects: selectMany('fx_effect_journal', ['effect_id', 'event_attempt_id', 'effect_class', 'state', 'output_digest',
        'intent_digest', 'idempotency_key', 'external_receipt_ref'], 'event_attempt_id'),
      result: select('fx_event_result_bindings', ['result_id', 'event_id', 'outcome_kind', 'result_schema_ref',
        'result_json', 'result_digest', 'evidence_schema_ref', 'evidence_json', 'evidence_digest', 'effect_receipt_id'], ['event_id'], true),
      markers: selectMany('fx_commit_markers', ['commit_marker', 'commit_digest', 'effect_id', 'result_id', 'result_schema_ref', 'result_digest', 'owner_domain'], 'effect_id'),
    },
  };
  for (const name of ['plan', 'work_attempt', 'work', 'nodes', 'edges', 'events', 'attempts', 'result']) {
    const statement = repositoryDefinition.statements[name];
    repositoryDefinition.statements[name + '_batch'] = selectMany(statement.tableId, statement.columns, statement.keyColumns[0]);
  }
  const repository = createRepositoryDefinition(repositoryDefinition);
  return Object.freeze({
    verify(callback) {
      // Read each graph and its cross-Work sources inside one read transaction.
      // Result payloads are never added to the process-wide startup snapshot.
      return unitOfWork.execute([{
        participantId: 'catalog_plan_proof_read', owner: 'execution-foundation', repositories: [repository],
        execute(context) {
          const repo = context.repository(repository.repositoryId);
          const factsByPlan = new Map(), planIdsByWork = new Map();
          function readMany(statement, identities) {
            const unique = [...new Set(identities)], rows = [];
            for (let offset = 0; offset < unique.length; offset += 500) {
              rows.push(...repo.invoke(statement, { values:unique.slice(offset, offset + 500) }));
            }
            return rows;
          }
          const by = (rows, key) => {
            const map = new Map();
            for (const row of rows) { if (!map.has(row[key])) map.set(row[key], []); map.get(row[key]).push(row); }
            return map;
          };
          function prefetch(planIds) {
            const missing = [...new Set(planIds)].filter(id => !factsByPlan.has(id));
            if (!missing.length) return;
            const plans = readMany('plan_batch', missing);
            const workAttempts = new Map(readMany('work_attempt_batch', plans.map(p => p.attempt_id)).map(a => [a.attempt_id, a]));
            const works = new Map(readMany('work_batch', [...workAttempts.values()].map(a => a.work_id)).map(w => [w.work_id, w]));
            const nodes = by(readMany('nodes_batch', missing), 'plan_id');
            const edges = by(readMany('edges_batch', missing), 'plan_id');
            const allEvents = readMany('events_batch', missing), events = by(allEvents, 'plan_id');
            const allAttempts = readMany('attempts_batch', allEvents.map(e => e.event_id)), attempts = by(allAttempts, 'event_id');
            const allEffects = readMany('effects', allAttempts.map(a => a.event_attempt_id)), effects = by(allEffects, 'event_attempt_id');
            const results = by(readMany('result_batch', allEvents.map(e => e.event_id)), 'event_id');
            const markers = by(readMany('markers', allEffects.map(e => e.effect_id)), 'effect_id');
            for (const id of missing) factsByPlan.set(id, null);
            for (const plan of plans) {
              const workAttempt = workAttempts.get(plan.attempt_id), planEvents = events.get(plan.plan_id) || [];
              const planAttempts = planEvents.flatMap(e => attempts.get(e.event_id) || []);
              const planEffects = planAttempts.flatMap(a => effects.get(a.event_attempt_id) || []);
              factsByPlan.set(plan.plan_id, { plan, workAttempt, work: works.get(workAttempt?.work_id),
                nodes: nodes.get(plan.plan_id) || [], edges: edges.get(plan.plan_id) || [], events: planEvents,
                attempts: planAttempts, effects: planEffects,
                results: planEvents.flatMap(e => results.get(e.event_id) || []),
                markers: planEffects.flatMap(e => markers.get(e.effect_id) || []) });
            }
          }
          return callback({
            prefetch,
            workPlanIds(workId) {
              if (planIdsByWork.has(workId)) return planIdsByWork.get(workId);
              const rows = repo.invoke('work_events', { work_id: workId });
              if (rows.some(row => row.work_id !== workId)) throw new Error('Cross-Work scope mismatch.');
              const ids = [...new Set(rows.map(row => row.plan_id))];
              planIdsByWork.set(workId, ids);
              return ids;
            },
            read(planId) {
              prefetch([planId]);
              return factsByPlan.get(planId);
            },
          });
        },
      }]).catalog_plan_proof_read;
    },
  });
}

module.exports = Object.freeze({ createCatalogPlanProofReader });
