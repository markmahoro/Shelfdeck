'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { activeRunScopeSetDigest } = require('../model/run-admission-contracts');

function createLibraRunContextReader(options) {
  if (!options?.schemaManifest || !options.unitOfWork) throw new TypeError('Libra Run Context Reader requires Libra persistence.');
  const repository = createRepositoryDefinition({
    repositoryId:'libra_run_context_reader', owner:'libra', schemaManifest:options.schemaManifest, statements:{
      find_subject:{kind:'select-one',tableId:'libra_subjects',safeIntegers:true,columns:['subject_id','structure_kind','content_profile','status',
        'intake_revision','current_continuity_set_digest','current_episode_scope_digest'],keyColumns:['subject_id']},
      find_decision_head:{kind:'select-one',tableId:'libra_subject_decision_heads',safeIntegers:true,columns:['subject_id','head_revision','head_digest',
        'current_routing_decision_id','current_decision_basis_id','current_acceptance_spec_id'],keyColumns:['subject_id']},
      find_spec:{kind:'select-one',tableId:'libra_acceptance_specs',safeIntegers:true,columns:['acceptance_spec_id','subject_id','shelf_id',
        'shelf_routing_projection_revision','shelf_projection_digest','shelf_standard_revision','shelf_standard_digest','spec_revision','spec_json',
        'spec_digest','record_digest','product_scope_digest'],keyColumns:['acceptance_spec_id']},
      list_bindings:{kind:'select-all',tableId:'libra_material_bindings',safeIntegers:true,columns:['subject_id','material_key','role','mount_scope_id',
        'inode','fingerprint_algorithm','fingerprint_version','content_fingerprint','size_bytes','endpoint_id','location','binding_revision','health_state',
        'authority_kind','primary_material_key','association_evidence_digest','disposition_basis_digest',
        'evidence_digest','origin_intake_decision_id','origin_offer_id','origin_candidate_package_id','origin_package_revision','origin_package_digest',
        'origin_candidate_delivery_snapshot_digest','origin_related_reference_set_digest','origin_related_disposition_scope_digest','current'],keyColumns:['subject_id']},
      list_binding_claims:{kind:'select-all',tableId:'libra_material_binding_episode_claims',safeIntegers:true,columns:['subject_id','material_key',
        'binding_revision','episode_key','season_claim_digest','claim_digest'],keyColumns:['subject_id']},
      find_run_head:{kind:'select-one',tableId:'libra_run_admission_heads',safeIntegers:true,columns:['subject_id','head_revision',
        'active_scope_set_digest'],keyColumns:['subject_id']},
      list_runs:{kind:'select-all',tableId:'libra_runs',safeIntegers:true,columns:['libra_run_id','subject_id','acceptance_spec_id','state',
        'state_revision','state_digest','execution_basis_digest','run_scope_digest','priority_class','priority_intent_digest'],keyColumns:['subject_id']},
      page_active_subjects:{kind:'select-page-after',tableId:'libra_subjects',keyColumn:'subject_id',fixedKeyColumns:['status'],maxItems:100,
        columns:['subject_id','status']},
    }
  });
  function exact(body){return options.unitOfWork.execute([{participantId:'libra_run_context_read',owner:'libra',repositories:[repository],
    execute:body}]).libra_run_context_read;}
  function read(subjectId){return exact((context)=>{const repo=context.repository(repository.repositoryId),subject=repo.invoke('find_subject',{subject_id:subjectId});
    if(!subject)return Object.freeze({kind:'not_found',subjectId});
    if(subject.status!=='active')return Object.freeze({kind:'not_ready',subjectId,reasonCode:'subject_not_active'});
    const head=repo.invoke('find_decision_head',{subject_id:subjectId});
    if(!head?.current_acceptance_spec_id)return Object.freeze({kind:'not_ready',subjectId,reasonCode:'acceptance_spec_unavailable'});
    const specRow=repo.invoke('find_spec',{acceptance_spec_id:head.current_acceptance_spec_id});
    if(!specRow||specRow.subject_id!==subjectId)return Object.freeze({kind:'not_ready',subjectId,reasonCode:'acceptance_spec_unavailable'});
    let spec;try{spec=JSON.parse(specRow.spec_json);}catch{throw new Error('Libra Acceptance Spec JSON is corrupt.');}
    if(spec.acceptanceSpecId!==specRow.acceptance_spec_id||spec.recordDigest!==specRow.record_digest||spec.specDigest!==specRow.spec_digest||
      spec.productScope?.scopeDigest!==specRow.product_scope_digest)throw new Error('Libra Acceptance Spec record is corrupt.');
    const bindings=repo.invoke('list_bindings',{subject_id:subjectId}).filter((row)=>Number(row.current)===1&&row.health_state==='active')
      .sort((a,b)=>Buffer.from(a.material_key).compare(Buffer.from(b.material_key)));
    const claims=repo.invoke('list_binding_claims',{subject_id:subjectId});
    const runHead=repo.invoke('find_run_head',{subject_id:subjectId}),runs=repo.invoke('list_runs',{subject_id:subjectId});
    return Object.freeze({kind:'ready',subject:Object.freeze(subject),decisionHead:Object.freeze(head),spec:Object.freeze({...spec,
      shelfId:specRow.shelf_id,productScopeDigest:specRow.product_scope_digest}),shelfProjection:Object.freeze({
        routingProjectionRevision:Number(specRow.shelf_routing_projection_revision),projectionDigest:specRow.shelf_projection_digest,
        standardRevision:Number(specRow.shelf_standard_revision),standardDigest:specRow.shelf_standard_digest}),bindings:Object.freeze(bindings),
      claims:Object.freeze(claims),runHead:runHead?Object.freeze(runHead):null,runs:Object.freeze(runs)});
  });}
  function headSnapshot(subjectId,row){return row?Object.freeze({headState:'present',headRevision:Number(row.head_revision),
    activeScopeSetDigest:row.active_scope_set_digest}):Object.freeze({headState:'absent',headRevision:0,
    activeScopeSetDigest:activeRunScopeSetDigest(subjectId,[])});}
  function decisionHeadSnapshot(subjectId,row){const value={subjectId,headState:'present',headRevision:Number(row.head_revision),headDigest:row.head_digest,
    currentRoutingDecisionId:row.current_routing_decision_id,currentDecisionBasisId:row.current_decision_basis_id,
      currentAcceptanceSpecId:row.current_acceptance_spec_id};return Object.freeze({...value,snapshotDigest:canonicalDigest({
      schema:'libra.subject-decision-head-snapshot@1',...value})});}
  function readAcceptanceSpec(acceptanceSpecId){return exact((context)=>{const row=context.repository(repository.repositoryId)
      .invoke('find_spec',{acceptance_spec_id:acceptanceSpecId});
    if(!row)return null;let spec;try{spec=JSON.parse(row.spec_json);}catch{throw new Error('Libra Acceptance Spec JSON is corrupt.');}
    if(spec.acceptanceSpecId!==row.acceptance_spec_id||spec.recordDigest!==row.record_digest||spec.specDigest!==row.spec_digest||
        spec.productScope?.scopeDigest!==row.product_scope_digest)throw new Error('Libra Acceptance Spec record is corrupt.');
    return Object.freeze({...spec,shelfId:row.shelf_id,productScopeDigest:row.product_scope_digest});});}
  function listReadySubjectPage(cursor=null,limit=100){if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new TypeError('Libra Run Subject page limit must be 1..100.');
    const rows=exact((context)=>context.repository(repository.repositoryId).invoke('page_active_subjects',{status:'active',cursor,limit}));
    const items=Object.freeze(rows.map((row)=>Object.freeze({subjectId:row.subject_id})));
    return Object.freeze({items,nextCursor:items.length===limit?items.at(-1).subjectId:null});}
  return Object.freeze({read,headSnapshot,decisionHeadSnapshot,readAcceptanceSpec,listReadySubjectPage});
}

module.exports=Object.freeze({createLibraRunContextReader});
