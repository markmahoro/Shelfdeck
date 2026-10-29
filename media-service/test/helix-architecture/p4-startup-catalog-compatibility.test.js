'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const runtime = require('../../src/helix/composition/create-procurement-execution-runtime');
const { createStoredPlanContractVerifier } = require('../../src/helix/foundation/execution/stored-plan-contract-verifier');

test('startup does not expose a release Catalog allowlist', () => {
  assert.equal(Object.hasOwn(runtime, 'verifyStartupPlanCatalog'), false);
});

test('recognized or current Catalog identity never replaces immutable Plan evidence', () => {
  for (const catalogDigest of ['b7e4d607f2684ef6e061e47215aea6607d408fdaf148be3c4b79e7eb0a7ec714', 'current-catalog']) {
    for (const state of ['running', 'succeeded']) {
      const reasons = [];
      const verifier = createStoredPlanContractVerifier({
        proofReader: { verify: callback => callback({ readContract: () => null }) },
        onRejected: reason => reasons.push(reason),
      });
      assert.equal(verifier.verify({ plan: { plan_id: 'plan', catalog_digest: catalogDigest }, workAttempt: { state } }), false);
      assert.deepEqual(reasons, ['Missing immutable Plan contract evidence.']);
    }
  }
});
