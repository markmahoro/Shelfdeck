'use strict';

/**
 * Process-local memo of workless catalogue settlement failures (provider / ensure).
 * Formation reads this so productIdentityIssue is Attention-visible instead of idle
 * in_progress + analyzing. Cleared when a catalogue decision lands or Run advances.
 */
const failures=new Map();

function recordUsAdultCatalogueSettlementFailure({libraRunId,reasonCode}){
  if(typeof libraRunId!=='string'||!libraRunId)return;
  const code=typeof reasonCode==='string'&&reasonCode?reasonCode:'PEOPLE_CATALOGUE_PROVIDER_FAILED';
  failures.set(libraRunId,Object.freeze({reasonCode:code,recordedAtMs:Date.now()}));
}

function readUsAdultCatalogueSettlementFailure({libraRunId}={}){
  if(typeof libraRunId!=='string'||!libraRunId)return null;
  return failures.get(libraRunId)||null;
}

function clearUsAdultCatalogueSettlementFailure(libraRunId){
  if(typeof libraRunId!=='string'||!libraRunId)return;
  failures.delete(libraRunId);
}

module.exports=Object.freeze({
  recordUsAdultCatalogueSettlementFailure,
  readUsAdultCatalogueSettlementFailure,
  clearUsAdultCatalogueSettlementFailure,
});
