'use strict';
const {createHash}=require('node:crypto');
const {canonicalDigest}=require('../contracts/canonical-json');
const {faceModelReference}=require('../contracts/us-adult-face-model');
const {bestActorMatch}=require('./local-face-math');
const pack=require('../contracts/us-adult-face-model-pack.json');
const {FRAME_ANALYSIS_VERSION:ANALYSIS_VERSION}=require('../contracts/us-adult-frame-geometry');
function uniformFrameTimes(durationMs,count=20){
  if(!Number.isSafeInteger(durationMs)||durationMs<1||!Number.isSafeInteger(count)||count<1||count>20)
    throw Object.assign(new TypeError('Frame sampling requires a positive duration and 1..20 points.'),{code:'US_ADULT_SAMPLING_INVALID'});
  return Object.freeze(Array.from({length:count},(_,index)=>Math.min(durationMs-1,Math.floor(durationMs*(index+0.5)/count))));
}
function createUsAdultFrameAnalysis(options){
  if(typeof options?.faceModel?.analyzeImage!=='function')throw new TypeError('US Adult frame analysis requires the pinned local CPU model.');
  async function analyze(frames,{assertActive=()=>{}}={}){
    if(!Array.isArray(frames)||frames.length<1||frames.length>20)throw new TypeError('US Adult analysis requires 1..20 sampled frames.');
    const faces=[],members=[];
    for(const [frameOrdinal,frame] of frames.entries()){
      assertActive();
      if(!Number.isSafeInteger(frame.timestampMs)||frame.timestampMs<0||!Buffer.isBuffer(frame.bytes))throw new TypeError('A sampled frame requires exact bytes and timestamp.');
      const result=await options.faceModel.analyzeImage(frame.bytes);assertActive();
      if(result.modelRef!==pack.modelRef||result.faces.length!==result.detectedFaceCount||result.faces.length>64)
        throw Object.assign(new Error('Frame analysis returned an unexpected face model or count.'),{code:'FACE_MODEL_OUTPUT_INVALID'});
      const imageDigest=createHash('sha256').update(frame.bytes).digest('hex');
      members.push(Object.freeze({ordinal:frameOrdinal,timestampMs:frame.timestampMs,imageDigest,width:result.width,height:result.height}));
      for(const face of result.faces){
        if(face.vector.length!==pack.dimension)throw new TypeError('Frame feature dimension differs from the pinned model.');
        const box={x:face.x,y:face.y,width:face.width,height:face.height},
          qualityScore=Math.max(0,Math.min(1,face.confidence*Math.min(face.width,face.height)/160)),
          value={ordinal:faces.length,frameOrdinal,timestampMs:frame.timestampMs,imageDigest,box,confidence:face.confidence,qualityScore,vector:Object.freeze([...face.vector])};
        faces.push(Object.freeze({...value,faceDigest:canonicalDigest(value)}));
      }
    }
    const value={schema:ANALYSIS_VERSION,modelRef:faceModelReference('western_frame_set'),referenceModelRefDigest:faceModelReference('single_reference_face').digest,
      frameMembers:Object.freeze(members),faces:Object.freeze(faces),detectedFaceCount:faces.length,
      posterFrameOrdinals:Object.freeze(Array.from({length:4},(_,index)=>Math.min(frames.length-1,Math.floor((index+1)*frames.length/5))))};
    return Object.freeze({...value,analysisDigest:canonicalDigest(value)});
  }
  function match(analysis,references){
    const {analysisDigest,...value}=analysis||{};
    if(analysis?.schema!==ANALYSIS_VERSION||canonicalDigest(value)!==analysisDigest||
      analysis.modelRef.digest!==faceModelReference('western_frame_set').digest||analysis.referenceModelRefDigest!==faceModelReference('single_reference_face').digest)
      throw Object.assign(new Error('Frame analysis model or digest changed.'),{code:'US_ADULT_ANALYSIS_CHANGED'});
    if(!Array.isArray(references)||references.length>65536||references.some(reference=>reference.modelRefDigest!==analysis.referenceModelRefDigest))
      throw Object.assign(new Error('Reference feature model differs from the pinned feature space.'),{code:'US_ADULT_REFERENCE_MODEL_CHANGED'});
    if(references.some(reference=>!Number.isSafeInteger(reference.personRevision)||reference.personRevision<1||!Number.isSafeInteger(reference.referenceRevision)||reference.referenceRevision<1||
      typeof reference.referenceAssetId!=='string'||!reference.referenceAssetId||!/^[a-f0-9]{64}$/.test(reference.referenceProjectionDigest||'')||!/^[a-f0-9]{64}$/.test(reference.artifactDigest||'')))
      throw Object.assign(new Error('Reference features require their exact Person, image and Projection versions.'),{code:'US_ADULT_REFERENCE_VERSION_REQUIRED'});
    const vectors=analysis.faces.map(face=>face.vector);let winner=null;
    for(const reference of references){
      const candidate=bestActorMatch(vectors,[reference],pack.matchThreshold);if(!candidate)continue;
      const compare=winner&&(Buffer.compare(Buffer.from(candidate.personId),Buffer.from(winner.personId))||
        Buffer.compare(Buffer.from(reference.referenceAssetId),Buffer.from(winner.referenceAssetId)));
      if(!winner||candidate.score>winner.score||candidate.score===winner.score&&compare<0)winner={...candidate,personRevision:reference.personRevision,
        referenceAssetId:reference.referenceAssetId,artifactDigest:reference.artifactDigest,referenceProjectionDigest:reference.referenceProjectionDigest};
    }
    return winner&&Object.freeze({...winner,analysisDigest,modelRefDigest:analysis.modelRef.digest,referenceModelRefDigest:analysis.referenceModelRefDigest,threshold:pack.matchThreshold});
  }
  return Object.freeze({analyze,match});
}
module.exports=Object.freeze({ANALYSIS_VERSION,uniformFrameTimes,createUsAdultFrameAnalysis});
