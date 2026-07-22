'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { buildMediaCastFact, buildProductFactEvidence, buildProductFactHandle, buildProductFactSourceRefs,
  buildProductMetadataFact, validateVerifiedArtifactManifest } = require('../model/product-fact-contracts');

class ProductFactStoreError extends Error {
  constructor(code,message){super(message);this.name='ProductFactStoreError';this.code=code;}
}
const fail=(code,message)=>{throw new ProductFactStoreError(code,message);};
const MEDIA_SCHEMA='helix://contracts/types/MediaCastFact/v1';
const METADATA_SCHEMA='helix://contracts/types/ProductMetadataFact/v1';

function ownerReadRepository(schemaManifest){return createRepositoryDefinition({repositoryId:'libra_product_fact_reads',owner:'libra',schemaManifest,
  statements:{find_run:{kind:'select-one',tableId:'libra_runs',columns:['libra_run_id','subject_id','state','state_revision','state_digest'],keyColumns:['libra_run_id']},
    find_fact:{kind:'select-one',tableId:'libra_product_fact_revisions',columns:['product_fact_id','libra_run_id','fact_kind','fact_revision','schema_ref','fact_json','fact_digest','commit_marker','result_digest'],keyColumns:['libra_run_id','fact_kind','fact_revision']},
    find_fact_by_id:{kind:'select-one',tableId:'libra_product_fact_revisions',columns:['product_fact_id','libra_run_id','fact_kind','fact_revision','schema_ref','fact_json','fact_digest','commit_marker','result_digest'],keyColumns:['product_fact_id']}}});}

function ownerWriteRepository(schemaManifest){return createRepositoryDefinition({repositoryId:'libra_product_fact_writes',owner:'libra',schemaManifest,
  statements:{insert_fact:{kind:'insert',tableId:'libra_product_fact_revisions',columns:['product_fact_id','libra_run_id','fact_kind','fact_revision','aggregate_id','schema_ref','fact_json','fact_digest','evidence_digest','source_basis_kind','source_basis_id','source_basis_digest','source_ref_count','verified_artifact_manifest_schema_ref','verified_artifact_manifest_json','verified_artifact_manifest_digest','artifact_verification_result_count','commit_payload_schema_ref','commit_payload_digest','event_fence_digest','commit_marker','result_digest','committed_at_ms']},
    insert_source:{kind:'insert',tableId:'libra_product_fact_source_refs',columns:['product_fact_id','ordinal','source_basis_kind','work_id','attempt_id','plan_id','event_id','result_id','capability_ref','result_schema_ref','result_digest','source_ref','source_order','evidence_id','evidence_digest','input_binding_digest','reference_digest']}}});}

function foundationRepository(schemaManifest,factKind){const statements={find_work:{kind:'select-one',tableId:'fx_supporting_works',columns:['work_id','owner_domain','process_type','process_id','state'],keyColumns:['work_id']},
    find_attempt:{kind:'select-one',tableId:'fx_work_attempts',columns:['attempt_id','work_id','state'],keyColumns:['attempt_id']},
    find_plan:{kind:'select-one',tableId:'fx_workflow_plans',columns:['plan_id','attempt_id','state'],keyColumns:['plan_id']},
    find_event:{kind:'select-one',tableId:'fx_workflow_events',columns:['event_id','plan_id','node_id','work_id','attempt_id','owner_domain','capability_ref','state','result_id'],keyColumns:['event_id']},
    find_node:{kind:'select-one',tableId:'fx_plan_nodes',columns:['plan_id','node_id','capability_ref','input_bindings_json'],keyColumns:['plan_id','node_id']},
    find_result:{kind:'select-one',tableId:'fx_event_result_bindings',columns:['result_id','event_id','result_schema_ref','result_json','result_digest','evidence_digest'],keyColumns:['result_id']}};
  if(factKind==='product_metadata')statements.find_artifact={kind:'select-one',tableId:'fx_artifact_registry',columns:['artifact_handle_id','artifact_kind','digest_algorithm','digest_hex','reference_revision','state'],keyColumns:['artifact_handle_id']};
  return createRepositoryDefinition({repositoryId:'libra_product_fact_foundation_reads',owner:'execution-foundation',schemaManifest,statements});}

function parseJson(value,code){try{return JSON.parse(value);}catch{fail(code,'Stored typed JSON is invalid.');}}

function validateMediaCastFactReference(repo,ref,run){
  if(ref===null)return null;
  if(!ref||Object.keys(ref).sort().join('|')!=='factDigest|factRevision|productFactId')
    fail('P9_PRODUCT_METADATA_CAST_REF','Media Cast Fact reference is invalid.');
  const row=repo.invoke('find_fact_by_id',{product_fact_id:ref.productFactId});
  if(!row)fail('P9_PRODUCT_METADATA_CAST_REF_MISSING','Referenced Media Cast Fact is absent.');
  const fact=parseJson(row.fact_json,'P9_PRODUCT_METADATA_CAST_REF_JSON'),relations=Array.isArray(fact.relations)?fact.relations:null;
  const relationsDigest=relations&&canonicalDigest({schema:'libra.media-cast-relations@1',relations});
  const factDigest=relations&&canonicalDigest({schema:'libra.media-cast-fact@1',subjectId:fact.subjectId,
    sourceBasisKind:fact.sourceBasisKind,sourceBasisDigest:fact.sourceBasisDigest,relations,
    relationsDigest,relationCount:relations.length});
  const aggregateId=canonicalDigest({schema:'libra.product-fact-aggregate-id@1',libraRunId:run.libra_run_id,factKind:'media_cast'});
  const factId=canonicalDigest({schema:'libra.product-fact-id@1',libraRunId:run.libra_run_id,
    factKind:'media_cast',factRevision:ref.factRevision});
  if(row.product_fact_id!==ref.productFactId||row.libra_run_id!==run.libra_run_id||row.fact_kind!=='media_cast'||
      Number(row.fact_revision)!==ref.factRevision||row.schema_ref!==MEDIA_SCHEMA||row.fact_digest!==ref.factDigest||
      fact.schemaRef!==MEDIA_SCHEMA||fact.schemaVersion!==1||fact.factSchemaRef!==MEDIA_SCHEMA||fact.factId!==factId||
      fact.ownerDomain!=='libra'||fact.aggregateType!=='libra_product_fact'||fact.aggregateId!==aggregateId||
      fact.revision!==ref.factRevision||fact.subjectId!==run.subject_id||fact.commitMarker!==row.commit_marker||
      fact.relationsDigest!==relationsDigest||fact.relationCount!==(relations&&relations.length)||
      fact.factDigest!==factDigest||fact.factDigest!==ref.factDigest||canonicalDigest(fact)!==row.result_digest)
    fail('P9_PRODUCT_METADATA_CAST_REF_MISMATCH','Referenced Media Cast Fact does not match the exact same-Run immutable Fact.');
  return Object.freeze({productFactId:ref.productFactId,factRevision:ref.factRevision,factDigest:ref.factDigest});
}

function readChain(repo,ref){const work=repo.invoke('find_work',{work_id:ref.workId}),attempt=repo.invoke('find_attempt',{attempt_id:ref.attemptId}),
  plan=repo.invoke('find_plan',{plan_id:ref.planId}),event=repo.invoke('find_event',{event_id:ref.eventId});
  if(!event)fail('P9_PRODUCT_FACT_EVENT_MISSING','Referenced Event is absent.');
  const node=repo.invoke('find_node',{plan_id:ref.planId,node_id:event.node_id}),binding=repo.invoke('find_result',{result_id:ref.resultId});
  if(!work||!attempt||!plan||!node||!binding)fail('P9_PRODUCT_FACT_CHAIN_MISSING','Referenced Work chain is incomplete.');
  return Object.freeze({workId:work.work_id,attemptId:attempt.attempt_id,planId:plan.plan_id,eventId:event.event_id,resultId:binding.result_id,
    ownerDomain:work.owner_domain,processType:work.process_type,processId:work.process_id,workState:work.state,
    attemptState:attempt.state,planState:plan.state,eventState:event.state,eventOwnerDomain:event.owner_domain,nodeCapabilityRef:node.capability_ref,
    attemptWorkId:attempt.work_id,planAttemptId:plan.attempt_id,eventWorkId:event.work_id,eventAttemptId:event.attempt_id,
    eventPlanId:event.plan_id,eventResultId:event.result_id,capabilityRef:event.capability_ref,resultSchemaRef:binding.result_schema_ref,
    result:parseJson(binding.result_json,'P9_PRODUCT_FACT_RESULT_JSON'),resultDigest:binding.result_digest,evidenceDigest:binding.evidence_digest,
    inputBindings:parseJson(node.input_bindings_json,'P9_PRODUCT_FACT_INPUT_JSON'),inputBindingDigest:canonicalDigest(parseJson(node.input_bindings_json,'P9_PRODUCT_FACT_INPUT_JSON'))});}

function registration(options,factKind,factSchemaRef){const ownerRead=options.ownerRead,ownerWrite=options.ownerWrite,foundation=options.foundation;
  return {ownerDomain:'libra',aggregateType:'libra_product_fact',factType:factKind,factSchemaRef,effectClass:'domain_fact_commit',revisionFence:true,
    createParticipant({handle,payload,commitMarker}){let sourceChains=[],verificationBindings=[],artifactSnapshots=[],fact,sourceRefs;
      if(factKind==='product_metadata'&&!Object.hasOwn(payload,'mediaCastFactRef'))
        fail('P9_PRODUCT_METADATA_CAST_REF','Product Metadata commit must explicitly carry nullable mediaCastFactRef.');
      const refs=payload.sourceBasis?.selection?.items||[],verificationRefs=factKind==='product_metadata'
        ? [...new Map((payload.verifiedArtifactManifest?.items||[]).map((item)=>[item.verificationResultRef.resultId,item.verificationResultRef])).values()]:[];
      const readParticipant={participantId:'libra_product_fact_exact_reads',owner:'execution-foundation',boundBusinessOwner:'libra',repositories:[foundation],execute(context){const repo=context.repository(foundation.repositoryId);
        sourceChains=refs.map((ref)=>readChain(repo,ref));verificationBindings=verificationRefs.map((ref)=>readChain(repo,ref));
        if(factKind==='product_metadata')artifactSnapshots=(payload.verifiedArtifactManifest.items||[]).map((item)=>{const row=repo.invoke('find_artifact',{artifact_handle_id:item.artifactHandleId});
          if(!row)fail('P9_PRODUCT_FACT_ARTIFACT_MISSING','Referenced Artifact is absent.');return {artifactHandleId:row.artifact_handle_id,artifactKind:row.artifact_kind,
            digestAlgorithm:row.digest_algorithm,digestHex:row.digest_hex,referenceRevision:Number(row.reference_revision),state:row.state};});}};
      const prepare={participantId:'libra_product_fact_prepare',owner:'libra',boundBusinessOwner:'libra',repositories:[ownerRead],execute(context){const repo=context.repository(ownerRead.repositoryId),run=repo.invoke('find_run',{libra_run_id:payload.sourceBasis?.selection?.libraRunId||payload.verifiedArtifactManifest?.libraRunId});
        if(!run||!['active','suspended'].includes(run.state))fail('P9_PRODUCT_FACT_RUN_FENCE','Product Fact Run is absent or not eligible.');
        const expected=buildProductFactHandle({libraRunId:run.libra_run_id,factKind,expectedRevision:handle.expectedRevision,payloadDigest:handle.payloadDigest,eventFenceDigest:handle.eventFenceDigest});
        if(canonicalJson(expected)!==canonicalJson(handle))fail('P9_PRODUCT_FACT_HANDLE_FENCE','Product Fact Handle identity is invalid.');
        const prior=handle.expectedRevision===0?null:repo.invoke('find_fact',{libra_run_id:run.libra_run_id,fact_kind:factKind,fact_revision:handle.expectedRevision});
        const next=repo.invoke('find_fact',{libra_run_id:run.libra_run_id,fact_kind:factKind,fact_revision:handle.expectedRevision+1});
        if((handle.expectedRevision===0&&prior)||(handle.expectedRevision>0&&!prior)||next)fail('P9_PRODUCT_FACT_REVISION_FENCE','Product Fact revision fence failed.');
        sourceRefs=buildProductFactSourceRefs({sourceBasis:payload.sourceBasis,foundationChains:sourceChains});
        if(factKind==='media_cast')fact=buildMediaCastFact({libraRunId:run.libra_run_id,subjectId:run.subject_id,sourceBasis:payload.sourceBasis,
          mediaCastDraft:payload.mediaCastDraft,expectedRevision:handle.expectedRevision,commitMarker,committedAtMs:context.commitTimeMs});
        else{const manifest=validateVerifiedArtifactManifest(payload.verifiedArtifactManifest,{artifactSnapshots,
          artifactRequirements:payload.productMetadataDraft.artifactRequirements,verificationBindings});
          const mediaCastFactRef=validateMediaCastFactReference(repo,payload.mediaCastFactRef,run);
          fact=buildProductMetadataFact({libraRunId:run.libra_run_id,subjectId:run.subject_id,sourceBasis:payload.sourceBasis,
            productMetadataDraft:payload.productMetadataDraft,verifiedArtifactManifest:manifest,mediaCastFactRef,
            expectedRevision:handle.expectedRevision,commitMarker,committedAtMs:context.commitTimeMs});}
        return fact;}};
      prepare.readParticipants=[readParticipant];prepare.postMarkerParticipants=[{participantId:'libra_product_fact_owner_write',owner:'libra',boundBusinessOwner:'libra',repositories:[ownerWrite],execute(context){const repo=context.repository(ownerWrite.repositoryId),manifest=factKind==='product_metadata'?payload.verifiedArtifactManifest:null;
        const evidenceDigest=buildProductFactEvidence({libraRunId:factKind==='product_metadata'?manifest.libraRunId:payload.sourceBasis.selection.libraRunId,factKind,factRevision:fact.revision,
          sourceBasisKind:payload.sourceBasis.sourceBasisKind,sourceBasisDigest:payload.sourceBasis.sourceBasisDigest,commitPayloadDigest:handle.payloadDigest,eventFenceDigest:handle.eventFenceDigest});
        repo.invoke('insert_fact',{product_fact_id:fact.factId,libra_run_id:factKind==='product_metadata'?manifest.libraRunId:payload.sourceBasis.selection.libraRunId,fact_kind:factKind,
          fact_revision:fact.revision,aggregate_id:fact.aggregateId,schema_ref:fact.schemaRef,fact_json:canonicalJson(fact),fact_digest:fact.factDigest,evidence_digest:evidenceDigest,
          source_basis_kind:payload.sourceBasis.sourceBasisKind,source_basis_id:payload.sourceBasis.selection.selectionId,source_basis_digest:payload.sourceBasis.sourceBasisDigest,
          source_ref_count:sourceRefs.length,verified_artifact_manifest_schema_ref:manifest?'helix://contracts/domain-types/VerifiedArtifactManifest/v1':null,
          verified_artifact_manifest_json:manifest?canonicalJson(manifest):null,verified_artifact_manifest_digest:manifest?manifest.manifestDigest:null,
          artifact_verification_result_count:manifest?new Set(manifest.items.map((item)=>item.verificationResultRef.resultId)).size:0,
          commit_payload_schema_ref:factKind==='media_cast'?'libra.media-cast-fact-commit-payload@1':'libra.product-metadata-fact-commit-payload@1',
          commit_payload_digest:handle.payloadDigest,event_fence_digest:handle.eventFenceDigest,commit_marker:commitMarker,result_digest:canonicalDigest(fact),committed_at_ms:context.commitTimeMs});
        for(const item of sourceRefs)repo.invoke('insert_source',{product_fact_id:item.productFactId,ordinal:item.ordinal,source_basis_kind:item.sourceBasisKind,work_id:item.workId,
          attempt_id:item.attemptId,plan_id:item.planId,event_id:item.eventId,result_id:item.resultId,capability_ref:item.capabilityRef,result_schema_ref:item.resultSchemaRef,
          result_digest:item.resultDigest,source_ref:item.sourceRef,source_order:item.sourceOrder,evidence_id:item.evidenceId,evidence_digest:item.evidenceDigest,
          input_binding_digest:item.inputBindingDigest,reference_digest:item.referenceDigest});}}];return prepare;}};}

function createProductFactRegistrations(options){if(!options?.schemaManifest)fail('P9_PRODUCT_FACT_STORE_DEPENDENCIES','Schema manifest is required.');
  const ownerRead=ownerReadRepository(options.schemaManifest),ownerWrite=ownerWriteRepository(options.schemaManifest);
  return Object.freeze([registration({ownerRead,ownerWrite,foundation:foundationRepository(options.schemaManifest,'media_cast')},'media_cast',MEDIA_SCHEMA),
    registration({ownerRead,ownerWrite,foundation:foundationRepository(options.schemaManifest,'product_metadata')},'product_metadata',METADATA_SCHEMA)]);}

module.exports=Object.freeze({MEDIA_SCHEMA,METADATA_SCHEMA,ProductFactStoreError,createProductFactRegistrations});
