'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { createDomainReconcileRunner } = require('../../src/helix/foundation/execution/domain-reconcile-runner');
const { createReconcileCursorStore } = require('../../src/helix/foundation/execution/reconcile-cursor-store');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));

function open(databasePath) {
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 1700000000000 });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  return { kernel, cursorStore:createReconcileCursorStore({ schemaManifest, unitOfWork, now:() => 1700000000100 }) };
}

test('205 active Process scopes sweep in three bounded pages and resume from the durable cursor after restart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-reconcile-cursor-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const scopes = Array.from({length:205},(_,index)=>Object.freeze({
    cursor:String(index+1).padStart(4,'0'),scope:Object.freeze({processId:'process-'+String(index+1).padStart(4,'0')})
  }));
  const seen=[];
  const registration=Object.freeze({ownerDomain:'procurement',reconcilerKey:'active-runs',
    listPage({cursor,limit}){const start=cursor===null?0:scopes.findIndex((item)=>item.cursor===cursor)+1;return scopes.slice(start,start+limit);},
    async reconcile(scope){seen.push(scope.processId);}});
  let first=open(databasePath);
  let runner=createDomainReconcileRunner({cursorStore:first.cursorStore,registrations:[registration],now:Date.now,
    cadenceMs:60000,pageLimit:100,budgetMs:5000});
  try {
    const page1=await runner.start();
    assert.equal(page1.results[0].processed,100);
    await runner.stop();
    assert.equal(first.cursorStore.read(registration).cursor,'0100');
    first.kernel.close();

    const second=open(databasePath);
    runner=createDomainReconcileRunner({cursorStore:second.cursorStore,registrations:[registration],now:Date.now,
      cadenceMs:60000,pageLimit:100,budgetMs:5000});
    const page2=await runner.start();
    assert.equal(page2.results[0].processed,100);
    const page3=await runner.runOnce();
    assert.equal(page3.results[0].processed,5);
    assert.equal(second.cursorStore.read(registration).cursor,null);
    assert.equal(new Set(seen).size,205);
    assert.equal(seen.length,205);
    await runner.stop();
    second.kernel.close();
  } finally {
    try { first.kernel.close(); } catch {}
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('one Owner scope failure is reported and retried without failing startup or skipping its cursor', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-reconcile-failure-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const opened = open(databasePath);
  const seen=[]; const errors=[]; let failFirst=true;
  const registration=Object.freeze({ownerDomain:'libra',reconcilerKey:'ready-runs',
    listPage:({cursor})=>cursor===null?[
      Object.freeze({cursor:'run-1',scope:Object.freeze({processId:'run-1'})}),
      Object.freeze({cursor:'run-2',scope:Object.freeze({processId:'run-2'})}),
    ]:[Object.freeze({cursor:'run-2',scope:Object.freeze({processId:'run-2'})})],
    reconcile(scope){seen.push(scope.processId);if(scope.processId==='run-1'&&failFirst){failFirst=false;
      throw Object.assign(new Error('stale integration revision'),{code:'PLATFORM_INTEGRATION_REVISION_MISMATCH'});}},
  });
  const runner=createDomainReconcileRunner({cursorStore:opened.cursorStore,registrations:[registration],now:Date.now,
    cadenceMs:60000,pageLimit:100,budgetMs:5000,onError:(error)=>errors.push(error.code)});
  try {
    const startup=await runner.start();
    assert.equal(startup.kind,'completed');
    assert.equal(startup.results[0].processed,1);
    assert.equal(startup.results[0].cursor,null);
    assert.equal(startup.results[0].errorCode,'PLATFORM_INTEGRATION_REVISION_MISMATCH');
    assert.deepEqual(errors,['PLATFORM_INTEGRATION_REVISION_MISMATCH']);
    const retry=await runner.runOnce();
    assert.equal(retry.results[0].processed,2);
    assert.equal(retry.results[0].cursor,null);
    assert.deepEqual(seen,['run-1','run-2','run-1','run-2']);
  } finally {
    await runner.stop(); opened.kernel.close();
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('periodic owner fanout yields to the Node poll phase between scopes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-reconcile-yield-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const opened = open(databasePath);
  const scopes = Array.from({length:24},(_,index)=>Object.freeze({
    cursor:String(index).padStart(2,'0'), scope:Object.freeze({processId:`process-${index}`}),
  }));
  const seen=[];
  const registration=Object.freeze({ownerDomain:'libra',reconcilerKey:'yielding-runs',
    listPage:()=>scopes,reconcile:({processId})=>{seen.push(processId);}});
  const runner=createDomainReconcileRunner({cursorStore:opened.cursorStore,registrations:[registration],now:Date.now,
    cadenceMs:60000,pageLimit:100,budgetMs:5000});
  try {
    assert.equal(runner.snapshot().state,'waiting_first_check');
    const startup=runner.start();
    await new Promise((resolve)=>setImmediate(resolve));
    assert.equal(runner.snapshot().state,'running');
    assert.equal(runner.snapshot().registrations[0].state,'running');
    assert.ok(seen.length>0&&seen.length<scopes.length,
      `reconcile fanout must yield before all scopes complete, processed ${seen.length}`);
    const result=await startup;
    assert.equal(result.results[0].processed,scopes.length);
  } finally {
    await runner.stop(); opened.kernel.close();
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('one registration list failure is visible and does not starve later registrations', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-reconcile-registration-failure-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const opened = open(databasePath);
  const seen=[]; const errors=[];
  const registrations=[
    Object.freeze({ownerDomain:'people',reconcilerKey:'person-evidence',listPage(){
      throw Object.assign(new Error('projection unavailable'),{code:'PEOPLE_EVIDENCE_PROJECTION_UNAVAILABLE'});
    },reconcile(){throw new Error('unreachable');}}),
    Object.freeze({ownerDomain:'arca',reconcilerKey:'aftercare',listPage(){return [Object.freeze({
      cursor:'aftercare-1',scope:Object.freeze({processId:'aftercare-1'}),
    })];},reconcile(scope){seen.push(scope.processId);}}),
  ];
  const runner=createDomainReconcileRunner({cursorStore:opened.cursorStore,registrations,now:Date.now,
    cadenceMs:60000,pageLimit:100,budgetMs:5000,onError:(error)=>errors.push(error.code)});
  try {
    const result=await runner.start();
    assert.equal(result.kind,'completed');
    assert.equal(result.results[0].errorCode,'PEOPLE_EVIDENCE_PROJECTION_UNAVAILABLE');
    assert.equal(result.results[1].processed,1);
    assert.deepEqual(seen,['aftercare-1']);
    assert.deepEqual(errors,['PEOPLE_EVIDENCE_PROJECTION_UNAVAILABLE']);
    const snapshot=runner.snapshot();
    assert.equal(snapshot.state,'attention');
    assert.equal(snapshot.pendingCount,1);
    assert.equal(snapshot.registrations[0].state,'attention');
    assert.equal(snapshot.registrations[0].pendingCount,1);
    assert.equal(snapshot.registrations[1].state,'normal');
    assert.ok(Number.isSafeInteger(snapshot.lastCompletedAtMs));
  } finally {
    await runner.stop(); opened.kernel.close();
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('a successful cheap due check is visible as waiting for business time, not pending work', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-reconcile-not-due-'));
  const opened=open(path.join(root,'shelfdeck.db'));
  const clock=1_700_000_000_000;
  const registration=Object.freeze({ownerDomain:'libra',reconcilerKey:'workspace-cleanup',
    listPage:()=>[],nextDueAtMs:()=>clock+15*60*1000,reconcile(){throw new Error('unreachable');}});
  const runner=createDomainReconcileRunner({cursorStore:opened.cursorStore,registrations:[registration],now:()=>clock,
    cadenceMs:60000,pageLimit:100,budgetMs:5000});
  try{
    await runner.start();
    const snapshot=runner.snapshot();
    assert.equal(snapshot.state,'normal');
    assert.equal(snapshot.pendingCount,0);
    assert.equal(snapshot.registrations[0].state,'waiting_business_time');
    assert.equal(snapshot.registrations[0].lastResultKind,'not_due');
    assert.equal(snapshot.registrations[0].nextDueAtMs,clock+15*60*1000);
  }finally{await runner.stop();opened.kernel.close();fs.rmSync(root,{recursive:true,force:true});}
});
