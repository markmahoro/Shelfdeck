'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  TmdbProviderAdapterError,
  validateMetadataResponse,
} = require('../../src/helix/integrations/tmdb-provider-adapter');
const { metadataFetchFailed } = require('../../src/helix/domains/libra/capabilities/product-metadata-capability-ports');

function skyfallLike() {
  return {
    id: 37724,
    title: '007：大破天幕杀机',
    original_title: 'Skyfall',
    unknown_future_field: true,
    belongs_to_collection: { id: 645, name: 'James Bond Collection', extra: 'ok' },
    credits: {
      cast: Array.from({ length: 80 }, (_item, index) => ({
        id: 1000 + index, name: 'Actor ' + index, extra_person_field: 'x',
      })),
      crew: Array.from({ length: 300 }, (_item, index) => ({
        id: 2000 + index, name: 'Crew ' + index, job: index === 0 ? 'Director' : 'Other',
      })),
    },
    alternative_titles: {
      titles: Array.from({ length: 80 }, (_item, index) => ({
        title: 'Alt ' + index, iso_3166_1: 'US', type: '', extra: true,
      })),
    },
    translations: {
      translations: [{
        iso_3166_1: 'CN', iso_639_1: 'zh', name: '普通话', english_name: 'Mandarin',
        data: { title: '007：大破天幕杀机', extra_data: true },
      }],
    },
  };
}

test('TMDB movie metadata ignores unknown provider fields and large Bond-size credits', () => {
  assert.doesNotThrow(() => validateMetadataResponse(skyfallLike()));
  assert.throws(() => validateMetadataResponse({ title: 'no-id' }),
    (error) => error instanceof TmdbProviderAdapterError &&
      error.code === 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID');
});

test('TMDB metadata HTTP/timeout wrapped by a Secret lease is retryable', () => {
  const timeout = metadataFetchFailed(Object.assign(new Error('Secret-backed invocation failed.'), {
    code: 'P5_SECRET_LEASE_INVOCATION_FAILED',
    details: { causeCode: 'PLATFORM_INTEGRATION_TIMEOUT' },
  }));
  assert.equal(timeout.kind, 'failed');
  assert.equal(timeout.failureClass, 'timeout');
  const http = metadataFetchFailed(Object.assign(new Error('Secret-backed invocation failed.'), {
    code: 'P5_SECRET_LEASE_INVOCATION_FAILED',
    details: { causeCode: 'PLATFORM_INTEGRATION_HTTP_FAILED' },
  }));
  assert.equal(http.failureClass, 'integration');
  assert.throws(() => metadataFetchFailed(Object.assign(new Error('schema'), {
    code: 'P4_CAPABILITY_SCHEMA_REJECTED',
  })), (error) => error.code === 'P4_CAPABILITY_SCHEMA_REJECTED');
});
