'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {artifactRequirement}=require('../../src/helix/contracts/product-artifact-requirement');
const {seriesNfoTargets}=require('../../src/helix/domains/arca/model/series-artifact-targets');
const {seriesPlacementContext,seriesMemberStem}=require('../../src/helix/domains/arca/model/series-placement');
const scope=n=>({episodeKey:'E'+String(n).padStart(3,'0'),episodeNumber:n,seasonNumber:2});
function fixture() {
  const members=[0,1,2].map(n=>({materialKey:'material-'+n,role:'metadata_sidecar',location:'misleading-S99E99.nfo',
    workspaceMaterialHandle:{digestHex:'bytes-'+n}}));
  return {productStructureSnapshot:{structureKind:'season'},
    resolvedIdentitySnapshot:{factValue:{providerIdentities:[{namespace:'tmdb_series',seasonNumber:2}]}},
    productFactManifest:{items:[1,2].map(n=>({factKind:'product_metadata',factValue:{episodeMetadata:[{episodeScope:scope(n)}]}}))},
    productMaterialManifest:{members},artifactManifest:{items:[0,1,2].map(n=>({artifactHandleId:'artifact-'+n,artifactKind:'nfo',
      artifactDigest:'bytes-'+n,requirementDigest:artifactRequirement('nfo',n?scope(n):null).requirementDigest}))}};
}
test('NFO targets derive from all accepted metadata scopes and exact Artifact requirements, never filenames',()=>{
  const value=fixture(),targets=seriesNfoTargets(value);
  assert.deepEqual(targets.map(item=>[item.sourceMaterialKey,item.episodeScope]),[
    ['material-0',null],['material-1',scope(1)],['material-2',scope(2)]]);
  const context=seriesPlacementContext(value);
  assert.deepEqual(value.productMaterialManifest.members.map(member=>seriesMemberStem(context,member,'Show')),
    ['season','Show - S02E01','Show - S02E02']);
  value.productMaterialManifest.members.reverse();value.productFactManifest.items.reverse();value.artifactManifest.items.reverse();
  assert.deepEqual(seriesNfoTargets(value),targets);
});
for(const bad of ['wrong_season','noncanonical_scope','duplicate_episode','missing_episode','duplicate_material','ambiguous_digest','duplicate_target','foreign_requirement','missing_digest'])
test('Series placement refuses '+bad+' in its Artifact target map',()=>{
  const value=fixture();
  if(bad==='wrong_season')value.productFactManifest.items[1].factValue.episodeMetadata[0].episodeScope.seasonNumber=3;
  if(bad==='noncanonical_scope')value.productFactManifest.items[1].factValue.episodeMetadata[0].episodeScope.episodeKey='E2';
  if(bad==='duplicate_episode')value.productFactManifest.items.push(value.productFactManifest.items[0]);
  if(bad==='missing_episode')value.productFactManifest.items.pop();
  if(bad==='duplicate_material')value.productMaterialManifest.members.push(value.productMaterialManifest.members[0]);
  if(bad==='ambiguous_digest')value.artifactManifest.items.push({...value.artifactManifest.items[0],artifactHandleId:'ambiguous'});
  if(bad==='duplicate_target'){
    value.productMaterialManifest.members.push({materialKey:'duplicate-target',role:'metadata_sidecar',workspaceMaterialHandle:{digestHex:'other-bytes'}});
    value.artifactManifest.items.push({...value.artifactManifest.items[2],artifactHandleId:'duplicate-target',artifactDigest:'other-bytes'});
  }
  if(bad==='foreign_requirement')value.artifactManifest.items[2].requirementDigest=artifactRequirement('nfo',scope(3)).requirementDigest;
  if(bad==='missing_digest')value.productMaterialManifest.members[1].workspaceMaterialHandle.digestHex='absent';
  assert.throws(()=>seriesNfoTargets(value));assert.throws(()=>seriesPlacementContext(value));
});
test('NFO scope does not create Primary claims or require a one-file-per-Episode media layout',()=>{
  const value=fixture();value.productMaterialManifest.members.push({materialKey:'shared-primary',role:'primary_payload',episodeClaims:[scope(1),scope(2)]});
  assert.equal(seriesNfoTargets(value).length,3);
  assert.ok(value.productMaterialManifest.members.filter(item=>item.role==='metadata_sidecar').every(item=>!Object.hasOwn(item,'episodeClaims')));
});
test('Movie packages do not acquire a fabricated Series Artifact scope',()=>{
  assert.deepEqual(seriesNfoTargets({productStructureSnapshot:{structureKind:'single'}}),[]);
});
