'use strict';
function javCorrectionRetainedLocation(correctionId,ordinal,location) {
  if(!/^arca-jav-correction-[a-f0-9]{40}$/.test(correctionId)||!Number.isSafeInteger(ordinal)||ordinal<0||ordinal>1023||typeof location!=='string'||
      !(location.startsWith('/')||location.startsWith('\\\\')||/^[A-Za-z]:[\\/]/.test(location)))
    throw new TypeError('Correction retained location requires its exact process, ordinal and owned absolute binding.');
  const separator=Math.max(location.lastIndexOf('/'),location.lastIndexOf('\\')),name=location.slice(separator+1),dot=name.lastIndexOf('.'),extension=dot>0?name.slice(dot):'';
  if(separator<0||!name||name==='.'||name==='..')throw new TypeError('Correction retained binding must name a file.');
  return location.slice(0,separator+1)+'.shelfdeck-'+correctionId+'-'+String(ordinal).padStart(4,'0')+'-retained'+extension;
}
module.exports=Object.freeze({javCorrectionRetainedLocation});
