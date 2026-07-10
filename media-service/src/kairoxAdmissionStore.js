'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

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
  db.exec(`
    CREATE TABLE IF NOT EXISTS kairox_admissions (
      item_id TEXT PRIMARY KEY,
      generation INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      source_revision TEXT NOT NULL DEFAULT '',
      source_context_json TEXT NOT NULL DEFAULT '{}',
      policy_revision TEXT NOT NULL DEFAULT '',
      maintenance_policy_json TEXT NOT NULL DEFAULT '{}',
      incident_code TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_kairox_admissions_status ON kairox_admissions(status, generation);
  `);
  dbCache.set(file, db);
  return db;
}

function parse(value) {
  try { return value ? JSON.parse(value) : {}; } catch (_) { return {}; }
}

function rowToAdmission(row) {
  if (!row) return null;
  return {
    itemId: row.item_id,
    admissionGeneration: Number(row.generation) || 0,
    status: row.status,
    sourceRevision: row.source_revision,
    sourceAccessDescriptor: parse(row.source_context_json),
    policyRevision: row.policy_revision,
    maintenancePolicy: parse(row.maintenance_policy_json),
    incidentCode: row.incident_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getAdmission(itemId) {
  return rowToAdmission(getDb().prepare('SELECT * FROM kairox_admissions WHERE item_id=?').get(String(itemId || '')));
}

function getAdmissions(itemIds = []) {
  const ids = [...new Set(itemIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (ids.length === 0) return {};
  return getDb().prepare(`SELECT * FROM kairox_admissions WHERE item_id IN (${ids.map(() => '?').join(',')})`).all(...ids).reduce((out, row) => {
    const admission = rowToAdmission(row);
    out[admission.itemId] = admission;
    return out;
  }, {});
}

function listActiveAdmissions(options = {}) {
  const limit = Math.max(1, Math.min(1000, Number(options.limit) || 100));
  const afterItemId = String(options.afterItemId || '');
  return getDb().prepare(`
    SELECT * FROM kairox_admissions
    WHERE status='active' AND item_id>?
    ORDER BY item_id ASC LIMIT ?
  `).all(afterItemId, limit).map(rowToAdmission);
}

function upsertAdmission(input = {}) {
  const itemId = String(input.itemId || '');
  const generation = Math.max(0, Number.parseInt(input.admissionGeneration, 10) || 0);
  const existing = getAdmission(itemId);
  if (existing && generation < existing.admissionGeneration) {
    const error = new Error('Stale Kairox admission generation');
    error.code = 'KAIROX_STALE_ADMISSION';
    throw error;
  }
  const now = new Date().toISOString();
  const row = {
    item_id: itemId,
    generation,
    status: String(input.status || 'active'),
    source_revision: String(input.sourceRevision || ''),
    source_context_json: JSON.stringify(input.sourceAccessDescriptor || {}),
    policy_revision: String(input.policyRevision || ''),
    maintenance_policy_json: JSON.stringify(input.maintenancePolicy || {}),
    incident_code: String(input.incidentCode || ''),
    created_at: existing && existing.createdAt || now,
    updated_at: now,
  };
  getDb().prepare(`
    INSERT INTO kairox_admissions
      (item_id,generation,status,source_revision,source_context_json,policy_revision,maintenance_policy_json,incident_code,created_at,updated_at)
    VALUES
      (@item_id,@generation,@status,@source_revision,@source_context_json,@policy_revision,@maintenance_policy_json,@incident_code,@created_at,@updated_at)
    ON CONFLICT(item_id) DO UPDATE SET
      generation=excluded.generation,status=excluded.status,source_revision=excluded.source_revision,
      source_context_json=excluded.source_context_json,policy_revision=excluded.policy_revision,
      maintenance_policy_json=excluded.maintenance_policy_json,
      incident_code=excluded.incident_code,updated_at=excluded.updated_at
  `).run(row);
  return getAdmission(itemId);
}

function resetForTests() {
  for (const db of dbCache.values()) db.close();
  dbCache.clear();
}

module.exports = { getAdmission, getAdmissions, listActiveAdmissions, upsertAdmission, resetForTests };
