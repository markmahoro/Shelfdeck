'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {createCommandCommitCoordinator}=require('../../../foundation/persistence/commit-foundation');
const {buildRecord,decision}=require('../model/us-adult-actor-choice');
function createUsAdultActorChoiceCommand(options){
  const store=options.usAdultActorChoiceStore,coordinator=createCommandCommitCoordinator(options);
  if(!store||!options.peopleReferenceQuery||!options.movieProductionReader)throw new TypeError('Actor choice requires Libra intent persistence and the formal People query.');
  return Object.freeze({choose(libraRunId,body,actorId){
    const allowed=['idempotencyKey','expectedRunStateRevision','expectedChoiceRevision','personId','expectedPersonRevision','expectedReferenceRevision'];
    if(!body||Object.keys(body).sort().join(',')!==allowed.sort().join(',')||!actorId||typeof body.idempotencyKey!=='string'||!body.idempotencyKey||body.idempotencyKey.length>128||
      typeof body.personId!=='string'||!body.personId||body.personId.length>256||!Number.isSafeInteger(body.expectedChoiceRevision)||body.expectedChoiceRevision<0||
      [body.expectedRunStateRevision,body.expectedPersonRevision,body.expectedReferenceRevision].some(value=>!Number.isSafeInteger(value)||value<1))
      throw Object.assign(new Error('Actor confirmation requires exact Run, choice, Person and reference versions.'),{code:'US_ADULT_ACTOR_CHOICE_INVALID'});
    const requestDigest=canonicalDigest({libraRunId,...body}),existing=store.findCommand(actorId,body.idempotencyKey);let record;
    if(existing){
      if(existing.requestDigest!==requestDigest||existing.libraRunId!==libraRunId)throw Object.assign(new Error('The actor choice key belongs to another request.'),{code:'P3_COMMAND_IDEMPOTENCY_CONFLICT'});
      record=existing;
    }else{
      const snapshot=options.movieProductionReader.readRunSnapshot(libraRunId);
      if(!snapshot||snapshot.spec.contentProfile!=='western_adult')throw Object.assign(new Error('Only US Adult Run accepts actor choice.'),{code:'US_ADULT_ACTOR_CHOICE_INVALID'});
      const personSnapshot=options.peopleReferenceQuery.readUsAdultPersonSnapshot({personId:body.personId,
        expectedPersonRevision:body.expectedPersonRevision,expectedReferenceRevision:body.expectedReferenceRevision});
      record=buildRecord({snapshot,personSnapshot,body,actorId});
    }
    const resolved=decision(record),result=coordinator.execute({command:{commandReceiptId:record.intentId,ownerDomain:'libra',commandContract:'libra.choose-us-adult-actor@1',
      callerScope:actorId,idempotencyKey:body.idempotencyKey,requestDigest,targetType:'subject',targetId:record.subjectId},
      domainParticipant:store.participant(resolved),commitMarker:{commitMarker:record.intentId,effectId:null,scopeType:'subject',scopeId:record.subjectId,commitDigest:resolved.decisionDigest},
      auditRecords:[{auditId:record.intentId+'-audit',actorType:'admin',actorId,action:'libra.us-adult.choose-actor',scopeType:'subject',scopeId:record.subjectId,evidenceDigest:resolved.decisionDigest}],
      outboxMessages:[],resultEnvelope:value=>{
        const resultSchemaRef='helix://contracts/domain-types/UsAdultActorChoiceReceipt/v1';
        options.contractValidator.validate(resultSchemaRef,value);return {resultSchemaRef,resultRef:value};
      }});
    options.wake?.();return result;
  }});
}
module.exports=Object.freeze({createUsAdultActorChoiceCommand});
