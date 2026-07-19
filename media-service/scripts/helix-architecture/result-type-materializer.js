'use strict';

const fs = require('fs');
const path = require('path');
const { buildResultTypeSchemas, schemaDigest, typeId } = require('./result-type-schema-builder');

const HELPER_SOURCES = {
  OnDeckCommitReceipt: { section: '8.6.19', line: 8009 },
  OffloadCompletionFact: { section: '8.6.19', line: 8010 },
  PeopleCandidateDraft: { section: '8.6.19', line: 8033 },
  PrimaryInputManifest: { section: '8.6.19', line: 8932 },
  SeasonContinuityClaim: { section: '8.6.18', line: 8722 },
  CandidateIntakeAcceptanceBasis: { section: '8.6.18', line: 8727 },
  ProcurementCandidateOfferAvailableMessage: { section: '8.6.18', line: 8728 },
  LibraCandidateAcceptedMessage: { section: '8.6.18', line: 8789 },
  ProcurementCandidateAcceptanceClosureResult: { section: '8.6.18', line: 8887 },
  LibraCandidateRejectedMessage: { section: '8.6.18', line: 8791 },
  ProcurementCandidateRejectionClosureResult: { section: '8.6.18', line: 8792 }
};

function readResultSourceEntries(contractsRoot) {
  const mapRoot = path.join(contractsRoot, 'manifests', 'ssot-source-map');
  return fs.readdirSync(mapRoot)
    .filter((name) => /^result-families-.*\.json$/.test(name))
    .sort()
    .flatMap((name) => JSON.parse(fs.readFileSync(path.join(mapRoot, name), 'utf8')).entries);
}

function buildResultTypeRegistry(contractsRoot) {
  const schemas = buildResultTypeSchemas();
  const sourceEntries = readResultSourceEntries(contractsRoot);
  const sources = new Map(sourceEntries.map((entry) => [entry.id, entry.source]));
  const entries = Object.keys(schemas).sort().map((name) => ({
    id: name,
    version: 1,
    role: sources.has(name) ? 'catalog-result' : 'result-helper',
    schemaId: typeId(name),
    relativePath: `types/${name}/v1/schema.json`,
    digest: { algorithm: 'sha256', value: schemaDigest(schemas[name]) },
    source: sources.get(name) || HELPER_SOURCES[name]
  }));
  return {
    schemaVersion: 1,
    manifestVersion: 1,
    manifestId: 'helix.result-type-registry',
    kind: 'result-type-registry',
    owner: 'contracts',
    status: 'active',
    targetCatalogResultCount: 86,
    helperCount: 11,
    entries
  };
}

function buildResultInventory(contractsRoot) {
  return readResultSourceEntries(contractsRoot).map((sourceEntry) => {
    const schemaPath = `types/${sourceEntry.id}/v1/schema.json`;
    const contract = {
      resultKind: sourceEntry.kind,
      schemaId: typeId(sourceEntry.id),
      schemaPath,
      producedBy: sourceEntry.producedBy,
      sourceSection: sourceEntry.source.section
    };
    return {
      id: sourceEntry.id,
      version: 1,
      owner: 'contracts',
      status: 'contracted',
      ssotRefs: [sourceEntry.source.section],
      sourceLocator: sourceEntry.source,
      targetLocator: { path: schemaPath },
      contract,
      contractDigest: { algorithm: 'sha256', value: schemaDigest(contract) }
    };
  });
}

function materializeResultTypes(contractsRoot) {
  const schemas = buildResultTypeSchemas();
  for (const [name, schema] of Object.entries(schemas)) {
    const directory = path.join(contractsRoot, 'types', name, 'v1');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'schema.json'), `${JSON.stringify(schema, null, 2)}\n`);
  }
  const registry = buildResultTypeRegistry(contractsRoot);
  fs.writeFileSync(path.join(contractsRoot, 'result-type-registry.json'), `${JSON.stringify(registry, null, 2)}\n`);
  const inventoryEntries = buildResultInventory(contractsRoot);
  const inventoryRoot = path.join(contractsRoot, 'manifests', 'result-family-inventory');
  fs.mkdirSync(inventoryRoot, { recursive: true });
  const entryFiles = [];
  for (let start = 0; start < inventoryEntries.length; start += 24) {
    const end = Math.min(start + 24, inventoryEntries.length);
    const fileName = `entries-${String(start + 1).padStart(3, '0')}-${String(end).padStart(3, '0')}.json`;
    entryFiles.push(`result-family-inventory/${fileName}`);
    fs.writeFileSync(path.join(inventoryRoot, fileName), `${JSON.stringify({
      schemaVersion: 1, manifestId: 'helix.inventory.result-families', entries: inventoryEntries.slice(start, end)
    }, null, 2)}\n`);
  }
  fs.writeFileSync(path.join(contractsRoot, 'manifests', 'result-family-inventory.json'), `${JSON.stringify({
    schemaVersion: 1,
    manifestVersion: 1,
    manifestId: 'helix.inventory.result-families',
    kind: 'result-family-inventory',
    owner: 'contracts',
    status: 'active',
    ssotRefs: ['7.7', '8.2.1', '8.6.18', '8.6.19', '8.9.5'],
    targetCount: 97,
    entryFiles
  }, null, 2)}\n`);
  return registry;
}

module.exports = Object.freeze({ buildResultInventory, buildResultTypeRegistry, materializeResultTypes, readResultSourceEntries });
