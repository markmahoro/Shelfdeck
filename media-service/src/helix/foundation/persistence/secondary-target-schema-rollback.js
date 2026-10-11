'use strict';

const { digest } = require('./ddl-compiler');
const { TARGET_GENERATION, PRE_SECONDARY_TARGET_SCHEMA_DIGEST } =
  require('./uat-identity-selection-migration');
// This recovery tool only reverses the historical 197-table enum change.
// Later migrations must never widen its accepted source schema.
const SECONDARY_TARGET_SCHEMA_DIGEST = '14c18e017bfce8b78230d0509be1c46fb11c0da95a240396628173a9e71bed73';

function requireProof(value, code) {
  if (!value) throw Object.assign(new Error(code), { code });
}
function quote(name) { return '"' + name.replaceAll('"', '""') + '"'; }
function catalog(database) {
  return database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name")
    .all().map(row => ({ ...row, sql: row.sql && row.sql.replaceAll('\r\n', '\n') }));
}
function equalTableRows(database, baseline, table) {
  const columns = database.prepare('PRAGMA table_info(' + quote(table) + ')').all().map(row => quote(row.name));
  const query = 'SELECT * FROM ' + quote(table) + ' ORDER BY ' + columns.join(',');
  const current = database.prepare(query).safeIntegers(true).iterate();
  const original = baseline.prepare(query).safeIntegers(true).iterate();
  const serialize = row => JSON.stringify(row, (_key, value) => typeof value === 'bigint' ? { integer: value.toString() } : value);
  try {
    while (true) {
      const left = current.next(), right = original.next();
      if (left.done || right.done) return left.done === right.done;
      if (serialize(left.value) !== serialize(right.value)) return false;
    }
  } finally { current.return(); original.return(); }
}

// Offline release recovery only. A baseline is evidence, never a source of
// replacement business rows. Any change since that baseline blocks rollback.
function rollbackSecondaryTargetSchema({ Database, databasePath, baselinePath, apply = false }) {
  requireProof(databasePath !== baselinePath, 'UAT_ROLLBACK_DISTINCT_BASELINE_REQUIRED');
  const baseline = new Database(baselinePath, { readonly: true, fileMustExist: true });
  const database = new Database(databasePath, { fileMustExist: true });
  try {
    baseline.exec('BEGIN');
    database.pragma('foreign_keys = OFF');
    database.exec('BEGIN EXCLUSIVE');
    const oldMarkers = baseline.prepare('SELECT * FROM platform_schema_marker').all();
    const newMarkers = database.prepare('SELECT * FROM platform_schema_marker').all();
    const old = oldMarkers[0], current = newMarkers[0];
    requireProof(oldMarkers.length === 1 && newMarkers.length === 1 && old.schema_name === 'shelfdeck' &&
      current.schema_name === old.schema_name && old.generation === TARGET_GENERATION && current.generation === TARGET_GENERATION &&
      old.schema_digest === PRE_SECONDARY_TARGET_SCHEMA_DIGEST && current.schema_digest === SECONDARY_TARGET_SCHEMA_DIGEST,
    'UAT_ROLLBACK_EXACT_SCHEMA_REQUIRED');
    const before = catalog(baseline), upgraded = catalog(database);
    requireProof(digest(before) === old.catalog_digest && digest(upgraded) === current.catalog_digest,
      'UAT_ROLLBACK_CATALOG_CORRUPT');
    const normalized = upgraded.map(row => row.name === 'libra_run_revisions' && row.type === 'table'
      ? { ...row, sql: row.sql.replace("'frozen', 'secondary_target', 'defect_admitted'", "'frozen', 'defect_admitted'") } : row);
    requireProof(JSON.stringify(normalized) === JSON.stringify(before), 'UAT_ROLLBACK_UNEXPECTED_DDL');
    const tables = before.filter(row => row.type === 'table');
    requireProof(tables.length === 197, 'UAT_ROLLBACK_UNEXPECTED_TABLE_SET');
    for (const table of tables.filter(row => row.name !== 'platform_schema_marker')) {
      requireProof(equalTableRows(database, baseline, table.name),
        'UAT_ROLLBACK_NEW_OR_CHANGED_FACTS');
    }
    requireProof(database.pragma('foreign_key_check').length === 0 && baseline.pragma('foreign_key_check').length === 0,
      'UAT_ROLLBACK_FOREIGN_KEY_VIOLATION');
    if (!apply) {
      database.exec('ROLLBACK');
      return Object.freeze({ eligible: true, applied: false, verifiedTables: tables.length });
    }
    database.exec('CREATE TEMP TABLE rollback_revision_backup AS SELECT * FROM libra_run_revisions');
    database.exec('DROP TABLE libra_run_revisions');
    database.exec(before.find(row => row.name === 'libra_run_revisions' && row.type === 'table').sql);
    database.exec('INSERT INTO libra_run_revisions SELECT * FROM rollback_revision_backup');
    for (const row of before.filter(row => row.tbl_name === 'libra_run_revisions' && row.type !== 'table' && row.sql)) database.exec(row.sql);
    database.exec('DROP TABLE temp.rollback_revision_backup');
    requireProof(digest(catalog(database)) === old.catalog_digest && database.pragma('foreign_key_check').length === 0,
      'UAT_ROLLBACK_RESTORATION_FAILED');
    database.prepare('UPDATE platform_schema_marker SET generation=?,schema_digest=?,catalog_digest=?,applied_at_ms=? WHERE schema_name=?')
      .run(old.generation, old.schema_digest, old.catalog_digest, old.applied_at_ms, old.schema_name);
    database.exec('COMMIT');
    return Object.freeze({ eligible: true, applied: true, verifiedTables: tables.length });
  } finally {
    if (database.inTransaction) database.exec('ROLLBACK');
    if (baseline.inTransaction) baseline.exec('ROLLBACK');
    database.close(); baseline.close();
  }
}

module.exports = Object.freeze({ rollbackSecondaryTargetSchema, SECONDARY_TARGET_SCHEMA_DIGEST });
