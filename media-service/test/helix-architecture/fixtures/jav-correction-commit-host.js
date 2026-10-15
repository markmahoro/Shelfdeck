'use strict';
const assert=require('node:assert/strict');
const {canonicalDigest,canonicalJson}=require('../../../src/helix/contracts/canonical-json');
const {createJavCorrectionCommitStore}=require('../../../src/helix/domains/arca/persistence/jav-correction-commit-store');
const {CAPABILITY}=require('../../../src/helix/domains/arca/model/jav-correction-commit-contract');
function verifyAtomicCommit({options,db,preparedInventory}) {
  const p=preparedInventory,workId='correction-commit-fixture-work',eventId='correction-commit-fixture-event',attemptId='correction-commit-fixture-event-attempt';
  db.prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,state,idempotency_key,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(workId,'arca','arca_jav_identity_correction',p.record.correctionId,'jav_correction_commit',p.scope.digest,'normal','running','fixture-commit',1,1);
  db.prepare('INSERT INTO fx_work_attempts(attempt_id,work_id,ordinal,basis_digest,state,started_at_ms) VALUES(?,?,?,?,?,?)').run('correction-commit-fixture-attempt',workId,1,p.scope.digest,'running',1);
  db.prepare('INSERT INTO fx_workflow_plans(plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('correction-commit-fixture-plan','correction-commit-fixture-attempt','fixture',1,canonicalDigest('catalog'),p.scope.digest,canonicalDigest('graph'),'planned',1);
  db.prepare('INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class,ready_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(eventId,'correction-commit-fixture-plan','node',workId,'correction-commit-fixture-attempt','arca',CAPABILITY,1,'executing','normal',1);
  db.prepare('INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,executor_ref,executor_version,input_snapshot_schema_ref,input_snapshot_digest,fence_snapshot_digest,state,started_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(attemptId,eventId,1,CAPABILITY,1,'helix://test/input/v1',canonicalDigest('input'),canonicalDigest('fence'),'executing',1);
  const execution={workId,eventId,eventAttemptId:attemptId,capabilityRef:CAPABILITY,idempotencyKey:'fixture-commit-event',
    ownerScope:{domain:'arca',processType:'arca_jav_identity_correction',processId:p.record.correctionId},namedInputs:{javCorrectionScope:p.scope}},
    originalCommitBefore=db.prepare('SELECT * FROM arca_ondeck_commit_receipts').all(),store=createJavCorrectionCommitStore(options),tables=['arca_jav_identity_corrections','arca_shelf_entries','arca_canonical_identity_revisions','arca_inventory_representations',
      'arca_inventory_materials','arca_inventory_related_references','arca_inventory_product_facts','arca_inventory_person_relations','fx_material_controls','fx_material_control_revisions',
      'fx_event_result_bindings','fx_commit_markers'],snapshot=()=>Object.fromEntries(tables.map(table=>[table,db.prepare('SELECT * FROM '+table).all()])),before=snapshot();
  db.exec("CREATE TRIGGER fail_correction_identity BEFORE INSERT ON arca_canonical_identity_revisions WHEN NEW.revision=2 BEGIN SELECT RAISE(ABORT,'correction-identity-fault'); END");
  assert.throws(()=>store.commit(execution,p),/correction-identity-fault/);assert.deepEqual(snapshot(),before);db.exec('DROP TRIGGER fail_correction_identity');
  db.exec("CREATE TRIGGER fail_correction_result BEFORE INSERT ON fx_event_result_bindings WHEN NEW.event_id='correction-commit-fixture-event' BEGIN SELECT RAISE(ABORT,'correction-result-fault'); END");
  assert.throws(()=>store.commit(execution,p),/correction-result-fault/);assert.deepEqual(snapshot(),before);db.exec('DROP TRIGGER fail_correction_result');
  db.prepare("UPDATE fx_event_attempts SET state='completed' WHERE event_attempt_id=?").run(attemptId);
  const expired=snapshot();assert.throws(()=>store.commit(execution,p),{code:'ARCA_JAV_CORRECTION_COMMIT_INTEGRITY'});assert.deepEqual(snapshot(),expired);
  db.prepare("UPDATE fx_event_attempts SET state='executing' WHERE event_attempt_id=?").run(attemptId);
  const committed=store.commit(execution,p),after=snapshot();assert.equal(committed.result.newInventoryRevision,p.change.newInventoryRevision);
  assert.equal(committed.result.newCanonicalIdentityRevision,p.change.newCanonicalIdentityRevision);
  assert.equal(db.prepare('SELECT state FROM arca_jav_identity_corrections WHERE correction_id=?').get(p.record.correctionId).state,'committed');
  assert.equal(db.prepare('SELECT cleanup_state FROM arca_jav_identity_corrections WHERE correction_id=?').get(p.record.correctionId).cleanup_state,'pending');
  const controls=require('../../../src/helix/foundation/persistence/material-control').createMaterialControlProjectionPort(options),
    offdeck=require('../../../src/helix/domains/arca/persistence/offdeck-store').createOffdeckStore(options);
  assert.throws(()=>offdeck.createReview({shelfEntryId:p.record.shelfEntryId,originKind:'direct_intent',actorId:'admin',idempotencyKey:'post-commit-cleanup-offdeck'},
    keys=>controls.getMaterialControlProjections(keys)),{code:'ARCA_JAV_CORRECTION_BUSY'});
  assert.equal(db.prepare('SELECT count(*) n FROM arca_offdeck_reviews').get().n,0);
  assert.equal(db.prepare('SELECT provider_key FROM arca_canonical_identity_revisions WHERE revision=2').get().provider_key,'IPX-178');
  assert.deepEqual(store.commit(execution,p),committed);assert.deepEqual(snapshot(),after);
  const originalCommit=db.prepare('SELECT * FROM arca_ondeck_commit_receipts').all();assert.equal(originalCommit.length,1);
  assert.deepEqual(originalCommit,originalCommitBefore);
  assert.equal(db.prepare('SELECT count(*) n FROM arca_aftercare_inventory_commits').get().n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM arca_inventory_person_relations WHERE inventory_revision=?').get(p.change.newInventoryRevision).n,p.cast.relationCount);
  const castRow=db.prepare("SELECT fact_json FROM arca_inventory_product_facts WHERE inventory_revision=? AND fact_kind='media_cast'").get(p.change.newInventoryRevision),
    castRows=db.prepare('SELECT * FROM arca_inventory_person_relations WHERE inventory_revision=?').all(p.change.newInventoryRevision);
  assert.deepEqual(require('../../../src/helix/domains/arca/model/jav-correction-stored-facts').restoreCastRecord(JSON.parse(castRow.fact_json),castRows),p.cast);
  assert.throws(()=>store.commit({...execution,ownerScope:{...execution.ownerScope,processId:'foreign'}},p),{code:'ARCA_JAV_CORRECTION_COMMIT_INTEGRITY'});
  assert.deepEqual(snapshot(),after);
  assert.equal(db.prepare('SELECT count(*) n FROM fx_event_result_bindings WHERE event_id=?').get(eventId).n,1);
  const stored=db.prepare('SELECT result_json FROM fx_event_result_bindings WHERE event_id=?').get(eventId).result_json;
  assert.equal(stored,canonicalJson(committed.result));
  const restored=store.readCommitted(p.record.correctionId);
  assert.deepEqual(restored.commit,committed);assert.deepEqual(restored.committedContext.filePlan,p.plan);assert.deepEqual(restored.committedContext.stagedRecord,p.stageRecord);
  const contextBefore=db.prepare('SELECT committed_context_json,committed_context_digest FROM arca_jav_identity_corrections WHERE correction_id=?').get(p.record.correctionId);
  db.prepare('UPDATE arca_jav_identity_corrections SET committed_context_digest=? WHERE correction_id=?').run(canonicalDigest('tampered-context'),p.record.correctionId);
  assert.throws(()=>store.readCommitted(p.record.correctionId),{code:'ARCA_JAV_CORRECTION_COMMIT_INTEGRITY'});
  db.prepare('UPDATE arca_jav_identity_corrections SET committed_context_digest=? WHERE correction_id=?').run(contextBefore.committed_context_digest,p.record.correctionId);
  for(const [field,value] of [['workId','foreign-work'],['eventId','foreign-event'],['eventAttemptId','foreign-attempt'],['idempotencyKey','foreign-key']]){
    const changed=JSON.parse(contextBefore.committed_context_json);changed.commitReference[field]=value;
    const {contextDigest:ignored,...body}=changed;changed.contextDigest=canonicalDigest(body);
    db.prepare('UPDATE arca_jav_identity_corrections SET committed_context_json=?,committed_context_digest=? WHERE correction_id=?').run(canonicalJson(changed),changed.contextDigest,p.record.correctionId);
    assert.throws(()=>store.readCommitted(p.record.correctionId),{code:'ARCA_JAV_CORRECTION_COMMIT_INTEGRITY'});
    db.prepare('UPDATE arca_jav_identity_corrections SET committed_context_json=?,committed_context_digest=? WHERE correction_id=?').run(contextBefore.committed_context_json,contextBefore.committed_context_digest,p.record.correctionId);
  }
  assert.deepEqual(snapshot(),after);return committed;
}
module.exports={verifyAtomicCommit};
