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
  assert.equal(result.typeCount, 30);
  assert.match(result.registryDigest, /^[a-f0-9]{64}$/);
});

test('requires the exact mandatory Physical Material identity fields', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(actualContractsRoot, 'types/PhysicalMaterialIdentity/v2/schema.json'), 'utf8'));
  assert.deepEqual(
    new Set(schema.required),
    new Set(['schemaRef', 'schemaVersion', 'materialKey', 'mountScopeId', 'inode', 'sizeBytes',
      'fingerprintAlgorithm', 'fingerprintVersion', 'contentFingerprint'])
  );
  assert.equal(schema.properties.schemaVersion.const, 2);
  assert.equal(schema.properties.fingerprintAlgorithm.const, 'middle-256k-sha256');
  assert.equal(schema.properties.fingerprintVersion.const, 1);
  assert.equal(schema.properties.contentFingerprint.pattern, '^[a-f0-9]{64}$');
});

test('freezes the complete read-only Workspace Material Handle', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(actualContractsRoot, 'types/WorkspaceMaterialHandle/v1/schema.json'), 'utf8'));
  for (const field of ['endpointId', 'materialKey', 'physicalIdentity', 'rootHandleRef', 'accessScope', 'fenceDigest']) {
    assert.ok(schema.required.includes(field), field);
  }
  assert.equal(schema.properties.accessScope.const, 'workspace_material_read');
});

test('freezes the complete external material Handle and normalized provider snapshot', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(actualContractsRoot, 'types/ExternalMaterialHandle/v1/schema.json'), 'utf8'));
  for (const field of ['configRevision', 'externalObjectRef', 'endpointId', 'landingBinding', 'location', 'structureKind', 'outputSnapshot',
    'manifestDigest', 'observationRevision', 'accessFenceDigest']) assert.ok(schema.required.includes(field), field);
  const snapshot = schema.properties.outputSnapshot;
  for (const field of ['integrationId', 'configRevision', 'externalObjectRef', 'endpointId', 'landingBinding', 'location', 'structureKind',
    'members', 'identityAnchors', 'observedAtMs', 'newestMutationAtMs', 'memberSetDigest', 'manifestDigest',
    'snapshotDigest']) assert.ok(snapshot.required.includes(field), field);
  const member = snapshot.properties.members.items;
  for (const field of ['ordinal', 'externalMemberId', 'relativePath', 'sizeBytes', 'checksumAlgorithm', 'checksumHex',
    'episodeClaims', 'memberDigest']) assert.ok(member.required.includes(field), field);
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
