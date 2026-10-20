'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const SCHEMA='helix://contracts/domain-types/UsAdultRecommendationConfirmation/v1',RECEIPT='helix://contracts/domain-types/UsAdultActorChoiceReceipt/v1';
function createUsAdultRecommendationConfirmation(options){
  if(!options.usAdultActorChoiceStore||!options.usAdultActorChoice||!options.usAdultRecommendationQuery||!options.contractValidator)
    throw new TypeError('Source confirmation requires the exact Libra Source query and existing actor command.');
  return Object.freeze({confirmSource(input){
    if(Buffer.byteLength(canonicalJson(input),'utf8')>128*1024)throw Object.assign(new Error('Source confirmation exceeds its nominal byte bound.'),
      {code:'US_ADULT_RECOMMENDATION_CONFIRMATION_INVALID'});
    options.contractValidator.validate(SCHEMA,input);
    const {sourceDigest,...body}=input.source;
    if(canonicalDigest(body)!==sourceDigest)throw Object.assign(new Error('Recommendation Source digest changed.'),{code:'US_ADULT_RECOMMENDATION_SOURCE_STALE'});
    const idempotencyKey=canonicalDigest({schema:'libra.us-adult-recommendation-confirm-key@1',claimId:input.claimId,sourceDigest}),
      choice={idempotencyKey,expectedRunStateRevision:input.source.expectedRunStateRevision,expectedChoiceRevision:input.source.expectedChoiceRevision,
        personId:input.personId,expectedPersonRevision:input.expectedPersonRevision,expectedReferenceRevision:input.expectedReferenceRevision};
    // A completed Owner command is the ACK recovery authority. Its Source is
    // expected to cease being unmatched after this exact command succeeds.
    if(!options.usAdultActorChoiceStore.findCommand(input.actorId,idempotencyKey))options.usAdultRecommendationQuery.readSource(input.source);
    const result=options.usAdultActorChoice.choose(input.source.libraRunId,choice,input.actorId),receipt=result.receipt.resultRef;
    options.contractValidator.validate(RECEIPT,receipt);
    if(receipt.subjectId!==input.source.subjectId||receipt.libraRunId!==input.source.libraRunId||receipt.personId!==input.personId||
      receipt.personRevision!==input.expectedPersonRevision||receipt.referenceRevision!==input.expectedReferenceRevision)
      throw Object.assign(new Error('Source confirmation receipt differs from the frozen user intent.'),{code:'US_ADULT_RECOMMENDATION_RECEIPT_INVALID'});
    options.onRecommendationActorConfirmed?.(receipt);return receipt;
  }});
}
module.exports=Object.freeze({SCHEMA,createUsAdultRecommendationConfirmation});
