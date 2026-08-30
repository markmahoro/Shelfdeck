'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const schemaManifest = require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const { digest } = require('../src/helix/foundation/persistence/ddl-compiler');

const CONFIRMATION = 'PREDECK_PIPELINE_MIGRATION_V1';
const MIGRATION_DDL = Object.freeze([
  `CREATE TABLE IF NOT EXISTS "libra_field_intake_admission_policies" (
  "field_id" TEXT PRIMARY KEY,
  "predeck_pipeline_seats" INTEGER,
  "policy_revision" INTEGER CHECK ("policy_revision" >= 1),
  "updated_at_ms" INTEGER CHECK ("updated_at_ms" >= 0)
);`,
  `CREATE TABLE IF NOT EXISTS "libra_predeck_pipeline_tokens" (
  "subject_id" TEXT PRIMARY KEY,
  "source_field_id" TEXT,
  "source_process_id" TEXT,
  "acquired_at_ms" INTEGER CHECK ("acquired_at_ms" >= 0)
);`,
  `CREATE INDEX IF NOT EXISTS "idx_libra_predeck_pipeline_tokens_hot_01"
    ON "libra_predeck_pipeline_tokens" ("source_field_id", "subject_id");`,
]);

function valueAfter(args, flag) {
  const assigned = args.find((arg) => arg.startsWith(`${flag}=`));
  if (assigned) return assigned.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function catalogRows(database) {
  return database.prepare(
    "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
  ).all().map((row) => ({ ...row, sql: row.sql && row.sql.replaceAll('\r\n', '\n') }));
}

function inspect(database) {
  const names = new Set(catalogRows(database).map((row) => row.name));
  return Object.freeze({
    hasPolicyTable: names.has('libra_field_intake_admission_policies'),
    hasTokenTable: names.has('libra_predeck_pipeline_tokens'),
    hasTokenIndex: names.has('idx_libra_predeck_pipeline_tokens_hot_01'),
    marker: database.prepare(
      'SELECT schema_name,generation,schema_digest,catalog_digest FROM platform_schema_marker WHERE schema_name=?',
    ).get('shelfdeck') || null,
    policyCount: names.has('libra_field_intake_admission_policies')
      ? database.prepare('SELECT COUNT(*) AS count FROM libra_field_intake_admission_policies').get().count
      : 0,
    tokenCount: names.has('libra_predeck_pipeline_tokens')
      ? database.prepare('SELECT COUNT(*) AS count FROM libra_predeck_pipeline_tokens').get().count
      : 0,
  });
}

function applyMigration(database, nowMs) {
  const before = inspect(database);
  database.pragma('foreign_keys = OFF');
  const tx = database.transaction(() => {
    for (const statement of MIGRATION_DDL) database.exec(statement);
    const catalogDigest = digest(catalogRows(database));
    const updated = database.prepare(`
      UPDATE platform_schema_marker
         SET schema_digest = ?,
             catalog_digest = ?,
             applied_at_ms = ?
       WHERE schema_name = ?
         AND generation = ?
    `).run(schemaManifest.ddlDigest, catalogDigest, nowMs, 'shelfdeck', 'helix-clean-v3');
    if (updated.changes !== 1) {
      throw new Error('Failed to update platform_schema_marker for Pre-deck pipeline migration.');
    }
  });
  tx();
  database.pragma('foreign_keys = ON');
  return Object.freeze({ before, after: inspect(database), schemaDigest: schemaManifest.ddlDigest });
}

function main(argv = process.argv.slice(2)) {
  const dataDir = path.resolve(valueAfter(argv, '--data-dir')
    || process.env.MEDIA_SERVICE_DATA_DIR
    || path.join(__dirname, '..', 'data'));
  const dbPath = path.join(dataDir, 'shelfdeck.db');
  if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
  const database = new Database(dbPath);
  try {
    if (argv.includes('--plan') || !argv.includes('--apply')) {
      return Object.freeze({
        operation: 'predeck_pipeline_migration',
        confirmationRequired: CONFIRMATION,
        dataDir,
        inspect: inspect(database),
        targetSchemaDigest: schemaManifest.ddlDigest,
      });
    }
    if (valueAfter(argv, '--confirm') !== CONFIRMATION) {
      throw new Error('P14_PREDECK_PIPELINE_MIGRATION_CONFIRMATION_REQUIRED');
    }
    database.pragma('foreign_keys = ON');
    const result = applyMigration(database, Date.now());
    const integrity = database.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`Integrity check failed: ${integrity}`);
    return Object.freeze({ applied: true, dataDir, result });
  } finally {
    database.close();
  }
}

try {
  process.stdout.write(`${JSON.stringify(main(), null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    error: { code: error.message, message: error.message, details: error.details || null },
  }, null, 2)}\n`);
  process.exitCode = 1;
}

module.exports = Object.freeze({ inspect, applyMigration, CONFIRMATION });
