'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');

function compareGuards(left, right) {
  return left.guardKind.localeCompare(right.guardKind) ||
    left.procurementRunId.localeCompare(right.procurementRunId) ||
    (left.candidatePackageId || '').localeCompare(right.candidatePackageId || '') ||
    left.selectionRole.localeCompare(right.selectionRole);
}

function createMaterialSelectionSnapshot(materialKey, activeGuards) {
  const value = { materialKey, activeGuards: [...activeGuards].sort(compareGuards), hasConflict: activeGuards.length > 0 };
  return Object.freeze({ ...value, selectionBasisDigest: canonicalDigest(value) });
}

function selectionGuard(run, member, candidate) {
  if (!member || !['run_selection', 'candidate_delivery'].includes(member.selection_state)) return null;
  if (member.selection_state === 'candidate_delivery' && !candidate) {
    throw Object.assign(new Error('Delivery guard requires its immutable Candidate Package.'), { code: 'P7_SELECTION_PACKAGE_MISSING' });
  }
  return {
    guardKind: member.selection_state,
    procurementRunId: run.procurement_run_id,
    runState: run.state,
    ...(member.selection_state === 'candidate_delivery' ? {
      candidatePackageId: candidate.candidate_package_id, packageDigest: candidate.package_digest,
    } : {}),
    selectionRole: member.selection_role,
    bindingRevision: Number(member.binding_revision),
  };
}

module.exports = Object.freeze({ compareGuards, createMaterialSelectionSnapshot, selectionGuard });
