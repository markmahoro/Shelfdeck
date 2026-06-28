'use strict';

/**
 * MediaLibraryService (MEDIA_LIBRARY.md).
 *
 * Coordinator for the unified media library persistence table (data/library.json).
 * Manages subLibraries, independent refresh and douban sync timers per subLibrary.
 *
 * Principle: write first, recalculate action/reason only for affected items.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const configStore = require('./configStore');
const doubanMatchService = require('./doubanMatchService');
const embyService = require('./services/embyService');
const transcodeService = require('./services/transcodeService');
const doubanService = require('./services/doubanService');
const activityLog = require('./activityLog');
const optimizationStatus = require('./optimizationStatus');
const assetIdentity = require('./assetIdentity');

function resolveDataDir() {
  return (
    process.env.CONTROL_PLANE_DATA_DIR ||
    process.env.MEDIA_SERVICE_DATA_DIR ||
    path.join(__dirname, '..', 'data')
  );
}

function libraryFilePath() {
  return path.join(resolveDataDir(), 'library.json');
}

let libraryCache = null;

function ensureDataDir() {
  const dir = resolveDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

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

// ── Library file persistence ────────────────────────────────────────────────

function loadLibrary() {
  ensureDataDir();
  const f = libraryFilePath();
  if (!fs.existsSync(f)) {
    if (libraryCache && libraryCache.path === f) libraryCache = null;
    return { version: 1, items: [], cachedAt: null };
  }
  try {
    const stat = fs.statSync(f);
    if (
      libraryCache &&
      libraryCache.path === f &&
      libraryCache.mtimeMs === stat.mtimeMs &&
      libraryCache.size === stat.size
    ) {
      return libraryCache.lib;
    }
    const lib = JSON.parse(fs.readFileSync(f, 'utf8'));
    libraryCache = { path: f, mtimeMs: stat.mtimeMs, size: stat.size, lib };
    return lib;
  } catch (err) {
    console.error('[mediaLibrary] failed to load library:', err.message);
    return { version: 1, items: [], cachedAt: null };
  }
}

function saveLibrary(lib) {
  ensureDataDir();
  const f = libraryFilePath();
  fs.writeFileSync(f, JSON.stringify(lib, null, 2), 'utf8');
  try {
    const stat = fs.statSync(f);
    libraryCache = { path: f, mtimeMs: stat.mtimeMs, size: stat.size, lib };
  } catch (_) {
    libraryCache = null;
  }
}

// ── Item operations ─────────────────────────────────────────────────────────

function upsertItems(subLibraryId, incomingItems, opts = {}) {
  const { fullSync = false } = opts;
  const lib = loadLibrary();
  const now = new Date().toISOString();
  const cfg = configStore.loadConfig();
  const subLib = (cfg.subLibraries || []).find((s) => s.uuid === subLibraryId) || null;
  let upserted = 0;

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
        lastRefreshedAt: now,
        tmdbId: incoming.tmdbId !== undefined ? incoming.tmdbId : existing.tmdbId,
        seriesName: incoming.seriesName !== undefined ? incoming.seriesName : existing.seriesName,
        seriesId: incoming.seriesId !== undefined ? incoming.seriesId : existing.seriesId,
        seasonNumber: incoming.seasonNumber !== undefined ? incoming.seasonNumber : existing.seasonNumber,
        episodeCount: incoming.episodeCount !== undefined ? incoming.episodeCount : existing.episodeCount,
      };
      lib.items[existingIdx] = merged;
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
        doubanId: null,
        doubanRating: null,
        doubanRatingUpdatedAt: null,
        userRating: null,
        userRatingUpdatedAt: null,
        lastRefreshedAt: now,
        action: 'keep',
        reason: '新入库',
        seriesName: incoming.seriesName || null,
        seriesId: incoming.seriesId || null,
        seasonNumber: incoming.seasonNumber || null,
        episodeCount: incoming.episodeCount || null,
        tmdbId: incoming.tmdbId || null,
      };
      lib.items.push(newItem);
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
  saveLibrary(lib);

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
  const lib = loadLibrary();
  const item = lib.items.find((it) => it.itemId === itemId);
  if (!item) throw new Error('Item not found');

  item.userRating = userRating;
  item.userRatingUpdatedAt = userRating === null ? null : new Date().toISOString();

  saveLibrary(lib);
  const message = userRating === null
    ? `「${item.name}」评分已清空`
    : `「${item.name}」已评分 ${'★'.repeat(userRating)}`;
  activityLog.addActivity('user_action', message);
  return item;
}

function getLibrary(filter = {}, opts = {}) {
  const lib = loadLibrary();
  let items = lib.items;
  const activeTaskIds = filter.activeTaskIds instanceof Set ? filter.activeTaskIds : null;
  if (filter.source) items = items.filter((it) => it.source === filter.source);
  if (filter.type) items = items.filter((it) => it.type === filter.type);
  if (filter.action) items = items.filter((it) => it.action === filter.action);
  if (filter.subLibraryId) items = items.filter((it) => it.subLibraryId === filter.subLibraryId);
  if (filter.search) {
    const q = String(filter.search).trim().toLowerCase();
    if (q) items = items.filter((it) => String(it.name || '').toLowerCase().includes(q));
  }
  if (filter.resolution) items = items.filter((it) => String(it.resolution || '').startsWith(String(filter.resolution)));
  if (filter.codec) items = items.filter((it) => String(it.codec || it.videoCodec || '').toLowerCase() === String(filter.codec).toLowerCase());
  if (filter.watched !== undefined) items = items.filter((it) => !!it.watched === !!filter.watched);
  if (filter.isBluRayDisc !== undefined) items = items.filter((it) => !!it.isBluRayDisc === !!filter.isBluRayDisc);
  if (filter.doubanStars !== undefined) {
    if (filter.doubanStars === null) items = items.filter((it) => it.doubanStars == null);
    else items = items.filter((it) => Number(it.doubanStars) === Number(filter.doubanStars));
  }
  if (filter.userRating !== undefined) {
    if (filter.userRating === null) items = items.filter((it) => it.userRating == null);
    else items = items.filter((it) => Number(it.userRating) === Number(filter.userRating));
  }
  if (filter.taskState === 'active' && activeTaskIds) {
    items = items.filter((it) => activeTaskIds.has(it.itemId));
  } else if (filter.taskState === 'none' && activeTaskIds) {
    items = items.filter((it) => !activeTaskIds.has(it.itemId));
  }
  if (filter.scrapeStatus) {
    items = items.filter((it) => {
      if (it.source !== 'adult_folder') return false;
      const status = typeof (it.adultMetadata && it.adultMetadata.scrapeStatus) === 'string' ? it.adultMetadata.scrapeStatus : '';
      if (filter.scrapeStatus === 'done') return Boolean(it.scraped) || status === 'done';
      if (filter.scrapeStatus === 'pending') return !it.scraped && (status === 'pending' || status === 'ambiguous' || !status);
      if (filter.scrapeStatus === 'failed') return status === 'failed';
      return true;
    });
  }
  const total = items.length;
  if (Number.isInteger(opts.offset) || Number.isInteger(opts.limit)) {
    const offset = Math.max(0, Number(opts.offset) || 0);
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : total;
    items = items.slice(offset, offset + limit);
  }
  items = items.map((item) => ({ ...item }));
  if (opts.includeOptimizationStatus) {
    const taskStore = require('./taskStore');
    const config = configStore.loadConfig();
    const optimizationTasks = typeof taskStore.queryOptimizationTaskIndexRows === 'function'
      ? taskStore.queryOptimizationTaskIndexRows()
      : taskStore.loadTasks();
    items = optimizationStatus.decorateItems(items, optimizationTasks, config);
  }
  return { items, total, offset: Math.max(0, Number(opts.offset) || 0), limit: Number.isInteger(opts.limit) ? opts.limit : null };
}

function getLibraryItem(itemId) {
  const lib = loadLibrary();
  return lib.items.find((it) => it.itemId === itemId) || null;
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
    scrapeEnabled: spec.scrapeEnabled !== undefined ? spec.scrapeEnabled : isAdult,
    scanIntervalMinutes: spec.scanIntervalMinutes,
    japaneseJav: spec.japaneseJav || undefined,
    western: spec.western || undefined,
    ruleTemplateId: spec.ruleTemplateId || (mediaType === 'adult' ? (spec.adultRegion === 'western_adult' ? 'adult_western_default' : 'adult_jav_default') : mediaType === 'tv' ? 'tv_default' : 'default'),
    ...configStore.defaultSubLibSchedule(),
    automationMode: spec.automationMode || (spec.scheduleMode === 'full_manual' ? 'manual' : 'auto'),
    scheduleMode: spec.scheduleMode || (spec.automationMode === 'manual' ? 'full_manual' : 'full_auto'),
    autoCreate: spec.autoCreate !== undefined ? spec.autoCreate : spec.automationMode !== 'manual',
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

  // Kick off an immediate refresh, then recompute self-fields so
  // equivalentBitrate is ready and strategy engine can produce results.
  refreshSubLibrary(subLib)
    .then(() => recomputeAllSelfFields())
    .catch((e) => console.error('[mediaLibrary] addSubLibrary refresh error:', e));

  return subLib;
}

function deleteSubLibrary(uuid) {
  const cfg = configStore.loadConfig();
  const idx = (cfg.subLibraries || []).findIndex((s) => s.uuid === uuid);
  if (idx < 0) return false;
  cfg.subLibraries.splice(idx, 1);
  configStore.saveConfig(cfg);

  // Remove items belonging to this subLibrary
  const lib = loadLibrary();
  lib.items = lib.items.filter((it) => it.subLibraryId !== uuid);
  saveLibrary(lib);

  return true;
}

function updateSubLibrary(uuid, updates) {
  const cfg = configStore.loadConfig();
  const subLibs = cfg.subLibraries || [];
  const idx = subLibs.findIndex((s) => s.uuid === uuid);
  if (idx < 0) return null;
  const { scrapeSettleSeconds, ...allowedUpdates } = updates || {};
  subLibs[idx] = { ...subLibs[idx], ...allowedUpdates };
  configStore.saveConfig(cfg);
  return subLibs[idx];
}

// ── Self-computed fields ──────────────────────────────────────────────────────

let selfComputeTimer = null;
let startupRefreshTimer = null;

function recomputeAllSelfFields() {
  const lib = loadLibrary();
  if (!lib || !lib.items || lib.items.length === 0) return;

  const cfg = configStore.loadConfig();
  const subLibs = cfg.subLibraries || [];
  let changed = 0;

  for (const item of lib.items) {
    const subLib = subLibs.find((s) => s.uuid === item.subLibraryId);

    // bucket
    const bucket = computeBucket(item.resolution);
    if (item.bucket !== bucket) { item.bucket = bucket; changed++; }

    // equivalentBitrate (Mbps)
    const eqMbps = item.bitrate > 0 ? item.bitrate / 1_000_000 : undefined;
    if (item.equivalentBitrate !== eqMbps) { item.equivalentBitrate = eqMbps; changed++; }

    // targetBitrate and predictedSizeGb are now written by StrategyEngine
    // based on rule template evaluation — no longer computed here.
  }

  if (changed > 0) {
    saveLibrary(lib);
    const msg = `Library 自算完成，${changed} 个字段已更新`;
    console.log(`[mediaLibrary] ${msg}`);
    activityLog.addActivity('media_library', msg, { changed });
  }
}

function startSelfComputeTimer(intervalMs = 600000, options = {}) {
  stopSelfComputeTimer();
  if (options.runImmediately !== false) {
    recomputeAllSelfFields();
  }
  selfComputeTimer = setInterval(recomputeAllSelfFields, intervalMs);
  selfComputeTimer.unref && selfComputeTimer.unref();
}

function stopSelfComputeTimer() {
  if (selfComputeTimer) {
    clearInterval(selfComputeTimer);
    selfComputeTimer = null;
  }
}

// ── SubLibrary timers ───────────────────────────────────────────────────────

const subLibraryTimers = new Map(); // uuid → { refresh: Interval, douban: Interval }

function stopSubLibraryTimers(uuid) {
  const timers = subLibraryTimers.get(uuid);
  if (timers) {
    if (timers.refresh) clearInterval(timers.refresh);
    if (timers.douban) clearInterval(timers.douban);
    subLibraryTimers.delete(uuid);
  }
}

async function refreshSubLibrary(subLib) {
  const name = subLib.name || subLib.uuid;
  try {
    if (subLib.source === 'folder') {
      return;
    }
    const cfg = configStore.loadConfig();
    const server = (cfg.embyServers || {})[subLib.embyServerId];
    if (!server || !server.baseUrl) {
      console.log('[mediaLibrary] skip refresh: no server config for', subLib.uuid);
      return;
    }
    activityLog.addActivity('media_library', `正在刷新子库「${name}」…`);
    const beforeCount = loadLibrary().items.filter((it) => it.subLibraryId === subLib.uuid).length;
    const items = await embyService.getLibraryItems(server, subLib.sectionId);
    await enrichDiscMetadata(items, subLib, cfg);
    const result = upsertItems(subLib.uuid, items, { fullSync: true });
    const afterCount = loadLibrary().items.filter((it) => it.subLibraryId === subLib.uuid).length;
    const newItems = Math.max(0, afterCount - beforeCount + result.removed);
    const msg = newItems > 0
      ? `子库「${name}」刷新完成，${newItems} 个新媒体入库，${result.removed} 个已清理`
      : `子库「${name}」刷新完成，无新增内容`;
    activityLog.addActivity('media_library', msg, { subLibraryId: subLib.uuid, itemCount: items.length, newItems, removed: result.removed });
    console.log('[mediaLibrary] refreshed', subLib.uuid, 'items:', items.length);

    // Recompute self-fields (equivalentBitrate etc.) and re-run strategy engine
    // so the dashboard reflects fresh recommendations immediately after refresh.
    recomputeAllSelfFields();
    try {
      const strategyEngine = require('./strategyEngine');
      strategyEngine.runOnce();
    } catch (_) { /* strategyEngine not yet started — timer will pick it up */ }
  } catch (e) {
    activityLog.addActivity('media_library', `子库「${name}」刷新失败：${e.message}`);
    console.error('[mediaLibrary] refresh error for', subLib.uuid, e.message);
  }
}

async function syncDoubanForSubLibrary(subLib) {
  const name = subLib.name || subLib.uuid;
  try {
    // Fetch douban ratings — credentials come from douban-session.json
    const session = doubanService.getSession();
    if (!session.userId) {
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
          activityLog.addActivity('douban', `子库「${name}」豆瓣评分抓取中… 已抓取 ${count} 条`);
        }
        if (payload.done && !payload.cancelled) {
          activityLog.addActivity('douban', `子库「${name}」豆瓣评分抓取完成，共 ${count} 条`);
        }
      },
    };

    const { entries } = await doubanService.fetchRatings(progressSink, { existingEntries: cachedEntries });
    if (!entries || entries.length === 0) {
      activityLog.addActivity('douban', `子库「${name}」豆瓣评分同步完成，无豆瓣数据`);
      return;
    }
    doubanService.saveCachedEntries(entries);

    const byNormTitle = doubanMatchService.buildDoubanStarsByNormalizedTitle(entries);

    // Match against library items for this subLibrary
    const lib = loadLibrary();
    let matchedCount = 0;
    let newRatingCount = 0;
    const now = new Date().toISOString();

    // Match movie by name, season by series+season key
    for (const item of lib.items) {
      if (item.subLibraryId !== subLib.uuid) continue;

      let stars = null;
      let matchName = null;

      if (item.type === 'movie') {
        matchName = item.name;
        stars = doubanMatchService.movieDoubanStars(item.name, 'Movie', byNormTitle);
      } else if (item.type === 'season' && item.seriesName != null && item.seasonNumber != null) {
        matchName = item.seriesName;
        stars = doubanMatchService.seasonDoubanStars(item.seriesName, item.seasonNumber, byNormTitle);
      }
      if (stars == null) continue;

      matchedCount++;
      if (item.doubanRating !== stars) {
        item.doubanRating = stars;
        item.doubanRatingUpdatedAt = now;
        newRatingCount++;

        const matchedEntry = entries.find((e) => {
          const keys = doubanMatchService.doubanTitleNormalizedKeys(e.title);
          const embyKeys = doubanMatchService.embyTitleNormalizedKeys(matchName);
          return embyKeys.some((ek) => keys.includes(ek));
        });
        if (matchedEntry) item.doubanId = matchedEntry.subjectId;
      }
    }

    if (newRatingCount > 0) {
      saveLibrary(lib);
    }

    // Update subLibrary doubanSyncedAt
    const cfg = configStore.loadConfig();
    const subLibs = cfg.subLibraries || [];
    const idx = subLibs.findIndex((s) => s.uuid === subLib.uuid);
    if (idx >= 0) {
      subLibs[idx].doubanSyncedAt = now;
      configStore.patchConfig({ subLibraries: subLibs });
    }

    const msg = `子库「${name}」豆瓣评分同步完成，${matchedCount} 个匹配，${newRatingCount} 个新评分`;
    activityLog.addActivity('douban', msg, { subLibraryId: subLib.uuid, matched: matchedCount, newRatings: newRatingCount });
    console.log('[mediaLibrary] douban synced for', subLib.uuid);
  } catch (e) {
    activityLog.addActivity('douban', `子库「${name}」豆瓣评分同步失败：${e.message}`);
    console.error('[mediaLibrary] douban sync error for', subLib.uuid, e.message);
  }
}

function startSubLibraryTimers(subLib) {
  const uuid = subLib.uuid;
  stopSubLibraryTimers(uuid);

  if (subLib.source === 'folder') {
    return;
  }

  const timers = {};

  // Emby refresh timer (1h)
  timers.refresh = setInterval(() => {
    const cfg = configStore.loadConfig();
    const sl = (cfg.subLibraries || []).find((s) => s.uuid === uuid);
    if (sl && sl.enabled !== false) {
      refreshSubLibrary(sl).catch((e) => console.error('[mediaLibrary] timer refresh error:', e));
    }
  }, 3600000);

  // Douban sync timer (6h) — only if enabled
  if (subLib.doubanEnabled) {
    timers.douban = setInterval(() => {
      const cfg = configStore.loadConfig();
      const sl = (cfg.subLibraries || []).find((s) => s.uuid === uuid);
      if (sl && sl.doubanEnabled) {
        syncDoubanForSubLibrary(sl).catch((e) => console.error('[mediaLibrary] timer douban error:', e));
      }
    }, 21600000);
  }

  subLibraryTimers.set(uuid, timers);
}

function startAllSubLibraryTimers() {
  const cfg = configStore.loadConfig();
  const subLibs = (cfg.subLibraries || []).filter((sl) => sl.enabled !== false);

  if (startupRefreshTimer) {
    clearTimeout(startupRefreshTimer);
    startupRefreshTimer = null;
  }

  for (const sl of subLibs) {
    startSubLibraryTimers(sl);
  }

  const startSelfCompute = () => {
    startSelfComputeTimer(600000, {
      runImmediately: cfg.mediaLibrarySelfComputeOnStartup !== false,
    });
  };

  if (cfg.mediaLibraryStartupRefreshOnStartup === false) {
    console.log('[mediaLibrary] startup refresh disabled by config');
    startSelfCompute();
    return;
  }

  const delaySeconds = Math.max(0, Number(cfg.mediaLibraryStartupRefreshDelaySeconds) || 0);
  console.log(`[mediaLibrary] startup refresh scheduled in ${delaySeconds}s`);
  startupRefreshTimer = setTimeout(() => {
    startupRefreshTimer = null;
    const currentCfg = configStore.loadConfig();
    if (currentCfg.mediaLibraryStartupRefreshOnStartup === false) {
      console.log('[mediaLibrary] startup refresh skipped by config');
      startSelfCompute();
      return;
    }

    // Refresh all subLibraries first, then start self-computation once data is in.
    // Self-compute needs bitrate/duration from the freshly fetched items to derive
    // equivalentBitrate — running it before refresh completes produces all-zeroes.
    const refreshes = subLibs.map((sl) =>
      refreshSubLibrary(sl).catch((e) => console.error('[mediaLibrary] startup refresh error:', e))
    );
    Promise.all(refreshes).then(startSelfCompute);
  }, delaySeconds * 1000);
  startupRefreshTimer.unref && startupRefreshTimer.unref();
}

function stopAllTimers() {
  if (startupRefreshTimer) {
    clearTimeout(startupRefreshTimer);
    startupRefreshTimer = null;
  }
  for (const uuid of subLibraryTimers.keys()) {
    stopSubLibraryTimers(uuid);
  }
  stopSelfComputeTimer();
}

async function triggerRefresh(subLibraryId) {
  const cfg = configStore.loadConfig();
  const sl = (cfg.subLibraries || []).find((s) => s.uuid === subLibraryId);
  if (!sl) throw new Error('SubLibrary not found');
  await refreshSubLibrary(sl);
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
  upsertItems,
  updateUserRating,
  saveLibrary,
  getLibraryStatus,

  // SubLibrary CRUD
  addSubLibrary,
  deleteSubLibrary,
  updateSubLibrary,

  // Self-computed fields
  recomputeAllSelfFields,
  startSelfComputeTimer,
  stopSelfComputeTimer,

  // Timer management
  startAllSubLibraryTimers,
  stopAllTimers,
  startSubLibraryTimers,
  stopSubLibraryTimers,

  // Manual triggers
  triggerRefresh,
  triggerDoubanSync,

  getHealth,
};

function getHealth(config) {
  const subLibs = (config && config.subLibraries) || [];
  const enabled = subLibs.filter((sl) => sl.enabled !== false);
  const totalSubLibraries = subLibs.length;
  const enabledCount = enabled.length;

  if (enabledCount === 0) {
    return { status: 'green', totalSubLibraries, enabledCount: 0, staleSubLibraries: [] };
  }

  const refreshIntervalMin = (config && config.defaultRefreshIntervalMinutes) || 60;
  const graceMs = refreshIntervalMin * 2 * 60 * 1000;
  const now = Date.now();

  const staleSubLibraries = [];
  for (const sl of enabled) {
    const lastRefreshed = sl.lastRefreshedAt ? new Date(sl.lastRefreshedAt).getTime() : 0;
    if (now - lastRefreshed > graceMs) {
      staleSubLibraries.push(sl.name || sl.uuid);
    }
  }

  if (staleSubLibraries.length === enabledCount) {
    // Check if library.json is readable
    try {
      loadLibrary();
    } catch (_) {
      return { status: 'red', totalSubLibraries, enabledCount, staleSubLibraries };
    }
    return { status: 'red', totalSubLibraries, enabledCount, staleSubLibraries };
  }

  if (staleSubLibraries.length > 0) {
    return { status: 'yellow', totalSubLibraries, enabledCount, staleSubLibraries };
  }

  return { status: 'green', totalSubLibraries, enabledCount, staleSubLibraries: [] };
}
