'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const configStore = require('./configStore');

function peopleFilePath() {
  return path.join(configStore.resolveDataDir(), 'people.json');
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 160);
}

// Derive a stable, human-readable 2-5 letter code from a name (e.g.
// "Skin Diamond" -> "SKDI"). This code becomes the 番号 prefix for that actor
// and must NEVER change once assigned — the 番号 is the user's memory anchor.
function computeCanonicalCode(name) {
  const cleaned = normalizeName(name).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  let code = '';
  if (words.length === 1) {
    code = words[0].slice(0, 4);
  } else {
    code = words.map((w) => w[0] || '').join('');
    // Pad with second letters of the first word if too short.
    let wi = 0;
    let li = 1;
    while (code.length < 4 && wi < words.length) {
      const extra = words[wi].slice(li, li + 1);
      if (extra) code = (code + extra).slice(0, 4);
      wi += 1;
      if (wi >= words.length) { wi = 0; li += 1; }
    }
    code = code.slice(0, 4);
  }
  return code || 'UNKN';
}

// Ensure a person's canonicalCode is unique across the people store. Collisions
// get a trailing digit (SKDI -> SKD2 -> SKD3 ...).
function assignUniqueCanonicalCode(data, baseName) {
  let code = computeCanonicalCode(baseName);
  if (!data.people.some((p) => p.canonicalCode === code)) return code;
  // Existing code reuse: if this exact person already has it, keep it.
  let n = 2;
  while (data.people.some((p) => p.canonicalCode === `${code.slice(0, 3)}${n}`)) n += 1;
  return `${code.slice(0, 3)}${n}`;
}

function getOrCreateCanonicalCode(data, input, existing) {
  if (existing && existing.canonicalCode) return existing.canonicalCode;
  return assignUniqueCanonicalCode(data, input.name || existing && existing.name || 'Unknown');
}

function normalizeVector(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x))
    .slice(0, 4096);
}

function normalizeReferenceFace(face = {}) {
  const embedding = normalizeVector(face.embedding || face.vector);
  const sampleImageBase64 = String(face.sampleImageBase64 || face.cropImageBase64 || '').trim();
  const sampleImage = String(face.sampleImage || '').trim();
  return {
    faceId: String(face.faceId || face.clusterId || crypto.randomUUID()).slice(0, 160),
    clusterId: String(face.clusterId || face.faceId || '').slice(0, 160),
    sourceItemId: String(face.sourceItemId || '').slice(0, 160),
    sourceAssetId: String(face.sourceAssetId || '').slice(0, 160),
    embedding,
    sampleImageBase64,
    sampleImage,
    confidence: Number.isFinite(Number(face.confidence)) ? Number(face.confidence) : 0,
    createdAt: face.createdAt || nowIso(),
  };
}

function normalizeReferenceFaces(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeReferenceFace)
    .filter((face) => face.embedding.length > 0 || face.sampleImageBase64 || face.sampleImage)
    .slice(0, 100);
}

function loadPeople() {
  const file = peopleFilePath();
  if (!fs.existsSync(file)) return { version: 1, people: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { version: 1, people: Array.isArray(raw.people) ? raw.people : [] };
  } catch (e) {
    return { version: 1, people: [] };
  }
}

function savePeople(data) {
  fs.mkdirSync(configStore.resolveDataDir(), { recursive: true });
  const file = peopleFilePath();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({
    version: 1,
    people: Array.isArray(data.people) ? data.people : [],
  }, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function listPeople(filter = {}) {
  const data = loadPeople();
  let people = data.people;
  if (filter.adultRegion) {
    people = people.filter((p) => !p.adultRegion || p.adultRegion === filter.adultRegion);
  }
  if (filter.summary) {
    people = people.map(summarizePerson);
  }
  return { version: data.version, people };
}

function summarizePerson(person = {}) {
  const referenceFaces = Array.isArray(person.referenceFaces) ? person.referenceFaces : [];
  return {
    personId: person.personId,
    name: person.name,
    aliases: person.aliases || [],
    canonicalCode: person.canonicalCode || '',
    adultRegion: person.adultRegion || '',
    referenceAssetIds: person.referenceAssetIds || [],
    referenceFaceCount: referenceFaces.length,
    dismissed: !!person.dismissed,
    createdAt: person.createdAt || '',
    updatedAt: person.updatedAt || '',
  };
}

function getPerson(personId) {
  const id = String(personId || '');
  if (!id) return null;
  return loadPeople().people.find((p) => p.personId === id) || null;
}

function createPerson(input = {}) {
  const name = normalizeName(input.name);
  if (!name) throw new Error('name is required');
  const data = loadPeople();
  const key = name.toLowerCase();
  const aliases = Array.isArray(input.aliases) ? input.aliases.map(normalizeName).filter(Boolean) : [];
  const referenceFaces = normalizeReferenceFaces(input.referenceFaces);
  const existing = data.people.find((p) => String(p.name || '').toLowerCase() === key);
  if (existing) {
    existing.aliases = [...new Set([...(existing.aliases || []), ...aliases])];
    existing.referenceAssetIds = [...new Set([...(existing.referenceAssetIds || []), ...(input.referenceAssetIds || []).map(String)])];
    existing.referenceFaces = [...(existing.referenceFaces || []), ...referenceFaces];
    // canonicalCode is immutable once assigned; backfill for legacy records.
    if (!existing.canonicalCode) existing.canonicalCode = assignUniqueCanonicalCode(data, existing.name || name);
    if (input.dismissed !== undefined) existing.dismissed = !!input.dismissed;
    existing.updatedAt = nowIso();
    savePeople(data);
    return existing;
  }
  const person = {
    personId: crypto.randomUUID(),
    name,
    aliases,
    canonicalCode: input.canonicalCode || assignUniqueCanonicalCode(data, name),
    adultRegion: input.adultRegion || 'western_adult',
    referenceAssetIds: Array.isArray(input.referenceAssetIds) ? input.referenceAssetIds.map(String) : [],
    referenceFaces,
    dismissed: !!input.dismissed,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  data.people.push(person);
  savePeople(data);
  return person;
}

function updatePerson(personId, updates = {}) {
  const data = loadPeople();
  const idx = data.people.findIndex((p) => p.personId === personId);
  if (idx < 0) return null;
  const existing = data.people[idx];
  const next = {
    ...existing,
    ...(updates.name !== undefined ? { name: normalizeName(updates.name) || existing.name } : {}),
    ...(updates.aliases !== undefined ? { aliases: Array.isArray(updates.aliases) ? updates.aliases.map(normalizeName).filter(Boolean) : [] } : {}),
    ...(updates.referenceAssetIds !== undefined ? { referenceAssetIds: Array.isArray(updates.referenceAssetIds) ? updates.referenceAssetIds.map(String) : [] } : {}),
    ...(updates.referenceFaces !== undefined ? { referenceFaces: normalizeReferenceFaces(updates.referenceFaces) } : {}),
    ...(updates.dismissed !== undefined ? { dismissed: !!updates.dismissed } : {}),
    // canonicalCode is immutable — never overwritten here.
    canonicalCode: existing.canonicalCode || assignUniqueCanonicalCode(loadPeople(), existing.name || 'Unknown'),
    updatedAt: nowIso(),
  };
  data.people[idx] = next;
  savePeople(data);
  return next;
}

function deletePerson(personId) {
  const data = loadPeople();
  const next = data.people.filter((p) => p.personId !== personId);
  if (next.length === data.people.length) return false;
  data.people = next;
  savePeople(data);
  return true;
}

// Collect embeddings of dismissed people (the blacklist) to send to the worker
// so future scrapes never surface those faces for protagonist selection.
function listDismissedEmbeddings(filter = {}) {
  const data = loadPeople();
  let people = data.people.filter((p) => p.dismissed);
  if (filter.adultRegion) people = people.filter((p) => !p.adultRegion || p.adultRegion === filter.adultRegion);
  const out = [];
  for (const p of people) {
    for (const ref of p.referenceFaces || []) {
      if (Array.isArray(ref.embedding) && ref.embedding.length) out.push(ref.embedding);
    }
  }
  return out;
}

module.exports = {
  loadPeople,
  listPeople,
  getPerson,
  summarizePerson,
  createPerson,
  updatePerson,
  deletePerson,
  normalizeReferenceFace,
  normalizeReferenceFaces,
  computeCanonicalCode,
  assignUniqueCanonicalCode,
  listDismissedEmbeddings,
};
