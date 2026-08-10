'use strict';

const { canonicalDigest } = require('../../../src/helix/contracts/canonical-json');

function without(value, ...keys) {
  const copy = { ...value };
  for (const key of keys) delete copy[key];
  return copy;
}

function createSingleScopeSelection(input) {
  const scopeKind = input.scopeKind || 'ordinary_directory';
  const scopeKey = input.scopeKey || 'ordinary-directory:Fixture';
  const scopeRootRelativeLocation = input.scopeRootRelativeLocation || 'Fixture';
  const members = input.members.map((member, scopeMemberOrdinal) => {
    const value = {
      ...without(member, 'basisMemberDigest'),
      ordinal: scopeMemberOrdinal,
      fieldRelativeLocation: member.fieldRelativeLocation || member.location,
      scopeOrdinal: 0,
      scopeMemberOrdinal,
    };
    return { ...value, basisMemberDigest: canonicalDigest(value) };
  });
  const memberSetDigest = canonicalDigest({
    schema: 'procurement.selection-scope-members@1',
    items: members.map((member) => ({
      materialKey: member.materialKey,
      fieldRelativeLocation: member.fieldRelativeLocation,
      scopeMemberOrdinal: member.scopeMemberOrdinal,
    })),
  });
  const scopeValue = {
    scopeOrdinal: 0,
    scopeKind,
    scopeKey,
    scopeRootRelativeLocation,
    memberCount: members.length,
    memberSetDigest,
  };
  const selectionScopes = [{
    ...scopeValue,
    scopeDigest: canonicalDigest({
      schema: 'procurement.selection-scope@1',
      scopeKind,
      scopeKey,
      scopeRootRelativeLocation,
      memberCount: members.length,
      memberSetDigest,
    }),
  }];
  const scopeSetDigest = canonicalDigest({
    schema: 'procurement.selection-scope-set@1',
    scopes: selectionScopes,
  });
  const value = {
    procurementRunId: input.procurementRunId || 'run-1',
    fieldId: input.fieldId || 'field-1',
    physicalMemberCount: members.length,
    selectionScopeCount: 1,
    selectionScopes,
    scopeSetDigest,
    members,
  };
  return {
    ...value,
    selectionDigest: canonicalDigest({
      schema: 'procurement.selected-field-material-set@2',
      ...value,
    }),
  };
}

module.exports = Object.freeze({ createSingleScopeSelection });
