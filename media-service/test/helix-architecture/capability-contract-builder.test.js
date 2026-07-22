'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { extractSsotContracts } = require('../../scripts/helix-architecture/ssot-contract-extractor');
const { buildCapabilityPackages } = require('../../scripts/helix-architecture/capability-contract-builder');

const ssot = fs.readFileSync(process.env.HELIX_SSOT_PATH || path.resolve(__dirname, '../../../docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md'), 'utf8');
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

test('preserves explicit bounded Artifact Handle list cardinality', () => {
  const item = buildCapabilityPackages(extracted.capabilities)
    .find((candidate) => candidate.capabilityRef === 'shared.artifact.manifest.verify@1');
  const handles = item.files['inputs.schema.json'].properties.artifactHandle164;
  assert.equal(handles, undefined);
  const bounded = item.files['inputs.schema.json'].$defs.artifactHandleList;
  assert.equal(bounded.items.$ref, 'helix://contracts/types/ArtifactHandle/v1');
  assert.equal(bounded.minItems, 1);
  assert.equal(bounded.maxItems, 64);
});

test('moves only SSOT-declared parameter tokens out of named inputs', () => {
  const packages = buildCapabilityPackages(extracted.capabilities);
  const observe = packages.find((item) => item.capabilityRef === 'procurement.field.page.observe@1').files;
  assert.deepEqual(observe['parameters.schema.json'].properties, {});
  assert.deepEqual(Object.keys(observe['inputs.schema.json'].properties), ['fieldAccessHandle', 'fieldObservationPageRequest']);

  const fetch = packages.find((item) => item.capabilityRef === 'libra.product_metadata.fetch@1').files;
  assert.deepEqual(fetch['parameters.schema.json'].properties, {});
  assert.equal(fetch['inputs.schema.json'].properties.contentProfile, undefined);
  assert.ok(fetch['inputs.schema.json'].properties.metadataFetchIntent);
  assert.ok(fetch['inputs.schema.json'].properties.physicalMaterialReadHandleOrIntegrationHandle);
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

test('normalizes Catalog prose without inventing parenthetical or slash-split business types', () => {
  const packages = buildCapabilityPackages(extracted.capabilities);
  const people = packages.find((item) => item.capabilityRef === 'people.candidate.commit@1').files['inputs.schema.json'];
  assert.equal(people.$defs.peopleCandidateDraft.$ref, 'helix://contracts/types/PeopleCandidateDraft/v1');
  assert.equal(JSON.stringify(people).includes('/Merge/v1'), false);

  const settlement = packages.find((item) => item.capabilityRef === 'arca.ondeck.input_settlement.delete@1').files['inputs.schema.json'];
  assert.equal(settlement.$defs.oldInputHandleList.type, 'array');
  assert.equal(settlement.$defs.oldInputHandleList.items.$ref, 'helix://contracts/types/PhysicalMaterialReadHandle/v1');
  assert.equal(settlement.$defs.inputSettlementApproval.$ref, 'helix://contracts/types/ApprovalHandle/v1');
});
