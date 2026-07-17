'use strict';

const { createRepositoryDefinition } = require('../persistence/owner-repository');

const HASH = /^[0-9a-f]{64}$/;
const TERMINAL = new Set(['succeeded', 'skipped', 'failed', 'cancelled']);

class CompensationControllerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CompensationControllerError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) { throw new CompensationControllerError(code, message, details); }

function definitions(schemaManifest) {
  return Object.freeze({
    events: createRepositoryDefinition({ repositoryId: 'compensation_events', owner: 'execution-foundation', schemaManifest, statements: {
      find: { kind: 'select-one', tableId: 'fx_workflow_events', columns: [
        'event_id', 'plan_id', 'node_id', 'capability_ref', 'state', 'ready_at_ms', 'retry_at_ms', 'result_id'
      ], keyColumns: ['event_id'] },
      activate: { kind: 'update', tableId: 'fx_workflow_events', setColumns: [
        'state', 'ready_at_ms', 'retry_at_ms', 'result_id'
      ], keyColumns: ['event_id'], compareColumns: [{ column: 'state', parameter: 'expected_state' }] }
    } }),
    nodes: createRepositoryDefinition({ repositoryId: 'compensation_nodes', owner: 'execution-foundation', schemaManifest, statements: {
      find: { kind: 'select-one', tableId: 'fx_plan_nodes', columns: [
        'plan_id', 'node_id', 'capability_ref', 'effect_class', 'when_schema_ref', 'when_json'
      ], keyColumns: ['plan_id', 'node_id'] }
    } }),
    edges: createRepositoryDefinition({ repositoryId: 'compensation_edges', owner: 'execution-foundation', schemaManifest, statements: {
      list: { kind: 'select-all', tableId: 'fx_plan_edges', columns: [
        'plan_id', 'from_node_id', 'to_node_id', 'dependency_kind'
      ], keyColumns: [] }
    } })
  });
}

function createCompensationController(options) {
  if (!options || !options.schemaManifest || !options.unitOfWork || !options.policyRegistry ||
      typeof options.policyRegistry.bindingFor !== 'function' || typeof options.policyRegistry.compensation !== 'function' ||
      !options.eligibilityEvaluator || typeof options.eligibilityEvaluator.evaluate !== 'function') fail(
    'P4_COMPENSATION_DEPENDENCIES_REQUIRED', 'Compensation Controller requires clean persistence, policies, and restricted eligibility evaluator.'
  );
  const repositories = definitions(options.schemaManifest);
  return Object.freeze({
    authorize(request) {
      const expected = ['compensationEventId', 'evidenceDigest', 'recoveryDecision', 'targetEventId'];
      if (!request || typeof request !== 'object' || Array.isArray(request) ||
          JSON.stringify(Object.keys(request).sort()) !== JSON.stringify(expected) ||
          request.recoveryDecision !== 'compensate' || !HASH.test(request.evidenceDigest || '')) fail(
        'P4_COMPENSATION_AUTHORIZATION_INVALID', 'Compensation requires exact target, compensate decision, and recovery evidence.'
      );
      return options.unitOfWork.execute([{ participantId: 'compensation_authorize', owner: 'execution-foundation',
        repositories: Object.values(repositories), execute(context) {
          const compensationEvent = context.repository('compensation_events').invoke('find', { event_id: request.compensationEventId });
          const targetEvent = context.repository('compensation_events').invoke('find', { event_id: request.targetEventId });
          if (!compensationEvent || !targetEvent || compensationEvent.plan_id !== targetEvent.plan_id ||
              compensationEvent.state !== 'pending' || !TERMINAL.has(targetEvent.state)) fail(
            'P4_COMPENSATION_EVENT_STATE_INVALID', 'Compensation and terminal target Events must exist in the same immutable Plan.'
          );
          const compensationNode = context.repository('compensation_nodes').invoke('find', {
            plan_id: compensationEvent.plan_id, node_id: compensationEvent.node_id
          });
          const targetNode = context.repository('compensation_nodes').invoke('find', {
            plan_id: targetEvent.plan_id, node_id: targetEvent.node_id
          });
          const terminalEdge = context.repository('compensation_edges').invoke('list').some((edge) =>
            edge.plan_id === targetEvent.plan_id && edge.from_node_id === targetEvent.node_id &&
            edge.to_node_id === compensationEvent.node_id && edge.dependency_kind === 'terminal');
          if (!compensationNode || !targetNode || !terminalEdge || targetNode.effect_class === 'destructive_commit') fail(
            'P4_COMPENSATION_PLAN_CONTRACT_MISMATCH', 'Only an exact predeclared non-destructive compensation pair may activate.'
          );
          const targetBinding = options.policyRegistry.bindingFor(targetNode.capability_ref, targetNode.effect_class);
          const matchingContracts = targetBinding.compensationContractRefs.map((ref) => options.policyRegistry.compensation(ref))
            .filter((candidate) => candidate.targetEffectClasses.includes(targetNode.effect_class) &&
              candidate.compensationCapabilityRefs.includes(compensationNode.capability_ref) && candidate.requiredDecision === 'compensate');
          if (matchingContracts.length !== 1) fail('P4_COMPENSATION_POLICY_MISMATCH', 'Compensation relation must resolve one exact policy contract.');
          const contract = matchingContracts[0];
          if (!targetBinding.compensationContractRefs.includes(contract.ref) ||
              !contract.targetEffectClasses.includes(targetNode.effect_class) ||
              !contract.compensationCapabilityRefs.includes(compensationNode.capability_ref) || contract.requiredDecision !== 'compensate') fail(
            'P4_COMPENSATION_POLICY_MISMATCH', 'Predeclared compensation does not match the target Capability policy.'
          );
          const eligibility = compensationNode.when_schema_ref === null ? 'authorize' : options.eligibilityEvaluator.evaluate(Object.freeze({
            schemaRef: compensationNode.when_schema_ref, expression: JSON.parse(compensationNode.when_json),
            target: Object.freeze({ eventId: targetEvent.event_id, state: targetEvent.state }), evidenceDigest: request.evidenceDigest
          }));
          if (!['authorize', 'skip'].includes(eligibility)) fail(
            'P4_COMPENSATION_ELIGIBILITY_INVALID', 'Restricted compensation evaluator must return authorize or skip.'
          );
          const nextState = eligibility === 'authorize' ? 'ready' : 'skipped';
          const updated = context.repository('compensation_events').invoke('activate', {
            event_id: compensationEvent.event_id, expected_state: 'pending', state: nextState,
            ready_at_ms: nextState === 'ready' ? context.commitTimeMs : null, retry_at_ms: null, result_id: null
          });
          if (updated.changes !== 1) fail('P4_COMPENSATION_ACTIVATION_RACE', 'Compensation Event changed before activation.');
          return Object.freeze({ compensationEventId: compensationEvent.event_id, targetEventId: targetEvent.event_id,
            decision: nextState, compensationContractRef: contract.ref, evidenceDigest: request.evidenceDigest });
        } }]).compensation_authorize;
    }
  });
}

module.exports = Object.freeze({ CompensationControllerError, createCompensationController });
