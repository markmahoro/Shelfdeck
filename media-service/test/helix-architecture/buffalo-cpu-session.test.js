'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createBuffaloCpuSession}=require('../../src/helix/integrations/buffalo-cpu-session');
function fixture(){
  const thread=new EventEmitter(),messages=[];let terminated=0,created=0;
  thread.postMessage=message=>messages.push(message);thread.terminate=async()=>{terminated++;thread.emit('exit',1);};
  const session=createBuffaloCpuSession({modelRoot:'/fixture/models',createWorker(){created++;return thread;}});
  return {session,thread,messages,terminated:()=>terminated,created:()=>created};
}
const options=()=>({deadlineAtMs:Date.now()+5000});
test('CPU isolation has one operation slot, owns transferred bytes, and admits stop while occupied',async()=>{
  const f=fixture(),bytes=Buffer.from([1,2,3]),pending=f.session.analyzeEvidence(bytes,options());
  f.messages[0].bytes[0]=99;assert.equal(bytes[0],1);
  await assert.rejects(f.session.load(options()),{code:'BUFFALO_CPU_BUSY'});assert.equal(f.messages.length,1);
  const rejected=assert.rejects(pending,{code:'BUFFALO_CPU_STOPPED'});await f.session.stop();await rejected;
  assert.equal(f.terminated(),1);await f.session.stop();assert.equal(f.terminated(),1);
  await assert.rejects(f.session.load(options()),{code:'BUFFALO_CPU_CLOSED'});
});
test('CPU cancellation terminates its native thread and cannot accept a late successful response',async()=>{
  const f=fixture(),controller=new AbortController(),pending=f.session.load({...options(),signal:controller.signal}),
    rejected=assert.rejects(pending,{code:'BUFFALO_CPU_CANCELLED'});
  controller.abort();await rejected;await f.session.stop();
  f.thread.emit('message',{id:f.messages[0].id,ok:true,value:{late:true}});assert.equal(f.terminated(),1);
  await assert.rejects(f.session.load(options()),{code:'BUFFALO_CPU_CLOSED'});
});
test('a CPU timeout stops the exact in-flight session instead of allowing invisible background inference',async()=>{
  const f=fixture(),began=performance.now();
  await assert.rejects(f.session.load({deadlineAtMs:Date.now()+25}),{code:'BUFFALO_CPU_TIMEOUT'});await f.session.stop();
  assert.equal(f.terminated(),1);assert.ok(performance.now()-began<1000);
});
test('a malformed reply, thread error, unexpected exit or failed post rejects the pending operation',async()=>{
  for(const event of ['reply','error','exit','post']){
    const f=fixture();if(event==='post')f.thread.postMessage=()=>{throw Error('Cannot post');};
    const pending=f.session.load(options()),rejected=assert.rejects(pending,{code:event==='reply'?'BUFFALO_CPU_PROTOCOL_INVALID':'BUFFALO_CPU_FAILED'});
    if(event==='reply')f.thread.emit('message',{id:999,ok:true,value:{}});
    if(event==='error')f.thread.emit('error',Error('Native failure'));
    if(event==='exit')f.thread.emit('exit',1);
    await rejected;await f.session.stop();assert.equal(f.terminated(),1);
  }
});
test('operation errors remain explicit and a valid response releases the single CPU slot',async()=>{
  const f=fixture(),first=f.session.analyzeEvidence(Buffer.from([1]),options()),rejected=assert.rejects(first,{code:'BUFFALO_IMAGE_INVALID'});
  f.thread.emit('message',{id:f.messages[0].id,ok:false,error:{code:'BUFFALO_IMAGE_INVALID'}});await rejected;
  const next=f.session.groupFaces([],{threshold:0.5,ambiguityMargin:0.05},options());
  f.thread.emit('message',{id:f.messages[1].id,ok:true,value:[]});assert.deepEqual(await next,[]);await f.session.stop();
});
test('invalid inputs and already expired or aborted requests never create a CPU thread',async()=>{
  const f=fixture(),controller=new AbortController();controller.abort();
  for(const params of [{},{deadlineAtMs:NaN},{deadlineAtMs:Date.now()+600001},{...options(),signal:{}}])
    await assert.rejects(f.session.load(params),{code:'BUFFALO_CPU_INPUT_INVALID'});
  await assert.rejects(f.session.load({deadlineAtMs:Date.now()-1}),{code:'BUFFALO_CPU_TIMEOUT'});
  await assert.rejects(f.session.load({...options(),signal:controller.signal}),{code:'BUFFALO_CPU_CANCELLED'});
  await assert.rejects(f.session.analyzeEvidence(Buffer.alloc(0),options()),{code:'BUFFALO_CPU_INPUT_INVALID'});
  await assert.rejects(f.session.groupFaces(Array(1281).fill({}),{},options()),{code:'BUFFALO_CPU_INPUT_INVALID'});
  await assert.rejects(f.session.renderRepresentative({frameBytes:Buffer.from([1]),evidence:{},faceOrdinal:0},options()),{code:'BUFFALO_CPU_INPUT_INVALID'});
  await assert.rejects(f.session.load({...options(),signal:{addEventListener(){},aborted:false}}),{code:'BUFFALO_CPU_INPUT_INVALID'});
  assert.equal(f.created(),0);await f.session.stop();
});
test('Linux executes grouping in the service CPU thread and returns errors without converting them to no faces',{
  skip:process.platform!=='linux'?'Linux Docker native runtime is required.':false,timeout:10000,
},async t=>{
  const session=createBuffaloCpuSession({modelRoot:'/fixture/unused-models'});t.after(()=>session.stop());
  const result=await session.groupFaces([],{threshold:0.5,ambiguityMargin:0.05},options());assert.deepEqual(result,[]);
  await assert.rejects(session.groupFaces([],{threshold:0.5},options()),{code:'BUFFALO_VIDEO_EVIDENCE_INVALID'});
  await assert.rejects(session.analyzeEvidence(Buffer.from('not an image'),options()),{code:'BUFFALO_IMAGE_INVALID'});
});
