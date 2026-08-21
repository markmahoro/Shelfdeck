'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Ajv2020 = require('ajv/dist/2020');
const Database = require('better-sqlite3');

const {
  canonicalDigest,
  canonicalJson,
} = require('../../src/helix/contracts/canonical-json');
const {
  openSqliteKernel,
} = require('../../src/helix/foundation/persistence/sqlite-kernel');
const {
  createSqliteUnitOfWork,
} = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {
  buildCanonicalQueryHandle,
  buildDecisionIdentityEvidenceSnapshot,
  deriveTitleYear,
  parseDecisionIdentityEvidenceSnapshot,
} = require('../../src/helix/domains/libra/model/decision-identity-evidence-contracts');
const {
  createPerceptionResolutionApplication,
} = require('../../src/helix/domains/perception/application/perception-resolution-application');
const {
  createPerceptionStore,
} = require('../../src/helix/domains/perception/persistence/perception-store');
const {
  resolveSpecDecisionEvidence,
} = require('../../src/helix/domains/libra/application/movie-formation-coordinator');

const generatedRoot = path.resolve(
  __dirname,
  '../../src/helix/foundation/persistence/generated',
);
const schemaDdl = fs.readFileSync(
  path.join(generatedRoot, 'clean-schema.sql'),
  'utf8',
);
const schemaManifest = JSON.parse(fs.readFileSync(
  path.join(generatedRoot, 'clean-schema.manifest.json'),
  'utf8',
));
const validateQueryResult = new Ajv2020({
  allErrors: true,
  strict: false,
}).compile(require(
  '../../src/helix/contracts/types/VersionedQueryResult/v1/schema.json'
));

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-p14-perception-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  let commitTime = 1_700_020_000_000;
  const kernel = openSqliteKernel({
    Database,
    databasePath,
    schemaDdl,
    schemaManifest,
    now: () => commitTime++,
  });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  try {
    return run({ databasePath, unitOfWork });
  } finally {
    kernel.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function acceptedIdentity(title = 'Example Movie', year = '2000') {
  const payload = {
    claimKind: 'movie_title',
    mediaType: 'single',
    contentProfile: 'movie',
    claimedTitle: title,
    displayIdentity: title,
    claimedYear: year,
    identityMetadataDigest: canonicalDigest({ title }),
    structureUnitDigest: canonicalDigest({ structure: 'single' }),
    sourceHints: [{
      hintKind: 'filename_title',
      hintValue: title,
      evidenceDigest: canonicalDigest({ hint: title }),
    }],
  };
  const claimDigest = canonicalDigest(payload);
  const identityClaim = {
    schemaRef: 'helix://contracts/types/IdentityClaim/v1',
    schemaVersion: 1,
    draftId: 'identity-claim-1',
    draftKind: 'procurement_identity_claim',
    basisDigest: canonicalDigest({ basis: title }),
    draftDigest: claimDigest,
    producedAtMs: 0,
    ...payload,
    claimDigest,
  };
  const candidatePackage = {
    candidatePackageId: 'candidate-package-1',
    packageRevision: 1,
    packageDigest: canonicalDigest({ package: title }),
    identityClaim,
  };
  const snapshotBody = { candidatePackage };
  const deliverySnapshot = {
    ...snapshotBody,
    deliverySnapshotDigest: canonicalDigest(snapshotBody),
  };
  const intakeDecision = {
    intakeDecisionId: 'intake-decision-1',
    candidatePackageId: candidatePackage.candidatePackageId,
    packageRevision: candidatePackage.packageRevision,
    packageDigest: candidatePackage.packageDigest,
    candidateDeliverySnapshotDigest: deliverySnapshot.deliverySnapshotDigest,
    candidateIdentityClaimDigest: identityClaim.claimDigest,
  };
  return { deliverySnapshot, intakeDecision };
}

function decisionEvidence(title) {
  const accepted = acceptedIdentity(title);
  return buildDecisionIdentityEvidenceSnapshot(
    accepted.deliverySnapshot,
    accepted.intakeDecision,
  );
}

function registerRecord(store, {
  id = 'perception-1',
  title = 'Example Movie',
  rating = null,
  watchedState = null,
  year = '2000',
} = {}) {
  store.registerSource({
    perceptionSourceId: 'source-1',
    sourceKind: 'user',
    integrationId: 'shelfdeck-user-perception',
    status: 'active',
    configRevision: 1,
  });
  const scope = { source: 'user_perception' };
  store.startAcquisition({
    perceptionAcquisitionId: 'acquisition-1',
    perceptionSourceId: 'source-1',
    sourceConfigRevision: 1,
    scopeSchemaRef: 'helix://contracts/types/PerceptionAcquisitionScope/v1',
    scope,
    scopeDigest: canonicalDigest(scope),
    initialCursorRevision: 0,
    initialCursorValue: null,
  });
  store.commitPage({
    acquisitionCommitReceiptId: 'commit-1',
    perceptionAcquisitionId: 'acquisition-1',
    perceptionSourceId: 'source-1',
    pageOrdinal: 0,
    expectedCursorRevision: 0,
    cursorIn: null,
    cursorOut: 'cursor-1',
    observationPageDigest: canonicalDigest({ page: 1 }),
    hasMore: false,
    commitMarker: 'perception-page-marker-1',
    records: [{
      perceptionId: id,
      recordKind: 'observation',
      sourceKind: 'user',
      sourceRecordKey: id,
      sourceRecordRevision: 1,
      sourceRecordDigest: canonicalDigest({ source: id }),
      normalizationRuleRef: 'user-perception-normalization@1',
      rating,
      watchedState,
      observedTitle: title,
      provenanceRef: 'user-perception:' + id,
      provenanceDigest: canonicalDigest({ provenance: id }),
      observedAtMs: 1_700_000_000_000,
      anchors: [{
        anchorKind: 'title',
        anchorValue: title,
        confidenceClass: 'strong',
        evidenceDigest: canonicalDigest({ anchor: title }),
      }, {
        anchorKind: 'title_year',
        anchorValue: title + '\0' + year,
        confidenceClass: 'medium',
        evidenceDigest: canonicalDigest({ anchor: title, year }),
      }],
    }],
    relations: [],
  });
}

function count(databasePath, table) {
  const database = new Database(databasePath, { readonly: true });
  try {
    return database.prepare(`SELECT count(*) count FROM ${table}`).get().count;
  } finally {
    database.close();
  }
}

test('freezes the accepted claim title as a versioned Libra evidence anchor', () => {
  const accepted = acceptedIdentity('  EXAMPLE\u00a0Movie  ');
  const snapshot = buildDecisionIdentityEvidenceSnapshot(
    accepted.deliverySnapshot,
    accepted.intakeDecision,
  );
  assert.equal(snapshot.mappingRef, 'libra.candidate-claim-title-anchor@2');
  assert.equal(snapshot.identityEvidence[0].anchorValue, 'example movie');
  assert.equal(snapshot.identityEvidence[0].confidenceClass, 'medium');
  assert.notEqual(
    snapshot.identityEvidence[0].anchorValue,
    accepted.intakeDecision.candidateIdentityClaimDigest,
  );
  const row = {
    intake_decision_id: accepted.intakeDecision.intakeDecisionId,
    candidate_package_id: accepted.intakeDecision.candidatePackageId,
    package_revision: accepted.intakeDecision.packageRevision,
    package_digest: accepted.intakeDecision.packageDigest,
    candidate_delivery_snapshot_digest:
      accepted.intakeDecision.candidateDeliverySnapshotDigest,
    candidate_identity_claim_digest:
      accepted.intakeDecision.candidateIdentityClaimDigest,
    decision_identity_evidence_schema_ref: snapshot.schemaRef,
    decision_identity_evidence_json: canonicalJson(snapshot),
    decision_identity_evidence_digest: snapshot.snapshotDigest,
  };
  assert.deepEqual(parseDecisionIdentityEvidenceSnapshot(row), snapshot);
});

test('derives an explicit terminal folder year without changing Procurement facts', () => {
  assert.deepEqual(
    deriveTitleYear('Example Movie (2000)'),
    { title: 'example movie', year: 2000 },
  );
  assert.deepEqual(
    deriveTitleYear('Example 2000 Cut'),
    { title: 'example 2000 cut', year: null },
  );
  assert.deepEqual(
    deriveTitleYear('看不见的朋友 (2023) - 1080p H.264 CHDWEB'),
    { title: '看不见的朋友', year: 2023 },
  );
});

test('freezes a versioned exact title-year anchor before technical release labels', () => {
  const accepted = acceptedIdentity(
    '看不见的朋友 (2023) - 1080p H.264 CHDWEB',
    null,
  );
  const snapshot = buildDecisionIdentityEvidenceSnapshot(
    accepted.deliverySnapshot,
    accepted.intakeDecision,
  );
  assert.equal(snapshot.mappingRef, 'libra.candidate-claim-title-anchor@2');
  assert.equal(snapshot.evidenceRevision, 2);
  assert.deepEqual(snapshot.identityEvidence.map((item) => item.anchorValue), [
    '看不见的朋友',
    '看不见的朋友\0' + '2023',
  ]);
  const row = {
    intake_decision_id: accepted.intakeDecision.intakeDecisionId,
    candidate_package_id: accepted.intakeDecision.candidatePackageId,
    package_revision: accepted.intakeDecision.packageRevision,
    package_digest: accepted.intakeDecision.packageDigest,
    candidate_delivery_snapshot_digest:
      accepted.intakeDecision.candidateDeliverySnapshotDigest,
    candidate_identity_claim_digest:
      accepted.intakeDecision.candidateIdentityClaimDigest,
    decision_identity_evidence_schema_ref: snapshot.schemaRef,
    decision_identity_evidence_json: canonicalJson(snapshot),
    decision_identity_evidence_digest: snapshot.snapshotDigest,
  };
  assert.deepEqual(parseDecisionIdentityEvidenceSnapshot(row), snapshot);
});

test('commits and reuses one real not_found Resolution when no record exists', () => {
  fixture(({ databasePath, unitOfWork }) => {
    const now = 1_700_020_000_100;
    const application = createPerceptionResolutionApplication({
      schemaManifest,
      unitOfWork,
      now: () => now,
    });
    const handle = buildCanonicalQueryHandle(
      decisionEvidence('Example Movie'),
      'rating',
    );
    const first = application.resolveDecisionFact(handle);
    const replay = application.resolveDecisionFact(handle);
    assert.equal(first.kind, 'not_found');
    assert.equal(first.reasonCode, 'no_matching_record');
    assert.equal(first.resolution.revision, 1);
    assert.equal(replay.replayed, true);
    assert.equal(replay.resolution.factDigest, first.resolution.factDigest);
    assert.equal(replay.queryResult.resultDigest, first.queryResult.resultDigest);
    assert.equal(validateQueryResult(first.queryResult), true,
      JSON.stringify(validateQueryResult.errors));
    assert.equal(count(databasePath, 'perception_resolution_revisions'), 1);
  });
});

test('distinguishes rating found from watched-only rating not_found', () => {
  fixture(({ unitOfWork }) => {
    const store = createPerceptionStore({ schemaManifest, unitOfWork });
    registerRecord(store, { rating: 5, watchedState: true });
    const result = createPerceptionResolutionApplication({
      schemaManifest,
      unitOfWork,
      now: () => 1_700_020_000_100,
    }).resolveDecisionFact(buildCanonicalQueryHandle(
      decisionEvidence('example movie'),
      'rating',
    ));
    assert.equal(result.kind, 'found');
    assert.deepEqual(result.value, { factKind: 'rating', value: 5 });
  });
  fixture(({ unitOfWork }) => {
    const store = createPerceptionStore({ schemaManifest, unitOfWork });
    registerRecord(store, { rating: null, watchedState: true });
    const result = createPerceptionResolutionApplication({
      schemaManifest,
      unitOfWork,
      now: () => 1_700_020_000_100,
    }).resolveDecisionFact(buildCanonicalQueryHandle(
      decisionEvidence('Example Movie'),
      'rating',
    ));
    assert.equal(result.kind, 'not_found');
    assert.equal(result.reasonCode, 'requested_fact_absent');
  });
});

test('advances the same query head only when its owner record set changes', () => {
  fixture(({ databasePath, unitOfWork }) => {
    const application = createPerceptionResolutionApplication({
      schemaManifest,
      unitOfWork,
      now: () => 1_700_020_000_100,
    });
    const handle = buildCanonicalQueryHandle(
      decisionEvidence('Example Movie'),
      'rating',
    );
    const absent = application.resolveDecisionFact(handle);
    assert.equal(absent.kind, 'not_found');
    assert.equal(absent.revision, 1);
    registerRecord(
      createPerceptionStore({ schemaManifest, unitOfWork }),
      { rating: 4 },
    );
    const found = application.resolveDecisionFact(handle);
    assert.equal(found.kind, 'found');
    assert.equal(found.revision, 2);
    assert.deepEqual(found.value, { factKind: 'rating', value: 4 });
    assert.notEqual(
      found.resolution.recordSetDigest,
      absent.resolution.recordSetDigest,
    );
    assert.equal(count(databasePath, 'perception_resolution_revisions'), 2);
  });
});

test('skips undeclared rating queries and fails closed on unavailable or corrupt owner results', () => {
  const evidence = decisionEvidence('Example Movie');
  const subject = { contentProfile: 'movie' };
  let calls = 0;
  const nonRating = resolveSpecDecisionEvidence({
    resolvePerceptionDecisionFact() {
      calls += 1;
      throw new Error('must not be called');
    },
  }, evidence, {
    standard: {
      profileRuleSets: [{
        contentProfile: 'movie',
        decisionInputKinds: [],
      }],
    },
  }, subject);
  assert.equal(nonRating.readiness.result, 'ready');
  assert.deepEqual(nonRating.decisionFacts, []);
  assert.deepEqual(nonRating.queryResults, []);
  assert.equal(calls, 0);

  const ratingStandard = {
    standard: {
      profileRuleSets: [{
        contentProfile: 'movie',
        decisionInputKinds: ['rating'],
      }],
    },
  };
  const unavailable = resolveSpecDecisionEvidence({
    resolvePerceptionDecisionFact() {
      throw Object.assign(new Error('unavailable'), {
        code: 'PERCEPTION_UNAVAILABLE',
      });
    },
  }, evidence, ratingStandard, subject);
  assert.deepEqual(unavailable.readiness, {
    result: 'unresolved',
    reasonCode: 'required_input_unavailable',
  });

  const corrupt = resolveSpecDecisionEvidence({
    resolvePerceptionDecisionFact() {
      return {
        providerDomain: 'perception',
        kind: 'not_found',
        inputAnchorsDigest: canonicalDigest({ forged: true }),
        freshness: { status: 'fresh' },
        resolution: {},
        queryResult: {},
      };
    },
  }, evidence, ratingStandard, subject);
  assert.deepEqual(corrupt.readiness, {
    result: 'unresolved',
    reasonCode: 'required_input_conflicting',
  });
});
