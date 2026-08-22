'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { createAcceptanceRecoveryStore } = require('../../src/helix/domains/arca/persistence/acceptance-recovery-store');
const { createExecutorIncidentRegistry, OPEN_THRESHOLD } = require('../../src/helix/foundation/execution/executor-incident-registry');
const { createCircuitBreaker } = require('../../src/helix/foundation/diagnostics/pressure-guard');
const { createOutboxDispatcherHost } = require('../../src/helix/foundation/execution/outbox-dispatcher-host');
const { canonicalDigest, canonicalJson } = require('../../src/helix/contracts/canonical-json');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const generated = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generated, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generated, 'clean-schema.manifest.json'), 'utf8'));
const hex = (character) => character.repeat(64);

async function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-uat019-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  let tick = 1700000000000;
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now:() => tick++ });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const breaker = createCircuitBreaker({ schemaManifest, unitOfWork });
  const incidents = createExecutorIncidentRegistry({ schemaManifest, unitOfWork, circuitBreaker:breaker, now:() => tick++ });
  const recovery = createAcceptanceRecoveryStore({ schemaManifest, unitOfWork, now:() => tick++ });
  try { return await run({ databasePath, kernel, unitOfWork, breaker, incidents, recovery }); }
  finally { kernel.close(); fs.rmSync(root, { recursive:true, force:true }); }
}

test('terminal executor failure becomes an Arca attention case without a business Decision', () => fixture(({ databasePath, incidents, recovery }) => {
  const admitted = recovery.admit({ offerId:'offer-1', onDeckPackageId:'package-1', packageDigest:hex('a'),
    workId:'work-generation-1', workKind:'acceptance_assessment', recoveryTriggerDigest:hex('b') });
  assert.equal(admitted.recoveryState, 'active');
  const incident = incidents.recordFailure({ ownerDomain:'arca', processType:'arca_acceptance',
    workKind:'acceptance_assessment', errorCode:'CLEAN_ARCA_TARGET_COLLISION' });
  const failed = recovery.recordFailure('offer-1', { workId:'work-generation-1', failurePhase:'acceptance_assessment',
    errorCode:'CLEAN_ARCA_TARGET_COLLISION', terminalAttemptCount:3, incidentKey:incident.incidentKey });
  assert.deepEqual({ state:failed.recoveryState, error:failed.errorCode, attempts:failed.terminalAttemptCount,
    owner:failed.ownerDomain, generation:failed.recoveryGeneration }, {
    state:'attention_required', error:'CLEAN_ARCA_TARGET_COLLISION', attempts:3, owner:'arca', generation:1,
  });
  const database = new Database(databasePath, { readonly:true });
  try {
    assert.equal(database.prepare('SELECT COUNT(*) count FROM arca_acceptance_decisions').get().count, 0);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM arca_handoff_b_receipts').get().count, 0);
  } finally { database.close(); }
}));

test('revision change creates one automatic generation and later failures wait for a user retry', () => fixture(({ incidents, recovery }) => {
  recovery.admit({ offerId:'offer-2', onDeckPackageId:'package-2', packageDigest:hex('c'),
    workId:'work-generation-1', workKind:'acceptance_assessment', recoveryTriggerDigest:hex('d') });
  const incident = incidents.recordFailure({ ownerDomain:'arca', processType:'arca_acceptance',
    workKind:'acceptance_assessment', errorCode:'EXECUTOR_DOWN' });
  recovery.recordFailure('offer-2', { workId:'work-generation-1', failurePhase:'acceptance_assessment',
    errorCode:'EXECUTOR_DOWN', terminalAttemptCount:2, incidentKey:incident.incidentKey });
  assert.equal(recovery.startGeneration('offer-2', { mode:'automatic', workId:'forbidden-same-trigger',
    recoveryTriggerDigest:hex('d') }).recoveryGeneration, 1);
  const automatic = recovery.startGeneration('offer-2', { mode:'automatic', workId:'work-generation-2',
    recoveryTriggerDigest:hex('e') });
  assert.deepEqual({ generation:automatic.recoveryGeneration, state:automatic.recoveryState, used:automatic.automaticRecoveryUsed },
    { generation:2, state:'automatic_recovering', used:true });
  recovery.recordFailure('offer-2', { workId:'work-generation-2', failurePhase:'acceptance_assessment',
    errorCode:'EXECUTOR_DOWN', terminalAttemptCount:2, incidentKey:incident.incidentKey });
  assert.equal(recovery.startGeneration('offer-2', { mode:'automatic', workId:'forbidden-second-auto',
    recoveryTriggerDigest:hex('f') }).recoveryGeneration, 2);
  const user = recovery.startGeneration('offer-2', { mode:'user', workId:'work-generation-3', recoveryTriggerDigest:hex('f') });
  assert.deepEqual({ generation:user.recoveryGeneration, state:user.recoveryState }, { generation:3, state:'user_retrying' });
}));

test('equal deterministic failures aggregate and open then close one process-local Circuit', () => fixture(({ breaker, incidents }) => {
  let incident;
  for (let ordinal = 1; ordinal <= OPEN_THRESHOLD; ordinal += 1) {
    incident = incidents.recordFailure({ ownerDomain:'arca', processType:'arca_acceptance',
      workKind:'acceptance_assessment', errorCode:'DETERMINISTIC_BROKEN_EXECUTOR' });
    assert.equal(incident.occurrenceCount, ordinal);
    assert.equal(incidents.scopeStatus({ ownerDomain:'arca', processType:'arca_acceptance',
      workKind:'acceptance_assessment' }).blocked, ordinal >= OPEN_THRESHOLD);
  }
  assert.equal(breaker.read(incident.circuitKey).state, 'open');
  assert.equal(incidents.scopeStatus({ ownerDomain:'arca', processType:'arca_acceptance',
    workKind:'acceptance_assessment' }).blocked, true);
  assert.equal(incidents.allows({ ownerDomain:'arca', processType:'arca_acceptance',
    workKind:'acceptance_assessment', errorCode:'DETERMINISTIC_BROKEN_EXECUTOR' }).allowed, false);
  incidents.beginRecovery(incident.incidentKey);
  assert.equal(breaker.read(incident.circuitKey).state, 'recovering');
  incidents.resolve(incident.incidentKey, hex('f'));
  assert.equal(breaker.read(incident.circuitKey).state, 'closed');
  assert.equal(incidents.read(incident.incidentKey).incident_state, 'resolved');
  assert.equal(incidents.scopeStatus({ ownerDomain:'arca', processType:'arca_acceptance',
    workKind:'acceptance_assessment' }).blocked, false);
}));

test('Handoff B admission persists Inbox before delivery and leaves Ack for a business terminal fact', async () => fixture(async ({ databasePath, unitOfWork, recovery }) => {
  const payload = { messageKind:'libra.product-offer.available@1', offerId:'offer-inbox', onDeckPackageId:'package-inbox' };
  const database = new Database(databasePath);
  database.prepare(`INSERT INTO fx_outbox(message_id,producer_domain,message_kind,aggregate_type,aggregate_id,aggregate_revision,
    dedup_key,consumer_set_digest,intended_consumer_count,payload_schema_ref,payload_json,payload_digest,state,available_at_ms,created_at_ms,all_acked_at_ms)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('message-inbox','libra','libra.product-offer.available@1','on_deck_package',
    'package-inbox',1,'offer-inbox',hex('1'),1,'helix://contracts/types/LibraProductOffer/v1',canonicalJson(payload),
    canonicalDigest(payload),'pending',1,1,null);
  database.prepare(`INSERT INTO fx_outbox_deliveries(message_id,consumer_domain,state,attempt_count,next_attempt_at_ms,acked_at_ms)
    VALUES(?,?,?,?,?,?)`).run('message-inbox','arca','pending',0,1,null);
  database.close();

  let wakes = 0;
  const host = createOutboxDispatcherHost({ schemaManifest, unitOfWork, now:() => 1_800_000_000_000,
    arcaCoordinator:{ admitOffer() { const work={workId:'work-inbox',executionBasisDigest:hex('2')};
      const admitted=recovery.admit({ offerId:'offer-inbox',onDeckPackageId:'package-inbox',packageDigest:hex('3'),
        workId:work.workId,workKind:'acceptance_assessment',recoveryTriggerDigest:hex('4') });
      return { processId:'offer-inbox',work,recovery:admitted,
        admissionParticipant:recovery.admissionParticipant({offerId:'offer-inbox',workId:work.workId,packageDigest:hex('3')}) };
    } }, executionRuntimeHost:{wake(){wakes+=1;}}, onError:(error)=>{throw error;},
  });
  assert.equal((await host.drainOnce()).delivered,1);
  const check = new Database(databasePath, { readonly:true });
  try {
    const delivery = check.prepare('SELECT state,attempt_count,acked_at_ms FROM fx_outbox_deliveries WHERE message_id=?').get('message-inbox');
    const inbox = check.prepare('SELECT result_digest,consumed_at_ms FROM fx_inbox WHERE consumer_domain=? AND message_id=?').get('arca','message-inbox');
    assert.deepEqual({ state:delivery.state, attempts:delivery.attempt_count, ack:delivery.acked_at_ms },
      { state:'delivered', attempts:1, ack:null });
    assert.ok(inbox.result_digest); assert.ok(inbox.consumed_at_ms); assert.equal(wakes,1);
  } finally { check.close(); }
}));

test('Libra consumes and fully acknowledges its internal workspace-cleanup wake', async () => fixture(async ({ databasePath, unitOfWork }) => {
  const payload = { messageKind:'libra.workspace-cleanup.requested@1', libraRunId:'run-discarded',
    cleanupScopeId:'cleanup-scope-1', triggerDigest:hex('5') };
  const database = new Database(databasePath);
  database.prepare(`INSERT INTO fx_outbox(message_id,producer_domain,message_kind,aggregate_type,aggregate_id,aggregate_revision,
    dedup_key,consumer_set_digest,intended_consumer_count,payload_schema_ref,payload_json,payload_digest,state,available_at_ms,created_at_ms,all_acked_at_ms)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('message-cleanup','libra','libra.workspace-cleanup.requested@1','libra_run',
    payload.libraRunId,4,'cleanup-wake',canonicalDigest(['libra']),1,'libra.workspace-cleanup-requested@1',canonicalJson(payload),
    canonicalDigest(payload),'pending',1,1,null);
  database.prepare(`INSERT INTO fx_outbox_deliveries(message_id,consumer_domain,state,attempt_count,next_attempt_at_ms,acked_at_ms)
    VALUES(?,?,?,?,?,?)`).run('message-cleanup','libra','pending',0,1,null);
  database.close();

  let wakes = 0;
  const host = createOutboxDispatcherHost({ schemaManifest, unitOfWork, now:() => 1_800_000_000_000,
    executionRuntimeHost:{wake(){wakes+=1;}}, onError:(error)=>{throw error;} });
  assert.equal((await host.drainOnce()).delivered, 1);
  const check = new Database(databasePath, { readonly:true });
  try {
    const delivery = check.prepare('SELECT state,attempt_count,acked_at_ms FROM fx_outbox_deliveries WHERE message_id=?')
      .get('message-cleanup');
    assert.deepEqual({ state:delivery.state, attempt_count:delivery.attempt_count }, { state:'acked', attempt_count:0 });
    assert.ok(delivery.acked_at_ms);
    assert.ok(check.prepare('SELECT result_digest FROM fx_inbox WHERE consumer_domain=? AND message_id=?')
      .get('libra','message-cleanup').result_digest);
    const message = check.prepare('SELECT state,all_acked_at_ms FROM fx_outbox WHERE message_id=?').get('message-cleanup');
    assert.deepEqual(message, { state:'fully_acked', all_acked_at_ms:delivery.acked_at_ms });
    assert.equal(wakes, 1);
  } finally { check.close(); }
}));
