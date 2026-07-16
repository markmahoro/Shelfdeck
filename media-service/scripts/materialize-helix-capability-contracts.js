'use strict';

const fs = require('fs');
const path = require('path');
const { extractSsotContracts } = require('./helix-architecture/ssot-contract-extractor');
const { buildCapabilityPackages, digestValue } = require('./helix-architecture/capability-contract-builder');

const serviceRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(serviceRoot, '..');
const contractsRoot = path.join(serviceRoot, 'src', 'helix', 'contracts');
const ssot = fs.readFileSync(path.join(repositoryRoot, 'docs', 'helix', 'TOP_DOWN_ARCHITECTURE_CONFIRMATION.md'), 'utf8');
const packages = buildCapabilityPackages(extractSsotContracts(ssot).capabilities);
const packageById = new Map(packages.map((item) => [item.capabilityRef, item]));

for (const item of packages) {
  const directory = path.join(contractsRoot, item.relativePath);
  fs.mkdirSync(directory, { recursive: true });
  for (const [name, value] of Object.entries(item.files)) {
    fs.writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
  }
}

const inventoryRoot = path.join(contractsRoot, 'manifests', 'capability-inventory');
for (const fileName of fs.readdirSync(inventoryRoot).filter((name) => name.endsWith('.json'))) {
  const filePath = path.join(inventoryRoot, fileName);
  const shard = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  for (const entry of shard.entries) {
    const item = packageById.get(entry.id);
    if (!item) throw new Error(`Inventory entry is not in the SSOT Catalog: ${entry.id}`);
    entry.contract.packageDigest = item.packageDigest;
    entry.contractDigest = { algorithm: 'sha256', value: digestValue(entry.contract) };
  }
  fs.writeFileSync(filePath, `${JSON.stringify(shard, null, 2)}\n`);
}

process.stdout.write(`${JSON.stringify({ packageCount: packages.length }, null, 2)}\n`);
