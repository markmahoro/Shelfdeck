'use strict';
const fs = require('fs');
const path = require('path');
const { buildPlatformApplicationSchemas, schemaDigest, typeId } = require('./platform-application-schema-builder');
function materializePlatformApplicationSchemas(contractsRoot) {
  const schemas = buildPlatformApplicationSchemas();
  for (const [name, schema] of Object.entries(schemas)) {
    const directory = path.join(contractsRoot, 'application-types', name, 'v1');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'schema.json'), `${JSON.stringify(schema, null, 2)}\n`);
  }
  const entries = Object.keys(schemas).sort().map((name) => ({ id: name, version: 1, owner: 'platform-settings', status: 'contracted',
    schemaId: typeId(name), relativePath: `application-types/${name}/v1/schema.json`,
    digest: { algorithm: 'sha256', value: schemaDigest(schemas[name]) }, ssotRefs: schemas[name]['x-helix-ssotRefs'] }));
  const registry = { schemaVersion: 1, manifestVersion: 1, manifestId: 'helix.platform-application-type-registry',
    kind: 'application-type-registry', owner: 'platform-settings', status: 'active', targetCount: entries.length, entries };
  fs.writeFileSync(path.join(contractsRoot, 'platform-application-type-registry.json'), `${JSON.stringify(registry, null, 2)}\n`);
  return registry;
}
module.exports = Object.freeze({ materializePlatformApplicationSchemas });
