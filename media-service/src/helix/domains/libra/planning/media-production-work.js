'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');

const PROBE_RESULT = 'helix://contracts/capabilities/shared.material.media.probe/v1/result';
const SELECTED_OUTPUT_RESULT = 'helix://contracts/capabilities/libra.product_output.select/v1/result';
const TRANSCODE_INPUT_VERIFICATION_RESULT='helix://contracts/capabilities/libra.transcode.input.verify/v1/result';

function stable(prefix, value) {
  return prefix + canonicalDigest(value).slice(0, 40);
}

function priority(snapshot) {
  return snapshot.run.priorityClass === 'expedited' ? 'expedited_formation' : 'normal_foreground';
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
    workId: stable('libra-workspace-media-' + stage + '-work-', basis),
    ownerDomain: 'libra',
    processType: 'libra_run',
    processId: snapshot.run.libraRunId,
    workKind: 'workspace_media_production',
    workObjectiveTypeRef: 'helix://libra/work/workspace-media-' + stage.replaceAll('_', '-') + '/v1',
    workObjectiveVersion: 1,
    executionBasisId: stable('libra-workspace-media-' + stage + '-basis-', basis),
    executionBasisDigest: snapshot.run.executionBasisDigest,
    dependencyRefs: Object.freeze(dependencies.map(dependency)),
    priorityClass: priority(snapshot),
    priorityRevision: 1,
    capabilityCatalogScope: 'libra',
    workspaceMaterialScope: Object.freeze([]),
    idempotencyKey: stable('libra-workspace-media-' + stage + '-key-', basis),
    concurrencyScope: snapshot.run.libraRunId + '/workspace-media/' + stage,
    outputContractRef,
  });
}

function sourceMediaObservationWork(snapshot) {
  return definition(snapshot, 'source_observation', PROBE_RESULT);
}

function directMediaSelectionWork(snapshot) {
  const source = sourceMediaObservationWork(snapshot);
  return definition(snapshot, 'direct_selection', SELECTED_OUTPUT_RESULT, [source]);
}

function remuxMediaSelectionWork(snapshot) {
  const source = sourceMediaObservationWork(snapshot);
  return definition(snapshot, 'remux_selection', SELECTED_OUTPUT_RESULT, [source]);
}

function transcodeMediaSelectionWork(snapshot, strategyOrdinal) {
  if (!Number.isSafeInteger(strategyOrdinal) || strategyOrdinal < 1 || strategyOrdinal > 64) {
    throw new TypeError('Transcode strategy ordinal must be 1..64.');
  }
  const prior = snapshot.materialInputForm === 'stream_file'
    ? directMediaSelectionWork(snapshot) : remuxMediaSelectionWork(snapshot);
  const assessment=transcodeStrategyAssessmentWork(snapshot,strategyOrdinal);
  return definition(snapshot, 'transcode_' + strategyOrdinal + '_selection', SELECTED_OUTPUT_RESULT,
    [sourceMediaObservationWork(snapshot),prior,assessment]);
}

function transcodeStrategyAssessmentWork(snapshot,strategyOrdinal){
  if (!Number.isSafeInteger(strategyOrdinal) || strategyOrdinal < 1 || strategyOrdinal > 64) {
    throw new TypeError('Transcode strategy ordinal must be 1..64.');
  }
  const prior = snapshot.materialInputForm === 'stream_file'
    ? directMediaSelectionWork(snapshot) : remuxMediaSelectionWork(snapshot);
  const dependencies=[sourceMediaObservationWork(snapshot),prior];
  if(strategyOrdinal>1)dependencies.push(definition(snapshot,'transcode_'+(strategyOrdinal-1)+'_assessment',
    TRANSCODE_INPUT_VERIFICATION_RESULT));
  return definition(snapshot,'transcode_'+strategyOrdinal+'_assessment',TRANSCODE_INPUT_VERIFICATION_RESULT,dependencies);
}

module.exports = Object.freeze({
  PROBE_RESULT,
  SELECTED_OUTPUT_RESULT,
  TRANSCODE_INPUT_VERIFICATION_RESULT,
  directMediaSelectionWork,
  remuxMediaSelectionWork,
  sourceMediaObservationWork,
  transcodeMediaSelectionWork,
  transcodeStrategyAssessmentWork,
});
