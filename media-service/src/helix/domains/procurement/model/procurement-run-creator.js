'use strict';

const path = require('node:path');
const { canonicalDigest } = require('../../../contracts/canonical-json');

const DEFAULT_MAX_SELECTION = 256;
// A BDMV container occupies one logical Run slot, but its observed physical
// members (PLAYLIST/STREAM/CLIPINF/index/CERTIFICATE) must remain in the same
// immutable Run scope.  This is deliberately separate from the ordinary
// directory-member limit; it is a bounded topology guard, not a general Run
// size increase.
// Keep the logical BDMV slot separate from ordinary directory packing while
// respecting the sealed atomic Control Handle scope used by Run Admission.
const DEFAULT_MAX_BDMV_MEMBERS = 1024;

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
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    fail('P7_RUN_CREATOR_LOCATION_INVALID', 'Run Creator location escapes the Material Field.');
  }
  return normalized;
}

function directParent(relativeLocation) {
  const index = relativeLocation.lastIndexOf('/');
  return index < 0 ? '' : relativeLocation.slice(0, index);
}

function nearestBdmvRoot(relativeLocation) {
  const parts = relativeLocation.split('/');
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    if (parts[index].toUpperCase() === 'BDMV') return parts.slice(0, index + 1).join('/');
  }
  return null;
}

function bdmvContainerRoot(relativeLocation) {
  const parts = relativeLocation.split('/');
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    if (parts[index].toUpperCase() === 'BDMV') return parts.slice(0, index).join('/') || '.';
  }
  return null;
}

function groupFor(relativeLocation, knownContainers) {
  const bdmvRoot = nearestBdmvRoot(relativeLocation);
  const containerRoot = bdmvContainerRoot(relativeLocation);
  if (containerRoot) {
    return { groupKind:'bdmv', groupKey:'bdmv:' + containerRoot, directParent:containerRoot,
      bdmvRoot, containerRoot, logicalWeight:1 };
  }
  // CERTIFICATE is a sibling of BDMV in a disc folder.  It has no BDMV
  // ancestor of its own, so attach it only when the same container was proven
  // by another observed BDMV member.  A standalone CERTIFICATE directory
  // remains an ordinary directory and is handled by normal media rules.
  const parent = directParent(relativeLocation);
  const parentParts = parent.split('/');
  if (parentParts.at(-1)?.toUpperCase() === 'CERTIFICATE') {
    const candidate = parentParts.slice(0, -1).join('/') || '.';
    if (knownContainers.has(candidate)) {
      return { groupKind:'bdmv', groupKey:'bdmv:' + candidate, directParent:candidate,
        bdmvRoot:candidate === '.' ? 'BDMV' : candidate + '/BDMV', containerRoot:candidate, logicalWeight:1 };
    }
  }
  return { groupKind:'directory', groupKey:'directory:' + parent, directParent:parent,
    bdmvRoot:null, containerRoot:null, logicalWeight:1 };
}

function createProcurementRunSlices(input) {
  const maxSelection = input?.maxSelection === undefined ? DEFAULT_MAX_SELECTION : input.maxSelection;
  const maxBdmvMembers = input?.maxBdmvMembers === undefined ? DEFAULT_MAX_BDMV_MEMBERS : input.maxBdmvMembers;
  if (!input || typeof input.fieldId !== 'string' || !input.fieldId ||
      typeof input.creationBasisDigest !== 'string' || !/^[0-9a-f]{64}$/.test(input.creationBasisDigest) ||
      !Array.isArray(input.materials) || !Number.isSafeInteger(maxSelection) || maxSelection < 1 || maxSelection > 256 ||
      !Number.isSafeInteger(maxBdmvMembers) || maxBdmvMembers < 1 || maxBdmvMembers > DEFAULT_MAX_BDMV_MEMBERS) {
    fail('P7_RUN_CREATOR_INPUT_INVALID', 'Run Creator input does not match its closed contract.');
  }
  const normalizedMaterials = input.materials.map((material) => Object.freeze({
    ...material, relativeLocation: normalizedRelativeLocation(material.relativeLocation),
  }));
  const knownContainers = new Set(normalizedMaterials.map((material) => bdmvContainerRoot(material.relativeLocation)).filter(Boolean));
  const seen = new Set();
  const groups = new Map();
  for (const material of normalizedMaterials) {
    if (!material || typeof material.materialKey !== 'string' || !material.materialKey || seen.has(material.materialKey)) {
      fail('P7_RUN_CREATOR_MATERIAL_INVALID', 'Run Creator Material keys must be non-empty and unique.');
    }
    seen.add(material.materialKey);
    const relativeLocation = material.relativeLocation;
    const group = groupFor(relativeLocation, knownContainers);
    const member = Object.freeze({ ...material, relativeLocation, directParent: group.directParent });
    if (!groups.has(group.groupKey)) groups.set(group.groupKey, { ...group, members:[] });
    groups.get(group.groupKey).members.push(member);
  }
  const orderedGroups = [...groups.values()]
    .map((group) => Object.freeze({
      groupKind:group.groupKind, groupKey:group.groupKey, bdmvRoot:group.bdmvRoot, containerRoot:group.containerRoot,
      directParent:group.directParent, logicalWeight:group.groupKind === 'bdmv' ? 1 : group.members.length,
      members: Object.freeze(group.members.sort((left, right) =>
        utf8Compare(left.relativeLocation, right.relativeLocation) || utf8Compare(left.materialKey, right.materialKey))),
    }))
    .sort((left, right) => utf8Compare(left.groupKey, right.groupKey));

  const closedGroups = [];
  const packed = [];
  let current = [];
  let currentLogicalWeight = 0;
  let currentPhysicalWeight = 0;
  for (const group of orderedGroups) {
    const physicalLimit = group.groupKind === 'bdmv' ? maxBdmvMembers : maxSelection;
    if (group.members.length > physicalLimit) {
      closedGroups.push(Object.freeze({
        directParent: group.directParent,
        ...(group.bdmvRoot ? { bdmvRoot:group.bdmvRoot } : {}),
        ...(group.containerRoot ? { containerRoot:group.containerRoot } : {}),
        groupKind:group.groupKind,
        memberCount: group.members.length,
        reasonCode: 'procurement_selection_scope_too_large',
      }));
      continue;
    }
    // Logical capacity keeps the normal 256-group scheduling contract stable;
    // physical capacity keeps the selected material set admissible when a run
    // contains several BDMV containers, each of which occupies one logical
    // slot but contributes all of its structural members to the immutable
    // Foundation input.
    if (current.length > 0 && (currentLogicalWeight + group.logicalWeight > maxSelection ||
        currentPhysicalWeight + group.members.length > DEFAULT_MAX_BDMV_MEMBERS)) {
      packed.push(current);
      current = [];
      currentLogicalWeight = 0;
      currentPhysicalWeight = 0;
    }
    current.push(...group.members);
    currentLogicalWeight += group.logicalWeight;
    currentPhysicalWeight += group.members.length;
  }
  if (current.length > 0) packed.push(current);

  const runs = packed.map((members, ordinal) => {
    const materialKeys = members.map((member) => member.materialKey);
    const selectionDigest = canonicalDigest({
      schema: 'procurement.run-creator-selection@1',
      fieldId: input.fieldId,
      creationBasisDigest: input.creationBasisDigest,
      materialKeys,
    });
    const groupByKey = new Map(orderedGroups.map((group) => [group.groupKey, group]));
    const logicalSelectionCount = [...new Set(members.map((member) =>
      groupFor(member.relativeLocation, knownContainers).groupKey))]
      .reduce((sum, key) => sum + (groupByKey.get(key)?.logicalWeight || 0), 0);
    return Object.freeze({
      ordinal,
      procurementRunId: 'procurement-run-' + canonicalDigest({
        schema: 'procurement.run-creator-identity@1',
        fieldId: input.fieldId,
        creationBasisDigest: input.creationBasisDigest,
        selectionDigest,
      }).slice(0, 40),
      selectionDigest,
      logicalSelectionCount,
      members: Object.freeze(members.map((member, memberOrdinal) => Object.freeze({ ...member, ordinal: memberOrdinal }))),
    });
  });
  return Object.freeze({
    maxSelection,
    maxBdmvMembers,
    runs: Object.freeze(runs),
    closedGroups: Object.freeze(closedGroups),
  });
}

module.exports = Object.freeze({
  DEFAULT_MAX_SELECTION,
  DEFAULT_MAX_BDMV_MEMBERS,
  ProcurementRunCreatorError,
  createProcurementRunSlices,
  directParent,
  nearestBdmvRoot,
  bdmvContainerRoot,
  utf8Compare,
});
