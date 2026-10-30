'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  TMDB_IMAGE_COLLECTION_MAX,
  preferredLanguages,
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
    iso_639_1: index === 0 ? 'zh' : (index === 1 ? 'en' : 'de'),
  }));
}

test('TMDB image collection bound admits Game-of-Thrones-sized poster sets', () => {
  assert.equal(TMDB_IMAGE_COLLECTION_MAX, 2048);
  assert.deepEqual(preferredLanguages('zh-CN'), ['zh', 'en']);
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

test('poster and fanart selection prefer config language then en by votes inside the admitted set', () => {
  const items = [
    { file_path: '/de-top.jpg', iso_639_1: 'de', width: 1000, height: 1500, vote_average: 99 },
    { file_path: '/en-mid.jpg', iso_639_1: 'en', width: 1000, height: 1500, vote_average: 5 },
    { file_path: '/en-high.jpg', iso_639_1: 'en', width: 1000, height: 1500, vote_average: 8 },
    { file_path: '/zh-low.jpg', iso_639_1: 'zh', width: 1000, height: 1500, vote_average: 2 },
    { file_path: '/zh-high.jpg', iso_639_1: 'zh', width: 800, height: 1200, vote_average: 7 },
    { file_path: '/textless.jpg', iso_639_1: null, width: 1920, height: 1080, vote_average: 9 },
    { file_path: '/zh-wide.jpg', iso_639_1: 'zh', width: 1920, height: 1080, vote_average: 3 },
  ];
  assert.equal(
    selectTmdbImage(items, { artifactKind: 'poster', language: 'zh-CN' }).file_path,
    '/zh-high.jpg',
  );
  assert.equal(
    selectTmdbImage(items, { artifactKind: 'poster', language: 'en-US' }).file_path,
    '/en-high.jpg',
  );
  assert.equal(
    selectTmdbImage(items, { artifactKind: 'fanart', language: 'zh-CN' }).file_path,
    '/textless.jpg',
  );
  assert.equal(
    selectTmdbImage(items.filter((item) => item.iso_639_1 === 'de'), {
      artifactKind: 'poster',
      language: 'zh-CN',
    }),
    null,
  );
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
