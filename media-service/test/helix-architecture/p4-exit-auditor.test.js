'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyChangedPath, prohibitedProductionFindings } = require('../../scripts/helix-architecture/p4-exit-auditor');

test('P4 Exit Audit allows only execution foundation, isolated verification, exact repair artifacts, and phase docs', () => {
  for (const file of [
    'media-service/src/helix/foundation/execution/event-runtime.js',
    'media-service/src/helix/foundation/effects/effect-journal.js',
    'media-service/src/helix/foundation/public/index.js',
    'media-service/scripts/helix-p4-runtime-verify.js',
    'media-service/scripts/helix-architecture/p4-runtime-verifier.js',
    'media-service/test/helix-architecture/p4-event-runtime.test.js',
    'media-service/src/helix/contracts/table-contracts/fx_plan_nodes/v1/contract.json',
    'docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md',
    'docs/helix/implementation/evidence/P4_PHASE_EXIT_AUDIT_X.md'
  ]) assert.equal(classifyChangedPath(file).allowed, true, file);
  for (const file of [
    'media-service/src/server.js', 'media-service/src/helix/domains/libra/index.js',
    'media-service/src/helix/platform/secrets.js', 'media-service/web/src/App.jsx',
    'media-desktop/src/main.js', 'tests/runner.sh', 'Dockerfile'
  ]) assert.equal(classifyChangedPath(file).allowed, false, file);
});

test('P4 Exit Audit rejects legacy runtime, dual path, startup, Domain dependency, process adapter, and internal HTTP', () => {
  const file = 'media-service/src/helix/foundation/execution/example.js';
  for (const [source, code] of [
    ['const runtime = "kairox";', 'LEGACY_RUNTIME_REFERENCE'],
    ['const mode = "dual-write";', 'DUAL_OR_FALLBACK_PATH'],
    ['app.listen(8080);', 'PRODUCT_STARTUP_WIRING'],
    ["require('../../domains/libra')", 'DOMAIN_DEPENDENCY'],
    ["require('node:child_process')", 'EXTERNAL_OR_PROCESS_IMPORT'],
    ["const endpoint = 'http://internal';", 'INTERNAL_HTTP_BOUNDARY']
  ]) assert.equal(prohibitedProductionFindings(file, source)[0].code, code);
});

test('P4 Exit Audit does not scan scripts or negative fixtures as production Foundation', () => {
  assert.deepEqual(prohibitedProductionFindings('media-service/scripts/helix-architecture/p4-crash-worker.js', "require('node:fs')"), []);
  assert.deepEqual(prohibitedProductionFindings('media-service/test/helix-architecture/p4-example.test.js', 'kairox fallback'), []);
});
