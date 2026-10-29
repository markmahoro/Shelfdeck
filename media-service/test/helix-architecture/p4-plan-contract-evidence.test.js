'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { capturePlanContracts } = require('../../src/helix/foundation/execution/plan-contract-evidence');
const { createCapabilityContractValidator } = require('../../src/helix/foundation/capability/contract-validator');

function fixture() {
  const prefix = 'helix://test/evidence/';
  const schemas = [
    { $id: prefix + 'payload', type: 'object', properties: { value: { $ref: prefix + 'value' } }, required: ['value'], additionalProperties: false },
    { $id: prefix + 'value', type: 'string' },
    { $id: prefix + 'unused', type: 'integer' },
  ];
  const manifest = { capabilityRef: 'test.observe@1', contractVersion: 1, ownerScope: 'libra', effectClass: 'pure_observation',
    inputPorts: { input: { schemaRef: prefix + 'payload' } }, parametersSchemaRef: prefix + 'payload',
    resultSchemaRef: prefix + 'payload', evidenceSchemaRef: prefix + 'payload', sourceLocator: { line: 1 } };
  const retry = { ref: prefix + 'retry', maxFailureAttempts: 3 };
  const options = { registry: { resolve(ref, owner) { assert.equal(ref, manifest.capabilityRef); assert.equal(owner, 'libra'); return { manifest, executor: { version: 1 } }; } },
    policyRegistry: { bindingFor: () => ({ retryPolicyRef: retry.ref, timeoutPolicyRef: prefix + 'timeout', compensationContractRefs: [] }),
      retryFor: () => retry, timeoutFor: () => ({ ref: prefix + 'timeout', timeoutMs: 1000 }) },
    contractValidator: createCapabilityContractValidator({ schemas }) };
  const plan = { ownerDomain: 'libra', nodes: [{ capabilityRef: manifest.capabilityRef, parametersSchemaRef: prefix + 'payload' }] };
  return { prefix, schemas, manifest, retry, options, plan };
}

test('Plan evidence freezes only used contracts and their exact transitive schema closure', () => {
  const f = fixture(), captured = capturePlanContracts(f.plan, f.options);
  assert.equal(captured.evidence.capabilities.length, 1);
  assert.deepEqual(captured.evidence.schemas.map(value => value.$id), [f.prefix + 'payload', f.prefix + 'value']);
  f.plan.nodes.push({ ...f.plan.nodes[0] });
  assert.equal(capturePlanContracts(f.plan, f.options).digest, captured.digest);
  assert.equal(captured.evidence.capabilities[0].manifest.sourceLocator, undefined);
});

test('unrelated capabilities, schemas and source locations do not require a new Plan contract', () => {
  const f = fixture(), first = capturePlanContracts(f.plan, f.options);
  f.options.registry.snapshot = [{ capabilityRef: 'unrelated.new@1' }];
  f.schemas[2].type = 'boolean';
  f.schemas.push({ $id: f.prefix + 'added', type: 'null' });
  f.manifest.sourceLocator.line = 900;
  f.options.contractValidator = createCapabilityContractValidator({ schemas: f.schemas });
  assert.equal(capturePlanContracts(f.plan, f.options).digest, first.digest);
});

test('used schema or policy changes have a different identity without rewriting previous evidence', () => {
  const f = fixture(), first = capturePlanContracts(f.plan, f.options);
  f.retry.maxFailureAttempts = 4;
  assert.notEqual(capturePlanContracts(f.plan, f.options).digest, first.digest);
  assert.equal(first.evidence.capabilities[0].policy.retry.maxFailureAttempts, 3);
  f.retry.maxFailureAttempts = 3;
  f.schemas[1].type = 'number';
  f.options.contractValidator = createCapabilityContractValidator({ schemas: f.schemas });
  assert.notEqual(capturePlanContracts(f.plan, f.options).digest, first.digest);
  assert.equal(first.evidence.schemas[1].type, 'string');
});

test('schema access returns isolated bytes from the same immutable validator snapshot', () => {
  const f = fixture(), validator = f.options.contractValidator;
  f.schemas[1].type = 'number';
  validator.readSchema(f.prefix + 'value').type = 'boolean';
  assert.equal(validator.readSchema(f.prefix + 'value').type, 'string');
  validator.validate(f.prefix + 'payload', { value: 'original' });
  assert.throws(() => validator.validate(f.prefix + 'payload', { value: 7 }));
});

test('missing transitive schema and missing frozen-schema access reject publication', () => {
  const f = fixture();
  f.options.contractValidator = createCapabilityContractValidator({ schemas: [f.schemas[0]] });
  assert.throws(() => capturePlanContracts(f.plan, f.options), { code: 'P4_CAPABILITY_UNKNOWN_SCHEMA' });
  assert.throws(() => capturePlanContracts(f.plan, { ...f.options, contractValidator: { validate() {} } }),
    { code: 'P4_PLAN_CONTRACT_EVIDENCE_INVALID' });
});

test('a zero-node Plan has an explicit empty evidence identity', () => {
  const f = fixture(), value = capturePlanContracts({ ...f.plan, nodes: [] }, f.options);
  assert.deepEqual(value.evidence.capabilities, []);
  assert.deepEqual(value.evidence.schemas, []);
  assert.match(value.digest, /^[a-f0-9]{64}$/);
});
