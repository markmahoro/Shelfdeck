'use strict';

const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

class CandidateDeliveryReaderError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'CandidateDeliveryReaderError'; this.code = code; this.details = details; }
}
function fail(code, message) { throw new CandidateDeliveryReaderError(code, message); }

function createCandidateDeliveryReader(options) {
  if (!options || !options.schemaManifest || !options.unitOfWork || typeof options.unitOfWork.execute !== 'function') {
    fail('P8_CANDIDATE_DELIVERY_READER_DEPENDENCIES', 'Candidate Delivery requires a scoped Procurement Unit of Work.');
  }
  const repository = createRepositoryDefinition({ repositoryId:'candidate_delivery_reader', owner:'procurement',
    schemaManifest:options.schemaManifest, statements:{
      find_delivery:{ kind:'select-one', tableId:'proc_candidate_deliveries', columns:['offer_id','candidate_package_id','package_digest',
        'acceptance_basis_digest','state','handoff_receipt_id','offered_at_ms','closed_at_ms'], keyColumns:['offer_id'], safeIntegers:true },
      find_package:{ kind:'select-one', tableId:'proc_candidate_packages', columns:['candidate_package_id','procurement_run_id','package_revision',
        'field_id','field_access_revision','field_context_digest','media_type','content_profile','structure_kind','display_identity',
        'identity_metadata_schema_ref','identity_metadata_json','identity_metadata_digest','identity_claim_schema_ref','identity_claim_json',
        'identity_claim_digest','structure_evidence_id','structure_evidence_payload_digest','structure_unit_id','structure_unit_digest',
        'triage_rule_ref','triage_rule_revision','triage_rule_authority_digest','primary_input_manifest_id','manifest_digest',
        'related_reference_set_digest','member_control_evidence_set_digest','package_digest','state','published_at_ms'],
        keyColumns:['candidate_package_id'], safeIntegers:true },
      find_run:{ kind:'select-one', tableId:'proc_procurement_runs', columns:['procurement_run_id','run_basis_digest'],
        keyColumns:['procurement_run_id'] },
      list_continuity:{ kind:'select-all', tableId:'proc_candidate_season_continuity_claims', columns:['claim_kind','claim_namespace',
        'claim_key','claim_digest','evidence_digest'], keyColumns:['candidate_package_id'] },
      list_primary:{ kind:'select-all', tableId:'proc_candidate_primary_materials', columns:['ordinal','material_key','role','mount_scope_id','inode','size_bytes','fingerprint_algorithm','fingerprint_version','content_fingerprint','binding_revision',
        'admitted_control_revision','admitted_control_projection_digest','member_digest'], keyColumns:['candidate_package_id'], safeIntegers:true },
      list_episodes:{ kind:'select-all', tableId:'proc_candidate_primary_material_episode_claims', columns:['primary_ordinal','episode_key',
        'season_claim_digest','claim_digest'], keyColumns:['candidate_package_id'], safeIntegers:true },
      list_related:{ kind:'select-all', tableId:'proc_candidate_related_references', columns:['reference_id','primary_ordinal','role','material_key',
        'mount_scope_id','inode','size_bytes','fingerprint_algorithm','fingerprint_version','content_fingerprint','endpoint_id','location',
        'association_evidence_digest','reference_digest'], keyColumns:['candidate_package_id'], safeIntegers:true },
      list_run_members:{ kind:'select-all', tableId:'proc_run_materials', columns:['ordinal','material_key','mount_scope_id','inode','size_bytes','fingerprint_algorithm','fingerprint_version','content_fingerprint','binding_revision','last_snapshot_digest',
        'endpoint_id','location','reality_digest','provenance_digest','admitted_control_revision','admitted_control_projection_digest',
        'selection_state','candidate_package_id'], keyColumns:['procurement_run_id'], safeIntegers:true }
    } });
  return Object.freeze({ repositoryManifest:Object.freeze({ owner:'procurement', tableIds:repository.tableIds }),
    readRows(query) {
      return options.unitOfWork.execute([{ participantId:'candidate_delivery_read', owner:'procurement', repositories:[repository], execute(context) {
        const repo = context.repository(repository.repositoryId);
        const delivery = repo.invoke('find_delivery', { offer_id:query.offerId });
        if (!delivery) return null;
        const candidatePackage = repo.invoke('find_package', { candidate_package_id:delivery.candidate_package_id });
        if (!candidatePackage) fail('P8_CANDIDATE_DELIVERY_PACKAGE_MISSING', 'Offer points to a missing Candidate Package.');
        const candidate_package_id = delivery.candidate_package_id;
        const run = repo.invoke('find_run', { procurement_run_id:candidatePackage.procurement_run_id });
        if (!run) fail('P8_CANDIDATE_DELIVERY_RUN_MISSING', 'Candidate Package points to a missing immutable Run Basis.');
        return Object.freeze({ delivery, candidatePackage, run,
          continuity:repo.invoke('list_continuity', { candidate_package_id }),
          primaries:repo.invoke('list_primary', { candidate_package_id }),
          episodes:repo.invoke('list_episodes', { candidate_package_id }),
          related:repo.invoke('list_related', { candidate_package_id }),
          runMembers:repo.invoke('list_run_members', { procurement_run_id:candidatePackage.procurement_run_id }) });
      }}]).candidate_delivery_read;
    } });
}

module.exports = Object.freeze({ CandidateDeliveryReaderError, createCandidateDeliveryReader });
