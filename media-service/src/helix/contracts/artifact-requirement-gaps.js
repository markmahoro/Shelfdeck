'use strict';
function requiredArtifactKinds(requirements) {
  return [...new Set([...(requirements.metadata?.requiredArtifactKinds||[]),
    ...(requirements.inventory?.requiredMaterializedArtifactKinds||[]),
    ...(requirements.metadata?.requireRenderableSidecar?['nfo']:[])])].sort();
}
function missingArtifactKinds(requirements,verifiedKinds) {
  const present=new Set(verifiedKinds);
  return requiredArtifactKinds(requirements).filter(kind=>!present.has(kind));
}
function artifactGapCodes(requirements,missingKinds) {
  const missing=new Set(missingKinds),codes=[];
  if(requiredArtifactKinds(requirements).some(kind=>missing.has(kind)))codes.push('metadata_artifact_unmet');
  if(requirements.metadata?.requireRenderableSidecar&&missing.has('nfo'))codes.push('sidecar_unrenderable');
  if(requirements.metadata?.requireDecodableImages&&['poster','fanart'].some(kind=>missing.has(kind)))codes.push('image_undecodable');
  return codes.sort();
}
module.exports=Object.freeze({requiredArtifactKinds,missingArtifactKinds,artifactGapCodes});
