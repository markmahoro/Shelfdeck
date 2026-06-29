'use strict';

require('./logger'); // intercept console.log/error → data/shelfdeck.log (before any other module)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cors = require('@fastify/cors');
const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');

const configStore = require('./configStore');
const taskStore = require('./taskStore');
const taskScheduler = require('./taskScheduler');
const healthCheck = require('./healthCheck');
const mediaLibraryService = require('./mediaLibraryService');
const embyService = require('./services/embyService');
const doubanService = require('./services/doubanService');
const transcodeService = require('./services/transcodeService');
const moviepilotService = require('./services/moviepilotService');
const strategyEngine = require('./strategyEngine');
const smartTaskEngine = require('./smartTaskEngine');
const priorityEngine = require('./priorityEngine');
const taskAdmission = require('./taskAdmission');
const activityLog = require('./activityLog');
const spaceStats = require('./spaceStats');
const nodeStore = require('./nodeStore');
const nodeService = require('./nodeService');
const assetIdentity = require('./assetIdentity');
const adultLibraryService = require('./adultLibraryService');
const peopleStore = require('./peopleStore');
const adultActorImageSearchService = require('./services/adultActorImageSearchService');
const westernAdultLocalAiService = require('./services/westernAdultLocalAiService');
const scrapeVerification = require('./scrapeVerification');
const metadataStatus = require('./metadataStatus');

let serverReady = false;

// ── Playback log ─────────────────────────────────────────────────────────────

function playbackLogPath() {
  return path.join(configStore.resolveDataDir(), 'playback-log.json');
}

function loadPlaybackLog() {
  try {
    const p = playbackLogPath();
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8');
      return JSON.parse(raw);
    }
  } catch (_) {}
  return [];
}

function savePlaybackLog(logs) {
  fs.writeFileSync(playbackLogPath(), JSON.stringify(logs, null, 2));
}

function addPlaybackEntry(entry) {
  const logs = loadPlaybackLog();
  const idx = logs.findIndex((e) => e.itemId === entry.itemId);
  if (idx >= 0) {
    // Aggregate: update timestamp, increment play count
    const existing = logs[idx];
    logs.splice(idx, 1);
    logs.unshift({
      ...existing,
      ...entry,
      playedAt: new Date().toISOString(),
      playCount: (existing.playCount || 1) + 1,
    });
  } else {
    logs.unshift({ ...entry, playedAt: new Date().toISOString(), playCount: 1 });
  }
  savePlaybackLog(logs);
}

function removePlaybackEntry(itemId) {
  const logs = loadPlaybackLog();
  const filtered = logs.filter((e) => e.itemId !== itemId);
  savePlaybackLog(filtered);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function apiError(reply, status, code, message) {
  return reply.code(status).send({ error: { code, message } });
}

function detectImageContentType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return 'image/jpeg';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return 'image/jpeg';
}

let sharpModule;
function loadSharp() {
  if (sharpModule !== undefined) return sharpModule;
  try { sharpModule = require('sharp'); } catch (_) { sharpModule = null; }
  return sharpModule;
}

async function referenceImageBuffer(buffer, opts = {}) {
  if (!opts.thumbnail) return { buffer, contentType: detectImageContentType(buffer) };
  const sharp = loadSharp();
  if (!sharp) return { buffer, contentType: detectImageContentType(buffer) };
  try {
    const resized = await sharp(buffer)
      .rotate()
      .resize(96, 96, { fit: 'cover', position: 'attention' })
      .jpeg({ quality: 76, mozjpeg: true })
      .toBuffer();
    return { buffer: resized, contentType: 'image/jpeg' };
  } catch (_) {
    return { buffer, contentType: detectImageContentType(buffer) };
  }
}

function taskNeedsFlowCancel(task) {
  return !!task && [
    'executing',
    'pausing',
    'paused',
    'awaiting_user_confirm',
    'interrupted',
    'waiting_media_source',
  ].includes(task.status);
}

const MASKED_SECRET = '********';
const ADULT_WESTERN_SECRET_KEYS = [
  'metadataApiKey',
  'tpdbApiKey',
  'stashBoxApiKey',
  'tmdbApiKey',
  'tmdbReadAccessToken',
];

function maskAdultLibrarySecrets(adultLibrary = {}) {
  const out = {
    ...(adultLibrary || {}),
    western: {
      ...((adultLibrary && adultLibrary.western) || {}),
    },
  };
  for (const key of ADULT_WESTERN_SECRET_KEYS) {
    if (out.western[key]) out.western[key] = MASKED_SECRET;
  }
  return out;
}

function maskSensitive(config) {
  const masked = { ...config };
  if (masked.apiKey) masked.apiKey = MASKED_SECRET;
  if (masked.douban && masked.douban.cookieHeader) {
    masked.douban = { ...masked.douban, cookieHeader: MASKED_SECRET };
  }
  if (masked.moviepilot && masked.moviepilot.apiKey) {
    masked.moviepilot = { ...masked.moviepilot, apiKey: MASKED_SECRET };
  }
  if (masked.adultLibrary) masked.adultLibrary = maskAdultLibrarySecrets(masked.adultLibrary);
  if (masked.embyServers) {
    const servers = {};
    for (const [k, v] of Object.entries(masked.embyServers)) {
      servers[k] = { ...v, apiKey: MASKED_SECRET, embyUserPassword: v.embyUserPassword ? MASKED_SECRET : '' };
    }
    masked.embyServers = servers;
  }
  return masked;
}

function taskListItemInfo(itemInfo = {}) {
  if (!itemInfo || typeof itemInfo !== 'object') return undefined;
  const adultMetadata = itemInfo.adultMetadata && typeof itemInfo.adultMetadata === 'object'
    ? {
      adultId: itemInfo.adultMetadata.adultId,
      scrapeStatus: itemInfo.adultMetadata.scrapeStatus,
      region: itemInfo.adultMetadata.region,
      protagonist: itemInfo.adultMetadata.protagonist,
    }
    : undefined;
  const compact = {
    name: itemInfo.name,
    title: itemInfo.title,
    type: itemInfo.type,
    seriesName: itemInfo.seriesName,
    seasonNumber: itemInfo.seasonNumber,
    source: itemInfo.source,
    watched: itemInfo.watched,
    metadataStatus: itemInfo.metadataStatus,
    metadataComplete: itemInfo.metadataComplete,
    metadataMissingReasons: itemInfo.metadataMissingReasons,
    metadataKind: itemInfo.metadataKind,
    path: itemInfo.path,
    subLibraryId: itemInfo.subLibraryId,
    adultMetadata,
    originalSizeBytes: itemInfo.originalSizeBytes,
    originalBitrate: itemInfo.originalBitrate,
    originalVideoCodec: itemInfo.originalVideoCodec,
    originalAudioCodec: itemInfo.originalAudioCodec,
    originalWidth: itemInfo.originalWidth,
    originalHeight: itemInfo.originalHeight,
  };
  Object.keys(compact).forEach((key) => {
    if (compact[key] === undefined || compact[key] === null) delete compact[key];
  });
  return Object.keys(compact).length > 0 ? compact : undefined;
}

function taskListSummary(task) {
  return {
    id: task.id,
    itemId: task.itemId,
    itemName: task.itemName,
    actionType: task.actionType,
    source: task.source,
    status: task.status,
    progress: task.progress,
    phase: task.phase,
    resumePoint: task.resumePoint,
    approval: task.approval,
    priority: task.priority,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    itemInfo: taskListItemInfo(task.itemInfo),
    verifyResult: task.verifyResult,
    confirmData: task.confirmData,
    metadataStatus: task.itemInfo && task.itemInfo.metadataStatus,
    metadataMissingReasons: task.itemInfo && task.itemInfo.metadataMissingReasons,
  };
}

function compactFaceForUi(face, opts = {}) {
  if (!face || typeof face !== 'object') return face;
  const { embedding, vector, descriptor, ...rest } = face;
  if (!opts.includeSampleImage) delete rest.sampleImageBase64;
  return rest;
}

function compactAdultMetadataForUi(metadata, opts = {}) {
  if (!metadata || typeof metadata !== 'object') return metadata;
  const allowedKeys = [
    'adultId',
    'idConfidence',
    'title',
    'originalTitle',
    'source',
    'sourceUrl',
    'scrapeStatus',
    'reviewStatus',
    'region',
    'scraperType',
    'posterPath',
    'fanartPath',
    'nfoPath',
    'fileNfoPath',
    'markerPath',
    'organized',
    'originalFolder',
    'studio',
    'director',
    'premiered',
    'actors',
    'protagonist',
    'scrapeError',
    'scrapeFailedAt',
    'generatedTitle',
    'generatedDescription',
  ];
  const compact = {};
  for (const key of allowedKeys) {
    if (metadata[key] !== undefined) compact[key] = metadata[key];
  }
  if (Array.isArray(metadata.faceClusters)) {
    compact.faceClusters = opts.includeFaces
      ? metadata.faceClusters.map((face) => compactFaceForUi(face, opts))
      : [];
  }
  if (Array.isArray(metadata.unknownFaces)) {
    compact.unknownFaces = opts.includeFaces
      ? metadata.unknownFaces.map((face) => compactFaceForUi(face, opts))
      : [];
  }
  return compact;
}

function libraryListItemView(item) {
  if (!item || typeof item !== 'object') return item;
  if (!item.adultMetadata || typeof item.adultMetadata !== 'object') return item;
  return {
    ...item,
    adultMetadata: compactAdultMetadataForUi(item.adultMetadata, {
      includeFaces: false,
      includeSampleImage: false,
    }),
  };
}

function taskDetailView(task) {
  if (!task || typeof task !== 'object') return task;
  const itemInfo = task.itemInfo && typeof task.itemInfo === 'object'
    ? {
      ...task.itemInfo,
      adultMetadata: compactAdultMetadataForUi(task.itemInfo.adultMetadata, {
        includeFaces: false,
        includeSampleImage: false,
      }),
    }
    : task.itemInfo;
  return { ...task, itemInfo };
}

function markScrapeVerificationSource(verification, source) {
  if (!verification || typeof verification !== 'object') return verification;
  return {
    ...verification,
    source,
  };
}

function addScrapeReportWarning(verification, warning) {
  if (!verification || typeof verification !== 'object' || !warning) return verification;
  const warnings = Array.isArray(verification.warnings) ? verification.warnings.slice() : [];
  warnings.push(warning);
  return { ...verification, warnings };
}

async function fetchImageAsBase64(url) {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) throw new Error('imageUrl must be http(s)');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(u, { signal: controller.signal });
    if (!res.ok) throw new Error(`Image download failed: HTTP ${res.status}`);
    const ct = String(res.headers.get('content-type') || '').toLowerCase();
    if (ct && !ct.startsWith('image/')) throw new Error(`URL did not return an image (${ct})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new Error('Image download returned empty body');
    if (buf.length > 8 * 1024 * 1024) throw new Error('Image is too large');
    return { base64: buf.toString('base64'), contentType: ct || 'image/jpeg' };
  } finally {
    clearTimeout(timer);
  }
}

function getEmbyServerConfig(embyServerId) {
  const cfg = configStore.loadConfig();
  const servers = cfg.embyServers || {};
  if (embyServerId) return servers[embyServerId] || null;
  const first = Object.keys(servers)[0];
  return first ? servers[first] : null;
}

function resolveEmbyConfigForLibrary(subLibraryId) {
  const cfg = configStore.loadConfig();
  const subLibs = cfg.subLibraries || [];
  let subLib;
  if (subLibraryId) {
    subLib = subLibs.find((s) => s.uuid === subLibraryId);
    if (!subLib) return { error: { code: 'NOT_FOUND', message: 'SubLibrary not found' } };
  } else {
    subLib = subLibs[0];
    if (!subLib) return { error: { code: 'NOT_FOUND', message: 'No subLibraries configured' } };
  }
  const servers = cfg.embyServers || {};
  const serverConfig = servers[subLib.embyServerId];
  if (!serverConfig || !serverConfig.baseUrl) {
    return { error: { code: 'EMBY_UNREACHABLE', message: 'Emby server not configured for this subLibrary' } };
  }
  return { subLib, serverConfig };
}

function resolveEmbyConfigForItem(itemId, subLibraryId) {
  const libItem = mediaLibraryService.getLibraryItem(itemId);
  const resolvedSubLibraryId = subLibraryId || (libItem && libItem.subLibraryId) || '';
  if (resolvedSubLibraryId) {
    const resolved = resolveEmbyConfigForLibrary(resolvedSubLibraryId);
    if (!resolved.error) {
      resolved.libItem = libItem || null;
      resolved.embyItemId = libItem ? assetIdentity.getEmbyItemId(libItem) : itemId;
    }
    return resolved;
  }
  return { error: { code: 'NOT_FOUND', message: 'Cannot determine subLibrary for this item' } };
}

// ── Route Registration ──────────────────────────────────────────────────────

function registerRoutes(app) {
  // ── Health ──────────────────────────────────────────────────────────────

  app.get('/v1/health', async () => {
    return healthCheck.getPublicResult();
  });

  // ── Tasks ───────────────────────────────────────────────────────────────

  app.post('/v1/tasks', async (req, reply) => {
    const { itemId, actionType } = req.body || {};
    if (!itemId || !actionType) {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'itemId and actionType are required');
    }
    if (!['delete', 'transcode', 'upgrade', 'scrape'].includes(actionType)) {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'Invalid actionType');
    }

    const cfg = configStore.loadConfig();

    // Populate itemInfo from media library
    const libItem = mediaLibraryService.getLibraryItem(itemId);
    const meta = libItem ? metadataStatus.resolveMetadataStatus(libItem, cfg) : null;
    const itemInfo = libItem ? {
      name: libItem.name,
      itemId: libItem.itemId,
      source: libItem.source,
      embyItemId: assetIdentity.getEmbyItemId(libItem),
      path: libItem.path,
      subLibraryId: libItem.subLibraryId,
      assetKey: libItem.assetKey,
      assetRootPath: libItem.assetRootPath,
      externalRefs: libItem.externalRefs,
      resolution: libItem.resolution,
      bitrate: libItem.bitrate,
      size: libItem.size,
      duration: libItem.duration,
      type: libItem.type,
      isDiscLike: !!libItem.isDiscLike,
      doubanRating: libItem.doubanRating,
      userRating: libItem.userRating,
      watched: libItem.watched,
      tmdbId: libItem.tmdbId,
      providerIds: libItem.providerIds,
      seriesName: libItem.seriesName,
      seasonNumber: libItem.seasonNumber,
      targetBitrate: libItem.targetBitrate,
      targetCodec: libItem.targetCodec,
      seedPreferences: libItem.seedPreferences,
      maxSizeGB: libItem.maxSizeGB,
      equivalentBitrate: libItem.equivalentBitrate,
      scraped: !!libItem.scraped,
      adultMetadata: libItem.adultMetadata,
      ...(meta || {}),
    } : null;

    const admissionItemInfo = itemInfo || { itemId };
    const admission = taskAdmission.canCreateTask({
      item: libItem,
      itemInfo: admissionItemInfo,
      actionType,
      source: 'manual',
      config: cfg,
      tasks: taskStore.loadTasks({ includeHistory: false }),
    });
    if (!admission.allowed) {
      if (admission.reason === 'active_task_exists') {
        return apiError(reply, 409, 'TASK_CONFLICT', `Item ${itemId} already has an active task (${admission.activeTaskId})`);
      }
      return apiError(reply, 409, 'TASK_ADMISSION_REJECTED', admission.reason);
    }

    const schedule = itemInfo && itemInfo.subLibraryId
      ? configStore.resolveSubLibSchedule(itemInfo, cfg)
      : { autoExecute: cfg.executionMode === 'auto' };
    const status = schedule.autoExecute ? 'created' : 'pending_manual';
    const priorityBreakdown = priorityEngine.explainPriority({
      source: 'manual',
      actionType,
      itemInfo,
      config: cfg,
    });

    const task = taskStore.createTask({
      itemId,
      itemName: libItem ? libItem.name : undefined,
      actionType,
      source: 'manual',
      status,
      priority: priorityBreakdown.priority,
      priorityModelVersion: priorityEngine.PRIORITY_MODEL_VERSION,
      priorityBreakdown,
      itemInfo,
      logs: [{ ts: new Date().toISOString(), level: 'info', msg: 'Task created by user action' }],
    });

    return reply.code(201).send(task);
  });

  app.get('/v1/tasks', async (req) => {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.actionType) filter.actionType = req.query.actionType;
    const includeHistory = req.query.includeHistory === '1' || req.query.includeHistory === 'true';
    const activeOnly = !includeHistory || req.query.activeOnly === '1' || req.query.activeOnly === 'true';
    const tasks = activeOnly
      ? taskStore.loadTasks({ includeHistory: false }).filter((t) => {
        if (filter.status && t.status !== filter.status) return false;
        if (filter.actionType && t.actionType !== filter.actionType) return false;
        return true;
      })
      : taskStore.getTasks(filter);
    return { tasks };
  });

  app.get('/v1/tasks/:id', async (req, reply) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return apiError(reply, 404, 'NOT_FOUND', 'Task not found');
    return taskDetailView(task);
  });

  app.get('/v1/tasks/:id/report', async (req, reply) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return apiError(reply, 404, 'NOT_FOUND', 'Task not found');
    if (task.status !== 'done' && !(task.status === 'failed_hard' && task.actionType === 'scrape')) {
      return apiError(reply, 400, 'BAD_REQUEST', 'Task not completed yet');
    }

    const info = task.itemInfo || {};
    const vr = task.verifyResult || {};
    const logs = task.logs || [];
    const firstTs = logs.length > 0 ? new Date(logs[0].ts) : null;
    const lastTs = logs.length > 0 ? new Date(logs[logs.length - 1].ts) : null;
    const elapsedSec = firstTs && lastTs ? Math.round((lastTs.getTime() - firstTs.getTime()) / 1000) : null;

    // Find encoder info from logs
    const encoderLog = logs.find((l) => l.msg && l.msg.startsWith('Encoder:'));
    const encoder = encoderLog ? encoderLog.msg.replace('Encoder: ', '') : null;

    const report = {
      taskId: task.id,
      itemId: task.itemId,
      itemName: (info.type === 'season' && info.seriesName && info.seasonNumber != null
        ? `${info.seriesName} 第${info.seasonNumber}季`
        : (task.itemName || task.itemId)),
      actionType: task.actionType,
      elapsedSec,
      encoder,
    };

    if (task.actionType === 'transcode') {
      report.original = {
        sizeBytes: info.originalSizeBytes || info.size,
        videoCodec: info.originalVideoCodec || info.codec || '?',
        bitrate: info.originalBitrate || info.bitrate || 0,
        width: info.originalWidth,
        height: info.originalHeight,
        audioCodec: info.originalAudioCodec,
      };
      report.output = {
        sizeBytes: vr.sizeBytes,
        videoCodec: vr.videoCodec,
        bitrate: vr.bitrate,
        width: vr.width,
        height: vr.height,
      };
      report.bytesSaved = vr.bytesSaved || ((report.original.sizeBytes || 0) - (report.output.sizeBytes || 0));
    } else if (task.actionType === 'delete') {
      report.bytesFreed = vr.bytesSaved || info.size || info.originalSizeBytes || 0;
      report.delete = {
        targetPath: vr.deletedPath || info.deleteTargetPath || info.path || '',
        targetKind: vr.deletedKind || info.deleteTargetKind || (info.embyItemId ? 'emby_item' : ''),
      };
    } else if (task.actionType === 'upgrade') {
      report.original = {
        sizeBytes: info.originalSizeBytes || info.size,
        videoCodec: info.originalVideoCodec || info.codec || '?',
        bitrate: info.originalBitrate || info.bitrate || 0,
        width: info.originalWidth,
        height: info.originalHeight,
        resolution: info.resolution,
        audioCodec: info.originalAudioCodec,
      };
      report.output = {
        sizeBytes: vr.sizeBytes,
        videoCodec: vr.videoCodec,
        bitrate: vr.bitrate,
        width: vr.width,
        height: vr.height,
      };
      const up = task.upgradePreview;
      if (up) {
        report.bytesSaved = up.bytesSaved || ((report.original.sizeBytes || 0) - (report.output.sizeBytes || 0));
        report.tmdbVerified = up.tmdbVerified;
      }
    } else if (task.actionType === 'scrape') {
      const cfg = configStore.loadConfig();
      const liveItem = mediaLibraryService.getLibraryItem(task.itemId);
      const scrapeInfo = liveItem || { ...info, itemId: task.itemId };
      const currentVerification = scrapeVerification.verifyScrapedItem(scrapeInfo, {
        config: cfg,
        subLib: (cfg.subLibraries || []).find((sl) => sl.uuid === scrapeInfo.subLibraryId) || null,
        scrapeTaskId: task.id,
      });
      if (scrapeInfo.source !== 'adult_folder') {
        report.metadata = {
          itemId: scrapeInfo.itemId || task.itemId,
          name: scrapeInfo.name || task.itemName || '',
          source: scrapeInfo.source || '',
          mediaPath: scrapeInfo.path || '',
          metadataStatus: currentVerification.metadataStatus || (info && info.metadataStatus) || '',
          metadataMissingReasons: currentVerification.metadataMissingReasons || (info && info.metadataMissingReasons) || [],
        };
        report.scrapeVerification = task.scrapeVerification && typeof task.scrapeVerification === 'object'
          ? markScrapeVerificationSource(task.scrapeVerification, 'completion_snapshot')
          : markScrapeVerificationSource(currentVerification, 'current_library_state');
        return report;
      }
      const meta = scrapeInfo.adultMetadata || {};
      const subLib = (cfg.subLibraries || []).find((sl) => sl.uuid === scrapeInfo.subLibraryId) || null;
      report.scrape = {
        adultId: meta.adultId || scrapeInfo.sourceId || '',
        title: meta.title || scrapeInfo.name || task.itemName || '',
        source: meta.source || '',
        sourceUrl: meta.sourceUrl || '',
        scrapeStatus: meta.scrapeStatus || '',
        posterPath: meta.posterPath || '',
        fanartPath: meta.fanartPath || '',
        nfoPath: meta.nfoPath || '',
        fileNfoPath: meta.fileNfoPath || '',
        markerPath: meta.markerPath || '',
        organized: !!meta.organized,
        originalFolder: meta.originalFolder || '',
        mediaPath: scrapeInfo.path || '',
        actors: meta.actors || [],
        protagonist: meta.protagonist || null,
        faceClusters: Array.isArray(meta.faceClusters)
          ? meta.faceClusters.map((face) => compactFaceForUi(face, { includeSampleImage: true }))
          : [],
        unknownFaces: Array.isArray(meta.unknownFaces)
          ? meta.unknownFaces.map((face) => compactFaceForUi(face, { includeSampleImage: true }))
          : [],
        actorConfidence: meta.actorConfidence || {},
      };
      report.assets = {
        poster: !!meta.posterPath,
        fanart: !!meta.fanartPath,
        nfo: !!meta.nfoPath,
        marker: !!meta.markerPath,
      };
      if (task.scrapeVerification && typeof task.scrapeVerification === 'object') {
        report.scrapeVerification = markScrapeVerificationSource(task.scrapeVerification, 'completion_snapshot');
        if (currentVerification.ok !== task.scrapeVerification.ok || (currentVerification.failures || []).length > 0) {
          report.currentScrapeVerification = markScrapeVerificationSource(currentVerification, 'current_filesystem');
        }
      } else {
        report.scrapeVerification = markScrapeVerificationSource(currentVerification, 'current_filesystem');
        if (task.status === 'done') {
          report.scrapeVerification = addScrapeReportWarning(report.scrapeVerification, {
            code: 'snapshot.missing',
            message: '这条历史刮削执行结束时尚未保存验收快照；此处展示的是当前文件系统复核结果，不代表当时的文件状态。',
          });
        }
      }
    }

    return report;
  });

  app.get('/v1/tasks/:id/preview', async (req, reply) => {
    const task = taskStore.getTask(req.params.id);
    if (!task || !task.verifyResult || !task.verifyResult.previewPath) {
      return apiError(reply, 404, 'NOT_FOUND', 'Preview not available');
    }
    const filePath = task.verifyResult.previewPath;
    let stat;
    try { stat = fs.statSync(filePath); } catch {
      return apiError(reply, 404, 'NOT_FOUND', 'Preview file not found');
    }
    const fileSize = stat.size;

    const range = req.headers.range;
    if (range) {
      const parts = range.replace('bytes=', '').split('-');
      const start = parseInt(parts[0], 10) || 0;
      const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 1024 * 1024 - 1, fileSize - 1);
      const chunkSize = end - start + 1;

      const stream = fs.createReadStream(filePath, { start, end });
      reply.raw.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'video/mp4',
      });
      stream.pipe(reply.raw);
      return;
    }

    reply.header('Content-Type', 'video/mp4');
    reply.header('Content-Length', fileSize);
    reply.header('Accept-Ranges', 'bytes');
    return reply.send(fs.createReadStream(filePath));
  });

  app.patch('/v1/tasks/:id', async (req, reply) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return apiError(reply, 404, 'NOT_FOUND', 'Task not found');

    const { confirmed, confirmData } = req.body || {};
    if (!confirmed) return apiError(reply, 400, 'VALIDATION_ERROR', 'confirmed must be true');
    if (task.status !== 'awaiting_user_confirm') {
      return apiError(reply, 409, 'TASK_CONFLICT', 'Task is not awaiting confirmation');
    }

    // Store user selection data (e.g. selectedIndex for upgrade flow)
    if (confirmData) {
      taskStore.updateTask(task.id, { confirmData });
    }

    // Call Flow.confirmReceived
    const flow = getFlow(task.actionType);
    if (flow) flow.confirmReceived(task.id);

    // Re-queue for scheduler, mark as just-confirmed to bypass awaiting guard
    taskScheduler.markConfirmed(task.id);
    const updated = taskStore.updateTask(task.id, { status: 'queued', manualExecuteRequested: true });
    return { id: updated.id, status: updated.status, updatedAt: updated.updatedAt };
  });

  app.post('/v1/tasks/:id/actions/execute', async (req, reply) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return apiError(reply, 404, 'NOT_FOUND', 'Task not found');

    if (task.status === 'pending_manual' || task.status === 'interrupted' || task.status === 'created') {
      taskScheduler.markConfirmed(task.id);
      taskStore.updateTask(task.id, { status: 'queued', manualExecuteRequested: true });
      return { id: task.id, status: 'queued', updatedAt: new Date().toISOString() };
    }
    if (task.status === 'paused') {
      taskScheduler.markConfirmed(task.id);
      taskStore.updateTask(task.id, { status: 'queued', manualExecuteRequested: true });
      return { id: task.id, status: 'queued', updatedAt: new Date().toISOString() };
    }
    if (task.status === 'pausing') {
      // Clear pause request — hash acquisition loop will fall back to normal polling
      taskStore.updateTask(task.id, { pausingRequested: false, status: 'executing' });
      return { id: task.id, status: 'executing', updatedAt: new Date().toISOString() };
    }
    return { id: task.id, status: task.status, updatedAt: task.updatedAt };
  });

  app.post('/v1/tasks/:id/actions/pause', async (req, reply) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return apiError(reply, 404, 'NOT_FOUND', 'Task not found');

    const flow = getFlow(task.actionType);
    if (flow) await flow.pause(task.id);

    return { id: task.id, status: 'paused', updatedAt: new Date().toISOString() };
  });

  app.delete('/v1/tasks/:id', async (req, reply) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return apiError(reply, 404, 'NOT_FOUND', 'Task not found');

    const flow = getFlow(task.actionType);
    if (flow && taskNeedsFlowCancel(task)) await flow.cancel(task.id);

    taskStore.deleteTask(task.id);
    return { ok: true, id: task.id };
  });

  // ── Library ─────────────────────────────────────────────────────────────

  function parseLibraryQuery(query = {}) {
    const filter = {};
    if (query.source) filter.source = query.source;
    if (query.type) filter.type = query.type;
    if (query.action) filter.action = query.action;
    if (query.subLibraryId) filter.subLibraryId = query.subLibraryId;
    if (query.search) filter.search = query.search;
    if (query.resolution) filter.resolution = query.resolution;
    if (query.codec) filter.codec = query.codec;
    if (query.watched === 'watched') filter.watched = true;
    if (query.watched === 'unwatched') filter.watched = false;
    if (query.bluRay === 'disc') filter.isBluRayDisc = true;
    if (query.bluRay === 'not_disc') filter.isBluRayDisc = false;
    if (query.douban === 'none') filter.doubanStars = null;
    else if (query.douban) filter.doubanStars = Number(query.douban);
    if (query.userRating === 'none') filter.userRating = null;
    else if (query.userRating) filter.userRating = Number(query.userRating);
    if (query.task === 'active' || query.task === 'none') {
      filter.taskState = query.task;
      filter.activeTaskIds = new Set(taskStore.loadTasks({ includeHistory: false }).map((t) => t.itemId));
    }
    if (query.scrape === 'done' || query.scrape === 'pending' || query.scrape === 'failed') filter.metadataStatus = query.scrape;
    const rawPageSize = Number(query.pageSize);
    const rawPage = Number(query.page);
    const rawLimit = Number(query.limit);
    const rawOffset = Number(query.offset);
    const pageSize = Number.isFinite(rawPageSize) && rawPageSize > 0 ? Math.min(500, Math.floor(rawPageSize)) : null;
    const pageNumber = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
    const limit = pageSize || (Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(500, Math.floor(rawLimit)) : null);
    const offset = pageSize
      ? (pageNumber - 1) * pageSize
      : (Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0);
    return { filter, page: { limit, offset } };
  }

  app.get('/v1/library', async (req) => {
    const { filter, page } = parseLibraryQuery(req.query);
    const result = mediaLibraryService.getLibrary(filter, { includeOptimizationStatus: true, ...page });
    // Attach embyWebUrl for desktop play button
    const cfg = configStore.loadConfig();
    const servers = cfg.embyServers || {};
    const subLibs = cfg.subLibraries || [];
    for (const item of result.items) {
      const sl = subLibs.find((s) => s.uuid === item.subLibraryId);
      if (sl && servers[sl.embyServerId] && servers[sl.embyServerId].baseUrl) {
        const embyItemId = assetIdentity.getEmbyItemId(item);
        if (embyItemId) {
          item.embyWebUrl = `${String(servers[sl.embyServerId].baseUrl).replace(/\/+$/, '')}/web/index.html#!/item?id=${embyItemId}`;
        }
      }
    }
    result.items = result.items.map(libraryListItemView);
    return result;
  });

  app.get('/v1/library/queries/manage', async (req) => {
    const { filter, page } = parseLibraryQuery(req.query);
    const result = mediaLibraryService.getLibrary(filter, { includeOptimizationStatus: true, ...page });
    return { ...result, items: result.items.map(libraryListItemView) };
  });

  app.get('/v1/library/items/:itemId', async (req, reply) => {
    const item = mediaLibraryService.getLibraryItem(req.params.itemId);
    if (!item) return apiError(reply, 404, 'NOT_FOUND', 'Item not found');
    return libraryListItemView(metadataStatus.decorateItem(item, configStore.loadConfig()));
  });

  app.patch('/v1/library/ratings', async (req, reply) => {
    const { itemId, userRating } = req.body || {};
    if (!itemId || (typeof userRating !== 'number' && userRating !== null)) {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'itemId and userRating are required');
    }
    if (userRating !== null && (userRating < 1 || userRating > 5)) {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'userRating must be 1-5');
    }
    try {
      mediaLibraryService.updateUserRating(itemId, userRating);
      return { ok: true };
    } catch (e) {
      return apiError(reply, 404, 'NOT_FOUND', e.message);
    }
  });

  app.post('/v1/library/actions/refresh', async (req, reply) => {
    const { subLibraryId } = req.body || {};
    if (!subLibraryId) return apiError(reply, 400, 'VALIDATION_ERROR', 'subLibraryId is required');
    try {
      mediaLibraryService.triggerRefresh(subLibraryId);
      return reply.code(202).send({ ok: true, message: 'Refresh triggered' });
    } catch (e) {
      return apiError(reply, 404, 'NOT_FOUND', e.message);
    }
  });

  app.post('/v1/library/actions/recompute-strategy', async () => {
    const result = strategyEngine.runOnce();
    return { ok: true, changed: result.changed };
  });

  app.get('/v1/library/status', async () => {
    return mediaLibraryService.getLibraryStatus();
  });

  app.post('/v1/library/cache', async (req) => {
    const { subLibraryId, items } = req.body || {};
    if (!subLibraryId || !Array.isArray(items)) {
      return { ok: true, upserted: 0, removed: 0 };
    }
    const result = mediaLibraryService.upsertItems(subLibraryId, items, { fullSync: true });
    return { ok: true, ...result };
  });

  // ── Library: mark played / unplayed ─────────────────────────────────────

  app.post('/v1/library/actions/mark-played', async (req, reply) => {
    const { itemId, subLibraryId } = req.body || {};
    if (!itemId) return apiError(reply, 400, 'VALIDATION_ERROR', 'itemId is required');

    const resolved = resolveEmbyConfigForItem(itemId, subLibraryId || '');
    if (resolved.error) return apiError(reply, 404, resolved.error.code, resolved.error.message);

    try {
      const embyItemId = resolved.embyItemId || itemId;
      await embyService.markPlayed(resolved.serverConfig, embyItemId);

      // Fetch single item from Emby to get updated watched status
      const fetchedItem = await embyService.getItem(resolved.serverConfig, embyItemId);
      mediaLibraryService.upsertItems(resolved.subLib.uuid, [fetchedItem]);

      activityLog.addActivity('user_action', `「${fetchedItem.name || itemId}」已标记为已看`);
      return { ok: true };
    } catch (e) {
      return apiError(reply, 502, 'EMBY_ERROR', e.message);
    }
  });

  app.post('/v1/library/actions/mark-unplayed', async (req, reply) => {
    const { itemId, subLibraryId } = req.body || {};
    if (!itemId) return apiError(reply, 400, 'VALIDATION_ERROR', 'itemId is required');

    const resolved = resolveEmbyConfigForItem(itemId, subLibraryId || '');
    if (resolved.error) return apiError(reply, 404, resolved.error.code, resolved.error.message);

    try {
      const embyItemId = resolved.embyItemId || itemId;
      await embyService.markUnplayed(resolved.serverConfig, embyItemId);

      // Fetch single item from Emby to get updated watched status
      const fetchedItem = await embyService.getItem(resolved.serverConfig, embyItemId);
      mediaLibraryService.upsertItems(resolved.subLib.uuid, [fetchedItem]);

      return { ok: true };
    } catch (e) {
      return apiError(reply, 502, 'EMBY_ERROR', e.message);
    }
  });

  // ── Local playback log ──────────────────────────────────────────────────

  app.get('/v1/library/playback-log', async (req) => {
    const logs = loadPlaybackLog();
    const filterSubLib = (req.query && req.query.subLibraryId) || '';
    const filtered = filterSubLib ? logs.filter((e) => e.subLibraryId === filterSubLib) : logs;
    return filtered;
  });

  app.post('/v1/library/playback-log/record', async (req) => {
    const { itemId, subLibraryId, itemName, type, posterUrl, path, embyWebUrl, sectionName } = req.body || {};
    if (!itemId || !subLibraryId) {
      return { ok: false, error: 'itemId and subLibraryId are required' };
    }
    addPlaybackEntry({
      itemId,
      subLibraryId,
      itemName: itemName || '',
      type: type || 'movie',
      posterUrl: posterUrl || '',
      path: path || '',
      embyWebUrl: embyWebUrl || '',
      sectionName: sectionName || '',
    });
    return { ok: true };
  });

  // v1 backward compat — redirect queries/played to playback-log
  app.post('/v1/library/queries/played', async (req) => {
    const logs = loadPlaybackLog();
    const filterSubLib = (req.body && req.body.subLibraryId) || '';
    const filtered = filterSubLib ? logs.filter((e) => e.subLibraryId === filterSubLib) : logs;
    return filtered;
  });

  app.post('/v1/library/queries/unplayed', async (req, reply) => {
    const { subLibraryId, sectionId } = req.body || {};
    const resolved = resolveEmbyConfigForLibrary(subLibraryId || '');
    if (resolved.error) return apiError(reply, 404, resolved.error.code, resolved.error.message);

    try {
      const items = await embyService.getUnplayedItems(
        resolved.serverConfig,
        sectionId || resolved.subLib.sectionId,
      );
      return items;
    } catch (e) {
      return apiError(reply, 502, 'EMBY_ERROR', e.message);
    }
  });

  // ── Config ──────────────────────────────────────────────────────────────

  app.get('/v1/config', async () => {
    return maskSensitive(configStore.loadConfig());
  });

  app.patch('/v1/config', async (req) => {
    const patch = req.body && typeof req.body === 'object' ? req.body : {};
    const updated = configStore.patchConfig(patch);
    return maskSensitive(updated);
  });

  // ── Activity Log ────────────────────────────────────────────────────────

  app.get('/v1/activity-log', async (req) => {
    const count = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    return { entries: activityLog.getRecent(count) };
  });

  // ── Space Stats ───────────────────────────────────────────────────────────

  app.get('/v1/space-stats', async () => {
    const library = typeof mediaLibraryService.getSpaceStatLibrary === 'function'
      ? mediaLibraryService.getSpaceStatLibrary()
      : mediaLibraryService.getLibrary();
    const tasks = typeof taskStore.querySpaceStatTaskRows === 'function'
      ? taskStore.querySpaceStatTaskRows()
      : taskStore.loadTasks();
    const config = configStore.loadConfig();
    return spaceStats.computeSpaceStats(library, tasks, config);
  });

  // ── Douban Integration ──────────────────────────────────────────────────

  app.get('/v1/integrations/douban/fetch/ratings', async (req, reply) => {
    const subLibraryId = req.query.subLibraryId;
    if (!subLibraryId) return apiError(reply, 400, 'VALIDATION_ERROR', 'subLibraryId is required');
    try {
      mediaLibraryService.triggerDoubanSync(subLibraryId);
      return reply.code(202).send({ ok: true, message: 'Douban sync triggered' });
    } catch (e) {
      if (e.message.includes('not found')) return apiError(reply, 404, 'NOT_FOUND', e.message);
      return apiError(reply, 502, 'DOUBAN_UNREACHABLE', e.message);
    }
  });

  app.get('/v1/integrations/douban/session', async () => {
    return doubanService.getSession();
  });

  app.put('/v1/integrations/douban/session', async (req) => {
    return doubanService.saveSession(req.body || {});
  });

  // ── Admin: Emby ─────────────────────────────────────────────────────────

  app.get('/v1/admin/emby/servers', async () => {
    const cfg = configStore.loadConfig();
    const servers = cfg.embyServers || {};
    const list = Object.entries(servers).map(([uuid, s]) => ({
      uuid,
      serverName: s.serverName || '',
      baseUrl: s.baseUrl || '',
      apiKey: '********',
      userId: s.userId || '',
      embyUserPassword: s.embyUserPassword ? '********' : '',
    }));
    return { servers: list };
  });

  app.post('/v1/admin/emby/test', async (req, reply) => {
    const { baseUrl, apiKey, userId, username, password } = req.body || {};
    let effectiveApiKey = apiKey || '';
    let resolvedUserId = userId || '';

    // If username+password provided, authenticate and get access token + userId
    if (!effectiveApiKey && username && password && baseUrl) {
      try {
        const auth = await embyService.authenticateByUsername(baseUrl, username, password);
        effectiveApiKey = auth.token;
        resolvedUserId = resolvedUserId || auth.userId;
      } catch (e) {
        return apiError(reply, 502, 'EMBY_AUTH_FAILED', e.message);
      }
    }

    if (!baseUrl || !effectiveApiKey) {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'baseUrl and apiKey (or username+password) are required');
    }
    try {
      const serverInfo = await embyService.testConnection({ baseUrl, apiKey: effectiveApiKey, userId: resolvedUserId });
      // Inline register
      const cfg = configStore.loadConfig();
      const servers = cfg.embyServers || {};
      let embyServerId = Object.keys(servers).find((k) => servers[k].baseUrl === baseUrl);
      if (!embyServerId) {
        embyServerId = crypto.randomUUID();
        servers[embyServerId] = {
          serverName: serverInfo.serverName || baseUrl,
          baseUrl,
          apiKey: effectiveApiKey,
          userId: resolvedUserId,
          embyUserPassword: password || '',
        };
        configStore.patchConfig({ embyServers: servers });
      } else {
        if (effectiveApiKey) servers[embyServerId].apiKey = effectiveApiKey;
        if (password) servers[embyServerId].embyUserPassword = password;
        if (resolvedUserId) servers[embyServerId].userId = resolvedUserId;
        configStore.patchConfig({ embyServers: servers });
      }
      return { ok: true, message: 'Emby connection successful', serverInfo, embyServerId, userId: resolvedUserId };
    } catch (e) {
      return apiError(reply, 502, 'EMBY_UNREACHABLE', e.message);
    }
  });

  app.get('/v1/admin/emby/users', async (req, reply) => {
    const embyServerId = req.query.embyServerId;
    if (!embyServerId) return apiError(reply, 400, 'VALIDATION_ERROR', 'embyServerId is required');
    const server = getEmbyServerConfig(embyServerId);
    if (!server) return apiError(reply, 404, 'NOT_FOUND', 'Server not found');
    try {
      const users = await embyService.getUsers(server);
      return { users };
    } catch (e) {
      return apiError(reply, 502, 'EMBY_UNREACHABLE', e.message);
    }
  });

  app.get('/v1/admin/emby/media-folders', async (req, reply) => {
    const embyServerId = req.query.embyServerId;
    if (!embyServerId) return apiError(reply, 400, 'VALIDATION_ERROR', 'embyServerId is required');
    const server = getEmbyServerConfig(embyServerId);
    if (!server) return apiError(reply, 404, 'NOT_FOUND', 'Server not found');
    try {
      const folders = await embyService.getMediaFolders(server);
      return { folders };
    } catch (e) {
      return apiError(reply, 502, 'EMBY_UNREACHABLE', e.message);
    }
  });

  // Deprecated emby config endpoints (compatibility)
  app.get('/v1/admin/emby/config', async () => {
    const cfg = configStore.loadConfig();
    const first = Object.entries(cfg.embyServers || {})[0];
    return first ? { baseUrl: first[1].baseUrl, apiKey: '********', userId: first[1].userId } : { baseUrl: '', apiKey: '', userId: '' };
  });

  app.patch('/v1/admin/emby/config', async (req) => {
    const cfg = configStore.loadConfig();
    const servers = cfg.embyServers || {};
    const firstKey = Object.keys(servers)[0];
    if (firstKey) {
      servers[firstKey] = { ...servers[firstKey], ...req.body };
    } else {
      const uuid = crypto.randomUUID();
      servers[uuid] = { serverName: '', baseUrl: '', apiKey: '', userId: '', embyUserPassword: '', ...req.body };
    }
    configStore.patchConfig({ embyServers: servers });
    return { ok: true };
  });

  // ── Admin: SubLibraries ─────────────────────────────────────────────────

  app.get('/v1/admin/sublibraries', async () => {
    const cfg = configStore.loadConfig();
    return { subLibraries: cfg.subLibraries || [] };
  });

  app.get('/v1/admin/log', async (req, reply) => {
    const logger = require('./logger');
    const lines = parseInt(req.query.lines || '500', 10);
    reply.type('text/plain; charset=utf-8');
    return logger.tail(Math.min(lines, 2000)) || '(log file is empty)\n';
  });

  app.post('/v1/admin/sublibraries', async (req, reply) => {
    const {
      name, embyServerId, sectionId, source, doubanEnabled, ruleTemplateId,
      upgradeSmartSelect, pathMapFrom, pathMapTo, mediaType,
      adultRegion, scraperType, watchRoot, japaneseJav, western,
      automationMode, approvalPolicy,
    } = req.body || {};
    if (!name) {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'name is required');
    }
    const isFolderAdult = source === 'folder' && mediaType === 'adult';
    if (!isFolderAdult && (!embyServerId || !sectionId)) {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'name, embyServerId, and sectionId are required');
    }
    if (isFolderAdult && !watchRoot) {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'watchRoot is required for adult folder libraries');
    }
    const cfg = configStore.loadConfig();
    if (!isFolderAdult && !(cfg.embyServers || {})[embyServerId]) {
      return apiError(reply, 404, 'NOT_FOUND', 'Emby server not found');
    }
    const subLib = mediaLibraryService.addSubLibrary({
      name, embyServerId, sectionId, source, doubanEnabled, ruleTemplateId,
      upgradeSmartSelect, pathMapFrom, pathMapTo, mediaType,
      adultRegion, scraperType, watchRoot, japaneseJav, western,
      automationMode, approvalPolicy,
    });
    return reply.code(201).send(subLib);
  });

  app.delete('/v1/admin/sublibraries/:uuid', async (req, reply) => {
    const ok = mediaLibraryService.deleteSubLibrary(req.params.uuid);
    if (!ok) return apiError(reply, 404, 'NOT_FOUND', 'SubLibrary not found');
    return { ok: true, uuid: req.params.uuid };
  });

  app.patch('/v1/admin/sublibraries/:uuid', async (req, reply) => {
    const updated = mediaLibraryService.updateSubLibrary(req.params.uuid, req.body || {});
    if (!updated) return apiError(reply, 404, 'NOT_FOUND', 'SubLibrary not found');
    return updated;
  });

  app.post('/v1/admin/sublibraries/:uuid/actions/scan', async (req, reply) => {
    const cfg = configStore.loadConfig();
    const subLib = (cfg.subLibraries || []).find((s) => s.uuid === req.params.uuid);
    if (!subLib) return apiError(reply, 404, 'NOT_FOUND', 'SubLibrary not found');
    return apiError(reply, 410, 'SUBLIBRARY_SCAN_REMOVED', 'Sub-library directory scan has been removed; background work must enter through the unified task admission model.');
  });

  // Manual rescrape of a single adult folder item (resets prior failure state).
  // Optional body { adultId } overrides the detected 番号 (useful for ambiguous items).
  app.post('/v1/admin/adult/items/:itemId/actions/rescrape', async (req, reply) => {
    try {
      const overrideAdultId = typeof req.body === 'object' && req.body ? req.body.adultId : undefined;
      const task = await adultLibraryService.rescrapeItem(
        req.params.itemId,
        typeof overrideAdultId === 'string' ? { overrideAdultId } : {},
      );
      if (!task) return apiError(reply, 409, 'CONFLICT', 'An active scrape task already exists for this item');
      return reply.code(201).send({ ok: true, taskId: task.id });
    } catch (e) {
      const code = /not found|does not exist|watchRoot/i.test(e.message) ? 'NOT_FOUND' : 'RESCRAPE_FAILED';
      const status = code === 'NOT_FOUND' ? 404 : 500;
      return apiError(reply, status, code, e.message);
    }
  });

  app.get('/v1/admin/adult/people', async (req) => {
    const includeReferenceFaces = req.query.includeReferenceFaces === '1' || req.query.includeReferenceFaces === 'true';
    return peopleStore.listPeople({
      adultRegion: req.query.adultRegion || 'western_adult',
      summary: !includeReferenceFaces,
    });
  });

  app.get('/v1/admin/adult/people/:personId/reference-image', async (req, reply) => {
    const person = peopleStore.getPerson(req.params.personId);
    if (!person) return apiError(reply, 404, 'NOT_FOUND', 'Person not found');
    const face = (person.referenceFaces || []).find((f) => f && f.sampleImageBase64);
    if (!face) return apiError(reply, 404, 'NOT_FOUND', 'Reference image not found');
    try {
      const buffer = Buffer.from(String(face.sampleImageBase64), 'base64');
      const image = await referenceImageBuffer(buffer, {
        thumbnail: req.query.thumbnail === '1' || req.query.thumbnail === 'true',
      });
      reply.header('Cache-Control', 'private, max-age=300');
      reply.type(image.contentType);
      return image.buffer;
    } catch (e) {
      return apiError(reply, 500, 'REFERENCE_IMAGE_INVALID', 'Reference image cannot be decoded');
    }
  });

  app.get('/v1/admin/adult/people/search-images', async (req, reply) => {
    try {
      const config = configStore.loadConfig();
      const result = await adultActorImageSearchService.searchActorImages({
        name: req.query.name,
        config,
        limit: req.query.limit,
      });
      return result;
    } catch (e) {
      return apiError(reply, 400, 'ACTOR_IMAGE_SEARCH_FAILED', e.message);
    }
  });

  app.post('/v1/admin/adult/people', async (req, reply) => {
    try {
      const person = peopleStore.createPerson(req.body || {});
      return reply.code(201).send(person);
    } catch (e) {
      return apiError(reply, 400, 'VALIDATION_ERROR', e.message);
    }
  });

  app.post('/v1/admin/adult/people/from-image', async (req, reply) => {
    try {
      const body = req.body || {};
      const name = String(body.name || '').trim();
      if (!name) return apiError(reply, 400, 'VALIDATION_ERROR', 'name is required');

      let imageBase64 = String(body.imageBase64 || '').trim();
      let contentType = 'image/jpeg';
      if (!imageBase64 && body.imageUrl) {
        const downloaded = await fetchImageAsBase64(body.imageUrl);
        imageBase64 = downloaded.base64;
        contentType = downloaded.contentType;
      }
      if (!imageBase64) return apiError(reply, 400, 'VALIDATION_ERROR', 'imageUrl or imageBase64 is required');

      const config = configStore.loadConfig();
      const western = ((config.adultLibrary || {}).western) || {};
      const face = await westernAdultLocalAiService.createReferenceFace({
        western,
        imageBase64,
        referenceId: body.referenceId || crypto.randomUUID(),
      });
      const referenceFace = peopleStore.normalizeReferenceFace({
        faceId: face.faceId || body.referenceId || crypto.randomUUID(),
        embedding: face.embedding || [],
        sampleImageBase64: imageBase64,
        confidence: face.detectionScore || 0,
        sourceItemId: 'actor_reference_image',
        sourceAssetId: body.imageUrl || body.source || '',
      });

      let person;
      if (body.personId) {
        const current = peopleStore.loadPeople().people.find((p) => p.personId === body.personId);
        if (!current) return apiError(reply, 404, 'NOT_FOUND', 'Person not found');
        person = peopleStore.updatePerson(body.personId, {
          name,
          aliases: body.aliases !== undefined ? body.aliases : current.aliases,
          referenceAssetIds: body.imageUrl ? [String(body.imageUrl)] : current.referenceAssetIds,
          referenceFaces: body.replaceReference === false
            ? [...(current.referenceFaces || []), referenceFace]
            : [referenceFace],
        });
      } else {
        person = peopleStore.createPerson({
          name,
          aliases: body.aliases,
          adultRegion: body.adultRegion || 'western_adult',
          referenceAssetIds: body.imageUrl ? [String(body.imageUrl)] : [],
          referenceFaces: [referenceFace],
        });
      }
      return reply.code(body.personId ? 200 : 201).send({
        ...person,
        referenceFaceQuality: {
          faceCount: face.faceCount || 0,
          detectionScore: face.detectionScore || 0,
          bbox: face.bbox || null,
        },
      });
    } catch (e) {
      const status = /No face detected/i.test(e.message) ? 422 : 400;
      return apiError(reply, status, 'REFERENCE_FACE_FAILED', e.message);
    }
  });

  app.post('/v1/admin/adult/people/from-face', async (req, reply) => {
    try {
      const body = req.body || {};
      if (!body.itemId) return apiError(reply, 400, 'VALIDATION_ERROR', 'itemId is required');
      const item = mediaLibraryService.getLibraryItem(String(body.itemId));
      if (!item) return apiError(reply, 404, 'NOT_FOUND', 'Library item not found');
      // Face clusters (post-clustering) are the primary source; fall back to the
      // legacy unknownFaces list for older items.
      const clusters = (item.adultMetadata && Array.isArray(item.adultMetadata.faceClusters))
        ? item.adultMetadata.faceClusters
        : [];
      const unknowns = (item.adultMetadata && Array.isArray(item.adultMetadata.unknownFaces))
        ? item.adultMetadata.unknownFaces
        : [];
      const pool = clusters.length ? clusters : unknowns;
      const face = body.clusterId
        ? pool.find((f) => String(f.clusterId || f.faceId || '') === String(body.clusterId))
        : pool.find((f) => !(f.status === 'named')) || pool[0];
      if (!face) return apiError(reply, 404, 'NOT_FOUND', 'Face cluster not found');
      const referenceFace = peopleStore.normalizeReferenceFace({
        ...face,
        sourceItemId: item.itemId,
        sourceAssetId: item.assetKey || '',
      });
      const person = peopleStore.createPerson({
        name: body.name,
        aliases: body.aliases,
        adultRegion: body.adultRegion || 'western_adult',
        referenceAssetIds: [item.itemId],
        referenceFaces: [referenceFace],
      });
      return reply.code(201).send(person);
    } catch (e) {
      return apiError(reply, 400, 'VALIDATION_ERROR', e.message);
    }
  });

  // Dismiss a face cluster: record its embedding on a dismissed person so future
  // scrapes drop it (blacklist). This is how male/supporting faces are excluded
  // from protagonist selection. Remediation of past items is via rescrape.
  app.post('/v1/admin/adult/items/:itemId/faces/:clusterId/dismiss', async (req, reply) => {
    try {
      const item = mediaLibraryService.getLibraryItem(String(req.params.itemId));
      if (!item) return apiError(reply, 404, 'NOT_FOUND', 'Library item not found');
      const clusters = (item.adultMetadata && Array.isArray(item.adultMetadata.faceClusters))
        ? item.adultMetadata.faceClusters
        : (item.adultMetadata && item.adultMetadata.unknownFaces) || [];
      const face = clusters.find((f) => String(f.clusterId || f.faceId || '') === String(req.params.clusterId));
      if (!face) return apiError(reply, 404, 'NOT_FOUND', 'Face cluster not found');
      const emb = (face.embedding || []).map(Number).filter((x) => Number.isFinite(x));
      if (!emb.length) return apiError(reply, 400, 'VALIDATION_ERROR', 'Cluster has no embedding to blacklist');
      const person = peopleStore.createPerson({
        name: `_dismissed_${face.clusterId || face.faceId || Date.now()}`,
        adultRegion: 'western_adult',
        dismissed: true,
        referenceAssetIds: [item.itemId],
        referenceFaces: [{
          faceId: face.clusterId || face.faceId || '',
          embedding: emb,
          sampleImageBase64: face.sampleImageBase64 || '',
          sourceItemId: item.itemId,
          sourceAssetId: item.assetKey || '',
        }],
      });
      return reply.code(201).send({ ok: true, personId: person.personId, dismissed: true });
    } catch (e) {
      return apiError(reply, 400, 'VALIDATION_ERROR', e.message);
    }
  });

  app.patch('/v1/admin/adult/people/:personId', async (req, reply) => {
    const person = peopleStore.updatePerson(req.params.personId, req.body || {});
    if (!person) return apiError(reply, 404, 'NOT_FOUND', 'Person not found');
    return person;
  });

  app.delete('/v1/admin/adult/people/:personId', async (req, reply) => {
    const ok = peopleStore.deletePerson(req.params.personId);
    if (!ok) return apiError(reply, 404, 'NOT_FOUND', 'Person not found');
    return { ok: true, personId: req.params.personId };
  });

  // ── Admin: Rule Templates ────────────────────────────────────────────────

  app.get('/v1/admin/rule-templates', async () => {
    const cfg = configStore.loadConfig();
    return { ruleTemplates: cfg.ruleTemplates || [] };
  });

  app.get('/v1/admin/rule-templates/:id', async (req, reply) => {
    const cfg = configStore.loadConfig();
    const tpl = (cfg.ruleTemplates || []).find((t) => t.id === req.params.id);
    if (!tpl) return apiError(reply, 404, 'NOT_FOUND', 'Rule template not found');
    return tpl;
  });

  app.post('/v1/admin/rule-templates', async (req, reply) => {
    const { id, name, description, rules, tag } = req.body || {};
    if (!id || !name) {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'id and name are required');
    }
    if (tag && tag.type === 'default') {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'Cannot create a default template');
    }
    const cfg = configStore.loadConfig();
    const list = cfg.ruleTemplates || [];
    if (list.find((t) => t.id === id)) {
      return apiError(reply, 409, 'CONFLICT', 'Template id already exists');
    }
    const tpl = { id, name, description: description || '', rules: rules || [], tag: { type: 'user' } };
    cfg.ruleTemplates = [...list, tpl];
    configStore.saveConfig(cfg);
    return reply.code(201).send(tpl);
  });

  app.put('/v1/admin/rule-templates/:id', async (req, reply) => {
    const cfg = configStore.loadConfig();
    const list = cfg.ruleTemplates || [];
    const idx = list.findIndex((t) => t.id === req.params.id);
    if (idx < 0) return apiError(reply, 404, 'NOT_FOUND', 'Rule template not found');

    const existing = list[idx];
    if (existing.tag && existing.tag.type === 'default') {
      return apiError(reply, 403, 'FORBIDDEN', 'Default templates are read-only');
    }

    const { name, description, rules } = req.body || {};
    list[idx] = {
      ...existing,
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(rules !== undefined ? { rules } : {}),
    };
    cfg.ruleTemplates = list;
    configStore.saveConfig(cfg);
    return list[idx];
  });

  app.delete('/v1/admin/rule-templates/:id', async (req, reply) => {
    const cfg = configStore.loadConfig();
    const list = cfg.ruleTemplates || [];
    const idx = list.findIndex((t) => t.id === req.params.id);
    if (idx < 0) return apiError(reply, 404, 'NOT_FOUND', 'Rule template not found');
    if (list[idx].tag && list[idx].tag.type === 'default') {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'Cannot delete a default template');
    }
    list.splice(idx, 1);
    cfg.ruleTemplates = list;
    configStore.saveConfig(cfg);
    return { ok: true, id: req.params.id };
  });

  // ── Admin: Adult Libraries ──────────────────────────────────────────────

  function sanitizeAdultLibraryForAdmin(adultLibrary = {}) {
    const out = maskAdultLibrarySecrets(adultLibrary || {});
    delete out.scanIntervalMinutes;
    delete out.western.faceEmbeddingsUrl;
    delete out.western.faceApiKey;
    return out;
  }

  function normalizeAdultWesternPatch(currentWestern = {}, requestedWestern = {}) {
    const next = { ...(requestedWestern || {}) };
    delete next.faceEmbeddingsUrl;
    delete next.faceApiKey;
    for (const key of ADULT_WESTERN_SECRET_KEYS) {
      if (next[key] === MASKED_SECRET) delete next[key];
    }
    return {
      ...(currentWestern || {}),
      ...next,
    };
  }

  app.get('/v1/admin/adult/config', async () => {
    const cfg = configStore.loadConfig();
    return sanitizeAdultLibraryForAdmin(cfg.adultLibrary || {});
  });

  app.patch('/v1/admin/adult/config', async (req) => {
    const current = configStore.loadConfig();
    const adultLibrary = {
      ...(current.adultLibrary || {}),
      ...(req.body || {}),
      japaneseJav: {
        ...((current.adultLibrary && current.adultLibrary.japaneseJav) || {}),
        ...((req.body && req.body.japaneseJav) || {}),
      },
      western: normalizeAdultWesternPatch(
        (current.adultLibrary && current.adultLibrary.western) || {},
        (req.body && req.body.western) || {},
      ),
    };
    delete adultLibrary.western.faceEmbeddingsUrl;
    delete adultLibrary.western.faceApiKey;
    delete adultLibrary.scanIntervalMinutes;
    const updated = configStore.patchConfig({ adultLibrary });
    return sanitizeAdultLibraryForAdmin(updated.adultLibrary || {});
  });

  // ── Admin: Transcode ────────────────────────────────────────────────────

  app.get('/v1/admin/transcode/config', async () => {
    const cfg = configStore.loadConfig();
    return {
      transcodeTempRoot: cfg.transcodeTempRoot || '',
      transcodeCleanupOrphansOnStartup: cfg.transcodeCleanupOrphansOnStartup !== false,
      transcodeReplaceConfirmRequired: cfg.transcodeReplaceConfirmRequired || false,
      ffmpegPath: cfg.ffmpegPath || 'ffmpeg',
      ffprobePath: cfg.ffprobePath || 'ffprobe',
      transcodeEncodingDevices: cfg.transcodeEncodingDevices || [],
      transcodeCpuParticipationStrategy: cfg.transcodeCpuParticipationStrategy || 'normal',
    };
  });

  app.patch('/v1/admin/transcode/config', async (req) => {
    const allowed = [
      'transcodeTempRoot', 'transcodeReplaceConfirmRequired',
      'transcodeCleanupOrphansOnStartup',
      'ffmpegPath', 'ffprobePath', 'transcodeEncodingDevices',
      'transcodeCpuParticipationStrategy',
    ];
    const patch = {};
    for (const key of allowed) {
      if (req.body && req.body[key] !== undefined) patch[key] = req.body[key];
    }
    return maskSensitive(configStore.patchConfig(patch));
  });

  app.get('/v1/admin/transcode/probe-devices', async () => {
    const cfg = configStore.loadConfig();
    return transcodeService.probeEncodeDevices(cfg);
  });

  app.get('/v1/admin/transcode/device-pool', async () => {
    const cfg = configStore.loadConfig();
    const slotUsage = transcodeService.getDeviceSlotUsage();

    // Local devices
    const localDevices = (cfg.transcodeEncodingDevices || []).map((dev) => {
      const inUse = slotUsage[dev.stableKey] || 0;
      const maxSlots = dev.maxSlots || 1;
      return {
        ...dev,
        remote: false,
        status: inUse >= maxSlots ? 'busy' : inUse > 0 ? 'busy' : 'idle',
        activeSlots: inUse,
      };
    });

    // Remote node devices (all nodes, not just online — show offline too)
    const allNodes = nodeStore.loadNodes();
    const remoteDevices = [];
    for (const node of allNodes) {
      for (const dev of (node.capabilities && node.capabilities.devices || [])) {
        const deviceId = `node:${node.id}:${dev.stableKey}`;
        const inUse = slotUsage[deviceId] || 0;
        const inPool = dev.inPool !== false; // default true for backward compat
        remoteDevices.push({
          stableKey: dev.stableKey,
          deviceId,
          nodeId: node.id,
          nodeName: node.name,
          nodeStatus: node.status,
          label: dev.label,
          backend: dev.backend,
          gpuIndex: dev.gpuIndex,
          inPool: node.status === 'online' && inPool,
          remote: true,
          priority: dev.priority || 150,
          maxSlots: dev.maxSlots || 1,
          status: node.status === 'offline' ? 'error'
            : !inPool ? 'idle'
            : inUse > 0 ? 'busy' : 'idle',
          activeSlots: inUse,
        });
      }
    }

    const devices = [...localDevices, ...remoteDevices];
    const totalDevices = devices.length;
    const idleDevices = devices.filter((d) => d.status === 'idle').length;
    const totalSlots = devices.reduce((s, d) => s + (d.maxSlots || 1), 0);
    const usedSlots = devices.reduce((s, d) => s + (d.activeSlots || 0), 0);
    return {
      devices,
      summary: { totalDevices, idleDevices, totalAvailableSlots: totalSlots, usedSlots },
    };
  });

  // ── Admin: Transcode Nodes ────────────────────────────────────────────────

  app.get('/v1/admin/nodes', async () => {
    const nodes = nodeStore.loadNodes();
    const tasks = taskStore.loadTasks({ includeHistory: false });
    const nodeList = nodes.map((n) => {
      const activeJobCount = tasks.filter((t) => t.nodeId === n.id && t.status === 'executing').length;
      return { ...n, apiKey: '********', activeJobCount };
    });
    return { nodes: nodeList };
  });

  app.get('/v1/admin/nodes/:id', async (req) => {
    const node = nodeStore.getNode(req.params.id);
    if (!node) return { error: { code: 'NOT_FOUND', message: 'Node not found' } };
    const tasks = taskStore.loadTasks({ includeHistory: false });
    const activeJobCount = tasks.filter((t) => t.nodeId === node.id && t.status === 'executing').length;
    return { ...node, apiKey: '********', activeJobCount };
  });

  app.post('/v1/admin/nodes', async (req, reply) => {
    const { name, address, apiKey } = req.body || {};
    if (!name || !address || !apiKey) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'name, address, apiKey required' } });
    }

    // Validate address format
    const addr = String(address).trim();
    if (!/^[\w.-]+:\d+$/.test(addr) && !/^[\w.-]+:\d+$/.test(addr.replace(/^https?:\/\//, ''))) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid address format (host:port)' } });
    }

    // Check for duplicate address
    const existing = nodeStore.loadNodes().find((n) => n.address === addr);
    if (existing) {
      return reply.code(409).send({ error: { code: 'CONFLICT', message: 'A node with this address already exists' } });
    }

    // Probe worker
    const node = { address: addr, apiKey: String(apiKey) };
    let capabilities;
    try {
      const health = await nodeService.checkHealth(node);
      if (!health.ok) throw new Error('Worker health check failed');
      capabilities = await nodeService.getCapabilities(node);
    } catch (err) {
      return reply.code(502).send({ error: { code: 'WORKER_UNREACHABLE', message: `Cannot reach worker: ${err.message}` } });
    }

    const created = nodeStore.addNode({ name: String(name).trim(), address: addr, apiKey: String(apiKey), capabilities });
    return reply.code(201).send({ ...created, apiKey: '********' });
  });

  app.delete('/v1/admin/nodes/:id', async (req, reply) => {
    const node = nodeStore.getNode(req.params.id);
    if (!node) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Node not found' } });

    const force = req.query && req.query.force === 'true';
    const activeCount = nodeStore.getNodeActiveJobCount(req.params.id, taskStore);

    if (activeCount > 0 && !force) {
      return reply.code(409).send({
        error: { code: 'NODE_HAS_ACTIVE_JOBS', message: `Node has ${activeCount} active job(s). Use ?force=true to force delete.` },
        activeJobCount: activeCount,
      });
    }

    if (force && activeCount > 0) {
      // Cancel all active tasks on this node
      const tasks = taskStore.loadTasks({ includeHistory: false });
      for (const t of tasks) {
        if (t.nodeId === node.id && t.status === 'executing') {
          const flow = getFlow(t.actionType);
          if (flow) { try { await flow.cancel(t.id); } catch (_) {} }
          taskStore.updateTask(t.id, { status: 'failed_hard', logs: [{ ts: new Date().toISOString(), level: 'error', msg: `Node ${node.name} deleted by admin` }] });
        }
      }
    }

    nodeStore.deleteNode(req.params.id);
    return { ok: true };
  });

  app.patch('/v1/admin/nodes/:id', async (req, reply) => {
    const node = nodeStore.getNode(req.params.id);
    if (!node) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Node not found' } });

    const { name, apiKey } = req.body || {};
    const patch = {};
    if (name !== undefined) {
      if (!String(name).trim()) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'name must not be empty' } });
      patch.name = String(name).trim();
    }
    if (apiKey !== undefined) {
      if (!String(apiKey).trim()) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'apiKey must not be empty' } });
      patch.apiKey = String(apiKey).trim();
    }
    if (Object.keys(patch).length === 0) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'At least one of name or apiKey required' } });
    }

    const updated = nodeStore.updateNode(req.params.id, patch);
    const tasks = taskStore.loadTasks({ includeHistory: false });
    const activeJobCount = tasks.filter((t) => t.nodeId === updated.id && t.status === 'executing').length;
    return { ...updated, apiKey: '********', activeJobCount };
  });

  app.post('/v1/admin/nodes/:id/actions/probe', async (req, reply) => {
    const node = nodeStore.getNode(req.params.id);
    if (!node) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Node not found' } });

    try {
      const capabilities = await nodeService.getCapabilities(node);
      nodeStore.mergeCapabilities(req.params.id, capabilities.devices || []);
      nodeStore.updateNode(req.params.id, { lastSeenAt: new Date().toISOString(), consecutiveFailures: 0, status: 'online' });
      const updated = nodeStore.getNode(req.params.id);
      return { ok: true, capabilities: updated.capabilities };
    } catch (err) {
      return reply.code(502).send({ error: { code: 'WORKER_UNREACHABLE', message: err.message } });
    }
  });

  // Update a node device pool config (inPool, priority, maxSlots)
  app.patch('/v1/admin/nodes/:id/devices', async (req, reply) => {
    const node = nodeStore.getNode(req.params.id);
    if (!node) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Node not found' } });

    const { stableKey, inPool, priority, maxSlots } = req.body || {};
    if (!stableKey) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'stableKey required' } });

    const extra = {};
    if (typeof priority === 'number') extra.priority = priority;
    if (typeof maxSlots === 'number') extra.maxSlots = maxSlots;

    const ok = nodeStore.setDeviceInPool(req.params.id, String(stableKey), !!inPool, extra);
    if (!ok) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Device not found on node' } });

    const updated = nodeStore.getNode(req.params.id);
    return { ok: true, capabilities: updated.capabilities };
  });

  // ── Admin: Upgrade (MoviePilot) ──────────────────────────────────────────

  app.get('/v1/admin/upgrade/config', async () => {
    const cfg = configStore.loadConfig();
    const mp = cfg.moviepilot || {};
    return {
      moviepilot: { ...mp, apiKey: mp.apiKey ? '********' : '' },
      upgradeStagingLocalPath: cfg.upgradeStagingLocalPath || '',
      upgradeReplaceConfirmRequired: cfg.upgradeReplaceConfirmRequired || false,
      upgradeRetryInterval: cfg.upgradeRetryInterval ?? 3600000,
      upgradeMaxRetries: cfg.upgradeMaxRetries ?? 3,
    };
  });

  app.patch('/v1/admin/upgrade/config', async (req) => {
    const allowed = ['moviepilot', 'upgradeStagingLocalPath', 'upgradeReplaceConfirmRequired', 'upgradeRetryInterval', 'upgradeMaxRetries'];
    const patch = {};
    for (const key of allowed) {
      if (req.body && req.body[key] !== undefined) patch[key] = req.body[key];
    }
    return maskSensitive(configStore.patchConfig(patch));
  });

  // ── Admin: MoviePilot Sites ───────────────────────────────────────────

  // Get MoviePilot download directories for user selection
  app.get('/v1/admin/upgrade/directories', async () => {
    const cfg = configStore.loadConfig();
    const mp = cfg.moviepilot || {};
    if (!mp.baseUrl || !mp.apiKey) return [];
    try {
      return await moviepilotService.fetchDirectories(mp);
    } catch (e) {
      console.error('[admin] fetchDirectories error:', e.message);
      return [];
    }
  });

  app.get('/v1/admin/moviepilot/sites', async () => {
    const cfg = configStore.loadConfig();
    const mp = cfg.moviepilot || {};
    if (!mp.baseUrl || !mp.apiKey) return [];
    try {
      const sites = await moviepilotService.listSites(mp);
      if (!Array.isArray(sites)) return [];
      return sites.map((s) => ({ id: s.id, name: s.name, domain: s.domain, is_active: s.is_active }));
    } catch (e) {
      console.error('[admin] listSites error:', e.message);
      return [];
    }
  });

  // ── Admin: Tasks ────────────────────────────────────────────────────────

  app.get('/v1/admin/tasks', async (req) => {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.statuses) {
      filter.statuses = String(req.query.statuses)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (req.query.actionType) filter.actionType = req.query.actionType;
    if (req.query.q) filter.q = req.query.q;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));
    const result = taskStore.queryTaskSummaries(filter, { page, pageSize, orderBy: 'updatedAt', orderDir: 'desc' });
    return {
      tasks: result.tasks.map(taskListSummary),
      summary: { total: result.total, byStatus: result.byStatus },
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
    };
  });

  app.get('/v1/admin/tasks/:id', async (req, reply) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return apiError(reply, 404, 'NOT_FOUND', 'Task not found');
    return taskDetailView(task);
  });

  app.patch('/v1/admin/tasks/:id', async (req, reply) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return apiError(reply, 404, 'NOT_FOUND', 'Task not found');

    const body = req.body || {};

    // Priority adjustment (lower = runs first). Only meaningful before dispatch,
    // so reject once the task is actively executing or in a terminal state.
    if (body.priority !== undefined) {
      const priority = Number(body.priority);
      if (!Number.isFinite(priority) || priority < 0 || !Number.isInteger(priority)) {
        return apiError(reply, 400, 'VALIDATION_ERROR', 'priority must be a non-negative integer');
      }
      const editable = ['created', 'pending_manual', 'queued', 'interrupted', 'paused'];
      if (!editable.includes(task.status)) {
        return apiError(reply, 409, 'TASK_CONFLICT', `Cannot set priority on task in status "${task.status}"`);
      }
      const updated = taskStore.updateTask(task.id, { priority, priorityManuallyAdjusted: true });
      return updated;
    }

    return apiError(reply, 400, 'VALIDATION_ERROR', 'No supported fields to update');
  });

  app.delete('/v1/admin/tasks/:id', async (req, reply) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return apiError(reply, 404, 'NOT_FOUND', 'Task not found');

    const flow = getFlow(task.actionType);
    if (flow && taskNeedsFlowCancel(task)) await flow.cancel(task.id);

    taskStore.deleteTask(task.id);
    return { ok: true, id: task.id };
  });

  // ── Admin: System Info ────────────────────────────────────────────────────

  app.get('/v1/admin/system/info', async () => {
    return { platform: process.platform };
  });

  // ── Admin: Health ───────────────────────────────────────────────────────

  app.get('/v1/admin/health', async () => {
    const result = healthCheck.getLastResult();
    if (!result) {
      // Run fresh check
      const fresh = await healthCheck.runAllChecks();
      return fresh;
    }
    return result;
  });
}

// ── Flow helper ─────────────────────────────────────────────────────────────

function getFlow(actionType) {
  switch (actionType) {
    case 'ingest': return require('./ingestFlowExecutor');
    case 'delete': return require('./deleteFlowExecutor');
    case 'transcode': return require('./transcodeFlowExecutor');
    case 'upgrade': return require('./upgradeFlowExecutor');
    case 'scrape': return require('./scrapeFlowExecutor');
    default: return null;
  }
}

// ── Build App ───────────────────────────────────────────────────────────────

async function buildApp(opts = {}) {
  process.env.CONTROL_PLANE_DATA_DIR =
    opts.dataDir ||
    process.env.MEDIA_SERVICE_DATA_DIR ||
    process.env.CONTROL_PLANE_DATA_DIR ||
    require('path').join(__dirname, '..', 'data');

  const API_KEY =
    opts.apiKey !== undefined
      ? opts.apiKey
      : process.env.MEDIA_SERVICE_API_KEY || process.env.CONTROL_PLANE_API_KEY || configStore.loadConfig().apiKey || '';

  const app = Fastify({ logger: opts.logger !== undefined ? opts.logger : true });
  await app.register(cors, { origin: true });

  // Serve built React admin app
  const distAdminPath = path.join(__dirname, '..', 'dist', 'admin');
  await app.register(fastifyStatic, {
    root: distAdminPath,
    prefix: '/',
    decorateReply: false,
  });

  // SPA fallback: redirect unmatched paths to index.html (but not API routes)
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/v1/')) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    }
    // Try serving index.html for SPA routes
    const indexPath = path.join(distAdminPath, 'index.html');
    try {
      const fs = require('fs');
      const html = fs.readFileSync(indexPath, 'utf8');
      reply.type('text/html').send(html);
    } catch {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    }
  });

  // Auth hook
  app.addHook('onRequest', (req, reply, done) => {
    const url = req.url;
    // Public routes
    if (url.startsWith('/v1/health')) return done();
    if (!url.startsWith('/v1/')) return done(); // static files, SPA routes

    if (!API_KEY) return done();
    const k = req.headers['x-api-key'];
    if (k !== API_KEY) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid or missing X-Api-Key' } });
    }
    done();
  });

  registerRoutes(app);

  app.addHook('onClose', async () => {
    taskScheduler.stopScheduler();
    healthCheck.stopHealthCheckTimer();
    mediaLibraryService.stopAllTimers();
    strategyEngine.stop();
    smartTaskEngine.stop();
  });

  // Clean up orphan ffmpeg processes and temp dirs from previous run
  // Must run BEFORE scheduler starts dispatching tasks
  const startupCfg = configStore.loadConfig();
  if (startupCfg.transcodeTempRoot && startupCfg.transcodeCleanupOrphansOnStartup !== false) {
    await transcodeService.cleanupOrphans(startupCfg);
  }
  try {
    adultLibraryService.repairInvalidWesternScrapeState();
  } catch (e) {
    console.warn('[adultLibrary] invalid western scrape repair skipped:', e.message);
  }

  // Start health check timer and subLibrary timers
  healthCheck.startHealthCheckTimer();
  mediaLibraryService.startAllSubLibraryTimers();
  taskScheduler.startScheduler();
  strategyEngine.start(configStore, mediaLibraryService);
  smartTaskEngine.start(configStore, mediaLibraryService, taskStore);

  const errorHandler = (err, req, reply) => {
    req.log.error(err);
    const statusCode = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    reply.code(statusCode).send({
      error: {
        code: err.code && typeof err.code === 'string' ? err.code : 'INTERNAL_ERROR',
        message: err.message || 'Internal error',
      },
    });
  };
  app.setErrorHandler(errorHandler);

  serverReady = true;
  return app;
}

module.exports = { buildApp };
