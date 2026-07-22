'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');

class DeliveryLifecycleLedgerError extends Error{constructor(code,message){super(message);this.name='DeliveryLifecycleLedgerError';this.code=code;}}
const fail=(code,message)=>{throw new DeliveryLifecycleLedgerError(code,message);};
const clone=(value)=>JSON.parse(canonicalJson(value));

function createDeliveryLifecycleLedger(seed={}){
  let state=clone({packages:{},receipts:{},outbox:{},runs:{},cleanupScopes:{},cleanupMembers:{},markers:{},...seed});
  function commit(request){
    const marker=request?.marker,transactionId=request?.transactionId,commitDigest=request?.commitDigest;
    if(!marker||!transactionId||!commitDigest)fail('P9_LEDGER_INPUT','Transaction marker and digest are required.');
    const existing=state.markers[marker];
    if(existing){if(existing.transactionId!==transactionId||existing.commitDigest!==commitDigest)fail('P9_LEDGER_MARKER_CONFLICT','Marker belongs to another semantic commit.');return clone(existing.result);}
    const working=clone(state);
    try{
      const result=request.apply(working);
      if(request.faultAt==='after-domain')throw new Error('fault:after-domain');
      working.markers[marker]={transactionId,commitDigest,result:clone(result),resultDigest:canonicalDigest(result)};
      if(request.faultAt==='after-marker')throw new Error('fault:after-marker');
      state=working;return clone(result);
    }catch(error){throw error;}
  }
  return Object.freeze({commit,snapshot:()=>clone(state)});
}

module.exports=Object.freeze({DeliveryLifecycleLedgerError,createDeliveryLifecycleLedger});
