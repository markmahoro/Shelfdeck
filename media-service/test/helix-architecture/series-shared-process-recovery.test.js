'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
function child(args,env,timeoutMs=150000){return new Promise((resolve,reject)=>{
  const childEnv={...process.env,...env};delete childEnv.NODE_TEST_CONTEXT;const processHandle=spawn(process.execPath,args,{env:childEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';
  processHandle.stdout.on('data',chunk=>{output+=chunk;});processHandle.stderr.on('data',chunk=>{output+=chunk;});
  const timer=setTimeout(()=>{processHandle.kill();reject(new Error('Series recovery child timed out: '+output));},timeoutMs);
  processHandle.on('error',reject);processHandle.on('close',status=>{clearTimeout(timer);resolve({status,output});});
});}
for(const phase of ['workspace','publish','command'])test('Series shared '+phase+' process loss resumes exact files and commits one shared version',{timeout:300000},async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-series-routing-shared-'));
  try{
    const crash=await child(['--test-name-pattern=^Isolated Host schedules 2 Episodes through metadata and Direct On-deck Commit$',path.join(__dirname,'series-routing-run.test.js')],
      {HELIX_SERIES_SHARED_CRASH_ROOT:root,HELIX_SERIES_SHARED_CRASH_PHASE:phase,...(phase==='command'?{HELIX_SERIES_SHARED_RETRY:'1'}:{})});assert.equal(crash.status,78,crash.output);
    const boundary=JSON.parse(fs.readFileSync(path.join(root,'shared-crash-boundary.json'),'utf8'));
    if(phase==='command'){assert.equal(boundary.receipts,1);assert.equal(boundary.builds,2);assert.equal(boundary.works,1);}else{assert.ok(boundary.events.some(row=>row.state==='executing'));assert.ok(fs.existsSync(boundary.location));}
    const worker=path.join(__dirname,'../fixtures/series-shutdown-restart-worker.js'),restarted=await child([worker,root,'shared'],{});
    assert.equal(restarted.status,0,restarted.output);
    const parse=value=>JSON.parse(value.output.split(/\r?\n/).find(line=>line.startsWith('SERIES_EXTERNAL_RESTART_RESULT=')).slice('SERIES_EXTERNAL_RESTART_RESULT='.length)),result=parse(restarted);
    assert.equal(result.commits.length,1);assert.equal(result.sharedVersions.length,1);assert.equal(result.sharedReferences.length,1);assert.equal(result.integrationCalls,0);
    assert.deepEqual(result.foreignKeys,[]);assert.equal(result.integrity,'ok');
    const replay=await child([worker,root,'shared'],{});assert.equal(replay.status,0,replay.output);assert.deepEqual(parse(replay).sharedVersions,result.sharedVersions);assert.equal(parse(replay).commits.length,1);
  }finally{if(process.env.HELIX_SERIES_SHARED_RETAIN==='1')process.stdout.write('RETAINED_SERIES_SHARED_ROOT='+root+'\n');else fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
