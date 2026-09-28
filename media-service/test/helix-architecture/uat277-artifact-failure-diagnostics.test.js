'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { workspaceId } = require('../../src/helix/domains/libra/model/workspace-admission-contracts');
const { ACQUIRE, createArtifactProductionCapabilityPorts } =
  require('../../src/helix/domains/libra/capabilities/artifact-production-capability-ports');

for (const beforeWrite of [true, false]) test('UAT-277 artifact diagnostics retain the write fence: ' + beforeWrite, async () => {
  const context = {
    eventAttemptId:'attempt-1', idempotencyKey:'artifact-1',
    ownerScope:{processId:'run-1'}, parameters:{artifactKind:'poster'},
    namedInputs:{integrationHandle:{integrationId:'tmdb-main',configRevision:1},
      productMetadataDraft:{draftId:'draft-1',draftDigest:canonicalDigest('draft'),fieldProvenance:[]}},
  };
  const error = new Error('https://image.test/?key=private-secret');
  error.code = 'PLATFORM_INTEGRATION_NETWORK_FAILED';
  error.details = { stage:'image_request', networkCode:'ECONNRESET', secret:'private-secret' };
  if (beforeWrite) error.workspaceWriteNotStarted = {
    eventAttemptId:context.eventAttemptId, idempotencyKey:context.idempotencyKey,
    targetDigest:canonicalDigest({workspaceId:workspaceId('run-1'),relativePath:'product/poster.jpg'}),
  };
  const port = createArtifactProductionCapabilityPorts({
    movieProductionReader:{readRunSnapshot:()=>({relatedReferences:[]})},
    productProductionPort:{acquireProviderArtifact:async()=>{throw error;}},
  })[ACQUIRE];
  if (!beforeWrite) {
    await assert.rejects(port.execute(context), observed=>observed===error);
    return;
  }
  const outcome = await port.execute(context);
  assert.equal(outcome.kind,'failed');
  assert.equal(outcome.code,'LIBRA_ARTIFACT_FETCH_FAILED');
  assert.equal(outcome.retryDirective,'never');
  assert.deepEqual(outcome.evidence.diagnostics,{stage:'image_request',networkCode:'ECONNRESET'});
  assert.equal(JSON.stringify(outcome).includes('private-secret'),false);
});
