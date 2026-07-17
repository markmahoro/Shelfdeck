'use strict';

const fs = require('fs');
const path = require('path');
const { extractSsotContracts } = require('./helix-architecture/ssot-contract-extractor');
const { buildCapabilityPackages, digestValue } = require('./helix-architecture/capability-contract-builder');

const serviceRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(serviceRoot, '..');
const contractsRoot = path.join(serviceRoot, 'src', 'helix', 'contracts');
const ssotPath = process.env.HELIX_SSOT_PATH || path.join(repositoryRoot, 'docs', 'helix', 'TOP_DOWN_ARCHITECTURE_CONFIRMATION.md');
const ssot = fs.readFileSync(ssotPath, 'utf8');
const extracted = extractSsotContracts(ssot);
const packages = buildCapabilityPackages(extracted.capabilities);
const packageById = new Map(packages.map((item) => [item.capabilityRef, item]));
const capabilityById = new Map(extracted.capabilities.map((item) => [item.id, item]));

const capabilitiesRoot = path.join(contractsRoot, 'capabilities');
for (const manifestPath of fs.readdirSync(capabilitiesRoot, { recursive: true })
  .filter((name) => name.endsWith(`${path.sep}manifest.json`) || name === 'manifest.json')) {
  const absolutePath = path.join(capabilitiesRoot, manifestPath);
  const manifest = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  if (!packageById.has(manifest.capabilityRef)) fs.rmSync(path.dirname(absolutePath), { recursive: true, force: true });
}

for (const item of packages) {
  const directory = path.join(contractsRoot, item.relativePath);
  fs.mkdirSync(directory, { recursive: true });
  for (const [name, value] of Object.entries(item.files)) {
    fs.writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
  }
}

const inventoryRoot = path.join(contractsRoot, 'manifests', 'capability-inventory');
for (const fileName of fs.readdirSync(inventoryRoot).filter((name) => name.endsWith('.json'))) {
  fs.rmSync(path.join(inventoryRoot, fileName));
}
const entries = packages.map((item) => {
  const capability = capabilityById.get(item.capabilityRef);
  const contract = {
    packagePath: item.relativePath,
    packageDigest: item.packageDigest,
    effectClass: capability.effectClass,
    inputSummary: capability.inputSummary,
    outputFamily: capability.outputFamily
  };
  return {
    id: item.capabilityRef,
    version: 1,
    owner: capability.owner,
    status: 'contracted',
    ssotRefs: [capability.source.section],
    sourceLocator: capability.source,
    targetLocator: { path: `${item.relativePath}/manifest.json` },
    contract,
    contractDigest: { algorithm: 'sha256', value: digestValue(contract) }
  };
});
for (let start = 0; start < entries.length; start += 28) {
  const end = Math.min(start + 28, entries.length);
  const fileName = `entries-${String(start + 1).padStart(3, '0')}-${String(end).padStart(3, '0')}.json`;
  fs.writeFileSync(path.join(inventoryRoot, fileName), `${JSON.stringify({
    schemaVersion: 1,
    manifestId: 'helix.inventory.capabilities',
    entries: entries.slice(start, end)
  }, null, 2)}\n`);
}

process.stdout.write(`${JSON.stringify({ packageCount: packages.length }, null, 2)}\n`);
