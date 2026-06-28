'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const configStore = require('./configStore');
const taskStore = require('./taskStore');
const transcodeService = require('./services/transcodeService');
const activityLog = require('./activityLog');
const assetIdentity = require('./assetIdentity');
const mediaLibraryService = require('./mediaLibraryService');
const peopleStore = require('./peopleStore');
const priorityEngine = require('./priorityEngine');
const taskAdmission = require('./taskAdmission');
const scrapeVerification = require('./scrapeVerification');

const DEFAULT_EXTS = new Set(['.3gp', '.avi', '.f4v', '.flv', '.iso', '.m2ts', '.m4v', '.mkv', '.mov', '.mp4', '.mpeg', '.mpg', '.rm', '.rmvb', '.ts', '.vob', '.webm', '.wmv']);
const DEFAULT_ORGANIZED_FOLDER_NAME = 'scraped';
const TERMINAL = new Set(['done', 'failed_hard', 'cancelled', 'skipped', 'deleted']);

function loadLibrary() {
  return mediaLibraryService.loadLibrary();
}

function saveLibrary(lib) {
  mediaLibraryService.saveLibrary(lib);
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

function isWesternAdultSubLibrary(sl) {
  return isAdultFolderSubLibrary(sl) && sl.adultRegion === 'western_adult';
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
  const organizedName = organizedFolderName(subLib);
  return (ignoreName && segments.includes(String(ignoreName).toLowerCase()))
    || (organizedName && segments.includes(String(organizedName).toLowerCase()))
    || segments.includes('#不要扫描');
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

function mediaSiblingCount(filePath) {
  const dir = path.dirname(filePath);
  const cfg = configStore.loadConfig();
  let count = 0;
  try {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      try {
        if (fs.statSync(p).isFile() && isMediaFile(p, cfg) && !isTemporaryFile(p)) count += 1;
      } catch (_) {}
      if (count > 1) return count;
    }
  } catch (_) {}
  return count;
}

function imageExtFrom(contentType, url) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('png')) return '.png';
  if (ct.includes('webp')) return '.webp';
  if (ct.includes('jpeg') || ct.includes('jpg')) return '.jpg';
  const ext = path.extname(String(url || '').split('?')[0]).toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
}

function imageDimensions(filePath, config) {
  const ffprobe = transcodeService.resolveFfprobeBin(config);
  const out = execFileSync(ffprobe, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'json',
    filePath,
  ], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  const json = JSON.parse(out || '{}');
  const stream = (json.streams && json.streams[0]) || {};
  return { width: Number(stream.width || 0), height: Number(stream.height || 0) };
}

function computeRightCoverCrop(width, height) {
  const w = Number(width || 0);
  const h = Number(height || 0);
  if (!w || !h || w <= h) return null;
  // DMM/JavBus jacket images are laid out as back/spine/front. The front cover
  // is the right-most 147:200 slice, matching the source poster aspect.
  const cropWidth = Math.max(1, Math.min(w, Math.round(h * 147 / 200)));
  return { x: Math.max(0, w - cropWidth), y: 0, width: cropWidth, height: h };
}

function createPosterFromJacket(jacketPath, outBase, config) {
  const dims = imageDimensions(jacketPath, config);
  const crop = computeRightCoverCrop(dims.width, dims.height);
  const out = `${outBase}.jpg`;
  if (!crop) {
    fs.copyFileSync(jacketPath, out);
    return out;
  }
  const ffmpeg = transcodeService.resolveFfmpegBin(config);
  execFileSync(ffmpeg, [
    '-y',
    '-i', jacketPath,
    '-vf', `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`,
    '-frames:v', '1',
    '-q:v', '2',
    out,
  ], { windowsHide: true, timeout: 30000 });
  return out;
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

function cleanTitlePart(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildWesternTitle(metadata, item, config) {
  const actors = Array.isArray(metadata.actors) && metadata.actors.length > 0
    ? metadata.actors.join(', ')
    : 'Unknown Person';
  const description = cleanTitlePart(
    metadata.shortDescription ||
    metadata.generatedDescription ||
    metadata.sceneDescription ||
    metadata.description ||
    path.basename((item && item.path) || '', path.extname((item && item.path) || ''))
  ) || 'Scene';
  const template = String((config && config.titleTemplate) || '{actors} - {description}');
  return cleanTitlePart(template
    .replace(/\{actors\}/g, actors)
    .replace(/\{description\}/g, description)
    .replace(/\{resolution\}/g, (item && item.resolution) || '')
  ) || `${actors} - ${description}`;
}

function shouldOrganizeFolder(subLib, scraperConfig) {
  if (subLib.organizeAfterScrape !== undefined) return subLib.organizeAfterScrape !== false;
  if (scraperConfig.organizeAfterScrape !== undefined) return scraperConfig.organizeAfterScrape !== false;
  return true;
}

function organizedFolderName(subLib = {}, scraperConfig = {}) {
  const cfg = configStore.loadConfig();
  const adultCfg = (cfg && cfg.adultLibrary) || {};
  const regionDefaults = isWesternAdultSubLibrary(subLib)
    ? (adultCfg.western || {})
    : (adultCfg.japaneseJav || {});
  const raw = subLib.organizedFolderName
    || subLib.scrapedFolderName
    || scraperConfig.organizedFolderName
    || regionDefaults.organizedFolderName
    || adultCfg.organizedFolderName
    || DEFAULT_ORGANIZED_FOLDER_NAME;
  return safePathName(raw, DEFAULT_ORGANIZED_FOLDER_NAME);
}

function organizeScrapedFolder(filePath, metadata, subLib, scraperConfig, onLog) {
  if (!shouldOrganizeFolder(subLib, scraperConfig)) {
    return { filePath, oldDir: path.dirname(filePath), newDir: path.dirname(filePath), renamed: false };
  }

  const oldDir = path.dirname(filePath);
  const watchRoot = path.resolve(subLib.watchRoot || '');
  if (!watchRoot) {
    return { filePath, oldDir, newDir: oldDir, renamed: false };
  }

  const targetName = safePathName(metadata.folderName || metadata.title || metadata.adultId, metadata.adultId || path.basename(oldDir));
  const targetRoot = path.join(watchRoot, organizedFolderName(subLib, scraperConfig));
  const newDir = path.join(targetRoot, targetName);
  const fileName = metadata.mediaFileName
    ? `${safePathName(metadata.mediaFileName, path.basename(filePath, path.extname(filePath)))}${path.extname(filePath)}`
    : path.basename(filePath);
  const newFilePath = path.join(newDir, fileName);
  if (path.resolve(filePath) === path.resolve(newFilePath)) return { filePath, oldDir, newDir: oldDir, renamed: false };
  if (fs.existsSync(newDir)) {
    throw new Error(`Target folder already exists: ${newDir}`);
  }

  fs.mkdirSync(newDir, { recursive: true });
  fs.renameSync(filePath, newFilePath);
  onLog && onLog('info', `Movie folder created under ${path.basename(targetRoot)}: ${targetName}`);
  return {
    filePath: newFilePath,
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
    const adultCfg = (config && config.adultLibrary) || {};
    const timeoutMs = Number(adultCfg.probeTimeoutMs) > 0 ? Number(adultCfg.probeTimeoutMs) : 5000;
    const summary = await transcodeService.probeSummary(config, filePath, { timeoutMs });
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

function isGenericWesternTitle(value) {
  const s = String(value || '').trim();
  return /^unknown person\b/i.test(s) || /possibly a scene from a movie or tv show/i.test(s);
}

function fallbackWesternItemName(item) {
  const fileBase = item && item.path ? path.basename(item.path, path.extname(item.path)) : '';
  return fileBase || (item && item.adultMetadata && item.adultMetadata.adultId) || (item && item.itemId) || '未命名成人影片';
}

function repairInvalidWesternScrapeState(opts = {}) {
  const cfg = configStore.loadConfig();
  const subLibById = new Map((cfg.subLibraries || []).map((sl) => [sl.uuid, sl]));
  const lib = loadLibrary();
  const now = nowIso();
  let repaired = 0;

  for (let i = 0; i < (lib.items || []).length; i++) {
    const item = lib.items[i];
    if (!item || item.source !== 'adult_folder') continue;
    const subLib = subLibById.get(item.subLibraryId);
    const region = (item.adultMetadata && item.adultMetadata.region) || (subLib && subLib.adultRegion) || '';
    if (region !== 'western_adult') continue;
    if (item.scraped !== true && (!item.adultMetadata || item.adultMetadata.scrapeStatus !== 'done')) continue;

    const verification = scrapeVerification.verifyScrapedItem(item, {
      config: cfg,
      subLib,
      requireTaskDone: false,
    });
    if (verification.ok) continue;

    const existingMeta = item.adultMetadata || {};
    const genericTitle = isGenericWesternTitle(item.name) || isGenericWesternTitle(existingMeta.title);
    const nextMeta = {
      ...existingMeta,
      title: genericTitle ? '' : existingMeta.title,
      scrapeStatus: 'failed',
      reviewStatus: 'needs_review',
      scrapeError: `Scrape verification failed: ${verification.failures.map((f) => f.message).join('; ')}`,
      scrapeFailedAt: now,
      scrapeVerification: {
        ok: false,
        checkedAt: verification.checkedAt,
        failures: verification.failures,
        warnings: verification.warnings,
      },
    };
    lib.items[i] = {
      ...item,
      name: genericTitle ? fallbackWesternItemName(item) : item.name,
      scraped: false,
      adultMetadata: nextMeta,
      lastRefreshedAt: now,
    };
    repaired++;
  }

  if (repaired > 0) {
    lib.cachedAt = now;
    saveLibrary(lib);
    if (!opts.silent) {
      activityLog.addActivity('adult_library', `已修正 ${repaired} 条不符合刮削成功合同的欧美成人库旧数据`, { repaired });
      console.log(`[adultLibrary] repaired invalid western scrape state: ${repaired}`);
    }
  }
  return { repaired };
}

async function upsertFileItem(subLib, filePath, opts = {}) {
  const config = configStore.loadConfig();
  const nfo = parseNfo(findNfoForFile(filePath));
  // Pre-scraped NFO is authoritative → high confidence. Otherwise parse the
  // bare file path; an unknown maker prefix yields low confidence and the item
  // is parked 'ambiguous' instead of auto-scraping a possibly-wrong 番号.
  const westernAdult = isWesternAdultSubLibrary(subLib);
  let adultId = '';
  let idConfidence = '';
  if (westernAdult) {
    adultId = nfo && nfo.adultId || '';
    idConfidence = adultId ? 'high' : '';
    // No pre-existing 番号 (NFO) → assign a temporary UNK-NNN placeholder.
    // This is metadata, replaced with an actor-encoded 番号 once the worker
    // names a protagonist on scrape success. If the worker finds no protagonist,
    // the item stays UNK and the scrape fails (mirroring JAV scrape failure).
    if (!adultId) {
      const seq = nextUnknownSequence(config, subLib);
      const cfg = westernCfg(config, subLib);
      adultId = `${cfg.idPrefix || 'UNK'}-${padSeq(seq, cfg.sequencePad)}`;
    }
  } else if (nfo && nfo.adultId) {
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

  // Adult library identity: itemId (UUID) is the immutable surrogate primary key.
  // assetKey is built from itemId, NEVER from the 番号 (adultId). The 番号 lives
  // in adultMetadata.adultId as mutable metadata (scraped for JAV, self-assigned
  // and actor-encoded for western). This keeps the same item stable across
  // renumbering, renaming, and organize operations.
  //
  // Lookup order for upsert:
  //   1. existing item by path fallback (file may have moved; identity follows
  //      the file, not a derived key)
  //   2. brand new item — assign itemId first, then derive assetKey from it
  // For an existing item the assetKey is rewritten from its own itemId so legacy
  // items (whose assetKey was derived from 番号) are migrated on first scan.
  // (Western library is brand new; JAV library is remounted fresh in production,
  //  so no cross-version migration script is needed.)
  let idx = lib.items.findIndex((it) => it.subLibraryId === subLib.uuid && normalizePathForCompare(it.path) === normPath);
  const itemId = idx >= 0 ? (lib.items[idx].itemId || crypto.randomUUID()) : crypto.randomUUID();
  const assetKey = `${subLib.uuid}:adult:${String(itemId).toLowerCase()}`;
  const sourceId = adultId || normPath;

  const displayName = (nfo && (nfo.title || nfo.originalTitle)) || adultId || path.basename(filePath, path.extname(filePath));
  const scrapeStatus = nfo ? 'done' : (westernAdult ? 'pending' : (idConfidence === 'low' ? 'ambiguous' : 'pending'));
  const adultMetadata = {
    region: subLib.adultRegion || 'japanese_jav',
    scraperType: subLib.scraperType || (westernAdult ? 'western_builtin' : 'shelfdeck_japanese_jav'),
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
  if (westernAdult) {
    adultMetadata.reviewStatus = nfo ? 'approved' : 'pending';
    adultMetadata.ai = {};
    adultMetadata.faceClusters = [];
    adultMetadata.unknownFaces = [];
  }

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
      itemId, // preserve the canonical itemId (surrogate key)
      action: lib.items[idx].action || 'keep',
      reason: lib.items[idx].reason || '成人库新入库',
    };
    lib.items[idx] = item;
  } else {
    item = {
      itemId,
      ...base,
      action: 'keep',
      reason: '成人库新入库',
    };
    lib.items.push(item);
  }

  lib.cachedAt = now;
  saveLibrary(lib);

  // Ingest may request a follow-up scrape, but automatic creation is still
  // gated by the global TaskAdmission allow-list and queue policy.
  if (opts.enqueueScrape !== false && !nfo) {
    enqueueScrapeTask(item, subLib, { source: opts.source });
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
  if (metadata.title || metadata.adultId) {
    metadata.mediaFileName = metadata.title || metadata.adultId;
  }
  const onLog = typeof opts.onLog === 'function' ? opts.onLog : null;
  const organized = organizeScrapedFolder(filePath, metadata, subLib, scraperConfig, onLog);
  if (organized.renamed) {
    filePath = organized.filePath;
  }
  const sourceDir = path.dirname(filePath);
  let nfoPaths = scraperConfig.writeNfo === false ? { movieNfo: '', fileNfo: '' } : writeNfoFiles(filePath, metadata, item);
  let fanartPath = '';
  let posterPath = '';
  if (metadata.posterCrop === 'right_cover') {
    fanartPath = await downloadImage(metadata.fanartUrl || metadata.posterUrl, path.join(sourceDir, scraperConfig.fanartBasename || 'fanart'), subLib, opts.taskId, { referer: metadata.sourceUrl });
    if (!fanartPath || !fs.existsSync(fanartPath)) {
      throw new Error('Fanart download did not produce a local jacket file for poster crop');
    }
    posterPath = createPosterFromJacket(fanartPath, path.join(sourceDir, scraperConfig.posterBasename || 'poster'), configStore.loadConfig());
  } else {
    posterPath = await downloadImage(metadata.posterUrl, path.join(sourceDir, scraperConfig.posterBasename || 'poster'), subLib, opts.taskId, { referer: metadata.sourceUrl });
    try {
      fanartPath = metadata.fanartUrl === metadata.posterUrl
        ? posterPath
        : await downloadImage(metadata.fanartUrl, path.join(sourceDir, scraperConfig.fanartBasename || 'fanart'), subLib, opts.taskId, { referer: metadata.sourceUrl });
    } catch (_) {
      if (onLog) onLog('warn', 'Fanart download failed; using poster if available');
      fanartPath = posterPath;
    }
  }
  if (!posterPath || !fs.existsSync(posterPath)) {
    throw new Error('Poster download did not produce a local file');
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
  const verification = scrapeVerification.verifyScrapedItem(updated, {
    config: configStore.loadConfig(),
    subLib,
    scrapeTaskId: opts.taskId,
    requireTaskDone: false,
  });
  if (!verification.ok) {
    throw new Error(`Scrape verification failed: ${verification.failures.map((f) => f.message).join('; ')}`);
  }
  updated.adultMetadata = {
    ...updated.adultMetadata,
    scrapeVerification: {
      ok: true,
      checkedAt: verification.checkedAt,
      warnings: verification.warnings,
    },
  };
  lib.items[idx] = updated;
  lib.cachedAt = now;
  saveLibrary(lib);
  return updated;
}

function writeImagePayload(outBase, payload, fallbackExt = '.jpg') {
  if (!payload) return '';
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return '';
    const dataUri = trimmed.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/);
    const ext = dataUri ? `.${dataUri[1].toLowerCase().replace('jpeg', 'jpg')}` : fallbackExt;
    const raw = dataUri ? dataUri[2] : trimmed;
    const out = `${outBase}${ext}`;
    fs.writeFileSync(out, Buffer.from(raw, 'base64'));
    return out;
  }
  if (payload && payload.base64) {
    const ext = imageExtFrom(payload.contentType, payload.filename || '') || fallbackExt;
    const out = `${outBase}${ext}`;
    fs.writeFileSync(out, Buffer.from(String(payload.base64), 'base64'));
    return out;
  }
  return '';
}

function copyImageIfAccessible(sourcePath, outBase) {
  const src = String(sourcePath || '').trim();
  if (!src || !fs.existsSync(src)) return '';
  const ext = ['.jpg', '.jpeg', '.png', '.webp'].includes(path.extname(src).toLowerCase())
    ? path.extname(src).toLowerCase()
    : '.jpg';
  const out = `${outBase}${ext}`;
  fs.copyFileSync(src, out);
  return out;
}

async function applyWesternCurationResultToItem(subLib, item, curation, opts = {}) {
  if (!item || !item.itemId) throw new Error('Adult library item is required');
  let filePath = item.path;
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`Media file does not exist: ${filePath || ''}`);

  const config = configStore.loadConfig();
  const westernConfig = {
    ...(((config.adultLibrary || {}).western) || {}),
    ...(subLib.western || {}),
  };
  const now = nowIso();
  const onLog = typeof opts.onLog === 'function' ? opts.onLog : null;

  // Protagonist-driven 番号. The worker reports the machine-chosen protagonist
  // (highest avgFaceArea×frameCount among named clusters). If present we mint a
  // stable {CODE}-{seq} 番号; otherwise the item keeps its UNK-NNN placeholder
  // and the caller marks the scrape as failed (mirrors JAV scrape failure).
  const protagonist = curation.protagonist || pickProtagonist(curation.faceClusters);
  const existingAdultId = (item.adultMetadata && item.adultMetadata.adultId) || '';
  const assigned = assignWesternAdultId(config, subLib, protagonist, existingAdultId, { filePath });
  const finalAdultId = assigned ? assigned.adultId : (item.adultMetadata && item.adultMetadata.adultId) || curation.adultId || '';
  const protagonistName = assigned ? assigned.actorName : '';

  const metadata = {
    source: 'western_builtin',
    sourceUrl: '',
    adultId: finalAdultId,
    title: cleanTitlePart(curation.title || curation.generatedTitle || (protagonistName ? `${protagonistName} - ${finalAdultId}` : buildWesternTitle(curation, item, westernConfig))),
    originalTitle: cleanTitlePart(finalAdultId || curation.originalTitle || path.basename(filePath, path.extname(filePath))),
    plot: cleanTitlePart(curation.plot || curation.generatedDescription || curation.summary || curation.safeSummary || curation.description || ''),
    runtimeMinutes: item.duration ? Math.round(Number(item.duration) / 60) : undefined,
    studio: cleanTitlePart(curation.studio || ''),
    director: cleanTitlePart(curation.director || ''),
    actors: Array.isArray(curation.actors) ? curation.actors.map(cleanTitlePart).filter(Boolean) : [],
    actorThumbs: curation.actorThumbs || {},
    genres: Array.isArray(curation.genres) ? curation.genres.map(cleanTitlePart).filter(Boolean) : [],
    tags: Array.isArray(curation.tags) ? curation.tags.map(cleanTitlePart).filter(Boolean) : [],
    rating: curation.rating || '',
    premiered: curation.premiered || '',
    country: curation.country || '',
    series: protagonistName || curation.series || '',
  };
  if (metadata.adultId && protagonistName) {
    metadata.folderName = `${metadata.adultId} ${protagonistName}`;
    metadata.mediaFileName = `${metadata.adultId} ${protagonistName}`;
  }
  if (!metadata.title) metadata.title = buildWesternTitle(metadata, item, westernConfig);
  // Surface the scrape outcome so the executor can decide done vs failed.
  opts.__hasProtagonist = !!assigned;

  if (!opts.__hasProtagonist) {
    const lib = loadLibrary();
    const idx = lib.items.findIndex((it) => it.itemId === item.itemId);
    if (idx < 0) throw new Error('Library item not found');
    const existing = lib.items[idx];
    const adultMetadata = {
      ...(existing.adultMetadata || {}),
      region: 'western_adult',
      scraperType: subLib.scraperType || 'western_builtin',
      adultId: finalAdultId,
      scrapeStatus: 'needs_review',
      reviewStatus: 'needs_review',
      generatedTitle: curation.generatedTitle || metadata.title,
      generatedDescription: curation.generatedDescription || curation.description || '',
      scene: curation.scene || {},
      safetyFlags: curation.safetyFlags || {},
      faceClusters: Array.isArray(curation.faceClusters) ? curation.faceClusters : [],
      unknownFaces: Array.isArray(curation.unknownFaces) ? curation.unknownFaces : [],
      actorConfidence: curation.actorConfidence || {},
      protagonist: null,
      galleryImages: Array.isArray(curation.galleryImages) ? curation.galleryImages : [],
      ai: curation.ai || {},
    };
    const updated = {
      ...existing,
      scraped: false,
      adultMetadata,
      lastRefreshedAt: now,
    };
    lib.items[idx] = updated;
    lib.cachedAt = now;
    saveLibrary(lib);
    return updated;
  }

  const organized = organizeScrapedFolder(filePath, metadata, subLib, westernConfig, onLog);
  if (organized.renamed) {
    filePath = organized.filePath;
  }

  let nfoPaths = westernConfig.writeNfo === false ? { movieNfo: '', fileNfo: '' } : writeNfoFiles(filePath, metadata, item);
  let posterPath = '';
  let fanartPath = '';
  try {
    posterPath = writeImagePayload(path.join(path.dirname(filePath), westernConfig.posterBasename || 'poster'), curation.posterImageBase64 || curation.posterImage)
      || copyImageIfAccessible(curation.posterPath, path.join(path.dirname(filePath), westernConfig.posterBasename || 'poster'));
  } catch (e) {
    if (onLog) onLog('warn', `Poster write failed: ${e.message}`);
  }
  try {
    fanartPath = writeImagePayload(path.join(path.dirname(filePath), westernConfig.fanartBasename || 'fanart'), curation.fanartImageBase64 || curation.fanartImage)
      || copyImageIfAccessible(curation.fanartPath, path.join(path.dirname(filePath), westernConfig.fanartBasename || 'fanart'));
  } catch (e) {
    if (onLog) onLog('warn', `Fanart write failed: ${e.message}`);
  }
  if (!fanartPath) fanartPath = posterPath;

  // Scrape succeeds only when a protagonist was named. No protagonist = the
  // worker couldn't identify a lead actor; this is the western equivalent of a
  // JAV scrape that couldn't resolve a 番号, and is treated the same way
  // (the executor marks the task failed_hard; remediation is rescrape).
  const hasProtagonist = !!assigned;
  const needsReview = !hasProtagonist || !!westernConfig.reviewRequired;
  const reviewStatus = needsReview ? 'needs_review' : 'approved';
  const markerPath = path.join(path.dirname(filePath), '.shelfdeck.json');
  fs.writeFileSync(markerPath, JSON.stringify({
    itemId: item.itemId,
    subLibraryId: subLib.uuid,
    scraperType: subLib.scraperType || 'western_builtin',
    scrapeTaskId: opts.taskId || null,
    scrapedAt: now,
    source: 'western_builtin',
    mediaPath: filePath,
    organized: organized.renamed,
    originalFolder: organized.renamed ? organized.oldDir : '',
    nfoPath: nfoPaths.movieNfo,
    fileNfoPath: nfoPaths.fileNfo,
    posterPath,
    fanartPath,
    reviewStatus,
    ai: curation.ai || {},
  }, null, 2), 'utf8');

  const lib = loadLibrary();
  const idx = lib.items.findIndex((it) => it.itemId === item.itemId);
  if (idx < 0) throw new Error('Library item not found');
  const existing = lib.items[idx];
  const adultMetadata = {
    ...(existing.adultMetadata || {}),
    region: 'western_adult',
    scraperType: subLib.scraperType || 'western_builtin',
    adultId: metadata.adultId,
    title: metadata.title,
    originalTitle: metadata.originalTitle,
    plot: metadata.plot,
    studio: metadata.studio,
    director: metadata.director,
    actors: metadata.actors,
    actorThumbs: metadata.actorThumbs,
    tags: metadata.tags,
    genres: metadata.genres,
    rating: metadata.rating,
    premiered: metadata.premiered,
    source: 'western_builtin',
    sourceUrl: '',
    nfoPath: nfoPaths.movieNfo,
    fileNfoPath: nfoPaths.fileNfo,
    posterPath,
    fanartPath,
    markerPath,
    organized: organized.renamed,
    originalFolder: organized.renamed ? organized.oldDir : '',
    scrapedAt: now,
    scrapeStatus: needsReview ? 'needs_review' : 'done',
    reviewStatus,
    generatedTitle: curation.generatedTitle || metadata.title,
    generatedDescription: curation.generatedDescription || curation.description || '',
    scene: curation.scene || {},
    safetyFlags: curation.safetyFlags || {},
    faceClusters: Array.isArray(curation.faceClusters) ? curation.faceClusters : [],
    unknownFaces: Array.isArray(curation.unknownFaces) ? curation.unknownFaces : [],
    actorConfidence: curation.actorConfidence || {},
    protagonist: assigned ? {
      personId: assigned.actorPersonId,
      name: assigned.actorName,
      adultId: assigned.adultId,
    } : null,
    galleryImages: Array.isArray(curation.galleryImages) ? curation.galleryImages : [],
    ai: curation.ai || {},
  };

  const updated = {
    ...existing,
    name: metadata.title || existing.name,
    path: filePath,
    sourceId: existing.sourceId || normalizePathForCompare(filePath),
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
    scraped: !needsReview,
    adultMetadata,
    lastRefreshedAt: now,
  };
  const verification = scrapeVerification.verifyScrapedItem(updated, {
    config,
    subLib,
    scrapeTaskId: opts.taskId,
    requireTaskDone: false,
  });
  if (!verification.ok) {
    throw new Error(`Scrape verification failed: ${verification.failures.map((f) => f.message).join('; ')}`);
  }
  updated.adultMetadata = {
    ...updated.adultMetadata,
    scrapeVerification: {
      ok: true,
      checkedAt: verification.checkedAt,
      warnings: verification.warnings,
    },
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

function ingestTaskItemId(subLib, filePath) {
  const norm = normalizePathForCompare(filePath);
  const digest = crypto.createHash('sha1').update(`${subLib.uuid}:${norm}`).digest('hex').slice(0, 24);
  return `ingest:${subLib.uuid}:${digest}`;
}

function findExistingItemByFilePath(subLib, filePath) {
  const norm = normalizePathForCompare(filePath);
  const lib = loadLibrary();
  return lib.items.find((it) => it.subLibraryId === subLib.uuid && normalizePathForCompare(it.path) === norm) || null;
}

function ingestItemInfo(subLib, filePath) {
  const name = path.basename(filePath, path.extname(filePath));
  return {
    itemId: ingestTaskItemId(subLib, filePath),
    name,
    path: filePath,
    subLibraryId: subLib.uuid,
    source: 'adult_folder',
    mediaType: 'adult',
    adultRegion: subLib.adultRegion || 'japanese_jav',
    scraperType: subLib.scraperType || '',
    assetRootPath: assetIdentity.inferAssetRootPath(filePath, false),
  };
}

function enqueueIngestTask(subLib, filePath, opts = {}) {
  const cfg = configStore.loadConfig();
  const source = opts.source || (opts.force ? 'manual' : 'auto');
  const userInitiated = source === 'manual';
  const itemInfo = ingestItemInfo(subLib, filePath);
  itemInfo.taskSource = source;
  const schedule = configStore.resolveSubLibSchedule(itemInfo, cfg);
  const taskSnapshot = Array.isArray(opts.taskSnapshot) ? opts.taskSnapshot : null;
  const admission = taskAdmission.canCreateTask({
    item: itemInfo,
    itemInfo,
    actionType: 'ingest',
    source,
    config: cfg,
    tasks: taskSnapshot || taskStore.getTasks(),
  });
  if (!admission.allowed) return null;
  const taskData = {
    itemId: itemInfo.itemId,
    itemName: itemInfo.name,
    actionType: 'ingest',
    status: userInitiated || schedule.autoExecute ? 'queued' : 'pending_manual',
    priority: priorityEngine.computePriority({
      source: userInitiated ? 'manual' : 'auto',
      actionType: 'ingest',
      itemInfo,
      config: cfg,
    }),
    itemInfo,
    logs: [{ ts: nowIso(), level: 'info', msg: userInitiated ? 'Ingest task created by user action' : 'Ingest task created by background admission' }],
  };
  const task = opts.deferSave ? taskStore.buildTask(taskData) : taskStore.createTask(taskData);
  if (taskSnapshot) taskSnapshot.push(task);
  activityLog.addActivity('adult_library', `成人库「${subLib.name}」创建入库任务：${itemInfo.name}`, { taskId: task.id, itemId: itemInfo.itemId });
  return task;
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
  const cfg = configStore.loadConfig();
  const schedule = configStore.resolveSubLibSchedule(item, cfg);
  const source = opts.source || (opts.force ? 'manual' : 'auto');
  const userInitiated = source === 'manual';
  const itemInfo = itemInfoFromItem(item);
  itemInfo.taskSource = source;
  const taskSnapshot = Array.isArray(opts.taskSnapshot) ? opts.taskSnapshot : null;
  const admission = taskAdmission.canCreateTask({
    item,
    itemInfo,
    actionType: 'scrape',
    source,
    config: cfg,
    tasks: taskSnapshot || taskStore.getTasks(),
  });
  if (!admission.allowed) return null;
  const taskData = {
    itemId: item.itemId,
    itemName: item.name,
    actionType: 'scrape',
    status: userInitiated || schedule.autoExecute ? 'queued' : 'pending_manual',
    priority: priorityEngine.computePriority({
      source: userInitiated ? 'manual' : 'auto',
      actionType: 'scrape',
      itemInfo,
      config: cfg,
    }),
    itemInfo,
    logs: [{ ts: nowIso(), level: 'info', msg: userInitiated ? 'Scrape task created by user action' : 'Scrape task created by background admission' }],
  };
  const task = opts.deferSave ? taskStore.buildTask(taskData) : taskStore.createTask(taskData);
  if (taskSnapshot) taskSnapshot.push(task);
  activityLog.addActivity('adult_library', `成人库「${subLib.name}」创建刮削任务：${item.name}`, { taskId: task.id, itemId: item.itemId });
  return task;
}

async function scanSubLibrary(subLib, opts = {}) {
  if (!isAdultFolderSubLibrary(subLib) || !subLib.watchRoot) return { scanned: 0, upserted: 0, queued: 0, scrapeQueued: 0 };
  const config = configStore.loadConfig();
  const files = collectMediaFiles(subLib.watchRoot, config, { subLib, includeIgnored: !!opts.includeOrganized });
  const lib = loadLibrary();
  const existingByPath = new Map();
  for (const item of lib.items || []) {
    if (item && item.subLibraryId === subLib.uuid && item.path) {
      existingByPath.set(normalizePathForCompare(item.path), item);
    }
  }
  let existing = 0;
  for (const file of files) {
    const existingItem = existingByPath.get(normalizePathForCompare(file)) || null;
    if (existingItem) {
      existing++;
    }
  }
  updateSubLibraryRefreshTime(subLib.uuid);
  return { scanned: files.length, upserted: existing, queued: 0, scrapeQueued: 0 };
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

function startSubLibraryWatcher(subLib) {
  // Directory discovery is no longer owned by the adult library module.
  // Explicit item actions such as rescrape still live here, but folder-wide
  // scan/watch auto-enqueue must not run as an adult-library-private loop.
  void subLib;
}

function stopSubLibraryWatcher(uuid) {
  void uuid;
}

function startAllWatchers() {
  // No-op by design. See startSubLibraryWatcher().
}

function stopAllWatchers() {
  // No-op by design. See startSubLibraryWatcher().
}

module.exports = {
  isAdultFolderSubLibrary,
  isJapaneseJavSubLibrary,
  isWesternAdultSubLibrary,
  startAllWatchers,
  stopAllWatchers,
  startSubLibraryWatcher,
  stopSubLibraryWatcher,
  scanSubLibrary,
  reconcileSubLibrary,
  refreshItemFromScrapedFiles,
  upsertFileItem,
  enqueueIngestTask,
  ingestTaskItemId,
  applyScrapeResultToItem,
  applyWesternCurationResultToItem,
  markScrapeFailed,
  repairInvalidWesternScrapeState,
  resetScrapeStatus,
  rescrapeItem,
  itemInfoFromItem,
  extractJavId,
  computeRightCoverCrop,
  parseNfo,
  findNfoForFile,
  assignWesternAdultId,
  nextUnknownSequence,
  nextActorSequence,
  pickProtagonist,
};

// ── Western self-assigned 番号 ──────────────────────────────────────────────
// The 番号 (adultId) is metadata, not the primary key. It encodes the actor so
// the user can recognize a film at a glance (SKDI-007 = Skin Diamond's 7th).
// Lifecycle mirrors the JAV library: a scrape either succeeds (protagonist
// named -> stable 番号) or fails (no protagonist -> UNK-NNN, scraped=false).
// Remediation is rescrape, never local backfill.

function westernCfg(config, subLib) {
  return {
    ...(((config.adultLibrary || {}).western) || {}),
    ...((subLib && subLib.western) || {}),
  };
}

// Monotonic UNK sequence per western sub-library. Stored on the sub-library so
// each library has its own UNK pool. Gaps are never recycled.
function nextUnknownSequence(config, subLib) {
  const subLibs = config.subLibraries || [];
  const idx = subLibs.findIndex((s) => s.uuid === subLib.uuid);
  if (idx < 0) return 1;
  const next = (Number(subLibs[idx].westernUnknownSequence) || 0) + 1;
  subLibs[idx].westernUnknownSequence = next;
  configStore.patchConfig({ subLibraries: subLibs });
  return next;
}

// Per-actor sequence for the {CODE}-{NNN} form. Stored on the person.
function nextActorSequence(personId) {
  const data = peopleStore.loadPeople();
  const p = data.people.find((x) => x.personId === personId);
  if (!p) return 1;
  const next = (Number(p.sequenceNumber) || 0) + 1;
  p.sequenceNumber = next;
  // Persist back through peopleStore by rewriting the file.
  const fs = require('fs');
  const file = path.join(configStore.resolveDataDir(), 'people.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, people: data.people }, null, 2), 'utf8');
  return next;
}

function padSeq(n, pad) {
  return String(n).padStart(Math.max(1, Number(pad) || 3), '0');
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Assign the 番号 for a western item based on the worker's protagonist result.
// Returns { adultId, actorName, actorPersonId } or null if no protagonist.
function assignWesternAdultId(config, subLib, protagonist, existingAdultId = '', opts = {}) {
  const cfg = westernCfg(config, subLib);
  if (!protagonist || !protagonist.personId || !protagonist.name) {
    return null; // caller falls back to UNK-NNN
  }
  const data = peopleStore.loadPeople();
  const person = data.people.find((p) => p.personId === protagonist.personId);
  const code = (person && person.canonicalCode) || peopleStore.assignUniqueCanonicalCode(data, protagonist.name);
  const currentId = String(existingAdultId || '').trim();
  const currentFolderName = opts.filePath ? path.basename(path.dirname(opts.filePath)) : '';
  const folderMatch = currentFolderName.match(new RegExp(`^(${escapeRegExp(code)}-\\d+)\\b`, 'i'));
  if (folderMatch) {
    return {
      adultId: folderMatch[1].toUpperCase(),
      actorName: protagonist.name,
      actorPersonId: protagonist.personId,
      reused: true,
    };
  }
  const currentIdMatchesActor = currentId
    && !/^UNK-\d+$/i.test(currentId)
    && currentId.toUpperCase().startsWith(`${code.toUpperCase()}-`);
  const currentIdLooksOrganized = currentFolderName
    && currentFolderName.toUpperCase().startsWith(currentId.toUpperCase());
  if (currentIdMatchesActor && currentIdLooksOrganized) {
    return {
      adultId: currentId,
      actorName: protagonist.name,
      actorPersonId: protagonist.personId,
      reused: true,
    };
  }
  if (person && !person.canonicalCode) {
    person.canonicalCode = code;
    const fs = require('fs');
    fs.writeFileSync(path.join(configStore.resolveDataDir(), 'people.json'),
      JSON.stringify({ version: 1, people: data.people }, null, 2), 'utf8');
  }
  const seq = nextActorSequence(protagonist.personId);
  return {
    adultId: `${code}-${padSeq(seq, cfg.sequencePad)}`,
    actorName: protagonist.name,
    actorPersonId: protagonist.personId,
  };
}

// Pick the protagonist cluster from the worker's faceClusters result. The
// worker already sorts by protagonistScore (avgFaceArea × frameCount) and marks
// status, so the service trusts the top named cluster. Exposed for testing and
// for a future "change protagonist" override.
function pickProtagonist(faceClusters) {
  if (!Array.isArray(faceClusters)) return null;
  return faceClusters.find((c) => c.status === 'named' && c.matchedPersonId) || null;
}
