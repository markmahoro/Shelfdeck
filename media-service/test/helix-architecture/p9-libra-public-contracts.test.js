'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const publicPackage = require('../../src/helix/domains/libra/public');
const catalog = require('../../src/helix/contracts/ports/p9-libra-production-public-contracts.json');

test('P9 exposes only the exact Product Delivery read method added by the SSOT', () => {
  assert.deepEqual(catalog.ports.find((entry) => entry.exportName === 'ProductDeliveryPort'), {
    exportName: 'ProductDeliveryPort', packageId: 'domains.libra.public', kind: 'handoff-deliverable-read-port',
    methods: ['readPackage'],
    inputSchemaRefs: { readPackage: 'helix://contracts/application-types/ProductDeliveryQuery/v1' },
    outputSchemaRefs: { readPackage: 'helix://contracts/application-types/ProductDeliveryReadResult/v1' }
  });
  assert.equal(typeof publicPackage.ProductDeliveryPort, 'function');
});

test('Product Delivery binding rejects missing and additional authority', () => {
  const calls = [];
  const port = publicPackage.ProductDeliveryPort({ readPackage(query) { calls.push(query); return { resultKind: 'not_found' }; } });
  const query = { onDeckPackageId: 'package-1' };
  assert.deepEqual(port.readPackage(query), { resultKind: 'not_found' });
  assert.deepEqual(calls, [query]);
  assert.throws(() => publicPackage.ProductDeliveryPort({}), (error) => error.code === 'P9_PRODUCT_DELIVERY_PORT_SHAPE_MISMATCH');
  assert.throws(() => publicPackage.ProductDeliveryPort({ readPackage() {}, repository: {} }),
    (error) => error.code === 'P9_PRODUCT_DELIVERY_PORT_SHAPE_MISMATCH');
});

test('P9 exposes the exact Workspace Reclamation query and command methods', () => {
  const contract = catalog.ports.find((entry) => entry.exportName === 'WorkspaceReclamationPort');
  assert.deepEqual(contract, {
    exportName: 'WorkspaceReclamationPort', packageId: 'domains.libra.public', kind: 'workspace-reclamation-port',
    methods: ['readCleanupScope', 'discardFrozenRun'],
    inputSchemaRefs: {
      readCleanupScope: 'helix://contracts/application-types/WorkspaceCleanupScopeQuery/v1',
      discardFrozenRun: 'helix://contracts/application-types/LibraRunDiscardCommand/v1'
    },
    outputSchemaRefs: {
      readCleanupScope: 'helix://contracts/application-types/WorkspaceCleanupScopeReadResult/v1',
      discardFrozenRun: 'helix://contracts/application-types/LibraRunDiscardCommandResult/v1'
    }
  });
  assert.equal(typeof publicPackage.WorkspaceReclamationPort, 'function');
});

test('Workspace Reclamation binding rejects repositories, paths, and deletion authority', () => {
  const calls = [];
  const port = publicPackage.WorkspaceReclamationPort({
    readCleanupScope(query) { calls.push(['read', query]); return { resultKind: 'not_found' }; },
    discardFrozenRun(command) { calls.push(['discard', command]); return { resultKind: 'not_found' }; }
  });
  assert.deepEqual(port.readCleanupScope({ cleanupScopeId: 'scope-1' }), { resultKind: 'not_found' });
  assert.deepEqual(port.discardFrozenRun({ libraRunId: 'run-1' }), { resultKind: 'not_found' });
  assert.equal(calls.length, 2);
  for (const extra of ['repository', 'workspacePath', 'deleteWorkspace']) {
    assert.throws(() => publicPackage.WorkspaceReclamationPort({
      readCleanupScope() {}, discardFrozenRun() {}, [extra]: extra === 'repository' ? {} : () => {}
    }), (error) => error.code === 'P9_WORKSPACE_RECLAMATION_PORT_SHAPE_MISMATCH');
  }
});

test('Libra production public package cannot import cross-Domain internals, Runtime, HTTP, or startup', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/helix/domains/libra/public/index.js'), 'utf8');
  assert.doesNotMatch(source, /require\([^)]*(?:domains\/arca|runtime|server|app\.js)/i);
  assert.doesNotMatch(source, /(?:https?:\/\/|\.listen\s*\(|sqlite|workspacePath|materialId)/i);
});
