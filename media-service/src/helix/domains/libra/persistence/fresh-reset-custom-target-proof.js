'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {decisionHeadDigest}=require('../model/decision-front-half-contracts');

function fail(){throw Object.assign(new Error('Retained custom target command evidence is incomplete or inconsistent.'),
  {code:'LIBRA_RESET_CUSTOM_TARGET_INVALID'});}
const same=(left,right)=>canonicalJson(left)===canonicalJson(right);

// Read only within the Operator's frozen source or target snapshot. These
// are the original Libra command facts, not authority to replay a command.
function verifyCustomTargetCommandProofs(repo,{spec,intent,preview,baseSpec,previewRow,decisionBasis}){
  const previewRequest=canonicalDigest({schema:'libra.custom-target-preview-request@1',subjectId:intent.subjectId,libraRunId:intent.libraRunId});
  if(!previewRow||previewRow.actor_id!==intent.actorId||typeof previewRow.idempotency_key!=='string'||
      !previewRow.idempotency_key.trim()||previewRow.idempotency_key.length>128||previewRow.request_digest!==previewRequest||
      !decisionBasis||decisionBasis.decision_basis_id!==baseSpec.decisionBasisId||decisionBasis.subject_id!==intent.subjectId||
      decisionBasis.basis_kind!=='acceptance_spec'||typeof decisionBasis.routing_decision_id!=='string'||!decisionBasis.routing_decision_id)fail();
  const common={actorType:'admin',actorId:intent.actorId,callerScope:'admin:'+intent.actorId,
    scopeType:'libra_run',scopeId:intent.libraRunId,evidenceDigest:null,resultSchema:'libra.custom-target-command-result@1'},
    previewContract='libra.custom-target.preview@1',confirmContract='libra.custom-target.confirm@1',
    publishContract='libra.custom-target.spec.publish@1',publishResultKeys=['subjectId','acceptanceSpecId','specRevision','specDigest',
      'recordDigest','customTargetRef','targetInputDigest','committedHeadRevision'];
  const commands=[
    {...common,id:canonicalDigest({schema:'libra.custom-target-command-receipt@1',kind:'preview',
      actorId:intent.actorId,idempotencyKey:previewRow.idempotency_key}),contract:previewContract,action:previewContract,
      key:previewRow.idempotency_key,requestDigest:previewRequest,
      validateResult:value=>same(value,{recordId:preview.previewDigest,recordDigest:preview.previewDigest})},
    {...common,id:canonicalDigest({schema:'libra.custom-target-command-receipt@1',kind:'intent',
      actorId:intent.actorId,idempotencyKey:intent.idempotencyKey}),contract:confirmContract,action:confirmContract,
      key:intent.idempotencyKey,requestDigest:intent.requestDigest,
      validateResult:value=>same(value,{recordId:intent.intentId,recordDigest:intent.intentDigest})},
    {id:canonicalDigest({schema:'libra.custom-spec-command-id@1',intentId:intent.intentId}),contract:publishContract,
      callerScope:'libra.custom-target-resolution',key:intent.intentId,
      requestDigest:canonicalDigest({schema:publishContract,intentId:intent.intentId,intentDigest:intent.intentDigest}),
      scopeType:'custom_target',scopeId:intent.intentId,actorType:'system',actorId:'libra.custom-target-resolution',
      action:'libra.custom_spec.publish',evidenceDigest:intent.intentDigest,resultSchema:'libra.custom-spec-publication-result@1',
      validateResult:value=>value&&same(Object.keys(value).sort(),[...publishResultKeys].sort())&&
        Number.isSafeInteger(value.committedHeadRevision)&&value.committedHeadRevision>1&&
        decisionHeadDigest(intent.subjectId,value.committedHeadRevision-1,decisionBasis.routing_decision_id,baseSpec.decisionBasisId,
          intent.basis.decisionHeadAcceptanceSpecId)===intent.basis.decisionHeadDigest&&
        same(Object.fromEntries(Object.entries(value).filter(([key])=>key!=='committedHeadRevision')),
          {subjectId:spec.subjectId,acceptanceSpecId:spec.acceptanceSpecId,specRevision:spec.specRevision,specDigest:spec.specDigest,
            recordDigest:spec.recordDigest,customTargetRef:spec.customTargetRef,targetInputDigest:spec.targetInputDigest}),
      committedAtMs:spec.publishedAtMs},
  ];
  for(const command of commands){
    const receipt=repo.invoke('receipt',{command_receipt_id:command.id}),marker=repo.invoke('marker',{commit_marker:command.id}),
      audit=repo.invoke('audit',{audit_id:command.id});
    let result;try{result=receipt&&JSON.parse(receipt.result_ref_json);}catch{fail();}
    if(!receipt||!marker||!audit||receipt.command_receipt_id!==command.id||receipt.owner_domain!=='libra'||
        receipt.command_contract!==command.contract||receipt.caller_scope!==command.callerScope||receipt.idempotency_key!==command.key||
        receipt.request_digest!==command.requestDigest||receipt.target_type!==command.scopeType||receipt.target_id!==command.scopeId||
        receipt.result_schema_ref!==command.resultSchema||receipt.result_ref_json!==canonicalJson(result)||
        receipt.result_digest!==canonicalDigest(result)||!Number.isSafeInteger(receipt.committed_at_ms)||receipt.committed_at_ms<0||
        command.committedAtMs!==undefined&&receipt.committed_at_ms!==command.committedAtMs||
        marker.commit_marker!==command.id||marker.effect_id!==null||marker.owner_domain!=='libra'||marker.scope_type!==command.scopeType||
        marker.scope_id!==command.scopeId||marker.commit_digest!==command.requestDigest||marker.result_id!==null||
        marker.result_schema_ref!==null||marker.result_digest!==null||marker.committed_at_ms!==receipt.committed_at_ms||
        audit.audit_id!==command.id||audit.owner_domain!=='libra'||audit.actor_type!==command.actorType||audit.actor_id!==command.actorId||
        audit.action!==command.action||audit.scope_type!==command.scopeType||audit.scope_id!==command.scopeId||audit.work_id!==null||
        audit.event_id!==null||audit.evidence_digest!==command.evidenceDigest||audit.occurred_at_ms!==receipt.committed_at_ms||
        !command.validateResult(result))fail();
  }
  return commands.map(command=>command.id);
}

module.exports=Object.freeze({verifyCustomTargetCommandProofs});
