'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const publicPackage = require('../../src/helix/domains/libra/public');

const catalog = require('../../src/helix/contracts/ports/p8-libra-intake-public-contracts.json');

test('P8 exposes only the SSOT-explicit Libra Intake public method', () => {
  assert.deepEqual(Object.keys(publicPackage).sort(), ['LibraIntakeFacade','PACKAGE_ID']);
  assert.equal(publicPackage.PACKAGE_ID, 'domains.libra.public');
  assert.deepEqual(catalog.facades, [{ exportName:'LibraIntakeFacade', packageId:'domains.libra.public',
    kind:'handoff-acceptance-facade', methods:['offerCandidate'], inputSchemaRefs:{
      offerCandidate:'helix://contracts/types/ProcurementCandidateOfferAvailableMessage/v1' } }]);
});

test('Libra Intake nominal binding rejects missing and extra authority', () => {
  const calls = [];
  const facade = publicPackage.LibraIntakeFacade({ offerCandidate(message) { calls.push(message); return { kind:'offered' }; } });
  const message = { offerId:'offer-1' };
  assert.deepEqual(facade.offerCandidate(message), { kind:'offered' });
  assert.deepEqual(calls, [message]);
  assert.throws(() => publicPackage.LibraIntakeFacade({}), (error) => error.code === 'P8_LIBRA_INTAKE_PORT_SHAPE_MISMATCH');
  assert.throws(() => publicPackage.LibraIntakeFacade({ offerCandidate() {}, repository:{} }),
    (error) => error.code === 'P8_LIBRA_INTAKE_PORT_SHAPE_MISMATCH');
});

test('Libra public package has no Store, Procurement internal, Runtime, HTTP, or startup dependency', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/helix/domains/libra/public/index.js'), 'utf8');
  assert.doesNotMatch(source, /require\([^)]*(?:persistence|store|domains\/procurement|runtime|server|app\.js)/i);
  assert.doesNotMatch(source, /(?:https?:\/\/|\.listen\s*\(|sqlite)/i);
});
