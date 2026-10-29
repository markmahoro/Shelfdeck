'use strict';

// Device readiness only permits a fresh Owner check. Replanning a blocked Work
// uses that exact Run/Work Basis and opaque fence in the Foundation write.
function resumeBlockedTranscodeAssessments({libraRunId,hasReadyEncodeDevice,workResultReader,guard,workLifecycle,wake}){
  if(!hasReadyEncodeDevice())return false;
  const works=workResultReader.listWorks({ownerDomain:'libra',processType:'libra_run',processId:libraRunId,
    workKind:'workspace_media_production'});
  let resumed=false;
  for(const work of works){
    if(work.state!=='blocked'||!/^libra-workspace-media-transcode_\d+_assessment-work-/.test(work.work_id))continue;
    const currentWork=workResultReader.status(work.work_id);
    if(!currentWork||currentWork.state!=='blocked')continue;
    if(currentWork.work_id!==work.work_id||currentWork.owner_domain!=='libra'||currentWork.process_type!=='libra_run'||
        currentWork.process_id!==libraRunId||currentWork.work_kind!==work.work_kind||!/^[a-f0-9]{64}$/.test(currentWork.basis_digest||''))
      throw new Error('Blocked Work no longer matches its exact Owner scope.');
    const expectedScope=Object.freeze({ownerDomain:'libra',processType:'libra_run',processId:libraRunId,
      workKind:work.work_kind,executionBasisDigest:currentWork.basis_digest}),decision=guard.check(expectedScope);
    if(decision.kind==='pending')continue;
    if(decision.kind!=='ready'||!decision.readFence)throw new Error('Blocked Work replan requires its exact current Owner fence.');
    try{workLifecycle.settleWork({workId:work.work_id,disposition:'replan'},{readFence:decision.readFence,expectedScope});}
    catch(error){if(['P3_UOW_READ_FENCE_CHANGED','P4_WORK_OWNER_SCOPE_CHANGED'].includes(error?.code))continue;throw error;}
    resumed=true;
  }
  if(resumed)wake();
  return resumed;
}
module.exports=Object.freeze({resumeBlockedTranscodeAssessments});
