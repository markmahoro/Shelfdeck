'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const platformPublic = require('../../src/helix/platform/public');
const integrations = require('../../src/helix/integrations');
const catalog = require('../../src/helix/contracts/ports/p5-public-port-contracts.json');

const EFFECT_CLASSES = new Set(['pure_observation', 'workspace_write', 'external_request']);
const PLATFORM_EXPORTS = [
  'AdminCredentialRevisionQueryPort', 'ArtifactQueryPort', 'ComputeDeviceQueryPort',
  'IntegrationHandleResolverPort', 'IntegrationQueryPort', 'MountScopeResolverPort',
  'ResourceProfileQueryPort', 'SecretLeaseResolverPort', 'WorkerHandleResolverPort',
  'WorkspaceRootResolverPort'
];
const INTEGRATION_EXPORTS = [
  'ContentHashPort', 'ExternalProviderPort', 'FilesystemObservationPort', 'MediaProbePort',
  'MediaTransformPort', 'WorkerComputePort', 'WorkspaceFileEffectPort'
];

test('P5 nominal port catalog is exact, typed, bounded, fenced, and owner-declared', () => {
  assert.equal(catalog.schemaVersion, 1);
  assert.equal(catalog.contracts.length, 17);
  assert.equal(new Set(catalog.contracts.map((contract) => contract.portId)).size, 17);
  assert.equal(new Set(catalog.contracts.map((contract) => contract.exportName)).size, 17);

  for (const contract of catalog.contracts) {
    assert.match(contract.portId, /@1$/);
    assert.ok(['platform.public', 'integrations'].includes(contract.packageId));
    assert.ok(['platform-settings', 'integration-boundary'].includes(contract.owner));
    assert.ok(['query', 'resolve', 'execute'].includes(contract.method));
    assert.match(contract.inputSchemaRef, /^helix:\/\/contracts\/ports\/.+\/v1\/input$/);
    assert.match(contract.outputSchemaRef, /^helix:\/\/contracts\/ports\/.+\/v1\/output$/);
    assert.ok(EFFECT_CLASSES.has(contract.effectClass));
    assert.equal(typeof contract.idempotency.required, 'boolean');
    assert.equal(typeof contract.idempotency.scope, 'string');
    assert.equal(contract.fence.required, true);
    assert.equal(typeof contract.fence.source, 'string');
    assert.ok(Number.isSafeInteger(contract.payloadBounds.inputBytes) && contract.payloadBounds.inputBytes > 0);
    assert.ok(Number.isSafeInteger(contract.payloadBounds.outputBytes) && contract.payloadBounds.outputBytes > 0);
    if (contract.effectClass !== 'pure_observation') assert.equal(contract.idempotency.required, true);
  }
});

test('Platform and Integration entry points export only nominal factories plus package identity', () => {
  assert.deepEqual(Object.keys(platformPublic).filter((key) => key !== 'PACKAGE_ID').sort(), PLATFORM_EXPORTS);
  assert.deepEqual(Object.keys(integrations).filter((key) => key !== 'PACKAGE_ID').sort(), INTEGRATION_EXPORTS);
  assert.equal(platformPublic.PACKAGE_ID, 'platform.public');
  assert.equal(integrations.PACKAGE_ID, 'integrations');

  const platformPort = platformPublic.MountScopeResolverPort({ resolve: (input) => input });
  const integrationPort = integrations.ContentHashPort({ execute: (input) => input });
  assert.deepEqual(platformPort.resolve({ scope: 'scope-1' }), { scope: 'scope-1' });
  assert.deepEqual(integrationPort.execute({ handle: 'handle-1' }), { handle: 'handle-1' });
  assert.equal(Object.isFrozen(platformPort), true);
  assert.equal(Object.isFrozen(integrationPort), true);
});

test('nominal factories reject authority-shaped and generic extra methods', () => {
  const forbiddenExtras = ['repository', 'sqlite', 'writeDomainFact', 'http', 'request', 'childProcess'];
  for (const extra of forbiddenExtras) {
    assert.throws(
      () => platformPublic.IntegrationQueryPort({ query() {}, [extra]() {} }),
      (error) => error.code === 'P5_PLATFORM_PORT_SHAPE_MISMATCH'
    );
    assert.throws(
      () => integrations.ExternalProviderPort({ execute() {}, [extra]() {} }),
      (error) => error.code === 'P5_INTEGRATION_PORT_SHAPE_MISMATCH'
    );
  }
});

test('public entry points have no internal transport, persistence, process, or old adapter import', () => {
  const files = [
    path.resolve(__dirname, '../../src/helix/platform/public/index.js'),
    path.resolve(__dirname, '../../src/helix/integrations/index.js')
  ];
  const prohibitedFragments = [
    ['better-', 'sqlite3'], ['node:', 'http'], ['node:', 'child_process'], ['/platform/', 'persistence'],
    ['../legacy-', 'adapter'], ['kair', 'ox'], ['mire', 'x']
  ].map((parts) => parts.join('').toLowerCase());
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8').toLowerCase();
    for (const fragment of prohibitedFragments) assert.equal(source.includes(fragment), false, `${file}: ${fragment}`);
  }
});
