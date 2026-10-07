'use strict';
function seriesMetadataFieldMissing(packageValue,code) {
  const identity=packageValue.resolvedIdentitySnapshot?.factValue?.resolvedProductIdentity||packageValue.resolvedIdentitySnapshot?.factValue||{};
  const season=identity.providerIdentities?.find(item=>item.namespace==='tmdb_series')?.seasonNumber;
  if(code==='season_number')return !Number.isSafeInteger(season)||season<1;
  if(!['episode_number','episode_title','episode_plot'].includes(code))return null;
  const keys=[...new Set((packageValue.productMaterialManifest?.members||[]).filter(item=>item.role==='primary_payload')
    .flatMap(item=>(item.episodeClaims||[]).map(claim=>claim.episodeKey)))];
  if(!keys.length)return true;
  const metadata=packageValue.productFactManifest?.items?.find(item=>item.factKind==='product_metadata')?.factValue;
  return keys.some(key=>{
    const records=(metadata?.episodeMetadata||[]).filter(item=>item.episodeScope.episodeKey===key&&item.episodeScope.seasonNumber===season);
    if(records.length!==1)return true;
    const scope=records[0].episodeScope;
    if(!Number.isSafeInteger(scope.episodeNumber)||scope.episodeNumber<1||scope.episodeKey!=='E'+String(scope.episodeNumber).padStart(3,'0'))return true;
    if(code==='episode_number')return false;
    const value=records[0].descriptiveFacts?.entries?.find(item=>item.key===code)?.value;
    return typeof value!=='string'||!value.trim();
  });
}
module.exports=Object.freeze({seriesMetadataFieldMissing});
