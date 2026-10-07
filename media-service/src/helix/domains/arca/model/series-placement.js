'use strict';
const {seriesArtifactContext,seriesNfoTarget,seriesNfoTargets}=require('./series-artifact-targets');
function seriesPlacementContext(packageValue) {
  const context=seriesArtifactContext(packageValue);
  if(context)seriesNfoTargets(packageValue);
  return context;
}
function seriesMemberStem(context,member,baseStem) {
  const {seasonNumber,scopes,packageValue}=context;
  const prefix=baseStem+' - S'+String(seasonNumber).padStart(2,'0');
  if(member.role==='primary_payload') {
    const keys=member.episodeClaims.map(item=>item.episodeKey).sort();
    const episodes=keys.map(key=>scopes.find(scope=>scope.episodeKey===key));
    if(!keys.length||episodes.some(item=>!item))throw new Error('Series Primary claims are outside the published Episode scope.');
    const stem=prefix+episodes.map(item=>'E'+String(item.episodeNumber).padStart(2,'0')).join('-');
    const peers=packageValue.productMaterialManifest.members.filter(item=>item.role==='primary_payload'&&
      item.episodeClaims.map(claim=>claim.episodeKey).sort().join('|')===keys.join('|')).sort((a,b)=>Buffer.from(a.materialKey).compare(Buffer.from(b.materialKey)));
    return stem+(peers.length>1?'-part'+String(peers.findIndex(item=>item.materialKey===member.materialKey)+1).padStart(2,'0'):'');
  }
  if(member.role==='metadata_sidecar') {
    const {episodeScope}=seriesNfoTarget(context,member);
    return episodeScope?prefix+'E'+String(episodeScope.episodeNumber).padStart(2,'0'):'season';
  }
  return baseStem;
}
module.exports=Object.freeze({seriesPlacementContext,seriesMemberStem});
