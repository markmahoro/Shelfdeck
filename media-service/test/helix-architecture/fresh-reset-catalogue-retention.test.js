'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {fixture,schemaManifest,schemaDdl,Database}=require('./fixtures/us-adult-catalogue-store');
const {createUsAdultCatalogueStore}=require('../../src/helix/domains/libra/persistence/us-adult-catalogue-store');
const {buildOwnerRetentionPolicy}=require('../../scripts/formation-reset-owner-policy');
const {createRetainedDatabase}=require('../../scripts/formation-reset-copy');
const {canonicalJson}=require('../../src/helix/contracts/canonical-json');
const declaration=require('../../scripts/formation-reset-owner-retention.json');

function simulatedPolicy(){
  const before={schemaDigest:declaration.schemaDigest,tables:declaration.tables};
  try{
    const additions=[{table:'arca_offer_withdrawal_receipts',owner:'arca',disposition:'clear'},
      {table:'libra_custom_target_heads',owner:'libra',disposition:'clear'},
      {table:'libra_custom_target_intents',owner:'libra',disposition:'dependent'},
      {table:'libra_custom_target_previews',owner:'libra',disposition:'dependent'},
      {table:'libra_us_adult_catalogue_bases',owner:'libra',disposition:'dependent'}];
    const added=new Set(additions.map(row=>row.table));
    declaration.schemaDigest=schemaManifest.ddlDigest;
    declaration.tables=[...before.tables.filter(row=>!added.has(row.table)),...additions];
    return buildOwnerRetentionPolicy(schemaManifest);
  }finally{Object.assign(declaration,before);}
}

test('unreviewed combined schema cannot authorize a production Reset',()=>{
  assert.throws(()=>buildOwnerRetentionPolicy(schemaManifest),{code:'RESET_RETENTION_SCHEMA_UNREVIEWED'});
});
test('the exact retained Run carries its catalogue Basis while unselected task state leaves the online copy',t=>{
  const f=fixture(t);createUsAdultCatalogueStore(f.options).freeze(f.basis);
  const before=canonicalJson(f.db.prepare('SELECT * FROM libra_us_adult_catalogue_bases').all()),policy=simulatedPolicy();
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
