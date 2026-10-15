'use strict';
const {canonicalDigest}=require('./canonical-json');
const {assertJavSelectedSource,javSelectedSourceSchema}=require('./jav-selected-source');
function javCropRectangle(width,height) {
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>32*1024*1024)
    throw Object.assign(new TypeError('JAV normalized image dimensions exceed their bound.'),{code:'JAV_COVER_DERIVATION_INVALID'});
  const cropWidth=height*50<width*71?Math.floor(height*50/71):width,
    cropHeight=height*50<width*71?height:Math.floor(width*71/50);
  if(cropWidth<1||cropHeight<1)throw Object.assign(new TypeError('JAV cover cannot produce the required crop.'),{code:'JAV_COVER_DERIVATION_INVALID'});
  return Object.freeze({left:width-cropWidth,top:Math.floor((height-cropHeight)/2),width:cropWidth,height:cropHeight});
}
function assertJavCoverDerivation(value) {
  const fields=['schema','javSelectedSource','sourceObservationDigest','sourceByteDigest','kind','normalizedWidth','normalizedHeight','crop','renderer','rendererVersion','outputDigest','derivationDigest'];
  const binding=assertJavSelectedSource(value?.javSelectedSource),rectangle=javCropRectangle(value.normalizedWidth,value.normalizedHeight);
  if(Object.keys(value).sort().join(',')!==fields.sort().join(',') || value.schema!=='jav.cover-derivation@1' ||
      !['poster','fanart'].includes(value.kind)||value.sourceByteDigest!==binding.coverDigest||value.renderer!=='sharp'||
      !/^[a-f0-9]{64}$/.test(value.sourceObservationDigest)||!/^[a-f0-9]{64}$/.test(value.outputDigest)||
      typeof value.rendererVersion!=='string'||!value.rendererVersion||value.rendererVersion.length>128||
      canonicalDigest(value.crop)!==canonicalDigest(value.kind==='poster'?rectangle:null)||
      value.derivationDigest!==canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key])=>key!=='derivationDigest'))))
    throw Object.assign(new TypeError('JAV cover derivation does not conserve its exact source, crop and output.'),{code:'JAV_COVER_DERIVATION_INVALID'});
  return value;
}
function javCoverDerivationSchema() {
  const digest={type:'string',pattern:'^[a-f0-9]{64}$'},integer={type:'integer',minimum:1,maximum:32*1024*1024};
  const properties={schema:{const:'jav.cover-derivation@1'},javSelectedSource:javSelectedSourceSchema(),sourceObservationDigest:digest,
    sourceByteDigest:digest,kind:{enum:['poster','fanart']},normalizedWidth:integer,normalizedHeight:integer,
    crop:{oneOf:[{type:'null'},{type:'object',additionalProperties:false,required:['left','top','width','height'],properties:{
      left:{type:'integer',minimum:0},top:{type:'integer',minimum:0},width:integer,height:integer}}]},
    renderer:{const:'sharp'},rendererVersion:{type:'string',minLength:1,maxLength:128},outputDigest:digest,derivationDigest:digest};
  return {type:'object',additionalProperties:false,required:Object.keys(properties),properties,'x-helix-maxCanonicalBytes':32*1024};
}
module.exports=Object.freeze({javCropRectangle,assertJavCoverDerivation,javCoverDerivationSchema});
