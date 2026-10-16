'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Database=require('better-sqlite3');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createArcaCollectionQuery}=require('../../src/helix/domains/arca/application/collection-query');
const {createOffdeckEntryQuery}=require('../../src/helix/domains/arca/application/offdeck-entry-query');
const {createPeopleStore}=require('../../src/helix/domains/people/persistence/people-store');
const {createWorkResultReader}=require('../../src/helix/foundation/execution/work-result-reader');
const {createProcurementFieldStatusQuery}=require('../../src/helix/domains/procurement/application/field-procurement-status-query');

test('Overview aggregates 4000 SQLite entries in bounded health pages without loading historical lists',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'overview-bounded-'));
  const generated=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated');
  const schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'),'utf8'));
  const databasePath=path.join(root,'test.db');
  const kernel=openSqliteKernel({Database,databasePath,schemaManifest,schemaDdl:fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8')});
  const seed=new Database(databasePath);
  t.after(()=>{seed.close();kernel.close();fs.rmSync(root,{recursive:true,force:true});});
  seed.pragma('foreign_keys=OFF');
  seed.prepare('INSERT INTO arca_shelves (shelf_id,name,status) VALUES (?,?,?)').run('shelf','Movies','active');
  const entry=seed.prepare('INSERT INTO arca_shelf_entries (shelf_entry_id,shelf_id,status,canonical_identity_revision,current_inventory_revision,current_deck_fact_revision,created_at_ms) VALUES (?,?,?,?,?,?,?)');
  const identity=seed.prepare('INSERT INTO arca_canonical_identity_revisions (shelf_entry_id,revision,provider_key) VALUES (?,?,?)');
  const candidate=seed.prepare('INSERT INTO arca_offdeck_review_candidates (candidate_id,state,condition_evidence_json) VALUES (?,?,?)');
  const person=seed.prepare('INSERT INTO people_persons (person_id,status) VALUES (?,?)');
  seed.transaction(()=>{for(let i=0;i<4005;i++){
    const id='entry-'+String(i).padStart(4,'0');entry.run(id,'shelf',i<4000?'active':'offdecked',1,1,1,Date.UTC(2026,8,1)+i);
    identity.run(id,1,'Movie '+i);candidate.run('candidate-'+i,i<4000?'open':'stale','{}');person.run('person-'+i,i<4000?'active':'merged');
  }})();
  const reads=[],uow=createSqliteUnitOfWork({kernel});
  const unitOfWork={execute(participants){return uow.execute(participants.map(participant=>({...participant,execute(context){
    return participant.execute({...context,repository(id){const repo=context.repository(id);return {invoke(statement,parameters){
      const result=repo.invoke(statement,parameters);reads.push({statement,rows:Array.isArray(result)?result.length:1});return result;
    }};}});
  }})));}};
  const dependencies={schemaManifest,unitOfWork},healthSizes=[];
  let pagesSinceYield=0,maxPagesBetweenYields=0,yields=0,finished=false;
  t.after(()=>{finished=true;});
  const heartbeat=()=>{if(finished)return;maxPagesBetweenYields=Math.max(maxPagesBetweenYields,pagesSinceYield);pagesSinceYield=0;yields+=1;setImmediate(heartbeat);};
  setImmediate(heartbeat);
  const query=createArcaCollectionQuery({...dependencies,posterReader:async()=>null,healthReaderMany(ids){
    pagesSinceYield+=1;healthSizes.push(ids.length);assert.ok(ids.length<=10);return new Map(ids.map(id=>[id,{state:Number(id.slice(-4))%2?'healthy':'attention_required'}]));
  }});
  const began=performance.now();const result=await query.overviewStats(Date.UTC(2026,8,9));
  finished=true;assert.ok(yields>=40);assert.ok(maxPagesBetweenYields<=10);
  assert.equal(result.currentCount,4000);assert.equal(result.monthNewCount,4000);
  assert.equal(result.healthyCount,2000);assert.equal(result.healthAttentionCount,2000);
  assert.equal(result.recentOnDeck.length,5);assert.equal(result.recentOnDeck[0].displayIdentity,'Movie 3999');
  assert.ok(!reads.some(row=>['list_entry_index','list_entries','list_all_facts'].includes(row.statement)));
  assert.equal(reads.filter(row=>row.statement==='overview_entries').length,401);
  assert.ok(reads.filter(row=>row.statement==='overview_entries').every(row=>row.rows<=10));
  reads.length=0;
  assert.deepEqual(createOffdeckEntryQuery(dependencies).overviewStats(),{attentionCount:4000});
  assert.deepEqual(reads.map(row=>row.statement),['candidate_counts']);reads.length=0;
  assert.deepEqual(createPeopleStore(dependencies).overviewStats(),{activePersonCount:4000,mergedPersonCount:5,
    openRegistrationCandidateCount:0,openMergeCandidateCount:0});
  assert.deepEqual(reads.map(row=>row.statement),['overview_counts','overview_registration_counts','overview_merge_counts']);
  const workReader=createWorkResultReader(dependencies),field=createProcurementFieldStatusQuery({...dependencies,workResultReader:workReader});
  assert.equal(field.overviewScan('field').accessAvailable,true);
  seed.prepare('INSERT INTO fx_supporting_works (work_id,owner_domain,process_type,process_id,work_kind,state,created_at_ms) VALUES (?,?,?,?,?,?,?)')
    .run('failed','procurement','material_field','field','field_observation','failed',1);
  seed.prepare('INSERT INTO fx_work_attempts (attempt_id,work_id,ordinal,state,failure_code) VALUES (?,?,?,?,?)')
    .run('failed-attempt','failed',1,'failed','FIELD_OBSERVATION_ROOT_UNAVAILABLE');
  assert.equal(field.overviewScan('field').accessAvailable,false);
  seed.prepare('UPDATE fx_supporting_works SET state=? WHERE work_id=?').run('running','failed');
  assert.equal(field.overviewScan('field').accessAvailable,true);
  t.diagnostic(JSON.stringify({entries:4000,maxHealthPage:Math.max(...healthSizes),elapsedMs:Math.round(performance.now()-began)}));
});
