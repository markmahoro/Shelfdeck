'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');

function maintenanceRecoveryConditions(findings,readConditions) {
  const kinds=new Set();
  for(const finding of findings) {
    if(['presentation:poster_missing','presentation:poster_corrupt'].includes(finding.findingKind))kinds.add('tmdb');
    if(['conformance:video_codec_unmet','conformance:max_size_exceeded'].includes(finding.findingKind))kinds.add('media_compute');
  }
  const conditions=readConditions?.([...kinds].sort())||[];
  if(!Array.isArray(conditions)||conditions.length>8||conditions.some(value=>!kinds.has(value.conditionKind)||
      !/^[a-f0-9]{64}$/.test(value.snapshotDigest||'')))throw new TypeError('Maintenance recovery conditions must be bounded public owner projections.');
  const ordered=conditions.map(value=>({conditionKind:value.conditionKind,snapshotDigest:value.snapshotDigest}))
    .sort((a,b)=>a.conditionKind.localeCompare(b.conditionKind));
  const value=canonicalJson(ordered);
  return Object.freeze({conditions:ordered,parameter:Object.freeze({parameter:'trigger.recoveryConditions',valueType:'string',value,valueDigest:canonicalDigest(value)})});
}
module.exports=Object.freeze({maintenanceRecoveryConditions});
