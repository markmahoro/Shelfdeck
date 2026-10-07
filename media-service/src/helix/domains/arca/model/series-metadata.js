"use strict";
const {canonicalContentIdentity}=require('./canonical-content-identity');
const EPISODE_FIELDS=new Set(['episode_number','episode_title','episode_plot']);

function episodeFieldMissing(season,keys,metadataFacts,code) {
  if(!Number.isSafeInteger(season)||season<1||!keys.length)return true;
  const records=metadataFacts.flatMap(metadata=>metadata?.episodeMetadata||[]);
  return keys.some(key=>{
    const matches=records.filter(item=>item.episodeScope?.episodeKey===key);
    if(matches.length!==1)return true;
    const scope=matches[0].episodeScope;
    if(scope.seasonNumber!==season||!Number.isSafeInteger(scope.episodeNumber)||scope.episodeNumber<1||
        scope.episodeKey!=='E'+String(scope.episodeNumber).padStart(3,'0'))return true;
    if(code==='episode_number')return false;
    const values=matches[0].descriptiveFacts?.entries?.filter(item=>item.key===code)||[];
    return values.length!==1||typeof values[0].value!=='string'||!values[0].value.trim();
  });
}
function seriesMetadataFieldMissing(packageValue,code) {
  const identity=packageValue.resolvedIdentitySnapshot?.factValue?.resolvedProductIdentity||packageValue.resolvedIdentitySnapshot?.factValue||{};
  const season=identity.providerIdentities?.find(item=>item.namespace==='tmdb_series')?.seasonNumber;
  if(code==='season_number')return !Number.isSafeInteger(season)||season<1;
  if(!EPISODE_FIELDS.has(code))return null;
  const keys=[...new Set((packageValue.productMaterialManifest?.members||[]).filter(item=>item.role==='primary_payload')
    .flatMap(item=>(item.episodeClaims||[]).map(claim=>claim.episodeKey)))];
  const metadata=(packageValue.productFactManifest?.items||[]).filter(item=>item.factKind==='product_metadata').map(item=>item.factValue);
  return episodeFieldMissing(season,keys,metadata,code);
}
function seriesInventoryMetadataFieldMissing(raw,code) {
  if(raw.entry.structure_kind!=='season'||!['episode_title','episode_plot'].includes(code))return null;
  const identities=raw.facts.filter(item=>item.fact_kind==='resolved_identity').map(item=>item.value.resolvedProductIdentity||item.value);
  if(!identities.length)return true;
  for(const identity of identities) {
    try {
      if(identity.structureKind!=='season'||canonicalContentIdentity(raw.entry.shelf_id,identity).canonicalIdentityKey!==raw.entry.canonical_identity_key)
        return true;
    } catch {return true;}
  }
  const season=identities[0].providerIdentities.find(item=>item.namespace==='tmdb_series').seasonNumber;
  const keys=[...new Set(raw.materials.filter(item=>item.role==='primary_payload')
    .flatMap(item=>JSON.parse(item.episode_claims_json).items.map(claim=>claim.episodeKey)))];
  return episodeFieldMissing(season,keys,raw.facts.filter(item=>item.fact_kind==='product_metadata').map(item=>item.value),code);
}
module.exports=Object.freeze({seriesMetadataFieldMissing,seriesInventoryMetadataFieldMissing});
