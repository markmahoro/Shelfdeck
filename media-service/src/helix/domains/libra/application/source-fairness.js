'use strict';
const {createSourceFairnessStore}=require('../persistence/source-fairness-store');

// Poll observations do not buy a turn. Their subsequent selection/import Work
// consumes a real opportunity when the newly established fact can be used.
const POLLS=new Set(['libra.external_material.acquire.observe@1','libra.external_material.stability.observe@1']);
const SUMMARY_SCAN_INTERVAL_MS=5000;
function qualifiedOpportunity(summary){
  const attempt=summary.latestAttempt;
  return !POLLS.has(summary.capabilityRef)&&attempt&&attempt.startedAtMs!==null&&
    attempt.outcomeKind!=='fence_rejected'&&attempt.failureClass!=='input_projection'&&
    attempt.failureCode!=='FENCE_REJECTED';
}
function createSourceFairness(options){
 const store=options.store||createSourceFairnessStore(options),registered=new Set(),eligible=new Set(),lastScans=new Map(),packageTimes=new Map();
 let snapshot=store.snapshot([]),bonuses=new Map();
 function rebuild(){
  snapshot=store.snapshot([...eligible]);bonuses=new Map();
  const runs=snapshot.runs.filter(row=>eligible.has(row.runId)),groups=new Map();
  for(const run of runs){if(!groups.has(run.sourceFieldId))groups.set(run.sourceFieldId,[]);groups.get(run.sourceFieldId).push(run);}
  const sources=snapshot.sources.filter(row=>groups.has(row.sourceFieldId)).sort((a,b)=>a.lastTurn-b.lastTurn||a.sourceFieldId.localeCompare(b.sourceFieldId));
  for(let sourceIndex=0;sourceIndex<sources.length;sourceIndex++){
   const source=sources[sourceIndex],members=groups.get(source.sourceFieldId).sort((a,b)=>a.lastTurn-b.lastTurn||
     packageTimes.get(a.runId)-packageTimes.get(b.runId)||a.runId.localeCompare(b.runId));
   // Bounded preference preserves the existing 100-point completion gap and
   // Foundation aging. Large populations share buckets; no waiting-time debt.
   const sourceBonus=8*Math.floor(11*(sources.length-sourceIndex-1)/Math.max(1,sources.length-1));
   for(let i=0;i<members.length;i++)bonuses.set(members[i].runId,sourceBonus+Math.floor(7*(members.length-i-1)/Math.max(1,members.length-1)));
  }
 }
 function register(runId){if(!registered.has(runId)){const run=store.registerRun(runId);packageTimes.set(runId,run.candidatePublishedAtMs);registered.add(runId);}}
 function consume(runId,summary,expectedAttemptId=null){
  if(!qualifiedOpportunity(summary))return false;
  const attempt=summary.latestAttempt;
  if(expectedAttemptId!==null&&attempt.eventAttemptId!==expectedAttemptId)throw new Error('Execution opportunity identity changed before Owner accounting.');
  return store.recordOpportunity({runId,eventId:summary.eventId,eventAttemptId:attempt.eventAttemptId,ordinal:attempt.ordinal}).recorded;
 }
 function changed(){rebuild();options.onPriorityChanged?.();}
 return Object.freeze({
  setEligible(runId,value){if(!value&&!registered.has(runId))return;register(runId);const was=eligible.has(runId);if(value)eligible.add(runId);else eligible.delete(runId);if(was!==Boolean(value)){store.advancePriorityRevision();changed();}},
  read(runId){return Object.freeze({localPriorityBonus:bonuses.get(runId)||0,priorityRevision:snapshot.priorityRevision});},
  refresh(runId){
   register(runId);
   const at=options.now(),last=lastScans.get(runId);
   if(last!==undefined&&at>=last&&at-last<SUMMARY_SCAN_INTERVAL_MS)return Object.freeze({kind:'not_due'});
   const page=options.workResultReader.readExecutionSummaryPage({ownerDomain:'libra',processType:'libra_run',processId:runId},store.readCursor(runId),100);
   let recorded=false;for(const summary of page.items)recorded=consume(runId,summary)||recorded;
   // Persist only after accounting the page. A crash before this write replays
   // safely against the durable per-Event high-water mark.
   store.saveCursor(runId,page.nextCursor);if(recorded)changed();
   const waiting=page.items.filter(summary=>summary.state==='waiting_for_resource').map(summary=>({
     runId,eventId:summary.eventId,workKind:summary.workKind,priorityRevision:summary.resourcePriorityRevision}));
   if(waiting.length)options.onWaitingExecutionsObserved?.(waiting);
   lastScans.set(runId,at);
   return page;
  },
  onExecutionStarted(context){
   if(context.ownerScope.domain!=='libra'||context.ownerScope.processType!=='libra_run'||POLLS.has(context.capabilityRef))return;
   const runId=context.ownerScope.processId;register(runId);
   const page=options.workResultReader.readExecutionSummaryPage({ownerDomain:'libra',processType:'libra_run',processId:runId},null,1,context.eventId);
   if(page.items.length!==1)throw new Error('Execution opportunity lacks its durable Event summary.');
   if(consume(runId,page.items[0],context.eventAttemptId))changed();
  },
 });
}
module.exports=Object.freeze({createSourceFairness,qualifiedOpportunity});
