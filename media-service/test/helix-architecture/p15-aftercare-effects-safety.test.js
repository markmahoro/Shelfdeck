'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sharp = require('sharp');
const {
  AFTERCARE_LONG_MEDIA_TIMEOUT_MS,
  aftercareMediaProbeEvidence,
  progressSample,
  remainingDeadlineMs,
  validImageBytes,
  materializeArtifactWithRollback,
  materializeMediaWithRollback,
  nfoCommitSource,
  custodyIdentityChangedFinding,
} = require('../../src/helix/domains/arca/capabilities/aftercare-capability-ports');
const { hasIncompatibleRepairCombination } = require('../../src/helix/domains/arca/model/aftercare-contract');
const { readAftercarePlacementAuthority } = require('../../src/helix/domains/arca/capabilities/on-deck-capability-ports');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');

const sourceRoot = path.join(__dirname, '../../src/helix');

function boundedFingerprint(location) {
  const stat=fs.statSync(location),contentFingerprint=crypto.createHash('sha256').update(fs.readFileSync(location)).digest('hex');
  return Object.freeze({ stat,fingerprintAlgorithm:'sha256',fingerprintVersion:1,contentFingerprint });
}

function inventoryRow(location,mountScopeId='mount-1') {
  const bounded=boundedFingerprint(location),tuple={ mountScopeId,inode:String(bounded.stat.ino),sizeBytes:Number(bounded.stat.size),
    fingerprintAlgorithm:bounded.fingerprintAlgorithm,fingerprintVersion:bounded.fingerprintVersion,
    contentFingerprint:bounded.contentFingerprint };
  return Object.freeze({ material_key:canonicalDigest({ schema:'physical-material-identity@2',...tuple }) });
}

test('Aftercare poster qualification decodes image bytes instead of trusting magic bytes', async () => {
  const valid = await sharp({ create:{ width:2, height:2, channels:3, background:'#336633' } })
    .jpeg().toBuffer();
  const fakeJpeg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
  assert.equal(await validImageBytes(valid), true);
  assert.equal(await validImageBytes(fakeJpeg), false);
});

test('Aftercare assessment and rendering share the same existing NFO and poster classifiers', () => {
  const source = fs.readFileSync(path.join(sourceRoot,
    'domains/arca/capabilities/aftercare-capability-ports.js'), 'utf8');
  const planner = fs.readFileSync(path.join(sourceRoot,
    'domains/arca/planning/aftercare-planners.js'), 'utf8');
  const presentation = source.slice(source.indexOf('ports[C.presentation]'),
    source.indexOf('ports[C.conformance]'));
  const render = source.slice(source.indexOf('ports[C.textRender]'),
    source.indexOf('ports[C.binaryAcquire]'));
  assert.match(presentation, /existingMaterials\(c\.raw\.materials,isNfoMaterial\)/);
  assert.match(presentation, /existingMaterials\(c\.raw\.materials,isPosterMaterial\)/);
  assert.match(render, /selectedNfoMaterial\(c\.raw\.materials\)/);
  assert.doesNotMatch(render, /role===['"]metadata_sidecar['"]/);
  assert.match(planner, /custody:nfo_identity_changed/);
});

test('Aftercare progress samples use the exact Foundation determinate shape', () => {
  assert.deepEqual(progressSample(50, 100, 2, false), {
    mode:'determinate', currentValue:50, totalValue:100, unit:'microseconds',
    rate:2, etaMs:1, sourceSequence:null, progressBucket:'50', terminal:false,
  });
  assert.equal(progressSample(150, 100, null, true).currentValue, 100);
  assert.equal(progressSample(150, 100, null, true).progressBucket, 'completed');
});

test('Aftercare FFmpeg derives one bounded timer from the frozen Foundation deadline', () => {
  assert.equal(AFTERCARE_LONG_MEDIA_TIMEOUT_MS, 12 * 60 * 60 * 1000);
  assert.equal(remainingDeadlineMs(undefined, 1_000), AFTERCARE_LONG_MEDIA_TIMEOUT_MS);
  assert.equal(remainingDeadlineMs(5_000, 1_000), 4_000);
  assert.equal(remainingDeadlineMs(999, 1_000), 1);
});

test('Aftercare media evidence retains observed audio bitrate for bounded size planning', () => {
  const handle = Object.freeze({ handleId:'primary-1' });
  const value = aftercareMediaProbeEvidence({
    resultKind:'media', container:'matroska', durationMs:60_000,
    videoStreams:[], subtitleStreams:[],
    audioStreams:[{ streamIndex:1, dispositionDefault:true, codec:'aac', profile:'lc',
      channels:2, channelLayout:'stereo', formatTags:[], normalizedAudioClass:'aac',
      bitRateBps:192_000 }],
  }, handle, 1_000_000, 10_000);
  assert.equal(value.audioStreams[0].bitRateBps, 192_000);
  assert.equal(value.payloadDigest, canonicalDigest(Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'payloadDigest'))));
});

test('Aftercare Provider Artifact accepts bytes only behind the frozen response and Case fences', () => {
  const source = fs.readFileSync(path.join(sourceRoot,
    'domains/arca/capabilities/aftercare-capability-ports.js'), 'utf8');
  const acquire = source.slice(source.indexOf('ports[C.binaryAcquire]'),
    source.indexOf('ports[C.artifactMaterialize]'));
  assert.match(acquire, /response\.artifactKind!==['"]poster['"]/);
  assert.match(acquire, /response\.integrationId!==n\.integrationHandle\.integrationId/);
  assert.match(acquire, /response\.configRevision!==n\.integrationHandle\.configRevision/);
  assert.match(acquire, /canonicalDigest\(response\.resolvedProviderIdentity\)/);
  assert.doesNotMatch(acquire, /integrationHandle\.artifactKind/);
  assert.match(acquire, /code:'ARCA_AFTERCARE_PROVIDER_INPUT_STALE'/);
  assert.ok((acquire.match(/revalidateCaseAuthority\(execution,care\)/g) || []).length >= 2);
});

test('Aftercare treats exact NFO drift as repairable but keeps non-NFO drift behind attention', () => {
  const nfo=custodyIdentityChangedFinding({role:'metadata_sidecar',location:'F:/shelf/movie.nfo',material_key:canonicalDigest('old-nfo')}),
    subtitle=custodyIdentityChangedFinding({role:'subtitle',location:'F:/shelf/movie.srt',material_key:canonicalDigest('old-subtitle')}),
    primary=custodyIdentityChangedFinding({role:'primary_payload',location:'F:/shelf/movie.mkv',material_key:canonicalDigest('old-primary')});
  assert.match(nfo.schemaRef,/\/custody\/nfo_identity_changed\/critical\/auto_repair\//);
  assert.match(subtitle.schemaRef,/\/custody\/material_identity_changed\/critical\/attention_required\//);
  assert.match(primary.schemaRef,/\/custody\/primary_identity_changed\/critical\/attention_required\//);
});

test('Aftercare NFO commit accepts only the exact source observed during preparation', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aftercare-nfo-source-guard-'));
  try {
    const location=path.join(root,'movie.nfo');fs.writeFileSync(location,'<movie><title>edited once</title></movie>');
    const bounded=boundedFingerprint(location),tuple={mountScopeId:'mount-1',inode:String(bounded.stat.ino),sizeBytes:Number(bounded.stat.size),
      fingerprintAlgorithm:bounded.fingerprintAlgorithm,fingerprintVersion:bounded.fingerprintVersion,contentFingerprint:bounded.contentFingerprint},
      current={schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,materialKey:canonicalDigest({schema:'physical-material-identity@2',...tuple}),...tuple},
      context={basis:{digest:canonicalDigest('basis')}},output={provenanceRef:{digest:canonicalDigest({schema:'arca.aftercare-nfo-source-guard@1',careBasisDigest:context.basis.digest,sourceMaterialIdentity:current})}},
      frozen={material_key:canonicalDigest('old-inventory')},accepted=nfoCommitSource(context,output,location,frozen,'mount-1',boundedFingerprint);
    assert.equal(accepted.material.material_key,current.materialKey);
    assert.equal(accepted.supersededMaterialIdentity.materialKey,current.materialKey);
    fs.writeFileSync(location,'<movie><title>edited twice</title></movie>');
    assert.throws(()=>nfoCommitSource(context,output,location,frozen,'mount-1',boundedFingerprint),
      (error)=>error.code==='ARCA_AFTERCARE_NFO_SOURCE_STALE');
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('Aftercare media materialization is async and FFmpeg reports durable progress', () => {
  const source = fs.readFileSync(path.join(sourceRoot,
    'domains/arca/capabilities/aftercare-capability-ports.js'), 'utf8');
  const mediaCopy = source.slice(source.indexOf('async function atomicCopyMedia'),
    source.indexOf('function progressSample'));
  const materialize = source.slice(source.indexOf('ports[C.artifactMaterialize]'),
    source.indexOf('async function mediaEffect'));
  const ffmpeg = source.slice(source.indexOf('function runFfmpeg'),
    source.indexOf('function resolveAftercareFfmpegPath'));
  assert.match(mediaCopy, /fs\.promises\.copyFile/);
  assert.doesNotMatch(mediaCopy, /copyFileSync/);
  assert.match(materialize, /async execute/);
  assert.match(materialize, /await materializeMediaWithRollback/);
  assert.match(ffmpeg, /'-progress','pipe:1'/);
  assert.match(ffmpeg, /options\.reportProgress\(progressSample/);
});

test('Aftercare uses the registered workspace mount for handles and resource permits', () => {
  const capability = fs.readFileSync(path.join(sourceRoot,
    'domains/arca/capabilities/aftercare-capability-ports.js'), 'utf8');
  const composition = fs.readFileSync(path.join(sourceRoot,
    'composition/create-procurement-execution-runtime.js'), 'utf8');
  assert.match(capability, /store\.aftercareWorkspaceRootSnapshot/);
  assert.match(capability, /rootHandleRef:snapshot\.rootHandleRef/);
  assert.doesNotMatch(capability, /rootHandleRef:root\.replace/);
  assert.match(composition, /options\.aftercareWorkspaceMountScopeId/);
});

test('Startup Recovery completes before Outbox dispatch can enlarge execution scope', () => {
  const host = fs.readFileSync(path.join(__dirname, '../../src/clean-service-host.js'), 'utf8');
  const start = host.slice(host.indexOf('const executionRuntimeHost = Object.freeze'),
    host.indexOf('arcaCare=createArcaCareApplication'));
  assert.ok(start.indexOf('await procurementExecution.host.start()') <
    start.indexOf('await outboxDispatcher.start()'));
});

test('Aftercare fails closed for placement combined with any material repair but keeps single repairs automatic', () => {
  const finding=(findingKind)=>Object.freeze({ findingKind,repairability:'auto_repair' });
  for(const material of ['conformance:max_size_exceeded','presentation:nfo_update_required','presentation:poster_missing'])
    assert.equal(hasIncompatibleRepairCombination([finding('conformance:placement_unmet'),finding(material)]),true,material);
  assert.equal(hasIncompatibleRepairCombination([finding('conformance:placement_unmet')]),false);
  assert.equal(hasIncompatibleRepairCombination([finding('conformance:max_size_exceeded')]),false);
  const coordinator=fs.readFileSync(path.join(sourceRoot,'domains/arca/application/aftercare-process-coordinator.js'),'utf8'),
    reconcile=coordinator.slice(coordinator.indexOf('function reconcile('),coordinator.indexOf('function caseProgress('));
  assert.ok(reconcile.indexOf("if(disposition!=='auto_repair')return")<reconcile.indexOf('createCaseIfUnreserved('));
});

test('Aftercare Artifact materialization restores the exact old file when authority changes after copy', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aftercare-artifact-rollback-'));
  try {
    const source=path.join(root,'workspace.nfo'),location=path.join(root,'movie.nfo'),retiredLocation=location+'.superseded-case-1';
    fs.writeFileSync(source,'new-nfo');fs.writeFileSync(location,'old-nfo');const oldMaterial=inventoryRow(location);
    assert.throws(()=>materializeArtifactWithRollback({source,location,retiredLocation,oldMaterial,mountScopeId:'mount-1',
      fingerprint:boundedFingerprint,revalidate:()=>{throw Object.assign(new Error('fenced'),{code:'ARCA_AFTERCARE_EFFECT_FENCED'});}}),
    (error)=>error.code==='ARCA_AFTERCARE_EFFECT_FENCED');
    assert.equal(fs.readFileSync(location,'utf8'),'old-nfo');
    assert.equal(fs.existsSync(retiredLocation),false);
    assert.equal(fs.existsSync(location+'.aftercare-'+process.pid+'.tmp'),false);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('Aftercare Artifact materialization restores the exact old file when copy fails after retirement', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aftercare-artifact-copy-failure-'));
  try {
    const source=path.join(root,'workspace.jpg'),location=path.join(root,'poster.jpg'),retiredLocation=location+'.superseded-case-1';
    fs.writeFileSync(source,'new-poster');fs.writeFileSync(location,'old-poster');const oldMaterial=inventoryRow(location);
    assert.throws(()=>materializeArtifactWithRollback({source,location,retiredLocation,oldMaterial,mountScopeId:'mount-1',
      fingerprint:boundedFingerprint,revalidate:()=>{},copy:()=>{throw Object.assign(new Error('copy failed'),{code:'EIO'});}}),
    (error)=>error.code==='EIO');
    assert.equal(fs.readFileSync(location,'utf8'),'old-poster');
    assert.equal(fs.existsSync(retiredLocation),false);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('Aftercare media materialization revalidates after canonical effect and rolls back canonical, superseded, and staged state', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aftercare-media-rollback-'));
  try {
    const source=path.join(root,'workspace.mkv'),location=path.join(root,'movie.mkv'),
      supersededLocation=location+'.superseded-case-1',staged=location+'.staged-case-1';
    fs.writeFileSync(source,'new-media');fs.writeFileSync(location,'old-media');const oldMaterial=inventoryRow(location);let validations=0;
    await assert.rejects(materializeMediaWithRollback({source,location,supersededLocation,staged,oldMaterial,mountScopeId:'mount-1',
      fingerprint:boundedFingerprint,revalidate:()=>{validations+=1;if(validations===3)throw Object.assign(new Error('fenced'),{code:'ARCA_AFTERCARE_EFFECT_FENCED'});}}),
    (error)=>error.code==='ARCA_AFTERCARE_EFFECT_FENCED');
    assert.equal(validations,3);
    assert.equal(fs.readFileSync(location,'utf8'),'old-media');
    assert.equal(fs.existsSync(supersededLocation),false);
    assert.equal(fs.existsSync(staged),false);
    assert.equal(fs.existsSync(staged+'.copying'),false);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('Aftercare media materialization rolls back the exact state when the staged-to-canonical rename fails', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aftercare-media-rename-failure-'));
  try {
    const source=path.join(root,'workspace.mkv'),location=path.join(root,'movie.mkv'),
      supersededLocation=location+'.superseded-case-1',staged=location+'.staged-case-1';
    fs.writeFileSync(source,'new-media');fs.writeFileSync(location,'old-media');const oldMaterial=inventoryRow(location),rename=async (from,to)=>{
      if(path.resolve(from)===path.resolve(staged)&&path.resolve(to)===path.resolve(location))throw Object.assign(new Error('rename failed'),{code:'EIO'});
      return fs.promises.rename(from,to);
    };
    await assert.rejects(materializeMediaWithRollback({source,location,supersededLocation,staged,oldMaterial,mountScopeId:'mount-1',
      fingerprint:boundedFingerprint,revalidate:()=>{},rename}),(error)=>error.code==='EIO');
    assert.equal(fs.readFileSync(location,'utf8'),'old-media');
    assert.equal(fs.existsSync(supersededLocation),false);
    assert.equal(fs.existsSync(staged),false);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('Aftercare placement authority observed during staging fences a new reservation before switch or closure', async () => {
  let reserved=false,switched=false,closed=false;
  const basis=Object.freeze({ digest:'basis-1' }),care=Object.freeze({ aftercareCaseId:'case-1',state:'active',careBasisDigest:'basis-1' }),
    current=()=>Object.freeze({ shelfEntryId:'entry-1',basis,raw:Object.freeze({ shelf:Object.freeze({ status:'active' }),
      reservations:Object.freeze(reserved?[Object.freeze({ state:'active' })]:[]) }) }),options={ aftercareContextReader:{ read:current,
      store:{ history:()=>Object.freeze({ cases:Object.freeze([care]) }) } } },execution={ ownerScope:{ processType:'arca_shelf_entry',processId:'entry-1' } };
  assert.equal(readAftercarePlacementAuthority(options,execution).care.aftercareCaseId,'case-1');
  await Promise.resolve().then(()=>{reserved=true;});
  assert.throws(()=>readAftercarePlacementAuthority(options,execution,'case-1'),
    (error)=>error.code==='ARCA_AFTERCARE_MODIFICATION_FENCED');
  if(!reserved)switched=true;
  if(switched)closed=true;
  assert.equal(switched,false);
  assert.equal(closed,false);
  const source=fs.readFileSync(path.join(sourceRoot,'domains/arca/capabilities/on-deck-capability-ports.js'),'utf8'),
    stage=source.slice(source.indexOf('ports[C.stage]'),source.indexOf('ports[C.stagedVerify]')),
    inventorySource=fs.readFileSync(path.join(__dirname,'../../src/clean-arca-inventory-port.js'),'utf8'),
    inventoryStage=inventorySource.slice(inventorySource.indexOf('async function stage('),inventorySource.indexOf('async function verifyStaged('));
  assert.ok(stage.indexOf('await options.inventoryPort.stage')<stage.lastIndexOf('readAftercarePlacementAuthority'));
  assert.ok((inventoryStage.match(/requireContinuation\(request\)/g)||[]).length>=3);
});
