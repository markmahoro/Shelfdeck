'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {identifyJavFilename}=require('./jav-filename-identity');
function groupJavNamedParts(members) {
  if(!Array.isArray(members)||members.length>1024)throw new TypeError('JAV part grouping requires a bounded frozen member set.');
  const byScope=new Map(),materialKeys=new Set(),ungrouped=[];
  for(const member of members) {
    if(!member||typeof member.materialKey!=='string'||!member.materialKey||materialKeys.has(member.materialKey)||
        typeof member.relativeLocation!=='string'||!member.relativeLocation||member.relativeLocation.includes('\\')||
        member.relativeLocation.startsWith('/')||member.relativeLocation.split('/').some(segment=>['','..','.'].includes(segment)))
      throw new TypeError('JAV part grouping requires unique members inside one Field-relative boundary.');
    materialKeys.add(member.materialKey);
    const split=member.relativeLocation.lastIndexOf('/'),parentRelativeLocation=split<0?'.':member.relativeLocation.slice(0,split),
      identity=identifyJavFilename(member.relativeLocation.slice(split+1));
    if(!identity.javCode||!identity.multipartPart){ungrouped.push(member.materialKey);continue;}
    const key=canonicalDigest({parentRelativeLocation,javCode:identity.javCode});
    if(!byScope.has(key))byScope.set(key,{javCode:identity.javCode,parentRelativeLocation,parts:[]});
    byScope.get(key).parts.push({partLabel:identity.multipartPart,materialKey:member.materialKey,relativeLocation:member.relativeLocation});
  }
  const groups=[],conflicts=[];
  for(const group of byScope.values()) {
    if(new Set(group.parts.map(part=>part.partLabel)).size!==group.parts.length) {
      conflicts.push(Object.freeze({javCode:group.javCode,parentRelativeLocation:group.parentRelativeLocation,
        reasonCode:'jav_part_label_conflict',materialKeys:Object.freeze(group.parts.map(part=>part.materialKey).sort())}));continue;
    }
    const parts=Object.freeze(group.parts.sort((a,b)=>a.partLabel.localeCompare(b.partLabel)).map((part,ordinal)=>Object.freeze({ordinal,...part}))),
      value={schema:'procurement.jav-named-part-group@1',javCode:group.javCode,parentRelativeLocation:group.parentRelativeLocation,parts};
    groups.push(Object.freeze({...value,groupDigest:canonicalDigest(value)}));
  }
  groups.sort((a,b)=>a.groupDigest.localeCompare(b.groupDigest));
  return Object.freeze({groups:Object.freeze(groups),conflicts:Object.freeze(conflicts),ungrouped:Object.freeze(ungrouped.sort())});
}
module.exports=Object.freeze({groupJavNamedParts});
