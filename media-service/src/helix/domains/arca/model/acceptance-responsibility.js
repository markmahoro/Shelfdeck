'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');

function stable(schema, value) {
  return canonicalDigest({ schema, ...value });
}

function deriveAcceptedResponsibility(assessment) {
  const acceptanceDecisionId = stable('arca.acceptance-decision-id@1', {
    acceptanceAttemptId: assessment.acceptanceAttemptId,
  });
  const custodyId = stable('arca.on-deck-material-custody-id@1', {
    acceptanceDecisionId,
    onDeckPackageId: assessment.onDeckPackageId,
    packageDigest: assessment.packageDigest,
  });
  const onDeckRunId = stable('arca.on-deck-run-id@1', {
    custodyId,
    onDeckPackageId: assessment.onDeckPackageId,
    packageDigest: assessment.packageDigest,
  });
  return Object.freeze({ acceptanceDecisionId, custodyId, onDeckRunId });
}

module.exports=Object.freeze({deriveAcceptedResponsibility});
