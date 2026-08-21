'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { initializeCleanData } = require('../../scripts/helix-operational-safety');
const { createCleanServiceHost } = require('../../src/clean-service-host');
const { createShelfRoutingTargetProjection } = require('../../src/helix/domains/arca/public/routing-target-projection');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const schemaManifest = require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');

const secretRoot = 'p14-arca-shelf-configuration-secret-root-0123456789abcdef';
const schemaDdl = fs.readFileSync(path.resolve(
  __dirname,
  '../../src/helix/foundation/persistence/generated/clean-schema.sql',
), 'utf8');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-arca-shelf-e2e-'));
  const dataDir = path.join(root, 'data');
  const adminDistDir = path.join(root, 'admin');
  const targetRoot = path.join(root, 'movie-target');
  fs.mkdirSync(adminDistDir, { recursive: true });
  fs.mkdirSync(targetRoot, { recursive: true });
  fs.writeFileSync(path.join(adminDistDir, 'index.html'), '<div id="root"></div>');
  fs.writeFileSync(path.join(targetRoot, 'sentinel.txt'), 'unchanged-target-reality');
  const initialized = initializeCleanData({
    dataDir,
    confirmation: 'INITIALIZE_HELIX_CLEAN_V1',
    secretRoot,
  });
  return Object.freeze({
    root,
    dataDir,
    adminDistDir,
    targetRoot,
    initialized,
    databasePath: path.join(dataDir, 'shelfdeck.db'),
  });
}

async function session(host, apiKey) {
  const exchange = await host.inject({
    method: 'POST',
    url: '/v1/admin/session',
    headers: { 'x-api-key': apiKey },
  });
  assert.equal(exchange.statusCode, 204, exchange.body);
  return exchange.headers['set-cookie'];
}

function creation(targetRoot, overrides = {}) {
  return {
    idempotencyKey: 'movie-shelf-e2e-create',
    shelfId: 'movie-shelf-e2e',
    name: '电影收藏架',
    targetRootLocation: targetRoot,
    ruleTemplateId: 'system-beta-recommended',
    expectedTemplateRevision: 1,
    placementPolicy: {
      folderTemplate: '{title} ({year})',
      primaryTemplate: '{stem}{ext}',
      nfoTemplate: '{stem}.nfo',
      subtitleTemplate: '{stem}{language}{forced}{sdh}{ext}',
      posterTemplate: 'poster{ext}',
      fanartTemplate: 'fanart{ext}',
      collisionPolicy: 'reject',
    },
    ...overrides,
  };
}

test('Admin creates one probed Template-derived Shelf and Libra rebuilds its public projection after restart', async (t) => {
  const value = fixture();
  t.after(() => fs.rmSync(value.root, { recursive: true, force: true }));
  const sentinelBefore = fs.readFileSync(path.join(value.targetRoot, 'sentinel.txt'));
  const movedTargetRoot = path.join(value.root, 'movie-target-moved-after-commit');
  let host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
  });
  let createdShelf;
  try {
    const cookie = await session(host, value.initialized.adminApiKey);
    const templates = await host.inject({ method: 'GET', url: '/v1/admin/rule-templates', headers: { cookie } });
    assert.equal(templates.statusCode, 200, templates.body);
    const system = templates.json().items.find((item) => item.templateId === 'system-beta-recommended');
    assert.equal(system.ownerKind, 'system');
    assert.equal(system.status, 'active');
    assert.equal(system.currentRevision, 1);

    const oldShape = await host.inject({
      method: 'POST',
      url: '/v1/admin/shelves',
      headers: { cookie },
      payload: {
        ...creation(value.targetRoot, { idempotencyKey: 'old-shape', shelfId: 'old-shape' }),
        standard: { value: { forged: true } },
      },
    });
    assert.equal(oldShape.statusCode, 400);

    const missingTarget = await host.inject({
      method: 'POST',
      url: '/v1/admin/shelves',
      headers: { cookie },
      payload: creation(path.join(value.root, 'missing-target'), {
        idempotencyKey: 'missing-target',
        shelfId: 'missing-target',
      }),
    });
    assert.equal(missingTarget.statusCode, 400);

    const staleTemplate = await host.inject({
      method: 'POST',
      url: '/v1/admin/shelves',
      headers: { cookie },
      payload: creation(value.targetRoot, {
        idempotencyKey: 'stale-template',
        shelfId: 'stale-template',
        expectedTemplateRevision: 2,
      }),
    });
    assert.equal(staleTemplate.statusCode, 409, staleTemplate.body);

    const invalidPlacement = await host.inject({
      method: 'POST',
      url: '/v1/admin/shelves',
      headers: { cookie },
      payload: creation(value.targetRoot, {
        idempotencyKey: 'invalid-placement',
        shelfId: 'invalid-placement',
        placementPolicy: { ...creation(value.targetRoot).placementPolicy, folderTemplate: '../{title}' },
      }),
    });
    assert.equal(invalidPlacement.statusCode, 400);

    const created = await host.inject({
      method: 'POST',
      url: '/v1/admin/shelves',
      headers: { cookie },
      payload: creation(value.targetRoot),
    });
    assert.equal(created.statusCode, 201, created.body);
    createdShelf = created.json().shelf;
    assert.equal(createdShelf.shelfId, 'movie-shelf-e2e');
    assert.equal(createdShelf.target.rootLocation, fs.realpathSync(value.targetRoot));
    assert.match(createdShelf.target.endpointId, /^local-filesystem-/);
    assert.match(createdShelf.target.mountScopeId, /^local-mount-[a-f0-9]{32}$/);
    assert.equal(createdShelf.standard.ruleTemplateId, 'system-beta-recommended');
    assert.equal(createdShelf.standard.ruleTemplateRevision, 1);
    assert.equal(createdShelf.standard.value.standardDigest, createdShelf.standard.digest);
    assert.equal(createdShelf.standard.value.profileRuleSets.length, 4);
    const movie = createdShelf.standard.value.profileRuleSets.find((item) => item.contentProfile === 'movie');
    assert.deepEqual(movie.decisionBranches.map((item) => item.rating ?? 0), [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(movie.decisionBranches.map((item) => item.requirements.space.maxSizeGiB), [null, 2, 4, 8, 14, 50]);
    assert.deepEqual(createdShelf.placement.value, creation(value.targetRoot).placementPolicy);
    assert.equal(createdShelf.currentStandardRevision, 1);
    assert.equal(createdShelf.currentPlacementRevision, 1);
    assert.equal(createdShelf.routingProjection.revision, 1);

    const replay = await host.inject({
      method: 'POST',
      url: '/v1/admin/shelves',
      headers: { cookie },
      payload: creation(value.targetRoot),
    });
    assert.equal(replay.statusCode, 201, replay.body);
    assert.equal(replay.json().replayed, true);
    assert.deepEqual(replay.json().shelf, createdShelf);

    const conflictingReplay = await host.inject({
      method: 'POST',
      url: '/v1/admin/shelves',
      headers: { cookie },
      payload: creation(value.targetRoot, { name: '不同的收藏架名称' }),
    });
    assert.equal(conflictingReplay.statusCode, 409, conflictingReplay.body);

    fs.renameSync(value.targetRoot, movedTargetRoot);
    const replayAfterTargetDisappeared = await host.inject({
      method: 'POST',
      url: '/v1/admin/shelves',
      headers: { cookie },
      payload: creation(value.targetRoot),
    });
    assert.equal(replayAfterTargetDisappeared.statusCode, 201, replayAfterTargetDisappeared.body);
    assert.equal(replayAfterTargetDisappeared.json().replayed, true);
    assert.deepEqual(replayAfterTargetDisappeared.json().shelf, createdShelf);

    const db = new Database(value.databasePath, { readonly: true });
    assert.equal(db.prepare('SELECT COUNT(*) count FROM arca_shelves').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM arca_shelf_standard_revisions').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM arca_placement_policy_revisions').get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM fx_command_receipts WHERE command_contract='arca.admin.shelf.create@1'").get().count, 1);
    const createReceipt = db.prepare("SELECT result_ref_json FROM fx_command_receipts WHERE command_contract='arca.admin.shelf.create@1'").get();
    assert.deepEqual(JSON.parse(createReceipt.result_ref_json), { shelfId: 'movie-shelf-e2e' });
    assert.ok(Buffer.byteLength(createReceipt.result_ref_json, 'utf8') < 1024);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM arca_shelf_entries').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM libra_subjects').get().count, 0);
    db.close();
  } finally {
    await host.close();
  }

  host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
  });
  try {
    const cookie = await session(host, value.initialized.adminApiKey);
    const restored = await host.inject({
      method: 'GET',
      url: '/v1/admin/shelves/movie-shelf-e2e',
      headers: { cookie },
    });
    assert.equal(restored.statusCode, 200, restored.body);
    assert.deepEqual(restored.json().shelf, createdShelf);
  } finally {
    await host.close();
  }

  const kernel = openSqliteKernel({
    Database,
    databasePath: value.databasePath,
    schemaDdl,
    schemaManifest,
  });
  try {
    const projection = createShelfRoutingTargetProjection({
      schemaManifest,
      unitOfWork: createSqliteUnitOfWork({ kernel }),
    });
    assert.deepEqual(projection.list().map((item) => item.shelfId), ['movie-shelf-e2e']);
    const standard = projection.getStandard('movie-shelf-e2e');
    assert.equal(standard.resultKind, 'found');
    assert.equal(standard.projection.standard.standardDigest, createdShelf.standard.digest);
    assert.equal(standard.projection.routingProjectionRevision, 1);
  } finally {
    kernel.close();
  }
  assert.deepEqual(fs.readFileSync(path.join(movedTargetRoot, 'sentinel.txt')), sentinelBefore);
});

test('Shelf deregistration is asynchronous, non-destructive, idempotent, and Foundation-executed', async (t) => {
  const value=fixture();t.after(()=>fs.rmSync(value.root,{recursive:true,force:true}));
  const before=fs.readFileSync(path.join(value.targetRoot,'sentinel.txt'));
  const executionErrors=[];
  const host=await createCleanServiceHost({dataDir:value.dataDir,adminDistDir:value.adminDistDir,secretRoot,onExecutionRuntimeError:(error)=>executionErrors.push(error)});
  try{
    const cookie=await session(host,value.initialized.adminApiKey),created=await host.inject({method:'POST',url:'/v1/admin/shelves',headers:{cookie},payload:creation(value.targetRoot)});
    assert.equal(created.statusCode,201,created.body);const shelf=created.json().shelf,payload={idempotencyKey:'deregister-movie-shelf-e2e',shelfId:shelf.shelfId,expectedStatus:'active',expectedUpdatedAtMs:shelf.updatedAtMs,expectedRoutingProjectionRevision:shelf.routingProjection.revision,confirmation:{decision:'deregister_shelf',enteredShelfName:shelf.name,preservePhysicalFilesAcknowledged:true,releaseControlAcknowledged:true}};
    const wrong=await host.inject({method:'POST',url:`/v1/admin/shelves/${shelf.shelfId}/actions/deregister`,headers:{cookie},payload:{...payload,idempotencyKey:'wrong-name',confirmation:{...payload.confirmation,enteredShelfName:'wrong'}}});assert.equal(wrong.statusCode,400,wrong.body);
    const missingAcknowledgement=await host.inject({method:'POST',url:`/v1/admin/shelves/${shelf.shelfId}/actions/deregister`,headers:{cookie},payload:{...payload,idempotencyKey:'missing-acknowledgement',confirmation:{...payload.confirmation,preservePhysicalFilesAcknowledged:false}}});assert.equal(missingAcknowledgement.statusCode,400,missingAcknowledgement.body);
    const admitted=await host.inject({method:'POST',url:`/v1/admin/shelves/${shelf.shelfId}/actions/deregister`,headers:{cookie},payload});assert.equal(admitted.statusCode,202,admitted.body);assert.match(admitted.json().operationRef,/arca-shelf-deregistration:/);
    const replay=await host.inject({method:'POST',url:`/v1/admin/shelves/${shelf.shelfId}/actions/deregister`,headers:{cookie},payload});assert.equal(replay.statusCode,202,replay.body);assert.equal(replay.json().deregistrationId,admitted.json().deregistrationId);assert.equal(replay.json().replayed,true);
    let current;for(let attempt=0;attempt<200;attempt++){const response=await host.inject({method:'GET',url:`/v1/admin/shelves/${shelf.shelfId}`,headers:{cookie}});assert.equal(response.statusCode,200,response.body);current=response.json().shelf;if(current.status==='deregistered')break;await new Promise(resolve=>setTimeout(resolve,20));}
    assert.equal(current.status,'deregistered',executionErrors.map(error=>`${error.code || error.name}: ${error.message} ${JSON.stringify(error.details || {})}\n${error.stack || ''}`).join('\n'));assert.equal(current.deregistrationSummary.process.phase,'completed');assert.deepEqual(fs.readFileSync(path.join(value.targetRoot,'sentinel.txt')),before);assert.ok(fs.existsSync(value.targetRoot));
    const db=new Database(value.databasePath,{readonly:true});assert.equal(db.prepare('SELECT COUNT(*) count FROM arca_deregistrations').get().count,1);assert.equal(db.prepare('SELECT COUNT(*) count FROM arca_deregistration_receipts').get().count,1);assert.equal(db.prepare("SELECT COUNT(*) count FROM fx_supporting_works WHERE process_type='arca_shelf_deregistration'").get().count,1);assert.equal(db.prepare("SELECT COUNT(*) count FROM fx_workflow_events WHERE capability_ref='arca.shelf_deregistration.commit@1'").get().count,1);assert.equal(db.prepare("SELECT COUNT(*) count FROM fx_event_resource_timings WHERE resource_key LIKE 'volume_%'").get().count,0);db.close();
  }finally{await host.close();}
});
