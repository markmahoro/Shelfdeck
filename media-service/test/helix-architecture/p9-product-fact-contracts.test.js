'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { buildMediaCastDraft, buildMetadataFetchIntent, buildMetadataObservationBasis, buildProductFactHandle,
  buildProductMetadataDraft, metadataObservationWorkIdempotencyKey, selectMetadataObservations,
  validateVerifiedArtifactManifest } =
  require('../../src/helix/domains/libra/model/product-fact-contracts');

const d = (value) => canonicalDigest({ value });

function intents() {
  return [
    buildMetadataFetchIntent({ libraRunId:'run-1', runExecutionBasisDigest:d('run-basis'), sourceKind:'related_nfo',
      sourcePriority:0, contentProfile:'movie', resolvedIdentityDigest:d('identity'), requestedFields:['plot','title'],
      relatedReferenceId:'ref-nfo', relatedReferenceDigest:d('ref'), expectedChecksum:d('checksum') }),
    buildMetadataFetchIntent({ libraRunId:'run-1', runExecutionBasisDigest:d('run-basis'), sourceKind:'provider',
      sourcePriority:1, contentProfile:'movie', resolvedIdentityDigest:d('identity'), requestedFields:['plot','title'],
      providerKind:'tmdb', integrationId:'tmdb-main', configRevision:3 })
  ];
}

function observation(intent, options = {}) {
  const result = { schemaRef:'helix://contracts/types/MetadataObservation/v1', schemaVersion:1,
    evidenceId:options.evidenceId || `evidence-${intent.sourcePriority}`, evidenceKind:'metadata_observation',
    producerRef:'libra.product_metadata.fetch@1', basisDigest:d(`basis-${intent.sourcePriority}`), payloadDigest:'', observedAtMs:10,
    fetchIntentDigest:intent.intentDigest, sourceKind:intent.sourceKind,
    sourceRef:intent.sourceKind === 'related_nfo' ? intent.relatedReferenceId : `${intent.providerKind}:${intent.integrationId}@${intent.configRevision}`,
    sourcePriority:intent.sourcePriority, identityDigest:intent.resolvedIdentityDigest, contentProfile:intent.contentProfile,
    descriptiveFacts:{ schemaRef:'helix://contracts/records/descriptive-facts/v1', schemaVersion:1,
      recordKind:'descriptive-facts', recordDigest:d(`facts-${intent.sourcePriority}`), entries:options.entries || [] },
    providerIdentitySet:{ schemaRef:'helix://contracts/records/provider-identity-set/v1', schemaVersion:1,
      recordKind:'provider-identity-set', recordDigest:d(`providers-${intent.sourcePriority}`), entries:[] },
    peopleHints:[], artifactHints:[] };
  result.payloadDigest = d(`payload-${intent.sourcePriority}`);
  const resultId = options.resultId || `result-${intent.sourcePriority}`;
  return { ownerDomain:'libra', processType:'libra_run', processId:'run-1', workKind:'product_metadata_observation',
    workState:'succeeded', capabilityRef:'libra.product_metadata.fetch@1',
    resultSchemaRef:result.schemaRef, result, resultId, resultDigest:result.payloadDigest,
    resultBindingDigest:canonicalDigest(result), inputBindingDigest:canonicalDigest(intent),
    workId:`work-${intent.sourcePriority}`, attemptId:`attempt-${intent.sourcePriority}`,
    planId:`plan-${intent.sourcePriority}`, eventId:`event-${intent.sourcePriority}` };
}

test('freezes fixed metadata source identity and rejects cross-profile fallback', () => {
  const [nfo, tmdb] = intents();
  assert.equal(nfo.sourcePriority, 0);
  assert.equal(tmdb.sourcePriority, 1);
  assert.equal(metadataObservationWorkIdempotencyKey(nfo), canonicalDigest({ schema:'libra.metadata-observation-work@1',
    libraRunId:'run-1', runExecutionBasisDigest:d('run-basis'), fetchIntentDigest:nfo.intentDigest }));
  assert.throws(() => buildMetadataFetchIntent({ ...tmdb, contentProfile:'jav', providerKind:'tmdb' }),
    (error) => error.code === 'P9_METADATA_SOURCE_ORDER');
  assert.throws(() => buildMetadataFetchIntent({ ...nfo, contentProfile:'western_adult' }),
    (error) => error.code === 'P9_METADATA_INTENT_FIELDS');
});

test('selects only exact durable observation chains and collapses semantic replay deterministically', () => {
  const sourceIntents = intents(), later = observation(sourceIntents[0], { resultId:'z-result' }),
    earlier = observation(sourceIntents[0], { resultId:'a-result' }), provider = observation(sourceIntents[1]);
  earlier.result = later.result;
  earlier.resultDigest = later.resultDigest;
  earlier.resultBindingDigest = later.resultBindingDigest;
  const selected = selectMetadataObservations({ intents:sourceIntents, results:[later, provider, earlier] });
  assert.deepEqual(selected.items.map((item) => item.resultId), ['a-result', 'result-1']);
  const divergentResult={ ...earlier.result, payloadDigest:d('changed') };
  assert.throws(() => selectMetadataObservations({ intents:sourceIntents,
    results:[later, { ...earlier, result:divergentResult, resultDigest:divergentResult.payloadDigest,
      resultBindingDigest:canonicalDigest(divergentResult) }] }), (error) => error.code === 'P9_METADATA_OBSERVATION_CONFLICT');
  assert.throws(() => selectMetadataObservations({ intents:sourceIntents, results:[{ ...later, ownerDomain:'people' }] }),
    (error) => error.code === 'P9_METADATA_OBSERVATION_CHAIN');
});

test('builds a closed observation basis and NFO-first complete metadata draft', () => {
  const sourceIntents = intents();
  const nfo = observation(sourceIntents[0], { entries:[{ key:'title', value:'Local title' }] });
  const tmdb = observation(sourceIntents[1], { entries:[{ key:'title', value:'Provider title' }, { key:'plot', value:'Plot' }] });
  const basis = buildMetadataObservationBasis({ intents:sourceIntents, results:[tmdb,nfo], factKind:'product_metadata', expectedRevision:0 });
  assert.equal(basis.sourceBasisKind, 'metadata_observation');
  assert.deepEqual(basis.observationSet.sourcePrecedence.map((item) => item.sourcePriority), [0,1]);
  assert.equal(basis.selection.items[0].resultId, 'result-0');
  assert.equal(basis.productFactId, canonicalDigest({schema:'libra.product-fact-id@1',libraRunId:'run-1',
    factKind:'product_metadata',factRevision:1}));
  assert.equal(basis.selection.items[0].sourceReferenceDigest, canonicalDigest({schema:'libra.product-fact-source-ref@1',
    productFactId:basis.productFactId,ordinal:0,sourceBasisKind:'metadata_observation',workId:'work-0',attemptId:'attempt-0',
    planId:'plan-0',eventId:'event-0',resultId:'result-0',capabilityRef:'libra.product_metadata.fetch@1',
    resultSchemaRef:'helix://contracts/types/MetadataObservation/v1',resultDigest:nfo.resultDigest,sourceRef:'ref-nfo',
    sourceOrder:0,evidenceId:'evidence-0',evidenceDigest:nfo.result.payloadDigest,inputBindingDigest:nfo.inputBindingDigest}));
  const built = buildProductMetadataDraft({ sourceBasis:basis, requiredFields:['title','plot'], producedAtMs:100,
    providerIdentities:[], artifactRequirements:[] });
  assert.equal(built.ready, true);
  assert.deepEqual(built.draft.descriptiveFacts.entries, [{ key:'plot', value:'Plot' }, { key:'title', value:'Local title' }]);
  assert.equal(built.draft.fieldProvenance.find((item) => item.fieldPath === 'title').sourceKind, 'related_nfo');
  assert.deepEqual(buildProductMetadataDraft({ sourceBasis:basis, requiredFields:['title','runtime'], producedAtMs:100 }).missingFields,
    ['runtime']);
});

test('derives stable Product Fact aggregate, revision fence, handle, and marker identity', () => {
  const payloadDigest=d('payload'), eventFenceDigest=d('event-fence');
  const first=buildProductFactHandle({ libraRunId:'run-1', factKind:'media_cast', expectedRevision:0, payloadDigest, eventFenceDigest });
  const replay=buildProductFactHandle({ libraRunId:'run-1', factKind:'media_cast', expectedRevision:0, payloadDigest, eventFenceDigest });
  assert.deepEqual(first,replay);
  assert.equal(first.factSchemaRef,'helix://contracts/types/MediaCastFact/v1');
  assert.equal(first.commitIdempotencyKey,canonicalDigest({ schema:'libra.product-fact-commit-key@1',aggregateId:first.aggregateId,
    expectedRevision:0,payloadDigest,eventFenceDigest }));
  assert.notEqual(first.aggregateId,buildProductFactHandle({ libraRunId:'run-1',factKind:'product_metadata',expectedRevision:0,
    payloadDigest,eventFenceDigest }).aggregateId);
});

test('keeps Media Cast in Libra and accepts only explicit People Projection references', () => {
  const sourceIntents=intents(), basis=buildMetadataObservationBasis({intents:sourceIntents,
    results:[observation(sourceIntents[0],{entries:[{key:'title',value:'A'}]})],factKind:'media_cast',expectedRevision:0});
  const relation={ relationId:'cast-1',personId:'person-1',displayName:'Actor',displayNameNormalized:'actor',role:'actor',
    source:'related_nfo',providerIdentities:[],originEvidenceDigest:d('cast-evidence'),confidenceClass:'declared' };
  const draft=buildMediaCastDraft({subjectId:'subject-1',sourceBasis:basis,relations:[relation],producedAtMs:10,
    personProjection:{items:[{personId:'person-1',projectionDigest:d('person-projection')}]}});
  assert.equal(draft.subjectId,'subject-1');
  assert.equal(draft.relations[0].relationDigest,canonicalDigest(relation));
  assert.throws(()=>buildMediaCastDraft({subjectId:'subject-1',sourceBasis:basis,relations:[relation],producedAtMs:10,
    personProjection:{items:[]}}),(error)=>error.code==='P9_MEDIA_CAST_PERSON_PROJECTION');
  const westernBasis={sourceBasisKind:'western_match',sourceBasisDigest:d('western-basis'),
    westernBasis:{basisDigest:d('western-basis'),matchState:'no_matches'}};
  assert.equal(buildMediaCastDraft({subjectId:'subject-1',sourceBasis:westernBasis,relations:[],producedAtMs:10}).relations.length,0);
  assert.throws(()=>buildMediaCastDraft({subjectId:'subject-1',sourceBasis:westernBasis,relations:[{...relation,personId:null}],producedAtMs:10}),
    (error)=>error.code==='P9_MEDIA_CAST_MATCH_CONTINUITY');
});

test('verifies artifact handles without embedding bytes or reading a second owner', () => {
  const snapshot={artifactHandleId:'artifact-1',artifactKind:'poster',artifactRevision:1,artifactDigest:d('artifact'),
    verificationEvidenceId:'verify-1',verificationEvidenceDigest:d('verification')};
  const item={ordinal:0,...snapshot,requirementDigest:d('requirement')};
  item.referenceDigest=canonicalDigest(item);
  const artifactSetDigest=canonicalDigest({schema:'libra.verified-artifact-set@1',items:[item]});
  const manifestId=canonicalDigest({schema:'libra.verified-artifact-manifest-id@1',libraRunId:'run-1',artifactSetDigest});
  const manifest={manifestId,libraRunId:'run-1',items:[item],artifactSetDigest};
  manifest.manifestDigest=canonicalDigest(manifest);
  assert.deepEqual(validateVerifiedArtifactManifest(manifest,[snapshot]),manifest);
  assert.throws(()=>validateVerifiedArtifactManifest(manifest,[{...snapshot,artifactDigest:d('tampered')}]),
    (error)=>error.code==='P9_ARTIFACT_HANDLE_MISMATCH');
});
