'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {artifactRequirement}=require('../../src/helix/contracts/product-artifact-requirement');
const {seriesPlacementContext,seriesMemberStem}=require('../../src/helix/domains/arca/model/series-placement');
const scope=n=>({episodeKey:'E'+String(n).padStart(3,'0'),episodeNumber:n,seasonNumber:1});
function fixture(){const members=[1,2].map(n=>({materialKey:'m'+n,role:'primary_payload',episodeClaims:[scope(n)]}));
 const value={productStructureSnapshot:{structureKind:'season'},resolvedIdentitySnapshot:{factValue:{providerIdentities:[{namespace:'tmdb_series',seasonNumber:1}]}},
 productFactManifest:{items:[{factKind:'product_metadata',factValue:{episodeMetadata:[1,2].map(n=>({episodeScope:scope(n)}))}}]},
 productMaterialManifest:{members},artifactManifest:{items:[{artifactKind:'nfo',artifactDigest:'bytes',requirementDigest:artifactRequirement('nfo',scope(2)).requirementDigest}]}};
 return {value,members,context:seriesPlacementContext(value)};}
test('Series names bind immutable Primary claims and scoped NFO requirements',()=>{
 const {context,members}=fixture();assert.equal(seriesMemberStem(context,members[0],'Show'),'Show - S01E01');
 assert.equal(seriesMemberStem(context,{role:'metadata_sidecar',workspaceMaterialHandle:{digestHex:'bytes'}},'Show'),'Show - S01E02');
});
test('Shared files and parts retain physical identity without target collision',()=>{
 const {context,members}=fixture();members[0].episodeClaims.push(scope(2));members[1].episodeClaims=[scope(2),scope(1)];
 assert.equal(seriesMemberStem(context,members[0],'Show'),'Show - S01E01-E02-part01');
 assert.equal(seriesMemberStem(context,members[1],'Show'),'Show - S01E01-E02-part02');
});
test('NFO targets cannot be borrowed from another Season or ambiguous Artifact',()=>{
 const {context,value}=fixture(),nfo={role:'metadata_sidecar',workspaceMaterialHandle:{digestHex:'bytes'}};
 value.artifactManifest.items[0].requirementDigest=artifactRequirement('nfo',{...scope(2),seasonNumber:2}).requirementDigest;
 assert.throws(()=>seriesMemberStem(context,nfo,'Show'),/outside/);
 value.artifactManifest.items.push({...value.artifactManifest.items[0]});assert.throws(()=>seriesMemberStem(context,nfo,'Show'),/exact/);
});
test('Artifact scopes reject noncanonical keys, unknown fields and non-NFO targets',()=>{
 assert.throws(()=>artifactRequirement('nfo',{...scope(1),episodeKey:'E1'}));
 assert.throws(()=>artifactRequirement('nfo',{...scope(1),extra:true}));
 assert.throws(()=>artifactRequirement('poster',scope(1)));
});

const {missingMetadataFields}=require('../../src/helix/domains/arca/model/authorized-defect-manifest');
test('Episode metadata acceptance requires every delivered Episode without borrowing Season fields',()=>{
 const {value}=fixture(),metadata=value.productFactManifest.items[0].factValue;
 const requirement={requiredFieldCodes:['season_number','episode_number','episode_title','episode_plot']};
 metadata.descriptiveFacts={entries:[{key:'episode_title',value:'Wrong scope'},{key:'episode_plot',value:'Wrong scope'}]};
 assert.deepEqual(missingMetadataFields(value,requirement),['episode_plot','episode_title']);
 for(const episode of metadata.episodeMetadata)episode.descriptiveFacts={entries:[{key:'episode_title',value:'Title'},{key:'episode_plot',value:'Plot'}]};
 assert.deepEqual(missingMetadataFields(value,requirement),[]);
 metadata.episodeMetadata[1].episodeScope={...scope(2),seasonNumber:2};
 assert.deepEqual(missingMetadataFields(value,requirement),['episode_number','episode_plot','episode_title']);
 metadata.episodeMetadata[1].episodeScope=scope(2);
 metadata.episodeMetadata.push(metadata.episodeMetadata[0]);
 assert.deepEqual(missingMetadataFields(value,requirement),['episode_number','episode_plot','episode_title']);
});
