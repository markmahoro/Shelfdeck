'use strict';

const SysTray = require('systray2').default;
const fs = require('fs');
const path = require('path');
const http = require('http');
const { exec } = require('child_process');

const POLL_MS = 3000;
const HTTP_TIMEOUT_MS = 2000;
const ICON_PATH = path.join(__dirname, '..', 'assets', 'tray', 'shelfdeck.ico');

function loadIconBase64() {
  return fs.readFileSync(ICON_PATH).toString('base64');
}

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

function healthLabel(status) {
  if (status === 'green')  return 'ShelfDeck — 正常';
  if (status === 'yellow') return 'ShelfDeck — 部分就绪';
  if (status === 'red')    return 'ShelfDeck — 异常';
  return 'ShelfDeck — 启动中…';
}

const SEPARATOR = SysTray.separator;

function buildMenu(icon, healthText) {
  return {
    icon,
    title: 'ShelfDeck',
    tooltip: healthText,
    items: [
      { title: '打开 ShelfDeck 管理后台', tooltip: '', enabled: true },
      SEPARATOR,
      { title: healthText, tooltip: '', enabled: true },
      SEPARATOR,
      { title: '退出 ShelfDeck', tooltip: '', enabled: true },
    ],
  };
}

async function startTray(port) {
  const icon = loadIconBase64();
  const initialText = 'ShelfDeck — 启动中…';

  const tray = new SysTray({
    copyDir: true,
    menu: buildMenu(icon, initialText),
  });

  tray.onClick((action) => {
    // __id: 1=管理后台, 2=sep, 3=健康状态(disabled), 4=sep, 5=退出
    if (action.item.__id === 1) {
      openBrowser(`http://127.0.0.1:${port}/media-libraries`);
    } else if (action.item.__id === 5) {
      tray.kill();
      process.exit(0);
    }
  });

  await tray.ready();

  console.log('[tray] ready (systray2), polling health every', POLL_MS, 'ms');

  let timer = null;
  let lastHealth = null;

  function poll() {
    checkHealth(port).then((status) => {
      if (status !== lastHealth) {
        lastHealth = status;
        const text = healthLabel(status);
        // Update only the health status item (__id: 3), leave icon + other items untouched
        tray.sendAction({
          type: 'update-item',
          item: { title: text, tooltip: text, enabled: true, __id: 3 },
          seq_id: -1,
        });
      }
    }).catch(() => { /* keep polling */ });
    timer = setTimeout(poll, POLL_MS);
  }

  poll();

  process.on('beforeExit', () => {
    if (timer) clearTimeout(timer);
  });
}

module.exports = { startTray };
