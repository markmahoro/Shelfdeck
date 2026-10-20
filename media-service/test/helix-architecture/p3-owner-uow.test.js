'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { createRepositoryDefinition } = require('../../src/helix/foundation/persistence/owner-repository');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));

test('bounded Owner summaries retain exact integer watermarks and reject executable or foreign definitions',()=>temporaryKernel(({kernel})=>{
  kernel.runPrimitive(({prepare})=>{prepare('INSERT INTO fx_audit_records(audit_id,owner_domain,occurred_at_ms) VALUES(?,?,?)').run('large','arca',9223372036854775806n);
    prepare('INSERT INTO fx_audit_records(audit_id,owner_domain,occurred_at_ms) VALUES(?,?,?)').run('other','people',10);});
  const statement={kind:'select-summary',tableId:'fx_audit_records',keyColumns:['owner_domain'],summaries:[{operator:'count',output:'rows'},
    {operator:'max',column:'occurred_at_ms',output:'watermark'}]},definition=createRepositoryDefinition({repositoryId:'audit_summary',owner:'execution-foundation',schemaManifest,statements:{summary:statement}}),
    uow=createSqliteUnitOfWork({kernel}),read=owner=>uow.execute([{participantId:'summary',owner:'execution-foundation',repositories:[definition],execute:context=>
      context.repository(definition.repositoryId).invoke('summary',{owner_domain:owner})}]).summary;
  assert.equal(definition.readOnly,true);assert.deepEqual(read('arca'),{rows:1n,watermark:9223372036854775806n});assert.deepEqual(read('missing'),{rows:0n,watermark:null});
  for(const summaries of [[{operator:'count; DROP TABLE fx_audit_records',output:'rows'}],[{operator:'max',column:'unknown',output:'rows'}],
    [{operator:'count',column:'audit_id',output:'rows'}],[{operator:'count',output:'bad;sql'}]])
    assert.throws(()=>createRepositoryDefinition({repositoryId:'invalid_summary',owner:'execution-foundation',schemaManifest,statements:{summary:{...statement,summaries}}}));
  assert.throws(()=>createRepositoryDefinition({repositoryId:'foreign_summary',owner:'libra',schemaManifest,statements:{summary:statement}}),{code:'P3_REPOSITORY_OWNER_MISMATCH'});
}));

test('opaque read-view fences reject any intervening commit without admitting foreign Owner repositories',()=>temporaryKernel(({kernel,databasePath})=>{
  const uow=createSqliteUnitOfWork({kernel}),definition=createRepositoryDefinition({repositoryId:'fenced_audit_read',owner:'execution-foundation',schemaManifest,readOnly:true,
    statements:{count:{kind:'select-summary',tableId:'fx_audit_records',summaries:[{operator:'count',output:'rows'}]}}}),
    participants=[{participantId:'fenced',owner:'execution-foundation',repositories:[definition],execute:tx=>tx.repository(definition.repositoryId).invoke('count')}],
    read=readFence=>uow.execute(participants,{readFence}).fenced;
  const stable=uow.captureReadFence();assert.deepEqual(read(stable),{rows:0n});assert.deepEqual(read(stable),{rows:0n},'Unchanged readonly views remain reusable.');
  assert.throws(()=>read(Object.freeze({})),{code:'P3_UOW_READ_FENCE_CHANGED'});
  const foreign=createSqliteUnitOfWork({kernel}).captureReadFence();assert.throws(()=>read(foreign),{code:'P3_UOW_READ_FENCE_CHANGED'});
  kernel.runPrimitive(({prepare})=>prepare('INSERT INTO fx_audit_records(audit_id,owner_domain) VALUES(?,?)').run('own-write','people'));
  assert.throws(()=>read(stable),{code:'P3_UOW_READ_FENCE_CHANGED'});
  const externalFence=uow.captureReadFence(),external=new Database(databasePath);try{external.prepare('INSERT INTO fx_audit_records(audit_id,owner_domain) VALUES(?,?)').run('external-write','arca');}finally{external.close();}
  assert.throws(()=>read(externalFence),{code:'P3_UOW_READ_FENCE_CHANGED'});assert.deepEqual(read(uow.captureReadFence()),{rows:2n});
  const stale=uow.captureReadFence();kernel.runPrimitive(({prepare})=>prepare('INSERT INTO fx_audit_records(audit_id,owner_domain) VALUES(?,?)').run('decorated-write','people'));
  const decorated={...uow,execute(participants){return uow.execute(participants);}};
  assert.throws(()=>decorated.execute([{...participants[0],execute(){decorated.assertReadFence(stale);}}],{readFence:stale}),{code:'P3_UOW_READ_FENCE_CHANGED'},'A wrapper dropping optional execute arguments cannot bypass the explicit in-transaction guard.');
}));

function temporaryKernel(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-owner-uow-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 1700000000200 });
  try {
    return run({ kernel, databasePath });
  } finally {
    kernel.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const libraSubjects = createRepositoryDefinition({
  repositoryId: 'libra_subjects', owner: 'libra', schemaManifest,
  statements: {
    insert_subject: { kind: 'insert', tableId: 'libra_routing_policy_revisions', columns: ['routing_policy_id','revision','field_id','mode','policy_schema_ref','policy_json','policy_digest','effective_at_ms'] },
    find_subject: { kind: 'select-one', tableId: 'libra_routing_policy_revisions', columns: ['routing_policy_id','revision'], keyColumns: ['routing_policy_id','revision'] }
  }
});
const foundationAudit = createRepositoryDefinition({
  repositoryId: 'foundation_audit', owner: 'execution-foundation', schemaManifest,
  statements: {
    insert_audit: { kind: 'insert', tableId: 'fx_audit_records', columns: ['audit_id', 'owner_domain', 'occurred_at_ms'] }
  }
});
const materialControl = createRepositoryDefinition({
  repositoryId: 'material_control', owner: 'material-control-authority', schemaManifest,
  statements: {
    insert_control: { kind: 'insert', tableId: 'fx_material_controls', columns: ['material_key', 'owner_domain', 'control_revision', 'state', 'updated_at_ms'] }
  }
});
const arcaShelves = createRepositoryDefinition({
  repositoryId: 'arca_shelves', owner: 'arca', schemaManifest,
  statements: {
    insert_shelf: { kind: 'insert', tableId: 'arca_shelves', columns: ['shelf_id', 'name', 'status', 'created_at_ms'] }
  }
});
const platformRootRead = createRepositoryDefinition({
  repositoryId: 'platform_root_read', owner: 'platform-settings', schemaManifest,
  statements: {
    find_root: { kind: 'select-one', tableId: 'platform_workspace_roots', columns: ['root_id', 'state'], keyColumns: ['root_id'] }
  }
});
const platformRootWrite = createRepositoryDefinition({
  repositoryId: 'platform_root_write', owner: 'platform-settings', schemaManifest,
  statements: {
    insert_root: { kind: 'insert', tableId: 'platform_workspace_roots', columns: [
      'root_id', 'owner_scope', 'root_kind', 'endpoint_id', 'mount_scope_id', 'mount_scope_revision', 'resolved_root',
      'config_revision', 'capability_digest', 'state', 'root_handle_ref', 'snapshot_digest', 'updated_at_ms'
    ] }
  }
});

test('allows only an Owner-bound read-only Platform participant in a Domain unit of work', () => {
  temporaryKernel(({ kernel }) => {
    const unitOfWork = createSqliteUnitOfWork({ kernel });
    const participants = [
      { participantId: 'libra', owner: 'libra', repositories: [libraSubjects], execute() {} },
      { participantId: 'platform_read', owner: 'platform-settings', boundBusinessOwner: 'libra',
        repositories: [platformRootRead], execute(context) {
          return context.repository('platform_root_read').invoke('find_root', { root_id: 'missing' });
        } }
    ];
    assert.equal(unitOfWork.execute(participants).platform_read, undefined);
    assert.throws(() => unitOfWork.execute([participants[0], { ...participants[1], boundBusinessOwner: undefined }]),
      (error) => error.code === 'P3_UOW_PLATFORM_OWNER_MIX');
    assert.throws(() => unitOfWork.execute([participants[0], { ...participants[1], repositories: [platformRootWrite] }]),
      (error) => error.code === 'P3_UOW_PLATFORM_OWNER_MIX');
  });
});

test('commits one Domain plus separate Control and Foundation participants with one commit time', () => {
  temporaryKernel(({ kernel, databasePath }) => {
    const unitOfWork = createSqliteUnitOfWork({ kernel });
    const results = unitOfWork.execute([
      {
        participantId: 'libra', owner: 'libra', repositories: [libraSubjects],
        execute(context) {
          context.repository('libra_subjects').invoke('insert_subject', {
            routing_policy_id:'subject-1',revision:1,field_id:'fixture-field',mode:'direct',policy_schema_ref:'helix://fixtures/routing-policy/v1',policy_json:'{}',policy_digest:'a'.repeat(64),effective_at_ms:context.commitTimeMs
          });
          return context.commitTimeMs;
        }
      },
      {
        participantId: 'control', owner: 'material-control-authority', repositories: [materialControl],
        execute(context) {
          context.repository('material_control').invoke('insert_control', {
            material_key: 'material-1', owner_domain: 'libra', control_revision: 1, state: 'controlled', updated_at_ms: context.commitTimeMs
          });
          return context.commitTimeMs;
        }
      },
      {
        participantId: 'foundation', owner: 'execution-foundation', repositories: [foundationAudit],
        execute(context) {
          context.repository('foundation_audit').invoke('insert_audit', {
            audit_id: 'audit-1', owner_domain: 'libra', occurred_at_ms: context.commitTimeMs
          });
          return context.commitTimeMs;
        }
      }
    ]);
    assert.equal(new Set(Object.values(results)).size, 1);
    kernel.close();
    const inspected = new Database(databasePath, { readonly: true });
    assert.equal(inspected.prepare('SELECT COUNT(*) count FROM libra_routing_policy_revisions').get().count, 1);
    assert.equal(inspected.prepare('SELECT COUNT(*) count FROM fx_material_controls').get().count, 1);
    assert.equal(inspected.prepare('SELECT COUNT(*) count FROM fx_audit_records').get().count, 1);
    inspected.close();
  });
});

test('rolls back every Owner participant when any participant fails', () => {
  temporaryKernel(({ kernel }) => {
    const unitOfWork = createSqliteUnitOfWork({ kernel });
    assert.throws(() => unitOfWork.execute([
      {
        participantId: 'libra', owner: 'libra', repositories: [libraSubjects],
        execute(context) {
          context.repository('libra_subjects').invoke('insert_subject', {
            routing_policy_id:'rollback-subject',revision:1,field_id:'fixture-field',mode:'direct',policy_schema_ref:'helix://fixtures/routing-policy/v1',policy_json:'{}',policy_digest:'b'.repeat(64),effective_at_ms:context.commitTimeMs
          });
        }
      },
      {
        participantId: 'foundation', owner: 'execution-foundation', repositories: [foundationAudit],
        execute() { throw new Error('participant crash'); }
      }
    ]), /participant crash/);
    const result = createSqliteUnitOfWork({ kernel }).execute([{
      participantId: 'libra_read', owner: 'libra', repositories: [libraSubjects],
      execute: (context) => context.repository('libra_subjects').invoke('find_subject', { routing_policy_id:'rollback-subject',revision:1 })
    }]);
    assert.equal(result.libra_read, undefined);
  });
});

test('rejects raw SQL, unknown columns, cross-Owner tables, and immutable UPDATE registration', () => {
  assert.throws(() => createRepositoryDefinition({
    repositoryId: 'raw', owner: 'libra', schemaManifest,
    statements: { raw: { kind: 'insert', tableId: 'libra_subjects', columns: ['subject_id'], sql: 'DELETE FROM arca_shelves' } }
  }), (error) => error.code === 'P3_REPOSITORY_RAW_SQL_FORBIDDEN');
  assert.throws(() => createRepositoryDefinition({
    repositoryId: 'unknown_column', owner: 'libra', schemaManifest,
    statements: { insert: { kind: 'insert', tableId: 'libra_subjects', columns: ['arca_state'] } }
  }), (error) => error.code === 'P3_REPOSITORY_UNKNOWN_COLUMN');
  assert.throws(() => createRepositoryDefinition({
    repositoryId: 'wrong_owner', owner: 'libra', schemaManifest,
    statements: { insert: { kind: 'insert', tableId: 'arca_shelves', columns: ['shelf_id'] } }
  }), (error) => error.code === 'P3_REPOSITORY_OWNER_MISMATCH');
  assert.throws(() => createRepositoryDefinition({
    repositoryId: 'mutable_package', owner: 'procurement', schemaManifest,
    statements: { update: { kind: 'update', tableId: 'proc_candidate_packages', setColumns: ['state'], keyColumns: ['candidate_package_id'] } }
  }), (error) => error.code === 'P3_REPOSITORY_IMMUTABLE_UPDATE');
});

test('allows a Material Control-only transaction bound to one Business Owner', () => {
  temporaryKernel(({ kernel, databasePath }) => {
    const unitOfWork = createSqliteUnitOfWork({ kernel });
    unitOfWork.execute([{
      participantId: 'arca_staged_custody_control',
      owner: 'material-control-authority',
      boundBusinessOwner: 'arca',
      repositories: [materialControl],
      execute(context) {
        context.repository('material_control').invoke('insert_control', {
          material_key: 'material-arca-1', owner_domain: 'arca', control_revision: 1, state: 'controlled',
          updated_at_ms: context.commitTimeMs,
        });
      },
    }]);
    kernel.close();
    const inspected = new Database(databasePath, { readonly: true });
    assert.equal(inspected.prepare('SELECT COUNT(*) count FROM fx_material_controls').get().count, 1);
    inspected.close();
  });
});

test('rejects cross-Domain authority, Foundation obtaining Domain Repository, and undeclared Repository lookup', () => {
  temporaryKernel(({ kernel }) => {
    const unitOfWork = createSqliteUnitOfWork({ kernel });
    assert.throws(() => unitOfWork.execute([
      { participantId: 'libra', owner: 'libra', repositories: [libraSubjects], execute() {} },
      { participantId: 'arca', owner: 'arca', repositories: [arcaShelves], execute() {} }
    ]), (error) => error.code === 'P3_UOW_CROSS_DOMAIN_WRITE');
    assert.throws(() => unitOfWork.execute([
      { participantId: 'foundation', owner: 'execution-foundation', repositories: [libraSubjects], execute() {} }
    ]), (error) => error.code === 'P3_UOW_REPOSITORY_OWNER_MISMATCH');
    assert.throws(() => unitOfWork.execute([{
      participantId: 'libra', owner: 'libra', repositories: [libraSubjects],
      execute(context) { context.repository('arca_shelves'); }
    }]), (error) => error.code === 'P3_UOW_UNDECLARED_REPOSITORY');
    assert.throws(() => unitOfWork.execute([{
      participantId: '__proto__', owner: 'libra', repositories: [libraSubjects], execute() {}
    }]), (error) => error.code === 'P3_UOW_INVALID_PARTICIPANT');
  });
});

test('expires participant authority and rejects async or nested authority escape', () => {
  temporaryKernel(({ kernel }) => {
    const unitOfWork = createSqliteUnitOfWork({ kernel });
    let escapedContext;
    let escapedRepository;
    unitOfWork.execute([{
      participantId: 'libra', owner: 'libra', repositories: [libraSubjects],
      execute(context) {
        escapedContext = context;
        escapedRepository = context.repository('libra_subjects');
      }
    }]);
    assert.throws(() => escapedContext.repository('libra_subjects'), (error) => error.code === 'P3_UOW_CONTEXT_EXPIRED');
    assert.throws(() => escapedRepository.invoke('find_subject', { subject_id: 'none' }), (error) => error.code === 'P3_REPOSITORY_CONTEXT_EXPIRED');
    assert.throws(() => unitOfWork.execute([{
      participantId: 'async', owner: 'libra', repositories: [libraSubjects], execute: async () => null
    }]), (error) => error.code === 'P3_UOW_ASYNC_PARTICIPANT');
    assert.throws(() => unitOfWork.execute([{
      participantId: 'outer', owner: 'libra', repositories: [libraSubjects],
      execute() { unitOfWork.execute([{ participantId: 'inner', owner: 'libra', repositories: [libraSubjects], execute() {} }]); }
    }]), (error) => error.code === 'P3_SQLITE_NESTED_TRANSACTION');
  });
});
