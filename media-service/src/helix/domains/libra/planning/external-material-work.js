'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');

const {buildSeriesReplacementBasis,buildSeriesReplacementScopes}=require('../model/series-external-replacement');

function replacementBasis(snapshot) {
  const primary=snapshot.members.filter(item=>item.role==='primary_payload');
  return buildSeriesReplacementBasis({libraRunId:snapshot.run.libraRunId,
    runExecutionBasisDigest:snapshot.run.executionBasisDigest,acceptanceSpecRecordDigest:snapshot.spec.recordDigest,
    episodeKeys:snapshot.spec.productScope.episodeKeys,members:primary.map(item=>({materialKey:item.materialKey,
      memberDigest:canonicalDigest(item),episodeKeys:item.episodeClaims.map(claim=>claim.episodeKey)}))});
}
function replacementScopes(snapshot) {
  if(snapshot.spec?.contentProfile!=='series')return Object.freeze([null]);
  const basis=replacementBasis(snapshot);
  return buildSeriesReplacementScopes({basis,materialKeys:basis.members.map(item=>item.materialKey)});
}
function assertReplacementScope(snapshot,scope) {
  if(!replacementScopes(snapshot).some(item=>canonicalJson(item)===canonicalJson(scope)))
    throw new Error('External Work requires one exact complete replacement scope for this Run.');
}

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

function definition(snapshot, stage, outputContractRef, dependencies = [], scope = null) {
  assertReplacementScope(snapshot,scope);
  const basis = {
    libraRunId: snapshot.run.libraRunId,
    executionBasisDigest: snapshot.run.executionBasisDigest,
    acceptanceSpecId: snapshot.run.acceptanceSpecId,
    stage,
    ...(scope?{replacementScopeDigest:scope.scopeDigest}:{}),
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
    executionBasisDigest: scope?canonicalDigest({schema:'libra.external-scope-execution-basis@1',
      runExecutionBasisDigest:snapshot.run.executionBasisDigest,replacementScopeDigest:scope.scopeDigest}):snapshot.run.executionBasisDigest,
    dependencyRefs: Object.freeze(dependencies.map(dependency)),
    priorityClass: priority(snapshot),
    priorityRevision: 1,
    capabilityCatalogScope: 'libra',
    workspaceMaterialScope: Object.freeze([]),
    idempotencyKey: stable('libra-external-material-' + stage + '-key-', basis),
    concurrencyScope: snapshot.run.libraRunId + '/external-material/' + stage+(scope?'/'+scope.scopeDigest:''),
    outputContractRef,
  });
}

function externalSearchSelectionWork(snapshot, scope = null) {
  return definition(snapshot, 'search_selection', SELECTED_CANDIDATE_RESULT, [], scope);
}

function externalAcquireVerificationWork(snapshot, scope = null) {
  return definition(snapshot, 'acquire_verification', VERIFIED_PACKAGE_RESULT,
    [externalSearchSelectionWork(snapshot,scope)],scope);
}

function externalImportSelectionWork(snapshot, scope = null) {
  return definition(snapshot, 'import_selection', SELECTED_OUTPUT_RESULT,
    [externalAcquireVerificationWork(snapshot,scope)],scope);
}

module.exports = Object.freeze({
  replacementBasis,replacementScopes,
  SELECTED_CANDIDATE_RESULT,
  SELECTED_OUTPUT_RESULT,
  VERIFIED_PACKAGE_RESULT,
  externalAcquireVerificationWork,
  externalImportSelectionWork,
  externalSearchSelectionWork,
});
