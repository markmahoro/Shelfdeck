'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const body=value=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='memberDigest'));
function reject(){throw Object.assign(new TypeError('Terminal planning evidence must bind an exact rejected Plan and closed Work Attempt.'),{code:'P9_RUN_TERMINAL_PLANNING_EVIDENCE'});}
function validatePlanningMember(value) {
  if(!value||Object.keys(value).sort().join(',')!=='attemptCount,blockerSource,catalogDigest,failureCode,graphDigest,memberDigest,planId,plannerContractRef,plannerVersion,terminalEvidenceDigest,workAttemptId,workBasisDigest,workId'||
      value.blockerSource!=='plan_rejection'||!['workId','planId','workAttemptId','plannerContractRef','failureCode'].every(key=>typeof value[key]==='string'&&value[key].length>0&&value[key].length<=4096)||
      !['workBasisDigest','catalogDigest','graphDigest','terminalEvidenceDigest','memberDigest'].every(key=>/^[a-f0-9]{64}$/.test(value[key]))||
      !Number.isSafeInteger(value.attemptCount)||value.attemptCount<1||!Number.isSafeInteger(value.plannerVersion)||value.plannerVersion<1||
      value.memberDigest!==canonicalDigest({schema:'libra.run-terminal-planning-member@1',...body(value)}))reject();
  return value;
}
function buildPlanningMember({work,plans,attempts,events,libraRunId}) {
  const ordered=[...attempts].sort((a,b)=>Number(a.ordinal)-Number(b.ordinal)),attempt=ordered.at(-1),plan=plans.find(item=>item.attempt_id===attempt?.attempt_id);
  if(!work||work.owner_domain!=='libra'||work.process_type!=='libra_run'||work.process_id!==libraRunId||work.state!=='failed'||
      !attempt||attempt.state!=='failed'||!attempt.failure_code||attempt.finished_at_ms==null||
      ordered.some((item,index)=>Number(item.ordinal)!==index+1||item.basis_digest!==work.basis_digest||!['completed','failed'].includes(item.state))||
      !plan||plan.state!=='contract_unplannable'||plan.basis_digest!==work.basis_digest||events.some(event=>event.work_id===work.work_id))reject();
  const snapshot={workId:work.work_id,workBasisDigest:work.basis_digest,attemptId:attempt.attempt_id,attemptOrdinal:Number(attempt.ordinal),
    attemptState:attempt.state,failureCode:attempt.failure_code,finishedAtMs:Number(attempt.finished_at_ms),planId:plan.plan_id,
    planState:plan.state,plannerContractRef:plan.planner_ref,plannerVersion:Number(plan.planner_version),catalogDigest:plan.catalog_digest,graphDigest:plan.graph_digest};
  const value={blockerSource:'plan_rejection',workId:work.work_id,planId:plan.plan_id,workBasisDigest:work.basis_digest,
    workAttemptId:attempt.attempt_id,plannerContractRef:plan.planner_ref,plannerVersion:Number(plan.planner_version),
    catalogDigest:plan.catalog_digest,graphDigest:plan.graph_digest,failureCode:attempt.failure_code,attemptCount:ordered.length,
    terminalEvidenceDigest:canonicalDigest({schema:'libra.terminal-plan-observation@1',...snapshot})};
  return validatePlanningMember({...value,memberDigest:canonicalDigest({schema:'libra.run-terminal-planning-member@1',...value})});
}
function samePlanningMember(left,right){validatePlanningMember(left);return canonicalJson(left)===canonicalJson(right);}
module.exports=Object.freeze({buildPlanningMember,validatePlanningMember,samePlanningMember});
