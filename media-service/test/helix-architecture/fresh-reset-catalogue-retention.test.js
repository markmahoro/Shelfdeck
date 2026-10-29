'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {fixture,schemaManifest,schemaDdl,Database}=require('./fixtures/us-adult-catalogue-store');
const {createUsAdultCatalogueStore}=require('../../src/helix/domains/libra/persistence/us-adult-catalogue-store');
const {buildOwnerRetentionPolicy}=require('../../scripts/formation-reset-owner-policy');
const {createRetainedDatabase}=require('../../scripts/formation-reset-copy');
const {canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {fixture:specFixture}=require('./fixtures/custom-acceptance-spec-harness');

function reviewedPolicy(){return buildOwnerRetentionPolicy(schemaManifest);}

test('unreviewed combined schema cannot authorize a production Reset',()=>{
  assert.throws(()=>buildOwnerRetentionPolicy({...schemaManifest,ddlDigest:'0'.repeat(64)}),{code:'RESET_RETENTION_SCHEMA_UNREVIEWED'});
});
test('the exact retained Run carries its catalogue Basis while unselected task state leaves the online copy',t=>{
  const f=fixture(t);createUsAdultCatalogueStore(f.options).freeze(f.basis);
  // Model the immutable standard Spec that an actually retained Run carries.
  // The general catalogue fixture intentionally omits this unrelated fact.
  const spec=specFixture('western_adult').baseSpec;
  f.db.prepare('INSERT INTO arca_shelves(shelf_id,status) VALUES(?,?)').run(spec.targetShelfId,'active');
  f.db.prepare('INSERT INTO libra_decision_basis_revisions(decision_basis_id,subject_id,basis_kind,basis_revision,status) VALUES(?,?,?,?,?)')
    .run(spec.decisionBasisId,spec.subjectId,'acceptance_spec',1,'ready');
  f.db.prepare('INSERT INTO libra_acceptance_specs(acceptance_spec_id,subject_id,shelf_id,decision_basis_id,product_scope_digest,spec_revision,spec_schema_ref,spec_json,spec_digest,record_digest,structure_kind,content_profile,published_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(spec.acceptanceSpecId,spec.subjectId,spec.targetShelfId,spec.decisionBasisId,spec.productScope.scopeDigest,spec.specRevision,
      spec.schemaRef,canonicalJson(spec),spec.specDigest,spec.recordDigest,spec.structureKind,spec.contentProfile,spec.publishedAtMs);
  const basis={subjectSnapshot:{subjectId:spec.subjectId},executionBasisDigest:f.args.snapshot.run.executionBasisDigest,
    acceptanceSpec:{acceptanceSpecId:spec.acceptanceSpecId,specDigest:spec.specDigest,recordDigest:spec.recordDigest,
      specRevision:spec.specRevision,productScopeDigest:spec.productScope.scopeDigest,shelfId:spec.targetShelfId}};
  f.db.prepare("UPDATE libra_runs SET acceptance_spec_id=?,execution_basis_record_json=?,state='completed' WHERE libra_run_id='run'")
    .run(spec.acceptanceSpecId,canonicalJson(basis));
  const before=canonicalJson(f.db.prepare('SELECT * FROM libra_us_adult_catalogue_bases').all()),policy=reviewedPolicy();
  assert.equal(policy.tables.libra_us_adult_catalogue_bases.disposition,'dependent');
  assert.ok(policy.edges.some(edge=>edge.parent==='libra_runs'&&edge.child==='libra_us_adult_catalogue_bases'));
  // This fixture seed stands for the exact Run selected by Arca's retention
  // closure. It does not introduce a new production root retention rule.
  const selected={...policy,seeds:[...policy.seeds,{owner:'libra',table:'libra_runs',key:{libra_run_id:'run'}}]};
  for(const [name,copyPolicy,count]of [['preserved',selected,1],['cleared',policy,0]]){
    const targetPath=path.join(f.root,name+'.db'),receipt=createRetainedDatabase({Database,sourcePath:f.databasePath,targetPath,policy:copyPolicy,
      targetSchema:{schemaManifest,schemaDdl}}),copy=new Database(targetPath,{readonly:true});
    try{
      assert.equal(copy.prepare('SELECT count(*) n FROM libra_us_adult_catalogue_bases').get().n,count);
      assert.equal(receipt.tables.find(row=>row.table==='libra_us_adult_catalogue_bases').retained,count);
      if(count)assert.equal(canonicalJson(copy.prepare('SELECT * FROM libra_us_adult_catalogue_bases').all()),before);
      assert.deepEqual(copy.pragma('foreign_key_check'),[]);assert.equal(copy.pragma('integrity_check',{simple:true}),'ok');
    }finally{copy.close();}
  }
  assert.equal(canonicalJson(f.db.prepare('SELECT * FROM libra_us_adult_catalogue_bases').all()),before);
});
