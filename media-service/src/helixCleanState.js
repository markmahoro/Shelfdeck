'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const HELIX_SCHEMA_VERSION = 'helix-beta-clean-v1';
const APPLY_CONFIRMATION = 'INITIALIZE_HELIX_CLEAN_STATE';
const MARKER_FILE = 'helix-state.json';

const RESET_ENTRIES = Object.freeze([
  'config.json',
  'library.db',
  'library.db-shm',
  'library.db-wal',
  'tasks.db',
  'tasks.db-shm',
  'tasks.db-wal',
  'library.json',
  'library.json.migrated',
  'tasks.json',
  'tasks.json.migrated',
  'cache.json',
  'control-plane-state.json',
  'douban-entries-cache.json',
  'douban-session.json',
  'nodes.json',
  'people.json',
  'playback-log.json',
  'shelfdeck.log',
  'adult-artifacts',
  'western-ai-frames',
]);

const LEGACY_CONFIG_FIELDS = Object.freeze([
  'automationMode',
  'scheduleMode',
  'autoCreate',
  'autoExecute',
  'automaticTaskTargets',
  'smartTaskEnabledActions',
  'smartTaskPollIntervalMinutes',
  'smartTaskMaxPerRun',
  'smartTaskMaxQueueSize',
  'strategyPollIntervalMinutes',
  'transcodeReplaceConfirmRequired',
  'upgradeReplaceConfirmRequired',
]);

const LEGACY_LIBRARY_TABLES = Object.freeze([
  'media_items',
  'media_fact_freshness',
  'nexora_memberships',
]);

function cleanString(value) {
  return String(value == null ? '' : value).trim();
}

function safeTimestamp(value = new Date()) {
  return value.toISOString().replace(/[:.]/g, '-');
}

function resolveInside(root, entry) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, entry);
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Unsafe Helix state entry: ${entry}`);
  }
  return resolved;
}

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function sqliteTables(filePath) {
  if (!fs.existsSync(filePath)) return [];
  let db;
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true });
    return db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
      .map((row) => cleanString(row.name))
      .filter(Boolean);
  } catch (_) {
    return [];
  } finally {
    if (db) db.close();
  }
}

function inspectTaskDatabase(filePath) {
  if (!fs.existsSync(filePath)) return { schemaMissing: [], legacyTargetRows: 0, legacyFlowRows: 0 };
  let db;
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true });
    const hasTasks = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tasks'").get();
    if (!hasTasks) return { schemaMissing: [], legacyTargetRows: 0, legacyFlowRows: 0 };
    const columns = new Set(db.prepare('PRAGMA table_info(tasks)').all().map((row) => row.name));
    const required = ['item_id', 'status', 'payload_json', 'target_gate', 'flow_kind', 'gate_objective_json'];
    const schemaMissing = required.filter((column) => !columns.has(column));
    if (schemaMissing.length > 0) return { schemaMissing, legacyTargetRows: 0, legacyFlowRows: 0 };
    const legacyTargetRows = db.prepare(`
      SELECT COUNT(*) AS count FROM tasks
      WHERE target_gate<>'' AND target_gate NOT IN ('basedata','metadata','optimize')
    `).get().count || 0;
    const legacyFlowRows = db.prepare(`
      SELECT COUNT(*) AS count FROM tasks WHERE flow_kind IN ('ingest','archive','delete')
    `).get().count || 0;
    return { schemaMissing, legacyTargetRows, legacyFlowRows };
  } catch (_) {
    return { schemaMissing: ['unreadable'], legacyTargetRows: 0, legacyFlowRows: 0 };
  } finally {
    if (db) db.close();
  }
}

function existingResetEntries(dataDir) {
  return RESET_ENTRIES.filter((entry) => fs.existsSync(resolveInside(dataDir, entry)));
}

function inspectState(options = {}) {
  const dataDir = path.resolve(options.dataDir || '');
  if (!cleanString(options.dataDir)) throw new Error('dataDir is required');
  const configPath = path.join(dataDir, 'config.json');
  const markerPath = path.join(dataDir, MARKER_FILE);
  const config = readJson(configPath, {});
  const subLibraries = Array.isArray(config.subLibraries) ? config.subLibraries : [];
  const legacyConfigFields = new Set();

  for (const field of LEGACY_CONFIG_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(config, field)) legacyConfigFields.add(field);
  }
  for (const subLibrary of subLibraries) {
    for (const field of LEGACY_CONFIG_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(subLibrary || {}, field)) legacyConfigFields.add(`subLibraries[].${field}`);
    }
  }

  const libraryTables = sqliteTables(path.join(dataDir, 'library.db'));
  const tasksTables = sqliteTables(path.join(dataDir, 'tasks.db'));
  const legacyTables = libraryTables.filter((table) => LEGACY_LIBRARY_TABLES.includes(table));
  const taskInspection = inspectTaskDatabase(path.join(dataDir, 'tasks.db'));
  if (taskInspection.schemaMissing.length > 0) legacyTables.push('tasks.schema');
  if (taskInspection.legacyTargetRows > 0) legacyTables.push('tasks.legacy_targets');
  if (taskInspection.legacyFlowRows > 0) legacyTables.push('tasks.legacy_flows');
  const marker = readJson(markerPath, null);

  return {
    dataDir,
    schemaVersion: marker && marker.schemaVersion || null,
    cleanMarkerCurrent: !!(marker && marker.schemaVersion === HELIX_SCHEMA_VERSION),
    existingResetEntries: existingResetEntries(dataDir),
    legacyConfigFields: Array.from(legacyConfigFields).sort(),
    legacyTables,
    libraryTables,
    tasksTables,
    taskInspection,
    requiresCleanInit: !marker
      || marker.schemaVersion !== HELIX_SCHEMA_VERSION
      || legacyConfigFields.size > 0
      || legacyTables.length > 0,
  };
}

function preservedConfig(raw = {}) {
  const moviepilotSavePath = cleanString(raw.moviepilot && raw.moviepilot.savePath);
  return {
    helixSchemaVersion: HELIX_SCHEMA_VERSION,
    apiKey: cleanString(raw.apiKey),
    transcodeTempRoot: cleanString(raw.transcodeTempRoot) || (process.platform === 'linux' ? '/transcode' : ''),
    upgradeStagingLocalPath: cleanString(raw.upgradeStagingLocalPath),
    ffmpegPath: cleanString(raw.ffmpegPath) || 'ffmpeg',
    ffprobePath: cleanString(raw.ffprobePath) || 'ffprobe',
    moviepilot: { savePath: moviepilotSavePath },
    embyServers: {},
    subLibraries: [],
  };
}

function buildPlan(options = {}) {
  const inspection = inspectState(options);
  const now = options.now instanceof Date ? options.now : new Date();
  const backupDir = path.resolve(options.backupDir
    || path.join(inspection.dataDir, 'backups', `helix-clean-init-${safeTimestamp(now)}`));
  const config = readJson(path.join(inspection.dataDir, 'config.json'), {});
  return {
    mode: 'dry-run',
    schemaVersion: HELIX_SCHEMA_VERSION,
    dataDir: inspection.dataDir,
    backupDir,
    resetEntries: inspection.existingResetEntries,
    preserve: {
      environmentVariables: 'not stored or modified by this tool',
      deploymentMounts: 'outside the ShelfDeck data allow-list and never modified',
      config: preservedConfig(config),
    },
    inspection,
  };
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

function copyEntry(source, destination) {
  const stat = fs.lstatSync(source);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (stat.isDirectory()) {
    fs.cpSync(source, destination, { recursive: true, errorOnExist: true });
    return;
  }
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
}

function applyCleanInit(options = {}) {
  if (cleanString(options.confirmation) !== APPLY_CONFIRMATION) {
    const error = new Error(`Apply requires confirmation ${APPLY_CONFIRMATION}`);
    error.code = 'HELIX_CLEAN_INIT_CONFIRMATION_REQUIRED';
    throw error;
  }

  const plan = buildPlan(options);
  fs.mkdirSync(path.dirname(plan.backupDir), { recursive: true });
  fs.mkdirSync(plan.backupDir, { recursive: false });

  for (const entry of plan.resetEntries) {
    const source = resolveInside(plan.dataDir, entry);
    const destination = resolveInside(plan.backupDir, entry);
    copyEntry(source, destination);
  }

  for (const entry of plan.resetEntries) {
    fs.rmSync(resolveInside(plan.dataDir, entry), { recursive: true, force: true });
  }

  const initializedAt = (options.now instanceof Date ? options.now : new Date()).toISOString();
  writeJsonAtomic(path.join(plan.dataDir, 'config.json'), plan.preserve.config);
  writeJsonAtomic(path.join(plan.dataDir, MARKER_FILE), {
    schemaVersion: HELIX_SCHEMA_VERSION,
    initializedAt,
    backupDir: plan.backupDir,
  });

  return {
    ...plan,
    mode: 'apply',
    initializedAt,
    applied: true,
  };
}

class HelixCleanInitRequiredError extends Error {
  constructor(inspection) {
    super('ShelfDeck state is not initialized for the Helix clean runtime');
    this.name = 'HelixCleanInitRequiredError';
    this.code = 'HELIX_CLEAN_INIT_REQUIRED';
    this.details = inspection;
  }
}

function assertCleanState(options = {}) {
  const inspection = inspectState(options);
  if (inspection.requiresCleanInit) throw new HelixCleanInitRequiredError(inspection);
  return inspection;
}

module.exports = {
  APPLY_CONFIRMATION,
  HELIX_SCHEMA_VERSION,
  MARKER_FILE,
  RESET_ENTRIES,
  HelixCleanInitRequiredError,
  applyCleanInit,
  assertCleanState,
  buildPlan,
  inspectState,
  preservedConfig,
};
