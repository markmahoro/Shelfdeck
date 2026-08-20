'use strict';

const crypto = require('crypto');
const { selectedCandidateSelectedValueSchema } = require('./result-type-schema-builder');

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
const PROCUREMENT_RUN_MEMBER_LIMIT = 1024;
const PROCUREMENT_RUN_PHYSICAL_MEMBER_LIMIT = 1024;
const PROCUREMENT_OBSERVATION_SCOPE_ENTRY_LIMIT = PROCUREMENT_RUN_PHYSICAL_MEMBER_LIMIT;
const PROCUREMENT_PROBE_BATCH_LIMIT = 100;
const PROCUREMENT_PROBE_PAGE_LIMIT = Math.ceil(
  PROCUREMENT_RUN_PHYSICAL_MEMBER_LIMIT / PROCUREMENT_PROBE_BATCH_LIMIT,
);
const domainTypeId = (name) => `helix://contracts/domain-types/${name}/v1`;
const domainRef = (name) => ({ $ref: domainTypeId(name) });
const typeVersion = (name) => name === 'PhysicalMaterialIdentity' ? 2 : 1;
const typeRef = (name) => ({ $ref: `helix://contracts/types/${name}/v${typeVersion(name)}` });
const applicationRef = (name) => ({ $ref: `helix://contracts/application-types/${name}/v1` });
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

function typedParameters(kind, maxItems = 256) {
  return arrayOf(object({
    parameter: text({ pattern: '^[a-z][a-zA-Z0-9_.-]{0,127}$' }), valueType: enumText('string', 'integer', 'number', 'boolean'),
    value: { type: ['string', 'integer', 'number', 'boolean'] }, valueDigest: digest()
  }), maxItems);
}

const special = {
  'AcceptanceSpec.contentProfile': enumText('movie', 'series', 'jav', 'western_adult'),
  'ArtifactProfile.artifactKinds': arrayOf(text(), 128),
  'BoundedLayoutScope.maxDepth': positiveInteger(),
  'BoundedLayoutScope.maxMembers': positiveInteger(),
  'ClusterParameters.distanceThreshold': { type: 'number', minimum: 0, maximum: 1 },
  'ClusterParameters.minClusterSize': positiveInteger(),
  'EncodeIntent.deviceClass': text(),
  'BoundedFingerprintProfile.profileRef': { const: 'middle-256k-sha256@1' },
  'BoundedFingerprintProfile.revision': { const: 1 },
  'BoundedFingerprintProfile.algorithm': { const: 'middle-256k-sha256' },
  'BoundedFingerprintProfile.maxSampleBytes': { const: 262144 },
  'BoundedFingerprintProfile.profileDigest': digest(),
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
  'CareBasis.canonicalIdentityDigest': digest(),
  'CareBasis.acceptedProductFactSetDigest': digest(),
  'CurrentInventoryControl.materials': arrayOf(object({ materialKey: digest(), inventoryRevision: positiveInteger(), controlRevision: positiveInteger() }), 4096),
  'DecisionEvidence.queryResults': arrayOf(typeRef('VersionedQueryResult'), 256),
  'DecisionInputSet.inputs': arrayOf(snapshot('decision-input'), 256),
  'DestructionScope.materials': arrayOf(object({
    ordinal: nonNegativeInteger(),
    materialKey: digest(),
    materialRole: enumText('primary_payload', 'structural_dependency', 'metadata_sidecar', 'poster', 'fanart', 'subtitle', 'external_audio', 'chapter', 'sidecar'),
    physicalIdentity: typeRef('PhysicalMaterialIdentity'),
    physicalIdentityDigest: digest(),
    endpointId: id(),
    endpointRelativeLocation: text({ maxLength: 4096 }),
    sizeBytes: nonNegativeInteger(),
    relatedReferenceId: nullable(id()),
    bindingRevision: positiveInteger(),
    controlRevision: positiveInteger(),
    controlProjectionDigest: digest(),
    deleteCondition: enumText('exclusive_primary', 'release_related_then_delete_if_unreferenced'),
    memberDigest: digest(),
  }), 1024),
  'FinalBindings.bindings': arrayOf(snapshot('arca-material-binding'), 4096),
  'FinalInventoryDecision.members': arrayOf(snapshot('final-inventory-member'), 4096),
  'InventoryMetadataArtifactRefs.metadataFactRefs': arrayOf(id(), 1024),
  'InventoryMetadataArtifactRefs.artifactHandles': arrayOf(typeRef('ArtifactHandle'), 1024),
  'KnownBindings.bindings': arrayOf(snapshot('arca-material-binding'), 4096),
  'OffLoadContext.materials': arrayOf(snapshot('offload-material'), 4096),
  'PeopleWorkspace.workspaceHandles': arrayOf(typeRef('WorkspaceMaterialHandle'), 4096),
  'PersonIdentitiesAliasesReferences.people': arrayOf(snapshot('person-identity-alias-reference'), 4096),
  'PersonReferenceProjection.people': arrayOf(snapshot('person-reference'), 4096),
  'ProductManifest.members': arrayOf(snapshot('product-material-member'), 4096),
  'ProductMetadataArtifact.metadataFactRefs': arrayOf(id(), 1024),
  'ProductMetadataArtifact.artifactHandles': arrayOf(typeRef('ArtifactHandle'), 1024),
  'ProductStructure.structureKind': enumText('single', 'season'),
  'ProfessionalAssessmentsSharingOneCareBasis.assessments': arrayOf(snapshot('professional-assessment'), 1024),
  'ProviderPersonHint.providerIdentities': arrayOf(snapshot('provider-person-identity'), 128),
  'ReferenceEvidence.references': arrayOf(snapshot('material-reference-evidence'), 4096),
  'SourceObservation.observations': arrayOf(snapshot('source-observation'), 4096),
  'StructuredRejection.reasonCodes': arrayOf(text(), 128),
  'TargetBindings.bindings': arrayOf(snapshot('target-material-binding'), 4096),
  'TypedManifest.manifest': snapshot('typed-manifest'),
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
  AnalysisSpec: '',
  ArtifactProfile: 'artifactKinds,qualityPolicyDigest',
  ArtifactRequirement: 'artifactKind,requirementPayload,requirementDigest',
  CareRequirement: 'careBasisDigest,requiredEffects,acceptanceDigest',
  ClusterParameters: '',
  EncodeIntent: '',
  FaceModelRef: '',
  BoundedFingerprintProfile: 'profileRef,revision,algorithm,maxSampleBytes,profileDigest',
  IdentityRequirement: '',
  MandatoryRequirement: 'requirementCodes',
  ManifestContract: 'manifestKind,memberSchemaRef,minMembers,maxMembers',
  MetadataRequirement: 'requiredFactKeys,artifactRequirementDigest',
  PlacementPolicy: 'shelfId,targetEndpointIds,minimumFreeBytes',
  PreferenceIntent: 'personId,preferenceLevel,reason',
  RemuxIntent: '',
  MediaRequirement: '',
  SamplingPlan: '',
  SelectionCriteria: '',
  ShelfStandard: 'shelfId,contentProfile,ruleSetRevision,acceptanceRuleDigest',
  SidecarProfile: 'format,fileNamePolicyDigest,contentSchemaRef',
  SpaceRequirement: 'requiredBytes,reserveBytes',
  StructureRequirement: 'structureKind,memberConstraintDigest',
  WorkspaceDeliveryContract: ''
};

const dtoContracts = {
  AcceptedIntakePayload: '',
  AftercareMediaRepairStrategy: '',
  AcceptedPayload: 'onDeckProductPackage,acceptanceDecisionId,custodyDigest',
  AcceptedProductFacts: 'shelfEntryId,inventoryRevision,productFactSetDigest',
  ActiveShelfEntryIdentityProjection: 'entries,projectionRevision',
  CandidateDraft: '',
  CandidateDeliveryQuery: '',
  CandidateDeliveryReadResult: '',
  CandidateDeliverySnapshot: '',
  SubjectContinuityResolutionDecision: '',
  CareBasis: 'shelfEntryId,inventoryRevision,standardRevision,placementRevision,canonicalIdentityDigest,sourcePackageId,acceptedProductFactSetDigest,decisionFactSetDigest,assessments',
  CurrentInventoryControl: 'shelfId,materials',
  DecisionEvidence: 'subjectId,queryResults,routingInputDigest,specInputDigest',
  DecisionInputSet: 'subjectId,inputs,inputSetDigest',
  DestructionScope: 'destructionScopeId,shelfEntryId,inventoryRevision,memberCount,materials,memberSetDigest,controlRevisionSetDigest,scopeDigest',
  EpisodeDeliveryManifest: 'episodeClaims,deliveryDigest',
  SelectedCandidateSelected: '',
  FinalBindings: 'shelfEntryId,bindings,bindingSetDigest',
  ProductDispositionManifest: '',
  OldPrimaryStructuralExclusiveRelatedHandles: '',
  FinalInventoryDecision: 'onDeckRunId,shelfId,members,placementRevision,decisionDigest',
  FinalReality: 'shelfEntryId,inventoryRevision,realityDigest',
  InventoryMetadataArtifactRefs: 'shelfEntryId,inventoryRevision,metadataFactRefs,artifactHandles',
  InventoryRevision: 'shelfEntryId,inventoryRevision,inventoryDigest',
  KnownBindings: 'shelfEntryId,bindings,bindingSetDigest',
  LibraDeliverablePromotionDecision: '',
  RoutingFactObservationIntent: '',
  MetadataFetchIntent: '',
  WesternAnalysisVariant: '',
  LibraMediaCastSourceBasisMetadataObservationWesternMatch: '',
  LibraProductMetadataSourceBasisMetadataObservationWesternAnalysis: '',
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
  MediaExecutionDeviceSnapshot: '',
  ResolvedProviderIdentity: '',
  ProductStructureSnapshot: '',
  ProductConformanceFactSnapshot: '',
  ProductionMaterialManifest: '',
  ArtifactManifest: '',
  ArtifactConformanceVerificationSnapshot: '',
  ProductInventoryConformanceSnapshot: '',
  ProductionSourceScopeReference: '',
  WorkspaceMediaOutputTarget: '',
  WorkspaceArtifactOutputTarget: '',
  ProductMediaCandidateInput: '',
  ProductOutputSelectionInput: '',
  ProductConformanceInputSnapshot: '',
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
  ReleaseManifest: 'deregistrationId,shelfId,entryCount,memberCount,pageCount,controlRevisionSetDigest,manifestDigest',
  ShelfDeregistrationControlCommitHandle: 'deregistrationId,shelfId,manifestRevision,releaseManifestDigest,controlRevisionSetDigest,pageVerificationSetDigest,eventFenceDigest',
  Scope: 'scopeId,materialKeys,scopeDigest',
  SelectedFieldMaterialSet: '',
  TriageIdentityResolutionInput: '',
  TriageManifestBuildInput: '',
  BdmvAssessmentInput: '',
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
  VerifiedArtifactManifest: '',
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
  if (name === 'SamplingPlan') return samplingPlanSchema();
  if (name === 'FaceModelRef') return faceModelRefSchema();
  if (name === 'ClusterParameters') return clusterParametersSchema();
  if (name === 'AnalysisSpec') return analysisSpecSchema();
  if (name === 'EncodeIntent') return encodeIntentSchema();
  if (name === 'RemuxIntent') return remuxIntentSchema();
  if (name === 'MediaRequirement') return mediaRequirementSchema();
  if (name === 'ArtifactRequirement') return artifactRequirementSchema();
  if (name === 'WesternAnalysisVariant') return westernAnalysisVariantSchema();
  if (name === 'CandidateDeliveryQuery') return candidateDeliveryQuerySchema();
  if (name === 'CandidateDeliveryReadResult') return candidateDeliveryReadResultSchema();
  if (name === 'CandidateDeliverySnapshot') return candidateDeliverySnapshotSchema();
  if (name === 'SubjectContinuityResolutionDecision') return subjectContinuityResolutionDecisionSchema();
  if (name === 'AcceptedIntakePayload') return acceptedIntakePayloadSchema();
  if (name === 'AftercareMediaRepairStrategy') return aftercareMediaRepairStrategySchema();
  if (name === 'IntakeRejectionDecision') return intakeRejectionDecisionSchema();
  if (name === 'ArcaAcceptanceRejectionDecision') return arcaAcceptanceRejectionDecisionSchema();
  if (name === 'StructuredRejection') return structuredRejectionSchema();
  if (name === 'SelectedFieldMaterialSet') return selectedFieldMaterialSetSchema();
  if (name === 'CandidateDraft') return candidateDraftSchema();
  if (name === 'ProcurementTriageRuleSnapshot') return procurementTriageRuleSnapshotSchema();
  if (name === 'BdmvAssessmentInput') return bdmvAssessmentInputSchema();
  if (name === 'TriageMaterialProbeBatch') return triageMaterialProbeBatchSchema();
  if (name === 'TriageStructureInspectionInput') return triageStructureInspectionInputSchema();
  if (name === 'TriageIdentityResolutionInput') return triageIdentityResolutionInputSchema();
  if (name === 'TriageManifestBuildInput') return triageManifestBuildInputSchema();
  if (name === 'PeopleCandidateAcceptanceDecision') return peopleCandidateAcceptanceDecisionSchema();
  if (name === 'DirectPersonRegistrationDecision') return directPersonRegistrationDecisionSchema();
  if (name === 'PeopleReferenceMaintenanceDecision') return peopleReferenceMaintenanceDecisionSchema();
  if (name === 'PersonReferenceProjection') return personReferenceProjectionSchema();
  if (name === 'DecisionInputSet') return decisionInputSetSchema();
  if (name === 'RoutingFactObservationIntent') return routingFactObservationIntentSchema();
  if (name === 'MetadataFetchIntent') return metadataFetchIntentSchema();
  if (name === 'LibraMediaCastSourceBasisMetadataObservationWesternMatch') return libraMediaCastSourceBasisSchema(name);
  if (name === 'LibraProductMetadataSourceBasisMetadataObservationWesternAnalysis') return libraProductMetadataSourceBasisSchema(name);
  if (name === 'VerifiedArtifactManifest') return verifiedArtifactManifestSchema();
  if (name === 'OnDeckPersonEvidenceProjectionItem') return onDeckPersonEvidenceProjectionItemSchema();
  if (name === 'PerceptionResolutionQuery') return perceptionResolutionQuerySchema();
  if (name === 'PerceptionResolutionRecordSet') return perceptionResolutionRecordSetSchema();
  if (name === 'PerceptionResolutionRuleSnapshot') return perceptionResolutionRuleSnapshotSchema();
  if (name === 'LibraDeliverablePromotionDecision') return libraDeliverablePromotionDecisionSchema();
  if (name === 'WorkspaceCleanupEffectIntent') return workspaceCleanupEffectIntentSchema();
  if (name === 'WorkspaceCleanupCommitDecision') return workspaceCleanupCommitDecisionSchema();
  if (name === 'MediaExecutionDeviceSnapshot') return mediaExecutionDeviceSnapshotSchema();
  if (name === 'ResolvedProviderIdentity') return resolvedProviderIdentitySchema();
  if (name === 'ProductStructureSnapshot') return productStructureSnapshotSchema();
  if (name === 'ProductConformanceFactSnapshot') return productConformanceFactSnapshotSchema();
  if (name === 'ProductionMaterialManifest') return productionMaterialManifestSchema();
  if (name === 'ArtifactManifest') return artifactManifestSchema();
  if (name === 'ArtifactConformanceVerificationSnapshot') return artifactConformanceVerificationSnapshotSchema();
  if (name === 'ProductInventoryConformanceSnapshot') return productInventoryConformanceSnapshotSchema();
  if (name === 'ProductionSourceScopeReference') return productionSourceScopeReferenceSchema();
  if (name === 'WorkspaceMediaOutputTarget') return workspaceMediaOutputTargetSchema();
  if (name === 'WorkspaceArtifactOutputTarget') return workspaceArtifactOutputTargetSchema();
  if (name === 'ProductMediaCandidateInput') return productMediaCandidateInputSchema();
  if (name === 'ProductOutputSelectionInput') return productOutputSelectionInputSchema();
  if (name === 'ProductConformanceInputSnapshot') return productConformanceInputSnapshotSchema();
  if (name === 'ProductDispositionManifest') return productDispositionManifestSchema();
  if (name === 'OldPrimaryStructuralExclusiveRelatedHandles') return oldPrimaryStructuralExclusiveRelatedHandlesSchema();
  if (name === 'IdentityRequirement') return identityRequirementSchema();
  if (name === 'SelectionCriteria') return selectionCriteriaSchema();
  if (name === 'WorkspaceDeliveryContract') return workspaceDeliveryContractSchema();
  if (name === 'EpisodeDeliveryManifest') return episodeDeliveryManifestSchema();
  if (name === 'ProductStructure') return productStructureSchema();
  if (name === 'SelectedCandidateSelected') return selectedCandidateSelectedSchema();
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
    fieldRelativeLocation:text(), scopeOrdinal:nonNegativeInteger(), scopeMemberOrdinal:nonNegativeInteger(),
    physicalIdentity: typeRef('PhysicalMaterialIdentity'), sizeBytes: nonNegativeInteger(),
    bindingRevision: positiveInteger(), eligibilityRevision: positiveInteger(), eligibilityBasisDigest: digest(),
    lastSnapshotDigest: digest(), lastObservationId: id(), endpointId: id(), location: text(), realityDigest: digest(),
    provenanceDigest: digest(), controlSnapshot, admissionControlAction: enumText('acquire', 'assert_same_field'),
    basisMemberDigest: digest()
  });
  const selectionScope = object({ scopeOrdinal:nonNegativeInteger(),
    scopeKind:enumText('standalone_file','ordinary_directory','bdmv_container'), scopeKey:id(),
    scopeRootRelativeLocation:text(), memberCount:positiveInteger(), memberSetDigest:digest(), scopeDigest:digest() });
  return exactDomainSchema('SelectedFieldMaterialSet', {
    procurementRunId:id(), fieldId:id(), physicalMemberCount:positiveInteger(), selectionScopeCount:positiveInteger(),
    selectionScopes:{ ...arrayOf(selectionScope, PROCUREMENT_RUN_MEMBER_LIMIT), minItems:1 }, scopeSetDigest:digest(),
    members:{ ...arrayOf(member, PROCUREMENT_RUN_MEMBER_LIMIT), minItems:1 }, selectionDigest:digest()
  });
}

const profile = () => enumText('movie', 'series', 'jav', 'western_adult');
const mediaType = () => enumText('single', 'group');
const structureKind = () => enumText('single', 'season');
const episodeClaim = () => object({ episodeKey: text(), seasonClaimDigest: digest(), claimDigest: digest() });
const relatedReference = () => object({
  referenceId: id(), primaryMaterialKey: digest(), role: enumText('nfo', 'poster', 'fanart', 'subtitle', 'external_audio', 'chapter', 'sidecar'),
  identity: typeRef('PhysicalMaterialIdentity'), endpointId: id(), location: text(),
  fingerprintAlgorithm:{const:'middle-256k-sha256'},fingerprintVersion:{const:1},contentFingerprint:digest(),
  associationKind:{ const:'exclusive' },dispositionRequired:{ const:true },
  associationEvidenceDigest:digest(),dispositionBasisDigest:digest(),referenceDigest:digest()
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
    materialInputForm: enumText('stream_file', 'bdmv', 'dvd', 'iso'),
    primaryInputManifest: typeRef('PrimaryInputManifest'), primaryMaterialDeliveries: { ...arrayOf(delivery, PROCUREMENT_RUN_MEMBER_LIMIT), minItems: 1 },
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
    sourceProvenance: object({ fieldId:id(), fieldAccessRevision:positiveInteger(), fieldContextDigest:digest(),
      structureKind:structureKind(), contentProfile:profile(), materialInputForm:enumText('stream_file', 'bdmv', 'dvd', 'iso'),
      identityClaimDigest:digest() }),
    candidateVerification: typeRef('CandidateContractVerification'), materialVerification: typeRef('IntakeMaterialVerification'),
    resolutionDecision: domainRef('SubjectContinuityResolutionDecision'), bindingDraft: typeRef('LibraBindingDraft'),
    relatedDispositionScope: object({ relatedReferenceSetDigest:digest(), relatedDispositionScopeDigest:digest() }),
    controlTransferScope: object({ fieldId: id(), fromOwnerDomain: { const: 'procurement' },
      fromOwnerScopeType: { const: 'material_field' }, fromOwnerScopeId: id(), items: { ...arrayOf(item, PROCUREMENT_RUN_MEMBER_LIMIT), minItems: 1 },
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
const triageUnit = () => {
  const common = {
    unitId: digest(), mediaType: mediaType(), contentProfile: profile(), structureKind: structureKind(), displayIdentity: text(),
    identityMetadata: identityMetadata(), seasonContinuityClaims: arrayOf(seasonContinuityClaim(), 64),
    seasonContinuityClaimSetDigest: digest(),
    relatedScope: object({ scopeKind: enumText('ordinary_parent', 'bdmv_external_parent'), parentRelativeLocation:text(), stemKey:text(),
      associationMode:enumText('standalone_same_stem','single_movie_directory','multi_movie_directory','bdmv_external'),
      observationProjectionRevision:positiveInteger(), relatedRuleRevision:positiveInteger(), scopeDigest:digest() }),
    materialInputForm:enumText('stream_file', 'bdmv', 'dvd', 'iso'), unitDigest: digest()
  };
  const members = { ...arrayOf(object({ materialKey: digest(), bindingRevision: positiveInteger(), admittedControlRevision: positiveInteger(),
    admittedControlProjectionDigest: digest(), role: enumText('primary_payload', 'structural_dependency'),
    episodeClaims: arrayOf(episodeClaim(), 32), memberClaimDigest: digest() }), PROCUREMENT_RUN_MEMBER_LIMIT), minItems: 1 };
  const memberScope = object({ scopeKind: { const: 'bdmv_container' }, procurementRunId: id(), bdmvGroupKey: id(),
    scopeDigest: digest(), memberSetDigest: digest(), memberCount: positiveInteger(), topologyDigest: digest(),
    selectedPayloadSetDigest: digest() });
  return { oneOf: [object({ ...common, members }), object({ ...common, memberScope })] };
};

function procurementTriageRuleSnapshotSchema() {
  const rulePayload = object({
    contractRefs: arrayOf(text(), 32), recallPriority: { const: true }, maxRunPhysicalMembers: { const: PROCUREMENT_RUN_MEMBER_LIMIT },
    maxSelectionScopeMembers:{ const:PROCUREMENT_RUN_MEMBER_LIMIT }, maxCandidateManifestMembers:{ const:PROCUREMENT_RUN_MEMBER_LIMIT },
    probeBatchSize: { const: 100 }, playabilityRule: object({ minimumDurationMs: { const: 1 }, minimumVideoStreamCount: { const: 1 },
      reasonPrecedence: { const: ['probe_not_media', 'no_video_stream', 'non_positive_duration'] } }),
    profileResolutionRule: object({ mixedPrecedence: { const: ['series_episode_token', 'jav_code', 'movie_fallback'] },
      westernAdultRequiresExplicitHint: { const: true } }), structureRule: object({ maxUnitCanonicalBytes: { const: 65536 } }),
    identityRule: object({ claimKinds: { const: ['movie_title', 'series_season', 'jav_code', 'western_temporary'] } }),
    manifestRule: object({ minimumMembers: { const: 1 }, maximumMembers: { const: PROCUREMENT_RUN_MEMBER_LIMIT }, firstOrdinal: { const: 0 } })
  });
  return exactDomainSchema('ProcurementTriageRuleSnapshot', { ruleRef: id(), revision: positiveInteger(),
    ruleSchemaRef: { const: 'procurement.triage-rule.beta@1' }, rulePayload, ruleDigest: digest(), authorityDigest: digest() });
}

function bdmvAssessmentInputSchema() {
  return exactDomainSchema('BdmvAssessmentInput', {
    runId: id(), bdmvGroupKey: id(), scopeDigest: digest(), memberSetDigest: digest(),
    accessRevision: positiveInteger(), mountScopeId: id(), profileHint: enumText('movie', 'series', 'jav', 'western_adult', 'mixed'), inputDigest: digest()
  });
}

function triageMaterialProbeBatchSchema() {
  const ordinary = object({ selectionOrdinal: nonNegativeInteger(), materialKey: digest(), bindingRevision: positiveInteger(),
    admittedControlRevision: positiveInteger(), admittedControlProjectionDigest: digest(), readHandle: typeRef('PhysicalMaterialReadHandle'),
    mediaProbe: typeRef('MediaProbeEvidence'), memberDigest: digest() });
  const logicalOrdinary = object({ inputKind:{ const:'material' }, selectionOrdinal: nonNegativeInteger(), materialKey: digest(), bindingRevision: positiveInteger(),
    admittedControlRevision: positiveInteger(), admittedControlProjectionDigest: digest(), readHandle: typeRef('PhysicalMaterialReadHandle'),
    mediaProbe: typeRef('MediaProbeEvidence'), memberDigest: digest() });
  const bdmv = object({ inputKind:{ const:'bdmv_container' }, selectionOrdinal: nonNegativeInteger(), materialKey: digest(),
    bindingRevision: positiveInteger(), admittedControlRevision: positiveInteger(), admittedControlProjectionDigest: digest(),
    bdmvGroupKey: id(), scopeDigest: digest(), memberSetDigest: digest(), memberCount: positiveInteger(),
    bdmvAssessment: typeRef('BdmvAssessmentEvidence'), memberDigest: digest() });
  return exactDomainSchema('TriageMaterialProbeBatch', { procurementRunId: id(), runBasisDigest: digest(), selectionDigest: digest(),
    batchOrdinal: nonNegativeInteger(), members: { ...arrayOf({ oneOf:[ordinary, logicalOrdinary, bdmv] }, 100), minItems: 1 }, batchDigest: digest() });
}

function materialFieldContextSchema() {
  return object({ fieldId: id(), accessRevision: positiveInteger(), accessDigest: digest(),
    profileHintSnapshot: applicationRef('MaterialFieldProfileHintSnapshot'),
    memberContexts: { ...arrayOf(object({ selectionOrdinal: nonNegativeInteger(), materialKey: digest(), fieldRelativeLocation: text(),
      baseName:text(), extension:text(), parentSegments:arrayOf(text(),32),
      selectionScopeKind:enumText('standalone_file','ordinary_directory','bdmv_container'), selectionScopeKey:id(),
      selectionScopeRootRelativeLocation:text(), scopeOrdinal:nonNegativeInteger(), scopeMemberOrdinal:nonNegativeInteger(),
      layoutEvidenceRefs: arrayOf(object({ evidenceId: id(),
      payloadDigest: digest(), boundedScopeDigest: digest() }), 16) }), PROCUREMENT_RUN_PHYSICAL_MEMBER_LIMIT), minItems: 1 }, contextDigest: digest() });
}

function triageStructureInspectionInputSchema() {
  const scope = object({ scopeKind:{ const:'bdmv_container' }, procurementRunId:id(), bdmvGroupKey:id(), scopeDigest:digest(),
    memberSetDigest:digest(), memberCount:positiveInteger(), topologyDigest:digest(), selectedPayloadSetDigest:digest() });
  return exactDomainSchema('TriageStructureInspectionInput', { selectedFieldMaterialSet: domainRef('SelectedFieldMaterialSet'),
    probeBatches: { ...arrayOf(domainRef('TriageMaterialProbeBatch'), PROCUREMENT_PROBE_PAGE_LIMIT), minItems: 1 },
    bdmvAssessments: arrayOf(object({ scope, assessment:typeRef('BdmvAssessmentEvidence') }), PROCUREMENT_RUN_PHYSICAL_MEMBER_LIMIT),
    playabilityPages: { ...arrayOf(typeRef('PlayabilityEvidence'), PROCUREMENT_PROBE_PAGE_LIMIT), minItems: 1 }, materialFieldContext: materialFieldContextSchema(),
    observationScopeProjection: object({ projectionRevision: positiveInteger(), scopeDigest: digest(), entriesDigest: digest(),
      entryCount: nonNegativeInteger(), entries: arrayOf(object({ entryOrdinal: nonNegativeInteger(), materialKey: digest(),
        relativeLocation: text(), currentLocation: text(), parentRelativeLocation: text(), baseName: text(), extension: text(),
        identity: nullable(typeRef('PhysicalMaterialIdentity')), endpointId: nullable(id()), sizeBytes: nonNegativeInteger(),
        entryDigest: digest() }), PROCUREMENT_OBSERVATION_SCOPE_ENTRY_LIMIT) }), pageRequest: object({ pageOrdinal: nonNegativeInteger(),
      cursorIn: { anyOf: [text(), { type: 'null' }] }, maxUnits: { type: 'integer', minimum: 1, maximum: 100 }, requestDigest: digest() }),
    inputDigest: digest() }, undefined, { 'x-helix-maxCanonicalBytes': 4 * 1024 * 1024 });
}

function triageIdentityResolutionInputSchema() {
  return exactDomainSchema('TriageIdentityResolutionInput', { procurementRunId: id(), runBasisDigest: digest(),
    triageRuleAuthorityDigest: digest(), structureEvidenceId: id(), structureEvidencePayloadDigest: digest(), unit: triageUnit(), inputDigest: digest() });
}

function triageManifestBuildInputSchema() {
  return exactDomainSchema('TriageManifestBuildInput', { procurementRunId: id(), runBasisDigest: digest(), triageRuleAuthorityDigest: digest(),
    structureEvidenceId: id(), structureEvidencePayloadDigest: digest(),
    unit: triageUnit(), candidateMembers: { ...arrayOf(object({ materialKey: digest(), bindingRevision: positiveInteger(),
      admittedControlRevision: positiveInteger(), admittedControlProjectionDigest: digest(), role: enumText('primary_payload', 'structural_dependency'),
      physicalIdentity: typeRef('PhysicalMaterialIdentity'), sizeBytes: nonNegativeInteger(),
      episodeClaims: arrayOf(episodeClaim(), 32), memberClaimDigest: digest() }), PROCUREMENT_RUN_PHYSICAL_MEMBER_LIMIT), minItems: 1 },
    preallocatedManifestId: id(), inputDigest: digest() });
}

function candidateDraftSchema() {
  return exactDomainSchema('CandidateDraft', { draftId: id(), draftKind: text(), basisDigest: digest(), draftDigest: digest(),
    producedAtMs: nonNegativeInteger(), candidatePackageId: id(), procurementRunId: id(),
    runBasisDigest: digest(), triageRule: object({ ruleRef: id(), revision: positiveInteger(), authorityDigest: digest() }),
    materialFieldContextRef: object({ fieldId: id(), accessRevision: positiveInteger(), contextDigest: digest() }),
    mediaType: mediaType(), contentProfile: profile(), displayIdentity: text(), identityMetadata: identityMetadata(),
    identityClaim: typeRef('IdentityClaim'), structureEvidence: object({ evidenceId: id(), payloadDigest: digest(), unit: triageUnit() }),
    primaryInputManifestDraft: typeRef('PrimaryInputManifestDraft'), seasonContinuityClaims: arrayOf(seasonContinuityClaim(), 64),
    seasonContinuityClaimSetDigest: digest(), relatedReferences: arrayOf(relatedReference(), 1024), materialInputForm:enumText('stream_file', 'bdmv', 'dvd', 'iso'),
    relatedReferenceSetDigest: digest(), relatedDispositionScopeDigest:digest(),
    memberControlEvidenceSetDigest: digest(), candidateDraftDigest: digest()
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

function decisionInputSetSchema() {
  const nullableText = nullable(text());
  const routingProvenance = object({
    candidatePackageId: id(), sourceFieldId: id(), sourceFieldAccessRevision: positiveInteger(),
    sourceFieldContextDigest: digest(), candidateIdentityClaimDigest: digest(),
    decisionIdentityEvidenceSchemaRef: text(), decisionIdentityEvidenceSourceId: id(),
    decisionIdentityEvidenceRevision: positiveInteger(), decisionIdentityEvidenceDigest: digest(),
  }, ['candidatePackageId', 'sourceFieldId', 'sourceFieldAccessRevision', 'sourceFieldContextDigest', 'candidateIdentityClaimDigest']);
  const subjectSnapshot = object({
    subjectId: id(), status: { const: 'active' }, intakeRevision: positiveInteger(),
    structureKind: enumText('single', 'season'), contentProfile: profile(), routingAnchorIntakeDecisionId: id(),
    routingProvenance, currentIdentityRevision: nullable(positiveInteger()), currentIdentityDigest: nullable(digest()),
    continuitySetDigest: digest(), episodeScopeDigest: digest(), snapshotDigest: digest(),
  });
  const decisionHead = object({
    subjectId: id(), headState: enumText('absent', 'present'), headRevision: nonNegativeInteger(),
    headDigest: nullable(digest()), currentRoutingDecisionId: nullableText,
    currentDecisionBasisId: nullableText, currentAcceptanceSpecId: nullableText, snapshotDigest: digest(),
  });
  const readiness = object({ result: enumText('ready', 'unresolved'), reasonCode: text() }, ['result']);
  function routingMatchExpression(depth = 1) {
    const leaf = [
      object({ nodeKind: { const: 'always' } }),
      object({ nodeKind: { const: 'predicate' },
        factKind: enumText('content_profile', 'structure_kind', 'material_field', 'release_year', 'region', 'genre', 'resolved_provider_identity'),
        operator: enumText('eq', 'one_of', 'gte', 'lte', 'exists'), expectedValue: {} }),
    ];
    if (depth >= 4) return { oneOf: leaf };
    const child = routingMatchExpression(depth + 1);
    return { oneOf: [...leaf,
      object({ nodeKind: enumText('all', 'any'), children: { ...arrayOf(child, 16), minItems: 1 } }),
      object({ nodeKind: { const: 'not' }, child }),
    ] };
  }
  const policyTarget = object({
    shelfId: id(), rank: positiveInteger(), matchExpression: routingMatchExpression(), matchRuleDigest: digest(),
  });
  const policy = object({
    routingPolicyId: id(), revision: positiveInteger(), fieldId: id(), mode: enumText('direct', 'sorting'),
    targets: { ...arrayOf(policyTarget, 64), minItems: 1 }, policyDigest: digest(),
  });
  const manualIntent = object({
    subjectId: id(), targetShelfId: id(), expectedDecisionHead: object({ revision: nonNegativeInteger(), digest: digest() }),
    actorId: id(), idempotencyKey: id(), requestDigest: digest(),
  });
  const routingAuthority = {
    oneOf: [
      object({ authorityKind: { const: 'policy' }, policy, authorityDigest: digest() }),
      object({ authorityKind: { const: 'manual_selection' }, manualIntent, authorityDigest: digest() }),
    ],
  };
  const shelfRoutingTarget = object({
    shelfId: id(), status: enumText('active', 'deregistering', 'deregistered'), routingProjectionRevision: positiveInteger(),
    currentStandardRevision: nullable(positiveInteger()), currentStandardDigest: nullable(digest()), projectionDigest: digest(),
  });
  const routingFact = {
    type: 'object', minProperties: 6,
    required: ['factKind', 'sourceObjectId', 'sourceRevision', 'schemaRef', 'factDigest'],
    properties: {
      factKind: enumText('content_profile', 'structure_kind', 'material_field', 'release_year', 'region', 'genre', 'resolved_provider_identity'),
      sourceObjectId: id(), sourceRevision: positiveInteger(), schemaRef: text(), factDigest: digest(),
      value: {}, fieldId: id(), year: { type: 'integer', minimum: 1870, maximum: 3000 },
      countryCodes: arrayOf(text(), 128), genreCodes: arrayOf(text(), 128),
      provider: text(), namespace: text(), providerKey: text(), identityRevision: positiveInteger(), identityDigest: digest(),
    },
    additionalProperties: false,
  };
  const decisionFact = {
    oneOf: [
      routingFact,
      typeRef('PerceptionResolutionRevision'),
    ],
  };
  const queryResult = typeRef('VersionedQueryResult');
  const routingDecision = object({
    routingDecisionId: id(), subjectId: id(), decisionRevision: positiveInteger(), assessmentId: id(), decisionBasisId: id(),
    routingAuthorityKind: enumText('policy', 'manual_selection'), routingPolicyId: nullable(id()),
    routingPolicyRevision: nullable(positiveInteger()), manualSelectionDigest: nullable(digest()), routingInputDigest: digest(),
    shelfPrioritySetDigest: digest(), result: enumText('resolved', 'unresolved'), targetShelfId: nullable(id()),
    unresolvedReasonCode: nullable(text()), decisionDigest: digest(),
  });
  const productScope = object({
    subjectId: id(), scopeKind: enumText('single', 'episode_manifest'), subjectIntakeRevision: positiveInteger(),
    episodeKeys: arrayOf(text(), 1024), scopeDigest: digest(),
  });
  const requirements = object({
    identity: object({ identityKind: enumText('tmdb_movie', 'tmdb_series_season', 'jav_code', 'internal_identity'),
      requiredProvider: nullable(text()), requireSeasonNumber: bool() }, ['identityKind', 'requireSeasonNumber']),
    structure: object({ structureKind: enumText('single', 'season'), primaryModel: enumText('single_primary', 'episode_primary'),
      requireOnePrimaryPerEpisode: bool() }),
    metadata: object({ requiredFieldCodes: arrayOf(text(), 128), requiredArtifactKinds: arrayOf(text(), 128),
      requireRenderableSidecar: bool(), requireDecodableImages: bool() }),
    mandatoryMedia: object({ mediaForm: enumText('any', 'stream_file'), videoCodec: enumText('any', 'hevc'),
      container: enumText('any', 'matroska'), fileExtension: enumText('any', 'mkv'), minimumRasterClass: enumText('none', '4k'),
      acceptedPrimaryAudioClasses: arrayOf(text(), 128), forbidSystemUpscaleFor4k: bool() }),
    space: object({ unit: enumText('product', 'episode'), maxSizeGiB: nullable({ type: 'number', exclusiveMinimum: 0 }),
      maxSizeBytes: nullable(positiveInteger()) }),
    inventory: object({ requireDomainBinding: bool(), requireChecksum: bool(), requiredMaterializedArtifactKinds: arrayOf(text(), 128),
      layoutModel: enumText('single', 'season_episode') }),
  });
  const decisionBranch = object({ conditionKind: enumText('no_rating', 'rating_equals'), rating: { type: 'integer', minimum: 1, maximum: 5 },
    requirements }, ['conditionKind', 'requirements']);
  const profileRule = object({ contentProfile: profile(), decisionInputKinds: arrayOf(enumText('rating'), 1), baseRequirements: requirements,
    decisionBranches: arrayOf(decisionBranch, 6), profileRuleSetDigest: digest() });
  const shelfStandard = object({ shelfId: id(), standardRevision: positiveInteger(), ruleTemplateId: id(),
    ruleTemplateRevision: positiveInteger(), profileRuleSets: { ...arrayOf(profileRule, 4), minItems: 1 }, standardDigest: digest() });
  const shelfStandardProjection = object({ shelfId: id(), status: { const: 'active' }, routingProjectionRevision: positiveInteger(),
    projectionDigest: digest(), standard: shelfStandard, projectionResultDigest: digest() });
  return {
    ...exactDomainSchema('DecisionInputSet', {
      decisionInputSetId: id(), basisKind: enumText('routing', 'acceptance_spec'), subjectSnapshot,
      expectedDecisionHead: decisionHead, readiness, routingAuthoritySnapshot: nullable(routingAuthority),
      shelfRoutingTargets: arrayOf(shelfRoutingTarget, 128), routingDecision: nullable(routingDecision),
      shelfStandardProjection: nullable(shelfStandardProjection), productScope: nullable(productScope),
      decisionFacts: arrayOf(decisionFact, 128), queryResults: arrayOf(queryResult, 128), queryResultSetDigest: digest(),
      routingInputDigest: nullable(digest()), specInputDigest: nullable(digest()), inputSetDigest: digest(),
    }),
    'x-helix-maxCanonicalBytes': 1024 * 1024,
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
  const common = { intentId: id(), libraRunId: id(), runExecutionBasisDigest: digest(),
    sourceKind: enumText('related_nfo', 'provider'), sourcePriority: nonNegativeInteger(),
    contentProfile: enumText('movie', 'series', 'jav'), resolvedIdentityDigest: digest(),
    requestedFields: arrayOf(text({ maxLength: 128 }), 256), intentDigest: digest() };
  return { $schema: DRAFT, $id: domainTypeId('MetadataFetchIntent'), title: 'MetadataFetchIntent@1',
    'x-helix-ssotRefs': ['6.4.7.1', '8.6.18', '8.6.20'], 'x-helix-role': 'accepted-business-dto',
    'x-helix-maxCanonicalBytes': 16 * 1024, oneOf: [
      object({ ...common, sourceKind: { const: 'related_nfo' }, relatedReferenceId: id(), relatedReferenceDigest: digest(), expectedChecksum: digest() },
        [...Object.keys(common), 'relatedReferenceId', 'relatedReferenceDigest', 'expectedChecksum']),
      object({ ...common, sourceKind: { const: 'provider' }, providerKind: enumText('tmdb', 'jav'),
        resolvedProviderIdentity: domainRef('ResolvedProviderIdentity'), integrationId: id(), configRevision: positiveInteger() },
        [...Object.keys(common), 'providerKind', 'resolvedProviderIdentity', 'integrationId', 'configRevision'])
    ] };
}

function routingFactObservationIntentSchema() {
  const requestedFactKinds = {
    ...arrayOf(enumText('release_year', 'region', 'genre', 'resolved_provider_identity'), 4),
    minItems: 1,
    uniqueItems: true,
    'x-helix-canonicalOrder': 'UTF-8(value)',
  };
  const identityClaim = typeRef('IdentityClaim');
  const common = {
    intentId: id(), subjectId: id(), routingAnchorIntakeDecisionId: id(), routingAnchorDigest: digest(),
    contentProfile: { const: 'movie' }, identityClaim, requestedFactKinds,
    sourceKind: enumText('related_nfo', 'provider'), intentDigest: digest(),
  };
  const providerAnchor = object({
    provider: { const: 'tmdb' }, namespace: { const: 'tmdb_movie' }, providerKey: text({ maxLength: 128 }),
  });
  return {
    $schema: DRAFT,
    $id: domainTypeId('RoutingFactObservationIntent'),
    title: 'RoutingFactObservationIntent@1',
    'x-helix-ssotRefs': ['5.1.3', '5.4.3', '8.6.5', '8.6.18'],
    'x-helix-role': 'accepted-business-dto',
    'x-helix-maxCanonicalBytes': 16 * 1024,
    oneOf: [
      object({
        ...common, sourceKind: { const: 'related_nfo' }, relatedReferenceId: id(),
        relatedReferenceDigest: digest(), expectedPhysicalIdentityDigest: digest(),
      }, [...Object.keys(common), 'relatedReferenceId', 'relatedReferenceDigest', 'expectedPhysicalIdentityDigest']),
      object({
        ...common, sourceKind: { const: 'provider' }, integrationId: id(), configRevision: positiveInteger(),
        providerKind: { const: 'tmdb' }, candidateDisplayTitle: text({ maxLength: 1024 }),
        yearHint: nullable({ type: 'integer', minimum: 1870, maximum: 3000 }),
        strongProviderAnchor: nullable(providerAnchor),
      }, [...Object.keys(common), 'integrationId', 'configRevision', 'providerKind', 'candidateDisplayTitle',
        'yearHint', 'strongProviderAnchor']),
    ],
  };
}

function westernAnalysisVariantSchema() {
  const analysisResult = object({ eventId: id(), resultId: id(), resultDigest: digest(), result: typeRef('WesternAnalysisResult') });
  return { $schema: DRAFT, $id: domainTypeId('WesternAnalysisVariant'), title: 'WesternAnalysisVariant@1',
    'x-helix-ssotRefs': ['6.4.7.1', '8.6.20'], 'x-helix-role': 'accepted-business-dto',
    'x-helix-maxCanonicalBytes': 256 * 1024,
    ...object({ variantId: id(), libraRunId: id(), runExecutionBasisDigest: digest(), resolvedIdentityDigest: digest(),
      analysisResults: { ...arrayOf(analysisResult, 16), minItems: 1 }, variantDigest: digest() }) };
}

function metadataObservationSetValue() {
  return object({ setId: id(), contentProfile: enumText('movie', 'series', 'jav'), resolvedIdentityDigest: digest(),
    observations: { ...arrayOf(typeRef('MetadataObservation'), 16), minItems: 1 },
    sourcePrecedence: { ...arrayOf(object({ fetchIntentDigest: digest(), sourcePriority: nonNegativeInteger() }), 16), minItems: 1 },
    setDigest: digest() });
}

function metadataObservationSelectionValue() {
  const item = object({ ordinal: nonNegativeInteger(), workId: id(), attemptId: id(), planId: id(), eventId: id(), resultId: id(),
    fetchIntentDigest: digest(), sourceKind: enumText('related_nfo', 'provider'), sourceRef: text(), sourcePriority: nonNegativeInteger(),
    evidenceId: id(), observationDigest: digest(), sourceReferenceDigest: digest() });
  return object({ selectionId: id(), libraRunId: id(), runExecutionBasisDigest: digest(), setId: id(), setDigest: digest(),
    items: { ...arrayOf(item, 16), minItems: 1 }, selectionDigest: digest() });
}

function westernProductMetadataBasisValue() {
  const analysisRef = object({ workId: id(), attemptId: id(), planId: id(), eventId: id(), resultId: id(), resultDigest: digest(),
    inputBindingDigest: digest(), analysisArtifactHandleId: id(), analysisArtifactDigest: digest(),
    evidenceId: id(), evidenceDigest: digest() });
  const normalizeRef = object({ workId: id(), attemptId: id(), planId: id(), eventId: id(), resultId: id(), resultDigest: digest(),
    inputBindingDigest: digest(), analysisVariantId: id(), productMetadataDraftDigest: digest() });
  return object({ basisId: id(), basisKind: { const: 'western_analysis' }, libraRunId: id(), runExecutionBasisDigest: digest(),
    resolvedIdentityDigest: digest(), analysisVariantDigest: digest(),
    analysisRefs: { ...arrayOf(analysisRef, 16), minItems: 1 }, normalizeRef, sourceRefsDigest: digest(), basisDigest: digest() });
}

function westernMediaCastBasisValue() {
  const matchRef = object({ workId: id(), attemptId: id(), planId: id(), eventId: id(), resultId: id(), resultDigest: digest(),
    inputBindingDigest: digest(), evidenceId: id(), evidenceDigest: digest(), personMatchEvidenceDigest: digest() });
  return object({ basisId: id(), basisKind: { const: 'western_match' }, libraRunId: id(), runExecutionBasisDigest: digest(),
    resolvedIdentityDigest: digest(), matchRef, referenceProjectionSetDigest: digest(),
    matchState: enumText('matches_found', 'no_matches'), basisDigest: digest() });
}

function sourceBasisEnvelope(name, variants, maxCanonicalBytes) {
  return { $schema: DRAFT, $id: domainTypeId(name), title: `${name}@1`,
    'x-helix-ssotRefs': ['6.4.7.1', '8.5.4', '8.6.20'], 'x-helix-role': 'accepted-business-dto',
    'x-helix-maxCanonicalBytes': maxCanonicalBytes, oneOf: variants };
}

function libraProductMetadataSourceBasisSchema(name) {
  return sourceBasisEnvelope(name, [
    object({ sourceBasisKind: { const: 'metadata_observation' }, selection: metadataObservationSelectionValue(),
      observationSet: metadataObservationSetValue(), sourceBasisDigest: digest() }),
    object({ sourceBasisKind: { const: 'western_analysis' }, westernBasis: westernProductMetadataBasisValue(), sourceBasisDigest: digest() })
  ], 512 * 1024);
}

function libraMediaCastSourceBasisSchema(name) {
  return sourceBasisEnvelope(name, [
    object({ sourceBasisKind: { const: 'metadata_observation' }, selection: metadataObservationSelectionValue(),
      observationSet: metadataObservationSetValue(), sourceBasisDigest: digest() }),
    object({ sourceBasisKind: { const: 'western_match' }, westernBasis: westernMediaCastBasisValue(), sourceBasisDigest: digest() })
  ], 512 * 1024);
}

function verifiedArtifactManifestSchema() {
  const resultRef = object({ workId:id(), attemptId:id(), planId:id(), eventId:id(), resultId:id(),
    capabilityRef:{ const:'shared.artifact.manifest.verify@1' },
    resultSchemaRef:{ const:'helix://contracts/types/ArtifactManifestVerification/v1' },
    resultDigest:digest(), inputBindingDigest:digest() });
  const item = object({ ordinal: nonNegativeInteger(), artifactHandleId: id(), artifactKind: text(), artifactRevision: positiveInteger(),
    artifactDigest: digest(), requirementId:id(), requirementRevision:positiveInteger(), requirementSchemaRef:text(),
    requirementDigest: digest(), verificationEvidenceId: id(), verificationEvidenceDigest: digest(),
    verificationResultRef:resultRef, referenceDigest: digest() });
  return exactDomainSchema('VerifiedArtifactManifest', { manifestId: id(), libraRunId: id(),
    items: arrayOf(item, 256), artifactSetDigest: digest(), manifestDigest: digest() }, undefined,
  { 'x-helix-maxCanonicalBytes': 256 * 1024 });
}

function artifactRequirementSchema() {
  return exactDomainSchema('ArtifactRequirement', { requirementId:id(), revision:positiveInteger(),
    schemaRef:text(), artifactKind:text(), requirementPayload:object({}, [], { additionalProperties:true }), requirementDigest:digest() }, undefined,
  { 'x-helix-role':'bounded-contract', 'x-helix-maxCanonicalBytes':16 * 1024 });
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
  const typedFactValue = { oneOf:[typeRef('ResolvedProductIdentity'),typeRef('MediaCastFact'),typeRef('ProductMetadataFact')] };
  const productFactItem = object({ productFactId: id(), factKind: enumText('resolved_identity', 'media_cast', 'product_metadata', 'media_conformance'),
    factRevision: positiveInteger(), schemaRef: text(), factValue: typedFactValue, factDigest: digest(), evidenceDigest: digest(), referenceDigest: digest() });
  const productFactManifest = object({ manifestId: id(), manifestRevision: positiveInteger(), libraRunId: id(),
    items: { ...arrayOf(productFactItem, 256), minItems: 1 }, factSetDigest: digest(), manifestDigest: digest() });
  const artifactItem = object({ artifactHandleId: id(), artifactKind: text(), artifactRevision: positiveInteger(), artifactDigest: digest(),
    requirementDigest: digest(), materializationState: enumText('workspace_only', 'included_product'), referenceDigest: digest() });
  const artifactManifest = object({ manifestId: id(), manifestRevision: positiveInteger(), libraRunId: id(),
    items: arrayOf(artifactItem, 256), artifactSetDigest: digest(), manifestDigest: digest() });
  const offloadMember = object({ ordinal: nonNegativeInteger(), materialKey: digest(),
    contextRole: enumText('original_input', 'structural_dependency', 'related_input'),
    sourceRelatedReferenceId: nullable(id()), finalProductMaterialKey:digest(),
    dispositionKind:enumText('carried_forward', 'replaced_and_settled'),
    physicalIdentity: typeRef('PhysicalMaterialIdentity'), endpointId:id(), location: text(),
    bindingRevision: positiveInteger(), bindingEvidenceDigest: digest(),
    admittedControlRevision: nullable(positiveInteger()), admittedControlProjectionDigest: nullable(digest()),
    derivedAuthorityDigest:nullable(digest()),
    settlementExpectation: enumText('retain', 'replace_or_move', 'remove_after_place'), memberDigest: digest() });
  const offloadManifest = object({ manifestId: id(), manifestRevision: positiveInteger(), libraRunId: id(),
    members: arrayOf(offloadMember, 1024), memberSetDigest: digest(), manifestDigest: digest() });
  const workspaceReference = object({ referenceId: id(), workspaceId: id(), libraRunId: id(), materialHandleId: id(), materialKey: digest(),
    workspaceMaterialHandle: typeRef('WorkspaceMaterialHandle'), workspaceHandleDigest: digest(), referenceRevision: positiveInteger(),
    state: { const: 'product_staging' }, episodeClaims: arrayOf(episodeClaim, 32), episodeScopeDigest: digest(),
    productVerificationRef: applicationRef('WorkspaceProductVerificationSnapshot'), previousReferenceRevision: nullable(positiveInteger()),
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
      factDigest: digest(), evidenceDigest: digest(), relations: arrayOf(object({ relationId: id(), personId: nullable(id()),
        displayName: text(), displayNameNormalized: text(), role: text(), source: text(),
        providerIdentities: arrayOf(object({ provider:text({maxLength:128}), namespace:text({maxLength:256}),
          providerKey:text({maxLength:2048}) }), 128), originEvidenceDigest: digest(),
        confidenceClass: text(), relationDigest: digest() }), 4096),
      relationsDigest: digest() }),
    productMaterialManifest:domainRef('ProductionMaterialManifest'), offloadContextManifest: offloadManifest,
    productionProvenance: object({ libraRunId: id(), runExecutionBasisDigest: digest(), acceptanceSpecRecordDigest: digest(),
      workflowPlanRefs: arrayOf(object({ planId: id(), planRevision: positiveInteger(), planDigest: digest() }), 256),
      productVerificationRefs: arrayOf(object({ verificationId: id(), verificationDigest: digest() }), 256),
      externalRealityObservationRefs: arrayOf(object({ evidenceId: id(), evidenceDigest: digest() }), 256), provenanceDigest: digest() }),
    productionAttestation: object({ attestationId: id(), libraRunId: id(), onDeckPackageId: id(), acceptanceSpecId: id(),
      acceptanceSpecRecordDigest:digest(), productConformanceEvidenceId: id(), productConformanceEvidenceDigest: digest(),
      evaluatedRequirementSetDigest:digest(), productSnapshotDigest:digest(), unmetRequirementCount: { const: 0 },
      attestedAtMs: nonNegativeInteger(), attestationDigest: digest() }),
    relatedDispositionSetDigest:digest(),
    relatedAuthorityAssertions:arrayOf(object({sourceRelatedReferenceId:id(),primaryMaterialKey:digest(),role:text(),
      sourceMaterialKey:digest(),finalProductMaterialKey:digest(),associationEvidenceDigest:digest(),
      dispositionBasisDigest:digest(),bindingRevision:positiveInteger(),bindingEvidenceDigest:digest(),
      dispositionKind:enumText('carried_forward','replaced_and_settled'),derivedAuthorityDigest:digest(),assertionDigest:digest()}),1024),
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

const deviceClass = () => enumText('software_cpu', 'intel_qsv', 'nvidia_nvenc', 'amd_vaapi', 'remote_worker');
const contentProfile = () => enumText('movie', 'series', 'jav', 'western_adult');
const acceptanceStructureKind = () => enumText('single', 'season');
const nullablePositiveInteger = () => nullable(positiveInteger());

function acceptanceRequirementSetSchema() {
  const identity = object({ identityKind: enumText('tmdb_movie', 'tmdb_series_season', 'jav_code', 'internal_identity'),
    requiredProvider: nullable(enumText('tmdb')), requireSeasonNumber: bool() });
  const structure = object({ structureKind: acceptanceStructureKind(), primaryModel: enumText('single_primary', 'episode_primary'),
    requireOnePrimaryPerEpisode: bool() });
  const metadata = object({ requiredFieldCodes: arrayOf(enumText('tmdb_movie_id', 'tmdb_series_id', 'title', 'series_title',
    'year_or_release_date', 'release_date', 'plot', 'genre', 'actor', 'director', 'season_number', 'episode_number',
    'episode_title', 'episode_plot', 'jav_code', 'studio', 'internal_identity'), 18),
    requiredArtifactKinds: arrayOf(enumText('nfo', 'poster', 'fanart'), 3), requireRenderableSidecar: bool(), requireDecodableImages: bool() });
  const mandatoryMedia = object({ mediaForm: enumText('any', 'stream_file'), videoCodec: enumText('any', 'hevc'),
    container: enumText('any', 'matroska'), fileExtension: enumText('any', 'mkv'), minimumRasterClass: enumText('none', '4k'),
    acceptedPrimaryAudioClasses: arrayOf(enumText('eac3_atmos', 'truehd', 'truehd_atmos', 'dts_hd_ma', 'dts_x'), 5),
    forbidSystemUpscaleFor4k: bool() });
  const space = object({ unit: enumText('product', 'episode'), maxSizeGiB: nullablePositiveInteger(), maxSizeBytes: nullablePositiveInteger() });
  const inventory = object({ requireDomainBinding: bool(), requireChecksum: bool(),
    requiredMaterializedArtifactKinds: arrayOf(enumText('nfo', 'poster', 'fanart'), 3), layoutModel: enumText('single', 'season_episode') });
  return object({ identity, structure, metadata, mandatoryMedia, space, inventory });
}

function acceptanceSpecValueSchema() {
  return object({ schemaRef: { const: 'libra.acceptance-spec@1' }, schemaVersion: { const: 1 },
    draftId: id(), draftKind: text(), basisDigest: digest(), draftDigest: digest(), producedAtMs: nonNegativeInteger(),
    subjectId: id(), targetShelfId: id(), contentProfile: contentProfile(), structureKind: acceptanceStructureKind(),
    productScope: object({ subjectId: id(), scopeKind: enumText('single', 'episode_manifest'),
      subjectIntakeRevision: positiveInteger(), episodeKeys: arrayOf(text(), 1024), scopeDigest: digest() }),
    shelfRoutingProjectionRevision: positiveInteger(), shelfProjectionDigest: digest(), shelfStandardRevision: positiveInteger(),
    shelfStandardDigest: digest(), decisionBasisId: id(), decisionBasisDigest: digest(), requirements: acceptanceRequirementSetSchema(),
    specDigest: digest(), acceptanceSpecId: id(), specRevision: positiveInteger(), recordDigest: digest(), publishedAtMs: nonNegativeInteger() });
}

function mediaRequirementValueSchema() {
  return domainRef('MediaRequirement');
}

function mediaRequirementSchema() {
  const requirements = acceptanceRequirementSetSchema().properties;
  return { ...exactDomainSchema('MediaRequirement', { requirementId: id(), revision: positiveInteger(),
    schemaRef: { const: 'MediaRequirement@1' }, acceptanceSpecId: id(), acceptanceSpecRecordDigest: digest(), contentProfile: contentProfile(),
    structureKind: acceptanceStructureKind(), mandatoryMedia: requirements.mandatoryMedia, space: requirements.space,
    requirementDigest: digest() }, undefined, { 'x-helix-role': 'bounded-contract' }),
    'x-helix-maxCanonicalBytes': 16 * 1024 };
}

function encodeIntentSchema() {
  const outputColorProfile = object({ range:text(), primaries:text(), transfer:text(), matrix:text() });
  const sdrBt709ColorProfile = object({ range:{ const:'limited' }, primaries:{ const:'bt709' }, transfer:{ const:'bt709' }, matrix:{ const:'bt709' } });
  const videoBase = { codec: { const: 'hevc' }, preserveRaster: { const: true }, forbidUpscale: { const: true },
    dynamicRangeOperation: enumText('preserve', 'tone_map_to_sdr_bt709'), pipelineProfileId:text(),
    outputDynamicRangeKind: enumText('sdr', 'hdr10_compatible', 'hlg', 'dolby_vision', 'unknown'),
    outputPixelFormat:text(), outputColorProfile };
  const video = { oneOf: [
    object({ ...videoBase, rateControlMode: { const: 'target_size' }, targetVideoBitrateBps: positiveInteger(), qualityBound: { type: 'null' } }),
    object({ ...videoBase, rateControlMode: { const: 'two_pass_abr' }, targetVideoBitrateBps: positiveInteger(), qualityBound: { type: 'null' } }),
    object({ ...videoBase, rateControlMode: { const: 'strict_abr' }, targetVideoBitrateBps: positiveInteger(), qualityBound: { type: 'null' } }),
    object({ ...videoBase, rateControlMode: { const: 'quality_bound' }, targetVideoBitrateBps: { type: 'null' },
      qualityBound: { type: 'integer', minimum: 0, maximum: 63 } })
  ] };
  const properties = { intentId: id(), revision: positiveInteger(), schemaRef: { const: 'EncodeIntent@1' }, libraRunId: id(),
    sourceHandleDigest: digest(), mediaRequirementDigest: digest(), planningPolicyRef: { const: 'LibraMediaPlanningPolicy@1' },
    planningPolicyRevision: positiveInteger(), planningPolicyDigest: digest(), strategyOrdinal: positiveInteger(), sizeBudgetRevision: positiveInteger(),
    outputExtension: { const: 'mkv' }, video, audio: object({ mode: { const: 'copy' } }),
    outputContainer: { const: 'matroska' }, subtitle: object({ mode: { const: 'copy' } }), deviceClass: deviceClass(),
    previousIntentDigest: nullable(digest()), intentDigest: digest()
  };
  const required = Object.keys(properties).filter((field) => field !== 'previousIntentDigest');
  return { ...exactDomainSchema('EncodeIntent', properties, required, { 'x-helix-role': 'bounded-contract', allOf:[
    { if:{properties:{strategyOrdinal:{const:1}},required:['strategyOrdinal']},then:{not:{required:['previousIntentDigest']}} },
    { if:{properties:{strategyOrdinal:{minimum:2}},required:['strategyOrdinal']},then:{required:['previousIntentDigest'],properties:{previousIntentDigest:digest()}} },
    { if:{properties:{video:{properties:{dynamicRangeOperation:{const:'tone_map_to_sdr_bt709'}},required:['dynamicRangeOperation']}},required:['video']},
      then:{properties:{video:{properties:{pipelineProfileId:{const:'pq_bt2020_base_to_sdr_bt709_hevc@1'},outputDynamicRangeKind:{const:'sdr'},
        outputPixelFormat:{const:'yuv420p'},outputColorProfile:sdrBt709ColorProfile},required:['pipelineProfileId','outputDynamicRangeKind','outputPixelFormat','outputColorProfile']}}} }
  ] }), 'x-helix-maxCanonicalBytes': 16 * 1024 };
}

function remuxIntentSchema() {
  return { ...exactDomainSchema('RemuxIntent', { intentId: id(), revision: positiveInteger(), schemaRef: { const: 'RemuxIntent@1' }, libraRunId: id(),
    sourceHandleDigest: digest(), mediaRequirementDigest: digest(), outputContainer: { const: 'matroska' },
    outputExtension: { const: 'mkv' }, streamPolicy: { const: 'copy_all_supported' }, intentDigest: digest()
  }, undefined, { 'x-helix-role': 'bounded-contract' }), 'x-helix-maxCanonicalBytes': 16 * 1024 };
}

function resolvedProviderIdentitySchema() {
  return exactDomainSchema('ResolvedProviderIdentity', { provider: enumText('tmdb', 'jav', 'internal'),
    namespace: enumText('tmdb_movie', 'tmdb_series', 'jav_code', 'internal_identity'), providerKey: text(),
    seasonNumber: nullable(positiveInteger()), identityAnchorDigest: digest() });
}

function productStructureSchema() {
  const claim=object({episodeKey:text(),seasonClaimDigest:digest(),claimDigest:digest()});
  return exactDomainSchema('ProductStructure',{objectId:id(),revision:positiveInteger(),digest:digest(),subjectId:id(),
    structureKind:acceptanceStructureKind(),episodeClaims:arrayOf(claim,256),structureDigest:digest()});
}

function episodeDeliveryManifestSchema() {
  const claim=object({episodeKey:text(),seasonClaimDigest:digest(),outputRequirementDigest:digest(),claimDigest:digest()});
  return exactDomainSchema('EpisodeDeliveryManifest',{objectId:id(),revision:positiveInteger(),digest:digest(),libraRunId:id(),subjectId:id(),
    structureKind:acceptanceStructureKind(),seasonScopeDigest:nullable(digest()),episodeClaims:arrayOf(claim,256),deliveryDigest:digest()});
}

function identityRequirementSchema() {
  return {...exactDomainSchema('IdentityRequirement',{requirementId:id(),revision:positiveInteger(),schemaRef:{const:'IdentityRequirement@1'},
    expectedIdentityDigest:digest(),strengthClass:{const:'exact_provider_identity'},digest:digest()},undefined,
  {'x-helix-role':'bounded-contract'}),'x-helix-maxCanonicalBytes':16*1024};
}

function selectionCriteriaSchema() {
  return {...exactDomainSchema('SelectionCriteria',{contractId:id(),revision:positiveInteger(),schemaRef:{const:'SelectionCriteria@1'},
    queryDigest:digest(),strategy:{const:'available_provider_rank_then_candidate_id'},criteriaDigest:digest()},undefined,
  {'x-helix-role':'bounded-contract'}),'x-helix-maxCanonicalBytes':16*1024};
}

function workspaceDeliveryContractSchema() {
  return {...exactDomainSchema('WorkspaceDeliveryContract',{contractId:id(),revision:positiveInteger(),
    schemaRef:{const:'WorkspaceDeliveryContract@1'},libraRunId:id(),workspaceId:id(),expectedWorkspaceRevision:positiveInteger(),
    expectedWorkspaceStateDigest:digest(),rootSnapshot:applicationRef('PlatformWorkspaceRootSnapshot'),stableExternalMaterialHandleId:id(),
    verifiedPackageDigest:digest(),memberSelector:{const:'external_member_id'},externalMemberId:id(),targetRelativePath:text(),digest:digest()},
  undefined,{'x-helix-role':'bounded-contract'}),'x-helix-maxCanonicalBytes':32*1024};
}

function selectedCandidateSelectedSchema() {
  const value=selectedCandidateSelectedValueSchema();
  return {$schema:DRAFT,$id:domainTypeId('SelectedCandidateSelected'),title:'SelectedCandidateSelected@1',
    'x-helix-ssotRefs':['8.6.8','8.6.20'],'x-helix-role':'accepted-business-dto','x-helix-maxCanonicalBytes':64*1024,
    ...value};
}

function productStructureSnapshotSchema() {
  return exactDomainSchema('ProductStructureSnapshot', { structureKind: acceptanceStructureKind(), contentProfile: contentProfile(),
    productScopeDigest: digest(), episodeScopeDigest: digest(), primaryMaterialCount: positiveInteger(),
    structuralDependencyCount: nonNegativeInteger(), productStructureDigest: digest() });
}

function productConformanceFactSnapshotSchema() {
  const variant = (factKind, typeName) => object({ productFactId: id(), factKind: { const: factKind }, factRevision: positiveInteger(),
    schemaRef: { const: `helix://contracts/types/${typeName}/v1` }, factValue: typeRef(typeName), factDigest: digest(),
    evidenceDigest: digest(), referenceDigest: digest() });
  return { $schema: DRAFT, $id: domainTypeId('ProductConformanceFactSnapshot'), title: 'ProductConformanceFactSnapshot@1',
    'x-helix-ssotRefs': ['8.6.18', '8.6.19'], 'x-helix-role': 'accepted-business-dto',
    oneOf: [variant('resolved_identity', 'ResolvedProductIdentity'), variant('product_metadata', 'ProductMetadataFact'),
      variant('media_cast', 'MediaCastFact')] };
}

function episodeClaimSchema() {
  return object({ episodeKey: text(), seasonClaimDigest: digest(), claimDigest: digest() });
}

function productionMaterialLocationSchema() {
  return object({ locationKind: enumText('domain_binding', 'workspace_handle'), endpointId: id(),
    location: nullable(text()), rootHandleRef: nullable(id()), relativePath: nullable(text()) });
}

function candidateDeliveryOriginRefSchema() {
  return object({ intakeDecisionId:id(), offerId:id(), candidatePackageId:id(), packageRevision:positiveInteger(),
    packageDigest:digest(), candidateDeliverySnapshotDigest:digest(), relatedReferenceSetDigest:digest() });
}

function productionMaterialMemberSchema(manifestRole) {
  const properties = { ordinal: nonNegativeInteger(), materialKey: digest(),
    role: enumText('primary_payload', 'structural_dependency', 'metadata_sidecar', 'poster', 'fanart', 'subtitle', 'external_audio', 'chapter', 'sidecar'),
    physicalIdentity: typeRef('PhysicalMaterialIdentity'), sizeBytes:nonNegativeInteger(), location:productionMaterialLocationSchema(),
    bindingKind: enumText('libra_material_binding', 'workspace_material_reference'), bindingRevision: positiveInteger(),
    originCandidateDeliveryRef:nullable(candidateDeliveryOriginRefSchema()), workspaceReferenceId:nullable(id()),
    workspaceMaterialHandle:nullable(typeRef('WorkspaceMaterialHandle')),
    admittedControlRevision:nullable(positiveInteger()), admittedControlProjectionDigest:nullable(digest()),
    bindingEvidenceDigest: digest(), episodeClaims: arrayOf(episodeClaimSchema(), 32), episodeClaimSetDigest: digest(),
    outputRequirementDigest: digest(), memberDigest: digest() };
  if (manifestRole === 'product_delivery') Object.assign(properties, {
    sourceRelatedReferenceId:nullable(id()),derivedAuthorityDigest:nullable(digest()),
    controlOperation:enumText('assert_existing_input', 'assert_related_input', 'acquire_workspace_product'),
    expectedControlRevision:nullable(nonNegativeInteger()), expectedControlProjectionDigest:nullable(digest()),
    committedControlRevision:nullable(positiveInteger()), committedControlProjectionDigest:nullable(digest())
  });
  return object(properties, Object.keys(properties), {
    allOf: [{
      if: {
        properties: { role: { not: { const:'primary_payload' } } },
        required: ['role']
      },
      then: {
        properties: {
          episodeClaims: { maxItems:0 }
        }
      }
    }]
  });
}

function productionMaterialManifestSchema() {
  const branch = (manifestRole) => object({ manifestId:id(), manifestRole:{ const:manifestRole },
    manifestRevision:positiveInteger(), libraRunId:id(), scopeKind:enumText('single', 'episode_delivery'),
    members:{ ...arrayOf(productionMaterialMemberSchema(manifestRole), 1024), minItems:1 },
    memberSetDigest:digest(), episodeScopeDigest:digest(), manifestDigest:digest() });
  return { $schema:DRAFT, $id:domainTypeId('ProductionMaterialManifest'), title:'ProductionMaterialManifest@1',
    'x-helix-ssotRefs':['8.6.18', '8.6.19'], 'x-helix-role':'accepted-business-dto',
    oneOf:[branch('run_input'), branch('product_delivery')] };
}

function artifactManifestItemSchema() {
  return object({ artifactHandleId: id(), artifactKind: text(), artifactRevision: positiveInteger(), artifactDigest: digest(),
    requirementDigest: digest(), materializationState: enumText('workspace_only', 'included_product'), referenceDigest: digest() });
}

function artifactManifestSchema() {
  return exactDomainSchema('ArtifactManifest', { manifestId: id(), manifestRevision: positiveInteger(), libraRunId: id(),
    items: arrayOf(artifactManifestItemSchema(), 256), artifactSetDigest: digest(), manifestDigest: digest() });
}

function verifiedArtifactManifestItemSchema() {
  const resultRef = object({ workId:id(), attemptId:id(), planId:id(), eventId:id(), resultId:id(),
    capabilityRef:{ const:'shared.artifact.manifest.verify@1' },
    resultSchemaRef:{ const:'helix://contracts/types/ArtifactManifestVerification/v1' },
    resultDigest:digest(), inputBindingDigest:digest() });
  return object({ ordinal: nonNegativeInteger(), artifactHandleId: id(), artifactKind: text(), artifactRevision: positiveInteger(),
    artifactDigest: digest(), requirementId:id(), requirementRevision:positiveInteger(), requirementSchemaRef:text(),
    requirementDigest: digest(), verificationEvidenceId: id(), verificationEvidenceDigest: digest(),
    verificationResultRef:resultRef, referenceDigest: digest() });
}

function artifactVerificationResultRefSchema() {
  return object({ workId:id(), attemptId:id(), planId:id(), eventId:id(), resultId:id(),
    capabilityRef:{ const:'shared.artifact.manifest.verify@1' },
    resultSchemaRef:{ const:'helix://contracts/types/ArtifactManifestVerification/v1' },
    resultDigest:digest(), inputBindingDigest:digest() });
}

function artifactConformanceVerificationSnapshotSchema() {
  return exactDomainSchema('ArtifactConformanceVerificationSnapshot', { ordinal: nonNegativeInteger(),
    verifiedManifestItem: verifiedArtifactManifestItemSchema(), artifactManifestItem: nullable(artifactManifestItemSchema()),
    verificationResultRef: artifactVerificationResultRefSchema(), verificationValue: typeRef('ArtifactManifestVerification'),
    snapshotDigest: digest() });
}

function productInventoryConformanceSnapshotSchema() {
  return exactDomainSchema('ProductInventoryConformanceSnapshot', { productStructureSnapshot: domainRef('ProductStructureSnapshot'),
    productMaterialManifest: domainRef('ProductionMaterialManifest'), artifactManifest: domainRef('ArtifactManifest'), inventoryDigest: digest() });
}

function productionSourceScopeReferenceSchema() {
  return { ...exactDomainSchema('ProductionSourceScopeReference', {
    schemaRef: { const: 'ProductionSourceScopeReference@1' }, schemaVersion: { const: 1 },
    libraRunId: id(), scopeKind: enumText('stream_file', 'bdmv', 'dvd', 'iso'), scopeId: id(),
    scopeDigest: digest(), memberSetDigest: digest(), memberCount: { type:'integer', minimum:1, maximum:1024 },
    selectedPayloadSetDigest: digest(), sourceReferenceDigest: digest()
  }, undefined, { 'x-helix-role':'bounded-contract' }), 'x-helix-maxCanonicalBytes': 16 * 1024 };
}

function mediaExecutionDeviceSnapshotSchema() {
  const workerRef = object({ workerId: id(), workerRevision: positiveInteger(), capabilityDigest: digest() });
  const pipeline = object({ pipelineProfileId:text(),
    inputDynamicRangeKinds:{ ...arrayOf(enumText('sdr','hdr10_compatible','hlg','dolby_vision','unknown'), 5), minItems:1, uniqueItems:true },
    inputPixelFormats:{ ...arrayOf(text(), 32), minItems:1, uniqueItems:true }, outputCodec:{ const:'hevc' },
    outputDynamicRangeKind:enumText('sdr','hdr10_compatible','hlg','dolby_vision','unknown'), outputPixelFormat:text(),
    outputColorProfile:object({ range:text(),primaries:text(),transfer:text(),matrix:text() }), selfTestDigest:digest() });
  const capabilityPayload = object({ supportedVideoCodecs: { ...arrayOf(text(), 64), minItems: 1 },
    supportedRateControlModes: { ...arrayOf(enumText('target_size', 'quality_bound', 'two_pass_abr', 'strict_abr'), 4), minItems: 1 },
    validatedConcurrentSlots: { type: 'integer', minimum: 1, maximum: 1024 },
    validatedVideoPipelines:{ ...arrayOf(pipeline, 32), minItems:1 } });
  return { ...exactDomainSchema('MediaExecutionDeviceSnapshot', { deviceId: id(), deviceClass: deviceClass(),
    probeRevision: positiveInteger(), capabilitySchemaRef: text(), capabilityPayload, capabilityDigest: digest(),
    enabled: { const: true }, state: { const: 'ready' }, workerRef: nullable(workerRef), snapshotDigest: digest() }),
    'x-helix-maxCanonicalBytes': 16 * 1024 };
}

function aftercareMediaRepairStrategySchema() {
  const priorAssessment = object({
    deviceId: id(),
    deviceClass: deviceClass(),
    deviceSnapshotDigest: digest(),
    disposition: enumText('strategy_rejected'),
    rejectionScope: enumText('device_pipeline', 'rate_control_strategy'),
    reasonCodes: arrayOf(text(), 16),
    preflightDigest: digest(),
  });
  const video = object({
    codec: { const: 'hevc' },
    rateControlMode: enumText('target_size', 'quality_bound', 'two_pass_abr', 'strict_abr'),
    targetVideoBitrateBps: nullable(positiveInteger()),
    qualityBound: nullable({ type: 'integer', minimum: 0, maximum: 63 }),
    dynamicRangeOperation: enumText('preserve', 'tone_map_to_sdr_bt709'),
    pipelineProfileId: text(),
    outputDynamicRangeKind: enumText('sdr', 'hdr10_compatible', 'hlg', 'dolby_vision', 'unknown'),
    outputPixelFormat: text(),
    outputColorProfile: object({ range:text(), primaries:text(), transfer:text(), matrix:text() }),
  });
  return { ...exactDomainSchema('AftercareMediaRepairStrategy', {
    schemaRef: { const: domainTypeId('AftercareMediaRepairStrategy') },
    schemaVersion: { const: 1 },
    strategyId: id(),
    revision: { const: 1 },
    careBasisDigest: digest(),
    sourceHandleDigest: digest(),
    sourceProbeEvidenceId: id(),
    sourceProbeEvidenceDigest: digest(),
    sourceVideoProfileDigest: digest(),
    selectedDeviceSnapshot: domainRef('MediaExecutionDeviceSnapshot'),
    selectedDeviceSnapshotDigest: digest(),
    selectedDeviceClass: deviceClass(),
    video,
    priorStrategyAssessments: arrayOf(priorAssessment, 64),
    selectedPreflightDigest: digest(),
    strategyDigest: digest(),
    digest: digest(),
  }), 'x-helix-maxCanonicalBytes': 64 * 1024 };
}

function workspaceMediaOutputTargetSchema() {
  return { ...exactDomainSchema('WorkspaceMediaOutputTarget', { targetId: id(), libraRunId: id(), executionBasisDigest: digest(),
    workspaceId: id(), expectedWorkspaceRevision: positiveInteger(), expectedWorkspaceStateDigest: digest(),
    rootSnapshot: applicationRef('PlatformWorkspaceRootSnapshot'), workspaceScopeDigest: digest(), targetRelativePath: text(),
    outputRole: { const: 'product_media' }, productionIntentDigest: digest(), effectScopeDigest: digest(), targetDigest: digest() }),
    'x-helix-maxCanonicalBytes': 16 * 1024 };
}

function scalarTypedParameterSchema() {
  const common = { parameter: text({ pattern: '^[a-z][a-zA-Z0-9_.-]{0,127}$' }), valueDigest: digest() };
  return {
    oneOf: [
      object({ ...common, valueType: { const: 'string' }, value: { type: 'string' } }),
      object({ ...common, valueType: { const: 'integer' }, value: { type: 'integer' } }),
      object({ ...common, valueType: { const: 'number' }, value: { type: 'number' } }),
      object({ ...common, valueType: { const: 'boolean' }, value: { type: 'boolean' } })
    ]
  };
}

function scalarTypedParameters() {
  return {
    ...arrayOf(scalarTypedParameterSchema(), 64),
    uniqueItems: true,
    'x-helix-canonicalOrder': 'parameter UTF-8 bytes',
    'x-helix-uniqueBy': 'parameter'
  };
}

function samplingPlanSchema() {
  return {
    ...exactDomainSchema('SamplingPlan', {
      contractId: id(), revision: positiveInteger(), schemaRef: { const: domainTypeId('SamplingPlan') },
      intervalMs: { type: 'integer', minimum: 1, maximum: 86400000 },
      maxFrames: { type: 'integer', minimum: 1, maximum: 1024 }, frameProfileDigest: digest(),
      typedParameters: scalarTypedParameters(), digest: digest()
    }),
    'x-helix-role': 'bounded-contract', 'x-helix-maxCanonicalBytes': 16 * 1024
  };
}

function faceModelRefSchema() {
  return {
    ...exactDomainSchema('FaceModelRef', {
      contractId: id(), revision: positiveInteger(), schemaRef: { const: domainTypeId('FaceModelRef') },
      mode: enumText('western_frame_set', 'single_reference_face'), modelId: id(), modelRevision: positiveInteger(),
      modelDigest: digest(), runtimeKind: { const: 'onnx' }, inputContractDigest: digest(),
      outputContractDigest: digest(), licenseDigest: digest(), typedParameters: scalarTypedParameters(), digest: digest()
    }),
    'x-helix-role': 'bounded-contract', 'x-helix-maxCanonicalBytes': 16 * 1024
  };
}

function clusterParametersSchema() {
  return {
    ...exactDomainSchema('ClusterParameters', {
      parameterSetId: id(), revision: positiveInteger(), schemaRef: { const: domainTypeId('ClusterParameters') },
      modelRefDigest: digest(), distanceMetric: { const: 'cosine' },
      distanceThreshold: { type: 'number', minimum: 0, maximum: 1 }, minClusterSize: positiveInteger(),
      typedParameters: scalarTypedParameters(), digest: digest()
    }),
    'x-helix-role': 'bounded-contract', 'x-helix-maxCanonicalBytes': 16 * 1024
  };
}

function analysisSpecSchema() {
  return {
    ...exactDomainSchema('AnalysisSpec', {
      specId: id(), revision: positiveInteger(), schemaRef: { const: domainTypeId('AnalysisSpec') },
      libraRunId: id(), runExecutionBasisDigest: digest(), contentProfile: { const: 'western_adult' },
      sourceMaterialDigest: digest(), frameArtifactSetDigest: digest(), faceModelRefDigest: digest(),
      clusterParameterDigest: digest(), analysisVariantRef: text({ maxLength: 512 }),
      outputContractRef: { const: 'helix://contracts/types/WesternAnalysisResult/v1' },
      outputContractDigest: digest(), typedParameters: scalarTypedParameters(), specDigest: digest()
    }),
    'x-helix-role': 'bounded-contract', 'x-helix-maxCanonicalBytes': 16 * 1024
  };
}

function workspaceArtifactOutputTargetSchema() {
  return {
    ...exactDomainSchema('WorkspaceArtifactOutputTarget', {
      targetId: id(), libraRunId: id(), executionBasisDigest: digest(), workspaceId: id(),
      expectedWorkspaceRevision: positiveInteger(), expectedWorkspaceStateDigest: digest(),
      rootSnapshot: applicationRef('PlatformWorkspaceRootSnapshot'),
      workspaceScopeDigest: digest(), targetRelativePath: text(), outputKind: enumText('frame_set', 'western_analysis'),
      sourceInputDigest: digest(), effectScopeDigest: digest(), targetDigest: digest()
    }),
    'x-helix-maxCanonicalBytes': 16 * 1024
  };
}

function productMediaCandidateInputSchema() {
  const common = { schemaRef: { const: domainTypeId('ProductMediaCandidateInput') }, schemaVersion: { const: 1 }, candidateId: id(),
    candidateNodeId: id(), candidateBasisDigest: digest(), libraRunId: id(), mediaRequirement: mediaRequirementValueSchema(), inputDigest: digest() };
  const direct = object({ ...common, candidateKind: { const: 'direct_input' }, sourceMaterialHandle: typeRef('PhysicalMaterialReadHandle'),
    sourceProbeEvidence: typeRef('MediaProbeEvidence') });
  const workspace = object({ ...common, candidateKind: { const: 'workspace_output' }, workspaceMediaHandle: typeRef('WorkspaceMediaHandle'),
    sourceProbeEvidence: typeRef('MediaProbeEvidence'), outputProbeEvidence: typeRef('MediaProbeEvidence') });
  return { $schema: DRAFT, $id: domainTypeId('ProductMediaCandidateInput'), title: 'ProductMediaCandidateInput@1',
    'x-helix-ssotRefs': ['8.6.18'], 'x-helix-role': 'accepted-business-dto', 'x-helix-maxCanonicalBytes': 64 * 1024,
    oneOf: [direct, workspace] };
}

function productOutputSelectionInputSchema() {
  const rankedCandidate = object({ rank: positiveInteger(), candidateId: id(), candidateNodeId: id() });
  const criteria = object({ criteriaId: id(), libraRunId: id(), acceptanceSpecId: id(), acceptanceSpecRecordDigest: digest(),
    mediaRequirementDigest: digest(), rankedCandidates: { ...arrayOf(rankedCandidate, 32), minItems: 1 },
    tieBreak: { const: 'verification_id_utf8' }, criteriaDigest: digest() });
  return { ...exactDomainSchema('ProductOutputSelectionInput', { criteria,
    candidates: { ...arrayOf(typeRef('ProductMediaVerification'), 32), minItems: 1 }, candidateSetDigest: digest(), inputDigest: digest() }),
    'x-helix-maxCanonicalBytes': 512 * 1024 };
}

function productConformanceInputSnapshotSchema() {
  const selected = object({ selectedProduct: typeRef('SelectedProductOutput'), verification: typeRef('ProductMediaVerification'),
    workspaceHandleDigest: nullable(digest()) });
  return { ...exactDomainSchema('ProductConformanceInputSnapshot', { snapshotId: id(), libraRunId: id(), runExecutionBasisDigest: digest(),
    acceptanceSpec: acceptanceSpecValueSchema(), resolvedIdentitySnapshot: domainRef('ProductConformanceFactSnapshot'),
    productStructureSnapshot: domainRef('ProductStructureSnapshot'),
    productFactSnapshots: { ...arrayOf(domainRef('ProductConformanceFactSnapshot'), 3), minItems: 1 },
    verifiedArtifactManifest: domainRef('VerifiedArtifactManifest'),
    artifactVerificationSnapshots: arrayOf(domainRef('ArtifactConformanceVerificationSnapshot'), 256),
    inventorySnapshot: domainRef('ProductInventoryConformanceSnapshot'),
    selectedProducts: { ...arrayOf(selected, 32), minItems: 1 }, productFactSetDigest: digest(),
    artifactVerificationSetDigest: digest(), selectedProductSetDigest: digest(), productSnapshotDigest: digest(), snapshotDigest: digest()
  }), 'x-helix-maxCanonicalBytes': 8 * 1024 * 1024 };
}

function productDispositionManifestSchema() {
  const dispositionMember = object({
    ordinal: nonNegativeInteger(),
    sourceMaterialKey: digest(),
    sourceRelatedReferenceId: nullable(id()),
    finalMaterialKey: digest(),
    finalRole: enumText('primary_payload', 'structural_dependency', 'related', 'artifact'),
    dispositionKind: enumText('direct_carried', 'carried_forward', 'replaced_and_settled'),
    sourceToFinalMappingDigest: digest(),
    memberDigest: digest(),
  });
  return {
    ...exactDomainSchema('ProductDispositionManifest', {
      schemaRef: { const: domainTypeId('ProductDispositionManifest') },
      schemaVersion: { const: 1 },
      objectId: id(),
      revision: positiveInteger(),
      digest: digest(),
      manifestId: id(),
      onDeckRunId: id(),
      productManifestDigest: digest(),
      relatedDispositionSetDigest: digest(),
      members: { ...arrayOf(dispositionMember, 4096), minItems: 1 },
      memberSetDigest: digest(),
      manifestDigest: digest(),
    }),
    'x-helix-maxCanonicalBytes': 8 * 1024 * 1024,
  };
}

function oldPrimaryStructuralExclusiveRelatedHandlesSchema() {
  const member = object({
    ordinal: nonNegativeInteger(),
    materialKey: digest(),
    role: enumText('primary_payload', 'structural_dependency', 'exclusive_related'),
    sourceRelatedReferenceId: nullable(id()),
    materialHandle: typeRef('PhysicalMaterialReadHandle'),
    dispositionMemberRef: id(),
    sourceToFinalMappingDigest: digest(),
    finalProductVerificationDigest: digest(),
    memberDigest: digest(),
  });
  return {
    ...exactDomainSchema('OldPrimaryStructuralExclusiveRelatedHandles', {
      schemaRef: { const: domainTypeId('OldPrimaryStructuralExclusiveRelatedHandles') },
      schemaVersion: { const: 1 },
      objectId: id(),
      revision: positiveInteger(),
      digest: digest(),
      onDeckRunId: id(),
      approvalScopeDigest: digest(),
      members: { ...arrayOf(member, 4096), minItems: 1 },
      memberSetDigest: digest(),
      handleSetDigest: digest(),
    }),
    'x-helix-maxCanonicalBytes': 16 * 1024 * 1024,
  };
}

function boundedSnapshotValue(kind) {
  return object({ objectId: id(), revision: positiveInteger(), schemaRef: text(), objectKind: { const: kind }, snapshotDigest: digest() });
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
