'use strict';

const crypto = require('crypto');
const { buildSharedTypeSchemas } = require('./shared-type-schema-builder');

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
const typeId = (name) => `helix://contracts/types/${name}/v1`;
const ref = (name) => ({ $ref: typeId(name) });
const text = (options = {}) => ({ type: 'string', minLength: 1, ...options });
const id = () => text({ maxLength: 256 });
const digest = () => text({ pattern: '^[a-f0-9]{64}$' });
const nonNegativeInteger = () => ({ type: 'integer', minimum: 0 });
const positiveInteger = () => ({ type: 'integer', minimum: 1 });
const bool = () => ({ type: 'boolean' });
const enumText = (...values) => ({ type: 'string', enum: values });
const arrayOf = (items, maxItems = 1024) => ({ type: 'array', items, maxItems });
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const object = (properties, required = Object.keys(properties), options = {}) => ({
  type: 'object', additionalProperties: false, properties, required, ...options
});

const envelopeFields = {
  EvidenceEnvelope: {
    evidenceId: id(), evidenceKind: text(), producerRef: text(), basisDigest: digest(), payloadDigest: digest(), observedAtMs: nonNegativeInteger()
  },
  VerificationEnvelope: {
    verificationId: id(), verificationKind: text(), basisDigest: digest(), result: enumText('passed', 'failed', 'not_applicable'),
    reasonCodes: arrayOf(text()), evidenceRefs: arrayOf(id()), verifiedAtMs: nonNegativeInteger()
  },
  DomainFactEnvelope: {
    factId: id(), ownerDomain: text(), aggregateType: text(), aggregateId: id(), revision: positiveInteger(), factSchemaRef: text(),
    factDigest: digest(), commitMarker: id(), committedAtMs: nonNegativeInteger()
  },
  ReceiptEnvelope: {
    receiptId: id(), receiptKind: text(), ownerDomain: text(), scopeType: text(), scopeId: id(), scopeDigest: digest(),
    effectReceiptRef: nullable(id()), committedAtMs: nonNegativeInteger()
  },
  ManifestEnvelope: {
    manifestId: id(), manifestKind: text(), ownerDomain: text(), memberCount: nonNegativeInteger(), membersDigest: digest(),
    manifestDigest: digest(), publishedAtMs: nonNegativeInteger()
  },
  DraftEnvelope: {
    draftId: id(), draftKind: text(), basisDigest: digest(), draftDigest: digest(), producedAtMs: nonNegativeInteger()
  }
};
const envelopeOptionalFields = { ReceiptEnvelope: new Set(['effectReceiptRef']) };

function boundedRecord(kind) {
  return object({
    schemaRef: text(), schemaVersion: positiveInteger(), recordKind: { const: kind }, recordDigest: digest(),
    entries: arrayOf(object({ key: text(), value: { type: ['string', 'number', 'integer', 'boolean', 'null'] } }), 256)
  });
}

function snapshot(kind) {
  return object({ objectId: id(), revision: positiveInteger(), schemaRef: text(), snapshotDigest: digest(), objectKind: { const: kind } });
}

const peopleAlias = object({ aliasDisplay: text(), aliasNormalized: text(), provenanceDigest: digest() });
const peopleProviderIdentity = object({ provider: text(), namespace: text(), providerKey: text(), provenanceDigest: digest() });
const peopleReferenceHint = object({ hintKind: text(), referenceValue: text(), provenanceDigest: digest() });
const peoplePersonRef = object({
  personId: id(), revision: positiveInteger(), factDigest: digest(), preferenceRevision: nullable(positiveInteger())
});
const peopleRegistrationPayload = object({
  proposedName: text(), aliases: arrayOf(peopleAlias, 256), providerIdentities: arrayOf(peopleProviderIdentity, 256),
  referenceHints: arrayOf(peopleReferenceHint, 256)
});
const peopleMergePayload = object({
  leftPersonRef: peoplePersonRef, rightPersonRef: peoplePersonRef,
  matchSignals: arrayOf(snapshot('person-match-signal'), 256), conflictSummary: boundedRecord('merge-conflict-summary'),
  evidenceRefs: arrayOf(id(), 256)
});
const perceptionResolvedValue = {
  oneOf: [
    object({ factKind: { const: 'rating' }, value: { type: 'integer', minimum: 1, maximum: 5 } }),
    object({ factKind: { const: 'watched' }, value: bool() })
  ]
};
const perceptionResolvedProvenance = object({
  winningPerceptionId: id(), sourceKind: text(), sourceRecordKey: text(), sourceRecordRevision: positiveInteger(),
  provenanceRef: id(), provenanceDigest: digest(), matchedAnchorEvidence: arrayOf(object({
    anchorKind: text(), strengthRank: positiveInteger(), evidenceDigest: digest()
  }), 16)
});

const stream = object({
  streamIndex: nonNegativeInteger(), codec: text(), codedWidth: positiveInteger(), codedHeight: positiveInteger(),
  sampleAspectRatio: text(), rotation: { type: 'integer', minimum: -359, maximum: 359 }, displayWidth: positiveInteger(),
  displayHeight: positiveInteger(), longEdge: positiveInteger(), shortEdge: positiveInteger()
});
const simpleStream = object({ streamIndex: nonNegativeInteger(), codec: text(), language: nullable(text()) }, ['streamIndex', 'codec']);
const decimalInt64 = text({ pattern: '^(0|[1-9][0-9]{0,18})$' });
const fieldMaterialObservation = object({
  materialObservationId: digest(), observationId: id(), fieldId: id(), accessRevision: positiveInteger(), accessDigest: digest(),
  fieldAccessHandleId: id(), endpointId: id(), mountScopeRevision: positiveInteger(), identity: ref('PhysicalMaterialIdentity'),
  location: text(), sizeBytes: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, mtimeNs: decimalInt64,
  ctimeNs: decimalInt64, hashVerifiedAtMs: nonNegativeInteger(), observedAtMs: nonNegativeInteger(), containmentDigest: digest(),
  realityDigest: digest(), provenanceDigest: digest(), snapshotDigest: digest()
});
const acceptedFieldMaterial = object({
  materialKey: digest(), bindingRevision: positiveInteger(), changeKind: enumText('inserted', 'refreshed', 'rebound'),
  realityDigest: digest(), snapshotDigest: digest()
});
const triageProfile = () => enumText('movie', 'series', 'jav', 'western_adult');
const triageMediaType = () => enumText('single', 'group');
const triageEpisodeClaim = () => object({ episodeKey: text(), seasonClaimDigest: digest(), claimDigest: digest() });
const seasonContinuityClaim = () => ref('SeasonContinuityClaim');
const triageIdentityMetadata = () => object({ claimedTitle: text(), claimedYear: positiveInteger(),
  seasonClaim: object({ claimKind: enumText('explicit_number', 'provisional_group'), seasonNumber: positiveInteger(),
    provisionalGroupKey: digest(), claimDigest: digest() }, ['claimKind', 'claimDigest']), javCode: text(),
  contentProfileHint: enumText('movie', 'series', 'jav', 'western_adult', 'mixed'), sourceHints: arrayOf(object({
    hintKind: enumText('field_content_profile_hint', 'filename_title', 'directory_title', 'filename_year', 'directory_year',
      'filename_season', 'directory_season', 'filename_episode', 'jav_code', 'disc_structure', 'temporary_label'),
    hintValue: text(), evidenceDigest: digest() }), 256), metadataDigest: digest()
}, ['claimedTitle', 'contentProfileHint', 'sourceHints', 'metadataDigest']);
const triageRelatedReference = () => ref('RelatedMaterialReference');
const triageUnit = () => object({ unitId: digest(), mediaType: triageMediaType(), contentProfile: triageProfile(),
  structureKind: enumText('single', 'season'), displayIdentity: text(), identityMetadata: triageIdentityMetadata(),
  seasonContinuityClaims: arrayOf(seasonContinuityClaim(), 64), seasonContinuityClaimSetDigest: digest(),
  members: { ...arrayOf(object({ materialKey: digest(),
    bindingRevision: positiveInteger(), admittedControlRevision: positiveInteger(), admittedControlProjectionDigest: digest(),
    role: enumText('primary_payload', 'structural_dependency'), episodeClaims: arrayOf(triageEpisodeClaim(), 32), memberClaimDigest: digest()
  }), 1024), minItems: 1 }, relatedReferences: arrayOf(triageRelatedReference(), 1024), unitDigest: digest() });

const special = {
  'FilesystemIdentityEvidence.identity': ref('PhysicalMaterialIdentity'),
  'ContentHashEvidence.identity': ref('PhysicalMaterialIdentity'),
  'MediaProbeEvidence.resultKind': enumText('probed', 'not_media'),
  'MediaProbeEvidence.reasonCode': enumText('probe_not_media'),
  'MediaProbeEvidence.discTopology': object({ discKind: enumText('bdmv', 'dvd', 'iso'), titleCount: positiveInteger(),
    singleTitleEvidenceDigest: digest() }),
  'LayoutEvidence.entries': arrayOf(object({ entryOrdinal: nonNegativeInteger(), entryKind: enumText('file', 'directory'),
    relativeLocation: text(), baseName: text(), extension: text(), identity: ref('PhysicalMaterialIdentity'), endpointId: id(),
    location: text(), sizeBytes: nonNegativeInteger(), mtimeNs: text(), checksumAlgorithm: { const: 'sha256' }, checksumHex: digest(),
    entryDigest: digest() }, ['entryOrdinal', 'entryKind', 'relativeLocation', 'baseName', 'endpointId', 'location', 'entryDigest']), 256),
  'MediaProbeEvidence.videoStreams': arrayOf(stream, 64),
  'MediaProbeEvidence.audioStreams': arrayOf(simpleStream, 128),
  'MediaProbeEvidence.subtitleStreams': arrayOf(simpleStream, 256),
  'PersonMatchEvidence.matches': arrayOf(object({ clusterId: id(), personId: id(), confidenceClass: text(), evidenceDigest: digest() })),
  'FieldObservationPage.materialObservations': arrayOf(fieldMaterialObservation, 100),
  'FieldObservationPage.cursorIn': nullable(text()),
  'FieldObservationPage.cursorOut': nullable(text()),
  'ObservationCommitResult.acceptedMaterials': arrayOf(acceptedFieldMaterial, 100),
  'ObservationCommitResult.nextCursor': nullable(text()),
  'PlayabilityEvidence.materialResults': { ...arrayOf(object({ selectionOrdinal: nonNegativeInteger(), materialKey: digest(),
    bindingRevision: positiveInteger(), probeEvidenceDigest: digest(), playable: bool(),
    reasonCodes: arrayOf(enumText('probe_not_media', 'no_video_stream', 'non_positive_duration'), 3), resultDigest: digest() }), 100), minItems: 1 },
  'TriageStructureEvidence.resultKind': enumText('resolved', 'not_ready'),
  'TriageStructureEvidence.units': arrayOf(triageUnit(), 100),
  'TriageStructureEvidence.unassignedMaterials': arrayOf(object({ materialKey: digest(), reasonCode: enumText('probe_not_media',
    'no_video_stream', 'non_positive_duration', 'content_profile_unresolved', 'conflicting_season_claim',
    'episode_claim_unresolved', 'disc_structure_incomplete', 'disc_multi_title_unsupported', 'triage_unit_contract_too_large',
    'structure_ambiguous'), evidenceDigest: digest() }), 1024),
  'TriageStructureEvidence.cursorIn': nullable(text()),
  'TriageStructureEvidence.cursorOut': nullable(text()),
  'IdentityClaim.claimKind': enumText('movie_title', 'series_season', 'jav_code', 'western_temporary'),
  'IdentityClaim.mediaType': triageMediaType(),
  'IdentityClaim.contentProfile': triageProfile(),
  'IdentityClaim.identityMetadata': triageIdentityMetadata(),
  'IdentityClaim.sourceHints': triageIdentityMetadata().properties.sourceHints,
  'IdentityClaim.seasonClaim': triageIdentityMetadata().properties.seasonClaim,
  'PrimaryInputManifestDraft.structureKind': enumText('single', 'season'),
  'PrimaryInputManifestDraft.memberCount': positiveInteger(),
  'PrimaryInputManifest.structureKind': enumText('single', 'season'),
  'PrimaryInputManifest.memberCount': positiveInteger(),
  'PrimaryInputManifest.members': { ...arrayOf(object({
    ordinal: nonNegativeInteger(), materialKey: digest(), role: enumText('primary_payload', 'structural_dependency'),
    bindingRevision: positiveInteger(), admittedControlRevision: positiveInteger(), admittedControlProjectionDigest: digest(),
    episodeClaims: arrayOf(triageEpisodeClaim(), 32), memberDigest: digest()
  })), minItems: 1 },
  'CandidatePackage.identityClaim': ref('IdentityClaim'),
  'CandidatePackage.packageRevision': positiveInteger(),
  'CandidatePackage.runBasisDigest': digest(),
  'CandidatePackage.triageRule': object({ ruleRef: id(), revision: positiveInteger(), authorityDigest: digest() }),
  'CandidatePackage.materialFieldContextRef': object({ fieldId: id(), accessRevision: positiveInteger(), contextDigest: digest() }),
  'CandidatePackage.mediaType': triageMediaType(),
  'CandidatePackage.contentProfile': triageProfile(),
  'CandidatePackage.identityMetadata': triageIdentityMetadata(),
  'CandidatePackage.structureEvidenceRef': object({ evidenceId: id(), payloadDigest: digest(), unitId: digest(), unitDigest: digest() }),
  'CandidatePackage.seasonContinuityClaims': arrayOf(seasonContinuityClaim(), 64),
  'CandidatePackage.seasonContinuityClaimSetDigest': digest(),
  'CandidatePackage.primaryInputManifestRef': object({ manifestId: id(), manifestDigest: digest(), memberCount: positiveInteger() }),
  'CandidatePackage.relatedReferences': arrayOf(triageRelatedReference(), 1024),
  'RelatedMaterialReference.identity': ref('PhysicalMaterialIdentity'),
  'RelatedMaterialReference.primaryMaterialKey': digest(),
  'RelatedMaterialReference.role': enumText('nfo', 'poster', 'fanart', 'subtitle', 'external_audio', 'chapter', 'sidecar'),
  'RelatedMaterialReference.checksumAlgorithm': { const: 'sha256' },
  'RelatedMaterialReference.checksumHex': digest(),
  'SeasonContinuityClaim.claimKind': enumText('provider_season_identity', 'triage_grouping_lineage'),
  'SeasonContinuityClaim.claimNamespace': text(),
  'SeasonContinuityClaim.claimKey': text(),
  'CandidateIntakeAcceptanceBasis.handoffContractRef': { const: 'helix://handoffs/procurement-to-libra/v1' },
  'CandidateIntakeAcceptanceBasis.acceptanceOwnerDomain': { const: 'libra' },
  'CandidateIntakeAcceptanceBasis.targetContext': { const: 'libra_intake' },
  'CandidateIntakeAcceptanceBasis.packageRevision': positiveInteger(),
  'ProcurementCandidateOfferAvailableMessage.messageKind': { const: 'procurement_candidate_offer_available' },
  'ProcurementCandidateOfferAvailableMessage.acceptanceOwnerDomain': { const: 'libra' },
  'ProcurementCandidateOfferAvailableMessage.targetContext': { const: 'libra_intake' },
  'ProcurementCandidateOfferAvailableMessage.packageRevision': positiveInteger(),
  'LibraCandidateRejectedMessage.messageKind': { const: 'libra_candidate_rejected' },
  'LibraCandidateRejectedMessage.packageRevision': positiveInteger(),
  'LibraCandidateRejectedMessage.reasonCodes': { ...arrayOf(enumText('candidate_contract_invalid', 'candidate_material_identity_changed',
    'candidate_material_unavailable', 'candidate_material_unreadable', 'candidate_control_scope_unavailable'), 32), minItems: 1 },
  'LibraCandidateRejectedMessage.primaryRejectionCode': enumText('candidate_contract_invalid', 'candidate_material_identity_changed',
    'candidate_material_unavailable', 'candidate_material_unreadable', 'candidate_control_scope_unavailable'),
  'LibraCandidateAcceptedMessage.messageKind': { const: 'libra_candidate_accepted' },
  'LibraCandidateAcceptedMessage.packageRevision': positiveInteger(),
  'ProcurementCandidateRejectionClosureResult.packageRevision': positiveInteger(),
  'ProcurementCandidateRejectionClosureResult.terminalDeliveryState': { const: 'rejected' },
  'ProcurementCandidateRejectionClosureResult.releasedMaterialCount': positiveInteger(),
  'ProcurementCandidateAcceptanceClosureResult.packageRevision': positiveInteger(),
  'ProcurementCandidateAcceptanceClosureResult.terminalDeliveryState': { const: 'accepted' },
  'ProcurementCandidateAcceptanceClosureResult.transferredMaterialCount': positiveInteger(),
  'CandidateContractVerification.packageRevision': positiveInteger(),
  'CandidateContractVerification.primaryInputManifestDigest': digest(),
  'CandidateContractVerification.candidateDeliverySnapshotDigest': digest(),
  'IntakeMaterialVerification.candidateDeliverySnapshotDigest': digest(),
  'IntakeMaterialVerification.verifiedMaterials': arrayOf(object({ materialKey: digest(), bindingRevision: positiveInteger(),
    locationEvidenceDigest: digest(), readHandleDigest: digest(), verificationDigest: digest() }), 1024),
  'LibraBindingDraft.subjectRef': object({ subjectId: id(), resolutionKind: enumText('new_subject', 'season_extension') }),
  'LibraBindingDraft.bindings': arrayOf(object({
    materialKey: digest(), role: enumText('primary_payload', 'structural_dependency'), endpointId: id(), location: text(),
    bindingRevision: { const: 1 }, locationEvidenceDigest: digest(),
    episodeClaims: arrayOf(object({ episodeKey: text(), seasonClaimDigest: digest(), claimDigest: digest() }), 32), bindingDigest: digest()
  }), 1024),
  'VersionedQueryResult.resultKind': enumText('found', 'not_found'),
  'ResolvedProductIdentity.structureKind': enumText('single', 'season'),
  'ResolvedProductIdentity.contentProfile': enumText('movie', 'series', 'jav', 'western_adult'),
  'ResolvedProductIdentity.providerIdentities': arrayOf(snapshot('provider-identity'), 128),
  'ResolvedProductIdentity.exactSeasonContinuityClaims': arrayOf(ref('SeasonContinuityClaim'), 64),
  'ResolvedProductIdentity.displayIdentity': boundedRecord('display-identity'),
  'MetadataObservation.contentProfile': enumText('movie', 'series', 'jav', 'western_adult'),
  'MetadataObservation.descriptiveFacts': boundedRecord('descriptive-facts'),
  'MetadataObservation.providerIdentitySet': boundedRecord('provider-identity-set'),
  'MetadataObservation.peopleHints': arrayOf(snapshot('people-hint'), 1024),
  'MetadataObservation.artifactHints': arrayOf(snapshot('artifact-hint'), 1024),
  'WesternAnalysisResult.resultArtifactHandle': ref('ArtifactHandle'),
  'ArtifactAcquisitionResult.resultKind': enumText('acquired', 'not_available'),
  'ArtifactAcquisitionResult.artifactHandle': nullable(ref('ArtifactHandle')),
  'ArtifactAcquisitionResult.reasonCode': nullable(text()),
  'ArtifactAcquisitionResult.evidence': ref('EvidenceEnvelope'),
  'ProductMetadataDraft.descriptiveFacts': boundedRecord('descriptive-facts'),
  'ProductMetadataDraft.providerIdentities': arrayOf(snapshot('provider-identity'), 128),
  'ProductMetadataDraft.mediaCastDraftRef': nullable(id()),
  'ProductMetadataDraft.artifactRequirements': arrayOf(snapshot('artifact-requirement'), 256),
  'MediaCastDraft.relations': arrayOf(object({
    personId: nullable(id()), displayName: text(), role: text(), source: text(), confidenceClass: text()
  }, ['displayName', 'role', 'source', 'confidenceClass']), 4096),
  'WorkspaceMediaHandle.mediaProbeRef': nullable(id()),
  'ProductMediaVerification.qualitySummary': boundedRecord('quality-summary'),
  'ProductMediaVerification.spaceSummary': boundedRecord('space-summary'),
  'OnDeckProductPackage.productMaterialManifest': snapshot('product-material-manifest'),
  'OnDeckProductPackage.acceptanceSpecRef': object({ id: id(), recordDigest: digest() }),
  'OnDeckProductPackage.resolvedIdentitySnapshot': snapshot('resolved-identity-product-fact'),
  'OnDeckProductPackage.productStructureSnapshot': snapshot('product-structure'),
  'OnDeckProductPackage.runMaterialManifestRef': object({ id: id(), digest: digest() }),
  'OnDeckProductPackage.productFactManifest': snapshot('product-fact-manifest'),
  'OnDeckProductPackage.artifactManifest': snapshot('artifact-manifest'),
  'OnDeckProductPackage.mediaCastSnapshot': snapshot('media-cast-product-fact'),
  'OnDeckProductPackage.offloadContextManifest': snapshot('offload-context-manifest'),
  'OnDeckProductPackage.productionProvenance': snapshot('production-provenance'),
  'OnDeckProductPackage.productionAttestation': snapshot('production-attestation'),
  'WorkspaceCleanupCommitReceipt.releasedControlRevision': nullable(positiveInteger()),
  'AcquisitionQuery.structureKind': enumText('single', 'season'),
  'AcquisitionQuery.queryTerms': boundedRecord('acquisition-query-terms'),
  'AcquisitionQuery.hardConstraints': boundedRecord('acquisition-hard-constraints'),
  'AcquisitionCandidates.candidates': arrayOf(snapshot('acquisition-candidate'), 1024),
  'AcquisitionObservation.phase': enumText('download', 'transfer'),
  'AcquisitionObservation.outputRefs': arrayOf(id(), 1024),
  'StableExternalMaterialEvidence.observationWindow': object({ startedAtMs: nonNegativeInteger(), endedAtMs: nonNegativeInteger() }),
  'AcceptanceCheck.checkKind': enumText('identity', 'structure', 'metadata', 'mandatory_media', 'space'),
  'StagedInventoryManifest.stagedMembers': arrayOf(snapshot('staged-inventory-member'), 4096),
  'SettlementDeletionEvidence.postDeleteReality': boundedRecord('post-delete-reality'),
  'DeletionEvidence.postDeleteReality': boundedRecord('post-delete-reality'),
  'CustodyAssessmentEvidence.assessmentState': text(),
  'PresentationAssessmentEvidence.assessmentState': text(),
  'ConformanceAssessmentEvidence.assessmentState': text(),
  'CustodyAssessmentEvidence.findingDrafts': arrayOf(snapshot('finding-draft'), 1024),
  'PresentationAssessmentEvidence.findingDrafts': arrayOf(snapshot('finding-draft'), 1024),
  'ConformanceAssessmentEvidence.findingDrafts': arrayOf(snapshot('finding-draft'), 1024),
  'DuplicateGroupEvidenceList.groups': arrayOf(object({ groupId: id(), canonicalIdentityDigest: digest(), shelfEntryIds: arrayOf(id()) })),
  'ReferenceReleaseResult.released': bool(),
  'PerceptionObservationPage.source': object({
    sourceId: id(), sourceKind: text(), sourceConfigRevision: positiveInteger()
  }),
  'PerceptionObservationPage.cursor': object({
    expectedCursorRevision: nonNegativeInteger(), cursorIn: nullable(text()), cursorOut: text()
  }),
  'PerceptionObservationPage.observations': arrayOf(object({
    observationId: id(), sourceRecordKey: text(), sourceRecordRevision: positiveInteger(), sourceRecordDigest: digest(),
    observedAtMs: nonNegativeInteger(), payloadSchemaRef: text(), payloadDigest: digest(),
    inlinePayload: boundedRecord('perception-observation-inline-payload'), provenanceDigest: digest()
  }), 4096),
  'PerceptionAcquisitionCommitDraft.source': object({
    sourceId: id(), sourceKind: text(), sourceConfigRevision: positiveInteger()
  }),
  'PerceptionAcquisitionCommitDraft.cursorTransition': object({
    pageOrdinal: nonNegativeInteger(), expectedCursorRevision: nonNegativeInteger(), cursorIn: nullable(text()), cursorOut: text(),
    observationPageDigest: digest(), hasMore: bool()
  }),
  'PerceptionAcquisitionCommitDraft.records': arrayOf(object({
    draftId: id(), recordKind: enumText('observation', 'correction', 'retraction'), sourceRecordKey: text(),
    sourceRecordRevision: positiveInteger(), sourceRecordDigest: digest(),
    rating: nullable({ type: 'integer', minimum: 1, maximum: 5 }), watchedState: nullable(bool()), observedTitle: text(),
    observedAtMs: nonNegativeInteger(), identityAnchors: arrayOf(object({
      anchorKind: text(), anchorValue: text(), confidenceClass: text(), evidenceDigest: digest()
    }), 16), provenanceRef: id(), provenanceDigest: digest()
  }, ['draftId', 'recordKind', 'sourceRecordKey', 'sourceRecordRevision', 'sourceRecordDigest',
    'observedTitle', 'observedAtMs', 'identityAnchors', 'provenanceRef', 'provenanceDigest']), 4096),
  'PerceptionAcquisitionCommitDraft.sourceLineageRelations': arrayOf(object({
    relationKind: enumText('supersedes', 'retracts'), sourceDraftId: id(),
    targetSourceRecord: object({ sourceRecordKey: text(), sourceRecordRevision: positiveInteger(), sourceRecordDigest: digest() }),
    ruleRevision: positiveInteger(), evidenceDigest: digest()
  }), 4096),
  'PerceptionResolutionDraft.duplicateRelationDrafts': arrayOf(object({
    sourcePerceptionId: id(), targetPerceptionId: id(), ruleRevision: positiveInteger(), evidenceDigest: digest()
  }), 1024),
  'PerceptionResolutionDraft.resultKind': enumText('found', 'not_found'),
  'PerceptionResolutionRevision.resultKind': enumText('found', 'not_found'),
  'PerceptionResolutionDraft.factKind': enumText('rating', 'watched'),
  'PerceptionResolutionRevision.factKind': enumText('rating', 'watched'),
  'PerceptionResolutionDraft.ruleRevision': positiveInteger(),
  'PerceptionResolutionRevision.ruleRevision': positiveInteger(),
  'PerceptionResolutionDraft.winningPerceptionId': id(),
  'PerceptionResolutionRevision.winningPerceptionId': id(),
  'PerceptionResolutionDraft.resolvedValue': perceptionResolvedValue,
  'PerceptionResolutionRevision.resolvedValue': perceptionResolvedValue,
  'PerceptionResolutionDraft.resolvedProvenance': perceptionResolvedProvenance,
  'PerceptionResolutionRevision.resolvedProvenance': perceptionResolvedProvenance,
  'PerceptionResolutionDraft.reasonCode': enumText('no_matching_record', 'requested_fact_absent', 'strongest_value_conflict'),
  'PerceptionResolutionRevision.reasonCode': enumText('no_matching_record', 'requested_fact_absent', 'strongest_value_conflict'),
  'PeopleCandidateDraft.candidateKind': enumText('registration', 'merge'),
  'PeopleCandidateDraft.candidatePayload': { oneOf: [peopleRegistrationPayload, peopleMergePayload] },
  'PeopleCandidateRevision.candidateKind': enumText('registration', 'merge'),
  'PeopleCandidateRevision.state': enumText('open', 'accepted', 'dismissed', 'superseded'),
  'PersonRegistrationEvidence.aliases': arrayOf(peopleAlias, 256),
  'PersonRegistrationEvidence.providerIdentities': arrayOf(peopleProviderIdentity, 256),
  'PersonRegistrationEvidence.referenceHints': arrayOf(peopleReferenceHint, 256),
  'MergeCandidateEvidence.personPair': { ...arrayOf(peoplePersonRef, 2), minItems: 2 },
  'MergeCandidateEvidence.matchSignals': arrayOf(snapshot('person-match-signal'), 256),
  'MergeCandidateEvidence.conflictSummary': boundedRecord('merge-conflict-summary'),
  'MergeCandidateEvidence.evidenceRefs': arrayOf(id(), 256),
  'PersonRevision.operationKind': enumText('registration', 'merge'),
  'PersonRevision.registrationOrigin': enumText('direct', 'candidate'),
  'PersonRevision.directDecisionRef': object({ decisionId: id(), decisionDigest: digest() }),
  'PersonRevision.acceptedCandidateRef': object({
    candidateKind: enumText('registration', 'merge'), candidateId: id(), candidateRevision: positiveInteger(), candidatePayloadDigest: digest()
  }),
  'PersonRevision.affectedPersonRevisions': arrayOf(object({
    personId: id(), revision: positiveInteger(), status: enumText('active', 'merged'), factDigest: digest()
  }), 2),
  'PersonRevision.preferenceRevisionRef': nullable(id()),
  'PersonPreferenceRevision.preferenceLevel': { type: 'integer', minimum: -2, maximum: 2 }
};

function inferredField(resultName, fieldName) {
  const exact = special[`${resultName}.${fieldName}`];
  if (exact) return exact;
  if (/^(hasMore|released|playable)$/.test(fieldName)) return bool();
  if (/Digest$/.test(fieldName) || /DigestSet$/.test(fieldName)) return digest();
  if (/Digests$/.test(fieldName)) return arrayOf(digest());
  if (/Ids$/.test(fieldName) || /Refs$/.test(fieldName) || /Keys$/.test(fieldName)) return arrayOf(id());
  if (/(Id|Ref|Key)$/.test(fieldName)) return id();
  if (/(Revision|Count|Bytes|Ms|Ordinal)$/.test(fieldName)) return nonNegativeInteger();
  if (/^(members|records|candidates|observations|relations|findings|roles)$/.test(fieldName)) return arrayOf(snapshot(fieldName.replace(/s$/, '')));
  if (/s$/.test(fieldName)) return arrayOf(text());
  if (/^(identity|evidence|manifest|reality|facts|summary|constraints|criteria|placement|state)$/.test(fieldName)) return boundedRecord(fieldName);
  return text();
}

const contracts = {
  FilesystemIdentityEvidence: ['EvidenceEnvelope', 'identity,endpointId,location,statSizeBytes,statMtimeMs'],
  ContentHashEvidence: ['EvidenceEnvelope', 'identity,hashProfileRef,bytesHashed'],
  MediaProbeEvidence: ['EvidenceEnvelope', 'sourceHandleDigest,resultKind,reasonCode?,container?,durationMs?,sizeBytes,videoStreams,audioStreams,subtitleStreams,discTopology?'],
  LayoutEvidence: ['EvidenceEnvelope', 'sourceHandleDigest,boundedScopeDigest,entries,entriesDigest,layoutDigest'],
  ManifestVerification: ['VerificationEnvelope', 'manifestDigest,contractRef'],
  ArtifactManifestVerification: ['VerificationEnvelope', 'manifestDigest,contractRef,artifactDigests'],
  IntegrationAvailabilityEvidence: ['EvidenceEnvelope', 'integrationId,configRevision,availabilityState,latencyMs?'],
  PersonMatchEvidence: ['EvidenceEnvelope', 'clusterSetDigest,referenceProjectionRevision,matches,unmatchedClusterIds'],
  FieldObservationPage: ['EvidenceEnvelope', 'fieldObservationWorkId,observationId,fieldId,accessRevision,pageOrdinal,expectedObservationRevision,cursorIn,cursorOut,materialObservations,pageDigest,hasMore'],
  ObservationCommitResult: ['DomainFactEnvelope', 'observationId,fieldObservationWorkId,fieldId,accessRevision,pageOrdinal,committedObservationRevision,pageDigest,acceptedMaterials,acceptedMaterialSetDigest,nextCursor,hasMore'],
  ProcurementControlReceipt: ['ReceiptEnvelope', 'procurementRunId,fieldId,runBasisDigest,selectedMaterialCount,selectedMaterialSetDigest,acquiredMaterialCount,assertedMaterialCount,controlRevisionSetDigest'],
  PlayabilityEvidence: ['EvidenceEnvelope', 'procurementRunId,runBasisDigest,selectionDigest,batchOrdinal,materialResults,materialResultSetDigest'],
  TriageStructureEvidence: ['EvidenceEnvelope', 'procurementRunId,runBasisDigest,selectionDigest,triageRuleAuthorityDigest,materialFieldContextDigest,pageRequestDigest,pageOrdinal,cursorIn,cursorOut,resultKind,units,unassignedMaterials,unitSetDigest,unassignedSetDigest'],
  IdentityClaim: ['DraftEnvelope', 'claimKind,mediaType,contentProfile,claimedTitle,displayIdentity,claimedYear?,seasonClaim?,javCode?,identityMetadataDigest,structureUnitDigest,sourceHints,claimDigest'],
  PrimaryInputManifestDraft: ['DraftEnvelope', 'preallocatedManifestId,procurementRunId,runBasisDigest,structureEvidencePayloadDigest,unitId,structureKind,memberCount,membersDigest,memberSourceDigest,manifestDraftDigest'],
  PrimaryInputManifest: ['ManifestEnvelope', 'structureKind,members'],
  CandidatePackage: ['ManifestEnvelope', 'candidatePackageId,packageRevision,procurementRunId,runBasisDigest,triageRule,materialFieldContextRef,mediaType,contentProfile,displayIdentity,identityMetadata,identityClaim,structureEvidenceRef,seasonContinuityClaims,seasonContinuityClaimSetDigest,primaryInputManifestRef,relatedReferences,relatedReferenceSetDigest,memberControlEvidenceSetDigest,packageDigest'],
  RelatedMaterialReference: [null, 'referenceId,primaryMaterialKey,role,identity,endpointId,location,checksumAlgorithm,checksumHex,associationEvidenceDigest,referenceDigest'],
  SeasonContinuityClaim: [null, 'claimKind,claimNamespace,claimKey,claimDigest,evidenceDigest'],
  CandidateIntakeAcceptanceBasis: [null, 'handoffContractRef,acceptanceOwnerDomain,targetContext,candidatePackageId,packageRevision,packageDigest,primaryInputManifestDigest,seasonContinuityClaimSetDigest,relatedReferenceSetDigest,memberControlEvidenceSetDigest,acceptanceBasisDigest'],
  ProcurementCandidateOfferAvailableMessage: [null, 'messageKind,offerId,candidatePackageId,packageRevision,packageDigest,acceptanceBasisDigest,acceptanceOwnerDomain,targetContext'],
  LibraCandidateAcceptedMessage: [null, 'messageKind,offerId,candidatePackageId,packageRevision,packageDigest,intakeDecisionId,subjectId,subjectIntakeRevision,receiptId,receiptDigest'],
  ProcurementCandidateAcceptanceClosureResult: [null, 'offerId,candidatePackageId,packageRevision,packageDigest,acceptanceBasisDigest,terminalDeliveryState,transferredMaterialCount,transferredMaterialSetDigest,handoffReceiptDigest,closureDigest'],
  LibraCandidateRejectedMessage: [null, 'messageKind,offerId,candidatePackageId,packageRevision,packageDigest,acceptanceBasisDigest,intakeDecisionId,decisionDigest,rejectionId,reasonCodes,primaryRejectionCode,rejectionReasonSetDigest,rejectionDigest,receiptId,receiptDigest'],
  ProcurementCandidateRejectionClosureResult: [null, 'offerId,candidatePackageId,packageRevision,packageDigest,acceptanceBasisDigest,terminalDeliveryState,releasedMaterialCount,releasedMaterialSetDigest,rejectionReceiptDigest,closureDigest'],
  CandidateContractVerification: ['VerificationEnvelope', 'offerId,candidatePackageId,packageRevision,packageDigest,acceptanceBasisDigest,primaryInputManifestDigest,candidateDeliverySnapshotDigest'],
  IntakeMaterialVerification: ['VerificationEnvelope', 'candidatePackageId,packageDigest,candidateDeliverySnapshotDigest,verifiedMaterials,verifiedMaterialSetDigest'],
  LibraBindingDraft: ['DraftEnvelope', 'subjectRef,candidateDeliverySnapshotDigest,bindings,bindingSetDigest'],
  IntakeRejectionReceipt: ['ReceiptEnvelope', 'intakeDecisionId,handoffKind,offerId,deliverableId,deliverableRevision,deliverableDigest,rejectionId,primaryRejectionCode,rejectionReasonSetDigest,rejectionDigest,receiptDigest'],
  RejectionReceipt: ['ReceiptEnvelope', 'acceptanceDecisionId,handoffKind,offerId,deliverableId,rejectionCode,acceptanceEvidenceSetDigest,rejectionDigest,receiptDigest'],
  SubjectAndTransferReceipt: ['ReceiptEnvelope', 'intakeDecisionId,offerId,candidatePackageId,packageRevision,packageDigest,candidateDeliverySnapshotDigest,subjectId,subjectIntakeRevision,subjectContinuityHeadRevision,subjectContinuitySetDigest,subjectEpisodeScopeDigest,libraBindingSetDigest,controlRevisionSetDigest,receiptDigest'],
  VersionedQueryResult: ['EvidenceEnvelope', 'queryContract,queryVersion,inputDigest,resultKind,resultRevision,resultDigest,expiresAtMs'],
  ResolvedProductIdentity: ['EvidenceEnvelope', 'subjectId,structureKind,contentProfile,identityKind,providerIdentities,exactSeasonContinuityClaims,exactSeasonContinuitySetDigest,displayIdentity,identityDigest'],
  MetadataObservation: ['EvidenceEnvelope', 'identityDigest,contentProfile,descriptiveFacts,providerIdentitySet,peopleHints,artifactHints'],
  DecisionBasisRevision: ['DomainFactEnvelope', 'subjectId,queryResultSetDigest,routingInputDigest,specInputDigest'],
  FrameArtifactSet: ['ManifestEnvelope', 'sourceMaterialDigest,samplingPlanDigest,frameArtifactHandles'],
  WesternAnalysisResult: ['EvidenceEnvelope', 'externalJobReceiptId,analysisVariantRef,resultArtifactHandle,resultDigest'],
  ArtifactAcquisitionResult: [null, 'resultKind,artifactHandle?,reasonCode?,evidence'],
  ProductMetadataDraft: ['DraftEnvelope', 'resolvedIdentityDigest,descriptiveFacts,providerIdentities,mediaCastDraftRef?,artifactRequirements'],
  MediaCastDraft: ['DraftEnvelope', 'subjectId,metadataObservationDigest,relations'],
  MediaCastFact: ['DomainFactEnvelope', 'subjectId,relationsDigest,relationCount'],
  ProductMetadataFact: ['DomainFactEnvelope', 'subjectId,productMetadataDigest,verifiedArtifactManifestDigest'],
  TranscodeInputVerification: ['VerificationEnvelope', 'sourceHandleDigest,encodeIntentDigest,probeEvidenceDigest,selectedDeviceClass'],
  WorkspaceMediaHandle: ['WorkspaceMaterialHandle', 'mediaProbeRef?,producingEventId,productionIntentDigest'],
  ProductMediaVerification: ['VerificationEnvelope', 'workspaceMediaHandleId,mediaRequirementDigest,probeEvidenceDigest,qualitySummary,spaceSummary'],
  SelectedWorkspaceProduct: ['DraftEnvelope', 'selectedHandleId,selectedVerificationId,candidateSetDigest,selectionReasonCode'],
  ProductConformanceEvidence: ['VerificationEnvelope', 'acceptanceSpecId,productFactSetDigest,unmetRequirementCodes'],
  OnDeckProductPackage: ['ManifestEnvelope', 'onDeckPackageId,packageRevision,libraRunId,runStateRevision,runStateDigest,runExecutionBasisDigest,subjectId,shelfId,acceptanceSpecRef,resolvedIdentitySnapshot,productStructureSnapshot,runMaterialManifestRef,productMaterialManifest,productFactManifest,artifactManifest,mediaCastSnapshot,offloadContextManifest,productionProvenance,productionAttestation,packageDigest'],
  OnDeckProductPackageCommitReceipt: ['ReceiptEnvelope', 'promotionDecisionDigest,onDeckPackageId,packageRevision,packageDigest,offerId,libraRunId,verifiedRunStateRevision,verifiedRunStateDigest,productMaterialManifestDigest,productFactSetDigest,productFactManifestDigest,artifactManifestDigest,offloadContextDigest,controlRevisionSetDigest,receiptDigest'],
  ReclamationReceipt: ['ReceiptEnvelope', 'workspaceId,reclaimedHandleIds,retainedHandleIds,reclaimedBytes'],
  WorkspaceCleanupCommitReceipt: ['ReceiptEnvelope', 'cleanupScopeId,materialHandleId,deletionEvidenceDigest,releasedControlRevision?,cleanupState'],
  AcquisitionQuery: ['DraftEnvelope', 'resolvedIdentityDigest,structureKind,queryTerms,hardConstraints,queryDigest'],
  AcquisitionCandidates: ['EvidenceEnvelope', 'queryDigest,integrationId,candidates,candidateSetDigest'],
  SelectedCandidate: ['DraftEnvelope', 'candidateSetDigest,selectedCandidateId,selectionCriteriaDigest,selectionReasonCodes'],
  AcquisitionObservation: ['EvidenceEnvelope', 'externalJobReceiptId,phase,externalState,outputRefs'],
  StableExternalMaterialEvidence: ['VerificationEnvelope', 'externalMaterialHandleId,observationWindow,stableDigest'],
  IdentityVerification: ['VerificationEnvelope', 'expectedIdentityDigest,observedIdentityDigest,strengthClass'],
  VerifiedExternalPackage: ['VerificationEnvelope', 'externalMaterialHandleId,episodeDeliveryManifestDigest,identityVerificationId,packageManifestDigest'],
  AcceptanceCheck: ['VerificationEnvelope', 'acceptanceAttemptId,checkKind,standardRevision,packageDigest'],
  InventoryFeasibilityEvidence: ['EvidenceEnvelope', 'shelfId,placementRevision,targetEndpointId,requiredBytes,availableBytes,finalInventoryDecisionDraftDigest'],
  CustodyAndTransferReceipt: ['ReceiptEnvelope', 'acceptanceDecisionId,custodyId,arcaBindingSetDigest,controlRevisionSetDigest'],
  StagedInventoryManifest: ['ManifestEnvelope', 'targetCommitSlotId,stagedMembers,sourceProductManifestDigest'],
  StagedInventoryVerification: ['VerificationEnvelope', 'stagedInventoryManifestDigest,finalInventoryDecisionDigest'],
  PlacementSwitchReceipt: ['ReceiptEnvelope', 'targetCommitSlotId,finalBindingSetDigest,replacedInputSetDigest,transactionRevision'],
  FinalPrimaryVerification: ['VerificationEnvelope', 'finalBindingSetDigest,productManifestDigest,verifiedMaterialKeys'],
  SettlementDeletionEvidence: ['EvidenceEnvelope', 'authorizationOrApprovalRef,materialKey,preDeleteIdentityDigest,postDeleteReality,effectReceiptId'],
  DeletionEvidence: ['EvidenceEnvelope', 'authorizationOrApprovalRef,materialKey,preDeleteIdentityDigest,postDeleteReality,effectReceiptId'],
  FulfillmentVerification: ['VerificationEnvelope', 'finalInventoryDecisionDigest,shelfStandardRevision,finalRealityDigest'],
  OnDeckCommitResult: [null, 'onDeckCommitReceipt,offloadCompletionFact'],
  OnDeckCommitReceipt: ['ReceiptEnvelope', 'shelfEntryId,inventoryRevision,deckFactRevision,controlRevisionSetDigest'],
  OffloadCompletionFact: ['DomainFactEnvelope', 'onDeckRunId,shelfEntryId,inventoryRevision,packageId,completionDigest'],
  CustodyAssessmentEvidence: ['EvidenceEnvelope', 'shelfEntryId,inventoryRevision,standardRevision,placementRevision,decisionFactSetDigest,careBasisDigest,assessmentState,findingDrafts'],
  PresentationAssessmentEvidence: ['EvidenceEnvelope', 'shelfEntryId,inventoryRevision,standardRevision,placementRevision,decisionFactSetDigest,careBasisDigest,assessmentState,findingDrafts'],
  ConformanceAssessmentEvidence: ['EvidenceEnvelope', 'shelfEntryId,inventoryRevision,standardRevision,placementRevision,decisionFactSetDigest,careBasisDigest,assessmentState,findingDrafts'],
  AssessmentRevision: ['DomainFactEnvelope', 'shelfEntryId,careBasisDigest,professionalAssessmentSetDigest'],
  MaterialEffectReceipt: ['ReceiptEnvelope', 'targetBindingDigest,materialEffectKind,effectReceiptId,finalRealityDigest'],
  CareProductVerification: ['VerificationEnvelope', 'aftercareCaseId,careRequirementDigest,workspaceMediaHandleId'],
  AftercareInventoryCommitReceipt: ['ReceiptEnvelope', 'aftercareCaseId,shelfEntryId,previousInventoryRevision,newInventoryRevision,controlChangeDigest'],
  AftercareCaseResult: ['DomainFactEnvelope', 'aftercareCaseId,resultState,reassessmentDigest,inventoryEffectRefs'],
  DuplicateGroupEvidenceList: ['EvidenceEnvelope', 'groups'],
  DuplicateGroupRevisionList: ['DomainFactEnvelope', 'duplicateGroupIds,memberSetDigests,supersededGroupIds'],
  ReviewCandidateRevision: ['DomainFactEnvelope', 'candidateId,shelfEntryId,policyRevision,reasonDigest,state'],
  ScopeVerification: ['VerificationEnvelope', 'destructionScopeId,inventoryRevision,controlRevisionSetDigest,materialKeys'],
  ReferenceReleaseResult: ['DomainFactEnvelope', 'shelfEntryId,referenceId,remainingReferenceCount,released'],
  DestructionCompletionVerification: ['VerificationEnvelope', 'destructionScopeId,authorizationId,deletionEvidenceSetDigest'],
  OffdeckTerminalReceipt: ['ReceiptEnvelope', 'offdeckCaseId,shelfEntryId,terminalDeckFactRevision,releasedControlSetDigest'],
  ReleaseVerification: ['VerificationEnvelope', 'deregistrationId,shelfId,releaseManifestDigest,controlRevisionSetDigest'],
  DeregistrationReceipt: ['ReceiptEnvelope', 'deregistrationId,shelfId,releasedControlSetDigest,terminalFactDigest'],
  PerceptionObservationPage: ['EvidenceEnvelope', 'perceptionAcquisitionId,pageOrdinal,source,cursor,observations,observationPageDigest,hasMore'],
  PerceptionAcquisitionCommitDraft: ['DraftEnvelope', 'perceptionAcquisitionId,source,normalizationRuleRef,cursorTransition,records,sourceLineageRelations'],
  PerceptionRecordCommitResult: ['ReceiptEnvelope', 'acquisitionCommitReceiptId,perceptionAcquisitionId,sourceId,committedCursorRevision,perceptionIds,relationIds,insertedCount,duplicateCount'],
  PerceptionResolutionDraft: ['DraftEnvelope', 'queryContract,querySchemaRef,queryInputDigest,factKind,recordSetDigest,ruleRevision,ruleDigest,resultKind,winningPerceptionId?,resolvedValue?,resolvedProvenance?,reasonCode?,duplicateRelationDrafts'],
  PerceptionResolutionRevision: ['DomainFactEnvelope', 'queryContract,querySchemaRef,queryInputDigest,factKind,recordSetDigest,ruleRevision,ruleDigest,resultKind,winningPerceptionId?,resolvedValue?,resolvedProvenance?,reasonCode?,committedRelationIds'],
  PersonRegistrationEvidence: ['EvidenceEnvelope', 'proposedName,aliases,providerIdentities,referenceHints'],
  PeopleCandidateDraft: ['DraftEnvelope', 'candidateKind,evidenceDigest,candidatePayload,candidatePayloadDigest'],
  PeopleCandidateRevision: ['DomainFactEnvelope', 'candidateKind,candidateId,candidateRevision,candidateSchemaRef,candidatePayloadDigest,evidenceDigest,state'],
  PersonReferenceRevision: ['DomainFactEnvelope', 'personId,referenceRevision,operationKind,affectedReferenceAssetId,affectedReferenceFaceId,activeReferenceAssets,activeReferenceFaces,activeAssetSetDigest,activeFaceSetDigest,referenceSetDigest'],
  MergeCandidateEvidence: ['EvidenceEnvelope', 'personPair,matchSignals,conflictSummary,evidenceRefs'],
  PersonRevision: ['DomainFactEnvelope', 'operationKind,registrationOrigin?,personId,canonicalName,aliasSetDigest,providerIdentitySetDigest,directDecisionRef?,acceptedCandidateRef?,affectedPersonRevisions,mergeRecordRef?,preferenceRevisionRef?'],
  PersonPreferenceRevision: ['DomainFactEnvelope', 'personId,preferenceLevel,reason']
};

special['OnDeckCommitResult.onDeckCommitReceipt'] = ref('OnDeckCommitReceipt');
special['OnDeckCommitResult.offloadCompletionFact'] = ref('OffloadCompletionFact');

function buildResultTypeSchema(name, [base, fieldList]) {
  if (name === 'ProcurementControlReceipt') return procurementControlReceiptSchema();
  if (name === 'PersonReferenceRevision') return personReferenceRevisionSchema();
  if (name === 'IntakeRejectionReceipt') return intakeRejectionReceiptSchema();
  if (name === 'RejectionReceipt') return rejectionReceiptSchema();
  if (name === 'OnDeckProductPackageCommitReceipt') return onDeckProductPackageCommitReceiptSchema();
  const workspaceFields = base === 'WorkspaceMaterialHandle'
    ? Object.fromEntries(Object.entries(buildSharedTypeSchemas().WorkspaceMaterialHandle.properties)
      .filter(([field]) => field !== 'schemaRef' && field !== 'schemaVersion'))
    : {};
  const inherited = {
    schemaRef: { const: typeId(name) }, schemaVersion: { const: 1 },
    ...(base === 'WorkspaceMaterialHandle' ? workspaceFields : base ? envelopeFields[base] : {})
  };
  const required = Object.keys(inherited).filter((field) => !(envelopeOptionalFields[base] || new Set()).has(field));
  const properties = { ...inherited };
  for (const token of fieldList.split(',').filter(Boolean)) {
    const optional = token.endsWith('?');
    const fieldName = token.replace(/\?$/, '');
    properties[fieldName] = inferredField(name, fieldName);
    if (!optional) required.push(fieldName);
  }
  const result = {
    $schema: DRAFT, $id: typeId(name), title: `${name}@1`, 'x-helix-ssotRefs': ['8.6.19'],
    ...(base ? { 'x-helix-envelopeRef': typeId(base) } : {}),
    ...object(properties, required)
  };
  if (name === 'FieldObservationPage' || name === 'ObservationCommitResult') {
    result['x-helix-maxCanonicalBytes'] = 64 * 1024;
  }
  if (name === 'LibraCandidateAcceptedMessage' || name === 'LibraCandidateRejectedMessage') result['x-helix-maxCanonicalBytes'] = 16 * 1024;
  if (name === 'ProcurementCandidateRejectionClosureResult') result['x-helix-maxCanonicalBytes'] = 64 * 1024;
  if (name === 'ProcurementCandidateAcceptanceClosureResult') result['x-helix-maxCanonicalBytes'] = 64 * 1024;
  if (name === 'PerceptionResolutionDraft' || name === 'PerceptionResolutionRevision') {
    result.allOf = [{
      if: { properties: { resultKind: { const: 'found' } }, required: ['resultKind'] },
      then: {
        required: ['winningPerceptionId', 'resolvedValue', 'resolvedProvenance'],
        not: { required: ['reasonCode'] }
      },
      else: {
        required: ['reasonCode'],
        not: { anyOf: [
          { required: ['winningPerceptionId'] }, { required: ['resolvedValue'] }, { required: ['resolvedProvenance'] }
        ] }
      }
    }];
  }
  return result;
}

function onDeckProductPackageCommitReceiptSchema() {
  const properties = {
    schemaRef: { const: typeId('OnDeckProductPackageCommitReceipt') }, schemaVersion: { const: 1 },
    ...envelopeFields.ReceiptEnvelope, receiptKind: { const: 'libra_product_package_published' },
    ownerDomain: { const: 'libra' }, scopeType: { const: 'on_deck_package' }, promotionDecisionDigest: digest(),
    onDeckPackageId: id(), packageRevision: positiveInteger(), packageDigest: digest(), offerId: id(), libraRunId: id(),
    verifiedRunStateRevision: positiveInteger(), verifiedRunStateDigest: digest(), productMaterialManifestDigest: digest(),
    productFactSetDigest: digest(), productFactManifestDigest: digest(), artifactManifestDigest: digest(),
    offloadContextDigest: digest(), controlRevisionSetDigest: digest(), receiptDigest: digest()
  };
  return { $schema: DRAFT, $id: typeId('OnDeckProductPackageCommitReceipt'), title: 'OnDeckProductPackageCommitReceipt@1',
    'x-helix-ssotRefs': ['8.6.19', '8.6.21'], 'x-helix-envelopeRef': typeId('ReceiptEnvelope'),
    'x-helix-maxCanonicalBytes': 16 * 1024,
    ...object(properties, Object.keys(properties).filter((field) => field !== 'effectReceiptRef')) };
}

function procurementControlReceiptSchema() {
  const properties = {
    schemaRef: { const: typeId('ProcurementControlReceipt') }, schemaVersion: { const: 1 },
    ...envelopeFields.ReceiptEnvelope, procurementRunId: id(), fieldId: id(), runBasisDigest: digest(),
    selectedMaterialCount: positiveInteger(), selectedMaterialSetDigest: digest(), acquiredMaterialCount: nonNegativeInteger(),
    assertedMaterialCount: nonNegativeInteger(), controlRevisionSetDigest: digest()
  };
  return {
    $schema: DRAFT, $id: typeId('ProcurementControlReceipt'), title: 'ProcurementControlReceipt@1',
    'x-helix-ssotRefs': ['8.6.18', '8.6.19'], 'x-helix-envelopeRef': typeId('ReceiptEnvelope'),
    'x-helix-maxCanonicalBytes': 64 * 1024, ...object(properties, Object.keys(properties).filter((field) => field !== 'effectReceiptRef'))
  };
}

function intakeRejectionReceiptSchema() {
  const properties = {
    schemaRef: { const: typeId('IntakeRejectionReceipt') }, schemaVersion: { const: 1 },
    ...envelopeFields.ReceiptEnvelope, receiptKind: { const: 'handoff_a_rejected' }, ownerDomain: { const: 'libra' },
    scopeType: { const: 'intake_decision' }, intakeDecisionId: id(), handoffKind: { const: 'procurement_to_libra' },
    offerId: id(), deliverableId: id(), deliverableRevision: positiveInteger(), deliverableDigest: digest(), rejectionId: digest(),
    primaryRejectionCode: text(), rejectionReasonSetDigest: digest(), rejectionDigest: digest(), receiptDigest: digest()
  };
  return { $schema: DRAFT, $id: typeId('IntakeRejectionReceipt'), title: 'IntakeRejectionReceipt@1',
    'x-helix-ssotRefs': ['8.6.19'], 'x-helix-envelopeRef': typeId('ReceiptEnvelope'),
    'x-helix-maxCanonicalBytes': 64 * 1024, ...object(properties, Object.keys(properties).filter((field) => field !== 'effectReceiptRef')) };
}

function rejectionReceiptSchema() {
  const properties = {
    schemaRef: { const: typeId('RejectionReceipt') }, schemaVersion: { const: 1 },
    ...envelopeFields.ReceiptEnvelope, receiptKind: { const: 'handoff_b_rejected' }, ownerDomain: { const: 'arca' },
    scopeType: { const: 'acceptance_decision' }, acceptanceDecisionId: id(), handoffKind: { const: 'libra_to_arca' },
    offerId: id(), deliverableId: id(), rejectionCode: text(), acceptanceEvidenceSetDigest: digest(),
    rejectionDigest: digest(), receiptDigest: digest()
  };
  return { $schema: DRAFT, $id: typeId('RejectionReceipt'), title: 'RejectionReceipt@1',
    'x-helix-ssotRefs': ['8.6.19'], 'x-helix-envelopeRef': typeId('ReceiptEnvelope'),
    'x-helix-maxCanonicalBytes': 16 * 1024, ...object(properties, Object.keys(properties).filter((field) => field !== 'effectReceiptRef')) };
}

function personReferenceRevisionSchema() {
  const activeAsset = object({ referenceAssetId: id(), artifactHandleId: id(), artifactDigest: digest() });
  const activeFace = object({ referenceFaceId: id(), referenceAssetId: id(), embeddingHandleId: id(), embeddingDigest: digest(), modelRef: text() });
  const properties = { schemaRef: { const: typeId('PersonReferenceRevision') }, schemaVersion: { const: 1 },
    ...envelopeFields.DomainFactEnvelope, personId: id(), referenceRevision: positiveInteger(),
    operationKind: enumText('add_image', 'release_image'), affectedReferenceAssetId: id(), affectedReferenceFaceId: id(),
    activeReferenceAssets: arrayOf(activeAsset, 1024), activeReferenceFaces: arrayOf(activeFace, 1024),
    activeAssetSetDigest: digest(), activeFaceSetDigest: digest(), referenceSetDigest: digest() };
  return { $schema: DRAFT, $id: typeId('PersonReferenceRevision'), title: 'PersonReferenceRevision@1',
    'x-helix-ssotRefs': ['8.6.19'], 'x-helix-envelopeRef': typeId('DomainFactEnvelope'), ...object(properties) };
}

function buildResultTypeSchemas() {
  return Object.fromEntries(Object.entries(contracts).map(([name, contract]) => [name, buildResultTypeSchema(name, contract)]));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
  return value;
}

function schemaDigest(schema) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(schema))).digest('hex');
}

module.exports = Object.freeze({ buildResultTypeSchemas, contracts, schemaDigest, typeId });
