'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createDefaultTriageRuleRegistry } = require('../../src/helix/domains/procurement/model/procurement-run-contracts');
const { createTriageCapabilities } = require('../../src/helix/domains/procurement/capabilities/triage-pipeline');
const { createSingleScopeSelection } = require('./helpers/procurement-selection-fixture');

const digest = (value) => canonicalDigest({ value });
const rule = createDefaultTriageRuleRegistry().entries[0];
const capabilities = createTriageCapabilities({ now:() => 1000 });

function identity(label, ordinal) {
  const value = { schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2', schemaVersion:2, mountScopeId:'mount-1', inode:String(ordinal + 1),
    sizeBytes:100, fingerprintAlgorithm:'middle-256k-sha256', fingerprintVersion:1, contentFingerprint:digest('content:' + label), materialKey:'' };
  value.materialKey = canonicalDigest({ schema:'physical-material-identity@2', mountScopeId:value.mountScopeId, inode:value.inode,
    sizeBytes:value.sizeBytes, fingerprintAlgorithm:value.fingerprintAlgorithm, fingerprintVersion:value.fingerprintVersion, contentFingerprint:value.contentFingerprint });
  return value;
}

function handle(label, ordinal, relativeLocation) {
  const materialIdentity = identity(label, ordinal);
  return { handleId:'handle-' + label, identity:materialIdentity, ownerDomain:'procurement', ownerScope:{}, bindingRevision:1,
    endpointId:'endpoint-1', location:relativeLocation, mountScopeRevision:1, expectedSizeBytes:100,
    expectedMtimeNs:'1', expectedCtimeNs:'1', fingerprintVerifiedAtMs:1, readScope:'media_probe', expiresAtMs:2000, fenceDigest:digest('fence:' + label) };
}

function bdmvScope(selectionScope) {
  return { scopeKind:'bdmv_container', procurementRunId:'run-1', bdmvGroupKey:selectionScope.scopeKey,
    scopeDigest:selectionScope.scopeDigest, memberSetDigest:selectionScope.memberSetDigest, memberCount:selectionScope.memberCount,
    topologyDigest:digest('topology'), selectedPayloadSetDigest:digest('payload') };
}

function bdmvAssessment(scope, titleCount = 1) {
  const assessment = { schemaRef:'helix://contracts/types/BdmvAssessmentEvidence/v1', schemaVersion:1,
    evidenceId:'bdmv-evidence-1', evidenceKind:'bdmv_assessment', producerRef:'procurement.triage.bdmv.assess@1',
    basisDigest:digest('assessment-basis'), payloadDigest:'', observedAtMs:1, runId:'run-1', bdmvGroupKey:scope.bdmvGroupKey,
    scopeDigest:scope.scopeDigest, memberSetDigest:scope.memberSetDigest, resultKind:'resolved', reasonCode:null, discKind:'bdmv',
    titleCount, selectedPlaylist:{ relativeLocation:'PLAYLIST/00000.mpls', durationMs:5000, clipIds:['00000'] }, selectedClipIds:['00000'],
    topologyDigest:scope.topologyDigest, selectedPayloadSetDigest:scope.selectedPayloadSetDigest, memberCount:scope.memberCount,
    mediaSummary:{ probeState:'probed', durationMs:5000, videoClasses:['h264'], audioClasses:['aac'], subtitleClasses:[] }, evidenceDigest:'' };
  assessment.evidenceDigest = digest(Object.fromEntries(Object.entries(assessment).filter(([key]) => !['payloadDigest','evidenceDigest'].includes(key))));
  assessment.payloadDigest = digest(Object.fromEntries(Object.entries(assessment).filter(([key]) => key !== 'payloadDigest')));
  return assessment;
}

function buildInput({ titleCount = 1, profileHint = 'movie', containerRoot = 'Movies/My Movie' } = {}) {
  const prefix = containerRoot === '.' ? '' : containerRoot + '/';
  const names = [
    ['certificate', `${prefix}CERTIFICATE/id.bdmv`], ['index', `${prefix}BDMV/index.bdmv`], ['movieobject', `${prefix}BDMV/MovieObject.bdmv`], ['playlist', `${prefix}BDMV/PLAYLIST/00000.mpls`],
    ['clip', `${prefix}BDMV/CLIPINF/00000.clpi`], ['stream', `${prefix}BDMV/STREAM/00000.m2ts`],
  ];
  const members = names.map(([label, location], ordinal) => ({
    materialKey:identity(label, ordinal).materialKey, identity:identity(label, ordinal), relativeLocation:location,
    location, baseName:location.split('/').at(-1), extension:'.' + location.split('.').at(-1).toLowerCase(),
    endpointId:'endpoint-1', sizeBytes:100, entryDigest:digest('entry:' + label),
  }));
  const handles = members.map((item, ordinal) => handle(names[ordinal][0], ordinal, names[ordinal][1]));
  const rawSelectedMembers = members.map((item, ordinal) => ({ ordinal, materialKey:item.materialKey, selectionRole:'triage_input', physicalIdentity:item.identity,
    sizeBytes:100, bindingRevision:1, eligibilityRevision:1, eligibilityBasisDigest:digest('eligibility:' + ordinal), lastSnapshotDigest:digest('snapshot:' + ordinal),
    lastObservationId:'observation-1', endpointId:'endpoint-1', location:item.location, realityDigest:digest('reality:' + ordinal), provenanceDigest:digest('provenance:' + ordinal),
    controlSnapshot:{ materialKey:item.materialKey, resultKind:'available', controlRevision:2, controlState:'uncontrolled', regionProjection:'uncontrolled',
      evidenceDigest:digest('control:' + ordinal), projectionDigest:digest('projection:' + ordinal) }, admissionControlAction:'acquire', basisMemberDigest:digest('basis:' + ordinal) }));
  const selection = createSingleScopeSelection({ procurementRunId:'run-1', fieldId:'field-1', members:rawSelectedMembers,
    scopeKind:'bdmv_container', scopeKey:`bdmv:${containerRoot}`, scopeRootRelativeLocation:containerRoot });
  const selectedMembers = selection.members;
  const scope = bdmvScope(selection.selectionScopes[0]);
  const assessment = bdmvAssessment(scope, titleCount);
  const logical = { inputKind:'bdmv_container', selectionOrdinal:0,
    materialKey:canonicalDigest({ schema:'procurement.bdmv-logical-material@1', bdmvGroupKey:scope.bdmvGroupKey }), bindingRevision:1,
    admittedControlRevision:2, admittedControlProjectionDigest:selectedMembers[0].controlSnapshot.projectionDigest, bdmvGroupKey:scope.bdmvGroupKey,
    scopeDigest:scope.scopeDigest, memberSetDigest:scope.memberSetDigest, memberCount:scope.memberCount, bdmvAssessment:assessment };
  logical.memberDigest = canonicalDigest(logical);
  const batch = { procurementRunId:'run-1', runBasisDigest:digest('run-basis'), selectionDigest:selection.selectionDigest, batchOrdinal:0, members:[logical], batchDigest:'' };
  batch.batchDigest = canonicalDigest(Object.fromEntries(Object.entries(batch).filter(([key]) => key !== 'batchDigest')));
  const playability = capabilities.playabilityInspect.execute({ triageMaterialProbeBatch:batch, procurementTriageRuleSnapshot:rule });
  const contextValue = { fieldId:'field-1', accessRevision:1, accessDigest:digest('access'), profileHintSnapshot:{ fieldId:'field-1', revision:1,
    contentProfileHint:profileHint, hintDigest:canonicalDigest({ schema:'procurement.material-field-profile-hint@1', fieldId:'field-1', revision:1, contentProfileHint:profileHint }) },
    memberContexts:members.map((item, ordinal) => ({ selectionOrdinal:ordinal, materialKey:item.materialKey, fieldRelativeLocation:item.relativeLocation,
      baseName:item.baseName, extension:item.extension, parentSegments:item.relativeLocation.split('/').slice(0, -1), layoutEvidenceRefs:[] })) };
  const materialFieldContext = { ...contextValue, contextDigest:canonicalDigest(contextValue) };
  const outerIdentity = identity('movie-nfo', 10);
  const outerLocation = `${prefix}movie.nfo`;
  const outerEntry = { materialKey:outerIdentity.materialKey, relativeLocation:outerLocation, currentLocation:outerLocation,
    baseName:'movie.nfo', extension:'.nfo', identity:outerIdentity, endpointId:'endpoint-1', sizeBytes:100, entryDigest:digest('outer-entry') };
  const observationEntries = [...members, outerEntry].map((entry) => ({ ...entry, currentLocation:entry.currentLocation || entry.location }));
  const observationScopeProjection = { projectionRevision:1, scopeDigest:digest(observationEntries), entriesDigest:digest(observationEntries), entryCount:observationEntries.length,
    entries:observationEntries };
  const pageRequest = { pageOrdinal:0, cursorIn:null, maxUnits:100, requestDigest:'' };
  pageRequest.requestDigest = canonicalDigest({ pageOrdinal:0, cursorIn:null, maxUnits:100 });
  const bdmvAssessments = [{ scope, assessment }];
  const input = { selectedFieldMaterialSet:selection, probeBatches:[batch], bdmvAssessments, playabilityPages:[playability], materialFieldContext,
    observationScopeProjection, pageRequest, inputDigest:'' };
  input.inputDigest = canonicalDigest({ schema:'procurement.triage-structure-input@1', selectionDigest:selection.selectionDigest,
    probeBatchDigests:[batch.batchDigest], bdmvAssessmentPayloadDigests:[assessment.payloadDigest], playabilityPayloadDigests:[playability.payloadDigest],
    contextDigest:materialFieldContext.contextDigest, observationScopeProjectionDigest:observationScopeProjection.scopeDigest, pageRequest });
  return { input, scope, assessment, handles };
}

test('single-title BDMV becomes one compact Unit with structural dependencies and no STREAM candidates', () => {
  const { input } = buildInput();
  const result = capabilities.structureInspect.execute({ triageStructureInspectionInput:input, procurementTriageRuleSnapshot:rule });
  assert.equal(result.units.length, 1);
  assert.equal(result.units[0].contentProfile, 'movie');
  assert.equal(result.units[0].memberScope.scopeKind, 'bdmv_container');
  assert.equal(result.units[0].memberScope.memberCount, 6);
  assert.equal(Object.hasOwn(result.units[0], 'members'), false);
  assert.equal(result.units[0].relatedScope.scopeKind, 'bdmv_external_parent');
  assert.equal(result.units[0].relatedScope.parentRelativeLocation, 'Movies/My Movie');
  assert.equal(Object.hasOwn(result.units[0], 'relatedReferences'), false);
  assert.equal(result.units[0].materialInputForm, 'bdmv');
  assert.equal(result.unassignedMaterials.length, 0);
});

test('a BDMV placed directly at the Field root gets one deterministic temporary display label', () => {
  const { input } = buildInput({ containerRoot:'.' });
  const result = capabilities.structureInspect.execute({ triageStructureInspectionInput:input, procurementTriageRuleSnapshot:rule });
  assert.equal(result.units.length, 1);
  assert.equal(result.units[0].displayIdentity, `BDMV-${input.bdmvAssessments[0].scope.scopeDigest.slice(0, 8)}`);
  assert.equal(result.units[0].relatedScope.parentRelativeLocation, '.');
  assert.equal(result.units[0].relatedScope.associationMode, 'bdmv_external');
});

test('multi-title BDMV uses the durable selected title and still creates one Unit', () => {
  const { input } = buildInput({ titleCount:2 });
  const result = capabilities.structureInspect.execute({ triageStructureInspectionInput:input, procurementTriageRuleSnapshot:rule });
  assert.equal(result.units.length, 1);
  assert.equal(result.resultKind, 'resolved');
  assert.equal(result.unassignedMaterials.length, 0);
});

test('Series BDMV fails closed without creating a Unit', () => {
  const { input } = buildInput({ profileHint:'series' });
  const result = capabilities.structureInspect.execute({ triageStructureInspectionInput:input, procurementTriageRuleSnapshot:rule });
  assert.equal(result.units.length, 0);
  assert.equal(result.unassignedMaterials.length, 6);
  assert.ok(result.unassignedMaterials.every((item) => item.reasonCode === 'disc_structure_incomplete'));
});

test('BDMV BACKUP structural metadata is not treated as a playability failure', () => {
  const materialIdentity = identity('backup-clip', 0);
  const readHandle = handle('backup-clip', 0, 'BDMV/BACKUP/CLIPINF/00000.clpi');
  const value = { procurementRunId:'run-backup', runBasisDigest:digest('run-backup-basis'), selectionDigest:digest('backup-selection'), batchOrdinal:0,
    members:[{ selectionOrdinal:0, materialKey:materialIdentity.materialKey, bindingRevision:1, admittedControlRevision:2, admittedControlProjectionDigest:digest('control'),
      readHandle, mediaProbe:{ sourceHandleDigest:canonicalDigest(readHandle), resultKind:'probed', container:'unknown', durationMs:1, videoStreams:[], audioStreams:[], subtitleStreams:[], sizeBytes:100, payloadDigest:digest('probe') } }] };
  value.members[0].memberDigest = canonicalDigest(Object.fromEntries(Object.entries(value.members[0]).filter(([key]) => key !== 'memberDigest')));
  value.batchDigest = canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'batchDigest')));
  const result = capabilities.playabilityInspect.execute({ triageMaterialProbeBatch:value, procurementTriageRuleSnapshot:rule });
  assert.deepEqual(result.materialResults[0].reasonCodes, []);
  assert.equal(result.materialResults[0].playable, true);
});
