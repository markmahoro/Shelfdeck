'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
function child(args,env,timeoutMs) {
  return new Promise((resolve,reject)=>{
    const childEnv={...process.env,...env};delete childEnv.NODE_TEST_CONTEXT;
    const processHandle=spawn(process.execPath,args,{env:childEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',timedOut=false;
    processHandle.stdout.on('data',chunk=>{stdout+=chunk;});processHandle.stderr.on('data',chunk=>{stderr+=chunk;});
    const timer=setTimeout(()=>{timedOut=true;processHandle.kill();},timeoutMs);
    processHandle.on('error',error=>{clearTimeout(timer);reject(error);});
    processHandle.on('close',status=>{clearTimeout(timer);if(timedOut)reject(new Error('Shutdown child timed out: '+stderr));else resolve({status,stdout,stderr});});
  });
}


test('Series transcode shutdown retains its Effect and restart commits once', {timeout:300000}, async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-series-routing-'));
  try {
    const seeded=await child(['--test-name-pattern=with real Direct Remux Transcode$',path.join(__dirname,'series-routing-run.test.js')],
      {HELIX_SERIES_REAL_MEDIA:'1',HELIX_SERIES_SHUTDOWN_ROOT:root},180000);
    assert.equal(seeded.status,74,seeded.stdout+seeded.stderr);
    const boundary=JSON.parse(fs.readFileSync(path.join(root,'shutdown-boundary.json'),'utf8'));
    assert.equal(boundary.shutdownCompleted,true);assert.ok(boundary.shutdownMs<10000);
    assert.equal(boundary.children,0);assert.equal(boundary.commits,0);
    assert.ok(boundary.events.some(event=>event.state==='executing'&&event.effect_state==='intended'));
    assert.ok(boundary.events.every(event=>event.failure_code===null&&event.outcome_kind===null));
    const worker=path.resolve(__dirname,'../fixtures/series-shutdown-restart-worker.js');
    const recovered=await child([worker,root],{},120000);
    assert.equal(recovered.status,0,recovered.stdout+recovered.stderr);
    const result=JSON.parse(recovered.stdout.split(/\r?\n/).find(line=>line.startsWith('SERIES_EXTERNAL_RESTART_RESULT=')).slice('SERIES_EXTERNAL_RESTART_RESULT='.length));
    assert.equal(result.commits.length,1);assert.equal(result.entry.status,'active');
    assert.equal(result.produced.length,1);assert.equal(result.integrationCalls,0);
    assert.deepEqual(result.foreignKeys,[]);assert.equal(result.integrity,'ok');
    const replay=await child([worker,root],{},60000);assert.equal(replay.status,0,replay.stdout+replay.stderr);
    const second=JSON.parse(replay.stdout.split(/\r?\n/).find(line=>line.startsWith('SERIES_EXTERNAL_RESTART_RESULT=')).slice('SERIES_EXTERNAL_RESTART_RESULT='.length));
    assert.equal(second.commits.length,1);assert.deepEqual(second.produced,result.produced);
  } finally { fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}); }
});

test('stopped Series transcode can be administratively retired without finishing the encode', {timeout:240000}, async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-series-retire-'));
  try {
    const seeded=await child(['--test-name-pattern=with real Direct Remux Transcode$',path.join(__dirname,'series-routing-run.test.js')],
      {HELIX_SERIES_REAL_MEDIA:'1',HELIX_SERIES_SHUTDOWN_ROOT:root},180000);
    assert.equal(seeded.status,74,seeded.stdout+seeded.stderr);
    const boundary=JSON.parse(fs.readFileSync(path.join(root,'shutdown-boundary.json'),'utf8'));
    assert.equal(boundary.children,0);assert.equal(boundary.commits,0);
    const Database=require('better-sqlite3'),dataDir=path.join(root,'data');
    const db=new Database(path.join(dataDir,'shelfdeck.db'),{readonly:true});
    try {
      const workspaceRoot=db.prepare("SELECT resolved_root FROM platform_workspace_roots WHERE root_id='service-libra-production-workspace'").get().resolved_root;
      const beforeAttempts=db.prepare('SELECT count(*) n FROM fx_event_attempts').get().n;
      const sourceFiles=fs.readdirSync(path.join(root,'source'),{recursive:true}).sort();
      const reset=require('../../scripts/user-formation-reset').createUserFormationReset({dataDir,workspaceRoot});
      const preview=reset.preview();assert.equal(preview.ready,true,JSON.stringify(preview.blockers));
      const {writeAtomic}=require('../../src/clean-runtime-operations');
      fs.mkdirSync(path.join(dataDir,'operator-runtime'),{recursive:true});
      const result=await reset.apply(preview,backup=>writeAtomic(path.join(dataDir,'operator-runtime','intent.json'),{
        schema:'shelfdeck.runtime-intent@1',desiredMode:'stopped',revision:1,pendingReset:{...backup,previewDigest:preview.previewDigest}}));
      assert.ok(result.retiredSubjects>0);
      assert.equal(db.prepare('SELECT count(*) n FROM fx_event_attempts').get().n,beforeAttempts);
      assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,0);
      assert.equal(db.prepare("SELECT count(*) n FROM fx_workflow_events WHERE state='executing'").get().n,0);
      assert.equal(db.prepare("SELECT count(*) n FROM fx_effect_journal WHERE state IN ('intended','effect_observed','reconcile_required')").get().n,0);
      assert.equal(db.prepare("SELECT count(*) n FROM fx_command_receipts WHERE command_contract='foundation.stopped-execution-termination@1'").get().n,1);
      assert.deepEqual(fs.readdirSync(path.join(root,'source'),{recursive:true}).sort(),sourceFiles);
      assert.deepEqual(db.pragma('foreign_key_check'),[]);
      assert.equal(db.pragma('integrity_check')[0].integrity_check,'ok');
      assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir,'operator-runtime','intent.json'))).desiredMode,'stopped');
    }finally{db.close();}
  }finally{fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
