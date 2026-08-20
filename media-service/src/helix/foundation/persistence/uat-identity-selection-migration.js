'use strict';

const { digest } = require('./ddl-compiler');

const SOURCE_GENERATION = 'helix-clean-v1';
const TARGET_GENERATION = 'helix-clean-v2';
const SOURCE_SCHEMA_DIGEST = '78075366b3409916b8f8c6fcd3c0786daa5e45bab82f59ba83d91a2663689119';
const TARGET_SCHEMA_DIGEST = 'fee80cf21719481a83274c3b9021918571ed8e5a510239b1d82995758a4cbcd4';

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
    if (marker.generation === TARGET_GENERATION && marker.schema_digest === TARGET_SCHEMA_DIGEST) {
      return Object.freeze({ migrated: false, reason: 'already_current' });
    }
    if (marker.generation !== SOURCE_GENERATION || marker.schema_digest !== SOURCE_SCHEMA_DIGEST) {
      throw new UatIdentitySelectionMigrationError('UAT_MIGRATION_SOURCE_SCHEMA_UNSUPPORTED',
        'Only the exact pre-UAT live schema can be upgraded in place.', {
          generation: marker.generation, schemaDigest: marker.schema_digest,
        });
    }
    const sourceCatalogDigest = digest(catalogRows(database));
    if (marker.catalog_digest !== sourceCatalogDigest) {
      throw new UatIdentitySelectionMigrationError('UAT_MIGRATION_SOURCE_CATALOG_DRIFT',
        'The source catalog differs from its durable marker; migration was not started.');
    }
    const now = options.now || Date.now;
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(`CREATE TABLE "libra_product_identity_selection_intents" (
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
      const targetCatalogDigest = digest(catalogRows(database));
      const appliedAtMs = now();
      if (!Number.isSafeInteger(appliedAtMs) || appliedAtMs < 0) {
        throw new UatIdentitySelectionMigrationError('UAT_MIGRATION_INVALID_TIME', 'Migration time must be a non-negative safe integer.');
      }
      database.prepare(
        'UPDATE platform_schema_marker SET generation=?,schema_digest=?,catalog_digest=?,applied_at_ms=? WHERE schema_name=?',
      ).run(TARGET_GENERATION, TARGET_SCHEMA_DIGEST, targetCatalogDigest, appliedAtMs, 'shelfdeck');
      database.exec('COMMIT');
      return Object.freeze({ migrated: true, sourceSchemaDigest: SOURCE_SCHEMA_DIGEST, targetSchemaDigest: TARGET_SCHEMA_DIGEST });
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
  TARGET_GENERATION,
  TARGET_SCHEMA_DIGEST,
  UatIdentitySelectionMigrationError,
  migrateUatIdentitySelectionSchema,
});
