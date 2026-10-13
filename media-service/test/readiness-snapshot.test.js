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

test('closed WAL snapshot preserves source bytes and creates no source auxiliaries', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readiness-closed-wal-'));
  const source = path.join(root, 'source'), target = path.join(root, 'snapshot');
  fs.mkdirSync(source);
  const file = path.join(source, 'shelfdeck.db');
  const database = new Database(file);
  database.pragma('journal_mode = WAL');
  database.exec("CREATE TABLE fact(value TEXT); INSERT INTO fact VALUES ('closed-committed')");
  database.close();
  fs.writeFileSync(path.join(source, 'admin-credential-secret.json'), '{"test":true}');
  const bytes = fs.readFileSync(file);
  try {
    assert.equal(fs.existsSync(file + '-wal'), false);
    await createReadinessSnapshot(source, target);
    assert.deepEqual(fs.readFileSync(file), bytes);
    assert.equal(fs.existsSync(file + '-wal'), false);
    assert.equal(fs.existsSync(file + '-shm'), false);
    const copy = new Database(path.join(target, 'shelfdeck.db'));
    try { assert.deepEqual(copy.prepare('SELECT value FROM fact').all(), [{value:'closed-committed'}]); }
    finally { copy.close(); }
  } finally { fs.rmSync(root, { recursive:true, force:true }); }
});

test('standalone copy rejects a source changed during capture', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readiness-racing-source-'));
  const source = path.join(root, 'source'), target = path.join(root, 'snapshot');
  fs.mkdirSync(source);
  const file = path.join(source, 'shelfdeck.db'), database = new Database(file);
  database.exec("CREATE TABLE fact(value TEXT); INSERT INTO fact VALUES ('before')");database.close();
  fs.writeFileSync(path.join(source, 'admin-credential-secret.json'), '{"test":true}');
  const original = fs.copyFileSync;
  fs.copyFileSync = function(from, to, ...args) {
    original(from, to, ...args);
    if (from === file) { const writer = new Database(file);try { writer.exec("INSERT INTO fact VALUES ('after')"); } finally { writer.close(); } }
  };
  try { await assert.rejects(createReadinessSnapshot(source, target), /READINESS_SOURCE_CHANGED/); }
  finally { fs.copyFileSync = original;fs.rmSync(root,{recursive:true,force:true}); }
});
