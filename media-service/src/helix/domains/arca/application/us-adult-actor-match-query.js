'use strict';
const {exactSource,matchWork}=require('../model/us-adult-actor-match-work');
function createUsAdultActorMatchQuery(options){
  function read(shelfEntryId,aftercareCaseId,pageOrdinal){
    const current=options.actorRefreshSource.read(shelfEntryId,aftercareCaseId);
    if(current.intent.mode!=='automatic'||!Number.isSafeInteger(pageOrdinal)||pageOrdinal<0||pageOrdinal>=current.intent.pageCount)
      throw Object.assign(new Error('Matching requires one exact frozen automatic reference page.'),{code:'ARCA_US_ADULT_MATCH_PAGE_INVALID'});
    const sourceRecord=exactSource(options,current.intent,aftercareCaseId),page=options.actorRefreshSource.store.page(current.intent.intentId,pageOrdinal);
    return {...current,pageOrdinal,page,sourceRecord,work:matchWork(current.intent,aftercareCaseId,pageOrdinal,page.pageDigest,sourceRecord.resultDigest)};
  }
  return Object.freeze({read});
}
module.exports=Object.freeze({createUsAdultActorMatchQuery});
