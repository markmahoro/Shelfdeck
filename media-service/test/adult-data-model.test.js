'use strict';

const test = require('node:test');
const assert = require('node:assert');

const adultDataModel = require('../src/adultDataModel');

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
    protagonist: {
      personId: 'person-1',
      name: 'Actor A',
      adultId: 'AAA-001',
      embedding: [0.1, 0.2],
      sampleImageBase64: 'not-hot',
    },
    posterPath: '/library/poster.jpg',
    nfoPath: '/library/movie.nfo',
    organized: true,
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
