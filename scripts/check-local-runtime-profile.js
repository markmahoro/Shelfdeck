'use strict';

/**
 * Validate the local production-shaped runtime profile.
 *
 * Usage:
 *   node scripts/check-local-runtime-profile.js
 *   node scripts/check-local-runtime-profile.js .codex/local-prod-data
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_DATA_DIR = path.join('.codex', 'local-prod-data');

function loadBetterSqlite3() {
  const serviceModules = path.join(__dirname, '..', 'media-service', 'node_modules');
  process.env.NODE_PATH = process.env.NODE_PATH
    ? `${process.env.NODE_PATH}${path.delimiter}${serviceModules}`
    : serviceModules;
  require('module').Module._initPaths();
  return require('better-sqlite3');
}

function timed(name, fn) {
  const started = Date.now();
  const value = fn();
  return {
    name,
    durationMs: Date.now() - started,
    value,
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function ensureFile(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error(`Not a file: ${file}`);
  return stat.size;
}

function inspectConfig(config) {
  const subLibraries = Array.isArray(config.subLibraries) ? config.subLibraries : [];
  const embyRoots = new Set();
  const adultRoots = new Set();
  for (const subLib of subLibraries) {
    if ((subLib.source || 'emby') === 'emby') {
      if (subLib.pathMapTo) embyRoots.add(subLib.pathMapTo);
    } else if (subLib.source === 'folder' || subLib.mediaType === 'adult') {
      if (subLib.watchRoot) adultRoots.add(subLib.watchRoot);
      if (subLib.pathMapTo) adultRoots.add(subLib.pathMapTo);
    }
  }
  return {
    localProfile: config.__localProfile || null,
    subLibraries: subLibraries.length,
    embyRoots: [...embyRoots].sort(),
    adultRoots: [...adultRoots].sort(),
    smartTaskEnabledActions: Array.isArray(config.smartTaskEnabledActions)
      ? config.smartTaskEnabledActions
      : [],
  };
}

function sqliteCounts(Database, dataDir) {
  const libraryDb = new Database(path.join(dataDir, 'library.db'), { readonly: true });
  const tasksDb = new Database(path.join(dataDir, 'tasks.db'), { readonly: true });
  try {
    const libraryCount = timed('library.count', () => libraryDb.prepare('SELECT COUNT(*) AS count FROM media_items').get().count);
    const metadataMissingReasons = timed('library.metadata_missing_reasons', () => libraryDb.prepare(`
      SELECT json_each.value AS reason, COUNT(*) AS count
      FROM media_items,
        json_each(CASE
          WHEN json_valid(metadata_missing_reasons_json) THEN metadata_missing_reasons_json
          ELSE '[]'
        END)
      WHERE metadata_complete = 0
      GROUP BY json_each.value
      ORDER BY count DESC, reason ASC
      LIMIT 8
    `).all());
    const taskCount = timed('tasks.count', () => tasksDb.prepare('SELECT COUNT(*) AS count FROM tasks').get().count);
    const taskEventCount = timed('task_events.count', () => tasksDb.prepare('SELECT COUNT(*) AS count FROM task_events').get().count);
    const tasksByStatusAction = timed('tasks.by_status_action', () => tasksDb.prepare(`
      SELECT status, action_type AS actionType, COUNT(*) AS count
      FROM tasks
      GROUP BY status, action_type
      ORDER BY status, action_type
    `).all());
    return {
      libraryCount,
      metadataMissingReasons,
      taskCount,
      taskEventCount,
      tasksByStatusAction,
    };
  } finally {
    libraryDb.close();
    tasksDb.close();
  }
}

function main() {
  const dataDir = path.resolve(process.argv[2] || DEFAULT_DATA_DIR);
  const required = ['config.json', 'library.db', 'tasks.db'];
  const files = {};
  for (const name of required) {
    files[name] = ensureFile(path.join(dataDir, name));
  }
  const config = readJson(path.join(dataDir, 'config.json'));
  const Database = loadBetterSqlite3();
  const result = {
    ok: true,
    dataDir,
    files,
    config: inspectConfig(config),
    sqlite: sqliteCounts(Database, dataDir),
  };
  console.log(JSON.stringify(result, null, 2));
}

main();
