'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  canonicalDigest,
  validateManifestSet
} = require('../../scripts/helix-architecture/manifest-validator');

const actualRoot = path.resolve(__dirname, '../../src/helix');
const repositoryRoot = path.resolve(__dirname, '../../..');

function createFixture() {
  const basePath = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-manifest-'));
  const rootPath = path.join(basePath, 'helix');
  fs.cpSync(actualRoot, rootPath, { recursive: true });
  return { basePath, rootPath, repositoryRoot };
}

function manifestPath(fixture, relativePath) {
  return path.join(fixture.rootPath, 'contracts', 'manifests', relativePath);
}

function mutateJson(filePath, mutate) {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  mutate(value);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function findingCodes(result) {
  return new Set(result.findings.map((item) => item.code));
}

test('validates the complete P1 framework and produces a stable aggregate digest', () => {
  const first = validateManifestSet({ rootPath: actualRoot, repositoryRoot });
  const second = validateManifestSet({ rootPath: actualRoot, repositoryRoot });
  assert.equal(first.ok, true);
  assert.equal(first.ownerCount, 10);
  assert.equal(first.packageCount, 42);
  assert.equal(first.manifests.find((item) => item.manifestId === 'helix.legacy-reuse-ledger').entryCount, 62);
  assert.match(first.aggregateDigest, /^[a-f0-9]{64}$/);
  assert.equal(first.aggregateDigest, second.aggregateDigest);
  assert.equal(canonicalDigest({ b: 2, a: 1 }), canonicalDigest({ a: 1, b: 2 }));
});

test('rejects duplicate entry IDs, unresolved owners, and illegal statuses', () => {
  const fixture = createFixture();
  try {
    const filePath = manifestPath(fixture, 'capability-inventory.json');
    mutateJson(filePath, (manifest) => {
      const contract = { capabilityRef: 'fixture@1' };
      const base = {
        id: 'capability.fixture',
        version: 1,
        owner: 'missing-owner',
        status: 'invented-status',
        ssotRefs: ['7.7'],
        sourceLocator: { type: 'ssot', ref: '7.7' },
        targetLocator: { path: 'domains/libra/capabilities/fixture.js' },
        contract,
        contractDigest: { algorithm: 'sha256', value: canonicalDigest(contract) }
      };
      manifest.entries = [base, { ...base }];
    });
    const result = validateManifestSet(fixture);
    assert.equal(result.ok, false);
    assert.ok(findingCodes(result).has('INVALID_INVENTORY_ENTRY'));
  } finally {
    fs.rmSync(fixture.basePath, { recursive: true, force: true });
  }
});

test('rejects invalid contract digests and package owners', () => {
  const fixture = createFixture();
  try {
    const filePath = manifestPath(fixture, 'table-inventory.json');
    mutateJson(filePath, (manifest) => {
      manifest.entries = [{
        id: 'table.fixture', version: 1, owner: 'libra', status: 'planned', ssotRefs: ['8.5.11'],
        sourceLocator: { type: 'ssot', ref: '8.5.11' },
        targetLocator: { path: 'domains/libra/persistence/schema.sql' },
        contract: { table: 'libra_fixture' },
        contractDigest: { algorithm: 'sha256', value: '0'.repeat(64) }
      }];
    });
    mutateJson(path.join(fixture.rootPath, 'domains', 'libra', 'public', 'package.boundary.json'), (marker) => {
      marker.owner = 'missing-owner';
    });
    const result = validateManifestSet(fixture);
    const codes = findingCodes(result);
    assert.ok(codes.has('INVENTORY_CONTRACT_DIGEST_MISMATCH'));
    assert.ok(codes.has('INVALID_PACKAGE_MANIFEST'));
  } finally {
    fs.rmSync(fixture.basePath, { recursive: true, force: true });
  }
});

test('rejects changed or unresolved baseline reuse evidence', () => {
  const fixture = createFixture();
  try {
    const shardPath = manifestPath(fixture, 'legacy-reuse/entries-001-016.json');
    mutateJson(shardPath, (shard) => {
      shard.entries[0].sourceDigest.value = '0'.repeat(64);
      shard.entries[1].sourceLocator.path = 'media-service/src/capabilities/missing.js';
      shard.entries[2].architectureDisposition = 'merge';
    });
    const result = validateManifestSet(fixture);
    const codes = findingCodes(result);
    assert.ok(codes.has('REUSE_SOURCE_EVIDENCE_MISMATCH'));
    assert.ok(codes.has('UNRESOLVED_REUSE_SOURCE'));
    assert.ok(codes.has('REUSE_DISPOSITION_COUNT_MISMATCH'));
  } finally {
    fs.rmSync(fixture.basePath, { recursive: true, force: true });
  }
});

test('CLI exits non-zero for a malformed registered manifest', () => {
  const fixture = createFixture();
  try {
    mutateJson(manifestPath(fixture, 'route-inventory.json'), (manifest) => {
      manifest.targetCount = 113;
    });
    const cliPath = path.resolve(__dirname, '../../scripts/helix-manifest-check.js');
    const completed = childProcess.spawnSync(
      process.execPath,
      [cliPath, '--root', fixture.rootPath, '--repository-root', fixture.repositoryRoot],
      { encoding: 'utf8' }
    );
    assert.equal(completed.status, 1);
    const output = JSON.parse(completed.stdout);
    assert.ok(findingCodes(output).has('INVALID_MANIFEST_ENVELOPE'));
  } finally {
    fs.rmSync(fixture.basePath, { recursive: true, force: true });
  }
});
