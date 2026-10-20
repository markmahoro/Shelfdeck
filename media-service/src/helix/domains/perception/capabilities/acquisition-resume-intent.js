'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {createCommandCommitCoordinator}=require('../../../foundation/persistence/commit-foundation');
const {createAcquisitionResumeIntentStore}=require('../persistence/acquisition-resume-intent-store');
function createAcquisitionResumeIntent(options){
  const store=createAcquisitionResumeIntentStore(options),coordinator=createCommandCommitCoordinator(options);
  return Object.freeze({findCommand:store.findCommand,hasResume:store.hasResume,
    request(acquisition,command,actorId){
      const value={decisionId:'perception-resume-'+canonicalDigest({actorId,key:command.idempotencyKey}).slice(0,40),
        acquisitionId:acquisition.perceptionAcquisitionId,expectedScopeDigest:acquisition.scopeDigest,actorId,
        idempotencyKey:command.idempotencyKey,requestDigest:canonicalDigest(command)},decision={...value,decisionDigest:canonicalDigest(value)};
      return coordinator.execute({command:{commandReceiptId:value.decisionId,ownerDomain:'perception',commandContract:'perception.resume-acquisition@1',
        callerScope:actorId,idempotencyKey:command.idempotencyKey,requestDigest:value.requestDigest,targetType:'perception_acquisition',targetId:value.acquisitionId},
        domainParticipant:store.participant(decision),commitMarker:{commitMarker:value.decisionId,effectId:null,scopeType:'perception_acquisition',scopeId:value.acquisitionId,commitDigest:decision.decisionDigest},
        auditRecords:[{auditId:value.decisionId+'-audit',actorType:'admin',actorId,action:'perception.acquisition.resume',scopeType:'perception_acquisition',scopeId:value.acquisitionId,evidenceDigest:decision.decisionDigest}],
        outboxMessages:[],resultEnvelope:result=>({resultSchemaRef:'helix://contracts/domain-types/PerceptionAcquisitionResumeDecision/v1',resultRef:result})});
    }});
}
module.exports=Object.freeze({createAcquisitionResumeIntent});
