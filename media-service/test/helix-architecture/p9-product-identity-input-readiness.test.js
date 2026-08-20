'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const {
  IDENTITY_EVIDENCE_SOURCE,
  UAT_SOURCE_ROUTING_INTENT,
  UAT_SOURCE_ROUTING_SOURCE,
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

test('pre-UAT Product Identity projections exist only to close already-frozen Work inputs',()=>{
  const handle=Object.freeze({integrationId:'tmdb-main',configRevision:2});
  const registrations=createProductIdentityProjections({
    now:()=>1_000,
    movieProductionReader:{readRunSnapshot(){return {run:{libraRunId:'run-1',subjectId:'subject-1',executionBasisDigest:'a'.repeat(64)}};}},
    routingContextReader:{read(){return {subjectId:'subject-1'};},factObservationIntent(){return {
      subjectId:'subject-1',sourceKind:'provider',factKinds:['resolved_provider_identity'],aliases:[],
      intentId:'old',intentDigest:'b'.repeat(64),
    };}},
    resolveRoutingIntegrationHandle:()=>handle,
  });
  const intent=registrations.find((item)=>item.projectionRef===UAT_SOURCE_ROUTING_INTENT).projection
    .project({ownerScope:{processId:'run-1'}});
  const source=registrations.find((item)=>item.projectionRef===UAT_SOURCE_ROUTING_SOURCE).projection
    .project({ownerScope:{processId:'run-1'}});
  assert.equal(intent.integrationId,'tmdb-main');
  assert.equal(intent.configRevision,2);
  assert.equal(source,handle);
});
