'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {setup}=require('./fixtures/buffalo-frame-engine');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const {createUsAdultCatalogueStore}=require('../../src/helix/domains/libra/persistence/us-adult-catalogue-store');
const {catalogueFrameWork}=require('../../src/helix/domains/libra/model/us-adult-catalogue-frame-work');
const {FRAME,EMBED,CLUSTER,resultRef}=require('../../src/helix/domains/libra/model/us-adult-analysis-work');
const {frameTarget}=require('../../src/helix/domains/libra/planning/us-adult-analysis-planner');
const {createUsAdultCatalogueFrameCapabilityPorts}=require('../../src/helix/domains/libra/capabilities/us-adult-catalogue-frame-capability-ports');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
const root=path.resolve(__dirname,'../../src/helix/contracts'),schemas=[];
function collect(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
  const file=path.join(directory,entry.name);if(entry.isDirectory())collect(file);else if(entry.name==='schema.json')schemas.push(JSON.parse(fs.readFileSync(file)));
}}
collect(path.join(root,'types'));collect(path.join(root,'domain-types'));
for(const ref of [FRAME,EMBED,CLUSTER])schemas.push(require('../../src/helix/contracts/capabilities/'+ref.replaceAll('.','/').replace('@1','/v1/result.schema.json')));
const validator=createCapabilityContractValidator({schemas});
function runtime(t){
  const f=setup(t),records=[],store=createUsAdultCatalogueStore(f.options);store.freeze(f.basis);
  const options={usAdultCatalogueStore:store,workResultReader:{read:()=>records},contractValidator:validator,
    movieProductionReader:{readRunSnapshot:()=>f.args.snapshot,readWorkspace:()=>({workspaceId:'workspace',libraRunId:'run',state:'active',
      currentRevision:1,stateDigest:D('state'),workspaceScopeDigest:D('workspace')})},workspaceProductPort:f.workspace,
    createCatalogueFramePort:()=>f.port,now:()=>1000},work=catalogueFrameWork(f.args.snapshot,f.basis,'initial'),
    target=frameTarget(options,f.basis,{samplingPlan:f.batch.samplingPlan,
      targetRelativePath:'analysis/catalogue/'+f.basis.analysisId+'/'+f.batch.stage+'-'+f.batch.batchDigest+'.json'}),
    context=(ref,namedInputs)=>({ownerScope:{domain:'libra',processType:'libra_run',processId:'run',objectRefs:[]},workId:work.workId,
      workAttemptId:'attempt',planId:'plan',eventId:'event-'+ref,idempotencyKey:'key-'+ref,capabilityRef:ref,namedInputs,
      basisRefs:[{basisType:'execution_basis',basisId:work.workId,revision:1,digest:f.basis.runExecutionBasisDigest}],assertExecutionActive(){}}),
    remember=(ref,outcome)=>records.push({workId:work.workId,outcomeKind:'succeeded',capabilityRef:ref,resultSchemaRef:resultRef(ref),
      result:outcome.result,resultDigest:D(outcome.result)});
  return {...f,options,records,work,target,context,remember,ports:createUsAdultCatalogueFrameCapabilityPorts(options)};
}
test('real runtime-shaped contexts carry frozen batches through three nominal Capability Results and three Workspace Artifacts',async t=>{
  const f=runtime(t),first=f.context(FRAME,{physicalMaterialReadHandleOrWorkspaceMaterialHandle:f.basis.sourceHandle,
    samplingPlan:f.batch.samplingPlan,workspaceArtifactOutputTarget:f.target}),frames=await f.ports[FRAME].execute(first);f.remember(FRAME,frames);
  const embeddings=await f.ports[EMBED].execute(f.context(EMBED,{artifactHandleList:[frames.result.frameSetArtifactHandle],faceModelRef:f.basis.faceModelRef}));
  f.remember(EMBED,embeddings);
  const clusters=await f.ports[CLUSTER].execute(f.context(CLUSTER,{faceEmbeddingSetHandle:embeddings.result,clusterParameters:f.basis.clusterParameters}));
  assert.equal(clusters.result.clusterCount,1);assert.equal(f.db.prepare('SELECT count(*) n FROM fx_artifact_registry').get().n,3);
  for(const result of [frames,embeddings,clusters]){
    validator.validate(result.resultSchemaRef,result.result);assert.equal(result.evidence.basisDigest,f.basis.basisDigest);
    assert.equal(result.effectReceipt.outputDigest,D(result.result));assert.equal(result.effectReceipt.effectClass,'workspace_write');
  }
});
test('another basis, Work or batch cannot borrow the source Handle or frozen frame target',t=>{
  const f=runtime(t),input={physicalMaterialReadHandleOrWorkspaceMaterialHandle:f.basis.sourceHandle,samplingPlan:f.batch.samplingPlan,
    workspaceArtifactOutputTarget:f.target},context=f.context(FRAME,input);
  f.ports[FRAME].validateInputs(context);
  assert.throws(()=>f.ports[FRAME].validateInputs({...context,workId:'foreign'}),{code:'US_ADULT_CATALOGUE_FRAME_INPUT_INVALID'});
  assert.throws(()=>f.ports[FRAME].validateInputs({...context,basisRefs:[{...context.basisRefs[0],digest:D('wrong')}]}),{code:'US_ADULT_CATALOGUE_FRAME_INPUT_INVALID'});
  assert.throws(()=>f.ports[FRAME].validateInputs({...context,namedInputs:{...input,samplingPlan:f.basis.samplingPlan}}),{code:'US_ADULT_CATALOGUE_FRAME_INPUT_INVALID'});
  assert.equal(f.counters.frames,0);
});
test('a Run cancelled after Artifact production cannot publish a late successful Capability Outcome',async t=>{
  const f=runtime(t),ports=createUsAdultCatalogueFrameCapabilityPorts({...f.options,createCatalogueFramePort:()=>({
    async extractFrames(request){const value=await f.port.extractFrames(request);f.db.exec("UPDATE libra_runs SET state='discarded',state_revision=3");return value;}})});
  await assert.rejects(()=>ports[FRAME].execute(f.context(FRAME,{physicalMaterialReadHandleOrWorkspaceMaterialHandle:f.basis.sourceHandle,
    samplingPlan:f.batch.samplingPlan,workspaceArtifactOutputTarget:f.target})),{code:'US_ADULT_CATALOGUE_BASIS_STALE'});
  assert.equal(f.records.length,0);assert.equal(f.db.prepare('SELECT count(*) n FROM fx_artifact_registry').get().n,1);
});
