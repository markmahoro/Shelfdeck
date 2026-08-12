'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');

const CONFORMANCE_RESULT =
  'helix://contracts/capabilities/libra.product.conformance.verify/v1/result';
const PROMOTION_RESULT =
  'helix://contracts/capabilities/libra.product_package.publish/v1/result';

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

function definition(snapshot, stage, outputContractRef, dependencies, basis) {
  return Object.freeze({
    schemaRef: 'helix://foundation/types/SupportingWorkDefinition/v1',
    schemaVersion: 1,
    workId: stable('libra-' + stage.replaceAll('_', '-') + '-work-', basis),
    ownerDomain: 'libra',
    processType: 'libra_run',
    processId: snapshot.run.libraRunId,
    workKind: stage,
    workObjectiveTypeRef: 'helix://libra/work/' +
      stage.replaceAll('_', '-') + '/v1',
    workObjectiveVersion: 1,
    executionBasisId: stable(
      'libra-' + stage.replaceAll('_', '-') + '-basis-',
      basis,
    ),
    executionBasisDigest: snapshot.run.executionBasisDigest,
    dependencyRefs: Object.freeze(dependencies.map(dependency)),
    priorityClass: priority(snapshot),
    priorityRevision: 1,
    capabilityCatalogScope: 'libra',
    workspaceMaterialScope: Object.freeze([]),
    idempotencyKey: stable(
      'libra-' + stage.replaceAll('_', '-') + '-key-',
      basis,
    ),
    concurrencyScope: snapshot.run.libraRunId + '/' + stage,
    outputContractRef,
  });
}

function productConformanceWork(snapshot, selectedMediaWork) {
  const basis = {
    libraRunId: snapshot.run.libraRunId,
    executionBasisDigest: snapshot.run.executionBasisDigest,
    selectedMediaWorkId: selectedMediaWork.workId,
  };
  return definition(
    snapshot,
    'product_conformance',
    CONFORMANCE_RESULT,
    [selectedMediaWork],
    basis,
  );
}

function deliverablePromotionWork(
  snapshot,
  selectedMediaWork,
  conformanceWork,
  conformanceEvidence,
) {
  const basis = {
    libraRunId: snapshot.run.libraRunId,
    executionBasisDigest: snapshot.run.executionBasisDigest,
    selectedMediaWorkId: selectedMediaWork.workId,
    conformanceWorkId: conformanceWork.workId,
    conformanceVerificationId: conformanceEvidence.verificationId,
    conformanceEvidenceDigest: canonicalDigest(conformanceEvidence),
  };
  return definition(
    snapshot,
    'deliverable_promotion',
    PROMOTION_RESULT,
    [selectedMediaWork, conformanceWork],
    basis,
  );
}

function findSelectedMediaWork(options, snapshot) {
  const candidates = options.workResultReader.listWorks({
    ownerDomain: 'libra',
    processType: 'libra_run',
    processId: snapshot.run.libraRunId,
    workKind: 'workspace_media_production',
  }).filter((work) => work.state === 'succeeded').filter((work) =>
    options.workResultReader.read(work.work_id).some((item) =>
      item.outcomeKind === 'succeeded' &&
      item.capabilityRef === 'libra.product_output.select@1' &&
      item.result?.result === 'selected'));
  if (candidates.length !== 1) {
    throw new Error(
      'Libra Run must have exactly one terminal selected media Work.',
    );
  }
  return Object.freeze({
    workId: candidates[0].work_id,
    executionBasisDigest: snapshot.run.executionBasisDigest,
  });
}

function findPassedConformance(options, snapshot, selectedMediaWork) {
  const work = productConformanceWork(snapshot, selectedMediaWork);
  const results = options.workResultReader.read(work.workId).filter((item) =>
    item.outcomeKind === 'succeeded' &&
    item.capabilityRef === 'libra.product.conformance.verify@1');
  if (results.length !== 1 || results[0].result?.result !== 'passed') {
    throw new Error(
      'Libra Run must have one exact passed Product Conformance Evidence.',
    );
  }
  return Object.freeze({ work, evidence: results[0].result });
}

module.exports = Object.freeze({
  CONFORMANCE_RESULT,
  PROMOTION_RESULT,
  deliverablePromotionWork,
  findPassedConformance,
  findSelectedMediaWork,
  productConformanceWork,
});
