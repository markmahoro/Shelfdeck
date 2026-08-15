'use strict';

const { canonicalDigest }=require('../../../contracts/canonical-json');
const { stable }=require('../model/offdeck-contract');
const { P }=require('./offdeck-automation-planners');
function createOffdeckAutomationProjections(options){const reader=options.contextReader;
  function factHandle(ownerScope,parameters,payloadDigest){return Object.freeze({schemaRef:'helix://contracts/types/DomainFactCommitHandle/v1',schemaVersion:1,handleId:stable('arca-offdeck-automation-handle-',{processId:ownerScope.processId,eventId:parameters.eventId}),ownerDomain:'arca',aggregateType:'offdeck_automation',aggregateId:ownerScope.processId,factType:parameters.factKind,factSchemaRef:parameters.factKind==='candidate'?'helix://contracts/types/ReviewCandidateRevision/v1':'helix://contracts/types/DuplicateGroupRevisionList/v1',expectedRevision:0,payloadDigest,resultSchemaRef:parameters.factKind==='candidate'?'helix://contracts/types/ReviewCandidateRevision/v1':'helix://contracts/types/DuplicateGroupRevisionList/v1',commitIdempotencyKey:stable('arca-offdeck-automation-commit-',{processId:ownerScope.processId,eventId:parameters.eventId}),eventFenceDigest:canonicalDigest({eventId:parameters.eventId,processId:ownerScope.processId})});}
  return Object.freeze([
    Object.freeze({projectionRef:P.identities,projection:Object.freeze({project:({ownerScope})=>reader.activeIdentityProjection(ownerScope.processId)})}),
    Object.freeze({projectionRef:P.duplicateEvidence,projection:Object.freeze({project:({sourceResult})=>sourceResult})}),
    Object.freeze({projectionRef:P.policyResult,projection:Object.freeze({project:({ownerScope})=>{const shelfEntryId=ownerScope.processId.startsWith('entry:')?ownerScope.processId.slice(6):ownerScope.processId,c=reader.evaluateEntry(shelfEntryId);if(!c||c.evaluated.result!==true)throw new Error('Off-deck Policy Result is stale or no longer true.');const base={schemaRef:'helix://contracts/domain-types/PolicyResult/v1',schemaVersion:1,objectId:shelfEntryId,revision:1,policyRevision:c.policy.revision,resultCode:'recommend_offdeck',reasonDigest:c.reasonDigest};return Object.freeze({...base,digest:canonicalDigest(base)});}})}),
    Object.freeze({projectionRef:P.factHandle,projection:Object.freeze({project:({ownerScope,parameters})=>{const payloadDigest=parameters.factKind==='candidate'
      ?reader.evaluateEntry(ownerScope.processId.replace(/^entry:/,'')).basisDigest
      :reader.activeIdentityProjection(ownerScope.processId).digest;return factHandle(ownerScope,parameters,payloadDigest);}})}),
  ]);
}
module.exports=Object.freeze({createOffdeckAutomationProjections});
