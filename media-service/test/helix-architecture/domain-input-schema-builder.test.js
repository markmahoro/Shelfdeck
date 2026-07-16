'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildDomainInputSchemas } = require('../../scripts/helix-architecture/domain-input-schema-builder');

const schemas = buildDomainInputSchemas();

test('builds exactly the 85 Catalog-referenced domain input contracts', () => {
  assert.equal(Object.keys(schemas).length, 85);
  assert.equal(Object.values(schemas).filter((schema) => schema['x-helix-role'] === 'bounded-contract').length, 26);
  assert.equal(Object.values(schemas).filter((schema) => schema['x-helix-role'] === 'accepted-business-dto').length, 59);
});

test('bounded requirements and intents carry identity, revision, digest, and typed parameters', () => {
  for (const name of ['MediaRequirement', 'EncodeIntent', 'ArtifactProfile', 'AcceptanceSpec']) {
    const schema = schemas[name];
    for (const field of ['schemaRef', 'schemaVersion', 'revision', 'digest', 'typedParameters']) assert.ok(schema.required.includes(field));
    assert.equal(schema.properties.typedParameters.items.additionalProperties, false);
  }
  assert.equal(schemas.HashProfile.properties.algorithm.const, 'sha256');
  assert.equal(schemas.HashProfile.properties.fullContentRequired.const, true);
});

test('accepted DTOs freeze semantic members instead of exposing arbitrary payloads', () => {
  assert.equal(schemas.CandidateDraft.properties.primaryInputManifest.$ref, 'helix://contracts/types/PrimaryInputManifest/v1');
  assert.equal(schemas.AcceptedIntakePayload.properties.candidatePackage.$ref, 'helix://contracts/types/CandidatePackage/v1');
  assert.equal(schemas.DestructionScope.properties.materialKeys.items.pattern, '^[a-f0-9]{64}$');
  for (const schema of Object.values(schemas)) {
    assert.equal(Object.hasOwn(schema.properties, 'payload'), false);
    assert.equal(schema.additionalProperties, false);
  }
});

test('projection and aggregate inputs are bounded snapshots rather than Store rows', () => {
  const entries = schemas.ActiveShelfEntryIdentityProjection.properties.entries;
  assert.equal(entries.maxItems, 4096);
  assert.equal(entries.items.additionalProperties, false);
  assert.deepEqual(new Set(entries.items.required), new Set(['objectId', 'revision', 'schemaRef', 'digest', 'objectKind']));
  assert.equal(Object.hasOwn(schemas.CurrentInventoryControl.properties, 'store'), false);
});
