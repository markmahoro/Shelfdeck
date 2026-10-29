'use strict';

const crypto = require('node:crypto');
const { canonicalDigest, canonicalJson } = require('../src/helix/contracts/canonical-json');

function fail(code) { throw Object.assign(new Error(code), { code }); }
function identifier(value) {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) fail('RESET_SNAPSHOT_IDENTIFIER_INVALID');
  return '"' + value + '"';
}
function encode(value) {
  return canonicalJson(JSON.parse(JSON.stringify(value, (_key, item) =>
    typeof item === 'bigint' ? { sqliteInteger: item.toString() } : item)));
}

// Preflight approval binds logical records, not SQLite page layout. Closing
// the Host checkpoints its WAL and changes file bytes without changing scope.
// Conversely, changing a discarded row must invalidate approval even when
// retained collection counts and the resulting retained DB stay identical.
function digestResetSnapshot(database) {
  if (!database.readonly || !database.inTransaction) fail('RESET_SNAPSHOT_READONLY_REQUIRED');
  const catalog = database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()
    .map(row => ({ ...row, sql: row.sql?.replaceAll('\r\n', '\n') ?? null }));
  if (catalog.some(row => !['table', 'index'].includes(row.type))) fail('RESET_SNAPSHOT_SCHEMA_UNSUPPORTED');
  const tables = catalog.filter(row => row.type === 'table').map(item => {
    const table = identifier(item.name);
    const primaryKey = database.pragma('table_info(' + table + ')').filter(column => column.pk)
      .sort((a, b) => a.pk - b.pk).map(column => identifier(column.name));
    if (!primaryKey.length) fail('RESET_SNAPSHOT_PRIMARY_KEY_REQUIRED');
    const hash = crypto.createHash('sha256'); hash.update('[');
    let count = 0;
    for (const row of database.prepare('SELECT * FROM ' + table + ' ORDER BY ' + primaryKey.join(',')).safeIntegers().iterate()) {
      if (count++) hash.update(',');
      hash.update(encode(row));
    }
    hash.update(']');
    return { table: item.name, count, digest: hash.digest('hex') };
  });
  const body = { schemaRef: 'formation-reset-source-snapshot@1', catalogDigest: canonicalDigest(catalog), tables };
  return Object.freeze({ ...body, digest: canonicalDigest(body) });
}

module.exports = Object.freeze({ digestResetSnapshot });
