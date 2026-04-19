'use strict';

const crypto = require('crypto');
const cors = require('@fastify/cors');
const Fastify = require('fastify');
const { FileStore } = require('./store');
const embyService = require('./services/embyService');
const doubanService = require('./services/doubanService');
const transcodeService = require('./services/transcodeService');

const transcodeJobState = new Map();
const doubanJobState = new Map();

function resolveEmbyClientFromStore(store, query) {
  const root = store.getJsonKey('controlPlaneConfig', {});
  const pid = query && query.embyProfileId;
  if (pid && root.embyProfiles && typeof root.embyProfiles === 'object' && root.embyProfiles[pid]) {
    return root.embyProfiles[pid];
  }
  if (root.embyClient && typeof root.embyClient === 'object' && root.embyClient.baseUrl) {
    return root.embyClient;
  }
  return null;
}

function apiError(reply, status, code, message, details) {
  reply.code(status).send({ code, message, details });
}

/** @param {import('./store').FileStore} store */
function registerRoutes(app, store) {
  app.get('/v1/health', async () => ({ status: 'ok', version: '0.1.0' }));

  app.get('/v1/config', async () => store.getJsonKey('controlPlaneConfig', {}));

  app.patch('/v1/config', async (req) => {
    const cur = store.getJsonKey('controlPlaneConfig', {});
    const patch = req.body && typeof req.body === 'object' ? req.body : {};
    const next = { ...cur, ...patch };
    store.setJsonKey('controlPlaneConfig', next);
    return next;
  });

  app.get('/v1/sync/task-queue', async () => store.getJsonKey('taskQueueV1', []));

  app.put('/v1/sync/task-queue', async (req, reply) => {
    const body = req.body;
    if (!Array.isArray(body)) {
      apiError(reply, 400, 'VALIDATION_ERROR', 'Body must be a JSON array');
      return;
    }
    store.setJsonKey('taskQueueV1', body);
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

  /** OpenAPI：使用控制面已缓存的 embyClient（由桌面 PATCH /v1/config 同步） */
  app.get('/v1/library/items/:itemId', async (req, reply) => {
    const config = resolveEmbyClientFromStore(store, req.query);
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
    const config = resolveEmbyClientFromStore(store, req.query);
    if (!config) {
      apiError(reply, 400, 'VALIDATION_ERROR', 'No Emby client on control plane; sync config or use POST /v1/library/actions/delete-info.');
      return;
    }
    return embyService.getItemDeleteInfo({ config, itemId: req.params.itemId });
  });

  app.get('/v1/library/items/:itemId/exists', async (req, reply) => {
    const config = resolveEmbyClientFromStore(store, req.query);
    if (!config) {
      apiError(reply, 400, 'VALIDATION_ERROR', 'No Emby client on control plane; sync config or use POST /v1/library/actions/exists.');
      return;
    }
    const exists = await embyService.libraryItemExists({ config, itemId: req.params.itemId });
    return { exists };
  });

  app.delete('/v1/library/items/:itemId', async (req, reply) => {
    const config = resolveEmbyClientFromStore(store, req.query);
    if (!config) {
      apiError(reply, 400, 'VALIDATION_ERROR', 'No Emby client on control plane; sync config or use POST /v1/library/actions/delete-item.');
      return;
    }
    await embyService.deleteLibraryItem({ config, itemId: req.params.itemId });
    reply.code(204).send();
  });

  app.post('/v1/library/items/:itemId/played', async (req, reply) => {
    const config = resolveEmbyClientFromStore(store, req.query);
    if (!config) {
      apiError(reply, 400, 'VALIDATION_ERROR', 'No Emby client on control plane; sync config or use POST /v1/library/actions/mark-played.');
      return;
    }
    await embyService.markPlayed({ config, itemId: req.params.itemId });
    reply.code(204).send();
  });

  app.delete('/v1/library/items/:itemId/played', async (req, reply) => {
    const config = resolveEmbyClientFromStore(store, req.query);
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

  app.get('/v1/tasks', async () => {
    const raw = store.getJsonKey('taskQueueV1', []);
    return raw.map((t) => ({
      id: t.id,
      kind: t.actionType,
      status: t.status,
      payload: t,
      flowLog: t.flowLog,
    }));
  });

  app.post('/v1/tasks', async (req, reply) => {
    const b = req.body || {};
    const q = store.getJsonKey('taskQueueV1', []);
    const id = crypto.randomUUID();
    const task = {
      id,
      kind: b.kind,
      status: 'queued',
      payload: b.payload || {},
      flowLog: [],
    };
    q.push(task);
    store.setJsonKey('taskQueueV1', q);
    reply.code(202);
    return task;
  });

  app.get('/v1/tasks/:taskId', async (req) => {
    const q = store.getJsonKey('taskQueueV1', []);
    const t = q.find((x) => x.id === req.params.taskId);
    if (!t) return { id: req.params.taskId, kind: 'unknown', status: 'unknown' };
    return { id: t.id, kind: t.actionType, status: t.status, payload: t, flowLog: t.flowLog };
  });
}

/**
 * @param {{ logger?: boolean | object; dataDir?: string; apiKey?: string }} [opts]
 */
async function buildApp(opts = {}) {
  process.env.CONTROL_PLANE_DATA_DIR =
    opts.dataDir || process.env.CONTROL_PLANE_DATA_DIR || require('path').join(__dirname, '..', 'data');

  const store = new FileStore();
  const API_KEY = opts.apiKey !== undefined ? opts.apiKey : process.env.CONTROL_PLANE_API_KEY || '';

  const app = Fastify({ logger: opts.logger !== undefined ? opts.logger : true });
  await app.register(cors, { origin: true });

  function authHook(req, reply, done) {
    if (req.url.startsWith('/v1/health')) return done();
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

  app.setErrorHandler((err, req, reply) => {
    req.log.error(err);
    const statusCode = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    reply.code(statusCode).send({
      code: err.code && typeof err.code === 'string' ? err.code : 'INTERNAL_ERROR',
      message: err.message || 'Error',
    });
  });

  return app;
}

module.exports = { buildApp, registerRoutes, transcodeJobState, doubanJobState };
