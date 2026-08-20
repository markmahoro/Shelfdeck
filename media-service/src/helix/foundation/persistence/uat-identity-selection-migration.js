'use strict';

const { digest } = require('./ddl-compiler');

const SOURCE_GENERATION = 'helix-clean-v1';
const TARGET_GENERATION = 'helix-clean-v2';
const SOURCE_SCHEMA_DIGEST = '78075366b3409916b8f8c6fcd3c0786daa5e45bab82f59ba83d91a2663689119';
const TARGET_SCHEMA_DIGEST = 'fee80cf21719481a83274c3b9021918571ed8e5a510239b1d82995758a4cbcd4';
const PRE_UAT_EXECUTION_CATALOG_DIGEST = 'b0371a6d2793c1e381a4c2e7fc421d312a1a1e90d2de5e47f61a45022f09793b';
const INTAKE_BINDING_REPLAN_CODE = 'P4_UAT_INTAKE_BINDING_RESULT_REPLAN_REQUIRED';

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

function migrateUatIdentitySelectionSchema(options) {
  if (!options || typeof options.Database !== 'function' || typeof options.databasePath !== 'string' || !options.schemaManifest) {
    throw new TypeError('The UAT identity-selection migration requires a database driver, path, and target manifest.');
  }
  if (options.schemaManifest.ddlDigest !== TARGET_SCHEMA_DIGEST || options.schemaManifest.tableCount !== 181) {
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
    if (!alreadyCurrent && (marker.generation !== SOURCE_GENERATION || marker.schema_digest !== SOURCE_SCHEMA_DIGEST)) {
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
      if (!alreadyCurrent) database.exec(`CREATE TABLE "libra_product_identity_selection_intents" (
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
      database.exec('COMMIT');
      if (!alreadyCurrent) return Object.freeze({ migrated: true, sourceSchemaDigest: SOURCE_SCHEMA_DIGEST,
        targetSchemaDigest: TARGET_SCHEMA_DIGEST, ...(retiredIntakeBindingAttempts ? {retiredIntakeBindingAttempts} : {}) });
      return Object.freeze({ migrated:false, reason:'already_current',
        ...(retiredIntakeBindingAttempts ? {retiredIntakeBindingAttempts} : {}) });
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
  PRE_UAT_EXECUTION_CATALOG_DIGEST,
  INTAKE_BINDING_REPLAN_CODE,
  TARGET_GENERATION,
  TARGET_SCHEMA_DIGEST,
  UatIdentitySelectionMigrationError,
  migrateUatIdentitySelectionSchema,
});
