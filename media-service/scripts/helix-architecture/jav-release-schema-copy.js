'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { digest } = require('../../src/helix/foundation/persistence/ddl-compiler');
const { openSqliteKernel, verifyReadOnlySqliteSnapshot } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const persistenceRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence');

const SOURCE_DIGEST = 'c00f45c15c5540e158a688c32fd4b57fdbc146b1a28067f0ac7fe82c496d0d5d';
const TARGET_DIGEST = 'ccef6a14c90620fa9e861ce9f860f66b5b92146f1028cc40467cc614715a9f90';
const EXTRA_COLUMNS = Object.freeze({
  libra_product_identity_selection_intents: ['selection_record_schema_ref', 'selection_record_json'],
  proc_candidate_packages: ['jav_part_set_schema_ref', 'jav_part_set_json'],
});
const EXTRA_TABLES = ['arca_jav_correction_directory_checks', 'arca_jav_correction_recovery_intents', 'arca_jav_identity_corrections'];
const TERMINAL_STATES = Object.freeze({
  proc_procurement_runs: ['state', ['sealed']],
  libra_runs: ['state', ['completed', 'discarded', 'superseded']],
  arca_ondeck_runs: ['state', ['committed']],
  arca_acceptance_attempts: ['state', ['accepted', 'rejected']],
  arca_acceptance_recovery_cases: ['recovery_state', ['resolved']],
  arca_aftercare_cases: ['state', ['resolved', 'invalidated', 'unresolved']],
  arca_offdeck_cases: ['state', ['completed']],
  arca_deregistrations: ['state', ['committed']],
  fx_supporting_works: ['state', ['succeeded', 'failed', 'cancelled']],
  fx_work_attempts: ['state', ['succeeded', 'failed', 'cancelled']],
  fx_workflow_events: ['state', ['succeeded', 'skipped', 'failed', 'cancelled']],
  fx_event_attempts: ['state', ['completed']],
  fx_effect_journal: ['state', ['committed', 'failed']],
  fx_outbox: ['state', ['fully_acked', 'tombstoned']],
});
function fail(code, message, details = {}) { throw Object.assign(new Error(message), { code, details }); }
const normalizedPath = value => process.platform === 'win32' ? value.toLowerCase() : value;
function snapshotPath(value) {
  const resolved = path.resolve(value), stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 ||
      normalizedPath(resolved) !== normalizedPath(fs.realpathSync(resolved)))
    fail('JAV_SCHEMA_PATH_UNSAFE', 'Snapshot must be a regular file without symbolic or hard-link aliases.');
  return resolved;
}
function quote(value) {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) fail('JAV_SCHEMA_IDENTIFIER_INVALID', 'Schema identifier is invalid.');
  return '"' + value + '"';
}
function sourceSchema() {
  const root = path.join(persistenceRoot, 'release-schemas');
  const schemaDdl = zlib.gunzipSync(fs.readFileSync(path.join(root, SOURCE_DIGEST + '.sql.gz'))).toString('utf8');
  const schemaManifest = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, SOURCE_DIGEST + '.manifest.json.gz'))));
  if (digest(schemaDdl) !== SOURCE_DIGEST || schemaManifest.ddlDigest !== SOURCE_DIGEST)
    fail('JAV_SCHEMA_ARCHIVE_INVALID', 'Frozen source schema archive is invalid.');
  return { schemaDdl, schemaManifest };
}
function targetSchema() {
  const schemaManifest = require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
  const schemaDdl = fs.readFileSync(path.join(persistenceRoot, 'generated/clean-schema.sql'), 'utf8');
  if (schemaManifest.ddlDigest !== TARGET_DIGEST || digest(schemaDdl) !== TARGET_DIGEST)
    fail('JAV_SCHEMA_TARGET_DRIFT', 'Release preparation requires its exact frozen target schema.');
  return { schemaDdl, schemaManifest };
}
function verifyDifference(source, target) {
  const added = target.tables.filter(t => !source.tables.some(s => s.tableId === t.tableId)).map(t => t.tableId).sort();
  if (source.tableCount !== 200 || target.tableCount !== 203 || JSON.stringify(added) !== JSON.stringify(EXTRA_TABLES))
    fail('JAV_SCHEMA_DIFFERENCE_INVALID', 'Release table set differs from its frozen scope.');
  for (const old of source.tables) {
    const current = target.tables.find(t => t.tableId === old.tableId), extras = EXTRA_COLUMNS[old.tableId] || [];
    if (!current || JSON.stringify(current.columns.filter(c => !extras.includes(c))) !== JSON.stringify(old.columns) ||
      extras.some(c => !current.columns.includes(c)) || JSON.stringify(old.indexes) !== JSON.stringify(current.indexes) ||
      (!extras.length && old.sqlDigest !== current.sqlDigest))
      fail('JAV_SCHEMA_DIFFERENCE_INVALID', 'Release columns or indexes differ from their frozen scope.', { tableId: old.tableId });
  }
}
function sourceBlockers(database) {
  return Object.entries(TERMINAL_STATES).flatMap(([tableId, [column, states]]) => {
    const count = database.prepare('SELECT count(*) AS n FROM ' + quote(tableId) + ' WHERE ' + quote(column) +
      ' IS NULL OR ' + quote(column) + ' NOT IN (' + states.map(() => '?').join(',') + ')').get(...states).n;
    return count ? [{ tableId, count }] : [];
  });
}
function openSnapshot(Database, databasePath, schema) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    database.exec('BEGIN');
    const proof = verifyReadOnlySqliteSnapshot({ database, ...schema });
    return { database, proof };
  } catch (error) { database.close(); throw error; }
}
function rowDigest(database, table) {
  const hash = crypto.createHash('sha256'), columns = table.columns.map(quote).join(',');
  let count = 0;
  for (const row of database.prepare('SELECT ' + columns + ' FROM ' + quote(table.tableId) + ' ORDER BY ' + columns).safeIntegers().iterate()) {
    const values = table.columns.map(column => {
      const value = row[column];
      return [column, typeof value === 'bigint' ? ['integer', value.toString()] : Buffer.isBuffer(value)
        ? ['blob', value.toString('hex')] : value === null ? ['null'] : [typeof value, value]];
    });
    hash.update(JSON.stringify(values) + '\n'); count++;
  }
  return { tableId: table.tableId, rowCount: count, rowDigest: hash.digest('hex') };
}
function inspectJavSchemaSource({ Database, sourcePath }) {
  sourcePath = snapshotPath(sourcePath);
  const source = sourceSchema(), target = targetSchema();
  verifyDifference(source.schemaManifest, target.schemaManifest);
  const snapshot = openSnapshot(Database, sourcePath, source);
  try {
    const blockers = sourceBlockers(snapshot.database);
    return { eligible: blockers.length === 0, source: snapshot.proof, targetSchemaDigest: TARGET_DIGEST, blockers };
  } finally { snapshot.database.close(); }
}
function prepareJavSchemaCopy({ Database, sourcePath, targetPath, now = Date.now }) {
  sourcePath = snapshotPath(sourcePath); targetPath = path.resolve(targetPath);
  const parent = path.dirname(targetPath), realParent = fs.realpathSync(parent);
  if (normalizedPath(parent) !== normalizedPath(realParent))
    fail('JAV_SCHEMA_PATH_UNSAFE', 'Source and output paths must not use symbolic links.');
  if ([targetPath, targetPath + '-wal', targetPath + '-shm'].some(p => fs.existsSync(p)))
    fail('JAV_SCHEMA_TARGET_EXISTS', 'Release copy must not overwrite an existing target.');
  const source = sourceSchema(), target = targetSchema();
  verifyDifference(source.schemaManifest, target.schemaManifest);
  const snapshot = openSnapshot(Database, sourcePath, source);
  let database, temporaryPath;
  try {
    const blockers = sourceBlockers(snapshot.database);
    if (blockers.length) fail('JAV_SCHEMA_UNFINISHED_RESPONSIBILITY', 'Unfinished responsibilities require their own authorized handling.', { blockers });
    temporaryPath = path.join(parent, '.jav-schema-preparing-' + crypto.randomUUID() + '.sqlite');
    fs.closeSync(fs.openSync(temporaryPath, 'wx'));
    const kernel = openSqliteKernel({ Database, databasePath: temporaryPath, ...target, now }); kernel.close();
    database = new Database(temporaryPath);
    database.pragma('foreign_keys = OFF'); database.exec('BEGIN IMMEDIATE');
    const tableProofs = [];
    for (const table of source.schemaManifest.tables.filter(t => t.tableId !== 'platform_schema_marker')) {
      const columns = table.columns.map(quote).join(','), insert = database.prepare('INSERT INTO ' + quote(table.tableId) +
        ' (' + columns + ') VALUES (' + table.columns.map(() => '?').join(',') + ')');
      for (const row of snapshot.database.prepare('SELECT ' + columns + ' FROM ' + quote(table.tableId)).safeIntegers().iterate())
        insert.run(...table.columns.map(column => row[column]));
      const before = rowDigest(snapshot.database, table), after = rowDigest(database, table);
      if (JSON.stringify(before) !== JSON.stringify(after)) fail('JAV_SCHEMA_COPY_MISMATCH', 'Copied rows differ from their source.', { tableId: table.tableId });
      tableProofs.push(before);
    }
    if (database.pragma('foreign_key_check').length || database.pragma('integrity_check')[0]?.integrity_check !== 'ok')
      fail('JAV_SCHEMA_COPY_INTEGRITY_FAILED', 'Copied database failed independent integrity verification.');
    database.exec('COMMIT');
    // A release artifact is a checkpointed standalone file. Runtime admission
    // enables and independently verifies WAL when this copy is later opened.
    if (database.pragma('journal_mode = DELETE', { simple: true }) !== 'delete')
      fail('JAV_SCHEMA_COPY_CHECKPOINT_FAILED', 'Prepared copy could not become a standalone SQLite snapshot.');
    database.close(); database = null;
    const check = openSnapshot(Database, temporaryPath, target);
    let targetProof;
    try { targetProof = check.proof; } finally { check.database.close(); }
    const descriptor = fs.openSync(temporaryPath, 'r+'); try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    // Atomic, exclusive publication on both NTFS and Linux; never replace a target.
    try { fs.linkSync(temporaryPath, targetPath); }
    catch (error) { if (error.code === 'EEXIST') fail('JAV_SCHEMA_TARGET_EXISTS', 'Output was occupied before publication.'); throw error; }
    if (process.platform === 'linux') {
      const directory = fs.openSync(parent, 'r'); try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    }
    return { prepared: true, source: snapshot.proof, target: targetProof, tableProofs,
      copiedTableCount: tableProofs.length, sourceMode: 'readonly_snapshot' };
  } finally {
    if (database?.inTransaction) database.exec('ROLLBACK'); database?.close(); snapshot.database.close();
    if (temporaryPath && fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}
function verifyJavSchemaRollback({ Database, sourcePath, upgradedPath }) {
  sourcePath = snapshotPath(sourcePath); upgradedPath = snapshotPath(upgradedPath);
  const source = sourceSchema(), target = targetSchema(); verifyDifference(source.schemaManifest, target.schemaManifest);
  const original = openSnapshot(Database, sourcePath, source);
  let upgraded;
  try {
    upgraded = openSnapshot(Database, upgradedPath, target);
    for (const tableId of EXTRA_TABLES) if (upgraded.database.prepare('SELECT count(*) AS n FROM ' + quote(tableId)).get().n)
      fail('JAV_SCHEMA_ROLLBACK_CHANGED_FACTS', 'New JAV facts prohibit baseline rollback.', { tableId });
    for (const [tableId, columns] of Object.entries(EXTRA_COLUMNS))
      if (upgraded.database.prepare('SELECT count(*) AS n FROM ' + quote(tableId) + ' WHERE ' + columns.map(c => quote(c) + ' IS NOT NULL').join(' OR ')).get().n)
        fail('JAV_SCHEMA_ROLLBACK_CHANGED_FACTS', 'New JAV records prohibit baseline rollback.', { tableId });
    const proofs = source.schemaManifest.tables.filter(t => t.tableId !== 'platform_schema_marker').map(table => {
      const before = rowDigest(original.database, table), after = rowDigest(upgraded.database, table);
      if (JSON.stringify(before) !== JSON.stringify(after)) fail('JAV_SCHEMA_ROLLBACK_CHANGED_FACTS', 'Changed facts prohibit baseline rollback.', { tableId: table.tableId });
      return before;
    });
    return { eligible: true, verifiedTableCount: proofs.length, applied: false };
  } finally { upgraded?.database.close(); original.database.close(); }
}
module.exports = Object.freeze({ SOURCE_DIGEST, TARGET_DIGEST, inspectJavSchemaSource, prepareJavSchemaCopy, verifyJavSchemaRollback });
