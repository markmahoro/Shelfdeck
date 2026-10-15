'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {createJavCorrectionCommitStore}=require('../persistence/jav-correction-commit-store');
const {CAPABILITY:ASSETS_CAPABILITY}=require('../model/jav-correction-execution-contract');
const {recoveryWorkId}=require('../model/jav-correction-recovery');
const {CAPABILITY:RETIREMENT_CAPABILITY,RESULT_SCHEMA:RETIREMENT_RESULT,retirementWorkId}=require('../model/jav-correction-retirement-contract');
const {SCHEMA,buildJavCorrectionWorkspaceReclaimPlan}=require('../model/jav-correction-workspace-reclaim');
const {buildWorkspaceReclaimScope}=require('../model/jav-correction-workspace-reclaim-contract');
const fail=()=>{throw Object.assign(new Error('Workspace reclaim requires exact succeeded predecessor Works and committed provenance.'),
  {code:'ARCA_JAV_CORRECTION_WORKSPACE_RECLAIM_NOT_READY'});};
function createJavCorrectionWorkspaceReclaimPreparation(options){
  const commitStore=createJavCorrectionCommitStore(options);
  function predecessor(correctionId,workId,basisDigest,capabilityRef){
    const work=options.workResultReader.status(workId);
    if(work?.owner_domain!=='arca'||work.process_type!=='arca_jav_identity_correction'||work.process_id!==correctionId||
        work.state!=='succeeded'||work.basis_digest!==basisDigest)fail();
    const rows=options.workResultReader.read(workId).filter(row=>row.capabilityRef===capabilityRef&&row.outcomeKind==='succeeded'&&row.state==='succeeded');
    const expectedSchemaRef=capabilityRef===RETIREMENT_CAPABILITY?RETIREMENT_RESULT:
      'helix://contracts/capabilities/arca.jav_correction.assets.prepare/v1/result';
    if(rows.length!==1||rows[0].resultSchemaRef!==expectedSchemaRef||rows[0].resultDigest!==canonicalDigest(rows[0].result))fail();
    options.contractValidator.validate(rows[0].result.schemaRef,rows[0].result);return rows[0];
  }
  function prepare(correctionId){
    const record=options.correctionStore.get(correctionId),committed=commitStore.readCommitted(correctionId);
    if(record?.state!=='committed'||!committed||!['pending','active','attention_required'].includes(record.cleanupState))fail();
    const filePlan=committed.committedContext.filePlan,scopeDigest=filePlan.scopeDigest,
      assetsWorkId=recoveryWorkId(record,'jav_correction_assets','arca-jav-correction-assets-work-'+canonicalDigest({correctionId,scopeDigest}).slice(0,40)),
      assets=predecessor(correctionId,assetsWorkId,scopeDigest,ASSETS_CAPABILITY),
      retirement=options.retirementPreparation.readScope(correctionId),
      formal=predecessor(correctionId,retirementWorkId(retirement.scope,record),retirement.scope.digest,RETIREMENT_CAPABILITY),
      registry=options.workspaceStore.inspectCommitted(correctionId,committed.committedContext.contextDigest);
    if(formal.result.scopeDigest!==retirement.scope.digest||formal.result.retirementPlanDigest!==retirement.plan.planDigest||formal.result.guardDigest!==retirement.plan.guardDigest||
        assets.result.schemaRef!=='helix://contracts/types/JavCorrectionAssetsPrepared/v1')fail();
    const value=buildJavCorrectionWorkspaceReclaimPlan({record,committedContext:committed.committedContext,prepared:assets.result,
        formalRetirementResult:formal.result,registry,rootSnapshot:options.rootSnapshot});
    options.contractValidator.validate(SCHEMA,value);
    return {record,plan:value,scope:buildWorkspaceReclaimScope(record,value),predecessors:[
      {workId:assetsWorkId,eventId:assets.eventId,capabilityRef:ASSETS_CAPABILITY,basisDigest:scopeDigest,resultSchemaRef:assets.resultSchemaRef,resultDigest:assets.resultDigest},
      {workId:retirementWorkId(retirement.scope,record),eventId:formal.eventId,capabilityRef:RETIREMENT_CAPABILITY,basisDigest:retirement.scope.digest,resultSchemaRef:formal.resultSchemaRef,resultDigest:formal.resultDigest}]};
  }
  return Object.freeze({prepare:correctionId=>prepare(correctionId).plan,readScope:prepare});
}
module.exports=Object.freeze({createJavCorrectionWorkspaceReclaimPreparation});
