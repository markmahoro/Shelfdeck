'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {faceModelReference}=require('../../../contracts/us-adult-face-model');
const SCHEMA='helix://contracts/domain-types/UsAdultAnalysisBasis/v1';
const fail=message=>{throw Object.assign(new Error(message),{code:'US_ADULT_ANALYSIS_BASIS_INVALID'});};
function parameters(values){return Object.keys(values).sort().map(parameter=>{
  const value={parameter,valueType:Number.isSafeInteger(values[parameter])?'integer':typeof values[parameter],value:values[parameter]};
  return Object.freeze({...value,valueDigest:canonicalDigest(value)});
});}
function samplingPlan(durationMs){
  const value={contractId:canonicalDigest({schema:'libra.us-adult-sampling-id@1',durationMs}),revision:1,
    schemaRef:'helix://contracts/domain-types/SamplingPlan/v1',intervalMs:Math.min(86400000,Math.max(1,Math.floor(durationMs/20))),maxFrames:20,
    frameProfileDigest:canonicalDigest({schema:'libra.us-adult-frame-profile@1',format:'jpeg',width:1280,height:1280,fit:'inside',quality:2}),
    typedParameters:parameters({duration_ms:durationMs,strategy:'uniform_centers',sample_count:20})};
  return Object.freeze({...value,digest:canonicalDigest(value)});
}
function clusterParameters(model){
  const value={parameterSetId:canonicalDigest({schema:'libra.us-adult-cluster-id@1',modelRefDigest:model.digest}),revision:1,
    schemaRef:'helix://contracts/domain-types/ClusterParameters/v1',modelRefDigest:model.digest,distanceMetric:'cosine',distanceThreshold:0.35,minClusterSize:1,
    typedParameters:parameters({algorithm:'single_linkage',preserve_member_vectors:true})};
  return Object.freeze({...value,digest:canonicalDigest(value)});
}
function referencePageSet(pages){
  if(!Array.isArray(pages)||!pages.length)fail('A complete People reference page set is required.');
  const libraryDigest=pages[0].libraryDigest,total=pages[0].totalPersonCount;let count=0,previous=null;
  for(const [ordinal,page] of pages.entries()){
    const {pageDigest,...body}=page;
    if(page.schemaRef!=='helix://contracts/domain-types/PeopleReferenceLibraryPage/v1'||page.libraryKind!=='us_adult'||page.libraryDigest!==libraryDigest||
      page.totalPersonCount!==total||canonicalDigest(body)!==pageDigest||!Array.isArray(page.items)||page.items.length>256||
      Buffer.byteLength(canonicalJson(page),'utf8')>512*1024||page.nextCursor!==(ordinal===pages.length-1?null:page.items.at(-1)?.personId)||
      (!page.items.length&&(total!==0||pages.length!==1)))fail('Reference pages are incomplete, changed or not terminal.');
    for(const item of page.items){
      const {snapshotDigest,...snapshot}=item;
      if(item.libraryKind!=='us_adult'||canonicalDigest(snapshot)!==snapshotDigest||item.personId!==item.referenceProjection.personId||
        item.personRevision!==item.referenceProjection.personRevision||previous!==null&&Buffer.compare(Buffer.from(previous),Buffer.from(item.personId))>=0)
        fail('Reference snapshots must be unique, version-bound and ordered across every page.');
      previous=item.personId;count++;
    }
  }
  if(count!==total)fail('Reference pages do not cover the complete frozen library.');
  return Object.freeze({referenceLibraryDigest:libraryDigest,personCount:count,pageCount:pages.length,
    pageSetDigest:canonicalDigest({schema:'libra.us-adult-reference-pages@1',items:pages.map((page,ordinal)=>({ordinal,payloadDigest:canonicalDigest(page)}))})});
}
function buildUsAdultAnalysisBasis({snapshot,sourceHandle,sourceProbeRecord,workspaceId,referencePages}){
  const probe=sourceProbeRecord?.result;
  if(snapshot?.spec.contentProfile!=='western_adult'||snapshot.materialInputForm!=='stream_file'||snapshot.members.filter(item=>item.role==='primary_payload').length!==1||
    sourceHandle.ownerDomain!=='libra'||sourceHandle.ownerScope?.scopeId!==snapshot.run.libraRunId||
    sourceProbeRecord?.outcomeKind!=='succeeded'||sourceProbeRecord.capabilityRef!=='shared.material.media.probe@1'||
    probe?.sourceHandleDigest!==canonicalDigest(sourceHandle)||probe.resultKind!=='probed'||canonicalDigest(probe)!==sourceProbeRecord.resultDigest||
    !Number.isSafeInteger(probe.durationMs)||probe.durationMs<1)fail('US Adult analysis requires its unique formal same-Run source Probe.');
  const model=faceModelReference('western_frame_set'),sourceProbeRef=Object.fromEntries(['workId','attemptId','planId','eventId','resultId','resultDigest','inputBindingDigest'].map(key=>[key,sourceProbeRecord[key]])),
    value={schemaRef:SCHEMA,schemaVersion:1,contentProfile:'western_adult',libraRunId:snapshot.run.libraRunId,subjectId:snapshot.run.subjectId,
      expectedRunStateRevision:snapshot.run.stateRevision,runExecutionBasisDigest:snapshot.run.executionBasisDigest,resolvedIdentityDigest:snapshot.resolvedIdentityDigest,
      workspaceId,sourceHandle,sourceProbeRef,durationMs:probe.durationMs,faceModelRef:model,referenceModelRefDigest:faceModelReference('single_reference_face').digest,
      clusterParameters:clusterParameters(model),samplingPlan:samplingPlan(probe.durationMs),...referencePageSet(referencePages)},basisDigest=canonicalDigest(value),
    analysisId=canonicalDigest({schema:'libra.us-adult-analysis-basis-id@1',libraRunId:value.libraRunId,basisDigest});
  return Object.freeze({...value,analysisId,basisDigest});
}
function assertUsAdultAnalysisBasis(basis,pages){
  const {analysisId,basisDigest,...value}=basis||{},expectedId=canonicalDigest({schema:'libra.us-adult-analysis-basis-id@1',libraRunId:value.libraRunId,basisDigest});
  if(basis?.schemaRef!==SCHEMA||basis.schemaVersion!==1||value.contentProfile!=='western_adult'||canonicalDigest(value)!==basisDigest||analysisId!==expectedId||
    Buffer.byteLength(canonicalJson(basis),'utf8')>32*1024||canonicalDigest(basis.faceModelRef)!==canonicalDigest(faceModelReference('western_frame_set'))||
    basis.referenceModelRefDigest!==faceModelReference('single_reference_face').digest||canonicalDigest(basis.clusterParameters)!==canonicalDigest(clusterParameters(basis.faceModelRef))||
    canonicalDigest(basis.samplingPlan)!==canonicalDigest(samplingPlan(basis.durationMs)))fail('US Adult analysis Basis digest, model or sampling parameters changed.');
  if(pages){const expected=referencePageSet(pages);for(const key of Object.keys(expected))if(expected[key]!==basis[key])fail('US Adult analysis pages differ from the frozen Basis.');}
  return basis;
}
module.exports=Object.freeze({SCHEMA,buildUsAdultAnalysisBasis,assertUsAdultAnalysisBasis,referencePageSet,samplingPlan,clusterParameters});
