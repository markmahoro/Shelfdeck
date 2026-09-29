'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createCleanProductProductionPort, parseRelatedNfoMovieIdentity } = require('../../src/clean-product-production-port');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { computeBoundedMaterialFingerprintSync } =
  require('../../src/helix/integrations/bounded-material-fingerprint');

function draft(entries = [
  Object.freeze({ key:'title', value:'倩女幽魂' }),
  Object.freeze({ key:'tmdb_movie_id', value:'12345' }),
  Object.freeze({ key:'year_or_release_date', value:1987 }),
  Object.freeze({ key:'plot', value:'更新后的简介' }),
]) {
  return Object.freeze({
    draftId:'draft-1',
    draftDigest:'d'.repeat(64),
    basisDigest:'b'.repeat(64),
    metadataObservationSetDigest:'c'.repeat(64),
    descriptiveFacts:Object.freeze({ entries:Object.freeze(entries) }),
  });
}

function mediaCastDraft() {
  const relations = Object.freeze([
    Object.freeze({ role:'actor', displayName:'张国荣', providerIdentities:Object.freeze([
      Object.freeze({ provider:'tmdb', namespace:'tmdb_person', providerKey:'123' }),
    ]) }),
    Object.freeze({ role:'actor', displayName:'王祖贤', providerIdentities:Object.freeze([
      Object.freeze({ provider:'tmdb', namespace:'tmdb_person', providerKey:'124' }),
    ]) }),
  ]);
  const body = {
    schemaRef:'helix://contracts/types/MediaCastDraft/v1', schemaVersion:1,
    draftId:'cast-draft-1', draftKind:'media_cast', basisDigest:'b'.repeat(64),
    producedAtMs:1, subjectId:'subject-1', sourceBasisKind:'metadata_observation',
    metadataObservationSetDigest:'c'.repeat(64), westernMatchBasisDigest:null,
    relations,
  };
  return Object.freeze({ ...body, draftDigest:canonicalDigest(body) });
}

function profile() {
  const body = {
    schemaRef:'helix://contracts/domain-types/SidecarProfile/v1',
    schemaVersion:1,
    profileId:'movie-nfo',
    revision:1,
    format:'nfo_xml',
    fileNamePolicyDigest:'f'.repeat(64),
    contentSchemaRef:'helix://contracts/records/descriptive-facts/v1',
    typedParameters:Object.freeze([]),
  };
  return Object.freeze({ ...body, digest:canonicalDigest(body) });
}

function relatedReference(location, primaryMaterialKey = 'primary-1') {
  const bounded = computeBoundedMaterialFingerprintSync(location);
  const identityBasis = {
    mountScopeId:'test-volume',
    inode:String(bounded.stat.ino),
    sizeBytes:Number(bounded.stat.size),
    fingerprintAlgorithm:bounded.fingerprintAlgorithm,
    fingerprintVersion:bounded.fingerprintVersion,
    contentFingerprint:bounded.contentFingerprint,
  };
  const identity = Object.freeze({
    ...identityBasis,
    materialKey:canonicalDigest({ schema:'physical-material-identity@2', ...identityBasis }),
  });
  return Object.freeze({
    referenceId:'nfo-reference-1',
    referenceDigest:'a'.repeat(64),
    primaryMaterialKey,
    role:'nfo',
    location:location.replace(/\\/g, '/'),
    identity,
  });
}

function render(sourceBytes, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-sidecar-update-'));
  const source = path.join(root, 'movie.nfo');
  if (sourceBytes !== null) fs.writeFileSync(source, sourceBytes);
  let write = null;
  const workspaceProductPort = {
    materializeArtifact(request) {
      write = request;
      return Object.freeze({ artifactHandle:Object.freeze({
        schemaRef:'helix://contracts/types/ArtifactHandle/v1', schemaVersion:1,
        artifactHandleId:'artifact-nfo-1', artifactKind:'nfo', ownerDomain:'libra',
        ownerScope:Object.freeze({ scopeType:'libra_run', scopeId:'run-1' }),
        storageRef:'workspace://movie.nfo', digestAlgorithm:'sha256',
        digestHex:crypto.createHash('sha256').update(request.bytes).digest('hex'), sizeBytes:request.bytes.length,
        mediaType:'application/xml', provenanceRef:request.provenanceRef, referenceRevision:1,
      }) });
    },
    acquireArtifact() { throw new Error('not used'); },
  };
  const port = createCleanProductProductionPort({
    mediaProbe:{ probe() { throw new Error('not used'); } },
    workspaceProductPort,
  });
  try {
    const reference = sourceBytes === null ? null : relatedReference(source);
    const before = sourceBytes === null ? null : fs.readFileSync(source);
    const handle = port.renderProductSidecar({
      productMetadataDraft:overrides.productMetadataDraft || draft(),
      mediaCastDraft:overrides.mediaCastDraft || mediaCastDraft(),
      sidecarProfile:overrides.sidecarProfile || profile(), libraRunId:'run-1',
      workspaceId:'workspace-1', relativePath:overrides.relativePath || 'product/movie.nfo',
      contentProfile:overrides.contentProfile || 'movie',
      relatedReference:reference,
    });
    return { handle, output:write.bytes.toString('utf8'), before,
      after:sourceBytes === null ? null : fs.readFileSync(source) };
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
}

function episodeProfile(parameters) {
  const { digest:_digest, ...body } = profile();
  const values = parameters || [
    { parameter:'episodeNumber', valueType:'integer', value:2 },
    { parameter:'rootElement', valueType:'string', value:'episodedetails' },
    { parameter:'seasonNumber', valueType:'integer', value:1 },
  ];
  body.profileId = 'series-episode-nfo';
  body.typedParameters = values.map((item) => ({ ...item, valueDigest:canonicalDigest(item) }));
  return { ...body, digest:canonicalDigest(body) };
}

function episodeDraft(overrides = {}) {
  return draft(Object.entries({ series_title:'Demo & Show', tmdb_series_id:'1399',
    season_number:1, episode_number:2, episode_title:'Episode <Two>', episode_plot:'Episode & plot',
    plot:'Whole Series plot', ...overrides }).map(([key,value]) => ({ key, value })));
}

function renderEpisode(source, overrides = {}) {
  return render(source, { contentProfile:'series', relativePath:'product/S01E02.nfo',
    sidecarProfile:episodeProfile(), productMetadataDraft:episodeDraft(), ...overrides });
}

test('Episode Sidecar uses scoped title/plot and never labels Series TMDB identity as Episode identity', () => {
  const result = renderEpisode(null);
  assert.match(result.output, /^<episodedetails>/);
  assert.match(result.output, /<title>Episode &lt;Two&gt;<\/title>/);
  assert.match(result.output, /<showtitle>Demo &amp; Show<\/showtitle>/);
  assert.match(result.output, /<season>1<\/season>/);
  assert.match(result.output, /<episode>2<\/episode>/);
  assert.match(result.output, /<plot>Episode &amp; plot<\/plot>/);
  assert.doesNotMatch(result.output, /Whole Series plot|<tvshow>|<uniqueid|<tmdbid>1399/);
  assert.equal(result.handle.provenanceRef.objectType, 'product_metadata_draft_create');
});

test('Episode Related NFO preserves unmanaged fields, updates direct fields, and leaves the source untouched', () => {
  const source = '<episodedetails><title>Old</title><showtitle>Demo &amp; Show</showtitle>' +
    '<season>1</season><episode>2</episode><plot>Old plot</plot><watched>true</watched></episodedetails>';
  const result = renderEpisode(source);
  assert.equal(result.handle.provenanceRef.objectType, 'related_nfo_update');
  assert.match(result.output, /<watched>true<\/watched>/);
  assert.match(result.output, /<title>Episode &lt;Two&gt;<\/title>/);
  assert.match(result.output, /<plot>Episode &amp; plot<\/plot>/);
  assert.deepEqual(result.after, result.before);
});

for (const [label, source] of [
  ['wrong Season', '<episodedetails><season>2</season><episode>2</episode><note>foreign</note></episodedetails>'],
  ['wrong Episode', '<episodedetails><season>1</season><episode>3</episode><note>foreign</note></episodedetails>'],
  ['wrong Series', '<episodedetails><showtitle>Another Show</showtitle><season>1</season><episode>2</episode><note>foreign</note></episodedetails>'],
  ['no Episode scope', '<episodedetails><title>Unknown</title><note>foreign</note></episodedetails>'],
  ['Season root', '<tvshow><title>Demo</title><note>foreign</note></tvshow>'],
]) {
  test(`Episode NFO rebuilds ${label} without borrowing unrelated fields or changing its source`, () => {
    const result = renderEpisode(source);
    assert.equal(result.handle.provenanceRef.objectType, 'product_metadata_draft_rebuild');
    assert.doesNotMatch(result.output, /foreign/);
    assert.match(result.output, /<episode>2<\/episode>/);
    assert.deepEqual(result.after, result.before);
  });
}

for (const [label, fields] of [
  ['wrong Episode', { episode_number:3 }], ['wrong Season', { season_number:2 }],
  ['missing Episode title', { episode_title:'' }], ['missing Episode plot', { episode_plot:' ' }],
  ['missing Series title', { series_title:'' }], ['boolean Episode number', { episode_number:true }],
]) {
  test(`Episode Sidecar rejects ${label} rather than writing an incomplete Artifact`, () => {
    assert.throws(() => renderEpisode(null, { productMetadataDraft:episodeDraft(fields) }),
      { code:'CLEAN_PRODUCT_SIDECAR_INPUT_INVALID' });
  });
}

test('Episode Sidecar accepts source NFO integer strings against the frozen numeric scope', () => {
  assert.match(renderEpisode(null, { productMetadataDraft:episodeDraft({ season_number:'01', episode_number:'002' }) }).output,
    /<episode>002<\/episode>/);
});

for (const [label, parameters] of [
  ['missing root', [{ parameter:'episodeNumber', valueType:'integer', value:2 }]],
  ['missing scope', [{ parameter:'rootElement', valueType:'string', value:'episodedetails' }]],
  ['unknown root', [
    { parameter:'episodeNumber', valueType:'integer', value:2 },
    { parameter:'rootElement', valueType:'string', value:'unknown' },
    { parameter:'seasonNumber', valueType:'integer', value:1 },
  ]],
]) {
  test(`Episode Sidecar rejects ${label} in its frozen Profile`, () => {
    assert.throws(() => renderEpisode(null, { sidecarProfile:episodeProfile(parameters) }),
      { code:'CLEAN_PRODUCT_SIDECAR_INPUT_INVALID' });
  });
}

test('Episode Sidecar checks parameter digests independently of the outer Profile digest', () => {
  const { digest:_digest, ...body } = episodeProfile();
  body.typedParameters[0].valueDigest = '0'.repeat(64);
  assert.throws(() => renderEpisode(null, { sidecarProfile:{ ...body, digest:canonicalDigest(body) } }),
    { code:'CLEAN_PRODUCT_SIDECAR_INPUT_INVALID' });
});

test('Movie cannot execute an Episode Sidecar Profile', () => {
  assert.throws(() => renderEpisode(null, { contentProfile:'movie' }),
    { code:'CLEAN_PRODUCT_SIDECAR_INPUT_INVALID' });
});

test('movie identity ignores actor tmdb ids and reads only the root-level movie identity', () => {
  const identity = parseRelatedNfoMovieIdentity(`<movie>
    <title>007：大破天幕杀机</title><year>2012</year>
    <actor><name>Daniel Craig</name><tmdbid>8784</tmdbid></actor>
    <uniqueid type="tmdb">37724</uniqueid>
  </movie>`);
  assert.deepEqual(identity, { title:'007：大破天幕杀机', releaseYear:'2012', tmdbMovieId:'37724' });
});

test('source NFO title reads escaped XML and CDATA as identical literal facts', () => {
  const escaped = parseRelatedNfoMovieIdentity('<movie><title>A &amp; B &lt;C&gt;</title></movie>');
  const cdata = parseRelatedNfoMovieIdentity('<movie><title><![CDATA[A & B <C>]]></title></movie>');
  assert.equal(escaped.title, 'A & B <C>');
  assert.deepEqual(cdata, escaped);
});

test('Libra renderer restores an accepted actor instead of accepting a same-name different person', () => {
  const result = render('<movie><title>倩女幽魂</title><tmdbid>12345</tmdbid>' +
    '<actor><name>张国荣</name><tmdbid>999</tmdbid></actor></movie>');
  assert.match(result.output, /<tmdbid>123<\/tmdbid>/);
  assert.match(result.output, /<tmdbid>999<\/tmdbid>/);
});

test('Related NFO observation consumes the same bounded snapshot whose identity it verifies', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-nfo-snapshot-'));
  const source = path.join(root, 'movie.nfo');
  fs.writeFileSync(source, '<movie><title>A &amp; B</title></movie>');
  const reference = relatedReference(source);
  const originalReadFile = fs.readFileSync;
  try {
    const port = createCleanProductProductionPort({mediaProbe:{probe(){}},
      workspaceProductPort:{materializeArtifact(){},acquireArtifact(){}}});
    fs.readFileSync = function(location, ...args) {
      if (location === source) throw new Error('NFO must not be reopened after its identity was verified.');
      return originalReadFile.call(fs, location, ...args);
    };
    const result = port.readRelatedNfo({primaryMaterialKey:'primary-1',reference});
    assert.equal(result.entries.find((item) => item.key === 'title').value, 'A & B');
  } finally {
    fs.readFileSync = originalReadFile;
    fs.rmSync(root, {recursive:true,force:true});
  }
});

test('related NFO observation preserves the complete repeated genre set', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-sidecar-genres-'));
  const source = path.join(root, 'movie.nfo');
  fs.writeFileSync(source, Buffer.from(
    '<movie><title>人生密密缝</title><genre>Family</genre><genre>Drama</genre><tmdbid>428733</tmdbid></movie>',
    'utf8'));
  try {
    const port = createCleanProductProductionPort({
      mediaProbe:{ probe() { throw new Error('not used'); } },
      workspaceProductPort:{
        materializeArtifact() { throw new Error('not used'); },
        acquireArtifact() { throw new Error('not used'); },
      },
    });
    const observed = port.readRelatedNfo({
      primaryMaterialKey:'primary-1',
      reference:relatedReference(source),
    });
    assert.equal(observed.entries.find((item) => item.key === 'genre')?.value,
      'Family / Drama');
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('Shelf Acceptance read Handle closes Package, Spec, role, and 24-hour reality', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-shelf-acceptance-read-'));
  const location = path.join(root, 'movie.mkv');
  fs.writeFileSync(location, Buffer.from('bounded movie bytes'));
  try {
    const bounded = computeBoundedMaterialFingerprintSync(location);
    const identityBasis = {
      mountScopeId:'workspace-mount', inode:String(bounded.stat.ino),
      sizeBytes:Number(bounded.stat.size),
      fingerprintAlgorithm:bounded.fingerprintAlgorithm,
      fingerprintVersion:bounded.fingerprintVersion,
      contentFingerprint:bounded.contentFingerprint,
    };
    const physicalIdentity = {
      ...identityBasis,
      materialKey:canonicalDigest({ schema:'physical-material-identity@2', ...identityBasis }),
    };
    const port = createCleanProductProductionPort({
      mediaProbe:{ probe() { throw new Error('not used'); } },
      workspaceProductPort:{
        materializeArtifact() { throw new Error('not used'); },
        acquireArtifact() { throw new Error('not used'); },
      },
    });
    const handle = port.issueShelfAcceptanceReadHandle({
      libraRunId:'run-1', runExecutionBasisDigest:'a'.repeat(64),
      onDeckPackageId:'package-1', acceptanceSpecId:'spec-1',
      acceptanceSpecRecordDigest:'b'.repeat(64),
      productMemberDigest:'c'.repeat(64), readRole:'product_primary',
      physicalIdentity, sizeBytes:physicalIdentity.sizeBytes,
      endpointId:'workspace-endpoint', location, bindingRevision:1,
      mountScopeRevision:1, issuedAtMs:1_700_000_000_000,
      expiresAtMs:1_700_086_400_000,
    });
    assert.deepEqual(handle.ownerScope,
      { scopeType:'on_deck_package', scopeId:'package-1' });
    assert.equal(handle.readScope, 'shelf_acceptance_primary_probe_decode');
    assert.equal(handle.expiresAtMs - handle.fingerprintVerifiedAtMs, 86_400_000);
    assert.match(handle.fenceDigest, /^[a-f0-9]{64}$/);
    assert.throws(() => port.issueShelfAcceptanceReadHandle({
      libraRunId:'run-1', runExecutionBasisDigest:'a'.repeat(64),
      onDeckPackageId:'package-1', acceptanceSpecId:'spec-1',
      acceptanceSpecRecordDigest:'b'.repeat(64),
      productMemberDigest:'c'.repeat(64), readRole:'product_primary',
      physicalIdentity, sizeBytes:physicalIdentity.sizeBytes,
      endpointId:'workspace-endpoint', location, bindingRevision:1,
      mountScopeRevision:1, issuedAtMs:1_700_000_000_000,
      expiresAtMs:1_700_086_400_001,
    }), /24-hour Package fence/);
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('usable related NFO is updated without losing rich or custom fields', () => {
  const source = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<movie>
  <title>旧标题</title>
  <tmdbid>12345</tmdbid>
  <uniqueid type="imdb">tt0012345</uniqueid>
  <uniqueid type="tmdb" default="true">12345</uniqueid>
  <ratings><rating name="douban"><value>8.8</value></rating></ratings>
  <actor><name>张国荣</name><tmdbid>123</tmdbid></actor>
  <set><name>自定义合集</name></set>
  <tag>私人标签</tag>
  <customfield keep="yes">自定义内容</customfield>
</movie>
`, 'utf8');
  const result = render(source);
  assert.equal(result.handle.provenanceRef.objectType, 'related_nfo_update');
  assert.deepEqual(result.after, result.before, 'the Material Field source must remain read-only');
  assert.match(result.output, /<title>倩女幽魂<\/title>/);
  assert.match(result.output, /<tmdbid>12345<\/tmdbid>/);
  assert.match(result.output, /<uniqueid type="tmdb" default="true">12345<\/uniqueid>/);
  for (const preserved of ['tt0012345', 'douban', '张国荣', '自定义合集', '私人标签', '自定义内容']) {
    assert.ok(result.output.includes(preserved), 'preserves ' + preserved);
  }
  assert.equal((result.output.match(/<name>张国荣<\/name>/g) || []).length, 1,
    'the strong existing actor is not duplicated');
  assert.match(result.output, /<name>王祖贤<\/name>[\s\S]*?<tmdbid>124<\/tmdbid>/);
});

test('related NFO update canonicalizes repeated root genres without overwriting nested actor ids', () => {
  const source = Buffer.from(`<movie>
  <title>旧标题</title>
  <genre>Family</genre>
  <genre>Drama</genre>
  <actor><name>Toma Ikuta</name><tmdbid>228072</tmdbid></actor>
  <tmdbid>428733</tmdbid>
  <uniqueid type="tmdb">428733</uniqueid>
</movie>\n`, 'utf8');
  const productMetadataDraft = draft([
    Object.freeze({ key:'title', value:'人生密密缝' }),
    Object.freeze({ key:'tmdb_movie_id', value:'428733' }),
    Object.freeze({ key:'year_or_release_date', value:2017 }),
    Object.freeze({ key:'plot', value:'Plot' }),
    Object.freeze({ key:'genre', value:'Family / Drama' }),
  ]);
  const result = render(source, { productMetadataDraft });
  assert.equal(result.handle.provenanceRef.objectType, 'related_nfo_update');
  assert.deepEqual(result.after, result.before, 'the Material Field source must remain read-only');
  assert.deepEqual([...result.output.matchAll(/<genre>([^<]+)<\/genre>/g)].map((item) => item[1]),
    ['Family', 'Drama']);
  assert.match(result.output,
    /<actor><name>Toma Ikuta<\/name><tmdbid>228072<\/tmdbid><\/actor>/);
  assert.doesNotMatch(result.output,
    /<actor><name>Toma Ikuta<\/name><tmdbid>428733<\/tmdbid><\/actor>/);
  assert.deepEqual(parseRelatedNfoMovieIdentity(result.output), {
    title:'人生密密缝', releaseYear:'2017', tmdbMovieId:'428733',
  });
});

test('damaged related NFO is rebuilt and absent NFO is created', () => {
  const rebuilt = render(Buffer.from('<movie><title>broken</movie>', 'utf8'));
  assert.equal(rebuilt.handle.provenanceRef.objectType, 'product_metadata_draft_rebuild');
  assert.match(rebuilt.output, /^<movie>/);
  assert.match(rebuilt.output, /<uniqueid type="tmdb">12345<\/uniqueid>/);
  assert.match(rebuilt.output, /<name>王祖贤<\/name>[\s\S]*?<tmdbid>124<\/tmdbid>/);
  assert.deepEqual(rebuilt.after, rebuilt.before, 'damaged source remains unchanged');

  const identityDamaged = render(Buffer.from('<movie><title>倩女幽魂</title><tmdbid>99</tmdbid></movie>', 'utf8'));
  assert.equal(identityDamaged.handle.provenanceRef.objectType, 'product_metadata_draft_rebuild');
  assert.match(identityDamaged.output, /<tmdbid>12345<\/tmdbid>/);
  assert.deepEqual(identityDamaged.after, identityDamaged.before, 'identity-damaged source remains unchanged');

  const created = render(null);
  assert.equal(created.handle.provenanceRef.objectType, 'product_metadata_draft_create');
  assert.match(created.output, /<title>倩女幽魂<\/title>/);
  assert.match(created.output, /<name>张国荣<\/name>[\s\S]*?<tmdbid>123<\/tmdbid>/);
});

test('Related NFO observations use the current stable bytes after an external rewrite', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nfo-current-snapshot-'));
  try {
    const location = path.join(root, 'movie.nfo');
    fs.writeFileSync(location, '<movie><title>Original</title><year>2025</year><tmdbid>123</tmdbid></movie>');
    const reference = relatedReference(location);
    const port = createCleanProductProductionPort({mediaProbe:{probe(){}},workspaceProductPort:{materializeArtifact(){},acquireArtifact(){}}});
    const input = {libraRunId:'run',runExecutionBasisDigest:'b'.repeat(64),runCreatedAtMs:1,nfoReference:reference,
      physicalIdentity:reference.identity,sizeBytes:reference.identity.sizeBytes,endpointId:'local',location,
      bindingRevision:1,mountScopeRevision:1};
    const planned = port.issuePhysicalReadHandle(input);
    fs.writeFileSync(location + '.tmp', '<movie><tmdbid>123</tmdbid><year>2025</year><title><![CDATA[Original]]></title><dateadded>today</dateadded></movie>');
    fs.renameSync(location + '.tmp', location);
    assert.deepEqual(port.issuePhysicalReadHandle(input),planned,'historical projections must not read changed filesystem facts');
    assert.throws(() => port.issuePhysicalReadHandle({...input,nfoReference:undefined}),{code:'CLEAN_PRODUCT_REALITY_MISMATCH'});
    const result = port.readRelatedNfo({reference,primaryMaterialKey:reference.primaryMaterialKey});
    assert.equal(result.entries.find((item) => item.key === 'title').value,'Original');
    assert.match(result.sourceNfoSnapshotDigest,/^[a-f0-9]{64}$/);
    assert.equal(result.sourceNfoSemantics.entries.find((item) => item.key === 'tmdb').value,'123');
    assert.equal(result.bytes.toString(),fs.readFileSync(location,'utf8'));
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
