'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const CHECKLIST = path.join(__dirname, '..', 'tests', 'TEST_ENV_CHECKLIST.md');
const DEFAULT_HOST = '192.168.12.230';
const DEFAULT_PORT = '22';
const DEFAULT_KEY_NAMES = ['gezhu_nas_health_it_ed25519', 'id_rsa_shelfdeck'];

function readChecklist() {
  try {
    return fs.readFileSync(CHECKLIST, 'utf8');
  } catch {
    return '';
  }
}

function tableValue(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\|\\s*\\d+\\s*\\|\\s*${escaped}\\s*\\|\\s*([^|]+?)\\s*\\|`);
  const match = text.match(re);
  return match ? match[1].trim() : '';
}

function envValue(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return '';
}

function expandPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw === '~') return os.homedir();
  if (raw.startsWith('~/') || raw.startsWith('~\\')) {
    return path.join(os.homedir(), raw.slice(2));
  }
  return raw;
}

function firstExistingFile(candidates) {
  for (const candidate of candidates) {
    const resolved = expandPath(candidate);
    if (!resolved) continue;
    try {
      if (fs.statSync(resolved).isFile()) return resolved;
    } catch {
      // try next
    }
  }
  return '';
}

function defaultKeyPath() {
  const sshDir = path.join(os.homedir(), '.ssh');
  return firstExistingFile(DEFAULT_KEY_NAMES.map((name) => path.join(sshDir, name)));
}

function loadNasSshConfig(options = {}) {
  const checklist = readChecklist();
  const host = envValue(['SHELFDECK_NAS_HOST', 'NAS_SSH_HOST'])
    || tableValue(checklist, '飞牛 NAS IP')
    || DEFAULT_HOST;
  const portRaw = envValue(['SHELFDECK_NAS_PORT', 'NAS_SSH_PORT'])
    || tableValue(checklist, 'SSH 端口')
    || DEFAULT_PORT;
  const username = envValue(['SHELFDECK_NAS_USER', 'SHELFDECK_NAS_USERNAME', 'NAS_SSH_USER'])
    || tableValue(checklist, 'SSH 用户名');
  const password = envValue(['SHELFDECK_NAS_PASSWORD', 'NAS_SSH_PASSWORD'])
    || tableValue(checklist, 'SSH 密码');
  const keyPath = firstExistingFile([
    envValue(['SHELFDECK_NAS_KEY', 'SHELFDECK_NAS_IDENTITY_FILE', 'NAS_SSH_KEY']),
    tableValue(checklist, 'SSH 私钥'),
    tableValue(checklist, 'SSH IdentityFile'),
    defaultKeyPath(),
  ]);
  const passphrase = envValue(['SHELFDECK_NAS_KEY_PASSPHRASE', 'NAS_SSH_KEY_PASSPHRASE']);

  if (!username) {
    throw new Error(
      'NAS SSH username is required. Set SHELFDECK_NAS_USER, or fill tests/TEST_ENV_CHECKLIST.md.',
    );
  }
  if (!keyPath && !password) {
    throw new Error(
      'NAS SSH key or password is required. Set SHELFDECK_NAS_KEY or SHELFDECK_NAS_PASSWORD, '
      + 'or fill tests/TEST_ENV_CHECKLIST.md.',
    );
  }

  const config = {
    host,
    port: Number(portRaw) || 22,
    username,
    readyTimeout: options.readyTimeout || 15000,
  };
  if (keyPath) {
    config.privateKey = fs.readFileSync(keyPath);
    if (passphrase) config.passphrase = passphrase;
  } else {
    config.password = password;
  }
  return config;
}

module.exports = {
  loadNasSshConfig,
};
