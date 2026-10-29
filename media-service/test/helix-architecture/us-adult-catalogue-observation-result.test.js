'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup}=require('./fixtures/buffalo-frame-engine');
const {createValidator}=require('./fixtures/catalogue-nominal-schemas');
const {canonicalDigest:D,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {catalogueFrameWork}=require('../../src/helix/domains/libra/model/us-adult-catalogue-frame-work');
const {buildCompletedCatalogueBatches}=require('../../src/helix/domains/libra/model/us-adult-catalogue-completed-batches');
const {FRAME,EMBED,CLUSTER,resultRef}=require('../../src/helix/domains/libra/model/us-adult-analysis-work');
const {createBuffaloCatalogueObserver}=require('../../src/helix/integrations/buffalo-catalogue-observer');
const {clusterFaces}=require('../../src/helix/integrations/buffalo-video-evidence');
const {catalogueObservationTarget,buildCatalogueObservationHandle,readCatalogueObservationResult}=require('../../src/helix/domains/libra/model/us-adult-catalogue-observation-result');
const validator=createValidator({includeProposed:true});
async function source(t){
  const f=setup(t),frames=await f.port.extractFrames({sourceHandle:f.basis.sourceHandle,samplingPlan:f.batch.samplingPlan,outputTarget:f.target}),
    embeddings=await f.port.computeEmbeddings({frameArtifactSet:frames,faceModelRef:f.basis.faceModelRef}),
    clusters=await f.port.computeClusters({faceEmbeddingSetHandle:embeddings,clusterParameters:f.basis.clusterParameters}),
    work=catalogueFrameWork(f.args.snapshot,f.basis,'initial'),inputBindings={schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings:[]},
    record=(ref,result)=>({workId:work.workId,attemptId:'attempt',planId:'plan',eventId:'event-'+ref,resultId:'result-'+ref,capabilityRef:ref,
      resultSchemaRef:resultRef(ref),outcomeKind:'succeeded',result,resultDigest:D(result),inputBindings,inputBindingDigest:D(inputBindings)}),
    completedBatches=buildCompletedCatalogueBatches({basis:f.basis,snapshot:f.args.snapshot,mode:'initial',validator,
      records:[{frame:record(FRAME,frames),embedding:record(EMBED,embeddings),cluster:record(CLUSTER,clusters)}]}),
    observer=createBuffaloCatalogueObserver({context:{assertExecutionActive(){}},deadlineAtMs:100000,operationDeadlineMs:60000,now:()=>1000,
      cpuSession:{faceModelRef:f.basis.faceModelRef,groupFaces:async(faces,parameters)=>clusterFaces(faces,parameters),async stop(){},
        async loadCatalogue(){return {generationDigest:f.basis.catalogueGeneration.generationDigest,policyDigest:f.basis.catalogueSearchPolicy.policyDigest,
          dimension:512,size:100,verificationDigest:D('verified')};},async searchCatalogue(){return {generationDigest:f.basis.catalogueGeneration.generationDigest,
          searchPolicyDigest:f.basis.catalogueSearchPolicy.policyDigest,raw:[{key:1,distance:0.1}],matches:[{key:1,uid:'catalogue:1',identityKey:'catalogue:1',
            name:'Example Performer',aliases:[],distance:0.1,combinedDistance:0.1}],retiredSlots:[]};}}}),
    observation=await observer.observe({basisDigest:f.basis.basisDigest,mode:'initial',catalogueGeneration:f.basis.catalogueGeneration,
      searchPolicy:f.basis.catalogueSearchPolicy,clusterParameters:f.basis.clusterParameters,batches:[{stage:'initial',batchDigest:f.batch.batchDigest,
        frameArtifactSetDigest:frames.manifestDigest,embeddingDigest:embeddings.embeddingDigest,embeddingSet:JSON.parse(f.workspace.readArtifactBytes(embeddings.artifactHandle).bytes)}]}),
    target=catalogueObservationTarget({basis:f.basis,completedBatches,workspace:{libraRunId:'run',workspaceId:'workspace',state:'active',currentRevision:1,
      stateDigest:D('workspace'),workspaceScopeDigest:D('scope')},rootSnapshot:f.workspace.rootSnapshot()}),bytes=Buffer.from(canonicalJson(observation)),
    artifact={...frames.frameSetArtifactHandle,artifactHandleId:'proposed-observation',artifactKind:'face_catalogue_observation',
      storageRef:'workspace://workspace/'+target.targetRelativePath,digestHex:D(observation),sizeBytes:bytes.length,
      provenanceRef:{objectType:'us_adult_catalogue_observation',objectId:completedBatches.setDigest,revision:1,digest:target.targetDigest}},
    request={basis:f.basis,snapshot:f.args.snapshot,completedBatches,validator},
    handle=buildCatalogueObservationHandle({...request,observation,artifactHandle:artifact,outputTarget:target});
  return {...f,...request,observation,bytes,target,artifact,handle};
}
test('proposed catalogue Result remains a small Handle and reconstructs the exact complete Owner assessment',async t=>{
  const f=await source(t),value=readCatalogueObservationResult(f);
  assert.equal(value.assessment.status,'qualified_candidate');assert.equal(value.assessment.winner.name,'Example Performer');
  assert.equal(Object.hasOwn(value.assessment.winner,'personId'),false);assert.equal(Object.hasOwn(f.handle,'queries'),false);
  assert.ok(Buffer.byteLength(canonicalJson(f.handle))<16384);assert.deepEqual(value.observation,f.observation);
  assert.deepEqual(readCatalogueObservationResult(f),value);
  // These are pure codecs. The proposed publisher/kind has not been enabled
  // in the current Workspace Port, and these helpers publish no fourth file.
  assert.equal(f.db.prepare('SELECT count(*) n FROM fx_artifact_registry').get().n,3);
});
test('rewritten bytes, summary counts or generation cannot be accepted after rehashing only the outer Handle',async t=>{
  const f=await source(t);
  assert.throws(()=>readCatalogueObservationResult({...f,bytes:Buffer.from(JSON.stringify(f.observation,null,2))}),{code:'US_ADULT_CATALOGUE_OBSERVATION_RESULT_INVALID'});
  for(const mutate of [x=>x.queryCount++,x=>x.catalogueGenerationDigest=D('other'),x=>x.completedBatchSetDigest=D('other'),
    x=>x.observationArtifactHandle.storageRef='workspace://other/observation.json',x=>x.observationArtifactHandle.provenanceRef.objectId=D('other'),
    x=>x.outputTargetDigest=D('other')]){
    const handle=JSON.parse(canonicalJson(f.handle));mutate(handle);const {handleDigest,...body}=handle;handle.handleDigest=D(body);
    assert.throws(()=>readCatalogueObservationResult({...f,handle}),{code:'US_ADULT_CATALOGUE_OBSERVATION_RESULT_INVALID'});
  }
});
test('a producer cannot bind the Observation to another output target or altered canonical bytes',async t=>{
  const f=await source(t);
  assert.throws(()=>buildCatalogueObservationHandle({...f,artifactHandle:{...f.artifact,sizeBytes:f.artifact.sizeBytes+1},outputTarget:f.target}),
    {code:'US_ADULT_CATALOGUE_OBSERVATION_RESULT_INVALID'});
  const target={...f.target,sourceInputDigest:D('other')},body=Object.fromEntries(Object.entries(target).filter(([key])=>key!=='targetDigest'));
  target.targetDigest=D(body);
  assert.throws(()=>buildCatalogueObservationHandle({...f,artifactHandle:{...f.artifact,provenanceRef:{...f.artifact.provenanceRef,digest:target.targetDigest}},outputTarget:target}),
    {code:'US_ADULT_CATALOGUE_OBSERVATION_RESULT_INVALID'});
  const changed={...f.target,targetRelativePath:'analysis/arbitrary.json'};
  const {targetDigest,...changedBody}=changed;changed.targetDigest=D(changedBody);
  assert.throws(()=>buildCatalogueObservationHandle({...f,artifactHandle:{...f.artifact,storageRef:'workspace://workspace/analysis/arbitrary.json',
    provenanceRef:{...f.artifact.provenanceRef,digest:changed.targetDigest}},outputTarget:changed}),{code:'US_ADULT_CATALOGUE_OBSERVATION_RESULT_INVALID'});
});
