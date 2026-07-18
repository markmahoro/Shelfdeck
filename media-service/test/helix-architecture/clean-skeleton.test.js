'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const helixRoot = path.resolve(__dirname, '../../src/helix');
const domainNames = ['procurement', 'libra', 'arca', 'perception', 'people'];
const domainLayers = ['public', 'model', 'application', 'planning', 'capabilities', 'persistence'];

function discoverMarkers(rootPath) {
  const markers = [];
  const pending = [rootPath];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile() && entry.name === 'package.boundary.json') markers.push(absolute);
    }
  }
  return markers;
}

test('clean package IDs exactly match the accepted P1 physical skeleton', () => {
  const expected = new Set([
    'helix',
    'composition',
    'platform.public',
    'platform.model',
    'platform.application',
    'platform.persistence',
    'integrations',
    'projections',
    'contracts',
    'contracts.manifests',
    ...['public', 'execution', 'capability', 'control', 'persistence', 'effects', 'diagnostics']
      .map((layer) => `foundation.${layer}`),
    ...domainNames.flatMap((domain) => domainLayers.map((layer) => `domains.${domain}.${layer}`))
  ]);
  const actual = new Set(discoverMarkers(helixRoot).map((filePath) =>
    JSON.parse(fs.readFileSync(filePath, 'utf8')).packageId
  ));
  assert.equal(actual.size, 47);
  assert.deepEqual([...actual].sort(), [...expected].sort());
});

test('each Domain exposes one frozen public package identity', () => {
  const expectedExports = {
    procurement: ['PACKAGE_ID', 'CandidateDeliveryPort', 'ProcurementCommandFacade', 'ProcurementQueryFacade'],
    libra: ['PACKAGE_ID', 'LibraIntakeFacade'],
    arca: ['PACKAGE_ID'],
    perception: ['PACKAGE_ID', 'PerceptionCommandFacade', 'PerceptionResolutionFacade'],
    people: ['PACKAGE_ID', 'PeopleCommandFacade', 'PersonReferenceQueryFacade']
  };
  for (const domain of domainNames) {
    const entry = require(path.join(helixRoot, 'domains', domain, 'public'));
    assert.equal(entry.PACKAGE_ID, `domains.${domain}.public`);
    assert.deepEqual(Object.keys(entry).sort(), expectedExports[domain].sort());
    for (const exportName of expectedExports[domain].filter((name) => name !== 'PACKAGE_ID')) {
      assert.equal(typeof entry[exportName], 'function');
    }
    assert.equal(Object.isFrozen(entry), true);
  }
});

test('Platform is a required four-package technical owner with one frozen public entry', () => {
  const platform = require(path.join(helixRoot, 'platform', 'public'));
  assert.equal(platform.PACKAGE_ID, 'platform.public');
  assert.equal(typeof platform.IntegrationQueryPort, 'function');
  assert.equal(typeof platform.MountScopeResolverPort, 'function');
  assert.equal(Object.isFrozen(platform), true);
  for (const layer of ['public', 'model', 'application', 'persistence']) {
    const descriptor = JSON.parse(fs.readFileSync(path.join(helixRoot, 'platform', layer, 'package.boundary.json'), 'utf8'));
    assert.equal(descriptor.packageId, `platform.${layer}`);
    assert.equal(descriptor.owner, 'platform-settings');
  }
});

test('composition root import is side-effect free and factory fails explicitly', () => {
  const handlesBefore = process._getActiveHandles().length;
  const requestsBefore = process._getActiveRequests().length;
  const composition = require(path.join(helixRoot, 'composition', 'createHelixApplication'));
  assert.equal(process._getActiveHandles().length, handlesBefore);
  assert.equal(process._getActiveRequests().length, requestsBefore);
  assert.equal(Object.isFrozen(composition), true);
  assert.throws(
    () => composition.createHelixApplication(),
    (error) => error && error.code === 'HELIX_COMPOSITION_NOT_IMPLEMENTED'
  );
});

test('legacy product startup files do not reference the clean root', () => {
  for (const relativePath of ['../../src/server.js', '../../src/app.js']) {
    const content = fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
    assert.doesNotMatch(content, /(?:require\s*\(|from\s+)[^\n]*\bhelix\b/i);
  }
});
