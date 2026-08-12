'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const {
  executionCatalogDigest,
} = require('../../../foundation/execution/workflow-plan');
const {
  deliverablePromotionWork,
  findPassedConformance,
  findSelectedMediaWork,
  productConformanceWork,
} = require('./product-delivery-work');

const CONFORMANCE = 'libra.product.conformance.verify@1';
const PUBLISH = 'libra.product_package.publish@1';
const CONFORMANCE_INPUT =
  'helix://libra/input-projections/ProductConformanceInput/v1';
const PROMOTION_DECISION =
  'helix://libra/input-projections/DeliverablePromotionDecision/v1';
const CONTROL_HANDLE =
  'helix://libra/input-projections/DeliverablePromotionControlHandle/v1';

function stable(prefix, value) {
  return prefix + canonicalDigest(value).slice(0, 40);
}

function bindings(items) {
  return Object.freeze({
    schemaRef: 'helix://foundation/types/EventInputBindingSet/v1',
    schemaVersion: 1,
    bindings: Object.freeze(items),
  });
}

function owner(portName, request, projectionRef, parameters = {}) {
  return Object.freeze({
    portName,
    bindingKind: 'projected_owner_facts',
    ownerDomain: request.ownerDomain,
    processType: request.processType,
    processId: request.processId,
    projectionRef,
    parameters: Object.freeze(parameters),
  });
}

function node(options) {
  const manifest = options.registry.resolve(
    options.capabilityRef,
    'libra',
  ).manifest;
  const policy = options.policyRegistry.bindingFor(
    options.capabilityRef,
    manifest.effectClass,
  );
  const inputBindings = options.inputBindings;
  const resource = { resourceKinds: options.resourceKinds };
  const fence = {
    basisDigest: options.request.executionBasisDigest,
    inputSetDigest: canonicalDigest(inputBindings),
    eventFenceDigest: options.eventFenceDigest,
    effectScopeDigest: canonicalDigest({
      schema: 'libra.product-delivery-event-scope@1',
      libraRunId: options.request.processId,
      eventId: options.eventId,
      capabilityRef: options.capabilityRef,
    }),
  };
  return Object.freeze({
    nodeId: options.nodeId,
    eventId: options.eventId,
    capabilityRef: options.capabilityRef,
    contractVersion: 1,
    inputBindingsSchemaRef: manifest.parametersSchemaRef
      .replace(/\/parameters$/, '/inputs'),
    inputBindings: bindings(inputBindings),
    parametersSchemaRef: manifest.parametersSchemaRef,
    parameters: Object.freeze({}),
    dependsOn: Object.freeze([]),
    whenSchemaRef: null,
    when: null,
    effectClass: manifest.effectClass,
    resourceDemandSchemaRef: manifest.resourceDemandSchemaRef,
    resourceDemand: Object.freeze({
      ...resource,
      demandDigest: canonicalDigest(resource),
    }),
    approvalRequirementRef: null,
    authorizationRequirementRef: null,
    fenceSchemaRef: manifest.fenceSchemaRef,
    fenceBasis: Object.freeze(fence),
    retryPolicyRef: policy.retryPolicyRef,
    timeoutPolicyRef: policy.timeoutPolicyRef,
    outputContractRef: manifest.resultSchemaRef,
  });
}

function planEnvelope(options, request, work, eventNode) {
  return Object.freeze({
    schemaRef: 'helix://foundation/types/WorkflowPlanDefinition/v1',
    schemaVersion: 1,
    planId: stable('libra-' + request.workKind.replaceAll('_', '-') + '-plan-', {
      attempt: request.workAttemptId,
    }),
    workAttemptId: request.workAttemptId,
    ownerDomain: 'libra',
    plannerContractRef: options.plannerContractRef,
    plannerVersion: 1,
    workObjectiveTypeRef: work.workObjectiveTypeRef,
    workObjectiveVersion: 1,
    executionBasisDigest: request.executionBasisDigest,
    capabilityCatalogDigest: options.catalogDigest,
    resolution: 'planned',
    diagnosticClassification: null,
    nodes: Object.freeze([eventNode]),
  });
}

function exactWork(request, work) {
  if (request.workId !== work.workId ||
      request.executionBasisDigest !== work.executionBasisDigest) {
    throw new Error('Product Delivery planning basis changed.');
  }
}

function createProductDeliveryPlanner(options) {
  const catalogDigest = executionCatalogDigest(
    options.registry,
    options.policyRegistry,
  );
  const plannerContractRef = 'helix://libra/planners/ProductDelivery/v1';
  return Object.freeze({
    plannerContractRef,
    plannerVersion: 1,
    plan(request) {
      const snapshot = options.movieProductionReader.readRunSnapshot(
        request.processId,
      );
      const selected = findSelectedMediaWork(options, snapshot);
      if (request.workKind === 'product_conformance') {
        const work = productConformanceWork(snapshot, selected);
        exactWork(request, work);
        const eventId = stable('libra-product-conformance-event-', {
          attempt: request.workAttemptId,
        });
        const eventFenceDigest = canonicalDigest({
          schema: 'libra.product-delivery-event-fence@1',
          eventId,
          workId: request.workId,
        });
        const eventNode = node({
          ...options,
          request,
          nodeId: 'product_conformance',
          eventId,
          eventFenceDigest,
          capabilityRef: CONFORMANCE,
          inputBindings: [owner(
            'productConformanceInputSnapshot',
            request,
            CONFORMANCE_INPUT,
            { selectedMediaWorkId: selected.workId },
          )],
          resourceKinds: ['cpu'],
        });
        return planEnvelope(
          { plannerContractRef, catalogDigest },
          request,
          work,
          eventNode,
        );
      }
      if (request.workKind === 'deliverable_promotion') {
        const passed = findPassedConformance(options, snapshot, selected);
        const work = deliverablePromotionWork(
          snapshot,
          selected,
          passed.work,
          passed.evidence,
        );
        exactWork(request, work);
        const eventId = stable('libra-deliverable-promotion-event-', {
          attempt: request.workAttemptId,
        });
        const eventFenceDigest = canonicalDigest({
          schema: 'libra.product-delivery-event-fence@1',
          eventId,
          workId: request.workId,
        });
        const parameters = {
          selectedMediaWorkId: selected.workId,
          conformanceWorkId: passed.work.workId,
          eventFenceDigest,
        };
        const eventNode = node({
          ...options,
          request,
          nodeId: 'deliverable_promotion',
          eventId,
          eventFenceDigest,
          capabilityRef: PUBLISH,
          inputBindings: [
            owner(
              'libraDeliverablePromotionDecision',
              request,
              PROMOTION_DECISION,
              parameters,
            ),
            owner(
              'responsibilityControlCommitHandle',
              request,
              CONTROL_HANDLE,
              parameters,
            ),
          ],
          resourceKinds: ['sqlite_write'],
        });
        return planEnvelope(
          { plannerContractRef, catalogDigest },
          request,
          work,
          eventNode,
        );
      }
      throw new Error('Product Delivery Work kind is not supported.');
    },
  });
}

function createProductDeliveryProjections(options) {
  function values(ownerScope, parameters) {
    const snapshot = options.movieProductionReader.readRunSnapshot(
      ownerScope.processId,
    );
    const selected = findSelectedMediaWork(options, snapshot);
    if (selected.workId !== parameters.selectedMediaWorkId) {
      throw new Error('Product Delivery selected media Work changed.');
    }
    const passed = findPassedConformance(options, snapshot, selected);
    if (passed.work.workId !== parameters.conformanceWorkId) {
      throw new Error('Product Delivery Conformance Work changed.');
    }
    return options.productDeliveryAssembler.promotion(
      ownerScope.processId,
      selected.workId,
      passed.evidence,
      parameters.eventFenceDigest,
    );
  }
  return Object.freeze([
    Object.freeze({
      projectionRef: CONFORMANCE_INPUT,
      projection: Object.freeze({
        project({ ownerScope, parameters }) {
          return options.productDeliveryAssembler.conformanceInput(
            ownerScope.processId,
            parameters.selectedMediaWorkId,
          );
        },
      }),
    }),
    Object.freeze({
      projectionRef: PROMOTION_DECISION,
      projection: Object.freeze({
        project({ ownerScope, parameters }) {
          return values(ownerScope, parameters).decision;
        },
      }),
    }),
    Object.freeze({
      projectionRef: CONTROL_HANDLE,
      projection: Object.freeze({
        project({ ownerScope, parameters }) {
          return values(ownerScope, parameters)
            .responsibilityControlCommitHandle;
        },
      }),
    }),
  ]);
}

module.exports = Object.freeze({
  CONFORMANCE_INPUT,
  CONTROL_HANDLE,
  PROMOTION_DECISION,
  createProductDeliveryPlanner,
  createProductDeliveryProjections,
});
