'use strict';

const fs = require('fs');
const path = require('path');

const configStore = require('./configStore');
const adultDataModel = require('./adultDataModel');

const STORE_VERSION = 1;
const ARTIFACT_DIR = 'adult-artifacts';

function safeItemId(subjectId) {
  return String(subjectId || '')
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 160);
}

function artifactsRoot() {
  return path.join(configStore.resolveDataDir(), ARTIFACT_DIR);
}

function artifactPath(subjectId) {
  const safe = safeItemId(subjectId);
  if (!safe) throw new Error('subjectId is required');
  return path.join(artifactsRoot(), `${safe}.json`);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, filePath);
}

function loadArtifacts(subjectId) {
  const filePath = artifactPath(subjectId);
  try {
    if (!fs.existsSync(filePath)) return { version: STORE_VERSION, subjectId, updatedAt: '', artifacts: {} };
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      version: Number(parsed.version) || STORE_VERSION,
      subjectId: parsed.subjectId || subjectId,
      updatedAt: parsed.updatedAt || '',
      artifacts: parsed.artifacts && typeof parsed.artifacts === 'object' ? parsed.artifacts : {},
    };
  } catch (_) {
    return { version: STORE_VERSION, subjectId, updatedAt: '', artifacts: {} };
  }
}

function saveArtifacts(subjectId, artifacts) {
  const next = artifacts && typeof artifacts === 'object' ? artifacts : {};
  if (Object.keys(next).length === 0) return loadArtifacts(subjectId);
  const record = {
    version: STORE_VERSION,
    subjectId,
    updatedAt: new Date().toISOString(),
    artifacts: next,
  };
  writeJson(artifactPath(subjectId), record);
  return record;
}

function splitAndPersistAdultMetadata(subjectId, metadata) {
  const split = adultDataModel.splitAdultMetadata(metadata);
  const coldKeys = Object.keys(split.coldArtifacts);
  if (coldKeys.length > 0) {
    saveArtifacts(subjectId, split.coldArtifacts);
  }
  return {
    adultMetadata: split.lightMetadata,
    coldArtifactKeys: coldKeys,
    coldArtifactPaths: split.coldArtifactPaths,
  };
}

function mergeColdArtifacts(item) {
  if (!item || !item.subjectId) return item;
  const record = loadArtifacts(item.subjectId);
  if (!record.artifacts || Object.keys(record.artifacts).length === 0) return item;
  return {
    ...item,
    adultMetadata: {
      ...(item.adultMetadata || {}),
      ...record.artifacts,
    },
  };
}

module.exports = {
  ARTIFACT_DIR,
  artifactPath,
  loadArtifacts,
  saveArtifacts,
  splitAndPersistAdultMetadata,
  mergeColdArtifacts,
};
