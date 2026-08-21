'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createCleanArcaInventoryPort } = require('../src/clean-arca-inventory-port');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { editionFromSourceDisplay } = require('../src/helix/domains/libra/model/product-identity-commit-contracts');
const { computeBoundedMaterialFingerprintSync } = require('../src/helix/integrations/bounded-material-fingerprint');
const schemaManifest = require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json');

const EMPTY_CLAIMS = Object.freeze([]);
const EMPTY_CLAIMS_DIGEST = canonicalDigest({
  schema:'libra.production-material-episode-claims@1', items:EMPTY_CLAIMS,
});

function identity(location, mountScopeId) {
  const observed = computeBoundedMaterialFingerprintSync(location);
  const base = {
    mountScopeId,
    inode:observed.stat.ino.toString(),
    sizeBytes:Number(observed.stat.size),
    fingerprintAlgorithm:observed.fingerprintAlgorithm,
    fingerprintVersion:observed.fingerprintVersion,
    contentFingerprint:observed.contentFingerprint,
  };
  return Object.freeze({
    schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2', schemaVersion:2,
    ...base,
    materialKey:canonicalDigest({ schema:'physical-material-identity@2', ...base }),
  });
}

function member(location, role, mountScopeId, workspace = null) {
  const physicalIdentity = identity(location, mountScopeId);
  return Object.freeze({
    materialKey:physicalIdentity.materialKey,
    role,
    physicalIdentity,
    sizeBytes:physicalIdentity.sizeBytes,
    location:workspace
      ? Object.freeze({ locationKind:'workspace_handle', endpointId:'workspace', location:null })
      : Object.freeze({ locationKind:'domain_binding', endpointId:'canary', location }),
    workspaceMaterialHandle:workspace && Object.freeze({
      ownerDomain:'libra', workspaceId:workspace.workspaceId,
      relativePath:workspace.relativePath, materialKey:physicalIdentity.materialKey,
    }),
    episodeClaims:EMPTY_CLAIMS,
    episodeClaimSetDigest:EMPTY_CLAIMS_DIGEST,
  });
}

test('target folder uses the resolved display title and derives its year without opaque or zero fallbacks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-arca-display-identity-'));
  try {
    const port = createCleanArcaInventoryPort({
      schemaManifest, unitOfWork:{}, workspaceRoot:path.join(root, '.workspace'),
    });
    const shelf = Object.freeze({
      shelfId:'shelf-1', status:'active',
      target:{ endpointId:'canary', rootLocation:root },
      placement:{ value:{ folderTemplate:'{title} ({year})' } },
    });
    const packageValue = Object.freeze({
      onDeckPackageId:'opaque-package-digest', shelfId:'shelf-1',
      resolvedIdentitySnapshot:{ factValue:{ displayIdentity:{ entries:Object.freeze([
        Object.freeze({ key:'title', value:'老笠 (2016)' }),
      ]) } } },
      productMaterialManifest:{ members:Object.freeze([{}]) },
    });
    assert.equal(port.resolveTargetLocation({ shelf, onDeckProductPackage:packageValue }).targetDirectory,
      path.join(root, '老笠 (2016)'));
    assert.throws(() => port.resolveTargetLocation({ shelf, onDeckProductPackage:{
      ...packageValue, resolvedIdentitySnapshot:{ factValue:{} },
    } }), (error) => error.code === 'CLEAN_ARCA_TARGET_IDENTITY_TITLE_REQUIRED');
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('source edition tags distinguish same title-year inventory folders without hash or numeric suffixes', () => {
  assert.equal(editionFromSourceDisplay('养蜂人 (2024) - 2160p HEVC Atmos TrueHD5.1', '养蜂人', 2024),
    '2160p HEVC Atmos TrueHD5.1');
  assert.equal(editionFromSourceDisplay('养蜂人 (2024)', '养蜂人', 2024), null);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-arca-edition-folder-'));
  try {
    const port = createCleanArcaInventoryPort({
      schemaManifest, unitOfWork:{}, workspaceRoot:path.join(root, '.workspace'),
    });
    const shelf = Object.freeze({
      shelfId:'shelf-1', status:'active',
      target:{ endpointId:'canary', rootLocation:root },
      placement:{ value:{ folderTemplate:'{title} ({year})' } },
    });
    const packageFor = (edition) => Object.freeze({
      onDeckPackageId:'opaque-package-digest', shelfId:'shelf-1',
      resolvedIdentitySnapshot:{ factValue:{ displayIdentity:{ entries:Object.freeze([
        Object.freeze({ key:'title', value:'养蜂人' }),
        Object.freeze({ key:'year', value:'2024' }),
        ...(edition ? [Object.freeze({ key:'edition', value:edition })] : []),
      ]) } } },
      productMaterialManifest:{ members:Object.freeze([{}]) },
    });
    assert.equal(port.resolveTargetLocation({ shelf, onDeckProductPackage:packageFor(null) }).targetDirectory,
      path.join(root, '养蜂人 (2024)'));
    assert.equal(port.resolveTargetLocation({
      shelf, onDeckProductPackage:packageFor('2160p HEVC Atmos TrueHD5.1'),
    }).targetDirectory, path.join(root, '养蜂人 (2024) - 2160p HEVC Atmos TrueHD5.1'));
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('Final Inventory Decision freezes standard Movie names instead of Workspace or hash names', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-arca-final-names-'));
  try {
    const inputs = path.join(root, 'inputs');
    fs.mkdirSync(inputs);
    const sources = [
      ['69355f9a (0).mkv', 'primary_payload'],
      ['rendered-internal-id.nfo', 'metadata_sidecar'],
      ['transcode-deadbeef.zh-CN.forced.sdh.srt', 'subtitle'],
      ['artifact-opaque-poster.jpeg', 'poster'],
      ['artifact-opaque-fanart.webp', 'fanart'],
    ].map(([name, role]) => {
      const location = path.join(inputs, name);
      fs.writeFileSync(location, Buffer.from(`${role}-bytes`));
      return member(location, role, 'canary-mount');
    });
    const shelf = Object.freeze({
      shelfId:'shelf-1', status:'active', currentPlacementRevision:1,
      target:{ endpointId:'canary', rootLocation:root, mountScopeId:'canary-mount', mountScopeRevision:1 },
      placement:{ value:{
        folderTemplate:'{title} ({year})', primaryTemplate:'{stem}{ext}', nfoTemplate:'{stem}.nfo',
        subtitleTemplate:'{stem}{language}{forced}{sdh}{ext}', posterTemplate:'poster{ext}',
        fanartTemplate:'fanart{ext}', collisionPolicy:'reject',
      } },
    });
    const packageValue = Object.freeze({
      onDeckPackageId:'package-names', shelfId:'shelf-1',
      resolvedIdentitySnapshot:{ factValue:{ title:'老笠', year:2016 } },
      productStructureSnapshot:{ structureKind:'single' },
      productMaterialManifest:{ members:Object.freeze(sources), manifestDigest:'manifest-names' },
      offloadContextManifest:{ manifestDigest:'offload-names', members:Object.freeze([]) },
    });
    const port = createCleanArcaInventoryPort({ schemaManifest, unitOfWork:{}, workspaceRoot:path.join(root, '.workspace') });
    const decision = port.prepare({ onDeckRunId:'on-deck-names', shelf, onDeckProductPackage:packageValue });
    const byRole = Object.fromEntries(decision.members.map((item) => [item.role, item]));
    assert.deepEqual(Object.fromEntries(Object.entries(byRole).map(([role, item]) => [role, item.finalName])), {
      primary_payload:'老笠 (2016).mkv',
      metadata_sidecar:'老笠 (2016).nfo',
      subtitle:'老笠 (2016).zh-CN.forced.sdh.srt',
      poster:'poster.jpeg',
      fanart:'fanart.webp',
    });
    for (const item of decision.members) {
      assert.equal(item.targetLocation, path.join(root, '老笠 (2016)', item.finalName));
      assert.equal(item.sourceMaterialKey.length, 64);
      assert.equal(/(?:69355f9a|transcode-|opaque|internal-id)/.test(item.finalName), false);
    }
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('unproven-language subtitles keep original names instead of collapsing onto one stem', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-arca-subtitle-names-'));
  try {
    const inputs = path.join(root, 'inputs');
    fs.mkdirSync(inputs);
    const sources = [
      ['movie.mkv', 'primary_payload'],
      ['Panic Room (2002) - 1080p.chinese(简英,assrt).ass', 'subtitle'],
      ['Panic Room (2002) - 1080p.chinese(简英,subtitle_best).ass', 'subtitle'],
      ['Panic Room (2002) - 1080p.zh-CN.srt', 'subtitle'],
    ].map(([name, role]) => {
      const location = path.join(inputs, name);
      fs.writeFileSync(location, Buffer.from(name));
      return member(location, role, 'canary-mount');
    });
    const shelf = Object.freeze({
      shelfId:'shelf-1', status:'active', currentPlacementRevision:1,
      target:{ endpointId:'canary', rootLocation:root, mountScopeId:'canary-mount', mountScopeRevision:1 },
      placement:{ value:{
        folderTemplate:'{title} ({year})', primaryTemplate:'{stem}{ext}', nfoTemplate:'{stem}.nfo',
        subtitleTemplate:'{stem}{language}{forced}{sdh}{ext}', posterTemplate:'poster{ext}',
        fanartTemplate:'fanart{ext}', collisionPolicy:'reject',
      } },
    });
    const packageValue = Object.freeze({
      onDeckPackageId:'package-subs', shelfId:'shelf-1',
      resolvedIdentitySnapshot:{ factValue:{ title:'战栗空间', year:2002 } },
      productStructureSnapshot:{ structureKind:'single' },
      productMaterialManifest:{ members:Object.freeze(sources), manifestDigest:'manifest-subs' },
      offloadContextManifest:{ manifestDigest:'offload-subs', members:Object.freeze([]) },
    });
    const port = createCleanArcaInventoryPort({ schemaManifest, unitOfWork:{}, workspaceRoot:path.join(root, '.workspace') });
    const decision = port.prepare({ onDeckRunId:'on-deck-subs', shelf, onDeckProductPackage:packageValue });
    const subtitleNames = decision.members.filter((item) => item.role === 'subtitle').map((item) => item.finalName).sort();
    assert.deepEqual(subtitleNames, [
      'Panic Room (2002) - 1080p.chinese(简英,assrt).ass',
      'Panic Room (2002) - 1080p.chinese(简英,subtitle_best).ass',
      '战栗空间 (2002).zh-CN.srt',
    ]);
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('same-root Stage/Switch preserves exact final members, merges new members, and settles final-location input as a no-op', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-arca-same-root-'));
  try {
    const targetDirectory = path.join(root, 'Example Movie');
    const workspaceRoot = path.join(root, '.workspace');
    const workspaceId = 'run-workspace';
    fs.mkdirSync(path.join(workspaceRoot, workspaceId, 'product'), { recursive:true });
    fs.mkdirSync(targetDirectory, { recursive:true });
    const primary = path.join(targetDirectory, 'Example Movie.mkv');
    const oldPoster = path.join(targetDirectory, 'poster.jpg');
    const oldNfo = path.join(targetDirectory, 'legacy.nfo');
    const productPoster = path.join(workspaceRoot, workspaceId, 'product', 'poster.jpg');
    const productNfo = path.join(workspaceRoot, workspaceId, 'product', 'movie.nfo');
    fs.writeFileSync(primary, Buffer.from('movie-bytes'));
    fs.writeFileSync(oldPoster, Buffer.from('same-poster-bytes'));
    fs.writeFileSync(productPoster, Buffer.from('same-poster-bytes'));
    fs.writeFileSync(oldNfo, Buffer.from('old-nfo'));
    fs.writeFileSync(productNfo, Buffer.from('new-nfo'));

    const mountScopeId = 'canary-mount';
    const productMembers = [
      member(primary, 'primary_payload', mountScopeId),
      member(productPoster, 'poster', mountScopeId,
        { workspaceId, relativePath:'product/poster.jpg' }),
      member(productNfo, 'metadata_sidecar', mountScopeId,
        { workspaceId, relativePath:'product/movie.nfo' }),
    ];
    const packageValue = Object.freeze({
      onDeckPackageId:'package-1', shelfId:'shelf-1',
      resolvedIdentitySnapshot:{ factValue:{ title:'Example Movie' } },
      productStructureSnapshot:{ structureKind:'single' },
      productMaterialManifest:{ members:Object.freeze(productMembers), manifestDigest:'manifest-1' },
      offloadContextManifest:{ manifestDigest:'offload-1', members:Object.freeze([
        Object.freeze({ materialKey:identity(oldPoster, mountScopeId).materialKey, location:oldPoster }),
        Object.freeze({ materialKey:identity(oldNfo, mountScopeId).materialKey, location:oldNfo }),
      ]) },
    });
    const shelf = Object.freeze({
      shelfId:'shelf-1', status:'active', currentPlacementRevision:1,
      target:{ endpointId:'canary', rootLocation:root, mountScopeId, mountScopeRevision:1 },
      placement:{ value:{ folderTemplate:'{title}' } },
    });
    const port = createCleanArcaInventoryPort({
      schemaManifest, unitOfWork:{}, workspaceRoot,
    });
    const request = {
      onDeckRunId:'on-deck-1', custodyId:'custody-1', shelf,
      onDeckProductPackage:packageValue, observedAtMs:1, replayCommitted:false,
    };
    const finalInventoryDecision = port.prepare(request);
    const targetCommitSlotHandle = port.prepareSlot({ ...request, finalInventoryDecision });
    const stagedManifest = port.stage({ ...request, finalInventoryDecision, targetCommitSlotHandle });
    const stagedInventoryVerification = port.verifyStaged({
      ...request, finalInventoryDecision, stagedInventoryManifest:stagedManifest,
    });
    port.switchPlacement({
      ...request, finalInventoryDecision, stagedInventoryVerification,
      targetBindings:{ bindingSetDigest:'bindings-1' }, replacedInputSetDigest:'inputs-1',
    });

    assert.equal(fs.readFileSync(primary, 'utf8'), 'movie-bytes');
    assert.equal(fs.readFileSync(oldPoster, 'utf8'), 'same-poster-bytes');
    assert.equal(fs.readFileSync(path.join(targetDirectory, 'Example Movie.nfo'), 'utf8'), 'new-nfo');
    assert.equal(fs.existsSync(targetCommitSlotHandle.slotDirectory), false);
    assert.equal(port.readFinal({ ...request, finalInventoryDecision, replayCommitted:true }).members.length, 3);

    const finalInventoryRequest = { ...request, finalInventoryDecision };
    const posterFinal = finalInventoryDecision.members.find((item) => item.role === 'poster');
    const nfoFinal = finalInventoryDecision.members.find((item) => item.role === 'metadata_sidecar');
    const retained = port.settleInput({
      materialHandle:{ schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1', ownerDomain:'arca',
        ownerScope:{ scopeType:'on_deck_custody', scopeId:'custody-1' }, location:oldPoster,
        identity:identity(oldPoster, mountScopeId), expectedSizeBytes:fs.statSync(oldPoster).size },
      approval:{ approvalId:'approval-poster' }, finalInventoryRequest,
      finalMaterialKey:productMembers[1].materialKey, finalTargetLocation:posterFinal.targetLocation,
      settlementExpectation:'replace_or_move', sourceToFinalMappingDigest:canonicalDigest('poster-mapping'),
    });
    assert.deepEqual({ absent:retained.absent, disposition:retained.disposition },
      { absent:false, disposition:'retained_as_final' });
    assert.equal(fs.existsSync(oldPoster), true);

    const deleted = port.settleInput({
      materialHandle:{ schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1', ownerDomain:'arca',
        ownerScope:{ scopeType:'on_deck_custody', scopeId:'custody-1' }, location:oldNfo,
        identity:identity(oldNfo, mountScopeId), expectedSizeBytes:fs.statSync(oldNfo).size },
      approval:{ approvalId:'approval-nfo' }, finalInventoryRequest,
      finalMaterialKey:productMembers[2].materialKey, finalTargetLocation:nfoFinal.targetLocation,
      settlementExpectation:'remove_after_place', sourceToFinalMappingDigest:canonicalDigest('nfo-mapping'),
    });
    assert.deepEqual({ absent:deleted.absent, disposition:deleted.disposition },
      { absent:true, disposition:'settled_to_final' });
    assert.equal(fs.existsSync(oldNfo), false);
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('same-root Stage/Switch replaces managed source bytes occupying the final name', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-arca-same-root-replace-'));
  try {
    const targetDirectory = path.join(root, 'Example Movie');
    const workspaceRoot = path.join(root, '.workspace');
    const workspaceId = 'run-workspace';
    fs.mkdirSync(path.join(workspaceRoot, workspaceId, 'product'), { recursive:true });
    fs.mkdirSync(targetDirectory, { recursive:true });
    const primary = path.join(targetDirectory, 'Example Movie.mkv');
    const oldPoster = path.join(targetDirectory, 'poster.jpg');
    const productPoster = path.join(workspaceRoot, workspaceId, 'product', 'poster.jpg');
    fs.writeFileSync(primary, Buffer.from('movie-bytes'));
    fs.writeFileSync(oldPoster, Buffer.from('old-poster-bytes'));
    const oldPosterIdentity = identity(oldPoster, 'canary-mount');
    fs.writeFileSync(productPoster, Buffer.from('new-poster-bytes'));
    const mountScopeId = 'canary-mount';
    const productMembers = [
      member(primary, 'primary_payload', mountScopeId),
      member(productPoster, 'poster', mountScopeId,
        { workspaceId, relativePath:'product/poster.jpg' }),
    ];
    const packageValue = Object.freeze({
      onDeckPackageId:'package-1', shelfId:'shelf-1',
      resolvedIdentitySnapshot:{ factValue:{ title:'Example Movie' } },
      productStructureSnapshot:{ structureKind:'single' },
      productMaterialManifest:{ members:Object.freeze(productMembers), manifestDigest:'manifest-1' },
      offloadContextManifest:{ manifestDigest:'offload-1', members:Object.freeze([
        Object.freeze({ materialKey:identity(oldPoster, mountScopeId).materialKey, location:oldPoster }),
      ]) },
    });
    const shelf = Object.freeze({
      shelfId:'shelf-1', status:'active', currentPlacementRevision:1,
      target:{ endpointId:'canary', rootLocation:root, mountScopeId, mountScopeRevision:1 },
      placement:{ value:{ folderTemplate:'{title}' } },
    });
    const port = createCleanArcaInventoryPort({ schemaManifest, unitOfWork:{}, workspaceRoot });
    const request = {
      onDeckRunId:'on-deck-1', custodyId:'custody-1', shelf,
      onDeckProductPackage:packageValue, observedAtMs:1, replayCommitted:false,
    };
    const finalInventoryDecision = port.prepare(request);
    const targetCommitSlotHandle = port.prepareSlot({ ...request, finalInventoryDecision });
    const stagedManifest = port.stage({ ...request, finalInventoryDecision, targetCommitSlotHandle });
    const stagedInventoryVerification = port.verifyStaged({
      ...request, finalInventoryDecision, stagedInventoryManifest:stagedManifest,
    });
    port.switchPlacement({
      ...request, finalInventoryDecision, stagedInventoryVerification,
      targetBindings:{ bindingSetDigest:'bindings-1' }, replacedInputSetDigest:'inputs-1',
    });
    assert.equal(fs.readFileSync(oldPoster, 'utf8'), 'new-poster-bytes');
    const posterPlan = finalInventoryDecision.members.find((item) => item.role === 'poster');
    const settled = port.settleInput({
      materialHandle:{
        schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',
        ownerDomain:'arca',
        ownerScope:{ scopeType:'on_deck_custody', scopeId:'custody-1' },
        location:oldPoster,
        identity:oldPosterIdentity,
        expectedSizeBytes:oldPosterIdentity.sizeBytes,
      },
      approval:{ approvalId:'approval' },
      finalInventoryRequest:{ ...request, finalInventoryDecision },
      finalMaterialKey:posterPlan.sourceMaterialKey,
      finalTargetLocation:posterPlan.targetLocation,
      settlementExpectation:'replace_or_move',
      sourceToFinalMappingDigest:canonicalDigest({ source:oldPosterIdentity.materialKey, target:'final' }),
    });
    assert.equal(settled.disposition, 'retained_as_final');
    assert.equal(fs.readFileSync(oldPoster, 'utf8'), 'new-poster-bytes');
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('settlement ignores a sibling movie directory and still rejects unknown files', () => {
  const sibling = settlementFixture({ siblingDirectory:true });
  try {
    const result = sibling.port.settleInput({
      materialHandle:sibling.materialHandle,
      approval:{ approvalId:'approval' },
      finalInventoryRequest:sibling.finalInventoryRequest,
      finalMaterialKey:sibling.finalMember.sourceMaterialKey,
      finalTargetLocation:sibling.finalMember.targetLocation,
      settlementExpectation:'replace_or_move',
      sourceToFinalMappingDigest:sibling.mappingDigest,
    });
    assert.equal(result.disposition, 'settled_to_final');
    assert.equal(fs.existsSync(path.join(sibling.sourceDirectory, '养蜂人 (2024) - 2160p HEVC Atmos TrueHD5.1')), true);
  } finally {
    fs.rmSync(sibling.root, { recursive:true, force:true });
  }

  const unknown = settlementFixture({ siblingDirectory:true, unknownMember:true });
  try {
    assert.throws(() => unknown.port.settleInput({
      materialHandle:unknown.materialHandle,
      approval:{ approvalId:'approval' },
      finalInventoryRequest:unknown.finalInventoryRequest,
      finalMaterialKey:unknown.finalMember.sourceMaterialKey,
      finalTargetLocation:unknown.finalMember.targetLocation,
      settlementExpectation:'replace_or_move',
      sourceToFinalMappingDigest:unknown.mappingDigest,
    }), (error) => error.code === 'CLEAN_ARCA_SETTLEMENT_UNKNOWN_MEMBER');
  } finally {
    fs.rmSync(unknown.root, { recursive:true, force:true });
  }
});

function settlementFixture({ unknownMember = false, siblingDirectory = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-arca-settlement-'));
  const sourceDirectory = path.join(root, 'opaque-source');
  const targetRoot = path.join(root, 'shelf');
  fs.mkdirSync(sourceDirectory, { recursive:true });
  fs.mkdirSync(targetRoot, { recursive:true });
  const source = path.join(sourceDirectory, 'opaque-hash.mkv');
  fs.writeFileSync(source, Buffer.from('exact-movie-bytes'));
  if (unknownMember) fs.writeFileSync(path.join(sourceDirectory, 'notes.txt'), Buffer.from('unknown'));
  if (siblingDirectory) {
    const sibling = path.join(sourceDirectory, '养蜂人 (2024) - 2160p HEVC Atmos TrueHD5.1');
    fs.mkdirSync(path.join(sibling, 'BDMV', 'STREAM'), { recursive:true });
    fs.writeFileSync(path.join(sibling, 'BDMV', 'STREAM', '00000.m2ts'), Buffer.from('other-movie'));
  }
  const mountScopeId = 'canary-mount';
  const productMember = member(source, 'primary_payload', mountScopeId);
  const mappingDigest = canonicalDigest({ source:productMember.materialKey, target:'final' });
  const packageValue = Object.freeze({
    onDeckPackageId:'package-settlement', shelfId:'shelf-settlement',
    resolvedIdentitySnapshot:{ factValue:{ title:'Settled Movie', year:2026 } },
    productStructureSnapshot:{ structureKind:'single' },
    productMaterialManifest:{ members:Object.freeze([productMember]), manifestDigest:'manifest-settlement' },
    offloadContextManifest:{ manifestDigest:'offload-settlement', members:Object.freeze([
      Object.freeze({
        materialKey:productMember.materialKey,
        finalProductMaterialKey:productMember.materialKey,
        location:source,
        settlementExpectation:'replace_or_move',
        sourceToFinalMappingDigest:mappingDigest,
      }),
    ]) },
  });
  const shelf = Object.freeze({
    shelfId:'shelf-settlement', status:'active', currentPlacementRevision:1,
    target:{ endpointId:'canary', rootLocation:targetRoot, mountScopeId, mountScopeRevision:1 },
    placement:{ value:{ folderTemplate:'{title} ({year})' } },
  });
  const port = createCleanArcaInventoryPort({
    schemaManifest, unitOfWork:{}, workspaceRoot:path.join(root, '.workspace'),
  });
  const finalInventoryRequest = {
    onDeckRunId:'on-deck-settlement', custodyId:'custody-settlement', shelf,
    onDeckProductPackage:packageValue, observedAtMs:1, replayCommitted:true,
  };
  const finalInventoryDecision = port.prepare(finalInventoryRequest);
  finalInventoryRequest.finalInventoryDecision = finalInventoryDecision;
  const finalMember = finalInventoryDecision.members[0];
  fs.mkdirSync(path.dirname(finalMember.targetLocation), { recursive:true });
  fs.copyFileSync(source, finalMember.targetLocation);
  const materialHandle = {
    schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1', ownerDomain:'arca',
    ownerScope:{ scopeType:'on_deck_custody', scopeId:'custody-settlement' },
    location:source, identity:productMember.physicalIdentity,
    expectedSizeBytes:productMember.physicalIdentity.sizeBytes,
  };
  return { root, sourceDirectory, source, port, finalInventoryRequest,
    finalMember, materialHandle, mappingDigest };
}

test('different-path settlement verifies the final copy before removing only the managed source and empty directory', () => {
  const fixture = settlementFixture();
  try {
    const result = fixture.port.settleInput({
      materialHandle:fixture.materialHandle,
      approval:{ approvalId:'approval' },
      finalInventoryRequest:fixture.finalInventoryRequest,
      finalMaterialKey:fixture.finalMember.sourceMaterialKey,
      finalTargetLocation:fixture.finalMember.targetLocation,
      settlementExpectation:'replace_or_move',
      sourceToFinalMappingDigest:fixture.mappingDigest,
    });
    assert.equal(result.finalVerified, true);
    assert.equal(result.disposition, 'settled_to_final');
    assert.equal(result.oldDirectoryDisposition, 'removed_empty');
    assert.equal(fs.existsSync(fixture.source), false);
    assert.equal(fs.existsSync(fixture.sourceDirectory), false);
    assert.equal(fs.readFileSync(fixture.finalMember.targetLocation, 'utf8'), 'exact-movie-bytes');
  } finally {
    fs.rmSync(fixture.root, { recursive:true, force:true });
  }
});

test('unknown old-directory members stop settlement before any managed source is removed', () => {
  const fixture = settlementFixture({ unknownMember:true });
  try {
    assert.throws(() => fixture.port.settleInput({
      materialHandle:fixture.materialHandle,
      approval:{ approvalId:'approval' },
      finalInventoryRequest:fixture.finalInventoryRequest,
      finalMaterialKey:fixture.finalMember.sourceMaterialKey,
      finalTargetLocation:fixture.finalMember.targetLocation,
      settlementExpectation:'replace_or_move',
      sourceToFinalMappingDigest:fixture.mappingDigest,
    }), (error) => error.code === 'CLEAN_ARCA_SETTLEMENT_UNKNOWN_MEMBER');
    assert.equal(fs.existsSync(fixture.source), true);
    assert.equal(fs.existsSync(path.join(fixture.sourceDirectory, 'notes.txt')), true);
  } finally {
    fs.rmSync(fixture.root, { recursive:true, force:true });
  }
});
