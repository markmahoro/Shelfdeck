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
const mediaPolicyService = require('./mediaPolicyService');
const doubanMatchService = require('./doubanMatchService');
const embyService = require('./services/embyService');
const doubanService = require('./services/doubanService');

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

function ensureDataDir() {
  const dir = resolveDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function generateUuid() {
  return crypto.randomUUID();
}

// ── Library file persistence ────────────────────────────────────────────────

function loadLibrary() {
  ensureDataDir();
  const f = libraryFilePath();
  if (!fs.existsSync(f)) {
    return { version: 1, items: [], cachedAt: null };
  }
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (err) {
    console.error('[mediaLibrary] failed to load library:', err.message);
    return { version: 1, items: [], cachedAt: null };
  }
}

function saveLibrary(lib) {
  ensureDataDir();
  fs.writeFileSync(libraryFilePath(), JSON.stringify(lib, null, 2), 'utf8');
}

// ── Item operations ─────────────────────────────────────────────────────────

function upsertItems(subLibraryId, incomingItems) {
  const lib = loadLibrary();
  const now = new Date().toISOString();
  let upserted = 0;
  let changedItemIds = [];

  for (const incoming of incomingItems) {
    const existingIdx = lib.items.findIndex(
      (it) => it.sourceId === incoming.sourceId && it.subLibraryId === subLibraryId,
    );
    if (existingIdx >= 0) {
      const existing = lib.items[existingIdx];
      const merged = {
        ...existing,
        name: incoming.name || existing.name,
        path: incoming.path || existing.path,
        type: incoming.type || existing.type,
        bitrate: incoming.bitrate != null ? incoming.bitrate : existing.bitrate,
        duration: incoming.duration != null ? incoming.duration : existing.duration,
        resolution: incoming.resolution || existing.resolution,
        size: incoming.size != null ? incoming.size : existing.size,
        premiereDate: incoming.premiereDate || existing.premiereDate,
        genres: incoming.genres || existing.genres,
        isDiscLike: incoming.isDiscLike != null ? incoming.isDiscLike : existing.isDiscLike,
        lastRefreshedAt: now,
      };
      // Diff detection
      if (
        merged.bitrate !== existing.bitrate ||
        merged.size !== existing.size ||
        merged.duration !== existing.duration ||
        merged.resolution !== existing.resolution ||
        merged.doubanRating !== existing.doubanRating ||
        merged.userRating !== existing.userRating
      ) {
        changedItemIds.push(merged.itemId);
      }
      lib.items[existingIdx] = merged;
      upserted++;
    } else {
      const itemId = incoming.itemId || incoming.sourceId;
      const newItem = {
        itemId,
        subLibraryId,
        name: incoming.name || '',
        path: incoming.path || '',
        source: 'emby',
        sourceId: incoming.sourceId || itemId,
        type: incoming.type || 'movie',
        bitrate: incoming.bitrate || 0,
        duration: incoming.duration || 0,
        resolution: incoming.resolution || '',
        size: incoming.size || 0,
        premiereDate: incoming.premiereDate || null,
        genres: incoming.genres || [],
        isDiscLike: incoming.isDiscLike || false,
        doubanId: null,
        doubanRating: null,
        doubanSyncedAt: null,
        userRating: null,
        userRatingUpdatedAt: null,
        lastRefreshedAt: now,
        action: 'keep',
        reason: '新入库',
      };
      lib.items.push(newItem);
      changedItemIds.push(newItem.itemId);
      upserted++;
    }
  }

  // Remove items that no longer exist in Emby (orphan cleanup)
  const incomingIds = new Set(incomingItems.map((it) => it.sourceId || it.itemId));
  const removed = lib.items.filter(
    (it) => it.subLibraryId === subLibraryId && it.source === 'emby' && !incomingIds.has(it.sourceId),
  );
  lib.items = lib.items.filter(
    (it) => !(it.subLibraryId === subLibraryId && it.source === 'emby' && !incomingIds.has(it.sourceId)),
  );

  // Recalculate strategy for changed items
  const cfg = configStore.loadConfig();
  const subLib = (cfg.subLibraries || []).find((s) => s.uuid === subLibraryId);
  const policy = subLib && subLib.mediaPolicy ? subLib.mediaPolicy : cfg.mediaPolicy;

  for (const itemId of changedItemIds) {
    const item = lib.items.find((it) => it.itemId === itemId);
    if (item && policy) {
      const { action, reason } = mediaPolicyService.recommendedAction(item, policy);
      item.action = action;
      item.reason = reason;
    }
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
  if (userRating < 1 || userRating > 5) throw new Error('Rating must be 1-5');
  const lib = loadLibrary();
  const item = lib.items.find((it) => it.itemId === itemId);
  if (!item) throw new Error('Item not found');

  item.userRating = userRating;
  item.userRatingUpdatedAt = new Date().toISOString();

  // Recalculate strategy
  const cfg = configStore.loadConfig();
  const subLib = (cfg.subLibraries || []).find((s) => s.uuid === item.subLibraryId);
  const policy = subLib && subLib.mediaPolicy ? subLib.mediaPolicy : cfg.mediaPolicy;
  if (policy) {
    const { action, reason } = mediaPolicyService.recommendedAction(item, policy);
    item.action = action;
    item.reason = reason;
  }

  saveLibrary(lib);
  return item;
}

function getLibrary(filter = {}) {
  const lib = loadLibrary();
  let items = lib.items;
  if (filter.source) items = items.filter((it) => it.source === filter.source);
  if (filter.type) items = items.filter((it) => it.type === filter.type);
  if (filter.action) items = items.filter((it) => it.action === filter.action);
  if (filter.subLibraryId) items = items.filter((it) => it.subLibraryId === filter.subLibraryId);
  return { items, total: items.length };
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
    })),
  };
}

// ── SubLibrary CRUD ─────────────────────────────────────────────────────────

function addSubLibrary(spec) {
  const cfg = configStore.loadConfig();
  const uuid = generateUuid();
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
    mediaPolicy: spec.mediaPolicy || {
      target1080p: { '2': 2, '3': 4, '4': 7, '5': 12 },
      target4k: { '2': 5, '3': 10, '4': 16, '5': 25 },
    },
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
  subLibs[idx] = { ...subLibs[idx], ...updates };
  configStore.saveConfig(cfg);
  return subLibs[idx];
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
  try {
    const cfg = configStore.loadConfig();
    const server = (cfg.embyServers || {})[subLib.embyServerId];
    if (!server || !server.baseUrl) {
      console.log('[mediaLibrary] skip refresh: no server config for', subLib.uuid);
      return;
    }
    const items = await embyService.getLibraryItems(server, subLib.sectionId);
    upsertItems(subLib.uuid, items);
    console.log('[mediaLibrary] refreshed', subLib.uuid, 'items:', items.length);
  } catch (e) {
    console.error('[mediaLibrary] refresh error for', subLib.uuid, e.message);
  }
}

async function syncDoubanForSubLibrary(subLib) {
  try {
    const doubanCfg = configStore.loadConfig().douban || {};
    if (!doubanCfg.userId) {
      console.log('[mediaLibrary] skip douban sync: no userId for', subLib.uuid);
      return;
    }

    // Fetch douban ratings
    const session = doubanService.getSession();
    if (!session.userId) return;

    const { entries } = await doubanService.fetchRatings(null);
    if (!entries || entries.length === 0) return;

    const byNormTitle = doubanMatchService.buildDoubanStarsByNormalizedTitle(entries);

    // Match against library items for this subLibrary
    const lib = loadLibrary();
    let changed = false;
    const now = new Date().toISOString();

    for (const item of lib.items) {
      if (item.subLibraryId !== subLib.uuid) continue;
      if (item.type !== 'movie') continue;

      const stars = doubanMatchService.movieDoubanStars(item.name, 'Movie', byNormTitle);
      if (stars !== null && item.doubanRating !== stars) {
        item.doubanRating = stars;
        item.doubanSyncedAt = now;
        changed = true;

        // Find matching douban entry for doubanId
        const matchedEntry = entries.find((e) => {
          const keys = doubanMatchService.doubanTitleNormalizedKeys(e.title);
          const embyKeys = doubanMatchService.embyTitleNormalizedKeys(item.name);
          return embyKeys.some((ek) => keys.includes(ek));
        });
        if (matchedEntry) item.doubanId = matchedEntry.subjectId;

        // Recalculate strategy
        const cfg = configStore.loadConfig();
        const sl = (cfg.subLibraries || []).find((s) => s.uuid === item.subLibraryId);
        const policy = sl && sl.mediaPolicy ? sl.mediaPolicy : cfg.mediaPolicy;
        if (policy) {
          const { action, reason } = mediaPolicyService.recommendedAction(item, policy);
          item.action = action;
          item.reason = reason;
        }
      }
    }

    if (changed) {
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

    console.log('[mediaLibrary] douban synced for', subLib.uuid);
  } catch (e) {
    console.error('[mediaLibrary] douban sync error for', subLib.uuid, e.message);
  }
}

function startSubLibraryTimers(subLib) {
  const uuid = subLib.uuid;
  stopSubLibraryTimers(uuid);

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
  for (const sl of cfg.subLibraries || []) {
    if (sl.enabled !== false) {
      startSubLibraryTimers(sl);
    }
  }
}

function stopAllTimers() {
  for (const uuid of subLibraryTimers.keys()) {
    stopSubLibraryTimers(uuid);
  }
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
  getLibrary,
  getLibraryItem,
  upsertItems,
  updateUserRating,
  getLibraryStatus,

  // SubLibrary CRUD
  addSubLibrary,
  deleteSubLibrary,
  updateSubLibrary,

  // Timer management
  startAllSubLibraryTimers,
  stopAllTimers,
  startSubLibraryTimers,
  stopSubLibraryTimers,

  // Manual triggers
  triggerRefresh,
  triggerDoubanSync,
};
