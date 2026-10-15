'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {aftercareReceiptMaterialRole}=require('../../src/helix/domains/arca/model/aftercare-contract');

test('current Aftercare image receipts preserve the declared kind independently of the file name',()=>{
  for(const materialEffectKind of ['artifact_materialize','artifact_reconcile']) {
    assert.equal(aftercareReceiptMaterialRole({materialEffectKind,artifactKind:'fanart',targetLocation:'/test/poster.jpg'}),'fanart');
    assert.equal(aftercareReceiptMaterialRole({materialEffectKind,artifactKind:'poster',targetLocation:'/test/fanart.jpg'}),'poster');
    assert.equal(aftercareReceiptMaterialRole({materialEffectKind,artifactKind:'nfo'}),'metadata_sidecar');
    for(const artifactKind of [undefined,'sidecar','media'])
      assert.throws(()=>aftercareReceiptMaterialRole({materialEffectKind,artifactKind,targetLocation:'/test/poster.jpg'}),/declared role/);
  }
});

test('placement and primary receipts preserve their own material role contracts',()=>{
  assert.equal(aftercareReceiptMaterialRole({materialEffectKind:'placement_migrate'},{role:'fanart'}),'fanart');
  assert.equal(aftercareReceiptMaterialRole({materialEffectKind:'primary_replace'}),'primary_payload');
  assert.throws(()=>aftercareReceiptMaterialRole({materialEffectKind:'placement_migrate'}),/declared role/);
});

test('fanart assessment is limited to JAV and its explicitly selected Standard',async()=>{
  const fixture=require('./fixtures/jav-correction');
  const {buildJavSelectedSource}=require('../../src/helix/contracts/jav-selected-source');
  const {createAftercareCapabilityPorts}=require('../../src/helix/domains/arca/capabilities/aftercare-capability-ports');
  const {CAPABILITY_REFS:C}=require('../../src/helix/domains/arca/model/aftercare-contract');
  for(const [provider,structure,required,expected] of [
    ['jav','single',true,true],['jav','single',false,false],['tmdb','single',true,false],['tmdb','season',true,false],
  ]) {
    const context=fixture.context();
    context.basis={digest:'a'.repeat(64),inventoryRevision:1,standardRevision:1,placementRevision:1,
      decisionFactSetDigest:'b'.repeat(64)};
    context.raw.identity.provider=provider;
    context.raw.identity.provider_key='IPX-178';
    context.raw.entry.structure_kind=structure;
    context.raw.identity.identity_kind=provider==='jav'?'jav_code':structure==='season'?'tmdb_series_season':'tmdb_movie';
    context.raw.materials=[];
    context.raw.facts[0].value.javSelectedSource=buildJavSelectedSource(fixture.source());
    context.raw.standard={value:{profileRuleSets:[{contentProfile:provider==='jav'?'jav':structure==='season'?'series':'movie',
      baseRequirements:{metadata:{requiredArtifactKinds:required?['fanart']:[]}}}]}};
    const ports=createAftercareCapabilityPorts({
      schemaManifest:require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),
      unitOfWork:{execute(){throw new Error('Assessment must not commit data.');}},
      contextReader:{read:()=>context,store:{history:()=>({cases:[],findings:[],commits:[]})}},
      workResultReader:{read:()=>[]},computeBoundedMaterialFingerprintSync(){throw new Error('No media read is expected.');},
      resolveAftercareIntegrationHandle:()=>null,now:()=>1000,
    });
    const result=await ports[C.presentation].execute({ownerScope:{processId:context.shelfEntryId},workId:'assessment'});
    assert.equal(result.result.findingDrafts.some(item=>item.schemaRef.includes('/fanart_missing/')),expected,
      JSON.stringify({provider,structure,required}));
  }
});
