'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createArcaCareApplication}=require('../../src/helix/domains/arca/application/care-query');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Database=require('better-sqlite3');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createAftercareStore}=require('../../src/helix/domains/arca/persistence/aftercare-store');
const {createCareWorkStore}=require('../../src/helix/domains/arca/persistence/care-work-store');

test('Care work pages prioritize live Cases and read only the requested page',()=>{
  const cases=Array.from({length:80},(_,i)=>({aftercareCaseId:'case-'+i,shelfEntryId:'entry-'+i,
    state:i===0?'active':i===1?'queued':'resolved',createdAtMs:i+1,terminalAtMs:i>1?100+i:null,
    careRequirement:{typedParameters:[{value:'video_codec_unmet'}]}}));
  const reads=[];
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'care-work-query-')),generated=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated'),
    schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'),'utf8')),
    kernel=openSqliteKernel({Database,databasePath:path.join(root,'test.db'),schemaManifest,schemaDdl:fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8')}),
    seed=new Database(path.join(root,'test.db'));
  try{
  seed.pragma('foreign_keys = OFF');
  const insert=seed.prepare('INSERT INTO arca_aftercare_cases (aftercare_case_id,shelf_entry_id,care_basis_json,care_requirement_json,case_generation,trigger_digest,state,created_at_ms,terminal_at_ms,terminal_reason_code) VALUES (?,?,?,?,?,?,?,?,?,?)');
  for(const item of cases)insert.run(item.aftercareCaseId,item.shelfEntryId,'{}',JSON.stringify(item.careRequirement),1,'a'.repeat(64),item.state,item.createdAtMs,item.terminalAtMs,null);
  insert.run('never-admitted','entry-extra','{}','{}',1,'b'.repeat(64),'invalidated',200,201,'queued_basis_changed');
  const workStore=createCareWorkStore({schemaManifest,unitOfWork:createSqliteUnitOfWork({kernel})});
  const app=createArcaCareApplication({contextReader:{store:{listWorkCases:workStore.list,caseEvidence:()=>null,
    workDisplay(ids){reads.push(...ids);return new Map(ids.map(id=>[id,{displayIdentity:id,targetShelfId:'shelf',targetShelfName:'Films'}]));}},
    read(){throw Error('A work list must not hydrate full Aftercare context for display metadata.');}},coordinator:{projectMany:()=>new Map(),caseProgress:()=>({stage:'queued'}),caseDetail:()=>({contract:'aftercare_process_actual_plans@1',stages:[]})}});
  const first=app.list({view:'work',limit:2});
  assert.deepEqual(first.items.map(row=>row.state),['active','resolved']);
  assert.deepEqual(reads,['entry-0','entry-79']);
  assert.ok(first.nextCursor);
  const second=app.list({view:'work',limit:2,cursor:first.nextCursor});
  assert.deepEqual(second.items.map(item=>item.aftercareCaseId),['case-78','case-77']);
  assert.deepEqual(first.counts,{in_progress:1,completed:78});
  assert.deepEqual(app.list({view:'work',aftercareCaseId:'case-1'}).items,[]);
  assert.deepEqual(app.list({view:'work',aftercareCaseId:'never-admitted'}).items,[]);
  assert.equal(app.list({view:'work',classification:'completed',limit:1}).items[0].aftercareCaseId,'case-79');
  reads.length=0;
  assert.equal(app.list({view:'work',aftercareCaseId:'case-2'}).items[0].aftercareCaseId,'case-2');
  assert.deepEqual(reads,['entry-2']);
  // A batch may finish several Cases at exactly the same millisecond.
  // The merge order must match each SQL page before offsets are advanced.
  seed.prepare("UPDATE arca_aftercare_cases SET terminal_at_ms=500 WHERE state='resolved'").run();
  const seen=[];let cursor;
  do{const page=workStore.list({limit:3,cursor});seen.push(...page.items.map(item=>item.aftercareCaseId));cursor=page.nextCursor;}while(cursor);
  assert.equal(seen.length,79);assert.equal(new Set(seen).size,79);
  assert.deepEqual(seen.slice(0,4),['case-0','case-79','case-78','case-77']);
  insert.run('failed-history','entry-extra','{}','{"typedParameters":[]}',1,'c'.repeat(64),'unresolved',800,900,'settlement_or_commit_failed');
  insert.run('ended-history','entry-extra','{}','{"typedParameters":[]}',1,'d'.repeat(64),'invalidated',801,901,'basis_changed');
  const attention=app.list({view:'work',classification:'attention_required'});
  assert.equal(attention.items.length,0);
  assert.equal(attention.counts.ended,2);
  const ended=app.list({view:'work',classification:'ended',limit:1});
  assert.equal(ended.items[0].state,'invalidated');
  const failed=app.list({view:'work',classification:'ended',limit:1,cursor:ended.nextCursor});
  assert.equal(failed.items[0].state,'unresolved');
  assert.equal(failed.items[0].classification,'ended');
  assert.equal(failed.items[0].reasonCode,'settlement_or_commit_failed');
  assert.equal(failed.nextCursor,null);
  seed.prepare("UPDATE arca_aftercare_cases SET care_basis_json=? WHERE aftercare_case_id='failed-history'").run(JSON.stringify({inventoryRevision:1,standardRevision:3}));
  seed.prepare("INSERT INTO arca_shelf_entries (shelf_entry_id,current_inventory_revision) VALUES ('entry-extra',2)").run();
  const material=seed.prepare('INSERT INTO arca_inventory_materials (shelf_entry_id,inventory_revision,ordinal,role,size_bytes) VALUES (?,?,?,?,?)');
  material.run('entry-extra',1,0,'primary_payload',11666913036);
  material.run('entry-extra',1,1,'poster',500);
  material.run('entry-extra',2,0,'primary_payload',4027793937);
  const evidence=createAftercareStore({schemaManifest,unitOfWork:createSqliteUnitOfWork({kernel})}).caseEvidence('failed-history');
  assert.deepEqual(evidence,{objective:null,inventoryRevision:1,standardRevision:3,originalPrimaryBytes:11666913036,currentInventoryRevision:2,currentPrimaryBytes:4027793937});
  assert.equal(seed.prepare("SELECT state FROM arca_aftercare_cases WHERE aftercare_case_id='failed-history'").get().state,'unresolved');
  }finally{seed.close();kernel.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('Shelf basis updates wake reconciliation without running one workflow per Entry in HTTP',()=>{
  let wake=0;
  const app=createArcaCareApplication({contextReader:{store:{listShelfEntryIds(){throw Error('A settings request must not enumerate Shelf Entries.');}},
    read(){throw Error('A settings request must not hydrate every Entry.');}},
    coordinator:{reconcile(){throw Error('A settings request must not start workflows.');}},wake(){wake++;}});
  assert.deepEqual(app.shelfBasisChanged('shelf'),{shelfId:'shelf'});assert.equal(wake,1);
});
