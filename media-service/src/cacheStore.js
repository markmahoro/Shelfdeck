'use strict';

const fs = require('fs');
const path = require('path');

function resolveDataDir() {
  return (
    process.env.CONTROL_PLANE_DATA_DIR ||
    process.env.MEDIA_SERVICE_DATA_DIR ||
    path.join(__dirname, '..', 'data')
  );
}

function DATA_DIR() {
  return resolveDataDir();
}

function CACHE_FILE() {
  return path.join(DATA_DIR(), 'cache.json');
}

function ensureDataDir() {
  const dir = DATA_DIR();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadCache() {
  ensureDataDir();
  const cfile = CACHE_FILE();
  if (!fs.existsSync(cfile)) {
    return {
      libraryItems: [],
      libraryCachedAt: null,
      doubanRatings: [],
      doubanSyncedAt: null,
    };
  }
  try {
    const raw = fs.readFileSync(cfile, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to load cache:', err.message);
    return {
      libraryItems: [],
      libraryCachedAt: null,
      doubanRatings: [],
      doubanSyncedAt: null,
    };
  }
}

function saveCache(cache) {
  ensureDataDir();
  fs.writeFileSync(CACHE_FILE(), JSON.stringify(cache, null, 2), 'utf8');
}

function getLibraryCache() {
  const cache = loadCache();
  return {
    items: cache.libraryItems || [],
    cachedAt: cache.libraryCachedAt,
  };
}

function setLibraryCache(items) {
  const cache = loadCache();
  cache.libraryItems = items;
  cache.libraryCachedAt = new Date().toISOString();
  saveCache(cache);
  return {
    items: cache.libraryItems,
    cachedAt: cache.libraryCachedAt,
  };
}

function getDoubanCache() {
  const cache = loadCache();
  return {
    entries: cache.doubanRatings || [],
    syncedAt: cache.doubanSyncedAt,
  };
}

function setDoubanCache(entries) {
  const cache = loadCache();
  cache.doubanRatings = entries;
  cache.doubanSyncedAt = new Date().toISOString();
  saveCache(cache);
  return {
    entries: cache.doubanRatings,
    syncedAt: cache.doubanSyncedAt,
  };
}

module.exports = {
  getLibraryCache,
  setLibraryCache,
  getDoubanCache,
  setDoubanCache,
};
