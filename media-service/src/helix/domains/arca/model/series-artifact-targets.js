'use strict';
const {artifactRequirement}=require('../../../contracts/product-artifact-requirement');

function seriesArtifactContext(packageValue) {
  if(packageValue.productStructureSnapshot?.structureKind!=='season')return null;
  const value=packageValue.resolvedIdentitySnapshot?.factValue;
  const identity=value?.resolvedProductIdentity||value;
  const providers=identity?.providerIdentities?.filter(item=>item.namespace==='tmdb_series')||[];
  const seasonNumber=providers[0]?.seasonNumber;
  if(providers.length!==1||!Number.isSafeInteger(seasonNumber)||seasonNumber<1)
    throw new Error('Series placement requires its exact positive Season identity.');
  const scopes=(packageValue.productFactManifest?.items||[]).filter(item=>item.factKind==='product_metadata')
    .flatMap(item=>item.factValue?.episodeMetadata||[]).map(item=>item.episodeScope);
  if(!scopes.length||scopes.length>1024||scopes.some(scope=>scope?.seasonNumber!==seasonNumber)||
      new Set(scopes.map(scope=>scope.episodeKey)).size!==scopes.length)
    throw new Error('Series placement requires exact unique Episode metadata scopes.');
  for(const scope of scopes)artifactRequirement('nfo',scope);
  return Object.freeze({seasonNumber,scopes:Object.freeze(scopes.map(scope=>Object.freeze({...scope}))),packageValue});
}

function seriesNfoTarget(context,member) {
  if(member.role!=='metadata_sidecar')throw new TypeError('Series NFO target requires a metadata sidecar member.');
  const artifacts=context.packageValue.artifactManifest.items.filter(item=>item.artifactKind==='nfo'&&
    item.artifactDigest===member.workspaceMaterialHandle?.digestHex);
  if(artifacts.length!==1)throw new Error('Series NFO must bind one exact published Artifact.');
  const artifact=artifacts[0],targets=context.scopes.filter(scope=>
    artifactRequirement('nfo',scope).requirementDigest===artifact.requirementDigest);
  if(targets.length===1)return Object.freeze({artifact,episodeScope:targets[0]});
  if(artifact.requirementDigest===artifactRequirement('nfo').requirementDigest)
    return Object.freeze({artifact,episodeScope:null});
  throw new Error('Series NFO Artifact target is outside the frozen Episode scope.');
}

function seriesNfoTargets(packageValue) {
  const context=seriesArtifactContext(packageValue);
  if(!context)return Object.freeze([]);
  const materials=new Set(),requirements=new Set();
  const targets=packageValue.productMaterialManifest.members.filter(member=>member.role==='metadata_sidecar').map(member=>{
    if(!member.materialKey||materials.has(member.materialKey))throw new Error('Series NFO materials must be unique.');
    materials.add(member.materialKey);
    const target=seriesNfoTarget(context,member);
    if(requirements.has(target.artifact.requirementDigest))throw new Error('Series NFO target has more than one physical member.');
    requirements.add(target.artifact.requirementDigest);
    return Object.freeze({sourceMaterialKey:member.materialKey,artifact:target.artifact,episodeScope:target.episodeScope});
  });
  return Object.freeze(targets.sort((a,b)=>Buffer.from(a.sourceMaterialKey).compare(Buffer.from(b.sourceMaterialKey))));
}

module.exports=Object.freeze({seriesArtifactContext,seriesNfoTarget,seriesNfoTargets});
