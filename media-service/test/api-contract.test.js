'use strict';

/**
 * Tier 1 — Service API Contract Tests
 *
 * 补充 api-inject.test.js 未覆盖的 desktop 端点的合约测试。
 * 使用 Fastify inject（不启动真实端口，无网络依赖）。
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { buildApp } = require('../src/app');
const diagnosticLog = require('../src/diagnosticLog');

// ── Helpers ──────────────────────────────────────────────────────────────────────

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'ct-test-')); }

function buildEmptyApp(apiKey) {
  const dir = tempDir();
  return buildApp({ logger: false, dataDir: dir, apiKey: apiKey || '' });
}

// ── Library: queries/manage ──────────────────────────────────────────────────────

test('GET /v1/library/queries/manage returns { items, total }', async () => {
  const app = await buildEmptyApp();
  const res = await app.inject({ method: 'GET', url: '/v1/library/queries/manage' });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.ok(Array.isArray(body.items), 'items is array');
  assert.strictEqual(typeof body.total, 'number', 'total is number');
  await app.close();
});

test('GET /v1/library/queries/manage filters by source', async () => {
  const app = await buildEmptyApp();
  const res = await app.inject({ method: 'GET', url: '/v1/library/queries/manage?source=emby' });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  for (const item of body.items) {
    assert.strictEqual(item.source, 'emby');
  }
  await app.close();
});

test('GET /v1/library/queries/manage filters by action', async () => {
  const app = await buildEmptyApp();
  const res = await app.inject({ method: 'GET', url: '/v1/library/queries/manage?action=keep' });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  for (const item of body.items) {
    assert.strictEqual(item.action, 'keep');
  }
  await app.close();
});

test('GET /v1/library/queries/manage filters adult pending scrape items', async () => {
  const app = await buildEmptyApp();
  const mediaLibraryService = require('../src/mediaLibraryService');
  mediaLibraryService.saveLibrary({
    version: 1,
    cachedAt: new Date().toISOString(),
    items: [{
      itemId: 'adult-pending-empty-status',
      subLibraryId: 'adult-lib',
      name: 'Adult Pending Empty Status',
      source: 'adult_folder',
      type: 'movie',
      action: 'keep',
      scraped: false,
      path: '/adult/pending.mp4',
      adultMetadata: { scrapeStatus: '' },
    }],
  });

  const res = await app.inject({ method: 'GET', url: '/v1/library/queries/manage?scrape=pending&page=1&pageSize=10' });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.strictEqual(body.total, 1);
  assert.strictEqual(body.items[0].itemId, 'adult-pending-empty-status');
  await app.close();
});

// ── Library: items/:itemId ───────────────────────────────────────────────────────

test('GET /v1/library/items/:itemId returns 404 for unknown item', async () => {
  const app = await buildEmptyApp();
  const res = await app.inject({ method: 'GET', url: '/v1/library/items/nonexistent-id' });
  assert.strictEqual(res.statusCode, 404);
  await app.close();
});

test('GET /v1/library/items/:itemId returns item after cache write', async () => {
  const dir = tempDir();
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  // Write an item via cache endpoint
  await app.inject({
    method: 'POST',
    url: '/v1/library/cache',
    payload: {
      subLibraryId: 'sublib-test',
      items: [{ sourceId: 'emby-item-x', name: 'Test Movie', type: 'Movie', path: '/m/test.mkv', bitrate: 10000000, duration: 3600, resolution: '1920x1080', size: 5000000000, premiereDate: '2025-01-01', genres: ['Action'], isDiscLike: false }],
    },
  });
  // Now query it
  const items = await app.inject({ method: 'GET', url: '/v1/library/queries/manage?subLibraryId=sublib-test' });
  const found = items.json().items.find((i) => i.sourceId === 'emby-item-x');
  assert.ok(found, 'item should exist after cache write');
  if (found) {
    const res = await app.inject({ method: 'GET', url: `/v1/library/items/${found.itemId}` });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.json().name, 'Test Movie');
  }
  await app.close();
});

// ── Library: ratings ─────────────────────────────────────────────────────────────

test('PATCH /v1/library/ratings missing itemId -> 400', async () => {
  const app = await buildEmptyApp();
  const res = await app.inject({ method: 'PATCH', url: '/v1/library/ratings', payload: { userRating: 4 } });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.json().error.code, 'VALIDATION_ERROR');
  await app.close();
});

test('PATCH /v1/library/ratings userRating out of range -> 400', async () => {
  const app = await buildEmptyApp();
  const res = await app.inject({ method: 'PATCH', url: '/v1/library/ratings', payload: { itemId: 'x', userRating: 0 } });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.json().error.code, 'VALIDATION_ERROR');
  await app.close();
});

test('PATCH /v1/library/ratings userRating > 5 -> 400', async () => {
  const app = await buildEmptyApp();
  const res = await app.inject({ method: 'PATCH', url: '/v1/library/ratings', payload: { itemId: 'x', userRating: 6 } });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.json().error.code, 'VALIDATION_ERROR');
  await app.close();
});

test('PATCH /v1/library/ratings writes userRating and returns ok', async () => {
  const dir = tempDir();
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  // First cache an item
  await app.inject({
    method: 'POST',
    url: '/v1/library/cache',
    payload: {
      subLibraryId: 'sublib-rating',
      items: [{ sourceId: 'emby-rate-1', name: 'Rating Test', type: 'Movie', path: '/m/r.mkv', bitrate: 15000000, duration: 5400, resolution: '1920x1080', size: 8000000000, premiereDate: '2024-06-01', genres: ['Drama'], isDiscLike: false }],
    },
  });
  // Find its itemId
  const items = await app.inject({ method: 'GET', url: '/v1/library/queries/manage?subLibraryId=sublib-rating' });
  const found = items.json().items.find((i) => i.sourceId === 'emby-rate-1');
  assert.ok(found, 'item should exist');
  // Write rating
  const res = await app.inject({ method: 'PATCH', url: '/v1/library/ratings', payload: { itemId: found.itemId, userRating: 4 } });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.json().ok, true);
  // Verify persisted
  const after = await app.inject({ method: 'GET', url: `/v1/library/items/${found.itemId}` });
  assert.strictEqual(after.json().userRating, 4);
  const clear = await app.inject({ method: 'PATCH', url: '/v1/library/ratings', payload: { itemId: found.itemId, userRating: null } });
  assert.strictEqual(clear.statusCode, 200);
  assert.strictEqual(clear.json().ok, true);
  const cleared = await app.inject({ method: 'GET', url: `/v1/library/items/${found.itemId}` });
  assert.strictEqual(cleared.json().userRating, null);
  await app.close();
});

// ── Library: actions/refresh ─────────────────────────────────────────────────────

test('POST /v1/library/actions/refresh missing subLibraryId -> 400', async () => {
  const app = await buildEmptyApp();
  const res = await app.inject({ method: 'POST', url: '/v1/library/actions/refresh', payload: {} });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.json().error.code, 'VALIDATION_ERROR');
  await app.close();
});

test('POST /v1/library/actions/refresh valid returns 202 Accepted', async () => {
  // Refresh is async; the route returns 202 immediately.
  // Unknown subLibraryId failure surfaces asynchronously (not in HTTP response).
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ subLibraries: [{ uuid: 'sublib-rf', name: 'R', embyServerId: 'srv', sectionId: 'sec', enabled: true }] }));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const res = await app.inject({ method: 'POST', url: '/v1/library/actions/refresh', payload: { subLibraryId: 'sublib-rf' } });
  assert.strictEqual(res.statusCode, 202);
  await app.close();
});

// ── Library: status ──────────────────────────────────────────────────────────────

test('GET /v1/library/status returns subLibraries array', async () => {
  const app = await buildEmptyApp();
  const res = await app.inject({ method: 'GET', url: '/v1/library/status' });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.subLibraries, 'subLibraries present');
  assert.ok(Array.isArray(body.subLibraries), 'subLibraries is array');
  await app.close();
});

// ── Library: cache ───────────────────────────────────────────────────────────────

test('POST /v1/library/cache upserts items and returns counts', async () => {
  const app = await buildEmptyApp();
  const payload = {
    subLibraryId: 'sublib-cache-1',
    items: [
      { sourceId: 'src-1', name: 'Movie A', type: 'Movie', path: '/m/a.mkv', bitrate: 10000000, duration: 3600, resolution: '1920x1080', size: 4000000000, premiereDate: '2025-01-01', genres: ['Action'], isDiscLike: false },
      { sourceId: 'src-2', name: 'Movie B', type: 'Movie', path: '/m/b.mkv', bitrate: 12000000, duration: 7200, resolution: '1920x1080', size: 5000000000, premiereDate: '2025-02-01', genres: ['Comedy'], isDiscLike: false },
    ],
  };
  const res = await app.inject({ method: 'POST', url: '/v1/library/cache', payload });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.upserted, 2);
  // Verify items appear in library
  const lib = await app.inject({ method: 'GET', url: '/v1/library/queries/manage?subLibraryId=sublib-cache-1' });
  assert.strictEqual(lib.json().total, 2);
  await app.close();
});

test('GET /v1/library supports server-side pagination and search', async () => {
  const app = await buildEmptyApp();
  await app.inject({
    method: 'POST',
    url: '/v1/library/cache',
    payload: {
      subLibraryId: 'sublib-page',
      items: [
        { sourceId: 'src-1', name: 'Movie Alpha', type: 'Movie', path: '/m/a.mkv', bitrate: 10000000, duration: 3600, resolution: '1920x1080', size: 4000000000, premiereDate: '2025-01-01', genres: [], isDiscLike: false },
        { sourceId: 'src-2', name: 'Movie Beta', type: 'Movie', path: '/m/b.mkv', bitrate: 12000000, duration: 7200, resolution: '1920x1080', size: 5000000000, premiereDate: '2025-02-01', genres: [], isDiscLike: false },
        { sourceId: 'src-3', name: 'Movie Gamma', type: 'Movie', path: '/m/c.mkv', bitrate: 8000000, duration: 5400, resolution: '1920x1080', size: 3000000000, premiereDate: '2025-03-01', genres: [], isDiscLike: false },
      ],
    },
  });

  const res = await app.inject({ method: 'GET', url: '/v1/library?subLibraryId=sublib-page&search=Movie&limit=2&offset=1' });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.strictEqual(body.total, 3);
  assert.strictEqual(body.items.length, 2);
  assert.deepStrictEqual(body.items.map((it) => it.name), ['Movie Beta', 'Movie Gamma']);
  assert.strictEqual(body.offset, 1);
  assert.strictEqual(body.limit, 2);
  await app.close();
});

test('mediaLibraryService reuses library cache until file changes', async () => {
  const app = await buildEmptyApp();
  const mediaLibraryService = require('../src/mediaLibraryService');
  mediaLibraryService.saveLibrary({
    version: 1,
    cachedAt: new Date().toISOString(),
    items: [{ itemId: 'cache-1', name: 'Cached One', source: 'emby' }],
  });

  const first = mediaLibraryService.getLibrary();
  assert.strictEqual(first.total, 1);

  const originalReadFileSync = fs.readFileSync;
  try {
    fs.readFileSync = function patchedReadFileSync(file, ...args) {
      if (String(file).endsWith('library.json')) throw new Error('library.json should be served from cache');
      return originalReadFileSync.call(this, file, ...args);
    };
    const second = mediaLibraryService.getLibrary();
    assert.strictEqual(second.total, 1);
    assert.strictEqual(second.items[0].name, 'Cached One');

    mediaLibraryService.saveLibrary({
      version: 1,
      cachedAt: new Date().toISOString(),
      items: [{ itemId: 'cache-2', name: 'Cached Two', source: 'emby' }],
    });
    const third = mediaLibraryService.getLibrary();
    assert.strictEqual(third.total, 1);
    assert.strictEqual(third.items[0].name, 'Cached Two');
  } finally {
    fs.readFileSync = originalReadFileSync;
    await app.close();
  }
});

test('adultLibraryService ingest discovery reads through the shared media cache', async () => {
  const app = await buildEmptyApp();
  const mediaLibraryService = require('../src/mediaLibraryService');
  const adultLibraryService = require('../src/adultLibraryService');
  const watchRoot = tempDir();
  const mediaPath = path.join(watchRoot, 'Scene One.mp4');
  fs.writeFileSync(mediaPath, 'fake-media');

  mediaLibraryService.saveLibrary({
    version: 1,
    cachedAt: new Date().toISOString(),
    items: [{
      itemId: 'adult-cache-1',
      subLibraryId: 'adult-cache',
      name: 'Scene One',
      path: mediaPath,
      source: 'adult_folder',
      type: 'movie',
    }],
  });
  assert.strictEqual(mediaLibraryService.getLibrary().total, 1);

  const originalReadFileSync = fs.readFileSync;
  try {
    fs.readFileSync = function patchedReadFileSync(file, ...args) {
      if (String(file).endsWith('library.json')) throw new Error('adult library should use shared media cache');
      return originalReadFileSync.call(this, file, ...args);
    };
    const candidates = adultLibraryService.listIngestCandidates({
      subLibraries: [{
        uuid: 'adult-cache',
        name: 'Adult Cache',
        enabled: true,
        source: 'folder',
        mediaType: 'adult',
        adultRegion: 'western_adult',
        watchRoot,
      }],
      adultLibrary: { settleSeconds: 0 },
      smartTaskEnabledActions: ['ingest'],
    });
    assert.strictEqual(candidates.length, 0, 'already cached adult items are not rediscovered as ingest candidates');
  } finally {
    fs.readFileSync = originalReadFileSync;
    await app.close();
  }
});

test('libraryStore migrates library.json to SQLite and keeps the source JSON', async () => {
  const dir = tempDir();
  const legacy = {
    version: 1,
    cachedAt: '2026-06-28T00:00:00.000Z',
    items: [
      { itemId: 'legacy-1', subLibraryId: 'legacy-lib', name: 'Legacy Alpha', source: 'emby', type: 'movie', action: 'keep' },
      { itemId: 'legacy-2', subLibraryId: 'legacy-lib', name: 'Legacy Beta', source: 'emby', type: 'movie', action: 'transcode' },
    ],
  };
  fs.writeFileSync(path.join(dir, 'library.json'), JSON.stringify(legacy, null, 2), 'utf8');

  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const res = await app.inject({ method: 'GET', url: '/v1/library?subLibraryId=legacy-lib&limit=10' });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.strictEqual(body.total, 2);
  assert.deepStrictEqual(body.items.map((it) => it.itemId), ['legacy-1', 'legacy-2']);
  assert.ok(fs.existsSync(path.join(dir, 'library.db')), 'library.db should exist after migration');
  assert.ok(fs.existsSync(path.join(dir, 'library.json.migrated')), 'migration marker should exist');
  assert.ok(fs.existsSync(path.join(dir, 'library.json')), 'source library.json should be preserved');
  const marker = JSON.parse(fs.readFileSync(path.join(dir, 'library.json.migrated'), 'utf8'));
  assert.strictEqual(marker.count, 2);
  await app.close();
});

test('libraryStore replaces one subLibrary without touching other libraries', async () => {
  const dir = tempDir();
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const mediaLibraryService = require('../src/mediaLibraryService');
  const libraryStore = require('../src/libraryStore');

  mediaLibraryService.saveLibrary({
    version: 1,
    cachedAt: '2026-06-28T00:00:00.000Z',
    items: [
      { itemId: 'lib-a-1', subLibraryId: 'lib-a', name: 'Old A', source: 'emby', type: 'movie', action: 'keep' },
      { itemId: 'lib-b-1', subLibraryId: 'lib-b', name: 'Keep B', source: 'emby', type: 'movie', action: 'delete' },
    ],
  });

  libraryStore.replaceSubLibraryItems('lib-a', [
    { itemId: 'lib-a-2', subLibraryId: 'lib-a', name: 'New A', source: 'emby', type: 'movie', action: 'transcode' },
  ], { cachedAt: '2026-06-28T01:00:00.000Z' });

  assert.strictEqual(mediaLibraryService.getLibrary({ subLibraryId: 'lib-a' }).total, 1);
  assert.strictEqual(mediaLibraryService.getLibrary({ subLibraryId: 'lib-a' }).items[0].itemId, 'lib-a-2');
  assert.strictEqual(mediaLibraryService.getLibrary({ subLibraryId: 'lib-b' }).total, 1);
  assert.strictEqual(mediaLibraryService.getLibrary({ subLibraryId: 'lib-b' }).items[0].itemId, 'lib-b-1');
  await app.close();
});

test('libraryStore records skipped WAL checkpoint when WAL is below threshold', async () => {
  const dir = tempDir();
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const mediaLibraryService = require('../src/mediaLibraryService');
  const libraryStore = require('../src/libraryStore');
  diagnosticLog.resetForTests();

  mediaLibraryService.saveLibrary({
    version: 1,
    cachedAt: '2026-06-28T00:00:00.000Z',
    items: Array.from({ length: 200 }, (_, i) => ({
      itemId: `bulk-${i}`,
      subLibraryId: 'bulk-lib',
      name: `Bulk ${i}`,
      source: 'emby',
      type: 'movie',
      action: i % 2 === 0 ? 'transcode' : 'keep',
      payload: 'x'.repeat(2048),
    })),
  });
  libraryStore.replaceSubLibraryItems('bulk-lib', [
    { itemId: 'bulk-new', subLibraryId: 'bulk-lib', name: 'Bulk New', source: 'emby', type: 'movie', action: 'keep' },
  ], { cachedAt: '2026-06-28T01:00:00.000Z' });

  const checkpointLogs = diagnosticLog.list({ limit: 20 }).logs
    .filter((log) => log.scope === 'libraryStore.checkpointWal');
  assert.ok(checkpointLogs.some((log) => log.status === 'skipped'), 'below-threshold WAL checkpoint skip is recorded');
  assert.ok(checkpointLogs.some((log) => log.payload && log.payload.trigger === 'wal_below_threshold'));
  await app.close();
});

test('libraryStore updateItems updates only existing rows', async () => {
  const dir = tempDir();
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const mediaLibraryService = require('../src/mediaLibraryService');
  const libraryStore = require('../src/libraryStore');

  mediaLibraryService.saveLibrary({
    version: 1,
    cachedAt: '2026-06-28T00:00:00.000Z',
    items: [
      { itemId: 'update-a', subLibraryId: 'lib-a', name: 'A', source: 'emby', type: 'movie', action: 'keep' },
      { itemId: 'update-b', subLibraryId: 'lib-b', name: 'B', source: 'emby', type: 'movie', action: 'delete' },
    ],
  });

  const changed = mediaLibraryService.getLibraryItem('update-a');
  changed.action = 'transcode';
  const count = libraryStore.updateItems([changed, { itemId: 'missing-item', subLibraryId: 'lib-a', name: 'Missing' }]);

  assert.strictEqual(count, 1);
  assert.strictEqual(mediaLibraryService.getLibraryItem('update-a').action, 'transcode');
  assert.strictEqual(mediaLibraryService.getLibraryItem('update-b').action, 'delete');
  assert.strictEqual(mediaLibraryService.getLibrary().total, 2);
  await app.close();
});

test('POST /v1/library/cache removes stale items', async () => {
  const app = await buildEmptyApp();
  // First insert 2 items
  await app.inject({
    method: 'POST', url: '/v1/library/cache',
    payload: { subLibraryId: 'sublib-rm', items: [
      { sourceId: 'src-keep', name: 'Keep', type: 'Movie', path: '/m/k.mkv', bitrate: 10000000, duration: 3600, resolution: '1280x720', size: 2000000000, premiereDate: '2025-01-01', genres: [], isDiscLike: false },
      { sourceId: 'src-rm', name: 'Remove', type: 'Movie', path: '/m/r.mkv', bitrate: 5000000, duration: 1800, resolution: '640x480', size: 1000000000, premiereDate: '2024-01-01', genres: [], isDiscLike: false },
    ] },
  });
  // Second batch drops src-rm
  const res = await app.inject({
    method: 'POST', url: '/v1/library/cache',
    payload: { subLibraryId: 'sublib-rm', items: [
      { sourceId: 'src-keep', name: 'Keep', type: 'Movie', path: '/m/k.mkv', bitrate: 10000000, duration: 3600, resolution: '1280x720', size: 2000000000, premiereDate: '2025-01-01', genres: [], isDiscLike: false },
    ] },
  });
  assert.strictEqual(res.json().removed, 1);
  const lib = await app.inject({ method: 'GET', url: '/v1/library/queries/manage?subLibraryId=sublib-rm' });
  assert.strictEqual(lib.json().total, 1);
  await app.close();
});

test('GET /v1/space-stats uses lightweight SQLite rows', async () => {
  const dir = tempDir();
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const mediaLibraryService = require('../src/mediaLibraryService');
  const taskStore = require('../src/taskStore');

  mediaLibraryService.saveLibrary({
    version: 1,
    cachedAt: new Date().toISOString(),
    items: [
      { itemId: 'space-delete', subLibraryId: 'space-lib', name: 'Delete Me', size: 1000, action: 'delete' },
      { itemId: 'space-transcode', subLibraryId: 'space-lib', name: 'Shrink Me', size: 2000, bitrate: 10_000_000, equivalentBitrate: 10, targetBitrate: 5, action: 'transcode' },
      { itemId: 'space-upgrade', subLibraryId: 'space-lib', name: 'Grow Me', size: 3000, bitrate: 5_000_000, equivalentBitrate: 5, targetBitrate: 8, action: 'upgrade' },
    ],
  });
  taskStore.saveTasks([
    { id: 'space-task-1', itemId: 'space-transcode', actionType: 'transcode', status: 'done', verifyResult: { bytesSaved: 400 }, itemInfo: { originalSizeBytes: 2000 } },
    { id: 'space-task-2', itemId: 'space-upgrade', actionType: 'upgrade', status: 'done', upgradePreview: { oldFile: { size: 3000 }, newFile: { size: 5000 } } },
    { id: 'space-task-3', itemId: 'ignored-scrape', actionType: 'scrape', status: 'done', logs: [{ msg: 'not needed for space stats' }] },
  ]);

  const originalGetLibrary = mediaLibraryService.getLibrary;
  const originalLoadTasks = taskStore.loadTasks;
  try {
    mediaLibraryService.getLibrary = () => { throw new Error('space stats should not load full library'); };
    taskStore.loadTasks = () => { throw new Error('space stats should not load full task history'); };

    const res = await app.inject({ method: 'GET', url: '/v1/space-stats' });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.currentTotalBytes, 6000);
    assert.strictEqual(body.delete.expectedSavingsBytes, 1000);
    assert.strictEqual(body.transcode.expectedSavingsBytes, 1000);
    assert.strictEqual(body.transcode.realizedSavingsBytes, 400);
    assert.ok(Math.abs(body.upgrade.expectedIncreaseBytes - 1800) < 0.001);
    assert.strictEqual(body.upgrade.realizedIncreaseBytes, 2000);
    assert.strictEqual(body.subLibraries[0].itemCount, 3);
  } finally {
    mediaLibraryService.getLibrary = originalGetLibrary;
    taskStore.loadTasks = originalLoadTasks;
    await app.close();
  }
});

test('POST /v1/library/cache keeps stable ShelfDeck itemId when Emby Id changes', async () => {
  const app = await buildEmptyApp();
  const subLibraryId = 'sublib-stable-id';
  const discPath = '/volume1/Media/Film/Fight Club (1999)/Fight Club (1999) - x264 2Audio';
  const mkvPath = `${discPath}.mkv`;

  await app.inject({
    method: 'POST',
    url: '/v1/library/cache',
    payload: {
      subLibraryId,
      items: [
        {
          sourceId: 'emby-old-id',
          name: 'Fight Club',
          type: 'Movie',
          path: discPath,
          bitrate: 14000000,
          duration: 8348,
          resolution: '1920x1080',
          size: 15000000000,
          premiereDate: '1999-10-15',
          genres: [],
          isDiscLike: true,
        },
      ],
    },
  });

  const first = await app.inject({ method: 'GET', url: `/v1/library?subLibraryId=${subLibraryId}` });
  const firstItem = first.json().items[0];
  assert.ok(firstItem.itemId, 'ShelfDeck itemId should exist');
  assert.notStrictEqual(firstItem.itemId, 'emby-old-id', 'ShelfDeck itemId should not be the Emby Id for new items');

  const mediaLibraryService = require('../src/mediaLibraryService');
  const lib = mediaLibraryService.getLibrary();
  const stored = lib.items.find((it) => it.itemId === firstItem.itemId);
  stored.lastTranscodeDoneAt = '2026-06-23T02:21:55.016Z';
  mediaLibraryService.saveLibrary(lib);

  await app.inject({
    method: 'POST',
    url: '/v1/library/cache',
    payload: {
      subLibraryId,
      items: [
        {
          sourceId: 'emby-new-id',
          name: 'Fight Club',
          type: 'Movie',
          path: mkvPath,
          bitrate: 8700000,
          duration: 8348,
          resolution: '1920x1080',
          size: 9000000000,
          premiereDate: '1999-10-15',
          genres: [],
          isDiscLike: false,
        },
      ],
    },
  });

  const second = await app.inject({ method: 'GET', url: `/v1/library?subLibraryId=${subLibraryId}` });
  const body = second.json();
  assert.strictEqual(body.total, 1, 'Emby Id change should not create a new ShelfDeck item');
  assert.strictEqual(body.items[0].itemId, firstItem.itemId);
  assert.strictEqual(body.items[0].sourceId, 'emby-new-id');
  assert.strictEqual(body.items[0].externalRefs.emby.itemId, 'emby-new-id');
  assert.strictEqual(body.items[0].lastTranscodeDoneAt, '2026-06-23T02:21:55.016Z');

  await app.close();
});

// ── Library: mark-played / mark-unplayed (contract validation only, no Emby) ─────

test('POST /v1/library/actions/mark-played missing itemId -> 400', async () => {
  const app = await buildEmptyApp();
  const res = await app.inject({ method: 'POST', url: '/v1/library/actions/mark-played', payload: {} });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.json().error.code, 'VALIDATION_ERROR');
  await app.close();
});

test('POST /v1/library/actions/mark-unplayed missing itemId -> 400', async () => {
  const app = await buildEmptyApp();
  const res = await app.inject({ method: 'POST', url: '/v1/library/actions/mark-unplayed', payload: {} });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.json().error.code, 'VALIDATION_ERROR');
  await app.close();
});

// ── Library: queries/played / queries/unplayed (contract validation, no Emby) ─────

test('POST /v1/library/queries/played returns empty array without config', async () => {
  const app = await buildEmptyApp();
  const res = await app.inject({ method: 'POST', url: '/v1/library/queries/played', payload: {} });
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.json(), []);
  await app.close();
});

test('GET /v1/library/playback-log returns empty array without config', async () => {
  const app = await buildEmptyApp();
  const res = await app.inject({ method: 'GET', url: '/v1/library/playback-log' });
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.json(), []);
  await app.close();
});

test('POST /v1/library/queries/unplayed missing subLibraryId -> 404', async () => {
  const app = await buildEmptyApp();
  const res = await app.inject({ method: 'POST', url: '/v1/library/queries/unplayed', payload: {} });
  assert.strictEqual(res.statusCode, 404);
  await app.close();
});

// ── Douban ───────────────────────────────────────────────────────────────────────

test('GET /v1/integrations/douban/fetch/ratings missing subLibraryId -> 400', async () => {
  const app = await buildEmptyApp();
  const res = await app.inject({ method: 'GET', url: '/v1/integrations/douban/fetch/ratings' });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.json().error.code, 'VALIDATION_ERROR');
  await app.close();
});

// ── Tasks: confirm on wrong status ───────────────────────────────────────────────

test('PATCH /v1/tasks/:id confirm on non-awaiting status -> 409', async () => {
  // Per API.md §5.4: only awaiting_user_confirm tasks can be confirmed.
  const app = await buildEmptyApp();
  const create = await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'confirm-wrong-status', actionType: 'scrape' } });
  const { id } = create.json();
  // Task status is 'created' — confirm must return 409
  const res = await app.inject({ method: 'PATCH', url: `/v1/tasks/${id}`, payload: { confirmed: true } });
  assert.strictEqual(res.statusCode, 409);
  assert.strictEqual(res.json().error.code, 'TASK_ACTION_REJECTED');
  assert.strictEqual(res.json().error.message, 'not_awaiting_confirmation');
  assert.strictEqual(res.json().actionName, 'confirm');
  assert.strictEqual(res.json().action.enabled, false);
  assert.strictEqual(res.json().controlState.actions.confirm.reason, 'not_awaiting_confirmation');
  assert.strictEqual(res.json().task.id, id);
  await app.close();
});

// ── Tasks: itemId conflict ───────────────────────────────────────────────────────

test('POST /v1/tasks duplicate itemId (active task exists) -> 409', async () => {
  const app = await buildEmptyApp();
  const itemId = 'dup-item-' + crypto.randomUUID().slice(0, 8);
  const first = await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId, actionType: 'scrape' } });
  const res = await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId, actionType: 'delete' } });
  assert.strictEqual(res.statusCode, 409);
  assert.strictEqual(res.json().error.code, 'TASK_CONFLICT');
  assert.strictEqual(res.json().admission.reason, 'active_task_exists');
  assert.strictEqual(res.json().activeTask.id, first.json().id);
  assert.strictEqual(res.json().activeTask.itemId, itemId);
  assert.strictEqual(res.json().activeTask.taskBridge.kind, 'metadata');
  assert.strictEqual(res.json().activeTask.flowPlan.operationKind, 'scrape');
  assert.strictEqual(res.json().businessFlowDecision.blockedReasons.delete, 'active_task_exists');
  await app.close();
});

// ── Tasks: execute on pending_manual ─────────────────────────────────────────────

test('POST /v1/tasks/:id/actions/execute pending_manual -> queued', async () => {
  const dir = tempDir();
  // Write config with manual mode
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ executionMode: 'manual' }));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const create = await app.inject({ method: 'POST', url: '/v1/tasks', payload: { itemId: 'manual-exec', actionType: 'scrape' } });
  const { id } = create.json();
  assert.strictEqual(create.json().status, 'pending_manual');
  const res = await app.inject({ method: 'POST', url: `/v1/tasks/${id}/actions/execute` });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.json().status, 'queued');
  await app.close();
});

// ── Delete non-existent task ─────────────────────────────────────────────────────

test('DELETE /v1/tasks/nonexistent -> 404', async () => {
  const app = await buildEmptyApp();
  const res = await app.inject({ method: 'DELETE', url: '/v1/tasks/nonexistent-id' });
  assert.strictEqual(res.statusCode, 404);
  await app.close();
});

// ── Library: /v1/library also works as primary endpoint ──────────────────────────

test('GET /v1/library returns items with embyWebUrl when server configured', async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    embyServers: { 'srv-1': { baseUrl: 'http://192.168.1.1:8096', apiKey: 'k1', userId: 'u1' } },
    subLibraries: [{ uuid: 'sublib-web', name: 'Movies', embyServerId: 'srv-1', sectionId: 'sec-1', enabled: true, mediaPolicy: null }],
  }));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  // Insert item into this sublib
  await app.inject({
    method: 'POST', url: '/v1/library/cache',
    payload: { subLibraryId: 'sublib-web', items: [
      { sourceId: 'emby-web-1', name: 'Web Test', type: 'Movie', path: '/m/w.mkv', bitrate: 8000000, duration: 3600, resolution: '1920x1080', size: 3000000000, premiereDate: '2025-03-01', genres: [], isDiscLike: false },
    ] },
  });
  const res = await app.inject({ method: 'GET', url: '/v1/library?subLibraryId=sublib-web' });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.items.length > 0);
  const item = body.items[0];
  assert.ok(item.embyWebUrl, 'embyWebUrl should be present for server-configured items');
  assert.ok(item.embyWebUrl.includes('item?id='), 'embyWebUrl should contain item link');
  assert.ok(item.embyWebUrl.includes('item?id=emby-web-1'), 'embyWebUrl should use current Emby item id');
  await app.close();
});
