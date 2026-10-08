'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { cooperativeCopyFile, createCleanArcaInventoryPort } = require('../src/clean-arca-inventory-port');

test('large Inventory copies yield once and use the native asynchronous copy path', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'clean-arca-cooperative-copy-'));
  const source=path.join(root,'source.bin'),target=path.join(root,'target.bin');
  try {
    fs.writeFileSync(source,Buffer.alloc(12*1024*1024,0x5a));
    let turns=0,running=true;
    const tick=()=>{turns+=1;if(running)setImmediate(tick);};
    setImmediate(tick);
    await cooperativeCopyFile(source,target,fs.constants.COPYFILE_EXCL);
    running=false;
    assert.ok(turns>=1,`expected an event-loop turn before native copy, observed ${turns}`);
    assert.doesNotMatch(cooperativeCopyFile.toString(), /\.read\(|\.write\(/);
    assert.equal(fs.statSync(target).size,fs.statSync(source).size);
    assert.deepEqual(fs.readFileSync(target),fs.readFileSync(source));
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { editionFromSourceDisplay } = require('../src/helix/domains/libra/model/product-identity-commit-contracts');
const { computeBoundedMaterialFingerprintSync } = require('../src/helix/integrations/bounded-material-fingerprint');
const { CAPABILITY_REFS } = require('../src/helix/domains/arca/model/on-deck-contract');
const { priorOnDeckPlacementReceipt } = require('../src/helix/domains/arca/capabilities/on-deck-capability-ports');
const schemaManifest = require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json');

const EMPTY_CLAIMS = Object.freeze([]);
const { observeNfoReferenceSemantics } = require('../src/helix/contracts/nfo-reference-semantics');
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

test('prior Placement evidence is accepted only from the same On-deck Run and commit slot', () => {
  const receipt = Object.freeze({
    schemaRef:'helix://contracts/types/PlacementSwitchReceipt/v1', schemaVersion:1,
    receiptKind:'placement_switched', ownerDomain:'arca', scopeType:'on_deck_run',
    scopeId:'run-1', targetCommitSlotId:'slot-1', transactionRevision:1,
  });
  const options = { workResultReader:{
    listWorks:()=>Object.freeze([
      Object.freeze({ work_id:'work-1', updated_at_ms:1 }),
      Object.freeze({ work_id:'work-2', updated_at_ms:2 }),
    ]),
    read:(workId)=>Object.freeze([Object.freeze({
      capabilityRef:CAPABILITY_REFS.placement, outcomeKind:'succeeded',
      result:workId==='work-2'?receipt:{ ...receipt, scopeId:'another-run' },
    })]),
  } };
  const execution = Object.freeze({ ownerScope:Object.freeze({
    processType:'arca_ondeck_run', processId:'run-1',
  }) });
  assert.equal(priorOnDeckPlacementReceipt(options, execution, 'slot-1'), receipt);
  assert.equal(priorOnDeckPlacementReceipt(options, execution, 'another-slot'), null);
  assert.equal(priorOnDeckPlacementReceipt(options, {
    ownerScope:{ processType:'arca_shelf_entry', processId:'run-1' },
  }, 'slot-1'), null);
});

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

test('Placement target conflicts are preflighted before any earlier member is switched', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'clean-arca-placement-preflight-'));
  try {
    const targetRoot=path.join(root,'shelf'),sourceRoot=path.join(root,'source');
    fs.mkdirSync(targetRoot,{recursive:true});fs.mkdirSync(sourceRoot,{recursive:true});
    const primary=path.join(sourceRoot,'movie.mkv'),poster=path.join(sourceRoot,'source-poster.jpg');
    fs.writeFileSync(primary,Buffer.from('primary-bytes'));fs.writeFileSync(poster,Buffer.from('poster-bytes'));
    const mountScopeId='canary-mount',port=createCleanArcaInventoryPort({schemaManifest,unitOfWork:{},workspaceRoot:path.join(root,'.workspace')});
    const shelf=Object.freeze({shelfId:'shelf-1',status:'active',currentPlacementRevision:1,
      target:{endpointId:'canary',rootLocation:targetRoot,mountScopeId,mountScopeRevision:1},
      placement:{value:{folderTemplate:'{title} ({year})'}}});
    const packageValue=Object.freeze({onDeckPackageId:'package-preflight',shelfId:'shelf-1',
      resolvedIdentitySnapshot:{factValue:{displayIdentity:{entries:Object.freeze([
        Object.freeze({key:'title',value:'Preflight Movie'}),Object.freeze({key:'year',value:'2026'}),
      ])}}},productStructureSnapshot:{structureKind:'single'},
      productMaterialManifest:{manifestDigest:'manifest-preflight',members:Object.freeze([
        member(primary,'primary_payload',mountScopeId),member(poster,'poster',mountScopeId),
      ])},offloadContextManifest:{manifestDigest:'offload-preflight',members:Object.freeze([])}});
    const request={onDeckRunId:'run-preflight',custodyId:'custody-preflight',shelf,
      onDeckProductPackage:packageValue,observedAtMs:10,replayCommitted:false};
    const finalInventoryDecision=port.prepare(request),slot=port.prepareSlot({...request,finalInventoryDecision}),
      staged=await port.stage({...request,finalInventoryDecision,targetCommitSlotHandle:slot}),
      verified=await port.verifyStaged({...request,finalInventoryDecision,stagedInventoryManifest:staged}),
      ordered=finalInventoryDecision.members;
    const first=ordered[0],conflicting=ordered[ordered.length-1];
    fs.mkdirSync(path.dirname(conflicting.targetLocation),{recursive:true});
    fs.writeFileSync(conflicting.targetLocation,Buffer.from('foreign-conflicting-bytes'));
    await assert.rejects(port.switchPlacement({...request,finalInventoryDecision,
      stagedInventoryVerification:verified,targetBindings:{bindingSetDigest:'bindings'},
      replacedInputSetDigest:'inputs'}),(error)=>error.code==='CLEAN_ARCA_TARGET_OCCUPIED');
    assert.equal(fs.existsSync(first.targetLocation),false);
    assert.equal(fs.existsSync(path.join(slot.slotDirectory,path.basename(first.targetLocation))),true);
    assert.equal(fs.readFileSync(conflicting.targetLocation,'utf8'),'foreign-conflicting-bytes');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
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

test('exact localized Chinese subtitle markers produce standard names without release tags', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-arca-localized-chinese-subtitle-'));
  try {
    const inputs = path.join(root, 'inputs');
    fs.mkdirSync(inputs);
    const sources = [
      ['movie.mp4', 'primary_payload'],
      ['老笠 (2016) - 1080p x264 AAC HDH.chinese(简).srt', 'subtitle'],
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
      onDeckPackageId:'package-localized-subtitle', shelfId:'shelf-1',
      resolvedIdentitySnapshot:{ factValue:{ title:'老笠', year:2016 } },
      productStructureSnapshot:{ structureKind:'single' },
      productMaterialManifest:{ members:Object.freeze(sources), manifestDigest:'manifest-localized-subtitle' },
      offloadContextManifest:{ manifestDigest:'offload-localized-subtitle', members:Object.freeze([]) },
    });
    const port = createCleanArcaInventoryPort({ schemaManifest, unitOfWork:{}, workspaceRoot:path.join(root, '.workspace') });
    const decision = port.prepare({ onDeckRunId:'on-deck-localized-subtitle', shelf, onDeckProductPackage:packageValue });
    const subtitle = decision.members.find((item) => item.role === 'subtitle');
    assert.equal(subtitle.finalName, '老笠 (2016).zh-CN.srt');
    assert.equal(/(?:1080p|x264|AAC|HDH)/i.test(subtitle.finalName), false);
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

test('numbered same-language subtitles keep original names instead of colliding on one stem', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-arca-numbered-subs-'));
  try {
    const inputs = path.join(root, 'inputs');
    fs.mkdirSync(inputs);
    const sources = [
      ['movie.mkv', 'primary_payload'],
      ['A Chinese Ghost Story 2 (1990) - 1080p AVC DTS.zh-CN.srt', 'subtitle'],
      ['A Chinese Ghost Story 2 (1990) - 1080p AVC DTS.1.zh-CN.srt', 'subtitle'],
      ['A Chinese Ghost Story 2 (1990) - 1080p AVC DTS.2.zh-CN.srt', 'subtitle'],
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
      onDeckPackageId:'package-iso-subs', shelfId:'shelf-1',
      resolvedIdentitySnapshot:{ factValue:{ title:'倩女幽魂2：人间道', year:1990 } },
      productStructureSnapshot:{ structureKind:'single' },
      productMaterialManifest:{ members:Object.freeze(sources), manifestDigest:'manifest-iso-subs' },
      offloadContextManifest:{ manifestDigest:'offload-iso-subs', members:Object.freeze([]) },
    });
    const port = createCleanArcaInventoryPort({ schemaManifest, unitOfWork:{}, workspaceRoot:path.join(root, '.workspace') });
    const decision = port.prepare({ onDeckRunId:'on-deck-iso-subs', shelf, onDeckProductPackage:packageValue });
    const subtitleNames = decision.members.filter((item) => item.role === 'subtitle').map((item) => item.finalName).sort();
    assert.deepEqual(subtitleNames, [
      'A Chinese Ghost Story 2 (1990) - 1080p AVC DTS.1.zh-CN.srt',
      'A Chinese Ghost Story 2 (1990) - 1080p AVC DTS.2.zh-CN.srt',
      'A Chinese Ghost Story 2 (1990) - 1080p AVC DTS.zh-CN.srt',
    ]);
    assert.equal(/(?:-[a-f0-9]{8}\.srt$)/.test(subtitleNames.join('\n')), false);
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('same-root Stage/Switch preserves exact final members, merges new members, and settles final-location input as a no-op', async () => {
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
    const productNfoBytes = '<movie><title>Example Movie</title><year>2025</year><plot>Plot</plot><genre>Drama</genre><tmdbid>123</tmdbid><actor><name>Actor One</name></actor></movie>';
    fs.writeFileSync(productNfo, Buffer.from(productNfoBytes));

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
    let copyStarted;
    let releaseCopy;
    const copyStartedPromise = new Promise((resolve) => { copyStarted = resolve; });
    const copyGate = new Promise((resolve) => { releaseCopy = resolve; });
    const port = createCleanArcaInventoryPort({
      schemaManifest, unitOfWork:{}, workspaceRoot,
      copyFile:async (...args) => {
        copyStarted();
        await copyGate;
        return fs.promises.copyFile(...args);
      },
    });
    const request = {
      onDeckRunId:'on-deck-1', custodyId:'custody-1', shelf,
      onDeckProductPackage:packageValue, observedAtMs:1, replayCommitted:false,
    };
    const finalInventoryDecision = port.prepare(request);
    const targetCommitSlotHandle = port.prepareSlot({ ...request, finalInventoryDecision });
    assert.match(path.basename(targetCommitSlotHandle.slotDirectory),
      /^\.shelfdeck-stage-[0-9a-f]{16}$/);
    assert.equal(path.dirname(targetCommitSlotHandle.slotDirectory), root);
    const staging = port.stage({ ...request, finalInventoryDecision, targetCommitSlotHandle });
    assert.equal(typeof staging.then, 'function');
    await copyStartedPromise;
    let immediateRan = false;
    await new Promise((resolve) => setImmediate(() => { immediateRan = true; resolve(); }));
    assert.equal(immediateRan, true);
    releaseCopy();
    const stagedManifest = await staging;
    const stagedInventoryVerification = await port.verifyStaged({
      ...request, finalInventoryDecision, stagedInventoryManifest:stagedManifest,
    });
    await port.switchPlacement({
      ...request, finalInventoryDecision, stagedInventoryVerification,
      targetBindings:{ bindingSetDigest:'bindings-1' }, replacedInputSetDigest:'inputs-1',
    });

    assert.equal(fs.readFileSync(primary, 'utf8'), 'movie-bytes');
    assert.equal(fs.readFileSync(oldPoster, 'utf8'), 'same-poster-bytes');
    assert.equal(fs.readFileSync(path.join(targetDirectory, 'Example Movie.nfo'), 'utf8'), productNfoBytes);
    assert.equal(fs.existsSync(targetCommitSlotHandle.slotDirectory), false);
    assert.throws(() => port.readFinal({ ...request, finalInventoryDecision, replayCommitted:true }),
      (error) => error.code === 'CLEAN_ARCA_FINAL_VERIFICATION_CONTEXT_REQUIRED');
    port.readFinal({ ...request, finalInventoryDecision, replayCommitted:true, verificationContext:'on_deck' });

    const finalInventoryRequest = { ...request, finalInventoryDecision, verificationContext:'on_deck',
      nfoPresentationBasis:{
        metadata:{ descriptiveFacts:{ entries:[
          { key:'title', value:'Example Movie' }, { key:'year', value:'2025' },
          { key:'plot', value:'Plot' }, { key:'genre', value:'Drama' },
        ] } },
        cast:[{ role:'actor', displayName:'Actor One', providerIdentities:[] }],
        identity:{ provider:'tmdb', providerKey:'123' },
      } };
    assert.equal(port.readFinal({ ...finalInventoryRequest, replayCommitted:true }).members.length, 3);
    const posterFinal = finalInventoryDecision.members.find((item) => item.role === 'poster');
    const nfoFinal = finalInventoryDecision.members.find((item) => item.role === 'metadata_sidecar');
    const retained = await port.settleInputAsync({
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

    const deleted = await port.settleInputAsync({
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

test('On-deck recovery cannot overwrite an NFO using only a claimed managed pathname', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-arca-ondeck-repair-'));
  try {
    const targetRoot = path.join(root, 'shelf');
    const sourceRoot = path.join(root, 'input');
    const workspaceRoot = path.join(root, '.workspace');
    const workspaceId = 'run-workspace';
    fs.mkdirSync(targetRoot, { recursive:true });
    fs.mkdirSync(sourceRoot, { recursive:true });
    fs.mkdirSync(path.join(workspaceRoot, workspaceId, 'product'), { recursive:true });
    const primarySource = path.join(sourceRoot, 'old-primary.mkv');
    const nfoSource = path.join(workspaceRoot, workspaceId, 'product', 'movie.nfo');
    const targetDirectory = path.join(targetRoot, 'Example Movie');
    const primaryTarget = path.join(targetDirectory, 'Example Movie.mkv');
    const nfoTarget = path.join(targetDirectory, 'Example Movie.nfo');
    fs.writeFileSync(primarySource, Buffer.from('movie-bytes'));
    fs.writeFileSync(nfoSource, Buffer.from('canonical-nfo'));
    const mountScopeId = 'canary-mount';
    const productMembers = [
      member(primarySource, 'primary_payload', mountScopeId),
      member(nfoSource, 'metadata_sidecar', mountScopeId,
        { workspaceId, relativePath:'product/movie.nfo' }),
    ];
    const packageValue = Object.freeze({
      onDeckPackageId:'package-recovery', shelfId:'shelf-1',
      resolvedIdentitySnapshot:{ factValue:{ title:'Example Movie' } },
      productStructureSnapshot:{ structureKind:'single' },
      productMaterialManifest:{ members:Object.freeze(productMembers), manifestDigest:'manifest-recovery' },
      offloadContextManifest:{ manifestDigest:'offload-recovery', members:Object.freeze([
        Object.freeze({ materialKey:'old-nfo', location:nfoTarget }),
      ]) },
    });
    const shelf = Object.freeze({
      shelfId:'shelf-1', status:'active', currentPlacementRevision:1,
      target:{ endpointId:'canary', rootLocation:targetRoot, mountScopeId, mountScopeRevision:1 },
      placement:{ value:{ folderTemplate:'{title}' } },
    });
    const port = createCleanArcaInventoryPort({ schemaManifest, unitOfWork:{}, workspaceRoot });
    const request = { onDeckRunId:'on-deck-recovery', custodyId:'custody-recovery', shelf,
      onDeckProductPackage:packageValue, observedAtMs:1, replayCommitted:false };
    const finalInventoryDecision = port.prepare(request);
    fs.mkdirSync(targetDirectory, { recursive:true });
    fs.copyFileSync(primarySource, primaryTarget);
    fs.writeFileSync(nfoTarget, Buffer.from('externally-rewritten-nfo'));
    fs.rmSync(primarySource);

    const recoveryRequest = { ...request, finalInventoryDecision, replaySettledSources:true };
    const targetCommitSlotHandle = port.prepareSlot(recoveryRequest);
    const stagedInventoryManifest = await port.stage({ ...recoveryRequest, targetCommitSlotHandle });
    const stagedInventoryVerification = await port.verifyStaged({
      ...recoveryRequest, stagedInventoryManifest,
    });
    await assert.rejects(port.switchPlacement({
      ...recoveryRequest, stagedInventoryVerification,
      targetBindings:{ bindingSetDigest:'bindings-recovery' },
      replacedInputSetDigest:'inputs-recovery',
    }),{code:'CLEAN_ARCA_TARGET_OCCUPIED'});

    assert.equal(fs.readFileSync(primaryTarget, 'utf8'), 'movie-bytes');
    assert.equal(fs.readFileSync(nfoTarget, 'utf8'), 'externally-rewritten-nfo');
    assert.equal(fs.existsSync(primarySource), false);
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('post-Placement NFO verification accepts semantic Emby rewrites while exact members remain byte-strict', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-arca-semantic-nfo-'));
  try {
    const targetRoot = path.join(root, 'shelf');
    const sourceRoot = path.join(root, 'input');
    const workspaceRoot = path.join(root, '.workspace');
    const workspaceId = 'semantic-workspace';
    fs.mkdirSync(targetRoot, { recursive:true });
    fs.mkdirSync(sourceRoot, { recursive:true });
    fs.mkdirSync(path.join(workspaceRoot, workspaceId, 'product'), { recursive:true });
    const primarySource = path.join(sourceRoot, 'movie.mkv');
    const nfoSource = path.join(workspaceRoot, workspaceId, 'product', 'movie.nfo');
    fs.writeFileSync(primarySource, Buffer.from('immutable-primary-bytes'));
    fs.writeFileSync(nfoSource, Buffer.from('<movie><title>Example Movie</title><year>2025</year><plot>Plot</plot><genre>Drama</genre><tmdbid>123</tmdbid><actor><name>Actor One</name></actor></movie>'));
    const mountScopeId = 'canary-mount';
    const packageNfoIdentity = identity(nfoSource, mountScopeId);
    const packageValue = Object.freeze({
      onDeckPackageId:'package-semantic-nfo', shelfId:'shelf-1',
      resolvedIdentitySnapshot:{ factValue:{ title:'Example Movie' } },
      productStructureSnapshot:{ structureKind:'single' },
      productMaterialManifest:{ manifestDigest:'manifest-semantic-nfo', members:Object.freeze([
        member(primarySource, 'primary_payload', mountScopeId),
        member(nfoSource, 'metadata_sidecar', mountScopeId, { workspaceId, relativePath:'product/movie.nfo' }),
      ]) },
      offloadContextManifest:{ manifestDigest:'offload-semantic-nfo', members:Object.freeze([]) },
    });
    const shelf = Object.freeze({
      shelfId:'shelf-1', status:'active', currentPlacementRevision:1,
      target:{ endpointId:'canary', rootLocation:targetRoot, mountScopeId, mountScopeRevision:1 },
      placement:{ value:{ folderTemplate:'{title}' } },
    });
    const port = createCleanArcaInventoryPort({ schemaManifest, unitOfWork:{}, workspaceRoot });
    const request = { onDeckRunId:'on-deck-semantic-nfo', custodyId:'custody-semantic-nfo', shelf,
      onDeckProductPackage:packageValue, observedAtMs:10, replayCommitted:false,
      verificationContext:'on_deck' };
    const finalInventoryDecision = port.prepare(request);
    const targetCommitSlotHandle = port.prepareSlot({ ...request, finalInventoryDecision });
    const stagedInventoryManifest = await port.stage({ ...request, finalInventoryDecision, targetCommitSlotHandle });
    const stagedInventoryVerification = await port.verifyStaged({ ...request, finalInventoryDecision, stagedInventoryManifest });
    const placementReceipt = await port.switchPlacement({ ...request, finalInventoryDecision, stagedInventoryVerification,
      targetBindings:{ bindingSetDigest:'semantic-target-bindings' }, replacedInputSetDigest:'semantic-replaced-inputs' });

    const nfoTarget = finalInventoryDecision.members.find((item) => item.role === 'metadata_sidecar').targetLocation;
    const primaryTarget = finalInventoryDecision.members.find((item) => item.role === 'primary_payload').targetLocation;
    const embyRewrite = Buffer.from(`<?xml version="1.0" encoding="utf-8"?>\n<movie>\n  <title>Example Movie</title>\n  <year>2025</year>\n  <plot>Plot</plot>\n  <genre>Drama</genre>\n  <tmdbid>123</tmdbid>\n  <uniqueid type="tmdb">123</uniqueid>\n  <actor><name>Actor One</name></actor>\n  <dateadded>2026-08-31</dateadded>\n  <fileinfo><streamdetails><video><codec>hevc</codec></video></streamdetails></fileinfo>\n</movie>\n`);
    fs.writeFileSync(nfoTarget, embyRewrite);
    const nfoPresentationBasis = Object.freeze({
      metadata:Object.freeze({ descriptiveFacts:Object.freeze({ entries:Object.freeze([
        Object.freeze({ key:'title', value:'Example Movie' }),
        Object.freeze({ key:'year', value:'2025' }),
        Object.freeze({ key:'plot', value:'Plot' }),
        Object.freeze({ key:'genre', value:'Drama' }),
      ]) }) }),
      cast:Object.freeze([Object.freeze({ role:'actor', displayName:'Actor One', providerIdentities:Object.freeze([]) })]),
      identity:Object.freeze({ provider:'tmdb', providerKey:'123' }),
    });
    const recoveryRequest = { ...request, finalInventoryDecision,
      replaySettledSources:true, nfoPresentationBasis, observedAtMs:19 };
    const unauthorizedSlot = port.prepareSlot(recoveryRequest);
    await assert.rejects(port.stage({ ...recoveryRequest,
      targetCommitSlotHandle:unauthorizedSlot }),
    (error) => error.code === 'CLEAN_ARCA_STAGE_TARGET_OCCUPIED');

    const recoveredRequest = { ...recoveryRequest,
      priorPlacementReceipt:placementReceipt };
    const recoveredSlot = port.prepareSlot(recoveredRequest);
    const recoveredManifest = await port.stage({ ...recoveredRequest,
      targetCommitSlotHandle:recoveredSlot });
    const recoveredNfo = recoveredManifest.stagedMembers.find(
      (item) => item.role === 'metadata_sidecar');
    assert.equal(fs.existsSync(path.join(recoveredSlot.slotDirectory,
      path.basename(nfoTarget))), false);
    assert.equal(recoveredNfo.physicalIdentity.contentFingerprint,
      identity(nfoTarget, mountScopeId).contentFingerprint);
    const recoveredVerification = await port.verifyStaged({ ...recoveredRequest,
      stagedInventoryManifest:recoveredManifest });
    await port.switchPlacement({ ...recoveredRequest,
      stagedInventoryVerification:recoveredVerification,
      targetBindings:{ bindingSetDigest:'semantic-target-bindings' },
      replacedInputSetDigest:'semantic-replaced-inputs' });
    assert.deepEqual(fs.readFileSync(nfoTarget), embyRewrite);

    const finalReality = await port.readFinalAsync({ ...request, finalInventoryDecision,
      replaySettledSources:true, nfoPresentationBasis, observedAtMs:20 });
    const nfoReality = finalReality.members.find((item) => item.role === 'metadata_sidecar');
    assert.equal(nfoReality.verificationKind, 'readable_nfo');
    assert.notEqual(nfoReality.physicalIdentity.contentFingerprint, packageNfoIdentity.contentFingerprint);
    assert.equal(nfoReality.physicalIdentity.contentFingerprint, identity(nfoTarget, mountScopeId).contentFingerprint);
    assert.equal(finalReality.memberEvidence.find((item) => item.role === 'primary_payload').verificationKind,
      'exact_package_identity');

    const checkpointFingerprints = new Set([nfoReality.physicalIdentity.contentFingerprint]);
    for (const [checkpoint, observedAtMs] of [
      ['after_final_verify', 21],
      ['after_settlement', 22],
      ['after_fulfillment', 23],
    ]) {
      const checkpointBytes = Buffer.from(embyRewrite.toString('utf8')
        .replace('</movie>', `<shelfdeck_external_checkpoint>${checkpoint}</shelfdeck_external_checkpoint></movie>`));
      fs.writeFileSync(nfoTarget, checkpointBytes);
      const checkpointReality = await port.readFinalAsync({ ...request, finalInventoryDecision,
        replaySettledSources:true, nfoPresentationBasis, observedAtMs });
      const checkpointNfo = checkpointReality.members.find((item) => item.role === 'metadata_sidecar');
      assert.equal(checkpointNfo.physicalIdentity.contentFingerprint,
        identity(nfoTarget, mountScopeId).contentFingerprint);
      assert.equal(checkpointReality.memberEvidence.find((item) => item.role === 'metadata_sidecar').observedAtMs,
        observedAtMs);
      checkpointFingerprints.add(checkpointNfo.physicalIdentity.contentFingerprint);
    }
    assert.equal(checkpointFingerprints.size, 4);

    fs.writeFileSync(nfoTarget, Buffer.from(embyRewrite.toString('utf8').replaceAll('123', '999')));
    await port.readFinalAsync({ ...request, finalInventoryDecision, replaySettledSources:true, nfoPresentationBasis, observedAtMs:24 });
    fs.writeFileSync(nfoTarget, Buffer.from('<movie><title>Example Movie</title><year>2025</year><genre>Drama</genre><tmdbid>123</tmdbid><actor><name>Actor One</name></actor></movie>'));
    await port.readFinalAsync({ ...request, finalInventoryDecision, replaySettledSources:true, nfoPresentationBasis, observedAtMs:25 });
    fs.writeFileSync(nfoTarget,Buffer.alloc(0));
    await assert.rejects(port.readFinalAsync({ ...request, finalInventoryDecision, replaySettledSources:true, observedAtMs:25 }),error=>error.code==='CLEAN_ARCA_FINAL_NFO_UNREADABLE');
    fs.writeFileSync(nfoTarget, embyRewrite);
    fs.writeFileSync(primaryTarget, Buffer.from('changed-primary-bytes'));
    await assert.rejects(port.readFinalAsync({ ...request, finalInventoryDecision, replaySettledSources:true,
      nfoPresentationBasis, observedAtMs:26 }), (error) => error.code === 'CLEAN_ARCA_FINAL_REALITY_DRIFT');
    const strictPrimarySlot = port.prepareSlot(recoveredRequest);
    await assert.rejects(port.stage({ ...recoveredRequest,
      targetCommitSlotHandle:strictPrimarySlot }),
    (error) => error.code === 'CLEAN_ARCA_STAGE_TARGET_OCCUPIED');
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('staged NFO presentation differences do not block Placement', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-arca-staged-nfo-semantic-'));
  try {
    const targetRoot = path.join(root, 'shelf');
    const workspaceRoot = path.join(root, '.workspace');
    const workspaceId = 'semantic-drift-workspace';
    fs.mkdirSync(targetRoot, { recursive:true });
    fs.mkdirSync(path.join(workspaceRoot, workspaceId, 'product'), { recursive:true });
    const primarySource = path.join(workspaceRoot, workspaceId, 'product', 'movie.mkv');
    const nfoSource = path.join(workspaceRoot, workspaceId, 'product', 'movie.nfo');
    fs.writeFileSync(primarySource, Buffer.from('movie-bytes'));
    fs.writeFileSync(nfoSource, Buffer.from(
      '<movie><title>人生密密缝</title><year>2017</year><plot>Plot</plot><genre>Family</genre><genre>Drama</genre><tmdbid>428733</tmdbid><actor><name>Toma Ikuta</name><tmdbid>228072</tmdbid></actor></movie>'));
    const mountScopeId = 'canary-mount';
    const packageValue = Object.freeze({
      onDeckPackageId:'package-staged-semantic-drift', shelfId:'shelf-1',
      resolvedIdentitySnapshot:{ factValue:{ title:'人生密密缝' } },
      productStructureSnapshot:{ structureKind:'single' },
      productMaterialManifest:{ manifestDigest:'manifest-staged-semantic-drift', members:Object.freeze([
        member(primarySource, 'primary_payload', mountScopeId,
          { workspaceId, relativePath:'product/movie.mkv' }),
        member(nfoSource, 'metadata_sidecar', mountScopeId,
          { workspaceId, relativePath:'product/movie.nfo' }),
      ]) },
      offloadContextManifest:{ manifestDigest:'offload-staged-semantic-drift', members:Object.freeze([]) },
    });
    const shelf = Object.freeze({
      shelfId:'shelf-1', status:'active', currentPlacementRevision:1,
      target:{ endpointId:'canary', rootLocation:targetRoot, mountScopeId, mountScopeRevision:1 },
      placement:{ value:{ folderTemplate:'{title}' } },
    });
    const nfoPresentationBasis = Object.freeze({
      metadata:Object.freeze({ descriptiveFacts:Object.freeze({ entries:Object.freeze([
        Object.freeze({ key:'title', value:'人生密密缝' }),
        Object.freeze({ key:'year', value:'2017' }),
        Object.freeze({ key:'plot', value:'Plot' }),
        Object.freeze({ key:'genre', value:'Family' }),
      ]) }) }),
      cast:Object.freeze([Object.freeze({ role:'actor', displayName:'Toma Ikuta',
        providerIdentities:Object.freeze([{ provider:'tmdb', namespace:'tmdb_person', providerKey:'228072' }]) })]),
      identity:Object.freeze({ provider:'tmdb', providerKey:'428733' }),
    });
    const port = createCleanArcaInventoryPort({ schemaManifest, unitOfWork:{}, workspaceRoot });
    const request = { onDeckRunId:'on-deck-staged-semantic-drift', custodyId:'custody-staged-semantic-drift',
      shelf, onDeckProductPackage:packageValue, observedAtMs:1, replayCommitted:false,
      nfoPresentationBasis };
    const finalInventoryDecision = port.prepare(request);
    const targetCommitSlotHandle = port.prepareSlot({ ...request, finalInventoryDecision });
    const stagedInventoryManifest = await port.stage({ ...request, finalInventoryDecision, targetCommitSlotHandle });
    await port.verifyStaged({ ...request, finalInventoryDecision, stagedInventoryManifest });
    assert.equal(fs.existsSync(targetCommitSlotHandle.targetDirectory), false,
      'Verification does not create the final target');
    assert.equal(fs.existsSync(targetCommitSlotHandle.slotDirectory), true);
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('same-root Stage/Switch replaces managed source bytes occupying the final name', async () => {
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
    let copyAttempts = 0;
    const port = createCleanArcaInventoryPort({
      schemaManifest, unitOfWork:{}, workspaceRoot,
      copyFile:async (...args) => {
        copyAttempts += 1;
        if (copyAttempts === 1) {
          await fs.promises.writeFile(args[1], Buffer.from('partial'), { flag:'wx' });
          throw new Error('simulated async copy interruption');
        }
        return fs.promises.copyFile(...args);
      },
    });
    const request = {
      onDeckRunId:'on-deck-1', custodyId:'custody-1', shelf,
      onDeckProductPackage:packageValue, observedAtMs:1, replayCommitted:false,
    };
    const finalInventoryDecision = port.prepare(request);
    const targetCommitSlotHandle = port.prepareSlot({ ...request, finalInventoryDecision });
    await assert.rejects(
      port.stage({ ...request, finalInventoryDecision, targetCommitSlotHandle }),
      /simulated async copy interruption/,
    );
    assert.deepEqual(
      fs.readdirSync(targetCommitSlotHandle.slotDirectory)
        .filter((name) => name.includes('.tmp-')),
      [],
    );
    const stagedManifest = await port.stage({ ...request, finalInventoryDecision, targetCommitSlotHandle });
    const stagedInventoryVerification = await port.verifyStaged({
      ...request, finalInventoryDecision, stagedInventoryManifest:stagedManifest,
    });
    await port.switchPlacement({
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

test('Stage Result stays below the Foundation 64 KiB bound with many subtitle members', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'clean-arca-bounded-stage-'));
  try {
    const inputs=path.join(root,'inputs');
    const targetRoot=path.join(root,'target');
    fs.mkdirSync(inputs);fs.mkdirSync(targetRoot);
    const mountScopeId='canary-mount';
    const locations=[];
    for(let index=0;index<61;index+=1){
      const extension=index===0?'.mkv':'.'+String(index).padStart(2,'0')+'.zh-CN.srt';
      const location=path.join(inputs,'A Chinese Ghost Story 2 (1990) - 1080p AVC DTS'+extension);
      fs.writeFileSync(location,Buffer.from('member-'+index));
      locations.push(member(location,index===0?'primary_payload':'subtitle',mountScopeId));
    }
    const shelf=Object.freeze({shelfId:'shelf-bounded',status:'active',currentPlacementRevision:1,
      target:{endpointId:'canary',rootLocation:targetRoot,mountScopeId,mountScopeRevision:1},
      placement:{value:{folderTemplate:'{title} ({year})',collisionPolicy:'reject'}}});
    const packageValue=Object.freeze({onDeckPackageId:'package-bounded',shelfId:'shelf-bounded',
      resolvedIdentitySnapshot:{factValue:{title:'倩女幽魂2',year:1990}},productStructureSnapshot:{structureKind:'single'},
      productMaterialManifest:{members:Object.freeze(locations),manifestDigest:canonicalDigest('bounded-manifest')},
      offloadContextManifest:{manifestDigest:canonicalDigest('bounded-offload'),members:Object.freeze([])}});
    const port=createCleanArcaInventoryPort({schemaManifest,unitOfWork:{},workspaceRoot:path.join(root,'.workspace')});
    const request={onDeckRunId:'on-deck-bounded',custodyId:'custody-bounded',shelf,onDeckProductPackage:packageValue,
      observedAtMs:1,replayCommitted:false};
    const finalInventoryDecision=port.prepare(request);
    const targetCommitSlotHandle=port.prepareSlot({...request,finalInventoryDecision});
    const manifest=await port.stage({...request,finalInventoryDecision,targetCommitSlotHandle});
    assert.equal(manifest.stagedMembers.length,61);
    assert.ok(Buffer.byteLength(JSON.stringify(manifest))<=65536);
    for(const staged of manifest.stagedMembers){
      assert.equal(Object.hasOwn(staged,'materialKey'),false);
      assert.equal(Object.hasOwn(staged,'digestHex'),false);
      assert.equal(Object.hasOwn(staged,'sizeBytes'),false);
      assert.equal(staged.physicalIdentity.materialKey.length,64);
    }
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('same-root settlement removes only the fenced source and retains unrelated shelf members', async () => {
  const syncFixture = settlementFixture({
    sameRoot:true, siblingDirectory:true, unknownMember:true,
  });
  try {
    const result = syncFixture.port.settleInput({
      materialHandle:syncFixture.materialHandle,
      approval:{ approvalId:'approval' },
      finalInventoryRequest:syncFixture.finalInventoryRequest,
      finalMaterialKey:syncFixture.finalMember.sourceMaterialKey,
      finalTargetLocation:syncFixture.finalMember.targetLocation,
      settlementExpectation:'replace_or_move',
      sourceToFinalMappingDigest:syncFixture.mappingDigest,
    });
    assert.equal(result.disposition, 'settled_to_final');
    assert.equal(fs.existsSync(syncFixture.source), false);
    assert.equal(fs.existsSync(path.join(syncFixture.sourceDirectory, 'notes.txt')), true);
    assert.equal(fs.existsSync(path.join(syncFixture.sourceDirectory,
      '养蜂人 (2024) - 2160p HEVC Atmos TrueHD5.1')), true);
    assert.equal(fs.readFileSync(syncFixture.finalMember.targetLocation, 'utf8'),
      'exact-movie-bytes');
  } finally {
    fs.rmSync(syncFixture.root, { recursive:true, force:true });
  }

  const asyncFixture = settlementFixture({
    sameRoot:true, siblingDirectory:true, unknownMember:true,
  });
  try {
    const result = await asyncFixture.port.settleInputAsync({
      materialHandle:asyncFixture.materialHandle,
      approval:{ approvalId:'approval' },
      finalInventoryRequest:asyncFixture.finalInventoryRequest,
      finalMaterialKey:asyncFixture.finalMember.sourceMaterialKey,
      finalTargetLocation:asyncFixture.finalMember.targetLocation,
      settlementExpectation:'replace_or_move',
      sourceToFinalMappingDigest:asyncFixture.mappingDigest,
    });
    assert.equal(result.disposition, 'settled_to_final');
    assert.equal(fs.existsSync(asyncFixture.source), false);
    assert.equal(fs.existsSync(path.join(asyncFixture.sourceDirectory, 'notes.txt')), true);
    assert.equal(fs.existsSync(path.join(asyncFixture.sourceDirectory,
      '养蜂人 (2024) - 2160p HEVC Atmos TrueHD5.1')), true);
    assert.equal(fs.readFileSync(asyncFixture.finalMember.targetLocation, 'utf8'),
      'exact-movie-bytes');
  } finally {
    fs.rmSync(asyncFixture.root, { recursive:true, force:true });
  }
});

function settlementFixture({
  unknownMember = false,
  siblingDirectory = false,
  sameRoot = false,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-arca-settlement-'));
  const sourceDirectory = path.join(root, 'opaque-source');
  const targetRoot = sameRoot ? sourceDirectory : path.join(root, 'shelf');
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

function prepareDiscSettlement(root, selected, extraOffload = []) {
  fs.mkdirSync(root, { recursive:true });
  const mountScopeId = 'canary-mount';
  const productMember = member(selected, 'primary_payload', mountScopeId);
  const mappingDigest = canonicalDigest({ source:productMember.materialKey, target:'final' });
  const offloadMembers = [
    Object.freeze({
      materialKey:productMember.materialKey,
      finalProductMaterialKey:productMember.materialKey,
      location:selected,
      settlementExpectation:'remove_after_place',
      sourceToFinalMappingDigest:mappingDigest,
    }),
    ...extraOffload,
  ];
  const packageValue = Object.freeze({
    onDeckPackageId:'package-bdmv', shelfId:'shelf-bdmv',
    resolvedIdentitySnapshot:{ factValue:{ title:'The Beekeeper', year:2024 } },
    productStructureSnapshot:{ structureKind:'single' },
    productMaterialManifest:{ members:Object.freeze([productMember]), manifestDigest:'manifest-bdmv' },
    offloadContextManifest:{ manifestDigest:'offload-bdmv', members:Object.freeze(offloadMembers) },
  });
  const shelf = Object.freeze({
    shelfId:'shelf-bdmv', status:'active', currentPlacementRevision:1,
    target:{ endpointId:'canary', rootLocation:root, mountScopeId, mountScopeRevision:1 },
    placement:{ value:{
      folderTemplate:'{title} ({year})', primaryTemplate:'{title} ({year}){ext}',
      nfoTemplate:'{stem}.nfo', posterTemplate:'poster{ext}', fanartTemplate:'fanart{ext}',
      subtitleTemplate:'{stem}{language}{ext}', collisionPolicy:'reject',
    } },
  });
  const port = createCleanArcaInventoryPort({
    schemaManifest, unitOfWork:{}, workspaceRoot:path.join(root, '.workspace'),
  });
  const finalInventoryRequest = {
    onDeckRunId:'on-deck-bdmv', custodyId:'custody-bdmv', shelf,
    onDeckProductPackage:packageValue, observedAtMs:1, replayCommitted:true,
  };
  const finalInventoryDecision = port.prepare(finalInventoryRequest);
  finalInventoryRequest.finalInventoryDecision = finalInventoryDecision;
  const finalMember = finalInventoryDecision.members[0];
  fs.mkdirSync(path.dirname(finalMember.targetLocation), { recursive:true });
  fs.copyFileSync(selected, finalMember.targetLocation);
  return {
    port, finalInventoryRequest, finalMember, mappingDigest, productMember,
    materialHandle:{
      schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',
      ownerDomain:'arca',
      ownerScope:{ scopeType:'on_deck_custody', scopeId:'custody-bdmv' },
      location:selected,
      identity:productMember.physicalIdentity,
      expectedSizeBytes:productMember.physicalIdentity.sizeBytes,
    },
  };
}

function writeDiscTree(discRoot, { extra = true, certificate = true, structural = false } = {}) {
  const selected = path.join(discRoot, 'BDMV', 'STREAM', '00002.m2ts');
  fs.mkdirSync(path.dirname(selected), { recursive:true });
  fs.writeFileSync(selected, Buffer.from('exact-movie-bytes'));
  const extraClip = path.join(discRoot, 'BDMV', 'STREAM', '00000.m2ts');
  if (extra) fs.writeFileSync(extraClip, Buffer.from('other-clip'));
  const certificateFile = path.join(discRoot, 'CERTIFICATE', 'id.bdmv');
  if (certificate) {
    fs.mkdirSync(path.join(discRoot, 'CERTIFICATE', 'BACKUP'), { recursive:true });
    fs.writeFileSync(certificateFile, Buffer.from('cert'));
    fs.writeFileSync(path.join(discRoot, 'CERTIFICATE', 'BACKUP', 'id.bdmv'),
      Buffer.from('cert-backup'));
  }
  const indexFile = path.join(discRoot, 'BDMV', 'index.bdmv');
  if (structural) fs.writeFileSync(indexFile, Buffer.from('index'));
  return { selected, extraClip, certificateFile, indexFile };
}

test('BDMV settlement preserves unapproved STREAM, CERTIFICATE and directories', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-arca-bdmv-disc-'));
  try {
    const discRoot = path.join(root, 'source-disc');
    const tree = writeDiscTree(discRoot);
    const prepared = prepareDiscSettlement(path.join(root, 'shelf'), tree.selected);
    const settled = prepared.port.settleInput({
      materialHandle:prepared.materialHandle,
      approval:{ approvalId:'approval' },
      finalInventoryRequest:prepared.finalInventoryRequest,
      finalMaterialKey:prepared.finalMember.sourceMaterialKey,
      finalTargetLocation:prepared.finalMember.targetLocation,
      settlementExpectation:'remove_after_place',
      sourceToFinalMappingDigest:prepared.mappingDigest,
    });
    assert.equal(settled.disposition, 'settled_to_final');
    assert.equal(fs.existsSync(tree.selected), false);
    assert.equal(fs.existsSync(tree.extraClip), true);
    assert.equal(fs.existsSync(tree.certificateFile), true);
    assert.equal(fs.existsSync(path.join(discRoot, 'BDMV')), true);
    assert.equal(fs.existsSync(path.join(discRoot, 'CERTIFICATE')), true);
    assert.equal(fs.existsSync(discRoot), true);
    assert.equal(fs.readFileSync(prepared.finalMember.targetLocation, 'utf8'),
      'exact-movie-bytes');
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('BDMV settlement preserves other managed structural files and unplanned members', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-arca-bdmv-managed-'));
  try {
    const discRoot = path.join(root, 'source-disc');
    const tree = writeDiscTree(discRoot, { structural:true });
    const structuralIdentity = identity(tree.indexFile, 'canary-mount');
    const prepared = prepareDiscSettlement(path.join(root, 'shelf'), tree.selected, [
      Object.freeze({
        materialKey:structuralIdentity.materialKey,
        finalProductMaterialKey:structuralIdentity.materialKey,
        location:tree.indexFile,
        settlementExpectation:'remove_after_place',
        sourceToFinalMappingDigest:canonicalDigest({ source:structuralIdentity.materialKey, target:'structural' }),
      }),
    ]);
    const settled = prepared.port.settleInput({
      materialHandle:prepared.materialHandle,
      approval:{ approvalId:'approval' },
      finalInventoryRequest:prepared.finalInventoryRequest,
      finalMaterialKey:prepared.finalMember.sourceMaterialKey,
      finalTargetLocation:prepared.finalMember.targetLocation,
      settlementExpectation:'remove_after_place',
      sourceToFinalMappingDigest:prepared.mappingDigest,
    });
    assert.equal(settled.disposition, 'settled_to_final');
    assert.equal(fs.existsSync(tree.selected), false);
    assert.equal(fs.existsSync(tree.extraClip), true);
    assert.equal(fs.existsSync(tree.certificateFile), true);
    assert.equal(fs.existsSync(path.join(discRoot, 'CERTIFICATE')), true);
    assert.equal(fs.existsSync(tree.indexFile), true);
    assert.equal(fs.readFileSync(tree.indexFile, 'utf8'), 'index');
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('BDMV settlement preserves the nested disc folder and sibling movie', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-arca-bdmv-nested-'));
  try {
    const titleDirectory = path.join(root, '养蜂人 (2024)');
    const nestedDisc = path.join(titleDirectory, '养蜂人 (2024) - 2160p HEVC Atmos TrueHD5.1');
    const siblingMovie = path.join(titleDirectory, '养蜂人 (2024).mkv');
    fs.mkdirSync(titleDirectory, { recursive:true });
    fs.writeFileSync(siblingMovie, Buffer.from('sibling-mkv'));
    const tree = writeDiscTree(nestedDisc);
    const prepared = prepareDiscSettlement(root, tree.selected);
    const settled = prepared.port.settleInput({
      materialHandle:prepared.materialHandle,
      approval:{ approvalId:'approval' },
      finalInventoryRequest:prepared.finalInventoryRequest,
      finalMaterialKey:prepared.finalMember.sourceMaterialKey,
      finalTargetLocation:prepared.finalMember.targetLocation,
      settlementExpectation:'remove_after_place',
      sourceToFinalMappingDigest:prepared.mappingDigest,
    });
    assert.equal(settled.disposition, 'settled_to_final');
    assert.equal(fs.existsSync(nestedDisc), true);
    assert.equal(fs.existsSync(path.join(nestedDisc, 'BDMV')), true);
    assert.equal(fs.existsSync(siblingMovie), true);
    assert.equal(fs.readFileSync(siblingMovie, 'utf8'), 'sibling-mkv');
    assert.equal(fs.existsSync(titleDirectory), true);
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('same-root BDMV settlement preserves out-of-scope trees and the final directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-arca-bdmv-same-root-'));
  try {
    const productDirectory = path.join(root, 'The Beekeeper (2024)');
    const tree = writeDiscTree(productDirectory);
    const prepared = prepareDiscSettlement(root, tree.selected);
    const settled = prepared.port.settleInput({
      materialHandle:prepared.materialHandle,
      approval:{ approvalId:'approval' },
      finalInventoryRequest:prepared.finalInventoryRequest,
      finalMaterialKey:prepared.finalMember.sourceMaterialKey,
      finalTargetLocation:prepared.finalMember.targetLocation,
      settlementExpectation:'remove_after_place',
      sourceToFinalMappingDigest:prepared.mappingDigest,
    });
    assert.equal(settled.disposition, 'settled_to_final');
    assert.equal(fs.existsSync(tree.extraClip), true);
    assert.equal(fs.existsSync(path.join(productDirectory, 'BDMV')), true);
    assert.equal(fs.existsSync(path.join(productDirectory, 'CERTIFICATE')), true);
    assert.equal(fs.existsSync(productDirectory), true);
    assert.equal(fs.readFileSync(prepared.finalMember.targetLocation, 'utf8'),
      'exact-movie-bytes');
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('same-root settlement keeps leftover extras in the retained final directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-arca-same-root-extras-'));
  try {
    const targetDirectory = path.join(root, 'The Beekeeper (2024)');
    fs.mkdirSync(targetDirectory, { recursive:true });
    const source = path.join(targetDirectory, 'clip.m2ts');
    const extra = path.join(targetDirectory, 'banner.jpg');
    fs.writeFileSync(source, Buffer.from('exact-movie-bytes'));
    fs.writeFileSync(extra, Buffer.from('banner-bytes'));
    const mountScopeId = 'canary-mount';
    const productMember = member(source, 'primary_payload', mountScopeId);
    const mappingDigest = canonicalDigest({ source:productMember.materialKey, target:'final' });
    const packageValue = Object.freeze({
      onDeckPackageId:'package-extras', shelfId:'shelf-extras',
      resolvedIdentitySnapshot:{ factValue:{ title:'The Beekeeper', year:2024 } },
      productStructureSnapshot:{ structureKind:'single' },
      productMaterialManifest:{ members:Object.freeze([productMember]), manifestDigest:'manifest-extras' },
      offloadContextManifest:{ manifestDigest:'offload-extras', members:Object.freeze([
        Object.freeze({
          materialKey:productMember.materialKey,
          finalProductMaterialKey:productMember.materialKey,
          location:source,
          settlementExpectation:'remove_after_place',
          sourceToFinalMappingDigest:mappingDigest,
        }),
      ]) },
    });
    const shelf = Object.freeze({
      shelfId:'shelf-extras', status:'active', currentPlacementRevision:1,
      target:{ endpointId:'canary', rootLocation:root, mountScopeId, mountScopeRevision:1 },
      placement:{ value:{
        folderTemplate:'{title} ({year})', primaryTemplate:'{title} ({year}){ext}',
        nfoTemplate:'{stem}.nfo', posterTemplate:'poster{ext}', fanartTemplate:'fanart{ext}',
        subtitleTemplate:'{stem}{language}{ext}', collisionPolicy:'reject',
      } },
    });
    const port = createCleanArcaInventoryPort({
      schemaManifest, unitOfWork:{}, workspaceRoot:path.join(root, '.workspace'),
    });
    const finalInventoryRequest = {
      onDeckRunId:'on-deck-extras', custodyId:'custody-extras', shelf,
      onDeckProductPackage:packageValue, observedAtMs:1, replayCommitted:true,
    };
    const finalInventoryDecision = port.prepare(finalInventoryRequest);
    finalInventoryRequest.finalInventoryDecision = finalInventoryDecision;
    const finalMember = finalInventoryDecision.members[0];
    fs.copyFileSync(source, finalMember.targetLocation);
    const settled = port.settleInput({
      materialHandle:{
        schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',
        ownerDomain:'arca',
        ownerScope:{ scopeType:'on_deck_custody', scopeId:'custody-extras' },
        location:source,
        identity:productMember.physicalIdentity,
        expectedSizeBytes:productMember.physicalIdentity.sizeBytes,
      },
      approval:{ approvalId:'approval' },
      finalInventoryRequest,
      finalMaterialKey:finalMember.sourceMaterialKey,
      finalTargetLocation:finalMember.targetLocation,
      settlementExpectation:'remove_after_place',
      sourceToFinalMappingDigest:mappingDigest,
    });
    assert.equal(settled.disposition, 'settled_to_final');
    assert.equal(fs.existsSync(source), false);
    assert.equal(fs.existsSync(extra), true);
    assert.equal(fs.readFileSync(finalMember.targetLocation, 'utf8'), 'exact-movie-bytes');
    assert.equal(fs.readFileSync(extra, 'utf8'), 'banner-bytes');
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('different-path settlement verifies the final copy and retains the empty source directory', () => {
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
    assert.equal(result.oldDirectoryDisposition, 'retained_directory');
    assert.equal(fs.existsSync(fixture.source), false);
    assert.equal(fs.existsSync(fixture.sourceDirectory), true);
    assert.equal(fs.readFileSync(fixture.finalMember.targetLocation, 'utf8'), 'exact-movie-bytes');
  } finally {
    fs.rmSync(fixture.root, { recursive:true, force:true });
  }
});

for (const asynchronous of [false,true]) {
  test('file-scoped settlement retains unrelated versions and directories ('+(asynchronous?'async':'sync')+')', async () => {
    const fixture=settlementFixture({unknownMember:true,siblingDirectory:true});
    try {
      const other=path.join(fixture.sourceDirectory,'another-version.mkv');
      fs.writeFileSync(other,'independent procurement candidate');
      const notes=path.join(fixture.sourceDirectory,'notes.txt');
      const before=fs.readFileSync(notes);
      const command={materialHandle:fixture.materialHandle,approval:{approvalId:'approval'},
        finalInventoryRequest:fixture.finalInventoryRequest,finalMaterialKey:fixture.finalMember.sourceMaterialKey,
        finalTargetLocation:fixture.finalMember.targetLocation,settlementExpectation:'replace_or_move',
        sourceToFinalMappingDigest:fixture.mappingDigest};
      const method=asynchronous?'settleInputAsync':'settleInput';
      const result=await fixture.port[method](command);
      assert.equal(result.finalVerified,true);
      assert.equal(result.oldDirectoryDisposition,'retained_directory');
      assert.equal(fs.existsSync(fixture.source),false);
      assert.equal(fs.readFileSync(other,'utf8'),'independent procurement candidate');
      assert.deepEqual(fs.readFileSync(notes),before);
      assert.equal(fs.existsSync(path.join(fixture.sourceDirectory,'养蜂人 (2024) - 2160p HEVC Atmos TrueHD5.1')),true);
      assert.equal((await fixture.port[method](command)).absent,true);
    } finally { fs.rmSync(fixture.root,{recursive:true,force:true}); }
  });
  test('file-scoped settlement still rejects changed source identity ('+(asynchronous?'async':'sync')+')', async () => {
    const fixture=settlementFixture({unknownMember:true});
    try {
      fs.writeFileSync(fixture.source,'different source reality');
      const command={materialHandle:fixture.materialHandle,approval:{approvalId:'approval'},
        finalInventoryRequest:fixture.finalInventoryRequest,finalMaterialKey:fixture.finalMember.sourceMaterialKey,
        finalTargetLocation:fixture.finalMember.targetLocation,settlementExpectation:'replace_or_move',
        sourceToFinalMappingDigest:fixture.mappingDigest};
      await assert.rejects(async()=>fixture.port[asynchronous?'settleInputAsync':'settleInput'](command),
        error=>error.code==='CLEAN_ARCA_SETTLEMENT_REALITY_DRIFT');
      assert.equal(fs.readFileSync(fixture.source,'utf8'),'different source reality');
      assert.equal(fs.existsSync(path.join(fixture.sourceDirectory,'notes.txt')),true);
    } finally { fs.rmSync(fixture.root,{recursive:true,force:true}); }
  });
}

test('Target Commit Slot is a hidden sibling and restores Emby-mutated presentation from Package source', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-arca-hidden-slot-'));
  try {
    const workspaceRoot = path.join(root, '.workspace');
    const workspaceId = 'run-workspace';
    fs.mkdirSync(path.join(workspaceRoot, workspaceId, 'product'), { recursive:true });
    const productPrimary = path.join(workspaceRoot, workspaceId, 'product', 'movie.mkv');
    const productNfo = path.join(workspaceRoot, workspaceId, 'product', 'movie.nfo');
    fs.writeFileSync(productPrimary, Buffer.from('movie-bytes'));
    fs.writeFileSync(productNfo, Buffer.from('package-nfo-bytes'));
    const mountScopeId = 'canary-mount';
    const productMembers = [
      member(productPrimary, 'primary_payload', mountScopeId,
        { workspaceId, relativePath:'product/movie.mkv' }),
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
    assert.match(path.basename(targetCommitSlotHandle.slotDirectory),
      /^\.shelfdeck-stage-[0-9a-f]{16}$/);
    assert.equal(path.dirname(targetCommitSlotHandle.slotDirectory), root);
    const stagedManifest = await port.stage({
      ...request, finalInventoryDecision, targetCommitSlotHandle,
    });
    const stagedNfo = path.join(targetCommitSlotHandle.slotDirectory, 'Example Movie.nfo');
    fs.writeFileSync(stagedNfo, Buffer.from('emby-rewrote-nfo'));
    const stagedInventoryVerification = await port.verifyStaged({
      ...request, finalInventoryDecision, stagedInventoryManifest:stagedManifest,
    });
    assert.equal(fs.readFileSync(stagedNfo, 'utf8'), 'package-nfo-bytes');
    await port.switchPlacement({
      ...request, finalInventoryDecision, stagedInventoryVerification,
      targetBindings:{ bindingSetDigest:'bindings-1' }, replacedInputSetDigest:'inputs-1',
    });
    assert.equal(fs.existsSync(targetCommitSlotHandle.slotDirectory), false);
    assert.equal(
      fs.readFileSync(path.join(root, 'Example Movie', 'Example Movie.nfo'), 'utf8'),
      'package-nfo-bytes',
    );
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('in-flight legacy Target Commit Slot remains addressable until Switch', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-arca-legacy-slot-'));
  try {
    const workspaceRoot = path.join(root, '.workspace');
    const workspaceId = 'run-workspace';
    fs.mkdirSync(path.join(workspaceRoot, workspaceId, 'product'), { recursive:true });
    const productPrimary = path.join(workspaceRoot, workspaceId, 'product', 'movie.mkv');
    const productNfo = path.join(workspaceRoot, workspaceId, 'product', 'movie.nfo');
    fs.writeFileSync(productPrimary, Buffer.from('movie-bytes'));
    fs.writeFileSync(productNfo, Buffer.from('package-nfo-bytes'));
    const mountScopeId = 'canary-mount';
    const productMembers = [
      member(productPrimary, 'primary_payload', mountScopeId,
        { workspaceId, relativePath:'product/movie.mkv' }),
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
    const hiddenHandle = port.slotHandle({ ...request, finalInventoryDecision });
    const suffix = path.basename(hiddenHandle.slotDirectory).replace(/^\.shelfdeck-stage-/, '');
    const legacyDirectory = hiddenHandle.targetDirectory + '.shelfdeck-stage-' + suffix;
    fs.mkdirSync(legacyDirectory, { recursive:true });
    const liveHandle = port.slotHandle({ ...request, finalInventoryDecision });
    assert.equal(liveHandle.slotDirectory, legacyDirectory);
    const stagedManifest = await port.stage({
      ...request, finalInventoryDecision, targetCommitSlotHandle:liveHandle,
    });
    fs.writeFileSync(path.join(legacyDirectory, 'Example Movie.nfo'), Buffer.from('emby-rewrote-nfo'));
    const stagedInventoryVerification = await port.verifyStaged({
      ...request, finalInventoryDecision, stagedInventoryManifest:stagedManifest,
    });
    await port.switchPlacement({
      ...request, finalInventoryDecision, stagedInventoryVerification,
      targetBindings:{ bindingSetDigest:'bindings-1' }, replacedInputSetDigest:'inputs-1',
    });
    assert.equal(fs.existsSync(legacyDirectory), false);
    assert.equal(
      fs.readFileSync(path.join(root, 'Example Movie', 'Example Movie.nfo'), 'utf8'),
      'package-nfo-bytes',
    );
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

for (const method of ['settleInput', 'settleInputAsync', 'switchPlacement']) for (const sameRoot of (method === 'switchPlacement' ? [true] : [false, true])) {
  for (const change of ['inplace', 'atomic', 'title', 'identity', 'missing-basis', 'unmapped']) {
    test(`NFO settlement ${method} sameRoot=${sameRoot} preserves reference facts: ${change}`, async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nfo-source-continuity-'));
      try {
        const targetRoot = path.join(root, 'shelf'), targetDirectory = path.join(targetRoot, 'Example');
        const sourceDirectory = sameRoot ? targetDirectory : path.join(root, 'source');
        fs.mkdirSync(sourceDirectory, {recursive:true}); fs.mkdirSync(targetDirectory, {recursive:true});
        const source = path.join(sourceDirectory, method === 'switchPlacement' ? 'Example.nfo' : 'legacy.nfo');
        const original = '<movie><title>Example</title><year>2025</year><tmdbid>123</tmdbid><genre>Drama</genre></movie>';
        fs.writeFileSync(source, original);
        const sourceIdentity = identity(source, 'mount');
        const sourceNfoSemantics = observeNfoReferenceSemantics(Buffer.from(original));
        const observationBody = {sourceKind:'related_nfo',sourceRef:'ref-nfo',sourceNfoSemantics};
        const sourceNfoObservation = {...observationBody,payloadDigest:canonicalDigest(observationBody)};
        const workspace = path.join(root, 'product');fs.mkdirSync(workspace);
        const primary = path.join(workspace, 'Example.mkv'), productNfo = path.join(workspace, 'movie.nfo');
        fs.writeFileSync(primary, 'video');
        const finalXml = original.replace('</movie>', '<plot>Enriched plot</plot></movie>');
        fs.writeFileSync(productNfo, finalXml);
        const primaryMember = member(primary, 'primary_payload', 'mount');
        const nfoMember = member(productNfo, 'metadata_sidecar', 'mount');
        const sourceMember = {materialKey:sourceIdentity.materialKey,physicalIdentity:sourceIdentity,
          contextRole:'related_input',sourceRelatedReferenceId:'ref-nfo',location:source,
          finalProductMaterialKey:nfoMember.materialKey,sourceNfoObservation};
        if (change === 'missing-basis') sourceMember.sourceNfoObservation = null;
        if (change === 'unmapped') sourceMember.contextRole = 'original_input';
        const packageValue = {onDeckPackageId:'package',shelfId:'shelf',resolvedIdentitySnapshot:{factValue:{title:'Example'}},
          productStructureSnapshot:{structureKind:'single'},productMaterialManifest:{members:[primaryMember,nfoMember],manifestDigest:'manifest'},
          offloadContextManifest:{members:[sourceMember],manifestDigest:'offload'},
          productionProvenance:{sourceNfoObservations:change === 'missing-basis' ? [] : [sourceNfoObservation]}};
        const shelf = {shelfId:'shelf',status:'active',currentPlacementRevision:1,
          target:{endpointId:'local',rootLocation:targetRoot,mountScopeId:'mount',mountScopeRevision:1},
          placement:{value:{folderTemplate:'{title}'}}};
        const port = createCleanArcaInventoryPort({schemaManifest,unitOfWork:{},workspaceRoot:workspace});
        const finalInventoryRequest = {onDeckRunId:'run',custodyId:'custody',shelf,onDeckProductPackage:packageValue,
          observedAtMs:1,replayCommitted:method !== 'switchPlacement',nfoPresentationBasis:{metadata:{entries:[{key:'title',value:'Example'},
            {key:'year',value:'2025'},{key:'plot',value:'Enriched plot'},{key:'genre',value:'Drama'}]},cast:{relations:[]},
            identity:{provider:'tmdb',providerKey:'123'}}};
        const decision = port.prepare(finalInventoryRequest);finalInventoryRequest.finalInventoryDecision = decision;
        for (const item of decision.members) {
          if (method === 'switchPlacement' && item.sourceMaterialKey === nfoMember.materialKey) continue;
          fs.copyFileSync(item.sourceMaterialKey === nfoMember.materialKey ? productNfo : primary, item.targetLocation);
        }
        const target = decision.members.find((item) => item.sourceMaterialKey === nfoMember.materialKey);
        let placementRequest = null;
        if (method === 'switchPlacement') {
          assert.equal(target.targetLocation,source);
          const targetCommitSlotHandle = port.prepareSlot(finalInventoryRequest);
          const stagedInventoryManifest = await port.stage({...finalInventoryRequest,targetCommitSlotHandle});
          const stagedInventoryVerification = await port.verifyStaged({...finalInventoryRequest,stagedInventoryManifest});
          placementRequest = {...finalInventoryRequest,stagedInventoryVerification,targetBindings:{bindingSetDigest:'bindings'},replacedInputSetDigest:'inputs'};
        }
        let rewritten = original.replace('<title>Example</title>', '<title><![CDATA[Example]]></title>')
          .replace('</movie>', '<genre>Drama</genre><dateadded>2026-09-05</dateadded></movie>');
        if (change === 'title') rewritten = rewritten.replace('CDATA[Example]', 'CDATA[Wrong movie]');
        if (change === 'identity') rewritten = rewritten.replace('<tmdbid>123', '<tmdbid>999');
        if (change === 'atomic') {fs.writeFileSync(source + '.tmp', rewritten);fs.renameSync(source + '.tmp', source);}
        else fs.writeFileSync(source, rewritten);
        const currentIdentity = identity(source, 'mount');
        const request = {materialHandle:{schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',ownerDomain:'arca',
          ownerScope:{scopeType:'on_deck_custody',scopeId:'custody'},location:source,identity:sourceIdentity,expectedSizeBytes:sourceIdentity.sizeBytes},
          approval:{approvalId:'approval'},finalInventoryRequest,finalMaterialKey:nfoMember.materialKey,
          finalTargetLocation:target.targetLocation,settlementExpectation:'remove_after_place',sourceToFinalMappingDigest:'mapping'};
        if (placementRequest) {
          if (['inplace','atomic'].includes(change)) {
            await port.switchPlacement(placementRequest);
            assert.equal(fs.readFileSync(source,'utf8'),finalXml);
          } else {
            await assert.rejects(port.switchPlacement(placementRequest),{code:'CLEAN_ARCA_TARGET_OCCUPIED'});
            assert.equal(fs.readFileSync(source,'utf8'),rewritten);
          }
          return;
        }
        if (['inplace','atomic'].includes(change)) {
          const result = await port[method](request);
          assert.equal(result.disposition,'settled_to_final');assert.equal(fs.existsSync(source),false);
          assert.equal(result.preDeleteIdentityDigest,canonicalDigest(currentIdentity));
          const recovered = await port[method](request);
          assert.equal(recovered.disposition,'settled_to_final');
          assert.equal(recovered.preDeleteIdentityDigest,null,'recovery must not invent the deleted physical version');
        } else {
          await assert.rejects(async () => port[method](request), {code:'CLEAN_ARCA_SETTLEMENT_REALITY_DRIFT'});
          assert.equal(fs.readFileSync(source,'utf8'),rewritten);
        }
        assert.equal(fs.readFileSync(target.targetLocation,'utf8'),finalXml);
      } finally {fs.rmSync(root,{recursive:true,force:true});}
    });
  }
}

test('UAT-172 async settlement rechecks Owner approval after file observations and before deletion', async () => {
  const fixture=settlementFixture({unknownMember:true});
  try {
    let checks=0;
    const before=fs.readFileSync(fixture.source);
    await assert.rejects(fixture.port.settleInputAsync({
      materialHandle:fixture.materialHandle,approval:{approvalId:'approval'},
      finalInventoryRequest:fixture.finalInventoryRequest,finalMaterialKey:fixture.finalMember.sourceMaterialKey,
      finalTargetLocation:fixture.finalMember.targetLocation,settlementExpectation:'replace_or_move',
      sourceToFinalMappingDigest:fixture.mappingDigest,
      assertCurrentApproval(location){
        assert.equal(location,fixture.source);
        if(++checks===2)throw Object.assign(new Error('Standing authorization was revoked during the observations.'),{code:'ARCA_ONDECK_SETTLEMENT_APPROVAL_STALE'});
      },
    }),error=>error.code==='ARCA_ONDECK_SETTLEMENT_APPROVAL_STALE');
    assert.equal(checks,2);
    assert.deepEqual(fs.readFileSync(fixture.source),before);
    assert.equal(fs.readFileSync(fixture.finalMember.targetLocation,'utf8'),'exact-movie-bytes');
    assert.ok(fs.existsSync(path.join(fixture.sourceDirectory,'notes.txt')));
  }finally{fs.rmSync(fixture.root,{recursive:true,force:true});}
});

for (const method of ['settleInput', 'settleInputAsync']) {
  test(`UAT-134 same-root settlement reopens safely after deletion with ${method}`, async () => {
    const fixture = settlementFixture({sameRoot:true, siblingDirectory:true, unknownMember:true});
    try {
      const notes = path.join(fixture.sourceDirectory, 'notes.txt');
      const sibling = path.join(fixture.sourceDirectory, '养蜂人 (2024) - 2160p HEVC Atmos TrueHD5.1', 'BDMV', 'STREAM', '00000.m2ts');
      const otherVersion = path.join(fixture.sourceDirectory, 'another-version.mkv');
      fs.writeFileSync(otherVersion, 'independent complete version');
      const protectedFiles = [notes, sibling, otherVersion];
      const before = protectedFiles.map(location => fs.readFileSync(location));
      const command = {materialHandle:fixture.materialHandle, approval:{approvalId:'approval'},
        finalInventoryRequest:fixture.finalInventoryRequest,
        finalMaterialKey:fixture.finalMember.sourceMaterialKey,
        finalTargetLocation:fixture.finalMember.targetLocation,
        settlementExpectation:'replace_or_move', sourceToFinalMappingDigest:fixture.mappingDigest};
      assert.equal((await fixture.port[method](command)).finalVerified, true);
      const reopened = createCleanArcaInventoryPort({schemaManifest, unitOfWork:{},
        workspaceRoot:path.join(fixture.root, '.workspace')});
      const replay = await reopened[method](command);
      assert.equal(replay.absent, true);
      assert.equal(replay.finalVerified, true);
      assert.equal(fs.existsSync(fixture.source), false);
      for (let i=0; i<protectedFiles.length; i++) assert.deepEqual(fs.readFileSync(protectedFiles[i]), before[i]);
      assert.equal(fs.readFileSync(fixture.finalMember.targetLocation, 'utf8'), 'exact-movie-bytes');
    } finally { fs.rmSync(fixture.root, {recursive:true, force:true}); }
  });
}

for (const changedBytes of [false, true]) {
  test(`UAT-158 Stage distinguishes timestamp-only changes from content drift: ${changedBytes}`, async () => {
    const fixture = settlementFixture();
    try {
      fs.rmSync(fixture.finalMember.targetLocation);
      let touchedWhileSampling = 0;
      const {computeBoundedMaterialFingerprint} = require('../src/helix/integrations/bounded-material-fingerprint');
      const port = createCleanArcaInventoryPort({schemaManifest, unitOfWork:{}, workspaceRoot:path.join(fixture.root, '.workspace'),
        computeFingerprint(location) {
          return computeBoundedMaterialFingerprint(location, {onRead() {
            if (!location.includes('.tmp-')) return;
            const stat = fs.statSync(location);
            fs.utimesSync(location, stat.atime, new Date(stat.mtimeMs + 10000));
            touchedWhileSampling++;
          }});
        },
        async copyFile(source, target, flags) {
          await fs.promises.copyFile(source, target, flags);
          const copyTime = new Date('2021-01-01T00:00:00Z');
          await fs.promises.utimes(target, copyTime, copyTime);
        }});
      const request = {...fixture.finalInventoryRequest, replayCommitted:false};
      const before = fs.readFileSync(fixture.source);
      const oldTime = new Date('2020-01-01T00:00:00Z');
      fs.utimesSync(fixture.source, oldTime, oldTime);
      const targetCommitSlotHandle = port.prepareSlot(request);
      if (changedBytes) fs.writeFileSync(fixture.source, Buffer.alloc(before.length, 88));
      if (changedBytes) {
        await assert.rejects(port.stage({...request, targetCommitSlotHandle}),
          error => error.code === 'CLEAN_ARCA_PRODUCT_SOURCE_DRIFT');
        assert.equal(fs.existsSync(fixture.finalMember.targetLocation), false);
        assert.deepEqual(fs.readFileSync(fixture.source), Buffer.alloc(before.length, 88));
      } else {
        const stagedInventoryManifest = await port.stage({...request, targetCommitSlotHandle});
        assert.equal(stagedInventoryManifest.stagedMembers.length, 1);
        assert.ok(touchedWhileSampling > 0, 'The copied temporary file must be touched during actual fingerprint sampling.');
        const stagedInventoryVerification = await port.verifyStaged({...request, stagedInventoryManifest});
        await port.switchPlacement({...request, stagedInventoryVerification,
          targetBindings:{bindingSetDigest:'uat158-bindings'}, replacedInputSetDigest:'uat158-inputs'});
        assert.deepEqual(fs.readFileSync(fixture.finalMember.targetLocation), before);
        assert.deepEqual(fs.readFileSync(fixture.source), before);
        assert.notEqual(fs.statSync(fixture.finalMember.targetLocation).mtimeMs, fs.statSync(fixture.source).mtimeMs);
        assert.equal(fs.existsSync(targetCommitSlotHandle.slotDirectory), false);
      }
    } finally { fs.rmSync(fixture.root, {recursive:true, force:true}); }
  });
}

for (const method of ['settleInput', 'settleInputAsync']) for (const inputKind of ['payload', 'index']) {
  test(`exact BDMV ${method} settles ${inputKind}, preserves neighbors and replays absent input`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arca-exact-disc-'));
    try {
      const disc = path.join(root, 'disc');
      const tree = writeDiscTree(disc, {structural:true});
      for (const name of ['BACKUP/index.bdmv', 'META/DL/info.xml', 'index.nfo']) {
        const file = path.join(disc, 'BDMV', name);
        fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, 'unapproved');
      }
      const source = inputKind === 'payload' ? tree.selected : tree.indexFile;
      const prepared = prepareDiscSettlement(path.join(root, 'shelf'), source);
      const calls = [];
      const command = {materialHandle:prepared.materialHandle, finalInventoryRequest:prepared.finalInventoryRequest,
        finalMaterialKey:prepared.finalMember.sourceMaterialKey, finalTargetLocation:prepared.finalMember.targetLocation,
        settlementExpectation:'remove_after_place', sourceToFinalMappingDigest:prepared.mappingDigest,
        assertCurrentApproval(location) { assert.equal(location, source); calls.push(location); }};
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const result = await prepared.port[method](command);
        assert.equal(result.absent, true); assert.equal(result.finalVerified, true);
        assert.equal(result.oldDirectoryDisposition, 'retained_directory');
      }
      assert.equal(calls.length, 4);
      assert.equal(fs.existsSync(source), false);
      assert.equal(fs.readFileSync(tree.extraClip, 'utf8'), 'other-clip');
      assert.equal(fs.readFileSync(tree.certificateFile, 'utf8'), 'cert');
      for (const name of ['BACKUP/index.bdmv', 'META/DL/info.xml', 'index.nfo'])
        assert.equal(fs.readFileSync(path.join(disc, 'BDMV', name), 'utf8'), 'unapproved');
      fs.writeFileSync(prepared.finalMember.targetLocation, 'drift');
      await assert.rejects(async () => prepared.port[method](command), /drift|match|verification/i);
    } finally { fs.rmSync(root, {recursive:true, force:true}); }
  });
}

for (const method of ['settleInput', 'settleInputAsync']) {
  test(`BDMV ${method} rechecks exact approval immediately before deletion`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arca-disc-revocation-'));
    try {
      const tree = writeDiscTree(path.join(root, 'disc'));
      const prepared = prepareDiscSettlement(path.join(root, 'shelf'), tree.selected);
      let checks = 0;
      await assert.rejects(async () => prepared.port[method]({materialHandle:prepared.materialHandle,
        finalInventoryRequest:prepared.finalInventoryRequest, finalMaterialKey:prepared.finalMember.sourceMaterialKey,
        finalTargetLocation:prepared.finalMember.targetLocation, settlementExpectation:'remove_after_place',
        sourceToFinalMappingDigest:prepared.mappingDigest, assertCurrentApproval(location) {
          assert.equal(location, tree.selected); if (++checks === 2) throw new Error('approval revoked');
        }}), /approval revoked/);
      assert.equal(checks, 2); assert.equal(fs.existsSync(tree.selected), true);
      assert.equal(fs.existsSync(tree.extraClip), true);
    } finally { fs.rmSync(root, {recursive:true, force:true}); }
  });
}

test('Stage target preflight produces a typed terminal outcome before any copy or custody write', async () => {
  const {createOnDeckCapabilityPorts} = require('../src/helix/domains/arca/capabilities/on-deck-capability-ports');
  const fixture = settlementFixture();
  try {
    const request = {...fixture.finalInventoryRequest, replayCommitted:false};
    const slot = fixture.port.slotHandle(request);
    fs.writeFileSync(fixture.finalMember.targetLocation, 'unrelated occupied target');
    const ports = createOnDeckCapabilityPorts({schemaManifest, unitOfWork:{execute() {throw new Error('unexpected custody write');}},
      contextReader:{readAccepted:() => ({shelf:request.shelf,packageValue:request.onDeckProductPackage,
        responsibility:{onDeckRunId:request.onDeckRunId,custodyId:request.custodyId},finalInventoryDecision:request.finalInventoryDecision})},
      workResultReader:{readBindings:() => [], listWorks:() => []}, inventoryPort:fixture.port});
    const execution = {ownerScope:{processType:'arca_ondeck_run',processId:request.onDeckRunId},
      namedInputs:{productMaterialHandleList:{},targetCommitSlotHandle:slot},workId:'work-stage'};
    const result = await ports[CAPABILITY_REFS.stage].execute(execution);
    assert.equal(result.kind, 'failed'); assert.equal(result.code, 'CLEAN_ARCA_STAGE_TARGET_OCCUPIED');
    assert.equal(result.retryDirective, 'never'); assert.equal(result.failureClass, 'stage_precondition');
    assert.deepEqual(result.evidence.diagnostics.unknownNames, [path.basename(fixture.finalMember.targetLocation)]);
    assert.equal(fs.existsSync(slot.slotDirectory), false);
    assert.equal(fs.readFileSync(fixture.finalMember.targetLocation, 'utf8'), 'unrelated occupied target');
    assert.equal(fs.existsSync(fixture.source), true);
    const unknown = new Error('copy outcome is unknown'); unknown.code = 'EIO';
    const uncertainPorts = createOnDeckCapabilityPorts({schemaManifest,unitOfWork:{execute() {throw new Error('unexpected write');}},
      contextReader:{readAccepted:() => ({shelf:request.shelf,packageValue:request.onDeckProductPackage,
        responsibility:{onDeckRunId:request.onDeckRunId,custodyId:request.custodyId}})},
      workResultReader:{readBindings:() => [],listWorks:() => []},inventoryPort:{stage:async () => {throw unknown;}}});
    await assert.rejects(uncertainPorts[CAPABILITY_REFS.stage].execute(execution), error => error === unknown);
  } finally { fs.rmSync(fixture.root, {recursive:true,force:true}); }
});

function seriesMultipleSettlementFixture(){
  const f=settlementFixture({unknownMember:true}),directory=path.join(path.dirname(f.finalMember.targetLocation),'Season 01');
  fs.mkdirSync(directory,{recursive:true});
  const products=[1,2].map(number=>{
    const location=path.join(directory,'E'+number+'.mkv');fs.writeFileSync(location,'episode-'+number);
    return {...member(location,'primary_payload','canary-mount'),controlOperation:'acquire_workspace_product',episodeClaims:[{episodeKey:'E'+String(number).padStart(3,'0')}]};
  }).sort((a,b)=>a.materialKey.localeCompare(b.materialKey));
  const finalTargets=products.map(item=>({materialKey:item.materialKey,targetLocation:item.location.location}));
  const source={materialKey:f.materialHandle.identity.materialKey,physicalIdentity:f.materialHandle.identity,
    location:f.source,contextRole:'original_input',sourceRelatedReferenceId:null,dispositionKind:'replaced_and_settled',
    settlementExpectation:'remove_after_place',finalProductMaterialKeys:finalTargets.map(item=>item.materialKey)};
  const old=f.finalInventoryRequest.onDeckProductPackage,packageValue={...old,
    resolvedIdentitySnapshot:{factValue:{...old.resolvedIdentitySnapshot.factValue,providerIdentities:[{namespace:'tmdb_series',seasonNumber:1}]}},
    productStructureSnapshot:{structureKind:'season'},productFactManifest:{items:[{factKind:'product_metadata',factValue:{episodeMetadata:[1,2].map(n=>({episodeScope:{episodeKey:'E'+String(n).padStart(3,'0'),seasonNumber:1,episodeNumber:n}}))}}]},
    productMaterialManifest:{...old.productMaterialManifest,members:products},offloadContextManifest:{members:[source]}};
  const command={materialHandle:f.materialHandle,approval:{approvalId:'approval'},finalTargets,
    settlementExpectation:'remove_after_place',sourceToFinalMappingDigest:canonicalDigest(source),
    finalInventoryRequest:{...f.finalInventoryRequest,onDeckProductPackage:packageValue,
      finalInventoryMembers:finalTargets.map(item=>({sourceMaterialKey:item.materialKey,targetLocation:item.targetLocation}))}};
  return {...f,command};
}
test('Series native settlement verifies all targets, deletes one source and replays the complete evidence',async()=>{
  const f=seriesMultipleSettlementFixture();
  try{
    let checks=0;f.command.assertCurrentApproval=()=>{checks++;};
    const result=await f.port.settleInputAsync(f.command);
    assert.equal(result.absent,true);assert.equal(checks,2);assert.equal(fs.existsSync(f.source),false);
    assert.deepEqual(result.finalTargets.map(item=>item.materialKey),f.command.finalTargets.map(item=>item.materialKey));
    assert.equal(result.finalTargets.length,2);assert.equal(Object.hasOwn(result,'finalMaterialKey'),false);
    const replay=await f.port.settleInputAsync(f.command);assert.equal(replay.finalRealityDigest,result.finalRealityDigest);
    assert.equal(replay.preDeleteIdentityDigest,null);assert.ok(fs.existsSync(path.join(f.sourceDirectory,'notes.txt')));
    const reopen=()=>require('node:child_process').spawnSync(process.execPath,['-e',
      "const {createCleanArcaInventoryPort}=require(process.argv[1]);const schemaManifest=require(process.argv[2]);const port=createCleanArcaInventoryPort({schemaManifest,unitOfWork:{},workspaceRoot:process.argv[3]});port.settleInputAsync(JSON.parse(process.argv[4])).then(value=>process.stdout.write(JSON.stringify(value))).catch(error=>{process.stderr.write(error.code||error.message);process.exitCode=1;});",
      path.resolve(__dirname,'../src/clean-arca-inventory-port.js'),path.resolve(__dirname,'../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),
      path.join(f.root,'.workspace'),JSON.stringify(f.command)],{encoding:'utf8',timeout:10000,windowsHide:true});
    const fresh=reopen();assert.equal(fresh.status,0,fresh.stderr);
    const recovered=JSON.parse(fresh.stdout);assert.equal(recovered.preDeleteIdentityDigest,null);
    assert.deepEqual(recovered.finalTargets,result.finalTargets);assert.equal(recovered.finalRealityDigest,result.finalRealityDigest);

    fs.writeFileSync(f.command.finalTargets[1].targetLocation,'changed');
    assert.equal(reopen().status,1);
    await assert.rejects(f.port.settleInputAsync(f.command));
  }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
for(const targetIndex of [0,1])for(const change of ['missing','changed','decision-missing','decision-duplicate'])test('Series native settlement preserves source on '+change+' target '+targetIndex,async()=>{
  const f=seriesMultipleSettlementFixture();
  try{
    const before=fs.readFileSync(f.source),target=f.command.finalTargets[targetIndex];
    if(change==='missing')fs.rmSync(target.targetLocation);
    if(change==='changed')fs.writeFileSync(target.targetLocation,'wrong episode bytes');
    if(change==='decision-missing')f.command.finalInventoryRequest.finalInventoryMembers.splice(targetIndex,1);
    if(change==='decision-duplicate')f.command.finalInventoryRequest.finalInventoryMembers.push(f.command.finalInventoryRequest.finalInventoryMembers[targetIndex]);
    await assert.rejects(f.port.settleInputAsync(f.command));assert.deepEqual(fs.readFileSync(f.source),before);
    assert.ok(fs.existsSync(path.join(f.sourceDirectory,'notes.txt')));
  }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('Series native settlement rejects revoked approval and mixed target cardinality before deletion',async()=>{
  const f=seriesMultipleSettlementFixture();
  try{
    const before=fs.readFileSync(f.source);let checks=0;
    f.command.assertCurrentApproval=()=>{if(++checks===2)throw new Error('revoked');};
    await assert.rejects(f.port.settleInputAsync(f.command),/revoked/);assert.deepEqual(fs.readFileSync(f.source),before);
    f.command.finalMaterialKey=f.command.finalTargets[0].materialKey;
    await assert.rejects(f.port.settleInputAsync(f.command),{code:'CLEAN_ARCA_SETTLEMENT_MAPPING_INVALID'});
    assert.throws(()=>f.port.settleInput(f.command),{code:'CLEAN_ARCA_SETTLEMENT_MAPPING_INVALID'});
    assert.deepEqual(fs.readFileSync(f.source),before);
  }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});

test('Series native settlement rejects a directory junction escaping final placement',async()=>{
  const f=seriesMultipleSettlementFixture();
  try{
    const target=f.command.finalTargets[0],outside=path.join(f.root,'outside'),link=path.join(path.dirname(target.targetLocation),'alias');
    fs.mkdirSync(outside);fs.copyFileSync(target.targetLocation,path.join(outside,'copy.mkv'));
    fs.symlinkSync(outside,link,'junction');
    target.targetLocation=path.join(link,'copy.mkv');
    f.command.finalInventoryRequest.finalInventoryMembers[0].targetLocation=target.targetLocation;
    const before=fs.readFileSync(f.source);
    await assert.rejects(f.port.settleInputAsync(f.command),{code:'CLEAN_ARCA_SETTLEMENT_MAPPING_DRIFT'});
    assert.deepEqual(fs.readFileSync(f.source),before);assert.ok(fs.existsSync(path.join(outside,'copy.mkv')));
  }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
