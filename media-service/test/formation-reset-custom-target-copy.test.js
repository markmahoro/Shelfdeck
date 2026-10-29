'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Database=require('better-sqlite3');
const {canonicalDigest:D,canonicalJson}=require('../src/helix/contracts/canonical-json');
const {openSqliteKernel}=require('../src/helix/foundation/persistence/sqlite-kernel');
const {fixture:specFixture}=require('./helix-architecture/fixtures/custom-acceptance-spec-harness');
const {createRetainedDatabase}=require('../scripts/formation-reset-copy');
const {buildOwnerRetentionPolicy}=require('../scripts/formation-reset-owner-policy');
const {readResetOwnerSnapshot}=require('../scripts/formation-reset-owner-snapshot');
const {verifyRetainedCustomTargets}=require('../scripts/formation-reset-verify');
const {createOfflineFormationReset}=require('../scripts/formation-reset-offline');
const {fileDigest}=require('../scripts/formation-reset-generation');
const declaration=require('../scripts/formation-reset-owner-retention.json');
const targetSchema={schemaManifest:require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),
  schemaDdl:fs.readFileSync(path.join(__dirname,'../src/helix/foundation/persistence/generated/clean-schema.sql'),'utf8')};

// The checked-in declaration intentionally predates the custom-target tables.
// Simulate the integration thread's proposed classifications in memory only;
// marking rows dependent must not itself be mistaken for selecting them.
function reviewedPolicy(owner){
  const before={schemaDigest:declaration.schemaDigest,tables:declaration.tables};
  try{
    declaration.schemaDigest=targetSchema.schemaManifest.ddlDigest;
    const simulated=new Set(['arca_offer_withdrawal_receipts','libra_custom_target_heads','libra_custom_target_intents','libra_custom_target_previews',
      'libra_us_adult_catalogue_bases']);
    declaration.tables=[...before.tables.filter(row=>!simulated.has(row.table)),
      {table:'arca_offer_withdrawal_receipts',owner:'arca',disposition:'clear'},
      {table:'libra_custom_target_heads',owner:'libra',disposition:'clear'},
      {table:'libra_custom_target_intents',owner:'libra',disposition:'dependent'},
      {table:'libra_custom_target_previews',owner:'libra',disposition:'dependent'},
      ...(targetSchema.schemaManifest.tables.some(row=>row.tableId==='libra_us_adult_catalogue_bases')
        ? [{table:'libra_us_adult_catalogue_bases',owner:'libra',disposition:'dependent'}] : [])];
    return buildOwnerRetentionPolicy(targetSchema.schemaManifest,owner);
  }finally{Object.assign(declaration,before);}
}

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'reset-custom-target-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const sourcePath=path.join(root,'source.db'),targetPath=path.join(root,'target.db');
  openSqliteKernel({Database,databasePath:sourcePath,...targetSchema}).close();
  const first=specFixture('movie','old-run-1'),second=specFixture('movie','old-run-2',{customTargetRevision:1}),
    committed=first.target([{requirementCode:'minimum_raster_unmet',targetId:'minimumRasterClass'}],'alice'),
    unused=second.target([{requirementCode:'minimum_raster_unmet',targetId:'minimumRasterClass'}],'bob'),
    usedSpec=first.build(committed),unusedSpec=second.build(unused,{specRevision:3}),base=first.baseSpec;
  const db=new Database(sourcePath),packages=[];
  try{
    db.pragma('foreign_keys=OFF');
    db.exec("INSERT INTO arca_shelves(shelf_id,status) VALUES('shelf','active');\n"+
      "INSERT INTO arca_shelf_entries(shelf_entry_id,shelf_id,status) VALUES('collection','shelf','active');\n"+
      "INSERT INTO libra_subjects(subject_id,status,content_profile,structure_kind,intake_revision) VALUES('subject','active','movie','single',1)");
    db.prepare('INSERT INTO libra_decision_basis_revisions(decision_basis_id,subject_id,basis_kind,basis_revision,status) VALUES(?,?,?,?,?)')
      .run(base.decisionBasisId,'subject','acceptance_spec',1,'ready');
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
        .run(preview.previewDigest,'subject',preview.basis.libraRunId,preview.actorId,'preview-'+preview.actorId,D(preview.actorId),
          preview.schemaRef,canonicalJson(preview),preview.previewDigest,preview.createdAtMs);
      db.prepare('INSERT INTO libra_custom_target_intents(intent_id,preview_id,subject_id,libra_run_id,product_scope_digest,target_revision,actor_id,idempotency_key,request_digest,record_schema_ref,record_json,record_digest,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(intent.intentId,intent.previewDigest,intent.subjectId,intent.libraRunId,intent.basis.productScopeDigest,intent.revision,
          intent.actorId,intent.idempotencyKey,intent.requestDigest,intent.schemaRef,canonicalJson(intent),intent.intentDigest,intent.confirmedAtMs);
    }
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
