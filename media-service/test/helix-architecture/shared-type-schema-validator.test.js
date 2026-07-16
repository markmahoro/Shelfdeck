'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { validateSharedTypeSchemas } = require('../../scripts/helix-architecture/shared-type-schema-validator');

const actualContractsRoot = path.resolve(__dirname, '../../src/helix/contracts');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-shared-types-'));
  fs.cpSync(actualContractsRoot, root, { recursive: true });
  return root;
}

function mutateJson(filePath, mutate) {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  mutate(value);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function codes(result) {
  return new Set(result.findings.map((item) => item.code));
}

test('validates all SSOT shared handles, envelopes, context, and Outcome', () => {
  const result = validateSharedTypeSchemas({ contractsRoot: actualContractsRoot });
  assert.equal(result.ok, true);
  assert.equal(result.typeCount, 28);
  assert.match(result.registryDigest, /^[a-f0-9]{64}$/);
});

test('requires the exact mandatory Physical Material identity fields', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(actualContractsRoot, 'types/PhysicalMaterialIdentity/v1/schema.json'), 'utf8'));
  assert.deepEqual(
    new Set(schema.required),
    new Set(['schemaRef', 'schemaVersion', 'materialKey', 'mountScopeId', 'inode', 'contentHashAlgorithm', 'contentHash'])
  );
  assert.equal(schema.properties.contentHashAlgorithm.const, 'sha256');
  assert.equal(schema.properties.contentHash.pattern, '^[a-f0-9]{64}$');
});

test('rejects schema drift, open objects, and unresolved refs', () => {
  const root = fixture();
  try {
    const filePath = path.join(root, 'types/PhysicalMaterialReadHandle/v1/schema.json');
    mutateJson(filePath, (schema) => {
      schema.additionalProperties = true;
      schema.properties.identity.$ref = 'helix://contracts/types/Missing/v1';
      schema.required = schema.required.filter((name) => name !== 'fenceDigest');
    });
    const result = validateSharedTypeSchemas({ contractsRoot: root });
    const resultCodes = codes(result);
    assert.ok(resultCodes.has('OPEN_OBJECT_SCHEMA'));
    assert.ok(resultCodes.has('UNRESOLVED_SHARED_TYPE_REF'));
    assert.ok(resultCodes.has('SHARED_SCHEMA_CONTRACT_DRIFT'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects duplicate registry identity and paths', () => {
  const root = fixture();
  try {
    const registryPath = path.join(root, 'shared-type-registry.json');
    mutateJson(registryPath, (registry) => {
      registry.entries[1].id = registry.entries[0].id;
      registry.entries[1].schemaId = registry.entries[0].schemaId;
      registry.entries[1].relativePath = registry.entries[0].relativePath;
    });
    const result = validateSharedTypeSchemas({ contractsRoot: root });
    assert.ok(codes(result).has('INVALID_SHARED_TYPE_ENTRY'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects forbidden authority fields in CapabilityExecutionContext', () => {
  const root = fixture();
  try {
    const filePath = path.join(root, 'types/CapabilityExecutionContext/v1/schema.json');
    mutateJson(filePath, (schema) => {
      schema.properties.store = { type: 'string' };
      schema.required.push('store');
    });
    const result = validateSharedTypeSchemas({ contractsRoot: root });
    assert.ok(codes(result).has('FORBIDDEN_EXECUTION_CONTEXT_FIELD'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Outcome keeps deferred, failed, and fence rejection outside Result schemas', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(actualContractsRoot, 'types/CapabilityOutcome/v1/schema.json'), 'utf8'));
  const kinds = schema.oneOf.map((variant) => variant.properties.kind.const).sort();
  assert.deepEqual(kinds, ['deferred', 'failed', 'fence_rejected', 'succeeded']);
  assert.deepEqual(schema.oneOf.find((variant) => variant.properties.kind.const === 'failed').properties.retryDirective.enum, ['never', 'contract_policy']);
});
