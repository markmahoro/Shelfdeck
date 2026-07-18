'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { auditP7Exit, classifyChangedPath, prohibitedProductionFindings } =
  require('../../scripts/helix-architecture/p7-exit-auditor');

const repositoryRoot = path.resolve(__dirname, '../../..');

test('P7 scope classifier admits Procurement and bounded Foundation changes only', () => {
  assert.equal(classifyChangedPath('media-service/src/helix/domains/procurement/model/x.js').allowed, true);
  assert.equal(classifyChangedPath('media-service/src/helix/foundation/persistence/x.js').allowed, true);
  assert.equal(classifyChangedPath('media-service/src/helix/domains/libra/store.js').allowed, false);
  assert.equal(classifyChangedPath('media-service/src/server.js').allowed, false);
  assert.equal(classifyChangedPath('media-desktop/src/main.js').allowed, false);
});

test('P7 production scan rejects compatibility, cross-domain internals, startup, and direct effects', () => {
  assert.deepEqual(prohibitedProductionFindings('media-service/src/helix/domains/procurement/x.js',
    'const x = "legacy runtime fallback";').map((item) => item.code), ['COMPATIBILITY_OR_DUAL_PATH']);
  assert.deepEqual(prohibitedProductionFindings('media-service/src/helix/domains/procurement/x.js',
    "require('../libra/store')").map((item) => item.code), ['CROSS_DOMAIN_INTERNAL_IMPORT']);
  assert.deepEqual(prohibitedProductionFindings('media-service/test/helix-architecture/x.js',
    'legacy runtime fallback'), []);
});

test('P7 exit evidence is exact, complete, and free of scope findings', () => {
  const result = auditP7Exit({ repositoryRoot, requireClean:false });
  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
  assert.deepEqual(result.findings, []);
  assert.equal(result.evidence.procurementTableCount, 15);
  assert.equal(result.evidence.procurementCapabilityCount, 8);
  assert.equal(result.evidence.transactionCount, 30);
  assert.deepEqual(result.evidence.prohibitedActionsRun, []);
});
