'use strict';

// Disposable service-only Docker verification for BETA-IMPL-02.  It never
// mounts project, production, or media paths and deliberately does not invoke
// any Worker, Desktop, provider, or real-media capability.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const imageIndex = process.argv.indexOf('--image');
const image = imageIndex >= 0 ? process.argv[imageIndex + 1] : undefined;
if (!image) throw new Error('Usage: node scripts/p14-beta-impl-02-docker-retest.js --image <image>');

function docker(args, options = {}) {
  try {
    return execFileSync('docker', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      ...options,
    });
  } catch (error) {
    // Do not include argv: it can contain ephemeral secret values.
    throw new Error(`docker ${args[0]} failed: ${String(error.stderr || '').trim()}`);
  }
}

function dockerStatus(args) {
  return spawnSync('docker', args, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
}

function mounted(root) {
  return `type=bind,source=${root},target=/run/helix-test`;
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.status === 200) return response;
    } catch (_error) {
      // The container may still be opening its listener.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`health did not become ready: ${url}`);
}

async function main() {
  docker(['image', 'inspect', image]);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-p14-docker-'));
  const dataDir = path.join(root, 'data');
  const missingDir = path.join(root, 'missing');
  fs.mkdirSync(missingDir);
  const name = `helix-p14-${crypto.randomUUID().replaceAll('-', '')}`;
  const secretRoot = crypto.randomBytes(32).toString('hex');
  let started = false;
  try {
    const initialized = JSON.parse(docker([
      'run', '--rm', '--mount', mounted(root), '-e', `SHELFDECK_SECRET_ROOT=${secretRoot}`, image,
      'node', 'scripts/helix-clean-init.js', '--data-dir', '/run/helix-test/data', '--apply', '--confirm', 'INITIALIZE_HELIX_CLEAN_V1',
    ]));
    assert.equal(initialized.generation, 'helix-clean-v1');
    assert.equal(typeof initialized.adminApiKey, 'string');

    const port = await reservePort();
    docker([
      'run', '-d', '--name', name, '--mount', mounted(root), '-e', `SHELFDECK_SECRET_ROOT=${secretRoot}`,
      '-e', 'MEDIA_SERVICE_DATA_DIR=/run/helix-test/data',
      '-p', `127.0.0.1:${port}:18080`, image,
    ]);
    started = true;
    const base = `http://127.0.0.1:${port}`;
    const health = await waitFor(`${base}/v1/health`);
    assert.equal((await health.json()).generation, 'helix-clean-v1');

    const admin = await fetch(`${base}/admin`);
    assert.equal(admin.status, 200);
    assert.match(await admin.text(), /id="root"/);
    const exchange = await fetch(`${base}/v1/admin/session`, {
      method: 'POST', headers: { 'x-api-key': initialized.adminApiKey },
    });
    assert.equal(exchange.status, 204);
    const cookie = exchange.headers.get('set-cookie');
    assert.match(cookie || '', /shelfdeck_admin_session=/);
    const security = await fetch(`${base}/v1/admin/settings/security`, { headers: { cookie } });
    assert.equal(security.status, 200);
    assert.equal((await security.json()).credentialConfigured, true);
    const wrongKey = await fetch(`${base}/v1/admin/settings/security`, { headers: { 'x-api-key': 'wrong-key' } });
    assert.equal(wrongKey.status, 401);
    const legacy = await fetch(`${base}/v1/admin/tasks`, { headers: { cookie } });
    assert.equal(legacy.status, 404);
    const worker = await fetch(`${base}/v1/admin/settings/workers`, { headers: { cookie } });
    assert.equal(worker.status, 404);
    assert.equal((await worker.json()).error.code, 'REMOTE_WORKER_NOT_AVAILABLE_IN_BETA');
    const readiness = JSON.parse(docker(['exec', name, 'node', 'scripts/helix-clean-init.js', '--readiness']));
    assert.equal(readiness.state, 'ready');

    docker(['restart', name]);
    await waitFor(`${base}/v1/health`);
    const restartedSecurity = await fetch(`${base}/v1/admin/settings/security`, { headers: { cookie } });
    assert.equal(restartedSecurity.status, 200);

    docker(['stop', name]);
    started = false;
    const wrongSecret = dockerStatus([
      'run', '--rm', '--mount', mounted(root), '-e', `SHELFDECK_SECRET_ROOT=${crypto.randomBytes(32).toString('hex')}`,
      '-e', 'MEDIA_SERVICE_DATA_DIR=/run/helix-test/data', image,
    ]);
    assert.notEqual(wrongSecret.status, 0);
    const missingDatabase = dockerStatus([
      'run', '--rm', '--mount', mounted(missingDir), '-e', `SHELFDECK_SECRET_ROOT=${secretRoot}`,
      '-e', 'MEDIA_SERVICE_DATA_DIR=/run/helix-test/data', image,
    ]);
    assert.notEqual(missingDatabase.status, 0);

    const runtimeBoundary = dockerStatus([
      'run', '--rm', '--entrypoint', '/bin/sh', image, '-c',
      'test ! -e /app/src/app.js && test ! -e /app/src/services && ! command -v python3 && ! command -v python',
    ]);
    assert.equal(runtimeBoundary.status, 0, runtimeBoundary.stderr);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      image,
      checks: [
        'buildable-image', 'health', 'admin-auth', 'readiness', 'restart-session',
        'wrong-secret-fail-closed', 'missing-db-fail-closed', 'legacy-route-404',
        'worker-route-404', 'runtime-without-python-or-legacy-source',
      ],
      prohibitedActionsRun: [],
    }, null, 2)}\n`);
  } finally {
    if (started) dockerStatus(['rm', '-f', name]);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ error: { code: 'P14_DOCKER_RETEST_FAILED', message: error.message } })}\n`);
  process.exitCode = 1;
});
