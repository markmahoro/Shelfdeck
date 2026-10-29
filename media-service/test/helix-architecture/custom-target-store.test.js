'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,schemaManifest,D,Database}=require('./fixtures/us-adult-analysis-basis-harness');
const {canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {BETA_RECOMMENDED_RULES}=require('../../src/helix/domains/arca/model/rule-template-contracts');
const {describeCustomRequirement}=require('../../src/helix/contracts/custom-acceptance-requirements');
const {buildCustomTargetPreview,confirmCustomTarget}=require('../../src/helix/domains/libra/model/custom-target-records');
const {createCustomTargetStore}=require('../../src/helix/domains/libra/persistence/custom-target-store');
const {createCommandCommitCoordinator}=require('../../src/helix/foundation/persistence/commit-foundation');
const {createRepositoryDefinition}=require('../../src/helix/foundation/persistence/owner-repository');
const tables=['libra_custom_target_previews','libra_custom_target_intents','libra_custom_target_heads','fx_command_receipts','fx_commit_markers','fx_audit_records'];

function harness(callback){return fixture(input=>{
  const db=new Database(input.databasePath),basis={subjectId:'subject',libraRunId:'run-1',runState:'frozen',runStateRevision:1,
    runStateDigest:D('run-state'),runPackageRevisionHead:0,runExecutionBasisDigest:D('basis'),baseAcceptanceSpecId:'five-star-spec',
    runAcceptanceSpecId:'five-star-spec',runSpecRecordDigest:D('spec-record'),runSpecDigest:D('spec'),
    baseSpecRecordDigest:D('spec-record'),baseSpecDigest:D('spec'),decisionHeadDigest:D('head'),decisionHeadAcceptanceSpecId:'five-star-spec',shelfId:'shelf',
    shelfStandardDigest:D('standard'),shelfStandardRevision:1,productScopeDigest:D('scope'),materialSetDigest:D('member-set'),
    identityDigest:D('identity'),gapEvidenceSetDigest:D('gaps'),customTargetRevision:0,handoffState:'no_offer',contentProfile:'movie',structureKind:'single'};
  try{
    db.exec("INSERT INTO libra_subjects(subject_id,status,content_profile,structure_kind) VALUES('subject','active','movie','single')");
    db.prepare('INSERT INTO libra_acceptance_specs(acceptance_spec_id,subject_id,shelf_id,shelf_standard_revision,shelf_standard_digest,product_scope_digest,spec_digest,record_digest,spec_json) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(basis.baseAcceptanceSpecId,basis.subjectId,basis.shelfId,basis.shelfStandardRevision,basis.shelfStandardDigest,basis.productScopeDigest,basis.baseSpecDigest,basis.baseSpecRecordDigest,'{}');
    db.prepare('UPDATE libra_runs SET subject_id=?,state=?,acceptance_spec_id=?').run(basis.subjectId,basis.runState,basis.baseAcceptanceSpecId);
    db.prepare('INSERT INTO libra_subject_decision_heads(subject_id,head_digest,current_acceptance_spec_id) VALUES(?,?,?)').run(basis.subjectId,basis.decisionHeadDigest,basis.baseAcceptanceSpecId);
    db.prepare('INSERT INTO libra_product_fact_revisions(product_fact_id,libra_run_id,fact_kind,fact_revision,fact_json,fact_digest) VALUES(?,?,?,?,?,?)')
      .run('identity','run-1','resolved_identity',1,'{}',basis.identityDigest);
    db.pragma('foreign_keys=ON');
    const store=createCustomTargetStore({...input,schemaManifest}),coordinator=createCommandCommitCoordinator({...input,schemaManifest}),
      requirements=BETA_RECOMMENDED_RULES.profileRuleSets.find(row=>row.contentProfile==='movie').decisionBranches.find(row=>row.rating===5).requirements;
    db.prepare('UPDATE libra_acceptance_specs SET spec_json=?').run(canonicalJson({requirements}));
    function preview(actorId='admin',revision=0){return buildCustomTargetPreview({basis:{...basis,customTargetRevision:revision},requirements,
      proposals:[{change:describeCustomRequirement(requirements,{requirementCode:'minimum_raster_unmet',targetId:'minimumRasterClass'}),
        evidenceRefs:[{resultId:'source-result',resultDigest:D('source-result')}]}],actorId,createdAtMs:1000+revision});}
    function confirm(value,key='confirm'){return confirmCustomTarget({preview:value,expectedPreviewDigest:value.previewDigest,currentBasis:value.basis,
      selectedChangeDigests:value.proposals.map(item=>item.changeDigest),acknowledged:true,actorId:value.actorId,idempotencyKey:key,confirmedAtMs:1100+value.basis.customTargetRevision});}
    function commit(kind,record,{key=kind==='intent'?record.idempotencyKey:'preview',requestDigest=kind==='intent'?record.requestDigest:D(key),
      readFence=input.unitOfWork.captureReadFence(),currentBasis=record.basis,resultEnvelope}={}){
      const domain=store.participant({kind,record,idempotencyKey:key,requestDigest,readFence,currentBasis}),id=D([kind,record.actorId,key]);
      return coordinator.execute({readFence,command:{commandReceiptId:id,ownerDomain:'libra',commandContract:'fixture.custom-target.'+kind,
        callerScope:record.actorId,idempotencyKey:key,requestDigest,targetType:'subject',targetId:record.basis.subjectId},domainParticipant:domain,
        commitMarker:{commitMarker:id,scopeType:'subject',scopeId:record.basis.subjectId,commitDigest:id},
        auditRecords:[{auditId:id,actorType:'admin',actorId:record.actorId,action:'custom-target.'+kind,scopeType:'subject',scopeId:record.basis.subjectId}],
        resultEnvelope:resultEnvelope||(value=>({resultSchemaRef:'fixture.custom-target-result@1',resultRef:value}))});
    }
    return callback({db,basis,store,preview,confirm,commit,unitOfWork:input.unitOfWork,freshStore:()=>createCustomTargetStore({...input,schemaManifest}),
      counts:()=>tables.map(table=>db.prepare('SELECT count(*) n FROM '+table).get().n)});
  }finally{db.close();}
});}

test('custom target preview, intent, scoped head, command receipt and audit survive a fresh Store instance',()=>harness(h=>{
  const preview=h.preview(),intent=h.confirm(preview);h.commit('preview',preview);const first=h.commit('intent',intent);
  const reopened=h.freshStore();
  assert.deepEqual(reopened.preview(preview.previewDigest),preview);
  assert.deepEqual(reopened.current({subjectId:h.basis.subjectId,productScopeDigest:h.basis.productScopeDigest}),intent);
  assert.deepEqual(h.store.findCommand('intent','admin','confirm').record,intent);
  assert.deepEqual(h.counts(),[1,1,1,2,2,2]);
  const readFence=h.unitOfWork.captureReadFence();h.db.exec("UPDATE libra_runs SET state='completed',state_revision=2");
  const replay=h.commit('intent',intent,{readFence});assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,first.receipt);
  assert.throws(()=>h.commit('intent',intent,{requestDigest:D('different')}),{code:'P3_COMMAND_IDEMPOTENCY_CONFLICT'});
  for(const table of tables.slice(0,3))assert.deepEqual(h.db.pragma('foreign_key_check('+table+')'),[]);
}));

test('two actors confirming revision zero cannot both advance the same product target',()=>harness(h=>{
  const a=h.preview('admin-a'),b=h.preview('admin-b');h.commit('preview',a);h.commit('preview',b);
  const selected=h.confirm(a);h.commit('intent',selected);const before=h.counts();
  assert.throws(()=>h.commit('intent',h.confirm(b)),{code:'LIBRA_CUSTOM_TARGET_PREVIEW_STALE'});
  assert.deepEqual(h.counts(),before);
  assert.equal(h.store.current({subjectId:h.basis.subjectId,productScopeDigest:h.basis.productScopeDigest}).intentId,selected.intentId);
  assert.equal(h.store.current({subjectId:h.basis.subjectId,productScopeDigest:D('another-scope')}),null);
}));

test('a later explicitly confirmed target advances exactly one revision without rewriting earlier evidence',()=>harness(h=>{
  const first=h.preview();h.commit('preview',first);const firstIntent=h.confirm(first);h.commit('intent',firstIntent);
  const second=h.preview('admin',1);h.commit('preview',second,{key:'preview-2'});const secondIntent=h.confirm(second,'confirm-2');
  h.commit('intent',secondIntent);assert.equal(h.store.current({subjectId:h.basis.subjectId,productScopeDigest:h.basis.productScopeDigest}).revision,2);
  assert.equal(h.store.findCommand('intent','admin','confirm').record.intentDigest,firstIntent.intentDigest);
  assert.equal(h.store.preview(first.previewDigest).previewDigest,first.previewDigest);
  assert.deepEqual(h.counts(),[2,2,1,4,4,4]);
  assert.throws(()=>h.db.prepare('UPDATE libra_custom_target_heads SET intent_id=?,record_digest=?').run(firstIntent.intentId,firstIntent.intentDigest),
    /FOREIGN KEY constraint failed/);
  assert.equal(h.store.current({subjectId:h.basis.subjectId,productScopeDigest:h.basis.productScopeDigest}).intentId,secondIntent.intentId);
}));

test('freshness checks reject related Owner drift even with a newly captured technical fence',()=>harness(h=>{
  const preview=h.preview();h.commit('preview',preview);const intent=h.confirm(preview),before=h.counts();
  for(const [change,restore]of[
    ["UPDATE libra_runs SET state_revision=2","UPDATE libra_runs SET state_revision=1"],
    ["UPDATE libra_runs SET package_revision_head=1","UPDATE libra_runs SET package_revision_head=0"],
    ["UPDATE libra_acceptance_specs SET spec_digest='"+D('other')+"'","UPDATE libra_acceptance_specs SET spec_digest='"+h.basis.baseSpecDigest+"'"],
    ["UPDATE libra_subject_decision_heads SET head_digest='"+D('other')+"'","UPDATE libra_subject_decision_heads SET head_digest='"+h.basis.decisionHeadDigest+"'"],
    ["UPDATE libra_run_material_manifests SET member_set_digest='"+D('other')+"'","UPDATE libra_run_material_manifests SET member_set_digest='"+h.basis.materialSetDigest+"'"],
    ["UPDATE libra_product_fact_revisions SET fact_digest='"+D('other')+"'","UPDATE libra_product_fact_revisions SET fact_digest='"+h.basis.identityDigest+"'"],
  ]){h.db.exec(change);assert.throws(()=>h.commit('intent',intent),{code:'LIBRA_CUSTOM_TARGET_PREVIEW_STALE'});assert.deepEqual(h.counts(),before);h.db.exec(restore);}
}));

test('a valid preview cannot introduce requirements that differ from the frozen base Spec',()=>harness(h=>{
  const preview=h.preview(),original=h.db.prepare('SELECT spec_json FROM libra_acceptance_specs').get().spec_json,stored=JSON.parse(original);
  stored.requirements.space.maxSizeGiB=40;h.db.prepare('UPDATE libra_acceptance_specs SET spec_json=?').run(canonicalJson(stored));
  assert.throws(()=>h.commit('preview',preview),{code:'LIBRA_CUSTOM_TARGET_PREVIEW_STALE'});
  assert.deepEqual(h.counts(),[0,0,0,0,0,0]);
}));

test('Store independently fences the frozen Run Spec, current decision pointer and original standard Spec',()=>harness(h=>{
  const row=h.db.prepare('SELECT * FROM libra_acceptance_specs').get(),columns=Object.keys(row),custom={...row,acceptance_spec_id:'custom-run-spec',
    spec_digest:D('custom-semantic'),record_digest:D('custom-record')};
  h.db.prepare('INSERT INTO libra_acceptance_specs('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').run(...columns.map(column=>custom[column]));
  h.db.prepare('UPDATE libra_runs SET acceptance_spec_id=?').run(custom.acceptance_spec_id);
  h.db.prepare('UPDATE libra_subject_decision_heads SET current_acceptance_spec_id=?').run(custom.acceptance_spec_id);
  Object.assign(h.basis,{runAcceptanceSpecId:custom.acceptance_spec_id,runSpecRecordDigest:custom.record_digest,runSpecDigest:custom.spec_digest,
    decisionHeadAcceptanceSpecId:custom.acceptance_spec_id});
  const preview=h.preview();h.commit('preview',preview);h.commit('intent',h.confirm(preview));
  const selected=h.store.current({subjectId:h.basis.subjectId,productScopeDigest:h.basis.productScopeDigest});
  assert.equal(selected.basis.runAcceptanceSpecId,'custom-run-spec');assert.equal(selected.basis.baseAcceptanceSpecId,'five-star-spec');
  assert.equal(selected.target.requirements.space.maxSizeGiB,50);
}));

test('late writes reject the original read view and a failed Result rolls back the complete intent commit',()=>harness(h=>{
  const preview=h.preview();h.commit('preview',preview);const intent=h.confirm(preview),before=h.counts(),readFence=h.unitOfWork.captureReadFence();
  h.db.exec("UPDATE libra_subjects SET intake_revision=2");
  assert.throws(()=>h.commit('intent',intent,{readFence}),{code:'P3_UOW_READ_FENCE_CHANGED'});assert.deepEqual(h.counts(),before);
  assert.throws(()=>h.commit('intent',intent,{resultEnvelope(){throw new Error('injected Result failure');}}),/injected Result failure/);
  assert.deepEqual(h.counts(),before);assert.equal(h.store.current({subjectId:h.basis.subjectId,productScopeDigest:h.basis.productScopeDigest}),null);
}));

test('SQLite enforces required typed record bindings, byte bounds and immutable repository access',()=>harness(h=>{
  const preview=h.preview(),columns=['preview_id','subject_id','libra_run_id','actor_id','idempotency_key','request_digest','record_schema_ref','record_json','record_digest','created_at_ms'],
    values=[preview.previewDigest,h.basis.subjectId,h.basis.libraRunId,'admin','key',D('request'),preview.schemaRef,canonicalJson(preview),preview.previewDigest,preview.createdAtMs],
    insert=h.db.prepare('INSERT INTO libra_custom_target_previews('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')');
  for(const [index,value]of[[0,null],[1,null],[3,null],[6,'wrong'],[7,'{}'],[7,JSON.stringify({...preview,extra:'x'.repeat(65536)})],[8,D('wrong')]]){
    const changed=[...values];changed[index]=value;assert.throws(()=>insert.run(...changed),/constraint failed/);
  }
  assert.deepEqual(h.counts(),[0,0,0,0,0,0]);
  for(const tableId of ['libra_custom_target_previews','libra_custom_target_intents'])
    assert.throws(()=>createRepositoryDefinition({repositoryId:'forbidden_mutation',owner:'libra',schemaManifest,
      statements:{rewrite:{kind:'update',tableId,setColumns:['record_json'],keyColumns:[tableId.endsWith('previews')?'preview_id':'intent_id']}}}),
      {code:'P3_REPOSITORY_IMMUTABLE_UPDATE'});
  assert.throws(()=>h.store.participant({kind:'preview',record:preview,idempotencyKey:'key',requestDigest:D('request'),currentBasis:h.basis}),
    {code:'LIBRA_CUSTOM_TARGET_READ_FENCE_REQUIRED'});
}));
