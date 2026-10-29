'use strict';
const {canonicalDigest,canonicalJson}=require('./canonical-json');
const {buffaloModelReference}=require('./buffalo-model-reference');
const {catalogueSearchPolicy}=require('./face-catalogue-search-policy');
const SCHEMA='shared.buffalo-catalogue-observation@1',MAX_BYTES=8*1024*1024,MODEL=buffaloModelReference('western_frame_set').digest,
  HASH=/^[a-f0-9]{64}$/;
function fail(message){throw Object.assign(new TypeError(message),{code:'BUFFALO_CATALOGUE_OBSERVATION_INVALID'});}
const integer=(n,min,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(n)&&n>=min&&n<=max,
  text=value=>typeof value==='string'&&value.length>0&&value.length<=256,
  exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function assertCatalogueQueryResult(value,{generationDigest,policyDigest}){
  if(!exact(value,['generationDigest','searchPolicyDigest','raw','matches','retiredSlots'])||value.generationDigest!==generationDigest||
    value.searchPolicyDigest!==policyDigest||!Array.isArray(value.raw)||!value.raw.length||value.raw.length>100||!Array.isArray(value.matches)||value.matches.length>5||
    !Array.isArray(value.retiredSlots)||value.retiredSlots.length>100)fail('The catalogue query lost its exact generation or bounded complete response.');
  const keys=new Set(),raw=new Map(),uids=new Set();
  for(const item of value.raw){
    if(!exact(item,['key','distance'])||!integer(item.key,0)||!Number.isFinite(item.distance)||item.distance< -1e-5||item.distance>2.00001||keys.has(item.key))
      fail('The catalogue response has an invalid raw neighbor.');
    keys.add(item.key);raw.set(item.key,item.distance);
  }
  let previous=-1;
  for(const match of value.matches){
    if(!exact(match,['key','uid','identityKey','name','distance','combinedDistance','aliases'])||!integer(match.key,0)||!raw.has(match.key)||
      match.distance!==raw.get(match.key)||![match.uid,match.identityKey,match.name].every(text)||!match.name.trim()||uids.has(match.uid)||
      !Number.isFinite(match.combinedDistance)||match.combinedDistance<0||match.combinedDistance>catalogueSearchPolicy().maximumDistance||
      match.combinedDistance+1e-7<Math.min(1,Math.max(0,match.distance))||
      match.combinedDistance<previous||!Array.isArray(match.aliases)||match.aliases.length>256||match.aliases.some(alias=>!text(alias)))
      fail('A catalogue candidate has invalid ordered identity or neighbor provenance.');
    previous=match.combinedDistance;uids.add(match.uid);
  }
  const retired=new Set();for(const item of value.retiredSlots){
    if(!exact(item,['key','reason'])||!raw.has(item.key)||retired.has(item.key)||item.reason!=='explicit_null_catalogue_slot')
      fail('The catalogue null-slot proof is invalid.');retired.add(item.key);
  }
  if(value.matches.some(match=>retired.has(match.key)))fail('An explicitly retired catalogue slot cannot identify a candidate.');
  return value;
}
function assertCatalogueObservation(value){
  if(!exact(value,['schema','basisDigest','mode','modelRefDigest','catalogueGenerationDigest','searchPolicyDigest','clusterParameterDigest',
    'sourceBatches','sourceSetDigest','frameEvidenceRefs','groups','queries','catalogueReadProof','resultKind','observedAtMs','observationDigest'])||
    value.schema!==SCHEMA||!['initial','initial_and_supplement'].includes(value.mode)||value.modelRefDigest!==MODEL||
    !['basisDigest','catalogueGenerationDigest','searchPolicyDigest','clusterParameterDigest','sourceSetDigest','observationDigest'].every(key=>HASH.test(value[key]||''))||
    value.searchPolicyDigest!==catalogueSearchPolicy().policyDigest||!integer(value.observedAtMs,0)||
    !Array.isArray(value.sourceBatches)||value.sourceBatches.length!==(value.mode==='initial'?1:2)||
    value.sourceSetDigest!==canonicalDigest(value.sourceBatches)||!Array.isArray(value.frameEvidenceRefs)||value.frameEvidenceRefs.length<1||value.frameEvidenceRefs.length>40||
    !Array.isArray(value.groups)||value.groups.length>1280||!Array.isArray(value.queries)||value.queries.length>1280||
    Buffer.byteLength(canonicalJson(value))>MAX_BYTES)fail('The complete catalogue Observation root or byte bound is invalid.');
  const batches=new Map(),frames=new Map(),faces=new Map(),usedFaces=new Set(),representatives=new Set(),groupIds=new Set();
  value.sourceBatches.forEach((source,index)=>{
    if(!exact(source,['stage','batchDigest','frameArtifactSetDigest','embeddingDigest','frameCount'])||source.stage!==(index===0?'initial':'supplement')||
      !integer(source.frameCount,1,20)||
      !['batchDigest','frameArtifactSetDigest','embeddingDigest'].every(key=>HASH.test(source[key]||'')))fail('The Observation source batch order or commitment changed.');
    batches.set(source.stage,source);
  });
  for(const [ordinal,frame]of value.frameEvidenceRefs.entries()){
    if(!exact(frame,['frameOrdinal','stage','stratum','timestampMs','imageDigest','frameEvidenceDigest','faces'])||!integer(frame.frameOrdinal,0,39)||
      frame.frameOrdinal!==ordinal||frames.has(frame.frameOrdinal)||!batches.has(frame.stage)||!integer(frame.stratum,0,19)||!integer(frame.timestampMs,0)||
      !HASH.test(frame.imageDigest||'')||!HASH.test(frame.frameEvidenceDigest||'')||!Array.isArray(frame.faces)||frame.faces.length>32)
      fail('Catalogue Observation lost its complete sampled frame references.');
    frames.set(frame.frameOrdinal,frame);
    frame.faces.forEach((face,index)=>{
      if(!exact(face,['faceOrdinal','faceEvidenceDigest','vectorDigest'])||face.faceOrdinal!==index||
        !HASH.test(face.faceEvidenceDigest||'')||!HASH.test(face.vectorDigest||''))fail('A queried feature lost its exact frame/face reference.');
      faces.set(frame.frameOrdinal+':'+face.faceOrdinal,{...face,frame});
    });
  }
  for(const source of value.sourceBatches)if(value.frameEvidenceRefs.filter(frame=>frame.stage===source.stage).length!==source.frameCount)
    fail('A complete Observation cannot omit no-face sampled frames.');
  for(const group of value.groups){
    if(!exact(group,['clusterId','memberKeys','uniqueFrameCount','coverageStrata','representativeKeys','maximumPairDistance'])||!text(group.clusterId)||
      groupIds.has(group.clusterId)||!Array.isArray(group.memberKeys)||!group.memberKeys.length||group.memberKeys.length>1280||
      !Array.isArray(group.coverageStrata)||group.coverageStrata.length>20||!Array.isArray(group.representativeKeys)||!group.representativeKeys.length||group.representativeKeys.length>3||
      !Number.isFinite(group.maximumPairDistance)||group.maximumPairDistance<0||group.maximumPairDistance>2)
      fail('The catalogue group set is not complete and bounded.');
    groupIds.add(group.clusterId);const groupFrames=new Set(),images=new Map();
    for(const key of group.memberKeys){
      const face=faces.get(key);if(!face||usedFaces.has(key)||groupFrames.has(face.frame.frameOrdinal))fail('Groups omitted, duplicated or merged co-occurring faces.');
      usedFaces.add(key);groupFrames.add(face.frame.frameOrdinal);if(!images.has(face.frame.imageDigest))images.set(face.frame.imageDigest,face.frame.stratum);
    }
    if(group.uniqueFrameCount!==groupFrames.size||canonicalJson(group.coverageStrata)!==canonicalJson([...new Set(images.values())].sort((a,b)=>a-b)))
      fail('The group temporal coverage differs from its exact frame references.');
    for(const key of group.representativeKeys){
      if(!group.memberKeys.includes(key)||representatives.has(key))fail('A representative is not one unique member of its group.');representatives.add(key);
    }
  }
  if(usedFaces.size!==faces.size||representatives.size!==value.queries.length)fail('A complete Observation cannot omit a face or representative query.');
  const queried=new Set();for(const query of value.queries){
    if(!exact(query,['faceKey','faceEvidenceDigest','vectorDigest','result','resultDigest'])||!representatives.has(query.faceKey)||queried.has(query.faceKey)||
      query.faceEvidenceDigest!==faces.get(query.faceKey)?.faceEvidenceDigest||query.vectorDigest!==faces.get(query.faceKey)?.vectorDigest||
      canonicalDigest(query.result)!==query.resultDigest)fail('The exact representative result or source feature changed.');
    queried.add(query.faceKey);assertCatalogueQueryResult(query.result,{generationDigest:value.catalogueGenerationDigest,policyDigest:value.searchPolicyDigest});
  }
  const read=value.catalogueReadProof;
  if(!faces.size){if(value.resultKind!=='no_faces'||read!==null||value.groups.length||value.queries.length)fail('No-face Evidence cannot claim a queried catalogue.');}
  else if(value.resultKind!=='observed'||!exact(read,['generationDigest','policyDigest','dimension','size','verificationDigest'])||
    read.generationDigest!==value.catalogueGenerationDigest||read.policyDigest!==value.searchPolicyDigest||read.dimension!==512||!integer(read.size,1)||
    !HASH.test(read.verificationDigest||''))fail('A queried catalogue requires its real resource verification proof.');
  const {observationDigest,...body}=value;if(canonicalDigest(body)!==observationDigest)fail('The complete Observation commitment changed.');
  return value;
}
function createCatalogueObservation(body){
  const value=JSON.parse(canonicalJson({...body,schema:SCHEMA,observationDigest:canonicalDigest({...body,schema:SCHEMA})}));
  return freeze(assertCatalogueObservation(value));
}
// This is a projection of technical observations. It contains no Person,
// automatic selection, gender policy, or permission to publish a Cast.
function catalogueAssessmentGroups(value){
  assertCatalogueObservation(value);const queries=new Map(value.queries.map(query=>[query.faceKey,query])),
    frames=new Map(value.frameEvidenceRefs.map(frame=>[frame.frameOrdinal,frame]));
  return value.groups.map(group=>{
    const candidates=new Map();for(const key of group.representativeKeys){
      const query=queries.get(key),frame=frames.get(Number(key.split(':')[0]));
      for(const match of query.result.matches){
        if(!candidates.has(match.identityKey))candidates.set(match.identityKey,{identity:match.identityKey,observations:[]});
        candidates.get(match.identityKey).observations.push({faceKey:key,stratum:frame.stratum,imageDigest:frame.imageDigest,
          uid:match.uid,name:match.name,distance:match.combinedDistance});
      }
    }
    return {clusterId:group.clusterId,memberKeys:group.memberKeys,coverageStrata:group.coverageStrata,representativeKeys:group.representativeKeys,
      candidates:[...candidates.values()]};
  });
}
module.exports=Object.freeze({SCHEMA,MAX_BYTES,assertCatalogueQueryResult,createCatalogueObservation,assertCatalogueObservation,catalogueAssessmentGroups});
