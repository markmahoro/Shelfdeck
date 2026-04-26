'use strict';

/**
 * EmbyAdapter — REST API wrapper for Emby/Jellyfin servers.
 * v2: All functions accept serverConfig (from embyServers["<uuid>"]) for multi-server support.
 *
 * Core interface (EMBY_ADAPTER.md §2):
 *   getLibraryItems(serverConfig, sectionId)
 *   getItemById(serverConfig, itemId)
 *   libraryItemExists(serverConfig, itemId)
 *   deleteLibraryItem(serverConfig, itemId)
 *   getItemDeleteInfo(serverConfig, itemId)
 *   testConnection(serverConfig)
 *   getUsers(serverConfig)
 *   getMediaFolders(serverConfig)
 */

const fs = require('fs');
const path = require('path');

function log(...args) {
  console.log('[emby]', new Date().toISOString(), ...args);
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

function buildUrl(serverConfig, relativePath, extraQuery = {}) {
  const base = normalizeBaseUrl(serverConfig.baseUrl);
  const u = new URL(relativePath.replace(/^\//, ''), `${base}/`);
  u.searchParams.set('api_key', (serverConfig.apiKey || '').trim());
  for (const [k, v] of Object.entries(extraQuery)) {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  }
  return u.toString();
}

async function embyFetchJson(serverConfig, relativePath, options = {}, extraQuery = {}) {
  const url = buildUrl(serverConfig, relativePath, extraQuery);
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      'X-Emby-Token': (serverConfig.apiKey || '').trim(),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Emby request failed (${res.status}): ${text.slice(0, 280) || res.statusText}`);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return null;
  return res.json();
}

async function embyFetchOk(serverConfig, relativePath, options = {}, extraQuery = {}) {
  const url = buildUrl(serverConfig, relativePath, extraQuery);
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      'X-Emby-Token': (serverConfig.apiKey || '').trim(),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Emby request failed (${res.status}): ${text.slice(0, 280) || res.statusText}`);
  }
}

// ── Core Adapter API ──────────────────────────────────────────────────────────

async function testConnection(serverConfig) {
  const data = await embyFetchJson(serverConfig, 'System/Info');
  return {
    serverName: data.ServerName || data.Name,
    version: data.Version || data.PackageVersion || data.SystemVersion,
  };
}

async function getUsers(serverConfig) {
  let data = await embyFetchJson(serverConfig, 'Users/Query').catch(() => null);
  let list = data && Array.isArray(data.Items) ? data.Items : null;
  if (!list) {
    const raw = await embyFetchJson(serverConfig, 'Users');
    list = Array.isArray(raw) ? raw : raw.Items || [];
  }
  return list.map((u) => ({ id: u.Id, name: u.Name || u.Id })).filter((u) => u.id);
}

async function getMediaFolders(serverConfig) {
  const data = await embyFetchJson(serverConfig, 'Library/MediaFolders');
  const items = data && Array.isArray(data.Items) ? data.Items : [];
  return items.map((x) => ({ id: x.Id, name: x.Name || x.Id })).filter((x) => x.id);
}

const ITEM_FIELDS =
  'BasicSyncInfo,RunTimeTicks,ImageTags,Type,MediaType,Path,VideoType,IsoType,SeriesName,SeriesId,ParentIndexNumber,IndexNumber,ParentId,MediaSources,UserData';

async function getLibraryItems(serverConfig, sectionId) {
  let userId = (serverConfig.userId || '').trim();
  if (!userId) {
    const users = await getUsers(serverConfig);
    if (users.length > 0) userId = users[0].id;
  }
  const uid = encodeURIComponent(userId);
  const query = {
    ParentId: sectionId,
    Recursive: 'true',
    IncludeItemTypes: 'Movie,Episode',
    Fields: ITEM_FIELDS,
    SortBy: 'SortName',
    SortOrder: 'Ascending',
    Limit: '2000',
  };
  const data = await embyFetchJson(serverConfig, `Users/${uid}/Items`, {}, query);
  const items = data && Array.isArray(data.Items) ? data.Items : [];
  return items.map((item) => extractItemFields(item));
}

async function getItemById(serverConfig, itemId) {
  const uid = encodeURIComponent((serverConfig.userId || '').trim());
  const iid = encodeURIComponent(itemId);
  const data = await embyFetchJson(serverConfig, `Users/${uid}/Items/${iid}`, {});
  return extractItemFields(data);
}

async function libraryItemExists(serverConfig, itemId) {
  const uid = encodeURIComponent((serverConfig.userId || '').trim());
  const iid = encodeURIComponent(itemId);
  const url = buildUrl(serverConfig, `Users/${uid}/Items/${iid}`, {});
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Emby-Token': (serverConfig.apiKey || '').trim(),
    },
  });
  if (res.status === 404) return false;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Emby query failed (${res.status}): ${text.slice(0, 280) || res.statusText}`);
  }
  return true;
}

async function getItemDeleteInfo(serverConfig, itemId) {
  const userId = String(serverConfig.userId || '').trim();
  const iid = encodeURIComponent(itemId);
  const pw = String(serverConfig.embyUserPassword || '').trim();
  let cfg = serverConfig;
  let extraQuery = userId ? { UserId: userId } : {};
  if (pw) {
    try {
      const accessToken = await authenticateEmbyUserAccessToken(serverConfig);
      cfg = { ...serverConfig, apiKey: accessToken };
      extraQuery = {};
    } catch (e) {
      log('getItemDeleteInfo user auth failed, trying api key fallback', e.message);
    }
  }
  try {
    return await embyFetchJson(cfg, `Items/${iid}/DeleteInfo`, {}, extraQuery);
  } catch (e) {
    log('getItemDeleteInfo optional fail', e.message);
    return null;
  }
}

async function authenticateEmbyUserAccessToken(serverConfig) {
  const pw = String(serverConfig.embyUserPassword || '').trim();
  const userId = String(serverConfig.userId || '').trim();
  if (!pw || !userId) return null;
  const list = await getUsers(serverConfig);
  const row = list.find((u) => u.id === userId);
  const username = row && typeof row.name === 'string' ? row.name.trim() : '';
  if (!username) throw new Error('Cannot resolve username for user ' + userId);
  const url = buildUrl(serverConfig, 'Users/AuthenticateByName', {});
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Emby-Token': (serverConfig.apiKey || '').trim(),
    },
    body: JSON.stringify({ Username: username, Pw: pw }),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`Emby user auth failed (${res.status}): ${text.slice(0, 200) || res.statusText}`);
  }
  let data;
  try { data = JSON.parse(text); } catch {
    throw new Error('Emby auth response not JSON');
  }
  const tok = data.AccessToken || data.accessToken;
  if (!tok || !String(tok).trim()) throw new Error('No AccessToken in auth response');
  return String(tok).trim();
}

async function deleteLibraryItem(serverConfig, itemId) {
  const userId = String(serverConfig.userId || '').trim();
  if (!userId) throw new Error('Emby userId not configured');
  const iid = encodeURIComponent(itemId);
  const pw = String(serverConfig.embyUserPassword || '').trim();
  let cfg = serverConfig;
  let extraQuery = { UserId: userId };
  if (pw) {
    const accessToken = await authenticateEmbyUserAccessToken(serverConfig);
    cfg = { ...serverConfig, apiKey: accessToken };
    extraQuery = {};
  }
  await embyFetchOk(cfg, `Items/${iid}`, { method: 'DELETE' }, extraQuery);
  log('deleteLibraryItem', { itemId, userId, usedUserToken: !!pw });
}

// ── Field extraction ──────────────────────────────────────────────────────────

function normalizeVideoCodec(raw) {
  const c = String(raw || '').toLowerCase();
  if (c === 'hevc' || c.includes('h265') || c === 'h265') return 'h265';
  if (c === 'h264' || c === 'avc' || c.includes('h264')) return 'h264';
  if (c === 'av1') return 'av1';
  return 'h264';
}

function extractItemFields(item) {
  const ticks = typeof item.RunTimeTicks === 'number' ? item.RunTimeTicks : 0;
  const duration = ticks > 0 ? Math.max(1, Math.round(ticks / 10_000_000)) : 0;
  const sources = Array.isArray(item.MediaSources) ? item.MediaSources : [];
  const src = sources[0] || {};

  let bitrate = src.Bitrate || 0;
  let size = src.Size || 0;
  let width = 0;
  let height = 0;
  let codec = 'h264';

  if (src.MediaStreams) {
    const video = src.MediaStreams.find((s) => s && s.Type === 'Video');
    if (video) {
      width = video.Width || 0;
      height = video.Height || 0;
      codec = normalizeVideoCodec(video.Codec);
    }
  }

  const resolution = height >= 2000 || width >= 3800 ? `${width}x${height}` : `${width}x${height}`;

  return {
    itemId: item.Id,
    name: item.Name || item.Id,
    path: item.Path || src.Path || '',
    type: item.Type === 'Episode' ? 'episode' : item.Type === 'Movie' ? 'movie' : 'other',
    sourceId: item.Id,
    bitrate: typeof bitrate === 'number' ? bitrate : 0,
    duration,
    resolution: width && height ? `${width}x${height}` : '',
    size: typeof size === 'number' ? size : 0,
    premiereDate: item.PremiereDate || null,
    genres: Array.isArray(item.Genres) ? item.Genres : [],
    isDiscLike: inferIsBluRayDisc(item),
    codec,
  };
}

// ── BluRay detection ──────────────────────────────────────────────────────────

function inferIsBluRayDisc(item) {
  const path = item.Path || '';
  if (!path) {
    // Check VideoType/IsoType on item
    const isoType = item.IsoType || item.isoType;
    if (isoType === 'BluRay' || isoType === 'Dvd') return true;
    const videoType = item.VideoType || item.videoType;
    if (typeof videoType === 'string') {
      const v = videoType.toLowerCase();
      if (v === 'bluray' || v === 'iso') return true;
    }
  }
  const n = String(path).replace(/\\/g, '/').toLowerCase();
  if (n.endsWith('.iso')) return true;
  if (n.includes('/bdmv/') || n.endsWith('/bdmv')) return true;

  // Check disk for BDMV directory
  try {
    const dir = pathToFilesystemDir(path);
    if (dir) {
      if (isDirectorySync(path.join(dir, 'BDMV'))) return true;
    }
  } catch (_) {}

  return false;
}

function pathToFilesystemDir(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    const st = fs.statSync(s);
    return st.isDirectory() ? s : path.dirname(s);
  } catch { return s; }
}

function isDirectorySync(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

module.exports = {
  testConnection,
  getUsers,
  getMediaFolders,
  getLibraryItems,
  getItemById,
  libraryItemExists,
  getItemDeleteInfo,
  deleteLibraryItem,
};
