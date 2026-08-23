'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { artifactProviderIntent } = require('../../src/helix/domains/libra/planning/libra-production-planners');

test('Artifact intent freezes artifactKind before resolving the current Integration revision', () => {
  const identity = { provider:'tmdb', namespace:'tmdb_movie', providerKey:'12345', seasonNumber:null };
  identity.identityAnchorDigest = canonicalDigest(identity);
  let observed;
  const intent = artifactProviderIntent({ productProductionPort:{ resolveCurrentIntegrationHandle(request) {
    observed=request;
    return { integrationId:'tmdb-main', configRevision:3 };
  } } }, {
    sources:[],
    identity:{ factValue:{ identityDigest:'1'.repeat(64), providerIdentities:[identity] } },
    snapshot:{ run:{ libraRunId:'run-1', executionBasisDigest:'b'.repeat(64) },
      spec:{ contentProfile:'movie', requirements:{ metadata:{ requiredFieldCodes:['plot','title'] } } } },
  }, 'poster');
  assert.deepEqual(observed, { sourceKind:'provider', providerKind:'tmdb',
    operationId:'libra.product_artifact.acquire@1', artifactKind:'poster' });
  assert.equal(intent.configRevision, 3);
});
