'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assertRequiredUsAdultActor}=require('../../src/helix/contracts/us-adult-actor-package');
function product(){
  const relations=[{role:'actor',personId:'actor-1',displayName:'Actor One',source:'user_actor_choice'}],
    fact={schemaRef:'helix://contracts/types/MediaCastFact/v1',sourceBasisKind:'us_adult_actor',relationCount:1,relations,relationsDigest:'relations-digest'},
    reference={productFactId:'cast-fact',factRevision:1,factDigest:'cast-digest',factKind:'media_cast',factValue:fact};
  return {resolvedIdentitySnapshot:{factValue:{contentProfile:'western_adult',identityKind:'internal_identity',structureKind:'single'}},
    mediaCastSnapshot:{mediaCastFactId:'cast-fact',mediaCastFactRevision:1,factDigest:'cast-digest',factValue:fact,relations,relationsDigest:fact.relationsDigest},
    productFactManifest:{items:[reference]}};
}
test('US package actor guard preserves the exact single actor Fact and excludes unrelated profiles',()=>{
  const value=product();assert.equal(assertRequiredUsAdultActor(value),value);
  assert.doesNotThrow(()=>assertRequiredUsAdultActor({resolvedIdentitySnapshot:{factValue:{contentProfile:'movie'}}}));
});
test('US package actor guard accepts automatic catalogue face_catalogue cast source',()=>{
  const value=product();
  value.mediaCastSnapshot.relations[0].source='face_catalogue';
  value.mediaCastSnapshot.factValue.relations[0].source='face_catalogue';
  assert.equal(assertRequiredUsAdultActor(value),value);
});
for(const [name,change]of [
  ['empty actor',value=>{value.mediaCastSnapshot.relations=[];}],
  ['unresolved Person',value=>{value.mediaCastSnapshot.relations[0].personId=null;}],
  ['multiple actors',value=>{value.mediaCastSnapshot.relations.push({...value.mediaCastSnapshot.relations[0],personId:'actor-2'});}],
  ['unconfirmed legacy match',value=>{value.mediaCastSnapshot.factValue.sourceBasisKind='western_match';}],
  ['substituted snapshot',value=>{value.mediaCastSnapshot={...value.mediaCastSnapshot,relations:[{...value.mediaCastSnapshot.relations[0],displayName:'Another Actor'}]};}],
  ['missing formal Fact',value=>{value.productFactManifest.items=[];}],
])test('US package rejects '+name+' even with a metadata defect waiver',()=>{
  const value=product();change(value);value.productionAttestation={authorizedDefectManifest:{waivedRequirementCodes:['metadata_field_unmet']}};
  assert.throws(()=>assertRequiredUsAdultActor(value),{code:'US_ADULT_ACTOR_REQUIRED'});
});
