'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const adultDataModel = require('../src/adultDataModel');
const adultColdArtifactStore = require('../src/adultColdArtifactStore');

test('adult data model keeps only Kairox light metadata in the hot projection', () => {
  const projected = adultDataModel.projectLightAdultMetadata({
    adultId: 'MVSD-175',
    title: 'Example',
    originalTitle: 'Original Example',
    actors: ['Actor A'],
    studio: 'Studio',
    series: 'Series',
    premiered: '2026-01-01',
    region: 'japanese_jav',
    scrapeStatus: 'done',
    reviewStatus: 'approved',
    idConfidence: 'high',
    scraperType: 'western_builtin',
    source: 'western_builtin',
    sourceUrl: '',
    protagonist: {
      personId: 'person-1',
      name: 'Actor A',
      adultId: 'AAA-001',
      embedding: [0.1, 0.2],
      sampleImageBase64: 'not-hot',
    },
    posterPath: '/library/poster.jpg',
    fanartPath: '/library/fanart.jpg',
    nfoPath: '/library/movie.nfo',
    fileNfoPath: '/library/AAA-001.nfo',
    markerPath: '/library/.shelfdeck.json',
    organized: true,
    originalFolder: '/library/raw',
    scrapedAt: '2026-07-01T00:00:00.000Z',
    scrapeError: '',
    scrapeFailedAt: null,
    scrapeVerification: {
      ok: true,
      checkedAt: '2026-07-01T00:00:00.000Z',
      warnings: [{ code: 'minor' }],
      internalPayload: 'not-copied',
    },
    faceClusters: [{ clusterId: 'face-1', embedding: [1, 2, 3] }],
    unknownFaces: [{ sampleImageBase64: 'face' }],
    galleryImages: [{ imageBase64: 'gallery' }],
    posterImageBase64: 'poster',
    ai: { prompt: 'large intermediate output' },
  });

  assert.deepStrictEqual(Object.keys(projected).sort(), [...adultDataModel.LIGHT_ADULT_METADATA_KEYS].sort());
  assert.deepStrictEqual(projected.protagonist, {
    personId: 'person-1',
    name: 'Actor A',
    adultId: 'AAA-001',
  });
  assert.strictEqual(projected.faceClusters, undefined);
  assert.strictEqual(projected.unknownFaces, undefined);
  assert.strictEqual(projected.galleryImages, undefined);
  assert.strictEqual(projected.posterImageBase64, undefined);
  assert.strictEqual(projected.ai, undefined);
  assert.strictEqual(adultDataModel.hasColdAdultArtifacts(projected), false);
});

test('adult data model identifies cold AI artifacts and image payload fields', () => {
  const paths = adultDataModel.collectColdAdultArtifactPaths({
    faceClusters: [{ embedding: [0.1], sampleImageBase64: 'face' }],
    unknownFaces: [{ imageBase64: 'unknown' }],
    galleryImages: [{ imageBase64: 'gallery' }],
    posterImageBase64: 'poster',
    fanartImageBase64: 'fanart',
    ai: { request: { prompt: 'large' } },
    scene: { transcript: 'intermediate' },
    safetyFlags: { maybe: true },
  });

  assert.ok(paths.includes('faceClusters'));
  assert.ok(paths.includes('faceClusters[0].embedding'));
  assert.ok(paths.includes('faceClusters[0].sampleImageBase64'));
  assert.ok(paths.includes('unknownFaces'));
  assert.ok(paths.includes('unknownFaces[0].imageBase64'));
  assert.ok(paths.includes('galleryImages'));
  assert.ok(paths.includes('posterImageBase64'));
  assert.ok(paths.includes('fanartImageBase64'));
  assert.ok(paths.includes('ai'));
  assert.ok(paths.includes('scene'));
  assert.ok(paths.includes('safetyFlags'));
});

test('adult cold artifact store persists cold fields outside hot metadata', () => {
  const oldDataDir = process.env.MEDIA_SERVICE_DATA_DIR;
  const oldControlPlaneDir = process.env.CONTROL_PLANE_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adult-cold-artifacts-'));
  process.env.MEDIA_SERVICE_DATA_DIR = dir;
  delete process.env.CONTROL_PLANE_DATA_DIR;
  try {
    const split = adultColdArtifactStore.splitAndPersistAdultMetadata('adult:item:1', {
      adultId: 'UNK-001',
      title: 'Needs Review',
      region: 'western_adult',
      scrapeStatus: 'needs_review',
      reviewStatus: 'needs_review',
      unknownFaces: [{ clusterId: 'u1', embedding: [0.1], sampleImageBase64: 'face' }],
      galleryImages: [{ imageBase64: 'gallery' }],
      ai: { model: 'local' },
    });

    assert.deepStrictEqual(split.adultMetadata, {
      adultId: 'UNK-001',
      title: 'Needs Review',
      region: 'western_adult',
      scrapeStatus: 'needs_review',
      reviewStatus: 'needs_review',
    });
    assert.strictEqual(adultDataModel.hasColdAdultArtifacts(split.adultMetadata), false);
    assert.deepStrictEqual(split.coldArtifactKeys.sort(), ['ai', 'galleryImages', 'unknownFaces']);

    const record = adultColdArtifactStore.loadArtifacts('adult:item:1');
    assert.deepStrictEqual(record.artifacts.unknownFaces[0].embedding, [0.1]);
    assert.strictEqual(record.artifacts.unknownFaces[0].sampleImageBase64, 'face');
    assert.strictEqual(record.artifacts.galleryImages[0].imageBase64, 'gallery');
    assert.strictEqual(record.artifacts.ai.model, 'local');
  } finally {
    if (oldDataDir === undefined) delete process.env.MEDIA_SERVICE_DATA_DIR;
    else process.env.MEDIA_SERVICE_DATA_DIR = oldDataDir;
    if (oldControlPlaneDir === undefined) delete process.env.CONTROL_PLANE_DATA_DIR;
    else process.env.CONTROL_PLANE_DATA_DIR = oldControlPlaneDir;
  }
});
