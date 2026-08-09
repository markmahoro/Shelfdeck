'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createDefaultTriageRuleRegistry } = require('../../src/helix/domains/procurement/model/procurement-run-contracts');
const { createTriageCapabilities } = require('../../src/helix/domains/procurement/capabilities/triage-pipeline');

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

function member(label, ordinal, relativeLocation, mediaProbe) {
  const materialIdentity = identity(label, ordinal);
  const handle = { handleId:'handle-' + label, identity:materialIdentity, ownerDomain:'procurement', ownerScope:{}, bindingRevision:1,
    endpointId:'endpoint-1', location:'Movies/My Movie/' + relativeLocation, mountScopeRevision:1, expectedSizeBytes:100,
    expectedMtimeNs:'1', expectedCtimeNs:'1', fingerprintVerifiedAtMs:1, readScope:'media_probe', expiresAtMs:2000, fenceDigest:digest('fence:' + label) };
  const probe = { sourceHandleDigest:canonicalDigest(handle), resultKind:mediaProbe ? 'probed' : 'not_media',
    ...(mediaProbe ? { container:'mpegts', durationMs:5000, videoStreams:[{ streamIndex:0, codedWidth:1920, codedHeight:1080 }], audioStreams:[], subtitleStreams:[] } :
      { videoStreams:[], audioStreams:[], subtitleStreams:[] }), sizeBytes:100, payloadDigest:digest('probe:' + label), ...(mediaProbe ? { discTopology:mediaProbe } : {}) };
  const value = { selectionOrdinal:ordinal, materialKey:materialIdentity.materialKey, bindingRevision:1, admittedControlRevision:2,
    admittedControlProjectionDigest:digest('control:' + label), readHandle:handle, mediaProbe:probe, memberDigest:'' };
  value.memberDigest = canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'memberDigest')));
  return value;
}

function layoutEvidence(entries, id) {
  const base = { schemaRef:'helix://contracts/types/LayoutEvidence/v1', schemaVersion:1, evidenceId:'layout-' + id, evidenceKind:'observation_layout_snapshot',
    producerRef:'shared.material.layout.observe@1', basisDigest:digest('basis:' + id), payloadDigest:'', observedAtMs:1,
    sourceHandleDigest:digest('source:' + id), boundedScopeDigest:digest('scope:' + id), entries, entriesDigest:digest(entries), layoutDigest:digest('layout:' + id) };
  base.payloadDigest = canonicalDigest(Object.fromEntries(Object.entries(base).filter(([key]) => key !== 'payloadDigest')));
  return base;
}

function buildInput(topology) {
  const names = [
    ['index', 'BDMV/index.bdmv', false], ['movieobject', 'BDMV/MovieObject.bdmv', false],
    ['playlist', 'BDMV/PLAYLIST/00000.mpls', false], ['clip', 'BDMV/CLIPINF/00000.clpi', false],
    ['stream', 'BDMV/STREAM/00000.m2ts', true],
  ];
  const members = names.map(([label, location, playable], ordinal) => member(label, ordinal, location, playable ? topology : null));
  const batch = { procurementRunId:'run-1', runBasisDigest:digest('run-basis'), selectionDigest:digest('selection'), batchOrdinal:0, members, batchDigest:'' };
  batch.batchDigest = canonicalDigest(Object.fromEntries(Object.entries(batch).filter(([key]) => key !== 'batchDigest')));
  const playability = capabilities.playabilityInspect.execute({ triageMaterialProbeBatch:batch, procurementTriageRuleSnapshot:rule });
  const selected = { procurementRunId:'run-1', fieldId:'field-1', members:members.map((item, ordinal) => ({ ordinal, materialKey:item.materialKey,
    selectionRole:'triage_input', physicalIdentity:item.readHandle.identity, sizeBytes:100, bindingRevision:1, eligibilityRevision:1,
    eligibilityBasisDigest:digest('eligibility:' + ordinal), lastSnapshotDigest:digest('snapshot:' + ordinal), lastObservationId:'observation-1',
    endpointId:'endpoint-1', location:item.readHandle.location, realityDigest:digest('reality:' + ordinal), provenanceDigest:digest('provenance:' + ordinal),
    controlSnapshot:{}, admissionControlAction:'acquire', basisMemberDigest:digest('basis:' + ordinal) })), selectionDigest:batch.selectionDigest };
  const contextValue = { fieldId:'field-1', accessRevision:1, accessDigest:digest('access'), profileHintSnapshot:{ fieldId:'field-1', revision:1,
    contentProfileHint:'movie', hintDigest:canonicalDigest({ schema:'procurement.material-field-profile-hint@1', fieldId:'field-1', revision:1, contentProfileHint:'movie' }) }, memberContexts:members.map((item, ordinal) => ({ selectionOrdinal:ordinal,
      materialKey:item.materialKey, fieldRelativeLocation:item.readHandle.location, baseName:item.readHandle.location.split('/').at(-1),
      extension:'.' + item.readHandle.location.split('.').at(-1).toLowerCase(), parentSegments:item.readHandle.location.split('/').slice(0, -1), layoutEvidenceRefs:[] })) };
  const internalEntries = names.map(([label, location], ordinal) => ({ entryOrdinal:ordinal + 1, entryKind:'file', relativeLocation:location.replace(/^BDMV\//, ''),
    baseName:location.split('/').at(-1), extension:'.' + location.split('.').at(-1).toLowerCase(), identity:members[ordinal].readHandle.identity,
    endpointId:'endpoint-1', location:'Movies/My Movie/' + location, sizeBytes:100, mtimeNs:'1', entryDigest:digest('entry:' + label) }));
  const outerIdentity = identity('movie-nfo', 10);
  const outerEntry = { entryOrdinal:1, entryKind:'file', relativeLocation:'movie.nfo', baseName:'movie.nfo', extension:'.nfo', identity:outerIdentity,
    endpointId:'endpoint-1', location:'Movies/My Movie/movie.nfo', sizeBytes:100, mtimeNs:'1', entryDigest:digest('outer-entry') };
  const layouts = [layoutEvidence([{ entryOrdinal:0, entryKind:'directory', relativeLocation:'.', baseName:'BDMV', endpointId:'endpoint-1', location:'Movies/My Movie/BDMV', entryDigest:digest('dir-bdmv') }, ...internalEntries], 'bdmv'),
    layoutEvidence([{ entryOrdinal:0, entryKind:'directory', relativeLocation:'.', baseName:'My Movie', endpointId:'endpoint-1', location:'Movies/My Movie', entryDigest:digest('dir-outer') }, outerEntry], 'outer')];
  const refs = layouts.map((layout) => ({ evidenceId:layout.evidenceId, payloadDigest:layout.payloadDigest, boundedScopeDigest:layout.boundedScopeDigest }));
  contextValue.memberContexts.forEach((context) => { context.layoutEvidenceRefs = refs; });
  const materialFieldContext = { ...contextValue, contextDigest:canonicalDigest(contextValue) };
  const request = { pageOrdinal:0, cursorIn:null, maxUnits:100, requestDigest:'' }; request.requestDigest = canonicalDigest({ pageOrdinal:0, cursorIn:null, maxUnits:100 });
  const input = { selectedFieldMaterialSet:selected, probeBatches:[batch], playabilityPages:[playability], materialFieldContext,
    layoutEvidence:layouts, pageRequest:request, inputDigest:'' };
  input.inputDigest = canonicalDigest({ schema:'procurement.triage-structure-input@1', selectionDigest:selected.selectionDigest, probeBatchDigests:[batch.batchDigest],
    playabilityPayloadDigests:[playability.payloadDigest], contextDigest:materialFieldContext.contextDigest,
    layoutPayloadDigests:[...layouts].sort((left, right) => Buffer.compare(Buffer.from(left.evidenceId), Buffer.from(right.evidenceId))).map((item) => item.payloadDigest), pageRequest:request });
  return input;
}

test('single-title BDMV becomes one Unit with structural dependencies and no STREAM candidates', () => {
  const topology = { discKind:'bdmv', titleCount:1, topologyVersion:1, singleTitleEvidenceDigest:digest('single-title'), topologyDigest:digest('topology'),
    selectedPlaylist:{ relativeLocation:'PLAYLIST/00000.mpls', durationMs:5000, clipIds:['00000'] }, members:[
      { relativeLocation:'PLAYLIST/00000.mpls', role:'structural_dependency' },
      { relativeLocation:'STREAM/00000.m2ts', role:'primary_payload', clipId:'00000' },
      { relativeLocation:'CLIPINF/00000.clpi', role:'structural_dependency' },
      { relativeLocation:'index.bdmv', role:'structural_dependency' },
      { relativeLocation:'MovieObject.bdmv', role:'structural_dependency' },
    ] };
  const result = capabilities.structureInspect.execute({ triageStructureInspectionInput:buildInput(topology), procurementTriageRuleSnapshot:rule });
  assert.equal(result.units.length, 1);
  assert.equal(result.units[0].contentProfile, 'movie');
  assert.equal(result.units[0].members.filter((item) => item.role === 'primary_payload').length, 1);
  assert.equal(result.units[0].members.filter((item) => item.role === 'structural_dependency').length, 4);
  assert.equal(result.units[0].displayIdentity, 'My Movie');
  assert.equal(result.units[0].relatedReferences.length, 1);
  assert.equal(result.units[0].relatedReferences[0].role, 'nfo');
  assert.equal(result.units[0].relatedReferences.some((item) => /(?:MPLS|CLPI|M2TS|BDMV)$/i.test(item.location)), false);
  assert.equal(result.unassignedMaterials.length, 0);
});

test('multi-title BDMV remains not_ready and creates no Unit', () => {
  const topology = { discKind:'bdmv', titleCount:2, topologyVersion:1, singleTitleEvidenceDigest:digest('multi-title'), topologyDigest:digest('topology-multi'),
    selectedPlaylist:{ relativeLocation:'PLAYLIST/00000.mpls', durationMs:5000, clipIds:['00000'] }, members:[
      { relativeLocation:'PLAYLIST/00000.mpls', role:'structural_dependency' }, { relativeLocation:'STREAM/00000.m2ts', role:'primary_payload', clipId:'00000' },
      { relativeLocation:'CLIPINF/00000.clpi', role:'structural_dependency' }, { relativeLocation:'index.bdmv', role:'structural_dependency' }, { relativeLocation:'MovieObject.bdmv', role:'structural_dependency' },
    ] };
  const result = capabilities.structureInspect.execute({ triageStructureInspectionInput:buildInput(topology), procurementTriageRuleSnapshot:rule });
  assert.equal(result.units.length, 0);
  assert.equal(result.resultKind, 'not_ready');
  assert.deepEqual(new Set(result.unassignedMaterials.map((item) => item.reasonCode)), new Set(['disc_multi_title_unsupported']));
});
