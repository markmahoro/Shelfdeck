'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Fastify=require('fastify');
const {registerAdminStatic}=require('../src/clean-admin-static');

test('Admin build assets use bounded reads while retaining exact bytes, range, HEAD and ETag semantics',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'admin-static-')),server=Fastify();
  const bytes=Buffer.alloc(503927);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
  fs.mkdirSync(path.join(root,'assets'));fs.writeFileSync(path.join(root,'assets','index-test.js'),bytes);fs.writeFileSync(path.join(root,'index.html'),'<html>test</html>');
  const watermarks=[];server.addHook('onSend',async(_request,_reply,payload)=>{if(payload?.readableHighWaterMark)watermarks.push(payload.readableHighWaterMark);return payload;});
  try{
    await registerAdminStatic(server,root);
    const result=await server.inject('/assets/index-test.js');assert.equal(result.statusCode,200);assert.deepEqual(result.rawPayload,bytes);assert.ok(watermarks.includes(512*1024));
    const partial=await server.inject({url:'/assets/index-test.js',headers:{range:'bytes=17-100'}});assert.equal(partial.statusCode,206);assert.deepEqual(partial.rawPayload,bytes.subarray(17,101));
    const head=await server.inject({method:'HEAD',url:'/assets/index-test.js'});assert.equal(head.statusCode,200);assert.equal(head.rawPayload.length,0);assert.equal(Number(head.headers['content-length']),bytes.length);
    assert.equal((await server.inject({url:'/assets/index-test.js',headers:{'if-none-match':result.headers.etag}})).statusCode,304);
    assert.equal((await server.inject('/assets/missing.js')).statusCode,404);
    assert.equal((await server.inject('/assets/%2e%2e/%2e%2e/package.json')).statusCode,404);
    assert.equal((await server.inject('/')).headers['cache-control'],'no-store');
  }finally{await server.close();fs.rmSync(root,{recursive:true,force:true});}
});
