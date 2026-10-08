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
  const set=readSeriesExternalImportSet({snapshot,scope,workResultReader:ports.reader});
  if(!set)throw new Error('Successful external Scope Import lacks its complete result set.');
  if(!set.eligible){
    const rejected=set.members.find(item=>!item.eligible);
    return ports.freeze(set.work,rejected.verificationRecord,rejected.verificationRecord.result.reasonCodes?.[0]||'external_output_rejected');
  }
  for(const item of set.members){
    const keys=item.externalMember.episodeClaims.map(claim=>claim.episodeKey),claims=snapshot.episodeClaims.filter(claim=>keys.includes(claim.episodeKey));
    if(claims.length!==keys.length)throw new Error('External Workspace attachment lacks exact accepted Episode Claims.');
    ports.attach(item.importRecord.result,Object.freeze(claims));
  }
  return Object.freeze({kind:'series_external_ready',scopeDigest:scope.scopeDigest});
}
module.exports=Object.freeze({advanceSeriesExternalScope});
