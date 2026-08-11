'use strict';

const catalog = require('../../../contracts/ports/p8-libra-intake-public-contracts.json');
const productionCatalog = require('../../../contracts/ports/p9-libra-production-public-contracts.json');
const { packageId } = require('./package.boundary.json');
const { createIntakeCapabilityPorts } = require('../capabilities/intake-capability-ports');
const { createIntakeCapabilityRegistrations } = require('../capabilities/intake-capability-registrations');
const { createIntakeOfferReader } = require('../persistence/intake-offer-reader');
const { createIntakeDecisionResolver } = require('../application/intake-decision-resolver');
const { createIntakeProcessCoordinator } = require('../application/intake-process-coordinator');
const { createEvidencePlanner,createAcceptancePlanner,createRejectionPlanner,createIntakeProjections } = require('../planning/intake-planners');
const { createRoutingCapabilityPorts } = require('../capabilities/routing-capability-ports');
const { createRoutingCapabilityRegistrations, EFFECTS: ROUTING_EFFECTS } = require('../capabilities/routing-capability-registrations');
const { createRoutingContextReader } = require('../application/routing-context-reader');
const { createRoutingProcessCoordinator } = require('../application/routing-process-coordinator');
const { createFactPlanner, createBasisPlanner, createRoutingProjections } = require('../planning/routing-planners');

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
  if (JSON.stringify(provided) !== JSON.stringify(expected) || typeof implementation.readPackage !== 'function') {
    throw new LibraPublicFacadeError('P9_PRODUCT_DELIVERY_PORT_SHAPE_MISMATCH',
      'Product Delivery implementation must expose only the frozen readPackage method.', { expected, provided });
  }
  return Object.freeze({ readPackage: (query) => implementation.readPackage(query) });
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
      const intakePorts=createIntakeCapabilityPorts({...options,offerReader});
      const routingPorts=createRoutingCapabilityPorts(options);
      const ports=Object.freeze({...intakePorts,...routingPorts});
      return Object.freeze({offerReader,ports,createRegistrations(registrationOptions){
        const routingRefs=registrationOptions.enabledCapabilityRefs.filter((ref)=>ROUTING_EFFECTS[ref]);
        const intakeRefs=registrationOptions.enabledCapabilityRefs.filter((ref)=>!ROUTING_EFFECTS[ref]);
        return Object.freeze([
          ...createIntakeCapabilityRegistrations({...registrationOptions,enabledCapabilityRefs:intakeRefs,
            ports:Object.fromEntries(intakeRefs.map((ref)=>[ref,ports[ref]]))}),
          ...createRoutingCapabilityRegistrations({...registrationOptions,enabledCapabilityRefs:routingRefs,
            ports:Object.fromEntries(routingRefs.map((ref)=>[ref,ports[ref]]))}),
        ]);
      }});
    },
    createProcessServices(options) {
      const offerReader=options.offerReader || createIntakeOfferReader(options);
      const decisionResolver=createIntakeDecisionResolver(options);
      const coordinator=createIntakeProcessCoordinator({...options,offerReader});
      const routingContextReader=createRoutingContextReader(options);
      const routingCoordinator=createRoutingProcessCoordinator({...options,contextReader:routingContextReader});
      return Object.freeze({offerReader,decisionResolver,coordinator,routingContextReader,routingCoordinator});
    },
    createPlanningRegistration(options) {
      return Object.freeze({planners:Object.freeze([
        createEvidencePlanner(options),createAcceptancePlanner(options),createRejectionPlanner(options),
        createFactPlanner(options,'related_nfo'),createFactPlanner(options,'provider'),createBasisPlanner(options)
      ]),bindingProjections:Object.freeze([...createIntakeProjections(options),...createRoutingProjections(options)])});
    }
  };
  const provided=Object.keys(implementation).sort(),expected=[...executionContract.methods].sort();
  if(JSON.stringify(provided)!==JSON.stringify(expected)||expected.some((method)=>typeof implementation[method]!=='function')){
    throw new LibraPublicFacadeError('P8_LIBRA_EXECUTION_PORT_SHAPE_MISMATCH','Libra Execution registration does not match its formal construction contract.',{expected,provided});
  }
  return Object.freeze(implementation);
}

module.exports = Object.freeze({
  PACKAGE_ID:packageId,
  LibraIntakeFacade:bind,
  ProductDeliveryPort:bindProductDelivery,
  WorkspaceReclamationPort:bindWorkspaceReclamation,
  LibraExecutionRegistration:createExecutionRegistration
});
