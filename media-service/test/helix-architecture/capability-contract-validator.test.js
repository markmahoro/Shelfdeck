'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { validateCapabilityContracts } = require('../../scripts/helix-architecture/capability-contract-validator');

const repositoryRoot = path.resolve(__dirname, '../../..');
const actualContractsRoot = path.resolve(__dirname, '../../src/helix/contracts');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-capability-contracts-'));
  const repository = path.join(root, 'repository');
  const contracts = path.join(repository, 'media-service', 'src', 'helix', 'contracts');
  fs.mkdirSync(path.join(repository, 'docs', 'helix'), { recursive: true });
  fs.copyFileSync(
    process.env.HELIX_SSOT_PATH || path.join(repositoryRoot, 'docs', 'helix', 'TOP_DOWN_ARCHITECTURE_CONFIRMATION.md'),
    path.join(repository, 'docs', 'helix', 'TOP_DOWN_ARCHITECTURE_CONFIRMATION.md')
  );
  fs.cpSync(actualContractsRoot, contracts, { recursive: true });
  return { root, repository, contracts };
}

function mutateJson(filePath, mutate) {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  mutate(value);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function codes(result) {
  return new Set(result.findings.map((item) => item.code));
}

test('validates 112 unique immutable Capability packages', () => {
  const result = validateCapabilityContracts({ repositoryRoot, contractsRoot: actualContractsRoot });
  assert.equal(result.ok, true);
  assert.equal(result.packageCount, 112);
  assert.match(result.packageAggregateDigest, /^[a-f0-9]{64}$/);
  assert.ok(result.referencedTypeRefCount > 0);
  assert.equal(result.unresolvedTypeRefCount, 0);
});

test('rejects missing files and Catalog-external packages', () => {
  const value = fixture();
  try {
    const packagePath = path.join(value.contracts, 'capabilities/shared/material/filesystem_identity/observe/v1');
    fs.rmSync(path.join(packagePath, 'fence.schema.json'));
    const extra = path.join(value.contracts, 'capabilities/unknown/example/v1');
    fs.mkdirSync(extra, { recursive: true });
    fs.writeFileSync(path.join(extra, 'manifest.json'), '{}');
    const result = validateCapabilityContracts({ repositoryRoot: value.repository, contractsRoot: value.contracts });
    const resultCodes = codes(result);
    assert.ok(resultCodes.has('MISSING_CAPABILITY_CONTRACT_FILE'));
    assert.ok(resultCodes.has('UNREGISTERED_CAPABILITY_PACKAGE'));
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test('rejects Owner, Effect Class, parameter, and package digest drift', () => {
  const value = fixture();
  try {
    const packagePath = path.join(value.contracts, 'capabilities/procurement/field/observation/page/commit/v1');
    mutateJson(path.join(packagePath, 'manifest.json'), (manifest) => {
      manifest.ownerScope = 'libra';
      manifest.effectClass = 'workspace_write';
    });
    mutateJson(path.join(packagePath, 'parameters.schema.json'), (schema) => {
      schema.properties.effectClass = { type: 'string' };
      schema.required.push('effectClass');
    });
    const result = validateCapabilityContracts({ repositoryRoot: value.repository, contractsRoot: value.contracts });
    const resultCodes = codes(result);
    assert.ok(resultCodes.has('CAPABILITY_MANIFEST_IDENTITY_MISMATCH'));
    assert.ok(resultCodes.has('CAPABILITY_PACKAGE_CONTRACT_DRIFT'));
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test('rejects settlement Authorization substituted for Approval', () => {
  const value = fixture();
  try {
    const filePath = path.join(value.contracts, 'capabilities/arca/ondeck/input_settlement/delete/v1/manifest.json');
    mutateJson(filePath, (manifest) => {
      delete manifest.approvalRequirementRef;
      manifest.authorizationRequirementRef = 'helix://contracts/requirements/destructive-authorization/v1';
    });
    const result = validateCapabilityContracts({ repositoryRoot: value.repository, contractsRoot: value.contracts });
    assert.ok(codes(result).has('CAPABILITY_PACKAGE_CONTRACT_DRIFT'));
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test('rejects a Capability type ref that is absent from every P2 registry', () => {
  const value = fixture();
  try {
    const schemaPath = path.join(value.contracts, 'capabilities/shared/material/filesystem_identity/observe/v1/inputs.schema.json');
    mutateJson(schemaPath, (schema) => {
      schema.$defs.physicalMaterialReadHandle.$ref = 'helix://contracts/types/LegacyMaterialPayload/v1';
    });
    const result = validateCapabilityContracts({ repositoryRoot: value.repository, contractsRoot: value.contracts });
    assert.ok(codes(result).has('UNRESOLVED_CAPABILITY_TYPE_REF'));
    assert.equal(result.unresolvedTypeRefCount, 1);
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});
