const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

const isDev = process.env.NODE_ENV === 'development';
let mainWindow = null;

function devUrlCandidates() {
  const fromEnv = process.env.VITE_DEV_SERVER_URL;
  const list = [];
  if (fromEnv) list.push(fromEnv.replace(/\/$/, ''));
  list.push('http://127.0.0.1:5173');
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
    'Vite must be on http://127.0.0.1:5173 (strictPort). Free port 5173 if busy, then run: npm run dev',
  );
  win.loadURL(
    `data:text/html;charset=utf-8,<h2 style="font-family:Segoe UI">Unable to connect Vite dev server</h2><p>${hint}</p>`,
  );
}

ipcMain.handle('taskControl', async (_evt, _args) => {
  return;
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

