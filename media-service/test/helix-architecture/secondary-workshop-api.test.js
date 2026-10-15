'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {initializeCleanData}=require('../../scripts/helix-operational-safety');
const {createCleanServiceHost}=require('../../src/clean-service-host');

test('secondary workshop API is authenticated, read-only by default, globally scoped and idempotent',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'secondary-workshop-api-'));
 let host;
 t.after(async()=>{await host?.close();assert.equal(path.dirname(root),os.tmpdir());fs.rmSync(root,{recursive:true,force:true});});
 const dataDir=path.join(root,'data'),adminDistDir=path.join(root,'admin');
 fs.mkdirSync(adminDistDir);fs.writeFileSync(path.join(adminDistDir,'index.html'),'<div id="root"></div>');
 const secretRoot='secondary-workshop-fixture-0123456789abcdef0123456789';
 const initialized=initializeCleanData({dataDir,secretRoot,confirmation:'INITIALIZE_HELIX_CLEAN_V1'});
 host=await createCleanServiceHost({dataDir,adminDistDir,secretRoot});
 const url='/v1/admin/libra/workshops/secondary';
 assert.equal((await host.inject({method:'GET',url})).statusCode,401);
 const login=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}});
 assert.equal(login.statusCode,204);
 const headers={cookie:login.headers['set-cookie']};
 const initial=await host.inject({method:'GET',url,headers});assert.equal(initial.statusCode,200);
 assert.deepEqual(initial.json(),{secondarySeats:5,policyRevision:1,updatedAtMs:0,held:0,free:5});
 const update=await host.inject({method:'PATCH',url,headers,payload:{secondarySeats:0,idempotencyKey:'same-policy'}});assert.equal(update.statusCode,200,update.body);
 const replay=await host.inject({method:'PATCH',url,headers,payload:{secondarySeats:0,idempotencyKey:'same-policy'}});assert.deepEqual(replay.json(),update.json());
 assert.equal(replay.json().secondarySeats,0);assert.equal(replay.json().free,0);
 for(const payload of [{secondarySeats:-1},{secondarySeats:33},{secondarySeats:1.5},{secondarySeats:'5'},{secondarySeats:2,fieldId:'not-a-source-policy'}]){
  const invalid=await host.inject({method:'PATCH',url,headers,payload:{...payload,idempotencyKey:'invalid-input'}});assert.equal(invalid.statusCode,400,invalid.body);
 }
 const field=await host.inject({method:'GET',url:'/v1/admin/libra/material-fields/unconfigured-source/intake-admission',headers});
 assert.equal(field.statusCode,200);assert.equal(field.json().predeckPipelineSeats,3);
});
