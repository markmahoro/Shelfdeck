'use strict';

module.exports = Object.freeze({
    insert_representation:{kind:'insert',tableId:'arca_inventory_representations',columns:['shelf_entry_id','revision','representation_digest','source_package_id','committed_at_ms']},
    clear_active_material_guards:{kind:'update',tableId:'arca_inventory_materials',setColumns:['active_guard'],keyColumns:['shelf_entry_id','inventory_revision']},
    insert_material:{kind:'insert',tableId:'arca_inventory_materials',columns:['shelf_entry_id','inventory_revision','ordinal','material_key','role','episode_claims_schema_ref','episode_claims_json','episode_claim_set_digest','endpoint_id','location','binding_revision','mount_scope_id','inode','fingerprint_algorithm','fingerprint_version','content_fingerprint','digest_hex','size_bytes','artifact_scope_schema_ref','artifact_scope_json','active_guard']},
    insert_related:{kind:'insert',tableId:'arca_inventory_related_references',columns:['shelf_entry_id','inventory_revision','reference_id','primary_ordinal','role','reference_kind','material_identity_hint','endpoint_id','location','checksum_hex']},
    insert_fact:{kind:'insert',tableId:'arca_inventory_product_facts',columns:['shelf_entry_id','inventory_revision','fact_kind','fact_revision','fact_schema_ref','fact_json','episode_metadata_schema_ref','episode_metadata_json','fact_digest','source_package_id','provenance_digest','committed_at_ms']},
    insert_person:{kind:'insert',tableId:'arca_inventory_person_relations',columns:['relation_id','shelf_entry_id','inventory_revision','person_id','display_name','display_name_normalized','role','relation_source','provider_identity_schema_ref','provider_identity_json','provider_identity_digest','origin_evidence_digest','confidence_class','relation_digest']},
    advance_inventory:{kind:'update',tableId:'arca_shelf_entries',setColumns:['current_inventory_revision'],keyColumns:['shelf_entry_id'],compareColumns:[{column:'current_inventory_revision',parameter:'expected_current_inventory_revision'}]},
});
