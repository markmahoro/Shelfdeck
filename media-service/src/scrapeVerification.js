'use strict';

const fs = require('fs');
const path = require('path');

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
  const result = {
    ok: false,
    checkedAt: new Date().toISOString(),
    checks: {},
    failures: [],
    warnings: [],
  };
  if (!item || !item.itemId) {
    addFailure(result, 'item.present', '媒体项不存在');
    return result;
  }

  const meta = item.adultMetadata || {};
  const { region, config: regionConfig } = effectiveRegionConfig(opts.config || {}, opts.subLib || {}, item);
  const writeNfo = regionConfig.writeNfo !== false;
  const markerRequired = opts.requireMarker !== false;

  if (item.scraped === true) markOk(result, 'library.scraped');
  else addFailure(result, 'library.scraped', '媒体项未标记为已刮削');

  if (meta.scrapeStatus === 'done') markOk(result, 'metadata.scrapeStatus');
  else addFailure(result, 'metadata.scrapeStatus', `刮削状态为「${meta.scrapeStatus || '空'}」，预期为「done」`);

  if (meta.adultId) markOk(result, 'metadata.adultId');
  else addFailure(result, 'metadata.adultId', '番号缺失');

  if (meta.title || item.name) markOk(result, 'metadata.title');
  else addFailure(result, 'metadata.title', '标题缺失');

  if (existsFile(item.path, opts)) markOk(result, 'media.exists');
  else addFailure(result, 'media.exists', `媒体文件不存在：${item.path || ''}`);

  if (writeNfo) {
    if (meta.nfoPath && existsFile(meta.nfoPath, opts)) markOk(result, 'asset.movieNfo');
    else addFailure(result, 'asset.movieNfo', `movie.nfo 缺失：${meta.nfoPath || ''}`);
    if (meta.fileNfoPath && existsFile(meta.fileNfoPath, opts)) markOk(result, 'asset.fileNfo');
    else addFailure(result, 'asset.fileNfo', `同名 NFO 缺失：${meta.fileNfoPath || ''}`);
  } else {
    addWarning(result, 'asset.nfo.disabled', '已关闭 NFO 写入，跳过 NFO 验收');
  }

  if (region === 'japanese_jav') {
    if (meta.source || meta.sourceUrl) markOk(result, 'metadata.source');
    else addFailure(result, 'metadata.source', 'JAV 刮削来源缺失');
    if (meta.posterPath && existsFile(meta.posterPath, opts)) markOk(result, 'asset.poster');
    else addFailure(result, 'asset.poster', `封面缺失：${meta.posterPath || ''}`);
  } else if (region === 'western_adult') {
    const protagonist = meta.protagonist || null;
    if (protagonist && protagonist.personId && protagonist.name) markOk(result, 'metadata.protagonist');
    else addFailure(result, 'metadata.protagonist', '欧美成人主角未识别');
    if (meta.posterPath) {
      if (existsFile(meta.posterPath, opts)) markOk(result, 'asset.poster');
      else addFailure(result, 'asset.poster', `封面缺失：${meta.posterPath}`);
    } else {
      addWarning(result, 'asset.poster.missing', '欧美成人媒体没有封面路径');
    }
  }

  if (markerRequired) {
    const markerPath = markerPathForItem(item);
    const marker = readMarker(markerPath, opts);
    if (markerPath && existsFile(markerPath, opts) && marker) {
      markOk(result, 'marker.exists');
      if (String(marker.itemId || '') === String(item.itemId)) markOk(result, 'marker.itemId');
      else addFailure(result, 'marker.itemId', '标记文件 itemId 与媒体项不一致');
      if (!item.subLibraryId || String(marker.subLibraryId || '') === String(item.subLibraryId)) markOk(result, 'marker.subLibraryId');
      else addFailure(result, 'marker.subLibraryId', '标记文件 subLibraryId 与媒体项不一致');
      if (!marker.mediaPath || !item.path || path.resolve(marker.mediaPath) === path.resolve(item.path)) markOk(result, 'marker.mediaPath');
      else addFailure(result, 'marker.mediaPath', '标记文件 mediaPath 与当前媒体路径不一致');
      const expectedTaskId = opts.scrapeTaskId || '';
      if (!expectedTaskId || String(marker.scrapeTaskId || '') === String(expectedTaskId)) markOk(result, 'marker.scrapeTaskId');
      else addFailure(result, 'marker.scrapeTaskId', '标记文件 scrapeTaskId 与当前刮削任务不一致');
      if (marker.scrapedAt) markOk(result, 'marker.scrapedAt');
      else addFailure(result, 'marker.scrapedAt', '标记文件缺少 scrapedAt');
    } else {
      addFailure(result, 'marker.exists', `ShelfDeck 标记文件缺失或不可读：${markerPath || ''}`);
    }
  }

  result.ok = result.failures.length === 0;
  return result;
}

module.exports = {
  verifyScrapedItem,
};
