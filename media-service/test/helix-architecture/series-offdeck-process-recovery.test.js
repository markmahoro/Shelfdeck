'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
function child(args,env,timeoutMs) {
  return new Promise((resolve,reject)=>{
    const childEnv={...process.env,...env};delete childEnv.NODE_TEST_CONTEXT;
    const processHandle=spawn(process.execPath,args,{env:childEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',timedOut=false;processHandle.stdout.on('data',chunk=>{stdout+=chunk;});processHandle.stderr.on('data',chunk=>{stderr+=chunk;});
    const timer=setTimeout(()=>{timedOut=true;processHandle.kill();},timeoutMs);
    processHandle.on('error',error=>{clearTimeout(timer);reject(error);});
    processHandle.on('close',status=>{clearTimeout(timer);if(timedOut)reject(new Error('Fixture child timed out: '+stderr));else resolve({status,stdout,stderr});});
  });
}
test('Series N:M Off-deck resumes in a new Service Host after deletion and before terminal Commit',{
  skip:process.env.HELIX_SERIES_OFFDECK_RESTART!=='1',timeout:420000,
},async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-series-routing-'));
  try {
    const seeded=await child(['--test-name-pattern=with real N:M Off-deck$',path.join(__dirname,'series-routing-run.test.js')],
      {HELIX_SERIES_OFFDECK:'1',HELIX_SERIES_OFFDECK_CRASH_ROOT:root,HELIX_SERIES_OFFDECK_DELETE_FAILURE:'1'},150000);
    assert.equal(seeded.status,73,'The seed Host must terminate at the injected process exit. '+seeded.stdout+seeded.stderr);
    const boundaryPath=path.join(root,'crash-boundary.json');assert.ok(fs.existsSync(boundaryPath),seeded.stdout+seeded.stderr);
    const boundary=JSON.parse(fs.readFileSync(boundaryPath,'utf8'));
    assert.equal(boundary.entry.status,'offdeck_in_progress');assert.equal(boundary.terminalReceipts,0);
    assert.equal(boundary.injectedDeleteFailures,1);assert.equal(boundary.caseCount,1);assert.equal(boundary.authorizationCount,1);
    assert.ok(boundary.unavailableAttempts.length>=1&&boundary.unavailableAttempts.every(item=>item.failure_class==='integration'));
    assert.equal(boundary.materials.length,6);assert.equal(boundary.deletionEvidence.length,6);
    assert.equal(boundary.materials.flatMap(item=>item.episode_claims_json?JSON.parse(item.episode_claims_json).items:[]).length,3);
    for(const item of boundary.materials)assert.equal(fs.existsSync(item.location),false);
    const worker=path.resolve(__dirname,'../fixtures/series-offdeck-restart-worker.js');
    const recovered=await child([worker,root],{},120000);assert.equal(recovered.status,0,recovered.stdout+recovered.stderr);
    const result=JSON.parse(recovered.stdout);assert.equal(result.entryStatus,'offdecked');assert.equal(result.caseState,'completed');
    assert.equal(result.deckRevision,boundary.entry.current_deck_fact_revision+1);assert.equal(result.terminalReceipts,1);assert.equal(result.controlled,0);
    assert.deepEqual(result.deletionEvidence,[...boundary.deletionEvidence].sort((a,b)=>a.material_key.localeCompare(b.material_key)));
    assert.deepEqual(result.foreignKeys,[]);assert.equal(result.integrity,'ok');
    const repeated=await child([worker,root],{},120000);assert.equal(repeated.status,0,repeated.stdout+repeated.stderr);
    assert.deepEqual(JSON.parse(repeated.stdout),result);
    const sentinel=path.join(root,'shelf','outside-offdeck.keep');
    assert.equal(fs.readFileSync(sentinel,'utf8'),'outside the authorized Series scope');
  } finally {
    assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(root).startsWith('helix-series-routing-'));
    fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
