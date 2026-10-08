'use strict';
const object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const digest=()=>({type:'string',pattern:'^[a-f0-9]{64}$'});
const key=()=>({type:'string',minLength:1,maxLength:128});
const keys=maxItems=>({type:'array',minItems:1,maxItems,uniqueItems:true,items:key()});
const bytes=()=>({type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER});
const basis=object({schema:{const:'libra.series-media-space-basis@1'},libraRunId:key(),runExecutionBasisDigest:digest(),
  episodeKeys:keys(1024),members:{type:'array',minItems:1,maxItems:1024,items:object({materialKey:key(),memberDigest:digest(),
    handleDigest:digest(),probeDigest:digest(),sizeBytes:bytes(),episodeKeys:keys(32)})},basisDigest:digest()});
const allocation=object({basisDigest:digest(),allocations:{type:'array',minItems:1,maxItems:32,items:object({episodeKey:key(),
  allocatedBytes:object({numerator:{type:'string',pattern:'^(0|[1-9][0-9]*)$',maxLength:64},
    denominator:{type:'string',pattern:'^[1-9][0-9]*$',maxLength:64}}),
  maxSizeBytes:{anyOf:[{...bytes(),minimum:1},{type:'null'}]},withinLimit:{type:'boolean'}})},withinLimit:{type:'boolean'}});
module.exports=Object.freeze({basis,allocation});
