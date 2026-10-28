'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,schemaManifest,D,Database}=require('./fixtures/us-adult-analysis-basis-harness');
const {fixture:specFixture}=require('./fixtures/custom-acceptance-spec-harness');
const {canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {decisionHeadDigest}=require('../../src/helix/domains/libra/model/decision-front-half-contracts');
const {createCommandCommitCoordinator}=require('../../src/helix/foundation/persistence/commit-foundation');
const {createCustomTargetStore}=require('../../src/helix/domains/libra/persistence/custom-target-store');
const {createCustomSpecPublicationStore}=require('../../src/helix/domains/libra/persistence/custom-spec-publication-store');
function harness(callback,{failAfterPublication=false}={}){return fixture(input=>{
  const db=new Database(input.databasePath),data=specFixture('movie','run-1',{runStateRevision:1,runStateDigest:D('run-state'),
    runExecutionBasisDigest:D('basis'),materialSetDigest:D('member-set')}),base=data.baseSpec;
  let injected=false;
  const unitOfWork={...input.unitOfWork,execute(participants,...options){
    const domain=participants.find(row=>row.participantId==='custom_spec_publish');
    if(failAfterPublication&&domain&&!injected){injected=true;return input.unitOfWork.execute([...participants,
      {participantId:'publication_interruption',owner:'libra',repositories:domain.repositories,execute(){throw new Error('injected after publication');}}],...options);}
    return input.unitOfWork.execute(participants,...options);
  }};
  try{
    db.exec("INSERT INTO libra_subjects(subject_id,status,content_profile,structure_kind,intake_revision) VALUES('subject','active','movie','single',1)");
    db.prepare('INSERT INTO libra_routing_decisions(routing_decision_id,subject_id,decision,shelf_id) VALUES(?,?,?,?)').run(data.routing.routingDecisionId,'subject','resolved','shelf');
    db.prepare('INSERT INTO libra_decision_basis_revisions(decision_basis_id,subject_id,basis_kind,basis_revision,status,routing_decision_id,basis_digest) VALUES(?,?,?,?,?,?,?)')
      .run(base.decisionBasisId,'subject','acceptance_spec',2,'ready',data.routing.routingDecisionId,base.decisionBasisDigest);
    const columns=['acceptance_spec_id','subject_id','shelf_id','shelf_routing_projection_revision','shelf_projection_digest','shelf_standard_revision',
      'shelf_standard_digest','decision_basis_id','product_scope_digest','spec_revision','spec_schema_ref','spec_json','spec_digest','record_digest','structure_kind','content_profile','published_at_ms'];
    db.prepare('INSERT INTO libra_acceptance_specs('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')')
      .run(base.acceptanceSpecId,'subject','shelf',base.shelfRoutingProjectionRevision,base.shelfProjectionDigest,base.shelfStandardRevision,base.shelfStandardDigest,
        base.decisionBasisId,base.productScope.scopeDigest,base.specRevision,base.schemaRef,canonicalJson(base),base.specDigest,base.recordDigest,base.structureKind,base.contentProfile,base.publishedAtMs);
    db.prepare('UPDATE libra_runs SET subject_id=?,state=?,acceptance_spec_id=?').run('subject','frozen',base.acceptanceSpecId);
    data.targetBasis.decisionHeadDigest=decisionHeadDigest('subject',4,data.routing.routingDecisionId,base.decisionBasisId,base.acceptanceSpecId);
    db.prepare('INSERT INTO libra_subject_decision_heads(subject_id,head_revision,head_digest,current_routing_decision_id,current_decision_basis_id,current_acceptance_spec_id) VALUES(?,?,?,?,?,?)')
      .run('subject',4,data.targetBasis.decisionHeadDigest,data.routing.routingDecisionId,base.decisionBasisId,base.acceptanceSpecId);
    db.prepare('INSERT INTO libra_product_fact_revisions(product_fact_id,libra_run_id,fact_kind,fact_revision,fact_json,fact_digest) VALUES(?,?,?,?,?,?)')
      .run('identity','run-1','resolved_identity',1,'{}',data.targetBasis.identityDigest);
    const options={...input,schemaManifest,unitOfWork},targets=createCustomTargetStore(options),coordinator=createCommandCommitCoordinator(options),
      chosen=data.target([{requirementCode:'minimum_raster_unmet',targetId:'minimumRasterClass'}]);
    for(const [kind,record]of[['preview',chosen.preview],['intent',chosen.intent]]){
      const key=kind==='preview'?'preview':record.idempotencyKey,requestDigest=kind==='preview'?D('preview'):record.requestDigest,
        readFence=unitOfWork.captureReadFence(),id=D(kind),participant=targets.participant({kind,record,idempotencyKey:key,requestDigest,readFence,currentBasis:record.basis});
      coordinator.execute({readFence,command:{commandReceiptId:id,ownerDomain:'libra',commandContract:'fixture.target.'+kind,callerScope:'admin',idempotencyKey:key,
        requestDigest,targetType:'subject',targetId:'subject'},domainParticipant:participant,commitMarker:{commitMarker:id,scopeType:'subject',scopeId:'subject',commitDigest:id},
        auditRecords:[{auditId:id,actorType:'admin',actorId:'admin',action:'target.'+kind,scopeType:'subject',scopeId:'subject'}],
        resultEnvelope:result=>({resultSchemaRef:'fixture.target-result@1',resultRef:result})});
    }
    const publisher=createCustomSpecPublicationStore(options),currentBasis={...chosen.intent.basis,customTargetRevision:chosen.intent.revision},
      publish=overrides=>publisher.publish({intentId:chosen.intent.intentId,intentDigest:chosen.intent.intentDigest,currentBasis,
        readFence:unitOfWork.captureReadFence(),producedAtMs:1200,...overrides}),
      counts=()=>['libra_acceptance_specs','libra_custom_target_intents','fx_command_receipts','fx_commit_markers','fx_audit_records']
        .map(table=>db.prepare('SELECT count(*) n FROM '+table).get().n);
    return callback({db,publisher,publish,base,chosen,currentBasis,unitOfWork,counts,options});
  }finally{db.close();}
});}

test('real SQLite publishes one complete custom Spec, advances the decision head and atomically records its receipt',()=>harness(h=>{
  const old=canonicalJson(h.db.prepare('SELECT * FROM libra_runs').get()),published=h.publish(),ref=published.receipt.resultRef,spec=h.publisher.read(ref.acceptanceSpecId);
  assert.equal(published.replayed,false);assert.equal(spec.targetKind,'user_custom');assert.equal(spec.specRevision,2);
  assert.equal(spec.originalTarget.acceptanceSpecId,h.base.acceptanceSpecId);assert.equal(spec.requirements.mandatoryMedia.minimumRasterClass,'none');
  assert.equal(spec.requirements.space.maxSizeGiB,50);assert.equal(ref.committedHeadRevision,5);
  assert.equal(h.db.prepare('SELECT current_acceptance_spec_id FROM libra_subject_decision_heads').get().current_acceptance_spec_id,spec.acceptanceSpecId);
  assert.deepEqual(h.counts(),[2,1,3,3,3]);assert.equal(canonicalJson(h.db.prepare('SELECT * FROM libra_runs').get()),old);
  assert.equal(h.db.prepare('SELECT spec_json FROM libra_acceptance_specs WHERE acceptance_spec_id=?').get(h.base.acceptanceSpecId).spec_json,canonicalJson(h.base));
  assert.deepEqual(h.db.pragma('foreign_key_check'),[]);
}));

test('publication replay precedes later Arca, Run and read-view changes and preserves the original revision',()=>harness(h=>{
  const first=h.publish(),readFence=h.unitOfWork.captureReadFence();h.db.exec("UPDATE libra_runs SET state='completed',state_revision=2");
  const replay=h.publish({readFence,currentBasis:{...h.currentBasis,handoffState:'accepted'}});
  assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,first.receipt);assert.deepEqual(h.counts(),[2,1,3,3,3]);
  assert.equal(h.publisher.read(first.receipt.resultRef.acceptanceSpecId).specRevision,2);
  assert.throws(()=>h.publish({intentDigest:D('other')}),{code:'P3_COMMAND_IDEMPOTENCY_CONFLICT'});
}));

test('fresh publication rejects Arca acceptance, changed Shelf projection and stale technical views',()=>harness(h=>{
  const before=h.counts();for(const currentBasis of [{...h.currentBasis,handoffState:'accepted'},
    {...h.currentBasis,shelfStandardRevision:2},{...h.currentBasis,runSpecDigest:D('different')}]){
    assert.throws(()=>h.publish({currentBasis}),{code:'LIBRA_CUSTOM_TARGET_PREVIEW_STALE'});assert.deepEqual(h.counts(),before);
  }
  const readFence=h.unitOfWork.captureReadFence();h.db.exec('UPDATE libra_subjects SET intake_revision=2');
  assert.throws(()=>h.publish({readFence}),{code:'P3_UOW_READ_FENCE_CHANGED'});assert.deepEqual(h.counts(),before);
}));

test('interruption after Spec, head and all technical writes rolls back the entire publication',()=>harness(h=>{
  const before=h.counts(),head=h.db.prepare('SELECT * FROM libra_subject_decision_heads').get();
  assert.throws(()=>h.publish(),/injected after publication/);assert.deepEqual(h.counts(),before);
  assert.deepEqual(h.db.prepare('SELECT * FROM libra_subject_decision_heads').get(),head);
  assert.equal(h.publish().replayed,false);assert.deepEqual(h.counts(),[2,1,3,3,3]);
},{failAfterPublication:true}));

test('the immutable custom Spec Reader rejects drift in relational placement and target headers',()=>harness(h=>{
  const id=h.publish().receipt.resultRef.acceptanceSpecId;
  h.db.prepare('UPDATE libra_acceptance_specs SET shelf_id=? WHERE acceptance_spec_id=?').run('other-shelf',id);
  assert.throws(()=>h.publisher.read(id),{code:'LIBRA_CUSTOM_SPEC_RECORD_INVALID'});
}));

test('post-confirmation execution suspension uses its fresh state without changing the durable user target',()=>harness(h=>{
  const confirmed=h.chosen.intent,revision=2,stateDigest=D('suspended-after-confirmation');
  h.db.prepare('UPDATE libra_runs SET state=?,state_revision=?,state_digest=?').run('suspended',revision,stateDigest);
  const published=h.publish({currentBasis:{...h.currentBasis,runState:'suspended',runStateRevision:revision,runStateDigest:stateDigest,
    gapEvidenceSetDigest:D('observations-after-confirmation')}}),
    spec=h.publisher.read(published.receipt.resultRef.acceptanceSpecId);
  assert.equal(spec.customTargetRef.intentDigest,confirmed.intentDigest);
  assert.equal(h.db.prepare('SELECT state FROM libra_runs').get().state,'suspended');
  assert.equal(JSON.parse(h.db.prepare('SELECT record_json FROM libra_custom_target_intents').get().record_json).basis.runState,'frozen');
}));

test('post-confirmation terminalization or another Package revision still forbids new Spec publication',()=>harness(h=>{
  h.db.prepare('UPDATE libra_runs SET package_revision_head=1').run();
  assert.throws(()=>h.publish({currentBasis:{...h.currentBasis,runPackageRevisionHead:1}}),{code:'LIBRA_CUSTOM_TARGET_PREVIEW_STALE'});
  h.db.prepare('UPDATE libra_runs SET package_revision_head=0,state=?').run('discarded');
  assert.throws(()=>h.publish({currentBasis:{...h.currentBasis,runState:'discarded'}}),{code:'LIBRA_CUSTOM_TARGET_SCOPE'});
  assert.deepEqual(h.counts(),[1,1,2,2,2]);
}));
