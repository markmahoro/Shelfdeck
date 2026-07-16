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
    insert_subject: { kind: 'insert', tableId: 'libra_subjects', columns: ['subject_id', 'structure_kind', 'status', 'created_at_ms'] },
    find_subject: { kind: 'select-one', tableId: 'libra_subjects', columns: ['subject_id', 'status'], keyColumns: ['subject_id'] }
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

test('commits one Domain plus separate Control and Foundation participants with one commit time', () => {
  temporaryKernel(({ kernel, databasePath }) => {
    const unitOfWork = createSqliteUnitOfWork({ kernel });
    const results = unitOfWork.execute([
      {
        participantId: 'libra', owner: 'libra', repositories: [libraSubjects],
        execute(context) {
          context.repository('libra_subjects').invoke('insert_subject', {
            subject_id: 'subject-1', structure_kind: 'movie', status: 'active', created_at_ms: context.commitTimeMs
          });
          return context.commitTimeMs;
        }
      },
      {
        participantId: 'control', owner: 'material-control-authority', repositories: [materialControl],
        execute(context) {
          context.repository('material_control').invoke('insert_control', {
            material_key: 'material-1', owner_domain: 'libra', control_revision: 1, state: 'active', updated_at_ms: context.commitTimeMs
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
    assert.equal(inspected.prepare('SELECT COUNT(*) count FROM libra_subjects').get().count, 1);
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
            subject_id: 'rollback-subject', structure_kind: 'movie', status: 'active', created_at_ms: context.commitTimeMs
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
      execute: (context) => context.repository('libra_subjects').invoke('find_subject', { subject_id: 'rollback-subject' })
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
