'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assessAcceptedInventory,
} = require('../src/helix/domains/arca/application/on-deck-context-reader');

test('accepted On-deck context replays final reality after an earlier member settlement', () => {
  let captured;
  const result = assessAcceptedInventory({
    assess(request) {
      captured = request;
      if (!request.replayCommitted) {
        const error = new Error('Earlier settled source was treated as missing.');
        error.code = 'CLEAN_ARCA_PRODUCT_SOURCE_MISSING';
        throw error;
      }
      return { payloadDigest:'accepted-feasibility' };
    },
  }, 'on-deck-1', { custodyId:'custody-1' }, {
    shelf:{ shelfId:'shelf-1' },
    packageValue:{ onDeckPackageId:'package-1' },
  });

  assert.equal(result.payloadDigest, 'accepted-feasibility');
  assert.equal(captured.replayCommitted, true);
  assert.equal(captured.onDeckRunId, 'on-deck-1');
  assert.equal(captured.custodyId, 'custody-1');
  assert.equal(captured.shelf.shelfId, 'shelf-1');
  assert.equal(captured.onDeckProductPackage.onDeckPackageId, 'package-1');
});
