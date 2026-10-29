'use strict';
const {canonicalDigest,canonicalJson}=require('./canonical-json');
const {assertFrameEvidence}=require('./buffalo-frame-evidence');
const {buffaloModelReference}=require('./buffalo-model-reference');
const MODEL=buffaloModelReference('western_frame_set').digest,MAX_BYTES=24*1024*1024;
function fail(message){throw Object.assign(new TypeError(message),{code:'BUFFALO_FRAME_ARTIFACT_INVALID'});}
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');}
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function assertSource(source){
  if(!exact(source,['basisDigest','batchDigest','frameArtifactSetDigest','frameMemberSetDigest','frameArtifactBytes','points'])||
    !['basisDigest','batchDigest','frameArtifactSetDigest','frameMemberSetDigest'].every(key=>hash(source[key]))||
    !Number.isSafeInteger(source.frameArtifactBytes)||source.frameArtifactBytes<1||source.frameArtifactBytes>256*1024*1024||
    !Array.isArray(source.points)||source.points.length<1||source.points.length>20)fail('The embedding Artifact requires its exact completed frame batch.');
  const ordinals=new Set(),times=new Set();
  source.points.forEach((point,index)=>{
    if(!exact(point,['ordinal','compositeOrdinal','stage','stratum','timestampMs'])||point.compositeOrdinal!==index||
      !Number.isSafeInteger(point.ordinal)||point.ordinal<0||point.ordinal>=40||ordinals.has(point.ordinal)||
      !['initial','supplement'].includes(point.stage)||index>0&&point.stage!==source.points[0].stage||
      !Number.isSafeInteger(point.stratum)||point.stratum<0||point.stratum>=20||!Number.isSafeInteger(point.timestampMs)||point.timestampMs<0||
      times.has(point.timestampMs)||index>0&&point.timestampMs<=source.points[index-1].timestampMs)fail('Frame batch provenance is not a complete ordered bijection.');
    ordinals.add(point.ordinal);times.add(point.timestampMs);
  });
  return source;
}
function encodeBuffaloEmbeddingSet({source,frames}){
  assertSource(source);
  if(!Array.isArray(frames)||frames.length!==source.points.length)fail('Every sampled frame, including no-face frames, must be preserved.');
  const vectors=[],records=frames.map((record,index)=>{
    assertFrameEvidence(record,{basisDigest:source.basisDigest});
    const {compositeOrdinal,...point}=source.points[index];
    if(canonicalJson(point)!==canonicalJson(Object.fromEntries(Object.entries(record.frame).filter(([key])=>key!=='imageDigest'))))
      fail('Embedding geometry describes another sampled point.');
    return {...record,faces:record.faces.map(face=>{
      const {vector,...geometry}=face,vectorOrdinal=vectors.length;vectors.push(vector);return {...geometry,vectorOrdinal};
    })};
  });
  const body={schema:'shared.buffalo-frame-geometry@1',source,modelRefDigest:MODEL,frames:records},
    payload={schema:'shared.face-embedding-set@1',dimension:512,vectors,frameGeometry:{...body,geometryDigest:canonicalDigest(body)}};
  if(Buffer.byteLength(canonicalJson(payload))>MAX_BYTES)fail('The embedding Artifact exceeds its bounded byte budget.');
  return freeze(JSON.parse(canonicalJson(payload)));
}
function restoreBuffaloEmbeddingSet(payload,{expectedSource}={}){
  if(!exact(payload,['schema','dimension','vectors','frameGeometry'])||payload.schema!=='shared.face-embedding-set@1'||payload.dimension!==512||
    !Array.isArray(payload.vectors)||payload.vectors.length>640||!exact(payload.frameGeometry,
      ['schema','source','modelRefDigest','frames','geometryDigest'])||payload.frameGeometry.schema!=='shared.buffalo-frame-geometry@1'||
    payload.frameGeometry.modelRefDigest!==MODEL||Buffer.byteLength(canonicalJson(payload))>MAX_BYTES)
    fail('The embedding Artifact root, feature space or byte budget changed.');
  const geometry=payload.frameGeometry,source=assertSource(geometry.source),{geometryDigest,...geometryBody}=geometry;
  if(canonicalDigest(geometryBody)!==geometryDigest||expectedSource!==undefined&&canonicalJson(source)!==canonicalJson(expectedSource)||
    !Array.isArray(geometry.frames)||geometry.frames.length!==source.points.length)fail('Embedding Artifact source or geometry commitment changed.');
  let cursor=0;
  const records=geometry.frames.map(record=>{
    if(!record||!Array.isArray(record.faces))fail('An embedding frame lost its face records.');
    return {...record,faces:record.faces.map(face=>{
      if(!face||face.vectorOrdinal!==cursor||cursor>=payload.vectors.length)fail('Embedding vectors must have exactly one geometry consumer.');
      const {vectorOrdinal,...rest}=face;return {...rest,vector:payload.vectors[cursor++]};
    })};
  });
  if(cursor!==payload.vectors.length)fail('An embedding vector has no source face.');
  // Rebuilding checks all closed frame/face shapes, unit vectors and hashes,
  // including a face's corrected canvas and original source bytes.
  const rebuilt=encodeBuffaloEmbeddingSet({source,frames:records});
  if(canonicalJson(rebuilt)!==canonicalJson(payload))fail('Embedding Artifact bytes no longer match their complete frame evidence.');
  return freeze(JSON.parse(canonicalJson({source,frames:records})));
}
function encodeBuffaloClusterSet({clusters,sourceEmbeddingDigest,clusterParameterDigest}){
  if(!Array.isArray(clusters)||clusters.length>640||!hash(sourceEmbeddingDigest)||!hash(clusterParameterDigest))
    fail('The buffalo cluster payload requires its exact completed embedding and clustering parameters.');
  const value={schema:'shared.buffalo-cluster-set@1',sourceEmbeddingDigest,clusterParameterDigest,clusters};
  if(Buffer.byteLength(canonicalJson(value))>MAX_BYTES)fail('The buffalo cluster payload exceeds its byte bound.');
  return freeze(JSON.parse(canonicalJson(value)));
}
function restoreBuffaloClusterSet(payload,{sourceEmbeddingDigest,clusterParameterDigest}){
  if(!exact(payload,['schema','sourceEmbeddingDigest','clusterParameterDigest','clusters'])||
    payload.schema!=='shared.buffalo-cluster-set@1'||payload.sourceEmbeddingDigest!==sourceEmbeddingDigest||payload.clusterParameterDigest!==clusterParameterDigest)
    fail('Recovered buffalo clusters are not the exact frozen embedding and parameter set.');
  return encodeBuffaloClusterSet(payload).clusters;
}
module.exports=Object.freeze({encodeBuffaloEmbeddingSet,restoreBuffaloEmbeddingSet,encodeBuffaloClusterSet,restoreBuffaloClusterSet,MAX_BYTES});
