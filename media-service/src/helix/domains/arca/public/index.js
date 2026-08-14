'use strict';

const { packageId } = require('./package.boundary.json');
const { createOnDeckContextReader } = require('../application/on-deck-context-reader');
const { createOnDeckProcessCoordinator } = require('../application/on-deck-process-coordinator');
const { createOnDeckCapabilityPorts } = require('../capabilities/on-deck-capability-ports');
const { createOnDeckCapabilityRegistrations } = require('../capabilities/on-deck-execution-registrations');
const { createAcceptanceAssessmentPlanner, createAcceptanceCommitPlanner,
  createAcceptanceRejectionPlanner, createOnDeckExecutionPlanner } = require('../planning/on-deck-planners');
const { createOnDeckProjections } = require('../planning/on-deck-projections');

function createArcaExecutionRegistration() {
  return Object.freeze({
    createCapabilityRegistration(options) {
      const contextReader=options.contextReader||createOnDeckContextReader(options);
      const ports=createOnDeckCapabilityPorts({...options,contextReader});
      return Object.freeze({contextReader,ports,createRegistrations(registrationOptions){
        return createOnDeckCapabilityRegistrations({...registrationOptions,
          ports:Object.fromEntries(registrationOptions.enabledCapabilityRefs.map((ref)=>[ref,ports[ref]]))});
      }});
    },
    createProcessServices(options) {
      const contextReader=options.contextReader||createOnDeckContextReader(options);
      return Object.freeze({contextReader,coordinator:createOnDeckProcessCoordinator({...options,contextReader})});
    },
    createPlanningRegistration(options) {
      return Object.freeze({planners:Object.freeze([createAcceptanceAssessmentPlanner(options),
        createAcceptanceCommitPlanner(options),createAcceptanceRejectionPlanner(options),
        createOnDeckExecutionPlanner({...options,contextReader:options.contextReader})]),
      bindingProjections:createOnDeckProjections(options)});
    },
  });
}

module.exports = Object.freeze({ PACKAGE_ID:packageId, ArcaExecutionRegistration:createArcaExecutionRegistration });
