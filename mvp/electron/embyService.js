const fs = require('fs');
const { spawn } = require('child_process');

function log(...args) {
  console.log('[emby]', new Date().toISOString(), ...args);
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

function buildUrl(config, relativePath, extraQuery = {}) {
  const base = normalizeBaseUrl(config.baseUrl);
  const u = new URL(relativePath.replace(/^\//, ''), `${base}/`);
  u.searchParams.set('api_key', config.apiKey.trim());
  for (const [k, v] of Object.entries(extraQuery)) {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  }
  return u.toString();
}

async function embyFetchJson(config, relativePath, options = {}, extraQuery = {}) {
  const url = buildUrl(config, relativePath, extraQuery);
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      'X-Emby-Token': config.apiKey.trim(),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Emby 请求失败 (${res.status}): ${text.slice(0, 280) || res.statusText}`);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return null;
  return res.json();
}

async function embyFetchOk(config, relativePath, options = {}, extraQuery = {}) {
  const url = buildUrl(config, relativePath, extraQuery);
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      'X-Emby-Token': config.apiKey.trim(),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Emby 请求失败 (${res.status}): ${text.slice(0, 280) || res.statusText}`);
  }
}

function mapEmbyType(t) {
  if (t === 'Movie') return 'Movie';
  if (t === 'Episode') return 'Episode';
  if (t) return 'Other';
  return 'Unknown';
}

function episodeIndexLabel(item) {
  const pi = item.ParentIndexNumber;
  const idx = item.IndexNumber;
  if (typeof pi !== 'number' || typeof idx !== 'number') return undefined;
  const s = String(pi).padStart(2, '0');
  const e = String(idx).padStart(2, '0');
  return `S${s}E${e}`;
}

function applyPathMap(filePath, from, to) {
  const prefix = String(from || '').trim();
  if (!prefix) return filePath;
  const dest = String(to || '').trim();
  if (filePath.startsWith(prefix)) return dest + filePath.slice(prefix.length);
  return filePath;
}

/**简易引号感知拆分，用于播放器参数模板（Windows） */
function parseWindowsArgString(input) {
  const out = [];
  let i = 0;
  const s = String(input || '').trim();
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i += 1;
    if (i >= s.length) break;
    if (s[i] === '"') {
      i += 1;
      let chunk = '';
      while (i < s.length) {
        if (s[i] === '"') {
          i += 1;
          break;
        }
        chunk += s[i];
        i += 1;
      }
      out.push(chunk);
    } else {
      let chunk = '';
      while (i < s.length && !/\s/.test(s[i])) {
        chunk += s[i];
        i += 1;
      }
      out.push(chunk);
    }
  }
  return out;
}

function pickPlayablePathFromPlaybackInfo(info) {
  const sources = info && Array.isArray(info.MediaSources) ? info.MediaSources : [];
  for (const src of sources) {
    if (src && typeof src.Path === 'string' && src.Path.trim()) return src.Path.trim();
  }
  return null;
}

async function fetchPlaybackPath(config, itemId) {
  const uid = config.userId.trim();
  const iid = encodeURIComponent(itemId);
  const info = await embyFetchJson(config, `Items/${iid}/PlaybackInfo`, {}, { UserId: uid });
  return pickPlayablePathFromPlaybackInfo(info);
}

async function testConnection({ baseUrl, apiKey }) {
  const cfg = { baseUrl, apiKey, userId: '' };
  const data = await embyFetchJson(cfg, 'System/Info');
  log('testConnection ok', data?.ServerName || data?.Id);
  return {
    serverName: data?.ServerName || data?.Name,
    version: data?.Version || data?.PackageVersion || data?.SystemVersion,
  };
}

async function getUsers({ baseUrl, apiKey }) {
  const cfg = { baseUrl, apiKey, userId: '' };
  let data = await embyFetchJson(cfg, 'Users/Query').catch(() => null);
  let list = data && Array.isArray(data.Items) ? data.Items : null;
  if (!list) {
    const raw = await embyFetchJson(cfg, 'Users');
    list = Array.isArray(raw) ? raw : raw?.Items || [];
  }
  const users = list.map((u) => ({ id: u.Id, name: u.Name || u.Id })).filter((u) => u.id);
  log('getUsers count', users.length);
  return users;
}

async function getMediaFolders({ baseUrl, apiKey }) {
  const cfg = { baseUrl, apiKey, userId: '' };
  const data = await embyFetchJson(cfg, 'Library/MediaFolders');
  const items = data && Array.isArray(data.Items) ? data.Items : [];
  const folders = items.map((x) => ({ id: x.Id, name: x.Name || x.Id })).filter((x) => x.id);
  log('getMediaFolders count', folders.length);
  return folders;
}

const ITEM_FIELDS =
  'BasicSyncInfo,RunTimeTicks,ImageTags,Type,SeriesName,ParentIndexNumber,IndexNumber,ParentId,MediaSources';

async function getUnplayedForSection(config, sectionId) {
  const uid = encodeURIComponent(config.userId.trim());
  const query = {
    ParentId: sectionId,
    Recursive: 'true',
    IsPlayed: 'false',
    IncludeItemTypes: 'Movie,Episode',
    Fields: ITEM_FIELDS,
    SortBy: 'SortName',
    SortOrder: 'Ascending',
    Limit: '500',
  };
  const data = await embyFetchJson(config, `Users/${uid}/Items`, {}, query);
  const items = data && Array.isArray(data.Items) ? data.Items : [];
  return items.map((item) => ({
    id: item.Id,
    name: item.Name || item.Id,
    posterTag: item.ImageTags && item.ImageTags.Primary,
    runTimeTicks: typeof item.RunTimeTicks === 'number' ? item.RunTimeTicks : undefined,
    sectionId,
  }));
}

async function getUnplayedItems({ config, sectionId }) {
  const rows = await getUnplayedForSection(config, sectionId);
  log('getUnplayedItems', sectionId, rows.length);
  return rows;
}

async function fetchPlayedPage(config, sectionId, type) {
  const uid = encodeURIComponent(config.userId.trim());
  const buildBase = (extra = {}) => {
    const q = {
      Recursive: 'true',
      IsPlayed: 'true',
      Fields: `${ITEM_FIELDS},DatePlayed,SeriesName,UserData`,
      SortBy: 'DatePlayed',
      SortOrder: 'Descending',
      Limit: '300',
      ...extra,
    };
    if (sectionId) q.ParentId = sectionId;
    if (type && type !== 'all') q.IncludeItemTypes = type;
    else q.IncludeItemTypes = 'Movie,Episode';
    return q;
  };

  const tryQueries = [
    buildBase(),
    buildBase({ SortBy: 'DateLastPlayed' }),
    (() => {
      const q = buildBase();
      delete q.SortBy;
      delete q.SortOrder;
      return q;
    })(),
    (() => {
      const q = buildBase({ Filters: 'IsPlayed' });
      delete q.IsPlayed;
      return q;
    })(),
    buildBase({ Filters: 'IsPlayed' }),
  ];

  let rows = [];
  for (const query of tryQueries) {
    try {
      const data = await embyFetchJson(config, `Users/${uid}/Items`, {}, query);
      rows = data && Array.isArray(data.Items) ? data.Items : [];
      if (rows.length > 0) break;
    } catch (e) {
      log('fetchPlayedPage attempt failed', e?.message || e);
    }
  }

  if (rows.length === 0 && sectionId) {
    const sid = encodeURIComponent(sectionId);
    try {
      const data2 = await embyFetchJson(config, `Users/${uid}/Sections/${sid}/Items`, {}, tryQueries[0]);
      rows = data2 && Array.isArray(data2.Items) ? data2.Items : [];
    } catch (e) {
      log('fetchPlayedPage Sections fallback failed', e?.message || e);
    }
  }
  return rows;
}

function playedTimestampMs(item) {
  const raw =
    item.DatePlayed ||
    item.UserData?.LastPlayedDate ||
    item.UserData?.PlayedDate ||
    item.UserData?.LastPlayedDateUtc;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? 0 : t;
}

async function getPlayedItems(args) {
  const { config, days, sectionId, type } = args;
  let items;
  if (sectionId && String(sectionId).trim()) {
    items = await fetchPlayedPage(config, String(sectionId).trim(), type);
  } else {
    const ids = Array.isArray(config.enabledSectionIds) ? config.enabledSectionIds : [];
    const chunks = await Promise.all(ids.map((sid) => fetchPlayedPage(config, sid, type)));
    const byId = new Map();
    for (const chunk of chunks) {
      for (const it of chunk) byId.set(it.Id, it);
    }
    items = Array.from(byId.values());
    if (items.length === 0 && ids.length > 0) {
      log('getPlayedItems: per-library empty, try user-wide played query');
      items = await fetchPlayedPage(config, undefined, type);
    }
    items.sort((a, b) => playedTimestampMs(b) - playedTimestampMs(a));
  }
  let rows = items.map((item) => {
    const folderId = item.ParentId || sectionId || '';
    const playedAt =
      item.DatePlayed ||
      item.UserData?.LastPlayedDate ||
      item.UserData?.PlayedDate ||
      item.UserData?.LastPlayedDateUtc;
    return {
      id: item.Id,
      name: item.Name || item.Id,
      posterTag: item.ImageTags && item.ImageTags.Primary,
      seriesName: item.SeriesName,
      indexLabel: episodeIndexLabel(item),
      sectionId: folderId,
      sectionName: undefined,
      datePlayed: playedAt,
      type: mapEmbyType(item.Type),
    };
  });
  const d = days;
  if (d && d > 0) {
    const cutoff = Date.now() - d * 86400000;
    rows = rows.filter((r) => {
      /** 已标记为已播放但缺少播放时间元数据时，不因时间窗误删 */
      if (!r.datePlayed) return true;
      const t = new Date(r.datePlayed).getTime();
      if (Number.isNaN(t)) return true;
      return t >= cutoff;
    });
  }
  log('getPlayedItems', rows.length);
  return rows;
}

async function launchPlayer({ config, item }) {
  const exe = String(config.playerExePath || '').trim();
  if (!exe) throw new Error('未配置播放器可执行文件路径');
  if (!fs.existsSync(exe)) throw new Error(`找不到播放器：${exe}`);

  const originalPath = await fetchPlaybackPath(config, item.id);
  if (!originalPath) throw new Error('服务器未返回可播放的本地路径（PlaybackInfo 无 Path）');

  const mappedPath = applyPathMap(originalPath, config.pathMapFrom, config.pathMapTo);
  const template = String(config.argsTemplate || '"{path}"');
  const filled = template.replace(/\{path\}/gi, mappedPath);
  const argv = parseWindowsArgString(filled);
  if (argv.length === 0) throw new Error('播放器参数模板解析结果为空');

  log('launchPlayer', { exe, argv0: argv[0], argc: argv.length });

  const child = spawn(exe, argv, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  if (child.pid === undefined) {
    throw new Error('未能启动播放器进程');
  }

  const rt = item.runTimeTicks;
  const runtimeSeconds =
    typeof rt === 'number' && rt > 0 ? Math.max(1, Math.round(rt / 10_000_000)) : undefined;

  return {
    sessionStartedAtMs: Date.now(),
    runtimeSeconds,
    debug: {
      originalPath,
      mappedPath,
      resolvedArgs: filled,
      args: argv,
    },
  };
}

/**
 * Emby POST /Users/{UserId}/PlayedItems/{Id} 要求 DatePlayed 为查询参数，格式 yyyyMMddHHmmss（见官方 REST 文档）。
 * JSON Body 里传 ISO 8601 字符串会导致服务端 .NET 解析失败（500）。
 */
function formatEmbyDatePlayedQuery(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

async function markPlayed({ config, itemId }) {
  const uid = encodeURIComponent(config.userId.trim());
  const iid = encodeURIComponent(itemId);
  await embyFetchOk(
    config,
    `Users/${uid}/PlayedItems/${iid}`,
    { method: 'POST' },
    { DatePlayed: formatEmbyDatePlayedQuery(new Date()) },
  );
  log('markPlayed', itemId);
}

async function markUnplayed({ config, itemId }) {
  const uid = encodeURIComponent(config.userId.trim());
  const iid = encodeURIComponent(itemId);
  await embyFetchOk(config, `Users/${uid}/PlayedItems/${iid}`, { method: 'DELETE' });
  log('markUnplayed', itemId);
}

module.exports = {
  testConnection,
  getUsers,
  getMediaFolders,
  getUnplayedItems,
  getPlayedItems,
  launchPlayer,
  markPlayed,
  markUnplayed,
};
