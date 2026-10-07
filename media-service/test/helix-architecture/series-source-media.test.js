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

function directResultsFixture(count=2,configure=()=>{}) {
  const {buildProductMediaVerification,selectProductOutput}=require('../../src/helix/domains/libra/model/media-production-contracts');
  const value=fixture(count);configure(value);const sourceRecords=records(value);value.setRecords(sourceRecords);
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

for(const count of [2,24,32])test('Production Scope reconstructs exactly one of '+count+' Series physical Primaries',()=>{
  const value=fixture(count),member=value.snapshot.members.at(-1),issued=[];
  const original=value.options.productProductionPort.issuePhysicalReadHandle;
  value.options.productProductionPort.issuePhysicalReadHandle=input=>{issued.push(input);return original(input);};
  const reference=value.resolver.primaryReferenceFor(value.snapshot,{materialKey:member.materialKey,memberDigest:canonicalDigest(member)});
  assert.equal(reference.memberCount,1);assert.equal(issued.length,0);
  const resolved=value.resolver.resolve(reference);
  assert.equal(resolved.members.length,1);assert.equal(resolved.primaryMembers.length,1);assert.equal(resolved.structuralMembers.length,0);
  assert.equal(resolved.members[0].member.materialKey,member.materialKey);
  assert.equal(resolved.primaryReadHandle.location,member.location);assert.equal(issued.length,1);
  const reordered={...value.snapshot,members:[...value.snapshot.members].reverse()};value.setCurrent(reordered);
  assert.deepEqual(value.resolver.primaryReferenceFor(reordered,
    {materialKey:member.materialKey,memberDigest:canonicalDigest(member)}),reference);
});
for(const mutation of ['scope_id','scope_digest','set_digest','count','payload_digest','manifest','member'])
test('Series production scope rejects '+mutation+' before issuing any read Handle',()=>{
  const value=fixture(),member=value.snapshot.members[0],reference=structuredClone(value.resolver.primaryReferenceFor(value.snapshot,
    {materialKey:member.materialKey,memberDigest:canonicalDigest(member)}));
  if(mutation==='scope_id')reference.scopeId='foreign';
  if(mutation==='scope_digest')reference.scopeDigest=D('foreign');
  if(mutation==='set_digest')reference.memberSetDigest=D('foreign');
  if(mutation==='count')reference.memberCount=2;
  if(mutation==='payload_digest')reference.selectedPayloadSetDigest=D('foreign');
  if(mutation==='manifest')value.snapshot.run.runMaterialManifestDigest=D('new-manifest');
  if(mutation==='member')member.bindingRevision=2;
  reference.sourceReferenceDigest=canonicalDigest(Object.fromEntries(Object.entries(reference).filter(([key])=>key!=='sourceReferenceDigest')));
  value.options.productProductionPort.issuePhysicalReadHandle=()=>{throw new Error('Read authority must not be issued');};
  assert.throws(()=>value.resolver.resolve(reference),{code:'LIBRA_PRODUCTION_SOURCE_SCOPE_STALE'});
});
test('Series member Work identities and retry dependencies never cross physical Primaries',()=>{
  const {remuxMediaSelectionWork:remux,transcodeMediaSelectionWork:transcode,transcodeStrategyAssessmentWork:assessment}=
    require('../../src/helix/domains/libra/planning/media-production-work');
  const {snapshot}=fixture(),[first,second]=snapshot.members;
  for(const work of [member=>remux(snapshot,member),member=>assessment(snapshot,1,member),member=>transcode(snapshot,1,member)]) {
    const a=work(first),b=work(second);assert.notEqual(a.workId,b.workId);assert.notEqual(a.idempotencyKey,b.idempotencyKey);
    assert.deepEqual(a,work(first));assert.equal(a.executionBasisDigest,snapshot.run.executionBasisDigest);
  }
  assert.ok(transcode(snapshot,2,first).dependencyRefs.some(ref=>ref.objectId===assessment(snapshot,2,first).workId));
  assert.ok(assessment(snapshot,2,first).dependencyRefs.some(ref=>ref.objectId===assessment(snapshot,1,first).workId));
  assert.ok(!assessment(snapshot,2,first).dependencyRefs.some(ref=>ref.objectId===assessment(snapshot,1,second).workId));
  for(const member of [{...first,bindingRevision:2},{...first,materialKey:'foreign'},{...first,role:'structural_dependency'}])
    assert.throws(()=>remux(snapshot,member),/exact frozen Series Primary/);
  const movie=fixture(1,'movie');assert.throws(()=>remux(movie.snapshot,movie.snapshot.members[0]),/exact frozen Series Primary/);
});

function memberRemuxPlan(value,member) {
  const {remuxMediaSelectionWork}=require('../../src/helix/domains/libra/planning/media-production-work');
  value.options.movieProductionReader.readWorkspace=()=>({workspaceId:D('workspace'),state:'active',currentRevision:1,
    stateDigest:D('workspace-state'),workspaceScopeDigest:D('workspace-scope')});
  value.options.workspaceProductPort={rootSnapshot:()=>({snapshotDigest:D('root')})};
  const work=remuxMediaSelectionWork(value.snapshot,member);
  return createWorkspaceMediaProductionPlanner(value.options).plan({...work,workAttemptId:'attempt-'+member.materialKey});
}
test('Series Remux Planner binds one member and distinct output targets without narrowing the Run',()=>{
  const value=fixture(),before=canonicalDigest(value.snapshot),plans=value.snapshot.members.map(member=>memberRemuxPlan(value,member));
  for(const [index,plan] of plans.entries()) {
    assert.equal(plan.nodes.length,4);
    const reference=plan.nodes[0].inputBindings.bindings.find(binding=>binding.portName==='productionSourceScopeReference').value;
    assert.equal(value.resolver.resolve(reference).primaryMembers[0].member.materialKey,value.snapshot.members[index].materialKey);
    const parameters=plan.nodes[2].inputBindings.bindings[0].parameters;
    assert.equal(parameters.materialKey,value.snapshot.members[index].materialKey);
    assert.equal(parameters.memberDigest,canonicalDigest(value.snapshot.members[index]));
    assert.equal(plan.executionBasisDigest,value.snapshot.run.executionBasisDigest);
  }
  const target=plan=>plan.nodes[0].inputBindings.bindings.find(binding=>binding.portName==='workspaceMediaOutputTarget').value;
  assert.notEqual(target(plans[0]).targetId,target(plans[1]).targetId);
  assert.notEqual(target(plans[0]).targetRelativePath,target(plans[1]).targetRelativePath);
  assert.equal(canonicalDigest(value.snapshot),before);
});
test('Series Workspace Candidate replaces only its source member in the complete Episode basis',()=>{
  const {value}=aggregateFixture(8),member=value.snapshot.members[0],plan=memberRemuxPlan(value,member),
    parameters=plan.nodes[2].inputBindings.bindings[0].parameters,source=value.resolver.primarySources(value.snapshot)[0],
    handle={handleId:D('output'),processId:'run',workspaceId:D('workspace'),relativePath:'media/output.mkv',
      sizeBytes:8,fenceDigest:D('output-fence')},outputProbe=probe(handle),
    media={sourceMaterialHandleDigest:canonicalDigest(source.readHandle),workspaceMaterialHandle:handle,
      workspaceMediaHandleId:D('output-media'),outputTargetId:D('target'),outputTargetDigest:D('target-digest'),
      productionIntentDigest:D('intent'),producingEventId:'remux-event'};
  const projection=createWorkspaceMediaProductionProjections(value.options).find(item=>item.projectionRef.endsWith('/WorkspaceProductMediaCandidateInput/v1')).projection;
  const input=projection.project({sourceResults:[{result:media},{result:outputProbe}],parameters});
  assert.equal(input.seriesSpaceBasis.members.length,2);
  assert.equal(input.sourceProbeEvidence.sourceHandleDigest,canonicalDigest(source.readHandle));
  assert.equal(input.seriesSpaceBasis.members[0].handleDigest,canonicalDigest(handle));
  const verification=verifyDirectInput(input);
  assert.equal(verification.result,'passed');
  assert.deepEqual(verification.spaceSummary.episodeAllocation.allocations.map(item=>item.allocatedBytes),[
    {numerator:'7',denominator:'1'},{numerator:'4',denominator:'1'}]);
  for(const mutation of ['source','member','work','output_probe']) {
    const altered=structuredClone({sourceResults:[{result:media},{result:outputProbe}],parameters});
    if(mutation==='source')altered.sourceResults[0].result.sourceMaterialHandleDigest=D('foreign');
    if(mutation==='member')altered.parameters.materialKey=value.snapshot.members[1].materialKey;
    if(mutation==='work')altered.parameters.sourceWorkId='foreign-work';
    if(mutation==='output_probe')altered.sourceResults[1].result=probe({...handle,handleId:D('foreign')});
    assert.throws(()=>projection.project(altered),mutation);
  }
});

test('Member Remux Plan reaches the formal Capability with only its declared read scope',async()=>{
  const {createMediaProductionCapabilityPorts}=require('../../src/helix/domains/libra/capabilities/media-production-capability-ports');
  const value=fixture(2),member=value.snapshot.members[1],plan=memberRemuxPlan(value,member),node=plan.nodes[0];
  const captured=[],sentinel=Object.assign(new Error('Captured exact member Effect boundary'),{code:'TEST_MEMBER_BOUNDARY'});
  const ports=createMediaProductionCapabilityPorts({resolveProductionSourceScope:ref=>value.resolver.resolve(ref),
    mediaEffectPort:{executeRemux:async request=>{captured.push(request);throw sentinel;},executeTranscode:async()=>{},
      verifyTranscodeInput:async()=>{},verifyPlayback:async()=>{}}});
  const context={eventId:node.eventId,eventAttemptId:'attempt',idempotencyKey:'member-remux',
    namedInputs:Object.fromEntries(node.inputBindings.bindings.map(binding=>[binding.portName,binding.value]))};
  await assert.rejects(()=>ports['libra.media.remux@1'].execute(context),error=>error===sentinel);
  assert.equal(captured.length,1);assert.equal(captured[0].source.members.length,1);
  assert.equal(captured[0].source.primaryReadHandle.location,member.location);
  assert.equal(captured[0].source.primaryMembers[0].member.materialKey,member.materialKey);
  const forged=structuredClone(context);forged.namedInputs.productionSourceScopeReference.scopeId=value.snapshot.members[0].materialKey;
  await assert.rejects(()=>ports['libra.media.remux@1'].execute(forged),{code:'LIBRA_PRODUCTION_SOURCE_SCOPE_STALE'});
  assert.equal(captured.length,1);
});

function memberTranscodeFixture() {
  const value=fixture(),media=require('../../src/helix/domains/libra/model/media-production-contracts');
  value.setRecords(records(value));memberRemuxPlan(value,value.snapshot.members[0]);
  const sourceRead=value.options.workResultReader.read,stored=new Map();
  value.options.workResultReader.read=workId=>stored.has(workId)?stored.get(workId):
    workId===sourceMediaObservationWork(value.snapshot).workId?sourceRead(workId):[];
  const device={deviceId:'device',deviceClass:'nvidia_nvenc',probeRevision:1,capabilitySchemaRef:'platform.compute-device-capability@1',
    capabilityPayload:{supportedVideoCodecs:['hevc'],supportedRateControlModes:['quality_bound','target_size','strict_abr'],validatedConcurrentSlots:1,
      validatedVideoPipelines:[{pipelineProfileId:'ordinary_to_hevc@1',inputDynamicRangeKinds:['sdr'],inputPixelFormats:['yuv420p'],
        outputCodec:'hevc',outputDynamicRangeKind:'unknown',outputPixelFormat:'encoder_selected',
        outputColorProfile:{range:'source',primaries:'source',transfer:'source',matrix:'source'},selfTestDigest:D('device-self-test')}]},
    capabilityDigest:'',enabled:true,state:'ready'};
  device.capabilityDigest=canonicalDigest(device.capabilityPayload);device.snapshotDigest=canonicalDigest(device);
  value.options.platformComputeRuntime={listReadyDeviceRefs:()=>({resultKind:'available',items:[device]}),
    readDeviceSnapshot:()=>({resultKind:'found',snapshot:device})};
  const workModule=require('../../src/helix/domains/libra/planning/media-production-work');
  function work(kind,member,ordinal=1) {return (kind==='assessment'?workModule.transcodeStrategyAssessmentWork:
    workModule.transcodeMediaSelectionWork)(value.snapshot,ordinal,member);}
  function plan(kind,member,ordinal=1) {return createWorkspaceMediaProductionPlanner(value.options).plan({...work(kind,member,ordinal),
    workAttemptId:kind+'-'+ordinal+'-'+member.materialKey});}
  function record(member,ordinal=1,reasonCode=null) {
    const node=plan('assessment',member,ordinal).nodes[0],inputs=Object.fromEntries(node.inputBindings.bindings.map(item=>[item.portName,item.value]));
    const result=media.buildTranscodeInputVerification({sourceHandle:inputs.physicalMaterialReadHandleOrWorkspaceMaterialHandle,
      probeEvidence:inputs.mediaProbeEvidence,encodeIntent:inputs.encodeIntent,deviceSnapshot:inputs.mediaExecutionDeviceSnapshot,
      verifiedAtMs:1,preflight:{sampleCount:24,passedSampleCount:reasonCode?0:24,reasonCode,preflightDigest:D('preflight')}});
    const item={outcomeKind:'succeeded',capabilityRef:'libra.transcode.input.verify@1',inputBindings:node.inputBindings,result};
    stored.set(work('assessment',member,ordinal).workId,[item]);return item;
  }
  return {...value,plan,work,record,stored};
}
test('Member Transcode Assessment and Selection bind exact source, Intent, Device and output scope',()=>{
  const value=memberTranscodeFixture(),plans=[];
  for(const member of value.snapshot.members) {
    const record=value.record(member),plan=value.plan('selection',member);plans.push(plan);
    assert.equal(plan.nodes.length,4);
    const inputs=Object.fromEntries(plan.nodes[0].inputBindings.bindings.map(item=>[item.portName,item.value]));
    assert.equal(inputs.materialHandle.location,member.location);
    assert.equal(inputs.encodeIntent.intentDigest,record.result.encodeIntentDigest);
    assert.equal(inputs.mediaExecutionDeviceSnapshot.snapshotDigest,record.result.deviceSnapshotDigest);
    assert.equal(inputs.transcodeInputVerification.verificationId,record.result.verificationId);
    assert.equal(plan.nodes[2].inputBindings.bindings[0].parameters.materialKey,member.materialKey);
  }
  const target=plan=>plan.nodes[0].inputBindings.bindings.find(item=>item.portName==='workspaceMediaOutputTarget').value;
  assert.notEqual(target(plans[0]).targetId,target(plans[1]).targetId);
});
for(const mutation of ['foreign_member','probe','device','result','duplicate'])
test('Member Transcode Selection rejects '+mutation+' Assessment',()=>{
  const value=memberTranscodeFixture(),[a,b]=value.snapshot.members;
  const original=value.record(a),other=value.record(b),altered=structuredClone(original);
  if(mutation==='foreign_member')value.stored.set(value.work('assessment',a).workId,[other]);
  else {
    if(mutation==='probe')altered.inputBindings.bindings.find(item=>item.portName==='mediaProbeEvidence').value=other.inputBindings.bindings.find(item=>item.portName==='mediaProbeEvidence').value;
    if(mutation==='device')altered.inputBindings.bindings.find(item=>item.portName==='mediaExecutionDeviceSnapshot').value.snapshotDigest=D('foreign');
    if(mutation==='result')altered.result.sampleCount=0;
    value.stored.set(value.work('assessment',a).workId,mutation==='duplicate'?[altered,altered]:[altered]);
  }
  assert.throws(()=>value.plan('selection',a));
});
test('A rejected member strategy never consumes another member strategy history',()=>{
  const value=memberTranscodeFixture(),[a,b]=value.snapshot.members;
  value.record(a,1,'encoder_rejected_source_pipeline');
  const plan=value.plan('assessment',b);
  assert.equal(plan.resolution,'planned');
  assert.equal(plan.nodes[0].inputBindings.bindings.find(item=>item.portName==='encodeIntent').value.strategyOrdinal,1);
  assert.throws(()=>value.plan('selection',a),/incompatible Assessment/);
});

test('Bounded shared-file Transcode uses physical capacity while retaining the per-Episode quality floor',()=>{
  const value=memberTranscodeFixture(),media=require('../../src/helix/domains/libra/model/media-production-contracts'),GiB=1073741824;
  const first=value.snapshot.members[0];first.episodeClaims.push({...value.snapshot.members[1].episodeClaims[0]});
  value.snapshot.members=[first];first.sizeBytes=64*GiB;first.physicalIdentity.sizeBytes=64*GiB;
  value.snapshot.spec.requirements.space={unit:'episode',maxSizeBytes:14*GiB,maxSizeGiB:14};
  value.setRecords(records(value));const before=canonicalDigest(value.snapshot.spec);
  const plan=value.plan('assessment',first),intent=plan.nodes[0].inputBindings.bindings.find(item=>item.portName==='encodeIntent').value;
  const floor=media.videoBitrateFloorBps(14*GiB,'below_4k');
  assert.equal(intent.video.qualityFloorVideoBitrateBps,floor);
  const expected=media.selectCopyAudioStreamsForSizeBudget({maxSizeBytes:28*GiB,durationMs:1000,audioStreams:[],subtitleStreams:[],
    rasterClass:'below_4k',videoBitrateFloorBps:floor,sourceProbe:records(value)[0].result,acceptedPrimaryAudioClasses:[]});
  assert.equal(intent.video.targetVideoBitrateBps,expected.budget.targetVideoBitrateBps);
  assert.equal(canonicalDigest(value.snapshot.spec),before);
  value.record(first);
  assert.equal(value.plan('selection',first).resolution,'planned');
  const next=value.plan('assessment',first,2);
  assert.equal(next.resolution,'planned');
  const nextIntent=next.nodes[0].inputBindings.bindings.find(item=>item.portName==='encodeIntent').value;
  assert.equal(nextIntent.video.rateControlMode,'strict_abr');assert.equal(nextIntent.previousIntentDigest,intent.intentDigest);
});
test('A zero-byte Series member has no bounded Transcode budget',()=>{
  const value=memberTranscodeFixture(),member=value.snapshot.members[0];member.sizeBytes=member.physicalIdentity.sizeBytes=0;
  value.snapshot.spec.requirements.space={unit:'episode',maxSizeBytes:1073741824,maxSizeGiB:1};value.setRecords(records(value));
  const plan=value.plan('assessment',member);assert.equal(plan.resolution,'contract_unplannable');
  assert.equal(plan.diagnosticClassification,'media_size_budget_infeasible');assert.equal(plan.nodes.length,0);
});

test('Transcode retry rejects a measured output belonging to another source member',()=>{
  const value=memberTranscodeFixture(),member=value.snapshot.members[0];
  value.snapshot.spec.requirements.space={unit:'episode',maxSizeBytes:1073741824,maxSizeGiB:1};
  value.record(member);
  value.stored.set(value.work('selection',member).workId,[{outcomeKind:'succeeded',capabilityRef:'libra.product_media.verify@1',
    result:{libraRunId:'run',mediaRequirementDigest:require('../../src/helix/domains/libra/model/media-production-contracts')
      .buildMediaRequirement(value.snapshot.spec).requirementDigest,sourceProbeEvidenceDigest:D('other-member')}}]);
  assert.throws(()=>value.plan('assessment',member,2),/retry measurement differs/);
});

function finalSeriesFixture() {
  const value=directResultsFixture(),sourceRead=value.options.workResultReader.read,stored=new Map();
  value.options.workResultReader.read=id=>stored.has(id)?stored.get(id):sourceRead(id);
  value.options.workResultReader.listWorks=()=>[{work_id:value.workId,state:'succeeded'},
    ...[...stored.keys()].map(work_id=>({work_id,state:'succeeded'}))];
  const contracts=require('../../src/helix/domains/libra/model/media-production-contracts');
  const reader=require('../../src/helix/domains/libra/planning/series-production-candidates');
  const candidates=reader.readSeriesProductionCandidates(value.options,value.snapshot),basis=reader.candidateSetDigest(candidates),
    work=require('../../src/helix/domains/libra/planning/media-production-work').seriesFinalSelectionWork(value.snapshot,basis,candidates.map(item=>item.work));
  const plan=createWorkspaceMediaProductionPlanner(value.options).plan({...work,workAttemptId:'final-attempt'});
  const output=candidates.flatMap(candidate=>{
    const input=reader.finalCandidateInput(value.snapshot,candidates,candidate),verification=verifyDirectInput(input),
      selection=contracts.selectProductOutput({input:reader.selectionInput(value.snapshot,input,verification),producedAtMs:1});
    return [{outcomeKind:'succeeded',capabilityRef:'libra.product_media.verify@1',result:verification},
      {outcomeKind:'succeeded',capabilityRef:'libra.product_output.select@1',result:selection}];
  });
  stored.set(work.workId,output);
  return {...value,reader,candidates,basis,work,plan,output,stored};
}
test('Final Series Work binds the entire candidate set and independent verification dependencies',()=>{
  const value=finalSeriesFixture();assert.equal(value.plan.nodes.length,4);
  assert.equal(value.work.dependencyRefs.length,1);
  const projection=createWorkspaceMediaProductionProjections(value.options)
    .find(item=>item.projectionRef.endsWith('/SeriesFinalProductMediaCandidateInput/v1')).projection;
  for(let index=0;index<2;index++) {
    const [verify,select]=value.plan.nodes.slice(index*2,index*2+2),parameters=verify.inputBindings.bindings[0].parameters;
    const input=projection.project({ownerScope:{processId:'run'},parameters});
    assert.equal(input.seriesSpaceBasis.members.length,2);
    assert.equal(select.inputBindings.bindings[0].parameters.rankedCandidates[0].candidateId,input.candidateId);
    assert.deepEqual(select.dependsOn,[{eventId:verify.eventId,satisfaction:'success'}]);
    assert.throws(()=>projection.project({ownerScope:{processId:'run'},parameters:{...parameters,candidateSetDigest:D('foreign')}}));
  }
  const selected=value.reader.readSeriesMediaSelections(value.options,value.snapshot,value.work.workId);
  assert.equal(selected.length,2);assert.ok(selected.every(item=>item.selection.result==='selected'));
});
for(const mutation of ['missing','duplicate','allocation','selection','work'])
test('Final Series delivery rejects '+mutation+' complete-set evidence',()=>{
  const value=finalSeriesFixture();
  if(mutation==='missing')value.output.pop();
  if(mutation==='duplicate')value.output[2]=value.output[0];
  if(mutation==='allocation')value.output[0]={...value.output[0],result:{...value.output[0].result,spaceSummary:{}}};
  if(mutation==='selection')value.output[3]=value.output[1];
  assert.throws(()=>value.reader.readSeriesMediaSelections(value.options,value.snapshot,mutation==='work'?'foreign':value.work.workId));
});

function processedSeriesFixture(parts=false) {
  const value=directResultsFixture(2,value=>{
    value.snapshot.members[1].location='/source/second.mp4';
    value.snapshot.spec.requirements.mandatoryMedia.fileExtension='mkv';
    if(parts) {
      value.snapshot.members[1].episodeClaims=[...value.snapshot.members[0].episodeClaims];
      value.snapshot.spec.productScope.episodeKeys=['E001'];
      value.snapshot.spec.requirements.space={unit:'episode',maxSizeBytes:12,maxSizeGiB:12/1073741824};
      for(const member of value.snapshot.members){member.sizeBytes=12;member.physicalIdentity.sizeBytes=12;}
    }
  });
  const media=require('../../src/helix/domains/libra/model/media-production-contracts'),reader=require('../../src/helix/domains/libra/planning/series-production-candidates'),
    works=require('../../src/helix/domains/libra/planning/media-production-work'),original=value.options.workResultReader.read,stored=new Map();
  value.options.workResultReader.read=id=>stored.has(id)?stored.get(id):original(id);
  value.options.workResultReader.listWorks=()=>[{work_id:value.workId,state:'succeeded'},...[...stored.keys()].map(work_id=>({work_id,state:'succeeded'}))];
  const sources=readDirectMediaSelections(value.options,value.snapshot,value.workId);
  for(const source of parts?sources:[sources[1]]) {
    const member=source.member,plan=memberRemuxPlan(value,member),parameters=plan.nodes[2].inputBindings.bindings[0].parameters;
    const handle={handleId:D('output-'+member.materialKey),processId:'run',workspaceId:D('workspace'),relativePath:'media/'+member.materialKey+'.mkv',
      sizeBytes:parts?6:12,fenceDigest:D('output-fence'),materialKey:D('product-'+member.materialKey)};
    const produced={sourceMaterialHandleDigest:canonicalDigest(source.readHandle),workspaceMaterialHandle:handle,
      workspaceMaterialHandleDigest:canonicalDigest(handle),workspaceMediaHandleId:D('media-'+member.materialKey),outputTargetId:D('target-'+member.materialKey),
      outputTargetDigest:D('target-digest-'+member.materialKey),productionIntentDigest:D('intent'),producingEventId:'remux-'+member.materialKey};
    produced.resultDigest=canonicalDigest(produced);
    const probeResult=probe(handle),projection=createWorkspaceMediaProductionProjections(value.options)
      .find(item=>item.projectionRef.endsWith('/WorkspaceProductMediaCandidateInput/v1')).projection,
      input=projection.project({sourceResults:[{result:produced},{result:probeResult}],parameters}),verification=verifyDirectInput(input),
      selection=media.selectProductOutput({input:reader.selectionInput(value.snapshot,input,verification),producedAtMs:1});
    stored.set(works.remuxMediaSelectionWork(value.snapshot,member).workId,[
      {outcomeKind:'succeeded',capabilityRef:'libra.media.remux@1',result:produced},
      {outcomeKind:'succeeded',capabilityRef:'shared.material.media.probe@1',result:probeResult},
      {outcomeKind:'succeeded',capabilityRef:'libra.product_media.verify@1',result:verification},
      {outcomeKind:'succeeded',capabilityRef:'libra.product_output.select@1',result:selection}]);
  }
  return {...value,reader,stored};
}
test('Mixed Direct and Workspace final basis preserves original source and actual product identities',()=>{
  const value=processedSeriesFixture(),candidates=value.reader.readSeriesProductionCandidates(value.options,value.snapshot);
  assert.equal(candidates.filter(item=>item.media).length,1);assert.ok(candidates.every(item=>item.eligible));
  for(const candidate of candidates) {
    const input=value.reader.finalCandidateInput(value.snapshot,candidates,candidate);
    assert.equal(verifyDirectInput(input).result,'passed');
    assert.equal(input.seriesSpaceBasis.members.length,2);
    assert.equal(input.sourceProbeEvidence.sourceHandleDigest,canonicalDigest(candidate.readHandle));
    if(candidate.media)assert.notEqual(canonicalDigest(candidate.readHandle),canonicalDigest(candidate.media.workspaceMaterialHandle));
  }
});
test('Multipart candidates await full actual allocation without forging individual passed Selection',()=>{
  const value=processedSeriesFixture(true),candidates=value.reader.readSeriesProductionCandidates(value.options,value.snapshot);
  assert.ok(candidates.every(item=>item.eligible&&item.selection.result==='not_selected'));
  for(const candidate of candidates) {
    const input=value.reader.finalCandidateInput(value.snapshot,candidates,candidate),verification=verifyDirectInput(input);
    assert.equal(verification.result,'passed');
    assert.deepEqual(verification.spaceSummary.episodeAllocation.allocations[0].allocatedBytes,{numerator:'12',denominator:'1'});
  }
});
for(const mutation of ['source','media_digest','probe','verification','selection','missing'])
test('Processed Series candidate rejects '+mutation+' before complete-set delivery',()=>{
  const value=processedSeriesFixture(),records=[...value.stored.values()][0];
  if(mutation==='source')records[0].result={...records[0].result,sourceMaterialHandleDigest:D('foreign')};
  if(mutation==='media_digest')records[0].result={...records[0].result,resultDigest:D('foreign')};
  if(mutation==='probe')records[1].result=probe({handleId:'foreign'});
  if(mutation==='verification')records[2].result={...records[2].result,reasonCodes:[]};
  if(mutation==='selection')records[3].result={...records[3].result,selectedHandleId:'foreign'};
  if(mutation==='missing')records.pop();
  if(mutation==='verification')records[2].result={...records[2].result,verifiedAtMs:2,basisDigest:D('foreign')};
  assert.throws(()=>value.reader.readSeriesProductionCandidates(value.options,value.snapshot));
});

test('Mixed delivery chooses only the complete final Work, never one selected member Work',()=>{
  const value=processedSeriesFixture(),{reader}=value,media=require('../../src/helix/domains/libra/model/media-production-contracts'),
    {findSelectedMediaWork}=require('../../src/helix/domains/libra/planning/product-delivery-work'),
    candidates=reader.readSeriesProductionCandidates(value.options,value.snapshot),
    work=require('../../src/helix/domains/libra/planning/media-production-work').seriesFinalSelectionWork(value.snapshot,
      reader.candidateSetDigest(candidates),candidates.map(item=>item.work));
  assert.throws(()=>findSelectedMediaWork(value.options,value.snapshot),/complete terminal/);
  const output=candidates.flatMap(candidate=>{
    const input=reader.finalCandidateInput(value.snapshot,candidates,candidate),verification=verifyDirectInput(input),
      selection=media.selectProductOutput({input:reader.selectionInput(value.snapshot,input,verification),producedAtMs:1});
    return [{outcomeKind:'succeeded',capabilityRef:'libra.product_media.verify@1',result:verification},
      {outcomeKind:'succeeded',capabilityRef:'libra.product_output.select@1',result:selection}];
  });
  value.stored.set(work.workId,output);
  assert.equal(findSelectedMediaWork(value.options,value.snapshot).workId,work.workId);
  const selected=reader.readSeriesMediaSelections(value.options,value.snapshot,work.workId);
  assert.equal(selected.find(item=>item.media).results.length,4);
  output.pop();assert.throws(()=>findSelectedMediaWork(value.options,value.snapshot),/complete Primary set/);
});
