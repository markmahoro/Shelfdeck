'use strict';

const { canonicalDigest } = require('../../contracts/canonical-json');

function schemaClosure(manifest, schemas) {
  const visited = new Map();
  function visit(reference) {
    const id = reference.split('#')[0];
    if (!id || visited.has(id)) return;
    const schema = schemas.get(id);
    if (!schema) throw new Error('Catalog schema dependency is absent: ' + id);
    visited.set(id, canonicalDigest(schema));
    function walk(value) {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (key === '$ref' || key === '$dynamicRef') {
          if (typeof child !== 'string') throw new Error('Invalid schema reference.');
          if (!child.startsWith('#')) {
            if (!child.startsWith('helix://')) throw new Error('Unresolved non-nominal schema dependency.');
            visit(child);
          }
        } else walk(child);
      }
    }
    walk(schema);
  }
  for (const port of Object.values(manifest.inputPorts)) visit(port.schemaRef);
  for (const evidence of manifest.preboundEvidenceContracts || []) visit(evidence.schemaRef);
  for (const [key, value] of Object.entries(manifest)) {
    if (key.endsWith('SchemaRef') && typeof value === 'string') visit(value);
  }
  return Object.fromEntries([...visited.entries()].sort(([a], [b]) => a.localeCompare(b, 'en')));
}

module.exports = Object.freeze({ schemaClosure });
