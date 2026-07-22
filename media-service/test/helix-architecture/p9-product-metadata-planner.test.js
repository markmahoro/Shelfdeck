'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { planMetadataGap } = require('../../src/helix/domains/libra/planning/product-metadata-planner');

const d = (value) => canonicalDigest({ value });
const base = { libraRunId:'run-1',runExecutionBasisDigest:d('basis'),resolvedIdentityDigest:d('identity'),
  requiredFields:['plot','title'],contentProfile:'movie',observations:[],relatedNfo:{referenceId:'nfo-1',referenceDigest:d('nfo'),expectedChecksum:d('checksum')},
  provider:{providerKind:'tmdb',integrationId:'tmdb-main',configRevision:2} };

function observed(sourceKind,sourceRef,priority,entries){return {sourceKind,sourceRef,sourcePriority:priority,contentProfile:'movie',identityDigest:d('identity'),
  descriptiveFacts:{entries}};}

test('plans Related NFO then TMDB and never performs executor fallback',()=>{
  const first=planMetadataGap(base);
  assert.equal(first.planKind,'fetch_source');
  assert.equal(first.nextIntent.sourceKind,'related_nfo');
  assert.equal(first.nextIntent.sourcePriority,0);
  const second=planMetadataGap({...base,observations:[observed('related_nfo','nfo-1',0,[{key:'title',value:'Local'}])]});
  assert.equal(second.nextIntent.providerKind,'tmdb');
  assert.equal(second.nextIntent.sourcePriority,1);
  assert.deepEqual(second.missingFields,['plot']);
  const ready=planMetadataGap({...base,observations:[observed('related_nfo','nfo-1',0,[{key:'title',value:'Local'}]),
    observed('provider','tmdb:tmdb-main@2',1,[{key:'plot',value:'Plot'}])]});
  assert.equal(ready.planKind,'draft_ready');
});

test('keeps JAV and Western on their own closed source paths',()=>{
  const jav=planMetadataGap({...base,contentProfile:'jav',relatedNfo:null,provider:{providerKind:'jav',integrationId:'jav-main',configRevision:1}});
  assert.equal(jav.nextIntent.providerKind,'jav');
  assert.equal(jav.nextIntent.sourcePriority,0);
  const western=planMetadataGap({...base,contentProfile:'western_adult',relatedNfo:null,provider:null});
  assert.equal(western.planKind,'western_analysis');
  assert.equal(western.nextIntent,null);
  assert.throws(()=>planMetadataGap({...base,contentProfile:'western_adult',observations:[{...observed('provider','tmdb:x@1',0,[]),contentProfile:'western_adult'}]}),
    (error)=>error.code==='P9_METADATA_PLAN_WESTERN_OBSERVATION');
});

test('returns an explicit unresolved gap when the fixed source budget is exhausted',()=>{
  const unresolved=planMetadataGap({...base,relatedNfo:null,observations:[observed('provider','tmdb:tmdb-main@2',0,[])]});
  assert.equal(unresolved.planKind,'gap_unresolved');
  assert.deepEqual(unresolved.missingFields,['plot','title']);
});

test('rejects cross-profile, cross-identity, and non-contiguous Observation input before planning',()=>{
  const first=observed('related_nfo','nfo-1',0,[{key:'title',value:'A'}]);
  assert.throws(()=>planMetadataGap({...base,observations:[{...first,contentProfile:'series'}]}),
    (error)=>error.code==='P9_METADATA_PLAN_OBSERVATION_SCOPE');
  assert.throws(()=>planMetadataGap({...base,observations:[{...first,identityDigest:d('other')}]}),
    (error)=>error.code==='P9_METADATA_PLAN_OBSERVATION_SCOPE');
  assert.throws(()=>planMetadataGap({...base,observations:[{...first,sourcePriority:1}]}),
    (error)=>error.code==='P9_METADATA_PLAN_OBSERVATION_SCOPE');
});
