'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

function sqlString(value) {
  return "'" + value.replaceAll("'", "''") + "'";
}

function pragmaSnapshot(database) {
  const pageSize = database.pragma('page_size', { simple:true });
  const pageCount = database.pragma('page_count', { simple:true });
  const freelistCount = database.pragma('freelist_count', { simple:true });
  return Object.freeze({
    autoVacuum:database.pragma('auto_vacuum', { simple:true }), pageSize, pageCount, freelistCount,
    databaseBytes:pageSize * pageCount, freeBytes:pageSize * freelistCount,
    journalMode:database.pragma('journal_mode', { simple:true }),
  });
}

function verify(database) {
  const integrity = database.pragma('integrity_check');
  const foreignKeys = database.pragma('foreign_key_check');
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' || foreignKeys.length !== 0) {
    throw Object.assign(new Error('Compacted database failed SQLite verification.'), {
      code:'OBSERVATION_COMPACTION_VERIFY_FAILED', details:{ integrity, foreignKeys },
    });
  }
}

function cleanSchemaMarker(database) {
  const table = database.prepare(
    "SELECT count(*) count FROM sqlite_master WHERE type='table' AND name='platform_schema_marker'"
  ).get();
  if (Number(table.count) !== 1) return null;
  const rows = database.prepare(
    'SELECT schema_name,generation,schema_digest,catalog_digest FROM platform_schema_marker'
  ).all();
  return rows.length === 1 && rows[0].schema_name === 'shelfdeck' && rows[0].generation === 'helix-clean-v3'
    ? rows[0] : null;
}

function main() {
  const requested = argument('--database');
  if (!requested) throw Object.assign(new Error('--database is required.'), { code:'OBSERVATION_COMPACTION_DATABASE_REQUIRED' });
  const databasePath = path.resolve(requested);
  if (!fs.statSync(databasePath).isFile()) throw Object.assign(new Error('Database path is not a file.'), {
    code:'OBSERVATION_COMPACTION_DATABASE_INVALID', details:{ databasePath },
  });
  const apply = process.argv.includes('--apply');
  const sourceBytes = fs.statSync(databasePath).size;
  const statfs = fs.statfsSync(path.dirname(databasePath));
  const availableBytes = statfs.bavail * statfs.bsize;
  const requiredFreeBytes = Math.ceil(sourceBytes * 1.2);
  const inspected = new Database(databasePath, { readonly:true, fileMustExist:true });
  const before = pragmaSnapshot(inspected);
  const marker = cleanSchemaMarker(inspected);
  if (!marker) {
    inspected.close();
    throw Object.assign(new Error('Database is not the clean ShelfDeck generation.'), {
      code:'OBSERVATION_COMPACTION_SCHEMA_MISMATCH', details:{ databasePath },
    });
  }
  const entryRows = Number(inspected.prepare('SELECT count(*) count FROM proc_field_observation_entries').get().count);
  inspected.close();
  const report = { mode:apply ? 'apply' : 'dry_run', databasePath, sourceBytes, availableBytes, requiredFreeBytes,
    enoughFreeSpace:availableBytes >= requiredFreeBytes, entryRows, before, marker };
  if (!apply) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }
  if (availableBytes < requiredFreeBytes) throw Object.assign(new Error('Compaction requires 1.2x database size free beside the database.'), {
    code:'OBSERVATION_COMPACTION_SPACE_INSUFFICIENT', details:report,
  });

  const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
  const temporaryPath = databasePath + '.compact-' + process.pid + '.tmp';
  const backupPath = databasePath + '.pre-observation-compact-' + stamp + '.bak';
  if (fs.existsSync(temporaryPath) || fs.existsSync(backupPath)) throw Object.assign(new Error('Compaction target already exists.'), {
    code:'OBSERVATION_COMPACTION_TARGET_EXISTS', details:{ temporaryPath, backupPath },
  });

  let source;
  try {
    source = new Database(databasePath, { fileMustExist:true, timeout:5000 });
    source.pragma('foreign_keys=ON');
    source.pragma('locking_mode=EXCLUSIVE');
    source.exec('BEGIN EXCLUSIVE');
    source.exec('ROLLBACK');
    const checkpoint = source.pragma('wal_checkpoint(TRUNCATE)')[0] || {};
    if (Number(checkpoint.busy || 0) !== 0) throw Object.assign(new Error('SQLite WAL still has an active reader.'), {
      code:'OBSERVATION_COMPACTION_DATABASE_BUSY', details:{ checkpoint },
    });
    source.pragma('auto_vacuum=INCREMENTAL');
    source.exec('VACUUM INTO ' + sqlString(temporaryPath));
    source.close(); source = null;

    const compacted = new Database(temporaryPath, { readonly:true, fileMustExist:true });
    verify(compacted);
    const after = pragmaSnapshot(compacted);
    const compactedEntryRows = Number(compacted.prepare('SELECT count(*) count FROM proc_field_observation_entries').get().count);
    compacted.close();
    if (after.autoVacuum !== 2 || compactedEntryRows !== entryRows) throw Object.assign(new Error('Compacted database continuity check failed.'), {
      code:'OBSERVATION_COMPACTION_CONTINUITY_FAILED', details:{ after, compactedEntryRows, entryRows },
    });

    fs.renameSync(databasePath, backupPath);
    try { fs.renameSync(temporaryPath, databasePath); }
    catch (error) { fs.renameSync(backupPath, databasePath); throw error; }
    for (const suffix of ['-wal','-shm']) fs.rmSync(databasePath + suffix, { force:true });
    process.stdout.write(JSON.stringify({ ...report, status:'completed', backupPath,
      compactedBytes:fs.statSync(databasePath).size, after }, null, 2) + '\n');
  } catch (error) {
    if (source?.open) source.close();
    fs.rmSync(temporaryPath, { force:true });
    throw error;
  }
}

try { main(); }
catch (error) {
  process.stderr.write(JSON.stringify({ ok:false, error:{ code:error.code || 'OBSERVATION_COMPACTION_FAILED',
    message:error.message, details:error.details || {} } }, null, 2) + '\n');
  process.exitCode = 1;
}
