'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

const MAX_GENERATION = 32;
const COLUMNS = Object.freeze([
  'offer_id','on_deck_package_id','package_digest','acceptance_attempt_id','active_work_id','work_kind',
  'failure_phase','error_code','terminal_attempt_count','owner_domain','recovery_state','recovery_generation',
  'automatic_recovery_used','recovery_trigger_digest','failed_trigger_digest','incident_key','updated_at_ms','resolved_at_ms',
]);

function definition(schemaManifest) {
  return createRepositoryDefinition({ repositoryId:'arca_acceptance_recovery', owner:'arca', schemaManifest, statements:{
    find:{ kind:'select-one', tableId:'arca_acceptance_recovery_cases', columns:COLUMNS, keyColumns:['offer_id'], safeIntegers:true },
    list:{ kind:'select-all', tableId:'arca_acceptance_recovery_cases', columns:COLUMNS, keyColumns:[], safeIntegers:true },
    insert:{ kind:'insert', tableId:'arca_acceptance_recovery_cases', columns:COLUMNS },
    advance:{ kind:'update', tableId:'arca_acceptance_recovery_cases', setColumns:COLUMNS.filter((item)=>!['offer_id','on_deck_package_id','package_digest'].includes(item)),
      keyColumns:['offer_id'], compareColumns:[
        { column:'recovery_generation', parameter:'expected_recovery_generation' },
        { column:'recovery_state', parameter:'expected_recovery_state' },
      ] },
  }});
}

function map(row) {
  if (!row) return null;
  return Object.freeze({ offerId:row.offer_id, onDeckPackageId:row.on_deck_package_id, packageDigest:row.package_digest,
    acceptanceAttemptId:row.acceptance_attempt_id, activeWorkId:row.active_work_id, workKind:row.work_kind,
    failurePhase:row.failure_phase, errorCode:row.error_code, terminalAttemptCount:Number(row.terminal_attempt_count),
    ownerDomain:row.owner_domain, recoveryState:row.recovery_state, recoveryGeneration:Number(row.recovery_generation),
    automaticRecoveryUsed:Number(row.automatic_recovery_used) === 1, recoveryTriggerDigest:row.recovery_trigger_digest,
    failedTriggerDigest:row.failed_trigger_digest, incidentKey:row.incident_key,
    updatedAtMs:Number(row.updated_at_ms), resolvedAtMs:row.resolved_at_ms === null ? null : Number(row.resolved_at_ms) });
}

function createAcceptanceRecoveryStore(options) {
  const repository = definition(options.schemaManifest), now = options.now || Date.now;
  function read(offerId) {
    return map(options.unitOfWork.execute([{ participantId:'arca_acceptance_recovery_read', owner:'arca', repositories:[repository],
      execute:(context)=>context.repository(repository.repositoryId).invoke('find', { offer_id:offerId })
    }]).arca_acceptance_recovery_read);
  }
  function advance(current, values) {
    const result = options.unitOfWork.execute([{ participantId:'arca_acceptance_recovery_advance', owner:'arca', repositories:[repository], execute(context) {
      return context.repository(repository.repositoryId).invoke('advance', {
        offer_id:current.offerId, expected_recovery_generation:current.recoveryGeneration,
        expected_recovery_state:current.recoveryState, acceptance_attempt_id:values.acceptanceAttemptId,
        active_work_id:values.activeWorkId, work_kind:values.workKind, failure_phase:values.failurePhase,
        error_code:values.errorCode, terminal_attempt_count:values.terminalAttemptCount, owner_domain:'arca',
        recovery_state:values.recoveryState, recovery_generation:values.recoveryGeneration,
        automatic_recovery_used:values.automaticRecoveryUsed ? 1 : 0,
        recovery_trigger_digest:values.recoveryTriggerDigest, failed_trigger_digest:values.failedTriggerDigest,
        incident_key:values.incidentKey, updated_at_ms:now(), resolved_at_ms:values.resolvedAtMs,
      });
    }}]).arca_acceptance_recovery_advance;
    if (result.changes !== 1) throw Object.assign(new Error('Acceptance Recovery Case changed concurrently.'), { code:'ARCA_ACCEPTANCE_RECOVERY_CAS_CONFLICT' });
    return read(current.offerId);
  }
  return Object.freeze({
    read,
    admit(request) {
      const current = read(request.offerId);
      if (current) {
        if (current.onDeckPackageId !== request.onDeckPackageId || current.packageDigest !== request.packageDigest) {
          throw Object.assign(new Error('Acceptance Recovery Case conflicts with the Handoff B Offer.'), { code:'ARCA_ACCEPTANCE_RECOVERY_OFFER_CONFLICT' });
        }
        return current;
      }
      return map(options.unitOfWork.execute([{ participantId:'arca_acceptance_recovery_create', owner:'arca', repositories:[repository], execute(context) {
        context.repository(repository.repositoryId).invoke('insert', {
          offer_id:request.offerId, on_deck_package_id:request.onDeckPackageId, package_digest:request.packageDigest,
          acceptance_attempt_id:null, active_work_id:request.workId, work_kind:request.workKind,
          failure_phase:null, error_code:null, terminal_attempt_count:0, owner_domain:'arca', recovery_state:'active',
          recovery_generation:1, automatic_recovery_used:0, recovery_trigger_digest:request.recoveryTriggerDigest,
          failed_trigger_digest:null, incident_key:null, updated_at_ms:now(), resolved_at_ms:null,
        });
        return context.repository(repository.repositoryId).invoke('find', { offer_id:request.offerId });
      }}]).arca_acceptance_recovery_create);
    },
    recordFailure(offerId, request) {
      const current = read(offerId);
      if (!current) throw Object.assign(new Error('Acceptance Recovery Case is absent.'), { code:'ARCA_ACCEPTANCE_RECOVERY_NOT_FOUND' });
      if (current.activeWorkId !== request.workId) return current;
      if (current.recoveryState === 'attention_required' && current.errorCode === request.errorCode) return current;
      return advance(current, { ...current, failurePhase:request.failurePhase, errorCode:request.errorCode,
        terminalAttemptCount:request.terminalAttemptCount, recoveryState:'attention_required',
        failedTriggerDigest:current.recoveryTriggerDigest, incidentKey:request.incidentKey, resolvedAtMs:null });
    },
    startGeneration(offerId, request) {
      const current = read(offerId);
      if (!current || current.recoveryState !== 'attention_required') throw Object.assign(
        new Error('Acceptance Recovery Case is not waiting for recovery.'), { code:'ARCA_ACCEPTANCE_RETRY_NOT_ALLOWED' });
      if (current.recoveryGeneration >= MAX_GENERATION) throw Object.assign(
        new Error('Acceptance recovery generation limit was reached.'), { code:'ARCA_ACCEPTANCE_RECOVERY_LIMIT' });
      if (request.mode === 'automatic' && (current.automaticRecoveryUsed || current.failedTriggerDigest === request.recoveryTriggerDigest)) return current;
      return advance(current, { ...current, activeWorkId:request.workId, failurePhase:null, errorCode:null,
        terminalAttemptCount:0, recoveryState:request.mode === 'automatic' ? 'automatic_recovering' : 'user_retrying',
        recoveryGeneration:current.recoveryGeneration + 1,
        automaticRecoveryUsed:current.automaticRecoveryUsed || request.mode === 'automatic',
        recoveryTriggerDigest:request.recoveryTriggerDigest, incidentKey:current.incidentKey, resolvedAtMs:null });
    },
    resolve(offerId, acceptanceAttemptId, evidenceDigest) {
      const current = read(offerId);
      if (!current || current.recoveryState === 'resolved') return current;
      return advance(current, { ...current, acceptanceAttemptId, failurePhase:null, errorCode:null,
        recoveryState:'resolved', recoveryTriggerDigest:evidenceDigest, resolvedAtMs:now() });
    },
    listAttention(limit = 100, cursor = null) {
      return options.unitOfWork.execute([{ participantId:'arca_acceptance_recovery_attention', owner:'arca', repositories:[repository], execute(context) {
        return context.repository(repository.repositoryId).invoke('list', {}).filter((row)=>row.recovery_state === 'attention_required')
          .sort((a,b)=>a.offer_id.localeCompare(b.offer_id)).filter((row)=>cursor === null || row.offer_id > cursor).slice(0,limit).map(map);
      }}]).arca_acceptance_recovery_attention;
    },
    admissionParticipant(value) {
      return Object.freeze({ participantId:'arca_acceptance_offer_admission_receipt', owner:'arca', repositories:[repository], execute(context) {
        const row = context.repository(repository.repositoryId).invoke('find', { offer_id:value.offerId });
        if (!row || row.active_work_id !== value.workId || row.package_digest !== value.packageDigest) {
          throw Object.assign(new Error('Arca offer admission receipt lost its Recovery Case.'), { code:'ARCA_ACCEPTANCE_ADMISSION_FENCE' });
        }
        return Object.freeze({ offerId:value.offerId, workId:value.workId, generation:Number(row.recovery_generation) });
      }});
    },
  });
}

module.exports = Object.freeze({ MAX_GENERATION, createAcceptanceRecoveryStore });
