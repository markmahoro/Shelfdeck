'use strict';
const {canonicalDigest:d,canonicalJson}=require('../../../contracts/canonical-json');
const {processingSources,processingSpaceBasis}=require('./series-external-processing-source');
const {remuxMediaSelectionWork}=require('./media-production-work');
const {replacementBasis}=require('./external-material-work');
const {buildSeriesReplacementMapping}=require('../model/series-external-replacement');
const media=require('../model/media-production-contracts');
const stable=(prefix,value)=>prefix+d(value).slice(0,40);
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
function requireValue(condition){if(!condition)throw new Error('External processed result differs from its exact Import source and Work.');}

function readRemux(options,snapshot,source) {
  const work=remuxMediaSelectionWork(snapshot,source.member),reader=options.workResultReader,status=reader.status(work.workId);
  if(status?.state!=='succeeded')return null;
  const definition=reader.readDefinition(work.workId),attemptId=status.latestAttempt?.attempt_id;
  requireValue(definition&&same(definition.definition,work)&&definition.definitionDigest===d(work)&&
    status.basis_digest===work.executionBasisDigest&&typeof attemptId==='string');
  const rows=reader.read(work.workId).filter(row=>row.attemptId===attemptId),
    planId=stable('libra-workspace-media-plan-',{workId:work.workId,attempt:attemptId});
  requireValue(rows.length===4&&rows.every(row=>row.workId===work.workId&&row.planId===planId&&row.planRevision===1&&
    row.state==='succeeded'&&row.outcomeKind==='succeeded'&&/^[a-f0-9]{64}$/.test(row.planDigest||'')&&
    typeof row.resultId==='string'&&row.resultId.length>0&&row.resultSchemaRef==='helix://contracts/capabilities/'+row.capabilityRef.replace('@1','/v1')+'/result'&&row.resultDigest===d(row.result)&&
    row.inputBindingDigest===d(row.inputBindings))&&new Set(rows.map(row=>row.planDigest)).size===1&&new Set(rows.map(row=>row.eventId)).size===4);
  const one=capability=>{const matches=rows.filter(row=>row.capabilityRef===capability);requireValue(matches.length===1);return matches[0];};
  const produced=one('libra.media.remux@1'),probe=one('shared.material.media.probe@1'),
    verification=one('libra.product_media.verify@1'),selection=one('libra.product_output.select@1'),output=produced.result;
  requireValue(output.sourceMaterialHandleDigest===d(source.handle)&&output.workspaceMaterialHandle.processId===snapshot.run.libraRunId&&
    output.workspaceMaterialHandleDigest===d(output.workspaceMaterialHandle)&&
    output.resultDigest===d(Object.fromEntries(Object.entries(output).filter(([key])=>key!=='resultDigest'))));
  const candidateNodeId=stable('remux_output_',{materialKey:source.member.materialKey,memberDigest:d(source.member)}),
    requirement=media.buildMediaRequirement(snapshot.spec),input=media.buildProductMediaCandidateInput({
      libraRunId:snapshot.run.libraRunId,candidateNodeId,candidateKind:'workspace_output',mediaRequirement:requirement,
      workspaceMediaHandle:output,sourceProbeEvidence:source.probe,outputProbeEvidence:probe.result,
      seriesSpaceBasis:processingSpaceBasis(snapshot,source,output,probe.result)});
  const expected=media.buildProductMediaVerification({input,verifiedAtMs:verification.result.verifiedAtMs,
    playbackVerification:verification.result.decodeSummary});
  requireValue(same(expected,verification.result));
  const selectionInput=media.buildProductOutputSelectionInput({libraRunId:snapshot.run.libraRunId,
    acceptanceSpecId:snapshot.spec.acceptanceSpecId,acceptanceSpecRecordDigest:snapshot.spec.recordDigest,
    mediaRequirementDigest:requirement.requirementDigest,rankedCandidates:[{rank:1,candidateId:input.candidateId,candidateNodeId}],candidates:[expected]});
  requireValue(same(media.selectProductOutput({input:selectionInput,producedAtMs:selection.result.producedAtMs}),selection.result));
  return Object.freeze({...source.item,workspaceMediaHandle:output,productionWork:work,mediaRecord:produced,
    sourceProbeRecord:source.item.probeRecord,probeRecord:probe,verificationRecord:verification,selectionRecord:selection,
    eligible:selection.result.result==='selected'});
}
function readProcessedSet(options,snapshot,set) {
  const members=processingSources(snapshot,set).map(source=>source.item.eligible||!require('../model/media-production-routing').onlyRemuxGapFromVerification(source.item.verificationRecord.result)
    ?source.item:readRemux(options,snapshot,source)||source.item);
  const mapping=buildSeriesReplacementMapping({basis:replacementBasis(snapshot),scope:set.scope,finalMembers:members.map(item=>({
    materialKey:item.workspaceMediaHandle.workspaceMaterialHandle.materialKey,
    memberDigest:d({externalMember:item.externalMember,workspaceMediaHandle:item.workspaceMediaHandle}),
    episodeKeys:item.externalMember.episodeClaims.map(claim=>claim.episodeKey)}))});
  return Object.freeze({...set,members:Object.freeze(members),mapping,eligible:members.every(item=>item.eligible)});
}
module.exports=Object.freeze({readProcessedSet});
