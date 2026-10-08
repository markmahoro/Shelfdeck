'use strict';
const {canonicalDigest:d}=require('../../../contracts/canonical-json');
const {replacementScopes}=require('./external-material-work');
const {readSeriesExternalImportSet}=require('./series-external-import-results');
const {buildSeriesMediaSpaceBasis}=require('../model/series-media-space');

function processingSources(snapshot,set) {
  return Object.freeze(set.members.map(item=>{
    const handle=item.importRecord.result,keys=item.externalMember.episodeClaims.map(claim=>claim.episodeKey);
    const claims=snapshot.episodeClaims.filter(claim=>keys.includes(claim.episodeKey));
    if(claims.length!==keys.length)throw new Error('External processing source lacks accepted Episode Claims.');
    const member=Object.freeze({materialKey:handle.materialKey,role:'primary_payload',physicalIdentity:handle.physicalIdentity,
      sizeBytes:handle.sizeBytes,episodeClaims:Object.freeze(claims),externalSource:Object.freeze({scopeDigest:set.scope.scopeDigest,
        importWorkId:set.work.workId,importWorkDigest:d(set.work),sourceHandleDigest:d(handle),sourceProbeDigest:d(item.probeRecord.result)})});
    return Object.freeze({member,handle,probe:item.probeRecord.result,item,set});
  }));
}
function readProcessingSources(options,snapshot) {
  return Object.freeze(replacementScopes(snapshot).flatMap(scope=>{
    const set=readSeriesExternalImportSet({snapshot,scope,workResultReader:options.workResultReader});
    return set?processingSources(snapshot,set):[];
  }));
}
function exactProcessingSource(options,snapshot,parameters) {
  const matches=readProcessingSources(options,snapshot).filter(source=>source.member.materialKey===parameters.materialKey&&
    d(source.member)===parameters.memberDigest&&source.set.work.workId===parameters.sourceWorkId);
  if(matches.length!==1)throw new Error('External processing requires one exact durable Import source.');
  return matches[0];
}
function processingSpaceBasis(snapshot,source,media,probe) {
  return buildSeriesMediaSpaceBasis({libraRunId:snapshot.run.libraRunId,runExecutionBasisDigest:snapshot.run.executionBasisDigest,
    episodeKeys:source.set.scope.episodeKeys,members:processingSources(snapshot,source.set).map(item=>{
      const selected=item.member.materialKey===source.member.materialKey,handle=selected&&media?media.workspaceMaterialHandle:item.handle;
      const evidence=selected&&probe?probe:item.probe;
      return {materialKey:item.member.materialKey,memberDigest:d(item.member),handleDigest:d(handle),probeDigest:d(evidence),
        sizeBytes:handle.sizeBytes,episodeKeys:item.member.episodeClaims.map(claim=>claim.episodeKey)};
    })});
}
module.exports=Object.freeze({processingSources,readProcessingSources,exactProcessingSource,processingSpaceBasis});
