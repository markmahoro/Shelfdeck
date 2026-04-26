'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const http = require('http');

/** 与 `App.tsx` 中 deriveReplaceBackupPath 一致；preload 沙盒下不可用 Node `path` 模块 */
function deriveReplaceBackupPath(targetPath) {
  const s = String(targetPath);
  const norm = s.replace(/[/\\]+$/, '');
  const i = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'));
  const dir = i >= 0 ? norm.slice(0, i) : '';
  const base = i >= 0 ? norm.slice(i + 1) : norm;
  const sep = s.includes('\\') && !s.includes('/') ? '\\' : '/';
  return dir ? `${dir}${sep}${base}.etp.bak` : `${base}.etp.bak`;
}

/** 主进程解析 effectiveBaseUrl / effectiveApiKey（DESIGN_DESKTOP_BACKEND_ENDPOINT），连接文件变更时刷新 */
function readEffectiveFromMain() {
  try {
    return ipcRenderer.sendSync('cp:get-effective');
  } catch {
    return { baseUrl: 'http://127.0.0.1:18080', apiKey: '', source: 'default' };
  }
}

let effectiveCp = readEffectiveFromMain();

function refreshEffectiveCp() {
  effectiveCp = readEffectiveFromMain();
}

ipcRenderer.on('cp:updated', refreshEffectiveCp);

function cpBase() {
  return String(effectiveCp.baseUrl || 'http://127.0.0.1:18080').replace(/\/$/, '');
}

function cpKey() {
  return String(effectiveCp.apiKey || '');
}

async function cpJson(path, options = {}) {
  const url = `${cpBase()}${path}`;
  const headers = { ...(options.headers || {}) };
  const k = cpKey();
  if (k) headers['X-API-Key'] = k;
  if (options.body != null && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  if (!res.ok) {
    let msg = text || res.statusText;
    try {
      const j = JSON.parse(text);
      if (j && j.message) msg = j.message;
    } catch {
      /* keep */
    }
    throw new Error(msg);
  }
  if (res.status === 204 || !text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function emitBridge(channel, payload) {
  ipcRenderer.send('cp-bridge-progress', channel, payload);
}

async function pollTranscodeJob(jobId, taskId) {
  for (;;) {
    const st = await cpJson(`/v1/transcode/jobs/${encodeURIComponent(jobId)}`);
    emitBridge('transcode', {
      taskId,
      progress: st.progress?.pct ?? 0,
      line: st.progress?.line || '',
    });
    if (st.status === 'succeeded') return st.result ?? { ok: true };
    if (st.status === 'failed') throw new Error(st.error?.message || '转码失败');
    if (st.status === 'aborted') throw new Error('转码已中止');
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function pollDoubanJob(jobId) {
  for (;;) {
    const st = await cpJson(`/v1/integrations/douban/fetch/jobs/${encodeURIComponent(jobId)}`);
    if (st.progress && typeof st.progress === 'object' && Object.keys(st.progress).length > 0) {
      emitBridge('douban', st.progress);
    }
    if (st.status === 'succeeded') return st.result ?? { entries: [], cancelled: false };
    if (st.status === 'failed') throw new Error(st.error?.message || '豆瓣同步失败');
    await new Promise((r) => setTimeout(r, 400));
  }
}

const embyApi = {
  testConnection: (config) =>
    cpJson('/v1/emby/actions/test-connection', { method: 'POST', body: JSON.stringify(config) }),
  getUsers: (config) => cpJson('/v1/emby/actions/list-users', { method: 'POST', body: JSON.stringify(config) }),
  getMediaFolders: (config) =>
    cpJson('/v1/emby/actions/list-media-folders', { method: 'POST', body: JSON.stringify(config) }),
  getUnplayedItems: (args) =>
    cpJson('/v1/library/queries/unplayed', { method: 'POST', body: JSON.stringify(args) }),
  getLibraryItemsForManage: (args) =>
    cpJson('/v1/library/queries/manage', { method: 'POST', body: JSON.stringify(args) }),
  getPlayedItems: (args) => cpJson('/v1/library/queries/played', { method: 'POST', body: JSON.stringify(args) }),
  launchPlayer: (args) => ipcRenderer.invoke('emby:launchPlayer', args),
  markPlayed: (args) =>
    cpJson('/v1/library/actions/mark-played', { method: 'POST', body: JSON.stringify(args) }),
  markUnplayed: (args) =>
    cpJson('/v1/library/actions/mark-unplayed', { method: 'POST', body: JSON.stringify(args) }),
  getLibraryItem: (args) =>
    cpJson('/v1/library/actions/get-item', { method: 'POST', body: JSON.stringify(args) }),
  getItemDeleteInfo: (args) =>
    cpJson('/v1/library/actions/delete-info', { method: 'POST', body: JSON.stringify(args) }),
  deleteLibraryItem: (args) =>
    cpJson('/v1/library/actions/delete-item', { method: 'POST', body: JSON.stringify(args) }),
  libraryItemExists: async (args) => {
    const r = await cpJson('/v1/library/actions/exists', { method: 'POST', body: JSON.stringify(args) });
    return Boolean(r && r.exists);
  },
  taskControl: async (args) => {
    if (args && args.action === 'simulateExit') {
      await cpJson('/v1/transcode/actions/abort-all', { method: 'POST', body: '{}' });
    }
  },
  transcodeValidateTools: (args) =>
    cpJson('/v1/transcode/actions/validate-tools', { method: 'POST', body: JSON.stringify(args) }),
  transcodeProbeEncodeDevices: (args) =>
    cpJson('/v1/transcode/actions/probe-encode-devices', { method: 'POST', body: JSON.stringify(args) }),
  transcodePrecheck: (args) =>
    cpJson('/v1/transcode/actions/precheck', { method: 'POST', body: JSON.stringify(args) }),
  transcodeStartEncode: async (args) => {
    const started = await cpJson('/v1/transcode/jobs', { method: 'POST', body: JSON.stringify(args) });
    return pollTranscodeJob(started.jobId, args.taskId);
  },
  transcodeAbort: (args) =>
    cpJson(`/v1/transcode/jobs/${encodeURIComponent(args.taskId)}/actions/abort`, {
      method: 'POST',
      body: '{}',
    }),
  transcodeProbe: (args) =>
    cpJson('/v1/transcode/actions/probe', { method: 'POST', body: JSON.stringify(args) }),
  transcodeReplace: (args) =>
    cpJson('/v1/transcode/actions/replace', { method: 'POST', body: JSON.stringify(args) }),
  transcodeCleanupTaskWorkdir: (args) =>
    cpJson('/v1/transcode/actions/cleanup-workdir', { method: 'POST', body: JSON.stringify(args) }),
  transcodeScanOrphans: (args) =>
    cpJson('/v1/transcode/actions/scan-orphans', { method: 'POST', body: JSON.stringify(args) }),
  transcodeStatPaths: (args) =>
    cpJson('/v1/transcode/actions/stat-paths', { method: 'POST', body: JSON.stringify(args) }),
  transcodeDeriveReplaceBackupPath: (targetPath) => deriveReplaceBackupPath(targetPath),
  transcodeDeletePaths: (args) =>
    cpJson('/v1/transcode/actions/delete-paths', { method: 'POST', body: JSON.stringify(args) }),
  onTranscodeProgress: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('transcode:progress', handler);
    return () => ipcRenderer.removeListener('transcode:progress', handler);
  },
};

const doubanApi = {
  saveSession: (payload) =>
    cpJson('/v1/integrations/douban/session', { method: 'PUT', body: JSON.stringify(payload) }),
  getSession: () => cpJson('/v1/integrations/douban/session'),
  stopFetch: () => cpJson('/v1/integrations/douban/fetch/stop', { method: 'POST', body: '{}' }),
  fetchRatings: async (opts) => {
    const started = await cpJson('/v1/integrations/douban/fetch/ratings', {
      method: 'POST',
      body: JSON.stringify(opts ?? {}),
    });
    return pollDoubanJob(started.jobId);
  },
  onProgress: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('douban:fetchProgress', handler);
    return () => ipcRenderer.removeListener('douban:fetchProgress', handler);
  },
};

const mediaService = {
  // 直接用 Node http 做健康检查，绕过 IPC Promise 链路和 CORS
  checkHealth: () => {
    return new Promise((resolve) => {
      const baseUrl = effectiveCp.baseUrl || 'http://127.0.0.1:18080';
      const fullUrl = `${String(baseUrl).replace(/\/+$/, '')}/v1/health`;
      try {
        const u = new URL(fullUrl);
        const req = http.request(
          { hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: 'GET', timeout: 3000 },
          (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
              try {
                const j = JSON.parse(body);
                resolve(j.status === 'green' || j.status === 'yellow');
              } catch { resolve(false); }
            });
          },
        );
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.end();
      } catch { resolve(false); }
    });
  },
};

const shelfdeckMedia = {
  getEffective: () => ({ ...effectiveCp, baseUrl: cpBase() }),
  onConnectionUpdated: (listener) => {
    const fn = () => {
      try {
        listener();
      } catch (_) {}
    };
    ipcRenderer.on('cp:updated', fn);
    return () => ipcRenderer.removeListener('cp:updated', fn);
  },
};

contextBridge.exposeInMainWorld('embyApi', embyApi);
contextBridge.exposeInMainWorld('doubanApi', doubanApi);
contextBridge.exposeInMainWorld('mediaService', mediaService);
contextBridge.exposeInMainWorld('shelfdeckMedia', shelfdeckMedia);
contextBridge.exposeInMainWorld('shelfdeckSettings', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  getKey: (key) => ipcRenderer.invoke('settings:getKey', key),
});
