'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  deriveOnDeckControlChanges,
} = require('../../src/helix/domains/arca/persistence/on-deck-store');

function material(seed) {
  const materialKey = seed.repeat(64).slice(0, 64);
  return Object.freeze({
    materialKey,
    physicalIdentity: Object.freeze({ materialKey }),
  });
}

function control(member, overrides = {}) {
  return Object.freeze({
    materialKey: member.materialKey,
    resultKind: 'available',
    controlRevision: 3,
    controlState: 'controlled',
    ownerDomain: 'arca',
    ownerScopeType: 'on_deck_custody',
    ownerScopeId: 'custody-1',
    projectionDigest: `projection-${member.materialKey}`,
    ...overrides,
  });
}

test('UAT-112 retained Physical Material transfers from Custody to Shelf Entry', () => {
  const retained = material('a');
  const projection = control(retained);
  const changes = deriveOnDeckControlChanges({
    oldMaterials: new Map([[retained.materialKey, retained]]),
    stagedMembers: [retained],
    custodyControls: [projection],
    targetControls: [projection],
    custodyId: 'custody-1',
    shelfEntryId: 'entry-1',
  });

  assert.deepEqual(changes, [{
    identity: retained.physicalIdentity,
    action: 'transfer',
    expectedRevision: 3,
    expectedProjectionDigest: projection.projectionDigest,
    fromScope: {
      ownerDomain: 'arca',
      scopeType: 'on_deck_custody',
      scopeId: 'custody-1',
    },
    toScope: {
      ownerDomain: 'arca',
      scopeType: 'shelf_entry',
      scopeId: 'entry-1',
    },
  }]);
});

test('UAT-112 replacement releases old Material and acquires a released target at its current revision', () => {
  const oldMember = material('a');
  const replacement = material('b');
  const oldControl = control(oldMember);
  const targetControl = control(replacement, {
    controlRevision: 7,
    controlState: 'uncontrolled',
    ownerDomain: undefined,
    ownerScopeType: undefined,
    ownerScopeId: undefined,
  });
  const changes = deriveOnDeckControlChanges({
    oldMaterials: new Map([[oldMember.materialKey, oldMember]]),
    stagedMembers: [replacement],
    custodyControls: [oldControl],
    targetControls: [targetControl],
    custodyId: 'custody-1',
    shelfEntryId: 'entry-1',
  });

  assert.equal(changes[0].action, 'release');
  assert.equal(changes[0].expectedRevision, 3);
  assert.equal(changes[1].action, 'acquire');
  assert.equal(changes[1].expectedRevision, 7);
});

test('UAT-112 retained Material rejects divergent Control projections', () => {
  const retained = material('a');
  const custodyControl = control(retained);
  assert.throws(() => deriveOnDeckControlChanges({
    oldMaterials: new Map([[retained.materialKey, retained]]),
    stagedMembers: [retained],
    custodyControls: [custodyControl],
    targetControls: [control(retained, { projectionDigest: 'changed' })],
    custodyId: 'custody-1',
    shelfEntryId: 'entry-1',
  }), (error) => error &&
    error.code === 'P14_ONDECK_CONTROL_PROJECTION_DRIFT');
});
