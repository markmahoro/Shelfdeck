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

const stream = object({
  streamIndex: nonNegativeInteger(), codec: text(), codedWidth: positiveInteger(), codedHeight: positiveInteger(),
  sampleAspectRatio: text(), rotation: { type: 'integer', minimum: -359, maximum: 359 }, displayWidth: positiveInteger(),
  displayHeight: positiveInteger(), longEdge: positiveInteger(), shortEdge: positiveInteger()
});
const simpleStream = object({ streamIndex: nonNegativeInteger(), codec: text(), language: nullable(text()) }, ['streamIndex', 'codec']);

const special = {
  'FilesystemIdentityEvidence.identity': ref('PhysicalMaterialIdentity'),
  'ContentHashEvidence.identity': ref('PhysicalMaterialIdentity'),
  'LayoutEvidence.memberSummary': boundedRecord('layout-member-summary'),
  'MediaProbeEvidence.videoStreams': arrayOf(stream, 64),
  'MediaProbeEvidence.audioStreams': arrayOf(simpleStream, 128),
  'MediaProbeEvidence.subtitleStreams': arrayOf(simpleStream, 256),
  'PersonMatchEvidence.matches': arrayOf(object({ clusterId: id(), personId: id(), confidenceClass: text(), evidenceDigest: digest() })),
  'FieldObservationPage.materialObservations': arrayOf(snapshot('field-material-observation')),
  'PlayabilityEvidence.materialResults': arrayOf(object({ materialKey: digest(), playable: bool(), reasonCodes: arrayOf(text(), 64) })),
  'TriageStructureEvidence.structureKind': enumText('single', 'season'),
  'TriageStructureEvidence.episodeClaims': arrayOf(object({ episodeKey: text(), materialKey: digest(), claimDigest: digest() })),
  'IdentityClaim.claimKind': text(),
  'IdentityClaim.seasonNumber': nullable(positiveInteger()),
  'PrimaryInputManifest.structureKind': enumText('single', 'season'),
  'PrimaryInputManifest.members': { ...arrayOf(object({
    ordinal: positiveInteger(), materialKey: digest(), role: text(), episodeClaim: snapshot('episode-claim'), bindingRevision: positiveInteger()
  }, ['ordinal', 'materialKey', 'role', 'bindingRevision'])), minItems: 1 },
  'CandidatePackage.identityClaim': ref('IdentityClaim'),
  'CandidatePackage.seasonContinuityClaims': arrayOf(object({
    kind: enumText('exact_provider_season', 'persistent_triage_grouping'), claimDigest: digest(), subjectId: id()
  }), 64),
  'LibraBindingDraft.bindings': arrayOf(object({
    materialKey: digest(), role: text(), episodeKey: nullable(text()), endpointId: id(), location: text(), bindingRevision: positiveInteger()
  })),
  'VersionedQueryResult.resultKind': enumText('found', 'not_found'),
  'ResolvedProductIdentity.structureKind': enumText('single', 'season'),
  'ResolvedProductIdentity.contentProfile': enumText('movie', 'season', 'jav', 'western_adult'),
  'ResolvedProductIdentity.providerIdentities': arrayOf(snapshot('provider-identity'), 128),
  'ResolvedProductIdentity.displayIdentity': boundedRecord('display-identity'),
  'MetadataObservation.contentProfile': enumText('movie', 'season', 'jav', 'western_adult'),
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
  'OnDeckProductPackage.metadataFactRefs': arrayOf(id(), 1024),
  'OnDeckProductPackage.offloadContextManifest': snapshot('offload-context-manifest'),
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
  'PerceptionObservationPage.observations': arrayOf(snapshot('perception-observation'), 4096),
  'NormalizedPerceptionRecordDraftList.records': arrayOf(object({
    draftId: id(), sourceKind: text(), sourceRecordKey: text(), rating: nullable({ type: 'number', minimum: 0, maximum: 10 }),
    watchedState: nullable(text()), observedTitle: text(), identityAnchors: arrayOf(text(), 128), provenanceDigest: digest()
  }, ['draftId', 'sourceKind', 'sourceRecordKey', 'observedTitle', 'identityAnchors', 'provenanceDigest']), 4096),
  'PerceptionResolutionDraft.resultKind': enumText('found', 'not_found'),
  'PerceptionResolutionRevision.resultKind': enumText('found', 'not_found'),
  'PerceptionResolutionDraft.winningPerceptionId': nullable(id()),
  'PerceptionResolutionRevision.winningPerceptionId': nullable(id()),
  'PeopleCandidateDraft.candidateKind': enumText('registration', 'merge'),
  'PeopleCandidateRevision.candidateKind': enumText('registration', 'merge'),
  'PeopleCandidateRevision.state': { const: 'open' },
  'MergeCandidateEvidence.personPair': object({ leftPersonId: id(), rightPersonId: id() }),
  'MergeCandidateEvidence.matchSignals': arrayOf(snapshot('person-match-signal'), 256),
  'MergeCandidateEvidence.conflictSummary': boundedRecord('merge-conflict-summary'),
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
  MediaProbeEvidence: ['EvidenceEnvelope', 'sourceHandleDigest,container,durationMs,sizeBytes,videoStreams,audioStreams,subtitleStreams'],
  LayoutEvidence: ['EvidenceEnvelope', 'sourceHandleDigest,boundedScopeDigest,memberSummary,layoutDigest'],
  ManifestVerification: ['VerificationEnvelope', 'manifestDigest,contractRef'],
  ArtifactManifestVerification: ['VerificationEnvelope', 'manifestDigest,contractRef,artifactDigests'],
  IntegrationAvailabilityEvidence: ['EvidenceEnvelope', 'integrationId,configRevision,availabilityState,latencyMs?'],
  PersonMatchEvidence: ['EvidenceEnvelope', 'clusterSetDigest,referenceProjectionRevision,matches,unmatchedClusterIds'],
  FieldObservationPage: ['EvidenceEnvelope', 'fieldId,accessRevision,cursorIn,cursorOut,materialObservations,hasMore'],
  ObservationCommitResult: ['DomainFactEnvelope', 'observationId,acceptedMaterialKeys,nextCursor'],
  ProcurementControlReceipt: ['ReceiptEnvelope', 'procurementRunId,acquiredMaterialKeys,controlRevisionSetDigest'],
  PlayabilityEvidence: ['EvidenceEnvelope', 'materialResults'],
  TriageStructureEvidence: ['EvidenceEnvelope', 'structureKind,primaryRoles,episodeClaims,relatedReferences'],
  IdentityClaim: ['DraftEnvelope', 'claimKind,claimedTitle,seasonNumber?,contentProfileHint,sourceHints'],
  PrimaryInputManifest: ['ManifestEnvelope', 'structureKind,members'],
  CandidatePackage: ['ManifestEnvelope', 'candidatePackageId,procurementRunId,identityClaim,seasonContinuityClaims,primaryInputManifestRef,relatedReferenceSetDigest,packageDigest'],
  CandidateContractVerification: ['VerificationEnvelope', 'candidatePackageId,packageDigest'],
  IntakeMaterialVerification: ['VerificationEnvelope', 'candidatePackageId,packageDigest,verifiedMaterialKeys'],
  LibraBindingDraft: ['DraftEnvelope', 'subjectPlaceholderRef,bindings'],
  RejectionReceipt: ['ReceiptEnvelope', 'handoffKind,deliverableId,rejectionCode,rejectionDigest'],
  SubjectAndTransferReceipt: ['ReceiptEnvelope', 'candidatePackageId,subjectId,libraBindingSetDigest,controlRevisionSetDigest'],
  VersionedQueryResult: ['EvidenceEnvelope', 'queryContract,queryVersion,inputDigest,resultKind,resultRevision,resultDigest,expiresAtMs'],
  ResolvedProductIdentity: ['EvidenceEnvelope', 'subjectId,structureKind,contentProfile,identityKind,providerIdentities,displayIdentity,identityDigest'],
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
  OnDeckProductPackage: ['ManifestEnvelope', 'onDeckPackageId,libraRunId,subjectId,shelfId,acceptanceSpecId,resolvedIdentityDigest,productMaterialManifest,metadataFactRefs,offloadContextManifest,packageDigest'],
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
  PerceptionObservationPage: ['EvidenceEnvelope', 'sourceId,cursorIn,cursorOut,observations,hasMore'],
  NormalizedPerceptionRecordDraftList: ['DraftEnvelope', 'records'],
  PerceptionRecordCommitResult: ['ReceiptEnvelope', 'perceptionIds,insertedCount,duplicateCount'],
  PerceptionResolutionDraft: ['DraftEnvelope', 'queryContract,queryInputDigest,resultKind,winningPerceptionId?,ruleRevision'],
  PerceptionResolutionRevision: ['DomainFactEnvelope', 'queryContract,queryInputDigest,resultKind,winningPerceptionId?'],
  PersonRegistrationEvidence: ['EvidenceEnvelope', 'proposedName,aliases,providerIdentities,referenceHints'],
  PeopleCandidateDraft: ['DraftEnvelope', 'candidateKind,candidatePayloadDigest,evidenceDigest'],
  PeopleCandidateRevision: ['DomainFactEnvelope', 'candidateKind,candidateId,candidatePayloadDigest,state'],
  PersonReferenceRevision: ['DomainFactEnvelope', 'personId,referenceAssetIds,referenceFaceIds'],
  MergeCandidateEvidence: ['EvidenceEnvelope', 'personPair,matchSignals,conflictSummary'],
  PersonRevision: ['DomainFactEnvelope', 'personId,canonicalName,aliasSetDigest,providerIdentitySetDigest,mergeRecordRef?'],
  PersonPreferenceRevision: ['DomainFactEnvelope', 'personId,preferenceLevel,reason']
};

special['OnDeckCommitResult.onDeckCommitReceipt'] = ref('OnDeckCommitReceipt');
special['OnDeckCommitResult.offloadCompletionFact'] = ref('OffloadCompletionFact');

function buildResultTypeSchema(name, [base, fieldList]) {
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
  return {
    $schema: DRAFT, $id: typeId(name), title: `${name}@1`, 'x-helix-ssotRefs': ['8.6.19'],
    ...(base ? { 'x-helix-envelopeRef': typeId(base) } : {}),
    ...object(properties, required)
  };
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
