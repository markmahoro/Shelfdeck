'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const { buildApp } = require('../src/app');
const libraryStore = require('../src/libraryStore');
const configStore = require('../src/configStore');

function buildArrayField(size, unit) {
  return Array.from({ length: size }, () => ({
    id: crypto.randomUUID().slice(0, 8),
    payload: 'x'.repeat(unit),
  }));
}

function baseAdultItem(overrides = {}) {
  const itemId = overrides.itemId || `adult-${crypto.randomUUID().slice(0, 8)}`;
  const item = {
    itemId,
    source: 'adult_folder',
    sourceId: itemId,
    name: `adult-${itemId}`,
    type: 'movie',
    path: `/media/${itemId}.mkv`,
    size: 1024 * 1024,
    duration: 1200,
    bitrate: 4000000,
    resolution: '1920x1080',
    codec: 'h264',
    watched: true,
    scraped: true,
    ...overrides,
  };
  return item;
}

function buildLargeAdultMetadata(overrides = {}) {
  return {
    region: 'japanese_jav',
    scrapeStatus: 'done',
    adultId: 'MVSD-175',
    title: 'Large Adult Item',
    faceClusters: buildArrayField(120, 48),
    unknownFaces: buildArrayField(80, 24),
    galleryImages: buildArrayField(60, 16),
    embedding: 'e'.repeat(60000),
    sampleImageBase64: 's'.repeat(120000),
    ...overrides,
  };
}

test('GET /v1/admin/dashboard/health does not run library payload diagnostics on the hot path', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-library-payload-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const mediaLibraryService = require('../src/mediaLibraryService');

  mediaLibraryService.saveLibrary({
    cachedAt: new Date().toISOString(),
    items: [
      baseAdultItem({
        itemId: 'adult-missing-metadata',
        adultMetadata: undefined,
      }),
      baseAdultItem({
        itemId: 'adult-large-payload',
        adultMetadata: buildLargeAdultMetadata(),
      }),
      baseAdultItem({
        itemId: 'normal-emby',
        source: 'emby',
        sourceId: 'normal-emby',
        adultMetadata: undefined,
        path: '/media/normal-emby.mkv',
      }),
    ],
  });

  const res = await app.inject({ method: 'GET', url: '/v1/admin/dashboard/health' });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();

  const payloadSummary = body?.diagnostics?.payloadSummary;
  assert.strictEqual(payloadSummary, undefined, 'dashboard must stay on lightweight service health diagnostics');

  const storeSummary = libraryStore.getLibraryPayloadHealthSummary();
  assert.ok(storeSummary.bySource.length >= 2);
  assert.strictEqual(storeSummary.adultLibraryCache.totalAdultItems, 2);
  assert.strictEqual(storeSummary.adultLibraryCache.status, 'partial');
  await app.close();
});

test('GET /v1/admin/resources?detail=full exposes payload summary and adult cache missing state', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-resource-payload-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const mediaLibraryService = require('../src/mediaLibraryService');

  mediaLibraryService.saveLibrary({
    cachedAt: new Date().toISOString(),
    items: [
      baseAdultItem({
        itemId: 'adult-cache-missing-a',
        name: 'adult-cache-missing-a',
        adultMetadata: undefined,
      }),
      baseAdultItem({
        itemId: 'adult-cache-missing-b',
        name: 'adult-cache-missing-b',
        adultMetadata: undefined,
      }),
      baseAdultItem({
        itemId: 'emby-normal',
        source: 'emby',
        sourceId: 'emby-normal',
        name: 'emby-normal',
        path: '/media/emby-normal.mkv',
        adultMetadata: undefined,
      }),
    ],
  });

  const res = await app.inject({ method: 'GET', url: '/v1/admin/resources?detail=full' });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  const payloadSummary = body?.diagnostics?.payloadSummary;
  assert.ok(payloadSummary, 'resource diagnostics payload summary should exist');
  assert.ok(payloadSummary.payloadBytesTotal > 0);
  assert.ok(body?.diagnostics?.metrics?.storage?.length >= 2, 'storage metrics should remain in full detail');
  assert.strictEqual(payloadSummary.adultLibraryCache.status, 'missing');
  assert.strictEqual(payloadSummary.adultLibraryCache.totalAdultItems, 2);
  assert.strictEqual(payloadSummary.adultLibraryCache.cachedAdultItems, 0);
  await app.close();
});

test('configured adult libraries with no cache rows are reported as missing without rebuilding cache', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-configured-adult-missing-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const mediaLibraryService = require('../src/mediaLibraryService');

  configStore.saveConfig({
    ...configStore.getDefaultConfig(),
    subLibraries: [
      {
        uuid: 'adult-configured-only',
        name: 'US',
        enabled: true,
        source: 'folder',
        mediaType: 'adult',
        adultRegion: 'western_adult',
        watchRoot: '/adult_media/US',
      },
    ],
  });
  mediaLibraryService.saveLibrary({
    cachedAt: new Date().toISOString(),
    items: [
      baseAdultItem({
        itemId: 'emby-only',
        source: 'emby',
        sourceId: 'emby-only',
        adultMetadata: undefined,
        path: '/media/emby-only.mkv',
      }),
    ],
  });

  const summaryRes = await app.inject({ method: 'GET', url: '/v1/admin/resources?detail=summary' });
  assert.strictEqual(summaryRes.statusCode, 200);
  assert.strictEqual(summaryRes.json()?.diagnostics?.payloadSummary, undefined, 'summary projection should not scan payload_json');

  const res = await app.inject({ method: 'GET', url: '/v1/admin/resources?detail=full' });
  assert.strictEqual(res.statusCode, 200);
  const payloadSummary = res.json()?.diagnostics?.payloadSummary;
  assert.ok(payloadSummary, 'full diagnostics payload summary should exist');
  assert.strictEqual(payloadSummary.adultLibraryCache.expectedAdultSubLibraryCount, 1);
  assert.strictEqual(payloadSummary.adultLibraryCache.totalAdultItems, 0);
  assert.strictEqual(payloadSummary.adultLibraryCache.status, 'missing');
  assert.strictEqual(libraryStore.getLibraryPayloadHealthSummary({ adultSubLibraryIds: ['adult-configured-only'] }).adultLibraryCache.status, 'missing');
  await app.close();
});

test('libraryStore.getLibraryPayloadHealthSummary supports compact mode for non-admin pages', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-library-payload-compact-'));
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  const mediaLibraryService = require('../src/mediaLibraryService');

  mediaLibraryService.saveLibrary({
    cachedAt: new Date().toISOString(),
    items: [
      baseAdultItem({
        itemId: 'adult-compact',
        adultMetadata: buildLargeAdultMetadata(),
      }),
    ],
  });

  const storeSummary = libraryStore.getLibraryPayloadHealthSummary({ includeBuckets: false, includeFieldBreakdown: false });
  assert.strictEqual(storeSummary.mediaItemCount, 1);
  assert.strictEqual(storeSummary.bySource.length, 0, 'compact mode should skip bucket breakdown by source');
  assert.strictEqual(storeSummary.byType.length, 0, 'compact mode should skip bucket breakdown by type');
  assert.strictEqual(storeSummary.bySubLibrary.length, 0, 'compact mode should skip bucket breakdown by subLibrary');
  assert.strictEqual(storeSummary.maxPayload.payloadBytes, 0, 'compact mode disables per-row field decomposition');
  assert.ok(storeSummary.adultLibraryCache.status === 'complete');
  await app.close();
});
