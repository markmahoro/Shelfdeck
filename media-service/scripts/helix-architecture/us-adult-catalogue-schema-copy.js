'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { digest } = require('../../src/helix/foundation/persistence/ddl-compiler');
const { openSqliteKernel, verifyReadOnlySqliteSnapshot } = require('../../src/helix/foundation/persistence/sqlite-kernel');

const SOURCE_DIGEST = '906ecacce4d6de62e875d1293cec93dd198564c1c53e2f7f7979d75b2eac2d0a';
const TARGET_DIGEST = '572bd48d999c83c86ffd5c2ccc496e7177b14df2edfd09ebcffadf56e2706cb9';
const EXTRA_TABLES = Object.freeze([
  'libra_us_adult_catalogue_actor_decisions',
  'libra_us_adult_catalogue_bases',
  'people_us_adult_catalogue_registration_origins',
]);
const CHANGED_TABLE = 'people_person_revisions';
const fail = (code, message, details = {}) => { throw Object.assign(new Error(message), { code, details }); };
const normalized = value => process.platform === 'win32' ? value.toLowerCase() : value;
const quote = value => {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) fail('CATALOGUE_SCHEMA_IDENTIFIER', 'Invalid declared identifier.');
  return '"' + value + '"';
};

function regular(file) {
  file = path.resolve(file);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || normalized(fs.realpathSync(file)) !== normalized(file))
    fail('CATALOGUE_SCHEMA_PATH_UNSAFE', 'Use a regular standalone snapshot without aliases.');
  return file;
}

function schemas() {
  const root = path.resolve(__dirname, '../../src/helix/foundation/persistence');
  const load = expected => {
    const archive = path.join(root, 'release-schemas', expected);
    const schemaDdl = zlib.gunzipSync(fs.readFileSync(archive + '.sql.gz')).toString('utf8');
    const schemaManifest = JSON.parse(zlib.gunzipSync(fs.readFileSync(archive + '.manifest.json.gz')));
    if (digest(schemaDdl) !== expected || schemaManifest.ddlDigest !== expected)
      fail('CATALOGUE_SCHEMA_ARCHIVE_DRIFT', 'Frozen schema archive digest changed.', { expected });
    return { schemaDdl, schemaManifest };
  };
  const source = load(SOURCE_DIGEST), target = load(TARGET_DIGEST);
  const added = target.schemaManifest.tables
    .filter(table => !source.schemaManifest.tables.some(old => old.tableId === table.tableId))
    .map(table => table.tableId).sort();
  if (source.schemaManifest.tableCount !== 239 || target.schemaManifest.tableCount !== 242 ||
      JSON.stringify(added) !== JSON.stringify([...EXTRA_TABLES].sort()))
    fail('CATALOGUE_SCHEMA_SCOPE_DRIFT', 'Only the three catalogue tables may be added.');

  let expected = source.schemaDdl
    .replace(
      'CHECK ("origin_kind" IN (\'direct\', \'candidate\')),',
      'CHECK ("origin_kind" IN (\'direct\', \'candidate\', \'catalogue_auto\')),'
    )
    .replace(
      'CHECK (("origin_kind" = \'direct\' AND',
      'CHECK (("origin_kind" IN (\'direct\', \'catalogue_auto\') AND'
    );
  let preserved = target.schemaDdl;
  for (const name of EXTRA_TABLES) {
    const match = preserved.match(new RegExp('CREATE TABLE "' + name + '" [\\s\\S]*?\\n\\);\\n(?:CREATE [^\\n]+\\n)*\\n'));
    if (!match) fail('CATALOGUE_SCHEMA_SCOPE_DRIFT', 'Declared catalogue table DDL is missing.', { tableId: name });
    preserved = preserved.replace(match[0], '');
  }
  if (preserved !== expected)
    fail('CATALOGUE_SCHEMA_SCOPE_DRIFT', 'Only people_person_revisions CHECK and the three empty catalogue tables may change.');

  for (const old of source.schemaManifest.tables) {
    const next = target.schemaManifest.tables.find(row => row.tableId === old.tableId);
    if (!next || JSON.stringify(old.columns) !== JSON.stringify(next.columns) ||
        JSON.stringify(old.indexes) !== JSON.stringify(next.indexes) ||
        old.owner !== next.owner || old.immutable !== next.immutable ||
        (old.tableId !== CHANGED_TABLE && old.sqlDigest !== next.sqlDigest) ||
        (old.tableId === CHANGED_TABLE && old.sqlDigest === next.sqlDigest))
      fail('CATALOGUE_SCHEMA_SCOPE_DRIFT', 'Retained schema changed outside the catalogue upgrade scope.', { tableId: old.tableId });
  }
  return { source, target };
}

function open(Database, file, schema) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try { db.exec('BEGIN'); return { db, proof: verifyReadOnlySqliteSnapshot({ database: db, ...schema }) }; }
  catch (error) { db.close(); throw error; }
}

function rowsDigest(db, table) {
  const columns = table.columns.map(quote);
  const keys = db.prepare('PRAGMA table_info(' + quote(table.tableId) + ')').all()
    .filter(row => row.pk).sort((a, b) => a.pk - b.pk).map(row => quote(row.name));
  const hash = crypto.createHash('sha256');
  let rowCount = 0;
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

function prepareUsAdultCatalogueSchemaCopy({ Database, sourcePath, targetPath, rollback = false, now = Date.now }) {
  sourcePath = regular(sourcePath);
  targetPath = path.resolve(targetPath);
  const parent = path.dirname(targetPath), frozen = schemas();
  if (normalized(fs.realpathSync(parent)) !== normalized(parent) ||
      [targetPath, targetPath + '-wal', targetPath + '-shm', targetPath + '-journal'].some(file => fs.existsSync(file)))
    fail('CATALOGUE_SCHEMA_TARGET_UNSAFE', 'Use a new output in a real existing directory.');
  if (rollback) {
    const probe = new Database(sourcePath, { readonly: true, fileMustExist: true });
    try {
      for (const tableId of EXTRA_TABLES)
        if (probe.prepare('SELECT 1 FROM ' + quote(tableId) + ' LIMIT 1').get())
          fail('CATALOGUE_SCHEMA_ROLLBACK_NEW_FACTS', 'Catalogue facts prohibit removing their owner tables.', { tableId });
      if (probe.prepare("SELECT 1 FROM people_person_revisions WHERE origin_kind = 'catalogue_auto' LIMIT 1").get())
        fail('CATALOGUE_SCHEMA_ROLLBACK_NEW_FACTS', 'catalogue_auto Person revisions prohibit baseline rollback.');
    } finally { probe.close(); }
  }
  const original = open(Database, sourcePath, rollback ? frozen.target : frozen.source);
  let db, temporary;
  try {
    const target = rollback ? frozen.source : frozen.target;
    temporary = path.join(parent, '.us-adult-catalogue-schema-preparing-' + crypto.randomUUID() + '.sqlite');
    fs.closeSync(fs.openSync(temporary, 'wx'));
    openSqliteKernel({ Database, databasePath: temporary, ...target, now }).close();
    db = new Database(temporary);
    db.pragma('foreign_keys=OFF');
    db.exec('BEGIN IMMEDIATE');
    const tableProofs = [];
    for (const table of frozen.source.schemaManifest.tables.filter(row => row.tableId !== 'platform_schema_marker')) {
      const insert = db.prepare('INSERT INTO ' + quote(table.tableId) + ' (' + table.columns.map(quote).join(',') +
        ') VALUES (' + table.columns.map(() => '?').join(',') + ')');
      for (const row of original.db.prepare('SELECT ' + table.columns.map(quote).join(',') + ' FROM ' + quote(table.tableId)).safeIntegers().iterate())
        insert.run(...table.columns.map(column => row[column]));
      const before = rowsDigest(original.db, table), after = rowsDigest(db, table);
      if (JSON.stringify(before) !== JSON.stringify(after))
        fail('CATALOGUE_SCHEMA_COPY_MISMATCH', 'Original row values changed.', { tableId: table.tableId });
      tableProofs.push(before);
    }
    for (const tableId of EXTRA_TABLES)
      if (!rollback && db.prepare('SELECT count(*) n FROM ' + quote(tableId)).get().n)
        fail('CATALOGUE_SCHEMA_COPY_MISMATCH', 'New catalogue tables must start empty.', { tableId });
    if (db.pragma('foreign_key_check').length || db.pragma('integrity_check')[0]?.integrity_check !== 'ok')
      fail('CATALOGUE_SCHEMA_INTEGRITY', 'Prepared copy failed integrity checks.');
    db.exec('COMMIT');
    db.pragma('journal_mode=DELETE');
    db.close();
    db = null;
    const checked = open(Database, temporary, target);
    let proof;
    try { proof = checked.proof; } finally { checked.db.close(); }
    const fd = fs.openSync(temporary, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.linkSync(temporary, targetPath);
    if (process.platform === 'linux') {
      const directory = fs.openSync(parent, 'r');
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    }
    return {
      operatorVersion: 1,
      prepared: true,
      rollback,
      applied: false,
      sourceMode: 'readonly_snapshot',
      source: original.proof,
      target: proof,
      copiedTableCount: tableProofs.length,
      tableProofs,
      addedTables: EXTRA_TABLES,
      changedTable: CHANGED_TABLE,
    };
  } finally {
    if (db?.inTransaction) db.exec('ROLLBACK');
    db?.close();
    original.db.close();
    if (temporary && fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

module.exports = Object.freeze({
  SOURCE_DIGEST,
  TARGET_DIGEST,
  EXTRA_TABLES,
  CHANGED_TABLE,
  schemas,
  prepareUsAdultCatalogueSchemaCopy,
});
