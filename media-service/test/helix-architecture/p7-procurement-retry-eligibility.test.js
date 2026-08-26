'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createRetryConsumeMemberSnapshot,
  retryEligibilityAvailable,
  retryMemberStaleReason,
} = require('../../src/helix/domains/procurement/model/procurement-retry-contracts');

function retainedControl(fieldId = 'field-1') {
  return Object.freeze({
    materialKey: 'a'.repeat(64),
    resultKind: 'available',
    controlRevision: 4,
    controlState: 'controlled',
    ownerDomain: 'procurement',
    ownerScopeType: 'material_field',
    ownerScopeId: fieldId,
    regionProjection: 'procurement',
    evidenceDigest: 'b'.repeat(64),
    projectionDigest: 'c'.repeat(64),
  });
}

function emptySelection() {
  return Object.freeze({
    materialKey: 'a'.repeat(64),
    activeGuards: Object.freeze([]),
    hasConflict: false,
    selectionBasisDigest: 'd'.repeat(64),
  });
}

function actual(overrides = {}) {
  return Object.freeze({
    materialState: 'present',
    currentBindingRevision: 1,
    currentEligibilityRevision: 5,
    currentEligibilityState: 'ineligible',
    currentEligibilityReasonCode: 'selection_conflict',
    currentEligibilityBasisDigest: 'e'.repeat(64),
    currentSelection: emptySelection(),
    currentControlSnapshot: retainedControl(),
    ...overrides,
  });
}

test('explicit retry accepts a released failed Selection retained by the same Material Field', () => {
  assert.equal(retryEligibilityAvailable(actual(), 'field-1'), true);
  assert.equal(retryEligibilityAvailable(actual({
    currentEligibilityReasonCode: 'control_not_acquirable',
  }), 'field-1'), true);
});

test('explicit retry does not bypass policy, live Selection, or another Owner control', () => {
  assert.equal(retryEligibilityAvailable(actual({ currentEligibilityReasonCode: 'policy_material_excluded' }), 'field-1'), false);
  assert.equal(retryEligibilityAvailable(actual({
    currentSelection: Object.freeze({ ...emptySelection(), activeGuards: Object.freeze([Object.freeze({})]), hasConflict: true }),
  }), 'field-1'), false);
  assert.equal(retryEligibilityAvailable(actual({ currentControlSnapshot: retainedControl('field-2') }), 'field-1'), false);
});

test('retry freshness accepts the retained-control exception only while every frozen precondition still matches', () => {
  const expected = Object.freeze({
    expectedBindingRevision: 1,
    expectedEligibilityRevision: 5,
    expectedEligibilityBasisDigest: 'e'.repeat(64),
    expectedSelectionBasisDigest: 'd'.repeat(64),
    expectedControlSnapshot: retainedControl(),
  });
  assert.equal(retryMemberStaleReason(expected, actual(), 'field-1'), null);
  assert.equal(retryMemberStaleReason(expected, actual({ currentEligibilityRevision: 6 }), 'field-1'), 'material_eligibility_changed');
});

test('retry consume evidence preserves the current Eligibility reason', () => {
  const snapshot = createRetryConsumeMemberSnapshot({
    retryIntentId: 'retry-1',
    expectedMember: Object.freeze({
      ordinal: 0,
      materialKey: 'a'.repeat(64),
      expectedBindingRevision: 1,
      expectedEligibilityRevision: 5,
      expectedEligibilityBasisDigest: 'e'.repeat(64),
      expectedSelectionBasisDigest: 'd'.repeat(64),
      expectedControlSnapshot: retainedControl(),
    }),
    actual: actual(),
    fieldId: 'field-1',
    currentAdmissionHeadDigest: 'f'.repeat(64),
    headReason: null,
  });
  assert.equal(snapshot.consumeOutcome, 'matched');
  assert.equal(snapshot.currentEligibilityReasonCode, 'selection_conflict');
});
