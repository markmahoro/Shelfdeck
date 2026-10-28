'use strict';
// A bounded service-local CPU isolation test, not an independent runtime or Work owner.
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const policy=require('./parity-policy.json');
function failure(code,message){return Object.assign(new Error(message),{code});}
if(!isMainThread){
  const {createBuffaloImageEngine}=require('./image-engine');
  const {createCatalogue}=require('./catalogue');
  const engine=createBuffaloImageEngine({modelRoot:workerData.modelRoot});
  const catalogue=createCatalogue({root:workerData.catalogueRoot});
  parentPort.on('message',async request=>{
    try{
      let result;
      if(request.kind==='load'){await engine.load();catalogue.load();result={stats:catalogue.stats(),memory:process.memoryUsage()};}
      else if(request.kind==='query')result=catalogue.search(request.vector);
      else if(request.kind==='analyze'){
        const started=performance.now();
        const faces=request.raw
          ? await engine.analyzeRaw({data:Buffer.from(request.bytes),width:request.width,height:request.height})
          : await engine.analyze(Buffer.from(request.bytes));
        const accepted=faces.filter(face=>Math.trunc(face.rectangle[2])-Math.trunc(face.rectangle[0])>=40&&
          Math.trunc(face.rectangle[3])-Math.trunc(face.rectangle[1])>=40);
        result={faces:accepted.map(face=>({...face,...catalogue.search(face.vector)})),elapsedMs:performance.now()-started,memory:process.memoryUsage()};
      }
      else throw failure('BUFFALO_PROTOCOL_INVALID','An unsupported qualification operation was requested.');
      parentPort.postMessage({id:request.id,ok:true,result});
    }catch(error){parentPort.postMessage({id:request.id,ok:false,error:{code:error.code||'BUFFALO_OPERATION_FAILED',message:String(error.message).slice(0,1024)}});}
  });
}else{
  function createImageSession({modelRoot,catalogueRoot}){
    let thread=null,pending=null,sequence=0,closed=false,stopping=null;
    function ensure(){
      if(closed)throw failure('BUFFALO_CLOSED','The image session has been stopped.');
      if(!thread){
        thread=new Worker(__filename,{workerData:{modelRoot,catalogueRoot}});
        thread.on('message',reply=>{
          if(!pending||reply.id!==pending.id)return;
          const current=pending;pending=null;current.cleanup();
          if(reply.ok)current.resolve(reply.result);else current.reject(failure(reply.error.code,reply.error.message));
        });
        thread.on('error',()=>void stop(failure('BUFFALO_SESSION_FAILED','The image session failed.')));
        thread.on('exit',()=>{if(!closed)void stop(failure('BUFFALO_SESSION_FAILED','The image session exited unexpectedly.'));});
      }
    }
    function stop(reason=failure('BUFFALO_STOPPED','The image session was stopped.')){
      closed=true;
      if(pending){const current=pending;pending=null;current.cleanup();current.reject(reason);}
      if(!stopping)stopping=thread?thread.terminate().then(()=>{}):Promise.resolve();
      return stopping;
    }
    function send(kind,values={},options={}){
      const timeoutMs=options.timeoutMs??policy.maximumOperationMs;
      if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>policy.maximumOperationMs)
        return Promise.reject(failure('BUFFALO_INPUT_INVALID','The image deadline is invalid.'));
      if(options.signal?.aborted)return Promise.reject(failure('BUFFALO_CANCELLED','The image operation was cancelled.'));
      if(closed)return Promise.reject(failure('BUFFALO_CLOSED','The image session has been stopped.'));
      if(pending)return Promise.reject(failure('BUFFALO_BUSY','The single image operation slot is occupied.'));
      if(values.bytes&&(!Buffer.isBuffer(values.bytes)||!values.bytes.length||values.bytes.length>policy.maximumImagePixels*3))
        return Promise.reject(failure('BUFFALO_INPUT_INVALID','The image operation input is invalid.'));
      if(kind==='query'&&(!Array.isArray(values.vector)||values.vector.length!==512||values.vector.some(value=>!Number.isFinite(value))))
        return Promise.reject(failure('BUFFALO_INPUT_INVALID','The query vector is invalid.'));
      ensure();
      return new Promise((resolve,reject)=>{
        const id=++sequence;
        const aborted=()=>void stop(failure('BUFFALO_CANCELLED','The image operation was cancelled.'));
        const timer=setTimeout(()=>void stop(failure('BUFFALO_TIMEOUT','The image operation exceeded its deadline.')),timeoutMs);
        const cleanup=()=>{clearTimeout(timer);options.signal?.removeEventListener('abort',aborted);};
        pending={id,resolve,reject,cleanup};options.signal?.addEventListener('abort',aborted,{once:true});
        try{
          const owned=values.bytes?Uint8Array.from(values.bytes):null;
          thread.postMessage({id,kind,...values,...(owned?{bytes:owned}:{})},owned?[owned.buffer]:[]);
        }catch{void stop(failure('BUFFALO_SESSION_FAILED','The image operation could not be sent.'));}
      });
    }
    return Object.freeze({load:options=>send('load',{},options),
      query:(vector,options)=>send('query',{vector},options),
      analyze:(bytes,options)=>send('analyze',{bytes},options),
      analyzeRaw:(image,options)=>send('analyze',{bytes:image.data,width:image.width,height:image.height,raw:true},options),stop});
  }
  module.exports=Object.freeze({createImageSession});
}
