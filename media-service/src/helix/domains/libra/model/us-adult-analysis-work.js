'use strict';
const {canonicalDigest} = require('../../../contracts/canonical-json');
const {assertUsAdultAnalysisBasis,matchThresholdFor} = require('./us-adult-analysis-basis');
const REFERENCE_PROJECTION_REF='helix://libra/input-projections/UsAdultAnalysisReferences/v1';
const FRAME = 'libra.media.frames.extract@1', EMBED = 'shared.face.embedding.compute@1', CLUSTER = 'shared.face.cluster.compute@1', MATCH = 'shared.face.reference.match@1';
const resultRef = ref => 'helix://contracts/capabilities/' + ref.replace('@1', '/v1/result');
function workId(basis,pageOrdinal){
  const id=canonicalDigest({schema:'libra.us-adult-analysis-work@1',analysisId:basis.analysisId,basisDigest:basis.basisDigest,pageOrdinal});
  return 'libra-us-adult-'+(pageOrdinal===null?'frames':'match-'+pageOrdinal)+'-work-'+id;
}
function definition(snapshot, basis, pageOrdinal = null) {
  if (snapshot.spec.contentProfile !== 'western_adult' || basis.libraRunId !== snapshot.run.libraRunId ||
      basis.runExecutionBasisDigest !== snapshot.run.executionBasisDigest ||
      pageOrdinal !== null && (!Number.isSafeInteger(pageOrdinal) || pageOrdinal < 0 || pageOrdinal >= basis.pageCount)) {
    throw new TypeError('US Adult Work requires its exact frozen Run and reference page.');
  }
  const identity = {schema:'libra.us-adult-analysis-work@1', analysisId:basis.analysisId, basisDigest:basis.basisDigest, pageOrdinal},
    id = canonicalDigest(identity), stage = pageOrdinal === null ? 'frames' : 'match-' + pageOrdinal,
    prior = pageOrdinal === null ? {workId:basis.sourceProbeRef.workId, executionBasisDigest:basis.runExecutionBasisDigest} : definition(snapshot, basis);
  return Object.freeze({schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1', schemaVersion:1,
    workId:workId(basis,pageOrdinal), ownerDomain:'libra', processType:'libra_run', processId:basis.libraRunId,
    workKind:'us_adult_analysis', workObjectiveTypeRef:'helix://libra/work/us-adult-' + (pageOrdinal === null ? 'frames' : 'reference-page') + '/v1',
    workObjectiveVersion:1, executionBasisId:'libra-us-adult-analysis-basis-' + id, executionBasisDigest:basis.runExecutionBasisDigest,
    dependencyRefs:Object.freeze([{ownerDomain:'libra', objectType:'supporting_work', objectId:prior.workId, revision:1, digest:prior.executionBasisDigest}]),
    priorityClass:snapshot.run.priorityClass === 'expedited' ? 'expedited_formation' : 'normal_foreground', priorityRevision:1,
    capabilityCatalogScope:'libra', workspaceMaterialScope:Object.freeze([]), idempotencyKey:'libra-us-adult-work-key-' + id,
    concurrencyScope:basis.libraRunId + '/us-adult/' + stage, outputContractRef:resultRef(pageOrdinal === null ? CLUSTER : MATCH)});
}
function frameWork(snapshot, basis) { return definition(snapshot, basis); }
function matchWork(snapshot, basis, pageOrdinal) { return definition(snapshot, basis, pageOrdinal); }
function exactResult(options, work, capabilityRef) {
  const matches = options.workResultReader.read(work.workId).filter(item => item.outcomeKind === 'succeeded' && item.capabilityRef === capabilityRef);
  if (matches.length !== 1 || matches[0].workId !== work.workId || canonicalDigest(matches[0].result) !== matches[0].resultDigest) {
    throw new Error('US Adult analysis requires one complete exact durable Capability Result.');
  }
  return matches[0];
}
function projectionSetDigest(page) {
  return canonicalDigest({schema:'people.person-reference-projection-set@1', items:page.items.map(item => ({
    personId:item.referenceProjection.personId, personRevision:item.referenceProjection.personRevision,
    projectionRevision:item.referenceProjection.projectionRevision, projectionDigest:item.referenceProjection.projectionDigest,
  }))});
}
function pickCompleteMatch({basis, pages, results, clusterResult}) {
  assertUsAdultAnalysisBasis(basis,pages);
  if (pages.length !== basis.pageCount || results.length !== basis.pageCount) throw new Error('US Adult matching cannot finish with missing reference pages.');
  let winner = null;
  const threshold = matchThresholdFor(basis);
  for (const [ordinal, record] of results.entries()) {
    const page = pages[ordinal], result = record.result, matches = result?.matches,
      binding = record.inputBindings?.bindings?.find(item => item.portName === 'personReferenceProjectionList');
    if (page.libraryDigest !== basis.referenceLibraryDigest || page.totalPersonCount !== basis.personCount ||
        record.outcomeKind !== 'succeeded' || record.capabilityRef !== MATCH || record.workId !== workId(basis,ordinal) ||
        record.resultSchemaRef !== resultRef(MATCH) || result?.schemaRef !== 'helix://contracts/types/PersonMatchEvidence/v1' ||
        result.producerRef !== MATCH || canonicalDigest(result) !== record.resultDigest ||
        result.clusterSetDigest !== clusterResult.handleDigest || result.referenceProjectionSetDigest !== projectionSetDigest(page) ||
        matches?.length > 1 || !Array.isArray(matches) || binding?.bindingKind !== 'projected_owner_facts' ||
        binding.projectionRef !== REFERENCE_PROJECTION_REF || binding.ownerDomain !== 'libra' ||
        binding.processType !== 'libra_run' || binding.processId !== basis.libraRunId ||
        binding.parameters?.analysisId !== basis.analysisId || binding.parameters?.pageOrdinal !== ordinal ||
        record.inputBindingDigest !== canonicalDigest(record.inputBindings)) {
      throw new Error('US Adult matching page Result, source Cluster or frozen reference provenance changed.');
    }
    const {payloadDigest, evidenceId, evidenceKind, producerRef, schemaRef, schemaVersion, basisDigest, observedAtMs, ...payload} = result;
    if (canonicalDigest(payload) !== payloadDigest || basisDigest !== canonicalDigest({schema:'shared.face-reference-match-basis@1',
      clusterSetDigest:result.clusterSetDigest, referenceProjectionSetDigest:result.referenceProjectionSetDigest})) {
      throw new Error('US Adult matching Evidence digest changed.');
    }
    if (!matches.length) continue;
    const match = matches[0], person = page.items.find(item => item.personId === match.personId), projection = person?.referenceProjection,
      {evidenceDigest, ...matchBody} = match;
    if (!person || match.personRevision !== person.personRevision || match.projectionDigest !== projection.projectionDigest ||
        match.projectionRevision !== projection.projectionRevision || match.faceModelRefDigest !== basis.faceModelRef.digest ||
        match.referenceModelRefDigest !== basis.referenceModelRefDigest || !Number.isFinite(match.score) || match.score < threshold ||
        match.threshold !== threshold ||
        canonicalDigest({schema:'shared.face-reference-match-evidence@1', ...matchBody}) !== evidenceDigest ||
        !projection.contributions.some(item => item.ownerPersonId === person.personId && item.activeAssets.some(asset =>
          asset.referenceAssetId === match.referenceAssetId && asset.artifactDigest === match.artifactDigest) &&
          item.activeFaces.some(face => face.referenceAssetId === match.referenceAssetId && face.modelRef === basis.referenceModelRefDigest))) {
      throw new Error('US Adult highest match is outside its frozen actor, image or threshold.');
    }
    const order = winner && (Buffer.compare(Buffer.from(match.personId), Buffer.from(winner.match.personId)) ||
      Buffer.compare(Buffer.from(match.referenceAssetId), Buffer.from(winner.match.referenceAssetId)));
    if (!winner || match.score > winner.match.score || match.score === winner.match.score && order < 0) {
      winner = Object.freeze({match, personSnapshot:person, record, pageOrdinal:ordinal});
    }
  }
  return winner;
}
module.exports = Object.freeze({FRAME, EMBED, CLUSTER, MATCH, REFERENCE_PROJECTION_REF,resultRef, workId,frameWork, matchWork, exactResult, projectionSetDigest, pickCompleteMatch});
