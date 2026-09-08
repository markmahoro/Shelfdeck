'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

async function createReadinessSnapshot(source, target) {
  if (fs.existsSync(target)) throw new Error('READINESS_TARGET_EXISTS');
  const credential = path.join(source, 'admin-credential-secret.json');
  const stat = fs.lstatSync(credential);
  if (!stat.isFile() || stat.size > 65536) throw new Error('READINESS_CREDENTIAL_INVALID');
  fs.mkdirSync(target, { recursive: false });
  const database = new Database(path.join(source, 'shelfdeck.db'), { readonly: true, fileMustExist: true });
  try {
    database.exec('BEGIN');
    database.prepare('SELECT count(*) FROM sqlite_master').get();
    const started = Date.now();
    await database.backup(path.join(target, 'shelfdeck.db'), { progress() {
      if (Date.now() - started > 180000) throw new Error('READINESS_SNAPSHOT_TIMEOUT');
      return 10000;
    } });
    fs.copyFileSync(credential, path.join(target, 'admin-credential-secret.json'));
  } finally {
    database.close();
  }
}

module.exports = { createReadinessSnapshot };
