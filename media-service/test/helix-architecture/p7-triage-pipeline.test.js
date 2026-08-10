'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createDefaultTriageRuleRegistry } = require('../../src/helix/domains/procurement/model/procurement-run-contracts');
const { createTriageCapabilities } = require('../../src/helix/domains/procurement/capabilities/triage-pipeline');
const { createSingleScopeSelection } = require('./helpers/procurement-selection-fixture');

const d = (label) => canonicalDigest({ label });
const rule = createDefaultTriageRuleRegistry().entries[0];
const capabilities = createTriageCapabilities({ now:() => 1000 });
function profileHintSnapshot(contentProfileHint) {
  return {
    fieldId:'field-1',
    revision:1,
    contentProfileHint,
    hintDigest:canonicalDigest({
      schema:'procurement.material-field-profile-hint@1',
      fieldId:'field-1',
      revision:1,
      contentProfileHint,
    }),
  };
}

function probeMember(ordinal, label, probe = {}, location = `shows/Demo/${label}.mkv`) {
  const identity={schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,mountScopeId:'mount-1',inode:String(ordinal+1),sizeBytes:100,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:d(`material:${label}`)};
  identity.materialKey=canonicalDigest({schema:'physical-material-identity@2',mountScopeId:identity.mountScopeId,inode:identity.inode,sizeBytes:identity.sizeBytes,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:identity.contentFingerprint});
  const materialKey = identity.materialKey;
  const readHandle = { handleId:`handle-${label}`, identity, ownerDomain:'procurement', ownerScope:{}, bindingRevision:1,
    endpointId:'endpoint-1', location, mountScopeRevision:1, expectedSizeBytes:100,
    expectedMtimeNs:'1', expectedCtimeNs:'1', fingerprintVerifiedAtMs:1, readScope:'media_probe', expiresAtMs:2000, fenceDigest:d(`fence:${label}`) };
  const mediaProbe = { sourceHandleDigest:canonicalDigest(readHandle), resultKind:'probed', container:'matroska', durationMs:1000,
    sizeBytes:100, videoStreams:[{ streamIndex:0 }], audioStreams:[], subtitleStreams:[], payloadDigest:d(`probe:${label}`), ...probe };
  const value = { selectionOrdinal:ordinal, materialKey, bindingRevision:1, admittedControlRevision:2,
    admittedControlProjectionDigest:d(`control:${label}`), readHandle, mediaProbe, memberDigest:'' };
  value.memberDigest = canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'memberDigest')));
  return value;
}

function movieScopeStructure(locations, scope) {
  const probeMembers = locations.map((location, ordinal) => probeMember(
    ordinal,
    location.split('/').at(-1).replace(/\.[^.]+$/, ''),
    {},
    location,
  ));
  const selected = createSingleScopeSelection({
    procurementRunId:'run-1',
    fieldId:'field-1',
    scopeKind:scope.scopeKind,
    scopeKey:scope.scopeKey,
    scopeRootRelativeLocation:scope.scopeRootRelativeLocation,
    members:probeMembers.map((member, ordinal) => ({
      ordinal,
      materialKey:member.materialKey,
      selectionRole:'triage_input',
      physicalIdentity:member.readHandle.identity,
      sizeBytes:100,
      bindingRevision:1,
      eligibilityRevision:1,
      eligibilityBasisDigest:d(`scope-eligibility:${ordinal}`),
      lastSnapshotDigest:d(`scope-snapshot:${ordinal}`),
      lastObservationId:'observation-1',
      endpointId:'endpoint-1',
      location:member.readHandle.location,
      realityDigest:d(`scope-reality:${ordinal}`),
      provenanceDigest:d(`scope-provenance:${ordinal}`),
      controlSnapshot:{},
      admissionControlAction:'acquire',
    })),
  });
  const probeBatch = batch(probeMembers);
  probeBatch.selectionDigest = selected.selectionDigest;
  probeBatch.batchDigest = canonicalDigest(Object.fromEntries(
    Object.entries(probeBatch).filter(([key]) => key !== 'batchDigest'),
  ));
  const playability = capabilities.playabilityInspect.execute({
    triageMaterialProbeBatch:probeBatch,
    procurementTriageRuleSnapshot:rule,
  });
  const contextValue = {
    fieldId:'field-1',
    accessRevision:1,
    accessDigest:d('scope-access'),
    profileHintSnapshot:profileHintSnapshot('movie'),
    memberContexts:probeMembers.map((member, selectionOrdinal) => ({
      selectionOrdinal,
      materialKey:member.materialKey,
      fieldRelativeLocation:member.readHandle.location,
      baseName:member.readHandle.location.split('/').at(-1),
      extension:'.mkv',
      parentSegments:member.readHandle.location.split('/').slice(0, -1),
      layoutEvidenceRefs:[],
    })),
  };
  const materialFieldContext = { ...contextValue, contextDigest:canonicalDigest(contextValue) };
  const pageValue = { pageOrdinal:0, cursorIn:null, maxUnits:100 };
  const pageRequest = { ...pageValue, requestDigest:canonicalDigest(pageValue) };
  const input = {
    selectedFieldMaterialSet:selected,
    probeBatches:[probeBatch],
    playabilityPages:[playability],
    materialFieldContext,
    layoutEvidence:[],
    pageRequest,
    inputDigest:canonicalDigest({
      schema:'procurement.triage-structure-input@1',
      selectionDigest:selected.selectionDigest,
      probeBatchDigests:[probeBatch.batchDigest],
      playabilityPayloadDigests:[playability.payloadDigest],
      contextDigest:materialFieldContext.contextDigest,
      layoutPayloadDigests:[],
      pageRequest,
    }),
  };
  return capabilities.structureInspect.execute({
    triageStructureInspectionInput:input,
    procurementTriageRuleSnapshot:rule,
  });
}

function batch(members) {
  const value = { procurementRunId:'run-1', runBasisDigest:d('run-basis'), selectionDigest:d('selection'), batchOrdinal:0,
    members, batchDigest:'' };
  value.batchDigest = canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'batchDigest')));
  return value;
}

function scopedSelection(members, selectionDigest) {
  return {
    ...createSingleScopeSelection({
      procurementRunId:'run-1',
      fieldId:'field-1',
      members,
      scopeKind:'ordinary_directory',
      scopeKey:'ordinary-directory:shows',
      scopeRootRelativeLocation:'shows',
    }),
    selectionDigest,
  };
}

function singleStructureFixture(label, contentProfileHint) {
  const member = probeMember(0, label);
  const probeBatch = batch([member]);
  const playability = capabilities.playabilityInspect.execute({
    triageMaterialProbeBatch: probeBatch,
    procurementTriageRuleSnapshot: rule,
  });
  const selected = scopedSelection([{
      ordinal: 0,
      materialKey: member.materialKey,
      selectionRole: 'triage_input',
      physicalIdentity: member.readHandle.identity,
      sizeBytes: 100,
      bindingRevision: 1,
      eligibilityRevision: 1,
      eligibilityBasisDigest: d(`eligibility:${label}`),
      lastSnapshotDigest: d(`snapshot:${label}`),
      lastObservationId: 'observation-1',
      endpointId: 'endpoint-1',
      location: member.readHandle.location,
      realityDigest: d(`reality:${label}`),
      provenanceDigest: d(`provenance:${label}`),
      controlSnapshot: {},
      admissionControlAction: 'acquire',
      basisMemberDigest: d(`basis:${label}`),
    }], probeBatch.selectionDigest);
  const contextValue = {
    fieldId: 'field-1',
    accessRevision: 1,
    accessDigest: d('access'),
    profileHintSnapshot:profileHintSnapshot(contentProfileHint),
    memberContexts: [{
      selectionOrdinal: 0,
      materialKey: member.materialKey,
      fieldRelativeLocation: member.readHandle.location,
      baseName: `${label}.mkv`,
      extension: '.mkv',
      parentSegments: [],
      layoutEvidenceRefs: [],
    }],
  };
  const materialFieldContext = {
    ...contextValue,
    contextDigest: canonicalDigest(contextValue),
  };
  const requestValue = { pageOrdinal: 0, cursorIn: null, maxUnits: 100 };
  const pageRequest = {
    ...requestValue,
    requestDigest: canonicalDigest(requestValue),
  };
  const input = {
    selectedFieldMaterialSet: selected,
    probeBatches: [probeBatch],
    playabilityPages: [playability],
    materialFieldContext,
    layoutEvidence: [],
    pageRequest,
    inputDigest: canonicalDigest({
      schema: 'procurement.triage-structure-input@1',
      selectionDigest: selected.selectionDigest,
      probeBatchDigests: [probeBatch.batchDigest],
      playabilityPayloadDigests: [playability.payloadDigest],
      contextDigest: materialFieldContext.contextDigest,
      layoutPayloadDigests: [],
      pageRequest,
    }),
  };
  return {
    structure: capabilities.structureInspect.execute({
      triageStructureInspectionInput: input,
      procurementTriageRuleSnapshot: rule,
    }),
    probeBatch,
  };
}

function movieStructureInput(count, pageOrdinal=0, cursorIn=null) {
  const members=Array.from({length:count},(_,index)=>probeMember(index,`movie-${String(index).padStart(3,'0')}-${'x'.repeat(96)}`));
  const probeBatch=batch(members);const playability=capabilities.playabilityInspect.execute({
    triageMaterialProbeBatch:probeBatch,procurementTriageRuleSnapshot:rule});
  const selected=scopedSelection(members.map((member,ordinal)=>({ordinal,
    materialKey:member.materialKey,selectionRole:'triage_input',physicalIdentity:member.readHandle.identity,sizeBytes:100,bindingRevision:1,
    eligibilityRevision:1,eligibilityBasisDigest:d(`eligibility:${ordinal}`),lastSnapshotDigest:d(`snapshot:${ordinal}`),
    lastObservationId:`observation-${ordinal}`,endpointId:'endpoint-1',location:member.readHandle.location,realityDigest:d(`reality:${ordinal}`),
    provenanceDigest:d(`provenance:${ordinal}`),controlSnapshot:{},admissionControlAction:'acquire',basisMemberDigest:d(`basis:${ordinal}`)})),
    probeBatch.selectionDigest);
  const contextValue={fieldId:'field-1',accessRevision:1,accessDigest:d('access'),profileHintSnapshot:profileHintSnapshot('movie'),
    memberContexts:members.map((member,selectionOrdinal)=>({selectionOrdinal,materialKey:member.materialKey,
      fieldRelativeLocation:member.readHandle.location,baseName:`movie-${selectionOrdinal}-${'x'.repeat(96)}.mkv`,extension:'.mkv',
      parentSegments:[],layoutEvidenceRefs:[]}))};
  const materialFieldContext={...contextValue,contextDigest:canonicalDigest(contextValue)};
  const requestValue={pageOrdinal,cursorIn,maxUnits:32};const pageRequest={...requestValue,requestDigest:canonicalDigest(requestValue)};
  const basis={schema:'procurement.triage-structure-input@1',selectionDigest:selected.selectionDigest,
    probeBatchDigests:[probeBatch.batchDigest],playabilityPayloadDigests:[playability.payloadDigest],contextDigest:materialFieldContext.contextDigest,
    layoutPayloadDigests:[],pageRequest};
  return {selectedFieldMaterialSet:selected,probeBatches:[probeBatch],playabilityPages:[playability],materialFieldContext,
    layoutEvidence:[],pageRequest,inputDigest:canonicalDigest(basis)};
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

test('Structure applies the persisted mixed-Field Scope title and Related association rules', () => {
  const standalone = movieScopeStructure(['苹果.mkv'], {
    scopeKind:'standalone_file',
    scopeKey:'standalone-file:苹果.mkv',
    scopeRootRelativeLocation:'苹果.mkv',
  });
  assert.equal(standalone.units.length, 1);
  assert.equal(standalone.units[0].displayIdentity, '苹果');
  assert.equal(standalone.units[0].relatedScope.parentRelativeLocation, '.');
  assert.equal(standalone.units[0].relatedScope.associationMode, 'standalone_same_stem');

  const singleDirectory = movieScopeStructure(['One Movie/Feature.mkv'], {
    scopeKind:'ordinary_directory',
    scopeKey:'ordinary-directory:One Movie',
    scopeRootRelativeLocation:'One Movie',
  });
  assert.equal(singleDirectory.units.length, 1);
  assert.equal(singleDirectory.units[0].displayIdentity, 'One Movie');
  assert.equal(singleDirectory.units[0].relatedScope.associationMode, 'single_movie_directory');

  const multiDirectory = movieScopeStructure([
    'Mixed Folder/First Film.mkv',
    'Mixed Folder/Second Film.mkv',
  ], {
    scopeKind:'ordinary_directory',
    scopeKey:'ordinary-directory:Mixed Folder',
    scopeRootRelativeLocation:'Mixed Folder',
  });
  assert.deepEqual(
    multiDirectory.units.map((unit) => unit.displayIdentity).sort(),
    ['First Film', 'Second Film'],
  );
  assert.ok(multiDirectory.units.every(
    (unit) => unit.relatedScope.associationMode === 'multi_movie_directory',
  ));
});

test('Structure automatically paginates complete Movie Units at the 64 KiB boundary', () => {
  const collected=[];let cursorIn=null,pageOrdinal=0;
  do {
    const result=capabilities.structureInspect.execute({triageStructureInspectionInput:movieStructureInput(100,pageOrdinal,cursorIn),
      procurementTriageRuleSnapshot:rule});
    assert.ok(Buffer.byteLength(JSON.stringify(result),'utf8')<=65536);
    assert.ok(result.units.length>=1&&result.units.length<=32);
    collected.push(...result.units.map((unit)=>unit.unitId));cursorIn=result.cursorOut;pageOrdinal+=1;
  } while(cursorIn!==null);
  assert.equal(pageOrdinal>1,true);
  assert.equal(collected.length,100);
  assert.equal(new Set(collected).size,100);
});

test('explicit JAV Hint falls back to title without inventing a code and mixed remains movie fallback', () => {
  const explicit = singleStructureFixture('Summer Night Feature', 'jav');
  assert.equal(explicit.structure.units.length, 1);
  const unit = explicit.structure.units[0];
  assert.equal(unit.mediaType, 'single');
  assert.equal(unit.contentProfile, 'jav');
  assert.equal(unit.structureKind, 'single');
  assert.equal(unit.displayIdentity, 'Summer Night Feature');
  assert.equal(Object.hasOwn(unit.identityMetadata, 'javCode'), false);
  assert.deepEqual(
    unit.identityMetadata.sourceHints.map((hint) => hint.hintKind),
    ['field_content_profile_hint', 'filename_title'],
  );
  assert.equal(
    unit.identityMetadata.sourceHints[0].evidenceDigest,
    profileHintSnapshot('jav').hintDigest,
  );
  const identity = capabilities.identityClaimResolve.execute({
    triageIdentityResolutionInput: {
      procurementRunId: 'run-1',
      runBasisDigest: explicit.probeBatch.runBasisDigest,
      triageRuleAuthorityDigest: rule.authorityDigest,
      structureEvidenceId: explicit.structure.evidenceId,
      structureEvidencePayloadDigest: explicit.structure.payloadDigest,
      unit,
      inputDigest: d('explicit-jav-no-code-identity'),
    },
    procurementTriageRuleSnapshot: rule,
  });
  assert.equal(identity.claimKind, 'jav_code');
  assert.equal(identity.contentProfile, 'jav');
  assert.equal(identity.displayIdentity, 'Summer Night Feature');
  assert.equal(Object.hasOwn(identity, 'javCode'), false);
  assert.equal(identity.sourceHints.some(
    (hint) => hint.hintKind === 'jav_code'
  ), false);

  const mixed = singleStructureFixture('Summer Night Feature', 'mixed');
  assert.equal(mixed.structure.units.length, 1);
  assert.equal(mixed.structure.units[0].contentProfile, 'movie');
  assert.equal(mixed.structure.units[0].displayIdentity,
    'shows');

  const western = singleStructureFixture('Summer Night Feature', 'western_adult');
  assert.equal(western.structure.units.length, 1);
  assert.equal(western.structure.units[0].contentProfile, 'western_adult');
  assert.equal(western.structure.units[0].mediaType, 'single');
  assert.equal(western.structure.units[0].structureKind, 'single');
  assert.equal(western.structure.units[0].identityMetadata.contentProfileHint,
    'western_adult');
  assert.deepEqual(
    western.structure.units[0].identityMetadata.sourceHints
      .filter((hint) => hint.hintKind === 'field_content_profile_hint'),
    [{
      hintKind:'field_content_profile_hint',
      hintValue:'western_adult',
      evidenceDigest:profileHintSnapshot('western_adult').hintDigest,
    }],
  );
});

test('structure preserves Selection mapping and carries series mediaType/contentProfile into Identity and Manifest Draft', () => {
  const member = probeMember(0, 'Demo.S02E03-04'); const probeBatch = batch([member]);
  const playability = capabilities.playabilityInspect.execute({ triageMaterialProbeBatch:probeBatch, procurementTriageRuleSnapshot:rule });
  const selected = scopedSelection([{ ordinal:0, materialKey:member.materialKey,
    selectionRole:'triage_input', physicalIdentity:member.readHandle.identity,sizeBytes:100,bindingRevision:1, eligibilityRevision:1, eligibilityBasisDigest:d('eligibility'),
    lastSnapshotDigest:d('snapshot'), lastObservationId:'observation-1', endpointId:'endpoint-1', location:member.readHandle.location,
    realityDigest:d('reality'), provenanceDigest:d('provenance'), controlSnapshot:{}, admissionControlAction:'acquire',
    basisMemberDigest:d('basis-member') }], probeBatch.selectionDigest);
  const context = { fieldId:'field-1', accessRevision:1, accessDigest:d('access'), profileHintSnapshot:profileHintSnapshot('series'),
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
    candidateMembers:structure.units[0].members.map((candidate) => ({ ...candidate,
      physicalIdentity:selected.members.find((selectedMember) => selectedMember.materialKey === candidate.materialKey).physicalIdentity,
      sizeBytes:selected.members.find((selectedMember) => selectedMember.materialKey === candidate.materialKey).sizeBytes,
    })), structureEvidenceId:structure.evidenceId, structureEvidencePayloadDigest:structure.payloadDigest,
    unit:structure.units[0], preallocatedManifestId:'manifest-1', inputDigest:d('manifest-input') };
  const manifest = capabilities.primaryManifestBuild.execute({ triageManifestBuildInput:manifestInput, procurementTriageRuleSnapshot:rule });
  assert.equal(manifest.memberCount, 1); assert.equal(manifest.structureKind, 'season');
  const expectedMembers = [{ ordinal:0, materialKey:member.materialKey, role:'primary_payload',physicalIdentity:member.readHandle.identity,sizeBytes:100,bindingRevision:1,
    admittedControlRevision:2, admittedControlProjectionDigest:member.admittedControlProjectionDigest,
    episodeClaims:structure.units[0].members[0].episodeClaims }];
  assert.equal(manifest.membersDigest, canonicalDigest({ schema:'procurement.primary-input-manifest-members@1', items:expectedMembers }));
});

test('Series Triage aggregates N:M Episode members into one Season unit without inventing a continuity claim', () => {
  const first = probeMember(0, 'Demo.Show.S01E01-02');
  const second = probeMember(1, 'Demo.Show.S01E03');
  const probeBatch = batch([first, second]);
  const playability = capabilities.playabilityInspect.execute({
    triageMaterialProbeBatch: probeBatch,
    procurementTriageRuleSnapshot: rule,
  });
  const selectedMembers = [first, second].map((member, ordinal) => ({
    ordinal,
    materialKey: member.materialKey,
    selectionRole: 'triage_input',
    physicalIdentity: member.readHandle.identity,
    sizeBytes: 100,
    bindingRevision: 1,
    eligibilityRevision: 1,
    eligibilityBasisDigest: d(`eligibility:${ordinal}`),
    lastSnapshotDigest: d(`snapshot:${ordinal}`),
    lastObservationId: 'observation-1',
    endpointId: 'endpoint-1',
    location: member.readHandle.location,
    realityDigest: d(`reality:${ordinal}`),
    provenanceDigest: d(`provenance:${ordinal}`),
    controlSnapshot: {},
    admissionControlAction: 'acquire',
    basisMemberDigest: d(`basis:${ordinal}`),
  }));
  const selected = scopedSelection(selectedMembers, probeBatch.selectionDigest);
  const contexts = [first, second].map((member, selectionOrdinal) => ({
    selectionOrdinal,
    materialKey: member.materialKey,
    fieldRelativeLocation: member.readHandle.location,
    baseName: selectionOrdinal === 0 ? 'Demo.Show.S01E01-02.mkv' : 'Demo.Show.S01E03.mkv',
    extension: '.mkv',
    parentSegments: ['shows', 'Demo Show', 'Season 1'],
    layoutEvidenceRefs: [],
  }));
  const contextBase = {
    fieldId: 'field-1',
    accessRevision: 1,
    accessDigest: d('access'),
    profileHintSnapshot: profileHintSnapshot('mixed'),
    memberContexts: contexts,
  };
  const context = { ...contextBase, contextDigest: canonicalDigest(contextBase) };
  const pageBase = { pageOrdinal: 0, cursorIn: null, maxUnits: 100 };
  const pageRequest = { ...pageBase, requestDigest: canonicalDigest(pageBase) };
  const input = {
    selectedFieldMaterialSet: selected,
    probeBatches: [probeBatch],
    playabilityPages: [playability],
    materialFieldContext: context,
    layoutEvidence: [],
    pageRequest,
    inputDigest: canonicalDigest({
      schema: 'procurement.triage-structure-input@1',
      selectionDigest: selected.selectionDigest,
      probeBatchDigests: [probeBatch.batchDigest],
      playabilityPayloadDigests: [playability.payloadDigest],
      contextDigest: context.contextDigest,
      layoutPayloadDigests: [],
      pageRequest,
    }),
  };
  const structure = capabilities.structureInspect.execute({
    triageStructureInspectionInput: input,
    procurementTriageRuleSnapshot: rule,
  });
  assert.equal(structure.resultKind, 'resolved');
  assert.equal(structure.units.length, 1);
  assert.equal(structure.units[0].contentProfile, 'series');
  assert.equal(structure.units[0].structureKind, 'season');
  assert.equal(structure.units[0].members.length, 2);
  assert.deepEqual(
    structure.units[0].members.flatMap((member) => member.episodeClaims.map((claim) => claim.episodeKey)).sort(),
    ['E001', 'E002', 'E003'],
  );
  assert.deepEqual(structure.units[0].seasonContinuityClaims, []);
  assert.equal(
    structure.units[0].seasonContinuityClaimSetDigest,
    canonicalDigest({ schema: 'season-continuity-claim-set@1', items: [] }),
  );
  assert.equal(structure.units[0].identityMetadata.claimedTitle, 'Demo.Show');
});

test('Series Triage rejects overlapping Episode claims inside one Candidate unit', () => {
  const first = probeMember(0, 'Demo.Show.S01E01-02');
  const second = probeMember(1, 'Demo.Show.S01E02-03');
  const probeBatch = batch([first, second]);
  const playability = capabilities.playabilityInspect.execute({
    triageMaterialProbeBatch: probeBatch,
    procurementTriageRuleSnapshot: rule,
  });
  const selected = scopedSelection([first, second].map((member, ordinal) => ({
      ordinal,
      materialKey: member.materialKey,
      selectionRole: 'triage_input',
      physicalIdentity: member.readHandle.identity,
      sizeBytes: 100,
      bindingRevision: 1,
      eligibilityRevision: 1,
      eligibilityBasisDigest: d(`eligibility-overlap:${ordinal}`),
      lastSnapshotDigest: d(`snapshot-overlap:${ordinal}`),
      lastObservationId: 'observation-1',
      endpointId: 'endpoint-1',
      location: member.readHandle.location,
      realityDigest: d(`reality-overlap:${ordinal}`),
      provenanceDigest: d(`provenance-overlap:${ordinal}`),
      controlSnapshot: {},
      admissionControlAction: 'acquire',
      basisMemberDigest: d(`basis-overlap:${ordinal}`),
    })), probeBatch.selectionDigest);
  const contextBase = {
    fieldId: 'field-1',
    accessRevision: 1,
    accessDigest: d('access-overlap'),
    profileHintSnapshot: profileHintSnapshot('mixed'),
    memberContexts: [first, second].map((member, selectionOrdinal) => ({
      selectionOrdinal,
      materialKey: member.materialKey,
      fieldRelativeLocation: member.readHandle.location,
      baseName: selectionOrdinal === 0 ? 'Demo.Show.S01E01-02.mkv' : 'Demo.Show.S01E02-03.mkv',
      extension: '.mkv',
      parentSegments: ['shows', 'Demo Show', 'Season 1'],
      layoutEvidenceRefs: [],
    })),
  };
  const context = { ...contextBase, contextDigest: canonicalDigest(contextBase) };
  const pageBase = { pageOrdinal: 0, cursorIn: null, maxUnits: 100 };
  const pageRequest = { ...pageBase, requestDigest: canonicalDigest(pageBase) };
  const structure = capabilities.structureInspect.execute({
    triageStructureInspectionInput: {
      selectedFieldMaterialSet: selected,
      probeBatches: [probeBatch],
      playabilityPages: [playability],
      materialFieldContext: context,
      layoutEvidence: [],
      pageRequest,
      inputDigest: canonicalDigest({
        schema: 'procurement.triage-structure-input@1',
        selectionDigest: selected.selectionDigest,
        probeBatchDigests: [probeBatch.batchDigest],
        playabilityPayloadDigests: [playability.payloadDigest],
        contextDigest: context.contextDigest,
        layoutPayloadDigests: [],
        pageRequest,
      }),
    },
    procurementTriageRuleSnapshot: rule,
  });
  assert.equal(structure.resultKind, 'not_ready');
  assert.equal(structure.units.length, 0);
  assert.equal(structure.unassignedMaterials.length, 2);
  assert.deepEqual(
    [...new Set(structure.unassignedMaterials.map((item) => item.reasonCode))],
    ['structure_ambiguous'],
  );
});

test('Movie Triage associates only the exact NFO sidecar and conserves its canonical Related Reference', () => {
  const member = probeMember(0, 'Example.Movie');
  const probeBatch = batch([member]);
  const playability = capabilities.playabilityInspect.execute({
    triageMaterialProbeBatch: probeBatch,
    procurementTriageRuleSnapshot: rule,
  });
  const selected = scopedSelection([{
      ordinal: 0,
      materialKey: member.materialKey,
      selectionRole: 'triage_input',
      physicalIdentity: member.readHandle.identity,
      sizeBytes: 100,
      bindingRevision: 1,
      eligibilityRevision: 1,
      eligibilityBasisDigest: d('eligibility'),
      lastSnapshotDigest: d('snapshot'),
      lastObservationId: 'observation-1',
      endpointId: 'endpoint-1',
      location: member.readHandle.location,
      realityDigest: d('reality'),
      provenanceDigest: d('provenance'),
      controlSnapshot: {},
      admissionControlAction: 'acquire',
      basisMemberDigest: d('basis-member'),
    }], probeBatch.selectionDigest);
  function relatedIdentity(label, inode) {
    const value = {
      schemaRef: 'helix://contracts/types/PhysicalMaterialIdentity/v2',
      schemaVersion: 2,
      mountScopeId: 'mount-1',
      inode,
      sizeBytes: 20,
      fingerprintAlgorithm: 'middle-256k-sha256',
      fingerprintVersion: 1,
      contentFingerprint: d(label),
    };
    value.materialKey = canonicalDigest({
      schema: 'physical-material-identity@2',
      mountScopeId: value.mountScopeId,
      inode: value.inode,
      sizeBytes: value.sizeBytes,
      fingerprintAlgorithm: 'middle-256k-sha256',
      fingerprintVersion: 1,
      contentFingerprint: value.contentFingerprint,
    });
    return value;
  }
  const nfoIdentity = relatedIdentity('example-nfo', '10');
  const unrelatedIdentity = relatedIdentity('unrelated-nfo', '11');
  const entryValues = [
    {
      entryOrdinal: 0, entryKind: 'directory', relativeLocation: '.',
      baseName: '银翼杀手：2022黑暗浩劫 (2017)', endpointId: 'endpoint-1', location: 'shows/Demo',
    },
    {
      entryOrdinal: 1, entryKind: 'file', relativeLocation: 'shows/Demo/Example.Movie.nfo',
      baseName: 'Example.Movie.nfo', extension: '.nfo', identity: nfoIdentity,
      endpointId: 'endpoint-1', location: 'shows/Demo/Example.Movie.nfo', sizeBytes: 20,
      fingerprintAlgorithm: nfoIdentity.fingerprintAlgorithm, fingerprintVersion: nfoIdentity.fingerprintVersion,
      contentFingerprint: nfoIdentity.contentFingerprint,
    },
    {
      entryOrdinal: 2, entryKind: 'file', relativeLocation: 'shows/Demo/Other.Title.nfo',
      baseName: 'Other.Title.nfo', extension: '.nfo', identity: unrelatedIdentity,
      endpointId: 'endpoint-1', location: 'shows/Demo/Other.Title.nfo', sizeBytes: 20,
      checksumAlgorithm: 'sha256', checksumHex: unrelatedIdentity.contentFingerprint,
    },
    {
      entryOrdinal: 3, entryKind: 'file', relativeLocation: 'shows/Demo/Example.Movie.mkv',
      baseName: 'Example.Movie.mkv', extension: '.mkv', identity: member.readHandle.identity,
      endpointId: 'endpoint-1', location: member.readHandle.location, sizeBytes: 100,
      checksumAlgorithm: 'sha256', checksumHex: member.readHandle.identity.contentFingerprint,
    },
  ];
  const entries = entryValues.map((value) => ({
    ...value,
    entryDigest: canonicalDigest(value),
  }));
  const layoutBase = {
    schemaRef: 'helix://contracts/types/LayoutEvidence/v1',
    schemaVersion: 1,
    evidenceId: 'layout-example-movie',
    evidenceKind: 'field_layout',
    producerRef: 'procurement.movie-related-material-association@1',
    basisDigest: d('layout-basis'),
    payloadDigest: '',
    observedAtMs: 1,
    sourceHandleDigest: d('layout-source'),
    boundedScopeDigest: d('layout-scope'),
    entries,
    entriesDigest: canonicalDigest({ schema: 'procurement.movie-layout-entries@1', items: entries }),
    layoutDigest: d('layout'),
  };
  const layout = {
    ...layoutBase,
    payloadDigest: canonicalDigest(Object.fromEntries(
      Object.entries(layoutBase).filter(([key]) => key !== 'payloadDigest'),
    )),
  };
  const contextBase = {
    fieldId: 'field-1',
    accessRevision: 1,
    accessDigest: d('access'),
    profileHintSnapshot: profileHintSnapshot('movie'),
    memberContexts: [{
      selectionOrdinal: 0,
      materialKey: member.materialKey,
      fieldRelativeLocation: member.readHandle.location,
      baseName: 'Example.Movie.mkv',
      extension: '.mkv',
      parentSegments: [],
      layoutEvidenceRefs: [{
        evidenceId: layout.evidenceId,
        payloadDigest: layout.payloadDigest,
        boundedScopeDigest: layout.boundedScopeDigest,
      }],
    }],
  };
  const context = { ...contextBase, contextDigest: canonicalDigest(contextBase) };
  const pageBase = { pageOrdinal: 0, cursorIn: null, maxUnits: 100 };
  const pageRequest = { ...pageBase, requestDigest: canonicalDigest(pageBase) };
  const structureBase = {
    selectedFieldMaterialSet: selected,
    probeBatches: [probeBatch],
    playabilityPages: [playability],
    materialFieldContext: context,
    layoutEvidence: [layout],
    pageRequest,
  };
  const structureInput = {
    ...structureBase,
    inputDigest: canonicalDigest({
      schema: 'procurement.triage-structure-input@1',
      selectionDigest: selected.selectionDigest,
      probeBatchDigests: [probeBatch.batchDigest],
      playabilityPayloadDigests: [playability.payloadDigest],
      contextDigest: context.contextDigest,
      layoutPayloadDigests: [layout.payloadDigest],
      pageRequest,
    }),
  };
  const structure = capabilities.structureInspect.execute({
    triageStructureInspectionInput: structureInput,
    procurementTriageRuleSnapshot: rule,
  });
  assert.equal(structure.units.length, 1);
  assert.equal(structure.units[0].members.length, 1);
  assert.equal(structure.units[0].displayIdentity, 'shows');
  assert.equal(structure.units[0].identityMetadata.sourceHints.some((hint) =>
    hint.hintKind === 'directory_title' && hint.hintValue === 'shows'), true);
  assert.equal(structure.units[0].relatedScope.scopeKind, 'ordinary_parent');
  assert.equal(structure.units[0].relatedScope.parentRelativeLocation, 'shows/Demo');
  assert.equal(structure.units[0].relatedScope.stemKey, 'example.movie');
  assert.equal(Object.hasOwn(structure.units[0], 'relatedReferences'), false);
  assert.equal(structure.units[0].materialInputForm, 'stream_file');

  const oversizedEntries = Array.from({ length: 256 }, (_, ordinal) => {
    const identity = relatedIdentity(`oversized-nfo-${ordinal}`, String(1000 + ordinal));
    const value = {
      entryOrdinal: ordinal,
      entryKind: 'file',
      relativeLocation: `shows/Demo/metadata-${String(ordinal).padStart(3, '0')}/movie.nfo`,
      baseName: 'movie.nfo',
      extension: '.nfo',
      identity,
      endpointId: 'endpoint-1',
      location: `shows/Demo/metadata-${String(ordinal).padStart(3, '0')}/movie.nfo`,
      sizeBytes: 20,
      checksumAlgorithm: 'sha256',
      checksumHex: identity.contentFingerprint,
    };
    return { ...value, entryDigest: canonicalDigest(value) };
  });
  const oversizedLayoutBase = {
    ...layoutBase,
    evidenceId: 'layout-oversized-movie',
    entries: oversizedEntries,
    entriesDigest: canonicalDigest({
      schema: 'procurement.movie-layout-entries@1',
      items: oversizedEntries,
    }),
    payloadDigest: '',
  };
  const oversizedLayout = {
    ...oversizedLayoutBase,
    payloadDigest: canonicalDigest(Object.fromEntries(
      Object.entries(oversizedLayoutBase).filter(([key]) => key !== 'payloadDigest'),
    )),
  };
  const oversizedContextBase = {
    ...contextBase,
    memberContexts: [{
      ...contextBase.memberContexts[0],
      layoutEvidenceRefs: [{
        evidenceId: oversizedLayout.evidenceId,
        payloadDigest: oversizedLayout.payloadDigest,
        boundedScopeDigest: oversizedLayout.boundedScopeDigest,
      }],
    }],
  };
  const oversizedContext = {
    ...oversizedContextBase,
    contextDigest: canonicalDigest(oversizedContextBase),
  };
  const oversizedResult = capabilities.structureInspect.execute({
    triageStructureInspectionInput: {
      selectedFieldMaterialSet: selected,
      probeBatches: [probeBatch],
      playabilityPages: [playability],
      materialFieldContext: oversizedContext,
      layoutEvidence: [oversizedLayout],
      pageRequest,
      inputDigest: canonicalDigest({
        schema: 'procurement.triage-structure-input@1',
        selectionDigest: selected.selectionDigest,
        probeBatchDigests: [probeBatch.batchDigest],
        playabilityPayloadDigests: [playability.payloadDigest],
        contextDigest: oversizedContext.contextDigest,
        layoutPayloadDigests: [oversizedLayout.payloadDigest],
        pageRequest,
      }),
    },
    procurementTriageRuleSnapshot: rule,
  });
  assert.equal(oversizedResult.resultKind, 'resolved');
  assert.equal(oversizedResult.units.length, 1);
  assert.equal(oversizedResult.units[0].relatedScope.scopeKind, 'ordinary_parent');
  assert.equal(oversizedResult.unassignedMaterials.length, 0);
});

test('Triage module has no Store, Provider, Runtime, or legacy fallback dependency', () => {
  const source = require('node:fs').readFileSync(require('node:path').resolve(__dirname,
    '../../src/helix/domains/procurement/model/triage-contracts.js'), 'utf8');
  for (const token of ['../persistence', 'provider', 'fallback', 'legacy', 'runtime']) assert.equal(source.toLowerCase().includes(token), false);
});
