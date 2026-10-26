'use strict';

const fs = require('node:fs'), path = require('node:path');
function fail(code) { throw Object.assign(new Error(code), { code }); }

// This independent control database contains no business rows. Its native
// exclusive lock is held for the entire Supervisor lifetime, including cold
// management. OS process exit releases the lock without PID-file guessing.
function acquireGenerationLease({ dataDir, Database = require('better-sqlite3') }) {
  const key = value => process.platform === 'win32' ? value.toLowerCase() : value;
  if (!path.isAbsolute(dataDir) || key(fs.realpathSync.native(dataDir)) !== key(path.resolve(dataDir))) fail('RESET_LIFETIME_PATH_UNSAFE');
  const root = path.join(dataDir, 'operator-runtime');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(root).isSymbolicLink() || key(fs.realpathSync.native(root)) !== key(root)) fail('RESET_LIFETIME_PATH_UNSAFE');
  const file = path.join(root, 'supervisor-lifetime.sqlite');
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const stat = fs.lstatSync(file + suffix, { throwIfNoEntry: false });
    if (stat && (!stat.isFile() || stat.isSymbolicLink())) fail('RESET_LIFETIME_PATH_UNSAFE');
  }
  let database;
  try {
    database = new Database(file, { timeout: 0 });
    database.pragma('journal_mode=DELETE'); database.pragma('synchronous=FULL');
    database.exec('BEGIN EXCLUSIVE');
    if (database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().some(row => row.name !== 'lifetime_identity')) fail('RESET_LIFETIME_CORRUPT');
    database.exec('CREATE TABLE IF NOT EXISTS lifetime_identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1), data_dir TEXT NOT NULL)');
    const prior = database.prepare('SELECT data_dir FROM lifetime_identity WHERE singleton=1').get();
    if (prior && prior.data_dir !== key(dataDir)) fail('RESET_LIFETIME_CORRUPT');
    if (!prior) database.prepare('INSERT INTO lifetime_identity VALUES(1,?)').run(key(dataDir));
    // Publish immutable identity before holding a read-only exclusive epoch.
    // A complete backup can copy the stable file without an unfinished journal.
    database.exec('COMMIT'); database.exec('BEGIN EXCLUSIVE');
  } catch (error) {
    if (database?.inTransaction) database.exec('ROLLBACK'); database?.close();
    if (['SQLITE_BUSY', 'SQLITE_LOCKED'].includes(error.code)) fail('RESET_SUPERVISOR_ALREADY_ACTIVE');
    throw error;
  }
  let released = false;
  return Object.freeze({
    assertHeld() { if (released || !database.open || !database.inTransaction) fail('RESET_LIFETIME_NOT_HELD'); },
    close() { if (!released) { database.exec('ROLLBACK'); database.close(); released = true; } },
  });
}

module.exports = Object.freeze({ acquireGenerationLease });
