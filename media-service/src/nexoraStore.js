'use strict';

const crypto = require('crypto');
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
  const file = path.join(resolveDataDir(), 'library.db');
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
    CREATE TABLE IF NOT EXISTS nexora_source_bindings (
      binding_id TEXT PRIMARY KEY,
      media_item_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      validity TEXT NOT NULL DEFAULT 'invalid',
      reason TEXT NOT NULL DEFAULT '',
      evidence_ref TEXT NOT NULL DEFAULT '',
      observed_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      UNIQUE(media_item_id, source_id)
    );
    CREATE INDEX IF NOT EXISTS idx_nexora_source_bindings_item ON nexora_source_bindings(media_item_id);
    CREATE TABLE IF NOT EXISTS nexora_source_observations (
      observation_id TEXT PRIMARY KEY,
      binding_id TEXT NOT NULL DEFAULT '',
      media_item_id TEXT NOT NULL DEFAULT '',
      source_id TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      identity_kind TEXT NOT NULL DEFAULT '',
      identity_payload_json TEXT NOT NULL DEFAULT '{}',
      locator_json TEXT NOT NULL DEFAULT '{}',
      evidence_json TEXT NOT NULL DEFAULT '{}',
      observed_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_nexora_source_observations_item ON nexora_source_observations(media_item_id, observed_at);
    CREATE TABLE IF NOT EXISTS nexora_source_state (
      media_item_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL DEFAULT 0,
      readiness TEXT NOT NULL DEFAULT 'unresolved',
      access_descriptor_json TEXT NOT NULL DEFAULT '{}',
      latest_observation_id TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_nexora_source_state_readiness ON nexora_source_state(readiness, revision);
  `);
}

function parse(value, fallback = {}) {
  try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value == null ? null : value);
}

function bindingRow(row) {
  if (!row) return null;
  return {
    bindingId: row.binding_id,
    mediaItemId: row.media_item_id,
    sourceId: row.source_id,
    validity: row.validity,
    valid: row.validity === 'valid',
    reason: row.reason,
    evidenceRef: row.evidence_ref,
    observedAt: row.observed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getSourceBinding(mediaItemId, sourceId) {
  return bindingRow(getDb().prepare('SELECT * FROM nexora_source_bindings WHERE media_item_id=? AND source_id=?').get(String(mediaItemId || ''), String(sourceId || '')));
}

function findSourceBindingBySourceId(sourceId) {
  return bindingRow(getDb().prepare(`
    SELECT * FROM nexora_source_bindings
    WHERE source_id=?
    ORDER BY CASE validity WHEN 'valid' THEN 0 ELSE 1 END, updated_at DESC
    LIMIT 1
  `).get(String(sourceId || '')));
}

function upsertSourceBinding(input = {}) {
  const now = String(input.updatedAt || input.observedAt || new Date().toISOString());
  const mediaItemId = String(input.mediaItemId || '').trim();
  const sourceId = String(input.sourceId || '').trim();
  if (!mediaItemId || !sourceId) throw Object.assign(new Error('mediaItemId and sourceId are required'), { code: 'NEXORA_BINDING_ID_REQUIRED' });
  const existing = getSourceBinding(mediaItemId, sourceId);
  const row = {
    binding_id: existing && existing.bindingId || String(input.bindingId || crypto.randomUUID()),
    media_item_id: mediaItemId,
    source_id: sourceId,
    validity: input.validity === 'valid' ? 'valid' : 'invalid',
    reason: String(input.reason || ''),
    evidence_ref: String(input.evidenceRef || ''),
    observed_at: String(input.observedAt || now),
    created_at: existing && existing.createdAt || String(input.createdAt || now),
    updated_at: now,
  };
  getDb().prepare(`
    INSERT INTO nexora_source_bindings
      (binding_id,media_item_id,source_id,validity,reason,evidence_ref,observed_at,created_at,updated_at)
    VALUES
      (@binding_id,@media_item_id,@source_id,@validity,@reason,@evidence_ref,@observed_at,@created_at,@updated_at)
    ON CONFLICT(media_item_id,source_id) DO UPDATE SET
      validity=excluded.validity,reason=excluded.reason,evidence_ref=excluded.evidence_ref,
      observed_at=excluded.observed_at,updated_at=excluded.updated_at
  `).run(row);
  return getSourceBinding(mediaItemId, sourceId);
}

function getSourceBindingsForItem(mediaItemId) {
  return getDb().prepare('SELECT * FROM nexora_source_bindings WHERE media_item_id=? ORDER BY updated_at DESC,source_id ASC').all(String(mediaItemId || '')).map(bindingRow);
}

function getSourceBindingsForItems(mediaItemIds = []) {
  const ids = [...new Set(mediaItemIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (ids.length === 0) return {};
  const rows = getDb().prepare(`SELECT * FROM nexora_source_bindings WHERE media_item_id IN (${ids.map(() => '?').join(',')}) ORDER BY media_item_id,updated_at DESC`).all(...ids);
  return rows.reduce((out, row) => {
    const binding = bindingRow(row);
    if (!out[binding.mediaItemId]) out[binding.mediaItemId] = [];
    out[binding.mediaItemId].push(binding);
    return out;
  }, {});
}

function insertSourceObservation(input = {}) {
  const now = String(input.createdAt || input.observedAt || new Date().toISOString());
  const row = {
    observation_id: String(input.observationId || crypto.randomUUID()),
    binding_id: String(input.bindingId || ''),
    media_item_id: String(input.mediaItemId || ''),
    source_id: String(input.sourceId || ''),
    result: String(input.result || ''),
    reason: String(input.reason || ''),
    identity_kind: String(input.identityKind || ''),
    identity_payload_json: JSON.stringify(input.identityPayload || {}),
    locator_json: JSON.stringify(input.locator || {}),
    evidence_json: JSON.stringify(input.evidence || {}),
    observed_at: String(input.observedAt || now),
    created_at: now,
  };
  if (!row.source_id || !row.result) throw Object.assign(new Error('sourceId and result are required'), { code: 'NEXORA_OBSERVATION_REQUIRED' });
  getDb().prepare(`
    INSERT INTO nexora_source_observations
      (observation_id,binding_id,media_item_id,source_id,result,reason,identity_kind,
       identity_payload_json,locator_json,evidence_json,observed_at,created_at)
    VALUES
      (@observation_id,@binding_id,@media_item_id,@source_id,@result,@reason,@identity_kind,
       @identity_payload_json,@locator_json,@evidence_json,@observed_at,@created_at)
  `).run(row);
  return { observationId: row.observation_id, bindingId: row.binding_id, mediaItemId: row.media_item_id, sourceId: row.source_id, result: row.result, reason: row.reason, identityKind: row.identity_kind, identityPayload: input.identityPayload || {}, locator: input.locator || {}, evidence: input.evidence || {}, observedAt: row.observed_at, createdAt: row.created_at };
}

function stateRow(row) {
  if (!row) return null;
  return {
    itemId: row.media_item_id,
    sourceRevision: Number(row.revision) || 0,
    readiness: row.readiness || 'unresolved',
    sourceAccessDescriptor: parse(row.access_descriptor_json, {}),
    latestObservationId: row.latest_observation_id || '',
    updatedAt: row.updated_at || '',
  };
}

function getSourceState(mediaItemId) {
  return stateRow(getDb().prepare('SELECT * FROM nexora_source_state WHERE media_item_id=?').get(String(mediaItemId || '')));
}

function bumpSourceState(input = {}) {
  const current = getSourceState(input.mediaItemId);
  const nextDescriptor = input.sourceAccessDescriptor || {};
  const nextReadiness = String(input.readiness || 'unresolved');
  if (current
    && current.readiness === nextReadiness
    && stableJson(current.sourceAccessDescriptor) === stableJson(nextDescriptor)) {
    getDb().prepare(`
      UPDATE nexora_source_state SET latest_observation_id=?,updated_at=? WHERE media_item_id=?
    `).run(String(input.latestObservationId || current.latestObservationId || ''), String(input.updatedAt || new Date().toISOString()), String(input.mediaItemId || ''));
    return getSourceState(input.mediaItemId);
  }
  const row = {
    media_item_id: String(input.mediaItemId || ''),
    revision: (current && current.sourceRevision || 0) + 1,
    readiness: nextReadiness,
    access_descriptor_json: JSON.stringify(nextDescriptor),
    latest_observation_id: String(input.latestObservationId || ''),
    updated_at: String(input.updatedAt || new Date().toISOString()),
  };
  getDb().prepare(`
    INSERT INTO nexora_source_state(media_item_id,revision,readiness,access_descriptor_json,latest_observation_id,updated_at)
    VALUES (@media_item_id,@revision,@readiness,@access_descriptor_json,@latest_observation_id,@updated_at)
    ON CONFLICT(media_item_id) DO UPDATE SET
      revision=excluded.revision,readiness=excluded.readiness,
      access_descriptor_json=excluded.access_descriptor_json,
      latest_observation_id=excluded.latest_observation_id,updated_at=excluded.updated_at
  `).run(row);
  return getSourceState(row.media_item_id);
}

function getSourceStates(mediaItemIds = []) {
  const ids = [...new Set(mediaItemIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (ids.length === 0) return {};
  return getDb().prepare(`SELECT * FROM nexora_source_state WHERE media_item_id IN (${ids.map(() => '?').join(',')})`).all(...ids).reduce((out, row) => {
    const state = stateRow(row);
    out[state.itemId] = state;
    return out;
  }, {});
}

function resetForTests() {
  for (const db of dbCache.values()) db.close();
  dbCache.clear();
}

module.exports = {
  upsertSourceBinding,
  getSourceBinding,
  findSourceBindingBySourceId,
  getSourceBindingsForItem,
  getSourceBindingsForItems,
  insertSourceObservation,
  getSourceState,
  getSourceStates,
  bumpSourceState,
  resetForTests,
};
