'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const FACT_STATUS = new Set(['missing', 'fresh', 'stale', 'blocked']);

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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

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
  getDb().prepare(`
    INSERT INTO kairox_media(item_id,created_at,updated_at) VALUES (?,?,?)
    ON CONFLICT(item_id) DO UPDATE SET updated_at=excluded.updated_at
  `).run(itemId, nowIso(input.createdAt || now), now);
  return { itemId, createdAt: nowIso(input.createdAt || now), updatedAt: now };
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
  const existing = getDb().prepare('SELECT fact_revision FROM kairox_basedata_facts WHERE item_id=?').get(media.itemId);
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
  return getBasedata(media.itemId);
}

function getBasedata(itemId) {
  return factRow(getDb().prepare('SELECT * FROM kairox_basedata_facts WHERE item_id=?').get(String(itemId || '')), 'basedata');
}

function markBasedataStale(input = {}) {
  const itemId = String(input.itemId || '').trim();
  const existing = getBasedata(itemId);
  if (!existing) return null;
  getDb().prepare(`UPDATE kairox_basedata_facts SET status='stale',stale_reason=?,updated_at=? WHERE item_id=?`)
    .run(String(input.reason || 'canonical_refresh_required'), nowIso(input.updatedAt), itemId);
  return getBasedata(itemId);
}

function publishMetadata(input = {}) {
  const media = ensureMedia(input);
  const existing = getDb().prepare('SELECT fact_revision FROM kairox_metadata_facts WHERE item_id=?').get(media.itemId);
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
  return factRow(getDb().prepare('SELECT * FROM kairox_metadata_facts WHERE item_id=?').get(media.itemId), 'metadata');
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
  const existing = getDb().prepare('SELECT fact_revision FROM kairox_optimize_facts WHERE item_id=?').get(media.itemId);
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
    basedata: getBasedata(id),
    metadata: factRow(getDb().prepare('SELECT * FROM kairox_metadata_facts WHERE item_id=?').get(id), 'metadata'),
    optimize: factRow(getDb().prepare('SELECT * FROM kairox_optimize_facts WHERE item_id=?').get(id), 'optimize'),
    objective: getObjective(id),
    refreshRequests: refresh,
    createdAt: media.created_at,
    updatedAt: media.updated_at,
  };
}

function resetForTests() {
  for (const db of dbCache.values()) db.close();
  dbCache.clear();
}

module.exports = {
  ensureSchema,
  ensureMedia,
  getBasedata,
  getBundle,
  markBasedataStale,
  publishBasedata,
  publishMetadata,
  publishOptimize,
  upsertObjective,
  resetForTests,
};
