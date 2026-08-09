'use strict';

const { digest } = require('../persistence/ddl-compiler');
const { createRepositoryDefinition } = require('../persistence/owner-repository');
const { assertEffectClass, assertPlanResolution } = require('./runtime-contracts');

const PLAN_SCHEMA = 'helix://foundation/types/WorkflowPlanDefinition/v1';
const SHA256 = /^[0-9a-f]{64}$/;

class WorkflowPlanError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WorkflowPlanError';
    this.code = code;
    this.details = details;
  }
}

class PlanReplay extends Error {
  constructor(result) { super('Workflow Plan replay'); this.result = result; }
}

function fail(code, message, details) { throw new WorkflowPlanError(code, message, details); }

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonical(value[key]); return result;
  }, {});
  return value;
}

function canonicalJson(value) { return JSON.stringify(canonical(value)); }

function executionCatalogDigest(registry, policyRegistry) {
  if (!registry || !Array.isArray(registry.snapshot) || !policyRegistry || !SHA256.test(policyRegistry.digest || '')) fail(
    'P4_PLAN_CATALOG_SNAPSHOT_REQUIRED', 'Plan requires exact Capability and execution policy snapshots.'
  );
  return digest(canonicalJson({ capabilities: registry.snapshot, executionPolicyDigest: policyRegistry.digest }));
}

function exactObject(value, required, optional, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code, 'A closed object is required.');
  const keys = Object.keys(value);
  const unknown = keys.filter((key) => !required.includes(key) && !optional.includes(key));
  const missing = required.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (unknown.length || missing.length) fail(code, 'Object shape does not match the nominal contract.', { unknown, missing });
}

function requiredText(value, field) {
  if (typeof value !== 'string' || value.length === 0) fail('P4_PLAN_FIELD_REQUIRED', 'Workflow Plan text field is required.', { field });
  return value;
}

function inputSchemaRef(manifest) { return manifest.parametersSchemaRef.replace(/\/parameters$/, '/inputs'); }

function isBindingSet(value) {
  return value?.schemaRef === 'helix://foundation/types/EventInputBindingSet/v1' && value.schemaVersion === 1;
}

function validateBindingSets(nodes, registry, contractValidator, ownerDomain) {
  const byEvent = new Map(nodes.map((node) => [node.eventId, node]));
  for (const node of nodes) {
    if (!isBindingSet(node.inputBindings)) continue;
    const value = node.inputBindings;
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(['bindings', 'schemaRef', 'schemaVersion']) ||
        !Array.isArray(value.bindings)) fail('P4_PLAN_INPUT_BINDING_SET_INVALID', 'Event Input Binding Set shape is invalid.');
    const targetManifest = registry.resolve(node.capabilityRef, ownerDomain).manifest;
    const expectedPorts = Object.keys(targetManifest.inputPorts || {}).sort();
    const actualPorts = value.bindings.map((binding) => binding?.portName).sort();
    if (JSON.stringify(actualPorts) !== JSON.stringify(expectedPorts)) {
      fail('P4_PLAN_INPUT_BINDING_PORT_SET_MISMATCH', 'Input bindings must cover the exact Capability input port set.', { eventId: node.eventId });
    }
    const seen = new Set();
    for (const binding of value.bindings) {
      if (!binding || typeof binding !== 'object' || Array.isArray(binding) || typeof binding.portName !== 'string' ||
          seen.has(binding.portName) || !['literal', 'event_result', 'projected_event_result', 'projected_event_results', 'projected_work_results', 'projected_owner_facts'].includes(binding.bindingKind)) {
        fail('P4_PLAN_INPUT_BINDING_INVALID', 'Input binding is invalid or duplicated.', { eventId: node.eventId });
      }
      seen.add(binding.portName);
      if (binding.bindingKind === 'literal') {
        if (JSON.stringify(Object.keys(binding).sort()) !== JSON.stringify(['bindingKind', 'portName', 'value'])) {
          fail('P4_PLAN_LITERAL_BINDING_INVALID', 'Literal binding shape is invalid.');
        }
      } else if (binding.bindingKind === 'projected_owner_facts') {
        const expectedKeys = ['bindingKind', 'ownerDomain', 'parameters', 'portName', 'processId', 'processType', 'projectionRef'];
        if (JSON.stringify(Object.keys(binding).sort()) !== JSON.stringify(expectedKeys.sort()) ||
            typeof binding.ownerDomain !== 'string' || !binding.ownerDomain || typeof binding.processType !== 'string' || !binding.processType ||
            typeof binding.processId !== 'string' || !binding.processId || typeof binding.projectionRef !== 'string' || !binding.projectionRef ||
            !binding.parameters || typeof binding.parameters !== 'object' || Array.isArray(binding.parameters)) {
          fail('P4_PLAN_OWNER_FACT_PROJECTION_INVALID', 'Projected Owner Facts binding requires an exact process scope and versioned projection.');
        }
      } else if (binding.bindingKind === 'projected_work_results') {
        const expectedKeys = ['bindingKind', 'parameters', 'portName', 'projectionRef', 'resultSchemaRefs', 'sourceWorkId'];
        if (JSON.stringify(Object.keys(binding).sort()) !== JSON.stringify(expectedKeys.sort()) ||
            typeof binding.sourceWorkId !== 'string' || !binding.sourceWorkId ||
            !Array.isArray(binding.resultSchemaRefs) || binding.resultSchemaRefs.length === 0 ||
            new Set(binding.resultSchemaRefs).size !== binding.resultSchemaRefs.length ||
            binding.resultSchemaRefs.some((item) => typeof item !== 'string' || !item) ||
            typeof binding.projectionRef !== 'string' || !binding.projectionRef || !binding.parameters ||
            typeof binding.parameters !== 'object' || Array.isArray(binding.parameters)) {
          fail('P4_PLAN_WORK_RESULT_SET_PROJECTION_INVALID', 'Projected Work Results binding requires one exact Work and typed Result contracts.');
        }
      } else if (binding.bindingKind === 'projected_event_results') {
        const expectedKeys = ['bindingKind', 'eventResults', 'parameters', 'portName', 'projectionRef'];
        if (JSON.stringify(Object.keys(binding).sort()) !== JSON.stringify(expectedKeys.sort()) ||
            !Array.isArray(binding.eventResults) || binding.eventResults.length === 0 ||
            typeof binding.projectionRef !== 'string' || !binding.projectionRef || !binding.parameters ||
            typeof binding.parameters !== 'object' || Array.isArray(binding.parameters)) {
          fail('P4_PLAN_RESULT_SET_PROJECTION_INVALID', 'Projected Event Results binding requires ordered typed sources and a versioned projection.');
        }
        const sourceIds = new Set();
        for (const resultRef of binding.eventResults) {
          if (!resultRef || typeof resultRef !== 'object' || Array.isArray(resultRef) ||
              JSON.stringify(Object.keys(resultRef).sort()) !== JSON.stringify(['eventId', 'resultSchemaRef']) ||
              typeof resultRef.eventId !== 'string' || !resultRef.eventId || sourceIds.has(resultRef.eventId) ||
              typeof resultRef.resultSchemaRef !== 'string' || !resultRef.resultSchemaRef) {
            fail('P4_PLAN_RESULT_SET_SOURCE_INVALID', 'Projected Event Results sources must be unique exact Event Result references.');
          }
          sourceIds.add(resultRef.eventId);
          const source = byEvent.get(resultRef.eventId);
          if (!source || !node.dependsOn.some((dependency) => dependency.eventId === resultRef.eventId && dependency.satisfaction === 'success')) {
            fail('P4_PLAN_RESULT_BINDING_DEPENDENCY_REQUIRED', 'Event Result binding requires a success dependency on every source Event.');
          }
          const sourceManifest = registry.resolve(source.capabilityRef, ownerDomain).manifest;
          if (resultRef.resultSchemaRef !== sourceManifest.resultSchemaRef) {
            fail('P4_PLAN_RESULT_BINDING_CONTRACT_MISMATCH', 'Event Result binding schema does not match the source Output Contract.');
          }
        }
      } else {
        const expectedKeys = binding.bindingKind === 'event_result'
          ? ['bindingKind', 'eventId', 'portName', 'resultSchemaRef']
          : ['bindingKind', 'eventId', 'parameters', 'portName', 'projectionRef', 'resultSchemaRef'];
        if (JSON.stringify(Object.keys(binding).sort()) !== JSON.stringify(expectedKeys.sort()) ||
            typeof binding.eventId !== 'string' || !binding.eventId || typeof binding.resultSchemaRef !== 'string' || !binding.resultSchemaRef) {
          fail('P4_PLAN_RESULT_BINDING_INVALID', 'Event Result binding shape is invalid.');
        }
        if (binding.bindingKind === 'projected_event_result' &&
            (typeof binding.projectionRef !== 'string' || !binding.projectionRef || !binding.parameters ||
             typeof binding.parameters !== 'object' || Array.isArray(binding.parameters))) {
          fail('P4_PLAN_RESULT_PROJECTION_INVALID', 'Projected Event Result binding requires a versioned projection and frozen parameters.');
        }
        const source = byEvent.get(binding.eventId);
        if (!source || !node.dependsOn.some((dependency) => dependency.eventId === binding.eventId && dependency.satisfaction === 'success')) {
          fail('P4_PLAN_RESULT_BINDING_DEPENDENCY_REQUIRED', 'Event Result binding requires a success dependency on its source Event.');
        }
        const sourceManifest = registry.resolve(source.capabilityRef, ownerDomain).manifest;
        if (binding.resultSchemaRef !== sourceManifest.resultSchemaRef) {
          fail('P4_PLAN_RESULT_BINDING_CONTRACT_MISMATCH', 'Event Result binding schema does not match the source Output Contract.');
        }
      }
    }
    if (expectedPorts.length === 0) contractValidator.validate(inputSchemaRef(targetManifest), {});
  }
}

function validateNode(node, plan, registry, contractValidator) {
  const required = [
    'nodeId', 'eventId', 'capabilityRef', 'contractVersion', 'inputBindingsSchemaRef', 'inputBindings',
    'parametersSchemaRef', 'parameters', 'dependsOn', 'whenSchemaRef', 'when', 'effectClass',
    'resourceDemandSchemaRef', 'resourceDemand', 'approvalRequirementRef', 'authorizationRequirementRef',
    'fenceSchemaRef', 'fenceBasis', 'retryPolicyRef', 'timeoutPolicyRef', 'outputContractRef'
  ];
  const optional = ['compensationForEventId', 'compensationContractRef'];
  exactObject(node, required, optional, 'P4_PLAN_NODE_SHAPE_MISMATCH');
  for (const field of ['nodeId', 'eventId', 'capabilityRef', 'inputBindingsSchemaRef', 'parametersSchemaRef', 'effectClass',
    'resourceDemandSchemaRef', 'fenceSchemaRef', 'retryPolicyRef', 'timeoutPolicyRef', 'outputContractRef']) requiredText(node[field], field);
  if (node.contractVersion !== 1 || !Array.isArray(node.dependsOn)) fail('P4_PLAN_NODE_FIELD_INVALID', 'Node version and dependencies are invalid.');
  const entry = registry.resolve(node.capabilityRef, plan.ownerDomain);
  const manifest = entry.manifest;
  const policyBinding = plan.policyRegistry.bindingFor(node.capabilityRef, node.effectClass);
  if (node.contractVersion !== manifest.contractVersion || node.effectClass !== manifest.effectClass ||
      node.inputBindingsSchemaRef !== inputSchemaRef(manifest) || node.parametersSchemaRef !== manifest.parametersSchemaRef ||
      node.resourceDemandSchemaRef !== manifest.resourceDemandSchemaRef || node.fenceSchemaRef !== manifest.fenceSchemaRef ||
      node.outputContractRef !== manifest.resultSchemaRef ||
      node.approvalRequirementRef !== (manifest.approvalRequirementRef || null) ||
      node.authorizationRequirementRef !== (manifest.authorizationRequirementRef || null) ||
      node.retryPolicyRef !== policyBinding.retryPolicyRef || node.timeoutPolicyRef !== policyBinding.timeoutPolicyRef) {
    fail('P4_PLAN_CAPABILITY_CONTRACT_MISMATCH', 'Plan node does not preserve the exact frozen Capability contract.', { nodeId: node.nodeId });
  }
  assertEffectClass(node.effectClass);
  if (!isBindingSet(node.inputBindings)) contractValidator.validate(node.inputBindingsSchemaRef, node.inputBindings);
  contractValidator.validate(node.parametersSchemaRef, node.parameters);
  contractValidator.validate(node.resourceDemandSchemaRef, node.resourceDemand);
  contractValidator.validate(node.fenceSchemaRef, node.fenceBasis);
  if ((node.whenSchemaRef === null) !== (node.when === null)) fail('P4_PLAN_WHEN_PAIR_MISMATCH', 'when schema and value must both be null or present.');
  if (node.whenSchemaRef !== null) {
    requiredText(node.whenSchemaRef, 'whenSchemaRef');
    contractValidator.validate(node.whenSchemaRef, node.when);
  }
  for (const dependency of node.dependsOn) {
    exactObject(dependency, ['eventId', 'satisfaction'], [], 'P4_PLAN_DEPENDENCY_SHAPE_MISMATCH');
    requiredText(dependency.eventId, 'dependsOn.eventId');
    if (!['success', 'terminal'].includes(dependency.satisfaction)) fail('P4_PLAN_DEPENDENCY_KIND_INVALID', 'Dependency satisfaction is invalid.');
  }
  const hasCompensationTarget = Object.prototype.hasOwnProperty.call(node, 'compensationForEventId');
  const hasCompensationContract = Object.prototype.hasOwnProperty.call(node, 'compensationContractRef');
  if (hasCompensationTarget !== hasCompensationContract ||
      (hasCompensationTarget && (!requiredText(node.compensationForEventId, 'compensationForEventId') ||
        !requiredText(node.compensationContractRef, 'compensationContractRef')))) {
    fail('P4_PLAN_COMPENSATION_PAIR_MISMATCH', 'Compensation target and contract must be declared together.');
  }
  const terminalDependencies = node.dependsOn.filter((dependency) => dependency.satisfaction === 'terminal');
  if (terminalDependencies.length > 0 && (!hasCompensationTarget || terminalDependencies.length !== 1 ||
      terminalDependencies[0].eventId !== node.compensationForEventId)) {
    fail('P4_PLAN_TERMINAL_DEPENDENCY_UNDECLARED', 'A terminal dependency requires one explicit matching compensation declaration.');
  }
  if (hasCompensationTarget && terminalDependencies.length !== 1) fail(
    'P4_PLAN_COMPENSATION_DEPENDENCY_REQUIRED', 'Compensation must have one terminal dependency on its declared target.'
  );
  return Object.freeze({ ...node, dependsOn: Object.freeze(node.dependsOn.map((dependency) => Object.freeze({ ...dependency }))) });
}

function assertDag(nodes) {
  const byEvent = new Map(nodes.map((node) => [node.eventId, node]));
  if (byEvent.size !== nodes.length || new Set(nodes.map((node) => node.nodeId)).size !== nodes.length) {
    fail('P4_PLAN_DUPLICATE_NODE_OR_EVENT', 'Plan node and Event identities must be unique.');
  }
  const indegree = new Map(nodes.map((node) => [node.eventId, 0]));
  const outgoing = new Map(nodes.map((node) => [node.eventId, []]));
  for (const node of nodes) {
    const dependencies = new Set();
    for (const dependency of node.dependsOn) {
      if (!byEvent.has(dependency.eventId) || dependency.eventId === node.eventId || dependencies.has(dependency.eventId)) {
        fail('P4_PLAN_DEPENDENCY_INVALID', 'Dependency must exist, differ from target, and be unique.', { eventId: node.eventId });
      }
      dependencies.add(dependency.eventId);
      indegree.set(node.eventId, indegree.get(node.eventId) + 1);
      outgoing.get(dependency.eventId).push(node.eventId);
    }
    if (node.compensationForEventId !== undefined && (!byEvent.has(node.compensationForEventId) || node.compensationForEventId === node.eventId)) {
      fail('P4_PLAN_COMPENSATION_TARGET_INVALID', 'Compensation target must be another Event in the same Plan.');
    }
  }
  const ready = [...indegree].filter(([, count]) => count === 0).map(([eventId]) => eventId);
  let visited = 0;
  while (ready.length) {
    const eventId = ready.shift();
    visited += 1;
    for (const target of outgoing.get(eventId)) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) ready.push(target);
    }
  }
  if (visited !== nodes.length) fail('P4_PLAN_DAG_CYCLE', 'Workflow Plan graph must be acyclic.');
}

function validateCompensations(nodes, policyRegistry) {
  const byEvent = new Map(nodes.map((node) => [node.eventId, node]));
  for (const node of nodes) {
    if (node.compensationForEventId === undefined) continue;
    const target = byEvent.get(node.compensationForEventId);
    const targetBinding = policyRegistry.bindingFor(target.capabilityRef, target.effectClass);
    const contract = policyRegistry.compensation(node.compensationContractRef);
    if (!targetBinding.compensationContractRefs.includes(contract.ref) ||
        !contract.targetEffectClasses.includes(target.effectClass) ||
        !contract.compensationCapabilityRefs.includes(node.capabilityRef) || contract.requiredDecision !== 'compensate') fail(
      'P4_PLAN_COMPENSATION_CONTRACT_MISMATCH', 'Compensation node is not declared by the target Capability policy contract.'
    );
  }
}

function validateWorkflowPlan(rawPlan, options) {
  if (!options || !options.registry || !options.contractValidator || !options.policyRegistry) fail(
    'P4_PLAN_VALIDATION_DEPENDENCIES_REQUIRED', 'Plan validation requires Capability, schema, and execution policy registries.'
  );
  const required = [
    'schemaRef', 'schemaVersion', 'planId', 'workAttemptId', 'ownerDomain', 'plannerContractRef', 'plannerVersion',
    'workObjectiveTypeRef', 'workObjectiveVersion', 'executionBasisDigest', 'capabilityCatalogDigest', 'resolution',
    'diagnosticClassification', 'nodes'
  ];
  exactObject(rawPlan, required, [], 'P4_PLAN_SHAPE_MISMATCH');
  if (rawPlan.schemaRef !== PLAN_SCHEMA || rawPlan.schemaVersion !== 1 || !Array.isArray(rawPlan.nodes) ||
      !Number.isSafeInteger(rawPlan.plannerVersion) || rawPlan.plannerVersion < 1 ||
      !Number.isSafeInteger(rawPlan.workObjectiveVersion) || rawPlan.workObjectiveVersion < 1 ||
      !SHA256.test(rawPlan.executionBasisDigest || '') || !SHA256.test(rawPlan.capabilityCatalogDigest || '')) {
    fail('P4_PLAN_FIELD_INVALID', 'Workflow Plan fields violate the nominal contract.');
  }
  for (const field of ['planId', 'workAttemptId', 'ownerDomain', 'plannerContractRef', 'workObjectiveTypeRef']) requiredText(rawPlan[field], field);
  if (rawPlan.capabilityCatalogDigest !== executionCatalogDigest(options.registry, options.policyRegistry)) fail(
    'P4_PLAN_CATALOG_DIGEST_MISMATCH', 'Plan Catalog digest does not bind the exact Capability and execution policy snapshots.'
  );
  assertPlanResolution(rawPlan.resolution, rawPlan.nodes.length);
  if ((rawPlan.resolution === 'planned') !== (rawPlan.diagnosticClassification === null)) fail(
    'P4_PLAN_DIAGNOSTIC_RESOLUTION_MISMATCH', 'Only non-planned Resolution carries diagnostic classification.'
  );
  if (rawPlan.diagnosticClassification !== null) requiredText(rawPlan.diagnosticClassification, 'diagnosticClassification');
  const planContext = { ownerDomain: rawPlan.ownerDomain, policyRegistry: options.policyRegistry };
  const nodes = rawPlan.nodes.map((node) => validateNode(node, planContext, options.registry, options.contractValidator));
  assertDag(nodes);
  validateBindingSets(nodes, options.registry, options.contractValidator, rawPlan.ownerDomain);
  validateCompensations(nodes, options.policyRegistry);
  const normalized = Object.freeze({ ...rawPlan, nodes: Object.freeze(nodes) });
  return Object.freeze({ plan: normalized, graphDigest: digest(canonicalJson(normalized)) });
}

function definitions(schemaManifest) {
  return Object.freeze({
    attempts: createRepositoryDefinition({ repositoryId: 'plan_attempts', owner: 'execution-foundation', schemaManifest, statements: {
      find: { kind: 'select-one', tableId: 'fx_work_attempts', columns: ['attempt_id', 'work_id', 'basis_digest', 'state'], keyColumns: ['attempt_id'] }
    } }),
    works: createRepositoryDefinition({ repositoryId: 'plan_works', owner: 'execution-foundation', schemaManifest, statements: {
      find: { kind: 'select-one', tableId: 'fx_supporting_works', columns: ['work_id', 'owner_domain', 'priority_class'], keyColumns: ['work_id'] }
    } }),
    plans: createRepositoryDefinition({ repositoryId: 'plans', owner: 'execution-foundation', schemaManifest, statements: {
      find_attempt: { kind: 'select-one', tableId: 'fx_workflow_plans', columns: ['plan_id', 'graph_digest', 'state'], keyColumns: ['attempt_id'] },
      insert: { kind: 'insert', tableId: 'fx_workflow_plans', columns: [
        'plan_id', 'attempt_id', 'planner_ref', 'planner_version', 'catalog_digest', 'basis_digest', 'graph_digest', 'state', 'created_at_ms'
      ] }
    } }),
    nodes: createRepositoryDefinition({ repositoryId: 'plan_nodes', owner: 'execution-foundation', schemaManifest, statements: {
      insert: { kind: 'insert', tableId: 'fx_plan_nodes', columns: [
        'plan_id', 'node_id', 'capability_ref', 'contract_version', 'input_binding_schema_ref', 'input_bindings_json',
        'parameter_schema_ref', 'parameters_json', 'when_schema_ref', 'when_json', 'effect_class', 'fence_schema_ref',
        'fence_basis_json', 'resource_demand_schema_ref', 'resource_demand_json'
      ] }
    } }),
    edges: createRepositoryDefinition({ repositoryId: 'plan_edges', owner: 'execution-foundation', schemaManifest, statements: {
      insert: { kind: 'insert', tableId: 'fx_plan_edges', columns: ['plan_id', 'from_node_id', 'to_node_id', 'dependency_kind'] }
    } }),
    events: createRepositoryDefinition({ repositoryId: 'plan_events', owner: 'execution-foundation', schemaManifest, statements: {
      insert: { kind: 'insert', tableId: 'fx_workflow_events', columns: [
        'event_id', 'plan_id', 'node_id', 'work_id', 'attempt_id', 'owner_domain', 'capability_ref', 'contract_version',
        'state', 'priority_class', 'ready_at_ms', 'retry_at_ms', 'result_id', 'current_progress_revision'
      ] }
    } })
  });
}

function createWorkflowPlanPublisher(options) {
  if (!options || !options.schemaManifest || !options.unitOfWork || !options.registry || !options.contractValidator || !options.policyRegistry) {
    fail('P4_PLAN_PUBLISHER_DEPENDENCIES_REQUIRED', 'P3 UoW, exact Capability/Policy Registries, and Contract Validator are required.');
  }
  const repositories = definitions(options.schemaManifest);
  return Object.freeze({
    publish(rawPlan) {
      const validated = validateWorkflowPlan(rawPlan, options);
      const plan = validated.plan;
      try {
        const results = options.unitOfWork.execute([{
          participantId: 'workflow_plan_publish', owner: 'execution-foundation',
          repositories: Object.values(repositories),
          execute(context) {
            const attempt = context.repository('plan_attempts').invoke('find', { attempt_id: plan.workAttemptId });
            if (!attempt || attempt.state !== 'ready' || attempt.basis_digest !== plan.executionBasisDigest) fail(
              'P4_PLAN_ATTEMPT_FENCE_REJECTED', 'Plan requires the exact ready Work Attempt and Basis digest.'
            );
            const work = context.repository('plan_works').invoke('find', { work_id: attempt.work_id });
            if (!work || work.owner_domain !== plan.ownerDomain) fail('P4_PLAN_OWNER_MISMATCH', 'Plan Owner must match Supporting Work Owner.');
            const existing = context.repository('plans').invoke('find_attempt', { attempt_id: plan.workAttemptId });
            if (existing) {
              if (existing.plan_id === plan.planId && existing.graph_digest === validated.graphDigest && existing.state === plan.resolution) {
                throw new PlanReplay(Object.freeze({ replayed: true, planId: plan.planId, graphDigest: validated.graphDigest, resolution: plan.resolution }));
              }
              fail('P4_PLAN_ATTEMPT_ALREADY_PLANNED', 'Work Attempt already owns a different immutable Plan.');
            }
            context.repository('plans').invoke('insert', {
              plan_id: plan.planId, attempt_id: plan.workAttemptId, planner_ref: plan.plannerContractRef,
              planner_version: plan.plannerVersion, catalog_digest: plan.capabilityCatalogDigest,
              basis_digest: plan.executionBasisDigest, graph_digest: validated.graphDigest, state: plan.resolution,
              created_at_ms: context.commitTimeMs
            });
            const byEvent = new Map(plan.nodes.map((node) => [node.eventId, node]));
            for (const node of plan.nodes) {
              const ready = node.dependsOn.length === 0;
              context.repository('plan_events').invoke('insert', {
                event_id: node.eventId, plan_id: plan.planId, node_id: node.nodeId, work_id: work.work_id,
                attempt_id: attempt.attempt_id, owner_domain: plan.ownerDomain, capability_ref: node.capabilityRef,
                contract_version: node.contractVersion, state: ready ? 'ready' : 'pending', priority_class: work.priority_class,
                ready_at_ms: ready ? context.commitTimeMs : null, retry_at_ms: null, result_id: null, current_progress_revision: null
              });
            }
            for (const node of plan.nodes) {
              context.repository('plan_nodes').invoke('insert', {
                plan_id: plan.planId, node_id: node.nodeId, capability_ref: node.capabilityRef, contract_version: node.contractVersion,
                input_binding_schema_ref: node.inputBindingsSchemaRef, input_bindings_json: canonicalJson(node.inputBindings),
                parameter_schema_ref: node.parametersSchemaRef, parameters_json: canonicalJson(node.parameters),
                when_schema_ref: node.whenSchemaRef, when_json: node.when === null ? null : canonicalJson(node.when),
                effect_class: node.effectClass, fence_schema_ref: node.fenceSchemaRef, fence_basis_json: canonicalJson(node.fenceBasis),
                resource_demand_schema_ref: node.resourceDemandSchemaRef, resource_demand_json: canonicalJson(node.resourceDemand)
              });
              for (const dependency of node.dependsOn) context.repository('plan_edges').invoke('insert', {
                plan_id: plan.planId, from_node_id: byEvent.get(dependency.eventId).nodeId,
                to_node_id: node.nodeId, dependency_kind: dependency.satisfaction
              });
            }
            return Object.freeze({ replayed: false, planId: plan.planId, graphDigest: validated.graphDigest, resolution: plan.resolution });
          }
        }]);
        return results.workflow_plan_publish;
      } catch (error) {
        if (error instanceof PlanReplay) return error.result;
        throw error;
      }
    }
  });
}

module.exports = Object.freeze({ WorkflowPlanError, createWorkflowPlanPublisher, executionCatalogDigest, validateWorkflowPlan });
