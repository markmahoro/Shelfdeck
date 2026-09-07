'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createArcaCareApplication}=require('../../src/helix/domains/arca/application/care-query');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Database=require('better-sqlite3');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
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
  const app=createArcaCareApplication({contextReader:{store:{listWorkCases:workStore.list,
    workDisplay(ids){reads.push(...ids);return new Map(ids.map(id=>[id,{displayIdentity:id,targetShelfId:'shelf',targetShelfName:'Films'}]));}},
    read(){throw Error('A work list must not hydrate full Aftercare context for display metadata.');}},coordinator:{caseProgress:()=>({stage:'queued'}),caseDetail:()=>({contract:'aftercare_process_actual_plans@1',stages:[]})}});
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
  }finally{seed.close();kernel.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('Shelf basis updates wake reconciliation without running one workflow per Entry in HTTP',()=>{
  let wake=0;
  const app=createArcaCareApplication({contextReader:{store:{listShelfEntryIds(){throw Error('A settings request must not enumerate Shelf Entries.');}},
    read(){throw Error('A settings request must not hydrate every Entry.');}},
    coordinator:{reconcile(){throw Error('A settings request must not start workflows.');}},wake(){wake++;}});
  assert.deepEqual(app.shelfBasisChanged('shelf'),{shelfId:'shelf'});assert.equal(wake,1);
});
