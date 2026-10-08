'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {
  createCleanWorkspaceProductPort,
} = require('../../src/clean-workspace-product-port');

const schemaManifest = require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const schemaDdl = fs.readFileSync(path.resolve(
  __dirname,
  '../../src/helix/foundation/persistence/generated/clean-schema.sql',
), 'utf8');

async function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-workspace-product-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const workspaceRoot = path.join(root, 'workspace');
  let now = 1_700_000_000_000;
  const kernel = openSqliteKernel({
    Database,
    databasePath,
    schemaDdl,
    schemaManifest,
    now: () => now++,
  });
  try {
    const workspaceId = request().workspaceId;
    const seed = new Database(databasePath);
    seed.prepare(`INSERT INTO fx_workspace_registry
      (workspace_id,owner_domain,process_type,process_id,root_handle_ref,state,created_at_ms)
      VALUES(?,?,?,?,?,?,?)`).run(
      workspaceId, 'libra', 'libra_run', 'run-1',
      canonicalDigest({ schema: 'fixture-workspace-root@1' }), 'active', 1,
    );
    seed.close();
    return await run({
      databasePath,
      workspaceRoot,
      dependencies: {
        schemaManifest,
        unitOfWork: createSqliteUnitOfWork({ kernel }),
      },
    });
  } finally {
    kernel.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

function request(bytes = Buffer.from('<movie><title>Example Movie</title></movie>')) {
  return Object.freeze({
    libraRunId: 'run-1',
    workspaceId: canonicalDigest({ schema: 'libra.workspace-id@1', libraRunId: 'run-1' }),
    relativePath: 'artifacts/movie.nfo',
    artifactKind: 'nfo',
    mediaType: 'application/xml',
    bytes,
    provenanceRef: Object.freeze({
      objectType: 'libra_run',
      objectId: 'run-1',
      revision: 1,
      digest: canonicalDigest({ schema: 'movie-metadata-render@1', libraRunId: 'run-1' }),
    }),
  });
}

function frameRequest() {
  const base = request();
  return Object.freeze({
    libraRunId: base.libraRunId,
    workspaceId: base.workspaceId,
    relativePath: 'analysis/frames/frame-set.json',
    artifactKind: 'western_frame_set',
    mediaType: 'application/vnd.shelfdeck.western-frame-set+json',
    provenanceRef: Object.freeze({
      objectType: 'western_frame_extract',
      objectId: 'frame-target-1',
      revision: 1,
      digest: canonicalDigest('frame-target-1'),
    }),
    maxFrames: 4,
  });
}

function seedRuntimeWorkspaceEffect(databasePath, state = 'reconcile_required', capabilityRef = 'libra.product_artifact.acquire@1', suffix = '') {
  const database = new Database(databasePath);
  const eventAttemptId = 'runtime-event-attempt'+suffix;
  const idempotencyKey = 'runtime-workspace-effect'+suffix;
  try {
    database.prepare(`INSERT INTO fx_supporting_works
      (work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,state,idempotency_key)
      VALUES(?,?,?,?,?,?,?,?,?)`).run('runtime-work'+suffix,'libra','libra_run','run-1','artifact_production',
        'a'.repeat(64),'normal_foreground','running','runtime-work'+suffix);
    database.prepare(`INSERT INTO fx_work_attempts
      (attempt_id,work_id,basis_digest,state) VALUES(?,?,?,?)`)
      .run('runtime-work-attempt'+suffix,'runtime-work'+suffix,'a'.repeat(64),'running');
    database.prepare(`INSERT INTO fx_workflow_plans
      (plan_id,attempt_id,basis_digest,state) VALUES(?,?,?,?)`)
      .run('runtime-plan'+suffix,'runtime-work-attempt'+suffix,'a'.repeat(64),'planned');
    database.prepare(`INSERT INTO fx_plan_nodes
      (plan_id,node_id,capability_ref,contract_version,input_binding_schema_ref,input_bindings_json,
       parameter_schema_ref,parameters_json,when_schema_ref,when_json,effect_class,fence_schema_ref,
       fence_basis_json,resource_demand_schema_ref,resource_demand_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('runtime-plan'+suffix,'runtime-node'+suffix,capabilityRef,1,
        'helix://test/inputs','{}','helix://test/parameters','{"artifactKind":"poster"}',null,null,'workspace_write',
        'helix://test/fence','{}','helix://test/resources','{}');
    database.prepare(`INSERT INTO fx_workflow_events
      (event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,
       priority_class,state,ready_at_ms,retry_at_ms,result_id,current_progress_revision)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('runtime-event'+suffix,'runtime-plan'+suffix,'runtime-node'+suffix,'runtime-work'+suffix,
        'runtime-work-attempt'+suffix,'libra',capabilityRef,1,'normal_foreground','executing',1,null,null,null);
    database.prepare(`INSERT INTO fx_event_attempts
      (event_attempt_id,event_id,ordinal,executor_ref,executor_version,input_snapshot_schema_ref,
       input_snapshot_digest,fence_snapshot_digest,state,outcome_kind,retry_after_ms,failure_class,failure_code,
       evidence_digest,started_at_ms,finished_at_ms)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(eventAttemptId,'runtime-event'+suffix,1,
        capabilityRef,1,'helix://test/inputs','b'.repeat(64),'c'.repeat(64),
        'executing',null,null,null,null,null,1,null);
    database.prepare(`INSERT INTO fx_effect_journal
      (effect_id,event_attempt_id,effect_class,idempotency_key,intent_digest,state,external_receipt_ref,
       output_digest,verified_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
        canonicalDigest(['workspace_write',idempotencyKey]),eventAttemptId,'workspace_write',idempotencyKey,
        'd'.repeat(64),state,null,null,2,2);
  } finally {
    database.close();
  }
  return Object.freeze({effectClass:'workspace_write',eventAttemptId,idempotencyKey,recoveryDecision:'safe_retry'});
}

function mediaRequest(authority, produce) {
  const base = request();
  return {
    libraRunId:base.libraRunId, workspaceId:base.workspaceId,
    relativePath:'media/output.mkv', intentDigest:'e'.repeat(64),
    idempotencyKey:authority.idempotencyKey, effectScopeDigest:'f'.repeat(64),
    outputTargetId:'target', outputTargetDigest:'a'.repeat(64),
    runtimeEffectAuthority:authority, produce,
  };
}

test('Series multi-member import retries one failed copy without rewriting its completed peer or Landing',()=>
  fixture(async({databasePath,workspaceRoot,dependencies})=>{
    const landing=path.join(path.dirname(workspaceRoot),'series-landing');fs.mkdirSync(landing);
    const members=[{externalMemberId:'shared',relativePath:'shared.mkv',sizeBytes:128,episodeClaims:[{episodeKey:'E1'},{episodeKey:'E2'}]},
      {externalMemberId:'part',relativePath:'part.mkv',sizeBytes:64,episodeClaims:[{episodeKey:'E1'}]}];
    const bytes=members.map((member,index)=>Buffer.alloc(member.sizeBytes,index+1));
    members.forEach((member,index)=>fs.writeFileSync(path.join(landing,member.relativePath),bytes[index]));
    const originals=members.map(member=>fs.statSync(path.join(landing,member.relativePath),{bigint:true}));
    const port=createCleanWorkspaceProductPort({...dependencies,rootPath:workspaceRoot,externalLandingResolver:()=>({absolutePath:landing})});
    const verified={result:'passed',verifiedMemberIds:members.map(item=>item.externalMemberId)};
    const commands=members.map((member,index)=>{
      const authority=seedRuntimeWorkspaceEffect(databasePath,'reconcile_required','libra.workspace.material.import@1','-'+index);
      return {stableEvidence:{stableExternalMaterialHandle:{handleId:'series-external',landingBinding:{},outputSnapshot:{members}}},
        verifiedExternalPackage:verified,workspaceDeliveryContract:{contractId:'series-import-'+index,digest:canonicalDigest(member),
          libraRunId:request().libraRunId,workspaceId:request().workspaceId,targetRelativePath:'external/scope/'+member.relativePath,
          stableExternalMaterialHandleId:'series-external',verifiedPackageDigest:canonicalDigest(verified),externalMemberId:member.externalMemberId},
        runtimeEffectAuthority:authority,idempotencyKey:authority.idempotencyKey};
    });
    const first=await port.importExternalMaterial(commands[0]),firstPath=path.join(workspaceRoot,request().workspaceId,first.relativePath),
      firstStat=fs.statSync(firstPath,{bigint:true}),copy=fs.promises.copyFile;
    fs.promises.copyFile=async()=>{throw Object.assign(new Error('Injected second member failure'),{code:'ENOSPC'});};
    try{await assert.rejects(port.importExternalMaterial(commands[1]),{code:'ENOSPC'});}
    finally{fs.promises.copyFile=copy;}
    assert.deepEqual(await port.importExternalMaterial(commands[0]),first);
    const second=await port.importExternalMaterial(commands[1]);assert.notEqual(second.materialKey,first.materialKey);
    assert.deepEqual(await port.importExternalMaterial(commands[1]),second);
    const afterFirst=fs.statSync(firstPath,{bigint:true});assert.equal(afterFirst.ino,firstStat.ino);assert.equal(afterFirst.mtimeNs,firstStat.mtimeNs);
    for(const [index,handle] of [first,second].entries()){
      const source=path.join(landing,members[index].relativePath),target=path.join(workspaceRoot,request().workspaceId,handle.relativePath),
        stat=fs.statSync(source,{bigint:true});
      assert.deepEqual(fs.readFileSync(source),bytes[index]);assert.deepEqual(fs.readFileSync(target),bytes[index]);
      assert.equal(stat.ino,originals[index].ino);assert.equal(stat.mtimeNs,originals[index].mtimeNs);assert.equal(stat.ctimeNs,originals[index].ctimeNs);
      assert.notEqual(fs.statSync(target,{bigint:true}).ino,stat.ino);
    }
    const database=new Database(databasePath,{readonly:true});
    try{assert.equal(database.prepare('SELECT count(*) n FROM fx_workspace_materials').get().n,2);
      assert.equal(database.prepare('SELECT count(*) n FROM fx_effect_journal').get().n,2);}
    finally{database.close();}
  }));

for (const scenario of ['partial-recovery', 'copy-failure', 'source-change']) {
  test(`external native copy preserves import fences and original Effect: ${scenario}`, () =>
    fixture(async ({ databasePath, workspaceRoot, dependencies }) => {
      const authority = seedRuntimeWorkspaceEffect(databasePath, 'reconcile_required', 'libra.workspace.material.import@1');
      const source = path.join(path.dirname(workspaceRoot), 'landing.mkv');
      const bytes = Buffer.alloc(1024 * 1024, 7);
      fs.writeFileSync(source, bytes);
      const before = fs.statSync(source, { bigint:true });
      const port = createCleanWorkspaceProductPort({ ...dependencies, rootPath:workspaceRoot,
        externalLandingResolver:() => ({ absolutePath:source }) });
      const member = { externalMemberId:'member-1', relativePath:'landing.mkv', sizeBytes:bytes.length };
      const verified = { result:'passed', verifiedMemberIds:[member.externalMemberId] };
      const command = { stableEvidence:{ stableExternalMaterialHandle:{ handleId:'external-handle',
        landingBinding:{}, outputSnapshot:{ members:[member] } } },
        verifiedExternalPackage:verified,
        workspaceDeliveryContract:{ contractId:'import-contract', digest:'e'.repeat(64),
          libraRunId:request().libraRunId, workspaceId:request().workspaceId,
          targetRelativePath:'external/movie.mkv', stableExternalMaterialHandleId:'external-handle',
          verifiedPackageDigest:canonicalDigest(verified), externalMemberId:member.externalMemberId },
        runtimeEffectAuthority:authority, idempotencyKey:authority.idempotencyKey };
      const target = path.join(workspaceRoot, request().workspaceId, 'external', 'movie.mkv');
      const partial = target + '.partial-' + canonicalDigest(['workspace_write', authority.idempotencyKey]).slice(0, 16);
      fs.mkdirSync(path.dirname(target), { recursive:true });
      fs.writeFileSync(partial, 'interrupted previous copy');
      const nativeCopy = fs.promises.copyFile;
      let copies = 0;
      fs.promises.copyFile = async (from, to, flags) => {
        copies++;
        assert.equal(flags, fs.constants.COPYFILE_EXCL);
        if (scenario === 'copy-failure') throw Object.assign(new Error('Injected copy failure'), { code:'ENOSPC' });
        await nativeCopy(from, to, flags);
        if (scenario === 'source-change') fs.appendFileSync(source, 'changed');
      };
      try {
        if (scenario !== 'partial-recovery') {
          await assert.rejects(port.importExternalMaterial(command), {
            code:scenario === 'copy-failure' ? 'ENOSPC' : 'CLEAN_WORKSPACE_EXTERNAL_IMPORT_SOURCE_CHANGED',
          });
          assert.equal(fs.existsSync(target), false);
          const database = new Database(databasePath, { readonly:true });
          try { assert.equal(database.prepare('SELECT count(*) n FROM fx_workspace_materials').get().n, 0); }
          finally { database.close(); }
          return;
        }
        const handle = await port.importExternalMaterial(command);
        assert.deepEqual(await port.importExternalMaterial(command), handle);
        assert.equal(copies, 1);
        assert.deepEqual(fs.readFileSync(target), bytes);
        assert.deepEqual(fs.readFileSync(source), bytes);
        const after = fs.statSync(source, { bigint:true });
        assert.equal(after.ino, before.ino);
        assert.equal(after.mtimeNs, before.mtimeNs);
        assert.equal(after.ctimeNs, before.ctimeNs);
        assert.notEqual(fs.statSync(target, { bigint:true }).ino, after.ino);
        assert.equal(fs.existsSync(partial), false);
        const database = new Database(databasePath, { readonly:true });
        try {
          assert.equal(database.prepare('SELECT count(*) n FROM fx_effect_journal').get().n, 1);
          assert.equal(database.prepare('SELECT count(*) n FROM fx_workspace_materials').get().n, 1);
        } finally { database.close(); }
      } finally { fs.promises.copyFile = nativeCopy; }
    }));
}

for (const recoveryDecision of ['safe_retry', 'continue_forward']) {
  test(`media ${recoveryDecision} recovery commits and replays one Handle under the original Effect`, () =>
    fixture(async ({ databasePath, workspaceRoot, dependencies }) => {
      const authority = { ...seedRuntimeWorkspaceEffect(databasePath, 'intended', 'libra.media.transcode@1'), recoveryDecision };
      const effectId = canonicalDigest(['workspace_write', authority.idempotencyKey]);
      const port = createCleanWorkspaceProductPort({ ...dependencies, rootPath:workspaceRoot });
      let produced = 0;
      let interrupted = true;
      const command = mediaRequest(authority, async (target) => {
        if (interrupted) throw Object.assign(new Error('Injected interrupted producer'), { code:'EROFS' });
        produced++;
        fs.writeFileSync(target, Buffer.alloc(1024, 7));
      });
      await assert.rejects(port.materializeMedia(command), { code:'EROFS' });
      const realityVerifiers = Object.fromEntries([
        'workspace_write', 'external_request', 'domain_fact_commit',
        'responsibility_control_commit', 'material_commit', 'destructive_commit',
      ].map((effectClass) => [effectClass, { verify() { throw new Error('Unexpected reality verification'); } }]));
      const journal = require('../../src/helix/foundation/effects/effect-journal').createEffectJournal({
        ...dependencies, now:() => 3, realityVerifiers,
      });
      journal.requireReconcile(effectId);
      interrupted = false;
      const first = await port.materializeMedia(command);
      const replay = await port.materializeMedia(command);
      assert.deepEqual(replay, first);
      assert.equal(first.effectId, effectId);
      assert.equal(produced, 1);
      const database = new Database(databasePath, { readonly:true });
      try {
        assert.deepEqual(database.prepare('SELECT event_attempt_id,state FROM fx_effect_journal WHERE effect_id=?').get(effectId),
          { event_attempt_id:authority.eventAttemptId, state:'reconcile_required' });
        assert.equal(database.prepare('SELECT count(*) n FROM fx_effect_journal').get().n, 1);
        assert.equal(database.prepare('SELECT count(*) n FROM fx_event_attempts').get().n, 1);
        assert.equal(database.prepare('SELECT count(*) n FROM fx_workspace_materials').get().n, 1);
      } finally { database.close(); }
    }));
}

test('media materialization requires Runtime authority before producing bytes', () =>
  fixture(async ({ databasePath, workspaceRoot, dependencies }) => {
    const authority = seedRuntimeWorkspaceEffect(databasePath);
    const port = createCleanWorkspaceProductPort({ ...dependencies, rootPath:workspaceRoot });
    let produced = 0;
    const command = mediaRequest(authority, async () => { produced++; });
    delete command.runtimeEffectAuthority;
    await assert.rejects(port.materializeMedia(command), { code:'CLEAN_WORKSPACE_MEDIA_RUNTIME_AUTHORITY_REQUIRED' });
    assert.equal(produced, 0);
  }));

for (const [name, change, code] of [
  ['missing recovery decision', { recoveryDecision:undefined }, 'CLEAN_WORKSPACE_RUNTIME_EFFECT_AUTHORITY_MISSING'],
  ['before-intent decision', { recoveryDecision:'safe_retry_before_intent' }, 'CLEAN_WORKSPACE_RUNTIME_EFFECT_AUTHORITY_MISSING'],
  ['invalid decision', { recoveryDecision:'retry' }, 'CLEAN_WORKSPACE_RUNTIME_EFFECT_AUTHORITY_INVALID'],
  ['different Attempt', { eventAttemptId:'another-attempt' }, 'CLEAN_WORKSPACE_RUNTIME_EFFECT_AUTHORITY_MISSING'],
  ['different idempotency key', { idempotencyKey:'another-effect' }, 'CLEAN_WORKSPACE_RUNTIME_EFFECT_AUTHORITY_MISSING'],
]) {
  test(`media recovery rejects ${name} before producing bytes`, () =>
    fixture(async ({ databasePath, workspaceRoot, dependencies }) => {
      const authority = { ...seedRuntimeWorkspaceEffect(databasePath), ...change };
      const port = createCleanWorkspaceProductPort({ ...dependencies, rootPath:workspaceRoot });
      let produced = 0;
      await assert.rejects(port.materializeMedia(mediaRequest(authority, async () => { produced++; })), { code });
      assert.equal(produced, 0);
      const database = new Database(databasePath, { readonly:true });
      try { assert.equal(database.prepare('SELECT count(*) n FROM fx_workspace_materials').get().n, 0); }
      finally { database.close(); }
    }));
}

for (const [name, sql, value] of [
  ['state', 'UPDATE fx_effect_journal SET state=?', 'intended'],
  ['intent', 'UPDATE fx_effect_journal SET intent_digest=?', '9'.repeat(64)],
  ['idempotency key', 'UPDATE fx_effect_journal SET idempotency_key=?', 'changed-key'],
]) {
  test(`media recovery rejects ${name} drift between authorization and Handle commit`, () =>
    fixture(async ({ databasePath, workspaceRoot, dependencies }) => {
      const authority = seedRuntimeWorkspaceEffect(databasePath);
      const port = createCleanWorkspaceProductPort({
        ...dependencies, rootPath:workspaceRoot,
        afterMediaPhysicalEffect() {
          const database = new Database(databasePath);
          try { database.prepare(sql).run(value); } finally { database.close(); }
        },
      });
      const command = mediaRequest(authority, async (target) => fs.writeFileSync(target, Buffer.alloc(1024, 7)));
      await assert.rejects(port.materializeMedia(command), { code:'CLEAN_WORKSPACE_MEDIA_JOURNAL' });
      const database = new Database(databasePath, { readonly:true });
      try { assert.equal(database.prepare('SELECT count(*) n FROM fx_workspace_materials').get().n, 0); }
      finally { database.close(); }
    }));
}

test('materializes one service-owned Workspace Artifact and replays exact handles', () =>
  fixture(({ databasePath, workspaceRoot, dependencies }) => {
    const port = createCleanWorkspaceProductPort({ ...dependencies, rootPath: workspaceRoot });
    const first = port.materializeArtifact(request());
    const replay = port.materializeArtifact(request());
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.workspaceMaterialHandle, first.workspaceMaterialHandle);
    assert.deepEqual(replay.artifactHandle, first.artifactHandle);
    const target = path.join(workspaceRoot, request().workspaceId, 'artifacts', 'movie.nfo');
    assert.deepEqual(fs.readFileSync(target), request().bytes);
    const database = new Database(databasePath, { readonly: true });
    try {
      assert.equal(database.prepare(
        "SELECT count(*) count FROM fx_effect_journal WHERE state='committed'"
      ).get().count, 1);
      assert.equal(database.prepare('SELECT count(*) count FROM fx_workspace_materials').get().count, 1);
      assert.equal(database.prepare('SELECT count(*) count FROM fx_artifact_registry').get().count, 1);
      assert.equal(database.prepare('SELECT count(*) count FROM platform_workspace_roots').get().count, 1);
    } finally {
      database.close();
    }
  }));

test('Artifact reality observer proves absence, exact matching reality, and partial-row conflict', () =>
  fixture(({ databasePath, workspaceRoot, dependencies }) => {
    const port = createCleanWorkspaceProductPort({ ...dependencies, rootPath: workspaceRoot });
    const target = request();
    const observation = {
      libraRunId:target.libraRunId,
      workspaceId:target.workspaceId,
      relativePath:target.relativePath,
      artifactKind:target.artifactKind,
    };
    assert.equal(port.observeArtifactReality(observation).status, 'absent');
    port.materializeArtifact(target);
    assert.equal(port.observeArtifactReality(observation).status, 'matching');
    const database = new Database(databasePath);
    try {
      database.prepare('DELETE FROM fx_workspace_materials WHERE workspace_id=? AND relative_path=?')
        .run(target.workspaceId, target.relativePath);
    } finally {
      database.close();
    }
    const conflicted = port.observeArtifactReality(observation);
    assert.equal(conflicted.status, 'conflict');
    assert.equal(conflicted.cleanupDeclared, false);
  }));

test('classified runtime recovery may materialize through the same reconcile-required Effect', () =>
  fixture(({ databasePath, workspaceRoot, dependencies }) => {
    const runtimeEffectAuthority = seedRuntimeWorkspaceEffect(databasePath);
    const port = createCleanWorkspaceProductPort({ ...dependencies, rootPath: workspaceRoot });
    const recovered = port.materializeArtifact({ ...request(), runtimeEffectAuthority });
    assert.equal(recovered.replayed, false);
    assert.equal(port.observeArtifactReality({
      libraRunId:request().libraRunId,
      workspaceId:request().workspaceId,
      relativePath:request().relativePath,
      artifactKind:request().artifactKind,
    }).status, 'matching');
    const database = new Database(databasePath, { readonly:true });
    try {
      assert.equal(database.prepare('SELECT state FROM fx_effect_journal WHERE effect_class=?')
        .get('workspace_write').state, 'reconcile_required');
    } finally {
      database.close();
    }
  }));

test('failed byte fetch attests no write only when the exact target is absent', () =>
  fixture(async ({ databasePath, workspaceRoot, dependencies }) => {
    const runtimeEffectAuthority = seedRuntimeWorkspaceEffect(databasePath);
    const port = createCleanWorkspaceProductPort({ ...dependencies, rootPath:workspaceRoot });
    const input = { ...request(), relativePath:'product/poster.jpg', artifactKind:'poster',
      mediaType:'image/jpeg', acquisitionBasis:{ provider:'fixture' }, runtimeEffectAuthority,
      acquireBytes:async () => { throw Object.assign(new Error('offline'), { code:'ECONNRESET' }); } };
    await assert.rejects(port.acquireArtifact(input), error => {
      assert.equal(error.code,'ECONNRESET');
      assert.deepEqual(error.workspaceWriteNotStarted, {
        eventAttemptId:runtimeEffectAuthority.eventAttemptId, idempotencyKey:runtimeEffectAuthority.idempotencyKey,
        targetDigest:canonicalDigest({ workspaceId:input.workspaceId, relativePath:input.relativePath }),
      });
      return true;
    });
    const target = path.join(workspaceRoot,input.workspaceId,input.relativePath);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.writeFileSync(target,'earlier output');
    await assert.rejects(port.acquireArtifact(input), error => {
      assert.equal(error.workspaceWriteNotStarted,undefined);
      return true;
    });
    assert.equal(fs.readFileSync(target,'utf8'),'earlier output');
  }));

test('recovers the same physical bytes after crash before journal/handle commit', () =>
  fixture(({ databasePath, workspaceRoot, dependencies }) => {
    let crash = true;
    const crashing = createCleanWorkspaceProductPort({
      ...dependencies,
      rootPath: workspaceRoot,
      afterPhysicalEffect() {
        if (!crash) return;
        crash = false;
        throw new Error('fault-after-physical-workspace-effect');
      },
    });
    assert.throws(
      () => crashing.materializeArtifact(request()),
      /fault-after-physical-workspace-effect/,
    );
    const interrupted = new Database(databasePath, { readonly: true });
    try {
      assert.deepEqual(interrupted.prepare(
        'SELECT state FROM fx_effect_journal'
      ).get(), { state: 'intended' });
      assert.equal(interrupted.prepare('SELECT count(*) count FROM fx_workspace_materials').get().count, 0);
      assert.equal(interrupted.prepare('SELECT count(*) count FROM fx_artifact_registry').get().count, 0);
    } finally {
      interrupted.close();
    }
    const recovered = createCleanWorkspaceProductPort({
      ...dependencies,
      rootPath: workspaceRoot,
    }).materializeArtifact(request());
    assert.equal(recovered.replayed, false);
    const target = path.join(workspaceRoot, request().workspaceId, 'artifacts', 'movie.nfo');
    assert.deepEqual(fs.readFileSync(target), request().bytes);
    const database = new Database(databasePath, { readonly: true });
    try {
      assert.deepEqual(database.prepare(
        'SELECT state,output_digest FROM fx_effect_journal'
      ).get(), {
        state: 'committed',
        output_digest: recovered.artifactHandle.digestHex,
      });
      assert.equal(database.prepare('SELECT count(*) count FROM fx_workspace_materials').get().count, 1);
      assert.equal(database.prepare('SELECT count(*) count FROM fx_artifact_registry').get().count, 1);
    } finally {
      database.close();
    }
  }));

test('same stable target identity with different bytes fails without a second effect', () =>
  fixture(({ databasePath, workspaceRoot, dependencies }) => {
    const port = createCleanWorkspaceProductPort({ ...dependencies, rootPath: workspaceRoot });
    port.materializeArtifact(request());
    assert.throws(
      () => port.materializeArtifact(request(Buffer.from('<movie><title>Changed</title></movie>'))),
      (error) => error.code === 'CLEAN_WORKSPACE_EFFECT_REALITY_DRIFT',
    );
    const database = new Database(databasePath, { readonly: true });
    try {
      assert.equal(database.prepare(
        'SELECT count(*) count FROM fx_effect_journal'
      ).get().count, 1);
    } finally {
      database.close();
    }
  }));

test('intended physical reality rejects recomputed bytes under the same stable effect', () =>
  fixture(({ databasePath, workspaceRoot, dependencies }) => {
    const original = request();
    const crashing = createCleanWorkspaceProductPort({
      ...dependencies,
      rootPath: workspaceRoot,
      afterPhysicalEffect() {
        throw new Error('fault-after-stable-effect-bytes');
      },
    });
    assert.throws(
      () => crashing.materializeArtifact(original),
      /fault-after-stable-effect-bytes/,
    );
    const restarted = createCleanWorkspaceProductPort({
      ...dependencies,
      rootPath: workspaceRoot,
    });
    assert.throws(
      () => restarted.materializeArtifact(request(
        Buffer.from('<movie><title>Different recomputation</title></movie>'),
      )),
      (error) => error.code === 'CLEAN_WORKSPACE_EFFECT_OUTPUT_DRIFT',
    );
    const target = path.join(
      workspaceRoot,
      original.workspaceId,
      'artifacts',
      'movie.nfo',
    );
    assert.deepEqual(fs.readFileSync(target), original.bytes);
    const database = new Database(databasePath, { readonly: true });
    try {
      assert.deepEqual(database.prepare(
        'SELECT count(*) count,min(state) state FROM fx_effect_journal'
      ).get(), { count: 1, state: 'intended' });
    } finally {
      database.close();
    }
  }));

test('frame sink journals stable target identity before accepting real member bytes', () =>
  fixture(({ databasePath, workspaceRoot, dependencies }) => {
    const port = createCleanWorkspaceProductPort({
      ...dependencies,
      rootPath: workspaceRoot,
    });
    const sink = port.openFrameCompositeSink(frameRequest());
    const before = new Database(databasePath, { readonly: true });
    try {
      assert.deepEqual(before.prepare(
        'SELECT state,output_digest FROM fx_effect_journal'
      ).get(), { state: 'intended', output_digest: null });
    } finally {
      before.close();
    }
    const frame0 = Buffer.from('actual-frame-zero');
    const frame1 = Buffer.from('actual-frame-one');
    sink.writeFrame({ timestampMs: 0, bytes: frame0 });
    sink.writeFrame({ timestampMs: 10_000, bytes: frame1 });
    const committed = sink.commit();
    const recovered = port.readArtifactBytes(
      committed.materialized.artifactHandle,
    );
    const composite = JSON.parse(recovered.bytes.toString('utf8'));
    assert.equal(composite.members.length, 2);
    assert.deepEqual(
      composite.memberPayloads.map((item) =>
        Buffer.from(item.bytesBase64, 'base64')),
      [frame0, frame1],
    );
    assert.equal(
      committed.materialized.artifactHandle.digestHex,
      require('node:crypto').createHash('sha256')
        .update(recovered.bytes).digest('hex'),
    );
    assert.equal(
      composite.frameMemberSetDigest,
      canonicalDigest({
        schema: 'libra.western-frame-member-set@1',
        items: composite.members,
      }),
    );
  }));

function durableRootAfterRevision(first, configRevision) {
  const rootHandleRef = canonicalDigest({
    schema: 'platform.workspace-root-handle@1',
    rootId: first.rootId,
    endpointId: first.endpointId,
    mountScopeId: first.mountScopeId,
    mountScopeRevision: first.mountScopeRevision,
    configRevision,
    capabilityDigest: first.capabilityDigest,
  });
  const snapshotDigest = canonicalDigest({
    rootId: first.rootId,
    ownerScope: 'libra',
    rootKind: 'production-workspace',
    endpointId: first.endpointId,
    mountScopeId: first.mountScopeId,
    mountScopeRevision: first.mountScopeRevision,
    configRevision,
    capabilityDigest: first.capabilityDigest,
    state: 'active',
    rootHandleRef,
  });
  return { rootHandleRef, snapshotDigest };
}

test('durable config revision 2 stamps and losslessly restamps Workspace material handles', () =>
  fixture(({ databasePath, workspaceRoot, dependencies }) => {
    const port = createCleanWorkspaceProductPort({ ...dependencies, rootPath: workspaceRoot });
    const firstRoot = port.rootSnapshot();
    const first = port.materializeArtifact(request());
    assert.equal(first.workspaceMaterialHandle.rootHandleRef, firstRoot.rootHandleRef);
    const target = path.join(workspaceRoot, request().workspaceId, 'artifacts', 'movie.nfo');
    const originalBytes = fs.readFileSync(target);
    const originalHandleId = first.workspaceMaterialHandle.handleId;
    const originalDigest = first.workspaceMaterialHandle.digestHex;
    const bumped = durableRootAfterRevision(firstRoot, 2);
    const seed = new Database(databasePath);
    seed.prepare(`UPDATE platform_workspace_roots
      SET config_revision=2, root_handle_ref=?, snapshot_digest=?
      WHERE root_id=?`).run(bumped.rootHandleRef, bumped.snapshotDigest, firstRoot.rootId);
    seed.close();
    const restarted = createCleanWorkspaceProductPort({ ...dependencies, rootPath: workspaceRoot });
    const durable = restarted.rootSnapshot();
    assert.equal(durable.configRevision, 2);
    assert.equal(durable.rootHandleRef, bumped.rootHandleRef);
    const database = new Database(databasePath, { readonly: true });
    try {
      const row = database.prepare(
        'SELECT root_handle_ref, handle_digest, material_handle_id, digest_hex FROM fx_workspace_materials',
      ).get();
      assert.equal(row.root_handle_ref, durable.rootHandleRef);
      assert.equal(row.material_handle_id, originalHandleId);
      assert.equal(row.digest_hex, originalDigest);
    } finally {
      database.close();
    }
    assert.deepEqual(fs.readFileSync(target), originalBytes);
    const replay = restarted.materializeArtifact(request());
    assert.equal(replay.replayed, true);
    assert.equal(replay.workspaceMaterialHandle.rootHandleRef, durable.rootHandleRef);
    assert.equal(replay.workspaceMaterialHandle.handleId, originalHandleId);
    const extra = restarted.materializeArtifact({
      ...request(),
      relativePath: 'artifacts/poster.jpg',
      artifactKind: 'poster',
      mediaType: 'image/jpeg',
      bytes: Buffer.from('poster-bytes'),
    });
    assert.equal(extra.replayed, false);
    assert.equal(extra.workspaceMaterialHandle.rootHandleRef, durable.rootHandleRef);
  }));

test('durable filesystem bind restamps endpoint and mount without rewriting bytes', () =>
  fixture(({ databasePath, workspaceRoot, dependencies }) => {
    const port = createCleanWorkspaceProductPort({ ...dependencies, rootPath: workspaceRoot });
    const firstRoot = port.rootSnapshot();
    const first = port.materializeArtifact(request());
    const target = path.join(workspaceRoot, request().workspaceId, 'artifacts', 'movie.nfo');
    const originalBytes = fs.readFileSync(target);
    const reboundEndpoint = 'local-filesystem-linux';
    const reboundMount = 'local-mount-test-bind';
    const rootHandleRef = canonicalDigest({
      schema: 'platform.workspace-root-handle@1',
      rootId: firstRoot.rootId,
      endpointId: reboundEndpoint,
      mountScopeId: reboundMount,
      mountScopeRevision: firstRoot.mountScopeRevision,
      configRevision: 2,
      capabilityDigest: firstRoot.capabilityDigest,
    });
    const snapshotDigest = canonicalDigest({
      rootId: firstRoot.rootId,
      ownerScope: 'libra',
      rootKind: 'production-workspace',
      endpointId: reboundEndpoint,
      mountScopeId: reboundMount,
      mountScopeRevision: firstRoot.mountScopeRevision,
      configRevision: 2,
      capabilityDigest: firstRoot.capabilityDigest,
      state: 'active',
      rootHandleRef,
    });
    const seed = new Database(databasePath);
    seed.prepare(`UPDATE platform_workspace_roots
      SET config_revision=2, endpoint_id=?, mount_scope_id=?, root_handle_ref=?, snapshot_digest=?
      WHERE root_id=?`).run(
      reboundEndpoint, reboundMount, rootHandleRef, snapshotDigest, firstRoot.rootId,
    );
    seed.close();
    const restarted = createCleanWorkspaceProductPort({ ...dependencies, rootPath: workspaceRoot });
    const durable = restarted.rootSnapshot();
    assert.equal(durable.endpointId, reboundEndpoint);
    assert.equal(durable.mountScopeId, reboundMount);
    const row = new Database(databasePath, { readonly: true });
    try {
      const material = row.prepare(
        'SELECT endpoint_id, mount_scope_id, digest_hex FROM fx_workspace_materials',
      ).get();
      assert.equal(material.endpoint_id, reboundEndpoint);
      assert.equal(material.mount_scope_id, reboundMount);
      assert.equal(material.digest_hex, first.workspaceMaterialHandle.digestHex);
    } finally {
      row.close();
    }
    assert.deepEqual(fs.readFileSync(target), originalBytes);
    const replay = restarted.materializeArtifact(request());
    assert.equal(replay.replayed, true);
    assert.equal(replay.workspaceMaterialHandle.endpointId, reboundEndpoint);
    assert.equal(replay.workspaceMaterialHandle.physicalIdentity.mountScopeId, reboundMount);
  }));

test('unreferenced leftover Workspace materials are deleted and marked reclaimed', () =>
  fixture(({ databasePath, workspaceRoot, dependencies }) => {
    const port = createCleanWorkspaceProductPort({
      ...dependencies, rootPath: workspaceRoot, now: () => 1_700_000_100_000,
    });
    const first = port.materializeArtifact(request());
    const target = path.join(workspaceRoot, request().workspaceId, 'artifacts', 'movie.nfo');
    assert.equal(fs.existsSync(target), true);
    const result = port.reclaimUnreferencedWorkspace(request().workspaceId);
    assert.equal(result.reclaimedCount, 1);
    assert.equal(result.directoryRemoved, true);
    assert.equal(fs.existsSync(target), false);
    assert.equal(fs.existsSync(path.join(workspaceRoot, request().workspaceId)), false);
    const database = new Database(databasePath, { readonly: true });
    try {
      const row = database.prepare(
        'SELECT state, reclaimed_at_ms FROM fx_workspace_materials WHERE material_handle_id=?',
      ).get(first.workspaceMaterialHandle.handleId);
      assert.equal(row.state, 'reclaimed');
      assert.equal(Number(row.reclaimed_at_ms), 1_700_000_100_000);
    } finally {
      database.close();
    }
    const replay = port.reclaimUnreferencedWorkspace(request().workspaceId);
    assert.equal(replay.reclaimedCount, 0);
    assert.equal(replay.directoryRemoved, false);
  }));

test('producer partial siblings are removed with leftover Workspace reclaim', () =>
  fixture(({ workspaceRoot, dependencies }) => {
    const port = createCleanWorkspaceProductPort({ ...dependencies, rootPath: workspaceRoot });
    port.materializeArtifact(request());
    const workspaceId = request().workspaceId;
    const media = path.join(workspaceRoot, workspaceId, 'media');
    fs.mkdirSync(media, { recursive: true });
    const stale = path.join(media, 'transcode-1.mkv.partial-0123456789abcdef');
    fs.writeFileSync(stale, 'interrupted-encode');
    for (const suffix of ['', '.cutree', '.temp', '.cutree.temp']) fs.writeFileSync(stale + '.passlog' + suffix, 'x265 stats');
    const result = port.reclaimUnreferencedWorkspace(workspaceId);
    assert.equal(result.directoryRemoved, true);
    assert.equal(fs.existsSync(stale), false);
    assert.equal(fs.existsSync(path.join(workspaceRoot, workspaceId)), false);
  }));

test('empty Workspace reclaim drops producer partials and still rejects unknown files', () =>
  fixture(({ workspaceRoot, dependencies }) => {
    const port = createCleanWorkspaceProductPort({ ...dependencies, rootPath: workspaceRoot });
    const workspaceId = request().workspaceId;
    const media = path.join(workspaceRoot, workspaceId, 'media');
    fs.mkdirSync(media, { recursive: true });
    const stale = path.join(media, 'transcode-1.mkv.partial-fedcba9876543210');
    fs.writeFileSync(stale, 'orphan-partial');
    assert.equal(port.reclaimEmptyWorkspace(workspaceId).removed, true);
    assert.equal(fs.existsSync(path.join(workspaceRoot, workspaceId)), false);
    fs.mkdirSync(path.join(workspaceRoot, workspaceId), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, workspaceId, 'foreign.passlog'), 'not admitted');
    assert.throws(() => port.reclaimEmptyWorkspace(workspaceId),
      (error) => error.code === 'CLEAN_WORKSPACE_RECLAIM_UNKNOWN_MEMBER');
  }));

for (const crashPoint of ['physical', 'committed']) {
  test(`UAT-163 actual process loss ${crashPoint} preserves one cleanup effect and exact evidence`, () =>
    fixture(({databasePath,workspaceRoot,dependencies}) => {
      const {spawnSync}=require('node:child_process');
      const {buildEffectIntent}=require('../../src/helix/domains/libra/model/workspace-cleanup-contracts');
      const port=createCleanWorkspaceProductPort({...dependencies,rootPath:workspaceRoot});
      const handle=port.materializeArtifact(request()).workspaceMaterialHandle;
      const intent=buildEffectIntent({cleanupScopeId:'crash-cleanup',workspaceId:handle.workspaceId},{
        materialHandleId:handle.handleId,expectedReferenceRevision:1,expectedReferenceDigest:canonicalDigest('reference'),
        controlDisposition:'libra_owned',expectedControlRevision:1,expectedControlProjectionDigest:canonicalDigest('control'),
        expectedControlOwnerDomain:'libra',expectedControlOwnerScopeType:'libra_run',expectedControlOwnerScopeId:'run-1',
      },handle);
      const configPath=path.join(path.dirname(databasePath),'cleanup-config.json');
      const resultPath=path.join(path.dirname(databasePath),'cleanup-result.json');
      fs.writeFileSync(configPath,JSON.stringify({databasePath,workspaceRoot,intent,resultPath}));
      const worker=path.resolve(__dirname,'../fixtures/helix-workspace-cleanup-crash-worker.js');
      const interrupted=spawnSync(process.execPath,[worker,configPath,crashPoint],{encoding:'utf8',windowsHide:true});
      assert.equal(interrupted.status,crashPoint==='physical'?91:92,interrupted.stderr);
      assert.equal(fs.existsSync(path.join(workspaceRoot,handle.workspaceId,...handle.relativePath.split('/'))),false);
      const before=crashPoint==='committed'?JSON.parse(fs.readFileSync(resultPath,'utf8')):null;
      const db=new Database(databasePath,{readonly:true});
      try {
        const effect=db.prepare("SELECT state FROM fx_effect_journal WHERE effect_class='libra_workspace_material_reclaim'").all();
        assert.deepEqual(effect,[{state:crashPoint==='physical'?'intended':'committed'}]);
      } finally {db.close();}
      const resumed=spawnSync(process.execPath,[worker,configPath,'replay'],{encoding:'utf8',windowsHide:true});
      assert.equal(resumed.status,0,resumed.stderr);
      const result=JSON.parse(fs.readFileSync(resultPath,'utf8'));
      if(before)assert.deepEqual(result.deletionEvidence,before.deletionEvidence);
      else assert.equal(result.deletionEvidence.result,'already_absent');
      const finalDb=new Database(databasePath,{readonly:true});
      try {
        assert.equal(finalDb.prepare("SELECT count(*) n FROM fx_effect_journal WHERE effect_class='libra_workspace_material_reclaim' AND state='committed'").get().n,1);
        assert.equal(finalDb.prepare('SELECT state FROM fx_workspace_materials WHERE material_handle_id=?').get(handle.handleId).state,'reclaimed');
      } finally {finalDb.close();}
    }));
}
