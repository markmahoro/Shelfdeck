'use strict';

const fs = require('fs');
const path = require('path');

const CHECKLIST = path.join(__dirname, '..', 'tests', 'TEST_ENV_CHECKLIST.md');

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

function loadNasSshConfig(options = {}) {
  const checklist = readChecklist();
  const host = envValue(['SHELFDECK_NAS_HOST', 'NAS_SSH_HOST'])
    || tableValue(checklist, '飞牛 NAS IP')
    || '192.168.12.230';
  const portRaw = envValue(['SHELFDECK_NAS_PORT', 'NAS_SSH_PORT'])
    || tableValue(checklist, 'SSH 端口')
    || '22';
  const username = envValue(['SHELFDECK_NAS_USER', 'SHELFDECK_NAS_USERNAME', 'NAS_SSH_USER'])
    || tableValue(checklist, 'SSH 用户名');
  const password = envValue(['SHELFDECK_NAS_PASSWORD', 'NAS_SSH_PASSWORD'])
    || tableValue(checklist, 'SSH 密码');

  if (!username || !password) {
    throw new Error(
      'NAS SSH credentials are required. Set SHELFDECK_NAS_USER and SHELFDECK_NAS_PASSWORD, '
      + 'or fill tests/TEST_ENV_CHECKLIST.md.',
    );
  }

  return {
    host,
    port: Number(portRaw) || 22,
    username,
    password,
    readyTimeout: options.readyTimeout || 15000,
  };
}

module.exports = {
  loadNasSshConfig,
};
