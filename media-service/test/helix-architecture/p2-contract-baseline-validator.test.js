'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { validateP2ContractBaseline } = require('../../scripts/helix-architecture/p2-contract-baseline-validator');

const repositoryRoot = path.resolve(__dirname, '../../..');
const contractsRoot = path.resolve(__dirname, '../../src/helix/contracts');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-p2-baseline-'));
  fs.cpSync(contractsRoot, root, { recursive: true });
  return root;
}

function mutate(filePath, change) {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  change(value);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

test('closes the exact P2 112/96/168/30 baseline with a stable aggregate digest', () => {
  const first = validateP2ContractBaseline({ repositoryRoot, contractsRoot });
  const second = validateP2ContractBaseline({ repositoryRoot, contractsRoot });
  assert.equal(first.ok, true);
  assert.deepEqual(first.counts, {
    capabilities: 112, resultFamilies: 96, tables: 168, transactions: 30,
    sharedTypes: 29, domainInputs: 94, referencedTypeRefs: 198, unresolvedTypeRefs: 0
  });
  assert.equal(first.aggregateDigest, '57d5e116b5cf4a1fcc9595d3e27ba92c60a7626ae72f223fef9255b0b99fb597');
  assert.equal(first.aggregateDigest, second.aggregateDigest);
  assert.deepEqual(first.prohibitedActionsRun, []);
});

test('fails the aggregate gate when a Capability ref escapes every P2 registry', () => {
  const root = fixture();
  try {
    const filePath = path.join(root, 'capabilities', 'shared', 'material', 'filesystem_identity', 'observe', 'v1', 'inputs.schema.json');
    mutate(filePath, (schema) => {
      schema.$defs.physicalMaterialReadHandle.$ref = 'helix://contracts/types/LegacySourceBinding/v1';
    });
    const result = validateP2ContractBaseline({ repositoryRoot, contractsRoot: root });
    assert.equal(result.ok, false);
    assert.equal(result.components.capabilities.unresolvedTypeRefCount, 1);
    assert.ok(result.findings.some((item) => item.code === 'UNRESOLVED_CAPABILITY_TYPE_REF'));
    assert.ok(result.findings.some((item) => item.code === 'P2_UNRESOLVED_TYPE_GRAPH'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P2 contract CLI exits non-zero for a broken cross-inventory graph', () => {
  const root = fixture();
  try {
    const filePath = path.join(root, 'transaction-contracts', 'helix.transaction.handoff-b-accepted', 'v1', 'contract.json');
    mutate(filePath, (document) => {
      document.contract.writeTables.push('libra_subjects');
    });
    const run = childProcess.spawnSync(process.execPath, [
      path.join(repositoryRoot, 'media-service', 'scripts', 'helix-p2-contract-check.js'),
      '--repository-root', repositoryRoot,
      '--contracts-root', root
    ], { encoding: 'utf8' });
    assert.notEqual(run.status, 0);
    const output = JSON.parse(run.stdout);
    assert.equal(output.ok, false);
    assert.ok(output.findings.some((item) => item.code === 'TRANSACTION_CONTRACT_DRIFT'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
