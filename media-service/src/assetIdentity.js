'use strict';

const path = require('path');

const MEDIA_EXTS = new Set([
  '.mkv', '.mp4', '.m4v', '.avi', '.mov', '.wmv', '.ts', '.m2ts', '.iso',
  '.mpg', '.mpeg', '.webm', '.flv', '.rmvb',
]);

function normalizeMediaPath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '')
    .trim()
    .toLowerCase();
}

function stripKnownMediaExtension(value) {
  const p = normalizeMediaPath(value);
  if (!p) return '';
  const ext = path.posix.extname(p);
  if (MEDIA_EXTS.has(ext)) return p.slice(0, -ext.length);
  return p;
}

function inferAssetRootPath(rawPath, isDiscLike) {
  const p = normalizeMediaPath(rawPath);
  if (!p) return '';

  const parts = p.split('/');
  const last = parts[parts.length - 1];
  if (last === 'bdmv' || last === 'video_ts') {
    return parts.slice(0, -1).join('/');
  }
  if (isDiscLike) return p;
  return p;
}

function computeAssetKey(item, subLibraryId) {
  const type = String(item && item.type || '').toLowerCase();
  if (type === 'season') {
    const sid = item.seriesId || item.parentId || '';
    const sn = item.seasonNumber != null ? item.seasonNumber : item.indexNumber;
    if (sid && sn != null) return `${subLibraryId}:season:${String(sid).toLowerCase()}:s${sn}`;
    if (item.seriesName && sn != null) return `${subLibraryId}:season:${String(item.seriesName).toLowerCase()}:s${sn}`;
  }

  const root = inferAssetRootPath(item && item.path, item && item.isDiscLike);
  if (root) return `${subLibraryId}:path:${stripKnownMediaExtension(root)}`;

  const tmdbId = item && item.tmdbId;
  if (tmdbId) return `${subLibraryId}:tmdb:${String(tmdbId).toLowerCase()}`;

  const name = normalizeTitle(item && item.name);
  const year = extractYear(item && item.premiereDate);
  if (name && year) return `${subLibraryId}:title:${name}:${year}`;
  return '';
}

function normalizeTitle(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function extractYear(value) {
  const m = String(value || '').match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : '';
}

function getEmbyItemId(item) {
  return (
    item &&
    item.externalRefs &&
    item.externalRefs.emby &&
    item.externalRefs.emby.itemId
  ) || (item && item.source === 'emby' ? item.sourceId : '') || '';
}

function ensureIdentityFields(item, subLib, now) {
  const subLibraryId = item.subLibraryId || (subLib && subLib.uuid) || '';
  const embyId = getEmbyItemId(item) || item.sourceId || item.itemId || '';
  const assetKey = item.assetKey || computeAssetKey(item, subLibraryId);
  const assetRootPath = item.assetRootPath || inferAssetRootPath(item.path, item.isDiscLike);
  const externalRefs = { ...(item.externalRefs || {}) };
  if (item.source === 'emby' || embyId) {
    externalRefs.emby = {
      ...(externalRefs.emby || {}),
      serverId: (subLib && subLib.embyServerId) || (externalRefs.emby && externalRefs.emby.serverId) || '',
      itemId: embyId,
      sourceId: embyId,
      lastSeenAt: (externalRefs.emby && externalRefs.emby.lastSeenAt) || now || null,
    };
  }
  return { assetKey, assetRootPath, externalRefs };
}

function findExistingItemIndex(items, incoming, subLib, subLibraryId) {
  const embyId = incoming.sourceId || incoming.itemId || '';
  if (embyId) {
    const idx = items.findIndex((it) =>
      it.subLibraryId === subLibraryId &&
      (
        getEmbyItemId(it) === embyId ||
        (it.source === 'emby' && it.sourceId === embyId)
      )
    );
    if (idx >= 0) return idx;
  }

  const assetKey = computeAssetKey(incoming, subLibraryId);
  if (assetKey) {
    const idx = items.findIndex((it) => it.subLibraryId === subLibraryId && it.assetKey === assetKey);
    if (idx >= 0) return idx;
  }

  if (incoming.tmdbId) {
    const matches = items
      .map((it, idx) => ({ it, idx }))
      .filter(({ it }) =>
        it.subLibraryId === subLibraryId &&
        it.tmdbId != null &&
        String(it.tmdbId) === String(incoming.tmdbId) &&
        String(it.type || '').toLowerCase() === String(incoming.type || '').toLowerCase()
      );
    if (matches.length === 1) return matches[0].idx;
  }

  return -1;
}

function makeExternalEmbyRef(incoming, subLib, now) {
  const embyId = incoming.sourceId || incoming.itemId || '';
  return {
    serverId: (subLib && subLib.embyServerId) || '',
    itemId: embyId,
    sourceId: embyId,
    lastSeenAt: now,
  };
}

module.exports = {
  computeAssetKey,
  ensureIdentityFields,
  findExistingItemIndex,
  getEmbyItemId,
  inferAssetRootPath,
  makeExternalEmbyRef,
  normalizeMediaPath,
  stripKnownMediaExtension,
};
