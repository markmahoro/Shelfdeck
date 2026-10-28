'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {createCommandCommitCoordinator}=require('../../../foundation/persistence/commit-foundation');
const {decisionHeadDigest}=require('../model/decision-front-half-contracts');
const {buildCustomAcceptanceSpec,assertCustomAcceptanceSpec}=require('../model/custom-acceptance-spec');
const {createCustomTargetStore}=require('./custom-target-store');
const RESULT_SCHEMA='libra.custom-spec-publication-result@1';
function fail(code){throw Object.assign(new Error(code),{code});}
function number(value){const result=Number(value);if(!Number.isSafeInteger(result)||result<0)fail('LIBRA_CUSTOM_SPEC_REVISION_INVALID');return result;}
function createCustomSpecPublicationStore(options){
  const targets=options.customTargetStore||createCustomTargetStore(options),coordinator=createCommandCommitCoordinator(options),
    headColumns=['subject_id','head_revision','head_digest','current_routing_decision_id','current_decision_basis_id','current_acceptance_spec_id','updated_at_ms'],
    specColumns=['acceptance_spec_id','subject_id','shelf_id','shelf_routing_projection_revision','shelf_projection_digest','shelf_standard_revision',
      'shelf_standard_digest','decision_basis_id','product_scope_digest','spec_revision','spec_schema_ref','spec_json','spec_digest','record_digest','structure_kind','content_profile','published_at_ms'],
    repository=createRepositoryDefinition({repositoryId:'libra_custom_spec_publication',owner:'libra',schemaManifest:options.schemaManifest,statements:{
      head:{kind:'select-one',tableId:'libra_subject_decision_heads',columns:headColumns,keyColumns:['subject_id']},
      spec:{kind:'select-one',tableId:'libra_acceptance_specs',columns:specColumns,keyColumns:['acceptance_spec_id']},
      maximum_revision:{kind:'select-summary',tableId:'libra_acceptance_specs',keyColumns:['subject_id'],summaries:[{operator:'max',column:'spec_revision',output:'revision'}]},
      insert_spec:{kind:'insert',tableId:'libra_acceptance_specs',columns:specColumns},
      advance_head:{kind:'update',tableId:'libra_subject_decision_heads',setColumns:['head_revision','head_digest','current_acceptance_spec_id','updated_at_ms'],
        keyColumns:['subject_id'],compareColumns:[{column:'head_revision',parameter:'expected_revision'},{column:'head_digest',parameter:'expected_digest'},
          {column:'current_acceptance_spec_id',parameter:'expected_spec_id'}]},
    }});
  function read(acceptanceSpecId){
    const row=options.unitOfWork.execute([{participantId:'custom_spec_read',owner:'libra',repositories:[repository],
      execute:context=>context.repository(repository.repositoryId).invoke('spec',{acceptance_spec_id:acceptanceSpecId})}]).custom_spec_read;
    if(!row)fail('LIBRA_CUSTOM_SPEC_NOT_FOUND');let spec;try{spec=JSON.parse(row.spec_json);}catch{fail('LIBRA_CUSTOM_SPEC_RECORD_INVALID');}
    if(!spec||typeof spec!=='object'||Array.isArray(spec)||spec.acceptanceSpecId!==row.acceptance_spec_id||spec.recordDigest!==row.record_digest||spec.specDigest!==row.spec_digest||
        spec.targetKind!=='user_custom'||spec.schemaRef!==row.spec_schema_ref||spec.subjectId!==row.subject_id||
        spec.productScope?.scopeDigest!==row.product_scope_digest||spec.specRevision!==number(row.spec_revision)||
        spec.targetShelfId!==row.shelf_id||spec.shelfRoutingProjectionRevision!==number(row.shelf_routing_projection_revision)||
        spec.shelfProjectionDigest!==row.shelf_projection_digest||spec.shelfStandardRevision!==number(row.shelf_standard_revision)||
        spec.shelfStandardDigest!==row.shelf_standard_digest||spec.decisionBasisId!==row.decision_basis_id||spec.contentProfile!==row.content_profile||
        spec.structureKind!==row.structure_kind||spec.publishedAtMs!==number(row.published_at_ms)||canonicalJson(spec)!==row.spec_json)
      fail('LIBRA_CUSTOM_SPEC_RECORD_INVALID');
    return assertCustomAcceptanceSpec({spec,...targets.intentEvidence(spec.customTargetRef?.intentId)});
  }
  return Object.freeze({read,publish({intentId,intentDigest,currentBasis,readFence,producedAtMs}){
    if(!readFence)fail('LIBRA_CUSTOM_TARGET_READ_FENCE_REQUIRED');
    let evidence;
    const validation=targets.publicationValidation({intentId,intentDigest,currentBasis},value=>{evidence=value;}),
      commandContract='libra.custom-target.spec.publish@1',commandId=canonicalDigest({schema:'libra.custom-spec-command-id@1',intentId}),
      requestDigest=canonicalDigest({schema:commandContract,intentId,intentDigest});
    return coordinator.execute({readFence,command:{commandReceiptId:commandId,ownerDomain:'libra',commandContract,
      callerScope:'libra.custom-target-resolution',idempotencyKey:intentId,requestDigest,targetType:'custom_target',targetId:intentId},
      validationParticipants:[validation],domainParticipant:{participantId:'custom_spec_publish',owner:'libra',repositories:[repository],execute(context){
        if(!evidence)fail('LIBRA_CUSTOM_SPEC_BASIS_MISSING');
        const repo=context.repository(repository.repositoryId),{intent,preview,baseSpec}=evidence,
          head=repo.invoke('head',{subject_id:intent.subjectId}),maximum=repo.invoke('maximum_revision',{subject_id:intent.subjectId}),
          specRevision=number(maximum?.revision??0n)+1;
        if(!head||!head.current_routing_decision_id||head.head_digest!==intent.basis.decisionHeadDigest||head.current_acceptance_spec_id!==intent.basis.decisionHeadAcceptanceSpecId||
            head.current_decision_basis_id!==baseSpec.decisionBasisId)fail('LIBRA_CUSTOM_TARGET_PREVIEW_STALE');
        const spec=buildCustomAcceptanceSpec({baseSpec,preview,intent,specRevision,producedAtMs,publishedAtMs:context.commitTimeMs}),
          committedHeadRevision=number(head.head_revision)+1;
        if(!Number.isSafeInteger(committedHeadRevision))fail('LIBRA_CUSTOM_SPEC_REVISION_INVALID');
        repo.invoke('insert_spec',{acceptance_spec_id:spec.acceptanceSpecId,subject_id:spec.subjectId,shelf_id:spec.targetShelfId,
          shelf_routing_projection_revision:spec.shelfRoutingProjectionRevision,shelf_projection_digest:spec.shelfProjectionDigest,
          shelf_standard_revision:spec.shelfStandardRevision,shelf_standard_digest:spec.shelfStandardDigest,decision_basis_id:spec.decisionBasisId,
          product_scope_digest:spec.productScope.scopeDigest,spec_revision:spec.specRevision,spec_schema_ref:spec.schemaRef,spec_json:canonicalJson(spec),
          spec_digest:spec.specDigest,record_digest:spec.recordDigest,structure_kind:spec.structureKind,content_profile:spec.contentProfile,published_at_ms:spec.publishedAtMs});
        if(repo.invoke('advance_head',{subject_id:spec.subjectId,head_revision:committedHeadRevision,
          head_digest:decisionHeadDigest(spec.subjectId,committedHeadRevision,head.current_routing_decision_id,head.current_decision_basis_id,spec.acceptanceSpecId),
          current_acceptance_spec_id:spec.acceptanceSpecId,updated_at_ms:context.commitTimeMs,expected_revision:number(head.head_revision),
          expected_digest:head.head_digest,expected_spec_id:head.current_acceptance_spec_id}).changes!==1)fail('LIBRA_CUSTOM_TARGET_PREVIEW_STALE');
        return {subjectId:spec.subjectId,acceptanceSpecId:spec.acceptanceSpecId,specRevision:spec.specRevision,specDigest:spec.specDigest,
          recordDigest:spec.recordDigest,customTargetRef:spec.customTargetRef,targetInputDigest:spec.targetInputDigest,committedHeadRevision};
      }},commitMarker:{commitMarker:commandId,scopeType:'custom_target',scopeId:intentId,commitDigest:requestDigest},
      auditRecords:[{auditId:commandId,actorType:'system',actorId:'libra.custom-target-resolution',action:'libra.custom_spec.publish',
        scopeType:'custom_target',scopeId:intentId,evidenceDigest:intentDigest}],
      resultEnvelope:result=>({resultSchemaRef:RESULT_SCHEMA,resultRef:result})});
  }});
}

module.exports=Object.freeze({RESULT_SCHEMA,createCustomSpecPublicationStore});
