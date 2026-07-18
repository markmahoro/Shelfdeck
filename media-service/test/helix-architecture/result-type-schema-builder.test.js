'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildResultTypeSchemas } = require('../../scripts/helix-architecture/result-type-schema-builder');

const schemas = buildResultTypeSchemas();

test('builds 86 Catalog Result schemas and the three SSOT helper types', () => {
  assert.equal(Object.keys(schemas).length, 89);
  for (const helper of ['OnDeckCommitReceipt', 'OffloadCompletionFact', 'PeopleCandidateDraft']) assert.ok(schemas[helper]);
});

test('freezes the normalized media probe raster and bounded stream contract', () => {
  const schema = schemas.MediaProbeEvidence;
  for (const field of ['sourceHandleDigest', 'container', 'durationMs', 'sizeBytes', 'videoStreams', 'audioStreams', 'subtitleStreams']) {
    assert.ok(schema.required.includes(field));
  }
  const video = schema.properties.videoStreams.items;
  for (const field of ['codedWidth', 'codedHeight', 'sampleAspectRatio', 'rotation', 'displayWidth', 'displayHeight', 'longEdge', 'shortEdge']) {
    assert.ok(video.required.includes(field));
  }
  assert.equal(schema.properties.videoStreams.maxItems, 64);
});

test('freezes FA-04 continuity kinds and non-empty Primary Input membership', () => {
  assert.deepEqual(schemas.CandidatePackage.properties.seasonContinuityClaims.items.properties.kind.enum,
    ['exact_provider_season', 'persistent_triage_grouping']);
  assert.equal(schemas.PrimaryInputManifest.properties.members.minItems, 1);
  assert.equal(schemas.PrimaryInputManifest.properties.members.items.additionalProperties, false);
});

test('keeps On-deck atomic success and business not-available distinct from Runtime Outcome variants', () => {
  assert.equal(schemas.OnDeckCommitResult.properties.onDeckCommitReceipt.$ref, 'helix://contracts/types/OnDeckCommitReceipt/v1');
  assert.equal(schemas.OnDeckCommitResult.properties.offloadCompletionFact.$ref, 'helix://contracts/types/OffloadCompletionFact/v1');
  assert.deepEqual(schemas.ArtifactAcquisitionResult.properties.resultKind.enum, ['acquired', 'not_available']);
  for (const schema of Object.values(schemas)) assert.equal(Object.hasOwn(schema.properties || {}, 'kind'), false);
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
