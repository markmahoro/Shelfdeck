'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {faceModelReference}=require('../../../contracts/us-adult-face-model');

const POLICY=Object.freeze({schema:'people.us-adult-recommendation-policy@1',similarityThreshold:0.65,pageSize:64,maximumPublished:5}),
  SOURCE_SCHEMA='helix://contracts/domain-types/UsAdultRecommendationSource/v1',IMAGE_SCHEMA='people.us-adult-recommendation-image-evidence@1',
  MODEL_DIGEST=faceModelReference('western_frame_set').digest;
const ordered=(a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b));
function fail(message){throw Object.assign(new TypeError(message),{code:'PEOPLE_RECOMMENDATION_EVIDENCE_INVALID'});}
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');}
function feature(value){
  if(!Array.isArray(value)||value.length!==128||value.some(item=>!Number.isFinite(item))||
    Math.abs(value.reduce((sum,item)=>sum+item*item,0)-1)>1e-5)fail('Recommendation features must use the pinned normalized dimension.');
  return value;
}
function observation(source,image){
  const {sourceDigest,...sourceBody}=source||{},{evidenceDigest,...imageBody}=image||{};
  if(source?.schemaRef!==SOURCE_SCHEMA||source.schemaVersion!==1||canonicalDigest(sourceBody)!==sourceDigest||
    !exact(image,['schema','sourceDigest','modelRefDigest','analysisDigest','clusterId','clusterFaceCount','faceDigest','frameOrdinal',
      'imageDigest','width','height','box','qualityScore','vector','evidenceDigest'])||image.schema!==IMAGE_SCHEMA||
    image.sourceDigest!==sourceDigest||canonicalDigest(imageBody)!==evidenceDigest||image.modelRefDigest!==MODEL_DIGEST||
    image.modelRefDigest!==source.faceEmbeddingSetHandle?.faceModelRefDigest||!Number.isFinite(image.qualityScore)||image.qualityScore<0||image.qualityScore>1||
    !Number.isSafeInteger(image.clusterFaceCount)||image.clusterFaceCount<1||image.clusterFaceCount>1280)
    fail('Recommendation observation must conserve the exact formal Source and pinned image evidence.');
  feature(image.vector);
  const body={schema:'people.us-adult-recommendation-observation@1',source,image};
  return Object.freeze({...body,observationDigest:canonicalDigest(body)});
}
function assertObservation(value){
  if(!exact(value,['schema','source','image','observationDigest'])||canonicalJson(observation(value.source,value.image))!==canonicalJson(value))
    fail('Recommendation observation changed.');
  return value;
}
function similarity(a,b){
  const square=value=>value.reduce((sum,item)=>sum+item*item,0);
  return Math.max(-1,Math.min(1,a.reduce((sum,item,index)=>sum+item*b[index],0)/Math.sqrt(square(a)*square(b))));
}
function assertGroup(group){
  const {groupDigest,...body}=group||{};
  if(!exact(group,['schema','groupId','coverageCount','representative','groupDigest'])||group.schema!=='people.us-adult-recommendation-group@1'||
    !/^[a-f0-9]{64}$/.test(group.groupId)||!Number.isSafeInteger(group.coverageCount)||group.coverageCount<1||canonicalDigest(body)!==groupDigest)
    fail('Recommendation group identity, count or digest changed.');
  assertObservation(group.representative);return group;
}
function bestGroup(candidate,page,previous=null){
  assertObservation(candidate);
  if(!Array.isArray(page)||page.length>POLICY.pageSize||previous!==null&&(!exact(previous,['groupId','score'])||
    !/^[a-f0-9]{64}$/.test(previous.groupId)||!Number.isFinite(previous.score)||previous.score<POLICY.similarityThreshold||previous.score>1))
    fail('Recommendation matching requires a bounded page and exact saved comparison cursor.');
  let best=previous;
  for(const group of page){
    assertGroup(group);
    const score=similarity(candidate.image.vector,group.representative.image.vector);
    if(score>=POLICY.similarityThreshold&&(!best||score>best.score||score===best.score&&ordered(group.groupId,best.groupId)<0))
      best=Object.freeze({groupId:group.groupId,score});
  }
  return best;
}
function addToGroup(group,candidate){
  assertObservation(candidate);if(group)assertGroup(group);
  if(group&&(candidate.source.sourceId===group.representative.source.sourceId||group.coverageCount===Number.MAX_SAFE_INTEGER))
    fail('A source cannot increase the same group coverage twice or exceed the safe count.');
  const representative=!group||candidate.image.qualityScore>group.representative.image.qualityScore||
    candidate.image.qualityScore===group.representative.image.qualityScore&&ordered(candidate.source.sourceId,group.representative.source.sourceId)<0
    ?candidate:group.representative,
    body={schema:'people.us-adult-recommendation-group@1',groupId:group?.groupId||canonicalDigest({schema:POLICY.schema,sourceId:candidate.source.sourceId}),
      coverageCount:(group?.coverageCount||0)+1,representative};
  return Object.freeze({...body,groupDigest:canonicalDigest(body)});
}
function rankGroups(page,previous=[]){
  if(!Array.isArray(page)||page.length>POLICY.pageSize||!Array.isArray(previous)||previous.length>POLICY.maximumPublished)
    fail('Recommendation ranking requires bounded pages and at most five saved leaders.');
  const all=[...previous,...page];all.forEach(assertGroup);
  if(new Set(all.map(group=>group.groupId)).size!==all.length)fail('Recommendation rank input repeats a group.');
  return Object.freeze(all.sort((a,b)=>b.coverageCount-a.coverageCount||b.representative.image.qualityScore-a.representative.image.qualityScore||
    ordered(a.groupId,b.groupId)).slice(0,POLICY.maximumPublished));
}
function initialProgress(windowKey){return assertProgress({schema:'people.us-adult-recommendation-progress@1',policy:POLICY,stage:'source_scan',sourceCursor:null,
  sourceExhausted:false,pendingSourceId:null,groupCursor:null,bestGroup:null,rankSourceCursor:null,rankGroupCursor:null,leaders:[],windowKey,assignedSinceRank:0,rankPassId:null});}
function assertProgress(progress){
  const nullableId=value=>value===null||typeof value==='string'&&value.length>0&&value.length<=256,hash=value=>/^[a-f0-9]{64}$/.test(value||'');
  if(!exact(progress,['schema','policy','stage','sourceCursor','sourceExhausted','pendingSourceId','groupCursor','bestGroup','rankSourceCursor','rankGroupCursor',
    'leaders','windowKey','assignedSinceRank','rankPassId'])||progress.schema!=='people.us-adult-recommendation-progress@1'||canonicalJson(progress.policy)!==canonicalJson(POLICY)||
    !['source_scan','group_scan','refresh_sources','rank_groups'].includes(progress.stage)||!nullableId(progress.sourceCursor)||typeof progress.sourceExhausted!=='boolean'||
    ![progress.pendingSourceId,progress.groupCursor,progress.rankSourceCursor,progress.rankGroupCursor,progress.rankPassId].every(value=>value===null||hash(value))||
    !Number.isSafeInteger(progress.windowKey)||progress.windowKey<1||!Number.isSafeInteger(progress.assignedSinceRank)||progress.assignedSinceRank<0||
    progress.bestGroup!==null&&(!exact(progress.bestGroup,['groupId','score'])||!hash(progress.bestGroup.groupId)||!Number.isFinite(progress.bestGroup.score)||
      progress.bestGroup.score<POLICY.similarityThreshold||progress.bestGroup.score>1)||
    !Array.isArray(progress.leaders)||progress.leaders.length>POLICY.maximumPublished||progress.leaders.some(item=>!exact(item,['groupId','coverageCount','qualityScore','sourceId'])||
      !hash(item.groupId)||!hash(item.sourceId)||!Number.isSafeInteger(item.coverageCount)||item.coverageCount<1||!Number.isFinite(item.qualityScore)||item.qualityScore<0||item.qualityScore>1)||
    new Set(progress.leaders.map(item=>item.groupId)).size!==progress.leaders.length||progress.stage==='group_scan'&&progress.pendingSourceId===null||
    progress.stage==='source_scan'&&(progress.pendingSourceId!==null||progress.groupCursor!==null||progress.bestGroup!==null)||
    ['refresh_sources','rank_groups'].includes(progress.stage)&&progress.rankPassId===null)
    fail('Recommendation progress, policy or durable cursors changed.');
  return Object.freeze(progress);
}
module.exports=Object.freeze({POLICY,observation,assertObservation,assertGroup,bestGroup,addToGroup,rankGroups,initialProgress,assertProgress});
