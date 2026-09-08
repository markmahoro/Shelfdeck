'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createReadinessSnapshot } = require('../scripts/create-readiness-snapshot');

test('readiness snapshot includes committed WAL facts without copying runtime payloads or modifying source', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readiness-snapshot-'));
  const source = path.join(root, 'source'), target = path.join(root, 'snapshot');
  fs.mkdirSync(source);
  const database = new Database(path.join(source, 'shelfdeck.db'));
  try {
    database.pragma('journal_mode = WAL');
    database.exec('CREATE TABLE fact(value TEXT); INSERT INTO fact VALUES (\'committed\')');
    fs.writeFileSync(path.join(source, 'admin-credential-secret.json'), '{"test":true}');
    fs.mkdirSync(path.join(source, 'recycle'));
    fs.writeFileSync(path.join(source, 'recycle', 'protected.media'), 'do not copy');
    database.exec('BEGIN; INSERT INTO fact VALUES (\'uncommitted\')');
    await createReadinessSnapshot(source, target);
    const snapshot = new Database(path.join(target, 'shelfdeck.db'));
    try { assert.deepEqual(snapshot.prepare('SELECT value FROM fact').all(), [{ value: 'committed' }]); }
    finally { snapshot.close(); }
    assert.deepEqual(fs.readdirSync(target).sort(), ['admin-credential-secret.json', 'shelfdeck.db']);
    assert.equal(fs.readFileSync(path.join(source, 'recycle', 'protected.media'), 'utf8'), 'do not copy');
    assert.equal(database.prepare('SELECT count(*) AS n FROM fact').get().n, 2);
    await assert.rejects(createReadinessSnapshot(source, target), /READINESS_TARGET_EXISTS/);
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
