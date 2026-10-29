'use strict';
const {canonicalDigest,canonicalJson}=require('./canonical-json');
const {buffaloModelReference,pack}=require('./buffalo-model-reference');
const MODEL=buffaloModelReference('western_frame_set').digest;
function fail(message){throw Object.assign(new TypeError(message),{code:'BUFFALO_FRAME_EVIDENCE_INVALID'});}
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max,hash=n=>typeof n==='string'&&/^[a-f0-9]{64}$/.test(n);
function frameEvidence({basisDigest,frame,analysis}){
  const space=analysis?.coordinateSpace;
  if(!hash(basisDigest)||!exact(frame,['ordinal','stage','stratum','timestampMs','imageDigest'])||!integer(frame.ordinal,0,39)||
    !['initial','supplement'].includes(frame.stage)||!integer(frame.stratum,0,19)||!integer(frame.timestampMs,0,Number.MAX_SAFE_INTEGER)||!hash(frame.imageDigest)||
    !exact(space,['kind','sourceWidth','sourceHeight','width','height','rotationDegrees','pixelDigest'])||space.kind!=='corrected_canvas'||
    !['sourceWidth','sourceHeight','width','height'].every(key=>integer(space[key],1,16384))||space.width*space.height>pack.maximumImagePixels||
    space.sourceWidth*space.sourceHeight>pack.maximumImagePixels||!Number.isFinite(space.rotationDegrees)||Math.abs(space.rotationDegrees)>1080||!hash(space.pixelDigest)||
    !Array.isArray(analysis.faces)||analysis.faces.length>32)fail('The frame lost its bounded source or corrected canvas.');
  const faces=analysis.faces.map((face,faceOrdinal)=>{
    if(!Array.isArray(face.rectangle)||face.rectangle.length!==4||face.rectangle.some(x=>!Number.isFinite(x))||
      face.rectangle[2]<=face.rectangle[0]||face.rectangle[3]<=face.rectangle[1]||face.rectangle[2]<=0||face.rectangle[3]<=0||
      face.rectangle[0]>=space.width||face.rectangle[1]>=space.height||!Array.isArray(face.landmarks)||face.landmarks.length!==5||
      face.landmarks.some(p=>!Array.isArray(p)||p.length!==2||p.some(x=>!Number.isFinite(x)))||!Number.isFinite(face.confidence)||
      face.confidence<pack.minimumDetectionConfidence||face.confidence>1||!Array.isArray(face.vector)||face.vector.length!==512||
      face.vector.some(x=>!Number.isFinite(x))||Math.abs(Math.hypot(...face.vector)-1)>1e-5||
      (face.rotationApplied??0)!==space.rotationDegrees)fail('A face lost its exact canvas, detection or buffalo feature.');
    const body={faceOrdinal,rectangle:face.rectangle,landmarks:face.landmarks,confidence:face.confidence,vector:face.vector};
    return {...body,faceEvidenceDigest:canonicalDigest({basisDigest,frame,modelRefDigest:MODEL,coordinateSpace:space,...body})};
  }),body={schema:'shared.buffalo-frame-evidence@1',basisDigest,modelRefDigest:MODEL,frame,coordinateSpace:space,faces};
  // Do not freeze another component's objects or retain its mutable arrays.
  const result=JSON.parse(canonicalJson({...body,evidenceDigest:canonicalDigest(body)}));
  if(Buffer.byteLength(canonicalJson(result))>1048576)fail('A frame Evidence Artifact exceeds its size budget.');
  return freeze(result);
}
function assertFrameEvidence(value,{basisDigest,frame}={}){
  if(!exact(value,['schema','basisDigest','modelRefDigest','frame','coordinateSpace','faces','evidenceDigest'])||!Array.isArray(value.faces))fail('The frame Evidence root is not closed.');
  const rebuilt=frameEvidence({basisDigest:value.basisDigest,frame:value.frame,analysis:{coordinateSpace:value.coordinateSpace,
    faces:value.faces.map(face=>({...face,rotationApplied:value.coordinateSpace?.rotationDegrees}))}});
  if(canonicalJson(value)!==canonicalJson(rebuilt)||basisDigest!==undefined&&value.basisDigest!==basisDigest||
    frame!==undefined&&canonicalJson(frame)!==canonicalJson(value.frame))fail('The frame Evidence no longer matches its frozen bytes, feature or provenance.');
  return value;
}
module.exports=Object.freeze({frameEvidence,assertFrameEvidence});
