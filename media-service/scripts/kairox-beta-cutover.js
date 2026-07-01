'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const apply = args.has('--apply');
const confirmed = args.has('--confirm-kairox-beta-cutover');
const dataDirArg = rawArgs.find((arg) => arg.startsWith('--data-dir='));
const dataDir = path.resolve(
  dataDirArg ? dataDirArg.slice('--data-dir='.length) : (
    process.env.CONTROL_PLANE_DATA_DIR ||
    process.env.MEDIA_SERVICE_DATA_DIR ||
    path.join(__dirname, '..', 'data')
  ),
);

const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

function filePath(name) {
  return path.join(dataDir, name);
}

function exists(name) {
  return fs.existsSync(filePath(name));
}

function readJson(name, fallback) {
  try {
    if (!exists(name)) return fallback;
    return JSON.parse(fs.readFileSync(filePath(name), 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function fileInfo(name) {
  const p = filePath(name);
  if (!fs.existsSync(p)) return { name, exists: false, sizeBytes: 0 };
  return { name, exists: true, sizeBytes: fs.statSync(p).size };
}

function openDb(name, readonly = true) {
  const p = filePath(name);
  if (!fs.existsSync(p)) return null;
  return new Database(p, { readonly, fileMustExist: true });
}

function scalar(dbName, sql, params = []) {
  const db = openDb(dbName, true);
  if (!db) return 0;
  try {
    return Number((db.prepare(sql).get(params) || {}).count) || 0;
  } catch (_) {
    return 0;
  } finally {
    db.close();
  }
}

function rows(dbName, sql, params = []) {
  const db = openDb(dbName, true);
  if (!db) return [];
  try {
    return db.prepare(sql).all(params);
  } finally {
    db.close();
  }
}

function configSummary() {
  const cfg = readJson('config.json', {});
  const actions = Array.isArray(cfg.smartTaskEnabledActions) ? cfg.smartTaskEnabledActions : [];
  const targets = Array.isArray(cfg.automaticTaskTargets) ? cfg.automaticTaskTargets : [];
  const operations = Array.isArray(cfg.optimizeAllowedOperations) ? cfg.optimizeAllowedOperations : [];
  return {
    smartTaskDeleteActions: actions.filter((action) => String(action).toLowerCase() === 'delete').length,
    automaticTaskTargets: targets,
    optimizeAllowedOperations: operations,
    optimizeAllowedOperationsHasDelete: operations.includes('delete'),
  };
}

function taskSummary() {
  const total = scalar('tasks.db', 'SELECT COUNT(*) AS count FROM tasks');
  const active = scalar('tasks.db', "SELECT COUNT(*) AS count FROM tasks WHERE status NOT IN ('done','failed_hard','cancelled','skipped','deleted')");
  const events = scalar('tasks.db', 'SELECT COUNT(*) AS count FROM task_events');
  const deleteAsOptimize = scalar('tasks.db', "SELECT COUNT(*) AS count FROM tasks WHERE action_type = 'delete' AND (target_gate = 'optimize' OR bridge_kind = 'optimize' OR flow_direction = 'optimize.delete')");
  return { total, active, events, deleteAsOptimize };
}

function mediaSummary() {
  const total = scalar('library.db', 'SELECT COUNT(*) AS count FROM media_items');
  const optimizeFacts = scalar('library.db', "SELECT COUNT(*) AS count FROM media_items WHERE optimization_status != '' OR json_extract(payload_json, '$.optimizeGate') IS NOT NULL");
  const archiveFacts = scalar('library.db', "SELECT COUNT(*) AS count FROM media_items WHERE archive_status != '' OR json_extract(payload_json, '$.archiveGate') IS NOT NULL");
  const legacyActionDelete = scalar('library.db', "SELECT COUNT(*) AS count FROM media_items WHERE action = 'delete' OR json_extract(payload_json, '$.action') = 'delete'");
  const removeMediaObjective = scalar('library.db', "SELECT COUNT(*) AS count FROM media_items WHERE json_extract(payload_json, '$.optimizeObjective.kind') = 'remove_media'");
  const deletedMarkers = scalar('library.db', "SELECT COUNT(*) AS count FROM media_items WHERE json_extract(payload_json, '$.deleted') = 1 OR json_extract(payload_json, '$.removed') = 1 OR json_extract(payload_json, '$.deletedAt') IS NOT NULL");
  return {
    total,
    optimizeFacts,
    archiveFacts,
    legacyActionDelete,
    removeMediaObjective,
    deletedMarkers,
  };
}

function buildPlan() {
  return {
    mode: apply ? 'apply' : 'plan',
    dataDir,
    files: [
      fileInfo('config.json'),
      fileInfo('library.json'),
      fileInfo('library.db'),
      fileInfo('library.db-wal'),
      fileInfo('library.db-shm'),
      fileInfo('tasks.json'),
      fileInfo('tasks.db'),
      fileInfo('tasks.db-wal'),
      fileInfo('tasks.db-shm'),
    ],
    config: configSummary(),
    tasks: taskSummary(),
    media: mediaSummary(),
    actions: apply ? [
      'Back up config, library, and task files.',
      'Normalize config to Kairox Beta automation semantics.',
      'Recompute user perception, metadata, objective, lifecycle, and gate facts.',
      'Export then clear tasks and task_events.',
      'Write kairox_beta_cutover_applied_v1 marker.',
    ] : [
      'No production files will be changed.',
      'Run with --apply --confirm-kairox-beta-cutover after review.',
    ],
  };
}

function backupFiles() {
  const backups = [];
  for (const name of ['config.json', 'library.json', 'library.db', 'library.db-wal', 'library.db-shm', 'tasks.json', 'tasks.db', 'tasks.db-wal', 'tasks.db-shm']) {
    const src = filePath(name);
    if (!fs.existsSync(src)) continue;
    const dst = `${src}.kairox-beta-${STAMP}.bak`;
    fs.copyFileSync(src, dst);
    backups.push({ name, backup: dst });
  }
  return backups;
}

function exportTaskHistory() {
  const exportPath = filePath(`tasks.kairox-beta-${STAMP}.json`);
  const taskRows = rows('tasks.db', 'SELECT * FROM tasks ORDER BY created_at ASC');
  const eventRows = rows('tasks.db', 'SELECT * FROM task_events ORDER BY created_at ASC');
  fs.writeFileSync(exportPath, JSON.stringify({ exportedAt: new Date().toISOString(), tasks: taskRows, taskEvents: eventRows }, null, 2), 'utf8');
  return exportPath;
}

function normalizeConfig() {
  process.env.CONTROL_PLANE_DATA_DIR = dataDir;
  process.env.MEDIA_SERVICE_DATA_DIR = dataDir;
  const configStore = require('../src/configStore');
  const cfg = configStore.loadConfig();
  const targets = new Set(Array.isArray(cfg.automaticTaskTargets) ? cfg.automaticTaskTargets : []);
  const legacyActions = Array.isArray(cfg.smartTaskEnabledActions) ? cfg.smartTaskEnabledActions : [];
  if (legacyActions.map((action) => String(action || '').toLowerCase()).includes('delete')) targets.add('delete');
  const optimizeAllowedOperations = (Array.isArray(cfg.optimizeAllowedOperations) ? cfg.optimizeAllowedOperations : [])
    .filter((operation) => operation === 'transcode' || operation === 'upgrade');
  const smartTaskEnabledActions = [];
  if (targets.has('ingest')) smartTaskEnabledActions.push('ingest');
  if (targets.has('metadata')) smartTaskEnabledActions.push('scrape');
  if (targets.has('optimize')) smartTaskEnabledActions.push(...optimizeAllowedOperations);
  if (targets.has('archive')) smartTaskEnabledActions.push('archive');
  if (targets.has('delete')) smartTaskEnabledActions.push('delete');
  return configStore.saveConfig({
    ...cfg,
    automaticTaskTargets: [...targets],
    optimizeAllowedOperations,
    smartTaskEnabledActions,
    deleteGatePolicy: {
      enabled: !!(cfg.deleteGatePolicy && cfg.deleteGatePolicy.enabled),
      rules: Array.isArray(cfg.deleteGatePolicy && cfg.deleteGatePolicy.rules) ? cfg.deleteGatePolicy.rules : [],
    },
  }, { skipMetadataGateValidation: true });
}

function recomputeMedia(config) {
  process.env.CONTROL_PLANE_DATA_DIR = dataDir;
  process.env.MEDIA_SERVICE_DATA_DIR = dataDir;
  const libraryStore = require('../src/libraryStore');
  const userPerceptionManagement = require('../src/userPerceptionManagement');
  const metadataStatus = require('../src/metadataStatus');
  const lifecycleObjectiveResolver = require('../src/lifecycleObjectiveResolver');
  const lifecycleProjection = require('../src/lifecycleProjection');
  const lib = libraryStore.loadLibrary();
  const items = (lib.items || []).map((item) => {
    const next = { ...item };
    userPerceptionManagement.projectItem(next, { now: new Date().toISOString() });
    Object.assign(next, metadataStatus.resolveMetadataStatus(next, config));
    if (next.optimizeObjective && next.optimizeObjective.kind === 'remove_media') {
      delete next.optimizeObjective;
      delete next.objectiveHash;
      delete next.objectiveVersion;
      next.objectiveBlockedReason = 'delete_gate_required';
    }
    if (next.action === 'delete' && !next.deleted && !next.removed) {
      next.action = 'keep';
      next.reason = 'Kairox Beta: delete moved to delete gate';
    }
    Object.assign(next, lifecycleObjectiveResolver.projectOptimizeObjective(next, { config }));
    Object.assign(next, lifecycleProjection.resolveLifecycle(next, config));
    if ((next.deleted || next.removed || next.deletedAt || next.removedAt) && !next.deleteGate) {
      const deletedAt = next.deletedAt || next.removedAt || new Date().toISOString();
      next.deleteGate = {
        gate: 'delete',
        passed: true,
        status: 'passed',
        reason: 'legacy_delete_marker_migrated',
        observed: { deletedAt, removed: true },
        evidenceLevel: 'migration',
      };
      next.deletionGate = next.deleteGate;
      next.deleteStatus = 'deleted';
      next.deleteDoneAt = deletedAt;
    }
    if (next.optimizationStatus === 'deleted' || next.optimizationAction === 'delete') {
      delete next.optimizationStatus;
      delete next.optimizationAction;
      delete next.optimizationDoneAt;
      delete next.optimizationTaskId;
      delete next.optimizationResult;
    }
    return next;
  });
  libraryStore.saveLibrary({ ...lib, cachedAt: new Date().toISOString(), items });
  return { mediaItems: items.length };
}

function clearTasks() {
  const db = openDb('tasks.db', false);
  if (!db) return { clearedTasks: 0, clearedTaskEvents: 0 };
  try {
    const eventCount = scalar('tasks.db', 'SELECT COUNT(*) AS count FROM task_events');
    const taskCount = scalar('tasks.db', 'SELECT COUNT(*) AS count FROM tasks');
    db.transaction(() => {
      db.prepare('DELETE FROM task_events').run();
      db.prepare('DELETE FROM tasks').run();
      db.prepare(`
        INSERT INTO task_store_meta (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run('kairox_beta_cutover_applied_v1', new Date().toISOString());
    })();
    return { clearedTasks: taskCount, clearedTaskEvents: eventCount };
  } finally {
    db.close();
  }
}

function runApply(plan) {
  if (!confirmed) {
    throw new Error('Apply requires --confirm-kairox-beta-cutover');
  }
  fs.mkdirSync(dataDir, { recursive: true });
  const backups = backupFiles();
  const taskHistoryExport = exportTaskHistory();
  const config = normalizeConfig();
  const media = recomputeMedia(config);
  const tasks = clearTasks();
  const manifest = {
    marker: 'kairox_beta_cutover_applied_v1',
    appliedAt: new Date().toISOString(),
    dataDir,
    backups,
    taskHistoryExport,
    before: plan,
    after: buildPlan(),
    media,
    tasks,
  };
  const manifestPath = filePath(`kairox-beta-cutover-${STAMP}.manifest.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return { ...manifest, manifestPath };
}

try {
  const plan = buildPlan();
  const result = apply ? runApply(plan) : plan;
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(JSON.stringify({ error: err.message, dataDir }, null, 2));
  process.exit(1);
}
