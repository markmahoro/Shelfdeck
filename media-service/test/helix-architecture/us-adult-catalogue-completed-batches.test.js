'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup}=require('./fixtures/buffalo-frame-engine');
const {createValidator}=require('./fixtures/catalogue-nominal-schemas');
const {canonicalDigest:D,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {catalogueFrameWork}=require('../../src/helix/domains/libra/model/us-adult-catalogue-frame-work');
const {FRAME,EMBED,CLUSTER,resultRef}=require('../../src/helix/domains/libra/model/us-adult-analysis-work');
const {buildCompletedCatalogueBatches,assertCompletedCatalogueBatches}=require('../../src/helix/domains/libra/model/us-adult-catalogue-completed-batches');
const types=require('../../src/helix/contracts/us-adult-catalogue-work-types'),validator=createValidator({includeProposed:true});
async function results(f){
  const frame=await f.port.extractFrames({sourceHandle:f.basis.sourceHandle,samplingPlan:f.batch.samplingPlan,outputTarget:f.target}),
    embedding=await f.port.computeEmbeddings({frameArtifactSet:frame,faceModelRef:f.basis.faceModelRef}),
    cluster=await f.port.computeClusters({faceEmbeddingSetHandle:embedding,clusterParameters:f.basis.clusterParameters}),
    work=catalogueFrameWork(f.args.snapshot,f.basis,'initial'),inputBindings={schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,
      bindings:[{portName:'samplingPlan',bindingKind:'projected_owner_facts',ownerDomain:'libra',processType:'libra_run',processId:f.basis.libraRunId,
        projectionRef:'helix://libra/input-projections/UsAdultCatalogueFrameSampling/v1',parameters:{analysisId:f.basis.analysisId,basisDigest:f.basis.basisDigest,
          stage:'initial',batchDigest:f.batch.batchDigest}}]};
  const record=(ref,result)=>({workId:work.workId,attemptId:'attempt',planId:'plan',eventId:'event-'+ref,resultId:'result-'+ref,capabilityRef:ref,
    resultSchemaRef:resultRef(ref),outcomeKind:'succeeded',inputBindings,inputBindingDigest:D(inputBindings),result,resultDigest:D(result)});
  return {frame:record(FRAME,frame),embedding:record(EMBED,embedding),cluster:record(CLUSTER,cluster)};
}
test('proposed completed-batch DTO preserves exact producer Records, model and same-Run chain in a bounded immutable value',async t=>{
  const f=setup(t),source=await results(f),value=buildCompletedCatalogueBatches({basis:f.basis,snapshot:f.args.snapshot,mode:'initial',records:[source],validator});
  assert.equal(value.batches.length,1);assert.equal(value.batches[0].sourceResultRefs.length,3);assert.equal(value.batches[0].frameArtifactSet.frameCount,20);
  assert.equal(Buffer.byteLength(canonicalJson(value))<65536,true);assert.equal(Object.isFrozen(value.batches[0].faceEmbeddingSetHandle.artifactHandle),true);
  assert.equal(assertCompletedCatalogueBatches(value,{basis:f.basis,snapshot:f.args.snapshot,validator}),value);
  assert.deepEqual(buildCompletedCatalogueBatches({basis:f.basis,snapshot:f.args.snapshot,mode:'initial',records:[source],validator}),value);
});
test('a digest, input binding or successful Result cannot be substituted during completion compilation',async t=>{
  const f=setup(t),source=await results(f);
  for(const mutate of [x=>x.frame.resultDigest=D('other'),x=>x.embedding.inputBindingDigest=D('other'),
    x=>x.cluster.workId='another-work',x=>x.frame.outcomeKind='failed']){
    const changed=JSON.parse(canonicalJson(source));mutate(changed);
    assert.throws(()=>buildCompletedCatalogueBatches({basis:f.basis,snapshot:f.args.snapshot,mode:'initial',records:[changed],validator}),
      {code:'US_ADULT_CATALOGUE_COMPLETION_INVALID'});
  }
});
test('rehashed DTOs still reject another Run, altered source chain and a missing producer capability',async t=>{
  const f=setup(t),source=await results(f),value=buildCompletedCatalogueBatches({basis:f.basis,snapshot:f.args.snapshot,mode:'initial',records:[source],validator});
  for(const mutate of [x=>x.libraRunId='another-run',x=>x.batches[0].faceEmbeddingSetHandle.sourceArtifactSetDigest=D('other'),
    x=>x.batches[0].sourceResultRefs.pop(),x=>x.batches[0].sourceResultRefs[1].planId='another-plan',
    x=>x.batches[0].sourceResultRefs[1].eventId=x.batches[0].sourceResultRefs[0].eventId]){
    const changed=JSON.parse(canonicalJson(value));mutate(changed);const {setDigest,...body}=changed;changed.setDigest=D(body);
    assert.throws(()=>assertCompletedCatalogueBatches(changed,{basis:f.basis,snapshot:f.args.snapshot,validator}));
  }
});
test('the Observation Handle schema is a proposed bounded result rather than inline raw catalogue data',()=>{
  const artifact={schemaRef:'helix://contracts/types/ArtifactHandle/v1',schemaVersion:1,artifactHandleId:'catalogue-observation',
    artifactKind:'face_catalogue_observation',ownerDomain:'libra',ownerScope:{scopeType:'libra_run',scopeId:'run'},storageRef:'workspace://workspace/observation.json',
    digestAlgorithm:'sha256',digestHex:D('artifact'),sizeBytes:100,mediaType:'application/json',
    provenanceRef:{objectType:'catalogue_observation',objectId:'observation',revision:1,digest:D('producer')},referenceRevision:1},
    body={schemaRef:types.HANDLE,schemaVersion:1,analysisId:D('analysis'),libraRunId:'run',workspaceId:'workspace',runExecutionBasisDigest:D('run'),basisDigest:D('basis'),
      mode:'initial',completedBatchSetDigest:D('completed'),observationSourceSetDigest:D('sources'),modelRefDigest:D('model'),catalogueGenerationDigest:D('generation'),
      searchPolicyDigest:D('search-policy'),clusterParameterDigest:D('cluster-policy'),resultKind:'no_faces',frameCount:20,faceCount:0,groupCount:0,queryCount:0,
      observationDigest:D('observation'),observationArtifactHandle:artifact,outputTargetDigest:D('target')},value={...body,handleDigest:D(body)};
  assert.equal(types.assertObservationHandle(value,{validator}),value);assert.ok(Buffer.byteLength(canonicalJson(value))<16384);
  const foreign=JSON.parse(canonicalJson(value));foreign.observationArtifactHandle.ownerScope.scopeId='another-run';
  const {handleDigest,...changed}=foreign;foreign.handleDigest=D(changed);
  assert.throws(()=>types.assertObservationHandle(foreign,{validator}),{code:'US_ADULT_CATALOGUE_HANDLE_INVALID'});
  assert.throws(()=>validator.validate(types.HANDLE,{...value,queries:[]}),{code:'P4_CAPABILITY_SCHEMA_REJECTED'});
});
