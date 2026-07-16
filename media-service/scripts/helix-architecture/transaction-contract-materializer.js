'use strict';

const fs = require('fs');
const path = require('path');
const { buildTransactionContracts, digestValue } = require('./transaction-contract-builder');

function readTransactionSourceEntries(contractsRoot) {
  const filePath = path.join(contractsRoot, 'manifests', 'ssot-source-map', 'transactions-001-018.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf8')).entries;
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
  const shardPath = path.join(contractsRoot, 'manifests', 'transaction-inventory', 'entries-001-018.json');
  fs.mkdirSync(path.dirname(shardPath), { recursive: true });
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
    targetCount: 18,
    entryFiles: ['transaction-inventory/entries-001-018.json']
  };
  fs.writeFileSync(path.join(contractsRoot, 'manifests', 'transaction-inventory.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, entries };
}

module.exports = Object.freeze({ buildTransactionInventoryEntries, materializeTransactionContracts, readTransactionSourceEntries });
