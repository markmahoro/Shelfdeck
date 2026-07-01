'use strict';

/**
 * Production adult library hot/cold migration for the ShelfDeck NAS.
 *
 * Default mode is a remote plan with no writes. Apply mode requires both
 * --apply and --confirm-adult-migration, creates backups first, then migrates
 * adult rows from legacy library.json into library.db hot rows while persisting
 * cold AI artifacts under /app/data/adult-artifacts.
 */

const path = require('path');
const { Client } = require(path.join(__dirname, '..', 'tools', 'node_modules', 'ssh2'));
const { loadNasSshConfig } = require(path.join(__dirname, '..', 'tools', 'nas-ssh-config'));

const COMPOSE_DIR = '/vol1/1000/docker/shelfdeck';
const DATA_DIR = `${COMPOSE_DIR}/data`;
const STAMP = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function run(conn, cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    let out = '';
    let errOut = '';
    conn.exec(cmd, { pty: opts.pty === true }, (err, stream) => {
      if (err) return reject(err);
      stream.on('close', (code) => resolve({ code, out, errOut }));
      stream.on('data', (d) => { out += d.toString(); });
      stream.stderr.on('data', (d) => { errOut += d.toString(); });
      if (opts.input) stream.end(opts.input);
    });
  });
}

function cleanRemoteOutput(value) {
  return String(value || '')
    .split(/\r?\n/)
    .filter((line) => !line.includes('Could not chdir to home directory'))
    .join('\n')
    .trim();
}

function parseArgs(argv) {
  return {
    apply: argv.includes('--apply'),
    confirmed: argv.includes('--confirm-adult-migration'),
  };
}

function backupCmd() {
  const files = ['library.db', 'library.db-wal', 'library.db-shm', 'library.json'];
  const backupFiles = files.map((file) => {
    const src = `${DATA_DIR}/${file}`;
    const dst = `${src}.pre-adult-migration-${STAMP}.bak`;
    return [
      `if [ -f ${shellQuote(src)} ]; then`,
      `cp -p ${shellQuote(src)} ${shellQuote(dst)}`,
      `&& echo backed-up:${file}:${dst};`,
      `else echo backed-up:${file}:missing; fi`,
    ].join(' ');
  });
  const artifactBackup = [
    `if [ -d ${shellQuote(`${DATA_DIR}/adult-artifacts`)} ]; then`,
    `tar -C ${shellQuote(DATA_DIR)} -czf ${shellQuote(`${DATA_DIR}/adult-artifacts.pre-adult-migration-${STAMP}.tgz`)} adult-artifacts`,
    `&& echo backed-up:adult-artifacts:${DATA_DIR}/adult-artifacts.pre-adult-migration-${STAMP}.tgz;`,
    'else echo backed-up:adult-artifacts:none; fi',
  ].join(' ');
  return ['set -e', ...backupFiles, artifactBackup].join(' ; ');
}

function fileSizesCmd() {
  return [
    'for f in library.json library.db library.db-wal library.db-shm; do',
    `p=${shellQuote(DATA_DIR)}"/$f";`,
    'if [ -f "$p" ]; then stat -c "%n %s %y" "$p"; fi;',
    'done',
  ].join(' ');
}

function remoteMigrationCode() {
  return String.raw`
'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = '/app/data';
const mode = process.env.SHELFDECK_ADULT_MIGRATION_MODE === 'apply' ? 'apply' : 'plan';
const backupStamp = process.env.SHELFDECK_ADULT_MIGRATION_BACKUP_STAMP || '';
const configStore = require('/app/src/configStore');
const libraryStore = require('/app/src/libraryStore');
const adultDataModel = require('/app/src/adultDataModel');
const adultColdArtifactStore = require('/app/src/adultColdArtifactStore');

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function payloadBytes(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value || {}));
  } catch {
    return 0;
  }
}

function fileSize(file) {
  try {
    return fs.statSync(path.join(DATA_DIR, file)).size;
  } catch {
    return 0;
  }
}

function adultSubLibraries(config) {
  const libs = Array.isArray(config.subLibraries) ? config.subLibraries : [];
  return libs.filter((lib) => {
    return lib && lib.enabled !== false && (
      lib.mediaType === 'adult'
      || lib.adultRegion
      || String(lib.source || '') === 'adult_folder'
    );
  }).map((lib) => ({
    uuid: String(lib.uuid || lib.id || ''),
    name: String(lib.name || ''),
    region: String(lib.adultRegion || ''),
    enabled: lib.enabled !== false,
  })).filter((lib) => lib.uuid);
}

function isAdultItem(item, adultIds) {
  return item && (
    item.source === 'adult_folder'
    || item.mediaType === 'adult'
    || adultIds.has(String(item.subLibraryId || ''))
    || (item.adultMetadata && typeof item.adultMetadata === 'object')
  );
}

function projectHotItem(item) {
  const next = cloneJson(item || {});
  const itemId = String(next.itemId || next.sourceId || '').trim();
  if (!itemId) return null;
  next.itemId = itemId;
  const split = adultDataModel.splitAdultMetadata(next.adultMetadata || {});
  next.adultMetadata = split.lightMetadata;
  return {
    item: next,
    beforeBytes: payloadBytes(item),
    afterBytes: payloadBytes(next),
    coldArtifacts: split.coldArtifacts,
    coldKeys: Object.keys(split.coldArtifacts),
    coldArtifactBytes: payloadBytes(split.coldArtifacts),
  };
}

function analyzeSource() {
  const config = configStore.loadConfig();
  const adultLibs = adultSubLibraries(config);
  const adultIds = new Set(adultLibs.map((lib) => lib.uuid));
  const libraryJson = readJson(path.join(DATA_DIR, 'library.json'), { items: [] });
  const sourceItems = Array.isArray(libraryJson.items) ? libraryJson.items : [];
  const adultItems = sourceItems.filter((item) => isAdultItem(item, adultIds));
  const projected = [];
  const skipped = [];
  for (const item of adultItems) {
    const projectedItem = projectHotItem(item);
    const subLibraryId = String(item && item.subLibraryId || '');
    if (!projectedItem) {
      skipped.push({ reason: 'missing_item_id', name: item && item.name || '', subLibraryId });
      continue;
    }
    if (!adultIds.has(subLibraryId)) {
      skipped.push({ reason: 'unknown_adult_sub_library', itemId: projectedItem.item.itemId, name: projectedItem.item.name || '', subLibraryId });
      continue;
    }
    projected.push({ ...projectedItem, subLibraryId });
  }

  const bySubLibrary = new Map();
  let beforeBytes = 0;
  let afterBytes = 0;
  let coldArtifactBytes = 0;
  let rowsWithColdArtifacts = 0;
  for (const entry of projected) {
    beforeBytes += entry.beforeBytes;
    afterBytes += entry.afterBytes;
    coldArtifactBytes += entry.coldArtifactBytes;
    if (entry.coldKeys.length > 0) rowsWithColdArtifacts += 1;
    const current = bySubLibrary.get(entry.subLibraryId) || {
      subLibraryId: entry.subLibraryId,
      rows: 0,
      beforeBytes: 0,
      projectedHotBytes: 0,
      coldArtifactBytes: 0,
      rowsWithColdArtifacts: 0,
    };
    current.rows += 1;
    current.beforeBytes += entry.beforeBytes;
    current.projectedHotBytes += entry.afterBytes;
    current.coldArtifactBytes += entry.coldArtifactBytes;
    if (entry.coldKeys.length > 0) current.rowsWithColdArtifacts += 1;
    bySubLibrary.set(entry.subLibraryId, current);
  }

  return {
    adultLibs,
    sourceRows: adultItems.length,
    projectedRows: projected.length,
    skipped,
    rowsWithColdArtifacts,
    beforeBytes,
    projectedHotBytes: afterBytes,
    coldArtifactBytes,
    projectedHotReductionRatio: beforeBytes > 0 ? Number(((beforeBytes - afterBytes) / beforeBytes).toFixed(6)) : 0,
    bySubLibrary: [...bySubLibrary.values()].sort((a, b) => b.beforeBytes - a.beforeBytes),
    projected,
  };
}

function dbAdultCounts(adultLibs) {
  const db = new Database(path.join(DATA_DIR, 'library.db'), { readonly: true, fileMustExist: true });
  try {
    const ids = adultLibs.map((lib) => lib.uuid);
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return db.prepare([
      'SELECT sub_library_id AS subLibraryId, COUNT(*) AS rows, IFNULL(SUM(length(payload_json)), 0) AS payloadBytes',
      'FROM media_items',
      'WHERE sub_library_id IN (' + placeholders + ')',
      'GROUP BY sub_library_id',
      'ORDER BY sub_library_id',
    ].join(' ')).all(ids);
  } finally {
    db.close();
  }
}

function countArtifactFiles() {
  const dir = path.join(DATA_DIR, 'adult-artifacts');
  try {
    return fs.readdirSync(dir).filter((name) => name.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

function applyMigration(analysis) {
  if (!backupStamp) throw new Error('apply requires SHELFDECK_ADULT_MIGRATION_BACKUP_STAMP');
  const grouped = new Map();
  for (const entry of analysis.projected) {
    const rows = grouped.get(entry.subLibraryId) || [];
    rows.push(entry.item);
    grouped.set(entry.subLibraryId, rows);
    if (entry.coldKeys.length > 0) {
      adultColdArtifactStore.saveArtifacts(entry.item.itemId, entry.coldArtifacts || {});
    }
  }

  const now = new Date().toISOString();
  const writes = [];
  for (const [subLibraryId, items] of grouped.entries()) {
    libraryStore.replaceSubLibraryItems(subLibraryId, items, { cachedAt: now });
    writes.push({ subLibraryId, rows: items.length });
  }

  const db = new Database(path.join(DATA_DIR, 'library.db'));
  db.pragma('busy_timeout = 15000');
  const checkpoint = db.pragma('wal_checkpoint(TRUNCATE)', { simple: false });
  try {
    db.exec('VACUUM');
  } finally {
    db.close();
  }
  return { writes, checkpoint };
}

const beforeFiles = {
  libraryJsonBytes: fileSize('library.json'),
  libraryDbBytes: fileSize('library.db'),
  libraryWalBytes: fileSize('library.db-wal'),
  libraryShmBytes: fileSize('library.db-shm'),
};
const analysis = analyzeSource();
const beforeDbRows = dbAdultCounts(analysis.adultLibs);
let applyResult = null;
if (mode === 'apply') {
  applyResult = applyMigration(analysis);
}
const afterFiles = {
  libraryJsonBytes: fileSize('library.json'),
  libraryDbBytes: fileSize('library.db'),
  libraryWalBytes: fileSize('library.db-wal'),
  libraryShmBytes: fileSize('library.db-shm'),
};
const result = {
  mode,
  generatedAt: new Date().toISOString(),
  backupStamp: mode === 'apply' ? backupStamp : '',
  dataFiles: { before: beforeFiles, after: afterFiles },
  adultSubLibraries: analysis.adultLibs,
  source: {
    libraryJsonAdultRows: analysis.sourceRows,
    projectedRows: analysis.projectedRows,
    skippedRows: analysis.skipped.length,
    skippedSamples: analysis.skipped.slice(0, 20),
    rowsWithColdArtifacts: analysis.rowsWithColdArtifacts,
    sourcePayloadBytes: analysis.beforeBytes,
    projectedHotPayloadBytes: analysis.projectedHotBytes,
    coldArtifactBytes: analysis.coldArtifactBytes,
    projectedHotReductionRatio: analysis.projectedHotReductionRatio,
    bySubLibrary: analysis.bySubLibrary,
  },
  dbAdultRows: {
    before: beforeDbRows,
    after: dbAdultCounts(analysis.adultLibs),
  },
  adultArtifactFiles: countArtifactFiles(),
  applyResult,
  rollback: mode === 'apply' ? {
    restoreFiles: [
      'library.db',
      'library.db-wal',
      'library.db-shm',
      'library.json',
    ].map((file) => ({
      from: DATA_DIR + '/' + file + '.pre-adult-migration-' + backupStamp + '.bak',
      to: DATA_DIR + '/' + file,
    })),
    removeOrRestoreArtifacts: DATA_DIR + '/adult-artifacts and optional adult-artifacts.pre-adult-migration-' + backupStamp + '.tgz',
  } : null,
  invariants: [
    'Adult items remain Kairox subLibrary rows in media_items.',
    'itemId, sourceId, subLibraryId, path, lifecycle facts, and task target facts are copied from library.json hot source.',
    'Cold AI artifacts are stored outside hot payload under adult-artifacts/<itemId>.json.',
    'No TaskAdmission, Flow, Event, or lifecycle objective is created by this migration.',
  ],
};
delete result.source.projected;
console.log(JSON.stringify(result, null, 2));
`;
}

async function runRemoteNode(conn, mode) {
  const envArgs = [
    '-e', `SHELFDECK_ADULT_MIGRATION_MODE=${mode}`,
    '-e', `SHELFDECK_ADULT_MIGRATION_BACKUP_STAMP=${STAMP}`,
  ].map(shellQuote).join(' ');
  return run(conn, `docker exec -i ${envArgs} shelfdeck node`, {
    input: remoteMigrationCode(),
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.apply && !args.confirmed) {
    throw new Error('Apply mode requires --apply --confirm-adult-migration.');
  }

  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn.on('ready', resolve);
    conn.on('error', reject);
    conn.connect(loadNasSshConfig({ readyTimeout: 15000 }));
  });

  const report = {
    target: {
      host: '192.168.12.230',
      serviceUrl: 'http://192.168.12.230:18080',
      dataDir: DATA_DIR,
    },
    mode: args.apply ? 'apply' : 'plan',
    generatedAt: new Date().toISOString(),
    backupStamp: args.apply ? STAMP : '',
    sections: [],
  };

  try {
    for (const [label, cmd] of [
      ['running image', 'docker inspect shelfdeck --format "{{.Config.Image}}"'],
      ['data file sizes before', fileSizesCmd()],
    ]) {
      const { code, out, errOut } = await run(conn, cmd, { pty: true });
      report.sections.push({ label, exitCode: code, output: cleanRemoteOutput(out), stderr: cleanRemoteOutput(errOut) });
      if (code !== 0) throw new Error(`${label} failed`);
    }

    if (args.apply) {
      const { code, out, errOut } = await run(conn, backupCmd(), { pty: true });
      report.sections.push({ label: 'pre-migration backup', exitCode: code, output: cleanRemoteOutput(out), stderr: cleanRemoteOutput(errOut) });
      if (code !== 0) throw new Error('pre-migration backup failed');
    }

    const migration = await runRemoteNode(conn, args.apply ? 'apply' : 'plan');
    report.sections.push({
      label: args.apply ? 'adult migration apply' : 'adult migration plan',
      exitCode: migration.code,
      output: cleanRemoteOutput(migration.out),
      stderr: cleanRemoteOutput(migration.errOut),
    });
    if (migration.code !== 0) throw new Error('adult migration node step failed');

    const after = await run(conn, fileSizesCmd(), { pty: true });
    report.sections.push({ label: 'data file sizes after', exitCode: after.code, output: cleanRemoteOutput(after.out), stderr: cleanRemoteOutput(after.errOut) });
  } finally {
    conn.end();
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(`ADULT MIGRATION APPLY FAILED: ${err.message}`);
  process.exit(1);
});
