'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

function resolveDataDir() {
  return (
    process.env.CONTROL_PLANE_DATA_DIR ||
    process.env.MEDIA_SERVICE_DATA_DIR ||
    path.join(__dirname, '..', 'data')
  );
}

function tasksJsonFilePath() {
  return path.join(resolveDataDir(), 'tasks.json');
}

function tasksDbFilePath() {
  return path.join(resolveDataDir(), 'tasks.db');
}

function migrationMarkerPath() {
  return path.join(resolveDataDir(), 'tasks.json.migrated');
}

function ensureDataDir() {
  const dir = resolveDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const TERMINAL_STATUSES = new Set(['done', 'failed_hard', 'cancelled', 'skipped', 'deleted']);
const dbCache = new Map();

function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

function jsonStringify(value) {
  return JSON.stringify(value == null ? null : value);
}

function jsonParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_) {
    return fallback;
  }
}

function getDb() {
  ensureDataDir();
  const dbPath = tasksDbFilePath();
  let db = dbCache.get(dbPath);
  if (db) return db;

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL DEFAULT '',
      item_name TEXT NOT NULL DEFAULT '',
      action_type TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      priority INTEGER NOT NULL DEFAULT 100,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_action_status_priority ON tasks(action_type, status, priority, created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_item_id ON tasks(item_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_status_updated_at ON tasks(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_action_updated_at ON tasks(action_type, updated_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_action_status_updated_at ON tasks(action_type, status, updated_at);
  `);
  dbCache.set(dbPath, db);
  migrateJsonTasksIfNeeded(db);
  checkpointWal(db, 'startup');
  return db;
}

function checkpointWal(db, reason) {
  try {
    return db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (err) {
    console.warn(`[taskStore] WAL checkpoint skipped${reason ? ` (${reason})` : ''}: ${err.message}`);
    return null;
  }
}

function readLegacyJsonTasks(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw || !raw.trim()) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function migrateJsonTasksIfNeeded(db) {
  const jsonPath = tasksJsonFilePath();
  const marker = migrationMarkerPath();
  if (!fs.existsSync(jsonPath) || fs.existsSync(marker)) return;

  const existing = db.prepare('SELECT COUNT(*) AS count FROM tasks').get().count || 0;
  if (existing > 0) {
    fs.writeFileSync(marker, JSON.stringify({
      migratedAt: new Date().toISOString(),
      skipped: true,
      reason: 'tasks.db already contains rows',
    }, null, 2), 'utf8');
    return;
  }

  try {
    const tasks = readLegacyJsonTasks(jsonPath);
    const insert = db.prepare(`
      INSERT OR IGNORE INTO tasks
        (id, item_id, item_name, action_type, status, priority, created_at, updated_at, payload_json)
      VALUES
        (@id, @item_id, @item_name, @action_type, @status, @priority, @created_at, @updated_at, @payload_json)
    `);
    const tx = db.transaction((rows) => {
      for (const task of rows) insert.run(taskToRow(normalizeTask(task)));
    });
    tx(tasks);
    checkpointWal(db, 'migration');
    fs.writeFileSync(marker, JSON.stringify({
      migratedAt: new Date().toISOString(),
      source: path.basename(jsonPath),
      target: path.basename(tasksDbFilePath()),
      count: tasks.length,
    }, null, 2), 'utf8');
    console.log(`[taskStore] migrated ${tasks.length} task(s) from tasks.json to tasks.db`);
  } catch (err) {
    console.error('[taskStore] failed to migrate tasks.json:', err.message);
    try {
      const bak = `${jsonPath}.bak.${Date.now()}`;
      fs.copyFileSync(jsonPath, bak);
      console.error('[taskStore] migration source backed up to', bak);
    } catch (_) {}
    throw err;
  }
}

function normalizeTask(task) {
  const now = new Date().toISOString();
  const t = task && typeof task === 'object' ? { ...task } : {};
  t.id = String(t.id || generateId());
  t.itemId = String(t.itemId || '');
  t.itemName = String(t.itemName || (t.itemInfo && t.itemInfo.name) || '');
  t.actionType = String(t.actionType || '');
  t.source = String(t.source || (t.itemInfo && t.itemInfo.taskSource) || '');
  t.status = String(t.status || 'created');
  t.progress = typeof t.progress === 'number' ? t.progress : 0;
  t.phase = t.phase === undefined ? null : t.phase;
  t.resumePoint = t.resumePoint === undefined ? null : t.resumePoint;
  t.priority = typeof t.priority === 'number' ? t.priority : 100;
  t.createdAt = String(t.createdAt || now);
  t.updatedAt = String(t.updatedAt || t.createdAt || now);
  t.logs = Array.isArray(t.logs) ? t.logs : [];
  t.itemInfo = t.itemInfo === undefined ? null : t.itemInfo;
  return t;
}

function taskToRow(task) {
  const t = normalizeTask(task);
  return {
    id: t.id,
    item_id: t.itemId,
    item_name: t.itemName || (t.itemInfo && t.itemInfo.name) || '',
    action_type: t.actionType,
    status: t.status,
    priority: typeof t.priority === 'number' ? t.priority : 100,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
    payload_json: jsonStringify(t),
  };
}

function rowToTask(row) {
  if (!row) return null;
  const task = normalizeTask(jsonParse(row.payload_json, {}));
  task.id = row.id;
  task.itemId = row.item_id || task.itemId || '';
  task.itemName = row.item_name || task.itemName || '';
  task.actionType = row.action_type || task.actionType || '';
  task.status = row.status || task.status || '';
  task.priority = typeof row.priority === 'number' ? row.priority : task.priority;
  task.createdAt = row.created_at || task.createdAt;
  task.updatedAt = row.updated_at || task.updatedAt;
  task.progress = progressCache.get(task.id) ?? task.progress ?? 0;
  return task;
}

const upsertSql = `
  INSERT INTO tasks
    (id, item_id, item_name, action_type, status, priority, created_at, updated_at, payload_json)
  VALUES
    (@id, @item_id, @item_name, @action_type, @status, @priority, @created_at, @updated_at, @payload_json)
  ON CONFLICT(id) DO UPDATE SET
    item_id = excluded.item_id,
    item_name = excluded.item_name,
    action_type = excluded.action_type,
    status = excluded.status,
    priority = excluded.priority,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    payload_json = excluded.payload_json
`;

function buildTask(taskData, now = new Date().toISOString()) {
  return normalizeTask({
    id: generateId(),
    itemId: taskData.itemId || '',
    itemName: taskData.itemName || (taskData.itemInfo && taskData.itemInfo.name) || '',
    actionType: taskData.actionType,
    source: taskData.source || (taskData.itemInfo && taskData.itemInfo.taskSource) || '',
    status: taskData.status || 'created',
    progress: 0,
    phase: null,
    resumePoint: null,
    priority: typeof taskData.priority === 'number' ? taskData.priority : 100,
    createdAt: now,
    updatedAt: now,
    logs: Array.isArray(taskData.logs) ? taskData.logs : [],
    itemInfo: taskData.itemInfo || null,
  });
}

function createTask(taskData) {
  const db = getDb();
  const task = buildTask(taskData);
  db.prepare(upsertSql).run(taskToRow(task));
  return task;
}

function loadTasks(options = {}) {
  return selectTasks({}, options);
}

function saveTasks(tasks) {
  const db = getDb();
  const upsert = db.prepare(upsertSql);
  const tx = db.transaction((rows) => {
    for (const task of rows || []) upsert.run(taskToRow(task));
  });
  tx(tasks || []);
  checkpointWal(db, 'save_tasks');
}

function getTask(taskId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(String(taskId || ''));
  return rowToTask(row);
}

function buildWhere(filter = {}, options = {}) {
  const clauses = [];
  const params = {};

  if (options.includeHistory === false) {
    const terminals = [...TERMINAL_STATUSES];
    clauses.push(`status NOT IN (${terminals.map((_, i) => `@terminal${i}`).join(', ')})`);
    terminals.forEach((status, i) => { params[`terminal${i}`] = status; });
  }
  if (filter.status) {
    clauses.push('status = @status');
    params.status = String(filter.status);
  }
  if (Array.isArray(filter.statuses) && filter.statuses.length > 0) {
    const statuses = filter.statuses.map((status) => String(status || '').trim()).filter(Boolean);
    if (statuses.length > 0) {
      clauses.push(`status IN (${statuses.map((_, i) => `@statusIn${i}`).join(', ')})`);
      statuses.forEach((status, i) => { params[`statusIn${i}`] = status; });
    }
  }
  if (filter.actionType) {
    clauses.push('action_type = @actionType');
    params.actionType = String(filter.actionType);
  }
  if (filter.itemId) {
    clauses.push('item_id = @itemId');
    params.itemId = String(filter.itemId);
  }
  if (filter.q) {
    clauses.push('(LOWER(item_name) LIKE @q OR LOWER(item_id) LIKE @q)');
    params.q = `%${String(filter.q).toLowerCase()}%`;
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return { where, params };
}

function selectTasks(filter = {}, options = {}) {
  const db = getDb();
  const { where, params } = buildWhere(filter, options);
  const rows = db.prepare(`SELECT * FROM tasks ${where}`).all(params);
  return rows.map(rowToTask);
}

function getTasks(filter = {}) {
  return selectTasks(filter);
}

function queryTasks(filter = {}, options = {}) {
  const db = getDb();
  const { where, params } = buildWhere(filter, options);
  const page = Math.max(1, Number.parseInt(options.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(options.pageSize, 10) || 20));
  const offset = (page - 1) * pageSize;
  const orderBy = options.orderBy === 'createdAt' ? 'created_at' : 'updated_at';
  const orderDir = String(options.orderDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const total = db.prepare(`SELECT COUNT(*) AS count FROM tasks ${where}`).get(params).count || 0;
  const rows = db.prepare(`
    SELECT * FROM tasks ${where}
    ORDER BY ${orderBy} ${orderDir}, id ${orderDir}
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit: pageSize, offset });
  const statusRows = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM tasks ${where}
    GROUP BY status
  `).all(params);
  const byStatus = {};
  for (const row of statusRows) byStatus[row.status] = row.count;

  return {
    tasks: rows.map(rowToTask),
    total,
    byStatus,
    page,
    pageSize,
  };
}

function jsonExtractObject(value, fallback = undefined) {
  if (value == null) return fallback;
  if (typeof value === 'string') return jsonParse(value, fallback);
  return value;
}

function queryTaskSummaries(filter = {}, options = {}) {
  const db = getDb();
  const { where, params } = buildWhere(filter, options);
  const page = Math.max(1, Number.parseInt(options.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(options.pageSize, 10) || 20));
  const offset = (page - 1) * pageSize;
  const orderBy = options.orderBy === 'createdAt' ? 'created_at' : 'updated_at';
  const orderDir = String(options.orderDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const total = db.prepare(`SELECT COUNT(*) AS count FROM tasks ${where}`).get(params).count || 0;
  const rows = db.prepare(`
    SELECT
      id,
      item_id,
      item_name,
      action_type,
      status,
      priority,
      created_at,
      updated_at,
      json_extract(payload_json, '$.progress') AS progress,
      json_extract(payload_json, '$.source') AS source,
      json_extract(payload_json, '$.phase') AS phase,
      json_extract(payload_json, '$.resumePoint') AS resume_point,
      json_extract(payload_json, '$.approval') AS approval_json,
      json_extract(payload_json, '$.verifyResult') AS verify_result_json,
      json_extract(payload_json, '$.confirmData') AS confirm_data_json,
      json_extract(payload_json, '$.itemInfo.name') AS info_name,
      json_extract(payload_json, '$.itemInfo.title') AS info_title,
      json_extract(payload_json, '$.itemInfo.type') AS info_type,
      json_extract(payload_json, '$.itemInfo.seriesName') AS info_series_name,
      json_extract(payload_json, '$.itemInfo.seasonNumber') AS info_season_number,
      json_extract(payload_json, '$.itemInfo.path') AS info_path,
      json_extract(payload_json, '$.itemInfo.subLibraryId') AS info_sub_library_id,
      json_extract(payload_json, '$.itemInfo.originalSizeBytes') AS info_original_size_bytes,
      json_extract(payload_json, '$.itemInfo.originalBitrate') AS info_original_bitrate,
      json_extract(payload_json, '$.itemInfo.originalVideoCodec') AS info_original_video_codec,
      json_extract(payload_json, '$.itemInfo.originalAudioCodec') AS info_original_audio_codec,
      json_extract(payload_json, '$.itemInfo.originalWidth') AS info_original_width,
      json_extract(payload_json, '$.itemInfo.originalHeight') AS info_original_height,
      json_extract(payload_json, '$.itemInfo.adultMetadata.adultId') AS adult_id,
      json_extract(payload_json, '$.itemInfo.adultMetadata.scrapeStatus') AS adult_scrape_status,
      json_extract(payload_json, '$.itemInfo.adultMetadata.region') AS adult_region,
      json_extract(payload_json, '$.itemInfo.adultMetadata.protagonist') AS adult_protagonist_json
    FROM tasks ${where}
    ORDER BY ${orderBy} ${orderDir}, id ${orderDir}
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit: pageSize, offset });
  const statusRows = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM tasks ${where}
    GROUP BY status
  `).all(params);
  const byStatus = {};
  for (const row of statusRows) byStatus[row.status] = row.count;

  return {
    tasks: rows.map((row) => {
      const adultMetadata = (row.adult_id || row.adult_scrape_status || row.adult_region || row.adult_protagonist_json)
        ? {
          adultId: row.adult_id || undefined,
          scrapeStatus: row.adult_scrape_status || undefined,
          region: row.adult_region || undefined,
          protagonist: jsonExtractObject(row.adult_protagonist_json, undefined),
        }
        : undefined;
      const itemInfo = {
        name: row.info_name || undefined,
        title: row.info_title || undefined,
        type: row.info_type || undefined,
        seriesName: row.info_series_name || undefined,
        seasonNumber: row.info_season_number,
        path: row.info_path || undefined,
        subLibraryId: row.info_sub_library_id || undefined,
        adultMetadata,
        originalSizeBytes: row.info_original_size_bytes,
        originalBitrate: row.info_original_bitrate,
        originalVideoCodec: row.info_original_video_codec || undefined,
        originalAudioCodec: row.info_original_audio_codec || undefined,
        originalWidth: row.info_original_width,
        originalHeight: row.info_original_height,
      };
      Object.keys(itemInfo).forEach((key) => {
        if (itemInfo[key] === undefined || itemInfo[key] === null) delete itemInfo[key];
      });
      return {
        id: row.id,
        itemId: row.item_id || '',
        itemName: row.item_name || '',
        actionType: row.action_type || '',
        source: row.source || '',
        status: row.status || '',
        progress: progressCache.get(row.id) ?? (typeof row.progress === 'number' ? row.progress : 0),
        phase: row.phase,
        resumePoint: row.resume_point,
        approval: jsonExtractObject(row.approval_json, undefined),
        priority: typeof row.priority === 'number' ? row.priority : 100,
        createdAt: row.created_at || '',
        updatedAt: row.updated_at || '',
        itemInfo: Object.keys(itemInfo).length > 0 ? itemInfo : undefined,
        verifyResult: jsonExtractObject(row.verify_result_json, undefined),
        confirmData: jsonExtractObject(row.confirm_data_json, undefined),
      };
    }),
    total,
    byStatus,
    page,
    pageSize,
  };
}

function queryOptimizationTaskIndexRows() {
  const rows = getDb().prepare(`
    SELECT
      id,
      item_id,
      action_type,
      created_at,
      updated_at,
      json_extract(payload_json, '$.itemInfo.subLibraryId') AS sub_library_id,
      json_extract(payload_json, '$.itemInfo.path') AS item_path,
      json_extract(payload_json, '$.itemInfo.sourcePath') AS source_path,
      json_extract(payload_json, '$.itemInfo.originalSourcePath') AS original_source_path,
      json_extract(payload_json, '$.itemInfo.replacementTargetPath') AS replacement_target_path,
      json_extract(payload_json, '$.itemInfo.originalDiscPath') AS original_disc_path,
      json_extract(payload_json, '$.verifyResult.outputPath') AS output_path,
      json_extract(payload_json, '$.upgradePreview.oldFile.path') AS old_file_path,
      json_extract(payload_json, '$.upgradePreview.newFile.path') AS new_file_path
    FROM tasks
    WHERE status = 'done'
      AND action_type IN ('transcode', 'upgrade')
  `).all();

  return rows.map((row) => ({
    id: row.id,
    itemId: row.item_id,
    actionType: row.action_type,
    status: 'done',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    itemInfo: {
      subLibraryId: row.sub_library_id || '',
      path: row.item_path || '',
      sourcePath: row.source_path || '',
      originalSourcePath: row.original_source_path || '',
      replacementTargetPath: row.replacement_target_path || '',
      originalDiscPath: row.original_disc_path || '',
    },
    verifyResult: row.output_path ? { outputPath: row.output_path } : null,
    upgradePreview: (row.old_file_path || row.new_file_path)
      ? {
        oldFile: row.old_file_path ? { path: row.old_file_path } : null,
        newFile: row.new_file_path ? { path: row.new_file_path } : null,
      }
      : null,
  }));
}

function querySpaceStatTaskRows() {
  const rows = getDb().prepare(`
    SELECT
      id,
      item_id,
      action_type,
      json_extract(payload_json, '$.verifyResult.bytesSaved') AS verify_bytes_saved,
      json_extract(payload_json, '$.verifyResult.sizeBytes') AS verify_size_bytes,
      json_extract(payload_json, '$.itemInfo.originalSizeBytes') AS original_size_bytes,
      json_extract(payload_json, '$.upgradePreview.oldFile.size') AS upgrade_old_size,
      json_extract(payload_json, '$.upgradePreview.newFile.size') AS upgrade_new_size
    FROM tasks
    WHERE status = 'done'
      AND action_type IN ('transcode', 'upgrade', 'delete')
  `).all();

  return rows.map((row) => {
    const task = {
      id: row.id,
      itemId: row.item_id,
      actionType: row.action_type,
      status: 'done',
      itemInfo: {},
      verifyResult: {},
      upgradePreview: null,
    };
    if (row.original_size_bytes != null) task.itemInfo.originalSizeBytes = Number(row.original_size_bytes);
    if (row.verify_bytes_saved != null) task.verifyResult.bytesSaved = Number(row.verify_bytes_saved);
    if (row.verify_size_bytes != null) task.verifyResult.sizeBytes = Number(row.verify_size_bytes);
    if (row.upgrade_old_size != null || row.upgrade_new_size != null) {
      task.upgradePreview = {
        oldFile: row.upgrade_old_size == null ? null : { size: Number(row.upgrade_old_size) },
        newFile: row.upgrade_new_size == null ? null : { size: Number(row.upgrade_new_size) },
      };
    }
    if (Object.keys(task.itemInfo).length === 0) delete task.itemInfo;
    if (Object.keys(task.verifyResult).length === 0) delete task.verifyResult;
    return task;
  });
}

function updateTask(taskId, updates) {
  const current = getTask(taskId);
  if (!current) return null;

  let final = { ...(updates || {}) };
  if (Array.isArray(final.logs)) {
    const existing = Array.isArray(current.logs) ? current.logs : [];
    final.logs = [...existing, ...final.logs];
  }

  const updated = normalizeTask({
    ...current,
    ...final,
    updatedAt: new Date().toISOString(),
  });
  getDb().prepare(upsertSql).run(taskToRow(updated));

  if (final.status) statusCache.set(taskId, final.status);
  if (TERMINAL_STATUSES.has(final.status) || final.status === 'failed_soft') {
    progressCache.delete(taskId);
  }

  return updated;
}

function deleteTask(taskId) {
  const db = getDb();
  const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(String(taskId || ''));
  if (result.changes <= 0) return false;
  progressCache.delete(taskId);
  statusCache.delete(taskId);
  return true;
}

const progressCache = new Map();
const statusCache = new Map();

function setProgress(taskId, pct) {
  progressCache.set(taskId, pct);
}

function getProgress(taskId) {
  return progressCache.get(taskId) ?? 0;
}

function deleteProgress(taskId) {
  progressCache.delete(taskId);
}

function getCachedStatus(taskId) {
  return statusCache.get(taskId) || null;
}

module.exports = {
  buildTask,
  createTask,
  getTask,
  getTasks,
  updateTask,
  deleteTask,
  loadTasks,
  saveTasks,
  queryTasks,
  queryTaskSummaries,
  queryOptimizationTaskIndexRows,
  querySpaceStatTaskRows,
  setProgress,
  getProgress,
  deleteProgress,
  getCachedStatus,
};
