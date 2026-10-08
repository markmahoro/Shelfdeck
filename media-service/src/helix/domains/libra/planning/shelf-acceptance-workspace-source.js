'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
function workspaceAcceptanceSourceMember(snapshot,records,probe,workspacePort){
  const handles=records.filter(row=>row.outcomeKind==='succeeded').map(row=>
    row.capabilityRef==='libra.workspace.material.import@1'?row.result:
      ['libra.media.remux@1','libra.media.transcode@1'].includes(row.capabilityRef)?row.result?.workspaceMaterialHandle:null)
    .filter(handle=>handle&&canonicalDigest(handle)===probe.sourceHandleDigest);
  if(handles.length!==1)throw new Error('Acceptance source requires one exact successful Workspace Handle.');
  const handle=handles[0];
  if(handle.schemaRef!=='helix://contracts/types/WorkspaceMaterialHandle/v1'||handle.ownerDomain!=='libra'||
    handle.processId!==snapshot.run.libraRunId||!Number.isSafeInteger(handle.referenceRevision)||handle.referenceRevision<1||
    handle.sizeBytes!==handle.physicalIdentity?.sizeBytes)
    throw new Error('Acceptance source Workspace Handle does not belong to the selected Run.');
  return Object.freeze({materialKey:handle.materialKey,
    physicalIdentity:Object.freeze({schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,
      materialKey:handle.materialKey,...handle.physicalIdentity}),sizeBytes:handle.sizeBytes,endpointId:handle.endpointId,
    location:workspacePort.resolveMaterialLocation(handle),bindingRevision:handle.referenceRevision});
}
module.exports=Object.freeze({workspaceAcceptanceSourceMember});
