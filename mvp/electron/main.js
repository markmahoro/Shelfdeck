const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;

function buildUrl(baseUrl, endpoint) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  const ep = String(endpoint || '').replace(/^\//, '');
  return `${base}/${ep}`;
}

function buildApiUrl(config, endpoint, query) {
  const url = new URL(buildUrl(config.baseUrl, endpoint));
  url.searchParams.set('api_key', config.apiKey);
  Object.entries(query || {}).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    url.searchParams.set(k, String(v));
  });
  return url.toString();
}

function getLogPath() {
  return path.join(app.getPath('userData'), 'logs', 'mvp.log');
}

function logEvent(message, payload) {
  try {
    const logPath = getLogPath();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const line = `[${new Date().toISOString()}] ${message}${payload ? ` ${JSON.stringify(payload)}` : ''}\n`;
    fs.appendFileSync(logPath, line, 'utf8');
  } catch {
    // ignore
  }
}

async function httpJson(url, init) {
  let res;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json' },
      ...init,
    });
  } catch (err) {
    const cause = err && typeof err === 'object' && 'cause' in err ? err.cause : undefined;
    const code = cause && typeof cause === 'object' && cause && 'code' in cause ? String(cause.code) : '';
    if (code === 'ECONNREFUSED') {
      throw new Error(`请求失败: 连接被拒绝，请检查 Emby 地址/端口是否可达\nURL: ${url}`);
    }
    throw new Error(`请求失败: ${String(err)}\nURL: ${url}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

function tokenizeArgs(template) {
  const args = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < template.length; i += 1) {
    const ch = template[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ' ' && !inQuotes) {
      if (cur) args.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur) args.push(cur);
  return args;
}

function applyPathMapping(config, mediaPath) {
  const from = String(config.pathMapFrom || '').trim();
  const to = String(config.pathMapTo || '').trim();
  if (!from || !to) return mediaPath;
  if (!mediaPath.toLowerCase().startsWith(from.toLowerCase())) return mediaPath;
  return (to + mediaPath.slice(from.length)).replace(/\//g, '\\');
}

async function getMediaFolders(config) {
  const json = await httpJson(buildApiUrl(config, '/Library/MediaFolders'));
  const items = json.Items || [];
  return items.map((x) => ({ id: String(x.Id || ''), name: String(x.Name || '') }));
}

async function getUsers(config) {
  try {
    const json = await httpJson(buildApiUrl(config, '/Users/Query', { Limit: 200 }));
    const items = json.Items || [];
    return items.map((x) => ({ id: String(x.Id || ''), name: String(x.Name || '') })).filter((x) => x.id && x.name);
  } catch {
    const json = await httpJson(buildApiUrl(config, '/Users'));
    const items = Array.isArray(json) ? json : [];
    return items.map((x) => ({ id: String(x.Id || ''), name: String(x.Name || '') })).filter((x) => x.id && x.name);
  }
}

async function testConnection(config) {
  if (!String(config?.baseUrl || '').trim()) {
    throw new Error('缺少 Base URL，请先填写 Emby Base URL。');
  }
  if (!String(config?.apiKey || '').trim()) {
    throw new Error('缺少 API Key，请先填写 Emby API Key。');
  }
  const json = await httpJson(buildApiUrl(config, '/System/Info'));
  return { serverName: json.ServerName, version: json.Version };
}

async function getUnplayedItems({ config, sectionId }) {
  const query = {
    Filters: 'IsUnplayed',
    IncludeItemTypes: 'Movie',
    Recursive: true,
    Limit: 200,
    Fields: 'PrimaryImageTag,RunTimeTicks',
  };
  let json;
  try {
    json = await httpJson(
      buildApiUrl(config, `/Users/${encodeURIComponent(config.userId)}/Sections/${encodeURIComponent(sectionId)}/Items`, query),
    );
  } catch (err) {
    const msg = String(err);
    if (!msg.includes('HTTP 404')) throw err;
    json = await httpJson(
      buildApiUrl(config, `/Users/${encodeURIComponent(config.userId)}/Items`, { ...query, ParentId: sectionId }),
    );
  }
  const items = json.Items || [];
  return items.map((x) => ({
    id: String(x.Id || ''),
    name: String(x.Name || ''),
    posterTag: x.PrimaryImageTag ? String(x.PrimaryImageTag) : undefined,
    runTimeTicks: x.RunTimeTicks ? Number(x.RunTimeTicks) : undefined,
    sectionId,
  }));
}

async function resolvePlayablePath(config, itemId) {
  const json = await httpJson(
    buildApiUrl(config, `/Items/${encodeURIComponent(itemId)}/PlaybackInfo`, {
      UserId: config.userId,
    }),
  );
  const sources = json.MediaSources || [];
  const fileSource = sources.find((s) => (s.Protocol === 'File' || s.Type === 'File') && s.Path);
  if (fileSource) return String(fileSource.Path);
  const anySource = sources.find((s) => s && s.Path);
  return anySource ? String(anySource.Path) : null;
}

async function getItemRuntimeSeconds(config, itemId) {
  const json = await httpJson(buildApiUrl(config, `/Items/${encodeURIComponent(itemId)}`, { Fields: 'RunTimeTicks' }));
  const ticks = Number(json.RunTimeTicks || 0);
  return ticks > 0 ? ticks / 1e7 : null;
}

async function launchPlayer({ config, item }) {
  const originalPath = await resolvePlayablePath(config, item.id);
  if (!originalPath) throw new Error('无法从 Emby 获取可播放路径');
  const mappedPath = applyPathMapping(config, originalPath);
  const template = String(config.argsTemplate || '"{path}" /new').trim();
  if (!template.includes('{path}')) throw new Error('argsTemplate 必须包含 {path}');
  let resolvedArgs = template.replaceAll('{path}', mappedPath).replaceAll('{itemId}', item.id);
  if (String(config.playerExePath).toLowerCase().includes('potplayer')) {
    resolvedArgs = resolvedArgs.replace(/\s+\/autoplay\b/gi, '');
    if (!/\/new\b/i.test(resolvedArgs) && !/\/current\b/i.test(resolvedArgs)) {
      resolvedArgs += ' /new';
    }
  }
  const args = tokenizeArgs(resolvedArgs);
  spawn(config.playerExePath, args, { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
  const runtimeSeconds = item.runTimeTicks ? item.runTimeTicks / 1e7 : await getItemRuntimeSeconds(config, item.id);
  logEvent('player_launch', { itemId: item.id, mappedPath, args });
  return {
    sessionStartedAtMs: Date.now(),
    runtimeSeconds: runtimeSeconds || undefined,
    debug: { originalPath, mappedPath, resolvedArgs, args },
  };
}

function formatDatePlayed(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}${p(date.getHours())}${p(date.getMinutes())}${p(
    date.getSeconds(),
  )}`;
}

async function markPlayed(config, itemId) {
  const url = buildApiUrl(
    config,
    `/Users/${encodeURIComponent(config.userId)}/PlayedItems/${encodeURIComponent(itemId)}`,
    { DatePlayed: formatDatePlayed(new Date()) },
  );
  const res = await fetch(url, { method: 'POST', body: '' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  logEvent('mark_played', { itemId, userId: config.userId });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 820,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logEvent('did-fail-load', { errorCode, errorDescription, validatedURL });
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logEvent('render-process-gone', details);
  });
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    logEvent('renderer-console', { level, message, line, sourceId });
  });
  mainWindow.webContents.on('did-finish-load', () => {
    logEvent('did-finish-load');
  });

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    const url = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    logEvent('load-dev-url', { url });
    mainWindow.loadURL(url);
  } else {
    const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
    logEvent('load-prod-file', { indexPath, exists: fs.existsSync(indexPath) });
    mainWindow.loadFile(indexPath);
  }
}

app.whenReady().then(() => {
  createWindow();
  ipcMain.handle('emby:testConnection', (_e, config) => testConnection(config));
  ipcMain.handle('emby:getUsers', (_e, config) => getUsers(config));
  ipcMain.handle('emby:getMediaFolders', (_e, config) => getMediaFolders(config));
  ipcMain.handle('emby:getUnplayedItems', (_e, args) => getUnplayedItems(args));
  ipcMain.handle('emby:launchPlayer', (_e, args) => launchPlayer(args));
  ipcMain.handle('emby:markPlayed', (_e, args) => markPlayed(args.config, args.itemId));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
