'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const catalog = require('../../src/helix/contracts/ports/p7-procurement-public-contracts.json');
const procurement = require('../../src/helix/domains/procurement/public');

function implementation(exportName) {
  const contract = catalog.facades.find((item) => item.exportName === exportName);
  return Object.fromEntries(contract.methods.map((method) => [method, (input) => ({ method, input })]));
}

test('P7 publishes exactly the three SSOT Procurement public ports', () => {
  assert.equal(catalog.owner, 'procurement');
  assert.deepEqual(catalog.facades.map((item) => item.exportName).sort(), [
    'CandidateDeliveryPort', 'ProcurementCommandFacade', 'ProcurementQueryFacade'
  ]);
  assert.deepEqual(Object.keys(procurement).sort(), [
    'CandidateDeliveryPort', 'PACKAGE_ID', 'ProcurementCommandFacade', 'ProcurementQueryFacade'
  ]);
  assert.equal(Object.isFrozen(procurement), true);
});

test('Procurement ports require the exact nominal method set', () => {
  const commands = procurement.ProcurementCommandFacade(implementation('ProcurementCommandFacade'));
  const queries = procurement.ProcurementQueryFacade(implementation('ProcurementQueryFacade'));
  const delivery = procurement.CandidateDeliveryPort(implementation('CandidateDeliveryPort'));
  assert.equal(commands.requestFieldObservation({ fieldId: 'field-1' }).method, 'requestFieldObservation');
  assert.equal(queries.getCandidatePackage({ candidatePackageId: 'candidate-1' }).method, 'getCandidatePackage');
  assert.equal(delivery.readSnapshot({ candidatePackageId: 'candidate-1' }).method, 'readSnapshot');
  const contract = catalog.facades.find((item) => item.exportName === 'CandidateDeliveryPort');
  assert.equal(contract.inputSchemaRefs.readSnapshot, 'helix://contracts/domain-types/CandidateDeliveryQuery/v1');
  assert.equal(contract.outputSchemaRefs.readSnapshot, 'helix://contracts/domain-types/CandidateDeliveryReadResult/v1');
  assert.equal(Object.isFrozen(commands), true);
});

test('Procurement public boundary rejects Store, Subject, Shelf and generic execution authority', () => {
  const commands = implementation('ProcurementCommandFacade');
  for (const forbidden of ['openStore', 'createSubject', 'selectShelf', 'executeTask', 'writeRelatedMaterialControl']) {
    assert.throws(() => procurement.ProcurementCommandFacade({ ...commands, [forbidden]() {} }),
      (error) => error && error.code === 'P7_PROCUREMENT_PORT_SHAPE_MISMATCH');
  }
  assert.throws(() => procurement.ProcurementQueryFacade({ query() {} }),
    (error) => error && error.code === 'P7_PROCUREMENT_PORT_SHAPE_MISMATCH');
});
