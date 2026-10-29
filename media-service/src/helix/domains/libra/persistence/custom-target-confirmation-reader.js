'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {createCustomTargetStore}=require('./custom-target-store');
const {createCustomSpecPublicationStore,RESULT_SCHEMA}=require('./custom-spec-publication-store');
const {assertCustomAcceptanceSpec}=require('../model/custom-acceptance-spec');
const {decisionHeadDigest}=require('../model/decision-front-half-contracts');

const SHA=/^[a-f0-9]{64}$/;
const SCHEMA='libra.custom-target-confirmation-evidence@1';
function fail(){throw Object.assign(new Error('Custom target confirmation evidence is incomplete or inconsistent.'),
  {code:'LIBRA_CUSTOM_TARGET_CONFIRMATION_INVALID'});}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function same(value,expected){return canonicalJson(value)===canonicalJson(expected);}

// This Libra projection proves immutable confirmation and publication facts.
// It is not an Arca acceptance decision or a current-target authorization.
// A consumer must revalidate the supplied opaque fence in its own transaction.
function createLibraCustomTargetConfirmationReader(options){
  if(!options?.schemaManifest||typeof options.unitOfWork?.captureReadFence!=='function'||
      typeof options.unitOfWork?.execute!=='function')throw new TypeError('Custom target evidence requires a fenced Owner reader.');
  const targets=options.customTargetStore||createCustomTargetStore(options),
    specs=options.customSpecPublicationStore||createCustomSpecPublicationStore({...options,customTargetStore:targets}),
    owner=createRepositoryDefinition({repositoryId:'libra_custom_confirmation_preview',owner:'libra',schemaManifest:options.schemaManifest,
      readOnly:true,statements:{preview:{kind:'select-one',tableId:'libra_custom_target_previews',
        keyColumns:['preview_id'],columns:['preview_id','actor_id','idempotency_key','request_digest']},
        basis:{kind:'select-one',tableId:'libra_decision_basis_revisions',keyColumns:['decision_basis_id'],
          columns:['decision_basis_id','subject_id','basis_kind','routing_decision_id']}}}),
    foundation=createRepositoryDefinition({repositoryId:'libra_custom_confirmation_foundation',owner:'execution-foundation',
      schemaManifest:options.schemaManifest,readOnly:true,statements:{
        receipt:{kind:'select-one',tableId:'fx_command_receipts',keyColumns:['command_receipt_id'],columns:['command_receipt_id',
          'owner_domain','command_contract','caller_scope','idempotency_key','request_digest','target_type','target_id',
          'result_schema_ref','result_ref_json','result_digest','committed_at_ms']},
        marker:{kind:'select-one',tableId:'fx_commit_markers',keyColumns:['commit_marker'],columns:['commit_marker','effect_id',
          'owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest','committed_at_ms']},
        audit:{kind:'select-one',tableId:'fx_audit_records',keyColumns:['audit_id'],columns:['audit_id','owner_domain','actor_type',
          'actor_id','action','scope_type','scope_id','work_id','event_id','evidence_digest','occurred_at_ms']},
      }});
  function proof(repo,command){
    const receipt=repo.invoke('receipt',{command_receipt_id:command.id}),marker=repo.invoke('marker',{commit_marker:command.id}),
      audit=repo.invoke('audit',{audit_id:command.id});
    let result;try{result=receipt&&JSON.parse(receipt.result_ref_json);}catch{fail();}
    if(!receipt||!marker||!audit||receipt.command_receipt_id!==command.id||receipt.owner_domain!=='libra'||
        receipt.command_contract!==command.contract||receipt.caller_scope!==command.callerScope||
        receipt.idempotency_key!==command.key||receipt.request_digest!==command.requestDigest||
        receipt.target_type!==command.scopeType||receipt.target_id!==command.scopeId||
        receipt.result_schema_ref!==command.resultSchema||receipt.result_ref_json!==canonicalJson(result)||
        receipt.result_digest!==canonicalDigest(result)||!Number.isSafeInteger(receipt.committed_at_ms)||receipt.committed_at_ms<0||
        marker.commit_marker!==command.id||marker.effect_id!==null||marker.owner_domain!=='libra'||
        marker.scope_type!==command.scopeType||marker.scope_id!==command.scopeId||marker.commit_digest!==command.requestDigest||
        marker.result_id!==null||marker.result_schema_ref!==null||marker.result_digest!==null||marker.committed_at_ms!==receipt.committed_at_ms||
        audit.audit_id!==command.id||audit.owner_domain!=='libra'||audit.actor_type!==command.actorType||audit.actor_id!==command.actorId||
        audit.action!==command.action||audit.scope_type!==command.scopeType||audit.scope_id!==command.scopeId||
        audit.work_id!==null||audit.event_id!==null||audit.evidence_digest!==command.evidenceDigest||
        audit.occurred_at_ms!==receipt.committed_at_ms||!command.validateResult(result))fail();
    return Object.freeze({commandReceiptId:command.id,requestDigest:command.requestDigest,committedAtMs:receipt.committed_at_ms});
  }
  return Object.freeze({read(request,{readFence=options.unitOfWork.captureReadFence()}={}){
    const keys=['subjectId','productScopeDigest','acceptanceSpecId','acceptanceSpecRecordDigest','intentId','intentDigest','previewDigest'];
    if(!request||typeof request!=='object'||Array.isArray(request)||!same(Object.keys(request).sort(),[...keys].sort())||
        typeof request.subjectId!=='string'||!request.subjectId.trim()||request.subjectId.length>256||
        keys.filter(key=>key!=='subjectId').some(key=>!SHA.test(request[key]||''))||!readFence)fail();
    const spec=specs.read(request.acceptanceSpecId),{intent,preview,baseSpec}=targets.intentEvidence(request.intentId);
    assertCustomAcceptanceSpec({spec,intent,preview,baseSpec});
    if(spec.subjectId!==request.subjectId||spec.recordDigest!==request.acceptanceSpecRecordDigest||
        spec.productScope.scopeDigest!==request.productScopeDigest||spec.customTargetRef.intentId!==request.intentId||
        spec.customTargetRef.intentDigest!==request.intentDigest||spec.customTargetRef.previewDigest!==request.previewDigest||
        intent.intentDigest!==request.intentDigest||intent.previewDigest!==request.previewDigest||
        intent.subjectId!==request.subjectId||intent.basis.productScopeDigest!==request.productScopeDigest||
        spec.originalTarget.acceptanceSpecId!==baseSpec.acceptanceSpecId||spec.originalTarget.recordDigest!==baseSpec.recordDigest)fail();
    let previewRow,decisionBasis;
    const results=options.unitOfWork.execute([
      {participantId:'libra_custom_confirmation_owner',owner:'libra',repositories:[owner],execute(context){
        const repo=context.repository(owner.repositoryId);
        previewRow=repo.invoke('preview',{preview_id:preview.previewDigest});
        decisionBasis=repo.invoke('basis',{decision_basis_id:baseSpec.decisionBasisId});
        const expected=canonicalDigest({schema:'libra.custom-target-preview-request@1',subjectId:intent.subjectId,libraRunId:intent.libraRunId});
        if(!previewRow||previewRow.preview_id!==preview.previewDigest||previewRow.actor_id!==intent.actorId||
            typeof previewRow.idempotency_key!=='string'||!previewRow.idempotency_key.trim()||previewRow.idempotency_key.length>128||
            previewRow.request_digest!==expected||!decisionBasis||decisionBasis.decision_basis_id!==baseSpec.decisionBasisId||
            decisionBasis.subject_id!==intent.subjectId||decisionBasis.basis_kind!=='acceptance_spec'||
            typeof decisionBasis.routing_decision_id!=='string'||!decisionBasis.routing_decision_id)fail();
      }},
      {participantId:'libra_custom_confirmation_technical',owner:'execution-foundation',boundBusinessOwner:'libra',repositories:[foundation],execute(context){
        const repo=context.repository(foundation.repositoryId),common={actorType:'admin',actorId:intent.actorId,
          callerScope:'admin:'+intent.actorId,scopeType:'libra_run',scopeId:intent.libraRunId,evidenceDigest:null,
          resultSchema:'libra.custom-target-command-result@1'},
          previewContract='libra.custom-target.preview@1',confirmContract='libra.custom-target.confirm@1',
          publishContract='libra.custom-target.spec.publish@1',publishResultKeys=['subjectId','acceptanceSpecId','specRevision','specDigest',
            'recordDigest','customTargetRef','targetInputDigest','committedHeadRevision'];
        const previewProof=proof(repo,{...common,id:canonicalDigest({schema:'libra.custom-target-command-receipt@1',kind:'preview',
          actorId:intent.actorId,idempotencyKey:previewRow.idempotency_key}),contract:previewContract,action:previewContract,
          key:previewRow.idempotency_key,requestDigest:previewRow.request_digest,
          validateResult:value=>same(value,{recordId:preview.previewDigest,recordDigest:preview.previewDigest})});
        const confirmationProof=proof(repo,{...common,id:canonicalDigest({schema:'libra.custom-target-command-receipt@1',kind:'intent',
          actorId:intent.actorId,idempotencyKey:intent.idempotencyKey}),contract:confirmContract,action:confirmContract,
          key:intent.idempotencyKey,requestDigest:intent.requestDigest,
          validateResult:value=>same(value,{recordId:intent.intentId,recordDigest:intent.intentDigest})});
        const publicationProof=proof(repo,{id:canonicalDigest({schema:'libra.custom-spec-command-id@1',intentId:intent.intentId}),
          contract:publishContract,callerScope:'libra.custom-target-resolution',key:intent.intentId,
          requestDigest:canonicalDigest({schema:publishContract,intentId:intent.intentId,intentDigest:intent.intentDigest}),
          scopeType:'custom_target',scopeId:intent.intentId,actorType:'system',actorId:'libra.custom-target-resolution',
          action:'libra.custom_spec.publish',evidenceDigest:intent.intentDigest,resultSchema:RESULT_SCHEMA,
          validateResult:value=>value&&same(Object.keys(value).sort(),[...publishResultKeys].sort())&&
            Number.isSafeInteger(value.committedHeadRevision)&&value.committedHeadRevision>1&&
            decisionHeadDigest(intent.subjectId,value.committedHeadRevision-1,decisionBasis.routing_decision_id,baseSpec.decisionBasisId,
              intent.basis.decisionHeadAcceptanceSpecId)===intent.basis.decisionHeadDigest&&
            same(Object.fromEntries(Object.entries(value).filter(([key])=>key!=='committedHeadRevision')),
              {subjectId:spec.subjectId,acceptanceSpecId:spec.acceptanceSpecId,specRevision:spec.specRevision,specDigest:spec.specDigest,
                recordDigest:spec.recordDigest,customTargetRef:spec.customTargetRef,targetInputDigest:spec.targetInputDigest})});
        if(publicationProof.committedAtMs!==spec.publishedAtMs)fail();
        return {previewProof,confirmationProof,publicationProof};
      }},
    ],{readFence}).libra_custom_confirmation_technical;
    const body={schemaRef:SCHEMA,subjectId:intent.subjectId,productScopeDigest:intent.basis.productScopeDigest,
      acceptanceSpecId:spec.acceptanceSpecId,acceptanceSpecRecordDigest:spec.recordDigest,
      intentId:intent.intentId,intentDigest:intent.intentDigest,previewDigest:preview.previewDigest,
      baseAcceptanceSpecId:baseSpec.acceptanceSpecId,baseSpecRecordDigest:baseSpec.recordDigest,actorId:intent.actorId,...results};
    return Object.freeze({kind:'ready',evidence:freeze({...body,evidenceDigest:canonicalDigest(body)}),
      records:freeze({spec,intent,preview,baseSpec}),readFence});
  }});
}

module.exports=Object.freeze({SCHEMA,createLibraCustomTargetConfirmationReader});
