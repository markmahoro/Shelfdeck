'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Database=require('better-sqlite3');
const {createRepositoryDefinition,bindRepository}=require('../../src/helix/foundation/persistence/owner-repository');
const tables=[{tableId:'cases',owner:'arca',columns:['id','entry_id']},{tableId:'entries',owner:'arca',columns:['id','shelf_id','metadata']},
  {tableId:'foreign_table',owner:'libra',columns:['id']}];
function definition(overrides={}){return {repositoryId:'joined_test',owner:'arca',schemaManifest:{tables},statements:{page:{
  kind:'select-joined-page',tableId:'cases',columns:['id','entry_id'],maxItems:26,safeIntegers:true,
  joins:[{tableId:'entries',alias:'entry',on:[{column:'id',otherAlias:'base',otherColumn:'entry_id'}]}],
  filters:[{alias:'entry',column:'shelf_id',kind:'equals',parameter:'shelf',optional:true},
    {alias:'entry',column:'metadata',kind:'json_entry_text',path:'$.descriptiveFacts.entries',keys:['title','display_title'],parameter:'query',optional:true}],
  orderBy:[{column:'id',direction:'asc'}],...overrides}}};}
test('UAT-212 owner-local joined paging filters before bounding without treating unrelated JSON as the title',()=>{
  const db=new Database(':memory:');
  try{
    db.exec('CREATE TABLE cases(id TEXT,entry_id TEXT); CREATE TABLE entries(id TEXT,shelf_id TEXT,metadata TEXT)');
    const insert=db.prepare('INSERT INTO entries VALUES(?,?,?)');
    for(let i=0;i<80;i++){
      db.prepare('INSERT INTO cases VALUES(?,?)').run(String(i).padStart(3,'0'),'entry-'+i);
      insert.run('entry-'+i,'shelf',JSON.stringify({descriptiveFacts:{entries:[{key:'title',value:i>=75?'Late Movie':'Earlier'},
        {key:'plot',value:'Late Movie'}]}}));
    }
    const spec=createRepositoryDefinition(definition()),repo=bindRepository(spec,db,()=>true);
    assert.equal(spec.readOnly,true);assert.deepEqual(spec.tableIds,['cases','entries']);
    const params={query:'Late Movie',shelf:'shelf',offset:0,limit:2};
    assert.deepEqual(repo.invoke('page',params).map(row=>row.id),['075','076']);
    assert.deepEqual(repo.invoke('page',{...params,offset:2}).map(row=>row.id),['077','078']);
    assert.equal(repo.invoke('page',{...params,shelf:'other'}).length,0);
    assert.throws(()=>repo.invoke('page',{...params,limit:27}),{code:'P3_REPOSITORY_INVALID_PAGE_LIMIT'});
  }finally{db.close();}
});
test('UAT-212 joined reads retain Owner, identifier and raw SQL fences',()=>{
  assert.throws(()=>createRepositoryDefinition(definition({joins:[{tableId:'foreign_table',alias:'foreign',on:[]}]})),{code:'P3_REPOSITORY_OWNER_MISMATCH'});
  assert.throws(()=>createRepositoryDefinition(definition({sql:'SELECT 1'})),{code:'P3_REPOSITORY_RAW_SQL_FORBIDDEN'});
  assert.throws(()=>createRepositoryDefinition(definition({filters:[{column:'id',kind:'equals',parameter:'bad;sql'}]})),{code:'P3_REPOSITORY_INVALID_IDENTIFIER'});
});
