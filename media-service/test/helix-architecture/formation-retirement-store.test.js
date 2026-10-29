'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createFormationRetirementStore } = require('../../src/helix/domains/libra/persistence/formation-retirement-store');
const { createArcaFormationRetirementStore } = require('../../src/helix/domains/arca/persistence/formation-retirement-store');
const { createOnDeckProcessCoordinator } = require('../../src/helix/domains/arca/application/on-deck-process-coordinator');
const { createFormationRunHistoryStore } = require('../../src/helix/domains/libra/persistence/formation-run-history-store');
const { activeRunScopeSetDigest } = require('../../src/helix/domains/libra/model/run-admission-contracts');
const { runStateDigest } = require('../../src/helix/domains/libra/model/run-lifecycle-contracts');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createRetirementJournal } = require('../../scripts/formation-retirement-journal');
const { createFormationRetirementOperator } = require('../../scripts/formation-retirement-operator');
const { inspectRetirementPlan } = require('../../scripts/formation-retirement-plan');
const { writeAtomic } = require('../../src/clean-runtime-operations');
const { createPredeckPipelineAdmissionStore } = require('../../src/helix/domains/libra/persistence/predeck-pipeline-admission-store');
const { createIntakeRetirementStore } = require('../../src/helix/domains/libra/persistence/intake-retirement-store');
const { createCandidateRetirementStore } = require('../../src/helix/domains/procurement/persistence/candidate-retirement-store');
const { createIntakeProcessCoordinator } = require('../../src/helix/domains/libra/application/intake-process-coordinator');
const { decisionId } = require('../../src/helix/domains/libra/persistence/intake-offer-reader');
const schemaManifest = require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const schemaDdl = fs.readFileSync(path.join(__dirname, '../../src/helix/foundation/persistence/generated/clean-schema.sql'), 'utf8');
const D = canonicalDigest({ fixture: 'administrative-retirement' });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'libra-retirement-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 5000 });
  const db = new Database(databasePath); db.pragma('foreign_keys = ON');
  db.prepare(`INSERT INTO libra_subjects(subject_id,status,structure_kind,content_profile,intake_revision,
    current_continuity_set_digest,current_episode_scope_digest,created_at_ms,updated_at_ms)
    VALUES ('subject','active','single','movie',1,?,?,1,1)`).run(D, D);
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const store = createFormationRetirementStore({ schemaManifest, unitOfWork });
  return { root, db, store, kernel, unitOfWork, close() { db.close(); kernel.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}
function request(f) {
  return { retirementId: 'reset-1', subjectId: 'subject', expectedSnapshotDigest: f.store.inspect('subject').snapshotDigest,
    backupDigest: D, manifestDigest: D, retiringRunIds: f.store.inspect('subject').runs.filter(row => ['active','frozen','suspended'].includes(row.state)).map(row => row.libra_run_id) };
}
function run(f, id, state) {
  const digest = runStateDigest({ libraRunId: id, stateRevision: 1, state, acceptanceSpecId: null, executionBasisDigest: D,
    runScopeDigest: D, priorityClass: 'normal', priorityIntentDigest: D, transitionKind: 'admitted', transitionEvidenceDigest: D });
  f.db.prepare(`INSERT INTO libra_runs(libra_run_id,subject_id,admission_revision,execution_basis_record_json,execution_basis_digest,
    run_scope_digest,state,state_revision,state_digest,priority_class,priority_intent_digest,recovery_attempt_ordinal,created_at_ms)
    VALUES (?,'subject',?,'{}',?,?,?,1,?,'normal',?,0,1)`).run(id, f.db.prepare('SELECT count(*) n FROM libra_runs').get().n + 1, D, D, state, digest, D);
  return { libraRunId: id, runScopeDigest: D, stateRevision: 1, stateDigest: digest };
}

function pendingIntake(f) {
  const processId=decisionId('candidate-offer');
  const identity={mountScopeId:'mount',inode:'123',sizeBytes:42,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:D};
  const materialKey=canonicalDigest({schema:'physical-material-identity@2',...identity});
  f.db.prepare("INSERT INTO proc_procurement_runs(procurement_run_id,state) VALUES ('proc-run','sealed')").run();
  f.db.prepare("INSERT INTO proc_candidate_packages(candidate_package_id,procurement_run_id,package_digest) VALUES ('candidate','proc-run',?)").run(D);
  f.db.prepare("INSERT INTO proc_candidate_deliveries(offer_id,candidate_package_id,package_revision,package_digest,acceptance_basis_digest,state,offered_at_ms) VALUES ('candidate-offer','candidate',1,?,?,'open',1)").run(D,D);
  f.db.prepare("INSERT INTO proc_candidate_primary_materials(candidate_package_id,ordinal,material_key) VALUES ('candidate',0,?)").run(materialKey);
  f.db.prepare("INSERT INTO proc_run_materials(procurement_run_id,ordinal,material_key,selection_state,candidate_package_id) VALUES ('proc-run',0,?,'candidate_delivery','candidate')").run(materialKey);
  f.db.prepare("INSERT INTO libra_predeck_pipeline_tokens VALUES ('future-subject','field',?,1)").run(processId);
  const offer={offerId:'candidate-offer',candidatePackageId:'candidate',packageRevision:1,packageDigest:D,acceptanceBasisDigest:D};
  f.db.prepare("INSERT INTO fx_outbox(message_id,producer_domain,message_kind,payload_json,payload_digest,consumer_set_digest,intended_consumer_count,state) VALUES ('candidate-message','procurement','procurement_candidate_offer_available',?,?,?,1,'pending')")
    .run(JSON.stringify(offer),canonicalDigest(offer),canonicalDigest(['libra']));
  f.db.prepare("INSERT INTO fx_outbox_deliveries(message_id,consumer_domain,state,attempt_count,next_attempt_at_ms) VALUES ('candidate-message','libra','pending',0,0)").run();
  f.db.prepare("INSERT INTO fx_material_controls(material_key,state,owner_domain,owner_scope_type,owner_scope_id,control_revision,mount_scope_id,inode,size_bytes,fingerprint_algorithm,fingerprint_version,content_fingerprint) VALUES (?,'controlled','procurement','material_field','field',1,'mount','123',42,'middle-256k-sha256',1,?)").run(materialKey,D);
  f.db.prepare("INSERT INTO fx_material_control_revisions(material_key,revision,operation_kind,to_owner_domain,to_scope_type,to_scope_id,basis_digest,commit_marker,committed_at_ms) VALUES (?,1,'acquire','procurement','material_field','field',?,'proc-admission',1)").run(materialKey,D);
  const dependencies={schemaManifest,unitOfWork:f.unitOfWork};
  let intake;
  const procurement=createCandidateRetirementStore({...dependencies,readIntakeRetirementReceipt:id=>intake.readReceipt(id)});
  intake=createIntakeRetirementStore({...dependencies,readCandidateSnapshot:procurement.inspect});
  const command={retirementId:'reset-pending',processId,offerId:'candidate-offer',candidatePackageId:'candidate',packageDigest:D,
    expectedSnapshotDigest:intake.inspect(processId).snapshotDigest,candidateSnapshotDigest:procurement.inspect('candidate-offer').snapshotDigest,
    backupDigest:D,manifestDigest:D};
  return {processId,intake,procurement,command};
}

test('pending Intake retirement preserves Candidate history and Procurement Control without fabricating Handoff rejection',()=>{
  const f=fixture();
  try {
    const p=pendingIntake(f),control=f.db.prepare('SELECT * FROM fx_material_controls').get();
    const candidate=f.db.prepare('SELECT * FROM proc_candidate_packages').get(),primary=f.db.prepare('SELECT * FROM proc_candidate_primary_materials').get();
    const procurementRequest={retirementId:'reset-pending',offerId:'candidate-offer',intakeProcessId:p.processId,
      expectedSnapshotDigest:p.procurement.inspect('candidate-offer').snapshotDigest,intakeReceiptDigest:D,backupDigest:D,manifestDigest:D};
    assert.throws(()=>p.procurement.commit(procurementRequest),{code:'PROCUREMENT_RETIREMENT_INTAKE_PENDING'});
    p.intake.commit(p.command);
    assert.equal(f.db.prepare('SELECT count(*) n FROM libra_predeck_pipeline_tokens').get().n,0);
    assert.equal(f.db.prepare('SELECT state FROM proc_candidate_deliveries').get().state,'open');
    const exact={...procurementRequest,intakeReceiptDigest:p.intake.readReceipt(p.processId).receiptDigest};
    assert.equal(p.procurement.commit(exact).receipt.resultRef.releasedMaterialCount,1);
    assert.equal(p.procurement.commit(exact).replayed,true);assert.equal(p.intake.commit(p.command).replayed,true);
    assert.equal(f.db.prepare('SELECT state FROM proc_candidate_deliveries').get().state,'administratively_retired');
    assert.equal(f.db.prepare('SELECT selection_state FROM proc_run_materials').get().selection_state,'released');
    assert.deepEqual(f.db.prepare('SELECT * FROM fx_material_controls').get(),control);
    assert.deepEqual(f.db.prepare('SELECT * FROM proc_candidate_packages').get(),candidate);
    assert.deepEqual(f.db.prepare('SELECT * FROM proc_candidate_primary_materials').get(),primary);
    assert.equal(f.db.prepare('SELECT count(*) n FROM libra_intake_decisions').get().n,0);
    assert.equal(f.db.prepare('SELECT count(*) n FROM libra_handoff_a_receipts').get().n,0);
    assert.equal(f.db.prepare('SELECT count(*) n FROM fx_outbox').get().n,1);
    const coordinator=createIntakeProcessCoordinator({schemaManifest,unitOfWork:f.unitOfWork,intakeRetirement:p.intake,
      pipelineAdmission:{},offerReader:{decisionId,remember(){assert.fail('Retired Offer must not fetch its old Candidate again.');}},
      workAdmission:{submit(){assert.fail('Retired Intake must not admit Work.');}}});
    const offer={offerId:'candidate-offer',candidatePackageId:'candidate',packageDigest:D,packageRevision:1};
    const retired=coordinator.admitOffer(offer);
    assert.equal(retired.kind,'administratively_retired');
    assert.equal(coordinator.reconcile(p.processId).kind,'administratively_retired');
    f.unitOfWork.execute([retired.admissionParticipant]);
    assert.throws(()=>coordinator.admitOffer({...offer,packageDigest:'b'.repeat(64)}),{code:'LIBRA_INTAKE_RETIREMENT_OFFER_MISMATCH'});
    assert.deepEqual(p.intake.listProcessIds(),[p.processId]);
    const admission=createPredeckPipelineAdmissionStore({schemaManifest,unitOfWork:f.unitOfWork,now:()=>5000});
    assert.throws(()=>admission.acquire({fieldId:'field',subjectId:'future-subject',sourceProcessId:p.processId}),{code:'LIBRA_INTAKE_RETIRED'});
    assert.equal(f.db.prepare('SELECT count(*) n FROM libra_predeck_pipeline_tokens').get().n,0);
  } finally {f.close();}
});

test('pending Intake closure refuses stale membership and never retires an Accepted Delivery',()=>{
  const f=fixture();
  try {
    const p=pendingIntake(f);p.intake.commit(p.command);
    const command={retirementId:'reset-pending',offerId:'candidate-offer',intakeProcessId:p.processId,
      expectedSnapshotDigest:p.procurement.inspect('candidate-offer').snapshotDigest,
      intakeReceiptDigest:p.intake.readReceipt(p.processId).receiptDigest,backupDigest:D,manifestDigest:D};
    f.db.prepare("UPDATE proc_run_materials SET selection_state='transferred'").run();
    assert.throws(()=>p.procurement.commit(command),{code:'PROCUREMENT_RETIREMENT_STALE'});
    assert.equal(f.db.prepare('SELECT state FROM proc_candidate_deliveries').get().state,'open');
    f.db.prepare("UPDATE proc_candidate_deliveries SET state='accepted'").run();
    assert.throws(()=>p.procurement.commit({...command,expectedSnapshotDigest:p.procurement.inspect('candidate-offer').snapshotDigest}),{code:'PROCUREMENT_RETIREMENT_TERMINAL'});
  } finally {f.close();}
});

test('Operator resumes a pending Intake after Libra commits but before Procurement releases the Candidate',async()=>{
  const f=fixture();let operator;
  try {
    const p=pendingIntake(f),resetId='formation-reset-pending-operator';
    const plan=inspectRetirementPlan(f.db);
    assert.equal(plan.pendingIntakes.length,1);assert.deepEqual(plan.blockers,[]);
    let crash=true;
    const options={dataDir:f.root,verifyBackup:()=>{},afterCommit(step){if(crash&&step.owner==='intake')throw new Error('between owners');}};
    operator=createFormationRetirementOperator(options);
    operator.prepare({resetId,expectedPlanDigest:plan.planDigest,previewDigest:D,backup:{backupId:'backup',backupDigest:D}});
    fs.mkdirSync(path.join(f.root,'operator-runtime'));
    writeAtomic(path.join(f.root,'operator-runtime','intent.json'),{schema:'shelfdeck.runtime-intent@1',desiredMode:'stopped',revision:1,
      pendingReset:{operationId:'operation',resetId,previewDigest:D,backupId:'backup',backupDigest:D}});
    await assert.rejects(operator.execute(resetId),/between owners/);
    assert.ok(p.intake.readReceipt(p.processId));
    assert.equal(f.db.prepare('SELECT state FROM proc_candidate_deliveries').get().state,'open');
    operator.close();operator=null;crash=false;
    operator=createFormationRetirementOperator(options);
    const result=await operator.execute(resetId);
    assert.equal(result.state,'completed');
    assert.equal(f.db.prepare('SELECT state FROM proc_candidate_deliveries').get().state,'administratively_retired');
    assert.equal(f.db.prepare('SELECT selection_state FROM proc_run_materials').get().selection_state,'released');
    assert.equal(f.db.prepare('SELECT count(*) n FROM fx_command_receipts').get().n,3);
    f.db.prepare("DELETE FROM fx_commit_markers WHERE owner_domain='procurement'").run();
    await assert.rejects(operator.execute(resetId),{code:'PROCUREMENT_RETIREMENT_RECEIPT_CORRUPT'});
  } finally {operator?.close();f.close();}
});

test('Libra administrative retirement preserves terminal history and appends exact Run/command audit facts', () => {
  const f = fixture();
  try {
    const active = run(f, 'active', 'frozen'); run(f, 'history', 'discarded'); run(f, 'collected', 'completed');
    f.db.prepare(`INSERT INTO libra_run_admission_heads(subject_id,head_revision,active_scope_set_digest,updated_at_ms)
      VALUES ('subject',1,?,1)`).run(activeRunScopeSetDigest('subject', [active]));
    f.db.prepare(`INSERT INTO libra_predeck_pipeline_tokens(subject_id,source_field_id,source_process_id,acquired_at_ms)
      VALUES ('subject','field','intake',1)`).run();
    const history = f.db.prepare("SELECT * FROM libra_runs WHERE libra_run_id IN ('history','collected') ORDER BY libra_run_id").all();
    const command = request(f), result = f.store.commit(command);
    assert.equal(result.replayed, false);
    assert.equal(result.receipt.resultRef.retiredRunCount, 1);
    assert.equal(f.store.inspect('subject').subject.status, 'administratively_retired');
    assert.equal(f.db.prepare('SELECT count(*) n FROM libra_predeck_pipeline_tokens').get().n, 0);
    assert.deepEqual(f.db.prepare("SELECT * FROM libra_runs WHERE libra_run_id IN ('history','collected') ORDER BY libra_run_id").all(), history);
    const revision = f.db.prepare('SELECT * FROM libra_run_revisions').get();
    assert.equal(revision.state, 'administratively_retired');
    assert.equal(revision.previous_state_revision, 1);
    assert.equal(f.db.prepare('SELECT count(*) n FROM fx_command_receipts').get().n, 1);
    assert.equal(f.db.prepare('SELECT count(*) n FROM fx_audit_records').get().n, 1);
    assert.equal(f.db.prepare('SELECT count(*) n FROM libra_task_cancellations').get().n, 0);
    assert.equal(f.db.prepare('SELECT count(*) n FROM libra_run_discard_decisions').get().n, 0);
    assert.equal(f.store.commit(command).replayed, true);
    assert.equal(f.db.prepare('SELECT count(*) n FROM libra_run_revisions').get().n, 1);
    assert.throws(() => f.store.commit({ ...command, backupDigest: 'b'.repeat(64) }), { code: 'P3_COMMAND_IDEMPOTENCY_CONFLICT' });
    assert.deepEqual(f.db.pragma('foreign_key_check'), []);
  } finally { f.close(); }
});

test('a retired historical Subject does not release a later Owner or fabricate a discard', () => {
  const f = fixture();
  try {
    run(f, 'history', 'discarded');
    f.db.prepare(`INSERT INTO fx_material_controls(material_key,owner_domain,owner_scope_type,owner_scope_id,control_revision,state)
      VALUES ('later-material','libra','subject','later-subject',9,'controlled')`).run();
    const control = f.db.prepare('SELECT * FROM fx_material_controls').get();
    const result = f.store.commit(request(f));
    assert.equal(result.receipt.resultRef.retiredRunCount, 0);
    assert.deepEqual(f.db.prepare('SELECT * FROM fx_material_controls').get(), control);
    assert.equal(f.db.prepare('SELECT count(*) n FROM libra_run_revisions').get().n, 0);
    const seats = createPredeckPipelineAdmissionStore({schemaManifest,unitOfWork:f.unitOfWork,now:()=>5000});
    assert.throws(()=>seats.acquire({fieldId:'field',subjectId:'subject',sourceProcessId:'old-intake'}),{code:'LIBRA_SUBJECT_TERMINAL'});
    assert.equal(f.db.prepare('SELECT count(*) n FROM libra_predeck_pipeline_tokens').get().n,0);
  } finally { f.close(); }
});

test('Operator resumes the same durable Owner command after a crash between commit and journal acknowledgement', async () => {
  const f=fixture();
  try {
    const active=run(f,'unfinished','frozen');
    f.db.prepare("INSERT INTO libra_run_admission_heads VALUES ('subject',1,?,1)").run(activeRunScopeSetDigest('subject',[active]));
    let crash=true, prepared=0, verified=0, authorized=false;
    const options={dataDir:f.root,
      assertAuthorized(){if(!authorized)throw Object.assign(new Error('Not authorized'),{code:'TEST_NOT_AUTHORIZED'});},
      verifyBackup(){verified++;},
      prepareRequest(){prepared++;return request(f);},
      commitStep(_step,command){const result=f.store.commit(command);return {replayed:result.replayed,receipt:result.receipt};},
      afterCommit(){if(crash)throw new Error('injected process interruption');},
      verifyCompleted(){assert.equal(f.store.inspect('subject').subject.status,'administratively_retired');return {retiredSubjectCount:1};},
    };
    const first=createRetirementJournal(options);
    first.prepare({resetId:'formation-reset-journal-test',manifest:{subjectIds:['subject']},backup:{backupId:'verified',backupDigest:D},steps:[{owner:'libra',subjectId:'subject'}]});
    await assert.rejects(first.execute('formation-reset-journal-test'),{code:'TEST_NOT_AUTHORIZED'});
    assert.equal(f.store.inspect('subject').subject.status,'active');
    authorized=true;
    await assert.rejects(first.execute('formation-reset-journal-test'),/injected process interruption/);
    assert.equal(first.read('formation-reset-journal-test').completed.length,0);
    assert.equal(f.store.inspect('subject').subject.status,'administratively_retired');
    crash=false;
    const resumed=await createRetirementJournal(options).execute('formation-reset-journal-test');
    assert.equal(resumed.state,'completed');assert.equal(prepared,1);assert.equal(verified,2);
    assert.equal(resumed.completed[0].result.replayed,true);
    assert.equal(f.db.prepare('SELECT count(*) n FROM libra_run_revisions').get().n,1);
    assert.equal(f.db.prepare('SELECT count(*) n FROM fx_command_receipts').get().n,1);
    assert.equal((await createRetirementJournal(options).execute('formation-reset-journal-test')).state,'completed');
  } finally {f.close();}
});

test('real Operator checks the stopped pending intent and resumes its frozen manifest across reconstruction', async () => {
  const f=fixture();let operator;
  try {
    run(f,'history','discarded');
    f.db.prepare("INSERT INTO libra_formation_projections(subject_id,classification,subject_status,display_identity,next_action_label,next_action_state,attention_state,added_at_ms,updated_at_ms) VALUES ('subject','in_progress','active','History','Waiting','pending','none',1,1)").run();
    const plan=inspectRetirementPlan(f.db),resetId='formation-reset-real-operator';
    let crash=true,backupChecks=0;
    const options={dataDir:f.root,verifyBackup(backup){assert.equal(backup.backupDigest,D);backupChecks++;},
      afterCommit(step){if(crash&&step.owner==='libra')throw new Error('operator interrupted after Owner commit');}};
    operator=createFormationRetirementOperator(options);
    operator.prepare({resetId,expectedPlanDigest:plan.planDigest,previewDigest:D,backup:{backupId:'backup',backupDigest:D}});
    await assert.rejects(operator.execute(resetId),{code:'RESET_STOPPED_INTENT_REQUIRED'});
    fs.mkdirSync(path.join(f.root,'operator-runtime'));
    writeAtomic(path.join(f.root,'operator-runtime','intent.json'),{schema:'shelfdeck.runtime-intent@1',desiredMode:'stopped',revision:1,
      pendingReset:{operationId:'operation',resetId,previewDigest:D,backupId:'backup',backupDigest:D}});
    await assert.rejects(operator.execute(resetId),/operator interrupted after Owner commit/);
    assert.equal(f.db.prepare('SELECT status FROM libra_subjects').get().status,'administratively_retired');
    operator.close();operator=null;crash=false;
    operator=createFormationRetirementOperator(options);
    const complete=await operator.execute(resetId);
    assert.equal(complete.state,'completed');assert.equal(complete.verification.retiredSubjects,1);
    assert.equal(complete.completed.at(-1).result.replayed,true);assert.equal(backupChecks,2);
    f.db.prepare("UPDATE libra_runs SET recovery_attempt_ordinal=1 WHERE libra_run_id='history'").run();
    await assert.rejects(operator.execute(resetId),{code:'RESET_HISTORY_PROTECTION_FAILED'});
    f.db.prepare("UPDATE libra_runs SET recovery_attempt_ordinal=0 WHERE libra_run_id='history'").run();
    const receiptId=f.store.readReceipt('subject').receiptId;
    f.db.prepare("UPDATE fx_commit_markers SET commit_digest=? WHERE commit_marker=?").run('b'.repeat(64),receiptId);
    await assert.rejects(operator.execute(resetId),{code:'LIBRA_RETIREMENT_RECEIPT_CORRUPT'});

    assert.equal(f.db.prepare('SELECT count(*) n FROM fx_command_receipts').get().n,1);
  } finally {operator?.close();f.close();}
});

test('Libra retirement refuses live Control and execution instead of relabelling them as complete', () => {
  const f = fixture();
  try {
    f.db.prepare(`INSERT INTO fx_material_controls(material_key,mount_scope_id,inode,size_bytes,fingerprint_algorithm,fingerprint_version,
      content_fingerprint,owner_domain,owner_scope_type,owner_scope_id,control_revision,state)
      VALUES ('owned','mount','12',42,'middle-256k-sha256','1',?,'libra','subject','subject',1,'controlled')`).run(D);
    assert.throws(() => f.store.commit(request(f)), { code: 'SCOPED_CONTROL_RELEASE_STALE' });
    f.db.prepare("UPDATE fx_material_controls SET state='released',owner_domain=NULL,owner_scope_type=NULL,owner_scope_id=NULL").run();
    f.db.prepare(`INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,definition_json,state)
      VALUES ('work','libra','libra_routing','subject','{}','running')`).run();
    assert.throws(() => f.store.commit(request(f)), { code: 'LIBRA_RETIREMENT_EXECUTION_PENDING' });
    assert.equal(f.store.inspect('subject').subject.status, 'active');
    assert.equal(f.db.prepare('SELECT count(*) n FROM fx_command_receipts').get().n, 0);
  } finally { f.close(); }
});

test('retirement validates the full snapshot and rolls back if its durable Receipt cannot commit', () => {
  const f = fixture();
  try {
    const stale = request(f);
    f.db.prepare("UPDATE libra_subjects SET intake_revision=2 WHERE subject_id='subject'").run();
    assert.throws(() => f.store.commit(stale), { code: 'LIBRA_RETIREMENT_STALE' });
    f.db.exec("CREATE TRIGGER reject_retirement_receipt BEFORE INSERT ON fx_command_receipts BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END");
    assert.throws(() => f.store.commit(request(f)), /injected receipt failure/);
    assert.equal(f.store.inspect('subject').subject.status, 'active');
    assert.equal(f.db.prepare('SELECT count(*) n FROM fx_commit_markers').get().n, 0);
  } finally { f.close(); }
});

test('retirement appends Control release without truncating its prior audit and is atomic with its Receipt', () => {
  const f=fixture();
  try {
    const identity={mountScopeId:'mount',inode:'12',sizeBytes:42,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:D};
    const materialKey=canonicalDigest({schema:'physical-material-identity@2',...identity});
    f.db.prepare(`INSERT INTO fx_material_controls(material_key,mount_scope_id,inode,size_bytes,fingerprint_algorithm,fingerprint_version,
      content_fingerprint,owner_domain,owner_scope_type,owner_scope_id,control_revision,state,updated_at_ms)
      VALUES (?,'mount','12',42,'middle-256k-sha256','1',?,'libra','subject','subject',1,'controlled',1)`).run(materialKey,D);
    f.db.prepare(`INSERT INTO fx_material_control_revisions(material_key,revision,operation_kind,to_owner_domain,to_scope_type,to_scope_id,
      basis_digest,commit_marker,committed_at_ms) VALUES (?,1,'transfer','libra','subject','subject',?,'original',1)`).run(materialKey,D);
    const original=f.db.prepare('SELECT * FROM fx_material_control_revisions').get();
    const command={...request(f),expectedControls:f.db.prepare('SELECT * FROM fx_material_controls').all()};
    for(const value of [null, '42', -1, Number.MAX_SAFE_INTEGER+1]) {
      const malformed={...command,expectedControls:command.expectedControls.map(row=>({...row,size_bytes:value}))};
      assert.throws(()=>f.store.commit(malformed),{code:'SCOPED_CONTROL_RELEASE_INVALID'});
    }
    f.db.exec("CREATE TRIGGER reject_release_receipt BEFORE INSERT ON fx_command_receipts BEGIN SELECT RAISE(ABORT, 'release receipt failure'); END");
    assert.throws(()=>f.store.commit(command),/release receipt failure/);
    assert.equal(f.db.prepare('SELECT state FROM fx_material_controls').get().state,'controlled');
    assert.equal(f.db.prepare('SELECT count(*) n FROM fx_material_control_revisions').get().n,1);
    f.db.exec('DROP TRIGGER reject_release_receipt');
    const result=f.store.commit(command);
    assert.equal(result.receipt.resultRef.releasedControlCount,1);
    assert.equal(f.db.prepare('SELECT state FROM fx_material_controls').get().state,'released');
    assert.deepEqual(f.db.prepare('SELECT * FROM fx_material_control_revisions WHERE revision=1').get(),original);
    assert.equal(f.db.prepare('SELECT operation_kind FROM fx_material_control_revisions WHERE revision=2').get().operation_kind,'release');
    assert.equal(f.store.commit(command).replayed,true);
    assert.equal(f.db.prepare('SELECT count(*) n FROM fx_material_control_revisions').get().n,2);
  }finally{f.close();}
});

function seedArca(f) {
  f.db.prepare(`INSERT INTO arca_acceptance_attempts(acceptance_attempt_id,offer_id,on_deck_package_id,package_digest,state,created_at_ms,finished_at_ms)
    VALUES ('attempt','offer','package',?,'accepted',1,2)`).run(D);
  f.db.prepare(`INSERT INTO arca_acceptance_decisions(acceptance_decision_id,acceptance_attempt_id,result,offer_id,on_deck_package_id,package_digest,decided_at_ms)
    VALUES ('decision','attempt','accepted','offer','package',?,2)`).run(D);
  f.db.prepare(`INSERT INTO arca_ondeck_custodies(custody_id,acceptance_decision_id,on_deck_package_id,package_digest,state,accepted_at_ms)
    VALUES ('custody','decision','package',?,'active',2)`).run(D);
  f.db.prepare(`INSERT INTO arca_ondeck_runs(on_deck_run_id,custody_id,state,created_at_ms,target_reserved_at_ms)
    VALUES ('on-deck','custody','blocked',2,3)`).run();
  f.db.prepare(`INSERT INTO arca_acceptance_recovery_cases(offer_id,on_deck_package_id,package_digest,recovery_state,recovery_generation,updated_at_ms)
    VALUES ('offer','package',?,'resolved','1',3)`).run(D);
  const store=createArcaFormationRetirementStore({schemaManifest,unitOfWork:f.unitOfWork});
  return {store,request:{retirementId:'reset-1',offerId:'offer',packageId:'package',packageDigest:D,
    expectedSnapshotDigest:store.inspect('offer','package').snapshotDigest,backupDigest:D,manifestDigest:D}};
}

test('Arca retirement releases uncommitted target/custody while preserving Accepted decisions',()=>{
  const f=fixture();
  try{
    const arca=seedArca(f),attempt=f.db.prepare('SELECT * FROM arca_acceptance_attempts').get(),decision=f.db.prepare('SELECT * FROM arca_acceptance_decisions').get();
    const result=arca.store.commit(arca.request);
    assert.equal(result.receipt.resultRef.resultKind,'administratively_retired');
    assert.deepEqual(f.db.prepare('SELECT * FROM arca_acceptance_attempts').get(),attempt);
    assert.deepEqual(f.db.prepare('SELECT * FROM arca_acceptance_decisions').get(),decision);
    assert.equal(f.db.prepare('SELECT state FROM arca_ondeck_custodies').get().state,'released');
    assert.deepEqual(f.db.prepare('SELECT state,target_reserved_at_ms FROM arca_ondeck_runs').get(),{state:'administratively_retired',target_reserved_at_ms:null});
    assert.equal(arca.store.readReceipt('offer').receiptDigest,result.receipt.resultDigest);
    assert.equal(arca.store.commit(arca.request).replayed,true);
    assert.equal(f.db.prepare('SELECT count(*) n FROM fx_command_receipts').get().n,1);
    assert.deepEqual(f.db.pragma('foreign_key_check'),[]);
  }finally{f.close();}
});

test('Arca retirement refuses a committed collection even if an old preview selected it',()=>{
  const f=fixture();
  try{
    const arca=seedArca(f);
    f.db.prepare("UPDATE arca_ondeck_runs SET state='committed' WHERE on_deck_run_id='on-deck'").run();
    assert.throws(()=>arca.store.commit(arca.request),{code:'ARCA_RETIREMENT_STALE'});
    const fresh={...arca.request,expectedSnapshotDigest:arca.store.inspect('offer','package').snapshotDigest};
    assert.throws(()=>arca.store.commit(fresh),{code:'ARCA_RETIREMENT_COMMITTED_PROTECTED'});
    assert.equal(f.db.prepare('SELECT state FROM arca_ondeck_custodies').get().state,'active');
    assert.equal(f.db.prepare('SELECT count(*) n FROM fx_command_receipts').get().n,0);
  }finally{f.close();}
});

test('a retired Offer cannot restart through delayed admission, reconciliation, recovery or manual retry',()=>{
  const f=fixture();
  try{
    const arca=seedArca(f);arca.store.commit(arca.request);
    const coordinator=createOnDeckProcessCoordinator({schemaManifest,unitOfWork:f.unitOfWork,contextReader:{},workResultReader:{}});
    const message={messageKind:'libra.product-offer.available@1',messageId:'message',dedupKey:'message',offerId:'offer',
      onDeckPackageId:'package',shelfId:'shelf',libraRunId:'run',subjectId:'subject',acceptanceSpecId:'spec',
      relatedDispositionSetDigest:D,packageRevision:1,packageDigest:D};
    const admission=coordinator.admitOffer(message);
    assert.equal(admission.kind,'administratively_retired');
    assert.equal(f.unitOfWork.execute([admission.admissionParticipant]).arca_retired_offer_consumption.offerId,'offer');
    assert.equal(coordinator.reconcileAcceptance('offer').kind,'administratively_retired');
    assert.equal(coordinator.reconcileOnDeck('on-deck').kind,'administratively_retired');
    assert.equal(coordinator.recoverOnDeck('on-deck').kind,'administratively_retired');
    assert.throws(()=>coordinator.retryAcceptance('offer'),{code:'ARCA_FORMATION_RETIRED'});
    assert.throws(()=>coordinator.admitOffer({...message,packageDigest:'b'.repeat(64)}),{code:'ARCA_RETIREMENT_PACKAGE_MISMATCH'});
    assert.equal(f.db.prepare('SELECT count(*) n FROM fx_supporting_works').get().n,0);
  }finally{f.close();}
});

test('retirement history is distinct from user cancellation and requires its durable evidence',()=>{
  const f=fixture();
  try{
    f.db.prepare(`INSERT INTO libra_formation_projections(subject_id,classification,subject_status,display_identity,
      next_action_label,next_action_state,attention_state,added_at_ms,updated_at_ms)
      VALUES ('subject','in_progress','active','Retired title','Waiting','pending','none',1,1)`).run();
    f.store.commit(request(f));
    const history=createFormationRunHistoryStore({schemaManifest,unitOfWork:f.unitOfWork});
    assert.equal(history.count(),1);
    const rows=history.listDiscarded(0,25);
    assert.equal(rows.length,1);assert.equal(rows[0].outcome,'administratively_retired');
    assert.equal(rows[0].label,'已重置整理任务');assert.equal(rows[0].libraRunId,null);
    f.db.prepare('DELETE FROM fx_commit_markers').run();
    assert.throws(()=>history.listDiscarded(0,25),{code:'FORMATION_RETIREMENT_HISTORY_INTEGRITY'});
  }finally{f.close();}
});

test('a Subject with a committed Season and an unfinished Run retires only the unfinished Run',()=>{
  const f=fixture();
  try{
    run(f,'collected','completed');const active=run(f,'new-run','active');
    f.db.prepare(`INSERT INTO libra_run_admission_heads(subject_id,head_revision,active_scope_set_digest,updated_at_ms)
      VALUES ('subject',1,?,1)`).run(activeRunScopeSetDigest('subject',[active]));
    f.db.prepare(`INSERT INTO libra_product_packages(on_deck_package_id,offer_id,package_revision,libra_run_id,run_state_revision,subject_id,
      product_structure_json,production_provenance_json,attestation_json,package_digest,state,published_at_ms)
      VALUES ('package','offer',1,'collected',1,'subject','{}','{}','{}',?,'published',1)`).run(D);
    const arca=seedArca(f);
    f.db.prepare("UPDATE arca_ondeck_runs SET state='committed' WHERE on_deck_run_id='on-deck'").run();
    f.db.prepare("UPDATE arca_ondeck_custodies SET state='committed' WHERE custody_id='custody'").run();
    f.db.prepare("INSERT INTO arca_shelf_entries(shelf_entry_id,status,created_at_ms) VALUES ('entry','active',1)").run();
    f.db.prepare(`INSERT INTO arca_ondeck_commit_receipts(receipt_id,on_deck_run_id,shelf_entry_id,inventory_revision,deck_fact_revision,commit_digest,committed_at_ms)
      VALUES ('commit','on-deck','entry',1,1,?,2)`).run(D);
    const protectedTables=['arca_ondeck_runs','arca_ondeck_custodies','arca_ondeck_commit_receipts','arca_shelf_entries','libra_product_packages'];
    const protectedRows=Object.fromEntries(protectedTables.map(table=>[table,f.db.prepare('SELECT * FROM '+table).all()]));
    const proof=[{offerId:'offer',packageId:'package',packageDigest:D,disposition:'committed',evidenceDigest:D}];
    const store=createFormationRetirementStore({schemaManifest,unitOfWork:f.unitOfWork,readArcaRetirementProof(packages){
      assert.deepEqual(packages,[{offerId:'offer',packageId:'package',packageDigest:D}]);return proof;}});
    const result=store.commit({...request(f),expectedArcaProofDigest:canonicalDigest(proof)});
    assert.equal(result.receipt.resultRef.retiredRunCount,1);
    assert.equal(f.db.prepare("SELECT state FROM libra_runs WHERE libra_run_id='collected'").get().state,'completed');
    for(const table of protectedTables)assert.deepEqual(f.db.prepare('SELECT * FROM '+table).all(),protectedRows[table]);
  }finally{f.close();}
});


test('Reset journal rejects a resealed out-of-order acknowledgement and rechecks completed Owner closure',async()=>{
  const f=fixture();
  try {
    let closed=true;
    const options={dataDir:f.root,assertAuthorized(){},verifyBackup(){},prepareRequest(){return {subjectId:'subject'};},
      commitStep(){return {done:true};},verifyCompleted(){if(!closed)throw Object.assign(new Error('closure changed'),{code:'TEST_CLOSURE_CHANGED'});return {closed:true};}};
    const journal=createRetirementJournal(options),resetId='formation-reset-journal-validation';
    journal.prepare({resetId,manifest:{subjectId:'subject'},backup:{backupId:'backup',backupDigest:D},steps:[{owner:'libra',subjectId:'subject'}]});
    const finished=await journal.execute(resetId);
    closed=false;await assert.rejects(journal.execute(resetId),{code:'TEST_CLOSURE_CHANGED'});closed=true;
    const {journalDigest,...payload}=finished;
    const changed={...payload,completed:payload.completed.map(row=>({...row,ordinal:2}))};
    fs.writeFileSync(path.join(f.root,'reset-journals',resetId+'.json'),JSON.stringify({...changed,journalDigest:canonicalDigest(changed)}));
    await assert.rejects(journal.execute(resetId),{code:'RESET_JOURNAL_CORRUPT'});
  }finally{f.close();}
});


test('Reset acknowledges an existing Handoff A through Procurement and replays a crash without changing acceptance history',async()=>{
  const f=fixture();let operator;
  try{
    const db=f.db,receiptId='accepted-receipt',processId='accepted-intake',offerId='accepted-offer';
    db.prepare("INSERT INTO proc_procurement_runs(procurement_run_id,state) VALUES ('proc','sealed')").run();
    db.prepare("INSERT INTO proc_candidate_packages(candidate_package_id,procurement_run_id,package_digest) VALUES ('package','proc',?)").run(D);
    db.prepare("INSERT INTO proc_candidate_deliveries(offer_id,candidate_package_id,package_revision,package_digest,acceptance_basis_digest,state) VALUES (?,'package',1,?,?,'open')").run(offerId,D,D);
    db.prepare("INSERT INTO proc_run_materials(procurement_run_id,ordinal,material_key,selection_state,candidate_package_id) VALUES ('proc',0,'material','candidate_delivery','package')").run();
    db.prepare("INSERT INTO libra_intake_decisions(intake_decision_id,decision_kind,target_subject_id,candidate_delivery_snapshot_schema_ref,candidate_delivery_snapshot_json,decision_identity_evidence_schema_ref,decision_identity_evidence_json,decision_identity_evidence_digest) VALUES (?,'accepted_resolution','subject','fixture','{}','fixture','{}',?)").run(processId,D);
    db.prepare("INSERT INTO libra_handoff_a_receipts(receipt_id,intake_decision_id,outcome,offer_id,candidate_package_id,package_revision,package_digest,subject_id,subject_intake_revision,receipt_digest) VALUES (?,?,'accepted',?,'package',1,?,'subject',1,?)").run(receiptId,processId,offerId,D,D);
    const payload={schemaRef:'helix://contracts/types/LibraCandidateAcceptedMessage/v1',schemaVersion:1,messageKind:'libra_candidate_accepted',
      offerId,candidatePackageId:'package',packageRevision:1,packageDigest:D,intakeDecisionId:processId,subjectId:'subject',subjectIntakeRevision:1,receiptId,receiptDigest:D};
    const dedupKey='libra_candidate_accepted:'+offerId,messageId=canonicalDigest({schema:'foundation.outbox-message-id@1',producerDomain:'libra',dedupKey});
    db.prepare("INSERT INTO fx_outbox(message_id,producer_domain,message_kind,dedup_key,payload_schema_ref,payload_json,payload_digest) VALUES (?,'libra','libra_candidate_accepted',?,?,?,?)").run(messageId,dedupKey,payload.schemaRef,JSON.stringify(payload),canonicalDigest(payload));
    db.prepare('UPDATE fx_outbox SET consumer_set_digest=?,intended_consumer_count=1 WHERE message_id=?').run(canonicalDigest(['procurement']),messageId);
    db.prepare("INSERT INTO fx_outbox_deliveries(message_id,consumer_domain,state,attempt_count,next_attempt_at_ms) VALUES (?,'procurement','pending',0,0)").run(messageId);
    const history=db.prepare('SELECT * FROM libra_handoff_a_receipts').all();
    db.prepare('UPDATE fx_outbox SET payload_digest=? WHERE message_id=?').run('b'.repeat(64),messageId);
    assert.ok(inspectRetirementPlan(db).blockers.some(row=>row.code==='RESET_ACCEPTANCE_ACK_UNPROVEN'));
    db.prepare('UPDATE fx_outbox SET payload_digest=? WHERE message_id=?').run(canonicalDigest(payload),messageId);
    const plan=inspectRetirementPlan(db);assert.equal(plan.acceptanceClosures.length,1);assert.deepEqual(plan.blockers,[]);
    let crash=true;const resetId='formation-reset-acceptance-ack',options={dataDir:f.root,verifyBackup(){},
      afterCommit(step){if(crash&&step.owner==='procurement_acceptance')throw Error('acceptance committed before journal');}};
    operator=createFormationRetirementOperator(options);
    operator.prepare({resetId,expectedPlanDigest:plan.planDigest,previewDigest:D,backup:{backupId:'backup',backupDigest:D}});
    fs.mkdirSync(path.join(f.root,'operator-runtime'));writeAtomic(path.join(f.root,'operator-runtime','intent.json'),{
      schema:'shelfdeck.runtime-intent@1',desiredMode:'stopped',revision:1,pendingReset:{operationId:'operation',resetId,previewDigest:D,backupId:'backup',backupDigest:D}});
    await assert.rejects(operator.execute(resetId),/acceptance committed before journal/);
    assert.equal(db.prepare('SELECT state FROM proc_candidate_deliveries').get().state,'accepted');
    operator.close();operator=null;crash=false;operator=createFormationRetirementOperator(options);
    const result=await operator.execute(resetId);assert.equal(result.state,'completed');
    assert.equal(result.completed.find(row=>row.result.closure).result.replayed,true);
    assert.deepEqual(db.prepare('SELECT * FROM libra_handoff_a_receipts').all(),history);
    assert.equal(db.prepare("SELECT count(*) n FROM fx_inbox WHERE consumer_domain='procurement'").get().n,1);
    db.prepare("UPDATE proc_run_materials SET terminal_evidence_digest=?").run('b'.repeat(64));
    await assert.rejects(operator.execute(resetId),{code:'RESET_CLOSURE_INCOMPLETE'});
  }catch(error){assert.fail(error.stack||error.message);}finally{operator?.close();f.close();}
});


test('Arca retirement proof refuses a custody flag and Commit row without actual Inventory history',()=>{
  const f=fixture();try{
    const arca=seedArca(f);
    f.db.prepare("UPDATE arca_ondeck_runs SET state='committed'").run();
    f.db.prepare("UPDATE arca_ondeck_custodies SET state='committed'").run();
    f.db.prepare("INSERT INTO arca_shelf_entries(shelf_entry_id,status,created_at_ms) VALUES ('entry','active',1)").run();
    f.db.prepare("INSERT INTO arca_ondeck_commit_receipts(receipt_id,on_deck_run_id,shelf_entry_id,inventory_revision,deck_fact_revision,commit_digest,committed_at_ms) VALUES ('commit','on-deck','entry',1,1,?,2)").run(D);
    assert.throws(()=>arca.store.readRetirementProof([{offerId:'offer',packageId:'package',packageDigest:D}]),{code:'ARCA_RETIREMENT_PROOF_PENDING'});
    assert.equal(f.db.prepare('SELECT count(*) n FROM fx_command_receipts').get().n,0);
  }finally{f.close();}
});


test('Operator cancels only frozen open Work and still rejects a new responsibility in an omitted scope',async()=>{
  const f=fixture();let operator;
  try{
    run(f,'history','discarded');
    f.db.prepare("INSERT INTO libra_formation_projections(subject_id,classification,subject_status,display_identity,next_action_label,next_action_state,attention_state,added_at_ms,updated_at_ms) VALUES ('subject','in_progress','active','History','Waiting','pending','none',1,1)").run();
    f.db.prepare("INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,definition_json,state) VALUES ('open-routing','libra','libra_routing','subject','{}','blocked')").run();
    const plan=inspectRetirementPlan(f.db),resetId='formation-reset-open-work-only';
    assert.ok(plan.processScopes.length>plan.works.length);
    operator=createFormationRetirementOperator({dataDir:f.root,verifyBackup(){}});
    const record=operator.prepare({resetId,expectedPlanDigest:plan.planDigest,previewDigest:D,backup:{backupId:'backup',backupDigest:D}});
    assert.deepEqual(record.steps.filter(row=>row.owner==='execution').map(row=>row.scope),[{ownerDomain:'libra',processType:'libra_routing',processId:'subject'}]);
    assert.deepEqual(record.manifest.plan.processScopes,plan.processScopes);
    f.db.prepare("INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,definition_json,state) VALUES ('late-spec','libra','libra_acceptance_spec','subject','{}','blocked')").run();
    fs.mkdirSync(path.join(f.root,'operator-runtime'));
    writeAtomic(path.join(f.root,'operator-runtime','intent.json'),{schema:'shelfdeck.runtime-intent@1',desiredMode:'stopped',revision:1,
      pendingReset:{operationId:'operation',resetId,previewDigest:D,backupId:'backup',backupDigest:D}});
    await assert.rejects(operator.execute(resetId),{code:'LIBRA_RETIREMENT_EXECUTION_PENDING'});
    assert.equal(f.db.prepare("SELECT state FROM fx_supporting_works WHERE work_id='open-routing'").get().state,'cancelled');
    assert.equal(f.db.prepare("SELECT state FROM fx_supporting_works WHERE work_id='late-spec'").get().state,'blocked');
    assert.equal(f.db.prepare("SELECT status FROM libra_subjects WHERE subject_id='subject'").get().status,'active');
    assert.equal(operator.read(resetId).state,'executing');
  }finally{operator?.close();f.close();}
});
