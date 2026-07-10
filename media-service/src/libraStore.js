'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const MEMBERSHIP = new Set(['active', 'closed']);
const DESIRED_STATE = new Set(['managed', 'closed']);
const PHASE = new Set(['onboarding', 'maintenance', 'offboarding', 'closed']);
const QUARANTINE = new Set(['none', 'source_incident']);
const OPERATION_STATUS = new Set(['pending', 'running', 'retrying', 'done', 'failed']);

function resolveDataDir() {
  return process.env.CONTROL_PLANE_DATA_DIR
    || process.env.MEDIA_SERVICE_DATA_DIR
    || path.join(__dirname, '..', 'data');
}

function databasePath() {
  return path.join(resolveDataDir(), 'library.db');
}

function ensureDataDir() {
  fs.mkdirSync(resolveDataDir(), { recursive: true });
}

const dbCache = new Map();

function getDb() {
  ensureDataDir();
  const file = databasePath();
  let db = dbCache.get(file);
  if (db) return db;
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  ensureSchema(db);
  dbCache.set(file, db);
  return db;
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS libra_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS libra_library_items (
      item_id TEXT PRIMARY KEY,
      sub_library_id TEXT NOT NULL DEFAULT '',
      membership_status TEXT NOT NULL DEFAULT 'active',
      desired_state TEXT NOT NULL DEFAULT 'managed',
      phase TEXT NOT NULL DEFAULT 'onboarding',
      quarantine_status TEXT NOT NULL DEFAULT 'none',
      quarantine_reason TEXT NOT NULL DEFAULT '',
      blocked_reason TEXT NOT NULL DEFAULT '',
      admission_generation INTEGER NOT NULL DEFAULT 0,
      source_revision TEXT NOT NULL DEFAULT '',
      maintenance_revision TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_libra_items_phase ON libra_library_items(phase, membership_status);
    CREATE INDEX IF NOT EXISTS idx_libra_items_library ON libra_library_items(sub_library_id, membership_status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_libra_items_quarantine ON libra_library_items(quarantine_status, phase);

    CREATE TABLE IF NOT EXISTS libra_library_work (
      work_id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      work_kind TEXT NOT NULL,
      sub_library_id TEXT NOT NULL DEFAULT '',
      item_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      cursor_json TEXT NOT NULL DEFAULT '{}',
      payload_json TEXT NOT NULL DEFAULT '{}',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      retry_at TEXT NOT NULL DEFAULT '',
      error_code TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_libra_work_status ON libra_library_work(status, retry_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_libra_work_library ON libra_library_work(sub_library_id, status, updated_at);

    CREATE TABLE IF NOT EXISTS libra_reconcile_operations (
      operation_id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      operation_kind TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      payload_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      library_generation INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      step TEXT NOT NULL DEFAULT '',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      retry_at TEXT NOT NULL DEFAULT '',
      error_code TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      result_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_libra_operations_item ON libra_reconcile_operations(item_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_libra_operations_status ON libra_reconcile_operations(status, retry_at);

    CREATE TABLE IF NOT EXISTS libra_events (
      event_id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      operation_id TEXT NOT NULL DEFAULT '',
      event_type TEXT NOT NULL,
      generation INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_libra_events_item ON libra_events(item_id, created_at);
  `);
}

function jsonParse(value, fallback = {}) {
  try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = stableValue(value[key]);
      return out;
    }, {});
  }
  return value;
}

function payloadHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(payload || {}))).digest('hex');
}

function libraryRow(row) {
  if (!row) return null;
  return {
    itemId: row.item_id,
    subLibraryId: row.sub_library_id || '',
    membershipStatus: row.membership_status,
    desiredState: row.desired_state,
    phase: row.phase,
    quarantineStatus: row.quarantine_status,
    quarantineReason: row.quarantine_reason,
    blockedReason: row.blocked_reason,
    admissionGeneration: Number(row.admission_generation) || 0,
    sourceRevision: row.source_revision || '',
    maintenanceRevision: row.maintenance_revision || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeLibraryItem(input, existing = null) {
  const now = String(input.updatedAt || new Date().toISOString());
  const merged = { ...(existing || {}), ...(input || {}) };
  const itemId = String(merged.itemId || '').trim();
  if (!itemId) throw Object.assign(new Error('itemId is required'), { code: 'LIBRA_ITEM_ID_REQUIRED' });
  const membershipStatus = MEMBERSHIP.has(merged.membershipStatus) ? merged.membershipStatus : 'active';
  const desiredState = DESIRED_STATE.has(merged.desiredState) ? merged.desiredState : 'managed';
  const phase = PHASE.has(merged.phase) ? merged.phase : 'onboarding';
  const quarantineStatus = QUARANTINE.has(merged.quarantineStatus) ? merged.quarantineStatus : 'none';
  if (membershipStatus === 'closed' && phase !== 'closed') {
    throw Object.assign(new Error('Closed membership requires closed phase'), { code: 'LIBRA_INVALID_STATE' });
  }
  return {
    item_id: itemId,
    sub_library_id: String(merged.subLibraryId || ''),
    membership_status: membershipStatus,
    desired_state: desiredState,
    phase,
    quarantine_status: quarantineStatus,
    quarantine_reason: String(merged.quarantineReason || ''),
    blocked_reason: String(merged.blockedReason || ''),
    admission_generation: Math.max(0, Number.parseInt(merged.admissionGeneration, 10) || 0),
    source_revision: String(merged.sourceRevision || ''),
    maintenance_revision: String(merged.maintenanceRevision || ''),
    created_at: String(merged.createdAt || now),
    updated_at: now,
  };
}

function getLibraryItem(itemId) {
  return libraryRow(getDb().prepare('SELECT * FROM libra_library_items WHERE item_id = ?').get(String(itemId || '')));
}

function upsertLibraryItem(input) {
  const row = normalizeLibraryItem(input, getLibraryItem(input && input.itemId));
  getDb().prepare(`
    INSERT INTO libra_library_items (
      item_id, sub_library_id, membership_status, desired_state, phase, quarantine_status, quarantine_reason,
      blocked_reason, admission_generation, source_revision, maintenance_revision, created_at, updated_at
    ) VALUES (
      @item_id, @sub_library_id, @membership_status, @desired_state, @phase, @quarantine_status, @quarantine_reason,
      @blocked_reason, @admission_generation, @source_revision, @maintenance_revision, @created_at, @updated_at
    ) ON CONFLICT(item_id) DO UPDATE SET
      sub_library_id=excluded.sub_library_id, membership_status=excluded.membership_status, desired_state=excluded.desired_state,
      phase=excluded.phase, quarantine_status=excluded.quarantine_status,
      quarantine_reason=excluded.quarantine_reason, blocked_reason=excluded.blocked_reason,
      admission_generation=excluded.admission_generation, source_revision=excluded.source_revision,
      maintenance_revision=excluded.maintenance_revision,
      updated_at=excluded.updated_at
  `).run(row);
  return getLibraryItem(row.item_id);
}

function getLibraryItems(itemIds = null) {
  if (!Array.isArray(itemIds)) {
    return getDb().prepare('SELECT * FROM libra_library_items ORDER BY updated_at DESC').all().map(libraryRow);
  }
  const ids = [...new Set(itemIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return getDb().prepare(`SELECT * FROM libra_library_items WHERE item_id IN (${placeholders})`).all(...ids).map(libraryRow);
}

function getLibraryItemsPage(options = {}) {
  const afterItemId = String(options.afterItemId || '');
  const limit = Math.max(1, Math.min(500, Number(options.limit) || 100));
  return getDb().prepare(`
    SELECT * FROM libra_library_items
    WHERE item_id>? ORDER BY item_id ASC LIMIT ?
  `).all(afterItemId, limit).map(libraryRow);
}

function operationRow(row) {
  if (!row) return null;
  return {
    operationId: row.operation_id,
    itemId: row.item_id,
    operationKind: row.operation_kind,
    idempotencyKey: row.idempotency_key,
    payloadHash: row.payload_hash,
    payload: jsonParse(row.payload_json, {}),
    libraryGeneration: Number(row.library_generation) || 0,
    status: row.status,
    step: row.step,
    attemptCount: Number(row.attempt_count) || 0,
    retryAt: row.retry_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    result: jsonParse(row.result_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getOperation(operationId) {
  return operationRow(getDb().prepare('SELECT * FROM libra_reconcile_operations WHERE operation_id = ?').get(String(operationId || '')));
}

function getOperationByIdempotencyKey(idempotencyKey) {
  return operationRow(getDb().prepare('SELECT * FROM libra_reconcile_operations WHERE idempotency_key = ?').get(String(idempotencyKey || '')));
}

function createOrGetOperation(input = {}) {
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  if (!idempotencyKey) throw Object.assign(new Error('idempotencyKey is required'), { code: 'LIBRA_IDEMPOTENCY_KEY_REQUIRED' });
  const hash = payloadHash(input.payload || {});
  const existing = getOperationByIdempotencyKey(idempotencyKey);
  if (existing) {
    if (existing.payloadHash !== hash || existing.operationKind !== String(input.operationKind || '')) {
      throw Object.assign(new Error('Idempotency key was reused with a different command'), {
        code: 'LIBRA_IDEMPOTENCY_CONFLICT',
      });
    }
    return { operation: existing, created: false };
  }
  const now = new Date().toISOString();
  const row = {
    operation_id: String(input.operationId || crypto.randomUUID()),
    item_id: String(input.itemId || ''),
    operation_kind: String(input.operationKind || ''),
    idempotency_key: idempotencyKey,
    payload_hash: hash,
    payload_json: JSON.stringify(input.payload || {}),
    library_generation: Math.max(0, Number.parseInt(input.libraryGeneration, 10) || 0),
    status: 'pending',
    step: String(input.step || 'requested'),
    created_at: now,
    updated_at: now,
  };
  getDb().prepare(`
    INSERT INTO libra_reconcile_operations (
      operation_id,item_id,operation_kind,idempotency_key,payload_hash,payload_json,
      library_generation,status,step,created_at,updated_at
    ) VALUES (
      @operation_id,@item_id,@operation_kind,@idempotency_key,@payload_hash,@payload_json,
      @library_generation,@status,@step,@created_at,@updated_at
    )
  `).run(row);
  return { operation: getOperation(row.operation_id), created: true };
}

function updateOperation(operationId, updates = {}) {
  const current = getOperation(operationId);
  if (!current) return null;
  const status = OPERATION_STATUS.has(updates.status) ? updates.status : current.status;
  getDb().prepare(`
    UPDATE libra_reconcile_operations SET
      status=@status, step=@step, attempt_count=@attempt_count, retry_at=@retry_at,
      error_code=@error_code, error_message=@error_message, result_json=@result_json, updated_at=@updated_at
    WHERE operation_id=@operation_id
  `).run({
    operation_id: current.operationId,
    status,
    step: String(updates.step == null ? current.step : updates.step),
    attempt_count: updates.incrementAttempt ? current.attemptCount + 1 : current.attemptCount,
    retry_at: String(updates.retryAt == null ? current.retryAt : updates.retryAt),
    error_code: String(updates.errorCode == null ? current.errorCode : updates.errorCode),
    error_message: String(updates.errorMessage == null ? current.errorMessage : updates.errorMessage),
    result_json: JSON.stringify(updates.result == null ? current.result : updates.result),
    updated_at: new Date().toISOString(),
  });
  return getOperation(current.operationId);
}

function getCurrentOperationForItem(itemId) {
  return operationRow(getDb().prepare(`
    SELECT * FROM libra_reconcile_operations
    WHERE item_id = ? AND status IN ('pending','running','retrying','failed')
    ORDER BY updated_at DESC LIMIT 1
  `).get(String(itemId || '')));
}

function workRow(row) {
  if (!row) return null;
  return {
    workId: row.work_id,
    idempotencyKey: row.idempotency_key,
    workKind: row.work_kind,
    subLibraryId: row.sub_library_id,
    itemId: row.item_id,
    status: row.status,
    cursor: jsonParse(row.cursor_json, {}),
    payload: jsonParse(row.payload_json, {}),
    attemptCount: Number(row.attempt_count) || 0,
    retryAt: row.retry_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createOrGetLibraryWork(input = {}) {
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  if (!idempotencyKey) throw Object.assign(new Error('idempotencyKey is required'), { code: 'LIBRA_IDEMPOTENCY_KEY_REQUIRED' });
  const existing = workRow(getDb().prepare('SELECT * FROM libra_library_work WHERE idempotency_key=?').get(idempotencyKey));
  const payload = input.payload || {};
  if (existing) {
    if (payloadHash(existing.payload) !== payloadHash(payload)) {
      throw Object.assign(new Error('Idempotency key was already used with a different work payload'), { code: 'LIBRA_IDEMPOTENCY_CONFLICT' });
    }
    return { work: existing, created: false };
  }
  const now = new Date().toISOString();
  const row = {
    work_id: String(input.workId || crypto.randomUUID()),
    idempotency_key: idempotencyKey,
    work_kind: String(input.workKind || ''),
    sub_library_id: String(input.subLibraryId || ''),
    item_id: String(input.itemId || ''),
    status: String(input.status || 'pending'),
    cursor_json: JSON.stringify(input.cursor || {}),
    payload_json: JSON.stringify(payload),
    attempt_count: 0,
    retry_at: '',
    error_code: '',
    error_message: '',
    created_at: now,
    updated_at: now,
  };
  getDb().prepare(`
    INSERT INTO libra_library_work
      (work_id,idempotency_key,work_kind,sub_library_id,item_id,status,cursor_json,payload_json,
       attempt_count,retry_at,error_code,error_message,created_at,updated_at)
    VALUES
      (@work_id,@idempotency_key,@work_kind,@sub_library_id,@item_id,@status,@cursor_json,@payload_json,
       @attempt_count,@retry_at,@error_code,@error_message,@created_at,@updated_at)
  `).run(row);
  return { work: getLibraryWork(row.work_id), created: true };
}

function getLibraryWork(workId) {
  return workRow(getDb().prepare('SELECT * FROM libra_library_work WHERE work_id=?').get(String(workId || '')));
}

function updateLibraryWork(workId, updates = {}) {
  const current = getLibraryWork(workId);
  if (!current) return null;
  getDb().prepare(`
    UPDATE libra_library_work SET
      status=@status,cursor_json=@cursor_json,payload_json=@payload_json,
      attempt_count=@attempt_count,retry_at=@retry_at,error_code=@error_code,
      error_message=@error_message,updated_at=@updated_at
    WHERE work_id=@work_id
  `).run({
    work_id: current.workId,
    status: String(updates.status == null ? current.status : updates.status),
    cursor_json: JSON.stringify(updates.cursor == null ? current.cursor : updates.cursor),
    payload_json: JSON.stringify(updates.payload == null ? current.payload : updates.payload),
    attempt_count: updates.incrementAttempt ? current.attemptCount + 1 : current.attemptCount,
    retry_at: String(updates.retryAt == null ? current.retryAt : updates.retryAt),
    error_code: String(updates.errorCode == null ? current.errorCode : updates.errorCode),
    error_message: String(updates.errorMessage == null ? current.errorMessage : updates.errorMessage),
    updated_at: new Date().toISOString(),
  });
  return getLibraryWork(current.workId);
}

function listRunnableLibraryWork(now = new Date().toISOString(), limit = 10) {
  return getDb().prepare(`
    SELECT * FROM libra_library_work
    WHERE status IN ('pending','running') OR (status='retrying' AND (retry_at='' OR retry_at<=?))
    ORDER BY created_at ASC LIMIT ?
  `).all(now, Math.max(1, Math.min(100, Number(limit) || 10))).map(workRow);
}

function listLibraryWork(filter = {}) {
  const clauses = [];
  const params = {};
  if (filter.subLibraryId) { clauses.push('sub_library_id=@subLibraryId'); params.subLibraryId = String(filter.subLibraryId); }
  if (filter.status) { clauses.push('status=@status'); params.status = String(filter.status); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return getDb().prepare(`SELECT * FROM libra_library_work ${where} ORDER BY updated_at DESC`).all(params).map(workRow);
}

function getCurrentOperationsForItems(itemIds = []) {
  const ids = [...new Set(itemIds.map((itemId) => String(itemId || '').trim()).filter(Boolean))];
  if (ids.length === 0) return {};
  const placeholders = ids.map(() => '?').join(',');
  return getDb().prepare(`
    SELECT * FROM libra_reconcile_operations
    WHERE item_id IN (${placeholders})
      AND status IN ('pending','running','retrying','failed')
    ORDER BY updated_at DESC
  `).all(...ids).reduce((out, row) => {
    if (!out[row.item_id]) out[row.item_id] = operationRow(row);
    return out;
  }, {});
}

function listRecoverableOperations(now = new Date().toISOString()) {
  return getDb().prepare(`
    SELECT * FROM libra_reconcile_operations
    WHERE status IN ('pending','running') OR (status='retrying' AND (retry_at='' OR retry_at<=?))
    ORDER BY created_at ASC
  `).all(now).map(operationRow);
}

function appendEvent(input = {}) {
  const row = {
    event_id: String(input.eventId || crypto.randomUUID()),
    item_id: String(input.itemId || ''),
    operation_id: String(input.operationId || ''),
    event_type: String(input.eventType || ''),
    generation: Math.max(0, Number.parseInt(input.generation, 10) || 0),
    payload_json: JSON.stringify(input.payload || {}),
    created_at: String(input.createdAt || new Date().toISOString()),
  };
  getDb().prepare(`
    INSERT INTO libra_events (event_id,item_id,operation_id,event_type,generation,payload_json,created_at)
    VALUES (@event_id,@item_id,@operation_id,@event_type,@generation,@payload_json,@created_at)
  `).run(row);
  return { eventId: row.event_id, itemId: row.item_id, operationId: row.operation_id, eventType: row.event_type, generation: row.generation, payload: input.payload || {}, createdAt: row.created_at };
}

function resetForTests() {
  for (const db of dbCache.values()) db.close();
  dbCache.clear();
}

module.exports = {
  ensureSchema,
  getLibraryItem,
  getLibraryItems,
  getLibraryItemsPage,
  upsertLibraryItem,
  createOrGetOperation,
  getOperation,
  getOperationByIdempotencyKey,
  getCurrentOperationForItem,
  getCurrentOperationsForItems,
  createOrGetLibraryWork,
  getLibraryWork,
  updateLibraryWork,
  listRunnableLibraryWork,
  listLibraryWork,
  updateOperation,
  listRecoverableOperations,
  appendEvent,
  payloadHash,
  resetForTests,
};
