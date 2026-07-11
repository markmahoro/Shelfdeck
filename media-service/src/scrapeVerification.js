'use strict';

const fs = require('fs');
const path = require('path');
const metadataStatus = require('./metadataStatus');

function addFailure(result, code, message) {
  result.failures.push({ code, message });
  result.checks[code] = false;
}

function addWarning(result, code, message) {
  result.warnings.push({ code, message });
}

function markOk(result, code) {
  result.checks[code] = true;
}

function existsFile(filePath, opts = {}) {
  if (!filePath) return false;
  if (opts.checkFiles === false) return true;
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch (_) {
    return false;
  }
}

function readMarker(markerPath, opts = {}) {
  if (!markerPath || opts.checkFiles === false) return null;
  try {
    return JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function markerPathForItem(item) {
  const meta = (item && item.adultMetadata) || {};
  return meta.markerPath || (item && item.path ? path.join(path.dirname(item.path), '.shelfdeck.json') : '');
}

function effectiveRegionConfig(config = {}, subLib = {}, item = {}) {
  const meta = item.adultMetadata || {};
  const adult = config.adultLibrary || {};
  const region = meta.region || subLib.adultRegion || 'japanese_jav';
  if (region === 'western_adult') {
    return { region, config: { ...(adult.western || {}), ...(subLib.western || {}) } };
  }
  return { region, config: { ...(adult.japaneseJav || {}), ...(subLib.japaneseJav || {}) } };
}

function verifyScrapedItem(item, opts = {}) {
  if (item && item.source !== 'adult_folder') {
    return verifyMetadataCompleteItem(item, opts);
  }
  const result = {
    ok: false,
    checkedAt: new Date().toISOString(),
    checks: {},
    failures: [],
    warnings: [],
  };
  if (!item || !item.subjectId) {
    addFailure(result, 'item.present', 'Library item is missing');
    return result;
  }

  const meta = item.adultMetadata || {};
  const { region, config: regionConfig } = effectiveRegionConfig(opts.config || {}, opts.subLib || {}, item);
  const writeNfo = regionConfig.writeNfo !== false;
  const markerRequired = opts.requireMarker !== false;

  if (item.scraped === true) markOk(result, 'library.scraped');
  else addFailure(result, 'library.scraped', 'Library item is not marked scraped=true');

  if (meta.scrapeStatus === 'done') markOk(result, 'metadata.scrapeStatus');
  else addFailure(result, 'metadata.scrapeStatus', `adultMetadata.scrapeStatus is "${meta.scrapeStatus || ''}", expected "done"`);

  if (meta.adultId) markOk(result, 'metadata.adultId');
  else addFailure(result, 'metadata.adultId', 'adultMetadata.adultId is missing');

  if (meta.title || item.name) markOk(result, 'metadata.title');
  else addFailure(result, 'metadata.title', 'Scrape title is missing');

  if (existsFile(item.path, opts)) markOk(result, 'media.exists');
  else addFailure(result, 'media.exists', `Media file does not exist: ${item.path || ''}`);

  if (writeNfo) {
    if (meta.nfoPath && existsFile(meta.nfoPath, opts)) markOk(result, 'asset.movieNfo');
    else addFailure(result, 'asset.movieNfo', `movie.nfo is missing: ${meta.nfoPath || ''}`);
    if (meta.fileNfoPath && existsFile(meta.fileNfoPath, opts)) markOk(result, 'asset.fileNfo');
    else addFailure(result, 'asset.fileNfo', `File NFO is missing: ${meta.fileNfoPath || ''}`);
  } else {
    addWarning(result, 'asset.nfo.disabled', 'NFO verification skipped because writeNfo=false');
  }

  if (region === 'japanese_jav') {
    if (meta.source || meta.sourceUrl) markOk(result, 'metadata.source');
    else addFailure(result, 'metadata.source', 'JAV scrape source/sourceUrl is missing');
    if (meta.posterPath && existsFile(meta.posterPath, opts)) markOk(result, 'asset.poster');
    else addFailure(result, 'asset.poster', `Poster is missing: ${meta.posterPath || ''}`);
  } else if (region === 'western_adult') {
    const protagonist = meta.protagonist || null;
    if (protagonist && protagonist.personId && protagonist.name) markOk(result, 'metadata.protagonist');
    else addFailure(result, 'metadata.protagonist', 'Western adult protagonist is missing');
    if (meta.posterPath) {
      if (existsFile(meta.posterPath, opts)) markOk(result, 'asset.poster');
      else addFailure(result, 'asset.poster', `Poster is missing: ${meta.posterPath}`);
    } else {
      addWarning(result, 'asset.poster.missing', 'Western adult item has no posterPath');
    }
  }

  if (markerRequired) {
    const markerPath = markerPathForItem(item);
    const marker = readMarker(markerPath, opts);
    if (markerPath && existsFile(markerPath, opts) && marker) {
      markOk(result, 'marker.exists');
      if (String(marker.subjectId || '') === String(item.subjectId)) markOk(result, 'marker.subjectId');
      else addFailure(result, 'marker.subjectId', 'Marker subjectId does not match library subjectId');
      if (!item.subLibraryId || String(marker.subLibraryId || '') === String(item.subLibraryId)) markOk(result, 'marker.subLibraryId');
      else addFailure(result, 'marker.subLibraryId', 'Marker subLibraryId does not match library item');
      if (!marker.mediaPath || !item.path || path.resolve(marker.mediaPath) === path.resolve(item.path)) markOk(result, 'marker.mediaPath');
      else addFailure(result, 'marker.mediaPath', 'Marker mediaPath does not match current media path');
      const expectedTaskId = opts.scrapeTaskId || '';
      if (!expectedTaskId || String(marker.scrapeTaskId || '') === String(expectedTaskId)) markOk(result, 'marker.scrapeTaskId');
      else addFailure(result, 'marker.scrapeTaskId', 'Marker scrapeTaskId does not match scrape task');
      if (marker.scrapedAt) markOk(result, 'marker.scrapedAt');
      else addFailure(result, 'marker.scrapedAt', 'Marker scrapedAt is missing');
    } else {
      addFailure(result, 'marker.exists', `ShelfDeck marker is missing or unreadable: ${markerPath || ''}`);
    }
  }

  result.ok = result.failures.length === 0;
  return result;
}

function verifyMetadataCompleteItem(item, opts = {}) {
  const result = {
    ok: false,
    checkedAt: new Date().toISOString(),
    checks: {},
    failures: [],
    warnings: [],
  };
  if (!item || !item.subjectId) {
    addFailure(result, 'item.present', 'Library item is missing');
    return result;
  }
  const meta = metadataStatus.resolveMetadataStatus(item, opts.config || {});
  if (meta.metadataComplete) {
    markOk(result, 'metadata.complete');
    result.ok = true;
  } else {
    addFailure(result, 'metadata.complete', `Metadata is incomplete: ${meta.metadataMissingReasons.join(', ')}`);
    for (const reason of meta.metadataMissingReasons) {
      result.checks[reason] = false;
    }
  }
  result.metadataStatus = meta.metadataStatus;
  result.metadataMissingReasons = meta.metadataMissingReasons;
  return result;
}

module.exports = {
  verifyScrapedItem,
};
