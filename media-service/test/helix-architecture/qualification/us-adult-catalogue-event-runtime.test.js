'use strict';
// Explicitly run on the reviewed 139-Capability integration snapshot. The
// three preceding frame Results are fixture records with real Workspace files;
// this test exercises an actual Foundation Observation Work and Event.
const test=require('node:test'),assert=require('node:assert/strict');
const {coordination}=require('../fixtures/us-adult-catalogue-coordination');
const {createValidator}=require('../fixtures/catalogue-nominal-schemas');
const {canonicalDigest:D,canonicalJson}=require('../../../src/helix/contracts/canonical-json');
const {CAPABILITY}=require('../../../src/helix/contracts/us-adult-catalogue-work-types');
const {createCleanBuffaloCataloguePort}=require('../../../src/clean-buffalo-catalogue-port');
const {createCleanWorkspaceProductPort}=require('../../../src/clean-workspace-product-port');
const path=require('node:path');
const {createUsAdultCatalogueObservationCapability,createUsAdultCatalogueObservationRegistration}=require('../../../src/helix/domains/libra/capabilities/us-adult-catalogue-observation-capability');
const {createUsAdultCatalogueObservationPlanner,createUsAdultCatalogueObservationProjections}=require('../../../src/helix/domains/libra/planning/us-adult-catalogue-observation-planner');
const {catalogueObservationTarget}=require('../../../src/helix/domains/libra/model/us-adult-catalogue-observation-result');
const {createCapabilityRegistry}=require('../../../src/helix/foundation/capability/capability-registry');
const {createExecutorDispatcher}=require('../../../src/helix/foundation/capability/executor-dispatcher');
const {createWorkAdmission}=require('../../../src/helix/foundation/execution/work-admission');
const {createWorkLifecycle}=require('../../../src/helix/foundation/execution/work-lifecycle');
const {createWorkScheduler}=require('../../../src/helix/foundation/execution/work-scheduler');
const {createWorkSupplyController}=require('../../../src/helix/foundation/execution/work-supply-controller');
const {createWorkflowPlanPublisher}=require('../../../src/helix/foundation/execution/workflow-plan');
const {createInputBindingProjectionRegistry}=require('../../../src/helix/foundation/execution/input-binding-projection-registry');
const {createEventExecutionInputProvider}=require('../../../src/helix/foundation/execution/event-execution-input-provider');
const {createResourceGovernor}=require('../../../src/helix/foundation/execution/resource-governor');
const {createResourceProfileMapper}=require('../../../src/helix/foundation/execution/resource-profile-mapper');
const {createExecutionPolicyRegistry,createAttemptPolicyController}=require('../../../src/helix/foundation/execution/execution-policy');
const {createCooperativeExecutionIsolation}=require('../../../src/helix/foundation/execution/cooperative-execution-isolation');
const {createTimeoutController}=require('../../../src/helix/foundation/execution/timeout-controller');
const {createEventRuntime}=require('../../../src/helix/foundation/execution/event-runtime');
const {createWorkResultReader}=require('../../../src/helix/foundation/execution/work-result-reader');
const {createCircuitBreaker}=require('../../../src/helix/foundation/diagnostics/pressure-guard');
const {createEffectJournal}=require('../../../src/helix/foundation/effects/effect-journal');
const {createEffectReconcilerRegistry}=require('../../../src/helix/foundation/effects/effect-reconcilers');
const manifest=require('../../../src/helix/contracts/capabilities/libra/us_adult/catalogue/observe/v1/manifest.json');
const now=()=>1700000000000;

async function fixture(t,{faultAfterWrite=false,faultAfterRegistry=false,cancelWorkAfterWrite=false,cancelRunAfterWrite=false,
  cancelRunAfterFence=false,forbidSecondCompute=false}={}){
  const f=coordination(t);f.reconcile();await f.completeFrames('initial');const fixtureObservation=await f.completeObservation('initial'),
    validator=createValidator({includeProposed:true,includeApplicationTypes:true,capabilitySchemaRefs:[CAPABILITY]}),
    common={schemaManifest:f.workspaceOptions.schemaManifest,unitOfWork:f.workspaceOptions.unitOfWork},
    root=f.workspace.rootSnapshot(),prior=fixtureObservation.completedBatches.batches[0].workId,
    priorWork=f.submissions.find(work=>work.workId===prior),priorJson=canonicalJson(priorWork),work=fixtureObservation.work;
  assert.ok(priorWork);
  let injected=false;
  const workspace=faultAfterWrite||cancelWorkAfterWrite||cancelRunAfterWrite?createCleanWorkspaceProductPort({...f.workspaceOptions,rootPath:path.join(f.root,'workspace-root'),afterPhysicalEffect(){
    if(!injected){injected=true;
      if(cancelWorkAfterWrite){
        // Inject a competing terminal Foundation fact at the exact filesystem/registry boundary.
        f.db.prepare("UPDATE fx_supporting_works SET state='cancelled' WHERE work_id=?").run(work.workId);
        return;
      }
      if(cancelRunAfterWrite){f.db.exec("UPDATE libra_runs SET state='discarded',state_revision=3");return;}
      throw Object.assign(Error('Injected interruption after physical write'),{code:'AFTER_PHYSICAL_WRITE'});
    }}}):f.workspace;
  f.db.prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,definition_schema_ref,definition_json,definition_digest,state,idempotency_key,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(priorWork.workId,priorWork.ownerDomain,priorWork.processType,priorWork.processId,priorWork.workKind,priorWork.executionBasisDigest,
      priorWork.priorityClass,priorWork.schemaRef,priorJson,D(priorWork),'succeeded',priorWork.idempotencyKey,now(),now());
  const executionProjectionProvider={read:()=>({priorityClass:'normal_foreground',localPriority:0,priorityRevision:1,supplyRole:'completion'})},
    supply=createWorkSupplyController({...common,executionProjectionProvider,now}),
    scheduler=createWorkScheduler({...common,supplyController:supply,priorityProjectionProvider:executionProjectionProvider,now,nextLeaseId:(()=>{let n=0;return()=>'lease-'+(++n);})()}),
    profile=createResourceProfileMapper({profileKey:'default',profileRevision:1,logicalCpu:1,integrations:[],volumes:[{volumeKey:root.mountScopeId}],encoders:[],aiDevices:[],workers:[]}),
    governor=createResourceGovernor({...common,now,profileProvider:{current:()=>profile},nextPermitId:(()=>{let n=0;return()=>'permit-'+(++n);})()}),
    policy=createExecutionPolicyRegistry({expectedCapabilityRefs:[CAPABILITY],retryPolicies:[{ref:'helix://fixture/retry/workspace/v1',
      effectClass:'workspace_write',maxFailureAttempts:1,backoffMs:[],retryableFailureClasses:[]}],
      timeoutPolicies:[{ref:'helix://fixture/timeout/v1',timeoutMs:120000,minObservationCadenceMs:null,maxObservationElapsedMs:null,maxObservationCount:null}],
      compensationContracts:[],capabilityBindings:[{capabilityRef:CAPABILITY,effectClass:'workspace_write',retryPolicyRef:'helix://fixture/retry/workspace/v1',
        timeoutPolicyRef:'helix://fixture/timeout/v1',compensationContractRefs:[]}]}),
    lifecycle=createWorkLifecycle({...common,nextWorkAttemptId:id=>'attempt-'+D(id).slice(0,24)}),
    workResultReader=createWorkResultReader(common);
  let computes=0,permitDuringCompute=null,effectDuringCompute=null,lastOutcome=null;
  const capabilityOptions={...f.options,unitOfWork:f.workspaceOptions.unitOfWork,contractValidator:validator,workspaceProductPort:workspace,now,
    createCatalogueObservationPort({context,validateObservation,capturePublicationFence}){
      const authority={effectClass:'workspace_write',eventAttemptId:context.eventAttemptId,idempotencyKey:context.idempotencyKey,
        recoveryDecision:context.recoveryDecision};
      const scoped={recoverMaterializedArtifact:request=>workspace.recoverMaterializedArtifact({...request,runtimeEffectAuthority:authority}),
        materializeArtifact:request=>workspace.materializeArtifact({...request,runtimeEffectAuthority:authority}),
        readArtifactBytes:handle=>workspace.readArtifactBytes(handle)};
      const captureFence=cancelRunAfterFence?()=>{const fence=capturePublicationFence();
        f.db.exec("UPDATE libra_runs SET state='discarded',state_revision=3");return fence;}:capturePublicationFence;
      return createCleanBuffaloCataloguePort({context,validateObservation,capturePublicationFence:captureFence,workspaceProductPort:scoped,async computeObservation(){
        computes++;if(forbidSecondCompute&&computes>1)throw Object.assign(Error('The completed source must not be recomputed'),{code:'RECOMPUTED'});
        permitDuringCompute=governor.snapshot();effectDuringCompute=f.db.prepare('SELECT state,event_attempt_id FROM fx_effect_journal WHERE effect_class=? AND idempotency_key=?')
          .get('workspace_write',context.idempotencyKey);return fixtureObservation.observation;}});
    }};
  const port=createUsAdultCatalogueObservationCapability(capabilityOptions),registered={...port,async execute(context){lastOutcome=await port.execute(context);return lastOutcome;}},
    registry=createCapabilityRegistry({registrations:[createUsAdultCatalogueObservationRegistration({manifest,port:registered})],expectedCapabilityRefs:[CAPABILITY]}),
    planning={...capabilityOptions,registry,policyRegistry:policy},planner=createUsAdultCatalogueObservationPlanner(planning),
    projectionRegistry=createInputBindingProjectionRegistry({registrations:createUsAdultCatalogueObservationProjections(planning)}),
    inputProvider=createEventExecutionInputProvider({...common,contractValidator:validator,bindingProjectionRegistry:projectionRegistry,workResultReader}),
    publisher=createWorkflowPlanPublisher({...common,contractValidator:validator,registry,policyRegistry:policy}),
    admission=createWorkAdmission({...common,limits:{globalOpenWorks:32,ownerOpenWorks:16,openEvents:32},eligibilityProvider:{check(request){
      const current=f.store.readForExecution({libraRunId:request.processId,expectedBasisDigest:f.basis.basisDigest});
      return {eligible:request.ownerDomain==='libra'&&request.processType==='libra_run'&&current.runExecutionBasisDigest===request.executionBasisDigest,
        basisDigest:current.runExecutionBasisDigest};}}});
  let verificationFault=false;
  const verifiers=Object.fromEntries(['workspace_write','external_request','domain_fact_commit','responsibility_control_commit','material_commit','destructive_commit']
    .map(effectClass=>[effectClass,{async verify({receipt}){
      assert.equal(effectClass,'workspace_write');assert.ok(lastOutcome);const result=lastOutcome.result,bytes=workspace.readArtifactBytes(result.observationArtifactHandle).bytes;
      assert.equal(D(JSON.parse(bytes)),result.observationArtifactHandle.digestHex);assert.equal(D(result),receipt.verificationEvidenceDigest);
      if(faultAfterRegistry&&!verificationFault){verificationFault=true;throw Object.assign(Error('Injected verification interruption'),{code:'AFTER_REGISTRY'});}
      return {verified:true,evidenceDigest:receipt.verificationEvidenceDigest};}}])),
    journal=createEffectJournal({...common,now,realityVerifiers:verifiers}),breaker=createCircuitBreaker(common),
    effectReconciler=createEffectReconcilerRegistry({observers:Object.fromEntries(['workspace_write','external_request','domain_fact_commit',
      'responsibility_control_commit','material_commit','destructive_commit'].map(effectClass=>[effectClass,{async observe(context){
        if(effectClass!=='workspace_write')throw Error('No other recovery is used by this fixture.');
        return port.observeEffectReality(context);}}]))}),
    runtime=createEventRuntime({...common,contractValidator:validator,scheduler,governor,registry,dispatcher:createExecutorDispatcher({registry,contractValidator:validator}),
      effectJournal:journal,effectReconciler,attemptPolicy:createAttemptPolicyController({registry:policy,now}),
      timeoutController:createTimeoutController({now,isolation:createCooperativeExecutionIsolation({now})}),circuitBreaker:breaker,
      executionInputProvider:inputProvider,whenEvaluator:{evaluate:()=> 'run'},fenceValidator:{validate({snapshot}){
        const value=JSON.parse(snapshot.node.fence_basis_json);return {valid:true,digest:D(value),snapshot:value};}},
      resourceDemandResolver:{resolve({snapshot}){return {eventId:snapshot.event.event_id,queueClass:'normal_foreground',localPriority:0,priorityRevision:1,
        resources:[{resourceKey:'cpu_heavy',units:1},{resourceKey:'volume_read:'+root.mountScopeId,units:1},
          {resourceKey:'volume_write:'+root.mountScopeId,units:1},{resourceKey:'sqlite_write',units:1}]};}},
      nextEventAttemptId:()=> 'actual-observe-event-attempt',nextExecutionId:()=> 'actual-observe-execution',nextResultId:()=> 'actual-observe-result',now});
  return {...f,workspace,fixtureObservation,work,validator,admission,scheduler,lifecycle,planner,publisher,governor,runtime,workResultReader,
    proof:()=>({computes,permitDuringCompute,effectDuringCompute,lastOutcome})};
}

function startWork(f){
  assert.equal(f.admission.submit(f.work).kind,'admitted');
  const workLease=f.scheduler.acquire({targetType:'work'});assert.equal(workLease.kind,'leased');assert.equal(workLease.lease.targetId,f.work.workId);
  const ready=f.lifecycle.ensurePlanningAttempt(f.work.workId),plan=f.planner.plan({...f.work,workAttemptId:ready.attempt.attempt_id});
  try{f.publisher.publish(plan);}catch(error){error.message+=' '+JSON.stringify(error.details||{});throw error;}
  f.lifecycle.startPlanned(f.work.workId,ready.attempt.attempt_id);f.scheduler.release(workLease.lease);
  const eventLease=f.scheduler.acquire({targetType:'event'});assert.equal(eventLease.kind,'leased');
  return {ready,plan,eventLease};
}
test('a real admitted Observation Work runs its immutable Plan under a real resource Permit and commits one Effect and Result',async t=>{
  const f=await fixture(t),{ready,eventLease}=startWork(f);
  const outcome=await f.runtime.run({schedulerLease:eventLease.lease});assert.equal(outcome.kind,'succeeded',JSON.stringify(outcome));
  const evidence=f.proof();assert.equal(evidence.computes,1);assert.equal(evidence.permitDuringCompute.permitCount,1);
  assert.ok(evidence.permitDuringCompute.inUse.some(item=>item.resourceKey==='cpu_heavy'));
  assert.ok(evidence.permitDuringCompute.inUse.some(item=>item.resourceKey.startsWith('volume_write:')));
  assert.equal(evidence.effectDuringCompute.state,'intended');assert.equal(evidence.effectDuringCompute.event_attempt_id,'actual-observe-event-attempt');
  assert.equal(f.governor.snapshot().permitCount,0);
  const aggregate=f.lifecycle.aggregateEvent(eventLease.lease.targetId);assert.equal(aggregate.attemptTerminal,true);
  f.lifecycle.settleWork({workId:f.work.workId,workAttemptId:ready.attempt.attempt_id,disposition:'succeeded'});
  const records=f.workResultReader.read(f.work.workId).filter(value=>value.capabilityRef===CAPABILITY);
  assert.equal(records.length,1);assert.equal(records[0].outcomeKind,'succeeded');assert.equal(records[0].resultId,'actual-observe-result');
  assert.equal(f.workResultReader.status(f.work.workId).state,'succeeded');
  assert.equal(f.db.prepare("SELECT count(*) n FROM fx_artifact_registry WHERE artifact_kind='face_catalogue_observation'").get().n,1);
  assert.equal(f.db.prepare("SELECT state FROM fx_effect_journal WHERE effect_class='workspace_write' AND event_attempt_id=?").get('actual-observe-event-attempt').state,'committed');
});

test('a real interrupted Observation Effect classifies existing complete bytes and resumes without recomputation',async t=>{
  const f=await fixture(t,{faultAfterWrite:true,forbidSecondCompute:true}),{eventLease}=startWork(f),
    pending=await f.runtime.run({schedulerLease:eventLease.lease});
  assert.equal(pending.kind,'effect_recovery_required');assert.equal(pending.failureCode,'AFTER_PHYSICAL_WRITE');
  assert.equal(f.proof().computes,1);assert.equal(f.db.prepare("SELECT count(*) n FROM fx_artifact_registry WHERE artifact_kind='face_catalogue_observation'").get().n,0);
  const decision=await f.runtime.classifyRecovery({eventId:pending.eventId,effectId:pending.effectId});
  assert.equal(decision.decision,'continue_forward','The existing complete target must not be called absent.');
  const resumed=await f.runtime.recover(decision);assert.equal(resumed.kind,'succeeded');assert.equal(f.proof().computes,1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM fx_artifact_registry WHERE artifact_kind='face_catalogue_observation'").get().n,1);
});

test('a genuinely absent interrupted Observation can be safely recomputed',async t=>{
  const f=await fixture(t,{faultAfterWrite:true}),{eventLease}=startWork(f),pending=await f.runtime.run({schedulerLease:eventLease.lease});
  assert.equal(pending.kind,'effect_recovery_required');
  const file=path.join(f.root,'workspace-root','workspace','analysis','catalogue-observations',f.basis.analysisId,
    'initial-'+f.fixtureObservation.completedBatches.setDigest+'.json');
  require('node:fs').unlinkSync(file);
  const decision=await f.runtime.classifyRecovery({eventId:pending.eventId,effectId:pending.effectId});
  assert.equal(decision.decision,'safe_retry');const resumed=await f.runtime.recover(decision);
  assert.equal(resumed.kind,'succeeded');assert.equal(f.proof().computes,2);
  assert.equal(f.db.prepare("SELECT count(*) n FROM fx_artifact_registry WHERE artifact_kind='face_catalogue_observation'").get().n,1);
});

test('a real Effect interrupted after Registry publication resumes without a second observation',async t=>{
  const f=await fixture(t,{faultAfterRegistry:true,forbidSecondCompute:true}),{eventLease}=startWork(f);
  await assert.rejects(()=>f.runtime.run({schedulerLease:eventLease.lease}),{code:'AFTER_REGISTRY'});
  const effect=f.db.prepare("SELECT effect_id,state FROM fx_effect_journal WHERE effect_class='workspace_write' AND event_attempt_id=?").get('actual-observe-event-attempt');
  assert.equal(effect.state,'reconcile_required');assert.equal(f.db.prepare("SELECT count(*) n FROM fx_artifact_registry WHERE artifact_kind='face_catalogue_observation'").get().n,1);
  const decision=await f.runtime.classifyRecovery({eventId:eventLease.lease.targetId,effectId:effect.effect_id});
  assert.equal(decision.decision,'continue_forward');const resumed=await f.runtime.recover(decision);
  assert.equal(resumed.kind,'succeeded');assert.equal(f.proof().computes,1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM fx_artifact_registry WHERE artifact_kind='face_catalogue_observation'").get().n,1);
});

test('a corrupt interrupted Observation is a conflict, with no second lookup or Registry publication',async t=>{
  const f=await fixture(t,{faultAfterWrite:true,forbidSecondCompute:true}),{eventLease}=startWork(f),pending=await f.runtime.run({schedulerLease:eventLease.lease});
  assert.equal(pending.kind,'effect_recovery_required');
  const target=f.db.prepare('SELECT root_handle_ref FROM fx_workspace_registry WHERE workspace_id=?').get('workspace');assert.ok(target);
  const file=path.join(f.root,'workspace-root','workspace','analysis','catalogue-observations',f.basis.analysisId,
    'initial-'+f.fixtureObservation.completedBatches.setDigest+'.json');
  require('node:fs').writeFileSync(file,'{');
  const decision=await f.runtime.classifyRecovery({eventId:pending.eventId,effectId:pending.effectId});
  assert.equal(decision.decision,'terminal_failure');assert.equal(f.proof().computes,1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM fx_artifact_registry WHERE artifact_kind='face_catalogue_observation'").get().n,0);
  assert.equal(require('node:fs').readFileSync(file,'utf8'),'{');
});

test('a cancelled Libra Run cannot recover its unregistered Observation',async t=>{
  const f=await fixture(t,{faultAfterWrite:true,forbidSecondCompute:true}),{eventLease}=startWork(f),pending=await f.runtime.run({schedulerLease:eventLease.lease});
  f.db.exec("UPDATE libra_runs SET state='discarded',state_revision=3");
  const decision=await f.runtime.classifyRecovery({eventId:pending.eventId,effectId:pending.effectId});
  assert.equal(decision.decision,'terminal_failure');assert.equal(f.proof().computes,1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM fx_artifact_registry WHERE artifact_kind='face_catalogue_observation'").get().n,0);
});

test('a terminal Work at the physical write boundary cannot publish an Observation or a successful Result',async t=>{
  const f=await fixture(t,{cancelWorkAfterWrite:true}),{eventLease}=startWork(f);
  let outcome;try{outcome=await f.runtime.run({schedulerLease:eventLease.lease});}catch(error){outcome={kind:'rejected',code:error.code};}
  assert.notEqual(outcome.kind,'succeeded');assert.equal(f.proof().computes,1);
  assert.equal(f.db.prepare("SELECT state FROM fx_supporting_works WHERE work_id=?").get(f.work.workId).state,'cancelled');
  assert.equal(f.db.prepare("SELECT count(*) n FROM fx_artifact_registry WHERE artifact_kind='face_catalogue_observation'").get().n,0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM fx_event_result_bindings WHERE event_id=? AND outcome_kind='succeeded'")
    .get(eventLease.lease.targetId).n,0);
  const file=path.join(f.root,'workspace-root','workspace','analysis','catalogue-observations',f.basis.analysisId,
    'initial-'+f.fixtureObservation.completedBatches.setDigest+'.json');
  assert.equal(require('node:fs').existsSync(file),true);
});

for(const scenario of ['cancelRunAfterWrite','cancelRunAfterFence'])test('an Owner Run cancelled '+scenario+' cannot publish its Observation',async t=>{
  const f=await fixture(t,{[scenario]:true}),{eventLease}=startWork(f);
  let outcome;try{outcome=await f.runtime.run({schedulerLease:eventLease.lease});}catch(error){outcome={kind:'rejected',code:error.code};}
  assert.notEqual(outcome.kind,'succeeded');assert.equal(f.proof().computes,1);
  assert.equal(f.db.prepare('SELECT state FROM libra_runs WHERE libra_run_id=?').get('run').state,'discarded');
  assert.equal(f.db.prepare("SELECT count(*) n FROM fx_artifact_registry WHERE artifact_kind='face_catalogue_observation'").get().n,0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM fx_event_result_bindings WHERE event_id=? AND outcome_kind='succeeded'")
    .get(eventLease.lease.targetId).n,0);
});

test('recovery inspection refuses a forged Effect, Run, input digest or target before returning bytes',async t=>{
  const f=await fixture(t,{faultAfterWrite:true}),{eventLease}=startWork(f),pending=await f.runtime.run({schedulerLease:eventLease.lease}),
    effect=f.db.prepare('SELECT * FROM fx_effect_journal WHERE effect_id=?').get(pending.effectId),
    attempt=f.db.prepare('SELECT * FROM fx_event_attempts WHERE event_attempt_id=?').get(effect.event_attempt_id),
    target=catalogueObservationTarget({basis:f.basis,completedBatches:f.fixtureObservation.completedBatches,
      workspace:f.workspaceState,rootSnapshot:f.workspace.rootSnapshot()}),
    request={libraRunId:'run',workspaceId:'workspace',relativePath:target.targetRelativePath,artifactKind:'face_catalogue_observation',
      mediaType:'application/vnd.shelfdeck.face-catalogue-observation+json',analysisId:f.basis.analysisId,mode:'initial',
      provenanceRef:{objectType:'us_adult_catalogue_observation',objectId:f.fixtureObservation.completedBatches.setDigest,revision:1,digest:target.targetDigest},
      effectId:effect.effect_id,eventAttemptId:attempt.event_attempt_id,idempotencyKey:effect.idempotency_key,
      executionBasisDigest:f.basis.runExecutionBasisDigest,inputSnapshotDigest:attempt.input_snapshot_digest,fenceSnapshotDigest:attempt.fence_snapshot_digest};
  assert.equal(f.workspace.readCatalogueRecoveryCandidate(request).kind,'present');
  for(const changed of [{effectId:D('other')},{libraRunId:'other'},{inputSnapshotDigest:D('other')}])
    assert.throws(()=>f.workspace.readCatalogueRecoveryCandidate({...request,...changed}),{code:'CLEAN_WORKSPACE_CATALOGUE_RECOVERY_SCOPE_STALE'});
  assert.throws(()=>f.workspace.readCatalogueRecoveryCandidate({...request,relativePath:'analysis/other.json'}),
    {code:'CLEAN_WORKSPACE_CATALOGUE_RECOVERY_SCOPE_INVALID'});
});
