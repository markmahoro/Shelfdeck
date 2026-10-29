'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createDefaultTriageRuleRegistry } = require('../../src/helix/domains/procurement/model/procurement-run-contracts');
const { createProcurementCandidateContextReader } = require('../../src/helix/domains/procurement/persistence/procurement-candidate-context-reader');
const { createCandidateManifestInputProjection } = require('../../src/helix/domains/procurement/planning/candidate-assembly-planner');

const D = (label) => canonicalDigest({ label });

function identity(label, inode) {
  const value = {
    schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',
    schemaVersion:2,
    mountScopeId:'mount-1',
    inode:String(inode),
    sizeBytes:100,
    fingerprintAlgorithm:'middle-256k-sha256',
    fingerprintVersion:1,
    contentFingerprint:D(`content:${label}`),
  };
  return { ...value, materialKey:canonicalDigest({ schema:'physical-material-identity@2', ...value }) };
}

function relatedScope(parentRelativeLocation, stemKey, associationMode, relatedRuleRevision = 2, scopeKind = 'ordinary_parent') {
  const value = {
    scopeKind,
    parentRelativeLocation,
    stemKey,
    associationMode,
    observationProjectionRevision:1,
    relatedRuleRevision,
  };
  return { ...value, scopeDigest:canonicalDigest({ schema:'procurement.related-scope@1', ...value }) };
}

function fixture({ primaryLocation, scopeRoot, scopeKind, associationMode, observed, relatedRuleRevision = 2, relatedScopeKind = 'ordinary_parent', relatedParentLocation = null, extraPrimaryLocation = null, contentProfile = null, fieldRoot = '.' }) {
  const primaryIdentity = identity('primary', 1);
  const scopeKey = scopeKind === 'standalone_file'
    ? `standalone-file:${primaryLocation}`
    : `ordinary-directory:${scopeRoot}`;
  const memberSetDigest = canonicalDigest({
    schema:'procurement.selection-scope-members@1',
    items:[{ materialKey:primaryIdentity.materialKey, fieldRelativeLocation:primaryLocation, scopeMemberOrdinal:0 }],
  });
  const scopeValue = {
    scopeOrdinal:0,
    scopeKind,
    scopeKey,
    scopeRootRelativeLocation:scopeRoot,
    memberCount:1,
    memberSetDigest,
  };
  const scope = {
    ...scopeValue,
    scopeDigest:canonicalDigest({
      schema:'procurement.selection-scope@1',
      scopeKind,
      scopeKey,
      scopeRootRelativeLocation:scopeRoot,
      memberCount:1,
      memberSetDigest,
    }),
  };
  const scopeSetDigest = canonicalDigest({ schema:'procurement.selection-scope-set@1', scopes:[scope] });
  const controlEvidence = D('control-evidence');
  const controlValue = {
    materialKey:primaryIdentity.materialKey,
    resultKind:'available',
    controlRevision:0,
    controlState:'uncontrolled',
    regionProjection:'uncontrolled',
    evidenceDigest:controlEvidence,
  };
  const controlProjectionDigest = canonicalDigest(controlValue);
  const member = {
    procurement_run_id:'run-1',
    ordinal:0,
    material_key:primaryIdentity.materialKey,
    selection_role:'triage_input',
    field_relative_location:primaryLocation,
    selection_scope_kind:scopeKind,
    selection_scope_key:scopeKey,
    selection_scope_root_relative_location:scopeRoot,
    selection_scope_ordinal:0,
    scope_member_ordinal:0,
    selection_scope_member_count:1,
    selection_scope_member_set_digest:memberSetDigest,
    selection_scope_digest:scope.scopeDigest,
    mount_scope_id:primaryIdentity.mountScopeId,
    inode:primaryIdentity.inode,
    size_bytes:primaryIdentity.sizeBytes,
    fingerprint_algorithm:primaryIdentity.fingerprintAlgorithm,
    fingerprint_version:primaryIdentity.fingerprintVersion,
    content_fingerprint:primaryIdentity.contentFingerprint,
    binding_revision:1,
    eligibility_revision:1,
    eligibility_basis_digest:D('eligibility'),
    last_snapshot_digest:D('snapshot'),
    last_observation_id:'observation-1',
    endpoint_id:'endpoint-1',
    location:primaryLocation,
    reality_digest:D('reality'),
    provenance_digest:D('provenance'),
    expected_control_revision:0,
    expected_control_state:'uncontrolled',
    expected_control_owner_domain:null,
    expected_control_owner_scope_type:null,
    expected_control_owner_scope_id:null,
    expected_control_region_projection:'uncontrolled',
    expected_control_evidence_digest:controlEvidence,
    expected_control_projection_digest:controlProjectionDigest,
    admission_control_action:'acquire',
    admitted_control_revision:1,
    admitted_control_projection_digest:D('admitted-control'),
    basis_member_digest:D('basis-member'),
  };
  const run = {
    procurement_run_id:'run-1',
    field_id:'field-1',
    access_revision:1,
    selected_material_count:1,
    selection_scope_count:1,
    selection_scope_set_digest:scopeSetDigest,
    run_basis_digest:D('run-basis'),
  };
  const access = { root_location:fieldRoot };
  const materialContext = { member, identity:primaryIdentity, current:null };
  const queriedScopes = [];
  const scopeValueForUnit = relatedScope(
    relatedParentLocation || (primaryLocation.includes('/') ? primaryLocation.slice(0, primaryLocation.lastIndexOf('/')) : '.'),
    primaryLocation.split('/').at(-1).replace(/\.[^.]+$/, '').toLocaleLowerCase('en-US'),
    associationMode,
    relatedRuleRevision,
    relatedScopeKind,
  );
  const entry = {
    unit:{
      unitId:'unit-1',
      ...(contentProfile ? { contentProfile } : {}),
      relatedScope:scopeValueForUnit,
      members:[{
        materialKey:primaryIdentity.materialKey,
        bindingRevision:1,
        admittedControlRevision:1,
        admittedControlProjectionDigest:member.admitted_control_projection_digest,
        role:'primary_payload',
        episodeClaims:[],
      }],
    },
    structure:{ evidenceId:'structure-1' },
    ordinal:0,
    evidenceId:'structure-1',
    payloadDigest:D('structure-payload'),
  };
  const allMembers=[member],allContexts=[materialContext];
  if(extraPrimaryLocation){const secondIdentity=identity('second-primary',20),second={...member,material_key:secondIdentity.materialKey,
    inode:secondIdentity.inode,content_fingerprint:secondIdentity.contentFingerprint,field_relative_location:extraPrimaryLocation};
    allMembers.push(second);allContexts.push({member:second,identity:secondIdentity,current:null});
    entry.unit.members.push({...entry.unit.members[0],materialKey:secondIdentity.materialKey});
  }
  const reader = createProcurementCandidateContextReader({
    triageRuleRegistry:createDefaultTriageRuleRegistry(),
    evidenceIndex:{ find:() => entry },
    triageReader:{
      readRunBasis:() => ({ run, access, selectionScopes:[scope], members:allMembers }),
      readCandidate:() => ({
        run,
        access,
        selectionScopes:[scope],
        materials:allContexts,
        candidateMaterials:allContexts,
      }),
      listObservedMaterialsInScope(runId, requestedScope) {
        queriedScopes.push([runId, requestedScope]);
        return observed;
      },
    },
  });
  return {
    context:reader.read({
      runId:'run-1',
      evidenceWorkId:'evidence-work-1',
      unitId:'unit-1',
      workId:'candidate-work-1',
      executionBasisDigest:run.run_basis_digest,
    }),
    queriedScopes,
  };
}

function observed(location, label, inode) {
  const value = identity(label, inode);
  return {
    identity:value,
    relativeLocation:location,
    location,
    endpointId:'endpoint-1',
    entryDigest:D(`entry:${label}`),
  };
}

test('merged Candidate parent scope resolves physical directories and carries Episode thumb and NFO', () => {
  const stem='Show S01E01 - HEVC';
  const value=fixture({primaryLocation:'Show/Season 1/'+stem+'.mkv',scopeRoot:'Show/Season 1',
    scopeKind:'ordinary_directory',associationMode:'multi_movie_directory',relatedParentLocation:'@candidate',
    observed:[observed('Show/Season 1/'+stem+'-thumb.jpg','thumb',2),observed('Show/Season 1/'+stem+'.nfo','nfo',3),
      observed('Other/Season 1/'+stem+'-thumb.jpg','foreign',4)]});
  assert.deepEqual(value.queriedScopes,[['run-1','Show/Season 1']]);
  assert.deepEqual(value.context.relatedReferences.map(item=>item.role).sort(),['nfo','sidecar']);
});
test('Series Season display files become exclusive related references anchored to one Primary',()=>{
  const value=fixture({primaryLocation:'Show/Season 1/Show S01E01.mkv',extraPrimaryLocation:'Show/Season 1/Show S01E02.mkv',
    scopeRoot:'Show/Season 1',scopeKind:'ordinary_directory',associationMode:'multi_movie_directory',relatedParentLocation:'@candidate',
    contentProfile:'series',relatedRuleRevision:3,observed:[observed('Show/Season 1/poster.jpg','season-poster',2),
      observed('Show/Season 1/season.nfo','season-nfo',3),observed('Show/Season 1/fanart.png','season-fanart',4),
      observed('Show/Season 1/ignore.txt','season-ignore',5)]});
  const references=value.context.relatedReferences;
  assert.deepEqual(references.map(item=>item.role).sort(),['fanart','nfo','poster']);
  assert.equal(new Set(references.map(item=>item.primaryMaterialKey)).size,1);
  assert.equal(references.some(item=>item.location.endsWith('ignore.txt')),false);
  assert.equal(references.every(item=>item.associationKind==='exclusive'&&item.dispositionRequired===true),true);
});
test('Episode sidecars bind their matching Primary rather than the first file in the Season',()=>{
  const result=fixture({primaryLocation:'Show/Season 1/Show.S01E01.mkv',extraPrimaryLocation:'Show/Season 1/Show.S01E02.mkv',
    scopeRoot:'Show/Season 1',scopeKind:'ordinary_directory',associationMode:'multi_movie_directory',relatedParentLocation:'@candidate',
    observed:[observed('Show/Season 1/Show.S01E01-thumb.jpg','one',2),observed('Show/Season 1/Show.S01E02-thumb.jpg','two',3),
      observed('Show/Season 1/Show.S01E02.nfo','nfo-two',4),observed('Show/Season 1/unrelated-thumb.jpg','unknown',5)]});
  assert.equal(result.context.relatedReferences.length,3);
  for(const reference of result.context.relatedReferences)assert.equal(reference.primaryMaterialKey,
    identity(reference.location.includes('S01E02')?'second-primary':'primary',reference.location.includes('S01E02')?20:1).materialKey);
});

test('Candidate Context preserves artwork roles for movie-prefixed files without borrowing other movies', () => {
  const stem = '局内人 (2006) 1080p DTS';
  const names = [
    [`${stem}-poster.jpg`, 'poster'],
    [`${stem}.POSTER.PNG`, 'poster'],
    [`${stem}_poster.webp`, 'poster'],
    [`${stem}-fanart.jpg`, 'fanart'],
    [`${stem}.background.jpeg`, 'fanart'],
    [`${stem}_backdrop.png`, 'fanart'],
    [`${stem}-clearlogo.png`, 'sidecar'],
    [`${stem}-poster.txt`, 'sidecar'],
    [`${stem}-poster-extra.jpg`, 'sidecar'],
    [`${stem}-sample-poster.jpg`, 'sidecar'],
  ];
  for (const associationMode of ['single_movie_directory', 'multi_movie_directory', 'standalone_same_stem']) {
    const result = fixture({
      primaryLocation:`Movies/${stem}.mkv`, scopeRoot:'Movies',
      scopeKind:'ordinary_directory', associationMode,
      observed:[...names.map(([name], index) => observed(`Movies/${name}`, name, index + 2)),
        observed('Movies/Other-poster.jpg', 'other-poster', 30),
        observed(`Elsewhere/${stem}-poster.jpg`, 'different-directory', 31),
        observed('Movies/poster.jpg', 'generic-poster', 32)],
    });
    const expected = names.map(([name, role]) => [`Movies/${name}`, role]);
    if (associationMode === 'single_movie_directory') expected.push(['Movies/poster.jpg', 'poster']);
    assert.deepEqual(result.context.relatedReferences.map((item) => [item.location, item.role])
      .sort((a, b) => a[0].localeCompare(b[0])), expected.sort((a, b) => a[0].localeCompare(b[0])));
    for (const reference of result.context.relatedReferences) {
      const { referenceDigest, ...body } = reference;
      assert.equal(referenceDigest, canonicalDigest(body));
    }
  }
});

test('Candidate Context applies bounded Related rules for standalone, single-film and multi-film scopes', () => {
  const standalone = fixture({
    primaryLocation:'苹果.mkv',
    scopeRoot:'苹果.mkv',
    scopeKind:'standalone_file',
    associationMode:'standalone_same_stem',
    observed:[
      observed('苹果.chinese.srt', 'apple-subtitle', 2),
      observed('poster.jpg', 'root-poster', 3),
      observed('Other.srt', 'other-subtitle', 4),
      observed('Thumbs.db', 'standalone-windows-thumbnails', 25),
    ],
  });
  assert.deepEqual(standalone.queriedScopes, [['run-1', '.']]);
  assert.deepEqual(standalone.context.relatedReferences.map((item) => item.location), ['苹果.chinese.srt']);

  const single = fixture({
    primaryLocation:'One Movie/Feature.mkv',
    scopeRoot:'One Movie',
    scopeKind:'ordinary_directory',
    associationMode:'single_movie_directory',
    observed:[
      observed('One Movie/Feature.zh.srt', 'feature-subtitle', 5),
      observed('One Movie/movie.nfo', 'movie-nfo', 6),
      observed('One Movie/poster.jpg', 'movie-poster', 7),
      observed('One Movie/Other.srt', 'other-in-directory', 8),
      observed('One Movie/clearlogo.png', 'movie-clearlogo', 12),
      observed('One Movie/banner.jpg', 'movie-banner', 13),
      observed('One Movie/landscape.jpg', 'movie-landscape', 14),
      observed('One Movie/Feature-fanart.jpg', 'feature-fanart', 15),
      observed('One Movie/fanart.jpg', 'generic-fanart', 16),
      observed('One Movie/Thumbs.db', 'windows-thumbnails', 17),
      observed('One Movie/cache.db', 'unrecognized-database', 18),
    ],
  });
  assert.deepEqual(single.queriedScopes, [['run-1', 'One Movie']]);
  assert.deepEqual(single.context.relatedReferences.map((item) => item.location).sort(), [
    'One Movie/Feature-fanart.jpg',
    'One Movie/Feature.zh.srt',
    'One Movie/Thumbs.db',
    'One Movie/banner.jpg',
    'One Movie/clearlogo.png',
    'One Movie/fanart.jpg',
    'One Movie/landscape.jpg',
    'One Movie/movie.nfo',
    'One Movie/poster.jpg',
  ]);
  assert.equal(single.context.relatedReferences.find((item) => item.location.endsWith('fanart.jpg') && !item.location.includes('Feature')).role, 'fanart');
  assert.equal(single.context.relatedReferences.find((item) => item.location.endsWith('Feature-fanart.jpg')).role, 'fanart');
  assert.equal(single.context.relatedReferences.find((item) => item.location.endsWith('Thumbs.db')).role, 'sidecar');

  const multi = fixture({
    primaryLocation:'Mixed/First.mkv',
    scopeRoot:'Mixed',
    scopeKind:'ordinary_directory',
    associationMode:'multi_movie_directory',
    observed:[
      observed('Mixed/First.zh.srt', 'first-subtitle', 9),
      observed('Mixed/poster.jpg', 'generic-poster', 10),
      observed('Mixed/Second.nfo', 'second-nfo', 11),
      observed('Mixed/Thumbs.db', 'shared-windows-thumbnails', 19),
    ],
  });
  assert.deepEqual(multi.queriedScopes, [['run-1', 'Mixed']]);
  assert.deepEqual(multi.context.relatedReferences.map((item) => item.location), ['Mixed/First.zh.srt']);
});

test('Manifest projection carries only the current Candidate members even when its Run has 1024 selected Materials', () => {
  const value = fixture({
    primaryLocation:'苹果.mkv',
    scopeRoot:'苹果.mkv',
    scopeKind:'standalone_file',
    associationMode:'standalone_same_stem',
    observed:[observed('苹果.nfo', 'apple-nfo', 20)],
  }).context;
  const context = Object.freeze({ ...value, snapshot:Object.freeze({ ...value.snapshot,
    run:Object.freeze({ ...value.snapshot.run, selected_material_count:1024, selection_scope_count:1024 }) }) });
  const projection=createCandidateManifestInputProjection({
    triageReader:{readRunHeader:()=>context.snapshot.run},
    candidateContextReader:{read:()=>context},
  });
  const input=projection.project({ownerScope:{processId:'run-1'},parameters:{unitId:'unit-1',workId:'candidate-work-1'}});
  assert.equal(Object.hasOwn(input,'selectedFieldMaterialSet'),false);
  assert.equal(input.candidateMembers.length,1);
  assert.equal(input.candidateMembers[0].materialKey,context.candidateMembers[0].materialKey);
  assert.ok(Buffer.byteLength(JSON.stringify(input))<16*1024);
});

test('UAT-138 Related rule revision 2 adds only exact Thumbs.db in a single Movie directory', () => {
  const observedMaterials = [
    observed('One Movie/Thumbs.db', 'windows-thumbnails', 21),
    observed('One Movie/THUMBS.DB', 'uppercase-windows-thumbnails', 22),
    observed('One Movie/cache.db', 'unrecognized-database', 23),
    observed('One Movie/Other.srt', 'unrelated-subtitle', 24),
  ];
  const historical = fixture({
    primaryLocation:'One Movie/Feature.mkv',
    scopeRoot:'One Movie',
    scopeKind:'ordinary_directory',
    associationMode:'single_movie_directory',
    relatedRuleRevision:1,
    observed:observedMaterials,
  });
  assert.deepEqual(historical.context.relatedReferences, []);

  const current = fixture({
    primaryLocation:'One Movie/Feature.mkv',
    scopeRoot:'One Movie',
    scopeKind:'ordinary_directory',
    associationMode:'single_movie_directory',
    relatedRuleRevision:2,
    observed:observedMaterials,
  });
  assert.deepEqual(
    current.context.relatedReferences.map((item) => [item.location, item.role]).sort(),
    [
      ['One Movie/THUMBS.DB', 'sidecar'],
      ['One Movie/Thumbs.db', 'sidecar'],
    ],
  );
  assert.ok(current.context.relatedReferences.every((item) => item.dispositionRequired === true));
});

test('UAT-138 Related rule revision 2 includes Thumbs.db only from a BDMV external parent', () => {
  const current = fixture({
    primaryLocation:'Disc/BDMV/STREAM/00001.m2ts',
    scopeRoot:'Disc/BDMV',
    scopeKind:'ordinary_directory',
    associationMode:'bdmv_external',
    relatedRuleRevision:2,
    relatedScopeKind:'bdmv_external_parent',
    relatedParentLocation:'Disc',
    observed:[
      observed('Disc/Thumbs.db', 'external-windows-thumbnails', 26),
      observed('Disc/BDMV/Thumbs.db', 'internal-windows-thumbnails', 27),
      observed('Disc/cache.db', 'external-unrecognized-database', 28),
    ],
  });
  assert.deepEqual(
    current.context.relatedReferences.map((item) => [item.location, item.role]),
    [['Disc/Thumbs.db', 'sidecar']],
  );
});

for (const showRelativeRoot of ['Shows/走向共和 (2003)', '.']) test('Series candidate preserves absolute source root through real local NFO qualification: '+showRelativeRoot,()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const {readBoundedFileSnapshotSync}=require('../../src/helix/integrations/bounded-material-fingerprint');
  const {physicalIdentity}=require('../../src/helix/integrations/series-presentation-io');
  const {qualifyReferences,readQualified}=require('../../src/helix/integrations/series-local-source-io');
  const {buildReferenceSet}=require('../../src/helix/contracts/series-local-source');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'series-candidate-root-')),show=path.join(root,showRelativeRoot);
  try {
    fs.mkdirSync(show,{recursive:true});const location=path.join(show,'tvshow.nfo');
    const bytes=Buffer.from('<tvshow><title>Show</title><season>-1</season><episode>-1</episode><uniqueid type="tmdb">1399</uniqueid></tvshow>');
    fs.writeFileSync(location,bytes);
    const reference={...observed(path.posix.join(showRelativeRoot,'tvshow.nfo'),'nfo',2),location,
      identity:physicalIdentity(readBoundedFileSnapshotSync(location,256*1024,{requireStableSnapshot:true}),'mount-1')};
    const season=path.posix.join(showRelativeRoot,'Season 01');
    const {context}=fixture({primaryLocation:season+'/Show.S01E01.mkv',scopeRoot:season,scopeKind:'ordinary_directory',
      associationMode:'multi_movie_directory',contentProfile:'series',fieldRoot:root,observed:[reference]});
    const set=context.seriesPresentationSourceRefs;
    assert.equal(set.fieldRoot,root);assert.equal(set.sourceRoot,show);assert.ok(path.isAbsolute(set.sourceRoot));
    assert.deepEqual(readQualified(qualifyReferences(set,'1399'),'nfo').bytes,bytes);
    const {sourceSetDigest,...body}=set;
    assert.throws(()=>qualifyReferences(buildReferenceSet({...body,sourceRoot:path.relative(root,show)||'.'}),'1399'),{code:'SERIES_LOCAL_SOURCE_SCOPE_INVALID'});
    assert.deepEqual(fs.readFileSync(location),bytes);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
