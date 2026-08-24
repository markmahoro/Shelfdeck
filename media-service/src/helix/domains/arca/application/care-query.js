'use strict';

function createArcaCareApplication(options){if(!options?.contextReader||!options.coordinator)throw new TypeError('Arca Care application requires Aftercare services.');
  const store=options.contextReader.store;
  function detail(shelfEntryId){const context=options.contextReader.read(shelfEntryId);if(!context)return null;return Object.freeze({
    shelfEntryId,health:options.coordinator.project(shelfEntryId),activeCaseProgress:options.coordinator.caseProgress(shelfEntryId),history:store.history(shelfEntryId),
    basis:Object.freeze({inventoryRevision:context.basis.inventoryRevision,standardRevision:context.basis.standardRevision,
      placementRevision:context.basis.placementRevision,decisionFactSetDigest:context.basis.decisionFactSetDigest,
      careBasisDigest:context.basis.digest}),
  });}
  function shelfBasisChanged(shelfId){const affected=[];let cursor=null;do{const page=options.contextReader.listPage(cursor,100);for(const row of page){const context=options.contextReader.read(row.scope.shelfEntryId);if(context?.raw.shelf.shelf_id!==shelfId)continue;options.coordinator.reconcile(context.shelfEntryId);affected.push(context.shelfEntryId);}cursor=page.length===100?page.at(-1).cursor:null;}while(cursor);if(affected.length)options.wake?.();return Object.freeze(affected);}
  return Object.freeze({list(query={}){const state=query.state||null,items=[],incidentCounts=new Map(),ids=[];let cursor=null;do{const page=options.contextReader.listPage(cursor,100);for(const row of page)ids.push(row.scope.shelfEntryId);cursor=page.length===100?page[page.length-1].cursor:null;}while(cursor);const projected=options.coordinator.projectMany(ids);for(const id of ids){const value=projected.get(id);if(!value)continue;const incidentKey=Object.values(value.dimensions).map((dimension)=>dimension.incidentKey).find(Boolean);if(incidentKey)incidentCounts.set(incidentKey,(incidentCounts.get(incidentKey)||0)+1);if(!state||value.state===state)items.push(value);}return Object.freeze({items:Object.freeze(items),counts:Object.freeze(items.reduce((acc,item)=>{acc[item.state]=(acc[item.state]||0)+1;return acc;},{})),incidents:Object.freeze([...incidentCounts.entries()].map(([incidentKey,affectedShelfEntryCount])=>Object.freeze({incidentKey,affectedShelfEntryCount})))});},summaries(shelfEntryIds){return options.coordinator.projectMany(shelfEntryIds);},detail,check(shelfEntryId,idempotencyKey){const value=detail(shelfEntryId);if(!value)return null;const result=options.coordinator.requestCheck(shelfEntryId,idempotencyKey);options.wake?.();return Object.freeze({operationRef:result.workId||shelfEntryId,state:result.kind,shelfEntryId});},shelfBasisChanged});
}
module.exports=Object.freeze({createArcaCareApplication});
