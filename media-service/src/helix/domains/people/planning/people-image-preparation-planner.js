'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { executionCatalogDigest } = require('../../../foundation/execution/workflow-plan');

const IMPORT = 'people.reference_asset.import@1', EMBED = 'shared.face.embedding.compute@1';
const PROJECTIONS = Object.freeze({ selectedImage: 'helix://people/input-projections/SelectedImage/v1',
  workspace: 'helix://people/input-projections/ImageWorkspace/v1', model: 'helix://people/input-projections/ReferenceFaceModel/v1',
  artifacts: 'helix://people/input-projections/ImportedReferenceImageList/v1' });
const PLANNER = 'helix://people/planners/ImagePreparation/v1';
const stable = (prefix, value) => prefix + canonicalDigest(value).slice(0, 40);
function owner(portName, request, projectionRef) {
  return { portName, bindingKind: 'projected_owner_facts', ownerDomain: 'people', processType: request.processType,
    processId: request.processId, projectionRef, parameters: {} };
}
function createPeopleImagePreparationPlanner(options) {
  const catalogDigest = executionCatalogDigest(options.registry, options.policyRegistry);
  function node(request, capabilityRef, eventId, nodeId, inputBindings, dependencies) {
    const manifest = options.registry.resolve(capabilityRef, 'people').manifest, policy = options.policyRegistry.bindingFor(capabilityRef, manifest.effectClass);
    const resources = { resourceKinds: capabilityRef === IMPORT ? ['disk_io'] : ['compute_device', 'cpu', 'disk_io'] };
    return Object.freeze({ nodeId, eventId, capabilityRef, contractVersion: 1,
      inputBindingsSchemaRef: manifest.parametersSchemaRef.replace('/parameters', '/inputs'),
      inputBindings: { schemaRef: 'helix://foundation/types/EventInputBindingSet/v1', schemaVersion: 1, bindings: inputBindings },
      parametersSchemaRef: manifest.parametersSchemaRef, parameters: {}, dependsOn: dependencies, whenSchemaRef: null, when: null,
      effectClass: manifest.effectClass, resourceDemandSchemaRef: manifest.resourceDemandSchemaRef,
      resourceDemand: { ...resources, demandDigest: canonicalDigest(resources) }, approvalRequirementRef: null, authorizationRequirementRef: null,
      fenceSchemaRef: manifest.fenceSchemaRef, fenceBasis: { basisDigest: request.executionBasisDigest, inputSetDigest: canonicalDigest(inputBindings),
        eventFenceDigest: canonicalDigest({ schema: 'people.image-event-fence@1', eventId, workId: request.workId }),
        effectScopeDigest: canonicalDigest({ schema: 'people.image-effect-scope@1', operationId: request.processId, eventId }) },
      retryPolicyRef: policy.retryPolicyRef, timeoutPolicyRef: policy.timeoutPolicyRef, outputContractRef: manifest.resultSchemaRef });
  }
  return Object.freeze({ plannerContractRef: PLANNER, plannerVersion: 1,
    plan(request) {
      const value = options.context(request.processId).operation;
      if (value.payloadDigest !== request.executionBasisDigest) throw Object.assign(new Error('People image operation basis changed.'), { code: 'PEOPLE_IMAGE_OPERATION_STALE' });
      const importEvent = stable('people-image-import-', request.workAttemptId), embedEvent = stable('people-image-embedding-', request.workAttemptId);
      return Object.freeze({ schemaRef: 'helix://foundation/types/WorkflowPlanDefinition/v1', schemaVersion: 1,
        planId: stable('people-image-plan-', request.workAttemptId), workAttemptId: request.workAttemptId, ownerDomain: 'people',
        plannerContractRef: PLANNER, plannerVersion: 1, workObjectiveTypeRef: request.workObjectiveTypeRef, workObjectiveVersion: 1,
        executionBasisDigest: request.executionBasisDigest, capabilityCatalogDigest: catalogDigest, resolution: 'planned', diagnosticClassification: null,
        nodes: [node(request, IMPORT, importEvent, 'import', [owner('peopleSelectedImageHandle', request, PROJECTIONS.selectedImage), owner('peopleWorkspace', request, PROJECTIONS.workspace)], []),
          node(request, EMBED, embedEvent, 'embedding', [{ portName: 'artifactHandleList', bindingKind: 'projected_event_result', eventId: importEvent,
            resultSchemaRef: options.registry.resolve(IMPORT, 'people').manifest.resultSchemaRef, projectionRef: PROJECTIONS.artifacts, parameters: {} },
          owner('faceModelRef', request, PROJECTIONS.model)], [{ eventId: importEvent, satisfaction: 'success' }])] });
    } });
}
function createPeopleImageProjections(options) {
  function operation(ownerScope) {
    if (ownerScope.ownerDomain !== 'people' || ownerScope.processType !== 'people_image_preparation') throw new TypeError('People image projection requires its exact Owner process.');
    return options.context(ownerScope.processId);
  }
  return Object.freeze([
    { projectionRef: PROJECTIONS.selectedImage, projection: { project: ({ ownerScope }) => operation(ownerScope).operation.payload.selectedImage } },
    { projectionRef: PROJECTIONS.workspace, projection: { project: ({ ownerScope }) => operation(ownerScope).peopleWorkspace } },
    { projectionRef: PROJECTIONS.model, projection: { project: ({ ownerScope }) => operation(ownerScope).operation.payload.faceModelRef } },
    { projectionRef: PROJECTIONS.artifacts, projection: { project: ({ sourceResult }) => [sourceResult] } },
  ]);
}

module.exports = Object.freeze({ createPeopleImagePreparationPlanner, createPeopleImageProjections });
