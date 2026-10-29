'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const Database = require('better-sqlite3');
const { digestResetSnapshot } = require('../scripts/formation-reset-snapshot-digest');
const { fileDigest } = require('../scripts/formation-reset-generation');
const { createRetainedDatabase } = require('../scripts/formation-reset-copy');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-snapshot-'));
  const file = path.join(root, 'source.db'), writer = new Database(file);
  t.after(() => { if (writer.open) writer.close(); fs.rmSync(root, { recursive: true, force: true }); });
  writer.exec(`PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
    CREATE TABLE owned(id TEXT PRIMARY KEY,value INTEGER NOT NULL);
    CREATE TABLE queue(id TEXT PRIMARY KEY,title TEXT NOT NULL);
    INSERT INTO owned VALUES('collection',9223372036854775807);
    INSERT INTO queue VALUES('unaccepted','old offer');`);
  function read() {
    const db = new Database(file, { readonly: true });
    try { db.exec('BEGIN'); return digestResetSnapshot(db); }
    finally { if (db.inTransaction) db.exec('ROLLBACK'); db.close(); }
  }
  return { root, file, writer, read };
}

test('stopped Host WAL checkpoint changes physical bytes but preserves the logical preflight commitment', t => {
  const f = fixture(t), before = f.read(), bytes = fileDigest(f.file);
  f.writer.pragma('wal_checkpoint(TRUNCATE)');
  assert.notEqual(fileDigest(f.file), bytes);
  assert.deepEqual(f.read(), before);
  f.writer.close();
  assert.deepEqual(f.read(), before);
});

test('changing discarded input invalidates the commitment even with identical retained facts and counts', t => {
  const f = fixture(t);
  const policy = { tables: { owned: { owner: 'arca', disposition: 'root' }, queue: { owner: 'procurement', disposition: 'clear' } }, edges: [] };
  const first = createRetainedDatabase({ Database, sourcePath: f.file, targetPath: path.join(f.root, 'first.db'), policy });
  assert.deepEqual(first.sourceSnapshot, f.read());
  f.writer.prepare('UPDATE queue SET title=?').run('changed offer');
  const second = createRetainedDatabase({ Database, sourcePath: f.file, targetPath: path.join(f.root, 'second.db'), policy });
  assert.equal(second.retainedDigest, first.retainedDigest);
  assert.deepEqual(second.tables, first.tables);
  assert.notEqual(second.sourceSnapshot.digest, first.sourceSnapshot.digest);
  assert.deepEqual(second.sourceSnapshot, f.read());
});

test('a frozen snapshot remains exact across concurrent writes and rejects writable or unfenced reads', t => {
  const f = fixture(t), reader = new Database(f.file, { readonly: true });
  try {
    assert.throws(() => digestResetSnapshot(reader), { code: 'RESET_SNAPSHOT_READONLY_REQUIRED' });
    f.writer.exec('BEGIN');
    assert.throws(() => digestResetSnapshot(f.writer), { code: 'RESET_SNAPSHOT_READONLY_REQUIRED' });
    f.writer.exec('ROLLBACK');
    reader.exec('BEGIN');
    const original = digestResetSnapshot(reader);
    f.writer.prepare("UPDATE owned SET value=9223372036854775806").run();
    assert.deepEqual(digestResetSnapshot(reader), original, 'safe integers cannot be rounded into the same digest');
    assert.notEqual(f.read().digest, original.digest);
  } finally { if (reader.inTransaction) reader.exec('ROLLBACK'); reader.close(); }
});
