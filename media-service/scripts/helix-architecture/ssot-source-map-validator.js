'use strict';

const fs = require('fs');
const path = require('path');
const {
  canonicalDigest,
  extractSsotContracts
} = require('./ssot-contract-extractor');

const CATEGORIES = ['capabilities', 'resultFamilies', 'tables', 'transactions'];

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function boundedRelative(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) return false;
  const normalized = normalizePath(path.normalize(value));
  return normalized !== '..' && !normalized.startsWith('../');
}

function finding(code, message, details = {}) {
  return { code, message, ...details };
}

function readJson(filePath, findings) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    findings.push(finding('INVALID_SOURCE_MAP_JSON', `Cannot read source map JSON: ${error.message}`, {
      file: normalizePath(filePath)
    }));
    return null;
  }
}

function validateSsotSourceMap(options) {
  const repositoryRoot = path.resolve(options.repositoryRoot);
  const mapPath = path.resolve(options.mapPath);
  const findings = [];
  const map = readJson(mapPath, findings);
  if (!map) return { ok: false, findings };

  const envelopeValid = map.schemaVersion === 1 && map.manifestVersion === 1 &&
    map.manifestId === 'helix.ssot-contract-source-map' && map.kind === 'ssot-source-map' &&
    map.owner === 'contracts' && map.status === 'active' && Array.isArray(map.entryFiles) && map.entryFiles.length > 0 &&
    boundedRelative(map.sourcePath);
  if (!envelopeValid) {
    findings.push(finding('INVALID_SOURCE_MAP_ENVELOPE', 'SSOT source map envelope or source path is invalid.', {
      file: normalizePath(mapPath)
    }));
    return { ok: false, findings };
  }

  const configuredSsotPath = process.env.HELIX_SSOT_PATH;
  const sourcePath = configuredSsotPath && fs.existsSync(path.join(repositoryRoot, '.git'))
    ? configuredSsotPath : path.resolve(repositoryRoot, map.sourcePath);
  let extracted;
  try {
    extracted = extractSsotContracts(fs.readFileSync(sourcePath, 'utf8'), { sourcePath: map.sourcePath });
  } catch (error) {
    findings.push(finding('SSOT_EXTRACTION_FAILED', error.message, { file: normalizePath(sourcePath) }));
    return { ok: false, findings };
  }

  const mapDirectory = path.dirname(mapPath);
  const paths = new Set();
  const byCategory = Object.fromEntries(CATEGORIES.map((category) => [category, []]));
  for (const relativePath of map.entryFiles) {
    if (!boundedRelative(relativePath) || paths.has(relativePath)) {
      findings.push(finding('INVALID_SOURCE_MAP_SHARD_PATH', 'Source map shard paths must be unique and bounded.', { relativePath }));
      continue;
    }
    paths.add(relativePath);
    const shardPath = path.resolve(mapDirectory, relativePath);
    const shard = readJson(shardPath, findings);
    if (!shard) continue;
    if (
      shard.schemaVersion !== 1 || shard.mapId !== map.manifestId || !CATEGORIES.includes(shard.category) ||
      !Number.isInteger(shard.startOrdinal) || !Number.isInteger(shard.endOrdinal) || !Array.isArray(shard.entries) ||
      shard.entries.length !== shard.endOrdinal - shard.startOrdinal + 1
    ) {
      findings.push(finding('INVALID_SOURCE_MAP_SHARD', 'Source map shard identity, category, ordinals, or entries are invalid.', {
        file: normalizePath(shardPath)
      }));
      continue;
    }
    byCategory[shard.category].push(shard);
  }

  for (const category of CATEGORIES) {
    const shards = byCategory[category].sort((left, right) => left.startOrdinal - right.startOrdinal);
    const entries = [];
    let expectedOrdinal = 1;
    for (const shard of shards) {
      if (shard.startOrdinal !== expectedOrdinal) {
        findings.push(finding('SOURCE_MAP_ORDINAL_GAP', 'Source map shards must be contiguous and non-overlapping.', {
          category, expectedOrdinal, actualOrdinal: shard.startOrdinal
        }));
      }
      entries.push(...shard.entries);
      expectedOrdinal = shard.endOrdinal + 1;
    }
    if (canonicalDigest(entries) !== canonicalDigest(extracted[category])) {
      findings.push(finding('SOURCE_MAP_CATEGORY_DRIFT', 'Committed source map entries differ from live SSOT extraction.', {
        category, committedCount: entries.length, extractedCount: extracted[category].length
      }));
    }
  }

  for (const field of ['sourceDocumentDigest', 'aggregateDigest']) {
    if (map[field] !== extracted[field]) findings.push(finding('SOURCE_MAP_DIGEST_DRIFT', `Source map ${field} differs from SSOT extraction.`, { field }));
  }
  if (canonicalDigest(map.counts) !== canonicalDigest(extracted.counts) ||
      canonicalDigest(map.categoryDigests) !== canonicalDigest(extracted.categoryDigests)) {
    findings.push(finding('SOURCE_MAP_SUMMARY_DRIFT', 'Source map counts or category digests differ from SSOT extraction.'));
  }

  return {
    ok: findings.length === 0,
    sourcePath: normalizePath(sourcePath),
    counts: extracted.counts,
    categoryDigests: extracted.categoryDigests,
    aggregateDigest: extracted.aggregateDigest,
    shardCount: map.entryFiles.length,
    findings
  };
}

module.exports = Object.freeze({ validateSsotSourceMap });
