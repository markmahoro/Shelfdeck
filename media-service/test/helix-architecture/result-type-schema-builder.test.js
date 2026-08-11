'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildResultTypeSchemas } = require('../../scripts/helix-architecture/result-type-schema-builder');

const schemas = buildResultTypeSchemas();

test('builds the complete Catalog Result graph and bounded Candidate publication receipt', () => {
  assert.equal(Object.keys(schemas).length, 102);
  assert.equal(schemas.CandidatePackage.properties.relatedReferences.items.$ref,
    'helix://contracts/types/RelatedMaterialReference/v1');
  assert.ok(schemas.CandidatePublicationReceipt.required.includes('candidateDraftDigest'));
  assert.equal(schemas.CandidatePublicationReceipt.properties.packageRevision.minimum, 1);
  for (const helper of ['CandidatePackage', 'OnDeckCommitReceipt', 'OffloadCompletionFact', 'PeopleCandidateDraft', 'PrimaryInputManifest',
    'SeasonContinuityClaim', 'CandidateIntakeAcceptanceBasis', 'ProcurementCandidateOfferAvailableMessage',
    'LibraCandidateAcceptedMessage', 'LibraCandidateRejectedMessage', 'ProcurementCandidateAcceptanceClosureResult',
    'ProcurementCandidateRejectionClosureResult', 'OnDeckProductPackageCommitReceipt']) assert.ok(schemas[helper]);
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
  assert.equal(schemas.PrimaryInputManifest.properties.members.maxItems, 1024);
  assert.equal(schemas.PrimaryInputManifest.properties.members.items.additionalProperties, false);
  assert.equal(schemas.PrimaryInputManifest.properties.members.items.properties.ordinal.minimum, 0);
  const triageUnitBranches = schemas.TriageStructureEvidence.properties.units.items.oneOf;
  assert.equal(triageUnitBranches[0].properties.members.maxItems, 1024);
  assert.equal(triageUnitBranches[1].properties.memberScope.properties.memberCount.minimum, 1);
  assert.equal(schemas.TriageStructureEvidence.properties.unassignedMaterials.maxItems, 1024);
  for (const embedded of ['RelatedMaterialReference', 'SeasonContinuityClaim']) {
    assert.equal(Object.hasOwn(schemas[embedded].properties, 'schemaRef'), false);
    assert.equal(Object.hasOwn(schemas[embedded].properties, 'schemaVersion'), false);
  }
});

test('keeps On-deck atomic success and business not-available distinct from Runtime Outcome variants', () => {
  assert.equal(schemas.OnDeckCommitResult.properties.onDeckCommitReceipt.$ref, 'helix://contracts/types/OnDeckCommitReceipt/v1');
  assert.equal(schemas.OnDeckCommitResult.properties.offloadCompletionFact.$ref, 'helix://contracts/types/OffloadCompletionFact/v1');
  assert.deepEqual(schemas.ArtifactAcquisitionResult.properties.resultKind.enum, ['acquired', 'not_available']);
  for (const schema of Object.values(schemas)) assert.equal(Object.hasOwn(schema.properties || {}, 'kind'), false);
});

test('materializes compact Western frame and analysis results without Worker receipts', () => {
  const frames = schemas.FrameArtifactSet;
  assert.equal(frames.properties.manifestKind.const, 'western_frame_artifact_set');
  assert.equal(frames.properties.ownerDomain.const, 'libra');
  assert.equal(frames.properties.memberCount.const, 1);
  assert.equal(frames.properties.frameCount.minimum, 1);
  assert.equal(frames.properties.frameCount.maximum, 1024);
  assert.equal(frames.properties.frameSetArtifactHandle.$ref,
    'helix://contracts/types/ArtifactHandle/v1');
  assert.equal(frames.properties.frameArtifactHandles, undefined);

  const analysis = schemas.WesternAnalysisResult;
  for (const field of ['libraRunId', 'runExecutionBasisDigest', 'frameArtifactSetDigest',
    'embeddingSetDigest', 'clusterSetDigest', 'analysisSpecDigest', 'analysisVariantRef',
    'resultArtifactHandle', 'resultDigest']) {
    assert.ok(analysis.required.includes(field), field);
  }
  assert.equal(analysis.properties.externalJobReceiptId, undefined);
  assert.equal(analysis.properties.resultArtifactHandle.$ref,
    'helix://contracts/types/ArtifactHandle/v1');

  const match = schemas.PersonMatchEvidence;
  assert.ok(match.required.includes('referenceProjectionSetDigest'));
  assert.equal(match.properties.matches.maxItems, 1024);
  for (const field of ['personRevision', 'projectionRevision', 'projectionDigest']) {
    assert.ok(match.properties.matches.items.required.includes(field), field);
  }
});

test('materializes the complete nominal On-deck Product Package rather than generic snapshots', () => {
  const schema = schemas.OnDeckProductPackage;
  assert.equal(schema['x-helix-maxCanonicalBytes'], 16 * 1024 * 1024);
  assert.equal(schema.properties.productStructureSnapshot.$ref,
    'helix://contracts/domain-types/ProductStructureSnapshot/v1');
  assert.equal(schema.properties.productMaterialManifest.$ref,
    'helix://contracts/domain-types/ProductionMaterialManifest/v1');
  assert.equal(schema.properties.artifactManifest.$ref,
    'helix://contracts/domain-types/ArtifactManifest/v1');

  const resolved = schema.properties.resolvedIdentitySnapshot;
  assert.equal(resolved.properties.factValue.$ref,
    'helix://contracts/types/ResolvedProductIdentity/v1');
  assert.equal(Object.hasOwn(resolved.properties, 'objectId'), false);
  assert.equal(Object.hasOwn(resolved.properties, 'snapshotDigest'), false);

  const factItems = schema.properties.productFactManifest.properties.items.items.oneOf;
  assert.deepEqual(factItems.map((item) => item.properties.factKind.const),
    ['resolved_identity', 'product_metadata', 'media_cast']);
  assert.deepEqual(factItems.map((item) => item.properties.factValue.$ref), [
    'helix://contracts/types/ResolvedProductIdentity/v1',
    'helix://contracts/types/ProductMetadataFact/v1',
    'helix://contracts/types/MediaCastFact/v1',
  ]);
  const personIdentity =
    schemas.MediaCastFact.properties.relations.items.properties.providerIdentities.items;
  assert.deepEqual(personIdentity.required, ['provider', 'namespace', 'providerKey']);
  assert.equal(personIdentity.additionalProperties, false);

  const planRef = schema.properties.productionProvenance.properties.workflowPlanRefs.items;
  assert.deepEqual(planRef.required, ['planId', 'planRevision', 'planDigest']);
  const attestation = schema.properties.productionAttestation;
  for (const field of ['attestationId', 'libraRunId', 'onDeckPackageId',
    'productConformanceEvidenceId', 'productConformanceEvidenceDigest',
    'productSnapshotDigest', 'attestationDigest']) {
    assert.ok(attestation.required.includes(field), field);
  }
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

test('freezes the compact Observation page and commit receipt canonical byte ceilings', () => {
  assert.equal(schemas.ObservationPageCommitResult['x-helix-maxCanonicalBytes'], 16 * 1024);
  assert.equal(schemas.ObservationPageCommitReceipt['x-helix-maxCanonicalBytes'], 16 * 1024);
});

test('freezes WorkspaceMediaHandle around one nested Foundation handle', () => {
  const schema = schemas.WorkspaceMediaHandle;
  assert.ok(schema.required.includes('workspaceMediaHandleId'));
  assert.ok(schema.required.includes('workspaceMaterialHandle'));
  assert.equal(schema.properties.workspaceMaterialHandle.$ref, 'helix://contracts/types/WorkspaceMaterialHandle/v1');
  assert.equal(Object.hasOwn(schema.properties, 'mediaProbeRef'), false);
  assert.equal(schema.additionalProperties, false);
});

test('materializes Artifact Requirement and bounded verification Result continuity', () => {
  const verification = schemas.ArtifactManifestVerification;
  for (const field of ['requirement', 'verifiedArtifacts', 'artifactDigests', 'verificationDigest']) {
    assert.ok(verification.required.includes(field), field);
  }
  assert.equal(verification.properties.requirement.$ref, 'helix://contracts/domain-types/ArtifactRequirement/v1');
  assert.equal(verification.properties.verifiedArtifacts.minItems, 1);
  assert.equal(verification.properties.verifiedArtifacts.maxItems, 64);
  assert.equal(verification.properties.artifactDigests.maxItems, 64);
  assert.equal(verification['x-helix-maxCanonicalBytes'], 64 * 1024);
  assert.equal(schemas.ProductMetadataDraft.properties.artifactRequirements.items.$ref,
    'helix://contracts/domain-types/ArtifactRequirement/v1');
});

test('materializes Metadata Observation with exact Provider identity tuples and no synthetic Artifact hints', () => {
  const schema = schemas.MetadataObservation;
  const identitySet = schema.properties.providerIdentitySet;
  assert.equal(identitySet.additionalProperties, false);
  assert.equal(
    identitySet.properties.schemaRef.const,
    'helix://contracts/records/provider-identity-set/v1',
  );
  assert.equal(identitySet.properties.schemaVersion.const, 1);
  assert.equal(identitySet.properties.entries.maxItems, 16);
  assert.equal(identitySet.properties.entries.uniqueItems, true);
  assert.equal(
    identitySet.properties.entries.items.$ref,
    'helix://contracts/domain-types/ResolvedProviderIdentity/v1',
  );
  assert.equal(
    identitySet.properties.recordDigest['x-helix-digestBasis'],
    'JCS(record excluding recordDigest)',
  );
  assert.equal(schema.properties.artifactHints.maxItems, 0);
});

test('binds Product Media Verification to the exact candidate, Run, Handle, Requirement, and probes', () => {
  const schema = schemas.ProductMediaVerification;
  for (const field of ['candidateId', 'candidateNodeId', 'candidateBasisDigest', 'candidateKind', 'libraRunId',
    'productMaterialHandleId', 'productMaterialHandleDigest', 'productMaterialFenceDigest', 'mediaRequirementId',
    'mediaRequirementDigest', 'sourceProbeEvidenceDigest', 'outputProbeEvidenceDigest']) {
    assert.ok(schema.required.includes(field), field);
  }
});

test('materializes the complete PBF-16 external acquisition Result chain', () => {
  const query = schemas.AcquisitionQuery;
  for (const field of ['libraRunId', 'runExecutionBasisDigest', 'resolvedIdentityDigest', 'productStructureDigest',
    'structureKind', 'contentProfile', 'providerIdentityAnchors', 'requestedEpisodeKeys', 'queryTerms',
    'hardConstraints', 'queryDigest']) assert.ok(query.required.includes(field), field);
  assert.equal(query.properties.providerIdentityAnchors.minItems, 1);
  assert.equal(query.properties.queryTerms.minItems, 1);
  assert.equal(query.properties.queryTerms.maxItems, 32);

  const candidates = schemas.AcquisitionCandidates.properties.candidates;
  assert.equal(candidates.maxItems, 100);
  for (const field of ['candidateId', 'integrationId', 'configRevision', 'providerCandidateRef', 'providerRank',
    'identityAnchors', 'structureKind', 'episodeKeys', 'availability', 'candidateDigest']) {
    assert.ok(candidates.items.required.includes(field), field);
  }
  assert.equal(candidates.items.properties.providerCandidateRef.properties.objectType.const, 'acquisition_candidate');
  assert.deepEqual(schemas.SelectedCandidate.oneOf.map((branch) => branch.properties.result.const), ['selected', 'not_selected']);
  assert.equal(schemas.SelectedCandidate.oneOf[0].properties.selectedCandidate.additionalProperties, false);
  assert.equal(schemas.AcquisitionObservation.properties.outputRefs, undefined);
  assert.equal(schemas.AcquisitionObservation.properties.outputSnapshot.additionalProperties, false);
  assert.ok(schemas.AcquisitionObservation.required.includes('externalJobReceipt'));
  assert.ok(schemas.StableExternalMaterialEvidence.required.includes('stableExternalMaterialHandle'));
  assert.deepEqual(schemas.IdentityVerification.properties.strengthClass.enum, ['exact_provider_identity', 'unverified']);
  for (const field of ['stableExternalMaterialHandleId', 'stableManifestDigest', 'identityVerificationId',
    'identityVerificationDigest', 'verifiedMemberIds', 'verifiedMemberSetDigest', 'packageManifestDigest']) {
    assert.ok(schemas.VerifiedExternalPackage.required.includes(field), field);
  }
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
