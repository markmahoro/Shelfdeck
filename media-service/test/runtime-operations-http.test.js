'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {initializeCleanData}=require('../scripts/helix-operational-safety');
const {createCleanServiceHost}=require('../src/clean-service-host');
test('native clean host keeps authenticated HTTP online while stopped and recovers on explicit resume',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'runtime-operations-http-')),dataDir=path.join(root,'data'),adminDistDir=path.join(root,'admin');
  fs.mkdirSync(adminDistDir);fs.writeFileSync(path.join(adminDistDir,'index.html'),'<div id="root"></div>');
  const secretRoot='isolated-runtime-operations-secret-root-20261013';const init=initializeCleanData({dataDir,secretRoot,confirmation:'INITIALIZE_HELIX_CLEAN_V1'});
  const options={dataDir,adminDistDir,secretRoot};let host;
  async function request(method,url,payload){return host.inject({method,url,payload,headers:{'x-api-key':init.adminApiKey}});}
  async function until(mode){const deadline=Date.now()+10000;while(Date.now()<deadline){const r=await request('GET','/v1/admin/runtime');assert.equal(r.statusCode,200,r.body);if(r.json().mode===mode)return r.json();await new Promise(resolve=>setTimeout(resolve,20));}assert.fail('Runtime did not reach '+mode);}
  try{
    host=await createCleanServiceHost(options);
    assert.equal((await host.inject({method:'GET',url:'/v1/admin/runtime'})).statusCode,401);
    const stopped=await request('POST','/v1/admin/runtime/actions/stop',{idempotencyKey:'stop'});
    assert.equal(stopped.statusCode,202,stopped.body);await until('stopped');
    const health=await host.inject({method:'GET',url:'/v1/health'});assert.equal(health.statusCode,200);assert.equal(health.json().normalSupplyAllowed,false);
    assert.equal((await request('GET','/v1/admin/collection')).statusCode,200);
    const blocked=await request('POST','/v1/admin/material-fields',{idempotencyKey:'write'});assert.equal(blocked.statusCode,409);assert.equal(blocked.json().error.code,'RUNTIME_BUSINESS_WRITES_DISABLED');
    const preview=await request('GET','/v1/admin/runtime/reset-preview');assert.equal(preview.statusCode,409,preview.body);
    assert.equal(preview.json().error.code,'RESET_SUPERVISOR_REQUIRED','a bare Host cannot fall back to the obsolete retirement Reset');await until('stopped');
    await host.close();host=null;host=await createCleanServiceHost(options);assert.equal((await until('stopped')).normalSupplyAllowed,false);
    assert.equal((await request('POST','/v1/admin/runtime/actions/resume',{idempotencyKey:'resume'})).statusCode,202);await until('running');
    assert.equal((await host.inject({method:'GET',url:'/v1/health'})).json().normalSupplyAllowed,true);
  }finally{await host?.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('Operator closes one exact stopped Host generation and a reconstructed Host remains stopped', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'runtime-generation-http-')),dataDir=path.join(root,'data'),adminDistDir=path.join(root,'admin');
  fs.mkdirSync(adminDistDir);fs.writeFileSync(path.join(adminDistDir,'index.html'),'<div id="root"></div>');
  const secretRoot='isolated-runtime-generation-secret-root';
  const init=initializeCleanData({dataDir,secretRoot,confirmation:'INITIALIZE_HELIX_CLEAN_V1'});
  const options={dataDir,adminDistDir,secretRoot};let host;
  const generationId='d'.repeat(64),headers={'x-api-key':init.adminApiKey};
  try {
    host=await createCleanServiceHost(options);
    await assert.rejects(host.closeDatabaseGeneration({generationId,expectedRuntimeRevision:0}),{code:'RESET_HOST_NOT_DRAINED'});
    assert.equal((await host.inject({method:'POST',url:'/v1/admin/runtime/actions/stop',headers,payload:{idempotencyKey:'generation-stop'}})).statusCode,202);
    let state;
    const deadline=Date.now()+10000;
    do {
      state=(await host.inject({method:'GET',url:'/v1/admin/runtime',headers})).json();
      if(state.mode==='stopped')break;
      await new Promise(resolve=>setTimeout(resolve,10));
    } while(Date.now()<deadline);
    assert.equal(state.mode,'stopped');
    await assert.rejects(host.closeDatabaseGeneration({generationId,expectedRuntimeRevision:state.revision-1}),{code:'RESET_HOST_NOT_DRAINED'});
    const receipt=await host.closeDatabaseGeneration({generationId,expectedRuntimeRevision:state.revision});
    assert.deepEqual(receipt,{generationId,allBusinessConnectionsClosed:true});
    assert.deepEqual(await host.closeDatabaseGeneration({generationId,expectedRuntimeRevision:state.revision}),receipt);
    await assert.rejects(host.closeDatabaseGeneration({generationId:'e'.repeat(64),expectedRuntimeRevision:state.revision}),{code:'RESET_HOST_NOT_DRAINED'});
    // Windows also refuses this rename when an old SQLite connection survives.
    const database=path.join(dataDir,'shelfdeck.db'),parked=path.join(dataDir,'closed-generation.db');
    fs.renameSync(database,parked);fs.renameSync(parked,database);
    await host.close();
    host=await createCleanServiceHost(options);
    const restarted=(await host.inject({method:'GET',url:'/v1/admin/runtime',headers})).json();
    assert.equal(restarted.mode,'stopped');assert.equal(restarted.normalSupplyAllowed,false);
  } finally { await host?.close();fs.rmSync(root,{recursive:true,force:true}); }
});
