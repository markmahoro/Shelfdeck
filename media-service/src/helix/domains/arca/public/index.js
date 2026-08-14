'use strict';

const { packageId } = require('./package.boundary.json');
const { createOnDeckContextReader } = require('../application/on-deck-context-reader');
const { createOnDeckProcessCoordinator } = require('../application/on-deck-process-coordinator');
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
  createCareRepairCommitPlanner, createCareCaseClosurePlanner } = require('../planning/aftercare-planners');
const { createAftercareProjections } = require('../planning/aftercare-projections');

const AFTERCARE_REFS = Object.freeze([
  'arca.aftercare.custody.observe@1','arca.aftercare.presentation.observe@1',
  'arca.aftercare.conformance.observe@1','arca.aftercare.assessment.commit@1',
  'arca.aftercare.text_artifact.render@1','arca.aftercare.binary_artifact.acquire@1',
  'arca.aftercare.artifact.materialize@1','arca.aftercare.media.remux@1',
  'arca.aftercare.media.transcode@1','arca.aftercare.media.verify@1',
  'arca.aftercare.input_settlement.delete@1','arca.aftercare.inventory.commit@1',
  'arca.aftercare.case.commit@1','arca.aftercare.workspace.reclaim@1',
]);

function createArcaExecutionRegistration() {
  return Object.freeze({
    createCapabilityRegistration(options) {
      const contextReader=options.contextReader||createOnDeckContextReader(options);
      const aftercareContextReader=options.aftercareContextReader||createAftercareContextReader(options);
      const ports=createOnDeckCapabilityPorts({...options,contextReader,aftercareContextReader});
      const aftercarePorts=createAftercareCapabilityPorts({...options,contextReader:aftercareContextReader});
      return Object.freeze({contextReader,aftercareContextReader,ports:Object.freeze({...ports,...aftercarePorts}),createRegistrations(registrationOptions){
        const assessment=registrationOptions.enabledCapabilityRefs.filter((ref)=>AFTERCARE_REFS.includes(ref));
        const onDeck=registrationOptions.enabledCapabilityRefs.filter((ref)=>!AFTERCARE_REFS.includes(ref));
        return Object.freeze([
          ...createOnDeckCapabilityRegistrations({...registrationOptions,enabledCapabilityRefs:onDeck,
            ports:Object.fromEntries(onDeck.map((ref)=>[ref,ports[ref]]))}),
          ...createAftercareCapabilityRegistrations({...registrationOptions,enabledCapabilityRefs:assessment,
            ports:Object.fromEntries(assessment.map((ref)=>[ref,aftercarePorts[ref]]))}),
        ]);
      }});
    },
    createProcessServices(options) {
      const contextReader=options.contextReader||createOnDeckContextReader(options);
      const aftercareContextReader=options.aftercareContextReader||createAftercareContextReader(options);
      return Object.freeze({contextReader,aftercareContextReader,coordinator:createOnDeckProcessCoordinator({...options,contextReader}),
        aftercareCoordinator:createAftercareProcessCoordinator({...options,contextReader:aftercareContextReader})});
    },
    createPlanningRegistration(options) {
      const aftercareContextReader=options.aftercareContextReader||createAftercareContextReader(options);
      return Object.freeze({planners:Object.freeze([createAcceptanceAssessmentPlanner(options),
        createAcceptanceCommitPlanner(options),createAcceptanceRejectionPlanner(options),
        createOnDeckExecutionPlanner({...options,contextReader:options.contextReader}),
        createHealthAssessmentPlanner(options),createCustodyAssessmentPlanner(options),
        createCareRepairPreparationPlanner({...options,contextReader:aftercareContextReader}),
        createCareRepairCommitPlanner({...options,contextReader:aftercareContextReader}),
        createCareCaseClosurePlanner({...options,contextReader:aftercareContextReader})]),
      bindingProjections:Object.freeze([...createOnDeckProjections(options),...createAftercareProjections({...options,contextReader:aftercareContextReader})])});
    },
  });
}

module.exports = Object.freeze({ PACKAGE_ID:packageId, ArcaExecutionRegistration:createArcaExecutionRegistration });
