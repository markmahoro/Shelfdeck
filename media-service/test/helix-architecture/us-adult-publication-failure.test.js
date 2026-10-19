'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./fixtures/us-adult-actor-refresh-store-context');
const {canonicalDigest:D,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {phaseWork}=require('../../src/helix/domains/arca/model/us-adult-actor-pipeline');
test('Actor failure closure atomically rechecks its actual failed publication and preserves the old Case on unresolved Effects',t=>{
  const f=fixture(t),s=f.services(),admitted=s.command.request('entry',f.request,'admin');
  s.care.admitCase(admitted.aftercareCaseId);
  const care=s.care.getCase(admitted.aftercareCaseId),intent=s.store.get(admitted.intentId).intent,work=phaseWork(intent,care,'publish',[]),
    code='ARCA_US_ADULT_TARGET_CONFLICT',evidence={diagnostics:{schema:'arca.actor-publication-precondition@1',aftercareCaseId:care.aftercareCaseId,
      intentDigest:intent.intentDigest,workId:work.workId,eventId:'failed-event',planDigest:D('plan'),errorCode:code,effectWriteStarted:false,boundary:'before_publication'}},
    failure={eventId:'failed-event',code,evidenceDigest:D(evidence),evidence},binding={work,failure},
    digest=D({schema:'arca.actor-prepublication-terminal@1',workId:work.workId,aftercareCaseId:care.aftercareCaseId,
      intentDigest:intent.intentDigest,failureEvidenceDigest:failure.evidenceDigest}),
    close=()=>s.care.terminateCase(care.aftercareCaseId,'unresolved',code,digest,null,binding);
  f.db.prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,state,basis_digest,definition_schema_ref,definition_json,definition_digest) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(work.workId,'arca','arca_shelf_entry','entry',work.workKind,'failed',intent.intentDigest,work.schemaRef,canonicalJson(work),D(work));
  f.db.prepare('INSERT INTO fx_workflow_events(event_id,work_id,owner_domain,capability_ref,state,result_id) VALUES(?,?,?,?,?,?)')
    .run('failed-event',work.workId,'arca','arca.us_adult.files.publish@1','failed',null);
  f.db.prepare('INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,state,outcome_kind,failure_class,failure_code,evidence_digest) VALUES(?,?,?,?,?,?,?,?)')
    .run('failed-attempt','failed-event',1,'completed','failed','placement_precondition',code,failure.evidenceDigest);
  f.db.prepare('INSERT INTO fx_effect_journal(effect_id,event_attempt_id,effect_class,state) VALUES(?,?,?,?)')
    .run('failed-effect','failed-attempt','material_commit','failed');
  for(const [column,value,original] of [['state','reconcile_required','failed'],['effect_class','workspace_write','material_commit']]){
    f.db.prepare('UPDATE fx_effect_journal SET '+column+'=? WHERE effect_id=?').run(value,'failed-effect');
    assert.throws(close,{code:'ARCA_US_ADULT_FAILURE_CLOSURE_UNPROVEN'});
    assert.deepEqual(s.care.getCase(care.aftercareCaseId),care,'Late Foundation rejection rolls back the Owner terminal write.');
    f.db.prepare('UPDATE fx_effect_journal SET '+column+'=? WHERE effect_id=?').run(original,'failed-effect');
  }
  const forged=structuredClone(binding);forged.failure.evidence.diagnostics.effectWriteStarted=true;
  forged.failure.evidenceDigest=D(forged.failure.evidence);
  assert.throws(()=>s.care.terminateCase(care.aftercareCaseId,'unresolved',code,digest,null,forged),{code:'ARCA_US_ADULT_FAILURE_CLOSURE_UNPROVEN'});
  assert.equal(close().state,'unresolved');assert.equal(close().state,'unresolved');
  assert.equal(s.command.request('entry',f.request,'admin').state,'unresolved');
  const next=s.command.request('entry',{...f.request,idempotencyKey:'explicit-new-user-intent'},'admin');
  assert.notEqual(next.aftercareCaseId,care.aftercareCaseId);assert.equal(next.state,'queued');
  f.db.prepare('INSERT INTO arca_inventory_representations VALUES(?,?,?,?,?)').run('entry',3,D('later inventory'),'package',10001);
  f.db.prepare('UPDATE arca_shelf_entries SET current_inventory_revision=3 WHERE shelf_entry_id=?').run('entry');
  assert.equal(close().state,'unresolved','An exact terminal replay precedes later Inventory changes.');
  assert.equal(f.db.prepare('SELECT state FROM fx_supporting_works WHERE work_id=?').get(work.workId).state,'failed');
});
