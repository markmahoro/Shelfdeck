'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { auditP8Exit, classifyChangedPath, prohibitedProductionFindings } = require('../../scripts/helix-architecture/p8-exit-auditor');

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

test('P8 exit evidence is exact, complete, and free of scope findings', () => {
  const result = auditP8Exit({ repositoryRoot, requireClean:false });
  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
  assert.deepEqual(result.findings, []);
  assert.equal(result.evidence.libraFrontHalfCapabilityCount, 7);
  assert.equal(result.evidence.tableCount, 169);
  assert.equal(result.evidence.transactionCount, 38);
  assert.deepEqual(result.evidence.prohibitedActionsRun, []);
});
