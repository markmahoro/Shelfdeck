'use strict';

const path = require('node:path');
const { canonicalDigest } = require('../../../contracts/canonical-json');

const DEFAULT_MAX_SELECTION = 256;

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

function groupFor(relativeLocation) {
  const bdmvRoot = nearestBdmvRoot(relativeLocation);
  return bdmvRoot ? { groupKind:'bdmv', groupKey:'bdmv:' + bdmvRoot, directParent:bdmvRoot, bdmvRoot }
    : { groupKind:'directory', groupKey:'directory:' + directParent(relativeLocation), directParent:directParent(relativeLocation), bdmvRoot:null };
}

function createProcurementRunSlices(input) {
  const maxSelection = input?.maxSelection === undefined ? DEFAULT_MAX_SELECTION : input.maxSelection;
  if (!input || typeof input.fieldId !== 'string' || !input.fieldId ||
      typeof input.creationBasisDigest !== 'string' || !/^[0-9a-f]{64}$/.test(input.creationBasisDigest) ||
      !Array.isArray(input.materials) || !Number.isSafeInteger(maxSelection) || maxSelection < 1 || maxSelection > 256) {
    fail('P7_RUN_CREATOR_INPUT_INVALID', 'Run Creator input does not match its closed contract.');
  }
  const seen = new Set();
  const groups = new Map();
  for (const material of input.materials) {
    if (!material || typeof material.materialKey !== 'string' || !material.materialKey || seen.has(material.materialKey)) {
      fail('P7_RUN_CREATOR_MATERIAL_INVALID', 'Run Creator Material keys must be non-empty and unique.');
    }
    seen.add(material.materialKey);
    const relativeLocation = normalizedRelativeLocation(material.relativeLocation);
    const group = groupFor(relativeLocation);
    const member = Object.freeze({ ...material, relativeLocation, directParent: group.directParent });
    if (!groups.has(group.groupKey)) groups.set(group.groupKey, { ...group, members:[] });
    groups.get(group.groupKey).members.push(member);
  }
  const orderedGroups = [...groups.values()]
    .map((group) => Object.freeze({
      groupKind:group.groupKind, groupKey:group.groupKey, bdmvRoot:group.bdmvRoot, directParent:group.directParent,
      members: Object.freeze(group.members.sort((left, right) =>
        utf8Compare(left.relativeLocation, right.relativeLocation) || utf8Compare(left.materialKey, right.materialKey))),
    }))
    .sort((left, right) => utf8Compare(left.groupKey, right.groupKey));

  const closedGroups = [];
  const packed = [];
  let current = [];
  for (const group of orderedGroups) {
    if (group.members.length > maxSelection) {
      closedGroups.push(Object.freeze({
        directParent: group.directParent,
        ...(group.bdmvRoot ? { bdmvRoot:group.bdmvRoot } : {}),
        groupKind:group.groupKind,
        memberCount: group.members.length,
        reasonCode: 'procurement_selection_scope_too_large',
      }));
      continue;
    }
    if (current.length > 0 && current.length + group.members.length > maxSelection) {
      packed.push(current);
      current = [];
    }
    current.push(...group.members);
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
    return Object.freeze({
      ordinal,
      procurementRunId: 'procurement-run-' + canonicalDigest({
        schema: 'procurement.run-creator-identity@1',
        fieldId: input.fieldId,
        creationBasisDigest: input.creationBasisDigest,
        selectionDigest,
      }).slice(0, 40),
      selectionDigest,
      members: Object.freeze(members.map((member, memberOrdinal) => Object.freeze({ ...member, ordinal: memberOrdinal }))),
    });
  });
  return Object.freeze({
    maxSelection,
    runs: Object.freeze(runs),
    closedGroups: Object.freeze(closedGroups),
  });
}

module.exports = Object.freeze({
  DEFAULT_MAX_SELECTION,
  ProcurementRunCreatorError,
  createProcurementRunSlices,
  directParent,
  nearestBdmvRoot,
  utf8Compare,
});
