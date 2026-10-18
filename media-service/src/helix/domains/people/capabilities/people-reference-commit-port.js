'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {createDomainCommitCoordinator,createDomainCommitRegistry,createCanonicalTransactionRegistry}=require('../../../foundation/persistence/domain-commit-registry');
const transaction=require('../../../contracts/transaction-contracts/helix.transaction.people-reference-image-commit/v1/contract.json');
const {createPeopleReferenceCommitRegistration}=require('./people-reference-lifecycle');
const COMMIT='people.reference_fact.commit@1',BASE='helix://contracts/capabilities/people.reference_fact.commit/v1/';
const stable=(prefix,value)=>prefix+canonicalDigest(value).slice(0,40);
function createPeopleReferenceCommitPort(options){
  const now=options.now||Date.now,commits=createDomainCommitCoordinator({...options,
    registry:createDomainCommitRegistry({registrations:[createPeopleReferenceCommitRegistration(options.peopleStore)]}),
    transactionRegistry:createCanonicalTransactionRegistry({contracts:[transaction]})});
  return Object.freeze({validateInputs(context){
    if(context.ownerScope?.domain!=='people'||context.ownerScope.processType!=='people_image_preparation')throw new TypeError('Reference commit requires its exact People process.');
    const expected=options.referenceDecision(context.ownerScope.processId),handle=context.namedInputs.domainFactCommitHandle;
    if(canonicalDigest(expected)!==canonicalDigest(context.namedInputs.peopleReferenceMaintenanceDecision)||handle.payloadDigest!==canonicalDigest(expected)||
      handle.aggregateId!==expected.personId||handle.expectedRevision!==expected.expectedReferenceRevision||
      handle.eventFenceDigest!==canonicalDigest({schema:'people.reference-commit-fence@1',operationId:context.ownerScope.processId,eventId:context.eventId}))throw new TypeError('Reference commit inputs differ from the frozen operation.');
  },execute(context){
    const handle=context.namedInputs.domainFactCommitHandle,payload=context.namedInputs.peopleReferenceMaintenanceDecision,
      effectId=canonicalDigest(['domain_fact_commit',context.idempotencyKey]),effectReceiptId=stable('people-reference-effect-',context.eventId),
      evidence={evidenceId:stable('people-reference-evidence-',context.eventId),evidenceKind:'people_reference_commit',producerRef:COMMIT,
        basisDigest:handle.payloadDigest,payloadDigest:canonicalDigest(payload),observedAtMs:now()};
    let committed;
    try{committed=commits.execute({transactionId:transaction.contract.transactionId,handle,payload,supportingWorkId:context.workId,
      commitMarker:{commitMarker:handle.commitIdempotencyKey,effectId,commitDigest:handle.payloadDigest},
      resultBinding:{resultId:stable('people-reference-result-',context.eventId),eventId:context.eventId,evidenceSchemaRef:BASE+'evidence',evidence,effectReceiptId},
      outboxMessages:[{messageId:stable('people-reference-message-',handle.commitIdempotencyKey),producerDomain:'people',messageKind:'people.reference.updated',
        aggregateType:'person-reference',aggregateId:payload.personId,aggregateRevision:payload.expectedReferenceRevision+1,dedupKey:handle.commitIdempotencyKey,
        intendedConsumers:['people'],payloadSchemaRef:'helix://contracts/signals/people-reference-updated/v1',
        payload:{personId:payload.personId,personRevision:payload.expectedPersonRevision,referenceRevision:payload.expectedReferenceRevision+1}}]});}
    catch(error){if(!['P6_PEOPLE_REFERENCE_REVISION_CONFLICT','P6_PEOPLE_REFERENCE_RELEASE_FENCE','PEOPLE_LAST_REFERENCE_REQUIRED','PEOPLE_REFERENCE_IMAGE_EXISTS','PEOPLE_REFERENCE_IMAGE_LIMIT','PEOPLE_REFERENCE_PROJECTION_TOO_LARGE'].includes(error.code))throw error;
      return {kind:'failed',failureClass:'stale_decision_basis',code:error.code,message:'演员或参考图片已变化，请重新读取后操作。',retryDirective:'never',
        evidence:{operationId:context.ownerScope.processId,writeCommitted:false}};}
    const result=committed.typedResult;
    return {kind:'succeeded',resultSchemaRef:BASE+'result',result,evidenceSchemaRef:BASE+'evidence',evidence:committed.typedEvidence,
      effectReceipt:{schemaRef:'helix://contracts/types/EffectReceipt/v1',schemaVersion:1,effectReceiptId,effectId,effectClass:'domain_fact_commit',
        idempotencyKey:context.idempotencyKey,commitMarker:handle.commitIdempotencyKey,externalReceiptRef:null,
        outputDigest:canonicalDigest(result),verificationEvidenceDigest:handle.payloadDigest,committedAtMs:result.committedAtMs}};
  },validateResult(context,outcome){
    const expected=context.namedInputs.peopleReferenceMaintenanceDecision;
    if(outcome.result.personId!==expected.personId||outcome.result.referenceRevision!==expected.expectedReferenceRevision+1)throw new TypeError('Reference commit Result is outside its frozen revision.');
  }});
}
module.exports=Object.freeze({createPeopleReferenceCommitPort,COMMIT});
