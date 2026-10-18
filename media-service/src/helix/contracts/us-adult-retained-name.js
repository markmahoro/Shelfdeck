'use strict';
const {canonicalDigest}=require('./canonical-json');
function retainedName(aftercareCaseId,ordinal){
  if(typeof aftercareCaseId!=='string'||!aftercareCaseId||!Number.isSafeInteger(ordinal)||ordinal<0||ordinal>1023)
    throw new TypeError('Actor file retirement requires its exact Case and ordinal.');
  return '.shelfdeck-us-'+canonicalDigest(aftercareCaseId).slice(0,32)+'-'+ordinal+'.retained';
}
module.exports=Object.freeze({retainedName});
