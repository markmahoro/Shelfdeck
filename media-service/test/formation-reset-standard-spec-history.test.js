'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Database=require('better-sqlite3');
const {canonicalDigest:D,canonicalJson}=require('../src/helix/contracts/canonical-json');
const {openSqliteKernel}=require('../src/helix/foundation/persistence/sqlite-kernel');
const {fixture:specFixture}=require('./helix-architecture/fixtures/custom-acceptance-spec-harness');
const {buildDecisionInputSet,buildDecisionBasisRevision}=require('../src/helix/domains/libra/model/decision-front-half-contracts');
const {resolveAcceptanceSpec}=require('../src/helix/domains/libra/model/acceptance-spec-contracts');
const {BETA_RECOMMENDED_RULES}=require('../src/helix/domains/arca/model/rule-template-contracts');
const history=require('./helix-architecture/fixtures/fresh-reset-standard-history.json');
const {buildOwnerRetentionPolicy}=require('../scripts/formation-reset-owner-policy');
const {createRetainedDatabase}=require('../scripts/formation-reset-copy');
const {verifyRetainedCustomTargets}=require('../scripts/formation-reset-verify');
const targetSchema={schemaManifest:require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),
  schemaDdl:fs.readFileSync(path.join(__dirname,'../src/helix/foundation/persistence/generated/clean-schema.sql'),'utf8')};
function policy(){return buildOwnerRetentionPolicy(targetSchema.schemaManifest);}
function fixture(t,record){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'reset-standard-history-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const sourcePath=path.join(root,'source.db'),targetPath=path.join(root,'target.db');
  openSqliteKernel({Database,databasePath:sourcePath,...targetSchema}).close();
  const db=new Database(sourcePath),spec=record.spec,basisDigest=D('basis-'+record.profile),packageDigest=D('package-'+record.profile),
    packageId=D({schema:'libra.on-deck-package-id@1',libraRunId:'run',packageRevision:1}),
    offerId=D({schema:'libra.product-offer-id@1',onDeckPackageId:packageId,packageDigest});
  try{
    db.exec("INSERT INTO arca_shelves(shelf_id,status) VALUES('shelf','active');\n"+
      "INSERT INTO arca_shelf_entries(shelf_entry_id,shelf_id,status) VALUES('collection','shelf','active')");
    db.prepare('INSERT INTO libra_subjects(subject_id,status,content_profile,structure_kind,intake_revision) VALUES(?,?,?,?,?)')
      .run(spec.subjectId,'active',spec.contentProfile,spec.structureKind,1);
    db.prepare('INSERT INTO libra_decision_basis_revisions(decision_basis_id,subject_id,basis_kind,basis_revision,status) VALUES(?,?,?,?,?)')
      .run(spec.decisionBasisId,spec.subjectId,'acceptance_spec',1,'ready');
    db.prepare('INSERT INTO libra_acceptance_specs(acceptance_spec_id,subject_id,shelf_id,decision_basis_id,product_scope_digest,spec_revision,spec_schema_ref,spec_json,spec_digest,record_digest,structure_kind,content_profile,published_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(spec.acceptanceSpecId,spec.subjectId,spec.targetShelfId,spec.decisionBasisId,spec.productScope.scopeDigest,spec.specRevision,
        record.rowSchemaRef,canonicalJson(spec),spec.specDigest,spec.recordDigest,spec.structureKind,spec.contentProfile,spec.publishedAtMs);
    const basis={subjectSnapshot:{subjectId:spec.subjectId},executionBasisDigest:basisDigest,acceptanceSpec:{acceptanceSpecId:spec.acceptanceSpecId,
      specDigest:spec.specDigest,recordDigest:spec.recordDigest,specRevision:spec.specRevision,productScopeDigest:spec.productScope.scopeDigest,shelfId:spec.targetShelfId}};
    db.prepare('INSERT INTO libra_runs(libra_run_id,subject_id,state,acceptance_spec_id,execution_basis_digest,execution_basis_record_json) VALUES(?,?,?,?,?,?)')
      .run('run',spec.subjectId,'completed',spec.acceptanceSpecId,basisDigest,canonicalJson(basis));
    db.prepare('INSERT INTO libra_product_packages(on_deck_package_id,offer_id,package_revision,libra_run_id,subject_id,shelf_id,acceptance_spec_id,acceptance_spec_record_digest,package_digest,related_disposition_set_digest,state) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(packageId,offerId,1,'run',spec.subjectId,spec.targetShelfId,spec.acceptanceSpecId,spec.recordDigest,packageDigest,D('related'),'published');
    db.prepare('INSERT INTO arca_acceptance_attempts(acceptance_attempt_id,offer_id,on_deck_package_id,package_digest,shelf_id,state) VALUES(?,?,?,?,?,?)')
      .run('attempt',offerId,packageId,packageDigest,'shelf','accepted');
    db.prepare('INSERT INTO arca_acceptance_decisions(acceptance_decision_id,acceptance_attempt_id,offer_id,on_deck_package_id,package_digest,shelf_id,result) VALUES(?,?,?,?,?,?,?)')
      .run('decision','attempt',offerId,packageId,packageDigest,'shelf','accepted');
    db.prepare('INSERT INTO arca_ondeck_custodies(custody_id,acceptance_decision_id,on_deck_package_id,package_digest,state) VALUES(?,?,?,?,?)')
      .run('custody','decision',packageId,packageDigest,'committed');
    db.exec("INSERT INTO arca_ondeck_runs(on_deck_run_id,custody_id,state) VALUES('deck','custody','committed');\n"+
      "INSERT INTO arca_ondeck_commit_receipts(receipt_id,on_deck_run_id,shelf_entry_id) VALUES('commit','deck','collection')");
    assert.deepEqual(db.pragma('foreign_key_check'),[]);
  }finally{db.close();}
  return {sourcePath,targetPath};
}
function ratedSpec(rating,revision){
  const without=(value,key)=>Object.fromEntries(Object.entries(value).filter(([name])=>name!==key)),base=specFixture().inputSet,
    subject={...base.subjectSnapshot,currentIdentityRevision:1,currentIdentityDigest:D('identity')};
  subject.snapshotDigest=D(without(subject,'snapshotDigest'));
  const projection={...base.shelfStandardProjection},standard={...projection.standard,
    profileRuleSets:[BETA_RECOMMENDED_RULES.profileRuleSets.find(item=>item.contentProfile==='movie')]};
  standard.standardDigest=D(without(standard,'standardDigest'));projection.standard=standard;
  projection.projectionResultDigest=D(without(projection,'projectionResultDigest'));
  const fact={schemaRef:'helix://contracts/types/PerceptionResolutionRevision/v1',factKind:'rating',factId:'rating-'+revision,
    factDigest:D('rating-'+revision),revision,resultKind:'found',resolvedValue:{factKind:'rating',value:rating},
    resolvedProvenance:{sourceKind:'shelfdeck_direct',winningPerceptionId:'direct-'+revision}},
    query={schemaRef:'helix://contracts/types/VersionedQueryResult/v1',providerDomain:'perception',queryContract:'perception.rating.resolve@1',
      queryVersion:1,inputDigest:D('query-'+revision),resultKind:'found',resultRevision:revision,resultDigest:fact.factDigest,expiresAtMs:1000},
    inputSet=buildDecisionInputSet({...base,subjectSnapshot:subject,shelfStandardProjection:projection,decisionFacts:[fact],queryResults:[query]}),
    decisionBasis=buildDecisionBasisRevision(inputSet,3,100,'rating-basis-'+revision);
  return resolveAcceptanceSpec({inputSet,decisionBasis,specRevision:1,producedAtMs:100,publishedAtMs:100});
}
const rated4=ratedSpec(4,1),rated5=ratedSpec(5,1),rated5Again=ratedSpec(5,2);
const standardCases=[...history.records.map(record=>({...record,era:'historical'})),
  ...['movie','series'].map(profile=>({profile,era:'current',rowSchemaRef:'libra.acceptance-spec@1',spec:specFixture(profile).baseSpec})),
  ...[[4,rated4],[5,rated5],[5,rated5Again]].map(([rating,spec],index)=>({profile:'movie',era:'current rating '+rating+' provenance '+index,
    rowSchemaRef:'libra.acceptance-spec@1',spec}))];
test('rated standard samples cover different requirements and distinct provenance without changing equal-rating semantics',()=>{
  assert.notEqual(rated4.specDigest,rated5.specDigest);assert.equal(rated5.specDigest,rated5Again.specDigest);
  assert.notEqual(rated5.recordDigest,rated5Again.recordDigest);
});
for(const record of standardCases)test('Reset retains the '+record.era+' '+record.profile+' standard Spec unchanged',t=>{
  const f=fixture(t,record);
  createRetainedDatabase({Database,...f,targetSchema,policy:policy()});
  const source=new Database(f.sourcePath,{readonly:true}),target=new Database(f.targetPath,{readonly:true});
  try{
    source.exec('BEGIN');target.exec('BEGIN');
    assert.deepEqual(target.prepare('SELECT * FROM libra_acceptance_specs').all(),source.prepare('SELECT * FROM libra_acceptance_specs').all());
    assert.equal(verifyRetainedCustomTargets(source,target,targetSchema.schemaManifest).count,0);
    assert.equal(target.prepare('SELECT count(*) n FROM libra_custom_target_intents').get().n,0);
    assert.deepEqual(target.pragma('foreign_key_check'),[]);
  }finally{source.exec('ROLLBACK');target.exec('ROLLBACK');source.close();target.close();}
});

test('a historical standard Spec on an uncommitted Run is not retained or resumed',t=>{
  const f=fixture(t,history.records[0]),db=new Database(f.sourcePath);
  try{db.pragma('foreign_keys=OFF');db.exec('DELETE FROM arca_ondeck_commit_receipts; DELETE FROM arca_ondeck_runs; '+
    "DELETE FROM arca_ondeck_custodies; DELETE FROM arca_acceptance_decisions; DELETE FROM arca_acceptance_attempts; DELETE FROM arca_shelf_entries; UPDATE libra_runs SET state='active'");}
  finally{db.close();}
  createRetainedDatabase({Database,...f,targetSchema,policy:policy()});
  const target=new Database(f.targetPath,{readonly:true});
  try{assert.equal(target.prepare('SELECT count(*) n FROM libra_acceptance_specs').get().n,0);
    assert.equal(target.prepare('SELECT count(*) n FROM libra_runs').get().n,0);
    assert.equal(target.prepare('SELECT count(*) n FROM fx_supporting_works').get().n,0);
  }finally{target.close();}
});

for(const corruption of ['wrong_schema_pair','changed_requirements','changed_digest','custom_masquerade'])
  test('historical standard retention rejects '+corruption,t=>{
    const record=structuredClone(history.records[0]);
    if(corruption==='wrong_schema_pair')record.rowSchemaRef='libra.acceptance-spec@1';
    if(corruption==='changed_requirements')record.spec.requirements.space.maxSizeGiB=51;
    if(corruption==='changed_digest')record.spec.specDigest=D('forged-semantic-digest');
    if(corruption==='custom_masquerade')record.spec.targetKind='user_custom';
    const f=fixture(t,record),before=fs.readFileSync(f.sourcePath);
    assert.throws(()=>createRetainedDatabase({Database,...f,targetSchema,policy:policy()}));
    assert.deepEqual(fs.readFileSync(f.sourcePath),before);
  });
