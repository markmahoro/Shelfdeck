'use strict';

const { app, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');

const POLL_MS = 3000;
const HTTP_TIMEOUT_MS = 2000;
const START_GRACE_MS = 30000;
const FAIL_THRESHOLD = 3;
const STOP_GRACE_MS = 5000;

function getPort() {
  return Number(process.env.MEDIA_SERVICE_PORT || process.env.CONTROL_PLANE_PORT || 18080);
}

function getMediaServiceRoot() {
  if (process.env.TRAY_MEDIA_SERVICE_ROOT) {
    return path.resolve(process.env.TRAY_MEDIA_SERVICE_ROOT);
  }
  return path.resolve(__dirname, '..', '..', 'media-service');
}

function healthPath() {
  return `/v1/health`;
}

function checkHealth() {
  return new Promise((resolve) => {
    const port = getPort();
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: healthPath(),
        method: 'GET',
        timeout: HTTP_TIMEOUT_MS,
      },
      (res) => {
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
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

let tray = null;
/** @type {import('child_process').ChildProcess | null} */
let supervisedChild = null;
let spawnAt = 0;
let consecutiveFails = 0;
let pollTimer = null;

function iconPath(name) {
  return path.join(__dirname, 'assets', name);
}

function loadTrayImage(file) {
  const p = iconPath(file);
  if (fs.existsSync(p)) {
    return nativeImage.createFromPath(p);
  }
  const empty = nativeImage.createEmpty();
  return empty;
}

function deriveState() {
  const port = getPort();
  const hasChild =
    supervisedChild &&
    supervisedChild.exitCode === null &&
    supervisedChild.signalCode === null;

  if (!hasChild) {
    return { kind: 'stopped', tooltip: `ShelfDeck 媒体管理服务 — 已停止（127.0.0.1:${port}）` };
  }

  const inGrace = Date.now() - spawnAt < START_GRACE_MS;
  if (inGrace && consecutiveFails === 0) {
    return {
      kind: 'starting',
      tooltip: `ShelfDeck 媒体管理服务 — 启动中…（127.0.0.1:${port}）`,
    };
  }

  if (consecutiveFails >= FAIL_THRESHOLD && !inGrace) {
    return {
      kind: 'unhealthy',
      tooltip: `ShelfDeck 媒体管理服务 — 异常（127.0.0.1:${port}）`,
    };
  }

  if (consecutiveFails === 0) {
    return {
      kind: 'running',
      tooltip: `ShelfDeck 媒体管理服务 — 运行中（127.0.0.1:${port}）`,
    };
  }

  return {
    kind: 'starting',
    tooltip: `ShelfDeck 媒体管理服务 — 启动中…（127.0.0.1:${port}）`,
  };
}

function applyTrayVisual() {
  if (!tray) return;
  const s = deriveState();
  const iconFile =
    s.kind === 'running'
      ? 'status-running.png'
      : s.kind === 'unhealthy'
        ? 'status-unhealthy.png'
        : 'status-stopped.png';
  const img = loadTrayImage(iconFile);
  if (!img.isEmpty()) {
    tray.setImage(img);
  }
  tray.setToolTip(s.tooltip);
}

async function pollOnce() {
  const ok = await checkHealth();
  const hasChild =
    supervisedChild &&
    supervisedChild.exitCode === null &&
    supervisedChild.signalCode === null;

  if (hasChild) {
    const inGrace = Date.now() - spawnAt < START_GRACE_MS;
    if (ok) {
      consecutiveFails = 0;
    } else if (!inGrace) {
      consecutiveFails = Math.min(consecutiveFails + 1, FAIL_THRESHOLD + 5);
    }
  } else {
    consecutiveFails = 0;
  }

  applyTrayVisual();
}

function ensureMediaServicePaths() {
  const root = getMediaServiceRoot();
  const serverJs = path.join(root, 'src', 'server.js');
  if (!fs.existsSync(serverJs)) {
    dialog.showErrorBox(
      'ShelfDeck 托盘监督',
      `找不到媒体管理服务：\n${serverJs}\n\n请设置环境变量 TRAY_MEDIA_SERVICE_ROOT 指向 media-service 目录。`,
    );
    return null;
  }
  return root;
}

async function assertCanSpawn() {
  const hasChild =
    supervisedChild &&
    supervisedChild.exitCode === null &&
    supervisedChild.signalCode === null;
  if (hasChild) {
    dialog.showMessageBoxSync({
      type: 'info',
      title: 'ShelfDeck',
      message: '媒体管理服务已在运行（由本监督进程启动）。',
    });
    return false;
  }
  const healthy = await checkHealth();
  if (healthy) {
    dialog.showMessageBoxSync({
      type: 'warning',
      title: 'ShelfDeck',
      message: `端口 ${getPort()} 上已有服务响应健康检查。\n为避免双实例，未启动新进程。\n请先停止其它实例或更换 MEDIA_SERVICE_PORT。`,
    });
    return false;
  }
  return true;
}

async function startService() {
  const root = ensureMediaServicePaths();
  if (!root) return;
  if (!(await assertCanSpawn())) return;

  const nodeBin = process.platform === 'win32' ? 'node.exe' : 'node';
  const child = spawn(nodeBin, ['src/server.js'], {
    cwd: root,
    env: { ...process.env },
    windowsHide: true,
    stdio: 'ignore',
  });
  supervisedChild = child;
  spawnAt = Date.now();
  consecutiveFails = 0;

  child.on('exit', () => {
    if (supervisedChild === child) {
      supervisedChild = null;
    }
    consecutiveFails = 0;
    applyTrayVisual();
  });
  child.on('error', (err) => {
    dialog.showErrorBox('ShelfDeck 托盘监督', `无法启动媒体管理服务：${err.message}`);
    if (supervisedChild === child) {
      supervisedChild = null;
    }
    applyTrayVisual();
  });

  applyTrayVisual();
}

function stopServiceSync(forceConfirm) {
  const hasChild =
    supervisedChild &&
    supervisedChild.exitCode === null &&
    supervisedChild.signalCode === null;
  if (!hasChild) return;

  if (forceConfirm) {
    const r = dialog.showMessageBoxSync({
      type: 'warning',
      title: 'ShelfDeck',
      buttons: ['取消', '确定'],
      defaultId: 1,
      cancelId: 0,
      message: '将终止本机媒体管理服务进程（由本监督程序启动的实例）。是否继续？',
    });
    if (r !== 1) return;
  }

  const ch = supervisedChild;
  supervisedChild = null;
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

async function restartService() {
  stopServiceSync(false);
  await new Promise((r) => setTimeout(r, 1200));
  await startService();
}

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: '启动媒体管理服务',
      click: () => {
        startService().catch((e) => console.error(e));
      },
    },
    {
      label: '停止媒体管理服务',
      click: () => stopServiceSync(true),
    },
    {
      label: '重启媒体管理服务',
      click: () => {
        restartService().catch((e) => console.error(e));
      },
    },
    { type: 'separator' },
    {
      label: '退出监督程序',
      click: () => {
        const hasChild =
          supervisedChild &&
          supervisedChild.exitCode === null &&
          supervisedChild.signalCode === null;
        if (hasChild) {
          const r = dialog.showMessageBoxSync({
            type: 'warning',
            title: 'ShelfDeck',
            buttons: ['取消', '确定'],
            defaultId: 1,
            cancelId: 0,
            message: '退出前将先停止媒体管理服务。是否继续？',
          });
          if (r !== 1) return;
          stopServiceSync(false);
        }
        app.quit();
      },
    },
  ]);
}

function createTray() {
  const icon = loadTrayImage('status-stopped.png');
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('ShelfDeck 媒体管理服务');
  const menu = buildMenu();
  tray.setContextMenu(menu);
  tray.on('click', () => {
    tray.popUpContextMenu();
  });
  applyTrayVisual();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    dialog.showMessageBoxSync({
      type: 'info',
      title: 'ShelfDeck',
      message: '媒体管理服务托盘监督已在运行。',
    });
  });

  app.whenReady().then(() => {
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.shelfdeck.media.tray-supervisor');
    }
    createTray();
    pollTimer = setInterval(() => {
      pollOnce().catch((e) => console.error(e));
    }, POLL_MS);
    pollOnce().catch((e) => console.error(e));
  });

  app.on('before-quit', () => {
    if (pollTimer) clearInterval(pollTimer);
    stopServiceSync(false);
  });

  app.on('window-all-closed', (e) => {
    e.preventDefault();
  });
}
