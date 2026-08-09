'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildDomainInputSchemas } = require('../../scripts/helix-architecture/domain-input-schema-builder');

const schemas = buildDomainInputSchemas();

test('builds exactly the 109 formal domain input contracts', () => {
  assert.equal(Object.keys(schemas).length, 109);
  assert.equal(Object.values(schemas).filter((schema) => schema['x-helix-role'] === 'bounded-contract').length, 24);
  assert.equal(Object.values(schemas).filter((schema) => schema['x-helix-role'] === 'accepted-business-dto').length, 85);
});

test('materializes the exact service-local Western analysis construction inputs', () => {
  const target = schemas.WorkspaceArtifactOutputTarget;
  assert.deepEqual(target.properties.outputKind.enum, ['frame_set', 'western_analysis']);
  assert.equal(target.properties.rootSnapshot.additionalProperties, false);
  assert.equal(target['x-helix-maxCanonicalBytes'], 16 * 1024);

  const sampling = schemas.SamplingPlan;
  assert.equal(sampling.properties.intervalMs.minimum, 1);
  assert.equal(sampling.properties.intervalMs.maximum, 86400000);
  assert.equal(sampling.properties.maxFrames.minimum, 1);
  assert.equal(sampling.properties.maxFrames.maximum, 1024);
  assert.equal(sampling.properties.typedParameters.maxItems, 64);
  assert.equal(sampling.properties.typedParameters.items.oneOf.length, 4);

  const model = schemas.FaceModelRef;
  assert.deepEqual(model.properties.mode.enum, ['western_frame_set', 'single_reference_face']);
  assert.equal(model.properties.runtimeKind.const, 'onnx');
  assert.ok(model.required.includes('licenseDigest'));

  const cluster = schemas.ClusterParameters;
  assert.equal(cluster.properties.distanceMetric.const, 'cosine');
  assert.equal(cluster.properties.distanceThreshold.minimum, 0);
  assert.equal(cluster.properties.distanceThreshold.maximum, 1);
  assert.ok(cluster.required.includes('modelRefDigest'));

  const analysis = schemas.AnalysisSpec;
  assert.equal(analysis.properties.contentProfile.const, 'western_adult');
  assert.equal(analysis.properties.outputContractRef.const,
    'helix://contracts/types/WesternAnalysisResult/v1');
  assert.ok(analysis.required.includes('frameArtifactSetDigest'));
  assert.ok(analysis.required.includes('clusterParameterDigest'));
});

test('freezes product fact source basis variants and exact artifact manifest inputs', () => {
  const mediaCastBasis = schemas.LibraMediaCastSourceBasisMetadataObservationWesternMatch;
  const metadataBasis = schemas.LibraProductMetadataSourceBasisMetadataObservationWesternAnalysis;
  assert.deepEqual(mediaCastBasis.oneOf.map((branch) => branch.properties.sourceBasisKind.const),
    ['metadata_observation', 'western_match']);
  assert.deepEqual(metadataBasis.oneOf.map((branch) => branch.properties.sourceBasisKind.const),
    ['metadata_observation', 'western_analysis']);
  assert.equal(metadataBasis.oneOf[0].properties.selection.properties.items.minItems, 1);
  assert.equal(metadataBasis.oneOf[0].properties.observationSet.properties.sourcePrecedence.items.additionalProperties, false);
  assert.equal(metadataBasis.oneOf[1].properties.westernBasis.properties.analysisRefs.minItems, 1);
  const westernAnalysisRef = metadataBasis.oneOf[1].properties.westernBasis.properties.analysisRefs.items;
  assert.ok(westernAnalysisRef.required.includes('analysisArtifactHandleId'));
  assert.ok(westernAnalysisRef.required.includes('analysisArtifactDigest'));
  assert.equal(westernAnalysisRef.properties.externalJobReceiptId, undefined);
  assert.ok(mediaCastBasis.oneOf[1].properties.westernBasis.required.includes('referenceProjectionSetDigest'));
  assert.equal(schemas.VerifiedArtifactManifest.properties.items.maxItems, 256);
  const requirement = schemas.ArtifactRequirement;
  for (const field of ['requirementId', 'revision', 'schemaRef', 'artifactKind', 'requirementPayload', 'requirementDigest']) {
    assert.ok(requirement.required.includes(field), field);
  }
  assert.equal(requirement['x-helix-maxCanonicalBytes'], 16 * 1024);
  const manifestItem = schemas.VerifiedArtifactManifest.properties.items.items;
  for (const field of ['requirementId', 'requirementRevision', 'requirementSchemaRef', 'verificationResultRef']) {
    assert.ok(manifestItem.required.includes(field), field);
  }
  assert.equal(manifestItem.properties.verificationResultRef.properties.capabilityRef.const,
    'shared.artifact.manifest.verify@1');
  assert.equal(schemas.MetadataFetchIntent.oneOf[0].properties.sourcePriority.minimum, 0);
  assert.deepEqual(schemas.MetadataFetchIntent.oneOf[0].properties.contentProfile.enum, ['movie', 'series', 'jav']);
  const providerIntent = schemas.MetadataFetchIntent.oneOf[1];
  assert.ok(providerIntent.required.includes('resolvedProviderIdentity'));
  assert.equal(
    providerIntent.properties.resolvedProviderIdentity.$ref,
    'helix://contracts/domain-types/ResolvedProviderIdentity/v1',
  );
});

test('freezes executable Perception resolution inputs and removes digest-only placeholders', () => {
  assert.equal(schemas.ImmutableRecords, undefined);
  assert.equal(schemas.ResolutionRuleRevision, undefined);
  assert.equal(schemas.PerceptionResolutionQuery.properties.identityEvidence.maxItems, 16);
  assert.deepEqual(schemas.PerceptionResolutionQuery.properties.factKind.enum, ['rating', 'watched']);
  assert.equal(schemas.PerceptionResolutionRecordSet.properties.records.maxItems, 256);
  assert.equal(schemas.PerceptionResolutionRecordSet.properties.relations.maxItems, 1024);
  assert.equal(schemas.PerceptionResolutionRecordSet.properties.records.items.properties.identityAnchors.maxItems, 16);
  assert.equal(schemas.PerceptionResolutionRuleSnapshot.properties.maxCandidateRecords.const, 256);
  assert.equal(schemas.PerceptionResolutionRuleSnapshot.properties.candidateRetrievalClauses.maxItems, 32);
  assert.equal(schemas.PerceptionResolutionRuleSnapshot.properties.anchorMatchers.maxItems, 32);
  assert.equal(schemas.PerceptionResolutionRuleSnapshot.properties.duplicateProofMatchers.maxItems, 32);
});

test('freezes the three exact Perception acquisition named inputs', () => {
  assert.equal(schemas.PerceptionSource, undefined);
  assert.equal(schemas.SourceObservation, undefined);
  assert.equal(schemas.PerceptionNormalizationRuleRef.properties.canonicalRatingScale.const, 'integer_1_5');
  assert.equal(schemas.PerceptionAcquisitionCursor.properties.pageBudget.minimum, 1);
  assert.equal(schemas.PerceptionAcquisitionCursor.properties.pageOrdinal.minimum, 0);
  assert.deepEqual(schemas.PerceptionAcquisitionCursor.properties.cursorIn.anyOf.at(-1), { type: 'null' });
  assert.deepEqual(schemas.PerceptionSourceSnapshot.required.sort(), [
    'digest', 'integrationId', 'objectId', 'revision', 'schemaRef', 'schemaVersion', 'sourceConfigRevision',
    'sourceId', 'sourceKind', 'sourceScopeDigest'
  ].sort());
});

test('legacy bounded inputs stay generic while media intents are exact and typed', () => {
  for (const name of ['ArtifactProfile', 'ShelfStandard']) {
    const schema = schemas[name];
    for (const field of ['schemaRef', 'schemaVersion', 'revision', 'digest', 'typedParameters']) assert.ok(schema.required.includes(field));
    assert.equal(schema.properties.typedParameters.items.additionalProperties, false);
  }
  assert.equal(schemas.EncodeIntent.properties.typedParameters, undefined);
  assert.equal(schemas.EncodeIntent.properties.schemaRef.const, 'EncodeIntent@1');
  assert.equal(schemas.EncodeIntent.properties.intentDigest.pattern, '^[a-f0-9]{64}$');
  assert.equal(schemas.EncodeIntent.properties.video.oneOf.length, 2);
  assert.equal(schemas.EncodeIntent.properties.video.oneOf[0].properties.rateControlMode.const, 'target_size');
  assert.equal(schemas.EncodeIntent.properties.video.oneOf[1].properties.rateControlMode.const, 'quality_bound');
  assert.equal(schemas.RemuxIntent.properties.streamPolicy.const, 'copy_all_supported');
  assert.equal(schemas.RemuxIntent.properties.schemaRef.const, 'RemuxIntent@1');
  assert.equal(schemas.MediaRequirement.properties.schemaRef.const, 'MediaRequirement@1');
  assert.equal(schemas.MediaRequirement.properties.mandatoryMedia.additionalProperties, false);
  assert.equal(schemas.ProductConformanceInputSnapshot.properties.inventorySnapshot.$ref,
    'helix://contracts/domain-types/ProductInventoryConformanceSnapshot/v1');
  const productionManifest = schemas.ProductionMaterialManifest;
  assert.deepEqual(productionManifest.oneOf.map((branch) => branch.properties.manifestRole.const), ['run_input', 'product_delivery']);
  for (const branch of productionManifest.oneOf) {
    assert.ok(branch.required.includes('scopeKind'));
    const member = branch.properties.members.items;
    for (const field of ['sizeBytes', 'location', 'originCandidateDeliveryRef', 'workspaceReferenceId',
      'workspaceMaterialHandle', 'admittedControlRevision', 'admittedControlProjectionDigest']) assert.ok(member.required.includes(field));
    assert.equal(member.properties.location.additionalProperties, false);
    assert.deepEqual(member.properties.location.required, ['locationKind', 'endpointId', 'location', 'rootHandleRef', 'relativePath']);
    assert.equal(member.allOf[0].if.properties.role.not.const, 'primary_payload');
    assert.equal(member.allOf[0].then.properties.episodeClaims.maxItems, 0);
  }
  const deliveryMember = productionManifest.oneOf[1].properties.members.items;
  for (const field of ['controlOperation', 'expectedControlRevision', 'expectedControlProjectionDigest',
    'committedControlRevision', 'committedControlProjectionDigest']) assert.ok(deliveryMember.required.includes(field));
  assert.equal(productionManifest.oneOf[0].properties.members.items.properties.controlOperation, undefined);
  assert.equal(schemas.BoundedFingerprintProfile.properties.profileRef.const, 'middle-256k-sha256@1');
  assert.equal(schemas.BoundedFingerprintProfile.properties.algorithm.const, 'middle-256k-sha256');
  assert.equal(schemas.BoundedFingerprintProfile.properties.maxSampleBytes.const, 262144);
});

test('conserves complete run-input and product-delivery Production Material members', () => {
  const location = { locationKind:'domain_binding', endpointId:'endpoint-1', location:'movie.mkv', rootHandleRef:null, relativePath:null };
  const common = { ordinal:0, materialKey:'a'.repeat(64), role:'primary_payload', physicalIdentity:{}, sizeBytes:1,
    location, bindingKind:'libra_material_binding', bindingRevision:1, bindingEvidenceDigest:'b'.repeat(64),
    originCandidateDeliveryRef:{ intakeDecisionId:'intake-1', offerId:'offer-1', candidatePackageId:'candidate-1',
      packageRevision:1, packageDigest:'c'.repeat(64), candidateDeliverySnapshotDigest:'d'.repeat(64), relatedReferenceSetDigest:'e'.repeat(64) },
    workspaceReferenceId:null, workspaceMaterialHandle:null, admittedControlRevision:1,
    admittedControlProjectionDigest:'f'.repeat(64), outputRequirementDigest:'1'.repeat(64), episodeClaims:[],
    episodeClaimSetDigest:'2'.repeat(64), memberDigest:'3'.repeat(64) };
  const runInput = { manifestId:'run-manifest', manifestRole:'run_input', manifestRevision:1, libraRunId:'run-1', scopeKind:'single',
    members:[common], memberSetDigest:'4'.repeat(64), episodeScopeDigest:'5'.repeat(64), manifestDigest:'6'.repeat(64) };
  const productDelivery = { ...runInput, manifestId:'product-manifest', manifestRole:'product_delivery',
    members:[{ ...common, controlOperation:'assert_existing_input', expectedControlRevision:1,
      expectedControlProjectionDigest:'7'.repeat(64), committedControlRevision:2, committedControlProjectionDigest:'8'.repeat(64) }] };
  const [runSchema, deliverySchema] = schemas.ProductionMaterialManifest.oneOf;
  assert.deepEqual(Object.keys(runInput).sort(), [...runSchema.required].sort());
  assert.deepEqual(Object.keys(runInput.members[0]).sort(), [...runSchema.properties.members.items.required].sort());
  assert.deepEqual(Object.keys(productDelivery).sort(), [...deliverySchema.required].sort());
  assert.deepEqual(Object.keys(productDelivery.members[0]).sort(), [...deliverySchema.properties.members.items.required].sort());
  assert.deepEqual(Object.keys(location).sort(), [...deliverySchema.properties.members.items.properties.location.required].sort());
});

test('propagates the nominal Production Material Manifest into Promotion without an inline subset', () => {
  const promotion = schemas.LibraDeliverablePromotionDecision.properties.productMaterialManifest;
  assert.deepEqual(promotion, { $ref:'helix://contracts/domain-types/ProductionMaterialManifest/v1' });
  const serialized = JSON.stringify(schemas.LibraDeliverablePromotionDecision);
  assert.equal(serialized.includes('"locationKind"'), false);
  assert.equal(serialized.includes('"committedControlRevision"'), false);
});

test('materializes the exact PBF-16 acquisition and one-member import inputs', () => {
  assert.equal(schemas.LibraWorkspaceScope, undefined);
  assert.ok(schemas.SelectedCandidateSelected);
  assert.equal(schemas.SelectedCandidateSelected.properties.result.const, 'selected');
  assert.equal(schemas.SelectedCandidateSelected.properties.selectedCandidate.additionalProperties, false);

  assert.deepEqual(schemas.ProductStructure.properties.structureKind.enum, ['single', 'season']);
  assert.equal(schemas.ProductStructure.properties.episodeClaims.maxItems, 256);
  assert.equal(schemas.EpisodeDeliveryManifest.properties.episodeClaims.maxItems, 256);
  assert.equal(schemas.IdentityRequirement.properties.typedParameters, undefined);
  assert.equal(schemas.IdentityRequirement.properties.strengthClass.const, 'exact_provider_identity');
  assert.equal(schemas.SelectionCriteria.properties.strategy.const, 'available_provider_rank_then_candidate_id');

  const delivery = schemas.WorkspaceDeliveryContract;
  assert.equal(delivery.properties.typedParameters, undefined);
  assert.equal(delivery.properties.memberSelector.const, 'external_member_id');
  for (const field of ['libraRunId', 'workspaceId', 'expectedWorkspaceRevision', 'expectedWorkspaceStateDigest',
    'rootSnapshot', 'stableExternalMaterialHandleId', 'verifiedPackageDigest', 'externalMemberId',
    'targetRelativePath', 'digest']) assert.ok(delivery.required.includes(field), field);
});

test('keeps canonical content profile separate from season structure', () => {
  for (const name of ['ShelfStandard']) {
    assert.deepEqual(schemas[name].properties.contentProfile.enum, ['movie', 'series', 'jav', 'western_adult']);
    assert.equal(schemas[name].properties.contentProfile.enum.includes('season'), false);
  }
  const spec = schemas.ProductConformanceInputSnapshot.properties.acceptanceSpec;
  assert.deepEqual(spec.properties.contentProfile.enum, ['movie', 'series', 'jav', 'western_adult']);
  assert.equal(spec.properties.contentProfile.enum.includes('season'), false);
});

test('accepted DTOs freeze semantic members instead of exposing arbitrary payloads', () => {
  assert.equal(schemas.SelectedFieldMaterialSet.properties.members.maxItems, 256);
  const triageRule = schemas.ProcurementTriageRuleSnapshot.properties.rulePayload.properties;
  assert.equal(triageRule.maxPrimaryMaterials.const, 256);
  assert.equal(triageRule.manifestRule.properties.maximumMembers.const, 256);
  assert.equal(schemas.TriageStructureInspectionInput.properties.materialFieldContext.properties.memberContexts.maxItems, 256);
  assert.equal(schemas.CandidateDraft.properties.structureEvidence.properties.unit.properties.members.maxItems, 256);
  assert.equal(schemas.TriageStructureInspectionInput.properties.probeBatches.maxItems, 3);
  assert.equal(schemas.TriageStructureInspectionInput.properties.playabilityPages.maxItems, 3);
  assert.equal(schemas.TriageStructureInspectionInput.properties.layoutEvidence.maxItems, 256);
  assert.equal(schemas.CandidateDraft.properties.primaryInputManifestDraft.$ref, 'helix://contracts/types/PrimaryInputManifestDraft/v1');
  assert.equal(schemas.CandidateDraft.properties.structureEvidence.properties.unit.properties.mediaType.enum.includes('group'), true);
  assert.equal(schemas.CandidateDraft.properties.seasonContinuityClaims.items.$ref,
    'helix://contracts/types/SeasonContinuityClaim/v1');
  assert.ok(schemas.CandidateDraft.required.includes('seasonContinuityClaimSetDigest'));
  assert.equal(schemas.AcceptedIntakePayload.properties.resolutionDecision.$ref,
    'helix://contracts/domain-types/SubjectContinuityResolutionDecision/v1');
  assert.equal(schemas.CandidateDeliverySnapshot.properties.candidatePackage.$ref,
    'helix://contracts/types/CandidatePackage/v1');
  assert.equal(schemas.CandidateDeliverySnapshot.properties.primaryMaterialDeliveries.minItems, 1);
  assert.equal(schemas.CandidateDeliverySnapshot.properties.primaryMaterialDeliveries.maxItems, 256);
  assert.equal(schemas.AcceptedIntakePayload.properties.controlTransferScope.properties.items.maxItems, 256);
  assert.equal(schemas.DestructionScope.properties.materialKeys.items.pattern, '^[a-f0-9]{64}$');
  for (const schema of Object.values(schemas)) {
    const objectSchemas = schema.oneOf || [schema];
    for (const objectSchema of objectSchemas) {
      assert.equal(Object.hasOwn(objectSchema.properties, 'payload'), false);
      assert.equal(objectSchema.additionalProperties, false);
    }
  }
  const [registration, merge] = schemas.PeopleCandidateAcceptanceDecision.oneOf;
  assert.equal(registration.properties.candidateKind.const, 'registration');
  assert.equal(merge.properties.candidateKind.const, 'merge');
  assert.deepEqual(merge.properties.preferenceResolution.enum, ['keep_source', 'keep_target', 'set_explicit']);
});

test('projection and aggregate inputs are bounded snapshots rather than Store rows', () => {
  const entries = schemas.ActiveShelfEntryIdentityProjection.properties.entries;
  assert.equal(entries.maxItems, 4096);
  assert.equal(entries.items.additionalProperties, false);
  assert.deepEqual(new Set(entries.items.required), new Set(['objectId', 'revision', 'schemaRef', 'digest', 'objectKind']));
  assert.equal(Object.hasOwn(schemas.CurrentInventoryControl.properties, 'store'), false);
});
