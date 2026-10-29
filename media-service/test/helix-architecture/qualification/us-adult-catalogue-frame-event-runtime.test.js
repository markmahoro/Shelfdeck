'use strict';
// Probe and media/model calculations are deterministic fixtures. Work, Plan,
// Event, Permit, Effect Journal, Workspace files and Registry are real.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {setup}=require('../fixtures/buffalo-frame-engine');
const {createValidator}=require('../fixtures/catalogue-nominal-schemas');
const {canonicalDigest:D,canonicalJson}=require('../../../src/helix/contracts/canonical-json');
const {FRAME,EMBED,CLUSTER}=require('../../../src/helix/contracts/us-adult-catalogue-work-types');
const {createCleanWorkspaceProductPort}=require('../../../src/clean-workspace-product-port');
const {createCleanWesternFramePort}=require('../../../src/clean-western-analysis-port');
const {createUsAdultCatalogueStore}=require('../../../src/helix/domains/libra/persistence/us-adult-catalogue-store');
const {catalogueFrameWork}=require('../../../src/helix/domains/libra/model/us-adult-catalogue-frame-work');
const {buildWorkspaceFrameTarget}=require('../../../src/helix/domains/libra/model/workspace-frame-target');
const {sourceMediaObservationWork}=require('../../../src/helix/domains/libra/planning/media-production-work');
const {createUsAdultCatalogueFrameCapabilityPorts}=require('../../../src/helix/domains/libra/capabilities/us-adult-catalogue-frame-capability-ports');
const {createUsAdultAnalysisCapabilityRegistrations}=require('../../../src/helix/domains/libra/capabilities/us-adult-analysis-capability-ports');
const {createUsAdultCatalogueFramePlanner,createUsAdultCatalogueFrameProjections}=require('../../../src/helix/domains/libra/planning/us-adult-catalogue-frame-planner');
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
const REFS=[FRAME,EMBED,CLUSTER],now=()=>1700000000000;
const manifests=Object.fromEntries(REFS.map(ref=>[ref,require('../../../src/helix/contracts/capabilities/'+ref.replaceAll('.','/').replace('@1','/v1/manifest.json'))]));

function fixture(t,{faultAt=null,faultAtVerification=null,cancelAfterWrite=null,cancelAfterFence=null,corruptFrameSink=false}={}){
  const f=setup(t),store=createUsAdultCatalogueStore(f.options);store.freeze(f.basis);
  const work=catalogueFrameWork(f.args.snapshot,f.basis,'initial'),prior=sourceMediaObservationWork(f.args.snapshot),
    validator=createValidator({includeApplicationTypes:true,capabilitySchemaRefs:REFS}),common={schemaManifest:f.options.schemaManifest,unitOfWork:f.options.unitOfWork};
  assert.equal(prior.workId,f.basis.sourceProbeRef.workId);
  const json=canonicalJson(prior);
  f.db.prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,definition_schema_ref,definition_json,definition_digest,state,idempotency_key,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(prior.workId,prior.ownerDomain,prior.processType,prior.processId,prior.workKind,prior.executionBasisDigest,
      prior.priorityClass,prior.schemaRef,json,D(prior),'succeeded',prior.idempotencyKey,now(),now());
  let injected=false,lastOutcome=null,activeCapability=null,writtenTarget=null,verificationInjected=false;
  const workspace=faultAt||cancelAfterWrite?createCleanWorkspaceProductPort({...f.options,rootPath:path.join(f.root,'workspace-root'),afterPhysicalEffect(info){
    if(!injected&&activeCapability===(faultAt||cancelAfterWrite)){injected=true;writtenTarget=info.target;
      if(cancelAfterWrite){f.db.exec("UPDATE libra_runs SET state='discarded',state_revision=3");return;}
      throw Object.assign(Error('Injected interruption after frame write'),{code:'AFTER_FRAME_WRITE'});}}}):f.workspace;
  const projection={read:()=>({priorityClass:'normal_foreground',localPriority:0,priorityRevision:1,supplyRole:'completion'})},
    supply=createWorkSupplyController({...common,executionProjectionProvider:projection,now}),
    scheduler=createWorkScheduler({...common,supplyController:supply,priorityProjectionProvider:projection,now,nextLeaseId:(()=>{let n=0;return()=>'frame-lease-'+(++n);})()}),
    root=workspace.rootSnapshot(),profile=createResourceProfileMapper({profileKey:'default',profileRevision:1,logicalCpu:1,integrations:[],
      volumes:[{volumeKey:root.mountScopeId}],encoders:[],aiDevices:[],workers:[]}),
    governor=createResourceGovernor({...common,now,profileProvider:{current:()=>profile},nextPermitId:(()=>{let n=0;return()=>'frame-permit-'+(++n);})()}),
    policy=createExecutionPolicyRegistry({expectedCapabilityRefs:REFS,retryPolicies:[{ref:'helix://fixture/retry/workspace/v1',effectClass:'workspace_write',
      maxFailureAttempts:1,backoffMs:[],retryableFailureClasses:[]}],timeoutPolicies:[{ref:'helix://fixture/timeout/v1',timeoutMs:120000,
      minObservationCadenceMs:null,maxObservationElapsedMs:null,maxObservationCount:null}],compensationContracts:[],
      capabilityBindings:REFS.map(capabilityRef=>({capabilityRef,effectClass:'workspace_write',retryPolicyRef:'helix://fixture/retry/workspace/v1',
        timeoutPolicyRef:'helix://fixture/timeout/v1',compensationContractRefs:[]}))}),
    lifecycle=createWorkLifecycle({...common,nextWorkAttemptId:id=>'frame-work-attempt-'+D(id).slice(0,24)}),
    workResultReader=createWorkResultReader(common),workspaceState={workspaceId:'workspace',libraRunId:'run',state:'active',
      currentRevision:1,stateDigest:D('state'),workspaceScopeDigest:D('workspace')};
  const options={...common,usAdultCatalogueStore:store,workResultReader,contractValidator:validator,workspaceProductPort:workspace,now,
    movieProductionReader:{readRunSnapshot:()=>f.args.snapshot,readWorkspace:()=>workspaceState},
    createCatalogueFramePort({context,basis,batch,recoveryFacts,capturePublicationFence}){
      activeCapability=context.capabilityRef;
      const authority={effectClass:'workspace_write',eventAttemptId:context.eventAttemptId,idempotencyKey:context.idempotencyKey,recoveryDecision:context.recoveryDecision},
        catalogueFrameScope={analysisId:basis.analysisId,batchDigest:batch.batchDigest,stage:batch.stage,capabilityRef:context.capabilityRef,
          maximumBytes:Math.min(256*1024*1024,batch.workspaceByteBudget)},
        checkedFence=cancelAfterFence===context.capabilityRef?()=>{const fence=capturePublicationFence();
          f.db.exec("UPDATE libra_runs SET state='discarded',state_revision=3");return fence;}:capturePublicationFence,
        fields={runtimeEffectAuthority:authority,catalogueFrameScope,capturePublicationFence:checkedFence},
        scoped={recoverMaterializedArtifact:request=>workspace.recoverMaterializedArtifact({...request,...fields}),
          openFrameCompositeSink:request=>{
            const sink=workspace.openFrameCompositeSink({...request,...fields});
            return corruptFrameSink?{...sink,writeFrame:value=>sink.writeFrame({...value,timestampMs:value.timestampMs+1})}:sink;
          },
          materializeArtifact:request=>workspace.materializeArtifact({...request,...fields}),
          readCatalogueFrameRecoveryCandidate:request=>workspace.readCatalogueFrameRecoveryCandidate({...request,catalogueFrameScope,
            effectId:recoveryFacts.effect.effect_id,eventAttemptId:context.eventAttemptId,idempotencyKey:context.idempotencyKey,
            executionBasisDigest:basis.runExecutionBasisDigest,inputSnapshotDigest:recoveryFacts.attempt.input_snapshot_digest,
            fenceSnapshotDigest:recoveryFacts.attempt.fence_snapshot_digest}),
          readArtifactBytes:handle=>workspace.readCatalogueFrameArtifactBytes(handle,{libraRunId:basis.libraRunId,
            workspaceId:basis.workspaceId,maximumBytes:catalogueFrameScope.maximumBytes})};
      return createCleanWesternFramePort({workspaceProductPort:scoped,configuration:f.engine.configuration(),engine:f.engine,now});
    }};
  const actualPorts=createUsAdultCatalogueFrameCapabilityPorts(options),ports=Object.fromEntries(REFS.map(ref=>[ref,{...actualPorts[ref],
    async execute(context){lastOutcome=await actualPorts[ref].execute(context);return lastOutcome;}}])),
    registry=createCapabilityRegistry({registrations:createUsAdultAnalysisCapabilityRegistrations({manifests,ports}),expectedCapabilityRefs:REFS}),
    planning={...options,registry,policyRegistry:policy},planner=createUsAdultCatalogueFramePlanner(planning),
    projectionRegistry=createInputBindingProjectionRegistry({registrations:createUsAdultCatalogueFrameProjections(planning)}),
    inputProvider=createEventExecutionInputProvider({...common,contractValidator:validator,bindingProjectionRegistry:projectionRegistry,workResultReader}),
    publisher=createWorkflowPlanPublisher({...common,contractValidator:validator,registry,policyRegistry:policy}),
    admission=createWorkAdmission({...common,limits:{globalOpenWorks:32,ownerOpenWorks:16,openEvents:32},eligibilityProvider:{check(request){
      const basis=store.readForExecution({libraRunId:request.processId,expectedBasisDigest:f.basis.basisDigest});
      return {eligible:request.ownerDomain==='libra'&&request.processType==='libra_run'&&basis.runExecutionBasisDigest===request.executionBasisDigest,
        basisDigest:basis.runExecutionBasisDigest};}}});
  const verifiers=Object.fromEntries(['workspace_write','external_request','domain_fact_commit','responsibility_control_commit','material_commit','destructive_commit']
    .map(effectClass=>[effectClass,{async verify({receipt}){
      assert.equal(effectClass,'workspace_write');assert.ok(lastOutcome);
      const result=lastOutcome.result,handle=result.frameSetArtifactHandle||result.artifactHandle;
      assert.ok(workspace.readCatalogueFrameArtifactBytes(handle,{libraRunId:f.basis.libraRunId,workspaceId:f.basis.workspaceId,
        maximumBytes:Math.min(256*1024*1024,f.batch.workspaceByteBudget)}).bytes.length);
      assert.equal(D(result),receipt.verificationEvidenceDigest);
      if(faultAtVerification===activeCapability&&!verificationInjected){verificationInjected=true;
        throw Object.assign(Error('Injected interruption after Registry'),{code:'AFTER_FRAME_REGISTRY'});}
      return {verified:true,evidenceDigest:receipt.verificationEvidenceDigest};}}])),
    journal=createEffectJournal({...common,now,realityVerifiers:verifiers}),breaker=createCircuitBreaker(common),
    reconciler=createEffectReconcilerRegistry({observers:Object.fromEntries(['workspace_write','external_request','domain_fact_commit',
      'responsibility_control_commit','material_commit','destructive_commit'].map(effectClass=>[effectClass,{async observe(context){
        if(effectClass==='workspace_write'&&ports[context.event?.capability_ref])return ports[context.event.capability_ref].observeEffectReality(context);
        const value=journal.observeRecovery(context.effect.effect_id);
        return {status:value.markers.length===1?'matching':'absent',evidenceDigest:D(value),cleanupDeclared:false};}}]))}),
    runtime=createEventRuntime({...common,contractValidator:validator,scheduler,governor,registry,dispatcher:createExecutorDispatcher({registry,contractValidator:validator}),
      effectJournal:journal,effectReconciler:reconciler,attemptPolicy:createAttemptPolicyController({registry:policy,now}),
      timeoutController:createTimeoutController({now,isolation:createCooperativeExecutionIsolation({now})}),circuitBreaker:breaker,
      executionInputProvider:inputProvider,whenEvaluator:{evaluate:()=> 'run'},fenceValidator:{validate({snapshot}){
        const value=JSON.parse(snapshot.node.fence_basis_json);return {valid:true,digest:D(value),snapshot:value};}},
      resourceDemandResolver:{resolve({snapshot}){return {eventId:snapshot.event.event_id,queueClass:'normal_foreground',localPriority:0,priorityRevision:1,
        resources:[{resourceKey:'cpu_heavy',units:1},{resourceKey:'volume_read:'+root.mountScopeId,units:1},
          {resourceKey:'volume_write:'+root.mountScopeId,units:1},{resourceKey:'sqlite_write',units:1}]};}},
      nextEventAttemptId:(()=>{let n=0;return()=>'frame-event-attempt-'+(++n);})(),
      nextExecutionId:(()=>{let n=0;return()=>'frame-execution-'+(++n);})(),
      nextResultId:(()=>{let n=0;return()=>'frame-result-'+(++n);})(),now});
  return {...f,work,workspace,workspaceState,admission,scheduler,lifecycle,planner,publisher,governor,runtime,workResultReader,
    writtenTarget:()=>writtenTarget};
}

function start(f){
  assert.equal(f.admission.submit(f.work).kind,'admitted');
  const lease=f.scheduler.acquire({targetType:'work'});assert.equal(lease.kind,'leased');
  const ready=f.lifecycle.ensurePlanningAttempt(f.work.workId),plan=f.planner.plan({...f.work,workAttemptId:ready.attempt.attempt_id});
  f.publisher.publish(plan);f.lifecycle.startPlanned(f.work.workId,ready.attempt.attempt_id);f.scheduler.release(lease.lease);
  return {ready,plan};
}
test('three catalogue Frame Events use real Work, Permit, journals and persistent Results',async t=>{
  const f=fixture(t),{ready}=start(f),results=[];
  for(const ref of REFS){
    const lease=f.scheduler.acquire({targetType:'event'});assert.equal(lease.kind,'leased');
    const outcome=await f.runtime.run({schedulerLease:lease.lease});assert.equal(outcome.kind,'succeeded',JSON.stringify(outcome));
    f.lifecycle.aggregateEvent(lease.lease.targetId);results.push(outcome);
  }
  f.lifecycle.settleWork({workId:f.work.workId,workAttemptId:ready.attempt.attempt_id,disposition:'succeeded'});
  const records=f.workResultReader.read(f.work.workId);assert.deepEqual(records.map(item=>item.capabilityRef).sort(),[...REFS].sort());
  assert.equal(f.workResultReader.status(f.work.workId).state,'succeeded');assert.equal(f.governor.snapshot().permitCount,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM fx_artifact_registry').get().n,3);assert.equal(results.length,3);
});

test('an invalid complete frame composite is rejected before the first physical publication',async t=>{
  const f=fixture(t,{corruptFrameSink:true});start(f);
  const lease=f.scheduler.acquire({targetType:'event'}),outcome=await f.runtime.run({schedulerLease:lease.lease});
  assert.notEqual(outcome.kind,'succeeded');assert.equal(f.counters.frames,20);
  assert.equal(f.db.prepare('SELECT count(*) n FROM fx_artifact_registry').get().n,0);
});

for(const faultAt of REFS)test('a written '+faultAt+' Artifact resumes under the original Effect without repeating computation',async t=>{
  const f=fixture(t,{faultAt}),{ready}=start(f);
  for(const ref of REFS){
    const lease=f.scheduler.acquire({targetType:'event'}),outcome=await f.runtime.run({schedulerLease:lease.lease});
    if(ref===faultAt){
      assert.equal(outcome.kind,'effect_recovery_required',JSON.stringify(outcome));const counters={...f.counters};
      const decision=await f.runtime.classifyRecovery({eventId:outcome.eventId,effectId:outcome.effectId});
      assert.equal(decision.decision,'continue_forward');const resumed=await f.runtime.recover(decision);
      assert.equal(resumed.kind,'succeeded',JSON.stringify(resumed));assert.deepEqual(f.counters,counters);
    }else assert.equal(outcome.kind,'succeeded',JSON.stringify(outcome));
    f.lifecycle.aggregateEvent(lease.lease.targetId);
  }
  f.lifecycle.settleWork({workId:f.work.workId,workAttemptId:ready.attempt.attempt_id,disposition:'succeeded'});
  assert.equal(f.db.prepare('SELECT count(*) n FROM fx_artifact_registry').get().n,3);
  assert.equal(f.workResultReader.status(f.work.workId).state,'succeeded');
});

test('an embedding interrupted after Registry publication reuses the exact existing Artifact',async t=>{
  const f=fixture(t,{faultAtVerification:EMBED});start(f);
  let lease=f.scheduler.acquire({targetType:'event'}),outcome=await f.runtime.run({schedulerLease:lease.lease});
  assert.equal(outcome.kind,'succeeded');f.lifecycle.aggregateEvent(lease.lease.targetId);
  lease=f.scheduler.acquire({targetType:'event'});
  await assert.rejects(()=>f.runtime.run({schedulerLease:lease.lease}),{code:'AFTER_FRAME_REGISTRY'});
  const effect=f.db.prepare('SELECT e.effect_id,e.state FROM fx_effect_journal e JOIN fx_event_attempts a ON a.event_attempt_id=e.event_attempt_id WHERE a.event_id=?')
    .get(lease.lease.targetId);assert.equal(effect.state,'reconcile_required');const counters={...f.counters};
  const decision=await f.runtime.classifyRecovery({eventId:lease.lease.targetId,effectId:effect.effect_id});
  assert.equal(decision.decision,'continue_forward');const resumed=await f.runtime.recover(decision);
  assert.equal(resumed.kind,'succeeded');assert.deepEqual(f.counters,counters);
  assert.equal(f.db.prepare("SELECT count(*) n FROM fx_artifact_registry WHERE artifact_kind='face_embedding_set'").get().n,1);
});

test('a corrupt unregistered frame is rejected without computation or a new Registry row',async t=>{
  const f=fixture(t,{faultAt:FRAME});start(f);
  const lease=f.scheduler.acquire({targetType:'event'}),outcome=await f.runtime.run({schedulerLease:lease.lease});
  assert.equal(outcome.kind,'effect_recovery_required');require('node:fs').writeFileSync(f.writtenTarget(),'{');
  const decision=await f.runtime.classifyRecovery({eventId:outcome.eventId,effectId:outcome.effectId});
  assert.equal(decision.decision,'terminal_failure');assert.equal(f.counters.frames,20);
  assert.equal(f.db.prepare('SELECT count(*) n FROM fx_artifact_registry').get().n,0);
});

test('a genuinely absent unregistered frame can be safely rebuilt',async t=>{
  const f=fixture(t,{faultAt:FRAME});start(f);
  const lease=f.scheduler.acquire({targetType:'event'}),outcome=await f.runtime.run({schedulerLease:lease.lease});
  assert.equal(outcome.kind,'effect_recovery_required');require('node:fs').unlinkSync(f.writtenTarget());
  const decision=await f.runtime.classifyRecovery({eventId:outcome.eventId,effectId:outcome.effectId});
  assert.equal(decision.decision,'safe_retry');const resumed=await f.runtime.recover(decision);
  assert.equal(resumed.kind,'succeeded');assert.equal(f.counters.frames,40);
  assert.equal(f.db.prepare("SELECT count(*) n FROM fx_artifact_registry WHERE artifact_kind='western_frame_set'").get().n,1);
});

test('a Run cancelled after frame bytes are written cannot publish a frame Result',async t=>{
  const f=fixture(t,{cancelAfterWrite:FRAME});start(f);
  const lease=f.scheduler.acquire({targetType:'event'}),outcome=await f.runtime.run({schedulerLease:lease.lease});
  assert.notEqual(outcome.kind,'succeeded');assert.equal(f.counters.frames,20);
  assert.equal(f.db.prepare('SELECT count(*) n FROM fx_artifact_registry').get().n,0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM fx_event_result_bindings WHERE event_id=? AND outcome_kind='succeeded'").get(lease.lease.targetId).n,0);
});

test('a Run cancelled after the Owner fence cannot register a frame Artifact',async t=>{
  const f=fixture(t,{cancelAfterFence:FRAME});start(f);
  const lease=f.scheduler.acquire({targetType:'event'}),outcome=await f.runtime.run({schedulerLease:lease.lease});
  assert.notEqual(outcome.kind,'succeeded');assert.equal(f.counters.frames,20);
  assert.equal(f.db.prepare('SELECT count(*) n FROM fx_artifact_registry').get().n,0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM fx_event_result_bindings WHERE event_id=? AND outcome_kind='succeeded'").get(lease.lease.targetId).n,0);
});

test('an oversized frame recovery file is rejected before any file bytes are read',async t=>{
  const f=fixture(t,{faultAt:FRAME});start(f);
  const lease=f.scheduler.acquire({targetType:'event'}),outcome=await f.runtime.run({schedulerLease:lease.lease}),fs=require('node:fs');
  assert.equal(outcome.kind,'effect_recovery_required');
  fs.truncateSync(f.writtenTarget(),Math.min(256*1024*1024,f.batch.workspaceByteBudget)+1);
  const original=fs.readSync.bind(fs);let readBytes=0;
  t.mock.method(fs,'readSync',(...args)=>{const count=original(...args);readBytes+=count;return count;});
  const decision=await f.runtime.classifyRecovery({eventId:outcome.eventId,effectId:outcome.effectId});
  assert.equal(decision.decision,'terminal_failure');assert.equal(readBytes,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM fx_artifact_registry').get().n,0);
});

test('a frame file growing after descriptor stat is rejected after at most its original size plus one byte',async t=>{
  const f=fixture(t,{faultAt:FRAME});start(f);
  const lease=f.scheduler.acquire({targetType:'event'}),outcome=await f.runtime.run({schedulerLease:lease.lease}),fs=require('node:fs');
  assert.equal(outcome.kind,'effect_recovery_required');const file=f.writtenTarget(),initialSize=fs.statSync(file).size,
    fstat=fs.fstatSync.bind(fs),read=fs.readSync.bind(fs);let grew=false,readBytes=0;
  t.mock.method(fs,'fstatSync',(fd,options)=>{const value=fstat(fd,options);if(!grew){grew=true;fs.appendFileSync(file,'extra');}return value;});
  t.mock.method(fs,'readSync',(...args)=>{const count=read(...args);readBytes+=count;return count;});
  const decision=await f.runtime.classifyRecovery({eventId:outcome.eventId,effectId:outcome.effectId});
  assert.equal(decision.decision,'terminal_failure');assert.equal(grew,true);assert.equal(readBytes,initialSize+1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM fx_artifact_registry').get().n,0);
});

test('frame recovery inspection rejects a forged Effect, Run, input or batch before reading bytes',async t=>{
  const f=fixture(t,{faultAt:FRAME});start(f);
  const lease=f.scheduler.acquire({targetType:'event'}),outcome=await f.runtime.run({schedulerLease:lease.lease});
  assert.equal(outcome.kind,'effect_recovery_required');
  const effect=f.db.prepare('SELECT * FROM fx_effect_journal WHERE effect_id=?').get(outcome.effectId),
    attempt=f.db.prepare('SELECT * FROM fx_event_attempts WHERE event_attempt_id=?').get(effect.event_attempt_id),
    target=buildWorkspaceFrameTarget({basis:f.basis,workspace:f.workspaceState,rootSnapshot:f.workspace.rootSnapshot(),
      samplingPlan:f.batch.samplingPlan,targetRelativePath:'analysis/catalogue/'+f.basis.analysisId+'/initial-'+f.batch.batchDigest+'.json'}),
    request={libraRunId:'run',workspaceId:'workspace',relativePath:target.targetRelativePath,artifactKind:'western_frame_set',
      mediaType:'application/vnd.shelfdeck.western-frame-set+json',provenanceRef:{objectType:'western_frame_extract',
        objectId:target.targetId,revision:1,digest:target.targetDigest},effectId:effect.effect_id,eventAttemptId:attempt.event_attempt_id,
      idempotencyKey:effect.idempotency_key,executionBasisDigest:f.basis.runExecutionBasisDigest,inputSnapshotDigest:attempt.input_snapshot_digest,
      fenceSnapshotDigest:attempt.fence_snapshot_digest,catalogueFrameScope:{analysisId:f.basis.analysisId,batchDigest:f.batch.batchDigest,
        stage:'initial',capabilityRef:FRAME,maximumBytes:Math.min(256*1024*1024,f.batch.workspaceByteBudget)}};
  assert.equal(f.workspace.readCatalogueFrameRecoveryCandidate(request).kind,'present');
  const fs=require('node:fs'),read=fs.readSync.bind(fs);let readBytes=0;
  t.mock.method(fs,'readSync',(...args)=>{const count=read(...args);readBytes+=count;return count;});
  for(const changed of [{effectId:D('other')},{libraRunId:'other'},{inputSnapshotDigest:D('other')}])
    assert.throws(()=>f.workspace.readCatalogueFrameRecoveryCandidate({...request,...changed}),{code:'CLEAN_WORKSPACE_CATALOGUE_RECOVERY_SCOPE_STALE'});
  assert.throws(()=>f.workspace.readCatalogueFrameRecoveryCandidate({...request,catalogueFrameScope:{...request.catalogueFrameScope,batchDigest:D('other')}}),
    {code:'CLEAN_WORKSPACE_CATALOGUE_FRAME_SCOPE_INVALID'});
  assert.equal(readBytes,0);
});
