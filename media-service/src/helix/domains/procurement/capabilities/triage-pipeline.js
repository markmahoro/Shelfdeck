'use strict';

const { buildPrimaryManifestDraft, inspectPlayability, inspectStructure, resolveIdentity } = require('../model/triage-contracts');

function createTriageCapabilities(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => 0;
  return Object.freeze({
    playabilityInspect: Object.freeze({ capabilityRef:'procurement.triage.playability.inspect@1', effectClass:'pure_observation',
      execute: ({ triageMaterialProbeBatch, procurementTriageRuleSnapshot }) =>
        inspectPlayability(triageMaterialProbeBatch, procurementTriageRuleSnapshot, { observedAtMs:now() }) }),
    structureInspect: Object.freeze({ capabilityRef:'procurement.triage.structure.inspect@1', effectClass:'pure_observation',
      execute: ({ triageStructureInspectionInput, procurementTriageRuleSnapshot }) =>
        inspectStructure(triageStructureInspectionInput, procurementTriageRuleSnapshot, { observedAtMs:now() }) }),
    identityClaimResolve: Object.freeze({ capabilityRef:'procurement.triage.identity_claim.resolve@1', effectClass:'pure_observation',
      execute: ({ triageIdentityResolutionInput, procurementTriageRuleSnapshot }) =>
        resolveIdentity(triageIdentityResolutionInput, procurementTriageRuleSnapshot, { producedAtMs:now() }) }),
    primaryManifestBuild: Object.freeze({ capabilityRef:'procurement.triage.primary_manifest.build@1', effectClass:'pure_observation',
      execute: ({ triageManifestBuildInput, procurementTriageRuleSnapshot }) =>
        buildPrimaryManifestDraft(triageManifestBuildInput, procurementTriageRuleSnapshot, { producedAtMs:now() }) })
  });
}

module.exports = Object.freeze({ createTriageCapabilities });
