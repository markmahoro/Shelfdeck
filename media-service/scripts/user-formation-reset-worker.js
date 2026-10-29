'use strict';
const {parentPort,workerData}=require('node:worker_threads');
const {createUserFormationReset}=require('./user-formation-reset');
(async()=>{
  const port=createUserFormationReset(workerData);
  const value=workerData.operation==='preview'?port.preview():workerData.operation==='recover'?await port.recover(workerData.resetId):await port.apply(workerData.preview,backup=>new Promise((resolve,reject)=>{
    parentPort.once('message',message=>message.kind==='apply_authorized'?resolve():reject(Object.assign(new Error('Reset授权检查未通过。'),{code:'RESET_APPLY_REFUSED'})));
    parentPort.postMessage({kind:'before_apply',backup});
  }));
  parentPort.postMessage({kind:'result',value});
})().catch(error=>parentPort.postMessage({kind:'failure',code:error.code||error.message,message:error.code==='ENOSPC'?'备份空间不足，未完成Reset。':error.message})).finally(()=>parentPort.close());
