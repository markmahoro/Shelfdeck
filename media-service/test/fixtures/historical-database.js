'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const Database = require('better-sqlite3');
const { digest } = require('../../src/helix/foundation/persistence/ddl-compiler');
const { TARGET_GENERATION } = require('../../src/helix/foundation/persistence/uat-identity-selection-migration');
const root = path.join(__dirname, 'helix-historical-ddl');

function historicalDatabase(databasePath, ddlDigest) {
  const manifest = require('./helix-historical-ddl/manifest.json');
  const snapshot = manifest.snapshots.find(item => item.ddlDigest === ddlDigest);
  assert.ok(snapshot, 'An exact historical DDL snapshot is required.');
  const bytes = zlib.gunzipSync(fs.readFileSync(path.join(root, snapshot.file)));
  assert.equal(bytes.length, snapshot.uncompressedBytes);
  const ddl = bytes.toString('utf8');
  assert.equal(digest(ddl), ddlDigest);
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  try {
    db.exec(ddl);
    const catalog = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name")
      .all().map(row => ({ ...row, sql: row.sql && row.sql.replaceAll('\r\n', '\n') }));
    db.prepare('INSERT INTO platform_schema_marker(schema_name,generation,schema_digest,catalog_digest,applied_at_ms) VALUES(?,?,?,?,?)')
      .run('shelfdeck', TARGET_GENERATION, ddlDigest, digest(catalog), 100);
    return db;
  } catch (error) { db.close(); throw error; }
}
module.exports = { historicalDatabase };
