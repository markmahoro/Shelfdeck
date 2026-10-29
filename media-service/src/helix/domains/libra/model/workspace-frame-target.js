'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
function buildWorkspaceFrameTarget({basis,workspace,rootSnapshot,targetRelativePath = 'analysis/frames/' + basis.analysisId + '.json',samplingPlan = basis.samplingPlan}) {
  if (!workspace || workspace.state !== 'active' || workspace.libraRunId !== basis.libraRunId) throw new Error('US Adult frame target requires its active Run Workspace.');
  const outputKind = 'frame_set',
    sourceInputDigest = canonicalDigest({sourceHandle:basis.sourceHandle, samplingPlan}),
    targetId = canonicalDigest({schema:'libra.workspace-artifact-output-target-id@1', workspaceId:basis.workspaceId, targetRelativePath, outputKind, sourceInputDigest}),
    value = {targetId, libraRunId:basis.libraRunId, executionBasisDigest:basis.runExecutionBasisDigest, workspaceId:basis.workspaceId,
      expectedWorkspaceRevision:workspace.currentRevision, expectedWorkspaceStateDigest:workspace.stateDigest, rootSnapshot,
      workspaceScopeDigest:workspace.workspaceScopeDigest, targetRelativePath, outputKind, sourceInputDigest};
  const effectScopeDigest = canonicalDigest({schema:'libra.workspace-artifact-output-effect-scope@1', targetId, libraRunId:value.libraRunId,
    executionBasisDigest:value.executionBasisDigest, workspaceId:value.workspaceId, expectedWorkspaceRevision:value.expectedWorkspaceRevision,
    expectedWorkspaceStateDigest:value.expectedWorkspaceStateDigest, rootSnapshotDigest:rootSnapshot.snapshotDigest,
    workspaceScopeDigest:value.workspaceScopeDigest, outputKind, sourceInputDigest});
  const target = {...value, effectScopeDigest}; return Object.freeze({...target, targetDigest:canonicalDigest(target)});
}
module.exports=Object.freeze({buildWorkspaceFrameTarget});
