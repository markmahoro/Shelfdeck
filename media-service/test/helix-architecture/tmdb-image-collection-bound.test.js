'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  TMDB_IMAGE_COLLECTION_MAX,
  selectTmdbImage,
} = require('../../src/helix/contracts/tmdb-image-selection');
const {
  TmdbProviderAdapterError,
  validateImagesResponse,
} = require('../../src/helix/integrations/tmdb-provider-adapter');

function posters(count, options = {}) {
  return Array.from({ length: count }, (_item, index) => ({
    file_path: `/poster${String(index).padStart(4, '0')}.jpg`,
    width: options.landscape ? 1920 : 1000,
    height: options.landscape ? 1080 : 1500,
    vote_average: index === 0 ? 9 : 1,
    iso_639_1: index === 0 ? 'zh' : null,
  }));
}

test('TMDB image collection bound admits Game-of-Thrones-sized poster sets', () => {
  assert.equal(TMDB_IMAGE_COLLECTION_MAX, 2048);
  // Production TV 1399 currently returns 519 posters across languages; the
  // previous 512 cap rejected the exact Provider set before selection.
  const gotSized = {
    id: 1399,
    posters: posters(519),
    backdrops: posters(260, { landscape: true }),
    logos: posters(73),
  };
  assert.doesNotThrow(() => validateImagesResponse(gotSized));
  const selected = selectTmdbImage(gotSized.posters, {
    artifactKind: 'poster',
    language: 'zh-CN',
    originalLanguage: 'en',
  });
  assert.equal(selected.file_path, '/poster0000.jpg');
  assert.equal(selected.iso_639_1, 'zh');
});

test('TMDB image collection bound still rejects oversized Provider sets', () => {
  const oversized = {
    id: 1399,
    posters: posters(TMDB_IMAGE_COLLECTION_MAX + 1),
    backdrops: [],
  };
  assert.throws(
    () => validateImagesResponse(oversized),
    (error) => error instanceof TmdbProviderAdapterError &&
      error.code === 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
  );
  assert.throws(
    () => selectTmdbImage(oversized.posters, {
      artifactKind: 'poster',
      language: 'zh-CN',
    }),
    (error) => error instanceof TypeError,
  );
});
