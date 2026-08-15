'use strict';

const { createMaterialControlProjectionPort }=require('../../../foundation/persistence/material-control');

function createOffdeckAdminApplication(options){
  if(!options?.contextReader||!options.automationCoordinator||!options.caseCoordinator)throw new TypeError('Off-deck Admin requires product execution services.');
  const store=options.contextReader.store,controls=options.materialControlProjectionPort||createMaterialControlProjectionPort(options),wake=options.wake||(()=>{});
  const readControls=(keys)=>{const unique=[...new Set(keys)].sort(),values=[];for(let offset=0;offset<unique.length;offset+=500)values.push(...controls.getMaterialControlProjections(unique.slice(offset,offset+500)));return Object.freeze(values);};
  function policy(){return store.ensurePolicy();}
  function publishPolicy(body){return store.publishPolicy(body);}
  function candidates(){return store.listCandidates();}
  function evaluate(){const result=options.automationCoordinator.evaluate();wake();return result;}
  function detectDuplicates(){const result=options.automationCoordinator.detectDuplicates();wake();return result;}
  function cancelAftercareWorks(review){let drainingWorks=0;for(const reservation of review?.reservations||[]){const result=typeof options.cancelProcessWorks==='function'?options.cancelProcessWorks({ownerDomain:'arca',processType:'arca_shelf_entry',processId:reservation.shelfEntryId,reasonCode:'ARCA_OFFDECK_RESERVATION_FENCE'}):null;drainingWorks+=Number(result?.drainingWorks||0);}return drainingWorks;}
  function advancePreparedReview(reviewId){let review=store.detail(reviewId);if(!review)return null;const draining=cancelAftercareWorks(review);if(options.aftercareCoordinator)for(const reservation of review.reservations)options.aftercareCoordinator.reconcile(reservation.shelfEntryId);if(draining>0)return review.state==='open'?store.deferReviewUntilSafe(reviewId):store.detail(reviewId);return store.tryOpenPreparedReview(reviewId,readControls);}
  function createReview(body){const value={...body};if(value.caseId&&!value.shelfEntryId){const c=store.caseContext(value.caseId);if(!c)throw Object.assign(new Error('Off-deck Case was not found.'),{code:'ARCA_OFFDECK_CASE_NOT_FOUND'});value.shelfEntryId=c.case.shelf_entry_id;value.originKind='reauthorization';value.originRef=value.caseId;}const result=store.createReview(value,readControls);return advancePreparedReview(result.reviewId);}
  function authorize(body){const review=advancePreparedReview(body.reviewId);if(review?.state==='preparing')throw Object.assign(new Error('Aftercare Work is still reaching its safe boundary.'),{code:'ARCA_OFFDECK_AUTHORIZATION_NOT_READY'});const result=store.authorize(body.reviewId,body,readControls);try{for(const caseId of result.cases)options.caseCoordinator.reconcile(caseId);}catch(error){if(typeof options.onError==='function')options.onError(error);}wake();return result;}
  function caseDetail(caseId){const c=options.contextReader.read(caseId);if(!c)return null;return Object.freeze({caseId,shelfEntryId:c.case.shelf_entry_id,state:c.case.state,recoveryRevision:Number(c.case.recovery_revision),retryAtMs:c.case.retry_at_ms===null?null:Number(c.case.retry_at_ms),blockedReason:c.case.blocked_reason||null,scope:Object.freeze({destructionScopeId:c.scope.destruction_scope_id,memberCount:Number(c.scope.member_count),scopeDigest:c.scope.scope_digest}),authorization:Object.freeze({authorizationId:c.authorization.authorizationId,state:c.authorizationState}),evidence:Object.freeze(c.evidence.map((item)=>Object.freeze({materialKey:item.material_key,result:item.result,completedAtMs:Number(item.completed_at_ms)})))});}
  return Object.freeze({policy,publishPolicy,candidates,evaluate,detectDuplicates,
    suppress:(candidateId,body)=>store.suppressCandidate(candidateId,body),whitelist:(groupId,body)=>store.whitelistDuplicate(groupId,body),
    revokeSuppression:(id)=>store.revokeSuppression(id),revokeWhitelist:(id)=>store.revokeWhitelist(id),createReview,
    review:advancePreparedReview,cancelReview:(id)=>store.cancel(id),confirmSelection:(id,body)=>store.confirmSelection(id,body),
    confirmHighVolume:(id,body)=>store.confirmEscalation(id,body),authorize,cases:()=>Object.freeze({items:store.listCases()}),caseDetail});
}
module.exports=Object.freeze({createOffdeckAdminApplication});
