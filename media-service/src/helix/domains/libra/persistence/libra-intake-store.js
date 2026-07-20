'use strict';

const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { CONTINUITY_HEAD_ID, continuityHeadDigest } = require('../model/libra-intake-contracts');

class LibraIntakeStoreError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'LibraIntakeStoreError'; this.code = code; this.details = details; }
}
function fail(code, message, details) { throw new LibraIntakeStoreError(code, message, details); }

const SUBJECT_COLUMNS = ['subject_id','structure_kind','content_profile','routing_anchor_intake_decision_id','status','intake_revision','current_continuity_set_digest',
  'current_episode_scope_digest','current_identity_revision','created_at_ms','updated_at_ms','terminal_at_ms'];
const DECISION_COLUMNS = ['intake_decision_id','decision_revision','decision_kind','offer_id','candidate_package_id','package_revision','package_digest',
  'acceptance_basis_digest','candidate_delivery_snapshot_digest','expected_continuity_head_revision','expected_continuity_head_digest',
  'source_field_id','source_field_access_revision','source_field_context_digest','candidate_structure_kind','candidate_content_profile','candidate_identity_claim_digest',
  'committed_continuity_head_revision','candidate_continuity_set_digest','candidate_episode_scope_digest','match_cardinality',
  'matched_subject_set_digest','episode_overlap_digest','accepted_result','target_subject_id','expected_target_status','expected_target_intake_revision',
  'expected_target_continuity_set_digest','expected_target_episode_scope_digest','committed_target_intake_revision',
  'committed_subject_continuity_set_digest','committed_subject_episode_scope_digest','accepted_payload_digest','rejection_schema_ref',
  'rejection_id','primary_rejection_code','rejection_reason_set_digest','rejection_digest','decision_digest','decided_at_ms'];

function createLibraIntakeRepositoryDefinitions(schemaManifest) {
  const subjects = createRepositoryDefinition({ repositoryId:'libra_subject_repository', owner:'libra', schemaManifest, statements:{
    find_head:{ kind:'select-one', tableId:'libra_subject_continuity_heads', columns:['head_id','current_revision','head_digest','updated_at_ms'], keyColumns:['head_id'] },
    insert_head:{ kind:'insert', tableId:'libra_subject_continuity_heads', columns:['head_id','current_revision','head_digest','updated_at_ms'] },
    advance_head:{ kind:'update', tableId:'libra_subject_continuity_heads', setColumns:['current_revision','head_digest','updated_at_ms'], keyColumns:['head_id'],
      compareColumns:[{ column:'current_revision', parameter:'expected_revision' },{ column:'head_digest', parameter:'expected_digest' }] },
    find_subject:{ kind:'select-one', tableId:'libra_subjects', columns:SUBJECT_COLUMNS, keyColumns:['subject_id'] },
    list_subjects:{ kind:'select-all', tableId:'libra_subjects', columns:SUBJECT_COLUMNS, keyColumns:[] },
    insert_subject:{ kind:'insert', tableId:'libra_subjects', columns:SUBJECT_COLUMNS },
    advance_subject:{ kind:'update', tableId:'libra_subjects',
      setColumns:['intake_revision','current_continuity_set_digest','current_episode_scope_digest','updated_at_ms'], keyColumns:['subject_id'],
      compareColumns:[{ column:'status', parameter:'expected_status' },{ column:'intake_revision', parameter:'expected_intake_revision' },
        { column:'current_continuity_set_digest', parameter:'expected_continuity_set_digest' },
        { column:'current_episode_scope_digest', parameter:'expected_episode_scope_digest' }] },
    insert_claim:{ kind:'insert', tableId:'libra_subject_season_continuity_claims', columns:['subject_id','claim_kind','claim_namespace','claim_key',
      'claim_digest','provenance_kind','provenance_ref','accepted_at_ms'] },
    find_claims:{ kind:'select-all', tableId:'libra_subject_season_continuity_claims', columns:['subject_id','claim_kind','claim_namespace','claim_key',
      'claim_digest','provenance_kind','provenance_ref','accepted_at_ms'], keyColumns:['subject_id'] },
    find_claim_matches:{ kind:'select-all', tableId:'libra_subject_season_continuity_claims', columns:['subject_id','claim_kind','claim_namespace','claim_key',
      'claim_digest','provenance_kind','provenance_ref','accepted_at_ms'], keyColumns:['claim_kind','claim_namespace','claim_key'] },
    insert_episode:{ kind:'insert', tableId:'libra_subject_episode_scopes', columns:['subject_id','episode_key','first_intake_decision_id','source_episode_scope_digest','accepted_at_ms'] },
    find_episodes:{ kind:'select-all', tableId:'libra_subject_episode_scopes', columns:['subject_id','episode_key','first_intake_decision_id','source_episode_scope_digest','accepted_at_ms'], keyColumns:['subject_id'] }
  }});
  const bindings = createRepositoryDefinition({ repositoryId:'libra_binding_repository', owner:'libra', schemaManifest, statements:{
    insert_binding:{ kind:'insert', tableId:'libra_material_bindings', columns:['subject_id','material_key','role','mount_scope_id','inode','content_hash_algorithm','content_hash','size_bytes','endpoint_id','location','binding_revision','health_state','evidence_digest','current'] },
    find_bindings:{ kind:'select-all', tableId:'libra_material_bindings', columns:['subject_id','material_key','role','mount_scope_id','inode','content_hash_algorithm','content_hash','size_bytes','endpoint_id','location','binding_revision','health_state','evidence_digest','current'], keyColumns:['subject_id'], safeIntegers:true },
    insert_binding_episode:{ kind:'insert', tableId:'libra_material_binding_episode_claims', columns:['subject_id','material_key','binding_revision','episode_key','season_claim_digest','claim_digest'] },
    find_binding_episodes:{ kind:'select-all', tableId:'libra_material_binding_episode_claims', columns:['subject_id','material_key','binding_revision','episode_key','season_claim_digest','claim_digest'], keyColumns:['subject_id','material_key','binding_revision'] }
  }});
  const intake = createRepositoryDefinition({ repositoryId:'libra_intake_decision_repository', owner:'libra', schemaManifest, statements:{
    insert_decision:{ kind:'insert', tableId:'libra_intake_decisions', columns:DECISION_COLUMNS },
    find_decision:{ kind:'select-one', tableId:'libra_intake_decisions', columns:DECISION_COLUMNS, keyColumns:['intake_decision_id'] },
    find_offer_decision:{ kind:'select-one', tableId:'libra_intake_decisions', columns:DECISION_COLUMNS, keyColumns:['offer_id'] },
    insert_match_witness:{ kind:'insert', tableId:'libra_intake_resolution_match_witnesses', columns:['intake_decision_id','ordinal','subject_id','expected_subject_status','expected_subject_intake_revision','expected_subject_continuity_set_digest','expected_subject_episode_scope_digest','claim_kind','claim_namespace','claim_key','candidate_claim_digest','subject_claim_digest','subject_claim_provenance_kind','subject_claim_provenance_ref','witness_digest'] },
    find_match_witnesses:{ kind:'select-all', tableId:'libra_intake_resolution_match_witnesses', columns:['intake_decision_id','ordinal','subject_id','expected_subject_status','expected_subject_intake_revision','expected_subject_continuity_set_digest','expected_subject_episode_scope_digest','claim_kind','claim_namespace','claim_key','candidate_claim_digest','subject_claim_digest','subject_claim_provenance_kind','subject_claim_provenance_ref','witness_digest'], keyColumns:['intake_decision_id'] },
    insert_overlap:{ kind:'insert', tableId:'libra_intake_resolution_episode_overlaps', columns:['intake_decision_id','subject_id','episode_key','overlap_digest'] },
    find_overlaps:{ kind:'select-all', tableId:'libra_intake_resolution_episode_overlaps', columns:['intake_decision_id','subject_id','episode_key','overlap_digest'], keyColumns:['intake_decision_id'] },
    insert_receipt:{ kind:'insert', tableId:'libra_handoff_a_receipts', columns:['receipt_id','intake_decision_id','outcome','offer_id','candidate_package_id','package_revision','package_digest','candidate_delivery_snapshot_digest','subject_id','subject_intake_revision','subject_continuity_head_revision','subject_continuity_set_digest','subject_episode_scope_digest','accepted_payload_digest','libra_binding_set_digest','control_revision_set_digest','rejection_id','primary_rejection_code','rejection_reason_set_digest','rejection_digest','receipt_digest','committed_at_ms'] },
    find_receipt:{ kind:'select-one', tableId:'libra_handoff_a_receipts', columns:['receipt_id','intake_decision_id','outcome','offer_id','candidate_package_id','package_revision','package_digest','candidate_delivery_snapshot_digest','subject_id','subject_intake_revision','subject_continuity_head_revision','subject_continuity_set_digest','subject_episode_scope_digest','accepted_payload_digest','libra_binding_set_digest','control_revision_set_digest','rejection_id','primary_rejection_code','rejection_reason_set_digest','rejection_digest','receipt_digest','committed_at_ms'], keyColumns:['intake_decision_id'] }
  }});
  return Object.freeze({ subjects, bindings, intake, tableIds:Object.freeze([...new Set([
    ...subjects.tableIds,...bindings.tableIds,...intake.tableIds
  ])].sort()) });
}

function createLibraIntakeStore(options) {
  if (!options || !options.schemaManifest || !options.unitOfWork || typeof options.unitOfWork.execute !== 'function') {
    fail('P8_INTAKE_STORE_DEPENDENCIES', 'Schema manifest and scoped Unit of Work are required.');
  }
  const repositories = createLibraIntakeRepositoryDefinitions(options.schemaManifest);
  const execute = (selected, body) => options.unitOfWork.execute([{ participantId:'libra_intake_store', owner:'libra', repositories:selected, execute:body }]).libra_intake_store;
  return Object.freeze({ repositoryManifest:Object.freeze({ owner:'libra', tableIds:repositories.tableIds }), repositories,
    ensureContinuityHead() {
      return execute([repositories.subjects], (context) => { const repository=context.repository(repositories.subjects.repositoryId);
        const existing=repository.invoke('find_head',{ head_id:CONTINUITY_HEAD_ID }); if (existing) return Object.freeze(existing);
        const row={ head_id:CONTINUITY_HEAD_ID,current_revision:0,head_digest:continuityHeadDigest(0),updated_at_ms:context.commitTimeMs };
        repository.invoke('insert_head',row); return Object.freeze(row); });
    },
    getSubject(subjectId) { return execute([repositories.subjects], (context) => context.repository(repositories.subjects.repositoryId).invoke('find_subject',{ subject_id:subjectId }) || null); },
    listSubjectClaims(subjectId) { return execute([repositories.subjects], (context) => context.repository(repositories.subjects.repositoryId).invoke('find_claims',{ subject_id:subjectId })); },
    listSubjectEpisodes(subjectId) { return execute([repositories.subjects], (context) => context.repository(repositories.subjects.repositoryId).invoke('find_episodes',{ subject_id:subjectId })); },
    listSubjectBindings(subjectId) { return execute([repositories.bindings], (context) => context.repository(repositories.bindings.repositoryId).invoke('find_bindings',{ subject_id:subjectId })); },
    listBindingEpisodes(subjectId, materialKey, bindingRevision) { return execute([repositories.bindings], (context) =>
      context.repository(repositories.bindings.repositoryId).invoke('find_binding_episodes',{
        subject_id:subjectId,material_key:materialKey,binding_revision:bindingRevision })); },
    findActiveContinuityMatches(claim) { return execute([repositories.subjects], (context) => { const repository=context.repository(repositories.subjects.repositoryId);
      return repository.invoke('find_claim_matches',{ claim_kind:claim.claimKind,claim_namespace:claim.claimNamespace,claim_key:claim.claimKey })
        .filter((row) => { const subject=repository.invoke('find_subject',{ subject_id:row.subject_id }); return subject && subject.status==='active'; }); }); }
  });
}

module.exports = Object.freeze({ LibraIntakeStoreError, createLibraIntakeRepositoryDefinitions, createLibraIntakeStore });
