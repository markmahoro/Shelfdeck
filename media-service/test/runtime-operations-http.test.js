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
    assert.equal((await request('POST','/v1/admin/runtime/actions/stop',{idempotencyKey:'stop'})).statusCode,202);await until('stopped');
    const health=await host.inject({method:'GET',url:'/v1/health'});assert.equal(health.statusCode,200);assert.equal(health.json().normalSupplyAllowed,false);
    assert.equal((await request('GET','/v1/admin/collection')).statusCode,200);
    const blocked=await request('POST','/v1/admin/material-fields',{idempotencyKey:'write'});assert.equal(blocked.statusCode,409);assert.equal(blocked.json().error.code,'RUNTIME_BUSINESS_WRITES_DISABLED');
    const preview=await request('GET','/v1/admin/runtime/reset-preview');assert.equal(preview.statusCode,200,preview.body);assert.equal(preview.json().empty,true);
    await host.close();host=null;host=await createCleanServiceHost(options);assert.equal((await until('stopped')).normalSupplyAllowed,false);
    assert.equal((await request('POST','/v1/admin/runtime/actions/resume',{idempotencyKey:'resume'})).statusCode,202);await until('running');
    assert.equal((await host.inject({method:'GET',url:'/v1/health'})).json().normalSupplyAllowed,true);
  }finally{await host?.close();fs.rmSync(root,{recursive:true,force:true});}
});
