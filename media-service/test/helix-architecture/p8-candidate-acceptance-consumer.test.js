'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const Database=require('better-sqlite3');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {buildLibraCandidateAcceptedMessage}=require('../../src/helix/domains/libra/model/intake-acceptance-contracts');
const {createCandidateAcceptanceConsumer}=require('../../src/helix/domains/procurement/application/candidate-acceptance-consumer');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const generatedRoot=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated');
const schemaDdl=fs.readFileSync(path.join(generatedRoot,'clean-schema.sql'),'utf8');
const schemaManifest=JSON.parse(fs.readFileSync(path.join(generatedRoot,'clean-schema.manifest.json'),'utf8'));
const D=(value)=>canonicalDigest({value});
const without=(value,...fields)=>Object.fromEntries(Object.entries(value).filter(([key])=>!fields.includes(key)));

function acceptedMessage(){
  const receipt={schemaRef:'helix://contracts/types/SubjectAndTransferReceipt/v1',schemaVersion:1,receiptId:'receipt-a',receiptKind:'handoff_a_accepted',
    ownerDomain:'libra',scopeType:'intake_decision',scopeId:'decision-a',scopeDigest:D('payload'),effectReceiptRef:null,committedAtMs:2,
    intakeDecisionId:'decision-a',offerId:'offer-a',candidatePackageId:'candidate-a',packageRevision:1,packageDigest:D('package'),
    candidateDeliverySnapshotDigest:D('snapshot'),subjectId:'subject-a',subjectIntakeRevision:1,subjectContinuityHeadRevision:1,
    subjectContinuitySetDigest:D('continuity'),subjectEpisodeScopeDigest:D('episodes'),libraBindingSetDigest:D('bindings'),
    controlRevisionSetDigest:D('controls'),receiptDigest:''};
  receipt.receiptDigest=canonicalDigest(without(receipt,'receiptDigest'));return buildLibraCandidateAcceptedMessage(receipt);
}
function fixture(run){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-candidate-acceptance-')),databasePath=path.join(root,'shelfdeck.db');let now=10;
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>now++});
  try{return run({databasePath,unitOfWork:createSqliteUnitOfWork({kernel})});}finally{kernel.close();fs.rmSync(root,{recursive:true,force:true});}
}
function seed(databasePath,message){
  const db=new Database(databasePath);db.pragma('foreign_keys = OFF');
  db.prepare(`INSERT INTO proc_candidate_deliveries(offer_id,candidate_package_id,package_revision,package_digest,acceptance_basis_digest,state,offered_at_ms)
    VALUES(?,?,?,?,?,'open',1)`).run(message.offerId,message.candidatePackageId,message.packageRevision,message.packageDigest,D('basis'));
  for(const [ordinal,key] of ['material-b','material-a'].entries())db.prepare(`INSERT INTO proc_run_materials(procurement_run_id,ordinal,material_key,
    binding_revision,admitted_control_revision,admitted_control_projection_digest,selection_state,candidate_package_id,reservation_updated_at_ms)
    VALUES('run-a',?,?,?,?,?,'candidate_delivery',?,1)`).run(ordinal,key,1,1,D(key),message.candidatePackageId);
  db.pragma('foreign_keys = ON');db.close();
}
function envelope(message){const dedupKey='libra_candidate_accepted:'+message.offerId;return {
  messageId:canonicalDigest({schema:'foundation.outbox-message-id@1',producerDomain:'libra',dedupKey}),dedupKey,
  producerDomain:'libra',consumerDomain:'procurement',payloadSchemaRef:message.schemaRef,payloadDigest:canonicalDigest(message),payload:message};}

test('Procurement atomically consumes accepted Receipt, transfers the exact Reservation set, and replays',()=>fixture(({databasePath,unitOfWork})=>{
  const message=acceptedMessage();seed(databasePath,message);const consumer=createCandidateAcceptanceConsumer({schemaManifest,unitOfWork});
  assert.deepEqual(consumer.repositoryManifest.procurementTableIds,['proc_candidate_deliveries','proc_run_materials']);
  assert.deepEqual(consumer.repositoryManifest.foundationTableIds,['fx_inbox']);
  const first=consumer.consume(envelope(message));assert.equal(first.replayed,false);assert.equal(first.closure.transferredMaterialCount,2);
  const replay=consumer.consume(envelope(message));assert.equal(replay.replayed,true);assert.deepEqual(replay.closure,first.closure);
  const db=new Database(databasePath,{readonly:true});
  assert.deepEqual(db.prepare('SELECT state,handoff_decision_id,handoff_decision_digest,handoff_receipt_id,terminal_evidence_digest FROM proc_candidate_deliveries').get(),
    {state:'accepted',handoff_decision_id:message.intakeDecisionId,handoff_decision_digest:null,handoff_receipt_id:message.receiptId,terminal_evidence_digest:message.receiptDigest});
  assert.equal(db.prepare("SELECT COUNT(*) count FROM proc_run_materials WHERE selection_state='transferred' AND terminal_disposition='handoff_accepted' AND terminal_evidence_digest=?").get(message.receiptDigest).count,2);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM fx_material_control_revisions').get().count,0);db.close();
}));

test('accepted consume rolls back Delivery and every member when Inbox persistence crashes',()=>fixture(({databasePath,unitOfWork})=>{
  const message=acceptedMessage();seed(databasePath,message);const db=new Database(databasePath);
  db.exec("CREATE TRIGGER fail_accept_inbox BEFORE INSERT ON fx_inbox BEGIN SELECT RAISE(ABORT,'injected'); END");db.close();
  assert.throws(()=>createCandidateAcceptanceConsumer({schemaManifest,unitOfWork}).consume(envelope(message)));
  const check=new Database(databasePath,{readonly:true});assert.equal(check.prepare("SELECT COUNT(*) count FROM proc_candidate_deliveries WHERE state='open'").get().count,1);
  assert.equal(check.prepare("SELECT COUNT(*) count FROM proc_run_materials WHERE selection_state='candidate_delivery'").get().count,2);
  assert.equal(check.prepare('SELECT COUNT(*) count FROM fx_inbox').get().count,0);check.close();
}));
