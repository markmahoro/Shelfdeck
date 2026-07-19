-- Generated from the frozen Helix P2 table contracts. Do not edit.
-- Clean generation only; no historical runtime objects are represented.

CREATE TABLE "arca_acceptance_attempts" (
  "acceptance_attempt_id" TEXT PRIMARY KEY,
  "offer_id" TEXT,
  "on_deck_package_id" TEXT,
  "package_digest" TEXT CHECK (length("package_digest") = 64 AND "package_digest" NOT GLOB '*[^0-9a-f]*'),
  "shelf_id" TEXT,
  "standard_revision" INTEGER CHECK ("standard_revision" >= 1),
  "placement_revision" INTEGER CHECK ("placement_revision" >= 1),
  "state" TEXT CHECK ("state" IN ('active', 'accepted', 'rejected')),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "finished_at_ms" INTEGER CHECK ("finished_at_ms" >= 0),
  FOREIGN KEY ("shelf_id") REFERENCES "arca_shelves" ("shelf_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_arca_acceptance_attempts_hot_01" ON "arca_acceptance_attempts" ("state", "created_at_ms");
CREATE UNIQUE INDEX "uidx_arca_acceptance_attempts_partial_01" ON "arca_acceptance_attempts" ("package_digest", "standard_revision", "placement_revision") WHERE "finished_at_ms" IS NULL;

CREATE TABLE "arca_acceptance_checks" (
  "acceptance_attempt_id" TEXT,
  "check_kind" TEXT,
  "check_revision" INTEGER CHECK ("check_revision" >= 1),
  "result" TEXT,
  "evidence_digest" TEXT CHECK (length("evidence_digest") = 64 AND "evidence_digest" NOT GLOB '*[^0-9a-f]*'),
  "completed_at_ms" INTEGER CHECK ("completed_at_ms" >= 0),
  PRIMARY KEY ("acceptance_attempt_id", "check_kind", "check_revision"),
  FOREIGN KEY ("acceptance_attempt_id") REFERENCES "arca_acceptance_attempts" ("acceptance_attempt_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_acceptance_decisions" (
  "acceptance_decision_id" TEXT PRIMARY KEY,
  "acceptance_attempt_id" TEXT,
  "result" TEXT CHECK ("result" IN ('accepted', 'rejected')),
  "offer_id" TEXT,
  "on_deck_package_id" TEXT,
  "package_digest" TEXT CHECK (length("package_digest") = 64 AND "package_digest" NOT GLOB '*[^0-9a-f]*'),
  "shelf_id" TEXT,
  "standard_revision" INTEGER CHECK ("standard_revision" >= 1),
  "placement_revision" INTEGER CHECK ("placement_revision" >= 1),
  "acceptance_evidence_set_digest" TEXT CHECK (length("acceptance_evidence_set_digest") = 64 AND "acceptance_evidence_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "rejection_schema_ref" TEXT,
  "rejection_code" TEXT,
  "rejection_digest" TEXT CHECK (length("rejection_digest") = 64 AND "rejection_digest" NOT GLOB '*[^0-9a-f]*'),
  "decision_digest" TEXT CHECK (length("decision_digest") = 64 AND "decision_digest" NOT GLOB '*[^0-9a-f]*'),
  "decided_at_ms" INTEGER CHECK ("decided_at_ms" >= 0),
  UNIQUE ("acceptance_attempt_id"),
  FOREIGN KEY ("acceptance_attempt_id") REFERENCES "arca_acceptance_attempts" ("acceptance_attempt_id") ON DELETE RESTRICT,
  FOREIGN KEY ("shelf_id") REFERENCES "arca_shelves" ("shelf_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_aftercare_assessments" (
  "assessment_id" TEXT PRIMARY KEY,
  "shelf_entry_id" TEXT,
  "inventory_revision" INTEGER CHECK ("inventory_revision" >= 1),
  "standard_revision" INTEGER CHECK ("standard_revision" >= 1),
  "placement_revision" INTEGER CHECK ("placement_revision" >= 1),
  "decision_fact_set_digest" TEXT CHECK (length("decision_fact_set_digest") = 64 AND "decision_fact_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "care_basis_digest" TEXT CHECK (length("care_basis_digest") = 64 AND "care_basis_digest" NOT GLOB '*[^0-9a-f]*'),
  "assessment_kind" TEXT,
  "result" TEXT,
  "evidence_digest" TEXT CHECK (length("evidence_digest") = 64 AND "evidence_digest" NOT GLOB '*[^0-9a-f]*'),
  "assessed_at_ms" INTEGER CHECK ("assessed_at_ms" >= 0),
  UNIQUE ("shelf_entry_id", "care_basis_digest", "assessment_kind"),
  FOREIGN KEY ("shelf_entry_id") REFERENCES "arca_shelf_entries" ("shelf_entry_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_arca_aftercare_assessments_hot_01" ON "arca_aftercare_assessments" ("result", "assessed_at_ms");

CREATE TABLE "arca_aftercare_case_basis_inputs" (
  "aftercare_case_id" TEXT,
  "input_kind" TEXT,
  "owner_domain" TEXT,
  "aggregate_type" TEXT,
  "aggregate_id" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "input_digest" TEXT CHECK (length("input_digest") = 64 AND "input_digest" NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY ("aftercare_case_id", "input_kind", "owner_domain", "aggregate_type", "aggregate_id"),
  FOREIGN KEY ("aftercare_case_id") REFERENCES "arca_aftercare_cases" ("aftercare_case_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_aftercare_cases" (
  "aftercare_case_id" TEXT PRIMARY KEY,
  "shelf_entry_id" TEXT,
  "finding_set_digest" TEXT CHECK (length("finding_set_digest") = 64 AND "finding_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "care_basis_schema_ref" TEXT,
  "care_basis_json" TEXT,
  "care_basis_digest" TEXT CHECK (length("care_basis_digest") = 64 AND "care_basis_digest" NOT GLOB '*[^0-9a-f]*'),
  "care_requirement_schema_ref" TEXT,
  "care_requirement_json" TEXT,
  "care_requirement_digest" TEXT CHECK (length("care_requirement_digest") = 64 AND "care_requirement_digest" NOT GLOB '*[^0-9a-f]*'),
  "state" TEXT CHECK ("state" IN ('active', 'resolved', 'invalidated', 'unresolved')),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "terminal_at_ms" INTEGER CHECK ("terminal_at_ms" >= 0),
  CHECK (json_valid("care_basis_json")),
  CHECK (length(CAST("care_basis_json" AS BLOB)) <= 65536),
  CHECK (json_valid("care_requirement_json")),
  CHECK (length(CAST("care_requirement_json" AS BLOB)) <= 65536),
  FOREIGN KEY ("shelf_entry_id") REFERENCES "arca_shelf_entries" ("shelf_entry_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_arca_aftercare_cases_hot_01" ON "arca_aftercare_cases" ("state", "created_at_ms");
CREATE UNIQUE INDEX "uidx_arca_aftercare_cases_partial_01" ON "arca_aftercare_cases" ("care_basis_digest", "finding_set_digest", "care_requirement_digest") WHERE "terminal_at_ms" IS NULL;

CREATE TABLE "arca_aftercare_findings" (
  "finding_id" TEXT PRIMARY KEY,
  "assessment_id" TEXT,
  "finding_kind" TEXT,
  "severity" TEXT,
  "repairability" TEXT,
  "finding_digest" TEXT CHECK (length("finding_digest") = 64 AND "finding_digest" NOT GLOB '*[^0-9a-f]*'),
  "state" TEXT CHECK ("state" IN ('open', 'resolved', 'superseded')),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  FOREIGN KEY ("assessment_id") REFERENCES "arca_aftercare_assessments" ("assessment_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_arca_aftercare_findings_hot_01" ON "arca_aftercare_findings" ("state", "repairability", "severity", "created_at_ms");

CREATE TABLE "arca_aftercare_inventory_commits" (
  "inventory_commit_id" TEXT PRIMARY KEY,
  "aftercare_case_id" TEXT,
  "shelf_entry_id" TEXT,
  "previous_inventory_revision" INTEGER CHECK ("previous_inventory_revision" >= 1),
  "new_inventory_revision" INTEGER CHECK ("new_inventory_revision" >= 1),
  "control_change_digest" TEXT CHECK (length("control_change_digest") = 64 AND "control_change_digest" NOT GLOB '*[^0-9a-f]*'),
  "commit_digest" TEXT CHECK (length("commit_digest") = 64 AND "commit_digest" NOT GLOB '*[^0-9a-f]*'),
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  UNIQUE ("aftercare_case_id", "new_inventory_revision"),
  FOREIGN KEY ("aftercare_case_id") REFERENCES "arca_aftercare_cases" ("aftercare_case_id") ON DELETE RESTRICT,
  FOREIGN KEY ("shelf_entry_id") REFERENCES "arca_shelf_entries" ("shelf_entry_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_aftercare_settlement_approvals" (
  "approval_id" TEXT PRIMARY KEY,
  "aftercare_case_id" TEXT,
  "settlement_scope_digest" TEXT CHECK (length("settlement_scope_digest") = 64 AND "settlement_scope_digest" NOT GLOB '*[^0-9a-f]*'),
  "service_catalog_revision" INTEGER CHECK ("service_catalog_revision" >= 1),
  "shelf_standard_revision" INTEGER CHECK ("shelf_standard_revision" >= 1),
  "care_basis_digest" TEXT CHECK (length("care_basis_digest") = 64 AND "care_basis_digest" NOT GLOB '*[^0-9a-f]*'),
  "derived_at_ms" INTEGER CHECK ("derived_at_ms" >= 0),
  "state" TEXT CHECK ("state" IN ('active', 'consumed', 'stale')),
  UNIQUE ("aftercare_case_id", "settlement_scope_digest"),
  FOREIGN KEY ("aftercare_case_id") REFERENCES "arca_aftercare_cases" ("aftercare_case_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_canonical_identity_revisions" (
  "shelf_entry_id" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "structure_kind" TEXT,
  "identity_kind" TEXT,
  "provider" TEXT,
  "provider_key" TEXT,
  "identity_digest" TEXT CHECK (length("identity_digest") = 64 AND "identity_digest" NOT GLOB '*[^0-9a-f]*'),
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  PRIMARY KEY ("shelf_entry_id", "revision"),
  FOREIGN KEY ("shelf_entry_id") REFERENCES "arca_shelf_entries" ("shelf_entry_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_arca_canonical_identity_revisions_hot_01" ON "arca_canonical_identity_revisions" ("provider", "provider_key", "structure_kind");

CREATE TABLE "arca_deck_fact_revisions" (
  "shelf_entry_id" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "state" TEXT CHECK ("state" IN ('active', 'offdeck_in_progress', 'offdecked', 'deregistered')),
  "inventory_revision" INTEGER CHECK ("inventory_revision" >= 1),
  "standard_revision" INTEGER CHECK ("standard_revision" >= 1),
  "fact_digest" TEXT CHECK (length("fact_digest") = 64 AND "fact_digest" NOT GLOB '*[^0-9a-f]*'),
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  PRIMARY KEY ("shelf_entry_id", "revision"),
  FOREIGN KEY ("shelf_entry_id") REFERENCES "arca_shelf_entries" ("shelf_entry_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_deregistration_receipts" (
  "receipt_id" TEXT PRIMARY KEY,
  "deregistration_id" TEXT,
  "shelf_id" TEXT,
  "released_control_set_digest" TEXT CHECK (length("released_control_set_digest") = 64 AND "released_control_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "terminal_fact_digest" TEXT CHECK (length("terminal_fact_digest") = 64 AND "terminal_fact_digest" NOT GLOB '*[^0-9a-f]*'),
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  UNIQUE ("deregistration_id"),
  FOREIGN KEY ("deregistration_id") REFERENCES "arca_deregistrations" ("deregistration_id") ON DELETE RESTRICT,
  FOREIGN KEY ("shelf_id") REFERENCES "arca_shelves" ("shelf_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_deregistration_releases" (
  "deregistration_id" TEXT,
  "material_key" TEXT,
  "control_revision" INTEGER CHECK ("control_revision" >= 1),
  "release_result" TEXT,
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  PRIMARY KEY ("deregistration_id", "material_key"),
  FOREIGN KEY ("deregistration_id") REFERENCES "arca_deregistrations" ("deregistration_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_deregistrations" (
  "deregistration_id" TEXT PRIMARY KEY,
  "shelf_id" TEXT,
  "release_manifest_digest" TEXT CHECK (length("release_manifest_digest") = 64 AND "release_manifest_digest" NOT GLOB '*[^0-9a-f]*'),
  "state" TEXT CHECK ("state" IN ('active', 'committed')),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  FOREIGN KEY ("shelf_id") REFERENCES "arca_shelves" ("shelf_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_final_inventory_decisions" (
  "final_inventory_decision_id" TEXT PRIMARY KEY,
  "on_deck_run_id" TEXT,
  "shelf_id" TEXT,
  "placement_revision" INTEGER CHECK ("placement_revision" >= 1),
  "target_endpoint_id" TEXT,
  "target_location" TEXT,
  "product_manifest_digest" TEXT CHECK (length("product_manifest_digest") = 64 AND "product_manifest_digest" NOT GLOB '*[^0-9a-f]*'),
  "offload_context_digest" TEXT CHECK (length("offload_context_digest") = 64 AND "offload_context_digest" NOT GLOB '*[^0-9a-f]*'),
  "decision_schema_ref" TEXT,
  "decision_json" TEXT,
  "decision_digest" TEXT CHECK (length("decision_digest") = 64 AND "decision_digest" NOT GLOB '*[^0-9a-f]*'),
  "decided_at_ms" INTEGER CHECK ("decided_at_ms" >= 0),
  UNIQUE ("on_deck_run_id"),
  CHECK (json_valid("decision_json")),
  CHECK (length(CAST("decision_json" AS BLOB)) <= 65536),
  FOREIGN KEY ("on_deck_run_id") REFERENCES "arca_ondeck_runs" ("on_deck_run_id") ON DELETE RESTRICT,
  FOREIGN KEY ("shelf_id") REFERENCES "arca_shelves" ("shelf_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_handoff_b_receipts" (
  "receipt_id" TEXT PRIMARY KEY,
  "acceptance_decision_id" TEXT,
  "outcome" TEXT CHECK ("outcome" IN ('accepted', 'rejected')),
  "offer_id" TEXT,
  "custody_id" TEXT,
  "on_deck_package_id" TEXT,
  "package_digest" TEXT CHECK (length("package_digest") = 64 AND "package_digest" NOT GLOB '*[^0-9a-f]*'),
  "arca_binding_set_digest" TEXT CHECK (length("arca_binding_set_digest") = 64 AND "arca_binding_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "control_revision_set_digest" TEXT CHECK (length("control_revision_set_digest") = 64 AND "control_revision_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "rejection_code" TEXT,
  "acceptance_evidence_set_digest" TEXT CHECK (length("acceptance_evidence_set_digest") = 64 AND "acceptance_evidence_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "rejection_digest" TEXT CHECK (length("rejection_digest") = 64 AND "rejection_digest" NOT GLOB '*[^0-9a-f]*'),
  "receipt_digest" TEXT CHECK (length("receipt_digest") = 64 AND "receipt_digest" NOT GLOB '*[^0-9a-f]*'),
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  UNIQUE ("acceptance_decision_id"),
  UNIQUE ("offer_id"),
  FOREIGN KEY ("acceptance_decision_id") REFERENCES "arca_acceptance_decisions" ("acceptance_decision_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_input_settlement_authorization_head" (
  "singleton_key" TEXT PRIMARY KEY,
  "current_authorization_id" TEXT,
  "current_revision" INTEGER CHECK ("current_revision" >= 1),
  "updated_at_ms" INTEGER CHECK ("updated_at_ms" >= 0),
  FOREIGN KEY ("current_authorization_id", "current_revision") REFERENCES "arca_input_settlement_authorizations" ("authorization_id", "revision") ON DELETE RESTRICT
);

CREATE TABLE "arca_input_settlement_authorizations" (
  "authorization_id" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "state" TEXT CHECK ("state" IN ('enabled', 'revoked')),
  "authorization_scope_kind" TEXT,
  "actor_id" TEXT,
  "authorization_digest" TEXT CHECK (length("authorization_digest") = 64 AND "authorization_digest" NOT GLOB '*[^0-9a-f]*'),
  "effective_at_ms" INTEGER CHECK ("effective_at_ms" >= 0),
  "revoked_at_ms" INTEGER CHECK ("revoked_at_ms" >= 0),
  PRIMARY KEY ("authorization_id", "revision")
);

CREATE TABLE "arca_inventory_materials" (
  "shelf_entry_id" TEXT,
  "inventory_revision" INTEGER CHECK ("inventory_revision" >= 1),
  "ordinal" INTEGER CHECK ("ordinal" >= 0),
  "material_key" TEXT,
  "role" TEXT,
  "episode_key" TEXT,
  "endpoint_id" TEXT,
  "location" TEXT,
  "binding_revision" INTEGER CHECK ("binding_revision" >= 1),
  "digest_hex" TEXT CHECK (length("digest_hex") = 64 AND "digest_hex" NOT GLOB '*[^0-9a-f]*'),
  "size_bytes" INTEGER CHECK ("size_bytes" >= 0),
  "active_guard" INTEGER NOT NULL DEFAULT 0 CHECK ("active_guard" IN (0, 1)),
  PRIMARY KEY ("shelf_entry_id", "inventory_revision", "ordinal"),
  FOREIGN KEY ("shelf_entry_id") REFERENCES "arca_shelf_entries" ("shelf_entry_id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "uidx_arca_inventory_materials_partial_01" ON "arca_inventory_materials" ("material_key") WHERE "role" = 'primary' AND "active_guard" = 1;

CREATE TABLE "arca_inventory_person_relations" (
  "relation_id" TEXT,
  "shelf_entry_id" TEXT,
  "inventory_revision" INTEGER CHECK ("inventory_revision" >= 1),
  "person_id" TEXT,
  "display_name" TEXT,
  "display_name_normalized" TEXT,
  "role" TEXT,
  "relation_source" TEXT,
  "provider_identity_schema_ref" TEXT,
  "provider_identity_json" TEXT,
  "provider_identity_digest" TEXT CHECK (length("provider_identity_digest") = 64 AND "provider_identity_digest" NOT GLOB '*[^0-9a-f]*'),
  "origin_evidence_digest" TEXT CHECK (length("origin_evidence_digest") = 64 AND "origin_evidence_digest" NOT GLOB '*[^0-9a-f]*'),
  "confidence_class" TEXT,
  "relation_digest" TEXT CHECK (length("relation_digest") = 64 AND "relation_digest" NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY ("shelf_entry_id", "inventory_revision", "relation_id"),
  UNIQUE ("shelf_entry_id", "inventory_revision", "relation_digest"),
  CHECK (json_valid("provider_identity_json")),
  CHECK (length(CAST("provider_identity_json" AS BLOB)) <= 4096),
  FOREIGN KEY ("shelf_entry_id") REFERENCES "arca_shelf_entries" ("shelf_entry_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_arca_inventory_person_relations_hot_01" ON "arca_inventory_person_relations" ("person_id", "role", "shelf_entry_id");

CREATE TABLE "arca_inventory_product_facts" (
  "shelf_entry_id" TEXT,
  "inventory_revision" INTEGER CHECK ("inventory_revision" >= 1),
  "fact_kind" TEXT,
  "fact_revision" INTEGER CHECK ("fact_revision" >= 1),
  "fact_schema_ref" TEXT,
  "fact_json" TEXT,
  "fact_digest" TEXT CHECK (length("fact_digest") = 64 AND "fact_digest" NOT GLOB '*[^0-9a-f]*'),
  "source_package_id" TEXT,
  "provenance_digest" TEXT CHECK (length("provenance_digest") = 64 AND "provenance_digest" NOT GLOB '*[^0-9a-f]*'),
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  PRIMARY KEY ("shelf_entry_id", "inventory_revision", "fact_kind", "fact_revision"),
  CHECK (json_valid("fact_json")),
  CHECK (length(CAST("fact_json" AS BLOB)) <= 65536),
  FOREIGN KEY ("shelf_entry_id") REFERENCES "arca_shelf_entries" ("shelf_entry_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_inventory_related_references" (
  "shelf_entry_id" TEXT,
  "inventory_revision" INTEGER CHECK ("inventory_revision" >= 1),
  "reference_id" TEXT,
  "primary_ordinal" INTEGER CHECK ("primary_ordinal" >= 0),
  "role" TEXT,
  "material_identity_hint" TEXT,
  "endpoint_id" TEXT,
  "location" TEXT,
  "checksum_hex" TEXT,
  PRIMARY KEY ("shelf_entry_id", "inventory_revision", "reference_id"),
  FOREIGN KEY ("shelf_entry_id") REFERENCES "arca_shelf_entries" ("shelf_entry_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_inventory_representations" (
  "shelf_entry_id" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "representation_digest" TEXT CHECK (length("representation_digest") = 64 AND "representation_digest" NOT GLOB '*[^0-9a-f]*'),
  "source_package_id" TEXT,
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  PRIMARY KEY ("shelf_entry_id", "revision"),
  FOREIGN KEY ("shelf_entry_id") REFERENCES "arca_shelf_entries" ("shelf_entry_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_material_bindings" (
  "owner_object_type" TEXT,
  "owner_object_id" TEXT,
  "material_key" TEXT,
  "role" TEXT,
  "episode_key" TEXT,
  "endpoint_id" TEXT,
  "location" TEXT,
  "binding_revision" INTEGER CHECK ("binding_revision" >= 1),
  "health_state" TEXT CHECK ("health_state" IN ('active', 'stale', 'released')),
  "evidence_digest" TEXT CHECK (length("evidence_digest") = 64 AND "evidence_digest" NOT GLOB '*[^0-9a-f]*'),
  "current" INTEGER CHECK ("current" IN (0, 1)),
  PRIMARY KEY ("owner_object_type", "owner_object_id", "material_key", "role", "binding_revision")
);

CREATE TABLE "arca_offdeck_authorization_batches" (
  "batch_id" TEXT PRIMARY KEY,
  "review_id" TEXT,
  "selection_receipt_id" TEXT,
  "escalation_receipt_id" TEXT,
  "scope_set_digest" TEXT CHECK (length("scope_set_digest") = 64 AND "scope_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "actor_id" TEXT,
  "authorized_at_ms" INTEGER CHECK ("authorized_at_ms" >= 0),
  UNIQUE ("review_id", "scope_set_digest"),
  FOREIGN KEY ("review_id") REFERENCES "arca_offdeck_reviews" ("review_id") ON DELETE RESTRICT,
  FOREIGN KEY ("selection_receipt_id") REFERENCES "arca_offdeck_selection_receipts" ("selection_receipt_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_offdeck_authorizations" (
  "authorization_id" TEXT PRIMARY KEY,
  "destruction_scope_id" TEXT,
  "scope_digest" TEXT CHECK (length("scope_digest") = 64 AND "scope_digest" NOT GLOB '*[^0-9a-f]*'),
  "actor_id" TEXT,
  "batch_id" TEXT,
  "authorized_at_ms" INTEGER CHECK ("authorized_at_ms" >= 0),
  "state" TEXT CHECK ("state" IN ('active', 'consumed', 'revoked', 'stale')),
  UNIQUE ("destruction_scope_id", "scope_digest"),
  FOREIGN KEY ("destruction_scope_id") REFERENCES "arca_offdeck_scopes" ("destruction_scope_id") ON DELETE RESTRICT,
  FOREIGN KEY ("batch_id") REFERENCES "arca_offdeck_authorization_batches" ("batch_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_offdeck_cases" (
  "offdeck_case_id" TEXT PRIMARY KEY,
  "authorization_id" TEXT,
  "shelf_entry_id" TEXT,
  "origin_kind" TEXT,
  "origin_ref" TEXT,
  "state" TEXT CHECK ("state" IN ('ready', 'destroying', 'verifying', 'blocked', 'completed')),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "terminal_at_ms" INTEGER CHECK ("terminal_at_ms" >= 0),
  UNIQUE ("authorization_id"),
  FOREIGN KEY ("authorization_id") REFERENCES "arca_offdeck_authorizations" ("authorization_id") ON DELETE RESTRICT,
  FOREIGN KEY ("shelf_entry_id") REFERENCES "arca_shelf_entries" ("shelf_entry_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_offdeck_deletion_evidence" (
  "destruction_scope_id" TEXT,
  "material_key" TEXT,
  "effect_id" TEXT,
  "result" TEXT,
  "reality_digest" TEXT CHECK (length("reality_digest") = 64 AND "reality_digest" NOT GLOB '*[^0-9a-f]*'),
  "completed_at_ms" INTEGER CHECK ("completed_at_ms" >= 0),
  PRIMARY KEY ("destruction_scope_id", "material_key"),
  FOREIGN KEY ("destruction_scope_id") REFERENCES "arca_offdeck_scopes" ("destruction_scope_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_offdeck_duplicate_group_members" (
  "duplicate_group_id" TEXT,
  "shelf_entry_id" TEXT,
  "inventory_revision" INTEGER CHECK ("inventory_revision" >= 1),
  "member_digest" TEXT CHECK (length("member_digest") = 64 AND "member_digest" NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY ("duplicate_group_id", "shelf_entry_id"),
  FOREIGN KEY ("duplicate_group_id") REFERENCES "arca_offdeck_duplicate_groups" ("duplicate_group_id") ON DELETE RESTRICT,
  FOREIGN KEY ("shelf_entry_id") REFERENCES "arca_shelf_entries" ("shelf_entry_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_offdeck_duplicate_groups" (
  "duplicate_group_id" TEXT PRIMARY KEY,
  "canonical_identity_digest" TEXT CHECK (length("canonical_identity_digest") = 64 AND "canonical_identity_digest" NOT GLOB '*[^0-9a-f]*'),
  "member_set_digest" TEXT CHECK (length("member_set_digest") = 64 AND "member_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "state" TEXT CHECK ("state" IN ('open', 'resolved', 'whitelisted', 'stale')),
  "detected_at_ms" INTEGER CHECK ("detected_at_ms" >= 0),
  "superseded_at_ms" INTEGER CHECK ("superseded_at_ms" >= 0),
  UNIQUE ("canonical_identity_digest", "member_set_digest")
);

CREATE TABLE "arca_offdeck_duplicate_whitelists" (
  "whitelist_id" TEXT PRIMARY KEY,
  "duplicate_group_id" TEXT,
  "member_set_digest" TEXT CHECK (length("member_set_digest") = 64 AND "member_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "state" TEXT CHECK ("state" IN ('active', 'revoked', 'stale')),
  "actor_id" TEXT,
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "revoked_at_ms" INTEGER CHECK ("revoked_at_ms" >= 0),
  FOREIGN KEY ("duplicate_group_id") REFERENCES "arca_offdeck_duplicate_groups" ("duplicate_group_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_offdeck_escalation_receipts" (
  "escalation_receipt_id" TEXT PRIMARY KEY,
  "selection_receipt_id" TEXT,
  "scope_set_digest" TEXT CHECK (length("scope_set_digest") = 64 AND "scope_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "actor_id" TEXT,
  "confirmed_at_ms" INTEGER CHECK ("confirmed_at_ms" >= 0),
  UNIQUE ("selection_receipt_id"),
  FOREIGN KEY ("selection_receipt_id") REFERENCES "arca_offdeck_selection_receipts" ("selection_receipt_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_offdeck_policy_heads" (
  "policy_id" TEXT PRIMARY KEY,
  "current_revision" INTEGER CHECK ("current_revision" >= 1),
  "status" TEXT CHECK ("status" IN ('active', 'disabled')),
  "updated_at_ms" INTEGER CHECK ("updated_at_ms" >= 0),
  FOREIGN KEY ("policy_id", "current_revision") REFERENCES "arca_offdeck_policy_revisions" ("policy_id", "revision") ON DELETE RESTRICT
);

CREATE TABLE "arca_offdeck_policy_revisions" (
  "policy_id" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "condition_group_schema_ref" TEXT,
  "condition_group_json" TEXT,
  "policy_digest" TEXT CHECK (length("policy_digest") = 64 AND "policy_digest" NOT GLOB '*[^0-9a-f]*'),
  "effective_at_ms" INTEGER CHECK ("effective_at_ms" >= 0),
  PRIMARY KEY ("policy_id", "revision"),
  CHECK (json_valid("condition_group_json")),
  CHECK (length(CAST("condition_group_json" AS BLOB)) <= 65536)
);

CREATE TABLE "arca_offdeck_reservations" (
  "reservation_id" TEXT PRIMARY KEY,
  "review_id" TEXT,
  "shelf_entry_id" TEXT,
  "inventory_revision" INTEGER CHECK ("inventory_revision" >= 1),
  "control_scope_digest" TEXT CHECK (length("control_scope_digest") = 64 AND "control_scope_digest" NOT GLOB '*[^0-9a-f]*'),
  "state" TEXT CHECK ("state" IN ('active', 'released', 'consumed', 'stale')),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "released_at_ms" INTEGER CHECK ("released_at_ms" >= 0),
  FOREIGN KEY ("review_id") REFERENCES "arca_offdeck_reviews" ("review_id") ON DELETE RESTRICT,
  FOREIGN KEY ("shelf_entry_id") REFERENCES "arca_shelf_entries" ("shelf_entry_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_arca_offdeck_reservations_hot_01" ON "arca_offdeck_reservations" ("state", "created_at_ms");
CREATE UNIQUE INDEX "uidx_arca_offdeck_reservations_partial_01" ON "arca_offdeck_reservations" ("shelf_entry_id") WHERE "state" = 'active';

CREATE TABLE "arca_offdeck_review_candidates" (
  "candidate_id" TEXT PRIMARY KEY,
  "shelf_entry_id" TEXT,
  "policy_id" TEXT,
  "policy_revision" INTEGER CHECK ("policy_revision" >= 1),
  "reason_digest" TEXT CHECK (length("reason_digest") = 64 AND "reason_digest" NOT GLOB '*[^0-9a-f]*'),
  "state" TEXT CHECK ("state" IN ('open', 'selected', 'dismissed', 'stale')),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  FOREIGN KEY ("shelf_entry_id") REFERENCES "arca_shelf_entries" ("shelf_entry_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_arca_offdeck_review_candidates_hot_01" ON "arca_offdeck_review_candidates" ("state", "created_at_ms");
CREATE UNIQUE INDEX "uidx_arca_offdeck_review_candidates_partial_01" ON "arca_offdeck_review_candidates" ("shelf_entry_id", "policy_id", "policy_revision", "reason_digest") WHERE "state" = 'open';

CREATE TABLE "arca_offdeck_reviews" (
  "review_id" TEXT PRIMARY KEY,
  "origin_kind" TEXT CHECK ("origin_kind" IN ('candidate', 'duplicate_group', 'direct_intent', 'batch')),
  "origin_ref" TEXT,
  "state" TEXT CHECK ("state" IN ('open', 'selection_confirmed', 'cancelled', 'authorized')),
  "actor_id" TEXT,
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "terminal_at_ms" INTEGER CHECK ("terminal_at_ms" >= 0)
);
CREATE INDEX "idx_arca_offdeck_reviews_hot_01" ON "arca_offdeck_reviews" ("state", "created_at_ms");

CREATE TABLE "arca_offdeck_scope_materials" (
  "destruction_scope_id" TEXT,
  "ordinal" INTEGER CHECK ("ordinal" >= 0),
  "material_key" TEXT,
  "material_role" TEXT,
  "delete_condition" TEXT,
  "binding_revision" INTEGER CHECK ("binding_revision" >= 1),
  PRIMARY KEY ("destruction_scope_id", "ordinal"),
  UNIQUE ("destruction_scope_id", "material_key", "material_role"),
  FOREIGN KEY ("destruction_scope_id") REFERENCES "arca_offdeck_scopes" ("destruction_scope_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_offdeck_scopes" (
  "destruction_scope_id" TEXT PRIMARY KEY,
  "reservation_id" TEXT,
  "shelf_entry_id" TEXT,
  "inventory_revision" INTEGER CHECK ("inventory_revision" >= 1),
  "scope_digest" TEXT CHECK (length("scope_digest") = 64 AND "scope_digest" NOT GLOB '*[^0-9a-f]*'),
  "state" TEXT CHECK ("state" IN ('draft', 'confirmed', 'authorized', 'stale', 'completed')),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  UNIQUE ("reservation_id", "scope_digest"),
  FOREIGN KEY ("reservation_id") REFERENCES "arca_offdeck_reservations" ("reservation_id") ON DELETE RESTRICT,
  FOREIGN KEY ("shelf_entry_id") REFERENCES "arca_shelf_entries" ("shelf_entry_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_offdeck_selection_receipts" (
  "selection_receipt_id" TEXT PRIMARY KEY,
  "review_id" TEXT,
  "scope_set_digest" TEXT CHECK (length("scope_set_digest") = 64 AND "scope_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "entry_count" INTEGER CHECK ("entry_count" >= 0),
  "primary_count" INTEGER CHECK ("primary_count" >= 0),
  "total_bytes" INTEGER CHECK ("total_bytes" >= 0),
  "shelf_coverage_digest" TEXT CHECK (length("shelf_coverage_digest") = 64 AND "shelf_coverage_digest" NOT GLOB '*[^0-9a-f]*'),
  "deck_coverage_ratio" REAL,
  "high_volume" INTEGER CHECK ("high_volume" IN (0, 1)),
  "actor_id" TEXT,
  "confirmed_at_ms" INTEGER CHECK ("confirmed_at_ms" >= 0),
  UNIQUE ("review_id", "scope_set_digest"),
  FOREIGN KEY ("review_id") REFERENCES "arca_offdeck_reviews" ("review_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_offdeck_suppressions" (
  "suppression_id" TEXT PRIMARY KEY,
  "shelf_entry_id" TEXT,
  "candidate_kind" TEXT,
  "reason" TEXT,
  "state" TEXT CHECK ("state" IN ('active', 'revoked', 'expired')),
  "effective_at_ms" INTEGER CHECK ("effective_at_ms" >= 0),
  "expires_at_ms" INTEGER CHECK ("expires_at_ms" >= 0),
  "revoked_at_ms" INTEGER CHECK ("revoked_at_ms" >= 0),
  FOREIGN KEY ("shelf_entry_id") REFERENCES "arca_shelf_entries" ("shelf_entry_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_arca_offdeck_suppressions_hot_01" ON "arca_offdeck_suppressions" ("shelf_entry_id", "candidate_kind", "state", "expires_at_ms");

CREATE TABLE "arca_offdeck_terminal_receipts" (
  "receipt_id" TEXT PRIMARY KEY,
  "offdeck_case_id" TEXT,
  "shelf_entry_id" TEXT,
  "terminal_deck_fact_revision" INTEGER CHECK ("terminal_deck_fact_revision" >= 1),
  "released_control_set_digest" TEXT CHECK (length("released_control_set_digest") = 64 AND "released_control_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  UNIQUE ("offdeck_case_id"),
  FOREIGN KEY ("offdeck_case_id") REFERENCES "arca_offdeck_cases" ("offdeck_case_id") ON DELETE RESTRICT,
  FOREIGN KEY ("shelf_entry_id") REFERENCES "arca_shelf_entries" ("shelf_entry_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_offload_completions" (
  "offload_completion_id" TEXT PRIMARY KEY,
  "on_deck_run_id" TEXT,
  "shelf_entry_id" TEXT,
  "inventory_revision" INTEGER CHECK ("inventory_revision" >= 1),
  "package_id" TEXT,
  "completion_digest" TEXT CHECK (length("completion_digest") = 64 AND "completion_digest" NOT GLOB '*[^0-9a-f]*'),
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  UNIQUE ("on_deck_run_id"),
  FOREIGN KEY ("on_deck_run_id") REFERENCES "arca_ondeck_runs" ("on_deck_run_id") ON DELETE RESTRICT,
  FOREIGN KEY ("shelf_entry_id") REFERENCES "arca_shelf_entries" ("shelf_entry_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_ondeck_commit_receipts" (
  "receipt_id" TEXT PRIMARY KEY,
  "on_deck_run_id" TEXT,
  "shelf_entry_id" TEXT,
  "inventory_revision" INTEGER CHECK ("inventory_revision" >= 1),
  "deck_fact_revision" INTEGER CHECK ("deck_fact_revision" >= 1),
  "control_revision_set_digest" TEXT CHECK (length("control_revision_set_digest") = 64 AND "control_revision_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "commit_digest" TEXT CHECK (length("commit_digest") = 64 AND "commit_digest" NOT GLOB '*[^0-9a-f]*'),
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  UNIQUE ("on_deck_run_id"),
  FOREIGN KEY ("on_deck_run_id") REFERENCES "arca_ondeck_runs" ("on_deck_run_id") ON DELETE RESTRICT,
  FOREIGN KEY ("shelf_entry_id") REFERENCES "arca_shelf_entries" ("shelf_entry_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_ondeck_custodies" (
  "custody_id" TEXT PRIMARY KEY,
  "acceptance_decision_id" TEXT,
  "on_deck_package_id" TEXT,
  "package_digest" TEXT CHECK (length("package_digest") = 64 AND "package_digest" NOT GLOB '*[^0-9a-f]*'),
  "control_scope_digest" TEXT CHECK (length("control_scope_digest") = 64 AND "control_scope_digest" NOT GLOB '*[^0-9a-f]*'),
  "state" TEXT CHECK ("state" IN ('active', 'committed', 'released')),
  "accepted_at_ms" INTEGER CHECK ("accepted_at_ms" >= 0),
  UNIQUE ("on_deck_package_id", "package_digest"),
  FOREIGN KEY ("acceptance_decision_id") REFERENCES "arca_acceptance_decisions" ("acceptance_decision_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_ondeck_runs" (
  "on_deck_run_id" TEXT PRIMARY KEY,
  "custody_id" TEXT,
  "final_inventory_decision_digest" TEXT CHECK (length("final_inventory_decision_digest") = 64 AND "final_inventory_decision_digest" NOT GLOB '*[^0-9a-f]*'),
  "state" TEXT CHECK ("state" IN ('ready', 'offloading', 'blocked', 'committed')),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "terminal_at_ms" INTEGER CHECK ("terminal_at_ms" >= 0),
  FOREIGN KEY ("custody_id") REFERENCES "arca_ondeck_custodies" ("custody_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_arca_ondeck_runs_hot_01" ON "arca_ondeck_runs" ("state", "created_at_ms");

CREATE TABLE "arca_ondeck_settlement_approvals" (
  "approval_id" TEXT PRIMARY KEY,
  "on_deck_run_id" TEXT,
  "settlement_scope_digest" TEXT CHECK (length("settlement_scope_digest") = 64 AND "settlement_scope_digest" NOT GLOB '*[^0-9a-f]*'),
  "standing_authorization_id" TEXT,
  "standing_authorization_revision" INTEGER CHECK ("standing_authorization_revision" >= 1),
  "actor_or_policy_ref" TEXT,
  "approved_at_ms" INTEGER CHECK ("approved_at_ms" >= 0),
  "state" TEXT CHECK ("state" IN ('active', 'consumed', 'stale')),
  UNIQUE ("on_deck_run_id", "settlement_scope_digest"),
  FOREIGN KEY ("on_deck_run_id") REFERENCES "arca_ondeck_runs" ("on_deck_run_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_placement_policy_revisions" (
  "shelf_id" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "policy_schema_ref" TEXT,
  "policy_json" TEXT,
  "policy_digest" TEXT CHECK (length("policy_digest") = 64 AND "policy_digest" NOT GLOB '*[^0-9a-f]*'),
  "effective_at_ms" INTEGER CHECK ("effective_at_ms" >= 0),
  PRIMARY KEY ("shelf_id", "revision"),
  CHECK (json_valid("policy_json")),
  CHECK (length(CAST("policy_json" AS BLOB)) <= 16384),
  FOREIGN KEY ("shelf_id") REFERENCES "arca_shelves" ("shelf_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_rule_template_drafts" (
  "rule_template_id" TEXT PRIMARY KEY,
  "draft_revision" INTEGER CHECK ("draft_revision" >= 1),
  "base_published_revision" INTEGER CHECK ("base_published_revision" >= 1),
  "rules_schema_ref" TEXT,
  "rules_json" TEXT,
  "rules_digest" TEXT CHECK (length("rules_digest") = 64 AND "rules_digest" NOT GLOB '*[^0-9a-f]*'),
  "updated_at_ms" INTEGER CHECK ("updated_at_ms" >= 0),
  CHECK (json_valid("rules_json")),
  CHECK (length(CAST("rules_json" AS BLOB)) <= 65536),
  FOREIGN KEY ("rule_template_id") REFERENCES "arca_rule_templates" ("rule_template_id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "uidx_arca_rule_template_drafts_partial_01" ON "arca_rule_template_drafts" ("rule_template_id") WHERE 1 = 1;

CREATE TABLE "arca_rule_template_revisions" (
  "rule_template_id" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "rules_schema_ref" TEXT,
  "rules_json" TEXT,
  "rules_digest" TEXT CHECK (length("rules_digest") = 64 AND "rules_digest" NOT GLOB '*[^0-9a-f]*'),
  "published_at_ms" INTEGER CHECK ("published_at_ms" >= 0),
  PRIMARY KEY ("rule_template_id", "revision"),
  CHECK (json_valid("rules_json")),
  CHECK (length(CAST("rules_json" AS BLOB)) <= 65536),
  FOREIGN KEY ("rule_template_id") REFERENCES "arca_rule_templates" ("rule_template_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_rule_templates" (
  "rule_template_id" TEXT PRIMARY KEY,
  "name" TEXT,
  "owner_kind" TEXT CHECK ("owner_kind" IN ('system', 'user')),
  "status" TEXT CHECK ("status" IN ('active', 'archived')),
  "current_revision" INTEGER CHECK ("current_revision" >= 1),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "archived_at_ms" INTEGER CHECK ("archived_at_ms" >= 0),
  FOREIGN KEY ("rule_template_id", "current_revision") REFERENCES "arca_rule_template_revisions" ("rule_template_id", "revision") ON DELETE RESTRICT
);
CREATE INDEX "idx_arca_rule_templates_hot_01" ON "arca_rule_templates" ("status", "owner_kind", "rule_template_id");

CREATE TABLE "arca_shelf_entries" (
  "shelf_entry_id" TEXT PRIMARY KEY,
  "shelf_id" TEXT,
  "structure_kind" TEXT,
  "status" TEXT CHECK ("status" IN ('active', 'offdeck_in_progress', 'offdecked', 'deregistered')),
  "canonical_identity_revision" INTEGER CHECK ("canonical_identity_revision" >= 1),
  "canonical_identity_key" TEXT,
  "current_inventory_revision" INTEGER CHECK ("current_inventory_revision" >= 1),
  "current_deck_fact_revision" INTEGER CHECK ("current_deck_fact_revision" >= 1),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "terminal_at_ms" INTEGER CHECK ("terminal_at_ms" >= 0),
  FOREIGN KEY ("shelf_id") REFERENCES "arca_shelves" ("shelf_id") ON DELETE RESTRICT,
  FOREIGN KEY ("shelf_entry_id", "canonical_identity_revision") REFERENCES "arca_canonical_identity_revisions" ("shelf_entry_id", "revision") ON DELETE RESTRICT,
  FOREIGN KEY ("shelf_entry_id", "current_inventory_revision") REFERENCES "arca_inventory_representations" ("shelf_entry_id", "revision") ON DELETE RESTRICT,
  FOREIGN KEY ("shelf_entry_id", "current_deck_fact_revision") REFERENCES "arca_deck_fact_revisions" ("shelf_entry_id", "revision") ON DELETE RESTRICT
);
CREATE INDEX "idx_arca_shelf_entries_hot_01" ON "arca_shelf_entries" ("shelf_id", "status", "shelf_entry_id");
CREATE UNIQUE INDEX "uidx_arca_shelf_entries_partial_01" ON "arca_shelf_entries" ("shelf_id", "canonical_identity_key") WHERE "status" = 'active' AND "structure_kind" = 'season';

CREATE TABLE "arca_shelf_standard_revisions" (
  "shelf_id" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "rule_template_id" TEXT,
  "rule_template_revision" INTEGER CHECK ("rule_template_revision" >= 1),
  "standard_schema_ref" TEXT,
  "standard_json" TEXT,
  "standard_digest" TEXT CHECK (length("standard_digest") = 64 AND "standard_digest" NOT GLOB '*[^0-9a-f]*'),
  "effective_at_ms" INTEGER CHECK ("effective_at_ms" >= 0),
  PRIMARY KEY ("shelf_id", "revision"),
  CHECK (json_valid("standard_json")),
  CHECK (length(CAST("standard_json" AS BLOB)) <= 65536),
  FOREIGN KEY ("shelf_id") REFERENCES "arca_shelves" ("shelf_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_arca_shelf_standard_revisions_hot_01" ON "arca_shelf_standard_revisions" ("rule_template_id", "rule_template_revision");

CREATE TABLE "arca_shelves" (
  "shelf_id" TEXT PRIMARY KEY,
  "name" TEXT,
  "target_endpoint_id" TEXT,
  "target_root_location" TEXT,
  "target_mount_scope_id" TEXT,
  "target_mount_scope_revision" INTEGER CHECK ("target_mount_scope_revision" >= 1),
  "status" TEXT CHECK ("status" IN ('active', 'deregistering', 'deregistered')),
  "current_standard_revision" INTEGER CHECK ("current_standard_revision" >= 1),
  "current_placement_revision" INTEGER CHECK ("current_placement_revision" >= 1),
  "routing_projection_revision" INTEGER CHECK ("routing_projection_revision" >= 1),
  "routing_projection_digest" TEXT CHECK (length("routing_projection_digest") = 64 AND "routing_projection_digest" NOT GLOB '*[^0-9a-f]*'),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "updated_at_ms" INTEGER CHECK ("updated_at_ms" >= 0),
  FOREIGN KEY ("shelf_id", "current_standard_revision") REFERENCES "arca_shelf_standard_revisions" ("shelf_id", "revision") ON DELETE RESTRICT,
  FOREIGN KEY ("shelf_id", "current_placement_revision") REFERENCES "arca_placement_policy_revisions" ("shelf_id", "revision") ON DELETE RESTRICT
);
CREATE INDEX "idx_arca_shelves_hot_01" ON "arca_shelves" ("status", "shelf_id");

CREATE TABLE "fx_artifact_references" (
  "artifact_handle_id" TEXT,
  "consumer_domain" TEXT,
  "consumer_scope_type" TEXT,
  "consumer_scope_id" TEXT,
  "reference_kind" TEXT,
  "reference_revision" INTEGER CHECK ("reference_revision" >= 1),
  "state" TEXT CHECK ("state" IN ('active', 'released')),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "released_at_ms" INTEGER CHECK ("released_at_ms" >= 0),
  PRIMARY KEY ("artifact_handle_id", "consumer_domain", "consumer_scope_type", "consumer_scope_id", "reference_kind", "reference_revision"),
  FOREIGN KEY ("artifact_handle_id") REFERENCES "fx_artifact_registry" ("artifact_handle_id") ON DELETE RESTRICT
);

CREATE TABLE "fx_artifact_registry" (
  "artifact_handle_id" TEXT PRIMARY KEY,
  "artifact_kind" TEXT,
  "owner_domain" TEXT,
  "owner_scope_type" TEXT,
  "owner_scope_id" TEXT,
  "storage_ref" TEXT,
  "digest_algorithm" TEXT,
  "digest_hex" TEXT CHECK (length("digest_hex") = 64 AND "digest_hex" NOT GLOB '*[^0-9a-f]*'),
  "size_bytes" INTEGER CHECK ("size_bytes" >= 0),
  "media_type" TEXT,
  "provenance_ref" TEXT,
  "reference_revision" INTEGER CHECK ("reference_revision" >= 1),
  "state" TEXT CHECK ("state" IN ('active', 'gc_eligible', 'deleted')),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  UNIQUE ("owner_domain", "owner_scope_type", "owner_scope_id", "digest_algorithm", "digest_hex", "artifact_kind")
);
CREATE INDEX "idx_fx_artifact_registry_hot_01" ON "fx_artifact_registry" ("state", "created_at_ms");

CREATE TABLE "fx_audit_records" (
  "audit_id" TEXT PRIMARY KEY,
  "owner_domain" TEXT,
  "actor_type" TEXT,
  "actor_id" TEXT,
  "action" TEXT,
  "scope_type" TEXT,
  "scope_id" TEXT,
  "work_id" TEXT,
  "event_id" TEXT,
  "evidence_digest" TEXT CHECK (length("evidence_digest") = 64 AND "evidence_digest" NOT GLOB '*[^0-9a-f]*'),
  "occurred_at_ms" INTEGER CHECK ("occurred_at_ms" >= 0)
);
CREATE INDEX "idx_fx_audit_records_hot_01" ON "fx_audit_records" ("owner_domain", "scope_type", "scope_id", "occurred_at_ms");

CREATE TABLE "fx_circuit_states" (
  "circuit_key" TEXT PRIMARY KEY,
  "state" TEXT CHECK ("state" IN ('closed', 'open', 'recovering')),
  "reason_code" TEXT,
  "evidence_digest" TEXT CHECK (length("evidence_digest") = 64 AND "evidence_digest" NOT GLOB '*[^0-9a-f]*'),
  "opened_at_ms" INTEGER CHECK ("opened_at_ms" >= 0),
  "reviewed_at_ms" INTEGER CHECK ("reviewed_at_ms" >= 0)
);
CREATE INDEX "idx_fx_circuit_states_hot_01" ON "fx_circuit_states" ("state", "opened_at_ms");

CREATE TABLE "fx_command_receipts" (
  "command_receipt_id" TEXT PRIMARY KEY,
  "owner_domain" TEXT,
  "command_contract" TEXT,
  "caller_scope" TEXT,
  "idempotency_key" TEXT,
  "request_digest" TEXT CHECK (length("request_digest") = 64 AND "request_digest" NOT GLOB '*[^0-9a-f]*'),
  "target_type" TEXT,
  "target_id" TEXT,
  "result_schema_ref" TEXT,
  "result_ref_json" TEXT,
  "result_digest" TEXT CHECK (length("result_digest") = 64 AND "result_digest" NOT GLOB '*[^0-9a-f]*'),
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  UNIQUE ("owner_domain", "command_contract", "caller_scope", "idempotency_key"),
  CHECK (json_valid("result_ref_json")),
  CHECK (length(CAST("result_ref_json" AS BLOB)) <= 16384)
);

CREATE TABLE "fx_commit_markers" (
  "commit_marker" TEXT PRIMARY KEY,
  "effect_id" TEXT,
  "owner_domain" TEXT,
  "scope_type" TEXT,
  "scope_id" TEXT,
  "commit_digest" TEXT CHECK (length("commit_digest") = 64 AND "commit_digest" NOT GLOB '*[^0-9a-f]*'),
  "result_id" TEXT,
  "result_schema_ref" TEXT,
  "result_digest" TEXT CHECK (length("result_digest") = 64 AND "result_digest" NOT GLOB '*[^0-9a-f]*'),
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  FOREIGN KEY ("result_id") REFERENCES "fx_event_result_bindings" ("result_id") ON DELETE RESTRICT
);

CREATE TABLE "fx_effect_journal" (
  "effect_id" TEXT PRIMARY KEY,
  "event_attempt_id" TEXT,
  "effect_class" TEXT,
  "idempotency_key" TEXT,
  "intent_digest" TEXT CHECK (length("intent_digest") = 64 AND "intent_digest" NOT GLOB '*[^0-9a-f]*'),
  "state" TEXT CHECK ("state" IN ('intended', 'effect_observed', 'committed', 'reconcile_required', 'failed')),
  "external_receipt_ref" TEXT,
  "output_digest" TEXT CHECK (length("output_digest") = 64 AND "output_digest" NOT GLOB '*[^0-9a-f]*'),
  "verified_at_ms" INTEGER CHECK ("verified_at_ms" >= 0),
  "updated_at_ms" INTEGER CHECK ("updated_at_ms" >= 0),
  UNIQUE ("effect_class", "idempotency_key"),
  FOREIGN KEY ("event_attempt_id") REFERENCES "fx_event_attempts" ("event_attempt_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_fx_effect_journal_hot_01" ON "fx_effect_journal" ("state", "updated_at_ms", "effect_id");

CREATE TABLE "fx_event_attempts" (
  "event_attempt_id" TEXT PRIMARY KEY,
  "event_id" TEXT,
  "ordinal" INTEGER CHECK ("ordinal" >= 0),
  "executor_ref" TEXT,
  "executor_version" INTEGER,
  "input_snapshot_schema_ref" TEXT,
  "input_snapshot_digest" TEXT CHECK (length("input_snapshot_digest") = 64 AND "input_snapshot_digest" NOT GLOB '*[^0-9a-f]*'),
  "fence_snapshot_digest" TEXT CHECK (length("fence_snapshot_digest") = 64 AND "fence_snapshot_digest" NOT GLOB '*[^0-9a-f]*'),
  "state" TEXT CHECK ("state" IN ('executing', 'completed')),
  "outcome_kind" TEXT,
  "retry_after_ms" INTEGER CHECK ("retry_after_ms" >= 0),
  "failure_class" TEXT,
  "failure_code" TEXT,
  "evidence_digest" TEXT CHECK (length("evidence_digest") = 64 AND "evidence_digest" NOT GLOB '*[^0-9a-f]*'),
  "started_at_ms" INTEGER CHECK ("started_at_ms" >= 0),
  "finished_at_ms" INTEGER CHECK ("finished_at_ms" >= 0),
  UNIQUE ("event_id", "ordinal"),
  FOREIGN KEY ("event_id") REFERENCES "fx_workflow_events" ("event_id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "uidx_fx_event_attempts_partial_01" ON "fx_event_attempts" ("event_id") WHERE "state" = 'executing';

CREATE TABLE "fx_event_progress" (
  "event_id" TEXT,
  "event_attempt_id" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "mode" TEXT,
  "current_value" NUMERIC,
  "total_value" NUMERIC,
  "unit" TEXT,
  "rate" REAL,
  "eta_ms" INTEGER CHECK ("eta_ms" >= 0),
  "source_sequence" TEXT,
  "progress_bucket" TEXT,
  "sampled_at_ms" INTEGER CHECK ("sampled_at_ms" >= 0),
  PRIMARY KEY ("event_id", "revision"),
  UNIQUE ("event_attempt_id", "source_sequence"),
  FOREIGN KEY ("event_id") REFERENCES "fx_workflow_events" ("event_id") ON DELETE RESTRICT,
  FOREIGN KEY ("event_attempt_id") REFERENCES "fx_event_attempts" ("event_attempt_id") ON DELETE RESTRICT
);

CREATE TABLE "fx_event_resource_timings" (
  "event_attempt_id" TEXT,
  "resource_key" TEXT,
  "queue_class" TEXT,
  "enqueued_at_ms" INTEGER CHECK ("enqueued_at_ms" >= 0),
  "acquired_at_ms" INTEGER CHECK ("acquired_at_ms" >= 0),
  "released_at_ms" INTEGER CHECK ("released_at_ms" >= 0),
  "wait_duration_ms" INTEGER CHECK ("wait_duration_ms" >= 0),
  "hold_duration_ms" INTEGER CHECK ("hold_duration_ms" >= 0),
  "outcome" TEXT,
  PRIMARY KEY ("event_attempt_id", "resource_key"),
  FOREIGN KEY ("event_attempt_id") REFERENCES "fx_event_attempts" ("event_attempt_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_fx_event_resource_timings_hot_01" ON "fx_event_resource_timings" ("resource_key", "acquired_at_ms");

CREATE TABLE "fx_event_result_bindings" (
  "result_id" TEXT PRIMARY KEY,
  "event_id" TEXT,
  "outcome_kind" TEXT,
  "result_schema_ref" TEXT,
  "result_json" TEXT,
  "result_digest" TEXT CHECK (length("result_digest") = 64 AND "result_digest" NOT GLOB '*[^0-9a-f]*'),
  "evidence_schema_ref" TEXT,
  "evidence_json" TEXT,
  "evidence_digest" TEXT CHECK (length("evidence_digest") = 64 AND "evidence_digest" NOT GLOB '*[^0-9a-f]*'),
  "effect_receipt_id" TEXT,
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  CHECK (json_valid("result_json")),
  CHECK (length(CAST("result_json" AS BLOB)) <= 65536),
  CHECK (json_valid("evidence_json")),
  CHECK (length(CAST("evidence_json" AS BLOB)) <= 65536),
  FOREIGN KEY ("event_id") REFERENCES "fx_workflow_events" ("event_id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "uidx_fx_event_result_bindings_partial_01" ON "fx_event_result_bindings" ("event_id") WHERE 1 = 1;

CREATE TABLE "fx_inbox" (
  "consumer_domain" TEXT,
  "message_id" TEXT,
  "dedup_key" TEXT,
  "received_at_ms" INTEGER CHECK ("received_at_ms" >= 0),
  "consumed_at_ms" INTEGER CHECK ("consumed_at_ms" >= 0),
  "result_digest" TEXT CHECK (length("result_digest") = 64 AND "result_digest" NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY ("consumer_domain", "message_id"),
  UNIQUE ("consumer_domain", "dedup_key")
);

CREATE TABLE "fx_material_control_revisions" (
  "material_key" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "operation_kind" TEXT,
  "from_owner_domain" TEXT,
  "from_scope_type" TEXT,
  "from_scope_id" TEXT,
  "to_owner_domain" TEXT,
  "to_scope_type" TEXT,
  "to_scope_id" TEXT,
  "basis_digest" TEXT CHECK (length("basis_digest") = 64 AND "basis_digest" NOT GLOB '*[^0-9a-f]*'),
  "commit_marker" TEXT,
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  PRIMARY KEY ("material_key", "revision"),
  FOREIGN KEY ("material_key") REFERENCES "fx_material_controls" ("material_key") ON DELETE RESTRICT
);

CREATE TABLE "fx_material_controls" (
  "material_key" TEXT PRIMARY KEY,
  "mount_scope_id" TEXT,
  "inode" TEXT,
  "content_hash_algorithm" TEXT,
  "content_hash" TEXT,
  "owner_domain" TEXT,
  "owner_scope_type" TEXT,
  "owner_scope_id" TEXT,
  "control_revision" INTEGER CHECK ("control_revision" >= 1),
  "state" TEXT CHECK ("state" IN ('controlled', 'released')),
  "updated_at_ms" INTEGER CHECK ("updated_at_ms" >= 0),
  UNIQUE ("mount_scope_id", "inode", "content_hash_algorithm", "content_hash")
);

CREATE TABLE "fx_outbox" (
  "message_id" TEXT PRIMARY KEY,
  "producer_domain" TEXT,
  "message_kind" TEXT,
  "aggregate_type" TEXT,
  "aggregate_id" TEXT,
  "aggregate_revision" INTEGER CHECK ("aggregate_revision" >= 1),
  "dedup_key" TEXT,
  "consumer_set_digest" TEXT CHECK (length("consumer_set_digest") = 64 AND "consumer_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "intended_consumer_count" INTEGER CHECK ("intended_consumer_count" >= 0),
  "payload_schema_ref" TEXT,
  "payload_json" TEXT,
  "payload_digest" TEXT CHECK (length("payload_digest") = 64 AND "payload_digest" NOT GLOB '*[^0-9a-f]*'),
  "state" TEXT CHECK ("state" IN ('pending', 'dispatching', 'fully_acked', 'tombstoned')),
  "available_at_ms" INTEGER CHECK ("available_at_ms" >= 0),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "all_acked_at_ms" INTEGER CHECK ("all_acked_at_ms" >= 0),
  UNIQUE ("producer_domain", "dedup_key"),
  CHECK (json_valid("payload_json")),
  CHECK (length(CAST("payload_json" AS BLOB)) <= 16384)
);
CREATE INDEX "idx_fx_outbox_hot_01" ON "fx_outbox" ("state", "available_at_ms", "message_id");

CREATE TABLE "fx_outbox_deliveries" (
  "message_id" TEXT,
  "consumer_domain" TEXT,
  "state" TEXT CHECK ("state" IN ('pending', 'delivered', 'acked')),
  "attempt_count" INTEGER CHECK ("attempt_count" >= 0),
  "next_attempt_at_ms" INTEGER CHECK ("next_attempt_at_ms" >= 0),
  "acked_at_ms" INTEGER CHECK ("acked_at_ms" >= 0),
  PRIMARY KEY ("message_id", "consumer_domain"),
  FOREIGN KEY ("message_id") REFERENCES "fx_outbox" ("message_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_fx_outbox_deliveries_hot_01" ON "fx_outbox_deliveries" ("state", "next_attempt_at_ms", "message_id");

CREATE TABLE "fx_plan_edges" (
  "plan_id" TEXT,
  "from_node_id" TEXT,
  "to_node_id" TEXT,
  "dependency_kind" TEXT,
  PRIMARY KEY ("plan_id", "from_node_id", "to_node_id"),
  FOREIGN KEY ("plan_id") REFERENCES "fx_workflow_plans" ("plan_id") ON DELETE RESTRICT
);

CREATE TABLE "fx_plan_nodes" (
  "plan_id" TEXT,
  "node_id" TEXT,
  "capability_ref" TEXT,
  "contract_version" INTEGER,
  "input_binding_schema_ref" TEXT,
  "input_bindings_json" TEXT,
  "parameter_schema_ref" TEXT,
  "parameters_json" TEXT,
  "when_schema_ref" TEXT,
  "when_json" TEXT,
  "effect_class" TEXT,
  "fence_schema_ref" TEXT,
  "fence_basis_json" TEXT,
  "resource_demand_schema_ref" TEXT,
  "resource_demand_json" TEXT,
  PRIMARY KEY ("plan_id", "node_id"),
  CHECK (json_valid("input_bindings_json")),
  CHECK (length(CAST("input_bindings_json" AS BLOB)) <= 16384),
  CHECK (json_valid("parameters_json")),
  CHECK (length(CAST("parameters_json" AS BLOB)) <= 16384),
  CHECK (json_valid("when_json")),
  CHECK (length(CAST("when_json" AS BLOB)) <= 16384),
  CHECK (json_valid("fence_basis_json")),
  CHECK (length(CAST("fence_basis_json" AS BLOB)) <= 16384),
  CHECK (json_valid("resource_demand_json")),
  CHECK (length(CAST("resource_demand_json" AS BLOB)) <= 16384),
  FOREIGN KEY ("plan_id") REFERENCES "fx_workflow_plans" ("plan_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_fx_plan_nodes_hot_01" ON "fx_plan_nodes" ("capability_ref", "contract_version");

CREATE TABLE "fx_resource_defer" (
  "event_id" TEXT,
  "resource_key" TEXT,
  "queue_class" TEXT,
  "local_priority" INTEGER,
  "enqueued_at_ms" INTEGER CHECK ("enqueued_at_ms" >= 0),
  "retry_at_ms" INTEGER CHECK ("retry_at_ms" >= 0),
  "state" TEXT CHECK ("state" IN ('waiting', 'released', 'cancelled', 'expired')),
  PRIMARY KEY ("event_id", "resource_key"),
  FOREIGN KEY ("event_id") REFERENCES "fx_workflow_events" ("event_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_fx_resource_defer_hot_01" ON "fx_resource_defer" ("resource_key", "state", "queue_class", "local_priority", "enqueued_at_ms");

CREATE TABLE "fx_supporting_works" (
  "work_id" TEXT PRIMARY KEY,
  "owner_domain" TEXT,
  "process_type" TEXT,
  "process_id" TEXT,
  "work_kind" TEXT,
  "basis_digest" TEXT CHECK (length("basis_digest") = 64 AND "basis_digest" NOT GLOB '*[^0-9a-f]*'),
  "priority_class" TEXT,
  "state" TEXT CHECK ("state" IN ('admitted', 'ready', 'running', 'blocked', 'succeeded', 'failed', 'cancelled')),
  "idempotency_key" TEXT,
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "updated_at_ms" INTEGER CHECK ("updated_at_ms" >= 0),
  UNIQUE ("owner_domain", "idempotency_key")
);
CREATE INDEX "idx_fx_supporting_works_hot_01" ON "fx_supporting_works" ("owner_domain", "state", "priority_class", "created_at_ms", "work_id");

CREATE TABLE "fx_work_attempts" (
  "attempt_id" TEXT PRIMARY KEY,
  "work_id" TEXT,
  "ordinal" INTEGER CHECK ("ordinal" >= 0),
  "basis_digest" TEXT CHECK (length("basis_digest") = 64 AND "basis_digest" NOT GLOB '*[^0-9a-f]*'),
  "state" TEXT CHECK ("state" IN ('ready', 'running', 'blocked', 'succeeded', 'failed', 'cancelled')),
  "started_at_ms" INTEGER CHECK ("started_at_ms" >= 0),
  "finished_at_ms" INTEGER CHECK ("finished_at_ms" >= 0),
  "failure_code" TEXT,
  UNIQUE ("work_id", "ordinal"),
  FOREIGN KEY ("work_id") REFERENCES "fx_supporting_works" ("work_id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "uidx_fx_work_attempts_partial_01" ON "fx_work_attempts" ("work_id") WHERE "state" IN ('ready', 'running', 'blocked');

CREATE TABLE "fx_workflow_events" (
  "event_id" TEXT PRIMARY KEY,
  "plan_id" TEXT,
  "node_id" TEXT,
  "work_id" TEXT,
  "attempt_id" TEXT,
  "owner_domain" TEXT,
  "capability_ref" TEXT,
  "contract_version" INTEGER,
  "state" TEXT CHECK ("state" IN ('pending', 'ready', 'waiting_for_resource', 'waiting_for_external', 'waiting_for_approval', 'executing', 'succeeded', 'skipped', 'failed', 'cancelled')),
  "priority_class" TEXT,
  "ready_at_ms" INTEGER CHECK ("ready_at_ms" >= 0),
  "retry_at_ms" INTEGER CHECK ("retry_at_ms" >= 0),
  "result_id" TEXT,
  "current_progress_revision" INTEGER CHECK ("current_progress_revision" >= 1),
  UNIQUE ("plan_id", "node_id"),
  FOREIGN KEY ("plan_id") REFERENCES "fx_workflow_plans" ("plan_id") ON DELETE RESTRICT,
  FOREIGN KEY ("event_id", "current_progress_revision") REFERENCES "fx_event_progress" ("event_id", "revision") ON DELETE RESTRICT
);
CREATE INDEX "idx_fx_workflow_events_hot_01" ON "fx_workflow_events" ("state", "priority_class", COALESCE("retry_at_ms", "ready_at_ms"), "event_id");

CREATE TABLE "fx_workflow_plans" (
  "plan_id" TEXT PRIMARY KEY,
  "attempt_id" TEXT,
  "planner_ref" TEXT,
  "planner_version" INTEGER,
  "catalog_digest" TEXT CHECK (length("catalog_digest") = 64 AND "catalog_digest" NOT GLOB '*[^0-9a-f]*'),
  "basis_digest" TEXT CHECK (length("basis_digest") = 64 AND "basis_digest" NOT GLOB '*[^0-9a-f]*'),
  "graph_digest" TEXT CHECK (length("graph_digest") = 64 AND "graph_digest" NOT GLOB '*[^0-9a-f]*'),
  "state" TEXT CHECK ("state" IN ('planned', 'no_effect_required', 'temporarily_unplannable', 'contract_unplannable')),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  UNIQUE ("attempt_id"),
  FOREIGN KEY ("attempt_id") REFERENCES "fx_work_attempts" ("attempt_id") ON DELETE RESTRICT
);

CREATE TABLE "fx_workspace_materials" (
  "workspace_id" TEXT,
  "material_handle_id" TEXT,
  "relative_path" TEXT,
  "digest_algorithm" TEXT,
  "digest_hex" TEXT CHECK (length("digest_hex") = 64 AND "digest_hex" NOT GLOB '*[^0-9a-f]*'),
  "size_bytes" INTEGER CHECK ("size_bytes" >= 0),
  "reference_revision" INTEGER CHECK ("reference_revision" >= 1),
  "state" TEXT CHECK ("state" IN ('working', 'product_staged', 'retained', 'deletion_pending', 'deleted')),
  PRIMARY KEY ("workspace_id", "material_handle_id"),
  UNIQUE ("workspace_id", "relative_path"),
  FOREIGN KEY ("workspace_id") REFERENCES "fx_workspace_registry" ("workspace_id") ON DELETE RESTRICT
);

CREATE TABLE "fx_workspace_registry" (
  "workspace_id" TEXT PRIMARY KEY,
  "owner_domain" TEXT,
  "process_type" TEXT,
  "process_id" TEXT,
  "root_handle_ref" TEXT,
  "state" TEXT CHECK ("state" IN ('active', 'reclaiming', 'reclaimed')),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "reclaim_after_ms" INTEGER CHECK ("reclaim_after_ms" >= 0),
  UNIQUE ("owner_domain", "process_type", "process_id", "workspace_id")
);
CREATE INDEX "idx_fx_workspace_registry_hot_01" ON "fx_workspace_registry" ("owner_domain", "state", "reclaim_after_ms");

CREATE TABLE "libra_acceptance_specs" (
  "acceptance_spec_id" TEXT PRIMARY KEY,
  "subject_id" TEXT,
  "shelf_id" TEXT,
  "shelf_routing_projection_revision" INTEGER CHECK ("shelf_routing_projection_revision" >= 1),
  "shelf_projection_digest" TEXT CHECK (length("shelf_projection_digest") = 64 AND "shelf_projection_digest" NOT GLOB '*[^0-9a-f]*'),
  "shelf_standard_revision" INTEGER CHECK ("shelf_standard_revision" >= 1),
  "shelf_standard_digest" TEXT CHECK (length("shelf_standard_digest") = 64 AND "shelf_standard_digest" NOT GLOB '*[^0-9a-f]*'),
  "decision_basis_id" TEXT,
  "product_scope_digest" TEXT CHECK (length("product_scope_digest") = 64 AND "product_scope_digest" NOT GLOB '*[^0-9a-f]*'),
  "spec_revision" INTEGER CHECK ("spec_revision" >= 1),
  "spec_schema_ref" TEXT,
  "spec_json" TEXT,
  "spec_digest" TEXT CHECK (length("spec_digest") = 64 AND "spec_digest" NOT GLOB '*[^0-9a-f]*'),
  "record_digest" TEXT CHECK (length("record_digest") = 64 AND "record_digest" NOT GLOB '*[^0-9a-f]*'),
  "structure_kind" TEXT CHECK ("structure_kind" IN ('single', 'season')),
  "content_profile" TEXT CHECK ("content_profile" IN ('movie', 'series', 'jav', 'western_adult')),
  "published_at_ms" INTEGER CHECK ("published_at_ms" >= 0),
  UNIQUE ("subject_id", "spec_revision"),
  UNIQUE ("subject_id", "decision_basis_id", "product_scope_digest", "record_digest"),
  CHECK (json_valid("spec_json")),
  CHECK (length(CAST("spec_json" AS BLOB)) <= 65536),
  FOREIGN KEY ("subject_id") REFERENCES "libra_subjects" ("subject_id") ON DELETE RESTRICT,
  FOREIGN KEY ("decision_basis_id") REFERENCES "libra_decision_basis_revisions" ("decision_basis_id") ON DELETE RESTRICT
);

CREATE TABLE "libra_decision_basis_inputs" (
  "decision_basis_id" TEXT,
  "input_ordinal" INTEGER CHECK ("input_ordinal" >= 0),
  "input_kind" TEXT CHECK ("input_kind" IN ('subject_snapshot', 'routing_authority', 'shelf_routing_projection', 'routing_fact', 'routing_decision', 'shelf_standard_projection', 'product_scope', 'decision_fact', 'query_result')),
  "input_schema_ref" TEXT,
  "input_object_id" TEXT,
  "input_revision" INTEGER CHECK ("input_revision" >= 1),
  "input_digest" TEXT CHECK (length("input_digest") = 64 AND "input_digest" NOT GLOB '*[^0-9a-f]*'),
  "input_json" TEXT,
  "provider_domain" TEXT,
  "query_contract" TEXT,
  "query_version" INTEGER,
  "query_input_digest" TEXT CHECK (length("query_input_digest") = 64 AND "query_input_digest" NOT GLOB '*[^0-9a-f]*'),
  "result_kind" TEXT,
  "result_revision" INTEGER CHECK ("result_revision" >= 1),
  "result_digest" TEXT CHECK (length("result_digest") = 64 AND "result_digest" NOT GLOB '*[^0-9a-f]*'),
  "expires_at_ms" INTEGER CHECK ("expires_at_ms" >= 0),
  PRIMARY KEY ("decision_basis_id", "input_ordinal"),
  UNIQUE ("decision_basis_id", "input_kind", "input_object_id", "input_revision", "input_digest"),
  CHECK (json_valid("input_json")),
  CHECK (length(CAST("input_json" AS BLOB)) <= 65536),
  FOREIGN KEY ("decision_basis_id") REFERENCES "libra_decision_basis_revisions" ("decision_basis_id") ON DELETE RESTRICT
);

CREATE TABLE "libra_decision_basis_revisions" (
  "decision_basis_id" TEXT PRIMARY KEY,
  "subject_id" TEXT,
  "basis_kind" TEXT CHECK ("basis_kind" IN ('routing', 'acceptance_spec')),
  "basis_revision" INTEGER CHECK ("basis_revision" >= 1),
  "expected_head_revision" INTEGER CHECK ("expected_head_revision" >= 1),
  "routing_decision_id" TEXT,
  "query_result_set_digest" TEXT CHECK (length("query_result_set_digest") = 64 AND "query_result_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "routing_input_digest" TEXT CHECK (length("routing_input_digest") = 64 AND "routing_input_digest" NOT GLOB '*[^0-9a-f]*'),
  "spec_input_digest" TEXT CHECK (length("spec_input_digest") = 64 AND "spec_input_digest" NOT GLOB '*[^0-9a-f]*'),
  "product_scope_digest" TEXT CHECK (length("product_scope_digest") = 64 AND "product_scope_digest" NOT GLOB '*[^0-9a-f]*'),
  "input_set_digest" TEXT CHECK (length("input_set_digest") = 64 AND "input_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "status" TEXT CHECK ("status" IN ('ready', 'unresolved')),
  "unresolved_reason_code" TEXT,
  "basis_digest" TEXT CHECK (length("basis_digest") = 64 AND "basis_digest" NOT GLOB '*[^0-9a-f]*'),
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  UNIQUE ("subject_id", "basis_revision"),
  UNIQUE ("subject_id", "basis_kind", "input_set_digest"),
  FOREIGN KEY ("subject_id") REFERENCES "libra_subjects" ("subject_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_libra_decision_basis_revisions_hot_01" ON "libra_decision_basis_revisions" ("subject_id", "status", "basis_revision");

CREATE TABLE "libra_delivery_receipts" (
  "receipt_id" TEXT PRIMARY KEY,
  "offer_id" TEXT,
  "on_deck_package_id" TEXT,
  "package_digest" TEXT CHECK (length("package_digest") = 64 AND "package_digest" NOT GLOB '*[^0-9a-f]*'),
  "arca_acceptance_decision_id" TEXT,
  "arca_acceptance_decision_digest" TEXT CHECK (length("arca_acceptance_decision_digest") = 64 AND "arca_acceptance_decision_digest" NOT GLOB '*[^0-9a-f]*'),
  "result" TEXT CHECK ("result" IN ('accepted', 'rejected')),
  "handoff_receipt_id" TEXT,
  "handoff_receipt_digest" TEXT CHECK (length("handoff_receipt_digest") = 64 AND "handoff_receipt_digest" NOT GLOB '*[^0-9a-f]*'),
  "rejection_digest" TEXT CHECK (length("rejection_digest") = 64 AND "rejection_digest" NOT GLOB '*[^0-9a-f]*'),
  "closure_digest" TEXT CHECK (length("closure_digest") = 64 AND "closure_digest" NOT GLOB '*[^0-9a-f]*'),
  "received_at_ms" INTEGER CHECK ("received_at_ms" >= 0),
  UNIQUE ("offer_id"),
  FOREIGN KEY ("on_deck_package_id") REFERENCES "libra_product_packages" ("on_deck_package_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_libra_delivery_receipts_hot_01" ON "libra_delivery_receipts" ("result", "received_at_ms");

CREATE TABLE "libra_episode_delivery_manifests" (
  "episode_delivery_manifest_id" TEXT PRIMARY KEY,
  "libra_run_id" TEXT,
  "manifest_revision" INTEGER CHECK ("manifest_revision" >= 1),
  "member_count" INTEGER CHECK ("member_count" >= 0),
  "members_digest" TEXT CHECK (length("members_digest") = 64 AND "members_digest" NOT GLOB '*[^0-9a-f]*'),
  "manifest_digest" TEXT CHECK (length("manifest_digest") = 64 AND "manifest_digest" NOT GLOB '*[^0-9a-f]*'),
  "published_at_ms" INTEGER CHECK ("published_at_ms" >= 0),
  UNIQUE ("libra_run_id", "manifest_revision"),
  FOREIGN KEY ("libra_run_id") REFERENCES "libra_runs" ("libra_run_id") ON DELETE RESTRICT
);

CREATE TABLE "libra_episode_delivery_members" (
  "episode_delivery_manifest_id" TEXT,
  "episode_key" TEXT,
  "material_key" TEXT,
  "input_role" TEXT,
  "output_requirement_digest" TEXT CHECK (length("output_requirement_digest") = 64 AND "output_requirement_digest" NOT GLOB '*[^0-9a-f]*'),
  "state" TEXT CHECK ("state" IN ('pending', 'delivered', 'superseded')),
  PRIMARY KEY ("episode_delivery_manifest_id", "episode_key", "material_key"),
  FOREIGN KEY ("episode_delivery_manifest_id") REFERENCES "libra_episode_delivery_manifests" ("episode_delivery_manifest_id") ON DELETE RESTRICT
);

CREATE TABLE "libra_field_routing_heads" (
  "field_id" TEXT PRIMARY KEY,
  "current_routing_policy_id" TEXT,
  "current_policy_revision" INTEGER CHECK ("current_policy_revision" >= 1),
  "updated_at_ms" INTEGER CHECK ("updated_at_ms" >= 0),
  FOREIGN KEY ("current_routing_policy_id", "current_policy_revision") REFERENCES "libra_routing_policy_revisions" ("routing_policy_id", "revision") ON DELETE RESTRICT
);

CREATE TABLE "libra_handoff_a_receipts" (
  "receipt_id" TEXT PRIMARY KEY,
  "intake_decision_id" TEXT,
  "outcome" TEXT CHECK ("outcome" IN ('accepted', 'rejected')),
  "offer_id" TEXT,
  "candidate_package_id" TEXT,
  "package_revision" INTEGER CHECK ("package_revision" >= 1),
  "package_digest" TEXT CHECK (length("package_digest") = 64 AND "package_digest" NOT GLOB '*[^0-9a-f]*'),
  "candidate_delivery_snapshot_digest" TEXT CHECK (length("candidate_delivery_snapshot_digest") = 64 AND "candidate_delivery_snapshot_digest" NOT GLOB '*[^0-9a-f]*'),
  "subject_id" TEXT,
  "subject_intake_revision" INTEGER CHECK ("subject_intake_revision" >= 1),
  "subject_continuity_head_revision" INTEGER CHECK ("subject_continuity_head_revision" >= 1),
  "subject_continuity_set_digest" TEXT CHECK (length("subject_continuity_set_digest") = 64 AND "subject_continuity_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "subject_episode_scope_digest" TEXT CHECK (length("subject_episode_scope_digest") = 64 AND "subject_episode_scope_digest" NOT GLOB '*[^0-9a-f]*'),
  "accepted_payload_digest" TEXT CHECK (length("accepted_payload_digest") = 64 AND "accepted_payload_digest" NOT GLOB '*[^0-9a-f]*'),
  "libra_binding_set_digest" TEXT CHECK (length("libra_binding_set_digest") = 64 AND "libra_binding_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "control_revision_set_digest" TEXT CHECK (length("control_revision_set_digest") = 64 AND "control_revision_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "rejection_id" TEXT,
  "primary_rejection_code" TEXT,
  "rejection_reason_set_digest" TEXT CHECK (length("rejection_reason_set_digest") = 64 AND "rejection_reason_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "rejection_digest" TEXT CHECK (length("rejection_digest") = 64 AND "rejection_digest" NOT GLOB '*[^0-9a-f]*'),
  "receipt_digest" TEXT CHECK (length("receipt_digest") = 64 AND "receipt_digest" NOT GLOB '*[^0-9a-f]*'),
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  UNIQUE ("intake_decision_id"),
  FOREIGN KEY ("intake_decision_id") REFERENCES "libra_intake_decisions" ("intake_decision_id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "uidx_libra_handoff_a_receipts_partial_01" ON "libra_handoff_a_receipts" ("candidate_package_id", "package_digest") WHERE "outcome" = 'accepted';

CREATE TABLE "libra_intake_decisions" (
  "intake_decision_id" TEXT PRIMARY KEY,
  "decision_revision" INTEGER CHECK ("decision_revision" >= 1),
  "decision_kind" TEXT CHECK ("decision_kind" IN ('accepted_resolution', 'rejected_acceptance')),
  "offer_id" TEXT,
  "candidate_package_id" TEXT,
  "package_revision" INTEGER CHECK ("package_revision" >= 1),
  "package_digest" TEXT CHECK (length("package_digest") = 64 AND "package_digest" NOT GLOB '*[^0-9a-f]*'),
  "acceptance_basis_digest" TEXT CHECK (length("acceptance_basis_digest") = 64 AND "acceptance_basis_digest" NOT GLOB '*[^0-9a-f]*'),
  "candidate_delivery_snapshot_digest" TEXT CHECK (length("candidate_delivery_snapshot_digest") = 64 AND "candidate_delivery_snapshot_digest" NOT GLOB '*[^0-9a-f]*'),
  "source_field_id" TEXT,
  "source_field_access_revision" INTEGER CHECK ("source_field_access_revision" >= 1),
  "source_field_context_digest" TEXT CHECK (length("source_field_context_digest") = 64 AND "source_field_context_digest" NOT GLOB '*[^0-9a-f]*'),
  "candidate_structure_kind" TEXT,
  "candidate_content_profile" TEXT,
  "candidate_identity_claim_digest" TEXT CHECK (length("candidate_identity_claim_digest") = 64 AND "candidate_identity_claim_digest" NOT GLOB '*[^0-9a-f]*'),
  "expected_continuity_head_revision" INTEGER CHECK ("expected_continuity_head_revision" >= 0),
  "expected_continuity_head_digest" TEXT CHECK (length("expected_continuity_head_digest") = 64 AND "expected_continuity_head_digest" NOT GLOB '*[^0-9a-f]*'),
  "committed_continuity_head_revision" INTEGER CHECK ("committed_continuity_head_revision" >= 1),
  "candidate_continuity_set_digest" TEXT CHECK (length("candidate_continuity_set_digest") = 64 AND "candidate_continuity_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "candidate_episode_scope_digest" TEXT CHECK (length("candidate_episode_scope_digest") = 64 AND "candidate_episode_scope_digest" NOT GLOB '*[^0-9a-f]*'),
  "match_cardinality" TEXT CHECK ("match_cardinality" IN ('none', 'one', 'multiple')),
  "matched_subject_set_digest" TEXT CHECK (length("matched_subject_set_digest") = 64 AND "matched_subject_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "episode_overlap_digest" TEXT CHECK (length("episode_overlap_digest") = 64 AND "episode_overlap_digest" NOT GLOB '*[^0-9a-f]*'),
  "accepted_result" TEXT CHECK ("accepted_result" IN ('new_subject', 'season_extension')),
  "target_subject_id" TEXT,
  "expected_target_status" TEXT CHECK ("expected_target_status" IN ('active')),
  "expected_target_intake_revision" INTEGER CHECK ("expected_target_intake_revision" >= 1),
  "expected_target_continuity_set_digest" TEXT CHECK (length("expected_target_continuity_set_digest") = 64 AND "expected_target_continuity_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "expected_target_episode_scope_digest" TEXT CHECK (length("expected_target_episode_scope_digest") = 64 AND "expected_target_episode_scope_digest" NOT GLOB '*[^0-9a-f]*'),
  "committed_target_intake_revision" INTEGER CHECK ("committed_target_intake_revision" >= 1),
  "committed_subject_continuity_set_digest" TEXT CHECK (length("committed_subject_continuity_set_digest") = 64 AND "committed_subject_continuity_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "committed_subject_episode_scope_digest" TEXT CHECK (length("committed_subject_episode_scope_digest") = 64 AND "committed_subject_episode_scope_digest" NOT GLOB '*[^0-9a-f]*'),
  "accepted_payload_digest" TEXT CHECK (length("accepted_payload_digest") = 64 AND "accepted_payload_digest" NOT GLOB '*[^0-9a-f]*'),
  "rejection_schema_ref" TEXT,
  "rejection_id" TEXT,
  "primary_rejection_code" TEXT,
  "rejection_reason_set_digest" TEXT CHECK (length("rejection_reason_set_digest") = 64 AND "rejection_reason_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "rejection_digest" TEXT CHECK (length("rejection_digest") = 64 AND "rejection_digest" NOT GLOB '*[^0-9a-f]*'),
  "decision_digest" TEXT CHECK (length("decision_digest") = 64 AND "decision_digest" NOT GLOB '*[^0-9a-f]*'),
  "decided_at_ms" INTEGER CHECK ("decided_at_ms" >= 0),
  UNIQUE ("offer_id")
);
CREATE UNIQUE INDEX "uidx_libra_intake_decisions_partial_01" ON "libra_intake_decisions" ("candidate_package_id", "package_digest") WHERE "decision_kind" = 'accepted_resolution';

CREATE TABLE "libra_intake_rejection_reason_evidence" (
  "intake_decision_id" TEXT,
  "reason_ordinal" INTEGER CHECK ("reason_ordinal" >= 0),
  "reason_code" TEXT,
  "evidence_ordinal" INTEGER CHECK ("evidence_ordinal" >= 0),
  "evidence_schema_ref" TEXT,
  "evidence_id" TEXT,
  "evidence_digest" TEXT CHECK (length("evidence_digest") = 64 AND "evidence_digest" NOT GLOB '*[^0-9a-f]*'),
  "reason_digest" TEXT CHECK (length("reason_digest") = 64 AND "reason_digest" NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY ("intake_decision_id", "reason_ordinal", "evidence_ordinal"),
  UNIQUE ("intake_decision_id", "reason_ordinal", "evidence_schema_ref", "evidence_id", "evidence_digest"),
  FOREIGN KEY ("intake_decision_id") REFERENCES "libra_intake_decisions" ("intake_decision_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_libra_intake_rejection_reason_evidence_hot_01" ON "libra_intake_rejection_reason_evidence" ("intake_decision_id", "reason_ordinal", "evidence_ordinal");

CREATE TABLE "libra_intake_resolution_episode_overlaps" (
  "intake_decision_id" TEXT,
  "subject_id" TEXT,
  "episode_key" TEXT,
  "overlap_digest" TEXT CHECK (length("overlap_digest") = 64 AND "overlap_digest" NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY ("intake_decision_id", "subject_id", "episode_key"),
  FOREIGN KEY ("intake_decision_id") REFERENCES "libra_intake_decisions" ("intake_decision_id") ON DELETE RESTRICT,
  FOREIGN KEY ("subject_id") REFERENCES "libra_subjects" ("subject_id") ON DELETE RESTRICT
);

CREATE TABLE "libra_intake_resolution_match_witnesses" (
  "intake_decision_id" TEXT,
  "ordinal" INTEGER CHECK ("ordinal" >= 0),
  "subject_id" TEXT,
  "expected_subject_status" TEXT CHECK ("expected_subject_status" IN ('active')),
  "expected_subject_intake_revision" INTEGER CHECK ("expected_subject_intake_revision" >= 1),
  "expected_subject_continuity_set_digest" TEXT CHECK (length("expected_subject_continuity_set_digest") = 64 AND "expected_subject_continuity_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "expected_subject_episode_scope_digest" TEXT CHECK (length("expected_subject_episode_scope_digest") = 64 AND "expected_subject_episode_scope_digest" NOT GLOB '*[^0-9a-f]*'),
  "claim_kind" TEXT,
  "claim_namespace" TEXT,
  "claim_key" TEXT,
  "candidate_claim_digest" TEXT CHECK (length("candidate_claim_digest") = 64 AND "candidate_claim_digest" NOT GLOB '*[^0-9a-f]*'),
  "subject_claim_digest" TEXT CHECK (length("subject_claim_digest") = 64 AND "subject_claim_digest" NOT GLOB '*[^0-9a-f]*'),
  "subject_claim_provenance_kind" TEXT CHECK ("subject_claim_provenance_kind" IN ('candidate', 'resolved_identity')),
  "subject_claim_provenance_ref" TEXT,
  "witness_digest" TEXT CHECK (length("witness_digest") = 64 AND "witness_digest" NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY ("intake_decision_id", "ordinal"),
  UNIQUE ("intake_decision_id", "subject_id"),
  FOREIGN KEY ("intake_decision_id") REFERENCES "libra_intake_decisions" ("intake_decision_id") ON DELETE RESTRICT,
  FOREIGN KEY ("subject_id") REFERENCES "libra_subjects" ("subject_id") ON DELETE RESTRICT
);

CREATE TABLE "libra_material_binding_episode_claims" (
  "subject_id" TEXT,
  "material_key" TEXT,
  "binding_revision" INTEGER CHECK ("binding_revision" >= 1),
  "episode_key" TEXT,
  "season_claim_digest" TEXT CHECK (length("season_claim_digest") = 64 AND "season_claim_digest" NOT GLOB '*[^0-9a-f]*'),
  "claim_digest" TEXT CHECK (length("claim_digest") = 64 AND "claim_digest" NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY ("subject_id", "material_key", "binding_revision", "episode_key"),
  FOREIGN KEY ("subject_id") REFERENCES "libra_subjects" ("subject_id") ON DELETE RESTRICT
);

CREATE TABLE "libra_material_bindings" (
  "subject_id" TEXT,
  "material_key" TEXT,
  "role" TEXT,
  "endpoint_id" TEXT,
  "location" TEXT,
  "binding_revision" INTEGER CHECK ("binding_revision" >= 1),
  "health_state" TEXT CHECK ("health_state" IN ('active', 'stale', 'released')),
  "evidence_digest" TEXT CHECK (length("evidence_digest") = 64 AND "evidence_digest" NOT GLOB '*[^0-9a-f]*'),
  "current" INTEGER CHECK ("current" IN (0, 1)),
  PRIMARY KEY ("subject_id", "material_key", "binding_revision"),
  FOREIGN KEY ("subject_id") REFERENCES "libra_subjects" ("subject_id") ON DELETE RESTRICT
);

CREATE TABLE "libra_offload_context_materials" (
  "on_deck_package_id" TEXT,
  "ordinal" INTEGER CHECK ("ordinal" >= 0),
  "material_key" TEXT,
  "context_role" TEXT,
  "binding_revision" INTEGER CHECK ("binding_revision" >= 1),
  "settlement_expectation" TEXT,
  PRIMARY KEY ("on_deck_package_id", "ordinal"),
  UNIQUE ("on_deck_package_id", "material_key", "context_role"),
  FOREIGN KEY ("on_deck_package_id") REFERENCES "libra_product_packages" ("on_deck_package_id") ON DELETE RESTRICT
);

CREATE TABLE "libra_product_fact_revisions" (
  "product_fact_id" TEXT PRIMARY KEY,
  "libra_run_id" TEXT,
  "fact_kind" TEXT,
  "fact_revision" INTEGER CHECK ("fact_revision" >= 1),
  "schema_ref" TEXT,
  "fact_json" TEXT,
  "fact_digest" TEXT CHECK (length("fact_digest") = 64 AND "fact_digest" NOT GLOB '*[^0-9a-f]*'),
  "evidence_digest" TEXT CHECK (length("evidence_digest") = 64 AND "evidence_digest" NOT GLOB '*[^0-9a-f]*'),
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  UNIQUE ("libra_run_id", "fact_kind", "fact_revision"),
  CHECK (json_valid("fact_json")),
  CHECK (length(CAST("fact_json" AS BLOB)) <= 65536),
  FOREIGN KEY ("libra_run_id") REFERENCES "libra_runs" ("libra_run_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_libra_product_fact_revisions_hot_01" ON "libra_product_fact_revisions" ("libra_run_id", "fact_kind", "fact_revision");

CREATE TABLE "libra_product_identity_revisions" (
  "subject_id" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "structure_kind" TEXT,
  "content_profile" TEXT,
  "identity_kind" TEXT,
  "provider_identity_set_digest" TEXT CHECK (length("provider_identity_set_digest") = 64 AND "provider_identity_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "exact_season_continuity_set_digest" TEXT CHECK (length("exact_season_continuity_set_digest") = 64 AND "exact_season_continuity_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "display_identity" TEXT,
  "identity_digest" TEXT CHECK (length("identity_digest") = 64 AND "identity_digest" NOT GLOB '*[^0-9a-f]*'),
  "evidence_digest" TEXT CHECK (length("evidence_digest") = 64 AND "evidence_digest" NOT GLOB '*[^0-9a-f]*'),
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  PRIMARY KEY ("subject_id", "revision"),
  FOREIGN KEY ("subject_id") REFERENCES "libra_subjects" ("subject_id") ON DELETE RESTRICT
);

CREATE TABLE "libra_product_package_materials" (
  "on_deck_package_id" TEXT,
  "ordinal" INTEGER CHECK ("ordinal" >= 0),
  "material_handle_id" TEXT,
  "material_key" TEXT,
  "role" TEXT,
  "episode_key" TEXT,
  "digest_algorithm" TEXT,
  "digest_hex" TEXT CHECK (length("digest_hex") = 64 AND "digest_hex" NOT GLOB '*[^0-9a-f]*'),
  "size_bytes" INTEGER CHECK ("size_bytes" >= 0),
  PRIMARY KEY ("on_deck_package_id", "ordinal"),
  UNIQUE ("on_deck_package_id", "material_key", "role"),
  FOREIGN KEY ("on_deck_package_id") REFERENCES "libra_product_packages" ("on_deck_package_id") ON DELETE RESTRICT
);

CREATE TABLE "libra_product_packages" (
  "on_deck_package_id" TEXT PRIMARY KEY,
  "offer_id" TEXT,
  "libra_run_id" TEXT,
  "subject_id" TEXT,
  "shelf_id" TEXT,
  "acceptance_spec_id" TEXT,
  "product_identity_digest" TEXT CHECK (length("product_identity_digest") = 64 AND "product_identity_digest" NOT GLOB '*[^0-9a-f]*'),
  "product_manifest_digest" TEXT CHECK (length("product_manifest_digest") = 64 AND "product_manifest_digest" NOT GLOB '*[^0-9a-f]*'),
  "media_cast_fact_id" TEXT,
  "media_cast_fact_digest" TEXT CHECK (length("media_cast_fact_digest") = 64 AND "media_cast_fact_digest" NOT GLOB '*[^0-9a-f]*'),
  "offload_context_digest" TEXT CHECK (length("offload_context_digest") = 64 AND "offload_context_digest" NOT GLOB '*[^0-9a-f]*'),
  "package_digest" TEXT CHECK (length("package_digest") = 64 AND "package_digest" NOT GLOB '*[^0-9a-f]*'),
  "state" TEXT CHECK ("state" IN ('published')),
  "published_at_ms" INTEGER CHECK ("published_at_ms" >= 0),
  UNIQUE ("libra_run_id", "package_digest"),
  FOREIGN KEY ("libra_run_id") REFERENCES "libra_runs" ("libra_run_id") ON DELETE RESTRICT,
  FOREIGN KEY ("subject_id") REFERENCES "libra_subjects" ("subject_id") ON DELETE RESTRICT,
  FOREIGN KEY ("acceptance_spec_id") REFERENCES "libra_acceptance_specs" ("acceptance_spec_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_libra_product_packages_hot_01" ON "libra_product_packages" ("shelf_id", "state", "published_at_ms");

CREATE TABLE "libra_routing_assessments" (
  "routing_assessment_id" TEXT PRIMARY KEY,
  "subject_id" TEXT,
  "decision_basis_id" TEXT,
  "routing_authority_kind" TEXT CHECK ("routing_authority_kind" IN ('policy', 'manual_selection')),
  "routing_policy_id" TEXT,
  "routing_policy_revision" INTEGER CHECK ("routing_policy_revision" >= 1),
  "manual_selection_digest" TEXT CHECK (length("manual_selection_digest") = 64 AND "manual_selection_digest" NOT GLOB '*[^0-9a-f]*'),
  "routing_input_digest" TEXT CHECK (length("routing_input_digest") = 64 AND "routing_input_digest" NOT GLOB '*[^0-9a-f]*'),
  "assessment_schema_ref" TEXT,
  "assessment_json" TEXT,
  "assessment_digest" TEXT CHECK (length("assessment_digest") = 64 AND "assessment_digest" NOT GLOB '*[^0-9a-f]*'),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  UNIQUE ("subject_id", "decision_basis_id", "routing_input_digest"),
  CHECK (json_valid("assessment_json")),
  CHECK (length(CAST("assessment_json" AS BLOB)) <= 65536),
  FOREIGN KEY ("subject_id") REFERENCES "libra_subjects" ("subject_id") ON DELETE RESTRICT,
  FOREIGN KEY ("decision_basis_id") REFERENCES "libra_decision_basis_revisions" ("decision_basis_id") ON DELETE RESTRICT
);

CREATE TABLE "libra_routing_decisions" (
  "routing_decision_id" TEXT PRIMARY KEY,
  "subject_id" TEXT,
  "assessment_id" TEXT,
  "decision_revision" INTEGER CHECK ("decision_revision" >= 1),
  "decision" TEXT CHECK ("decision" IN ('resolved', 'unresolved')),
  "shelf_id" TEXT,
  "unresolved_reason_code" TEXT,
  "routing_authority_kind" TEXT CHECK ("routing_authority_kind" IN ('policy', 'manual_selection')),
  "routing_policy_id" TEXT,
  "routing_policy_revision" INTEGER CHECK ("routing_policy_revision" >= 1),
  "manual_selection_digest" TEXT CHECK (length("manual_selection_digest") = 64 AND "manual_selection_digest" NOT GLOB '*[^0-9a-f]*'),
  "routing_input_digest" TEXT CHECK (length("routing_input_digest") = 64 AND "routing_input_digest" NOT GLOB '*[^0-9a-f]*'),
  "shelf_priority_set_digest" TEXT CHECK (length("shelf_priority_set_digest") = 64 AND "shelf_priority_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "decision_digest" TEXT CHECK (length("decision_digest") = 64 AND "decision_digest" NOT GLOB '*[^0-9a-f]*'),
  "decided_at_ms" INTEGER CHECK ("decided_at_ms" >= 0),
  UNIQUE ("subject_id", "decision_revision"),
  FOREIGN KEY ("subject_id") REFERENCES "libra_subjects" ("subject_id") ON DELETE RESTRICT,
  FOREIGN KEY ("assessment_id") REFERENCES "libra_routing_assessments" ("routing_assessment_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_libra_routing_decisions_hot_01" ON "libra_routing_decisions" ("shelf_id", "decided_at_ms");

CREATE TABLE "libra_routing_policy_revisions" (
  "routing_policy_id" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "field_id" TEXT,
  "mode" TEXT CHECK ("mode" IN ('direct', 'sorting')),
  "policy_schema_ref" TEXT,
  "policy_json" TEXT,
  "policy_digest" TEXT CHECK (length("policy_digest") = 64 AND "policy_digest" NOT GLOB '*[^0-9a-f]*'),
  "effective_at_ms" INTEGER CHECK ("effective_at_ms" >= 0),
  PRIMARY KEY ("routing_policy_id", "revision"),
  CHECK (json_valid("policy_json")),
  CHECK (length(CAST("policy_json" AS BLOB)) <= 65536)
);
CREATE INDEX "idx_libra_routing_policy_revisions_hot_01" ON "libra_routing_policy_revisions" ("field_id", "effective_at_ms");

CREATE TABLE "libra_routing_policy_targets" (
  "routing_policy_id" TEXT,
  "policy_revision" INTEGER CHECK ("policy_revision" >= 1),
  "shelf_id" TEXT,
  "rank" INTEGER CHECK ("rank" >= 0),
  "match_rule_schema_ref" TEXT,
  "match_rule_json" TEXT,
  "match_rule_digest" TEXT CHECK (length("match_rule_digest") = 64 AND "match_rule_digest" NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY ("routing_policy_id", "policy_revision", "shelf_id"),
  UNIQUE ("routing_policy_id", "policy_revision", "rank"),
  CHECK (json_valid("match_rule_json")),
  CHECK (length(CAST("match_rule_json" AS BLOB)) <= 16384)
);

CREATE TABLE "libra_run_discard_decisions" (
  "discard_decision_id" TEXT PRIMARY KEY,
  "libra_run_id" TEXT,
  "run_scope_digest" TEXT CHECK (length("run_scope_digest") = 64 AND "run_scope_digest" NOT GLOB '*[^0-9a-f]*'),
  "input_control_scope_digest" TEXT CHECK (length("input_control_scope_digest") = 64 AND "input_control_scope_digest" NOT GLOB '*[^0-9a-f]*'),
  "workspace_cleanup_scope_digest" TEXT CHECK (length("workspace_cleanup_scope_digest") = 64 AND "workspace_cleanup_scope_digest" NOT GLOB '*[^0-9a-f]*'),
  "actor_id" TEXT,
  "decision_digest" TEXT CHECK (length("decision_digest") = 64 AND "decision_digest" NOT GLOB '*[^0-9a-f]*'),
  "decided_at_ms" INTEGER CHECK ("decided_at_ms" >= 0),
  UNIQUE ("libra_run_id"),
  FOREIGN KEY ("libra_run_id") REFERENCES "libra_runs" ("libra_run_id") ON DELETE RESTRICT
);

CREATE TABLE "libra_run_discard_receipts" (
  "receipt_id" TEXT PRIMARY KEY,
  "discard_decision_id" TEXT,
  "libra_run_id" TEXT,
  "released_input_control_set_digest" TEXT CHECK (length("released_input_control_set_digest") = 64 AND "released_input_control_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "cleanup_scope_id" TEXT,
  "commit_digest" TEXT CHECK (length("commit_digest") = 64 AND "commit_digest" NOT GLOB '*[^0-9a-f]*'),
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  UNIQUE ("discard_decision_id"),
  FOREIGN KEY ("discard_decision_id") REFERENCES "libra_run_discard_decisions" ("discard_decision_id") ON DELETE RESTRICT,
  FOREIGN KEY ("libra_run_id") REFERENCES "libra_runs" ("libra_run_id") ON DELETE RESTRICT,
  FOREIGN KEY ("cleanup_scope_id") REFERENCES "libra_workspace_cleanup_scopes" ("cleanup_scope_id") ON DELETE RESTRICT
);

CREATE TABLE "libra_runs" (
  "libra_run_id" TEXT PRIMARY KEY,
  "subject_id" TEXT,
  "acceptance_spec_id" TEXT,
  "initial_material_manifest_digest" TEXT CHECK (length("initial_material_manifest_digest") = 64 AND "initial_material_manifest_digest" NOT GLOB '*[^0-9a-f]*'),
  "run_scope_digest" TEXT CHECK (length("run_scope_digest") = 64 AND "run_scope_digest" NOT GLOB '*[^0-9a-f]*'),
  "state" TEXT CHECK ("state" IN ('active', 'suspended', 'superseded', 'frozen', 'discarded', 'completed')),
  "priority_class" TEXT,
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "terminal_at_ms" INTEGER CHECK ("terminal_at_ms" >= 0),
  FOREIGN KEY ("subject_id") REFERENCES "libra_subjects" ("subject_id") ON DELETE RESTRICT,
  FOREIGN KEY ("acceptance_spec_id") REFERENCES "libra_acceptance_specs" ("acceptance_spec_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_libra_runs_hot_01" ON "libra_runs" ("state", "priority_class", "created_at_ms");
CREATE UNIQUE INDEX "uidx_libra_runs_partial_01" ON "libra_runs" ("subject_id", "acceptance_spec_id", "run_scope_digest") WHERE "terminal_at_ms" IS NULL;

CREATE TABLE "libra_subject_abandon_decisions" (
  "abandon_decision_id" TEXT PRIMARY KEY,
  "subject_id" TEXT,
  "subject_scope_digest" TEXT CHECK (length("subject_scope_digest") = 64 AND "subject_scope_digest" NOT GLOB '*[^0-9a-f]*'),
  "input_control_scope_digest" TEXT CHECK (length("input_control_scope_digest") = 64 AND "input_control_scope_digest" NOT GLOB '*[^0-9a-f]*'),
  "actor_id" TEXT,
  "idempotency_key" TEXT,
  "decision_digest" TEXT CHECK (length("decision_digest") = 64 AND "decision_digest" NOT GLOB '*[^0-9a-f]*'),
  "decided_at_ms" INTEGER CHECK ("decided_at_ms" >= 0),
  UNIQUE ("subject_id"),
  FOREIGN KEY ("subject_id") REFERENCES "libra_subjects" ("subject_id") ON DELETE RESTRICT
);

CREATE TABLE "libra_subject_abandon_receipts" (
  "receipt_id" TEXT PRIMARY KEY,
  "abandon_decision_id" TEXT,
  "subject_id" TEXT,
  "released_control_set_digest" TEXT CHECK (length("released_control_set_digest") = 64 AND "released_control_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "terminal_fact_digest" TEXT CHECK (length("terminal_fact_digest") = 64 AND "terminal_fact_digest" NOT GLOB '*[^0-9a-f]*'),
  "commit_digest" TEXT CHECK (length("commit_digest") = 64 AND "commit_digest" NOT GLOB '*[^0-9a-f]*'),
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  UNIQUE ("abandon_decision_id"),
  FOREIGN KEY ("abandon_decision_id") REFERENCES "libra_subject_abandon_decisions" ("abandon_decision_id") ON DELETE RESTRICT,
  FOREIGN KEY ("subject_id") REFERENCES "libra_subjects" ("subject_id") ON DELETE RESTRICT
);

CREATE TABLE "libra_subject_continuity_heads" (
  "head_id" TEXT PRIMARY KEY CHECK ("head_id" IN ('active_subject_continuity')),
  "current_revision" INTEGER CHECK ("current_revision" >= 0),
  "head_digest" TEXT CHECK (length("head_digest") = 64 AND "head_digest" NOT GLOB '*[^0-9a-f]*'),
  "updated_at_ms" INTEGER CHECK ("updated_at_ms" >= 0)
);

CREATE TABLE "libra_subject_decision_heads" (
  "subject_id" TEXT PRIMARY KEY,
  "head_revision" INTEGER CHECK ("head_revision" >= 1),
  "head_digest" TEXT CHECK (length("head_digest") = 64 AND "head_digest" NOT GLOB '*[^0-9a-f]*'),
  "current_routing_decision_id" TEXT,
  "current_decision_basis_id" TEXT,
  "current_acceptance_spec_id" TEXT,
  "updated_at_ms" INTEGER CHECK ("updated_at_ms" >= 0),
  FOREIGN KEY ("subject_id") REFERENCES "libra_subjects" ("subject_id") ON DELETE RESTRICT,
  FOREIGN KEY ("current_routing_decision_id") REFERENCES "libra_routing_decisions" ("routing_decision_id") ON DELETE RESTRICT,
  FOREIGN KEY ("current_decision_basis_id") REFERENCES "libra_decision_basis_revisions" ("decision_basis_id") ON DELETE RESTRICT,
  FOREIGN KEY ("current_acceptance_spec_id") REFERENCES "libra_acceptance_specs" ("acceptance_spec_id") ON DELETE RESTRICT
);

CREATE TABLE "libra_subject_episode_scopes" (
  "subject_id" TEXT,
  "episode_key" TEXT,
  "first_intake_decision_id" TEXT,
  "source_episode_scope_digest" TEXT CHECK (length("source_episode_scope_digest") = 64 AND "source_episode_scope_digest" NOT GLOB '*[^0-9a-f]*'),
  "accepted_at_ms" INTEGER CHECK ("accepted_at_ms" >= 0),
  PRIMARY KEY ("subject_id", "episode_key"),
  FOREIGN KEY ("subject_id") REFERENCES "libra_subjects" ("subject_id") ON DELETE RESTRICT,
  FOREIGN KEY ("first_intake_decision_id") REFERENCES "libra_intake_decisions" ("intake_decision_id") ON DELETE RESTRICT
);

CREATE TABLE "libra_subject_season_continuity_claims" (
  "subject_id" TEXT,
  "claim_kind" TEXT CHECK ("claim_kind" IN ('provider_season_identity', 'triage_grouping_lineage')),
  "claim_namespace" TEXT,
  "claim_key" TEXT,
  "claim_digest" TEXT CHECK (length("claim_digest") = 64 AND "claim_digest" NOT GLOB '*[^0-9a-f]*'),
  "provenance_kind" TEXT CHECK ("provenance_kind" IN ('candidate', 'resolved_identity')),
  "provenance_ref" TEXT,
  "accepted_at_ms" INTEGER CHECK ("accepted_at_ms" >= 0),
  PRIMARY KEY ("subject_id", "claim_kind", "claim_namespace", "claim_key", "provenance_ref"),
  FOREIGN KEY ("subject_id") REFERENCES "libra_subjects" ("subject_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_libra_subject_season_continuity_claims_hot_01" ON "libra_subject_season_continuity_claims" ("claim_kind", "claim_namespace", "claim_key", "subject_id");

CREATE TABLE "libra_subjects" (
  "subject_id" TEXT PRIMARY KEY,
  "structure_kind" TEXT CHECK ("structure_kind" IN ('single', 'season')),
  "content_profile" TEXT CHECK ("content_profile" IN ('movie', 'series', 'jav', 'western_adult')),
  "routing_anchor_intake_decision_id" TEXT,
  "status" TEXT CHECK ("status" IN ('active', 'abandoned', 'completed')),
  "intake_revision" INTEGER CHECK ("intake_revision" >= 1),
  "current_continuity_set_digest" TEXT CHECK (length("current_continuity_set_digest") = 64 AND "current_continuity_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "current_episode_scope_digest" TEXT CHECK (length("current_episode_scope_digest") = 64 AND "current_episode_scope_digest" NOT GLOB '*[^0-9a-f]*'),
  "current_identity_revision" INTEGER CHECK ("current_identity_revision" >= 1),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "updated_at_ms" INTEGER CHECK ("updated_at_ms" >= 0),
  "terminal_at_ms" INTEGER CHECK ("terminal_at_ms" >= 0),
  FOREIGN KEY ("routing_anchor_intake_decision_id") REFERENCES "libra_intake_decisions" ("intake_decision_id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY ("subject_id", "current_identity_revision") REFERENCES "libra_product_identity_revisions" ("subject_id", "revision") ON DELETE RESTRICT
);
CREATE INDEX "idx_libra_subjects_hot_01" ON "libra_subjects" ("status", "subject_id");

CREATE TABLE "libra_workspace_cleanup_members" (
  "cleanup_scope_id" TEXT,
  "material_handle_id" TEXT,
  "material_key" TEXT,
  "expected_control_revision" INTEGER CHECK ("expected_control_revision" >= 1),
  "cleanup_kind" TEXT,
  "state" TEXT CHECK ("state" IN ('pending', 'deleted', 'released', 'blocked')),
  "deletion_effect_id" TEXT,
  "cleanup_receipt_id" TEXT,
  "updated_at_ms" INTEGER CHECK ("updated_at_ms" >= 0),
  PRIMARY KEY ("cleanup_scope_id", "material_handle_id"),
  FOREIGN KEY ("cleanup_scope_id") REFERENCES "libra_workspace_cleanup_scopes" ("cleanup_scope_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_libra_workspace_cleanup_members_hot_01" ON "libra_workspace_cleanup_members" ("state", "updated_at_ms");

CREATE TABLE "libra_workspace_cleanup_scopes" (
  "cleanup_scope_id" TEXT PRIMARY KEY,
  "libra_run_id" TEXT,
  "trigger_kind" TEXT CHECK ("trigger_kind" IN ('offload_completed', 'run_discarded')),
  "trigger_ref" TEXT,
  "trigger_digest" TEXT CHECK (length("trigger_digest") = 64 AND "trigger_digest" NOT GLOB '*[^0-9a-f]*'),
  "state" TEXT CHECK ("state" IN ('active', 'completed')),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "completed_at_ms" INTEGER CHECK ("completed_at_ms" >= 0),
  UNIQUE ("trigger_kind", "trigger_ref", "trigger_digest"),
  FOREIGN KEY ("libra_run_id") REFERENCES "libra_runs" ("libra_run_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_libra_workspace_cleanup_scopes_hot_01" ON "libra_workspace_cleanup_scopes" ("state", "created_at_ms");

CREATE TABLE "libra_workspace_material_refs" (
  "libra_run_id" TEXT,
  "workspace_id" TEXT,
  "material_handle_id" TEXT,
  "product_role" TEXT,
  "episode_key" TEXT,
  "reference_revision" INTEGER CHECK ("reference_revision" >= 1),
  PRIMARY KEY ("libra_run_id", "material_handle_id", "reference_revision"),
  FOREIGN KEY ("libra_run_id") REFERENCES "libra_runs" ("libra_run_id") ON DELETE RESTRICT,
  FOREIGN KEY ("workspace_id") REFERENCES "fx_workspace_registry" ("workspace_id") ON DELETE RESTRICT
);

CREATE TABLE "libra_workspaces" (
  "libra_run_id" TEXT,
  "workspace_id" TEXT,
  "workspace_revision" INTEGER CHECK ("workspace_revision" >= 1),
  "state" TEXT CHECK ("state" IN ('active', 'reclaiming', 'reclaimed')),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  PRIMARY KEY ("libra_run_id", "workspace_revision"),
  FOREIGN KEY ("libra_run_id") REFERENCES "libra_runs" ("libra_run_id") ON DELETE RESTRICT,
  FOREIGN KEY ("workspace_id") REFERENCES "fx_workspace_registry" ("workspace_id") ON DELETE RESTRICT
);

CREATE TABLE "people_aliases" (
  "person_id" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "alias_normalized" TEXT,
  "alias_display" TEXT,
  "provenance_digest" TEXT CHECK (length("provenance_digest") = 64 AND "provenance_digest" NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY ("person_id", "revision", "alias_normalized"),
  FOREIGN KEY ("person_id", "revision") REFERENCES "people_person_revisions" ("person_id", "revision") ON DELETE RESTRICT
);
CREATE INDEX "idx_people_aliases_hot_01" ON "people_aliases" ("alias_normalized");

CREATE TABLE "people_merge_candidate_revisions" (
  "merge_candidate_id" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "state" TEXT CHECK ("state" IN ('open', 'accepted', 'dismissed', 'superseded')),
  "decision_origin" TEXT,
  "decision_ref" TEXT,
  "decision_digest" TEXT CHECK (length("decision_digest") = 64 AND "decision_digest" NOT GLOB '*[^0-9a-f]*'),
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  PRIMARY KEY ("merge_candidate_id", "revision"),
  UNIQUE ("merge_candidate_id", "revision", "state"),
  FOREIGN KEY ("merge_candidate_id") REFERENCES "people_merge_candidates" ("merge_candidate_id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE "people_merge_candidates" (
  "merge_candidate_id" TEXT PRIMARY KEY,
  "current_revision" INTEGER CHECK ("current_revision" >= 1),
  "current_state" TEXT CHECK ("current_state" IN ('open', 'accepted', 'dismissed', 'superseded')),
  "left_person_id" TEXT,
  "left_person_revision" INTEGER CHECK ("left_person_revision" >= 1),
  "right_person_id" TEXT,
  "right_person_revision" INTEGER CHECK ("right_person_revision" >= 1),
  "evidence_digest" TEXT CHECK (length("evidence_digest") = 64 AND "evidence_digest" NOT GLOB '*[^0-9a-f]*'),
  "candidate_schema_ref" TEXT,
  "candidate_json" TEXT,
  "candidate_payload_digest" TEXT CHECK (length("candidate_payload_digest") = 64 AND "candidate_payload_digest" NOT GLOB '*[^0-9a-f]*'),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "terminal_at_ms" INTEGER CHECK ("terminal_at_ms" >= 0),
  CHECK (json_valid("candidate_json")),
  CHECK (length(CAST("candidate_json" AS BLOB)) <= 16384),
  CHECK ("left_person_id" = json_extract("candidate_json", '$.leftPersonRef.personId')),
  CHECK ("left_person_revision" = json_extract("candidate_json", '$.leftPersonRef.revision')),
  CHECK ("right_person_id" = json_extract("candidate_json", '$.rightPersonRef.personId')),
  CHECK ("right_person_revision" = json_extract("candidate_json", '$.rightPersonRef.revision')),
  FOREIGN KEY ("left_person_id", "left_person_revision") REFERENCES "people_person_revisions" ("person_id", "revision") ON DELETE RESTRICT,
  FOREIGN KEY ("right_person_id", "right_person_revision") REFERENCES "people_person_revisions" ("person_id", "revision") ON DELETE RESTRICT,
  FOREIGN KEY ("merge_candidate_id", "current_revision", "current_state") REFERENCES "people_merge_candidate_revisions" ("merge_candidate_id", "revision", "state") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX "idx_people_merge_candidates_hot_01" ON "people_merge_candidates" ("current_state", "created_at_ms");
CREATE UNIQUE INDEX "uidx_people_merge_candidates_partial_01" ON "people_merge_candidates" ("left_person_id", "right_person_id") WHERE "current_state" = 'open';

CREATE TABLE "people_merge_records" (
  "merge_record_id" TEXT PRIMARY KEY,
  "merge_candidate_id" TEXT,
  "merge_candidate_revision" INTEGER CHECK ("merge_candidate_revision" >= 1),
  "source_person_id" TEXT,
  "previous_source_person_revision" INTEGER CHECK ("previous_source_person_revision" >= 1),
  "committed_source_person_revision" INTEGER CHECK ("committed_source_person_revision" >= 1),
  "target_person_id" TEXT,
  "previous_target_person_revision" INTEGER CHECK ("previous_target_person_revision" >= 1),
  "committed_target_person_revision" INTEGER CHECK ("committed_target_person_revision" >= 1),
  "preference_resolution_digest" TEXT CHECK (length("preference_resolution_digest") = 64 AND "preference_resolution_digest" NOT GLOB '*[^0-9a-f]*'),
  "decision_digest" TEXT CHECK (length("decision_digest") = 64 AND "decision_digest" NOT GLOB '*[^0-9a-f]*'),
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  UNIQUE ("source_person_id"),
  FOREIGN KEY ("merge_candidate_id", "merge_candidate_revision") REFERENCES "people_merge_candidate_revisions" ("merge_candidate_id", "revision") ON DELETE RESTRICT,
  FOREIGN KEY ("source_person_id", "previous_source_person_revision") REFERENCES "people_person_revisions" ("person_id", "revision") ON DELETE RESTRICT,
  FOREIGN KEY ("source_person_id", "committed_source_person_revision") REFERENCES "people_person_revisions" ("person_id", "revision") ON DELETE RESTRICT,
  FOREIGN KEY ("target_person_id", "previous_target_person_revision") REFERENCES "people_person_revisions" ("person_id", "revision") ON DELETE RESTRICT,
  FOREIGN KEY ("target_person_id", "committed_target_person_revision") REFERENCES "people_person_revisions" ("person_id", "revision") ON DELETE RESTRICT
);

CREATE TABLE "people_person_revisions" (
  "person_id" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "person_status" TEXT CHECK ("person_status" IN ('active', 'merged')),
  "canonical_name" TEXT,
  "merged_into_person_id" TEXT,
  "origin_kind" TEXT CHECK ("origin_kind" IN ('direct', 'candidate')),
  "origin_decision_id" TEXT,
  "origin_decision_digest" TEXT CHECK (length("origin_decision_digest") = 64 AND "origin_decision_digest" NOT GLOB '*[^0-9a-f]*'),
  "origin_candidate_kind" TEXT,
  "origin_candidate_id" TEXT,
  "origin_candidate_revision" INTEGER CHECK ("origin_candidate_revision" >= 1),
  "origin_candidate_payload_digest" TEXT CHECK (length("origin_candidate_payload_digest") = 64 AND "origin_candidate_payload_digest" NOT GLOB '*[^0-9a-f]*'),
  "fact_digest" TEXT CHECK (length("fact_digest") = 64 AND "fact_digest" NOT GLOB '*[^0-9a-f]*'),
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  PRIMARY KEY ("person_id", "revision"),
  CHECK (("origin_kind" = 'direct' AND "origin_decision_id" IS NOT NULL AND "origin_decision_digest" IS NOT NULL AND "origin_candidate_kind" IS NULL AND "origin_candidate_id" IS NULL AND "origin_candidate_revision" IS NULL AND "origin_candidate_payload_digest" IS NULL) OR ("origin_kind" = 'candidate' AND "origin_decision_id" IS NULL AND "origin_decision_digest" IS NULL AND "origin_candidate_kind" IS NOT NULL AND "origin_candidate_id" IS NOT NULL AND "origin_candidate_revision" IS NOT NULL AND "origin_candidate_payload_digest" IS NOT NULL)),
  FOREIGN KEY ("person_id") REFERENCES "people_persons" ("person_id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE "people_persons" (
  "person_id" TEXT PRIMARY KEY,
  "status" TEXT CHECK ("status" IN ('active', 'merged')),
  "current_revision" INTEGER CHECK ("current_revision" >= 1),
  "current_preference_revision" INTEGER CHECK ("current_preference_revision" >= 1),
  "current_reference_revision" INTEGER CHECK ("current_reference_revision" >= 1),
  "current_reference_projection_revision" INTEGER CHECK ("current_reference_projection_revision" >= 1),
  "current_reference_projection_digest" TEXT CHECK (length("current_reference_projection_digest") = 64 AND "current_reference_projection_digest" NOT GLOB '*[^0-9a-f]*'),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "terminal_at_ms" INTEGER CHECK ("terminal_at_ms" >= 0),
  FOREIGN KEY ("person_id", "current_reference_revision") REFERENCES "people_reference_revisions" ("person_id", "revision") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY ("person_id", "current_revision") REFERENCES "people_person_revisions" ("person_id", "revision") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY ("person_id", "current_preference_revision") REFERENCES "people_preference_revisions" ("person_id", "revision") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX "idx_people_persons_hot_01" ON "people_persons" ("status", "person_id");

CREATE TABLE "people_preference_revisions" (
  "person_id" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "preference_level" NUMERIC,
  "reason" TEXT,
  "origin_kind" TEXT,
  "origin_ref" TEXT,
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  PRIMARY KEY ("person_id", "revision"),
  FOREIGN KEY ("person_id") REFERENCES "people_persons" ("person_id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE "people_provider_identities" (
  "person_id" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "provider" TEXT,
  "namespace" TEXT,
  "provider_key" TEXT,
  "provenance_digest" TEXT CHECK (length("provenance_digest") = 64 AND "provenance_digest" NOT GLOB '*[^0-9a-f]*'),
  "active_guard" INTEGER NOT NULL DEFAULT 0 CHECK ("active_guard" IN (0, 1)),
  PRIMARY KEY ("person_id", "revision", "provider", "namespace", "provider_key"),
  FOREIGN KEY ("person_id", "revision") REFERENCES "people_person_revisions" ("person_id", "revision") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "uidx_people_provider_identities_partial_01" ON "people_provider_identities" ("provider", "namespace", "provider_key") WHERE "active_guard" = 1;

CREATE TABLE "people_reference_assets" (
  "reference_asset_id" TEXT PRIMARY KEY,
  "person_id" TEXT,
  "artifact_handle_id" TEXT,
  "artifact_digest" TEXT CHECK (length("artifact_digest") = 64 AND "artifact_digest" NOT GLOB '*[^0-9a-f]*'),
  "state" TEXT CHECK ("state" IN ('active', 'released')),
  "created_reference_revision" INTEGER CHECK ("created_reference_revision" >= 1),
  "released_reference_revision" INTEGER CHECK ("released_reference_revision" >= 1),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "released_at_ms" INTEGER CHECK ("released_at_ms" >= 0),
  UNIQUE ("person_id", "artifact_digest"),
  CHECK (("state" = 'active' AND "released_reference_revision" IS NULL AND "released_at_ms" IS NULL) OR ("state" = 'released' AND "released_reference_revision" IS NOT NULL AND "released_at_ms" IS NOT NULL)),
  FOREIGN KEY ("person_id", "created_reference_revision") REFERENCES "people_reference_revisions" ("person_id", "revision") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY ("person_id", "released_reference_revision") REFERENCES "people_reference_revisions" ("person_id", "revision") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE "people_reference_faces" (
  "reference_face_id" TEXT PRIMARY KEY,
  "person_id" TEXT,
  "reference_asset_id" TEXT,
  "embedding_handle_id" TEXT,
  "embedding_digest" TEXT CHECK (length("embedding_digest") = 64 AND "embedding_digest" NOT GLOB '*[^0-9a-f]*'),
  "model_ref" TEXT,
  "state" TEXT CHECK ("state" IN ('active', 'released')),
  "created_reference_revision" INTEGER CHECK ("created_reference_revision" >= 1),
  "released_reference_revision" INTEGER CHECK ("released_reference_revision" >= 1),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "released_at_ms" INTEGER CHECK ("released_at_ms" >= 0),
  UNIQUE ("reference_asset_id"),
  UNIQUE ("person_id", "embedding_handle_id", "model_ref"),
  CHECK (("state" = 'active' AND "released_reference_revision" IS NULL AND "released_at_ms" IS NULL) OR ("state" = 'released' AND "released_reference_revision" IS NOT NULL AND "released_at_ms" IS NOT NULL)),
  FOREIGN KEY ("reference_asset_id") REFERENCES "people_reference_assets" ("reference_asset_id") ON DELETE RESTRICT,
  FOREIGN KEY ("person_id", "created_reference_revision") REFERENCES "people_reference_revisions" ("person_id", "revision") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY ("person_id", "released_reference_revision") REFERENCES "people_reference_revisions" ("person_id", "revision") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE "people_reference_revisions" (
  "person_id" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "operation_kind" TEXT CHECK ("operation_kind" IN ('add_image', 'release_image')),
  "reference_asset_id" TEXT,
  "reference_face_id" TEXT,
  "active_asset_set_digest" TEXT CHECK (length("active_asset_set_digest") = 64 AND "active_asset_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "active_face_set_digest" TEXT CHECK (length("active_face_set_digest") = 64 AND "active_face_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "reference_set_digest" TEXT CHECK (length("reference_set_digest") = 64 AND "reference_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "decision_digest" TEXT CHECK (length("decision_digest") = 64 AND "decision_digest" NOT GLOB '*[^0-9a-f]*'),
  "fact_digest" TEXT CHECK (length("fact_digest") = 64 AND "fact_digest" NOT GLOB '*[^0-9a-f]*'),
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  PRIMARY KEY ("person_id", "revision"),
  FOREIGN KEY ("person_id") REFERENCES "people_persons" ("person_id") ON DELETE RESTRICT,
  FOREIGN KEY ("reference_asset_id") REFERENCES "people_reference_assets" ("reference_asset_id") ON DELETE RESTRICT,
  FOREIGN KEY ("reference_face_id") REFERENCES "people_reference_faces" ("reference_face_id") ON DELETE RESTRICT
);

CREATE TABLE "people_registration_candidate_revisions" (
  "registration_candidate_id" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "state" TEXT CHECK ("state" IN ('open', 'accepted', 'dismissed', 'superseded')),
  "decision_origin" TEXT,
  "decision_ref" TEXT,
  "decision_digest" TEXT CHECK (length("decision_digest") = 64 AND "decision_digest" NOT GLOB '*[^0-9a-f]*'),
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  PRIMARY KEY ("registration_candidate_id", "revision"),
  UNIQUE ("registration_candidate_id", "revision", "state"),
  FOREIGN KEY ("registration_candidate_id") REFERENCES "people_registration_candidates" ("registration_candidate_id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE "people_registration_candidates" (
  "registration_candidate_id" TEXT PRIMARY KEY,
  "current_revision" INTEGER CHECK ("current_revision" >= 1),
  "current_state" TEXT CHECK ("current_state" IN ('open', 'accepted', 'dismissed', 'superseded')),
  "proposed_name" TEXT,
  "evidence_digest" TEXT CHECK (length("evidence_digest") = 64 AND "evidence_digest" NOT GLOB '*[^0-9a-f]*'),
  "candidate_schema_ref" TEXT,
  "candidate_json" TEXT,
  "candidate_payload_digest" TEXT CHECK (length("candidate_payload_digest") = 64 AND "candidate_payload_digest" NOT GLOB '*[^0-9a-f]*'),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "terminal_at_ms" INTEGER CHECK ("terminal_at_ms" >= 0),
  CHECK (json_valid("candidate_json")),
  CHECK (length(CAST("candidate_json" AS BLOB)) <= 16384),
  CHECK ("proposed_name" = json_extract("candidate_json", '$.proposedName')),
  FOREIGN KEY ("registration_candidate_id", "current_revision", "current_state") REFERENCES "people_registration_candidate_revisions" ("registration_candidate_id", "revision", "state") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX "idx_people_registration_candidates_hot_01" ON "people_registration_candidates" ("current_state", "created_at_ms");
CREATE UNIQUE INDEX "uidx_people_registration_candidates_partial_01" ON "people_registration_candidates" ("evidence_digest") WHERE "current_state" = 'open';

CREATE TABLE "perception_acquisition_commits" (
  "acquisition_commit_receipt_id" TEXT PRIMARY KEY,
  "perception_acquisition_id" TEXT,
  "perception_source_id" TEXT,
  "page_ordinal" INTEGER CHECK ("page_ordinal" >= 0),
  "expected_cursor_revision" INTEGER CHECK ("expected_cursor_revision" >= 0),
  "committed_cursor_revision" INTEGER CHECK ("committed_cursor_revision" >= 1),
  "observation_page_digest" TEXT CHECK (length("observation_page_digest") = 64 AND "observation_page_digest" NOT GLOB '*[^0-9a-f]*'),
  "commit_marker" TEXT,
  "result_schema_ref" TEXT,
  "result_json" TEXT,
  "result_digest" TEXT CHECK (length("result_digest") = 64 AND "result_digest" NOT GLOB '*[^0-9a-f]*'),
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  UNIQUE ("perception_acquisition_id", "page_ordinal"),
  UNIQUE ("commit_marker"),
  CHECK (json_valid("result_json")),
  CHECK (length(CAST("result_json" AS BLOB)) <= 65536),
  FOREIGN KEY ("perception_acquisition_id") REFERENCES "perception_acquisitions" ("perception_acquisition_id") ON DELETE RESTRICT,
  FOREIGN KEY ("perception_source_id") REFERENCES "perception_sources" ("perception_source_id") ON DELETE RESTRICT
);

CREATE TABLE "perception_acquisitions" (
  "perception_acquisition_id" TEXT PRIMARY KEY,
  "perception_source_id" TEXT,
  "source_config_revision" INTEGER CHECK ("source_config_revision" >= 1),
  "scope_schema_ref" TEXT,
  "scope_json" TEXT,
  "scope_digest" TEXT CHECK (length("scope_digest") = 64 AND "scope_digest" NOT GLOB '*[^0-9a-f]*'),
  "initial_cursor_revision" INTEGER CHECK ("initial_cursor_revision" >= 0),
  "initial_cursor_value" TEXT,
  "state" TEXT CHECK ("state" IN ('active', 'completed', 'failed')),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "terminal_at_ms" INTEGER CHECK ("terminal_at_ms" >= 0),
  CHECK (json_valid("scope_json")),
  CHECK (length(CAST("scope_json" AS BLOB)) <= 16384),
  FOREIGN KEY ("perception_source_id") REFERENCES "perception_sources" ("perception_source_id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "uidx_perception_acquisitions_partial_01" ON "perception_acquisitions" ("perception_source_id") WHERE "state" = 'active';

CREATE TABLE "perception_identity_anchors" (
  "perception_id" TEXT,
  "anchor_kind" TEXT,
  "anchor_value" TEXT,
  "confidence_class" TEXT,
  "evidence_digest" TEXT CHECK (length("evidence_digest") = 64 AND "evidence_digest" NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY ("perception_id", "anchor_kind", "anchor_value"),
  FOREIGN KEY ("perception_id") REFERENCES "perception_records" ("perception_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_perception_identity_anchors_hot_01" ON "perception_identity_anchors" ("anchor_kind", "anchor_value");

CREATE TABLE "perception_record_relations" (
  "relation_id" TEXT PRIMARY KEY,
  "relation_kind" TEXT CHECK ("relation_kind" IN ('duplicate_of', 'supersedes', 'retracts')),
  "source_perception_id" TEXT,
  "target_perception_id" TEXT,
  "rule_revision" INTEGER CHECK ("rule_revision" >= 1),
  "evidence_digest" TEXT CHECK (length("evidence_digest") = 64 AND "evidence_digest" NOT GLOB '*[^0-9a-f]*'),
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  UNIQUE ("relation_kind", "source_perception_id", "target_perception_id"),
  FOREIGN KEY ("source_perception_id") REFERENCES "perception_records" ("perception_id") ON DELETE RESTRICT,
  FOREIGN KEY ("target_perception_id") REFERENCES "perception_records" ("perception_id") ON DELETE RESTRICT
);

CREATE TABLE "perception_records" (
  "perception_id" TEXT PRIMARY KEY,
  "perception_source_id" TEXT,
  "perception_acquisition_id" TEXT,
  "acquisition_commit_receipt_id" TEXT,
  "record_kind" TEXT CHECK ("record_kind" IN ('observation', 'correction', 'retraction')),
  "source_kind" TEXT,
  "source_record_key" TEXT,
  "source_record_revision" INTEGER CHECK ("source_record_revision" >= 1),
  "source_record_digest" TEXT CHECK (length("source_record_digest") = 64 AND "source_record_digest" NOT GLOB '*[^0-9a-f]*'),
  "normalization_rule_ref" TEXT,
  "rating" INTEGER,
  "watched_state" INTEGER CHECK ("watched_state" IN (0, 1)),
  "observed_title" TEXT,
  "provenance_ref" TEXT,
  "provenance_digest" TEXT CHECK (length("provenance_digest") = 64 AND "provenance_digest" NOT GLOB '*[^0-9a-f]*'),
  "record_digest" TEXT CHECK (length("record_digest") = 64 AND "record_digest" NOT GLOB '*[^0-9a-f]*'),
  "observed_at_ms" INTEGER CHECK ("observed_at_ms" >= 0),
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  UNIQUE ("perception_source_id", "source_record_key", "source_record_revision", "source_record_digest"),
  CHECK ("rating" IS NULL OR ("rating" = CAST("rating" AS INTEGER) AND "rating" BETWEEN 1 AND 5)),
  CHECK ("watched_state" IS NULL OR "watched_state" IN (0, 1)),
  FOREIGN KEY ("perception_source_id") REFERENCES "perception_sources" ("perception_source_id") ON DELETE RESTRICT,
  FOREIGN KEY ("perception_acquisition_id") REFERENCES "perception_acquisitions" ("perception_acquisition_id") ON DELETE RESTRICT,
  FOREIGN KEY ("acquisition_commit_receipt_id") REFERENCES "perception_acquisition_commits" ("acquisition_commit_receipt_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_perception_records_hot_01" ON "perception_records" ("source_kind", "source_record_key", "committed_at_ms");

CREATE TABLE "perception_resolution_heads" (
  "query_contract" TEXT,
  "query_input_digest" TEXT CHECK (length("query_input_digest") = 64 AND "query_input_digest" NOT GLOB '*[^0-9a-f]*'),
  "current_resolution_id" TEXT,
  "current_revision" INTEGER CHECK ("current_revision" >= 1),
  "updated_at_ms" INTEGER CHECK ("updated_at_ms" >= 0),
  PRIMARY KEY ("query_contract", "query_input_digest"),
  FOREIGN KEY ("query_contract", "query_input_digest", "current_revision", "current_resolution_id") REFERENCES "perception_resolution_revisions" ("query_contract", "query_input_digest", "revision", "resolution_id") ON DELETE RESTRICT
);

CREATE TABLE "perception_resolution_revisions" (
  "resolution_id" TEXT PRIMARY KEY,
  "query_contract" TEXT,
  "query_schema_ref" TEXT,
  "query_input_digest" TEXT CHECK (length("query_input_digest") = 64 AND "query_input_digest" NOT GLOB '*[^0-9a-f]*'),
  "fact_kind" TEXT CHECK ("fact_kind" IN ('rating', 'watched')),
  "revision" INTEGER CHECK ("revision" >= 1),
  "record_set_digest" TEXT CHECK (length("record_set_digest") = 64 AND "record_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "rule_revision" INTEGER CHECK ("rule_revision" >= 1),
  "rule_digest" TEXT CHECK (length("rule_digest") = 64 AND "rule_digest" NOT GLOB '*[^0-9a-f]*'),
  "result_kind" TEXT CHECK ("result_kind" IN ('found', 'not_found')),
  "winning_perception_id" TEXT,
  "reason_code" TEXT CHECK ("reason_code" IN ('no_matching_record', 'requested_fact_absent', 'strongest_value_conflict')),
  "result_schema_ref" TEXT,
  "result_json" TEXT,
  "result_digest" TEXT CHECK (length("result_digest") = 64 AND "result_digest" NOT GLOB '*[^0-9a-f]*'),
  "resolved_at_ms" INTEGER CHECK ("resolved_at_ms" >= 0),
  UNIQUE ("query_contract", "query_input_digest", "revision", "resolution_id"),
  CHECK (json_valid("result_json")),
  CHECK (length(CAST("result_json" AS BLOB)) <= 16384),
  CHECK (("result_kind" = 'found' AND "winning_perception_id" IS NOT NULL AND "reason_code" IS NULL) OR ("result_kind" = 'not_found' AND "winning_perception_id" IS NULL AND "reason_code" IN ('no_matching_record', 'requested_fact_absent', 'strongest_value_conflict'))),
  FOREIGN KEY ("winning_perception_id") REFERENCES "perception_records" ("perception_id") ON DELETE RESTRICT
);

CREATE TABLE "perception_source_cursors" (
  "perception_source_id" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "perception_acquisition_id" TEXT,
  "cursor_in" TEXT,
  "cursor_out" TEXT,
  "observation_page_digest" TEXT CHECK (length("observation_page_digest") = 64 AND "observation_page_digest" NOT GLOB '*[^0-9a-f]*'),
  "has_more" INTEGER,
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  PRIMARY KEY ("perception_source_id", "revision"),
  FOREIGN KEY ("perception_source_id") REFERENCES "perception_sources" ("perception_source_id") ON DELETE RESTRICT,
  FOREIGN KEY ("perception_acquisition_id") REFERENCES "perception_acquisitions" ("perception_acquisition_id") ON DELETE RESTRICT
);

CREATE TABLE "perception_sources" (
  "perception_source_id" TEXT PRIMARY KEY,
  "source_kind" TEXT,
  "integration_id" TEXT,
  "status" TEXT CHECK ("status" IN ('active', 'disabled')),
  "config_revision" INTEGER CHECK ("config_revision" >= 1),
  "current_cursor_revision" INTEGER CHECK ("current_cursor_revision" >= 1),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "updated_at_ms" INTEGER CHECK ("updated_at_ms" >= 0),
  FOREIGN KEY ("perception_source_id", "current_cursor_revision") REFERENCES "perception_source_cursors" ("perception_source_id", "revision") ON DELETE RESTRICT
);
CREATE INDEX "idx_perception_sources_hot_01" ON "perception_sources" ("status", "source_kind", "perception_source_id");

CREATE TABLE "platform_admin_credentials" (
  "credential_id" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "secret_ref" TEXT,
  "state" TEXT CHECK ("state" IN ('active', 'rotated', 'revoked')),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "last_used_at_ms" INTEGER CHECK ("last_used_at_ms" >= 0),
  "terminal_at_ms" INTEGER CHECK ("terminal_at_ms" >= 0),
  PRIMARY KEY ("credential_id", "revision")
);

CREATE TABLE "platform_compute_device_probes" (
  "device_id" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "capability_schema_ref" TEXT,
  "capability_json" TEXT,
  "capability_digest" TEXT CHECK (length("capability_digest") = 64 AND "capability_digest" NOT GLOB '*[^0-9a-f]*'),
  "probe_result" TEXT,
  "probed_at_ms" INTEGER CHECK ("probed_at_ms" >= 0),
  PRIMARY KEY ("device_id", "revision"),
  CHECK (json_valid("capability_json")),
  CHECK (length(CAST("capability_json" AS BLOB)) <= 16384),
  FOREIGN KEY ("device_id") REFERENCES "platform_compute_devices" ("device_id") ON DELETE RESTRICT
);

CREATE TABLE "platform_compute_devices" (
  "device_id" TEXT PRIMARY KEY,
  "device_kind" TEXT,
  "stable_device_key" TEXT,
  "current_probe_revision" INTEGER CHECK ("current_probe_revision" >= 1),
  "enabled" INTEGER CHECK ("enabled" IN (0, 1)),
  "state" TEXT CHECK ("state" IN ('available', 'unavailable', 'disabled')),
  "updated_at_ms" INTEGER CHECK ("updated_at_ms" >= 0),
  UNIQUE ("stable_device_key"),
  FOREIGN KEY ("device_id", "current_probe_revision") REFERENCES "platform_compute_device_probes" ("device_id", "revision") ON DELETE RESTRICT
);
CREATE INDEX "idx_platform_compute_devices_hot_01" ON "platform_compute_devices" ("enabled", "state", "device_id");

CREATE TABLE "platform_integrations" (
  "integration_id" TEXT PRIMARY KEY,
  "integration_type" TEXT,
  "endpoint" TEXT,
  "config_revision" INTEGER CHECK ("config_revision" >= 1),
  "config_schema_ref" TEXT,
  "config_json" TEXT,
  "config_digest" TEXT CHECK (length("config_digest") = 64 AND "config_digest" NOT GLOB '*[^0-9a-f]*'),
  "state" TEXT CHECK ("state" IN ('active', 'disabled', 'faulted')),
  "updated_at_ms" INTEGER CHECK ("updated_at_ms" >= 0),
  UNIQUE ("integration_type", "integration_id"),
  CHECK (json_valid("config_json")),
  CHECK (length(CAST("config_json" AS BLOB)) <= 16384)
);

CREATE TABLE "platform_mount_scope_revisions" (
  "mount_scope_id" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "endpoint_id" TEXT,
  "mount_boundary" TEXT,
  "filesystem_type" TEXT,
  "stable_mount_fingerprint" TEXT,
  "inode_capability_digest" TEXT CHECK (length("inode_capability_digest") = 64 AND "inode_capability_digest" NOT GLOB '*[^0-9a-f]*'),
  "probe_evidence_digest" TEXT CHECK (length("probe_evidence_digest") = 64 AND "probe_evidence_digest" NOT GLOB '*[^0-9a-f]*'),
  "effective_at_ms" INTEGER CHECK ("effective_at_ms" >= 0),
  PRIMARY KEY ("mount_scope_id", "revision"),
  FOREIGN KEY ("mount_scope_id") REFERENCES "platform_mount_scopes" ("mount_scope_id") ON DELETE RESTRICT
);

CREATE TABLE "platform_mount_scopes" (
  "mount_scope_id" TEXT PRIMARY KEY,
  "status" TEXT CHECK ("status" IN ('active', 'disabled')),
  "current_revision" INTEGER CHECK ("current_revision" >= 1),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "terminal_at_ms" INTEGER CHECK ("terminal_at_ms" >= 0),
  FOREIGN KEY ("mount_scope_id", "current_revision") REFERENCES "platform_mount_scope_revisions" ("mount_scope_id", "revision") ON DELETE RESTRICT
);
CREATE INDEX "idx_platform_mount_scopes_hot_01" ON "platform_mount_scopes" ("status", "mount_scope_id");

CREATE TABLE "platform_resource_operating_policy" (
  "singleton_key" TEXT PRIMARY KEY,
  "current_revision" INTEGER CHECK ("current_revision" >= 1),
  "updated_at_ms" INTEGER CHECK ("updated_at_ms" >= 0),
  FOREIGN KEY ("singleton_key", "current_revision") REFERENCES "platform_resource_operating_revisions" ("singleton_key", "revision") ON DELETE RESTRICT
);

CREATE TABLE "platform_resource_operating_revisions" (
  "singleton_key" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "immediate_profile_key" TEXT,
  "timezone" TEXT,
  "schedule_schema_ref" TEXT,
  "schedule_json" TEXT,
  "schedule_digest" TEXT CHECK (length("schedule_digest") = 64 AND "schedule_digest" NOT GLOB '*[^0-9a-f]*'),
  "effective_at_ms" INTEGER CHECK ("effective_at_ms" >= 0),
  PRIMARY KEY ("singleton_key", "revision"),
  CHECK (json_valid("schedule_json")),
  CHECK (length(CAST("schedule_json" AS BLOB)) <= 16384)
);

CREATE TABLE "platform_resource_profile_revisions" (
  "profile_id" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "profile_schema_ref" TEXT,
  "profile_json" TEXT,
  "profile_digest" TEXT CHECK (length("profile_digest") = 64 AND "profile_digest" NOT GLOB '*[^0-9a-f]*'),
  "published_at_ms" INTEGER CHECK ("published_at_ms" >= 0),
  PRIMARY KEY ("profile_id", "revision"),
  CHECK (json_valid("profile_json")),
  CHECK (length(CAST("profile_json" AS BLOB)) <= 16384),
  FOREIGN KEY ("profile_id") REFERENCES "platform_resource_profiles" ("profile_id") ON DELETE RESTRICT
);

CREATE TABLE "platform_resource_profiles" (
  "profile_id" TEXT PRIMARY KEY,
  "profile_key" TEXT CHECK ("profile_key" IN ('default', 'full')),
  "name" TEXT,
  "current_revision" INTEGER CHECK ("current_revision" >= 1),
  "status" TEXT CHECK ("status" IN ('active', 'archived')),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "updated_at_ms" INTEGER CHECK ("updated_at_ms" >= 0),
  UNIQUE ("profile_key"),
  FOREIGN KEY ("profile_id", "current_revision") REFERENCES "platform_resource_profile_revisions" ("profile_id", "revision") ON DELETE RESTRICT
);

CREATE TABLE "platform_schema_marker" (
  "schema_name" TEXT PRIMARY KEY,
  "generation" TEXT,
  "schema_digest" TEXT CHECK (length("schema_digest") = 64 AND "schema_digest" NOT GLOB '*[^0-9a-f]*'),
  "catalog_digest" TEXT CHECK (length("catalog_digest") = 64 AND "catalog_digest" NOT GLOB '*[^0-9a-f]*'),
  "applied_at_ms" INTEGER CHECK ("applied_at_ms" >= 0)
);

CREATE TABLE "platform_secret_refs" (
  "secret_ref" TEXT PRIMARY KEY,
  "owner_scope_type" TEXT CHECK ("owner_scope_type" IN ('integration', 'worker', 'admin_credential')),
  "owner_scope_id" TEXT,
  "secret_kind" TEXT,
  "encrypted_ref" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "state" TEXT CHECK ("state" IN ('active', 'rotated', 'revoked')),
  "updated_at_ms" INTEGER CHECK ("updated_at_ms" >= 0),
  UNIQUE ("owner_scope_type", "owner_scope_id", "secret_kind", "revision")
);

CREATE TABLE "platform_worker_devices" (
  "worker_id" TEXT,
  "worker_revision" INTEGER CHECK ("worker_revision" >= 1),
  "device_key" TEXT,
  "capability_digest" TEXT CHECK (length("capability_digest") = 64 AND "capability_digest" NOT GLOB '*[^0-9a-f]*'),
  "enabled" INTEGER CHECK ("enabled" IN (0, 1)),
  "max_slots" INTEGER CHECK ("max_slots" >= 0),
  PRIMARY KEY ("worker_id", "worker_revision", "device_key"),
  FOREIGN KEY ("worker_id") REFERENCES "platform_workers" ("worker_id") ON DELETE RESTRICT
);

CREATE TABLE "platform_worker_revisions" (
  "worker_id" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "endpoint" TEXT,
  "protocol_version" TEXT,
  "config_schema_ref" TEXT,
  "config_json" TEXT,
  "config_digest" TEXT CHECK (length("config_digest") = 64 AND "config_digest" NOT GLOB '*[^0-9a-f]*'),
  "secret_ref" TEXT,
  "capability_digest" TEXT CHECK (length("capability_digest") = 64 AND "capability_digest" NOT GLOB '*[^0-9a-f]*'),
  "effective_at_ms" INTEGER CHECK ("effective_at_ms" >= 0),
  PRIMARY KEY ("worker_id", "revision"),
  CHECK (json_valid("config_json")),
  CHECK (length(CAST("config_json" AS BLOB)) <= 16384),
  FOREIGN KEY ("worker_id") REFERENCES "platform_workers" ("worker_id") ON DELETE RESTRICT
);

CREATE TABLE "platform_workers" (
  "worker_id" TEXT PRIMARY KEY,
  "name" TEXT,
  "status" TEXT CHECK ("status" IN ('active', 'offline', 'disabled')),
  "current_revision" INTEGER CHECK ("current_revision" >= 1),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "terminal_at_ms" INTEGER CHECK ("terminal_at_ms" >= 0),
  FOREIGN KEY ("worker_id", "current_revision") REFERENCES "platform_worker_revisions" ("worker_id", "revision") ON DELETE RESTRICT
);
CREATE INDEX "idx_platform_workers_hot_01" ON "platform_workers" ("status", "worker_id");

CREATE TABLE "platform_workspace_roots" (
  "root_id" TEXT PRIMARY KEY,
  "owner_scope" TEXT,
  "root_kind" TEXT,
  "resolved_root" TEXT,
  "config_revision" INTEGER CHECK ("config_revision" >= 1),
  "capability_digest" TEXT CHECK (length("capability_digest") = 64 AND "capability_digest" NOT GLOB '*[^0-9a-f]*'),
  "state" TEXT CHECK ("state" IN ('active', 'disabled', 'faulted')),
  "updated_at_ms" INTEGER CHECK ("updated_at_ms" >= 0)
);

CREATE TABLE "proc_candidate_deliveries" (
  "offer_id" TEXT PRIMARY KEY,
  "candidate_package_id" TEXT,
  "package_revision" INTEGER CHECK ("package_revision" >= 1),
  "package_digest" TEXT CHECK (length("package_digest") = 64 AND "package_digest" NOT GLOB '*[^0-9a-f]*'),
  "acceptance_basis_digest" TEXT CHECK (length("acceptance_basis_digest") = 64 AND "acceptance_basis_digest" NOT GLOB '*[^0-9a-f]*'),
  "state" TEXT CHECK ("state" IN ('open', 'accepted', 'rejected')),
  "handoff_decision_id" TEXT,
  "handoff_decision_digest" TEXT CHECK (length("handoff_decision_digest") = 64 AND "handoff_decision_digest" NOT GLOB '*[^0-9a-f]*'),
  "handoff_receipt_id" TEXT,
  "handoff_receipt_digest" TEXT CHECK (length("handoff_receipt_digest") = 64 AND "handoff_receipt_digest" NOT GLOB '*[^0-9a-f]*'),
  "terminal_evidence_digest" TEXT CHECK (length("terminal_evidence_digest") = 64 AND "terminal_evidence_digest" NOT GLOB '*[^0-9a-f]*'),
  "offered_at_ms" INTEGER CHECK ("offered_at_ms" >= 0),
  "closed_at_ms" INTEGER CHECK ("closed_at_ms" >= 0),
  UNIQUE ("candidate_package_id", "package_digest", "acceptance_basis_digest"),
  FOREIGN KEY ("candidate_package_id") REFERENCES "proc_candidate_packages" ("candidate_package_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_proc_candidate_deliveries_hot_01" ON "proc_candidate_deliveries" ("state", "offered_at_ms");
CREATE UNIQUE INDEX "uidx_proc_candidate_deliveries_partial_01" ON "proc_candidate_deliveries" ("candidate_package_id") WHERE "state" = 'open';

CREATE TABLE "proc_candidate_packages" (
  "candidate_package_id" TEXT PRIMARY KEY,
  "procurement_run_id" TEXT,
  "package_revision" INTEGER CHECK ("package_revision" >= 1),
  "field_id" TEXT,
  "field_access_revision" INTEGER CHECK ("field_access_revision" >= 1),
  "field_context_digest" TEXT CHECK (length("field_context_digest") = 64 AND "field_context_digest" NOT GLOB '*[^0-9a-f]*'),
  "media_type" TEXT CHECK ("media_type" IN ('single', 'group')),
  "content_profile" TEXT CHECK ("content_profile" IN ('movie', 'series', 'jav', 'western_adult')),
  "structure_kind" TEXT CHECK ("structure_kind" IN ('single', 'season')),
  "display_identity" TEXT,
  "identity_metadata_schema_ref" TEXT,
  "identity_metadata_json" TEXT,
  "identity_metadata_digest" TEXT CHECK (length("identity_metadata_digest") = 64 AND "identity_metadata_digest" NOT GLOB '*[^0-9a-f]*'),
  "identity_claim_schema_ref" TEXT,
  "identity_claim_json" TEXT,
  "identity_claim_digest" TEXT CHECK (length("identity_claim_digest") = 64 AND "identity_claim_digest" NOT GLOB '*[^0-9a-f]*'),
  "structure_evidence_id" TEXT,
  "structure_evidence_payload_digest" TEXT CHECK (length("structure_evidence_payload_digest") = 64 AND "structure_evidence_payload_digest" NOT GLOB '*[^0-9a-f]*'),
  "structure_unit_id" TEXT,
  "structure_unit_digest" TEXT CHECK (length("structure_unit_digest") = 64 AND "structure_unit_digest" NOT GLOB '*[^0-9a-f]*'),
  "triage_rule_ref" TEXT,
  "triage_rule_revision" INTEGER CHECK ("triage_rule_revision" >= 1),
  "triage_rule_authority_digest" TEXT CHECK (length("triage_rule_authority_digest") = 64 AND "triage_rule_authority_digest" NOT GLOB '*[^0-9a-f]*'),
  "primary_input_manifest_id" TEXT,
  "manifest_digest" TEXT CHECK (length("manifest_digest") = 64 AND "manifest_digest" NOT GLOB '*[^0-9a-f]*'),
  "related_reference_set_digest" TEXT CHECK (length("related_reference_set_digest") = 64 AND "related_reference_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "member_control_evidence_set_digest" TEXT CHECK (length("member_control_evidence_set_digest") = 64 AND "member_control_evidence_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "package_digest" TEXT CHECK (length("package_digest") = 64 AND "package_digest" NOT GLOB '*[^0-9a-f]*'),
  "state" TEXT CHECK ("state" IN ('published')),
  "published_at_ms" INTEGER CHECK ("published_at_ms" >= 0),
  UNIQUE ("procurement_run_id", "package_revision"),
  CHECK (json_valid("identity_metadata_json")),
  CHECK (length(CAST("identity_metadata_json" AS BLOB)) <= 16384),
  CHECK (json_valid("identity_claim_json")),
  CHECK (length(CAST("identity_claim_json" AS BLOB)) <= 16384),
  FOREIGN KEY ("procurement_run_id") REFERENCES "proc_procurement_runs" ("procurement_run_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_proc_candidate_packages_hot_01" ON "proc_candidate_packages" ("state", "published_at_ms");

CREATE TABLE "proc_candidate_primary_material_episode_claims" (
  "candidate_package_id" TEXT,
  "primary_ordinal" INTEGER CHECK ("primary_ordinal" >= 0),
  "episode_key" TEXT,
  "season_claim_digest" TEXT CHECK (length("season_claim_digest") = 64 AND "season_claim_digest" NOT GLOB '*[^0-9a-f]*'),
  "claim_digest" TEXT CHECK (length("claim_digest") = 64 AND "claim_digest" NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY ("candidate_package_id", "primary_ordinal", "episode_key"),
  FOREIGN KEY ("candidate_package_id", "primary_ordinal") REFERENCES "proc_candidate_primary_materials" ("candidate_package_id", "ordinal") ON DELETE RESTRICT
);

CREATE TABLE "proc_candidate_primary_materials" (
  "candidate_package_id" TEXT,
  "ordinal" INTEGER CHECK ("ordinal" >= 0),
  "material_key" TEXT,
  "role" TEXT CHECK ("role" IN ('primary_payload', 'structural_dependency')),
  "binding_revision" INTEGER CHECK ("binding_revision" >= 1),
  "admitted_control_revision" INTEGER CHECK ("admitted_control_revision" >= 1),
  "admitted_control_projection_digest" TEXT CHECK (length("admitted_control_projection_digest") = 64 AND "admitted_control_projection_digest" NOT GLOB '*[^0-9a-f]*'),
  "member_digest" TEXT CHECK (length("member_digest") = 64 AND "member_digest" NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY ("candidate_package_id", "ordinal"),
  UNIQUE ("candidate_package_id", "material_key"),
  FOREIGN KEY ("candidate_package_id") REFERENCES "proc_candidate_packages" ("candidate_package_id") ON DELETE RESTRICT
);

CREATE TABLE "proc_candidate_related_references" (
  "candidate_package_id" TEXT,
  "reference_id" TEXT,
  "primary_ordinal" INTEGER CHECK ("primary_ordinal" >= 0),
  "role" TEXT,
  "material_key" TEXT,
  "mount_scope_id" TEXT,
  "inode" TEXT,
  "content_hash_algorithm" TEXT,
  "content_hash" TEXT,
  "endpoint_id" TEXT,
  "location" TEXT,
  "checksum_algorithm" TEXT,
  "checksum_hex" TEXT,
  "association_evidence_digest" TEXT CHECK (length("association_evidence_digest") = 64 AND "association_evidence_digest" NOT GLOB '*[^0-9a-f]*'),
  "reference_digest" TEXT CHECK (length("reference_digest") = 64 AND "reference_digest" NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY ("candidate_package_id", "reference_id"),
  FOREIGN KEY ("candidate_package_id", "primary_ordinal") REFERENCES "proc_candidate_primary_materials" ("candidate_package_id", "ordinal") ON DELETE RESTRICT
);

CREATE TABLE "proc_candidate_season_continuity_claims" (
  "candidate_package_id" TEXT,
  "claim_kind" TEXT CHECK ("claim_kind" IN ('provider_season_identity', 'triage_grouping_lineage')),
  "claim_namespace" TEXT,
  "claim_key" TEXT,
  "claim_digest" TEXT CHECK (length("claim_digest") = 64 AND "claim_digest" NOT GLOB '*[^0-9a-f]*'),
  "evidence_digest" TEXT CHECK (length("evidence_digest") = 64 AND "evidence_digest" NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY ("candidate_package_id", "claim_kind", "claim_namespace", "claim_key"),
  FOREIGN KEY ("candidate_package_id") REFERENCES "proc_candidate_packages" ("candidate_package_id") ON DELETE RESTRICT
);

CREATE TABLE "proc_extraction_policy_revisions" (
  "extraction_policy_id" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "policy_schema_ref" TEXT,
  "policy_json" TEXT,
  "policy_digest" TEXT CHECK (length("policy_digest") = 64 AND "policy_digest" NOT GLOB '*[^0-9a-f]*'),
  "effective_at_ms" INTEGER CHECK ("effective_at_ms" >= 0),
  PRIMARY KEY ("extraction_policy_id", "revision"),
  CHECK (json_valid("policy_json")),
  CHECK (length(CAST("policy_json" AS BLOB)) <= 16384)
);

CREATE TABLE "proc_field_access_revisions" (
  "field_id" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "endpoint_id" TEXT,
  "root_location" TEXT,
  "mount_scope_id" TEXT,
  "mount_scope_revision" INTEGER CHECK ("mount_scope_revision" >= 1),
  "access_schema_ref" TEXT,
  "access_digest" TEXT CHECK (length("access_digest") = 64 AND "access_digest" NOT GLOB '*[^0-9a-f]*'),
  "effective_at_ms" INTEGER CHECK ("effective_at_ms" >= 0),
  PRIMARY KEY ("field_id", "revision"),
  FOREIGN KEY ("field_id") REFERENCES "proc_material_fields" ("field_id") ON DELETE RESTRICT
);

CREATE TABLE "proc_field_materials" (
  "field_id" TEXT,
  "material_key" TEXT,
  "mount_scope_id" TEXT,
  "inode" TEXT,
  "content_hash_algorithm" TEXT,
  "content_hash" TEXT,
  "endpoint_id" TEXT,
  "access_revision" INTEGER CHECK ("access_revision" >= 1),
  "mount_scope_revision" INTEGER CHECK ("mount_scope_revision" >= 1),
  "size_bytes" INTEGER CHECK ("size_bytes" >= 0),
  "mtime_ns" INTEGER CHECK ("mtime_ns" >= 0),
  "ctime_ns" INTEGER CHECK ("ctime_ns" >= 0),
  "hash_verified_at_ms" INTEGER CHECK ("hash_verified_at_ms" >= 0),
  "current_location" TEXT,
  "binding_revision" INTEGER CHECK ("binding_revision" >= 1),
  "reality_digest" TEXT CHECK (length("reality_digest") = 64 AND "reality_digest" NOT GLOB '*[^0-9a-f]*'),
  "provenance_digest" TEXT CHECK (length("provenance_digest") = 64 AND "provenance_digest" NOT GLOB '*[^0-9a-f]*'),
  "last_snapshot_digest" TEXT CHECK (length("last_snapshot_digest") = 64 AND "last_snapshot_digest" NOT GLOB '*[^0-9a-f]*'),
  "last_observation_id" TEXT,
  "eligibility_revision" INTEGER CHECK ("eligibility_revision" >= 1),
  "eligibility_state" TEXT CHECK ("eligibility_state" IN ('eligible', 'ineligible', 'unknown')),
  "eligibility_reason_code" TEXT,
  "eligibility_basis_digest" TEXT CHECK (length("eligibility_basis_digest") = 64 AND "eligibility_basis_digest" NOT GLOB '*[^0-9a-f]*'),
  "eligibility_field_status" TEXT CHECK ("eligibility_field_status" IN ('active', 'disabled')),
  "eligibility_observation_revision" INTEGER CHECK ("eligibility_observation_revision" >= 1),
  "eligibility_policy_revision" INTEGER CHECK ("eligibility_policy_revision" >= 1),
  "selection_basis_digest" TEXT CHECK (length("selection_basis_digest") = 64 AND "selection_basis_digest" NOT GLOB '*[^0-9a-f]*'),
  "control_projection" TEXT CHECK ("control_projection" IN ('unknown', 'uncontrolled', 'procurement', 'production', 'finished_goods')),
  "control_projection_revision" INTEGER CHECK ("control_projection_revision" >= 1),
  "control_projection_digest" TEXT CHECK (length("control_projection_digest") = 64 AND "control_projection_digest" NOT GLOB '*[^0-9a-f]*'),
  "eligibility_reconciled_at_ms" INTEGER CHECK ("eligibility_reconciled_at_ms" >= 0),
  PRIMARY KEY ("field_id", "material_key"),
  FOREIGN KEY ("field_id") REFERENCES "proc_material_fields" ("field_id") ON DELETE RESTRICT,
  FOREIGN KEY ("field_id", "last_observation_id") REFERENCES "proc_field_observations" ("field_id", "observation_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_proc_field_materials_hot_01" ON "proc_field_materials" ("field_id", "eligibility_state", "control_projection", "material_key");
CREATE INDEX "idx_proc_field_materials_hot_02" ON "proc_field_materials" ("field_id", "eligibility_observation_revision", "eligibility_policy_revision", "material_key");

CREATE TABLE "proc_field_observations" (
  "field_id" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "observation_id" TEXT,
  "field_observation_work_id" TEXT,
  "access_revision" INTEGER CHECK ("access_revision" >= 1),
  "page_ordinal" INTEGER CHECK ("page_ordinal" >= 0),
  "expected_revision" INTEGER CHECK ("expected_revision" >= 0),
  "cursor_in" TEXT,
  "cursor_out" TEXT,
  "page_digest" TEXT CHECK (length("page_digest") = 64 AND "page_digest" NOT GLOB '*[^0-9a-f]*'),
  "fact_digest" TEXT CHECK (length("fact_digest") = 64 AND "fact_digest" NOT GLOB '*[^0-9a-f]*'),
  "commit_marker" TEXT,
  "result_digest" TEXT CHECK (length("result_digest") = 64 AND "result_digest" NOT GLOB '*[^0-9a-f]*'),
  "observed_at_ms" INTEGER CHECK ("observed_at_ms" >= 0),
  "completed" INTEGER CHECK ("completed" IN (0, 1)),
  PRIMARY KEY ("field_id", "revision"),
  UNIQUE ("observation_id"),
  UNIQUE ("field_id", "observation_id"),
  UNIQUE ("field_observation_work_id", "page_ordinal"),
  UNIQUE ("commit_marker"),
  FOREIGN KEY ("field_id") REFERENCES "proc_material_fields" ("field_id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY ("field_observation_work_id") REFERENCES "fx_supporting_works" ("work_id") ON DELETE RESTRICT,
  FOREIGN KEY ("field_id", "access_revision") REFERENCES "proc_field_access_revisions" ("field_id", "revision") ON DELETE RESTRICT,
  FOREIGN KEY ("commit_marker") REFERENCES "fx_commit_markers" ("commit_marker") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX "idx_proc_field_observations_hot_01" ON "proc_field_observations" ("field_id", "completed", "observed_at_ms");

CREATE TABLE "proc_material_fields" (
  "field_id" TEXT PRIMARY KEY,
  "name" TEXT,
  "status" TEXT CHECK ("status" IN ('active', 'deregistered')),
  "extraction_policy_id" TEXT,
  "extraction_policy_revision" INTEGER CHECK ("extraction_policy_revision" >= 1),
  "current_access_revision" INTEGER CHECK ("current_access_revision" >= 1),
  "current_observation_revision" INTEGER CHECK ("current_observation_revision" >= 1),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "updated_at_ms" INTEGER CHECK ("updated_at_ms" >= 0),
  FOREIGN KEY ("field_id", "current_access_revision") REFERENCES "proc_field_access_revisions" ("field_id", "revision") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY ("field_id", "current_observation_revision") REFERENCES "proc_field_observations" ("field_id", "revision") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX "idx_proc_material_fields_hot_01" ON "proc_material_fields" ("status", "field_id");

CREATE TABLE "proc_procurement_retry_intent_materials" (
  "retry_intent_id" TEXT,
  "ordinal" INTEGER CHECK ("ordinal" >= 0),
  "material_key" TEXT,
  "failed_run_material_digest" TEXT CHECK (length("failed_run_material_digest") = 64 AND "failed_run_material_digest" NOT GLOB '*[^0-9a-f]*'),
  "expected_binding_revision" INTEGER CHECK ("expected_binding_revision" >= 1),
  "expected_eligibility_revision" INTEGER CHECK ("expected_eligibility_revision" >= 1),
  "expected_eligibility_basis_digest" TEXT CHECK (length("expected_eligibility_basis_digest") = 64 AND "expected_eligibility_basis_digest" NOT GLOB '*[^0-9a-f]*'),
  "expected_selection_basis_digest" TEXT CHECK (length("expected_selection_basis_digest") = 64 AND "expected_selection_basis_digest" NOT GLOB '*[^0-9a-f]*'),
  "expected_selection_has_conflict" TEXT,
  "expected_control_revision" INTEGER CHECK ("expected_control_revision" >= 0),
  "expected_control_state" TEXT CHECK ("expected_control_state" IN ('uncontrolled', 'controlled')),
  "expected_control_owner_domain" TEXT,
  "expected_control_owner_scope_type" TEXT,
  "expected_control_owner_scope_id" TEXT,
  "expected_control_region_projection" TEXT,
  "expected_control_evidence_digest" TEXT CHECK (length("expected_control_evidence_digest") = 64 AND "expected_control_evidence_digest" NOT GLOB '*[^0-9a-f]*'),
  "expected_control_projection_digest" TEXT CHECK (length("expected_control_projection_digest") = 64 AND "expected_control_projection_digest" NOT GLOB '*[^0-9a-f]*'),
  "member_precondition_digest" TEXT CHECK (length("member_precondition_digest") = 64 AND "member_precondition_digest" NOT GLOB '*[^0-9a-f]*'),
  "consume_snapshot_schema_ref" TEXT,
  "consume_snapshot_json" TEXT,
  "consume_snapshot_digest" TEXT CHECK (length("consume_snapshot_digest") = 64 AND "consume_snapshot_digest" NOT GLOB '*[^0-9a-f]*'),
  "consume_outcome" TEXT CHECK ("consume_outcome" IN ('matched', 'stale')),
  "consume_stale_reason_code" TEXT,
  "consumed_at_ms" INTEGER CHECK ("consumed_at_ms" >= 0),
  PRIMARY KEY ("retry_intent_id", "ordinal"),
  UNIQUE ("retry_intent_id", "material_key"),
  CHECK (json_valid("consume_snapshot_json")),
  CHECK (length(CAST("consume_snapshot_json" AS BLOB)) <= 4096),
  FOREIGN KEY ("retry_intent_id") REFERENCES "proc_procurement_retry_intents" ("retry_intent_id") ON DELETE RESTRICT
);

CREATE TABLE "proc_procurement_retry_intents" (
  "retry_intent_id" TEXT PRIMARY KEY,
  "field_id" TEXT,
  "failed_run_id" TEXT,
  "failed_basis_digest" TEXT CHECK (length("failed_basis_digest") = 64 AND "failed_basis_digest" NOT GLOB '*[^0-9a-f]*'),
  "retry_field_status" TEXT CHECK ("retry_field_status" IN ('active')),
  "retry_access_revision" INTEGER CHECK ("retry_access_revision" >= 1),
  "retry_access_digest" TEXT CHECK (length("retry_access_digest") = 64 AND "retry_access_digest" NOT GLOB '*[^0-9a-f]*'),
  "retry_terminal_observation_revision" INTEGER CHECK ("retry_terminal_observation_revision" >= 1),
  "retry_field_observation_work_id" TEXT,
  "retry_extraction_policy_id" TEXT,
  "retry_extraction_policy_revision" INTEGER CHECK ("retry_extraction_policy_revision" >= 1),
  "retry_extraction_policy_digest" TEXT CHECK (length("retry_extraction_policy_digest") = 64 AND "retry_extraction_policy_digest" NOT GLOB '*[^0-9a-f]*'),
  "retry_triage_rule_ref" TEXT,
  "retry_triage_rule_revision" INTEGER CHECK ("retry_triage_rule_revision" >= 1),
  "retry_triage_rule_schema_ref" TEXT,
  "retry_triage_rule_digest" TEXT CHECK (length("retry_triage_rule_digest") = 64 AND "retry_triage_rule_digest" NOT GLOB '*[^0-9a-f]*'),
  "retry_triage_rule_authority_digest" TEXT CHECK (length("retry_triage_rule_authority_digest") = 64 AND "retry_triage_rule_authority_digest" NOT GLOB '*[^0-9a-f]*'),
  "retry_admission_head_digest" TEXT CHECK (length("retry_admission_head_digest") = 64 AND "retry_admission_head_digest" NOT GLOB '*[^0-9a-f]*'),
  "retry_scope_digest" TEXT CHECK (length("retry_scope_digest") = 64 AND "retry_scope_digest" NOT GLOB '*[^0-9a-f]*'),
  "retry_member_count" INTEGER CHECK ("retry_member_count" >= 0),
  "precondition_set_digest" TEXT CHECK (length("precondition_set_digest") = 64 AND "precondition_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "actor_id" TEXT,
  "idempotency_key" TEXT,
  "intent_digest" TEXT CHECK (length("intent_digest") = 64 AND "intent_digest" NOT GLOB '*[^0-9a-f]*'),
  "state" TEXT CHECK ("state" IN ('open', 'consumed', 'stale')),
  "state_revision" INTEGER CHECK ("state_revision" >= 1),
  "new_run_id" TEXT,
  "primary_stale_reason_code" TEXT,
  "consume_admission_head_schema_ref" TEXT,
  "consume_admission_head_json" TEXT,
  "consume_admission_head_digest" TEXT CHECK (length("consume_admission_head_digest") = 64 AND "consume_admission_head_digest" NOT GLOB '*[^0-9a-f]*'),
  "create_commit_marker" TEXT,
  "create_result_digest" TEXT CHECK (length("create_result_digest") = 64 AND "create_result_digest" NOT GLOB '*[^0-9a-f]*'),
  "consume_commit_marker" TEXT,
  "consume_result_digest" TEXT CHECK (length("consume_result_digest") = 64 AND "consume_result_digest" NOT GLOB '*[^0-9a-f]*'),
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "consumed_at_ms" INTEGER CHECK ("consumed_at_ms" >= 0),
  UNIQUE ("field_id", "idempotency_key"),
  CHECK (json_valid("consume_admission_head_json")),
  CHECK (length(CAST("consume_admission_head_json" AS BLOB)) <= 16384),
  FOREIGN KEY ("failed_run_id") REFERENCES "proc_procurement_runs" ("procurement_run_id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY ("field_id", "retry_access_revision") REFERENCES "proc_field_access_revisions" ("field_id", "revision") ON DELETE RESTRICT,
  FOREIGN KEY ("field_id", "retry_terminal_observation_revision") REFERENCES "proc_field_observations" ("field_id", "revision") ON DELETE RESTRICT,
  FOREIGN KEY ("retry_extraction_policy_id", "retry_extraction_policy_revision") REFERENCES "proc_extraction_policy_revisions" ("extraction_policy_id", "revision") ON DELETE RESTRICT,
  FOREIGN KEY ("new_run_id") REFERENCES "proc_procurement_runs" ("procurement_run_id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY ("create_commit_marker") REFERENCES "fx_commit_markers" ("commit_marker") ON DELETE RESTRICT,
  FOREIGN KEY ("consume_commit_marker") REFERENCES "fx_commit_markers" ("commit_marker") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "uidx_proc_procurement_retry_intents_partial_01" ON "proc_procurement_retry_intents" ("failed_run_id", "failed_basis_digest") WHERE "state" IN ('open', 'consumed');

CREATE TABLE "proc_procurement_runs" (
  "procurement_run_id" TEXT PRIMARY KEY,
  "field_id" TEXT,
  "run_basis_schema_ref" TEXT,
  "access_revision" INTEGER CHECK ("access_revision" >= 1),
  "access_digest" TEXT CHECK (length("access_digest") = 64 AND "access_digest" NOT GLOB '*[^0-9a-f]*'),
  "terminal_observation_revision" INTEGER CHECK ("terminal_observation_revision" >= 1),
  "field_observation_work_id" TEXT,
  "extraction_policy_id" TEXT,
  "extraction_policy_revision" INTEGER CHECK ("extraction_policy_revision" >= 1),
  "extraction_policy_digest" TEXT CHECK (length("extraction_policy_digest") = 64 AND "extraction_policy_digest" NOT GLOB '*[^0-9a-f]*'),
  "triage_rule_ref" TEXT,
  "triage_rule_revision" INTEGER CHECK ("triage_rule_revision" >= 1),
  "triage_rule_schema_ref" TEXT,
  "triage_rule_digest" TEXT CHECK (length("triage_rule_digest") = 64 AND "triage_rule_digest" NOT GLOB '*[^0-9a-f]*'),
  "triage_rule_authority_digest" TEXT CHECK (length("triage_rule_authority_digest") = 64 AND "triage_rule_authority_digest" NOT GLOB '*[^0-9a-f]*'),
  "run_basis_digest" TEXT CHECK (length("run_basis_digest") = 64 AND "run_basis_digest" NOT GLOB '*[^0-9a-f]*'),
  "retry_intent_id" TEXT,
  "state" TEXT CHECK ("state" IN ('active', 'waiting', 'sealed')),
  "state_revision" INTEGER CHECK ("state_revision" >= 1),
  "candidate_package_revision_head" TEXT,
  "seal_outcome" TEXT,
  "seal_decision_id" TEXT,
  "seal_decision_digest" TEXT CHECK (length("seal_decision_digest") = 64 AND "seal_decision_digest" NOT GLOB '*[^0-9a-f]*'),
  "seal_evidence_digest" TEXT CHECK (length("seal_evidence_digest") = 64 AND "seal_evidence_digest" NOT GLOB '*[^0-9a-f]*'),
  "admission_commit_marker" TEXT,
  "admission_result_digest" TEXT CHECK (length("admission_result_digest") = 64 AND "admission_result_digest" NOT GLOB '*[^0-9a-f]*'),
  "seal_commit_marker" TEXT,
  "seal_result_digest" TEXT CHECK (length("seal_result_digest") = 64 AND "seal_result_digest" NOT GLOB '*[^0-9a-f]*'),
  "priority_class" TEXT,
  "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
  "finished_at_ms" INTEGER CHECK ("finished_at_ms" >= 0),
  UNIQUE ("field_id", "run_basis_digest"),
  FOREIGN KEY ("field_id", "access_revision") REFERENCES "proc_field_access_revisions" ("field_id", "revision") ON DELETE RESTRICT,
  FOREIGN KEY ("field_id", "terminal_observation_revision") REFERENCES "proc_field_observations" ("field_id", "revision") ON DELETE RESTRICT,
  FOREIGN KEY ("extraction_policy_id", "extraction_policy_revision") REFERENCES "proc_extraction_policy_revisions" ("extraction_policy_id", "revision") ON DELETE RESTRICT,
  FOREIGN KEY ("admission_commit_marker") REFERENCES "fx_commit_markers" ("commit_marker") ON DELETE RESTRICT,
  FOREIGN KEY ("seal_commit_marker") REFERENCES "fx_commit_markers" ("commit_marker") ON DELETE RESTRICT,
  FOREIGN KEY ("retry_intent_id") REFERENCES "proc_procurement_retry_intents" ("retry_intent_id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX "idx_proc_procurement_runs_hot_01" ON "proc_procurement_runs" ("state", "priority_class", "created_at_ms");
CREATE UNIQUE INDEX "uidx_proc_procurement_runs_partial_01" ON "proc_procurement_runs" ("seal_decision_id") WHERE "seal_decision_id" IS NOT NULL;
CREATE UNIQUE INDEX "uidx_proc_procurement_runs_partial_02" ON "proc_procurement_runs" ("retry_intent_id") WHERE "retry_intent_id" IS NOT NULL;

CREATE TABLE "proc_run_materials" (
  "procurement_run_id" TEXT,
  "ordinal" INTEGER CHECK ("ordinal" >= 0),
  "material_key" TEXT,
  "selection_role" TEXT,
  "binding_revision" INTEGER CHECK ("binding_revision" >= 1),
  "eligibility_revision" INTEGER CHECK ("eligibility_revision" >= 1),
  "eligibility_basis_digest" TEXT CHECK (length("eligibility_basis_digest") = 64 AND "eligibility_basis_digest" NOT GLOB '*[^0-9a-f]*'),
  "last_snapshot_digest" TEXT CHECK (length("last_snapshot_digest") = 64 AND "last_snapshot_digest" NOT GLOB '*[^0-9a-f]*'),
  "last_observation_id" TEXT,
  "endpoint_id" TEXT,
  "location" TEXT,
  "reality_digest" TEXT CHECK (length("reality_digest") = 64 AND "reality_digest" NOT GLOB '*[^0-9a-f]*'),
  "provenance_digest" TEXT CHECK (length("provenance_digest") = 64 AND "provenance_digest" NOT GLOB '*[^0-9a-f]*'),
  "expected_control_revision" INTEGER CHECK ("expected_control_revision" >= 0),
  "expected_control_state" TEXT CHECK ("expected_control_state" IN ('uncontrolled', 'controlled')),
  "expected_control_owner_domain" TEXT,
  "expected_control_owner_scope_type" TEXT,
  "expected_control_owner_scope_id" TEXT,
  "expected_control_region_projection" TEXT,
  "expected_control_evidence_digest" TEXT CHECK (length("expected_control_evidence_digest") = 64 AND "expected_control_evidence_digest" NOT GLOB '*[^0-9a-f]*'),
  "expected_control_projection_digest" TEXT CHECK (length("expected_control_projection_digest") = 64 AND "expected_control_projection_digest" NOT GLOB '*[^0-9a-f]*'),
  "admission_control_action" TEXT CHECK ("admission_control_action" IN ('acquire', 'assert_same_field')),
  "admitted_control_revision" INTEGER CHECK ("admitted_control_revision" >= 1),
  "admitted_control_projection_digest" TEXT CHECK (length("admitted_control_projection_digest") = 64 AND "admitted_control_projection_digest" NOT GLOB '*[^0-9a-f]*'),
  "basis_member_digest" TEXT CHECK (length("basis_member_digest") = 64 AND "basis_member_digest" NOT GLOB '*[^0-9a-f]*'),
  "selection_state" TEXT CHECK ("selection_state" IN ('run_selection', 'candidate_delivery', 'released', 'transferred')),
  "candidate_package_id" TEXT,
  "terminal_disposition" TEXT CHECK ("terminal_disposition" IN ('completed_without_candidate', 'triage_failed', 'handoff_accepted', 'handoff_rejected')),
  "terminal_evidence_digest" TEXT CHECK (length("terminal_evidence_digest") = 64 AND "terminal_evidence_digest" NOT GLOB '*[^0-9a-f]*'),
  "selected_at_ms" INTEGER CHECK ("selected_at_ms" >= 0),
  "reservation_updated_at_ms" INTEGER CHECK ("reservation_updated_at_ms" >= 0),
  PRIMARY KEY ("procurement_run_id", "ordinal"),
  UNIQUE ("procurement_run_id", "material_key"),
  FOREIGN KEY ("procurement_run_id") REFERENCES "proc_procurement_runs" ("procurement_run_id") ON DELETE RESTRICT,
  FOREIGN KEY ("candidate_package_id") REFERENCES "proc_candidate_packages" ("candidate_package_id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "uidx_proc_run_materials_partial_01" ON "proc_run_materials" ("material_key") WHERE "selection_state" IN ('run_selection', 'candidate_delivery');
