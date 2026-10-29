'use strict';
const {createLibraResourcePriorityBridge}=require('./libra-resource-priority-bridge');
const {resumeBlockedTranscodeAssessments}=require('./libra-transcode-replan');
const {reconcileReadyLibraSubject,reconcileConfirmedTargetForRun,runnableLibraRunPage}=require('./libra-ready-run-reconcile');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { computeBoundedMaterialFingerprint, computeBoundedMaterialFingerprintSync,
  readBoundedFileSnapshotSync } = require('../integrations/bounded-material-fingerprint');
const { canonicalDigest } = require('../contracts/canonical-json');
const { JAV_UNKNOWN_ACTOR_ID } = require('../contracts/jav-actor-policy');
const { createCapabilityContractValidator } = require('../foundation/capability/contract-validator');
const { createCapabilityRegistry } = require('../foundation/capability/capability-registry');
const { createExecutorDispatcher } = require('../foundation/capability/executor-dispatcher');
const { createCircuitBreaker } = require('../foundation/diagnostics/pressure-guard');
const { createExecutorIncidentRegistry } = require('../foundation/execution/executor-incident-registry');
const { createExecutorIncidentObserver } = require('../foundation/execution/executor-incident-observer');
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
const { createStoredPlanContractVerifier } = require('../foundation/execution/stored-plan-contract-verifier');
const { createPlanHistoryAudit } = require('../foundation/execution/plan-history-audit');
const { createCatalogPlanProofReader } = require('../foundation/execution/catalog-plan-proof-reader');
const { createTimeoutController } = require('../foundation/execution/timeout-controller');
const { createCooperativeExecutionIsolation } = require('../foundation/execution/cooperative-execution-isolation');
const { createWorkLifecycle } = require('../foundation/execution/work-lifecycle');
const { createWorkScheduler } = require('../foundation/execution/work-scheduler');
const { createWorkSupplyController } = require('../foundation/execution/work-supply-controller');
const { createWorkResultReader } = require('../foundation/execution/work-result-reader');
const { createReconcileCursorStore } = require('../foundation/execution/reconcile-cursor-store');
const { createMaterialControlProjectionPort, controlScopeDigest } = require('../foundation/persistence/material-control');
const {deriveJavCoverBytes}=require('../integrations/jav-cover-renderer');
const {createJavCorrectionWorkspaceIo}=require('../integrations/jav-correction-workspace-io');
const {createJavCorrectionFormalFiles}=require('../integrations/jav-correction-formal-files');
const {createJavCorrectionFormalRetirement}=require('../integrations/jav-correction-formal-retirement');
const {createJavCorrectionWorkspaceReclaim}=require('../integrations/jav-correction-workspace-reclaim');
const {createJavCorrectionRecoveryScene}=require('../integrations/jav-correction-recovery-scene');
const { createDomainReconcileRunner } = require('../foundation/execution/domain-reconcile-runner');
const { createWorkflowPlanPublisher, executionCatalogDigest } = require('../foundation/execution/workflow-plan');
const { compileFfmpegPipeline, compileFfmpegPassArgs } = require('../integrations/ffmpeg-pipeline');

function volumeReadUnitsForCapability(capability) {
  return capability === 'libra.transcode.input.verify@1' ? 2 : 1;
}

function mergeResourceDemands(resources) {
  const merged = new Map();
  for (const resource of resources) {
    const existing = merged.get(resource.resourceKey);
    if (existing) existing.units += resource.units;
    else merged.set(resource.resourceKey, { resourceKey: resource.resourceKey, units: resource.units });
  }
  return [...merged.values()];
}
const { ProcurementExecutionRegistration } = require('../domains/procurement/public');
const { LibraExecutionRegistration, createLibraCustomTargetRuntimeSupport } = require('../domains/libra/public');
const DEFAULT_PREDECK_PIPELINE_SEATS = LibraExecutionRegistration.DEFAULT_PREDECK_PIPELINE_SEATS;
const createMovieResponsibilityClosureCoordinator =
  LibraExecutionRegistration.createMovieResponsibilityClosureCoordinator;
const { PerceptionExecutionRegistration } = require('../domains/perception/public');
const { ArcaExecutionRegistration, createArcaOfferResponsibilityProjection } = require('../domains/arca/public');
const createOffloadCompletionPort = ArcaExecutionRegistration.createOffloadCompletionPort;
const { createPeopleImageExecutionRegistration } = require('../domains/people/public');

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
  'libra.external_material.package.verify@1','libra.workspace.material.import@1',
  'libra.media.frames.extract@1','shared.face.cluster.compute@1','shared.face.reference.match@1',
  'libra.western.analysis.request@1','libra.western.analysis.observe@1','libra.western.metadata.normalize@1','libra.western.poster.render@1']);
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
  'arca.aftercare.case.commit@1','arca.aftercare.workspace.reclaim@1',
  'arca.us_adult.source.prepare@1',
  'arca.us_adult.references.match@1',
  'arca.us_adult.assets.prepare@1',
  'arca.us_adult.files.stage@1',
  'arca.us_adult.files.publish@1',
  'arca.us_adult.files.verify@1',
  'arca.us_adult.inventory.commit@1',
  'arca.us_adult.files.retire@1',
  'arca.us_adult.case.commit@1',

  'arca.jav_correction.source.verify@1','arca.jav_correction.assets.prepare@1','arca.jav_correction.files.stage@1','arca.jav_correction.files.publish@1','arca.jav_correction.files.verify@1','arca.jav_correction.inventory.commit@1','arca.jav_correction.formal_retirement.execute@1','arca.jav_correction.workspace.reclaim@1']);
const ARCA_OFFDECK_ENABLED=Object.freeze(['arca.offdeck.duplicate.detect@1','arca.offdeck.duplicate_group.commit@1','arca.offdeck.review_candidate.commit@1',
  'arca.offdeck.destruction_scope.verify@1','arca.offdeck.primary_material.delete@1',
  'arca.offdeck.related_reference.release@1','arca.offdeck.unreferenced_related.delete@1',
  'arca.offdeck.deletion.verify@1','arca.offdeck.terminal.commit@1']);
const ARCA_DEREGISTRATION_ENABLED=Object.freeze([
  'arca.shelf_deregistration.release_manifest.verify@1',
  'arca.shelf_deregistration.commit@1',
]);
const ARCA_SERIES_ENABLED=Object.freeze(['arca.series_root.files.relocate@1','arca.series_root.inventory.commit@1','arca.series_presentation.source.observe@1','arca.series_presentation.assets.prepare@1','arca.series_presentation.files.publish@1','arca.series_presentation.inventory.commit@1','arca.series_presentation.workspace.reclaim@1']);
const ARCA_ALL_ENABLED=Object.freeze([...ARCA_SERIES_ENABLED,...ARCA_ENABLED,...ARCA_OFFDECK_ENABLED,...ARCA_DEREGISTRATION_ENABLED]);
const PEOPLE_IMAGE_ENABLED = Object.freeze(['people.reference_asset.import@1', 'shared.face.embedding.compute@1','people.reference_fact.commit@1']);
const PEOPLE_REFERENCE_ENABLED=Object.freeze(['people.reference_usage.audit@1','people.workspace.reclaim@1']);
const PEOPLE_SYSTEM_ENABLED=Object.freeze(['people.registration_evidence.observe@1','people.merge_evidence.resolve@1','people.candidate.commit@1','people.person.commit@1']);
const ENABLED = Object.freeze([...PROCUREMENT_ENABLED, ...SHARED_ENABLED, ...LIBRA_ENABLED, ...PERCEPTION_ENABLED,...ARCA_ALL_ENABLED, ...PEOPLE_IMAGE_ENABLED,...PEOPLE_SYSTEM_ENABLED,...PEOPLE_REFERENCE_ENABLED]);
const LOCAL_MEDIA_ENCODE_TIMEOUT_MS = 48 * 60 * 60 * 1000;

function createHelixExecutionPolicyRegistry(manifests) {
  const retryPolicies = [
    { ref: 'helix://foundation/retry/pure-observation/v1', effectClass: 'pure_observation', maxFailureAttempts: 3,
      backoffMs: [1000, 5000], retryableFailureClasses: ['integration', 'timeout'] },
    { ref: 'helix://foundation/retry/perception-provider-observation/v1', effectClass: 'pure_observation', maxFailureAttempts: 3,
      backoffMs: [30_000, 120_000], retryableFailureClasses: ['integration', 'timeout'] },
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
    { ref: 'helix://foundation/timeout/aftercare-long-media/v1', timeoutMs: LOCAL_MEDIA_ENCODE_TIMEOUT_MS,
      minObservationCadenceMs: null, maxObservationElapsedMs: null, maxObservationCount: null },
  ];
  const timeoutPolicyFor = (capabilityRef) => ['arca.aftercare.media.remux@1',
    'arca.aftercare.media.transcode@1', 'libra.media.remux@1', 'libra.media.transcode@1'].includes(capabilityRef)
    ? timeoutPolicies[3].ref
    : capabilityRef === 'libra.external_material.acquire.observe@1'
      ? timeoutPolicies[2].ref
    : capabilityRef === 'libra.external_material.stability.observe@1'
      ? timeoutPolicies[1].ref
      : timeoutPolicies[0].ref;
  return createExecutionPolicyRegistry({ expectedCapabilityRefs: Object.keys(manifests), retryPolicies, timeoutPolicies,
    compensationContracts: [], capabilityBindings: Object.keys(manifests).map((capabilityRef) => ({ capabilityRef,
      effectClass: manifests[capabilityRef].effectClass,
      retryPolicyRef: capabilityRef === 'perception.source.acquire@1' ? retryPolicies[1].ref :
          manifests[capabilityRef].effectClass === 'pure_observation' ? retryPolicies[0].ref :
          manifests[capabilityRef].effectClass === 'responsibility_control_commit' ? retryPolicies[3].ref :
          manifests[capabilityRef].effectClass === 'workspace_write' ? retryPolicies[4].ref :
          manifests[capabilityRef].effectClass === 'external_request' ? retryPolicies[5].ref :
          manifests[capabilityRef].effectClass === 'material_commit' ? retryPolicies[6].ref :
          manifests[capabilityRef].effectClass === 'destructive_commit' ? retryPolicies[7].ref : retryPolicies[2].ref,
      timeoutPolicyRef: timeoutPolicyFor(capabilityRef), compensationContractRefs: [] })) });
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
  let host, registry;
  const currentServiceCatalog = Object.freeze({
    resolve(capabilityRef, ownerDomain) {
      if (!registry) throw new Error('Current Service Catalog is unavailable during runtime construction.');
      return registry.resolve(capabilityRef, ownerDomain);
    },
  });
  const materialControlProjectionPort = createMaterialControlProjectionPort(options);
  const workResultReader = createWorkResultReader(options);
  const runtimeSchemas = collectSchemas(contractsRoot);
  const contractValidator = createCapabilityContractValidator({ schemas: runtimeSchemas });
  options.onContractValidatorReady?.(contractValidator);
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
    readJavUnknownActorProjection:()=>peopleReferenceQuery.getPersonReferenceProjection({personId:JAV_UNKNOWN_ACTOR_ID}),
    readArcaRoutingTargets: options.readArcaRoutingTargets || (() => Object.freeze([])),
    readArcaShelfStandard: options.readArcaShelfStandard || (() => null),
    readRelatedNfo: options.readRelatedNfo || (async () => { throw new Error('Routing NFO adapter is unavailable.'); }),
    observeRoutingProvider: options.observeRoutingProvider || (async () => { throw new Error('Routing Provider adapter is unavailable.'); }),
    resolveRoutingIntegrationHandle: options.resolveRoutingIntegrationHandle || (() => undefined),
    resolveExternalMaterialIntegrationHandle: options.resolveExternalMaterialIntegrationHandle || (() => undefined),
    readExternalMaterialLandingBinding: options.readExternalMaterialLandingBinding || (() => undefined),
    executeExternalProvider: options.executeExternalProvider ||
      (async () => { throw new Error('External Material Provider adapter is unavailable.'); }),
    qualifySeriesLocalSource:require('../integrations/series-local-source-io').qualifyReferences,
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
  const libraCapabilityRegistration=libraConstruction.createCapabilityRegistration({...libraOptions,now,workResultReader,contractValidator,
    materialControlProjectionPort,
    computeFingerprint:options.computeFingerprint || computeBoundedMaterialFingerprint});
  const libraRegistrations=libraCapabilityRegistration.createRegistrations({enabledCapabilityRefs:LIBRA_ENABLED,
    manifests:Object.fromEntries(LIBRA_ENABLED.map((ref)=>[ref,manifests[ref]]))});
  const perceptionCapabilityRegistration=perceptionConstruction.createCapabilityRegistration({...perceptionOptions,now});
  const perceptionRegistrations=perceptionCapabilityRegistration.createRegistrations({manifests:Object.fromEntries(PERCEPTION_ENABLED.map((ref)=>[ref,manifests[ref]]))});
  let perceptionProcessServices,peopleProcessServices;
  const readShelfEntryRating=(shelfEntryId)=>perceptionProcessServices
    ?perceptionProcessServices.readCurrentRating('shelf_entry',shelfEntryId)
    :null;
  const readShelfEntryRatings=(shelfEntryIds)=>perceptionProcessServices
    ?perceptionProcessServices.readCurrentRatings('shelf_entry',shelfEntryIds)
    :new Map();
  const ensureShelfEntryRatingResolution=(shelfEntryId)=>perceptionProcessServices
    ?perceptionProcessServices.ensureResolution('shelf_entry',shelfEntryId)
    :Object.freeze({kind:'pending'});
  const arcaCapabilityRegistration=arcaConstruction.createCapabilityRegistration({...options,now,workResultReader,contractValidator,
    cancelProcessWorks:scope=>workLifecycle.cancelProcess(scope),
    resolveMediaCastReference:input=>peopleProcessServices.mediaCastReferenceQuery.resolve(input),
    materialControlProjectionPort,createSeriesPresentationIo:args=>require('../integrations/series-presentation-io').createSeriesPresentationIo({...args,afterPhysicalEffect:options.afterSeriesPhysicalEffect}),deriveJavCoverBytes,createJavCorrectionWorkspaceIo,createJavCorrectionFormalFiles,createJavCorrectionFormalRetirement,createJavCorrectionWorkspaceReclaim,createJavCorrectionRecoveryScene,
    registry:currentServiceCatalog,
    buildRatingTargetIdentity:LibraExecutionRegistration.buildRatingTargetIdentity,
    compileFfmpegPipeline, compileFfmpegPassArgs,
    computeBoundedMaterialFingerprint:options.computeBoundedMaterialFingerprint || computeBoundedMaterialFingerprint,
    computeBoundedMaterialFingerprintSync,
    readBoundedFileSnapshotSync,
    readPerceptionRating:readShelfEntryRating,readPerceptionRatings:readShelfEntryRatings});
  const arcaRegistrations=arcaCapabilityRegistration.createRegistrations({enabledCapabilityRefs:ARCA_ALL_ENABLED,
    manifests:Object.fromEntries(ARCA_ALL_ENABLED.map((ref)=>[ref,manifests[ref]]))});
  const peopleImageExecution = createPeopleImageExecutionRegistration({ ...options, workResultReader, contractValidator,
    artifactReferenceSources:[require('../domains/libra/public').createLibraArtifactAuditSource({...options,contractValidator}),
      require('../domains/arca/public').createArcaArtifactAuditSource({...options,contractValidator})],
    wake: () => host?.wakeBackground({ownerDomain:'people',reconcilerKey:'image-operations'}) });
  const peopleReferenceQuery=peopleImageExecution.createReferenceQuery();
  const peopleImageRegistrations = peopleImageExecution.createRegistrations(manifests).map(entry=>{
    if(entry.manifest.capabilityRef!=='shared.face.embedding.compute@1')return entry;
    const libraPort=libraCapabilityRegistration.ports['shared.face.embedding.compute@1'];
    const choose=context=>{
      if(context.ownerScope?.domain==='libra')return libraPort;
      if(context.ownerScope?.domain==='people')return null;
      throw new Error('Shared face embedding requires an explicit People or Libra Owner.');
    };
    return Object.freeze({...entry,executor:{version:1,execute(context){const port=choose(context);return port?port.execute(context):entry.executor.execute(context);}},
      semanticValidator:{ref:entry.manifest.semanticValidatorRef,
        validateInputs(context){const port=choose(context);return port?port.validateInputs(context):entry.semanticValidator.validateInputs(context);},
        validateResult(context,outcome){const port=choose(context);return port?port.validateResult(context,outcome):entry.semanticValidator.validateResult(context,outcome);}}});
  });
  const registrations = Object.freeze([...procurementRegistrations,...sharedRegistrations,...libraRegistrations,...perceptionRegistrations,...arcaRegistrations,...peopleImageRegistrations].map(entry=>Object.freeze({...entry,executor:Object.freeze({...entry.executor,execute(context){
    libraProcessServices?.sourceFairness.onExecutionStarted(context);
    return entry.executor.execute(context);
  }})})));
  registry = createCapabilityRegistry({ registrations, expectedCapabilityRefs: ENABLED });
  const policyRegistry = createHelixExecutionPolicyRegistry(manifests);
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
    if(processType==='people_image_preparation')return Object.freeze({priorityClass:'normal_foreground',localPriority:240,priorityRevision:1,supplyRole:'completion'});
    if(['people_system_registration','people_system_merge','people_artifact_reclamation'].includes(processType))return Object.freeze({priorityClass:'background_observation',localPriority:0,priorityRevision:1,supplyRole:'expansion'});
    if(processType==='libra_acceptance_spec')return Object.freeze({priorityClass:'normal_foreground',localPriority:230,priorityRevision:1,supplyRole:'completion'});
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
    targetEligibilityProvider:options.executionEligibilityProvider,
    workSupplyEligibilityProvider:{check:({ownerDomain,workKind})=>
      !(ownerDomain==='procurement'&&workKind==='failed_preparation_retry')},
    priorityProjectionProvider: executionProjectionProvider });
  const mapper = createResourceProfileMapper({ profileKey: 'default', profileRevision: 1,
    logicalCpu: Math.max(1, os.cpus().length), integrations: [], volumes: [], encoders: [], aiDevices: [], workers: [] });
  const validatedVolumeKeys=new Set(),validatedIntegrationKeys=new Set(),validatedEncoderSlots=new Map();
  const activeMapper=Object.freeze({profileKey:mapper.profileKey,profileRevision:mapper.profileRevision,capacityFor(resourceKey){
    if(resourceKey.startsWith('volume_read:'))return validatedVolumeKeys.has(resourceKey.slice('volume_read:'.length))?2:0;
    if(resourceKey.startsWith('volume_write:'))return validatedVolumeKeys.has(resourceKey.slice('volume_write:'.length))?2:0;
    if(resourceKey.startsWith('volume_mutation:'))return validatedVolumeKeys.has(resourceKey.slice('volume_mutation:'.length))?1:0;
    if(resourceKey.startsWith('integration:'))return validatedIntegrationKeys.has(resourceKey.slice('integration:'.length))?4:0;
    if(resourceKey.startsWith('encoder:')){
      const slots=validatedEncoderSlots.get(resourceKey.slice('encoder:'.length))||0;
      return slots<1?0:(mapper.profileKey==='full'?Math.min(2,slots):1);
    }
    return mapper.capacityFor(resourceKey);
  }});
  const baseGovernor = createResourceGovernor({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork,
    profileProvider: { current: () => activeMapper }, now, nextPermitId: () => 'permit-' + (++sequence),
    onCapacityChanged:()=>host?.wake() });
  const resourcePriorityBridge=createLibraResourcePriorityBridge({governor:baseGovernor,
    readProjection:scope=>executionProjectionProvider.read(scope),wake:()=>host?.wake()});
  const governor=resourcePriorityBridge.governor;
  const breaker = createCircuitBreaker({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork });
  const executorIncidents = createExecutorIncidentRegistry({ schemaManifest:options.schemaManifest,
    unitOfWork:options.unitOfWork, circuitBreaker:breaker, now });
  const executorIncidentObserver=createExecutorIncidentObserver({schemaManifest:options.schemaManifest,
    unitOfWork:options.unitOfWork,registry:executorIncidents});
  const executorIncidentProjection=Object.freeze({
    projectionForWork:(request)=>executorIncidentObserver.projectionForWork(request),
  });
  const realityVerifiers = Object.fromEntries(['workspace_write', 'external_request', 'domain_fact_commit',
    'responsibility_control_commit', 'material_commit', 'destructive_commit'].map((effectClass) => [effectClass,
    { verify: async ({ receipt }) => ({ verified: true, evidenceDigest: receipt.verificationEvidenceDigest }) }]));
  const effectJournal = createEffectJournal({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork,
    now, realityVerifiers });
  function recoveryReality(effectClass) {
    const observed = (context) => effectJournal.observeRecovery(context.effect.effect_id);
    if (effectClass === 'workspace_write') return { async observe(context) {
      if(['arca.series_presentation.assets.prepare@1','arca.series_presentation.workspace.reclaim@1'].includes(context.event?.capability_ref))return arcaCapabilityRegistration.ports[context.event.capability_ref].observeEffectReality(context);
      if(context.event?.capability_ref==='people.workspace.reclaim@1')return peopleImageExecution.artifactReclamation.ports['people.workspace.reclaim@1'].observeEffectReality(context);
      if(context.event?.capability_ref==='arca.jav_correction.workspace.reclaim@1')return arcaCapabilityRegistration.ports['arca.jav_correction.workspace.reclaim@1'].observeEffectReality(context);
      if(context.event?.capability_ref==='arca.jav_correction.assets.prepare@1')
        return arcaCapabilityRegistration.ports['arca.jav_correction.assets.prepare@1'].observeEffectReality(context);
      if (context.event?.capability_ref === 'libra.product_artifact.acquire@1' &&
          context.work?.process_type === 'libra_run' && typeof context.work.process_id === 'string') {
        let parameters;
        try { parameters = JSON.parse(context.node?.parameters_json || '{}'); } catch { parameters = null; }
        if (!parameters || typeof parameters.artifactKind !== 'string' ||
            typeof libraOptions.workspaceProductPort.observeArtifactReality !== 'function') {
          return { status:'conflict', evidenceDigest:canonicalDigest({
            schema:'libra.workspace-artifact-recovery-context-invalid@1', effectId:context.effect.effect_id,
          }), cleanupDeclared:false };
        }
        const libraRunId=context.work.process_id;
        return libraOptions.workspaceProductPort.observeArtifactReality({
          libraRunId,
          workspaceId:canonicalDigest({schema:'libra.workspace-id@1',libraRunId}),
          relativePath:'product/'+parameters.artifactKind+'.jpg',
          artifactKind:parameters.artifactKind,
        });
      }
      const value = observed(context), committed = value.markers.length === 1;
      return { status: committed ? 'matching' : 'absent', evidenceDigest: canonicalDigest(value), cleanupDeclared: false };
    } };
    if (effectClass === 'external_request') return { async observe(context) {
      const value = observed(context), committed = value.markers.length === 1;
      return { status: committed ? 'committed' : (value.effect.external_receipt_ref ? 'pending' : 'absent'), evidenceDigest: canonicalDigest(value) };
    } };
    if (effectClass === 'domain_fact_commit') return { async observe(context) {
      const value = observed(context), committed = value.markers.length === 1;
      if(!committed&&context.event?.capability_ref==='arca.us_adult.case.commit@1')
        return arcaCapabilityRegistration.ports[context.event.capability_ref].observeEffectReality(context);
      if(!committed&&context.event?.capability_ref==='arca.jav_correction.files.verify@1')
        return arcaCapabilityRegistration.ports[context.event.capability_ref].observeEffectReality(context);
      return { status: committed ? 'committed' : 'absent', revisionMatches: committed, fenceValid: true, evidenceDigest: canonicalDigest(value) };
    } };
    if (effectClass === 'responsibility_control_commit') return { async observe(context) {
      const value = observed(context), committed = value.markers.length === 1;
      if(!committed&&context.event?.capability_ref==='arca.us_adult.inventory.commit@1')
        return arcaCapabilityRegistration.ports[context.event.capability_ref].observeEffectReality(context);
      if(!committed&&context.event?.capability_ref==='arca.jav_correction.inventory.commit@1')
        return arcaCapabilityRegistration.ports[context.event.capability_ref].observeEffectReality(context);
      return { status: committed ? 'whole_established' : 'whole_absent', fenceValid: true, evidenceDigest: canonicalDigest(value) };
    } };
    if (effectClass === 'material_commit') return { async observe(context) {
      if(context.event?.capability_ref==='arca.series_root.files.relocate@1')return arcaCapabilityRegistration.ports[context.event.capability_ref].observeEffectReality(context);
      if(context.event?.capability_ref==='arca.series_presentation.files.publish@1')return arcaCapabilityRegistration.ports[context.event.capability_ref].observeEffectReality(context);
      if(context.event?.capability_ref==='arca.jav_correction.formal_retirement.execute@1')return arcaCapabilityRegistration.ports['arca.jav_correction.formal_retirement.execute@1'].observeEffectReality(context);
      const value = observed(context), committed = value.markers.length === 1;
      if(!committed&&['arca.us_adult.files.stage@1','arca.us_adult.files.publish@1','arca.us_adult.files.retire@1'].includes(context.event?.capability_ref))
        return arcaCapabilityRegistration.ports[context.event.capability_ref].observeEffectReality(context);
      if(!committed&&['arca.jav_correction.files.stage@1','arca.jav_correction.files.publish@1'].includes(context.event?.capability_ref))
        return arcaCapabilityRegistration.ports[context.event.capability_ref].observeEffectReality(context);
      return { status: committed ? 'committed' : 'forward_required', rollbackDeclared: false, evidenceDigest: canonicalDigest(value) };
    } };
    return { async observe(context) {
      const value = observed(context), committed = value.markers.length === 1;
      // Missing receipt proves no filesystem state. The scoped executor must revalidate current reality.
      return { status: committed ? 'complete' : 'revalidation_required', evidenceDigest: canonicalDigest(value) };
    } };
  }
  const effectReconciler = createEffectReconcilerRegistry({ observers: Object.freeze(Object.fromEntries([
    'workspace_write', 'external_request', 'domain_fact_commit', 'responsibility_control_commit', 'material_commit', 'destructive_commit'
  ].map((effectClass) => [effectClass, recoveryReality(effectClass)]))) });
  const processServices = procurementConstruction.createProcessServices({
    ...options, now, workResultReader,
    executionRuntimeHost: { wake() { host?.wake(); } },
  });
  const { triageReader, triageRuleRegistry: triageRegistry, progressReader, procurementAutomation, runCoordinator,
    evidenceIndex, candidateContextReader, fieldObservationAutomation, fieldObservationRetention } = processServices;
  const planningRegistration = procurementConstruction.createPlanningRegistration({ registry, policyRegistry,
    contractValidator, progressReader, triageReader, triageRuleRegistry: triageRegistry, workResultReader,
    evidenceIndex, candidateContextReader, materialFieldStore: options.materialFieldStore, now,
    inspectFieldRoot: options.inspectFieldRoot });
  const workLifecycle = createWorkLifecycle({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork,
    nextWorkAttemptId: (workId, ordinal) => workId + ':attempt:' + ordinal,
    onProcessCancelled: (scope) => executorIncidentObserver.reconcileRecoveryReservations(scope) });
  const arcaOfferResponsibility=createArcaOfferResponsibilityProjection(options),
    customTargetRuntime=createLibraCustomTargetRuntimeSupport({...options,now,workResultReader,materialControlProjectionPort,
      acceptanceSpecContextReader:{read:(...args)=>libraProcessServices.acceptanceSpecContextReader.read(...args)},
      readArcaOfferResponsibility:offer=>arcaOfferResponsibility.read(offer),
      readArcaFormationStatus:offerIds=>arcaProcessServices.formationStatusProjection.read(offerIds),
      cancelProcessWorks:scope=>workLifecycle.cancelProcess(scope)});
  libraProcessServices=libraConstruction.createProcessServices({...libraOptions,peopleReferenceQuery,now,workResultReader,contractValidator,onLibraPriorityChanged:resourcePriorityBridge.refresh,
    customTargetStore:customTargetRuntime.customTargetStore,runExecutionGuard:customTargetRuntime.guard,
    currentRunTargetReader:customTargetRuntime.currentRunTargetReader,readHandoffResponsibility:customTargetRuntime.readHandoffResponsibility,
    readCurrentCustomTargetBaseline:customTargetRuntime.readCurrentCustomTargetBaseline,
    onTaskCancellationChanged:subjectId=>options.onFormationSubjectChanged?.(subjectId),
    onWorkshopTransferred:(subjectId)=>{
      fillPredeckIntakeSeats();options.onFormationSubjectChanged?.(subjectId);host?.wake();
    },
    onWorkshopReadinessObserved:({kind})=>{
      for(const reconcilerKey of kind==='routing'?['active-routing-subjects']:['active-libra-runs','frozen-libra-outcomes'])
        host?.wakeBackground({ownerDomain:'libra',reconcilerKey});
    },
    onLibraWaitingExecutionsObserved:(waiting)=>{
      for(const {runId,eventId,workKind,priorityRevision} of waiting)resourcePriorityBridge.observeWait(eventId,
        {ownerDomain:'libra',processType:'libra_run',processId:runId,workKind},priorityRevision);
      resourcePriorityBridge.refresh();
    },
    readArcaFormationStatus:(offerIds)=>arcaProcessServices.formationStatusProjection.read(offerIds),
    cancelProcessWorks:(scope)=>workLifecycle.cancelProcess(scope),
    resolveRetryPolicyDigest:(capabilityRef)=>canonicalDigest(
      policyRegistry.retryFor(capabilityRef,manifests[capabilityRef].effectClass)),
    movieProductionReader:libraCapabilityRegistration.movieProductionReader,
    offerReader:libraCapabilityRegistration.offerReader,readArcaShelfStandard:libraOptions.readArcaShelfStandard,
    resolvePerceptionRating:(subjectId)=>perceptionProcessServices?.resolveDecisionFact({targetType:'subject',targetId:subjectId})||Object.freeze({kind:'pending'})});
  const customTargetContinuation=customTargetRuntime.createContinuation(libraProcessServices.libraRunCreator);
  const libraPlanningRegistration=libraConstruction.createPlanningRegistration({registry,policyRegistry,contractValidator,
    readJavUnknownActorProjection:()=>peopleReferenceQuery.getPersonReferenceProjection({personId:JAV_UNKNOWN_ACTOR_ID}),
    workResultReader,offerReader:libraProcessServices.offerReader,decisionResolver:libraProcessServices.decisionResolver,
    contextReader:libraProcessServices.routingContextReader,acceptanceSpecContextReader:libraProcessServices.acceptanceSpecContextReader,
    resolveRoutingIntegrationHandle:libraOptions.resolveRoutingIntegrationHandle,
    resolveExternalMaterialIntegrationHandle:libraOptions.resolveExternalMaterialIntegrationHandle,
    readExternalAcquisitionSettings:libraOptions.readExternalAcquisitionSettings,
    movieProductionReader:libraProcessServices.movieProductionReader,routingContextReader:libraProcessServices.routingContextReader,
    productIdentitySelection:libraProcessServices.productIdentitySelection,
    usAdultAnalysisStore:libraProcessServices.usAdultAnalysisStore,
    usAdultActorChoiceStore:libraProcessServices.usAdultActorChoiceStore,
    episodeMetadataMappingStore:libraProcessServices.episodeMetadataMappingStore,
    usAdultMatchCompletionStore:libraProcessServices.usAdultMatchCompletionStore,
    productProductionPort:libraOptions.productProductionPort,workspaceProductPort:libraOptions.workspaceProductPort,
    platformComputeRuntime:libraOptions.platformComputeRuntime,now});
  perceptionProcessServices=perceptionConstruction.createProcessServices({...perceptionOptions,now,workResultReader});
  const perceptionPlanningRegistration=perceptionConstruction.createPlanningRegistration({registry,policyRegistry,contractValidator,
    workResultReader,processServices:perceptionProcessServices,resolvePerceptionIntegrationHandle:options.resolvePerceptionIntegrationHandle,now});
  const arcaProcessServices=arcaConstruction.createProcessServices({...options,now,registry,workResultReader,contractValidator,relocation:arcaCapabilityRegistration.relocation,series:arcaCapabilityRegistration.series,correction:arcaCapabilityRegistration.correction,actorPipelineQuery:arcaCapabilityRegistration.actorPipelineQuery,actorRefreshSource:arcaCapabilityRegistration.actorRefreshSource,peopleReferenceQuery,
    onActorRefreshAdmitted:()=>host?.wakeBackground({ownerDomain:'arca',reconcilerKey:'active-aftercare-cases'}),
    resolveMediaCastReference:input=>peopleProcessServices.mediaCastReferenceQuery.resolve(input),
    computeBoundedMaterialFingerprintSync,
    readBoundedFileSnapshotSync,
    executorIncidentProjection,
    cancelProcessWorks:(scope)=>workLifecycle.cancelProcess(scope),
    contextReader:arcaCapabilityRegistration.contextReader,
    aftercareContextReader:arcaCapabilityRegistration.aftercareContextReader,
    offdeckContextReader:arcaCapabilityRegistration.offdeckContextReader,
    shelfDeregistrationContextReader:arcaCapabilityRegistration.shelfDeregistrationContextReader,
    readPerceptionRating:readShelfEntryRating,readPerceptionRatings:readShelfEntryRatings,
    ensurePerceptionRatingResolution:ensureShelfEntryRatingResolution});
  peopleProcessServices=peopleImageExecution.createProcessServices({
    ...options, now,contractValidator,
    onDeckPersonEvidenceProjection:arcaProcessServices.onDeckPersonEvidenceProjection,
    onDeckNfoPersonEvidence:arcaProcessServices.onDeckNfoPersonEvidence,
  });
  const arcaPlanningRegistration=arcaConstruction.createPlanningRegistration({...options,registry,policyRegistry,contractValidator,workResultReader,
    actorRefreshSource:arcaCapabilityRegistration.actorRefreshSource,
    actorMatchQuery:arcaCapabilityRegistration.actorMatchQuery,
    relocation:arcaCapabilityRegistration.relocation,series:arcaCapabilityRegistration.series,correction:arcaCapabilityRegistration.correction,actorPipelineQuery:arcaCapabilityRegistration.actorPipelineQuery,
    contextReader:arcaProcessServices.contextReader,aftercareContextReader:arcaProcessServices.aftercareContextReader,
    offdeckContextReader:arcaProcessServices.offdeckContextReader,
    shelfDeregistrationContextReader:arcaProcessServices.shelfDeregistrationContextReader,
    materialControlProjectionPort,controlScopeDigest,computeBoundedMaterialFingerprintSync,now});
  const bindingProjectionRegistry = createInputBindingProjectionRegistry({ registrations:[...planningRegistration.bindingProjections,
    ...libraPlanningRegistration.bindingProjections,...perceptionPlanningRegistration.bindingProjections,
    ...arcaPlanningRegistration.bindingProjections,...peopleImageExecution.createPlanningRegistration({registry,policyRegistry}).bindingProjections] });
  const executionInputProvider = createEventExecutionInputProvider({ schemaManifest: options.schemaManifest,
    unitOfWork: options.unitOfWork, contractValidator, bindingProjectionRegistry, workResultReader });
  const attemptPolicy = createAttemptPolicyController({ registry: policyRegistry, now });
  const timeoutController = createTimeoutController({ now,
    isolation:createCooperativeExecutionIsolation({ now }) });
  const dispatcher = createExecutorDispatcher({ registry, contractValidator });
  const eventRuntime = createEventRuntime({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork,contractValidator,
    scheduler, governor, registry, dispatcher, effectJournal, effectReconciler, attemptPolicy, timeoutController, circuitBreaker: breaker,
    dispatchGuard:customTargetRuntime.guard,
    incidentObserver:executorIncidentObserver, failureEvidenceStore:options.failureEvidenceStore,
    onDiagnosticError:options.onError,
    onProgress: (sample) => { if(sample.ownerDomain==='libra'&&sample.processType==='libra_run')options.onFormationRunChanged?.(sample.processId); },
    executionInputProvider, whenEvaluator: { evaluate: () => 'run' },
    fenceValidator: { validate: ({ snapshot }) => {
      const fence = JSON.parse(snapshot.node.fence_basis_json); return { valid: true, digest: canonicalDigest(fence), snapshot: fence };
    } },
    resourceDemandResolver: { resolve: ({ snapshot,inputs,preparationScope }) => {const projection=executionProjectionProvider.read({
      ownerDomain:snapshot.work.owner_domain,processType:snapshot.work.process_type,processId:snapshot.work.process_id,workKind:snapshot.work.work_kind});
      const capability=snapshot.node.capability_ref;let resources=[];
      if(snapshot.work.owner_domain==='people'&&PEOPLE_SYSTEM_ENABLED.includes(capability))
        resources.push({resourceKey:['people.registration_evidence.observe@1','people.merge_evidence.resolve@1'].includes(capability)?'cpu_heavy':'sqlite_write',units:1});
      if(snapshot.work.owner_domain==='people'&&PEOPLE_REFERENCE_ENABLED.includes(capability)){
        const root=options.peopleImagePort?.rootSnapshot?.();if(!root?.mountScopeId||root.state!=='active')throw new Error('P4_TYPED_PEOPLE_VOLUME_RESOURCE_UNRESOLVED');
        validatedVolumeKeys.add(root.mountScopeId);resources.push({resourceKey:'cpu_heavy',units:1},{resourceKey:'volume_read:'+root.mountScopeId,units:1});
        if(capability==='people.workspace.reclaim@1')resources.push({resourceKey:'volume_write:'+root.mountScopeId,units:1},{resourceKey:'sqlite_write',units:1});
      }
      if(snapshot.work.owner_domain==='people'&&PEOPLE_IMAGE_ENABLED.includes(capability)){
        if(capability==='people.reference_fact.commit@1')resources.push({resourceKey:'sqlite_write',units:1});
        else{
          const root=options.peopleImagePort?.rootSnapshot?.();
          if(!root?.mountScopeId||root.state!=='active'||root.rootKind!=='internal-artifact')throw new Error('P4_TYPED_PEOPLE_VOLUME_RESOURCE_UNRESOLVED');
          validatedVolumeKeys.add(root.mountScopeId);resources.push({resourceKey:'volume_read:'+root.mountScopeId,units:1},
            {resourceKey:'volume_write:'+root.mountScopeId,units:1},{resourceKey:'sqlite_write',units:1});
          if(capability==='shared.face.embedding.compute@1')resources.push({resourceKey:'cpu_heavy',units:1});
        }
      }
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
      if(snapshot.work.owner_domain==='libra'&&['libra.media.frames.extract@1','shared.face.embedding.compute@1','shared.face.cluster.compute@1','shared.face.reference.match@1'].includes(capability)){
        const workspaceRoot=libraOptions.workspaceProductPort.rootSnapshot();validatedVolumeKeys.add(workspaceRoot.mountScopeId);
        resources.push({resourceKey:'cpu_heavy',units:1},{resourceKey:'volume_read:'+workspaceRoot.mountScopeId,units:1});
        if(capability!=='shared.face.reference.match@1')resources.push({resourceKey:'volume_write:'+workspaceRoot.mountScopeId,units:1},{resourceKey:'sqlite_write',units:1});
        if(capability==='libra.media.frames.extract@1'){
          const mountScopeId=findMountScopeId(inputs);if(!mountScopeId)throw new Error('P4_TYPED_US_ADULT_SOURCE_VOLUME_UNRESOLVED');
          validatedVolumeKeys.add(mountScopeId);resources.push({resourceKey:'volume_read:'+mountScopeId,units:1});
          resources=mergeResourceDemands(resources);
        }
      }
      if(['libra.western.analysis.request@1','libra.western.analysis.observe@1','libra.western.metadata.normalize@1','libra.western.poster.render@1'].includes(capability)){
        const workspaceRoot=libraOptions.workspaceProductPort.rootSnapshot();validatedVolumeKeys.add(workspaceRoot.mountScopeId);
        resources.push({resourceKey:'cpu_heavy',units:1},{resourceKey:'volume_read:'+workspaceRoot.mountScopeId,units:1});
        if(['libra.western.analysis.request@1','libra.western.poster.render@1'].includes(capability))
          resources.push({resourceKey:'volume_write:'+workspaceRoot.mountScopeId,units:1},{resourceKey:'sqlite_write',units:1});
      }
      if(capability==='shared.artifact.manifest.verify@1'){
        const workspaceRoot=libraOptions.workspaceProductPort.rootSnapshot();validatedVolumeKeys.add(workspaceRoot.mountScopeId);
        resources.push({resourceKey:'volume_read:'+workspaceRoot.mountScopeId,units:1});
      }
      if(capability==='libra.transcode.input.verify@1'||capability==='libra.product_media.verify@1'){
        const mountScopeId=findMountScopeId(inputs);if(!mountScopeId)throw new Error('P4_TYPED_MEDIA_VOLUME_UNRESOLVED:'+capability);
        validatedVolumeKeys.add(mountScopeId);resources.push({resourceKey:'volume_read:'+mountScopeId,
          units:volumeReadUnitsForCapability(capability)});
        if(capability==='libra.transcode.input.verify@1'){
          const device=inputs.namedInputs?.mediaExecutionDeviceSnapshot,slots=device?.capabilityPayload?.validatedConcurrentSlots;
          if(!device?.deviceId||!Number.isSafeInteger(slots)||slots<1)
            throw new Error('P4_TYPED_TRANSCODE_PREFLIGHT_DEVICE_UNRESOLVED');
          validatedEncoderSlots.set(device.deviceId,slots);
          resources.push({resourceKey:'encoder:'+device.deviceId,units:1});
          if(device.deviceClass==='software_cpu')resources.push({resourceKey:'cpu_heavy',units:1});
        }
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
        // Assessment commit has no material I/O demand. Its business context is
        // already validated by the input/Fence path; do not re-read ratings just
        // to declare the fixed SQLite write resource.
        else if(capability==='arca.aftercare.assessment.commit@1')resources.push({resourceKey:'sqlite_write',units:1});
        else if(capability.startsWith('arca.series_root.')){
          const ref=inputs.namedInputs.seriesRootRelocationReference,row=arcaCapabilityRegistration.relocation.relocationStore.read(snapshot.work.process_id);
          if(row?.plan_digest!==ref?.planDigest)throw new Error('P4_TYPED_SERIES_RELOCATION_UNRESOLVED');
          const mount=row.plan.mountScopeId;validatedVolumeKeys.add(mount);resources.push({resourceKey:'volume_read:'+mount,units:1});
          if(capability==='arca.series_root.files.relocate@1')resources.push({resourceKey:'volume_write:'+mount,units:1},{resourceKey:'volume_mutation:'+mount,units:1});
          else resources.push({resourceKey:'sqlite_write',units:1});
        }
        else if(capability.startsWith('arca.series_presentation.')){
          const scope=inputs.namedInputs.seriesPresentationScope,series=arcaCapabilityRegistration.series,workspaceMount=series.rootSnapshot.mountScopeId;
          if(scope?.digest!==series.seriesStore.build(snapshot.work.process_id)?.digest)throw new Error('P4_TYPED_SERIES_SCOPE_UNRESOLVED');
          for(const mount of new Set([scope.mountScopeId,workspaceMount])){validatedVolumeKeys.add(mount);resources.push({resourceKey:'volume_read:'+mount,units:1});}
          if(['arca.series_presentation.source.observe@1','arca.series_presentation.assets.prepare@1'].includes(capability)&&(scope.supplementalSources.length<2||scope.basis.schema==='shelfdeck.series-presentation-maintenance@1')){
            const integrationId=scope.imageSourceQualification.integrationId;validatedIntegrationKeys.add(integrationId);resources.push({resourceKey:'integration:'+integrationId,units:1});
          }
          if(['arca.series_presentation.assets.prepare@1','arca.series_presentation.workspace.reclaim@1'].includes(capability))resources.push({resourceKey:'volume_write:'+workspaceMount,units:1});
          if(capability==='arca.series_presentation.files.publish@1')resources.push({resourceKey:'volume_write:'+scope.mountScopeId,units:1},{resourceKey:'volume_mutation:'+scope.mountScopeId,units:1});
          if(capability==='arca.series_presentation.inventory.commit@1')resources.push({resourceKey:'sqlite_write',units:1},{resourceKey:'control_commit',units:1});
        }
        else {
        const refs=workResultReader.readBindings(snapshot.work.work_id).flatMap((item)=>item.inputBindings?.bindings||[])
          .find((item)=>Array.isArray(item.parameters?.dependencyRefs))?.parameters.dependencyRefs||[];
        const isAftercare=snapshot.work.process_type==='arca_shelf_entry',isOffdeck=snapshot.work.process_type==='arca_offdeck_case',isOffdeckAutomation=snapshot.work.process_type==='arca_offdeck_automation',
          isCorrection=snapshot.work.process_type==='arca_jav_identity_correction';
        const settlementMaterialKey=inputs.namedInputs?.oldPrimaryStructuralExclusiveRelatedHandleList?.members?.[0]?.materialKey;
        const arcaContext=isOffdeckAutomation?null:isCorrection?['arca.jav_correction.formal_retirement.execute@1','arca.jav_correction.workspace.reclaim@1'].includes(capability)?arcaProcessServices.aftercareContextReader.read(arcaProcessServices.correction.correctionStore.get(snapshot.work.process_id).shelfEntryId):arcaProcessServices.correction.correctionContextReader.read(snapshot.work.process_id).context:
          isOffdeck?arcaProcessServices.offdeckContextReader.read(snapshot.work.process_id):isAftercare
          ?arcaProcessServices.aftercareContextReader.read(snapshot.work.process_id)
          :snapshot.work.process_type==='arca_ondeck_run'
            ?capability==='arca.ondeck.input_settlement.delete@1'
              ?arcaProcessServices.contextReader.readSettlement(snapshot.work.process_id,refs,settlementMaterialKey,
                { preparationScope, eventId:snapshot.event.event_id })
              :arcaProcessServices.contextReader.readAccepted(snapshot.work.process_id,refs)
            :arcaProcessServices.contextReader.readOffer(refs);
        const targetMount=isOffdeckAutomation?null:isOffdeck?arcaContext.snapshot.shelf.target_mount_scope_id:isAftercare||isCorrection?arcaContext.raw.shelf.target_mount_scope_id:arcaContext.shelf.target.mountScopeId;
        if(capability.startsWith('arca.us_adult.')){
          const workspaceMount=arcaProcessServices.aftercareContextReader.store.aftercareWorkspaceRootSnapshot.mountScopeId,
            mounts=new Set([targetMount,...arcaContext.raw.materials.map(item=>item.mount_scope_id)]);
          if(!workspaceMount||!targetMount)throw new Error('P4_TYPED_US_ADULT_VOLUME_UNRESOLVED');
          validatedVolumeKeys.add(workspaceMount);resources.push({resourceKey:'volume_read:'+workspaceMount,units:1});
          for(const mount of mounts){validatedVolumeKeys.add(mount);resources.push({resourceKey:'volume_read:'+mount,units:1});}
          if(['arca.us_adult.source.prepare@1','arca.us_adult.assets.prepare@1'].includes(capability))
            resources.push({resourceKey:'volume_write:'+workspaceMount,units:1},{resourceKey:'sqlite_write',units:1});
          if(['arca.us_adult.source.prepare@1','arca.us_adult.references.match@1','arca.us_adult.assets.prepare@1'].includes(capability))
            resources.push({resourceKey:'cpu_heavy',units:1});
          if(['arca.us_adult.files.stage@1','arca.us_adult.files.publish@1','arca.us_adult.files.retire@1'].includes(capability))
            for(const mount of mounts)resources.push({resourceKey:'volume_mutation:'+mount,units:1});
          if(['arca.us_adult.inventory.commit@1','arca.us_adult.case.commit@1'].includes(capability))
            resources.push({resourceKey:'sqlite_write',units:1});
        }
        if(isCorrection&&['arca.jav_correction.source.verify@1','arca.jav_correction.assets.prepare@1'].includes(capability)) {
          const qualification=arcaProcessServices.correction.correctionStore.get(snapshot.work.process_id).proof.proposal.sourceQualification,
            source=qualification.sourceSnapshot.sources[qualification.sourceOrdinal];
          validatedIntegrationKeys.add(source.integrationId);resources.push({resourceKey:'integration:'+source.integrationId,units:1});
        }
        if(capability==='arca.jav_correction.assets.prepare@1'){
          const workspaceMount=arcaProcessServices.correction.rootSnapshot.mountScopeId;validatedVolumeKeys.add(workspaceMount);
          resources.push({resourceKey:'volume_write:'+workspaceMount,units:1},{resourceKey:'sqlite_write',units:1});
        }
        if(capability==='arca.jav_correction.workspace.reclaim@1'){
          const workspaceMount=arcaProcessServices.correction.rootSnapshot.mountScopeId;validatedVolumeKeys.add(workspaceMount);
          resources.push({resourceKey:'volume_read:'+workspaceMount,units:1},{resourceKey:'volume_write:'+workspaceMount,units:1},
            {resourceKey:'volume_mutation:'+workspaceMount,units:1},{resourceKey:'sqlite_write',units:1});
        }
        if(['arca.jav_correction.files.stage@1','arca.jav_correction.files.publish@1','arca.jav_correction.files.verify@1','arca.jav_correction.inventory.commit@1','arca.jav_correction.formal_retirement.execute@1'].includes(capability)) {
          const mounts=new Set(arcaContext.raw.materials.map(item=>item.mount_scope_id));mounts.add(arcaProcessServices.correction.rootSnapshot.mountScopeId);
          if(capability==='arca.jav_correction.formal_retirement.execute@1')for(const item of arcaProcessServices.correction.correctionStore.get(snapshot.work.process_id).proof.basis.materials)mounts.add(item.physicalIdentity.mountScopeId);
          for(const mount of mounts){validatedVolumeKeys.add(mount);resources.push({resourceKey:'volume_read:'+mount,units:1});}
          if(!['arca.jav_correction.files.verify@1','arca.jav_correction.inventory.commit@1'].includes(capability))resources.push({resourceKey:'volume_write:'+targetMount,units:1});
          else if(!mounts.has(targetMount))resources.push({resourceKey:'volume_read:'+targetMount,units:1});
          resources.push({resourceKey:'sqlite_write',units:1});
          if(['arca.jav_correction.files.publish@1','arca.jav_correction.formal_retirement.execute@1'].includes(capability))for(const mount of mounts)resources.push({resourceKey:'volume_mutation:'+mount,units:1});
        }
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
        if(['arca.acceptance.identity.verify@1','arca.acceptance.structure.verify@1','arca.acceptance.metadata.verify@1',
          'arca.acceptance.mandatory_media.verify@1','arca.acceptance.space.verify@1','arca.inventory.product.stage@1',
          'arca.inventory.final_product.verify@1','arca.ondeck.fulfillment.verify@1',
          'arca.acceptance.accept.commit@1','arca.acceptance.rejection.commit@1','arca.ondeck.commit@1'].includes(capability))
          resources.push({resourceKey:'sqlite_write',units:1});
        if(['arca.aftercare.custody.observe@1','arca.aftercare.presentation.observe@1',
          'arca.aftercare.conformance.observe@1'].includes(capability))resources.push({resourceKey:'volume_read:'+targetMount,units:1});
        if(['arca.aftercare.text_artifact.render@1','arca.aftercare.media.remux@1',
          'arca.aftercare.media.transcode@1'].includes(capability)){
          if(!targetMount)throw new Error('P4_TYPED_AFTERCARE_SHELF_VOLUME_UNRESOLVED');
          const workspaceMount=options.aftercareWorkspaceMountScopeId||'aftercare_workspace_local';validatedVolumeKeys.add(workspaceMount);resources.push({resourceKey:'volume_read:'+targetMount,units:1},{resourceKey:'volume_write:'+workspaceMount,units:1});
          if(capability==='arca.aftercare.media.transcode@1'){
            const device=inputs.namedInputs?.aftercareMediaRepairStrategy?.selectedDeviceSnapshot,slots=device?.capabilityPayload?.validatedConcurrentSlots;
            if(!device?.deviceId||!Number.isSafeInteger(slots)||slots<1)throw new Error('P4_TYPED_AFTERCARE_TRANSCODE_DEVICE_UNRESOLVED');
            validatedEncoderSlots.set(device.deviceId,slots);resources.push({resourceKey:'encoder:'+device.deviceId,units:1});
            if(device.deviceClass==='software_cpu')resources.push({resourceKey:'cpu_heavy',units:1});
          }
        }
        if(capability==='arca.aftercare.binary_artifact.acquire@1'){
          const integrationId=findIntegrationId(inputs);if(!integrationId)throw new Error('P4_TYPED_AFTERCARE_INTEGRATION_UNRESOLVED');
          const workspaceMount=options.aftercareWorkspaceMountScopeId||'aftercare_workspace_local';validatedIntegrationKeys.add(integrationId);resources.push({resourceKey:'integration:'+integrationId,units:1},{resourceKey:'volume_write:'+workspaceMount,units:1});validatedVolumeKeys.add(workspaceMount);
        }
        if(capability==='arca.aftercare.artifact.materialize@1'){
          const workspaceMount=options.aftercareWorkspaceMountScopeId||'aftercare_workspace_local';validatedVolumeKeys.add(workspaceMount);resources.push({resourceKey:'volume_read:'+workspaceMount,units:1},{resourceKey:'volume_mutation:'+targetMount,units:1});
        }
        if(capability==='arca.aftercare.media.verify@1'){
          if(!targetMount)throw new Error('P4_TYPED_AFTERCARE_SHELF_VOLUME_UNRESOLVED');
          const workspaceMount=options.aftercareWorkspaceMountScopeId||'aftercare_workspace_local';validatedVolumeKeys.add(workspaceMount);resources.push({resourceKey:'volume_read:'+targetMount,units:1},{resourceKey:'volume_read:'+workspaceMount,units:1});
        }
        if(capability==='arca.aftercare.input_settlement.delete@1')resources.push({resourceKey:'volume_mutation:'+targetMount,units:1});
        if(capability==='arca.aftercare.workspace.reclaim@1'){
          const workspaceMount=options.aftercareWorkspaceMountScopeId||'aftercare_workspace_local';validatedVolumeKeys.add(workspaceMount);resources.push({resourceKey:'volume_mutation:'+workspaceMount,units:1});
        }
        if(['arca.aftercare.inventory.commit@1','arca.aftercare.case.commit@1'].includes(capability))
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
      if(capability==='arca.aftercare.media.verify@1'||capability.startsWith('arca.us_adult.'))resources=mergeResourceDemands(resources);
      if(snapshot.work.owner_domain==='libra'&&snapshot.work.process_type==='libra_run')resourcePriorityBridge.recordScope(snapshot.event.event_id,{
        ownerDomain:'libra',processType:'libra_run',processId:snapshot.work.process_id,workKind:snapshot.work.work_kind});
      return {eventId:snapshot.event.event_id,queueClass:projection.priorityClass,localPriority:projection.localPriority,
        priorityRevision:projection.priorityRevision,resources}; } },
    nextEventAttemptId: () => 'event-attempt-' + randomUUID(), nextExecutionId: () => 'execution-' + randomUUID(),
    nextResultId: () => 'event-result-' + randomUUID(), now });
  const plannerKinds = ['field_observation', 'evidence_assessment', 'candidate_assembly'];
  const libraPlannerKinds=['evidence','acceptance','rejection','routing_nfo_facts','routing_provider_facts','routing_basis','acceptance_spec_basis',
    'product_identity','product_metadata_observation','artifact_production','product_fact_assembly','workspace_media_production',
    'product_conformance','deliverable_promotion','us_adult_analysis','us_adult_product'];
  const perceptionPlannerKinds=['acquisition_page','resolution'];
  const arcaPlannerKinds=['series_root_relocation','series_presentation','series_presentation_reclaim','us_adult_actor_source','us_adult_actor_match','us_adult_actor_assets','us_adult_actor_stage','us_adult_actor_publish','us_adult_actor_verify','us_adult_actor_commit','us_adult_actor_retire','us_adult_actor_close','us_adult_actor_discard','acceptance_assessment','acceptance_commit','acceptance_rejection','on_deck_execution','health_assessment','custody_assessment','periodic_health_assessment','periodic_custody_assessment','care_repair_prepare','care_repair_commit','care_case_closure','care_deregistration_settlement','care_workspace_reclaim','offdeck_policy_evaluation','offdeck_duplicate_detection','offdeck_scope_verification','offdeck_material_destruction','offdeck_terminal_commit','shelf_deregistration_manifest_verify','shelf_deregistration_commit','jav_correction_assets','jav_correction_files','jav_correction_publish','jav_correction_verify','jav_correction_commit','jav_correction_formal_retirement','jav_correction_workspace_reclaim'];
  const plannerRegistry = createPlannerRegistry({ registrations: [...planningRegistration.planners.map((planner, index) => ({
    ownerDomain: 'procurement', workKind: plannerKinds[index], plannerContractRef: planner.plannerContractRef,
    plannerVersion: planner.plannerVersion, planner
  })),...libraPlanningRegistration.planners.map((planner,index)=>({ownerDomain:'libra',workKind:libraPlannerKinds[index],
    plannerContractRef:planner.plannerContractRef,plannerVersion:planner.plannerVersion,planner})),...perceptionPlanningRegistration.planners.map((planner,index)=>({ownerDomain:'perception',workKind:perceptionPlannerKinds[index],
    plannerContractRef:planner.plannerContractRef,plannerVersion:planner.plannerVersion,planner})),...arcaPlanningRegistration.planners.map((planner,index)=>({ownerDomain:'arca',workKind:arcaPlannerKinds[index],
    plannerContractRef:planner.plannerContractRef,plannerVersion:planner.plannerVersion,planner})),
    ...peopleImageExecution.createPlanningRegistration({registry,policyRegistry}).planners] });
  const planPublisher = createWorkflowPlanPublisher({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork,
    registry, contractValidator, policyRegistry });
  const catalogDigest = executionCatalogDigest(registry, policyRegistry);
  const catalogProofReader = createCatalogPlanProofReader({ schemaManifest:options.schemaManifest, unitOfWork:options.unitOfWork });
  const terminalEffectObserver = arcaConstruction.createTerminalEffectHistoryObserver({ ...options, workResultReader,
    stageHistoryLibraBindingReader:LibraExecutionRegistration.createMaterialBindingScopeReader(options),
    readTechnicalWork:workId => catalogProofReader.verify(reader => reader.workPlanIds(workId).map(id => reader.read(id))) });
  const catalogVerifier = createStoredPlanContractVerifier({ registry, policyRegistry, contractValidator,
    ownerCommandContracts: [require('../domains/procurement/public').retryCommandExecutionContract],
    bindingProjectionRegistry, proofReader: catalogProofReader, terminalEffectObserver,
    onRejected: options.onHistoricalCatalogRejected });
  const startupRecovery = createStartupRecovery({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork,
    standaloneEffectClasses: Object.freeze(['libra_workspace_material_reclaim', 'arca_recycle_move', 'arca_recycle_restore', 'arca_recycle_purge']),
    registry, policyRegistry, integrityVerifier: { verify: () => ({ ok: true }) },
    catalogVerifier, effectReconciler, effectJournal });
  function fillPredeckIntakeSeats() {
    libraProcessServices.coordinator.reconcilePending({ admissionLimit: DEFAULT_PREDECK_PIPELINE_SEATS });
  }
  function drainCompletedWorkspaces() {
    completedWorkspaceSweepNotBeforeMs = 0;
    activeCleanupSweepNotBeforeMs = 0;
    discardedLeftoverSweepNotBeforeMs = 0;
    let cursor = null;
    let pendingAudit = false;
    for (;;) {
      const page = workspaceReclaimer.listCompletedWorkspacePage(cursor, 100);
      if (!page.length) break;
      for (const item of page) {
        if (item.scope?.skipped) continue;
        const result = workspaceReclaimer.reconcileCompletedWorkspace(item.scope);
        if (result?.stage === 'workspace_cleanup_audit_pending') pendingAudit = true;
      }
      if (page.length < 100) break;
      cursor = page.at(-1).cursor;
    }
    cursor = null;
    for (;;) {
      const page = workspaceReclaimer.listDiscardedLeftoverWorkspacePage(cursor, 100);
      if (!page.length) break;
      for (const item of page) {
        if (item.scope?.skipped) continue;
        workspaceReclaimer.reconcileDiscardedLeftoverWorkspace(item.scope);
      }
      if (page.length < 100) break;
      cursor = page.at(-1).cursor;
    }
    completedWorkspaceSweepNotBeforeMs = now() + (pendingAudit ? 60_000 : WORKSPACE_RECLAIMER_FALLBACK_MS);
    discardedLeftoverSweepNotBeforeMs = now() + WORKSPACE_RECLAIMER_FALLBACK_MS;
    return Object.freeze({ kind: 'wake_recorded', pendingAudit });
  }
  function hasReadyEncodeDevice() {
    const runtime = libraOptions.platformComputeRuntime;
    if (!runtime || typeof runtime.listReadyDeviceRefs !== 'function') return false;
    const listQuery = { queryContract: 'platform.compute-ready-device-refs@1', limit: 64 };
    listQuery.queryDigest = canonicalDigest(listQuery);
    try {
      const listed = runtime.listReadyDeviceRefs(listQuery);
      return listed?.resultKind === 'available' && Array.isArray(listed.items) && listed.items.length > 0;
    } catch {
      return false;
    }
  }
  function reconcileLibraRun(libraRunId) {
    const continuation=reconcileConfirmedTargetForRun({libraRunId,targetReader:customTargetRuntime.currentRunTargetReader,
      customTargetStore:customTargetRuntime.customTargetStore,continuation:customTargetContinuation});
    if(continuation){
      if(continuation.kind==='admitted'&&continuation.libraRunId&&continuation.libraRunId!==libraRunId)
        return reconcileLibraRun(continuation.libraRunId);
      return continuation;
    }
    resumeBlockedTranscodeAssessments({libraRunId,hasReadyEncodeDevice,workResultReader,guard:customTargetRuntime.guard,
      workLifecycle,wake:()=>host?.wake()});
    const result = libraProcessServices.libraRunCoordinator.reconcile(libraRunId);
    if (result?.kind === 'replacement_required') {
      const replacement = libraProcessServices.libraRunCreator.replace(
        result.subjectId,
        libraRunId,
      );
      if (replacement.libraRunId)
        return libraProcessServices.libraRunCoordinator.reconcile(
          replacement.libraRunId,
        );
      fillPredeckIntakeSeats();
      return replacement;
    }
    if (result?.kind === 'terminal' || result?.state === 'completed' || result?.state === 'discarded') {
      fillPredeckIntakeSeats();
    }
    return result;
  }
  const domainReconciler = { async reconcile(request) {
    if(request.reconcilePhase==='attempt_terminal'){
      if(request.ownerDomain==='libra'&&request.processType==='libra_intake'&&request.workKind==='acceptance'&&
          request.workAttemptState==='failed'&&request.workAttemptFailureCode==='P8_ACCEPTANCE_CONTINUITY_BASIS_STALE'){
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
    if(request.ownerDomain==='people'&&request.processType==='people_artifact_reclamation'){host?.wakeBackground({ownerDomain:'people',reconcilerKey:'reference-artifact-reclamation'});return {workId:request.workId,disposition:request.workAttemptState};}
    if(request.ownerDomain==='people'&&['people_system_registration','people_system_merge'].includes(request.processType))return {workId:request.workId,disposition:request.workAttemptState};
    if(request.ownerDomain==='people'&&request.processType==='people_image_preparation'){
      peopleProcessServices.imageOperations.reconcile(request.processId);
      return {workId:request.workId,disposition:request.workAttemptState};
    }
    if(request.ownerDomain==='libra'&&request.processType==='libra_intake'){
      const intake=libraProcessServices.coordinator.reconcile(request.processId);
      if(request.workKind==='acceptance'&&request.workAttemptState==='succeeded'){
        const receipt=workResultReader.read(request.workId).find((item)=>item.outcomeKind==='succeeded'&&item.result?.subjectId)?.result;
        if(receipt?.subjectId){libraProcessServices.routingCoordinator.reconcile(receipt.subjectId);options.onFormationSubjectChanged?.(receipt.subjectId);}
      }
      if(['acceptance','rejection'].includes(request.workKind)&&request.workAttemptState==='succeeded'){
        libraProcessServices.coordinator.reconcilePending({ignoreAcceptanceProcessId:request.processId,limit:100,
          admissionLimit:DEFAULT_PREDECK_PIPELINE_SEATS});
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
      if(request.workAttemptState==='failed'&&['P8_ACCEPTANCE_SPEC_PLANNING_BASIS_STALE','P4_EXECUTION_INPUT_BASIS_SUPERSEDED'].includes(request.workAttemptFailureCode)){
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
      else if(['failed','blocked','cancelled'].includes(request.workAttemptState))
        arcaProcessServices.coordinator.recordTerminalFailure({processId:request.processId,workId:request.workId,
          workKind:request.workKind,errorCode:request.workAttemptFailureCode,incidentRef:request.incidentRefs?.[0]||null});
      return {workId:request.workId,disposition:request.workAttemptState};
    }
    if(request.ownerDomain==='arca'&&request.processType==='arca_series_root_relocation'){
      const row=arcaCapabilityRegistration.relocation.relocationStore.read(request.processId);
      if(request.workAttemptState==='succeeded'&&row?.state==='committed')for(const member of row.plan.seasons)
        arcaProcessServices.aftercareCoordinator.sharedPresentationChanged(member.shelfEntryId,'series-relocation:'+request.processId);
      return {workId:request.workId,disposition:request.workAttemptState};
    }
    if(request.ownerDomain==='arca'&&request.processType==='arca_series_presentation'){
      if(['succeeded','failed','cancelled'].includes(request.workAttemptState)){
        if(request.workKind!=='series_presentation_reclaim'){
          if(request.workAttemptState==='succeeded')arcaCapabilityRegistration.series.reclaim(request.processId);
          arcaProcessServices.coordinator.reconcileSeries(request.processId);
        }
        const store=arcaCapabilityRegistration.series.seriesStore,scope=store.build(request.processId);
        const ids=new Set(store.read('references',{scope_id:scope.scopeId}).filter(row=>row.state==='active').map(row=>row.shelf_entry_id));
        if(scope.basis.entryBinding)ids.add(scope.basis.entryBinding.shelfEntryId);
        for(const entryId of ids)arcaProcessServices.aftercareCoordinator.sharedPresentationChanged(entryId,'series-shared:'+request.processId+':'+request.workAttemptState);
      }
      return {workId:request.workId,disposition:request.workAttemptState};
    }
    if(request.ownerDomain==='arca'&&request.processType==='arca_ondeck_run'){
      if(request.workAttemptState==='succeeded'){
        const terminal=arcaProcessServices.coordinator.reconcileOnDeck(request.processId);
        const shelfEntryId=terminal?.result?.onDeckCommitReceipt?.shelfEntryId;
        if(terminal?.kind==='terminal'&&shelfEntryId)
          arcaProcessServices.aftercareCoordinator.reconcile(shelfEntryId);
      }else if(['failed','cancelled'].includes(request.workAttemptState)){
        const blocked=arcaProcessServices.coordinator.blockOnDeck(request.processId);
        if(blocked?.subjectId)options.onFormationSubjectChanged?.(blocked.subjectId);
      }
      return {workId:request.workId,disposition:request.workAttemptState};
    }
    if(request.ownerDomain==='arca'&&request.processType==='arca_shelf_entry'){
      if (['periodic_health_assessment', 'periodic_custody_assessment', 'care_workspace_reclaim'].includes(request.workKind) &&
          options.executionEligibilityProvider?.check(request) === false) {
        return { workId:request.workId, disposition:request.workAttemptState };
      }
      if(request.workAttemptState==='succeeded')arcaProcessServices.aftercareCoordinator.reconcileAssessmentCompletion(request.processId,request.workId);
      else if(request.workAttemptState==='failed'&&request.workKind.startsWith('us_adult_actor_'))arcaProcessServices.aftercareCoordinator.reconcile(request.processId);
      return {workId:request.workId,disposition:request.workAttemptState};
    }
    if(request.ownerDomain==='arca'&&request.processType==='arca_jav_identity_correction'){
      return Promise.resolve(arcaProcessServices.correction.coordinator.reconcile(request.processId))
        .then(()=>({workId:request.workId,disposition:request.workAttemptState}));
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
      if (options.executionEligibilityProvider?.check(request) === false) {
        return { workId:request.workId, disposition:request.workAttemptState };
      }
      if(request.workAttemptState==='succeeded'){
        const acquisition=perceptionProcessServices.reconcileAcquisition(request.processId);
        const context=perceptionProcessServices.acquisitionContext(request.processId);
        if(acquisition.kind==='terminal'&&context?.scope?.mode==='direct'){
          const target=context.scope.target;
          const factKind=context.scope.directInput.sourceRecordKey.startsWith('shelfdeck:watched:')?'watched':'rating';
          // Both query snapshots include the same immutable candidate record set.
          // Refresh each independent fact after a direct record changes that set.
          perceptionProcessServices.ensureResolution(target.targetType,target.targetId,'rating');
          perceptionProcessServices.ensureResolution(target.targetType,target.targetId,'watched');
          if(factKind==='rating'&&target.targetType==='subject')libraProcessServices.acceptanceSpecCoordinator.reconcile(target.targetId);
        }
        // Provider-wide rating fan-out is intentionally left to the durable,
        // bounded Domain Reconcile cursors below. Never scan every Subject on
        // the terminal Event callback that is also serving Admin Web traffic.
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
          const spec = libraProcessServices.acceptanceSpecCoordinator.reconcile(subjectId);
          if (spec.kind === 'terminal') {
            // A formal-identity rating refresh can retain the same requirements.
            // There is then no new Spec Work completion to resume the waiting Run.
            const run = libraProcessServices.libraRunCreator.reconcile(subjectId);
            if (run.libraRunId) libraProcessServices.libraRunCoordinator.reconcile(run.libraRunId);
          }
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
  const planHistoryAudit = createPlanHistoryAudit({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork,
    proofReader: catalogProofReader, verifier: catalogVerifier, cursorStore, now,
    onFinding: finding => options.onError?.(Object.assign(new Error('Historical Plan audit requires attention.'),
      { code: finding.findingCode, details: finding })) });
  const workspaceReclaimer=createMovieResponsibilityClosureCoordinator({...options,now,
    offloadCompletionPort:createOffloadCompletionPort(options),workspaceProductPort:libraOptions.workspaceProductPort,
    offloadWakeVisible:false});
  const WORKSPACE_RECLAIMER_FALLBACK_MS=15*60*1000;
  let completedWorkspaceSweepNotBeforeMs=0,activeCleanupSweepNotBeforeMs=0,discardedLeftoverSweepNotBeforeMs=0;
  let activeCleanupRoundHasPending=false;
  let offdeckPolicySweepNotBeforeMs=0,offdeckDuplicateSweepNotBeforeMs=0;
  const pipelineSubjectPage=(cursor,limit)=>libraProcessServices.pipelineAdmission.listTokens()
    .filter((item)=>(cursor===null||item.subjectId>cursor)&&Boolean(libraProcessServices.routingContextReader.read(item.subjectId))).slice(0,limit)
    .map((item)=>Object.freeze({cursor:item.subjectId,scope:Object.freeze({subjectId:item.subjectId})}));
  const fallbackReconciler=createDomainReconcileRunner({cursorStore,now,onError:options.onError,
    reconcileEligibilityProvider:options.reconcileEligibilityProvider,onReconcileScopeStarted:options.onReconcileScopeStarted,
    registrations:[Object.freeze({ownerDomain:'execution-foundation',reconcilerKey:'storage-maintenance',
      listPage:()=>options.storageMaintenance&&options.maintenanceWindowKey?.()?[{cursor:'storage',scope:{}}]:[],
      reconcile:async()=>{
        await planHistoryAudit.scan();
        const key={ownerDomain:'execution-foundation',reconcilerKey:'storage-reference-audit-progress'},head=cursorStore.read(key),
          progress=head.cursor?JSON.parse(head.cursor):{cursor:null,finishedWindow:null,optimizedWindow:null},window=options.maintenanceWindowKey();
        if(progress.finishedWindow===window)return {kind:'complete'};
        const cursor=progress.finishedWindow!==null?null:progress.cursor;
        const result=options.storageMaintenance.auditReferenceSample(cursor,32);
        if(progress.optimizedWindow!==window)options.storageMaintenance.optimize();
        cursorStore.advance({...key,expectedRevision:head.revision,cursor:JSON.stringify({cursor:result.nextCursor,
          finishedWindow:result.nextCursor===null?window:null,optimizedWindow:window})});
        return {kind:'audited'};
      },
    }),Object.freeze({ownerDomain:'libra',reconcilerKey:'task-cancellations',
      listPage:page=>libraProcessServices.libraRunAdminService.listPendingCancellations(page),
      reconcile:({subjectId})=>libraProcessServices.libraRunAdminService.reconcileCancellation(subjectId),
    }),Object.freeze({ownerDomain:'people',reconcilerKey:'image-operations',
      listPage:page=>peopleProcessServices.imageOperations.listPendingPage(page),
      reconcile:({operationId})=>peopleProcessServices.imageOperations.reconcile(operationId),
    }),Object.freeze({ownerDomain:'arca',reconcilerKey:'recycle-expiry',
      listPage:()=>options.recycleExpiryTick?[{cursor:'expiry',scope:{}}]:[],reconcile:()=>options.recycleExpiryTick(),
    }),Object.freeze({ownerDomain:'arca',reconcilerKey:'recycle-maintenance',listPage:()=>options.recycleTick?[{cursor:'recycle',scope:{}}]:[],reconcile:()=>options.recycleTick()}),Object.freeze({
    ownerDomain:'procurement',reconcilerKey:'active-procurement-runs',
    listPage:({cursor,limit})=>triageReader.listActiveRunPage(cursor,limit),
    reconcile:({procurementRunId})=>runCoordinator.reconcile(procurementRunId),
  }),Object.freeze({ownerDomain:'procurement',reconcilerKey:'retired-field-control',
    listPage:page=>processServices.retiredFieldControl.listPage(page),
    reconcile:({fieldId})=>processServices.retiredFieldControl.reconcile(fieldId),
  }),Object.freeze({
    ownerDomain:'procurement',reconcilerKey:'active-material-fields',
    listPage:({cursor,limit})=>fieldObservationAutomation
      ? fieldObservationAutomation.listPage({cursor,limit})
      : [],
    reconcile:({fieldId})=>fieldObservationAutomation
      ? fieldObservationAutomation.reconcile({fieldId})
      : Object.freeze({kind:'unavailable',fieldId}),
  }),Object.freeze({
    ownerDomain:'procurement',reconcilerKey:'field-observation-entry-retention',
    listPage:({cursor,limit})=>fieldObservationRetention
      ? fieldObservationRetention.listPage({cursor,limit})
      : [],
    reconcile:()=>fieldObservationRetention
      ? fieldObservationRetention.reconcile()
      : Object.freeze({kind:'unavailable'}),
    nextDueAtMs:()=>fieldObservationRetention?.nextDueAtMs() || null,
  }),Object.freeze({ownerDomain:'libra',reconcilerKey:'pending-intake-offers',
    listPage:({cursor,limit})=>libraProcessServices.offerReader.listProcessPage(cursor,limit).items.map((item)=>Object.freeze({cursor:item.processId,scope:item})),
    reconcile:({processId})=>libraProcessServices.coordinator.reconcile(processId)}),Object.freeze({ownerDomain:'libra',reconcilerKey:'active-routing-subjects',
    listPage:({cursor,limit})=>pipelineSubjectPage(cursor,limit),
    reconcile:({subjectId})=>libraProcessServices.routingCoordinator.reconcile(subjectId)}),Object.freeze({ownerDomain:'perception',reconcilerKey:'active-acquisitions',
    listPage:({cursor,limit})=>perceptionProcessServices.listAcquisitions().filter((item)=>item.state==='active'&&perceptionProcessServices.acquisitionSchedulingClass(item.perceptionAcquisitionId)==='normal')
      .sort((a,b)=>a.perceptionAcquisitionId.localeCompare(b.perceptionAcquisitionId)).filter((item)=>cursor===null||item.perceptionAcquisitionId>cursor)
      .slice(0,limit).map((item)=>Object.freeze({cursor:item.perceptionAcquisitionId,scope:item})),
    reconcile:({perceptionAcquisitionId})=>perceptionProcessServices.reconcileAcquisition(perceptionAcquisitionId)}),Object.freeze({
      ownerDomain:'perception',reconcilerKey:'active-periodic-acquisitions',
      listPage:({cursor,limit})=>perceptionProcessServices.listAcquisitions().filter(item=>item.state==='active'&&perceptionProcessServices.acquisitionSchedulingClass(item.perceptionAcquisitionId)==='maintenance')
        .sort((a,b)=>a.perceptionAcquisitionId.localeCompare(b.perceptionAcquisitionId)).filter(item=>cursor===null||item.perceptionAcquisitionId>cursor)
        .slice(0,limit).map(item=>({cursor:item.perceptionAcquisitionId,scope:item})),
      reconcile:({perceptionAcquisitionId})=>perceptionProcessServices.reconcileAcquisition(perceptionAcquisitionId),
    }),Object.freeze({
      ownerDomain:'perception',reconcilerKey:'periodic-douban-acquisitions',
      listPage:({cursor,limit})=>perceptionProcessServices.periodicAcquisition
        ? perceptionProcessServices.periodicAcquisition.listPage({cursor,limit})
        : [],
      reconcile:({sourceId})=>perceptionProcessServices.periodicAcquisition
        ? perceptionProcessServices.periodicAcquisition.reconcile({sourceId})
        : Object.freeze({kind:'unavailable',sourceId}),
    }),Object.freeze({
      ownerDomain:'people',reconcilerKey:'reference-artifact-reclamation',
      listPage:page=>peopleProcessServices.artifactReclamation.listPage(page),reconcile:scope=>peopleProcessServices.artifactReclamation.reconcile(scope),
    }),Object.freeze({
      ownerDomain:'people',reconcilerKey:'reliable-person-merge',
      listPage:page=>peopleProcessServices.systemMerge.listPage(page),reconcile:scope=>peopleProcessServices.systemMerge.reconcile(scope),
    }),Object.freeze({
      ownerDomain:'people',reconcilerKey:'ondeck-nfo-person-evidence',
      listPage:page=>peopleProcessServices ? peopleProcessServices.listNfoPage(page) : [],
      reconcile:scope=>peopleProcessServices ? peopleProcessServices.reconcileNfoEntry(scope) : Object.freeze({kind:'unavailable'}),
    }),Object.freeze({
      ownerDomain:'people',reconcilerKey:'ondeck-person-evidence',
      listPage:({cursor,limit})=>peopleProcessServices
        ? peopleProcessServices.listPage({cursor,limit})
        : [],
      reconcile:(scope)=>peopleProcessServices
        ? peopleProcessServices.reconcile(scope)
        : Object.freeze({kind:'unavailable'}),
    }),Object.freeze({
      ownerDomain:'perception',reconcilerKey:'active-subject-rating-resolutions',
      listPage:({cursor,limit})=>pipelineSubjectPage(cursor,limit),
      reconcile:({subjectId})=>perceptionProcessServices.ensureTargetResolutions('subject',subjectId).rating,
    }),Object.freeze({
      ownerDomain:'perception',reconcilerKey:'active-shelf-entry-rating-resolutions',
      listPage:({cursor,limit})=>arcaProcessServices.aftercareContextReader.listPage(cursor,limit),
      reconcile:({shelfEntryId})=>perceptionProcessServices.ensureTargetResolutions('shelf_entry',shelfEntryId).rating,
    }),Object.freeze({
      ownerDomain:'arca',reconcilerKey:'jav-identity-corrections',
      listPage:({cursor,limit})=>arcaProcessServices.correction?arcaProcessServices.correction.correctionStore.listReconcilePage(cursor,limit):[],
      reconcile:({correctionId})=>arcaProcessServices.correction.coordinator.reconcile(correctionId),
    }),Object.freeze({
      ownerDomain:'arca',reconcilerKey:'failed-acceptance-assessments',
      listPage:({cursor,limit})=>workResultReader.listOwnerWorks({ownerDomain:'arca',workKind:'acceptance_assessment'})
        .filter((item)=>item.state==='failed').sort((a,b)=>a.work_id.localeCompare(b.work_id))
        .filter((item)=>cursor===null||item.work_id>cursor).slice(0,limit)
        .map((item)=>Object.freeze({cursor:item.work_id,scope:Object.freeze({processId:item.process_id,workId:item.work_id,
          workKind:item.work_kind})})),
      reconcile:(scope)=>arcaProcessServices.coordinator.recordTerminalFailure(scope),
    }),Object.freeze({
      ownerDomain:'arca',reconcilerKey:'acceptance-technical-recovery',
      listPage:({cursor,limit})=>arcaProcessServices.coordinator.listAcceptanceAttention(limit,cursor)
        .map((item)=>Object.freeze({cursor:item.offerId,scope:item})),
      reconcile:({offerId})=>arcaProcessServices.coordinator.recoverAttentionCase(offerId),
    }),Object.freeze({
      ownerDomain:'arca',reconcilerKey:'pending-ondeck-settlement-approvals',
      listPage:({cursor,limit})=>arcaProcessServices.coordinator.listPendingSettlementApprovals(cursor,limit),
      reconcile:scope=>arcaProcessServices.coordinator.reconcileSettlementApprovals(scope),
    }),Object.freeze({
      ownerDomain:'arca',reconcilerKey:'blocked-ondeck-recovery',
      listPage:({cursor,limit})=>arcaProcessServices.coordinator.listRecoverableOnDeck(limit,cursor),
      reconcile:({onDeckRunId})=>{const result=arcaProcessServices.coordinator.recoverOnDeck(onDeckRunId);
        if(result?.subjectId)options.onFormationSubjectChanged?.(result.subjectId);
        return result;},
    }),Object.freeze({
      ownerDomain:'libra',reconcilerKey:'active-acceptance-spec-subjects',
      listPage:({cursor,limit})=>pipelineSubjectPage(cursor,limit),
      reconcile:({subjectId})=>libraProcessServices.acceptanceSpecCoordinator.reconcile(subjectId),
    }),Object.freeze({
      ownerDomain:'libra',reconcilerKey:'ready-libra-runs',
      listPage:({cursor,limit})=>pipelineSubjectPage(cursor,limit),
      reconcile:({subjectId})=>reconcileReadyLibraSubject({subjectId,contextReader:libraProcessServices.libraRunContextReader,
        customTargetStore:customTargetRuntime.customTargetStore,continuation:customTargetContinuation,
        libraRunCreator:libraProcessServices.libraRunCreator,reconcileRun:reconcileLibraRun}),
    }),Object.freeze({
      ownerDomain:'libra',reconcilerKey:'active-libra-runs',
      listPage:({cursor,limit})=>runnableLibraRunPage(libraProcessServices.libraRunContextReader,cursor,limit),
      reconcile:({libraRunId})=>reconcileLibraRun(libraRunId),
    }),Object.freeze({
      ownerDomain:'arca',reconcilerKey:'due-aftercare-shelf-entries',
      listPage:({cursor,limit})=>arcaProcessServices.aftercareContextReader.listPage(cursor,limit),
      reconcile:({shelfEntryId})=>arcaProcessServices.aftercareCoordinator.reconcile(shelfEntryId,{periodic:true}),
    }),Object.freeze({
      ownerDomain:'arca',reconcilerKey:'active-aftercare-cases',
      listPage:({cursor,limit})=>arcaProcessServices.aftercareContextReader.store.listOpenCasePage(cursor,limit),
      reconcile:({shelfEntryId})=>arcaProcessServices.aftercareCoordinator.reconcile(shelfEntryId),
    }),Object.freeze({
      ownerDomain:'libra',reconcilerKey:'frozen-libra-outcomes',
      listPage:({cursor,limit})=>libraProcessServices.libraRunContextReader.listActiveRunPage(cursor,limit,'frozen').items
        .map(item=>Object.freeze({cursor:item.libraRunId,scope:item})),
      reconcile:({libraRunId})=>reconcileLibraRun(libraRunId),
    }),Object.freeze({
      ownerDomain:'libra',reconcilerKey:'completed-libra-outcomes',
      listPage:({cursor,limit})=>libraProcessServices.libraRunAdminService.listPendingCommitted(cursor,limit)
        .map(item=>Object.freeze({cursor:item.libraRunId,scope:item})),
      reconcile:({libraRunId})=>libraProcessServices.libraRunAdminService.reconcileCommitted(libraRunId),
    }),Object.freeze({
      ownerDomain:'arca',reconcilerKey:'aftercare-workspace-lifecycle',
      listPage:({cursor,limit})=>arcaProcessServices.aftercareContextReader.store.listAftercareWorkspaceLifecyclePage(cursor,limit),
      reconcile:({aftercareCaseId})=>arcaProcessServices.aftercareCoordinator.reconcileWorkspaceLifecycle(aftercareCaseId),
    }),Object.freeze({
      ownerDomain:'libra',reconcilerKey:'completed-workspace-reclamation',
      listPage:({cursor,limit})=>{if(cursor===null&&now()<completedWorkspaceSweepNotBeforeMs)return [];
        const page=workspaceReclaimer.listCompletedWorkspacePage(cursor,limit);
        if(page.length<limit)completedWorkspaceSweepNotBeforeMs=now()+WORKSPACE_RECLAIMER_FALLBACK_MS;
        return page;},
      nextDueAtMs:()=>completedWorkspaceSweepNotBeforeMs||null,
      reconcile:(scope)=>{
        const result=workspaceReclaimer.reconcileCompletedWorkspace(scope);
        if(result.stage==='workspace_cleanup_audit_pending')
          completedWorkspaceSweepNotBeforeMs=Math.min(completedWorkspaceSweepNotBeforeMs,result.nextObservationAtMs);
        if(result.stage==='workspace_cleanup_in_progress')activeCleanupSweepNotBeforeMs=0;
        return result;
      },
    }),Object.freeze({
      ownerDomain:'libra',reconcilerKey:'active-workspace-cleanup-scopes',
      listPage:({cursor,limit})=>{if(cursor===null&&now()<activeCleanupSweepNotBeforeMs)return [];
        if(cursor===null)activeCleanupRoundHasPending=false;
        const page=workspaceReclaimer.listActiveCleanupScopePage(cursor,limit);
        if(page.length===0)activeCleanupSweepNotBeforeMs=now()+(activeCleanupRoundHasPending?1000:WORKSPACE_RECLAIMER_FALLBACK_MS);
        return page;},
      nextDueAtMs:()=>activeCleanupSweepNotBeforeMs||null,
      reconcile:(scope)=>{
        const result=workspaceReclaimer.reconcileCleanupScope(scope);
        if(result.stage==='workspace_cleanup_in_progress')activeCleanupRoundHasPending=true;
        return result;
      },
    }),Object.freeze({
      ownerDomain:'libra',reconcilerKey:'discarded-workspace-leftovers',
      listPage:({cursor,limit})=>{if(cursor===null&&now()<discardedLeftoverSweepNotBeforeMs)return [];
        const page=workspaceReclaimer.listDiscardedLeftoverWorkspacePage(cursor,limit);
        if(page.length===0)discardedLeftoverSweepNotBeforeMs=now()+WORKSPACE_RECLAIMER_FALLBACK_MS;
        return page;},
      nextDueAtMs:()=>discardedLeftoverSweepNotBeforeMs||null,
      reconcile:(scope)=>{
        const result=workspaceReclaimer.reconcileDiscardedLeftoverWorkspace(scope);
        if(result.stage==='workspace_cleanup_in_progress')activeCleanupSweepNotBeforeMs=0;
        return result;
      },
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
    }),Object.freeze({ownerDomain:'arca',reconcilerKey:'series-root-relocations',
      listPage:({cursor,limit})=>arcaCapabilityRegistration.relocation.page(cursor,limit),
      reconcile:({relocationId})=>arcaCapabilityRegistration.relocation.reconcile(relocationId),
    }),Object.freeze({ownerDomain:'arca',reconcilerKey:'series-pending-reservations',
      listPage:({cursor,limit})=>arcaCapabilityRegistration.series.pendingPage(cursor,limit),
      reconcile:({scopeId})=>{arcaCapabilityRegistration.series.reconcileMaintenanceScope(scopeId);return arcaProcessServices.coordinator.reconcileSeriesScope(scopeId);},
    }),Object.freeze({ownerDomain:'arca',reconcilerKey:'series-committed-workspace-reclamation',
      listPage:({cursor,limit})=>arcaCapabilityRegistration.series.reclaimPage(cursor,limit),
      reconcile:({buildId})=>arcaCapabilityRegistration.series.reclaim(buildId),
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
    eventRuntime, domainReconciler, fallbackReconciler, incidentObserver:executorIncidentObserver,
    workDispatchGuard:customTargetRuntime.guard,
    onExecutionScopeStarted:options.onExecutionScopeStarted,
    onError: options.onError,maxInFlightEvents:16,shutdownTimeoutMs:options.shutdownTimeoutMs });
  return Object.freeze({ host, registry, policyRegistry, contractValidator, bindingProjectionRegistry, terminalEffectObserver,
    catalogProofReader, catalogVerifier, planHistoryAudit, progressReader, procurementAutomation,
    readProcessFailures(scope){return workResultReader.listWorks(scope).slice().sort((a,b)=>Number(b.created_at_ms)-Number(a.created_at_ms)).slice(0,3)
      .flatMap(w=>workResultReader.readFailures(w.work_id)).slice(0,16);},triageReader,runCoordinator,
    intakeCoordinator:libraProcessServices.coordinator,intakeOfferReader:libraProcessServices.offerReader,
    routingCoordinator:libraProcessServices.routingCoordinator,routingContextReader:libraProcessServices.routingContextReader,
    acceptanceSpecCoordinator:libraProcessServices.acceptanceSpecCoordinator,
    libraRunCreator:libraProcessServices.libraRunCreator,libraRunContextReader:libraProcessServices.libraRunContextReader,
    libraRunCoordinator:libraProcessServices.libraRunCoordinator,movieProductionReader:libraProcessServices.movieProductionReader,
    libraPreparationRecovery:libraProcessServices.preparationRecovery,
    libraRunExecutionProjection:libraProcessServices.libraRunExecutionProjection,
    productIdentitySelection:libraProcessServices.productIdentitySelection,
    pipelineAdmission:libraProcessServices.pipelineAdmission,
    usAdultActorChoice:libraProcessServices.usAdultActorChoice,
    episodeMetadataMapping:libraProcessServices.episodeMetadataMapping,
    usAdultActorSelectionQuery:libraProcessServices.usAdultActorSelectionQuery,
    arcaCoordinator:arcaProcessServices.coordinator,arcaContextReader:arcaProcessServices.contextReader,
    arcaFormationStatusProjection:arcaProcessServices.formationStatusProjection,
    arcaAcceptanceRecovery:arcaProcessServices.coordinator,
    arcaAftercareCoordinator:arcaProcessServices.aftercareCoordinator,
    arcaUsAdultActorRefresh:arcaProcessServices.actorRefresh,
    arcaDefectAdmission:arcaProcessServices.defectAdmission,
    arcaJavCorrection:arcaProcessServices.correction,
    arcaAftercareContextReader:arcaProcessServices.aftercareContextReader,
    arcaOffdeckCoordinator:arcaProcessServices.offdeckCoordinator,arcaOffdeckContextReader:arcaProcessServices.offdeckContextReader,
    arcaOffdeckAutomationCoordinator:arcaProcessServices.offdeckAutomationCoordinator,
    arcaShelfDeregistrationCoordinator:arcaProcessServices.shelfDeregistrationCoordinator,
    arcaShelfDeregistrationContextReader:arcaProcessServices.shelfDeregistrationContextReader,
    wakeWorkspaceReclaimer(){return drainCompletedWorkspaces();},workspaceReclaimer,
    cancelProcessWorks:(scope)=>workLifecycle.cancelProcess(scope),
    perception:perceptionProcessServices, people:peopleProcessServices });
}

module.exports = Object.freeze({
  createProcurementExecutionRuntime,
  createHelixExecutionRuntime:createProcurementExecutionRuntime,
  volumeReadUnitsForCapability,
  mergeResourceDemands,
  createHelixExecutionPolicyRegistry,
});
