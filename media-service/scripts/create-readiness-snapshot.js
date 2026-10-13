'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

async function fileDigest(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function createReadinessSnapshot(source, target) {
  if (fs.existsSync(target)) throw new Error('READINESS_TARGET_EXISTS');
  const credential = path.join(source, 'admin-credential-secret.json');
  const stat = fs.lstatSync(credential);
  if (!stat.isFile() || stat.size > 65536) throw new Error('READINESS_CREDENTIAL_INVALID');
  fs.mkdirSync(target, { recursive: false });
  const sourceDatabase = path.join(source, 'shelfdeck.db');
  const targetDatabase = path.join(target, 'shelfdeck.db');
  // A closed WAL database without SHM cannot be opened on a read-only mount.
  // Copy the standalone file and prove it stayed unchanged instead of creating source auxiliaries.
  if (!fs.existsSync(sourceDatabase + '-wal') && !fs.existsSync(sourceDatabase + '-shm')) {
    const before = fs.statSync(sourceDatabase, { bigint: true });
    fs.copyFileSync(sourceDatabase, targetDatabase);
    const [sourceDigest, targetDigest] = await Promise.all([fileDigest(sourceDatabase), fileDigest(targetDatabase)]);
    const after = fs.statSync(sourceDatabase, { bigint: true });
    if (sourceDigest !== targetDigest || before.size !== after.size || before.mtimeNs !== after.mtimeNs ||
        before.ctimeNs !== after.ctimeNs || fs.existsSync(sourceDatabase + '-wal') || fs.existsSync(sourceDatabase + '-shm')) {
      throw new Error('READINESS_SOURCE_CHANGED');
    }
    fs.copyFileSync(credential, path.join(target, 'admin-credential-secret.json'));
    return;
  }
  const database = new Database(sourceDatabase, { readonly: true, fileMustExist: true });
  try {
    database.exec('BEGIN');
    database.prepare('SELECT count(*) FROM sqlite_master').get();
    const started = Date.now();
    await database.backup(targetDatabase, { progress() {
      if (Date.now() - started > 180000) throw new Error('READINESS_SNAPSHOT_TIMEOUT');
      return 10000;
    } });
    fs.copyFileSync(credential, path.join(target, 'admin-credential-secret.json'));
  } finally {
    database.close();
  }
}

module.exports = { createReadinessSnapshot };
