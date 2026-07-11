'use strict';

/**
 * EmbyAdapter — REST API wrapper for Emby/Jellyfin servers.
 * v2: All functions accept serverConfig (from embyServers["<uuid>"]) for multi-server support.
 *
 * Core interface (EMBY_ADAPTER.md §2):
 *   getLibrarySubjects(serverConfig, sectionId)
 *   getItemById(serverConfig, subjectId)
 *   libraryItemExists(serverConfig, subjectId)
 *   deleteLibraryItem(serverConfig, subjectId)
 *   getItemDeleteInfo(serverConfig, subjectId)
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

function connectionToken(serverConfig) {
  return String(serverConfig && serverConfig.accessToken || '').trim();
}

function buildUrl(serverConfig, relativePath, extraQuery = {}) {
  const base = normalizeBaseUrl(serverConfig.baseUrl);
  const u = new URL(relativePath.replace(/^\//, ''), `${base}/`);
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
      'X-Emby-Token': connectionToken(serverConfig),
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
      'X-Emby-Token': connectionToken(serverConfig),
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
 * Returns the session access token used for all subsequent calls.
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

async function getLibrarySubjectsPage(serverConfig, sectionId, options = {}) {
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

async function getLibrarySubjects(serverConfig, sectionId) {
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

async function getItemById(serverConfig, subjectId) {
  const uid = encodeURIComponent((serverConfig.userId || '').trim());
  const iid = encodeURIComponent(subjectId);
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

async function libraryItemExists(serverConfig, subjectId) {
  const uid = encodeURIComponent((serverConfig.userId || '').trim());
  const iid = encodeURIComponent(subjectId);
  const url = buildUrl(serverConfig, `Users/${uid}/Items/${iid}`, {});
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Emby-Token': connectionToken(serverConfig),
    },
  });
  if (res.status === 404) return false;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Emby query failed (${res.status}): ${text.slice(0, 280) || res.statusText}`);
  }
  return true;
}

async function getItemDeleteInfo(serverConfig, subjectId) {
  const userId = String(serverConfig.userId || '').trim();
  const iid = encodeURIComponent(subjectId);
  try {
    return await embyFetchJson(serverConfig, `Items/${iid}/DeleteInfo`, {}, userId ? { UserId: userId } : {});
  } catch (e) {
    log('getItemDeleteInfo optional fail', e.message);
    return null;
  }
}

async function deleteLibraryItem(serverConfig, subjectId) {
  const userId = String(serverConfig.userId || '').trim();
  if (!userId) throw new Error('Emby userId not configured');
  const iid = encodeURIComponent(subjectId);
  await embyFetchOk(serverConfig, `Items/${iid}`, { method: 'DELETE' }, { UserId: userId });
  log('deleteLibraryItem', { subjectId, userId });
}

// ── Field extraction ──────────────────────────────────────────────────────────

function normalizeVideoCodec(raw) {
  const c = String(raw || '').toLowerCase();
  if (c === 'hevc' || c.includes('h265') || c === 'h265') return 'h265';
  if (c === 'h264' || c === 'avc' || c.includes('h264')) return 'h264';
  if (c === 'av1') return 'av1';
  return c;
}

function extractItemFields(item) {
  const sources = Array.isArray(item.MediaSources) ? item.MediaSources : [];
  const src = sources[0] || {};
  const ticks = typeof item.RunTimeTicks === 'number' && item.RunTimeTicks > 0
    ? item.RunTimeTicks
    : typeof src.RunTimeTicks === 'number' ? src.RunTimeTicks : 0;
  const duration = ticks > 0 ? Math.max(1, Math.round(ticks / 10_000_000)) : 0;

  const bitrate = Number(src.Bitrate || item.Bitrate) || 0;
  const size = Number(src.Size || item.Size) || 0;
  let width = Number(item.Width) || 0;
  let height = Number(item.Height) || 0;
  let codec = '';

  let audioCodecs = [];
  const mediaStreams = Array.isArray(src.MediaStreams) && src.MediaStreams.length > 0
    ? src.MediaStreams
    : Array.isArray(item.MediaStreams) ? item.MediaStreams : [];
  if (mediaStreams.length > 0) {
    const video = mediaStreams.find((s) => s && s.Type === 'Video');
    if (video) {
      width = Number(video.Width) || width;
      height = Number(video.Height) || height;
      codec = normalizeVideoCodec(video.Codec);
    }
    audioCodecs = [];
    const audioStreams = mediaStreams.filter((s) => s && s.Type === 'Audio');
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

  return {
    subjectId: item.Id,
    name: item.Name || item.Id,
    path: item.Path || src.Path || '',
    type: (() => { const m = { Movie: 'movie', Series: 'series', Season: 'season', Episode: 'episode' }; return m[item.Type] || 'other'; })(),
    sourceId: item.Id,
    bitrate,
    duration,
    resolution: width && height ? `${width}x${height}` : '',
    size,
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

async function markPlayed(serverConfig, subjectId) {
  const userId = String(serverConfig.userId || '').trim();
  if (!userId) throw new Error('Emby userId not configured');
  const uid = encodeURIComponent(userId);
  const iid = encodeURIComponent(subjectId);
  await embyFetchOk(serverConfig, `Users/${uid}/PlayedItems/${iid}`, { method: 'POST' });
}

async function markUnplayed(serverConfig, subjectId) {
  const userId = String(serverConfig.userId || '').trim();
  if (!userId) throw new Error('Emby userId not configured');
  const uid = encodeURIComponent(userId);
  const iid = encodeURIComponent(subjectId);
  await embyFetchOk(serverConfig, `Users/${uid}/PlayedItems/${iid}`, { method: 'DELETE' });
}

async function getItem(serverConfig, subjectId) {
  const userId = String(serverConfig.userId || '').trim();
  if (!userId) throw new Error('Emby userId not configured');
  const uid = encodeURIComponent(userId);
  const iid = encodeURIComponent(subjectId);
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
    posterUrl: `${normalizeBaseUrl(serverConfig.baseUrl)}/Items/${item.Id}/Images/Primary`,
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
      id: extracted.subjectId,
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
      posterUrl: `${normalizeBaseUrl(serverConfig.baseUrl)}/Items/${extracted.subjectId}/Images/Primary`,
      embyWebUrl: `${normalizeBaseUrl(serverConfig.baseUrl)}/web/index.html#!/item?id=${extracted.subjectId}`,
    };
  });
}

module.exports = {
  authenticateByUsername,
  testConnection,
  getUsers,
  getMediaFolders,
  getLibrarySubjects,
  getLibrarySubjectsPage,
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
