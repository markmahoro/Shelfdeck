'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const cleanState = require('../src/helixCleanState');
const { assertRuntimeReady } = require('../src/helixRuntimePreflight');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-runtime-preflight-'));
}

test('runtime preflight rejects an uninitialized data directory', () => {
  const dataDir = tempDir();
  assert.throws(
    () => assertRuntimeReady({ dataDir }),
    (error) => error.code === 'HELIX_CLEAN_INIT_REQUIRED',
  );
});

test('runtime preflight accepts only state produced by explicit clean init', () => {
  const dataDir = tempDir();
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ apiKey: 'secret' }), 'utf8');
  cleanState.applyCleanInit({
    dataDir,
    confirmation: cleanState.APPLY_CONFIRMATION,
    now: new Date('2026-07-10T00:00:00.000Z'),
  });
  const result = assertRuntimeReady({ dataDir });
  assert.strictEqual(result.inspection.cleanMarkerCurrent, true);
  assert.strictEqual(result.config.helixSchemaVersion, cleanState.HELIX_SCHEMA_VERSION);
});

test('runtime preflight rejects a clean marker paired with legacy config', () => {
  const dataDir = tempDir();
  cleanState.applyCleanInit({
    dataDir,
    confirmation: cleanState.APPLY_CONFIRMATION,
  });
  const configPath = path.join(dataDir, 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.smartTaskMaxPerRun = 10;
  fs.writeFileSync(configPath, JSON.stringify(config), 'utf8');
  assert.throws(
    () => assertRuntimeReady({ dataDir }),
    (error) => error.code === 'HELIX_CLEAN_INIT_REQUIRED',
  );
});

test('runtime preflight rejects a clean marker paired with a legacy task schema', () => {
  const dataDir = tempDir();
  cleanState.applyCleanInit({
    dataDir,
    confirmation: cleanState.APPLY_CONFIRMATION,
  });
  const db = new Database(path.join(dataDir, 'tasks.db'));
  db.exec('CREATE TABLE tasks (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL)');
  db.close();

  assert.throws(
    () => assertRuntimeReady({ dataDir }),
    (error) => error.code === 'HELIX_CLEAN_INIT_REQUIRED'
      && error.details.legacyTables.includes('tasks.schema'),
  );
});
