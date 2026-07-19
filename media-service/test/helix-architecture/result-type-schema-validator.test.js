'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { validateResultTypeSchemas } = require('../../scripts/helix-architecture/result-type-schema-validator');

const actualContractsRoot = path.resolve(__dirname, '../../src/helix/contracts');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-result-types-'));
  fs.cpSync(actualContractsRoot, root, { recursive: true });
  return root;
}

function mutate(filePath, change) {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  change(value);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

const codes = (result) => new Set(result.findings.map((item) => item.code));

test('validates the complete 96 Catalog Result graph plus twelve helpers', () => {
  const result = validateResultTypeSchemas({ contractsRoot: actualContractsRoot });
  assert.equal(result.ok, true);
  assert.equal(result.catalogResultCount, 96);
  assert.equal(result.nominalResultCount, 87);
  assert.equal(result.directResultCount, 9);
  assert.equal(result.helperCount, 12);
});

test('rejects Result contract drift, open objects, and unresolved refs', () => {
  const root = fixture();
  try {
    const filePath = path.join(root, 'types', 'OnDeckCommitResult', 'v1', 'schema.json');
    mutate(filePath, (schema) => {
      schema.additionalProperties = true;
      schema.properties.onDeckCommitReceipt.$ref = 'helix://contracts/types/MissingReceipt/v1';
    });
    const result = validateResultTypeSchemas({ contractsRoot: root });
    assert.ok(codes(result).has('OPEN_RESULT_OBJECT_SCHEMA'));
    assert.ok(codes(result).has('UNRESOLVED_RESULT_TYPE_REF'));
    assert.ok(codes(result).has('RESULT_SCHEMA_CONTRACT_DRIFT'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects duplicate registry identity and Outcome kinds in business Results', () => {
  const root = fixture();
  try {
    mutate(path.join(root, 'result-type-registry.json'), (registry) => {
      registry.entries[1].id = registry.entries[0].id;
    });
    mutate(path.join(root, 'types', 'ArtifactAcquisitionResult', 'v1', 'schema.json'), (schema) => {
      schema.properties.kind = { const: 'deferred' };
      schema.required.push('kind');
    });
    const result = validateResultTypeSchemas({ contractsRoot: root });
    assert.ok(codes(result).has('DUPLICATE_RESULT_TYPE_ENTRY'));
    assert.ok(codes(result).has('OUTCOME_VARIANT_IN_RESULT'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
