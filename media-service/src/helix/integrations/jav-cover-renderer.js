'use strict';
const sharp=require('sharp'),crypto=require('node:crypto');
const {canonicalDigest}=require('../contracts/canonical-json');
const {javCropRectangle,assertJavCoverDerivation}=require('../contracts/jav-cover-derivation');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function deriveJavCoverBytes({bytes,selectedSource,sourceObservationDigest,artifactKind}) {
  if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>16*1024*1024||sha(bytes)!==selectedSource?.coverDigest)
    throw Object.assign(new TypeError('JAV source bytes differ from their frozen cover digest.'),{code:'JAV_COVER_DERIVATION_INVALID'});
  const normalized=await sharp(bytes,{limitInputPixels:32*1024*1024,failOn:'warning'}).rotate().toBuffer(),
    dimensions=await sharp(normalized).metadata(),rectangle=javCropRectangle(dimensions.width,dimensions.height),pipeline=sharp(normalized);
  if(artifactKind==='poster')pipeline.extract(rectangle);
  const output=await pipeline.jpeg().toBuffer(),body={schema:'jav.cover-derivation@1',javSelectedSource:selectedSource,
    sourceObservationDigest,sourceByteDigest:sha(bytes),kind:artifactKind,normalizedWidth:dimensions.width,normalizedHeight:dimensions.height,
    crop:artifactKind==='poster'?rectangle:null,renderer:'sharp',rendererVersion:sharp.versions.sharp,outputDigest:sha(output)};
  const derivation=assertJavCoverDerivation({...body,derivationDigest:canonicalDigest(body)});
  return Object.freeze({bytes:output,derivation});
}
async function renderJavPreviewCover(bytes,expectedDigest) {
  if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>16*1024*1024||sha(bytes)!==expectedDigest)
    throw Object.assign(new TypeError('Preview cover must conserve its qualified source bytes.'),{code:'JAV_COVER_DERIVATION_INVALID'});
  const normalized=await sharp(bytes,{limitInputPixels:32*1024*1024,failOn:'warning'}).rotate()
    .resize({width:360,height:240,fit:'inside',withoutEnlargement:true}).toBuffer();
  for(const quality of [75,55,35,20]) {
    const output=await sharp(normalized).flatten({background:'#ffffff'}).jpeg({quality}).toBuffer();
    if(output.length<=32768)return Object.freeze({posterUrl:'data:image/jpeg;base64,'+output.toString('base64'),sourceCoverDigest:expectedDigest});
  }
  throw Object.assign(new TypeError('JAV preview cover exceeds its bounded presentation size.'),{code:'JAV_COVER_DERIVATION_INVALID'});
}
module.exports=Object.freeze({deriveJavCoverBytes,renderJavPreviewCover});
