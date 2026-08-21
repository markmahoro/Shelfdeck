'use strict';

const { digest } = require('./ddl-compiler');

const SOURCE_GENERATION = 'helix-clean-v1';
const INTERMEDIATE_GENERATION = 'helix-clean-v2';
const TARGET_GENERATION = 'helix-clean-v3';
const SOURCE_SCHEMA_DIGEST = '78075366b3409916b8f8c6fcd3c0786daa5e45bab82f59ba83d91a2663689119';
const INTERMEDIATE_SCHEMA_DIGEST = 'fee80cf21719481a83274c3b9021918571ed8e5a510239b1d82995758a4cbcd4';
const PRE_EXECUTOR_CLOSURE_SCHEMA_DIGEST = '998b673af4d2f0a6ed4f96bcb7f34c56b8dad3ffc562f40a69a335b948a7cab0';
const TARGET_SCHEMA_DIGEST = 'c5d9640055e8a7805791bf4a54539fc2b4325403c8ba797b7368245dc5a75d9b';
const PRE_UAT_EXECUTION_CATALOG_DIGEST = 'b0371a6d2793c1e381a4c2e7fc421d312a1a1e90d2de5e47f61a45022f09793b';
const PRE_PROJECTION_EXECUTION_CATALOG_DIGEST = '13315cdbdf6ab5cbe30b32075f89bd76ae1a873d84034dc572824f4fbc3886e6';
const INTAKE_BINDING_REPLAN_CODE = 'P4_UAT_INTAKE_BINDING_RESULT_REPLAN_REQUIRED';
const PRE_PROJECTION_PLAN_REPLAN_CODE = 'P4_UAT_PRE_PROJECTION_PLAN_REPLAN_REQUIRED';
const FORMATION_PROJECTION_DDL = `CREATE TABLE "libra_formation_projections" (
  "subject_id" TEXT PRIMARY KEY,
  "projection_revision" INTEGER CHECK ("projection_revision" >= 1),
  "classification" TEXT CHECK ("classification" IN ('waiting', 'in_progress', 'completed')),
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

function migrateUatIdentitySelectionSchema(options) {
  if (!options || typeof options.Database !== 'function' || typeof options.databasePath !== 'string' || !options.schemaManifest) {
    throw new TypeError('The UAT identity-selection migration requires a database driver, path, and target manifest.');
  }
  if (options.schemaManifest.ddlDigest !== TARGET_SCHEMA_DIGEST || options.schemaManifest.tableCount !== 184) {
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
    const alreadyCurrent = marker.generation === TARGET_GENERATION && marker.schema_digest === TARGET_SCHEMA_DIGEST;
    const executorClosureSource = marker.generation === TARGET_GENERATION &&
      marker.schema_digest === PRE_EXECUTOR_CLOSURE_SCHEMA_DIGEST;
    const legacySource = marker.generation === SOURCE_GENERATION && marker.schema_digest === SOURCE_SCHEMA_DIGEST;
    const v2Source = marker.generation === INTERMEDIATE_GENERATION && marker.schema_digest === INTERMEDIATE_SCHEMA_DIGEST;
    if (!alreadyCurrent && !executorClosureSource && !legacySource && !v2Source) {
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
      if (!alreadyCurrent) database.exec(EXECUTOR_CLOSURE_DDL);
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
      const retiredIntakeBindingAttempts = retirePreCorrectionIntakeBindingAttempts(database, appliedAtMs);
      const retiredPreProjection = retirePreProjectionExecutionWorks(database, appliedAtMs);
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
  SOURCE_GENERATION,
  SOURCE_SCHEMA_DIGEST,
  INTERMEDIATE_GENERATION,
  INTERMEDIATE_SCHEMA_DIGEST,
  PRE_UAT_EXECUTION_CATALOG_DIGEST,
  PRE_PROJECTION_EXECUTION_CATALOG_DIGEST,
  INTAKE_BINDING_REPLAN_CODE,
  PRE_PROJECTION_PLAN_REPLAN_CODE,
  TARGET_GENERATION,
  TARGET_SCHEMA_DIGEST,
  UatIdentitySelectionMigrationError,
  migrateUatIdentitySelectionSchema,
});
