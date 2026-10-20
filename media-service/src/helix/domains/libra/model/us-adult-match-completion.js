'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {pickCompleteMatch,workId,EMBED,CLUSTER}=require('./us-adult-analysis-work');
const SCHEMA='helix://contracts/domain-types/UsAdultMatchCompletion/v1';
function fail(message){throw Object.assign(new Error(message),{code:'US_ADULT_MATCH_COMPLETION_INVALID'});}
function buildCompletion({basis,pages,results,clusterRecord,embeddingRecord}){
  const cluster=clusterRecord?.result,embedding=embeddingRecord?.result;
  for(const [record,capabilityRef]of [[clusterRecord,CLUSTER],[embeddingRecord,EMBED]]){
    if(record?.outcomeKind!=='succeeded'||record.capabilityRef!==capabilityRef||record.workId!==workId(basis,null)||
      canonicalDigest(record.result)!==record.resultDigest)fail('Completion requires exact durable same-Run feature and clustering Results.');
  }
  if(embedding.computationMode!=='western_frame_set'||embedding.faceModelRefDigest!==basis.faceModelRef.digest||
    cluster.faceModelRefDigest!==basis.faceModelRef.digest||cluster.sourceEmbeddingDigest!==embedding.embeddingDigest||
    !Number.isSafeInteger(embedding.detectedFaceCount)||embedding.detectedFaceCount<0||embedding.detectedFaceCount>1280||
    embedding.dimension!==128||embedding.libraRunId!==basis.libraRunId||embedding.workspaceId!==basis.workspaceId||
    cluster.libraRunId!==basis.libraRunId||cluster.workspaceId!==basis.workspaceId||
    embedding.detectedFaceCount!==embedding.vectorCount)fail('Completion feature count, model or cluster source changed.');
  const selected=pickCompleteMatch({basis,pages,results,clusterResult:cluster}),winner=selected&&{
    pageOrdinal:selected.pageOrdinal,personSnapshot:selected.personSnapshot,
    matchResultRef:Object.fromEntries(['workId','attemptId','planId','eventId','resultId','capabilityRef','resultSchemaRef','resultDigest','inputBindingDigest'].map(key=>[key,selected.record[key]])),
    personMatchEvidence:selected.record.result,
  },matchResultSetDigest=canonicalDigest({schema:'libra.us-adult-complete-match-results@1',analysisId:basis.analysisId,
    analysisBasisDigest:basis.basisDigest,items:results.map((record,pageOrdinal)=>({pageOrdinal,workId:record.workId,
      resultDigest:record.resultDigest,inputBindingDigest:record.inputBindingDigest}))}),
    value={schemaRef:SCHEMA,schemaVersion:1,analysisId:basis.analysisId,libraRunId:basis.libraRunId,subjectId:basis.subjectId,
      analysisBasisDigest:basis.basisDigest,completedPageCount:basis.pageCount,detectedFaceCount:embedding.detectedFaceCount,
      matchResultSetDigest,winner};
  return Object.freeze(assertCompletion({...value,completionDigest:canonicalDigest(value)}));
}
function assertCompletion(completion){
  const {completionDigest,...value}=completion||{};
  if(completion?.schemaRef!==SCHEMA||completion.schemaVersion!==1||canonicalDigest(value)!==completionDigest||
    Buffer.byteLength(canonicalJson(completion),'utf8')>256*1024)fail('The frozen complete matching digest or byte bound changed.');
  if(completion.winner){
    const winner=completion.winner,person=winner.personSnapshot,matches=winner.personMatchEvidence?.matches,
      {snapshotDigest,...personValue}=person||{};
    if(completion.detectedFaceCount===0||winner.pageOrdinal>=completion.completedPageCount||!Array.isArray(matches)||matches.length!==1||
      canonicalDigest(winner.personMatchEvidence)!==winner.matchResultRef.resultDigest||person.libraryKind!=='us_adult'||
      canonicalDigest(personValue)!==snapshotDigest||matches[0].personId!==person.personId||matches[0].personRevision!==person.personRevision)
      fail('The completed match winner differs from its frozen Person or source Result.');
  }
  return completion;
}
module.exports=Object.freeze({SCHEMA,buildCompletion,assertCompletion});
