'use strict';
const {createSourceFairness}=require('../application/source-fairness');
const {createAttentionWorkshop}=require('../application/attention-workshop');
const {createTaskCancellationStore}=require('../persistence/task-cancellation-store');

const catalog = require('../../../contracts/ports/p8-libra-intake-public-contracts.json');
const productionCatalog = require('../../../contracts/ports/p9-libra-production-public-contracts.json');
const { packageId } = require('./package.boundary.json');
const { createIntakeCapabilityPorts } = require('../capabilities/intake-capability-ports');
const { createIntakeControlObservationPort } = require('../application/intake-control-observation-port');
const { createIntakeCapabilityRegistrations } = require('../capabilities/intake-capability-registrations');
const { createIntakeOfferReader } = require('../persistence/intake-offer-reader');
const { createMaterialBindingScopeReader } = require('../application/material-binding-scope-reader');
const { createIntakeDecisionResolver } = require('../application/intake-decision-resolver');
const { createIntakeProcessCoordinator } = require('../application/intake-process-coordinator');
const {
  createLibraPipelineAdmission,
  fieldIdFromOfferSource,
  DEFAULT_PREDECK_PIPELINE_SEATS,
} = require('../application/libra-pipeline-admission');
const { createMovieResponsibilityClosureCoordinator } =
  require('../application/movie-responsibility-closure-coordinator');
const { buildRatingTargetIdentity } = require('../model/decision-identity-evidence-contracts');
const { createLibraIntakeStore } = require('../persistence/libra-intake-store');
const { createEvidencePlanner,createAcceptancePlanner,createRejectionPlanner,createIntakeProjections } = require('../planning/intake-planners');
const { createRoutingCapabilityPorts } = require('../capabilities/routing-capability-ports');
const { createRoutingCapabilityRegistrations, EFFECTS: ROUTING_EFFECTS } = require('../capabilities/routing-capability-registrations');
const { createRoutingContextReader } = require('../application/routing-context-reader');
const { createRoutingProcessCoordinator } = require('../application/routing-process-coordinator');
const { createFactPlanner, createBasisPlanner, createRoutingProjections } = require('../planning/routing-planners');
const { createAcceptanceSpecContextReader } = require('../application/acceptance-spec-context-reader');
const { createAcceptanceSpecCoordinator } = require('../application/acceptance-spec-coordinator');
const { createAcceptanceSpecPlanner, createAcceptanceSpecProjections } = require('../planning/acceptance-spec-planner');
const { createLibraRunContextReader } = require('../application/libra-run-context-reader');
const { createLibraRunCreator } = require('../application/libra-run-creator');
const { createLibraRunCoordinator } = require('../application/libra-run-coordinator');
const { createLibraRunExecutionProjection } = require('../application/libra-run-execution-projection');
const { createLibraRunLifecycleService } = require('../application/libra-run-lifecycle-service');
const { createLibraRunAdminService } = require('../application/libra-run-admin-service');
const { createProductIdentitySelectionService } = require('../application/product-identity-selection-service');
const { createMovieProductionReader } = require('../persistence/movie-production-reader');
const {createUsAdultAnalysisStore} = require('../persistence/us-adult-analysis-store');
const {createUsAdultActorChoiceStore} = require('../persistence/us-adult-actor-choice-store');
const {createEpisodeMetadataMappingStore} = require('../persistence/episode-metadata-mapping-store');
const {createEpisodeMetadataMappingService} = require('../application/episode-metadata-mapping-service');
const {createUsAdultMatchCompletionStore} = require('../persistence/us-adult-match-completion-store');
const {createUsAdultActorChoiceCommand} = require('../capabilities/us-adult-actor-choice-command');
const {createUsAdultAnalysisPlanner, createUsAdultAnalysisProjections} = require('../planning/us-adult-analysis-planner');
const {createUsAdultProductPlanner}=require('../planning/us-adult-product-planner');
const {createUsAdultActorSelectionQuery}=require('../application/us-adult-actor-selection-query');
const {createUsAdultProductCapabilityPorts,createUsAdultProductCapabilityRegistrations,EFFECTS:US_PRODUCT_EFFECTS}=
  require('../capabilities/us-adult-product-capability-ports');
const {createUsAdultAnalysisCapabilityPorts, createUsAdultAnalysisCapabilityRegistrations, EFFECTS:US_ANALYSIS_EFFECTS} =
  require('../capabilities/us-adult-analysis-capability-ports');
const { createProductFactCapabilityPorts } = require('../capabilities/product-fact-capability-ports');
const { createProductFactCapabilityRegistrations } = require('../capabilities/product-fact-capability-registrations');
const { createProductMetadataCapabilityPorts } = require('../capabilities/product-metadata-capability-ports');
const { createProductMetadataCapabilityRegistrations } = require('../capabilities/product-metadata-capability-registrations');
const { createArtifactProductionCapabilityPorts } = require('../capabilities/artifact-production-capability-ports');
const { createArtifactProductionCapabilityRegistrations, EFFECTS: ARTIFACT_EFFECTS } =
  require('../capabilities/artifact-production-capability-registrations');
const { createMediaProductionCapabilityPorts } = require('../capabilities/media-production-capability-ports');
const { createMediaProductionCapabilityRegistrations, CONTRACTS: MEDIA_EFFECTS } =
  require('../capabilities/media-production-capability-registrations');
const { createDeliveryLifecycleCapabilityPorts } = require('../capabilities/delivery-lifecycle-capability-ports');
const { createDeliveryLifecycleCapabilityRegistrations, CONTRACTS: DELIVERY_EFFECTS } =
  require('../capabilities/delivery-lifecycle-capability-registrations');
const { createExternalMaterialCapabilityPorts } =
  require('../capabilities/external-material-capability-ports');
const { createExternalMaterialCapabilityRegistrations, CONTRACTS: EXTERNAL_EFFECTS } =
  require('../capabilities/external-material-capability-registrations');
const { createProductionSourceScopeResolver } = require('../planning/production-source-scope-resolver');
const { createProductFactDomainCommitCoordinator } =
  require('../application/product-fact-domain-commit-coordinator');
const { createProductIdentityPlanner, createProductIdentityProjections, createProductMetadataObservationPlanner,
  createProductMetadataObservationProjections, createArtifactProductionPlanner, createArtifactProductionProjections,
  createProductFactAssemblyPlanner, createProductFactAssemblyProjections } =
  require('../planning/libra-production-planners');
const { createWorkspaceMediaProductionPlanner, createWorkspaceMediaProductionProjections } =
  require('../planning/media-production-planner');
const { createProductDeliveryAssembler } = require('../application/product-delivery-assembler');
const { createProductDeliveryPlanner, createProductDeliveryProjections } =
  require('../planning/product-delivery-planner');
const { createExternalMaterialPlanner, createExternalMaterialProjections } =
  require('../planning/external-material-planner');

class LibraPublicFacadeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LibraPublicFacadeError';
    this.code = code;
    this.details = details;
  }
}

const contract = catalog.facades.find((entry) => entry.packageId === packageId && entry.exportName === 'LibraIntakeFacade');
const executionContract = catalog.facades.find((entry) => entry.packageId === packageId && entry.exportName === 'LibraExecutionRegistration');
if (!contract) throw new LibraPublicFacadeError('P8_LIBRA_INTAKE_CONTRACT_MISSING', 'Libra Intake public contract is missing.');
if (!executionContract) throw new LibraPublicFacadeError('P8_LIBRA_EXECUTION_CONTRACT_MISSING', 'Libra Execution construction contract is missing.');
const productDeliveryContract = productionCatalog.ports.find((entry) =>
  entry.packageId === packageId && entry.exportName === 'ProductDeliveryPort'
);
if (!productDeliveryContract) {
  throw new LibraPublicFacadeError('P9_PRODUCT_DELIVERY_CONTRACT_MISSING', 'Product Delivery public contract is missing.');
}
const workspaceReclamationContract = productionCatalog.ports.find((entry) =>
  entry.packageId === packageId && entry.exportName === 'WorkspaceReclamationPort'
);
if (!workspaceReclamationContract) {
  throw new LibraPublicFacadeError('P9_WORKSPACE_RECLAMATION_CONTRACT_MISSING',
    'Workspace Reclamation public contract is missing.');
}

function bind(implementation) {
  if (!implementation || typeof implementation !== 'object' || Array.isArray(implementation)) {
    throw new LibraPublicFacadeError('P8_LIBRA_INTAKE_IMPLEMENTATION_REQUIRED', 'A typed Libra Intake implementation is required.');
  }
  const provided = Object.keys(implementation).sort();
  const expected = [...contract.methods].sort();
  if (JSON.stringify(provided) !== JSON.stringify(expected) || typeof implementation.offerCandidate !== 'function') {
    throw new LibraPublicFacadeError('P8_LIBRA_INTAKE_PORT_SHAPE_MISMATCH',
      'Libra Intake implementation must expose only the frozen offerCandidate method.', { expected, provided });
  }
  return Object.freeze({ offerCandidate:(message) => implementation.offerCandidate(message) });
}

function bindProductDelivery(implementation) {
  if (!implementation || typeof implementation !== 'object' || Array.isArray(implementation)) {
    throw new LibraPublicFacadeError('P9_PRODUCT_DELIVERY_IMPLEMENTATION_REQUIRED',
      'A typed Product Delivery implementation is required.');
  }
  const provided = Object.keys(implementation).sort();
  const expected = [...productDeliveryContract.methods].sort();
  if (JSON.stringify(provided) !== JSON.stringify(expected) || expected.some(method => typeof implementation[method] !== 'function')) {
    throw new LibraPublicFacadeError('P9_PRODUCT_DELIVERY_PORT_SHAPE_MISMATCH',
      'Product Delivery implementation must expose only the declared historical and acceptance reads.', { expected, provided });
  }
  return Object.freeze(Object.fromEntries(expected.map(method => [method, query => implementation[method](query)])));
}

function bindWorkspaceReclamation(implementation) {
  if (!implementation || typeof implementation !== 'object' || Array.isArray(implementation)) {
    throw new LibraPublicFacadeError('P9_WORKSPACE_RECLAMATION_IMPLEMENTATION_REQUIRED',
      'A typed Workspace Reclamation implementation is required.');
  }
  const provided = Object.keys(implementation).sort();
  const expected = [...workspaceReclamationContract.methods].sort();
  if (JSON.stringify(provided) !== JSON.stringify(expected)
    || expected.some((method) => typeof implementation[method] !== 'function')) {
    throw new LibraPublicFacadeError('P9_WORKSPACE_RECLAMATION_PORT_SHAPE_MISMATCH',
      'Workspace Reclamation implementation must expose only the frozen readCleanupScope and discardFrozenRun methods.',
      { expected, provided });
  }
  return Object.freeze({
    readCleanupScope: (query) => implementation.readCleanupScope(query),
    discardFrozenRun: (command) => implementation.discardFrozenRun(command)
  });
}

function createExecutionRegistration() {
  const implementation={
    createCapabilityRegistration(options) {
      const offerReader=options.offerReader || createIntakeOfferReader(options);
      const intakePorts=createIntakeCapabilityPorts({...options,offerReader,
        intakeControlObservationPort:createIntakeControlObservationPort(options)});
      const routingPorts=createRoutingCapabilityPorts(options);
      const movieProductionReader=options.movieProductionReader||createMovieProductionReader(options);
      const usAdultAnalysisStore=createUsAdultAnalysisStore(options);
      const usAdultAnalysisPorts=createUsAdultAnalysisCapabilityPorts({...options,movieProductionReader,usAdultAnalysisStore});
      const usAdultProductPorts=createUsAdultProductCapabilityPorts({...options,movieProductionReader,usAdultAnalysisStore,
        usAdultActorChoiceStore:createUsAdultActorChoiceStore(options),usAdultMatchCompletionStore:createUsAdultMatchCompletionStore(options)});
      const productIdentitySelection=createProductIdentitySelectionService({...options,movieProductionReader});
      const domainCommitCoordinator=createProductFactDomainCommitCoordinator(options);
      const productFactPorts=createProductFactCapabilityPorts({...options,movieProductionReader,domainCommitCoordinator});
      const productMetadataPorts=createProductMetadataCapabilityPorts({...options,movieProductionReader,episodeMetadataMappingStore:createEpisodeMetadataMappingStore(options)});
      const artifactPorts=createArtifactProductionCapabilityPorts({...options,movieProductionReader});
      const sourceScopeResolver=createProductionSourceScopeResolver({movieProductionReader,workResultReader:options.workResultReader,
        productionPort:options.productProductionPort});
      const mediaPorts=createMediaProductionCapabilityPorts({...options,
        resolveProductionSourceScope:sourceScopeResolver.resolve});
      const deliveryPorts=createDeliveryLifecycleCapabilityPorts(options);
      const externalPorts=createExternalMaterialCapabilityPorts({...options,movieProductionReader});
      const ports=Object.freeze({...intakePorts,...routingPorts,...productFactPorts,...productMetadataPorts,...artifactPorts,...mediaPorts,...usAdultAnalysisPorts,...usAdultProductPorts,
        ...deliveryPorts,...externalPorts});
      return Object.freeze({offerReader,movieProductionReader,ports,createRegistrations(registrationOptions){
        const routingRefs=registrationOptions.enabledCapabilityRefs.filter((ref)=>ROUTING_EFFECTS[ref]);
        const productFactRefs=registrationOptions.enabledCapabilityRefs.filter((ref)=>[
          'libra.product_identity.resolve@1','libra.media_cast.resolve@1','libra.media_cast.commit@1',
          'libra.product_metadata.commit@1'].includes(ref));
        const productMetadataRefs=registrationOptions.enabledCapabilityRefs.filter((ref)=>ref==='libra.product_metadata.fetch@1');
        const artifactRefs=registrationOptions.enabledCapabilityRefs.filter((ref)=>ARTIFACT_EFFECTS[ref]);
        const mediaRefs=registrationOptions.enabledCapabilityRefs.filter((ref)=>MEDIA_EFFECTS[ref]);
        const deliveryRefs=registrationOptions.enabledCapabilityRefs.filter((ref)=>DELIVERY_EFFECTS[ref]);
        const externalRefs=registrationOptions.enabledCapabilityRefs.filter((ref)=>EXTERNAL_EFFECTS[ref]);
        const usAnalysisRefs=registrationOptions.enabledCapabilityRefs.filter((ref)=>US_ANALYSIS_EFFECTS[ref]);
        const usProductRefs=registrationOptions.enabledCapabilityRefs.filter((ref)=>US_PRODUCT_EFFECTS[ref]);
        const intakeRefs=registrationOptions.enabledCapabilityRefs.filter((ref)=>!ROUTING_EFFECTS[ref]&&!productFactRefs.includes(ref)&&
          !productMetadataRefs.includes(ref)&&!artifactRefs.includes(ref)&&!mediaRefs.includes(ref)&&!deliveryRefs.includes(ref)&&
          !externalRefs.includes(ref)&&!usAnalysisRefs.includes(ref)&&!usProductRefs.includes(ref));
        return Object.freeze([
          ...createUsAdultAnalysisCapabilityRegistrations({
            manifests:Object.fromEntries(usAnalysisRefs.map(ref=>[ref,registrationOptions.manifests[ref]])),ports}),
          ...createUsAdultProductCapabilityRegistrations({
            manifests:Object.fromEntries(usProductRefs.map(ref=>[ref,registrationOptions.manifests[ref]])),ports}),
          ...createIntakeCapabilityRegistrations({...registrationOptions,enabledCapabilityRefs:intakeRefs,
            ports:Object.fromEntries(intakeRefs.map((ref)=>[ref,ports[ref]]))}),
          ...createRoutingCapabilityRegistrations({...registrationOptions,enabledCapabilityRefs:routingRefs,
            ports:Object.fromEntries(routingRefs.map((ref)=>[ref,ports[ref]]))}),
          ...(productFactRefs.length?createProductFactCapabilityRegistrations({...registrationOptions,
            manifests:Object.fromEntries(productFactRefs.map((ref)=>[ref,registrationOptions.manifests[ref]])),
            ports:Object.fromEntries(productFactRefs.map((ref)=>[ref,ports[ref]]))}):[]),
          ...(productMetadataRefs.length?createProductMetadataCapabilityRegistrations({...registrationOptions,
            manifests:Object.fromEntries(productMetadataRefs.map((ref)=>[ref,registrationOptions.manifests[ref]])),
            ports:Object.fromEntries(productMetadataRefs.map((ref)=>[ref,ports[ref]]))}):[]),
          ...(artifactRefs.length?createArtifactProductionCapabilityRegistrations({...registrationOptions,
            manifests:Object.fromEntries(artifactRefs.map((ref)=>[ref,registrationOptions.manifests[ref]])),
            ports:Object.fromEntries(artifactRefs.map((ref)=>[ref,ports[ref]]))}):[]),
          ...(mediaRefs.length?createMediaProductionCapabilityRegistrations({
            manifests:Object.fromEntries(mediaRefs.map((ref)=>[ref,registrationOptions.manifests[ref]])),
            ports:Object.fromEntries(mediaRefs.map((ref)=>[ref,ports[ref]]))}):[]),
          ...(deliveryRefs.length?createDeliveryLifecycleCapabilityRegistrations({enabledCapabilityRefs:deliveryRefs,
            manifests:Object.fromEntries(deliveryRefs.map((ref)=>[ref,registrationOptions.manifests[ref]])),
            ports:Object.fromEntries(deliveryRefs.map((ref)=>[ref,ports[ref]]))}):[]),
          ...(externalRefs.length?createExternalMaterialCapabilityRegistrations({
            manifests:Object.fromEntries(externalRefs.map((ref)=>[ref,registrationOptions.manifests[ref]])),
            ports:Object.fromEntries(externalRefs.map((ref)=>[ref,ports[ref]]))}):[]),
        ]);
      }});
    },
    createProcessServices(options) {
      const taskCancellations=createTaskCancellationStore(options);
      const intakeRetirement=require('../persistence/intake-retirement-store').createIntakeRetirementStore(options);
      options={...options,taskCancellations,intakeRetirement};
      const offerReader=options.offerReader || createIntakeOfferReader(options);
      const decisionResolver=createIntakeDecisionResolver(options);
      const intakeStore=options.intakeStore || createLibraIntakeStore(options);
      const subjectIdForProcess=(processId)=>{
        const accepted=intakeStore.getReceipt(processId)?.subject_id;
        if(accepted)return accepted;
        const source=offerReader.read(processId);
        if(!source?.snapshot)return null;
        const decision=decisionResolver.resolve(source.snapshot);
        return decision.result==='season_extension'?decision.targetSubjectId:decision.allocatedSubjectId;
      };
      const pipelineAdmission=options.pipelineAdmission || createLibraPipelineAdmission({
        ...options,
        fieldIdForProcess:(processId)=>fieldIdFromOfferSource(offerReader.read(processId)),
        subjectResolver:{subjectIdForProcess},
      });
      const coordinator=createIntakeProcessCoordinator({
        ...options,offerReader,decisionResolver,pipelineAdmission,subjectIdForProcess,intakeStore,
      });
      const routingContextReader=createRoutingContextReader(options);
      const attentionWorkshop=createAttentionWorkshop({...options,pipelineAdmission,onTransferred:options.onWorkshopTransferred,
        onReadinessObserved:options.onWorkshopReadinessObserved});
      const routingProcess=createRoutingProcessCoordinator({...options,contextReader:routingContextReader});
      const routingCoordinator=Object.freeze({...routingProcess,reconcile(subjectId){
        if(taskCancellations.get(subjectId)?.state==='pending')return {kind:'cancelling',subjectId};
        return attentionWorkshop.reconcileRouting(subjectId,()=>routingProcess.reconcile(subjectId));
      }});
      const acceptanceSpecContextReader=createAcceptanceSpecContextReader({...options,routingContextReader});
      const acceptanceSpecCoordinator=createAcceptanceSpecCoordinator({...options,contextReader:acceptanceSpecContextReader});
      const libraRunContextReader=createLibraRunContextReader(options);
      const episodeMetadataMappingStore=createEpisodeMetadataMappingStore(options);
      const libraRunCreator=createLibraRunCreator({...options,contextReader:libraRunContextReader,pipelineAdmission,episodeMetadataMappingStore});
      const sourceFairness=createSourceFairness({...options,onPriorityChanged:options.onLibraPriorityChanged,
        onWaitingExecutionsObserved:options.onLibraWaitingExecutionsObserved});
      const libraRunExecutionProjection=createLibraRunExecutionProjection({...options,sourceFairness});
      const libraRunLifecycleService=createLibraRunLifecycleService({...options,libraRunExecutionProjection});
      const movieProductionReader=options.movieProductionReader||createMovieProductionReader(options);
      const episodeMetadataMapping=createEpisodeMetadataMappingService({...options,movieProductionReader,episodeMetadataMappingStore,
        afterConfirmation:record=>runCoordinator.reconcile(record.libraRunId)});
      const usAdultAnalysisStore=createUsAdultAnalysisStore(options);
      const productIdentitySelection=createProductIdentitySelectionService({...options,movieProductionReader});
      const libraRunAdminService=createLibraRunAdminService({...options,libraRunExecutionProjection,pipelineAdmission});
      const usAdultMatchCompletionStore=createUsAdultMatchCompletionStore(options);
      const usAdultActorChoiceStore=createUsAdultActorChoiceStore(options),
        usAdultActorChoice=createUsAdultActorChoiceCommand({...options,movieProductionReader,usAdultActorChoiceStore,afterUsAdultActorChoice:libraRunId=>runCoordinator.reconcileActorChoice(libraRunId)});
      const usAdultActorSelectionQuery=createUsAdultActorSelectionQuery({movieProductionReader,usAdultActorChoiceStore,usAdultAnalysisStore,usAdultMatchCompletionStore});
      const runCoordinator=createLibraRunCoordinator({...options,libraRunCreator,movieProductionReader,episodeMetadataMappingStore,usAdultAnalysisStore,usAdultActorChoiceStore,usAdultMatchCompletionStore,libraRunLifecycleService,productIdentitySelection,routingContextReader,
        resolveFrozenRun:libraRunAdminService.reconcileFrozen,
        resolveRejectedRun:libraRunAdminService.reconcileRejected,
        waitUnavailableStrategy:libraRunAdminService.waitUnavailableStrategy,
        resolveCurrentAcceptanceSpec(subjectId,scopeRunId=null){
          const resolution=acceptanceSpecCoordinator.reconcile(subjectId,scopeRunId);
          if(resolution.kind!=='terminal')return resolution;
          const context=libraRunContextReader.read(subjectId);
          return context.kind==='ready'?Object.freeze({kind:'ready',spec:context.spec}):context;
        }});
      const libraRunCoordinator=Object.freeze({...runCoordinator,reconcile(runId){
        const cancellation=taskCancellations.getForRun(runId);
        if(cancellation?.state==='pending')return libraRunAdminService.reconcileCancellation(cancellation.subjectId);
        const result=attentionWorkshop.reconcileRun(runId,()=>runCoordinator.reconcile(runId));
        const eligible=result.kind==='pending'&&Boolean(result.workId);
        sourceFairness.setEligible(runId,eligible);
        if(eligible)sourceFairness.refresh(runId);
        return result;
      }});
      const preparationRecovery=require('../application/preparation-recovery-admin').createPreparationRecoveryAdmin({...options,
        offerReader,intakeStore,pipelineAdmission,intakeCoordinator:coordinator,routingCoordinator,acceptanceSpecCoordinator});
      return Object.freeze({preparationRecovery,sourceFairness,offerReader,decisionResolver,coordinator,routingContextReader,routingCoordinator,acceptanceSpecContextReader,
        acceptanceSpecCoordinator,libraRunContextReader,libraRunCreator,movieProductionReader,libraRunCoordinator,
        libraRunExecutionProjection,libraRunLifecycleService,libraRunAdminService,productIdentitySelection,pipelineAdmission,intakeStore,usAdultAnalysisStore,
        episodeMetadataMappingStore,episodeMetadataMapping,usAdultActorChoiceStore,usAdultActorChoice,usAdultActorSelectionQuery,usAdultMatchCompletionStore});
    },
    createPlanningRegistration(options) {
      const productDeliveryAssembler=options.productDeliveryAssembler||createProductDeliveryAssembler(options);
      const productDeliveryPlanner=createProductDeliveryPlanner({...options,productDeliveryAssembler});
      const externalMaterialPlanner=createExternalMaterialPlanner(options);
      const workspaceMediaPlanner=createWorkspaceMediaProductionPlanner(options);
      const workspaceMediaProductionPlanner=Object.freeze({
        plannerContractRef:workspaceMediaPlanner.plannerContractRef,plannerVersion:1,
        plan(request){return externalMaterialPlanner.handles(request)
          ?externalMaterialPlanner.plan(request):workspaceMediaPlanner.plan(request);}
      });
      return Object.freeze({planners:Object.freeze([
        createEvidencePlanner(options),createAcceptancePlanner(options),createRejectionPlanner(options),
        createFactPlanner(options,'related_nfo'),createFactPlanner(options,'provider'),createBasisPlanner(options),
        createAcceptanceSpecPlanner({...options,contextReader:options.acceptanceSpecContextReader}),
        createProductIdentityPlanner(options),createProductMetadataObservationPlanner(options),createArtifactProductionPlanner(options),
        createProductFactAssemblyPlanner(options),workspaceMediaProductionPlanner,
        productDeliveryPlanner,productDeliveryPlanner,createUsAdultAnalysisPlanner(options),createUsAdultProductPlanner(options)
      ]),bindingProjections:Object.freeze([...createIntakeProjections(options),...createRoutingProjections(options),
        ...createAcceptanceSpecProjections({...options,contextReader:options.acceptanceSpecContextReader}),
        ...createProductIdentityProjections(options),...createProductMetadataObservationProjections(options),
        ...createArtifactProductionProjections(options),...createProductFactAssemblyProjections(options),
        ...createWorkspaceMediaProductionProjections(options),
        ...createExternalMaterialProjections(options),
        ...createProductDeliveryProjections({...options,productDeliveryAssembler}),...createUsAdultAnalysisProjections(options)])});
    }
  };
  const provided=Object.keys(implementation).sort(),expected=[...executionContract.methods].sort();
  if(JSON.stringify(provided)!==JSON.stringify(expected)||expected.some((method)=>typeof implementation[method]!=='function')){
    throw new LibraPublicFacadeError('P8_LIBRA_EXECUTION_PORT_SHAPE_MISMATCH','Libra Execution registration does not match its formal construction contract.',{expected,provided});
  }
  return Object.freeze(implementation);
}

Object.defineProperties(createExecutionRegistration, {
  createMaterialBindingScopeReader: { value:createMaterialBindingScopeReader },
  DEFAULT_PREDECK_PIPELINE_SEATS: { value: DEFAULT_PREDECK_PIPELINE_SEATS },
  createMovieResponsibilityClosureCoordinator: { value: createMovieResponsibilityClosureCoordinator },
  buildRatingTargetIdentity: { value: buildRatingTargetIdentity },
});

module.exports = Object.freeze({
  createLibraHandoffResponsibilityReader: require('../application/handoff-responsibility-reader').createLibraHandoffResponsibilityReader,
  createLibraCustomTargetDispatchGuard: require('../application/custom-target-dispatch-guard').createLibraCustomTargetDispatchGuard,
  createFreshResetWorkspaceArchive: require('../persistence/fresh-reset-workspace-archive').createFreshResetWorkspaceArchive,
  describeFreshResetWorkspaceRetention: require('../model/fresh-reset-workspace-retention').describeFreshResetWorkspaceRetention,
  describeFreshResetMetadataRetention: require('../model/fresh-reset-metadata-retention').describeFreshResetMetadataRetention,
  createFreshResetCustomTargetRetention: require('../persistence/fresh-reset-custom-target-retention').createFreshResetCustomTargetRetention,
  createLibraArtifactAuditSource(options){const source=require('../persistence/reference-artifact-audit-source').createLibraArtifactAuditSource(options);return Object.freeze({sourceId:source.sourceId,epoch:source.epoch,page:source.page});},
  createFormationRetirementStore:require('../persistence/formation-retirement-store').createFormationRetirementStore,
  createProductDeliveryReader:require('../persistence/product-delivery-reader').createProductDeliveryReader,
  createIntakeRetirementStore:require('../persistence/intake-retirement-store').createIntakeRetirementStore,
  PACKAGE_ID:packageId,
  LibraIntakeFacade:bind,
  ProductDeliveryPort:bindProductDelivery,
  WorkspaceReclamationPort:bindWorkspaceReclamation,
  LibraExecutionRegistration:createExecutionRegistration,
});
