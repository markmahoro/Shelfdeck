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

test('flattens WorkspaceMediaHandle without accepting a raw nested workspace payload', () => {
  const schema = schemas.WorkspaceMediaHandle;
  assert.ok(schema.required.includes('workspaceId'));
  assert.ok(schema.required.includes('relativePath'));
  assert.equal(Object.hasOwn(schema.properties, 'workspaceMaterial'), false);
  assert.equal(schema.additionalProperties, false);
});
