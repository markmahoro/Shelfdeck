'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Database=require('better-sqlite3');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createSourceFairnessStore}=require('../../src/helix/domains/libra/persistence/source-fairness-store');

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'libra-fairness-'));
 const generated=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated');
 const schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'),'utf8'));
 const kernel=openSqliteKernel({Database,databasePath:path.join(root,'db'),schemaManifest,schemaDdl:fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8')});
 t.after(()=>{kernel.close();fs.rmSync(root,{recursive:true,force:true});});
 kernel.runPrimitive(({prepare})=>{
  prepare('PRAGMA foreign_keys=OFF').run();
  for(const [run,subject,source] of [['a1','sa','a'],['a2','sa','a'],['b1','sb','b'],['c1','sc','c']]){
   prepare('INSERT OR IGNORE INTO libra_subjects(subject_id,status) VALUES(?,?)').run(subject,'active');
   prepare('INSERT INTO libra_runs(libra_run_id,subject_id,state) VALUES(?,?,?)').run(run,subject,'active');
   prepare('INSERT OR IGNORE INTO libra_predeck_pipeline_tokens(subject_id,source_field_id,source_process_id,acquired_at_ms) VALUES(?,?,?,?)').run(subject,source,'intake-'+subject,1);
  }
 });
 const unitOfWork=createSqliteUnitOfWork({kernel});
 return {kernel,unitOfWork,schemaManifest,now:()=>10};
}

test('durable opportunities advance one source and one Run atomically; restart and polling never charge twice',t=>{
 const options=fixture(t),store=createSourceFairnessStore(options);
 for(const run of ['a1','a2','b1','c1'])store.registerRun(run);
 const initial=store.snapshot();assert.equal(initial.sources.length,3);assert.equal(initial.runs.length,4);
 assert.equal(initial.sources.find(s=>s.sourceFieldId==='a').lastTurn,0);
 const opportunity={runId:'a1',eventId:'event-a',eventAttemptId:'attempt-1',ordinal:1};
 assert.equal(store.recordOpportunity(opportunity).recorded,true);
 const charged=store.snapshot();
 assert.equal(charged.sources.find(s=>s.sourceFieldId==='a').lastTurn,2);
 assert.equal(charged.runs.find(s=>s.runId==='a2').lastTurn,0);
 for(let i=0;i<20;i++)assert.equal(store.recordOpportunity(opportunity).recorded,false);
 assert.deepEqual(store.snapshot(),charged);
 store.saveCursor('a1','event-a');
 const restarted=createSourceFairnessStore(options);
 assert.equal(restarted.readCursor('a1'),'event-a');
 assert.equal(restarted.recordOpportunity(opportunity).recorded,false);
 assert.throws(()=>restarted.recordOpportunity({...opportunity,eventAttemptId:'conflict'}),/conflicting identity/);
 assert.throws(()=>restarted.recordOpportunity({...opportunity,runId:'b1'}),/changed Libra Run/);
 assert.equal(restarted.recordOpportunity({...opportunity,eventAttemptId:'attempt-2',ordinal:2}).recorded,true);
 assert.equal(restarted.recordOpportunity(opportunity).recorded,false);
 restarted.saveCursor('a1',null);assert.equal(restarted.readCursor('a1'),null);
 assert.equal(restarted.snapshot().priorityRevision,3);
});

test('failure between clock and ledger writes rolls back every fairness fact',t=>{
 const options=fixture(t),store=createSourceFairnessStore(options);store.registerRun('a1');
 const before=store.snapshot();
 const failing=createSourceFairnessStore({...options,unitOfWork:{execute(participants){return options.unitOfWork.execute(participants.map(p=>({...p,
  execute(context){return p.execute({...context,repository(id){const repo=context.repository(id);return {invoke(name,args){
   if(name==='insert_event')throw Error('interrupted ledger write');return repo.invoke(name,args);
  }};}});}})));}}});
 const opportunity={runId:'a1',eventId:'event',eventAttemptId:'attempt',ordinal:1};
 assert.throws(()=>failing.recordOpportunity(opportunity),/interrupted ledger write/);
 assert.deepEqual(store.snapshot(),before);
 assert.equal(store.recordOpportunity(opportunity).recorded,true);
});


test('source-first preference rotates at start, then selects another Run; unchanged polls buy no turn',t=>{
 const {createSourceFairness}=require('../../src/helix/domains/libra/application/source-fairness');
 const options=fixture(t),summaries=new Map(),reads=[];
 const fairness=createSourceFairness({...options,workResultReader:{readExecutionSummaryPage(scope,cursor,limit,eventId){
  reads.push({scope,cursor,limit,eventId});const row=summaries.get(scope.processId);
  return {items:row?[row]:[],nextCursor:null};
 }}});
 for(const runId of ['a1','a2','b1','c1'])fairness.setEligible(runId,true);
 const score=id=>fairness.read(id).localPriorityBonus;
 assert.ok(score('a1')>score('a2'));assert.ok(score('a2')>score('b1'));assert.ok(score('b1')>score('c1'));
 function start(runId,capabilityRef='shared.material.media.probe@1'){
  const eventId='event-'+runId,attemptId='attempt-'+runId;
  summaries.set(runId,{eventId,capabilityRef,latestAttempt:{eventAttemptId:attemptId,ordinal:1,state:'executing',
   startedAtMs:10,outcomeKind:null,failureClass:null,failureCode:null}});
  fairness.onExecutionStarted({eventId,eventAttemptId:attemptId,capabilityRef,ownerScope:{domain:'libra',processType:'libra_run',processId:runId}});
 }
 start('a1');assert.ok(score('b1')>score('a1'));assert.ok(score('c1')>score('a1'));
 const revision=fairness.read('a1').priorityRevision;
 for(let i=0;i<10;i++)fairness.refresh('a1');assert.equal(fairness.read('a1').priorityRevision,revision);
 assert.equal(reads.filter(row=>row.scope.processId==='a1'&&!row.eventId).length,1,'ordinary checks share one bounded scan interval');
 start('b1');assert.ok(score('c1')>score('b1'));
 start('c1');assert.ok(score('a2')>score('a1'));assert.ok(score('a1')>score('b1'));
 const beforePoll=fairness.read('a2').priorityRevision;
 start('a2','libra.external_material.acquire.observe@1');fairness.refresh('a2');
 assert.equal(fairness.read('a2').priorityRevision,beforePoll);
 assert.ok(reads.filter(row=>row.eventId).every(row=>row.limit===1));
 assert.ok(['a1','a2','b1','c1'].every(id=>score(id)>=0&&score(id)<100));
 fairness.setEligible('a2',false);assert.equal(score('a2'),0);
});

test('the real Scheduler applies the same Owner fairness to Work supply and queued Events while retaining completion and expedited precedence',t=>{
 const {createSourceFairness}=require('../../src/helix/domains/libra/application/source-fairness');
 const {createLibraRunExecutionProjection}=require('../../src/helix/domains/libra/application/libra-run-execution-projection');
 const {createWorkScheduler}=require('../../src/helix/foundation/execution/work-scheduler');
 const options=fixture(t),store=createSourceFairnessStore(options),fairness=createSourceFairness({...options,store});
 for(const id of ['a1','a2','b1','c1'])fairness.setEligible(id,true);
 options.kernel.runPrimitive(({prepare})=>{
  for(const id of ['a1','a2','b1','c1']){
   prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,priority_class,state,created_at_ms) VALUES(?,?,?,?,?,?,?,?)')
    .run('work-'+id,'libra','libra_run',id,'fixture_work','normal_foreground','admitted',1);
   prepare('INSERT INTO fx_work_attempts(attempt_id,work_id,state) VALUES(?,?,?)').run('wa-'+id,'work-'+id,'running');
   prepare('INSERT INTO fx_workflow_plans(plan_id,attempt_id,state) VALUES(?,?,?)').run('plan-'+id,'wa-'+id,'planned');
   prepare('INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,state,priority_class,ready_at_ms) VALUES(?,?,?,?,?,?,?)')
    .run('event-'+id,'plan-'+id,'node-'+id,'work-'+id,'ready','normal_foreground',1);
  }
 });
 const projection=createLibraRunExecutionProjection({...options,sourceFairness:fairness});
 let lease=0;
 const scheduler=createWorkScheduler({...options,now:()=>1000,nextLeaseId:()=>String(++lease),
  supplyController:{evaluate:({targetId})=>({kind:'permitted',targetId,lane:'normal'})},priorityProjectionProvider:projection});
 function selected(type){const result=scheduler.acquire({targetType:type});assert.equal(result.kind,'leased');scheduler.release(result.lease);return result.lease.targetId;}
 assert.equal(selected('work'),'work-a1');
 store.recordOpportunity({runId:'a1',eventId:'opportunity-a1',eventAttemptId:'actual-start-a1',ordinal:1});
 fairness.setEligible('a1',false);fairness.setEligible('a1',true);
 assert.equal(selected('work'),'work-b1');
 options.kernel.runPrimitive(({prepare})=>prepare("UPDATE fx_supporting_works SET state='running'").run());
 assert.equal(selected('event'),'event-b1');
 options.kernel.runPrimitive(({prepare})=>prepare("UPDATE fx_supporting_works SET work_kind='product_conformance' WHERE work_id='work-a1'").run());
 assert.equal(selected('event'),'event-a1','completion still precedes the largest expansion fairness bonus');
 options.kernel.runPrimitive(({prepare})=>{
  prepare("UPDATE libra_runs SET priority_class='expedited' WHERE libra_run_id='c1'").run();
  prepare("UPDATE fx_supporting_works SET priority_class='expedited_formation' WHERE work_id='work-c1'").run();
  prepare("UPDATE fx_workflow_events SET priority_class='expedited_formation' WHERE event_id='event-c1'").run();
 });projection.invalidate('c1');
 assert.equal(selected('event'),'event-c1','user expedited intent remains a separate higher priority class');
});
