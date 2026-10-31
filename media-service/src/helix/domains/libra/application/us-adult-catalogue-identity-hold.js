'use strict';

// Process-local. A restart loses it; the next active-run reconcile notes the reason again.
const reasons=new Map();

function noteCatalogueIdentityReason(libraRunId,reasonCode){
  if(typeof libraRunId!=='string'||!libraRunId)return;
  if(!reasonCode)reasons.delete(libraRunId);
  else reasons.set(libraRunId,reasonCode);
}

function catalogueIdentityReason(libraRunId){
  return reasons.get(libraRunId)||null;
}

module.exports=Object.freeze({noteCatalogueIdentityReason,catalogueIdentityReason});
