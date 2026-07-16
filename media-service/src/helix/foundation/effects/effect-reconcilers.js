'use strict';

const { EFFECT_CLASSES, assertEffectClass } = require('../execution/runtime-contracts');

const HASH = /^[0-9a-f]{64}$/;
const OBSERVED_CLASSES = Object.freeze(EFFECT_CLASSES.filter((effectClass) => effectClass !== 'pure_observation'));

class EffectReconcilerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'EffectReconcilerError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new EffectReconcilerError(code, message, details);
}

function exactKeys(value, expected, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    fail(code, 'Effect recovery evidence has an invalid nominal shape.', { expected, actual: value && Object.keys(value) });
  }
  return value;
}

function decision(kind, action, evidenceDigest) {
  if (!HASH.test(evidenceDigest || '')) fail(
    'P4_EFFECT_RECOVERY_EVIDENCE_DIGEST_REQUIRED', 'A recovery decision requires durable reality evidence.'
  );
  return Object.freeze({ decision: kind, action, evidenceDigest });
}

function requireObserver(observers, effectClass) {
  const observer = observers[effectClass];
  if (!observer || typeof observer.observe !== 'function' || Object.keys(observer).some((key) => key !== 'observe')) fail(
    'P4_EFFECT_RECONCILER_UNAVAILABLE', 'Each non-pure Effect Class requires one exact reality observer.', { effectClass }
  );
  return observer;
}

function createEffectReconcilerRegistry(options) {
  const observers = options && options.observers;
  if (!observers || typeof observers !== 'object' || Array.isArray(observers) ||
      JSON.stringify(Object.keys(observers).sort()) !== JSON.stringify([...OBSERVED_CLASSES].sort())) fail(
    'P4_EFFECT_RECONCILER_SET_MISMATCH', 'The reconciler registry requires exactly the six non-pure reality observers.',
    { expected: OBSERVED_CLASSES, actual: observers && Object.keys(observers) }
  );
  for (const effectClass of OBSERVED_CLASSES) requireObserver(observers, effectClass);

  const reconcilers = Object.freeze({
    pure_observation: Object.freeze({
      async reconcile(context) {
        return decision('safe_retry', 'redo_observation', context.evidenceDigest);
      }
    }),
    workspace_write: Object.freeze({
      async reconcile(context) {
        const reality = exactKeys(await observers.workspace_write.observe(context),
          ['status', 'evidenceDigest', 'cleanupDeclared'], 'P4_WORKSPACE_RECOVERY_EVIDENCE_INVALID');
        if (reality.status === 'matching') return decision(
          context.effect && context.effect.state === 'committed' ? 'already_committed' : 'continue_forward',
          'reuse_existing', reality.evidenceDigest
        );
        if (reality.status === 'absent') return decision('safe_retry', 'rebuild_workspace_output', reality.evidenceDigest);
        if (reality.status === 'conflict' && reality.cleanupDeclared === true) return decision(
          'safe_retry', 'cleanup_then_rebuild', reality.evidenceDigest
        );
        return decision('terminal_failure', 'block_workspace_conflict', reality.evidenceDigest);
      }
    }),
    external_request: Object.freeze({
      async reconcile(context) {
        const reality = exactKeys(await observers.external_request.observe(context),
          ['status', 'evidenceDigest'], 'P4_EXTERNAL_RECOVERY_EVIDENCE_INVALID');
        if (reality.status === 'committed') return decision('already_committed', 'reuse_external_receipt', reality.evidenceDigest);
        if (reality.status === 'pending') return decision('continue_forward', 'observe_existing_request', reality.evidenceDigest);
        if (reality.status === 'absent') return decision('safe_retry', 'submit_once_after_proven_absent', reality.evidenceDigest);
        return decision('terminal_failure', 'block_unknown_external_request', reality.evidenceDigest);
      }
    }),
    domain_fact_commit: Object.freeze({
      async reconcile(context) {
        const reality = exactKeys(await observers.domain_fact_commit.observe(context),
          ['status', 'revisionMatches', 'fenceValid', 'evidenceDigest'], 'P4_DOMAIN_COMMIT_RECOVERY_EVIDENCE_INVALID');
        if (reality.status === 'committed' && reality.revisionMatches === true) return decision(
          'already_committed', 'reuse_commit_marker', reality.evidenceDigest
        );
        if (reality.status === 'absent' && reality.fenceValid === true) return decision(
          'safe_retry', 'revalidate_and_commit', reality.evidenceDigest
        );
        return decision('terminal_failure', 'block_revision_or_fence_drift', reality.evidenceDigest);
      }
    }),
    responsibility_control_commit: Object.freeze({
      async reconcile(context) {
        const reality = exactKeys(await observers.responsibility_control_commit.observe(context),
          ['status', 'fenceValid', 'evidenceDigest'], 'P4_RESPONSIBILITY_RECOVERY_EVIDENCE_INVALID');
        if (reality.status === 'whole_established') return decision(
          'already_committed', 'reuse_whole_responsibility_receipt', reality.evidenceDigest
        );
        if (reality.status === 'whole_absent' && reality.fenceValid === true) return decision(
          'safe_retry', 'commit_whole_responsibility_set', reality.evidenceDigest
        );
        return decision('terminal_failure', 'block_partial_responsibility_state', reality.evidenceDigest);
      }
    }),
    material_commit: Object.freeze({
      async reconcile(context) {
        const reality = exactKeys(await observers.material_commit.observe(context),
          ['status', 'rollbackDeclared', 'evidenceDigest'], 'P4_MATERIAL_RECOVERY_EVIDENCE_INVALID');
        if (reality.status === 'committed') return decision('already_committed', 'reuse_material_receipt', reality.evidenceDigest);
        if (reality.status === 'forward_required') return decision('continue_forward', 'finish_material_commit', reality.evidenceDigest);
        if (reality.status === 'rollback_required' && reality.rollbackDeclared === true) return decision(
          'compensate', 'run_declared_material_rollback', reality.evidenceDigest
        );
        return decision('terminal_failure', 'block_unknown_material_reality', reality.evidenceDigest);
      }
    }),
    destructive_commit: Object.freeze({
      async reconcile(context) {
        const reality = exactKeys(await observers.destructive_commit.observe(context),
          ['status', 'evidenceDigest'], 'P4_DESTRUCTIVE_RECOVERY_EVIDENCE_INVALID');
        if (reality.status === 'complete') return decision('already_committed', 'reuse_deletion_evidence', reality.evidenceDigest);
        if (reality.status === 'remaining') return decision('continue_forward', 'delete_remaining_authorized_scope', reality.evidenceDigest);
        return decision('terminal_failure', 'block_unproven_destruction_scope', reality.evidenceDigest);
      }
    })
  });

  return Object.freeze({
    effectClasses: EFFECT_CLASSES,
    async reconcile(effectClass, context) {
      assertEffectClass(effectClass);
      return reconcilers[effectClass].reconcile(Object.freeze({ ...(context || {}) }));
    }
  });
}

module.exports = Object.freeze({ EffectReconcilerError, createEffectReconcilerRegistry });
