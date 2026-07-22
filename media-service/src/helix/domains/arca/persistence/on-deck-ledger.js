'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const clone=(value)=>JSON.parse(canonicalJson(value));
function createOnDeckLedger(seed={}){
  let state=clone({acceptanceDecisions:{},custodies:{},bindings:{},entries:{},inventory:{},deckFacts:{},receipts:{},outbox:{},markers:{},...seed});
  return Object.freeze({commit(request){const old=state.markers[request.marker];if(old){if(old.commitDigest!==request.commitDigest)throw new Error('P10_MARKER_CONFLICT');return clone(old.result);}const next=clone(state);const result=request.apply(next);if(request.faultAt==='after-domain')throw new Error('fault:after-domain');next.markers[request.marker]={commitDigest:request.commitDigest,result:clone(result),resultDigest:canonicalDigest(result)};if(request.faultAt==='after-marker')throw new Error('fault:after-marker');state=next;return clone(result);},snapshot:()=>clone(state)});
}
module.exports=Object.freeze({createOnDeckLedger});

