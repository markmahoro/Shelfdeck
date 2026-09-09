'use strict';

const {canonicalDigest}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');

const COLUMNS=['approval_id','on_deck_run_id','settlement_scope_digest','settlement_member_set_digest',
  'source_to_final_mapping_digest','final_product_verification_digest','standing_authorization_id',
  'standing_authorization_revision','actor_or_policy_ref','approved_at_ms','state'];
function createOnDeckSettlementApprovalStore(options){
  const repository=createRepositoryDefinition({repositoryId:'arca_ondeck_settlement_approval',owner:'arca',
    schemaManifest:options.schemaManifest,statements:{
      find:{kind:'select-one',tableId:'arca_ondeck_settlement_approvals',columns:COLUMNS,
        keyColumns:['on_deck_run_id','settlement_scope_digest'],safeIntegers:true},
      insert:{kind:'insert',tableId:'arca_ondeck_settlement_approvals',columns:COLUMNS},
    }});
  const execute=body=>options.unitOfWork.execute([{participantId:'arca_ondeck_settlement_approval',owner:'arca',
    repositories:[repository],execute:c=>body(c.repository(repository.repositoryId),c.commitTimeMs)}]).arca_ondeck_settlement_approval;
  function expected(scope,authorization){
    if(authorization?.state!=='enabled'||scope.members.length!==1)throw new Error('Settlement Approval requires current authorization and one exact member.');
    const member=scope.members[0];
    return {approval_id:'arca-settlement-approval-'+canonicalDigest({run:scope.onDeckRunId,scope:scope.approvalScopeDigest}).slice(0,40),
      on_deck_run_id:scope.onDeckRunId,settlement_scope_digest:scope.approvalScopeDigest,
      settlement_member_set_digest:scope.memberSetDigest,source_to_final_mapping_digest:member.sourceToFinalMappingDigest,
      final_product_verification_digest:member.finalProductVerificationDigest,standing_authorization_id:authorization.authorizationId,
      standing_authorization_revision:authorization.revision,actor_or_policy_ref:authorization.actorId};
  }
  function validate(row,basis){
    if(row)row={...row,standing_authorization_revision:Number(row.standing_authorization_revision),approved_at_ms:Number(row.approved_at_ms)};
    if(!row||row.state!=='active'||Object.entries(basis).some(([key,value])=>row[key]!==value))
      throw Object.assign(new Error('The exact On-deck Settlement Approval is unavailable or stale.'),{code:'ARCA_INPUT_SETTLEMENT_APPROVAL_REQUIRED'});
    return row;
  }
  function readHandle(scope,authorization,eventId){
    const basis=expected(scope,authorization),row=execute(repo=>validate(repo.invoke('find',basis),basis));
    return Object.freeze({schemaRef:'helix://contracts/types/ApprovalHandle/v1',schemaVersion:1,
      approvalId:row.approval_id,ownerDomain:'arca',processType:'arca_ondeck_run',processId:row.on_deck_run_id,eventId,
      exactEffectScopeDigest:row.settlement_scope_digest,approvalRevision:row.standing_authorization_revision,
      actorId:row.actor_or_policy_ref,invalidatingFactDigests:Object.freeze([authorization.authorizationDigest,
        row.settlement_member_set_digest,row.final_product_verification_digest]),approvedAtMs:row.approved_at_ms});
  }
  return Object.freeze({readHandle,issue(scope,authorization){
    const basis=expected(scope,authorization);
    return execute((repo,at)=>{
      const existing=repo.invoke('find',basis);
      if(existing)return validate(existing,basis);
      const row={...basis,approved_at_ms:at,state:'active'};
      repo.invoke('insert',row);return Object.freeze(row);
    });
  }});
}
module.exports=Object.freeze({createOnDeckSettlementApprovalStore});
