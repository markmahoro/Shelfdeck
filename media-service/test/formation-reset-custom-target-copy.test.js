'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Database=require('better-sqlite3');
const {canonicalDigest:D,canonicalJson}=require('../src/helix/contracts/canonical-json');
const {openSqliteKernel}=require('../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createOfferWithdrawalStore}=require('../src/helix/domains/arca/persistence/offer-withdrawal-store');
const {createOnDeckProcessCoordinator}=require('../src/helix/domains/arca/application/on-deck-process-coordinator');
const {createOutboxDispatcherHost}=require('../src/helix/foundation/execution/outbox-dispatcher-host');
const {fixture:specFixture}=require('./helix-architecture/fixtures/custom-acceptance-spec-harness');
const {decisionHeadDigest}=require('../src/helix/domains/libra/model/decision-front-half-contracts');
const {createRetainedDatabase}=require('../scripts/formation-reset-copy');
const {buildOwnerRetentionPolicy}=require('../scripts/formation-reset-owner-policy');
const {readResetOwnerSnapshot}=require('../scripts/formation-reset-owner-snapshot');
const {verifyRetainedCustomTargets}=require('../scripts/formation-reset-verify');
const {verifyRetainedWithdrawals}=require('../scripts/formation-reset-withdrawals');
const {normalizeRetainedSubjects}=require('../scripts/formation-reset-normalize');
const {createOfflineFormationReset}=require('../scripts/formation-reset-offline');
const {fileDigest}=require('../scripts/formation-reset-generation');
const targetSchema={schemaManifest:require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),
  schemaDdl:fs.readFileSync(path.join(__dirname,'../src/helix/foundation/persistence/generated/clean-schema.sql'),'utf8')};

function reviewedPolicy(owner){return buildOwnerRetentionPolicy(targetSchema.schemaManifest,owner);}

function customCommandIds({preview,intent}){
  return [D({schema:'libra.custom-target-command-receipt@1',kind:'preview',actorId:intent.actorId,
    idempotencyKey:'preview-'+preview.actorId}),
  D({schema:'libra.custom-target-command-receipt@1',kind:'intent',actorId:intent.actorId,idempotencyKey:intent.idempotencyKey}),
  D({schema:'libra.custom-spec-command-id@1',intentId:intent.intentId})];
}

function seedCustomCommandProofs(db,target,spec){
  const {preview,intent}=target,[previewId,confirmId,publishId]=customCommandIds(target),
    previewContract='libra.custom-target.preview@1',confirmContract='libra.custom-target.confirm@1',
    publishContract='libra.custom-target.spec.publish@1',previewKey='preview-'+preview.actorId,
    previewRequest=D({schema:'libra.custom-target-preview-request@1',subjectId:intent.subjectId,libraRunId:intent.libraRunId}),
    common={caller:'admin:'+intent.actorId,scopeType:'libra_run',scopeId:intent.libraRunId,actorType:'admin',actor:intent.actorId,
      schema:'libra.custom-target-command-result@1',evidence:null},
    proofs=[
      {...common,id:previewId,contract:previewContract,action:previewContract,key:previewKey,request:previewRequest,
        result:{recordId:preview.previewDigest,recordDigest:preview.previewDigest},at:preview.createdAtMs},
      {...common,id:confirmId,contract:confirmContract,action:confirmContract,key:intent.idempotencyKey,request:intent.requestDigest,
        result:{recordId:intent.intentId,recordDigest:intent.intentDigest},at:intent.confirmedAtMs},
      {id:publishId,contract:publishContract,caller:'libra.custom-target-resolution',key:intent.intentId,
        request:D({schema:publishContract,intentId:intent.intentId,intentDigest:intent.intentDigest}),
        scopeType:'custom_target',scopeId:intent.intentId,actorType:'system',actor:'libra.custom-target-resolution',
        action:'libra.custom_spec.publish',evidence:intent.intentDigest,schema:'libra.custom-spec-publication-result@1',
        result:{subjectId:spec.subjectId,acceptanceSpecId:spec.acceptanceSpecId,specRevision:spec.specRevision,specDigest:spec.specDigest,
          recordDigest:spec.recordDigest,customTargetRef:spec.customTargetRef,targetInputDigest:spec.targetInputDigest,committedHeadRevision:4},
        at:spec.publishedAtMs},
    ];
  const receipt=db.prepare('INSERT INTO fx_command_receipts(command_receipt_id,owner_domain,command_contract,caller_scope,idempotency_key,request_digest,target_type,target_id,result_schema_ref,result_ref_json,result_digest,committed_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'),
    marker=db.prepare('INSERT INTO fx_commit_markers(commit_marker,effect_id,owner_domain,scope_type,scope_id,commit_digest,result_id,result_schema_ref,result_digest,committed_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?)'),
    audit=db.prepare('INSERT INTO fx_audit_records(audit_id,owner_domain,actor_type,actor_id,action,scope_type,scope_id,work_id,event_id,evidence_digest,occurred_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  for(const proof of proofs){
    receipt.run(proof.id,'libra',proof.contract,proof.caller,proof.key,proof.request,proof.scopeType,proof.scopeId,
      proof.schema,canonicalJson(proof.result),D(proof.result),proof.at);
    marker.run(proof.id,null,'libra',proof.scopeType,proof.scopeId,proof.request,null,null,null,proof.at);
    audit.run(proof.id,'libra',proof.actorType,proof.actor,proof.action,proof.scopeType,proof.scopeId,null,null,proof.evidence,proof.at);
  }
}

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'reset-custom-target-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const sourcePath=path.join(root,'source.db'),targetPath=path.join(root,'target.db');
  openSqliteKernel({Database,databasePath:sourcePath,...targetSchema}).close();
  const initial=specFixture('movie','old-run-1'),headDigest=decisionHeadDigest('subject',3,
      initial.routing.routingDecisionId,initial.baseSpec.decisionBasisId,initial.baseSpec.acceptanceSpecId),
    first=specFixture('movie','old-run-1',{decisionHeadDigest:headDigest}),
    second=specFixture('movie','old-run-2',{customTargetRevision:1,decisionHeadDigest:headDigest}),
    committed=first.target([{requirementCode:'minimum_raster_unmet',targetId:'minimumRasterClass'}],'alice'),
    unused=second.target([{requirementCode:'minimum_raster_unmet',targetId:'minimumRasterClass'}],'bob'),
    usedSpec=first.build(committed),unusedSpec=second.build(unused,{specRevision:3}),base=first.baseSpec;
  const db=new Database(sourcePath),packages=[];
  try{
    db.pragma('foreign_keys=OFF');
    db.exec("INSERT INTO arca_shelves(shelf_id,status) VALUES('shelf','active');\n"+
      "INSERT INTO arca_shelf_entries(shelf_entry_id,shelf_id,status) VALUES('collection','shelf','active');\n"+
      "INSERT INTO libra_subjects(subject_id,status,content_profile,structure_kind,intake_revision) VALUES('subject','active','movie','single',1)");
    db.prepare('INSERT INTO libra_decision_basis_revisions(decision_basis_id,subject_id,basis_kind,basis_revision,status,routing_decision_id) VALUES(?,?,?,?,?,?)')
      .run(base.decisionBasisId,'subject','acceptance_spec',1,'ready',first.routing.routingDecisionId);
    const specRow=db.prepare('INSERT INTO libra_acceptance_specs(acceptance_spec_id,subject_id,shelf_id,decision_basis_id,product_scope_digest,spec_revision,spec_schema_ref,spec_json,spec_digest,record_digest,structure_kind,content_profile,published_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for(const value of [base,usedSpec,unusedSpec])specRow.run(value.acceptanceSpecId,value.subjectId,value.targetShelfId,value.decisionBasisId,
      value.productScope.scopeDigest,value.specRevision,value.schemaRef,canonicalJson(value),value.specDigest,value.recordDigest,
      value.structureKind,value.contentProfile,value.publishedAtMs);
    const run=db.prepare('INSERT INTO libra_runs(libra_run_id,subject_id,state,acceptance_spec_id,execution_basis_digest,execution_basis_record_json) VALUES(?,?,?,?,?,?)');
    for(const [id,spec,state] of [['old-run-1',base,'superseded'],['old-run-2',base,'frozen'],
      ['committed-run',usedSpec,'completed'],['uncommitted-run',unusedSpec,'active']]){
      const digest=D('basis-'+id),ref=spec.customTargetRef,
        basis={subjectSnapshot:{subjectId:'subject'},executionBasisDigest:digest,acceptanceSpec:{acceptanceSpecId:spec.acceptanceSpecId,
          specDigest:spec.specDigest,recordDigest:spec.recordDigest,specRevision:spec.specRevision,
          productScopeDigest:spec.productScope.scopeDigest,shelfId:'shelf'},
        ...(ref?{collectionTargetRef:{schemaRef:'libra.collection-target-reference@1',targetKind:'user_custom',intentId:ref.intentId,
          intentDigest:ref.intentDigest,targetRevision:ref.targetRevision}}:{})};
      run.run(id,'subject',state,spec.acceptanceSpecId,digest,canonicalJson(basis));
    }
    db.prepare("UPDATE libra_runs SET supersedes_run_id='old-run-1' WHERE libra_run_id='committed-run'").run();
    db.prepare("UPDATE libra_runs SET superseded_by_run_id='committed-run' WHERE libra_run_id='old-run-1'").run();
    for(const {preview,intent} of [committed,unused]){
      db.prepare('INSERT INTO libra_custom_target_previews(preview_id,subject_id,libra_run_id,actor_id,idempotency_key,request_digest,record_schema_ref,record_json,record_digest,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(preview.previewDigest,'subject',preview.basis.libraRunId,preview.actorId,'preview-'+preview.actorId,
          D({schema:'libra.custom-target-preview-request@1',subjectId:intent.subjectId,libraRunId:intent.libraRunId}),
          preview.schemaRef,canonicalJson(preview),preview.previewDigest,preview.createdAtMs);
      db.prepare('INSERT INTO libra_custom_target_intents(intent_id,preview_id,subject_id,libra_run_id,product_scope_digest,target_revision,actor_id,idempotency_key,request_digest,record_schema_ref,record_json,record_digest,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(intent.intentId,intent.previewDigest,intent.subjectId,intent.libraRunId,intent.basis.productScopeDigest,intent.revision,
          intent.actorId,intent.idempotencyKey,intent.requestDigest,intent.schemaRef,canonicalJson(intent),intent.intentDigest,intent.confirmedAtMs);
    }
    seedCustomCommandProofs(db,committed,usedSpec);
    seedCustomCommandProofs(db,unused,unusedSpec);
    db.prepare('INSERT INTO libra_custom_target_heads(subject_id,product_scope_digest,current_revision,intent_id,record_digest) VALUES(?,?,?,?,?)')
      .run('subject',unused.intent.basis.productScopeDigest,unused.intent.revision,unused.intent.intentId,unused.intent.intentDigest);
    for(const [runId,spec] of [['committed-run',usedSpec],['uncommitted-run',unusedSpec]]){
      const id=D({schema:'libra.on-deck-package-id@1',libraRunId:runId,packageRevision:1}),digest=D('package-'+runId),
        offerId=D({schema:'libra.product-offer-id@1',onDeckPackageId:id,packageDigest:digest});
      db.prepare('INSERT INTO libra_product_packages(on_deck_package_id,offer_id,package_revision,libra_run_id,subject_id,shelf_id,acceptance_spec_id,acceptance_spec_record_digest,package_digest,related_disposition_set_digest,state) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(id,offerId,1,runId,'subject','shelf',spec.acceptanceSpecId,spec.recordDigest,digest,D('related'),'published');
      packages.push({id,digest,offerId});
    }
    db.prepare('INSERT INTO arca_acceptance_attempts(acceptance_attempt_id,offer_id,on_deck_package_id,package_digest,shelf_id,state) VALUES(?,?,?,?,?,?)')
      .run('attempt',packages[0].offerId,packages[0].id,packages[0].digest,'shelf','accepted');
    db.prepare('INSERT INTO arca_acceptance_decisions(acceptance_decision_id,acceptance_attempt_id,offer_id,on_deck_package_id,package_digest,shelf_id,result) VALUES(?,?,?,?,?,?,?)')
      .run('decision','attempt',packages[0].offerId,packages[0].id,packages[0].digest,'shelf','accepted');
    db.prepare('INSERT INTO arca_ondeck_custodies(custody_id,acceptance_decision_id,on_deck_package_id,package_digest,state) VALUES(?,?,?,?,?)')
      .run('custody','decision',packages[0].id,packages[0].digest,'committed');
    db.exec("INSERT INTO arca_ondeck_runs(on_deck_run_id,custody_id,state) VALUES('deck','custody','committed');\n"+
      "INSERT INTO arca_ondeck_commit_receipts(receipt_id,on_deck_run_id,shelf_entry_id) VALUES('commit','deck','collection')");
    assert.deepEqual(db.pragma('foreign_key_check'),[]);
  }finally{db.close();}
  return {sourcePath,targetPath,committed,unused,usedSpec,unusedSpec,base,packages};
}

function withdrawnOffer(f,runId){
  const packageId=D('withdrawn-package-'+runId),packageDigest=D('withdrawn-digest-'+runId),
    offer={onDeckPackageId:packageId,packageRevision:1,packageDigest,shelfId:'shelf',libraRunId:runId,
      subjectId:'subject',acceptanceSpecId:f.base.acceptanceSpecId,relatedDispositionSetDigest:D('withdrawn-related-'+runId)};
  offer.offerId=D({schema:'libra.product-offer-id@1',onDeckPackageId:packageId,packageDigest});
  const db=new Database(f.sourcePath);
  try{db.prepare('INSERT INTO libra_product_packages(on_deck_package_id,offer_id,package_revision,libra_run_id,subject_id,shelf_id,acceptance_spec_id,acceptance_spec_record_digest,package_digest,related_disposition_set_digest,state) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(packageId,offer.offerId,1,runId,'subject','shelf',f.base.acceptanceSpecId,f.base.recordDigest,packageDigest,offer.relatedDispositionSetDigest,'published');}
  finally{db.close();}
  const kernel=openSqliteKernel({Database,databasePath:f.sourcePath,...targetSchema,now:()=>1700000001000}),unitOfWork=createSqliteUnitOfWork({kernel});
  try{
    const basis={eligibility:'ineligible',reasonCode:'target_not_current',libraRunId:runId,runState:'superseded',runStateRevision:1,
      runStateDigest:D('state-'+runId),acceptanceSpecId:f.base.acceptanceSpecId,packageRevisionHead:1,deliveryReceiptAbsent:true},
      store=createOfferWithdrawalStore({schemaManifest:targetSchema.schemaManifest,unitOfWork});
    const result=store.close({offer,deliveryFence:{...basis,fenceDigest:D(basis)},readFence:unitOfWork.captureReadFence()});
    return {offer,receipt:result.receipt.resultRef,commandId:result.receipt.commandReceiptId};
  }finally{kernel.close();}
}

function seedOfferMessage(f,offer,state){
  const messageId=D({schema:'libra.product-offer-message-id@1',offerId:offer.offerId,packageDigest:offer.packageDigest}),
    payload={...offer,messageKind:'libra.product-offer.available@1',messageId,dedupKey:messageId},db=new Database(f.sourcePath);
  try{
    db.prepare('INSERT INTO fx_outbox(message_id,producer_domain,message_kind,aggregate_type,aggregate_id,aggregate_revision,dedup_key,consumer_set_digest,intended_consumer_count,payload_schema_ref,payload_json,payload_digest,state,available_at_ms,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(messageId,'libra',payload.messageKind,'on_deck_package',offer.onDeckPackageId,1,messageId,D(['arca']),1,
        'helix://contracts/types/LibraProductOfferAvailableMessage/v1',canonicalJson(payload),D(payload),'pending',0,0);
    db.prepare('INSERT INTO fx_outbox_deliveries(message_id,consumer_domain,state,attempt_count,next_attempt_at_ms) VALUES(?,?,?,?,?)')
      .run(messageId,'arca',state,0,0);
  }finally{db.close();}
  return payload;
}

function seedHistoricalWork(f,id,state){
  const db=new Database(f.sourcePath);
  try{db.prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,priority_class,definition_json,state,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id,'libra','libra_run','old-run-1','historic_work','normal_foreground','{}',state,id);}
  finally{db.close();}
}

test('retained custom target keeps its exact three command proofs and drops unrelated target proofs',t=>{
  const f=fixture(t),owner=readResetOwnerSnapshot({Database,sourcePath:f.sourcePath});
  createRetainedDatabase({Database,sourcePath:f.sourcePath,targetPath:f.targetPath,targetSchema,policy:reviewedPolicy(owner)});
  const copy=new Database(f.targetPath,{readonly:true}),kept=customCommandIds(f.committed),unused=customCommandIds(f.unused);
  try{
    for(const [table,column] of [['fx_command_receipts','command_receipt_id'],['fx_commit_markers','commit_marker'],['fx_audit_records','audit_id']]){
      const has=copy.prepare('SELECT count(*) n FROM '+table+' WHERE '+column+'=?');
      for(const id of kept)assert.equal(has.get(id).n,1,table+': retained proof');
      for(const id of unused)assert.equal(has.get(id).n,0,table+': unrelated proof');
    }
    assert.deepEqual(copy.pragma('foreign_key_check'),[]);
  }finally{copy.close();}
});

for(const command of [0,1,2])for(const [table,column] of [['fx_command_receipts','command_receipt_id'],
  ['fx_commit_markers','commit_marker'],['fx_audit_records','audit_id']])
test('retained custom command '+command+' rejects missing '+table,t=>{
  const f=fixture(t),db=new Database(f.sourcePath);
  try{db.prepare('DELETE FROM '+table+' WHERE '+column+'=?').run(customCommandIds(f.committed)[command]);}finally{db.close();}
  const owner=readResetOwnerSnapshot({Database,sourcePath:f.sourcePath});
  assert.throws(()=>createRetainedDatabase({Database,sourcePath:f.sourcePath,targetPath:f.targetPath,targetSchema,policy:reviewedPolicy(owner)}),
    {code:'LIBRA_RESET_CUSTOM_TARGET_INVALID'});
});

for(const kind of ['preview_result','confirm_actor','publish_result','publish_marker','decision_basis'])
test('retained custom target rejects altered '+kind+' proof',t=>{
  const f=fixture(t),db=new Database(f.sourcePath),ids=customCommandIds(f.committed);
  try{
    if(kind==='preview_result'||kind==='publish_result'){
      const id=ids[kind==='preview_result'?0:2],row=db.prepare('SELECT result_ref_json FROM fx_command_receipts WHERE command_receipt_id=?').get(id),
        value=JSON.parse(row.result_ref_json);
      if(kind==='preview_result')value.recordId=D('wrong-preview');else value.committedHeadRevision++;
      db.prepare('UPDATE fx_command_receipts SET result_ref_json=?,result_digest=? WHERE command_receipt_id=?').run(canonicalJson(value),D(value),id);
    }else if(kind==='confirm_actor')db.prepare('UPDATE fx_audit_records SET actor_id=? WHERE audit_id=?').run('other-admin',ids[1]);
    else if(kind==='publish_marker')db.prepare('UPDATE fx_commit_markers SET commit_digest=? WHERE commit_marker=?').run(D('wrong-marker'),ids[2]);
    else db.prepare('UPDATE libra_decision_basis_revisions SET routing_decision_id=? WHERE decision_basis_id=?').run('different-routing',f.base.decisionBasisId);
  }finally{db.close();}
  const owner=readResetOwnerSnapshot({Database,sourcePath:f.sourcePath});
  assert.throws(()=>createRetainedDatabase({Database,sourcePath:f.sourcePath,targetPath:f.targetPath,targetSchema,policy:reviewedPolicy(owner)}),
    {code:'LIBRA_RESET_CUSTOM_TARGET_INVALID'});
});

test('independent custom target verification detects a missing copied command proof',t=>{
  const f=fixture(t),owner=readResetOwnerSnapshot({Database,sourcePath:f.sourcePath});
  createRetainedDatabase({Database,sourcePath:f.sourcePath,targetPath:f.targetPath,targetSchema,policy:reviewedPolicy(owner)});
  const changed=new Database(f.targetPath);
  try{changed.prepare('DELETE FROM fx_audit_records WHERE audit_id=?').run(customCommandIds(f.committed)[2]);}finally{changed.close();}
  const source=new Database(f.sourcePath,{readonly:true}),target=new Database(f.targetPath,{readonly:true});
  try{source.exec('BEGIN');target.exec('BEGIN');assert.throws(()=>verifyRetainedCustomTargets(source,target,targetSchema.schemaManifest),
    {code:'LIBRA_RESET_CUSTOM_TARGET_INVALID'});}
  finally{source.exec('ROLLBACK');target.exec('ROLLBACK');source.close();target.close();}
});

test('an eventless Arca acceptance Marker keeps its exact Foundation Result',t=>{
  const f=fixture(t),db=new Database(f.sourcePath),decision={acceptanceDecisionId:'decision',customAcceptanceBasis:{intentId:f.committed.intent.intentId}},
    receipt={receiptId:'arca-receipt'},decisionDigest=D(decision),resultDigest=D(receipt),resultId=D('acceptance-result'),markerId=D('acceptance-marker');
  try{
    db.prepare('INSERT INTO fx_event_result_bindings(result_id,event_id,outcome_kind,result_schema_ref,result_json,result_digest,evidence_schema_ref,evidence_json,evidence_digest,effect_receipt_id,committed_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(resultId,null,'succeeded','fixture.receipt',canonicalJson(receipt),resultDigest,'fixture.decision',canonicalJson(decision),decisionDigest,'arca-receipt',1);
    db.prepare('INSERT INTO fx_commit_markers(commit_marker,effect_id,owner_domain,scope_type,scope_id,commit_digest,result_id,result_schema_ref,result_digest,committed_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(markerId,null,'arca','acceptance_decision','decision',decisionDigest,resultId,'fixture.receipt',resultDigest,1);
  }finally{db.close();}
  const owner=readResetOwnerSnapshot({Database,sourcePath:f.sourcePath});
  createRetainedDatabase({Database,sourcePath:f.sourcePath,targetPath:f.targetPath,targetSchema,policy:reviewedPolicy(owner)});
  const copy=new Database(f.targetPath,{readonly:true});
  try{
    assert.equal(copy.prepare('SELECT result_id FROM fx_commit_markers WHERE commit_marker=?').get(markerId).result_id,resultId);
    assert.equal(copy.prepare('SELECT evidence_json FROM fx_event_result_bindings WHERE result_id=?').get(resultId).evidence_json,canonicalJson(decision));
  }finally{copy.close();}
});

test('an unreferenced ready Work of a retained predecessor leaves the fresh generation',t=>{
  const f=fixture(t);seedHistoricalWork(f,'old-ready-work','ready');seedHistoricalWork(f,'old-completed-work','succeeded');
  const before=fs.readFileSync(f.sourcePath),owner=readResetOwnerSnapshot({Database,sourcePath:f.sourcePath});
  createRetainedDatabase({Database,sourcePath:f.sourcePath,targetPath:f.targetPath,targetSchema,policy:reviewedPolicy(owner)});
  const copy=new Database(f.targetPath,{readonly:true});
  try{assert.deepEqual(copy.prepare("SELECT work_id FROM fx_supporting_works WHERE process_id='old-run-1' ORDER BY work_id").all(),
    [{work_id:'old-completed-work'}]);}
  finally{copy.close();}
  assert.deepEqual(fs.readFileSync(f.sourcePath),before);
});

test('a required but still runnable predecessor Work blocks normalization',t=>{
  const f=fixture(t);seedHistoricalWork(f,'required-ready-work','ready');
  const owner=readResetOwnerSnapshot({Database,sourcePath:f.sourcePath}),base=reviewedPolicy(owner),
    policy={...base,seeds:[...base.seeds,{owner:'execution-foundation',table:'fx_supporting_works',key:{work_id:'required-ready-work'}}]};
  createRetainedDatabase({Database,sourcePath:f.sourcePath,targetPath:f.targetPath,targetSchema,policy});
  assert.throws(()=>normalizeRetainedSubjects({Database,targetPath:f.targetPath,...targetSchema,generationId:'a'.repeat(64),
    backupDigest:'b'.repeat(64),manifestDigest:'c'.repeat(64),assertIsolated(){}}),{code:'RESET_RETAINED_EXECUTION_OPEN'});
});

for(const kind of ['work_attempt','event','event_attempt','effect'])test('a retained unresolved '+kind+' blocks Reset normalization',t=>{
  const f=fixture(t);seedHistoricalWork(f,'historical-work','succeeded');const db=new Database(f.sourcePath);
  try{
    if(kind==='work_attempt')db.exec("INSERT INTO fx_work_attempts(attempt_id,work_id,ordinal,state) VALUES('attempt','historical-work',1,'ready')");
    else{
      db.exec("INSERT INTO fx_workflow_plans(plan_id,state) VALUES('plan','planned')");
      db.prepare('INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,owner_domain,state) VALUES(?,?,?,?,?,?)')
        .run('event','plan','node','historical-work','libra',kind==='event'?'ready':'succeeded');
      if(kind!=='event')db.prepare('INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,state) VALUES(?,?,?,?)')
        .run('event-attempt','event',1,kind==='event_attempt'?'executing':'completed');
      if(kind==='effect')db.exec("INSERT INTO fx_effect_journal(effect_id,event_attempt_id,effect_class,idempotency_key,state) VALUES('effect','event-attempt','domain_fact_commit','effect-key','intended')");
    }
  }finally{db.close();}
  const owner=readResetOwnerSnapshot({Database,sourcePath:f.sourcePath});
  createRetainedDatabase({Database,sourcePath:f.sourcePath,targetPath:f.targetPath,targetSchema,policy:reviewedPolicy(owner)});
  assert.throws(()=>normalizeRetainedSubjects({Database,targetPath:f.targetPath,...targetSchema,generationId:'a'.repeat(64),
    backupDigest:'b'.repeat(64),manifestDigest:'c'.repeat(64),assertIsolated(){}}),{code:'RESET_RETAINED_EXECUTION_OPEN'});
});

test('retained custom-target predecessor keeps its exact withdrawn Offer proof, not unrelated withdrawals',t=>{
  const f=fixture(t),needed=withdrawnOffer(f,'old-run-1'),unrelated=withdrawnOffer(f,'old-run-2'),
    owner=readResetOwnerSnapshot({Database,sourcePath:f.sourcePath});
  createRetainedDatabase({Database,sourcePath:f.sourcePath,targetPath:f.targetPath,targetSchema,policy:reviewedPolicy(owner)});
  const copy=new Database(f.targetPath,{readonly:true});
  try{
    assert.deepEqual(copy.prepare('SELECT offer_id FROM arca_offer_withdrawal_receipts ORDER BY offer_id').all(),[{offer_id:needed.offer.offerId}]);
    for(const [table,column] of [['fx_command_receipts','command_receipt_id'],['fx_commit_markers','commit_marker'],['fx_audit_records','audit_id']]){
      assert.equal(copy.prepare('SELECT count(*) n FROM '+table+' WHERE '+column+'=?').get(needed.commandId).n,1);
      assert.equal(copy.prepare('SELECT count(*) n FROM '+table+' WHERE '+column+'=?').get(unrelated.commandId).n,0);
    }
    assert.equal(copy.prepare('SELECT count(*) n FROM libra_product_packages WHERE on_deck_package_id=?').get(needed.offer.onDeckPackageId).n,0);
    assert.deepEqual(copy.pragma('foreign_key_check'),[]);
  }finally{copy.close();}
  const source=new Database(f.sourcePath,{readonly:true}),target=new Database(f.targetPath,{readonly:true});
  try{source.exec('BEGIN');target.exec('BEGIN');assert.equal(verifyRetainedWithdrawals(source,target,targetSchema.schemaManifest).count,1);}
  finally{source.exec('ROLLBACK');target.exec('ROLLBACK');source.close();target.close();}
});

for(const [table,column] of [['fx_command_receipts','command_receipt_id'],['fx_commit_markers','commit_marker'],['fx_audit_records','audit_id']])
test('retained withdrawal cannot lose its original '+table+' evidence',t=>{
  const f=fixture(t),needed=withdrawnOffer(f,'old-run-1'),db=new Database(f.sourcePath);
  try{db.prepare('DELETE FROM '+table+' WHERE '+column+'=?').run(needed.commandId);}finally{db.close();}
  const owner=readResetOwnerSnapshot({Database,sourcePath:f.sourcePath});
  assert.throws(()=>createRetainedDatabase({Database,sourcePath:f.sourcePath,targetPath:f.targetPath,targetSchema,policy:reviewedPolicy(owner)}),
    {code:'RESET_WITHDRAWAL_PROOF_INVALID'});
});

test('the independent verifier rejects a retained predecessor whose withdrawal was lost',t=>{
  const f=fixture(t),needed=withdrawnOffer(f,'old-run-1'),owner=readResetOwnerSnapshot({Database,sourcePath:f.sourcePath});
  createRetainedDatabase({Database,sourcePath:f.sourcePath,targetPath:f.targetPath,targetSchema,policy:reviewedPolicy(owner)});
  const changed=new Database(f.targetPath);
  try{changed.prepare('DELETE FROM arca_offer_withdrawal_receipts WHERE offer_id=?').run(needed.offer.offerId);}finally{changed.close();}
  const source=new Database(f.sourcePath,{readonly:true}),target=new Database(f.targetPath,{readonly:true});
  try{source.exec('BEGIN');target.exec('BEGIN');
    assert.throws(()=>verifyRetainedWithdrawals(source,target,targetSchema.schemaManifest),{code:'RESET_WITHDRAWAL_PROOF_INVALID'});}
  finally{source.exec('ROLLBACK');target.exec('ROLLBACK');source.close();target.close();}
});

for(const state of ['pending','delivered'])test('a retained '+state+' Offer cannot lose its withdrawal or create a new acceptance',async t=>{
  const f=fixture(t),withdrawn=withdrawnOffer(f,'old-run-2'),payload=seedOfferMessage(f,withdrawn.offer,state),
    owner=readResetOwnerSnapshot({Database,sourcePath:f.sourcePath}),base=reviewedPolicy(owner),
    policy={...base,tables:{...base.tables,fx_outbox:{...base.tables.fx_outbox,disposition:'root'}}};
  createRetainedDatabase({Database,sourcePath:f.sourcePath,targetPath:f.targetPath,targetSchema,policy});
  const db=new Database(f.targetPath,{readonly:true});
  try{
    assert.equal(db.prepare('SELECT count(*) n FROM libra_runs WHERE libra_run_id=?').get('old-run-2').n,0);
    assert.equal(db.prepare('SELECT state FROM fx_outbox_deliveries WHERE message_id=?').get(payload.messageId).state,state);
    assert.equal(db.prepare('SELECT count(*) n FROM arca_offer_withdrawal_receipts WHERE offer_id=?').get(payload.offerId).n,1);
  }finally{db.close();}
  const kernel=openSqliteKernel({Database,databasePath:f.targetPath,...targetSchema}),unitOfWork=createSqliteUnitOfWork({kernel});
  let dispatcher;
  try{
    const coordinator=createOnDeckProcessCoordinator({schemaManifest:targetSchema.schemaManifest,unitOfWork,
      contextReader:{onDeck:{findRunByOffer:()=>null}},workResultReader:{},cancelProcessWorks:()=>({cancelledWorks:0,drainingWorks:0})});
    assert.equal(coordinator.admitOffer(payload).kind,'offer_withdrawn');
    let wakes=0;
    dispatcher=createOutboxDispatcherHost({schemaManifest:targetSchema.schemaManifest,unitOfWork,arcaCoordinator:coordinator,
      executionRuntimeHost:{wake(){wakes++;}},onError(error){throw error;}});
    assert.deepEqual(await dispatcher.drainOnce(),{kind:'advanced',delivered:1});
    const verified=new Database(f.targetPath,{readonly:true});
    try{assert.equal(verified.prepare('SELECT state FROM fx_outbox_deliveries WHERE message_id=?').get(payload.messageId).state,'acked');
      assert.equal(verified.prepare('SELECT count(*) n FROM arca_acceptance_attempts WHERE offer_id=?').get(payload.offerId).n,0);
    }finally{verified.close();}
    assert.equal(wakes,0);
  }finally{if(dispatcher)await dispatcher.stop();kernel.close();}
});

test('a retained withdrawal conflicting with Accepted responsibility blocks Reset',t=>{
  const f=fixture(t),withdrawn=withdrawnOffer(f,'old-run-1'),db=new Database(f.sourcePath);
  try{db.prepare("INSERT INTO arca_acceptance_attempts(acceptance_attempt_id,offer_id,state) VALUES('invalid-accepted',?,'accepted')").run(withdrawn.offer.offerId);}
  finally{db.close();}
  const owner=readResetOwnerSnapshot({Database,sourcePath:f.sourcePath});
  assert.throws(()=>createRetainedDatabase({Database,sourcePath:f.sourcePath,targetPath:f.targetPath,targetSchema,policy:reviewedPolicy(owner)}),
    {code:'ARCA_OFFER_WITHDRAWAL_CORRUPT'});
});

test('reviewed dependent tables preserve only the committed custom Spec Intent Preview and original standard',t=>{
  const f=fixture(t),owner=readResetOwnerSnapshot({Database,sourcePath:f.sourcePath}),policy=reviewedPolicy(owner);
  createRetainedDatabase({Database,sourcePath:f.sourcePath,targetPath:f.targetPath,targetSchema,policy});
  const copy=new Database(f.targetPath,{readonly:true});
  try{
    assert.deepEqual(copy.prepare('SELECT intent_id FROM libra_custom_target_intents').all(),[{intent_id:f.committed.intent.intentId}]);
    assert.deepEqual(copy.prepare('SELECT preview_id FROM libra_custom_target_previews').all(),[{preview_id:f.committed.preview.previewDigest}]);
    const specs=copy.prepare('SELECT acceptance_spec_id FROM libra_acceptance_specs ORDER BY acceptance_spec_id').all().map(row=>row.acceptance_spec_id);
    assert.deepEqual(specs.sort(),[f.usedSpec.acceptanceSpecId,f.base.acceptanceSpecId].sort());
    assert.equal(copy.prepare('SELECT count(*) n FROM libra_custom_target_heads').get().n,0);
    assert.equal(copy.prepare("SELECT count(*) n FROM libra_runs WHERE libra_run_id IN ('uncommitted-run','old-run-2')").get().n,0);
    assert.deepEqual(copy.pragma('foreign_key_check'),[]);
  }finally{copy.close();}
  const source=new Database(f.sourcePath,{readonly:true}),target=new Database(f.targetPath,{readonly:true});
  try{source.exec('BEGIN');target.exec('BEGIN');assert.equal(verifyRetainedCustomTargets(source,target,targetSchema.schemaManifest).count,1);}
  finally{source.exec('ROLLBACK');target.exec('ROLLBACK');source.close();target.close();}
});

test('an uncommitted custom target and the same Subject head are not retained',t=>{
  const f=fixture(t),db=new Database(f.sourcePath);
  try{db.pragma('foreign_keys=OFF');db.exec('DELETE FROM arca_ondeck_commit_receipts; DELETE FROM arca_ondeck_runs; '+
    'DELETE FROM arca_ondeck_custodies; DELETE FROM arca_acceptance_decisions; DELETE FROM arca_acceptance_attempts; DELETE FROM arca_shelf_entries');}
  finally{db.close();}
  const owner=readResetOwnerSnapshot({Database,sourcePath:f.sourcePath});
  createRetainedDatabase({Database,sourcePath:f.sourcePath,targetPath:f.targetPath,targetSchema,policy:reviewedPolicy(owner)});
  const copy=new Database(f.targetPath,{readonly:true});
  try{for(const table of ['libra_custom_target_intents','libra_custom_target_previews','libra_custom_target_heads','libra_runs','libra_acceptance_specs'])
    assert.equal(copy.prepare('SELECT count(*) n FROM '+table).get().n,0,table);
    assert.deepEqual(copy.pragma('foreign_key_check'),[]);
  }finally{copy.close();}
});

test('unselected same-Subject target history is not scanned or retained',t=>{
  const f=fixture(t),db=new Database(f.sourcePath),preview=structuredClone(f.unused.preview);
  try{preview.proposals[0].evidenceRefs[0].resultDigest=D('unrelated-corruption');
    db.prepare('UPDATE libra_custom_target_previews SET record_json=? WHERE preview_id=?').run(canonicalJson(preview),preview.previewDigest);
  }finally{db.close();}
  const owner=readResetOwnerSnapshot({Database,sourcePath:f.sourcePath});
  createRetainedDatabase({Database,sourcePath:f.sourcePath,targetPath:f.targetPath,targetSchema,policy:reviewedPolicy(owner)});
  const copy=new Database(f.targetPath,{readonly:true});
  try{assert.deepEqual(copy.prepare('SELECT intent_id FROM libra_custom_target_intents').all(),[{intent_id:f.committed.intent.intentId}]);
    assert.deepEqual(copy.prepare('SELECT preview_id FROM libra_custom_target_previews').all(),[{preview_id:f.committed.preview.previewDigest}]);
  }finally{copy.close();}
});

test('two committed versions of the same Subject each retain their own exact target closure',t=>{
  const f=fixture(t),db=new Database(f.sourcePath),p=f.packages[1];
  try{
    db.prepare("UPDATE libra_runs SET state='superseded',superseded_by_run_id='uncommitted-run' WHERE libra_run_id='old-run-2'").run();
    db.prepare("UPDATE libra_runs SET state='completed',supersedes_run_id='old-run-2' WHERE libra_run_id='uncommitted-run'").run();
    db.prepare('INSERT INTO arca_acceptance_attempts(acceptance_attempt_id,offer_id,on_deck_package_id,package_digest,shelf_id,state) VALUES(?,?,?,?,?,?)')
      .run('attempt-2',p.offerId,p.id,p.digest,'shelf','accepted');
    db.prepare('INSERT INTO arca_acceptance_decisions(acceptance_decision_id,acceptance_attempt_id,offer_id,on_deck_package_id,package_digest,shelf_id,result) VALUES(?,?,?,?,?,?,?)')
      .run('decision-2','attempt-2',p.offerId,p.id,p.digest,'shelf','accepted');
    db.prepare('INSERT INTO arca_ondeck_custodies(custody_id,acceptance_decision_id,on_deck_package_id,package_digest,state) VALUES(?,?,?,?,?)')
      .run('custody-2','decision-2',p.id,p.digest,'committed');
    db.exec("INSERT INTO arca_ondeck_runs(on_deck_run_id,custody_id,state) VALUES('deck-2','custody-2','committed');\n"+
      "INSERT INTO arca_ondeck_commit_receipts(receipt_id,on_deck_run_id,shelf_entry_id) VALUES('commit-2','deck-2','collection')");
  }finally{db.close();}
  const owner=readResetOwnerSnapshot({Database,sourcePath:f.sourcePath});
  createRetainedDatabase({Database,sourcePath:f.sourcePath,targetPath:f.targetPath,targetSchema,policy:reviewedPolicy(owner)});
  const copy=new Database(f.targetPath,{readonly:true});
  try{
    assert.deepEqual(copy.prepare('SELECT intent_id FROM libra_custom_target_intents ORDER BY intent_id').all().map(row=>row.intent_id),
      [f.committed.intent.intentId,f.unused.intent.intentId].sort());
    assert.deepEqual(copy.prepare('SELECT preview_id FROM libra_custom_target_previews ORDER BY preview_id').all().map(row=>row.preview_id),
      [f.committed.preview.previewDigest,f.unused.preview.previewDigest].sort());
    assert.equal(copy.prepare('SELECT count(*) n FROM libra_custom_target_heads').get().n,0);
    assert.deepEqual(copy.pragma('foreign_key_check'),[]);
  }finally{copy.close();}
});

for(const corruption of ['missing_intent','missing_preview','missing_original_spec','modified_preview','modified_intent','modified_spec',
  'wrong_intent_revision','wrong_run_target','standard_run_custom_ref','wrong_package_spec','wrong_package_standard'])
  test('retained custom closure rejects '+corruption+' instead of producing an incomplete copy',t=>{
    const f=fixture(t),db=new Database(f.sourcePath);
    try{
      db.pragma('foreign_keys=OFF');
      if(corruption==='missing_intent')db.prepare('DELETE FROM libra_custom_target_intents WHERE intent_id=?').run(f.committed.intent.intentId);
      if(corruption==='missing_preview')db.prepare('DELETE FROM libra_custom_target_previews WHERE preview_id=?').run(f.committed.preview.previewDigest);
      if(corruption==='missing_original_spec')db.prepare('DELETE FROM libra_acceptance_specs WHERE acceptance_spec_id=?').run(f.base.acceptanceSpecId);
      if(corruption==='modified_preview'){
        const preview=structuredClone(f.committed.preview);preview.proposals[0].evidenceRefs[0].resultDigest=D('tampered');
        db.prepare('UPDATE libra_custom_target_previews SET record_json=? WHERE preview_id=?').run(canonicalJson(preview),preview.previewDigest);
      }
      if(corruption==='modified_intent'){
        const intent=structuredClone(f.committed.intent);intent.target.requirements.space.maxSizeGiB=51;
        db.prepare('UPDATE libra_custom_target_intents SET record_json=? WHERE intent_id=?').run(canonicalJson(intent),intent.intentId);
      }
      if(corruption==='modified_spec'){
        const spec=structuredClone(f.usedSpec);spec.requirements.space.maxSizeGiB=51;
        db.prepare('UPDATE libra_acceptance_specs SET spec_json=? WHERE acceptance_spec_id=?').run(canonicalJson(spec),spec.acceptanceSpecId);
      }
      if(corruption==='wrong_intent_revision'){
        const intent=structuredClone(f.committed.intent);intent.revision=3;
        db.prepare('UPDATE libra_custom_target_intents SET target_revision=?,record_json=? WHERE intent_id=?').run(3,canonicalJson(intent),intent.intentId);
      }
      if(corruption==='wrong_run_target'){
        const run=db.prepare("SELECT execution_basis_record_json FROM libra_runs WHERE libra_run_id='committed-run'").get(),
          basis=JSON.parse(run.execution_basis_record_json);basis.collectionTargetRef.intentDigest=f.unused.intent.intentDigest;
        db.prepare("UPDATE libra_runs SET execution_basis_record_json=? WHERE libra_run_id='committed-run'").run(canonicalJson(basis));
      }
      if(corruption==='standard_run_custom_ref'){
        const run=db.prepare("SELECT execution_basis_record_json FROM libra_runs WHERE libra_run_id='old-run-1'").get(),
          basis=JSON.parse(run.execution_basis_record_json);
        basis.collectionTargetRef={schemaRef:'libra.collection-target-reference@1',targetKind:'user_custom',
          intentId:f.committed.intent.intentId,intentDigest:f.committed.intent.intentDigest,targetRevision:f.committed.intent.revision};
        db.prepare("UPDATE libra_runs SET execution_basis_record_json=? WHERE libra_run_id='old-run-1'").run(canonicalJson(basis));
      }
      if(corruption==='wrong_package_spec')db.prepare('UPDATE libra_product_packages SET acceptance_spec_record_digest=? WHERE on_deck_package_id=?')
        .run(f.unusedSpec.recordDigest,f.packages[0].id);
      if(corruption==='wrong_package_standard')db.prepare('UPDATE libra_product_packages SET acceptance_spec_id=?,acceptance_spec_record_digest=? WHERE on_deck_package_id=?')
        .run(f.base.acceptanceSpecId,f.base.recordDigest,f.packages[0].id);
    }finally{db.close();}
    const owner=readResetOwnerSnapshot({Database,sourcePath:f.sourcePath}),before=fileDigest(f.sourcePath);
    assert.throws(()=>createRetainedDatabase({Database,sourcePath:f.sourcePath,targetPath:f.targetPath,targetSchema,policy:reviewedPolicy(owner)}));
    assert.equal(fileDigest(f.sourcePath),before);
  });

test('unreviewed schema and a missing Owner closure declaration remain fail-closed',t=>{
  const f=fixture(t),owner=readResetOwnerSnapshot({Database,sourcePath:f.sourcePath});
  assert.throws(()=>buildOwnerRetentionPolicy({...targetSchema.schemaManifest,ddlDigest:D('unreviewed-schema')},owner),
    {code:'RESET_RETENTION_SCHEMA_UNREVIEWED'});
  const policy={...reviewedPolicy(owner)};delete policy.customTargetClosure;
  assert.throws(()=>createRetainedDatabase({Database,sourcePath:f.sourcePath,targetPath:f.targetPath,targetSchema,policy}),
    {code:'RESET_COPY_OWNER_DESCRIPTION_INVALID'});
  const unsafe=reviewedPolicy(owner),withHead={...unsafe,tables:{...unsafe.tables,
    libra_custom_target_heads:{...unsafe.tables.libra_custom_target_heads,disposition:'dependent'}}};
  assert.throws(()=>createRetainedDatabase({Database,sourcePath:f.sourcePath,targetPath:path.join(path.dirname(f.targetPath),'head.db'),
    targetSchema,policy:withHead}),{code:'RESET_COPY_OWNER_DESCRIPTION_INVALID'});
  const withoutWithdrawal={...unsafe};delete withoutWithdrawal.withdrawalClosure;
  assert.throws(()=>createRetainedDatabase({Database,sourcePath:f.sourcePath,targetPath:path.join(path.dirname(f.targetPath),'withdrawal.db'),
    targetSchema,policy:withoutWithdrawal}),{code:'RESET_COPY_OWNER_DESCRIPTION_INVALID'});
});

test('a retained copy with missing target dependency fails the independent read-only verification',t=>{
  const f=fixture(t),owner=readResetOwnerSnapshot({Database,sourcePath:f.sourcePath});
  createRetainedDatabase({Database,sourcePath:f.sourcePath,targetPath:f.targetPath,targetSchema,policy:reviewedPolicy(owner)});
  const db=new Database(f.targetPath);try{db.pragma('foreign_keys=OFF');
    db.prepare('DELETE FROM libra_custom_target_previews WHERE preview_id=?').run(f.committed.preview.previewDigest);
  }finally{db.close();}
  const source=new Database(f.sourcePath,{readonly:true}),target=new Database(f.targetPath,{readonly:true});
  try{source.exec('BEGIN');target.exec('BEGIN');assert.throws(()=>verifyRetainedCustomTargets(source,target,targetSchema.schemaManifest));}
  finally{source.exec('ROLLBACK');target.exec('ROLLBACK');source.close();target.close();}
});

for(const phase of ['database_copied','owners_normalized'])test('interruption at '+phase+' retries the exact target closure from the frozen source',async t=>{
  const f=fixture(t),root=path.dirname(f.sourcePath),operationRoot=path.join(root,'operations'),backupRoot=path.join(root,'backup'),
    workspace=path.join(root,'workspace'),protectedDir=path.join(root,'protected');
  for(const dir of [operationRoot,backupRoot,workspace,protectedDir])fs.mkdirSync(dir);
  const backupPath=path.join(backupRoot,'source.db');fs.copyFileSync(f.sourcePath,backupPath);
  const sourceDigest=fileDigest(f.sourcePath),owner=readResetOwnerSnapshot({Database,sourcePath:f.sourcePath}),
    options={Database,activePath:f.sourcePath,operationRoot,generationId:D('generation'),targetSchema,policy:reviewedPolicy(owner),
      storage:{roots:[workspace],protectedDirectories:[protectedDir]},backup:{databasePath:backupPath,receiptDigest:sourceDigest,
        verify(){assert.equal(fileDigest(backupPath),sourceDigest);}},assertStopped(){},reserveBytes:0n,
      normalizeRetained(){return {synthetic:true};},verifyRetained({targetPath}){
        const db=new Database(targetPath,{readonly:true});try{
          assert.deepEqual(db.prepare('SELECT intent_id FROM libra_custom_target_intents').all(),[{intent_id:f.committed.intent.intentId}]);
          assert.deepEqual(db.prepare('SELECT preview_id FROM libra_custom_target_previews').all(),[{preview_id:f.committed.preview.previewDigest}]);
          return {synthetic:true};
        }finally{db.close();}
      }};
  const interrupted=createOfflineFormationReset({...options,checkpoint(point){if(point===phase)throw new Error('injected interruption');}});
  await assert.rejects(interrupted.prepare(),/injected interruption/);
  const first=path.join(interrupted.paths.directory,'retained-attempt-1.db'),firstDigest=fileDigest(first),
    resumed=createOfflineFormationReset(options),result=await resumed.prepare();
  assert.equal(fileDigest(first),firstDigest);assert.equal(fileDigest(f.sourcePath),sourceDigest);
  assert.equal(path.basename(result.candidatePath),'retained-attempt-2.db');
  assert.deepEqual(await resumed.prepare(),result);
});
