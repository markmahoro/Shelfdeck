"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {canonicalContentIdentity}=require('../../src/helix/domains/arca/model/canonical-content-identity');
const {seriesInventoryMetadataFieldMissing,seriesMetadataFieldMissing}=require('../../src/helix/domains/arca/model/series-metadata');
const {missingFields}=require('../../src/helix/domains/arca/model/accepted-gap-contracts');
const key=n=>'E'+String(n).padStart(3,'0');
function episode(n) {return {episodeScope:{seasonNumber:1,episodeNumber:n,episodeKey:key(n)},
  descriptiveFacts:{entries:[{key:'episode_title',value:'Title '+n},{key:'episode_plot',value:'Plot '+n}]}};}
function fixture() {
  const identity={identityDigest:canonicalDigest('identity'),structureKind:'season',contentProfile:'series',identityKind:'tmdb_series_season',
    providerIdentities:[{provider:'tmdb',namespace:'tmdb_series',providerKey:'1399',seasonNumber:1}]};
  return {identity:{identity_kind:'tmdb_series_season'},entry:{structure_kind:'season',shelf_id:'shelf',canonical_identity_key:canonicalContentIdentity('shelf',identity).canonicalIdentityKey},
    materials:[1,2,3].map(n=>({role:'primary_payload',episode_claims_json:JSON.stringify({items:[{episodeKey:key(n)}]})})),
    facts:[{fact_kind:'resolved_identity',value:identity},{fact_kind:'product_metadata',value:{episodeMetadata:[episode(1),episode(2)]}},
      {fact_kind:'resolved_identity',value:structuredClone(identity)},{fact_kind:'product_metadata',value:{episodeMetadata:[episode(3)]}}],
    standard:{value:{profileRuleSets:[{contentProfile:'series',baseRequirements:{metadata:{requiredFieldCodes:['episode_title','episode_plot']}}}]}},people:[]};
}
test('Aftercare reads every accepted batch for the current Season Inventory',()=>{
  const raw=fixture(),before=canonicalDigest(raw);
  assert.deepEqual(missingFields({raw}),[]);raw.facts.reverse();assert.deepEqual(missingFields({raw}),[]);raw.facts.reverse();
  assert.equal(canonicalDigest(raw),before);
});
for(const mutation of ['missing_episode','empty_title','duplicate_episode','wrong_season','wrong_number','duplicate_field','foreign_identity','missing_identity','empty_inventory'])
test('Series Inventory metadata refuses '+mutation,()=>{
  const raw=fixture(),metadata=raw.facts[3].value;
  if(mutation==='missing_episode')metadata.episodeMetadata=[];
  if(mutation==='empty_title')metadata.episodeMetadata[0].descriptiveFacts.entries[0].value=' ';
  if(mutation==='duplicate_episode')raw.facts[1].value.episodeMetadata.push(episode(3));
  if(mutation==='wrong_season')metadata.episodeMetadata[0].episodeScope.seasonNumber=2;
  if(mutation==='wrong_number')metadata.episodeMetadata[0].episodeScope.episodeNumber=4;
  if(mutation==='duplicate_field')metadata.episodeMetadata[0].descriptiveFacts.entries.push({key:'episode_title',value:'Other'});
  if(mutation==='foreign_identity')raw.facts[2].value.providerIdentities[0].seasonNumber=2;
  if(mutation==='missing_identity')raw.facts=raw.facts.filter(item=>item.fact_kind!=='resolved_identity');
  if(mutation==='empty_inventory')raw.materials=[];
  assert.equal(seriesInventoryMetadataFieldMissing(raw,'episode_title'),true);
  assert.ok(missingFields({raw}).includes('episode_title'));
});
test('N:M claims are deduplicated without requiring duplicate Episode metadata',()=>{
  const raw=fixture();raw.materials[0].episode_claims_json=JSON.stringify({items:[{episodeKey:'E001'},{episodeKey:'E002'}]});
  assert.deepEqual(missingFields({raw}),[]);
});
test('Episode evidence outside the current Inventory cannot fill an absent current Episode',()=>{
  const raw=fixture();raw.facts[3].value.episodeMetadata=[episode(4)];
  assert.deepEqual(missingFields({raw}),['episode_plot','episode_title']);
});
test('Movie metadata still uses its top-level fields',()=>{
  const raw=fixture();raw.identity.identity_kind='tmdb_movie';raw.entry.structure_kind='single';raw.standard.value.profileRuleSets=[{contentProfile:'movie',baseRequirements:{metadata:{requiredFieldCodes:['title','plot']}}}];
  raw.facts=[{fact_kind:'product_metadata',value:{descriptiveFacts:{entries:[{key:'title',value:'Movie'},{key:'plot',value:'Plot'}]}}}];
  assert.deepEqual(missingFields({raw}),[]);raw.facts[0].value.descriptiveFacts.entries.pop();assert.deepEqual(missingFields({raw}),['plot']);
});
test('Package metadata inspection also covers every supplied immutable metadata Fact',()=>{
  const raw=fixture(),value={resolvedIdentitySnapshot:{factValue:raw.facts[0].value},
    productMaterialManifest:{members:raw.materials.map(item=>({role:item.role,episodeClaims:JSON.parse(item.episode_claims_json).items}))},
    productFactManifest:{items:raw.facts.map(item=>({factKind:item.fact_kind,factValue:item.value}))}};
  assert.equal(seriesMetadataFieldMissing(value,'episode_title'),false);
  value.productFactManifest.items.pop();assert.equal(seriesMetadataFieldMissing(value,'episode_title'),true);
});
