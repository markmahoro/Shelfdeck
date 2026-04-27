'use strict';

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

let serverReady = false;

// ── Helpers ──────────────────────────────────────────────────────────────────

function apiError(reply, status, code, message) {
  return reply.code(status).send({ error: { code, message } });
}

function maskSensitive(config) {
  const masked = { ...config };
  if (masked.apiKey) masked.apiKey = '********';
  if (masked.douban && masked.douban.cookieHeader) {
    masked.douban = { ...masked.douban, cookieHeader: '********' };
  }
  if (masked.moviepilot && masked.moviepilot.apiKey) {
    masked.moviepilot = { ...masked.moviepilot, apiKey: '********' };
  }
  if (masked.embyServers) {
    const servers = {};
    for (const [k, v] of Object.entries(masked.embyServers)) {
      servers[k] = { ...v, apiKey: '********', embyUserPassword: v.embyUserPassword ? '********' : '' };
    }
    masked.embyServers = servers;
  }
  return masked;
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
  if (subLibraryId) return resolveEmbyConfigForLibrary(subLibraryId);
  const libItem = mediaLibraryService.getLibraryItem(itemId);
  if (libItem && libItem.subLibraryId) {
    return resolveEmbyConfigForLibrary(libItem.subLibraryId);
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
    if (!['delete', 'transcode', 'upgrade'].includes(actionType)) {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'Invalid actionType');
    }

    // itemId lock check
    const existing = taskStore.getTasks({ itemId });
    const active = existing.find((t) => ['created', 'queued', 'executing', 'awaiting_user_confirm', 'paused'].includes(t.status));
    if (active) {
      return apiError(reply, 409, 'TASK_CONFLICT', `Item ${itemId} already has an active task (${active.id})`);
    }

    const cfg = configStore.loadConfig();
    const status = cfg.executionMode === 'auto' ? 'created' : 'pending_manual';

    // Populate itemInfo from media library
    const libItem = mediaLibraryService.getLibraryItem(itemId);
    const itemInfo = libItem ? {
      name: libItem.name,
      path: libItem.path,
      subLibraryId: libItem.subLibraryId,
      resolution: libItem.resolution,
      bitrate: libItem.bitrate,
      size: libItem.size,
      type: libItem.type,
      doubanRating: libItem.doubanRating,
      userRating: libItem.userRating,
    } : null;

    const task = taskStore.createTask({
      itemId,
      actionType,
      status,
      itemInfo,
      logs: [{ ts: new Date().toISOString(), level: 'info', msg: 'Task created' }],
    });

    return reply.code(201).send(task);
  });

  app.get('/v1/tasks', async (req) => {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.actionType) filter.actionType = req.query.actionType;
    const tasks = taskStore.getTasks(filter);
    return { tasks };
  });

  app.get('/v1/tasks/:id', async (req, reply) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return apiError(reply, 404, 'NOT_FOUND', 'Task not found');
    return task;
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

    // Re-queue for scheduler
    const updated = taskStore.updateTask(task.id, { status: 'queued' });
    return { id: updated.id, status: updated.status, updatedAt: updated.updatedAt };
  });

  app.post('/v1/tasks/:id/actions/execute', async (req, reply) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return apiError(reply, 404, 'NOT_FOUND', 'Task not found');

    if (task.status === 'pending_manual') {
      taskStore.updateTask(task.id, { status: 'queued' });
      return { id: task.id, status: 'queued', updatedAt: new Date().toISOString() };
    }
    if (task.status === 'paused') {
      taskStore.updateTask(task.id, { status: 'queued' });
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

    // Always cancel to clean up FFmpeg process and partial files
    const flow = getFlow(task.actionType);
    if (flow) await flow.cancel(task.id);

    taskStore.deleteTask(task.id);
    return { ok: true, id: task.id };
  });

  // ── Library ─────────────────────────────────────────────────────────────

  app.get('/v1/library', async (req) => {
    const filter = {};
    if (req.query.source) filter.source = req.query.source;
    if (req.query.type) filter.type = req.query.type;
    if (req.query.action) filter.action = req.query.action;
    if (req.query.subLibraryId) filter.subLibraryId = req.query.subLibraryId;
    const result = mediaLibraryService.getLibrary(filter);
    // Attach embyWebUrl for desktop play button
    const cfg = configStore.loadConfig();
    const servers = cfg.embyServers || {};
    const subLibs = cfg.subLibraries || [];
    for (const item of result.items) {
      const sl = subLibs.find((s) => s.uuid === item.subLibraryId);
      if (sl && servers[sl.embyServerId] && servers[sl.embyServerId].baseUrl) {
        item.embyWebUrl = `${String(servers[sl.embyServerId].baseUrl).replace(/\/+$/, '')}/web/index.html#!/item?id=${item.itemId}`;
      }
    }
    return result;
  });

  app.get('/v1/library/queries/manage', async (req) => {
    const filter = {};
    if (req.query.source) filter.source = req.query.source;
    if (req.query.type) filter.type = req.query.type;
    if (req.query.action) filter.action = req.query.action;
    if (req.query.subLibraryId) filter.subLibraryId = req.query.subLibraryId;
    return mediaLibraryService.getLibrary(filter);
  });

  app.get('/v1/library/items/:itemId', async (req, reply) => {
    const item = mediaLibraryService.getLibraryItem(req.params.itemId);
    if (!item) return apiError(reply, 404, 'NOT_FOUND', 'Item not found');
    return item;
  });

  app.patch('/v1/library/ratings', async (req, reply) => {
    const { itemId, userRating } = req.body || {};
    if (!itemId || typeof userRating !== 'number') {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'itemId and userRating are required');
    }
    if (userRating < 1 || userRating > 5) {
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

  app.get('/v1/library/status', async () => {
    return mediaLibraryService.getLibraryStatus();
  });

  app.post('/v1/library/cache', async (req) => {
    const { subLibraryId, items } = req.body || {};
    if (!subLibraryId || !Array.isArray(items)) {
      return { ok: true, upserted: 0, removed: 0 };
    }
    const result = mediaLibraryService.upsertItems(subLibraryId, items);
    return { ok: true, ...result };
  });

  // ── Library: mark played / unplayed ─────────────────────────────────────

  app.post('/v1/library/actions/mark-played', async (req, reply) => {
    const { itemId, subLibraryId } = req.body || {};
    if (!itemId) return apiError(reply, 400, 'VALIDATION_ERROR', 'itemId is required');

    const resolved = resolveEmbyConfigForItem(itemId, subLibraryId || '');
    if (resolved.error) return apiError(reply, 404, resolved.error.code, resolved.error.message);

    try {
      await embyService.markPlayed(resolved.serverConfig, itemId);
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
      await embyService.markUnplayed(resolved.serverConfig, itemId);
      return { ok: true };
    } catch (e) {
      return apiError(reply, 502, 'EMBY_ERROR', e.message);
    }
  });

  // ── Library: queries (real-time from Emby) ──────────────────────────────

  app.post('/v1/library/queries/played', async (req, reply) => {
    const { subLibraryId, days, type, sectionId } = req.body || {};
    const resolved = resolveEmbyConfigForLibrary(subLibraryId || '');
    if (resolved.error) return apiError(reply, 404, resolved.error.code, resolved.error.message);

    try {
      const items = await embyService.getPlayedItems(resolved.serverConfig, {
        days: days || 0,
        type: type || 'all',
        sectionId: sectionId || resolved.subLib.sectionId,
      });
      return items;
    } catch (e) {
      return apiError(reply, 502, 'EMBY_ERROR', e.message);
    }
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
    const { baseUrl, apiKey, userId } = req.body || {};
    if (!baseUrl || !apiKey) {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'baseUrl and apiKey are required');
    }
    try {
      const serverInfo = await embyService.testConnection({ baseUrl, apiKey, userId: userId || '' });
      // Inline register: check if server already exists
      const cfg = configStore.loadConfig();
      const servers = cfg.embyServers || {};
      let embyServerId = Object.keys(servers).find((k) => servers[k].baseUrl === baseUrl);
      if (!embyServerId) {
        embyServerId = crypto.randomUUID();
        servers[embyServerId] = {
          serverName: serverInfo.serverName || baseUrl,
          baseUrl,
          apiKey,
          userId: userId || '',
          embyUserPassword: '',
        };
        configStore.patchConfig({ embyServers: servers });
      }
      return { ok: true, message: 'Emby connection successful', serverInfo, embyServerId };
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

  app.post('/v1/admin/sublibraries', async (req, reply) => {
    const { name, embyServerId, sectionId, source, doubanEnabled, mediaPolicy } = req.body || {};
    if (!name || !embyServerId || !sectionId) {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'name, embyServerId, and sectionId are required');
    }
    const cfg = configStore.loadConfig();
    if (!(cfg.embyServers || {})[embyServerId]) {
      return apiError(reply, 404, 'NOT_FOUND', 'Emby server not found');
    }
    const subLib = mediaLibraryService.addSubLibrary({ name, embyServerId, sectionId, source, doubanEnabled, mediaPolicy });
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

  // ── Admin: Transcode ────────────────────────────────────────────────────

  app.get('/v1/admin/transcode/config', async () => {
    const cfg = configStore.loadConfig();
    return {
      transcodeTempRoot: cfg.transcodeTempRoot || '',
      transcodeReplaceConfirmRequired: cfg.transcodeReplaceConfirmRequired || false,
      ffmpegPath: cfg.ffmpegPath || 'ffmpeg',
      ffprobePath: cfg.ffprobePath || 'ffprobe',
      transcodeEncodingDevices: cfg.transcodeEncodingDevices || [],
      transcodeMaxCpuSlots: cfg.transcodeMaxCpuSlots || 1,
      transcodeCpuParticipationStrategy: cfg.transcodeCpuParticipationStrategy || 'normal',
    };
  });

  app.patch('/v1/admin/transcode/config', async (req) => {
    const allowed = [
      'transcodeTempRoot', 'transcodeReplaceConfirmRequired',
      'ffmpegPath', 'ffprobePath', 'transcodeEncodingDevices',
      'transcodeMaxCpuSlots', 'transcodeCpuParticipationStrategy',
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
    const devices = (cfg.transcodeEncodingDevices || []).map((dev) => ({
      ...dev,
      status: 'idle',
      activeSlots: 0,
    }));
    const totalDevices = devices.length;
    const idleDevices = devices.filter((d) => d.status === 'idle').length;
    return {
      devices,
      summary: { totalDevices, idleDevices, totalAvailableSlots: totalDevices, usedSlots: 0 },
    };
  });

  // ── Admin: Upgrade (MoviePilot) ──────────────────────────────────────────

  app.get('/v1/admin/upgrade/config', async () => {
    const cfg = configStore.loadConfig();
    const mp = cfg.moviepilot || {};
    return {
      moviepilot: { ...mp, apiKey: mp.apiKey ? '********' : '' },
      upgradeStagingLocalPath: cfg.upgradeStagingLocalPath || '',
      upgradeRetryInterval: cfg.upgradeRetryInterval || 3600000,
      upgradeMaxRetries: cfg.upgradeMaxRetries || 3,
    };
  });

  app.patch('/v1/admin/upgrade/config', async (req) => {
    const allowed = ['moviepilot', 'upgradeStagingLocalPath', 'upgradeRetryInterval', 'upgradeMaxRetries'];
    const patch = {};
    for (const key of allowed) {
      if (req.body && req.body[key] !== undefined) patch[key] = req.body[key];
    }
    return maskSensitive(configStore.patchConfig(patch));
  });

  // ── Admin: Tasks ────────────────────────────────────────────────────────

  app.get('/v1/admin/tasks', async (req) => {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.actionType) filter.actionType = req.query.actionType;
    const tasks = taskStore.getTasks(filter);
    const byStatus = {};
    for (const t of tasks) {
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    }
    return { tasks, summary: { total: tasks.length, byStatus } };
  });

  app.get('/v1/admin/tasks/:id', async (req, reply) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return apiError(reply, 404, 'NOT_FOUND', 'Task not found');
    return task;
  });

  app.delete('/v1/admin/tasks/:id', async (req, reply) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return apiError(reply, 404, 'NOT_FOUND', 'Task not found');

    // Always cancel to clean up FFmpeg process and partial files
    const flow = getFlow(task.actionType);
    if (flow) flow.cancel(task.id);

    taskStore.deleteTask(task.id);
    return { ok: true, id: task.id };
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
    case 'delete': return require('./deleteFlowExecutor');
    case 'transcode': return require('./transcodeFlowExecutor');
    case 'upgrade': return require('./upgradeFlowExecutor');
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
  });

  // Start health check timer and subLibrary timers
  healthCheck.startHealthCheckTimer();
  mediaLibraryService.startAllSubLibraryTimers();
  taskScheduler.startScheduler();

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
