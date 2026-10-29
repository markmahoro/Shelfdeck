'use strict';

const { canonicalDigest } = require('../../contracts/canonical-json');
const HASH = /^[a-f0-9]{64}$/;
function requireProof(value, message) { if (!value) throw new Error(message); }

// Owner observations are current responsibility proofs, even when the original
// execution graph has an immutable terminal attestation. No executor is used.
function verifyTerminalEffectReceipt({ facts, effect, receipt, proveSource }) {
  const { work, events, results } = facts;
  const attempt = facts.attempts.find(value => value.event_attempt_id === effect.event_attempt_id);
  const event = attempt && events.find(value => value.event_id === attempt.event_id);
  requireProof(event && receipt && ['succeeded', 'failed', 'cancelled'].includes(facts.workAttempt.state),
    'Terminal Effect proof lacks its owning terminal graph.');
  if (receipt.schemaRef === 'arca.terminal-stage-history-proof@1') {
    const keys = ['schemaRef','ownerDomain','disposition','effectId','eventId','inputDigest','slotEventId','slotResultId','slotResultDigest','observationDigest'];
    requireProof(work.owner_domain === 'arca' && receipt.ownerDomain === work.owner_domain &&
      receipt.disposition === 'no_remaining_material_effect' && effect.effect_class === 'material_commit' &&
      Object.keys(receipt).length === keys.length && keys.every(name=>Object.hasOwn(receipt,name)) &&
      receipt.effectId === effect.effect_id && receipt.eventId === event.event_id &&
      HASH.test(receipt.inputDigest) && HASH.test(receipt.observationDigest) && HASH.test(attempt.fence_snapshot_digest) && receipt.inputDigest === attempt.input_snapshot_digest &&
      effect.intent_digest === canonicalDigest({eventId:event.event_id,capabilityRef:event.capability_ref,contractVersion:event.contract_version,
        inputSnapshotDigest:receipt.inputDigest,fenceSnapshotDigest:attempt.fence_snapshot_digest}) &&
      events.some(source=>source.event_id===receipt.slotEventId && source.state==='succeeded') &&
      results.some(source=>source.event_id===receipt.slotEventId && source.result_id===receipt.slotResultId && source.result_digest===receipt.slotResultDigest),
    'Unproven empty stage responsibility.');
    return true;
  }
  const receiptKeys = ['schemaRef', 'ownerDomain', 'disposition', 'historicalAuthorization', 'effectId', 'eventId', 'inputDigest',
    'sourcePlanId', 'sourceEventId', 'sourceInputDigest', 'sourceResultId', 'sourceResultDigest', 'sourceCommitResultId', 'sourceCommitResultDigest'];
  requireProof(Object.keys(receipt).length === receiptKeys.length && receiptKeys.every(name => Object.hasOwn(receipt, name)),
    'Unknown Effect history proof field.');
  requireProof(work.owner_domain === 'arca' && receipt.schemaRef === 'arca.terminal-effect-history-proof@1' &&
    receipt.ownerDomain === work.owner_domain && receipt.disposition === 'fulfilled_by_successor' &&
    receipt.historicalAuthorization === 'unproven_system_policy' && receipt.eventId === event.event_id &&
    receipt.effectId === effect.effect_id && HASH.test(receipt.inputDigest) &&
    receipt.inputDigest === attempt.input_snapshot_digest && HASH.test(attempt.fence_snapshot_digest) &&
    effect.intent_digest === canonicalDigest({ eventId:event.event_id, capabilityRef:event.capability_ref,
      contractVersion:event.contract_version, inputSnapshotDigest:receipt.inputDigest, fenceSnapshotDigest:attempt.fence_snapshot_digest }),
  'Unproven original Effect input or intent.');
  const source = proveSource(receipt.sourcePlanId);
  const sourceEvent = source.events.find(item => item.event_id === receipt.sourceEventId);
  const sourceAttempts = source.attempts.filter(item => item.event_id === receipt.sourceEventId && item.outcome_kind === 'succeeded');
  const sourceEffect = sourceAttempts.length === 1 && source.effects.find(item => item.event_attempt_id === sourceAttempts[0].event_attempt_id);
  requireProof(source.work.owner_domain === work.owner_domain && source.work.process_type === work.process_type &&
    source.work.process_id === work.process_id && source.work.work_id !== work.work_id &&
    source.work.state === 'succeeded' && source.workAttempt.state === 'succeeded' && sourceEvent?.state === 'succeeded' &&
    sourceEvent.capability_ref === event.capability_ref && sourceEffect?.state === 'committed' &&
    Number.isSafeInteger(attempt.started_at_ms) && Number.isSafeInteger(sourceAttempts[0].started_at_ms) &&
    sourceAttempts[0].started_at_ms > attempt.started_at_ms &&
    sourceAttempts[0].input_snapshot_digest === receipt.sourceInputDigest && HASH.test(receipt.sourceInputDigest) &&
    sourceEffect.intent_digest === canonicalDigest({ eventId:sourceEvent.event_id, capabilityRef:sourceEvent.capability_ref,
      contractVersion:sourceEvent.contract_version, inputSnapshotDigest:receipt.sourceInputDigest,
      fenceSnapshotDigest:sourceAttempts[0].fence_snapshot_digest }) &&
    source.results.some(item => item.event_id === sourceEvent.event_id && item.result_id === receipt.sourceResultId && item.result_digest === receipt.sourceResultDigest) &&
    source.results.some(item => item.result_id === receipt.sourceCommitResultId && item.result_digest === receipt.sourceCommitResultDigest),
  'Unproven successor Effect commit chain.');
  return true;
}

module.exports = Object.freeze({ verifyTerminalEffectReceipt });
