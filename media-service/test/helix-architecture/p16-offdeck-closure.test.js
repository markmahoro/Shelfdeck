'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { computeBoundedMaterialFingerprintSync } = require('../../src/helix/integrations/bounded-material-fingerprint');
const { createCleanOffdeckDeletionPort } = require('../../src/clean-offdeck-deletion-port');
const { createOffdeckContextReader } = require('../../src/helix/domains/arca/application/offdeck-context-reader');
const { createOffdeckCapabilityPorts } = require('../../src/helix/domains/arca/capabilities/offdeck-capability-ports');
const { CAPABILITY_REFS } = require('../../src/helix/domains/arca/model/offdeck-contract');
const { defaultPolicy, normalizePolicy, evaluateCondition, evaluateEntryPolicy, highVolumeDecision } =
  require('../../src/helix/domains/arca/model/offdeck-contract');
const schemaManifest = require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');

test('Off-deck Policy is disabled by default and preserves tri-state unknown', () => {
  const disabled = defaultPolicy(1);
  assert.equal(disabled.status, 'disabled');
  assert.equal(disabled.duplicateScheduleEnabled, false);
  assert.equal(evaluateEntryPolicy(disabled, { shelfId:'shelf-1' }).result, false);
  const active = normalizePolicy({ expectedRevision:1, idempotencyKey:'policy-2', status:'active',
    duplicateScheduleEnabled:true, entryRules:[{ shelfScope:'all', condition:{ kind:'all', conditions:[
      { kind:'retention_age', parameters:{ minimumAgeDays:30 } },
      { kind:'disliked_person', parameters:{ maximumPreferenceLevel:-1 } },
    ] } }] }, disabled, 2);
  assert.equal(evaluateEntryPolicy(active, { shelfId:'shelf-1', collectionAgeDays:40,
    peoplePreferences:null }).result, 'unknown');
  assert.equal(evaluateCondition(active.entryRules[0].condition, { collectionAgeDays:40,
    peoplePreferences:[{ preferenceLevel:-2 }] }), true);
});

test('Every Entry condition is closed over true, false, and unknown facts', () => {
  const cases = [
    [{ kind:'rating_and_collection_age', parameters:{ maxRating:2, minimumAgeDays:30 } },
      { rating:1, collectionAgeDays:31 }, { rating:5, collectionAgeDays:31 }, { rating:null, collectionAgeDays:31 }],
    [{ kind:'disliked_person', parameters:{ maximumPreferenceLevel:-1 } },
      { peoplePreferences:[{ preferenceLevel:-2 }] }, { peoplePreferences:[{ preferenceLevel:1 }] }, { peoplePreferences:null }],
    [{ kind:'unresolved_care', parameters:{ minimumAgeDays:7 } },
      { care:{ state:'attention_required', ageDays:8 } }, { care:{ state:'healthy', ageDays:8 } }, { care:null }],
    [{ kind:'retention_age', parameters:{ minimumAgeDays:365 } },
      { collectionAgeDays:366 }, { collectionAgeDays:20 }, { collectionAgeDays:undefined }],
  ];
  for (const [condition, truthy, falsy, unknown] of cases) {
    assert.equal(evaluateCondition(condition, truthy), true, condition.kind);
    assert.equal(evaluateCondition(condition, falsy), false, condition.kind);
    assert.equal(evaluateCondition(condition, unknown), 'unknown', condition.kind);
  }
});

test('High-volume authorization is recomputed from every closed threshold', () => {
  const base = { entryCount:1, primaryCount:1, totalBytes:1,
    shelfCoverageRatios:{ 'shelf-1':0.01 }, deckCoverageRatio:0.01 };
  assert.equal(highVolumeDecision(base).highVolume, false);
  for (const change of [
    { entryCount:10 },
    { primaryCount:50 },
    { totalBytes:100 * 1024 ** 3 },
    { entryCount:5, shelfCoverageRatios:{ 'shelf-1':0.2 } },
    { entryCount:5, deckCoverageRatio:0.1 },
  ]) assert.equal(highVolumeDecision({ ...base, ...change }).highVolume, true);
});

test('A 1024-member Off-deck Scope reads Foundation Control through bounded 500-key pages', () => {
  const calls = [];
  const reader = createOffdeckContextReader({ offdeckStore:{}, materialControlProjectionPort:{
    getMaterialControlProjections(keys) {
      calls.push(keys);
      return keys.map((materialKey) => ({ materialKey, resultKind:'not_found' }));
    },
  } });
  const keys = Array.from({ length:1024 }, (_, index) => index.toString(16).padStart(64, '0'));
  const result = reader.controlProjections(keys);
  assert.equal(result.length, 1024);
  assert.deepEqual(calls.map((items) => items.length), [500, 500, 24]);
  assert.ok(calls.every((items) => items.every((item, index) => index === 0 || items[index - 1] < item)));
});

test('Duplicate detection pages stay bounded and never split one strong Identity', () => {
  const entries = Array.from({ length:205 }, (_, index) => ({
    shelf_entry_id:`entry-${index.toString().padStart(3, '0')}`,
    current_inventory_revision:1,
    canonical_identity_key:`identity-${Math.floor(index / 5).toString().padStart(3, '0')}`,
    identity:{ identity_digest:canonicalDigest({ identity:Math.floor(index / 5) }) },
  }));
  const reader = createOffdeckContextReader({ offdeckStore:{ allEntryFacts:()=>entries },
    materialControlProjectionPort:{ getMaterialControlProjections:()=>[] } });
  const pages = reader.activeIdentityProjectionPages(100);
  assert.deepEqual(pages.map((page) => page.entries.length), [100, 100, 5]);
  const pageByIdentity = new Map();
  pages.forEach((page, pageIndex) => page.entries.forEach((entry) => {
    assert.equal(pageByIdentity.has(entry.digest) ? pageByIdentity.get(entry.digest) : pageIndex, pageIndex);
    pageByIdentity.set(entry.digest, pageIndex);
  }));
  assert.throws(() => createOffdeckContextReader({ offdeckStore:{ allEntryFacts:()=>
    Array.from({ length:101 }, (_, index) => ({ shelf_entry_id:`same-${index}`, current_inventory_revision:1,
      canonical_identity_key:'same', identity:{ identity_digest:'f'.repeat(64) } })) },
    materialControlProjectionPort:{ getMaterialControlProjections:()=>[] } }).activeIdentityProjectionPages(100),
  (error) => error?.code === 'ARCA_OFFDECK_DUPLICATE_GROUP_TOO_LARGE');
});

function materialHandle(root, relativeLocation) {
  const location = path.join(root, relativeLocation);
  const observed = computeBoundedMaterialFingerprintSync(location);
  const identityBasis = { schema:'physical-material-identity@2', mountScopeId:'test-mount',
    inode:String(observed.stat.ino), sizeBytes:Number(observed.stat.size),
    fingerprintAlgorithm:observed.fingerprintAlgorithm, fingerprintVersion:observed.fingerprintVersion,
    contentFingerprint:observed.contentFingerprint };
  const identity = Object.freeze({ schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2', schemaVersion:2,
    materialKey:canonicalDigest(identityBasis), mountScopeId:identityBasis.mountScopeId,
    inode:identityBasis.inode, sizeBytes:identityBasis.sizeBytes,
    fingerprintAlgorithm:identityBasis.fingerprintAlgorithm, fingerprintVersion:identityBasis.fingerprintVersion,
    contentFingerprint:identityBasis.contentFingerprint });
  const body = { schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1', schemaVersion:1,
    handleId:'test-handle', identity, ownerDomain:'arca', ownerScope:{ scopeType:'offdeck_case', scopeId:'case-1' },
    bindingRevision:1, endpointId:'test-endpoint', location:relativeLocation, mountScopeRevision:1,
    expectedSizeBytes:identity.sizeBytes, expectedMtimeNs:0, expectedCtimeNs:0,
    fingerprintVerifiedAtMs:1, readScope:'offdeck_exact_identity', expiresAtMs:Number.MAX_SAFE_INTEGER };
  return Object.freeze({ ...body, fenceDigest:canonicalDigest(body) });
}

const authorization = Object.freeze({ schemaRef:'helix://contracts/types/AuthorizationHandle/v1', schemaVersion:1,
  authorizationId:'auth-1', authorizationKind:'offdeck_destruction', ownerDomain:'arca' });

test('Filesystem destructive port deletes only the exact authorized identity and replays absence safely', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-offdeck-delete-'));
  try {
    fs.writeFileSync(path.join(root, 'movie.mkv'), Buffer.alloc(512 * 1024, 7));
    fs.writeFileSync(path.join(root, 'unscoped.keep'), 'keep', 'utf8');
    const handle = materialHandle(root, 'movie.mkv');
    const port = createCleanOffdeckDeletionPort();
    assert.equal(port.execute({ shelfTargetRoot:root, materialHandle:handle, authorization }).disposition, 'deleted');
    assert.equal(port.execute({ shelfTargetRoot:root, materialHandle:handle, authorization }).disposition,
      'authorized_identity_already_absent');
    assert.equal(fs.readFileSync(path.join(root, 'unscoped.keep'), 'utf8'), 'keep');
  } finally { fs.rmSync(root, { recursive:true, force:true }); }
});

test('A crash after the physical delete replays as exact authorized absence without a second delete', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-offdeck-crash-'));
  try {
    fs.writeFileSync(path.join(root, 'movie.mkv'), Buffer.alloc(512 * 1024, 11));
    const handle = materialHandle(root, 'movie.mkv');
    let physicalEffects = 0;
    const crashingPort = createCleanOffdeckDeletionPort({ afterPhysicalEffect() {
      physicalEffects += 1;
      const error = new Error('Injected crash after exact filesystem delete.');
      error.code = 'INJECTED_OFFDECK_CRASH';
      throw error;
    } });
    assert.throws(() => crashingPort.execute({ shelfTargetRoot:root, materialHandle:handle, authorization }),
      (error) => error?.code === 'INJECTED_OFFDECK_CRASH');
    assert.equal(fs.existsSync(path.join(root, 'movie.mkv')), false);
    const recovered = createCleanOffdeckDeletionPort().execute({ shelfTargetRoot:root,
      materialHandle:handle, authorization });
    assert.equal(recovered.disposition, 'authorized_identity_already_absent');
    assert.equal(physicalEffects, 1);
  } finally { fs.rmSync(root, { recursive:true, force:true }); }
});

function deletionCapabilityFixture(root, relativeLocation, remainingReferences) {
  const handle = materialHandle(root, relativeLocation), evidence = [];
  const scopeRow = Object.freeze({ destruction_scope_id:'scope-1', ordinal:0,
    material_key:handle.identity.materialKey, related_reference_id:'related-1' });
  const material = Object.freeze({ ordinal:0, materialKey:handle.identity.materialKey,
    relatedReferenceId:'related-1', materialHandle:handle, scopeRow,
    deleteCondition:'release_related_then_delete_if_unreferenced' });
  const context = Object.freeze({ basisDigest:'a'.repeat(64), case:Object.freeze({
    offdeck_case_id:'case-1', shelf_entry_id:'entry-1' }), authorization:Object.freeze({
    authorizationId:'auth-1' }), scope:Object.freeze({ destruction_scope_id:'scope-1',
    scope_digest:'b'.repeat(64) }), snapshot:Object.freeze({ shelf:Object.freeze({
    target_root_location:root }) }), materials:Object.freeze([material]) });
  const store = Object.freeze({
    activeReferenceCount() { return remainingReferences.value; },
    recordEvidence(value) { evidence.push(value); return value; },
  });
  const reader = Object.freeze({ store, read() { return context; }, releasedRelatedReferenceIds() { return new Set(); } });
  const ports = createOffdeckCapabilityPorts({ schemaManifest,
    unitOfWork:{ execute() { return {}; } }, contextReader:reader,
    offdeckDeletionPort:createCleanOffdeckDeletionPort(), now:() => 10 });
  return { handle, ports, evidence };
}

test('Related material is retained while another active Entry references it and deleted after the last release', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-offdeck-related-'));
  try {
    fs.writeFileSync(path.join(root, 'shared.srt'), Buffer.alloc(256 * 1024, 13));
    const remainingReferences = { value:1 };
    const fixture = deletionCapabilityFixture(root, 'shared.srt', remainingReferences);
    const releaseExecution = Object.freeze({ eventId:'release-1', idempotencyKey:'release-key',
      ownerScope:Object.freeze({ processId:'case-1' }), namedInputs:Object.freeze({
        relatedReference:Object.freeze({ referenceId:'related-1' }),
        domainFactCommitHandle:Object.freeze({}),
      }) });
    const firstRelease = fixture.ports[CAPABILITY_REFS.relatedRelease].execute(releaseExecution).result;
    const deleteExecution = (releaseResult, eventId) => Object.freeze({ eventId,
      idempotencyKey:eventId + '-key', ownerScope:Object.freeze({ processId:'case-1' }),
      namedInputs:Object.freeze({ unreferencedRelatedHandle:fixture.handle,
        referenceReleaseResult:releaseResult, destructiveAuthorization:authorization }) });
    const retained = fixture.ports[CAPABILITY_REFS.relatedDelete].execute(
      deleteExecution(firstRelease, 'related-delete-retained')).result;
    assert.equal(retained.disposition, 'retained_due_to_active_reference');
    assert.equal(fs.existsSync(path.join(root, 'shared.srt')), true);

    remainingReferences.value = 0;
    const lastRelease = fixture.ports[CAPABILITY_REFS.relatedRelease].execute({
      ...releaseExecution, eventId:'release-2', idempotencyKey:'release-key-2' }).result;
    const deleted = fixture.ports[CAPABILITY_REFS.relatedDelete].execute(
      deleteExecution(lastRelease, 'related-delete-final')).result;
    assert.equal(deleted.disposition, 'deleted');
    assert.equal(fs.existsSync(path.join(root, 'shared.srt')), false);
    assert.deepEqual(fixture.evidence.map((item) => item.result),
      ['retained_due_to_active_reference', 'deleted']);
  } finally { fs.rmSync(root, { recursive:true, force:true }); }
});

test('A shared Primary is rejected during Scope Verification before any destructive Event', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-offdeck-shared-primary-'));
  try {
    fs.writeFileSync(path.join(root, 'movie.mkv'), Buffer.alloc(256 * 1024, 17));
    const handle=materialHandle(root,'movie.mkv'),controlDigest='c'.repeat(64),scopeDigest='b'.repeat(64);
    const material=Object.freeze({ordinal:0,materialKey:handle.identity.materialKey,materialHandle:handle,
      deleteCondition:'exclusive_primary',scopeRow:Object.freeze({control_revision:3,
        control_projection_digest:controlDigest}),control:Object.freeze({resultKind:'available',controlRevision:3,
        projectionDigest:controlDigest,controlState:'controlled',ownerDomain:'arca',ownerScopeType:'shelf_entry',
        ownerScopeId:'entry-1'})});
    const context=Object.freeze({basisDigest:'a'.repeat(64),authorizationState:'active',
      case:Object.freeze({offdeck_case_id:'case-1',shelf_entry_id:'entry-1',state:'executing'}),
      authorization:Object.freeze({authorizationId:'auth-1'}),scope:Object.freeze({destruction_scope_id:'scope-1',
        scope_digest:scopeDigest,state:'authorized',inventory_revision:1}),snapshot:Object.freeze({
        entry:Object.freeze({status:'offdeck_in_progress',current_inventory_revision:1}),
        shelf:Object.freeze({target_root_location:root})}),materials:Object.freeze([material])});
    const store=Object.freeze({activeReferenceCount(){return 1;}}),reader=Object.freeze({store,
      read(){return context;},releasedRelatedReferenceIds(){return new Set();}}),ports=createOffdeckCapabilityPorts({
      schemaManifest,unitOfWork:{execute(){return {}; }},contextReader:reader,
      offdeckDeletionPort:createCleanOffdeckDeletionPort(),now:()=>10});
    const outcome=ports[CAPABILITY_REFS.scopeVerify].execute({eventId:'scope-check',idempotencyKey:'scope-key',
      ownerScope:Object.freeze({processId:'case-1'}),namedInputs:Object.freeze({destructionScope:Object.freeze({
        scopeDigest,inventoryRevision:1,memberCount:1,controlRevisionSetDigest:'d'.repeat(64),
        memberSetDigest:'e'.repeat(64)}),currentInventoryControl:Object.freeze({})})}).result;
    assert.equal(outcome.result,'failed');
    assert.deepEqual(outcome.reasonCodes,['primary_shared_invariant']);
    assert.equal(fs.existsSync(path.join(root,'movie.mkv')),true);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('Filesystem destructive port rejects a replacement identity at an authorized path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-offdeck-replaced-'));
  try {
    fs.writeFileSync(path.join(root, 'movie.mkv'), Buffer.alloc(512 * 1024, 7));
    const handle = materialHandle(root, 'movie.mkv');
    fs.writeFileSync(path.join(root, 'movie.mkv'), Buffer.alloc(512 * 1024, 9));
    assert.throws(() => createCleanOffdeckDeletionPort().execute({ shelfTargetRoot:root,
      materialHandle:handle, authorization }), (error) =>
      error?.code === 'ARCA_OFFDECK_AUTHORIZED_IDENTITY_REPLACED');
    assert.equal(fs.existsSync(path.join(root, 'movie.mkv')), true);
  } finally { fs.rmSync(root, { recursive:true, force:true }); }
});

test('Filesystem destructive inspection distinguishes endpoint outage from authorized absence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-offdeck-outage-'));
  try {
    fs.writeFileSync(path.join(root, 'movie.mkv'), Buffer.alloc(512 * 1024, 7));
    const handle = materialHandle(root, 'movie.mkv');
    fs.renameSync(root, root + '-offline');
    try {
      const inspection = createCleanOffdeckDeletionPort().inspect({ shelfTargetRoot:root,
        materialHandle:handle });
      assert.equal(inspection.disposition, 'endpoint_unavailable');
    } finally {
      fs.renameSync(root + '-offline', root);
    }
    fs.unlinkSync(path.join(root, 'movie.mkv'));
    assert.equal(createCleanOffdeckDeletionPort().inspect({ shelfTargetRoot:root,
      materialHandle:handle }).disposition, 'authorized_identity_already_absent');
  } finally { fs.rmSync(root, { recursive:true, force:true }); }
});

test('Off-deck coordinators stay above execution and filesystem implementations', () => {
  for (const file of ['offdeck-process-coordinator.js','offdeck-automation-coordinator.js']) {
    const source = fs.readFileSync(path.join(__dirname, '../../src/helix/domains/arca/application', file), 'utf8');
    for (const forbidden of ['clean-offdeck-deletion-port','capabilities/offdeck','event-runtime','resource-governor','executor-dispatcher','node:fs']) {
      assert.equal(source.includes(forbidden), false, `${file} imports ${forbidden}`);
    }
  }
});
