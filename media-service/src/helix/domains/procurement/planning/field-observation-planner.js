'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { executionCatalogDigest } = require('../../../foundation/execution/workflow-plan');
const { requestBasis } = require('../model/field-observation-contracts');

const OBSERVATION_PAGE_COMMIT = 'procurement.field.observation.page.commit@1';

class FieldObservationPlannerError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'FieldObservationPlannerError'; this.code = code; this.details = details; }
}
function fail(code, message, details) { throw new FieldObservationPlannerError(code, message, details); }
function stableId(prefix, value) { return prefix + canonicalDigest(value).slice(0, 40); }
function accessHandle(field, workId, nowMs) {
  const access = field.access;
  const containmentDigest = canonicalDigest({ schema: 'procurement.field-access-containment@1', fieldId: field.fieldId,
    accessRevision: access.revision, endpointId: access.endpointId, rootLocation: access.rootLocation,
    mountScopeId: access.mountScopeId, mountScopeRevision: access.mountScopeRevision });
  return Object.freeze({ schemaRef: 'helix://contracts/types/FieldAccessHandle/v1', schemaVersion: 1,
    handleId: stableId('field-access-handle-', { workId, accessDigest: access.accessDigest, containmentDigest }),
    fieldId: field.fieldId, accessRevision: access.revision, accessDigest: access.accessDigest,
    endpointId: access.endpointId, rootLocation: access.rootLocation, mountScopeId: access.mountScopeId,
    mountScopeRevision: access.mountScopeRevision, allowedOperations: Object.freeze(['read', 'list', 'stat', 'fingerprint']),
    containmentDigest, expiresAtMs: nowMs + 3_600_000 });
}
function pageRequest(workId, progress, profileHintSnapshot, pageBudget) {
  const value = { schemaRef: 'helix://contracts/types/FieldObservationPageRequest/v1', schemaVersion: 1,
    fieldObservationWorkId: workId, observationId: stableId('field-observation-', { workId, ordinal: progress.nextPageOrdinal }),
    pageOrdinal: progress.nextPageOrdinal, expectedObservationRevision: progress.expectedObservationRevision,
    cursorIn: progress.cursorIn, pageBudget, profileHintSnapshot, requestDigest: '' };
  value.requestDigest = canonicalDigest(requestBasis(value));
  return Object.freeze(value);
}
function bindingSet(bindings) { return Object.freeze({ schemaRef: 'helix://foundation/types/EventInputBindingSet/v1', schemaVersion: 1, bindings: Object.freeze(bindings) }); }
function literal(portName, value) { return Object.freeze({ portName, bindingKind: 'literal', value }); }

function createFieldObservationPlanner(options) {
  if (!options?.registry || !options.policyRegistry || !options.progressReader || typeof options.progressReader.read !== 'function' ||
      !options.materialFieldStore || typeof options.materialFieldStore.getMaterialField !== 'function' || typeof options.now !== 'function') {
    fail('P7_FIELD_OBSERVATION_PLANNER_DEPENDENCIES', 'Field Observation Planner requires exact Catalog and Procurement read ports.');
  }
  const catalogDigest = executionCatalogDigest(options.registry, options.policyRegistry);
  const pageBudget = Math.min(256, options.pageBudget || 256);
  return Object.freeze({
    plannerContractRef: 'helix://procurement/planners/FieldObservation/v2', plannerVersion: 2,
    plan(request) {
      const field = options.materialFieldStore.getMaterialField(request.processId);
      const progress = options.progressReader.read(request.workId);
      if (!field || field.status !== 'active' || progress.completed) {
        return Object.freeze({ schemaRef: 'helix://foundation/types/WorkflowPlanDefinition/v1', schemaVersion: 1,
          planId: stableId('field-observation-plan-', { attemptId: request.workAttemptId }), workAttemptId: request.workAttemptId,
          ownerDomain: 'procurement', plannerContractRef: this.plannerContractRef, plannerVersion: this.plannerVersion,
          workObjectiveTypeRef: 'helix://procurement/work/FieldObservation/v1', workObjectiveVersion: 1,
          executionBasisDigest: request.executionBasisDigest, capabilityCatalogDigest: catalogDigest,
          resolution: progress.completed ? 'no_effect_required' : 'contract_unplannable',
          diagnosticClassification: progress.completed ? 'field_observation_already_complete' : 'field_observation_field_unavailable', nodes: Object.freeze([]) });
      }
      const handle = accessHandle(field, request.workId, options.now());
      const currentProgress = progress.expectedObservationRevision === null
        ? Object.freeze({ ...progress, expectedObservationRevision: field.currentObservationRevision || 0 }) : progress;
      const page = pageRequest(request.workId, currentProgress, field.currentProfileHintSnapshot, pageBudget);
      const manifest = options.registry.resolve(OBSERVATION_PAGE_COMMIT, 'procurement').manifest;
      const eventId = stableId('field-observation-page-commit-event-', { attemptId: request.workAttemptId, pageOrdinal: page.pageOrdinal });
      const policy = options.policyRegistry.bindingFor(OBSERVATION_PAGE_COMMIT, manifest.effectClass);
      const resourceDemand = Object.freeze({ resourceKinds: Object.freeze(['volume_read', 'sqlite_write']),
        demandDigest: canonicalDigest({ resourceKinds: Object.freeze(['volume_read', 'sqlite_write']) }) });
      const node = Object.freeze({ nodeId: 'observation-page-commit', eventId, capabilityRef: OBSERVATION_PAGE_COMMIT, contractVersion: 1,
        inputBindingsSchemaRef: manifest.parametersSchemaRef.replace(/\/parameters$/, '/inputs'),
        inputBindings: bindingSet([literal('fieldAccessHandle', handle), literal('fieldObservationPageRequest', page)]),
        parametersSchemaRef: manifest.parametersSchemaRef, parameters: Object.freeze({}), dependsOn: Object.freeze([]), whenSchemaRef: null, when: null,
        effectClass: manifest.effectClass, resourceDemandSchemaRef: manifest.resourceDemandSchemaRef, resourceDemand,
        approvalRequirementRef: null, authorizationRequirementRef: null, fenceSchemaRef: manifest.fenceSchemaRef,
        fenceBasis: Object.freeze({ basisDigest: request.executionBasisDigest,
          inputSetDigest: canonicalDigest({ fieldId: field.fieldId, workId: request.workId, pageOrdinal: page.pageOrdinal }),
          eventFenceDigest: canonicalDigest({ schema: 'procurement.field-observation-event-fence@2', eventId, fieldId: field.fieldId,
            expectedObservationRevision: currentProgress.expectedObservationRevision, pageOrdinal: page.pageOrdinal }),
          effectScopeDigest: canonicalDigest({ schema: 'procurement.field-observation-effect-scope@2', fieldId: field.fieldId,
            expectedObservationRevision: currentProgress.expectedObservationRevision }) }),
        retryPolicyRef: policy.retryPolicyRef, timeoutPolicyRef: policy.timeoutPolicyRef, outputContractRef: manifest.resultSchemaRef });
      return Object.freeze({ schemaRef: 'helix://foundation/types/WorkflowPlanDefinition/v1', schemaVersion: 1,
        planId: stableId('field-observation-plan-', { attemptId: request.workAttemptId }), workAttemptId: request.workAttemptId,
        ownerDomain: 'procurement', plannerContractRef: this.plannerContractRef, plannerVersion: this.plannerVersion,
        workObjectiveTypeRef: 'helix://procurement/work/FieldObservation/v1', workObjectiveVersion: 1,
        executionBasisDigest: request.executionBasisDigest, capabilityCatalogDigest: catalogDigest, resolution: 'planned', diagnosticClassification: null,
        nodes: Object.freeze([node]) });
    }
  });
}

module.exports = Object.freeze({ OBSERVATION_PAGE_COMMIT, FieldObservationPlannerError, createFieldObservationPlanner });
