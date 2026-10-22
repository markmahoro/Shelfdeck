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
