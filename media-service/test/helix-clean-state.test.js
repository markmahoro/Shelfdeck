'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const cleanState = require('../src/helixCleanState');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-helix-clean-'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function createLegacyLibraryDb(dataDir) {
  const db = new Database(path.join(dataDir, 'library.db'));
  db.exec('CREATE TABLE media_items (subject_id TEXT PRIMARY KEY); CREATE TABLE nexora_memberships (subject_id TEXT PRIMARY KEY);');
  db.close();
}

test('clean init dry-run detects legacy state without mutating files', () => {
  const dataDir = tempDir();
  writeJson(path.join(dataDir, 'config.json'), {
    apiKey: 'service-secret',
    automaticTaskTargets: ['metadata'],
    subLibraries: [{ uuid: 'legacy', automationMode: 'auto' }],
  });
  createLegacyLibraryDb(dataDir);
  fs.writeFileSync(path.join(dataDir, 'media-sample.mkv'), 'do-not-touch');

  const plan = cleanState.buildPlan({ dataDir, now: new Date('2026-07-10T00:00:00.000Z') });

  assert.strictEqual(plan.mode, 'dry-run');
  assert.strictEqual(plan.inspection.requiresCleanInit, true);
  assert.deepStrictEqual(plan.inspection.legacyTables.sort(), ['media_items', 'nexora_memberships']);
  assert.ok(plan.inspection.legacyConfigFields.includes('automaticTaskTargets'));
  assert.ok(plan.inspection.legacyConfigFields.includes('subLibraries[].automationMode'));
  assert.strictEqual(fs.existsSync(path.join(dataDir, 'library.db')), true);
  assert.strictEqual(fs.readFileSync(path.join(dataDir, 'media-sample.mkv'), 'utf8'), 'do-not-touch');
});

test('clean init apply requires explicit confirmation', () => {
  const dataDir = tempDir();
  assert.throws(
    () => cleanState.applyCleanInit({ dataDir }),
    (error) => error.code === 'HELIX_CLEAN_INIT_CONFIRMATION_REQUIRED',
  );
});

test('clean init apply creates the default backup parent', () => {
  const dataDir = tempDir();
  writeJson(path.join(dataDir, 'config.json'), { apiKey: 'key' });
  const result = cleanState.applyCleanInit({
    dataDir,
    confirmation: cleanState.APPLY_CONFIRMATION,
    now: new Date('2026-07-10T00:00:00.000Z'),
  });
  assert.strictEqual(fs.existsSync(result.backupDir), true);
  assert.strictEqual(fs.existsSync(path.join(result.backupDir, 'config.json')), true);
});

test('clean init apply backs up ShelfDeck state and preserves only deployment-managed config', () => {
  const dataDir = tempDir();
  const backupDir = path.join(dataDir, 'manual-backup');
  writeJson(path.join(dataDir, 'config.json'), {
    apiKey: 'service-secret',
    transcodeTempRoot: '/transcode',
    upgradeStagingLocalPath: '/upgrade',
    ffmpegPath: '/usr/bin/ffmpeg',
    ffprobePath: '/usr/bin/ffprobe',
    moviepilot: { baseUrl: 'http://private', apiKey: 'private', savePath: '/downloads' },
    embyServers: { production: { baseUrl: 'http://emby', accessToken: 'emby-token' } },
    subLibraries: [{ uuid: 'legacy-library' }],
    smartTaskMaxPerRun: 10,
  });
  createLegacyLibraryDb(dataDir);
  writeJson(path.join(dataDir, 'nodes.json'), [{ id: 'worker-1', apiKey: 'node-secret' }]);
  fs.writeFileSync(path.join(dataDir, 'media-sample.mkv'), 'do-not-touch');

  const result = cleanState.applyCleanInit({
    dataDir,
    backupDir,
    confirmation: cleanState.APPLY_CONFIRMATION,
    now: new Date('2026-07-10T01:02:03.000Z'),
  });

  assert.strictEqual(result.applied, true);
  assert.strictEqual(fs.existsSync(path.join(backupDir, 'library.db')), true);
  assert.strictEqual(fs.existsSync(path.join(backupDir, 'nodes.json')), true);
  assert.strictEqual(fs.existsSync(path.join(dataDir, 'library.db')), false);
  assert.strictEqual(fs.existsSync(path.join(dataDir, 'nodes.json')), false);
  assert.strictEqual(fs.readFileSync(path.join(dataDir, 'media-sample.mkv'), 'utf8'), 'do-not-touch');

  const config = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
  assert.strictEqual(config.helixSchemaVersion, cleanState.HELIX_SCHEMA_VERSION);
  assert.strictEqual(config.apiKey, 'service-secret');
  assert.strictEqual(config.transcodeTempRoot, undefined);
  assert.strictEqual(config.upgradeStagingLocalPath, undefined);
  assert.strictEqual(config.moviepilot, undefined);
  assert.strictEqual(config.embyServers, undefined);
  assert.strictEqual(config.subLibraries, undefined);
  assert.strictEqual(config.automaticTaskTargets, undefined);
  assert.strictEqual(config.smartTaskMaxPerRun, undefined);

  const inspection = cleanState.inspectState({ dataDir });
  assert.strictEqual(inspection.cleanMarkerCurrent, true);
  assert.strictEqual(inspection.requiresCleanInit, false);
  assert.doesNotThrow(() => cleanState.assertCleanState({ dataDir }));
});
