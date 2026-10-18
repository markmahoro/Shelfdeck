'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createFieldIntakeAdmissionAdminService } = require('../../src/helix/domains/libra/application/field-intake-admission-admin-service');
const { createPredeckPipelineAdmissionStore } = require('../../src/helix/domains/libra/persistence/predeck-pipeline-admission-store');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const schemaDdl = fs.readFileSync(path.join(__dirname, '../../src/helix/foundation/persistence/generated/clean-schema.sql'), 'utf8');
const schemaManifest = require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

function runtime() {
  const Database = require('better-sqlite3');
  const databasePath = require('node:os').tmpdir() + '/p16-pipeline-' + Date.now() + '-' + Math.random() + '.db';
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 1000 });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  return Object.freeze({
    admin: createFieldIntakeAdmissionAdminService({ schemaManifest, unitOfWork, now: () => 1000 }),
    store: createPredeckPipelineAdmissionStore({ schemaManifest, unitOfWork, now: () => 1000 }),
    kernel, unitOfWork, databasePath,
    close: () => kernel.close(),
  });
}

test('lazy policy init defaults to three seats', () => {
  const ctx = runtime();
  const policy = ctx.admin.getFieldIntakeAdmission('movie-field-1');
  assert.equal(policy.predeckPipelineSeats, 3);
  assert.equal(policy.pipelineTokensHeld, 0);
  assert.equal(policy.pipelineSeatsFree, 3);
  assert.equal(policy.policyRevision, 1);
  assert.equal(ctx.kernel.runPrimitive(({ prepare }) =>
    prepare('SELECT COUNT(*) AS count FROM libra_field_intake_admission_policies').get().count), 0,
  'GET must not persist a default policy');
  ctx.close();
});

test('replaying the same PATCH is a durable no-op', () => {
  const ctx = runtime();
  const first = ctx.admin.reviseFieldIntakeAdmission('movie-field-idempotent', { predeckPipelineSeats: 4 });
  const second = ctx.admin.reviseFieldIntakeAdmission('movie-field-idempotent', { predeckPipelineSeats: 4 });
  assert.deepEqual(second, first);
  assert.equal(ctx.kernel.runPrimitive(({ prepare }) =>
    prepare('SELECT COUNT(*) AS count FROM libra_field_intake_admission_policies WHERE field_id = ?')
      .get('movie-field-idempotent').count), 1);
  ctx.close();
});

test('admin PATCH revises seats and reports occupancy', () => {
  const ctx = runtime();
  ctx.store.acquire({ fieldId: 'movie-field-2', subjectId: 'subject-1', sourceProcessId: 'process-1' });
  ctx.store.acquire({ fieldId: 'movie-field-2', subjectId: 'subject-2', sourceProcessId: 'process-2' });
  const revised = ctx.admin.reviseFieldIntakeAdmission('movie-field-2', { predeckPipelineSeats: 5 });
  assert.equal(revised.predeckPipelineSeats, 5);
  assert.equal(revised.pipelineTokensHeld, 2);
  assert.equal(revised.pipelineSeatsFree, 3);
  const paused = ctx.admin.reviseFieldIntakeAdmission('movie-field-2', { predeckPipelineSeats: 0 });
  assert.equal(paused.predeckPipelineSeats, 0);
  assert.equal(paused.pipelineSeatsFree, 0);
  ctx.close();
});

test('zero seats blocks new acquire but keeps existing tokens', () => {
  const ctx = runtime();
  ctx.admin.reviseFieldIntakeAdmission('movie-field-3', { predeckPipelineSeats: 0 });
  assert.throws(
    () => ctx.store.acquire({ fieldId: 'movie-field-3', subjectId: 'subject-new', sourceProcessId: 'process-new' }),
    (error) => error?.code === 'PREDECK_PIPELINE_FULL',
  );
  ctx.close();
});


function proof(subjectId, eligible=true, afterRead=()=>{}) {
  const {createRepositoryDefinition}=require('../../src/helix/foundation/persistence/owner-repository');
  const repository=createRepositoryDefinition({repositoryId:'secondary_test_proof',owner:'libra',schemaManifest,
    statements:{token:{kind:'select-one',tableId:'libra_predeck_pipeline_tokens',columns:['subject_id'],keyColumns:['subject_id']}}});
  return {participantId:'secondary_test_proof',owner:'libra',repositories:[repository],execute(context){
    assert.ok(context.repository(repository.repositoryId).invoke('token',{subject_id:subjectId}));
    afterRead();
    return {subjectId,eligible,readinessDigest:'a'.repeat(64)};
  }};
}

test('secondary capacity is global, moves occupancy without dropping responsibility, and releases atomically', t => {
  const ctx=runtime();t.after(ctx.close);
  assert.deepEqual(ctx.store.readSecondaryPolicy(),{secondarySeats:5,policyRevision:1,updatedAtMs:0,held:0,free:5});
  assert.equal(ctx.kernel.runPrimitive(({prepare})=>prepare('SELECT COUNT(*) AS count FROM libra_workshop_policies').get().count),0);
  ctx.store.revisePolicy('a',1);ctx.store.revisePolicy('b',1);
  ctx.store.acquire({fieldId:'a',subjectId:'a1',sourceProcessId:'p1'});
  ctx.store.acquire({fieldId:'b',subjectId:'b1',sourceProcessId:'p2'});
  ctx.store.reviseSecondaryPolicy(1);
  assert.equal(ctx.store.transferToSecondary('a1',proof('a1',false)).reasonCode,'readiness_not_proven');
  assert.equal(ctx.store.readPolicy('a').free,0);
  assert.deepEqual(ctx.store.transferToSecondary('a1',proof('a1')),{transferred:true,replayed:false});
  assert.equal(ctx.store.readPolicy('a').free,1);
  assert.equal(ctx.store.hasToken('a1'),true);
  assert.equal(ctx.store.listTokens().length,2);
  ctx.store.acquire({fieldId:'a',subjectId:'a2',sourceProcessId:'p3'});
  assert.equal(ctx.store.transferToSecondary('b1',proof('b1')).reasonCode,'secondary_full');
  assert.equal(ctx.store.readPolicy('b').free,0);
  const zero=ctx.store.reviseSecondaryPolicy(0);
  assert.equal(zero.held,1);assert.equal(zero.free,0);
  assert.deepEqual(ctx.store.reviseSecondaryPolicy(0),zero);
  assert.deepEqual(ctx.store.transferToSecondary('a1',proof('a1')),{transferred:true,replayed:true});
  assert.equal(ctx.store.listSecondaryPlacements().length,1);
  assert.equal(ctx.store.release('a1').released,true);
  assert.equal(ctx.store.listSecondaryPlacements().length,0);
  assert.equal(ctx.store.hasToken('a1'),false);
  assert.equal(ctx.store.readPolicy('a').held,1);
  for(const invalid of [-1,33,1.5,'5',null])assert.throws(()=>ctx.store.reviseSecondaryPolicy(invalid),{code:'LIBRA_SECONDARY_SEATS_INVALID'});
  assert.equal(ctx.store.reviseSecondaryPolicy(32).secondarySeats,32);
});

test('failed secondary proof rolls back and never frees the primary seat', t => {
  const ctx=runtime();t.after(ctx.close);
  ctx.store.acquire({fieldId:'a',subjectId:'a1',sourceProcessId:'p1'});
  assert.throws(()=>ctx.store.transferToSecondary('a1',null),{code:'LIBRA_SECONDARY_PROOF_REQUIRED'});
  assert.throws(()=>ctx.store.transferToSecondary('a1',proof('a1',true,()=>{throw Error('stale proof');})),/stale proof/);
  assert.equal(ctx.store.readSecondaryPolicy().held,0);
  assert.equal(ctx.store.readPolicy('a').held,1);
  assert.equal(ctx.store.hasToken('a1'),true);
});


test('a frozen Season Run retains the whole Subject responsibility and secondary place',t=>{
 const ctx=runtime();t.after(ctx.close);
 ctx.kernel.runPrimitive(({prepare})=>{
  prepare('INSERT INTO libra_subjects(subject_id,structure_kind,status) VALUES(?,?,?)').run('season','season','active');
  prepare('INSERT INTO libra_runs(libra_run_id,subject_id,state) VALUES(?,?,?)').run('frozen-run','season','frozen');
 });
 ctx.store.acquire({fieldId:'series',subjectId:'season',sourceProcessId:'series-intake'});
 ctx.store.transferToSecondary('season',proof('season'));
 assert.equal(ctx.store.release('season').reasonCode,'series_delivery_responsibility_remaining');
 assert.equal(ctx.store.hasToken('season'),true);assert.equal(ctx.store.readSecondaryPolicy().held,1);
 ctx.kernel.runPrimitive(({prepare})=>prepare('UPDATE libra_runs SET state=? WHERE libra_run_id=?').run('discarded','frozen-run'));
 assert.equal(ctx.store.release('season').released,true);assert.equal(ctx.store.readSecondaryPolicy().held,0);
});


function attention(ctx,pipelineAdmission=ctx.store,options={}){
 const {createAttentionWorkshop}=require('../../src/helix/domains/libra/application/attention-workshop');
 const {createWorkResultReader}=require('../../src/helix/foundation/execution/work-result-reader');
 return createAttentionWorkshop({...options,schemaManifest,unitOfWork:ctx.unitOfWork,pipelineAdmission,
  workResultReader:createWorkResultReader({schemaManifest,unitOfWork:ctx.unitOfWork})});
}
function seedSubject(ctx,subjectId,runs=[]){
 ctx.kernel.runPrimitive(({prepare})=>{
  prepare('INSERT INTO libra_subjects(subject_id,structure_kind,status) VALUES(?,?,?)').run(subjectId,runs.length>1?'season':'single','active');
  for(const runId of runs)prepare('INSERT INTO libra_runs(libra_run_id,subject_id,state) VALUES(?,?,?)').run(runId,subjectId,'active');
 });
 ctx.store.acquire({fieldId:'source',subjectId,sourceProcessId:'intake-'+subjectId});
}

const spaceWait=()=>({kind:'waiting_for_resource',phase:'workspace_admission',reasonCode:'insufficient_space'});

test('Workspace shortage needs three separated checks, keeps the Run active and resumes in secondary',t=>{
 const ctx=runtime();t.after(ctx.close);seedSubject(ctx,'space-subject',['space-run']);
 let now=1000,wakes=0;
 const workshop=attention(ctx,ctx.store,{now:()=>now,onReadinessObserved:()=>wakes++});
 for(let i=0;i<8;i++)assert.deepEqual(workshop.reconcileRun('space-run',spaceWait),spaceWait());
 assert.equal(ctx.store.readSecondaryPolicy().held,0);assert.equal(wakes,1,'fast polling must not create a wake loop');
 now+=60000;workshop.reconcileRun('space-run',spaceWait);assert.equal(ctx.store.readSecondaryPolicy().held,0);
 now+=59999;workshop.reconcileRun('space-run',spaceWait);assert.equal(ctx.store.readSecondaryPolicy().held,0);
 now++;workshop.reconcileRun('space-run',spaceWait);assert.equal(ctx.store.readSecondaryPolicy().held,1);
 assert.equal(ctx.store.readPolicy('source').held,0);assert.equal(ctx.store.hasToken('space-subject'),true);
 assert.equal(ctx.kernel.runPrimitive(({prepare})=>prepare('SELECT state FROM libra_runs WHERE libra_run_id=?').get('space-run')).state,'active');
 const restarted=attention(ctx,ctx.store,{now:()=>now});
 assert.deepEqual(restarted.reconcileRun('space-run',()=>({kind:'pending',workId:'resumed'})),{kind:'pending',workId:'resumed'});
 assert.equal(ctx.store.readSecondaryPolicy().held,1,'recovery never returns to primary');
});

test('recovery, other resource waits and changed Owner basis reset shortage observations',t=>{
 const ctx=runtime();t.after(ctx.close);seedSubject(ctx,'reset-subject',['reset-run']);
 let now=0;const workshop=attention(ctx,ctx.store,{now:()=>now});
 const check=()=>{workshop.reconcileRun('reset-run',spaceWait);now+=60000;};
 check();check();
 workshop.reconcileRun('reset-run',()=>({kind:'pending',workId:'recovered'}));
 check();check();assert.equal(ctx.store.readSecondaryPolicy().held,0);
 workshop.reconcileRun('reset-run',()=>({kind:'waiting_for_resource',phase:'workspace_admission',reasonCode:'root_unavailable'}));
 check();check();assert.equal(ctx.store.readSecondaryPolicy().held,0);
 workshop.reconcileRun('reset-run',()=>({kind:'waiting_for_resource',phase:'transcode',reasonCode:'insufficient_space'}));
 check();check();assert.equal(ctx.store.readSecondaryPolicy().held,0);
 ctx.kernel.runPrimitive(({prepare})=>prepare('UPDATE libra_runs SET state_revision=2 WHERE libra_run_id=?').run('reset-run'));
 check();check();assert.equal(ctx.store.readSecondaryPolicy().held,0);
 check();assert.equal(ctx.store.readSecondaryPolicy().held,1);
});

test('restart before transfer conservatively starts fresh space checks; full or disabled secondary keeps primary',t=>{
 const ctx=runtime();t.after(ctx.close);seedSubject(ctx,'full-subject',['full-run']);
 let now=0;let workshop=attention(ctx,ctx.store,{now:()=>now});
 const check=()=>{workshop.reconcileRun('full-run',spaceWait);now+=60000;};
 check();check();workshop=attention(ctx,ctx.store,{now:()=>now});check();
 assert.equal(ctx.store.readSecondaryPolicy().held,0);
 ctx.store.reviseSecondaryPolicy(0);check();check();
 assert.equal(ctx.store.readSecondaryPolicy().held,0);assert.equal(ctx.store.readPolicy('source').held,1);
 ctx.store.reviseSecondaryPolicy(1);check();assert.equal(ctx.store.readSecondaryPolicy().held,1);
 seedSubject(ctx,'other-subject',['other-run']);
 for(let i=0;i<3;i++){workshop.reconcileRun('other-run',spaceWait);now+=60000;}
 assert.equal(ctx.store.readPolicy('source').held,1);assert.equal(ctx.store.hasToken('other-subject'),true);
 ctx.store.release('full-subject');workshop.reconcileRun('other-run',spaceWait);
 assert.equal(ctx.store.readSecondaryPolicy().held,1);assert.equal(ctx.store.readPolicy('source').held,0);
});

test('Season transfer requires every unfinished Run to meet its own repeated-shortage threshold',t=>{
 const ctx=runtime();t.after(ctx.close);seedSubject(ctx,'space-season',['space-r1','space-r2']);
 let now=0;const workshop=attention(ctx,ctx.store,{now:()=>now});
 for(let i=0;i<3;i++){workshop.reconcileRun('space-r1',spaceWait);now+=60000;}
 for(let i=0;i<2;i++){workshop.reconcileRun('space-r2',spaceWait);now+=60000;}
 assert.equal(ctx.store.readSecondaryPolicy().held,0);
 workshop.reconcileRun('space-r2',spaceWait);assert.equal(ctx.store.readSecondaryPolicy().held,1);
});

test('repeated shortage still cannot transfer an executing Run or use a stale atomic Owner proof',t=>{
 const ctx=runtime();t.after(ctx.close);seedSubject(ctx,'busy-subject',['busy-run']);
 ctx.kernel.runPrimitive(({prepare})=>prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,state) VALUES(?,?,?,?,?)').run('busy-work','libra','libra_run','busy-run','running'));
 let now=0;const workshop=attention(ctx,ctx.store,{now:()=>now});
 for(let i=0;i<3;i++){workshop.reconcileRun('busy-run',spaceWait);now+=60000;}
 assert.equal(ctx.store.readSecondaryPolicy().held,0);
 ctx.kernel.runPrimitive(({prepare})=>prepare("UPDATE fx_supporting_works SET state='succeeded' WHERE work_id='busy-work'").run());
 workshop.reconcileRun('busy-run',spaceWait);assert.equal(ctx.store.readSecondaryPolicy().held,1);
 seedSubject(ctx,'stale-space',['stale-run']);
 const stale=attention(ctx,{...ctx.store,transferToSecondary(...args){
  ctx.kernel.runPrimitive(({prepare})=>prepare('UPDATE libra_runs SET state_revision=5 WHERE libra_run_id=?').run('stale-run'));
  return ctx.store.transferToSecondary(...args);
 }},{now:()=>now});
 for(let i=0;i<3;i++){stale.reconcileRun('stale-run',spaceWait);now+=60000;}
 assert.equal(ctx.store.readPolicy('source').held,1);assert.equal(ctx.store.readSecondaryPolicy().held,1);
});

test('missing routing configuration moves only stable no-Run readiness; whole Season needs every Run attention',t=>{
 const ctx=runtime();t.after(ctx.close);const workshop=attention(ctx);
 seedSubject(ctx,'no-run');
 const routing=()=>({kind:'unresolved',reasonCode:'routing_policy_unavailable'});
 workshop.reconcileRouting('no-run',routing);assert.equal(ctx.store.readSecondaryPolicy().held,0);
 workshop.reconcileRouting('no-run',routing);assert.equal(ctx.store.readSecondaryPolicy().held,1);
 seedSubject(ctx,'season-two',['r1','r2']);
 const waiting=()=>({kind:'waiting_product_identity'});
 workshop.reconcileRun('r1',waiting);workshop.reconcileRun('r1',waiting);
 workshop.reconcileRun('r2',()=>({kind:'pending',workId:'work'}));
 assert.equal(ctx.store.readSecondaryPolicy().held,1);
 workshop.reconcileRun('r2',waiting);workshop.reconcileRun('r2',waiting);
 assert.equal(ctx.store.readSecondaryPolicy().held,2);
 assert.equal(ctx.store.hasToken('season-two'),true);
 workshop.reconcileRun('r1',()=>({kind:'pending',workId:'resumed-work'}));
 assert.equal(ctx.store.readSecondaryPolicy().held,2,'resuming never returns to primary');
});

test('open Work or unresolved Effect blocks transfer; settled execution and stable Owner proof allow it',t=>{
 const ctx=runtime();t.after(ctx.close);seedSubject(ctx,'effect-subject',['effect-run']);
 ctx.kernel.runPrimitive(({prepare})=>{
  prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,state) VALUES(?,?,?,?,?)').run('w','libra','libra_run','effect-run','running');
  prepare('INSERT INTO fx_workflow_events(event_id,work_id,state) VALUES(?,?,?)').run('e','w','executing');
  prepare('INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,state) VALUES(?,?,?,?)').run('ea','e',1,'executing');
  prepare('INSERT INTO fx_effect_journal(effect_id,event_attempt_id,state) VALUES(?,?,?)').run('effect','ea','reconcile_required');
 });
 const workshop=attention(ctx),waiting=()=>({kind:'waiting_product_identity'});
 workshop.reconcileRun('effect-run',waiting);workshop.reconcileRun('effect-run',waiting);
 assert.equal(ctx.store.readSecondaryPolicy().held,0);
 ctx.kernel.runPrimitive(({prepare})=>prepare('UPDATE fx_supporting_works SET state=? WHERE work_id=?').run('failed','w'));
 workshop.reconcileRun('effect-run',waiting);assert.equal(ctx.store.readSecondaryPolicy().held,0);
 ctx.kernel.runPrimitive(({prepare})=>{
  prepare('UPDATE fx_effect_journal SET state=? WHERE effect_id=?').run('failed','effect');
  prepare('UPDATE fx_event_attempts SET state=? WHERE event_attempt_id=?').run('completed','ea');
  prepare('UPDATE fx_workflow_events SET state=? WHERE event_id=?').run('failed','e');
 });
 workshop.reconcileRun('effect-run',waiting);assert.equal(ctx.store.readSecondaryPolicy().held,1);
});

test('Owner changes between observation and atomic transfer invalidate the proof',t=>{
 const ctx=runtime();t.after(ctx.close);seedSubject(ctx,'race',['race-run']);
 const workshop=attention(ctx,{...ctx.store,transferToSecondary(...args){
  ctx.kernel.runPrimitive(({prepare})=>prepare('UPDATE libra_runs SET state_revision=7 WHERE libra_run_id=?').run('race-run'));
  return ctx.store.transferToSecondary(...args);
 }});
 const waiting=()=>({kind:'waiting_product_identity'});
 workshop.reconcileRun('race-run',waiting);workshop.reconcileRun('race-run',waiting);
 assert.equal(ctx.store.readSecondaryPolicy().held,0);assert.equal(ctx.store.readPolicy('source').held,1);
});

test('suspended recovery wait uses current Owner state rather than requiring a second suspension transition',t=>{
 const ctx=runtime();t.after(ctx.close);seedSubject(ctx,'suspended-subject',['suspended-run']);
 const workshop=attention(ctx);
 ctx.kernel.runPrimitive(({prepare})=>prepare("UPDATE libra_runs SET state='suspended' WHERE libra_run_id='suspended-run'").run());
 workshop.reconcileRun('suspended-run',()=>({kind:'suspend'}));
 workshop.reconcileRun('suspended-run',()=>({kind:'not_due'}));
 assert.equal(ctx.store.readSecondaryPolicy().held,1);
 assert.equal(ctx.store.hasToken('suspended-subject'),true);
});

test('two independent SQLite connections cannot overfill the last global secondary seat',{timeout:20000},async t=>{
 const {Worker}=require('node:worker_threads');
 const ctx=runtime();t.after(ctx.close);
 for(const subjectId of ['concurrent-a','concurrent-b'])ctx.store.acquire({fieldId:'concurrent-source',subjectId,sourceProcessId:'intake-'+subjectId});
 ctx.store.reviseSecondaryPolicy(1);
 const barrier=new SharedArrayBuffer(4),workers=[],ready=[],results=[];
 const workerSource=String.raw`
  const {parentPort,workerData}=require('node:worker_threads'),fs=require('node:fs'),path=require('node:path');
  const root=workerData.root;
  const {openSqliteKernel}=require(root+'/src/helix/foundation/persistence/sqlite-kernel');
  const {createSqliteUnitOfWork}=require(root+'/src/helix/foundation/persistence/sqlite-unit-of-work');
  const {createRepositoryDefinition}=require(root+'/src/helix/foundation/persistence/owner-repository');
  const {createPredeckPipelineAdmissionStore}=require(root+'/src/helix/domains/libra/persistence/predeck-pipeline-admission-store');
  const generated=path.join(root,'src/helix/foundation/persistence/generated');
  const schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'),'utf8'));
  const kernel=openSqliteKernel({Database:require(root+'/node_modules/better-sqlite3'),databasePath:workerData.databasePath,schemaManifest,
   schemaDdl:fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8')});
  try{
   const store=createPredeckPipelineAdmissionStore({schemaManifest,unitOfWork:createSqliteUnitOfWork({kernel}),now:()=>1000});
   const repository=createRepositoryDefinition({repositoryId:'concurrent_proof',owner:'libra',schemaManifest,statements:{
    token:{kind:'select-one',tableId:'libra_predeck_pipeline_tokens',columns:['subject_id'],keyColumns:['subject_id']}}});
   parentPort.postMessage({ready:true});
   if(Atomics.wait(new Int32Array(workerData.barrier),0,0,10000)==='timed-out')throw Error('Admission barrier timed out.');
   const subjectId=workerData.subjectId;
   const result=store.transferToSecondary(subjectId,{participantId:'concurrent_proof',owner:'libra',repositories:[repository],execute(context){
    return {subjectId,eligible:Boolean(context.repository(repository.repositoryId).invoke('token',{subject_id:subjectId})),readinessDigest:'a'.repeat(64)};
   }});parentPort.postMessage({result});
  }finally{kernel.close();}
 `;
 for(const subjectId of ['concurrent-a','concurrent-b']){
  const worker=new Worker(workerSource,{eval:true,workerData:{subjectId,barrier,databasePath:ctx.databasePath,root:path.resolve(__dirname,'../..')}});
  workers.push(worker);
  ready.push(new Promise((resolve,reject)=>{worker.on('message',message=>{if(message.ready)resolve();});worker.on('error',reject);}));
  results.push(new Promise((resolve,reject)=>{worker.on('message',message=>{if(message.result)resolve(message.result);});worker.on('error',reject);}));
 }
 try{
  await Promise.all(ready);Atomics.store(new Int32Array(barrier),0,1);Atomics.notify(new Int32Array(barrier),0,2);
  const outcomes=await Promise.all(results);
  assert.equal(outcomes.filter(row=>row.transferred).length,1);
  assert.equal(outcomes.filter(row=>row.reasonCode==='secondary_full').length,1);
  assert.equal(ctx.store.readSecondaryPolicy().held,1);assert.equal(ctx.store.readPolicy('concurrent-source').held,1);
  assert.equal(ctx.store.listTokens().length,2);
 }finally{await Promise.all(workers.map(worker=>worker.terminate()));}
});
