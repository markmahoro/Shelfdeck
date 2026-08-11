'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const {
  createPerceptionResolutionInputAssembler,
} = require('./perception-resolution-input-assembler');
const {
  resolvePerception,
} = require('../model/perception-resolution-resolver');
const {
  createPerceptionResolutionCommitRegistration,
} = require('../model/perception-resolution-lifecycle');
const { createPerceptionStore } = require('../persistence/perception-store');

const VERSIONED_QUERY_RESULT_SCHEMA =
  'helix://contracts/types/VersionedQueryResult/v1';
const RESOLUTION_RESULT_SCHEMA =
  'helix://contracts/types/PerceptionResolutionRevision/v1';
const DEFAULT_FRESHNESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

class PerceptionResolutionApplicationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PerceptionResolutionApplicationError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new PerceptionResolutionApplicationError(code, message, details);
}

function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, freeze(item)]),
    ));
  }
  return value;
}

function buildRuleSnapshot() {
  const body = {
    ruleContract: 'perception-resolution-beta',
    ruleVersion: 1,
    supportedFactKinds: ['rating', 'watched'],
    candidateRetrievalClauses: [
      { anchorKind: 'provider_identity', lookupMode: 'exact', maxCandidates: 256 },
      { anchorKind: 'subject_id', lookupMode: 'exact', maxCandidates: 256 },
      { anchorKind: 'shelf_entry_id', lookupMode: 'exact', maxCandidates: 256 },
      { anchorKind: 'title_year', lookupMode: 'normalized_exact', normalizationProfileRef: 'unicode_nfkc_casefold', maxCandidates: 256 },
    ],
    anchorMatchers: [
      { anchorKind: 'provider_identity', matchMode: 'exact', strengthRank: 1, minConfidenceClass: 'strong' },
      { anchorKind: 'subject_id', matchMode: 'exact', strengthRank: 2, minConfidenceClass: 'exact' },
      { anchorKind: 'shelf_entry_id', matchMode: 'exact', strengthRank: 2, minConfidenceClass: 'exact' },
      { anchorKind: 'title_year', matchMode: 'normalized_exact', normalizationProfileRef: 'unicode_nfkc_casefold', strengthRank: 3, minConfidenceClass: 'medium' },
    ],
    winnerOrder:
      'strongest_anchor_then_value_consensus_then_perception_id',
    equalStrengthConflict: 'not_found',
    duplicateProofMatchers: [{
      anchorKind: 'provider_identity',
      matchMode: 'exact',
      minConfidenceClass: 'medium',
      requireSameAnchorValue: true,
      requireSameFactKind: true,
      requireSameCanonicalValue: true,
    }],
    maxCandidateRecords: 256,
  };
  return freeze({ ...body, ruleDigest: canonicalDigest(body) });
}

function validateQueryHandle(value, now) {
  if (!value || value.schemaRef !==
        'helix://contracts/types/CanonicalQueryHandle/v1' ||
      value.schemaVersion !== 1 ||
      value.providerDomain !== 'perception' ||
      value.consumerDomain !== 'libra' ||
      value.typedInputSchemaRef !==
        'helix://contracts/domain-types/PerceptionResolutionQuery/v1' ||
      value.queryContract !== value.typedInput?.queryContract ||
      value.queryVersion !== value.typedInput?.queryVersion ||
      value.inputDigest !== value.typedInput?.queryInputDigest ||
      value.fenceDigest !== canonicalDigest(
        Object.fromEntries(
          Object.entries(value).filter(([key]) => key !== 'fenceDigest'),
        ),
      ) ||
      !Number.isSafeInteger(value.expiresAtMs) ||
      value.expiresAtMs < now) {
    fail('PERCEPTION_QUERY_HANDLE_INVALID',
      'Perception Resolution requires one current digest-fenced Canonical Query Handle.');
  }
}

function commitHandle(draft, expectedRevision) {
  const aggregateId = 'perception-resolution:' + canonicalDigest({
    queryContract: draft.queryContract,
    queryInputDigest: draft.queryInputDigest,
  });
  const identity = {
    aggregateId,
    expectedRevision,
    recordSetDigest: draft.recordSetDigest,
    ruleDigest: draft.ruleDigest,
  };
  return freeze({
    ownerDomain: 'perception',
    aggregateType: 'perception-resolution',
    aggregateId,
    factType: 'PerceptionResolutionDraft',
    factSchemaRef: draft.schemaRef,
    resultSchemaRef: RESOLUTION_RESULT_SCHEMA,
    expectedRevision,
    handleId: 'perception-resolution-' + canonicalDigest({
      schema: 'perception.resolution-id@1',
      ...identity,
    }).slice(0, 40),
    commitIdempotencyKey: 'perception-resolution-marker-' + canonicalDigest({
      schema: 'perception.resolution-marker@1',
      ...identity,
    }).slice(0, 40),
    payloadDigest: canonicalDigest(draft),
  });
}

function versionedQueryResult(resolution, freshnessTtlMs) {
  const basisDigest = canonicalDigest({
    queryInputDigest: resolution.queryInputDigest,
    recordSetDigest: resolution.recordSetDigest,
    ruleDigest: resolution.ruleDigest,
  });
  const payload = {
    resolutionId: resolution.factId,
    resolutionRevision: resolution.revision,
    resolutionFactDigest: resolution.factDigest,
    resultKind: resolution.resultKind,
  };
  return freeze({
    schemaRef: VERSIONED_QUERY_RESULT_SCHEMA,
    schemaVersion: 1,
    evidenceId: resolution.factId,
    evidenceKind: 'perception_resolution',
    producerRef: 'perception.resolution.commit@1',
    basisDigest,
    payloadDigest: canonicalDigest(payload),
    observedAtMs: resolution.committedAtMs,
    providerDomain: 'perception',
    queryContract: resolution.queryContract,
    queryVersion: 1,
    inputDigest: resolution.queryInputDigest,
    resultKind: resolution.resultKind,
    resultRevision: resolution.revision,
    resultDigest: resolution.factDigest,
    expiresAtMs: resolution.committedAtMs + freshnessTtlMs,
  });
}

function createPerceptionResolutionApplication(options) {
  if (!options?.schemaManifest || !options.unitOfWork) {
    fail('PERCEPTION_RESOLUTION_APPLICATION_DEPENDENCIES',
      'Perception Resolution application requires owner persistence.');
  }
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const freshnessTtlMs = options.freshnessTtlMs ??
    DEFAULT_FRESHNESS_TTL_MS;
  if (!Number.isSafeInteger(freshnessTtlMs) || freshnessTtlMs < 0) {
    fail('PERCEPTION_RESOLUTION_FRESHNESS_INVALID',
      'Perception freshness TTL must be a non-negative integer.');
  }
  const store = createPerceptionStore(options);
  const assembler = createPerceptionResolutionInputAssembler({ store });
  const registration = createPerceptionResolutionCommitRegistration(store);
  const ruleSnapshot = buildRuleSnapshot();

  return Object.freeze({
    repositoryManifest: store.repositoryManifest,
    resolveDecisionFact(queryHandle) {
      const currentTime = now();
      validateQueryHandle(queryHandle, currentTime);
      const inputs = assembler.assemble({ queryHandle, ruleSnapshot });
      let resolution = store.getResolution(
        inputs.query.queryContract,
        inputs.query.queryInputDigest,
      );
      let replayed = false;
      let committed = false;
      if (resolution &&
          resolution.recordSetDigest === inputs.recordSet.recordSetDigest &&
          resolution.ruleDigest === inputs.ruleSnapshot.ruleDigest) {
        replayed = true;
      } else {
        const expectedRevision = resolution?.revision || 0;
        const draftIdentity = {
          queryContract: inputs.query.queryContract,
          queryInputDigest: inputs.query.queryInputDigest,
          expectedRevision,
          recordSetDigest: inputs.recordSet.recordSetDigest,
          ruleDigest: inputs.ruleSnapshot.ruleDigest,
        };
        const draft = resolvePerception(inputs, {
          draftId: 'perception-resolution-draft-' + canonicalDigest({
            schema: 'perception.resolution-draft-id@1',
            ...draftIdentity,
          }).slice(0, 40),
          producedAtMs: currentTime,
        });
        const participant = registration.createParticipant({
          handle: commitHandle(draft, expectedRevision),
          payload: draft,
        });
        resolution = options.unitOfWork.execute([participant])[
          participant.participantId
        ];
        committed = true;
      }
      if (committed && typeof options.afterResolutionCommit === 'function') {
        options.afterResolutionCommit(resolution);
      }
      const queryResult = versionedQueryResult(resolution, freshnessTtlMs);
      return freeze({
        kind: resolution.resultKind,
        providerDomain: 'perception',
        contract: {
          contractRef: resolution.queryContract,
          factKind: resolution.factKind,
          version: 1,
        },
        inputAnchorsDigest: resolution.queryInputDigest,
        revision: resolution.revision,
        ...(resolution.resultKind === 'found'
          ? { value: resolution.resolvedValue,
            evidence: [resolution.resolvedProvenance] }
          : { reasonCode: resolution.reasonCode, evidence: [] }),
        resolvedAtMs: resolution.committedAtMs,
        freshness: {
          status: currentTime <= queryResult.expiresAtMs ? 'fresh' : 'stale',
          resolvedAtMs: resolution.committedAtMs,
          validForMs: freshnessTtlMs,
        },
        resolution,
        queryResult,
        replayed,
      });
    },
  });
}

module.exports = Object.freeze({
  DEFAULT_FRESHNESS_TTL_MS,
  PerceptionResolutionApplicationError,
  buildRuleSnapshot,
  createPerceptionResolutionApplication,
  versionedQueryResult,
});
