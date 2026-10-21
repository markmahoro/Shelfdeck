'use strict';
const { careFindingCodes } = require('../model/care-objective');

function createArcaCareApplication(options){if(!options?.contextReader||!options.coordinator)throw new TypeError('Arca Care application requires Aftercare services.');
  const store=options.contextReader.store;
  function detail(shelfEntryId){const context=options.contextReader.read(shelfEntryId);if(!context)return null;return Object.freeze({
    shelfEntryId,sharedPresentation:options.coordinator.sharedPresentationIssue?.(shelfEntryId)||null,health:options.coordinator.project(shelfEntryId),activeCaseProgress:options.coordinator.caseProgress(shelfEntryId),history:store.history(shelfEntryId),
    basis:Object.freeze({inventoryRevision:context.basis.inventoryRevision,standardRevision:context.basis.standardRevision,
      placementRevision:context.basis.placementRevision,decisionFactSetDigest:context.basis.decisionFactSetDigest,
      careBasisDigest:context.basis.digest}),
  });}
  function shelfBasisChanged(shelfId){
    // The committed Standard is the durable invalidation basis. The bounded
    // reconciliation sweep discovers it; a settings request never starts a
    // shelf-wide batch of workflows synchronously.
    options.wake?.();
    return Object.freeze({shelfId});
  }
  function workItems(query={}){
    const classification=(state)=>state==='queued'?'queued':state==='active'?'in_progress':state==='resolved'?'completed':'ended';
    const result=store.listWorkCases(query),page=result.items,display=store.workDisplay(page.map(item=>item.shelfEntryId)),health=options.coordinator.projectMany([...new Set(page.map(item=>item.shelfEntryId))]),items=page.map((item)=>{
      const summary=display.get(item.shelfEntryId);
      return Object.freeze({aftercareCaseId:item.aftercareCaseId,shelfEntryId:item.shelfEntryId,displayIdentity:summary?.displayIdentity||item.shelfEntryId,
        targetShelfId:summary?.targetShelfId||null,targetShelfName:summary?.targetShelfName||null,state:item.state,classification:classification(item.state),
        currentHealth:health.get(item.shelfEntryId)||null,goals:careFindingCodes(item.careRequirement),createdAtMs:item.createdAtMs,terminalAtMs:item.terminalAtMs,
        ...(query.aftercareCaseId?{processDetail:options.coordinator.caseDetail(item.aftercareCaseId),caseEvidence:store.caseEvidence(item.aftercareCaseId)}:{}),
        reasonCode:item.terminalReasonCode||null,progress:item.state==='active'?options.coordinator.caseProgress(item.shelfEntryId):
          item.state==='queued'?{aftercareCaseId:item.aftercareCaseId,stage:'queued',progressPercent:null,progress:null,goals:careFindingCodes(item.careRequirement)}:null});
    });
    return Object.freeze({items:Object.freeze(items),counts:Object.freeze(result.counts),nextCursor:result.nextCursor});
  }
  return Object.freeze({list(query={}){if(query.view==='work')return workItems(query);const state=query.state||null,items=[],incidentCounts=new Map(),ids=[];let cursor=null;do{const page=options.contextReader.listPage(cursor,100);for(const row of page)ids.push(row.scope.shelfEntryId);cursor=page.length===100?page[page.length-1].cursor:null;}while(cursor);const projected=options.coordinator.projectMany(ids);for(const id of ids){const value=projected.get(id);if(!value)continue;const incidentKey=Object.values(value.dimensions).map((dimension)=>dimension.incidentKey).find(Boolean);if(incidentKey)incidentCounts.set(incidentKey,(incidentCounts.get(incidentKey)||0)+1);if(!state||value.state===state)items.push(value);}return Object.freeze({items:Object.freeze(items),counts:Object.freeze(items.reduce((acc,item)=>{acc[item.state]=(acc[item.state]||0)+1;return acc;},{})),incidents:Object.freeze([...incidentCounts.entries()].map(([incidentKey,affectedShelfEntryCount])=>Object.freeze({incidentKey,affectedShelfEntryCount})))});},summaries(shelfEntryIds){return options.coordinator.projectMany(shelfEntryIds);},detail,async check(shelfEntryId,idempotencyKey,body={}){const replayed=options.coordinator.replaySeriesRetry?.(shelfEntryId,{...body,idempotencyKey});if(replayed){options.wake?.();return {operationRef:replayed.workId,state:replayed.kind,shelfEntryId,replayed:true};}const value=detail(shelfEntryId);if(!value)return null;const result=body.supplementalImages?.length||value.sharedPresentation?.canRetry?await options.coordinator.retrySeriesPresentation(shelfEntryId,{...body,idempotencyKey}):options.coordinator.requestCheck(shelfEntryId,idempotencyKey);options.wake?.();return Object.freeze({operationRef:result.workId||shelfEntryId,state:result.kind,shelfEntryId});},shelfBasisChanged});
}
module.exports=Object.freeze({createArcaCareApplication});
