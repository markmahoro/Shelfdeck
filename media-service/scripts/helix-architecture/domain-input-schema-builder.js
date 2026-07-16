'use strict';

const crypto = require('crypto');

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
const domainTypeId = (name) => `helix://contracts/domain-types/${name}/v1`;
const typeRef = (name) => ({ $ref: `helix://contracts/types/${name}/v1` });
const text = (options = {}) => ({ type: 'string', minLength: 1, ...options });
const id = () => text({ maxLength: 256 });
const digest = () => text({ pattern: '^[a-f0-9]{64}$' });
const positiveInteger = () => ({ type: 'integer', minimum: 1 });
const nonNegativeInteger = () => ({ type: 'integer', minimum: 0 });
const bool = () => ({ type: 'boolean' });
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
  'AcceptanceSpec.contentProfile': enumText('movie', 'season', 'jav', 'western_adult'),
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
  'PreferenceIntent.preferenceLevel': { type: 'integer', minimum: -2, maximum: 2 },
  'SamplingPlan.maxFrames': positiveInteger(),
  'ShelfStandard.contentProfile': enumText('movie', 'season', 'jav', 'western_adult'),
  'StructureRequirement.structureKind': enumText('single', 'season'),
  'AcceptedIntakePayload.candidatePackage': typeRef('CandidatePackage'),
  'AcceptedIntakePayload.bindingDraft': typeRef('LibraBindingDraft'),
  'AcceptedPayload.onDeckProductPackage': typeRef('OnDeckProductPackage'),
  'ActiveShelfEntryIdentityProjection.entries': arrayOf(snapshot('active-shelf-entry-identity'), 4096),
  'CandidateDraft.primaryInputManifest': typeRef('PrimaryInputManifest'),
  'CandidateDraft.identityClaim': typeRef('IdentityClaim'),
  'CandidateMaterialLocationEvidence.materials': arrayOf(object({
    materialKey: digest(), endpointId: id(), location: text(), bindingRevision: positiveInteger(), evidenceDigest: digest()
  }), 4096),
  'CandidateSnapshot.candidatePackage': typeRef('CandidatePackage'),
  'CareBasis.assessments': arrayOf(snapshot('professional-assessment'), 1024),
  'CurrentInventoryControl.materials': arrayOf(object({ materialKey: digest(), inventoryRevision: positiveInteger(), controlRevision: positiveInteger() }), 4096),
  'DecisionEvidence.queryResults': arrayOf(typeRef('VersionedQueryResult'), 256),
  'DecisionInputSet.inputs': arrayOf(snapshot('decision-input'), 256),
  'DestructionScope.materialKeys': arrayOf(digest(), 4096),
  'FinalBindings.bindings': arrayOf(snapshot('arca-material-binding'), 4096),
  'FinalInventoryDecision.members': arrayOf(snapshot('final-inventory-member'), 4096),
  'ImmutableRecords.records': arrayOf(snapshot('immutable-perception-record'), 4096),
  'InventoryMetadataArtifactRefs.metadataFactRefs': arrayOf(id(), 1024),
  'InventoryMetadataArtifactRefs.artifactHandles': arrayOf(typeRef('ArtifactHandle'), 1024),
  'KnownBindings.bindings': arrayOf(snapshot('arca-material-binding'), 4096),
  'LibraWorkspaceScope.workspaceHandles': arrayOf(typeRef('WorkspaceMaterialHandle'), 4096),
  'Manifests.manifestRefs': arrayOf(id(), 128),
  'MaterialFieldContext.fieldRefs': arrayOf(snapshot('material-field-context'), 128),
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
  'RegistrationMergeDecision.decisionKind': enumText('registration', 'merge'),
  'ReleaseManifest.materialKeys': arrayOf(digest(), 4096),
  'Roles.roles': arrayOf(text(), 128),
  'SelectedFieldMaterialSet.materialKeys': arrayOf(digest(), 4096),
  'SelectedMaterials.materialKeys': arrayOf(digest(), 4096),
  'SourceObservation.observations': arrayOf(snapshot('source-observation'), 4096),
  'StructuredRejection.reasonCodes': arrayOf(text(), 128),
  'TargetBindings.bindings': arrayOf(snapshot('target-material-binding'), 4096),
  'TypedManifest.manifest': snapshot('typed-manifest'),
  'VerifiedArtifactManifest.artifactHandles': arrayOf(typeRef('ArtifactHandle'), 1024),
  'VerifiedCareInventoryChange.verifications': arrayOf(typeRef('CareProductVerification'), 1024),
  'VerifiedProduct.verifications': arrayOf(typeRef('ProductConformanceEvidence'), 1024)
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
  AcceptedIntakePayload: 'candidatePackage,bindingDraft,subjectId,controlScopeDigest',
  AcceptedPayload: 'onDeckProductPackage,acceptanceDecisionId,custodyDigest',
  AcceptedProductFacts: 'shelfEntryId,inventoryRevision,productFactSetDigest',
  ActiveShelfEntryIdentityProjection: 'entries,projectionRevision',
  CandidateDraft: 'procurementRunId,primaryInputManifest,identityClaim,relatedReferenceSetDigest',
  CandidateMaterialLocationEvidence: 'materials',
  CandidateSnapshot: 'candidatePackage,snapshotRevision',
  CareBasis: 'shelfEntryId,inventoryRevision,standardRevision,placementRevision,decisionFactSetDigest,assessments',
  CurrentInventoryControl: 'shelfId,materials',
  DecisionEvidence: 'subjectId,queryResults,routingInputDigest,specInputDigest',
  DecisionInputSet: 'subjectId,inputs,inputSetDigest',
  DestructionScope: 'destructionScopeId,inventoryRevision,materialKeys,controlRevisionSetDigest',
  EpisodeDeliveryManifest: 'episodeClaims,deliveryDigest',
  FinalBindings: 'shelfEntryId,bindings,bindingSetDigest',
  FinalInventoryDecision: 'onDeckRunId,shelfId,members,placementRevision,decisionDigest',
  FinalReality: 'shelfEntryId,inventoryRevision,realityDigest',
  IdentityMetadata: 'claimedTitle,contentProfileHint,providerHints,identityMetadataDigest',
  ImmutableRecords: 'records,recordSetDigest',
  InventoryMetadataArtifactRefs: 'shelfEntryId,inventoryRevision,metadataFactRefs,artifactHandles',
  InventoryRevision: 'shelfEntryId,inventoryRevision,inventoryDigest',
  KnownBindings: 'shelfEntryId,bindings,bindingSetDigest',
  LibraWorkspaceScope: 'workspaceId,workspaceHandles,scopeDigest',
  Manifests: 'manifestRefs,manifestSetDigest',
  MaterialFieldContext: 'fieldRefs,contextDigest',
  OffLoadContext: 'onDeckPackageId,materials,contextDigest',
  PackageIdentity: 'onDeckPackageId,resolvedIdentityDigest,packageDigest',
  PeopleWorkspace: 'workspaceId,workspaceHandles,scopeDigest',
  PerceptionSource: 'sourceId,sourceKind,sourceRevision,sourceDigest',
  PersonIdentitiesAliasesReferences: 'people,peopleSetDigest',
  PersonReferenceProjection: 'projectionRevision,people,projectionDigest',
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
  RegistrationMergeDecision: 'decisionKind,candidateId,decisionDigest',
  RelatedReference: 'shelfEntryId,referenceId,materialKey,referenceDigest',
  ReleaseManifest: 'deregistrationId,shelfId,materialKeys,controlRevisionSetDigest,manifestDigest',
  ResolutionRuleRevision: 'ruleSetId,ruleRevision,ruleDigest',
  Roles: 'roles,roleSetDigest',
  Scope: 'scopeId,materialKeys,scopeDigest',
  SelectedFieldMaterialSet: 'procurementRunId,fieldId,materialKeys,selectionDigest',
  SelectedMaterials: 'procurementRunId,materialKeys,selectionDigest',
  SourceObservation: 'sourceId,observations,observationSetDigest',
  StableProviderIdentity: 'providerId,providerObjectId,identityRevision,identityDigest',
  Standard: 'standardId,standardRevision,standardDigest',
  Structure: 'structureKind,memberClaims,structureDigest',
  StructuredRejection: 'handoffKind,deliverableId,reasonCodes,rejectionDigest',
  TargetBindings: 'targetCommitSlotId,bindings,bindingSetDigest',
  TargetEndpoint: 'endpointId,mountScopeRevision,capacityObservationDigest',
  TypedManifest: 'manifest,contractRef,verificationDigest',
  VerifiedArtifactManifest: 'manifestDigest,artifactHandles,verificationId',
  VerifiedCareInventoryChange: 'aftercareCaseId,verifications,changeDigest',
  VerifiedProduct: 'libraRunId,verifications,productFactSetDigest'
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
