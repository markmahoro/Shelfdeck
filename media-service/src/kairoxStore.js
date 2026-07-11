'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { isDeepStrictEqual } = require('node:util');
const personCatalogStore = require('./personCatalogStore');

const FACT_STATUS = new Set(['missing', 'fresh', 'stale', 'blocked']);
const RUN_STATUSES = new Set(['ready', 'task_active', 'suspended', 'blocked', 'complete', 'cancelled']);
const PRIORITY_CLASSES = new Set(['normal', 'expedited']);

function resolveDataDir() {
  return process.env.CONTROL_PLANE_DATA_DIR
    || process.env.MEDIA_SERVICE_DATA_DIR
    || path.join(__dirname, '..', 'data');
}

const dbCache = new Map();

function getDb() {
  fs.mkdirSync(resolveDataDir(), { recursive: true });
  const file = path.join(resolveDataDir(), 'tasks.db');
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
    CREATE TABLE IF NOT EXISTS kairox_subjects (
      subject_id TEXT PRIMARY KEY,
      subject_kind TEXT NOT NULL DEFAULT '',
      maintenance_priority_class TEXT NOT NULL DEFAULT 'normal',
      priority_revision INTEGER NOT NULL DEFAULT 0,
      priority_reason TEXT NOT NULL DEFAULT '',
      priority_run_id TEXT NOT NULL DEFAULT '',
      priority_set_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kairox_maintenance_runs (
      run_id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL,
      admission_generation INTEGER NOT NULL DEFAULT 0,
      initiated_by TEXT NOT NULL DEFAULT 'system',
      status TEXT NOT NULL DEFAULT 'ready',
      current_task_id TEXT NOT NULL DEFAULT '',
      library_priority INTEGER NOT NULL DEFAULT 100,
      requested_at TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT '',
      blocked_reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(subject_id) REFERENCES kairox_subjects(subject_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_kairox_run_one_open
      ON kairox_maintenance_runs(subject_id)
      WHERE status NOT IN ('complete','cancelled');
    CREATE INDEX IF NOT EXISTS idx_kairox_runs_supply
      ON kairox_maintenance_runs(status,library_priority,requested_at,subject_id);

    CREATE TABLE IF NOT EXISTS kairox_basedata_facts (
      subject_id TEXT PRIMARY KEY,
      source_revision TEXT NOT NULL DEFAULT '',
      fact_revision INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'missing',
      facts_json TEXT NOT NULL DEFAULT '{}',
      evidence_json TEXT NOT NULL DEFAULT '{}',
      observed_at TEXT NOT NULL DEFAULT '',
      stale_reason TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      FOREIGN KEY(subject_id) REFERENCES kairox_subjects(subject_id)
    );
    CREATE INDEX IF NOT EXISTS idx_kairox_basedata_status ON kairox_basedata_facts(status, updated_at);
    CREATE TABLE IF NOT EXISTS kairox_asset_basedata_facts (
      asset_id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL,
      source_revision TEXT NOT NULL DEFAULT '',
      asset_revision INTEGER NOT NULL DEFAULT 0,
      fact_revision INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'missing',
      facts_json TEXT NOT NULL DEFAULT '{}',
      evidence_json TEXT NOT NULL DEFAULT '{}',
      observed_at TEXT NOT NULL DEFAULT '',
      stale_reason TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_kairox_asset_basedata_subject ON kairox_asset_basedata_facts(subject_id,status,asset_id);

    CREATE TABLE IF NOT EXISTS kairox_metadata_facts (
      subject_id TEXT PRIMARY KEY,
      fact_revision INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'missing',
      facts_json TEXT NOT NULL DEFAULT '{}',
      evidence_json TEXT NOT NULL DEFAULT '{}',
      observed_at TEXT NOT NULL DEFAULT '',
      stale_reason TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      FOREIGN KEY(subject_id) REFERENCES kairox_subjects(subject_id)
    );
    CREATE INDEX IF NOT EXISTS idx_kairox_metadata_status ON kairox_metadata_facts(status, updated_at);

    CREATE TABLE IF NOT EXISTS kairox_user_perception_facts (
      subject_id TEXT PRIMARY KEY,
      fact_revision INTEGER NOT NULL DEFAULT 0,
      facts_json TEXT NOT NULL DEFAULT '{}',
      evidence_json TEXT NOT NULL DEFAULT '{}',
      observed_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      FOREIGN KEY(subject_id) REFERENCES kairox_subjects(subject_id)
    );

    CREATE TABLE IF NOT EXISTS kairox_optimize_facts (
      subject_id TEXT PRIMARY KEY,
      objective_revision TEXT NOT NULL DEFAULT '',
      fact_revision INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'missing',
      facts_json TEXT NOT NULL DEFAULT '{}',
      evidence_json TEXT NOT NULL DEFAULT '{}',
      verified_at TEXT NOT NULL DEFAULT '',
      stale_reason TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      FOREIGN KEY(subject_id) REFERENCES kairox_subjects(subject_id)
    );
    CREATE INDEX IF NOT EXISTS idx_kairox_optimize_status ON kairox_optimize_facts(status, updated_at);

    CREATE TABLE IF NOT EXISTS kairox_objectives (
      subject_id TEXT PRIMARY KEY,
      policy_revision TEXT NOT NULL DEFAULT '',
      objective_revision TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      objective_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      FOREIGN KEY(subject_id) REFERENCES kairox_subjects(subject_id)
    );

    CREATE TABLE IF NOT EXISTS kairox_refresh_requests (
      subject_id TEXT NOT NULL,
      fact_group TEXT NOT NULL,
      source_revision TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      reason TEXT NOT NULL DEFAULT '',
      caused_by_task_id TEXT NOT NULL DEFAULT '',
      evidence_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(subject_id, fact_group),
      FOREIGN KEY(subject_id) REFERENCES kairox_subjects(subject_id)
    );
    CREATE INDEX IF NOT EXISTS idx_kairox_refresh_status ON kairox_refresh_requests(status, updated_at);

    CREATE TABLE IF NOT EXISTS kairox_automation_state (
      engine_id TEXT PRIMARY KEY,
      cursor_json TEXT NOT NULL DEFAULT '{}',
      last_run_at TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
  `);
}

function parse(value, fallback = {}) {
  try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; }
}

function status(value, fallback = 'missing') {
  const normalized = String(value || '').trim().toLowerCase();
  return FACT_STATUS.has(normalized) ? normalized : fallback;
}

function nowIso(input) {
  return String(input || new Date().toISOString());
}

function ensureSubject(input = {}) {
  const subjectId = String(input.subjectId || '').trim();
  if (!subjectId) throw Object.assign(new Error('subjectId is required'), { code: 'KAIROX_SUBJECT_ID_REQUIRED' });
  const now = nowIso(input.updatedAt);
  const existing = getDb().prepare('SELECT * FROM kairox_subjects WHERE subject_id=?').get(subjectId);
  const row = {
    subject_id: subjectId,
    subject_kind: String(input.subjectKind !== undefined ? input.subjectKind : existing && existing.subject_kind || ''),
    maintenance_priority_class: String(existing && existing.maintenance_priority_class || 'normal'),
    priority_revision: Number(existing && existing.priority_revision) || 0,
    priority_reason: String(existing && existing.priority_reason || ''),
    priority_run_id: String(existing && existing.priority_run_id || ''),
    priority_set_at: String(existing && existing.priority_set_at || ''),
    created_at: existing && existing.created_at || nowIso(input.createdAt || now),
    updated_at: now,
  };
  getDb().prepare(`
    INSERT INTO kairox_subjects
      (subject_id,subject_kind,maintenance_priority_class,
       priority_revision,priority_reason,priority_run_id,priority_set_at,created_at,updated_at)
    VALUES
      (@subject_id,@subject_kind,@maintenance_priority_class,
       @priority_revision,@priority_reason,@priority_run_id,@priority_set_at,@created_at,@updated_at)
    ON CONFLICT(subject_id) DO UPDATE SET
      subject_kind=excluded.subject_kind,updated_at=excluded.updated_at
  `).run(row);
  return subjectRow(getDb().prepare('SELECT * FROM kairox_subjects WHERE subject_id=?').get(subjectId));
}

function subjectRow(row) {
  if (!row) return null;
  return {
    subjectId: row.subject_id,
    subjectKind: row.subject_kind || '',
    maintenancePriorityClass: PRIORITY_CLASSES.has(row.maintenance_priority_class) ? row.maintenance_priority_class : 'normal',
    priorityRevision: Number(row.priority_revision) || 0,
    priorityReason: row.priority_reason || '',
    priorityRunId: row.priority_run_id || '',
    prioritySetAt: row.priority_set_at || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

function getSubject(subjectId) {
  return subjectRow(getDb().prepare('SELECT * FROM kairox_subjects WHERE subject_id=?').get(String(subjectId || '')));
}

function runRow(row) {
  if (!row) return null;
  return {
    runId: row.run_id,
    subjectId: row.subject_id,
    admissionGeneration: Number(row.admission_generation) || 0,
    initiatedBy: row.initiated_by || 'system',
    status: RUN_STATUSES.has(row.status) ? row.status : 'blocked',
    currentTaskId: row.current_task_id || '',
    libraryPriority: Number(row.library_priority) || 100,
    requestedAt: row.requested_at || '',
    completedAt: row.completed_at || '',
    blockedReason: row.blocked_reason || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

function getMaintenanceRun(subjectId) {
  return runRow(getDb().prepare(`
    SELECT * FROM kairox_maintenance_runs
    WHERE subject_id=? AND status NOT IN ('complete','cancelled')
    ORDER BY created_at DESC LIMIT 1
  `).get(String(subjectId || '')));
}

function getMaintenanceRuns(subjectIds = []) {
  const ids = [...new Set((subjectIds || []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (ids.length === 0) return {};
  const placeholders = ids.map(() => '?').join(',');
  const rows = getDb().prepare(`
    SELECT * FROM kairox_maintenance_runs
    WHERE subject_id IN (${placeholders}) AND status NOT IN ('complete','cancelled')
    ORDER BY subject_id ASC,created_at DESC
  `).all(...ids);
  return rows.reduce((out, row) => {
    if (!out[row.subject_id]) out[row.subject_id] = runRow(row);
    return out;
  }, {});
}

function getMaintenanceRunById(runId) {
  return runRow(getDb().prepare('SELECT * FROM kairox_maintenance_runs WHERE run_id=?').get(String(runId || '')));
}

function createMaintenanceRun(input = {}) {
  const media = ensureSubject(input);
  const existing = getMaintenanceRun(media.subjectId);
  if (existing) return { created: false, run: existing };
  const now = nowIso(input.requestedAt);
  const runId = String(input.runId || require('crypto').randomUUID());
  getDb().prepare(`
    INSERT INTO kairox_maintenance_runs
      (run_id,subject_id,admission_generation,initiated_by,status,current_task_id,library_priority,
       requested_at,completed_at,blocked_reason,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    runId, media.subjectId, Math.max(0, Number(input.admissionGeneration) || 0),
    String(input.initiatedBy || 'system'), 'ready', '', Number(input.libraryPriority) || 100,
    now, '', '', now, now,
  );
  return { created: true, run: getMaintenanceRunById(runId) };
}

function updateMaintenanceRun(runId, updates = {}) {
  const current = getMaintenanceRunById(runId);
  if (!current) return null;
  const statusValue = updates.status === undefined ? current.status : String(updates.status);
  if (!RUN_STATUSES.has(statusValue)) throw Object.assign(new Error('Invalid maintenance run status'), { code: 'KAIROX_INVALID_RUN_STATUS' });
  const now = nowIso(updates.updatedAt);
  getDb().prepare(`
    UPDATE kairox_maintenance_runs SET
      status=?,current_task_id=?,library_priority=?,completed_at=?,blocked_reason=?,updated_at=?
    WHERE run_id=?
  `).run(
    statusValue,
    updates.currentTaskId === undefined ? current.currentTaskId : String(updates.currentTaskId || ''),
    updates.libraryPriority === undefined ? current.libraryPriority : Number(updates.libraryPriority) || 100,
    updates.completedAt === undefined ? current.completedAt : String(updates.completedAt || ''),
    updates.blockedReason === undefined ? current.blockedReason : String(updates.blockedReason || ''),
    now,
    current.runId,
  );
  return getMaintenanceRunById(current.runId);
}

function listMaintenanceRuns(options = {}) {
  const limit = Math.max(1, Math.min(1000, Number(options.limit) || 100));
  const statuses = Array.isArray(options.statuses) && options.statuses.length ? options.statuses : ['ready'];
  const valid = statuses.filter((value) => RUN_STATUSES.has(value));
  if (valid.length === 0) return [];
  const subjectIds = [...new Set((options.subjectIds || []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (Array.isArray(options.subjectIds) && subjectIds.length === 0) return [];
  const statusPlaceholders = valid.map(() => '?').join(',');
  const itemClause = subjectIds.length > 0
    ? ` AND r.subject_id IN (${subjectIds.map(() => '?').join(',')})`
    : '';
  return getDb().prepare(`
    SELECT r.* FROM kairox_maintenance_runs r
    JOIN kairox_subjects m ON m.subject_id=r.subject_id
    JOIN kairox_admissions a ON a.subject_id=r.subject_id AND a.status='active' AND a.generation=r.admission_generation
    WHERE r.status IN (${statusPlaceholders})${itemClause}
    ORDER BY CASE m.maintenance_priority_class WHEN 'expedited' THEN 0 ELSE 1 END ASC,
             r.library_priority ASC,r.requested_at ASC,r.subject_id ASC
    LIMIT ?
  `).all(...valid, ...subjectIds, limit).map(runRow);
}

function setMaintenancePriority(input = {}) {
  const subjectId = String(input.subjectId || '').trim();
  const priorityClass = String(input.priorityClass || 'normal');
  if (!PRIORITY_CLASSES.has(priorityClass)) throw Object.assign(new Error('Invalid maintenance priority class'), { code: 'KAIROX_INVALID_PRIORITY_CLASS' });
  const media = getSubject(subjectId);
  if (!media) throw Object.assign(new Error('Kairox maintenance item not found'), { code: 'KAIROX_ITEM_NOT_FOUND' });
  const runId = priorityClass === 'expedited' ? String(input.runId || media.priorityRunId || '') : '';
  const reason = priorityClass === 'expedited' ? String(input.reason || '') : '';
  if (media.maintenancePriorityClass === priorityClass && media.priorityRunId === runId && media.priorityReason === reason) return media;
  const now = nowIso(input.updatedAt);
  getDb().prepare(`
    UPDATE kairox_subjects SET maintenance_priority_class=?,priority_revision=priority_revision+1,
      priority_reason=?,priority_run_id=?,priority_set_at=?,updated_at=? WHERE subject_id=?
  `).run(priorityClass, reason, runId, priorityClass === 'expedited' ? now : '', now, subjectId);
  return getSubject(subjectId);
}

function factRow(row, kind) {
  if (!row) return null;
  return {
    subjectId: row.subject_id,
    kind,
    sourceRevision: row.source_revision || '',
    objectiveRevision: row.objective_revision || '',
    factRevision: Number(row.fact_revision) || 0,
    status: row.status || 'missing',
    facts: parse(row.facts_json, {}),
    evidence: parse(row.evidence_json, {}),
    observedAt: row.observed_at || row.verified_at || '',
    staleReason: row.stale_reason || '',
    updatedAt: row.updated_at || '',
  };
}

function publishBasedata(input = {}) {
  const media = ensureSubject(input);
  const existing = getDb().prepare('SELECT * FROM kairox_basedata_facts WHERE subject_id=?').get(media.subjectId);
  const evidenceTaskId = input.evidence && String(input.evidence.taskId || '');
  if (evidenceTaskId && String(parse(existing && existing.evidence_json, {}).taskId || '') === evidenceTaskId) {
    completeRefresh(media.subjectId, 'basedata', input.updatedAt);
    return getBasedata(media.subjectId);
  }
  const row = {
    subject_id: media.subjectId,
    source_revision: String(input.sourceRevision || ''),
    fact_revision: (Number(existing && existing.fact_revision) || 0) + 1,
    status: status(input.status, 'fresh'),
    facts_json: JSON.stringify(input.facts || {}),
    evidence_json: JSON.stringify(input.evidence || {}),
    observed_at: nowIso(input.observedAt),
    stale_reason: String(input.staleReason || ''),
    updated_at: nowIso(input.updatedAt),
  };
  getDb().prepare(`
    INSERT INTO kairox_basedata_facts
      (subject_id,source_revision,fact_revision,status,facts_json,evidence_json,observed_at,stale_reason,updated_at)
    VALUES
      (@subject_id,@source_revision,@fact_revision,@status,@facts_json,@evidence_json,@observed_at,@stale_reason,@updated_at)
    ON CONFLICT(subject_id) DO UPDATE SET
      source_revision=excluded.source_revision,fact_revision=excluded.fact_revision,status=excluded.status,
      facts_json=excluded.facts_json,evidence_json=excluded.evidence_json,observed_at=excluded.observed_at,
      stale_reason=excluded.stale_reason,updated_at=excluded.updated_at
  `).run(row);
  completeRefresh(media.subjectId, 'basedata', row.updated_at);
  return getBasedata(media.subjectId);
}

function getBasedata(subjectId) {
  return factRow(getDb().prepare('SELECT * FROM kairox_basedata_facts WHERE subject_id=?').get(String(subjectId || '')), 'basedata');
}

function upsertAssetBasedata(input = {}) {
  const assetId = String(input.assetId || '').trim();
  const subjectId = String(input.subjectId || '').trim();
  if (!assetId || !subjectId) throw Object.assign(new Error('assetId and subjectId are required'), { code: 'KAIROX_ASSET_FACT_ID_REQUIRED' });
  const existing = getDb().prepare('SELECT * FROM kairox_asset_basedata_facts WHERE asset_id=?').get(assetId);
  const now = nowIso(input.updatedAt);
  getDb().prepare(`INSERT INTO kairox_asset_basedata_facts
    (asset_id,subject_id,source_revision,asset_revision,fact_revision,status,facts_json,evidence_json,observed_at,stale_reason,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(asset_id) DO UPDATE SET
      subject_id=excluded.subject_id,source_revision=excluded.source_revision,asset_revision=excluded.asset_revision,
      fact_revision=excluded.fact_revision,status=excluded.status,facts_json=excluded.facts_json,
      evidence_json=excluded.evidence_json,observed_at=excluded.observed_at,stale_reason=excluded.stale_reason,updated_at=excluded.updated_at`)
    .run(assetId, subjectId, String(input.sourceRevision || ''), Number(input.assetRevision) || 0,
      Number(existing && existing.fact_revision || 0) + 1, status(input.status, 'fresh'), JSON.stringify(input.facts || {}),
      JSON.stringify(input.evidence || {}), String(input.observedAt || now), String(input.staleReason || ''), now);
  return getAssetBasedata(assetId);
}

function getAssetBasedata(assetId) {
  const row = getDb().prepare('SELECT * FROM kairox_asset_basedata_facts WHERE asset_id=?').get(String(assetId || ''));
  if (!row) return null;
  return { assetId: row.asset_id, subjectId: row.subject_id, sourceRevision: row.source_revision, assetRevision: Number(row.asset_revision) || 0,
    factRevision: Number(row.fact_revision) || 0, status: row.status, facts: parse(row.facts_json, {}), evidence: parse(row.evidence_json, {}),
    observedAt: row.observed_at, staleReason: row.stale_reason, updatedAt: row.updated_at };
}

function getAssetBasedataForSubject(subjectId) {
  return getDb().prepare('SELECT asset_id FROM kairox_asset_basedata_facts WHERE subject_id=? ORDER BY asset_id').all(String(subjectId || '')).map((row) => getAssetBasedata(row.asset_id));
}

function getMetadata(subjectId) {
  return factRow(getDb().prepare('SELECT * FROM kairox_metadata_facts WHERE subject_id=?').get(String(subjectId || '')), 'metadata');
}

function getOptimize(subjectId) {
  return factRow(getDb().prepare('SELECT * FROM kairox_optimize_facts WHERE subject_id=?').get(String(subjectId || '')), 'optimize');
}

function markFactStale(table, getter, input = {}) {
  const subjectId = String(input.subjectId || '').trim();
  const existing = getter(subjectId);
  if (!existing) return null;
  getDb().prepare(`UPDATE ${table} SET status='stale',stale_reason=?,updated_at=? WHERE subject_id=?`)
    .run(String(input.reason || 'canonical_refresh_required'), nowIso(input.updatedAt), subjectId);
  return getter(subjectId);
}

function markBasedataStale(input = {}) {
  return markFactStale('kairox_basedata_facts', getBasedata, input);
}

function markMetadataStale(input = {}) {
  return markFactStale('kairox_metadata_facts', getMetadata, input);
}

function markOptimizeStale(input = {}) {
  return markFactStale('kairox_optimize_facts', getOptimize, input);
}

function requestRefresh(input = {}) {
  const media = ensureSubject(input);
  const factGroup = String(input.factGroup || '').trim();
  if (!['basedata', 'metadata', 'optimize'].includes(factGroup)) {
    throw Object.assign(new Error('factGroup must be basedata, metadata, or optimize'), { code: 'KAIROX_INVALID_FACT_GROUP' });
  }
  const now = nowIso(input.updatedAt);
  const row = {
    subject_id: media.subjectId,
    fact_group: factGroup,
    source_revision: String(input.sourceRevision || ''),
    status: 'pending',
    reason: String(input.reason || 'canonical_refresh_required'),
    caused_by_task_id: String(input.causedByTaskId || ''),
    evidence_json: JSON.stringify(input.evidence || {}),
    created_at: nowIso(input.createdAt || now),
    updated_at: now,
  };
  getDb().prepare(`
    INSERT INTO kairox_refresh_requests
      (subject_id,fact_group,source_revision,status,reason,caused_by_task_id,evidence_json,created_at,updated_at)
    VALUES
      (@subject_id,@fact_group,@source_revision,@status,@reason,@caused_by_task_id,@evidence_json,@created_at,@updated_at)
    ON CONFLICT(subject_id,fact_group) DO UPDATE SET
      source_revision=excluded.source_revision,status='pending',reason=excluded.reason,
      caused_by_task_id=excluded.caused_by_task_id,evidence_json=excluded.evidence_json,updated_at=excluded.updated_at
  `).run(row);
  return getRefreshRequest(media.subjectId, factGroup);
}

function getRefreshRequest(subjectId, factGroup) {
  const row = getDb().prepare('SELECT * FROM kairox_refresh_requests WHERE subject_id=? AND fact_group=?')
    .get(String(subjectId || ''), String(factGroup || ''));
  return row ? {
    subjectId: row.subject_id,
    factGroup: row.fact_group,
    sourceRevision: row.source_revision,
    status: row.status,
    reason: row.reason,
    causedByTaskId: row.caused_by_task_id,
    evidence: parse(row.evidence_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } : null;
}

function completeRefresh(subjectId, factGroup, updatedAt) {
  getDb().prepare(`
    UPDATE kairox_refresh_requests SET status='completed',updated_at=?
    WHERE subject_id=? AND fact_group=? AND status='pending'
  `).run(nowIso(updatedAt), String(subjectId || ''), String(factGroup || ''));
  return getRefreshRequest(subjectId, factGroup);
}

function getAutomationState(engineId = 'maintenance') {
  const row = getDb().prepare('SELECT * FROM kairox_automation_state WHERE engine_id=?').get(String(engineId));
  return row ? {
    engineId: row.engine_id,
    cursor: parse(row.cursor_json, {}),
    lastRunAt: row.last_run_at,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  } : { engineId: String(engineId), cursor: {}, lastRunAt: '', lastError: '', updatedAt: '' };
}

function updateAutomationState(engineId = 'maintenance', updates = {}) {
  const current = getAutomationState(engineId);
  const now = nowIso(updates.updatedAt);
  getDb().prepare(`
    INSERT INTO kairox_automation_state(engine_id,cursor_json,last_run_at,last_error,updated_at)
    VALUES (?,?,?,?,?)
    ON CONFLICT(engine_id) DO UPDATE SET
      cursor_json=excluded.cursor_json,last_run_at=excluded.last_run_at,
      last_error=excluded.last_error,updated_at=excluded.updated_at
  `).run(String(engineId), JSON.stringify(updates.cursor == null ? current.cursor : updates.cursor), String(updates.lastRunAt == null ? current.lastRunAt : updates.lastRunAt), String(updates.lastError == null ? current.lastError : updates.lastError), now);
  return getAutomationState(engineId);
}

function publishMetadata(input = {}) {
  const media = ensureSubject(input);
  const existing = getDb().prepare('SELECT * FROM kairox_metadata_facts WHERE subject_id=?').get(media.subjectId);
  const evidenceTaskId = input.evidence && String(input.evidence.taskId || '');
  if (evidenceTaskId && String(parse(existing && existing.evidence_json, {}).taskId || '') === evidenceTaskId) {
    completeRefresh(media.subjectId, 'metadata', input.updatedAt);
    return getMetadata(media.subjectId);
  }
  const row = {
    subject_id: media.subjectId,
    fact_revision: (Number(existing && existing.fact_revision) || 0) + 1,
    status: status(input.status, 'fresh'),
    facts_json: JSON.stringify(input.facts || {}),
    evidence_json: JSON.stringify(input.evidence || {}),
    observed_at: nowIso(input.observedAt),
    stale_reason: String(input.staleReason || ''),
    updated_at: nowIso(input.updatedAt),
  };
  getDb().prepare(`
    INSERT INTO kairox_metadata_facts
      (subject_id,fact_revision,status,facts_json,evidence_json,observed_at,stale_reason,updated_at)
    VALUES
      (@subject_id,@fact_revision,@status,@facts_json,@evidence_json,@observed_at,@stale_reason,@updated_at)
    ON CONFLICT(subject_id) DO UPDATE SET
      fact_revision=excluded.fact_revision,status=excluded.status,facts_json=excluded.facts_json,
      evidence_json=excluded.evidence_json,observed_at=excluded.observed_at,
      stale_reason=excluded.stale_reason,updated_at=excluded.updated_at
  `).run(row);
  completeRefresh(media.subjectId, 'metadata', row.updated_at);
  const metadataFacts = input.facts || {};
  const observedPeople = Array.isArray(metadataFacts.people) ? [...metadataFacts.people] : [];
  if (metadataFacts.protagonist && metadataFacts.protagonist.name) {
    observedPeople.push({
      personId: metadataFacts.protagonist.personId,
      name: metadataFacts.protagonist.name,
      role: 'actor',
      source: 'western_adult_recognition',
      confidence: metadataFacts.protagonist.confidence,
      contentKinds: ['adult'],
    });
  }
  for (const actor of Array.isArray(metadataFacts.actors) ? metadataFacts.actors : []) {
    const observation = actor && typeof actor === 'object' ? actor : { name: actor };
    if (metadataFacts.protagonist && String(observation.name || '').trim().toLowerCase() === String(metadataFacts.protagonist.name || '').trim().toLowerCase()) continue;
    observedPeople.push({ ...observation, role: 'actor', source: observation.source || (metadataFacts.adultRegion ? 'adult_scraper' : 'metadata'), contentKinds: observation.contentKinds || [metadataFacts.adultRegion ? 'adult' : 'general'] });
  }
  personCatalogStore.observeSubjectPeople({ subjectId: media.subjectId, people: observedPeople, metadataRevision: String(row.fact_revision) });
  return factRow(getDb().prepare('SELECT * FROM kairox_metadata_facts WHERE subject_id=?').get(media.subjectId), 'metadata');
}

function getUserPerception(subjectId) {
  const row = getDb().prepare('SELECT * FROM kairox_user_perception_facts WHERE subject_id=?').get(String(subjectId || ''));
  return row ? {
    subjectId: row.subject_id,
    kind: 'userPerception',
    factRevision: Number(row.fact_revision) || 0,
    facts: parse(row.facts_json, {}),
    evidence: parse(row.evidence_json, {}),
    observedAt: row.observed_at || '',
    updatedAt: row.updated_at || '',
  } : null;
}

function updateUserPerception(input = {}) {
  const media = ensureSubject(input);
  const existing = getUserPerception(media.subjectId);
  const nextFacts = { ...(existing && existing.facts || {}), ...(input.facts || {}) };
  if (existing && isDeepStrictEqual(existing.facts || {}, nextFacts)) return existing;
  const now = nowIso(input.updatedAt);
  const row = {
    subject_id: media.subjectId,
    fact_revision: (existing && existing.factRevision || 0) + 1,
    facts_json: JSON.stringify(nextFacts),
    evidence_json: JSON.stringify(input.evidence || {}),
    observed_at: nowIso(input.observedAt || now),
    updated_at: now,
  };
  getDb().prepare(`
    INSERT INTO kairox_user_perception_facts
      (subject_id,fact_revision,facts_json,evidence_json,observed_at,updated_at)
    VALUES
      (@subject_id,@fact_revision,@facts_json,@evidence_json,@observed_at,@updated_at)
    ON CONFLICT(subject_id) DO UPDATE SET
      fact_revision=excluded.fact_revision,facts_json=excluded.facts_json,
      evidence_json=excluded.evidence_json,observed_at=excluded.observed_at,updated_at=excluded.updated_at
  `).run(row);
  return getUserPerception(media.subjectId);
}

function upsertObjective(input = {}) {
  const media = ensureSubject(input);
  const row = {
    subject_id: media.subjectId,
    policy_revision: String(input.policyRevision || ''),
    objective_revision: String(input.objectiveRevision || ''),
    status: String(input.status || 'pending'),
    objective_json: JSON.stringify(input.objective || {}),
    updated_at: nowIso(input.updatedAt),
  };
  getDb().prepare(`
    INSERT INTO kairox_objectives(subject_id,policy_revision,objective_revision,status,objective_json,updated_at)
    VALUES (@subject_id,@policy_revision,@objective_revision,@status,@objective_json,@updated_at)
    ON CONFLICT(subject_id) DO UPDATE SET
      policy_revision=excluded.policy_revision,objective_revision=excluded.objective_revision,
      status=excluded.status,objective_json=excluded.objective_json,updated_at=excluded.updated_at
  `).run(row);
  return getObjective(media.subjectId);
}

function getObjective(subjectId) {
  const row = getDb().prepare('SELECT * FROM kairox_objectives WHERE subject_id=?').get(String(subjectId || ''));
  return row ? {
    subjectId: row.subject_id,
    policyRevision: row.policy_revision,
    objectiveRevision: row.objective_revision,
    status: row.status,
    objective: parse(row.objective_json, {}),
    updatedAt: row.updated_at,
  } : null;
}

function publishOptimize(input = {}) {
  const media = ensureSubject(input);
  const existing = getDb().prepare('SELECT * FROM kairox_optimize_facts WHERE subject_id=?').get(media.subjectId);
  const evidenceTaskId = input.evidence && String(input.evidence.taskId || '');
  if (evidenceTaskId && String(parse(existing && existing.evidence_json, {}).taskId || '') === evidenceTaskId) {
    completeRefresh(media.subjectId, 'optimize', input.updatedAt);
    return getOptimize(media.subjectId);
  }
  const row = {
    subject_id: media.subjectId,
    objective_revision: String(input.objectiveRevision || ''),
    fact_revision: (Number(existing && existing.fact_revision) || 0) + 1,
    status: status(input.status, 'fresh'),
    facts_json: JSON.stringify(input.facts || {}),
    evidence_json: JSON.stringify(input.evidence || {}),
    verified_at: nowIso(input.verifiedAt),
    stale_reason: String(input.staleReason || ''),
    updated_at: nowIso(input.updatedAt),
  };
  getDb().prepare(`
    INSERT INTO kairox_optimize_facts
      (subject_id,objective_revision,fact_revision,status,facts_json,evidence_json,verified_at,stale_reason,updated_at)
    VALUES
      (@subject_id,@objective_revision,@fact_revision,@status,@facts_json,@evidence_json,@verified_at,@stale_reason,@updated_at)
    ON CONFLICT(subject_id) DO UPDATE SET
      objective_revision=excluded.objective_revision,fact_revision=excluded.fact_revision,status=excluded.status,
      facts_json=excluded.facts_json,evidence_json=excluded.evidence_json,verified_at=excluded.verified_at,
      stale_reason=excluded.stale_reason,updated_at=excluded.updated_at
  `).run(row);
  completeRefresh(media.subjectId, 'optimize', row.updated_at);
  return factRow(getDb().prepare('SELECT * FROM kairox_optimize_facts WHERE subject_id=?').get(media.subjectId), 'optimize');
}

function getBundle(subjectId) {
  const id = String(subjectId || '').trim();
  const media = getDb().prepare('SELECT * FROM kairox_subjects WHERE subject_id=?').get(id);
  if (!media) return null;
  const refresh = getDb().prepare('SELECT * FROM kairox_refresh_requests WHERE subject_id=? ORDER BY fact_group').all(id).map((row) => ({
    subjectId: row.subject_id,
    factGroup: row.fact_group,
    sourceRevision: row.source_revision,
    status: row.status,
    reason: row.reason,
    causedByTaskId: row.caused_by_task_id,
    evidence: parse(row.evidence_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  return {
    subjectId: id,
    media: subjectRow(media),
    basedata: getBasedata(id),
    metadata: factRow(getDb().prepare('SELECT * FROM kairox_metadata_facts WHERE subject_id=?').get(id), 'metadata'),
    userPerception: getUserPerception(id),
    optimize: factRow(getDb().prepare('SELECT * FROM kairox_optimize_facts WHERE subject_id=?').get(id), 'optimize'),
    objective: getObjective(id),
    refreshRequests: refresh,
    createdAt: media.created_at,
    updatedAt: media.updated_at,
  };
}

function getBundles(subjectIds = []) {
  const ids = [...new Set(subjectIds.map((value) => String(value || '').trim()).filter(Boolean))];
  if (ids.length === 0) return {};
  const placeholders = ids.map(() => '?').join(',');
  const db = getDb();
  const mediaRows = db.prepare(`SELECT * FROM kairox_subjects WHERE subject_id IN (${placeholders})`).all(...ids);
  const byId = mediaRows.reduce((out, row) => {
    out[row.subject_id] = {
      subjectId: row.subject_id,
      media: subjectRow(row),
      basedata: null,
      metadata: null,
      userPerception: null,
      optimize: null,
      objective: null,
      refreshRequests: [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    return out;
  }, {});
  const attachFacts = (table, key, kind) => {
    for (const row of db.prepare(`SELECT * FROM ${table} WHERE subject_id IN (${placeholders})`).all(...ids)) {
      if (byId[row.subject_id]) byId[row.subject_id][key] = factRow(row, kind);
    }
  };
  attachFacts('kairox_basedata_facts', 'basedata', 'basedata');
  attachFacts('kairox_metadata_facts', 'metadata', 'metadata');
  attachFacts('kairox_optimize_facts', 'optimize', 'optimize');
  for (const row of db.prepare(`SELECT * FROM kairox_user_perception_facts WHERE subject_id IN (${placeholders})`).all(...ids)) {
    if (!byId[row.subject_id]) continue;
    byId[row.subject_id].userPerception = {
      subjectId: row.subject_id,
      kind: 'userPerception',
      factRevision: Number(row.fact_revision) || 0,
      facts: parse(row.facts_json, {}),
      evidence: parse(row.evidence_json, {}),
      observedAt: row.observed_at || '',
      updatedAt: row.updated_at || '',
    };
  }
  for (const row of db.prepare(`SELECT * FROM kairox_objectives WHERE subject_id IN (${placeholders})`).all(...ids)) {
    if (!byId[row.subject_id]) continue;
    byId[row.subject_id].objective = {
      subjectId: row.subject_id,
      policyRevision: row.policy_revision,
      objectiveRevision: row.objective_revision,
      status: row.status,
      objective: parse(row.objective_json, {}),
      updatedAt: row.updated_at,
    };
  }
  for (const row of db.prepare(`SELECT * FROM kairox_refresh_requests WHERE subject_id IN (${placeholders}) ORDER BY subject_id,fact_group`).all(...ids)) {
    if (!byId[row.subject_id]) continue;
    byId[row.subject_id].refreshRequests.push({
      subjectId: row.subject_id,
      factGroup: row.fact_group,
      sourceRevision: row.source_revision,
      status: row.status,
      reason: row.reason,
      causedByTaskId: row.caused_by_task_id,
      evidence: parse(row.evidence_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
  return byId;
}

function resetForTests() {
  for (const db of dbCache.values()) db.close();
  dbCache.clear();
  personCatalogStore.resetForTests();
}

function listMetadataArtifactReferences() {
  return getDb().prepare("SELECT subject_id,evidence_json FROM kairox_metadata_facts WHERE status='fresh'").all().map((row) => ({ subjectId: row.subject_id, artifactRevision: String(parse(row.evidence_json, {}).artifactRevision || '') })).filter((entry) => entry.artifactRevision);
}

module.exports = {
  ensureSchema,
  ensureSubject,
  getSubject,
  createMaintenanceRun,
  getMaintenanceRun,
  getMaintenanceRuns,
  getMaintenanceRunById,
  updateMaintenanceRun,
  listMaintenanceRuns,
  setMaintenancePriority,
  getBasedata,
  upsertAssetBasedata,
  getAssetBasedata,
  getAssetBasedataForSubject,
  getMetadata,
  getOptimize,
  getUserPerception,
  getBundle,
  getBundles,
  markBasedataStale,
  markMetadataStale,
  markOptimizeStale,
  requestRefresh,
  getRefreshRequest,
  completeRefresh,
  getAutomationState,
  updateAutomationState,
  publishBasedata,
  publishMetadata,
  updateUserPerception,
  publishOptimize,
  upsertObjective,
  listMetadataArtifactReferences,
  resetForTests,
};
