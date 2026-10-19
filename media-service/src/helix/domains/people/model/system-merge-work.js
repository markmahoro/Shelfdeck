'use strict';
const {canonicalDigest:D}=require('../../../contracts/canonical-json');
const {isTmdbPerson}=require('./provider-person-identity');
const OBSERVE='people.merge_evidence.resolve@1',CANDIDATE='people.candidate.commit@1',PERSON='people.person.commit@1',
  POLICY=Object.freeze({policyKind:'merge',policyRevision:1,ruleSchemaRef:'helix://people/rules/reliable-person-merge/v1',
    ruleDigest:D({schema:'people.reliable-person-merge@1',libraries:['normal','jav'],identity:'exact_provider_person',name:'never',preference:'equal_only'})});
function identityKey(identity){return [identity.provider,isTmdbPerson(identity)?'tmdb_person':identity.namespace,identity.providerKey].join('\0');}
function reliablePair(people){
  if(people.length!==2||people.some(person=>person.status!=='active'||person.libraryKind==='us_adult')||people[0].libraryKind!==people[1].libraryKind)return false;
  const left=new Set(people[0].revision.providerIdentities.map(identityKey)),right=people[1].revision.providerIdentities.map(identityKey);
  if(!right.some(key=>left.has(key)))return false;
  const namespaces=new Map();
  for(const identity of people.flatMap(person=>person.revision.providerIdentities)){
    const key=[identity.provider,isTmdbPerson(identity)?'tmdb_person':identity.namespace].join('\0');
    if(!namespaces.has(key))namespaces.set(key,new Set());namespaces.get(key).add(identity.providerKey);
  }
  return [...namespaces.values()].every(keys=>keys.size===1);
}
function personRef(person){return {personId:person.personId,revision:person.currentRevision,factDigest:person.revision.factDigest,preferenceRevision:person.currentPreferenceRevision};}
function workFor(refs,libraryKind){
  const pair=[...refs].sort((a,b)=>(a.personId<b.personId?-1:a.personId>b.personId?1:0)),basis={schema:'people.system-merge-work@1',libraryKind,people:pair,policy:POLICY},id=D(basis);
  return Object.freeze({schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1',schemaVersion:1,workId:'people-system-merge-'+id,
    ownerDomain:'people',processType:'people_system_merge',processId:'people-merge-'+id,workKind:'system_person_merge',
    workObjectiveTypeRef:'helix://people/work-objectives/ReliablePersonMerge/v1',workObjectiveVersion:1,executionBasisId:'people-merge-'+id,executionBasisDigest:id,
    priorityClass:'background_observation',priorityRevision:1,capabilityCatalogScope:'people',workspaceMaterialScope:[],
    idempotencyKey:'people-system-merge/'+id,concurrencyScope:'people-system-merge/'+D(pair.map(person=>person.personId)),
    outputContractRef:'helix://contracts/capabilities/people.person.commit/v1/result',dependencyRefs:[
      {ownerDomain:'people',objectType:'person_library',objectId:libraryKind,revision:1,digest:D({libraryKind})},
      ...pair.map(person=>({ownerDomain:'people',objectType:'person',objectId:person.personId,revision:person.revision,digest:person.factDigest})),
      ...pair.map(person=>({ownerDomain:'people',objectType:'merge_preference_revision',objectId:person.personId,revision:person.preferenceRevision||1,digest:D({personId:person.personId,preferenceRevision:person.preferenceRevision})}))]});
}
module.exports=Object.freeze({OBSERVE,CANDIDATE,PERSON,POLICY,reliablePair,personRef,workFor});
