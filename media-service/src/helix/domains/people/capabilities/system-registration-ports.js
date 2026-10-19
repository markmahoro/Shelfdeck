'use strict';
const {canonicalDigest:D,canonicalJson}=require('../../../contracts/canonical-json');
const {createDomainCommitCoordinator,createDomainCommitRegistry,createCanonicalTransactionRegistry}=require('../../../foundation/persistence/domain-commit-registry');
const {createPeopleCandidateCommitRegistration,createPeopleCandidateAcceptanceRegistration}=require('./people-registration-lifecycle');
const model=require('../model/system-registration-work');
const candidateTransaction=require('../../../contracts/transaction-contracts/helix.transaction.people-candidate-commit/v1/contract.json'),
  acceptanceTransaction=require('../../../contracts/transaction-contracts/helix.transaction.people-candidate-acceptance/v1/contract.json');
const base=capability=>'helix://contracts/capabilities/'+capability.replace('@1','/v1/');
function createSystemRegistrationPorts(options){
  const query=options.systemRegistrationQuery,store=options.peopleStore,now=options.now||Date.now,commits=createDomainCommitCoordinator({...options,
    registry:createDomainCommitRegistry({registrations:[createPeopleCandidateCommitRegistration(store),createPeopleCandidateAcceptanceRegistration(store)]}),
    transactionRegistry:createCanonicalTransactionRegistry({contracts:[candidateTransaction,acceptanceTransaction]})});
  function validateScope(context){
    const work=query.definition(context.workId);
    if(context.ownerScope?.domain!=='people'||context.ownerScope.processType!=='people_system_registration'||context.ownerScope.processId!==work.processId)
      throw new TypeError('System Registration requires its exact People Supporting Work.');
    return work;
  }
  const observe=Object.freeze({validateInputs(context){validateScope(context);
    if(canonicalJson(context.namedInputs.providerPersonHintIntegrationHandleOrOnDeckPersonEvidenceProjectionItem)!==canonicalJson(query.source(context.workId)))
      throw new TypeError('Registration Evidence source differs from its exact Arca Projection.');
  },execute(context){validateScope(context);const result=model.registrationEvidence(query.source(context.workId),now()),
    evidence=Object.fromEntries(['evidenceId','evidenceKind','producerRef','basisDigest','payloadDigest','observedAtMs'].map(key=>[key,result[key]]));
    return {kind:'succeeded',resultSchemaRef:base(model.OBSERVE)+'result',result,evidenceSchemaRef:base(model.OBSERVE)+'evidence',evidence};
  },validateResult(context,outcome){
    const expected=model.registrationEvidence(context.namedInputs.providerPersonHintIntegrationHandleOrOnDeckPersonEvidenceProjectionItem,outcome.result.observedAtMs);
    if(canonicalJson(expected)!==canonicalJson(outcome.result))throw new TypeError('Registration Evidence replaced its frozen Arca source.');
  }});
  function commitPort(phase){const candidate=phase==='candidate',capability=candidate?model.CANDIDATE:model.PERSON,
    transaction=candidate?candidateTransaction:acceptanceTransaction,portName=candidate?'peopleCandidateDraft':'peopleCandidateAcceptanceDecision';
    return Object.freeze({validateInputs(context){validateScope(context);const payload=candidate?query.draft(context.workId):query.decision(context.workId),handle=query.handle(context.workId,context.eventId,phase);
      if(canonicalJson(context.namedInputs[portName])!==canonicalJson(payload)||canonicalJson(context.namedInputs.domainFactCommitHandle)!==canonicalJson(handle))
        throw new TypeError('People commit inputs differ from the immutable predecessor Evidence and Candidate.');
    },execute(context){validateScope(context);const payload=context.namedInputs[portName],handle=context.namedInputs.domainFactCommitHandle,
      effectId=D(['domain_fact_commit',context.idempotencyKey]),effectReceiptId='people-system-effect-'+D(context.eventId),
      evidence={evidenceId:'people-system-evidence-'+D(context.eventId),evidenceKind:'people_system_'+phase,producerRef:capability,
        basisDigest:handle.payloadDigest,payloadDigest:D(payload),observedAtMs:now()},
      message=candidate?{messageKind:'people.candidate.opened',aggregateType:'people-candidate',aggregateId:payload.draftId,aggregateRevision:1,
        payloadSchemaRef:'helix://contracts/signals/people-candidate-opened/v1',payload:{candidateId:payload.draftId,candidateRevision:1,candidatePayloadDigest:payload.candidatePayloadDigest}}:
        {messageKind:'people.person.registered',aggregateType:'person',aggregateId:payload.newPersonId,aggregateRevision:1,
          payloadSchemaRef:'helix://contracts/signals/people-person-registered/v1',payload:{personId:payload.newPersonId,personRevision:1}};
      let committed;
      try{committed=commits.execute({transactionId:transaction.contract.transactionId,handle,payload,supportingWorkId:context.workId,
        commitMarker:{commitMarker:handle.commitIdempotencyKey,effectId,commitDigest:handle.payloadDigest},
        resultBinding:{resultId:'people-system-result-'+D(context.eventId),eventId:context.eventId,evidenceSchemaRef:base(capability)+'evidence',evidence,effectReceiptId},
        outboxMessages:[{messageId:'people-system-message-'+D(handle.commitIdempotencyKey),producerDomain:'people',dedupKey:handle.commitIdempotencyKey,intendedConsumers:['people'],...message}]});
      }catch(error){if(!['P6_PEOPLE_REGISTRATION_CANDIDATE_FENCE','P6_PEOPLE_IDENTITY_ALREADY_KNOWN','P6_PEOPLE_PROVIDER_IDENTITY_CONFLICT'].includes(error.code))throw error;
        return {kind:'failed',failureClass:'stale_decision_basis',code:error.code,message:'System Person evidence no longer permits a new identity.',retryDirective:'never',
          evidence:{workId:context.workId,writeCommitted:false,errorCode:error.code}};
      }
      return {kind:'succeeded',resultSchemaRef:base(capability)+'result',result:committed.typedResult,evidenceSchemaRef:base(capability)+'evidence',evidence:committed.typedEvidence,
        effectReceipt:{schemaRef:'helix://contracts/types/EffectReceipt/v1',schemaVersion:1,effectReceiptId,effectId,effectClass:'domain_fact_commit',
          idempotencyKey:context.idempotencyKey,commitMarker:handle.commitIdempotencyKey,externalReceiptRef:null,outputDigest:D(committed.typedResult),
          verificationEvidenceDigest:handle.payloadDigest,committedAtMs:committed.typedResult.committedAtMs}};
    },validateResult(context,outcome){const payload=context.namedInputs[portName];
      if(candidate&&outcome.result.candidateId!==payload.draftId||!candidate&&outcome.result.personId!==payload.newPersonId)
        throw new TypeError('System Person commit Result belongs to a different Candidate or Person.');
    }});
  }
  return Object.freeze({[model.OBSERVE]:observe,[model.CANDIDATE]:commitPort('candidate'),[model.PERSON]:commitPort('person')});
}
module.exports=Object.freeze({createSystemRegistrationPorts});
