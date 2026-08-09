'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { executionCatalogDigest } = require('../../../foundation/execution/workflow-plan');
const { FACT_SCHEMA, RESULT_SCHEMA, requestBasis } = require('../model/field-observation-contracts');

const OBSERVE = 'procurement.field.page.observe@1';
const COMMIT = 'procurement.field.observation.commit@1';
const PROJECTION_REF = 'helix://procurement/input-projections/FieldObservationCommitHandle/v1';

class FieldObservationPlannerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FieldObservationPlannerError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new FieldObservationPlannerError(code, message, details);
}

function stableId(prefix, value) {
  return prefix + canonicalDigest(value).slice(0, 40);
}

function accessHandle(field, workId, nowMs) {
  const access = field.access;
  const containmentDigest = canonicalDigest({ schema: 'procurement.field-access-containment@1', fieldId: field.fieldId,
    accessRevision: access.revision, endpointId: access.endpointId, rootLocation: access.rootLocation,
    mountScopeId: access.mountScopeId, mountScopeRevision: access.mountScopeRevision });
  return Object.freeze({
    schemaRef: 'helix://contracts/types/FieldAccessHandle/v1', schemaVersion: 1,
    handleId: stableId('field-access-handle-', { workId, accessDigest: access.accessDigest, containmentDigest }),
    fieldId: field.fieldId, accessRevision: access.revision, accessDigest: access.accessDigest,
    endpointId: access.endpointId, rootLocation: access.rootLocation, mountScopeId: access.mountScopeId,
    mountScopeRevision: access.mountScopeRevision, allowedOperations: Object.freeze(['read', 'list', 'stat', 'fingerprint']),
    containmentDigest, expiresAtMs: nowMs + 3_600_000,
  });
}

function pageRequest(workId, progress, profileHintSnapshot, pageBudget) {
  const value = {
    schemaRef: 'helix://contracts/types/FieldObservationPageRequest/v1', schemaVersion: 1,
    fieldObservationWorkId: workId,
    observationId: stableId('field-observation-', { workId, ordinal: progress.nextPageOrdinal }),
    pageOrdinal: progress.nextPageOrdinal, expectedObservationRevision: progress.expectedObservationRevision,
    cursorIn: progress.cursorIn, pageBudget, profileHintSnapshot, requestDigest: '',
  };
  value.requestDigest = canonicalDigest(requestBasis(value));
  return Object.freeze(value);
}

function literal(portName, value) { return Object.freeze({ portName, bindingKind: 'literal', value }); }
function result(portName, eventId, resultSchemaRef) {
  return Object.freeze({ portName, bindingKind: 'event_result', eventId, resultSchemaRef });
}

function bindingSet(bindings) {
  return Object.freeze({ schemaRef: 'helix://foundation/types/EventInputBindingSet/v1', schemaVersion: 1,
    bindings: Object.freeze(bindings) });
}

function createFieldObservationPlanner(options) {
  if (!options?.registry || !options.policyRegistry || !options.contractValidator ||
      !options.progressReader || typeof options.progressReader.read !== 'function' ||
      !options.materialFieldStore || typeof options.materialFieldStore.getMaterialField !== 'function' ||
      typeof options.now !== 'function') {
    fail('P7_FIELD_OBSERVATION_PLANNER_DEPENDENCIES', 'Field Observation Planner requires exact Catalog and Procurement read ports.');
  }
  const catalogDigest = executionCatalogDigest(options.registry, options.policyRegistry);
  const pageBudget = options.pageBudget || 100;
  return Object.freeze({
    plannerContractRef: 'helix://procurement/planners/FieldObservation/v1',
    plannerVersion: 1,
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
          diagnosticClassification: progress.completed ? 'field_observation_already_complete' : 'field_observation_field_unavailable',
          nodes: Object.freeze([]) });
      }
      const handle = accessHandle(field, request.workId, options.now());
      const currentProgress = progress.expectedObservationRevision === null
        ? Object.freeze({ ...progress, expectedObservationRevision: field.currentObservationRevision || 0 }) : progress;
      const page = pageRequest(request.workId, currentProgress, field.currentProfileHintSnapshot, pageBudget);
      const observeManifest = options.registry.resolve(OBSERVE, 'procurement').manifest;
      const commitManifest = options.registry.resolve(COMMIT, 'procurement').manifest;
      const observeEventId = stableId('field-observation-observe-event-', { attemptId: request.workAttemptId });
      const commitEventId = stableId('field-observation-commit-event-', { attemptId: request.workAttemptId });
      const observePolicy = options.policyRegistry.bindingFor(OBSERVE, observeManifest.effectClass);
      const commitPolicy = options.policyRegistry.bindingFor(COMMIT, commitManifest.effectClass);
      const observeDemand = Object.freeze({ resourceKinds: Object.freeze(['network']),
        demandDigest: canonicalDigest({ resourceKinds: Object.freeze(['network']) }) });
      const commitDemand = Object.freeze({ resourceKinds: Object.freeze(['cpu']),
        demandDigest: canonicalDigest({ resourceKinds: Object.freeze(['cpu']) }) });
      const commonFence = (eventId, pageDigest = null) => Object.freeze({ basisDigest: request.executionBasisDigest,
        inputSetDigest: canonicalDigest({ fieldId: field.fieldId, workId: request.workId, pageOrdinal: progress.nextPageOrdinal }),
        eventFenceDigest: canonicalDigest({ schema: 'procurement.field-observation-event-fence@1', eventId,
          fieldId: field.fieldId, expectedObservationRevision: currentProgress.expectedObservationRevision, pageDigest }),
        effectScopeDigest: canonicalDigest({ schema: 'procurement.field-observation-effect-scope@1', fieldId: field.fieldId,
          expectedObservationRevision: currentProgress.expectedObservationRevision }) });
      const observeNode = Object.freeze({
        nodeId: 'observe-page', eventId: observeEventId, capabilityRef: OBSERVE, contractVersion: 1,
        inputBindingsSchemaRef: observeManifest.parametersSchemaRef.replace(/\/parameters$/, '/inputs'),
        inputBindings: bindingSet([literal('fieldAccessHandle', handle), literal('fieldObservationPageRequest', page)]),
        parametersSchemaRef: observeManifest.parametersSchemaRef, parameters: Object.freeze({}), dependsOn: Object.freeze([]),
        whenSchemaRef: null, when: null, effectClass: observeManifest.effectClass,
        resourceDemandSchemaRef: observeManifest.resourceDemandSchemaRef, resourceDemand: observeDemand,
        approvalRequirementRef: null, authorizationRequirementRef: null, fenceSchemaRef: observeManifest.fenceSchemaRef,
        fenceBasis: commonFence(observeEventId), retryPolicyRef: observePolicy.retryPolicyRef,
        timeoutPolicyRef: observePolicy.timeoutPolicyRef, outputContractRef: observeManifest.resultSchemaRef,
      });
      const commitNode = Object.freeze({
        nodeId: 'commit-page', eventId: commitEventId, capabilityRef: COMMIT, contractVersion: 1,
        inputBindingsSchemaRef: commitManifest.parametersSchemaRef.replace(/\/parameters$/, '/inputs'),
        inputBindings: bindingSet([
          result('fieldObservationPage', observeEventId, observeManifest.resultSchemaRef),
          Object.freeze({ portName: 'domainFactCommitHandle', bindingKind: 'projected_event_result', eventId: observeEventId,
            resultSchemaRef: observeManifest.resultSchemaRef, projectionRef: PROJECTION_REF,
            parameters: Object.freeze({ workId: request.workId, targetEventId: commitEventId,
              idempotencyKey: request.idempotencyKey }) }),
        ]),
        parametersSchemaRef: commitManifest.parametersSchemaRef, parameters: Object.freeze({}),
        dependsOn: Object.freeze([{ eventId: observeEventId, satisfaction: 'success' }]), whenSchemaRef: null, when: null,
        effectClass: commitManifest.effectClass, resourceDemandSchemaRef: commitManifest.resourceDemandSchemaRef,
        resourceDemand: commitDemand, approvalRequirementRef: null, authorizationRequirementRef: null,
        fenceSchemaRef: commitManifest.fenceSchemaRef, fenceBasis: commonFence(commitEventId),
        retryPolicyRef: commitPolicy.retryPolicyRef, timeoutPolicyRef: commitPolicy.timeoutPolicyRef,
        outputContractRef: commitManifest.resultSchemaRef,
      });
      return Object.freeze({ schemaRef: 'helix://foundation/types/WorkflowPlanDefinition/v1', schemaVersion: 1,
        planId: stableId('field-observation-plan-', { attemptId: request.workAttemptId }), workAttemptId: request.workAttemptId,
        ownerDomain: 'procurement', plannerContractRef: this.plannerContractRef, plannerVersion: this.plannerVersion,
        workObjectiveTypeRef: 'helix://procurement/work/FieldObservation/v1', workObjectiveVersion: 1,
        executionBasisDigest: request.executionBasisDigest, capabilityCatalogDigest: catalogDigest, resolution: 'planned',
        diagnosticClassification: null, nodes: Object.freeze([observeNode, commitNode]) });
    },
  });
}

function createFieldObservationCommitHandleProjection() {
  return Object.freeze({
    project({ sourceResult: page, parameters }) {
      return Object.freeze({
        schemaRef: 'helix://contracts/types/DomainFactCommitHandle/v1', schemaVersion: 1,
        handleId: stableId('field-observation-handle-', { eventId: parameters.targetEventId, pageDigest: page.pageDigest }),
        ownerDomain: 'procurement', aggregateType: 'material_field_observation', aggregateId: page.fieldId,
        factType: 'FieldObservationPage', factSchemaRef: FACT_SCHEMA, resultSchemaRef: RESULT_SCHEMA,
        expectedRevision: page.expectedObservationRevision, payloadDigest: canonicalDigest(page),
        commitIdempotencyKey: parameters.idempotencyKey + ':page:' + page.pageOrdinal,
        eventFenceDigest: canonicalDigest({ schema: 'procurement.field-observation-event-fence@1',
          eventId: parameters.targetEventId, fieldId: page.fieldId,
          expectedObservationRevision: page.expectedObservationRevision, pageDigest: page.pageDigest }),
      });
    },
  });
}

module.exports = Object.freeze({ COMMIT, OBSERVE, PROJECTION_REF, FieldObservationPlannerError,
  createFieldObservationCommitHandleProjection, createFieldObservationPlanner });
