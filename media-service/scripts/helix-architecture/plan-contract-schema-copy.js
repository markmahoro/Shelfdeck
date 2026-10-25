'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { canonicalJson } = require('../../src/helix/contracts/canonical-json');
const { openSqliteKernel, verifyReadOnlySqliteSnapshot } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const ADDED_TABLES = Object.freeze(['fx_execution_contracts', 'fx_plan_contracts', 'fx_plan_history_audits']);
function check(value, code) { if (!value) throw Object.assign(new Error(code), { code }); }
function quote(value) { check(/^[a-z][a-z0-9_]*$/.test(value), 'CONTRACT_COPY_IDENTIFIER'); return '"' + value + '"'; }
function realFile(file) {
  const stat = fs.lstatSync(file);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && path.resolve(fs.realpathSync(file)) === file, 'CONTRACT_COPY_SOURCE_UNSAFE');
}
function rowsDigest(db, table) {
  const names = table.columns, keys = db.prepare('PRAGMA table_info(' + quote(table.tableId) + ')').all()
    .filter(row => row.pk).sort((a, b) => a.pk - b.pk).map(row => row.name);
  const digest = crypto.createHash('sha256'); let count = 0;
  for (const row of db.prepare('SELECT ' + names.map(quote).join(',') + ' FROM ' + quote(table.tableId) +
    ' ORDER BY ' + (keys.length ? keys : names).map(quote).join(',')).safeIntegers().iterate()) {
    digest.update(JSON.stringify(names.map(key => {
      const value = row[key];
      return typeof value === 'bigint' ? ['integer', value.toString()] : Buffer.isBuffer(value) ? ['blob', value.toString('hex')]
        : value === null ? ['null'] : [typeof value, value];
    })) + '\n');
    count++;
  }
  return { tableId: table.tableId, count, digest: digest.digest('hex') };
}
function assertAddition(source, target) {
  const before = new Map(source.schemaManifest.tables.map(table => [table.tableId, table]));
  const added = target.schemaManifest.tables.filter(table => !before.has(table.tableId));
  check(canonicalJson(added.map(table => table.tableId).sort()) === canonicalJson([...ADDED_TABLES].sort()), 'CONTRACT_COPY_SCOPE_DRIFT');
  for (const old of before.values()) check(canonicalJson(old) === canonicalJson(target.schemaManifest.tables.find(table => table.tableId === old.tableId)),
    'CONTRACT_COPY_OLD_TABLE_CHANGED');
  let remaining = target.schemaDdl.replaceAll('\r\n', '\n');
  for (const table of ADDED_TABLES) {
    const expression = new RegExp('CREATE TABLE "' + table + '" \\([\\s\\S]*?\\n\\);\\n(?:CREATE [^\\n]+\\n)*\\n');
    check(expression.test(remaining), 'CONTRACT_COPY_NEW_DDL_MISSING');
    remaining = remaining.replace(expression, '');
  }
  check(remaining === source.schemaDdl.replaceAll('\r\n', '\n'), 'CONTRACT_COPY_EXISTING_DDL_CHANGED');
}

function verifyPreparedCopy({ Database, databasePath, receipt, targetSchema }) {
  check(receipt?.schemaRef === 'shelfdeck.plan-contract-schema-copy@1' && receipt.prepared === true && receipt.applied === false &&
    receipt.target?.schemaDigest === targetSchema.schemaManifest.ddlDigest &&
    canonicalJson(receipt.addedTables) === canonicalJson(ADDED_TABLES), 'CONTRACT_COPY_RECEIPT_INVALID');
  const expected = targetSchema.schemaManifest.tables.filter(table => table.tableId !== 'platform_schema_marker' && !ADDED_TABLES.includes(table.tableId));
  check(Array.isArray(receipt.tables) && receipt.tables.length === expected.length &&
    new Set(receipt.tables.map(row => row.tableId)).size === expected.length, 'CONTRACT_COPY_RECEIPT_SCOPE');
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    database.exec('BEGIN');
    verifyReadOnlySqliteSnapshot({ database, ...targetSchema });
    for (const table of expected) {
      if (canonicalJson(rowsDigest(database, table)) !== canonicalJson(receipt.tables.find(row => row.tableId === table.tableId)))
        throw Object.assign(new Error('Protected facts changed in ' + table.tableId), { code: 'CONTRACT_COPY_PROTECTED_FACT_DRIFT' });
    }
    return { protectedTables: expected.length, verified: true };
  } finally { database.close(); }
}

function preparePlanContractSchemaCopy({ Database, sourcePath, targetPath, sourceSchema, targetSchema, now = Date.now }) {
  sourcePath = path.resolve(sourcePath); targetPath = path.resolve(targetPath); realFile(sourcePath);
  check(fs.realpathSync(path.dirname(targetPath)) === path.dirname(targetPath) &&
    ['', '-wal', '-shm', '-journal'].every(suffix => !fs.existsSync(targetPath + suffix)), 'CONTRACT_COPY_TARGET_UNSAFE');
  assertAddition(sourceSchema, targetSchema);
  const original = new Database(sourcePath, { readonly: true, fileMustExist: true });
  const temporary = path.join(path.dirname(targetPath), '.plan-contract-copy-' + crypto.randomUUID() + '.sqlite');
  let output;
  try {
    original.exec('BEGIN');
    const source = verifyReadOnlySqliteSnapshot({ database: original, ...sourceSchema });
    fs.closeSync(fs.openSync(temporary, 'wx'));
    openSqliteKernel({ Database, databasePath: temporary, ...targetSchema, now }).close();
    output = new Database(temporary); output.pragma('foreign_keys=OFF'); output.exec('BEGIN IMMEDIATE');
    const tables = [];
    for (const table of sourceSchema.schemaManifest.tables.filter(table => table.tableId !== 'platform_schema_marker')) {
      const insert = output.prepare('INSERT INTO ' + quote(table.tableId) + ' (' + table.columns.map(quote).join(',') + ') VALUES (' +
        table.columns.map(() => '?').join(',') + ')');
      for (const row of original.prepare('SELECT ' + table.columns.map(quote).join(',') + ' FROM ' + quote(table.tableId)).safeIntegers().iterate())
        insert.run(...table.columns.map(column => row[column]));
      const before = rowsDigest(original, table), after = rowsDigest(output, table);
      check(canonicalJson(before) === canonicalJson(after), 'CONTRACT_COPY_FACT_DRIFT'); tables.push(before);
    }
    check(output.pragma('foreign_key_check').length === 0 && output.pragma('integrity_check')[0]?.integrity_check === 'ok', 'CONTRACT_COPY_INTEGRITY');
    output.exec('COMMIT'); output.pragma('journal_mode=DELETE'); output.close(); output = null;
    const validated = new Database(temporary, { readonly: true }); let target;
    try { validated.exec('BEGIN'); target = verifyReadOnlySqliteSnapshot({ database: validated, ...targetSchema }); }
    finally { validated.close(); }
    const fd = fs.openSync(temporary, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.linkSync(temporary, targetPath);
    if (process.platform === 'linux') { const fd = fs.openSync(path.dirname(targetPath), 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
    return { schemaRef: 'shelfdeck.plan-contract-schema-copy@1', prepared: true, applied: false,
      source, target, addedTables: ADDED_TABLES, tables };
  } finally {
    if (output?.inTransaction) output.exec('ROLLBACK');
    output?.close(); original.close();
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

module.exports = Object.freeze({ ADDED_TABLES, assertAddition, rowsDigest, verifyPreparedCopy, preparePlanContractSchemaCopy });
