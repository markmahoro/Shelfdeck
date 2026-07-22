'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildDomainInputSchemas } = require('../../scripts/helix-architecture/domain-input-schema-builder');

const schemas = buildDomainInputSchemas();

test('builds exactly the 98 formal domain input contracts', () => {
  assert.equal(Object.keys(schemas).length, 98);
  assert.equal(Object.values(schemas).filter((schema) => schema['x-helix-role'] === 'bounded-contract').length, 25);
  assert.equal(Object.values(schemas).filter((schema) => schema['x-helix-role'] === 'accepted-business-dto').length, 73);
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

test('bounded requirements and intents carry identity, revision, digest, and typed parameters', () => {
  for (const name of ['MediaRequirement', 'EncodeIntent', 'ArtifactProfile', 'AcceptanceSpec']) {
    const schema = schemas[name];
    for (const field of ['schemaRef', 'schemaVersion', 'revision', 'digest', 'typedParameters']) assert.ok(schema.required.includes(field));
    assert.equal(schema.properties.typedParameters.items.additionalProperties, false);
  }
  assert.equal(schemas.HashProfile.properties.algorithm.const, 'sha256');
  assert.equal(schemas.HashProfile.properties.fullContentRequired.const, true);
});

test('keeps canonical content profile separate from season structure', () => {
  for (const name of ['AcceptanceSpec', 'ShelfStandard']) {
    assert.deepEqual(schemas[name].properties.contentProfile.enum, ['movie', 'series', 'jav', 'western_adult']);
    assert.equal(schemas[name].properties.contentProfile.enum.includes('season'), false);
  }
});

test('accepted DTOs freeze semantic members instead of exposing arbitrary payloads', () => {
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
