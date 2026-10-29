'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
function child(args,env={}) {return new Promise((resolve,reject)=>{
  const childEnv={...process.env,...env};delete childEnv.NODE_TEST_CONTEXT;
  const proc=spawn(process.execPath,args,{env:childEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';
  proc.stdout.on('data',chunk=>output+=chunk);proc.stderr.on('data',chunk=>output+=chunk);
  const timer=setTimeout(()=>{proc.kill();reject(new Error('Relocation recovery child timed out: '+output));},210000);
  proc.once('error',error=>{clearTimeout(timer);reject(error);});proc.once('close',status=>{clearTimeout(timer);resolve({status,output});});
});}
for(const phase of ['rename','commit'])test('actual process loss after whole-Series '+phase+' resumes the original plan without splitting Seasons',{timeout:450000},async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-series-routing-rootmove-'));
  try {
    const first=await child(['--test-name-pattern=with separate same-title Seasons',path.join(__dirname,'series-routing-run.test.js')],{
      HELIX_SERIES_ROOT_RELOCATE:'1',HELIX_SERIES_ROOT_RELOCATION_CRASH_ROOT:root,HELIX_SERIES_ROOT_RELOCATION_CRASH_PHASE:phase});
    assert.equal(first.status,79,first.output);
    const boundary=JSON.parse(fs.readFileSync(path.join(root,'relocation-boundary.json'),'utf8')),plan=JSON.parse(boundary.relocation.plan_json);
    assert.equal(plan.seasons.length,2);assert.equal(boundary.relocation.state,phase==='rename'?'active':'committed');
    assert.ok(boundary.events.some(row=>row.state==='executing'));assert.equal(fs.existsSync(plan.oldRoot),false);assert.ok(fs.existsSync(plan.newRoot));
    const worker=path.join(__dirname,'../fixtures/series-shutdown-restart-worker.js');
    const parse=value=>JSON.parse(value.output.split(/\r?\n/).find(line=>line.startsWith('SERIES_EXTERNAL_RESTART_RESULT=')).slice('SERIES_EXTERNAL_RESTART_RESULT='.length));
    const restarted=await child([worker,root,'relocation']);assert.equal(restarted.status,0,restarted.output);const result=parse(restarted);
    assert.equal(result.relocations.length,1);assert.equal(result.relocations[0].state,'committed');assert.equal(result.relocations[0].plan_digest,boundary.relocation.plan_digest);
    assert.equal(result.relocationEvents.length,2);assert.ok(result.relocationEvents.every(row=>row.state==='succeeded'));
    assert.deepEqual(result.protectedRows,boundary.protectedRows);assert.equal(result.commits.length,2);assert.equal(result.sharedVersions.length,2);
    assert.deepEqual(result.foreignKeys,[]);assert.equal(result.integrity,'ok');
    const replay=await child([worker,root,'relocation']);assert.equal(replay.status,0,replay.output);const repeated=parse(replay);
    assert.deepEqual(repeated.relocations,result.relocations);assert.deepEqual(repeated.sharedVersions,result.sharedVersions);assert.deepEqual(repeated.protectedRows,result.protectedRows);
  }finally {
    if(process.env.HELIX_SERIES_ROOT_RELOCATION_RETAIN==='1')process.stdout.write('RETAINED_RELOCATION_ROOT='+root+'\n');
    else {assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
  }
});
