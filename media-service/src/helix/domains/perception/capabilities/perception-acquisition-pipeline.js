'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');

const OBSERVATION_PAGE_SCHEMA = 'helix://contracts/types/PerceptionObservationPage/v1';
const COMMIT_DRAFT_SCHEMA = 'helix://contracts/types/PerceptionAcquisitionCommitDraft/v1';

class PerceptionPipelineError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'PerceptionPipelineError'; this.code = code; this.details = details; }
}
function fail(code, message, details) { throw new PerceptionPipelineError(code, message, details); }
function exact(value, keys, code) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) fail(code, 'Perception pipeline value does not match its closed contract.'); }
function freeze(value) { return Array.isArray(value) ? Object.freeze(value.map(freeze)) : value && typeof value === 'object' ? Object.freeze(Object.fromEntries(Object.entries(value).map(([key,item]) => [key,freeze(item)]))) : value; }

function validateSource(value) {
  if (!value || value.schemaRef !== 'helix://contracts/domain-types/PerceptionSourceSnapshot/v1' || value.schemaVersion !== 1 ||
      !Number.isSafeInteger(value.sourceConfigRevision) || value.sourceConfigRevision < 1 || typeof value.sourceId !== 'string' ||
      typeof value.sourceKind !== 'string' || canonicalDigest(sourceDigestBasis(value)) !== value.digest) fail('P6_PERCEPTION_SOURCE_SNAPSHOT_INVALID', 'Acquisition requires an exact immutable Source snapshot.');
}
function sourceDigestBasis(value) { return { sourceId:value.sourceId, sourceKind:value.sourceKind, integrationId:value.integrationId,
  sourceConfigRevision:value.sourceConfigRevision, sourceScopeDigest:value.sourceScopeDigest }; }
function validateCursor(value) {
  if (!value || value.schemaRef !== 'helix://contracts/domain-types/PerceptionAcquisitionCursor/v1' || value.schemaVersion !== 1 ||
      !Number.isSafeInteger(value.pageOrdinal) || value.pageOrdinal < 0 || !Number.isSafeInteger(value.expectedCursorRevision) ||
      value.expectedCursorRevision < 0 || !Number.isSafeInteger(value.pageBudget) || value.pageBudget < 1 || value.pageBudget > 100 ||
      canonicalDigest(cursorDigestBasis(value)) !== value.digest) {
    fail('P6_PERCEPTION_ACQUISITION_CURSOR_INVALID', 'Acquisition Cursor is invalid or exceeds the Provider page bound.');
  }
}
function cursorDigestBasis(value) { return { perceptionAcquisitionId:value.perceptionAcquisitionId, pageOrdinal:value.pageOrdinal,
  expectedCursorRevision:value.expectedCursorRevision, cursorIn:value.cursorIn, pageBudget:value.pageBudget }; }
function validateObservation(value) {
  exact(value, ['observationId','sourceRecordKey','sourceRecordRevision','sourceRecordDigest','observedAtMs','payloadSchemaRef','payloadDigest','inlinePayload','provenanceDigest'], 'P6_PERCEPTION_OBSERVATION_SHAPE');
  if (!Number.isSafeInteger(value.sourceRecordRevision) || value.sourceRecordRevision < 1 || !Number.isSafeInteger(value.observedAtMs) || value.observedAtMs < 0 ||
      canonicalDigest(value.inlinePayload) !== value.payloadDigest) fail('P6_PERCEPTION_OBSERVATION_INVALID', 'Provider observation payload or digest is invalid.');
  return freeze(value);
}

function createPerceptionAcquisitionPipeline(options) {
  if (!options || !options.providerObservation || typeof options.providerObservation.execute !== 'function' ||
      !options.observationReader || typeof options.observationReader.read !== 'function' ||
      !options.ruleEvaluator || typeof options.ruleEvaluator.normalize !== 'function' || typeof options.digest !== 'function') {
    fail('P6_PERCEPTION_PIPELINE_DEPENDENCIES', 'Provider observation, observation reader, rule evaluator, and digest are required.');
  }
  return Object.freeze({
    async acquirePage(request) {
      exact(request, ['sourceSnapshot','cursor','integrationHandle','secretLeaseHandle','idempotencyKey','timeoutMs','evidenceId','observedAtMs'], 'P6_PERCEPTION_ACQUIRE_REQUEST');
      validateSource(request.sourceSnapshot); validateCursor(request.cursor);
      if (request.sourceSnapshot.integrationId !== request.integrationHandle.integrationId || request.sourceSnapshot.sourceConfigRevision !== request.integrationHandle.configRevision) fail('P6_PERCEPTION_INTEGRATION_FENCE_MISMATCH', 'Integration Handle does not match the frozen Source snapshot.');
      const input = freeze({ sourceRef:freeze({ objectType:'perception-source', objectId:request.sourceSnapshot.sourceId,
        revision:request.sourceSnapshot.sourceConfigRevision, digest:request.sourceSnapshot.digest }), cursor:request.cursor.cursorIn, limit:request.cursor.pageBudget });
      const digestBasis = freeze({ integrationId:request.integrationHandle.integrationId, integrationType:request.integrationHandle.integrationType,
        configRevision:request.integrationHandle.configRevision, operationId:'perception.source.acquire@1', idempotencyKey:request.idempotencyKey, input });
      const response = await options.providerObservation.execute(freeze({ integrationHandle:request.integrationHandle,
        secretLeaseHandle:request.secretLeaseHandle, operationId:'perception.source.acquire@1', idempotencyKey:request.idempotencyKey,
        requestDigest:options.digest(canonicalJson(digestBasis)), timeoutMs:request.timeoutMs, input }));
      const observations = [];
      for (const reference of response.result.resultRefs) observations.push(validateObservation(await options.observationReader.read(reference)));
      const cursorOut = response.result.nextCursor === null ? 'terminal:' + response.responseDigest : response.result.nextCursor;
      const payload = { perceptionAcquisitionId:request.cursor.perceptionAcquisitionId, pageOrdinal:request.cursor.pageOrdinal,
        source:{ sourceId:request.sourceSnapshot.sourceId, sourceKind:request.sourceSnapshot.sourceKind,
          sourceConfigRevision:request.sourceSnapshot.sourceConfigRevision },
        cursor:{ expectedCursorRevision:request.cursor.expectedCursorRevision, cursorIn:request.cursor.cursorIn, cursorOut },
        observations, hasMore:response.result.nextCursor !== null };
      const observationPageDigest = canonicalDigest(payload);
      if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > 65536) fail('P6_PERCEPTION_OBSERVATION_PAGE_BOUND', 'Observation Page exceeds 64 KiB.');
      return freeze({ schemaRef:OBSERVATION_PAGE_SCHEMA, schemaVersion:1, evidenceId:request.evidenceId,
        evidenceKind:'perception_observation_page', producerRef:'perception.source.acquire@1', basisDigest:canonicalDigest({ source:request.sourceSnapshot.digest, cursor:request.cursor.digest }),
        payloadDigest:observationPageDigest, observedAtMs:request.observedAtMs, ...payload, observationPageDigest });
    },
    async normalizePage(request) {
      exact(request, ['observationPage','normalizationRule','draftId','producedAtMs'], 'P6_PERCEPTION_NORMALIZE_REQUEST');
      const page = request.observationPage; const rule = request.normalizationRule;
      if (!page || page.schemaRef !== OBSERVATION_PAGE_SCHEMA || canonicalDigest({ perceptionAcquisitionId:page.perceptionAcquisitionId,
        pageOrdinal:page.pageOrdinal, source:page.source, cursor:page.cursor, observations:page.observations, hasMore:page.hasMore }) !== page.observationPageDigest ||
        !rule || rule.schemaRef !== 'helix://contracts/domain-types/PerceptionNormalizationRuleRef/v1' || rule.sourceKind !== page.source.sourceKind ||
        canonicalDigest({ ruleRef:rule.ruleRef, ruleVersion:rule.ruleVersion, sourceKind:rule.sourceKind,
          canonicalRatingScale:rule.canonicalRatingScale, ruleDigest:rule.ruleDigest }) !== rule.digest) {
        fail('P6_PERCEPTION_NORMALIZATION_BASIS_INVALID', 'Normalization requires an intact page and matching revisioned rule.');
      }
      const records = []; const sourceLineageRelations = [];
      for (const observation of page.observations) {
        const normalized = await options.ruleEvaluator.normalize(freeze({ observation, rule }));
        exact(normalized, ['record','sourceLineageRelations'], 'P6_PERCEPTION_NORMALIZER_OUTPUT');
        records.push(freeze(normalized.record));
        if (!Array.isArray(normalized.sourceLineageRelations)) fail('P6_PERCEPTION_NORMALIZER_OUTPUT', 'Normalizer lineage must be a bounded array.');
        sourceLineageRelations.push(...normalized.sourceLineageRelations.map(freeze));
      }
      if (records.length > 4096 || sourceLineageRelations.length > 4096) fail('P6_PERCEPTION_NORMALIZATION_BOUND', 'Normalized page exceeds its closed fact bounds.');
      const body = { perceptionAcquisitionId:page.perceptionAcquisitionId, source:page.source,
        normalizationRuleRef:rule.ruleRef + '@' + rule.ruleVersion,
        cursorTransition:{ pageOrdinal:page.pageOrdinal, expectedCursorRevision:page.cursor.expectedCursorRevision,
          cursorIn:page.cursor.cursorIn, cursorOut:page.cursor.cursorOut, observationPageDigest:page.observationPageDigest, hasMore:page.hasMore },
        records, sourceLineageRelations };
      if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 65536) fail('P6_PERCEPTION_NORMALIZATION_BOUND', 'Commit Draft exceeds 64 KiB.');
      return freeze({ schemaRef:COMMIT_DRAFT_SCHEMA, schemaVersion:1, draftId:request.draftId,
        draftKind:'perception_acquisition_commit', basisDigest:page.observationPageDigest, draftDigest:canonicalDigest(body),
        producedAtMs:request.producedAtMs, ...body });
    }
  });
}

function createPerceptionRecordCommitRegistration(store) {
  if (!store || typeof store.createRecordCommitParticipant !== 'function') fail('P6_PERCEPTION_COMMIT_STORE_REQUIRED', 'Perception Store commit participant factory is required.');
  return Object.freeze({ ownerDomain:'perception', aggregateType:'perception-acquisition', factType:'PerceptionAcquisitionCommitDraft',
    factSchemaRef:COMMIT_DRAFT_SCHEMA, effectClass:'domain_fact_commit', revisionFence:true,
    createParticipant({ handle, payload }) { return store.createRecordCommitParticipant(handle, payload); } });
}

module.exports = Object.freeze({ PerceptionPipelineError, createPerceptionAcquisitionPipeline, createPerceptionRecordCommitRegistration });
