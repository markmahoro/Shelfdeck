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
const IDENTITY_SCHEMA='helix://contracts/types/ResolvedProductIdentity/v1';

function ownerReadRepository(schemaManifest,factKind){const statements={
  find_run:{kind:'select-one',tableId:'libra_runs',columns:['libra_run_id','subject_id','state','state_revision','state_digest'],keyColumns:['libra_run_id']},
  find_fact:{kind:'select-one',tableId:'libra_product_fact_revisions',columns:['product_fact_id','libra_run_id','fact_kind','fact_revision','schema_ref','fact_json','fact_digest','commit_marker','result_digest'],keyColumns:['libra_run_id','fact_kind','fact_revision']}
};
  if(factKind==='product_metadata')statements.find_fact_by_id={kind:'select-one',tableId:'libra_product_fact_revisions',columns:['product_fact_id','libra_run_id','fact_kind','fact_revision','schema_ref','fact_json','fact_digest','commit_marker','result_digest'],keyColumns:['product_fact_id']};
  if(factKind==='resolved_identity'){
    statements.find_subject={kind:'select-one',tableId:'libra_subjects',columns:['subject_id','structure_kind','content_profile','status','current_identity_revision'],keyColumns:['subject_id']};
    statements.find_identity={kind:'select-one',tableId:'libra_product_identity_revisions',columns:['subject_id','revision','identity_digest'],keyColumns:['subject_id','revision']};
  }
  return createRepositoryDefinition({repositoryId:'libra_product_fact_'+factKind+'_reads',owner:'libra',schemaManifest,statements});
}

function ownerWriteRepository(schemaManifest,factKind){const statements={
  insert_fact:{kind:'insert',tableId:'libra_product_fact_revisions',columns:['product_fact_id','libra_run_id','fact_kind','fact_revision','aggregate_id','schema_ref','fact_json','fact_digest','evidence_digest','source_basis_kind','source_basis_id','source_basis_digest','source_ref_count','verified_artifact_manifest_schema_ref','verified_artifact_manifest_json','verified_artifact_manifest_digest','artifact_verification_result_count','commit_payload_schema_ref','commit_payload_digest','event_fence_digest','commit_marker','result_digest','committed_at_ms']},
  insert_source:{kind:'insert',tableId:'libra_product_fact_source_refs',columns:['product_fact_id','ordinal','source_basis_kind','work_id','attempt_id','plan_id','event_id','result_id','capability_ref','result_schema_ref','result_digest','source_ref','source_order','evidence_id','evidence_digest','input_binding_digest','reference_digest']}
};
  if(factKind==='resolved_identity'){
    statements.insert_identity={kind:'insert',tableId:'libra_product_identity_revisions',columns:['subject_id','revision','structure_kind','content_profile','identity_kind','provider_identity_set_digest','exact_season_continuity_set_digest','display_identity','identity_digest','evidence_digest','committed_at_ms']};
    statements.advance_subject_identity={kind:'update',tableId:'libra_subjects',setColumns:['current_identity_revision','updated_at_ms'],keyColumns:['subject_id'],compareColumns:[{column:'current_identity_revision',parameter:'expected_identity_revision',nullSafe:true},{column:'status',parameter:'expected_status'}]};
    statements.insert_continuity_claim={kind:'insert',tableId:'libra_subject_season_continuity_claims',columns:['subject_id','claim_kind','claim_namespace','claim_key','claim_digest','provenance_kind','provenance_ref','accepted_at_ms']};
  }
  return createRepositoryDefinition({repositoryId:'libra_product_fact_'+factKind+'_writes',owner:'libra',schemaManifest,statements});
}

function foundationRepository(schemaManifest,factKind){const statements={find_work:{kind:'select-one',tableId:'fx_supporting_works',columns:['work_id','owner_domain','process_type','process_id','state'],keyColumns:['work_id']},
    find_attempt:{kind:'select-one',tableId:'fx_work_attempts',columns:['attempt_id','work_id','state'],keyColumns:['attempt_id']},
    find_plan:{kind:'select-one',tableId:'fx_workflow_plans',columns:['plan_id','attempt_id','state'],keyColumns:['plan_id']},
    find_event:{kind:'select-one',tableId:'fx_workflow_events',columns:['event_id','plan_id','node_id','work_id','attempt_id','owner_domain','capability_ref','state','result_id'],keyColumns:['event_id']},
    find_node:{kind:'select-one',tableId:'fx_plan_nodes',columns:['plan_id','node_id','capability_ref','input_bindings_json'],keyColumns:['plan_id','node_id']},
    list_event_attempts:{kind:'select-all',tableId:'fx_event_attempts',columns:['event_attempt_id','event_id','ordinal','input_snapshot_digest','state','outcome_kind'],keyColumns:['event_id'],safeIntegers:true},
    find_result:{kind:'select-one',tableId:'fx_event_result_bindings',columns:['result_id','event_id','result_schema_ref','result_json','result_digest',
      'evidence_schema_ref','evidence_json','evidence_digest'],keyColumns:['result_id']}};
  if(factKind==='product_metadata')statements.find_artifact={kind:'select-one',tableId:'fx_artifact_registry',columns:[
    'artifact_handle_id','artifact_kind','owner_domain','owner_scope_type','owner_scope_id','storage_ref','digest_algorithm','digest_hex',
    'size_bytes','media_type','provenance_ref','reference_revision','state'],keyColumns:['artifact_handle_id'],safeIntegers:true};
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
  const executionAttempt=repo.invoke('list_event_attempts',{event_id:ref.eventId})
    .filter((item)=>item.state==='completed'&&item.outcome_kind==='succeeded')
    .sort((left,right)=>Number(right.ordinal)-Number(left.ordinal))[0]||null;
  if(!executionAttempt)fail('P9_PRODUCT_FACT_EVENT_ATTEMPT_MISSING','Referenced Event lacks a successful execution Attempt.');
  const evidence=parseJson(binding.evidence_json,'P9_PRODUCT_FACT_EVIDENCE_JSON');
  if(canonicalDigest(evidence)!==binding.evidence_digest)fail('P9_PRODUCT_FACT_EVIDENCE_DIGEST','Stored Event Evidence digest is corrupt.');
  return Object.freeze({workId:work.work_id,attemptId:attempt.attempt_id,planId:plan.plan_id,eventId:event.event_id,resultId:binding.result_id,
    ownerDomain:work.owner_domain,processType:work.process_type,processId:work.process_id,workState:work.state,
    attemptState:attempt.state,planState:plan.state,eventState:event.state,eventOwnerDomain:event.owner_domain,nodeCapabilityRef:node.capability_ref,
    attemptWorkId:attempt.work_id,planAttemptId:plan.attempt_id,eventWorkId:event.work_id,eventAttemptId:event.attempt_id,
    eventPlanId:event.plan_id,eventResultId:event.result_id,capabilityRef:event.capability_ref,resultSchemaRef:binding.result_schema_ref,
    result:parseJson(binding.result_json,'P9_PRODUCT_FACT_RESULT_JSON'),resultDigest:binding.result_digest,
    evidenceSchemaRef:binding.evidence_schema_ref,evidence:Object.freeze(evidence),evidenceDigest:binding.evidence_digest,
    inputBindings:parseJson(node.input_bindings_json,'P9_PRODUCT_FACT_INPUT_JSON'),inputBindingDigest:canonicalDigest(parseJson(node.input_bindings_json,'P9_PRODUCT_FACT_INPUT_JSON')),
    executionEventAttemptId:executionAttempt.event_attempt_id,inputSnapshotDigest:executionAttempt.input_snapshot_digest});}

function basisRunId(payload){return payload.sourceBasis?.libraRunId||payload.sourceBasis?.selection?.libraRunId||payload.sourceBasis?.westernBasis?.libraRunId||
  payload.verifiedArtifactManifest?.libraRunId;}
function basisId(sourceBasis){return sourceBasis.decisionEvidenceId||sourceBasis.selection?.selectionId||sourceBasis.westernBasis?.basisId;}
function sourceResultRefs(sourceBasis){
  if(sourceBasis?.sourceBasisKind==='decision_evidence')return sourceBasis.resolutionRef?[sourceBasis.resolutionRef]:[];
  if(sourceBasis?.sourceBasisKind==='metadata_observation')return sourceBasis.selection?.items||[];
  if(sourceBasis?.sourceBasisKind==='western_analysis')return [...(sourceBasis.westernBasis?.analysisRefs||[]),sourceBasis.westernBasis?.normalizeRef].filter(Boolean);
  if(sourceBasis?.sourceBasisKind==='western_match')return sourceBasis.westernBasis?.matchRef?[sourceBasis.westernBasis.matchRef]:[];
  return [];
}

function registration(options,factKind,factSchemaRef){const ownerRead=options.ownerRead,ownerWrite=options.ownerWrite,foundation=options.foundation;
  return {ownerDomain:'libra',aggregateType:'libra_product_fact',factType:factKind,factSchemaRef,effectClass:'domain_fact_commit',revisionFence:true,
    createParticipant({handle,payload,commitMarker}){let sourceChains=[],verificationBindings=[],artifactSnapshots=[],fact,productFactId,sourceRefs,subjectIdentityRevision=null,expectedSubjectIdentityRevision=null,subjectSnapshot=null;
      if(factKind==='product_metadata'&&!Object.hasOwn(payload,'mediaCastFactRef'))
        fail('P9_PRODUCT_METADATA_CAST_REF','Product Metadata commit must explicitly carry nullable mediaCastFactRef.');
      const refs=sourceResultRefs(payload.sourceBasis),verificationRefs=factKind==='product_metadata'
        ? [...new Map((payload.verifiedArtifactManifest?.items||[]).map((item)=>[item.verificationResultRef.resultId,item.verificationResultRef])).values()]:[];
      const readParticipant={participantId:'libra_product_fact_exact_reads',owner:'execution-foundation',boundBusinessOwner:'libra',repositories:[foundation],execute(context){const repo=context.repository(foundation.repositoryId);
        sourceChains=refs.map((ref)=>readChain(repo,ref));verificationBindings=verificationRefs.map((ref)=>readChain(repo,ref));
        if(factKind==='product_metadata')artifactSnapshots=(payload.verifiedArtifactManifest.items||[]).map((item)=>{const row=repo.invoke('find_artifact',{artifact_handle_id:item.artifactHandleId});
          if(!row)fail('P9_PRODUCT_FACT_ARTIFACT_MISSING','Referenced Artifact is absent.');let provenanceRef;
          try{provenanceRef=JSON.parse(row.provenance_ref);}catch{fail('P9_PRODUCT_FACT_ARTIFACT_PROVENANCE','Referenced Artifact provenance is corrupt.');}
          return {schemaRef:'helix://contracts/types/ArtifactHandle/v1',schemaVersion:1,artifactHandleId:row.artifact_handle_id,
            artifactKind:row.artifact_kind,ownerDomain:row.owner_domain,ownerScope:{scopeType:row.owner_scope_type,scopeId:row.owner_scope_id},
            storageRef:row.storage_ref,digestAlgorithm:row.digest_algorithm,digestHex:row.digest_hex,sizeBytes:Number(row.size_bytes),
            mediaType:row.media_type,provenanceRef,referenceRevision:Number(row.reference_revision),state:row.state};});}};
      const prepare={participantId:'libra_product_fact_prepare',owner:'libra',boundBusinessOwner:'libra',repositories:[ownerRead],execute(context){const repo=context.repository(ownerRead.repositoryId),run=repo.invoke('find_run',{libra_run_id:basisRunId(payload)});
        if(!run||!['active','suspended'].includes(run.state))fail('P9_PRODUCT_FACT_RUN_FENCE','Product Fact Run is absent or not eligible.');
        const expected=buildProductFactHandle({libraRunId:run.libra_run_id,factKind,expectedRevision:handle.expectedRevision,payloadDigest:handle.payloadDigest,eventFenceDigest:handle.eventFenceDigest});
        if(canonicalJson(expected)!==canonicalJson(handle))fail('P9_PRODUCT_FACT_HANDLE_FENCE','Product Fact Handle identity is invalid.');
        const prior=handle.expectedRevision===0?null:repo.invoke('find_fact',{libra_run_id:run.libra_run_id,fact_kind:factKind,fact_revision:handle.expectedRevision});
        const next=repo.invoke('find_fact',{libra_run_id:run.libra_run_id,fact_kind:factKind,fact_revision:handle.expectedRevision+1});
        if((handle.expectedRevision===0&&prior)||(handle.expectedRevision>0&&!prior)||next)fail('P9_PRODUCT_FACT_REVISION_FENCE','Product Fact revision fence failed.');
        productFactId=canonicalDigest({schema:'libra.product-fact-id@1',libraRunId:run.libra_run_id,
          factKind,factRevision:handle.expectedRevision+1});
        sourceRefs=buildProductFactSourceRefs({sourceBasis:payload.sourceBasis,foundationChains:sourceChains,productFactId,
          productMetadataDraft:payload.productMetadataDraft,mediaCastDraft:payload.mediaCastDraft,
          resolvedProductIdentity:payload.resolvedProductIdentity});
        if(factKind==='media_cast')fact=buildMediaCastFact({libraRunId:run.libra_run_id,subjectId:run.subject_id,sourceBasis:payload.sourceBasis,
          mediaCastDraft:payload.mediaCastDraft,expectedRevision:handle.expectedRevision,commitMarker,committedAtMs:context.commitTimeMs});
        else if(factKind==='product_metadata'){const manifest=validateVerifiedArtifactManifest(payload.verifiedArtifactManifest,{artifactSnapshots,
          artifactRequirements:payload.productMetadataDraft.artifactRequirements,verificationBindings});
          const mediaCastFactRef=validateMediaCastFactReference(repo,payload.mediaCastFactRef,run);
          fact=buildProductMetadataFact({libraRunId:run.libra_run_id,subjectId:run.subject_id,sourceBasis:payload.sourceBasis,
            productMetadataDraft:payload.productMetadataDraft,verifiedArtifactManifest:manifest,mediaCastFactRef,
            expectedRevision:handle.expectedRevision,commitMarker,committedAtMs:context.commitTimeMs});}
        else {
          if (!payload.resolvedProductIdentity ||
              payload.resolvedProductIdentity.subjectId !== run.subject_id ||
              payload.resolvedProductIdentity.basisDigest !== payload.sourceBasis.sourceBasisDigest) {
            fail('P9_RESOLVED_IDENTITY_INPUT',
              'Resolved Product Identity must bind the exact same-Run Source Basis.');
          }
          fact = payload.resolvedProductIdentity;
          subjectSnapshot=repo.invoke('find_subject',{subject_id:run.subject_id});
          if(!subjectSnapshot||subjectSnapshot.status!=='active'||subjectSnapshot.structure_kind!==fact.structureKind||
              subjectSnapshot.content_profile!==fact.contentProfile)
            fail('P9_RESOLVED_IDENTITY_SUBJECT_FENCE','Resolved Identity Subject scope is stale.');
          expectedSubjectIdentityRevision=subjectSnapshot.current_identity_revision===null?null:Number(subjectSnapshot.current_identity_revision);
          subjectIdentityRevision=(expectedSubjectIdentityRevision||0)+1;
          if(repo.invoke('find_identity',{subject_id:run.subject_id,revision:subjectIdentityRevision}))
            fail('P9_RESOLVED_IDENTITY_REVISION_FENCE','Subject Product Identity revision already exists.');
        }
        return fact;
      },
    };
      prepare.readParticipants=[readParticipant];prepare.postMarkerParticipants=[{participantId:'libra_product_fact_owner_write',owner:'libra',boundBusinessOwner:'libra',repositories:[ownerWrite],execute(context){const repo=context.repository(ownerWrite.repositoryId),manifest=factKind==='product_metadata'?payload.verifiedArtifactManifest:null;
        const libraRunId=basisRunId(payload),factRevision=handle.expectedRevision+1,evidenceDigest=buildProductFactEvidence({libraRunId,factKind,factRevision,
          sourceBasisKind:payload.sourceBasis.sourceBasisKind,sourceBasisDigest:payload.sourceBasis.sourceBasisDigest,commitPayloadDigest:handle.payloadDigest,eventFenceDigest:handle.eventFenceDigest});
        repo.invoke('insert_fact',{product_fact_id:productFactId,libra_run_id:libraRunId,fact_kind:factKind,
          fact_revision:factRevision,aggregate_id:handle.aggregateId,schema_ref:fact.schemaRef,fact_json:canonicalJson(fact),
          fact_digest:factKind==='resolved_identity'?fact.identityDigest:fact.factDigest,evidence_digest:evidenceDigest,
          source_basis_kind:payload.sourceBasis.sourceBasisKind,source_basis_id:basisId(payload.sourceBasis),source_basis_digest:payload.sourceBasis.sourceBasisDigest,
          source_ref_count:sourceRefs.length,verified_artifact_manifest_schema_ref:manifest?'helix://contracts/domain-types/VerifiedArtifactManifest/v1':null,
          verified_artifact_manifest_json:manifest?canonicalJson(manifest):null,verified_artifact_manifest_digest:manifest?manifest.manifestDigest:null,
          artifact_verification_result_count:manifest?new Set(manifest.items.map((item)=>item.verificationResultRef.resultId)).size:0,
          commit_payload_schema_ref:factKind==='media_cast'?'libra.media-cast-fact-commit-payload@1':
            factKind==='product_metadata'?'libra.product-metadata-fact-commit-payload@1':
              'libra.resolved-product-identity-commit-payload@1',
          commit_payload_digest:handle.payloadDigest,event_fence_digest:handle.eventFenceDigest,commit_marker:commitMarker,result_digest:canonicalDigest(fact),committed_at_ms:context.commitTimeMs});
        if(factKind==='resolved_identity'){
          repo.invoke('insert_identity',{subject_id:fact.subjectId,revision:subjectIdentityRevision,structure_kind:fact.structureKind,
            content_profile:fact.contentProfile,identity_kind:fact.identityKind,provider_identity_set_digest:fact.providerIdentitySetDigest,
            exact_season_continuity_set_digest:fact.exactSeasonContinuitySetDigest,display_identity:canonicalJson(fact.displayIdentity),
            identity_digest:fact.identityDigest,evidence_digest:fact.payloadDigest,committed_at_ms:context.commitTimeMs});
          const provenanceRef=fact.subjectId+':'+subjectIdentityRevision;
          for(const claim of fact.exactSeasonContinuityClaims||[])repo.invoke('insert_continuity_claim',{subject_id:fact.subjectId,
            claim_kind:claim.claimKind,claim_namespace:claim.claimNamespace,claim_key:claim.claimKey,claim_digest:claim.claimDigest,
            provenance_kind:'resolved_identity',provenance_ref:provenanceRef,accepted_at_ms:context.commitTimeMs});
          if(repo.invoke('advance_subject_identity',{current_identity_revision:subjectIdentityRevision,updated_at_ms:context.commitTimeMs,
            subject_id:fact.subjectId,expected_identity_revision:expectedSubjectIdentityRevision,expected_status:'active'}).changes!==1)
            fail('P9_RESOLVED_IDENTITY_SUBJECT_CAS','Subject Product Identity pointer CAS failed.');
        }
        for(const item of sourceRefs)repo.invoke('insert_source',{product_fact_id:item.productFactId,ordinal:item.ordinal,source_basis_kind:item.sourceBasisKind,work_id:item.workId,
          attempt_id:item.attemptId,plan_id:item.planId,event_id:item.eventId,result_id:item.resultId,capability_ref:item.capabilityRef,result_schema_ref:item.resultSchemaRef,
          result_digest:item.resultDigest,source_ref:item.sourceRef,source_order:item.sourceOrder,evidence_id:item.evidenceId,evidence_digest:item.evidenceDigest,
          input_binding_digest:item.inputBindingDigest,reference_digest:item.referenceDigest});}}];return prepare;}};}

function createProductFactRegistrations(options){if(!options?.schemaManifest)fail('P9_PRODUCT_FACT_STORE_DEPENDENCIES','Schema manifest is required.');
  const build=(factKind,factSchemaRef)=>registration({ownerRead:ownerReadRepository(options.schemaManifest,factKind),
    ownerWrite:ownerWriteRepository(options.schemaManifest,factKind),foundation:foundationRepository(options.schemaManifest,factKind)},factKind,factSchemaRef);
  return Object.freeze([build('media_cast',MEDIA_SCHEMA),build('product_metadata',METADATA_SCHEMA),build('resolved_identity',IDENTITY_SCHEMA)]);}

module.exports=Object.freeze({IDENTITY_SCHEMA,MEDIA_SCHEMA,METADATA_SCHEMA,ProductFactStoreError,createProductFactRegistrations});
