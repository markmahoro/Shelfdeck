'use strict';
const {artifactRequirement}=require('../../../contracts/product-artifact-requirement');
function seriesPlacementContext(packageValue) {
  if(packageValue.productStructureSnapshot?.structureKind!=='season')return null;
  const identity=packageValue.resolvedIdentitySnapshot?.factValue;
  const provider=identity?.providerIdentities?.find(item=>item.namespace==='tmdb_series');
  const seasonNumber=provider?.seasonNumber;
  if(!Number.isSafeInteger(seasonNumber)||seasonNumber<1)throw new Error('Series placement requires its exact positive Season identity.');
  const metadata=packageValue.productFactManifest?.items?.find(item=>item.factKind==='product_metadata')?.factValue;
  const scopes=metadata?.episodeMetadata?.map(item=>item.episodeScope)||[];
  if(!scopes.length||scopes.some(scope=>scope.seasonNumber!==seasonNumber))throw new Error('Series placement requires exact Episode metadata scopes.');
  return Object.freeze({seasonNumber,scopes,packageValue});
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
    const artifacts=packageValue.artifactManifest.items.filter(item=>item.artifactKind==='nfo'&&item.artifactDigest===member.workspaceMaterialHandle?.digestHex);
    if(artifacts.length!==1)throw new Error('Series NFO must bind one exact published Artifact.');
    const target=scopes.filter(scope=>artifactRequirement('nfo',scope).requirementDigest===artifacts[0].requirementDigest);
    if(target.length===1)return prefix+'E'+String(target[0].episodeNumber).padStart(2,'0');
    if(artifacts[0].requirementDigest===artifactRequirement('nfo').requirementDigest)return 'season';
    throw new Error('Series NFO Artifact target is outside the frozen Episode scope.');
  }
  return baseStem;
}
module.exports=Object.freeze({seriesPlacementContext,seriesMemberStem});
