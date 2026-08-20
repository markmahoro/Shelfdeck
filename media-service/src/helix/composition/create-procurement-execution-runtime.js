'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { computeBoundedMaterialFingerprint, computeBoundedMaterialFingerprintSync } = require('../integrations/bounded-material-fingerprint');
const { canonicalDigest } = require('../contracts/canonical-json');
const { createCapabilityContractValidator } = require('../foundation/capability/contract-validator');
const { createCapabilityRegistry } = require('../foundation/capability/capability-registry');
const { createExecutorDispatcher } = require('../foundation/capability/executor-dispatcher');
const { createCircuitBreaker } = require('../foundation/diagnostics/pressure-guard');
const { createEffectJournal } = require('../foundation/effects/effect-journal');
const { createEffectReconcilerRegistry } = require('../foundation/effects/effect-reconcilers');
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
const { createMaterialControlProjectionPort, controlScopeDigest } = require('../foundation/persistence/material-control');
const { createDomainReconcileRunner } = require('../foundation/execution/domain-reconcile-runner');
const { createWorkflowPlanPublisher, executionCatalogDigest } = require('../foundation/execution/workflow-plan');
const { PRE_PROJECTION_PLAN_REPLAN_CODE } = require('../foundation/persistence/uat-identity-selection-migration');
const { ProcurementExecutionRegistration } = require('../domains/procurement/public');
const { LibraExecutionRegistration } = require('../domains/libra/public');
const { PerceptionExecutionRegistration } = require('../domains/perception/public');
const { ArcaExecutionRegistration } = require('../domains/arca/public');

const PROCUREMENT_ENABLED = Object.freeze(['procurement.field.observation.page.commit@1',
  'procurement.triage.playability.inspect@1','procurement.triage.bdmv.assess@1','procurement.triage.structure.inspect@1',
  'procurement.triage.identity_claim.resolve@1','procurement.triage.primary_manifest.build@1','procurement.candidate.publish@1']);
const SHARED_ENABLED = Object.freeze(['shared.material.media.probe@1']);
const LIBRA_ENABLED = Object.freeze(['libra.intake.candidate.verify@1','libra.intake.material.verify@1',
  'libra.intake.binding.resolve@1','libra.intake.accept.commit@1','libra.intake.rejection.commit@1',
  'libra.routing.fact.observe@1','libra.product_identity.evidence.observe@1','libra.decision_basis.commit@1','libra.product_identity.resolve@1',
  'libra.product_metadata.fetch@1','libra.product_artifact.acquire@1','libra.product_sidecar.render@1',
  'shared.artifact.manifest.verify@1','libra.media_cast.resolve@1','libra.media_cast.commit@1',
  'libra.product_metadata.commit@1','libra.transcode.input.verify@1','libra.media.remux@1',
  'libra.media.transcode@1','libra.product_media.verify@1','libra.product_output.select@1',
  'libra.product.conformance.verify@1','libra.product_package.publish@1',
  'libra.external_material.query.prepare@1','libra.external_material.search@1',
  'libra.external_material.candidate.select@1','libra.external_material.acquire.request@1',
  'libra.external_material.acquire.observe@1','libra.external_material.output.resolve@1',
  'libra.external_material.stability.observe@1','libra.external_material.identity.verify@1',
  'libra.external_material.package.verify@1','libra.workspace.material.import@1']);
const PERCEPTION_ENABLED = Object.freeze(['perception.source.acquire@1','perception.record.normalize@1','perception.record.commit@1',
  'perception.dedup.resolve@1','perception.resolution.commit@1']);
const ARCA_ENABLED = Object.freeze(['arca.acceptance.identity.verify@1','arca.acceptance.metadata.verify@1',
  'arca.acceptance.structure.verify@1','arca.acceptance.mandatory_media.verify@1','arca.acceptance.space.verify@1',
  'arca.acceptance.inventory_feasibility.observe@1','arca.acceptance.accept.commit@1','arca.acceptance.rejection.commit@1',
  'arca.inventory.target_slot.prepare@1','arca.inventory.product.stage@1','arca.inventory.staged.verify@1',
  'arca.inventory.final_product.verify@1','arca.inventory.placement.switch@1','arca.ondeck.input_settlement.delete@1',
  'arca.ondeck.fulfillment.verify@1','arca.ondeck.commit@1',
  'arca.aftercare.custody.observe@1','arca.aftercare.presentation.observe@1',
  'arca.aftercare.conformance.observe@1','arca.aftercare.assessment.commit@1',
  'arca.aftercare.text_artifact.render@1','arca.aftercare.binary_artifact.acquire@1',
  'arca.aftercare.artifact.materialize@1','arca.aftercare.media.remux@1',
  'arca.aftercare.media.transcode@1','arca.aftercare.media.verify@1',
  'arca.aftercare.input_settlement.delete@1','arca.aftercare.inventory.commit@1',
  'arca.aftercare.case.commit@1','arca.aftercare.workspace.reclaim@1']);
const ARCA_OFFDECK_ENABLED=Object.freeze(['arca.offdeck.duplicate.detect@1','arca.offdeck.duplicate_group.commit@1','arca.offdeck.review_candidate.commit@1',
  'arca.offdeck.destruction_scope.verify@1','arca.offdeck.primary_material.delete@1',
  'arca.offdeck.related_reference.release@1','arca.offdeck.unreferenced_related.delete@1',
  'arca.offdeck.deletion.verify@1','arca.offdeck.terminal.commit@1']);
const ARCA_DEREGISTRATION_ENABLED=Object.freeze([
  'arca.shelf_deregistration.release_manifest.verify@1',
  'arca.shelf_deregistration.commit@1',
]);
const ARCA_ALL_ENABLED=Object.freeze([...ARCA_ENABLED,...ARCA_OFFDECK_ENABLED,...ARCA_DEREGISTRATION_ENABLED]);
const ENABLED = Object.freeze([...PROCUREMENT_ENABLED, ...SHARED_ENABLED, ...LIBRA_ENABLED, ...PERCEPTION_ENABLED,...ARCA_ALL_ENABLED]);
const UAT_SOURCE_EXECUTION_CATALOG_DIGEST = 'b0371a6d2793c1e381a4c2e7fc421d312a1a1e90d2de5e47f61a45022f09793b';
const PRE_PROJECTION_EXECUTION_CATALOG_DIGEST = '13315cdbdf6ab5cbe30b32075f89bd76ae1a873d84034dc572824f4fbc3886e6';
const TERMINAL_EVENT_STATES = new Set(['succeeded', 'skipped', 'failed', 'cancelled']);

function verifyStartupPlanCatalog(snapshot, currentCatalogDigest, registry, policyRegistry, bindingProjectionRegistry) {
  if (!snapshot || !snapshot.plan) return false;
  if (snapshot.plan.catalog_digest === currentCatalogDigest) return true;
  if (snapshot.plan.catalog_digest === PRE_PROJECTION_EXECUTION_CATALOG_DIGEST &&
      ['succeeded', 'failed', 'cancelled'].includes(snapshot.workAttempt?.state) &&
      Array.isArray(snapshot.events) && snapshot.events.every((event) => TERMINAL_EVENT_STATES.has(event.state))) return true;
  if (snapshot.plan.catalog_digest !== UAT_SOURCE_EXECUTION_CATALOG_DIGEST ||
      !snapshot.work || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.events) ||
      snapshot.nodes.length === 0 || snapshot.nodes.length !== snapshot.events.length) return false;
  const events = new Map();
  for (const event of snapshot.events) {
    const key = event.plan_id + '\0' + event.node_id;
    if (events.has(key)) return false;
    events.set(key, event);
  }
  try {
    for (const node of snapshot.nodes) {
      const event = events.get(node.plan_id + '\0' + node.node_id);
      if (!event || event.owner_domain !== snapshot.work.owner_domain ||
          event.capability_ref !== node.capability_ref) return false;
      const entry = registry.resolve(node.capability_ref, snapshot.work.owner_domain);
      if (entry.manifest.contractVersion !== node.contract_version ||
          entry.manifest.effectClass !== node.effect_class) return false;
      policyRegistry.bindingFor(node.capability_ref, node.effect_class);
      const bindingSet=JSON.parse(node.input_bindings_json);
      for(const binding of bindingSet.bindings||[]){
        if(binding.projectionRef)bindingProjectionRegistry.resolve(binding.projectionRef);
      }
    }
    return true;
  } catch (error) {
    return false;
  }
}

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
function findIntegrationId(value,seen=new Set()){
  if(!value||typeof value!=='object'||seen.has(value))return null;seen.add(value);
  if(typeof value.integrationId==='string'&&value.integrationId&&typeof value.allowedOperation==='string')return value.integrationId;
  for(const child of Array.isArray(value)?value:Object.values(value)){const found=findIntegrationId(child,seen);if(found)return found;}
  return null;
}
function findIntegrationHandle(value,seen=new Set()){
  if(!value||typeof value!=='object'||seen.has(value))return null;seen.add(value);
  if(typeof value.integrationId==='string'&&value.integrationId&&
      Number.isSafeInteger(value.configRevision)&&value.configRevision>0&&
      typeof value.allowedOperation==='string')return value;
  for(const child of Array.isArray(value)?value:Object.values(value)){const found=findIntegrationHandle(child,seen);if(found)return found;}
  return null;
}

function createProcurementExecutionRuntime(options) {
  const contractsRoot = options.contractsRoot || path.resolve(__dirname, '../contracts');
  const now = options.now || Date.now;
  const materialControlProjectionPort = createMaterialControlProjectionPort(options);
  const workResultReader = createWorkResultReader(options);
  const contractValidator = createCapabilityContractValidator({ schemas: collectSchemas(contractsRoot) });
  const manifests = Object.fromEntries(ENABLED.map((ref) => [ref, manifest(contractsRoot, ref)]));
  const procurementConstruction = ProcurementExecutionRegistration();
  const libraConstruction = LibraExecutionRegistration();
  const perceptionConstruction = PerceptionExecutionRegistration();
  const arcaConstruction = ArcaExecutionRegistration();
  const perceptionOptions=Object.freeze({...options,
    acquirePerceptionProvider:options.acquirePerceptionProvider||(async()=>{throw new Error('Perception Provider adapter is unavailable.');}),
    readPerceptionObservation:options.readPerceptionObservation||(async()=>{throw new Error('Perception Observation reader is unavailable.');}),
    targetProjectionReader:options.targetProjectionReader||(()=>null),readDoubanSourceConfiguration:options.readDoubanSourceConfiguration||(()=>null),
    resolvePerceptionIntegrationHandle:options.resolvePerceptionIntegrationHandle||(()=>undefined)});
  const libraOptions = Object.freeze({ ...options,
    readArcaRoutingTargets: options.readArcaRoutingTargets || (() => Object.freeze([])),
    readArcaShelfStandard: options.readArcaShelfStandard || (() => null),
    readRelatedNfo: options.readRelatedNfo || (async () => { throw new Error('Routing NFO adapter is unavailable.'); }),
    observeRoutingProvider: options.observeRoutingProvider || (async () => { throw new Error('Routing Provider adapter is unavailable.'); }),
    resolveRoutingIntegrationHandle: options.resolveRoutingIntegrationHandle || (() => undefined),
    resolveExternalMaterialIntegrationHandle: options.resolveExternalMaterialIntegrationHandle || (() => undefined),
    readExternalMaterialLandingBinding: options.readExternalMaterialLandingBinding || (() => undefined),
    executeExternalProvider: options.executeExternalProvider ||
      (async () => { throw new Error('External Material Provider adapter is unavailable.'); }),
    productProductionPort: options.productProductionPort,
    mediaEffectPort: options.mediaEffectPort });
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
  const libraCapabilityRegistration=libraConstruction.createCapabilityRegistration({...libraOptions,now,workResultReader,
    computeFingerprint:options.computeFingerprint || computeBoundedMaterialFingerprint});
  const libraRegistrations=libraCapabilityRegistration.createRegistrations({enabledCapabilityRefs:LIBRA_ENABLED,
    manifests:Object.fromEntries(LIBRA_ENABLED.map((ref)=>[ref,manifests[ref]]))});
  const perceptionCapabilityRegistration=perceptionConstruction.createCapabilityRegistration({...perceptionOptions,now});
  const perceptionRegistrations=perceptionCapabilityRegistration.createRegistrations({manifests:Object.fromEntries(PERCEPTION_ENABLED.map((ref)=>[ref,manifests[ref]]))});
  const arcaCapabilityRegistration=arcaConstruction.createCapabilityRegistration({...options,now,workResultReader,
    computeBoundedMaterialFingerprintSync});
  const arcaRegistrations=arcaCapabilityRegistration.createRegistrations({enabledCapabilityRefs:ARCA_ALL_ENABLED,
    manifests:Object.fromEntries(ARCA_ALL_ENABLED.map((ref)=>[ref,manifests[ref]]))});
  const registrations = Object.freeze([...procurementRegistrations,...sharedRegistrations,...libraRegistrations,...perceptionRegistrations,...arcaRegistrations]);
  const registry = createCapabilityRegistry({ registrations, expectedCapabilityRefs: ENABLED });
  const retryPolicies = [
    { ref: 'helix://foundation/retry/pure-observation/v1', effectClass: 'pure_observation', maxFailureAttempts: 3,
      backoffMs: [1000, 5000], retryableFailureClasses: ['integration', 'timeout'] },
    { ref: 'helix://foundation/retry/domain-fact-commit/v1', effectClass: 'domain_fact_commit', maxFailureAttempts: 1,
      backoffMs: [], retryableFailureClasses: [] },
    { ref: 'helix://foundation/retry/responsibility-control-commit/v1', effectClass: 'responsibility_control_commit', maxFailureAttempts: 1,
      backoffMs: [], retryableFailureClasses: [] },
    { ref: 'helix://foundation/retry/workspace-write/v1', effectClass: 'workspace_write', maxFailureAttempts: 1,
      backoffMs: [], retryableFailureClasses: [] },
    { ref: 'helix://foundation/retry/external-request/v1', effectClass: 'external_request', maxFailureAttempts: 1,
      backoffMs: [], retryableFailureClasses: [] },
    { ref: 'helix://foundation/retry/material-commit/v1', effectClass: 'material_commit', maxFailureAttempts: 1,
      backoffMs: [], retryableFailureClasses: [] },
    { ref: 'helix://foundation/retry/destructive-commit/v1', effectClass: 'destructive_commit', maxFailureAttempts: 1,
      backoffMs: [], retryableFailureClasses: [] },
  ];
  const timeoutPolicies = [
    { ref: 'helix://foundation/timeout/field-observation/v1', timeoutMs: 3_600_000,
      minObservationCadenceMs: null, maxObservationElapsedMs: null, maxObservationCount: null },
    { ref: 'helix://foundation/timeout/short-deferred-observation/v1', timeoutMs: 1_800_000,
      minObservationCadenceMs: 5_000, maxObservationElapsedMs: 300_000, maxObservationCount: 16 },
    { ref: 'helix://foundation/timeout/external-job-observation/v1', timeoutMs: 1_800_000,
      minObservationCadenceMs: 15_000, maxObservationElapsedMs: 86_400_000, maxObservationCount: 1_024 },
  ];
  const timeoutPolicyFor = (capabilityRef) => capabilityRef ===
    'libra.external_material.acquire.observe@1'
    ? timeoutPolicies[2].ref
    : capabilityRef === 'libra.external_material.stability.observe@1'
      ? timeoutPolicies[1].ref
      : timeoutPolicies[0].ref;
  const policyRegistry = createExecutionPolicyRegistry({ expectedCapabilityRefs: ENABLED, retryPolicies, timeoutPolicies,
    compensationContracts: [], capabilityBindings: ENABLED.map((capabilityRef) => ({ capabilityRef,
      effectClass: manifests[capabilityRef].effectClass,
      retryPolicyRef: manifests[capabilityRef].effectClass === 'pure_observation' ? retryPolicies[0].ref :
          manifests[capabilityRef].effectClass === 'responsibility_control_commit' ? retryPolicies[2].ref :
          manifests[capabilityRef].effectClass === 'workspace_write' ? retryPolicies[3].ref :
          manifests[capabilityRef].effectClass === 'external_request' ? retryPolicies[4].ref :
          manifests[capabilityRef].effectClass === 'material_commit' ? retryPolicies[5].ref :
          manifests[capabilityRef].effectClass === 'destructive_commit' ? retryPolicies[6].ref : retryPolicies[1].ref,
      timeoutPolicyRef: timeoutPolicyFor(capabilityRef), compensationContractRefs: [] })) });
  let libraProcessServices;
  const executionProjectionProvider=Object.freeze({read:({processType,processId,workKind})=>{
    if(processType==='libra_run'){
      if(!libraProcessServices?.libraRunExecutionProjection)
        throw new Error('Libra Run Execution Projection is unavailable.');
      return libraProcessServices.libraRunExecutionProjection.read({processId,workKind});
    }
    if(processType==='libra_intake')return Object.freeze({priorityClass:'handoff_acceptance',localPriority:300,priorityRevision:1,supplyRole:'completion'});
    if(processType==='libra_routing')return Object.freeze({priorityClass:'normal_foreground',localPriority:250,priorityRevision:1,supplyRole:'completion'});
    if(processType==='perception_acquisition'||processType==='perception_resolution')return Object.freeze({priorityClass:'normal_foreground',localPriority:240,priorityRevision:1,supplyRole:'completion'});
    if(processType==='arca_acceptance')return Object.freeze({priorityClass:'handoff_acceptance',localPriority:400,priorityRevision:1,supplyRole:'completion'});
    if(processType==='arca_ondeck_run')return Object.freeze({priorityClass:'normal_foreground',localPriority:300,priorityRevision:1,supplyRole:'completion'});
    if(processType==='arca_offdeck_case')return Object.freeze({priorityClass:'safety_liveness',localPriority:500,priorityRevision:1,supplyRole:'completion'});
    if(processType==='arca_shelf_deregistration')return Object.freeze({priorityClass:'normal_foreground',localPriority:350,priorityRevision:1,supplyRole:'completion'});
    if(processType==='arca_offdeck_automation')return Object.freeze({priorityClass:'normal_foreground',localPriority:100,priorityRevision:1,supplyRole:'completion'});
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
  const validatedVolumeKeys=new Set(),validatedIntegrationKeys=new Set(),validatedEncoderSlots=new Map();
  const activeMapper=Object.freeze({profileKey:mapper.profileKey,profileRevision:mapper.profileRevision,capacityFor(resourceKey){
    if(resourceKey.startsWith('volume_read:'))return validatedVolumeKeys.has(resourceKey.slice('volume_read:'.length))?2:0;
    if(resourceKey.startsWith('volume_write:'))return validatedVolumeKeys.has(resourceKey.slice('volume_write:'.length))?1:0;
    if(resourceKey.startsWith('volume_mutation:'))return validatedVolumeKeys.has(resourceKey.slice('volume_mutation:'.length))?1:0;
    if(resourceKey.startsWith('integration:'))return validatedIntegrationKeys.has(resourceKey.slice('integration:'.length))?4:0;
    if(resourceKey.startsWith('encoder:')){
      const slots=validatedEncoderSlots.get(resourceKey.slice('encoder:'.length))||0;
      return slots<1?0:(mapper.profileKey==='full'?Math.min(2,slots):1);
    }
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
  function recoveryReality(effectClass) {
    const observed = (context) => effectJournal.observeRecovery(context.effect.effect_id);
    if (effectClass === 'workspace_write') return { async observe(context) {
      const value = observed(context), committed = value.markers.length === 1;
      return { status: committed ? 'matching' : 'absent', evidenceDigest: canonicalDigest(value), cleanupDeclared: false };
    } };
    if (effectClass === 'external_request') return { async observe(context) {
      const value = observed(context), committed = value.markers.length === 1;
      return { status: committed ? 'committed' : (value.effect.external_receipt_ref ? 'pending' : 'absent'), evidenceDigest: canonicalDigest(value) };
    } };
    if (effectClass === 'domain_fact_commit') return { async observe(context) {
      const value = observed(context), committed = value.markers.length === 1;
      return { status: committed ? 'committed' : 'absent', revisionMatches: committed, fenceValid: true, evidenceDigest: canonicalDigest(value) };
    } };
    if (effectClass === 'responsibility_control_commit') return { async observe(context) {
      const value = observed(context), committed = value.markers.length === 1;
      return { status: committed ? 'whole_established' : 'whole_absent', fenceValid: true, evidenceDigest: canonicalDigest(value) };
    } };
    if (effectClass === 'material_commit') return { async observe(context) {
      const value = observed(context), committed = value.markers.length === 1;
      return { status: committed ? 'committed' : 'forward_required', rollbackDeclared: false, evidenceDigest: canonicalDigest(value) };
    } };
    return { async observe(context) {
      const value = observed(context), committed = value.markers.length === 1;
      return { status: committed ? 'complete' : 'remaining', evidenceDigest: canonicalDigest(value) };
    } };
  }
  const effectReconciler = createEffectReconcilerRegistry({ observers: Object.freeze(Object.fromEntries([
    'workspace_write', 'external_request', 'domain_fact_commit', 'responsibility_control_commit', 'material_commit', 'destructive_commit'
  ].map((effectClass) => [effectClass, recoveryReality(effectClass)]))) });
  const processServices = procurementConstruction.createProcessServices({ ...options, now, workResultReader });
  const { triageReader, triageRuleRegistry: triageRegistry, progressReader, procurementAutomation, runCoordinator,
    evidenceIndex, candidateContextReader } = processServices;
  const planningRegistration = procurementConstruction.createPlanningRegistration({ registry, policyRegistry,
    contractValidator, progressReader, triageReader, triageRuleRegistry: triageRegistry, workResultReader,
    evidenceIndex, candidateContextReader, materialFieldStore: options.materialFieldStore, now });
  let perceptionProcessServices;
  const workLifecycle = createWorkLifecycle({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork,
    nextWorkAttemptId: (workId, ordinal) => workId + ':attempt:' + ordinal });
  libraProcessServices=libraConstruction.createProcessServices({...libraOptions,now,workResultReader,
    cancelProcessWorks:(scope)=>workLifecycle.cancelProcess(scope),
    resolveRetryPolicyDigest:(capabilityRef)=>canonicalDigest(
      policyRegistry.retryFor(capabilityRef,manifests[capabilityRef].effectClass)),
    movieProductionReader:libraCapabilityRegistration.movieProductionReader,
    offerReader:libraCapabilityRegistration.offerReader,readArcaShelfStandard:libraOptions.readArcaShelfStandard,
    resolvePerceptionRating:(subjectId)=>perceptionProcessServices?.resolveDecisionFact({targetType:'subject',targetId:subjectId})||Object.freeze({kind:'pending'})});
  const libraPlanningRegistration=libraConstruction.createPlanningRegistration({registry,policyRegistry,contractValidator,
    workResultReader,offerReader:libraProcessServices.offerReader,decisionResolver:libraProcessServices.decisionResolver,
    contextReader:libraProcessServices.routingContextReader,acceptanceSpecContextReader:libraProcessServices.acceptanceSpecContextReader,
    resolveRoutingIntegrationHandle:libraOptions.resolveRoutingIntegrationHandle,
    resolveExternalMaterialIntegrationHandle:libraOptions.resolveExternalMaterialIntegrationHandle,
    movieProductionReader:libraProcessServices.movieProductionReader,routingContextReader:libraProcessServices.routingContextReader,
    productIdentitySelection:libraProcessServices.productIdentitySelection,
    productProductionPort:libraOptions.productProductionPort,workspaceProductPort:libraOptions.workspaceProductPort,
    platformComputeRuntime:libraOptions.platformComputeRuntime,now});
  perceptionProcessServices=perceptionConstruction.createProcessServices({...perceptionOptions,now,workResultReader});
  const perceptionPlanningRegistration=perceptionConstruction.createPlanningRegistration({registry,policyRegistry,contractValidator,
    workResultReader,processServices:perceptionProcessServices,resolvePerceptionIntegrationHandle:options.resolvePerceptionIntegrationHandle,now});
  const arcaProcessServices=arcaConstruction.createProcessServices({...options,now,workResultReader,
    cancelProcessWorks:(scope)=>workLifecycle.cancelProcess(scope),
    contextReader:arcaCapabilityRegistration.contextReader,
    offdeckContextReader:arcaCapabilityRegistration.offdeckContextReader,
    shelfDeregistrationContextReader:arcaCapabilityRegistration.shelfDeregistrationContextReader,
    readPerceptionRating:(shelfEntryId)=>perceptionProcessServices.readCurrentRating('shelf_entry',shelfEntryId),
    readPerceptionRatings:(shelfEntryIds)=>perceptionProcessServices.readCurrentRatings('shelf_entry',shelfEntryIds)});
  const arcaPlanningRegistration=arcaConstruction.createPlanningRegistration({...options,registry,policyRegistry,contractValidator,workResultReader,
    contextReader:arcaProcessServices.contextReader,offdeckContextReader:arcaProcessServices.offdeckContextReader,
    shelfDeregistrationContextReader:arcaProcessServices.shelfDeregistrationContextReader,
    materialControlProjectionPort,controlScopeDigest,now});
  const bindingProjectionRegistry = createInputBindingProjectionRegistry({ registrations:[...planningRegistration.bindingProjections,
    ...libraPlanningRegistration.bindingProjections,...perceptionPlanningRegistration.bindingProjections,
    ...arcaPlanningRegistration.bindingProjections] });
  const executionInputProvider = createEventExecutionInputProvider({ schemaManifest: options.schemaManifest,
    unitOfWork: options.unitOfWork, contractValidator, bindingProjectionRegistry, workResultReader });
  const attemptPolicy = createAttemptPolicyController({ registry: policyRegistry, now });
  const timeoutController = createTimeoutController({ now, isolation: {
    run: ({ operation }) => operation(), terminateAndIsolate: async () => {},
  } });
  const dispatcher = createExecutorDispatcher({ registry, contractValidator });
  const eventRuntime = createEventRuntime({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork,
    scheduler, governor, registry, dispatcher, effectJournal, attemptPolicy, timeoutController, circuitBreaker: breaker,
    onProgress: (sample) => { if(sample.ownerDomain==='libra'&&sample.processType==='libra_run')options.onFormationRunChanged?.(sample.processId); },
    executionInputProvider, whenEvaluator: { evaluate: () => 'run' },
    fenceValidator: { validate: ({ snapshot }) => {
      const fence = JSON.parse(snapshot.node.fence_basis_json); return { valid: true, digest: canonicalDigest(fence), snapshot: fence };
    } },
    resourceDemandResolver: { resolve: ({ snapshot,inputs }) => {const projection=executionProjectionProvider.read({
      ownerDomain:snapshot.work.owner_domain,processType:snapshot.work.process_type,processId:snapshot.work.process_id,workKind:snapshot.work.work_kind});
      const capability=snapshot.node.capability_ref;let resources=[];
      if(['procurement.field.observation.page.commit@1','shared.material.media.probe@1','procurement.triage.bdmv.assess@1',
        'libra.intake.material.verify@1'].includes(capability)){
        const mountScopeId=findMountScopeId(inputs);if(!mountScopeId)throw new Error('P4_TYPED_VOLUME_RESOURCE_UNRESOLVED:'+capability);
        validatedVolumeKeys.add(mountScopeId);resources.push({resourceKey:'volume_read:'+mountScopeId,units:1});
      }
      if(capability==='libra.routing.fact.observe@1'||capability==='libra.product_identity.evidence.observe@1'){
        const mountScopeId=findMountScopeId(inputs),integrationId=findIntegrationId(inputs);
        if(mountScopeId){validatedVolumeKeys.add(mountScopeId);resources.push({resourceKey:'volume_read:'+mountScopeId,units:1});}
        else if(integrationId){validatedIntegrationKeys.add(integrationId);resources.push({resourceKey:'integration:'+integrationId,units:1});}
        else throw new Error('P4_TYPED_ROUTING_RESOURCE_UNRESOLVED');
      }
      if(capability==='libra.product_metadata.fetch@1'){
        const mountScopeId=findMountScopeId(inputs),integrationId=findIntegrationId(inputs);
        if(mountScopeId){validatedVolumeKeys.add(mountScopeId);resources.push({resourceKey:'volume_read:'+mountScopeId,units:1});}
        else if(integrationId){validatedIntegrationKeys.add(integrationId);resources.push({resourceKey:'integration:'+integrationId,units:1});}
        else throw new Error('P4_TYPED_PRODUCT_METADATA_RESOURCE_UNRESOLVED');
      }
      if(capability==='libra.product_artifact.acquire@1'){
        const integrationId=findIntegrationId(inputs),workspaceRoot=libraOptions.workspaceProductPort.rootSnapshot();
        if(!integrationId)throw new Error('P4_TYPED_PRODUCT_ARTIFACT_INTEGRATION_UNRESOLVED');
        validatedIntegrationKeys.add(integrationId);validatedVolumeKeys.add(workspaceRoot.mountScopeId);
        resources.push({resourceKey:'integration:'+integrationId,units:1},{resourceKey:'volume_write:'+workspaceRoot.mountScopeId,units:1},
          {resourceKey:'sqlite_write',units:1});
      }
      if(capability==='libra.product_sidecar.render@1'){
        const workspaceRoot=libraOptions.workspaceProductPort.rootSnapshot();validatedVolumeKeys.add(workspaceRoot.mountScopeId);
        resources.push({resourceKey:'volume_write:'+workspaceRoot.mountScopeId,units:1},{resourceKey:'sqlite_write',units:1});
      }
      if(capability==='shared.artifact.manifest.verify@1'){
        const workspaceRoot=libraOptions.workspaceProductPort.rootSnapshot();validatedVolumeKeys.add(workspaceRoot.mountScopeId);
        resources.push({resourceKey:'volume_read:'+workspaceRoot.mountScopeId,units:1});
      }
      if(capability==='libra.transcode.input.verify@1'||capability==='libra.product_media.verify@1'){
        const mountScopeId=findMountScopeId(inputs);if(!mountScopeId)throw new Error('P4_TYPED_MEDIA_VOLUME_UNRESOLVED:'+capability);
        validatedVolumeKeys.add(mountScopeId);resources.push({resourceKey:'volume_read:'+mountScopeId,units:1});
      }
      if(capability==='libra.media.remux@1'){
        const sourceRef=inputs.namedInputs?.productionSourceScopeReference,workspaceRoot=libraOptions.workspaceProductPort.rootSnapshot();
        const sourceSnapshot=sourceRef?.libraRunId?libraProcessServices.movieProductionReader.readRunSnapshot(sourceRef.libraRunId):null;
        const sourceMounts=[...new Set((sourceSnapshot?.members||[]).map((item)=>item.physicalIdentity?.mountScopeId).filter(Boolean))].sort();
        if(!sourceMounts.length)throw new Error('P4_TYPED_REMUX_SOURCE_UNRESOLVED');
        sourceMounts.forEach((item)=>validatedVolumeKeys.add(item));validatedVolumeKeys.add(workspaceRoot.mountScopeId);
        resources.push(...sourceMounts.map((item)=>({resourceKey:'volume_read:'+item,units:1})),
          {resourceKey:'volume_write:'+workspaceRoot.mountScopeId,units:1});
      }
      if(capability==='libra.media.transcode@1'){
        const named=inputs.namedInputs||{};
        const sourceMount=findMountScopeId(named.materialHandle),workspaceRoot=libraOptions.workspaceProductPort.rootSnapshot();
        const device=named.mediaExecutionDeviceSnapshot;
        const slots=device?.capabilityPayload?.validatedConcurrentSlots;
        if(!sourceMount||!device?.deviceId||!Number.isSafeInteger(slots)||slots<1)
          throw new Error('P4_TYPED_TRANSCODE_RESOURCE_UNRESOLVED');
        validatedEncoderSlots.set(device.deviceId,slots);
        validatedVolumeKeys.add(sourceMount);validatedVolumeKeys.add(workspaceRoot.mountScopeId);
        resources.push({resourceKey:'volume_read:'+sourceMount,units:1},{resourceKey:'volume_write:'+workspaceRoot.mountScopeId,units:1},
          {resourceKey:'encoder:'+device.deviceId,units:1});
        if(device.deviceClass==='software_cpu')resources.push({resourceKey:'cpu_heavy',units:1});
      }
      if(capability==='perception.source.acquire@1'){
        const integrationId=findIntegrationId(inputs);if(!integrationId)throw new Error('P4_TYPED_PERCEPTION_RESOURCE_UNRESOLVED');
        validatedIntegrationKeys.add(integrationId);resources.push({resourceKey:'integration:'+integrationId,units:1});
      }
      if(['libra.external_material.search@1','libra.external_material.acquire.request@1',
        'libra.external_material.acquire.observe@1','libra.external_material.stability.observe@1'].includes(capability)){
        const integrationId=findIntegrationId(inputs);if(!integrationId)throw new Error('P4_TYPED_EXTERNAL_INTEGRATION_UNRESOLVED');
        validatedIntegrationKeys.add(integrationId);resources.push({resourceKey:'integration:'+integrationId,units:1});
        if(['libra.external_material.acquire.observe@1','libra.external_material.stability.observe@1'].includes(capability)){
          const handle=findIntegrationHandle(inputs),binding=handle&&libraOptions.readExternalMaterialLandingBinding({
            integrationId:handle.integrationId,configRevision:handle.configRevision,
          });
          if(!binding?.mountScopeId)throw new Error('P4_TYPED_EXTERNAL_LANDING_VOLUME_UNRESOLVED');
          validatedVolumeKeys.add(binding.mountScopeId);
          resources.push({resourceKey:'volume_read:'+binding.mountScopeId,units:1});
        }
      }
      if(capability==='libra.workspace.material.import@1'){
        const landingMount=inputs.namedInputs?.stableEvidence
            ?.stableExternalMaterialHandle?.landingBinding?.mountScopeId,
          workspaceRoot=libraOptions.workspaceProductPort.rootSnapshot();
        if(!landingMount)throw new Error('P4_TYPED_EXTERNAL_IMPORT_SOURCE_UNRESOLVED');
        validatedVolumeKeys.add(landingMount);validatedVolumeKeys.add(workspaceRoot.mountScopeId);
        resources.push({resourceKey:'volume_read:'+landingMount,units:1},
          {resourceKey:'volume_write:'+workspaceRoot.mountScopeId,units:1},
          {resourceKey:'sqlite_write',units:1});
      }
      if(capability.startsWith('arca.')){
        if(capability==='arca.shelf_deregistration.release_manifest.verify@1')resources.push({resourceKey:'control_plane',units:1});
        else if(capability==='arca.shelf_deregistration.commit@1')resources.push({resourceKey:'sqlite_write',units:1},{resourceKey:'control_commit',units:1});
        else {
        const refs=workResultReader.readBindings(snapshot.work.work_id).flatMap((item)=>item.inputBindings?.bindings||[])
          .find((item)=>Array.isArray(item.parameters?.dependencyRefs))?.parameters.dependencyRefs||[];
        const isAftercare=snapshot.work.process_type==='arca_shelf_entry',isOffdeck=snapshot.work.process_type==='arca_offdeck_case',isOffdeckAutomation=snapshot.work.process_type==='arca_offdeck_automation';
        const arcaContext=isOffdeckAutomation?null:isOffdeck?arcaProcessServices.offdeckContextReader.read(snapshot.work.process_id):isAftercare
          ?arcaProcessServices.aftercareContextReader.read(snapshot.work.process_id)
          :snapshot.work.process_type==='arca_ondeck_run'
            ?arcaProcessServices.contextReader.readAccepted(snapshot.work.process_id,refs)
            :arcaProcessServices.contextReader.readOffer(refs);
        const targetMount=isOffdeckAutomation?null:isOffdeck?arcaContext.snapshot.shelf.target_mount_scope_id:isAftercare?arcaContext.raw.shelf.target_mount_scope_id:arcaContext.shelf.target.mountScopeId;
        if(targetMount)validatedVolumeKeys.add(targetMount);
        if(['arca.acceptance.inventory_feasibility.observe@1','arca.inventory.target_slot.prepare@1',
          'arca.inventory.product.stage@1'].includes(capability))resources.push({resourceKey:'volume_write:'+targetMount,units:1});
        if(['arca.inventory.staged.verify@1','arca.inventory.final_product.verify@1',
          'arca.ondeck.fulfillment.verify@1'].includes(capability))resources.push({resourceKey:'volume_read:'+targetMount,units:1});
        if(capability==='arca.inventory.placement.switch@1')resources.push({resourceKey:'volume_mutation:'+targetMount,units:1});
        if(capability==='arca.ondeck.input_settlement.delete@1'){
          const sourceMounts=[...new Set([...(arcaContext.packageValue.productMaterialManifest?.members||[]),
            ...(arcaContext.packageValue.offloadContextManifest?.members||[])].map((item)=>item.physicalIdentity?.mountScopeId).filter(Boolean))];
          sourceMounts.forEach((item)=>{validatedVolumeKeys.add(item);resources.push({resourceKey:'volume_mutation:'+item,units:1});});
        }
        if(['arca.acceptance.accept.commit@1','arca.acceptance.rejection.commit@1','arca.ondeck.commit@1'].includes(capability))
          resources.push({resourceKey:'sqlite_write',units:1});
        if(['arca.aftercare.custody.observe@1','arca.aftercare.presentation.observe@1',
          'arca.aftercare.conformance.observe@1'].includes(capability))resources.push({resourceKey:'volume_read:'+targetMount,units:1});
        if(capability==='arca.aftercare.conformance.observe@1')resources.push({resourceKey:'cpu_heavy',units:1});
        if(['arca.aftercare.text_artifact.render@1','arca.aftercare.media.remux@1',
          'arca.aftercare.media.transcode@1'].includes(capability)){
          validatedVolumeKeys.add('aftercare_workspace_local');resources.push({resourceKey:'volume_write:aftercare_workspace_local',units:1});
          if(capability!=='arca.aftercare.text_artifact.render@1')resources.push({resourceKey:'volume_read:'+targetMount,units:1});
          if(capability==='arca.aftercare.media.transcode@1'){
            const device=inputs.namedInputs?.aftercareMediaRepairStrategy?.selectedDeviceSnapshot,slots=device?.capabilityPayload?.validatedConcurrentSlots;
            if(!device?.deviceId||!Number.isSafeInteger(slots)||slots<1)throw new Error('P4_TYPED_AFTERCARE_TRANSCODE_DEVICE_UNRESOLVED');
            validatedEncoderSlots.set(device.deviceId,slots);resources.push({resourceKey:'encoder:'+device.deviceId,units:1});
            if(device.deviceClass==='software_cpu')resources.push({resourceKey:'cpu_heavy',units:1});
          }
        }
        if(capability==='arca.aftercare.binary_artifact.acquire@1'){
          const integrationId=findIntegrationId(inputs);if(!integrationId)throw new Error('P4_TYPED_AFTERCARE_INTEGRATION_UNRESOLVED');
          validatedIntegrationKeys.add(integrationId);resources.push({resourceKey:'integration:'+integrationId,units:1},{resourceKey:'volume_write:aftercare_workspace_local',units:1});validatedVolumeKeys.add('aftercare_workspace_local');
        }
        if(capability==='arca.aftercare.artifact.materialize@1')resources.push({resourceKey:'volume_mutation:'+targetMount,units:1});
        if(capability==='arca.aftercare.media.verify@1')resources.push({resourceKey:'volume_read:aftercare_workspace_local',units:1});
        if(capability==='arca.aftercare.input_settlement.delete@1')resources.push({resourceKey:'volume_mutation:'+targetMount,units:1});
        if(capability==='arca.aftercare.workspace.reclaim@1')resources.push({resourceKey:'volume_mutation:aftercare_workspace_local',units:1});
        if(['arca.aftercare.assessment.commit@1','arca.aftercare.inventory.commit@1','arca.aftercare.case.commit@1'].includes(capability))
          resources.push({resourceKey:'sqlite_write',units:1});
        if(['arca.offdeck.primary_material.delete@1','arca.offdeck.unreferenced_related.delete@1'].includes(capability))
          resources.push({resourceKey:'volume_mutation:'+targetMount,units:1});
        if(['arca.offdeck.destruction_scope.verify@1','arca.offdeck.deletion.verify@1'].includes(capability))
          resources.push({resourceKey:'volume_read:'+targetMount,units:1});
        if(['arca.offdeck.related_reference.release@1','arca.offdeck.terminal.commit@1'].includes(capability))
          resources.push({resourceKey:'sqlite_write',units:1});
        if(capability==='arca.offdeck.duplicate.detect@1')resources.push({resourceKey:'cpu_heavy',units:1});
        if(['arca.offdeck.duplicate_group.commit@1','arca.offdeck.review_candidate.commit@1'].includes(capability))resources.push({resourceKey:'sqlite_write',units:1});
        }
      }
      if(capability === 'procurement.triage.bdmv.assess@1') resources.push({resourceKey:'cpu_heavy',units:1});
      if(['procurement.field.observation.page.commit@1','procurement.candidate.publish@1','libra.intake.accept.commit@1',
        'libra.intake.rejection.commit@1','libra.decision_basis.commit@1','libra.product_identity.resolve@1',
        'libra.media_cast.commit@1','libra.product_metadata.commit@1','libra.product_package.publish@1'].includes(capability)){
        resources.push({resourceKey:'sqlite_write',units:1});
      }
      if(['perception.record.commit@1','perception.resolution.commit@1'].includes(capability))resources.push({resourceKey:'sqlite_write',units:1});
      if(resources.length===0)resources=[{resourceKey:'cpu_heavy',units:1}];
      return {eventId:snapshot.event.event_id,queueClass:projection.priorityClass,localPriority:projection.localPriority,
        priorityRevision:projection.priorityRevision,resources}; } },
    nextEventAttemptId: () => 'event-attempt-' + randomUUID(), nextExecutionId: () => 'execution-' + randomUUID(),
    nextResultId: () => 'event-result-' + randomUUID(), now });
  const plannerKinds = ['field_observation', 'evidence_assessment', 'candidate_assembly'];
  const libraPlannerKinds=['evidence','acceptance','rejection','routing_nfo_facts','routing_provider_facts','routing_basis','acceptance_spec_basis',
    'product_identity','product_metadata_observation','artifact_production','product_fact_assembly','workspace_media_production',
    'product_conformance','deliverable_promotion'];
  const perceptionPlannerKinds=['acquisition_page','resolution'];
  const arcaPlannerKinds=['acceptance_assessment','acceptance_commit','acceptance_rejection','on_deck_execution','health_assessment','custody_assessment','care_repair_prepare','care_repair_commit','care_case_closure','care_deregistration_settlement','offdeck_policy_evaluation','offdeck_duplicate_detection','offdeck_scope_verification','offdeck_material_destruction','offdeck_terminal_commit','shelf_deregistration_manifest_verify','shelf_deregistration_commit'];
  const plannerRegistry = createPlannerRegistry({ registrations: [...planningRegistration.planners.map((planner, index) => ({
    ownerDomain: 'procurement', workKind: plannerKinds[index], plannerContractRef: planner.plannerContractRef,
    plannerVersion: planner.plannerVersion, planner
  })),...libraPlanningRegistration.planners.map((planner,index)=>({ownerDomain:'libra',workKind:libraPlannerKinds[index],
    plannerContractRef:planner.plannerContractRef,plannerVersion:planner.plannerVersion,planner})),...perceptionPlanningRegistration.planners.map((planner,index)=>({ownerDomain:'perception',workKind:perceptionPlannerKinds[index],
    plannerContractRef:planner.plannerContractRef,plannerVersion:planner.plannerVersion,planner})),...arcaPlanningRegistration.planners.map((planner,index)=>({ownerDomain:'arca',workKind:arcaPlannerKinds[index],
    plannerContractRef:planner.plannerContractRef,plannerVersion:planner.plannerVersion,planner}))] });
  const planPublisher = createWorkflowPlanPublisher({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork,
    registry, contractValidator, policyRegistry });
  const catalogDigest = executionCatalogDigest(registry, policyRegistry);
  const startupRecovery = createStartupRecovery({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork,
    registry, policyRegistry, integrityVerifier: { verify: () => ({ ok: true }) },
    catalogVerifier: { verify: (snapshot) => verifyStartupPlanCatalog(
      snapshot, catalogDigest, registry, policyRegistry, bindingProjectionRegistry,
    ) },
    effectReconciler });
  let host;
  function reconcileLibraRun(libraRunId) {
    const result = libraProcessServices.libraRunCoordinator.reconcile(libraRunId);
    if (result?.kind !== 'replacement_required') return result;
    const replacement = libraProcessServices.libraRunCreator.replace(
      result.subjectId,
      libraRunId,
    );
    if (replacement.libraRunId)
      return libraProcessServices.libraRunCoordinator.reconcile(
        replacement.libraRunId,
      );
    return replacement;
  }
  const domainReconciler = { async reconcile(request) {
    if(request.reconcilePhase==='attempt_terminal'){
      if(request.ownerDomain==='libra'&&request.processType==='libra_intake'&&request.workKind==='acceptance'&&
          request.workAttemptState==='failed'&&['P8_ACCEPTANCE_CONTINUITY_BASIS_STALE',
            'P4_UAT_INTAKE_BINDING_RESULT_REPLAN_REQUIRED',PRE_PROJECTION_PLAN_REPLAN_CODE].includes(request.workAttemptFailureCode)){
        return {workId:request.workId,disposition:'replan'};
      }
      if(request.ownerDomain==='perception'&&request.processType==='perception_resolution'&&
          request.workAttemptState==='failed'&&request.workAttemptFailureCode===PRE_PROJECTION_PLAN_REPLAN_CODE){
        return {workId:request.workId,disposition:'replan'};
      }
      if(request.ownerDomain==='procurement'&&request.processType==='procurement_run'&&
          request.workKind==='evidence_assessment'&&request.workAttemptState==='succeeded'){
        const structures=workResultReader.read(request.workId).filter((item)=>item.outcomeKind==='succeeded'&&
          item.resultSchemaRef==='helix://contracts/capabilities/procurement.triage.structure.inspect/v1/result');
        if(!structures.some((item)=>item.result.cursorOut===null))return {workId:request.workId,disposition:'replan'};
      }
      if(request.ownerDomain==='procurement'&&request.processType==='material_field'){
        if(request.workAttemptState!=='succeeded')return {workId:request.workId,disposition:'failed'};
        const progress=progressReader.read(request.workId);
        if(!progress.completed)return {workId:request.workId,disposition:'replan'};
      }
      return {workId:request.workId,disposition:request.workAttemptState};
    }
    if(request.reconcilePhase!=='work_terminal')return null;
    if(request.ownerDomain==='libra'&&request.processType==='libra_intake'){
      const intake=libraProcessServices.coordinator.reconcile(request.processId);
      if(['acceptance','rejection'].includes(request.workKind)&&request.workAttemptState==='succeeded'){
        libraProcessServices.coordinator.reconcilePending({ignoreAcceptanceProcessId:request.processId,limit:100});
      }
      if(request.workKind==='acceptance'&&request.workAttemptState==='succeeded'){
        const receipt=workResultReader.read(request.workId).find((item)=>item.outcomeKind==='succeeded'&&item.result?.subjectId)?.result;
        if(receipt?.subjectId){libraProcessServices.routingCoordinator.reconcile(receipt.subjectId);options.onFormationSubjectChanged?.(receipt.subjectId);}
      }
      return {workId:request.workId,disposition:request.workAttemptState};
    }
    if(request.ownerDomain==='libra'&&request.processType==='libra_routing'){
      if(request.workAttemptState==='succeeded'){
        const routing=libraProcessServices.routingCoordinator.reconcile(request.processId);
        if(routing.kind==='terminal'&&routing.decision?.result==='resolved')libraProcessServices.acceptanceSpecCoordinator.reconcile(request.processId);
      }
      options.onFormationSubjectChanged?.(request.processId);
      return {workId:request.workId,disposition:request.workAttemptState};
    }
    if(request.ownerDomain==='libra'&&request.processType==='libra_acceptance_spec'){
      if(request.workAttemptState==='failed'&&request.workAttemptFailureCode==='P8_ACCEPTANCE_SPEC_PLANNING_BASIS_STALE'){
        libraProcessServices.acceptanceSpecCoordinator.reconcile(request.processId);
        return {workId:request.workId,disposition:'failed'};
      }
      options.onFormationSubjectChanged?.(request.processId);
      if(request.workAttemptState==='succeeded'){
        const spec=libraProcessServices.acceptanceSpecCoordinator.reconcile(request.processId);
        if(spec.kind==='terminal'){
          const run=libraProcessServices.libraRunCreator.reconcile(request.processId);
          if(run.libraRunId)libraProcessServices.libraRunCoordinator.reconcile(run.libraRunId);
        }
      }
      return {workId:request.workId,disposition:request.workAttemptState};
    }
    if(request.ownerDomain==='libra'&&request.processType==='libra_run'){
      if(['succeeded','failed','cancelled'].includes(request.workAttemptState))
        reconcileLibraRun(request.processId);
      try { const runContext=libraProcessServices.movieProductionReader.readRun(request.processId);
        if(runContext?.run?.subjectId)options.onFormationSubjectChanged?.(runContext.run.subjectId); } catch {}
      return {workId:request.workId,disposition:request.workAttemptState};
    }
    if(request.ownerDomain==='arca'&&request.processType==='arca_acceptance'){
      if(request.workAttemptState==='succeeded')arcaProcessServices.coordinator.reconcileAcceptance(request.processId);
      return {workId:request.workId,disposition:request.workAttemptState};
    }
    if(request.ownerDomain==='arca'&&request.processType==='arca_ondeck_run'){
      if(request.workAttemptState==='succeeded'){
        const terminal=arcaProcessServices.coordinator.reconcileOnDeck(request.processId);
        const shelfEntryId=terminal?.result?.onDeckCommitReceipt?.shelfEntryId;
        if(terminal?.kind==='terminal'&&shelfEntryId)
          arcaProcessServices.aftercareCoordinator.reconcile(shelfEntryId);
      }
      return {workId:request.workId,disposition:request.workAttemptState};
    }
    if(request.ownerDomain==='arca'&&request.processType==='arca_shelf_entry'){
      if(request.workAttemptState==='succeeded')arcaProcessServices.aftercareCoordinator.reconcile(request.processId);
      return {workId:request.workId,disposition:request.workAttemptState};
    }
    if(request.ownerDomain==='arca'&&request.processType==='arca_offdeck_case'){
      if(['succeeded','failed','cancelled'].includes(request.workAttemptState))arcaProcessServices.offdeckCoordinator.reconcile(request.processId);
      return {workId:request.workId,disposition:request.workAttemptState};
    }
    if(request.ownerDomain==='arca'&&request.processType==='arca_shelf_deregistration'){
      if(['succeeded','failed','cancelled'].includes(request.workAttemptState))arcaProcessServices.shelfDeregistrationCoordinator.reconcile(request.processId);
      return {workId:request.workId,disposition:request.workAttemptState};
    }
    if(request.ownerDomain==='perception'&&request.processType==='perception_acquisition'){
      if(request.workAttemptState==='succeeded'){
        const acquisition=perceptionProcessServices.reconcileAcquisition(request.processId);
        const context=perceptionProcessServices.acquisitionContext(request.processId);
        if(acquisition.kind==='terminal'&&context?.scope?.mode==='direct'){
          const target=context.scope.target;
          perceptionProcessServices.ensureResolution(target.targetType,target.targetId);
          if(target.targetType==='subject')libraProcessServices.acceptanceSpecCoordinator.reconcile(target.targetId);
        }
      }
      return {workId:request.workId,disposition:request.workAttemptState};
    }
    if(request.ownerDomain==='perception'&&request.processType==='perception_resolution'){
      if(request.workAttemptState==='succeeded'){
        perceptionProcessServices.reconcileResolution(request.processId);
        if(request.processId.startsWith('subject:')){
          const subjectId=request.processId.slice('subject:'.length);
          // A direct rating can arrive while the preceding no-rating
          // Resolution Work is still running. Reconcile the just-finished
          // revision, then immediately issue the next basis revision before
          // asking Libra to evaluate its Acceptance Spec.
          perceptionProcessServices.ensureResolution('subject',subjectId);
          libraProcessServices.acceptanceSpecCoordinator.reconcile(subjectId);
          options.onFormationSubjectChanged?.(subjectId);
        }
        if(request.processId.startsWith('shelf_entry:')){
          const shelfEntryId=request.processId.slice('shelf_entry:'.length);
          arcaProcessServices.aftercareCoordinator.reconcile(shelfEntryId);
        }
      }
      return {workId:request.workId,disposition:request.workAttemptState};
    }
    if (request.ownerDomain !== 'procurement') return null;
    if(request.processType==='procurement_run'){
      if(request.workAttemptState==='succeeded'){
        if(request.workKind==='evidence_assessment') evidenceIndex.invalidate(request.workId);
        runCoordinator.reconcile(request.processId);
        if(request.workKind==='evidence_assessment'){
          const structures=workResultReader.read(request.workId).filter((item)=>item.outcomeKind==='succeeded'&&
            item.resultSchemaRef==='helix://contracts/capabilities/procurement.triage.structure.inspect/v1/result');
          if(!structures.some((item)=>item.result.cursorOut===null))return {workId:request.workId,disposition:'replan'};
        }
        return {workId:request.workId,disposition:'succeeded'};
      }
      if(['failed','cancelled'].includes(request.workAttemptState)){
        // A terminal Candidate planning outcome is a Process-local fact.  Let
        // the thin Coordinator record the exact failed Unit and continue its
        // siblings before Foundation settles this Work; do not leave a running
        // Work with a terminal Attempt for the fallback sweep to rediscover.
        runCoordinator.reconcile(request.processId);
        return {workId:request.workId,disposition:request.workAttemptState};
      }
      return null;
    }
    if(request.processType!=='material_field')return null;
    if (request.workState !== 'succeeded') return null;
    const progress = progressReader.read(request.workId);
    const field = options.materialFieldStore.getMaterialField(request.processId);
    const created=procurementAutomation.reconcileFromObservation(Object.freeze({ state:'succeeded', fieldId:request.processId,
      accessRevision:field.currentAccessRevision, terminalObservationRevision:progress.expectedObservationRevision,
      observationWorkId:request.workId }), request.changedMaterialKeys || []);
    for(const run of created.runs)runCoordinator.reconcile(run.procurementRunId);
    return { workId: request.workId, disposition: 'succeeded' };
  } };
  const cursorStore=createReconcileCursorStore({schemaManifest:options.schemaManifest,unitOfWork:options.unitOfWork,now});
  let aftercareSweepNotBeforeMs=0,offdeckPolicySweepNotBeforeMs=0,offdeckDuplicateSweepNotBeforeMs=0;
  const fallbackReconciler=createDomainReconcileRunner({cursorStore,now,onError:options.onError,registrations:[Object.freeze({
    ownerDomain:'procurement',reconcilerKey:'active-procurement-runs',
    listPage:({cursor,limit})=>triageReader.listActiveRunPage(cursor,limit),
    reconcile:({procurementRunId})=>runCoordinator.reconcile(procurementRunId),
  }),Object.freeze({ownerDomain:'libra',reconcilerKey:'pending-intake-offers',
    listPage:({cursor,limit})=>libraProcessServices.offerReader.listProcessPage(cursor,limit).items.map((item)=>Object.freeze({cursor:item.processId,scope:item})),
    reconcile:({processId})=>libraProcessServices.coordinator.reconcile(processId)}),Object.freeze({ownerDomain:'libra',reconcilerKey:'active-routing-subjects',
    listPage:({cursor,limit})=>libraProcessServices.routingContextReader.listActiveSubjectPage(cursor,limit).items.map((item)=>Object.freeze({cursor:item.subjectId,scope:item})),
    reconcile:({subjectId})=>libraProcessServices.routingCoordinator.reconcile(subjectId)}),Object.freeze({ownerDomain:'perception',reconcilerKey:'active-acquisitions',
    listPage:({cursor,limit})=>perceptionProcessServices.listAcquisitions().filter((item)=>item.state==='active')
      .sort((a,b)=>a.perceptionAcquisitionId.localeCompare(b.perceptionAcquisitionId)).filter((item)=>cursor===null||item.perceptionAcquisitionId>cursor)
      .slice(0,limit).map((item)=>Object.freeze({cursor:item.perceptionAcquisitionId,scope:item})),
    reconcile:({perceptionAcquisitionId})=>perceptionProcessServices.reconcileAcquisition(perceptionAcquisitionId)}),Object.freeze({
      ownerDomain:'perception',reconcilerKey:'active-subject-rating-resolutions',
      listPage:({cursor,limit})=>libraProcessServices.routingContextReader.listActiveSubjectPage(cursor,limit).items
        .map((item)=>Object.freeze({cursor:item.subjectId,scope:item})),
      reconcile:({subjectId})=>perceptionProcessServices.ensureResolution('subject',subjectId),
    }),Object.freeze({
      ownerDomain:'libra',reconcilerKey:'active-acceptance-spec-subjects',
      listPage:({cursor,limit})=>libraProcessServices.routingContextReader.listActiveSubjectPage(cursor,limit).items
        .map((item)=>Object.freeze({cursor:item.subjectId,scope:item})),
      reconcile:({subjectId})=>libraProcessServices.acceptanceSpecCoordinator.reconcile(subjectId),
    }),Object.freeze({
      ownerDomain:'libra',reconcilerKey:'ready-libra-runs',
      listPage:({cursor,limit})=>libraProcessServices.libraRunContextReader.listReadySubjectPage(cursor,limit).items
        .map((item)=>Object.freeze({cursor:item.subjectId,scope:item})),
      reconcile:({subjectId})=>{const run=libraProcessServices.libraRunCreator.reconcile(subjectId);
        return run.libraRunId?reconcileLibraRun(run.libraRunId):run;},
    }),Object.freeze({
      ownerDomain:'arca',reconcilerKey:'due-aftercare-shelf-entries',
      listPage:({cursor,limit})=>{if(cursor===null&&now()<aftercareSweepNotBeforeMs)return [];const page=arcaProcessServices.aftercareContextReader.listPage(cursor,limit);if(page.length<limit)aftercareSweepNotBeforeMs=now()+24*60*60*1000;return page;},
      reconcile:({shelfEntryId})=>{const projection=arcaProcessServices.aftercareCoordinator.project(shelfEntryId);
        return !projection||Math.min(projection.nextCustodyDueAtMs,projection.nextDeepDueAtMs)>now()
          ?Object.freeze({kind:'not_due',shelfEntryId})
          :arcaProcessServices.aftercareCoordinator.reconcile(shelfEntryId);},
    }),Object.freeze({
      ownerDomain:'arca',reconcilerKey:'preparing-offdeck-reviews',
      listPage:({cursor,limit})=>arcaProcessServices.offdeckContextReader.store.listReviews().filter((item)=>item.state==='preparing'&&
        (cursor===null||item.review_id>cursor)).sort((a,b)=>a.review_id.localeCompare(b.review_id)).slice(0,limit)
        .map((item)=>Object.freeze({cursor:item.review_id,scope:Object.freeze({reviewId:item.review_id})})),
      reconcile:({reviewId})=>{const detail=arcaProcessServices.offdeckContextReader.store.detail(reviewId);let draining=0;for(const reservation of detail?.reservations||[]){draining+=Number(workLifecycle.cancelProcess({ownerDomain:'arca',processType:'arca_shelf_entry',processId:reservation.shelfEntryId,reasonCode:'ARCA_OFFDECK_RESERVATION_FENCE'}).drainingWorks||0);arcaProcessServices.aftercareCoordinator.reconcile(reservation.shelfEntryId);}return draining>0?arcaProcessServices.offdeckContextReader.store.detail(reviewId):arcaProcessServices.offdeckContextReader.store.tryOpenPreparedReview(reviewId,(keys)=>arcaProcessServices.offdeckContextReader.controlProjections(keys));},
    }),Object.freeze({
      ownerDomain:'arca',reconcilerKey:'active-offdeck-cases',
      listPage:({cursor,limit})=>arcaProcessServices.offdeckContextReader.store.listCases().filter((item)=>['executing','blocked'].includes(item.state)&&
        (cursor===null||item.offdeckCaseId>cursor)).sort((a,b)=>a.offdeckCaseId.localeCompare(b.offdeckCaseId)).slice(0,limit)
        .map((item)=>Object.freeze({cursor:item.offdeckCaseId,scope:item})),
      reconcile:({offdeckCaseId})=>arcaProcessServices.offdeckCoordinator.reconcile(offdeckCaseId),
    }),Object.freeze({
      ownerDomain:'arca',reconcilerKey:'active-shelf-deregistrations',
      listPage:({cursor,limit})=>arcaProcessServices.shelfDeregistrationContextReader.listActivePage(cursor,limit),
      reconcile:({deregistrationId})=>arcaProcessServices.shelfDeregistrationCoordinator.reconcile(deregistrationId),
    }),Object.freeze({
      ownerDomain:'arca',reconcilerKey:'daily-offdeck-policy-evaluation',
      listPage:({cursor,limit})=>{const policy=arcaProcessServices.offdeckContextReader.store.ensurePolicy();if(policy.status!=='active'||cursor===null&&now()<offdeckPolicySweepNotBeforeMs)return [];const entries=arcaProcessServices.offdeckContextReader.store.allEntryFacts().filter((item)=>cursor===null||item.shelf_entry_id>cursor).sort((a,b)=>a.shelf_entry_id.localeCompare(b.shelf_entry_id)).slice(0,limit);if(entries.length<limit)offdeckPolicySweepNotBeforeMs=now()+24*60*60*1000;return entries.map((item)=>Object.freeze({cursor:item.shelf_entry_id,scope:Object.freeze({shelfEntryId:item.shelf_entry_id})}));},
      reconcile:({shelfEntryId})=>arcaProcessServices.offdeckAutomationCoordinator.evaluateEntry(shelfEntryId),
    }),Object.freeze({
      ownerDomain:'arca',reconcilerKey:'weekly-offdeck-duplicate-detection',
      listPage:({cursor})=>{const policy=arcaProcessServices.offdeckContextReader.store.ensurePolicy();if(!policy.duplicateScheduleEnabled||cursor===null&&now()<offdeckDuplicateSweepNotBeforeMs)return [];offdeckDuplicateSweepNotBeforeMs=now()+7*24*60*60*1000;return cursor===null?[Object.freeze({cursor:'active-deck',scope:Object.freeze({run:true})})]:[];},
      reconcile:()=>arcaProcessServices.offdeckAutomationCoordinator.detectDuplicates(),
    })]});
  host = createExecutionRuntimeHost({ startupRecovery, scheduler, plannerRegistry, planPublisher, workLifecycle,
    eventRuntime, domainReconciler, fallbackReconciler, onError: options.onError,maxInFlightEvents:16 });
  return Object.freeze({ host, registry, policyRegistry, contractValidator, progressReader, procurementAutomation,triageReader,runCoordinator,
    intakeCoordinator:libraProcessServices.coordinator,intakeOfferReader:libraProcessServices.offerReader,
    routingCoordinator:libraProcessServices.routingCoordinator,routingContextReader:libraProcessServices.routingContextReader,
    acceptanceSpecCoordinator:libraProcessServices.acceptanceSpecCoordinator,
    libraRunCreator:libraProcessServices.libraRunCreator,libraRunContextReader:libraProcessServices.libraRunContextReader,
    libraRunCoordinator:libraProcessServices.libraRunCoordinator,movieProductionReader:libraProcessServices.movieProductionReader,
    libraRunExecutionProjection:libraProcessServices.libraRunExecutionProjection,
    productIdentitySelection:libraProcessServices.productIdentitySelection,
    arcaCoordinator:arcaProcessServices.coordinator,arcaContextReader:arcaProcessServices.contextReader,
    arcaAftercareCoordinator:arcaProcessServices.aftercareCoordinator,
    arcaAftercareContextReader:arcaProcessServices.aftercareContextReader,
    arcaOffdeckCoordinator:arcaProcessServices.offdeckCoordinator,arcaOffdeckContextReader:arcaProcessServices.offdeckContextReader,
    arcaOffdeckAutomationCoordinator:arcaProcessServices.offdeckAutomationCoordinator,
    arcaShelfDeregistrationCoordinator:arcaProcessServices.shelfDeregistrationCoordinator,
    arcaShelfDeregistrationContextReader:arcaProcessServices.shelfDeregistrationContextReader,
    cancelProcessWorks:(scope)=>workLifecycle.cancelProcess(scope),
    perception:perceptionProcessServices });
}

module.exports = Object.freeze({
  UAT_SOURCE_EXECUTION_CATALOG_DIGEST,
  PRE_PROJECTION_EXECUTION_CATALOG_DIGEST,
  createProcurementExecutionRuntime,
  createHelixExecutionRuntime:createProcurementExecutionRuntime,
  verifyStartupPlanCatalog,
});
