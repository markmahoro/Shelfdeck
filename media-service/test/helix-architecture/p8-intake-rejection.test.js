'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const Database=require('better-sqlite3');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {buildIntakeRejectionDecision,normalizeReasons}=require('../../src/helix/domains/libra/model/intake-rejection-contracts');
const {createIntakeRejectionStore}=require('../../src/helix/domains/libra/persistence/intake-rejection-store');
const {createCandidateRejectionConsumer}=require('../../src/helix/domains/procurement/application/candidate-rejection-consumer');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const generatedRoot=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated');
const schemaDdl=fs.readFileSync(path.join(generatedRoot,'clean-schema.sql'),'utf8');
const schemaManifest=JSON.parse(fs.readFileSync(path.join(generatedRoot,'clean-schema.manifest.json'),'utf8'));
const D=(value)=>canonicalDigest({value});
const without=(value,...fields)=>Object.fromEntries(Object.entries(value).filter(([key])=>!fields.includes(key)));

function snapshot(){
  const candidatePackage={candidatePackageId:'candidate-1',packageRevision:1,packageDigest:D('package'),
    materialFieldContextRef:{fieldId:'field-1',accessRevision:1,contextDigest:D('field-context')},contentProfile:'movie',
    identityClaim:{claimDigest:D('identity-claim')},relatedDispositionScopeDigest:D('related-disposition')};
  const acceptanceBasis={acceptanceBasisDigest:D('basis')};
  const offer={offerId:'offer-1',candidatePackageId:candidatePackage.candidatePackageId,packageRevision:1,
    packageDigest:candidatePackage.packageDigest,acceptanceBasisDigest:acceptanceBasis.acceptanceBasisDigest};
  const value={snapshotContract:'CandidateDeliverySnapshot@1',offer,acceptanceBasis,candidatePackage,
    primaryInputManifest:{manifestId:'manifest-1',structureKind:'single'},primaryMaterialDeliveries:[],deliveryMemberSetDigest:D('members'),deliverySnapshotDigest:''};
  value.deliverySnapshotDigest=canonicalDigest(without(value,'deliverySnapshotDigest'));
  return value;
}
function reasons(){return [
  {reasonCode:'candidate_material_unreadable',evidenceRefs:[{evidenceSchemaRef:'helix://contracts/types/IntakeMaterialVerification/v1',evidenceId:'verify-2',evidenceDigest:D('unreadable')}]},
  {reasonCode:'candidate_contract_invalid',evidenceRefs:[{evidenceSchemaRef:'helix://contracts/types/CandidateContractVerification/v1',evidenceId:'verify-1',evidenceDigest:D('contract')}]}
];}
function request(){
  const deliverySnapshot=snapshot(),decidedAtMs=1_700_080_000_000;
  const decision=buildIntakeRejectionDecision({deliverySnapshot,reasons:reasons(),decidedAtMs});
  return {deliverySnapshot,reasons:reasons(),decidedAtMs,domainFactCommitHandle:{
    schemaRef:'helix://contracts/types/DomainFactCommitHandle/v1',schemaVersion:1,handleId:'reject-handle-1',ownerDomain:'libra',
    aggregateType:'intake_decision',aggregateId:decision.intakeDecisionId,factType:'IntakeRejectionDecision',
    factSchemaRef:'helix://contracts/domain-types/IntakeRejectionDecision/v1',expectedRevision:0,payloadDigest:decision.decisionDigest,
    resultSchemaRef:'helix://contracts/types/IntakeRejectionReceipt/v1',commitIdempotencyKey:'reject-offer-1',eventFenceDigest:D('fence')},
    commitMarker:{commitMarker:'reject-marker-1',commitDigest:D('commit')},
    resultBinding:{resultId:'reject-result-1',eventId:'reject-event-1',
      evidenceSchemaRef:'helix://contracts/types/IntakeRejectionReceipt/v1',
      evidence:{schemaRef:'helix://contracts/types/IntakeRejectionReceipt/v1',schemaVersion:1,evidenceKind:'intake_rejection_commit'},
      effectReceiptId:'reject-effect-receipt-1'}};
}
function fixture(run){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-intake-rejection-')),databasePath=path.join(root,'shelfdeck.db'); let now=1_700_080_001_000;
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>now++});
  try{return run({databasePath,kernel,unitOfWork:createSqliteUnitOfWork({kernel})});}
  finally{kernel.close();fs.rmSync(root,{recursive:true,force:true});}
}
function seedEvent(databasePath){const db=new Database(databasePath);db.prepare('INSERT INTO fx_workflow_events(event_id) VALUES(?)').run('reject-event-1');db.close();}
function seedDelivery(databasePath,message){
  const db=new Database(databasePath);db.pragma('foreign_keys = OFF');
  db.prepare(`INSERT INTO proc_candidate_deliveries(offer_id,candidate_package_id,package_revision,package_digest,acceptance_basis_digest,state,
    offered_at_ms) VALUES(?,?,?,?,?,?,?)`).run(message.offerId,message.candidatePackageId,message.packageRevision,message.packageDigest,message.acceptanceBasisDigest,'open',1);
  for(const [ordinal,key] of ['material-a','material-b'].entries())db.prepare(`INSERT INTO proc_run_materials(procurement_run_id,ordinal,material_key,
    binding_revision,admitted_control_revision,admitted_control_projection_digest,selection_state,candidate_package_id,reservation_updated_at_ms)
    VALUES(?,?,?,?,?,?,?,?,?)`).run('run-1',ordinal,key,1,1,D(`control-${key}`),'candidate_delivery',message.candidatePackageId,1);
  db.pragma('foreign_keys = ON');db.close();
}

test('normalizes closed rejection reasons by precedence and typed Evidence',()=>{
  const normalized=normalizeReasons(reasons());
  assert.deepEqual(normalized.map((item)=>item.reasonCode),['candidate_contract_invalid','candidate_material_unreadable']);
  assert.throws(()=>normalizeReasons([{reasonCode:'candidate_material_unreadable',evidenceRefs:[{evidenceSchemaRef:'wrong',evidenceId:'x',evidenceDigest:D('x')}]}]),
    (error)=>error.code==='P8_REJECTION_EVIDENCE');
});

test('commits Decision, relationized reasons, Receipt, Result, marker and Outbox atomically without Subject or Control writes',()=>fixture(({databasePath,unitOfWork})=>{
  seedEvent(databasePath);const store=createIntakeRejectionStore({schemaManifest,unitOfWork}),input=request();
  assert.deepEqual(store.repositoryManifest.libraTableIds,['libra_handoff_a_receipts','libra_intake_decisions','libra_intake_rejection_reason_evidence']);
  assert.deepEqual(store.repositoryManifest.foundationTableIds,['fx_commit_markers','fx_event_result_bindings','fx_outbox','fx_outbox_deliveries']);
  const committed=store.reject(input);assert.equal(committed.replayed,false);assert.equal(committed.decision.structuredRejection.primaryRejectionCode,'candidate_contract_invalid');
  const replay=store.reject(input);assert.equal(replay.replayed,true);assert.deepEqual(replay.decision,committed.decision);assert.deepEqual(replay.receipt,committed.receipt);
  const db=new Database(databasePath,{readonly:true});
  assert.equal(db.prepare('SELECT COUNT(*) count FROM libra_intake_rejection_reason_evidence').get().count,2);
  assert.deepEqual(db.prepare('SELECT decision_kind,target_subject_id,expected_continuity_head_revision FROM libra_intake_decisions').get(),
    {decision_kind:'rejected_acceptance',target_subject_id:null,expected_continuity_head_revision:null});
  for(const table of ['libra_subjects','libra_material_bindings','fx_material_control_revisions'])assert.equal(db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count,0,table);
  const outbox=db.prepare('SELECT producer_domain,message_kind,dedup_key,consumer_set_digest,payload_schema_ref,payload_json,payload_digest FROM fx_outbox').get();
  assert.equal(outbox.producer_domain,'libra');assert.equal(outbox.message_kind,'libra_candidate_rejected');
  assert.equal(outbox.consumer_set_digest,canonicalDigest(['procurement']));
  assert.equal(outbox.payload_digest,canonicalDigest(JSON.parse(outbox.payload_json)));db.close();
}));

test('rolls back the complete rejected transaction when Outbox insert crashes',()=>fixture(({databasePath,unitOfWork})=>{
  seedEvent(databasePath);const db=new Database(databasePath);db.exec("CREATE TRIGGER fail_reject_outbox BEFORE INSERT ON fx_outbox BEGIN SELECT RAISE(ABORT,'injected'); END");db.close();
  assert.throws(()=>createIntakeRejectionStore({schemaManifest,unitOfWork}).reject(request()));
  const check=new Database(databasePath,{readonly:true});for(const table of ['libra_intake_decisions','libra_intake_rejection_reason_evidence',
    'libra_handoff_a_receipts','fx_event_result_bindings','fx_commit_markers','fx_outbox','fx_outbox_deliveries'])assert.equal(check.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count,0,table);check.close();
}));

test('Procurement consumes the exact rejected projection atomically and replays from terminal owner rows plus Inbox',()=>fixture(({databasePath,unitOfWork})=>{
  seedEvent(databasePath);const committed=createIntakeRejectionStore({schemaManifest,unitOfWork}).reject(request()),message=committed.outbox.message;
  seedDelivery(databasePath,message);const consumer=createCandidateRejectionConsumer({schemaManifest,unitOfWork});
  assert.deepEqual(consumer.repositoryManifest.procurementTableIds,['proc_candidate_deliveries','proc_run_materials']);
  assert.deepEqual(consumer.repositoryManifest.foundationTableIds,['fx_inbox']);
  const envelope={messageId:committed.outbox.messageId,dedupKey:committed.outbox.dedupKey,producerDomain:'libra',consumerDomain:'procurement',
    payloadSchemaRef:message.schemaRef,payloadDigest:canonicalDigest(message),payload:message};
  const first=consumer.consume(envelope);assert.equal(first.replayed,false);assert.equal(first.closure.releasedMaterialCount,2);
  const replay=consumer.consume(envelope);assert.equal(replay.replayed,true);assert.deepEqual(replay.closure,first.closure);
  const db=new Database(databasePath,{readonly:true});
  assert.deepEqual(db.prepare('SELECT state,handoff_decision_id,handoff_receipt_id,terminal_evidence_digest FROM proc_candidate_deliveries').get(),
    {state:'rejected',handoff_decision_id:message.intakeDecisionId,handoff_receipt_id:message.receiptId,terminal_evidence_digest:message.receiptDigest});
  assert.equal(db.prepare("SELECT COUNT(*) count FROM proc_run_materials WHERE selection_state='released' AND terminal_disposition='handoff_rejected' AND terminal_evidence_digest=?").get(message.receiptDigest).count,2);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM fx_material_control_revisions').get().count,0);db.close();
}));
