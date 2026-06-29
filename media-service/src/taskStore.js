'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const diagnosticLog = require('./diagnosticLog');

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
const DEFAULT_WAL_CHECKPOINT_MIN_BYTES = 32 * 1024 * 1024;

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
    CREATE TABLE IF NOT EXISTS task_store_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_action_status_priority ON tasks(action_type, status, priority, created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_item_id ON tasks(item_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_status_updated_at ON tasks(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_action_updated_at ON tasks(action_type, updated_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_action_status_updated_at ON tasks(action_type, status, updated_at);
  `);
  ensureSpaceStatColumns(db);
  ensureTaskEventTable(db);
  dbCache.set(dbPath, db);
  migrateJsonTasksIfNeeded(db);
  backfillSpaceStatColumns(db);
  checkpointWal(db, 'startup');
  return db;
}

function ensureSpaceStatColumns(db) {
  const existing = new Set(db.prepare('PRAGMA table_info(tasks)').all().map((row) => row.name));
  const columns = {
    verify_bytes_saved: 'REAL',
    verify_size_bytes: 'REAL',
    original_size_bytes: 'REAL',
    upgrade_old_size: 'REAL',
    upgrade_new_size: 'REAL',
  };
  for (const [name, type] of Object.entries(columns)) {
    if (!existing.has(name)) db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${type}`);
  }
}

function ensureTaskEventTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_events (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL DEFAULT '',
      item_id TEXT NOT NULL DEFAULT '',
      action_type TEXT NOT NULL DEFAULT '',
      event_type TEXT NOT NULL DEFAULT '',
      event_status TEXT NOT NULL DEFAULT '',
      phase TEXT,
      resume_point TEXT,
      resource_type TEXT,
      created_at TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_task_events_task_created ON task_events(task_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_task_events_type_created ON task_events(event_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_task_events_status_created ON task_events(event_status, created_at);
    CREATE INDEX IF NOT EXISTS idx_task_events_item_created ON task_events(item_id, created_at);
  `);
}

function backfillSpaceStatColumns(db) {
  const version = db.prepare('SELECT value FROM task_store_meta WHERE key = ?').get('space_stat_columns_backfilled');
  if (version && version.value === '1') return;
  db.prepare(`
    UPDATE tasks
    SET
      verify_bytes_saved = json_extract(payload_json, '$.verifyResult.bytesSaved'),
      verify_size_bytes = json_extract(payload_json, '$.verifyResult.sizeBytes'),
      original_size_bytes = json_extract(payload_json, '$.itemInfo.originalSizeBytes'),
      upgrade_old_size = json_extract(payload_json, '$.upgradePreview.oldFile.size'),
      upgrade_new_size = json_extract(payload_json, '$.upgradePreview.newFile.size')
    WHERE status = 'done'
      AND action_type IN ('transcode', 'upgrade', 'delete')
  `).run();
  db.prepare(`
    INSERT INTO task_store_meta (key, value)
    VALUES ('space_stat_columns_backfilled', '1')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run();
}

function walCheckpointMinBytes() {
  const value = Number(process.env.SHELFDECK_TASK_WAL_CHECKPOINT_MIN_BYTES);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_WAL_CHECKPOINT_MIN_BYTES;
}

function checkpointWal(db, reason, opts = {}) {
  const before = getStorageMetrics();
  const startedAtMs = Date.now();
  const minWalSizeBytes = Number(opts.minWalSizeBytes) >= 0
    ? Number(opts.minWalSizeBytes)
    : walCheckpointMinBytes();
  const force = opts.force === true;
  const shouldRun = force || before.walSizeBytes >= minWalSizeBytes;
  if (!shouldRun) {
    const endedAtMs = Date.now();
    diagnosticLog.record({
      category: 'storage',
      scope: 'taskStore.checkpointWal',
      operation: 'wal_checkpoint',
      component: 'taskStore',
      resourceType: 'sqlite',
      resourceKey: 'tasks.db-wal',
      status: 'skipped',
      startedAtMs,
      endedAtMs,
      slowMs: 250,
      payload: {
        reason,
        trigger: 'wal_below_threshold',
        minWalSizeBytes,
        before,
      },
    });
    return { skipped: true, reason: 'wal_below_threshold', before, minWalSizeBytes };
  }
  try {
    const result = db.pragma('wal_checkpoint(TRUNCATE)');
    const endedAtMs = Date.now();
    const after = getStorageMetrics();
    diagnosticLog.record({
      category: 'storage',
      scope: 'taskStore.checkpointWal',
      operation: 'wal_checkpoint',
      component: 'taskStore',
      resourceType: 'sqlite',
      resourceKey: 'tasks.db-wal',
      startedAtMs,
      endedAtMs,
      slowMs: 250,
      payload: {
        reason,
        trigger: force ? 'forced' : 'wal_size_threshold',
        minWalSizeBytes,
        before,
        after,
        result,
      },
    });
    return result;
  } catch (err) {
    const endedAtMs = Date.now();
    diagnosticLog.record({
      category: 'storage',
      scope: 'taskStore.checkpointWal',
      operation: 'wal_checkpoint',
      component: 'taskStore',
      resourceType: 'sqlite',
      resourceKey: 'tasks.db-wal',
      status: 'failed',
      startedAtMs,
      endedAtMs,
      payload: { reason, before, error: err.message },
    });
    console.warn(`[taskStore] WAL checkpoint skipped${reason ? ` (${reason})` : ''}: ${err.message}`);
    return null;
  }
}

function getStorageMetrics() {
  return diagnosticLog.storageSnapshot({
    store: 'tasks',
    dbName: 'tasks.db',
    resourceKey: 'tasks.db',
    dbPath: tasksDbFilePath(),
  });
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
    checkpointWal(db, 'migration', { force: true });
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
  t.manualExecuteRequested = !!t.manualExecuteRequested;
  return t;
}

function taskToRow(task) {
  const t = normalizeTask(task);
  const space = taskSpaceStatColumns(t);
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
    ...space,
  };
}

function finiteNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function taskSpaceStatColumns(task) {
  const verify = task && task.verifyResult && typeof task.verifyResult === 'object' ? task.verifyResult : {};
  const info = task && task.itemInfo && typeof task.itemInfo === 'object' ? task.itemInfo : {};
  const preview = task && task.upgradePreview && typeof task.upgradePreview === 'object' ? task.upgradePreview : {};
  return {
    verify_bytes_saved: finiteNumberOrNull(verify.bytesSaved),
    verify_size_bytes: finiteNumberOrNull(verify.sizeBytes),
    original_size_bytes: finiteNumberOrNull(info.originalSizeBytes),
    upgrade_old_size: finiteNumberOrNull(preview.oldFile && preview.oldFile.size),
    upgrade_new_size: finiteNumberOrNull(preview.newFile && preview.newFile.size),
  };
}

function eventPayloadFor(task, payload = {}) {
  const base = payload && typeof payload === 'object' ? { ...payload } : {};
  return {
    ...base,
    taskId: task && task.id,
    itemId: task && task.itemId,
    actionType: task && task.actionType,
    status: task && task.status,
    phase: task && task.phase,
    resumePoint: task && task.resumePoint,
  };
}

function buildTaskEvent(task, eventType, payload = {}, opts = {}) {
  const now = opts.createdAt || new Date().toISOString();
  const t = task || {};
  return {
    id: opts.id || generateId(),
    taskId: String(opts.taskId || t.id || ''),
    itemId: String(opts.itemId || t.itemId || ''),
    actionType: String(opts.actionType || t.actionType || ''),
    eventType: String(eventType || opts.eventType || ''),
    eventStatus: String(opts.eventStatus || t.status || ''),
    phase: opts.phase !== undefined ? opts.phase : (t.phase === undefined ? null : t.phase),
    resumePoint: opts.resumePoint !== undefined ? opts.resumePoint : (t.resumePoint === undefined ? null : t.resumePoint),
    resourceType: opts.resourceType || null,
    createdAt: now,
    payload: eventPayloadFor(t, payload),
  };
}

function taskEventToRow(event) {
  return {
    id: event.id,
    task_id: event.taskId,
    item_id: event.itemId,
    action_type: event.actionType,
    event_type: event.eventType,
    event_status: event.eventStatus,
    phase: event.phase,
    resume_point: event.resumePoint,
    resource_type: event.resourceType,
    created_at: event.createdAt,
    payload_json: jsonStringify(event.payload),
  };
}

function rowToTaskEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    taskId: row.task_id || '',
    itemId: row.item_id || '',
    actionType: row.action_type || '',
    eventType: row.event_type || '',
    eventStatus: row.event_status || '',
    phase: row.phase,
    resumePoint: row.resume_point,
    resourceType: row.resource_type,
    createdAt: row.created_at || '',
    payload: jsonParse(row.payload_json, {}),
  };
}

function appendTaskEvent(task, eventType, payload = {}, opts = {}) {
  if (!task || !task.id || !eventType) return null;
  try {
    return diagnosticLog.track({
      category: 'store',
      scope: 'taskStore.writeTaskEvent',
      operation: 'append_task_event',
      component: 'taskStore',
      resourceType: 'sqlite',
      resourceKey: 'tasks.db',
      slowMs: 100,
      payload: { taskId: task.id, eventType, actionType: task.actionType },
      successPayload: (event) => ({ writtenRows: event ? 1 : 0 }),
    }, () => {
      const event = buildTaskEvent(task, eventType, payload, opts);
      getDb().prepare(`
        INSERT INTO task_events
          (id, task_id, item_id, action_type, event_type, event_status, phase, resume_point, resource_type, created_at, payload_json)
        VALUES
          (@id, @task_id, @item_id, @action_type, @event_type, @event_status, @phase, @resume_point, @resource_type, @created_at, @payload_json)
      `).run(taskEventToRow(event));
      return event;
    });
  } catch (err) {
    console.warn(`[taskStore] task event shadow write skipped: ${err.message}`);
    return null;
  }
}

function appendTaskEvents(events) {
  const rows = (events || []).filter(Boolean).map((event) => taskEventToRow(event));
  if (!rows.length) return 0;
  try {
    return diagnosticLog.track({
      category: 'store',
      scope: 'taskStore.writeTaskEvent',
      operation: 'append_task_events',
      component: 'taskStore',
      resourceType: 'sqlite',
      resourceKey: 'tasks.db',
      slowMs: 150,
      payload: { inputRows: rows.length },
      successPayload: (writtenRows) => ({ writtenRows }),
    }, () => {
      const db = getDb();
      const insert = db.prepare(`
        INSERT INTO task_events
          (id, task_id, item_id, action_type, event_type, event_status, phase, resume_point, resource_type, created_at, payload_json)
        VALUES
          (@id, @task_id, @item_id, @action_type, @event_type, @event_status, @phase, @resume_point, @resource_type, @created_at, @payload_json)
      `);
      const tx = db.transaction((eventRows) => {
        for (const row of eventRows) insert.run(row);
      });
      tx(rows);
      return rows.length;
    });
  } catch (err) {
    console.warn(`[taskStore] task event shadow batch write skipped: ${err.message}`);
    return 0;
  }
}

function taskUpdateEvents(current, updated, updates = {}) {
  const events = [];
  const statusChanged = updates.status !== undefined && current.status !== updated.status;
  const phaseChanged = updates.phase !== undefined && current.phase !== updated.phase;
  const resumeChanged = updates.resumePoint !== undefined && current.resumePoint !== updated.resumePoint;

  if (statusChanged) {
    events.push(buildTaskEvent(updated, 'task.status_changed', {
      fromStatus: current.status,
      toStatus: updated.status,
    }));
  }
  if (phaseChanged || resumeChanged) {
    events.push(buildTaskEvent(updated, 'task.runtime_changed', {
      fromPhase: current.phase,
      toPhase: updated.phase,
      fromResumePoint: current.resumePoint,
      toResumePoint: updated.resumePoint,
    }));
  }
  if (updates.approval && typeof updates.approval === 'object') {
    events.push(buildTaskEvent(updated, 'approval.requested', {
      gateId: updates.approval.gateId,
      message: updates.approval.message,
      options: updates.approval.options,
    }));
  }
  if (updates.priority !== undefined && current.priority !== updated.priority) {
    events.push(buildTaskEvent(updated, 'task.priority_changed', {
      fromPriority: current.priority,
      toPriority: updated.priority,
      manuallyAdjusted: !!updates.priorityManuallyAdjusted,
    }));
  }
  if (updates.manualExecuteRequested === true && !current.manualExecuteRequested) {
    events.push(buildTaskEvent(updated, 'task.manual_execute_requested', {}));
  }
  return events;
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
    (id, item_id, item_name, action_type, status, priority, created_at, updated_at, payload_json,
     verify_bytes_saved, verify_size_bytes, original_size_bytes, upgrade_old_size, upgrade_new_size)
  VALUES
    (@id, @item_id, @item_name, @action_type, @status, @priority, @created_at, @updated_at, @payload_json,
     @verify_bytes_saved, @verify_size_bytes, @original_size_bytes, @upgrade_old_size, @upgrade_new_size)
  ON CONFLICT(id) DO UPDATE SET
    item_id = excluded.item_id,
    item_name = excluded.item_name,
    action_type = excluded.action_type,
    status = excluded.status,
    priority = excluded.priority,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    payload_json = excluded.payload_json,
    verify_bytes_saved = excluded.verify_bytes_saved,
    verify_size_bytes = excluded.verify_size_bytes,
    original_size_bytes = excluded.original_size_bytes,
    upgrade_old_size = excluded.upgrade_old_size,
    upgrade_new_size = excluded.upgrade_new_size
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
    manualExecuteRequested: !!taskData.manualExecuteRequested,
    priorityManuallyAdjusted: !!taskData.priorityManuallyAdjusted,
    priorityModelVersion: taskData.priorityModelVersion,
    priorityBreakdown: taskData.priorityBreakdown,
  });
}

function createTask(taskData) {
  return diagnosticLog.track({
    category: 'store',
    scope: 'taskStore.createTask',
    operation: 'create_task',
    component: 'taskStore',
    resourceType: 'sqlite',
    resourceKey: 'tasks.db',
    slowMs: 150,
    payload: {
      itemId: taskData && taskData.itemId,
      actionType: taskData && taskData.actionType,
      source: taskData && taskData.source,
      before: getStorageMetrics(),
    },
    successPayload: (task) => ({ taskId: task && task.id, writtenRows: task ? 1 : 0, after: getStorageMetrics() }),
  }, () => {
    const db = getDb();
    const task = buildTask(taskData);
    db.prepare(upsertSql).run(taskToRow(task));
    appendTaskEvent(task, 'task.created', {
      source: task.source,
      priority: task.priority,
      priorityModelVersion: task.priorityModelVersion,
    });
    return task;
  });
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
  const maxPageSize = Math.max(1, Number.parseInt(options.maxPageSize, 10) || 100);
  const pageSize = Math.min(maxPageSize, Math.max(1, Number.parseInt(options.pageSize, 10) || 20));
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

function queryTaskEvents(filter = {}, options = {}) {
  const db = getDb();
  const clauses = [];
  const params = {};
  if (filter.taskId) {
    clauses.push('task_id = @taskId');
    params.taskId = String(filter.taskId);
  }
  if (filter.itemId) {
    clauses.push('item_id = @itemId');
    params.itemId = String(filter.itemId);
  }
  if (filter.eventType) {
    clauses.push('event_type = @eventType');
    params.eventType = String(filter.eventType);
  }
  if (filter.status) {
    clauses.push('event_status = @status');
    params.status = String(filter.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const page = Math.max(1, Number.parseInt(options.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, Number.parseInt(options.pageSize, 10) || 50));
  const offset = (page - 1) * pageSize;
  const orderDir = String(options.orderDir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const total = db.prepare(`SELECT COUNT(*) AS count FROM task_events ${where}`).get(params).count || 0;
  const rows = db.prepare(`
    SELECT * FROM task_events ${where}
    ORDER BY created_at ${orderDir}, id ${orderDir}
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit: pageSize, offset });

  return {
    events: rows.map(rowToTaskEvent),
    total,
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
  const maxPageSize = Math.max(1, Number.parseInt(options.maxPageSize, 10) || 100);
  const pageSize = Math.min(maxPageSize, Math.max(1, Number.parseInt(options.pageSize, 10) || 20));
  const offset = (page - 1) * pageSize;
  const orderBy = options.orderBy === 'createdAt' ? 'created_at' : 'updated_at';
  const orderDir = String(options.orderDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const terminalList = [...TERMINAL_STATUSES].map((status) => `'${status}'`).join(', ');
  const activeJson = (jsonPath) => `CASE WHEN status NOT IN (${terminalList}) THEN json_extract(payload_json, '${jsonPath}') END`;

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
      ${activeJson('$.progress')} AS progress,
      ${activeJson('$.source')} AS source,
      ${activeJson('$.phase')} AS phase,
      ${activeJson('$.resumePoint')} AS resume_point,
      ${activeJson('$.nodeId')} AS node_id,
      ${activeJson('$.approval')} AS approval_json,
      ${activeJson('$.verifyResult.sizeBytes')} AS verify_size_bytes,
      ${activeJson('$.verifyResult.bitrate')} AS verify_bitrate,
      ${activeJson('$.verifyResult.videoCodec')} AS verify_video_codec,
      ${activeJson('$.verifyResult.audioCodec')} AS verify_audio_codec,
      ${activeJson('$.verifyResult.width')} AS verify_width,
      ${activeJson('$.verifyResult.height')} AS verify_height,
      ${activeJson('$.verifyResult.previewPath')} AS verify_preview_path,
      ${activeJson('$.verifyResult.outputPath')} AS verify_output_path,
      ${activeJson('$.verifyResult.bytesSaved')} AS verify_bytes_saved,
      ${activeJson('$.itemInfo.name')} AS info_name,
      ${activeJson('$.itemInfo.title')} AS info_title,
      ${activeJson('$.itemInfo.type')} AS info_type,
      ${activeJson('$.itemInfo.seriesName')} AS info_series_name,
      ${activeJson('$.itemInfo.seasonNumber')} AS info_season_number,
      ${activeJson('$.itemInfo.path')} AS info_path,
      ${activeJson('$.itemInfo.subLibraryId')} AS info_sub_library_id,
      ${activeJson('$.itemInfo.originalSizeBytes')} AS info_original_size_bytes,
      ${activeJson('$.itemInfo.originalBitrate')} AS info_original_bitrate,
      ${activeJson('$.itemInfo.originalVideoCodec')} AS info_original_video_codec,
      ${activeJson('$.itemInfo.originalAudioCodec')} AS info_original_audio_codec,
      ${activeJson('$.itemInfo.originalWidth')} AS info_original_width,
      ${activeJson('$.itemInfo.originalHeight')} AS info_original_height,
      ${activeJson('$.itemInfo.adultMetadata.adultId')} AS adult_id,
      ${activeJson('$.itemInfo.adultMetadata.scrapeStatus')} AS adult_scrape_status,
      ${activeJson('$.itemInfo.adultMetadata.region')} AS adult_region,
      ${activeJson('$.itemInfo.adultMetadata.protagonist')} AS adult_protagonist_json
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
      const verifyResult = {
        sizeBytes: row.verify_size_bytes,
        bitrate: row.verify_bitrate,
        videoCodec: row.verify_video_codec || undefined,
        audioCodec: row.verify_audio_codec || undefined,
        width: row.verify_width,
        height: row.verify_height,
        previewPath: row.verify_preview_path || undefined,
        outputPath: row.verify_output_path || undefined,
        bytesSaved: row.verify_bytes_saved,
      };
      Object.keys(verifyResult).forEach((key) => {
        if (verifyResult[key] === undefined || verifyResult[key] === null) delete verifyResult[key];
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
        nodeId: row.node_id || undefined,
        approval: jsonExtractObject(row.approval_json, undefined),
        priority: typeof row.priority === 'number' ? row.priority : 100,
        createdAt: row.created_at || '',
        updatedAt: row.updated_at || '',
        itemInfo: Object.keys(itemInfo).length > 0 ? itemInfo : undefined,
        verifyResult: Object.keys(verifyResult).length > 0 ? verifyResult : undefined,
      };
    }),
    total,
    byStatus,
    page,
    pageSize,
  };
}

function querySchedulerTasks() {
  return diagnosticLog.track({
    category: 'store',
    scope: 'taskStore.querySchedulerTasks',
    operation: 'query_scheduler_tasks',
    component: 'taskStore',
    resourceType: 'sqlite',
    resourceKey: 'tasks.db',
    slowMs: 150,
    successPayload: (rows) => ({ rowCount: Array.isArray(rows) ? rows.length : 0 }),
  }, () => {
    const db = getDb();
    const terminals = [...TERMINAL_STATUSES];
    const params = {};
    const terminalSql = terminals.map((status, i) => {
      params[`terminal${i}`] = status;
      return `@terminal${i}`;
    }).join(', ');

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
        json_extract(payload_json, '$.manualExecuteRequested') AS manual_execute_requested,
        json_extract(payload_json, '$.priorityManuallyAdjusted') AS priority_manually_adjusted,
        json_extract(payload_json, '$.priorityModelVersion') AS priority_model_version,
        json_extract(payload_json, '$.priorityBreakdown') AS priority_breakdown_json,
        json_extract(payload_json, '$.retryCount') AS retry_count,
        json_extract(payload_json, '$.pausingRequested') AS pausing_requested,
        json_extract(payload_json, '$.nodeId') AS node_id,
        json_extract(payload_json, '$.itemInfo') AS item_info_json
      FROM tasks
      WHERE status NOT IN (${terminalSql})
      ORDER BY priority ASC, created_at ASC, id ASC
    `).all(params);

    return rows.map((row) => ({
      id: row.id,
      itemId: row.item_id || '',
      itemName: row.item_name || '',
      actionType: row.action_type || '',
      status: row.status || '',
      priority: typeof row.priority === 'number' ? row.priority : 100,
      createdAt: row.created_at || '',
      updatedAt: row.updated_at || '',
      progress: progressCache.get(row.id) ?? (typeof row.progress === 'number' ? row.progress : 0),
      source: row.source || '',
      phase: row.phase,
      resumePoint: row.resume_point,
      manualExecuteRequested: !!row.manual_execute_requested,
      priorityManuallyAdjusted: !!row.priority_manually_adjusted,
      priorityModelVersion: row.priority_model_version,
      priorityBreakdown: jsonExtractObject(row.priority_breakdown_json, undefined),
      retryCount: typeof row.retry_count === 'number' ? row.retry_count : 0,
      pausingRequested: !!row.pausing_requested,
      nodeId: row.node_id || undefined,
      itemInfo: jsonExtractObject(row.item_info_json, null),
    }));
  });
}

function queryOptimizationTaskIndexRows(filter = {}) {
  const params = {};
  let itemFilter = '';
  if (Array.isArray(filter.itemIds) && filter.itemIds.length > 0) {
    const ids = [...new Set(filter.itemIds.map((id) => String(id || '')).filter(Boolean))];
    if (ids.length > 0) {
      itemFilter = `AND item_id IN (${ids.map((_, i) => `@itemId${i}`).join(', ')})`;
      ids.forEach((id, i) => { params[`itemId${i}`] = id; });
    }
  }

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
      ${itemFilter}
  `).all(params);

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

function queryTaskAdmissionRows() {
  return diagnosticLog.track({
    category: 'store',
    scope: 'taskStore.queryTaskAdmissionRows',
    operation: 'query_task_admission_rows',
    component: 'taskStore',
    resourceType: 'sqlite',
    resourceKey: 'tasks.db',
    slowMs: 150,
    successPayload: (rows) => ({ rowCount: Array.isArray(rows) ? rows.length : 0 }),
  }, () => {
    const rows = getDb().prepare(`
      SELECT id, item_id, action_type, status, created_at, updated_at
      FROM tasks
      ORDER BY updated_at DESC, id DESC
    `).all();

    return rows.map((row) => ({
      id: row.id,
      itemId: row.item_id || '',
      actionType: row.action_type || '',
      status: row.status || '',
      createdAt: row.created_at || '',
      updatedAt: row.updated_at || '',
    }));
  });
}

function querySpaceStatTaskRows() {
  const rows = getDb().prepare(`
    SELECT
      id,
      item_id,
      action_type,
      verify_bytes_saved,
      verify_size_bytes,
      original_size_bytes,
      upgrade_old_size,
      upgrade_new_size
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
  appendTaskEvents(taskUpdateEvents(current, updated, final));

  if (final.status) statusCache.set(taskId, final.status);
  if (TERMINAL_STATUSES.has(final.status) || final.status === 'failed_soft') {
    progressCache.delete(taskId);
  }

  return updated;
}

function deleteTask(taskId) {
  const db = getDb();
  const task = getTask(taskId);
  const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(String(taskId || ''));
  if (result.changes <= 0) return false;
  appendTaskEvent(task, 'task.deleted', {});
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
  querySchedulerTasks,
  queryTaskEvents,
  appendTaskEvent,
  queryOptimizationTaskIndexRows,
  queryTaskAdmissionRows,
  querySpaceStatTaskRows,
  getStorageMetrics,
  setProgress,
  getProgress,
  deleteProgress,
  getCachedStatus,
};
