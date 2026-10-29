'use strict';
// Run explicitly in the reviewed catalogue-contract proposal until the main
// integration branch materializes its shared types and Artifact kind.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {coordination}=require('../fixtures/us-adult-catalogue-coordination');
const {createValidator}=require('../fixtures/catalogue-nominal-schemas');
const {canonicalDigest:D}=require('../../../src/helix/contracts/canonical-json');
const {CAPABILITY,resultRef}=require('../../../src/helix/contracts/us-adult-catalogue-work-types');
const {catalogueObservationTarget}=require('../../../src/helix/domains/libra/model/us-adult-catalogue-observation-result');
const {createCleanBuffaloCataloguePort}=require('../../../src/clean-buffalo-catalogue-port');
const {createCleanWorkspaceProductPort}=require('../../../src/clean-workspace-product-port');
const {createUsAdultCatalogueObservationCapability,createUsAdultCatalogueObservationRegistration}=require('../../../src/helix/domains/libra/capabilities/us-adult-catalogue-observation-capability');
const {createUsAdultCatalogueObservationPlanner,createUsAdultCatalogueObservationProjections,PROJECTIONS}=require('../../../src/helix/domains/libra/planning/us-adult-catalogue-observation-planner');
const {createCapabilityRegistry}=require('../../../src/helix/foundation/capability/capability-registry');
const {validateWorkflowPlan}=require('../../../src/helix/foundation/execution/workflow-plan');
const manifest=require('../../../src/helix/contracts/capabilities/libra/us_adult/catalogue/observe/v1/manifest.json');
async function fixture(t){
  const f=coordination(t);f.reconcile();await f.completeFrames('initial');const observed=await f.completeObservation('initial'),
    validator=createValidator({includeProposed:true,capabilitySchemaRefs:[CAPABILITY]}),counters={computes:0},
    target=catalogueObservationTarget({basis:f.basis,completedBatches:observed.completedBatches,workspace:f.workspaceState,rootSnapshot:f.workspace.rootSnapshot()});
  const options={...f.options,contractValidator:validator,workspaceProductPort:f.workspace,now:()=>1000,
    createCatalogueObservationPort({context,validateObservation}){
      return createCleanBuffaloCataloguePort({context,validateObservation,workspaceProductPort:f.workspace,async computeObservation(){
        counters.computes++;return observed.observation;}});
    }},context={ownerScope:{domain:'libra',processType:'libra_run',processId:'run'},workId:observed.work.workId,
      workAttemptId:'observe-attempt',planId:'observe-plan',eventId:'observe-event',idempotencyKey:'observe-key',capabilityRef:CAPABILITY,
      basisRefs:[{basisType:'execution_basis',basisId:observed.work.workId,revision:1,digest:f.basis.runExecutionBasisDigest}],
      assertExecutionActive(){},namedInputs:{usAdultCatalogueAnalysisBasis:f.basis,usAdultCatalogueCompletedBatchSet:observed.completedBatches,workspaceArtifactOutputTarget:target}};
  return {...f,observed,validator,counters,options,context,port:createUsAdultCatalogueObservationCapability(options)};
}

test('reviewed catalogue Capability plans nominal ports and publishes a real fourth Artifact that replays without recomputation',async t=>{
  const f=await fixture(t),registry=createCapabilityRegistry({registrations:[createUsAdultCatalogueObservationRegistration({manifest,port:f.port})],expectedCapabilityRefs:[CAPABILITY]}),
    options={...f.options,registry,policyRegistry:{digest:D('policy'),bindingFor:()=>({retryPolicyRef:'retry',timeoutPolicyRef:'timeout'})}},
    planner=createUsAdultCatalogueObservationPlanner(options),request={...f.observed.work,workAttemptId:'observe-attempt'},plan=planner.plan(request);
  assert.equal(plan.nodes.length,1);assert.equal(plan.nodes[0].effectClass,'workspace_write');
  assert.equal(validateWorkflowPlan(plan,options).plan.planId,plan.planId);assert.deepEqual(planner.plan(request),plan);
  const projections=new Map(createUsAdultCatalogueObservationProjections(options).map(value=>[value.projectionRef,value.projection]));
  for(const binding of plan.nodes[0].inputBindings.bindings){
    const value=projections.get(binding.projectionRef).project({ownerScope:{ownerDomain:'libra',processType:'libra_run',processId:'run'},parameters:binding.parameters});
    assert.deepEqual(value,f.context.namedInputs[binding.portName]);
  }
  assert.equal(projections.size,Object.keys(PROJECTIONS).length);
  const first=await f.port.execute(f.context),second=await f.port.execute(f.context);
  assert.deepEqual(first,second);assert.equal(f.counters.computes,1);assert.equal(first.resultSchemaRef,resultRef(CAPABILITY));
  f.validator.validate(manifest.evidenceSchemaRef,first.evidence);assert.equal(first.effectReceipt.outputDigest,D(first.result));
  const handle=first.result.observationArtifactHandle,rows=f.db.prepare("SELECT artifact_kind,digest_hex FROM fx_artifact_registry WHERE artifact_kind='face_catalogue_observation'").all();
  assert.equal(rows.length,1);assert.equal(rows[0].digest_hex,handle.digestHex);assert.equal(f.db.prepare('SELECT count(*) n FROM fx_artifact_registry').get().n,4);
  assert.equal(JSON.parse(f.workspace.readArtifactBytes(handle).bytes).observationDigest,f.observed.observation.observationDigest);
});

test('different source generation or Work cannot borrow a frozen Observation target',async t=>{
  const f=await fixture(t);
  assert.throws(()=>f.port.validateInputs({...f.context,workId:'other'}),{code:'US_ADULT_CATALOGUE_OBSERVATION_INPUT_INVALID'});
  assert.throws(()=>f.port.validateInputs({...f.context,namedInputs:{...f.context.namedInputs,
    usAdultCatalogueAnalysisBasis:{...f.basis,catalogueGeneration:{...f.basis.catalogueGeneration,generationDigest:D('other')}}}}),
  {code:'US_ADULT_CATALOGUE_OBSERVATION_INPUT_INVALID'});
  assert.equal(f.counters.computes,0);assert.equal(f.db.prepare('SELECT count(*) n FROM fx_artifact_registry').get().n,3);
});

test('cancelled execution before publication leaves no successful Result or new Observation file',async t=>{
  const f=await fixture(t),options={...f.options,createCatalogueObservationPort({context,validateObservation}){
    return createCleanBuffaloCataloguePort({context,validateObservation,workspaceProductPort:f.workspace,async computeObservation(){
      f.db.exec("UPDATE libra_runs SET state='discarded',state_revision=3");return f.observed.observation;}});
  }};
  await assert.rejects(()=>createUsAdultCatalogueObservationCapability(options).execute(f.context),{code:'US_ADULT_CATALOGUE_BASIS_STALE'});
  assert.equal(f.db.prepare('SELECT count(*) n FROM fx_artifact_registry').get().n,3);
});

test('interruption after physical rename recovers the exact Artifact before Result publication without a second lookup',async t=>{
  const f=await fixture(t);let interrupted=false;
  const workspace=createCleanWorkspaceProductPort({...f.workspaceOptions,rootPath:path.join(f.root,'workspace-root'),afterPhysicalEffect(){
    if(!interrupted){interrupted=true;throw Object.assign(Error('Interrupted after rename'),{code:'AFTER_RENAME'});}
  }}),port=createUsAdultCatalogueObservationCapability({...f.options,workspaceProductPort:workspace,
    createCatalogueObservationPort({context,validateObservation}){return createCleanBuffaloCataloguePort({context,validateObservation,
      workspaceProductPort:workspace,async computeObservation(){f.counters.computes++;return f.observed.observation;}});}});
  await assert.rejects(()=>port.execute(f.context),{code:'AFTER_RENAME'});assert.equal(f.counters.computes,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM fx_artifact_registry').get().n,3);
  const recovered=await port.execute(f.context);assert.equal(f.counters.computes,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM fx_artifact_registry').get().n,4);
  assert.equal(JSON.parse(workspace.readArtifactBytes(recovered.result.observationArtifactHandle).bytes).observationDigest,f.observed.observation.observationDigest);
});

test('corrupt or oversized recovery files fail before recomputation or successful publication',async t=>{
  const f=await fixture(t),result=await f.port.execute(f.context),handle=result.result.observationArtifactHandle,
    root=path.resolve(f.root,'workspace-root'),relative=handle.storageRef.slice('workspace://'.length),file=path.resolve(root,relative);
  assert.ok(file.startsWith(root+path.sep));fs.writeFileSync(file,'{');
  await assert.rejects(()=>f.port.execute(f.context),{code:'CLEAN_WORKSPACE_EFFECT_REALITY_DRIFT'});assert.equal(f.counters.computes,1);
  fs.truncateSync(file,8*1024*1024+1);
  await assert.rejects(()=>f.port.execute(f.context),{code:'CLEAN_WORKSPACE_ARTIFACT_BYTE_LIMIT'});assert.equal(f.counters.computes,1);
  assert.throws(()=>f.workspace.readArtifactBytes(handle),{code:'CLEAN_WORKSPACE_ARTIFACT_BYTE_LIMIT'});
});
