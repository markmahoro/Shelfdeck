'use strict';

const { canonicalDigest, canonicalJson } = require('../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../persistence/owner-repository');

const CONTRACT = 'foundation.stopped-execution-termination@1';
const RESULT = 'foundation.stopped-execution-termination-receipt@1';
const HASH = /^[a-f0-9]{64}$/;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const normalize = value => typeof value === 'bigint' ? Number(value) : Array.isArray(value) ? value.map(normalize) :
  value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)])) : value;

// Only execution facts live here. The enclosing stopped operator and the
// owning Workspace adapter must prove authorization and physical containment.
function validateTerminationSnapshot(value) {
  const { event, work, plan, workAttempt, node, attempts, effects, markers, results } = value;
  const attempt = attempts?.find(row => row.state === 'executing');
  const effect = effects?.length === 1 ? effects[0] : null;
  if (!event || !work || !plan || !workAttempt || !node || !attempt || !effect ||
      event.state !== 'executing' || event.result_id !== null ||
      !['admitted', 'ready', 'running', 'blocked'].includes(work.state) ||
      !['ready', 'running', 'blocked'].includes(workAttempt.state) ||
      event.owner_domain !== work.owner_domain || event.work_id !== work.work_id ||
      workAttempt.work_id !== work.work_id || event.attempt_id !== workAttempt.attempt_id ||
      plan.attempt_id !== workAttempt.attempt_id || plan.plan_id !== event.plan_id ||
      node.plan_id !== plan.plan_id || node.node_id !== event.node_id ||
      node.capability_ref !== event.capability_ref || node.contract_version !== event.contract_version ||
      attempt.executor_ref !== event.capability_ref || attempts.filter(row => row.state === 'executing').length !== 1 ||
      attempt.event_id !== event.event_id || effect.event_attempt_id !== attempt.event_attempt_id ||
      node.effect_class !== 'workspace_write' || effect.effect_class !== node.effect_class ||
      !['intended', 'reconcile_required'].includes(effect.state) ||
      effect.external_receipt_ref !== null || effect.output_digest !== null || markers.length || results.length ||
      effect.intent_digest !== canonicalDigest({ eventId:event.event_id, capabilityRef:event.capability_ref,
        contractVersion:event.contract_version, inputSnapshotDigest:attempt.input_snapshot_digest,
        fenceSnapshotDigest:attempt.fence_snapshot_digest })) {
    fail('STOPPED_EXECUTION_NOT_TERMINABLE', 'Execution does not prove an uncommitted, isolated Workspace attempt.');
  }
  return Object.freeze({ ...value, snapshotDigest:canonicalDigest(value) });
}

function createStoppedExecutionTerminationStore(options) {
  const tables = Object.fromEntries(options.schemaManifest.tables.map(table => [table.tableId, table.columns]));
  const read = (tableId, keyColumns, kind = 'select-one') => ({ kind, tableId, columns:tables[tableId], keyColumns, safeIntegers:true });
  const repository = createRepositoryDefinition({ repositoryId:'stopped_execution_termination', owner:'execution-foundation',
    schemaManifest:options.schemaManifest, statements:{
      event:read('fx_workflow_events', ['event_id']), work:read('fx_supporting_works', ['work_id']),
      plan:read('fx_workflow_plans', ['plan_id']), work_attempt:read('fx_work_attempts', ['attempt_id']),
      node:read('fx_plan_nodes', ['plan_id', 'node_id']), attempts:read('fx_event_attempts', ['event_id'], 'select-all'),
      effects:read('fx_effect_journal', ['event_attempt_id'], 'select-all'),
      markers:read('fx_commit_markers', ['effect_id'], 'select-all'),
      results:read('fx_event_result_bindings', ['event_id'], 'select-all'),
      receipt:read('fx_command_receipts', ['command_receipt_id']),
      insert_receipt:{kind:'insert', tableId:'fx_command_receipts', columns:tables.fx_command_receipts},
      cancel_event:{kind:'update', tableId:'fx_workflow_events', keyColumns:['event_id'],
        setColumns:['state', 'retry_at_ms'], compareColumns:[{column:'state',parameter:'expected_state'}]},
      cancel_attempt:{kind:'update', tableId:'fx_event_attempts', keyColumns:['event_attempt_id'],
        setColumns:['state', 'outcome_kind', 'failure_class', 'failure_code', 'evidence_digest', 'finished_at_ms', 'retry_after_ms'],
        compareColumns:[{column:'state',parameter:'expected_state'}]},
      fail_effect:{kind:'update', tableId:'fx_effect_journal', keyColumns:['effect_id'], setColumns:['state', 'updated_at_ms'],
        compareColumns:[{column:'state',parameter:'expected_state'}]},
    } });
  function capture(repo, eventId) {
    const event = repo.invoke('event', {event_id:eventId});
    if (!event) fail('STOPPED_EXECUTION_NOT_FOUND', 'Stopped execution is missing.');
    const attempts = repo.invoke('attempts', {event_id:eventId}).sort((a,b) => Number(a.ordinal)-Number(b.ordinal));
    const active = attempts.filter(row => row.state === 'executing');
    const effects = active.flatMap(row => repo.invoke('effects', {event_attempt_id:row.event_attempt_id}));
    return validateTerminationSnapshot(normalize({ event, attempts, effects,
      work:repo.invoke('work', {work_id:event.work_id}), plan:repo.invoke('plan', {plan_id:event.plan_id}),
      workAttempt:repo.invoke('work_attempt', {attempt_id:event.attempt_id}),
      node:repo.invoke('node', {plan_id:event.plan_id, node_id:event.node_id}),
      markers:effects.flatMap(row => repo.invoke('markers', {effect_id:row.effect_id})),
      results:repo.invoke('results', {event_id:eventId}),
    }));
  }
  return Object.freeze({
    commit(request) {
      if (!request || Object.keys(request).sort().join(',') !== 'backupDigest,eventId,manifestDigest,realityDigest,retirementId,snapshotDigest' ||
          typeof request.retirementId !== 'string' || !request.retirementId || typeof request.eventId !== 'string' || !request.eventId ||
          ['manifestDigest', 'backupDigest', 'snapshotDigest', 'realityDigest'].some(key => !HASH.test(request[key] || '')))
        fail('STOPPED_EXECUTION_REQUEST_INVALID', 'Termination requires exact execution, reality, manifest and backup digests.');
      options.assertStopped(request);
      const requestDigest = canonicalDigest(request);
      const receiptId = canonicalDigest({contract:CONTRACT, retirementId:request.retirementId, eventId:request.eventId});
      return options.unitOfWork.execute([{participantId:'stopped_execution_termination', owner:'execution-foundation',
        repositories:[repository], execute(context) {
          const repo = context.repository(repository.repositoryId);
          const prior = normalize(repo.invoke('receipt', {command_receipt_id:receiptId}));
          if (prior) {
            const receipt = JSON.parse(prior.result_ref_json);
            if (prior.request_digest !== requestDigest || prior.result_digest !== canonicalDigest(receipt) ||
                prior.owner_domain !== 'execution-foundation' || prior.command_contract !== CONTRACT || prior.result_schema_ref !== RESULT ||
                prior.target_id !== request.eventId || prior.target_type !== 'workflow_event' || prior.caller_scope !== request.retirementId ||
                prior.idempotency_key !== request.eventId || receipt.schema !== RESULT || receipt.receiptId !== receiptId ||
                Object.keys(request).some(key=>receipt[key]!==request[key]))
              fail('STOPPED_EXECUTION_REPLAY_CONFLICT', 'Termination identity binds another request or receipt.');
            const event = repo.invoke('event', {event_id:request.eventId});
            const attempt = repo.invoke('attempts', {event_id:request.eventId}).find(row => row.event_attempt_id === receipt.eventAttemptId);
            const effect = repo.invoke('effects', {event_attempt_id:receipt.eventAttemptId}).find(row => row.effect_id === receipt.effectId);
            if (event?.state !== 'cancelled' || attempt?.state !== 'completed' || attempt.outcome_kind !== 'cancelled' ||
                attempt.evidence_digest !== prior.result_digest || effect?.state !== 'failed')
              fail('STOPPED_EXECUTION_REPLAY_CONFLICT', 'Termination receipt no longer matches execution state.');
            return {replayed:true, receipt};
          }
          const snapshot = capture(repo, request.eventId);
          if (snapshot.snapshotDigest !== request.snapshotDigest)
            fail('STOPPED_EXECUTION_SNAPSHOT_DRIFT', 'Stopped execution changed since the frozen preview.');
          const reality = options.observeWorkspace(snapshot);
          if (!reality || reality.disposition !== 'retained_private_workspace' || canonicalDigest(reality) !== request.realityDigest)
            fail('STOPPED_EXECUTION_REALITY_DRIFT', 'Workspace reality changed since the frozen preview.');
          options.assertStopped(request);
          const attempt = snapshot.attempts.find(row => row.state === 'executing'), effect = snapshot.effects[0];
          const receipt = {schema:RESULT, receiptId, ...request, eventAttemptId:attempt.event_attempt_id,
            effectId:effect.effect_id, disposition:'administratively_cancelled', reality, committedAtMs:context.commitTimeMs};
          const resultDigest = canonicalDigest(receipt);
          if (Buffer.byteLength(canonicalJson(receipt)) > 16384)
            fail('STOPPED_EXECUTION_RECEIPT_TOO_LARGE', 'Termination evidence exceeds the bounded command receipt.');
          const changed = [
            repo.invoke('cancel_event', {event_id:request.eventId, expected_state:'executing', state:'cancelled', retry_at_ms:null}),
            repo.invoke('cancel_attempt', {event_attempt_id:attempt.event_attempt_id, expected_state:'executing', state:'completed',
              outcome_kind:'cancelled', failure_class:null, failure_code:'ADMINISTRATIVE_FORMATION_RETIREMENT',
              evidence_digest:resultDigest, finished_at_ms:context.commitTimeMs, retry_after_ms:null}),
            repo.invoke('fail_effect', {effect_id:effect.effect_id, expected_state:effect.state, state:'failed', updated_at_ms:context.commitTimeMs}),
          ];
          if (changed.some(value => value.changes !== 1)) fail('STOPPED_EXECUTION_COMMIT_RACE', 'Execution changed during termination.');
          options.beforeReceipt?.();
          repo.invoke('insert_receipt', {command_receipt_id:receiptId, owner_domain:'execution-foundation', command_contract:CONTRACT,
            caller_scope:request.retirementId, idempotency_key:request.eventId, request_digest:requestDigest,
            target_type:'workflow_event', target_id:request.eventId, result_schema_ref:RESULT,
            result_ref_json:canonicalJson(receipt), result_digest:resultDigest, committed_at_ms:context.commitTimeMs});
          return {replayed:false, receipt};
        }}]).stopped_execution_termination;
    },
  });
}

module.exports = Object.freeze({validateTerminationSnapshot, createStoppedExecutionTerminationStore});
