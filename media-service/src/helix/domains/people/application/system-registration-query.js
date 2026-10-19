'use strict';
const {canonicalDigest:D,canonicalJson}=require('../../../contracts/canonical-json');
const model=require('../model/system-registration-work');
const {createPeopleCandidateResolver}=require('./people-candidate-resolver');
function fail(message){throw Object.assign(new Error(message),{code:'PEOPLE_SYSTEM_EVIDENCE_INVALID'});}
function createSystemRegistrationQuery(options){
  const reader=options.workResultReader,validator=options.contractValidator,resolver=createPeopleCandidateResolver({rules:[{policyRef:model.POLICY,evaluate:()=>({kind:'candidate'})}]});
  function definition(workId){
    const work=reader.readDefinition(workId)?.definition,descriptor=model.descriptorFromWork(work);
    if(canonicalJson(work)!==canonicalJson(model.workFor(descriptor)))fail('System Registration requires its complete exact admitted Work.');
    return work;
  }
  function source(workId){const work=definition(workId),descriptor=model.descriptorFromWork(work),item=options.readSource(descriptor);
    if(!item)throw Object.assign(new Error('The current Arca Person Evidence no longer matches this Work.'),{code:'PEOPLE_SYSTEM_EVIDENCE_STALE'});
    model.assertItem(item,validator);
    if(canonicalJson(model.descriptor(item))!==canonicalJson(descriptor))fail('Arca returned a different Person Evidence scope.');return item;
  }
  function result(workId,capability){
    const work=definition(workId),records=reader.read(workId).filter(item=>item.capabilityRef===capability&&item.outcomeKind==='succeeded');
    if(records.length!==1||records[0].workId!==workId||records[0].state!=='succeeded'||D(records[0].result)!==records[0].resultDigest)
      fail('System Registration lacks its exact successful typed predecessor Result.');
    const record=records[0];validator.validate(record.resultSchemaRef,record.result);
    if(capability===model.OBSERVE&&(record.result.basisDigest!==work.executionBasisDigest||record.result.libraryKind!==model.descriptorFromWork(work).libraryKind))
      fail('Registration Evidence belongs to another Arca Projection or Person library.');
    return record;
  }
  function draft(workId){const evidence=result(workId,model.OBSERVE).result;
    return resolver.resolve({evidence,policyRef:model.POLICY,draftId:'people-system-candidate-'+D({workId,evidenceDigest:evidence.payloadDigest}),producedAtMs:evidence.observedAtMs}).draft;
  }
  function decision(workId){const value=draft(workId),candidate=result(workId,model.CANDIDATE).result;
    if(!value.candidatePayload.providerIdentities.length||candidate.candidateKind!=='registration'||candidate.candidateId!==value.draftId||candidate.candidateRevision!==1||
        candidate.candidatePayloadDigest!==value.candidatePayloadDigest||candidate.state!=='open')fail('Only the exact strong Candidate can publish a system Person.');
    const body={decisionId:'people-system-acceptance-'+D({workId,candidateResultDigest:D(candidate)}),candidateKind:'registration',candidateId:candidate.candidateId,
      expectedCandidateRevision:1,candidatePayloadDigest:candidate.candidatePayloadDigest,decisionOrigin:'strong_identity_rule',ruleRevision:model.POLICY.policyRevision,
      newPersonId:'person-system-'+D({workId,candidateId:candidate.candidateId})};
    return Object.freeze({...body,decisionDigest:D(body)});
  }
  function handle(workId,eventId,phase){const payload=phase==='candidate'?draft(workId):decision(workId),candidate=phase==='candidate',
    factType=candidate?'PeopleCandidateDraft':'PeopleCandidateAcceptanceDecision',aggregateId=candidate?payload.draftId:payload.newPersonId;
    return {schemaRef:'helix://contracts/types/DomainFactCommitHandle/v1',schemaVersion:1,handleId:'people-system-fact-'+D({workId,phase}),ownerDomain:'people',
      aggregateType:candidate?'people-candidate':'person',aggregateId,factType,factSchemaRef:'helix://contracts/'+(candidate?'types/':'domain-types/')+factType+'/v1',expectedRevision:0,
      payloadDigest:D(payload),resultSchemaRef:'helix://contracts/types/'+(candidate?'PeopleCandidateRevision':'PersonRevision')+'/v1',
      commitIdempotencyKey:'people-system-marker-'+D({workId,phase}),eventFenceDigest:D({schema:'people.system-registration-event@1',workId,eventId,phase})};
  }
  return Object.freeze({definition,source,result,draft,decision,handle});
}
module.exports=Object.freeze({createSystemRegistrationQuery});
