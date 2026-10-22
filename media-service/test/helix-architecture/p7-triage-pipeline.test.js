'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createDefaultTriageRuleRegistry } = require('../../src/helix/domains/procurement/model/procurement-run-contracts');
const { createTriageCapabilities } = require('../../src/helix/domains/procurement/capabilities/triage-pipeline');
const { createSingleScopeSelection } = require('./helpers/procurement-selection-fixture');

const d = (label) => canonicalDigest({ label });
const rule = createDefaultTriageRuleRegistry().entries[0];
test('JAV actual named parts form one ordered unit without an expected-part gate',()=>{
  const scope={scopeKind:'ordinary_directory',scopeKey:'ordinary-directory:DDT-548',scopeRootRelativeLocation:'DDT-548'};
  const both=movieScopeStructure(['DDT-548/DDT-548B.mp4','DDT-548/DDT-548A.mp4'],scope,'jav');
  assert.equal(both.units.length,1);
  const unit=both.units[0];
  assert.equal(unit.materialInputForm,'jav_named_parts');
  assert.equal(unit.members.length,2);
  assert.equal(unit.identityMetadata.javCode,'DDT-548');
  assert.deepEqual(unit.javPartSet.parts.map(part=>part.partLabel),['A','B']);
  assert.deepEqual(unit.javPartSet.parts.map(part=>part.relativeLocation),['DDT-548/DDT-548A.mp4','DDT-548/DDT-548B.mp4']);
  for(const label of ['A','B']) {
    const single=movieScopeStructure([`DDT-548/DDT-548${label}.mp4`],scope,'jav');
    assert.equal(single.units.length,1);
    assert.equal(single.units[0].materialInputForm,'stream_file');
    assert.equal(single.units[0].identityMetadata.javCode,'DDT-548');
    assert.equal(single.units[0].javPartSet,undefined);
  }
  const ordinary=movieScopeStructure(['DDT-548/DDT-548.mp4','DDT-548/DDT-548A.mp4','DDT-548/DDT-548B.mp4'],scope,'jav');
  assert.equal(ordinary.units.length,2);
  const conflict=movieScopeStructure(['DDT-548/DDT-548A.mp4','DDT-548/DDT-548-A.mkv','DDT-548/DDT-548B.mp4'],scope,'jav');
  assert.equal(conflict.units.length,0);
  assert.equal(conflict.unassignedMaterials.length,3);
});
test('JAV filename extraction conserves complete special codes and leaves conflicting or truncated codes unconfirmed',()=>{
  const samples=[['FC2 PPV 718323','FC2-718323'],['HEYDOUGA-4030-3073','HEYDOUGA-4030-3073'],['IBW-398Z','IBW-398Z'],
    ['RED030','RED030'],['T38-047','T38-047'],['259LUXU-001','259LUXU-001'],['GETCHU-12345','GETCHU-12345'],
    ['IPX-177 and IPX-178',null],['HEYDOUGA-4030',null],['FC2-718323-999',null]];
  for(const [name,expected] of samples) {
    const value=singleStructureFixture(name,'jav'),unit=value.structure.units[0];
    assert.equal(unit.identityMetadata.javCode||null,expected,name);
  }
});
const capabilities = createTriageCapabilities({ now:() => 1000 });
const { reconstructStructureUnits } = require('../../src/helix/domains/procurement/model/triage-contracts');
function inspectFullStructure({ triageStructureInspectionInput:input, procurementTriageRuleSnapshot:rule }) {
  const record = capabilities.structureInspect.execute({ triageStructureInspectionInput:input, procurementTriageRuleSnapshot:rule });
  return { ...record, units:reconstructStructureUnits(record,input,rule) };
}
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

function movieScopeStructure(locations, scope, hint='movie') {
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
    profileHintSnapshot:profileHintSnapshot(hint),
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
  return inspectFullStructure({
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
    structure: inspectFullStructure({
      triageStructureInspectionInput: input,
      procurementTriageRuleSnapshot: rule,
    }),
    probeBatch,
  };
}

function movieStructureInput(count, pageOrdinal=0, cursorIn=null, profile='movie', title='Demo.Show') {
  const members=Array.from({length:count},(_,index)=>probeMember(index,profile === 'series' ? `${title}.S01E${String(index%999+1).padStart(3,'0')}.part${index}` : `movie-${String(index).padStart(3,'0')}-${'x'.repeat(96)}`));
  const probeBatches=[];
  for(let offset=0;offset<members.length;offset+=100) {
    const item=batch(members.slice(offset,offset+100)); item.batchOrdinal=offset/100;
    item.batchDigest=canonicalDigest(Object.fromEntries(Object.entries(item).filter(([key])=>key!=='batchDigest')));
    probeBatches.push(item);
  }
  const playabilityPages=probeBatches.map(probeBatch=>capabilities.playabilityInspect.execute({
    triageMaterialProbeBatch:probeBatch,procurementTriageRuleSnapshot:rule}));
  const selected=scopedSelection(members.map((member,ordinal)=>({ordinal,
    materialKey:member.materialKey,selectionRole:'triage_input',physicalIdentity:member.readHandle.identity,sizeBytes:100,bindingRevision:1,
    eligibilityRevision:1,eligibilityBasisDigest:d(`eligibility:${ordinal}`),lastSnapshotDigest:d(`snapshot:${ordinal}`),
    lastObservationId:`observation-${ordinal}`,endpointId:'endpoint-1',location:member.readHandle.location,realityDigest:d(`reality:${ordinal}`),
    provenanceDigest:d(`provenance:${ordinal}`),controlSnapshot:{},admissionControlAction:'acquire',basisMemberDigest:d(`basis:${ordinal}`)})),
    probeBatches[0].selectionDigest);
  const contextValue={fieldId:'field-1',accessRevision:1,accessDigest:d('access'),profileHintSnapshot:profileHintSnapshot(profile),
    memberContexts:members.map((member,selectionOrdinal)=>({selectionOrdinal,materialKey:member.materialKey,
      fieldRelativeLocation:member.readHandle.location,baseName:member.readHandle.location.split('/').at(-1),extension:'.mkv',
      parentSegments:[],layoutEvidenceRefs:[]}))};
  const materialFieldContext={...contextValue,contextDigest:canonicalDigest(contextValue)};
  const requestValue={pageOrdinal,cursorIn,maxUnits:32};const pageRequest={...requestValue,requestDigest:canonicalDigest(requestValue)};
  const basis={schema:'procurement.triage-structure-input@1',selectionDigest:selected.selectionDigest,
    probeBatchDigests:probeBatches.map(item=>item.batchDigest),playabilityPayloadDigests:playabilityPages.map(item=>item.payloadDigest),contextDigest:materialFieldContext.contextDigest,
    layoutPayloadDigests:[],pageRequest};
  return {selectedFieldMaterialSet:selected,probeBatches,playabilityPages,materialFieldContext,
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
  assert.equal(singleDirectory.units[0].relatedScope.relatedRuleRevision, 3);

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
    const result=inspectFullStructure({triageStructureInspectionInput:movieStructureInput(100,pageOrdinal,cursorIn),
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
  const structure = inspectFullStructure({ triageStructureInspectionInput:structureInput, procurementTriageRuleSnapshot:rule });
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
  const structure = inspectFullStructure({
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

test('Series Triage preserves overlapping Episode claims inside one Candidate unit', () => {
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
  const structure = inspectFullStructure({
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
  assert.equal(structure.resultKind, 'resolved');
  assert.equal(structure.units.length, 1);
  assert.equal(structure.units[0].members.length, 2);
  assert.equal(new Set(structure.units[0].members.map(item=>item.materialKey)).size,2);
  assert.deepEqual(structure.units[0].members.flatMap(item=>item.episodeClaims.map(claim=>claim.episodeKey)).sort(),
    ['E001','E002','E002','E003']);
  assert.equal(structure.unassignedMaterials.length, 0);
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
  const structure = inspectFullStructure({
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
  const oversizedResult = inspectFullStructure({
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

test('Triage module and explicit continuity parser depend only on declared pure models and canonical JSON', () => {
  const fs=require('node:fs'),path=require('node:path');
  const dependencies=file=>[...fs.readFileSync(path.resolve(__dirname,
    '../../src/helix/domains/procurement/model/',file),'utf8').matchAll(/require\(['"]([^'"]+)['"]\)/g)].map(match=>match[1]).sort();
  assert.deepEqual(dependencies('triage-contracts.js'),[
    '../../../contracts/canonical-json','../../../contracts/jav-part-set','./bdmv-scope','./field-profile-hint-contracts','./jav-filename-identity','./jav-part-groups',
    './local-media-groups','./procurement-run-contracts','./related-artwork-role','./series-continuity-claims',
  ].sort());
  assert.deepEqual(dependencies('series-continuity-claims.js'),['../../../contracts/canonical-json']);
});

test('large Primary Manifest Result is bounded and reconstructs only its exact immutable members',()=>{
  const {buildPrimaryManifestDraft,buildPrimaryManifestDraftRecord,reconstructPrimaryManifestDraft}=require('../../src/helix/domains/procurement/model/triage-contracts');
  const members=Array.from({length:100},(_,i)=>{const p=probeMember(i,'large-'+i);return {materialKey:p.materialKey,physicalIdentity:p.readHandle.identity,sizeBytes:100,role:'primary_payload',bindingRevision:1,admittedControlRevision:2,admittedControlProjectionDigest:d('control-'+i),episodeClaims:[{episodeKey:'S01E'+String(i+1).padStart(2,'0'),claimDigest:d('claim-'+i)}]};});
  const input={procurementRunId:'run-large',runBasisDigest:d('run'),structureEvidenceId:'structure-large',structureEvidencePayloadDigest:d('structure'),preallocatedManifestId:'manifest-large',inputDigest:d('input'),unit:{unitId:'unit-large',unitDigest:d('unit'),structureKind:'season'},candidateMembers:members};
  const full=buildPrimaryManifestDraft(input,rule,{producedAtMs:1000});
  assert.ok(Buffer.byteLength(JSON.stringify(full))>65536);
  const record=buildPrimaryManifestDraftRecord(input,rule,{producedAtMs:1000});
  assert.ok(Buffer.byteLength(JSON.stringify(record))<4096);
  assert.equal(record.members,undefined);
  assert.deepEqual(reconstructPrimaryManifestDraft(record,input,rule),full);
  for(const patch of [{membersDigest:d('forged')},{structureEvidenceId:'other'},{memberCount:99},{extra:true}])
    assert.throws(()=>reconstructPrimaryManifestDraft({...record,...patch},input,rule));
  assert.throws(()=>reconstructPrimaryManifestDraft(record,{...input,candidateMembers:members.slice(1)},rule));
});

for (const count of [95, 1024]) test(`Series Structure reconstructs ${count} complete members from bounded records`, () => {
  const input=movieStructureInput(count,0,null,'series');
  const record=capabilities.structureInspect.execute({triageStructureInspectionInput:input,procurementTriageRuleSnapshot:rule});
  assert.equal(record.units.length,1); assert.equal(record.cursorOut,null);
  assert.equal(record.units[0].recordKind,'series_unit');
  assert.equal(record.units[0].memberCount,count);
  assert.ok(record.units[0].unitCanonicalBytes>65536);
  assert.ok(Buffer.byteLength(JSON.stringify(record))<4096);
  assert.equal(Object.hasOwn(record.units[0],'members'),false);
  assert.equal(Object.hasOwn(record.units[0],'identityMetadata'),false);
  const [unit]=reconstructStructureUnits(record,input,rule);
  assert.equal(unit.members.length,count);
  assert.equal(unit.identityMetadata.sourceHints.filter(h=>h.hintKind==='filename_title').length,count);
  assert.equal(unit.identityMetadata.sourceHints.filter(h=>h.hintKind==='field_content_profile_hint').length,1);
  assert.deepEqual(reconstructStructureUnits(record,structuredClone(input),rule),[unit]);
  const identity=capabilities.identityClaimResolve.execute({triageIdentityResolutionInput:{unit,inputDigest:d('identity')},procurementTriageRuleSnapshot:rule});
  assert.deepEqual(identity.sourceHints,unit.identityMetadata.sourceHints);
  for (const [field,value] of Object.entries({memberCount:count-1,memberSetDigest:d('wrong-members'),unitDigest:d('wrong-unit'),
    structureInputDigest:d('wrong-input'),triageRuleAuthorityDigest:d('wrong-rule'),procurementRunId:'another-run',pageMaxUnits:1,unitCanonicalBytes:1})) {
    const bad=structuredClone(record);bad.units[0][field]=value;
    assert.throws(()=>reconstructStructureUnits(bad,input,rule),{code:'P7_TRIAGE_UNIT_RECORD_DRIFT'});
  }
  const extra=structuredClone(record);extra.units[0].unknown='forbidden';
  assert.throws(()=>reconstructStructureUnits(extra,input,rule),{code:'P7_TRIAGE_UNIT_RECORD_DRIFT'});
  const missing=structuredClone(input);missing.probeBatches[0].members.pop();
  assert.throws(()=>reconstructStructureUnits(record,missing,rule));
  const sourceDrift=structuredClone(input);sourceDrift.materialFieldContext.memberContexts[0].baseName='Changed.S01E01.mkv';
  assert.throws(()=>reconstructStructureUnits(record,sourceDrift,rule));
  const {createTriageEvidenceIndex}=require('../../src/helix/domains/procurement/persistence/triage-evidence-index');
  const index=createTriageEvidenceIndex({workResultReader:{read:()=>[{eventId:'structure',outcomeKind:'succeeded',
    resultSchemaRef:'helix://contracts/capabilities/procurement.triage.structure.inspect/v1/result',result:record}]},
    structureInputProjection:{project:()=>input},triageRuleRegistry:createDefaultTriageRuleRegistry()});
  assert.deepEqual(index.find('work',unit.unitId).unit,unit);
  assert.equal(index.read('work').materialToUnit.size,count);
  index.clear();assert.deepEqual(index.find('work',unit.unitId).unit,unit);
});

test('Series Structure rejects 1025 members and an over-8-MiB Unit without truncating a Season',()=>{
  const tooMany=movieStructureInput(1025,0,null,'series');
  assert.throws(()=>capabilities.structureInspect.execute({triageStructureInspectionInput:tooMany,procurementTriageRuleSnapshot:rule}),
    {code:'P7_TRIAGE_STRUCTURE_INPUT_BOUNDS'});
  const input=movieStructureInput(1,0,null,'series','X'.repeat(3*1024*1024));
  const result=capabilities.structureInspect.execute({triageStructureInspectionInput:input,procurementTriageRuleSnapshot:rule});
  assert.equal(result.units.length,0);assert.equal(result.unassignedMaterials.length,1);
  assert.equal(result.unassignedMaterials[0].reasonCode,'triage_unit_contract_too_large');
});

test('Series Unit byte ceiling preserves the last fitting title and rejects the next byte step',()=>{
  const inspect=input=>capabilities.structureInspect.execute({triageStructureInspectionInput:input,procurementTriageRuleSnapshot:rule});
  const base=inspect(movieStructureInput(1,0,null,'series','X')).units[0].unitCanonicalBytes;
  // Title appears in displayIdentity, claimedTitle, filename hint, and Related Scope stem.
  const length=1+Math.floor((8*1024*1024-base)/4);
  const input=movieStructureInput(1,0,null,'series','X'.repeat(length));
  const last=inspect(input);assert.equal(last.units.length,1);
  assert.ok(last.units[0].unitCanonicalBytes<=8*1024*1024);
  assert.ok(last.units[0].unitCanonicalBytes>=8*1024*1024-3);
  assert.equal(reconstructStructureUnits(last,input,rule)[0].members.length,1);
  const next=inspect(movieStructureInput(1,0,null,'series','X'.repeat(length+1)));
  assert.equal(next.units.length,0);assert.equal(next.unassignedMaterials[0].reasonCode,'triage_unit_contract_too_large');
});
