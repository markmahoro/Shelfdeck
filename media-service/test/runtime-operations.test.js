'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createRuntimeOperations}=require('../src/clean-runtime-operations');
const actor={actorId:'admin-primary'};

test('a synchronous quiesce failure retains stopped intent and never claims a safe stop',t=>{
  const f=fixture(t,{quiesce(){throw new Error('synchronous failure');}});
  assert.throws(()=>f.operations.stop({idempotencyKey:'stop'},actor),/synchronous failure/);
  assert.equal(f.operations.snapshot().mode,'error');assert.equal(f.operations.shouldStartStopped(),true);
});

test('safe stop also waits for previously admitted asynchronous Admin commands',async t=>{
  const f=fixture(t);const release=f.operations.beginBusinessCommand();
  f.operations.stop({idempotencyKey:'stop'},actor);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.operations.snapshot().mode,'stopping');assert.equal(f.operations.snapshot().activity.inFlightAdminCommands,1);
  assert.throws(()=>f.operations.beginBusinessCommand(),{code:'RUNTIME_BUSINESS_WRITES_DISABLED'});
  release();release();await f.operations.wait();assert.equal(f.operations.snapshot().mode,'stopped');
});
function fixture(t,overrides={}){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'runtime-operations-'));
  t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
  const options={dataDir,activity:()=>({inFlightEvents:0,inFlightRecoveries:0,inFlightOwnerReconciliations:0}),
    async quiesce(){},async resume(){},previewReset:()=>({ready:true,previewDigest:'a'.repeat(64),blockers:[]}),
    async reset(_preview,beforeApply){beforeApply({backupId:'backup'});return {removedSubjects:1};},...overrides};
  const operations=createRuntimeOperations(options);operations.started();return {dataDir,options,operations};
}
test('stop intent precedes drain, polling is read-only, receipt replay does not repeat operations',async t=>{
  let release,drains=0;const gate=new Promise(resolve=>{release=resolve;});
  const f=fixture(t,{quiesce(){drains++;assert.equal(JSON.parse(fs.readFileSync(path.join(f.dataDir,'operator-runtime','intent.json'))).desiredMode,'stopped');return gate;}});
  const accepted=f.operations.stop({idempotencyKey:'stop'},actor);assert.equal(accepted.state,'pending');assert.equal(f.operations.snapshot().mode,'stopping');
  assert.equal(f.operations.stop({idempotencyKey:'stop'},actor).operationId,accepted.operationId);assert.equal(drains,1);
  const bytes=fs.readFileSync(path.join(f.dataDir,'operator-runtime','intent.json'));for(let i=0;i<10;i++)f.operations.snapshot();assert.deepEqual(fs.readFileSync(path.join(f.dataDir,'operator-runtime','intent.json')),bytes);
  release();await f.operations.wait();assert.equal(f.operations.snapshot().mode,'stopped');
  f.operations.resume({idempotencyKey:'resume'},actor);await f.operations.wait();assert.equal(f.operations.snapshot().mode,'running');
  assert.equal(f.operations.stop({idempotencyKey:'stop'},actor).state,'completed');assert.equal(f.operations.snapshot().mode,'running');
  assert.throws(()=>f.operations.stop({idempotencyKey:'resume'},actor),{code:'RUNTIME_OPERATION_KEY_CONFLICT'});
});
test('failed drain never claims stopped or exposes Reset',async t=>{
  const f=fixture(t,{async quiesce(){throw Object.assign(new Error('drain failed'),{code:'TEST_DRAIN_FAILED'});}});
  f.operations.stop({idempotencyKey:'stop'},actor);await f.operations.wait();assert.equal(f.operations.snapshot().mode,'error');
  await assert.rejects(f.operations.previewReset(),{code:'RUNTIME_RESET_REQUIRES_STOPPED'});
});
test('stopped intent survives process reconstruction and requires explicit resume',async t=>{
  const f=fixture(t);f.operations.stop({idempotencyKey:'stop'},actor);await f.operations.wait();
  const restarted=createRuntimeOperations(f.options);assert.equal(restarted.shouldStartStopped(),true);restarted.started();assert.equal(restarted.snapshot().normalSupplyAllowed,false);
  restarted.resume({idempotencyKey:'resume'},actor);await restarted.wait();assert.equal(restarted.snapshot().normalSupplyAllowed,true);
});
test('Reset enforces confirmation and digest, completes without automatically resuming',async t=>{
  const f=fixture(t);f.operations.stop({idempotencyKey:'stop'},actor);await f.operations.wait();
  await assert.rejects(f.operations.reset({idempotencyKey:'bad',previewDigest:'wrong',confirmed:true},actor),{code:'RUNTIME_RESET_PREVIEW_STALE'});
  await assert.rejects(f.operations.reset({idempotencyKey:'bad',previewDigest:'a'.repeat(64),confirmed:false},actor),{code:'RUNTIME_RESET_CONFIRMATION_REQUIRED'});
  await f.operations.reset({idempotencyKey:'reset',previewDigest:'a'.repeat(64),confirmed:true},actor);await f.operations.wait();
  assert.equal(f.operations.snapshot().mode,'stopped');assert.equal(f.operations.snapshot().operation.result.removedSubjects,1);
});
test('backup failure leaves an ordinary stopped service, apply interruption fences resume across restart',async t=>{
  const f=fixture(t,{async reset(){throw Object.assign(new Error('backup failed'),{code:'RESET_BACKUP_FAILED'});}});
  f.operations.stop({idempotencyKey:'stop'},actor);await f.operations.wait();
  await f.operations.reset({idempotencyKey:'backup',previewDigest:'a'.repeat(64),confirmed:true},actor);await f.operations.wait();assert.equal(f.operations.snapshot().mode,'stopped');
  const restarted=createRuntimeOperations({...f.options,async reset(_preview,beforeApply){beforeApply({backupId:'recovery-backup'});throw Object.assign(new Error('apply interrupted'),{code:'TEST_APPLY_INTERRUPTED'});}});restarted.started();
  await restarted.reset({idempotencyKey:'apply',previewDigest:'a'.repeat(64),confirmed:true},actor);await restarted.wait();
  assert.equal(restarted.snapshot().mode,'error');
  const afterCrash=createRuntimeOperations(f.options);assert.equal(afterCrash.shouldStartStopped(),true);assert.equal(afterCrash.snapshot().recoveryBackup,'recovery-backup');
  assert.throws(()=>afterCrash.resume({idempotencyKey:'resume'},actor),{code:'RUNTIME_RESET_INTERRUPTED'});
});
