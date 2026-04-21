'use strict';

const { app, Tray, Menu, nativeImage, dialog, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const shelfdeckConnection = require('./shelfdeckConnection');

const POLL_MS = 3000;
const HTTP_TIMEOUT_MS = 2000;
const START_GRACE_MS = 30000;
const FAIL_THRESHOLD = 3;
const STOP_GRACE_MS = 5000;

const {
  resolveEffectiveConnection,
  writeConnectionFile,
  hasPersistedOrEnvBaseUrl,
  getConnectionFilePath,
  stripSlash,
} = shelfdeckConnection;

function traySettingsPath() {
  return path.join(path.dirname(getConnectionFilePath()), 'tray-settings.json');
}

function loadTraySettings() {
  try {
    const j = JSON.parse(fs.readFileSync(traySettingsPath(), 'utf8'));
    return {
      quitStopLocalService: Boolean(j.quitStopLocalService),
      startWithWindows: Boolean(j.startWithWindows),
    };
  } catch {
    return { quitStopLocalService: false, startWithWindows: false };
  }
}

function saveTraySettings(s) {
  fs.mkdirSync(path.dirname(traySettingsPath()), { recursive: true });
  fs.writeFileSync(traySettingsPath(), JSON.stringify(s, null, 2), 'utf8');
}

function applyLoginItemSetting(enabled) {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: process.execPath,
      args: [path.join(__dirname, '..')],
    });
  } catch (e) {
    console.error(e);
  }
}

function getMediaServiceRoot() {
  if (process.env.TRAY_MEDIA_SERVICE_ROOT) {
    return path.resolve(process.env.TRAY_MEDIA_SERVICE_ROOT);
  }
  return path.resolve(__dirname, '..', '..', 'media-service');
}

function portFromBaseUrl(baseUrl) {
  try {
    const u = new URL(baseUrl);
    if (u.port) return Number(u.port);
    if (u.protocol === 'https:') return 443;
    if (u.protocol === 'http:') return 80;
  } catch {
    /* fall through */
  }
  return Number(process.env.MEDIA_SERVICE_PORT || process.env.CONTROL_PLANE_PORT || 18080);
}

function isLocalBaseUrl(baseUrl) {
  try {
    const u = new URL(baseUrl);
    const h = u.hostname.toLowerCase();
    return h === '127.0.0.1' || h === 'localhost' || h === '[::1]';
  } catch {
    return false;
  }
}

function checkHealthUrl(baseUrl, apiKey) {
  return new Promise((resolve) => {
    try {
      const u = new URL(new URL('/v1/health', baseUrl).href);
      const lib = u.protocol === 'https:' ? https : http;
      const opts = {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'GET',
        timeout: HTTP_TIMEOUT_MS,
        headers: {},
      };
      if (apiKey) opts.headers['X-API-Key'] = apiKey;
      const req = lib.request(opts, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(data);
            resolve(res.statusCode >= 200 && res.statusCode < 300 && j && j.status === 'ok');
          } catch {
            resolve(false);
          }
        });
      });
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

let tray = null;
/** @type {BrowserWindow | null} */
let panelWindow = null;
/** @type {import('child_process').ChildProcess | null} */
let supervisedChild = null;
let spawnAt = 0;
let userStartGraceUntil = 0;
let consecutiveFails = 0;
let hadSuccessfulHealth = false;
let pollTimer = null;
let lastHealthOk = false;

function iconPath(name) {
  return path.join(__dirname, 'assets', name);
}

function loadTrayImage(file) {
  const p = iconPath(file);
  if (fs.existsSync(p)) {
    return nativeImage.createFromPath(p);
  }
  return nativeImage.createEmpty();
}

function derivePresentation() {
  const configured = hasPersistedOrEnvBaseUrl();
  const eff = resolveEffectiveConnection();
  const displayBase = configured ? eff.baseUrl : '未配置服务器地址';

  const hasChild =
    supervisedChild && supervisedChild.exitCode === null && supervisedChild.signalCode === null;
  const inUserGrace = userStartGraceUntil > 0 && Date.now() < userStartGraceUntil;

  if (!configured) {
    return {
      dotKind: 'yellow',
      tooltip: `ShelfDeck 小助手 — 未配置（${displayBase}）`,
      statusText: '未就绪：请先在下方保存服务器地址',
      iconFile: 'status-stopped.png',
    };
  }

  if (inUserGrace && hasChild && !lastHealthOk) {
    return {
      dotKind: 'yellow',
      tooltip: `ShelfDeck 小助手 — 启动中…（${eff.baseUrl}）`,
      statusText: '启动中…',
      iconFile: 'status-stopped.png',
    };
  }

  if (lastHealthOk) {
    return {
      dotKind: 'green',
      tooltip: `ShelfDeck 小助手 — 正常（${eff.baseUrl}）`,
      statusText: '正常',
      iconFile: 'status-running.png',
    };
  }

  if (hadSuccessfulHealth && consecutiveFails >= FAIL_THRESHOLD) {
    return {
      dotKind: 'red',
      tooltip: `ShelfDeck 小助手 — 无法连接（${eff.baseUrl}）`,
      statusText: '无法连接媒体管理服务',
      iconFile: 'status-unhealthy.png',
    };
  }

  return {
    dotKind: 'yellow',
    tooltip: `ShelfDeck 小助手 — 未就绪（${eff.baseUrl}）`,
    statusText: '未就绪或正在连接',
    iconFile: 'status-stopped.png',
  };
}

function applyTrayVisual() {
  if (!tray) return;
  const p = derivePresentation();
  const img = loadTrayImage(p.iconFile);
  if (!img.isEmpty()) {
    tray.setImage(img);
  }
  tray.setToolTip(p.tooltip);
}

async function fetchQueueSummary(baseUrl, apiKey) {
  try {
    const u = new URL('/v1/tasks', baseUrl);
    const res = await fetch(u, {
      headers: apiKey ? { 'X-API-Key': apiKey } : {},
    });
    if (!res.ok) return '暂时无法读取任务队列';
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) return '队列为空';
    const counts = {};
    for (const t of arr) {
      const s = String(t.status || 'unknown');
      counts[s] = (counts[s] || 0) + 1;
    }
    const parts = Object.keys(counts).map((k) => `${k} ${counts[k]} 条`);
    return `共 ${arr.length} 条（${parts.join('，')}）`;
  } catch {
    return '服务不可达，无法读取任务摘要';
  }
}

async function pollOnce() {
  const configured = hasPersistedOrEnvBaseUrl();
  const eff = resolveEffectiveConnection();
  if (!configured) {
    consecutiveFails = 0;
    lastHealthOk = false;
    hadSuccessfulHealth = false;
    applyTrayVisual();
    return;
  }

  const ok = await checkHealthUrl(eff.baseUrl, eff.apiKey);
  lastHealthOk = ok;

  if (ok) {
    consecutiveFails = 0;
    hadSuccessfulHealth = true;
  } else {
    if (hadSuccessfulHealth) {
      consecutiveFails = Math.min(consecutiveFails + 1, FAIL_THRESHOLD + 5);
    } else {
      consecutiveFails = 0;
    }
  }

  const hasChild =
    supervisedChild && supervisedChild.exitCode === null && supervisedChild.signalCode === null;
  if (hasChild && !ok && Date.now() - spawnAt > START_GRACE_MS) {
    /* 子进程仍在但长期不健康：仍由 consecutiveFails / hadSuccessfulHealth 驱动红绿 */
  }

  applyTrayVisual();
}

/** @returns {{ ok: true, root: string } | { ok: false, message: string }} */
function validateMediaServiceRoot() {
  const root = getMediaServiceRoot();
  const serverJs = path.join(root, 'src', 'server.js');
  if (!fs.existsSync(serverJs)) {
    return {
      ok: false,
      message: `找不到媒体管理服务：\n${serverJs}\n\n请设置环境变量 TRAY_MEDIA_SERVICE_ROOT 指向 media-service 目录。`,
    };
  }
  return { ok: true, root };
}

function ensureMediaServicePaths() {
  const v = validateMediaServiceRoot();
  if (!v.ok) {
    dialog.showErrorBox('ShelfDeck 小助手', v.message);
    return null;
  }
  return v.root;
}

/**
 * 本机 spawn 前检查（无对话框，供保存管线与用户点「启动」共用）。
 * @param {{ baseUrl: string; apiKey: string }} eff
 */
async function evaluateCanSpawnLocal(eff) {
  const hasChild =
    supervisedChild && supervisedChild.exitCode === null && supervisedChild.signalCode === null;
  if (hasChild) {
    return {
      ok: false,
      message: '已有由本助手启动的实例在运行，请先停止后再试。',
    };
  }
  const healthy = await checkHealthUrl(eff.baseUrl, eff.apiKey);
  if (healthy) {
    return {
      ok: false,
      message: `目标地址已有服务响应健康检查（${eff.baseUrl}）。为避免双实例，未启动新进程。`,
    };
  }
  return { ok: true };
}

async function assertCanSpawn(eff) {
  const r = await evaluateCanSpawnLocal(eff);
  if (r.ok) return true;
  dialog.showMessageBoxSync({
    type: r.message.includes('已有服务响应') ? 'warning' : 'info',
    title: 'ShelfDeck',
    message: r.message,
  });
  return false;
}

/**
 * @param {{ baseUrl: string; apiKey: string }} eff
 * @param {{ silent?: boolean }} [opts] silent：保存管线内不弹窗，错误由返回值携带
 */
function spawnLocalMediaServiceChild(eff, opts = {}) {
  const silent = Boolean(opts.silent);
  const vr = validateMediaServiceRoot();
  if (!vr.ok) {
    if (!silent) dialog.showErrorBox('ShelfDeck 小助手', vr.message);
    return { ok: false, message: vr.message };
  }
  const root = vr.root;
  const port = portFromBaseUrl(eff.baseUrl);
  const nodeBin = process.platform === 'win32' ? 'node.exe' : 'node';
  const child = spawn(nodeBin, ['src/server.js'], {
    cwd: root,
    env: {
      ...process.env,
      MEDIA_SERVICE_PORT: String(port),
      CONTROL_PLANE_PORT: String(port),
    },
    windowsHide: true,
    stdio: 'ignore',
  });
  supervisedChild = child;
  spawnAt = Date.now();
  userStartGraceUntil = Date.now() + START_GRACE_MS;
  consecutiveFails = 0;

  child.on('exit', () => {
    if (supervisedChild === child) {
      supervisedChild = null;
    }
    userStartGraceUntil = 0;
    applyTrayVisual();
  });
  child.on('error', (err) => {
    if (!silent) dialog.showErrorBox('ShelfDeck 小助手', `无法启动媒体管理服务：${err.message}`);
    if (supervisedChild === child) {
      supervisedChild = null;
    }
    userStartGraceUntil = 0;
    applyTrayVisual();
  });

  applyTrayVisual();
  return { ok: true };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 保存连接时：健康未通过则尝试启动（本机 spawn；远端占位）。
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
async function attemptStartMediaServiceForSave(eff) {
  if (isLocalBaseUrl(eff.baseUrl)) {
    const can = await evaluateCanSpawnLocal(eff);
    if (!can.ok) {
      return { ok: false, message: can.message };
    }
    const sp = spawnLocalMediaServiceChild(eff, { silent: true });
    if (!sp.ok) return { ok: false, message: sp.message || '无法启动本机媒体管理服务。' };
    return { ok: true };
  }
  return {
    ok: false,
    message:
      '当前版本尚不支持从本机自动启动远端（NAS 等）上的媒体管理服务，请先在服务器侧启动服务后，再点击保存。',
  };
}

async function waitForHealthOk(baseUrl, apiKey, timeoutMs, intervalMs = 400) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkHealthUrl(baseUrl, apiKey)) return true;
    await sleep(intervalMs);
  }
  return false;
}

async function startServiceFromUser() {
  if (!hasPersistedOrEnvBaseUrl()) {
    dialog.showMessageBoxSync({
      type: 'warning',
      title: 'ShelfDeck',
      message: '请先配置并保存服务器地址。',
    });
    return;
  }
  const eff = resolveEffectiveConnection();
  if (!isLocalBaseUrl(eff.baseUrl)) {
    dialog.showMessageBoxSync({
      type: 'info',
      title: 'ShelfDeck',
      message: '当前连接指向远端主机。请在 NAS 或服务器侧启动媒体管理服务（见运维文档）。',
    });
    return;
  }

  const root = ensureMediaServicePaths();
  if (!root) return;
  if (!(await assertCanSpawn(eff))) return;

  spawnLocalMediaServiceChild(eff, { silent: false });
}

function stopServiceSync(forceConfirm) {
  const hasChild =
    supervisedChild && supervisedChild.exitCode === null && supervisedChild.signalCode === null;
  if (!hasChild) return;

  if (forceConfirm) {
    const r = dialog.showMessageBoxSync({
      type: 'warning',
      title: 'ShelfDeck',
      buttons: ['取消', '确定'],
      defaultId: 1,
      cancelId: 0,
      message: '将终止本机由本助手启动的媒体管理服务进程。是否继续？',
    });
    if (r !== 1) return;
  }

  const ch = supervisedChild;
  supervisedChild = null;
  userStartGraceUntil = 0;
  if (!ch) return;

  ch.kill();
  const deadline = Date.now() + STOP_GRACE_MS;
  const iv = setInterval(() => {
    if (ch.exitCode !== null || ch.signalCode !== null) {
      clearInterval(iv);
      applyTrayVisual();
      return;
    }
    if (Date.now() >= deadline) {
      try {
        ch.kill('SIGKILL');
      } catch (_) {}
      clearInterval(iv);
      applyTrayVisual();
    }
  }, 200);
}

async function restartServiceFromUser() {
  stopServiceSync(false);
  await new Promise((r) => setTimeout(r, 1200));
  await startServiceFromUser();
}

function openPanelWindow() {
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.show();
    panelWindow.focus();
    return;
  }
  panelWindow = new BrowserWindow({
    width: 460,
    height: 680,
    show: false,
    resizable: true,
    minimizable: true,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'trayPanelPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  panelWindow.setMenuBarVisibility(false);
  void panelWindow.loadFile(path.join(__dirname, 'trayPanel.html'));
  panelWindow.once('ready-to-show', () => {
    if (panelWindow && !panelWindow.isDestroyed()) panelWindow.show();
  });
  panelWindow.on('closed', () => {
    panelWindow = null;
  });
}

function launchOrFocusDesktop() {
  const custom = process.env.SHELFDESK_DESKTOP_EXE;
  if (custom && fs.existsSync(custom)) {
    spawn(custom, [], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  const desktopRoot = path.join(__dirname, '..', '..', 'media-desktop');
  const desktopPkg = path.join(desktopRoot, 'package.json');
  if (fs.existsSync(desktopPkg)) {
    spawn(process.execPath, ['.'], {
      cwd: desktopRoot,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
  } else {
    dialog.showMessageBoxSync({
      type: 'warning',
      title: 'ShelfDeck',
      message: '未找到本机 ShelfDeck 桌面客户端目录。可设置环境变量 SHELFDESK_DESKTOP_EXE 指向可执行文件。',
    });
  }
}

function buildContextMenu() {
  return Menu.buildFromTemplate([
    {
      label: '打开小助手面板',
      click: () => openPanelWindow(),
    },
    {
      label: '打开 ShelfDeck 主界面',
      click: () => launchOrFocusDesktop(),
    },
    { type: 'separator' },
    {
      label: '退出小助手',
      click: () => {
        app.quit();
      },
    },
  ]);
}

function createTray() {
  const p = derivePresentation();
  const icon = loadTrayImage(p.iconFile);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip(p.tooltip);
  tray.setContextMenu(buildContextMenu());
  tray.on('click', () => {
    openPanelWindow();
  });
  applyTrayVisual();
}

async function buildSnapshot() {
  const configured = hasPersistedOrEnvBaseUrl();
  const eff = resolveEffectiveConnection();
  const settings = loadTraySettings();
  const pres = derivePresentation();
  const queueSummary = configured ? await fetchQueueSummary(eff.baseUrl, eff.apiKey) : '未配置连接，无法读取队列';

  return {
    displayBaseUrl: configured ? eff.baseUrl : '未配置服务器地址',
    apiKeySet: Boolean(String(eff.apiKey || '').trim()),
    statusText: pres.statusText,
    dotKind: pres.dotKind,
    queueSummary,
    settings,
    controlsEnabled: configured,
    controlHint: configured ? '' : '请先配置并保存服务器地址',
  };
}

ipcMain.handle('tray:snapshot', () => buildSnapshot());

ipcMain.handle('tray:save-connection', async (_e, payload) => {
  const rawUrl = String(payload?.baseUrl || '').trim();
  const apiKey = String(payload?.apiKey || '').trim();
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ok: false, message: '请输入合法的 HTTP 或 HTTPS 地址' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, message: '仅支持 HTTP 或 HTTPS 地址' };
  }
  const baseUrl = stripSlash(u.toString());
  const eff = { baseUrl, apiKey };

  if (await checkHealthUrl(baseUrl, apiKey)) {
    writeConnectionFile({ baseUrl, apiKey });
    hadSuccessfulHealth = true;
    consecutiveFails = 0;
    lastHealthOk = true;
    applyTrayVisual();
    void pollOnce();
    return { ok: true };
  }

  const started = await attemptStartMediaServiceForSave(eff);
  if (!started.ok) {
    return { ok: false, message: started.message };
  }

  const up = await waitForHealthOk(baseUrl, apiKey, START_GRACE_MS, 400);
  if (!up) {
    return {
      ok: false,
      message:
        '健康检查未通过：已尝试按地址启动本机服务，但在等待时间内仍未就绪。请确认端口、API Key，或在本机检查 TRAY_MEDIA_SERVICE_ROOT。',
    };
  }

  writeConnectionFile({ baseUrl, apiKey });
  hadSuccessfulHealth = true;
  consecutiveFails = 0;
  lastHealthOk = true;
  applyTrayVisual();
  void pollOnce();
  return { ok: true };
});

ipcMain.handle('tray:start-service', () => {
  void startServiceFromUser();
  return { ok: true };
});

ipcMain.handle('tray:stop-service', () => {
  if (!hasPersistedOrEnvBaseUrl()) {
    dialog.showMessageBoxSync({ type: 'warning', title: 'ShelfDeck', message: '请先配置并保存服务器地址。' });
    return { ok: false };
  }
  const eff = resolveEffectiveConnection();
  const hasChild =
    supervisedChild && supervisedChild.exitCode === null && supervisedChild.signalCode === null;
  if (hasChild) {
    stopServiceSync(true);
    return { ok: true };
  }
  if (!isLocalBaseUrl(eff.baseUrl)) {
    dialog.showMessageBoxSync({
      type: 'info',
      title: 'ShelfDeck',
      message: '当前为远端地址。请在服务器或 NAS 上停止媒体管理服务。',
    });
    return { ok: false };
  }
  dialog.showMessageBoxSync({
    type: 'info',
    title: 'ShelfDeck',
    message:
      '当前服务不是由本助手启动。请在任务管理器中结束对应进程，或在服务器侧停止服务。',
  });
  return { ok: false };
});

ipcMain.handle('tray:restart-service', async () => {
  await restartServiceFromUser();
  return { ok: true };
});

ipcMain.handle('tray:open-desktop', () => {
  launchOrFocusDesktop();
  return { ok: true };
});

ipcMain.handle('tray:update-settings', (_e, payload) => {
  const cur = loadTraySettings();
  const next = {
    quitStopLocalService:
      payload && Object.prototype.hasOwnProperty.call(payload, 'quitStopLocalService')
        ? Boolean(payload.quitStopLocalService)
        : cur.quitStopLocalService,
    startWithWindows:
      payload && Object.prototype.hasOwnProperty.call(payload, 'startWithWindows')
        ? Boolean(payload.startWithWindows)
        : cur.startWithWindows,
  };
  saveTraySettings(next);
  applyLoginItemSetting(next.startWithWindows);
  return { ok: true };
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    dialog.showMessageBoxSync({
      type: 'info',
      title: 'ShelfDeck',
      message: 'ShelfDeck 小助手已在运行。',
    });
  });

  app.whenReady().then(() => {
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.shelfdeck.media.tray-supervisor');
    }
    const st = loadTraySettings();
    applyLoginItemSetting(st.startWithWindows);
    createTray();
    pollTimer = setInterval(() => {
      pollOnce().catch((e) => console.error(e));
    }, POLL_MS);
    pollOnce().catch((e) => console.error(e));
  });

  app.on('before-quit', () => {
    if (pollTimer) clearInterval(pollTimer);
    const st = loadTraySettings();
    if (st.quitStopLocalService) {
      const hasChild =
        supervisedChild && supervisedChild.exitCode === null && supervisedChild.signalCode === null;
      if (hasChild) {
        stopServiceSync(false);
      }
    }
  });

  app.on('window-all-closed', (e) => {
    e.preventDefault();
  });
}
