'use strict';

const { createRepositoryDefinition } = require('../persistence/owner-repository');

function createCatalogPlanProofReader({ schemaManifest, unitOfWork }) {
  const select = (tableId, columns, keyColumns, one = false) => ({
    kind: one ? 'select-one' : 'select-all', tableId, columns, keyColumns,
  });
  const repository = createRepositoryDefinition({
    repositoryId: 'catalog_plan_proof', owner: 'execution-foundation', schemaManifest,
    statements: {
      plan: select('fx_workflow_plans', ['plan_id', 'attempt_id', 'catalog_digest', 'basis_digest', 'graph_digest', 'state'], ['plan_id'], true),
      work_attempt: select('fx_work_attempts', ['attempt_id', 'work_id', 'ordinal', 'basis_digest', 'state'], ['attempt_id'], true),
      work: select('fx_supporting_works', ['work_id', 'owner_domain', 'process_type', 'process_id', 'state'], ['work_id'], true),
      nodes: select('fx_plan_nodes', ['plan_id', 'node_id', 'capability_ref', 'contract_version', 'effect_class',
        'input_binding_schema_ref', 'input_bindings_json', 'parameter_schema_ref', 'parameters_json',
        'when_schema_ref', 'when_json', 'fence_schema_ref', 'fence_basis_json', 'resource_demand_schema_ref', 'resource_demand_json'], ['plan_id']),
      edges: select('fx_plan_edges', ['plan_id', 'from_node_id', 'to_node_id', 'dependency_kind'], ['plan_id']),
      events: select('fx_workflow_events', ['event_id', 'plan_id', 'node_id', 'work_id', 'attempt_id', 'owner_domain',
        'capability_ref', 'contract_version', 'state', 'result_id'], ['plan_id']),
      work_events: select('fx_workflow_events', ['event_id', 'plan_id', 'work_id'], ['work_id']),
      attempts: select('fx_event_attempts', ['event_attempt_id', 'event_id', 'ordinal', 'state', 'outcome_kind',
        'input_snapshot_digest', 'fence_snapshot_digest', 'evidence_digest'], ['event_id']),
      effects: select('fx_effect_journal', ['effect_id', 'event_attempt_id', 'effect_class', 'state', 'output_digest'], ['event_attempt_id']),
      result: select('fx_event_result_bindings', ['result_id', 'event_id', 'outcome_kind', 'result_schema_ref',
        'result_json', 'result_digest', 'evidence_schema_ref', 'evidence_json', 'evidence_digest', 'effect_receipt_id'], ['event_id'], true),
      markers: select('fx_commit_markers', ['commit_marker', 'commit_digest', 'effect_id', 'result_id', 'result_schema_ref', 'result_digest', 'owner_domain'], ['effect_id']),
    },
  });
  return Object.freeze({
    verify(callback) {
      // Read each graph and its cross-Work sources inside one read transaction.
      // Result payloads are never added to the process-wide startup snapshot.
      return unitOfWork.execute([{
        participantId: 'catalog_plan_proof_read', owner: 'execution-foundation', repositories: [repository],
        execute(context) {
          const repo = context.repository(repository.repositoryId);
          return callback({
            workPlanIds(workId) {
              const rows = repo.invoke('work_events', { work_id: workId });
              if (rows.some(row => row.work_id !== workId)) throw new Error('Cross-Work scope mismatch.');
              return [...new Set(rows.map(row => row.plan_id))];
            },
            read(planId) {
              const plan = repo.invoke('plan', { plan_id: planId });
              if (!plan) return null;
              const workAttempt = repo.invoke('work_attempt', { attempt_id: plan.attempt_id });
              const work = workAttempt && repo.invoke('work', { work_id: workAttempt.work_id });
              const nodes = repo.invoke('nodes', { plan_id: planId });
              const edges = repo.invoke('edges', { plan_id: planId });
              const events = repo.invoke('events', { plan_id: planId });
              const attempts = events.flatMap(event => repo.invoke('attempts', { event_id: event.event_id }));
              const effects = attempts.flatMap(attempt => repo.invoke('effects', { event_attempt_id: attempt.event_attempt_id }));
              const results = events.map(event => repo.invoke('result', { event_id: event.event_id })).filter(Boolean);
              const markers = effects.flatMap(effect => repo.invoke('markers', { effect_id: effect.effect_id }));
              return { plan, workAttempt, work, nodes, edges, events, attempts, effects, results, markers };
            },
          });
        },
      }]).catalog_plan_proof_read;
    },
  });
}

module.exports = Object.freeze({ createCatalogPlanProofReader });
