'use strict';

const fs = require('node:fs'), path = require('node:path');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
function fail(code) { throw Object.assign(new Error(code), { code }); }
function canonicalDirectory(value) {
  const key = item => process.platform === 'win32' ? item.toLowerCase() : item;
  if (typeof value !== 'string' || !path.isAbsolute(value) || fs.lstatSync(value).isSymbolicLink() ||
      !fs.statSync(value).isDirectory() || key(fs.realpathSync.native(value)) !== key(path.resolve(value)))
    fail('RESET_OPERATOR_LEASE_PATH_UNSAFE');
  return key(path.resolve(value));
}

// One configured Operator root serves a business data directory. SQLite's
// native exclusive lock is released by the OS even on SIGKILL; no stale PID
// file is stolen and no business database is opened to acquire this lease.
async function withResetOperatorLease({ Database, operationRoot, dataDir, run }) {
  const root = canonicalDirectory(operationRoot), identity = canonicalDirectory(dataDir);
  if (root === identity || typeof run !== 'function') fail('RESET_OPERATOR_LEASE_INPUT_INVALID');
  const file = path.join(operationRoot, 'operator-lease-' + canonicalDigest(identity) + '.sqlite');
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    const stat = fs.lstatSync(file + suffix, { throwIfNoEntry: false });
    if (stat && (!stat.isFile() || stat.isSymbolicLink())) fail('RESET_OPERATOR_LEASE_PATH_UNSAFE');
  }
  let database;
  try {
    database = new Database(file, { timeout: 0 });
    database.pragma('journal_mode=DELETE');
    database.pragma('synchronous=FULL');
    database.exec('BEGIN EXCLUSIVE');
    const catalog = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    if (catalog.some(row => row.name !== 'operator_identity')) fail('RESET_OPERATOR_LEASE_CORRUPT');
    database.exec('CREATE TABLE IF NOT EXISTS operator_identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1), data_dir TEXT NOT NULL)');
    const prior = database.prepare('SELECT data_dir FROM operator_identity WHERE singleton=1').get();
    if (prior && prior.data_dir !== identity) fail('RESET_OPERATOR_LEASE_CORRUPT');
    if (!prior) database.prepare('INSERT INTO operator_identity VALUES(1,?)').run(identity);
    const result = await run();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    if (error.code === 'SQLITE_BUSY' || error.code === 'SQLITE_LOCKED') fail('RESET_OPERATOR_BUSY');
    throw error;
  } finally {
    if (database?.inTransaction) database.exec('ROLLBACK');
    database?.close();
  }
}

module.exports = Object.freeze({ withResetOperatorLease });
