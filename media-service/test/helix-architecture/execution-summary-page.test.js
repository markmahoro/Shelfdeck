'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Database=require('better-sqlite3');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createWorkResultReader}=require('../../src/helix/foundation/execution/work-result-reader');

test('Execution summary pages are exact-scope, bounded, read-only and omit every payload',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'execution-summary-'));
  const generated=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated');
  const schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'),'utf8'));
  const kernel=openSqliteKernel({Database,databasePath:path.join(root,'db'),schemaManifest,
    schemaDdl:fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8')});
  t.after(()=>{kernel.close();fs.rmSync(root,{recursive:true,force:true});});
  kernel.runPrimitive(({prepare})=>{
    prepare('PRAGMA foreign_keys=OFF').run();
    const work=prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,state) VALUES(?,?,?,?,?)');
    work.run('work','libra','libra_run','run','running');work.run('foreign','arca','libra_run','run','running');
    const event=prepare('INSERT INTO fx_workflow_events(event_id,work_id,owner_domain,capability_ref,state,ready_at_ms) VALUES(?,?,?,?,?,?)');
    for(let i=0;i<203;i++)event.run('event-'+String(i).padStart(3,'0'),'work','libra','capability','executing',10);
    event.run('foreign-event','foreign','arca','capability','executing',10);
    const attempt=prepare('INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,state,outcome_kind,started_at_ms,finished_at_ms) VALUES(?,?,?,?,?,?,?)');
    attempt.run('old','event-001',1,'completed','failed',10,11);
    attempt.run('new','event-001',2,'executing',null,12,null);
    // An unrelated payload is present but must never be queried by the summary.
    prepare('INSERT INTO fx_event_result_bindings(result_id,event_id,result_json,result_digest) VALUES(?,?,?,?)').run('result','event-001',JSON.stringify({payload:'large'.repeat(1000)}),'a'.repeat(64));
  });
  const reads=[],uow=createSqliteUnitOfWork({kernel});
  const reader=createWorkResultReader({schemaManifest,unitOfWork:{execute(participants){return uow.execute(participants.map(p=>({...p,
    execute(context){return p.execute({...context,repository(id){const repo=context.repository(id);return {invoke(name,args){
      reads.push(name);return repo.invoke(name,args);}};}});}})));}}});
  const scope={ownerDomain:'libra',processType:'libra_run',processId:'run'};
  const first=reader.readExecutionSummaryPage(scope,null,100);
  assert.equal(first.items.length,100);assert.equal(first.nextCursor,'event-099');
  assert.deepEqual(first.items[1].latestAttempt,{eventAttemptId:'new',ordinal:2,state:'executing',outcomeKind:null,
    failureClass:null,failureCode:null,startedAtMs:12,finishedAtMs:null});
  assert.equal(first.items[0].latestAttempt,null);
  const second=reader.readExecutionSummaryPage(scope,first.nextCursor,100);
  const third=reader.readExecutionSummaryPage(scope,second.nextCursor,100);
  assert.equal(second.items.length,100);assert.equal(third.items.length,3);assert.equal(third.nextCursor,null);
  assert.equal(new Set([...first.items,...second.items,...third.items].map(row=>row.eventId)).size,203);
  assert.ok(reads.every(name=>['execution_summary_page','execution_summary_attempt','execution_summary_work'].includes(name)));
  assert.deepEqual(reader.readExecutionSummaryPage(scope,null,100),first);
  assert.deepEqual(reader.readExecutionSummaryPage(scope,null,1,'event-001'),{items:[first.items[1]],nextCursor:null});
  assert.equal(reader.readExecutionSummaryPage(scope,null,1,'foreign-event').items.length,0);
  assert.equal(reader.readExecutionSummaryPage({...scope,ownerDomain:'arca'}).items.length,1);
  kernel.runPrimitive(({prepare})=>prepare('INSERT INTO fx_workflow_events(event_id,work_id,state) VALUES(?,?,?)').run('a-late','work','ready'));
  assert.equal(reader.readExecutionSummaryPage(scope,null,1).items[0].eventId,'a-late');
  assert.throws(()=>reader.readExecutionSummaryPage(scope,null,101),/bounded/);
  assert.throws(()=>reader.readExecutionSummaryPage({...scope,extra:true}),/bounded/);
  assert.throws(()=>reader.readExecutionSummaryPage(scope,''),/bounded/);
});
