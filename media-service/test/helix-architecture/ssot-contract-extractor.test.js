'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  EXPECTED_COUNTS,
  extractSsotContracts,
  splitMarkdownRow
} = require('../../scripts/helix-architecture/ssot-contract-extractor');

const sourcePath = process.env.HELIX_SSOT_PATH || path.resolve(__dirname, '../../../docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md');
const source = fs.readFileSync(sourcePath, 'utf8');

test('extracts the accepted P2 SSOT cardinalities with stable digests', () => {
  const first = extractSsotContracts(source);
  const second = extractSsotContracts(source.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'));
  assert.deepEqual(first.counts, EXPECTED_COUNTS);
  assert.equal(first.capabilities.length, new Set(first.capabilities.map((item) => item.id)).size);
  assert.equal(first.resultFamilies.length, new Set(first.resultFamilies.map((item) => item.id)).size);
  assert.equal(first.tables.length, new Set(first.tables.map((item) => item.id)).size);
  assert.equal(first.transactions.length, new Set(first.transactions.map((item) => item.id)).size);
  assert.equal(first.aggregateDigest, second.aggregateDigest);
  assert.match(first.aggregateDigest, /^[a-f0-9]{64}$/);
});

test('derives the Capability output families plus the canonical Outcome and Observation receipt families', () => {
  const result = extractSsotContracts(source);
  const outputs = new Set(result.capabilities.map((item) => item.outputFamily));
  assert.equal(outputs.size, 96);
  assert.ok(result.resultFamilies.some((item) => item.id === 'CapabilityOutcome' && item.kind === 'outcome-envelope'));
  assert.ok(result.resultFamilies.some((item) => item.id === 'ObservationPageCommitReceipt'));
  for (const output of outputs) assert.ok(result.resultFamilies.some((item) => item.id === output), output);
});

test('preserves Markdown pipes inside code spans while parsing table rows', () => {
  assert.deepEqual(
    splitMarkdownRow('| `id` | `ready|running|blocked` | contract |'),
    ['`id`', '`ready|running|blocked`', 'contract']
  );
});

test('fails closed when a required heading or Catalog row is missing', () => {
  assert.throws(
    () => extractSsotContracts(source.replace('#### 8.6.3 Shared Foundation Capability', '#### removed')),
    /Expected exactly one heading/
  );
  assert.throws(
    () => extractSsotContracts(source.replace('| `shared.material.filesystem_identity.observe@1` |', '| removed |')),
    /Capability count drift/
  );
});

test('fails closed on duplicate IDs and ambiguous Effect Class', () => {
  const duplicate = source.replace(
    '`shared.material.bounded_fingerprint.compute@1`',
    '`shared.material.filesystem_identity.observe@1`'
  );
  assert.throws(() => extractSsotContracts(duplicate), /duplicate IDs/);

  const ambiguous = source.replace(
    '| `shared.material.filesystem_identity.observe@1` | `PhysicalMaterialReadHandle → FilesystemIdentityEvidence` | `pure_observation` |',
    '| `shared.material.filesystem_identity.observe@1` | `PhysicalMaterialReadHandle → FilesystemIdentityEvidence` | `pure_observation` and `workspace_write` |'
  );
  assert.throws(() => extractSsotContracts(ambiguous), /Ambiguous Effect Class/);
});

test('every locator line digest resolves to the exact SSOT line', () => {
  const result = extractSsotContracts(source);
  const normalizedLines = source.replace(/\r\n/g, '\n').split('\n');
  const crypto = require('node:crypto');
  for (const entry of [...result.capabilities, ...result.resultFamilies, ...result.tables, ...result.transactions]) {
    const rawLine = normalizedLines[entry.source.line - 1];
    const digest = crypto.createHash('sha256').update(rawLine).digest('hex');
    assert.equal(digest, entry.source.lineDigest, entry.id);
  }
});
