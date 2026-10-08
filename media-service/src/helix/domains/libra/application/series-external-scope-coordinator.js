'use strict';
const {externalSearchSelectionWork,externalAcquireVerificationWork,externalImportSelectionWork}=require('../planning/external-material-work');
const {readSeriesExternalImportSet}=require('../planning/series-external-import-results');
function advanceSeriesExternalScope(snapshot,workspace,scope,ports){
  for(const [build,phase,capability,accepted] of [
    [externalSearchSelectionWork,'external_search_selection','libra.external_material.candidate.select@1','selected'],
    [externalAcquireVerificationWork,'external_acquire_verification','libra.external_material.package.verify@1','passed'],
    [externalImportSelectionWork,'external_import_selection',null,null],
  ]){
    const work=build(snapshot,scope),submitted=ports.submit(work),status=ports.reader.status(work.workId);
    if(status?.state!=='succeeded'){
      if(['failed','cancelled'].includes(status?.state))return ports.terminal(work,status);
      return Object.freeze({kind:'pending',phase,libraRunId:snapshot.run.libraRunId,workId:work.workId,
        replayed:submitted.replayed,workspaceId:workspace.workspaceId});
    }
    if(capability){
      const row=ports.result(work,capability);
      if(row.result.result!==accepted)return ports.freeze(work,row,row.result.selectionReasonCode||row.result.reasonCodes?.[0]||'external_package_rejected');
    }
  }
  const imported=readSeriesExternalImportSet({snapshot,scope,workResultReader:ports.reader});
  if(!imported)throw new Error('Successful external Scope Import lacks its complete result set.');
  const set=require('../planning/series-external-processed-results').readProcessedSet({workResultReader:ports.reader},snapshot,imported);
  if(!set.eligible){
    const {processingSources}=require('../planning/series-external-processing-source');
    const {remuxMediaSelectionWork,transcodeStrategyAssessmentWork,transcodeMediaSelectionWork}=require('../planning/media-production-work');
    const {onlyRemuxGapFromVerification,transcodeFixableWithoutSpecExternal}=require('../model/media-production-routing');
    const pending=(work,phase,submitted)=>Object.freeze({kind:'pending',phase,libraRunId:snapshot.run.libraRunId,
      workId:work.workId,replayed:submitted.replayed,workspaceId:workspace.workspaceId});
    for(const source of processingSources(snapshot,imported)) {
      const current=set.members.find(item=>item.externalMember.externalMemberId===source.item.externalMember.externalMemberId);
      if(current.eligible)continue;
      if(!current.productionWork&&onlyRemuxGapFromVerification(current.verificationRecord.result)) {
        const work=remuxMediaSelectionWork(snapshot,source.member),submitted=ports.submit(work),status=ports.reader.status(work.workId);
        if(['failed','cancelled'].includes(status?.state))return ports.terminal(work,status);
        if(status?.state!=='succeeded')return pending(work,'workspace_media_remux_selection',submitted);
        throw new Error('Succeeded external Remux must have been reconstructed before selection.');
      }
      if(!transcodeFixableWithoutSpecExternal(current.verificationRecord.result))continue;
      for(let ordinal=1;ordinal<=64;ordinal++) {
        const assessment=transcodeStrategyAssessmentWork(snapshot,ordinal,source.member),submitted=ports.submit(assessment),
          status=ports.reader.status(assessment.workId);
        if(status?.state!=='succeeded') {
          if(!['failed','cancelled'].includes(status?.state))return pending(assessment,'transcode_strategy_assessment',submitted);
          if(status.state==='failed'&&status.latestAttempt?.failure_code==='media_device_strategies_exhausted')break;
          return ports.terminal(assessment,status);
        }
        const record=ports.result(assessment,'libra.transcode.input.verify@1');
        if(record.result.disposition==='integrity_rejected')return ports.freeze(assessment,record,'source_integrity_rejected');
        if(record.result.disposition==='strategy_rejected')continue;
        if(record.result.disposition!=='compatible')throw new Error('External Series Assessment has an invalid disposition.');
        const work=transcodeMediaSelectionWork(snapshot,ordinal,source.member),workSubmitted=ports.submit(work),workStatus=ports.reader.status(work.workId);
        if(workStatus?.state!=='succeeded') {
          if(!['failed','cancelled'].includes(workStatus?.state))return pending(work,'workspace_media_transcode_selection',workSubmitted);
          return ports.terminal(work,workStatus);
        }
        const processed=require('../planning/series-external-processed-results').readProcessedMember({workResultReader:ports.reader},snapshot,source,ordinal);
        if(processed.eligible)throw new Error('Eligible external output must have been reconstructed before scheduling.');
        const frozen=ports.freezeMeasured?.(work,processed.verificationRecord,false);
        if(frozen)return frozen;
      }
      const frozen=ports.freezeMeasured?.(current.productionWork||set.work,current.verificationRecord,true);
      if(frozen)return frozen;
    }
    const rejected=set.members.find(item=>!item.eligible);
    return ports.freeze(rejected.productionWork||set.work,rejected.verificationRecord,rejected.verificationRecord.result.reasonCodes?.[0]||'external_output_rejected');
  }
  for(const item of set.members){
    const keys=item.externalMember.episodeClaims.map(claim=>claim.episodeKey),claims=snapshot.episodeClaims.filter(claim=>keys.includes(claim.episodeKey));
    if(claims.length!==keys.length)throw new Error('External Workspace attachment lacks exact accepted Episode Claims.');
    ports.attach(item.workspaceMediaHandle.workspaceMaterialHandle,Object.freeze(claims));
  }
  return Object.freeze({kind:'series_external_ready',scopeDigest:scope.scopeDigest});
}
module.exports=Object.freeze({advanceSeriesExternalScope});
