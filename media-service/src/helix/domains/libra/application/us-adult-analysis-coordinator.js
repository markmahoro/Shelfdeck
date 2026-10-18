'use strict';
const {buildUsAdultAnalysisBasis} = require('../model/us-adult-analysis-basis');
const {readSourceMediaObservations} = require('../planning/source-media-observations');
const {sourceMediaObservationWork} = require('../planning/media-production-work');
const {frameWork, matchWork, exactResult, pickCompleteMatch, CLUSTER, MATCH} = require('../model/us-adult-analysis-work');

function createUsAdultAnalysisCoordinator(options) {
  if (!options?.usAdultAnalysisStore || typeof options.submit !== 'function' || !options.workResultReader || !options.peopleReferenceQuery) {
    throw new TypeError('US Adult analysis coordination requires Libra persistence, Work admission and formal People queries.');
  }
  function advance(snapshot, work, phase) {
    const submitted = options.submit(work), status = options.workResultReader.status(work.workId);
    if (status?.state === 'succeeded') return null;
    return Object.freeze({kind:['failed', 'cancelled'].includes(status?.state) ? 'failed' : 'pending', phase,
      libraRunId:snapshot.run.libraRunId, workId:work.workId, work, status, replayed:submitted.replayed});
  }
  return Object.freeze({reconcile(snapshot, resolvedIdentity, workspace) {
    if (snapshot.spec.contentProfile !== 'western_adult' || resolvedIdentity.factValue.contentProfile !== 'western_adult' ||
        workspace.libraRunId !== snapshot.run.libraRunId) throw new TypeError('US Adult analysis requires one same-Run formal Identity and Workspace.');
    const sourceWork = sourceMediaObservationWork(snapshot), probing = advance(snapshot, sourceWork, 'us_adult_source_probe');
    if (probing) return probing;
    let basis = options.usAdultAnalysisStore.getByRun(snapshot.run.libraRunId);
    if (!basis) {
      const source = readSourceMediaObservations(options, snapshot);
      if (source.length !== 1) throw new Error('US Adult analysis requires exactly one Primary source.');
      const referencePages = []; let cursor = null, expectedLibraryDigest = null;
      do {
        const page = options.peopleReferenceQuery.readUsAdultReferencePage({cursor, limit:256, expectedLibraryDigest});
        referencePages.push(page); expectedLibraryDigest = page.libraryDigest; cursor = page.nextCursor;
      } while (cursor !== null);
      basis = options.usAdultAnalysisStore.freeze(buildUsAdultAnalysisBasis({snapshot:{...snapshot,
        resolvedIdentityDigest:resolvedIdentity.factValue.identityDigest}, sourceHandle:source[0].readHandle,
        sourceProbeRecord:source[0].record, workspaceId:workspace.workspaceId, referencePages}), referencePages);
    }
    const frames = frameWork(snapshot, basis), analyzing = advance(snapshot, frames, 'us_adult_frame_analysis');
    if (analyzing) return analyzing;
    const clusterRecord = exactResult(options, frames, CLUSTER), pages = [], results = [];
    for (let ordinal = 0; ordinal < basis.pageCount; ordinal++) {
      const work = matchWork(snapshot, basis, ordinal), matching = advance(snapshot, work, 'us_adult_actor_matching');
      if (matching) return matching;
      pages.push(options.usAdultAnalysisStore.readPage(basis.analysisId, ordinal)); results.push(exactResult(options, work, MATCH));
    }
    const winner = pickCompleteMatch({basis, pages, results, clusterResult:clusterRecord.result});
    return Object.freeze({kind:winner ? 'matched' : 'unmatched', phase:'us_adult_actor_matching', libraRunId:snapshot.run.libraRunId,
      basis, frameWork:frames, clusterRecord, results:Object.freeze(results), winner});
  }});
}
module.exports = Object.freeze({createUsAdultAnalysisCoordinator});
