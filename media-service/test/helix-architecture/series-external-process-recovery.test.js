'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {createHash}=require('node:crypto');
function child(args,env,timeoutMs) {
  return new Promise((resolve,reject)=>{
    const childEnv={...process.env,...env};delete childEnv.NODE_TEST_CONTEXT;
    const processHandle=spawn(process.execPath,args,{env:childEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',timedOut=false;
    processHandle.stdout.on('data',chunk=>{stdout+=chunk;});processHandle.stderr.on('data',chunk=>{stderr+=chunk;});
    const timer=setTimeout(()=>{timedOut=true;processHandle.kill();},timeoutMs);
    processHandle.on('error',error=>{clearTimeout(timer);reject(error);});
    processHandle.on('close',status=>{clearTimeout(timer);if(timedOut)reject(new Error('External child timed out: '+stderr));else resolve({status,stdout,stderr});});
  });
}
function summary(stdout) {
  const prefix='SERIES_EXTERNAL_RESTART_RESULT=';
  const lines=stdout.split(/\r?\n/).filter(line=>line.startsWith(prefix));
  assert.equal(lines.length,1,stdout);return JSON.parse(lines[0].slice(prefix.length));
}
test('Series external Transcode resumes in a new Host after settlement and before On-deck Commit',{
  skip:process.env.HELIX_SERIES_EXTERNAL_RESTART!=='1'?'Set HELIX_SERIES_EXTERNAL_RESTART=1 for isolated external process recovery':false,timeout:480000,
},async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-series-routing-'));
  try {
    const seeded=await child(['--test-name-pattern=with external shared-file replacement$',path.join(__dirname,'series-routing-run.test.js')],
      {HELIX_SERIES_EXTERNAL:'1',HELIX_SERIES_EXTERNAL_REAL:'1',HELIX_SERIES_EXTERNAL_TRANSCODE:'1',HELIX_SERIES_EXTERNAL_CRASH_ROOT:root},240000);
    assert.equal(seeded.status,73,seeded.stdout+seeded.stderr);
    const boundary=JSON.parse(fs.readFileSync(path.join(root,'external-crash-boundary.json'),'utf8'));
    assert.equal(boundary.downloadCalls,1);assert.equal(boundary.produced.length,2);assert.equal(boundary.offload.length,1);
    assert.equal(JSON.parse(boundary.offload[0].final_product_material_keys_json).length,2);
    const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const sentinel=path.join(root,'outside-external.keep');fs.writeFileSync(sentinel,'outside the external Run');
    const worker=path.resolve(__dirname,'../fixtures/series-external-restart-worker.js');
    const recovered=await child([worker,root],{},150000);assert.equal(recovered.status,0,recovered.stdout+recovered.stderr);
    const result=summary(recovered.stdout);assert.equal(result.commits.length,1);assert.equal(result.integrationCalls,0);
    assert.deepEqual(result.offload,boundary.offload);assert.deepEqual(result.produced,boundary.produced);
    assert.equal(result.materials.length,boundary.files.length);
    for(const {member,sha256} of boundary.files){
      assert.equal(hash(member.targetLocation),sha256);
      assert.ok(result.materials.some(item=>item.location===member.targetLocation));
    }
    assert.deepEqual(result.materials.filter(item=>item.role==='primary_payload').flatMap(item=>JSON.parse(item.episode_claims_json).items.map(claim=>claim.episodeKey)).sort(),['E001','E002']);
    assert.ok(boundary.sources.every(file=>!fs.existsSync(file)));
    for(const file of boundary.providerFiles)assert.equal(hash(file.location),file.sha256);
    assert.deepEqual(result.foreignKeys,[]);assert.equal(result.integrity,'ok');
    const repeated=await child([worker,root],{},150000);assert.equal(repeated.status,0,repeated.stdout+repeated.stderr);
    assert.deepEqual(summary(repeated.stdout),result);assert.equal(fs.readFileSync(sentinel,'utf8'),'outside the external Run');
  } finally {
    assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(root).startsWith('helix-series-routing-'));
    fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
