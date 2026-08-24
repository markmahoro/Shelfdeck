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

function draft() {
  return Object.freeze({
    draftId:'draft-1',
    draftDigest:'d'.repeat(64),
    basisDigest:'b'.repeat(64),
    metadataObservationSetDigest:'c'.repeat(64),
    descriptiveFacts:Object.freeze({ entries:Object.freeze([
      Object.freeze({ key:'title', value:'倩女幽魂' }),
      Object.freeze({ key:'tmdb_movie_id', value:'12345' }),
      Object.freeze({ key:'year_or_release_date', value:1987 }),
      Object.freeze({ key:'plot', value:'更新后的简介' }),
    ]) }),
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

function render(sourceBytes) {
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
      productMetadataDraft:draft(), mediaCastDraft:mediaCastDraft(),
      sidecarProfile:profile(), libraRunId:'run-1',
      workspaceId:'workspace-1', relativePath:'product/movie.nfo', contentProfile:'movie',
      relatedReference:reference,
    });
    return { handle, output:write.bytes.toString('utf8'), before,
      after:sourceBytes === null ? null : fs.readFileSync(source) };
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
}

test('movie identity ignores actor tmdb ids and reads only the root-level movie identity', () => {
  const identity = parseRelatedNfoMovieIdentity(`<movie>
    <title>007：大破天幕杀机</title><year>2012</year>
    <actor><name>Daniel Craig</name><tmdbid>8784</tmdbid></actor>
    <uniqueid type="tmdb">37724</uniqueid>
  </movie>`);
  assert.deepEqual(identity, { title:'007：大破天幕杀机', releaseYear:'2012', tmdbMovieId:'37724' });
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
