'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {providerRecoveryDigest,computeRecoveryDigest}=require('../../src/helix/platform/application/failure-recovery-projection');
const {relevantRecoveryConditions}=require('../../src/helix/domains/libra/model/failure-recovery-conditions');
const {maintenanceRecoveryConditions}=require('../../src/helix/domains/arca/model/maintenance-recovery-conditions');

test('ordinary maintenance freezes only relevant semantic conditions and changes its trigger once',()=>{
  let provider='initial';
  const read=kinds=>kinds.map(conditionKind=>({conditionKind,snapshotDigest:canonicalDigest(provider)}));
  const finding={findingKind:'presentation:poster_missing',findingId:'first',observedAtMs:1};
  const context={raw:{identity:{provider:'tmdb'}}},first=maintenanceRecoveryConditions([finding],read,context);
  assert.deepEqual(maintenanceRecoveryConditions([{...finding,findingId:'later',observedAtMs:200}],read,context),first);
  assert.deepEqual(first.conditions.map(item=>item.conditionKind),['tmdb']);
  provider='changed';assert.notDeepEqual(maintenanceRecoveryConditions([finding],read,context),first);
  assert.deepEqual(maintenanceRecoveryConditions([{findingKind:'presentation:nfo_missing'}],read).conditions,[]);
  assert.equal(first.parameter.valueDigest,canonicalDigest(first.parameter.value));
});

test('failure conditions select relevant providers and never treat observation identities as changes',()=>{
  assert.deepEqual(relevantRecoveryConditions([{capabilityRef:'libra.product_artifact.acquire@1'}]),['tmdb']);
  assert.deepEqual(relevantRecoveryConditions([{capabilityRef:'libra.external_material.candidate.select@1'}]),['media_compute','moviepilot']);
  assert.deepEqual(relevantRecoveryConditions([{capabilityRef:'libra.product_media.verify@1',failureCode:'playback_decode_failed'}]),[]);
  const snapshot={integration:{state:'active',config:{endpoint:'https://example.invalid',secretEnvelopeDigest:'credential',
    capabilityCodes:['metadata'],settings:{language:'zh-CN'},configRevision:1,lastTestSummary:{checkedAtMs:1},lastCommand:'first'}}};
  const replay=structuredClone(snapshot);Object.assign(replay.integration.config,{configRevision:20,lastTestSummary:{checkedAtMs:200},lastCommand:'second'});
  assert.equal(providerRecoveryDigest(snapshot),providerRecoveryDigest(replay));
  replay.integration.config.endpoint='https://another.invalid';
  assert.notEqual(providerRecoveryDigest(snapshot),providerRecoveryDigest(replay));
});

test('compute recovery ignores probe revision and proof identifiers but detects usable capability changes',()=>{
  let revision=1,encoder='hevc';
  const runtime={listReadyDeviceRefs(query){assert.equal(query.queryContract,'platform.compute-ready-device-refs@1');
    return {resultKind:'available',items:[{deviceId:'cpu',deviceClass:'cpu',probeRevision:revision,capabilityDigest:canonicalDigest(encoder)}]};},
    readDeviceSnapshot(){return {resultKind:'found',snapshot:{capabilityPayload:{supportedVideoCodecs:[encoder],pipelineProfiles:[{selfTestDigest:canonicalDigest(revision)}]}}};}};
  const first=computeRecoveryDigest(runtime);revision++;
  assert.equal(first,computeRecoveryDigest(runtime));encoder='h264';assert.notEqual(first,computeRecoveryDigest(runtime));
});

test('provider recovery observes the effective global route but ignores network command revisions',()=>{
  const snapshot={integration:{state:'active',config:{endpoint:'https://javdb.com',settings:{}}}},
    direct={mode:'direct',proxyEndpoint:null},proxy={mode:'http_proxy',proxyEndpoint:'http://127.0.0.1:18999'};
  assert.notEqual(providerRecoveryDigest(snapshot,direct),providerRecoveryDigest(snapshot,proxy));
  assert.equal(providerRecoveryDigest(snapshot,proxy),providerRecoveryDigest(snapshot,{...proxy}));
});
