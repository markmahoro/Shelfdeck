'use strict';

const { createRepositoryDefinition } = require('../persistence/owner-repository');
const { digest } = require('../persistence/ddl-compiler');
const { assertEffectClass, assertTransition } = require('../execution/runtime-contracts');

const HASH = /^[0-9a-f]{64}$/;
const NON_PURE = new Set([
  'workspace_write', 'external_request', 'domain_fact_commit', 'responsibility_control_commit', 'material_commit', 'destructive_commit'
]);

class EffectJournalError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'EffectJournalError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new EffectJournalError(code, message, details);
}

function text(value, field) {
  if (typeof value !== 'string' || !value || value.length > 256) fail('P4_EFFECT_TEXT_INVALID', 'Effect identity text is invalid.', { field });
  return value;
}

function hash(value, field) {
  if (!HASH.test(value || '')) fail('P4_EFFECT_DIGEST_INVALID', 'Effect digest must be SHA-256 hex.', { field });
  return value;
}

function effectIdentity(effectClass, idempotencyKey) {
  assertEffectClass(effectClass);
  text(idempotencyKey, 'idempotencyKey');
  return digest(JSON.stringify([effectClass, idempotencyKey]));
}

function definitions(schemaManifest) {
  return Object.freeze({
    attempts: createRepositoryDefinition({ repositoryId: 'effect_event_attempts', owner: 'execution-foundation', schemaManifest, statements: {
      find: { kind: 'select-one', tableId: 'fx_event_attempts', columns: ['event_attempt_id', 'event_id', 'state'], keyColumns: ['event_attempt_id'] }
    } }),
    effects: createRepositoryDefinition({ repositoryId: 'effect_journal', owner: 'execution-foundation', schemaManifest, statements: {
      find: { kind: 'select-one', tableId: 'fx_effect_journal', columns: [
        'effect_id', 'event_attempt_id', 'effect_class', 'idempotency_key', 'intent_digest', 'state', 'external_receipt_ref',
        'output_digest', 'verified_at_ms', 'updated_at_ms'
      ], keyColumns: ['effect_id'] },
      list: { kind: 'select-all', tableId: 'fx_effect_journal', columns: [
        'effect_id', 'event_attempt_id', 'effect_class', 'idempotency_key', 'intent_digest', 'state', 'external_receipt_ref',
        'output_digest', 'verified_at_ms', 'updated_at_ms'
      ], keyColumns: [] },
      insert: { kind: 'insert', tableId: 'fx_effect_journal', columns: [
        'effect_id', 'event_attempt_id', 'effect_class', 'idempotency_key', 'intent_digest', 'state', 'external_receipt_ref',
        'output_digest', 'verified_at_ms', 'updated_at_ms'
      ] },
      transition: { kind: 'update', tableId: 'fx_effect_journal', setColumns: [
        'state', 'external_receipt_ref', 'output_digest', 'verified_at_ms', 'updated_at_ms'
      ], keyColumns: ['effect_id'], compareColumns: [{ column: 'state', parameter: 'expected_state' }] }
    } }),
    markers: createRepositoryDefinition({ repositoryId: 'effect_commit_markers', owner: 'execution-foundation', schemaManifest, statements: {
      find: { kind: 'select-one', tableId: 'fx_commit_markers', columns: [
        'commit_marker', 'effect_id', 'owner_domain', 'scope_type', 'scope_id', 'commit_digest', 'committed_at_ms'
      ], keyColumns: ['commit_marker'] },
      insert: { kind: 'insert', tableId: 'fx_commit_markers', columns: [
        'commit_marker', 'effect_id', 'owner_domain', 'scope_type', 'scope_id', 'commit_digest', 'committed_at_ms'
      ] }
    } })
  });
}

function createEffectJournal(options) {
  if (!options || !options.schemaManifest || !options.unitOfWork || typeof options.unitOfWork.execute !== 'function' ||
      typeof options.now !== 'function' || !options.realityVerifiers || typeof options.realityVerifiers !== 'object') fail(
    'P4_EFFECT_JOURNAL_DEPENDENCIES_REQUIRED', 'Effect Journal requires clean persistence, a clock, and exact reality verifiers.'
  );
  const expectedVerifiers = [...NON_PURE].sort();
  if (JSON.stringify(Object.keys(options.realityVerifiers).sort()) !== JSON.stringify(expectedVerifiers) ||
      expectedVerifiers.some((effectClass) => !options.realityVerifiers[effectClass] ||
        typeof options.realityVerifiers[effectClass].verify !== 'function')) fail(
    'P4_EFFECT_VERIFIER_SET_MISMATCH', 'Effect Journal requires exactly one verifier for each non-pure Effect Class.'
  );
  const repositories = definitions(options.schemaManifest);

  function now() {
    const value = options.now();
    if (!Number.isSafeInteger(value) || value < 0) fail('P4_EFFECT_CLOCK_INVALID', 'Effect Journal clock is invalid.');
    return value;
  }

  function read(effectId) {
    return options.unitOfWork.execute([{ participantId: 'effect_journal_read', owner: 'execution-foundation',
      repositories: [repositories.effects], execute(context) {
        return context.repository('effect_journal').invoke('find', { effect_id: effectId });
      } }]).effect_journal_read;
  }

  function transition(effect, state, values = {}) {
    assertTransition('effect_journal', effect.state, state);
    const result = options.unitOfWork.execute([{ participantId: 'effect_journal_transition', owner: 'execution-foundation',
      repositories: [repositories.effects], execute(context) {
        return context.repository('effect_journal').invoke('transition', {
          effect_id: effect.effect_id, expected_state: effect.state, state,
          external_receipt_ref: values.externalReceiptRef === undefined ? effect.external_receipt_ref : values.externalReceiptRef,
          output_digest: values.outputDigest === undefined ? effect.output_digest : values.outputDigest,
          verified_at_ms: values.verifiedAtMs === undefined ? effect.verified_at_ms : values.verifiedAtMs,
          updated_at_ms: context.commitTimeMs
        });
      } }]).effect_journal_transition;
    if (result.changes !== 1) fail('P4_EFFECT_TRANSITION_RACE', 'Effect Journal state changed concurrently.', { effectId: effect.effect_id });
    return read(effect.effect_id);
  }

  function intend(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) fail('P4_EFFECT_INTENT_INVALID', 'Effect intent is required.');
    const effectClass = assertEffectClass(request.effectClass);
    if (!NON_PURE.has(effectClass)) fail('P4_EFFECT_PURE_JOURNAL_FORBIDDEN', 'Pure observations must not create Effect Journal rows.');
    const eventAttemptId = text(request.eventAttemptId, 'eventAttemptId');
    const idempotencyKey = text(request.idempotencyKey, 'idempotencyKey');
    const effectId = effectIdentity(effectClass, idempotencyKey);
    const intentDigest = hash(request.intentDigest, 'intentDigest');
    const existing = options.unitOfWork.execute([{ participantId: 'effect_journal_intend', owner: 'execution-foundation',
      repositories: [repositories.effects, repositories.attempts], execute(context) {
        if (!context.repository('effect_event_attempts').invoke('find', { event_attempt_id: eventAttemptId })) fail(
          'P4_EFFECT_EVENT_ATTEMPT_NOT_FOUND', 'Effect intent must bind an existing durable Event Attempt.'
        );
        const all = context.repository('effect_journal').invoke('list');
        const found = all.find((effect) => effect.effect_class === effectClass && effect.idempotency_key === idempotencyKey);
        if (found) return found;
        context.repository('effect_journal').invoke('insert', {
          effect_id: effectId, event_attempt_id: eventAttemptId, effect_class: effectClass, idempotency_key: idempotencyKey,
          intent_digest: intentDigest, state: 'intended', external_receipt_ref: null, output_digest: null,
          verified_at_ms: null, updated_at_ms: context.commitTimeMs
        });
        return context.repository('effect_journal').invoke('find', { effect_id: effectId });
      } }]).effect_journal_intend;
    if (existing.effect_id !== effectId || existing.effect_class !== effectClass ||
        existing.idempotency_key !== idempotencyKey || existing.intent_digest !== intentDigest) fail(
      'P4_EFFECT_IDEMPOTENCY_CONFLICT', 'Effect idempotency key is already bound to a different immutable intent.'
    );
    return Object.freeze(existing);
  }

  function recordObserved(effect, receipt) {
    if (!receipt || receipt.effectId !== effect.effect_id || receipt.effectClass !== effect.effect_class ||
        receipt.idempotencyKey !== effect.idempotency_key) fail(
      'P4_EFFECT_RECEIPT_BINDING_MISMATCH', 'Effect Receipt does not bind the durable intent exactly.'
    );
    hash(receipt.outputDigest, 'outputDigest');
    hash(receipt.verificationEvidenceDigest, 'verificationEvidenceDigest');
    text(receipt.commitMarker, 'commitMarker');
    if (!Number.isSafeInteger(receipt.committedAtMs) || receipt.committedAtMs < 0) fail(
      'P4_EFFECT_RECEIPT_TIME_INVALID', 'Effect Receipt committed time is invalid.'
    );
    if (receipt.externalReceiptRef !== null && receipt.externalReceiptRef !== undefined) text(receipt.externalReceiptRef, 'externalReceiptRef');
    if (effect.state === 'effect_observed' || effect.state === 'committed') {
      if (effect.output_digest !== receipt.outputDigest || effect.external_receipt_ref !== (receipt.externalReceiptRef || null)) fail(
        'P4_EFFECT_OBSERVATION_CONFLICT', 'Effect observation cannot be rewritten.'
      );
      return effect;
    }
    if (!['intended', 'reconcile_required'].includes(effect.state)) fail('P4_EFFECT_OBSERVATION_STATE_INVALID', 'Effect cannot accept observation in its current state.');
    return transition(effect, 'effect_observed', {
      externalReceiptRef: receipt.externalReceiptRef || null, outputDigest: receipt.outputDigest, verifiedAtMs: null
    });
  }

  function commitVerified(effect, receipt, scope) {
    return options.unitOfWork.execute([{ participantId: 'effect_journal_commit', owner: 'execution-foundation',
      repositories: [repositories.effects, repositories.markers], execute(context) {
        const current = context.repository('effect_journal').invoke('find', { effect_id: effect.effect_id });
        if (!current || current.state !== 'effect_observed') fail('P4_EFFECT_COMMIT_STATE_INVALID', 'Only an observed effect can commit.');
        const expectedMarker = {
          commit_marker: receipt.commitMarker, effect_id: effect.effect_id, owner_domain: text(scope.ownerDomain, 'ownerDomain'),
          scope_type: text(scope.scopeType, 'scopeType'), scope_id: text(scope.scopeId, 'scopeId'),
          commit_digest: receipt.verificationEvidenceDigest, committed_at_ms: receipt.committedAtMs
        };
        const marker = context.repository('effect_commit_markers').invoke('find', { commit_marker: receipt.commitMarker });
        if (marker) {
          for (const [key, value] of Object.entries(expectedMarker)) if (marker[key] !== value) fail(
            'P4_EFFECT_COMMIT_MARKER_CONFLICT', 'Commit marker is already bound to another effect or reality digest.', { key }
          );
        } else context.repository('effect_commit_markers').invoke('insert', expectedMarker);
        const updated = context.repository('effect_journal').invoke('transition', {
          effect_id: effect.effect_id, expected_state: 'effect_observed', state: 'committed',
          external_receipt_ref: current.external_receipt_ref, output_digest: current.output_digest,
          verified_at_ms: context.commitTimeMs, updated_at_ms: context.commitTimeMs
        });
        if (updated.changes !== 1) fail('P4_EFFECT_TRANSITION_RACE', 'Effect Journal state changed before commit.');
        return context.repository('effect_journal').invoke('find', { effect_id: effect.effect_id });
      } }]).effect_journal_commit;
  }

  async function settle(request) {
    const effect = read(text(request && request.effectId, 'effectId'));
    if (!effect) fail('P4_EFFECT_NOT_FOUND', 'Effect intent does not exist.');
    const observed = recordObserved(effect, request.receipt);
    if (observed.state === 'committed') {
      const marker = options.unitOfWork.execute([{ participantId: 'effect_journal_replay', owner: 'execution-foundation',
        repositories: [repositories.markers], execute(context) {
          return context.repository('effect_commit_markers').invoke('find', { commit_marker: request.receipt.commitMarker });
        } }]).effect_journal_replay;
      const expected = {
        effect_id: observed.effect_id, owner_domain: text(request.scope.ownerDomain, 'ownerDomain'),
        scope_type: text(request.scope.scopeType, 'scopeType'), scope_id: text(request.scope.scopeId, 'scopeId'),
        commit_digest: request.receipt.verificationEvidenceDigest, committed_at_ms: request.receipt.committedAtMs
      };
      if (!marker || Object.entries(expected).some(([key, value]) => marker[key] !== value)) fail(
        'P4_EFFECT_COMMITTED_REPLAY_CONFLICT', 'Committed Effect replay does not match its immutable marker.'
      );
      return Object.freeze(observed);
    }
    let verification;
    try {
      verification = await options.realityVerifiers[effect.effect_class].verify(Object.freeze({ effect: observed, receipt: request.receipt }));
    } catch (error) {
      transition(read(effect.effect_id), 'reconcile_required');
      throw error;
    }
    if (!verification || verification.verified !== true ||
        verification.evidenceDigest !== request.receipt.verificationEvidenceDigest) {
      transition(read(effect.effect_id), 'reconcile_required');
      fail('P4_EFFECT_REALITY_NOT_VERIFIED', 'Effect reality does not prove the returned receipt.');
    }
    return Object.freeze(commitVerified(read(effect.effect_id), request.receipt, request.scope));
  }

  function requireReconcile(effectId) {
    const effect = read(text(effectId, 'effectId'));
    if (!effect) fail('P4_EFFECT_NOT_FOUND', 'Effect intent does not exist.');
    if (effect.state === 'reconcile_required') return Object.freeze(effect);
    if (!['intended', 'effect_observed'].includes(effect.state)) fail(
      'P4_EFFECT_RECONCILE_STATE_INVALID', 'Only an uncertain nonterminal effect can require reconciliation.'
    );
    return Object.freeze(transition(effect, 'reconcile_required'));
  }

  function noteExternalPending(effectId, receipt) {
    const effect = read(text(effectId, 'effectId'));
    if (!effect) fail('P4_EFFECT_NOT_FOUND', 'Effect intent does not exist.');
    if (effect.effect_class !== 'external_request' || !receipt || receipt.idempotencyKey !== effect.idempotency_key) fail(
      'P4_EFFECT_EXTERNAL_RECEIPT_BINDING_MISMATCH', 'External Job Receipt must bind the exact external_request intent.'
    );
    const receiptRef = text(receipt.receiptId, 'receiptId');
    hash(receipt.requestDigest, 'requestDigest');
    if (!['intended', 'reconcile_required'].includes(effect.state)) fail(
      'P4_EFFECT_EXTERNAL_RECEIPT_STATE_INVALID', 'External Job Receipt cannot change a terminal or committed Effect.'
    );
    if (effect.external_receipt_ref !== null && effect.external_receipt_ref !== receiptRef) fail(
      'P4_EFFECT_EXTERNAL_RECEIPT_CONFLICT', 'External request identity cannot be replaced during observation.'
    );
    const result = options.unitOfWork.execute([{ participantId: 'effect_journal_external_pending', owner: 'execution-foundation',
      repositories: [repositories.effects], execute(context) {
        return context.repository('effect_journal').invoke('transition', {
          effect_id: effect.effect_id, expected_state: effect.state, state: effect.state,
          external_receipt_ref: receiptRef, output_digest: effect.output_digest,
          verified_at_ms: effect.verified_at_ms, updated_at_ms: context.commitTimeMs
        });
      } }]).effect_journal_external_pending;
    if (result.changes !== 1) fail('P4_EFFECT_TRANSITION_RACE', 'Effect Journal changed before external receipt persistence.');
    return Object.freeze(read(effect.effect_id));
  }

  async function reconcile(effectId, registry) {
    const effect = read(text(effectId, 'effectId'));
    if (!effect) fail('P4_EFFECT_NOT_FOUND', 'Effect intent does not exist.');
    if (effect.state === 'committed' || effect.state === 'failed') fail('P4_EFFECT_TERMINAL_RECONCILE_FORBIDDEN', 'Terminal effects are not reconciled again.');
    const result = await registry.reconcile(effect.effect_class, { effect: Object.freeze(effect) });
    let state = effect.state;
    if (result.decision === 'already_committed' || result.decision === 'safe_retry') state = 'reconcile_required';
    else if (result.decision === 'terminal_failure') state = 'failed';
    else if (result.decision === 'continue_forward' || result.decision === 'compensate') state = 'reconcile_required';
    else fail('P4_EFFECT_RECOVERY_DECISION_INVALID', 'Reconciler returned an unsupported recovery decision.');
    let current = effect;
    if (current.state !== state) current = transition(current, state, { verifiedAtMs: now() });
    return Object.freeze({ effect: Object.freeze(current), recovery: result });
  }

  return Object.freeze({ intend, noteExternalPending, read, reconcile, requireReconcile, settle });
}

module.exports = Object.freeze({ EffectJournalError, createEffectJournal, effectIdentity });
