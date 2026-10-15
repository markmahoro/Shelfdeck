'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { createCommandCommitCoordinator } = require('../../src/helix/foundation/persistence/commit-foundation');
const { digest } = require('../../src/helix/foundation/persistence/ddl-compiler');
const { createRepositoryDefinition } = require('../../src/helix/foundation/persistence/owner-repository');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));

const subjects = createRepositoryDefinition({
  repositoryId: 'subjects', owner: 'libra', schemaManifest,
  statements: {
    insert_subject: { kind: 'insert', tableId: 'libra_routing_policy_revisions', columns: ['routing_policy_id','revision','field_id','mode','policy_schema_ref','policy_json','policy_digest','effective_at_ms'] }
  }
});

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-commit-foundation-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 1700000000300 });
  const coordinator = createCommandCommitCoordinator({
    schemaManifest, unitOfWork: createSqliteUnitOfWork({ kernel })
  });
  try {
    return run({ coordinator, databasePath, kernel });
  } finally {
    kernel.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function request(overrides = {}) {
  const subjectId = overrides.subjectId || 'subject-1';
  return {
    command: {
      commandReceiptId: overrides.commandReceiptId || 'receipt-1',
      ownerDomain: 'libra',
      commandContract: 'helix.command.libra.subject.create/v1',
      callerScope: 'admin',
      idempotencyKey: overrides.idempotencyKey || 'key-1',
      requestDigest: overrides.requestDigest || digest('request-1'),
      targetType: 'subject',
      targetId: subjectId
    },
    domainParticipant: overrides.domainParticipant || {
      participantId: 'libra_domain', owner: 'libra', repositories: [subjects],
      execute(context) {
        context.repository('subjects').invoke('insert_subject', {
          routing_policy_id:subjectId,revision:1,field_id:'fixture-field',mode:'direct',policy_schema_ref:'helix://fixtures/routing-policy/v1',policy_json:'{}',policy_digest:digest({subjectId}),effective_at_ms:context.commitTimeMs
        });
        return { subjectId };
      }
    },
    commitMarker: {
      commitMarker: overrides.commitMarker || 'marker-1',
      effectId: null,
      scopeType: 'subject',
      scopeId: subjectId,
      commitDigest: overrides.commitDigest || digest('commit-1')
    },
    auditRecords: overrides.auditRecords || [{
      auditId: overrides.auditId || 'audit-1', actorType: 'admin', actorId: 'actor-1',
      action: 'subject.create', scopeType: 'subject', scopeId: subjectId, evidenceDigest: digest('evidence-1')
    }],
    resultEnvelope: overrides.resultEnvelope || ((domainResult) => ({
      resultSchemaRef: 'helix://contracts/types/SubjectCreateResult/v1',
      resultRef: { subjectId: domainResult.subjectId }
    }))
  };
}

function counts(databasePath) {
  const database = new Database(databasePath, { readonly: true });
  try {
    return {
      subjects: database.prepare('SELECT COUNT(*) count FROM libra_routing_policy_revisions').get().count,
      receipts: database.prepare('SELECT COUNT(*) count FROM fx_command_receipts').get().count,
      markers: database.prepare('SELECT COUNT(*) count FROM fx_commit_markers').get().count,
      audits: database.prepare('SELECT COUNT(*) count FROM fx_audit_records').get().count
    };
  } finally {
    database.close();
  }
}

test('read-only command validators run before Owner writes and after receipt replay',()=>fixture(({coordinator,databasePath})=>{
  const reads=createRepositoryDefinition({repositoryId:'validation_reads',owner:'execution-foundation',schemaManifest,statements:{
    receipts:{kind:'select-all',tableId:'fx_command_receipts',columns:['command_receipt_id'],keyColumns:['owner_domain']}}});
  let validated=0;
  const input={...request(),validationParticipants:[{participantId:'validation',owner:'execution-foundation',boundBusinessOwner:'libra',repositories:[reads],
    execute(c){validated++;assert.equal(c.repository('validation_reads').invoke('receipts',{owner_domain:'libra'}).length,0);}}]};
  assert.equal(coordinator.execute(input).replayed,false);assert.equal(validated,1);
  assert.equal(coordinator.execute(input).replayed,true);assert.equal(validated,1);
  assert.deepEqual(counts(databasePath),{subjects:1,receipts:1,markers:1,audits:1});
}));
test('failed read validation leaves no domain fact, receipt, marker or audit',()=>fixture(({coordinator,databasePath})=>{
  const reads=createRepositoryDefinition({repositoryId:'validation_reads',owner:'libra',schemaManifest,statements:{
    find:{kind:'select-all',tableId:'libra_routing_policy_revisions',columns:['routing_policy_id'],keyColumns:['field_id']}}});
  assert.throws(()=>coordinator.execute({...request(),validationParticipants:[{participantId:'validation',owner:'libra',repositories:[reads],
    execute(){throw Object.assign(new Error('Current evidence changed.'),{code:'EVIDENCE_STALE'});}}]}),{code:'EVIDENCE_STALE'});
  assert.deepEqual(counts(databasePath),{subjects:0,receipts:0,markers:0,audits:0});
}));

test('bound Platform Workspace root validation is read-only, replay-safe and cannot read other Platform tables',()=>fixture(({coordinator,databasePath})=>{
  const roots=createRepositoryDefinition({repositoryId:'workspace_root_validation',owner:'platform-settings',schemaManifest,statements:{
    root:{kind:'select-one',tableId:'platform_workspace_roots',columns:['root_id','owner_scope','state'],keyColumns:['root_id']}}});
  const other=createRepositoryDefinition({repositoryId:'platform_integration_validation',owner:'platform-settings',schemaManifest,statements:{
    integration:{kind:'select-one',tableId:'platform_integrations',columns:['integration_id'],keyColumns:['integration_id']}}});
  let checked=0;const participant={participantId:'workspace_root_validation',owner:'platform-settings',boundBusinessOwner:'libra',repositories:[roots],
    execute(c){checked++;assert.equal(c.repository(roots.repositoryId).invoke('root',{root_id:'absent-root'}),undefined);}};
  for(const invalid of [{...participant,boundBusinessOwner:'arca'},{...participant,boundBusinessOwner:undefined},{...participant,repositories:[other]},
    {...participant,repositories:[roots,other]},{...participant,repositories:[null]}])
    assert.throws(()=>coordinator.execute({...request(),validationParticipants:[invalid]}),{code:'P3_COMMAND_VALIDATION_PARTICIPANT_INVALID'});
  assert.deepEqual(counts(databasePath),{subjects:0,receipts:0,markers:0,audits:0});
  const input={...request(),validationParticipants:[participant]};assert.equal(coordinator.execute(input).replayed,false);assert.equal(checked,1);
  assert.equal(coordinator.execute(input).replayed,true);assert.equal(checked,1);
}));
test('command validators cannot inject writes, foreign owners or unbounded participants',()=>fixture(({coordinator})=>{
  for(const validations of [[{participantId:'write',owner:'libra',repositories:[subjects],execute(){}}],
    [{participantId:'foreign',owner:'people',repositories:[subjects],execute(){}}],Array.from({length:9},()=>({})),{},null,false])
    assert.throws(()=>coordinator.execute({...request(),validationParticipants:validations}),{code:'P3_COMMAND_VALIDATION_PARTICIPANT_INVALID'});
}));

test('commits Owner fact, Command Receipt, global marker, and append-only Audit with one time', () => {
  fixture(({ coordinator, databasePath, kernel }) => {
    const result = coordinator.execute(request());
    assert.equal(result.replayed, false);
    assert.equal(result.receipt.resultDigest, digest(JSON.stringify({ subjectId: 'subject-1' })));
    kernel.close();
    assert.deepEqual(counts(databasePath), { subjects: 1, receipts: 1, markers: 1, audits: 1 });
    const database = new Database(databasePath, { readonly: true });
    const times = database.prepare(
      'SELECT (SELECT effective_at_ms FROM libra_routing_policy_revisions) domain_time, (SELECT committed_at_ms FROM fx_command_receipts) receipt_time, (SELECT committed_at_ms FROM fx_commit_markers) marker_time, (SELECT occurred_at_ms FROM fx_audit_records) audit_time'
    ).get();
    database.close();
    assert.equal(new Set(Object.values(times)).size, 1);
  });
});

test('same key and digest replays typed Result without executing Domain or writing new facts', () => {
  fixture(({ coordinator, databasePath, kernel }) => {
    const first = coordinator.execute(request());
    const replay = coordinator.execute(request({
      domainParticipant: {
        participantId: 'libra_domain', owner: 'libra', repositories: [subjects],
        execute() { throw new Error('Domain must not execute on replay'); }
      }
    }));
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.receipt, first.receipt);
    kernel.close();
    assert.deepEqual(counts(databasePath), { subjects: 1, receipts: 1, markers: 1, audits: 1 });
  });
});

test('same key with different request digest is rejected before Domain execution', () => {
  fixture(({ coordinator, databasePath, kernel }) => {
    coordinator.execute(request());
    let called = false;
    assert.throws(() => coordinator.execute(request({
      requestDigest: digest('different-request'),
      domainParticipant: {
        participantId: 'libra_domain', owner: 'libra', repositories: [subjects], execute() { called = true; }
      }
    })), (error) => error.code === 'P3_COMMAND_IDEMPOTENCY_CONFLICT');
    assert.equal(called, false);
    kernel.close();
    assert.deepEqual(counts(databasePath), { subjects: 1, receipts: 1, markers: 1, audits: 1 });
  });
});

test('Domain failure leaves no receipt, marker, audit, or canonical fact', () => {
  fixture(({ coordinator, databasePath, kernel }) => {
    assert.throws(() => coordinator.execute(request({
      domainParticipant: {
        participantId: 'libra_domain', owner: 'libra', repositories: [subjects],
        execute(context) {
          context.repository('subjects').invoke('insert_subject', {
            routing_policy_id:'subject-1',revision:1,field_id:'fixture-field',mode:'direct',policy_schema_ref:'helix://fixtures/routing-policy/v1',policy_json:'{}',policy_digest:digest({subjectId:'subject-1'}),effective_at_ms:context.commitTimeMs
          });
          throw new Error('domain crash');
        }
      }
    })), /domain crash/);
    kernel.close();
    assert.deepEqual(counts(databasePath), { subjects: 0, receipts: 0, markers: 0, audits: 0 });
  });
});

test('marker, Audit, or Result constraint failure rolls back the Owner fact and receipt', () => {
  fixture(({ coordinator, databasePath, kernel }) => {
    coordinator.execute(request());
    assert.throws(() => coordinator.execute(request({
      subjectId: 'subject-2', commandReceiptId: 'receipt-2', idempotencyKey: 'key-2',
      requestDigest: digest('request-2'), commitMarker: 'marker-1', auditId: 'audit-2'
    })), /UNIQUE constraint failed: fx_commit_markers.commit_marker/);
    assert.throws(() => coordinator.execute(request({
      subjectId: 'subject-3', commandReceiptId: 'receipt-3', idempotencyKey: 'key-3',
      requestDigest: digest('request-3'), commitMarker: 'marker-3', commitDigest: digest('commit-3'), auditId: 'audit-1'
    })), /UNIQUE constraint failed: fx_audit_records.audit_id/);
    assert.throws(() => coordinator.execute(request({
      subjectId: 'subject-4', commandReceiptId: 'receipt-4', idempotencyKey: 'key-4',
      requestDigest: digest('request-4'), commitMarker: 'marker-4', commitDigest: digest('commit-4'), auditId: 'audit-4',
      resultEnvelope: () => ({
        resultSchemaRef: 'helix://contracts/types/SubjectCreateResult/v1', resultRef: { oversized: 'x'.repeat(17000) }
      })
    })), (error) => error.code === 'P3_COMMAND_RESULT_TOO_LARGE');
    kernel.close();
    assert.deepEqual(counts(databasePath), { subjects: 1, receipts: 1, markers: 1, audits: 1 });
  });
});

test('Commit Marker and Audit contracts cannot register UPDATE or DELETE statements', () => {
  for (const [repositoryId, tableId, keyColumn] of [
    ['marker_mutation', 'fx_commit_markers', 'commit_marker'],
    ['audit_mutation', 'fx_audit_records', 'audit_id']
  ]) {
    assert.throws(() => createRepositoryDefinition({
      repositoryId, owner: 'execution-foundation', schemaManifest,
      statements: { update: { kind: 'update', tableId, setColumns: ['owner_domain'], keyColumns: [keyColumn] } }
    }), (error) => error.code === 'P3_REPOSITORY_IMMUTABLE_UPDATE');
    assert.throws(() => createRepositoryDefinition({
      repositoryId, owner: 'execution-foundation', schemaManifest,
      statements: { remove: { kind: 'delete', tableId, keyColumns: [keyColumn] } }
    }), (error) => error.code === 'P3_REPOSITORY_UNSUPPORTED_STATEMENT');
  }
});
