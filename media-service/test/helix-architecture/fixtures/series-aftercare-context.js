'use strict';
const {canonicalJson,canonicalDigest}=require('../../../src/helix/contracts/canonical-json');
const {artifactRequirement}=require('../../../src/helix/contracts/product-artifact-requirement');
const {canonicalContentIdentity}=require('../../../src/helix/domains/arca/model/canonical-content-identity');
const {SCHEMA_REF}=require('../../../src/helix/domains/arca/model/inventory-artifact-scope');
const facts=entries=>({descriptiveFacts:{entries:Object.entries(entries).map(([key,value])=>({key,value}))}});
function fixture() {
  const identity={structureKind:'season',contentProfile:'series',identityKind:'tmdb_series_season',identityDigest:canonicalDigest('series'),
    providerIdentities:[{provider:'tmdb',namespace:'tmdb_series',providerKey:'1399',seasonNumber:2}]};
  const material=(key,number,sourcePackageId)=>{
    const episodeScope=number?{seasonNumber:2,episodeNumber:number,episodeKey:'E'+String(number).padStart(3,'0')}:null;
    const body={schemaRef:SCHEMA_REF,schemaVersion:1,artifactKind:'nfo',seasonNumber:2,episodeScope,
      requirementDigest:artifactRequirement('nfo',episodeScope).requirementDigest,sourcePackageId,
      sourceArtifactHandleId:'artifact-'+key,sourceArtifactReferenceDigest:canonicalDigest(key)};
    return {material_key:key,role:'metadata_sidecar',location:'/arbitrary/'+key+'.nfo',artifact_scope_schema_ref:SCHEMA_REF,
      artifact_scope_json:canonicalJson({...body,scopeDigest:canonicalDigest(body)})};
  };
  const batch=(source_package_id,numbers,title)=>[
    {fact_kind:'resolved_identity',source_package_id,value:structuredClone(identity)},
    {fact_kind:'product_metadata',source_package_id,value:{...facts({series_title:title,tmdb_series_id:'1399',season_number:2,
      plot:'Season plot',genre:'Drama / Fantasy'}),episodeMetadata:numbers.map(number=>({
        episodeScope:{seasonNumber:2,episodeNumber:number,episodeKey:'E'+String(number).padStart(3,'0')},
        ...facts({episode_title:'Episode '+number,episode_plot:'Plot '+number,season_number:2,episode_number:number})}))}},
    {fact_kind:'media_cast',source_package_id,value:{relations:[{role:'actor',displayName:'Actor from '+source_package_id,
      providerIdentities:[{provider:'tmdb',namespace:'tmdb_person',providerKey:'123'}]}]}},
  ];
  return {raw:{entry:{structure_kind:'season',shelf_id:'shelf',canonical_identity_key:canonicalContentIdentity('shelf',identity).canonicalIdentityKey},
    identity:{identity_kind:'tmdb_series_season',provider:'tmdb',provider_key:'1399',identity_digest:identity.identityDigest},
    materials:[material('season',null,'first'),material('one',1,'first'),material('two',2,'first'),material('three',3,'second'),
      {material_key:'shared',role:'primary_payload',episode_claims_json:JSON.stringify({items:[{episodeKey:'E001'},{episodeKey:'E002'}]})},
      {material_key:'part-a',role:'primary_payload',episode_claims_json:JSON.stringify({items:[{episodeKey:'E003'}]})},
      {material_key:'part-b',role:'primary_payload',episode_claims_json:JSON.stringify({items:[{episodeKey:'E003'}]})}],
    facts:[...batch('first',[1,2],'Original Series'),...batch('second',[3],'Updated & <Series>')]}};
}

module.exports=Object.freeze({fixture});
