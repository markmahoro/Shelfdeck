'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { validateTransactionContracts } = require('../../scripts/helix-architecture/transaction-contract-validator');

const actualContractsRoot = path.resolve(__dirname, '../../src/helix/contracts');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-transaction-contracts-'));
  fs.cpSync(actualContractsRoot, root, { recursive: true });
  return root;
}

function mutate(filePath, change) {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  change(value);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

const transactionPath = (root, id) => path.join(root, 'transaction-contracts', id, 'v1', 'contract.json');
const codes = (result) => new Set(result.findings.map((item) => item.code));

test('validates all canonical transaction participants and crash contracts', () => {
  const result = validateTransactionContracts({ contractsRoot: actualContractsRoot });
  assert.equal(result.ok, true);
  assert.equal(result.transactionCount, 44);
  assert.equal(result.responsibilityControlCount, 12);
  assert.equal(result.crashFixtureBindingCount, 45);
});

test('rejects upstream Store writes and missing Control CAS participation', () => {
  const root = fixture();
  try {
    const id = 'helix.transaction.handoff-a-accepted';
    mutate(transactionPath(root, id), (document) => {
      document.contract.writeTables.push('proc_candidate_packages');
      document.contract.participants[0].tables.push('proc_candidate_packages');
      document.contract.writeTables = document.contract.writeTables.filter((table) => table !== 'fx_material_control_revisions');
    });
    const result = validateTransactionContracts({ contractsRoot: root });
    assert.ok(codes(result).has('UPSTREAM_STORE_WRITE'));
    assert.ok(codes(result).has('ILLEGAL_TRANSACTION_WRITE_OWNER'));
    assert.ok(codes(result).has('MATERIAL_CONTROL_PARTICIPANT_MISMATCH'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects Case creation inside batch intent and a destructive Deregistration path', () => {
  const root = fixture();
  try {
    mutate(transactionPath(root, 'helix.transaction.off-deck-batch-authorization-intent'), (document) => {
      document.contract.writeTables.push('arca_offdeck_cases');
      document.contract.participants[0].tables.push('arca_offdeck_cases');
    });
    mutate(transactionPath(root, 'helix.transaction.shelf-deregistration-commit'), (document) => {
      document.contract.forbiddenCapabilities = [];
    });
    const result = validateTransactionContracts({ contractsRoot: root });
    assert.ok(codes(result).has('FORBIDDEN_TRANSACTION_WRITE'));
    assert.ok(codes(result).has('DEREGISTRATION_DELETE_PATH_PRESENT'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects duplicate transaction inventory identities', () => {
  const root = fixture();
  try {
    mutate(path.join(root, 'manifests', 'transaction-inventory', 'entries-001-044.json'), (shard) => {
      shard.entries[1].id = shard.entries[0].id;
    });
    const result = validateTransactionContracts({ contractsRoot: root });
    assert.ok(codes(result).has('DUPLICATE_TRANSACTION_CONTRACT'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects Product Fact selector, Outbox, participant, and crash override drift', () => {
  const root = fixture();
  try {
    mutate(transactionPath(root, 'helix.transaction.domain-fact-commit'), (document) => {
      const variants = document.contract.variants;
      variants[1].selector = { ...variants[0].selector };
      variants[0].writeTables.push('fx_outbox');
      variants[0].participants[0].tables = variants[0].participants[0].tables
        .filter((table) => table !== 'libra_product_fact_revisions');
      variants[0].crashFixtures = [];
    });
    const result = validateTransactionContracts({ contractsRoot: root });
    assert.ok(codes(result).has('INVALID_TRANSACTION_VARIANT_SELECTOR'));
    assert.ok(codes(result).has('UNOWNED_TRANSACTION_VARIANT_WRITE'));
    assert.ok(codes(result).has('TRANSACTION_VARIANT_FENCE_MISMATCH'));
    assert.ok(codes(result).has('MISSING_TRANSACTION_VARIANT_CRASH_FIXTURE'));
    assert.ok(codes(result).has('INVALID_PRODUCT_FACT_VARIANT_OVERRIDE'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
