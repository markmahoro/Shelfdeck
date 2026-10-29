'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,contractValidator,D}=require('./fixtures/us-adult-catalogue-basis');
const {buildCatalogueAnalysisBasis,assertCatalogueAnalysisBasis,catalogueSamplingPlan}=require('../../src/helix/domains/libra/model/us-adult-catalogue-analysis-basis');
const {createGeneration,assertGeneration}=require('../../src/helix/contracts/face-catalogue-generation');
const {buffaloModelReference,assertBuffaloModelReference,featureSpaceDigest}=require('../../src/helix/contracts/buffalo-model-reference');
const {faceModelReference}=require('../../src/helix/contracts/us-adult-face-model');
test('buffalo references share a 512-dimensional feature space and reject the old model',()=>{
  const a=buffaloModelReference('single_reference_face'),b=buffaloModelReference('western_frame_set');
  assert.notEqual(a.digest,b.digest);assert.equal(a.modelDigest,b.modelDigest);assert.equal(a.outputContractDigest,b.outputContractDigest);
  assert.equal(Object.isFrozen(a.typedParameters[0]),true);
  assert.throws(()=>assertBuffaloModelReference(faceModelReference('western_frame_set'),'western_frame_set'),{code:'BUFFALO_MODEL_REFERENCE_INVALID'});
});
test('catalogue generations are complete, ordered, content-bound and independent of a location',()=>{
  const ref=fixture().catalogueGeneration,{datasetVersion,manifestDigest,members}=ref;
  assert.equal(ref.featureSpaceDigest,featureSpaceDigest);
  assert.deepEqual(createGeneration({datasetVersion,manifestDigest,members:[...members].reverse()}),ref);
  assert.equal(Object.isFrozen(ref.members[0]),true);
  for(const mutate of [x=>x.members.pop(),x=>x.members.push(x.members[0]),x=>x.members[0].name='../aliases.json',
    x=>x.dimension=128,x=>x.root='/elsewhere',x=>x.members[0].sha256=D('changed'),x=>x.members[0].bytes=0,
    x=>x.members[0].bytes=4294967297,x=>x.featureSpaceDigest=D('old')]){
    const copy=structuredClone(ref);mutate(copy);assert.throws(()=>assertGeneration(copy),{code:'FACE_CATALOGUE_GENERATION_INVALID'});
  }
});
test('catalogue Basis freezes the exact source, successful Probe, policies and resource generation without People snapshots',()=>{
  const args=fixture(),value=buildCatalogueAnalysisBasis(args);
  assert.equal(value.sourceProbeRef.resultId,'probe-result');assert.equal(value.catalogueGeneration.generationDigest,args.catalogueGeneration.generationDigest);
  assert.equal(Object.hasOwn(value,'referencePages'),false);assert.equal(Object.hasOwn(value,'peopleLibraryDigest'),false);
  assert.equal(Object.isFrozen(value.sourceHandle.identity),true);assert.equal(Object.isFrozen(args.sourceHandle.identity),false);
  args.sourceHandle.identity.inode='999';assert.equal(value.sourceHandle.identity.inode,'42');
  assert.equal(assertCatalogueAnalysisBasis(value,{validator:contractValidator}),value);
});
test('a known positive duration generates unique bounded initial and supplemental points, including very short clips',()=>{
  for(const duration of [1,2,15,1000,3600000,864000000]){
    const plan=catalogueSamplingPlan(duration),parameters=Object.fromEntries(plan.typedParameters.map(x=>[x.parameter,x.value])),
      first=JSON.parse(parameters.initial_points_ms),next=JSON.parse(parameters.supplement_points_ms),all=[...first,...next];
    assert.ok(first.length<=20&&next.length<=20);assert.equal(all.length,plan.maxFrames);assert.equal(new Set(all).size,all.length);
    assert.ok(all.every(x=>x>=0&&x<duration));
  }
  assert.equal(catalogueSamplingPlan(1).maxFrames,1);
  for(const value of [0,-1,NaN,1.5])assert.throws(()=>catalogueSamplingPlan(value),{code:'US_ADULT_CATALOGUE_BASIS_INVALID'});
});
test('failed, incomplete, changed or other-source Probe records cannot establish a video Basis',()=>{
  for(const mutate of [a=>a.sourceProbeRecord.outcomeKind='failed',a=>a.sourceProbeRecord.capabilityRef='other@1',
    a=>a.sourceProbeRecord.inputBindingDigest=D('other'),a=>a.sourceProbeRecord.resultDigest=D('other'),
    a=>a.sourceProbeRecord.result.sourceHandleDigest=D('other'),a=>a.sourceProbeRecord.result.durationMs=0,
    a=>delete a.sourceProbeRecord.resultSchemaRef,a=>a.sourceHandle.ownerScope.scopeId='other-run',
    a=>a.snapshot.members[0].materialKey=D('other'),a=>a.snapshot.members.push({...a.snapshot.members[0]}),
    a=>a.contractValidator=null]){
    const args=fixture();mutate(args);assert.throws(()=>buildCatalogueAnalysisBasis(args));
  }
  const incomplete=fixture();delete incomplete.sourceProbeRecord.result.videoStreams;
  incomplete.sourceProbeRecord.resultDigest=D(incomplete.sourceProbeRecord.result);
  assert.throws(()=>buildCatalogueAnalysisBasis(incomplete),{code:'P4_CAPABILITY_SCHEMA_REJECTED'});
  const corrupt=fixture();corrupt.sourceProbeRecord.result.payloadDigest=D('wrong');corrupt.sourceProbeRecord.resultDigest=D(corrupt.sourceProbeRecord.result);
  assert.throws(()=>buildCatalogueAnalysisBasis(corrupt),{code:'P9_MEDIA_PROBE_INTEGRITY'});
});
test('the frozen Basis rejects stale ownership, modified policy, resources, sampling and unknown branches',()=>{
  const value=buildCatalogueAnalysisBasis(fixture());
  for(const mutate of [x=>x.sourceHandle.ownerScope.scopeId='other',x=>x.expectedRunStateRevision++,x=>x.durationMs++,
    x=>x.resourceBudget.cpuSlots=2,x=>x.resourceBudget.memoryBytes=1,x=>x.resourceBudget.analysisDeadlineMs=1,
    x=>x.selectionPolicy.maximumDistance=0.9,x=>x.selectionPolicy.gender='female',
    x=>x.catalogueGeneration.manifestDigest=D('other'),x=>x.catalogueSearchPolicy.queryCount=1,x=>x.samplingPlan.maxFrames=41,
    x=>x.clusterParameters.distanceThreshold=0.2,x=>x.faceModelRef=faceModelReference('western_frame_set'),
    x=>x.genderPolicy='ignore',x=>x.sourceProbeRef.resultId='other']){
    const copy=structuredClone(value);mutate(copy);assert.throws(()=>assertCatalogueAnalysisBasis(copy));
  }
});
