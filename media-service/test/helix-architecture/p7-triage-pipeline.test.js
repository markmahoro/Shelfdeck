'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createDefaultTriageRuleRegistry } = require('../../src/helix/domains/procurement/model/procurement-run-contracts');
const { createTriageCapabilities } = require('../../src/helix/domains/procurement/capabilities/triage-pipeline');

const d = (label) => canonicalDigest({ label });
const rule = createDefaultTriageRuleRegistry().entries[0];
const capabilities = createTriageCapabilities({ now:() => 1000 });

function probeMember(ordinal, label, probe = {}) {
  const materialKey = d(`material:${label}`);
  const readHandle = { handleId:`handle-${label}`, identity:{ materialKey }, ownerDomain:'procurement', ownerScope:{}, bindingRevision:1,
    endpointId:'endpoint-1', location:`shows/Demo/${label}.mkv`, mountScopeRevision:1, expectedSizeBytes:100,
    expectedMtimeNs:'1', expectedCtimeNs:'1', hashVerifiedAtMs:1, readScope:'media_probe', expiresAtMs:2000, fenceDigest:d(`fence:${label}`) };
  const mediaProbe = { sourceHandleDigest:canonicalDigest(readHandle), resultKind:'probed', container:'matroska', durationMs:1000,
    sizeBytes:100, videoStreams:[{ streamIndex:0 }], audioStreams:[], subtitleStreams:[], payloadDigest:d(`probe:${label}`), ...probe };
  const value = { selectionOrdinal:ordinal, materialKey, bindingRevision:1, admittedControlRevision:2,
    admittedControlProjectionDigest:d(`control:${label}`), readHandle, mediaProbe, memberDigest:'' };
  value.memberDigest = canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'memberDigest')));
  return value;
}

function batch(members) {
  const value = { procurementRunId:'run-1', runBasisDigest:d('run-basis'), selectionDigest:d('selection'), batchOrdinal:0,
    members, batchDigest:'' };
  value.batchDigest = canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'batchDigest')));
  return value;
}

test('playability consumes typed probe evidence and emits the closed ordered reason set', () => {
  const good = probeMember(0, 'good');
  const bad = probeMember(1, 'bad', { durationMs:0, videoStreams:[] });
  const result = capabilities.playabilityInspect.execute({ triageMaterialProbeBatch:batch([good,bad]), procurementTriageRuleSnapshot:rule });
  assert.equal(result.materialResults[0].playable, true);
  assert.deepEqual(result.materialResults[1].reasonCodes, ['no_video_stream','non_positive_duration']);
  assert.equal(result.materialResults[1].materialKey, bad.materialKey);
  assert.match(result.materialResults[1].resultDigest, /^[a-f0-9]{64}$/);
});

test('structure preserves Selection mapping and carries series mediaType/contentProfile into Identity and Manifest Draft', () => {
  const member = probeMember(0, 'Demo.S02E03-04'); const probeBatch = batch([member]);
  const playability = capabilities.playabilityInspect.execute({ triageMaterialProbeBatch:probeBatch, procurementTriageRuleSnapshot:rule });
  const selected = { procurementRunId:'run-1', fieldId:'field-1', members:[{ ordinal:0, materialKey:member.materialKey,
    selectionRole:'triage_input', bindingRevision:1, eligibilityRevision:1, eligibilityBasisDigest:d('eligibility'),
    lastSnapshotDigest:d('snapshot'), lastObservationId:'observation-1', endpointId:'endpoint-1', location:member.readHandle.location,
    realityDigest:d('reality'), provenanceDigest:d('provenance'), controlSnapshot:{}, admissionControlAction:'acquire',
    basisMemberDigest:d('basis-member') }], selectionDigest:probeBatch.selectionDigest };
  const context = { fieldId:'field-1', accessRevision:1, accessDigest:d('access'), contentProfileHint:'series',
    memberContexts:[{ selectionOrdinal:0, materialKey:member.materialKey, fieldRelativeLocation:member.readHandle.location,
      baseName:'Demo.S02E03-04', extension:'.mkv', parentSegments:['shows','Demo'], layoutEvidenceRefs:[] }], contextDigest:'' };
  context.contextDigest = canonicalDigest(Object.fromEntries(Object.entries(context).filter(([key]) => key !== 'contextDigest')));
  const pageRequest = { pageOrdinal:0, cursorIn:null, maxUnits:100, requestDigest:'' };
  pageRequest.requestDigest = canonicalDigest(Object.fromEntries(Object.entries(pageRequest).filter(([key]) => key !== 'requestDigest')));
  const structureInput = { selectedFieldMaterialSet:selected, probeBatches:[probeBatch], playabilityPages:[playability],
    materialFieldContext:context, layoutEvidence:[], pageRequest, inputDigest:'' };
  structureInput.inputDigest = canonicalDigest({ schema:'procurement.triage-structure-input@1', selectionDigest:selected.selectionDigest,
    probeBatchDigests:[probeBatch.batchDigest], playabilityPayloadDigests:[playability.payloadDigest], contextDigest:context.contextDigest,
    layoutPayloadDigests:[], pageRequest });
  const structure = capabilities.structureInspect.execute({ triageStructureInspectionInput:structureInput, procurementTriageRuleSnapshot:rule });
  assert.equal(structure.units.length, 1);
  assert.equal(structure.units[0].mediaType, 'group');
  assert.equal(structure.units[0].contentProfile, 'series');
  assert.deepEqual(structure.units[0].members[0].episodeClaims.map((item) => item.episodeKey), ['E003','E004']);

  const identityInput = { procurementRunId:'run-1', runBasisDigest:probeBatch.runBasisDigest, triageRuleAuthorityDigest:rule.authorityDigest,
    structureEvidenceId:structure.evidenceId, structureEvidencePayloadDigest:structure.payloadDigest, unit:structure.units[0], inputDigest:d('identity-input') };
  const identity = capabilities.identityClaimResolve.execute({ triageIdentityResolutionInput:identityInput, procurementTriageRuleSnapshot:rule });
  assert.equal(identity.mediaType, 'group'); assert.equal(identity.contentProfile, 'series'); assert.equal(identity.claimKind, 'series_season');

  const manifestInput = { procurementRunId:'run-1', runBasisDigest:probeBatch.runBasisDigest, triageRuleAuthorityDigest:rule.authorityDigest,
    selectedFieldMaterialSet:selected, structureEvidenceId:structure.evidenceId, structureEvidencePayloadDigest:structure.payloadDigest,
    unit:structure.units[0], preallocatedManifestId:'manifest-1', inputDigest:d('manifest-input') };
  const manifest = capabilities.primaryManifestBuild.execute({ triageManifestBuildInput:manifestInput, procurementTriageRuleSnapshot:rule });
  assert.equal(manifest.memberCount, 1); assert.equal(manifest.structureKind, 'season');
  const expectedMembers = [{ ordinal:0, materialKey:member.materialKey, role:'primary_payload', bindingRevision:1,
    admittedControlRevision:2, admittedControlProjectionDigest:member.admittedControlProjectionDigest,
    episodeClaims:structure.units[0].members[0].episodeClaims }];
  assert.equal(manifest.membersDigest, canonicalDigest({ schema:'procurement.primary-input-manifest-members@1', items:expectedMembers }));
});

test('Triage module has no Store, Provider, Runtime, or legacy fallback dependency', () => {
  const source = require('node:fs').readFileSync(require('node:path').resolve(__dirname,
    '../../src/helix/domains/procurement/model/triage-contracts.js'), 'utf8');
  for (const token of ['../persistence', 'provider', 'fallback', 'legacy', 'runtime']) assert.equal(source.toLowerCase().includes(token), false);
});
