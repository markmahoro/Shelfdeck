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
    CREATE TABLE IF NOT EXISTS kairox_media (
      item_id TEXT PRIMARY KEY,
      media_kind TEXT NOT NULL DEFAULT '',
      playable INTEGER NOT NULL DEFAULT 1,
      parent_item_id TEXT NOT NULL DEFAULT '',
      series_item_id TEXT NOT NULL DEFAULT '',
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
      item_id TEXT NOT NULL,
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
      FOREIGN KEY(item_id) REFERENCES kairox_media(item_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_kairox_run_one_open
      ON kairox_maintenance_runs(item_id)
      WHERE status NOT IN ('complete','cancelled');
    CREATE INDEX IF NOT EXISTS idx_kairox_runs_supply
      ON kairox_maintenance_runs(status,library_priority,requested_at,item_id);

    CREATE TABLE IF NOT EXISTS kairox_basedata_facts (
      item_id TEXT PRIMARY KEY,
      source_revision TEXT NOT NULL DEFAULT '',
      fact_revision INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'missing',
      facts_json TEXT NOT NULL DEFAULT '{}',
      evidence_json TEXT NOT NULL DEFAULT '{}',
      observed_at TEXT NOT NULL DEFAULT '',
      stale_reason TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      FOREIGN KEY(item_id) REFERENCES kairox_media(item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_kairox_basedata_status ON kairox_basedata_facts(status, updated_at);

    CREATE TABLE IF NOT EXISTS kairox_metadata_facts (
      item_id TEXT PRIMARY KEY,
      fact_revision INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'missing',
      facts_json TEXT NOT NULL DEFAULT '{}',
      evidence_json TEXT NOT NULL DEFAULT '{}',
      observed_at TEXT NOT NULL DEFAULT '',
      stale_reason TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      FOREIGN KEY(item_id) REFERENCES kairox_media(item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_kairox_metadata_status ON kairox_metadata_facts(status, updated_at);

    CREATE TABLE IF NOT EXISTS kairox_user_perception_facts (
      item_id TEXT PRIMARY KEY,
      fact_revision INTEGER NOT NULL DEFAULT 0,
      facts_json TEXT NOT NULL DEFAULT '{}',
      evidence_json TEXT NOT NULL DEFAULT '{}',
      observed_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      FOREIGN KEY(item_id) REFERENCES kairox_media(item_id)
    );

    CREATE TABLE IF NOT EXISTS kairox_optimize_facts (
      item_id TEXT PRIMARY KEY,
      objective_revision TEXT NOT NULL DEFAULT '',
      fact_revision INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'missing',
      facts_json TEXT NOT NULL DEFAULT '{}',
      evidence_json TEXT NOT NULL DEFAULT '{}',
      verified_at TEXT NOT NULL DEFAULT '',
      stale_reason TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      FOREIGN KEY(item_id) REFERENCES kairox_media(item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_kairox_optimize_status ON kairox_optimize_facts(status, updated_at);

    CREATE TABLE IF NOT EXISTS kairox_objectives (
      item_id TEXT PRIMARY KEY,
      policy_revision TEXT NOT NULL DEFAULT '',
      objective_revision TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      objective_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      FOREIGN KEY(item_id) REFERENCES kairox_media(item_id)
    );

    CREATE TABLE IF NOT EXISTS kairox_refresh_requests (
      item_id TEXT NOT NULL,
      fact_group TEXT NOT NULL,
      source_revision TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      reason TEXT NOT NULL DEFAULT '',
      caused_by_task_id TEXT NOT NULL DEFAULT '',
      evidence_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(item_id, fact_group),
      FOREIGN KEY(item_id) REFERENCES kairox_media(item_id)
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

function ensureMedia(input = {}) {
  const itemId = String(input.itemId || '').trim();
  if (!itemId) throw Object.assign(new Error('itemId is required'), { code: 'KAIROX_ITEM_ID_REQUIRED' });
  const now = nowIso(input.updatedAt);
  const existing = getDb().prepare('SELECT * FROM kairox_media WHERE item_id=?').get(itemId);
  const row = {
    item_id: itemId,
    media_kind: String(input.mediaKind !== undefined ? input.mediaKind : existing && existing.media_kind || ''),
    playable: input.playable === undefined ? (existing ? existing.playable : 1) : (input.playable === false ? 0 : 1),
    parent_item_id: String(input.parentItemId !== undefined ? input.parentItemId : existing && existing.parent_item_id || ''),
    series_item_id: String(input.seriesItemId !== undefined ? input.seriesItemId : existing && existing.series_item_id || ''),
    maintenance_priority_class: String(existing && existing.maintenance_priority_class || 'normal'),
    priority_revision: Number(existing && existing.priority_revision) || 0,
    priority_reason: String(existing && existing.priority_reason || ''),
    priority_run_id: String(existing && existing.priority_run_id || ''),
    priority_set_at: String(existing && existing.priority_set_at || ''),
    created_at: existing && existing.created_at || nowIso(input.createdAt || now),
    updated_at: now,
  };
  getDb().prepare(`
    INSERT INTO kairox_media
      (item_id,media_kind,playable,parent_item_id,series_item_id,maintenance_priority_class,
       priority_revision,priority_reason,priority_run_id,priority_set_at,created_at,updated_at)
    VALUES
      (@item_id,@media_kind,@playable,@parent_item_id,@series_item_id,@maintenance_priority_class,
       @priority_revision,@priority_reason,@priority_run_id,@priority_set_at,@created_at,@updated_at)
    ON CONFLICT(item_id) DO UPDATE SET
      media_kind=excluded.media_kind,playable=excluded.playable,parent_item_id=excluded.parent_item_id,
      series_item_id=excluded.series_item_id,updated_at=excluded.updated_at
  `).run(row);
  return mediaRow(getDb().prepare('SELECT * FROM kairox_media WHERE item_id=?').get(itemId));
}

function mediaRow(row) {
  if (!row) return null;
  return {
    itemId: row.item_id,
    mediaKind: row.media_kind || '',
    playable: row.playable !== 0,
    parentItemId: row.parent_item_id || '',
    seriesItemId: row.series_item_id || '',
    maintenancePriorityClass: PRIORITY_CLASSES.has(row.maintenance_priority_class) ? row.maintenance_priority_class : 'normal',
    priorityRevision: Number(row.priority_revision) || 0,
    priorityReason: row.priority_reason || '',
    priorityRunId: row.priority_run_id || '',
    prioritySetAt: row.priority_set_at || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

function getMedia(itemId) {
  return mediaRow(getDb().prepare('SELECT * FROM kairox_media WHERE item_id=?').get(String(itemId || '')));
}

function runRow(row) {
  if (!row) return null;
  return {
    runId: row.run_id,
    itemId: row.item_id,
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

function getMaintenanceRun(itemId) {
  return runRow(getDb().prepare(`
    SELECT * FROM kairox_maintenance_runs
    WHERE item_id=? AND status NOT IN ('complete','cancelled')
    ORDER BY created_at DESC LIMIT 1
  `).get(String(itemId || '')));
}

function getMaintenanceRuns(itemIds = []) {
  const ids = [...new Set((itemIds || []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (ids.length === 0) return {};
  const placeholders = ids.map(() => '?').join(',');
  const rows = getDb().prepare(`
    SELECT * FROM kairox_maintenance_runs
    WHERE item_id IN (${placeholders}) AND status NOT IN ('complete','cancelled')
    ORDER BY item_id ASC,created_at DESC
  `).all(...ids);
  return rows.reduce((out, row) => {
    if (!out[row.item_id]) out[row.item_id] = runRow(row);
    return out;
  }, {});
}

function getMaintenanceRunById(runId) {
  return runRow(getDb().prepare('SELECT * FROM kairox_maintenance_runs WHERE run_id=?').get(String(runId || '')));
}

function createMaintenanceRun(input = {}) {
  const media = ensureMedia(input);
  const existing = getMaintenanceRun(media.itemId);
  if (existing) return { created: false, run: existing };
  const now = nowIso(input.requestedAt);
  const runId = String(input.runId || require('crypto').randomUUID());
  getDb().prepare(`
    INSERT INTO kairox_maintenance_runs
      (run_id,item_id,admission_generation,initiated_by,status,current_task_id,library_priority,
       requested_at,completed_at,blocked_reason,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    runId, media.itemId, Math.max(0, Number(input.admissionGeneration) || 0),
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
  const itemIds = [...new Set((options.itemIds || []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (Array.isArray(options.itemIds) && itemIds.length === 0) return [];
  const statusPlaceholders = valid.map(() => '?').join(',');
  const itemClause = itemIds.length > 0
    ? ` AND r.item_id IN (${itemIds.map(() => '?').join(',')})`
    : '';
  return getDb().prepare(`
    SELECT r.* FROM kairox_maintenance_runs r
    JOIN kairox_media m ON m.item_id=r.item_id
    JOIN kairox_admissions a ON a.item_id=r.item_id AND a.status='active' AND a.generation=r.admission_generation
    WHERE r.status IN (${statusPlaceholders})${itemClause}
    ORDER BY CASE m.maintenance_priority_class WHEN 'expedited' THEN 0 ELSE 1 END ASC,
             r.library_priority ASC,r.requested_at ASC,r.item_id ASC
    LIMIT ?
  `).all(...valid, ...itemIds, limit).map(runRow);
}

function setMaintenancePriority(input = {}) {
  const itemId = String(input.itemId || '').trim();
  const priorityClass = String(input.priorityClass || 'normal');
  if (!PRIORITY_CLASSES.has(priorityClass)) throw Object.assign(new Error('Invalid maintenance priority class'), { code: 'KAIROX_INVALID_PRIORITY_CLASS' });
  const media = getMedia(itemId);
  if (!media) throw Object.assign(new Error('Kairox maintenance item not found'), { code: 'KAIROX_ITEM_NOT_FOUND' });
  const runId = priorityClass === 'expedited' ? String(input.runId || media.priorityRunId || '') : '';
  const reason = priorityClass === 'expedited' ? String(input.reason || '') : '';
  if (media.maintenancePriorityClass === priorityClass && media.priorityRunId === runId && media.priorityReason === reason) return media;
  const now = nowIso(input.updatedAt);
  getDb().prepare(`
    UPDATE kairox_media SET maintenance_priority_class=?,priority_revision=priority_revision+1,
      priority_reason=?,priority_run_id=?,priority_set_at=?,updated_at=? WHERE item_id=?
  `).run(priorityClass, reason, runId, priorityClass === 'expedited' ? now : '', now, itemId);
  return getMedia(itemId);
}

function factRow(row, kind) {
  if (!row) return null;
  return {
    itemId: row.item_id,
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
  const media = ensureMedia(input);
  const existing = getDb().prepare('SELECT * FROM kairox_basedata_facts WHERE item_id=?').get(media.itemId);
  const evidenceTaskId = input.evidence && String(input.evidence.taskId || '');
  if (evidenceTaskId && String(parse(existing && existing.evidence_json, {}).taskId || '') === evidenceTaskId) {
    completeRefresh(media.itemId, 'basedata', input.updatedAt);
    return getBasedata(media.itemId);
  }
  const row = {
    item_id: media.itemId,
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
      (item_id,source_revision,fact_revision,status,facts_json,evidence_json,observed_at,stale_reason,updated_at)
    VALUES
      (@item_id,@source_revision,@fact_revision,@status,@facts_json,@evidence_json,@observed_at,@stale_reason,@updated_at)
    ON CONFLICT(item_id) DO UPDATE SET
      source_revision=excluded.source_revision,fact_revision=excluded.fact_revision,status=excluded.status,
      facts_json=excluded.facts_json,evidence_json=excluded.evidence_json,observed_at=excluded.observed_at,
      stale_reason=excluded.stale_reason,updated_at=excluded.updated_at
  `).run(row);
  completeRefresh(media.itemId, 'basedata', row.updated_at);
  return getBasedata(media.itemId);
}

function getBasedata(itemId) {
  return factRow(getDb().prepare('SELECT * FROM kairox_basedata_facts WHERE item_id=?').get(String(itemId || '')), 'basedata');
}

function getMetadata(itemId) {
  return factRow(getDb().prepare('SELECT * FROM kairox_metadata_facts WHERE item_id=?').get(String(itemId || '')), 'metadata');
}

function getOptimize(itemId) {
  return factRow(getDb().prepare('SELECT * FROM kairox_optimize_facts WHERE item_id=?').get(String(itemId || '')), 'optimize');
}

function markFactStale(table, getter, input = {}) {
  const itemId = String(input.itemId || '').trim();
  const existing = getter(itemId);
  if (!existing) return null;
  getDb().prepare(`UPDATE ${table} SET status='stale',stale_reason=?,updated_at=? WHERE item_id=?`)
    .run(String(input.reason || 'canonical_refresh_required'), nowIso(input.updatedAt), itemId);
  return getter(itemId);
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
  const media = ensureMedia(input);
  const factGroup = String(input.factGroup || '').trim();
  if (!['basedata', 'metadata', 'optimize'].includes(factGroup)) {
    throw Object.assign(new Error('factGroup must be basedata, metadata, or optimize'), { code: 'KAIROX_INVALID_FACT_GROUP' });
  }
  const now = nowIso(input.updatedAt);
  const row = {
    item_id: media.itemId,
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
      (item_id,fact_group,source_revision,status,reason,caused_by_task_id,evidence_json,created_at,updated_at)
    VALUES
      (@item_id,@fact_group,@source_revision,@status,@reason,@caused_by_task_id,@evidence_json,@created_at,@updated_at)
    ON CONFLICT(item_id,fact_group) DO UPDATE SET
      source_revision=excluded.source_revision,status='pending',reason=excluded.reason,
      caused_by_task_id=excluded.caused_by_task_id,evidence_json=excluded.evidence_json,updated_at=excluded.updated_at
  `).run(row);
  return getRefreshRequest(media.itemId, factGroup);
}

function getRefreshRequest(itemId, factGroup) {
  const row = getDb().prepare('SELECT * FROM kairox_refresh_requests WHERE item_id=? AND fact_group=?')
    .get(String(itemId || ''), String(factGroup || ''));
  return row ? {
    itemId: row.item_id,
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

function completeRefresh(itemId, factGroup, updatedAt) {
  getDb().prepare(`
    UPDATE kairox_refresh_requests SET status='completed',updated_at=?
    WHERE item_id=? AND fact_group=? AND status='pending'
  `).run(nowIso(updatedAt), String(itemId || ''), String(factGroup || ''));
  return getRefreshRequest(itemId, factGroup);
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
  const media = ensureMedia(input);
  const existing = getDb().prepare('SELECT * FROM kairox_metadata_facts WHERE item_id=?').get(media.itemId);
  const evidenceTaskId = input.evidence && String(input.evidence.taskId || '');
  if (evidenceTaskId && String(parse(existing && existing.evidence_json, {}).taskId || '') === evidenceTaskId) {
    completeRefresh(media.itemId, 'metadata', input.updatedAt);
    return getMetadata(media.itemId);
  }
  const row = {
    item_id: media.itemId,
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
      (item_id,fact_revision,status,facts_json,evidence_json,observed_at,stale_reason,updated_at)
    VALUES
      (@item_id,@fact_revision,@status,@facts_json,@evidence_json,@observed_at,@stale_reason,@updated_at)
    ON CONFLICT(item_id) DO UPDATE SET
      fact_revision=excluded.fact_revision,status=excluded.status,facts_json=excluded.facts_json,
      evidence_json=excluded.evidence_json,observed_at=excluded.observed_at,
      stale_reason=excluded.stale_reason,updated_at=excluded.updated_at
  `).run(row);
  completeRefresh(media.itemId, 'metadata', row.updated_at);
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
  personCatalogStore.observeItemPeople({ itemId: media.itemId, people: observedPeople, metadataRevision: String(row.fact_revision) });
  return factRow(getDb().prepare('SELECT * FROM kairox_metadata_facts WHERE item_id=?').get(media.itemId), 'metadata');
}

function getUserPerception(itemId) {
  const row = getDb().prepare('SELECT * FROM kairox_user_perception_facts WHERE item_id=?').get(String(itemId || ''));
  return row ? {
    itemId: row.item_id,
    kind: 'userPerception',
    factRevision: Number(row.fact_revision) || 0,
    facts: parse(row.facts_json, {}),
    evidence: parse(row.evidence_json, {}),
    observedAt: row.observed_at || '',
    updatedAt: row.updated_at || '',
  } : null;
}

function updateUserPerception(input = {}) {
  const media = ensureMedia(input);
  const existing = getUserPerception(media.itemId);
  const nextFacts = { ...(existing && existing.facts || {}), ...(input.facts || {}) };
  if (existing && isDeepStrictEqual(existing.facts || {}, nextFacts)) return existing;
  const now = nowIso(input.updatedAt);
  const row = {
    item_id: media.itemId,
    fact_revision: (existing && existing.factRevision || 0) + 1,
    facts_json: JSON.stringify(nextFacts),
    evidence_json: JSON.stringify(input.evidence || {}),
    observed_at: nowIso(input.observedAt || now),
    updated_at: now,
  };
  getDb().prepare(`
    INSERT INTO kairox_user_perception_facts
      (item_id,fact_revision,facts_json,evidence_json,observed_at,updated_at)
    VALUES
      (@item_id,@fact_revision,@facts_json,@evidence_json,@observed_at,@updated_at)
    ON CONFLICT(item_id) DO UPDATE SET
      fact_revision=excluded.fact_revision,facts_json=excluded.facts_json,
      evidence_json=excluded.evidence_json,observed_at=excluded.observed_at,updated_at=excluded.updated_at
  `).run(row);
  return getUserPerception(media.itemId);
}

function upsertObjective(input = {}) {
  const media = ensureMedia(input);
  const row = {
    item_id: media.itemId,
    policy_revision: String(input.policyRevision || ''),
    objective_revision: String(input.objectiveRevision || ''),
    status: String(input.status || 'pending'),
    objective_json: JSON.stringify(input.objective || {}),
    updated_at: nowIso(input.updatedAt),
  };
  getDb().prepare(`
    INSERT INTO kairox_objectives(item_id,policy_revision,objective_revision,status,objective_json,updated_at)
    VALUES (@item_id,@policy_revision,@objective_revision,@status,@objective_json,@updated_at)
    ON CONFLICT(item_id) DO UPDATE SET
      policy_revision=excluded.policy_revision,objective_revision=excluded.objective_revision,
      status=excluded.status,objective_json=excluded.objective_json,updated_at=excluded.updated_at
  `).run(row);
  return getObjective(media.itemId);
}

function getObjective(itemId) {
  const row = getDb().prepare('SELECT * FROM kairox_objectives WHERE item_id=?').get(String(itemId || ''));
  return row ? {
    itemId: row.item_id,
    policyRevision: row.policy_revision,
    objectiveRevision: row.objective_revision,
    status: row.status,
    objective: parse(row.objective_json, {}),
    updatedAt: row.updated_at,
  } : null;
}

function publishOptimize(input = {}) {
  const media = ensureMedia(input);
  const existing = getDb().prepare('SELECT * FROM kairox_optimize_facts WHERE item_id=?').get(media.itemId);
  const evidenceTaskId = input.evidence && String(input.evidence.taskId || '');
  if (evidenceTaskId && String(parse(existing && existing.evidence_json, {}).taskId || '') === evidenceTaskId) {
    completeRefresh(media.itemId, 'optimize', input.updatedAt);
    return getOptimize(media.itemId);
  }
  const row = {
    item_id: media.itemId,
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
      (item_id,objective_revision,fact_revision,status,facts_json,evidence_json,verified_at,stale_reason,updated_at)
    VALUES
      (@item_id,@objective_revision,@fact_revision,@status,@facts_json,@evidence_json,@verified_at,@stale_reason,@updated_at)
    ON CONFLICT(item_id) DO UPDATE SET
      objective_revision=excluded.objective_revision,fact_revision=excluded.fact_revision,status=excluded.status,
      facts_json=excluded.facts_json,evidence_json=excluded.evidence_json,verified_at=excluded.verified_at,
      stale_reason=excluded.stale_reason,updated_at=excluded.updated_at
  `).run(row);
  completeRefresh(media.itemId, 'optimize', row.updated_at);
  return factRow(getDb().prepare('SELECT * FROM kairox_optimize_facts WHERE item_id=?').get(media.itemId), 'optimize');
}

function getBundle(itemId) {
  const id = String(itemId || '').trim();
  const media = getDb().prepare('SELECT * FROM kairox_media WHERE item_id=?').get(id);
  if (!media) return null;
  const refresh = getDb().prepare('SELECT * FROM kairox_refresh_requests WHERE item_id=? ORDER BY fact_group').all(id).map((row) => ({
    itemId: row.item_id,
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
    itemId: id,
    media: mediaRow(media),
    basedata: getBasedata(id),
    metadata: factRow(getDb().prepare('SELECT * FROM kairox_metadata_facts WHERE item_id=?').get(id), 'metadata'),
    userPerception: getUserPerception(id),
    optimize: factRow(getDb().prepare('SELECT * FROM kairox_optimize_facts WHERE item_id=?').get(id), 'optimize'),
    objective: getObjective(id),
    refreshRequests: refresh,
    createdAt: media.created_at,
    updatedAt: media.updated_at,
  };
}

function getBundles(itemIds = []) {
  const ids = [...new Set(itemIds.map((value) => String(value || '').trim()).filter(Boolean))];
  if (ids.length === 0) return {};
  const placeholders = ids.map(() => '?').join(',');
  const db = getDb();
  const mediaRows = db.prepare(`SELECT * FROM kairox_media WHERE item_id IN (${placeholders})`).all(...ids);
  const byId = mediaRows.reduce((out, row) => {
    out[row.item_id] = {
      itemId: row.item_id,
      media: mediaRow(row),
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
    for (const row of db.prepare(`SELECT * FROM ${table} WHERE item_id IN (${placeholders})`).all(...ids)) {
      if (byId[row.item_id]) byId[row.item_id][key] = factRow(row, kind);
    }
  };
  attachFacts('kairox_basedata_facts', 'basedata', 'basedata');
  attachFacts('kairox_metadata_facts', 'metadata', 'metadata');
  attachFacts('kairox_optimize_facts', 'optimize', 'optimize');
  for (const row of db.prepare(`SELECT * FROM kairox_user_perception_facts WHERE item_id IN (${placeholders})`).all(...ids)) {
    if (!byId[row.item_id]) continue;
    byId[row.item_id].userPerception = {
      itemId: row.item_id,
      kind: 'userPerception',
      factRevision: Number(row.fact_revision) || 0,
      facts: parse(row.facts_json, {}),
      evidence: parse(row.evidence_json, {}),
      observedAt: row.observed_at || '',
      updatedAt: row.updated_at || '',
    };
  }
  for (const row of db.prepare(`SELECT * FROM kairox_objectives WHERE item_id IN (${placeholders})`).all(...ids)) {
    if (!byId[row.item_id]) continue;
    byId[row.item_id].objective = {
      itemId: row.item_id,
      policyRevision: row.policy_revision,
      objectiveRevision: row.objective_revision,
      status: row.status,
      objective: parse(row.objective_json, {}),
      updatedAt: row.updated_at,
    };
  }
  for (const row of db.prepare(`SELECT * FROM kairox_refresh_requests WHERE item_id IN (${placeholders}) ORDER BY item_id,fact_group`).all(...ids)) {
    if (!byId[row.item_id]) continue;
    byId[row.item_id].refreshRequests.push({
      itemId: row.item_id,
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
  return getDb().prepare("SELECT item_id,evidence_json FROM kairox_metadata_facts WHERE status='fresh'").all().map((row) => ({ itemId: row.item_id, artifactRevision: String(parse(row.evidence_json, {}).artifactRevision || '') })).filter((entry) => entry.artifactRevision);
}

module.exports = {
  ensureSchema,
  ensureMedia,
  getMedia,
  createMaintenanceRun,
  getMaintenanceRun,
  getMaintenanceRuns,
  getMaintenanceRunById,
  updateMaintenanceRun,
  listMaintenanceRuns,
  setMaintenancePriority,
  getBasedata,
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
