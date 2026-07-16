'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { classifyChangedPath, findUntrackedContractFiles, prohibitedContentFindings } = require('../../scripts/helix-architecture/p2-exit-auditor');

test('allows only P2 contracts, isolated fixtures, contract tooling, and active phase docs', () => {
  for (const file of [
    'media-service/src/helix/contracts/types/Example/v1/schema.json',
    'media-service/scripts/helix-p2-contract-check.js',
    'media-service/scripts/helix-architecture/example.js',
    'media-service/test/helix-architecture/example.test.js',
    'AGENTS.md',
    'docs/helix/README.md',
    'docs/helix/CURRENT_STATUS.md'
  ]) assert.equal(classifyChangedPath(file).allowed, true, file);
  for (const file of [
    'docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md',
    'media-service/src/server.js',
    'media-service/src/helix/composition/index.js',
    'media-desktop/src/main.js',
    'tests/runner.sh',
    'Dockerfile'
  ]) assert.equal(classifyChangedPath(file).allowed, false, file);
});

test('rejects DDL, DB runtime, server wiring, and dual-runtime fallback tokens', () => {
  assert.deepEqual(prohibitedContentFindings('media-service/scripts/example.js', 'CREATE TABLE x(id TEXT)').map((item) => item.code), ['DDL_EXECUTION_TOKEN']);
  assert.deepEqual(prohibitedContentFindings('media-service/scripts/example.js', "require('better-sqlite3')").map((item) => item.code), ['DATABASE_RUNTIME_IMPORT']);
  assert.deepEqual(prohibitedContentFindings('media-service/scripts/example.js', 'app.listen(8080)').map((item) => item.code), ['SERVER_RUNTIME_WIRING']);
  assert.deepEqual(prohibitedContentFindings('media-service/scripts/example.js', 'legacy runtime fallback').map((item) => item.code), ['LEGACY_RUNTIME_FALLBACK']);
});

test('negative fixture source is exempt from production content scanning only', () => {
  assert.deepEqual(prohibitedContentFindings('media-service/test/helix-architecture/negative.test.js', "require('better-sqlite3')"), []);
});

test('detects a physical contract artifact omitted by Git ignore rules', () => {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-tracked-contracts-'));
  try {
    const relative = 'media-service/src/helix/contracts/capabilities/arca/offdeck/related_reference/release/v1/manifest.json';
    const filePath = path.join(repository, ...relative.split('/'));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '{}');
    assert.deepEqual(findUntrackedContractFiles(repository, []), [relative]);
    assert.deepEqual(findUntrackedContractFiles(repository, [relative]), []);
  } finally {
    fs.rmSync(repository, { recursive: true, force: true });
  }
});
