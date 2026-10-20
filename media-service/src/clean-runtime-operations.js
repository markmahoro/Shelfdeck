'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { canonicalDigest } = require('./helix/contracts/canonical-json');

function fail(code, message, details) {
  throw Object.assign(new Error(message), { code, statusCode:409, details });
}

function writeAtomic(file, value) {
  const temporary=file+'.'+crypto.randomUUID()+'.tmp';
  const fd=fs.openSync(temporary,'wx',0o600);
  try { fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary,file);
  if(process.platform==='linux'){const directory=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}}
}

function createRuntimeOperations(options) {
  const root=path.join(options.dataDir,'operator-runtime');
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  if(fs.lstatSync(root).isSymbolicLink())fail('RUNTIME_OPERATION_PATH_UNSAFE','运行控制目录不安全。');
  if(process.platform==='linux'){const parent=fs.openSync(options.dataDir,'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}}
  const file=path.join(root,'intent.json');
  function readRecord(target){
    if(fs.lstatSync(target).isSymbolicLink())fail('RUNTIME_OPERATION_PATH_UNSAFE','运行控制记录不安全。');
    return JSON.parse(fs.readFileSync(target,'utf8'));
  }
  let intent={schema:'shelfdeck.runtime-intent@1',desiredMode:'running',revision:0,pendingReset:null};
  if(fs.existsSync(file)){
    intent=readRecord(file);
    if(intent.schema!=='shelfdeck.runtime-intent@1'||!['running','stopped'].includes(intent.desiredMode)||
        !Number.isSafeInteger(intent.revision)||intent.revision<0||
        (intent.pendingReset!==null&&(!intent.pendingReset||typeof intent.pendingReset!=='object'||
          typeof intent.pendingReset.operationId!=='string'||typeof intent.pendingReset.previewDigest!=='string'||
          typeof intent.pendingReset.backupId!=='string')))fail('RUNTIME_INTENT_INVALID','运行控制记录损坏，不能自动运行。');
  }
  let mode=intent.pendingReset?'error':intent.desiredMode==='stopped'?'stopped':'starting';
  let error=intent.pendingReset?{code:'RUNTIME_RESET_INTERRUPTED',message:'Reset被中断，须核查备份和工作区后才能恢复运行。'}:null;
  let operation=null,lastOperation=null;
  let activeCommands=0;
  const commandWaiters=new Set();
  const waitForBusinessCommands=()=>activeCommands?new Promise(resolve=>commandWaiters.add(resolve)):Promise.resolve();
  let checking=false;
  function persist(patch){const next={...intent,...patch,revision:intent.revision+1};writeAtomic(file,next);intent=next;}
  function snapshot(){return Object.freeze({mode,desiredMode:intent.desiredMode,revision:intent.revision,
    normalSupplyAllowed:mode==='running'&&(!options.normalSupplyAllowed||options.normalSupplyAllowed()),
    ...(options.readMaintenance?{maintenance:options.readMaintenance()}:{}),
    activity:{...options.activity(),inFlightAdminCommands:activeCommands},operation:lastOperation,error,recoveryBackup:intent.pendingReset?.backupId||null});}
  function identity(kind,body,actor){
    if(!body||typeof body.idempotencyKey!=='string'||!body.idempotencyKey||body.idempotencyKey.length>128)
      fail('RUNTIME_OPERATION_INPUT_INVALID','操作标识无效。');
    const allowed=kind==='reset'?['idempotencyKey','previewDigest','confirmed']:['idempotencyKey'];
    if(Object.keys(body).some(key=>!allowed.includes(key)))fail('RUNTIME_OPERATION_INPUT_INVALID','操作包含不支持的参数。');
    const id=canonicalDigest({actorId:actor.actorId,idempotencyKey:body.idempotencyKey});
    const requestDigest=canonicalDigest({kind,body});
    const receiptFile=path.join(root,id+'.json');
    if(fs.existsSync(receiptFile)){
      const receipt=readRecord(receiptFile);
      if(receipt.requestDigest!==requestDigest)fail('RUNTIME_OPERATION_KEY_CONFLICT','操作标识已用于另一项请求。');
      return {id,requestDigest,receiptFile,existing:receipt};
    }
    return {id,requestDigest,receiptFile};
  }
  function launch(kind,request,work){
    const receipt={operationId:request.id,kind,requestDigest:request.requestDigest,state:'pending',createdAt:new Date().toISOString()};
    writeAtomic(request.receiptFile,receipt);lastOperation=receipt;
    operation=Promise.resolve().then(work).then(result=>{
      lastOperation={...receipt,state:'completed',result,finishedAt:new Date().toISOString()};writeAtomic(request.receiptFile,lastOperation);
    }).catch(cause=>{
      error={code:cause.code||'RUNTIME_OPERATION_FAILED',message:cause.message};
      mode=kind==='reset'&&!intent.pendingReset?'stopped':'error';
      lastOperation={...receipt,state:'failed',error,finishedAt:new Date().toISOString()};
      try{writeAtomic(request.receiptFile,lastOperation);}catch(receiptError){options.onError?.(receiptError);}
      options.onError?.(cause);
    }).finally(()=>{operation=null;});
    return receipt;
  }
  return Object.freeze({
    snapshot,
    desiredMode:()=>intent.desiredMode,
    waitForBusinessCommands,
    beginBusinessCommand(){
      if(mode!=='running')fail('RUNTIME_BUSINESS_WRITES_DISABLED','服务已停止后台运行，请先在概览恢复运行。');
      if(options.normalSupplyAllowed&&!options.normalSupplyAllowed())fail('RUNTIME_MAINTENANCE_WRITES_DISABLED','系统正在维护，请在维护结束后操作。');
      activeCommands++;let released=false;
      return ()=>{if(released)return;released=true;activeCommands--;if(!activeCommands){for(const resolve of commandWaiters)resolve();commandWaiters.clear();}};
    },
    shouldStartStopped:()=>intent.desiredMode==='stopped'||Boolean(intent.pendingReset),
    started(){if(!intent.pendingReset)mode=intent.desiredMode==='stopped'?'stopped':'running';},
    stop(body,actor){const request=identity('stop',body,actor);if(request.existing)return request.existing;
      if(operation||checking)fail('RUNTIME_OPERATION_BUSY','上一项运行操作尚未完成。');
      if(intent.pendingReset)fail('RUNTIME_RESET_INTERRUPTED','须先核查被中断的Reset。');
      persist({desiredMode:'stopped'});mode='stopping';error=null;
      let drained;
      try{drained=options.quiesce();}catch(cause){mode='error';error={code:cause.code||'RUNTIME_OPERATION_FAILED',message:cause.message};throw cause;}
      try {return launch('stop',request,async()=>{await Promise.all([drained,waitForBusinessCommands()]);await options.onDesiredModeChanged?.();mode='stopped';return {mode};});}
      catch(cause){mode='error';void Promise.resolve(drained).catch(options.onError);throw cause;}},
    resume(body,actor){const request=identity('resume',body,actor);if(request.existing)return request.existing;
      if(operation||checking)fail('RUNTIME_OPERATION_BUSY','上一项运行操作尚未完成。');
      if(intent.pendingReset)fail('RUNTIME_RESET_INTERRUPTED','须先核查被中断的Reset。');
      if(mode!=='stopped')fail('RUNTIME_RESUME_STATE_INVALID','服务须先安全停机。');
      mode='resuming';error=null;
      try{return launch('resume',request,async()=>{try{await options.resume();persist({desiredMode:'running'});await options.onDesiredModeChanged?.();mode='running';return {mode};}
        catch(cause){await options.quiesce();persist({desiredMode:'stopped'});throw cause;}});}catch(cause){mode='stopped';throw cause;}},
    async previewReset(){if(mode!=='stopped'||operation||checking||intent.pendingReset)fail('RUNTIME_RESET_REQUIRES_STOPPED','请先完成安全停机。');
      const preview=await options.previewReset();if(mode!=='stopped'||operation||checking)fail('RUNTIME_RESET_PREVIEW_STALE','运行状态已变化，请重新核对清单。');return preview;},
    async reset(body,actor){const request=identity('reset',body,actor);if(request.existing)return request.existing;
      if(mode!=='stopped'||operation||checking||intent.pendingReset)fail('RUNTIME_RESET_REQUIRES_STOPPED','请先完成安全停机。');
      if(body.confirmed!==true||typeof body.previewDigest!=='string')fail('RUNTIME_RESET_CONFIRMATION_REQUIRED','请核对清单并确认Reset后果。');
      checking=true;
      let preview;
      try{preview=await options.previewReset();}finally{checking=false;}
      if(preview.previewDigest!==body.previewDigest)fail('RUNTIME_RESET_PREVIEW_STALE','清理范围已变化，请重新核对清单。');
      if(!preview.ready)fail('RUNTIME_RESET_BLOCKED','当前整理不能安全Reset。',{blockers:preview.blockers});
      mode='resetting';error=null;
      try{return launch('reset',request,async()=>{
        const result=await options.reset(preview,backup=>persist({pendingReset:{operationId:request.id,previewDigest:preview.previewDigest,...backup}}));
        persist({pendingReset:null});mode='stopped';return result;
      });}catch(cause){mode='stopped';throw cause;}},
    async wait(){if(operation)await operation;},
    async waitForShutdown(timeoutMs=60000){
      if(!operation)return;
      let timer;
      try{await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(
        new Error('Operational checkpoint deadline expired.'),{code:'P4_SHUTDOWN_CHECKPOINT_TIMEOUT'})),timeoutMs);})]);}
      finally{clearTimeout(timer);}
    },
  });
}

module.exports=Object.freeze({createRuntimeOperations,writeAtomic});
