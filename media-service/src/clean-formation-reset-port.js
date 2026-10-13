'use strict';
const path=require('node:path');
const {Worker}=require('node:worker_threads');

// The privileged Operator remains outside the business runtime dependency graph.
function createUserFormationResetWorkerPort(options){
  let checking=null;
  function run(operation,preview,beforeApply){return new Promise((resolve,reject)=>{
    const worker=new Worker(path.join(__dirname,'../scripts/user-formation-reset-worker.js'),{
      workerData:{operation,preview,dataDir:options.dataDir,workspaceRoot:options.workspaceRoot},
      resourceLimits:{maxOldGenerationSizeMb:256},execArgv:[]});
    let settled=false;
    const finish=(callback,value)=>{if(!settled){settled=true;callback(value);}};
    worker.on('message',async message=>{
      if(message.kind==='before_apply'){
        try{options.assertWorkspaceAvailable?.();await beforeApply(message.backup);worker.postMessage({kind:'apply_authorized'});}
        catch(error){worker.postMessage({kind:'apply_refused'});finish(reject,error);}
      }else if(message.kind==='result')finish(resolve,message.value);
      else if(message.kind==='failure')finish(reject,Object.assign(new Error(message.message),{code:message.code}));
    });
    worker.on('error',error=>finish(reject,error));
    worker.on('exit',()=>{if(!settled)finish(reject,Object.assign(new Error('Reset检查进程提前结束。'),{code:'RESET_WORKER_EXITED'}));});
  });}
  return Object.freeze({preview:()=>{if(!checking)checking=run('preview').finally(()=>{checking=null;});return checking;},apply:(preview,beforeApply)=>{
    options.assertWorkspaceAvailable?.();return run('apply',preview,beforeApply);
  }});
}
module.exports=Object.freeze({createUserFormationResetWorkerPort});
