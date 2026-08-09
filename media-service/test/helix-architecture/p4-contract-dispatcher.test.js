'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createCapabilityRegistry } = require('../../src/helix/foundation/capability/capability-registry');
const { createCapabilityContractValidator } = require('../../src/helix/foundation/capability/contract-validator');
const { createExecutorDispatcher } = require('../../src/helix/foundation/capability/executor-dispatcher');

const serviceRoot = path.resolve(__dirname, '../..');

test('JSON Schema validator is nominal, closed, non-coercing, and fail-closed on unknown refs', () => {
  const validator = createCapabilityContractValidator({ schemas: [{
    $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'helix://fixtures/Echo/v1',
    type: 'object', additionalProperties: false,
    properties: { value: { type: 'integer', minimum: 1 } }, required: ['value']
  }] });
  assert.deepEqual(validator.validate('helix://fixtures/Echo/v1', { value: 1 }), { value: 1 });
  assert.throws(() => validator.validate('helix://fixtures/Echo/v1', { value: '1' }), (error) => error.code === 'P4_CAPABILITY_SCHEMA_REJECTED');
  assert.throws(() => validator.validate('helix://fixtures/Echo/v1', { value: 1, extra: true }), (error) => error.code === 'P4_CAPABILITY_SCHEMA_REJECTED');
  assert.throws(() => validator.validate('helix://fixtures/Missing/v1', {}), (error) => error.code === 'P4_CAPABILITY_UNKNOWN_SCHEMA');
});

function fixtureManifest(effectClass = 'pure_observation') {
  return {
    capabilityRef: 'shared.fixture.observe@1', contractVersion: 1, ownerScope: 'execution-foundation', effectClass,
    parametersSchemaRef: 'helix://fixture/parameters', resultSchemaRef: 'helix://fixture/result',
    evidenceSchemaRef: 'helix://fixture/evidence', fenceSchemaRef: 'helix://fixture/fence',
    semanticValidatorRef: 'helix://fixture/semantic', executorCompatibility: { minimumVersion: 1 }
  };
}

function context(overrides = {}) {
  return {
    executionId: 'execution-1', workId: 'work-1', workAttemptId: 'work-attempt-1', planId: 'plan-1', eventId: 'event-1',
    eventAttemptId: 'event-attempt-1', capabilityRef: 'shared.fixture.observe@1', contractVersion: 1, executorVersion: 1,
    ownerScope: { domain: 'libra', processType: 'fixture', processId: 'process-1', objectRefs: [] }, basisRefs: [],
    namedInputs: {}, parameters: {}, fenceSnapshot: {},
    resourceLease: { leaseId: 'lease-1', resourceKeys: ['control-plane'], issuedAtMs: 1 },
    idempotencyKey: 'event-key-1', traceContext: { traceId: 'trace-1', spanId: 'span-1' }, ...overrides
  };
}

function dispatcherFixture(effectClass = 'pure_observation', outcomeOverrides = {}) {
  const manifest = fixtureManifest(effectClass);
  const calls = [];
  const validator = { validate(ref, value) { calls.push(ref); return value; } };
  let inputValidated = 0;
  let resultValidated = 0;
  const registry = createCapabilityRegistry({
    expectedCapabilityRefs: [manifest.capabilityRef], registrations: [{
      manifest,
      executor: { version: 1, async execute() {
        return {
          kind: 'succeeded', resultSchemaRef: manifest.resultSchemaRef, result: { ok: true },
          evidenceSchemaRef: manifest.evidenceSchemaRef, evidence: { observed: true }, ...outcomeOverrides
        };
      } },
      semanticValidator: { ref: manifest.semanticValidatorRef, validateInputs() { inputValidated += 1; }, validateResult() { resultValidated += 1; } }
    }]
  });
  return {
    calls,
    counts: () => ({ inputValidated, resultValidated }),
    dispatcher: createExecutorDispatcher({ registry, contractValidator: validator }),
    manifest
  };
}

test('typed dispatcher resolves exact contract and validates context/input/parameters/fence/outcome/result/evidence', async () => {
  const fixture = dispatcherFixture();
  const outcome = await fixture.dispatcher.dispatch({ ownerDomain: 'libra', capabilityRef: fixture.manifest.capabilityRef, context: context() });
  assert.equal(outcome.kind, 'succeeded');
  assert.deepEqual(fixture.counts(), { inputValidated: 1, resultValidated: 1 });
  assert.deepEqual(fixture.calls, [
    'helix://contracts/types/CapabilityExecutionContext/v1', 'helix://fixture/parameters', 'helix://fixture/fence',
    'helix://fixture/inputs', 'helix://contracts/types/CapabilityOutcome/v1', 'helix://fixture/result', 'helix://fixture/evidence'
  ]);
});

test('dispatcher rejects owner/context/output drift and non-pure success without Effect Receipt', async () => {
  const fixture = dispatcherFixture();
  await assert.rejects(() => fixture.dispatcher.dispatch({
    ownerDomain: 'libra', capabilityRef: fixture.manifest.capabilityRef, context: context({ executorVersion: 2 })
  }), (error) => error.code === 'P4_DISPATCH_CONTEXT_BINDING_MISMATCH');
  const wrongOutput = dispatcherFixture('pure_observation', { resultSchemaRef: 'helix://wrong' });
  await assert.rejects(() => wrongOutput.dispatcher.dispatch({
    ownerDomain: 'libra', capabilityRef: wrongOutput.manifest.capabilityRef, context: context()
  }), (error) => error.code === 'P4_DISPATCH_OUTPUT_SCHEMA_MISMATCH');
  const write = dispatcherFixture('workspace_write');
  await assert.rejects(() => write.dispatcher.dispatch({ ownerDomain: 'libra', capabilityRef: write.manifest.capabilityRef, context: context() }),
    (error) => error.code === 'P4_DISPATCH_EFFECT_RECEIPT_REQUIRED');
  await assert.rejects(() => fixture.dispatcher.dispatch({
    ownerDomain: 'libra', capabilityRef: fixture.manifest.capabilityRef, context: context(), repository: {}
  }), (error) => error.code === 'P4_DISPATCH_REQUEST_SHAPE_MISMATCH');
});

test('real CapabilityExecutionContext schema rejects forbidden authority fields', () => {
  const typeRoot = path.join(serviceRoot, 'src/helix/contracts/types');
  const schemas = fs.readdirSync(typeRoot).map((name) => {
    const version=fs.readdirSync(path.join(typeRoot,name)).find((entry)=>/^v[0-9]+$/.test(entry));
    return JSON.parse(fs.readFileSync(path.join(typeRoot,name,version,'schema.json'),'utf8'));
  });
  const validator = createCapabilityContractValidator({ schemas });
  assert.equal(validator.validate('helix://contracts/types/CapabilityExecutionContext/v1', context()).executionId, 'execution-1');
  for (const field of ['repository', 'store', 'facade', 'planner', 'runtime', 'governor', 'executor', 'config', 'task']) {
    assert.throws(() => validator.validate('helix://contracts/types/CapabilityExecutionContext/v1', context({ [field]: {} })),
      (error) => error.code === 'P4_CAPABILITY_SCHEMA_REJECTED', field);
  }
});

test('Capability runtime sources contain no fallback, historical flow routing, Store, or internal HTTP', () => {
  for (const file of ['capability-registry.js', 'contract-validator.js', 'executor-dispatcher.js']) {
    const source = fs.readFileSync(path.join(serviceRoot, 'src/helix/foundation/capability', file), 'utf8').toLowerCase();
    for (const parts of [['kair', 'ox'], ['flow', 'kind'], ['http', '://'], ['../domains'], ['../integrations']]) {
      assert.equal(source.includes(parts.join('')), false, file + ':' + parts.join(''));
    }
  }
  const policy = JSON.parse(fs.readFileSync(path.join(serviceRoot, 'src/helix/contracts/manifests/package-boundary-policy.json'), 'utf8'));
  assert.deepEqual(policy.externalModuleRules, [
    { source: 'contracts', allow: ['node:crypto'] },
    { source: 'platform.public', allow: ['node:crypto'] },
    { source: 'foundation.capability', allow: ['ajv/dist/2020', 'ajv-formats'] },
    { source: 'composition', allow: ['node:fs', 'node:os', 'node:path', 'node:crypto'] },
    { source: 'domains.*.model', allow: ['node:path'] },
    { source: 'domains.*.planning', allow: ['node:path'] },
    { source: 'integrations', allow: ['node:crypto', 'node:fs'] }
  ]);
});
