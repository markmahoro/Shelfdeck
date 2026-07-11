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
    CREATE TABLE IF NOT EXISTS nexora_subject_bindings (
      subject_id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL UNIQUE,
      validity TEXT NOT NULL DEFAULT 'invalid',
      reason TEXT NOT NULL DEFAULT '',
      evidence_ref TEXT NOT NULL DEFAULT '',
      observed_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_nexora_subject_bindings_item ON nexora_subject_bindings(subject_id);
    CREATE TABLE IF NOT EXISTS nexora_source_observations (
      observation_id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL DEFAULT '',
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
    CREATE INDEX IF NOT EXISTS idx_nexora_source_observations_item ON nexora_source_observations(subject_id, observed_at);
    CREATE TABLE IF NOT EXISTS nexora_subject_state (
      subject_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL DEFAULT 0,
      readiness TEXT NOT NULL DEFAULT 'unresolved',
      access_descriptor_json TEXT NOT NULL DEFAULT '{}',
      latest_observation_id TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_nexora_subject_state_readiness ON nexora_subject_state(readiness, revision);
    CREATE TABLE IF NOT EXISTS nexora_source_assets (
      asset_id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL,
      asset_kind TEXT NOT NULL,
      season_key TEXT NOT NULL DEFAULT '',
      episode_key TEXT NOT NULL DEFAULT '',
      part_key TEXT NOT NULL DEFAULT '',
      source_identity_hash TEXT NOT NULL,
      provider_identity_json TEXT NOT NULL DEFAULT '{}',
      source_reference_json TEXT NOT NULL DEFAULT '{}',
      canonical_locator_json TEXT NOT NULL DEFAULT '{}',
      evidence_json TEXT NOT NULL DEFAULT '{}',
      asset_revision INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      first_observed_at TEXT NOT NULL,
      last_observed_at TEXT NOT NULL,
      removed_at TEXT NOT NULL DEFAULT '',
      UNIQUE(subject_id,source_identity_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_nexora_assets_subject_status ON nexora_source_assets(subject_id,status,season_key,episode_key);
    CREATE TABLE IF NOT EXISTS nexora_observation_sessions (
      work_id TEXT PRIMARY KEY,
      sub_library_id TEXT NOT NULL,
      cursor_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'running',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finalized_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS nexora_observation_session_assets (
      work_id TEXT NOT NULL,
      source_subject_key TEXT NOT NULL,
      source_asset_key TEXT NOT NULL,
      observation_json TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      PRIMARY KEY(work_id,source_subject_key,source_asset_key)
    );
    CREATE INDEX IF NOT EXISTS idx_nexora_session_assets_subject ON nexora_observation_session_assets(work_id,source_subject_key);
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

function assetRow(row) {
  if (!row) return null;
  return {
    assetId: row.asset_id,
    subjectId: row.subject_id,
    assetKind: row.asset_kind,
    seasonKey: row.season_key || '',
    episodeKey: row.episode_key || '',
    partKey: row.part_key || '',
    sourceIdentityHash: row.source_identity_hash,
    providerIdentity: parse(row.provider_identity_json, {}),
    sourceReference: parse(row.source_reference_json, {}),
    canonicalLocator: parse(row.canonical_locator_json, {}),
    evidence: parse(row.evidence_json, {}),
    assetRevision: Number(row.asset_revision) || 1,
    status: row.status,
    firstObservedAt: row.first_observed_at,
    lastObservedAt: row.last_observed_at,
    removedAt: row.removed_at || '',
  };
}

function sourceIdentityHash(value) {
  return crypto.createHash('sha256').update(stableJson(value || {})).digest('hex');
}

function listSourceAssets(subjectId, options = {}) {
  const includeRemoved = options.includeRemoved === true;
  return getDb().prepare(`SELECT * FROM nexora_source_assets WHERE subject_id=? ${includeRemoved ? '' : "AND status='active'"} ORDER BY season_key,episode_key,part_key,asset_id`)
    .all(String(subjectId || '')).map(assetRow);
}

function upsertSourceAsset(input = {}) {
  const now = String(input.observedAt || new Date().toISOString());
  const subjectId = String(input.subjectId || '').trim();
  const identityHash = String(input.sourceIdentityHash || sourceIdentityHash(input.sourceIdentity || input.sourceReference || input.canonicalLocator)).trim();
  if (!subjectId || !identityHash) throw Object.assign(new Error('subjectId and source identity are required'), { code: 'NEXORA_ASSET_IDENTITY_REQUIRED' });
  const db = getDb();
  let existing = db.prepare('SELECT * FROM nexora_source_assets WHERE subject_id=? AND source_identity_hash=?').get(subjectId, identityHash);
  if (!existing && input.providerIdentity && Object.keys(input.providerIdentity).length > 0) {
    existing = db.prepare("SELECT * FROM nexora_source_assets WHERE subject_id=? AND provider_identity_json=? AND status='active' LIMIT 1")
      .get(subjectId, JSON.stringify(input.providerIdentity));
  }
  if (!existing && (input.seasonKey || input.episodeKey || input.partKey)) {
    existing = db.prepare("SELECT * FROM nexora_source_assets WHERE subject_id=? AND season_key=? AND episode_key=? AND part_key=? AND status='active' LIMIT 1")
      .get(subjectId, String(input.seasonKey || ''), String(input.episodeKey || ''), String(input.partKey || ''));
  }
  const assetId = existing && existing.asset_id || String(input.assetId || crypto.randomUUID());
  const changed = !existing
    || stableJson(parse(existing.provider_identity_json, {})) !== stableJson(input.providerIdentity || {})
    || stableJson(parse(existing.source_reference_json, {})) !== stableJson(input.sourceReference || {})
    || stableJson(parse(existing.canonical_locator_json, {})) !== stableJson(input.canonicalLocator || {})
    || String(existing.season_key || '') !== String(input.seasonKey || '')
    || String(existing.episode_key || '') !== String(input.episodeKey || '')
    || existing.status !== 'active';
  db.prepare(`
    INSERT INTO nexora_source_assets
      (asset_id,subject_id,asset_kind,season_key,episode_key,part_key,source_identity_hash,provider_identity_json,
       source_reference_json,canonical_locator_json,evidence_json,asset_revision,status,first_observed_at,last_observed_at,removed_at)
    VALUES (@asset_id,@subject_id,@asset_kind,@season_key,@episode_key,@part_key,@source_identity_hash,@provider_identity_json,
       @source_reference_json,@canonical_locator_json,@evidence_json,@asset_revision,'active',@first_observed_at,@last_observed_at,'')
    ON CONFLICT(asset_id) DO UPDATE SET
      asset_kind=excluded.asset_kind,season_key=excluded.season_key,episode_key=excluded.episode_key,part_key=excluded.part_key,
      source_identity_hash=excluded.source_identity_hash,provider_identity_json=excluded.provider_identity_json,source_reference_json=excluded.source_reference_json,
      canonical_locator_json=excluded.canonical_locator_json,evidence_json=excluded.evidence_json,
      asset_revision=excluded.asset_revision,status='active',last_observed_at=excluded.last_observed_at,removed_at=''
  `).run({
    asset_id: assetId, subject_id: subjectId, asset_kind: String(input.assetKind || 'file'),
    season_key: String(input.seasonKey || ''), episode_key: String(input.episodeKey || ''), part_key: String(input.partKey || ''),
    source_identity_hash: identityHash, provider_identity_json: JSON.stringify(input.providerIdentity || {}),
    source_reference_json: JSON.stringify(input.sourceReference || {}), canonical_locator_json: JSON.stringify(input.canonicalLocator || {}),
    evidence_json: JSON.stringify(input.evidence || {}), asset_revision: existing ? Number(existing.asset_revision) + (changed ? 1 : 0) : 1,
    first_observed_at: existing && existing.first_observed_at || now, last_observed_at: now,
  });
  return assetRow(db.prepare('SELECT * FROM nexora_source_assets WHERE asset_id=?').get(assetId));
}

function markUnobservedAssetsRemoved(subjectId, observedAssetIds = [], observedAt = new Date().toISOString()) {
  const ids = new Set(observedAssetIds.map(String));
  const active = listSourceAssets(subjectId);
  const update = getDb().prepare("UPDATE nexora_source_assets SET status='removed',removed_at=?,last_observed_at=?,asset_revision=asset_revision+1,evidence_json=? WHERE asset_id=? AND status='active'");
  const removed = [];
  getDb().transaction(() => {
    for (const asset of active) if (!ids.has(asset.assetId)) { update.run(observedAt, observedAt, JSON.stringify({ ...asset.evidence, removal: { reason: 'not_observed_in_complete_manifest', observedAt } }), asset.assetId); removed.push(asset.assetId); }
  })();
  return removed;
}

function recordAssetMutation(subjectId, seasonKey, mutation) {
  const assets = listSourceAssets(subjectId).filter((asset) => !seasonKey || String(asset.seasonKey) === String(seasonKey));
  const now = String(mutation.committedAt || new Date().toISOString());
  const update = getDb().prepare('UPDATE nexora_source_assets SET asset_revision=asset_revision+1,canonical_locator_json=?,evidence_json=?,last_observed_at=? WHERE asset_id=?');
  const replacements = mutation.newSourceEvidence && mutation.newSourceEvidence.assets || [];
  getDb().transaction(() => {
    for (const asset of assets) {
      const replacement = replacements.find((entry) => String(entry.episodeKey || '') === String(asset.episodeKey || '') && String(entry.partKey || '') === String(asset.partKey || ''));
      const locator = replacement && replacement.path ? { ...asset.canonicalLocator, path: replacement.path } : asset.canonicalLocator;
      update.run(JSON.stringify(locator), JSON.stringify({ ...asset.evidence, sourceMutation: mutation }), now, asset.assetId);
    }
  })();
  return listSourceAssets(subjectId).filter((asset) => assets.some((selected) => selected.assetId === asset.assetId));
}

function beginObservationSession(input = {}) {
  const now = String(input.createdAt || new Date().toISOString());
  const workId = String(input.workId || '').trim();
  if (!workId) throw Object.assign(new Error('workId is required'), { code: 'NEXORA_OBSERVATION_WORK_REQUIRED' });
  getDb().prepare(`INSERT INTO nexora_observation_sessions(work_id,sub_library_id,cursor_json,status,created_at,updated_at)
    VALUES (?,?,?,'running',?,?) ON CONFLICT(work_id) DO NOTHING`).run(workId, String(input.subLibraryId || ''), JSON.stringify(input.cursor || {}), now, now);
  return getObservationSession(workId);
}

function getObservationSession(workId) {
  const row = getDb().prepare('SELECT * FROM nexora_observation_sessions WHERE work_id=?').get(String(workId || ''));
  return row ? { workId: row.work_id, subLibraryId: row.sub_library_id, cursor: parse(row.cursor_json, {}), status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, finalizedAt: row.finalized_at } : null;
}

function stageObservationSessionAssets(workId, observations = [], cursor = {}) {
  const now = new Date().toISOString();
  const insert = getDb().prepare(`INSERT INTO nexora_observation_session_assets(work_id,source_subject_key,source_asset_key,observation_json,observed_at)
    VALUES (?,?,?,?,?) ON CONFLICT(work_id,source_subject_key,source_asset_key) DO UPDATE SET observation_json=excluded.observation_json,observed_at=excluded.observed_at`);
  getDb().transaction(() => {
    for (const observation of observations) insert.run(String(workId), String(observation.sourceSubjectKey), String(observation.sourceAssetKey), JSON.stringify(observation), now);
    getDb().prepare('UPDATE nexora_observation_sessions SET cursor_json=?,updated_at=? WHERE work_id=?').run(JSON.stringify(cursor || {}), now, String(workId));
  })();
}

function listObservationSessionAssets(workId) {
  return getDb().prepare('SELECT observation_json FROM nexora_observation_session_assets WHERE work_id=? ORDER BY source_subject_key,source_asset_key')
    .all(String(workId || '')).map((row) => parse(row.observation_json, {}));
}

function finalizeObservationSession(workId) {
  const now = new Date().toISOString();
  getDb().prepare("UPDATE nexora_observation_sessions SET status='finalized',finalized_at=?,updated_at=? WHERE work_id=? AND status='running'").run(now, now, String(workId));
  return getObservationSession(workId);
}

function bindingRow(row) {
  if (!row) return null;
  return {
    subjectId: row.subject_id,
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

function getSourceBinding(subjectId) {
  return bindingRow(getDb().prepare('SELECT * FROM nexora_subject_bindings WHERE subject_id=?').get(String(subjectId || '')));
}

function findSourceBindingBySourceId(sourceId) {
  return bindingRow(getDb().prepare(`
    SELECT * FROM nexora_subject_bindings
    WHERE source_id=?
    ORDER BY CASE validity WHEN 'valid' THEN 0 ELSE 1 END, updated_at DESC
    LIMIT 1
  `).get(String(sourceId || '')));
}

function upsertSourceBinding(input = {}) {
  const now = String(input.updatedAt || input.observedAt || new Date().toISOString());
  const subjectId = String(input.subjectId || '').trim();
  const sourceId = String(input.sourceId || '').trim();
  if (!subjectId || !sourceId) throw Object.assign(new Error('subjectId and sourceId are required'), { code: 'NEXORA_BINDING_ID_REQUIRED' });
  const existing = getSourceBinding(subjectId);
  const row = {
    subject_id: subjectId,
    source_id: sourceId,
    validity: input.validity === 'valid' ? 'valid' : 'invalid',
    reason: String(input.reason || ''),
    evidence_ref: String(input.evidenceRef || ''),
    observed_at: String(input.observedAt || now),
    created_at: existing && existing.createdAt || String(input.createdAt || now),
    updated_at: now,
  };
  getDb().prepare(`
    INSERT INTO nexora_subject_bindings
      (subject_id,source_id,validity,reason,evidence_ref,observed_at,created_at,updated_at)
    VALUES
      (@subject_id,@source_id,@validity,@reason,@evidence_ref,@observed_at,@created_at,@updated_at)
    ON CONFLICT(subject_id) DO UPDATE SET
      source_id=excluded.source_id,validity=excluded.validity,reason=excluded.reason,evidence_ref=excluded.evidence_ref,
      observed_at=excluded.observed_at,updated_at=excluded.updated_at
  `).run(row);
  return getSourceBinding(subjectId);
}

function getSourceBindingsForSubject(subjectId) {
  return getDb().prepare('SELECT * FROM nexora_subject_bindings WHERE subject_id=? ORDER BY updated_at DESC,source_id ASC').all(String(subjectId || '')).map(bindingRow);
}

function getSourceBindingsForSubjects(subjectIds = []) {
  const ids = [...new Set(subjectIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (ids.length === 0) return {};
  const rows = getDb().prepare(`SELECT * FROM nexora_subject_bindings WHERE subject_id IN (${ids.map(() => '?').join(',')}) ORDER BY subject_id,updated_at DESC`).all(...ids);
  return rows.reduce((out, row) => {
    const binding = bindingRow(row);
    if (!out[binding.subjectId]) out[binding.subjectId] = [];
    out[binding.subjectId].push(binding);
    return out;
  }, {});
}

function insertSourceObservation(input = {}) {
  const now = String(input.createdAt || input.observedAt || new Date().toISOString());
  const row = {
    observation_id: String(input.observationId || crypto.randomUUID()),
    subject_id: String(input.subjectId || ''),
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
      (observation_id,subject_id,source_id,result,reason,identity_kind,
       identity_payload_json,locator_json,evidence_json,observed_at,created_at)
    VALUES
      (@observation_id,@subject_id,@source_id,@result,@reason,@identity_kind,
       @identity_payload_json,@locator_json,@evidence_json,@observed_at,@created_at)
  `).run(row);
  return { observationId: row.observation_id, subjectId: row.subject_id, sourceId: row.source_id, result: row.result, reason: row.reason, identityKind: row.identity_kind, identityPayload: input.identityPayload || {}, locator: input.locator || {}, evidence: input.evidence || {}, observedAt: row.observed_at, createdAt: row.created_at };
}

function stateRow(row) {
  if (!row) return null;
  return {
    subjectId: row.subject_id,
    sourceRevision: Number(row.revision) || 0,
    readiness: row.readiness || 'unresolved',
    sourceAccessDescriptor: parse(row.access_descriptor_json, {}),
    latestObservationId: row.latest_observation_id || '',
    updatedAt: row.updated_at || '',
  };
}

function getSourceState(subjectId) {
  return stateRow(getDb().prepare('SELECT * FROM nexora_subject_state WHERE subject_id=?').get(String(subjectId || '')));
}

function bumpSourceState(input = {}) {
  const current = getSourceState(input.subjectId);
  const nextDescriptor = input.sourceAccessDescriptor || {};
  const nextReadiness = String(input.readiness || 'unresolved');
  if (input.forceRevision !== true && current
    && current.readiness === nextReadiness
    && stableJson(current.sourceAccessDescriptor) === stableJson(nextDescriptor)) {
    getDb().prepare(`
      UPDATE nexora_subject_state SET latest_observation_id=?,updated_at=? WHERE subject_id=?
    `).run(String(input.latestObservationId || current.latestObservationId || ''), String(input.updatedAt || new Date().toISOString()), String(input.subjectId || ''));
    return getSourceState(input.subjectId);
  }
  const row = {
    subject_id: String(input.subjectId || ''),
    revision: (current && current.sourceRevision || 0) + 1,
    readiness: nextReadiness,
    access_descriptor_json: JSON.stringify(nextDescriptor),
    latest_observation_id: String(input.latestObservationId || ''),
    updated_at: String(input.updatedAt || new Date().toISOString()),
  };
  getDb().prepare(`
    INSERT INTO nexora_subject_state(subject_id,revision,readiness,access_descriptor_json,latest_observation_id,updated_at)
    VALUES (@subject_id,@revision,@readiness,@access_descriptor_json,@latest_observation_id,@updated_at)
    ON CONFLICT(subject_id) DO UPDATE SET
      revision=excluded.revision,readiness=excluded.readiness,
      access_descriptor_json=excluded.access_descriptor_json,
      latest_observation_id=excluded.latest_observation_id,updated_at=excluded.updated_at
  `).run(row);
  return getSourceState(row.subject_id);
}

function getSourceStates(subjectIds = []) {
  const ids = [...new Set(subjectIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (ids.length === 0) return {};
  return getDb().prepare(`SELECT * FROM nexora_subject_state WHERE subject_id IN (${ids.map(() => '?').join(',')})`).all(...ids).reduce((out, row) => {
    const state = stateRow(row);
    out[state.subjectId] = state;
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
  getSourceBindingsForSubject,
  getSourceBindingsForSubjects,
  insertSourceObservation,
  getSourceState,
  getSourceStates,
  bumpSourceState,
  sourceIdentityHash,
  upsertSourceAsset,
  listSourceAssets,
  markUnobservedAssetsRemoved,
  recordAssetMutation,
  beginObservationSession,
  getObservationSession,
  stageObservationSessionAssets,
  listObservationSessionAssets,
  finalizeObservationSession,
  resetForTests,
};
