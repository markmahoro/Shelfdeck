'use strict';
const {acceptedFactDigest}=require('../../../contracts/related-primary-mappings');
const { readStoredMetadataValue } = require('../../../contracts/episode-metadata-records');
const {statements:targetBindingStatements,exactSourceTargetBinding}=require('./shelf-target-binding');
const {statement:personEvidenceOriginStatement,evidenceInventoryRevision}=require('./person-evidence-origin');
const { readCareObjective } = require('../model/care-objective');
const { createArcaDefectAdmissionStore } = require('./defect-admission-store');

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { appendInventoryRevision } = require('./inventory-revision-writer');
const { createPersonRecordRefreshStore } = require('./person-record-refresh-store');
const { createInventoryRecordRefreshStore } = require('./inventory-record-refresh-store');
const { createCareWorkStore } = require('./care-work-store');
const { createAftercareWorkspaceStore } = require('./aftercare-workspace-store');
const inventoryContextStatements=require('./inventory-context-statements');
const {assertNoJavCorrection,currentJavCorrectionGate}=require('./jav-correction-gate');
const { assertProcessingRequirement, aftercareSettlementApprovalId, aftercareInventoryCommitId,
  aftercareInventoryCommitDigest } = require('../model/aftercare-contract');

class AftercareStoreError extends Error {
  constructor(code, message) { super(message); this.name = 'AftercareStoreError'; this.code = code; }
}
const fail = (code, message) => { throw new AftercareStoreError(code, message); };

function createAftercareStore(options) {
  if (!options?.schemaManifest || !options.unitOfWork) throw new TypeError('Aftercare Store requires clean persistence dependencies.');
  const now = options.now || Date.now;
  const caseCapacity = options.aftercareCaseCapacity ?? 1;
  if (!Number.isSafeInteger(caseCapacity) || caseCapacity < 1 || caseCapacity > 8) {
    throw new TypeError('Aftercare Case capacity must be between 1 and 8.');
  }
  const workspaceStore=createAftercareWorkspaceStore(options);
  const defectStore=createArcaDefectAdmissionStore(options);
  const arca = createRepositoryDefinition({ repositoryId:'arca_aftercare_store', owner:'arca', schemaManifest:options.schemaManifest, statements:{
    ...inventoryContextStatements,
    list_source_target_bindings:targetBindingStatements.list_source_target_bindings,
    find_person_evidence_origin:personEvidenceOriginStatement,
    list_entries:{kind:'select-all',tableId:'arca_shelf_entries',columns:['shelf_entry_id','shelf_id','structure_kind','status','canonical_identity_revision','canonical_identity_key','current_inventory_revision','current_deck_fact_revision','created_at_ms','terminal_at_ms'],keyColumns:[],safeIntegers:true},
    find_entries:{kind:'select-in',tableId:'arca_shelf_entries',keyColumn:'shelf_entry_id',maxItems:500,columns:['shelf_entry_id','shelf_id','structure_kind','status','canonical_identity_revision','canonical_identity_key','current_inventory_revision','current_deck_fact_revision','created_at_ms','terminal_at_ms'],safeIntegers:true},
    page_active_entries:{kind:'select-range',tableId:'arca_shelf_entries',keyColumn:'shelf_entry_id',fixedKeyColumns:['status'],maxItems:500,columns:['shelf_entry_id'],safeIntegers:true},
    list_shelves:{kind:'select-all',tableId:'arca_shelves',columns:['shelf_id','name','target_endpoint_id','target_root_location','target_mount_scope_id','target_mount_scope_revision','status','current_standard_revision','current_placement_revision','updated_at_ms'],keyColumns:[],safeIntegers:true},
    find_shelves:{kind:'select-in',tableId:'arca_shelves',keyColumn:'shelf_id',maxItems:500,columns:['shelf_id','name','target_endpoint_id','target_root_location','target_mount_scope_id','target_mount_scope_revision','status','current_standard_revision','current_placement_revision','updated_at_ms'],safeIntegers:true},
    list_all_standards:{kind:'select-all',tableId:'arca_shelf_standard_revisions',columns:['shelf_id','revision','standard_schema_ref','standard_json','standard_digest','effective_at_ms'],keyColumns:[],safeIntegers:true},
    find_standards:{kind:'select-in',tableId:'arca_shelf_standard_revisions',keyColumn:'shelf_id',maxItems:500,columns:['shelf_id','revision','standard_schema_ref','standard_json','standard_digest','effective_at_ms'],safeIntegers:true},
    list_all_identities:{kind:'select-all',tableId:'arca_canonical_identity_revisions',columns:['shelf_entry_id','revision','identity_kind','provider','provider_key','identity_digest','committed_at_ms'],keyColumns:[],safeIntegers:true},
    find_identities:{kind:'select-in',tableId:'arca_canonical_identity_revisions',keyColumn:'shelf_entry_id',maxItems:500,columns:['shelf_entry_id','revision','identity_kind','provider','provider_key','identity_digest','committed_at_ms'],safeIntegers:true},
    find_ondeck_commits:{kind:'select-in',tableId:'arca_ondeck_commit_receipts',keyColumn:'shelf_entry_id',maxItems:500,columns:['shelf_entry_id','on_deck_run_id','inventory_revision','deck_fact_revision'],safeIntegers:true},
    find_deck_fact:{kind:'select-one',tableId:'arca_deck_fact_revisions',columns:['shelf_entry_id','revision','standard_revision'],keyColumns:['shelf_entry_id','revision'],safeIntegers:true},
    find_deck_facts:{kind:'select-in',tableId:'arca_deck_fact_revisions',keyColumn:'shelf_entry_id',maxItems:500,columns:['shelf_entry_id','revision','standard_revision'],safeIntegers:true},
    find_material_roles:{kind:'select-in',tableId:'arca_inventory_materials',keyColumn:'shelf_entry_id',fixedKeyColumns:['inventory_revision'],maxItems:500,columns:['shelf_entry_id','inventory_revision','role'],safeIntegers:true},
    find_accepted_custody:{kind:'select-one',tableId:'arca_ondeck_custodies',columns:['custody_id','on_deck_package_id','package_digest'],keyColumns:['custody_id'],safeIntegers:true},
    find_accepted_custodies:{kind:'select-in',tableId:'arca_ondeck_custodies',keyColumn:'custody_id',maxItems:500,columns:['custody_id','on_deck_package_id','package_digest'],safeIntegers:true},
    find_ondeck_runs:{kind:'select-in',tableId:'arca_ondeck_runs',keyColumn:'on_deck_run_id',maxItems:500,columns:['on_deck_run_id','custody_id'],safeIntegers:true},
    find_ondeck_run:{kind:'select-one',tableId:'arca_ondeck_runs',columns:['on_deck_run_id','custody_id','final_inventory_decision_digest','state','created_at_ms','terminal_at_ms'],keyColumns:['on_deck_run_id'],safeIntegers:true},
    list_custody_bindings:{kind:'select-all',tableId:'arca_material_bindings',columns:['owner_object_type','owner_object_id','material_key','role','endpoint_id','location','mount_scope_id','inode','size_bytes','fingerprint_algorithm','fingerprint_version','content_fingerprint','binding_revision','health_state','evidence_digest','current'],keyColumns:['owner_object_type','owner_object_id'],safeIntegers:true},
    find_final_decision:{kind:'select-one',tableId:'arca_final_inventory_decisions',columns:['final_inventory_decision_id','on_deck_run_id','shelf_id','placement_revision','target_endpoint_id','target_location','product_manifest_digest','offload_context_digest','related_disposition_set_digest','decision_schema_ref','decision_json','decision_digest','decided_at_ms'],keyColumns:['on_deck_run_id'],safeIntegers:true},
    list_all_inventories:{kind:'select-all',tableId:'arca_inventory_representations',columns:['shelf_entry_id','revision','representation_digest','source_package_id','committed_at_ms'],keyColumns:[],safeIntegers:true},
    find_inventories:{kind:'select-in',tableId:'arca_inventory_representations',keyColumn:'shelf_entry_id',fixedKeyColumns:['revision'],maxItems:500,columns:['shelf_entry_id','revision','representation_digest','source_package_id','committed_at_ms'],safeIntegers:true},
    list_all_facts:{kind:'select-all',tableId:'arca_inventory_product_facts',columns:['shelf_entry_id','inventory_revision','fact_kind','fact_revision','fact_schema_ref','fact_json','episode_metadata_schema_ref','episode_metadata_json','fact_digest','source_package_id','provenance_digest','committed_at_ms'],keyColumns:[],safeIntegers:true},
    find_facts:{kind:'select-in',tableId:'arca_inventory_product_facts',keyColumn:'shelf_entry_id',maxItems:500,columns:['shelf_entry_id','inventory_revision','fact_kind','fact_revision','fact_schema_ref','fact_json','episode_metadata_schema_ref','episode_metadata_json','fact_digest','source_package_id','provenance_digest','committed_at_ms'],safeIntegers:true},
    find_revision_facts:{kind:'select-in',tableId:'arca_inventory_product_facts',keyColumn:'shelf_entry_id',fixedKeyColumns:['inventory_revision'],maxItems:500,columns:['shelf_entry_id','inventory_revision','fact_kind','fact_revision','fact_schema_ref','fact_json','episode_metadata_schema_ref','episode_metadata_json','fact_digest','source_package_id','provenance_digest','committed_at_ms'],safeIntegers:true},
    insert_representation:{kind:'insert',tableId:'arca_inventory_representations',columns:['shelf_entry_id','revision','representation_digest','source_package_id','committed_at_ms']},
    clear_active_material_guards:{kind:'update',tableId:'arca_inventory_materials',setColumns:['active_guard'],keyColumns:['shelf_entry_id','inventory_revision']},
    insert_material:{kind:'insert',tableId:'arca_inventory_materials',columns:['shelf_entry_id','inventory_revision','ordinal','material_key','role','episode_claims_schema_ref','episode_claims_json','episode_claim_set_digest','endpoint_id','location','binding_revision','mount_scope_id','inode','fingerprint_algorithm','fingerprint_version','content_fingerprint','digest_hex','size_bytes','artifact_scope_schema_ref','artifact_scope_json','active_guard']},
    insert_related:{kind:'insert',tableId:'arca_inventory_related_references',columns:['shelf_entry_id','inventory_revision','reference_id','primary_ordinal','role','reference_kind','material_identity_hint','endpoint_id','location','checksum_hex']},
    insert_fact:{kind:'insert',tableId:'arca_inventory_product_facts',columns:['shelf_entry_id','inventory_revision','fact_kind','fact_revision','fact_schema_ref','fact_json','episode_metadata_schema_ref','episode_metadata_json','fact_digest','source_package_id','provenance_digest','committed_at_ms']},
    insert_person:{kind:'insert',tableId:'arca_inventory_person_relations',columns:['relation_id','shelf_entry_id','inventory_revision','person_id','display_name','display_name_normalized','role','relation_source','provider_identity_schema_ref','provider_identity_json','provider_identity_digest','origin_evidence_digest','confidence_class','relation_digest']},
    advance_inventory:{kind:'update',tableId:'arca_shelf_entries',setColumns:['current_inventory_revision'],keyColumns:['shelf_entry_id'],compareColumns:[{column:'current_inventory_revision',parameter:'expected_current_inventory_revision'}]},
    insert_inventory_commit:{kind:'insert',tableId:'arca_aftercare_inventory_commits',columns:['inventory_commit_id','aftercare_case_id','shelf_entry_id','previous_inventory_revision','new_inventory_revision','control_change_digest','commit_digest','committed_at_ms']},
    find_inventory_commit:{kind:'select-one',tableId:'arca_aftercare_inventory_commits',columns:['inventory_commit_id','aftercare_case_id','shelf_entry_id','previous_inventory_revision','new_inventory_revision','control_change_digest','commit_digest','committed_at_ms'],keyColumns:['aftercare_case_id','new_inventory_revision'],safeIntegers:true},
    list_assessments:{kind:'select-all',tableId:'arca_aftercare_assessments',columns:['assessment_id','shelf_entry_id','inventory_revision','standard_revision','placement_revision','decision_fact_set_digest','care_basis_digest','assessment_kind','result','incident_key','evidence_digest','assessed_at_ms'],keyColumns:['shelf_entry_id'],safeIntegers:true},
    list_all_assessments:{kind:'select-all',tableId:'arca_aftercare_assessments',columns:['assessment_id','shelf_entry_id','inventory_revision','standard_revision','placement_revision','decision_fact_set_digest','care_basis_digest','assessment_kind','result','incident_key','evidence_digest','assessed_at_ms'],keyColumns:[],safeIntegers:true},
    find_assessments:{kind:'select-in',tableId:'arca_aftercare_assessments',keyColumn:'shelf_entry_id',maxItems:500,columns:['assessment_id','shelf_entry_id','inventory_revision','standard_revision','placement_revision','decision_fact_set_digest','care_basis_digest','assessment_kind','result','incident_key','evidence_digest','assessed_at_ms'],safeIntegers:true},
    find_assessment:{kind:'select-one',tableId:'arca_aftercare_assessments',columns:['assessment_id','shelf_entry_id','inventory_revision','standard_revision','placement_revision','decision_fact_set_digest','care_basis_digest','assessment_kind','result','incident_key','evidence_digest','assessed_at_ms'],keyColumns:['shelf_entry_id','care_basis_digest','assessment_kind'],safeIntegers:true},
    find_assessment_id:{kind:'select-one',tableId:'arca_aftercare_assessments',columns:['assessment_id','shelf_entry_id','inventory_revision','standard_revision','placement_revision','decision_fact_set_digest','care_basis_digest','assessment_kind','result','incident_key','evidence_digest','assessed_at_ms'],keyColumns:['assessment_id'],safeIntegers:true},
    insert_assessment:{kind:'insert',tableId:'arca_aftercare_assessments',columns:['assessment_id','shelf_entry_id','inventory_revision','standard_revision','placement_revision','decision_fact_set_digest','care_basis_digest','assessment_kind','result','incident_key','evidence_digest','assessed_at_ms']},
    list_findings:{kind:'select-all',tableId:'arca_aftercare_findings',columns:['finding_id','assessment_id','finding_kind','severity','repairability','finding_digest','state','created_at_ms'],keyColumns:[],safeIntegers:true},
    find_findings:{kind:'select-in',tableId:'arca_aftercare_findings',keyColumn:'assessment_id',maxItems:500,columns:['finding_id','assessment_id','finding_kind','severity','repairability','finding_digest','state','created_at_ms'],safeIntegers:true},
    insert_finding:{kind:'insert',tableId:'arca_aftercare_findings',columns:['finding_id','assessment_id','finding_kind','severity','repairability','finding_digest','state','created_at_ms']},
    update_finding:{kind:'update',tableId:'arca_aftercare_findings',setColumns:['state'],keyColumns:['finding_id'],compareColumns:[{column:'state',parameter:'expected_state'}]},
    list_all_cases:{kind:'select-all',tableId:'arca_aftercare_cases',columns:['aftercare_case_id','shelf_entry_id','finding_set_digest','care_basis_schema_ref','care_basis_json','care_basis_digest','care_requirement_schema_ref','care_requirement_json','care_requirement_digest','case_generation','trigger_digest','state','terminal_reason_code','terminal_evidence_digest','created_at_ms','terminal_at_ms'],keyColumns:[],safeIntegers:true},
    list_case_seats:{kind:'select-all',tableId:'arca_aftercare_cases',columns:['aftercare_case_id','created_at_ms'],keyColumns:['state'],safeIntegers:true},
    find_cases:{kind:'select-in',tableId:'arca_aftercare_cases',keyColumn:'shelf_entry_id',maxItems:500,columns:['aftercare_case_id','shelf_entry_id','finding_set_digest','care_basis_schema_ref','care_basis_json','care_basis_digest','care_requirement_schema_ref','care_requirement_json','care_requirement_digest','case_generation','trigger_digest','state','terminal_reason_code','terminal_evidence_digest','created_at_ms','terminal_at_ms'],safeIntegers:true},
    find_case:{kind:'select-one',tableId:'arca_aftercare_cases',columns:['aftercare_case_id','shelf_entry_id','finding_set_digest','care_basis_schema_ref','care_basis_json','care_basis_digest','care_requirement_schema_ref','care_requirement_json','care_requirement_digest','case_generation','trigger_digest','state','terminal_reason_code','terminal_evidence_digest','created_at_ms','terminal_at_ms'],keyColumns:['aftercare_case_id'],safeIntegers:true},
    insert_case:{kind:'insert',tableId:'arca_aftercare_cases',columns:['aftercare_case_id','shelf_entry_id','finding_set_digest','care_basis_schema_ref','care_basis_json','care_basis_digest','care_requirement_schema_ref','care_requirement_json','care_requirement_digest','case_generation','trigger_digest','state','terminal_reason_code','terminal_evidence_digest','created_at_ms','terminal_at_ms']},
    update_case:{kind:'update',tableId:'arca_aftercare_cases',setColumns:['state','terminal_reason_code','terminal_evidence_digest','terminal_at_ms'],keyColumns:['aftercare_case_id'],compareColumns:[{column:'state',parameter:'expected_state'}]},
    admit_case:{kind:'update',tableId:'arca_aftercare_cases',setColumns:['state'],keyColumns:['aftercare_case_id'],compareColumns:[{column:'state',parameter:'expected_state'}]},
    insert_basis:{kind:'insert',tableId:'arca_aftercare_case_basis_inputs',columns:['aftercare_case_id','input_kind','owner_domain','aggregate_type','aggregate_id','revision','input_digest']},
    list_basis:{kind:'select-all',tableId:'arca_aftercare_case_basis_inputs',columns:['aftercare_case_id','input_kind','owner_domain','aggregate_type','aggregate_id','revision','input_digest'],keyColumns:['aftercare_case_id'],safeIntegers:true},
    list_commits:{kind:'select-all',tableId:'arca_aftercare_inventory_commits',columns:['inventory_commit_id','aftercare_case_id','shelf_entry_id','previous_inventory_revision','new_inventory_revision','control_change_digest','commit_digest','committed_at_ms'],keyColumns:['shelf_entry_id'],safeIntegers:true},
    find_commits:{kind:'select-in',tableId:'arca_aftercare_inventory_commits',keyColumn:'shelf_entry_id',maxItems:500,columns:['inventory_commit_id','aftercare_case_id','shelf_entry_id','previous_inventory_revision','new_inventory_revision','control_change_digest','commit_digest','committed_at_ms'],safeIntegers:true},
    find_settlement_approval:{kind:'select-one',tableId:'arca_aftercare_settlement_approvals',columns:['approval_id','aftercare_case_id','settlement_scope_digest','service_catalog_revision','shelf_standard_revision','care_basis_digest','derived_at_ms','state'],keyColumns:['aftercare_case_id','settlement_scope_digest'],safeIntegers:true},
    list_settlement_approvals:{kind:'select-all',tableId:'arca_aftercare_settlement_approvals',columns:['approval_id','aftercare_case_id','settlement_scope_digest','service_catalog_revision','shelf_standard_revision','care_basis_digest','derived_at_ms','state'],keyColumns:['aftercare_case_id'],safeIntegers:true},
    insert_settlement_approval:{kind:'insert',tableId:'arca_aftercare_settlement_approvals',columns:['approval_id','aftercare_case_id','settlement_scope_digest','service_catalog_revision','shelf_standard_revision','care_basis_digest','derived_at_ms','state']},
    update_settlement_approval:{kind:'update',tableId:'arca_aftercare_settlement_approvals',setColumns:['state'],keyColumns:['approval_id'],compareColumns:[{column:'state',parameter:'expected_state'}]},
  }});
  const foundation = createRepositoryDefinition({repositoryId:'arca_aftercare_foundation',owner:'execution-foundation',schemaManifest:options.schemaManifest,statements:{
    insert_result:{kind:'insert',tableId:'fx_event_result_bindings',columns:['result_id','event_id','outcome_kind','result_schema_ref','result_json','result_digest','evidence_schema_ref','evidence_json','evidence_digest','effect_receipt_id','committed_at_ms']},
    insert_marker:{kind:'insert',tableId:'fx_commit_markers',columns:['commit_marker','effect_id','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest','committed_at_ms']},
    insert_outbox:{kind:'insert',tableId:'fx_outbox',columns:['message_id','producer_domain','message_kind','aggregate_type','aggregate_id','aggregate_revision','dedup_key','consumer_set_digest','intended_consumer_count','payload_schema_ref','payload_json','payload_digest','state','available_at_ms','created_at_ms','all_acked_at_ms']},
  }});
  const recordRefresh=createInventoryRecordRefreshStore(options,arca);
  const careWork=createCareWorkStore(options);
  const read=(body)=>options.unitOfWork.execute([{participantId:'arca_aftercare_read',owner:'arca',repositories:[arca],execute:body}]).arca_aftercare_read;
  const parse=(value,code)=>{try{return JSON.parse(value);}catch{fail(code,'Stored Aftercare JSON is corrupt.');}};
  const mapAssessment=(row)=>row&&Object.freeze({assessmentId:row.assessment_id,shelfEntryId:row.shelf_entry_id,inventoryRevision:Number(row.inventory_revision),standardRevision:Number(row.standard_revision),placementRevision:Number(row.placement_revision),decisionFactSetDigest:row.decision_fact_set_digest,careBasisDigest:row.care_basis_digest,assessmentKind:row.assessment_kind,result:row.result,incidentKey:row.incident_key||null,evidenceDigest:row.evidence_digest,assessedAtMs:Number(row.assessed_at_ms)});
  const mapFinding=(row)=>row&&Object.freeze({findingId:row.finding_id,assessmentId:row.assessment_id,findingKind:row.finding_kind,severity:row.severity,repairability:row.repairability,findingDigest:row.finding_digest,state:row.state,createdAtMs:Number(row.created_at_ms)});
  const mapCase=(row)=>row&&Object.freeze({aftercareCaseId:row.aftercare_case_id,shelfEntryId:row.shelf_entry_id,findingSetDigest:row.finding_set_digest,careBasis:parse(row.care_basis_json,'ARCA_AFTERCARE_BASIS_CORRUPT'),careBasisDigest:row.care_basis_digest,careRequirement:parse(row.care_requirement_json,'ARCA_AFTERCARE_REQUIREMENT_CORRUPT'),careRequirementDigest:row.care_requirement_digest,caseGeneration:Number(row.case_generation),triggerDigest:row.trigger_digest,state:row.state,terminalReasonCode:row.terminal_reason_code,terminalEvidenceDigest:row.terminal_evidence_digest,createdAtMs:Number(row.created_at_ms),terminalAtMs:row.terminal_at_ms===null?null:Number(row.terminal_at_ms)});
  const mapSettlementApproval=(row)=>row&&Object.freeze({approvalId:row.approval_id,aftercareCaseId:row.aftercare_case_id,
    settlementScopeDigest:row.settlement_scope_digest,serviceCatalogRevision:Number(row.service_catalog_revision),
    shelfStandardRevision:Number(row.shelf_standard_revision),careBasisDigest:row.care_basis_digest,
    derivedAtMs:Number(row.derived_at_ms),state:row.state});

  function acceptedPackageReference(repo,entry,onDeckCommit) {
    if (!onDeckCommit) return null;
    const run=repo.invoke('find_ondeck_run',{on_deck_run_id:onDeckCommit.on_deck_run_id});
    const custody=run&&repo.invoke('find_accepted_custody',{custody_id:run.custody_id});
    return custody?Object.freeze({onDeckPackageId:custody.on_deck_package_id,
      expectedPackageDigest:custody.package_digest,shelfId:entry.shelf_id}):null;
  }
  function currentContext(shelfEntryId){return read((context)=>{const repo=context.repository(arca.repositoryId),entry=repo.invoke('find_entry',{shelf_entry_id:shelfEntryId});if(!entry)return null;
    const shelf=repo.invoke('find_shelf',{shelf_id:entry.shelf_id});if(!shelf)return null;const inventoryRevision=Number(entry.current_inventory_revision),standardRevision=Number(shelf.current_standard_revision),placementRevision=Number(shelf.current_placement_revision);
    const inventory=repo.invoke('find_inventory',{shelf_entry_id:shelfEntryId,revision:inventoryRevision}),standard=repo.invoke('find_standard',{shelf_id:shelf.shelf_id,revision:standardRevision}),placement=repo.invoke('find_placement',{shelf_id:shelf.shelf_id,revision:placementRevision}),identity=repo.invoke('find_identity',{shelf_entry_id:shelfEntryId,revision:Number(entry.canonical_identity_revision)}),onDeckCommit=repo.invoke('find_ondeck_commit',{shelf_entry_id:shelfEntryId}),onDeckRun=onDeckCommit?repo.invoke('find_ondeck_run',{on_deck_run_id:onDeckCommit.on_deck_run_id}):null,initialPlacementDecision=onDeckCommit?repo.invoke('find_final_decision',{on_deck_run_id:onDeckCommit.on_deck_run_id}):null,initialPlacement=initialPlacementDecision?repo.invoke('find_placement',{shelf_id:shelf.shelf_id,revision:Number(initialPlacementDecision.placement_revision)}):null,oldBindings=onDeckRun?repo.invoke('list_custody_bindings',{owner_object_type:'on_deck_custody',owner_object_id:onDeckRun.custody_id}):[];
    if(!inventory||!standard||!placement||!identity)fail('ARCA_AFTERCARE_CURRENT_BASIS_BROKEN','Shelf Entry current Aftercare Basis is incomplete.');
    return Object.freeze({correctionGate:currentJavCorrectionGate(repo,shelfEntryId),acceptedPackageReference:acceptedPackageReference(repo,entry,onDeckCommit),entry:Object.freeze({...entry,current_inventory_revision:inventoryRevision,current_deck_fact_revision:Number(entry.current_deck_fact_revision)}),shelf:Object.freeze({...shelf,current_standard_revision:standardRevision,current_placement_revision:placementRevision}),inventory:Object.freeze(inventory),standard:Object.freeze({...standard,value:parse(standard.standard_json,'ARCA_AFTERCARE_STANDARD_CORRUPT')}),placement:Object.freeze({...placement,value:parse(placement.policy_json,'ARCA_AFTERCARE_PLACEMENT_CORRUPT')}),initialPlacement:initialPlacement?Object.freeze({...initialPlacement,value:parse(initialPlacement.policy_json,'ARCA_AFTERCARE_INITIAL_PLACEMENT_CORRUPT')}):null,identity:Object.freeze(identity),onDeckCommit:onDeckCommit?Object.freeze(onDeckCommit):null,initialPlacementDecision:initialPlacementDecision?Object.freeze({...initialPlacementDecision,placement_revision:Number(initialPlacementDecision.placement_revision)}):null,oldBindings:Object.freeze(oldBindings.map((row)=>Object.freeze({...row,binding_revision:Number(row.binding_revision),current:Number(row.current)}))),materials:Object.freeze(repo.invoke('list_materials',{shelf_entry_id:shelfEntryId,inventory_revision:inventoryRevision})),related:Object.freeze(repo.invoke('list_related',{shelf_entry_id:shelfEntryId,inventory_revision:inventoryRevision})),facts:Object.freeze(repo.invoke('list_facts',{shelf_entry_id:shelfEntryId,inventory_revision:inventoryRevision}).map((row)=>Object.freeze({...row,value:readStoredMetadataValue(row)}))),people:Object.freeze(repo.invoke('list_people',{shelf_entry_id:shelfEntryId,inventory_revision:inventoryRevision}).map(row=>Object.freeze({...row,evidence_inventory_revision:evidenceInventoryRevision(repo,row)}))),reservations:Object.freeze(repo.invoke('list_reservations',{shelf_entry_id:shelfEntryId}))});});}

  function recycleProtection(){return read(context=>{
    const repo=context.repository(arca.repositoryId),entries=repo.invoke('list_entries',{}).filter(row=>['active','offdeck_in_progress'].includes(row.status));
    const locations=[];
    for(const row of entries){const params={shelf_entry_id:row.shelf_entry_id,inventory_revision:Number(row.current_inventory_revision)};
      locations.push(...repo.invoke('list_materials',params).map(item=>item.location),...repo.invoke('list_related',params).map(item=>item.location).filter(Boolean));}
    return {protectedLocations:locations,scanRoots:repo.invoke('list_shelves',{}).map(row=>row.target_root_location)};
  });}
  function inventoryMaterials(shelfEntryId, inventoryRevision) {
    if (typeof shelfEntryId !== 'string' || !shelfEntryId ||
        !Number.isSafeInteger(Number(inventoryRevision)) || Number(inventoryRevision) < 1) {
      fail('ARCA_AFTERCARE_INVENTORY_SCOPE_INVALID',
        'Aftercare historical Inventory scope is invalid.');
    }
    return read((context) => Object.freeze(context.repository(arca.repositoryId)
      .invoke('list_materials', {
        shelf_entry_id:shelfEntryId,
        inventory_revision:Number(inventoryRevision),
      }).map((item) => Object.freeze(item))));
  }

  function commitAssessmentSet(value){const committedAt=now();return options.unitOfWork.execute([{participantId:'arca_aftercare_assessment_commit',owner:'arca',repositories:[arca],execute(context){const repo=context.repository(arca.repositoryId),existing=[];
    for(const item of value.assessments){let row=repo.invoke('find_assessment_id',{assessment_id:item.assessmentId});if(!row){repo.invoke('insert_assessment',{assessment_id:item.assessmentId,shelf_entry_id:value.shelfEntryId,inventory_revision:value.inventoryRevision,standard_revision:value.standardRevision,placement_revision:value.placementRevision,decision_fact_set_digest:value.decisionFactSetDigest,care_basis_digest:value.careBasisDigest,assessment_kind:item.assessmentKind,result:item.result,incident_key:item.incidentKey||null,evidence_digest:item.evidenceDigest,assessed_at_ms:committedAt});row=repo.invoke('find_assessment_id',{assessment_id:item.assessmentId});
      for(const finding of item.findings||[])repo.invoke('insert_finding',{finding_id:finding.findingId,assessment_id:item.assessmentId,finding_kind:finding.findingKind,severity:finding.severity,repairability:finding.repairability,finding_digest:finding.findingDigest,state:'open',created_at_ms:committedAt});}
      existing.push(mapAssessment(row));}
    return Object.freeze({assessments:Object.freeze(existing),committedAtMs:committedAt});}}]).arca_aftercare_assessment_commit;}

  function createCase(value){
    assertProcessingRequirement(value.careRequirement);
    const at=now(),triggerDigest=value.triggerDigest||canonicalDigest({schema:'arca.aftercare-case-trigger@2',
      triggerKind:'health_maintenance',shelfEntryId:value.shelfEntryId,careBasisDigest:value.careBasis.digest,findingSetDigest:value.findingSetDigest});
    if(!/^[a-f0-9]{64}$/.test(triggerDigest))fail('ARCA_AFTERCARE_CASE_TRIGGER_INVALID','Aftercare Case trigger digest is invalid.');
    const priorCases=read(context=>context.repository(arca.repositoryId).invoke('list_cases',{shelf_entry_id:value.shelfEntryId}).map(mapCase));
    const matching=priorCases.filter(item=>item.careBasisDigest===value.careBasis.digest&&item.findingSetDigest===value.findingSetDigest);
    const existing=priorCases.find(item=>['queued','active'].includes(item.state));
    if(existing){if(existing.careBasisDigest===value.careBasis.digest&&existing.findingSetDigest===value.findingSetDigest)return existing;fail('ARCA_AFTERCARE_ACTIVE_CASE_CONFLICT','Shelf Entry already has another active Aftercare Case.');}
    const triggerReplay=matching.find((item)=>item.triggerDigest===triggerDigest);if(triggerReplay)return triggerReplay;const caseGeneration=Math.max(0,...matching.map((item)=>item.caseGeneration))+1,caseId='arca-care-'+canonicalDigest({shelfEntryId:value.shelfEntryId,careBasisDigest:value.careBasis.digest,findingSetDigest:value.findingSetDigest,careRequirementDigest:value.careRequirement.digest,caseGeneration,triggerDigest}).slice(0,40),marker='arca-aftercare-case-'+caseId;
    const payload={aftercareCaseId:caseId,shelfEntryId:value.shelfEntryId,careBasisDigest:value.careBasis.digest,careRequirementDigest:value.careRequirement.digest,caseGeneration,triggerDigest,state:'queued'},payloadDigest=canonicalDigest(payload),consumers=canonicalDigest([]);
    options.unitOfWork.execute([{participantId:'arca_aftercare_case_domain',owner:'arca',repositories:[arca],execute(context){const repo=context.repository(arca.repositoryId);assertNoJavCorrection(repo,value.shelfEntryId);if(repo.invoke('list_reservations',{shelf_entry_id:value.shelfEntryId}).some((item)=>item.state==='active'))fail('ARCA_AFTERCARE_MODIFICATION_FENCED','Off-deck Reservation prevents a new Aftercare Case.');repo.invoke('insert_case',{aftercare_case_id:caseId,shelf_entry_id:value.shelfEntryId,finding_set_digest:value.findingSetDigest,care_basis_schema_ref:value.careBasis.schemaRef,care_basis_json:canonicalJson(value.careBasis),care_basis_digest:value.careBasis.digest,care_requirement_schema_ref:value.careRequirement.schemaRef,care_requirement_json:canonicalJson(value.careRequirement),care_requirement_digest:value.careRequirement.digest,case_generation:caseGeneration,trigger_digest:triggerDigest,state:'queued',terminal_reason_code:null,terminal_evidence_digest:null,created_at_ms:at,terminal_at_ms:null});for(const input of value.basisInputs)repo.invoke('insert_basis',{aftercare_case_id:caseId,input_kind:input.inputKind,owner_domain:input.ownerDomain,aggregate_type:input.aggregateType,aggregate_id:input.aggregateId,revision:input.revision,input_digest:input.inputDigest});}},
      ...(value.atomicParticipants ? value.atomicParticipants(caseId) : []),
      {participantId:'arca_aftercare_case_foundation',owner:'execution-foundation',boundBusinessOwner:'arca',repositories:[foundation],execute(context){const repo=context.repository(foundation.repositoryId);repo.invoke('insert_marker',{commit_marker:marker,effect_id:null,owner_domain:'arca',scope_type:'aftercare_case',scope_id:caseId,commit_digest:payloadDigest,result_id:null,result_schema_ref:null,result_digest:null,committed_at_ms:at});repo.invoke('insert_outbox',{message_id:'arca-aftercare-case-message-'+canonicalDigest(caseId).slice(0,32),producer_domain:'arca',message_kind:'arca.aftercare.case.created',aggregate_type:'aftercare_case',aggregate_id:caseId,aggregate_revision:1,dedup_key:marker,consumer_set_digest:consumers,intended_consumer_count:0,payload_schema_ref:'helix://arca/messages/AftercareCaseCreated/v1',payload_json:canonicalJson(payload),payload_digest:payloadDigest,state:'tombstoned',available_at_ms:at,created_at_ms:at,all_acked_at_ms:null});}}]);return getCase(caseId);}
  function terminateCase(caseId,state,reasonCode,evidenceDigest){
    if(!['resolved','invalidated','unresolved'].includes(state))fail('ARCA_AFTERCARE_CASE_STATE','Aftercare terminal state is invalid.');
    if(typeof reasonCode!=='string'||!reasonCode||typeof evidenceDigest!=='string'||!/^[a-f0-9]{64}$/.test(evidenceDigest))fail('ARCA_AFTERCARE_CASE_TERMINAL_EVIDENCE','Aftercare terminal reason and Evidence are required.');
    const terminal=options.unitOfWork.execute([{participantId:'arca_aftercare_case_terminal',owner:'arca',repositories:[arca],execute(context){
      const repo=context.repository(arca.repositoryId),caseRow=repo.invoke('find_case',{aftercare_case_id:caseId});
      if(!caseRow)fail('ARCA_AFTERCARE_CASE_MISSING','Aftercare Case is absent.');
      if(!['queued','active'].includes(caseRow.state)){
        if(caseRow.state!==state||caseRow.terminal_reason_code!==reasonCode||caseRow.terminal_evidence_digest!==evidenceDigest)fail('ARCA_AFTERCARE_CASE_CAS','A terminal Aftercare Case cannot be rewritten.');
        return mapCase(caseRow);
      }
      const changed=repo.invoke('update_case',{state,terminal_reason_code:reasonCode,terminal_evidence_digest:evidenceDigest,terminal_at_ms:now(),aftercare_case_id:caseId,expected_state:caseRow.state});
      if(changed.changes!==1){const current=repo.invoke('find_case',{aftercare_case_id:caseId});if(!current||current.state!==state||current.terminal_reason_code!==reasonCode||current.terminal_evidence_digest!==evidenceDigest)fail('ARCA_AFTERCARE_CASE_CAS','Aftercare Case terminal CAS failed.');}
      if(state==='resolved'){
        const assessmentIds=repo.invoke('list_assessments',{shelf_entry_id:caseRow.shelf_entry_id}).filter((item)=>item.care_basis_digest===caseRow.care_basis_digest).map((item)=>item.assessment_id);
        for(const finding of selectMany(repo,'find_findings',assessmentIds)){if(finding.state!=='open')continue;repo.invoke('update_finding',{state:'resolved',finding_id:finding.finding_id,expected_state:'open'});}
      }
      for(const approval of repo.invoke('list_settlement_approvals',{aftercare_case_id:caseId})){
        if(approval.state==='active')repo.invoke('update_settlement_approval',{state:'stale',approval_id:approval.approval_id,expected_state:'active'});
      }
      return mapCase(repo.invoke('find_case',{aftercare_case_id:caseId}));
    }}]).arca_aftercare_case_terminal;
    workspaceStore.schedule(caseId,terminal.terminalAtMs);
    return terminal;
  }
  function listCases(){return read((context)=>context.repository(arca.repositoryId).invoke('list_all_cases',{}).map(mapCase));}
  function workDisplay(shelfEntryIds){return read(context=>{
    const repo=context.repository(arca.repositoryId),entries=selectMany(repo,'find_entries',shelfEntryIds);
    const shelves=new Map(selectMany(repo,'find_shelves',entries.map(row=>row.shelf_id)).map(row=>[row.shelf_id,row]));
    const identities=new Map(entries.map(entry=>repo.invoke('find_identity',{shelf_entry_id:entry.shelf_entry_id,revision:Number(entry.canonical_identity_revision)}))
      .filter(Boolean).map(row=>[row.shelf_entry_id+':'+Number(row.revision),row]));
    const facts=entries.flatMap(entry=>repo.invoke('list_facts',{shelf_entry_id:entry.shelf_entry_id,inventory_revision:Number(entry.current_inventory_revision)}))
      .filter(row=>row.fact_kind==='product_metadata');
    return new Map(entries.map(entry=>{
      const row=facts.find(row=>row.shelf_entry_id===entry.shelf_entry_id&&Number(row.inventory_revision)===Number(entry.current_inventory_revision));
      const metadata=row?readStoredMetadataValue(row):{},shelf=shelves.get(entry.shelf_id);
      const title=metadata.descriptiveFacts?.entries?.find(fact=>fact.key==='title'||fact.key==='display_title')?.value;
      return [entry.shelf_entry_id,Object.freeze({displayIdentity:title||identities.get(entry.shelf_entry_id+':'+Number(entry.canonical_identity_revision))?.provider_key||entry.shelf_entry_id,
        targetShelfId:entry.shelf_id,targetShelfName:shelf?.name||null})];
    }));
  });}
  function caseEvidence(aftercareCaseId){return read(context=>{
    const repo=context.repository(arca.repositoryId),row=repo.invoke('find_case',{aftercare_case_id:aftercareCaseId});
    if(!row)return null;
    const basis=parse(row.care_basis_json,'ARCA_AFTERCARE_CASE_BASIS_CORRUPT'),entry=repo.invoke('find_entry',{shelf_entry_id:row.shelf_entry_id});
    const primaryBytes=revision=>{
      const materials=repo.invoke('list_materials',{shelf_entry_id:row.shelf_entry_id,inventory_revision:revision})
        .filter(material=>material.role==='primary_payload');
      return materials.length?materials.reduce((total,material)=>total+Number(material.size_bytes),0):null;
    };
    return Object.freeze({objective:readCareObjective(parse(row.care_requirement_json,'ARCA_AFTERCARE_REQUIREMENT_CORRUPT')),inventoryRevision:Number(basis.inventoryRevision),standardRevision:Number(basis.standardRevision),
      originalPrimaryBytes:primaryBytes(Number(basis.inventoryRevision)),
      currentInventoryRevision:entry?Number(entry.current_inventory_revision):null,
      currentPrimaryBytes:entry?primaryBytes(Number(entry.current_inventory_revision)):null});
  });}
  function listShelfEntryIds(shelfId){return read((context)=>context.repository(arca.repositoryId).invoke('list_entries',{}).filter((row)=>row.status==='active'&&row.shelf_id===shelfId).map((row)=>row.shelf_entry_id));}
  function admitCase(caseId){
    return options.unitOfWork.execute([{participantId:'arca_aftercare_case_admission',owner:'arca',repositories:[arca],execute(context){
      const repo=context.repository(arca.repositoryId),current=repo.invoke('find_case',{aftercare_case_id:caseId});
      if(!current)return null;
      if(current.state!=='queued')return mapCase(current);
      assertNoJavCorrection(repo,current.shelf_entry_id);
      const active=repo.invoke('list_case_seats',{state:'active'});
      const queue=repo.invoke('list_case_seats',{state:'queued'}).sort((a,b)=>Number(a.created_at_ms)-Number(b.created_at_ms)||a.aftercare_case_id.localeCompare(b.aftercare_case_id));
      const available=Math.max(0,caseCapacity-active.length);
      if(!queue.slice(0,available).some((row)=>row.aftercare_case_id===caseId))return mapCase(current);
      if(repo.invoke('list_reservations',{shelf_entry_id:current.shelf_entry_id}).some((row)=>row.state==='active'))return mapCase(current);
      const changed=repo.invoke('admit_case',{aftercare_case_id:caseId,state:'active',expected_state:'queued'});
      if(changed.changes!==1)fail('ARCA_AFTERCARE_ADMISSION_CAS','Aftercare Case admission changed concurrently.');
      return mapCase(repo.invoke('find_case',{aftercare_case_id:caseId}));
    }}]).arca_aftercare_case_admission;
  }
  function getCase(caseId){return read((context)=>mapCase(context.repository(arca.repositoryId).invoke('find_case',{aftercare_case_id:caseId})));}
  function getSettlementApproval(aftercareCaseId,settlementScopeDigest){return read((context)=>mapSettlementApproval(context.repository(arca.repositoryId).invoke('find_settlement_approval',{aftercare_case_id:aftercareCaseId,settlement_scope_digest:settlementScopeDigest})));}
  function issueSettlementApprovalInRepository(repo,value,at){
    if(typeof value.settlementEventId!=='string'||!value.settlementEventId)fail('ARCA_AFTERCARE_SETTLEMENT_APPROVAL_INVALID','Aftercare Settlement Approval Event identity is invalid.');
    const approvalId=aftercareSettlementApprovalId(value);
    if(!Number.isSafeInteger(value.serviceCatalogRevision)||value.serviceCatalogRevision<1||!Number.isSafeInteger(value.shelfStandardRevision)||value.shelfStandardRevision<1)fail('ARCA_AFTERCARE_SETTLEMENT_APPROVAL_INVALID','Aftercare Settlement Approval revisions are invalid.');
    const care=repo.invoke('find_case',{aftercare_case_id:value.aftercareCaseId});
    if(!care||care.state!=='active'||care.care_basis_digest!==value.careBasisDigest)fail('ARCA_AFTERCARE_SETTLEMENT_APPROVAL_STALE','Aftercare Settlement Approval basis is stale.');
    const existing=repo.invoke('find_settlement_approval',{aftercare_case_id:value.aftercareCaseId,settlement_scope_digest:value.settlementScopeDigest});
    if(existing){if(existing.approval_id!==approvalId||existing.care_basis_digest!==value.careBasisDigest||Number(existing.shelf_standard_revision)!==value.shelfStandardRevision||Number(existing.service_catalog_revision)!==value.serviceCatalogRevision)fail('ARCA_AFTERCARE_SETTLEMENT_APPROVAL_CONFLICT','Aftercare Settlement Approval replay conflicts with its frozen basis or Event.');return mapSettlementApproval(existing);}
    repo.invoke('insert_settlement_approval',{approval_id:approvalId,aftercare_case_id:value.aftercareCaseId,settlement_scope_digest:value.settlementScopeDigest,service_catalog_revision:value.serviceCatalogRevision,shelf_standard_revision:value.shelfStandardRevision,care_basis_digest:value.careBasisDigest,derived_at_ms:at,state:'active'});
    return mapSettlementApproval(repo.invoke('find_settlement_approval',{aftercare_case_id:value.aftercareCaseId,settlement_scope_digest:value.settlementScopeDigest}));
  }
  function issueSettlementApproval(value){
    const at=now();
    return options.unitOfWork.execute([{participantId:'arca_aftercare_settlement_approval_issue',owner:'arca',repositories:[arca],execute(context){
      return issueSettlementApprovalInRepository(context.repository(arca.repositoryId),value,at);
    }}]).arca_aftercare_settlement_approval_issue;
  }
  function consumeSettlementApproval(value){return options.unitOfWork.execute([{participantId:'arca_aftercare_settlement_approval_consume',owner:'arca',repositories:[arca],execute(context){
    const repo=context.repository(arca.repositoryId),row=repo.invoke('find_settlement_approval',{aftercare_case_id:value.aftercareCaseId,settlement_scope_digest:value.settlementScopeDigest});
    if(!row||row.approval_id!==value.approvalId||row.care_basis_digest!==value.careBasisDigest||row.state==='stale')fail('ARCA_AFTERCARE_SETTLEMENT_APPROVAL_STALE','Aftercare Settlement Approval is absent, mismatched, or stale.');
    if(row.state==='active'){const changed=repo.invoke('update_settlement_approval',{state:'consumed',approval_id:row.approval_id,expected_state:'active'});if(changed.changes!==1)fail('ARCA_AFTERCARE_SETTLEMENT_APPROVAL_CAS','Aftercare Settlement Approval consume CAS failed.');}
    return mapSettlementApproval(repo.invoke('find_settlement_approval',{aftercare_case_id:value.aftercareCaseId,settlement_scope_digest:value.settlementScopeDigest}));
  }}]).arca_aftercare_settlement_approval_consume;}
  function staleSettlementApprovals(caseId){return options.unitOfWork.execute([{participantId:'arca_aftercare_settlement_approval_stale',owner:'arca',repositories:[arca],execute(context){const repo=context.repository(arca.repositoryId);let count=0;for(const row of repo.invoke('list_settlement_approvals',{aftercare_case_id:caseId})){if(row.state!=='active')continue;count+=repo.invoke('update_settlement_approval',{state:'stale',approval_id:row.approval_id,expected_state:'active'}).changes;}return count;}}]).arca_aftercare_settlement_approval_stale;}
  function commitInventory(value,controlParticipant){const at=value.committedAtMs===undefined?now():Number(value.committedAtMs),previous=Number(value.previousInventoryRevision),next=previous+1,commitId=aftercareInventoryCommitId(value),binding=value.resultBinding,effectReceipt=binding?.effectReceipt,resultJson=binding?canonicalJson(binding.result):null,evidenceJson=binding?canonicalJson(binding.evidence):null,resultDigest=binding?canonicalDigest(binding.result):null,evidenceDigest=binding?canonicalDigest(binding.evidence):null;
    const commitDigest=aftercareInventoryCommitDigest(value,resultDigest);
    if(!Number.isSafeInteger(at)||at<0)fail('ARCA_AFTERCARE_INVENTORY_TIME_INVALID','Aftercare Inventory commit time is invalid.');
    if(!binding||typeof binding.resultId!=='string'||!binding.resultId||typeof binding.eventId!=='string'||!binding.eventId||binding.outcomeKind!=='succeeded'||typeof binding.resultSchemaRef!=='string'||!binding.resultSchemaRef||typeof binding.evidenceSchemaRef!=='string'||!binding.evidenceSchemaRef||typeof binding.effectReceiptId!=='string'||!binding.effectReceiptId||!binding.result||!binding.evidence||!effectReceipt||effectReceipt.effectReceiptId!==binding.effectReceiptId||effectReceipt.effectClass!=='responsibility_control_commit'||typeof effectReceipt.effectId!=='string'||!effectReceipt.effectId||typeof effectReceipt.commitMarker!=='string'||!effectReceipt.commitMarker||effectReceipt.outputDigest!==resultDigest||effectReceipt.verificationEvidenceDigest!==commitDigest||!Number.isSafeInteger(effectReceipt.committedAtMs)||effectReceipt.committedAtMs<0||binding.result.receiptId!==commitId||binding.result.effectReceiptRef!==binding.effectReceiptId||binding.result.aftercareCaseId!==value.aftercareCaseId||binding.result.shelfEntryId!==value.shelfEntryId||Number(binding.result.previousInventoryRevision)!==previous||Number(binding.result.newInventoryRevision)!==next||binding.result.controlChangeDigest!==value.controlChangeDigest||Number(binding.result.committedAtMs)!==at)fail('ARCA_AFTERCARE_INVENTORY_RESULT_INVALID','Aftercare Inventory commit requires its exact typed Event Result and Effect Receipt.');
    const prior=read((context)=>context.repository(arca.repositoryId).invoke('find_inventory_commit',{aftercare_case_id:value.aftercareCaseId,new_inventory_revision:next}));if(prior){if(prior.commit_digest!==commitDigest)fail('ARCA_AFTERCARE_INVENTORY_REPLAY_CONFLICT','Aftercare Inventory replay conflicts with the committed revision.');if(value.settlementApproval)issueSettlementApproval(value.settlementApproval);return Object.freeze({...prior,previousInventoryRevision:Number(prior.previous_inventory_revision),newInventoryRevision:Number(prior.new_inventory_revision)});}
    const participants=[];if(controlParticipant)participants.push(controlParticipant);participants.push({participantId:'arca_aftercare_inventory_domain',owner:'arca',repositories:[arca],execute(context){const repo=context.repository(arca.repositoryId),entry=repo.invoke('find_entry',{shelf_entry_id:value.shelfEntryId});assertNoJavCorrection(repo,value.shelfEntryId);if(!entry||Number(entry.current_inventory_revision)!==previous)fail('ARCA_AFTERCARE_INVENTORY_STALE','Shelf Entry Inventory changed before Aftercare commit.');const inventory=repo.invoke('find_inventory',{shelf_entry_id:value.shelfEntryId,revision:previous});
      appendInventoryRevision(repo,value,inventory,previous,next,at);repo.invoke('insert_inventory_commit',{inventory_commit_id:commitId,aftercare_case_id:value.aftercareCaseId,shelf_entry_id:value.shelfEntryId,previous_inventory_revision:previous,new_inventory_revision:next,control_change_digest:value.controlChangeDigest,commit_digest:commitDigest,committed_at_ms:at});if(value.settlementApproval)issueSettlementApprovalInRepository(repo,value.settlementApproval,at);return next;}});
    if(value.defectRepair)participants.push(defectStore.repairCommitParticipant({...value.defectRepair,aftercareCaseId:value.aftercareCaseId}));
    participants.push({participantId:'arca_aftercare_inventory_foundation',owner:'execution-foundation',boundBusinessOwner:'arca',repositories:[foundation],execute(context){const repo=context.repository(foundation.repositoryId);repo.invoke('insert_result',{result_id:binding.resultId,event_id:binding.eventId,outcome_kind:binding.outcomeKind,result_schema_ref:binding.resultSchemaRef,result_json:resultJson,result_digest:resultDigest,evidence_schema_ref:binding.evidenceSchemaRef,evidence_json:evidenceJson,evidence_digest:evidenceDigest,effect_receipt_id:binding.effectReceiptId,committed_at_ms:at});repo.invoke('insert_marker',{commit_marker:effectReceipt.commitMarker,effect_id:effectReceipt.effectId,owner_domain:'arca',scope_type:'shelf_entry',scope_id:value.shelfEntryId,commit_digest:effectReceipt.verificationEvidenceDigest,result_id:binding.resultId,result_schema_ref:binding.resultSchemaRef,result_digest:resultDigest,committed_at_ms:effectReceipt.committedAtMs});}});options.unitOfWork.execute(participants);return Object.freeze({inventory_commit_id:commitId,aftercare_case_id:value.aftercareCaseId,shelf_entry_id:value.shelfEntryId,previous_inventory_revision:previous,new_inventory_revision:next,control_change_digest:value.controlChangeDigest,commit_digest:commitDigest,committed_at_ms:at,previousInventoryRevision:previous,newInventoryRevision:next});}
  function history(shelfEntryId){return read((context)=>{const repo=context.repository(arca.repositoryId),assessments=repo.invoke('list_assessments',{shelf_entry_id:shelfEntryId}).map(mapAssessment).sort((a,b)=>b.assessedAtMs-a.assessedAtMs),ids=assessments.map((x)=>x.assessmentId),findings=selectMany(repo,'find_findings',ids).map(mapFinding).sort((a,b)=>b.createdAtMs-a.createdAtMs),cases=repo.invoke('list_cases',{shelf_entry_id:shelfEntryId}).map(mapCase).map((item)=>Object.freeze({...item,basisInputs:Object.freeze(repo.invoke('list_basis',{aftercare_case_id:item.aftercareCaseId}).map((row)=>Object.freeze({inputKind:row.input_kind,ownerDomain:row.owner_domain,aggregateType:row.aggregate_type,aggregateId:row.aggregate_id,revision:Number(row.revision),inputDigest:row.input_digest})))})).sort((a,b)=>b.createdAtMs-a.createdAtMs),commits=repo.invoke('list_commits',{shelf_entry_id:shelfEntryId}).map((x)=>Object.freeze({inventoryCommitId:x.inventory_commit_id,aftercareCaseId:x.aftercare_case_id,previousInventoryRevision:Number(x.previous_inventory_revision),newInventoryRevision:Number(x.new_inventory_revision),controlChangeDigest:x.control_change_digest,commitDigest:x.commit_digest,committedAtMs:Number(x.committed_at_ms)}));return Object.freeze({assessments:Object.freeze(assessments),findings:Object.freeze(findings),cases:Object.freeze(cases),commits:Object.freeze(commits)});});}
  function selectMany(repo,statement,values){const unique=[...new Set(values)].filter(Boolean).sort(),rows=[];for(let offset=0;offset<unique.length;offset+=500)rows.push(...repo.invoke(statement,{values:unique.slice(offset,offset+500)}));return rows;}
  function healthProjectionInputs(shelfEntryIds){
    const wanted=new Set(shelfEntryIds);if(!wanted.size)return Object.freeze([]);
    return read((context)=>{const repo=context.repository(arca.repositoryId),ids=[...wanted].sort(),entries=selectMany(repo,'find_entries',ids).filter((row)=>row.status==='active'),shelfIds=entries.map((row)=>row.shelf_id),shelves=new Map(selectMany(repo,'find_shelves',shelfIds).map((row)=>[row.shelf_id,row])),standards=new Map(selectMany(repo,'find_standards',shelfIds).map((row)=>[row.shelf_id+':'+Number(row.revision),row])),identities=new Map(selectMany(repo,'find_identities',ids).map((row)=>[row.shelf_entry_id+':'+Number(row.revision),row])),inventories=new Map(),materialRoles=new Map(),factsByEntry=new Map(),assessmentsByEntry=new Map(),findingsByAssessment=new Map(),casesByEntry=new Map();
      const entriesByInventoryRevision=new Map();
      for(const entry of entries){const revision=Number(entry.current_inventory_revision),members=entriesByInventoryRevision.get(revision)||[];members.push(entry.shelf_entry_id);entriesByInventoryRevision.set(revision,members);}
      // These inputs describe the same current Inventory head. Assessment and
      // Case history below keeps its separate, complete health-history scope.
      for(const [inventory_revision,members] of entriesByInventoryRevision){
        for(let offset=0;offset<members.length;offset+=500){
          const values=members.slice(offset,offset+500);
          for(const row of repo.invoke('find_inventories',{revision:inventory_revision,values}))inventories.set(row.shelf_entry_id+':'+Number(row.revision),row);
          for(const row of repo.invoke('find_material_roles',{inventory_revision,values})){
            const key=row.shelf_entry_id+':'+Number(row.inventory_revision),roles=materialRoles.get(key)||[];
            roles.push(row.role);materialRoles.set(key,roles);
          }
          for(const row of repo.invoke('find_revision_facts',{inventory_revision,values})){const list=factsByEntry.get(row.shelf_entry_id)||[];list.push(row);factsByEntry.set(row.shelf_entry_id,list);}
        }
      }
      for(const row of selectMany(repo,'find_assessments',ids).map(mapAssessment)){const list=assessmentsByEntry.get(row.shelfEntryId)||[];list.push(row);assessmentsByEntry.set(row.shelfEntryId,list);}
      const assessmentIds=new Set([...assessmentsByEntry.values()].flat().map((row)=>row.assessmentId));
      for(const raw of selectMany(repo,'find_findings',[...assessmentIds])){const row=mapFinding(raw),list=findingsByAssessment.get(row.assessmentId)||[];list.push(row);findingsByAssessment.set(row.assessmentId,list);}
      for(const row of selectMany(repo,'find_cases',ids).map(mapCase)){const list=casesByEntry.get(row.shelfEntryId)||[];list.push(row);casesByEntry.set(row.shelfEntryId,list);}
      const commitsByEntry=new Map();
      for(const row of selectMany(repo,'find_commits',ids)){
        const list=commitsByEntry.get(row.shelf_entry_id)||[];
        list.push(Object.freeze({inventoryCommitId:row.inventory_commit_id,aftercareCaseId:row.aftercare_case_id,
          previousInventoryRevision:Number(row.previous_inventory_revision),newInventoryRevision:Number(row.new_inventory_revision),
          controlChangeDigest:row.control_change_digest,commitDigest:row.commit_digest,committedAtMs:Number(row.committed_at_ms)}));
        commitsByEntry.set(row.shelf_entry_id,list);
      }
      const initialCommits=new Map(selectMany(repo,'find_ondeck_commits',ids).map(row=>[row.shelf_entry_id,row]));
      const initialRuns=new Map(selectMany(repo,'find_ondeck_runs',[...initialCommits.values()].map(row=>row.on_deck_run_id)).map(row=>[row.on_deck_run_id,row]));
      const initialCustodies=new Map(selectMany(repo,'find_accepted_custodies',[...initialRuns.values()].map(row=>row.custody_id)).map(row=>[row.custody_id,row]));
      return Object.freeze(entries.map((entry)=>{
        const shelf=shelves.get(entry.shelf_id),inventoryRevision=Number(entry.current_inventory_revision),standard=shelf&&standards.get(entry.shelf_id+':'+Number(shelf.current_standard_revision)),identity=identities.get(entry.shelf_entry_id+':'+Number(entry.canonical_identity_revision)),inventory=inventories.get(entry.shelf_entry_id+':'+inventoryRevision);
        if(!shelf||!identity||!inventory||!standard)return null;
        const entryFacts=(factsByEntry.get(entry.shelf_entry_id)||[]).filter((row)=>Number(row.inventory_revision)===inventoryRevision),entryAssessments=(assessmentsByEntry.get(entry.shelf_entry_id)||[]).sort((a,b)=>b.assessedAtMs-a.assessedAtMs),entryFindings=entryAssessments.flatMap((row)=>findingsByAssessment.get(row.assessmentId)||[]).sort((a,b)=>b.createdAtMs-a.createdAtMs),entryCases=(casesByEntry.get(entry.shelf_entry_id)||[]).sort((a,b)=>b.createdAtMs-a.createdAtMs);
        const metadataRow=entryFacts.find((row)=>row.fact_kind==='product_metadata'),metadata=metadataRow?readStoredMetadataValue(metadataRow):null,descriptive=new Map((metadata?.descriptiveFacts?.entries||[]).map((item)=>[item.key,item.value])),rawYear=descriptive.get('year')??descriptive.get('release_year')??descriptive.get('year_or_release_date')??descriptive.get('release_date')??null,yearMatch=String(rawYear??'').match(/^(\d{4})/),ratingTargetBase={targetType:'shelf_entry',targetId:entry.shelf_entry_id,targetRevision:Number(entry.canonical_identity_revision),title:descriptive.get('title')||descriptive.get('display_title')||descriptive.get('series_title')||identity.provider_key,year:yearMatch?Number(yearMatch[1]):null,providerIdentity:identity.provider&&identity.provider_key?identity.provider+':'+identity.provider_key:null,canonicalIdentityDigest:identity.identity_digest},ratingTarget=Object.freeze({...ratingTargetBase,targetDigest:canonicalDigest(ratingTargetBase)});
        const provenance=metadata?.provenance||metadata?.sourceProvenance||{};
        const initialCommit=initialCommits.get(entry.shelf_entry_id),initialRun=initialCommit&&initialRuns.get(initialCommit.on_deck_run_id),custody=initialRun&&initialCustodies.get(initialRun.custody_id);
        const acceptedPackageReference=custody?Object.freeze({onDeckPackageId:custody.on_deck_package_id,expectedPackageDigest:custody.package_digest,shelfId:entry.shelf_id}):null;
        const defectRow=entryFacts.find((row)=>row.fact_kind==='authorized_defect_manifest');
        const authorizedDefectManifest=defectRow
          ? readStoredMetadataValue(defectRow) : null;
        return Object.freeze({shelfEntryId:entry.shelf_entry_id,structureKind:entry.structure_kind,canonicalIdentity:Object.freeze(identity),inventoryRevision,standardRevision:Number(shelf.current_standard_revision),placementRevision:Number(shelf.current_placement_revision),canonicalIdentityDigest:identity.identity_digest,sourcePackageId:inventory.source_package_id,materialRoles:materialRoles.get(entry.shelf_entry_id+':'+inventoryRevision)||[],standardValue:parse(standard.standard_json,'ARCA_AFTERCARE_STANDARD_CORRUPT'),acceptedPackageReference,decisionFacts:entryFacts.filter(row=>row.fact_kind==='decision_fact').map(row=>({...row,value:readStoredMetadataValue(row)})),authorizedDefectManifest,ratingTarget,incidentResourceHints:Object.freeze({provider:identity.provider,integrationId:provenance.integrationId||null,configRevision:Number.isSafeInteger(Number(provenance.configRevision))?Number(provenance.configRevision):null,targetEndpointId:shelf.target_endpoint_id,targetMountScopeId:shelf.target_mount_scope_id,targetMountScopeRevision:Number(shelf.target_mount_scope_revision)}),factDigests:Object.freeze(entryFacts.filter((row)=>row.fact_kind!=='decision_fact').map(acceptedFactDigest).sort()),decisionFactDigests:Object.freeze(entryFacts.filter((row)=>row.fact_kind==='decision_fact').map((row)=>row.fact_digest).sort()),history:Object.freeze({assessments:Object.freeze(entryAssessments),findings:Object.freeze(entryFindings),cases:Object.freeze(entryCases),commits:Object.freeze(commitsByEntry.get(entry.shelf_entry_id)||[])})});
      }).filter(Boolean));
    });
  }
  function listEntryPage(cursor,limit=100){const bounded=Math.max(1,Math.min(500,Number(limit)||100));return read((context)=>context.repository(arca.repositoryId).invoke('page_active_entries',{status:'active',rangeStart:'',rangeEnd:'\uffff',cursor,limit:bounded}).map((x)=>Object.freeze({cursor:x.shelf_entry_id,scope:Object.freeze({shelfEntryId:x.shelf_entry_id})})));}
  return Object.freeze({currentContext,recycleProtection,inventoryMaterials,defectStore,
    sourceTargetBinding:(shelfEntryId,material)=>read(context=>{const repo=context.repository(arca.repositoryId),
      entry=repo.invoke('find_entry',{shelf_entry_id:shelfEntryId}),shelf=entry&&repo.invoke('find_shelf',{shelf_id:entry.shelf_id});
      if(!shelf)fail('ARCA_SOURCE_TARGET_BINDING_MISSING','Source Shelf is absent.');
      return exactSourceTargetBinding(repo,shelf,material);}),commitAssessmentSet,createCase,admitCase,listCases,workDisplay,caseEvidence,listShelfEntryIds,terminateCase,getCase,
    refreshInventoryRecords:recordRefresh.commit,
    refreshInventoryPersonRecords:createPersonRecordRefreshStore(options,arca).commit,
    listWorkCases:careWork.list,
    getSettlementApproval,issueSettlementApproval,consumeSettlementApproval,staleSettlementApprovals,
    commitInventory,history,healthProjectionInputs,listEntryPage,
    ensureAftercareWorkspace:(caseId)=>workspaceStore.ensureWorkspace(caseId),
    aftercareWorkspaceLocation:(workspaceId,relativePath)=>workspaceStore.workspaceLocation(workspaceId,relativePath),
    aftercareWorkspaceRelativePath:(workspaceId,location)=>workspaceStore.workspaceRelativePath(workspaceId,location),
    registerAftercareWorkspaceMaterial:(handle,artifactHandle)=>workspaceStore.registerMaterial(handle,artifactHandle),
    resolveAftercareArtifact:(artifactHandle)=>workspaceStore.resolveArtifact(artifactHandle),
    listAftercareWorkspaceLifecyclePage:(cursor,limit)=>workspaceStore.listLifecyclePage(cursor,limit),
    scheduleAftercareWorkspace:(caseId,terminalAtMs)=>workspaceStore.schedule(caseId,terminalAtMs),
    auditAftercareWorkspaceReferences:(caseId,workId)=>workspaceStore.auditReferences(caseId,workId),
    ensureAftercareWorkspaceRoot:()=>workspaceStore.ensureRoot(),
    reconcileAftercareWorkspaceLifecycle:(caseId,settings)=>workspaceStore.reconcileLifecycle(caseId,settings),
    inspectAftercareWorkspaceLifecycle:(caseId)=>workspaceStore.inspectLifecycle(caseId),
    inspectAftercareWorkspaceLifecycleHead:(caseId)=>workspaceStore.inspectLifecycleHead(caseId),
    listAftercareWorkspaceHandles:(caseId)=>workspaceStore.listWorkspaceHandles(caseId),
    aftercareWorkspaceRootSnapshot:workspaceStore.rootSnapshot});
}

module.exports=Object.freeze({AftercareStoreError,createAftercareStore});
