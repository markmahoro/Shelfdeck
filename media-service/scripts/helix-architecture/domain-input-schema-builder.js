'use strict';

const crypto = require('crypto');

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
const domainTypeId = (name) => `helix://contracts/domain-types/${name}/v1`;
const domainRef = (name) => ({ $ref: domainTypeId(name) });
const typeRef = (name) => ({ $ref: `helix://contracts/types/${name}/v1` });
const text = (options = {}) => ({ type: 'string', minLength: 1, ...options });
const id = () => text({ maxLength: 256 });
const digest = () => text({ pattern: '^[a-f0-9]{64}$' });
const positiveInteger = () => ({ type: 'integer', minimum: 1 });
const nonNegativeInteger = () => ({ type: 'integer', minimum: 0 });
const bool = () => ({ type: 'boolean' });
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const enumText = (...values) => ({ type: 'string', enum: values });
const arrayOf = (items, maxItems = 1024) => ({ type: 'array', items, maxItems });
const object = (properties, required = Object.keys(properties), options = {}) => ({
  type: 'object', additionalProperties: false, properties, required, ...options
});

function snapshot(kind) {
  return object({ objectId: id(), revision: positiveInteger(), schemaRef: text(), digest: digest(), objectKind: { const: kind } });
}

function typedParameters(kind) {
  return arrayOf(object({
    parameter: text({ pattern: '^[a-z][a-zA-Z0-9_.-]{0,127}$' }), valueType: enumText('string', 'integer', 'number', 'boolean'),
    value: { type: ['string', 'integer', 'number', 'boolean'] }, valueDigest: digest()
  }), 256);
}

const special = {
  'AcceptanceSpec.contentProfile': enumText('movie', 'series', 'jav', 'western_adult'),
  'ArtifactProfile.artifactKinds': arrayOf(text(), 128),
  'ArtifactRequirement.mandatory': bool(),
  'BoundedLayoutScope.maxDepth': positiveInteger(),
  'BoundedLayoutScope.maxMembers': positiveInteger(),
  'ClusterParameters.distanceThreshold': { type: 'number', minimum: 0, maximum: 1 },
  'ClusterParameters.minClusterSize': positiveInteger(),
  'EncodeIntent.deviceClass': text(),
  'HashProfile.algorithm': { const: 'sha256' },
  'HashProfile.fullContentRequired': { const: true },
  'IdentityRequirement.strengthClass': text(),
  'PlacementPolicy.targetEndpointIds': arrayOf(id(), 128),
  'PerceptionAcquisitionCursor.pageBudget': positiveInteger(),
  'PerceptionAcquisitionCursor.pageOrdinal': nonNegativeInteger(),
  'PerceptionAcquisitionCursor.cursorIn': { anyOf: [text(), { type: 'null' }] },
  'PerceptionNormalizationRuleRef.canonicalRatingScale': { const: 'integer_1_5' },
  'PreferenceIntent.preferenceLevel': { type: 'integer', minimum: -2, maximum: 2 },
  'SamplingPlan.maxFrames': positiveInteger(),
  'ShelfStandard.contentProfile': enumText('movie', 'series', 'jav', 'western_adult'),
  'StructureRequirement.structureKind': enumText('single', 'season'),
  'AcceptedPayload.onDeckProductPackage': typeRef('OnDeckProductPackage'),
  'ActiveShelfEntryIdentityProjection.entries': arrayOf(snapshot('active-shelf-entry-identity'), 4096),
  'CareBasis.assessments': arrayOf(snapshot('professional-assessment'), 1024),
  'CurrentInventoryControl.materials': arrayOf(object({ materialKey: digest(), inventoryRevision: positiveInteger(), controlRevision: positiveInteger() }), 4096),
  'DecisionEvidence.queryResults': arrayOf(typeRef('VersionedQueryResult'), 256),
  'DecisionInputSet.inputs': arrayOf(snapshot('decision-input'), 256),
  'DestructionScope.materialKeys': arrayOf(digest(), 4096),
  'FinalBindings.bindings': arrayOf(snapshot('arca-material-binding'), 4096),
  'FinalInventoryDecision.members': arrayOf(snapshot('final-inventory-member'), 4096),
  'InventoryMetadataArtifactRefs.metadataFactRefs': arrayOf(id(), 1024),
  'InventoryMetadataArtifactRefs.artifactHandles': arrayOf(typeRef('ArtifactHandle'), 1024),
  'KnownBindings.bindings': arrayOf(snapshot('arca-material-binding'), 4096),
  'LibraWorkspaceScope.workspaceHandles': arrayOf(typeRef('WorkspaceMaterialHandle'), 4096),
  'OffLoadContext.materials': arrayOf(snapshot('offload-material'), 4096),
  'PeopleWorkspace.workspaceHandles': arrayOf(typeRef('WorkspaceMaterialHandle'), 4096),
  'PersonIdentitiesAliasesReferences.people': arrayOf(snapshot('person-identity-alias-reference'), 4096),
  'PersonReferenceProjection.people': arrayOf(snapshot('person-reference'), 4096),
  'ProductFacts.factRefs': arrayOf(id(), 1024),
  'ProductManifest.members': arrayOf(snapshot('product-material-member'), 4096),
  'ProductMetadataArtifact.metadataFactRefs': arrayOf(id(), 1024),
  'ProductMetadataArtifact.artifactHandles': arrayOf(typeRef('ArtifactHandle'), 1024),
  'ProductStructure.structureKind': enumText('single', 'season'),
  'ProfessionalAssessmentsSharingOneCareBasis.assessments': arrayOf(snapshot('professional-assessment'), 1024),
  'ProviderPersonHint.providerIdentities': arrayOf(snapshot('provider-person-identity'), 128),
  'ReferenceEvidence.references': arrayOf(snapshot('material-reference-evidence'), 4096),
  'ReleaseManifest.materialKeys': arrayOf(digest(), 4096),
  'SourceObservation.observations': arrayOf(snapshot('source-observation'), 4096),
  'StructuredRejection.reasonCodes': arrayOf(text(), 128),
  'TargetBindings.bindings': arrayOf(snapshot('target-material-binding'), 4096),
  'TypedManifest.manifest': snapshot('typed-manifest'),
  'VerifiedArtifactManifest.artifactHandles': arrayOf(typeRef('ArtifactHandle'), 1024),
  'VerifiedCareInventoryChange.verifications': arrayOf(typeRef('CareProductVerification'), 1024),
};

function inferredField(typeName, fieldName) {
  if (special[`${typeName}.${fieldName}`]) return special[`${typeName}.${fieldName}`];
  if (/Digest$/.test(fieldName)) return digest();
  if (/Digests$/.test(fieldName)) return arrayOf(digest());
  if (/MaterialKeys$/.test(fieldName)) return arrayOf(digest());
  if (/Ids$/.test(fieldName) || /Refs$/.test(fieldName)) return arrayOf(id());
  if (/(Id|Ref|Key)$/.test(fieldName)) return id();
  if (/(Revision|Bytes|Count|Ms|Depth|Members)$/.test(fieldName)) return nonNegativeInteger();
  if (/^(hasMore|mandatory|eligible)$/.test(fieldName)) return bool();
  if (/s$/.test(fieldName)) return arrayOf(snapshot(fieldName.replace(/s$/, '').replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)));
  return text();
}

const boundedContracts = {
  AcceptanceSpec: 'shelfId,contentProfile,standardRevision,requirementsDigest',
  AnalysisSpec: 'analysisVariantRef,outputContractDigest',
  ArtifactProfile: 'artifactKinds,qualityPolicyDigest',
  ArtifactRequirement: 'artifactKind,mandatory,sourcePolicyDigest',
  BoundedLayoutScope: 'rootHandleDigest,maxDepth,maxMembers',
  CareRequirement: 'careBasisDigest,requiredEffects,acceptanceDigest',
  ClusterParameters: 'modelRef,distanceThreshold,minClusterSize',
  EncodeIntent: 'container,videoCodec,audioCodec,targetQuality,deviceClass',
  FaceModelRef: 'modelId,modelRevision,modelDigest',
  HashProfile: 'algorithm,chunkSizeBytes,fullContentRequired',
  IdentityRequirement: 'expectedIdentityDigest,strengthClass',
  MandatoryRequirement: 'requirementCodes',
  ManifestContract: 'manifestKind,memberSchemaRef,minMembers,maxMembers',
  MediaRequirement: 'videoRequirementDigest,audioRequirementDigest,subtitleRequirementDigest',
  MetadataRequirement: 'requiredFactKeys,artifactRequirementDigest',
  PlacementPolicy: 'shelfId,targetEndpointIds,minimumFreeBytes',
  PreferenceIntent: 'personId,preferenceLevel,reason',
  RemuxIntent: 'container,streamPolicyDigest',
  SamplingPlan: 'intervalMs,maxFrames,frameProfileDigest',
  SelectionCriteria: 'hardConstraintDigest,rankingPolicyDigest',
  ShelfStandard: 'shelfId,contentProfile,ruleSetRevision,acceptanceRuleDigest',
  SidecarProfile: 'format,fileNamePolicyDigest,contentSchemaRef',
  SpaceRequirement: 'requiredBytes,reserveBytes',
  StructureRequirement: 'structureKind,memberConstraintDigest',
  WesternAnalysisVariant: 'modelRef,analysisKind,outputSchemaRef',
  WorkspaceDeliveryContract: 'workspaceId,targetRelativePath,expectedDigest'
};

const dtoContracts = {
  AcceptedIntakePayload: '',
  AcceptedPayload: 'onDeckProductPackage,acceptanceDecisionId,custodyDigest',
  AcceptedProductFacts: 'shelfEntryId,inventoryRevision,productFactSetDigest',
  ActiveShelfEntryIdentityProjection: 'entries,projectionRevision',
  CandidateDraft: '',
  CandidateDeliveryQuery: '',
  CandidateDeliveryReadResult: '',
  CandidateDeliverySnapshot: '',
  SubjectContinuityResolutionDecision: '',
  CareBasis: 'shelfEntryId,inventoryRevision,standardRevision,placementRevision,decisionFactSetDigest,assessments',
  CurrentInventoryControl: 'shelfId,materials',
  DecisionEvidence: 'subjectId,queryResults,routingInputDigest,specInputDigest',
  DecisionInputSet: 'subjectId,inputs,inputSetDigest',
  DestructionScope: 'destructionScopeId,inventoryRevision,materialKeys,controlRevisionSetDigest',
  EpisodeDeliveryManifest: 'episodeClaims,deliveryDigest',
  FinalBindings: 'shelfEntryId,bindings,bindingSetDigest',
  FinalInventoryDecision: 'onDeckRunId,shelfId,members,placementRevision,decisionDigest',
  FinalReality: 'shelfEntryId,inventoryRevision,realityDigest',
  InventoryMetadataArtifactRefs: 'shelfEntryId,inventoryRevision,metadataFactRefs,artifactHandles',
  InventoryRevision: 'shelfEntryId,inventoryRevision,inventoryDigest',
  KnownBindings: 'shelfEntryId,bindings,bindingSetDigest',
  LibraWorkspaceScope: 'workspaceId,workspaceHandles,scopeDigest',
  LibraDeliverablePromotionDecision: '',
  MetadataFetchIntent: '',
  MetadataObservationSet: '',
  OffLoadContext: 'onDeckPackageId,materials,contextDigest',
  OnDeckPersonEvidenceProjectionItem: '',
  PackageIdentity: 'onDeckPackageId,resolvedIdentityDigest,packageDigest',
  PeopleWorkspace: 'workspaceId,workspaceHandles,scopeDigest',
  PerceptionSourceSnapshot: 'sourceId,sourceKind,integrationId,sourceConfigRevision,sourceScopeDigest',
  PerceptionAcquisitionCursor: 'perceptionAcquisitionId,pageOrdinal,expectedCursorRevision,cursorIn,pageBudget',
  PerceptionNormalizationRuleRef: 'ruleRef,ruleVersion,sourceKind,canonicalRatingScale,ruleDigest',
  PerceptionResolutionQuery: '',
  PerceptionResolutionRecordSet: '',
  PerceptionResolutionRuleSnapshot: '',
  PersonIdentitiesAliasesReferences: 'people,peopleSetDigest',
  PersonReferenceProjection: '',
  Placement: 'shelfEntryId,placementRevision,targetEndpointId,placementDigest',
  PolicyResult: 'policyRevision,resultCode,reasonDigest',
  ProductFacts: 'subjectId,factRefs,productFactSetDigest',
  ProductManifest: 'manifestId,members,manifestDigest',
  ProductMetadataArtifact: 'subjectId,metadataFactRefs,artifactHandles,setDigest',
  ProductStructure: 'subjectId,structureKind,episodeClaims,structureDigest',
  ProfessionalAssessmentsSharingOneCareBasis: 'careBasisDigest,assessments,assessmentSetDigest',
  ProviderPersonHint: 'proposedName,providerIdentities,hintDigest',
  ReassessedResult: 'aftercareCaseId,reassessmentDigest,resultState',
  ReferenceEvidence: 'references,referenceSetDigest',
  PeopleCandidateAcceptanceDecision: '',
  DirectPersonRegistrationDecision: '',
  PeopleReferenceMaintenanceDecision: '',
  RelatedReference: 'shelfEntryId,referenceId,materialKey,referenceDigest',
  ReleaseManifest: 'deregistrationId,shelfId,materialKeys,controlRevisionSetDigest,manifestDigest',
  Scope: 'scopeId,materialKeys,scopeDigest',
  SelectedFieldMaterialSet: '',
  TriageIdentityResolutionInput: '',
  TriageManifestBuildInput: '',
  TriageMaterialProbeBatch: '',
  TriageStructureInspectionInput: '',
  ProcurementTriageRuleSnapshot: '',
  StableProviderIdentity: 'providerId,providerObjectId,identityRevision,identityDigest',
  Standard: 'standardId,standardRevision,standardDigest',
  IntakeRejectionDecision: 'intakeDecisionId,decisionRevision,offerId,candidatePackageId,packageRevision,packageDigest,acceptanceBasisDigest,candidateDeliverySnapshotDigest,structuredRejection,decisionDigest',
  ArcaAcceptanceRejectionDecision: 'acceptanceDecisionId,acceptanceAttemptId,offerId,onDeckPackageId,packageDigest,shelfId,standardRevision,placementRevision,structuredRejection,decisionDigest,decidedAtMs',
  StructuredRejection: 'handoffKind,offerId,deliverableId,rejectionCode,acceptanceEvidenceSetDigest,rejectionDigest',
  TargetBindings: 'targetCommitSlotId,bindings,bindingSetDigest',
  TargetEndpoint: 'endpointId,mountScopeRevision,capacityObservationDigest',
  TypedManifest: 'manifest,contractRef,verificationDigest',
  VerifiedArtifactManifest: 'manifestDigest,artifactHandles,verificationId',
  VerifiedCareInventoryChange: 'aftercareCaseId,verifications,changeDigest',
  WorkspaceCleanupEffectIntent: '',
  WorkspaceCleanupCommitDecision: ''
};

function idField(name) {
  if (name.endsWith('Requirement')) return 'requirementId';
  if (name.endsWith('Intent')) return 'intentId';
  if (name.endsWith('Profile')) return 'profileId';
  if (name.endsWith('Policy')) return 'policyId';
  if (name.endsWith('Spec')) return 'specId';
  if (name.endsWith('Standard')) return 'standardId';
  if (name.endsWith('Contract')) return 'contractId';
  if (name.endsWith('Scope')) return 'scopeId';
  if (name.endsWith('Parameters')) return 'parameterSetId';
  if (name.endsWith('Variant')) return 'variantId';
  return 'contractId';
}

function buildSchema(name, role, fields) {
  if (name === 'CandidateDeliveryQuery') return candidateDeliveryQuerySchema();
  if (name === 'CandidateDeliveryReadResult') return candidateDeliveryReadResultSchema();
  if (name === 'CandidateDeliverySnapshot') return candidateDeliverySnapshotSchema();
  if (name === 'SubjectContinuityResolutionDecision') return subjectContinuityResolutionDecisionSchema();
  if (name === 'AcceptedIntakePayload') return acceptedIntakePayloadSchema();
  if (name === 'IntakeRejectionDecision') return intakeRejectionDecisionSchema();
  if (name === 'ArcaAcceptanceRejectionDecision') return arcaAcceptanceRejectionDecisionSchema();
  if (name === 'StructuredRejection') return structuredRejectionSchema();
  if (name === 'SelectedFieldMaterialSet') return selectedFieldMaterialSetSchema();
  if (name === 'CandidateDraft') return candidateDraftSchema();
  if (name === 'ProcurementTriageRuleSnapshot') return procurementTriageRuleSnapshotSchema();
  if (name === 'TriageMaterialProbeBatch') return triageMaterialProbeBatchSchema();
  if (name === 'TriageStructureInspectionInput') return triageStructureInspectionInputSchema();
  if (name === 'TriageIdentityResolutionInput') return triageIdentityResolutionInputSchema();
  if (name === 'TriageManifestBuildInput') return triageManifestBuildInputSchema();
  if (name === 'PeopleCandidateAcceptanceDecision') return peopleCandidateAcceptanceDecisionSchema();
  if (name === 'DirectPersonRegistrationDecision') return directPersonRegistrationDecisionSchema();
  if (name === 'PeopleReferenceMaintenanceDecision') return peopleReferenceMaintenanceDecisionSchema();
  if (name === 'PersonReferenceProjection') return personReferenceProjectionSchema();
  if (name === 'MetadataFetchIntent') return metadataFetchIntentSchema();
  if (name === 'MetadataObservationSet') return metadataObservationSetSchema();
  if (name === 'OnDeckPersonEvidenceProjectionItem') return onDeckPersonEvidenceProjectionItemSchema();
  if (name === 'PerceptionResolutionQuery') return perceptionResolutionQuerySchema();
  if (name === 'PerceptionResolutionRecordSet') return perceptionResolutionRecordSetSchema();
  if (name === 'PerceptionResolutionRuleSnapshot') return perceptionResolutionRuleSnapshotSchema();
  if (name === 'LibraDeliverablePromotionDecision') return libraDeliverablePromotionDecisionSchema();
  if (name === 'WorkspaceCleanupEffectIntent') return workspaceCleanupEffectIntentSchema();
  if (name === 'WorkspaceCleanupCommitDecision') return workspaceCleanupCommitDecisionSchema();
  const identityField = role === 'bounded-contract' ? idField(name) : 'objectId';
  const properties = {
    schemaRef: { const: domainTypeId(name) }, schemaVersion: { const: 1 }, [identityField]: id(), revision: positiveInteger(), digest: digest()
  };
  const required = Object.keys(properties);
  for (const fieldName of fields.split(',').filter(Boolean)) {
    if (Object.hasOwn(properties, fieldName)) continue;
    properties[fieldName] = inferredField(name, fieldName);
    required.push(fieldName);
  }
  if (role === 'bounded-contract') {
    properties.typedParameters = typedParameters(name);
    required.push('typedParameters');
  }
  return {
    $schema: DRAFT, $id: domainTypeId(name), title: `${name}@1`, 'x-helix-ssotRefs': ['8.6.20'], 'x-helix-role': role,
    ...object(properties, required)
  };
}

function selectedFieldMaterialSetSchema() {
  const controlSnapshot = object({
    materialKey: digest(), resultKind: { const: 'available' }, controlRevision: nonNegativeInteger(),
    controlState: enumText('uncontrolled', 'controlled'), ownerDomain: text(), ownerScopeType: text(),
    ownerScopeId: id(), regionProjection: enumText('uncontrolled', 'procurement'),
    evidenceDigest: digest(), projectionDigest: digest()
  }, ['materialKey', 'resultKind', 'controlRevision', 'controlState', 'regionProjection', 'evidenceDigest', 'projectionDigest']);
  const member = object({
    ordinal: nonNegativeInteger(), materialKey: digest(), selectionRole: { const: 'triage_input' },
    physicalIdentity: typeRef('PhysicalMaterialIdentity'), sizeBytes: nonNegativeInteger(),
    bindingRevision: positiveInteger(), eligibilityRevision: positiveInteger(), eligibilityBasisDigest: digest(),
    lastSnapshotDigest: digest(), lastObservationId: id(), endpointId: id(), location: text(), realityDigest: digest(),
    provenanceDigest: digest(), controlSnapshot, admissionControlAction: enumText('acquire', 'assert_same_field'),
    basisMemberDigest: digest()
  });
  return exactDomainSchema('SelectedFieldMaterialSet', {
    procurementRunId: id(), fieldId: id(), members: { ...arrayOf(member, 1024), minItems: 1 }, selectionDigest: digest()
  });
}

const profile = () => enumText('movie', 'series', 'jav', 'western_adult');
const mediaType = () => enumText('single', 'group');
const structureKind = () => enumText('single', 'season');
const episodeClaim = () => object({ episodeKey: text(), seasonClaimDigest: digest(), claimDigest: digest() });
const relatedReference = () => object({
  referenceId: id(), primaryMaterialKey: digest(), role: enumText('nfo', 'poster', 'fanart', 'subtitle', 'external_audio', 'chapter', 'sidecar'),
  identity: typeRef('PhysicalMaterialIdentity'), endpointId: id(), location: text(), checksumAlgorithm: { const: 'sha256' },
  checksumHex: digest(), associationEvidenceDigest: digest(), referenceDigest: digest()
});
const seasonContinuityClaim = () => typeRef('SeasonContinuityClaim');

function candidateDeliveryQuerySchema() {
  return { $schema:DRAFT, $id:domainTypeId('CandidateDeliveryQuery'), title:'CandidateDeliveryQuery@1',
    'x-helix-ssotRefs':['8.6.18'], 'x-helix-role':'accepted-business-dto', 'x-helix-maxCanonicalBytes':16 * 1024,
    ...object({ queryContract:{ const:'procurement.candidate-delivery@1' }, offerId:id(), candidatePackageId:id(),
      packageRevision:positiveInteger(), packageDigest:digest(), acceptanceBasisDigest:digest(), queryDigest:digest() }) };
}

function candidateDeliveryReadResultSchema() {
  const common = { queryDigest:digest(), resultKind:enumText('found', 'not_found'), resultDigest:digest() };
  return { $schema:DRAFT, $id:domainTypeId('CandidateDeliveryReadResult'), title:'CandidateDeliveryReadResult@1',
    'x-helix-ssotRefs':['8.6.18'], 'x-helix-role':'accepted-business-dto', oneOf:[
      object({ ...common, resultKind:{ const:'found' }, snapshot:domainRef('CandidateDeliverySnapshot') }),
      object({ ...common, resultKind:{ const:'not_found' }, reasonCode:{ const:'offer_not_found' } })
    ] };
}

function candidateDeliverySnapshotSchema() {
  const episode = object({ episodeKey: text(), seasonClaimDigest: digest(), claimDigest: digest() });
  const delivery = object({
    ordinal: nonNegativeInteger(), materialKey: digest(), role: enumText('primary_payload', 'structural_dependency'),
    physicalIdentity: typeRef('PhysicalMaterialIdentity'), sizeBytes: nonNegativeInteger(),
    bindingRevision: positiveInteger(), admittedControlRevision: positiveInteger(), admittedControlProjectionDigest: digest(),
    endpointId: id(), location: text(), lastSnapshotDigest: digest(), realityDigest: digest(), provenanceDigest: digest(),
    manifestMemberDigest: digest(), episodeClaims: arrayOf(episode, 32), deliveryMemberDigest: digest()
  });
  return { ...exactDomainSchema('CandidateDeliverySnapshot', {
    snapshotContract: { const: 'procurement.candidate-delivery@1' }, offer: typeRef('ProcurementCandidateOfferAvailableMessage'),
    acceptanceBasis: typeRef('CandidateIntakeAcceptanceBasis'), candidatePackage: typeRef('CandidatePackage'),
    primaryInputManifest: typeRef('PrimaryInputManifest'), primaryMaterialDeliveries: { ...arrayOf(delivery, 1024), minItems: 1 },
    deliveryMemberSetDigest: digest(), deliverySnapshotDigest: digest()
  }), 'x-helix-maxCanonicalBytes': 8 * 1024 * 1024 };
}

function subjectContinuityResolutionDecisionSchema() {
  const witness = object({
    ordinal: nonNegativeInteger(), subjectId: id(), expectedSubjectStatus: { const: 'active' },
    expectedSubjectIntakeRevision: positiveInteger(), expectedSubjectContinuitySetDigest: digest(),
    expectedSubjectEpisodeScopeDigest: digest(), claimKind: enumText('provider_season_identity', 'triage_grouping_lineage'),
    claimNamespace: text(), claimKey: text(), candidateClaimDigest: digest(), subjectClaimDigest: digest(),
    subjectClaimProvenanceKind: enumText('candidate', 'resolved_identity'), subjectClaimProvenanceRef: id(), witnessDigest: digest()
  });
  const properties = {
    decisionId: id(), offerId: id(), candidatePackageId: id(), packageRevision: positiveInteger(), packageDigest: digest(),
    candidateDeliverySnapshotDigest: digest(), expectedContinuityHead: object({ revision: nonNegativeInteger(), digest: digest() }),
    candidateContinuityClaims: arrayOf(typeRef('SeasonContinuityClaim'), 64), candidateContinuitySetDigest: digest(),
    candidateEpisodeScope: object({ structureKind: enumText('single', 'season'), episodeKeys: arrayOf(text(), 32768), episodeScopeDigest: digest() }),
    matchCardinality: enumText('none', 'one', 'multiple'), matchWitnesses: arrayOf(witness, 2), matchedSubjectSetDigest: digest(),
    overlapEvaluation: enumText('not_applicable_no_match', 'not_applicable_multiple', 'evaluated'),
    overlappingEpisodeKeys: arrayOf(text(), 32768), episodeOverlapDigest: digest(), result: enumText('new_subject', 'season_extension'),
    allocatedSubjectId: id(), targetSubjectId: id(), expectedTargetStatus: { const: 'active' },
    expectedTargetIntakeRevision: positiveInteger(), expectedTargetContinuitySetDigest: digest(),
    expectedTargetEpisodeScopeDigest: digest(), decisionDigest: digest()
  };
  const required = Object.keys(properties).filter((key) => !['allocatedSubjectId', 'targetSubjectId', 'expectedTargetStatus',
    'expectedTargetIntakeRevision', 'expectedTargetContinuitySetDigest', 'expectedTargetEpisodeScopeDigest'].includes(key));
  return { ...exactDomainSchema('SubjectContinuityResolutionDecision', properties, required), 'x-helix-maxCanonicalBytes': 128 * 1024 };
}

const intakeRejectionCode = () => enumText('candidate_contract_invalid', 'candidate_material_identity_changed',
  'candidate_material_unavailable', 'candidate_material_unreadable', 'candidate_control_scope_unavailable');

function intakeStructuredRejectionValueSchema() {
  const evidenceRef = object({ evidenceSchemaRef: text(), evidenceId: id(), evidenceDigest: digest() });
  const reason = object({ reasonCode: intakeRejectionCode(), evidenceRefs: { ...arrayOf(evidenceRef, 32), minItems: 1 }, reasonDigest: digest() });
  return object({
    rejectionId: digest(), handoffKind: { const: 'procurement_to_libra' }, offerId: id(), deliverableId: id(),
    deliverableRevision: positiveInteger(), deliverableDigest: digest(), decisionBasisDigest: digest(), observedSnapshotDigest: digest(),
    reasonCodes: { ...arrayOf(intakeRejectionCode(), 32), minItems: 1 }, primaryRejectionCode: intakeRejectionCode(),
    reasons: { ...arrayOf(reason, 32), minItems: 1 }, rejectionReasonSetDigest: digest(), rejectionDigest: digest(),
    decidedAtMs: nonNegativeInteger()
  });
}

function intakeRejectionDecisionSchema() {
  return { ...exactDomainSchema('IntakeRejectionDecision', {
    intakeDecisionId: digest(), decisionRevision: { const: 1 }, offerId: id(), candidatePackageId: id(),
    packageRevision: positiveInteger(), packageDigest: digest(), acceptanceBasisDigest: digest(),
    candidateDeliverySnapshotDigest: digest(), structuredRejection: intakeStructuredRejectionValueSchema(), decisionDigest: digest()
  }), 'x-helix-maxCanonicalBytes': 128 * 1024 };
}

function structuredRejectionSchema() {
  return { ...exactDomainSchema('StructuredRejection', {
    handoffKind: { const: 'libra_to_arca' }, offerId: id(), deliverableId: id(), rejectionCode: text(),
    acceptanceEvidenceSetDigest: digest(), rejectionDigest: digest()
  }), 'x-helix-maxCanonicalBytes': 16 * 1024 };
}

function arcaAcceptanceRejectionDecisionSchema() {
  return { ...exactDomainSchema('ArcaAcceptanceRejectionDecision', {
    acceptanceDecisionId: digest(), acceptanceAttemptId: id(), offerId: id(), onDeckPackageId: id(), packageDigest: digest(),
    shelfId: id(), standardRevision: positiveInteger(), placementRevision: positiveInteger(),
    structuredRejection: domainRef('StructuredRejection'), decisionDigest: digest(), decidedAtMs: nonNegativeInteger()
  }), 'x-helix-maxCanonicalBytes': 32 * 1024 };
}

function acceptedIntakePayloadSchema() {
  const delivery = object({ offerId: id(), candidatePackageId: id(), packageRevision: positiveInteger(), packageDigest: digest(),
    acceptanceBasisDigest: digest(), candidateDeliverySnapshotDigest: digest() });
  const item = object({ materialKey: digest(), expectedControlRevision: nonNegativeInteger(), expectedControlProjectionDigest: digest(),
    toOwnerDomain: { const: 'libra' }, toOwnerScopeType: { const: 'subject' }, toOwnerScopeId: id() });
  return exactDomainSchema('AcceptedIntakePayload', {
    intakeDecisionId: id(), decisionRevision: { const: 1 }, delivery,
    candidateVerification: typeRef('CandidateContractVerification'), materialVerification: typeRef('IntakeMaterialVerification'),
    resolutionDecision: domainRef('SubjectContinuityResolutionDecision'), bindingDraft: typeRef('LibraBindingDraft'),
    controlTransferScope: object({ fieldId: id(), fromOwnerDomain: { const: 'procurement' },
      fromOwnerScopeType: { const: 'material_field' }, fromOwnerScopeId: id(), items: { ...arrayOf(item, 1024), minItems: 1 },
      controlScopeDigest: digest() }), payloadDigest: digest()
  });
}
const identityMetadata = () => object({
  claimedTitle: text(), claimedYear: positiveInteger(),
  seasonClaim: object({ claimKind: enumText('explicit_number', 'provisional_group'), seasonNumber: positiveInteger(),
    provisionalGroupKey: digest(), claimDigest: digest() }, ['claimKind', 'claimDigest']),
  javCode: text(), contentProfileHint: enumText('movie', 'series', 'jav', 'western_adult', 'mixed'),
  sourceHints: arrayOf(object({ hintKind: enumText('field_content_profile_hint', 'filename_title', 'directory_title', 'filename_year',
    'directory_year', 'filename_season', 'directory_season', 'filename_episode', 'jav_code', 'disc_structure', 'temporary_label'),
  hintValue: text(), evidenceDigest: digest() }), 256), metadataDigest: digest()
}, ['claimedTitle', 'contentProfileHint', 'sourceHints', 'metadataDigest']);
const triageUnit = () => object({
  unitId: digest(), mediaType: mediaType(), contentProfile: profile(), structureKind: structureKind(), displayIdentity: text(),
  identityMetadata: identityMetadata(), seasonContinuityClaims: arrayOf(seasonContinuityClaim(), 64),
  seasonContinuityClaimSetDigest: digest(),
  members: { ...arrayOf(object({ materialKey: digest(), bindingRevision: positiveInteger(), admittedControlRevision: positiveInteger(),
    admittedControlProjectionDigest: digest(), role: enumText('primary_payload', 'structural_dependency'),
    episodeClaims: arrayOf(episodeClaim(), 32), memberClaimDigest: digest() }), 1024), minItems: 1 },
  relatedReferences: arrayOf(relatedReference(), 1024), unitDigest: digest()
});

function procurementTriageRuleSnapshotSchema() {
  const rulePayload = object({
    contractRefs: arrayOf(text(), 32), recallPriority: { const: true }, maxPrimaryMaterials: { const: 1024 },
    probeBatchSize: { const: 100 }, playabilityRule: object({ minimumDurationMs: { const: 1 }, minimumVideoStreamCount: { const: 1 },
      reasonPrecedence: { const: ['probe_not_media', 'no_video_stream', 'non_positive_duration'] } }),
    profileResolutionRule: object({ mixedPrecedence: { const: ['series_episode_token', 'jav_code', 'movie_fallback'] },
      westernAdultRequiresExplicitHint: { const: true } }), structureRule: object({ maxUnitCanonicalBytes: { const: 65536 } }),
    identityRule: object({ claimKinds: { const: ['movie_title', 'series_season', 'jav_code', 'western_temporary'] } }),
    manifestRule: object({ minimumMembers: { const: 1 }, maximumMembers: { const: 1024 }, firstOrdinal: { const: 0 } })
  });
  return exactDomainSchema('ProcurementTriageRuleSnapshot', { ruleRef: id(), revision: positiveInteger(),
    ruleSchemaRef: { const: 'procurement.triage-rule.beta@1' }, rulePayload, ruleDigest: digest(), authorityDigest: digest() });
}

function triageMaterialProbeBatchSchema() {
  const member = object({ selectionOrdinal: nonNegativeInteger(), materialKey: digest(), bindingRevision: positiveInteger(),
    admittedControlRevision: positiveInteger(), admittedControlProjectionDigest: digest(), readHandle: typeRef('PhysicalMaterialReadHandle'),
    mediaProbe: typeRef('MediaProbeEvidence'), memberDigest: digest() });
  return exactDomainSchema('TriageMaterialProbeBatch', { procurementRunId: id(), runBasisDigest: digest(), selectionDigest: digest(),
    batchOrdinal: nonNegativeInteger(), members: { ...arrayOf(member, 100), minItems: 1 }, batchDigest: digest() });
}

function materialFieldContextSchema() {
  return object({ fieldId: id(), accessRevision: positiveInteger(), accessDigest: digest(),
    contentProfileHint: enumText('movie', 'series', 'jav', 'western_adult', 'mixed'),
    memberContexts: { ...arrayOf(object({ selectionOrdinal: nonNegativeInteger(), materialKey: digest(), fieldRelativeLocation: text(),
      baseName: text(), extension: text(), parentSegments: arrayOf(text(), 32), layoutEvidenceRefs: arrayOf(object({ evidenceId: id(),
      payloadDigest: digest(), boundedScopeDigest: digest() }), 16) }), 1024), minItems: 1 }, contextDigest: digest() });
}

function triageStructureInspectionInputSchema() {
  return exactDomainSchema('TriageStructureInspectionInput', { selectedFieldMaterialSet: domainRef('SelectedFieldMaterialSet'),
    probeBatches: { ...arrayOf(domainRef('TriageMaterialProbeBatch'), 11), minItems: 1 },
    playabilityPages: { ...arrayOf(typeRef('PlayabilityEvidence'), 11), minItems: 1 }, materialFieldContext: materialFieldContextSchema(),
    layoutEvidence: arrayOf(typeRef('LayoutEvidence'), 1024), pageRequest: object({ pageOrdinal: nonNegativeInteger(),
      cursorIn: { anyOf: [text(), { type: 'null' }] }, maxUnits: { type: 'integer', minimum: 1, maximum: 100 }, requestDigest: digest() }),
    inputDigest: digest() });
}

function triageIdentityResolutionInputSchema() {
  return exactDomainSchema('TriageIdentityResolutionInput', { procurementRunId: id(), runBasisDigest: digest(),
    triageRuleAuthorityDigest: digest(), structureEvidenceId: id(), structureEvidencePayloadDigest: digest(), unit: triageUnit(), inputDigest: digest() });
}

function triageManifestBuildInputSchema() {
  return exactDomainSchema('TriageManifestBuildInput', { procurementRunId: id(), runBasisDigest: digest(), triageRuleAuthorityDigest: digest(),
    selectedFieldMaterialSet: domainRef('SelectedFieldMaterialSet'), structureEvidenceId: id(), structureEvidencePayloadDigest: digest(),
    unit: triageUnit(), preallocatedManifestId: id(), inputDigest: digest() });
}

function candidateDraftSchema() {
  return exactDomainSchema('CandidateDraft', { draftId: id(), draftKind: text(), basisDigest: digest(), draftDigest: digest(),
    producedAtMs: nonNegativeInteger(), candidatePackageId: id(), expectedPackageRevision: positiveInteger(), procurementRunId: id(),
    runBasisDigest: digest(), triageRule: object({ ruleRef: id(), revision: positiveInteger(), authorityDigest: digest() }),
    materialFieldContextRef: object({ fieldId: id(), accessRevision: positiveInteger(), contextDigest: digest() }),
    mediaType: mediaType(), contentProfile: profile(), displayIdentity: text(), identityMetadata: identityMetadata(),
    identityClaim: typeRef('IdentityClaim'), structureEvidence: object({ evidenceId: id(), payloadDigest: digest(), unit: triageUnit() }),
    primaryInputManifestDraft: typeRef('PrimaryInputManifestDraft'), seasonContinuityClaims: arrayOf(seasonContinuityClaim(), 64),
    seasonContinuityClaimSetDigest: digest(), relatedReferences: arrayOf(relatedReference(), 1024),
    relatedReferenceSetDigest: digest(), memberControlEvidenceSetDigest: digest(), candidateDraftDigest: digest()
  });
}

const identityAnchor = () => object({
  anchorKind: text(), anchorValue: text(), confidenceClass: text(), evidenceDigest: digest()
});

function exactDomainSchema(name, properties, required = Object.keys(properties), options = {}) {
  return {
    $schema: DRAFT, $id: domainTypeId(name), title: `${name}@1`,
    'x-helix-ssotRefs': ['8.6.13', '8.6.18', '8.6.20'], 'x-helix-role': 'accepted-business-dto',
    ...object(properties, required, options)
  };
}

function perceptionResolutionQuerySchema() {
  return exactDomainSchema('PerceptionResolutionQuery', {
    queryContract: text(), queryVersion: positiveInteger(), querySchemaRef: text(),
    factKind: enumText('rating', 'watched'), identityEvidence: arrayOf(identityAnchor(), 16), queryInputDigest: digest()
  });
}

function perceptionResolutionRecordSetSchema() {
  const facts = object({
    rating: { type: 'integer', minimum: 1, maximum: 5 }, watchedState: bool()
  }, [], { minProperties: 1 });
  const record = object({
    perceptionId: id(), recordKind: enumText('observation', 'correction', 'retraction'), sourceKind: text(),
    sourceRecordKey: text(), sourceRecordRevision: positiveInteger(), recordDigest: digest(), facts,
    observedTitle: text(), observedAtMs: nonNegativeInteger(), identityAnchors: arrayOf(identityAnchor(), 16),
    provenanceRef: id(), provenanceDigest: digest()
  });
  const relation = object({
    relationId: id(), relationKind: enumText('duplicate_of', 'supersedes', 'retracts'),
    sourcePerceptionId: id(), targetPerceptionId: id(), ruleRevision: positiveInteger(), evidenceDigest: digest()
  });
  return exactDomainSchema('PerceptionResolutionRecordSet', {
    queryInputDigest: digest(), records: arrayOf(record, 256), relations: arrayOf(relation, 1024), recordSetDigest: digest()
  });
}

function optionalThresholdRule(fuzzyValue) {
  return {
    if: { properties: { matchMode: { const: fuzzyValue } }, required: ['matchMode'] },
    then: { required: ['threshold'] }, else: { not: { required: ['threshold'] } }
  };
}

function perceptionResolutionRuleSnapshotSchema() {
  const retrieval = object({
    anchorKind: text(), lookupMode: enumText('exact', 'normalized_exact', 'bounded_fuzzy'),
    normalizationProfileRef: text(), threshold: { type: 'number', minimum: 0, maximum: 1 }, maxCandidates: positiveInteger()
  }, ['anchorKind', 'lookupMode', 'maxCandidates'], { allOf: [{
    if: { properties: { lookupMode: { const: 'bounded_fuzzy' } }, required: ['lookupMode'] },
    then: { required: ['threshold'] }, else: { not: { required: ['threshold'] } }
  }] });
  const matcher = object({
    anchorKind: text(), matchMode: enumText('exact', 'normalized_exact', 'fuzzy'), normalizationProfileRef: text(),
    strengthRank: positiveInteger(), minConfidenceClass: text(), threshold: { type: 'number', minimum: 0, maximum: 1 }
  }, ['anchorKind', 'matchMode', 'strengthRank', 'minConfidenceClass'], { allOf: [optionalThresholdRule('fuzzy')] });
  const duplicateProof = object({
    anchorKind: text(), matchMode: { const: 'exact' }, minConfidenceClass: text(), requireSameAnchorValue: { const: true },
    requireSameFactKind: { const: true }, requireSameCanonicalValue: { const: true }
  });
  return exactDomainSchema('PerceptionResolutionRuleSnapshot', {
    ruleContract: text(), ruleVersion: positiveInteger(), supportedFactKinds: arrayOf(enumText('rating', 'watched'), 2),
    candidateRetrievalClauses: arrayOf(retrieval, 32), anchorMatchers: arrayOf(matcher, 32),
    winnerOrder: { const: 'strongest_anchor_then_value_consensus_then_perception_id' },
    equalStrengthConflict: { const: 'not_found' }, duplicateProofMatchers: arrayOf(duplicateProof, 32),
    maxCandidateRecords: { const: 256 }, ruleDigest: digest()
  });
}

function peopleCandidateAcceptanceDecisionSchema() {
  const common = {
    decisionId: id(), candidateKind: enumText('registration', 'merge'), candidateId: id(),
    expectedCandidateRevision: positiveInteger(), candidatePayloadDigest: digest(),
    decisionOrigin: enumText('user', 'strong_identity_rule'), actorId: id(), ruleRevision: positiveInteger(), decisionDigest: digest()
  };
  const originRule = { oneOf: [
    { properties: { decisionOrigin: { const: 'user' } }, required: ['actorId'], not: { required: ['ruleRevision'] } },
    { properties: { decisionOrigin: { const: 'strong_identity_rule' } }, required: ['ruleRevision'], not: { required: ['actorId'] } }
  ] };
  const commonRequired = ['decisionId', 'candidateKind', 'candidateId', 'expectedCandidateRevision',
    'candidatePayloadDigest', 'decisionOrigin', 'decisionDigest'];
  const registration = object(
    { ...common, candidateKind: { const: 'registration' }, newPersonId: id() },
    [...commonRequired, 'newPersonId'], { allOf: [originRule] }
  );
  const nullableRevision = { anyOf: [{ type: 'null' }, positiveInteger()] };
  const merge = object({
    ...common, candidateKind: { const: 'merge' }, sourcePersonId: id(), targetPersonId: id(),
    expectedSourcePersonRevision: positiveInteger(), expectedTargetPersonRevision: positiveInteger(),
    expectedSourcePreferenceRevision: nullableRevision, expectedTargetPreferenceRevision: nullableRevision,
    preferenceResolution: enumText('keep_source', 'keep_target', 'set_explicit'),
    explicitPreferenceLevel: { type: 'integer', minimum: -2, maximum: 2 }
  }, [...commonRequired, 'sourcePersonId', 'targetPersonId', 'expectedSourcePersonRevision',
    'expectedTargetPersonRevision', 'expectedSourcePreferenceRevision', 'expectedTargetPreferenceRevision',
    'preferenceResolution'], { allOf: [originRule, {
    if: { properties: { preferenceResolution: { const: 'set_explicit' } }, required: ['preferenceResolution'] },
    then: { required: ['explicitPreferenceLevel'] }, else: { not: { required: ['explicitPreferenceLevel'] } }
  }] });
  return {
    $schema: DRAFT, $id: domainTypeId('PeopleCandidateAcceptanceDecision'),
    title: 'PeopleCandidateAcceptanceDecision@1', 'x-helix-ssotRefs': ['8.6.18', '8.6.20'],
    'x-helix-role': 'accepted-business-dto', oneOf: [registration, merge]
  };
}

const aliasSchema = () => object({ aliasDisplay: text({ maxLength: 1024 }), aliasNormalized: text({ maxLength: 1024 }), provenanceDigest: digest() });
const providerIdentitySchema = () => object({ provider: text({ maxLength: 128 }), namespace: text({ maxLength: 256 }),
  providerKey: text({ maxLength: 2048 }), provenanceDigest: digest() });

function directPersonRegistrationDecisionSchema() {
  return exactDomainSchema('DirectPersonRegistrationDecision', {
    decisionId: id(), newPersonId: id(), canonicalName: text({ maxLength: 1024 }), aliases: arrayOf(aliasSchema(), 256),
    providerIdentities: arrayOf(providerIdentitySchema(), 256), actorId: id(), decisionDigest: digest()
  });
}

function peopleReferenceMaintenanceDecisionSchema() {
  const common = { decisionId: id(), operationKind: enumText('add_image', 'release_image'), personId: id(),
    expectedPersonRevision: positiveInteger(), expectedReferenceRevision: nonNegativeInteger(), actorId: id(), decisionDigest: digest() };
  const commonRequired = Object.keys(common);
  const add = object({ ...common, operationKind: { const: 'add_image' }, referenceAssetId: id(), referenceFaceId: id(),
    artifactHandle: typeRef('ArtifactHandle'), artifactDigest: digest(), faceEmbeddingSetHandle: typeRef('FaceEmbeddingSetHandle'),
    modelRef: text({ maxLength: 512 }), initialState: { const: 'active' }
  }, [...commonRequired, 'referenceAssetId', 'referenceFaceId', 'artifactHandle', 'artifactDigest', 'faceEmbeddingSetHandle', 'modelRef', 'initialState']);
  const release = object({ ...common, operationKind: { const: 'release_image' }, referenceAssetId: id(), referenceFaceId: id(),
    expectedAssetState: { const: 'active' }, expectedFaceState: { const: 'active' }, terminalState: { const: 'released' },
    artifactDigest: digest(), embeddingDigest: digest(), modelRef: text({ maxLength: 512 })
  }, [...commonRequired, 'referenceAssetId', 'referenceFaceId', 'expectedAssetState', 'expectedFaceState', 'terminalState',
    'artifactDigest', 'embeddingDigest', 'modelRef']);
  return { $schema: DRAFT, $id: domainTypeId('PeopleReferenceMaintenanceDecision'), title: 'PeopleReferenceMaintenanceDecision@1',
    'x-helix-ssotRefs': ['8.6.18', '8.6.20'], 'x-helix-role': 'accepted-business-dto', oneOf: [add, release] };
}

function personReferenceProjectionSchema() {
  const asset = object({ referenceAssetId: id(), artifactHandleId: id(), artifactDigest: digest() });
  const face = object({ referenceFaceId: id(), referenceAssetId: id(), embeddingHandleId: id(), embeddingDigest: digest(),
    modelRef: text({ maxLength: 512 }) });
  const contribution = object({ ownerPersonId: id(), ownerReferenceRevision: positiveInteger(), referenceSetDigest: digest(),
    inheritedReadOnly: bool(), activeAssets: arrayOf(asset, 1024), activeFaces: arrayOf(face, 1024) });
  return exactDomainSchema('PersonReferenceProjection', {
    projectionContract: { const: 'people.person-reference-projection@1' }, projectionRevision: positiveInteger(), personId: id(),
    personRevision: positiveInteger(), currentReferenceRevision: { anyOf: [{ type: 'null' }, positiveInteger()] },
    contributions: arrayOf(contribution, 4096), projectionDigest: digest()
  });
}

function metadataFetchIntentSchema() {
  const common = { intentId: id(), sourceKind: enumText('related_nfo', 'provider'),
    contentProfile: enumText('movie', 'series', 'jav', 'western_adult'), resolvedIdentityDigest: digest(),
    requestedFields: arrayOf(text({ maxLength: 128 }), 256), intentDigest: digest() };
  return { $schema: DRAFT, $id: domainTypeId('MetadataFetchIntent'), title: 'MetadataFetchIntent@1',
    'x-helix-ssotRefs': ['8.6.18', '8.6.20'], 'x-helix-role': 'accepted-business-dto', oneOf: [
      object({ ...common, sourceKind: { const: 'related_nfo' }, relatedReferenceId: id(), relatedReferenceDigest: digest(), expectedChecksum: digest() },
        [...Object.keys(common), 'relatedReferenceId', 'relatedReferenceDigest', 'expectedChecksum']),
      object({ ...common, sourceKind: { const: 'provider' }, providerKind: enumText('tmdb', 'jav'), integrationId: id(), configRevision: positiveInteger() },
        [...Object.keys(common), 'providerKind', 'integrationId', 'configRevision'])
    ] };
}

function metadataObservationSetSchema() {
  return exactDomainSchema('MetadataObservationSet', { setId: id(),
    contentProfile: enumText('movie', 'series', 'jav', 'western_adult'), resolvedIdentityDigest: digest(),
    observations: arrayOf(typeRef('MetadataObservation'), 16), sourcePrecedence: arrayOf(text({ maxLength: 128 }), 16), setDigest: digest() });
}

function onDeckPersonEvidenceProjectionItemSchema() {
  return exactDomainSchema('OnDeckPersonEvidenceProjectionItem', { projectionItemId: id(), shelfEntryId: id(),
    inventoryRevision: positiveInteger(), relationId: id(), relationDigest: digest(), displayName: text({ maxLength: 1024 }),
    displayNameNormalized: text({ maxLength: 1024 }), role: text({ maxLength: 256 }),
    providerIdentities: arrayOf(providerIdentitySchema(), 128), originEvidenceDigest: digest(), nfoObservationDigest: digest(),
    projectionRevision: positiveInteger(), projectionItemDigest: digest() });
}

function libraDeliverablePromotionDecisionSchema() {
  const episodeClaim = object({ episodeKey: text(), seasonClaimDigest: digest(), claimDigest: digest() });
  const typedFactValue = object({ schemaRef: text(), recordDigest: digest(), entries: arrayOf(object({ key: text(), valueDigest: digest() }), 256) });
  const productFactItem = object({ productFactId: id(), factKind: enumText('resolved_identity', 'media_cast', 'product_metadata', 'media_conformance'),
    factRevision: positiveInteger(), schemaRef: text(), factValue: typedFactValue, factDigest: digest(), evidenceDigest: digest(), referenceDigest: digest() });
  const productFactManifest = object({ manifestId: id(), manifestRevision: positiveInteger(), libraRunId: id(),
    items: { ...arrayOf(productFactItem, 256), minItems: 1 }, factSetDigest: digest(), manifestDigest: digest() });
  const artifactItem = object({ artifactHandleId: id(), artifactKind: text(), artifactRevision: positiveInteger(), artifactDigest: digest(),
    requirementDigest: digest(), materializationState: enumText('workspace_only', 'included_product'), referenceDigest: digest() });
  const artifactManifest = object({ manifestId: id(), manifestRevision: positiveInteger(), libraRunId: id(),
    items: arrayOf(artifactItem, 256), artifactSetDigest: digest(), manifestDigest: digest() });
  const materialMember = object({ ordinal: nonNegativeInteger(), materialKey: digest(),
    role: enumText('primary_payload', 'structural_dependency', 'metadata_sidecar', 'poster', 'fanart', 'subtitle', 'external_audio', 'chapter'),
    physicalIdentity: typeRef('PhysicalMaterialIdentity'), locationKind: enumText('domain_binding', 'workspace_handle'), endpointId: id(),
    location: nullable(text()), rootHandleRef: nullable(id()), relativePath: nullable(text()),
    bindingKind: enumText('libra_material_binding', 'workspace_material_reference'), bindingRevision: positiveInteger(),
    bindingEvidenceDigest: digest(), episodeClaims: arrayOf(episodeClaim, 32), episodeClaimSetDigest: digest(),
    outputRequirementDigest: digest(), controlOperation: enumText('assert_existing_input', 'acquire_workspace_product'),
    expectedControlRevision: nullable(nonNegativeInteger()), expectedControlProjectionDigest: nullable(digest()), memberDigest: digest() });
  const productMaterialManifest = object({ manifestId: id(), manifestRole: { const: 'product_delivery' }, manifestRevision: positiveInteger(),
    libraRunId: id(), members: { ...arrayOf(materialMember, 1024), minItems: 1 }, memberSetDigest: digest(), episodeScopeDigest: digest(), manifestDigest: digest() });
  const offloadMember = object({ ordinal: nonNegativeInteger(), materialKey: digest(), contextRole: enumText('original_input', 'structural_dependency'),
    physicalIdentity: typeRef('PhysicalMaterialIdentity'), location: text(), bindingRevision: positiveInteger(), bindingEvidenceDigest: digest(),
    admittedControlRevision: positiveInteger(), admittedControlProjectionDigest: digest(),
    settlementExpectation: enumText('retain', 'replace_or_move', 'remove_after_place'), memberDigest: digest() });
  const offloadManifest = object({ manifestId: id(), manifestRevision: positiveInteger(), libraRunId: id(),
    members: arrayOf(offloadMember, 1024), memberSetDigest: digest(), manifestDigest: digest() });
  const workspaceReference = object({ referenceId: id(), workspaceId: id(), libraRunId: id(), materialHandleId: id(), materialKey: digest(),
    workspaceMaterialHandle: typeRef('WorkspaceMaterialHandle'), workspaceHandleDigest: digest(), referenceRevision: positiveInteger(),
    state: { const: 'product_staging' }, episodeClaims: arrayOf(episodeClaim, 32), episodeScopeDigest: digest(),
    productVerificationRef: object({ id: id(), digest: digest() }), previousReferenceRevision: positiveInteger(),
    committedWorkspaceRevision: positiveInteger(), referenceDigest: digest() });
  const assertControl = object({ controlOperation: { const: 'assert_existing_input' }, materialKey: digest(),
    expectedControlRevision: positiveInteger(), expectedControlProjectionDigest: digest(), ownerDomain: { const: 'libra' },
    ownerScopeType: { const: 'subject' }, ownerScopeId: id() });
  const acquireControl = object({ controlOperation: { const: 'acquire_workspace_product' }, materialKey: digest(),
    expectedControlState: { const: 'absent' }, toOwnerDomain: { const: 'libra' },
    toOwnerScopeType: { const: 'on_deck_package' }, toOwnerScopeId: id() });
  const properties = {
    decisionId: id(), libraRunRef: object({ libraRunId: id(), stateRevision: positiveInteger(), stateDigest: digest(),
      executionBasisDigest: digest(), runScopeDigest: digest(), expectedPackageRevisionHead: nonNegativeInteger() }),
    runMaterialManifestRef: object({ manifestId: id(), manifestDigest: digest() }),
    workspaceRef: nullable(object({ workspaceId: id(), workspaceRevision: positiveInteger(), workspaceStateDigest: digest() })),
    productStagingReferences: arrayOf(workspaceReference, 1024),
    acceptanceSpecRef: object({ acceptanceSpecId: id(), recordDigest: digest() }),
    resolvedIdentitySnapshot: object({ productFactId: id(), factRevision: positiveInteger(), schemaRef: text(), factValue: typedFactValue,
      factDigest: digest(), evidenceDigest: digest() }),
    productStructureSnapshot: object({ structureKind: enumText('single', 'season'), contentProfile: enumText('movie', 'series', 'jav', 'western_adult'),
      productScopeDigest: digest(), episodeScopeDigest: digest(), primaryMaterialCount: positiveInteger(),
      structuralDependencyCount: nonNegativeInteger(), productStructureDigest: digest() }),
    productFactManifest, artifactManifest,
    mediaCastSnapshot: object({ mediaCastFactId: id(), mediaCastFactRevision: positiveInteger(), schemaRef: text(), factValue: typedFactValue,
      factDigest: digest(), evidenceDigest: digest(), relations: arrayOf(object({ relationId: id(), displayName: text(), role: text(), relationDigest: digest() }), 4096),
      relationsDigest: digest() }),
    productMaterialManifest, offloadContextManifest: offloadManifest,
    productionProvenance: object({ libraRunId: id(), runExecutionBasisDigest: digest(), acceptanceSpecRecordDigest: digest(),
      workflowPlanRefs: arrayOf(object({ planId: id(), planRevision: positiveInteger(), planDigest: digest() }), 256),
      productVerificationRefs: arrayOf(object({ verificationId: id(), verificationDigest: digest() }), 256),
      externalRealityObservationRefs: arrayOf(object({ evidenceId: id(), evidenceDigest: digest() }), 256), provenanceDigest: digest() }),
    productionAttestation: object({ attestationId: id(), libraRunId: id(), onDeckPackageId: id(), acceptanceSpecId: id(),
      productConformanceEvidenceId: id(), productConformanceEvidenceDigest: digest(), unmetRequirementCount: { const: 0 },
      attestedAtMs: nonNegativeInteger(), attestationDigest: digest() }),
    controlCommitScope: object({ items: { ...arrayOf({ oneOf: [assertControl, acquireControl] }, 1024), minItems: 1 }, controlScopeDigest: digest() }),
    onDeckPackageId: id(), packageRevision: positiveInteger(), packageDigest: digest(), offerId: id(), decisionDigest: digest()
  };
  return { $schema: DRAFT, $id: domainTypeId('LibraDeliverablePromotionDecision'), title: 'LibraDeliverablePromotionDecision@1',
    'x-helix-ssotRefs': ['8.6.20', '8.6.21'], 'x-helix-role': 'accepted-business-dto',
    'x-helix-maxCanonicalBytes': 16 * 1024 * 1024, ...object(properties) };
}

function workspaceCleanupEffectIntentSchema() {
  const controlFence = object({ controlDisposition: enumText('uncontrolled', 'libra_owned', 'other_owned'),
    expectedControlRevision: nonNegativeInteger(), expectedControlProjectionDigest: digest(),
    expectedControlOwnerDomain: nullable(text()), expectedControlOwnerScopeType: nullable(text()), expectedControlOwnerScopeId: nullable(id()) });
  return exactDomainSchema('WorkspaceCleanupEffectIntent', { intentId: id(), cleanupScopeId: id(), workspaceId: id(),
    materialHandleId: id(), expectedWorkspaceHandleDigest: digest(), expectedReferenceRevision: positiveInteger(),
    expectedReferenceDigest: digest(), controlFence, effectMode: enumText('delete_or_verify_absent', 'verify_absent_only'),
    containmentFenceDigest: digest(), idempotencyKey: id(), intentDigest: digest() });
}

function workspaceCleanupCommitDecisionSchema() {
  const deletionEvidence = object({ evidenceId: id(), evidenceKind: { const: 'workspace_material_deletion' }, effectId: id(),
    cleanupScopeId: id(), materialHandleId: id(), preDeleteHandleDigest: digest(), result: enumText('deleted', 'already_absent'),
    postDeleteContainmentProbeDigest: digest(), effectReceiptId: id(), evidenceDigest: digest() });
  const blockingEvidence = object({ evidenceId: id(), evidenceKind: { const: 'workspace_cleanup_blocking' }, cleanupScopeId: id(),
    materialHandleId: id(), terminalFailureCode: enumText('workspace_path_escaped', 'identity_mismatch', 'control_conflict', 'effect_retry_exhausted'),
    lastEffectId: nullable(id()), lastEffectFailureDigest: nullable(digest()), observedFenceDigest: digest(), evidenceDigest: digest() });
  const outcome = { oneOf: [
    object({ kind: { const: 'deletion_verified' }, deletionEvidence }),
    object({ kind: { const: 'terminal_blocked' }, blockingEvidence })
  ] };
  return exactDomainSchema('WorkspaceCleanupCommitDecision', { decisionId: id(), cleanupScopeId: id(),
    expectedScopeStateRevision: positiveInteger(), expectedScopeStateDigest: digest(), workspaceId: id(),
    expectedWorkspaceRevision: positiveInteger(), expectedWorkspaceStateDigest: digest(), materialHandleId: id(),
    expectedReferenceRevision: positiveInteger(), expectedReferenceDigest: digest(), expectedMemberStateRevision: positiveInteger(),
    expectedMemberStateDigest: digest(), outcome,
    expectedControlFence: object({ materialKey: digest(), controlDisposition: enumText('uncontrolled', 'libra_owned', 'other_owned'),
      revision: nonNegativeInteger(), projectionDigest: digest(), ownerDomain: nullable(text()), ownerScopeType: nullable(text()), ownerScopeId: nullable(id()) }),
    decisionDigest: digest() });
}

function buildDomainInputSchemas() {
  const schemas = {};
  for (const [name, fields] of Object.entries(boundedContracts)) schemas[name] = buildSchema(name, 'bounded-contract', fields);
  for (const [name, fields] of Object.entries(dtoContracts)) {
    if (schemas[name]) throw new Error(`Duplicate domain input contract: ${name}`);
    schemas[name] = buildSchema(name, 'accepted-business-dto', fields);
  }
  return schemas;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
  return value;
}

function schemaDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

module.exports = Object.freeze({ buildDomainInputSchemas, domainTypeId, schemaDigest });
