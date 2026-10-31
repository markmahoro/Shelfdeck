'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const {representativeImagePolicy}=require('../../src/helix/contracts/buffalo-representative-policy');
const {createCatalogueRegistrationFrameProofPort}=
  require('../../src/helix/integrations/us-adult-catalogue-frame-proof');

function wait(){return new Promise(resolve=>setImmediate(resolve));}

test('frame proof port fails closed when catalogue decision input is incomplete',()=>{
  const port=createCatalogueRegistrationFrameProofPort({
    createCpuSession(){throw new Error('CPU must not start');},
    readArtifactBytes(){throw new Error('bytes must not load');},
    resolveCatalogueReaders(){throw new Error('readers must not load');},
  });
  assert.equal(port.buildFrameImageProof({}).kind,'failed');
  assert.equal(port.buildFrameImageProof({input:{libraRunId:'run'}}).kind,'failed');
});

test('frame proof port stays pending then fails closed when no winner representative exists',async()=>{
  let wakes=0;
  const observation={
    observationDigest:D('obs'),groups:[{clusterId:'cluster-1',representativeKeys:['0:0']}],
    queries:[],frameEvidenceRefs:[],
  };
  const port=createCatalogueRegistrationFrameProofPort({
    createCpuSession(){throw new Error('CPU must not start for a missing face');},
    readArtifactBytes(){throw new Error('bytes must not load for a missing face');},
    resolveCatalogueReaders(){throw new Error('readers must not load for a missing face');},
    wake(){wakes+=1;},
  });
  const input={libraRunId:'run',catalogueBasisDigest:D('basis'),
    observationHandle:{mode:'initial',observationDigest:observation.observationDigest},
    representativeImagePolicyDigest:representativeImagePolicy().policyDigest,
    winner:{identityKey:'id-1',uid:'uid-1',name:'Missing Face',aliases:[],groupIds:['other']}};
  assert.equal(port.buildFrameImageProof({input,observation}),null);
  await wait();
  await wait();
  const failed=port.buildFrameImageProof({input,observation});
  assert.equal(failed.kind,'failed');
  assert.match(failed.code,/PEOPLE_CATALOGUE_FRAME_PROOF_/);
  assert.ok(wakes>=1);
});
