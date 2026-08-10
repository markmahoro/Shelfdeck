'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { canonicalDigest } = require('../contracts/canonical-json');
const { createCapabilityContractValidator } = require('../foundation/capability/contract-validator');
const { createCapabilityRegistry } = require('../foundation/capability/capability-registry');
const { createExecutorDispatcher } = require('../foundation/capability/executor-dispatcher');
const { createCircuitBreaker } = require('../foundation/diagnostics/pressure-guard');
const { createEffectJournal } = require('../foundation/effects/effect-journal');
const { createEventExecutionInputProvider } = require('../foundation/execution/event-execution-input-provider');
const { createEventRuntime } = require('../foundation/execution/event-runtime');
const { createExecutionPolicyRegistry, createAttemptPolicyController } = require('../foundation/execution/execution-policy');
const { createExecutionRuntimeHost } = require('../foundation/execution/execution-runtime-host');
const { createInputBindingProjectionRegistry } = require('../foundation/execution/input-binding-projection-registry');
const { createPlannerRegistry } = require('../foundation/execution/planner-registry');
const { createResourceGovernor } = require('../foundation/execution/resource-governor');
const { createResourceProfileMapper } = require('../foundation/execution/resource-profile-mapper');
const { createStartupRecovery } = require('../foundation/execution/startup-recovery');
const { createTimeoutController } = require('../foundation/execution/timeout-controller');
const { createWorkLifecycle } = require('../foundation/execution/work-lifecycle');
const { createWorkScheduler } = require('../foundation/execution/work-scheduler');
const { createWorkSupplyController } = require('../foundation/execution/work-supply-controller');
const { createWorkResultReader } = require('../foundation/execution/work-result-reader');
const { createReconcileCursorStore } = require('../foundation/execution/reconcile-cursor-store');
const { createDomainReconcileRunner } = require('../foundation/execution/domain-reconcile-runner');
const { createWorkflowPlanPublisher, executionCatalogDigest } = require('../foundation/execution/workflow-plan');
const { ProcurementExecutionRegistration } = require('../domains/procurement/public');

const PROCUREMENT_ENABLED = Object.freeze(['procurement.field.observation.page.commit@1',
  'procurement.triage.playability.inspect@1','procurement.triage.structure.inspect@1',
  'procurement.triage.identity_claim.resolve@1','procurement.triage.primary_manifest.build@1','procurement.candidate.publish@1']);
const SHARED_ENABLED = Object.freeze(['shared.material.media.probe@1']);
const ENABLED = Object.freeze([...PROCUREMENT_ENABLED, ...SHARED_ENABLED]);

function collectSchemas(root) {
  const schemas = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const location = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(location);
      else if (entry.isFile() && entry.name.endsWith('schema.json')) {
        const value = JSON.parse(fs.readFileSync(location, 'utf8'));
        if (typeof value.$id === 'string') schemas.push(value);
      }
    }
  }
  return schemas;
}

function manifest(contractsRoot, capabilityRef) {
  const relative = capabilityRef.replace('@1', '').split('.').join(path.sep);
  return JSON.parse(fs.readFileSync(path.join(contractsRoot, 'capabilities', relative, 'v1', 'manifest.json'), 'utf8'));
}

function findMountScopeId(value,seen=new Set()){
  if(!value||typeof value!=='object'||seen.has(value))return null;seen.add(value);
  if(typeof value.mountScopeId==='string'&&value.mountScopeId)return value.mountScopeId;
  for(const child of Array.isArray(value)?value:Object.values(value)){const found=findMountScopeId(child,seen);if(found)return found;}
  return null;
}

function createProcurementExecutionRuntime(options) {
  const contractsRoot = options.contractsRoot || path.resolve(__dirname, '../contracts');
  const now = options.now || Date.now;
  const contractValidator = createCapabilityContractValidator({ schemas: collectSchemas(contractsRoot) });
  const manifests = Object.fromEntries(ENABLED.map((ref) => [ref, manifest(contractsRoot, ref)]));
  const procurementConstruction = ProcurementExecutionRegistration();
  const capabilityRegistration = procurementConstruction.createCapabilityRegistration({ ...options, now });
  const ports = capabilityRegistration.ports;
  const procurementRegistrations = capabilityRegistration.createRegistrations({ enabledCapabilityRefs: PROCUREMENT_ENABLED,
    manifests:Object.fromEntries(PROCUREMENT_ENABLED.map((ref)=>[ref,manifests[ref]])),
    ports:Object.fromEntries(PROCUREMENT_ENABLED.map((ref)=>[ref,ports[ref]])) });
  const sharedRegistrations = SHARED_ENABLED.map((capabilityRef)=>Object.freeze({ manifest:manifests[capabilityRef],
    executor:Object.freeze({version:1,execute:(context)=>ports[capabilityRef].execute(context)}),
    semanticValidator:Object.freeze({ref:manifests[capabilityRef].semanticValidatorRef,
      validateInputs:(context)=>ports[capabilityRef].validateInputs(context),
      validateResult:(context,outcome)=>ports[capabilityRef].validateResult(context,outcome)}) }));
  const registrations = Object.freeze([...procurementRegistrations,...sharedRegistrations]);
  const registry = createCapabilityRegistry({ registrations, expectedCapabilityRefs: ENABLED });
  const retryPolicies = [
    { ref: 'helix://foundation/retry/pure-observation/v1', effectClass: 'pure_observation', maxFailureAttempts: 3,
      backoffMs: [1000, 5000], retryableFailureClasses: ['integration', 'timeout'] },
    { ref: 'helix://foundation/retry/domain-fact-commit/v1', effectClass: 'domain_fact_commit', maxFailureAttempts: 1,
      backoffMs: [], retryableFailureClasses: [] },
  ];
  const timeoutPolicies = [{ ref: 'helix://foundation/timeout/field-observation/v1', timeoutMs: 3_600_000,
    minObservationCadenceMs: null, maxObservationElapsedMs: null, maxObservationCount: null }];
  const policyRegistry = createExecutionPolicyRegistry({ expectedCapabilityRefs: ENABLED, retryPolicies, timeoutPolicies,
    compensationContracts: [], capabilityBindings: ENABLED.map((capabilityRef) => ({ capabilityRef,
      effectClass: manifests[capabilityRef].effectClass,
      retryPolicyRef: manifests[capabilityRef].effectClass === 'pure_observation' ? retryPolicies[0].ref : retryPolicies[1].ref,
      timeoutPolicyRef: timeoutPolicies[0].ref, compensationContractRefs: [] })) });
  const executionProjectionProvider=Object.freeze({read:({processType,workKind})=>{
    if(processType==='material_field')return Object.freeze({priorityClass:'background_observation',localPriority:0,priorityRevision:1,supplyRole:'expansion'});
    if(workKind==='candidate_assembly')return Object.freeze({priorityClass:'normal_foreground',localPriority:200,priorityRevision:1,supplyRole:'completion'});
    if(workKind==='evidence_assessment')return Object.freeze({priorityClass:'normal_foreground',localPriority:100,priorityRevision:1,supplyRole:'expansion'});
    return Object.freeze({priorityClass:'normal_foreground',localPriority:0,priorityRevision:1,supplyRole:'expansion'});
  }});
  const supplyController = createWorkSupplyController({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork, now,
    executionProjectionProvider });
  let sequence = 0;
  const scheduler = createWorkScheduler({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork,
    supplyController, now, nextLeaseId: () => 'lease-' + (++sequence),
    priorityProjectionProvider: executionProjectionProvider });
  const mapper = createResourceProfileMapper({ profileKey: 'default', profileRevision: 1,
    logicalCpu: Math.max(1, os.cpus().length), integrations: [], volumes: [], encoders: [], aiDevices: [], workers: [] });
  const validatedVolumeKeys=new Set();
  const activeMapper=Object.freeze({profileKey:mapper.profileKey,profileRevision:mapper.profileRevision,capacityFor(resourceKey){
    if(resourceKey.startsWith('volume_read:'))return validatedVolumeKeys.has(resourceKey.slice('volume_read:'.length))?2:0;
    if(resourceKey.startsWith('volume_write:'))return validatedVolumeKeys.has(resourceKey.slice('volume_write:'.length))?1:0;
    if(resourceKey.startsWith('volume_mutation:'))return validatedVolumeKeys.has(resourceKey.slice('volume_mutation:'.length))?1:0;
    return mapper.capacityFor(resourceKey);
  }});
  const governor = createResourceGovernor({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork,
    profileProvider: { current: () => activeMapper }, now, nextPermitId: () => 'permit-' + (++sequence) });
  const breaker = createCircuitBreaker({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork });
  const realityVerifiers = Object.fromEntries(['workspace_write', 'external_request', 'domain_fact_commit',
    'responsibility_control_commit', 'material_commit', 'destructive_commit'].map((effectClass) => [effectClass,
    { verify: async ({ receipt }) => ({ verified: true, evidenceDigest: receipt.verificationEvidenceDigest }) }]));
  const effectJournal = createEffectJournal({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork,
    now, realityVerifiers });
  const workResultReader = createWorkResultReader(options);
  const processServices = procurementConstruction.createProcessServices({ ...options, now, workResultReader });
  const { triageReader, triageRuleRegistry: triageRegistry, progressReader, procurementAutomation, runCoordinator,
    evidenceIndex, candidateContextReader } = processServices;
  const planningRegistration = procurementConstruction.createPlanningRegistration({ registry, policyRegistry,
    contractValidator, progressReader, triageReader, triageRuleRegistry: triageRegistry, workResultReader,
    evidenceIndex, candidateContextReader, materialFieldStore: options.materialFieldStore, now });
  const bindingProjectionRegistry = createInputBindingProjectionRegistry({ registrations: planningRegistration.bindingProjections });
  const executionInputProvider = createEventExecutionInputProvider({ schemaManifest: options.schemaManifest,
    unitOfWork: options.unitOfWork, contractValidator, bindingProjectionRegistry, workResultReader });
  const attemptPolicy = createAttemptPolicyController({ registry: policyRegistry, now });
  const timeoutController = createTimeoutController({ now, isolation: {
    run: ({ operation }) => operation(), terminateAndIsolate: async () => {},
  } });
  const dispatcher = createExecutorDispatcher({ registry, contractValidator });
  const eventRuntime = createEventRuntime({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork,
    scheduler, governor, registry, dispatcher, effectJournal, attemptPolicy, timeoutController, circuitBreaker: breaker,
    executionInputProvider, whenEvaluator: { evaluate: () => 'run' },
    fenceValidator: { validate: ({ snapshot }) => {
      const fence = JSON.parse(snapshot.node.fence_basis_json); return { valid: true, digest: canonicalDigest(fence), snapshot: fence };
    } },
    resourceDemandResolver: { resolve: ({ snapshot,inputs }) => {const projection=executionProjectionProvider.read({
      ownerDomain:snapshot.work.owner_domain,processType:snapshot.work.process_type,processId:snapshot.work.process_id,workKind:snapshot.work.work_kind});
      const capability=snapshot.node.capability_ref;let resources=[];
      if(['procurement.field.observation.page.commit@1','shared.material.media.probe@1'].includes(capability)){
        const mountScopeId=findMountScopeId(inputs);if(!mountScopeId)throw new Error('P4_TYPED_VOLUME_RESOURCE_UNRESOLVED:'+capability);
        validatedVolumeKeys.add(mountScopeId);resources.push({resourceKey:'volume_read:'+mountScopeId,units:1});
      }
      if(['procurement.field.observation.page.commit@1','procurement.candidate.publish@1'].includes(capability)){
        resources.push({resourceKey:'sqlite_write',units:1});
      }
      if(resources.length===0)resources=[{resourceKey:'cpu_heavy',units:1}];
      return {eventId:snapshot.event.event_id,queueClass:projection.priorityClass,localPriority:projection.localPriority,
        priorityRevision:projection.priorityRevision,resources}; } },
    nextEventAttemptId: () => 'event-attempt-' + randomUUID(), nextExecutionId: () => 'execution-' + randomUUID(),
    nextResultId: () => 'event-result-' + randomUUID(), now });
  const plannerKinds = ['field_observation', 'evidence_assessment', 'candidate_assembly'];
  const plannerRegistry = createPlannerRegistry({ registrations: planningRegistration.planners.map((planner, index) => ({
    ownerDomain: 'procurement', workKind: plannerKinds[index], plannerContractRef: planner.plannerContractRef,
    plannerVersion: planner.plannerVersion, planner
  })) });
  const planPublisher = createWorkflowPlanPublisher({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork,
    registry, contractValidator, policyRegistry });
  const workLifecycle = createWorkLifecycle({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork,
    nextWorkAttemptId: (workId, ordinal) => workId + ':attempt:' + ordinal });
  const catalogDigest = executionCatalogDigest(registry, policyRegistry);
  const startupRecovery = createStartupRecovery({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork,
    registry, policyRegistry, integrityVerifier: { verify: () => ({ ok: true }) },
    catalogVerifier: { verify: (plan) => plan.catalog_digest === catalogDigest },
    effectReconciler: { reconcile: async () => ({ decision: 'terminal_failure' }) } });
  let host;
  const domainReconciler = { async reconcile(request) {
    if (request.ownerDomain !== 'procurement') return null;
    if(request.processType==='procurement_run'&&request.workAttemptState==='succeeded'){
      if(request.workKind==='evidence_assessment') evidenceIndex.invalidate(request.workId);
      runCoordinator.reconcile(request.processId);
      if(request.workKind==='evidence_assessment'){
        const structures=workResultReader.read(request.workId).filter((item)=>item.outcomeKind==='succeeded'&&
          item.resultSchemaRef==='helix://contracts/capabilities/procurement.triage.structure.inspect/v1/result');
        if(!structures.some((item)=>item.result.cursorOut===null))return {workId:request.workId,disposition:'replan'};
      }
      return {workId:request.workId,disposition:'succeeded'};
    }
    if(request.processType!=='material_field')return null;
    if (request.workAttemptState !== 'succeeded') return { workId: request.workId, disposition: 'failed' };
    const progress = progressReader.read(request.workId);
    if (!progress.completed) return { workId: request.workId, disposition: 'replan' };
    const field = options.materialFieldStore.getMaterialField(request.processId);
    const created=procurementAutomation.reconcileFromObservation(Object.freeze({ state:'succeeded', fieldId:request.processId,
      accessRevision:field.currentAccessRevision, terminalObservationRevision:progress.expectedObservationRevision,
      observationWorkId:request.workId }), request.changedMaterialKeys || []);
    for(const run of created.runs)runCoordinator.reconcile(run.procurementRunId);
    return { workId: request.workId, disposition: 'succeeded' };
  } };
  const cursorStore=createReconcileCursorStore({schemaManifest:options.schemaManifest,unitOfWork:options.unitOfWork,now});
  const fallbackReconciler=createDomainReconcileRunner({cursorStore,now,onError:options.onError,registrations:[Object.freeze({
    ownerDomain:'procurement',reconcilerKey:'active-procurement-runs',
    listPage:({cursor,limit})=>triageReader.listActiveRunPage(cursor,limit),
    reconcile:({procurementRunId})=>runCoordinator.reconcile(procurementRunId),
  })]});
  host = createExecutionRuntimeHost({ startupRecovery, scheduler, plannerRegistry, planPublisher, workLifecycle,
    eventRuntime, domainReconciler, fallbackReconciler, onError: options.onError,maxInFlightEvents:16 });
  return Object.freeze({ host, registry, policyRegistry, contractValidator, progressReader, procurementAutomation,triageReader,runCoordinator });
}

module.exports = Object.freeze({ createProcurementExecutionRuntime });
