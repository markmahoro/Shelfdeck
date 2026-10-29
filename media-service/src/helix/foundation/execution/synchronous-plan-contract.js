'use strict';

const { canonicalDigest } = require('../../contracts/canonical-json');
const { createCapabilityContractValidator } = require('../capability/contract-validator');
const { COMMAND_FORMAT, validateContractDocument, verifyPlanContractBinding } = require('./plan-contract-evidence');
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);
const HASH = /^[a-f0-9]{64}$/;
function check(value, message) { if (!value) throw new Error(message); }

function synchronousPlan(request) {
  return { planId: request.workId + ':plan:1', workAttemptId: request.workId + ':attempt:1', ownerDomain: request.ownerDomain,
    executionBasisDigest: request.basisDigest, capabilityCatalogDigest: request.catalogDigest,
    nodes: request.steps.map((step, index) => ({ nodeId: String(index).padStart(6, '0') + ':' + step.nodeId,
      eventId: step.eventId, capabilityRef: step.capabilityRef, contractVersion: 1, effectClass: step.effectClass,
      inputBindingsSchemaRef: step.inputSchemaRef, inputBindings: step.input, parametersSchemaRef: step.parametersSchemaRef,
      parameters: step.parameters, fenceSchemaRef: step.fenceSchemaRef, fenceBasis: step.fenceBasis,
      resourceDemandSchemaRef: step.resourceDemandSchemaRef, resourceDemand: step.resourceDemand,
      whenSchemaRef: null, when: null, dependsOn: [] })) };
}

function validateSynchronousNodes(contract, nodes, validator) {
  check(nodes.length === contract.steps.length, 'Synchronous command step count differs.');
  for (const [index, node] of nodes.entries()) {
    const step = contract.steps[index];
    check(node.capabilityRef === step.capabilityRef && node.contractVersion === step.contractVersion && node.effectClass === step.effectClass &&
      node.when === null && node.whenSchemaRef === null && node.dependsOn.length === 0, 'Synchronous command step contract differs.');
    for (const [refKey, valueKey, contractKey] of [ ['inputBindingsSchemaRef', 'inputBindings', 'inputSchemaRef'],
      ['parametersSchemaRef', 'parameters', 'parametersSchemaRef'], ['fenceSchemaRef', 'fenceBasis', 'fenceSchemaRef'],
      ['resourceDemandSchemaRef', 'resourceDemand', 'resourceDemandSchemaRef'] ]) {
      check(node[refKey] === step[contractKey], 'Synchronous command schema binding differs.');
      validator.validate(step[contractKey], node[valueKey]);
    }
  }
}

function captureSynchronousContract(request) {
  const evidence = request.executionContract, digest = canonicalDigest(evidence);
  validateContractDocument(evidence, digest);
  check(evidence.schemaRef === COMMAND_FORMAT && evidence.ownerDomain === request.ownerDomain && evidence.plannerRef === request.plannerRef,
    'Synchronous command publication lacks its Owner contract.');
  validateSynchronousNodes(evidence, synchronousPlan(request).nodes, createCapabilityContractValidator({ schemas: evidence.schemas }));
  return { evidence, digest };
}

function proveSynchronousPlan(saved, facts, currentContracts, requireCurrent) {
  validateContractDocument(saved.evidence, saved.binding.contract_digest);
  verifyPlanContractBinding(saved, facts);
  const contract = saved.evidence, terminal = TERMINAL.has(facts.workAttempt.state);
  check(terminal || ['ready', 'running', 'blocked'].includes(facts.workAttempt.state), 'Unknown command Attempt state.');
  check(contract.schemaRef === COMMAND_FORMAT && contract.ownerDomain === facts.work.owner_domain &&
    contract.workKind === facts.work.work_kind && contract.plannerRef === facts.plan.planner_ref &&
    facts.plan.state === 'planned' && facts.edges.length === 0 && facts.attempts.length === 0 && facts.effects.length === 0,
  'Synchronous command scope or execution protocol differs.');
  if (!terminal || requireCurrent) check(currentContracts.some(value => canonicalDigest(value) === saved.binding.contract_digest),
    'Synchronous command no longer has an identical current Owner contract.');
  const { planFromFacts } = require('./plan-contract-evidence');
  const nodes = planFromFacts(facts).nodes.sort((a, b) => a.nodeId.localeCompare(b.nodeId, 'en'));
  const validator = createCapabilityContractValidator({ schemas: contract.schemas });
  validateSynchronousNodes(contract, nodes, validator);
  check(new Set(facts.results.map(row => row.event_id)).size === facts.results.length &&
    new Set(facts.results.map(row => row.result_id)).size === facts.results.length &&
    facts.results.every(row => facts.events.some(event => event.event_id === row.event_id)), 'Foreign or duplicate command Result.');
  for (const [index, node] of nodes.entries()) {
    const event = facts.events.find(row => row.event_id === node.eventId);
    check((terminal ? ['succeeded', 'failed', 'cancelled'] : ['ready', 'executing', 'succeeded']).includes(event.state), 'Invalid command Event state.');
    const result = facts.results.find(row => row.event_id === event.event_id);
    if (!result) { check(event.state !== 'succeeded' && event.result_id === null, 'Command Result is missing.'); continue; }
    check(result.outcome_kind === 'succeeded' && ['succeeded', 'executing'].includes(event.state) &&
      (event.state === 'executing' ? event.result_id === null : event.result_id === result.result_id) &&
      result.result_schema_ref === contract.steps[index].resultSchemaRef && result.evidence_schema_ref === result.result_schema_ref &&
      result.result_digest === result.evidence_digest && result.effect_receipt_id === null, 'Command Result binding differs.');
    const value = JSON.parse(result.result_json), evidence = JSON.parse(result.evidence_json);
    check(canonicalDigest(value) === result.result_digest && canonicalDigest(evidence) === result.evidence_digest,
      'Command Result or Evidence bytes changed.');
    validator.validate(result.result_schema_ref, value);
    const markers = facts.markers.filter(row => row.result_id === result.result_id);
    check(markers.length === 1 && markers[0].owner_domain === contract.ownerDomain && markers[0].effect_id === null &&
      markers[0].result_schema_ref === result.result_schema_ref && markers[0].result_digest === result.result_digest &&
      HASH.test(markers[0].commit_digest) && markers[0].scope_type === value.scopeType && markers[0].scope_id === value.scopeId,
    'Command Result lacks its exact Owner Commit Marker.');
  }
  check(facts.markers.length === facts.results.length, 'Command has an unrelated Commit Marker.');
  return facts;
}

module.exports = Object.freeze({ synchronousPlan, captureSynchronousContract, proveSynchronousPlan });
