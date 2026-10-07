'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {canonicalDigest} = require('../../src/helix/contracts/canonical-json');
const {createProductionSourceScopeResolver} = require('../../src/helix/domains/libra/planning/production-source-scope-resolver');
const {sourceMediaObservationWork,directMediaSelectionWork} = require('../../src/helix/domains/libra/planning/media-production-work');
const {createWorkspaceMediaProductionPlanner,createWorkspaceMediaProductionProjections,SOURCE_HANDLE,DIRECT_CANDIDATE} =
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
    spec:{schemaRef:'libra.acceptance-spec@1',schemaVersion:1,acceptanceSpecId:'spec',specRevision:1,
      productScope:{episodeKeys:members.flatMap(item=>item.episodeClaims.map(claim=>claim.episodeKey))},
      contentProfile:profile,structureKind:profile==='series'?'season':'single',recordDigest:D('spec'),
      requirements:{mandatoryMedia:{mediaForm:'stream_file',videoCodec:'hevc',container:'any',fileExtension:'any',
        minimumRasterClass:'none',acceptedPrimaryAudioClasses:[],forbidSystemUpscaleFor4k:true},
      space:{unit:profile==='series'?'episode':'product',maxSizeGiB:null,maxSizeBytes:null}}},
    materialInputForm:'stream_file',members};
  let current=snapshot,records=[];
  const options={movieProductionReader:{readRun:()=>current,readRunSnapshot:()=>current},
    productProductionPort:{issuePhysicalReadHandle:input=>({handleId:D(input),materialKey:'material-'+input.physicalIdentity.inode,
      physicalIdentity:input.physicalIdentity,location:input.location,bindingRevision:input.bindingRevision,
      expectedSizeBytes:input.physicalIdentity.sizeBytes,fenceDigest:D(input)})},
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

for(const count of [2,24,32]) test('Series source Plan freezes one independent read-only Probe for each of '+count+' physical Primaries',()=>{
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

function directPlan(value) {
  return createWorkspaceMediaProductionPlanner(value.options).plan({...directMediaSelectionWork(value.snapshot),
    workAttemptId:'direct-attempt',processId:'run'});
}
function directProject(value,parameters) {
  return createWorkspaceMediaProductionProjections(value.options).find(item=>item.projectionRef===DIRECT_CANDIDATE)
    .projection.project({ownerScope:{processId:'run'},parameters});
}
for(const count of [2,24,32]) test('Direct verification and selection bind each of '+count+' Series Primaries independently',()=>{
  const value=fixture(count);value.setRecords(records(value).reverse());
  const nodes=directPlan(value).nodes;
  assert.equal(nodes.length,count*2);assert.equal(new Set(nodes.map(node=>node.eventId)).size,count*2);
  for(let index=0;index<count;index++) {
    const [verify,select]=nodes.slice(index*2,index*2+2),parameters=verify.inputBindings.bindings[0].parameters;
    const input=directProject(value,parameters),source=value.resolver.primarySources(value.snapshot)[index];
    assert.equal(input.sourceProbeEvidence.sourceHandleDigest,canonicalDigest(source.readHandle));
    assert.equal(input.candidateBasisDigest,canonicalDigest(source.readHandle));
    const selection=select.inputBindings.bindings[0];
    assert.deepEqual(select.dependsOn,[{eventId:verify.eventId,satisfaction:'success'}]);
    assert.equal(selection.eventResults.length,1);assert.equal(selection.eventResults[0].eventId,verify.eventId);
    assert.equal(selection.parameters.rankedCandidates[0].candidateId,input.candidateId);
  }
});
for(const mutation of ['foreign_work','member_digest','missing_probe','duplicate_probe','foreign_probe','payload','extra_parameter'])
test('Direct candidate rejects '+mutation+' without choosing the first available Probe',()=>{
  const value=fixture(),items=records(value),parameters={...directPlan(value).nodes[0].inputBindings.bindings[0].parameters};
  if(mutation==='foreign_work')parameters.sourceWorkId='foreign-work';
  if(mutation==='member_digest')parameters.memberDigest=D('stale');
  if(mutation==='missing_probe')items.pop();
  if(mutation==='duplicate_probe')items[1]=items[0];
  if(mutation==='foreign_probe')items[1]={...items[1],result:probe({handleId:'foreign'})};
  if(mutation==='payload')items[1].result.durationMs=2000;
  if(mutation==='extra_parameter')parameters.extra=true;
  value.setRecords(items);assert.throws(()=>directProject(value,parameters));
});
test('Direct candidate rejects an old member binding after Owner state changes',()=>{
  const value=fixture(),parameters=directPlan(value).nodes[0].inputBindings.bindings[0].parameters;
  value.setRecords(records(value));value.setCurrent({...value.snapshot,members:value.snapshot.members.map(m=>({...m,bindingRevision:2}))});
  assert.throws(()=>directProject(value,parameters),{code:'LIBRA_PRODUCTION_SOURCE_MEMBER_STALE'});
});
test('Movie Direct retains its node names and single candidate identity',()=>{
  const value=fixture(1,'movie');value.setRecords(records(value));
  const nodes=directPlan(value).nodes;
  assert.deepEqual(nodes.map(node=>node.nodeId),['direct_media_verification','direct_output_selection']);
  const parameters=nodes[0].inputBindings.bindings[0].parameters;
  assert.deepEqual(Object.keys(parameters),['sourceWorkId']);
  assert.equal(directProject(value,parameters).candidateNodeId,'direct_input');
});
test('N:M Direct verifies each physical member once with complete bounded aggregate evidence',()=>{
  const value=fixture();value.snapshot.members[0].episodeClaims.push(value.snapshot.members[1].episodeClaims[0]);
  value.setRecords(records(value));assert.equal(directPlan(value).nodes.length,4);
  value.snapshot.spec.requirements.space={unit:'episode',maxSizeGiB:0.75,maxSizeBytes:805306368};
  const nodes=directPlan(value).nodes;assert.equal(nodes.length,4);
  const input=directProject(value,nodes[0].inputBindings.bindings[0].parameters);
  assert.equal(input.seriesSpaceBasis.members.length,2);
  assert.deepEqual(input.seriesSpaceBasis.episodeKeys,['E001','E002']);
});
test('A failing Episode cannot borrow the passed verification of another Primary',()=>{
  const {buildProductMediaVerification,selectProductOutput}=require('../../src/helix/domains/libra/model/media-production-contracts');
  const value=fixture(),items=records(value);
  items[1].result.videoStreams[0].codec='h264';
  items[1].result.payloadDigest=canonicalDigest(Object.fromEntries(Object.entries(items[1].result).filter(([key])=>key!=='payloadDigest')));
  value.setRecords(items);
  const nodes=directPlan(value).nodes,projections=createWorkspaceMediaProductionProjections(value.options);
  const selectProjection=projections.find(item=>item.projectionRef.endsWith('/ProductOutputSelectionInput/v1')).projection;
  const results=[];
  for(let index=0;index<2;index++) {
    const [verify,select]=nodes.slice(index*2,index*2+2),input=directProject(value,verify.inputBindings.bindings[0].parameters);
    const result=buildProductMediaVerification({input,verifiedAtMs:1,playbackVerification:{
      samplePointsPercent:[5,50,95],passedSamplePointsPercent:[5,50,95],decodeDigest:D('decode')}});
    results.push(result);
    const selected=selectProductOutput({input:selectProjection.project({sourceResults:[{result}],
      parameters:select.inputBindings.bindings[0].parameters}),producedAtMs:1});
    assert.equal(result.result,index===0?'passed':'failed');
    assert.equal(selected.result,index===0?'selected':'not_selected');
  }
  assert.throws(()=>selectProjection.project({sourceResults:[{result:results[0]}],
    parameters:nodes[3].inputBindings.bindings[0].parameters}));
});

function directResultsFixture(count=2) {
  const {buildProductMediaVerification,selectProductOutput}=require('../../src/helix/domains/libra/model/media-production-contracts');
  const value=fixture(count),sourceRecords=records(value);value.setRecords(sourceRecords);
  const nodes=directPlan(value).nodes,output=[];
  const projection=createWorkspaceMediaProductionProjections(value.options)
    .find(item=>item.projectionRef.endsWith('/ProductOutputSelectionInput/v1')).projection;
  for(let index=0;index<count;index++) {
    const [verify,select]=nodes.slice(index*2,index*2+2);
    const input=directProject(value,verify.inputBindings.bindings[0].parameters);
    const verification=buildProductMediaVerification({input,verifiedAtMs:1,playbackVerification:{
      samplePointsPercent:[5,50,95],passedSamplePointsPercent:[5,50,95],decodeDigest:D('decode')}});
    const selection=selectProductOutput({input:projection.project({sourceResults:[{result:verification}],
      parameters:select.inputBindings.bindings[0].parameters}),producedAtMs:1});
    output.push({outcomeKind:'succeeded',capabilityRef:'libra.product_media.verify@1',result:{...verification}},
      {outcomeKind:'succeeded',capabilityRef:'libra.product_output.select@1',result:{...selection}});
  }
  const workId=directMediaSelectionWork(value.snapshot).workId;
  value.options.workResultReader.read=id=>id===workId?output:sourceRecords;
  return {...value,output,workId};
}
const {readDirectMediaSelections}=require('../../src/helix/domains/libra/planning/direct-media-selections');
for(const count of [2,24,32]) test('Direct durable set reconstructs every frozen Primary for '+count+' members',()=>{
  const value=directResultsFixture(count);value.output.reverse();
  const result=readDirectMediaSelections(value.options,value.snapshot,value.workId);
  assert.equal(result.length,count);assert.equal(new Set(result.map(item=>item.selection.selectedHandleId)).size,count);
  assert.ok(result.every(item=>item.selection.result==='selected'));
});
for(const mutation of ['missing','duplicate','foreign_run','handle','selection_digest','borrowed_selection','allocation','input_basis'])
test('Direct durable set rejects '+mutation+' before delivery',()=>{
  const value=directResultsFixture();
  if(mutation==='missing')value.output.pop();
  if(mutation==='duplicate')value.output[2]=value.output[0];
  if(mutation==='foreign_run')value.output[0].result.libraRunId='other';
  if(mutation==='handle')value.output[0].result.productMaterialHandleDigest=D('foreign');
  if(mutation==='selection_digest')value.output[1].result.draftDigest=D('forged');
  if(mutation==='borrowed_selection')value.output[3]=value.output[1];
  if(mutation==='allocation'){value.output[0].result=structuredClone(value.output[0].result);
    value.output[0].result.spaceSummary.episodeAllocation.allocations[0].allocatedBytes.numerator='1';}
  if(mutation==='input_basis')value.output[0].result.basisDigest=D('foreign-input');
  assert.throws(()=>readDirectMediaSelections(value.options,value.snapshot,value.workId));
});

function verifyDirectInput(input) {
  return require('../../src/helix/domains/libra/model/media-production-contracts').buildProductMediaVerification({input,
    verifiedAtMs:1,playbackVerification:{samplePointsPercent:[5,50,95],passedSamplePointsPercent:[5,50,95],decodeDigest:D('decode')}});
}
function aggregateFixture(cap) {
  const value=fixture();
  value.snapshot.members[0].episodeClaims.push({...value.snapshot.members[1].episodeClaims[0]});
  value.snapshot.members[1].episodeClaims=[{...value.snapshot.members[0].episodeClaims[0]}];
  for(const [index,size] of [9,3].entries()) {
    value.snapshot.members[index].sizeBytes=size;value.snapshot.members[index].physicalIdentity.sizeBytes=size;
  }
  value.snapshot.spec.requirements.space={unit:'episode',maxSizeBytes:cap,maxSizeGiB:cap/1073741824};
  value.setRecords(records(value));
  return {value,input:directProject(value,directPlan(value).nodes[0].inputBindings.bindings[0].parameters)};
}
for(const cap of [7,8]) test('Direct complete N:M basis compares fractional shares against '+cap+' bytes',()=>{
  const {input}=aggregateFixture(cap),result=verifyDirectInput(input);
  assert.deepEqual(result.spaceSummary.episodeAllocation.allocations.map(item=>[item.episodeKey,item.allocatedBytes]),[
    ['E001',{numerator:'15',denominator:'2'}],['E002',{numerator:'9',denominator:'2'}]]);
  assert.equal(result.spaceSummary.actualSizeBytes,9);
  assert.equal(result.result,cap===7?'failed':'passed');
  assert.deepEqual(result.reasonCodes,cap===7?['max_size_exceeded']:[]);
});
for(const mutation of ['missing','foreign_run','digest','duplicate_handle','probe','size','incomplete_scope','unsorted','extra'])
test('Direct verification rejects corrupted Series space basis: '+mutation,()=>{
  const input=structuredClone(aggregateFixture(8).input),basis=input.seriesSpaceBasis;
  if(mutation==='missing')delete input.seriesSpaceBasis;
  if(mutation==='foreign_run')basis.libraRunId='other';
  if(mutation==='digest')basis.basisDigest=D('false');
  if(mutation==='duplicate_handle')basis.members[1].handleDigest=basis.members[0].handleDigest;
  if(mutation==='probe')basis.members[0].probeDigest=D('foreign');
  if(mutation==='size')basis.members[0].sizeBytes=8;
  if(mutation==='incomplete_scope')basis.episodeKeys.pop();
  if(mutation==='unsorted')basis.members.reverse();
  if(mutation==='extra')basis.extra=true;
  // Rehash to distinguish semantic/canonical failure from a stale outer digest.
  if(mutation!=='digest'&&mutation!=='missing')basis.basisDigest=canonicalDigest(Object.fromEntries(
    Object.entries(basis).filter(([key])=>key!=='basisDigest')));
  input.inputDigest=canonicalDigest(Object.fromEntries(Object.entries(input).filter(([key])=>key!=='inputDigest')));
  const result=verifyDirectInput(input);
  assert.equal(result.result,'failed');assert.ok(result.reasonCodes.includes('requirement_integrity_failure'));
});
test('Series verification identity binds the entire allocation basis, including another part',()=>{
  const first=aggregateFixture(8),second=aggregateFixture(8);
  second.value.snapshot.members[1].physicalIdentity.sizeBytes=4;second.value.snapshot.members[1].sizeBytes=4;
  second.value.setRecords(records(second.value));
  const changed=directProject(second.value,directPlan(second.value).nodes[0].inputBindings.bindings[0].parameters);
  assert.equal(first.input.candidateId,changed.candidateId);
  assert.notEqual(verifyDirectInput(first.input).verificationId,verifyDirectInput(changed).verificationId);
});

test('Series media space typed bounds reject oversized sets, unknown fields and fractional byte truncation',()=>{
  const Ajv=require('ajv/dist/2020'),schemas=require('../../scripts/helix-architecture/series-media-space-schema');
  const ajv=new Ajv({strict:false,allErrors:true}),validateBasis=ajv.compile(schemas.basis),validateAllocation=ajv.compile(schemas.allocation);
  const input=aggregateFixture(8).input,allocation=verifyDirectInput(input).spaceSummary.episodeAllocation;
  assert.equal(validateBasis(input.seriesSpaceBasis),true,JSON.stringify(validateBasis.errors));
  assert.equal(validateAllocation(allocation),true,JSON.stringify(validateAllocation.errors));
  for(const mutation of ['member_count','claims','extra','unsafe_size']) {
    const value=structuredClone(input.seriesSpaceBasis);
    if(mutation==='member_count')value.members=Array(33).fill(value.members[0]);
    if(mutation==='claims')value.members[0].episodeKeys=Array.from({length:33},(_,i)=>'E'+i);
    if(mutation==='extra')value.members[0].hidden=true;
    if(mutation==='unsafe_size')value.members[0].sizeBytes=Number.MAX_SAFE_INTEGER+1;
    assert.equal(validateBasis(value),false,mutation);
  }
  for(const mutation of ['fraction','zero_denominator','oversized_numerator']) {
    const value=structuredClone(allocation);
    if(mutation==='fraction')value.allocations[0].allocatedBytes.numerator=7.5;
    if(mutation==='zero_denominator')value.allocations[0].allocatedBytes.denominator='0';
    if(mutation==='oversized_numerator')value.allocations[0].allocatedBytes.numerator='9'.repeat(65);
    assert.equal(validateAllocation(value),false,mutation);
  }
});
