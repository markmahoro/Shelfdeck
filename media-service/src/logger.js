'use strict';

/**
 * Persistent rotating log file (data/shelfdeck.log).
 * Intercepts console.log / console.error so all output is also written to disk.
 * Max 5 MB — older entries are trimmed from the head.
 */

const fs = require('fs');
const path = require('path');

function dataDir() {
  return process.env.MEDIA_SERVICE_DATA_DIR || process.env.CONTROL_PLANE_DATA_DIR || path.join(__dirname, '..', 'data');
}

const LOG_PATH = path.join(dataDir(), 'shelfdeck.log');
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

let stream = null;

function ensureStream() {
  if (stream) return;
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  } catch { /* ignore */ }
  stream = fs.createWriteStream(LOG_PATH, { flags: 'a' });
}

function formatLog(level, args) {
  const ts = new Date().toISOString();
  const msg = args.map((a) => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
  return `[${ts}] [${level}] ${msg}\n`;
}

function rotateIfNeeded() {
  try {
    const stat = fs.statSync(LOG_PATH);
    if (stat.size > MAX_BYTES) {
      const content = fs.readFileSync(LOG_PATH, 'utf8');
      // Keep the last ~half of the content
      const keep = content.slice(Math.floor(content.length / 2));
      // Find the first complete line boundary
      const idx = keep.indexOf('\n');
      fs.writeFileSync(LOG_PATH, idx >= 0 ? keep.slice(idx + 1) : '', 'utf8');
    }
  } catch { /* ignore */ }
}

function write(level, args) {
  ensureStream();
  const line = formatLog(level, args);
  stream.write(line);
  // Rotate every ~100 writes to keep disk I/O low
  if (Math.random() < 0.01) rotateIfNeeded();
}

// ── Intercept console ──────────────────────────────────────────────────────────

const _log = console.log.bind(console);
const _error = console.error.bind(console);

console.log = function (...args) {
  _log(...args);
  try { write('INFO', args); } catch { /* never crash on log failure */ }
};

console.error = function (...args) {
  _error(...args);
  try { write('ERROR', args); } catch { /* never crash on log failure */ }
};

// ── Read (for admin API) ──────────────────────────────────────────────────────

function tail(lines) {
  try {
    if (!fs.existsSync(LOG_PATH)) return '';
    const content = fs.readFileSync(LOG_PATH, 'utf8');
    const allLines = content.split('\n').filter(Boolean);
    const n = Math.min(lines || 500, allLines.length);
    return allLines.slice(-n).join('\n');
  } catch {
    return '';
  }
}

module.exports = { tail, LOG_PATH };
