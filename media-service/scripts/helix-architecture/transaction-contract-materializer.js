'use strict';

const fs = require('fs');
const path = require('path');
const { buildTransactionContracts, digestValue } = require('./transaction-contract-builder');

function readTransactionSourceEntries(contractsRoot) {
  const sourceRoot = path.join(contractsRoot, 'manifests', 'ssot-source-map');
  return fs.readdirSync(sourceRoot)
    .filter((name) => /^transactions-.*\.json$/.test(name))
    .sort()
    .flatMap((name) => JSON.parse(fs.readFileSync(path.join(sourceRoot, name), 'utf8')).entries);
}

function buildTransactionInventoryEntries(contractsRoot) {
  return buildTransactionContracts(readTransactionSourceEntries(contractsRoot)).map((contract) => {
    const relativePath = `transaction-contracts/${contract.transactionId}/v1/contract.json`;
    const summary = {
      transactionId: contract.transactionId,
      ownerScope: contract.ownerScope,
      contractRef: `helix://contracts/transactions/${contract.transactionId}/v1`,
      contractDigest: digestValue(contract)
    };
    return {
      id: contract.transactionId,
      version: 1,
      owner: contract.ownerScope === 'polymorphic-domain-owner' ? 'contracts' : contract.ownerScope,
      status: 'contracted',
      ssotRefs: ['8.5.4', '8.5.5', '8.9.7'],
      sourceLocator: contract.source,
      targetLocator: { path: relativePath },
      contract: summary,
      contractDigest: { algorithm: 'sha256', value: digestValue(summary) },
      transactionContract: contract
    };
  });
}

function materializeTransactionContracts(contractsRoot) {
  const entries = buildTransactionInventoryEntries(contractsRoot);
  for (const entry of entries) {
    const filePath = path.join(contractsRoot, entry.targetLocator.path);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify({
      schemaVersion: 1,
      contractId: entry.contract.contractRef,
      contractVersion: 1,
      contract: entry.transactionContract
    }, null, 2)}\n`);
    delete entry.transactionContract;
  }
  const inventoryRoot = path.join(contractsRoot, 'manifests', 'transaction-inventory');
  fs.mkdirSync(inventoryRoot, { recursive: true });
  for (const fileName of fs.readdirSync(inventoryRoot)) {
    if (/^entries-\d{3}-\d{3}\.json$/.test(fileName)) fs.rmSync(path.join(inventoryRoot, fileName));
  }
  const shardFile = `entries-001-${String(entries.length).padStart(3, '0')}.json`;
  const shardPath = path.join(inventoryRoot, shardFile);
  fs.writeFileSync(shardPath, `${JSON.stringify({
    schemaVersion: 1, manifestId: 'helix.inventory.canonical-transactions', entries
  }, null, 2)}\n`);
  const manifest = {
    schemaVersion: 1,
    manifestVersion: 1,
    manifestId: 'helix.inventory.canonical-transactions',
    kind: 'transaction-inventory',
    owner: 'contracts',
    status: 'active',
    ssotRefs: ['8.5.4', '8.5.5', '8.9.7'],
    targetCount: entries.length,
    entryFiles: [`transaction-inventory/${shardFile}`]
  };
  fs.writeFileSync(path.join(contractsRoot, 'manifests', 'transaction-inventory.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, entries };
}

module.exports = Object.freeze({ buildTransactionInventoryEntries, materializeTransactionContracts, readTransactionSourceEntries });
