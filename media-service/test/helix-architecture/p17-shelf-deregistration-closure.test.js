'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { initializeCleanData } = require('../../scripts/helix-operational-safety');
const { createCleanServiceHost } = require('../../src/clean-service-host');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');

const SECRET = 'p17-shelf-deregistration-closure-secret-root';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const retainEvidence = process.env.HELIX_RETAIN_SHELF_DEREGISTRATION_E2E === '1';

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-shelf-deregistration-'));
  const dataDir = path.join(root, 'data');
  const adminDistDir = path.join(root, 'admin');
  const targetRoot = path.join(root, 'shelf-target');
  fs.mkdirSync(adminDistDir, { recursive:true });
  fs.mkdirSync(targetRoot, { recursive:true });
  fs.writeFileSync(path.join(adminDistDir, 'index.html'), '<div id="root"></div>');
  fs.writeFileSync(path.join(targetRoot, 'sentinel.keep'), 'unchanged');
  const initialized = initializeCleanData({ dataDir, confirmation:'INITIALIZE_HELIX_CLEAN_V1', secretRoot:SECRET });
  return Object.freeze({ root, dataDir, adminDistDir, targetRoot, initialized,
    databasePath:path.join(dataDir, 'shelfdeck.db') });
}

function seedRepresentativeShelfReality(root) {
  const files=new Map([
    ['movie/member-0','ordinary-primary-bytes'],['movie/member-1','ordinary-nfo-bytes'],
    ['movie/poster.jpg','ordinary-poster-bytes'],['movie/reference-0.srt','ordinary-subtitle-bytes'],
    ['disc/BDMV/index.bdmv','bdmv-index-bytes'],['disc/BDMV/PLAYLIST/00000.mpls','bdmv-playlist-bytes'],
    ['disc/BDMV/STREAM/00000.m2ts','bdmv-stream-bytes'],['disc/CERTIFICATE/id.bdmv','bdmv-certificate-bytes'],
  ]);
  for(const [relative,bytes] of files){const target=path.join(root,...relative.split('/'));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);}
}

function shelfReality(root) {
  const items=[];
  function visit(directory){for(const name of fs.readdirSync(directory).sort()){const absolute=path.join(directory,name),stat=fs.statSync(absolute);if(stat.isDirectory())visit(absolute);else items.push(Object.freeze({relativeLocation:path.relative(root,absolute).split(path.sep).join('/'),sizeBytes:stat.size,mtimeMs:stat.mtimeMs,contentDigest:canonicalDigest({bytes:fs.readFileSync(absolute).toString('base64')})}));}}
  visit(root);
  return Object.freeze({regularFileCount:items.length,items:Object.freeze(items),digest:canonicalDigest(items)});
}

async function session(host, apiKey) {
  const response = await host.inject({ method:'POST', url:'/v1/admin/session', headers:{ 'x-api-key':apiKey } });
  assert.equal(response.statusCode, 204, response.body);
  return response.headers['set-cookie'];
}

async function createShelf(host, cookie, targetRoot) {
  const response = await host.inject({ method:'POST', url:'/v1/admin/shelves', headers:{ cookie }, payload:{
    idempotencyKey:'create-large-shelf', shelfId:'large-shelf', name:'Large Shelf', targetRootLocation:targetRoot,
    ruleTemplateId:'system-beta-recommended', expectedTemplateRevision:1,
    placementPolicy:{ folderTemplate:'{title} ({year})', primaryTemplate:'{stem}{ext}', nfoTemplate:'{stem}.nfo',
      subtitleTemplate:'{stem}{language}{forced}{sdh}{ext}', posterTemplate:'poster{ext}', fanartTemplate:'fanart{ext}', collisionPolicy:'reject' },
  } });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().shelf;
}

function materialIdentity(index) {
  const contentFingerprint = canonicalDigest({ kind:'fingerprint', index });
  const basis = { schema:'physical-material-identity@2', mountScopeId:'test-shelf-mount', inode:String(index + 1),
    sizeBytes:1024 + index, fingerprintAlgorithm:'middle-256k-sha256', fingerprintVersion:1, contentFingerprint };
  return Object.freeze({ schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2', schemaVersion:2,
    materialKey:canonicalDigest(basis), mountScopeId:basis.mountScopeId, inode:basis.inode,
    sizeBytes:basis.sizeBytes, fingerprintAlgorithm:basis.fingerprintAlgorithm,
    fingerprintVersion:basis.fingerprintVersion, contentFingerprint });
}

function seedNonEmptyShelf(databasePath, referenceCount = 10_001) {
  const database = new Database(databasePath);
  const digest = (value) => canonicalDigest(value);
  const entryId = 'entry-large';
  const identities = [materialIdentity(0), materialIdentity(1)];
  const insertEntry = database.prepare(`INSERT INTO arca_shelf_entries
    (shelf_entry_id,shelf_id,structure_kind,status,canonical_identity_revision,canonical_identity_key,
     current_inventory_revision,current_deck_fact_revision,created_at_ms,terminal_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?,NULL)`);
  const insertMaterial = database.prepare(`INSERT INTO arca_inventory_materials
    (shelf_entry_id,inventory_revision,ordinal,material_key,role,episode_claims_schema_ref,episode_claims_json,
     episode_claim_set_digest,endpoint_id,location,binding_revision,mount_scope_id,inode,fingerprint_algorithm,
     fingerprint_version,content_fingerprint,digest_hex,size_bytes,active_guard)
    VALUES (?,?,?,?,?,NULL,NULL,NULL,?,?,?,?,?,?,?,?,?,?,1)`);
  const insertControl = database.prepare(`INSERT INTO fx_material_controls
    (material_key,mount_scope_id,inode,size_bytes,fingerprint_algorithm,fingerprint_version,content_fingerprint,
     owner_domain,owner_scope_type,owner_scope_id,control_revision,state,updated_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertControlRevision = database.prepare(`INSERT INTO fx_material_control_revisions
    (material_key,revision,operation_kind,from_owner_domain,from_scope_type,from_scope_id,to_owner_domain,
     to_scope_type,to_scope_id,basis_digest,commit_marker,committed_at_ms)
    VALUES (?,1,'acquire',NULL,NULL,NULL,'arca','shelf_entry',?,?,?,1)`);
  const insertReference = database.prepare(`INSERT INTO arca_inventory_related_references
    (shelf_entry_id,inventory_revision,reference_id,primary_ordinal,role,reference_kind,material_identity_hint,
     endpoint_id,location,checksum_hex) VALUES (?,1,?,0,'subtitle','historical_provenance',?,?,?,?)`);
  database.transaction(() => {
    database.pragma('defer_foreign_keys = ON');
    insertEntry.run(entryId, 'large-shelf', 'single', 'active', 1, 'canonical-large', 1, 1, 1);
    database.prepare(`INSERT INTO arca_canonical_identity_revisions
      (shelf_entry_id,revision,structure_kind,identity_kind,provider,provider_key,identity_digest,committed_at_ms)
      VALUES (?,1,'single','movie','tmdb','1',?,1)`).run(entryId, digest({ entryId, identity:true }));
    database.prepare(`INSERT INTO arca_inventory_representations
      (shelf_entry_id,revision,representation_digest,source_package_id,committed_at_ms) VALUES (?,1,?,'pkg',1)`)
      .run(entryId, digest({ entryId, inventory:true }));
    database.prepare(`INSERT INTO arca_deck_fact_revisions
      (shelf_entry_id,revision,state,inventory_revision,standard_revision,fact_digest,committed_at_ms)
      VALUES (?,1,'active',1,1,?,1)`).run(entryId, digest({ entryId, deck:true }));
    identities.forEach((identity, ordinal) => {
      insertMaterial.run(entryId, 1, ordinal, identity.materialKey, ordinal === 0 ? 'primary_payload' : 'metadata_sidecar',
        'test-endpoint', `movie/member-${ordinal}`, 1, identity.mountScopeId, identity.inode,
        identity.fingerprintAlgorithm, identity.fingerprintVersion, identity.contentFingerprint,
        digest({ identity, ordinal }), identity.sizeBytes);
      insertControl.run(identity.materialKey, identity.mountScopeId, identity.inode, identity.sizeBytes,
        identity.fingerprintAlgorithm, identity.fingerprintVersion, identity.contentFingerprint,
        'arca', 'shelf_entry', entryId, 1, 'controlled', 1);
      insertControlRevision.run(identity.materialKey, entryId, digest({ identity, control:true }), `seed-control-${ordinal}`);
    });
    for (let index = 0; index < referenceCount; index += 1) {
      const checksum = digest({ reference:index });
      insertReference.run(entryId, `reference-${String(index).padStart(5, '0')}`, checksum,
        'test-endpoint', `movie/reference-${index}.srt`, checksum);
    }
  })();
  database.close();
  return Object.freeze({ entryId, identities });
}

async function waitForDeregistered(host, cookie, shelfId, errors, databasePath) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const response = await host.inject({ method:'GET', url:`/v1/admin/shelves/${shelfId}`, headers:{ cookie } });
    assert.equal(response.statusCode, 200, response.body);
    if (response.json().shelf.status === 'deregistered') return response.json().shelf;
    if (errors.length) assert.fail(errors.map((error) => `${error.code || error.name}: ${error.message}`).join('\n'));
    await pause(20);
  }
  const database = new Database(databasePath, { readonly:true });
  try {
    const process = database.prepare('SELECT state,phase,manifest_revision,member_count,page_count,blocking_reason FROM arca_deregistrations').get();
    const works = database.prepare('SELECT work_kind,state,count(*) count FROM fx_supporting_works WHERE process_type=\'arca_shelf_deregistration\' GROUP BY work_kind,state').all();
    const events = database.prepare('SELECT capability_ref,state,count(*) count FROM fx_workflow_events WHERE owner_domain=\'arca\' GROUP BY capability_ref,state').all();
    assert.fail('Shelf Deregistration did not reach terminal state: ' + JSON.stringify({ process, works, events }));
  } finally { database.close(); }
}

test('Non-empty Shelf with more than 10000 Manifest members deregisters without file effects or fake reference Control release',
  { timeout:90_000 }, async (t) => {
    const fixture = createFixture();
    const errors = [];
    const host = await createCleanServiceHost({ dataDir:fixture.dataDir, adminDistDir:fixture.adminDistDir,
      secretRoot:SECRET, onExecutionRuntimeError:(error) => errors.push(error) });
    t.after(async () => {
      await host.close();
      if (!retainEvidence) fs.rmSync(fixture.root, { recursive:true, force:true, maxRetries:5, retryDelay:100 });
      else console.log('Shelf Deregistration evidence retained at '+fixture.root);
    });
    const cookie = await session(host, fixture.initialized.adminApiKey);
    const shelf = await createShelf(host, cookie, fixture.targetRoot);
    seedRepresentativeShelfReality(fixture.targetRoot);
    const seeded = seedNonEmptyShelf(fixture.databasePath);
    const before = shelfReality(fixture.targetRoot);
    const payload = { idempotencyKey:'deregister-large-shelf', shelfId:shelf.shelfId,
      expectedStatus:'active', expectedUpdatedAtMs:shelf.updatedAtMs,
      expectedRoutingProjectionRevision:shelf.routingProjection.revision,
      confirmation:{ decision:'deregister_shelf', enteredShelfName:shelf.name,
        preservePhysicalFilesAcknowledged:true, releaseControlAcknowledged:true } };
    const admitted = await host.inject({ method:'POST', url:`/v1/admin/shelves/${shelf.shelfId}/actions/deregister`,
      headers:{ cookie }, payload });
    assert.equal(admitted.statusCode, 202, admitted.body);
    const terminal = await waitForDeregistered(host, cookie, shelf.shelfId, errors, fixture.databasePath);
    assert.equal(terminal.deregistrationSummary.process.pageCount, 101);
    assert.equal(terminal.deregistrationSummary.process.memberCount, 10_003);
    const after=shelfReality(fixture.targetRoot);
    assert.deepEqual(after,before);
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const inbox = new Database(fixture.databasePath, { readonly:true });
      const count = inbox.prepare("SELECT count(*) count FROM fx_inbox WHERE consumer_domain='procurement'").get().count;
      inbox.close();
      if (count === 1) break;
      await pause(10);
    }

    const database = new Database(fixture.databasePath, { readonly:true });
    try {
      assert.equal(database.prepare('SELECT status FROM arca_shelf_entries WHERE shelf_entry_id=?').get(seeded.entryId).status, 'deregistered');
      const controlledReleaseRows = database.prepare("SELECT member_ordinal,material_key,release_result,committed_at_ms FROM arca_deregistration_releases WHERE member_kind='controlled_material' ORDER BY member_ordinal").all();
      assert.equal(controlledReleaseRows.filter((row) => row.release_result === 'released').length, 2,
        JSON.stringify(controlledReleaseRows));
      assert.equal(database.prepare("SELECT count(*) count FROM arca_deregistration_releases WHERE member_kind='reference_evidence' AND release_result IS NOT NULL").get().count, 0);
      const releasedControls = database.prepare("SELECT material_key,state,owner_domain,owner_scope_type,owner_scope_id FROM fx_material_controls WHERE material_key IN (?,?) ORDER BY material_key")
        .all(...seeded.identities.map((identity) => identity.materialKey).sort());
      assert.equal(releasedControls.length, 2);
      assert.ok(releasedControls.every((row) => row.state === 'released' && row.owner_domain === null &&
        row.owner_scope_type === null && row.owner_scope_id === null), JSON.stringify(releasedControls));
      assert.equal(database.prepare("SELECT count(*) count FROM fx_workflow_events WHERE capability_ref='arca.shelf_deregistration.release_manifest.verify@1'").get().count, 101);
      assert.equal(database.prepare("SELECT count(*) count FROM fx_event_resource_timings WHERE resource_key LIKE 'volume_%'").get().count, 0);
      assert.equal(database.prepare("SELECT count(*) count FROM fx_supporting_works WHERE owner_domain='arca' AND state='failed'").get().count, 0);
      assert.equal(database.prepare("SELECT count(*) count FROM fx_workflow_events WHERE owner_domain='arca' AND state='failed'").get().count, 0);
      assert.equal(database.prepare("SELECT count(*) count FROM fx_outbox WHERE message_kind='arca.shelf_deregistration.control_released@1'").get().count, 1);
      assert.equal(database.prepare("SELECT intended_consumer_count FROM fx_outbox WHERE message_kind='arca.shelf_deregistration.control_released@1'").get().intended_consumer_count, 1);
      assert.equal(database.prepare("SELECT count(*) count FROM fx_inbox WHERE consumer_domain='procurement'").get().count, 1);
    } finally { database.close(); }
    if(retainEvidence)fs.writeFileSync(path.join(fixture.root,'shelf-deregistration-report.json'),JSON.stringify({
      schema:'shelfdeck.shelf-deregistration-e2e-report@1',databasePath:fixture.databasePath,targetRoot:fixture.targetRoot,
      entryCount:terminal.deregistrationSummary.process.entryCount,memberCount:terminal.deregistrationSummary.process.memberCount,
      pageCount:terminal.deregistrationSummary.process.pageCount,targetRealityBefore:before,targetRealityAfter:after,targetRealityUnchanged:after.digest===before.digest,
      failedWorks:0,failedEvents:0,volumePermitCount:0
    },null,2));
    assert.equal(errors.length, 0);
  });

test('Startup recovery resumes one durable Shelf Deregistration without duplicate facts', { timeout:90_000 }, async (t) => {
  const fixture=createFixture();
  const errors=[];
  let host=await createCleanServiceHost({dataDir:fixture.dataDir,adminDistDir:fixture.adminDistDir,secretRoot:SECRET,
    onExecutionRuntimeError:(error)=>errors.push(error)});
  t.after(async()=>{await host?.close();if(!retainEvidence)fs.rmSync(fixture.root,{recursive:true,force:true,maxRetries:5,retryDelay:100});else console.log('Shelf Deregistration recovery evidence retained at '+fixture.root);});
  let cookie=await session(host,fixture.initialized.adminApiKey);
  const shelf=await createShelf(host,cookie,fixture.targetRoot);
  seedNonEmptyShelf(fixture.databasePath,10_001);
  const response=await host.inject({method:'POST',url:`/v1/admin/shelves/${shelf.shelfId}/actions/deregister`,headers:{cookie},payload:{
    idempotencyKey:'deregister-recovery-shelf',shelfId:shelf.shelfId,expectedStatus:'active',expectedUpdatedAtMs:shelf.updatedAtMs,
    expectedRoutingProjectionRevision:shelf.routingProjection.revision,confirmation:{decision:'deregister_shelf',enteredShelfName:shelf.name,
      preservePhysicalFilesAcknowledged:true,releaseControlAcknowledged:true}}});
  assert.equal(response.statusCode,202,response.body);
  await host.close();host=null;
  host=await createCleanServiceHost({dataDir:fixture.dataDir,adminDistDir:fixture.adminDistDir,secretRoot:SECRET,
    onExecutionRuntimeError:(error)=>errors.push(error)});
  cookie=await session(host,fixture.initialized.adminApiKey);
  await waitForDeregistered(host,cookie,shelf.shelfId,errors,fixture.databasePath);
  const database=new Database(fixture.databasePath,{readonly:true});
  try{
    assert.equal(database.prepare('SELECT count(*) count FROM arca_deregistrations').get().count,1);
    assert.equal(database.prepare('SELECT count(*) count FROM arca_deregistration_receipts').get().count,1);
    assert.equal(database.prepare("SELECT count(*) count FROM fx_workflow_events WHERE capability_ref='arca.shelf_deregistration.commit@1'").get().count,1);
    assert.equal(database.prepare("SELECT count(*) count FROM fx_material_control_revisions WHERE operation_kind='release'").get().count,2);
  }finally{database.close();}
  assert.equal(errors.length,0,errors.map((error)=>`${error.code||error.name}: ${error.message}`).join('\n'));
});

test('Shelf Deregistration Coordinator stays outside filesystem, executor, runtime, governor, and cross-owner repositories', () => {
  const coordinator = fs.readFileSync(path.resolve(__dirname,
    '../../src/helix/domains/arca/application/shelf-deregistration-coordinator.js'), 'utf8');
  assert.doesNotMatch(coordinator, /node:fs|capabilities\/|executor|dispatcher|event-runtime|resource-governor|domains\/(libra|procurement)/i);
  const store = fs.readFileSync(path.resolve(__dirname,
    '../../src/helix/domains/arca/persistence/shelf-query-store.js'), 'utf8');
  assert.doesNotMatch(store, /P14_SHELF_DEREGISTRATION_NON_EMPTY_UNWIRED/);
});
