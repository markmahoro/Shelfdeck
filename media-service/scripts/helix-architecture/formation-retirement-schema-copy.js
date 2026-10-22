'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { digest } = require('../../src/helix/foundation/persistence/ddl-compiler');
const { openSqliteKernel, verifyReadOnlySqliteSnapshot } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const SOURCE_DIGEST = '4549671e37bedb285feb0bb6dc08d9e431aa040136bd9ee668de248a2f0782a6';
const TARGET_DIGEST = '40dfcbb6a6a64294098c72093ba03ce61e6696c5fb8d162b76a3272af73f409c';
const RETIRED = ['administratively_retired'];
const EXTENSIONS = Object.freeze({
  arca_acceptance_attempts: { state: RETIRED },
  arca_acceptance_recovery_cases: { recovery_state: RETIRED },
  arca_ondeck_runs: { state: RETIRED },
  libra_formation_projections: { subject_status: [...RETIRED, 'ended'], current_libra_run_state: RETIRED },
  libra_run_revisions: { state: RETIRED, transition_kind: RETIRED },
  libra_runs: { state: RETIRED },
  libra_subjects: { status: [...RETIRED, 'ended'] },
  libra_workspace_cleanup_scopes: { trigger_kind: ['run_administratively_retired'] },
  proc_candidate_deliveries: { state: RETIRED },
  proc_run_materials: { terminal_disposition: RETIRED },
});
const fail = (code, message, details = {}) => { throw Object.assign(new Error(message), { code, details }); };
const normalized = value => process.platform === 'win32' ? value.toLowerCase() : value;
const quote = value => {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) fail('RESET_SCHEMA_IDENTIFIER', 'Invalid declared identifier.');
  return '"' + value + '"';
};
function regular(file) {
  file = path.resolve(file);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || normalized(fs.realpathSync(file)) !== normalized(file))
    fail('RESET_SCHEMA_PATH_UNSAFE', 'Use a regular standalone snapshot without aliases.');
  return file;
}
function schemas() {
  const root = path.resolve(__dirname, '../../src/helix/foundation/persistence');
  const schemaDdl = zlib.gunzipSync(fs.readFileSync(path.join(root, 'release-schemas', SOURCE_DIGEST + '.sql.gz'))).toString('utf8');
  const schemaManifest = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, 'release-schemas', SOURCE_DIGEST + '.manifest.json.gz'))));
  const target = { schemaDdl: fs.readFileSync(path.join(root, 'generated/clean-schema.sql'), 'utf8'),
    schemaManifest: JSON.parse(fs.readFileSync(path.join(root, 'generated/clean-schema.manifest.json'), 'utf8')) };
  if (digest(schemaDdl) !== SOURCE_DIGEST || schemaManifest.ddlDigest !== SOURCE_DIGEST ||
      digest(target.schemaDdl) !== TARGET_DIGEST || target.schemaManifest.ddlDigest !== TARGET_DIGEST)
    fail('RESET_SCHEMA_ARCHIVE_DRIFT', 'The exact qualified source and target schema are required.');
  let table = null;
  const found = new Set();
  const expected = schemaDdl.split('\n').map(line => {
    const header = /^CREATE TABLE "([a-z_]+)"/.exec(line);
    if (header) table = header[1];
    const column = /^  "([a-z_]+)" TEXT CHECK/.exec(line)?.[1];
    const added = EXTENSIONS[table]?.[column];
    if (!added) return line;
    found.add(table + '.' + column);
    if (!line.endsWith(')),') || !line.includes(' IN (')) fail('RESET_SCHEMA_SCOPE_DRIFT', 'Declared CHECK shape changed.');
    return line.slice(0, -3) + added.map(value => ", '" + value + "'").join('') + ')),';
  }).join('\n');
  if (expected !== target.schemaDdl || found.size !== Object.values(EXTENSIONS).reduce((n, item) => n + Object.keys(item).length, 0) ||
      schemaManifest.tableCount !== 231 || target.schemaManifest.tableCount !== 231)
    fail('RESET_SCHEMA_SCOPE_DRIFT', 'Only the declared terminal-state CHECK extensions may change.');
  for (const old of schemaManifest.tables) {
    const next = target.schemaManifest.tables.find(row => row.tableId === old.tableId);
    if (!next || JSON.stringify(old.columns) !== JSON.stringify(next.columns) || JSON.stringify(old.indexes) !== JSON.stringify(next.indexes) ||
        old.owner !== next.owner || old.immutable !== next.immutable)
      fail('RESET_SCHEMA_SCOPE_DRIFT', 'Existing columns, indexes and ownership must remain unchanged.', { tableId: old.tableId });
  }
  return { source: { schemaDdl, schemaManifest }, target };
}
function open(Database, file, schema) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try { db.exec('BEGIN'); return { db, proof: verifyReadOnlySqliteSnapshot({ database: db, ...schema }) }; }
  catch (error) { db.close(); throw error; }
}
function rowsDigest(db, table) {
  const columns = table.columns.map(quote), keys = db.prepare('PRAGMA table_info(' + quote(table.tableId) + ')').all()
    .filter(row => row.pk).sort((a, b) => a.pk - b.pk).map(row => quote(row.name));
  const hash = crypto.createHash('sha256'); let rowCount = 0;
  for (const row of db.prepare('SELECT ' + columns.join(',') + ' FROM ' + quote(table.tableId) + ' ORDER BY ' +
    (keys.length ? keys : columns).join(',')).safeIntegers().iterate()) {
    hash.update(JSON.stringify(table.columns.map(key => {
      const value = row[key];
      return [key, typeof value === 'bigint' ? ['integer', value.toString()] : Buffer.isBuffer(value) ? ['blob', value.toString('hex')] :
        value === null ? ['null'] : [typeof value, value]];
    })) + '\n');
    rowCount++;
  }
  return { tableId: table.tableId, rowCount, rowDigest: hash.digest('hex') };
}
function prepareFormationRetirementSchemaCopy({ Database, sourcePath, targetPath, rollback = false, now = Date.now }) {
  sourcePath = regular(sourcePath); targetPath = path.resolve(targetPath);
  const parent = path.dirname(targetPath), frozen = schemas();
  if (normalized(fs.realpathSync(parent)) !== normalized(parent) ||
      [targetPath, targetPath + '-wal', targetPath + '-shm', targetPath + '-journal'].some(file => fs.existsSync(file)))
    fail('RESET_SCHEMA_TARGET_UNSAFE', 'Use a new output in a real existing directory.');
  const original = open(Database, sourcePath, rollback ? frozen.target : frozen.source);
  let db, temporary;
  try {
    if (rollback) {
      for (const [table, fields] of Object.entries(EXTENSIONS)) for (const [column, values] of Object.entries(fields))
        if (original.db.prepare('SELECT 1 FROM ' + quote(table) + ' WHERE ' + quote(column) + ' IN (' + values.map(() => '?').join(',') + ') LIMIT 1').get(...values))
          fail('RESET_SCHEMA_ROLLBACK_NEW_FACTS', 'New terminal facts prohibit rollback.', { tableId: table, column });
      if (original.db.prepare("SELECT 1 FROM fx_command_receipts WHERE command_contract IN ('libra.formation-retirement@1','arca.formation-retirement@1','libra.intake-retirement@1','procurement.candidate-retirement@1') LIMIT 1").get())
        fail('RESET_SCHEMA_ROLLBACK_NEW_FACTS', 'Administrative command receipts require their retirement gates.');
    }
    const target = rollback ? frozen.source : frozen.target;
    temporary = path.join(parent, '.formation-schema-preparing-' + crypto.randomUUID() + '.sqlite');
    fs.closeSync(fs.openSync(temporary, 'wx'));
    openSqliteKernel({ Database, databasePath: temporary, ...target, now }).close();
    db = new Database(temporary); db.pragma('foreign_keys=OFF'); db.exec('BEGIN IMMEDIATE');
    const tableProofs = [];
    for (const table of frozen.source.schemaManifest.tables.filter(row => row.tableId !== 'platform_schema_marker')) {
      const insert = db.prepare('INSERT INTO ' + quote(table.tableId) + ' (' + table.columns.map(quote).join(',') + ') VALUES (' + table.columns.map(() => '?').join(',') + ')');
      for (const row of original.db.prepare('SELECT ' + table.columns.map(quote).join(',') + ' FROM ' + quote(table.tableId)).safeIntegers().iterate())
        insert.run(...table.columns.map(column => row[column]));
      const before = rowsDigest(original.db, table), after = rowsDigest(db, table);
      if (JSON.stringify(before) !== JSON.stringify(after)) fail('RESET_SCHEMA_COPY_MISMATCH', 'Original row values changed.', { tableId: table.tableId });
      tableProofs.push(before);
    }
    if (db.pragma('foreign_key_check').length || db.pragma('integrity_check')[0]?.integrity_check !== 'ok')
      fail('RESET_SCHEMA_INTEGRITY', 'Prepared copy failed integrity checks.');
    db.exec('COMMIT'); db.pragma('journal_mode=DELETE'); db.close(); db = null;
    const checked = open(Database, temporary, target); let proof;
    try { proof = checked.proof; } finally { checked.db.close(); }
    const fd = fs.openSync(temporary, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.linkSync(temporary, targetPath);
    if (process.platform === 'linux') {
      const directory = fs.openSync(parent, 'r'); try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    }
    return { operatorVersion: 1, prepared: true, rollback, applied: false, sourceMode: 'readonly_snapshot',
      source: original.proof, target: proof, copiedTableCount: tableProofs.length, tableProofs, extendedChecks: EXTENSIONS };
  } finally {
    if (db?.inTransaction) db.exec('ROLLBACK');
    db?.close(); original.db.close();
    if (temporary && fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
module.exports = Object.freeze({ SOURCE_DIGEST, TARGET_DIGEST, EXTENSIONS, schemas, prepareFormationRetirementSchemaCopy });
