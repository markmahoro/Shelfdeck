'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Database=require('better-sqlite3');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createOffdeckEntryQuery}=require('../../src/helix/domains/arca/application/offdeck-entry-query');

test('Off-deck search hydrates one page, while explicit selection captures every active entry',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'offdeck-entry-query-'));
  const generated=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated');
  const schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'),'utf8'));
  const databasePath=path.join(root,'test.db');
  const kernel=openSqliteKernel({Database,databasePath,schemaManifest,schemaDdl:fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8')});
  const seed=new Database(databasePath);
  try{
    seed.pragma('foreign_keys = OFF');
    seed.prepare('INSERT INTO arca_shelves (shelf_id,name) VALUES (?,?)').run('shelf','Movies');
    const entry=seed.prepare('INSERT INTO arca_shelf_entries (shelf_entry_id,shelf_id,status,current_inventory_revision) VALUES (?,?,?,?)');
    const fact=seed.prepare('INSERT INTO arca_inventory_product_facts (shelf_entry_id,inventory_revision,fact_kind,fact_json) VALUES (?,?,?,?)');
    const material=seed.prepare('INSERT INTO arca_inventory_materials (shelf_entry_id,inventory_revision,ordinal,size_bytes) VALUES (?,?,?,?)');
    seed.transaction(()=>{for(let i=0;i<1005;i++){
      const id='entry-'+String(i).padStart(4,'0');
      entry.run(id,'shelf',i<1000?'active':'offdecked',2);
      fact.run(id,2,'product_metadata',JSON.stringify({descriptiveFacts:{entries:[{key:'title',value:'Movie '+i}]}}));
      fact.run(id,1,'product_metadata',JSON.stringify({descriptiveFacts:{entries:[{key:'title',value:'Obsolete'}]}}));
      material.run(id,2,0,100+i);
    }})();
    const reads=[],uow=createSqliteUnitOfWork({kernel});
    const store=require('../../src/helix/domains/arca/persistence/offdeck-store').createOffdeckStore({schemaManifest,unitOfWork:uow,now:()=>10000});
    assert.deepEqual(store.entryFacts('entry-0000'),store.allEntryFacts().find(e=>e.shelf_entry_id==='entry-0000'));
    assert.equal(store.entryFacts('entry-1001'),null);assert.equal(store.entryFacts('missing'),null);

    const unitOfWork={execute(participants){
      return uow.execute(participants.map(participant=>({...participant,execute(context){
        return participant.execute({...context,repository(id){
          const repo=context.repository(id);
          return {invoke(statement,args){reads.push({statement,args});return repo.invoke(statement,args);}};
        }});
      }})));
    }};
    const query=createOffdeckEntryQuery({schemaManifest,unitOfWork});
    assert.deepEqual(query.summary(),{currentCount:1000,shelves:[{shelfId:'shelf',name:'Movies'}]});
    assert.deepEqual(reads.map(read=>read.statement),['counts','shelf_names']);reads.length=0;
    const first=query.search({q:'Movie',limit:10});
    assert.equal(first.items.length,10);assert.ok(first.nextCursor);
    assert.equal(first.items[0].displayIdentity,'Movie 0');assert.equal(first.items[0].occupancyBytes,100);
    assert.equal(reads.filter(read=>read.statement==='metadata').length,10);
    assert.equal(reads.filter(read=>read.statement==='materials').length,10);
    assert.equal(query.search({q:'Movie',limit:10,cursor:first.nextCursor}).items[0].shelfEntryId,'entry-0010');
    assert.throws(()=>query.search({q:'different',cursor:first.nextCursor}),/Invalid/);
    assert.deepEqual(query.search({q:'Obsolete'}).items,[]);
    reads.length=0;
    const selection=query.selection();
    assert.equal(selection.shelfEntryIds.length,1000);
    assert.deepEqual(reads.map(read=>read.statement),['selection']);
    assert.equal(new Set(selection.shelfEntryIds).size,1000);
    assert.equal(query.search({q:'Movie 1004'}).items.length,0);
    assert.throws(()=>query.display(selection.shelfEntryIds),/limited/);
    assert.equal(query.display(['entry-1004'])[0].displayIdentity,'Movie 1004');
    const candidate=seed.prepare('INSERT INTO arca_offdeck_review_candidates (candidate_id,candidate_kind,shelf_entry_id,state,created_at_ms,condition_evidence_json) VALUES (?,?,?,?,?,?)');
    const caseRow=seed.prepare('INSERT INTO arca_offdeck_cases (offdeck_case_id,shelf_entry_id,state,recovery_revision,created_at_ms,terminal_at_ms) VALUES (?,?,?,?,?,?)');
    for(let i=0;i<60;i++){
      const id='entry-'+String(i).padStart(4,'0');
      candidate.run('candidate-'+String(i).padStart(2,'0'),'entry',id,'open',i,'{}');
      caseRow.run('case-'+String(i).padStart(2,'0'),id,i<10?'executing':'completed',1,i,i<10?null:100-i);
    }
    reads.length=0;
    const suggestions=query.candidates();
    assert.equal(suggestions.candidates.length,25);assert.equal(suggestions.candidateCount,60);
    assert.equal(reads.filter(read=>read.statement==='metadata').length,25);
    const next=query.candidates({cursor:suggestions.nextCursor});
    assert.equal(next.candidates[0].candidate_id,'candidate-25');
    assert.equal(query.candidates({cursor:next.nextCursor}).candidates.length,10);
    const completed=query.cases({classification:'completed',limit:5});
    assert.deepEqual(completed.counts,{active:10,completed:50});
    assert.equal(completed.items[0].offdeckCaseId,'case-10');
    assert.equal(query.cases({classification:'completed',limit:5,cursor:completed.nextCursor}).items[0].offdeckCaseId,'case-15');
    assert.throws(()=>query.cases({classification:'active',cursor:completed.nextCursor}),/Invalid/);
    assert.equal(query.cases().items.length,10);
    seed.prepare('UPDATE arca_inventory_product_facts SET fact_json=? WHERE shelf_entry_id=? AND inventory_revision=2').run(
      JSON.stringify({descriptiveFacts:{entries:[{key:'series_title',value:'Demo Show'}]}}),'entry-0000');
    seed.prepare('UPDATE arca_shelf_entries SET structure_kind=? WHERE shelf_entry_id=?').run('season','entry-0000');
    const identity=seasonNumber=>({identityDigest:'a'.repeat(64),structureKind:'season',contentProfile:'series',identityKind:'tmdb_series_season',
      providerIdentities:[{provider:'tmdb',namespace:'tmdb_series',providerKey:'1399',seasonNumber}]});
    const canonical=require('../../src/helix/domains/arca/model/canonical-content-identity').canonicalContentIdentity;
    seed.prepare('UPDATE arca_shelf_entries SET canonical_identity_key=? WHERE shelf_entry_id=?').run(canonical('shelf',identity(1)).canonicalIdentityKey,'entry-0000');
    fact.run('entry-0000',2,'resolved_identity',JSON.stringify(identity(1)));
    assert.deepEqual(query.search({q:'Demo Show'}).items.map(item=>item.displayIdentity),['Demo Show']);
    assert.equal(query.display(['entry-0000'])[0].displayIdentity,'Demo Show');
    assert.equal(query.display(['entry-0000'])[0].seasonNumber,1);
    assert.equal(query.candidates().entries.find(item=>item.shelfEntryId==='entry-0000').displayIdentity,'Demo Show');
    seed.prepare('UPDATE arca_shelf_entries SET status=? WHERE shelf_entry_id=?').run('offdecked','entry-0000');
    assert.deepEqual(query.search({q:'Demo Show'}).items,[]);
    assert.equal(query.display(['entry-0000'])[0].displayIdentity,'Demo Show');

    assert.equal(query.display(['entry-0000'])[0].seasonNumber,1,'Off-decked history retains its Season');
    assert.equal(query.display(['entry-0001'])[0].seasonNumber,null,'Movie display has no Season');
    seed.prepare('UPDATE arca_inventory_product_facts SET fact_json=? WHERE shelf_entry_id=? AND fact_kind=?').run(JSON.stringify(identity(2)),'entry-0000','resolved_identity');
    assert.throws(()=>query.display(['entry-0000']),/Season identity/);

  }finally{seed.close();kernel.close();fs.rmSync(root,{recursive:true,force:true});}
});
