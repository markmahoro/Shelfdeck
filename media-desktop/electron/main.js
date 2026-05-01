const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const embyService = require('./embyService');
const shelfdeckConnection = require('./shelfdeckConnection');
const Store = require('electron-store');
const store = new Store({ name: 'desktop-settings' });

const isDev = process.env.NODE_ENV === 'development';
let mainWindow = null;
/** @type {fs.FSWatcher | null} */
let connectionWatcher = null;

/** 媒体管理服务进度经主进程转发到与旧 IPC 相同的 channel，避免改 App 订阅逻辑 */
ipcMain.on('cp-bridge-progress', (event, channel, payload) => {
  if (event.sender.isDestroyed()) return;
  if (channel === 'transcode') event.sender.send('transcode:progress', payload);
  else if (channel === 'douban') event.sender.send('douban:fetchProgress', payload);
});

ipcMain.on('cp:get-effective', (event) => {
  event.returnValue = shelfdeckConnection.resolveEffectiveConnection(process.env);
});

function broadcastConnectionUpdated() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('cp:updated');
  }
}

function watchConnectionFile() {
  if (connectionWatcher) {
    try {
      connectionWatcher.close();
    } catch (_) {}
    connectionWatcher = null;
  }
  const dir = path.dirname(shelfdeckConnection.getConnectionFilePath());
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {}
  let t = null;
  const fire = () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      broadcastConnectionUpdated();
    }, 200);
  };
  try {
    connectionWatcher = fs.watch(dir, fire);
  } catch (_) {
    /* 目录尚不存在等 */
  }
}

function devUrlCandidates() {
  const fromEnv = process.env.VITE_DEV_SERVER_URL;
  const list = [];
  if (fromEnv) list.push(fromEnv.replace(/\/$/, ''));
  for (let p = 5174; p <= 5184; p += 1) {
    list.push(`http://127.0.0.1:${p}`);
  }
  return [...new Set(list)];
}

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js');
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.ico');
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    title: 'ShelfDeck 播放助手',
    icon: iconPath,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.maximize();
  win.setMenuBarVisibility(false);
  win.webContents.on('did-fail-load', (_event, code, desc, url) => {
    const msg = encodeURIComponent(`Failed to load URL: ${url}\ncode=${code}\n${desc}`);
    win.loadURL(`data:text/html;charset=utf-8,<h2 style="font-family:Segoe UI">Load Failed</h2><pre>${msg}</pre>`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    const msg = encodeURIComponent(`Renderer crashed: ${JSON.stringify(details)}`);
    win.loadURL(`data:text/html;charset=utf-8,<h2 style="font-family:Segoe UI">Renderer Crashed</h2><pre>${msg}</pre>`);
  });

  if (isDev) {
    void loadFirstReachableDevUrl(win);
    win.webContents.openDevTools({ mode: 'detach' });
    mainWindow = win;
    win.on('closed', () => {
      mainWindow = null;
    });
    return;
  }

  const htmlPath = path.join(__dirname, '..', 'dist', 'index.html');
  if (!fs.existsSync(htmlPath)) {
    win.loadURL('data:text/plain;charset=utf-8,dist/index.html not found. Please run npm run build first.');
    return;
  }
  win.loadFile(htmlPath);
  mainWindow = win;
  win.on('closed', () => {
    mainWindow = null;
  });
}

function isHttpReachable(url) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const req = http.request(
        {
          hostname: u.hostname,
          port: u.port || 80,
          path: u.pathname || '/',
          method: 'GET',
          timeout: 2000,
        },
        (res) => {
          res.resume();
          resolve(res.statusCode >= 200 && res.statusCode < 500);
        },
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    } catch {
      resolve(false);
    }
  });
}

async function loadFirstReachableDevUrl(win) {
  const candidates = devUrlCandidates();
  for (let i = 0; i < 120; i += 1) {
    for (const url of candidates) {
      if (await isHttpReachable(url)) {
        try {
          await win.loadURL(url);
          return;
        } catch {
          // try next URL
        }
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  const hint = encodeURIComponent(
    'Cannot reach Vite dev server (127.0.0.1:5174–5184). Run npm run dev, or npm run dev:renderer then dev:electron with VITE_DEV_SERVER_URL set.',
  );
  win.loadURL(
    `data:text/html;charset=utf-8,<h2 style="font-family:Segoe UI">Unable to connect Vite dev server</h2><p>${hint}</p>`,
  );
}

function registerIpcHandlers() {
  ipcMain.handle('emby:launchPlayer', (_evt, payload) => embyService.launchPlayer(payload));
  ipcMain.handle('emby:launchPath', (_evt, payload) => embyService.launchPath(payload));

  // Health check via main process Node http (mirrors isHttpReachable pattern)
  ipcMain.handle('health:check', async () => {
    const baseUrl = store.get('shelfdeck.mediaService.baseUrl', 'http://127.0.0.1:18080');
    const fullUrl = `${String(baseUrl).replace(/\/+$/, '')}/v1/health`;
    try {
      const u = new URL(fullUrl);
      return await new Promise((resolve) => {
        const req = http.request(
          {
            hostname: u.hostname,
            port: u.port || 80,
            path: u.pathname + u.search,
            method: 'GET',
            timeout: 3000,
          },
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
      });
    } catch { return false; }
  });

  // Settings IPC handlers
  ipcMain.handle('settings:get', () => ({
    serviceUrl: store.get('shelfdeck.mediaService.baseUrl', 'http://127.0.0.1:18080'),
    serviceApiKey: store.get('shelfdeck.mediaService.apiKey', ''),
    playerExePath: store.get('shelfdeck.playerExePath', ''),
    localPathMapFrom: store.get('shelfdeck.localPathMapFrom', ''),
    localPathMapTo: store.get('shelfdeck.localPathMapTo', ''),
    subLibraryPathMaps: store.get('shelfdeck.subLibraryPathMaps', {}),
  }));

  ipcMain.handle('settings:set', (event, key, value) => {
    if (value == null) {
      store.delete(key);
      broadcastConnectionUpdated();
      return { ok: true };
    }
    try {
      store.set(key, value);
      // Broadcast when connection settings change so renderer refreshes effectiveCp
      if (key === 'shelfdeck.mediaService.baseUrl' || key === 'shelfdeck.mediaService.apiKey') {
        broadcastConnectionUpdated();
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('settings:getKey', (event, key) => store.get(key));

  // Connection IPC handlers (for shelfdeckMedia.getEffective)
  ipcMain.handle('connection:get', () => ({
    baseUrl: store.get('shelfdeck.mediaService.baseUrl', 'http://127.0.0.1:18080'),
    apiKey: store.get('shelfdeck.mediaService.apiKey', ''),
  }));

  ipcMain.handle('connection:set', (event, baseUrl, apiKey) => {
    store.set('shelfdeck.mediaService.baseUrl', baseUrl);
    store.set('shelfdeck.mediaService.apiKey', apiKey);
    return true;
  });
}

app.whenReady().then(async () => {
  if (isDev) {
    try { await session.defaultSession.clearCodeCaches({}); } catch (_) {}
  }
  registerIpcHandlers();
  watchConnectionFile();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
