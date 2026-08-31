'use strict';

/**
 * Read-only production diagnostics for the ShelfDeck NAS.
 *
 * This script must not change production state. It only reads Docker metadata,
 * public service health, data file sizes, latest deployment backups, and
 * aggregate SQLite counters that do not expose media titles or credentials.
 */

const path = require('path');
const { Client } = require(path.join(__dirname, '..', 'tools', 'node_modules', 'ssh2'));
const { loadNasSshConfig } = require(path.join(__dirname, '..', 'tools', 'nas-ssh-config'));

const COMPOSE_DIR = '/vol1/1000/docker/shelfdeck';
const COMPOSE_FILE = `${COMPOSE_DIR}/docker-compose.yml`;
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

function sqliteAggregateCmd() {
  const code = String.raw`
const fs = require('fs');
const Database = require('better-sqlite3');

function openDb(file) {
  return new Database(file, { readonly: true, fileMustExist: true });
}

function rows(db, sql, params = []) {
  try {
    return db.prepare(sql).all(params);
  } catch (err) {
    return [{ error: err.message }];
  }
}

function one(db, sql, params = []) {
  try {
    return db.prepare(sql).get(params);
  } catch (err) {
    return { error: err.message };
  }
}

function adultSubLibraryIds() {
  try {
    const config = JSON.parse(fs.readFileSync('/app/data/config.json', 'utf8'));
    const libs = Array.isArray(config.subLibraries) ? config.subLibraries : [];
    return libs
      .filter((lib) => {
        const haystack = [
          lib.id,
          lib.name,
          lib.type,
          lib.source,
          lib.category,
          lib.kind,
          lib.contentType,
        ].map((v) => String(v || '').toLowerCase()).join('|');
        return /adult|jav|western|us/.test(haystack);
      })
      .map((lib) => String(lib.id || ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}

const library = openDb('/app/data/library.db');
const tasks = openDb('/app/data/tasks.db');
const helixPath = '/app/data/shelfdeck.db';
const helix = fs.existsSync(helixPath) ? openDb(helixPath) : null;
const observationCutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
const observationDeadlineMs = Date.now() - 60 * 60 * 1000;
const adultIds = adultSubLibraryIds();
const adultPlaceholders = adultIds.map(() => '?').join(',');
const adultWhere = adultIds.length > 0 ? 'WHERE sub_library_id IN (' + adultPlaceholders + ')' : 'WHERE 1 = 0';

const result = {
  generatedAt: new Date().toISOString(),
  library: {
    rows: one(library, 'SELECT COUNT(*) AS count FROM media_items'),
    bySubLibrary: rows(library, [
      "SELECT COALESCE(NULLIF(sub_library_id, ''), 'unknown') AS subLibraryId,",
      'COUNT(*) AS items,',
      'IFNULL(SUM(length(payload_json)), 0) AS payloadBytes',
      'FROM media_items',
      "GROUP BY COALESCE(NULLIF(sub_library_id, ''), 'unknown')",
      'ORDER BY payloadBytes DESC',
      'LIMIT 20',
    ].join(' ')),
    payload: one(library, [
      'SELECT COUNT(*) AS rows,',
      'IFNULL(SUM(length(payload_json)), 0) AS totalBytes,',
      'IFNULL(AVG(length(payload_json)), 0) AS averageBytes,',
      'IFNULL(MAX(length(payload_json)), 0) AS maxBytes',
      'FROM media_items',
    ].join(' ')),
    adultCache: {
      expectedAdultSubLibraryCount: adultIds.length,
      rows: one(library, 'SELECT COUNT(*) AS count FROM media_items ' + adultWhere, adultIds),
      largeArtifactBytes: one(library, [
        'SELECT IFNULL(SUM(',
        "IFNULL(length(json_extract(payload_json, '$.adultMetadata.faceClusters')), 0)",
        "+ IFNULL(length(json_extract(payload_json, '$.adultMetadata.unknownFaces')), 0)",
        "+ IFNULL(length(json_extract(payload_json, '$.adultMetadata.galleryImages')), 0)",
        "+ IFNULL(length(json_extract(payload_json, '$.adultMetadata.embedding')), 0)",
        "+ IFNULL(length(json_extract(payload_json, '$.adultMetadata.sampleImageBase64')), 0)",
        "+ IFNULL(length(json_extract(payload_json, '$.adultMetadata.posterImageBase64')), 0)",
        '), 0) AS bytes',
        'FROM media_items',
        adultWhere,
      ].join(' '), adultIds),
    },
  },
  tasks: {
    rows: one(tasks, 'SELECT COUNT(*) AS count FROM tasks'),
    byStatus: rows(tasks, [
      'SELECT status, COUNT(*) AS count',
      'FROM tasks',
      'GROUP BY status',
      'ORDER BY count DESC',
    ].join(' ')),
    activeRows: one(tasks, [
      'SELECT COUNT(*) AS count',
      'FROM tasks',
      "WHERE status NOT IN ('done', 'failed', 'failed_hard', 'cancelled', 'removed')",
    ].join(' ')),
    eventRows: one(tasks, 'SELECT COUNT(*) AS count FROM task_events'),
  },
  helixObservation: helix ? {
    storage: {
      pageSize: helix.pragma('page_size', { simple: true }),
      pageCount: helix.pragma('page_count', { simple: true }),
      freelistCount: helix.pragma('freelist_count', { simple: true }),
      autoVacuum: helix.pragma('auto_vacuum', { simple: true }),
    },
    entries: one(helix, [
      'SELECT COUNT(*) AS totalRows,',
      'SUM(CASE WHEN observed_at_ms < ? THEN 1 ELSE 0 END) AS olderThanSevenDays,',
      'COUNT(DISTINCT field_observation_work_id) AS workCount,',
      'MIN(observed_at_ms) AS oldestObservedAtMs, MAX(observed_at_ms) AS newestObservedAtMs',
      'FROM proc_field_observation_entries',
    ].join(' '), [observationCutoffMs]),
    gcEligible: one(helix, [
      'SELECT COUNT(*) AS rows FROM proc_field_observation_entries e',
      'WHERE e.observed_at_ms < ?',
      "AND NOT EXISTS (SELECT 1 FROM fx_supporting_works w WHERE w.work_id=e.field_observation_work_id AND w.state IN ('admitted','ready','running','blocked'))",
      'AND NOT EXISTS (SELECT 1 FROM proc_material_fields f WHERE f.field_id=e.field_id AND f.current_observation_revision=e.observation_revision)',
      "AND NOT EXISTS (SELECT 1 FROM proc_procurement_runs r WHERE r.field_observation_work_id=e.field_observation_work_id AND r.state IN ('active','waiting'))",
      "AND NOT EXISTS (SELECT 1 FROM proc_procurement_retry_intents i WHERE i.retry_field_observation_work_id=e.field_observation_work_id AND i.state='open')",
      'AND NOT EXISTS (SELECT 1 FROM proc_field_materials m WHERE m.field_id=e.field_id AND m.material_key=e.material_key AND m.last_observation_id=e.observation_id)',
    ].join(' '), [observationCutoffMs]),
    headers: one(helix, [
      'SELECT COUNT(*) AS totalRows,',
      'SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS terminalPages,',
      'MAX(observed_at_ms) AS newestObservedAtMs',
      'FROM proc_field_observations',
    ].join(' ')),
    worksByState: rows(helix, [
      'SELECT state, COUNT(*) AS count, MIN(created_at_ms) AS oldestCreatedAtMs',
      'FROM fx_supporting_works',
      "WHERE owner_domain='procurement' AND process_type='material_field' AND work_kind='field_observation'",
      'GROUP BY state ORDER BY state',
    ].join(' ')),
    executingObservationAttempts: one(helix, [
      'SELECT COUNT(*) AS count, MIN(ea.started_at_ms) AS oldestStartedAtMs,',
      'SUM(CASE WHEN ea.started_at_ms <= ? THEN 1 ELSE 0 END) AS expiredFrozenDeadline,',
      'SUM(CASE WHEN j.state IN (\'intended\',\'effect_observed\',\'reconcile_required\')',
      'AND rb.result_id IS NULL AND cm.commit_marker IS NULL THEN 1 ELSE 0 END) AS intendedWithoutResultOrMarker',
      'FROM fx_event_attempts ea',
      'JOIN fx_workflow_events e ON e.event_id=ea.event_id',
      'JOIN fx_supporting_works w ON w.work_id=e.work_id',
      'LEFT JOIN fx_effect_journal j ON j.event_attempt_id=ea.event_attempt_id',
      'LEFT JOIN fx_event_result_bindings rb ON rb.event_id=e.event_id',
      'LEFT JOIN fx_commit_markers cm ON cm.effect_id=j.effect_id',
      "WHERE ea.state='executing' AND e.state='executing'",
      "AND w.owner_domain='procurement' AND w.process_type='material_field' AND w.work_kind='field_observation'",
    ].join(' '), [observationDeadlineMs]),
    runningAttemptWithOnlyTerminalEvents: one(helix, [
      'SELECT COUNT(*) AS count FROM fx_work_attempts a',
      'JOIN fx_supporting_works w ON w.work_id=a.work_id',
      "WHERE a.state='running' AND w.state='running'",
      "AND w.owner_domain='procurement' AND w.process_type='material_field' AND w.work_kind='field_observation'",
      'AND EXISTS (SELECT 1 FROM fx_workflow_events e WHERE e.attempt_id=a.attempt_id)',
      "AND NOT EXISTS (SELECT 1 FROM fx_workflow_events e WHERE e.attempt_id=a.attempt_id AND e.state NOT IN ('succeeded','skipped','failed','cancelled'))",
    ].join(' ')),
  } : { present: false },
};

console.log(JSON.stringify(result, null, 2));
`;

  return `docker exec shelfdeck node -e ${shellQuote(code)}`;
}

function commandPlan() {
  return [
    ['running image', 'docker inspect shelfdeck --format "{{.Config.Image}}"'],
    ['compose image', `grep -n '^[[:space:]]*image:' ${shellQuote(COMPOSE_FILE)} || true`],
    ['public health', 'curl -fsS http://127.0.0.1:18080/v1/health'],
    ['data file sizes', [
      'for f in config.json library.json library.db library.db-wal library.db-shm tasks.json tasks.db tasks.db-wal tasks.db-shm shelfdeck.db shelfdeck.db-wal shelfdeck.db-shm; do',
      `p=${shellQuote(DATA_DIR)}"/$f";`,
      'if [ -f "$p" ]; then stat -c "%n %s %y" "$p"; fi;',
      'done',
    ].join(' ')],
    ['latest deployment backups', `ls -1t ${shellQuote(DATA_DIR)}/*.pre-image-adult-*.bak 2>/dev/null | head -30 || true`],
    ['database aggregates', sqliteAggregateCmd()],
  ];
}

async function main() {
  const applyArg = process.argv.find((arg) => arg === '--apply' || arg.startsWith('--apply='));
  if (applyArg) {
    throw new Error('This diagnostic script is read-only and does not support --apply.');
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
      composeFile: COMPOSE_FILE,
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
  console.error(`READONLY DIAGNOSTICS FAILED: ${err.message}`);
  process.exit(1);
});
