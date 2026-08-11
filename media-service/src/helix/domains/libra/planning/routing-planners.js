'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { executionCatalogDigest } = require('../../../foundation/execution/workflow-plan');
const DECISION_BASIS_RESULT_SCHEMA = 'helix://contracts/types/DecisionBasisRevision/v1';

const FACT = 'libra.routing.fact.observe@1', BASIS = 'libra.decision_basis.commit@1';
const INTENT = 'helix://libra/input-projections/RoutingFactObservationIntent/v1';
const SOURCE = 'helix://libra/input-projections/RoutingFactSourceHandle/v1';
const INPUT_SET = 'helix://libra/input-projections/RoutingDecisionInputSet/v1';
const COMMIT_HANDLE = 'helix://libra/input-projections/RoutingDecisionBasisCommitHandle/v1';

function stable(prefix, value) { return prefix + canonicalDigest(value).slice(0, 40); }
function owner(portName, request, projectionRef, parameters = {}) { return Object.freeze({ portName, bindingKind: 'projected_owner_facts',
  ownerDomain: request.ownerDomain, processType: request.processType, processId: request.processId, projectionRef,
  parameters: Object.freeze(parameters) }); }
function bindings(values) { return Object.freeze({ schemaRef: 'helix://foundation/types/EventInputBindingSet/v1', schemaVersion: 1,
  bindings: Object.freeze(values) }); }
function demand(resourceKinds) { const value = { resourceKinds: Object.freeze(resourceKinds) };
  return Object.freeze({ ...value, demandDigest: canonicalDigest(value) }); }
function node(options, capabilityRef, nodeId, eventId, inputBindings, resourceKinds) {
  const manifest = options.registry.resolve(capabilityRef, 'libra').manifest;
  const policy = options.policyRegistry.bindingFor(capabilityRef, manifest.effectClass);
  const fence = { basisDigest: options.request.executionBasisDigest, inputSetDigest: canonicalDigest(inputBindings),
    eventFenceDigest: canonicalDigest({ schema: 'libra.routing-event-fence@1', eventId, workId: options.request.workId }),
    effectScopeDigest: canonicalDigest({ schema: 'libra.routing-event-scope@1', eventId, subjectId: options.request.processId }) };
  return Object.freeze({ nodeId, eventId, capabilityRef, contractVersion: 1,
    inputBindingsSchemaRef: manifest.parametersSchemaRef.replace(/\/parameters$/, '/inputs'), inputBindings: bindings(inputBindings),
    parametersSchemaRef: manifest.parametersSchemaRef, parameters: Object.freeze({}), dependsOn: Object.freeze([]),
    whenSchemaRef: null, when: null, effectClass: manifest.effectClass, resourceDemandSchemaRef: manifest.resourceDemandSchemaRef,
    resourceDemand: demand(resourceKinds), approvalRequirementRef: null, authorizationRequirementRef: null,
    fenceSchemaRef: manifest.fenceSchemaRef, fenceBasis: Object.freeze(fence), retryPolicyRef: policy.retryPolicyRef,
    timeoutPolicyRef: policy.timeoutPolicyRef, outputContractRef: manifest.resultSchemaRef });
}
function plan(options, kind, nodes, resolution = 'planned', diagnosticClassification = null) { const request = options.request;
  return Object.freeze({ schemaRef: 'helix://foundation/types/WorkflowPlanDefinition/v1', schemaVersion: 1,
    planId: stable('libra-routing-plan-', { attempt: request.workAttemptId }), workAttemptId: request.workAttemptId,
    ownerDomain: 'libra', plannerContractRef: options.plannerContractRef, plannerVersion: 1,
    workObjectiveTypeRef: 'helix://libra/work/' + kind + '/v1', workObjectiveVersion: 1,
    executionBasisDigest: request.executionBasisDigest, capabilityCatalogDigest: options.catalogDigest,
    resolution, diagnosticClassification, nodes: Object.freeze(nodes) }); }

function observations(options, subjectId) {
  const rows = ['routing_nfo_facts', 'routing_provider_facts'].flatMap((workKind) =>
    options.workResultReader.listWorks({ ownerDomain: 'libra', processType: 'libra_routing', processId: subjectId, workKind }));
  return rows.flatMap((row) => options.workResultReader.read(row.work_id))
    .filter((item) => item.outcomeKind === 'succeeded' && item.result?.schemaRef === 'helix://contracts/types/RoutingFactObservation/v1')
    .map((item) => item.result);
}

function createFactPlanner(options, sourceKind) {
  const catalogDigest = executionCatalogDigest(options.registry, options.policyRegistry);
  return Object.freeze({ plannerContractRef: 'helix://libra/planners/RoutingFact' + (sourceKind === 'related_nfo' ? 'Nfo' : 'Provider') + '/v1',
    plannerVersion: 1, plan(request) {
      const context = options.contextReader.read(request.processId);
      if (!context?.policy) throw new Error('Routing Fact Planner requires a current Field Policy.');
      const observed = observations(options, request.processId);
      const requestedFactKinds = options.contextReader.requiredExternalFactKinds(context).filter((kind) =>
        !observed.flatMap((item) => item.facts || []).some((fact) => fact.factKind === kind));
      if (!requestedFactKinds.length) return plan({ request, plannerContractRef: this.plannerContractRef, catalogDigest },
        'RoutingFactObservation', [], 'no_effect_required', 'routing_facts_already_satisfied');
      const eventId = stable('libra-routing-fact-event-', { workAttemptId: request.workAttemptId, sourceKind });
      const parameters = { sourceKind, policyDigest: context.policy.policyDigest, requestedFactKinds: Object.freeze(requestedFactKinds) };
      return plan({ request, plannerContractRef: this.plannerContractRef, catalogDigest }, 'RoutingFactObservation', [
        node({ ...options, request }, FACT, 'fact_observation', eventId, [
          owner('routingFactObservationIntent', request, INTENT, parameters),
          owner('physicalMaterialReadHandleOrIntegrationHandle', request, SOURCE, parameters),
        ], ['disk_io', 'network']),
      ]);
    } });
}

function createBasisPlanner(options) {
  const catalogDigest = executionCatalogDigest(options.registry, options.policyRegistry);
  return Object.freeze({ plannerContractRef: 'helix://libra/planners/RoutingDecisionBasis/v1', plannerVersion: 1, plan(request) {
    const context = options.contextReader.read(request.processId);
    if (!context?.policy) throw new Error('Routing Basis Planner requires a current Field Policy.');
    const eventId = stable('libra-routing-basis-event-', { workAttemptId: request.workAttemptId });
    const parameters = { policyDigest: context.policy.policyDigest, eventId };
    return plan({ request, plannerContractRef: this.plannerContractRef, catalogDigest }, 'RoutingDecisionBasis', [
      node({ ...options, request }, BASIS, 'decision_basis_commit', eventId, [
        owner('decisionInputSet', request, INPUT_SET, parameters),
        owner('domainFactCommitHandle', request, COMMIT_HANDLE, parameters),
      ], ['cpu']),
    ]);
  } });
}

function createRoutingProjections(options) {
  function context(ownerScope, parameters) {
    const value = options.contextReader.read(ownerScope.processId);
    if (!value?.policy || value.policy.policyDigest !== parameters.policyDigest) throw new Error('Routing Policy changed before Event projection.');
    return value;
  }
  function inputSet(ownerScope, parameters) { context(ownerScope, parameters); return options.contextReader.buildInputSet(ownerScope.processId, observations(options, ownerScope.processId)); }
  return Object.freeze([
    { projectionRef: INTENT, projection: { project: ({ ownerScope, parameters }) => {
      const value = context(ownerScope, parameters), observed = observations(options, ownerScope.processId);
      const intent = options.contextReader.factObservationIntent(value, parameters.sourceKind, parameters.requestedFactKinds, observed);
      if (!intent) throw new Error('Routing Fact source is unavailable.');
      if (parameters.sourceKind === 'provider') {
        const handle = options.resolveRoutingIntegrationHandle(intent);
        if (!handle) throw new Error('TMDB Integration is unavailable.');
        const body = { ...Object.fromEntries(Object.entries(intent).filter(([key]) => !['intentId', 'intentDigest'].includes(key))),
          integrationId: handle.integrationId, configRevision: handle.configRevision };
        const intentDigest = canonicalDigest(body);
        const intentId = canonicalDigest({ schema: 'libra.routing-fact-observation-intent-id@1',
          subjectId: body.subjectId, sourceKind: body.sourceKind, intentDigest });
        return Object.freeze({ intentId, ...body, intentDigest });
      }
      return intent;
    } } },
    { projectionRef: SOURCE, projection: { project: ({ ownerScope, parameters }) => {
      const value = context(ownerScope, parameters);
      if (parameters.sourceKind === 'related_nfo') return options.contextReader.nfoReadHandle(value);
      const observed = observations(options, ownerScope.processId);
      const intent = options.contextReader.factObservationIntent(value, 'provider', parameters.requestedFactKinds, observed);
      const handle = options.resolveRoutingIntegrationHandle(intent);
      if (!handle) throw new Error('TMDB Integration is unavailable.');
      return handle;
    } } },
    { projectionRef: INPUT_SET, projection: { project: ({ ownerScope, parameters }) => inputSet(ownerScope, parameters) } },
    { projectionRef: COMMIT_HANDLE, projection: { project: ({ ownerScope, parameters }) => {
      const set = inputSet(ownerScope, parameters), identity = { subjectId: ownerScope.processId, inputSetDigest: set.inputSetDigest };
      return Object.freeze({ schemaRef: 'helix://contracts/types/DomainFactCommitHandle/v1', schemaVersion: 1,
        handleId: stable('libra-routing-basis-handle-', identity), ownerDomain: 'libra', aggregateType: 'subject_decision_basis',
        aggregateId: ownerScope.processId, factType: 'decision_basis', factSchemaRef: 'libra.decision-basis@1',
        expectedRevision: set.expectedDecisionHead.headRevision, payloadDigest: canonicalDigest(set), resultSchemaRef: DECISION_BASIS_RESULT_SCHEMA,
        commitIdempotencyKey: stable('libra-routing-basis-key-', identity),
        eventFenceDigest: canonicalDigest({ schema: 'libra.routing-decision-basis-fence@1', ...identity, eventId: parameters.eventId }) });
    } } },
  ].map(Object.freeze));
}

module.exports = Object.freeze({ INTENT, SOURCE, INPUT_SET, COMMIT_HANDLE, createFactPlanner, createBasisPlanner, createRoutingProjections });
