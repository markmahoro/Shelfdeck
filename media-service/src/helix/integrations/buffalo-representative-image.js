'use strict';
const {createHash}=require('node:crypto');
const {canonicalDigest,canonicalJson}=require('../contracts/canonical-json');
const {assertFrameEvidence}=require('../contracts/buffalo-frame-evidence');
const {pack}=require('../contracts/buffalo-model-reference');
const {assertRepresentativeImagePolicy}=require('../contracts/buffalo-representative-policy');
const {rotateNearest}=require('./buffalo-math');
const {assertWithinDeadline,awaitWithinDeadline}=require('./cooperative-deadline');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function fail(message){throw Object.assign(new TypeError(message),{code:'BUFFALO_REPRESENTATIVE_INVALID'});}
// Invoke inside the service CPU isolation thread under the caller's execution Permit.
function createBuffaloRepresentativeImage({sharp=require('sharp')}={}){
  return Object.freeze({async render({frameBytes,evidence,faceOrdinal,policy,deadlineAtMs,signal,now=Date.now}){
    if(!Number.isSafeInteger(deadlineAtMs)||deadlineAtMs>now()+60000||deadlineAtMs<0)fail('A bounded representative-image deadline is required.');
    const guard={deadlineAtMs,signal,now},active=()=>assertWithinDeadline(guard),bounded=operation=>awaitWithinDeadline(operation,guard);active();
    assertRepresentativeImagePolicy(policy);
    evidence=JSON.parse(canonicalJson(assertFrameEvidence(evidence)));
    if(!Buffer.isBuffer(frameBytes)||!frameBytes.length||frameBytes.length>pack.maximumImageBytes||sha(frameBytes)!==evidence.frame.imageDigest||
      !Number.isSafeInteger(faceOrdinal)||faceOrdinal<0||faceOrdinal>=evidence.faces.length)fail('The selected face no longer identifies its exact source image.');
    frameBytes=Buffer.from(frameBytes);
    const source=sharp(frameBytes,{limitInputPixels:pack.maximumImagePixels}),metadata=await bounded(()=>source.metadata());
    if(!['jpeg','png','webp'].includes(metadata.format)||(metadata.pages||1)!==1)fail('The source is not a single qualified image.');
    const {data,info}=await bounded(()=>source.toColourspace('srgb').removeAlpha().raw().toBuffer({resolveWithObject:true}));active();
    const recorded=evidence.coordinateSpace,image={data,width:info.width,height:info.height},
      canvas=recorded.rotationDegrees?rotateNearest(image,recorded.rotationDegrees):image;
    if(info.width!==recorded.sourceWidth||info.height!==recorded.sourceHeight||canvas.width!==recorded.width||canvas.height!==recorded.height||
      sha(canvas.data)!==recorded.pixelDigest)fail('The original image cannot reconstruct the face coordinate canvas.');
    const face=evidence.faces[faceOrdinal],[x0,y0,x1,y1]=face.rectangle,marginX=(x1-x0)*policy.contextMarginRatio,marginY=(y1-y0)*policy.contextMarginRatio,
      left=Math.max(0,Math.floor(x0-marginX)),top=Math.max(0,Math.floor(y0-marginY)),right=Math.min(canvas.width,Math.ceil(x1+marginX)),bottom=Math.min(canvas.height,Math.ceil(y1+marginY)),
      rectangle={left,top,width:right-left,height:bottom-top};
    if(Math.min(canvas.width,x1)-Math.max(0,x0)<policy.minimumFaceSize||Math.min(canvas.height,y1)-Math.max(0,y0)<policy.minimumFaceSize)
      fail('The representative face is too small after clipping.');
    if(evidence.faces.some(other=>{
      if(other.faceOrdinal===faceOrdinal)return false;
      const [a,b,c,d]=other.rectangle,cx=(a+c)/2,cy=(b+d)/2;
      return cx>=left&&cx<right&&cy>=top&&cy<bottom;
    }))fail('The representative crop contains the centre of another detected face.');
    const bytes=await bounded(()=>sharp(canvas.data,{raw:{width:canvas.width,height:canvas.height,channels:3}}).extract(rectangle).png({compressionLevel:6}).toBuffer());active();
    if(bytes.length>policy.maximumOutputBytes)fail('The representative image exceeds its output size budget.');
    const body={schema:'shared.buffalo-representative-image@1',basisDigest:evidence.basisDigest,frameEvidenceDigest:evidence.evidenceDigest,
      sourceImageDigest:evidence.frame.imageDigest,faceOrdinal,faceEvidenceDigest:face.faceEvidenceDigest,modelRefDigest:evidence.modelRefDigest,
      coordinateSpaceDigest:canonicalDigest(recorded),renderingPolicyDigest:policy.policyDigest,rectangle,encoding:policy.encoding,imageDigest:sha(bytes),imageBytes:bytes.length};
    return Object.freeze({bytes,proof:Object.freeze({...body,rectangle:Object.freeze(rectangle),proofDigest:canonicalDigest(body)})});
  }});
}
module.exports=Object.freeze({createBuffaloRepresentativeImage});
