'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const chokidar = require('chokidar');

const configStore = require('./configStore');
const taskStore = require('./taskStore');
const transcodeService = require('./services/transcodeService');
const activityLog = require('./activityLog');
const assetIdentity = require('./assetIdentity');

const watchers = new Map();
const settleTimers = new Map();

const DEFAULT_EXTS = new Set(['.3gp', '.avi', '.f4v', '.flv', '.iso', '.m2ts', '.m4v', '.mkv', '.mov', '.mp4', '.mpeg', '.mpg', '.rm', '.rmvb', '.ts', '.vob', '.webm', '.wmv']);
const TERMINAL = new Set(['done', 'failed_hard', 'deleted']);

function libraryFilePath() {
  return path.join(configStore.resolveDataDir(), 'library.json');
}

function loadLibrary() {
  const f = libraryFilePath();
  if (!fs.existsSync(f)) return { version: 1, items: [], cachedAt: null };
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return { version: 1, items: [], cachedAt: null }; }
}

function saveLibrary(lib) {
  fs.mkdirSync(configStore.resolveDataDir(), { recursive: true });
  fs.writeFileSync(libraryFilePath(), JSON.stringify(lib, null, 2), 'utf8');
}

function nowIso() {
  return new Date().toISOString();
}

function isAdultFolderSubLibrary(sl) {
  return sl && sl.enabled !== false && sl.source === 'folder' && sl.mediaType === 'adult';
}

function isJapaneseJavSubLibrary(sl) {
  return isAdultFolderSubLibrary(sl) && (sl.adultRegion || 'japanese_jav') === 'japanese_jav';
}

function normalizePathForCompare(p) {
  return assetIdentity.normalizeMediaPath(p);
}

function videoExts(config) {
  return new Set(((config.adultLibrary && config.adultLibrary.videoExtensions) || [...DEFAULT_EXTS]).map((x) => String(x).toLowerCase()));
}

function isMediaFile(filePath, config) {
  return videoExts(config).has(path.extname(filePath).toLowerCase());
}

function isTemporaryFile(filePath) {
  const name = path.basename(filePath).toLowerCase();
  return name.endsWith('.part') || name.endsWith('.tmp') || name.endsWith('.download') || name.includes('.etp.');
}

function hasIgnoredSegment(filePath, subLib) {
  const ignoreName = subLib.organizeIgnoreFolderName || '';
  const segments = normalizePathForCompare(filePath).split('/');
  return (ignoreName && segments.includes(String(ignoreName).toLowerCase())) || segments.includes('#不要扫描');
}

// Known Japanese JAV maker/series prefixes. A matched prefix => high confidence;
// the scrape task auto-enqueues only for high-confidence IDs. Unknown prefixes
// are still parsed (best-effort) but flagged ambiguous so the user can confirm
// or correct before scraping, avoiding元数据覆盖由误识别（如 "MakingOf2024",
// "Part1", "CD1"）触发的问题。List is intentionally broad (single-file JavSP-style
// catalogue subset) and curated; missing studios simply fall through to ambiguous.
const KNOWN_JAV_PREFIXES = new Set([
  'ABC', 'ABP', 'ABW', 'ACK', 'ACZ', 'ADN', 'AEMU', 'AF', 'AGEMIX', 'AHO', 'AINZ',
  'AKID', 'ALD', 'ALK', 'AMA', 'AME', 'AP', 'APAA', 'APAK', 'APNS', 'ARSO', 'ARZ',
  'ASR', 'ATID', 'ATK', 'ATOM', 'AVOP', 'AVSA', 'AWS', 'BAB', 'BAG', 'BBI', 'BDA',
  'BDSR', 'BF', 'BGDX', 'BGN', 'BGR', 'BOD', 'BOBB', 'BOMN', 'BTHA', 'CAAA', 'CABA',
  'CAND', 'CAWD', 'CEN', 'CHC', 'CJOD', 'CKIZ', 'CLUB', 'CMN', 'CNDI', 'CNXT', 'CPAD',
  'CRAV', 'CRIE', 'CROWN', 'CRYS', 'DASS', 'DASD', 'DAVK', 'DBER', 'DCEX', 'DCX',
  'DDHH', 'DDKN', 'DDOL', 'DGAJ', 'DKSW', 'DLAM', 'DMAI', 'DMDI', 'DMOW', 'DNJR',
  'DODD', 'DOCP', 'DOMA', 'DOT', 'DPIO', 'DRGI', 'DSAM', 'DSDB', 'DV', 'DVE', 'E-body',
  'EBAN', 'EBOD', 'EBWH', 'EVA', 'FCH', 'FC2', 'FCT', 'FERA', 'FFFC', 'FINH', 'FIVR',
  'FSET', 'FUCK', 'GANA', 'GAS', 'GCOLI', 'GGJ', 'GLAM', 'GMPP', 'GMOD', 'GOLD',
  'GORP', 'GRCH', 'GRTY', 'GTYO', 'GVD', 'HAVD', 'HBAD', 'HBAD', 'HND', 'HNDS', 'HNTR',
  'HODV', 'HOMA', 'HUB', 'HUNTA', 'HUSKY', 'IENE', 'IPTD', 'IPX', 'IPZZ', 'JAC', 'JAV',
  'JBD', 'JUFD', 'JUFM', 'JUKD', 'JUKF', 'JUL', 'JUY', 'JUFD', 'KABE', 'KAGP', 'KAHA',
  'KAMB', 'KANS', 'KATU', 'KAWD', 'KAWR', 'KBAD', 'KIRE', 'KIW', 'KNAM', 'KNMD',
  'KNZS', 'KMHRS', 'KMRST', 'KOND', 'KRND', 'KRSD', 'KTSG', 'KUMS', 'KV', 'KWBD',
  'LOL', 'LOLD', 'LULU', 'LUXU', 'MAAN', 'MADN', 'MAI', 'MAIH', 'MAMA', 'MANC', 'MBR',
  'MD', 'MDB', 'MDTM', 'MEYD', 'MIFD', 'MIGD', 'MIAD', 'MIRD', 'MIUM', 'MIX', 'MMB',
  'MMKG', 'MMND', 'MMRA', 'MNV', 'MODY', 'MORE', 'MRSS', 'MSCH', 'MSD', 'MIDE', 'MIF',
  'MKBD', 'MKMP', 'MKMH', 'MKON', 'MMEN', 'MOND', 'MORI', 'MOT', 'MQQA', 'MUCD', 'MVSD',
  'MW', 'MXGS', 'NACR', 'NAGR', 'NAMA', 'NASS', 'NATR', 'NEMD', 'NIMA', 'NKOD', 'NNA',
  'NNPJ', 'NODS', 'NOPD', 'NSPS', 'NTRD', 'NTRS', 'NVII', 'NYPD', 'OBAH', 'OBAN',
  'OHDH', 'OKAX', 'OKK', 'OKSN', 'OONS', 'OPID', 'OREC', 'ORN', 'OTIM', 'OUMI', 'PARATHD',
  'PATT', 'PIYO', 'PKBD', 'PKPL', 'PKPD', 'PLAG', 'PLAY', 'PPPD', 'PRBR', 'PRGD', 'PS',
  'PRT', 'PUSD', 'PZD', 'RABE', 'RAFS', 'REAL', 'REBTSR', 'REBD', 'RED', 'RIN', 'RKI',
  'RMCI', 'ROYD', 'RSH', 'RTA', 'RUMI', 'SABA', 'SABA', 'SABD', 'SACE', 'SADM', 'SAN',
  'SAPD', 'SAQUA', 'SCOP', 'SDAB', 'SDDE', 'SDEN', 'SDJS', 'SDNM', 'SDSI', 'SDSU',
  'SEED', 'SENZ', 'SEQE', 'SGA', 'SGKI', 'SHC', 'SHKR', 'SHN', 'SHNS', 'SHOT', 'SIVR',
  'SKMJ', 'SKSK', 'SOAV', 'SOE', 'SORA', 'SPAY', 'SPD', 'SPRD', 'SQTE', 'SRAM', 'SRT',
  'SSIN', 'SSIS', 'SSNI', 'SSPD', 'STAR', 'STARS', 'SUKE', 'SUPA', 'SWEET', 'SWR',
  'T28', 'TCD', 'TEN', 'TFBE', 'TGCY', 'TORA', 'TPIN', 'TPPN', 'TPPN', 'TRA', 'VCBX',
  'VEMA', 'VENX', 'VINX', 'VOSR', 'VRTM', 'WANZ', 'WANZFACTORY', 'WATS', 'WMIL', 'XVSR',
  'YAH', 'YARIMAN', 'YEL', 'YMDD', 'YNZY', 'YTE', 'YTR', 'YUG', 'ZEX', 'ZMEN', 'ZN',
  'ZOC', 'ZOKU', 'ZOOO',
]);

// Parse a candidate JAV 番号 from free text. Returns { adultId, confidence }
// where confidence is 'high' (known prefix), 'low' (parsed but unknown prefix,
// needs user confirmation) or '' (nothing matched / ambiguous parse).
function extractJavIdWithConfidence(value) {
  const s = String(value || '').normalize('NFKC').toUpperCase();
  const fc2 = s.match(/\bFC2(?:[-_\s]?PPV)?[-_\s]?(\d{3,})\b/);
  if (fc2) return { adultId: `FC2-${fc2[1]}`, confidence: 'high' };
  const m = s.match(/\b([A-Z]{2,10})[-_\s]?(\d{2,6})\b/);
  if (!m) return { adultId: '', confidence: '' };
  const adultId = `${m[1]}-${m[2]}`;
  // Reject common false positives regardless of prefix.
  const FALSY_PREFIXES = new Set(['CD', 'DVD', 'MP', 'MKV', 'AVI', 'MOV', 'WMV', 'FLV', 'PART']);
  if (FALSY_PREFIXES.has(m[1])) return { adultId: '', confidence: '' };
  const confidence = KNOWN_JAV_PREFIXES.has(m[1]) ? 'high' : 'low';
  return { adultId, confidence };
}

function extractJavId(value) {
  return extractJavIdWithConfidence(value).adultId;
}

function xmlValues(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(xml))) {
    out.push(decodeXml(m[1].replace(/<[^>]+>/g, '').trim()));
  }
  return out.filter(Boolean);
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function encodeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseNfo(nfoPath) {
  if (!nfoPath || !fs.existsSync(nfoPath)) return null;
  const xml = fs.readFileSync(nfoPath, 'utf8');
  const actors = [];
  const actorThumbs = {};
  const actorBlocks = xml.match(/<actor[\s\S]*?<\/actor>/gi) || [];
  for (const block of actorBlocks) {
    const name = xmlValues(block, 'name')[0];
    if (name) {
      actors.push(name);
      const thumb = xmlValues(block, 'thumb')[0];
      if (thumb) actorThumbs[name] = thumb;
    }
  }
  const title = xmlValues(xml, 'title')[0] || '';
  const originalTitle = xmlValues(xml, 'originaltitle')[0] || '';
  const adultId = extractJavId(`${title} ${originalTitle} ${path.basename(path.dirname(nfoPath))}`);
  return {
    nfoPath,
    title,
    originalTitle,
    plot: xmlValues(xml, 'plot')[0] || '',
    premiered: xmlValues(xml, 'premiered')[0] || xmlValues(xml, 'releasedate')[0] || '',
    year: xmlValues(xml, 'year')[0] || '',
    studio: xmlValues(xml, 'studio')[0] || '',
    director: xmlValues(xml, 'director')[0] || '',
    actors,
    actorThumbs,
    genres: xmlValues(xml, 'genre'),
    tags: xmlValues(xml, 'tag'),
    censor: [...xmlValues(xml, 'genre'), ...xmlValues(xml, 'tag')].find((g) => ['有码', '无码', '無碼', '無修正'].includes(g)) || '',
    rating: xmlValues(xml, 'rating')[0] || '',
    adultId,
  };
}

function findNfoForFile(filePath) {
  const dir = path.dirname(filePath);
  const stem = path.basename(filePath, path.extname(filePath));
  const preferred = [
    path.join(dir, 'movie.nfo'),
    path.join(dir, `${stem}.nfo`),
  ];
  for (const p of preferred) {
    if (fs.existsSync(p)) return p;
  }
  try {
    const nfo = fs.readdirSync(dir).find((name) => name.toLowerCase().endsWith('.nfo'));
    return nfo ? path.join(dir, nfo) : '';
  } catch (_) {
    return '';
  }
}

function findImageForFile(filePath, base) {
  const dir = path.dirname(filePath);
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
    const p = path.join(dir, `${base}${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return '';
}

function imageExtFrom(contentType, url) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('png')) return '.png';
  if (ct.includes('webp')) return '.webp';
  if (ct.includes('jpeg') || ct.includes('jpg')) return '.jpg';
  const ext = path.extname(String(url || '').split('?')[0]).toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
}

function safePathName(value, fallback) {
  const cleaned = String(value || fallback || '')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return (cleaned || fallback || 'untitled').slice(0, 160);
}

function shouldOrganizeFolder(subLib, scraperConfig) {
  if (subLib.organizeAfterScrape !== undefined) return subLib.organizeAfterScrape !== false;
  if (scraperConfig.organizeAfterScrape !== undefined) return scraperConfig.organizeAfterScrape !== false;
  return true;
}

function movePathToDir(filePath, fromDir, toDir) {
  if (!filePath) return '';
  return path.join(toDir, path.relative(fromDir, filePath));
}

function organizeScrapedFolder(filePath, metadata, subLib, scraperConfig, onLog) {
  if (!shouldOrganizeFolder(subLib, scraperConfig)) {
    return { filePath, oldDir: path.dirname(filePath), newDir: path.dirname(filePath), renamed: false };
  }

  const oldDir = path.dirname(filePath);
  const watchRoot = path.resolve(subLib.watchRoot || '');
  const oldResolved = path.resolve(oldDir);
  if (!watchRoot || oldResolved === watchRoot) {
    onLog && onLog('warn', 'Folder organize skipped: media file is directly under watchRoot');
    return { filePath, oldDir, newDir: oldDir, renamed: false };
  }

  const targetName = safePathName(metadata.title || metadata.adultId, metadata.adultId || path.basename(oldDir));
  const newDir = path.join(path.dirname(oldDir), targetName);
  if (path.resolve(newDir) === oldResolved) {
    return { filePath, oldDir, newDir: oldDir, renamed: false };
  }
  if (fs.existsSync(newDir)) {
    throw new Error(`Target folder already exists: ${newDir}`);
  }

  fs.renameSync(oldDir, newDir);
  onLog && onLog('info', `Folder renamed to ${targetName}`);
  return {
    filePath: path.join(newDir, path.basename(filePath)),
    oldDir,
    newDir,
    renamed: true,
  };
}

async function downloadImage(url, outBase, subLib, taskId, opts = {}) {
  if (!url) return '';
  const japaneseJavScraper = require('./services/japaneseJavScraper');
  const config = configStore.loadConfig();
  const scraperConfig = {
    ...(((config.adultLibrary || {}).japaneseJav) || {}),
    ...(subLib.japaneseJav || {}),
    imageReferer: opts.referer || '',
  };
  const img = await japaneseJavScraper.fetchBinary(url, scraperConfig, taskId);
  const out = `${outBase}${imageExtFrom(img.contentType, img.finalUrl || url)}`;
  fs.writeFileSync(out, img.buffer);
  return out;
}

function splitResolution(resolution) {
  const [w, h] = String(resolution || '').split('x').map((x) => parseInt(x, 10) || 0);
  return { width: w, height: h };
}

function buildNfoXml(metadata, media = {}, opts = {}) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>',
    '<movie>',
    `  <title>${encodeXml(metadata.title)}</title>`,
  ];
  if (metadata.originalTitle) lines.push(`  <originaltitle>${encodeXml(metadata.originalTitle)}</originaltitle>`);
  if (metadata.plot) lines.push(`  <plot>${encodeXml(metadata.plot)}</plot>`);
  if (metadata.runtimeMinutes) lines.push(`  <runtime>${encodeXml(metadata.runtimeMinutes)}</runtime>`);
  lines.push('  <mpaa>NC-17</mpaa>');
  if (metadata.adultId) lines.push(`  <uniqueid type="num" default="true">${encodeXml(metadata.adultId)}</uniqueid>`);
  if (metadata.cid) lines.push(`  <uniqueid type="cid">${encodeXml(metadata.cid)}</uniqueid>`);
  for (const genre of metadata.genres || []) lines.push(`  <genre>${encodeXml(genre)}</genre>`);
  for (const tag of metadata.tags || []) lines.push(`  <tag>${encodeXml(tag)}</tag>`);
  if (metadata.censor && !(metadata.genres || []).includes(metadata.censor) && !(metadata.tags || []).includes(metadata.censor)) {
    lines.push(`  <genre>${encodeXml(metadata.censor)}</genre>`, `  <tag>${encodeXml(metadata.censor)}</tag>`);
  }
  if (metadata.country) lines.push(`  <country>${encodeXml(metadata.country)}</country>`);
  if (metadata.series) lines.push('  <set>', `    <name>${encodeXml(metadata.series)}</name>`, '  </set>');
  if (metadata.premiered) lines.push(`  <premiered>${encodeXml(metadata.premiered)}</premiered>`);
  if (metadata.studio) lines.push(`  <studio>${encodeXml(metadata.studio)}</studio>`);
  if (metadata.director) lines.push(`  <director>${encodeXml(metadata.director)}</director>`);
  if (metadata.rating) lines.push(`  <rating>${encodeXml(metadata.rating)}</rating>`);
  if (metadata.trailerUrl) lines.push(`  <trailer>${encodeXml(metadata.trailerUrl)}</trailer>`);
  for (const actor of metadata.actors || []) {
    lines.push('  <actor>', `    <name>${encodeXml(actor)}</name>`);
    const thumb = metadata.actorThumbs && metadata.actorThumbs[actor];
    if (thumb) lines.push(`    <thumb>${encodeXml(thumb)}</thumb>`);
    lines.push('  </actor>');
  }
  if (opts.includeFileInfo) {
    const { width, height } = splitResolution(media.resolution);
    const duration = Number(media.duration || metadata.runtimeMinutes * 60 || 0);
    const bitrate = Number(media.bitrate || 0);
    const aspect = width && height ? `${width}:${height}` : '';
    lines.push('  <fileinfo>', '    <streamdetails>', '      <video>');
    if (media.codec) lines.push(`        <codec>${encodeXml(media.codec)}</codec>`, `        <micodec>${encodeXml(media.codec)}</micodec>`);
    if (bitrate) lines.push(`        <bitrate>${encodeXml(bitrate)}</bitrate>`);
    if (width) lines.push(`        <width>${encodeXml(width)}</width>`);
    if (height) lines.push(`        <height>${encodeXml(height)}</height>`);
    if (aspect) lines.push(`        <aspect>${encodeXml(aspect)}</aspect>`, `        <aspectratio>${encodeXml(aspect)}</aspectratio>`);
    lines.push('        <scantype>progressive</scantype>', '        <default>True</default>', '        <forced>False</forced>');
    if (duration) lines.push(`        <duration>${encodeXml(Math.round(duration / 60))}</duration>`, `        <durationinseconds>${encodeXml(Math.round(duration))}</durationinseconds>`);
    lines.push('      </video>');
    for (const codec of media.audioCodecs || []) {
      lines.push('      <audio>', `        <codec>${encodeXml(codec)}</codec>`, `        <micodec>${encodeXml(codec)}</micodec>`, '        <scantype>progressive</scantype>', '        <default>True</default>', '        <forced>False</forced>', '      </audio>');
    }
    lines.push('    </streamdetails>', '  </fileinfo>');
  }
  lines.push('</movie>', '');
  return lines.join('\n');
}

function writeNfoFiles(filePath, metadata, media = {}) {
  const movieNfo = path.join(path.dirname(filePath), 'movie.nfo');
  const fileNfo = path.join(path.dirname(filePath), `${path.basename(filePath, path.extname(filePath))}.nfo`);
  fs.writeFileSync(movieNfo, buildNfoXml(metadata, media, { includeFileInfo: false }), 'utf8');
  fs.writeFileSync(fileNfo, buildNfoXml(metadata, media, { includeFileInfo: true }), 'utf8');
  return { movieNfo, fileNfo };
}

function collectMediaFiles(root, config, opts = {}) {
  const out = [];
  if (!root || !fs.existsSync(root)) return out;
  const includeIgnored = !!opts.includeIgnored;
  const subLib = opts.subLib || {};
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!includeIgnored && hasIgnoredSegment(p, subLib)) continue;
        walk(p);
      } else if (entry.isFile() && isMediaFile(p, config) && !isTemporaryFile(p)) {
        out.push(p);
      }
    }
  };
  walk(root);
  return out.sort((a, b) => a.localeCompare(b));
}

async function probeFile(filePath, config) {
  const stat = fs.statSync(filePath);
  try {
    const summary = await transcodeService.probeSummary(config, filePath);
    const bitrate = summary.durationSec > 0 ? Math.round((stat.size * 8) / summary.durationSec) : 0;
    return {
      size: stat.size,
      duration: Math.round(summary.durationSec || 0),
      bitrate,
      resolution: summary.width && summary.height ? `${summary.width}x${summary.height}` : '',
      codec: normalizeCodec(summary.videoCodec),
      audioCodecs: summary.audioCodec ? [String(summary.audioCodec).toLowerCase()] : [],
    };
  } catch (e) {
    return {
      size: stat.size,
      duration: 0,
      bitrate: 0,
      resolution: '',
      codec: '',
      audioCodecs: [],
      probeError: e.message,
    };
  }
}

function normalizeCodec(raw) {
  const c = String(raw || '').toLowerCase();
  if (c === 'hevc' || c.includes('h265') || c === 'h265') return 'h265';
  if (c === 'h264' || c === 'avc' || c.includes('h264')) return 'h264';
  if (c === 'av1') return 'av1';
  return c;
}

function computeBucket(resolution) {
  const parts = String(resolution || '').split('x');
  const w = parseInt(parts[0], 10) || 0;
  const h = parseInt(parts[1], 10) || 0;
  return (w >= 3840 || h >= 2160) ? '4K' : '1080p';
}

function itemInfoFromItem(item) {
  return {
    name: item.name,
    itemId: item.itemId,
    path: item.path,
    subLibraryId: item.subLibraryId,
    assetKey: item.assetKey,
    assetRootPath: item.assetRootPath,
    externalRefs: item.externalRefs,
    resolution: item.resolution,
    bitrate: item.bitrate,
    size: item.size,
    duration: item.duration,
    type: item.type,
    isDiscLike: !!item.isDiscLike,
    targetBitrate: item.targetBitrate,
    targetCodec: item.targetCodec,
    equivalentBitrate: item.equivalentBitrate,
    scraped: !!item.scraped,
    adultMetadata: item.adultMetadata,
  };
}

async function upsertFileItem(subLib, filePath, opts = {}) {
  const config = configStore.loadConfig();
  const nfo = parseNfo(findNfoForFile(filePath));
  // Pre-scraped NFO is authoritative → high confidence. Otherwise parse the
  // bare file path; an unknown maker prefix yields low confidence and the item
  // is parked 'ambiguous' instead of auto-scraping a possibly-wrong 番号.
  let adultId = '';
  let idConfidence = '';
  if (nfo && nfo.adultId) {
    adultId = nfo.adultId;
    idConfidence = 'high';
  } else {
    const detected = extractJavIdWithConfidence(filePath);
    adultId = detected.adultId;
    idConfidence = detected.confidence;
  }
  const meta = await probeFile(filePath, config);
  const lib = loadLibrary();
  const now = nowIso();
  const normPath = normalizePathForCompare(filePath);
  const sourceId = adultId || normPath;
  const assetKey = adultId
    ? `${subLib.uuid}:adult:${adultId.toLowerCase()}`
    : `${subLib.uuid}:path:${assetIdentity.stripKnownMediaExtension(normPath)}`;

  let idx = lib.items.findIndex((it) => it.subLibraryId === subLib.uuid && it.assetKey === assetKey);
  if (idx < 0) {
    idx = lib.items.findIndex((it) => it.subLibraryId === subLib.uuid && normalizePathForCompare(it.path) === normPath);
  }

  const displayName = (nfo && (nfo.title || nfo.originalTitle)) || adultId || path.basename(filePath, path.extname(filePath));
  const scrapeStatus = nfo ? 'done' : (idConfidence === 'low' ? 'ambiguous' : 'pending');
  const adultMetadata = {
    region: subLib.adultRegion || 'japanese_jav',
    scraperType: subLib.scraperType || 'shelfdeck_japanese_jav',
    adultId,
    idConfidence,
    title: nfo && nfo.title || '',
    originalTitle: nfo && nfo.originalTitle || '',
    plot: nfo && nfo.plot || '',
    studio: nfo && nfo.studio || '',
    director: nfo && nfo.director || '',
    actors: nfo && nfo.actors || [],
    actorThumbs: nfo && nfo.actorThumbs || {},
    tags: nfo && nfo.tags || [],
    genres: nfo && nfo.genres || [],
    censor: nfo && nfo.censor || '',
    rating: nfo && nfo.rating || '',
    premiered: nfo && nfo.premiered || '',
    nfoPath: nfo && nfo.nfoPath || '',
    posterPath: findImageForFile(filePath, 'poster'),
    fanartPath: findImageForFile(filePath, 'fanart'),
    scrapedAt: nfo ? now : null,
    scrapeStatus,
  };

  const base = {
    subLibraryId: subLib.uuid,
    name: displayName,
    path: filePath,
    source: 'adult_folder',
    sourceId,
    assetKey,
    assetRootPath: assetIdentity.inferAssetRootPath(filePath, false),
    externalRefs: { adultFolder: { path: filePath, adultId, lastSeenAt: now } },
    type: 'movie',
    bitrate: meta.bitrate || 0,
    duration: meta.duration || 0,
    resolution: meta.resolution || '',
    size: meta.size || 0,
    codec: meta.codec || '',
    audioCodecs: meta.audioCodecs || [],
    bucket: computeBucket(meta.resolution),
    premiereDate: adultMetadata.premiered || null,
    genres: adultMetadata.genres || [],
    scraped: nfo ? true : false,
    isDiscLike: false,
    watched: true,
    doubanId: null,
    doubanRating: null,
    doubanRatingUpdatedAt: null,
    userRating: null,
    userRatingUpdatedAt: null,
    lastRefreshedAt: now,
    adultMetadata,
  };

  let item;
  if (idx >= 0) {
    item = {
      ...lib.items[idx],
      ...base,
      action: lib.items[idx].action || 'keep',
      reason: lib.items[idx].reason || '成人库新入库',
    };
    lib.items[idx] = item;
  } else {
    item = {
      itemId: crypto.randomUUID(),
      ...base,
      action: 'keep',
      reason: '成人库新入库',
    };
    lib.items.push(item);
  }

  lib.cachedAt = now;
  saveLibrary(lib);

  // Put every newly discovered unscripted file into the scrape task flow. Even
  // low-confidence IDs are attempted; if the result is wrong the user can fix
  // the adult ID from the task center and re-scrape.
  if (opts.enqueueScrape !== false && !nfo && subLib.scrapeEnabled !== false) {
    enqueueScrapeTask(item, subLib);
  }

  return item;
}

async function applyScrapeResultToItem(subLib, item, metadata, opts = {}) {
  if (!item || !item.itemId) throw new Error('Adult library item is required');
  let filePath = item.path;
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`Media file does not exist: ${filePath || ''}`);

  const now = nowIso();
  const scraperConfig = {
    ...(((configStore.loadConfig().adultLibrary || {}).japaneseJav) || {}),
    ...(subLib.japaneseJav || {}),
  };
  const sourceDir = path.dirname(filePath);
  let nfoPaths = scraperConfig.writeNfo === false ? { movieNfo: '', fileNfo: '' } : writeNfoFiles(filePath, metadata, item);
  let posterPath = await downloadImage(metadata.posterUrl, path.join(sourceDir, scraperConfig.posterBasename || 'poster'), subLib, opts.taskId, { referer: metadata.sourceUrl });
  if (!posterPath || !fs.existsSync(posterPath)) {
    throw new Error('Poster download did not produce a local file');
  }
  let fanartPath = '';
  const onLog = typeof opts.onLog === 'function' ? opts.onLog : null;
  try {
    fanartPath = metadata.fanartUrl === metadata.posterUrl
      ? posterPath
      : await downloadImage(metadata.fanartUrl, path.join(sourceDir, scraperConfig.fanartBasename || 'fanart'), subLib, opts.taskId, { referer: metadata.sourceUrl });
  } catch (_) {
    if (onLog) onLog('warn', 'Fanart download failed; using poster if available');
    fanartPath = posterPath;
  }

  const organized = organizeScrapedFolder(filePath, metadata, subLib, scraperConfig, onLog);
  if (organized.renamed) {
    filePath = organized.filePath;
    nfoPaths = {
      movieNfo: movePathToDir(nfoPaths.movieNfo, organized.oldDir, organized.newDir),
      fileNfo: movePathToDir(nfoPaths.fileNfo, organized.oldDir, organized.newDir),
    };
    posterPath = movePathToDir(posterPath, organized.oldDir, organized.newDir);
    fanartPath = movePathToDir(fanartPath, organized.oldDir, organized.newDir);
  }

  const markerPath = path.join(path.dirname(filePath), '.shelfdeck.json');
  fs.writeFileSync(markerPath, JSON.stringify({
    itemId: item.itemId,
    subLibraryId: subLib.uuid,
    adultId: metadata.adultId,
    scraperType: subLib.scraperType || 'shelfdeck_japanese_jav',
    scrapeTaskId: opts.taskId || null,
    scrapedAt: now,
    source: metadata.source,
    sourceUrl: metadata.sourceUrl,
    mediaPath: filePath,
    organized: organized.renamed,
    originalFolder: organized.renamed ? organized.oldDir : '',
    nfoPath: nfoPaths.movieNfo,
    fileNfoPath: nfoPaths.fileNfo,
    posterPath,
    fanartPath,
  }, null, 2), 'utf8');

  const lib = loadLibrary();
  const idx = lib.items.findIndex((it) => it.itemId === item.itemId);
  if (idx < 0) throw new Error('Library item not found');
  const existing = lib.items[idx];
  const adultMetadata = {
    ...(existing.adultMetadata || {}),
    region: subLib.adultRegion || 'japanese_jav',
    scraperType: subLib.scraperType || 'shelfdeck_japanese_jav',
    adultId: metadata.adultId || (existing.adultMetadata && existing.adultMetadata.adultId) || '',
    title: metadata.title || '',
    originalTitle: metadata.originalTitle || '',
    plot: metadata.plot || '',
    studio: metadata.studio || '',
    director: metadata.director || '',
    actors: metadata.actors || [],
    actorThumbs: metadata.actorThumbs || {},
    tags: metadata.tags || [],
    genres: metadata.genres || [],
    censor: metadata.censor || '',
    rating: metadata.rating || '',
    premiered: metadata.premiered || '',
    source: metadata.source || '',
    sourceUrl: metadata.sourceUrl || '',
    nfoPath: nfoPaths.movieNfo,
    fileNfoPath: nfoPaths.fileNfo,
    posterPath,
    fanartPath,
    markerPath,
    organized: organized.renamed,
    originalFolder: organized.renamed ? organized.oldDir : '',
    scrapedAt: now,
    scrapeStatus: 'done',
  };

  const updated = {
    ...existing,
    name: metadata.title || existing.name,
    path: filePath,
    sourceId: adultMetadata.adultId || existing.sourceId,
    assetRootPath: assetIdentity.inferAssetRootPath(filePath, false),
    externalRefs: {
      ...(existing.externalRefs || {}),
      adultFolder: {
        ...((existing.externalRefs || {}).adultFolder || {}),
        path: filePath,
        adultId: adultMetadata.adultId,
        lastSeenAt: now,
      },
    },
    premiereDate: adultMetadata.premiered || existing.premiereDate || null,
    genres: adultMetadata.genres || [],
    scraped: true,
    adultMetadata,
    lastRefreshedAt: now,
  };
  lib.items[idx] = updated;
  lib.cachedAt = now;
  saveLibrary(lib);
  return updated;
}

function markScrapeFailed(itemId, message) {
  const lib = loadLibrary();
  const idx = lib.items.findIndex((it) => it.itemId === itemId);
  if (idx < 0) return null;
  const now = nowIso();
  const existing = lib.items[idx];
  const updated = {
    ...existing,
    scraped: false,
    adultMetadata: {
      ...(existing.adultMetadata || {}),
      scrapeStatus: 'failed',
      scrapeError: String(message || ''),
      scrapeFailedAt: now,
    },
    lastRefreshedAt: now,
  };
  lib.items[idx] = updated;
  lib.cachedAt = now;
  saveLibrary(lib);
  return updated;
}

function activeTaskForItem(itemId) {
  return taskStore.getTasks({ itemId }).find((t) => !TERMINAL.has(t.status));
}

// Reset a previously-failed (or pending) item so a fresh scrape attempt can run.
// Clears the stale scrapeError and flips scrapeStatus back to pending.
function resetScrapeStatus(itemId, overrideAdultId = null) {
  const lib = loadLibrary();
  const idx = lib.items.findIndex((it) => it.itemId === itemId);
  if (idx < 0) return null;
  const existing = lib.items[idx];
  let adultIdPatch = {};
  if (overrideAdultId) {
    const japaneseJavScraper = require('./services/japaneseJavScraper');
    const normalized = japaneseJavScraper.normalizeAdultId(overrideAdultId);
    const detected = extractJavIdWithConfidence(normalized);
    adultIdPatch = {
      adultId: detected.adultId || normalized,
      idConfidence: 'high',
    };
  }
  const updated = {
    ...existing,
    scraped: false,
    adultMetadata: {
      ...(existing.adultMetadata || {}),
      ...adultIdPatch,
      scrapeStatus: 'pending',
      scrapeError: '',
      scrapeFailedAt: null,
    },
    lastRefreshedAt: nowIso(),
  };
  lib.items[idx] = updated;
  lib.cachedAt = nowIso();
  saveLibrary(lib);
  return updated;
}

// Manual rescrape entry point: reset failure state, then enqueue a fresh scrape
// task (skipped if one is already active for the item). Returns the new task or
// null if a task is already active / scheduling is off / item is missing.
async function rescrapeItem(itemId, opts = {}) {
  const config = configStore.loadConfig();
  let item = null;
  for (const sl of config.subLibraries || []) {
    if (!isAdultFolderSubLibrary(sl)) continue;
    const lib = loadLibrary();
    const found = lib.items.find((it) => it.itemId === itemId && it.subLibraryId === sl.uuid);
    if (found) { item = { subLib: sl, item: found }; break; }
  }
  if (!item) throw new Error('Adult library item not found');
  const { subLib, item: libItem } = item;
  if (!subLib.watchRoot) throw new Error('watchRoot is not configured');
  if (!libItem.path || !fs.existsSync(libItem.path)) throw new Error(`Media file does not exist: ${libItem.path || ''}`);
  if (activeTaskForItem(itemId)) return null;
  // Optional user-provided 番号 override — lets the user correct a low-confidence
  // or wrong auto-detected ID before re-scraping.
  const overrideAdultId = typeof opts.overrideAdultId === 'string' ? opts.overrideAdultId.trim() : '';
  resetScrapeStatus(itemId, overrideAdultId || null);
  const fresh = loadLibrary().items.find((it) => it.itemId === itemId);
  // Manual rescrape is an explicit user intent: bypass the autoCreate gate that
  // governs automatic enqueuing. autoExecute still decides queued vs pending_manual.
  return enqueueScrapeTask(fresh || libItem, subLib, { force: true });
}

function enqueueScrapeTask(item, subLib, opts = {}) {
  if (activeTaskForItem(item.itemId)) return null;
  const cfg = configStore.loadConfig();
  const schedule = configStore.resolveSubLibSchedule(item, cfg);
  // autoCreate gates *automatic* enqueuing (watcher / scan / smart engine).
  // Manual rescrape passes force=true so an explicit user request always creates
  // a task regardless of the sub-library's autoCreate setting.
  if (!opts.force && !schedule.autoCreate) return null;
  const task = taskStore.createTask({
    itemId: item.itemId,
    itemName: item.name,
    actionType: 'scrape',
    status: schedule.autoExecute ? 'queued' : 'pending_manual',
    itemInfo: itemInfoFromItem(item),
    logs: [{ ts: nowIso(), level: 'info', msg: 'Scrape task created by adult folder watcher' }],
  });
  activityLog.addActivity('adult_library', `成人库「${subLib.name}」创建刮削任务：${item.name}`, { taskId: task.id, itemId: item.itemId });
  return task;
}

async function scanSubLibrary(subLib, opts = {}) {
  if (!isAdultFolderSubLibrary(subLib) || !subLib.watchRoot) return { scanned: 0, upserted: 0 };
  const config = configStore.loadConfig();
  const files = collectMediaFiles(subLib.watchRoot, config, { subLib, includeIgnored: !!opts.includeOrganized });
  let upserted = 0;
  for (const file of files) {
    await upsertFileItem(subLib, file, { enqueueScrape: opts.enqueueScrape !== false && !hasIgnoredSegment(file, subLib) });
    upserted++;
  }
  updateSubLibraryRefreshTime(subLib.uuid);
  return { scanned: files.length, upserted };
}

async function reconcileSubLibrary(subLib) {
  if (!isAdultFolderSubLibrary(subLib) || !subLib.watchRoot) return { scanned: 0, upserted: 0 };
  return scanSubLibrary(subLib, { includeOrganized: true, enqueueScrape: false });
}

function updateSubLibraryRefreshTime(uuid) {
  const cfg = configStore.loadConfig();
  const subLibs = cfg.subLibraries || [];
  const idx = subLibs.findIndex((s) => s.uuid === uuid);
  if (idx >= 0) {
    subLibs[idx].lastRefreshedAt = nowIso();
    configStore.patchConfig({ subLibraries: subLibs });
  }
}

async function refreshItemFromScrapedFiles(subLib, item) {
  await reconcileSubLibrary(subLib);
  const lib = loadLibrary();
  const adultId = item.adultMetadata && item.adultMetadata.adultId || extractJavId(item.path);
  const norm = normalizePathForCompare(item.path);
  let found = null;
  if (adultId) {
    found = lib.items.find((it) =>
      it.subLibraryId === subLib.uuid &&
      it.adultMetadata &&
      String(it.adultMetadata.adultId || '').toLowerCase() === adultId.toLowerCase() &&
      it.adultMetadata.scrapeStatus === 'done'
    );
  }
  if (!found) {
    found = lib.items.find((it) => it.subLibraryId === subLib.uuid && normalizePathForCompare(it.path) === norm);
  }
  return found || item;
}

function scheduleSettle(subLib, filePath) {
  const key = `${subLib.uuid}:${filePath}`;
  if (settleTimers.has(key)) clearTimeout(settleTimers.get(key));
  const cfg = configStore.loadConfig();
  const seconds = Number((cfg.adultLibrary && cfg.adultLibrary.settleSeconds) ?? 30);
  const timer = setTimeout(async () => {
    settleTimers.delete(key);
    try {
      if (!fs.existsSync(filePath)) return;
      await upsertFileItem(subLib, filePath, { enqueueScrape: true });
    } catch (e) {
      console.error('[adultLibrary] settle upsert failed:', e.message);
    }
  }, Math.max(1, seconds) * 1000);
  timer.unref && timer.unref();
  settleTimers.set(key, timer);
}

function startSubLibraryWatcher(subLib) {
  stopSubLibraryWatcher(subLib.uuid);
  if (!isAdultFolderSubLibrary(subLib) || !subLib.watchRoot) return;
  if (!fs.existsSync(subLib.watchRoot)) {
    console.warn('[adultLibrary] watch root does not exist:', subLib.watchRoot);
    return;
  }

  const ignored = (p) => hasIgnoredSegment(p, subLib) || isTemporaryFile(p);
  const watcher = chokidar.watch(subLib.watchRoot, {
    ignoreInitial: true,
    ignored,
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: Math.max(1000, Number(((configStore.loadConfig().adultLibrary || {}).settleSeconds) || 30) * 1000),
      pollInterval: 1000,
    },
  });

  watcher.on('add', (filePath) => {
    const cfg = configStore.loadConfig();
    if (isMediaFile(filePath, cfg)) scheduleSettle(subLib, filePath);
  });
  watcher.on('error', (err) => console.error('[adultLibrary] watcher error:', err.message));

  const intervalMin = Number(subLib.scanIntervalMinutes || (configStore.loadConfig().adultLibrary || {}).scanIntervalMinutes || 10);
  const interval = setInterval(() => {
    const cfg = configStore.loadConfig();
    const sl = (cfg.subLibraries || []).find((s) => s.uuid === subLib.uuid);
    if (isAdultFolderSubLibrary(sl)) {
      scanSubLibrary(sl).catch((e) => console.error('[adultLibrary] interval scan failed:', e.message));
    }
  }, Math.max(1, intervalMin) * 60000);
  interval.unref && interval.unref();

  watchers.set(subLib.uuid, { watcher, interval });
  scanSubLibrary(subLib).catch((e) => console.error('[adultLibrary] startup scan failed:', e.message));
}

function stopSubLibraryWatcher(uuid) {
  const rec = watchers.get(uuid);
  if (!rec) return;
  try { rec.watcher.close(); } catch (_) {}
  if (rec.interval) clearInterval(rec.interval);
  watchers.delete(uuid);
}

function startAllWatchers() {
  const cfg = configStore.loadConfig();
  for (const sl of cfg.subLibraries || []) {
    if (isAdultFolderSubLibrary(sl)) startSubLibraryWatcher(sl);
  }
}

function stopAllWatchers() {
  for (const uuid of [...watchers.keys()]) stopSubLibraryWatcher(uuid);
  for (const timer of settleTimers.values()) clearTimeout(timer);
  settleTimers.clear();
}

module.exports = {
  isAdultFolderSubLibrary,
  isJapaneseJavSubLibrary,
  startAllWatchers,
  stopAllWatchers,
  startSubLibraryWatcher,
  stopSubLibraryWatcher,
  scanSubLibrary,
  reconcileSubLibrary,
  refreshItemFromScrapedFiles,
  upsertFileItem,
  applyScrapeResultToItem,
  markScrapeFailed,
  resetScrapeStatus,
  rescrapeItem,
  itemInfoFromItem,
  extractJavId,
  parseNfo,
  findNfoForFile,
};
