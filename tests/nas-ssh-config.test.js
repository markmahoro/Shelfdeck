'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const CONFIG_MODULE = path.resolve(__dirname, '..', 'tools', 'nas-ssh-config.js');

function loadWithMockHome(homeDir, extraEnv = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('SHELFDECK_NAS_') || key.startsWith('NAS_SSH_')) {
      delete env[key];
    }
  }
  env.HOME = homeDir;
  env.USERPROFILE = homeDir;
  Object.assign(env, extraEnv);

  const script = [
    "const mod = require(process.env.TEST_CONFIG_MODULE);",
    "const cfg = mod.loadNasSshConfig();",
    "process.stdout.write(JSON.stringify({",
    "  host: cfg.host,",
    "  port: cfg.port,",
    "  username: cfg.username,",
    "  keyText: cfg.privateKey ? cfg.privateKey.toString('utf8') : null,",
    "  password: cfg.password || null,",
    "}));",
  ].join('\n');

  return spawnSync(process.execPath, ['-e', script], {
    env: { ...env, TEST_CONFIG_MODULE: CONFIG_MODULE },
    encoding: 'utf8',
    timeout: 10000,
  });
}

function makeTempHome(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-ssh-config-'));
  const sshDir = path.join(dir, '.ssh');
  fs.mkdirSync(sshDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(sshDir, name), content, 'utf8');
  }
  return dir;
}

test('nas-ssh-config prefers worker-dev-lan-ed25519 over shelfdeck-heavy and legacy keys', () => {
  const home = makeTempHome({
    'worker-dev-lan-ed25519': 'key-worker-dev-lan',
    'shelfdeck-heavy': 'key-shelfdeck-heavy',
    'shelfdeck-gezhu2403': 'key-legacy-workstation',
  });
  try {
    const res = loadWithMockHome(home);
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.host, '192.168.12.215');
    assert.equal(parsed.port, 22);
    assert.equal(parsed.username, 'gezhu');
    assert.equal(parsed.keyText, 'key-worker-dev-lan');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('nas-ssh-config falls back to shelfdeck-heavy when worker-dev-lan-ed25519 is absent', () => {
  const home = makeTempHome({
    'shelfdeck-heavy': 'key-shelfdeck-heavy',
    'shelfdeck-gezhu2403': 'key-legacy-workstation',
  });
  try {
    const res = loadWithMockHome(home);
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.keyText, 'key-shelfdeck-heavy');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('nas-ssh-config preserves legacy fallback to shelfdeck-gezhu2403', () => {
  const home = makeTempHome({
    'shelfdeck-gezhu2403': 'key-legacy-workstation',
  });
  try {
    const res = loadWithMockHome(home);
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.keyText, 'key-legacy-workstation');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('nas-ssh-config honors explicit SHELFDECK_NAS_KEY override over default keys', () => {
  const home = makeTempHome({
    'worker-dev-lan-ed25519': 'key-worker-dev-lan',
    'custom-override': 'key-explicit-override',
  });
  try {
    const overridePath = path.join(home, '.ssh', 'custom-override');
    const res = loadWithMockHome(home, { SHELFDECK_NAS_KEY: overridePath });
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.keyText, 'key-explicit-override');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('nas-ssh-config throws when neither an SSH key nor a password is available', () => {
  const home = makeTempHome({});
  try {
    const res = loadWithMockHome(home);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /NAS SSH key or password is required/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
