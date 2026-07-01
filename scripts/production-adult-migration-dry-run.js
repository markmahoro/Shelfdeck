'use strict';

/**
 * Read-only adult hot/cold migration dry-run for the ShelfDeck NAS.
 *
 * This script does not modify production state. It inspects aggregate adult
 * payload shape, estimates hot payload reduction, and prints the cold artifact
 * targets required before a future apply step.
 */

const path = require('path');
const { Client } = require(path.join(__dirname, '..', 'tools', 'node_modules', 'ssh2'));
const { loadNasSshConfig } = require(path.join(__dirname, '..', 'tools', 'nas-ssh-config'));

const COMPOSE_DIR = '/vol1/1000/docker/shelfdeck';
const DATA_DIR = `${COMPOSE_DIR}/data`;

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function run(conn, cmd) {
  return new Promise((resolve, reject) => {
    let out = '';
    let errOut = '';
    conn.exec(cmd, { pty: true }, (err, stream) => {
      if (err) return reject(err);
      stream.on('close', (code) => resolve({ code, out, errOut }));
      stream.on('data', (d) => { out += d.toString(); });
      stream.stderr.on('data', (d) => { errOut += d.toString(); });
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

function sqliteDryRunCmd() {
  const code = String.raw`
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = '/app/data';
const COLD_DIR = '/app/data/adult-artifacts';
const coldFields = [
  { key: 'faceClusters', jsonPath: '$.adultMetadata.faceClusters', target: 'artifacts.faceClusters' },
  { key: 'unknownFaces', jsonPath: '$.adultMetadata.unknownFaces', target: 'artifacts.unknownFaces' },
  { key: 'embedding', jsonPath: '$.adultMetadata.embedding', target: 'artifacts.embedding' },
  { key: 'sampleImage', jsonPath: '$.adultMetadata.sampleImage', target: 'artifacts.sampleImage' },
  { key: 'sampleImageBase64', jsonPath: '$.adultMetadata.sampleImageBase64', target: 'artifacts.sampleImageBase64' },
  { key: 'galleryImages', jsonPath: '$.adultMetadata.galleryImages', target: 'artifacts.galleryImages' },
  { key: 'posterImageBase64', jsonPath: '$.adultMetadata.posterImageBase64', target: 'artifacts.posterImageBase64' },
  { key: 'fanartImageBase64', jsonPath: '$.adultMetadata.fanartImageBase64', target: 'artifacts.fanartImageBase64' },
  { key: 'imageBase64', jsonPath: '$.adultMetadata.imageBase64', target: 'artifacts.imageBase64' },
  { key: 'posterImage', jsonPath: '$.adultMetadata.posterImage', target: 'artifacts.posterImage' },
  { key: 'fanartImage', jsonPath: '$.adultMetadata.fanartImage', target: 'artifacts.fanartImage' },
  { key: 'ai', jsonPath: '$.adultMetadata.ai', target: 'artifacts.ai' },
  { key: 'actorConfidence', jsonPath: '$.adultMetadata.actorConfidence', target: 'artifacts.actorConfidence' },
  { key: 'scene', jsonPath: '$.adultMetadata.scene', target: 'artifacts.scene' },
  { key: 'safetyFlags', jsonPath: '$.adultMetadata.safetyFlags', target: 'artifacts.safetyFlags' },
  { key: 'generatedTitle', jsonPath: '$.adultMetadata.generatedTitle', target: 'artifacts.generatedTitle' },
  { key: 'generatedDescription', jsonPath: '$.adultMetadata.generatedDescription', target: 'artifacts.generatedDescription' },
  { key: 'safeSummary', jsonPath: '$.adultMetadata.safeSummary', target: 'artifacts.safeSummary' },
];

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function fileSize(name) {
  try {
    const p = DATA_DIR + '/' + name;
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

function quote(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
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

function one(db, sql) {
  try {
    return db.prepare(sql).get();
  } catch (err) {
    return { error: err.message };
  }
}

function all(db, sql) {
  try {
    return db.prepare(sql).all();
  } catch (err) {
    return [{ error: err.message }];
  }
}

const config = readJson(DATA_DIR + '/config.json', {});
const adultLibs = adultSubLibraries(config);
const adultIds = adultLibs.map((lib) => lib.uuid);
const adultWhere = adultIds.length
  ? 'sub_library_id IN (' + adultIds.map(quote).join(',') + ')'
  : '1 = 0';
const db = new Database(DATA_DIR + '/library.db', { readonly: true, fileMustExist: true });

const byField = coldFields.map((field) => {
  const path = quote(field.jsonPath);
  const row = one(db, [
    'SELECT',
    'SUM(CASE WHEN json_type(payload_json, ' + path + ') IS NOT NULL THEN 1 ELSE 0 END) AS rows,',
    'IFNULL(SUM(IFNULL(length(json_extract(payload_json, ' + path + ')), 0)), 0) AS bytes,',
    'IFNULL(MAX(IFNULL(length(json_extract(payload_json, ' + path + ')), 0)), 0) AS maxBytes',
    'FROM media_items',
    'WHERE ' + adultWhere,
  ].join(' '));
  return {
    key: field.key,
    rows: Number(row.rows || 0),
    bytes: Number(row.bytes || 0),
    maxBytes: Number(row.maxBytes || 0),
    plannedTarget: 'adult-artifacts/<itemId>.json ' + field.target,
  };
});

const adultPayload = one(db, [
  'SELECT COUNT(*) AS rows,',
  'IFNULL(SUM(length(payload_json)), 0) AS payloadBytes,',
  'IFNULL(AVG(length(payload_json)), 0) AS averagePayloadBytes,',
  'IFNULL(MAX(length(payload_json)), 0) AS maxPayloadBytes',
  'FROM media_items',
  'WHERE ' + adultWhere,
].join(' '));

const rowsWithCold = one(db, [
  'SELECT COUNT(*) AS rows',
  'FROM media_items',
  'WHERE ' + adultWhere,
  'AND (' + coldFields.map((field) => 'json_type(payload_json, ' + quote(field.jsonPath) + ') IS NOT NULL').join(' OR ') + ')',
].join(' '));

const bySubLibrary = all(db, [
  'SELECT sub_library_id AS subLibraryId, COUNT(*) AS rows, IFNULL(SUM(length(payload_json)), 0) AS payloadBytes',
  'FROM media_items',
  'WHERE ' + adultWhere,
  'GROUP BY sub_library_id',
  'ORDER BY payloadBytes DESC',
].join(' '));

const estimatedColdBytes = byField.reduce((sum, field) => sum + field.bytes, 0);
const payloadBytes = Number(adultPayload.payloadBytes || 0);
const estimatedReductionRatio = payloadBytes > 0 ? estimatedColdBytes / payloadBytes : 0;

const result = {
  mode: 'dry-run',
  generatedAt: new Date().toISOString(),
  dataFiles: {
    libraryDbBytes: fileSize('library.db'),
    libraryWalBytes: fileSize('library.db-wal'),
    libraryShmBytes: fileSize('library.db-shm'),
    libraryJsonBytes: fileSize('library.json'),
  },
  adultSubLibraries: adultLibs,
  adultRows: {
    total: Number(adultPayload.rows || 0),
    rowsWithColdArtifacts: Number(rowsWithCold.rows || 0),
    bySubLibrary,
  },
  payload: {
    totalBytes: payloadBytes,
    averageBytes: Number(adultPayload.averagePayloadBytes || 0),
    maxBytes: Number(adultPayload.maxPayloadBytes || 0),
    estimatedColdArtifactBytes: estimatedColdBytes,
    estimatedHotPayloadReductionRatio: Number(estimatedReductionRatio.toFixed(6)),
  },
  coldFields: byField,
  plannedColdTarget: {
    directory: COLD_DIR,
    filePattern: 'adult-artifacts/<itemId>.json',
    recordShape: { version: 1, itemId: '<itemId>', updatedAt: '<iso>', artifacts: '<cold fields>' },
  },
  invariants: [
    'No production writes were performed.',
    'itemId/sourceId/subLibraryId/path/lifecycle facts/task target facts remain unchanged in dry-run.',
    'Future apply must backup library.db, library.db-wal, library.db-shm, and library.json first.',
    'Future apply must be reversible by restoring the backed up DB/JSON files and removing generated adult-artifacts files.',
  ],
};

console.log(JSON.stringify(result, null, 2));
`;

  return `docker exec shelfdeck node -e ${shellQuote(code)}`;
}

function commandPlan() {
  return [
    ['running image', 'docker inspect shelfdeck --format "{{.Config.Image}}"'],
    ['data file sizes', [
      'for f in library.json library.db library.db-wal library.db-shm; do',
      `p=${shellQuote(DATA_DIR)}"/$f";`,
      'if [ -f "$p" ]; then stat -c "%n %s %y" "$p"; fi;',
      'done',
    ].join(' ')],
    ['latest data backups', `ls -1t ${shellQuote(DATA_DIR)}/*.bak 2>/dev/null | head -30 || true`],
    ['adult migration dry-run', sqliteDryRunCmd()],
  ];
}

async function main() {
  const applyArg = process.argv.find((arg) => arg === '--apply' || arg.startsWith('--apply='));
  if (applyArg) {
    throw new Error('This script is a read-only dry-run and does not support --apply.');
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
    generatedAt: new Date().toISOString(),
    sections: [],
  };

  try {
    for (const [label, cmd] of commandPlan()) {
      const { code, out, errOut } = await run(conn, cmd);
      report.sections.push({
        label,
        exitCode: code,
        output: cleanRemoteOutput(out),
        stderr: cleanRemoteOutput(errOut),
      });
    }
  } finally {
    conn.end();
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(`ADULT MIGRATION DRY-RUN FAILED: ${err.message}`);
  process.exit(1);
});
