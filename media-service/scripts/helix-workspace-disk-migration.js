'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { CONFIRM, migrateWorkspaceDisk } = require('./workspace-disk-migration');

function value(args, flag) {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}

function main(args) {
  const dataDir = value(args, '--data-dir');
  const apply = args.includes('--apply');
  const databasePath = path.join(dataDir || '', 'shelfdeck.db');
  if (!dataDir) throw new Error('An explicit absolute data directory is required.');
  const database = new Database(databasePath, { readonly: !apply, fileMustExist: true });
  database.pragma('foreign_keys = ON');
  if (apply) database.pragma('busy_timeout = 0');
  try {
    const receipt = migrateWorkspaceDisk(database, { dataDir, apply, confirm: value(args, '--confirm') });
    const receiptPath = value(args, '--receipt');
    if (receiptPath) fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } finally {
    database.close();
  }
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(`${JSON.stringify({ code: error.code || 'WORKSPACE_DISK_MIGRATION_FAILED', message: error.message, details: error.details || {} })}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({ CONFIRM, main });
