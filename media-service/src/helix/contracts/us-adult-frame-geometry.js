'use strict';
const {canonicalDigest,canonicalJson}=require('./canonical-json');
const {faceModelReference}=require('./us-adult-face-model');
const pack=require('./us-adult-face-model-pack.json');
const FRAME_ANALYSIS_VERSION='us-adult-frame-analysis@1',GEOMETRY_VERSION='us-adult-frame-geometry@1';
function fail(message){throw Object.assign(new TypeError(message),{code:'US_ADULT_FRAME_GEOMETRY_INVALID'});}
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');}
function frameGeometry(analysis){
  const value={schema:GEOMETRY_VERSION,modelRefDigest:analysis.modelRef.digest,referenceModelRefDigest:analysis.referenceModelRefDigest,
    frameMembers:analysis.frameMembers,faces:analysis.faces.map(({vector,...face})=>face),detectedFaceCount:analysis.detectedFaceCount,
    posterFrameOrdinals:analysis.posterFrameOrdinals,analysisDigest:analysis.analysisDigest};
  const geometry=Object.freeze({...value,geometryDigest:canonicalDigest(value)});
  restoreFrameAnalysis({schema:'shared.face-embedding-set@1',dimension:pack.dimension,vectors:analysis.faces.map(face=>face.vector),frameGeometry:geometry});
  return geometry;
}
function restoreFrameAnalysis(payload){
  const geometry=payload?.frameGeometry,{geometryDigest,...value}=geometry||{},modelRef=faceModelReference('western_frame_set'),
    referenceModelRefDigest=faceModelReference('single_reference_face').digest,frames=geometry?.frameMembers,faces=geometry?.faces,vectors=payload?.vectors;
  if(!exact(payload,['schema','dimension','vectors','frameGeometry'])||payload.schema!=='shared.face-embedding-set@1'||
    !exact(geometry,['schema','modelRefDigest','referenceModelRefDigest','frameMembers','faces','detectedFaceCount','posterFrameOrdinals','analysisDigest','geometryDigest'])||
    geometry.schema!==GEOMETRY_VERSION||geometry.modelRefDigest!==modelRef.digest||geometry.referenceModelRefDigest!==referenceModelRefDigest||
    canonicalDigest(value)!==geometryDigest||Buffer.byteLength(canonicalJson(geometry),'utf8')>2*1024*1024||payload.dimension!==pack.dimension||
    !Array.isArray(frames)||frames.length<1||frames.length>20||!Array.isArray(faces)||faces.length>1280||
    geometry.detectedFaceCount!==faces.length||!Array.isArray(vectors)||vectors.length!==faces.length)fail('Frame geometry differs from its pinned model, digest or byte/count bounds.');
  for(const [ordinal,frame]of frames.entries()){
    if(!exact(frame,['ordinal','timestampMs','imageDigest','width','height'])||frame.ordinal!==ordinal||!Number.isSafeInteger(frame.timestampMs)||frame.timestampMs<0||!/^[a-f0-9]{64}$/.test(frame.imageDigest||'')||
      !Number.isSafeInteger(frame.width)||frame.width<1||frame.width>16384||!Number.isSafeInteger(frame.height)||frame.height<1||frame.height>16384)
      fail('Frame geometry has an invalid source image or order.');
  }
  const restored=faces.map((face,ordinal)=>{
    if(!exact(face,['ordinal','frameOrdinal','timestampMs','imageDigest','box','confidence','qualityScore','faceDigest']))fail('Face geometry has unexpected fields.');
    const frame=frames[face.frameOrdinal],vector=vectors[ordinal],box=face.box,{faceDigest,...body}=face,
      quality=box&&Math.max(0,Math.min(1,face.confidence*Math.min(box.width,box.height)/160));
    if(face.ordinal!==ordinal||!Number.isSafeInteger(face.frameOrdinal)||!frame||face.timestampMs!==frame.timestampMs||face.imageDigest!==frame.imageDigest||
      !box||Object.keys(box).sort().join(',')!=='height,width,x,y'||Object.values(box).some(item=>!Number.isFinite(item))||box.width<=0||box.height<=0||
      box.x+box.width<=0||box.y+box.height<=0||box.x>=frame.width||box.y>=frame.height||!Number.isFinite(face.confidence)||
      face.confidence<pack.detectionThreshold||face.confidence>1||face.qualityScore!==quality||!Array.isArray(vector)||vector.length!==pack.dimension||
      vector.some(item=>!Number.isFinite(item))||Math.abs(vector.reduce((sum,item)=>sum+item*item,0)-1)>1e-5||
      canonicalDigest({...body,vector})!==faceDigest)fail('Face geometry no longer conserves its source, quality or feature vector.');
    return Object.freeze({...body,vector:Object.freeze([...vector]),faceDigest});
  });
  const posterFrameOrdinals=Array.from({length:4},(_,index)=>Math.min(frames.length-1,Math.floor((index+1)*frames.length/5)));
  if(canonicalJson(posterFrameOrdinals)!==canonicalJson(geometry.posterFrameOrdinals))fail('Poster sampling changed within frame evidence.');
  const analysis={schema:FRAME_ANALYSIS_VERSION,modelRef,referenceModelRefDigest,frameMembers:frames,faces:Object.freeze(restored),
    detectedFaceCount:faces.length,posterFrameOrdinals:geometry.posterFrameOrdinals};
  if(canonicalDigest(analysis)!==geometry.analysisDigest)fail('Frame analysis no longer matches the complete geometry and vector evidence.');
  return Object.freeze({...analysis,analysisDigest:geometry.analysisDigest});
}
module.exports=Object.freeze({FRAME_ANALYSIS_VERSION,GEOMETRY_VERSION,frameGeometry,restoreFrameAnalysis});
