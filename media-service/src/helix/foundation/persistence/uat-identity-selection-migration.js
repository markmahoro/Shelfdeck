'use strict';

const { digest } = require('./ddl-compiler');

const SOURCE_GENERATION = 'helix-clean-v1';
const INTERMEDIATE_GENERATION = 'helix-clean-v2';
const TARGET_GENERATION = 'helix-clean-v3';
const SOURCE_SCHEMA_DIGEST = '78075366b3409916b8f8c6fcd3c0786daa5e45bab82f59ba83d91a2663689119';
const INTERMEDIATE_SCHEMA_DIGEST = 'fee80cf21719481a83274c3b9021918571ed8e5a510239b1d82995758a4cbcd4';
const PRE_EXECUTOR_CLOSURE_SCHEMA_DIGEST = '998b673af4d2f0a6ed4f96bcb7f34c56b8dad3ffc562f40a69a335b948a7cab0';
const PRE_AFTERCARE_HARDENING_SCHEMA_DIGEST = '2347c196743124bbb2e768c7b829012049310484b7cd4e49a00182c9d45f09d5';
const PRE_DEFECT_ADMISSION_SCHEMA_DIGEST = '6172e70c94c31091005b19b4eefaf7567b195d04dc9cb3b4bee7099a070383f3';
const PRE_PREDECK_PIPELINE_SCHEMA_DIGEST = '411b6c0e2f350d3f5a9374738f56d51a0304df2772c813f2b3009e6526daa889';
const PRE_FORMATION_THREE_STATE_SCHEMA_DIGEST = '3be2dad9b3615053681dfc2721974657fc3995ccf60a044e17dfb5131f0f8199';
const PRE_CASE_ADMISSION_SCHEMA_DIGEST = '6a2246c39bebcd1f6f80264bac793c7a3119636a791683e426e4c30aa6fdc651';
const PRE_SOURCE_CLEANUP_SCHEMA_DIGEST = '642c62d6d55e95ce31a097435ae7052c26d0ea5b65d049d90c724522db204784';
const PRE_TARGET_BINDING_SCHEMA_DIGEST = '3ce7180fe6b3ba843b2b85669dca5dd852792f979770c908ef2b17560d473d49';
const PRE_OFFDECK_COVERAGE_SCHEMA_DIGEST = '42281705d35e3aa6d5103525544ce7d9a199bd2660c93e2faf2729d333475066';
const PRE_TERMINAL_OUTCOME_SCHEMA_DIGEST = 'b8cbd25e773b61e1e9ecfe1b8aecb079f4c97eae02f38c117b4d4e8a08427821';
const PRE_SECONDARY_TARGET_SCHEMA_DIGEST = '854c22240e01915f777958ec490bf1ebad6dcc4a92f4bd6f2f032d32ac2d1312';
const PRE_SERIES_FACT_KEY_SCHEMA_DIGEST = '218993d8f7574475a22f26b85b96de4f57ebee913ac5893c47a6255d3fb15431';
const PRE_SERIES_PROVENANCE_SCHEMA_DIGEST = '14c18e017bfce8b78230d0509be1c46fb11c0da95a240396628173a9e71bed73';
const PRE_TARGET_RESERVATION_SCHEMA_DIGEST = '46893c3ce29b664d4eb5af009108756ec5ba19851b082f32e1af0d13157f3beb';
const PRE_ARTIFACT_SCOPE_SCHEMA_DIGEST = 'f1016a2c9f4a314554c7a9863a487e4874ec77f93e6010c51fbb281b4204c2cb';
const PRE_OFFLOAD_TARGETS_SCHEMA_DIGEST = 'efa5340869a40216e3b2750293cbcb65fa3c7bc1c6950eb01eaf012b9f496a90';
const PRE_EPISODE_METADATA_SCHEMA_DIGEST = '800afbadcc429b86aa8812cb6eea480ef4ccfa89be2213d7688c060aaa4b075a';
const PRE_ACCEPTANCE_EVIDENCE_SCHEMA_DIGEST = '09d5991de1bca441bd02e9fe72b73de88090a06eb76471873c62964d9f4a0403';
const TARGET_SCHEMA_DIGEST = 'bf79c16fe2032f54eddb5189b20673c9ecd29178917488e53a8f64eba9c858f7';

// Frozen additive DDL for the exact UAT-251 schema target.
const TERMINAL_OUTCOME_DDL = `CREATE TABLE "arca_defect_admission_heads" (
  "shelf_entry_id" TEXT PRIMARY KEY,
  "current_revision" INTEGER CHECK ("current_revision" >= 1),
  "updated_at_ms" INTEGER CHECK ("updated_at_ms" >= 0),
  FOREIGN KEY ("shelf_entry_id", "current_revision") REFERENCES "arca_defect_admissions" ("shelf_entry_id", "revision") ON DELETE RESTRICT
);

CREATE TABLE "arca_defect_admissions" (
  "shelf_entry_id" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "inventory_revision" INTEGER CHECK ("inventory_revision" >= 1),
  "care_basis_digest" TEXT CHECK (length("care_basis_digest") = 64 AND "care_basis_digest" NOT GLOB '*[^0-9a-f]*'),
  "gap_set_digest" TEXT CHECK (length("gap_set_digest") = 64 AND "gap_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "authorization_schema_ref" TEXT,
  "authorization_json" TEXT,
  "authorization_digest" TEXT CHECK (length("authorization_digest") = 64 AND "authorization_digest" NOT GLOB '*[^0-9a-f]*'),
  "actor_id" TEXT,
  "idempotency_key" TEXT,
  "decided_at_ms" INTEGER CHECK ("decided_at_ms" >= 0),
  PRIMARY KEY ("shelf_entry_id", "revision"),
  UNIQUE ("shelf_entry_id", "actor_id", "idempotency_key"),
  CHECK (json_valid("authorization_json")),
  CHECK (length(CAST("authorization_json" AS BLOB)) <= 65536),
  FOREIGN KEY ("shelf_entry_id") REFERENCES "arca_shelf_entries" ("shelf_entry_id") ON DELETE RESTRICT
);

CREATE TABLE "arca_defect_repair_intents" (
  "intent_id" TEXT PRIMARY KEY,
  "shelf_entry_id" TEXT,
  "inventory_revision" INTEGER CHECK ("inventory_revision" >= 1),
  "care_basis_digest" TEXT CHECK (length("care_basis_digest") = 64 AND "care_basis_digest" NOT GLOB '*[^0-9a-f]*'),
  "gap_set_digest" TEXT CHECK (length("gap_set_digest") = 64 AND "gap_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "authorization_revision" INTEGER CHECK ("authorization_revision" >= 1),
  "aftercare_case_id" TEXT,
  "actor_id" TEXT,
  "idempotency_key" TEXT,
  "intent_digest" TEXT CHECK (length("intent_digest") = 64 AND "intent_digest" NOT GLOB '*[^0-9a-f]*'),
  "issued_at_ms" INTEGER CHECK ("issued_at_ms" >= 0),
  UNIQUE ("shelf_entry_id", "actor_id", "idempotency_key"),
  UNIQUE ("aftercare_case_id"),
  FOREIGN KEY ("shelf_entry_id") REFERENCES "arca_shelf_entries" ("shelf_entry_id") ON DELETE RESTRICT,
  FOREIGN KEY ("aftercare_case_id") REFERENCES "arca_aftercare_cases" ("aftercare_case_id") ON DELETE RESTRICT
);

CREATE TABLE "libra_defect_authorization_head" (
  "singleton_key" TEXT PRIMARY KEY,
  "current_authorization_id" TEXT,
  "current_revision" INTEGER CHECK ("current_revision" >= 1),
  "updated_at_ms" INTEGER CHECK ("updated_at_ms" >= 0),
  FOREIGN KEY ("current_authorization_id", "current_revision") REFERENCES "libra_defect_authorizations" ("authorization_id", "revision") ON DELETE RESTRICT
);

CREATE TABLE "libra_defect_authorizations" (
  "authorization_id" TEXT,
  "revision" INTEGER CHECK ("revision" >= 1),
  "state" TEXT CHECK ("state" IN ('enabled', 'revoked')),
  "actor_id" TEXT,
  "authorization_digest" TEXT CHECK (length("authorization_digest") = 64 AND "authorization_digest" NOT GLOB '*[^0-9a-f]*'),
  "effective_at_ms" INTEGER CHECK ("effective_at_ms" >= 0),
  "revoked_at_ms" INTEGER CHECK ("revoked_at_ms" >= 0),
  PRIMARY KEY ("authorization_id", "revision")
);

CREATE TABLE "libra_reprocess_intents" (
  "intent_id" TEXT PRIMARY KEY,
  "stable_input_digest" TEXT CHECK (length("stable_input_digest") = 64 AND "stable_input_digest" NOT GLOB '*[^0-9a-f]*'),
  "previous_outcome_digest" TEXT CHECK (length("previous_outcome_digest") = 64 AND "previous_outcome_digest" NOT GLOB '*[^0-9a-f]*'),
  "actor_id" TEXT,
  "idempotency_key" TEXT,
  "intent_digest" TEXT CHECK (length("intent_digest") = 64 AND "intent_digest" NOT GLOB '*[^0-9a-f]*'),
  "issued_at_ms" INTEGER CHECK ("issued_at_ms" >= 0),
  UNIQUE ("actor_id", "idempotency_key")
);

CREATE INDEX "idx_libra_reprocess_intents_hot_01" ON "libra_reprocess_intents" ("stable_input_digest", "issued_at_ms");

CREATE TABLE "libra_run_outcomes" (
  "libra_run_id" TEXT PRIMARY KEY,
  "subject_id" TEXT,
  "outcome" TEXT CHECK ("outcome" IN ('on_deck', 'on_deck_with_defects', 'unable_to_on_deck')),
  "reason_code" TEXT,
  "stable_input_digest" TEXT CHECK (length("stable_input_digest") = 64 AND "stable_input_digest" NOT GLOB '*[^0-9a-f]*'),
  "requirements_digest" TEXT CHECK (length("requirements_digest") = 64 AND "requirements_digest" NOT GLOB '*[^0-9a-f]*'),
  "conditions_digest" TEXT CHECK (length("conditions_digest") = 64 AND "conditions_digest" NOT GLOB '*[^0-9a-f]*'),
  "outcome_schema_ref" TEXT,
  "outcome_json" TEXT,
  "outcome_digest" TEXT CHECK (length("outcome_digest") = 64 AND "outcome_digest" NOT GLOB '*[^0-9a-f]*'),
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  CHECK (json_valid("outcome_json")),
  CHECK (length(CAST("outcome_json" AS BLOB)) <= 65536),
  FOREIGN KEY ("libra_run_id") REFERENCES "libra_runs" ("libra_run_id") ON DELETE RESTRICT,
  FOREIGN KEY ("subject_id") REFERENCES "libra_subjects" ("subject_id") ON DELETE RESTRICT
);

CREATE INDEX "idx_libra_run_outcomes_hot_01" ON "libra_run_outcomes" ("subject_id", "committed_at_ms");

CREATE INDEX "idx_libra_run_outcomes_hot_02" ON "libra_run_outcomes" ("stable_input_digest", "requirements_digest", "conditions_digest");

CREATE TABLE "libra_strategy_availability" (
  "libra_run_id" TEXT,
  "strategy_kind" TEXT CHECK ("strategy_kind" IN ('moviepilot', 'tmdb')),
  "condition_digest" TEXT CHECK (length("condition_digest") = 64 AND "condition_digest" NOT GLOB '*[^0-9a-f]*'),
  "check_ordinal" INTEGER CHECK ("check_ordinal" IN ('0', '1', '2', '3', '4', '5')) CHECK ("check_ordinal" >= 0),
  "evidence_schema_ref" TEXT,
  "evidence_json" TEXT,
  "evidence_digest" TEXT CHECK (length("evidence_digest") = 64 AND "evidence_digest" NOT GLOB '*[^0-9a-f]*'),
  "checked_at_ms" INTEGER CHECK ("checked_at_ms" >= 0),
  PRIMARY KEY ("libra_run_id", "strategy_kind", "condition_digest", "check_ordinal"),
  CHECK (json_valid("evidence_json")),
  CHECK (length(CAST("evidence_json" AS BLOB)) <= 4096),
  FOREIGN KEY ("libra_run_id") REFERENCES "libra_runs" ("libra_run_id") ON DELETE RESTRICT
);`;

function addTerminalOutcomeTables(database) {
  database.exec(TERMINAL_OUTCOME_DDL);
}
const PRE_UAT_EXECUTION_CATALOG_DIGEST = 'b0371a6d2793c1e381a4c2e7fc421d312a1a1e90d2de5e47f61a45022f09793b';
const PRE_PROJECTION_EXECUTION_CATALOG_DIGEST = '13315cdbdf6ab5cbe30b32075f89bd76ae1a873d84034dc572824f4fbc3886e6';
const INTAKE_BINDING_REPLAN_CODE = 'P4_UAT_INTAKE_BINDING_RESULT_REPLAN_REQUIRED';
const PRE_PROJECTION_PLAN_REPLAN_CODE = 'P4_UAT_PRE_PROJECTION_PLAN_REPLAN_REQUIRED';
const FORMATION_PROJECTION_DDL = `CREATE TABLE "libra_formation_projections" (
  "subject_id" TEXT PRIMARY KEY,
  "projection_revision" INTEGER CHECK ("projection_revision" >= 1),
  "classification" TEXT CHECK ("classification" IN ('in_progress', 'attention_required', 'completed')),
  "attention_state" TEXT CHECK ("attention_state" IN ('none', 'attention_required', 'blocked', 'suspended', 'frozen')),
  "attention_priority" INTEGER,
  "display_identity" TEXT,
  "content_profile" TEXT,
  "structure_kind" TEXT,
  "subject_status" TEXT CHECK ("subject_status" IN ('active', 'abandoned', 'completed')),
  "my_rating" INTEGER,
  "my_rating_source" TEXT,
  "my_rating_revision" INTEGER CHECK ("my_rating_revision" >= 1),
  "target_shelf_id" TEXT,
  "target_shelf_name" TEXT,
  "routing_state" TEXT CHECK ("routing_state" IN ('preparing', 'unresolved', 'resolved')),
  "unresolved_reason_code" TEXT,
  "routing_policy_mode" TEXT,
  "routing_policy_revision" INTEGER CHECK ("routing_policy_revision" >= 1),
  "routing_decision_revision" INTEGER CHECK ("routing_decision_revision" >= 1),
  "routing_decision_digest" TEXT CHECK (length("routing_decision_digest") = 64 AND "routing_decision_digest" NOT GLOB '*[^0-9a-f]*'),
  "routing_decision_head_revision" INTEGER CHECK ("routing_decision_head_revision" >= 1),
  "routing_decision_head_digest" TEXT CHECK (length("routing_decision_head_digest") = 64 AND "routing_decision_head_digest" NOT GLOB '*[^0-9a-f]*'),
  "primary_material_count" INTEGER CHECK ("primary_material_count" >= 0),
  "organizing_requirement" TEXT,
  "organizing_action" TEXT,
  "added_at_ms" INTEGER CHECK ("added_at_ms" >= 0),
  "next_action_label" TEXT,
  "next_action_state" TEXT CHECK ("next_action_state" IN ('admitted', 'pending', 'ready', 'running', 'waiting_for_resource', 'waiting_for_external', 'waiting_for_approval', 'executing', 'succeeded', 'skipped', 'failed', 'cancelled', 'completed', 'attention_required', 'blocked', 'suspended', 'frozen')),
  "progress_mode" TEXT CHECK ("progress_mode" IN ('determinate', 'indeterminate')),
  "progress_current_value" NUMERIC,
  "progress_total_value" NUMERIC,
  "progress_unit" TEXT,
  "progress_rate" REAL,
  "progress_eta_ms" INTEGER CHECK ("progress_eta_ms" >= 0),
  "progress_bucket" TEXT,
  "identity_issue_schema_ref" TEXT,
  "identity_issue_json" TEXT,
  "identity_issue_digest" TEXT CHECK (length("identity_issue_digest") = 64 AND "identity_issue_digest" NOT GLOB '*[^0-9a-f]*'),
  "current_acceptance_spec_id" TEXT,
  "current_acceptance_spec_revision" INTEGER CHECK ("current_acceptance_spec_revision" >= 1),
  "current_acceptance_spec_digest" TEXT CHECK (length("current_acceptance_spec_digest") = 64 AND "current_acceptance_spec_digest" NOT GLOB '*[^0-9a-f]*'),
  "current_libra_run_id" TEXT,
  "current_libra_run_state" TEXT CHECK ("current_libra_run_state" IN ('active', 'suspended', 'superseded', 'frozen', 'discarded', 'completed')),
  "current_libra_run_state_revision" INTEGER CHECK ("current_libra_run_state_revision" >= 1),
  "current_libra_run_state_digest" TEXT CHECK (length("current_libra_run_state_digest") = 64 AND "current_libra_run_state_digest" NOT GLOB '*[^0-9a-f]*'),
  "current_priority_class" TEXT,
  "current_identity_revision" INTEGER CHECK ("current_identity_revision" >= 1),
  "current_package_id" TEXT,
  "current_package_revision" INTEGER CHECK ("current_package_revision" >= 1),
  "current_package_digest" TEXT CHECK (length("current_package_digest") = 64 AND "current_package_digest" NOT GLOB '*[^0-9a-f]*'),
  "current_offer_id" TEXT,
  "completed_at_ms" INTEGER CHECK ("completed_at_ms" >= 0),
  "basis_digest" TEXT CHECK (length("basis_digest") = 64 AND "basis_digest" NOT GLOB '*[^0-9a-f]*'),
  "projection_digest" TEXT CHECK (length("projection_digest") = 64 AND "projection_digest" NOT GLOB '*[^0-9a-f]*'),
  "updated_at_ms" INTEGER CHECK ("updated_at_ms" >= 0),
  CHECK ("identity_issue_json" IS NULL OR json_valid("identity_issue_json")),
  CHECK ("identity_issue_json" IS NULL OR length(CAST("identity_issue_json" AS BLOB)) <= 16384),
  FOREIGN KEY ("subject_id") REFERENCES "libra_subjects" ("subject_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_libra_formation_projections_hot_01" ON "libra_formation_projections" ("attention_priority", "classification", "updated_at_ms", "subject_id");
CREATE INDEX "idx_libra_formation_projections_hot_02" ON "libra_formation_projections" ("classification", "completed_at_ms", "subject_id");
CREATE INDEX "idx_libra_formation_projections_hot_03" ON "libra_formation_projections" ("classification", "subject_id");`;

const EXECUTOR_CLOSURE_DDL = `CREATE TABLE "arca_acceptance_recovery_cases" (
  "offer_id" TEXT PRIMARY KEY, "on_deck_package_id" TEXT,
  "package_digest" TEXT CHECK (length("package_digest") = 64 AND "package_digest" NOT GLOB '*[^0-9a-f]*'),
  "acceptance_attempt_id" TEXT, "active_work_id" TEXT, "work_kind" TEXT, "failure_phase" TEXT, "error_code" TEXT,
  "terminal_attempt_count" INTEGER CHECK ("terminal_attempt_count" >= 0), "owner_domain" TEXT,
  "recovery_state" TEXT CHECK ("recovery_state" IN ('active', 'attention_required', 'automatic_recovering', 'user_retrying', 'resolved')),
  "recovery_generation" TEXT, "automatic_recovery_used" TEXT,
  "recovery_trigger_digest" TEXT CHECK (length("recovery_trigger_digest") = 64 AND "recovery_trigger_digest" NOT GLOB '*[^0-9a-f]*'),
  "failed_trigger_digest" TEXT CHECK (length("failed_trigger_digest") = 64 AND "failed_trigger_digest" NOT GLOB '*[^0-9a-f]*'),
  "incident_key" TEXT, "updated_at_ms" INTEGER CHECK ("updated_at_ms" >= 0),
  "resolved_at_ms" INTEGER CHECK ("resolved_at_ms" >= 0)
);
CREATE INDEX "idx_arca_acceptance_recovery_cases_hot_01" ON "arca_acceptance_recovery_cases" ("recovery_state", "updated_at_ms");
CREATE TABLE "fx_executor_incidents" (
  "incident_key" TEXT PRIMARY KEY, "owner_domain" TEXT, "process_type" TEXT, "work_kind" TEXT, "error_code" TEXT,
  "occurrence_count" INTEGER CHECK ("occurrence_count" >= 0), "circuit_key" TEXT,
  "incident_state" TEXT CHECK ("incident_state" IN ('open', 'recovering', 'resolved')),
  "evidence_digest" TEXT CHECK (length("evidence_digest") = 64 AND "evidence_digest" NOT GLOB '*[^0-9a-f]*'),
  "first_seen_at_ms" INTEGER CHECK ("first_seen_at_ms" >= 0),
  "last_seen_at_ms" INTEGER CHECK ("last_seen_at_ms" >= 0),
  "resolved_at_ms" INTEGER CHECK ("resolved_at_ms" >= 0)
);
CREATE INDEX "idx_fx_executor_incidents_hot_01" ON "fx_executor_incidents" ("incident_state", "last_seen_at_ms");`;

class UatIdentitySelectionMigrationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'UatIdentitySelectionMigrationError';
    this.code = code;
    this.details = details;
  }
}

function catalogRows(database) {
  return database.prepare(
    "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
  ).all().map((row) => ({ ...row, sql: row.sql && row.sql.replaceAll('\r\n', '\n') }));
}

function ensureAftercareCaseTerminalEvidence(database) {
  const present=new Set(database.prepare('PRAGMA table_info("arca_aftercare_cases")').all().map((row)=>row.name));
  const required=['case_generation','trigger_digest','terminal_reason_code','terminal_evidence_digest'];
  if(required.every((name)=>present.has(name)))return false;
  if(!present.has('case_generation'))database.exec('ALTER TABLE "arca_aftercare_cases" ADD COLUMN "case_generation" INTEGER');
  if(!present.has('trigger_digest'))database.exec('ALTER TABLE "arca_aftercare_cases" ADD COLUMN "trigger_digest" TEXT');
  if(!present.has('terminal_reason_code'))database.exec('ALTER TABLE "arca_aftercare_cases" ADD COLUMN "terminal_reason_code" TEXT');
  if(!present.has('terminal_evidence_digest'))database.exec('ALTER TABLE "arca_aftercare_cases" ADD COLUMN "terminal_evidence_digest" TEXT');
  const rows=database.prepare(`SELECT aftercare_case_id,shelf_entry_id,care_basis_digest,finding_set_digest,
    care_requirement_digest,state,case_generation,trigger_digest,terminal_reason_code,terminal_evidence_digest
    FROM arca_aftercare_cases ORDER BY shelf_entry_id,care_basis_digest,finding_set_digest,care_requirement_digest,created_at_ms,aftercare_case_id`).all();
  const generations=new Map(),update=database.prepare(`UPDATE arca_aftercare_cases SET case_generation=?,trigger_digest=?,
    terminal_reason_code=?,terminal_evidence_digest=? WHERE aftercare_case_id=?`);
  for(const row of rows){const group=[row.shelf_entry_id,row.care_basis_digest,row.finding_set_digest,row.care_requirement_digest].join('\u0000'),
      generation=Number.isSafeInteger(Number(row.case_generation))&&Number(row.case_generation)>0?Number(row.case_generation):(generations.get(group)||0)+1,
      triggerDigest=row.trigger_digest||digest({schema:'arca.aftercare-case-legacy-trigger@1',aftercareCaseId:row.aftercare_case_id}),
      terminal=row.state!=='active',reasonCode=terminal?(row.terminal_reason_code||'legacy_'+row.state):null,
      evidenceDigest=terminal?(row.terminal_evidence_digest||digest({schema:'arca.aftercare-case-legacy-terminal-evidence@1',
        aftercareCaseId:row.aftercare_case_id,state:row.state,reasonCode})):null;
    generations.set(group,Math.max(generations.get(group)||0,generation));
    update.run(generation,triggerDigest,reasonCode,evidenceDigest,row.aftercare_case_id);
  }
  database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "uidx_arca_aftercare_cases_generation"
    ON "arca_aftercare_cases" ("shelf_entry_id","care_basis_digest","finding_set_digest","care_requirement_digest","case_generation");
    CREATE UNIQUE INDEX IF NOT EXISTS "uidx_arca_aftercare_cases_trigger"
    ON "arca_aftercare_cases" ("shelf_entry_id","trigger_digest");`);
  return true;
}

function retirePreCorrectionIntakeBindingAttempts(database, appliedAtMs) {
  const rows = database.prepare(`
    SELECT e.event_id,e.plan_id,e.work_id,e.attempt_id,ea.event_attempt_id
      FROM fx_workflow_events e
      JOIN fx_workflow_plans p ON p.plan_id=e.plan_id
      JOIN fx_plan_nodes n ON n.plan_id=e.plan_id AND n.node_id=e.node_id
      JOIN fx_supporting_works w ON w.work_id=e.work_id
      JOIN fx_work_attempts wa ON wa.attempt_id=e.attempt_id AND wa.work_id=e.work_id
      JOIN fx_event_attempts ea ON ea.event_id=e.event_id
     WHERE p.catalog_digest=?
       AND w.owner_domain='libra' AND w.process_type='libra_intake' AND w.work_kind='acceptance' AND w.state='running'
       AND wa.state='running'
       AND e.capability_ref='libra.intake.binding.resolve@1' AND e.state='executing'
       AND n.capability_ref=e.capability_ref AND n.contract_version=1 AND n.effect_class='pure_observation'
       AND ea.state='executing'
       AND NOT EXISTS (SELECT 1 FROM fx_event_result_bindings r WHERE r.event_id=e.event_id)
     ORDER BY e.event_id
  `).all(PRE_UAT_EXECUTION_CATALOG_DIGEST);
  for (const row of rows) {
    const evidenceDigest = digest({
      schema:'helix.uat-intake-binding-replan-evidence@1',
      eventId:row.event_id,eventAttemptId:row.event_attempt_id,
      sourceCatalogDigest:PRE_UAT_EXECUTION_CATALOG_DIGEST,failureCode:INTAKE_BINDING_REPLAN_CODE,
    });
    const attempt = database.prepare(`UPDATE fx_event_attempts
      SET state='completed',outcome_kind='failed',retry_after_ms=NULL,failure_class='contract_upgrade',
          failure_code=?,evidence_digest=?,finished_at_ms=?
      WHERE event_attempt_id=? AND event_id=? AND state='executing'`)
      .run(INTAKE_BINDING_REPLAN_CODE,evidenceDigest,appliedAtMs,row.event_attempt_id,row.event_id);
    const event = database.prepare(`UPDATE fx_workflow_events
      SET state='failed',retry_at_ms=NULL,result_id=NULL
      WHERE event_id=? AND plan_id=? AND state='executing'`)
      .run(row.event_id,row.plan_id);
    database.prepare(`UPDATE fx_resource_defer SET state='cancelled'
      WHERE state='waiting' AND event_id IN (SELECT event_id FROM fx_workflow_events WHERE plan_id=? AND event_id<>?)`)
      .run(row.plan_id,row.event_id);
    database.prepare(`UPDATE fx_workflow_events SET state='cancelled',retry_at_ms=NULL,result_id=NULL
      WHERE plan_id=? AND event_id<>? AND state IN ('pending','ready','waiting_for_resource','waiting_for_external','waiting_for_approval')`)
      .run(row.plan_id,row.event_id);
    const workAttempt = database.prepare(`UPDATE fx_work_attempts
      SET state='failed',finished_at_ms=?,failure_code=?
      WHERE attempt_id=? AND work_id=? AND state='running'`)
      .run(appliedAtMs,INTAKE_BINDING_REPLAN_CODE,row.attempt_id,row.work_id);
    if (attempt.changes !== 1 || event.changes !== 1 || workAttempt.changes !== 1) {
      throw new UatIdentitySelectionMigrationError('UAT_INTAKE_BINDING_REPLAN_CAS_FAILED',
        'The exact pre-correction Intake Binding responsibility changed during upgrade.', { eventId:row.event_id });
    }
  }
  return rows.length;
}

function retirePreProjectionExecutionWorks(database, appliedAtMs) {
  const rows = database.prepare(`
    SELECT w.work_id,w.owner_domain,w.process_type,w.process_id,w.work_kind,
           wa.attempt_id,p.plan_id
      FROM fx_supporting_works w
      JOIN fx_work_attempts wa ON wa.work_id=w.work_id AND wa.state='running'
      JOIN fx_workflow_plans p ON p.attempt_id=wa.attempt_id
     WHERE w.state='running' AND p.catalog_digest=?
     ORDER BY w.work_id,wa.attempt_id
  `).all(PRE_PROJECTION_EXECUTION_CATALOG_DIGEST);
  let retiredEvents = 0;
  let retiredExecutingEvents = 0;
  for (const row of rows) {
    const effects = database.prepare(`
      SELECT ej.effect_id,ej.state
        FROM fx_effect_journal ej
        JOIN fx_event_attempts ea ON ea.event_attempt_id=ej.event_attempt_id
        JOIN fx_workflow_events e ON e.event_id=ea.event_id
       WHERE e.plan_id=?
    `).all(row.plan_id);
    if (effects.length > 0) {
      throw new UatIdentitySelectionMigrationError('UAT_PRE_PROJECTION_EFFECT_PRESENT',
        'A pre-projection active Plan owns an Effect Journal row and cannot be retired automatically.', {
          workId:row.work_id,attemptId:row.attempt_id,planId:row.plan_id,
          effectIds:effects.map((effect)=>effect.effect_id),
        });
    }

    const events = database.prepare(`
      SELECT event_id,state
        FROM fx_workflow_events
       WHERE plan_id=?
       ORDER BY event_id
    `).all(row.plan_id);
    const activeEvents = events.filter((event) =>
      ['pending','ready','waiting_for_resource','waiting_for_external','waiting_for_approval','executing'].includes(event.state));
    const failureCode = PRE_PROJECTION_PLAN_REPLAN_CODE;
    for (const event of activeEvents) {
      if (event.state === 'executing') {
        const executingAttempts = database.prepare(`
          SELECT event_attempt_id
            FROM fx_event_attempts
           WHERE event_id=? AND state='executing'
           ORDER BY event_attempt_id
        `).all(event.event_id);
        if (executingAttempts.length !== 1) {
          throw new UatIdentitySelectionMigrationError('UAT_PRE_PROJECTION_EXECUTING_ATTEMPT_INVALID',
            'A pre-projection executing Event does not own exactly one executing Event Attempt.', {
              workId:row.work_id,attemptId:row.attempt_id,planId:row.plan_id,eventId:event.event_id,
              executingAttemptCount:executingAttempts.length,
            });
        }
        const eventAttemptId = executingAttempts[0].event_attempt_id;
        const evidenceDigest = digest({
          schema:'helix.uat-pre-projection-plan-retirement-evidence@1',
          catalogDigest:PRE_PROJECTION_EXECUTION_CATALOG_DIGEST,
          workId:row.work_id,attemptId:row.attempt_id,planId:row.plan_id,eventId:event.event_id,eventAttemptId,
          failureCode,
        });
        const attempt = database.prepare(`UPDATE fx_event_attempts
          SET state='completed',outcome_kind='failed',retry_after_ms=NULL,failure_class='contract_upgrade',
              failure_code=?,evidence_digest=?,finished_at_ms=?
          WHERE event_attempt_id=? AND event_id=? AND state='executing'`)
          .run(failureCode,evidenceDigest,appliedAtMs,eventAttemptId,event.event_id);
        const eventUpdate = database.prepare(`UPDATE fx_workflow_events
          SET state='failed',retry_at_ms=NULL,result_id=NULL
          WHERE event_id=? AND plan_id=? AND state='executing'`)
          .run(event.event_id,row.plan_id);
        if (attempt.changes !== 1 || eventUpdate.changes !== 1) {
          throw new UatIdentitySelectionMigrationError('UAT_PRE_PROJECTION_EVENT_RETIREMENT_CAS_FAILED',
            'The pre-projection executing Event changed during retirement.', { workId:row.work_id,eventId:event.event_id });
        }
        retiredExecutingEvents += 1;
      } else {
        database.prepare(`UPDATE fx_resource_defer SET state='cancelled'
          WHERE event_id=? AND state='waiting'`).run(event.event_id);
        const eventUpdate = database.prepare(`UPDATE fx_workflow_events
          SET state='cancelled',retry_at_ms=NULL,result_id=NULL
          WHERE event_id=? AND plan_id=? AND state IN ('pending','ready','waiting_for_resource','waiting_for_external','waiting_for_approval')`)
          .run(event.event_id,row.plan_id);
        if (eventUpdate.changes !== 1) {
          throw new UatIdentitySelectionMigrationError('UAT_PRE_PROJECTION_EVENT_RETIREMENT_CAS_FAILED',
            'The pre-projection waiting Event changed during retirement.', { workId:row.work_id,eventId:event.event_id });
        }
      }
      retiredEvents += 1;
    }

    const workAttempt = database.prepare(`UPDATE fx_work_attempts
      SET state='failed',finished_at_ms=?,failure_code=?
      WHERE attempt_id=? AND work_id=? AND state='running'`)
      .run(appliedAtMs,failureCode,row.attempt_id,row.work_id);
    if (workAttempt.changes !== 1) {
      throw new UatIdentitySelectionMigrationError('UAT_PRE_PROJECTION_WORK_RETIREMENT_CAS_FAILED',
        'The pre-projection Work Attempt changed during retirement.', { workId:row.work_id,attemptId:row.attempt_id });
    }
  }
  return Object.freeze({
    retiredPreProjectionWorks:rows.length,
    retiredPreProjectionEvents:retiredEvents,
    retiredPreProjectionExecutingEvents:retiredExecutingEvents,
  });
}

function migrateDefectAdmissionRevisionKind(database) {
  database.exec(`ALTER TABLE "libra_run_revisions" RENAME TO "libra_run_revisions_pre_defect_admission";
CREATE TABLE "libra_run_revisions" (
  "libra_run_id" TEXT,
  "state_revision" INTEGER CHECK ("state_revision" >= 1),
  "state" TEXT CHECK ("state" IN ('active', 'suspended', 'superseded', 'frozen', 'discarded', 'completed')),
  "acceptance_spec_id" TEXT,
  "execution_basis_digest" TEXT CHECK (length("execution_basis_digest") = 64 AND "execution_basis_digest" NOT GLOB '*[^0-9a-f]*'),
  "run_scope_digest" TEXT CHECK (length("run_scope_digest") = 64 AND "run_scope_digest" NOT GLOB '*[^0-9a-f]*'),
  "priority_class" TEXT,
  "priority_intent_digest" TEXT CHECK (length("priority_intent_digest") = 64 AND "priority_intent_digest" NOT GLOB '*[^0-9a-f]*'),
  "transition_kind" TEXT CHECK ("transition_kind" IN ('admitted', 'freshness_confirmed', 'suspended', 'recovery_reassessed', 'resumed', 'reprioritized', 'superseded', 'frozen', 'defect_admitted', 'discarded', 'completed')),
  "transition_decision_id" TEXT,
  "transition_decision_digest" TEXT CHECK (length("transition_decision_digest") = 64 AND "transition_decision_digest" NOT GLOB '*[^0-9a-f]*'),
  "transition_evidence_schema_ref" TEXT,
  "transition_evidence_id" TEXT,
  "transition_evidence_json" TEXT,
  "transition_evidence_digest" TEXT CHECK (length("transition_evidence_digest") = 64 AND "transition_evidence_digest" NOT GLOB '*[^0-9a-f]*'),
  "recovery_policy_ref" TEXT,
  "recovery_policy_digest" TEXT CHECK (length("recovery_policy_digest") = 64 AND "recovery_policy_digest" NOT GLOB '*[^0-9a-f]*'),
  "suspension_started_at_ms" INTEGER CHECK ("suspension_started_at_ms" >= 0),
  "recovery_attempt_ordinal" INTEGER CHECK ("recovery_attempt_ordinal" >= 0),
  "recovery_next_due_at_ms" INTEGER CHECK ("recovery_next_due_at_ms" >= 0),
  "expected_admission_head_revision" INTEGER NOT NULL CHECK ("expected_admission_head_revision" >= 0),
  "expected_active_scope_set_digest" TEXT CHECK (length("expected_active_scope_set_digest") = 64 AND "expected_active_scope_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "committed_admission_head_revision" INTEGER CHECK ("committed_admission_head_revision" >= 1),
  "committed_active_scope_set_digest" TEXT CHECK (length("committed_active_scope_set_digest") = 64 AND "committed_active_scope_set_digest" NOT GLOB '*[^0-9a-f]*'),
  "previous_state_revision" INTEGER CHECK ("previous_state_revision" >= 1),
  "revision_digest" TEXT CHECK (length("revision_digest") = 64 AND "revision_digest" NOT GLOB '*[^0-9a-f]*'),
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  PRIMARY KEY ("libra_run_id", "state_revision"),
  CHECK (json_valid("transition_evidence_json")),
  CHECK (length(CAST("transition_evidence_json" AS BLOB)) <= 1048576),
  FOREIGN KEY ("libra_run_id") REFERENCES "libra_runs" ("libra_run_id") ON DELETE RESTRICT,
  FOREIGN KEY ("acceptance_spec_id") REFERENCES "libra_acceptance_specs" ("acceptance_spec_id") ON DELETE RESTRICT
);
INSERT INTO "libra_run_revisions" SELECT * FROM "libra_run_revisions_pre_defect_admission";
DROP TABLE "libra_run_revisions_pre_defect_admission";`);
}

const PREDECK_PIPELINE_DDL = `CREATE TABLE IF NOT EXISTS "libra_field_intake_admission_policies" (
  "field_id" TEXT PRIMARY KEY,
  "predeck_pipeline_seats" INTEGER,
  "policy_revision" INTEGER CHECK ("policy_revision" >= 1),
  "updated_at_ms" INTEGER CHECK ("updated_at_ms" >= 0)
);
CREATE TABLE IF NOT EXISTS "libra_predeck_pipeline_tokens" (
  "subject_id" TEXT PRIMARY KEY,
  "source_field_id" TEXT,
  "source_process_id" TEXT,
  "acquired_at_ms" INTEGER CHECK ("acquired_at_ms" >= 0)
);
CREATE INDEX IF NOT EXISTS "idx_libra_predeck_pipeline_tokens_hot_01"
  ON "libra_predeck_pipeline_tokens" ("source_field_id", "subject_id");`;

function migratePredeckPipelineTables(database) {
  database.exec(PREDECK_PIPELINE_DDL);
}

function migrateFormationThreeStateProjection(database) {
  database.exec('DROP TABLE "libra_formation_projections";');
  database.exec(FORMATION_PROJECTION_DDL);
}

function migrateShelfTargetBindings(database) {
  if(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='arca_shelf_target_bindings'").get())return;
  // Do not invent historical targets; future Shelf mutations capture their exact prior head.
  database.exec("CREATE TABLE \"arca_shelf_target_bindings\" (\n  \"target_binding_id\" TEXT PRIMARY KEY,\n  \"shelf_id\" TEXT,\n  \"endpoint_id\" TEXT,\n  \"root_location\" TEXT,\n  \"mount_scope_id\" TEXT,\n  \"mount_scope_revision\" INTEGER CHECK (\"mount_scope_revision\" >= 1),\n  \"binding_digest\" TEXT CHECK (length(\"binding_digest\") = 64 AND \"binding_digest\" NOT GLOB '*[^0-9a-f]*'),\n  \"captured_at_ms\" INTEGER CHECK (\"captured_at_ms\" >= 0),\n  UNIQUE (\"shelf_id\", \"binding_digest\"),\n  FOREIGN KEY (\"shelf_id\") REFERENCES \"arca_shelves\" (\"shelf_id\") ON DELETE RESTRICT\n);\nCREATE INDEX \"idx_arca_shelf_target_bindings_hot_01\" ON \"arca_shelf_target_bindings\" (\"shelf_id\", \"endpoint_id\", \"mount_scope_id\");");
}

function migrateSourceCleanupTable(database) {
  if(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='arca_source_cleanup_checks'").get())return;
  // Only create the empty responsibility table. Historical Entries are never backfilled.
  database.exec("CREATE TABLE \"arca_source_cleanup_checks\" (\n  \"cleanup_id\" TEXT PRIMARY KEY,\n  \"on_deck_run_id\" TEXT,\n  \"shelf_entry_id\" TEXT,\n  \"state\" TEXT CHECK (\"state\" IN ('pending', 'attention', 'completed')),\n  \"check_revision\" INTEGER CHECK (\"check_revision\" >= 1),\n  \"checks_schema_ref\" TEXT,\n  \"checks_json\" TEXT,\n  \"created_at_ms\" INTEGER CHECK (\"created_at_ms\" >= 0),\n  \"updated_at_ms\" INTEGER CHECK (\"updated_at_ms\" >= 0),\n  \"next_check_at_ms\" INTEGER CHECK (\"next_check_at_ms\" >= 0),\n  UNIQUE (\"on_deck_run_id\"),\n  CHECK (json_valid(\"checks_json\")),\n  CHECK (length(CAST(\"checks_json\" AS BLOB)) <= 65536),\n  FOREIGN KEY (\"on_deck_run_id\") REFERENCES \"arca_ondeck_runs\" (\"on_deck_run_id\") ON DELETE RESTRICT,\n  FOREIGN KEY (\"shelf_entry_id\") REFERENCES \"arca_shelf_entries\" (\"shelf_entry_id\") ON DELETE RESTRICT\n);\nCREATE INDEX \"idx_arca_source_cleanup_checks_hot_01\" ON \"arca_source_cleanup_checks\" (\"next_check_at_ms\", \"on_deck_run_id\");");
}

function migrateRecycleTable(database) {
  if(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='arca_recycle_entries'").get())return;
  database.exec("CREATE TABLE \"arca_recycle_entries\" (\n  \"recycle_entry_id\" TEXT PRIMARY KEY,\n  \"shelf_entry_id\" TEXT,\n  \"source_location\" TEXT,\n  \"archive_location\" TEXT,\n  \"manifest_schema_ref\" TEXT,\n  \"manifest_json\" TEXT,\n  \"manifest_digest\" TEXT CHECK (length(\"manifest_digest\") = 64 AND \"manifest_digest\" NOT GLOB '*[^0-9a-f]*'),\n  \"reason_code\" TEXT,\n  \"state\" TEXT CHECK (\"state\" IN ('pending', 'moving', 'archived', 'restoring', 'restored', 'purging', 'purged')),\n  \"operation_revision\" INTEGER CHECK (\"operation_revision\" >= 1),\n  \"created_at_ms\" INTEGER CHECK (\"created_at_ms\" >= 0),\n  \"archived_at_ms\" INTEGER CHECK (\"archived_at_ms\" >= 0),\n  \"expires_at_ms\" INTEGER CHECK (\"expires_at_ms\" >= 0),\n  \"updated_at_ms\" INTEGER CHECK (\"updated_at_ms\" >= 0),\n  \"last_error\" TEXT,\n  CHECK (json_valid(\"manifest_json\")),\n  CHECK (length(CAST(\"manifest_json\" AS BLOB)) <= 65536),\n  FOREIGN KEY (\"shelf_entry_id\") REFERENCES \"arca_shelf_entries\" (\"shelf_entry_id\") ON DELETE RESTRICT\n);\nCREATE INDEX \"idx_arca_recycle_entries_hot_01\" ON \"arca_recycle_entries\" (\"state\", \"expires_at_ms\");");
}

function migrateAftercareCaseAdmission(database) {
  const table = database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='arca_aftercare_cases'").get();
  if (table?.sql.includes("'queued', 'active', 'resolved', 'invalidated', 'unresolved'")) return;
  const oldStates = "'active', 'resolved', 'invalidated', 'unresolved'";
  if (!table || !table.sql.includes(oldStates)) {
    throw new UatIdentitySelectionMigrationError('UAT_MIGRATION_CASE_SCHEMA_UNSUPPORTED',
      'The Aftercare Case state constraint does not match the approved source.');
  }
  const indexes = database.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='arca_aftercare_cases' AND sql IS NOT NULL").all();
  database.exec('CREATE TEMP TABLE case_admission_backup AS SELECT * FROM arca_aftercare_cases');
  database.exec('DROP TABLE arca_aftercare_cases');
  database.exec(table.sql.replace(oldStates, "'queued', " + oldStates));
  database.exec('INSERT INTO arca_aftercare_cases SELECT * FROM case_admission_backup');
  for (const index of indexes) database.exec(index.sql);
  database.exec('DROP TABLE temp.case_admission_backup');
}

function addSecondaryTargetRevision(database) {
  const row=database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='libra_run_revisions'").get();
  if(row.sql.includes("'secondary_target'"))return;
  const indexes=database.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='libra_run_revisions' AND sql IS NOT NULL").all();
  database.exec('CREATE TEMP TABLE secondary_revision_backup AS SELECT * FROM libra_run_revisions');
  database.exec('DROP TABLE libra_run_revisions');
  database.exec(row.sql.replace("'frozen', 'defect_admitted'","'frozen', 'secondary_target', 'defect_admitted'"));
  database.exec('INSERT INTO libra_run_revisions SELECT * FROM secondary_revision_backup');
  for(const index of indexes)database.exec(index.sql);
  database.exec('DROP TABLE temp.secondary_revision_backup');
}

// Change only the byte CHECK on immutable Package evidence. Preserve every row,
// incoming foreign key and index; this does not resume or translate Formation entries.
function expandProductionProvenanceBound(database) {
  const row=database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='libra_product_packages'").get();
  const before='length(CAST("production_provenance_json" AS BLOB)) <= 65536';
  const after='length(CAST("production_provenance_json" AS BLOB)) <= 1048576';
  if(row?.sql.includes(after)) return;
  if(!row?.sql.includes(before)) throw new UatIdentitySelectionMigrationError('SERIES_PROVENANCE_SCHEMA_DRIFT','Package evidence byte constraint is not the exact prior contract.');
  const indexes=database.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='libra_product_packages' AND sql IS NOT NULL").all();
  database.exec('CREATE TEMP TABLE series_package_backup AS SELECT * FROM libra_product_packages');
  database.exec('DROP TABLE libra_product_packages');
  database.exec(row.sql.replace(before,after));
  database.exec('INSERT INTO libra_product_packages SELECT * FROM series_package_backup');
  for(const index of indexes) database.exec(index.sql);
  database.exec('DROP TABLE temp.series_package_backup');
}

// Preserve accepted immutable snapshots while allowing distinct Packages at the same Fact revision.
function extendSeriesFactKey(database) {
  const row=database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='arca_inventory_product_facts'").get();
  const before='PRIMARY KEY ("shelf_entry_id", "inventory_revision", "fact_kind", "fact_revision")';
  const after='PRIMARY KEY ("shelf_entry_id", "inventory_revision", "source_package_id", "fact_kind", "fact_revision")';
  if(row?.sql.includes(after))return;
  if(!row?.sql.includes(before))throw new UatIdentitySelectionMigrationError('SERIES_FACT_KEY_SCHEMA_DRIFT','Inventory Fact key is not the exact prior contract.');
  const indexes=database.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='arca_inventory_product_facts' AND sql IS NOT NULL").all();
  database.exec('CREATE TEMP TABLE series_fact_backup AS SELECT * FROM arca_inventory_product_facts');
  database.exec('DROP TABLE arca_inventory_product_facts');
  database.exec(row.sql.replace(before,after));
  database.exec('INSERT INTO arca_inventory_product_facts SELECT * FROM series_fact_backup');
  for(const index of indexes)database.exec(index.sql);
  database.exec('DROP TABLE temp.series_fact_backup');
}

// Schema-only expansion of completed history. No runtime or business evidence is translated.
const OFFLOAD_SOURCE_SQL = "CREATE TABLE \"libra_offload_context_materials\" (\n  \"on_deck_package_id\" TEXT,\n  \"ordinal\" INTEGER CHECK (\"ordinal\" >= 0),\n  \"material_key\" TEXT,\n  \"context_role\" TEXT CHECK (\"context_role\" IN ('original_input', 'structural_dependency', 'related_input')),\n  \"source_related_reference_id\" TEXT,\n  \"final_product_material_key\" TEXT,\n  \"disposition_kind\" TEXT CHECK (\"disposition_kind\" IN ('carried_forward', 'replaced_and_settled')),\n  \"mount_scope_id\" TEXT,\n  \"inode\" TEXT,\n  \"size_bytes\" INTEGER CHECK (\"size_bytes\" >= 0),\n  \"fingerprint_algorithm\" TEXT,\n  \"fingerprint_version\" TEXT,\n  \"content_fingerprint\" TEXT,\n  \"endpoint_id\" TEXT,\n  \"location\" TEXT,\n  \"binding_revision\" INTEGER CHECK (\"binding_revision\" >= 1),\n  \"binding_evidence_digest\" TEXT CHECK (length(\"binding_evidence_digest\") = 64 AND \"binding_evidence_digest\" NOT GLOB '*[^0-9a-f]*'),\n  \"admitted_control_revision\" INTEGER CHECK (\"admitted_control_revision\" >= 1),\n  \"admitted_control_projection_digest\" TEXT CHECK (length(\"admitted_control_projection_digest\") = 64 AND \"admitted_control_projection_digest\" NOT GLOB '*[^0-9a-f]*'),\n  \"derived_authority_digest\" TEXT CHECK (length(\"derived_authority_digest\") = 64 AND \"derived_authority_digest\" NOT GLOB '*[^0-9a-f]*'),\n  \"settlement_expectation\" TEXT CHECK (\"settlement_expectation\" IN ('retain', 'replace_or_move', 'remove_after_place')),\n  \"context_member_digest\" TEXT CHECK (length(\"context_member_digest\") = 64 AND \"context_member_digest\" NOT GLOB '*[^0-9a-f]*'),\n  PRIMARY KEY (\"on_deck_package_id\", \"ordinal\"),\n  UNIQUE (\"on_deck_package_id\", \"material_key\", \"context_role\"),\n  FOREIGN KEY (\"on_deck_package_id\") REFERENCES \"libra_product_packages\" (\"on_deck_package_id\") ON DELETE RESTRICT\n)";
const OFFLOAD_TARGET_SQL = "CREATE TABLE \"libra_offload_context_materials\" (\n  \"on_deck_package_id\" TEXT,\n  \"ordinal\" INTEGER CHECK (\"ordinal\" >= 0),\n  \"material_key\" TEXT,\n  \"context_role\" TEXT CHECK (\"context_role\" IN ('original_input', 'structural_dependency', 'related_input')),\n  \"source_related_reference_id\" TEXT,\n  \"final_product_material_key\" TEXT,\n  \"final_product_material_keys_schema_ref\" TEXT,\n  \"final_product_material_keys_json\" TEXT,\n  \"disposition_kind\" TEXT CHECK (\"disposition_kind\" IN ('carried_forward', 'replaced_and_settled')),\n  \"mount_scope_id\" TEXT,\n  \"inode\" TEXT,\n  \"size_bytes\" INTEGER CHECK (\"size_bytes\" >= 0),\n  \"fingerprint_algorithm\" TEXT,\n  \"fingerprint_version\" TEXT,\n  \"content_fingerprint\" TEXT,\n  \"endpoint_id\" TEXT,\n  \"location\" TEXT,\n  \"binding_revision\" INTEGER CHECK (\"binding_revision\" >= 1),\n  \"binding_evidence_digest\" TEXT CHECK (length(\"binding_evidence_digest\") = 64 AND \"binding_evidence_digest\" NOT GLOB '*[^0-9a-f]*'),\n  \"admitted_control_revision\" INTEGER CHECK (\"admitted_control_revision\" >= 1),\n  \"admitted_control_projection_digest\" TEXT CHECK (length(\"admitted_control_projection_digest\") = 64 AND \"admitted_control_projection_digest\" NOT GLOB '*[^0-9a-f]*'),\n  \"derived_authority_digest\" TEXT CHECK (length(\"derived_authority_digest\") = 64 AND \"derived_authority_digest\" NOT GLOB '*[^0-9a-f]*'),\n  \"settlement_expectation\" TEXT CHECK (\"settlement_expectation\" IN ('retain', 'replace_or_move', 'remove_after_place')),\n  \"context_member_digest\" TEXT CHECK (length(\"context_member_digest\") = 64 AND \"context_member_digest\" NOT GLOB '*[^0-9a-f]*'),\n  PRIMARY KEY (\"on_deck_package_id\", \"ordinal\"),\n  UNIQUE (\"on_deck_package_id\", \"material_key\", \"context_role\"),\n  CHECK (\"final_product_material_keys_json\" IS NULL OR json_valid(\"final_product_material_keys_json\")),\n  CHECK (\"final_product_material_keys_json\" IS NULL OR length(CAST(\"final_product_material_keys_json\" AS BLOB)) <= 131072),\n  CHECK ((\"final_product_material_key\" IS NOT NULL AND \"final_product_material_keys_json\" IS NULL AND \"final_product_material_keys_schema_ref\" IS NULL) OR\n     (\"final_product_material_key\" IS NULL AND \"final_product_material_keys_json\" IS NOT NULL AND\n      \"final_product_material_keys_schema_ref\" IS NOT NULL AND \"final_product_material_keys_schema_ref\" = 'helix://contracts/application-types/LibraOffloadProductMaterialKeys/v1' AND\n      json_type(\"final_product_material_keys_json\") = 'array' AND json_array_length(\"final_product_material_keys_json\") BETWEEN 2 AND 1024 AND\n      \"context_role\" = 'original_input' AND \"disposition_kind\" = 'replaced_and_settled' AND \"settlement_expectation\" = 'remove_after_place')),\n  FOREIGN KEY (\"on_deck_package_id\") REFERENCES \"libra_product_packages\" (\"on_deck_package_id\") ON DELETE RESTRICT\n);";
function extendOffloadTargetStorage(database) {
  const table='libra_offload_context_materials';
  if(database.pragma('table_info('+table+')').some(column=>column.name==='final_product_material_keys_json'))return;
  // Commit receipts establish collection ownership; Custody can remain active after Commit.
  if(database.prepare("SELECT 1 FROM libra_runs WHERE state IS NULL OR state NOT IN ('completed','discarded','superseded') LIMIT 1").get()||
      database.prepare("SELECT 1 FROM libra_product_packages p WHERE NOT EXISTS (SELECT 1 FROM arca_ondeck_runs r JOIN arca_ondeck_custodies c ON c.custody_id=r.custody_id JOIN arca_ondeck_commit_receipts receipt ON receipt.on_deck_run_id=r.on_deck_run_id WHERE c.on_deck_package_id=p.on_deck_package_id AND c.package_digest=p.package_digest AND r.state='committed') LIMIT 1").get())
    throw new UatIdentitySelectionMigrationError('SERIES_OFFLOAD_FORMATION_RESET_REQUIRED',
      'Unfinished Formation requires an explicitly authorized Reset before this schema upgrade.');
  const row=database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if(row?.sql.replaceAll('\r\n','\n')!==OFFLOAD_SOURCE_SQL)
    throw new UatIdentitySelectionMigrationError('SERIES_OFFLOAD_SOURCE_SCHEMA_DRIFT','Off-load table differs from the frozen prior schema.');
  const columns=database.pragma('table_info('+table+')').map(column=>'"'+column.name+'"').join(','),
    readSql='SELECT '+columns+' FROM "'+table+'" ORDER BY on_deck_package_id,ordinal',
    before=digest(database.prepare(readSql).all()),
    dependent=database.prepare("SELECT sql FROM sqlite_master WHERE tbl_name=? AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY type,name").all(table);
  database.exec('CREATE TEMP TABLE series_offload_backup AS SELECT * FROM "libra_offload_context_materials"');
  database.exec('DROP TABLE "libra_offload_context_materials"');
  database.exec(OFFLOAD_TARGET_SQL);
  database.exec('INSERT INTO "libra_offload_context_materials" ('+columns+') SELECT '+columns+' FROM temp.series_offload_backup');
  for(const object of dependent)database.exec(object.sql);
  if(digest(database.prepare(readSql).all())!==before)
    throw new UatIdentitySelectionMigrationError('SERIES_OFFLOAD_HISTORY_DRIFT','Off-load history changed during schema expansion.');
  database.exec('DROP TABLE temp.series_offload_backup');
}

function migrateUatIdentitySelectionSchema(options) {
  if (!options || typeof options.Database !== 'function' || typeof options.databasePath !== 'string' || !options.schemaManifest) {
    throw new TypeError('The UAT identity-selection migration requires a database driver, path, and target manifest.');
  }
  if (options.schemaManifest.ddlDigest !== TARGET_SCHEMA_DIGEST || options.schemaManifest.tableCount !== 198) {
    throw new UatIdentitySelectionMigrationError('UAT_MIGRATION_TARGET_SCHEMA_UNSUPPORTED',
      'The runtime schema is not the single approved UAT migration target.');
  }
  const database = new options.Database(options.databasePath);
  try {
    const markerTable = database.prepare(
      "SELECT 1 present FROM sqlite_master WHERE type='table' AND name='platform_schema_marker'",
    ).get();
    if (!markerTable) return Object.freeze({ migrated: false, reason: 'fresh_or_uninitialized' });
    const marker = database.prepare(
      'SELECT schema_name,generation,schema_digest,catalog_digest FROM platform_schema_marker',
    ).get();
    if (!marker || marker.schema_name !== 'shelfdeck') {
      throw new UatIdentitySelectionMigrationError('UAT_MIGRATION_SOURCE_MARKER_INVALID',
        'The source database does not contain the expected ShelfDeck schema marker.');
    }
    const acceptanceEvidenceSource=marker.generation===TARGET_GENERATION&&marker.schema_digest===PRE_ACCEPTANCE_EVIDENCE_SCHEMA_DIGEST;
    const episodeMetadataSource=marker.generation===TARGET_GENERATION&&marker.schema_digest===PRE_EPISODE_METADATA_SCHEMA_DIGEST;
    const offloadTargetsSource=marker.generation===TARGET_GENERATION&&marker.schema_digest===PRE_OFFLOAD_TARGETS_SCHEMA_DIGEST;
    const artifactScopeSource=marker.generation===TARGET_GENERATION&&marker.schema_digest===PRE_ARTIFACT_SCOPE_SCHEMA_DIGEST;
    const targetReservationSource=marker.generation===TARGET_GENERATION&&marker.schema_digest===PRE_TARGET_RESERVATION_SCHEMA_DIGEST;
    const seriesFactKeySource=marker.generation===TARGET_GENERATION&&marker.schema_digest===PRE_SERIES_FACT_KEY_SCHEMA_DIGEST;
    const seriesProvenanceSource=marker.generation===TARGET_GENERATION&&marker.schema_digest===PRE_SERIES_PROVENANCE_SCHEMA_DIGEST;
    const secondaryTargetSource=marker.generation===TARGET_GENERATION&&marker.schema_digest===PRE_SECONDARY_TARGET_SCHEMA_DIGEST;
    const alreadyCurrent = marker.generation === TARGET_GENERATION && marker.schema_digest === TARGET_SCHEMA_DIGEST;
    const terminalOutcomeSource = marker.generation === TARGET_GENERATION && marker.schema_digest === PRE_TERMINAL_OUTCOME_SCHEMA_DIGEST;
    const offdeckCoverageSource = marker.generation === TARGET_GENERATION && marker.schema_digest === PRE_OFFDECK_COVERAGE_SCHEMA_DIGEST;
    const targetBindingSource = marker.generation === TARGET_GENERATION && marker.schema_digest === PRE_TARGET_BINDING_SCHEMA_DIGEST;
    const sourceCleanupSource = marker.generation === TARGET_GENERATION && marker.schema_digest === PRE_SOURCE_CLEANUP_SCHEMA_DIGEST;
    const caseAdmissionSource = marker.generation === TARGET_GENERATION && marker.schema_digest === PRE_CASE_ADMISSION_SCHEMA_DIGEST;
    const formationThreeStateSource = marker.generation === TARGET_GENERATION &&
      marker.schema_digest === PRE_FORMATION_THREE_STATE_SCHEMA_DIGEST;
    const predeckPipelineSource = marker.generation === TARGET_GENERATION &&
      marker.schema_digest === PRE_PREDECK_PIPELINE_SCHEMA_DIGEST;
    const defectAdmissionSource = marker.generation === TARGET_GENERATION &&
      marker.schema_digest === PRE_DEFECT_ADMISSION_SCHEMA_DIGEST;
    const aftercareHardeningSource = marker.generation === TARGET_GENERATION &&
      marker.schema_digest === PRE_AFTERCARE_HARDENING_SCHEMA_DIGEST;
    const executorClosureSource = marker.generation === TARGET_GENERATION &&
      marker.schema_digest === PRE_EXECUTOR_CLOSURE_SCHEMA_DIGEST;
    const legacySource = marker.generation === SOURCE_GENERATION && marker.schema_digest === SOURCE_SCHEMA_DIGEST;
    const v2Source = marker.generation === INTERMEDIATE_GENERATION && marker.schema_digest === INTERMEDIATE_SCHEMA_DIGEST;
    if (!alreadyCurrent && !acceptanceEvidenceSource && !episodeMetadataSource && !offloadTargetsSource && !artifactScopeSource && !targetReservationSource && !seriesFactKeySource && !seriesProvenanceSource && !secondaryTargetSource && !terminalOutcomeSource && !offdeckCoverageSource && !targetBindingSource && !sourceCleanupSource && !caseAdmissionSource && !formationThreeStateSource && !predeckPipelineSource && !defectAdmissionSource && !aftercareHardeningSource && !executorClosureSource && !legacySource && !v2Source) {
      throw new UatIdentitySelectionMigrationError('UAT_MIGRATION_SOURCE_SCHEMA_UNSUPPORTED',
        'Only the exact pre-UAT live schema can be upgraded in place.', {
          generation: marker.generation, schemaDigest: marker.schema_digest,
        });
    }
    const sourceCatalogDigest = digest(catalogRows(database));
    if (!alreadyCurrent && marker.catalog_digest !== sourceCatalogDigest) {
      throw new UatIdentitySelectionMigrationError('UAT_MIGRATION_SOURCE_CATALOG_DRIFT',
        'The source catalog differs from its durable marker; migration was not started.');
    }
    const now = options.now || Date.now;
    // The Case table rebuild preserves incoming foreign keys and all existing rows.
    database.pragma('foreign_keys = OFF');
    database.exec('BEGIN IMMEDIATE');
    try {
      if (legacySource) database.exec(`CREATE TABLE "libra_product_identity_selection_intents" (
        "selection_intent_id" TEXT PRIMARY KEY,
        "libra_run_id" TEXT,
        "intent_revision" INTEGER CHECK ("intent_revision" >= 1),
        "selection_kind" TEXT CHECK ("selection_kind" IN ('candidate', 'provider_id')),
        "provider" TEXT,
        "namespace" TEXT,
        "provider_key" TEXT,
        "candidate_set_digest" TEXT CHECK (length("candidate_set_digest") = 64 AND "candidate_set_digest" NOT GLOB '*[^0-9a-f]*'),
        "expected_run_state_revision" INTEGER CHECK ("expected_run_state_revision" >= 1),
        "expected_identity_revision" INTEGER CHECK ("expected_identity_revision" >= 1),
        "idempotency_key" TEXT,
        "intent_digest" TEXT CHECK (length("intent_digest") = 64 AND "intent_digest" NOT GLOB '*[^0-9a-f]*'),
        "created_at_ms" INTEGER CHECK ("created_at_ms" >= 0),
        UNIQUE ("libra_run_id", "intent_revision"),
        UNIQUE ("libra_run_id", "idempotency_key"),
        FOREIGN KEY ("libra_run_id") REFERENCES "libra_runs" ("libra_run_id") ON DELETE RESTRICT
      )`);
      if (legacySource || v2Source) database.exec(FORMATION_PROJECTION_DDL);
      if (legacySource || v2Source || executorClosureSource) database.exec(EXECUTOR_CLOSURE_DDL);
      if (!alreadyCurrent && !acceptanceEvidenceSource && !episodeMetadataSource && !offloadTargetsSource && !artifactScopeSource && !targetReservationSource && !seriesFactKeySource && !seriesProvenanceSource && !secondaryTargetSource && !terminalOutcomeSource) ensureAftercareCaseTerminalEvidence(database);
      if (defectAdmissionSource) migrateDefectAdmissionRevisionKind(database);
      if (!alreadyCurrent && !acceptanceEvidenceSource && !episodeMetadataSource && !offloadTargetsSource && !artifactScopeSource && !targetReservationSource && !seriesFactKeySource && !seriesProvenanceSource && !secondaryTargetSource && !terminalOutcomeSource) migratePredeckPipelineTables(database);
      if (formationThreeStateSource) migrateFormationThreeStateProjection(database);
      if (!alreadyCurrent && !acceptanceEvidenceSource && !episodeMetadataSource && !offloadTargetsSource && !artifactScopeSource && !targetReservationSource && !seriesFactKeySource && !seriesProvenanceSource && !secondaryTargetSource && !terminalOutcomeSource) {
        const coverageColumns = database.pragma('table_info(arca_offdeck_selection_receipts)').map((column) => column.name);
        if (!coverageColumns.includes('shelf_coverage_schema_ref')) database.exec('ALTER TABLE "arca_offdeck_selection_receipts" ADD COLUMN "shelf_coverage_schema_ref" TEXT');
        if (!coverageColumns.includes('shelf_coverage_json')) database.exec('ALTER TABLE "arca_offdeck_selection_receipts" ADD COLUMN "shelf_coverage_json" TEXT CHECK ("shelf_coverage_json" IS NULL OR json_valid("shelf_coverage_json")) CHECK ("shelf_coverage_json" IS NULL OR length(CAST("shelf_coverage_json" AS BLOB)) <= 65536)');
        migrateAftercareCaseAdmission(database); migrateRecycleTable(database); migrateSourceCleanupTable(database); migrateShelfTargetBindings(database);
        for (const [name,sql] of [
          ['idx_fx_supporting_works_hot_02','CREATE INDEX "idx_fx_supporting_works_hot_02" ON "fx_supporting_works" ("process_id", "work_id")'],
          ['idx_fx_supporting_works_hot_03','CREATE INDEX "idx_fx_supporting_works_hot_03" ON "fx_supporting_works" ("state", "created_at_ms", "work_id")'],
          ['idx_fx_workflow_events_hot_02','CREATE INDEX "idx_fx_workflow_events_hot_02" ON "fx_workflow_events" ("work_id", "event_id")'],
          ['idx_proc_run_materials_hot_01','CREATE INDEX "idx_proc_run_materials_hot_01" ON "proc_run_materials" ("candidate_package_id", "procurement_run_id", "ordinal")'],
        ]) {
          if(!database.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?").get(name))database.exec(sql);
        }
        for (const name of ['uidx_arca_rule_template_drafts_partial_01','uidx_fx_event_result_bindings_partial_01']) {
          const index=database.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?").get(name);
          if(index && / WHERE 1 = 1;?$/.test(index.sql)) {
            database.exec('DROP INDEX "'+name+'"');
            database.exec(index.sql.replace(/ WHERE 1 = 1;?$/, ';'));
          }
        }
      }
      if (!alreadyCurrent && !acceptanceEvidenceSource && !episodeMetadataSource && !offloadTargetsSource && !artifactScopeSource && !targetReservationSource && !seriesFactKeySource && !seriesProvenanceSource && !secondaryTargetSource) addTerminalOutcomeTables(database);
      if (!alreadyCurrent && !acceptanceEvidenceSource && !episodeMetadataSource && !offloadTargetsSource && !artifactScopeSource && !targetReservationSource && !seriesFactKeySource && !seriesProvenanceSource) addSecondaryTargetRevision(database);
      if (!alreadyCurrent && !acceptanceEvidenceSource && !episodeMetadataSource) {
        if (database.prepare("SELECT 1 FROM arca_ondeck_runs WHERE state <> 'committed' LIMIT 1").get()) {
          throw new UatIdentitySelectionMigrationError('ARCA_TARGET_RESERVATION_FORMATION_RESET_REQUIRED',
            'Unfinished On-deck Runs require an explicitly authorized Formation Reset before this schema upgrade.');
        }
        if (!database.pragma('table_info(arca_ondeck_runs)').some(column=>column.name==='target_reserved_at_ms')) {
          database.exec('ALTER TABLE "arca_ondeck_runs" ADD COLUMN "target_reserved_at_ms" INTEGER CHECK ("target_reserved_at_ms" >= 0)');
        }
      }
      if (!alreadyCurrent && !database.pragma('table_info(arca_inventory_materials)').some(column=>column.name==='artifact_scope_json')) {
        if(database.prepare("SELECT 1 FROM arca_shelf_entries WHERE structure_kind='season' LIMIT 1").get())
          throw new UatIdentitySelectionMigrationError('ARCA_SERIES_ARTIFACT_SCOPE_UNPROVEN',
            'Existing Series Inventory requires explicit Artifact target evidence; this upgrade cannot infer it.');
        database.exec('ALTER TABLE "arca_inventory_materials" ADD COLUMN "artifact_scope_schema_ref" TEXT');
        database.exec('ALTER TABLE "arca_inventory_materials" ADD COLUMN "artifact_scope_json" TEXT CHECK ("artifact_scope_json" IS NULL OR json_valid("artifact_scope_json")) CHECK ("artifact_scope_json" IS NULL OR length(CAST("artifact_scope_json" AS BLOB)) <= 4096)');
      }
      if (!alreadyCurrent && !acceptanceEvidenceSource && !episodeMetadataSource) expandProductionProvenanceBound(database);
      if (!alreadyCurrent && !acceptanceEvidenceSource && !episodeMetadataSource) extendSeriesFactKey(database);
      if (!alreadyCurrent && !acceptanceEvidenceSource && !episodeMetadataSource) extendOffloadTargetStorage(database);
      if (!alreadyCurrent && !acceptanceEvidenceSource) {
        for (const table of ['libra_product_fact_revisions','arca_inventory_product_facts']) {
          database.exec('ALTER TABLE "'+table+'" ADD COLUMN "episode_metadata_schema_ref" TEXT');
          database.exec('ALTER TABLE "'+table+'" ADD COLUMN "episode_metadata_json" TEXT CHECK ("episode_metadata_json" IS NULL OR json_valid("episode_metadata_json")) CHECK ("episode_metadata_json" IS NULL OR length(CAST("episode_metadata_json" AS BLOB)) <= 16777216)');
        }
      }
      if (!alreadyCurrent) database.exec(`CREATE TABLE "arca_acceptance_check_evidence" (
  "acceptance_attempt_id" TEXT,
  "check_kind" TEXT,
  "check_revision" INTEGER CHECK ("check_revision" >= 1),
  "offer_id" TEXT,
  "package_digest" TEXT CHECK (length("package_digest") = 64 AND "package_digest" NOT GLOB '*[^0-9a-f]*'),
  "work_id" TEXT,
  "event_id" TEXT,
  "evidence_schema_ref" TEXT,
  "evidence_json" TEXT,
  "evidence_digest" TEXT CHECK (length("evidence_digest") = 64 AND "evidence_digest" NOT GLOB '*[^0-9a-f]*'),
  "record_schema_ref" TEXT,
  "record_json" TEXT,
  "record_digest" TEXT CHECK (length("record_digest") = 64 AND "record_digest" NOT GLOB '*[^0-9a-f]*'),
  "commit_marker" TEXT,
  "committed_at_ms" INTEGER CHECK ("committed_at_ms" >= 0),
  PRIMARY KEY ("acceptance_attempt_id", "check_kind", "check_revision"),
  UNIQUE ("event_id"),
  UNIQUE ("commit_marker"),
  CHECK (json_valid("evidence_json")),
  CHECK (length(CAST("evidence_json" AS BLOB)) <= 2097152),
  CHECK (json_valid("record_json")),
  CHECK (length(CAST("record_json" AS BLOB)) <= 65536),
  FOREIGN KEY ("commit_marker") REFERENCES "fx_commit_markers" ("commit_marker") ON DELETE RESTRICT
);`);
      if (!alreadyCurrent && database.pragma('foreign_key_check').length) {
        throw new UatIdentitySelectionMigrationError('UAT_MIGRATION_FOREIGN_KEY_VIOLATION',
          'Migration would leave invalid references; all schema changes were rolled back.');
      }
      const appliedAtMs = now();
      if (!Number.isSafeInteger(appliedAtMs) || appliedAtMs < 0) {
        throw new UatIdentitySelectionMigrationError('UAT_MIGRATION_INVALID_TIME', 'Migration time must be a non-negative safe integer.');
      }
      if (!alreadyCurrent) {
        const targetCatalogDigest = digest(catalogRows(database));
        database.prepare(
          'UPDATE platform_schema_marker SET generation=?,schema_digest=?,catalog_digest=?,applied_at_ms=? WHERE schema_name=?',
        ).run(TARGET_GENERATION, TARGET_SCHEMA_DIGEST, targetCatalogDigest, appliedAtMs, 'shelfdeck');
      }
      const retiredIntakeBindingAttempts = (alreadyCurrent || acceptanceEvidenceSource || episodeMetadataSource || offloadTargetsSource || artifactScopeSource || targetReservationSource || seriesFactKeySource || seriesProvenanceSource || terminalOutcomeSource || secondaryTargetSource) ? 0 : retirePreCorrectionIntakeBindingAttempts(database, appliedAtMs);
      const retiredPreProjection = (alreadyCurrent || acceptanceEvidenceSource || episodeMetadataSource || offloadTargetsSource || artifactScopeSource || targetReservationSource || seriesFactKeySource || seriesProvenanceSource || terminalOutcomeSource || secondaryTargetSource) ? {} : retirePreProjectionExecutionWorks(database, appliedAtMs);
      database.exec('COMMIT');
      const retirement = Object.freeze({
        ...(retiredIntakeBindingAttempts ? {retiredIntakeBindingAttempts} : {}),
        ...(retiredPreProjection.retiredPreProjectionWorks ? retiredPreProjection : {}),
      });
      if (!alreadyCurrent) return Object.freeze({ migrated: true, sourceSchemaDigest: marker.schema_digest,
        targetSchemaDigest: TARGET_SCHEMA_DIGEST, ...retirement });
      return Object.freeze({ migrated:false, reason:'already_current',
        ...retirement });
    } catch (error) {
      if (database.inTransaction) database.exec('ROLLBACK');
      throw error;
    }
  } finally {
    database.close();
  }
}

module.exports = Object.freeze({
  PRE_OFFLOAD_TARGETS_SCHEMA_DIGEST,
  SOURCE_GENERATION,
  SOURCE_SCHEMA_DIGEST,
  PRE_SERIES_PROVENANCE_SCHEMA_DIGEST,
  PRE_TARGET_RESERVATION_SCHEMA_DIGEST,
  PRE_ARTIFACT_SCOPE_SCHEMA_DIGEST,
  PRE_SERIES_FACT_KEY_SCHEMA_DIGEST,
  INTERMEDIATE_GENERATION,
  INTERMEDIATE_SCHEMA_DIGEST,
  PRE_UAT_EXECUTION_CATALOG_DIGEST,
  PRE_PROJECTION_EXECUTION_CATALOG_DIGEST,
  INTAKE_BINDING_REPLAN_CODE,
  PRE_PROJECTION_PLAN_REPLAN_CODE,
  PRE_AFTERCARE_HARDENING_SCHEMA_DIGEST,
  PRE_DEFECT_ADMISSION_SCHEMA_DIGEST,
  PRE_PREDECK_PIPELINE_SCHEMA_DIGEST,
  PRE_FORMATION_THREE_STATE_SCHEMA_DIGEST,
  PRE_CASE_ADMISSION_SCHEMA_DIGEST,
  TARGET_GENERATION,
  PRE_TARGET_BINDING_SCHEMA_DIGEST,
  PRE_SECONDARY_TARGET_SCHEMA_DIGEST,
  PRE_EPISODE_METADATA_SCHEMA_DIGEST,
  PRE_ACCEPTANCE_EVIDENCE_SCHEMA_DIGEST,
  TARGET_SCHEMA_DIGEST,
  PRE_SOURCE_CLEANUP_SCHEMA_DIGEST,
  UatIdentitySelectionMigrationError,
  migrateUatIdentitySelectionSchema,
});
