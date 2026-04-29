'use strict';

const Tray = require('trayicon');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { exec } = require('child_process');

const POLL_MS = 3000;
const HTTP_TIMEOUT_MS = 2000;
const ICON_DIR = path.join(__dirname, '..', 'assets', 'tray');

function loadIconBuf(name) {
  return fs.readFileSync(path.join(ICON_DIR, name + '.ico'));
}

// Preload icons once
const ICONS = {
  running: loadIconBuf('status-running'),
  unhealthy: loadIconBuf('status-unhealthy'),
  stopped: loadIconBuf('status-stopped'),
};

function checkHealth(port) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/v1/health',
      method: 'GET',
      timeout: HTTP_TIMEOUT_MS,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300 && j && j.status) {
            resolve(j.status);
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

function openBrowser(url) {
  const cmd = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) console.error('[tray] failed to open browser:', err.message);
  });
}

function resolveHealth(status) {
  if (status === 'green') {
    return { icon: ICONS.running, title: 'ShelfDeck — 正常' };
  }
  if (status === 'yellow') {
    return { icon: ICONS.stopped, title: 'ShelfDeck — 部分就绪' };
  }
  return { icon: ICONS.unhealthy, title: 'ShelfDeck — 异常' };
}

function startTray(port) {
  Tray.create({
    icon: ICONS.stopped,
    title: 'ShelfDeck — 启动中…',
    useTempDir: true,
  }, (tray) => {
    tray.on('error', (err) => {
      console.error('[tray] error:', err);
    });

    const openAdmin = tray.item('打开 ShelfDeck 管理后台', {
      action: () => openBrowser(`http://127.0.0.1:${port}/media-libraries`),
    });
    const exitItem = tray.item('退出 ShelfDeck', {
      action: () => {
        tray.kill();
        process.exit(0);
      },
    });

    tray.setMenu(openAdmin, tray.separator(), exitItem);

    console.log('[tray] ready, polling health every', POLL_MS, 'ms');

    let timer = null;

    function poll() {
      checkHealth(port).then((status) => {
        const h = resolveHealth(status);
        try {
          tray.setIcon(h.icon);
          tray.setTitle(h.title);
        } catch (_) { /* tray may be dead */ }
      }).catch(() => { /* keep polling */ });
      timer = setTimeout(poll, POLL_MS);
    }

    poll();

    process.on('beforeExit', () => {
      if (timer) clearTimeout(timer);
    });
  });
}

module.exports = { startTray };
