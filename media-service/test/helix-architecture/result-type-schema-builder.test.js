'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildResultTypeSchemas } = require('../../scripts/helix-architecture/result-type-schema-builder');

const schemas = buildResultTypeSchemas();

test('builds 87 nominal Catalog Result schemas and the eleven supporting schemas', () => {
  assert.equal(Object.keys(schemas).length, 99);
  assert.equal(schemas.CandidatePackage.properties.relatedReferences.items.$ref,
    'helix://contracts/types/RelatedMaterialReference/v1');
  for (const helper of ['OnDeckCommitReceipt', 'OffloadCompletionFact', 'PeopleCandidateDraft', 'PrimaryInputManifest',
    'SeasonContinuityClaim', 'CandidateIntakeAcceptanceBasis', 'ProcurementCandidateOfferAvailableMessage',
    'LibraCandidateAcceptedMessage', 'LibraCandidateRejectedMessage', 'ProcurementCandidateAcceptanceClosureResult',
    'ProcurementCandidateRejectionClosureResult']) assert.ok(schemas[helper]);
});

test('freezes the normalized media probe raster and bounded stream contract', () => {
  const schema = schemas.MediaProbeEvidence;
  for (const field of ['sourceHandleDigest', 'resultKind', 'sizeBytes', 'videoStreams', 'audioStreams', 'subtitleStreams']) {
    assert.ok(schema.required.includes(field));
  }
  const video = schema.properties.videoStreams.items;
  for (const field of ['codedWidth', 'codedHeight', 'sampleAspectRatio', 'rotation', 'displayWidth', 'displayHeight', 'longEdge', 'shortEdge']) {
    assert.ok(video.required.includes(field));
  }
  assert.equal(schema.properties.videoStreams.maxItems, 64);
});

test('freezes FA-04 continuity kinds and non-empty Primary Input membership', () => {
  assert.equal(schemas.CandidatePackage.properties.seasonContinuityClaims.items.$ref,
    'helix://contracts/types/SeasonContinuityClaim/v1');
  assert.deepEqual(schemas.SeasonContinuityClaim.properties.claimKind.enum,
    ['provider_season_identity', 'triage_grouping_lineage']);
  assert.equal(Object.hasOwn(schemas.SeasonContinuityClaim.properties, 'subjectId'), false);
  for (const field of ['packageRevision', 'runBasisDigest', 'triageRule', 'materialFieldContextRef', 'mediaType',
    'contentProfile', 'identityMetadata', 'structureEvidenceRef', 'seasonContinuityClaimSetDigest', 'relatedReferences',
    'memberControlEvidenceSetDigest']) {
    assert.ok(schemas.CandidatePackage.required.includes(field), field);
  }
  assert.equal(schemas.PrimaryInputManifest.properties.members.minItems, 1);
  assert.equal(schemas.PrimaryInputManifest.properties.members.items.additionalProperties, false);
  assert.equal(schemas.PrimaryInputManifest.properties.members.items.properties.ordinal.minimum, 0);
});

test('keeps On-deck atomic success and business not-available distinct from Runtime Outcome variants', () => {
  assert.equal(schemas.OnDeckCommitResult.properties.onDeckCommitReceipt.$ref, 'helix://contracts/types/OnDeckCommitReceipt/v1');
  assert.equal(schemas.OnDeckCommitResult.properties.offloadCompletionFact.$ref, 'helix://contracts/types/OffloadCompletionFact/v1');
  assert.deepEqual(schemas.ArtifactAcquisitionResult.properties.resultKind.enum, ['acquired', 'not_available']);
  for (const schema of Object.values(schemas)) assert.equal(Object.hasOwn(schema.properties || {}, 'kind'), false);
});

test('freezes Candidate Publication acceptance basis and offer message helpers', () => {
  const basis = schemas.CandidateIntakeAcceptanceBasis;
  assert.equal(basis.properties.handoffContractRef.const, 'helix://handoffs/procurement-to-libra/v1');
  assert.equal(basis.properties.acceptanceOwnerDomain.const, 'libra');
  assert.equal(basis.properties.targetContext.const, 'libra_intake');
  assert.ok(basis.required.includes('acceptanceBasisDigest'));
  const message = schemas.ProcurementCandidateOfferAvailableMessage;
  assert.equal(message.properties.messageKind.const, 'procurement_candidate_offer_available');
  assert.equal(message.properties.acceptanceOwnerDomain.const, 'libra');
  assert.ok(message.required.includes('offerId'));
});

test('freezes Handoff A rejection message and Procurement closure helpers', () => {
  assert.equal(schemas.LibraCandidateAcceptedMessage.properties.messageKind.const, 'libra_candidate_accepted');
  assert.ok(schemas.LibraCandidateAcceptedMessage.required.includes('subjectIntakeRevision'));
  assert.equal(schemas.LibraCandidateRejectedMessage.properties.messageKind.const, 'libra_candidate_rejected');
  assert.ok(schemas.LibraCandidateRejectedMessage.required.includes('receiptDigest'));
  assert.equal(schemas.ProcurementCandidateRejectionClosureResult.properties.terminalDeliveryState.const, 'rejected');
  assert.equal(schemas.ProcurementCandidateAcceptanceClosureResult.properties.terminalDeliveryState.const, 'accepted');
  assert.ok(schemas.ProcurementCandidateRejectionClosureResult.required.includes('closureDigest'));
});

test('freezes the Field Observation page and commit result canonical byte ceilings', () => {
  assert.equal(schemas.FieldObservationPage['x-helix-maxCanonicalBytes'], 64 * 1024);
  assert.equal(schemas.ObservationCommitResult['x-helix-maxCanonicalBytes'], 64 * 1024);
});

test('flattens WorkspaceMediaHandle without accepting a raw nested workspace payload', () => {
  const schema = schemas.WorkspaceMediaHandle;
  assert.ok(schema.required.includes('workspaceId'));
  assert.ok(schema.required.includes('relativePath'));
  assert.equal(Object.hasOwn(schema.properties, 'workspaceMaterial'), false);
  assert.equal(schema.additionalProperties, false);
});

test('freezes the bounded Perception page, commit draft, typed result, and explicit relation contracts', () => {
  assert.equal(schemas.NormalizedPerceptionRecordDraftList, undefined);
  const page = schemas.PerceptionObservationPage;
  assert.ok(page.required.includes('perceptionAcquisitionId'));
  assert.deepEqual(page.properties.cursor.required, ['expectedCursorRevision', 'cursorIn', 'cursorOut']);
  assert.equal(page.properties.observations.items.properties.inlinePayload.additionalProperties, false);
  const draft = schemas.PerceptionAcquisitionCommitDraft;
  assert.deepEqual(draft.properties.records.items.properties.recordKind.enum, ['observation', 'correction', 'retraction']);
  assert.equal(draft.properties.records.items.properties.rating.anyOf[0].minimum, 1);
  assert.equal(draft.properties.records.items.properties.rating.anyOf[0].maximum, 5);
  assert.equal(draft.properties.records.items.required.includes('rating'), false);
  assert.equal(draft.properties.records.items.required.includes('watchedState'), false);
  assert.deepEqual(draft.properties.sourceLineageRelations.items.properties.relationKind.enum, ['supersedes', 'retracts']);
  const result = schemas.PerceptionRecordCommitResult;
  assert.ok(result.required.includes('acquisitionCommitReceiptId'));
  assert.equal(Object.hasOwn(result.properties, 'resultDigest'), false);
  assert.ok(schemas.PerceptionResolutionDraft.required.includes('duplicateRelationDrafts'));
  assert.ok(schemas.PerceptionResolutionRevision.required.includes('committedRelationIds'));
  for (const name of ['PerceptionResolutionDraft', 'PerceptionResolutionRevision']) {
    const schema = schemas[name];
    for (const field of ['querySchemaRef', 'factKind', 'recordSetDigest', 'ruleDigest']) assert.ok(schema.required.includes(field));
    assert.deepEqual(schema.properties.factKind.enum, ['rating', 'watched']);
    assert.equal(schema.properties.resolvedProvenance.properties.matchedAnchorEvidence.maxItems, 16);
    assert.ok(schema.allOf[0].then.required.includes('resolvedValue'));
    assert.ok(schema.allOf[0].else.required.includes('reasonCode'));
  }
});
