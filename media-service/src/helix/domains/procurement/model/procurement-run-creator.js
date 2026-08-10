'use strict';

const path = require('node:path');
const { canonicalDigest } = require('../../../contracts/canonical-json');
const {
  normalized: normalizeScopeLocation,
  resolveBdmvContainerScope,
} = require('./bdmv-scope');

const MAX_RUN_PHYSICAL_MEMBERS = 1024;
const MAX_SELECTION_SCOPE_MEMBERS = 1024;
const SCOPE_KINDS = Object.freeze(['standalone_file', 'ordinary_directory', 'bdmv_container']);

class ProcurementRunCreatorError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProcurementRunCreatorError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new ProcurementRunCreatorError(code, message, details);
}

function utf8Compare(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function normalizedRelativeLocation(value) {
  if (typeof value !== 'string' || value.length === 0 || path.isAbsolute(value)) {
    fail('P7_RUN_CREATOR_LOCATION_INVALID', 'Run Creator requires a non-empty Field-relative location.');
  }
  const normalized = normalizeScopeLocation(value.replace(/^\.\//, ''));
  if (!normalized || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    fail('P7_RUN_CREATOR_LOCATION_INVALID', 'Run Creator location escapes the Material Field.');
  }
  return normalized;
}

function directParent(relativeLocation) {
  const index = relativeLocation.lastIndexOf('/');
  return index < 0 ? '.' : relativeLocation.slice(0, index) || '.';
}

function nearestBdmvRoot(relativeLocation) {
  return resolveBdmvContainerScope(relativeLocation)?.bdmvRootRelativeLocation || null;
}

function bdmvContainerRoot(relativeLocation, knownLocations = []) {
  return resolveBdmvContainerScope(relativeLocation, knownLocations)?.containerRelativeLocation || null;
}

function topLevelDirectory(relativeLocation) {
  const index = relativeLocation.indexOf('/');
  return index < 0 ? null : relativeLocation.slice(0, index);
}

function scopeFor(relativeLocation, knownLocations) {
  const bdmv = resolveBdmvContainerScope(relativeLocation, knownLocations);
  if (bdmv) return Object.freeze({
    scopeKind: 'bdmv_container',
    scopeKey: bdmv.groupKey,
    scopeRootRelativeLocation: bdmv.containerRelativeLocation,
    bdmvRootRelativeLocation: bdmv.bdmvRootRelativeLocation,
  });
  const directory = topLevelDirectory(relativeLocation);
  if (directory) return Object.freeze({
    scopeKind: 'ordinary_directory',
    scopeKey: 'ordinary-directory:' + directory,
    scopeRootRelativeLocation: directory,
    bdmvRootRelativeLocation: null,
  });
  return Object.freeze({
    scopeKind: 'standalone_file',
    scopeKey: 'standalone-file:' + relativeLocation,
    scopeRootRelativeLocation: relativeLocation,
    bdmvRootRelativeLocation: null,
  });
}

function buildScope(rawScope) {
  const members = rawScope.members
    .sort((left, right) => utf8Compare(left.relativeLocation, right.relativeLocation) ||
      utf8Compare(left.materialKey, right.materialKey))
    .map((member, scopeMemberOrdinal) => Object.freeze({
      ...member,
      fieldRelativeLocation: member.relativeLocation,
      scopeMemberOrdinal,
    }));
  const memberSetDigest = canonicalDigest({
    schema: 'procurement.selection-scope-members@1',
    items: members.map((member) => ({
      materialKey: member.materialKey,
      fieldRelativeLocation: member.fieldRelativeLocation,
      scopeMemberOrdinal: member.scopeMemberOrdinal,
    })),
  });
  const scopeValue = {
    scopeKind: rawScope.scopeKind,
    scopeKey: rawScope.scopeKey,
    scopeRootRelativeLocation: rawScope.scopeRootRelativeLocation,
    memberCount: members.length,
    memberSetDigest,
  };
  return Object.freeze({
    ...scopeValue,
    scopeDigest: canonicalDigest({ schema:'procurement.selection-scope@1', ...scopeValue }),
    ...(rawScope.bdmvRootRelativeLocation ? { bdmvRootRelativeLocation:rawScope.bdmvRootRelativeLocation } : {}),
    members: Object.freeze(members),
  });
}

function createProcurementRunSlices(input) {
  const maxRunPhysicalMembers = input?.maxRunPhysicalMembers === undefined
    ? MAX_RUN_PHYSICAL_MEMBERS : input.maxRunPhysicalMembers;
  const maxSelectionScopeMembers = input?.maxSelectionScopeMembers === undefined
    ? MAX_SELECTION_SCOPE_MEMBERS : input.maxSelectionScopeMembers;
  if (!input || typeof input.fieldId !== 'string' || !input.fieldId ||
      typeof input.creationBasisDigest !== 'string' || !/^[0-9a-f]{64}$/.test(input.creationBasisDigest) ||
      !Array.isArray(input.materials) || !Number.isSafeInteger(maxRunPhysicalMembers) ||
      maxRunPhysicalMembers < 1 || maxRunPhysicalMembers > MAX_RUN_PHYSICAL_MEMBERS ||
      !Number.isSafeInteger(maxSelectionScopeMembers) || maxSelectionScopeMembers < 1 ||
      maxSelectionScopeMembers > MAX_SELECTION_SCOPE_MEMBERS) {
    fail('P7_RUN_CREATOR_INPUT_INVALID', 'Run Creator input does not match its closed contract.');
  }

  const normalizedMaterials = input.materials.map((material) => Object.freeze({
    ...material,
    relativeLocation: normalizedRelativeLocation(material.relativeLocation),
  }));
  const knownLocations = normalizedMaterials.map((material) => material.relativeLocation);
  const seen = new Set();
  const scopesByKey = new Map();
  for (const material of normalizedMaterials) {
    if (!material || typeof material.materialKey !== 'string' || !material.materialKey || seen.has(material.materialKey)) {
      fail('P7_RUN_CREATOR_MATERIAL_INVALID', 'Run Creator Material keys must be non-empty and unique.');
    }
    seen.add(material.materialKey);
    const scope = scopeFor(material.relativeLocation, knownLocations);
    const existing = scopesByKey.get(scope.scopeKey);
    if (existing && (existing.scopeKind !== scope.scopeKind ||
        existing.scopeRootRelativeLocation !== scope.scopeRootRelativeLocation)) {
      fail('P7_RUN_CREATOR_SCOPE_CONFLICT', 'Run Creator resolved one Scope key to conflicting boundaries.');
    }
    if (!existing) scopesByKey.set(scope.scopeKey, { ...scope, members:[] });
    scopesByKey.get(scope.scopeKey).members.push(material);
  }

  const orderedScopes = [...scopesByKey.values()]
    .map(buildScope)
    .sort((left, right) => utf8Compare(left.scopeKey, right.scopeKey));
  const closedGroups = [];
  const packedScopes = [];
  let current = [];
  let currentMemberCount = 0;
  for (const scope of orderedScopes) {
    if (scope.memberCount > maxSelectionScopeMembers) {
      closedGroups.push(Object.freeze({
        scopeKind: scope.scopeKind,
        scopeKey: scope.scopeKey,
        scopeRootRelativeLocation: scope.scopeRootRelativeLocation,
        memberCount: scope.memberCount,
        reasonCode: 'procurement_selection_scope_too_large',
      }));
      continue;
    }
    if (current.length > 0 && currentMemberCount + scope.memberCount > maxRunPhysicalMembers) {
      packedScopes.push(current);
      current = [];
      currentMemberCount = 0;
    }
    current.push(scope);
    currentMemberCount += scope.memberCount;
  }
  if (current.length > 0) packedScopes.push(current);

  const runs = packedScopes.map((runScopes, ordinal) => {
    const selectionScopes = runScopes.map((scope, scopeOrdinal) => Object.freeze({
      scopeOrdinal,
      scopeKind: scope.scopeKind,
      scopeKey: scope.scopeKey,
      scopeRootRelativeLocation: scope.scopeRootRelativeLocation,
      memberCount: scope.memberCount,
      memberSetDigest: scope.memberSetDigest,
      scopeDigest: scope.scopeDigest,
    }));
    const scopeSetDigest = canonicalDigest({ schema:'procurement.selection-scope-set@1', scopes:selectionScopes });
    const physicalMemberCount = selectionScopes.reduce((total, scope) => total + scope.memberCount, 0);
    const members = runScopes.flatMap((scope, scopeOrdinal) => scope.members.map((member) => Object.freeze({
      ...member,
      scopeOrdinal,
      selectionScopeKind: scope.scopeKind,
      selectionScopeKey: scope.scopeKey,
      selectionScopeRootRelativeLocation: scope.scopeRootRelativeLocation,
      selectionScopeMemberCount: scope.memberCount,
      selectionScopeMemberSetDigest: scope.memberSetDigest,
      selectionScopeDigest: scope.scopeDigest,
    }))).sort((left, right) => utf8Compare(left.materialKey, right.materialKey))
      .map((member, memberOrdinal) => Object.freeze({ ...member, ordinal:memberOrdinal }));
    const selectionDigest = canonicalDigest({
      schema: 'procurement.run-creator-selection@2',
      fieldId: input.fieldId,
      creationBasisDigest: input.creationBasisDigest,
      physicalMemberCount,
      selectionScopeCount: selectionScopes.length,
      scopeSetDigest,
      materialKeys: members.map((member) => member.materialKey),
    });
    return Object.freeze({
      ordinal,
      procurementRunId: 'procurement-run-' + canonicalDigest({
        schema: 'procurement.run-creator-identity@2',
        fieldId: input.fieldId,
        creationBasisDigest: input.creationBasisDigest,
        selectionDigest,
      }).slice(0, 40),
      selectionDigest,
      physicalMemberCount,
      selectionScopeCount: selectionScopes.length,
      selectionScopes: Object.freeze(selectionScopes),
      scopeSetDigest,
      members: Object.freeze(members),
    });
  });
  return Object.freeze({
    maxRunPhysicalMembers,
    maxSelectionScopeMembers,
    runs: Object.freeze(runs),
    closedGroups: Object.freeze(closedGroups),
  });
}

module.exports = Object.freeze({
  MAX_RUN_PHYSICAL_MEMBERS,
  MAX_SELECTION_SCOPE_MEMBERS,
  SCOPE_KINDS,
  ProcurementRunCreatorError,
  createProcurementRunSlices,
  directParent,
  nearestBdmvRoot,
  bdmvContainerRoot,
  scopeFor,
  utf8Compare,
});
