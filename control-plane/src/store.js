'use strict';

const fs = require('fs');
const path = require('path');

function defaultStatePath() {
  const root = process.env.CONTROL_PLANE_DATA_DIR || path.join(__dirname, '..', 'data');
  return path.join(root, 'control-plane-state.json');
}

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, obj) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 0), 'utf8');
  fs.renameSync(tmp, file);
}

class FileStore {
  constructor(filePath) {
    this.filePath = filePath || defaultStatePath();
    /** @type {{ kv: Record<string, string>, revisit: unknown[] }} */
    this.cache = readJson(this.filePath, { kv: {}, revisit: [] });
    if (!this.cache.kv) this.cache.kv = {};
    if (!Array.isArray(this.cache.revisit)) this.cache.revisit = [];
  }

  persist() {
    writeJsonAtomic(this.filePath, this.cache);
  }

  getKv(key) {
    return this.cache.kv[key] ?? null;
  }

  setKv(key, value) {
    this.cache.kv[key] = value;
    this.persist();
  }

  getJsonKey(key, fallback) {
    const s = this.getKv(key);
    if (!s) return fallback;
    try {
      return JSON.parse(s);
    } catch {
      return fallback;
    }
  }

  setJsonKey(key, obj) {
    this.setKv(key, JSON.stringify(obj));
  }

  listRevisit() {
    return this.cache.revisit;
  }

  addRevisit(entry) {
    this.cache.revisit.push(entry);
    this.persist();
  }

  deleteRevisit(id) {
    const before = this.cache.revisit.length;
    this.cache.revisit = this.cache.revisit.filter((e) => e && e.id !== id);
    if (this.cache.revisit.length !== before) this.persist();
  }
}

module.exports = { FileStore, defaultStatePath };
