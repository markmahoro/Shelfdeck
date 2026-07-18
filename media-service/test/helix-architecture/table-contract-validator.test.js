'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { validateTableContracts } = require('../../scripts/helix-architecture/table-contract-validator');

const actualContractsRoot = path.resolve(__dirname, '../../src/helix/contracts');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-table-contracts-'));
  fs.cpSync(actualContractsRoot, root, { recursive: true });
  return root;
}

function mutate(filePath, change) {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  change(value);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

const contractPath = (root, tableId) => path.join(root, 'table-contracts', tableId, 'v1', 'contract.json');
const codes = (result) => new Set(result.findings.map((item) => item.code));

test('validates all 161 SSOT table contracts without executing DDL', () => {
  const result = validateTableContracts({ contractsRoot: actualContractsRoot });
  assert.equal(result.ok, true);
  assert.equal(result.tableCount, 161);
  assert.equal(result.foreignKeyCount, 169);
  assert.equal(result.jsonColumnCount, 35);
});

test('rejects missing PK, open JSON contract, and unresolved current pointer', () => {
  const root = fixture();
  try {
    mutate(contractPath(root, 'fx_plan_nodes'), (document) => {
      document.contract.primaryKey = [];
      document.contract.jsonContracts[0].maxBytes = null;
    });
    mutate(contractPath(root, 'fx_workflow_events'), (document) => {
      document.contract.revisionContract.pointerTargets[0].targetTable = 'proc_missing_progress';
    });
    const result = validateTableContracts({ contractsRoot: root });
    const resultCodes = codes(result);
    assert.ok(resultCodes.has('MISSING_TABLE_PRIMARY_KEY'));
    assert.ok(resultCodes.has('INVALID_JSON_COLUMN_CONTRACT'));
    assert.ok(resultCodes.has('UNRESOLVED_CURRENT_POINTER'));
    assert.ok(resultCodes.has('TABLE_CONTRACT_DRIFT'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects unbounded state and invalid identity, time, or digest types', () => {
  const root = fixture();
  try {
    mutate(contractPath(root, 'fx_supporting_works'), (document) => {
      document.contract.columns.find((column) => column.name === 'state').enumValues = [];
      document.contract.columns.find((column) => column.name === 'work_id').logicalType = 'INTEGER';
      document.contract.columns.find((column) => column.name === 'created_at_ms').logicalType = 'TEXT';
      document.contract.columns.find((column) => column.name === 'basis_digest').logicalType = 'INTEGER';
    });
    const result = validateTableContracts({ contractsRoot: root });
    assert.equal(result.ok, false);
    assert.ok(result.findings.some((item) => item.code === 'UNBOUNDED_TABLE_STATE'));
    assert.ok(result.findings.some((item) => item.code === 'INVALID_IDENTITY_COLUMN_TYPE'));
    assert.ok(result.findings.some((item) => item.code === 'INVALID_TIME_COLUMN_TYPE'));
    assert.ok(result.findings.some((item) => item.code === 'INVALID_DIGEST_COLUMN_TYPE'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects Owner/prefix drift and forbidden Foundation to Domain FK', () => {
  const root = fixture();
  try {
    mutate(contractPath(root, 'fx_supporting_works'), (document) => {
      document.contract.owner = 'libra';
      document.contract.foreignKeys.push({
        columns: ['process_id'], targetTable: 'arca_shelf_entries', targetColumns: ['shelf_entry_id'], deletePolicy: 'RESTRICT'
      });
    });
    const result = validateTableContracts({ contractsRoot: root });
    const resultCodes = codes(result);
    assert.ok(resultCodes.has('TABLE_OWNER_PREFIX_MISMATCH'));
    assert.ok(resultCodes.has('ILLEGAL_TABLE_FOREIGN_KEY_DIRECTION'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects duplicate inventory IDs', () => {
  const root = fixture();
  try {
    const shardPath = path.join(root, 'manifests', 'table-inventory', 'entries-001-013.json');
    mutate(shardPath, (shard) => {
      shard.entries[1].id = shard.entries[0].id;
    });
    const result = validateTableContracts({ contractsRoot: root });
    assert.ok(codes(result).has('DUPLICATE_TABLE_CONTRACT'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
