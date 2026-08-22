'use strict';

const catalog = require('../../../contracts/ports/p7-procurement-public-contracts.json');
const { packageId } = require('./package.boundary.json');
const { createFieldObservationCapabilityPorts } = require('../capabilities/field-observation-capability-ports');
const { createTriageCapabilityPorts } = require('../capabilities/triage-capability-ports');
const { createProcurementCapabilityRegistrations } = require('../capabilities/procurement-capability-registrations');
const { createFieldObservationPlanner } = require('../planning/field-observation-planner');
const { createFieldObservationProgressReader } = require('../persistence/field-observation-progress-reader');
const { createProcurementRunTriageReader } = require('../persistence/procurement-run-triage-reader');
const { createTriageEvidenceIndex } = require('../persistence/triage-evidence-index');
const { createProcurementCandidateContextReader } = require('../persistence/procurement-candidate-context-reader');
const { createProcurementRunSealCommandStore } = require('../persistence/procurement-run-seal-command-store');
const { createProcurementAutomationService } = require('../application/procurement-automation-service');
const {
  createFieldObservationAdminService,
} = require('../application/field-observation-admin-service');
const {
  createFieldObservationAutomation,
} = require('../application/field-observation-automation');
const { createProcurementRunCoordinator } = require('../application/procurement-run-coordinator');
const { PROBE_BATCH_PROJECTION,BDMV_ASSESS_INPUT_PROJECTION,STRUCTURE_INPUT_PROJECTION,createEvidenceAssessmentPlanner,createProbeBatchProjection,createBdmvAssessmentInputProjection,createStructureInputProjection } = require('../planning/evidence-assessment-planner');
const { DRAFT_PROJECTION,COMMIT_HANDLE_PROJECTION,IDENTITY_INPUT_PROJECTION,MANIFEST_INPUT_PROJECTION,
  createCandidateAssemblyPlanner,createCandidateDraftProjection,createCandidateCommitHandleProjection,
  createCandidateIdentityInputProjection,createCandidateManifestInputProjection } = require('../planning/candidate-assembly-planner');
const { createDefaultTriageRuleRegistry } = require('../model/procurement-run-contracts');

class ProcurementPublicFacadeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProcurementPublicFacadeError';
    this.code = code;
    this.details = details;
  }
}

const contracts = new Map(catalog.facades
  .filter((contract) => contract.packageId === packageId)
  .map((contract) => [contract.exportName, Object.freeze({ ...contract, methods: Object.freeze([...contract.methods]) })]));

function bind(exportName, implementation) {
  const contract = contracts.get(exportName);
  if (!contract) throw new ProcurementPublicFacadeError('P7_UNKNOWN_PROCUREMENT_PORT', 'Unknown Procurement public port.', { exportName });
  if (!implementation || typeof implementation !== 'object' || Array.isArray(implementation)) {
    throw new ProcurementPublicFacadeError('P7_PROCUREMENT_IMPLEMENTATION_REQUIRED', 'A typed implementation object is required.', { exportName });
  }
  const provided = Object.keys(implementation).sort();
  const expected = [...contract.methods].sort();
  if (JSON.stringify(provided) !== JSON.stringify(expected) || contract.methods.some((method) => typeof implementation[method] !== 'function')) {
    throw new ProcurementPublicFacadeError('P7_PROCUREMENT_PORT_SHAPE_MISMATCH', 'Implementation must match the nominal methods exactly.', {
      exportName, expected, provided
    });
  }
  return Object.freeze(Object.fromEntries(contract.methods.map((method) => [method, (input) => implementation[method](input)])));
}

function createExecutionRegistration() {
  return bind('ProcurementExecutionRegistration', {
    createCapabilityRegistration(options) {
      const ports = Object.freeze({
        ...createFieldObservationCapabilityPorts(options),
        ...createTriageCapabilityPorts(options)
      });
      return Object.freeze({
        ports,
        createRegistrations(registrationOptions) {
          const selectedPorts = Object.fromEntries(registrationOptions.enabledCapabilityRefs.map((ref) => [ref, ports[ref]]));
          return createProcurementCapabilityRegistrations({ ...registrationOptions, ports:selectedPorts });
        }
      });
    },
    createProcessServices(options) {
      const triageReader = createProcurementRunTriageReader(options);
      const triageRuleRegistry = options.triageRegistry || createDefaultTriageRuleRegistry();
      const workResultReader = options.workResultReader;
      const evidenceIndex = options.evidenceIndex || createTriageEvidenceIndex({ workResultReader });
      const candidateContextReader = options.candidateContextReader || createProcurementCandidateContextReader({
        triageReader, evidenceIndex, triageRuleRegistry,
      });
      const progressReader = createFieldObservationProgressReader(options);
      const procurementAutomation = createProcurementAutomationService({ ...options, triageRegistry: triageRuleRegistry });
      const runSealStore = createProcurementRunSealCommandStore(options);
      const runCoordinator = createProcurementRunCoordinator({ ...options, triageReader, workResultReader, evidenceIndex, runSealStore });
      const observationAdmin = options.executionRuntimeHost && options.materialFieldStore
        ? createFieldObservationAdminService(options)
        : null;
      const fieldObservationAutomation = observationAdmin && workResultReader
        ? createFieldObservationAutomation({
          materialFieldStore: options.materialFieldStore,
          observationAdmin,
          workResultReader,
          progressReader,
          now: options.now || Date.now,
        })
        : null;
      return Object.freeze({ triageReader, triageRuleRegistry, progressReader, procurementAutomation, runCoordinator,
        evidenceIndex, candidateContextReader, observationAdmin, fieldObservationAutomation });
    },
    createPlanningRegistration(options) {
      const { registry, policyRegistry, contractValidator, progressReader, triageReader,
        triageRuleRegistry, workResultReader, materialFieldStore, now } = options;
      const evidenceIndex = options.evidenceIndex || createTriageEvidenceIndex({ workResultReader });
      const candidateContextReader = options.candidateContextReader || createProcurementCandidateContextReader({
        triageReader, evidenceIndex, triageRuleRegistry,
      });
      const planners = Object.freeze([
        createFieldObservationPlanner({ registry, policyRegistry, contractValidator, progressReader, materialFieldStore, now }),
        createEvidenceAssessmentPlanner({ registry, policyRegistry, contractValidator, triageReader,
          triageRuleRegistry, workResultReader, now }),
        createCandidateAssemblyPlanner({ registry, policyRegistry, contractValidator, triageReader,
          triageRuleRegistry, workResultReader, evidenceIndex, candidateContextReader, now })
      ]);
      const bindingProjections = Object.freeze([
        Object.freeze({ projectionRef: PROBE_BATCH_PROJECTION, projection: createProbeBatchProjection({ triageReader }) }),
        Object.freeze({ projectionRef: BDMV_ASSESS_INPUT_PROJECTION, projection: createBdmvAssessmentInputProjection({ triageReader }) }),
        Object.freeze({ projectionRef: STRUCTURE_INPUT_PROJECTION, projection: createStructureInputProjection({ triageReader }) }),
        Object.freeze({ projectionRef: IDENTITY_INPUT_PROJECTION, projection: createCandidateIdentityInputProjection({ triageReader, evidenceIndex, candidateContextReader, triageRuleRegistry }) }),
        Object.freeze({ projectionRef: MANIFEST_INPUT_PROJECTION, projection: createCandidateManifestInputProjection({ triageReader, evidenceIndex, candidateContextReader, triageRuleRegistry }) }),
        Object.freeze({ projectionRef: DRAFT_PROJECTION, projection: createCandidateDraftProjection({ triageReader, evidenceIndex, candidateContextReader, triageRuleRegistry }) }),
        Object.freeze({ projectionRef: COMMIT_HANDLE_PROJECTION, projection: createCandidateCommitHandleProjection({ triageReader, evidenceIndex, candidateContextReader, triageRuleRegistry }) })
      ]);
      return Object.freeze({ planners, bindingProjections });
    }
  });
}

module.exports = Object.freeze({
  PACKAGE_ID: packageId,
  ProcurementCommandFacade: (implementation) => bind('ProcurementCommandFacade', implementation),
  ProcurementQueryFacade: (implementation) => bind('ProcurementQueryFacade', implementation),
  CandidateDeliveryPort: (implementation) => bind('CandidateDeliveryPort', implementation),
  ProcurementExecutionRegistration: createExecutionRegistration
});
