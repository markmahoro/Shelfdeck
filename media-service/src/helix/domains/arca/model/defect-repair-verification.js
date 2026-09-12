'use strict';

const path=require('node:path');
const { canonicalDigest }=require('../../../contracts/canonical-json');

function verifiedDefectRepair(care,receipts,prepared) {
  const snapshot=care.careRequirement.typedParameters.find(item=>item.parameter==='target.acceptedGaps');
  if(!snapshot)return null;
  if(snapshot.valueDigest!==canonicalDigest(snapshot.value))throw new Error('Accepted gap objective digest is invalid.');
  const gaps=JSON.parse(snapshot.value),fixed=[];
  const exact=receipts.filter(item=>item.scopeId===care.aftercareCaseId&&item.scopeDigest===care.careRequirementDigest);
  for(const gap of gaps) {
    if(gap.targetKind==='media'&&exact.some(item=>item.materialEffectKind==='primary_replace')&&prepared.some(row=>
      row.capabilityRef==='arca.aftercare.media.verify@1'&&row.result?.result==='passed'&&
      row.result.aftercareCaseId===care.aftercareCaseId&&row.result.careRequirementDigest===care.careRequirementDigest))fixed.push(gap.gapDigest);
    if(gap.targetKind==='artifact') {
      const artifact=gap.targetId,output=prepared.some(row=>artifact==='nfo'
        ?row.capabilityRef==='arca.aftercare.text_artifact.render@1'&&row.result?.artifactKind==='nfo'
        :row.capabilityRef==='arca.aftercare.binary_artifact.acquire@1'&&row.result?.resultKind==='acquired'&&row.result.artifactHandle?.artifactKind===artifact);
      if(output&&exact.some(item=>item.materialEffectKind==='artifact_materialize'&&(artifact==='nfo'
        ?path.extname(item.targetLocation).toLowerCase()==='.nfo':/\.(jpg|jpeg|png|webp)$/i.test(item.targetLocation))))fixed.push(gap.gapDigest);
    }
  }
  return Object.freeze({gaps,gapSetDigest:canonicalDigest(gaps),fixedGapDigests:[...new Set(fixed)].sort()});
}
module.exports=Object.freeze({verifiedDefectRepair});
