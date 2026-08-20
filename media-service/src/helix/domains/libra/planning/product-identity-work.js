'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');

const IDENTITY_EVIDENCE_RESULT =
  'helix://contracts/capabilities/libra.product_identity.evidence.observe/v1/result';
const IDENTITY_RESULT =
  'helix://contracts/capabilities/libra.product_identity.resolve/v1/result';

function stable(prefix, value) {
  return prefix + canonicalDigest(value).slice(0, 40);
}

function definition(snapshot, stage, outputContractRef, dependencyRefs = [], source = null) {
  const basis = {
    libraRunId: snapshot.run.libraRunId,
    executionBasisDigest: snapshot.run.executionBasisDigest,
    acceptanceSpecId: snapshot.run.acceptanceSpecId,
    stage,
    sourceWorkId: source?.workId || null,
    sourceResultDigest: source?.resultDigest || null,
  };
  return Object.freeze({
    schemaRef: 'helix://foundation/types/SupportingWorkDefinition/v1',
    schemaVersion: 1,
    workId: stable('libra-product-identity-' + stage + '-work-', basis),
    ownerDomain: 'libra',
    processType: 'libra_run',
    processId: snapshot.run.libraRunId,
    workKind: 'product_identity',
    workObjectiveTypeRef:
      'helix://libra/work/product-identity-' + stage.replaceAll('_', '-') + '/v1',
    workObjectiveVersion: 1,
    executionBasisId: stable('libra-product-identity-' + stage + '-basis-', basis),
    executionBasisDigest: snapshot.run.executionBasisDigest,
    dependencyRefs: Object.freeze(dependencyRefs),
    priorityClass: snapshot.run.priorityClass === 'expedited'
      ? 'expedited_formation' : 'normal_foreground',
    priorityRevision: snapshot.run.priorityRevision || 1,
    capabilityCatalogScope: 'libra',
    workspaceMaterialScope: Object.freeze([]),
    idempotencyKey: stable('libra-product-identity-' + stage + '-key-', basis),
    concurrencyScope: snapshot.run.libraRunId + '/product-identity/' + stage,
    outputContractRef,
  });
}

function identityObservationWork(snapshot, sourceKind = 'provider_search', source = null) {
  if (!['related_nfo', 'provider_exact', 'provider_search'].includes(sourceKind)) {
    throw new TypeError('Product Identity observation source kind is invalid.');
  }
  return definition(snapshot, 'observation_' + sourceKind, IDENTITY_EVIDENCE_RESULT, [], source);
}

function identityCommitWork(snapshot, source) {
  if (!source || typeof source.workId !== 'string' ||
      typeof source.resultDigest !== 'string') {
    throw new TypeError('Product Identity commit Work requires its exact observation Result.');
  }
  const observation = Object.freeze({ workId:source.workId, executionBasisDigest:snapshot.run.executionBasisDigest });
  const dependency = Object.freeze({
    ownerDomain: 'libra',
    objectType: 'supporting_work',
    objectId: observation.workId,
    revision: 1,
    digest: observation.executionBasisDigest,
  });
  return definition(snapshot, 'commit', IDENTITY_RESULT, [dependency], source);
}

module.exports = Object.freeze({
  IDENTITY_RESULT,
  IDENTITY_EVIDENCE_RESULT,
  identityCommitWork,
  identityObservationWork,
});
