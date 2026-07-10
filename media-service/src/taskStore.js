'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const diagnosticLog = require('./diagnosticLog');
const flowPlanner = require('./flowPlanner');
const taskFactsModel = require('./taskFactsModel');

function resolveDataDir() {
  return (
    process.env.CONTROL_PLANE_DATA_DIR ||
    process.env.MEDIA_SERVICE_DATA_DIR ||
    path.join(__dirname, '..', 'data')
  );
}

function tasksDbFilePath() {
  return path.join(resolveDataDir(), 'tasks.db');
}

function ensureDataDir() {
  const dir = resolveDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const TERMINAL_STATUSES = new Set(['done', 'failed_hard', 'failed_soft', 'cancelled', 'skipped']);
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
      id TEXT PRIMARY KEY, item_id TEXT NOT NULL DEFAULT '', item_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '', priority INTEGER NOT NULL DEFAULT 100,
      created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '', payload_json TEXT NOT NULL,
      verify_bytes_saved REAL, verify_size_bytes REAL, original_size_bytes REAL,
      upgrade_old_size REAL, upgrade_new_size REAL, source TEXT NOT NULL DEFAULT '', progress REAL,
      phase TEXT, resume_point TEXT, manual_execute_requested INTEGER NOT NULL DEFAULT 0,
      priority_model_version TEXT NOT NULL DEFAULT '',
      retry_count INTEGER NOT NULL DEFAULT 0, pausing_requested INTEGER NOT NULL DEFAULT 0,
      node_id TEXT NOT NULL DEFAULT '', sub_library_id TEXT NOT NULL DEFAULT '', item_path TEXT NOT NULL DEFAULT '',
      bridge_kind TEXT NOT NULL DEFAULT '', bridge_from TEXT NOT NULL DEFAULT '', bridge_to TEXT NOT NULL DEFAULT '',
      bridge_reason TEXT NOT NULL DEFAULT '', flow_version TEXT NOT NULL DEFAULT '', flow_direction TEXT NOT NULL DEFAULT '',
      flow_kind TEXT NOT NULL DEFAULT '', flow_executor TEXT NOT NULL DEFAULT '', primary_resource_type TEXT NOT NULL DEFAULT '',
      resource_types_json TEXT NOT NULL DEFAULT '[]', flow_steps_json TEXT NOT NULL DEFAULT '[]',
      target_gate TEXT NOT NULL DEFAULT '', gate_objective_kind TEXT NOT NULL DEFAULT '', gate_objective_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS task_events (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL DEFAULT '', item_id TEXT NOT NULL DEFAULT '',
      event_type TEXT NOT NULL DEFAULT '', event_status TEXT NOT NULL DEFAULT '', phase TEXT, resume_point TEXT,
      resource_type TEXT, resource_key TEXT NOT NULL DEFAULT '', resource_label TEXT NOT NULL DEFAULT '',
      bridge_kind TEXT NOT NULL DEFAULT '', flow_direction TEXT NOT NULL DEFAULT '', flow_kind TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '', payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_item_id ON tasks(item_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_status_updated_at ON tasks(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_bridge_status_priority ON tasks(bridge_kind, status, priority, created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_flow_resource_status ON tasks(primary_resource_type, status, priority, created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_flow_kind_status_priority ON tasks(flow_kind, status, priority, created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_sub_library_status ON tasks(sub_library_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_target_gate_status ON tasks(target_gate, status, priority, created_at);
    CREATE INDEX IF NOT EXISTS idx_task_events_task_created ON task_events(task_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_task_events_type_created ON task_events(event_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_task_events_status_created ON task_events(event_status, created_at);
    CREATE INDEX IF NOT EXISTS idx_task_events_item_created ON task_events(item_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_task_events_resource_created ON task_events(resource_type, resource_key, created_at);
    CREATE INDEX IF NOT EXISTS idx_task_events_bridge_created ON task_events(bridge_kind, created_at);
  `);
  dbCache.set(dbPath, db);
  checkpointWal(db, 'startup');
  return db;
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
  if (!force) {
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
        trigger: 'routine_checkpoint_deferred',
        minWalSizeBytes,
        before,
      },
    });
    return { skipped: true, reason: 'routine_checkpoint_deferred', before, minWalSizeBytes };
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

function normalizeTask(task) {
  const now = new Date().toISOString();
  const t = task && typeof task === 'object' ? { ...task } : {};
  t.id = String(t.id || generateId());
  t.itemId = String(t.itemId || '');
  t.itemName = String(t.itemName || (t.itemInfo && t.itemInfo.name) || '');
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
  t.maintenanceRun = t.maintenanceRun && typeof t.maintenanceRun === 'object' ? t.maintenanceRun : null;
  t.maintenancePrioritySnapshot = t.maintenancePrioritySnapshot && typeof t.maintenancePrioritySnapshot === 'object'
    ? {
      class: t.maintenancePrioritySnapshot.class === 'expedited' ? 'expedited' : 'normal',
      revision: Number(t.maintenancePrioritySnapshot.revision) || 0,
      reason: String(t.maintenancePrioritySnapshot.reason || ''),
      runId: String(t.maintenancePrioritySnapshot.runId || ''),
    }
    : { class: 'normal', revision: 0, reason: '', runId: '' };
  t.manualExecuteRequested = !!t.manualExecuteRequested;
  const itemInfo = t.itemInfo && typeof t.itemInfo === 'object' ? t.itemInfo : {};
  t.taskTarget = t.taskTarget && typeof t.taskTarget === 'object'
    ? t.taskTarget
    : {
      object: {
        type: 'media_item',
        itemId: t.itemId,
        subLibraryId: itemInfo.subLibraryId || '',
      },
      targetGate: String(t.targetGate || t.bridgeKind || (t.flowPlan && t.flowPlan.bridgeKind) || ''),
      gateObjective: t.gateObjective && typeof t.gateObjective === 'object' ? t.gateObjective : {},
      source: t.source,
    };
  const planned = flowPlanner.planFlow({
    targetGate: t.taskTarget.targetGate,
    source: t.source,
    itemId: t.itemId,
    itemInfo: t.itemInfo,
    taskTarget: t.taskTarget,
    gateObjective: t.taskTarget && t.taskTarget.gateObjective,
    allowedOptimizeFlowKinds: t.allowedOptimizeFlowKinds,
    plannedAt: t.createdAt || now,
  });
  t.taskBridge = t.taskBridge && typeof t.taskBridge === 'object' ? t.taskBridge : planned.taskBridge;
  t.flowPlan = t.flowPlan && typeof t.flowPlan === 'object' ? t.flowPlan : planned.flowPlan;
  delete t.flowKind;
  delete t.selectedFlow;
  return t;
}

function projectTask(task) {
  return task;
}

function appendBridgeKindFilter(clauses, params, column, bridgeKind) {
  const normalized = String(bridgeKind || '');
  const bridgeColumn = column || 'bridge_kind';
  clauses.push(`${bridgeColumn} = @bridgeKind`);
  params.bridgeKind = normalized;
}

function taskToRow(task) {
  const t = normalizeTask(task);
  const space = taskSpaceStatColumns(t);
  const facts = taskFactsModel.taskFacts(t);
  return {
    id: t.id,
    item_id: t.itemId,
    item_name: t.itemName || (t.itemInfo && t.itemInfo.name) || '',
    status: t.status,
    priority: typeof t.priority === 'number' ? t.priority : 100,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
    payload_json: jsonStringify(t),
    ...space,
    ...facts,
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
    flowKind: task && task.flowPlan && task.flowPlan.flowKind,
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
    flowKind: String(opts.flowKind || (t.flowPlan && t.flowPlan.flowKind) || ''),
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
  const facts = taskFactsModel.taskEventFacts(event);
  return {
    id: event.id,
    task_id: event.taskId,
    item_id: event.itemId,
    event_type: event.eventType,
    event_status: event.eventStatus,
    phase: event.phase,
    resume_point: event.resumePoint,
    resource_type: event.resourceType,
    resource_key: facts.resource_key,
    resource_label: facts.resource_label,
    bridge_kind: facts.bridge_kind,
    flow_direction: facts.flow_direction,
    flow_kind: facts.flow_kind,
    created_at: event.createdAt,
    payload_json: jsonStringify(event.payload),
  };
}

function rowToTaskEvent(row) {
  if (!row) return null;
  const event = {
    id: row.id,
    taskId: row.task_id || '',
    itemId: row.item_id || '',
    flowKind: row.flow_kind || '',
    eventType: row.event_type || '',
    eventStatus: row.event_status || '',
    phase: row.phase,
    resumePoint: row.resume_point,
    resourceType: row.resource_type,
    resourceKey: row.resource_key || '',
    resourceLabel: row.resource_label || '',
    bridgeKind: row.bridge_kind || '',
    flowDirection: row.flow_direction || '',
    flowKind: row.flow_kind || '',
    createdAt: row.created_at || '',
    payload: jsonParse(row.payload_json, {}),
  };
  return event;
}

const insertTaskEventSql = `
        INSERT INTO task_events
          (id, task_id, item_id, event_type, event_status, phase, resume_point, resource_type,
           resource_key, resource_label, bridge_kind, flow_direction, flow_kind, created_at, payload_json)
        VALUES
          (@id, @task_id, @item_id, @event_type, @event_status, @phase, @resume_point, @resource_type,
           @resource_key, @resource_label, @bridge_kind, @flow_direction, @flow_kind, @created_at, @payload_json)
      `;

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
      payload: { taskId: task.id, eventType, flowKind: task.flowPlan && task.flowPlan.flowKind },
      successPayload: (event) => ({ writtenRows: event ? 1 : 0 }),
    }, () => {
      const event = buildTaskEvent(task, eventType, payload, opts);
      getDb().prepare(insertTaskEventSql).run(taskEventToRow(event));
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
      const insert = db.prepare(insertTaskEventSql);
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
    if (updated.status === 'paused') {
      events.push(buildTaskEvent(updated, 'task.paused', {
        fromStatus: current.status,
        requestedBy: 'user',
      }));
    }
    if (current.status === 'paused' && updated.status === 'queued') {
      events.push(buildTaskEvent(updated, 'task.resumed', {
        fromStatus: current.status,
        toStatus: updated.status,
      }));
    }
    if (updated.status === 'interrupted') {
      events.push(buildTaskEvent(updated, 'task.interrupted', {
        fromStatus: current.status,
      }));
    }
    if (updated.status === 'failed_hard' || updated.status === 'failed_soft') {
      events.push(buildTaskEvent(updated, 'task.failed', {
        fromStatus: current.status,
        failureStatus: updated.status,
        failureSummary: latestFailureSummary(updated),
        bridgeKind: updated.taskBridge && updated.taskBridge.kind,
        flowDirection: updated.flowPlan && updated.flowPlan.direction,
        flowKind: updated.flowPlan && updated.flowPlan.flowKind,
        primaryResourceType: updated.flowPlan && updated.flowPlan.primaryResourceType,
      }));
    }
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
    }));
  }
  if (updates.maintenancePrioritySnapshot
    && JSON.stringify(current.maintenancePrioritySnapshot || {}) !== JSON.stringify(updated.maintenancePrioritySnapshot || {})) {
    events.push(buildTaskEvent(updated, 'task.media_priority_changed', {
      from: current.maintenancePrioritySnapshot || { class: 'normal', revision: 0 },
      to: updated.maintenancePrioritySnapshot || { class: 'normal', revision: 0 },
    }));
  }
  if (updates.manualExecuteRequested === true && !current.manualExecuteRequested) {
    events.push(buildTaskEvent(updated, 'task.manual_execute_requested', {}));
  }
  if (updates.retryCount !== undefined && updated.retryCount !== current.retryCount) {
    events.push(buildTaskEvent(updated, 'task.retry_recorded', {
      fromRetryCount: current.retryCount || 0,
      toRetryCount: updated.retryCount || 0,
      status: updated.status,
    }));
  }
  return events;
}

function latestFailureSummary(task) {
  const context = task && task.failureContext && typeof task.failureContext === 'object'
    ? task.failureContext
    : null;
  const logs = Array.isArray(task && task.logs) ? task.logs : [];
  const latestError = [...logs].reverse().find((entry) => {
    const level = String(entry && entry.level || '').toLowerCase();
    return level === 'error' || level === 'fatal';
  });
  if (context) {
    return {
      message: String(context.message || (latestError && (latestError.msg || latestError.message)) || ''),
      level: String(context.level || (latestError && latestError.level) || 'error'),
      ts: String(context.failedAt || context.ts || (latestError && (latestError.ts || latestError.at)) || ''),
      source: String(context.source || 'failure_context'),
      phase: String(context.phase || ''),
      resumePoint: String(context.resumePoint || ''),
      recoveryClass: String(context.recoveryClass || ''),
      userAction: String(context.userAction || ''),
      objectiveHash: String(context.objectiveHash || ''),
    };
  }
  if (!latestError) {
    return {
      message: '',
      level: '',
      ts: '',
      source: 'task_status',
    };
  }
  return {
    message: String(latestError.msg || latestError.message || ''),
    level: String(latestError.level || ''),
    ts: String(latestError.ts || latestError.at || ''),
    source: 'task_log',
  };
}

function rowToTask(row) {
  if (!row) return null;
  const task = normalizeTask(jsonParse(row.payload_json, {}));
  task.id = row.id;
  task.itemId = row.item_id || task.itemId || '';
  task.itemName = row.item_name || task.itemName || '';
  task.status = row.status || task.status || '';
  task.priority = typeof row.priority === 'number' ? row.priority : task.priority;
  task.createdAt = row.created_at || task.createdAt;
  task.updatedAt = row.updated_at || task.updatedAt;
  task.source = row.source || task.source || '';
  task.phase = row.phase === undefined ? task.phase : row.phase;
  task.resumePoint = row.resume_point === undefined ? task.resumePoint : row.resume_point;
  task.manualExecuteRequested = row.manual_execute_requested === undefined ? task.manualExecuteRequested : !!row.manual_execute_requested;
  task.priorityModelVersion = row.priority_model_version || task.priorityModelVersion;
  task.retryCount = typeof row.retry_count === 'number' ? row.retry_count : (task.retryCount || 0);
  task.pausingRequested = row.pausing_requested === undefined ? task.pausingRequested : !!row.pausing_requested;
  task.nodeId = row.node_id || task.nodeId;
  if (!task.taskBridge || typeof task.taskBridge !== 'object') {
    task.taskBridge = {
      kind: row.bridge_kind || '',
      from: row.bridge_from || '',
      to: row.bridge_to || '',
      reason: row.bridge_reason || '',
      flowKind: row.flow_kind || (task.flowPlan && task.flowPlan.flowKind) || '',
      source: task.source,
      itemId: task.itemId,
      subLibraryId: row.sub_library_id || (task.itemInfo && task.itemInfo.subLibraryId) || '',
    };
  }
  if (!task.flowPlan || typeof task.flowPlan !== 'object') {
    task.flowPlan = {
      version: row.flow_version || '',
      bridgeKind: row.bridge_kind || '',
      direction: row.flow_direction || '',
      flowKind: row.flow_kind || '',
      executor: row.flow_executor || '',
      primaryResourceType: row.primary_resource_type || '',
      source: task.source,
      resourceTypes: jsonParse(row.resource_types_json, []),
      steps: jsonParse(row.flow_steps_json, []),
      plannedAt: task.createdAt,
    };
  }
  if (!task.taskTarget || typeof task.taskTarget !== 'object') {
    task.taskTarget = {
      object: {
        type: 'media_item',
        itemId: task.itemId,
        subLibraryId: row.sub_library_id || (task.itemInfo && task.itemInfo.subLibraryId) || '',
      },
      targetGate: row.target_gate || (task.taskBridge && task.taskBridge.kind) || (task.flowPlan && task.flowPlan.bridgeKind) || '',
      gateObjective: jsonParse(row.gate_objective_json, null) || {},
      source: task.source,
    };
  }
  delete task.flowKind;
  delete task.selectedFlow;
  task.progress = progressCache.get(task.id) ?? task.progress ?? 0;
  return projectTask(task);
}

const upsertSql = `
  INSERT INTO tasks
    (id, item_id, item_name, status, priority, created_at, updated_at, payload_json,
     verify_bytes_saved, verify_size_bytes, original_size_bytes, upgrade_old_size, upgrade_new_size,
     source, progress, phase, resume_point, manual_execute_requested,
     priority_model_version, retry_count, pausing_requested, node_id, sub_library_id, item_path,
     bridge_kind, bridge_from, bridge_to, bridge_reason, flow_version, flow_direction, flow_kind,
     flow_executor, primary_resource_type, resource_types_json, flow_steps_json,
     target_gate, gate_objective_kind, gate_objective_json)
  VALUES
    (@id, @item_id, @item_name, @status, @priority, @created_at, @updated_at, @payload_json,
     @verify_bytes_saved, @verify_size_bytes, @original_size_bytes, @upgrade_old_size, @upgrade_new_size,
     @source, @progress, @phase, @resume_point, @manual_execute_requested,
     @priority_model_version, @retry_count, @pausing_requested, @node_id, @sub_library_id, @item_path,
     @bridge_kind, @bridge_from, @bridge_to, @bridge_reason, @flow_version, @flow_direction, @flow_kind,
     @flow_executor, @primary_resource_type, @resource_types_json, @flow_steps_json,
     @target_gate, @gate_objective_kind, @gate_objective_json)
  ON CONFLICT(id) DO UPDATE SET
    item_id = excluded.item_id,
    item_name = excluded.item_name,
    status = excluded.status,
    priority = excluded.priority,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    payload_json = excluded.payload_json,
    verify_bytes_saved = excluded.verify_bytes_saved,
    verify_size_bytes = excluded.verify_size_bytes,
    original_size_bytes = excluded.original_size_bytes,
    upgrade_old_size = excluded.upgrade_old_size,
    upgrade_new_size = excluded.upgrade_new_size,
    source = excluded.source,
    progress = excluded.progress,
    phase = excluded.phase,
    resume_point = excluded.resume_point,
    manual_execute_requested = excluded.manual_execute_requested,
    priority_model_version = excluded.priority_model_version,
    retry_count = excluded.retry_count,
    pausing_requested = excluded.pausing_requested,
    node_id = excluded.node_id,
    sub_library_id = excluded.sub_library_id,
    item_path = excluded.item_path,
    bridge_kind = excluded.bridge_kind,
    bridge_from = excluded.bridge_from,
    bridge_to = excluded.bridge_to,
    bridge_reason = excluded.bridge_reason,
    flow_version = excluded.flow_version,
    flow_direction = excluded.flow_direction,
    flow_kind = excluded.flow_kind,
    flow_executor = excluded.flow_executor,
    primary_resource_type = excluded.primary_resource_type,
    resource_types_json = excluded.resource_types_json,
    flow_steps_json = excluded.flow_steps_json,
    target_gate = excluded.target_gate,
    gate_objective_kind = excluded.gate_objective_kind,
    gate_objective_json = excluded.gate_objective_json
`;

function buildTask(taskData, now = new Date().toISOString()) {
  return normalizeTask({
    id: generateId(),
    itemId: taskData.itemId || '',
    itemName: taskData.itemName || (taskData.itemInfo && taskData.itemInfo.name) || '',
    targetGate: taskData.targetGate,
    gateObjective: taskData.gateObjective,
    source: taskData.source || (taskData.itemInfo && taskData.itemInfo.taskSource) || '',
    status: taskData.status || 'created',
    progress: typeof taskData.progress === 'number' ? taskData.progress : 0,
    phase: taskData.phase === undefined ? null : taskData.phase,
    resumePoint: taskData.resumePoint === undefined ? null : taskData.resumePoint,
    priority: typeof taskData.priority === 'number' ? taskData.priority : 100,
    createdAt: now,
    updatedAt: now,
    logs: Array.isArray(taskData.logs) ? taskData.logs : [],
    itemInfo: taskData.itemInfo || null,
    manualExecuteRequested: !!taskData.manualExecuteRequested,
    priorityModelVersion: taskData.priorityModelVersion,
    priorityBreakdown: taskData.priorityBreakdown,
    taskBridge: taskData.taskBridge,
    flowPlan: taskData.flowPlan,
    taskTarget: taskData.taskTarget,
    requestedIntent: taskData.requestedIntent,
    helixAdmission: taskData.helixAdmission || null,
    maintenanceRun: taskData.maintenanceRun || null,
    maintenancePrioritySnapshot: taskData.maintenancePrioritySnapshot || { class: 'normal', revision: 0, reason: '', runId: '' },
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
      targetGate: taskData && (taskData.targetGate || taskData.taskTarget && taskData.taskTarget.targetGate),
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
      maintenanceRun: task.maintenanceRun,
      maintenancePrioritySnapshot: task.maintenancePrioritySnapshot,
      requestedIntent: task.requestedIntent,
      taskBridge: task.taskBridge,
      flowPlan: task.flowPlan,
      taskTarget: task.taskTarget,
    });
    appendTaskEvent(task, 'flow.planned', {
      taskBridge: task.taskBridge,
      flowPlan: task.flowPlan,
      taskTarget: task.taskTarget,
    });
    return task;
  });
}

function createTasks(taskItems) {
  const inputs = Array.isArray(taskItems) ? taskItems : [];
  if (inputs.length === 0) return [];
  return diagnosticLog.track({
    category: 'store',
    scope: 'taskStore.createTasks',
    operation: 'create_tasks_batch',
    component: 'taskStore',
    resourceType: 'sqlite',
    resourceKey: 'tasks.db',
    slowMs: 250,
    payload: {
      inputRows: inputs.length,
      before: getStorageMetrics(),
    },
    successPayload: (tasks) => ({
      taskIds: tasks.map((task) => task.id),
      writtenRows: tasks.length,
      after: getStorageMetrics(),
    }),
  }, () => {
    const db = getDb();
    const upsert = db.prepare(upsertSql);
    const insertEvent = db.prepare(insertTaskEventSql);
    const now = new Date().toISOString();
    const tasks = inputs.map((taskData) => buildTask(taskData, now));
    const tx = db.transaction((rows) => {
      for (const task of rows) {
        upsert.run(taskToRow(task));
        insertEvent.run(taskEventToRow(buildTaskEvent(task, 'task.created', {
          source: task.source,
          priority: task.priority,
          priorityModelVersion: task.priorityModelVersion,
          requestedIntent: task.requestedIntent,
          taskBridge: task.taskBridge,
          flowPlan: task.flowPlan,
          taskTarget: task.taskTarget,
        }, { createdAt: task.createdAt })));
        insertEvent.run(taskEventToRow(buildTaskEvent(task, 'flow.planned', {
          taskBridge: task.taskBridge,
          flowPlan: task.flowPlan,
          taskTarget: task.taskTarget,
        }, { createdAt: task.createdAt })));
      }
    });
    tx(tasks);
    return tasks;
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
  if (filter.flowKind) {
    clauses.push('flow_kind = @flowKind');
    params.flowKind = String(filter.flowKind);
  }
  if (filter.bridgeKind) {
    appendBridgeKindFilter(clauses, params, 'bridge_kind', filter.bridgeKind);
  }
  if (filter.itemId) {
    clauses.push('item_id = @itemId');
    params.itemId = String(filter.itemId);
  }
  if (Array.isArray(filter.itemIds) && filter.itemIds.length > 0) {
    const itemIds = filter.itemIds.map((itemId) => String(itemId || '').trim()).filter(Boolean);
    if (itemIds.length > 0) {
      clauses.push(`item_id IN (${itemIds.map((_, i) => `@itemIdIn${i}`).join(', ')})`);
      itemIds.forEach((itemId, i) => { params[`itemIdIn${i}`] = itemId; });
    }
  }
  if (filter.nodeId) {
    clauses.push('node_id = @nodeId');
    params.nodeId = String(filter.nodeId);
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
  if (filter.bridgeKind) {
    appendBridgeKindFilter(clauses, params, 'bridge_kind', filter.bridgeKind);
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

function queryRecentFailureEventsInner(options = {}) {
  const pageSize = Math.min(200, Math.max(1, Number.parseInt(options.pageSize, 10) || 20));
  const rows = getDb().prepare(`
    SELECT *
    FROM task_events
    WHERE event_status IN ('failed_hard', 'failed_soft', 'interrupted')
       OR event_type IN ('task.failed', 'flow.failed', 'task.interrupted')
    ORDER BY
      CASE
        WHEN event_type IN ('task.failed', 'flow.failed', 'task.interrupted') THEN 0
        ELSE 1
      END ASC,
      created_at DESC,
      id DESC
    LIMIT @limit
  `).all({ limit: pageSize });
  return rows.map(rowToTaskEvent);
}

function queryRecentFailureEvents(options = {}) {
  return diagnosticLog.track({
    category: 'store',
    scope: 'taskStore.queryRecentFailureEvents',
    operation: 'query_recent_failure_events',
    component: 'taskStore',
    resourceType: 'sqlite',
    resourceKey: 'tasks.db',
    slowMs: 150,
    payload: {
      pageSize: options.pageSize || 20,
    },
    successPayload: (events) => ({
      rowCount: Array.isArray(events) ? events.length : 0,
    }),
  }, () => queryRecentFailureEventsInner(options));
}

function queryLatestFailureEventsByItemIdsInner(itemIds = [], options = {}) {
  const ids = [...new Set((itemIds || []).map((itemId) => String(itemId || '').trim()).filter(Boolean))];
  if (ids.length === 0) return {};
  const maxRows = Math.min(1000, Math.max(ids.length * 4, Number.parseInt(options.maxRows, 10) || ids.length * 4));
  const params = { limit: maxRows };
  const itemSql = ids.map((itemId, i) => {
    params[`itemId${i}`] = itemId;
    return `@itemId${i}`;
  }).join(', ');
  const rows = getDb().prepare(`
    SELECT *
    FROM task_events
    WHERE item_id IN (${itemSql})
      AND (
        event_status IN ('failed_hard', 'failed_soft', 'interrupted')
        OR event_type IN ('task.failed', 'flow.failed', 'task.interrupted')
      )
    ORDER BY
      CASE
        WHEN event_type IN ('task.failed', 'flow.failed', 'task.interrupted') THEN 0
        ELSE 1
      END ASC,
      created_at DESC,
      id DESC
    LIMIT @limit
  `).all(params);
  const byItem = {};
  for (const row of rows) {
    const event = rowToTaskEvent(row);
    if (!event.itemId || byItem[event.itemId]) continue;
    byItem[event.itemId] = event;
  }
  return byItem;
}

function queryLatestFailureEventsByItemIds(itemIds = [], options = {}) {
  return diagnosticLog.track({
    category: 'store',
    scope: 'taskStore.queryLatestFailureEventsByItemIds',
    operation: 'query_latest_failure_events_by_item',
    component: 'taskStore',
    resourceType: 'sqlite',
    resourceKey: 'tasks.db',
    slowMs: 150,
    payload: {
      itemIds: Array.isArray(itemIds) ? itemIds.length : 0,
      maxRows: options.maxRows || undefined,
    },
    successPayload: (byItem) => ({
      rowCount: byItem && typeof byItem === 'object' ? Object.keys(byItem).length : 0,
    }),
  }, () => queryLatestFailureEventsByItemIdsInner(itemIds, options));
}

function queryRecentTaskEvents(options = {}) {
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(options.pageSize, 10) || 20));
  const rows = getDb().prepare(`
    SELECT
      id, task_id, item_id, event_type, event_status, phase, resume_point,
      resource_type, resource_key, resource_label, bridge_kind, flow_direction,
      flow_kind, created_at, NULL AS payload_json
    FROM task_events
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `).all({ limit: pageSize });
  return rows.map(rowToTaskEvent);
}

function countMap(rows, keyField = 'key') {
  const out = {};
  for (const row of rows || []) {
    const key = row && row[keyField] ? String(row[keyField]) : 'unknown';
    out[key] = Number(row.count) || 0;
  }
  return out;
}

function terminalWhereSql(params) {
  const terminalSql = [...TERMINAL_STATUSES].map((status, i) => {
    params[`terminal${i}`] = status;
    return `@terminal${i}`;
  }).join(', ');
  return `status NOT IN (${terminalSql})`;
}

function queryDashboardTaskStats() {
  return diagnosticLog.track({
    category: 'store',
    scope: 'taskStore.queryDashboardTaskStats',
    operation: 'query_dashboard_task_stats',
    component: 'taskStore',
    resourceType: 'sqlite',
    resourceKey: 'tasks.db',
    slowMs: 150,
  }, () => {
    const db = getDb();
    const params = {};
    const activeWhere = terminalWhereSql(params);
    const totals = db.prepare(`
      SELECT
        COUNT(*) AS totalTasks,
        SUM(CASE WHEN ${activeWhere} THEN 1 ELSE 0 END) AS activeTasks,
        SUM(CASE WHEN status = 'awaiting_user_confirm' THEN 1 ELSE 0 END) AS awaitingConfirmationTasks,
        SUM(CASE WHEN status = 'failed_hard' THEN 1 ELSE 0 END) AS failedTasks,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS doneTasks
      FROM tasks
    `).get(params) || {};
    const byStatus = countMap(db.prepare(`
      SELECT status AS key, COUNT(*) AS count
      FROM tasks
      GROUP BY status
      ORDER BY count DESC, key ASC
    `).all());
    const bridgeProjection = "COALESCE(NULLIF(bridge_kind, ''), 'unknown')";
    const activeByBridgeKind = countMap(db.prepare(`
      SELECT ${bridgeProjection} AS key, COUNT(*) AS count
      FROM tasks
      WHERE ${activeWhere}
      GROUP BY ${bridgeProjection}
      ORDER BY count DESC, key ASC
    `).all(params));
    const activeByFlowKind = countMap(db.prepare(`
      SELECT COALESCE(NULLIF(flow_kind, ''), 'unknown') AS key, COUNT(*) AS count
      FROM tasks
      WHERE ${activeWhere}
      GROUP BY COALESCE(NULLIF(flow_kind, ''), 'unknown')
      ORDER BY count DESC, key ASC
    `).all(params));
    const activeBySource = countMap(db.prepare(`
      SELECT COALESCE(NULLIF(source, ''), 'manual') AS key, COUNT(*) AS count
      FROM tasks
      WHERE ${activeWhere}
      GROUP BY COALESCE(NULLIF(source, ''), 'manual')
      ORDER BY count DESC, key ASC
    `).all(params));
    const failedByFlowKind = countMap(db.prepare(`
      SELECT COALESCE(NULLIF(flow_kind, ''), 'unknown') AS key, COUNT(*) AS count
      FROM tasks
      WHERE status = 'failed_hard'
      GROUP BY COALESCE(NULLIF(flow_kind, ''), 'unknown')
      ORDER BY count DESC, key ASC
    `).all());

    return {
      totalTasks: Number(totals.totalTasks) || 0,
      activeTasks: Number(totals.activeTasks) || 0,
      awaitingConfirmationTasks: Number(totals.awaitingConfirmationTasks) || 0,
      failedTasks: Number(totals.failedTasks) || 0,
      doneTasks: Number(totals.doneTasks) || 0,
      byStatus,
      activeByBridgeKind,
      activeByFlowKind,
      activeBySource,
      failedByFlowKind,
      recentFailureEvents: queryRecentFailureEvents({ pageSize: 5 }),
    };
  });
}

function jsonExtractObject(value, fallback = undefined) {
  if (value == null) return fallback;
  if (typeof value === 'string') return jsonParse(value, fallback);
  return value;
}

function queryTaskSummariesInner(filter = {}, options = {}) {
  const db = getDb();
  const { where, params } = buildWhere(filter, options);
  const page = Math.max(1, Number.parseInt(options.page, 10) || 1);
  const maxPageSize = Math.max(1, Number.parseInt(options.maxPageSize, 10) || 100);
  const pageSize = Math.min(maxPageSize, Math.max(1, Number.parseInt(options.pageSize, 10) || 20));
  const offset = (page - 1) * pageSize;
  const includeAll = options.includeAll === true;
  const orderBy = options.orderBy === 'createdAt' ? 'created_at' : 'updated_at';
  const orderDir = String(options.orderDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const terminalList = [...TERMINAL_STATUSES].map((status) => `'${status}'`).join(', ');
  const activeJson = (jsonPath) => `CASE WHEN status NOT IN (${terminalList}) THEN json_extract(payload_json, '${jsonPath}') END`;
  const itemJson = (jsonPath) => options.includeTerminalItemInfo === true
    ? `json_extract(payload_json, '${jsonPath}')`
    : activeJson(jsonPath);
  const activeColumn = (column) => `CASE WHEN status NOT IN (${terminalList}) THEN ${column} END`;

  const total = db.prepare(`SELECT COUNT(*) AS count FROM tasks ${where}`).get(params).count || 0;
  const rows = db.prepare(`
    SELECT
      id,
      item_id,
      item_name,
      status,
      priority,
      created_at,
      updated_at,
      ${activeColumn('progress')} AS progress,
      retry_count,
      source,
      bridge_kind,
      bridge_from,
      bridge_to,
      bridge_reason,
      flow_version,
      flow_direction,
      flow_kind,
      flow_executor,
      primary_resource_type,
      resource_types_json,
      flow_steps_json,
      target_gate,
      gate_objective_json,
      phase,
      resume_point,
      ${activeColumn('node_id')} AS node_id,
      ${activeJson('$.approval')} AS approval_json,
      ${activeJson('$.maintenanceRun')} AS maintenance_run_json,
      ${activeJson('$.maintenancePrioritySnapshot')} AS maintenance_priority_snapshot_json,
      ${activeJson('$.verifyResult.sizeBytes')} AS verify_size_bytes,
      ${activeJson('$.verifyResult.bitrate')} AS verify_bitrate,
      ${activeJson('$.verifyResult.videoCodec')} AS verify_video_codec,
      ${activeJson('$.verifyResult.audioCodec')} AS verify_audio_codec,
      ${activeJson('$.verifyResult.width')} AS verify_width,
      ${activeJson('$.verifyResult.height')} AS verify_height,
      ${activeJson('$.verifyResult.previewPath')} AS verify_preview_path,
      ${activeJson('$.verifyResult.outputPath')} AS verify_output_path,
      ${activeJson('$.verifyResult.bytesSaved')} AS verify_bytes_saved,
      ${itemJson('$.itemInfo.name')} AS info_name,
      ${itemJson('$.itemInfo.title')} AS info_title,
      ${itemJson('$.itemInfo.type')} AS info_type,
      ${itemJson('$.itemInfo.seriesName')} AS info_series_name,
      ${itemJson('$.itemInfo.seasonNumber')} AS info_season_number,
      ${itemJson('$.itemInfo.path')} AS info_path,
      ${itemJson('$.itemInfo.subLibraryId')} AS info_sub_library_id,
      ${itemJson('$.itemInfo.originalSizeBytes')} AS info_original_size_bytes,
      ${itemJson('$.itemInfo.originalBitrate')} AS info_original_bitrate,
      ${itemJson('$.itemInfo.originalVideoCodec')} AS info_original_video_codec,
      ${itemJson('$.itemInfo.originalAudioCodec')} AS info_original_audio_codec,
      ${itemJson('$.itemInfo.originalWidth')} AS info_original_width,
      ${itemJson('$.itemInfo.originalHeight')} AS info_original_height,
      ${itemJson('$.itemInfo.adultMetadata.adultId')} AS adult_id,
      ${itemJson('$.itemInfo.adultMetadata.scrapeStatus')} AS adult_scrape_status,
      ${itemJson('$.itemInfo.adultMetadata.region')} AS adult_region,
      ${itemJson('$.itemInfo.adultMetadata.protagonist')} AS adult_protagonist_json
    FROM tasks ${where}
    ORDER BY ${orderBy} ${orderDir}, id ${orderDir}
    ${includeAll ? '' : 'LIMIT @limit OFFSET @offset'}
  `).all(includeAll ? params : { ...params, limit: pageSize, offset });
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
      const planned = flowPlanner.planFlow({
        targetGate: row.target_gate || '',
        source: row.source || '',
        itemId: row.item_id || '',
        itemInfo,
        taskTarget: row.target_gate
          ? {
            object: {
              type: 'media_item',
              itemId: row.item_id || '',
              subLibraryId: row.info_sub_library_id || '',
            },
            targetGate: row.target_gate || '',
            gateObjective: jsonParse(row.gate_objective_json, {}),
            source: row.source || '',
          }
          : undefined,
        plannedAt: row.created_at || '',
      });
      const taskBridge = row.bridge_kind
        ? {
          kind: row.bridge_kind,
          from: row.bridge_from || '',
          to: row.bridge_to || '',
          reason: row.bridge_reason || '',
          flowKind: row.flow_kind || '',
          source: row.source || '',
          itemId: row.item_id || '',
          subLibraryId: row.info_sub_library_id || '',
        }
        : planned.taskBridge;
      const flowPlan = row.flow_direction
        ? {
          version: row.flow_version || '',
          bridgeKind: row.bridge_kind || '',
          direction: row.flow_direction || '',
          flowKind: row.flow_kind || '',
          executor: row.flow_executor || '',
          primaryResourceType: row.primary_resource_type || '',
          source: row.source || '',
          resourceTypes: jsonParse(row.resource_types_json, []),
          steps: jsonParse(row.flow_steps_json, []),
          plannedAt: row.created_at || '',
        }
        : planned.flowPlan;
      return projectTask({
        id: row.id,
        itemId: row.item_id || '',
        itemName: row.item_name || '',
        source: row.source || '',
        taskBridge,
        flowPlan,
        status: row.status || '',
        progress: progressCache.get(row.id) ?? (typeof row.progress === 'number' ? row.progress : 0),
        phase: row.phase,
        resumePoint: row.resume_point,
        retryCount: typeof row.retry_count === 'number' ? row.retry_count : 0,
        nodeId: row.node_id || undefined,
        approval: jsonExtractObject(row.approval_json, undefined),
        maintenanceRun: jsonExtractObject(row.maintenance_run_json, null),
        maintenancePrioritySnapshot: jsonExtractObject(row.maintenance_priority_snapshot_json, { class: 'normal', revision: 0, reason: '', runId: '' }),
        taskTarget: row.target_gate
          ? {
            object: {
              type: 'media_item',
              itemId: row.item_id || '',
              subLibraryId: row.info_sub_library_id || '',
            },
            targetGate: row.target_gate || '',
            gateObjective: jsonParse(row.gate_objective_json, {}),
            source: row.source || '',
          }
          : undefined,
        priority: typeof row.priority === 'number' ? row.priority : 100,
        createdAt: row.created_at || '',
        updatedAt: row.updated_at || '',
        itemInfo: Object.keys(itemInfo).length > 0 ? itemInfo : undefined,
        verifyResult: Object.keys(verifyResult).length > 0 ? verifyResult : undefined,
      });
    }),
    total,
    byStatus,
    page,
    pageSize,
  };
}

function queryTaskSummaries(filter = {}, options = {}) {
  return diagnosticLog.track({
    category: 'store',
    scope: 'taskStore.queryTaskSummaries',
    operation: 'query_task_summaries',
    component: 'taskStore',
    resourceType: 'sqlite',
    resourceKey: 'tasks.db',
    slowMs: 150,
    payload: {
      filter: {
        hasItemId: !!filter.itemId,
        itemIds: Array.isArray(filter.itemIds) ? filter.itemIds.length : undefined,
        status: filter.status || '',
        statuses: Array.isArray(filter.statuses) ? filter.statuses.length : undefined,
        bridgeKind: filter.bridgeKind || '',
        flowKind: filter.flowKind || '',
        nodeId: filter.nodeId || '',
        hasSearch: !!filter.q,
      },
      page: {
        page: options.page || 1,
        pageSize: options.pageSize || 20,
        includeAll: options.includeAll === true,
        includeHistory: options.includeHistory === true,
      },
      order: {
        orderBy: options.orderBy || 'updatedAt',
        orderDir: options.orderDir || 'desc',
      },
    },
    successPayload: (result) => ({
      rowCount: result && Array.isArray(result.tasks) ? result.tasks.length : 0,
      total: result && typeof result.total === 'number' ? result.total : undefined,
      byStatusKeys: result && result.byStatus ? Object.keys(result.byStatus).length : 0,
    }),
  }, () => queryTaskSummariesInner(filter, options));
}

function queryTaskLifecycleAuditFacts(filter = {}, options = {}) {
  return diagnosticLog.track({
    category: 'store',
    scope: 'taskStore.queryTaskLifecycleAuditFacts',
    operation: 'query_task_lifecycle_audit_facts',
    component: 'taskStore',
    resourceType: 'sqlite',
    resourceKey: 'tasks.db',
    slowMs: 150,
    successPayload: (rows) => ({ rowCount: Array.isArray(rows) ? rows.length : 0 }),
  }, () => {
    const db = getDb();
    const { where, params } = buildWhere(filter, options);
    const orderBy = options.orderBy === 'createdAt' ? 'created_at' : 'updated_at';
    const orderDir = String(options.orderDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const rows = db.prepare(`
      SELECT
        id,
        item_id,
        item_name,
        status,
        priority,
        created_at,
        updated_at,
        retry_count,
        source,
        sub_library_id,
        bridge_kind,
        bridge_from,
        bridge_to,
        bridge_reason,
        flow_version,
        flow_direction,
        flow_kind,
        flow_executor,
        primary_resource_type,
        resource_types_json,
        flow_steps_json,
        target_gate,
        gate_objective_json,
        phase,
        resume_point,
        CASE WHEN status = 'awaiting_user_confirm' THEN json_extract(payload_json, '$.approval') END AS approval_json
      FROM tasks ${where}
      ORDER BY ${orderBy} ${orderDir}, id ${orderDir}
    `).all(params);

    return rows.map((row) => {
      const itemInfo = row.sub_library_id
        ? { subLibraryId: row.sub_library_id }
        : undefined;
      const planned = flowPlanner.planFlow({
        targetGate: row.target_gate || '',
        source: row.source || '',
        itemId: row.item_id || '',
        itemInfo,
        taskTarget: row.target_gate
          ? {
            object: {
              type: 'media_item',
              itemId: row.item_id || '',
              subLibraryId: row.sub_library_id || '',
            },
            targetGate: row.target_gate || '',
            gateObjective: jsonParse(row.gate_objective_json, {}),
            source: row.source || '',
          }
          : undefined,
        plannedAt: row.created_at || '',
      });
      const taskBridge = row.bridge_kind
        ? {
          kind: row.bridge_kind,
          from: row.bridge_from || '',
          to: row.bridge_to || '',
          reason: row.bridge_reason || '',
          flowKind: row.flow_kind || '',
          source: row.source || '',
          itemId: row.item_id || '',
          subLibraryId: row.sub_library_id || '',
        }
        : planned.taskBridge;
      const flowPlan = row.flow_direction
        ? {
          version: row.flow_version || '',
          bridgeKind: row.bridge_kind || '',
          direction: row.flow_direction || '',
          flowKind: row.flow_kind || '',
          executor: row.flow_executor || '',
          primaryResourceType: row.primary_resource_type || '',
          source: row.source || '',
          resourceTypes: jsonParse(row.resource_types_json, []),
          steps: jsonParse(row.flow_steps_json, []),
          plannedAt: row.created_at || '',
        }
        : planned.flowPlan;
      return projectTask({
        id: row.id,
        itemId: row.item_id || '',
        itemName: row.item_name || '',
        status: row.status || '',
        source: row.source || '',
        taskBridge,
        flowPlan,
        phase: row.phase || '',
        resumePoint: row.resume_point || '',
        retryCount: typeof row.retry_count === 'number' ? row.retry_count : 0,
        priority: typeof row.priority === 'number' ? row.priority : 100,
        createdAt: row.created_at || '',
        updatedAt: row.updated_at || '',
        approval: jsonExtractObject(row.approval_json, undefined),
        taskTarget: row.target_gate
          ? {
            object: {
              type: 'media_item',
              itemId: row.item_id || '',
              subLibraryId: row.sub_library_id || '',
            },
            targetGate: row.target_gate || '',
            gateObjective: jsonParse(row.gate_objective_json, {}),
            source: row.source || '',
          }
          : undefined,
        itemInfo,
      });
    });
  });
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
        status,
        priority,
        created_at,
        updated_at,
        progress,
        source,
        phase,
        resume_point,
        manual_execute_requested,
        priority_model_version,
        retry_count,
        pausing_requested,
        node_id,
        sub_library_id,
        item_path,
        bridge_kind,
        bridge_from,
        bridge_to,
        bridge_reason,
        flow_version,
        flow_direction,
        flow_kind,
        flow_executor,
        primary_resource_type,
        resource_types_json,
        flow_steps_json,
        target_gate,
        gate_objective_json,
        json_extract(payload_json, '$.priorityBreakdown') AS priority_breakdown_json,
        json_extract(payload_json, '$.itemInfo') AS item_info_json,
        json_extract(payload_json, '$.helixAdmission') AS helix_admission_json
      FROM tasks
      WHERE status NOT IN (${terminalSql})
      ORDER BY priority ASC, created_at ASC, id ASC
    `).all(params);

    return rows.map((row) => {
      const itemInfo = jsonExtractObject(row.item_info_json, null);
      const planned = flowPlanner.planFlow({
        targetGate: row.target_gate || '',
        source: row.source || '',
        itemId: row.item_id || '',
        itemInfo,
        taskTarget: row.target_gate
          ? {
            object: {
              type: 'media_item',
              itemId: row.item_id || '',
              subLibraryId: row.sub_library_id || (itemInfo && itemInfo.subLibraryId) || '',
            },
            targetGate: row.target_gate || '',
            gateObjective: jsonParse(row.gate_objective_json, {}),
            source: row.source || '',
          }
          : undefined,
        plannedAt: row.created_at || '',
      });
      const taskBridge = row.bridge_kind
        ? {
          kind: row.bridge_kind,
          from: row.bridge_from || '',
          to: row.bridge_to || '',
          reason: row.bridge_reason || '',
          flowKind: row.flow_kind || '',
          source: row.source || '',
          itemId: row.item_id || '',
          subLibraryId: row.sub_library_id || (itemInfo && itemInfo.subLibraryId) || '',
        }
        : planned.taskBridge;
      const flowPlan = row.flow_direction
        ? {
          version: row.flow_version || '',
          bridgeKind: row.bridge_kind || '',
          direction: row.flow_direction || '',
          flowKind: row.flow_kind || '',
          executor: row.flow_executor || '',
          primaryResourceType: row.primary_resource_type || '',
          source: row.source || '',
          resourceTypes: jsonParse(row.resource_types_json, []),
          steps: jsonParse(row.flow_steps_json, []),
          plannedAt: row.created_at || '',
        }
        : planned.flowPlan;
      return projectTask({
        id: row.id,
        itemId: row.item_id || '',
        itemName: row.item_name || '',
        taskBridge,
        flowPlan,
        status: row.status || '',
        priority: typeof row.priority === 'number' ? row.priority : 100,
        createdAt: row.created_at || '',
        updatedAt: row.updated_at || '',
        progress: progressCache.get(row.id) ?? (typeof row.progress === 'number' ? row.progress : 0),
        source: row.source || '',
        phase: row.phase,
        resumePoint: row.resume_point,
        manualExecuteRequested: !!row.manual_execute_requested,
        priorityModelVersion: row.priority_model_version,
        priorityBreakdown: jsonExtractObject(row.priority_breakdown_json, undefined),
        helixAdmission: jsonExtractObject(row.helix_admission_json, null),
        retryCount: typeof row.retry_count === 'number' ? row.retry_count : 0,
        pausingRequested: !!row.pausing_requested,
        nodeId: row.node_id || undefined,
        taskTarget: row.target_gate
          ? {
            object: {
              type: 'media_item',
              itemId: row.item_id || '',
              subLibraryId: row.sub_library_id || (itemInfo && itemInfo.subLibraryId) || '',
            },
            targetGate: row.target_gate || '',
            gateObjective: jsonParse(row.gate_objective_json, {}),
            source: row.source || '',
          }
          : undefined,
        itemInfo,
      });
    });
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
      flow_kind,
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
      AND flow_kind IN ('transcode', 'upgrade')
      ${itemFilter}
  `).all(params);

  return rows.map((row) => ({
    id: row.id,
    itemId: row.item_id,
    flowKind: row.flow_kind,
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
      SELECT id, item_id, flow_kind, status, created_at, updated_at
      FROM tasks
      ORDER BY updated_at DESC, id DESC
    `).all();

    return rows.map((row) => ({
      id: row.id,
      itemId: row.item_id || '',
      flowKind: row.flow_kind || '',
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
      flow_kind,
      verify_bytes_saved,
      verify_size_bytes,
      original_size_bytes,
      upgrade_old_size,
      upgrade_new_size
    FROM tasks
    WHERE status = 'done'
      AND flow_kind IN ('transcode', 'upgrade')
  `).all();

  return rows.map((row) => {
    const task = {
      id: row.id,
      itemId: row.item_id,
      flowKind: row.flow_kind,
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

function queryLatestAutomaticFailures(itemIds = []) {
  const ids = [...new Set(itemIds.map((itemId) => String(itemId || '').trim()).filter(Boolean))];
  if (ids.length === 0) return {};
  const rows = getDb().prepare(`
    SELECT id,item_id,status,target_gate,updated_at,
      json_extract(payload_json, '$.helixAdmission.admissionGeneration') AS admission_generation,
      json_extract(payload_json, '$.flowPlan.flowSelection.objectiveHash') AS objective_hash
    FROM tasks
    WHERE source='auto' AND status IN ('failed_hard','failed_soft')
      AND item_id IN (${ids.map(() => '?').join(',')})
    ORDER BY updated_at DESC,id DESC
  `).all(...ids);
  return rows.reduce((out, row) => {
    if (!out[row.item_id]) out[row.item_id] = {
      taskId: row.id,
      itemId: row.item_id,
      status: row.status,
      targetGate: row.target_gate,
      admissionGeneration: Number(row.admission_generation) || 0,
      objectiveHash: row.objective_hash || '',
      updatedAt: row.updated_at,
    };
    return out;
  }, {});
}

function resetForTests() {
  for (const db of dbCache.values()) db.close();
  dbCache.clear();
  progressCache.clear();
  statusCache.clear();
}

module.exports = {
  buildTask,
  createTask,
  createTasks,
  getTask,
  getTasks,
  updateTask,
  deleteTask,
  loadTasks,
  saveTasks,
  queryTasks,
  queryTaskSummaries,
  queryTaskLifecycleAuditFacts,
  querySchedulerTasks,
  queryTaskEvents,
  queryRecentFailureEvents,
  queryLatestFailureEventsByItemIds,
  queryRecentTaskEvents,
  queryDashboardTaskStats,
  appendTaskEvent,
  queryOptimizationTaskIndexRows,
  queryTaskAdmissionRows,
  querySpaceStatTaskRows,
  queryLatestAutomaticFailures,
  getStorageMetrics,
  setProgress,
  getProgress,
  deleteProgress,
  getCachedStatus,
  resetForTests,
};
