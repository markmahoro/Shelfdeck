'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const { classifyChangedPath, prohibitedProductionFindings } = require('../../scripts/helix-architecture/p8-exit-auditor');

const repositoryRoot = path.resolve(__dirname, '../../..');

test('P8 scope admits Libra and exact Handoff A Procurement adapters only', () => {
  assert.equal(classifyChangedPath('media-service/src/helix/domains/libra/model/x.js').allowed, true);
  assert.equal(classifyChangedPath('media-service/src/helix/domains/procurement/application/candidate-delivery-service.js').allowed, true);
  assert.equal(classifyChangedPath('media-service/src/helix/domains/procurement/model/unrelated.js').allowed, false);
  assert.equal(classifyChangedPath('media-service/src/helix/domains/arca/store.js').allowed, false);
  assert.equal(classifyChangedPath('media-desktop/src/main.js').allowed, false);
});

test('P8 production scan rejects compatibility, cross-domain internals, startup, and direct effects', () => {
  assert.deepEqual(prohibitedProductionFindings('media-service/src/helix/domains/libra/x.js', 'const x = "legacy runtime fallback";').map((item) => item.code), ['COMPATIBILITY_OR_DUAL_PATH']);
  assert.deepEqual(prohibitedProductionFindings('media-service/src/helix/domains/libra/x.js', "require('../arca/store')").map((item) => item.code), ['CROSS_DOMAIN_INTERNAL_IMPORT']);
  assert.deepEqual(prohibitedProductionFindings('media-service/test/helix-architecture/x.js', 'legacy runtime fallback'), []);
});

test('P8 frozen exit evidence remains anchored to the archived P8 closure', () => {
  const show = (object) => childProcess.execFileSync('git', ['show', object], { cwd: repositoryRoot, encoding: 'utf8' });
  const evidence = show('f3e44d10:docs/helix/implementation/evidence/P8_11_EXIT_AUDIT.md');
  const manifest = JSON.parse(show('f3e44d10:media-service/src/helix/foundation/persistence/generated/clean-schema.manifest.json'));
  const transactions = JSON.parse(show('f3e44d10:media-service/src/helix/contracts/manifests/transaction-inventory.json'));
  assert.match(evidence, /Status: PASS；Evidence frozen/);
  assert.match(evidence, /169 tables、38 canonical transactions/);
  assert.equal(manifest.tableCount, 169);
  assert.equal(transactions.targetCount, 38);
  assert.equal(show('f3e44d10:docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md'),
    show('72df5a9d:docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md'));
});
