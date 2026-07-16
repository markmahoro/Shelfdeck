'use strict';

const { createRepositoryDefinition } = require('../persistence/owner-repository');
const { assertTransition } = require('../execution/runtime-contracts');

const HASH = /^[0-9a-f]{64}$/;
const COMMIT_EFFECTS = new Set(['domain_fact_commit', 'responsibility_control_commit', 'material_commit', 'destructive_commit']);

class PressureGuardError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'PressureGuardError'; this.code = code; this.details = details; }
}
function fail(code, message, details) { throw new PressureGuardError(code, message, details); }
function hash(value) { if (!HASH.test(value || '')) fail('P4_CIRCUIT_EVIDENCE_INVALID', 'Circuit transition requires SHA-256 evidence.'); return value; }
function text(value, field) { if (typeof value !== 'string' || !value) fail('P4_CIRCUIT_TEXT_INVALID', 'Circuit text is required.', { field }); return value; }

function definitions(schemaManifest) {
  return createRepositoryDefinition({ repositoryId: 'circuit_states', owner: 'execution-foundation', schemaManifest, statements: {
    find: { kind: 'select-one', tableId: 'fx_circuit_states', columns: [
      'circuit_key', 'state', 'reason_code', 'evidence_digest', 'opened_at_ms', 'reviewed_at_ms'
    ], keyColumns: ['circuit_key'] },
    insert: { kind: 'insert', tableId: 'fx_circuit_states', columns: [
      'circuit_key', 'state', 'reason_code', 'evidence_digest', 'opened_at_ms', 'reviewed_at_ms'
    ] },
    update: { kind: 'update', tableId: 'fx_circuit_states', setColumns: [
      'state', 'reason_code', 'evidence_digest', 'opened_at_ms', 'reviewed_at_ms'
    ], keyColumns: ['circuit_key'], compareColumns: [{ column: 'state', parameter: 'expected_state' }] }
  } });
}

function createCircuitBreaker(options) {
  if (!options || !options.schemaManifest || !options.unitOfWork) fail('P4_CIRCUIT_DEPENDENCIES_REQUIRED', 'Circuit Breaker requires clean persistence.');
  const repository = definitions(options.schemaManifest);
  function read(circuitKey) {
    return options.unitOfWork.execute([{ participantId: 'circuit_read', owner: 'execution-foundation', repositories: [repository], execute(context) {
      return context.repository('circuit_states').invoke('find', { circuit_key: circuitKey });
    } }]).circuit_read;
  }
  function update(current, next, reasonCode, evidenceDigest, reviewed) {
    assertTransition('circuit', current.state, next);
    const result = options.unitOfWork.execute([{ participantId: 'circuit_transition', owner: 'execution-foundation', repositories: [repository], execute(context) {
      return context.repository('circuit_states').invoke('update', { circuit_key: current.circuit_key, expected_state: current.state,
        state: next, reason_code: reasonCode, evidence_digest: evidenceDigest, opened_at_ms: current.opened_at_ms,
        reviewed_at_ms: reviewed ? context.commitTimeMs : current.reviewed_at_ms });
    } }]).circuit_transition;
    if (result.changes !== 1) fail('P4_CIRCUIT_TRANSITION_RACE', 'Circuit changed concurrently.');
    return read(current.circuit_key);
  }
  return Object.freeze({
    read,
    open(request) {
      const circuitKey = text(request && request.circuitKey, 'circuitKey'); const reason = text(request.reasonCode, 'reasonCode');
      const evidence = hash(request.evidenceDigest);
      const existing = read(circuitKey);
      if (existing && existing.state === 'open' && existing.reason_code === reason && existing.evidence_digest === evidence) return Object.freeze(existing);
      if (existing && existing.state === 'open') fail('P4_CIRCUIT_OPEN_EVIDENCE_CONFLICT', 'Open Circuit evidence cannot be silently replaced.');
      if (existing && existing.state === 'recovering') return Object.freeze(update(existing, 'open', reason, evidence, true));
      if (existing && existing.state === 'closed') return Object.freeze(update(existing, 'open', reason, evidence, false));
      return Object.freeze(options.unitOfWork.execute([{ participantId: 'circuit_open', owner: 'execution-foundation', repositories: [repository], execute(context) {
        context.repository('circuit_states').invoke('insert', { circuit_key: circuitKey, state: 'open', reason_code: reason,
          evidence_digest: evidence, opened_at_ms: context.commitTimeMs, reviewed_at_ms: null });
        return context.repository('circuit_states').invoke('find', { circuit_key: circuitKey });
      } }]).circuit_open);
    },
    beginRecovery(request) {
      const current = read(text(request && request.circuitKey, 'circuitKey'));
      if (!current || current.state !== 'open') fail('P4_CIRCUIT_RECOVERY_STATE_INVALID', 'Only open Circuit can enter recovering.');
      return Object.freeze(update(current, 'recovering', current.reason_code, hash(request.evidenceDigest), true));
    },
    close(request) {
      const current = read(text(request && request.circuitKey, 'circuitKey'));
      if (!current || current.state !== 'recovering' || request.invariantRestored !== true) fail(
        'P4_CIRCUIT_CLOSE_PROOF_REQUIRED', 'Circuit closes only from recovering with invariant restoration proof.'
      );
      return Object.freeze(update(current, 'closed', 'INVARIANT_RESTORED', hash(request.reconcileEvidenceDigest), true));
    },
    allows(request) {
      const current = read(text(request && request.circuitKey, 'circuitKey'));
      if (!current || current.state === 'closed') return Object.freeze({ allowed: true, reason: 'closed' });
      if (request.mode === 'diagnostic' || request.mode === 'reconcile') return Object.freeze({ allowed: true, reason: request.mode });
      if (request.mode === 'forward_recovery' && request.started === true && request.irreversibleBoundaryCrossed === true &&
          ['responsibility_control_commit', 'material_commit', 'destructive_commit'].includes(request.effectClass)) {
        return Object.freeze({ allowed: true, reason: 'irreversible_forward_recovery' });
      }
      if (request.mode === 'control_receipt_convergence' && request.started === true) return Object.freeze({ allowed: true, reason: request.mode });
      if (request.started !== true && (COMMIT_EFFECTS.has(request.effectClass) ||
          ['normal_foreground', 'background_observation'].includes(request.priorityClass))) {
        return Object.freeze({ allowed: false, reason: 'circuit_blocks_new_effect' });
      }
      return Object.freeze({ allowed: false, reason: 'circuit_fail_closed' });
    }
  });
}

function evaluatePressureSample(sample) {
  const fields = ['circuitKey','evidenceDigest','correctnessViolation','duplicateWaiter','duplicateExecutingAttempt','duplicateImmutableResult',
    'hardCapConsecutive10s','writeRatePerSecond','writeRateDurationMs','terminalRatePerSecond','creationRatePerSecond','capacityAvailable',
    'oldestWaiterAgeMs','backgroundEligible','backgroundNoProgressMs','walBytes','walGrowingConsecutive5m','permitConserved'];
  if (!sample || typeof sample !== 'object' || Array.isArray(sample) || !HASH.test(sample.evidenceDigest || '') ||
      JSON.stringify(Object.keys(sample).sort()) !== JSON.stringify([...fields].sort())) fail(
    'P4_PRESSURE_SAMPLE_INVALID', 'Pressure sample and evidence digest are required.'
  );
  for (const field of ['correctnessViolation','duplicateWaiter','duplicateExecutingAttempt','duplicateImmutableResult','capacityAvailable','backgroundEligible','permitConserved']) {
    if (typeof sample[field] !== 'boolean') fail('P4_PRESSURE_SAMPLE_INVALID', 'Pressure boolean field is invalid.', { field });
  }
  for (const field of fields.filter((field) => !['circuitKey','evidenceDigest','correctnessViolation','duplicateWaiter','duplicateExecutingAttempt',
    'duplicateImmutableResult','capacityAvailable','backgroundEligible','permitConserved'].includes(field))) {
    if (!Number.isFinite(sample[field]) || sample[field] < 0) fail('P4_PRESSURE_SAMPLE_INVALID', 'Pressure numeric field is invalid.', { field });
  }
  const triggers = [];
  const add = (reasonCode) => triggers.push(Object.freeze({ circuitKey: text(sample.circuitKey, 'circuitKey'), reasonCode,
    evidenceDigest: sample.evidenceDigest }));
  if (sample.correctnessViolation === true) add('CORRECTNESS_INVARIANT_VIOLATION');
  if (sample.duplicateWaiter === true || sample.duplicateExecutingAttempt === true || sample.duplicateImmutableResult === true) add('DUPLICATE_RUNTIME_AUTHORITY');
  if (sample.hardCapConsecutive10s >= 3) add('HARD_CAP_PERSISTED');
  if (sample.writeRatePerSecond > 100 && sample.writeRateDurationMs >= 60000 && sample.terminalRatePerSecond < sample.creationRatePerSecond * 0.1) add('WRITE_RATE_DIVERGENCE');
  if (sample.capacityAvailable === true && sample.oldestWaiterAgeMs >= 1800000) add('WAITER_STARVATION');
  if (sample.backgroundEligible === true && sample.capacityAvailable === true && sample.backgroundNoProgressMs >= 600000) add('BACKGROUND_STARVATION');
  if (sample.walBytes > 1073741824 && sample.walGrowingConsecutive5m >= 3) add('WAL_GROWTH');
  if (sample.permitConserved === false) add('PERMIT_ACCOUNTING_LEAK');
  return Object.freeze(triggers);
}

function createPressureGuard(options) {
  if (!options || !options.breaker || typeof options.breaker.open !== 'function') fail('P4_PRESSURE_GUARD_DEPENDENCIES_REQUIRED', 'Pressure Guard requires Circuit Breaker.');
  return Object.freeze({ inspect(sample) {
    const triggers = evaluatePressureSample(sample);
    if (triggers.length === 0) return Object.freeze([]);
    const reasonCode = triggers.length === 1 ? triggers[0].reasonCode : 'MULTIPLE_GUARD_VIOLATIONS';
    return Object.freeze([options.breaker.open({ circuitKey: triggers[0].circuitKey, reasonCode, evidenceDigest: triggers[0].evidenceDigest })]);
  } });
}

module.exports = Object.freeze({ PressureGuardError, createCircuitBreaker, createPressureGuard, evaluatePressureSample });
