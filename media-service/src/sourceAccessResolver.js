'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let cache = null;

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function normalizedSegments(value) {
  const raw = String(value || '').trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!raw) return [];
  const parts = raw.split('/').filter((entry, index) => entry || index === 0);
  if (parts.includes('..')) fail('SOURCE_ACCESS_PATH_ESCAPE', `Source access path contains traversal: ${value}`);
  return parts;
}

function comparisonPath(value) {
  const normalized = normalizedSegments(value).join('/').replace(/\/$/, '');
  return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized;
}

function revisionFor(mappings) {
  return crypto.createHash('sha256').update(JSON.stringify(mappings)).digest('hex');
}

function load() {
  const filePath = String(process.env.SHELFDECK_SOURCE_ACCESS_MAP_FILE || '').trim();
  if (!filePath) return { filePath: '', revision: 'identity', mappings: [] };
  let stat;
  try { stat = fs.statSync(filePath); } catch (_) {
    fail('SOURCE_ACCESS_MAP_UNAVAILABLE', `Source access mapping file is not readable: ${filePath}`);
  }
  if (cache && cache.filePath === filePath && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) return cache;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (error) {
    fail('SOURCE_ACCESS_MAP_INVALID', `Source access mapping file is invalid: ${error.message}`);
  }
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.mappings)) {
    fail('SOURCE_ACCESS_MAP_INVALID', 'Source access mapping requires version=1 and mappings[]');
  }
  const mappings = parsed.mappings.map((entry, index) => {
    const sourcePrefix = String(entry && entry.sourcePrefix || '').trim();
    const accessPrefix = String(entry && entry.accessPrefix || '').trim();
    if (!sourcePrefix || !accessPrefix) fail('SOURCE_ACCESS_MAP_INVALID', `Mapping ${index} requires sourcePrefix and accessPrefix`);
    const sourceKey = comparisonPath(sourcePrefix);
    normalizedSegments(accessPrefix);
    return { sourcePrefix, accessPrefix, sourceKey };
  }).sort((a, b) => b.sourceKey.length - a.sourceKey.length);
  for (let i = 0; i < mappings.length; i += 1) {
    for (let j = i + 1; j < mappings.length; j += 1) {
      if (mappings[i].sourceKey === mappings[j].sourceKey && mappings[i].accessPrefix !== mappings[j].accessPrefix) {
        fail('SOURCE_ACCESS_MAP_CONFLICT', `Conflicting source access mappings: ${mappings[i].sourcePrefix}`);
      }
    }
  }
  cache = { filePath, mtimeMs: stat.mtimeMs, size: stat.size, revision: revisionFor(mappings), mappings };
  return cache;
}

function getRevision() { return load().revision; }

function resolve(canonicalPath, options = {}) {
  const original = String(canonicalPath || '').trim();
  if (!original) fail('SOURCE_ACCESS_PATH_REQUIRED', 'Canonical source path is required');
  const config = load();
  const sourceKey = comparisonPath(original);
  const matches = config.mappings.filter((mapping) => (
    sourceKey === mapping.sourceKey || sourceKey.startsWith(`${mapping.sourceKey}/`)
  ));
  let accessPath = original;
  let matched = null;
  if (matches.length > 0) {
    const longest = matches[0].sourceKey.length;
    const peers = matches.filter((mapping) => mapping.sourceKey.length === longest);
    if (new Set(peers.map((mapping) => mapping.accessPrefix)).size > 1) {
      fail('SOURCE_ACCESS_MAP_AMBIGUOUS', `Ambiguous source access mapping: ${original}`);
    }
    matched = peers[0];
    const relative = sourceKey.slice(matched.sourceKey.length).replace(/^\//, '');
    const relativeSegments = relative ? relative.split('/').filter(Boolean) : [];
    accessPath = path.join(matched.accessPrefix, ...relativeSegments);
    const relativeCheck = path.relative(path.resolve(matched.accessPrefix), path.resolve(accessPath));
    if (relativeCheck.startsWith('..') || path.isAbsolute(relativeCheck)) {
      fail('SOURCE_ACCESS_PATH_ESCAPE', `Resolved source path escapes access root: ${original}`);
    }
  }
  if (options.mustExist && !fs.existsSync(accessPath)) {
    fail('SOURCE_ACCESS_PATH_UNRESOLVED', `Resolved source path is not accessible: ${original}`, { canonicalPath: original, accessPath });
  }
  return { canonicalPath: original, accessPath, revision: config.revision, matched: !!matched };
}

function assertTaskRevision(task = {}) {
  const expected = String(task.sourceAccessMappingRevision || 'identity');
  const current = getRevision();
  if (expected !== current) {
    fail('SOURCE_ACCESS_MAPPING_STALE', 'Source access mapping changed after Task creation', { expected, current, taskId: task.id || '' });
  }
  return current;
}

function resetForTests() { cache = null; }

module.exports = { resolve, getRevision, assertTaskRevision, resetForTests };
