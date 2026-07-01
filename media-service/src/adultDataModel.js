'use strict';

const LIGHT_ADULT_METADATA_KEYS = Object.freeze([
  'adultId',
  'title',
  'originalTitle',
  'actors',
  'studio',
  'series',
  'premiered',
  'region',
  'scrapeStatus',
  'reviewStatus',
  'idConfidence',
  'scraperType',
  'source',
  'sourceUrl',
  'protagonist',
  'posterPath',
  'fanartPath',
  'nfoPath',
  'fileNfoPath',
  'markerPath',
  'organized',
  'originalFolder',
  'scrapedAt',
  'scrapeError',
  'scrapeFailedAt',
  'scrapeVerification',
]);

const COLD_ADULT_ARTIFACT_KEYS = Object.freeze([
  'faceClusters',
  'unknownFaces',
  'embedding',
  'sampleImage',
  'sampleImageBase64',
  'galleryImages',
  'posterImageBase64',
  'fanartImageBase64',
  'imageBase64',
  'posterImage',
  'fanartImage',
  'ai',
  'actorConfidence',
  'scene',
  'safetyFlags',
  'generatedTitle',
  'generatedDescription',
  'safeSummary',
]);

const LIGHT_ADULT_METADATA_KEY_SET = new Set(LIGHT_ADULT_METADATA_KEYS);
const COLD_ADULT_ARTIFACT_KEY_SET = new Set(COLD_ADULT_ARTIFACT_KEYS);

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function compactObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    out[key] = entry;
  }
  return out;
}

function projectProtagonist(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value || null;
  return compactObject({
    personId: value.personId,
    name: value.name,
    adultId: value.adultId,
  });
}

function projectScrapeVerification(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value || undefined;
  return compactObject({
    ok: value.ok,
    checkedAt: value.checkedAt,
    warnings: Array.isArray(value.warnings) ? cloneJson(value.warnings) : undefined,
    failures: Array.isArray(value.failures) ? cloneJson(value.failures) : undefined,
  });
}

function projectLightAdultMetadata(metadata = {}) {
  const source = metadata && typeof metadata === 'object' ? metadata : {};
  const projected = {};
  for (const key of LIGHT_ADULT_METADATA_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    if (key === 'protagonist') {
      projected[key] = projectProtagonist(source[key]);
    } else if (key === 'scrapeVerification') {
      projected[key] = projectScrapeVerification(source[key]);
    } else {
      projected[key] = cloneJson(source[key]);
    }
  }
  return compactObject(projected);
}

function splitAdultMetadata(metadata = {}) {
  const source = metadata && typeof metadata === 'object' ? metadata : {};
  const coldArtifacts = {};
  for (const [key, value] of Object.entries(source)) {
    if (COLD_ADULT_ARTIFACT_KEY_SET.has(key) || isBase64LikeKey(key)) {
      coldArtifacts[key] = cloneJson(value);
    }
  }
  return {
    lightMetadata: projectLightAdultMetadata(source),
    coldArtifacts,
    coldArtifactPaths: collectColdAdultArtifactPaths(source),
  };
}

function isBase64LikeKey(key) {
  return /base64$/i.test(String(key || ''));
}

function collectColdAdultArtifactPaths(value, opts = {}) {
  const paths = [];
  const maxDepth = Number.isInteger(opts.maxDepth) ? opts.maxDepth : 8;

  function visit(node, path, depth) {
    if (!node || typeof node !== 'object' || depth > maxDepth) return;
    if (Array.isArray(node)) {
      node.forEach((entry, index) => visit(entry, `${path}[${index}]`, depth + 1));
      return;
    }
    for (const [key, entry] of Object.entries(node)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (COLD_ADULT_ARTIFACT_KEY_SET.has(key) || isBase64LikeKey(key)) {
        paths.push(nextPath);
      }
      visit(entry, nextPath, depth + 1);
    }
  }

  visit(value, '', 0);
  return [...new Set(paths)].sort();
}

function hasColdAdultArtifacts(metadata) {
  return collectColdAdultArtifactPaths(metadata).length > 0;
}

module.exports = {
  LIGHT_ADULT_METADATA_KEYS,
  COLD_ADULT_ARTIFACT_KEYS,
  LIGHT_ADULT_METADATA_KEY_SET,
  COLD_ADULT_ARTIFACT_KEY_SET,
  projectLightAdultMetadata,
  splitAdultMetadata,
  collectColdAdultArtifactPaths,
  hasColdAdultArtifacts,
};
