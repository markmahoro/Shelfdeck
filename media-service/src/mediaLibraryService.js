'use strict';

/**
 * MediaLibraryService (MEDIA_LIBRARY.md).
 *
 * Coordinator for the unified media library persistence table (data/library.db).
 * Manages subLibraries, independent ingest and douban sync timers per subLibrary.
 *
 * Principle: write first, then refresh gate projections for affected items.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const configStore = require('./configStore');
const libraryStore = require('./libraryStore');
const doubanMatchService = require('./doubanMatchService');
const embyService = require('./services/embyService');
const transcodeService = require('./services/transcodeService');
const doubanService = require('./services/doubanService');
const activityLog = require('./activityLog');
const optimizationStatus = require('./optimizationStatus');
const metadataStatus = require('./metadataStatus');
const assetIdentity = require('./assetIdentity');
const lifecycleProjection = require('./lifecycleProjection');
const userPerceptionManagement = require('./userPerceptionManagement');
const factsFreshnessService = require('./factsFreshnessService');
const runtimeResourceTracker = require('./runtimeResourceTracker');
const backgroundIoGuard = require('./backgroundIoGuard');
const diagnosticLog = require('./diagnosticLog');

const BACKGROUND_IO_LOCK = 'library_background_io';
const DEFAULT_STARTUP_REFRESH_STALE_MINUTES = 120;
const DEFAULT_STARTUP_REFRESH_MAX_LIBRARIES = 1;

function generateUuid() {
  return crypto.randomUUID();
}

function computeBucket(resolution) {
  if (!resolution) return '1080p';
  const parts = String(resolution).split('x');
  const w = parseInt(parts[0], 10) || 0;
  const h = parseInt(parts[1], 10) || 0;
  return (w >= 3840 || h >= 2160) ? '4K' : '1080p';
}

function projectMediaFactsForItem(item) {
  if (!item || typeof item !== 'object') return 0;
  let changed = 0;

  const bucket = computeBucket(item.resolution);
  if (item.bucket !== bucket) {
    item.bucket = bucket;
    changed++;
  }

  const eqMbps = item.bitrate > 0 ? item.bitrate / 1_000_000 : undefined;
  if (item.equivalentBitrate !== eqMbps) {
    item.equivalentBitrate = eqMbps;
    changed++;
  }

  return changed;
}

function manageableEmbyItems(incomingItems = []) {
  const movies = [];
  const series = [];
  const seasons = [];
  const episodes = [];

  for (const incoming of incomingItems || []) {
    const t = (incoming.type || '').toLowerCase();
    switch (t) {
      case 'movie': movies.push(incoming); break;
      case 'series': series.push(incoming); break;
      case 'season': seasons.push(incoming); break;
      case 'episode': episodes.push(incoming); break;
      default: break;
    }
  }

  const epAgg = new Map();
  for (const ep of episodes) {
    const pid = ep.parentId;
    if (!pid) continue;
    let agg = epAgg.get(pid);
    if (!agg) {
      agg = { totalSize: 0, totalDuration: 0, maxH: 0, maxRes: '', codecTally: {}, audioSet: new Set(), allWatched: true };
      epAgg.set(pid, agg);
    }
    agg.totalSize += ep.size || 0;
    agg.totalDuration += ep.duration || 0;
    const h = parseInt((ep.resolution || '').split('x')[1], 10) || 0;
    if (h > agg.maxH) { agg.maxH = h; agg.maxRes = ep.resolution; }
    const c = ep.codec || 'h264';
    agg.codecTally[c] = (agg.codecTally[c] || 0) + 1;
    for (const ac of (ep.audioCodecs || [])) agg.audioSet.add(ac);
    if (!ep.watched) agg.allWatched = false;
  }

  for (const s of seasons) {
    if (typeof s.indexNumber === 'number') s.seasonNumber = s.indexNumber;
    const agg = epAgg.get(s.sourceId);
    if (!agg) continue;
    s.totalSize = agg.totalSize;
    s.totalDuration = agg.totalDuration;
    s.bitrate = agg.totalDuration > 0 ? Math.round((agg.totalSize * 8) / agg.totalDuration) : 0;
    s.resolution = agg.maxRes || s.resolution;
    s.size = agg.totalSize;
    s.duration = agg.totalDuration;
    let majorityCodec = s.codec || 'h264';
    let maxTally = 0;
    for (const [codec, n] of Object.entries(agg.codecTally)) {
      if (n > maxTally) { maxTally = n; majorityCodec = codec; }
    }
    s.codec = majorityCodec;
    s.audioCodecs = [...agg.audioSet];
    s.watched = agg.allWatched;
    s.episodeCount = episodes.filter((ep) => ep.parentId === s.sourceId).length;
  }

  return [...movies, ...seasons];
}

function embyObservationItemInfo(subLib, incoming, existing = null, observationKind = 'new_source_observed') {
  const now = new Date().toISOString();
  const sourceId = incoming && (incoming.sourceId || incoming.itemId) || existing && existing.sourceId || '';
  const itemId = existing && existing.itemId
    ? existing.itemId
    : `ingest:${subLib.uuid}:${sourceId || crypto.createHash('sha1').update(String(incoming && incoming.path || now)).digest('hex')}`;
  const assetKey = incoming
    ? assetIdentity.computeAssetKey(incoming, subLib.uuid)
    : existing && existing.assetKey;
  const assetRootPath = incoming
    ? assetIdentity.inferAssetRootPath(incoming.path, incoming.isDiscLike)
    : existing && existing.assetRootPath;
  const externalRefs = incoming
    ? { emby: assetIdentity.makeExternalEmbyRef(incoming, subLib, now) }
    : existing && existing.externalRefs;
  return {
    itemId,
    name: incoming && incoming.name || existing && existing.name || sourceId || itemId,
    subLibraryId: subLib.uuid,
    source: 'emby',
    sourceId,
    embyItemId: sourceId,
    path: incoming && incoming.path || existing && existing.path || '',
    type: incoming && incoming.type || existing && existing.type || 'movie',
    assetKey,
    assetRootPath,
    externalRefs,
    sourceExists: observationKind !== 'source_missing',
    sourceObservationKind: observationKind,
    sourceObservedAt: now,
    sourceSnapshot: incoming || null,
  };
}

function sourceFactsChanged(existing = {}, incoming = {}, subLibraryId = '') {
  const incomingSourceId = incoming.sourceId || incoming.itemId || '';
  const incomingAssetKey = assetIdentity.computeAssetKey(incoming, subLibraryId);
  const incomingAssetRootPath = assetIdentity.inferAssetRootPath(incoming.path, incoming.isDiscLike);
  return String(existing.sourceId || '') !== String(incomingSourceId || '')
    || String(existing.path || '') !== String(incoming.path || '')
    || Number(existing.size || 0) !== Number(incoming.size || 0)
    || String(existing.assetKey || '') !== String(incomingAssetKey || '')
    || String(existing.assetRootPath || '') !== String(incomingAssetRootPath || '')
    || existing.sourceExists === false;
}

function normalizeVideoCodec(raw) {
  const c = String(raw || '').toLowerCase();
  if (c === 'hevc' || c.includes('h265') || c === 'h265') return 'h265';
  if (c === 'h264' || c === 'avc' || c.includes('h264')) return 'h264';
  if (c === 'av1') return 'av1';
  return c || 'h264';
}

function resolveMappedSourcePath(sourcePath, subLib) {
  const from = (subLib && subLib.pathMapFrom || '').trim();
  const to = (subLib && subLib.pathMapTo || '').trim();
  if (from && to && String(sourcePath || '').startsWith(from)) {
    const relative = String(sourcePath).slice(from.length).replace(/^[/\\]+/, '');
    return path.join(to, relative);
  }
  return sourcePath;
}

async function enrichDiscMetadata(incomingItems, subLib, config) {
  let probed = 0;
  let filled = 0;
  for (const item of incomingItems) {
    if (!item || !item.isDiscLike || !item.path) continue;
    const needsProbe = !(item.bitrate > 0) || !(item.duration > 0) || !(item.size > 0);
    if (!needsProbe) continue;

    const sourcePath = resolveMappedSourcePath(item.path, subLib);
    try {
      const meta = await transcodeService.probeDiscMetadata(config, sourcePath);
      probed++;
      if (!meta) continue;

      let changed = false;
      if (!(item.bitrate > 0) && meta.bitrate > 0) { item.bitrate = meta.bitrate; changed = true; }
      if (!(item.duration > 0) && meta.durationSec > 0) { item.duration = Math.round(meta.durationSec); changed = true; }
      if (!(item.size > 0) && meta.sizeBytes > 0) { item.size = meta.sizeBytes; changed = true; }
      if (!item.resolution && meta.width > 0 && meta.height > 0) { item.resolution = `${meta.width}x${meta.height}`; changed = true; }
      if ((!item.codec || item.codec === 'h264') && meta.videoCodec) { item.codec = normalizeVideoCodec(meta.videoCodec); changed = true; }
      if ((!Array.isArray(item.audioCodecs) || item.audioCodecs.length === 0) && meta.audioCodec) {
        item.audioCodecs = [String(meta.audioCodec).toLowerCase()];
        changed = true;
      }
      if (changed) filled++;
    } catch (e) {
      console.warn('[mediaLibrary] disc metadata probe skipped:', item.name || item.itemId, e.message);
    }
  }
  if (probed > 0) {
    console.log('[mediaLibrary] disc metadata probe complete', { probed, filled, subLibraryId: subLib && subLib.uuid });
  }
  return { probed, filled };
}

async function enrichFileMetadata(incomingItems, subLib, config) {
  let probed = 0;
  let filled = 0;
  for (const item of incomingItems) {
    if (!item || item.isDiscLike || !item.path) continue;
    const needsProbe = !(item.bitrate > 0)
      || !(item.duration > 0)
      || !(item.size > 0)
      || !item.resolution
      || !item.codec
      || !Array.isArray(item.audioCodecs)
      || item.audioCodecs.length === 0;
    if (!needsProbe) continue;

    const sourcePath = resolveMappedSourcePath(item.path, subLib);
    try {
      const summary = await transcodeService.probeSummary(config, sourcePath, {
        timeoutMs: Number(config.metadataRepairProbeTimeoutMs) > 0 ? Number(config.metadataRepairProbeTimeoutMs) : 30000,
      });
      let stat = null;
      try { stat = await fs.promises.stat(sourcePath); } catch (_) {}
      probed++;
      let changed = false;
      if (!(item.duration > 0) && summary.durationSec > 0) { item.duration = Math.round(summary.durationSec); changed = true; }
      if (!item.resolution && summary.width > 0 && summary.height > 0) { item.resolution = `${summary.width}x${summary.height}`; changed = true; }
      if ((!item.codec || item.codec === 'h264') && summary.videoCodec) { item.codec = normalizeVideoCodec(summary.videoCodec); changed = true; }
      if ((!Array.isArray(item.audioCodecs) || item.audioCodecs.length === 0) && summary.audioCodec) {
        item.audioCodecs = [String(summary.audioCodec).toLowerCase()];
        changed = true;
      }
      if (!(item.size > 0) && stat && stat.size > 0) { item.size = stat.size; changed = true; }
      if (!(item.bitrate > 0) && item.size > 0 && item.duration > 0) {
        item.bitrate = Math.round((item.size * 8) / item.duration);
        changed = true;
      }
      if (changed) filled++;
    } catch (e) {
      console.warn('[mediaLibrary] file metadata probe skipped:', item.name || item.itemId, e.message);
    }
  }
  if (probed > 0) {
    console.log('[mediaLibrary] file metadata probe complete', { probed, filled, subLibraryId: subLib && subLib.uuid });
  }
  return { probed, filled };
}

// ── Library file persistence ────────────────────────────────────────────────

function loadLibrary() {
  return libraryStore.loadLibrary();
}

function saveLibrary(lib) {
  libraryStore.saveLibrary(lib);
}

function updateLibraryItems(items) {
  return libraryStore.updateItems(items);
}

function selectStartupIngestSubLibraries(subLibs = [], config = {}, nowMs = Date.now()) {
  const staleMinutes = Number(config.mediaLibraryStartupRefreshStaleMinutes) > 0
    ? Number(config.mediaLibraryStartupRefreshStaleMinutes)
    : DEFAULT_STARTUP_REFRESH_STALE_MINUTES;
  const staleMs = staleMinutes * 60 * 1000;
  const rawMax = Number(config.mediaLibraryStartupRefreshMaxLibraries);
  const maxLibraries = Number.isFinite(rawMax) && rawMax >= 0
    ? Math.floor(rawMax)
    : DEFAULT_STARTUP_REFRESH_MAX_LIBRARIES;

  const stale = (subLibs || []).filter((sl) => {
    if (!sl || sl.enabled === false || sl.source === 'folder') return false;
    const refreshedAt = sl.lastRefreshedAt ? new Date(sl.lastRefreshedAt).getTime() : 0;
    return !refreshedAt || (nowMs - refreshedAt) >= staleMs;
  });

  stale.sort((a, b) => {
    const at = a.lastRefreshedAt ? new Date(a.lastRefreshedAt).getTime() : 0;
    const bt = b.lastRefreshedAt ? new Date(b.lastRefreshedAt).getTime() : 0;
    return at - bt;
  });

  if (maxLibraries === 0) return stale;
  return stale.slice(0, maxLibraries);
}

function runBackgroundLibraryOperation(input, fn) {
  try {
    return Promise.resolve(backgroundIoGuard.runExclusive({
      component: 'mediaLibraryService',
      lockKey: BACKGROUND_IO_LOCK,
      resourceType: 'background_io',
      source: 'background',
      ...input,
    }, fn, {
      onSkipped: (result) => {
        const active = result && result.activeOperation;
        console.log(`[mediaLibrary] background operation skipped: ${input.operation} (busy: ${active && active.operation || 'unknown'})`);
        return null;
      },
    }));
  } catch (err) {
    return Promise.reject(err);
  }
}

// ── Item operations ─────────────────────────────────────────────────────────

function upsertItems(subLibraryId, incomingItems, opts = {}) {
  const { fullSync = false } = opts;
  const lib = {
    version: 1,
    cachedAt: null,
    items: libraryStore.queryItems({ subLibraryId }).items,
  };
  const now = new Date().toISOString();
  const cfg = configStore.loadConfig();
  const subLib = (cfg.subLibraries || []).find((s) => s.uuid === subLibraryId) || null;
  let upserted = 0;
  const touchedItemIds = new Set();

  // Safety: if Emby returns empty data during a full sync, don't purge everything
  if (incomingItems.length === 0) {
    console.warn('[mediaLibrary] upsertItems: 0 items returned for', subLibraryId, '— skipping');
    return { upserted: 0, removed: 0 };
  }

  // ── Episode → Season aggregation ──────────────────────────────────────────
  const movies = [];
  const series = [];
  const seasons = [];
  const episodes = [];

  for (const incoming of incomingItems) {
    const t = (incoming.type || '').toLowerCase();
    switch (t) {
      case 'movie': movies.push(incoming); break;
      case 'series': series.push(incoming); break;
      case 'season': seasons.push(incoming); break;
      case 'episode': episodes.push(incoming); break;
      default: break; // 'other' — skip
    }
  }

  // Aggregate episode technical data by parentId (Season ID)
  const epAgg = new Map(); // parentId → { totalSize, totalDuration, ... }
  for (const ep of episodes) {
    const pid = ep.parentId;
    if (!pid) continue;
    let agg = epAgg.get(pid);
    if (!agg) {
      agg = { totalSize: 0, totalDuration: 0, maxH: 0, maxRes: '', codecTally: {}, audioSet: new Set(), allWatched: true };
      epAgg.set(pid, agg);
    }
    agg.totalSize += ep.size || 0;
    agg.totalDuration += ep.duration || 0;
    const h = parseInt((ep.resolution || '').split('x')[1], 10) || 0;
    if (h > agg.maxH) { agg.maxH = h; agg.maxRes = ep.resolution; }
    const c = ep.codec || 'h264';
    agg.codecTally[c] = (agg.codecTally[c] || 0) + 1;
    for (const ac of (ep.audioCodecs || [])) agg.audioSet.add(ac);
    if (!ep.watched) agg.allWatched = false;
  }

  // Enrich season items with episode aggregate data
  for (const s of seasons) {
    // Season's own IndexNumber is the season number
    if (typeof s.indexNumber === 'number') s.seasonNumber = s.indexNumber;

    const agg = epAgg.get(s.sourceId);
    if (!agg) continue;
    s.totalSize = agg.totalSize;
    s.totalDuration = agg.totalDuration;
    s.bitrate = agg.totalDuration > 0 ? Math.round((agg.totalSize * 8) / agg.totalDuration) : 0;
    s.resolution = agg.maxRes || s.resolution;
    s.size = agg.totalSize;
    s.duration = agg.totalDuration;
    let majorityCodec = s.codec || 'h264';
    let maxTally = 0;
    for (const [codec, n] of Object.entries(agg.codecTally)) {
      if (n > maxTally) { maxTally = n; majorityCodec = codec; }
    }
    s.codec = majorityCodec;
    s.audioCodecs = [...agg.audioSet];
    s.watched = agg.allWatched;
    s.episodeCount = episodes.filter((ep) => ep.parentId === s.sourceId).length;
  }

  // Upsert items: movies + seasons (series are transparent containers, not stored)
  const allItems = [...movies, ...seasons];

  for (const existing of lib.items) {
    if (existing.subLibraryId !== subLibraryId) continue;
    const identity = assetIdentity.ensureIdentityFields(existing, subLib, now);
    existing.assetKey = identity.assetKey;
    existing.assetRootPath = identity.assetRootPath;
    existing.externalRefs = identity.externalRefs;
  }

  for (const incoming of allItems) {
    const incomingEmbyId = incoming.sourceId || incoming.itemId || '';
    const incomingAssetKey = assetIdentity.computeAssetKey(incoming, subLibraryId);
    const incomingAssetRootPath = assetIdentity.inferAssetRootPath(incoming.path, incoming.isDiscLike);
    const incomingExternalRefs = {
      emby: assetIdentity.makeExternalEmbyRef(incoming, subLib, now),
    };
    const existingIdx = assetIdentity.findExistingItemIndex(lib.items, incoming, subLib, subLibraryId);
    if (existingIdx >= 0) {
      const existing = lib.items[existingIdx];
      const merged = {
        ...existing,
        source: 'emby',
        sourceId: incomingEmbyId || existing.sourceId,
        assetKey: incomingAssetKey || existing.assetKey,
        assetRootPath: incomingAssetRootPath || existing.assetRootPath,
        externalRefs: {
          ...(existing.externalRefs || {}),
          ...incomingExternalRefs,
        },
        name: incoming.name || existing.name,
        path: incoming.path || existing.path,
        type: incoming.type || existing.type,
        bitrate: incoming.bitrate > 0 ? incoming.bitrate : existing.bitrate,
        duration: incoming.duration > 0 ? incoming.duration : existing.duration,
        resolution: incoming.resolution || existing.resolution,
        bucket: incoming.resolution ? computeBucket(incoming.resolution) : existing.bucket,
        size: incoming.size > 0 ? incoming.size : existing.size,
        codec: incoming.resolution ? incoming.codec : existing.codec,
        audioCodecs: Array.isArray(incoming.audioCodecs) && incoming.audioCodecs.length > 0 ? incoming.audioCodecs : existing.audioCodecs,
        premiereDate: incoming.premiereDate || existing.premiereDate,
        genres: incoming.genres || existing.genres,
        isDiscLike: incoming.isDiscLike != null ? incoming.isDiscLike : existing.isDiscLike,
        watched: incoming.watched != null ? incoming.watched : existing.watched,
        watchedSource: incoming.watched != null ? 'emby' : existing.watchedSource,
        watchedUpdatedAt: incoming.watched != null && incoming.watched !== existing.watched ? now : existing.watchedUpdatedAt,
        playCount: incoming.playCount != null ? incoming.playCount : existing.playCount,
        playCountSource: incoming.playCount != null ? 'emby' : existing.playCountSource,
        lastPlayedAt: incoming.lastPlayedAt != null ? incoming.lastPlayedAt : existing.lastPlayedAt,
        favorite: incoming.favorite != null ? incoming.favorite : existing.favorite,
        favoriteSource: incoming.favorite != null ? 'emby' : existing.favoriteSource,
        lastRefreshedAt: now,
        tmdbId: incoming.tmdbId !== undefined ? incoming.tmdbId : existing.tmdbId,
        providerIds: incoming.providerIds !== undefined ? incoming.providerIds : existing.providerIds,
        seriesName: incoming.seriesName !== undefined ? incoming.seriesName : existing.seriesName,
        seriesId: incoming.seriesId !== undefined ? incoming.seriesId : existing.seriesId,
        seasonNumber: incoming.seasonNumber !== undefined ? incoming.seasonNumber : existing.seasonNumber,
        episodeCount: incoming.episodeCount !== undefined ? incoming.episodeCount : existing.episodeCount,
      };
      projectMediaFactsForItem(merged);
      userPerceptionManagement.projectItem(merged, { now, source: 'emby' });
      lib.items[existingIdx] = merged;
      touchedItemIds.add(merged.itemId);
      upserted++;
    } else {
      const itemId = generateUuid();
      const newItem = {
        itemId,
        subLibraryId,
        name: incoming.name || '',
        path: incoming.path || '',
        source: 'emby',
        sourceId: incomingEmbyId,
        assetKey: incomingAssetKey,
        assetRootPath: incomingAssetRootPath,
        externalRefs: incomingExternalRefs,
        type: incoming.type || 'movie',
        bitrate: incoming.bitrate || 0,
        duration: incoming.duration || 0,
        resolution: incoming.resolution || '',
        size: incoming.size || 0,
        codec: incoming.codec || '',
        audioCodecs: Array.isArray(incoming.audioCodecs) ? incoming.audioCodecs : [],
        bucket: computeBucket(incoming.resolution),
        premiereDate: incoming.premiereDate || null,
        genres: incoming.genres || [],
        isDiscLike: incoming.isDiscLike || false,
        watched: incoming.watched || false,
        watchedSource: 'emby',
        watchedUpdatedAt: now,
        playCount: incoming.playCount == null ? null : incoming.playCount,
        playCountSource: incoming.playCount == null ? undefined : 'emby',
        lastPlayedAt: incoming.lastPlayedAt || null,
        favorite: incoming.favorite == null ? null : incoming.favorite,
        favoriteSource: incoming.favorite == null ? undefined : 'emby',
        doubanId: null,
        doubanRating: null,
        doubanRatingUpdatedAt: null,
        userRating: null,
        userRatingUpdatedAt: null,
        lastRefreshedAt: now,
        reason: '新入库',
        seriesName: incoming.seriesName || null,
        seriesId: incoming.seriesId || null,
        seasonNumber: incoming.seasonNumber || null,
        episodeCount: incoming.episodeCount || null,
        tmdbId: incoming.tmdbId || null,
        providerIds: incoming.providerIds || {},
      };
      projectMediaFactsForItem(newItem);
      userPerceptionManagement.projectItem(newItem, { now, source: 'emby' });
      lib.items.push(newItem);
      touchedItemIds.add(newItem.itemId);
      upserted++;
    }
  }

  // Remove items that no longer exist in Emby (orphan cleanup)
  // Only during full sync — partial updates (markPlayed etc.) must not purge.
  const incomingIds = new Set(allItems.map((it) => it.sourceId || it.itemId));
  let removed = [];
  if (fullSync) {
    removed = lib.items.filter(
      (it) => it.subLibraryId === subLibraryId && it.source === 'emby' && !incomingIds.has(it.sourceId),
    );
    lib.items = lib.items.filter(
      (it) => !(it.subLibraryId === subLibraryId && it.source === 'emby' && !incomingIds.has(it.sourceId)),
    );
  }

  lib.cachedAt = now;
  libraryStore.replaceSubLibraryItems(subLibraryId, lib.items, { cachedAt: now });
  for (const itemId of touchedItemIds) {
    factsFreshnessService.markFresh(itemId, ['sourceFacts', 'mediaFacts', 'metadataFacts'], {
      now,
      updatedAt: now,
      observedAt: now,
      evidence: { source: 'emby_ingest', subLibraryId },
    });
  }

  // Update subLibrary lastRefreshedAt
  if (subLib) {
    const subLibs = cfg.subLibraries || [];
    const idx = subLibs.findIndex((s) => s.uuid === subLibraryId);
    if (idx >= 0) {
      subLibs[idx].lastRefreshedAt = now;
      configStore.patchConfig({ subLibraries: subLibs });
    }
  }

  return { upserted, removed: removed.length };
}

function updateUserRating(itemId, userRating) {
  if (userRating !== null && (userRating < 1 || userRating > 5)) throw new Error('Rating must be 1-5');
  const item = libraryStore.getItem(itemId);
  if (!item) throw new Error('Item not found');

  item.userRating = userRating;
  item.userRatingUpdatedAt = userRating === null ? null : new Date().toISOString();
  userPerceptionManagement.projectItem(item, { now: item.userRatingUpdatedAt || new Date().toISOString(), source: 'local' });

  libraryStore.updateItems([item]);
  const message = userRating === null
    ? `「${item.name}」评分已清空`
    : `「${item.name}」已评分 ${'★'.repeat(userRating)}`;
  activityLog.addActivity('user_action', message);
  return item;
}

function applyEmbyPerceptionFacts(itemId, embyItem = {}, opts = {}) {
  const item = libraryStore.getItem(itemId);
  if (!item) throw new Error('Item not found');
  const now = opts.now || new Date().toISOString();
  let changed = false;
  if (embyItem.watched != null && item.watched !== embyItem.watched) {
    item.watched = embyItem.watched;
    item.watchedSource = 'emby';
    item.watchedUpdatedAt = now;
    changed = true;
  }
  if (embyItem.playCount != null && item.playCount !== embyItem.playCount) {
    item.playCount = embyItem.playCount;
    item.playCountSource = 'emby';
    changed = true;
  }
  if (embyItem.lastPlayedAt != null && item.lastPlayedAt !== embyItem.lastPlayedAt) {
    item.lastPlayedAt = embyItem.lastPlayedAt;
    changed = true;
  }
  if (embyItem.favorite != null && item.favorite !== embyItem.favorite) {
    item.favorite = embyItem.favorite;
    item.favoriteSource = 'emby';
    changed = true;
  }
  if (changed) {
    userPerceptionManagement.projectItem(item, { now, source: 'emby' });
    libraryStore.updateItems([item]);
  }
  return item;
}

function getLibrary(filter = {}, opts = {}) {
  const stageMs = {};
  const measure = (stage, fn) => {
    const started = Date.now();
    try {
      return fn();
    } finally {
      stageMs[stage] = Date.now() - started;
    }
  };

  return diagnosticLog.track({
    category: 'service',
    scope: 'mediaLibraryService.getLibrary',
    operation: 'get_library',
    component: 'mediaLibraryService',
    resourceType: 'sqlite',
    resourceKey: 'library.db',
    slowMs: 250,
    payload: {
      filter: {
        source: filter.source || '',
        type: filter.type || '',
        subLibraryId: filter.subLibraryId || '',
        hasSearch: !!filter.search,
        hasActiveTaskFilter: !!filter.activeTaskIds,
        taskState: filter.taskState || '',
        lifecycle: filter.lifecycle || '',
        metadataStatus: filter.metadataStatus || filter.scrapeStatus || '',
      },
      page: {
        limit: opts.limit || null,
        offset: opts.offset || 0,
      },
      projection: {
        includeOptimizationStatus: !!opts.includeOptimizationStatus,
        includeLifecycleStatus: !!opts.includeLifecycleStatus,
        hasLifecycleFilter: !!filter.lifecycle,
        hasOptimizationFilter: !!filter.optimizationStatus,
      },
    },
    successPayload: (result) => ({
      rowCount: result && Array.isArray(result.items) ? result.items.length : 0,
      total: result && typeof result.total === 'number' ? result.total : undefined,
      stages: stageMs,
    }),
  }, () => {
    const storeFilter = { ...(filter || {}) };
    if (storeFilter.activeTaskIds) {
      const activeTaskIds = storeFilter.activeTaskIds instanceof Set ? storeFilter.activeTaskIds : new Set();
      const ids = [...activeTaskIds].filter(Boolean);
      if (storeFilter.taskState === 'active') storeFilter.itemIds = ids;
      if (storeFilter.taskState === 'none') storeFilter.excludeItemIds = ids;
      delete storeFilter.activeTaskIds;
      delete storeFilter.taskState;
    }

    const config = measure('loadConfigMs', () => configStore.loadConfig());
    const result = measure('queryItemsMs', () => libraryStore.queryItems(storeFilter, opts));
    let items = result.items.map((item) => ({ ...item }));
    items = measure('perceptionDecorateMs', () => userPerceptionManagement.decorateItems(items));
    items = measure('metadataDecorateMs', () => metadataStatus.decorateItems(items, config));
    items = measure('factsFreshnessDecorateMs', () => factsFreshnessService.decorateItems(items));
    if (opts.includeOptimizationStatus || opts.includeLifecycleStatus || storeFilter.lifecycle || storeFilter.optimizationStatus) {
      const taskStore = require('./taskStore');
      const itemIds = items.map((item) => item.itemId).filter(Boolean);
      const optimizationTasks = measure('queryOptimizationTasksMs', () => (typeof taskStore.queryOptimizationTaskIndexRows === 'function'
        ? taskStore.queryOptimizationTaskIndexRows(itemIds && itemIds.length > 0 ? { itemIds } : {})
        : taskStore.loadTasks()));
      items = measure('optimizationDecorateMs', () => optimizationStatus.decorateItems(items, optimizationTasks, config));
    }
    items = measure('lifecycleDecorateMs', () => lifecycleProjection.decorateItems(items, config));
    return { ...result, items };
  });
}

function getLibraryItem(itemId) {
  const item = libraryStore.getItem(itemId);
  if (!item) return null;
  const config = configStore.loadConfig();
  let decorated = userPerceptionManagement.decorateItem(item);
  decorated = metadataStatus.decorateItem(decorated, config);
  decorated = factsFreshnessService.decorateItem(decorated);
  const taskStore = require('./taskStore');
  const optimizationTasks = typeof taskStore.queryOptimizationTaskIndexRows === 'function'
    ? taskStore.queryOptimizationTaskIndexRows({ itemIds: [item.itemId] })
    : taskStore.loadTasks();
  decorated = optimizationStatus.decorateItems([decorated], optimizationTasks, config)[0];
  return lifecycleProjection.decorateItem(decorated, config);
}

function getSpaceStatLibrary() {
  const items = libraryStore.querySpaceStatItems();
  return { items, total: items.length, offset: 0, limit: null };
}

function getSmartTaskCandidateItems() {
  return factsFreshnessService.decorateItems(libraryStore.querySmartTaskCandidateItems());
}

function getLibraryStatus() {
  const cfg = configStore.loadConfig();
  return {
    subLibraries: (cfg.subLibraries || []).map((sl) => ({
      uuid: sl.uuid,
      name: sl.name,
      enabled: sl.enabled !== false,
      lastRefreshedAt: sl.lastRefreshedAt || null,
      doubanEnabled: sl.doubanEnabled || false,
      doubanSyncedAt: sl.doubanSyncedAt || null,
      source: sl.source || 'emby',
      mediaType: sl.mediaType || 'movie',
      adultRegion: sl.adultRegion || null,
      scraperType: sl.scraperType || null,
      watchRoot: sl.watchRoot || '',
    })),
  };
}

// ── SubLibrary CRUD ─────────────────────────────────────────────────────────

function addSubLibrary(spec) {
  const cfg = configStore.loadConfig();
  const uuid = generateUuid();
  const mediaType = spec.mediaType || 'movie';
  const isAdult = mediaType === 'adult';
  const subLib = {
    uuid,
    name: spec.name || '新子库',
    embyServerId: spec.embyServerId || '',
    sectionId: spec.sectionId || '',
    source: spec.source || 'emby',
    doubanEnabled: spec.doubanEnabled || false,
    enabled: true,
    lastRefreshedAt: null,
    doubanSyncedAt: null,
    mediaType,
    adultRegion: spec.adultRegion || (isAdult ? 'japanese_jav' : undefined),
    scraperType: spec.scraperType || (isAdult ? (spec.adultRegion === 'western_adult' ? 'western_builtin' : 'shelfdeck_japanese_jav') : undefined),
    watchRoot: spec.watchRoot || '',
    japaneseJav: spec.japaneseJav || undefined,
    western: spec.western || undefined,
    ruleTemplateId: spec.ruleTemplateId || (mediaType === 'adult' ? (spec.adultRegion === 'western_adult' ? 'adult_western_default' : 'adult_jav_default') : mediaType === 'tv' ? 'tv_default' : 'default'),
    metadataGate: spec.metadataGate || undefined,
    ...configStore.defaultSubLibSchedule(),
    automationMode: spec.automationMode || (spec.scheduleMode === 'full_manual' ? 'manual' : 'auto'),
    scheduleMode: spec.scheduleMode || (spec.automationMode === 'manual' ? 'full_manual' : 'full_auto'),
    autoCreate: true,
    autoExecute: spec.autoExecute !== undefined ? spec.autoExecute : spec.automationMode !== 'manual',
    approvalPolicy: spec.approvalPolicy || {},
    autoReplaceTranscode: spec.autoReplaceTranscode || false,
    autoReplaceUpgrade: spec.autoReplaceUpgrade || false,
    smartSelectEnabled: spec.smartSelectEnabled || false,
    upgradeSmartSelect: spec.upgradeSmartSelect || {
      enabled: spec.smartSelectEnabled || false,
      codecPreference: [],
      resolutionPreference: [],
      audioPreference: [],
      sitePreference: [],
      preferCNSub: false,
    },
    pathMapFrom: spec.pathMapFrom || '',
    pathMapTo: spec.pathMapTo || '',
  };
  cfg.subLibraries = [...(cfg.subLibraries || []), subLib];
  configStore.saveConfig(cfg);

  // Start timers for this subLibrary
  startSubLibraryTimers(subLib);

  return subLib;
}

function deleteSubLibrary(uuid) {
  const cfg = configStore.loadConfig();
  const idx = (cfg.subLibraries || []).findIndex((s) => s.uuid === uuid);
  if (idx < 0) return false;
  cfg.subLibraries.splice(idx, 1);
  configStore.saveConfig(cfg);

  libraryStore.deleteBySubLibrary(uuid);

  return true;
}

function updateSubLibrary(uuid, updates) {
  const cfg = configStore.loadConfig();
  const subLibs = cfg.subLibraries || [];
  const idx = subLibs.findIndex((s) => s.uuid === uuid);
  if (idx < 0) return null;
  const { scrapeSettleSeconds, scrapeEnabled, scanIntervalMinutes, ...allowedUpdates } = updates || {};
  subLibs[idx] = { ...subLibs[idx], ...allowedUpdates };
  configStore.saveConfig(cfg);
  return subLibs[idx];
}

// ── Media facts projection replay ────────────────────────────────────────────

let mediaFactsProjectionTimer = null;
let startupIngestTimer = null;

function replayMediaFactsProjection() {
  const lib = loadLibrary();
  if (!lib || !lib.items || lib.items.length === 0) return;

  let changed = 0;
  const changedItems = [];

  for (const item of lib.items) {
    const itemChanged = projectMediaFactsForItem(item);
    changed += itemChanged;
    if (itemChanged > 0) changedItems.push(item);
  }

  if (changed > 0) {
    libraryStore.updateItems(changedItems);
    const msg = `Media facts projection replay complete, ${changed} field(s) updated`;
    console.log(`[mediaLibrary] ${msg}`);
    activityLog.addActivity('media_library', msg, { changed });
  }
}

function projectStoredMediaFactsForItem(itemId) {
  const item = getLibraryItem(itemId);
  if (!item) return { item: null, changed: 0 };
  const changed = projectMediaFactsForItem(item);
  if (changed > 0) libraryStore.updateItems([item]);
  return { item, changed };
}

function startMediaFactsProjectionReplayTimer(intervalMs = 600000, options = {}) {
  stopMediaFactsProjectionReplayTimer();
  if (options.runImmediately !== false) {
    replayMediaFactsProjection();
  }
  mediaFactsProjectionTimer = setInterval(replayMediaFactsProjection, intervalMs);
  mediaFactsProjectionTimer.unref && mediaFactsProjectionTimer.unref();
}

function stopMediaFactsProjectionReplayTimer() {
  if (mediaFactsProjectionTimer) {
    clearInterval(mediaFactsProjectionTimer);
    mediaFactsProjectionTimer = null;
  }
}

const recomputeAllSelfFields = replayMediaFactsProjection;

// ── SubLibrary timers ───────────────────────────────────────────────────────

const subLibraryTimers = new Map(); // uuid → { ingest: Interval, douban: Interval }
const doubanSyncInFlight = new Set();

function stopSubLibraryTimers(uuid) {
  const timers = subLibraryTimers.get(uuid);
  if (timers) {
    if (timers.ingest) clearInterval(timers.ingest);
    if (timers.douban) clearInterval(timers.douban);
    subLibraryTimers.delete(uuid);
  }
}

function doubanMatchForItem(item, byNormTitle, subjectIdByNormTitle) {
  let stars = null;
  let matchName = null;

  if (item.type === 'movie') {
    matchName = item.name;
    stars = doubanMatchService.movieDoubanStars(item.name, 'Movie', byNormTitle);
  } else if (item.type === 'season' && item.seriesName != null && item.seasonNumber != null) {
    matchName = item.seriesName;
    stars = doubanMatchService.seasonDoubanStars(item.seriesName, item.seasonNumber, byNormTitle);
  }

  if (stars == null) return null;
  const subjectId = doubanMatchService
    .embyTitleNormalizedKeys(matchName)
    .map((key) => subjectIdByNormTitle.get(key))
    .find(Boolean) || '';
  return { stars, subjectId };
}

function applyDoubanEntriesToSubLibrary(subLib, entries, opts = {}) {
  const list = Array.isArray(entries) ? entries : [];
  if (!subLib || !subLib.uuid || list.length === 0) {
    return { entries: list.length, libraryItems: 0, matched: 0, changed: 0 };
  }

  const byNormTitle = doubanMatchService.buildDoubanStarsByNormalizedTitle(list);
  const subjectIdByNormTitle = new Map();
  for (const entry of list) {
    for (const key of doubanMatchService.doubanTitleNormalizedKeys(entry.title)) {
      if (!subjectIdByNormTitle.has(key) && entry.subjectId) {
        subjectIdByNormTitle.set(key, entry.subjectId);
      }
    }
  }

  const items = libraryStore.queryItems({ subLibraryId: subLib.uuid }).items;
  const changedItems = [];
  let matchedCount = 0;
  let changedCount = 0;
  const now = opts.now || new Date().toISOString();

  for (const item of items) {
    const match = doubanMatchForItem(item, byNormTitle, subjectIdByNormTitle);
    if (!match) continue;
    matchedCount++;
    let changed = false;
    if (item.doubanRating !== match.stars) {
      item.doubanRating = match.stars;
      item.doubanRatingUpdatedAt = now;
      changed = true;
    }
    if (!item.doubanId && match.subjectId) {
      item.doubanId = match.subjectId;
      changed = true;
    }
    if (changed) {
      userPerceptionManagement.projectItem(item, { now, source: 'douban' });
      changedCount++;
      changedItems.push(item);
    }
  }

  if (changedItems.length > 0) {
    libraryStore.updateItems(changedItems);
  }

  return {
    entries: list.length,
    libraryItems: items.length,
    matched: matchedCount,
    changed: changedCount,
  };
}

function applyCachedDoubanForSubLibrary(subLib) {
  const entries = doubanService.loadCachedEntries();
  const result = applyDoubanEntriesToSubLibrary(subLib, entries);
  if (result.entries > 0 && result.changed > 0) {
    activityLog.addActivity('douban', `子库「${subLib.name || subLib.uuid}」已应用本地豆瓣缓存，更新 ${result.changed} 个条目`, {
      subLibraryId: subLib.uuid,
      matched: result.matched,
      changed: result.changed,
      source: 'local_cache',
    });
  }
  return result;
}

async function listSourceObservationCandidates(config = configStore.loadConfig(), options = {}) {
  const requestedSubLibraryId = String(options.subLibraryId || '').trim();
  const candidates = [];
  const subLibs = (config.subLibraries || []).filter((sl) => (
    sl
    && sl.enabled !== false
    && (sl.source || 'emby') !== 'folder'
    && (!requestedSubLibraryId || sl.uuid === requestedSubLibraryId)
  ));

  for (const subLib of subLibs) {
    const server = (config.embyServers || {})[subLib.embyServerId];
    if (!server || !server.baseUrl) continue;
    const inventory = await embyService.getLibraryItems(server, subLib.sectionId);
    const manageable = manageableEmbyItems(inventory);
    const existingItems = libraryStore.queryItems({ subLibraryId: subLib.uuid }).items
      .filter((item) => (item.source || 'emby') === 'emby');
    const matchedExisting = new Set();

    for (const incoming of manageable) {
      const existingIdx = assetIdentity.findExistingItemIndex(existingItems, incoming, subLib, subLib.uuid);
      const existing = existingIdx >= 0 ? existingItems[existingIdx] : null;
      const observationKind = existing ? 'source_changed' : 'new_source_observed';
      if (existing) matchedExisting.add(existing.itemId);
      if (existing && !sourceFactsChanged(existing, incoming, subLib.uuid)) continue;
      const itemInfo = embyObservationItemInfo(subLib, incoming, existing, observationKind);
      candidates.push({
        targetGate: 'ingest',
        itemInfo,
        gateObjective: {
          kind: 'source_observation',
          observationKind,
          source: 'emby',
          subLibraryId: subLib.uuid,
        },
        timestamp: Date.now(),
      });
    }

    for (const existing of existingItems) {
      if (matchedExisting.has(existing.itemId)) continue;
      if (existing.sourceExists === false) continue;
      const itemInfo = embyObservationItemInfo(subLib, null, existing, 'source_missing');
      candidates.push({
        targetGate: 'ingest',
        itemInfo,
        gateObjective: {
          kind: 'source_observation',
          observationKind: 'source_missing',
          source: 'emby',
          subLibraryId: subLib.uuid,
        },
        timestamp: Date.now(),
      });
    }
  }

  return candidates;
}

function commitEmbySourceCandidate(itemInfo = {}, opts = {}) {
  const now = opts.now || new Date().toISOString();
  const cfg = opts.config || configStore.loadConfig();
  const subLib = (cfg.subLibraries || []).find((sl) => sl.uuid === itemInfo.subLibraryId);
  if (!subLib) throw new Error('SubLibrary not found');
  const observationKind = String(itemInfo.sourceObservationKind || '').trim() || 'source_changed';
  const sourceId = itemInfo.sourceId || itemInfo.embyItemId || '';
  let item = itemInfo.itemId && libraryStore.getItem(itemInfo.itemId);
  const sourceSnapshot = itemInfo.sourceSnapshot && typeof itemInfo.sourceSnapshot === 'object'
    ? itemInfo.sourceSnapshot
    : null;

  if (observationKind === 'source_missing') {
    if (!item) throw new Error('Source missing target item not found');
    item.sourceExists = false;
    item.sourceMissingAt = now;
    item.sourceObservedAt = now;
    item.lastRefreshedAt = now;
    libraryStore.updateItems([item]);
    factsFreshnessService.markFresh(item.itemId, ['sourceFacts'], {
      now,
      updatedAt: now,
      observedAt: now,
      evidence: { source: 'emby_inventory', observationKind, subLibraryId: subLib.uuid },
    });
    factsFreshnessService.markStale(item.itemId, ['mediaFacts', 'metadataFacts'], {
      now,
      reason: 'source_missing',
      refreshTargetGate: 'ingest',
      evidence: { source: 'emby_inventory', observationKind, subLibraryId: subLib.uuid },
    });
    return { item, created: false, observationKind };
  }

  if (!sourceSnapshot) throw new Error('Emby source snapshot is required');
  const incomingAssetKey = assetIdentity.computeAssetKey(sourceSnapshot, subLib.uuid);
  const incomingAssetRootPath = assetIdentity.inferAssetRootPath(sourceSnapshot.path, sourceSnapshot.isDiscLike);
  const incomingExternalRefs = { emby: assetIdentity.makeExternalEmbyRef(sourceSnapshot, subLib, now) };

  if (!item) {
    item = {
      itemId: generateUuid(),
      subLibraryId: subLib.uuid,
      name: sourceSnapshot.name || itemInfo.name || '',
      path: sourceSnapshot.path || '',
      source: 'emby',
      sourceId,
      assetKey: incomingAssetKey,
      assetRootPath: incomingAssetRootPath,
      externalRefs: incomingExternalRefs,
      type: sourceSnapshot.type || itemInfo.type || 'movie',
      bitrate: 0,
      duration: 0,
      resolution: '',
      size: sourceSnapshot.size || 0,
      codec: '',
      audioCodecs: [],
      bucket: '',
      premiereDate: null,
      genres: [],
      isDiscLike: !!sourceSnapshot.isDiscLike,
      watched: false,
      playCount: null,
      lastPlayedAt: null,
      favorite: null,
      doubanId: null,
      doubanRating: null,
      doubanRatingUpdatedAt: null,
      userRating: null,
      userRatingUpdatedAt: null,
      lastRefreshedAt: now,
      sourceExists: true,
      sourceObservedAt: now,
      reason: 'source observed',
      seriesName: sourceSnapshot.seriesName || null,
      seriesId: sourceSnapshot.seriesId || null,
      seasonNumber: sourceSnapshot.seasonNumber || null,
      episodeCount: sourceSnapshot.episodeCount || null,
      tmdbId: sourceSnapshot.tmdbId || null,
      providerIds: sourceSnapshot.providerIds || {},
    };
    const lib = loadLibrary();
    lib.items = Array.isArray(lib.items) ? lib.items : [];
    lib.items.push(item);
    lib.cachedAt = now;
    saveLibrary(lib);
  } else {
    item = {
      ...item,
      source: 'emby',
      sourceId: sourceId || item.sourceId,
      assetKey: incomingAssetKey || item.assetKey,
      assetRootPath: incomingAssetRootPath || item.assetRootPath,
      externalRefs: { ...(item.externalRefs || {}), ...incomingExternalRefs },
      name: sourceSnapshot.name || item.name,
      path: sourceSnapshot.path || item.path,
      type: sourceSnapshot.type || item.type,
      size: sourceSnapshot.size > 0 ? sourceSnapshot.size : item.size,
      isDiscLike: sourceSnapshot.isDiscLike != null ? sourceSnapshot.isDiscLike : item.isDiscLike,
      sourceExists: true,
      sourceMissingAt: null,
      sourceObservedAt: now,
      lastRefreshedAt: now,
    };
    libraryStore.updateItems([item]);
  }

  factsFreshnessService.markFresh(item.itemId, ['sourceFacts'], {
    now,
    updatedAt: now,
    observedAt: now,
    evidence: { source: 'emby_inventory', observationKind, subLibraryId: subLib.uuid },
  });
  factsFreshnessService.markStale(item.itemId, ['mediaFacts', 'metadataFacts'], {
    now,
    reason: observationKind,
    refreshTargetGate: 'metadata',
    evidence: { source: 'emby_inventory', observationKind, subLibraryId: subLib.uuid },
  });
  return { item, created: observationKind === 'new_source_observed', observationKind };
}

async function syncDoubanForSubLibrary(subLib) {
  const name = subLib.name || subLib.uuid;
  if (doubanSyncInFlight.has(subLib.uuid)) {
    runtimeResourceTracker.recordInstant({
      eventType: 'douban.sync',
      eventStatus: 'skipped',
      component: 'mediaLibraryService',
      resourceType: 'douban',
      resourceKey: `douban:${subLib.uuid}`,
      resourceLabel: 'Douban sync',
      subLibraryId: subLib.uuid,
      payload: { reason: 'already_running', subLibraryName: name },
    });
    console.log('[mediaLibrary] douban sync skipped, already running for', subLib.uuid);
    return;
  }
  doubanSyncInFlight.add(subLib.uuid);
  const runtimeEvent = runtimeResourceTracker.startEvent({
    eventType: 'douban.sync',
    component: 'mediaLibraryService',
    resourceType: 'douban',
    resourceKey: `douban:${subLib.uuid}`,
    resourceLabel: 'Douban sync',
    subLibraryId: subLib.uuid,
    payload: { subLibraryName: name },
  });
  let finalStatus = 'done';
  const finalPayload = {};
  try {
    // Fetch douban ratings — credentials come from douban-session.json
    const session = doubanService.getSession();
    if (!session.userId) {
      finalStatus = 'skipped';
      finalPayload.reason = 'missing_user_id';
      activityLog.addActivity('douban', `子库「${name}」豆瓣同步跳过：未配置豆瓣用户 ID，请在豆瓣集成页面设置`);
      return;
    }

    activityLog.addActivity('douban', `子库「${name}」开始抓取豆瓣评分…`);
    const cachedEntries = doubanService.loadCachedEntries();

    // Progress sink: log every 100 entries accumulated
    let lastLogged = 0;
    const progressSink = {
      send(payload) {
        const count = payload.allEntries ? payload.allEntries.length : 0;
        if (count - lastLogged >= 100) {
          lastLogged = count;
          runtimeEvent.update({ fetchedEntries: count });
          activityLog.addActivity('douban', `子库「${name}」豆瓣评分抓取中… 已抓取 ${count} 条`);
        }
        if (payload.done && !payload.cancelled) {
          runtimeEvent.update({ fetchedEntries: count });
          activityLog.addActivity('douban', `子库「${name}」豆瓣评分抓取完成，共 ${count} 条`);
        }
      },
    };

    const { entries } = await doubanService.fetchRatings(progressSink, { existingEntries: cachedEntries });
    if (!entries || entries.length === 0) {
      finalPayload.fetchedEntries = 0;
      activityLog.addActivity('douban', `子库「${name}」豆瓣评分同步完成，无豆瓣数据`);
      return;
    }
    doubanService.saveCachedEntries(entries);
    runtimeEvent.update({ fetchedEntries: entries.length });

    // Match against library items for this subLibrary
    const applied = applyDoubanEntriesToSubLibrary(subLib, entries);
    runtimeEvent.update({ libraryItems: applied.libraryItems });

    // Update subLibrary doubanSyncedAt
    const cfg = configStore.loadConfig();
    const subLibs = cfg.subLibraries || [];
    const idx = subLibs.findIndex((s) => s.uuid === subLib.uuid);
    if (idx >= 0) {
      subLibs[idx].doubanSyncedAt = now;
      configStore.patchConfig({ subLibraries: subLibs });
    }

    const msg = `子库「${name}」豆瓣评分同步完成，${applied.matched} 个匹配，${applied.changed} 个条目更新`;
    Object.assign(finalPayload, {
      fetchedEntries: entries.length,
      libraryItems: applied.libraryItems,
      matched: applied.matched,
      changed: applied.changed,
    });
    activityLog.addActivity('douban', msg, { subLibraryId: subLib.uuid, matched: applied.matched, changed: applied.changed });
    console.log('[mediaLibrary] douban synced for', subLib.uuid);
  } catch (e) {
    finalStatus = 'failed';
    finalPayload.error = e.message;
    activityLog.addActivity('douban', `子库「${name}」豆瓣评分同步失败：${e.message}`);
    console.error('[mediaLibrary] douban sync error for', subLib.uuid, e.message);
  } finally {
    runtimeEvent.finish(finalStatus, finalPayload);
    doubanSyncInFlight.delete(subLib.uuid);
  }
}

async function completeEmbyItemMetadata(itemId, opts = {}) {
  const cfg = opts.config || configStore.loadConfig();
  const current = getLibraryItem(itemId);
  if (!current) throw new Error('Library item not found');
  const subLib = (cfg.subLibraries || []).find((sl) => sl.uuid === current.subLibraryId);
  if (!subLib) throw new Error('SubLibrary not found');
  if ((subLib.source || 'emby') !== 'emby') throw new Error('SubLibrary is not an Emby library');
  const server = (cfg.embyServers || {})[subLib.embyServerId];
  if (!server || !server.baseUrl) throw new Error('Emby server not configured for this subLibrary');

  const embyItemId = assetIdentity.getEmbyItemId(current) || current.sourceId || current.itemId;
  if (!embyItemId) throw new Error('Emby item id is missing');

  const fetched = await embyService.getItemById(server, embyItemId);
  let repairItems = [fetched];
  let episodesFetched = 0;
  let localProbe = false;
  if (fetched && fetched.type === 'season' && typeof embyService.getSeasonEpisodes === 'function') {
    const episodes = await embyService.getSeasonEpisodes(server, embyItemId);
    episodesFetched = Array.isArray(episodes) ? episodes.length : 0;
    repairItems = [fetched, ...(Array.isArray(episodes) ? episodes : [])];
  } else {
    await enrichDiscMetadata([fetched], subLib, cfg);
    await enrichFileMetadata([fetched], subLib, cfg);
    localProbe = true;
  }
  upsertItems(subLib.uuid, repairItems, { fullSync: false });
  factsFreshnessService.markFresh(itemId, ['mediaFacts', 'metadataFacts'], {
    now: new Date().toISOString(),
    evidence: {
      source: 'emby_metadata_refresh',
      embyItemId,
      episodesFetched,
    },
  });

  let doubanCache = null;
  if (subLib.doubanEnabled) {
    doubanCache = applyCachedDoubanForSubLibrary(subLib);
  }

  projectStoredMediaFactsForItem(itemId);
  try {
    const strategyEngine = require('./strategyEngine');
    strategyEngine.runOnce();
  } catch (_) {}

  const latest = getLibraryItem(itemId) || current;
  latest.metadataRepairSummary = {
    embyFetched: true,
    episodesFetched,
    localProbe,
    doubanCache,
    mediaFactsProjected: true,
  };
  return latest;
}

function startSubLibraryTimers(subLib) {
  const uuid = subLib.uuid;
  stopSubLibraryTimers(uuid);

  if (subLib.source === 'folder') {
    return;
  }

  const timers = {};

  // Douban sync timer (6h) — only if enabled
  if (subLib.doubanEnabled) {
    timers.douban = setInterval(() => {
      const cfg = configStore.loadConfig();
      const sl = (cfg.subLibraries || []).find((s) => s.uuid === uuid);
      if (sl && sl.doubanEnabled) {
        runBackgroundLibraryOperation({
          operation: 'douban.sync',
          resourceKey: `douban:${uuid}`,
          payload: { subLibraryId: uuid, subLibraryName: sl.name || uuid, trigger: 'timer' },
        }, () => syncDoubanForSubLibrary(sl)).catch((e) => console.error('[mediaLibrary] timer douban error:', e));
      }
    }, 21600000);
  }

  subLibraryTimers.set(uuid, timers);
}

function startAllSubLibraryTimers() {
  const cfg = configStore.loadConfig();
  const subLibs = (cfg.subLibraries || []).filter((sl) => sl.enabled !== false);

  if (startupIngestTimer) {
    clearTimeout(startupIngestTimer);
    startupIngestTimer = null;
  }

  for (const sl of subLibs) {
    startSubLibraryTimers(sl);
  }

  const runMediaFactsMaintenance = (options = {}) => {
    const currentCfg = configStore.loadConfig();
    if (currentCfg.mediaLibrarySelfComputeEnabled === false) {
      console.log('[mediaLibrary] media facts projection maintenance disabled by config');
      return;
    }
    if (options.runImmediately !== false && currentCfg.mediaLibrarySelfComputeOnStartup !== false) {
      replayMediaFactsProjection();
    }
  };

  runMediaFactsMaintenance();
}

function stopAllTimers() {
  if (startupIngestTimer) {
    clearTimeout(startupIngestTimer);
    startupIngestTimer = null;
  }
  for (const uuid of subLibraryTimers.keys()) {
    stopSubLibraryTimers(uuid);
  }
  stopMediaFactsProjectionReplayTimer();
}

async function triggerDoubanSync(subLibraryId) {
  const cfg = configStore.loadConfig();
  const sl = (cfg.subLibraries || []).find((s) => s.uuid === subLibraryId);
  if (!sl) throw new Error('SubLibrary not found');
  if (!sl.doubanEnabled) throw new Error('Douban sync not enabled for this subLibrary');
  await syncDoubanForSubLibrary(sl);
}

module.exports = {
  // Library CRUD
  loadLibrary,
  getLibrary,
  getLibraryItem,
  getSpaceStatLibrary,
  getSmartTaskCandidateItems,
  upsertItems,
  updateUserRating,
  applyEmbyPerceptionFacts,
  saveLibrary,
  updateLibraryItems,
  getLibraryStatus,
  listSourceObservationCandidates,
  commitEmbySourceCandidate,

  // SubLibrary CRUD
  addSubLibrary,
  deleteSubLibrary,
  updateSubLibrary,

  // Media facts projection
  projectMediaFactsForItem,
  projectStoredMediaFactsForItem,
  replayMediaFactsProjection,
  recomputeAllSelfFields,
  startMediaFactsProjectionReplayTimer,
  stopMediaFactsProjectionReplayTimer,

  // Timer management
  startAllSubLibraryTimers,
  stopAllTimers,
  startSubLibraryTimers,
  stopSubLibraryTimers,

  // Manual triggers
  triggerDoubanSync,
  completeEmbyItemMetadata,

  _selectStartupRefreshSubLibrariesForTest: selectStartupIngestSubLibraries,
  _selectStartupIngestSubLibrariesForTest: selectStartupIngestSubLibraries,

  getHealth,
};

function getHealth(config) {
  const subLibs = (config && config.subLibraries) || [];
  const enabled = subLibs.filter((sl) => sl.enabled !== false);
  const refreshScheduled = enabled.filter((sl) => (sl.source || 'emby') !== 'folder');
  const totalSubLibraries = subLibs.length;
  const enabledCount = enabled.length;
  const scheduledRefreshCount = refreshScheduled.length;
  const manualFolderCount = enabledCount - scheduledRefreshCount;

  if (enabledCount === 0) {
    return { status: 'green', totalSubLibraries, enabledCount: 0, scheduledRefreshCount: 0, manualFolderCount: 0, staleSubLibraries: [] };
  }

  if (!libraryStore.getHealth()) {
    return { status: 'red', totalSubLibraries, enabledCount, scheduledRefreshCount, manualFolderCount, staleSubLibraries: [] };
  }

  if (scheduledRefreshCount === 0) {
    return { status: 'green', totalSubLibraries, enabledCount, scheduledRefreshCount, manualFolderCount, staleSubLibraries: [] };
  }

  const refreshIntervalMin = (config && config.defaultRefreshIntervalMinutes) || 60;
  const graceMs = refreshIntervalMin * 2 * 60 * 1000;
  const now = Date.now();

  const staleSubLibraries = [];
  for (const sl of refreshScheduled) {
    const lastRefreshed = sl.lastRefreshedAt ? new Date(sl.lastRefreshedAt).getTime() : 0;
    if (now - lastRefreshed > graceMs) {
      staleSubLibraries.push(sl.name || sl.uuid);
    }
  }

  return { status: 'green', totalSubLibraries, enabledCount, scheduledRefreshCount, manualFolderCount, staleSubLibraries };
}
