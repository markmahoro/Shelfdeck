'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { extractSsotContracts } = require('../../scripts/helix-architecture/ssot-contract-extractor');
const { buildCapabilityPackages } = require('../../scripts/helix-architecture/capability-contract-builder');

const ssot = fs.readFileSync(path.resolve(__dirname, '../../../docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md'), 'utf8');
const extracted = extractSsotContracts(ssot);

test('builds exactly one immutable eight-file package for each Catalog ref', () => {
  const packages = buildCapabilityPackages(extracted.capabilities);
  assert.equal(packages.length, 112);
  assert.equal(new Set(packages.map((item) => item.capabilityRef)).size, 112);
  assert.equal(new Set(packages.map((item) => item.relativePath)).size, 112);
  for (const item of packages) {
    assert.deepEqual(Object.keys(item.files).sort(), [
      'evidence.schema.json', 'failure.schema.json', 'fence.schema.json', 'inputs.schema.json',
      'manifest.json', 'parameters.schema.json', 'resource-demand.schema.json', 'result.schema.json'
    ]);
    assert.match(item.packageDigest, /^[a-f0-9]{64}$/);
  }
});

test('preserves Owner, Effect Class, output family, and source locator from SSOT', () => {
  const packages = buildCapabilityPackages(extracted.capabilities);
  for (const capability of extracted.capabilities) {
    const item = packages.find((candidate) => candidate.capabilityRef === capability.id);
    assert.equal(item.files['manifest.json'].ownerScope, capability.owner);
    assert.equal(item.files['manifest.json'].effectClass, capability.effectClass);
    assert.equal(item.files['result.schema.json'].$ref, `helix://contracts/types/${capability.outputFamily}/v1`);
    assert.deepEqual(item.files['manifest.json'].sourceLocator, capability.source);
  }
});

test('moves only SSOT-declared parameter tokens out of named inputs', () => {
  const packages = buildCapabilityPackages(extracted.capabilities);
  const observe = packages.find((item) => item.capabilityRef === 'procurement.field.page.observe@1').files;
  assert.deepEqual(Object.keys(observe['parameters.schema.json'].properties).sort(), ['cursor', 'pageBudget']);
  assert.deepEqual(Object.keys(observe['inputs.schema.json'].properties), ['fieldAccessHandle']);

  const fetch = packages.find((item) => item.capabilityRef === 'libra.product_metadata.fetch@1').files;
  assert.ok(fetch['parameters.schema.json'].properties.contentProfile);
  assert.equal(fetch['inputs.schema.json'].properties.contentProfile, undefined);
  assert.equal(fetch['manifest.json'].effectClass, 'pure_observation');
});

test('keeps settlement Approval separate from destructive Authorization', () => {
  const packages = buildCapabilityPackages(extracted.capabilities);
  const ondeck = packages.find((item) => item.capabilityRef === 'arca.ondeck.input_settlement.delete@1').files['manifest.json'];
  const aftercare = packages.find((item) => item.capabilityRef === 'arca.aftercare.input_settlement.delete@1').files['manifest.json'];
  const offdeck = packages.find((item) => item.capabilityRef === 'arca.offdeck.primary_material.delete@1').files['manifest.json'];
  assert.ok(ondeck.approvalRequirementRef);
  assert.ok(aftercare.approvalRequirementRef);
  assert.equal(ondeck.authorizationRequirementRef, undefined);
  assert.equal(aftercare.authorizationRequirementRef, undefined);
  assert.ok(offdeck.authorizationRequirementRef);
  assert.equal(offdeck.approvalRequirementRef, undefined);
});

test('non-pure capabilities require event and effect-scope fences', () => {
  const packages = buildCapabilityPackages(extracted.capabilities);
  for (const item of packages) {
    const manifest = item.files['manifest.json'];
    const required = item.files['fence.schema.json'].required;
    if (manifest.effectClass === 'pure_observation') {
      assert.deepEqual(required, ['basisDigest', 'inputSetDigest']);
    } else {
      assert.deepEqual(required, ['basisDigest', 'inputSetDigest', 'eventFenceDigest', 'effectScopeDigest']);
    }
  }
});
