'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { validateDomainInputSchemas } = require('../../scripts/helix-architecture/domain-input-schema-validator');

const repositoryRoot = path.resolve(__dirname, '../../..');
const contractsRoot = path.join(repositoryRoot, 'media-service', 'src', 'helix', 'contracts');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-domain-inputs-'));
  fs.cpSync(contractsRoot, root, { recursive: true });
  return root;
}

function mutate(filePath, change) {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  change(value);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

const codes = (result) => new Set(result.findings.map((item) => item.code));

test('validates all Catalog domain inputs and their exact usage traceability', () => {
  const result = validateDomainInputSchemas({ contractsRoot, repositoryRoot });
  assert.equal(result.ok, true);
  assert.equal(result.typeCount, 113);
  assert.equal(result.boundedContractCount, 24);
  assert.equal(result.acceptedDtoCount, 89);
});

test('rejects contract drift, open objects, raw paths, and unresolved refs', () => {
  const root = fixture();
  try {
    const filePath = path.join(root, 'domain-types', 'CandidateDraft', 'v1', 'schema.json');
    mutate(filePath, (schema) => {
      schema.additionalProperties = true;
      schema.properties.rawPath = { type: 'string' };
      schema.required.push('rawPath');
      schema.properties.candidate = { $ref: 'helix://contracts/types/MissingCandidate/v1' };
    });
    const result = validateDomainInputSchemas({ contractsRoot: root, repositoryRoot });
    const resultCodes = codes(result);
    assert.ok(resultCodes.has('DOMAIN_INPUT_CONTRACT_DRIFT'));
    assert.ok(resultCodes.has('OPEN_DOMAIN_INPUT_OBJECT'));
    assert.ok(resultCodes.has('FORBIDDEN_DOMAIN_INPUT_FIELD'));
    assert.ok(resultCodes.has('UNRESOLVED_DOMAIN_INPUT_REF'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects duplicate registry entries and unbounded requirement contracts', () => {
  const root = fixture();
  try {
    mutate(path.join(root, 'domain-input-type-registry.json'), (registry) => {
      registry.entries[1].id = registry.entries[0].id;
    });
    mutate(path.join(root, 'domain-types', 'ArtifactProfile', 'v1', 'schema.json'), (schema) => {
      schema.required = schema.required.filter((field) => field !== 'typedParameters');
    });
    const result = validateDomainInputSchemas({ contractsRoot: root, repositoryRoot });
    assert.ok(codes(result).has('DUPLICATE_DOMAIN_INPUT_ENTRY'));
    assert.ok(codes(result).has('UNBOUNDED_INTENT_PARAMETERS'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
