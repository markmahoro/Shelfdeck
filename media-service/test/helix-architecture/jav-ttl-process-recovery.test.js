'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
function child(args,env,timeoutMs=150000){return new Promise((resolve,reject)=>{
  const childEnv={...process.env,...env};delete childEnv.NODE_TEST_CONTEXT;
  const handle=spawn(process.execPath,args,{env:childEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';
  handle.stdout.on('data',chunk=>{output+=chunk;});handle.stderr.on('data',chunk=>{output+=chunk;});
  const timer=setTimeout(()=>{handle.kill();reject(new Error('JAV TTL child timed out: '+output));},timeoutMs);
  handle.on('error',reject);handle.on('close',status=>{clearTimeout(timer);resolve({status,output});});
});}
test('JAV identity process loss recovers the same Event beyond Handle TTL and commits exactly once',{timeout:300000},async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-jav-host-ttl-'));
  try{
    const crash=await child(['--test-name-pattern=^isolated JAV Host',path.join(__dirname,'jav-host-journey.test.js')],{HELIX_JAV_TTL_CRASH_ROOT:root});
    assert.equal(crash.status,79,crash.output);
    const boundary=JSON.parse(fs.readFileSync(path.join(root,'ttl-crash-boundary.json'),'utf8'));assert.equal(boundary.events.length,1);
    const worker=path.join(__dirname,'../fixtures/jav-ttl-restart-worker.js');
    const first=await child([worker,root],{});assert.equal(first.status,0,first.output);
    const parse=value=>JSON.parse(value.output.split(/\r?\n/).find(line=>line.startsWith('JAV_TTL_RECOVERY=')).slice('JAV_TTL_RECOVERY='.length)),result=parse(first);
    assert.equal(result.commits,1);assert.ok(result.failures.every(row=>row.failure_code!=='P4_EVENT_RECOVERY_INPUT_DRIFT'));
    assert.deepEqual(result.foreignKeys,[]);assert.equal(result.integrity,'ok');
    const replay=await child([worker,root],{});assert.equal(replay.status,0,replay.output);assert.equal(parse(replay).commits,1);
  }finally{if(process.env.HELIX_JAV_TTL_RETAIN==='1')process.stdout.write('RETAINED_JAV_TTL_ROOT='+root+'\n');else fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
