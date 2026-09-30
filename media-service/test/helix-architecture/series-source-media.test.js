'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {canonicalDigest} = require('../../src/helix/contracts/canonical-json');
const {createProductionSourceScopeResolver} = require('../../src/helix/domains/libra/planning/production-source-scope-resolver');
const {sourceMediaObservationWork} = require('../../src/helix/domains/libra/planning/media-production-work');
const {createWorkspaceMediaProductionPlanner,createWorkspaceMediaProductionProjections,SOURCE_HANDLE} =
  require('../../src/helix/domains/libra/planning/media-production-planner');
const {readSourceMediaObservations} = require('../../src/helix/domains/libra/planning/source-media-observations');

const D = value => canonicalDigest({value});
const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname,
  '../../src/helix/contracts/capabilities/shared/material/media/probe/v1/manifest.json'),'utf8'));
function fixture(count=2,profile='series') {
  const members = Array.from({length:count},(_,index)=>({ordinal:index,materialKey:'material-'+String(index+1).padStart(3,'0'),
    role:'primary_payload',bindingRevision:1,sizeBytes:100+index,endpointId:'source-endpoint',location:'episode-'+index+'.mkv',
    physicalIdentity:{mountScopeId:'source-mount',inode:String(index+1),sizeBytes:100+index},
    episodeClaims:profile==='series'?[{episodeKey:'E'+String(index+1).padStart(3,'0'),seasonClaimDigest:D('season'),claimDigest:D(index)}]:[]}));
  const snapshot={run:{libraRunId:'run',executionBasisDigest:D('basis'),acceptanceSpecId:'spec',createdAtMs:1,
    runMaterialManifestId:'manifest',runMaterialManifestDigest:D('manifest'),runScopeDigest:D('scope'),priorityClass:'normal'},
    spec:{contentProfile:profile,structureKind:profile==='series'?'season':'single',recordDigest:D('spec')},
    materialInputForm:'stream_file',members};
  let current=snapshot,records=[];
  const options={movieProductionReader:{readRun:()=>current,readRunSnapshot:()=>current},
    productProductionPort:{issuePhysicalReadHandle:input=>({handleId:D(input),materialKey:'material-'+input.physicalIdentity.inode,
      physicalIdentity:input.physicalIdentity,location:input.location,bindingRevision:input.bindingRevision})},
    registry:{snapshot:[],resolve:()=>({manifest})},
    policyRegistry:{digest:D('policy'),bindingFor:()=>({retryPolicyRef:'fixture-retry',timeoutPolicyRef:'fixture-timeout'})},
    workResultReader:{read:workId=>{assert.equal(workId,sourceMediaObservationWork(snapshot).workId);return records;}}};
  const resolver=createProductionSourceScopeResolver({movieProductionReader:options.movieProductionReader,
    productionPort:options.productProductionPort});
  return {snapshot,options,resolver,setCurrent:value=>{current=value;},setRecords:value=>{records=value;}};
}
function plan(value) {
  return createWorkspaceMediaProductionPlanner(value.options).plan({...sourceMediaObservationWork(value.snapshot),
    workAttemptId:'attempt',processId:value.snapshot.run.libraRunId});
}
function project(value,parameters) {
  return createWorkspaceMediaProductionProjections(value.options).find(item=>item.projectionRef===SOURCE_HANDLE)
    .projection.project({ownerScope:{processId:'run'},parameters});
}
function probe(handle,notMedia=false) {
  const body={schemaRef:'helix://contracts/types/MediaProbeEvidence/v1',schemaVersion:1,
    evidenceId:D(handle.handleId),sourceHandleDigest:canonicalDigest(handle),resultKind:notMedia?'not_media':'probed',
    ...(notMedia?{reasonCode:'probe_not_media'}:{container:'matroska',durationMs:1000}),
    videoStreams:notMedia?[]:[{streamIndex:0,codec:'hevc',dispositionDefault:true,dynamicRangeKind:'sdr',bitDepth:8,pixelFormat:'yuv420p'}],
    audioStreams:[],subtitleStreams:[]};
  return {...body,payloadDigest:canonicalDigest(body)};
}
function records(value) {
  return value.resolver.primarySources(value.snapshot).map(item=>({outcomeKind:'succeeded',
    capabilityRef:'shared.material.media.probe@1',result:probe(item.readHandle)}));
}

for(const count of [2,24]) test('Series source Plan freezes one independent read-only Probe for each of '+count+' physical Primaries',()=>{
  const value=fixture(count),definition=plan(value);
  assert.equal(definition.nodes.length,count);
  assert.equal(new Set(definition.nodes.map(node=>node.eventId)).size,count);
  for(const [index,node] of definition.nodes.entries()) {
    const binding=node.inputBindings.bindings[0],member=value.snapshot.members[index];
    assert.equal(node.capabilityRef,'shared.material.media.probe@1');
    assert.equal(node.effectClass,'pure_observation');assert.deepEqual(node.dependsOn,[]);
    assert.deepEqual(binding.parameters,{materialKey:member.materialKey,memberDigest:canonicalDigest(member)});
    assert.equal(project(value,binding.parameters).location,member.location);
  }
});
test('N:M Episode claims never multiply a physical source Probe',()=>{
  const value=fixture();
  value.snapshot.members[0].episodeClaims.push({...value.snapshot.members[1].episodeClaims[0]});
  value.snapshot.members[1].episodeClaims=[{...value.snapshot.members[0].episodeClaims[0]}];
  assert.equal(plan(value).nodes.length,2);
  assert.equal(value.resolver.primarySources(value.snapshot).length,2);
});
test('Member ordering cannot change Series source Event identity or frozen input',()=>{
  const left=fixture(),right=fixture();right.snapshot.members.reverse();
  assert.deepEqual(plan(left),plan(right));
});
test('A source projection issues only its declared Primary Handle',()=>{
  const value=fixture(24),parameters=plan(value).nodes[8].inputBindings.bindings[0].parameters;
  const issued=[],original=value.options.productProductionPort.issuePhysicalReadHandle;
  value.options.productProductionPort.issuePhysicalReadHandle=input=>{issued.push(input);return original(input);};
  assert.equal(project(value,parameters).location,value.snapshot.members[8].location);
  assert.equal(issued.length,1);
});
test('Movie source Plan retains one Event with the existing ID and empty member parameters',()=>{
  const value=fixture(1,'movie'),node=plan(value).nodes[0];
  assert.equal(node.nodeId,'source_media_probe');
  assert.equal(node.eventId,'libra-source-media-probe-event-'+canonicalDigest({attempt:'attempt'}).slice(0,40));
  assert.deepEqual(node.inputBindings.bindings[0].parameters,{});
  assert.equal(project(value,{}).location,value.snapshot.members[0].location);
  assert.throws(()=>project(value,{materialKey:'foreign'}),/cannot carry Series/);
});
test('Movie durable Probe retains its single-source conservation check',()=>{
  const value=fixture(1,'movie'),items=records(value);value.setRecords(items);
  assert.equal(readSourceMediaObservations(value.options,value.snapshot).length,1);
  value.setRecords([...items,...items]);assert.throws(()=>readSourceMediaObservations(value.options,value.snapshot));
  value.setRecords([{...items[0],result:probe({handleId:'foreign'})}]);
  assert.throws(()=>readSourceMediaObservations(value.options,value.snapshot));
});
for(const mutation of ['missing','foreign','digest','extra']) test('Owner projection rejects '+mutation+' Series member binding',()=>{
  const value=fixture(),parameters=plan(value).nodes[0].inputBindings.bindings[0].parameters;
  const changed={...parameters};
  if(mutation==='missing')delete changed.memberDigest;
  if(mutation==='foreign')changed.materialKey='foreign';
  if(mutation==='digest')changed.memberDigest=D('wrong');
  if(mutation==='extra')changed.episodeKey='E002';
  assert.throws(()=>project(value,changed),{code:'LIBRA_PRODUCTION_SOURCE_MEMBER_STALE'});
});
for(const field of ['executionBasisDigest','runMaterialManifestDigest']) test('Source reconstruction rejects stale '+field,()=>{
  const value=fixture();value.setCurrent({...value.snapshot,run:{...value.snapshot.run,[field]:D('changed')}});
  assert.throws(()=>value.resolver.primarySources(value.snapshot),{code:'LIBRA_PRODUCTION_SOURCE_MEMBER_STALE'});
});
test('A changed Binding cannot be substituted behind an old source snapshot or Plan',()=>{
  const value=fixture(),parameters=plan(value).nodes[0].inputBindings.bindings[0].parameters;
  const current={...value.snapshot,members:value.snapshot.members.map(item=>({...item,bindingRevision:2}))};
  value.setCurrent(current);
  assert.throws(()=>value.resolver.primarySources(value.snapshot),{code:'LIBRA_PRODUCTION_SOURCE_MEMBER_STALE'});
  assert.throws(()=>project(value,parameters),{code:'LIBRA_PRODUCTION_SOURCE_MEMBER_STALE'});
});
test('Series source probing does not broaden the single-file Remux Source Scope',()=>{
  const value=fixture();assert.equal(plan(value).nodes.length,2);
  assert.throws(()=>value.resolver.referenceFor(value.snapshot),{code:'P9_MEDIA_SOURCE_SCOPE_MEMBERS'});
});
test('Result reconstruction maps reversed durable Results to the exact frozen member set',()=>{
  const value=fixture(24);value.setRecords(records(value).reverse());
  const selected=readSourceMediaObservations(value.options,value.snapshot);
  assert.equal(selected.length,24);
  assert.deepEqual(selected.map(item=>item.member.materialKey),value.snapshot.members.map(item=>item.materialKey));
  for(const item of selected)assert.equal(item.record.result.sourceHandleDigest,canonicalDigest(item.readHandle));
});
for(const mutation of ['missing','duplicate','foreign','failed','payload']) test('Result reconstruction rejects '+mutation+' Probe coverage',()=>{
  const value=fixture(),items=records(value);
  if(mutation==='missing')items.pop();
  if(mutation==='duplicate')items[1]=items[0];
  if(mutation==='foreign')items[1]={...items[1],result:probe({handleId:'foreign'})};
  if(mutation==='failed')items[1]={...items[1],outcomeKind:'failed'};
  if(mutation==='payload')items[1].result.durationMs=2000;
  value.setRecords(items);assert.throws(()=>readSourceMediaObservations(value.options,value.snapshot));
});
test('Not-media remains an explicit observation for its exact source member',()=>{
  const value=fixture(),items=records(value),sources=value.resolver.primarySources(value.snapshot);
  items[1].result=probe(sources[1].readHandle,true);value.setRecords(items);
  const selected=readSourceMediaObservations(value.options,value.snapshot);
  assert.equal(selected[1].record.result.resultKind,'not_media');
  assert.equal(selected[0].record.result.resultKind,'probed');
});
