'use strict';

const model=require('../model/us-adult-recommendations');
const PAGE_SCHEMA='helix://contracts/domain-types/UsAdultRecommendationPageQuery/v1';
const summary=group=>({groupId:group.groupId,coverageCount:group.coverageCount,qualityScore:group.representative.image.qualityScore,
  sourceId:group.representative.source.sourceId});
function createUsAdultRecommendationCoordinator(options){
  if(typeof options?.store?.start!=='function'||typeof options.sources?.listSources!=='function'||typeof options.sources.readSource!=='function'||
    typeof options.images?.readCandidate!=='function')throw new TypeError('People recommendations require their Owner store and exact read-only Source/image ports.');
  const store=options.store;
  return Object.freeze({async reconcile(windowKey){
    let cycle=store.start(windowKey);if(cycle.state==='complete')return Object.freeze({kind:'complete',cycleId:cycle.cycleId});
    const progress=cycle.progress;
    if(progress.stage==='source_scan'){
      if(progress.sourceExhausted||progress.assignedSinceRank>=8){store.beginRanking(cycle);return {kind:'ranking_started'};}
      const page=options.sources.listSources({schemaRef:PAGE_SCHEMA,schemaVersion:1,cursor:progress.sourceCursor,limit:1});
      if(!page.items.length){store.saveProgress(cycle,{...progress,sourceCursor:page.nextCursor,sourceExhausted:page.nextCursor===null});return {kind:'source_page_scanned'};}
      const source=page.items[0];let image;
      try{image=await options.images.readCandidate(source);}catch(error){
        if(error.code==='US_ADULT_RECOMMENDATION_SOURCE_STALE'){
          store.saveProgress(cycle,{...progress,sourceCursor:page.nextCursor,sourceExhausted:page.nextCursor===null});return {kind:'source_stale',sourceId:source.sourceId};
        }
        throw error;
      }
      store.acceptSource(cycle,model.observation(source,image),page.nextCursor);
      return {kind:'source_collected',sourceId:source.sourceId};
    }
    if(progress.stage==='group_scan'){
      const pending=store.readSource(cycle.cycleId,progress.pendingSourceId);
      if(!pending)throw Object.assign(new Error('Recommendation comparison source is absent.'),{code:'PEOPLE_RECOMMENDATION_RECORD_INVALID'});
      try{options.sources.readSource(pending.observation.source);}catch(error){
        if(error.code!=='US_ADULT_RECOMMENDATION_SOURCE_STALE')throw error;
        store.saveProgress(cycle,{...progress,stage:'source_scan',pendingSourceId:null,groupCursor:null,bestGroup:null});
        return {kind:'source_stale',sourceId:pending.sourceId};
      }
      const page=store.groupPage(cycle.cycleId,progress.groupCursor),best=model.bestGroup(pending.observation,page.items,progress.bestGroup);
      if(page.nextCursor!==null)store.saveProgress(cycle,{...progress,groupCursor:page.nextCursor,bestGroup:best});
      else store.assignSource(cycle,best?.groupId||null);
      return {kind:'groups_compared',sourceId:pending.sourceId};
    }
    if(progress.stage==='refresh_sources'){
      const page=store.sourcePage(cycle.cycleId,progress.rankSourceCursor,8),records=page.map(item=>{
        try{options.sources.readSource(item.observation.source);return {sourceId:item.sourceId,current:true};}
        catch(error){if(error.code!=='US_ADULT_RECOMMENDATION_SOURCE_STALE')throw error;return {sourceId:item.sourceId,current:false};}
      });
      store.refreshRankingSources(cycle,records,page.length===8?page.at(-1).sourceId:null);
      return {kind:'sources_revalidated',count:records.length};
    }
    const page=store.groupPage(cycle.cycleId,progress.rankGroupCursor,progress.rankPassId),
      previous=progress.leaders.map(item=>store.readGroup(cycle.cycleId,item.groupId,progress.rankPassId)),
      ranked=model.rankGroups(page.items,previous);
    if(page.nextCursor!==null)store.saveProgress(cycle,{...progress,rankGroupCursor:page.nextCursor,leaders:ranked.map(summary)});
    else store.publish(cycle,ranked);
    return {kind:page.nextCursor===null?'publication_prepared':'groups_ranked',count:ranked.length};
  }});
}
module.exports=Object.freeze({createUsAdultRecommendationCoordinator});
