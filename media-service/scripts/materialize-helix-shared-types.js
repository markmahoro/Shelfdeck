'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildSharedTypeSchemas, schemaDigest } = require('./helix-architecture/shared-type-schema-builder');

const serviceRoot = path.resolve(__dirname, '..');
const contractsRoot = path.join(serviceRoot, 'src', 'helix', 'contracts');
const registryPath = path.join(contractsRoot, 'shared-type-registry.json');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const schemas = buildSharedTypeSchemas();

for (const entry of registry.entries) {
  const schema = schemas[entry.id];
  if (!schema) throw new Error(`Missing shared type builder: ${entry.id}`);
  const schemaPath = path.join(contractsRoot, entry.relativePath);
  fs.mkdirSync(path.dirname(schemaPath), { recursive: true });
  fs.writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);
  entry.digest = { algorithm: 'sha256', value: schemaDigest(schema) };
}
registry.targetCount = registry.entries.length;
fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ entryCount: registry.entries.length }, null, 2)}\n`);
