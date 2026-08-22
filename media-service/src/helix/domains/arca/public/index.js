'use strict';

const { packageId } = require('./package.boundary.json');
const { createOnDeckContextReader } = require('../application/on-deck-context-reader');
const { createOnDeckPersonEvidenceProjection } = require('../application/on-deck-person-evidence-projection');
const { createOnDeckProcessCoordinator } = require('../application/on-deck-process-coordinator');
const { createFormationStatusProjection } = require('../application/formation-status-projection');
const { createOnDeckCapabilityPorts } = require('../capabilities/on-deck-capability-ports');
const { createOnDeckCapabilityRegistrations } = require('../capabilities/on-deck-execution-registrations');
const { createAcceptanceAssessmentPlanner, createAcceptanceCommitPlanner,
  createAcceptanceRejectionPlanner, createOnDeckExecutionPlanner } = require('../planning/on-deck-planners');
const { createOnDeckProjections } = require('../planning/on-deck-projections');
const { createAftercareContextReader } = require('../application/aftercare-context-reader');
const { createAftercareProcessCoordinator } = require('../application/aftercare-process-coordinator');
const { createAftercareCapabilityPorts } = require('../capabilities/aftercare-capability-ports');
const { createAftercareCapabilityRegistrations } = require('../capabilities/aftercare-execution-registrations');
const { createHealthAssessmentPlanner, createCustodyAssessmentPlanner, createCareRepairPreparationPlanner,
  createCareRepairCommitPlanner, createCareCaseClosurePlanner, createCareDeregistrationSettlementPlanner } = require('../planning/aftercare-planners');
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

function createArcaExecutionRegistration() {
  return Object.freeze({
    createCapabilityRegistration(options) {
      const contextReader=options.contextReader||createOnDeckContextReader(options);
      const aftercareContextReader=options.aftercareContextReader||createAftercareContextReader(options);
      const offdeckContextReader=options.offdeckContextReader||createOffdeckContextReader(options);
      const shelfDeregistrationContextReader=options.shelfDeregistrationContextReader||createShelfDeregistrationContextReader(options);
      const ports=createOnDeckCapabilityPorts({...options,contextReader,aftercareContextReader});
      const aftercarePorts=createAftercareCapabilityPorts({...options,contextReader:aftercareContextReader});
      const offdeckPorts=createOffdeckCapabilityPorts({...options,contextReader:offdeckContextReader});
      const shelfDeregistrationPorts=createShelfDeregistrationCapabilityPorts({...options,contextReader:shelfDeregistrationContextReader});
      return Object.freeze({contextReader,aftercareContextReader,offdeckContextReader,shelfDeregistrationContextReader,ports:Object.freeze({...ports,...aftercarePorts,...offdeckPorts,...shelfDeregistrationPorts}),createRegistrations(registrationOptions){
        const assessment=registrationOptions.enabledCapabilityRefs.filter((ref)=>AFTERCARE_REFS.includes(ref));
        const offdeck=registrationOptions.enabledCapabilityRefs.filter((ref)=>OFFDECK_REFS.includes(ref));
        const deregistration=registrationOptions.enabledCapabilityRefs.filter((ref)=>DEREGISTRATION_REFS.includes(ref));
        const onDeck=registrationOptions.enabledCapabilityRefs.filter((ref)=>!AFTERCARE_REFS.includes(ref)&&!OFFDECK_REFS.includes(ref)&&!DEREGISTRATION_REFS.includes(ref));
        return Object.freeze([
          ...createOnDeckCapabilityRegistrations({...registrationOptions,enabledCapabilityRefs:onDeck,
            ports:Object.fromEntries(onDeck.map((ref)=>[ref,ports[ref]]))}),
          ...createAftercareCapabilityRegistrations({...registrationOptions,enabledCapabilityRefs:assessment,
            ports:Object.fromEntries(assessment.map((ref)=>[ref,aftercarePorts[ref]]))}),
          ...createOffdeckCapabilityRegistrations({...registrationOptions,enabledCapabilityRefs:offdeck,
            ports:Object.fromEntries(offdeck.map((ref)=>[ref,offdeckPorts[ref]]))}),
          ...createShelfDeregistrationCapabilityRegistrations({...registrationOptions,enabledCapabilityRefs:deregistration,
            ports:Object.fromEntries(deregistration.map((ref)=>[ref,shelfDeregistrationPorts[ref]]))}),
        ]);
      }});
    },
    createProcessServices(options) {
      const contextReader=options.contextReader||createOnDeckContextReader(options);
      const formationStatusProjection=createFormationStatusProjection(options);
      const aftercareContextReader=options.aftercareContextReader||createAftercareContextReader(options);
      const aftercareCoordinator=createAftercareProcessCoordinator({...options,contextReader:aftercareContextReader});
      const offdeckContextReader=options.offdeckContextReader||createOffdeckContextReader({...options,
        readAftercareHealth:options.readAftercareHealth||((shelfEntryId)=>{const value=aftercareCoordinator.project(shelfEntryId);return value?Object.freeze({...value,ageDays:Math.max(0,((options.now||Date.now)()-value.updatedAtMs)/86_400_000)}):undefined;})});
      const shelfDeregistrationContextReader=options.shelfDeregistrationContextReader||createShelfDeregistrationContextReader(options);
      return Object.freeze({contextReader,formationStatusProjection,
        onDeckPersonEvidenceProjection:createOnDeckPersonEvidenceProjection(options),
        aftercareContextReader,coordinator:createOnDeckProcessCoordinator({...options,contextReader}),
        aftercareCoordinator,offdeckContextReader,
        offdeckCoordinator:createOffdeckProcessCoordinator({...options,contextReader:offdeckContextReader}),
        offdeckAutomationCoordinator:createOffdeckAutomationCoordinator({...options,contextReader:offdeckContextReader}),shelfDeregistrationContextReader,
        shelfDeregistrationCoordinator:createShelfDeregistrationCoordinator({...options,contextReader:shelfDeregistrationContextReader,aftercareContextReader,aftercareCoordinator})});
    },
    createPlanningRegistration(options) {
      const aftercareContextReader=options.aftercareContextReader||createAftercareContextReader(options);
      const offdeckContextReader=options.offdeckContextReader||createOffdeckContextReader(options);
      const shelfDeregistrationContextReader=options.shelfDeregistrationContextReader||createShelfDeregistrationContextReader(options);
      return Object.freeze({planners:Object.freeze([createAcceptanceAssessmentPlanner(options),
        createAcceptanceCommitPlanner(options),createAcceptanceRejectionPlanner(options),
        createOnDeckExecutionPlanner({...options,contextReader:options.contextReader}),
        createHealthAssessmentPlanner(options),createCustodyAssessmentPlanner(options),
        createCareRepairPreparationPlanner({...options,contextReader:aftercareContextReader}),
        createCareRepairCommitPlanner({...options,contextReader:aftercareContextReader}),
        createCareCaseClosurePlanner({...options,contextReader:aftercareContextReader}),
        createCareDeregistrationSettlementPlanner({...options,contextReader:aftercareContextReader}),
        createOffdeckPolicyEvaluationPlanner({...options,contextReader:offdeckContextReader}),
        createOffdeckDuplicateDetectionPlanner({...options,contextReader:offdeckContextReader}),
        createScopeVerificationPlanner({...options,contextReader:offdeckContextReader}),
        createMaterialDestructionPlanner({...options,contextReader:offdeckContextReader}),
        createTerminalCommitPlanner({...options,contextReader:offdeckContextReader}),
        createManifestVerificationPlanner({...options,contextReader:shelfDeregistrationContextReader}),
        createDeregistrationCommitPlanner({...options,contextReader:shelfDeregistrationContextReader})]),
      bindingProjections:Object.freeze([...createOnDeckProjections(options),...createAftercareProjections({...options,contextReader:aftercareContextReader}),
        ...createOffdeckAutomationProjections({...options,contextReader:offdeckContextReader}),
        ...createOffdeckProjections({...options,contextReader:offdeckContextReader}),
        ...createShelfDeregistrationProjections({...options,contextReader:shelfDeregistrationContextReader})])});
    },
  });
}

module.exports = Object.freeze({ PACKAGE_ID:packageId, ArcaExecutionRegistration:createArcaExecutionRegistration });
