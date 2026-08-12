'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');

const SELECTED_CANDIDATE_RESULT =
  'helix://contracts/capabilities/libra.external_material.candidate.select/v1/result';
const VERIFIED_PACKAGE_RESULT =
  'helix://contracts/capabilities/libra.external_material.package.verify/v1/result';
const SELECTED_OUTPUT_RESULT =
  'helix://contracts/capabilities/libra.product_output.select/v1/result';

function stable(prefix, value) {
  return prefix + canonicalDigest(value).slice(0, 40);
}

function priority(snapshot) {
  return snapshot.run.priorityClass === 'expedited'
    ? 'expedited_formation' : 'normal_foreground';
}

function dependency(work) {
  return Object.freeze({
    ownerDomain: 'libra',
    objectType: 'supporting_work',
    objectId: work.workId,
    revision: 1,
    digest: work.executionBasisDigest,
  });
}

function definition(snapshot, stage, outputContractRef, dependencies = []) {
  const basis = {
    libraRunId: snapshot.run.libraRunId,
    executionBasisDigest: snapshot.run.executionBasisDigest,
    acceptanceSpecId: snapshot.run.acceptanceSpecId,
    stage,
  };
  return Object.freeze({
    schemaRef: 'helix://foundation/types/SupportingWorkDefinition/v1',
    schemaVersion: 1,
    workId: stable('libra-external-material-' + stage + '-work-', basis),
    ownerDomain: 'libra',
    processType: 'libra_run',
    processId: snapshot.run.libraRunId,
    workKind: 'workspace_media_production',
    workObjectiveTypeRef: 'helix://libra/work/external-material-' +
      stage.replaceAll('_', '-') + '/v1',
    workObjectiveVersion: 1,
    executionBasisId: stable('libra-external-material-' + stage + '-basis-', basis),
    executionBasisDigest: snapshot.run.executionBasisDigest,
    dependencyRefs: Object.freeze(dependencies.map(dependency)),
    priorityClass: priority(snapshot),
    priorityRevision: 1,
    capabilityCatalogScope: 'libra',
    workspaceMaterialScope: Object.freeze([]),
    idempotencyKey: stable('libra-external-material-' + stage + '-key-', basis),
    concurrencyScope: snapshot.run.libraRunId + '/external-material/' + stage,
    outputContractRef,
  });
}

function externalSearchSelectionWork(snapshot) {
  return definition(snapshot, 'search_selection', SELECTED_CANDIDATE_RESULT);
}

function externalAcquireVerificationWork(snapshot) {
  return definition(snapshot, 'acquire_verification', VERIFIED_PACKAGE_RESULT,
    [externalSearchSelectionWork(snapshot)]);
}

function externalImportSelectionWork(snapshot) {
  return definition(snapshot, 'import_selection', SELECTED_OUTPUT_RESULT,
    [externalAcquireVerificationWork(snapshot)]);
}

module.exports = Object.freeze({
  SELECTED_CANDIDATE_RESULT,
  SELECTED_OUTPUT_RESULT,
  VERIFIED_PACKAGE_RESULT,
  externalAcquireVerificationWork,
  externalImportSelectionWork,
  externalSearchSelectionWork,
});
