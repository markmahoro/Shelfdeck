'use strict';

const { acceptedFinding } = require('./accepted-gap-contracts');

function automaticCaseTargetsAcceptedDefect(context, care, history) {
  if (care.careRequirement?.typedParameters?.some(item =>
    item.parameter === 'trigger.kind' && item.value === 'repair_accepted_defects')) return false;
  // A legitimate Inventory Commit must finish settlement, even if its original
  // admission was wrong. Never turn a committed replacement into a cancellation.
  if ((history.commits || []).some(item => item.aftercareCaseId === care.aftercareCaseId)) return false;
  return (care.careRequirement?.requiredEffects || []).some(effect => {
    const finding = (history.findings || []).find(item =>
      item.findingId === effect.objectId && item.findingDigest === effect.digest);
    return finding && acceptedFinding(context, finding);
  });
}

module.exports = Object.freeze({ automaticCaseTargetsAcceptedDefect });
