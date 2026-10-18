'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {createCommandCommitCoordinator}=require('../../../foundation/persistence/commit-foundation');

function createPeopleProfileUpdate(options){
  const coordinator=createCommandCommitCoordinator(options),store=options.peopleStore;
  if(!store?.createProfileUpdateParticipant||!options.contractValidator)throw new TypeError('People profile updates require Owner persistence and typed contracts.');
  return Object.freeze({update(personId,body,actorId){
    const validName=value=>typeof value==='string'&&value.trim().length>0&&value.length<=200&&!/[\x00-\x1f]/.test(value);
    if(!body||Object.keys(body).sort().join(',')!=='aliases,canonicalName,expectedPersonRevision,idempotencyKey'||
      !validName(body.canonicalName)||!Array.isArray(body.aliases)||body.aliases.length>32||body.aliases.some(value=>!validName(value))||
      !Number.isSafeInteger(body.expectedPersonRevision)||body.expectedPersonRevision<1||typeof body.idempotencyKey!=='string'||
      !body.idempotencyKey||body.idempotencyKey.length>128||!actorId)throw Object.assign(new Error('请填写有效的演员姓名和别名。'),{code:'PEOPLE_PROFILE_INPUT_INVALID'});
    const decisionId='people-profile-'+canonicalDigest({personId,actorId,key:body.idempotencyKey}).slice(0,40),seen=new Set(),
      aliases=[body.canonicalName,...body.aliases].map(value=>value.trim()).filter(value=>{
        const normalized=value.toLocaleLowerCase();if(seen.has(normalized))return false;seen.add(normalized);return true;
      }).map(alias=>({aliasDisplay:alias,aliasNormalized:alias.toLocaleLowerCase(),provenanceDigest:canonicalDigest({source:'us_adult_user',alias})})),
      value={decisionId,personId,expectedPersonRevision:body.expectedPersonRevision,canonicalName:body.canonicalName.trim(),aliases,actorId,requestDigest:canonicalDigest(body)},
      decision={...value,decisionDigest:canonicalDigest(value)};
    options.contractValidator.validate('helix://contracts/domain-types/PeopleProfileUpdateDecision/v1',decision);
    return coordinator.execute({command:{commandReceiptId:decisionId,ownerDomain:'people',commandContract:'people.update-profile@1',callerScope:actorId,
      idempotencyKey:body.idempotencyKey,requestDigest:value.requestDigest,targetType:'person',targetId:personId},
      domainParticipant:store.createProfileUpdateParticipant(decision),
      commitMarker:{commitMarker:decisionId,effectId:null,scopeType:'person',scopeId:personId,commitDigest:decision.decisionDigest},
      auditRecords:[{auditId:decisionId+'-audit',actorType:'admin',actorId,action:'people.person.update-profile',scopeType:'person',scopeId:personId,evidenceDigest:decision.decisionDigest}],
      outboxMessages:[],resultEnvelope(person){return {resultSchemaRef:'helix://contracts/types/PersonRevision/v1',
        resultRef:{personId,personRevision:person.currentRevision,referenceProjectionRevision:person.currentReferenceProjectionRevision,personFactDigest:person.revision.factDigest}};}
    });
  }});
}
module.exports=Object.freeze({createPeopleProfileUpdate});
