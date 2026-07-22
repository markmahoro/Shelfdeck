'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { buildArtifactManifestVerification, buildMediaCastDraft, buildMediaCastFact, buildMetadataFetchIntent, buildMetadataObservationBasis, buildProductFactEvidence,
  buildProductFactHandle, buildProductMetadataDraft, buildProductMetadataFact, metadataObservationWorkIdempotencyKey, selectMetadataObservations,
  buildProductFactSourceRefs,
  validateVerifiedArtifactManifest } =
  require('../../src/helix/domains/libra/model/product-fact-contracts');

const d = (value) => canonicalDigest({ value });

function artifactRequirement(kind = 'poster') {
  const value = { requirementId:'', revision:1, schemaRef:'helix://contracts/requirements/poster/v1', artifactKind:kind,
    requirementPayload:{ minimumWidth:1000 }, requirementDigest:'' };
  value.requirementDigest = canonicalDigest({ schema:'shared.artifact-requirement@1', revision:value.revision,
    schemaRef:value.schemaRef, artifactKind:value.artifactKind, requirementPayload:value.requirementPayload });
  value.requirementId = canonicalDigest({ schema:'shared.artifact-requirement-id@1', requirementDigest:value.requirementDigest });
  return value;
}

function artifactHandle(id = 'artifact-1') {
  return { schemaRef:'helix://contracts/types/ArtifactHandle/v1', schemaVersion:1, artifactHandleId:id,
    artifactKind:'poster', ownerDomain:'libra', ownerScope:{scopeType:'libra_run',scopeId:'run-1'}, storageRef:'artifact://poster',
    digestAlgorithm:'sha256', digestHex:d(id), sizeBytes:123, mediaType:'image/jpeg',
    provenanceRef:{objectType:'libra_run',objectId:'run-1',revision:1,digest:d('provenance')}, referenceRevision:1 };
}

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
    resultSchemaRef:result.schemaRef, result, resultId, resultDigest:canonicalDigest(result),
    evidenceDigest:result.payloadDigest, inputBindingDigest:canonicalDigest(intent),
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
  earlier.evidenceDigest = later.evidenceDigest;
  const selected = selectMetadataObservations({ intents:sourceIntents, results:[later, provider, earlier] });
  assert.deepEqual(selected.items.map((item) => item.resultId), ['a-result', 'result-1']);
  const divergentResult={ ...earlier.result, payloadDigest:d('changed') };
  assert.throws(() => selectMetadataObservations({ intents:sourceIntents,
    results:[later, { ...earlier, result:divergentResult, resultDigest:canonicalDigest(divergentResult),
      evidenceDigest:divergentResult.payloadDigest }] }), (error) => error.code === 'P9_METADATA_OBSERVATION_CONFLICT');
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
  const chains=[nfo,tmdb].map((item,index)=>({...item,inputBindings:sourceIntents[index],attemptWorkId:item.workId,
    planAttemptId:item.attemptId,eventWorkId:item.workId,eventAttemptId:item.attemptId,eventPlanId:item.planId,
    eventResultId:item.resultId,attemptState:'succeeded',planState:'completed',eventState:'succeeded',eventOwnerDomain:'libra',
    nodeCapabilityRef:item.capabilityRef}));
  const sourceRefs=buildProductFactSourceRefs({sourceBasis:basis,foundationChains:chains});
  assert.equal(sourceRefs.length,2);
  assert.equal(sourceRefs[0].referenceDigest,basis.selection.items[0].sourceReferenceDigest);
  assert.throws(()=>buildProductFactSourceRefs({sourceBasis:basis,foundationChains:[{...chains[0],eventPlanId:'other'},chains[1]]}),
    (error)=>error.code==='P9_PRODUCT_FACT_SOURCE_CHAIN');
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
  const requirement=artifactRequirement(), handle=artifactHandle(), snapshot={...handle,state:'active'};
  const result=buildArtifactManifestVerification({requirement,artifactHandles:[handle],verifiedAtMs:20});
  const inputBindings={artifactHandleList:[handle],artifactRequirement:requirement};
  const binding={workId:'work-verify',attemptId:'attempt-verify',planId:'plan-verify',eventId:'event-verify',resultId:'result-verify',
    capabilityRef:'shared.artifact.manifest.verify@1',resultSchemaRef:result.schemaRef,result,
    resultDigest:canonicalDigest(result),inputBindings,inputBindingDigest:canonicalDigest(inputBindings)};
  const ref={workId:binding.workId,attemptId:binding.attemptId,planId:binding.planId,eventId:binding.eventId,resultId:binding.resultId,
    capabilityRef:binding.capabilityRef,resultSchemaRef:binding.resultSchemaRef,resultDigest:binding.resultDigest,
    inputBindingDigest:binding.inputBindingDigest};
  const item={ordinal:0,artifactHandleId:snapshot.artifactHandleId,artifactKind:snapshot.artifactKind,
    artifactRevision:snapshot.referenceRevision,artifactDigest:snapshot.digestHex,requirementId:requirement.requirementId,
    requirementRevision:requirement.revision,requirementSchemaRef:requirement.schemaRef,requirementDigest:requirement.requirementDigest,
    verificationEvidenceId:result.verificationId,verificationEvidenceDigest:result.verificationDigest,verificationResultRef:ref};
  item.referenceDigest=canonicalDigest(item);
  const artifactSetDigest=canonicalDigest({schema:'libra.verified-artifact-set@1',items:[item]});
  const manifestId=canonicalDigest({schema:'libra.verified-artifact-manifest-id@1',libraRunId:'run-1',artifactSetDigest});
  const manifest={manifestId,libraRunId:'run-1',items:[item],artifactSetDigest};
  manifest.manifestDigest=canonicalDigest(manifest);
  const context={artifactSnapshots:[snapshot],artifactRequirements:[requirement],verificationBindings:[binding]};
  assert.deepEqual(validateVerifiedArtifactManifest(manifest,context),manifest);
  assert.throws(()=>validateVerifiedArtifactManifest(manifest,{...context,
    artifactSnapshots:[{...snapshot,digestHex:d('tampered')}]}),
    (error)=>error.code==='P9_ARTIFACT_HANDLE_MISMATCH');
  assert.throws(()=>validateVerifiedArtifactManifest(manifest,{...context,verificationBindings:[{...binding,
    inputBindingDigest:d('tampered')}]}),(error)=>error.code==='P9_ARTIFACT_VERIFICATION_CHAIN');
});

test('builds complete immutable Product Facts and their exact evidence digest', () => {
  const sourceIntents=intents(), basis=buildMetadataObservationBasis({intents:sourceIntents,
    results:[observation(sourceIntents[0],{entries:[{key:'title',value:'A'}]})],factKind:'media_cast',expectedRevision:0});
  const mediaDraft=buildMediaCastDraft({subjectId:'subject-1',sourceBasis:basis,relations:[],producedAtMs:10});
  const mediaFact=buildMediaCastFact({libraRunId:'run-1',subjectId:'subject-1',sourceBasis:basis,mediaCastDraft:mediaDraft,
    expectedRevision:0,commitMarker:'media-marker',committedAtMs:20});
  assert.equal(mediaFact.revision,1);
  assert.equal(mediaFact.relationCount,0);
  assert.equal(mediaFact.factDigest,canonicalDigest({schema:'libra.media-cast-fact@1',subjectId:'subject-1',
    sourceBasisKind:'metadata_observation',sourceBasisDigest:basis.sourceBasisDigest,relations:[],
    relationsDigest:mediaFact.relationsDigest,relationCount:0}));

  const metadataBasis=buildMetadataObservationBasis({intents:sourceIntents,
    results:[observation(sourceIntents[0],{entries:[{key:'title',value:'A'}]})],factKind:'product_metadata',expectedRevision:0});
  const metadataDraft=buildProductMetadataDraft({sourceBasis:metadataBasis,requiredFields:['title'],producedAtMs:10,
    providerIdentities:[],artifactRequirements:[]}).draft;
  const artifactSetDigest=canonicalDigest({schema:'libra.verified-artifact-set@1',items:[]});
  const manifest={manifestId:canonicalDigest({schema:'libra.verified-artifact-manifest-id@1',libraRunId:'run-1',artifactSetDigest}),
    libraRunId:'run-1',items:[],artifactSetDigest};
  manifest.manifestDigest=canonicalDigest(manifest);
  const metadataFact=buildProductMetadataFact({libraRunId:'run-1',subjectId:'subject-1',sourceBasis:metadataBasis,
    productMetadataDraft:metadataDraft,verifiedArtifactManifest:manifest,mediaCastFactRef:{productFactId:mediaFact.factId,
      factRevision:mediaFact.revision,factDigest:mediaFact.factDigest},expectedRevision:0,commitMarker:'metadata-marker',committedAtMs:30});
  assert.equal(metadataFact.factDigest,metadataFact.productMetadataDigest);
  assert.deepEqual(metadataFact.descriptiveFacts,metadataDraft.descriptiveFacts);
  assert.equal(buildProductFactEvidence({libraRunId:'run-1',factKind:'product_metadata',factRevision:1,
    sourceBasisKind:'metadata_observation',sourceBasisDigest:metadataBasis.sourceBasisDigest,
    commitPayloadDigest:d('commit-payload'),eventFenceDigest:d('event-fence')}),canonicalDigest({schema:'libra.product-fact-evidence@1',
    libraRunId:'run-1',factKind:'product_metadata',factRevision:1,sourceBasisKind:'metadata_observation',
    sourceBasisDigest:metadataBasis.sourceBasisDigest,commitPayloadDigest:d('commit-payload'),eventFenceDigest:d('event-fence')}));
  assert.throws(()=>buildProductMetadataFact({libraRunId:'other-run',subjectId:'subject-1',sourceBasis:metadataBasis,
    productMetadataDraft:metadataDraft,verifiedArtifactManifest:manifest,expectedRevision:0,commitMarker:'x',committedAtMs:1}),
  (error)=>error.code==='P9_PRODUCT_METADATA_FACT_INPUT');
});
