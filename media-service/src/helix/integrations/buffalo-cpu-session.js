'use strict';
// Technical CPU isolation inside the monolith. Work admission and Permits remain with the Runtime.
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const {buffaloModelReference,pack}=require('../contracts/buffalo-model-reference');
const {canonicalJson}=require('../contracts/canonical-json');
const {assertGeneration}=require('../contracts/face-catalogue-generation');
const {assertCatalogueSearchPolicy}=require('../contracts/face-catalogue-search-policy');
function failure(code,message){return Object.assign(new Error(message),{code});}
if(!isMainThread&&workerData?.protocol==='shelfdeck.buffalo-cpu@1'){
  const {createBuffaloImageEngine}=require('./buffalo-image-engine'),{clusterFaces}=require('./buffalo-video-evidence'),
    {createBuffaloRepresentativeImage}=require('./buffalo-representative-image'),engine=createBuffaloImageEngine({modelRoot:workerData.modelRoot}),renderer=createBuffaloRepresentativeImage(),
    catalogue=workerData.catalogue?require('./buffalo-face-catalogue').createBuffaloFaceCatalogue(workerData.catalogue):null;
  let occupied=false;
  parentPort.on('message',async request=>{
    if(occupied){parentPort.postMessage({id:request.id,ok:false,error:{code:'BUFFALO_CPU_BUSY',message:'The CPU slot is occupied.'}});return;}
    occupied=true;
    try{
      let value;
      if(request.kind==='load'){await engine.load();value={faceModelRef:buffaloModelReference('western_frame_set')};}
      else if(request.kind==='loadCatalogue'){
        if(!catalogue)throw failure('BUFFALO_CATALOGUE_UNAVAILABLE','No qualified catalogue resource was configured.');
        value=await catalogue.load({deadlineAtMs:request.deadlineAtMs});
      }
      else if(request.kind==='query'){
        if(!catalogue)throw failure('BUFFALO_CATALOGUE_UNAVAILABLE','No qualified catalogue resource was configured.');
        value=catalogue.search(request.vector);
      }
      else if(request.kind==='analyze')value=await engine.analyzeEvidence(Buffer.from(request.bytes));
      else if(request.kind==='group')value=clusterFaces(request.faces,request.parameters);
      else if(request.kind==='representative'){
        const result=await renderer.render({...request.parameters,frameBytes:Buffer.from(request.bytes),deadlineAtMs:request.deadlineAtMs}),bytes=Uint8Array.from(result.bytes);
        parentPort.postMessage({id:request.id,ok:true,value:{bytes,proof:result.proof}},[bytes.buffer]);return;
      }else throw failure('BUFFALO_CPU_PROTOCOL_INVALID','An unsupported CPU operation was requested.');
      parentPort.postMessage({id:request.id,ok:true,value});
    }catch(error){parentPort.postMessage({id:request.id,ok:false,error:{code:error.code||'BUFFALO_CPU_FAILED',message:'The bounded buffalo CPU operation failed.'}});}
    finally{occupied=false;}
  });
}else{
  function createBuffaloCpuSession({modelRoot,catalogueRoot,catalogueGeneration,catalogueSearchPolicy,createWorker=(file,settings)=>new Worker(file,settings)}={}){
    if(typeof modelRoot!=='string'||!modelRoot||typeof createWorker!=='function')throw new TypeError('The pinned local buffalo model root is required.');
    const catalogue=catalogueRoot===undefined&&catalogueGeneration===undefined&&catalogueSearchPolicy===undefined?null:
      JSON.parse(canonicalJson({root:catalogueRoot,generation:assertGeneration(catalogueGeneration),searchPolicy:assertCatalogueSearchPolicy(catalogueSearchPolicy)}));
    if(catalogue&&typeof catalogue.root!=='string')throw new TypeError('A qualified catalogue root is required.');
    let thread=null,pending=null,closed=false,stopping=null,sequence=0;
    function stop(reason=failure('BUFFALO_CPU_STOPPED','The service CPU session was stopped.')){
      closed=true;
      if(pending){const current=pending;pending=null;current.cleanup();current.reject(reason);}
      if(!stopping)stopping=thread?Promise.resolve().then(()=>thread.terminate()).then(()=>{}):Promise.resolve();
      return stopping;
    }
    function ensure(){
      if(thread)return;
      thread=createWorker(__filename,{workerData:{protocol:'shelfdeck.buffalo-cpu@1',modelRoot,catalogue}});
      thread.on('message',reply=>{
        if(closed)return;
        if(!pending||reply?.id!==pending.id||typeof reply.ok!=='boolean'||
          reply.ok&&!Object.hasOwn(reply,'value')||!reply.ok&&(typeof reply.error?.code!=='string'||!reply.error.code)){
          void stop(failure('BUFFALO_CPU_PROTOCOL_INVALID','The CPU reply does not identify the exact pending operation.')).catch(()=>{});return;
        }
        const current=pending;pending=null;current.cleanup();
        if(reply.ok){
          if(current.kind==='representative'&&reply.value?.bytes instanceof Uint8Array)reply.value.bytes=Buffer.from(reply.value.bytes);
          current.resolve(reply.value);
        }else{
          current.reject(failure(reply.error.code,'The bounded buffalo CPU operation failed.'));
          if(['load','loadCatalogue'].includes(current.kind)||reply.error.code==='FACE_CATALOGUE_FILES_CHANGED')void stop().catch(()=>{});
        }
      });
      thread.on('error',()=>void stop(failure('BUFFALO_CPU_FAILED','The CPU isolation thread failed.')).catch(()=>{}));
      thread.on('exit',()=>{if(!closed)void stop(failure('BUFFALO_CPU_FAILED','The CPU isolation thread exited before completion.')).catch(()=>{});});
    }
    function send(kind,input,options={}){
      const {deadlineAtMs,signal}=options;
      if(!Number.isSafeInteger(deadlineAtMs)||deadlineAtMs<0||deadlineAtMs>Date.now()+(kind==='loadCatalogue'?180000:60000)||
        signal!==undefined&&(typeof signal?.addEventListener!=='function'||typeof signal?.removeEventListener!=='function'||typeof signal?.aborted!=='boolean'))
        return Promise.reject(failure('BUFFALO_CPU_INPUT_INVALID','An explicit bounded CPU deadline is required.'));
      if(closed)return Promise.reject(failure('BUFFALO_CPU_CLOSED','The service CPU session is closed.'));
      if(signal?.aborted)return Promise.reject(failure('BUFFALO_CPU_CANCELLED','The CPU operation was cancelled.'));
      if(deadlineAtMs<=Date.now())return Promise.reject(failure('BUFFALO_CPU_TIMEOUT','The CPU operation exceeded its deadline.'));
      if(pending)return Promise.reject(failure('BUFFALO_CPU_BUSY','The single CPU operation slot is occupied.'));
      if(input.bytes&&(!Buffer.isBuffer(input.bytes)||!input.bytes.length||input.bytes.length>pack.maximumImageBytes))
        return Promise.reject(failure('BUFFALO_CPU_INPUT_INVALID','A bounded image byte buffer is required.'));
      if(kind==='query'&&(!Array.isArray(input.vector)||input.vector.length!==512||input.vector.some(x=>!Number.isFinite(x))||Math.abs(Math.hypot(...input.vector)-1)>1e-5))
        return Promise.reject(failure('BUFFALO_CPU_INPUT_INVALID','A unit buffalo catalogue feature is required.'));
      try{
        if(kind==='group'&&(!Array.isArray(input.faces)||input.faces.length>1280||Buffer.byteLength(canonicalJson(input))>24*1024*1024)||
          kind==='representative'&&Buffer.byteLength(canonicalJson(input.parameters))>1048576)
          return Promise.reject(failure('BUFFALO_CPU_INPUT_INVALID','The technical payload exceeds its operation budget.'));
      }catch{return Promise.reject(failure('BUFFALO_CPU_INPUT_INVALID','The technical input is not bounded canonical JSON.'));}
      try{ensure();}catch{return stop(failure('BUFFALO_CPU_FAILED','The CPU operation could not start.')).then(()=>{throw failure('BUFFALO_CPU_FAILED','The CPU operation could not start.');});}
      return new Promise((resolve,reject)=>{
        const id=++sequence,aborted=()=>void stop(failure('BUFFALO_CPU_CANCELLED','The CPU operation was cancelled.')).catch(()=>{}),
          timer=setTimeout(()=>void stop(failure('BUFFALO_CPU_TIMEOUT','The CPU operation exceeded its deadline.')).catch(()=>{}),Math.max(0,deadlineAtMs-Date.now())),
          cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',aborted);};
        pending={id,kind,resolve,reject,cleanup};signal?.addEventListener('abort',aborted,{once:true});
        if(signal?.aborted){aborted();return;}
        try{
          const bytes=input.bytes?Uint8Array.from(input.bytes):null;
          thread.postMessage({id,kind,...input,...(bytes?{bytes}:{}),deadlineAtMs},bytes?[bytes.buffer]:[]);
        }catch{void stop(failure('BUFFALO_CPU_FAILED','The CPU operation could not be sent.')).catch(()=>{});}
      });
    }
    return Object.freeze({faceModelRef:buffaloModelReference('western_frame_set'),load:options=>send('load',{},options),
      loadCatalogue:options=>send('loadCatalogue',{},options),searchCatalogue:(vector,options)=>send('query',{vector},options),
      analyzeEvidence:(bytes,options)=>send('analyze',{bytes},options),
      groupFaces:(faces,parameters,options)=>send('group',{faces,parameters},options),
      renderRepresentative:({frameBytes,evidence,faceOrdinal,policy},options)=>send('representative',{bytes:frameBytes,parameters:{evidence,faceOrdinal,policy}},options),stop});
  }
  module.exports=Object.freeze({createBuffaloCpuSession});
}
