'use strict';

const fs = require('fs');
const path = require('path');
const { OWNER_PREFIXES, allowedForeignKey, buildTableContracts, digestValue } = require('./table-contract-builder');
const { readTableSourceEntries } = require('./table-contract-materializer');

const normalize = (value) => value.split(path.sep).join('/');
const finding = (code, message, details = {}) => ({ code, message, ...details });

function readJson(filePath, findings) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    findings.push(finding('INVALID_TABLE_CONTRACT_JSON', `Cannot read JSON: ${error.message}`, { file: normalize(filePath) }));
    return null;
  }
}

function readInventoryEntries(contractsRoot, findings) {
  const manifest = readJson(path.join(contractsRoot, 'manifests', 'table-inventory.json'), findings);
  if (!manifest || manifest.status !== 'active' || manifest.targetCount !== 163 || !Array.isArray(manifest.entryFiles)) {
    findings.push(finding('INVALID_TABLE_INVENTORY_MANIFEST', 'Table inventory must be active with 163 sharded entries.'));
    return [];
  }
  return manifest.entryFiles.flatMap((relativePath) => {
    const shard = readJson(path.join(contractsRoot, 'manifests', relativePath), findings);
    return shard && Array.isArray(shard.entries) ? shard.entries : [];
  });
}

function validateTableContracts(options) {
  const contractsRoot = path.resolve(options.contractsRoot);
  const findings = [];
  const expected = buildTableContracts(readTableSourceEntries(contractsRoot));
  const expectedById = new Map(expected.map((contract) => [contract.tableId, contract]));
  const inventoryEntries = readInventoryEntries(contractsRoot, findings);
  const ownerRegistry = readJson(path.join(contractsRoot, 'manifests', 'owner-registry.json'), findings);
  const knownOwners = new Set(ownerRegistry && ownerRegistry.owners.map((owner) => owner.id));
  const actualIds = new Set();
  const actualContracts = new Map();

  for (const entry of inventoryEntries) {
    if (!entry || actualIds.has(entry.id)) {
      findings.push(finding('DUPLICATE_TABLE_CONTRACT', 'Table contract IDs must be unique.', { tableId: entry && entry.id }));
      continue;
    }
    actualIds.add(entry.id);
    if (!knownOwners.has(entry.owner)) findings.push(finding('UNKNOWN_TABLE_OWNER', 'Table Owner is absent from the Owner registry.', { tableId: entry.id, owner: entry.owner }));
    const document = readJson(path.join(contractsRoot, entry.targetLocator && entry.targetLocator.path || ''), findings);
    if (!document || !document.contract) continue;
    const contract = document.contract;
    actualContracts.set(contract.tableId, contract);
    if (document.schemaVersion !== 1 || document.contractVersion !== 1 || document.contractId !== `helix://contracts/tables/${entry.id}/v1`) {
      findings.push(finding('INVALID_TABLE_CONTRACT_IDENTITY', 'Table contract identity/version is invalid.', { tableId: entry.id }));
    }
    if (entry.contract.contractDigest !== digestValue(contract) || entry.contractDigest.value !== digestValue(entry.contract) ||
        !expectedById.has(entry.id) || digestValue(contract) !== digestValue(expectedById.get(entry.id))) {
      findings.push(finding('TABLE_CONTRACT_DRIFT', 'Committed table contract differs from the SSOT-derived contract.', { tableId: entry.id }));
    }
    if (!OWNER_PREFIXES[contract.owner] || !OWNER_PREFIXES[contract.owner].includes(contract.prefix)) findings.push(finding(
      'TABLE_OWNER_PREFIX_MISMATCH', 'Table prefix is incompatible with its sole Owner.', { tableId: entry.id, owner: contract.owner, prefix: contract.prefix }
    ));
    if (!Array.isArray(contract.primaryKey) || contract.primaryKey.length === 0) findings.push(finding('MISSING_TABLE_PRIMARY_KEY', 'Every canonical table requires a primary key.', { tableId: entry.id }));
    for (const column of contract.columns || []) {
      if (/(?:^|_)(?:state|status)$/.test(column.name) && column.logicalType !== 'INTEGER_BOOLEAN' &&
          (!Array.isArray(column.enumValues) || column.enumValues.length === 0)) {
        findings.push(finding('UNBOUNDED_TABLE_STATE', 'Every state/status column requires an explicit enum.', { tableId: entry.id, column: column.name }));
      }
      if (column.name.endsWith('_id') && column.logicalType !== 'TEXT') findings.push(finding(
        'INVALID_IDENTITY_COLUMN_TYPE', 'Opaque identity columns require TEXT.', { tableId: entry.id, column: column.name }
      ));
      if (/(?:_at_ms|_ms|_ns)$/.test(column.name) && column.logicalType !== 'INTEGER') findings.push(finding(
        'INVALID_TIME_COLUMN_TYPE', 'UTC epoch time columns require INTEGER.', { tableId: entry.id, column: column.name }
      ));
      if ((column.name.endsWith('_digest') || column.name === 'digest' || column.name.endsWith('digest_hex')) && column.logicalType !== 'TEXT') {
        findings.push(finding('INVALID_DIGEST_COLUMN_TYPE', 'SHA-256 digest columns require TEXT.', { tableId: entry.id, column: column.name }));
      }
    }
    for (const foreignKey of contract.foreignKeys || []) {
      const target = actualContracts.get(foreignKey.targetTable) || expectedById.get(foreignKey.targetTable);
      if (!foreignKey.targetTable || !target) findings.push(finding('UNRESOLVED_TABLE_FOREIGN_KEY', 'Declared FK target is unresolved.', {
        tableId: entry.id, columns: foreignKey.columns
      }));
      else if (!allowedForeignKey(contract.owner, target.owner)) findings.push(finding('ILLEGAL_TABLE_FOREIGN_KEY_DIRECTION', 'FK crosses an Owner boundary forbidden by SSOT.', {
        tableId: entry.id, owner: contract.owner, targetTable: target.tableId, targetOwner: target.owner
      }));
      if (foreignKey.deletePolicy !== 'RESTRICT') findings.push(finding('INVALID_TABLE_DELETE_POLICY', 'Canonical FKs require RESTRICT delete policy.', { tableId: entry.id }));
    }
    for (const json of contract.jsonContracts || []) {
      if (!json.schemaRefColumn || !contract.columns.some((column) => column.name === json.schemaRefColumn)) findings.push(finding(
        'JSON_SCHEMA_REF_MISSING', 'Every JSON column requires a fixed schema_ref column.', { tableId: entry.id, column: json.column }
      ));
      if (![4 * 1024, 16 * 1024, 64 * 1024].includes(json.maxBytes) || json.requiresJsonValidCheck !== true) findings.push(finding(
        'INVALID_JSON_COLUMN_CONTRACT', 'JSON columns require json_valid and a 4/16/64 KiB byte limit.', { tableId: entry.id, column: json.column }
      ));
    }
    const coveredPointers = new Set();
    for (const pointer of contract.revisionContract.pointerTargets || []) {
      const target = actualContracts.get(pointer.targetTable) || expectedById.get(pointer.targetTable);
      [...pointer.sourceColumns, ...(pointer.consistencyColumns || [])].forEach((column) => coveredPointers.add(column));
      if (!pointer.sourceColumns.every((column) => contract.columns.some((candidate) => candidate.name === column)) ||
          !target || !pointer.targetColumns.every((column) => target.columns.some((candidate) => candidate.name === column))) {
        findings.push(finding('UNRESOLVED_CURRENT_POINTER', 'Current revision pointer columns or target are unresolved.', {
          tableId: entry.id, targetTable: pointer.targetTable
        }));
      } else if (!allowedForeignKey(contract.owner, target.owner)) findings.push(finding(
        'ILLEGAL_TABLE_FOREIGN_KEY_DIRECTION', 'Current pointer crosses an Owner boundary forbidden by SSOT.', {
          tableId: entry.id, owner: contract.owner, targetTable: target.tableId, targetOwner: target.owner
        }
      ));
      if (pointer.deletePolicy !== 'RESTRICT') findings.push(finding('INVALID_TABLE_DELETE_POLICY', 'Current pointers require RESTRICT delete policy.', {
        tableId: entry.id, targetTable: pointer.targetTable
      }));
    }
    for (const pointerColumn of contract.revisionContract.currentPointerColumns || []) {
      if (!coveredPointers.has(pointerColumn)) findings.push(finding('UNRESOLVED_CURRENT_POINTER', 'Current revision column lacks an explicit target.', {
        tableId: entry.id, column: pointerColumn
      }));
    }
    if (contract.deletion.foreignKeyPolicy !== 'ON DELETE RESTRICT') findings.push(finding(
      'INVALID_TABLE_DELETE_POLICY', 'Canonical table contract lost the global ON DELETE RESTRICT rule.', { tableId: entry.id }
    ));
  }

  for (const expectedId of expectedById.keys()) {
    if (!actualIds.has(expectedId)) findings.push(finding('MISSING_TABLE_CONTRACT', 'SSOT table is absent from the inventory.', { tableId: expectedId }));
  }
  for (const actualId of actualIds) {
    if (!expectedById.has(actualId)) findings.push(finding('UNREGISTERED_TABLE_CONTRACT', 'Table is outside the SSOT inventory.', { tableId: actualId }));
  }

  return {
    ok: findings.length === 0,
    tableCount: actualIds.size,
    ownerCounts: Object.fromEntries([...knownOwners].map((owner) => [owner, [...actualContracts.values()].filter((contract) => contract.owner === owner).length])
      .filter(([, count]) => count > 0)),
    foreignKeyCount: [...actualContracts.values()].reduce((sum, contract) => sum + contract.foreignKeys.length, 0),
    jsonColumnCount: [...actualContracts.values()].reduce((sum, contract) => sum + contract.jsonContracts.length, 0),
    inventoryDigest: digestValue(inventoryEntries),
    findings
  };
}

module.exports = Object.freeze({ validateTableContracts });
