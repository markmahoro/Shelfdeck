'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(DATA_DIR, 'cache.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadCache() {
  ensureDataDir();
  if (!fs.existsSync(CACHE_FILE)) {
    return {
      libraryItems: [],
      libraryCachedAt: null,
      doubanRatings: [],
      doubanSyncedAt: null,
    };
  }
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
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
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
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
