'use strict';
const {seriesArtifactContext,seriesNfoTarget,seriesNfoTargets}=require('./series-artifact-targets');
const {validateInventoryArtifactScope}=require('./inventory-artifact-scope');
function seriesPlacementContext(packageValue,inventoryArtifactScopes) {
  const context=seriesArtifactContext(packageValue);
  if(context&&inventoryArtifactScopes!==undefined) {
    const members=packageValue.productMaterialManifest.members.filter(item=>item.role==='metadata_sidecar');
    if(!Array.isArray(inventoryArtifactScopes)||inventoryArtifactScopes.length!==members.length)
      throw new Error('Aftercare placement requires exact registered NFO scope coverage.');
    const targets=new Map(),requirements=new Set();
    for(const {materialKey,scope} of inventoryArtifactScopes) {
      validateInventoryArtifactScope(scope);
      const sourceFacts=packageValue.productFactManifest.items.filter(item=>item.factKind==='product_metadata'&&
        item.sourcePackageId===scope.sourcePackageId);
      if(targets.has(materialKey)||!members.some(member=>member.materialKey===materialKey)||
          sourceFacts.length!==1||(scope.episodeScope&&!sourceFacts[0].factValue.episodeMetadata.some(item=>
            item.episodeScope.episodeKey===scope.episodeScope.episodeKey))||
          requirements.has(scope.requirementDigest)||scope.seasonNumber!==context.seasonNumber||
          (scope.episodeScope&&!context.scopes.some(item=>item.episodeKey===scope.episodeScope.episodeKey&&
            item.episodeNumber===scope.episodeScope.episodeNumber)))
        throw new Error('Aftercare placement NFO scope is ambiguous or outside current Inventory.');
      targets.set(materialKey,scope);requirements.add(scope.requirementDigest);
    }
    return Object.freeze({...context,inventoryNfoScopes:targets});
  }
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
    const target=context.inventoryNfoScopes?context.inventoryNfoScopes.get(member.materialKey):seriesNfoTarget(context,member);
    if(!target)throw new Error('Aftercare placement NFO has no registered target.');
    const {episodeScope}=target;
    return episodeScope?prefix+'E'+String(episodeScope.episodeNumber).padStart(2,'0'):'season';
  }
  return baseStem;
}
module.exports=Object.freeze({seriesPlacementContext,seriesMemberStem});
