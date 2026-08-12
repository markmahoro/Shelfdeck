'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildPlatformApplicationSchemas, schemaDigest, typeId } = require('../../scripts/helix-architecture/platform-application-schema-builder');
const root = path.resolve(__dirname, '../../src/helix/contracts');
test('materializes all pathless Platform Workspace and Compute runtime schemas reproducibly', () => {
  const schemas = buildPlatformApplicationSchemas();
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'platform-application-type-registry.json'), 'utf8'));
  assert.equal(registry.targetCount, 9);
  for (const [name, schema] of Object.entries(schemas)) {
    const stored = JSON.parse(fs.readFileSync(path.join(root, 'application-types', name, 'v1/schema.json'), 'utf8'));
    assert.deepEqual(stored, schema);
    const entry = registry.entries.find((item) => item.id === name);
    assert.equal(entry.schemaId, typeId(name));
    assert.equal(entry.digest.value, schemaDigest(schema));
  }
});
test('public Platform Workspace schemas never expose a resolved path', () => {
  const serialized = JSON.stringify(buildPlatformApplicationSchemas());
  for (const forbidden of ['resolvedRoot', 'resolved_root', 'workspacePath']) assert.equal(serialized.includes(forbidden), false);
  const evidence = buildPlatformApplicationSchemas().WorkspaceSpaceAdmissionEvidence;
  assert.deepEqual(evidence.properties.result.enum,
    ['admitted', 'insufficient_space', 'root_unavailable', 'demand_out_of_range']);
});
