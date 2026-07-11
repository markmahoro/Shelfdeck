'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const cleanState = require('../src/helixCleanState');
const { assertRuntimeReady } = require('../src/helixRuntimePreflight');
const { buildApp } = require('../src/app');

test('clean startup does not recreate mixed media_items state', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-clean-startup-'));
  cleanState.applyCleanInit({
    dataDir,
    confirmation: cleanState.APPLY_CONFIRMATION,
  });
  assert.doesNotThrow(() => assertRuntimeReady({ dataDir }));

  const app = await buildApp({ logger: false, dataDir, apiKey: '' });

  const invalidTarget = await app.inject({
    method: 'POST',
    url: '/v1/tasks',
    payload: { subjectId: 'item-1', targetGate: 'archive' },
  });
  assert.strictEqual(invalidTarget.statusCode, 404);

  const removedCandidates = await app.inject({ method: 'GET', url: '/v1/admin/delete-candidates' });
  assert.strictEqual(removedCandidates.statusCode, 404);
  const removedScan = await app.inject({ method: 'POST', url: '/v1/admin/sublibraries/lib-1/actions/scan' });
  assert.strictEqual(removedScan.statusCode, 404);
  const legacyAutomation = await app.inject({
    method: 'POST',
    url: '/v1/admin/sublibraries',
    payload: { name: 'Legacy', automationMode: 'auto' },
  });
  assert.strictEqual(legacyAutomation.statusCode, 400);
  assert.strictEqual(legacyAutomation.json().error.code, 'HELIX_CLEAN_INIT_REQUIRED');

  await app.close();

  const libraryPath = path.join(dataDir, 'library.db');
  const tables = fs.existsSync(libraryPath)
    ? (() => {
      const db = new Database(libraryPath, { readonly: true });
      const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
      db.close();
      return names;
    })()
    : [];
  assert.strictEqual(tables.includes('media_items'), false);
  assert.strictEqual(tables.includes('nexora_memberships'), false);
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch (_) {
    // SQLite stores keep process-level handles until their test reset/exit.
  }
});
