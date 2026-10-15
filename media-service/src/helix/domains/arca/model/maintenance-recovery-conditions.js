'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {aftercareJavSource}=require('./aftercare-artifact-source');

function maintenanceRecoveryConditions(findings,readConditions,context) {
  const kinds=new Set();
  for(const finding of findings) {
    if(['presentation:poster_missing','presentation:poster_corrupt','presentation:fanart_missing','presentation:fanart_corrupt'].includes(finding.findingKind)) {
      if(context?.raw?.identity?.provider==='jav')kinds.add('jav-'+aftercareJavSource(context).siteRef);
      else if(context?.raw?.identity?.provider==='tmdb')kinds.add('tmdb');
      else throw new TypeError('Maintenance poster recovery requires its accepted supported Provider.');
    }
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
