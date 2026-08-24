'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { createEffectJournal, effectIdentity } = require('../../src/helix/foundation/effects/effect-journal');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));
const INTENT = 'a'.repeat(64); const OUTPUT = 'b'.repeat(64); const REALITY = 'c'.repeat(64);
const NON_PURE = [
  'workspace_write', 'external_request', 'domain_fact_commit', 'responsibility_control_commit', 'material_commit', 'destructive_commit'
];

function fixture(run, verify = async () => ({ verified: true, evidenceDigest: REALITY })) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-effect-journal-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 1700000002000 });
  kernel.runPrimitive((transaction) => {
    transaction.prepare("INSERT INTO fx_supporting_works(work_id,state) VALUES('work','running')").run();
    transaction.prepare("INSERT INTO fx_work_attempts(attempt_id,work_id,state) VALUES('work-attempt','work','running')").run();
    transaction.prepare("INSERT INTO fx_workflow_plans(plan_id,attempt_id,state) VALUES('plan','work-attempt','planned')").run();
    transaction.prepare("INSERT INTO fx_plan_nodes(plan_id,node_id,effect_class) VALUES('plan','node','external_request')").run();
    transaction.prepare("INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,state) VALUES('event','plan','node','work','work-attempt','executing')").run();
    transaction.prepare("INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,state) VALUES('event-attempt','event',1,'completed')").run();
    transaction.prepare("INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,state) VALUES('event-attempt-2','event',2,'executing')").run();
  });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const journal = createEffectJournal({ schemaManifest, unitOfWork, now: () => 1700000002001,
    realityVerifiers: Object.fromEntries(NON_PURE.map((effectClass) => [effectClass, { verify }])) });
  const cleanup = () => { kernel.close(); fs.rmSync(root, { recursive: true, force: true }); };
  try {
    const result = run({ journal, databasePath });
    if (result && typeof result.then === 'function') return result.finally(cleanup);
    cleanup(); return result;
  } catch (error) { cleanup(); throw error; }
}

function receipt(overrides = {}) {
  return {
    schemaRef: 'helix://contracts/types/EffectReceipt/v1', schemaVersion: 1, effectReceiptId: 'effect-receipt',
    effectId: effectIdentity('external_request', 'request-key'), effectClass: 'external_request', idempotencyKey: 'request-key', commitMarker: 'commit-marker',
    externalReceiptRef: 'external-job', outputDigest: OUTPUT, verificationEvidenceDigest: REALITY, committedAtMs: 1700000001999,
    ...overrides
  };
}

test('durable intent is idempotent only for the exact Event Attempt, class, key, and digest', () => fixture(({ journal }) => {
  const request = { eventAttemptId: 'event-attempt', effectClass: 'external_request', idempotencyKey: 'request-key', intentDigest: INTENT };
  assert.equal(journal.intend(request).state, 'intended');
  assert.equal(journal.intend(request).effect_id, effectIdentity('external_request', 'request-key'));
  assert.throws(() => journal.intend({ ...request, intentDigest: OUTPUT }), { code: 'P4_EFFECT_IDEMPOTENCY_CONFLICT' });
  assert.throws(() => journal.intend({ ...request, effectClass: 'pure_observation' }), { code: 'P4_EFFECT_PURE_JOURNAL_FORBIDDEN' });
}));

test('settle persists observation, verifies reality, and atomically commits marker plus journal', async () => fixture(async ({ journal, databasePath }) => {
  journal.intend({ eventAttemptId: 'event-attempt', effectClass: 'external_request', idempotencyKey: 'request-key', intentDigest: INTENT });
  const settled = await journal.settle({ effectId: effectIdentity('external_request', 'request-key'), receipt: receipt(),
    scope: { ownerDomain: 'libra', scopeType: 'libra_run', scopeId: 'run' } });
  assert.equal(settled.state, 'committed');
  assert.equal((await journal.settle({ effectId: effectIdentity('external_request', 'request-key'), receipt: receipt(),
    scope: { ownerDomain: 'libra', scopeType: 'libra_run', scopeId: 'run' } })).state, 'committed');
  const database = new Database(databasePath, { readonly: true });
  try {
    assert.deepEqual(database.prepare('SELECT state,external_receipt_ref,output_digest,verified_at_ms FROM fx_effect_journal').get(),
      { state: 'committed', external_receipt_ref: 'external-job', output_digest: OUTPUT, verified_at_ms: 1700000002000 });
    assert.deepEqual(database.prepare('SELECT effect_id,owner_domain,scope_type,scope_id,commit_digest FROM fx_commit_markers').get(),
      { effect_id: effectIdentity('external_request', 'request-key'), owner_domain: 'libra', scope_type: 'libra_run', scope_id: 'run', commit_digest: REALITY });
  } finally { database.close(); }
}));

test('settle adopts an exact marker pre-bound by the atomic business transaction', async () => fixture(async ({ journal,databasePath }) => {
  const idempotencyKey='inventory-key',effectId=effectIdentity('responsibility_control_commit',idempotencyKey),
    atomicReceipt=receipt({effectId,effectClass:'responsibility_control_commit',idempotencyKey,
      commitMarker:'atomic-inventory-marker',externalReceiptRef:null});
  journal.intend({eventAttemptId:'event-attempt',effectClass:'responsibility_control_commit',idempotencyKey,intentDigest:INTENT});
  const database=new Database(databasePath);
  try{database.prepare(`INSERT INTO fx_commit_markers
    (commit_marker,effect_id,owner_domain,scope_type,scope_id,commit_digest,result_id,result_schema_ref,result_digest,committed_at_ms)
    VALUES (?,?,?,?,?,?,NULL,NULL,NULL,?)`).run(atomicReceipt.commitMarker,effectId,'arca','shelf_entry','entry-1',
      atomicReceipt.verificationEvidenceDigest,atomicReceipt.committedAtMs);}finally{database.close();}
  const settled=await journal.settle({effectId,receipt:atomicReceipt,
    scope:{ownerDomain:'arca',scopeType:'shelf_entry',scopeId:'entry-1'}});
  assert.equal(settled.state,'committed');
  assert.deepEqual(journal.observeRecovery(effectId).markers.map((item)=>item.commit_marker),['atomic-inventory-marker']);
}));

test('unverified reality remains reconcile_required and cannot bind a fabricated commit marker', async () => fixture(async ({ journal, databasePath }) => {
  journal.intend({ eventAttemptId: 'event-attempt', effectClass: 'external_request', idempotencyKey: 'request-key', intentDigest: INTENT });
  await assert.rejects(journal.settle({ effectId: effectIdentity('external_request', 'request-key'), receipt: receipt(),
    scope: { ownerDomain: 'libra', scopeType: 'libra_run', scopeId: 'run' } }), { code: 'P4_EFFECT_REALITY_NOT_VERIFIED' });
  const database = new Database(databasePath, { readonly: true });
  try {
    assert.equal(database.prepare('SELECT state FROM fx_effect_journal').get().state, 'reconcile_required');
    assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_commit_markers').get().count, 0);
  } finally { database.close(); }
}, async () => ({ verified: false, evidenceDigest: REALITY })));

test('receipt identity drift and marker replay conflict fail closed', async () => fixture(async ({ journal }) => {
  journal.intend({ eventAttemptId: 'event-attempt', effectClass: 'external_request', idempotencyKey: 'request-key', intentDigest: INTENT });
  await assert.rejects(journal.settle({ effectId: effectIdentity('external_request', 'request-key'), receipt: receipt({ idempotencyKey: 'other' }),
    scope: { ownerDomain: 'libra', scopeType: 'libra_run', scopeId: 'run' } }), { code: 'P4_EFFECT_RECEIPT_BINDING_MISMATCH' });
  await journal.settle({ effectId: effectIdentity('external_request', 'request-key'), receipt: receipt(),
    scope: { ownerDomain: 'libra', scopeType: 'libra_run', scopeId: 'run' } });
  await assert.rejects(journal.settle({ effectId: effectIdentity('external_request', 'request-key'), receipt: receipt(),
    scope: { ownerDomain: 'libra', scopeType: 'other_scope', scopeId: 'run' } }), { code: 'P4_EFFECT_COMMITTED_REPLAY_CONFLICT' });
}));

test('recovery never fabricates committed state from observer decision without Effect Receipt commit', async () => fixture(async ({ journal }) => {
  journal.intend({ eventAttemptId: 'event-attempt', effectClass: 'external_request', idempotencyKey: 'request-key', intentDigest: INTENT });
  const result = await journal.reconcile(effectIdentity('external_request', 'request-key'), { reconcile: async () => ({
    decision: 'already_committed', action: 'reuse_external_receipt', evidenceDigest: REALITY
  }) });
  assert.equal(result.effect.state, 'reconcile_required');
  assert.equal(result.recovery.decision, 'already_committed');
}));

test('an abandoned failed Effect keeps its idempotency key and is not a fresh intended row', () => fixture(({ journal }) => {
  const first = journal.intend({ eventAttemptId: 'event-attempt', effectClass: 'workspace_write',
    idempotencyKey: 'request-key', intentDigest: INTENT });
  assert.equal(journal.abandonUncommitted(first.effect_id).state, 'failed');
  const reused = journal.intend({ eventAttemptId: 'event-attempt-2', effectClass: 'workspace_write',
    idempotencyKey: 'request-key', intentDigest: INTENT });
  assert.equal(reused.effect_id, first.effect_id);
  assert.equal(reused.state, 'failed');
  assert.equal(reused.event_attempt_id, 'event-attempt');
}));

test('safe retry keeps one durable intent for reuse by a later Event Attempt', async () => fixture(async ({ journal }) => {
  journal.intend({ eventAttemptId: 'event-attempt', effectClass: 'external_request', idempotencyKey: 'request-key', intentDigest: INTENT });
  const result = await journal.reconcile(effectIdentity('external_request', 'request-key'), { reconcile: async () => ({
    decision: 'safe_retry', action: 'submit_once_after_proven_absent', evidenceDigest: REALITY
  }) });
  assert.equal(result.effect.state, 'reconcile_required');
  const reused = journal.intend({ eventAttemptId: 'event-attempt-2', effectClass: 'external_request',
    idempotencyKey: 'request-key', intentDigest: INTENT });
  assert.equal(reused.effect_id, result.effect.effect_id);
  assert.equal(reused.event_attempt_id, 'event-attempt');
}));

test('deferred external identity is durable before effect-specific reconciliation and cannot be replaced', () => fixture(({ journal }) => {
  const effect = journal.intend({ eventAttemptId: 'event-attempt', effectClass: 'external_request',
    idempotencyKey: 'request-key', intentDigest: INTENT });
  const externalReceipt = { receiptId: 'external-receipt', idempotencyKey: 'request-key', requestDigest: OUTPUT };
  assert.equal(journal.noteExternalPending(effect.effect_id, externalReceipt).external_receipt_ref, 'external-receipt');
  assert.equal(journal.requireReconcile(effect.effect_id).external_receipt_ref, 'external-receipt');
  assert.throws(() => journal.noteExternalPending(effect.effect_id, { ...externalReceipt, receiptId: 'replacement' }),
    { code: 'P4_EFFECT_EXTERNAL_RECEIPT_CONFLICT' });
  assert.throws(() => journal.noteExternalPending(effect.effect_id, { ...externalReceipt, idempotencyKey: 'other' }),
    { code: 'P4_EFFECT_EXTERNAL_RECEIPT_BINDING_MISMATCH' });
}));
