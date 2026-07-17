'use strict';

const fs = require('fs');
const path = require('path');
const { buildTableContracts, digestValue } = require('./table-contract-builder');

function readTableSourceEntries(contractsRoot) {
  const sourceRoot = path.join(contractsRoot, 'manifests', 'ssot-source-map');
  return fs.readdirSync(sourceRoot)
    .filter((name) => /^tables-.*\.json$/.test(name))
    .sort()
    .flatMap((name) => JSON.parse(fs.readFileSync(path.join(sourceRoot, name), 'utf8')).entries);
}

function buildTableInventoryEntries(contractsRoot) {
  return buildTableContracts(readTableSourceEntries(contractsRoot)).map((contract) => {
    const relativePath = `table-contracts/${contract.tableId}/v1/contract.json`;
    const summary = {
      tableId: contract.tableId,
      owner: contract.owner,
      contractRef: `helix://contracts/tables/${contract.tableId}/v1`,
      contractDigest: digestValue(contract)
    };
    return {
      id: contract.tableId,
      version: 1,
      owner: contract.owner,
      status: 'contracted',
      ssotRefs: ['8.5.9', contract.source.section],
      sourceLocator: contract.source,
      targetLocator: { path: relativePath },
      contract: summary,
      contractDigest: { algorithm: 'sha256', value: digestValue(summary) },
      tableContract: contract
    };
  });
}

function materializeTableContracts(contractsRoot) {
  const entries = buildTableInventoryEntries(contractsRoot);
  for (const entry of entries) {
    const filePath = path.join(contractsRoot, entry.targetLocator.path);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify({
      schemaVersion: 1,
      contractId: entry.contract.contractRef,
      contractVersion: 1,
      contract: entry.tableContract
    }, null, 2)}\n`);
    delete entry.tableContract;
  }

  const inventoryRoot = path.join(contractsRoot, 'manifests', 'table-inventory');
  fs.mkdirSync(inventoryRoot, { recursive: true });
  for (const fileName of fs.readdirSync(inventoryRoot)) {
    if (/^entries-\d{3}-\d{3}\.json$/.test(fileName)) fs.rmSync(path.join(inventoryRoot, fileName));
  }
  const entryFiles = [];
  for (let start = 0; start < entries.length; start += 13) {
    const end = Math.min(start + 13, entries.length);
    const fileName = `entries-${String(start + 1).padStart(3, '0')}-${String(end).padStart(3, '0')}.json`;
    entryFiles.push(`table-inventory/${fileName}`);
    fs.writeFileSync(path.join(inventoryRoot, fileName), `${JSON.stringify({
      schemaVersion: 1, manifestId: 'helix.inventory.tables', entries: entries.slice(start, end)
    }, null, 2)}\n`);
  }
  const manifest = {
    schemaVersion: 1,
    manifestVersion: 1,
    manifestId: 'helix.inventory.tables',
    kind: 'table-inventory',
    owner: 'contracts',
    status: 'active',
    ssotRefs: ['8.5.9', '8.5.10', '8.5.11', '8.5.12', '8.5.13'],
    targetCount: entries.length,
    entryFiles
  };
  fs.writeFileSync(path.join(contractsRoot, 'manifests', 'table-inventory.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, entries };
}

module.exports = Object.freeze({ buildTableInventoryEntries, materializeTableContracts, readTableSourceEntries });
