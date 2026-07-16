'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createEffectReconcilerRegistry } = require('../../src/helix/foundation/effects/effect-reconcilers');

const DIGEST = 'a'.repeat(64);

function registry(overrides = {}) {
  const evidence = (status, extra = {}) => ({ status, ...extra, evidenceDigest: DIGEST });
  const observations = {
    workspace_write: evidence('matching', { cleanupDeclared: false }),
    external_request: evidence('pending'),
    domain_fact_commit: evidence('committed', { revisionMatches: true, fenceValid: true }),
    responsibility_control_commit: evidence('whole_established', { fenceValid: true }),
    material_commit: evidence('forward_required', { rollbackDeclared: false }),
    destructive_commit: evidence('remaining'),
    ...overrides
  };
  return createEffectReconcilerRegistry({ observers: Object.fromEntries(Object.entries(observations).map(([effectClass, value]) => [
    effectClass, { observe: async () => value }
  ])) });
}

test('registry contains all seven exact Effect Classes and pure recovery only safely redoes observation', async () => {
  const value = registry();
  assert.deepEqual(value.effectClasses, [
    'pure_observation', 'workspace_write', 'external_request', 'domain_fact_commit',
    'responsibility_control_commit', 'material_commit', 'destructive_commit'
  ]);
  assert.deepEqual(await value.reconcile('pure_observation', { evidenceDigest: DIGEST }), {
    decision: 'safe_retry', action: 'redo_observation', evidenceDigest: DIGEST
  });
  await assert.rejects(value.reconcile('unknown_effect', {}), { code: 'P4_RUNTIME_UNKNOWN_EFFECT_CLASS' });
});

test('workspace recovery reuses matching output, rebuilds absence, and blocks undeclared cleanup', async () => {
  assert.equal((await registry().reconcile('workspace_write', { effect: { state: 'intended' } })).action, 'reuse_existing');
  assert.equal((await registry({ workspace_write: { status: 'absent', cleanupDeclared: false, evidenceDigest: DIGEST } })
    .reconcile('workspace_write', {})).decision, 'safe_retry');
  assert.equal((await registry({ workspace_write: { status: 'conflict', cleanupDeclared: false, evidenceDigest: DIGEST } })
    .reconcile('workspace_write', {})).decision, 'terminal_failure');
});

test('external request is observed by identity and is resubmitted only after proven absence', async () => {
  assert.equal((await registry().reconcile('external_request', {})).action, 'observe_existing_request');
  const absent = await registry({ external_request: { status: 'absent', evidenceDigest: DIGEST } }).reconcile('external_request', {});
  assert.deepEqual(absent, { decision: 'safe_retry', action: 'submit_once_after_proven_absent', evidenceDigest: DIGEST });
  assert.equal((await registry({ external_request: { status: 'unknown', evidenceDigest: DIGEST } })
    .reconcile('external_request', {})).decision, 'terminal_failure');
});

test('fact and responsibility recovery fails closed on revision, Fence, or partial transfer drift', async () => {
  assert.equal((await registry().reconcile('domain_fact_commit', {})).decision, 'already_committed');
  assert.equal((await registry({ domain_fact_commit: {
    status: 'absent', revisionMatches: false, fenceValid: true, evidenceDigest: DIGEST
  } }).reconcile('domain_fact_commit', {})).decision, 'safe_retry');
  assert.equal((await registry({ domain_fact_commit: {
    status: 'committed', revisionMatches: false, fenceValid: true, evidenceDigest: DIGEST
  } }).reconcile('domain_fact_commit', {})).decision, 'terminal_failure');
  assert.equal((await registry({ responsibility_control_commit: {
    status: 'partial', fenceValid: true, evidenceDigest: DIGEST
  } }).reconcile('responsibility_control_commit', {})).action, 'block_partial_responsibility_state');
});

test('material recovery permits only declared rollback and destruction is always forward-only', async () => {
  assert.equal((await registry().reconcile('material_commit', {})).decision, 'continue_forward');
  assert.equal((await registry({ material_commit: {
    status: 'rollback_required', rollbackDeclared: true, evidenceDigest: DIGEST
  } }).reconcile('material_commit', {})).decision, 'compensate');
  assert.equal((await registry({ material_commit: {
    status: 'rollback_required', rollbackDeclared: false, evidenceDigest: DIGEST
  } }).reconcile('material_commit', {})).decision, 'terminal_failure');
  const remaining = await registry().reconcile('destructive_commit', {});
  assert.deepEqual(remaining, { decision: 'continue_forward', action: 'delete_remaining_authorized_scope', evidenceDigest: DIGEST });
  assert.equal((await registry({ destructive_commit: { status: 'absent', evidenceDigest: DIGEST } })
    .reconcile('destructive_commit', {})).decision, 'terminal_failure');
});

test('missing, extra, or malformed observer evidence fails closed', async () => {
  assert.throws(() => createEffectReconcilerRegistry({ observers: {} }), { code: 'P4_EFFECT_RECONCILER_SET_MISMATCH' });
  await assert.rejects(registry({ external_request: { status: 'pending', evidenceDigest: 'bad' } })
    .reconcile('external_request', {}), { code: 'P4_EFFECT_RECOVERY_EVIDENCE_DIGEST_REQUIRED' });
  await assert.rejects(registry({ external_request: { status: 'pending', evidenceDigest: DIGEST, retry: true } })
    .reconcile('external_request', {}), { code: 'P4_EXTERNAL_RECOVERY_EVIDENCE_INVALID' });
});
