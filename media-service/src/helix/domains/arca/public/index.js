'use strict';
const {createSeriesRootRelocationServices}=require('../application/series-root-relocation-services');
const {createSeriesRootRelocationPorts}=require('../capabilities/series-root-relocation-ports');
const {createSeriesRootRelocationPlanner,createSeriesRootRelocationProjections}=require('../planning/series-root-relocation-planner');
const ROOT_REFS=Object.values(require('../model/series-root-relocation-contract').CAPS);
const {createSeriesPresentationServices}=require('../application/series-presentation-services');
const {createSeriesPresentationCapabilityPorts}=require('../capabilities/series-presentation-capability-ports');
const {createSeriesPresentationPlanner,createSeriesPresentationReclaimPlanner,createSeriesPresentationProjections}=require('../planning/series-presentation-planner');
const SERIES_REFS=Object.values(require('../model/series-presentation').CAPS);
const {createPlanningEvidenceReader}=require('../persistence/planning-evidence-reader');
const {createUsAdultActorRefreshSource}=require('../application/us-adult-actor-refresh-source');
const {createUsAdultActorSourcePort}=require('../capabilities/us-adult-actor-source-port');
const {SOURCE:ACTOR_SOURCE}=require('../model/us-adult-actor-refresh-execution');
const {createUsAdultActorSourcePlanner,createUsAdultActorSourceProjections}=require('../planning/us-adult-actor-source-planner');
const {createUsAdultActorMatchQuery}=require('../application/us-adult-actor-match-query');
const {createUsAdultActorMatchPort}=require('../capabilities/us-adult-actor-match-port');
const {MATCH:ACTOR_MATCH}=require('../model/us-adult-actor-match-work');
const {createUsAdultActorMatchPlanner,createUsAdultActorMatchProjections}=require('../planning/us-adult-actor-match-planner');
const {createUsAdultActorPipelineQuery}=require('../application/us-adult-actor-pipeline-query');
const {createUsAdultActorPipelinePorts}=require('../capabilities/us-adult-actor-pipeline-ports');
const {createUsAdultActorPipelinePlanners,createUsAdultActorPipelineProjections}=require('../planning/us-adult-actor-pipeline-planners');
const {createUsAdultActorRefreshCoordinator}=require('../application/us-adult-actor-refresh-coordinator');
const {createUsAdultActorRefreshAdmin}=require('../application/us-adult-actor-refresh-admin');
const {CAPS:ACTOR_PHASES}=require('../model/us-adult-actor-pipeline');
const ACTOR_REFS=Object.freeze([ACTOR_SOURCE,ACTOR_MATCH,...Object.values(ACTOR_PHASES)]);
const {createJavCorrectionServices}=require('../application/jav-correction-services');
const {createJavCorrectionCapabilityPorts}=require('../capabilities/jav-correction-capability-ports');
const {createJavCorrectionExecutionRegistrations}=require('../capabilities/jav-correction-execution-registrations');
const {createJavCorrectionAssetsPlanner,createJavCorrectionFilesPlanner,createJavCorrectionPublishPlanner,createJavCorrectionVerifyPlanner,createJavCorrectionCommitPlanner,createJavCorrectionRetirementPlanner,createJavCorrectionWorkspaceReclaimPlanner,createJavCorrectionProjections}=require('../planning/jav-correction-planners');

const { packageId } = require('./package.boundary.json');
const { createOnDeckContextReader } = require('../application/on-deck-context-reader');
const { createTerminalEffectHistoryObserver } = require('../application/terminal-effect-history-observer');
const { createOnDeckNfoPersonEvidence } = require('../application/on-deck-nfo-person-evidence');
const { createOnDeckPersonEvidenceProjection } = require('../application/on-deck-person-evidence-projection');
const { createOnDeckProcessCoordinator } = require('../application/on-deck-process-coordinator');
const { createFormationStatusProjection } = require('../application/formation-status-projection');
const { createOnDeckCapabilityPorts } = require('../capabilities/on-deck-capability-ports');
const { createOnDeckCapabilityRegistrations } = require('../capabilities/on-deck-execution-registrations');
const { createAcceptanceAssessmentPlanner, createAcceptanceCommitPlanner,
  createAcceptanceRejectionPlanner, createOnDeckExecutionPlanner } = require('../planning/on-deck-planners');
const { createOnDeckProjections } = require('../planning/on-deck-projections');
const { createAftercareContextReader } = require('../application/aftercare-context-reader');
const { createDefectAdmissionApplication } = require('../application/defect-admission-application');
const { createAftercareProcessCoordinator } = require('../application/aftercare-process-coordinator');
const { createInventoryPersonRecordRefresh } = require('../application/inventory-person-record-refresh');
const { createInventoryRecordRefresh } = require('../application/inventory-record-refresh');
const { createAftercareCapabilityPorts } = require('../capabilities/aftercare-capability-ports');
const { createAftercareCapabilityRegistrations } = require('../capabilities/aftercare-execution-registrations');
const { createHealthAssessmentPlanner, createCustodyAssessmentPlanner, createCareRepairPreparationPlanner,
  createCareRepairCommitPlanner, createCareCaseClosurePlanner, createCareDeregistrationSettlementPlanner,
  createCareWorkspaceReclaimPlanner } = require('../planning/aftercare-planners');
const { createAftercareProjections } = require('../planning/aftercare-projections');
const { createOffdeckContextReader } = require('../application/offdeck-context-reader');
const { createOffdeckProcessCoordinator } = require('../application/offdeck-process-coordinator');
const { createOffdeckAutomationCoordinator } = require('../application/offdeck-automation-coordinator');
const { createOffdeckCapabilityPorts } = require('../capabilities/offdeck-capability-ports');
const { createOffdeckCapabilityRegistrations } = require('../capabilities/offdeck-execution-registrations');
const { createScopeVerificationPlanner,createMaterialDestructionPlanner,createTerminalCommitPlanner } = require('../planning/offdeck-planners');
const { createOffdeckProjections } = require('../planning/offdeck-projections');
const { createOffdeckPolicyEvaluationPlanner,createOffdeckDuplicateDetectionPlanner } = require('../planning/offdeck-automation-planners');
const { createOffdeckAutomationProjections } = require('../planning/offdeck-automation-projections');
const { createShelfDeregistrationContextReader } = require('../application/shelf-deregistration-context-reader');
const { createShelfDeregistrationCoordinator } = require('../application/shelf-deregistration-coordinator');
const { createShelfDeregistrationCapabilityPorts } = require('../capabilities/shelf-deregistration-capability-ports');
const { createShelfDeregistrationCapabilityRegistrations } = require('../capabilities/shelf-deregistration-execution-registrations');
const { createManifestVerificationPlanner,createDeregistrationCommitPlanner } = require('../planning/shelf-deregistration-planners');
const { createShelfDeregistrationProjections } = require('../planning/shelf-deregistration-projections');
const { createOffloadCompletionPort } = require('./offload-completion-port');

const AFTERCARE_REFS = Object.freeze([
  'arca.aftercare.custody.observe@1','arca.aftercare.presentation.observe@1',
  'arca.aftercare.conformance.observe@1','arca.aftercare.assessment.commit@1',
  'arca.aftercare.text_artifact.render@1','arca.aftercare.binary_artifact.acquire@1',
  'arca.aftercare.artifact.materialize@1','arca.aftercare.media.remux@1',
  'arca.aftercare.media.transcode@1','arca.aftercare.media.verify@1',
  'arca.aftercare.input_settlement.delete@1','arca.aftercare.inventory.commit@1',
  'arca.aftercare.case.commit@1','arca.aftercare.workspace.reclaim@1',
]);
const OFFDECK_REFS=Object.freeze(['arca.offdeck.duplicate.detect@1','arca.offdeck.duplicate_group.commit@1','arca.offdeck.review_candidate.commit@1',
  'arca.offdeck.destruction_scope.verify@1','arca.offdeck.primary_material.delete@1',
  'arca.offdeck.related_reference.release@1','arca.offdeck.unreferenced_related.delete@1',
  'arca.offdeck.deletion.verify@1','arca.offdeck.terminal.commit@1']);
const DEREGISTRATION_REFS=Object.freeze(['arca.shelf_deregistration.release_manifest.verify@1','arca.shelf_deregistration.commit@1']);
const CORRECTION_REFS=Object.freeze(['arca.jav_correction.source.verify@1','arca.jav_correction.assets.prepare@1','arca.jav_correction.files.stage@1','arca.jav_correction.files.publish@1','arca.jav_correction.files.verify@1','arca.jav_correction.inventory.commit@1','arca.jav_correction.formal_retirement.execute@1','arca.jav_correction.workspace.reclaim@1']);

function createArcaExecutionRegistration() {
  return Object.freeze({
    createTerminalEffectHistoryObserver,
    createCapabilityRegistration(options) {
      const contextReader=options.contextReader||createOnDeckContextReader(options);
      const aftercareContextReader=options.aftercareContextReader||createAftercareContextReader(options);
      const offdeckContextReader=options.offdeckContextReader||createOffdeckContextReader(options);
      const shelfDeregistrationContextReader=options.shelfDeregistrationContextReader||createShelfDeregistrationContextReader(options);
      const series=options.createSeriesPresentationIo?createSeriesPresentationServices({...options,aftercareContextReader}):null,
        seriesPorts=series?createSeriesPresentationCapabilityPorts({...options,...series}):{};
      const relocation=options.createSeriesRootRelocationIo?createSeriesRootRelocationServices({...options,series}):null,
        relocationPorts=relocation?createSeriesRootRelocationPorts({...options,...relocation}):{};
      const ports=createOnDeckCapabilityPorts({...options,series,contextReader,aftercareContextReader});
      const aftercarePorts=createAftercareCapabilityPorts({...options,series,contextReader:aftercareContextReader});
      const actorRefreshSource=createUsAdultActorRefreshSource({...options,aftercareContextReader}),
        actorSourcePort=createUsAdultActorSourcePort({...options,aftercareContextReader,actorRefreshSource}),
        actorMatchQuery=createUsAdultActorMatchQuery({...options,actorRefreshSource}),
        actorMatchPort=createUsAdultActorMatchPort({...options,aftercareContextReader,actorRefreshSource,actorMatchQuery}),
        actorPipelineQuery=createUsAdultActorPipelineQuery({...options,aftercareContextReader,actorRefreshSource}),
        actorPhasePorts=createUsAdultActorPipelinePorts({...options,aftercareContextReader,actorPipelineQuery});
      const offdeckPorts=createOffdeckCapabilityPorts({...options,contextReader:offdeckContextReader});
      const shelfDeregistrationPorts=createShelfDeregistrationCapabilityPorts({...options,contextReader:shelfDeregistrationContextReader});
      const correction=options.acquireJavCover?createJavCorrectionServices({...options,aftercareContextReader}):null,
        correctionPorts=correction?createJavCorrectionCapabilityPorts({...options,...correction,
          assertCurrentCorrectionScope:correction.correctionContextReader.assertCurrent}):{};
      return Object.freeze({contextReader,aftercareContextReader,offdeckContextReader,shelfDeregistrationContextReader,series,relocation,correction,actorRefreshSource,actorMatchQuery,actorPipelineQuery,
        ports:Object.freeze({...relocationPorts,...seriesPorts,...ports,...aftercarePorts,...offdeckPorts,...shelfDeregistrationPorts,...correctionPorts,...actorPhasePorts,[ACTOR_SOURCE]:actorSourcePort,[ACTOR_MATCH]:actorMatchPort}),createRegistrations(registrationOptions){
        const assessment=registrationOptions.enabledCapabilityRefs.filter((ref)=>AFTERCARE_REFS.includes(ref));
        const offdeck=registrationOptions.enabledCapabilityRefs.filter((ref)=>OFFDECK_REFS.includes(ref));
        const deregistration=registrationOptions.enabledCapabilityRefs.filter((ref)=>DEREGISTRATION_REFS.includes(ref));
        const corrected=registrationOptions.enabledCapabilityRefs.filter(ref=>CORRECTION_REFS.includes(ref));
        const onDeck=registrationOptions.enabledCapabilityRefs.filter((ref)=>!ROOT_REFS.includes(ref)&&!SERIES_REFS.includes(ref)&&!ACTOR_REFS.includes(ref)&&!AFTERCARE_REFS.includes(ref)&&!OFFDECK_REFS.includes(ref)&&!DEREGISTRATION_REFS.includes(ref)&&!CORRECTION_REFS.includes(ref));
        return Object.freeze([
          ...registrationOptions.enabledCapabilityRefs.filter(ref=>ROOT_REFS.includes(ref)).map(ref=>{
            const manifest=registrationOptions.manifests[ref],port=relocationPorts[ref];
            if(!port)throw new TypeError('Series relocation runtime is unavailable.');
            return {manifest,executor:{version:1,execute:port.execute},semanticValidator:{ref:manifest.semanticValidatorRef,validateInputs:port.validateInputs,validateResult:port.validateResult}};
          }),
          ...registrationOptions.enabledCapabilityRefs.filter(ref=>SERIES_REFS.includes(ref)).map(ref=>{
            const manifest=registrationOptions.manifests[ref],port=seriesPorts[ref];
            if(!port)throw new TypeError('Shared presentation runtime is unavailable.');
            return {manifest,executor:{version:1,execute:port.execute},semanticValidator:{ref:manifest.semanticValidatorRef,validateInputs:port.validateInputs,validateResult:port.validateResult}};
          }),
          ...registrationOptions.enabledCapabilityRefs.filter(ref=>ACTOR_REFS.includes(ref)).map(ref=>{
            const manifest=registrationOptions.manifests[ref],port=ref===ACTOR_SOURCE?actorSourcePort:ref===ACTOR_MATCH?actorMatchPort:actorPhasePorts[ref];
            if(manifest.ownerScope!=='arca'||!port)throw new TypeError('Actor analysis registration changed its exact Owner or Effect.');
            return {manifest,executor:{version:1,execute:port.execute},semanticValidator:{ref:manifest.semanticValidatorRef,
              validateInputs:port.validateInputs,validateResult:port.validateResult}};
          }),
          ...createOnDeckCapabilityRegistrations({...registrationOptions,enabledCapabilityRefs:onDeck,
            ports:Object.fromEntries(onDeck.map((ref)=>[ref,ports[ref]]))}),
          ...createAftercareCapabilityRegistrations({...registrationOptions,enabledCapabilityRefs:assessment,
            ports:Object.fromEntries(assessment.map((ref)=>[ref,aftercarePorts[ref]]))}),
          ...createOffdeckCapabilityRegistrations({...registrationOptions,enabledCapabilityRefs:offdeck,
            ports:Object.fromEntries(offdeck.map((ref)=>[ref,offdeckPorts[ref]]))}),
          ...createShelfDeregistrationCapabilityRegistrations({...registrationOptions,enabledCapabilityRefs:deregistration,
            ports:Object.fromEntries(deregistration.map((ref)=>[ref,shelfDeregistrationPorts[ref]]))}),
          ...createJavCorrectionExecutionRegistrations({...registrationOptions,enabledCapabilityRefs:corrected,ports:correctionPorts}),
        ]);
      }});
    },
    createProcessServices(options) {
      const contextReader=options.contextReader||createOnDeckContextReader(options);
      const formationStatusProjection=createFormationStatusProjection(options);
      const aftercareContextReader=options.aftercareContextReader||createAftercareContextReader(options);
      const recordRefresh=createInventoryRecordRefresh({...options,contextReader:aftercareContextReader});
      const actorRefreshCoordinator=options.actorPipelineQuery?createUsAdultActorRefreshCoordinator({...options,aftercareContextReader}):null;
      const aftercareCoordinator=createAftercareProcessCoordinator({...options,contextReader:aftercareContextReader,actorRefreshCoordinator,
        refreshInventoryRecords:recordRefresh.refresh,
        refreshPersonRecords:createInventoryPersonRecordRefresh({...options,contextReader:aftercareContextReader}).refresh});
      const offdeckContextReader=options.offdeckContextReader||createOffdeckContextReader({...options,
        readAftercareHealth:options.readAftercareHealth||((shelfEntryId)=>{const value=aftercareCoordinator.project(shelfEntryId);return value?Object.freeze({...value,ageDays:Math.max(0,((options.now||Date.now)()-value.updatedAtMs)/86_400_000)}):undefined;})});
      const shelfDeregistrationContextReader=options.shelfDeregistrationContextReader||createShelfDeregistrationContextReader(options);
      return Object.freeze({contextReader,formationStatusProjection,correction:options.correction,
        actorRefresh:options.actorRefreshSource?createUsAdultActorRefreshAdmin({...options,aftercareContextReader}):null,
        onDeckPersonEvidenceProjection:createOnDeckPersonEvidenceProjection(options),
        onDeckNfoPersonEvidence:createOnDeckNfoPersonEvidence({...options,contextReader:aftercareContextReader}),
        aftercareContextReader,coordinator:createOnDeckProcessCoordinator({...options,contextReader}),
        aftercareCoordinator,defectAdmission:createDefectAdmissionApplication({...options,contextReader:aftercareContextReader}),offdeckContextReader,
        offdeckCoordinator:createOffdeckProcessCoordinator({...options,contextReader:offdeckContextReader}),
        offdeckAutomationCoordinator:createOffdeckAutomationCoordinator({...options,contextReader:offdeckContextReader}),shelfDeregistrationContextReader,
        shelfDeregistrationCoordinator:createShelfDeregistrationCoordinator({...options,contextReader:shelfDeregistrationContextReader,aftercareContextReader,aftercareCoordinator})});
    },
    createPlanningRegistration(options) {
      options={...options,evidenceReader:createPlanningEvidenceReader(options)};
      const aftercareContextReader=options.aftercareContextReader||createAftercareContextReader(options);
      const offdeckContextReader=options.offdeckContextReader||createOffdeckContextReader(options);
      const shelfDeregistrationContextReader=options.shelfDeregistrationContextReader||createShelfDeregistrationContextReader(options);
      return Object.freeze({planners:Object.freeze([...(options.relocation?[createSeriesRootRelocationPlanner(options)]:[]),...(options.series?[createSeriesPresentationPlanner(options),createSeriesPresentationReclaimPlanner(options)]:[]),...(options.actorRefreshSource?[createUsAdultActorSourcePlanner(options)]:[]),
        ...(options.actorMatchQuery?[createUsAdultActorMatchPlanner(options)]:[]),
        ...(options.actorPipelineQuery?createUsAdultActorPipelinePlanners({...options,aftercareContextReader}):[]),createAcceptanceAssessmentPlanner(options),
        createAcceptanceCommitPlanner(options),createAcceptanceRejectionPlanner(options),
        createOnDeckExecutionPlanner({...options,contextReader:options.contextReader}),
        createHealthAssessmentPlanner({...options,contextReader:aftercareContextReader}),createCustodyAssessmentPlanner(options),
        createHealthAssessmentPlanner({...options,contextReader:aftercareContextReader,workKind:'periodic_health_assessment'}),
        createCustodyAssessmentPlanner({...options,workKind:'periodic_custody_assessment'}),
        createCareRepairPreparationPlanner({...options,contextReader:aftercareContextReader}),
        createCareRepairCommitPlanner({...options,contextReader:aftercareContextReader}),
        createCareCaseClosurePlanner({...options,contextReader:aftercareContextReader}),
        createCareDeregistrationSettlementPlanner({...options,contextReader:aftercareContextReader}),
        createCareWorkspaceReclaimPlanner({...options,contextReader:aftercareContextReader}),
        createOffdeckPolicyEvaluationPlanner({...options,contextReader:offdeckContextReader}),
        createOffdeckDuplicateDetectionPlanner({...options,contextReader:offdeckContextReader}),
        createScopeVerificationPlanner({...options,contextReader:offdeckContextReader}),
        createMaterialDestructionPlanner({...options,contextReader:offdeckContextReader}),
        createTerminalCommitPlanner({...options,contextReader:offdeckContextReader}),
        createManifestVerificationPlanner({...options,contextReader:shelfDeregistrationContextReader}),
        createDeregistrationCommitPlanner({...options,contextReader:shelfDeregistrationContextReader}),
        ...(options.correction?[createJavCorrectionAssetsPlanner({...options,...options.correction}),createJavCorrectionFilesPlanner({...options,...options.correction}),createJavCorrectionPublishPlanner({...options,...options.correction}),createJavCorrectionVerifyPlanner({...options,...options.correction}),createJavCorrectionCommitPlanner({...options,...options.correction}),createJavCorrectionRetirementPlanner({...options,...options.correction}),createJavCorrectionWorkspaceReclaimPlanner({...options,...options.correction})]:[])]),
      bindingProjections:Object.freeze([...(options.relocation?createSeriesRootRelocationProjections(options):[]),...(options.series?createSeriesPresentationProjections(options):[]),...(options.actorRefreshSource?createUsAdultActorSourceProjections(options):[]),
        ...(options.actorMatchQuery?createUsAdultActorMatchProjections(options):[]),
        ...(options.actorPipelineQuery?createUsAdultActorPipelineProjections({...options,aftercareContextReader}):[]),...createOnDeckProjections(options),...createAftercareProjections({...options,contextReader:aftercareContextReader}),
        ...createOffdeckAutomationProjections({...options,contextReader:offdeckContextReader}),
        ...createOffdeckProjections({...options,contextReader:offdeckContextReader}),
        ...createShelfDeregistrationProjections({...options,contextReader:shelfDeregistrationContextReader}),
        ...(options.correction?createJavCorrectionProjections({...options,...options.correction}):[])])});
    },
  });
}

Object.defineProperty(createArcaExecutionRegistration, 'createOffloadCompletionPort', {
  value: createOffloadCompletionPort,
});

module.exports = Object.freeze({createArcaOfferResponsibilityProjection:require('../application/offer-responsibility-projection').createArcaOfferResponsibilityProjection,
  describeFreshResetWorkspaceRetention:require('../model/fresh-reset-workspace-retention').describeFreshResetWorkspaceRetention,
  describeFreshResetSeriesRetention:require('../model/fresh-reset-series-retention').describeFreshResetSeriesRetention,
  createFreshResetSeriesNormalization(options) { return require('../persistence/series-presentation-store').createSeriesPresentationStore(options).normalizeFreshResetHeads; },
  createArcaFormationRetirementStore:require('../persistence/formation-retirement-store').createArcaFormationRetirementStore,
  createFormationSharedRetirement:require('../persistence/formation-shared-retirement').createFormationSharedRetirement,
  createSeriesPresentationQuery:require('../application/series-presentation-query').createSeriesPresentationQuery,
  createArcaArtifactAuditSource(options){const source=require('../persistence/reference-artifact-audit-source').createArcaArtifactAuditSource(options);return Object.freeze({sourceId:source.sourceId,epoch:source.epoch,page:source.page});}, PACKAGE_ID:packageId, ArcaExecutionRegistration:createArcaExecutionRegistration });
