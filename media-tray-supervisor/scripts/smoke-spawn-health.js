'use strict';

/**
 * Scriptable subset of tray supervisor behavior: spawn media-service like the tray does,
 * poll /v1/health, then kill child and verify health fails. Uses a random free port to
 * avoid colliding with a dev server on 18080.
 */

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const net = require('net');
const fs = require('fs');

function getMediaServiceRoot() {
  if (process.env.TRAY_MEDIA_SERVICE_ROOT) {
    return path.resolve(process.env.TRAY_MEDIA_SERVICE_ROOT);
  }
  return path.resolve(__dirname, '..', '..', 'media-service');
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const p = typeof addr === 'object' && addr ? addr.port : null;
      s.close(() => (p ? resolve(p) : reject(new Error('no port'))));
    });
    s.on('error', reject);
  });
}

function checkHealth(port) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/v1/health',
        method: 'GET',
        timeout: 2000,
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const mediaRoot = getMediaServiceRoot();
  const serverJs = path.join(mediaRoot, 'src', 'server.js');
  if (!fs.existsSync(serverJs)) {
    console.error('FAIL: missing', serverJs, '(set TRAY_MEDIA_SERVICE_ROOT)');
    process.exit(1);
  }

  const port = await getFreePort();
  const nodeBin = process.platform === 'win32' ? 'node.exe' : 'node';
  const child = spawn(nodeBin, ['src/server.js'], {
    cwd: mediaRoot,
    env: { ...process.env, MEDIA_SERVICE_PORT: String(port), CONTROL_PLANE_PORT: String(port) },
    windowsHide: true,
    stdio: 'pipe',
  });

  let stderr = '';
  child.stderr.on('data', (c) => {
    stderr += c.toString();
  });

  let ok = false;
  for (let i = 0; i < 60; i++) {
    if (await checkHealth(port)) {
      ok = true;
      break;
    }
    if (child.exitCode !== null) {
      console.error('FAIL: child exited early', child.exitCode, stderr.slice(-2000));
      process.exit(1);
    }
    await sleep(250);
  }

  if (!ok) {
    try {
      child.kill();
    } catch (_) {}
    console.error('FAIL: health never ok on port', port, stderr.slice(-2000));
    process.exit(1);
  }
  console.log('PASS: spawn + /v1/health ok on port', port);

  try {
    child.kill();
  } catch (_) {}

  await sleep(1500);
  if (await checkHealth(port)) {
    console.error('FAIL: health still ok after kill (port', port, ')');
    process.exit(1);
  }
  console.log('PASS: health unreachable after kill');

  console.log('smoke-spawn-health: all checks passed');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
