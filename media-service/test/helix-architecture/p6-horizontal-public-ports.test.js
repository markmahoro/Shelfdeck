'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const catalog = require('../../src/helix/contracts/ports/p6-horizontal-domain-public-contracts.json');
const perception = require('../../src/helix/domains/perception/public');
const people = require('../../src/helix/domains/people/public');

test('P6 publishes exactly four Owner-scoped horizontal Domain Facades', () => {
  assert.equal(catalog.schemaVersion, 1);
  assert.equal(catalog.contractVersion, 1);
  assert.deepEqual(catalog.facades.map((item) => item.exportName).sort(), [
    'PeopleCommandFacade', 'PerceptionCommandFacade', 'PerceptionResolutionFacade', 'PersonReferenceQueryFacade'
  ]);
  assert.deepEqual(Object.keys(perception).sort(), ['PACKAGE_ID', 'PerceptionCommandFacade', 'PerceptionResolutionFacade']);
  assert.deepEqual(Object.keys(people).sort(), ['PACKAGE_ID', 'PeopleCommandFacade', 'PersonReferenceQueryFacade']);
  assert.equal(catalog.facades.every((item) => item.owner === 'perception' || item.owner === 'people'), true);
  assert.equal(catalog.prohibitedAuthority.includes('media_cast_write'), true);
  assert.equal(catalog.prohibitedAuthority.includes('material_control'), true);
});

test('Perception Facades require exact named commands and a single-kind Resolution query', () => {
  const seen = [];
  const commands = perception.PerceptionCommandFacade({
    createRecord: (input) => { seen.push(['record', input]); return 'recorded'; },
    requestAcquisition: (input) => { seen.push(['acquire', input]); return 'requested'; }
  });
  const query = perception.PerceptionResolutionFacade({ resolveDecisionFact: (input) => ({ kind: 'not_found', input }) });
  assert.equal(commands.createRecord({ value: 5 }), 'recorded');
  assert.deepEqual(query.resolveDecisionFact({ factKind: 'rating' }), { kind: 'not_found', input: { factKind: 'rating' } });
  assert.deepEqual(seen, [['record', { value: 5 }]]);
  assert.equal(Object.isFrozen(commands), true);
  assert.throws(() => perception.PerceptionCommandFacade({
    createRecord() {}, requestAcquisition() {}, interruptConsumer() {}
  }), (error) => error.code === 'P6_PERCEPTION_FACADE_SHAPE_MISMATCH');
});

test('People Facades reject Media-Cast and generic Store authority', () => {
  const implementation = Object.fromEntries(catalog.facades
    .find((item) => item.exportName === 'PeopleCommandFacade').methods.map((method) => [method, (input) => ({ method, input })]));
  const commands = people.PeopleCommandFacade(implementation);
  assert.equal(commands.setPreference({ personId: 'p-1', level: -2 }).method, 'setPreference');
  assert.equal(Object.isFrozen(commands), true);
  assert.throws(() => people.PeopleCommandFacade({ ...implementation, writeMediaCast() {} }),
    (error) => error.code === 'P6_PEOPLE_FACADE_SHAPE_MISMATCH');
  assert.throws(() => people.PersonReferenceQueryFacade({ query() {} }),
    (error) => error.code === 'P6_PEOPLE_FACADE_SHAPE_MISMATCH');
  const query = people.PersonReferenceQueryFacade({ getPersonReferenceProjection: (input) => ({ owner: 'people', input }) });
  assert.deepEqual(query.getPersonReferenceProjection({ personId: 'p-1' }), { owner: 'people', input: { personId: 'p-1' } });
});
