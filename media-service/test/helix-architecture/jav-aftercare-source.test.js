'use strict';
const assert=require('node:assert/strict'),test=require('node:test');
const fixture=require('./fixtures/jav-correction');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {buildJavSelectedSource}=require('../../src/helix/contracts/jav-selected-source');
const {aftercareJavSource,aftercareArtifactSourceIntent,aftercareJavAcquisitionSource}=require('../../src/helix/domains/arca/model/aftercare-artifact-source');
const {maintenanceRecoveryConditions}=require('../../src/helix/domains/arca/model/maintenance-recovery-conditions');
function original() {
  const qualification=fixture.source(),binding=buildJavSelectedSource(qualification),context=fixture.context();
  context.raw.identity.provider_key='IPX-178';context.raw.facts[0].value.javSelectedSource=binding;
  return {qualification,binding,context};
}
test('JAV maintenance recovery follows only its accepted site and ignores unrelated TMDB changes',()=>{
  const {context}=original(),finding={findingKind:'presentation:poster_missing'},snapshots={tmdb:'unrelated', 'jav-javdb':'original'},
    read=kinds=>kinds.map(conditionKind=>({conditionKind,snapshotDigest:canonicalDigest(snapshots[conditionKind])}));
  const first=maintenanceRecoveryConditions([finding],read,context);
  assert.deepEqual(first.conditions.map(value=>value.conditionKind),['jav-javdb']);
  snapshots.tmdb='changed';assert.deepEqual(maintenanceRecoveryConditions([finding],read,context),first);
  snapshots['jav-javdb']='changed';assert.notDeepEqual(maintenanceRecoveryConditions([finding],read,context),first);
  assert.throws(()=>maintenanceRecoveryConditions([finding],read),TypeError);
});
test('Aftercare consumes the accepted JAV source without a legacy Provider or a filename query',()=>{
  const {binding,context}=original();
  assert.deepEqual(aftercareJavSource(context),binding);
  assert.deepEqual(aftercareArtifactSourceIntent(context),{providerKind:'jav',integrationId:binding.integrationId,configRevision:1,javSelectedSource:binding});
  context.raw.identity.provider_key='IPX-177';
  assert.throws(()=>aftercareJavSource(context),{code:'ARCA_AFTERCARE_PROVIDER_INPUT_STALE'});
});
test('Aftercare consumes the current Arca correction source and rejects old metadata beside the new identity',()=>{
  const {qualification,context}=original();
  context.raw.facts[0].value={schemaRef:'helix://contracts/application-types/ArcaJavCorrectionMetadataFact/v1',
    javCode:'IPX-178',canonicalIdentityDigest:context.raw.identity.identity_digest,sourceQualification:qualification};
  assert.equal(aftercareJavSource(context).queryAnchor.javCode,'IPX-178');
  context.raw.facts[0].value.canonicalIdentityDigest='0'.repeat(64);
  assert.throws(()=>aftercareJavSource(context),{code:'ARCA_AFTERCARE_PROVIDER_INPUT_STALE'});
});
test('current Aftercare technical configuration never rewrites the original accepted qualification',()=>{
  const {qualification,binding}=original(),before=structuredClone(binding),handle={...fixture.handle(),configRevision:2,
    allowedOperation:'arca.aftercare.binary_artifact.acquire@1'},recipe=aftercareJavAcquisitionSource(binding,handle,qualification.observation);
  assert.equal(recipe.configRevision,2);assert.deepEqual(binding,before);
  assert.equal(recipe.resourceKey,binding.resourceKey);assert.equal(recipe.coverDigest,binding.coverDigest);
});
test('Aftercare rejects a new source title cover resource namespace route or operation before deriving any output',()=>{
  const {qualification,binding}=original(),handle={...fixture.handle(),allowedOperation:'arca.aftercare.binary_artifact.acquire@1'};
  for(const mutate of [
    value=>{value.resourceKey='foreign-film';},value=>{value.cover.byteDigest='0'.repeat(64);},
    value=>{value.descriptiveEntries[0].value='Changed title';},value=>{value.resolvedProviderIdentity.namespace='tmdb_movie';},
    value=>{value.networkRouteDigest='0'.repeat(64);},value=>{value.siteRef='javmenu';},
  ]) {
    const changed=structuredClone(qualification.observation);mutate(changed);
    changed.observationDigest=canonicalDigest(Object.fromEntries(Object.entries(changed).filter(([key])=>key!=='observationDigest')));
    assert.throws(()=>aftercareJavAcquisitionSource(binding,handle,changed),{code:'ARCA_AFTERCARE_PROVIDER_RESPONSE_STALE'});
  }
  assert.throws(()=>aftercareJavAcquisitionSource(binding,{...handle,allowedOperation:'libra.product_artifact.acquire@1'},qualification.observation),
    {code:'ARCA_AFTERCARE_PROVIDER_RESPONSE_STALE'});
});
