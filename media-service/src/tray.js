'use strict';

const SysTray = require('systray2').default;
const fs = require('fs');
const path = require('path');
const http = require('http');
const { exec } = require('child_process');

const POLL_MS = 3000;
const HTTP_TIMEOUT_MS = 2000;
const ICON_DIR = path.join(__dirname, '..', 'assets', 'tray');

function loadIconBase64(name) {
  return fs.readFileSync(path.join(ICON_DIR, name + '.ico')).toString('base64');
}

const ICONS = {
  running: loadIconBase64('status-running'),
  unhealthy: loadIconBase64('status-unhealthy'),
  stopped: loadIconBase64('status-stopped'),
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
          resolve(res.statusCode >= 200 && res.statusCode < 300 && j ? j.status : null);
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

const SEPARATOR = SysTray.separator;

function buildMenu(icon, title, tooltip) {
  return {
    icon,
    title,
    tooltip,
    items: [
      { title: '打开 ShelfDeck 管理后台', tooltip: '', enabled: true },
      SEPARATOR,
      { title: '退出 ShelfDeck', tooltip: '', enabled: true },
    ],
  };
}

async function startTray(port) {
  const initialIcon = ICONS.stopped;
  const initialTitle = 'ShelfDeck — 启动中…';

  const tray = new SysTray({
    copyDir: true,
    menu: buildMenu(initialIcon, initialTitle, initialTitle),
  });

  tray.onClick((action) => {
    // __id assignments: 1=管理后台, 2=separator, 3=退出
    if (action.item.__id === 1) {
      openBrowser(`http://127.0.0.1:${port}/media-libraries`);
    } else if (action.item.__id === 3) {
      tray.kill();
      process.exit(0);
    }
  });

  await tray.ready();

  console.log('[tray] ready (systray2), polling health every', POLL_MS, 'ms');

  let timer = null;

  function poll() {
    checkHealth(port).then((status) => {
      const h = resolveHealth(status);
      tray.sendAction({
        type: 'update-menu',
        menu: buildMenu(h.icon, h.title, h.title),
        seq_id: -1,
      });
    }).catch(() => { /* keep polling */ });
    timer = setTimeout(poll, POLL_MS);
  }

  poll();

  process.on('beforeExit', () => {
    if (timer) clearTimeout(timer);
  });
}

module.exports = { startTray };
