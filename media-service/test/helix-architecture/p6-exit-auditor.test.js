'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const {
  auditP6Exit,
  classifyChangedPath,
  prohibitedProductionFindings
} = require('../../scripts/helix-architecture/p6-exit-auditor');

const repositoryRoot = path.resolve(__dirname, '../../..');

test('P6 scope classifier admits only horizontal implementation families', () => {
  assert.equal(classifyChangedPath('media-service/src/helix/domains/people/persistence/people-store.js').allowed, true);
  assert.equal(classifyChangedPath('media-service/src/helix/domains/perception/application/query.js').allowed, true);
  assert.equal(classifyChangedPath('media-service/src/helix/domains/libra/store.js').allowed, false);
  assert.equal(classifyChangedPath('media-service/src/server.js').allowed, false);
  assert.equal(classifyChangedPath('media-desktop/src/main.js').allowed, false);
});

test('P6 production scan rejects compatibility and cross-domain internals', () => {
  assert.deepEqual(prohibitedProductionFindings('media-service/src/helix/domains/people/x.js', 'const x = "legacy runtime fallback";').map((item) => item.code), ['COMPATIBILITY_OR_DUAL_PATH']);
  assert.deepEqual(prohibitedProductionFindings('media-service/src/helix/domains/perception/x.js', "require('../libra/store')").map((item) => item.code), ['CROSS_DOMAIN_INTERNAL_IMPORT']);
  assert.deepEqual(prohibitedProductionFindings('media-service/test/helix-architecture/x.js', 'legacy runtime fallback'), []);
});

test('P6 exit evidence is SSOT exact and has no scope findings', () => {
  const result = auditP6Exit({ repositoryRoot, requireClean: false });
  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
  assert.deepEqual(result.findings, []);
  assert.equal(result.evidence.capabilityCount, 112);
  assert.equal(result.evidence.transactionCount, 24);
  assert.deepEqual(result.evidence.prohibitedActionsRun, []);
});
