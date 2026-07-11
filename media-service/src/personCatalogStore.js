'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const configStore = require('./configStore');

const dbCache = new Map();
const PREFERENCE_MIN = -2;
const PREFERENCE_MAX = 2;

function clean(value, max = 320) {
  return String(value == null ? '' : value).normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizedName(value) {
  return clean(value).toLocaleLowerCase('en-US');
}

function parse(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; }
}

function nowIso() { return new Date().toISOString(); }

function resolveDataDir() { return configStore.resolveDataDir(); }
function artifactRoot() { return path.join(resolveDataDir(), 'person-artifacts'); }

function getDb() {
  const file = path.join(resolveDataDir(), 'tasks.db');
  let db = dbCache.get(file);
  if (db) return db;
  fs.mkdirSync(resolveDataDir(), { recursive: true });
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  ensureSchema(db);
  dbCache.set(file, db);
  return db;
}

function ensureSchema(db = getDb()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kairox_people (
      person_id TEXT PRIMARY KEY,
      canonical_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      aliases_json TEXT NOT NULL DEFAULT '[]',
      provider_ids_json TEXT NOT NULL DEFAULT '{}',
      source_keys_json TEXT NOT NULL DEFAULT '[]',
      content_kinds_json TEXT NOT NULL DEFAULT '[]',
      preference INTEGER NOT NULL DEFAULT 0,
      preference_revision INTEGER NOT NULL DEFAULT 0,
      dismissed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_kairox_people_name ON kairox_people(normalized_name);
    CREATE INDEX IF NOT EXISTS idx_kairox_people_preference ON kairox_people(preference,updated_at);

    CREATE TABLE IF NOT EXISTS kairox_item_people (
      item_id TEXT NOT NULL,
      person_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'actor',
      source TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 0,
      metadata_revision TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(item_id,person_id,role),
      FOREIGN KEY(person_id) REFERENCES kairox_people(person_id)
    );
    CREATE INDEX IF NOT EXISTS idx_kairox_item_people_person ON kairox_item_people(person_id,item_id);

    CREATE TABLE IF NOT EXISTS kairox_person_merge_candidates (
      candidate_id TEXT PRIMARY KEY,
      left_person_id TEXT NOT NULL,
      right_person_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      evidence_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_kairox_person_candidate_pair
      ON kairox_person_merge_candidates(left_person_id,right_person_id,reason);

    CREATE TABLE IF NOT EXISTS kairox_person_reference_artifacts (
      artifact_id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'face',
      file_name TEXT NOT NULL DEFAULT '',
      embedding_json TEXT NOT NULL DEFAULT '[]',
      source_json TEXT NOT NULL DEFAULT '{}',
      confidence REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(person_id) REFERENCES kairox_people(person_id)
    );
    CREATE INDEX IF NOT EXISTS idx_kairox_person_artifacts_person ON kairox_person_reference_artifacts(person_id,created_at);
  `);
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => clean(value)).filter(Boolean))];
}

function normalizeProviderIds(value = {}) {
  return Object.entries(value && typeof value === 'object' ? value : {}).reduce((out, [key, entry]) => {
    const name = clean(key, 80).toLowerCase();
    const id = clean(entry, 200);
    if (name && id) out[name] = id;
    return out;
  }, {});
}

function preference(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < PREFERENCE_MIN || number > PREFERENCE_MAX) {
    const error = new Error('preference must be an integer between -2 and 2');
    error.code = 'KAIROX_PERSON_PREFERENCE_INVALID';
    throw error;
  }
  return number;
}

function artifactRows(personId) {
  return getDb().prepare('SELECT * FROM kairox_person_reference_artifacts WHERE person_id=? ORDER BY created_at').all(personId);
}

function artifactFace(row, includeImage = true) {
  const source = parse(row.source_json, {});
  let sampleImageBase64 = '';
  if (includeImage && row.file_name) {
    const file = path.join(artifactRoot(), row.file_name);
    try { sampleImageBase64 = fs.readFileSync(file).toString('base64'); } catch (_) {}
  }
  return {
    faceId: row.artifact_id,
    artifactId: row.artifact_id,
    embedding: parse(row.embedding_json, []),
    sampleImageBase64,
    sampleImage: row.file_name ? path.join(artifactRoot(), row.file_name) : '',
    confidence: Number(row.confidence) || 0,
    ...source,
    createdAt: row.created_at,
  };
}

function rowToPerson(row, options = {}) {
  if (!row) return null;
  const relatedCount = row.related_media_count == null
    ? getDb().prepare('SELECT COUNT(*) AS count FROM kairox_item_people WHERE person_id=?').get(row.person_id).count || 0
    : Number(row.related_media_count) || 0;
  const artifacts = options.includeArtifacts ? artifactRows(row.person_id) : [];
  const referenceFaceCount = row.reference_face_count == null
    ? getDb().prepare('SELECT COUNT(*) AS count FROM kairox_person_reference_artifacts WHERE person_id=?').get(row.person_id).count || 0
    : Number(row.reference_face_count) || 0;
  return {
    personId: row.person_id,
    name: row.canonical_name,
    aliases: parse(row.aliases_json, []),
    providerIds: parse(row.provider_ids_json, {}),
    sourceKeys: parse(row.source_keys_json, []),
    contentKinds: parse(row.content_kinds_json, []),
    adultRegion: parse(row.content_kinds_json, []).includes('adult') ? 'western_adult' : '',
    preference: Number(row.preference) || 0,
    preferenceRevision: Number(row.preference_revision) || 0,
    dismissed: !!row.dismissed,
    referenceFaceCount,
    referenceFaces: options.includeArtifacts ? artifacts.map((entry) => artifactFace(entry, true)) : undefined,
    relatedMediaCount: Number(relatedCount) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getPerson(personId, options = {}) {
  return rowToPerson(getDb().prepare('SELECT * FROM kairox_people WHERE person_id=?').get(clean(personId)), options);
}

function findByStrongIdentity(providerIds, sourceKeys) {
  const providers = normalizeProviderIds(providerIds);
  const keys = uniqueStrings(sourceKeys);
  if (Object.keys(providers).length === 0 && keys.length === 0) return null;
  for (const row of getDb().prepare('SELECT * FROM kairox_people').all()) {
    const currentProviders = parse(row.provider_ids_json, {});
    if (Object.entries(providers).some(([key, value]) => currentProviders[key] === value)) return row;
    const currentKeys = parse(row.source_keys_json, []);
    if (keys.some((key) => currentKeys.includes(key))) return row;
  }
  return null;
}

function mergeJsonFacts(row, input = {}) {
  return {
    aliases: uniqueStrings([...parse(row.aliases_json, []), ...(input.aliases || [])]).filter((alias) => normalizedName(alias) !== row.normalized_name),
    providerIds: { ...parse(row.provider_ids_json, {}), ...normalizeProviderIds(input.providerIds) },
    sourceKeys: uniqueStrings([...parse(row.source_keys_json, []), ...(input.sourceKeys || [])]),
    contentKinds: uniqueStrings([...parse(row.content_kinds_json, []), ...(input.contentKinds || [])]),
  };
}

function updateIdentity(row, input) {
  const merged = mergeJsonFacts(row, input);
  getDb().prepare(`UPDATE kairox_people SET aliases_json=?,provider_ids_json=?,source_keys_json=?,content_kinds_json=?,updated_at=? WHERE person_id=?`)
    .run(JSON.stringify(merged.aliases), JSON.stringify(merged.providerIds), JSON.stringify(merged.sourceKeys), JSON.stringify(merged.contentKinds), nowIso(), row.person_id);
  return getPerson(row.person_id);
}

function createPerson(input = {}) {
  const name = clean(input.name);
  if (!name) throw Object.assign(new Error('name is required'), { code: 'KAIROX_PERSON_NAME_REQUIRED' });
  const id = clean(input.personId) || crypto.randomUUID();
  const now = nowIso();
  const contentKinds = uniqueStrings(input.contentKinds || (input.adultRegion ? ['adult'] : []));
  getDb().prepare(`
    INSERT INTO kairox_people
      (person_id,canonical_name,normalized_name,aliases_json,provider_ids_json,source_keys_json,content_kinds_json,preference,preference_revision,dismissed,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(id, name, normalizedName(name), JSON.stringify(uniqueStrings(input.aliases)), JSON.stringify(normalizeProviderIds(input.providerIds)), JSON.stringify(uniqueStrings(input.sourceKeys)), JSON.stringify(contentKinds), preference(input.preference == null ? 0 : input.preference), input.preference == null ? 0 : 1, input.dismissed ? 1 : 0, now, now);
  for (const face of input.referenceFaces || []) addReferenceFace(id, face);
  return getPerson(id, { includeArtifacts: true });
}

function addMergeCandidate(leftPersonId, rightPersonId, reason, evidence = {}) {
  const sorted = [leftPersonId, rightPersonId].sort();
  if (!sorted[0] || sorted[0] === sorted[1]) return;
  const now = nowIso();
  getDb().prepare(`
    INSERT INTO kairox_person_merge_candidates(candidate_id,left_person_id,right_person_id,reason,evidence_json,status,created_at,updated_at)
    VALUES (?,?,?,?,?,'pending',?,?)
    ON CONFLICT(left_person_id,right_person_id,reason) DO UPDATE SET evidence_json=excluded.evidence_json,updated_at=excluded.updated_at
  `).run(crypto.randomUUID(), sorted[0], sorted[1], reason, JSON.stringify(evidence), now, now);
}

function normalizeObservation(value = {}) {
  const name = clean(value.name || value.Name);
  return {
    personId: clean(value.personId),
    name,
    aliases: uniqueStrings(value.aliases),
    providerIds: normalizeProviderIds(value.providerIds || value.ProviderIds),
    sourceKeys: uniqueStrings([value.sourcePersonKey, ...(value.sourceKeys || [])]),
    contentKinds: uniqueStrings(value.contentKinds || [value.contentKind]),
    role: clean(value.role || value.type || 'actor', 80).toLowerCase(),
    source: clean(value.source, 120),
    confidence: Number(value.confidence) || 0,
  };
}

function observeItemPeople(input = {}) {
  const itemId = clean(input.itemId);
  if (!itemId) throw Object.assign(new Error('itemId is required'), { code: 'KAIROX_PERSON_ITEM_REQUIRED' });
  const observations = (Array.isArray(input.people) ? input.people : []).map(normalizeObservation).filter((entry) => entry.name && entry.role === 'actor');
  const db = getDb();
  const existingRelations = db.prepare(`SELECT ip.*,p.normalized_name FROM kairox_item_people ip JOIN kairox_people p ON p.person_id=ip.person_id WHERE ip.item_id=?`).all(itemId);
  const resolved = [];
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM kairox_item_people WHERE item_id=?').run(itemId);
    for (const observation of observations) {
      let row = observation.personId ? db.prepare('SELECT * FROM kairox_people WHERE person_id=?').get(observation.personId) : null;
      row = row || findByStrongIdentity(observation.providerIds, observation.sourceKeys);
      row = row || (() => {
        const relation = existingRelations.find((entry) => entry.normalized_name === normalizedName(observation.name));
        return relation && db.prepare('SELECT * FROM kairox_people WHERE person_id=?').get(relation.person_id);
      })();
      if (!row) {
        const person = createPerson(observation);
        row = db.prepare('SELECT * FROM kairox_people WHERE person_id=?').get(person.personId);
        const sameNames = db.prepare('SELECT person_id FROM kairox_people WHERE normalized_name=? AND person_id<>?').all(normalizedName(observation.name), person.personId);
        for (const candidate of sameNames) addMergeCandidate(person.personId, candidate.person_id, 'same_name', { name: observation.name });
      } else {
        updateIdentity(row, observation);
      }
      const now = nowIso();
      db.prepare(`INSERT INTO kairox_item_people(item_id,person_id,role,source,confidence,metadata_revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
        .run(itemId, row.person_id, observation.role, observation.source, observation.confidence, clean(input.metadataRevision), now, now);
      resolved.push(row.person_id);
    }
  });
  tx();
  return getItemPreferenceProjection(itemId);
}

function getItemPreferenceProjection(itemId) {
  const rows = getDb().prepare(`
    SELECT p.person_id,p.canonical_name,p.preference,ip.role
    FROM kairox_item_people ip JOIN kairox_people p ON p.person_id=ip.person_id
    WHERE ip.item_id=? AND ip.role='actor' ORDER BY p.canonical_name
  `).all(clean(itemId));
  const scores = rows.map((row) => Number(row.preference) || 0);
  return {
    actorPersonIds: rows.map((row) => row.person_id),
    actorPeople: rows.map((row) => ({ personId: row.person_id, name: row.canonical_name, preference: Number(row.preference) || 0 })),
    actorPreferenceMax: scores.length ? Math.max(...scores) : null,
    actorPreferenceMin: scores.length ? Math.min(...scores) : null,
  };
}

function getItemPreferenceProjections(itemIds = []) {
  const ids = [...new Set((itemIds || []).map(clean).filter(Boolean))];
  const projections = Object.fromEntries(ids.map((itemId) => [itemId, {
    actorPersonIds: [], actorPeople: [], actorPreferenceMax: null, actorPreferenceMin: null,
  }]));
  if (ids.length === 0) return projections;
  const placeholders = ids.map(() => '?').join(',');
  const rows = getDb().prepare(`
    SELECT ip.item_id,p.person_id,p.canonical_name,p.preference
    FROM kairox_item_people ip JOIN kairox_people p ON p.person_id=ip.person_id
    WHERE ip.item_id IN (${placeholders}) AND ip.role='actor'
    ORDER BY ip.item_id,p.canonical_name
  `).all(...ids);
  for (const row of rows) {
    const projection = projections[row.item_id];
    if (!projection) continue;
    const score = Number(row.preference) || 0;
    projection.actorPersonIds.push(row.person_id);
    projection.actorPeople.push({ personId: row.person_id, name: row.canonical_name, preference: score });
    projection.actorPreferenceMax = projection.actorPreferenceMax == null ? score : Math.max(projection.actorPreferenceMax, score);
    projection.actorPreferenceMin = projection.actorPreferenceMin == null ? score : Math.min(projection.actorPreferenceMin, score);
  }
  return projections;
}

function listPeople(options = {}) {
  const query = normalizedName(options.search || options.q);
  const kind = clean(options.contentKind || (options.adultRegion ? 'adult' : ''));
  const preferenceValue = options.preference === undefined || options.preference === '' ? null : preference(options.preference);
  const limit = Math.max(1, Math.min(200, Number(options.limit) || 50));
  const offset = Math.max(0, Number(options.offset) || 0);
  const clauses = [];
  const params = { limit, offset };
  if (query) {
    clauses.push("(p.normalized_name LIKE @search OR LOWER(p.aliases_json) LIKE @search)");
    params.search = `%${query}%`;
  }
  if (kind) {
    clauses.push("EXISTS (SELECT 1 FROM json_each(p.content_kinds_json) WHERE value=@content_kind)");
    params.content_kind = kind;
  }
  if (preferenceValue != null) {
    clauses.push('p.preference=@preference');
    params.preference = preferenceValue;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const db = getDb();
  const total = Number(db.prepare(`SELECT COUNT(*) AS count FROM kairox_people p ${where}`).get(params).count) || 0;
  const rows = db.prepare(`
    SELECT p.*,
      COUNT(DISTINCT ip.item_id) AS related_media_count,
      (SELECT COUNT(*) FROM kairox_person_reference_artifacts a WHERE a.person_id=p.person_id) AS reference_face_count
    FROM kairox_people p
    LEFT JOIN kairox_item_people ip ON ip.person_id=p.person_id
    ${where}
    GROUP BY p.person_id
    ORDER BY p.canonical_name
    LIMIT @limit OFFSET @offset
  `).all(params);
  return { total, people: rows.map((row) => rowToPerson(row, { includeArtifacts: options.includeArtifacts === true })) };
}

function updatePerson(personId, updates = {}) {
  const current = getPerson(personId, { includeArtifacts: true });
  if (!current) return null;
  const name = updates.name === undefined ? current.name : clean(updates.name);
  if (!name) throw Object.assign(new Error('name is required'), { code: 'KAIROX_PERSON_NAME_REQUIRED' });
  const nextPreference = updates.preference === undefined ? current.preference : preference(updates.preference);
  const nextContentKinds = updates.contentKinds === undefined ? current.contentKinds : uniqueStrings(updates.contentKinds);
  const changedPreference = nextPreference !== current.preference;
  getDb().prepare(`
    UPDATE kairox_people SET canonical_name=?,normalized_name=?,aliases_json=?,content_kinds_json=?,preference=?,
      preference_revision=preference_revision+?,dismissed=?,updated_at=? WHERE person_id=?
  `).run(name, normalizedName(name), JSON.stringify(updates.aliases === undefined ? current.aliases : uniqueStrings(updates.aliases)), JSON.stringify(nextContentKinds), nextPreference, changedPreference ? 1 : 0, updates.dismissed === undefined ? (current.dismissed ? 1 : 0) : (updates.dismissed ? 1 : 0), nowIso(), current.personId);
  return getPerson(current.personId, { includeArtifacts: true });
}

function getRelatedItemIds(personId) {
  return getDb().prepare('SELECT DISTINCT item_id FROM kairox_item_people WHERE person_id=? ORDER BY item_id').all(clean(personId)).map((row) => row.item_id);
}

function getMergeCandidates() {
  return getDb().prepare("SELECT * FROM kairox_person_merge_candidates WHERE status='pending' ORDER BY updated_at DESC").all().map((row) => ({
    candidateId: row.candidate_id,
    left: getPerson(row.left_person_id),
    right: getPerson(row.right_person_id),
    reason: row.reason,
    evidence: parse(row.evidence_json, {}),
    createdAt: row.created_at,
  }));
}

function mergePeople(input = {}) {
  const target = getPerson(input.targetPersonId, { includeArtifacts: true });
  const source = getPerson(input.sourcePersonId, { includeArtifacts: true });
  if (!target || !source || target.personId === source.personId) throw Object.assign(new Error('Two different people are required'), { code: 'KAIROX_PERSON_MERGE_INVALID' });
  const finalPreference = input.preference === undefined ? target.preference : preference(input.preference);
  const db = getDb();
  const tx = db.transaction(() => {
    const targetRow = db.prepare('SELECT * FROM kairox_people WHERE person_id=?').get(target.personId);
    const merged = mergeJsonFacts(targetRow, {
      aliases: [...source.aliases, source.name], providerIds: source.providerIds, sourceKeys: source.sourceKeys, contentKinds: source.contentKinds,
    });
    db.prepare(`UPDATE kairox_people SET aliases_json=?,provider_ids_json=?,source_keys_json=?,content_kinds_json=?,preference=?,preference_revision=preference_revision+1,updated_at=? WHERE person_id=?`)
      .run(JSON.stringify(merged.aliases), JSON.stringify(merged.providerIds), JSON.stringify(merged.sourceKeys), JSON.stringify(merged.contentKinds), finalPreference, nowIso(), target.personId);
    for (const relation of db.prepare('SELECT * FROM kairox_item_people WHERE person_id=?').all(source.personId)) {
      db.prepare(`INSERT INTO kairox_item_people(item_id,person_id,role,source,confidence,metadata_revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(item_id,person_id,role) DO UPDATE SET confidence=MAX(confidence,excluded.confidence),updated_at=excluded.updated_at`)
        .run(relation.item_id, target.personId, relation.role, relation.source, relation.confidence, relation.metadata_revision, relation.created_at, nowIso());
    }
    db.prepare('DELETE FROM kairox_item_people WHERE person_id=?').run(source.personId);
    db.prepare('UPDATE kairox_person_reference_artifacts SET person_id=? WHERE person_id=?').run(target.personId, source.personId);
    db.prepare("UPDATE kairox_person_merge_candidates SET status='resolved',updated_at=? WHERE left_person_id IN (?,?) OR right_person_id IN (?,?)").run(nowIso(), target.personId, source.personId, target.personId, source.personId);
    db.prepare('DELETE FROM kairox_people WHERE person_id=?').run(source.personId);
  });
  tx();
  return { person: getPerson(target.personId, { includeArtifacts: true }), affectedItemIds: [...new Set([...getRelatedItemIds(target.personId)])] };
}

function normalizeReferenceFace(face = {}) {
  const requestedId = clean(face.faceId || face.clusterId).replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 120);
  return {
    faceId: requestedId || crypto.randomUUID(),
    embedding: (Array.isArray(face.embedding || face.vector) ? (face.embedding || face.vector) : []).map(Number).filter(Number.isFinite).slice(0, 4096),
    sampleImageBase64: clean(face.sampleImageBase64 || face.cropImageBase64, 25_000_000),
    sampleImage: clean(face.sampleImage, 1000),
    confidence: Number(face.confidence) || 0,
    sourceItemId: clean(face.sourceItemId),
    sourceAssetId: clean(face.sourceAssetId),
    clusterId: clean(face.clusterId),
  };
}

function addReferenceFace(personId, value = {}) {
  if (!getPerson(personId)) throw Object.assign(new Error('Person not found'), { code: 'KAIROX_PERSON_NOT_FOUND' });
  const face = normalizeReferenceFace(value);
  let fileName = '';
  if (face.sampleImageBase64) {
    fs.mkdirSync(artifactRoot(), { recursive: true });
    fileName = `${face.faceId}.jpg`;
    fs.writeFileSync(path.join(artifactRoot(), fileName), Buffer.from(face.sampleImageBase64, 'base64'));
  }
  getDb().prepare(`INSERT INTO kairox_person_reference_artifacts(artifact_id,person_id,kind,file_name,embedding_json,source_json,confidence,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(face.faceId, clean(personId), 'face', fileName, JSON.stringify(face.embedding), JSON.stringify({ sourceItemId: face.sourceItemId, sourceAssetId: face.sourceAssetId, clusterId: face.clusterId }), face.confidence, nowIso());
  return getPerson(personId, { includeArtifacts: true });
}

function deleteReferenceFace(personId, artifactId) {
  const row = getDb().prepare('SELECT * FROM kairox_person_reference_artifacts WHERE artifact_id=? AND person_id=?').get(clean(artifactId), clean(personId));
  if (!row) return false;
  if (row.file_name) fs.rmSync(path.join(artifactRoot(), row.file_name), { force: true });
  getDb().prepare('DELETE FROM kairox_person_reference_artifacts WHERE artifact_id=?').run(row.artifact_id);
  return true;
}

function deletePerson(personId) {
  const person = getPerson(personId);
  if (!person) return false;
  if (person.relatedMediaCount > 0) throw Object.assign(new Error('Person is still linked to media'), { code: 'KAIROX_PERSON_IN_USE' });
  for (const row of artifactRows(person.personId)) if (row.file_name) fs.rmSync(path.join(artifactRoot(), row.file_name), { force: true });
  getDb().prepare('DELETE FROM kairox_person_reference_artifacts WHERE person_id=?').run(person.personId);
  getDb().prepare('DELETE FROM kairox_people WHERE person_id=?').run(person.personId);
  return true;
}

function listDismissedEmbeddings(filter = {}) {
  return listPeople({ contentKind: filter.adultRegion ? 'adult' : '' }).people.filter((person) => person.dismissed)
    .flatMap((person) => artifactRows(person.personId).map((row) => parse(row.embedding_json, [])).filter((embedding) => embedding.length));
}

function loadPeople() { return { version: 2, people: listPeople({ limit: 200 }).people.map((person) => getPerson(person.personId, { includeArtifacts: true })) }; }

function resetForTests() {
  for (const db of dbCache.values()) db.close();
  dbCache.clear();
}

module.exports = {
  PREFERENCE_MIN,
  PREFERENCE_MAX,
  ensureSchema,
  createPerson,
  getPerson,
  listPeople,
  updatePerson,
  deletePerson,
  observeItemPeople,
  getItemPreferenceProjection,
  getItemPreferenceProjections,
  getRelatedItemIds,
  getMergeCandidates,
  mergePeople,
  normalizeReferenceFace,
  addReferenceFace,
  deleteReferenceFace,
  listDismissedEmbeddings,
  loadPeople,
  resetForTests,
};
