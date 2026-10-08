'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {readDirectMediaSelections,seriesSpaceBasisFor}=require('./direct-media-selections');
const {seriesFinalSelectionWork,directMediaSelectionWork,remuxMediaSelectionWork,transcodeMediaSelectionWork}=require('./media-production-work');
const {buildMediaRequirement,buildProductMediaCandidateInput,buildProductMediaVerification,
  buildProductOutputSelectionInput,selectProductOutput}=require('../model/media-production-contracts');
const {replacementScopes,externalImportSelectionWork}=require('./external-material-work');
const {readSeriesExternalImportSet}=require('./series-external-import-results');
const {mergeSeriesExternalCandidates,assertExternalCandidateSets,completeSeriesCandidateSpace}=require('./series-external-candidate-merge');
const {deriveSeriesMemberSizeBudget}=require('../model/series-media-space');
const VERIFY='libra.product_media.verify@1',SELECT='libra.product_output.select@1',PROBE='shared.material.media.probe@1';
const stable=(prefix,value)=>prefix+canonicalDigest(value).slice(0,40);

function selectionInput(snapshot,input,verification) {
  return buildProductOutputSelectionInput({libraRunId:snapshot.run.libraRunId,acceptanceSpecId:snapshot.spec.acceptanceSpecId,
    acceptanceSpecRecordDigest:snapshot.spec.recordDigest,mediaRequirementDigest:input.mediaRequirement.requirementDigest,
    rankedCandidates:[{rank:1,candidateId:input.candidateId,candidateNodeId:input.candidateNodeId}],candidates:[verification]});
}
function assertVerification(input,verification) {
  const expected=buildProductMediaVerification({input,verifiedAtMs:verification.verifiedAtMs,playbackVerification:verification.decodeSummary});
  if(canonicalJson(expected)!==canonicalJson(verification))throw new Error('Series candidate Verification differs from its exact source and allocation basis.');
}
function assertSelection(snapshot,input,verification,selection) {
  const expected=selectProductOutput({input:selectionInput(snapshot,input,verification),producedAtMs:selection.producedAtMs});
  if(canonicalJson(expected)!==canonicalJson(selection))throw new Error('Series candidate Selection differs from its exact Verification.');
}
function one(records,capability) {
  const matches=records.filter(item=>item.capabilityRef===capability);
  if(matches.length!==1)throw new Error('Series member Work requires exactly one '+capability+' Result.');
  return matches[0];
}
function workspaceCandidate(options,snapshot,sources,source,work,ordinal=null) {
  const records=options.workResultReader.read(work.workId).filter(item=>item.outcomeKind==='succeeded'),
    capability=ordinal===null?'libra.media.remux@1':'libra.media.transcode@1',mediaRecord=one(records,capability),media=mediaRecord.result,
    probeRecord=one(records,PROBE),verificationRecord=one(records,VERIFY),selectionRecord=one(records,SELECT),
    parameters={materialKey:source.member.materialKey,memberDigest:canonicalDigest(source.member)},
    candidateNodeId=stable(ordinal===null?'remux_output_':'transcode_output_'+ordinal+'_',parameters);
  if(media.sourceMaterialHandleDigest!==canonicalDigest(source.readHandle)||media.workspaceMaterialHandle.processId!==snapshot.run.libraRunId||
      media.workspaceMaterialHandleDigest!==canonicalDigest(media.workspaceMaterialHandle)||
      media.resultDigest!==canonicalDigest(Object.fromEntries(Object.entries(media).filter(([key])=>key!=='resultDigest'))))
    throw new Error('Series produced material does not derive from its frozen Primary.');
  const input=buildProductMediaCandidateInput({libraRunId:snapshot.run.libraRunId,candidateNodeId,candidateKind:'workspace_output',
    mediaRequirement:buildMediaRequirement(snapshot.spec),workspaceMediaHandle:media,sourceProbeEvidence:source.record.result,
    outputProbeEvidence:probeRecord.result,seriesSpaceBasis:seriesSpaceBasisFor(snapshot,sources,[{
      materialKey:source.member.materialKey,media,probe:probeRecord.result}])});
  const verification=verificationRecord.result,selection=selectionRecord.result;
  assertVerification(input,verification);assertSelection(snapshot,input,verification,selection);
  const maxSizeBytes=deriveSeriesMemberSizeBudget({basis:seriesSpaceBasisFor(snapshot,sources),materialKey:source.member.materialKey,
    maxSizeBytes:input.mediaRequirement.space.maxSizeBytes});
  const pendingAggregate=verification.result==='failed'&&verification.reasonCodes.length===1&&
    verification.reasonCodes[0]==='max_size_exceeded'&&maxSizeBytes!==null&&media.workspaceMaterialHandle.sizeBytes<=maxSizeBytes;
  return Object.freeze({...source,work,media,mediaRecord,probeRecord,verification,selection,verificationRecord,selectionRecord,
    eligible:selection.result==='selected'||pendingAggregate});
}

// A candidate is not a final selection. In particular a budget-compliant part
// may await other parts before a new full-set Verification can pass.
function readSeriesProductionCandidates(options,snapshot) {
  const direct=directMediaSelectionWork(snapshot),sources=readDirectMediaSelections(options,snapshot,direct.workId),
    done=new Set(options.workResultReader.listWorks({ownerDomain:'libra',processType:'libra_run',
      processId:snapshot.run.libraRunId,workKind:'workspace_media_production'}).filter(work=>work.state==='succeeded').map(work=>work.work_id));
  const original=Object.freeze(sources.map(source=>{
    if(source.selection.result==='selected')return Object.freeze({...source,work:direct,media:null,mediaRecord:null,
      probeRecord:source.record,eligible:true});
    const remux=remuxMediaSelectionWork(snapshot,source.member);
    if(done.has(remux.workId)) {
      const candidate=workspaceCandidate(options,snapshot,sources,source,remux);
      if(candidate.eligible)return candidate;
    }
    for(let ordinal=1;ordinal<=64;ordinal++) {
      const work=transcodeMediaSelectionWork(snapshot,ordinal,source.member);
      if(!done.has(work.workId))continue;
      const candidate=workspaceCandidate(options,snapshot,sources,source,work,ordinal);
      if(candidate.eligible)return candidate;
    }
    return Object.freeze({...source,work:null,media:null,eligible:false});
  }));
  const sets=replacementScopes(snapshot).filter(scope=>done.has(externalImportSelectionWork(snapshot,scope).workId))
    .map(scope=>require('./series-external-processed-results').readProcessedSet(options,snapshot,
      readSeriesExternalImportSet({snapshot,scope,workResultReader:options.workResultReader})));
  return sets.length?mergeSeriesExternalCandidates(snapshot,original,sets):original;
}

function candidateSetDigest(candidates) {
  assertExternalCandidateSets(candidates);
  if(!candidates.length||candidates.some(item=>!item.eligible||!item.work)||
      new Set(candidates.map(item=>item.member.materialKey)).size!==candidates.length)
    throw new Error('Final Series selection requires a complete unique eligible member set.');
  return canonicalDigest({schema:'libra.series-production-candidate-set@1',members:candidates.map(item=>({
    materialKey:item.member.materialKey,memberDigest:canonicalDigest(item.member),workId:item.work.workId,
    verificationDigest:canonicalDigest(item.verification),mediaDigest:item.media?canonicalDigest(item.media):null,
    probeDigest:canonicalDigest(item.probeRecord.result),...(item.externalReplacement?{replacementMappingDigest:item.externalReplacement.mapping.mappingDigest}:{})})).sort((a,b)=>Buffer.from(a.materialKey).compare(Buffer.from(b.materialKey)))});
}
function finalCandidateInput(snapshot,candidates,candidate) {
  candidateSetDigest(candidates);
  if(!candidates.includes(candidate))throw new Error('Final Series candidate is outside the frozen set.');
  return buildProductMediaCandidateInput({libraRunId:snapshot.run.libraRunId,
    candidateNodeId:stable('series_final_', {materialKey:candidate.member.materialKey,memberDigest:canonicalDigest(candidate.member)}),
    candidateKind:candidate.media?'workspace_output':'direct_input',mediaRequirement:buildMediaRequirement(snapshot.spec),
    sourceProbeEvidence:candidate.record.result,...(candidate.media?{workspaceMediaHandle:candidate.media,outputProbeEvidence:candidate.probeRecord.result}:
      {sourceMaterialHandle:candidate.readHandle}),seriesSpaceBasis:completeSeriesCandidateSpace(snapshot,candidates)});
}
function readSeriesMediaSelections(options,snapshot,workId) {
  if(workId===directMediaSelectionWork(snapshot).workId)return Object.freeze(readDirectMediaSelections(options,snapshot,workId)
    .map(item=>Object.freeze({...item,media:null,results:Object.freeze([item.verificationRecord,item.selectionRecord])})));
  const candidates=readSeriesProductionCandidates(options,snapshot),work=seriesFinalSelectionWork(snapshot,candidateSetDigest(candidates),
    candidates.map(item=>item.work));
  if(workId!==work.workId)throw new Error('Final Series Selection Work does not match the frozen candidate set.');
  const records=options.workResultReader.read(workId).filter(item=>item.outcomeKind==='succeeded'),
    verifications=records.filter(item=>item.capabilityRef===VERIFY),selections=records.filter(item=>item.capabilityRef===SELECT);
  if(verifications.length!==candidates.length||selections.length!==candidates.length)
    throw new Error('Final Series Results do not cover the complete Primary set.');
  const used=new Set();
  return Object.freeze(candidates.map(candidate=>{
    const input=finalCandidateInput(snapshot,candidates,candidate),matches=verifications.filter(item=>item.result.candidateId===input.candidateId);
    if(matches.length!==1)throw new Error('Final Series Verification is missing or ambiguous.');
    const verificationRecord=matches[0],verification=verificationRecord.result;assertVerification(input,verification);
    const criteria=selectionInput(snapshot,input,verification).criteria,
      selected=selections.filter(item=>item.result.criteriaId===criteria.criteriaId);
    if(selected.length!==1||used.has(selected[0]))throw new Error('Final Series Selection is missing or duplicated.');
    used.add(selected[0]);const selectionRecord=selected[0],selection=selectionRecord.result;
    assertSelection(snapshot,input,verification,selection);
    return Object.freeze({...candidate,verification,selection,verificationRecord,selectionRecord,
      results:Object.freeze([verificationRecord,selectionRecord,...(candidate.media?[candidate.mediaRecord,candidate.probeRecord]:[])])});
  }));
}

module.exports=Object.freeze({readSeriesMediaSelections,readSeriesProductionCandidates,candidateSetDigest,finalCandidateInput,selectionInput,assertVerification,assertSelection});
