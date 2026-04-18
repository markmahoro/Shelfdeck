const fs = require('fs');
const path = require('path');
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

/**
 * 列表接口常返回 Type=Video（泛型视频），不能仅靠 Movie/Episode 字符串判断。
 * 参考：Emby 文档中 Video 与 Movie/Episode 的层次关系；剧集通常带 SeriesId/SeriesName 或季集序号。
 * @returns {'Movie'|'Episode'|'Other'}
 */
function classifyManageListItemType(item) {
  const raw = item.Type ?? item.type;
  const typeStr = typeof raw === 'string' ? raw.trim() : '';
  const lc = typeStr.toLowerCase();

  if (lc === 'episode') return 'Episode';
  if (lc === 'movie') return 'Movie';

  const seriesId = item.SeriesId ?? item.seriesId;
  const seriesName = item.SeriesName ?? item.seriesName;
  const hasSeriesId = seriesId != null && String(seriesId).trim().length > 0;
  const hasSeriesName = typeof seriesName === 'string' && seriesName.trim().length > 0;
  const hasEpisodeIndexing =
    typeof item.ParentIndexNumber === 'number' || typeof item.IndexNumber === 'number';

  const isVideoLike =
    lc === 'video' ||
    (item.MediaType ?? item.mediaType) === 'Video' ||
    (item.MediaType ?? item.mediaType) === 'video';

  if (item.IsMovie === true || item.isMovie === true) return 'Movie';

  if (isVideoLike || typeStr === '') {
    if (hasSeriesId || hasSeriesName || hasEpisodeIndexing) return 'Episode';
    return 'Movie';
  }

  const mapped = mapEmbyType(typeStr);
  if (mapped === 'Movie' || mapped === 'Episode') return mapped;
  return 'Other';
}

function normalizeFsPath(p) {
  return String(p || '').replace(/\\/g, '/').toLowerCase();
}

function isDirectorySync(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Emby 对 BDMV 文件夹原盘常把 Path 指到片库根目录，路径里不含「BDMV」，需在磁盘上判断。 */
const bdmvImmediateCache = new Map();

function dirHasImmediateBdmv(dir) {
  if (!dir || typeof dir !== 'string') return false;
  let key;
  try {
    key = path.resolve(dir).toLowerCase();
  } catch {
    key = path.normalize(dir).toLowerCase();
  }
  if (bdmvImmediateCache.has(key)) return bdmvImmediateCache.get(key);
  const ok = isDirectorySync(path.join(dir, 'BDMV'));
  bdmvImmediateCache.set(key, ok);
  return ok;
}

function pathToFilesystemDir(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    const st = fs.statSync(s);
    if (st.isDirectory()) return s;
    if (st.isFile()) return path.dirname(s);
  } catch {
    // 路径不可访问时：有常见视频扩展名则视为文件并取父目录
    const ext = path.extname(s).toLowerCase();
    if (
      [
        '.m2ts',
        '.mts',
        '.ssif',
        '.mpls',
        '.clpi',
        '.bdmv',
        '.iso',
        '.mkv',
        '.mp4',
        '.ts',
        '.m4v',
        '.avi',
      ].includes(ext)
    ) {
      return path.dirname(s);
    }
  }
  return s;
}

/** 从当前目录沿父链查找是否存在 BDMV；并检查一层子目录下是否有 BDMV（如 disc/BDMV）。 */
function pathOnDiskImpliesBdmvFolder(rawPath) {
  const start = pathToFilesystemDir(rawPath);
  if (!start) return false;

  try {
    if (isDirectorySync(start)) {
      const entries = fs.readdirSync(start, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        if (dirHasImmediateBdmv(path.join(start, ent.name))) return true;
      }
    }
  } catch {
    /* ignore */
  }

  let dir = start;
  let depth = 0;
  const seen = new Set();
  while (dir && depth < 14) {
    let norm;
    try {
      norm = path.resolve(dir).toLowerCase();
    } catch {
      norm = path.normalize(dir).toLowerCase();
    }
    if (seen.has(norm)) break;
    seen.add(norm);
    if (dirHasImmediateBdmv(dir)) return true;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
    depth += 1;
  }
  return false;
}

/**
 * 蓝光/原盘结构：.iso、含 BDMV 目录，或 Emby 标记的蓝光/ISO 类型。
 * 此类条目不支持在应用内发起码率优化任务（需先提取或转封装为普通片源）。
 * @param {object} [config] 与 launchPlayer 相同，使用 pathMapFrom/To 将 Emby 路径映射到本机可访问路径后再做磁盘探测。
 */
function inferIsBluRayDisc(item, config) {
  const from = config && config.pathMapFrom;
  const to = config && config.pathMapTo;

  const collectPathsForDiscCheck = () => {
    const out = [];
    const seen = new Set();
    const add = (p) => {
      const s = String(p || '').trim();
      if (!s) return;
      const mapped = applyPathMap(s, from, to).trim();
      const candidates = mapped !== s ? [s, mapped] : [mapped];
      for (const cand of candidates) {
        const key = cand.replace(/\\/g, '/').toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(cand);
      }
    };
    if (item.Path) add(item.Path);
    if (Array.isArray(item.MediaSources)) {
      for (const src of item.MediaSources) {
        if (src && src.Path) add(src.Path);
      }
    }
    return out;
  };

  const paths = collectPathsForDiscCheck();

  for (const raw of paths) {
    const n = normalizeFsPath(raw);
    if (!n) continue;
    if (n.endsWith('.iso')) return true;
    if (n.includes('/bdmv/') || n.endsWith('/bdmv')) return true;
  }

  for (const raw of paths) {
    if (!String(raw || '').trim()) continue;
    try {
      if (pathOnDiskImpliesBdmvFolder(raw)) return true;
    } catch {
      /*网络盘未挂载等 */
    }
  }

  const isoType = item.IsoType ?? item.isoType;
  if (isoType === 'BluRay' || isoType === 'Dvd') return true;

  const videoType = item.VideoType ?? item.videoType;
  if (typeof videoType === 'string') {
    const v = videoType.toLowerCase();
    if (v === 'bluray' || v === 'iso') return true;
  }

  if (Array.isArray(item.MediaSources)) {
    for (const src of item.MediaSources) {
      if (!src) continue;
      const svt = (src.VideoType ?? src.videoType ?? '').toString().toLowerCase();
      if (svt === 'bluray' || svt === 'iso') return true;
      const c = (src.Container ?? src.container ?? '').toString().toLowerCase();
      if (c === 'iso') return true;
    }
  }

  return false;
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
  const fp = String(filePath || '');
  const prefix = String(from || '').trim();
  if (!prefix) return fp;
  const dest = String(to || '').trim();

  if (fp.startsWith(prefix)) return dest + fp.slice(prefix.length);

  const fpN = fp.replace(/\\/g, '/');
  const prN = prefix.replace(/\\/g, '/');
  const mapNorm = () => {
    const rest = fpN.slice(prN.length).replace(/^\/+/, '');
    if (!rest) return path.normalize(dest);
    return path.normalize(path.join(dest, ...rest.split('/').filter(Boolean)));
  };

  if (fpN.startsWith(prN)) return mapNorm();
  if (process.platform === 'win32' && fpN.toLowerCase().startsWith(prN.toLowerCase())) return mapNorm();

  return fp;
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

/** 治理列表需已播状态（UserData.Played）；Path/VideoType 等用于原盘识别 */
const ITEM_FIELDS_MANAGE =
  'BasicSyncInfo,RunTimeTicks,ImageTags,Type,MediaType,Path,VideoType,IsoType,SeriesName,SeriesId,ParentIndexNumber,IndexNumber,ParentId,MediaSources,UserData';

function normalizeVideoCodec(raw) {
  const c = String(raw || '').toLowerCase();
  if (c === 'hevc' || c.includes('h265') || c === 'h265') return 'h265';
  if (c === 'h264' || c === 'avc' || c.includes('h264')) return 'h264';
  if (c === 'av1') return 'av1';
  return 'h264';
}

function inferResolution(width, height) {
  const h = typeof height === 'number' ? height : 0;
  const w = typeof width === 'number' ? width : 0;
  if (h >= 2000 || w >= 3800) return '4K';
  return '1080p';
}

/** 从 Items 接口返回的 MediaSources / MediaStreams 推导治理页用码率估算字段 */
function extractLibraryItemStats(item) {
  const ticks = typeof item.RunTimeTicks === 'number' ? item.RunTimeTicks : 0;
  const durationSec = ticks > 0 ? Math.max(1, Math.round(ticks / 10_000_000)) : 3600;
  const sources = Array.isArray(item.MediaSources) ? item.MediaSources : [];
  const src = sources[0];
  let sizeGb = 0;
  let width;
  let height;
  let codec = 'h264';
  if (src) {
    if (typeof src.Size === 'number' && src.Size > 0) {
      sizeGb = Number((src.Size / (1024 * 1024 * 1024)).toFixed(2));
    }
    const streams = Array.isArray(src.MediaStreams) ? src.MediaStreams : [];
    const video = streams.find((s) => s && s.Type === 'Video');
    if (video) {
      width = video.Width;
      height = video.Height;
      codec = normalizeVideoCodec(video.Codec);
    }
  }
  if (sizeGb <= 0 && src && typeof src.Bitrate === 'number' && src.Bitrate > 0 && durationSec > 0) {
    sizeGb = Number(((src.Bitrate * durationSec) / 8 / (1024 * 1024 * 1024)).toFixed(2));
  }
  if (sizeGb <= 0) {
    sizeGb = Number((2.5 + durationSec / 3600).toFixed(2));
  }
  return {
    durationSec,
    sizeGb: Math.max(0.05, sizeGb),
    resolution: inferResolution(width, height),
    codec,
  };
}

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
  return items.map((item) => {
    const stats = extractLibraryItemStats(item);
    return {
      id: item.Id,
      name: item.Name || item.Id,
      posterTag: item.ImageTags && item.ImageTags.Primary,
      runTimeTicks: typeof item.RunTimeTicks === 'number' ? item.RunTimeTicks : undefined,
      sectionId,
      durationSec: stats.durationSec,
      sizeGb: stats.sizeGb,
      resolution: stats.resolution,
      codec: stats.codec,
    };
  });
}

async function getUnplayedItems({ config, sectionId }) {
  const rows = await getUnplayedForSection(config, sectionId);
  log('getUnplayedItems', sectionId, rows.length);
  return rows;
}

/** 已启用媒体库内全部电影/剧集（含已观看），供媒体库管理页 */
async function getLibraryItemsForManageSection(config, sectionId) {
  const uid = encodeURIComponent(config.userId.trim());
  const query = {
    ParentId: sectionId,
    Recursive: 'true',
    IncludeItemTypes: 'Movie,Episode',
    Fields: ITEM_FIELDS_MANAGE,
    SortBy: 'SortName',
    SortOrder: 'Ascending',
    Limit: '2000',
  };
  const data = await embyFetchJson(config, `Users/${uid}/Items`, {}, query);
  const items = data && Array.isArray(data.Items) ? data.Items : [];
  return items.map((item) => {
    const stats = extractLibraryItemStats(item);
    const embyPlayed = !!(item.UserData && item.UserData.Played);
    const itemType = classifyManageListItemType(item);
    const isBluRayDisc = inferIsBluRayDisc(item, config);
    return {
      id: item.Id,
      name: item.Name || item.Id,
      posterTag: item.ImageTags && item.ImageTags.Primary,
      runTimeTicks: typeof item.RunTimeTicks === 'number' ? item.RunTimeTicks : undefined,
      sectionId,
      durationSec: stats.durationSec,
      sizeGb: stats.sizeGb,
      resolution: stats.resolution,
      codec: stats.codec,
      embyPlayed,
      itemType,
      isBluRayDisc,
    };
  });
}

async function getLibraryItemsForManage({ config }) {
  const ids = Array.isArray(config.enabledSectionIds) ? config.enabledSectionIds.filter((x) => x && String(x).trim()) : [];
  if (ids.length === 0) return [];
  const chunks = await Promise.all(ids.map((sid) => getLibraryItemsForManageSection(config, sid)));
  const byId = new Map();
  for (const chunk of chunks) {
    for (const it of chunk) {
      if (!byId.has(it.id)) byId.set(it.id, it);
    }
  }
  const list = Array.from(byId.values());
  log('getLibraryItemsForManage', list.length);
  return list;
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

/**
 * Emby/Jellyfin 的 DELETE /Items/{id} 在服务端需要「用户」上下文；纯 API Key 常导致 Parameter 'user' null。
 * 使用所选用户在配置中填写的登录密码调用 AuthenticateByName，换取 AccessToken 再执行删除。
 */
async function authenticateEmbyUserAccessToken(config) {
  const pw = String(config.embyUserPassword || '').trim();
  const userId = String(config.userId || '').trim();
  if (!pw || !userId) return null;
  const list = await getUsers({ baseUrl: config.baseUrl, apiKey: config.apiKey });
  const row = list.find((u) => u.id === userId);
  const username = row && typeof row.name === 'string' ? row.name.trim() : '';
  if (!username) {
    throw new Error('无法解析所选用户的登录名：请重新「获取媒体库及用户列表」并选择用户。');
  }
  const url = buildUrl(config, 'Users/AuthenticateByName', {});
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Emby-Token': config.apiKey.trim(),
    },
    body: JSON.stringify({ Username: username, Pw: pw }),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(
      `Emby 登录所选用户失败 (${res.status})，无法获取删除用访问令牌：${text.slice(0, 200) || res.statusText}。请确认密码为该用户在 Emby 中的登录密码。`,
    );
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Emby 登录响应无法解析为 JSON，无法继续删除。');
  }
  const tok = data.AccessToken || data.accessToken;
  if (!tok || !String(tok).trim()) {
    throw new Error('Emby 登录响应中缺少 AccessToken，无法继续删除。');
  }
  return String(tok).trim();
}

async function getLibraryItem({ config, itemId }) {
  const uid = encodeURIComponent(config.userId.trim());
  const iid = encodeURIComponent(itemId);
  return embyFetchJson(config, `Users/${uid}/Items/${iid}`, {});
}

async function getItemDeleteInfo({ config, itemId }) {
  const userId = String(config.userId || '').trim();
  const iid = encodeURIComponent(itemId);
  try {
    /** 查询串 UserId 传原始 GUID：与 fetchPlaybackPath 一致；勿先 encodeURIComponent，否则经 searchParams 二次编码后服务端可能无法解析用户。 */
    return await embyFetchJson(config, `Items/${iid}/DeleteInfo`, {}, userId ? { UserId: userId } : {});
  } catch (e) {
    log('getItemDeleteInfo optional fail', e?.message || e);
    return null;
  }
}

async function deleteLibraryItem({ config, itemId }) {
  const userId = String(config.userId || '').trim();
  if (!userId) {
    throw new Error('未配置 Emby 用户 ID：请在配置中心选择用户后再执行删除（用于权限校验）。');
  }
  const iid = encodeURIComponent(itemId);
  const pw = String(config.embyUserPassword || '').trim();
  let deleteCfg = config;
  let extraQuery = { UserId: userId };
  if (pw) {
    const accessToken = await authenticateEmbyUserAccessToken(config);
    deleteCfg = { ...config, apiKey: accessToken };
    extraQuery = {};
  }
  try {
    await embyFetchOk(deleteCfg, `Items/${iid}`, { method: 'DELETE' }, extraQuery);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!pw && /\(400\)/.test(msg) && /user/i.test(msg) && /null|Parameter/i.test(msg)) {
      throw new Error(
        `${msg} 提示：此类错误多为「删除接口需要用户访问令牌」。请在配置页的「所选用户登录密码」中填写该用户在 Emby 的登录密码并保存后再试。`,
      );
    }
    throw e;
  }
  log('deleteLibraryItem', { itemId, userId, usedUserToken: !!pw });
}

async function libraryItemExists({ config, itemId }) {
  const uid = encodeURIComponent(config.userId.trim());
  const iid = encodeURIComponent(itemId);
  const url = buildUrl(config, `Users/${uid}/Items/${iid}`, {});
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Emby-Token': config.apiKey.trim(),
    },
  });
  if (res.status === 404) return false;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Emby 查询条目失败 (${res.status}): ${text.slice(0, 280) || res.statusText}`);
  }
  return true;
}

module.exports = {
  testConnection,
  getUsers,
  getMediaFolders,
  getUnplayedItems,
  getLibraryItemsForManage,
  getPlayedItems,
  launchPlayer,
  markPlayed,
  markUnplayed,
  getLibraryItem,
  getItemDeleteInfo,
  deleteLibraryItem,
  libraryItemExists,
  fetchPlaybackPath,
  applyPathMap,
};
