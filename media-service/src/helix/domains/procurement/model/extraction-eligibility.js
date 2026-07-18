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
function validateSelectionSnapshot(value, materialKey) {
  exact(value, ['materialKey','activeSelections','hasConflict','selectionBasisDigest'], 'P7_ELIGIBILITY_SELECTION_SHAPE');
  if (value.materialKey !== materialKey || !Array.isArray(value.activeSelections) || value.hasConflict !== (value.activeSelections.length > 0) ||
      value.activeSelections.some((item) => {
        try { exact(item, ['procurementRunId','runState','selectionRole','bindingRevision'], 'P7_ELIGIBILITY_SELECTION_ITEM'); }
        catch (error) { return true; }
        return typeof item.procurementRunId !== 'string' || !item.procurementRunId || !['active','waiting'].includes(item.runState) ||
          typeof item.selectionRole !== 'string' || !item.selectionRole || !Number.isSafeInteger(item.bindingRevision) || item.bindingRevision < 1;
      }) || value.activeSelections.some((item, index) => index > 0 &&
        (value.activeSelections[index - 1].procurementRunId.localeCompare(item.procurementRunId) > 0 ||
         value.activeSelections[index - 1].procurementRunId === item.procurementRunId &&
         value.activeSelections[index - 1].selectionRole.localeCompare(item.selectionRole) >= 0)) ||
      canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'selectionBasisDigest'))) !== value.selectionBasisDigest) {
    fail('P7_ELIGIBILITY_SELECTION_INVALID', 'Material Selection snapshot is invalid.');
  }
}
function validateControlSnapshot(value, materialKey) {
  const unavailable = value && value.resultKind === 'unavailable';
  const controlled = value && value.resultKind === 'available' && value.controlState === 'controlled';
  const keys = unavailable ? ['materialKey','resultKind','failureCode','evidenceDigest','projectionDigest'] : controlled
    ? ['materialKey','resultKind','controlRevision','controlState','ownerDomain','ownerScopeType','ownerScopeId','regionProjection','evidenceDigest','projectionDigest']
    : ['materialKey','resultKind','controlRevision','controlState','regionProjection','evidenceDigest','projectionDigest'];
  exact(value, keys, 'P7_ELIGIBILITY_CONTROL_SHAPE');
  const validValue = value.materialKey === materialKey && (unavailable
    ? typeof value.failureCode === 'string' && value.failureCode.length > 0
    : Number.isSafeInteger(value.controlRevision) && value.controlRevision >= 0 &&
      (controlled ? value.controlRevision >= 1 && ({ procurement:'procurement', libra:'production', arca:'finished_goods' })[value.ownerDomain] === value.regionProjection &&
        [value.ownerDomain,value.ownerScopeType,value.ownerScopeId].every((item) => typeof item === 'string' && item.length > 0)
        : value.controlState === 'uncontrolled' && value.regionProjection === 'uncontrolled'));
  const evidence = { schema:'foundation.material-control-evidence@1', materialKey:value.materialKey, resultKind:value.resultKind,
    ...(value.controlRevision === undefined ? {} : { controlRevision:value.controlRevision }),
    ...(value.controlState === undefined ? {} : { controlState:value.controlState }),
    ...(value.ownerDomain === undefined ? {} : { ownerDomain:value.ownerDomain }),
    ...(value.ownerScopeType === undefined ? {} : { ownerScopeType:value.ownerScopeType }),
    ...(value.ownerScopeId === undefined ? {} : { ownerScopeId:value.ownerScopeId }),
    ...(value.failureCode === undefined ? {} : { failureCode:value.failureCode }) };
  if (!validValue || canonicalDigest(evidence) !== value.evidenceDigest ||
      canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'projectionDigest'))) !== value.projectionDigest) {
    fail('P7_ELIGIBILITY_CONTROL_INVALID', 'Material Control projection snapshot is invalid.');
  }
}
function validateEligibilityPolicy(value) {
  const keys = ['extractionPolicyId','revision','includedDirectories','excludedDirectories','allowedExtensions','minimumSizeBytes','excludedMaterialKeys','policyDigest'];
  exact(value, keys, 'P7_ELIGIBILITY_POLICY_SHAPE');
  const rules = Object.fromEntries(keys.slice(2, 7).map((key) => [key, value[key]]));
  validateExtractionPolicyValue(rules);
  if (canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'policyDigest'))) !== value.policyDigest) {
    fail('P7_ELIGIBILITY_POLICY_DIGEST', 'ExtractionPolicy digest is invalid.');
  }
  return rules;
}
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
  if (!['active','deregistered'].includes(decision.fieldStatus) || !Number.isSafeInteger(decision.expectedEligibilityRevision) ||
      decision.expectedEligibilityRevision < 1 || !Number.isSafeInteger(decision.sizeBytes) || decision.sizeBytes < 0) {
    fail('P7_ELIGIBILITY_DECISION_VALUE', 'Extraction Eligibility scalar input is invalid.');
  }
  validateSelectionSnapshot(decision.selectionSnapshot, decision.materialKey);
  validateControlSnapshot(decision.controlSnapshot, decision.materialKey);
  let policy;
  try { policy = validateEligibilityPolicy(decision.extractionPolicy); } catch (error) { return outcome(decision, 'unknown', 'unknown', 'policy_unavailable_or_invalid'); }
  const control = decision.controlSnapshot;
  if (control.resultKind !== 'available') return outcome(decision, 'unknown', 'unknown', 'control_projection_unavailable');
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

module.exports = Object.freeze({ ExtractionEligibilityError, evaluateExtractionEligibility, validateEligibilityPolicy });
