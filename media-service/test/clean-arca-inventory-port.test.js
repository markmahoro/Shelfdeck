'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createCleanArcaInventoryPort } = require('../src/clean-arca-inventory-port');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
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
      offloadContextManifest:{ manifestDigest:'offload-1', members:Object.freeze([]) },
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
    const retained = port.settleInput({
      materialHandle:{ schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1', ownerDomain:'arca',
        ownerScope:{ scopeType:'on_deck_custody', scopeId:'custody-1' }, location:oldPoster,
        identity:identity(oldPoster, mountScopeId), expectedSizeBytes:fs.statSync(oldPoster).size },
      approval:{ approvalId:'approval-poster' }, finalInventoryRequest,
    });
    assert.deepEqual({ absent:retained.absent, disposition:retained.disposition },
      { absent:false, disposition:'retained_as_final' });
    assert.equal(fs.existsSync(oldPoster), true);

    const deleted = port.settleInput({
      materialHandle:{ schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1', ownerDomain:'arca',
        ownerScope:{ scopeType:'on_deck_custody', scopeId:'custody-1' }, location:oldNfo,
        identity:identity(oldNfo, mountScopeId), expectedSizeBytes:fs.statSync(oldNfo).size },
      approval:{ approvalId:'approval-nfo' }, finalInventoryRequest,
    });
    assert.deepEqual({ absent:deleted.absent, disposition:deleted.disposition },
      { absent:true, disposition:'deleted' });
    assert.equal(fs.existsSync(oldNfo), false);
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});
