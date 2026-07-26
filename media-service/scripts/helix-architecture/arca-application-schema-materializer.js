'use strict';

const fs = require('fs');
const path = require('path');
const {
  buildArcaApplicationSchemas,
  schemaDigest,
  typeId,
} = require('./arca-application-schema-builder');

function materializeArcaApplicationSchemas(contractsRoot) {
  const schemas = buildArcaApplicationSchemas();
  const root = path.join(contractsRoot, 'application-types');
  for (const [name, schema] of Object.entries(schemas)) {
    const directory = path.join(root, name, 'v1');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'schema.json'),
      `${JSON.stringify(schema, null, 2)}\n`);
  }
  const entries = Object.keys(schemas).sort().map((name) => ({
    id: name,
    version: 1,
    owner: 'arca',
    status: 'contracted',
    schemaId: typeId(name),
    relativePath: `application-types/${name}/v1/schema.json`,
    digest: { algorithm: 'sha256', value: schemaDigest(schemas[name]) },
    ssotRefs: schemas[name]['x-helix-ssotRefs'],
  }));
  const registry = {
    schemaVersion: 1,
    manifestVersion: 1,
    manifestId: 'helix.arca-application-type-registry',
    kind: 'application-type-registry',
    owner: 'arca',
    status: 'active',
    targetCount: entries.length,
    entries,
  };
  fs.writeFileSync(
    path.join(contractsRoot, 'arca-application-type-registry.json'),
    `${JSON.stringify(registry, null, 2)}\n`,
  );
  return registry;
}

module.exports = Object.freeze({ materializeArcaApplicationSchemas });
