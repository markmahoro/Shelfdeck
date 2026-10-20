'use strict';
const {canonicalDigest:D,canonicalJson}=require('../../../contracts/canonical-json');
const {createWorkAdmission}=require('../../../foundation/execution/work-admission');
const {createCandidateDraft}=require('../model/people-store-contracts');
const model=require('../model/system-merge-work');
function fail(message){throw Object.assign(new Error(message),{code:'PEOPLE_SYSTEM_MERGE_STALE'});}
function createSystemMerge(options){
  const store=options.peopleStore,reader=options.workResultReader,validator=options.contractValidator;
  function definition(workId){const work=reader.readDefinition(workId)?.definition;
    if(!work||work.ownerDomain!=='people'||work.processType!=='people_system_merge'||work.workKind!=='system_person_merge')fail('Merge requires its exact People Work.');return work;}
  function people(workId){const work=definition(workId),refs=work.dependencyRefs.filter(ref=>ref.objectType==='person'),values=refs.map(ref=>store.getPerson(ref.objectId));
    if(!model.reliablePair(values.filter(Boolean)))fail('Current identities do not prove this exact reliable Person pair.');
    const expected=model.workFor(values.map(model.personRef),values[0].libraryKind);
    if(canonicalJson(expected)!==canonicalJson(work))fail('Person or Preference revision changed after Merge admission.');
    const levels=values.map(person=>store.getCurrentPreference(person.personId)?.preferenceLevel??null);
    if(levels[0]!==levels[1])fail('System Merge cannot resolve a historical Preference conflict.');return values;
  }
  function source(workId){const values=people(workId),work=definition(workId),refs=values.map(person=>({objectId:person.personId,revision:person.currentRevision,
    schemaRef:'helix://contracts/types/PersonRevision/v1',digest:person.revision.factDigest,objectKind:'person-identity-alias-reference'})),
    body={schemaRef:'helix://contracts/domain-types/PersonIdentitiesAliasesReferences/v1',schemaVersion:1,objectId:work.processId,revision:1,people:refs,peopleSetDigest:D(refs)};
    return {...body,digest:D(body)};
  }
  function evidence(workId,at){const work=definition(workId),values=people(workId),personPair=values.map(model.personRef),
    matchSignals=[{objectId:'exact-provider-person-'+D(personPair),revision:1,schemaRef:model.POLICY.ruleSchemaRef,snapshotDigest:work.executionBasisDigest,objectKind:'person-match-signal'}],
    conflictBody={schemaRef:'helix://people/merge-conflict-summary/v1',schemaVersion:1,recordKind:'merge-conflict-summary',entries:[]},
    payload={personPair,matchSignals,conflictSummary:{...conflictBody,recordDigest:D(conflictBody)},evidenceRefs:[work.workId]};
    return {schemaRef:'helix://contracts/types/MergeCandidateEvidence/v1',schemaVersion:1,evidenceId:'people-merge-evidence-'+work.executionBasisDigest,
      evidenceKind:'exact_provider_person',producerRef:model.OBSERVE,basisDigest:work.executionBasisDigest,payloadDigest:D(payload),observedAtMs:at,...payload};
  }
  function result(workId,capability){const records=reader.read(workId).filter(item=>item.capabilityRef===capability&&item.outcomeKind==='succeeded');
    if(records.length!==1||records[0].state!=='succeeded'||D(records[0].result)!==records[0].resultDigest)fail('Merge lacks an exact successful typed predecessor.');
    validator.validate(records[0].resultSchemaRef,records[0].result);return records[0].result;}
  function draft(workId){const observed=result(workId,model.OBSERVE),candidatePayload={leftPersonRef:observed.personPair[0],rightPersonRef:observed.personPair[1],
    matchSignals:observed.matchSignals,conflictSummary:observed.conflictSummary,evidenceRefs:observed.evidenceRefs},
    body={schemaRef:'helix://contracts/types/PeopleCandidateDraft/v1',schemaVersion:1,draftId:'people-merge-candidate-'+D({workId}),draftKind:'people-candidate',
      basisDigest:definition(workId).executionBasisDigest,producedAtMs:observed.observedAtMs,candidateKind:'merge',evidenceDigest:observed.payloadDigest,candidatePayload,candidatePayloadDigest:D(candidatePayload)};
    return createCandidateDraft({...body,draftDigest:D(body)});
  }
  function decision(workId){const values=people(workId),candidate=result(workId,model.CANDIDATE),value=draft(workId);
    if(candidate.candidateKind!=='merge'||candidate.candidateId!==value.draftId||candidate.candidatePayloadDigest!==value.candidatePayloadDigest||candidate.state!=='open')fail('Merge Candidate differs from exact Evidence.');
    const ordered=[...values].sort((a,b)=>a.createdAtMs-b.createdAtMs||(a.personId<b.personId?-1:a.personId>b.personId?1:0)),target=ordered[0],source=ordered[1],
      body={decisionId:'people-system-merge-decision-'+D({workId}),candidateKind:'merge',candidateId:value.draftId,expectedCandidateRevision:1,
        candidatePayloadDigest:value.candidatePayloadDigest,decisionOrigin:'strong_identity_rule',ruleRevision:1,sourcePersonId:source.personId,targetPersonId:target.personId,
        expectedSourcePersonRevision:source.currentRevision,expectedTargetPersonRevision:target.currentRevision,
        expectedSourcePreferenceRevision:source.currentPreferenceRevision,expectedTargetPreferenceRevision:target.currentPreferenceRevision,preferenceResolution:'keep_target'};
    return {...body,decisionDigest:D(body)};
  }
  function handle(workId,eventId,phase){const candidate=phase==='candidate',payload=candidate?draft(workId):decision(workId),factType=candidate?'PeopleCandidateDraft':'PeopleCandidateAcceptanceDecision';
    return {schemaRef:'helix://contracts/types/DomainFactCommitHandle/v1',schemaVersion:1,handleId:'people-merge-fact-'+D({workId,phase}),ownerDomain:'people',
      aggregateType:candidate?'people-candidate':'person',aggregateId:candidate?payload.draftId:payload.targetPersonId,factType,
      factSchemaRef:'helix://contracts/'+(candidate?'types/':'domain-types/')+factType+'/v1',expectedRevision:candidate?0:payload.expectedTargetPersonRevision,
      payloadDigest:D(payload),resultSchemaRef:'helix://contracts/types/'+(candidate?'PeopleCandidateRevision':'PersonRevision')+'/v1',
      commitIdempotencyKey:'people-merge-marker-'+D({workId,phase}),eventFenceDigest:D({workId,eventId,phase})};
  }
  const query=Object.freeze({definition,source,evidence,draft,decision,handle}),admission=createWorkAdmission({...options,
    limits:{globalOpenWorks:768,ownerOpenWorks:32,openEvents:512},eligibilityProvider:{check:request=>({eligible:request.processType==='people_system_merge',basisDigest:request.executionBasisDigest,reasonCode:'PEOPLE_SYSTEM_MERGE_STALE'})}});
  function listPage({cursor,limit}){return store.listPeoplePage({cursor:cursor||'',limit:Math.min(limit,100),status:'active',search:'',libraryKind:null})
    .map(person=>({cursor:person.personId,scope:{personId:person.personId}}));}
  function reconcile({personId}){const person=store.getPerson(personId);if(!person||person.status!=='active'||person.libraryKind==='us_adult')return {kind:'skipped'};
    const targets=new Map();for(const identity of person.revision.providerIdentities)for(const other of store.findActivePeopleByProviderIdentity({libraryKind:person.libraryKind,
      provider:identity.provider,namespace:identity.namespace,providerKey:identity.providerKey}))if(other.personId!==personId)targets.set(other.personId,other);
    for(const other of targets.values()){
      const pair=[person,other].sort((a,b)=>(a.personId<b.personId?-1:a.personId>b.personId?1:0));if(!model.reliablePair(pair))continue;
      if(pair.map(item=>store.getCurrentPreference(item.personId)?.preferenceLevel??null).some((level,_,levels)=>level!==levels[0]))continue;
      const work=model.workFor(pair.map(model.personRef),person.libraryKind),submitted=admission.replay(work)||admission.submit(work);
      if(submitted.kind==='invalid_contract')throw Object.assign(new Error('System Merge violates Work admission.'),{code:submitted.reasonCode});
      return {kind:submitted.kind==='deferred'?'deferred':'admitted',workId:submitted.kind==='deferred'?null:work.workId};
    }return {kind:'no_reliable_merge'};
  }
  return Object.freeze({query,listPage,reconcile});
}
module.exports=Object.freeze({createSystemMerge});
