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

function externalSourceWork(snapshot, member) {
  if(!member?.externalSource)return null;
  const {replacementScopes,externalImportSelectionWork}=require('./external-material-work');
  const source=member.externalSource,scope=replacementScopes(snapshot).find(item=>item?.scopeDigest===source.scopeDigest);
  if(!scope)throw new TypeError('External member Work requires its exact replacement scope.');
  const work=externalImportSelectionWork(snapshot,scope);
  if(source.importWorkId!==work.workId||source.importWorkDigest!==canonicalDigest(work)||
      ![source.sourceHandleDigest,source.sourceProbeDigest].every(value=>/^[a-f0-9]{64}$/.test(value)))
    throw new TypeError('External member Work requires exact Import and source evidence.');
  return work;
}

function memberBasis(snapshot, member) {
  if(member===undefined)return null;
  if(member.externalSource) {
    externalSourceWork(snapshot,member);
    if(snapshot.spec.contentProfile!=='series'||member.role!=='primary_payload')throw new TypeError('External member must be a Series Primary.');
    return Object.freeze({materialKey:member.materialKey,memberDigest:canonicalDigest(member)});
  }
  const matches=snapshot.members.filter(item=>item.materialKey===member?.materialKey);
  if(snapshot.spec.contentProfile!=='series'||snapshot.materialInputForm!=='stream_file'||matches.length!==1||
      member.role!=='primary_payload'||canonicalDigest(matches[0])!==canonicalDigest(member))
    throw new TypeError('Member production Work requires an exact frozen Series Primary.');
  return Object.freeze({materialKey:member.materialKey,memberDigest:canonicalDigest(member)});
}

function workspaceMediaWorkPrefix(stage) {
  return 'libra-workspace-media-' + stage + '-work-';
}

function definition(snapshot, stage, outputContractRef, dependencies = [], member, extraBasis = {}) {
  const primary=memberBasis(snapshot,member);
  const basis = {
    libraRunId: snapshot.run.libraRunId,
    executionBasisDigest: snapshot.run.executionBasisDigest,
    acceptanceSpecId: snapshot.run.acceptanceSpecId,
    stage,
    ...extraBasis,
    ...(primary?{primary}:{}),
  };
  return Object.freeze({
    schemaRef: 'helix://foundation/types/SupportingWorkDefinition/v1',
    schemaVersion: 1,
    workId: stable(workspaceMediaWorkPrefix(stage), basis),
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
    concurrencyScope: snapshot.run.libraRunId + '/workspace-media/' + stage + (primary?'/'+canonicalDigest(primary):''),
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

function remuxMediaSelectionWork(snapshot, member) {
  const source = externalSourceWork(snapshot,member)||sourceMediaObservationWork(snapshot);
  return definition(snapshot, 'remux_selection', SELECTED_OUTPUT_RESULT, [source], member);
}

function transcodeMediaSelectionWork(snapshot, strategyOrdinal, member) {
  if (!Number.isSafeInteger(strategyOrdinal) || strategyOrdinal < 1 || strategyOrdinal > 64) {
    throw new TypeError('Transcode strategy ordinal must be 1..64.');
  }
  const prior = snapshot.materialInputForm === 'stream_file'
    ? directMediaSelectionWork(snapshot) : remuxMediaSelectionWork(snapshot,member);
  const assessment=transcodeStrategyAssessmentWork(snapshot,strategyOrdinal,member);
  return definition(snapshot, 'transcode_' + strategyOrdinal + '_selection', SELECTED_OUTPUT_RESULT,
    [...(externalSourceWork(snapshot,member)?[externalSourceWork(snapshot,member)]:[sourceMediaObservationWork(snapshot),prior]),assessment],member);
}

function transcodeStrategyAssessmentWork(snapshot,strategyOrdinal,member){
  if (!Number.isSafeInteger(strategyOrdinal) || strategyOrdinal < 1 || strategyOrdinal > 64) {
    throw new TypeError('Transcode strategy ordinal must be 1..64.');
  }
  const prior = snapshot.materialInputForm === 'stream_file'
    ? directMediaSelectionWork(snapshot) : remuxMediaSelectionWork(snapshot,member);
  const external=externalSourceWork(snapshot,member),dependencies=external?[external]:[sourceMediaObservationWork(snapshot),prior];
  if(strategyOrdinal>1)dependencies.push(definition(snapshot,'transcode_'+(strategyOrdinal-1)+'_assessment',
    TRANSCODE_INPUT_VERIFICATION_RESULT,[],member));
  return definition(snapshot,'transcode_'+strategyOrdinal+'_assessment',TRANSCODE_INPUT_VERIFICATION_RESULT,dependencies,member);
}

function seriesFinalSelectionWork(snapshot,candidateSetDigest,sourceWorks) {
  if(snapshot.spec.contentProfile!=='series'||!/^[a-f0-9]{64}$/.test(candidateSetDigest)||!sourceWorks.length||
      sourceWorks.some(work=>work.processId!==snapshot.run.libraRunId||work.ownerDomain!=='libra'))
    throw new TypeError('Final Series Work requires the complete same-Run candidate basis.');
  const dependencies=[...new Map(sourceWorks.map(work=>[work.workId,work])).values()]
    .sort((a,b)=>Buffer.from(a.workId).compare(Buffer.from(b.workId)));
  return definition(snapshot,'series_final_selection',SELECTED_OUTPUT_RESULT,dependencies,undefined,{candidateSetDigest});
}

module.exports = Object.freeze({
  workspaceMediaWorkPrefix,
  seriesFinalSelectionWork,
  PROBE_RESULT,
  SELECTED_OUTPUT_RESULT,
  TRANSCODE_INPUT_VERIFICATION_RESULT,
  directMediaSelectionWork,
  remuxMediaSelectionWork,
  sourceMediaObservationWork,
  transcodeMediaSelectionWork,
  transcodeStrategyAssessmentWork,
});
