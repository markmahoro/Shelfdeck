'use strict';

const fs = require('fs');
const path = require('path');
const { extractSsotContracts } = require('./ssot-contract-extractor');
const { buildCapabilityPackages } = require('./capability-contract-builder');
const { buildDomainInputSchemas, domainTypeId, schemaDigest } = require('./domain-input-schema-builder');

function collectDomainRefs(node, refs = new Map(), capability) {
  if (!node || typeof node !== 'object') return refs;
  if (typeof node.$ref === 'string' && node.$ref.startsWith('helix://contracts/domain-types/')) {
    const name = node.$ref.split('/').at(-2);
    if (!refs.has(name)) refs.set(name, []);
    refs.get(name).push({
      capabilityRef: capability.capabilityRef,
      source: capability.files['manifest.json'].sourceLocator,
      typeExpression: node['x-helix-typeExpression'] || null
    });
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((item) => collectDomainRefs(item, refs, capability));
    else if (value && typeof value === 'object') collectDomainRefs(value, refs, capability);
  }
  return refs;
}

function expectedUsages(repositoryRoot) {
  const ssotPath = process.env.HELIX_SSOT_PATH || path.join(repositoryRoot, 'docs', 'helix', 'TOP_DOWN_ARCHITECTURE_CONFIRMATION.md');
  const ssot = fs.readFileSync(ssotPath, 'utf8');
  const packages = buildCapabilityPackages(extractSsotContracts(ssot).capabilities);
  const usages = new Map();
  for (const capability of packages) collectDomainRefs(capability.files['inputs.schema.json'], usages, capability);
  const schemas = buildDomainInputSchemas();
  const nestedRefs = new Map();
  for (const [name, schema] of Object.entries(schemas)) {
    const refs = new Set();
    (function collect(node) {
      if (!node || typeof node !== 'object') return;
      if (typeof node.$ref === 'string' && node.$ref.startsWith('helix://contracts/domain-types/')) {
        refs.add(node.$ref.split('/').at(-2));
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(collect);
        else if (value && typeof value === 'object') collect(value);
      }
    }(schema));
    nestedRefs.set(name, refs);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [parent, refs] of nestedRefs) {
      const parentUsages = usages.get(parent) || [];
      for (const ref of refs) {
        if (!usages.has(ref)) usages.set(ref, []);
        const target = usages.get(ref);
        for (const usage of parentUsages) {
          if (!target.some((item) => item.capabilityRef === usage.capabilityRef)) {
            target.push(usage);
            changed = true;
          }
        }
      }
    }
  }
  for (const values of usages.values()) values.sort((left, right) => left.capabilityRef.localeCompare(right.capabilityRef));
  return usages;
}

function buildDomainInputRegistry({ contractsRoot, repositoryRoot }) {
  const schemas = buildDomainInputSchemas();
  const usages = expectedUsages(repositoryRoot);
  return {
    schemaVersion: 1,
    manifestVersion: 1,
    manifestId: 'helix.domain-input-type-registry',
    kind: 'domain-input-type-registry',
    owner: 'contracts',
    status: 'active',
    targetCount: Object.keys(schemas).length,
    ssotRefs: ['8.6.3', '8.6.14', '8.6.20'],
    entries: Object.keys(schemas).sort().map((name) => ({
      id: name,
      version: 1,
      role: schemas[name]['x-helix-role'],
      schemaId: domainTypeId(name),
      relativePath: `domain-types/${name}/v1/schema.json`,
      digest: { algorithm: 'sha256', value: schemaDigest(schemas[name]) },
      usedBy: usages.get(name) || []
    }))
  };
}

function materializeDomainInputs({ contractsRoot, repositoryRoot }) {
  const schemas = buildDomainInputSchemas();
  const domainTypesRoot = path.join(contractsRoot, 'domain-types');
  if (fs.existsSync(domainTypesRoot)) {
    for (const entry of fs.readdirSync(domainTypesRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && !Object.hasOwn(schemas, entry.name)) fs.rmSync(path.join(domainTypesRoot, entry.name), { recursive: true });
    }
  }
  for (const [name, schema] of Object.entries(schemas)) {
    const directory = path.join(contractsRoot, 'domain-types', name, 'v1');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'schema.json'), `${JSON.stringify(schema, null, 2)}\n`);
  }
  const registry = buildDomainInputRegistry({ contractsRoot, repositoryRoot });
  fs.writeFileSync(path.join(contractsRoot, 'domain-input-type-registry.json'), `${JSON.stringify(registry, null, 2)}\n`);
  return registry;
}

module.exports = Object.freeze({ buildDomainInputRegistry, expectedUsages, materializeDomainInputs });
