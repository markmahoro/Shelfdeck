'use strict';

const crypto = require('crypto');
const path = require('path');
const cors = require('@fastify/cors');
const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');
const { FileStore } = require('./store');
const configStore = require('./configStore');
const taskStore = require('./taskStore');
const cacheStore = require('./cacheStore');
const taskScheduler = require('./taskScheduler');
const embyService = require('./services/embyService');
const doubanService = require('./services/doubanService');
const transcodeService = require('./services/transcodeService');

const transcodeJobState = new Map();
const doubanJobState = new Map();
const ratingStore = require('./ratingStore');

// In-memory admin session store (sessions are HMAC-signed, verified by checking they were issued)
const adminSessions = new Set();

// Server ready flag — set to true after app.listen() succeeds
let serverReady = false;

// Emby 健康检查缓存（60s TTL）
const embyHealthCache = { ok: false, ts: 0 };
const EMBY_CACHE_TTL_MS = 60_000;

async function getEmbyHealth(embyConfig) {
  if (Date.now() - embyHealthCache.ts < EMBY_CACHE_TTL_MS) {
    return embyHealthCache;
  }
  try {
    await embyService.testConnection(embyConfig);
    embyHealthCache.ok = true;
    embyHealthCache.ts = Date.now();
  } catch {
    embyHealthCache.ok = false;
    embyHealthCache.ts = Date.now();
  }
  return embyHealthCache;
}

function resolveEmbyClientFromConfig(query) {
  const root = configStore.loadConfig();
  const pid = query && query.embyProfileId;
  if (pid && root.embyProfiles && typeof root.embyProfiles === 'object' && root.embyProfiles[pid]) {
    return root.embyProfiles[pid];
  }
  if (root.embyClient && typeof root.embyClient === 'object' && root.embyClient.baseUrl) {
    return root.embyClient;
  }
  // Fallback to top-level fields (admin page saves embyClient via top-level baseUrl/apiKey)
  if (root.baseUrl || root.apiKey) {
    return { baseUrl: root.baseUrl || '', apiKey: root.apiKey || '', userId: root.userId || '', embyUserPassword: root.embyUserPassword || '' };
  }
  return null;
}

function apiError(reply, status, code, message, details) {
  reply.code(status).send({ code, message, details });
}

function verifyAdminSession(req) {
  const session = req.headers['x-admin-session'];
  return session && adminSessions.has(String(session));
}

/** @param {import('./store').FileStore} store */
function registerRoutes(app, store) {
  app.get('/v1/health', async (req, reply) => {
    const cfg = configStore.loadConfig();
    const embyConfig = cfg.embyClient || cfg;

    const serviceOk = serverReady;
    const configOk = !!(embyConfig.baseUrl && embyConfig.apiKey && embyConfig.userId);
    const embyHealth = await getEmbyHealth(embyConfig);
    const embyOk = embyHealth.ok;
    const schedulerOk = taskScheduler.isRunning();

    const checks = {
      service: serviceOk ? 'ok' : 'error',
      config: configOk ? 'ok' : 'error',
      emby: embyOk ? 'ok' : 'error',
      scheduler: schedulerOk ? 'ok' : 'error',
    };
    const okCount = Object.values(checks).filter(v => v === 'ok').length;
    const healthy = okCount >= 4 ? 'green' : okCount >= 2 ? 'yellow' : 'red';

    return { status: 'ok', version: '0.1.0', healthy, checks };
  });

  // ── Admin Auth ────────────────────────────────────────────────
  // GET /v1/admin/auth-status → { needSetup, needLogin, pinSet }
  app.get('/v1/admin/auth-status', async () => {
    const cfg = configStore.loadConfig();
    return {
      needSetup: !cfg.adminPin,
      needLogin: !!cfg.adminPin,
      pinSet: !!cfg.adminPin,
    };
  });

  // POST /v1/admin/pin { action: 'set'|'verify', pin }
  app.post('/v1/admin/pin', async (req, reply) => {
    const { action, pin } = req.body || {};
    const cfg = configStore.loadConfig();

    if (action === 'set') {
      if (!pin || pin.length < 4) {
        return apiError(reply, 400, 'VALIDATION_ERROR', 'PIN must be at least 4 characters');
      }
      configStore.patchConfig({ adminPin: pin });
      return { ok: true, message: 'PIN set successfully' };
    }

    if (action === 'verify') {
      if (!pin) return apiError(reply, 400, 'VALIDATION_ERROR', 'PIN required');
      const ok = pin === cfg.adminPin;
      if (!ok) return apiError(reply, 401, 'UNAUTHORIZED', 'Invalid PIN');
      // Return HMAC-signed session token and store it
      const secret = cfg.serviceApiKey || 'default-secret';
      const session = crypto.createHmac('sha256', secret).update(Date.now().toString()).digest('hex');
      adminSessions.add(session);
      return { ok: true, session };
    }

    return apiError(reply, 400, 'VALIDATION_ERROR', 'Unknown action');
  });

  // POST /v1/admin/shutdown — stop the service (requires session)
  app.post('/v1/admin/shutdown', async (req, reply) => {
    if (!verifyAdminSession(req)) {
      return apiError(reply, 401, 'UNAUTHORIZED', 'Valid admin session required');
    }
    reply.code(204).send();
    void (async () => {
      await new Promise((r) => setTimeout(r, 100));
      taskScheduler.stopScheduler();
      try { await req.server.close(); } catch (_) {}
      process.exit(0);
    })();
  });

  // GET /v1/admin/config — returns config without sensitive fields (admin page uses this)
  app.get('/v1/admin/config', async (req, reply) => {
    if (!verifyAdminSession(req)) {
      return apiError(reply, 401, 'UNAUTHORIZED', 'Valid admin session required');
    }
    const cfg = configStore.loadConfig();
    const { adminPin, serviceApiKey, ...safeConfig } = cfg;
    return safeConfig;
  });

  app.get('/v1/config', async () => configStore.loadConfig());

  app.patch('/v1/config', async (req, reply) => {
    // If X-Admin-Session header is present, verify it (admin page sends it)
    if (req.headers['x-admin-session'] && !verifyAdminSession(req)) {
      return apiError(reply, 401, 'UNAUTHORIZED', 'Valid admin session required');
    }
    const patch = req.body && typeof req.body === 'object' ? req.body : {};
    return configStore.patchConfig(patch);
  });

  app.get('/v1/sync/task-queue', async (_req, reply) => {
    reply.header('Deprecation', 'true');
    reply.header('Sunset', '2026-06-01');
    return taskStore.loadTasks();
  });

  app.put('/v1/sync/task-queue', async (req, reply) => {
    reply.header('Deprecation', 'true');
    reply.header('Sunset', '2026-06-01');
    const body = req.body;
    if (!Array.isArray(body)) {
      apiError(reply, 400, 'VALIDATION_ERROR', 'Body must be a JSON array');
      return;
    }
    taskStore.saveTasks(body);
    return { ok: true, count: body.length };
  });

  app.post('/v1/emby/actions/test-connection', async (req) => embyService.testConnection(req.body));

  app.post('/v1/emby/actions/list-users', async (req) => embyService.getUsers(req.body));

  app.post('/v1/emby/actions/list-media-folders', async (req) => embyService.getMediaFolders(req.body));

  app.post('/v1/library/queries/unplayed', async (req) => embyService.getUnplayedItems(req.body));

  app.post('/v1/library/queries/manage', async (req) => embyService.getLibraryItemsForManage(req.body));

  app.post('/v1/library/queries/played', async (req) => embyService.getPlayedItems(req.body));

  /** 与 IPC 载荷一致：body 含 { config, itemId } */
  app.post('/v1/library/actions/get-item', async (req) => embyService.getLibraryItem(req.body));

  app.post('/v1/library/actions/delete-info', async (req) => embyService.getItemDeleteInfo(req.body));

  app.post('/v1/library/actions/exists', async (req) => {
    const exists = await embyService.libraryItemExists(req.body);
    return { exists };
  });

  app.post('/v1/library/actions/delete-item', async (_req, reply) => {
    await embyService.deleteLibraryItem(_req.body);
    reply.code(204).send();
  });

  app.post('/v1/library/actions/mark-played', async (_req, reply) => {
    await embyService.markPlayed(_req.body);
    reply.code(204).send();
  });

  app.post('/v1/library/actions/mark-unplayed', async (_req, reply) => {
    await embyService.markUnplayed(_req.body);
    reply.code(204).send();
  });

  /** OpenAPI：使用媒体管理服务已缓存的 embyClient（由桌面 PATCH /v1/config 同步） */
  app.get('/v1/library/items/:itemId', async (req, reply) => {
    const config = resolveEmbyClientFromConfig(req.query);
    if (!config) {
      apiError(
        reply,
        400,
        'VALIDATION_ERROR',
        'No Emby client on control plane. PATCH /v1/config with embyClient, pass embyProfileId, or use POST /v1/library/actions/get-item with full config in body.',
      );
      return;
    }
    return embyService.getLibraryItem({ config, itemId: req.params.itemId });
  });

  app.get('/v1/library/items/:itemId/delete-info', async (req, reply) => {
    const config = resolveEmbyClientFromConfig(req.query);
    if (!config) {
      apiError(reply, 400, 'VALIDATION_ERROR', 'No Emby client on control plane; sync config or use POST /v1/library/actions/delete-info.');
      return;
    }
    return embyService.getItemDeleteInfo({ config, itemId: req.params.itemId });
  });

  app.get('/v1/library/items/:itemId/exists', async (req, reply) => {
    const config = resolveEmbyClientFromConfig(req.query);
    if (!config) {
      apiError(reply, 400, 'VALIDATION_ERROR', 'No Emby client on control plane; sync config or use POST /v1/library/actions/exists.');
      return;
    }
    const exists = await embyService.libraryItemExists({ config, itemId: req.params.itemId });
    return { exists };
  });

  app.delete('/v1/library/items/:itemId', async (req, reply) => {
    const config = resolveEmbyClientFromConfig(req.query);
    if (!config) {
      apiError(reply, 400, 'VALIDATION_ERROR', 'No Emby client on control plane; sync config or use POST /v1/library/actions/delete-item.');
      return;
    }
    await embyService.deleteLibraryItem({ config, itemId: req.params.itemId });
    reply.code(204).send();
  });

  app.post('/v1/library/items/:itemId/played', async (req, reply) => {
    const config = resolveEmbyClientFromConfig(req.query);
    if (!config) {
      apiError(reply, 400, 'VALIDATION_ERROR', 'No Emby client on control plane; sync config or use POST /v1/library/actions/mark-played.');
      return;
    }
    await embyService.markPlayed({ config, itemId: req.params.itemId });
    reply.code(204).send();
  });

  app.delete('/v1/library/items/:itemId/played', async (req, reply) => {
    const config = resolveEmbyClientFromConfig(req.query);
    if (!config) {
      apiError(reply, 400, 'VALIDATION_ERROR', 'No Emby client on control plane; sync config or use POST /v1/library/actions/mark-unplayed.');
      return;
    }
    await embyService.markUnplayed({ config, itemId: req.params.itemId });
    reply.code(204).send();
  });

  app.post('/v1/client/actions/launch-player', async (_req, reply) => {
    reply.code(501).send({
      code: 'NOT_IMPLEMENTED',
      message: 'Launch player is handled by Electron emby:launchPlayer on the desktop session.',
    });
  });

  app.post('/v1/transcode/actions/abort-all', async (_req, reply) => {
    transcodeService.abortAllEncodes();
    reply.code(204).send();
  });

  app.post('/v1/transcode/actions/validate-tools', async (req) =>
    transcodeService.validateTranscodeTools(req.body.config, req.body.encodePool),
  );

  app.post('/v1/transcode/actions/probe-encode-devices', async (req) =>
    transcodeService.probeEncodeDevices(req.body.config),
  );

  app.post('/v1/transcode/actions/precheck', async (req) => transcodeService.precheck(req.body));

  app.post('/v1/transcode/actions/probe', async (req) =>
    transcodeService.probeSummary(req.body.config, req.body.filePath),
  );

  app.post('/v1/transcode/actions/replace', async (req) => transcodeService.replaceWithRetries(req.body));

  app.post('/v1/transcode/actions/cleanup-workdir', async (req) => {
    await transcodeService.cleanupTaskWorkdir(req.body.tempDir);
    return { ok: true };
  });

  app.post('/v1/transcode/actions/scan-orphans', async (req) =>
    transcodeService.scanOrphans(req.body.tempRoot),
  );

  app.post('/v1/transcode/actions/stat-paths', async (req) =>
    transcodeService.statPaths(req.body.paths ?? []),
  );

  app.post('/v1/transcode/actions/delete-paths', async (req) => {
    await transcodeService.deletePaths(req.body.paths ?? []);
    return { ok: true };
  });

  app.post('/v1/transcode/jobs', async (req, reply) => {
    const payload = req.body;
    const jobId = String(payload.taskId || crypto.randomUUID());
    if (transcodeJobState.has(jobId)) {
      apiError(reply, 409, 'CONFLICT', 'Job already exists');
      return;
    }
    transcodeJobState.set(jobId, {
      jobId,
      status: 'running',
      progress: { pct: 0, line: '' },
      error: null,
      result: null,
    });
    reply.code(202);
    reply.header('Location', `/v1/transcode/jobs/${jobId}`);
    const notifier = {
      onProgress: (p) => {
        const j = transcodeJobState.get(jobId);
        if (j) {
          j.progress = { pct: p.progress, line: p.line || '' };
        }
      },
    };
    void (async () => {
      const j = transcodeJobState.get(jobId);
      try {
        const result = await transcodeService.startEncode(notifier, payload);
        if (j) {
          j.status = 'succeeded';
          j.result = result;
        }
      } catch (e) {
        if (j) {
          j.status = 'failed';
          j.error = { code: 'TRANSCODE_ERROR', message: e instanceof Error ? e.message : String(e) };
        }
      }
    })();
    return { jobId, status: 'running' };
  });

  app.get('/v1/transcode/jobs/:jobId', async (req) => {
    const j = transcodeJobState.get(req.params.jobId);
    if (!j) {
      return { jobId: req.params.jobId, status: 'unknown', progress: {} };
    }
    return {
      jobId: j.jobId,
      status: j.status,
      progress: { ...j.progress },
      error: j.error,
      result: j.result,
    };
  });

  app.post('/v1/transcode/jobs/:jobId/actions/abort', async (req) => ({
    ok: transcodeService.abortTask(req.params.jobId),
  }));

  app.put('/v1/integrations/douban/session', async (_req, reply) => {
    doubanService.saveSession(_req.body);
    reply.code(204).send();
  });

  app.get('/v1/integrations/douban/session', async () => doubanService.getSession());

  app.post('/v1/integrations/douban/fetch/stop', async (_req, reply) => {
    doubanService.requestStop();
    reply.code(204).send();
  });

  app.post('/v1/integrations/douban/fetch/ratings', async (req, reply) => {
    const jobId = crypto.randomUUID();
    doubanJobState.set(jobId, {
      jobId,
      status: 'running',
      progress: {},
      result: null,
      error: null,
    });
    reply.code(202);
    const sink = {
      send: (p) => {
        const j = doubanJobState.get(jobId);
        if (j) j.progress = p;
      },
    };
    void (async () => {
      const j = doubanJobState.get(jobId);
      try {
        const result = await doubanService.fetchRatings(sink, req.body || {});
        if (j) {
          j.status = 'succeeded';
          j.result = result;
        }
      } catch (e) {
        if (j) {
          j.status = 'failed';
          j.error = { code: 'DOUBAN_ERROR', message: e instanceof Error ? e.message : String(e) };
        }
      }
    })();
    return { jobId, status: 'running' };
  });

  app.get('/v1/integrations/douban/fetch/jobs/:jobId', async (req) => {
    const j = doubanJobState.get(req.params.jobId);
    if (!j) return { jobId: req.params.jobId, status: 'unknown' };
    return {
      jobId: j.jobId,
      status: j.status,
      progress: j.progress,
      result: j.result,
      error: j.error,
    };
  });

  app.get('/v1/revisit/entries', async (req) => {
    const uid = req.query.userId;
    let list = store.listRevisit();
    if (uid) list = list.filter((e) => e.userId === uid);
    return list;
  });

  app.post('/v1/revisit/entries', async (req, reply) => {
    const b = req.body || {};
    const id = crypto.randomUUID();
    const entry = {
      id,
      userId: b.userId || 'default',
      embyItemId: b.embyItemId,
      addedAt: new Date().toISOString(),
      source: b.source || 'desktop',
      note: b.note || '',
    };
    store.cache.revisit.push(entry);
    store.persist();
    reply.code(201);
    return entry;
  });

  app.delete('/v1/revisit/entries/:entryId', async (req, reply) => {
    store.deleteRevisit(req.params.entryId);
    reply.code(204).send();
  });

  app.get('/v1/tasks', async (req) => {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.actionType) filter.actionType = req.query.actionType;
    if (req.query.itemId) filter.itemId = req.query.itemId;
    return taskStore.getTasks(filter);
  });

  app.post('/v1/tasks', async (req, reply) => {
    // 向后兼容：client 带 id 走旧逻辑（Phase 2 再移除）
    if (req.body && req.body.id) {
      const task = taskStore.createTask(req.body);
      reply.code(201);
      return task;
    }

    const { itemId, actionType, runMode } = req.body || {};

    // 1. 校验入参
    if (!itemId || !actionType) {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'itemId and actionType required');
    }
    if (!['delete', 'transcode', 'upgrade'].includes(actionType)) {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'Invalid actionType');
    }

    // 2. 解析 Emby 配置
    const embyConfig = resolveEmbyClientFromConfig(req.query);
    if (!embyConfig || !embyConfig.baseUrl) {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'Emby not configured');
    }

    // 3. 查 Emby item
    let embyItem;
    try {
      embyItem = await embyService.getLibraryItem({ config: embyConfig, itemId });
    } catch (e) {
      return apiError(reply, 502, 'EMBY_FETCH_FAILED', e.message);
    }
    if (!embyItem) {
      return apiError(reply, 404, 'ITEM_NOT_FOUND', 'Emby item not found');
    }

    // 4. 蓝光校验
    if (
      (actionType === 'transcode' || actionType === 'upgrade') &&
      embyService.inferIsBluRayDisc(embyItem, embyConfig)
    ) {
      return apiError(reply, 409, 'BLURAY_DISC_REJECTED', `「${embyItem.Name}」为蓝光/原盘，不支持 ${actionType}`);
    }

    // 5. 互斥校验
    const existing = taskStore.getTasks({ itemId });
    const active = existing.find((t) => t.status !== 'done' && t.status !== 'failed_hard');
    if (active) {
      return apiError(reply, 409, 'ITEM_TASK_CONFLICT', `「${embyItem.Name}」已有进行中任务（${active.id}）`);
    }

    // 6. 初始状态由 runMode 决定（fallback 到 service executionMode）
    const svcCfg = configStore.loadConfig();
    const effectiveRunMode = runMode || svcCfg.executionMode || 'manual';
    const status = effectiveRunMode === 'scheduled' ? 'queued' : 'pending_manual';

    // 7. 构建任务
    const task = taskStore.createTask({
      itemId,
      itemName: embyItem.Name || itemId,
      actionType,
      status,
      flowLog: [{ ts: new Date().toISOString(), level: 'info', code: 'task.created', message: '任务已创建' }],
    });

    reply.code(201);
    return task;
  });

  app.get('/v1/tasks/:taskId', async (req, reply) => {
    const task = taskStore.getTask(req.params.taskId);
    if (!task) {
      apiError(reply, 404, 'NOT_FOUND', 'Task not found');
      return;
    }
    return task;
  });

  app.patch('/v1/tasks/:taskId', async (req, reply) => {
    const task = taskStore.updateTask(req.params.taskId, req.body || {});
    if (!task) {
      apiError(reply, 404, 'NOT_FOUND', 'Task not found');
      return;
    }
    return task;
  });

  app.delete('/v1/tasks/:taskId', async (req, reply) => {
    const deleted = taskStore.deleteTask(req.params.taskId);
    if (!deleted) {
      apiError(reply, 404, 'NOT_FOUND', 'Task not found');
      return;
    }
    reply.code(204).send();
  });

  app.post('/v1/tasks/:taskId/actions/execute', async (req, reply) => {
    const task = taskStore.getTask(req.params.taskId);
    if (!task) {
      apiError(reply, 404, 'NOT_FOUND', 'Task not found');
      return;
    }
    if (task.status === 'pending_manual') {
      taskStore.updateTask(req.params.taskId, { status: 'created' });
      return { ok: true, message: 'Task queued for execution' };
    }
    if (task.status === 'paused') {
      // resume from paused — move to queued so scheduler picks it up
      taskStore.updateTask(req.params.taskId, { status: 'queued' });
      return { ok: true, message: 'Task resumed' };
    }
    return { ok: true, message: 'Task already in execution pipeline' };
  });

  app.post('/v1/tasks/:taskId/actions/pause', async (req, reply) => {
    const task = taskStore.getTask(req.params.taskId);
    if (!task) {
      apiError(reply, 404, 'NOT_FOUND', 'Task not found');
      return;
    }
    if (['precheck', 'executing', 'verify'].includes(task.status)) {
      apiError(reply, 409, 'CONFLICT', 'Cannot pause task that is currently executing');
      return;
    }
    taskStore.updateTask(req.params.taskId, { status: 'paused' });
    return { ok: true, message: 'Task paused' };
  });

  app.post('/v1/tasks/:taskId/actions/confirm', async (req, reply) => {
    const task = taskStore.getTask(req.params.taskId);
    if (!task) {
      apiError(reply, 404, 'NOT_FOUND', 'Task not found');
      return;
    }
    if (task.status !== 'awaiting_user_confirm') {
      apiError(reply, 409, 'CONFLICT', 'Task is not awaiting confirmation');
      return;
    }
    const { confirmed } = req.body || {};
    if (!confirmed) {
      apiError(reply, 400, 'VALIDATION_ERROR', 'confirmed must be true');
      return;
    }

    // 记录确认并推进 Flow
    const updates = { confirmedAt: new Date().toISOString() };
    // 判断停泊原因：查 flowLog 最近一条的 code
    const flowLog = Array.isArray(task.flowLog) ? task.flowLog : [];
    const lastEntry = flowLog[flowLog.length - 1];

    if (task.actionType === 'transcode') {
      if (lastEntry && lastEntry.code === 'transcode.dv.confirm') {
        updates.transcodeDvAcknowledged = true;
        updates.resumePoint = 'transcode_executing'; // 跳过 precheck 的 DV 检测
      } else if (lastEntry && lastEntry.code === 'transcode.replace.confirm') {
        updates.resumePoint = 'transcode_replace'; // 跳过 precheck+executing+verify，直接 replace
      }
    } else if (task.actionType === 'delete') {
      if (lastEntry && lastEntry.code === 'delete.awaiting_confirm') {
        updates.resumePoint = 'delete_executing'; // 跳过 precheck，直接执行删除
      }
    }

    taskStore.updateTask(req.params.taskId, updates);

    // 将状态改回 queued，让 scheduler 下次轮询时推进
    // driving 必须清除：Flow 的 async 链已结束（用户手动触发了 confirm），下次 driveTask 应能接管
    taskStore.updateTask(req.params.taskId, { status: 'queued', driving: false });
    return { ok: true, message: 'Task confirmed and re-queued' };
  });

  app.get('/v1/library/cache', async () => cacheStore.getLibraryCache());

  app.post('/v1/library/cache', async (req) => {
    const items = req.body && Array.isArray(req.body.items) ? req.body.items : [];
    return cacheStore.setLibraryCache(items);
  });

  app.get('/v1/integrations/douban/ratings/cache', async () => cacheStore.getDoubanCache());

  app.get('/v1/library/ratings', async () => ratingStore.getAllRatings());

  app.patch('/v1/library/ratings', async (req) => {
    const patch = req.body && typeof req.body === 'object' ? req.body : {};
    const count = ratingStore.patchRatings(patch);
    return { ok: true, count };
  });
}

/**
 * @param {{ logger?: boolean | object; dataDir?: string; apiKey?: string }} [opts]
 */
async function buildApp(opts = {}) {
  process.env.CONTROL_PLANE_DATA_DIR =
    opts.dataDir ||
    process.env.MEDIA_SERVICE_DATA_DIR ||
    process.env.CONTROL_PLANE_DATA_DIR ||
    require('path').join(__dirname, '..', 'data');

  const store = new FileStore();
  const API_KEY =
    opts.apiKey !== undefined
      ? opts.apiKey
      : process.env.MEDIA_SERVICE_API_KEY || process.env.CONTROL_PLANE_API_KEY || configStore.loadConfig().serviceApiKey || '';

  const app = Fastify({ logger: opts.logger !== undefined ? opts.logger : true });
  await app.register(cors, { origin: true });

  // Serve built React admin app from dist/admin/ at root /
  const distAdminPath = path.join(__dirname, '..', 'dist', 'admin');
  await app.register(fastifyStatic, {
    root: distAdminPath,
    prefix: '/',
    decorateReply: false,
  });

  // Redirect /admin → / (admin app is at root since SPA uses HashRouter)
  app.get('/admin', async (_req, reply) => {
    reply.redirect('/');
  });

  function authHook(req, reply, done) {
    const url = req.url;
    // Public routes — no auth required
    if (
      url.startsWith('/v1/health') ||
      url.startsWith('/admin/') ||
      url.startsWith('/v1/admin/') ||
      url === '/admin'
    )
      return done();
    if (!API_KEY) return done();
    const k = req.headers['x-api-key'];
    if (k !== API_KEY) {
      reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Invalid or missing X-API-Key' });
      return;
    }
    done();
  }

  app.addHook('onRequest', authHook);
  registerRoutes(app, store);

  // 确保 app.close() 时同时停止调度器，防止测试中 setInterval 保持事件循环活跃
  app.addHook('onClose', async () => {
    taskScheduler.stopScheduler();
  });

  taskScheduler.startScheduler();

  app.setErrorHandler((err, req, reply) => {
    req.log.error(err);
    const statusCode = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    reply.code(statusCode).send({
      code: err.code && typeof err.code === 'string' ? err.code : 'INTERNAL_ERROR',
      message: err.message || 'Error',
    });
  });

  serverReady = true;
  return app;
}

module.exports = { buildApp, registerRoutes, transcodeJobState, doubanJobState };
