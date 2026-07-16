'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyChangedPath, prohibitedProductionFindings } = require('../../scripts/helix-architecture/p3-exit-auditor');

test('P3 Exit Audit allows only persistence, repaired table contracts, isolated tooling/fixtures, command registration, and phase docs', () => {
  for (const file of [
    'media-service/src/helix/foundation/persistence/sqlite-kernel.js',
    'media-service/src/helix/foundation/persistence/generated/clean-schema.sql',
    'media-service/src/helix/contracts/table-contracts/libra_subjects/v1/contract.json',
    'media-service/src/helix/contracts/manifests/table-inventory/entries-001-013.json',
    'media-service/scripts/helix-p3-persistence-verify.js',
    'media-service/scripts/helix-architecture/p3-persistence-verifier.js',
    'media-service/test/helix-architecture/p3-sqlite-kernel.test.js',
    'media-service/package.json',
    'docs/helix/implementation/evidence/P3_PHASE_EXIT_AUDIT.md'
  ]) assert.equal(classifyChangedPath(file).allowed, true, file);
  for (const file of [
    'docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md',
    'media-service/src/server.js',
    'media-service/src/helix/domains/libra/index.js',
    'media-service/web/src/App.jsx',
    'media-desktop/src/main.js',
    'tests/runner.sh',
    'Dockerfile'
  ]) assert.equal(classifyChangedPath(file).allowed, false, file);
});

test('P3 Exit Audit rejects legacy, compatibility, startup, external effect, and internal HTTP tokens in production persistence', () => {
  const cases = [
    ['const mode = "kairox";', 'LEGACY_SEMANTIC'],
    ['const mode = "dual-read";', 'COMPATIBILITY_OR_DUAL_PATH'],
    ['app.listen(8080);', 'PRODUCT_STARTUP_WIRING'],
    ["require('node:fs')", 'EXTERNAL_EFFECT_IMPORT'],
    ["const endpoint = 'http://internal';", 'INTERNAL_HTTP_BOUNDARY']
  ];
  for (const [source, code] of cases) assert.equal(
    prohibitedProductionFindings('media-service/src/helix/foundation/persistence/example.js', source)[0].code, code
  );
});

test('P3 Exit Audit does not scan negative fixtures as production persistence', () => {
  assert.deepEqual(prohibitedProductionFindings('media-service/test/helix-architecture/example.test.js', "require('node:fs')"), []);
});
