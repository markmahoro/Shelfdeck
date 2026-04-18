const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const embyService = require('./embyService');
const doubanService = require('./doubanService');
const transcodeService = require('./transcodeService');

const isDev = process.env.NODE_ENV === 'development';
let mainWindow = null;

function devUrlCandidates() {
  const fromEnv = process.env.VITE_DEV_SERVER_URL;
  const list = [];
  if (fromEnv) list.push(fromEnv.replace(/\/$/, ''));
  /** 与 Vite `strictPort: false` 顺延端口一致，便于单独起 Electron 时仍能连上 */
  for (let p = 5174; p <= 5184; p += 1) {
    list.push(`http://127.0.0.1:${p}`);
  }
  return [...new Set(list)];
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
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
  console.log('[main] registerIpcHandlers cwd=', process.cwd());
  ipcMain.handle('taskControl', async (_evt, args) => {
    if (args && args.action === 'simulateExit') {
      transcodeService.abortAllEncodes();
    }
    return;
  });

  ipcMain.handle('emby:testConnection', (_evt, payload) => embyService.testConnection(payload));
  ipcMain.handle('emby:getUsers', (_evt, payload) => embyService.getUsers(payload));
  ipcMain.handle('emby:getMediaFolders', (_evt, payload) => embyService.getMediaFolders(payload));
  ipcMain.handle('emby:getUnplayedItems', (_evt, payload) => embyService.getUnplayedItems(payload));
  ipcMain.handle('emby:getLibraryItemsForManage', (_evt, payload) => embyService.getLibraryItemsForManage(payload));
  ipcMain.handle('emby:getPlayedItems', (_evt, payload) => embyService.getPlayedItems(payload));
  ipcMain.handle('emby:launchPlayer', (_evt, payload) => embyService.launchPlayer(payload));
  ipcMain.handle('emby:markPlayed', (_evt, payload) => embyService.markPlayed(payload));
  ipcMain.handle('emby:markUnplayed', (_evt, payload) => embyService.markUnplayed(payload));
  ipcMain.handle('emby:getLibraryItem', (_evt, payload) => embyService.getLibraryItem(payload));
  ipcMain.handle('emby:getItemDeleteInfo', (_evt, payload) => embyService.getItemDeleteInfo(payload));
  ipcMain.handle('emby:deleteLibraryItem', (_evt, payload) => embyService.deleteLibraryItem(payload));
  ipcMain.handle('emby:libraryItemExists', (_evt, payload) => embyService.libraryItemExists(payload));

  ipcMain.handle('douban:saveSession', (_evt, payload) => doubanService.saveSession(payload));
  ipcMain.handle('douban:getSession', () => doubanService.getSession());
  ipcMain.handle('douban:stopFetch', () => {
    doubanService.requestStop();
  });
  ipcMain.handle('douban:fetchRatings', (event, opts) => doubanService.fetchRatings(event.sender, opts ?? {}));

  ipcMain.handle('transcode:validateTools', (_evt, payload) =>
    transcodeService.validateTranscodeTools(payload.config, payload.encoderPreference ?? 'auto'),
  );
  ipcMain.handle('transcode:precheck', (_evt, payload) => transcodeService.precheck(payload));
  ipcMain.handle('transcode:startEncode', (event, payload) => transcodeService.startEncode(event.sender, payload));
  ipcMain.handle('transcode:abort', (_evt, payload) => ({ ok: transcodeService.abortTask(payload.taskId) }));
  ipcMain.handle('transcode:probe', (_evt, payload) => transcodeService.probeSummary(payload.config, payload.filePath));
  ipcMain.handle('transcode:replace', (_evt, payload) =>
    transcodeService.replaceWithRetries({
      config: payload.config,
      targetPath: payload.targetPath,
      partialPath: payload.partialPath,
    }),
  );
  ipcMain.handle('transcode:cleanupTaskWorkdir', async (_evt, payload) => {
    await transcodeService.cleanupTaskWorkdir(payload.tempDir);
    return { ok: true };
  });
  ipcMain.handle('transcode:scanOrphans', (_evt, payload) => transcodeService.scanOrphans(payload.tempRoot));
  ipcMain.handle('transcode:deletePaths', async (_evt, payload) => {
    await transcodeService.deletePaths(payload.paths ?? []);
    return { ok: true };
  });

  console.log(
    '[main] IPC handlers registered (incl. emby:getLibraryItem, emby:getItemDeleteInfo, emby:deleteLibraryItem, emby:libraryItemExists, transcode:*)',
  );
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

