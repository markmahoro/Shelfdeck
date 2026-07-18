'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { validateExtractionPolicyValue } = require('./material-field-contracts');

class ExtractionEligibilityError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'ExtractionEligibilityError'; this.code = code; this.details = details; }
}
function fail(code, message, details) { throw new ExtractionEligibilityError(code, message, details); }
function exact(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(value, key))) fail(code, 'Extraction Eligibility input does not match its closed contract.');
}
function directoryMatch(location, directory) { return location.startsWith(directory + '/'); }
function outcome(decision, decisionState, controlProjection, reasonCode) {
  const result = Object.freeze({ ...decision, decisionState, controlProjection, reasonCode });
  return Object.freeze({ ...result, basisDigest: canonicalDigest(Object.fromEntries(Object.entries(result)
    .filter(([key]) => !['decisionState','controlProjection','reasonCode','basisDigest'].includes(key)))) });
}

function evaluateExtractionEligibility(decision) {
  const keys = ['fieldId','fieldStatus','materialKey','expectedEligibilityRevision','accessRevision','accessDigest',
    'terminalObservationRevision','fieldObservationWorkId','materialBindingRevision','lastSnapshotDigest','lastObservationId',
    'appearedInTerminalWork','materialRelativeLocation','sizeBytes','observedExtension','extractionPolicy','selectionSnapshot',
    'controlSnapshot'];
  exact(decision, keys, 'P7_ELIGIBILITY_DECISION_SHAPE');
  if (!['active','disabled'].includes(decision.fieldStatus) || !Number.isSafeInteger(decision.expectedEligibilityRevision) ||
      decision.expectedEligibilityRevision < 1 || !Number.isSafeInteger(decision.sizeBytes) || decision.sizeBytes < 0) {
    fail('P7_ELIGIBILITY_DECISION_VALUE', 'Extraction Eligibility scalar input is invalid.');
  }
  const policy = decision.extractionPolicy;
  try { validateExtractionPolicyValue(policy); } catch (error) { return outcome(decision, 'unknown', 'unknown', 'policy_unavailable_or_invalid'); }
  const control = decision.controlSnapshot;
  if (!control || control.resultKind !== 'available') return outcome(decision, 'unknown', 'unknown', 'control_projection_unavailable');
  const projection = control.regionProjection;
  if (decision.fieldStatus !== 'active') return outcome(decision, 'ineligible', projection, 'field_inactive');
  if (!decision.appearedInTerminalWork) return outcome(decision, 'ineligible', projection, 'not_observed_in_current_terminal_work');
  if (projection === 'production' || projection === 'finished_goods') return outcome(decision, 'ineligible', projection, 'outside_procurement_region');
  if (decision.selectionSnapshot.hasConflict) return outcome(decision, 'ineligible', projection, 'selection_conflict');
  if (projection === 'procurement' && decision.selectionSnapshot.activeSelections.length === 0) return outcome(decision, 'ineligible', projection, 'control_not_acquirable');
  if (policy.excludedMaterialKeys.includes(decision.materialKey)) return outcome(decision, 'ineligible', projection, 'policy_material_excluded');
  if (policy.excludedDirectories.some((directory) => directoryMatch(decision.materialRelativeLocation, directory))) return outcome(decision, 'ineligible', projection, 'policy_directory_excluded');
  if (policy.includedDirectories.length && !policy.includedDirectories.some((directory) => directoryMatch(decision.materialRelativeLocation, directory))) return outcome(decision, 'ineligible', projection, 'policy_directory_not_included');
  if (policy.allowedExtensions.length && !policy.allowedExtensions.includes(decision.observedExtension)) return outcome(decision, 'ineligible', projection, 'policy_extension_not_allowed');
  if (decision.sizeBytes < policy.minimumSizeBytes) return outcome(decision, 'ineligible', projection, 'policy_size_below_minimum');
  return outcome(decision, 'eligible', projection, 'eligible');
}

module.exports = Object.freeze({ ExtractionEligibilityError, evaluateExtractionEligibility });
