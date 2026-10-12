'use strict';
const {resolveInventoryVerification}=require('./inventory-verification-store');
const {resolveStagedResult,stagedResultReader}=require('./staged-manifest-store');
const {resolveAcceptanceResult}=require('./acceptance-check-evidence-store');

// Owner-only read port: reconstruct exact immutable evidence before projection.
function createPlanningEvidenceReader(options) {
  return Object.freeze({
    resolveSource(value) { return resolveInventoryVerification(options,resolveStagedResult(options,value)); },
    resolveAcceptance(value) { return resolveAcceptanceResult(options,value); },
    readStagedWork(workId) { return stagedResultReader(options).read(workId); }
  });
}
module.exports=Object.freeze({createPlanningEvidenceReader});
