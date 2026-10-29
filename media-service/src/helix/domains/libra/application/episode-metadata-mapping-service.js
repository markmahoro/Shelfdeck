'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createCommandCommitCoordinator } = require('../../../foundation/persistence/commit-foundation');
const { buildEpisodeMetadataBasis } = require('../model/episode-metadata-basis');
const { buildProviderEpisodeEvidence, buildEpisodeMetadataReview } = require('../model/episode-metadata-review');
const { buildReviewRecord, buildMappingRecord } = require('../model/episode-metadata-records');
function fail(code) { throw Object.assign(new Error(code), { code }); }
function input(body, keys) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== [...keys].sort().join(',') ||
      typeof body.idempotencyKey !== 'string' || !body.idempotencyKey || body.idempotencyKey.length > 128) fail('LIBRA_EPISODE_MAPPING_INPUT');
}
function createEpisodeMetadataMappingService(options) {
  const store = options.episodeMetadataMappingStore, coordinator = createCommandCommitCoordinator(options);
  const now = options.now || Date.now;
  function readBasis(libraRunId) {
    const snapshot = options.movieProductionReader.readRunSnapshot(libraRunId);
    const identity = options.movieProductionReader.readFact(libraRunId, 'resolved_identity', 1);
    const basis = buildEpisodeMetadataBasis(snapshot, identity);
    return { snapshot, identity, basis };
  }
  function replay(kind, libraRunId, body, actorId) {
    const requestDigest = canonicalDigest({ libraRunId, ...body }), record = store.findCommand(kind, actorId, body.idempotencyKey);
    if (record && (record.requestDigest !== requestDigest || record.libraRunId !== libraRunId)) fail('P3_COMMAND_IDEMPOTENCY_CONFLICT');
    return { record, requestDigest };
  }
  function commit(kind, record) {
    return coordinator.execute({ command: { commandReceiptId: record.recordId, ownerDomain: 'libra',
      commandContract: 'libra.episode-metadata.'+kind+'@1', callerScope: record.actorId, idempotencyKey: record.idempotencyKey,
      requestDigest: record.requestDigest, targetType: 'episode_metadata_' + kind, targetId: record.recordId },
      domainParticipant: store.participant(kind, record),
      commitMarker: { commitMarker: record.recordId, effectId: null, scopeType: 'episode_metadata_' + kind,
        scopeId: record.recordId, commitDigest: record.recordDigest },
      auditRecords: [{ auditId: record.recordId + '-audit', actorType: 'admin', actorId: record.actorId,
        action: 'libra.episode-metadata.' + kind, scopeType: 'episode_metadata_' + kind, scopeId: record.recordId, evidenceDigest: record.recordDigest }],
      outboxMessages: [], resultEnvelope: value => ({ resultSchemaRef: 'libra.episode-metadata-command-receipt@1', resultRef: value }),
    });
  }
  return Object.freeze({
    read(libraRunId) {
      const { snapshot, basis } = readBasis(libraRunId), current = store.current(basis.subjectId);
      return { ...basis, state: snapshot.run.state, packageRevisionHead: snapshot.run.packageRevisionHead,
        expectedMappingRevision: current?.mapping.revision || 0, currentMapping: current?.mapping || null,
        currentReview: current ? store.readReview(current.reviewId).review : null };
    },
    readReview(libraRunId, reviewId) {
      const record = store.readReview(reviewId);
      if (record.libraRunId !== libraRunId) fail('LIBRA_EPISODE_REVIEW_NOT_FOUND');
      return record;
    },
    async inspect(libraRunId, body, actorId) {
      input(body, ['idempotencyKey', 'expectedRunStateRevision', 'expectedMappingRevision', 'providerSeasons']);
      if (!Array.isArray(body.providerSeasons) || !body.providerSeasons.length || body.providerSeasons.length > 16 ||
          body.providerSeasons.some(value => !Number.isSafeInteger(value) || value < 0 || value > 999) ||
          new Set(body.providerSeasons).size !== body.providerSeasons.length) fail('LIBRA_EPISODE_MAPPING_INPUT');
      const prior = replay('review', libraRunId, body, actorId);
      let record = prior.record;
      if (!record) {
        const { snapshot, identity, basis } = readBasis(libraRunId);
        const revision = store.current(basis.subjectId)?.mapping.revision || 0;
        if (!['active', 'suspended', 'frozen'].includes(snapshot.run.state) || snapshot.run.packageRevisionHead !== 0 ||
            basis.runStateRevision !== body.expectedRunStateRevision || revision !== body.expectedMappingRevision) fail('LIBRA_EPISODE_REVIEW_STALE');
        const observed = await options.observeEpisodeMetadataCandidates({
          resolvedProviderIdentity: identity.factValue.providerIdentities.find(item => item.namespace === 'tmdb_series'),
          providerSeasons: [...body.providerSeasons].sort((a, b) => a - b),
        });
        const evidence = observed.episodes.map(episode => buildProviderEpisodeEvidence({ integrationId: observed.integrationId,
          configRevision: observed.configRevision, language: observed.language, ...episode }));
        const review = buildEpisodeMetadataReview({ ...basis, expectedMappingRevision: revision, evidence });
        record = buildReviewRecord({ review, actorId, idempotencyKey: body.idempotencyKey, requestDigest: prior.requestDigest });
      }
      const result = commit('review', record);
      return { ...result, reviewRecord: record };
    },
    confirm(libraRunId, body, actorId) {
      input(body, ['idempotencyKey', 'reviewId', 'reviewDigest', 'choices']);
      const prior = replay('mapping', libraRunId, body, actorId);
      let record = prior.record;
      if (!record) {
        const reviewRecord = store.readReview(body.reviewId);
        if (reviewRecord.libraRunId !== libraRunId || reviewRecord.review.reviewDigest !== body.reviewDigest) fail('LIBRA_EPISODE_REVIEW_STALE');
        record = buildMappingRecord({ reviewRecord, choices: body.choices, actorId, idempotencyKey: body.idempotencyKey,
          requestDigest: prior.requestDigest, confirmedAtMs: now() });
      }
      const result = commit('mapping', record);
      // Replay repeats only the idempotent Owner continuation, never the
      // Provider request or a second confirmation of changed evidence.
      options.afterConfirmation?.(record);
      options.wake?.();
      return result;
    },
  });
}

module.exports = Object.freeze({ createEpisodeMetadataMappingService });
