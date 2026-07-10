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
  if (!ct.includes('application/json')) {
    log('embyFetchJson: non-JSON response for', relativePath, 'content-type:', ct);
    return null;
  }
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

/**
 * Authenticate with Emby using username+password (no API key needed).
 * Returns an access token that can be used as apiKey for all subsequent calls.
 */
async function authenticateByUsername(baseUrl, username, password) {
  const u = new URL('Users/AuthenticateByName', baseUrl.replace(/\/+$/, '') + '/');
  const res = await fetch(u.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Emby-Authorization': `MediaBrowser Client="ShelfDeck", Device="Windows", DeviceId="shelfdeck-setup", Version="1.0.0"`,
    },
    body: JSON.stringify({ Username: username, Pw: password }),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`Emby login failed (${res.status}): ${text.slice(0, 200) || res.statusText}`);
  }
  let data;
  try { data = JSON.parse(text); } catch {
    throw new Error('Emby login response not JSON');
  }
  const tok = data.AccessToken || data.accessToken;
  if (!tok || !String(tok).trim()) throw new Error('No AccessToken in login response');
  const userId = (data.User && (data.User.Id || data.User.id)) || '';
  return { token: String(tok).trim(), userId: String(userId).trim() };
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
  return items.map((x) => ({ id: x.Id, name: x.Name || x.Id, collectionType: x.CollectionType || '' })).filter((x) => x.id);
}

const ITEM_FIELDS =
  'BasicSyncInfo,RunTimeTicks,ImageTags,Type,MediaType,Path,VideoType,IsoType,SeriesName,SeriesId,ParentIndexNumber,IndexNumber,ParentId,ProviderIds,People,Genres,MediaSources,UserData';

async function getLibraryItemsPage(serverConfig, sectionId, options = {}) {
  const userId = String(serverConfig.userId || '').trim();
  if (!userId) throw new Error('Emby userId not configured');
  const startIndex = Math.max(0, Number(options.startIndex) || 0);
  const limit = Math.max(1, Math.min(500, Number(options.limit) || 100));
  const uid = encodeURIComponent(userId);
  const data = await embyFetchJson(serverConfig, `Users/${uid}/Items`, {}, {
    ParentId: sectionId,
    Recursive: 'true',
    IncludeItemTypes: 'Movie,Series,Season,Episode',
    Fields: ITEM_FIELDS,
    SortBy: 'SortName',
    SortOrder: 'Ascending',
    Limit: String(limit),
    StartIndex: String(startIndex),
  });
  const rawItems = data && Array.isArray(data.Items) ? data.Items : [];
  const total = Number(data && data.TotalRecordCount) || 0;
  const nextIndex = startIndex + rawItems.length;
  return {
    items: rawItems.map(extractItemFields),
    startIndex,
    nextIndex,
    total,
    done: rawItems.length === 0 || nextIndex >= total,
  };
}

async function getLibraryItems(serverConfig, sectionId) {
  const userId = String(serverConfig.userId || '').trim();
  if (!userId) throw new Error('Emby userId not configured');
  const uid = encodeURIComponent(userId);
  const PAGE_SIZE = 2000;

  const allItems = [];
  let startIndex = 0;
  let totalCount = null;

  while (totalCount === null || startIndex < totalCount) {
    const query = {
      ParentId: sectionId,
      Recursive: 'true',
      IncludeItemTypes: 'Movie,Series,Season,Episode',
      Fields: ITEM_FIELDS,
      SortBy: 'SortName',
      SortOrder: 'Ascending',
      Limit: String(PAGE_SIZE),
      StartIndex: String(startIndex),
    };
    const data = await embyFetchJson(serverConfig, `Users/${uid}/Items`, {}, query);
    if (totalCount === null) totalCount = data && data.TotalRecordCount || 0;
    const pageItems = data && Array.isArray(data.Items) ? data.Items : [];
    for (const item of pageItems) {
      allItems.push(extractItemFields(item));
    }
    if (pageItems.length === 0) break;
    startIndex += PAGE_SIZE;
  }

  return allItems;
}

async function getItemById(serverConfig, itemId) {
  const uid = encodeURIComponent((serverConfig.userId || '').trim());
  const iid = encodeURIComponent(itemId);
  const data = await embyFetchJson(serverConfig, `Users/${uid}/Items/${iid}`, {});
  return extractItemFields(data);
}

async function getSeasonEpisodes(serverConfig, seasonId) {
  const userId = String(serverConfig.userId || '').trim();
  if (!userId) throw new Error('Emby userId not configured');
  const uid = encodeURIComponent(userId);
  const query = {
    ParentId: seasonId,
    Recursive: 'true',
    IncludeItemTypes: 'Episode',
    Fields: ITEM_FIELDS,
    SortBy: 'SortName',
    SortOrder: 'Ascending',
  };
  const data = await embyFetchJson(serverConfig, `Users/${uid}/Items`, {}, query);
  const items = data && Array.isArray(data.Items) ? data.Items : [];
  return items.map((item) => extractItemFields(item));
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

  let audioCodecs = [];
  if (src.MediaStreams) {
    const video = src.MediaStreams.find((s) => s && s.Type === 'Video');
    if (video) {
      width = video.Width || 0;
      height = video.Height || 0;
      codec = normalizeVideoCodec(video.Codec);
    }
    audioCodecs = [];
    const audioStreams = src.MediaStreams.filter((s) => s && s.Type === 'Audio');
    for (const s of audioStreams) {
      const c = String(s.Codec || '').toLowerCase();
      if (c) audioCodecs.push(c);
      // Also capture audio quality markers from DisplayTitle (e.g. "DDP5.1 Atmos")
      const title = String(s.DisplayTitle || '');
      for (const q of ['atmos', 'dts', 'truehd']) {
        if (title.toLowerCase().includes(q)) audioCodecs.push(q);
      }
    }
    // Deduplicate
    audioCodecs = [...new Set(audioCodecs)];
  }

  const resolution = height >= 2000 || width >= 3800 ? `${width}x${height}` : `${width}x${height}`;

  return {
    itemId: item.Id,
    name: item.Name || item.Id,
    path: item.Path || src.Path || '',
    type: (() => { const m = { Movie: 'movie', Series: 'series', Season: 'season', Episode: 'episode' }; return m[item.Type] || 'other'; })(),
    sourceId: item.Id,
    bitrate: typeof bitrate === 'number' ? bitrate : 0,
    duration,
    resolution: width && height ? `${width}x${height}` : '',
    size: typeof size === 'number' ? size : 0,
    premiereDate: item.PremiereDate || null,
    genres: Array.isArray(item.Genres) ? item.Genres : [],
    isDiscLike: inferIsDiscLike(item),
    codec,
    audioCodecs,
    watched: !!(item.UserData && item.UserData.Played),
    playCount: item.UserData && typeof item.UserData.PlayCount === 'number' ? item.UserData.PlayCount : null,
    lastPlayedAt: item.UserData && item.UserData.LastPlayedDate ? item.UserData.LastPlayedDate : null,
    favorite: item.UserData && typeof item.UserData.IsFavorite === 'boolean' ? item.UserData.IsFavorite : null,
    seriesName: item.SeriesName || null,
    seriesId: item.SeriesId || null,
    parentIndexNumber: typeof item.ParentIndexNumber === 'number' ? item.ParentIndexNumber : null,
    indexNumber: typeof item.IndexNumber === 'number' ? item.IndexNumber : null,
    parentId: item.ParentId || null,
    providerIds: item.ProviderIds || {},
    tmdbId: (item.ProviderIds && item.ProviderIds.Tmdb) || null,
    people: (Array.isArray(item.People) ? item.People : [])
      .filter((person) => String(person.Type || '').toLowerCase() === 'actor')
      .map((person) => ({
        name: person.Name || '',
        role: 'actor',
        embyPersonId: person.Id || '',
        providerIds: person.ProviderIds || {},
      }))
      .filter((person) => person.name),
  };
}

// ── Disc-like source detection ────────────────────────────────────────────────

function normalizeToken(raw) {
  return String(raw || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function pathLooksDiscLike(raw) {
  const s = String(raw || '').trim();
  if (!s) return false;
  const n = s.replace(/\\/g, '/').toLowerCase();
  if (/\.iso($|[?#])/.test(n)) return true;
  const parts = n.split('/').filter(Boolean);
  return parts.includes('bdmv') || parts.includes('video_ts');
}

function explicitDiscContainer(raw) {
  const v = normalizeToken(raw);
  return v === 'iso' || v === 'bluray' || v === 'bluraydisc' || v === 'bdmv' || v === 'dvd';
}

function explicitDiscVideoType(raw) {
  const v = normalizeToken(raw);
  return v === 'iso' || v === 'bluray' || v === 'dvd';
}

function itemDiscValues(item) {
  const values = [item.VideoType, item.videoType, item.IsoType, item.isoType, item.Container, item.container];
  for (const src of Array.isArray(item.MediaSources) ? item.MediaSources : []) {
    values.push(src.VideoType, src.videoType, src.IsoType, src.isoType, src.Container, src.container, src.Protocol, src.protocol);
  }
  return values;
}

function itemDiscPaths(item) {
  const paths = [item.Path];
  for (const src of Array.isArray(item.MediaSources) ? item.MediaSources : []) {
    paths.push(src.Path, src.path);
  }
  return paths.filter((p) => typeof p === 'string' && p.trim());
}

function inferIsDiscLike(item) {
  for (const value of itemDiscValues(item)) {
    if (explicitDiscContainer(value) || explicitDiscVideoType(value)) return true;
  }

  for (const p of itemDiscPaths(item)) {
    if (pathLooksDiscLike(p)) return true;
  }

  // Check disk only when the path is accessible in the current runtime.
  for (const p of itemDiscPaths(item)) {
    try {
      const dir = pathToFilesystemDir(p);
      if (dir && (isDirectorySync(path.join(dir, 'BDMV')) || isDirectorySync(path.join(dir, 'VIDEO_TS')))) return true;
    } catch (_) {}
  }

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

// ── Played / Unplayed ──────────────────────────────────────────────────────

async function markPlayed(serverConfig, itemId) {
  const userId = String(serverConfig.userId || '').trim();
  if (!userId) throw new Error('Emby userId not configured');
  const uid = encodeURIComponent(userId);
  const iid = encodeURIComponent(itemId);
  await embyFetchOk(serverConfig, `Users/${uid}/PlayedItems/${iid}`, { method: 'POST' });
}

async function markUnplayed(serverConfig, itemId) {
  const userId = String(serverConfig.userId || '').trim();
  if (!userId) throw new Error('Emby userId not configured');
  const uid = encodeURIComponent(userId);
  const iid = encodeURIComponent(itemId);
  await embyFetchOk(serverConfig, `Users/${uid}/PlayedItems/${iid}`, { method: 'DELETE' });
}

async function getItem(serverConfig, itemId) {
  const userId = String(serverConfig.userId || '').trim();
  if (!userId) throw new Error('Emby userId not configured');
  const uid = encodeURIComponent(userId);
  const iid = encodeURIComponent(itemId);
  const data = await embyFetchJson(serverConfig, `Users/${uid}/Items/${iid}`, {}, { Fields: ITEM_FIELDS });
  return extractItemFields(data);
}

async function getPlayedItems(serverConfig, filters = {}) {
  const userId = String(serverConfig.userId || '').trim();
  if (!userId) throw new Error('Emby userId not configured');
  const uid = encodeURIComponent(userId);

  const query = {
    Recursive: 'true',
    IncludeItemTypes: 'Movie,Series,Season,Episode',
    Filters: 'IsPlayed',
    Fields: 'DatePlayed,MediaSources,Overview',
    SortBy: 'DatePlayed',
    SortOrder: 'Descending',
    Limit: '2000',
  };
  if (filters.sectionId) query.ParentId = filters.sectionId;

  const data = await embyFetchJson(serverConfig, `Users/${uid}/Items`, {}, query);
  let items = (data && Array.isArray(data.Items) ? data.Items : []).map((item) => ({
    id: item.Id,
    name: item.Name || item.Id,
    type: item.Type === 'Movie' ? 'Movie' : item.Type === 'Episode' ? 'Episode' : 'Other',
    datePlayed: item.UserData && item.UserData.LastPlayedDate
      ? item.UserData.LastPlayedDate
      : null,
    sectionId: item.ParentId || '',
    sectionName: '',
    posterTag: (item.ImageTags && item.ImageTags.Primary) || '',
    seriesName: item.SeriesName || undefined,
    indexLabel:
      item.Type === 'Episode' && item.ParentIndexNumber && item.IndexNumber
        ? `S${String(item.ParentIndexNumber).padStart(2, '0')}E${String(item.IndexNumber).padStart(2, '0')}`
        : undefined,
    posterUrl: `${normalizeBaseUrl(serverConfig.baseUrl)}/Items/${item.Id}/Images/Primary?api_key=${(serverConfig.apiKey || '').trim()}`,
    embyWebUrl: `${normalizeBaseUrl(serverConfig.baseUrl)}/web/index.html#!/item?id=${item.Id}`,
    path: item.Path || '',
  }));

  // Filter by days (service-side, since Emby returns all played)
  if (filters.days && filters.days > 0) {
    const cutoff = Date.now() - filters.days * 24 * 60 * 60 * 1000;
    items = items.filter((it) => it.datePlayed && new Date(it.datePlayed).getTime() > cutoff);
  }

  // Filter by type
  if (filters.type && filters.type !== 'all') {
    items = items.filter((it) => it.type === filters.type);
  }

  // Resolve section names from Emby media folders
  try {
    const folders = await getMediaFolders(serverConfig);
    const folderMap = new Map(folders.map((f) => [f.id, f.name]));
    for (const it of items) {
      if (it.sectionId && folderMap.has(it.sectionId)) {
        it.sectionName = folderMap.get(it.sectionId);
      }
    }
  } catch (_) { /* sectionName stays empty */ }

  return items;
}

async function getUnplayedItems(serverConfig, sectionId) {
  const userId = String(serverConfig.userId || '').trim();
  if (!userId) throw new Error('Emby userId not configured');
  const uid = encodeURIComponent(userId);

  const query = {
    ParentId: sectionId,
    Recursive: 'true',
    IncludeItemTypes: 'Movie,Series,Season,Episode',
    Filters: 'IsUnplayed',
    Fields: ITEM_FIELDS,
    SortBy: 'SortName',
    SortOrder: 'Ascending',
    Limit: '2000',
  };

  const data = await embyFetchJson(serverConfig, `Users/${uid}/Items`, {}, query);
  const items = data && Array.isArray(data.Items) ? data.Items : [];
  return items.map((item) => {
    const extracted = extractItemFields(item);
    const sizeGb = extracted.size > 0 ? extracted.size / (1024 * 1024 * 1024) : 0;
    return {
      id: extracted.itemId,
      name: extracted.name,
      sectionId,
      posterTag: (item.ImageTags && item.ImageTags.Primary) || '',
      runTimeTicks: item.RunTimeTicks || 0,
      durationSec: extracted.duration,
      sizeGb: Math.round(sizeGb * 100) / 100,
      resolution: extracted.resolution
        ? (parseInt(extracted.resolution.split('x')[1], 10) || 0) >= 2160
          ? '4K'
          : '1080p'
        : '1080p',
      codec: extracted.codec || 'h264',
      itemType: item.Type === 'Movie' ? 'Movie' : item.Type === 'Episode' ? 'Episode' : 'Other',
      isBluRayDisc: extracted.isDiscLike,
      embyPlayed: false,
      path: extracted.path,
      posterUrl: `${normalizeBaseUrl(serverConfig.baseUrl)}/Items/${extracted.itemId}/Images/Primary?api_key=${(serverConfig.apiKey || '').trim()}`,
      embyWebUrl: `${normalizeBaseUrl(serverConfig.baseUrl)}/web/index.html#!/item?id=${extracted.itemId}`,
    };
  });
}

module.exports = {
  authenticateByUsername,
  testConnection,
  getUsers,
  getMediaFolders,
  getLibraryItems,
  getLibraryItemsPage,
  getItemById,
  getSeasonEpisodes,
  libraryItemExists,
  getItemDeleteInfo,
  deleteLibraryItem,
  markPlayed,
  markUnplayed,
  getItem,
  getPlayedItems,
  getUnplayedItems,
  _internals: {
    extractItemFields,
    inferIsDiscLike,
    pathLooksDiscLike,
  },
};
