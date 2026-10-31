'use strict';

/**
 * Durable-enough memo of workless catalogue settlement failures (provider / ensure).
 * Formation reads this so productIdentityIssue is Attention-visible instead of idle
 * in_progress + analyzing. Cleared when a catalogue decision lands or Run advances.
 *
 * Optional persistRoot keeps diagnosis across process rebind / wake+retry reconcile
 * without promoting this into a People/Libra Owner Fact Store.
 */
const fs=require('node:fs');
const path=require('node:path');

function safeRunId(libraRunId){
  return typeof libraRunId==='string'&&/^[A-Za-z0-9._:-]{1,200}$/.test(libraRunId)?libraRunId:null;
}

function createUsAdultCatalogueSettlementFailureMemo({persistRoot}={}){
  const failures=new Map();
  const root=typeof persistRoot==='string'&&persistRoot?path.resolve(persistRoot):null;
  function fileFor(libraRunId){
    return root?path.join(root,encodeURIComponent(libraRunId)+'.json'):null;
  }
  function load(libraRunId){
    if(failures.has(libraRunId))return failures.get(libraRunId);
    const file=fileFor(libraRunId);
    if(!file)return null;
    let raw;
    try{raw=fs.readFileSync(file,'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}
    let parsed;
    try{parsed=JSON.parse(raw);}catch{return null;}
    if(typeof parsed?.reasonCode!=='string'||!parsed.reasonCode)return null;
    const value=Object.freeze({reasonCode:parsed.reasonCode,recordedAtMs:Number(parsed.recordedAtMs)||Date.now()});
    failures.set(libraRunId,value);
    return value;
  }
  function persist(libraRunId,value){
    const file=fileFor(libraRunId);
    if(!file)return;
    fs.mkdirSync(root,{recursive:true});
    const temporary=file+'.'+process.pid+'.tmp';
    fs.writeFileSync(temporary,JSON.stringify(value),{encoding:'utf8',mode:0o600});
    fs.renameSync(temporary,file);
  }
  function remove(libraRunId){
    const file=fileFor(libraRunId);
    if(!file)return;
    try{fs.unlinkSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  function recordUsAdultCatalogueSettlementFailure({libraRunId,reasonCode}){
    const id=safeRunId(libraRunId);
    if(!id)return;
    const code=typeof reasonCode==='string'&&reasonCode?reasonCode:'PEOPLE_CATALOGUE_PROVIDER_FAILED';
    const value=Object.freeze({reasonCode:code,recordedAtMs:Date.now()});
    failures.set(id,value);
    persist(id,value);
  }
  function readUsAdultCatalogueSettlementFailure({libraRunId}={}){
    const id=safeRunId(libraRunId);
    if(!id)return null;
    return load(id);
  }
  function clearUsAdultCatalogueSettlementFailure(libraRunId){
    const id=safeRunId(libraRunId);
    if(!id)return;
    failures.delete(id);
    remove(id);
  }
  return Object.freeze({
    recordUsAdultCatalogueSettlementFailure,
    readUsAdultCatalogueSettlementFailure,
    clearUsAdultCatalogueSettlementFailure,
  });
}

const defaultMemo=createUsAdultCatalogueSettlementFailureMemo();

module.exports=Object.freeze({
  createUsAdultCatalogueSettlementFailureMemo,
  recordUsAdultCatalogueSettlementFailure:defaultMemo.recordUsAdultCatalogueSettlementFailure,
  readUsAdultCatalogueSettlementFailure:defaultMemo.readUsAdultCatalogueSettlementFailure,
  clearUsAdultCatalogueSettlementFailure:defaultMemo.clearUsAdultCatalogueSettlementFailure,
});
