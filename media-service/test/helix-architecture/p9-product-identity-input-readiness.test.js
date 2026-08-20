'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const {
  IDENTITY_EVIDENCE_SOURCE,
  createProductIdentityProjections,
}=require('../../src/helix/domains/libra/planning/libra-production-planners');

function projection(resolveRoutingIntegrationHandle){
  const registrations=createProductIdentityProjections({
    now:()=>1_000,
    movieProductionReader:{readRunSnapshot(){return {run:{libraRunId:'run-1',subjectId:'subject-1',executionBasisDigest:'a'.repeat(64)},candidateIdentityClaim:{claimedDisplayIdentity:'Movie',claimedYear:2020},relatedReferences:[],relatedBindings:[]};}},
    routingContextReader:{
      read(){return {subjectId:'subject-1'};},
      factObservationIntent(){return {integrationId:'tmdb-main',sourceKind:'provider'};},
    },
    resolveRoutingIntegrationHandle,
  });
  return registrations.find((item)=>item.projectionRef===IDENTITY_EVIDENCE_SOURCE).projection;
}

test('Movie Product Identity waits on a missing configured TMDB handle before dispatch',()=>{
  assert.throws(
    ()=>projection(()=>null).project({ownerScope:{processId:'run-1'},parameters:{sourceKind:'provider_search'}}),
    (error)=>error.code==='P4_EXECUTION_INPUT_TEMPORARILY_UNAVAILABLE'&&
      error.retryAtMs===31_000&&error.details.dependencyRef==='tmdb-main',
  );
});

test('Movie Product Identity projects the exact active TMDB handle when configured',()=>{
  const handle=Object.freeze({integrationId:'tmdb-main',configRevision:2});
  assert.equal(projection(()=>handle).project({ownerScope:{processId:'run-1'},parameters:{sourceKind:'provider_search'}}),handle);
});
