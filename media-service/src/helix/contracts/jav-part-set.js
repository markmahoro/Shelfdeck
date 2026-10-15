'use strict';
const {canonicalDigest,canonicalJson}=require('./canonical-json');
const {buildJavQueryAnchor}=require('./jav-source-contracts');
function assertJavPartSet(value) {
  const invalid=()=>{throw Object.assign(new TypeError('JAV part set must conserve its exact directory, code and ordered actual members.'),{code:'JAV_PART_SET_INVALID'});};
  if(!value||Object.keys(value).sort().join(',')!=='groupDigest,javCode,parentRelativeLocation,parts,schema'||
      value.schema!=='procurement.jav-named-part-group@1'||typeof value.parentRelativeLocation!=='string'||
      !value.parentRelativeLocation||value.parentRelativeLocation.length>4096||!Array.isArray(value.parts)||value.parts.length<1||value.parts.length>2||
      value.groupDigest!==canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key])=>key!=='groupDigest')))||
      Buffer.byteLength(canonicalJson(value),'utf8')>16384)invalid();
  try{if(buildJavQueryAnchor('jav_code',value.javCode).javCode!==value.javCode)invalid();}catch{invalid();}
  const keys=new Set();let previous='';
  for(const [ordinal,part] of value.parts.entries()) {
    if(!part||Object.keys(part).sort().join(',')!=='materialKey,ordinal,partLabel,relativeLocation'||part.ordinal!==ordinal||
        !['A','B'].includes(part.partLabel)||part.partLabel<=previous||typeof part.relativeLocation!=='string'||
        !part.relativeLocation||part.relativeLocation.length>4096||part.relativeLocation.includes('\\')||
        part.relativeLocation.startsWith('/')||part.relativeLocation.split('/').some(segment=>['','..','.'].includes(segment))||
        !/^[a-f0-9]{64}$/.test(part.materialKey)||keys.has(part.materialKey))invalid();
    const split=part.relativeLocation.lastIndexOf('/'),parent=split<0?'.':part.relativeLocation.slice(0,split);
    if(parent!==value.parentRelativeLocation)invalid();keys.add(part.materialKey);previous=part.partLabel;
  }
  return value;
}
function javPartSetSchema() {
  const digest={type:'string',pattern:'^[a-f0-9]{64}$'},text={type:'string',minLength:1,maxLength:4096},
    properties={schema:{const:'procurement.jav-named-part-group@1'},javCode:{type:'string',minLength:1,maxLength:64},parentRelativeLocation:text,
      parts:{type:'array',minItems:1,maxItems:2,items:{type:'object',additionalProperties:false,required:['ordinal','partLabel','materialKey','relativeLocation'],properties:{
        ordinal:{type:'integer',minimum:0,maximum:1},partLabel:{enum:['A','B']},materialKey:digest,relativeLocation:text}}},groupDigest:digest};
  return {type:'object',additionalProperties:false,required:Object.keys(properties),properties,'x-helix-maxCanonicalBytes':16384};
}
module.exports=Object.freeze({assertJavPartSet,javPartSetSchema});
