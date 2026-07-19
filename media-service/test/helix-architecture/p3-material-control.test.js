'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { digest } = require('../../src/helix/foundation/persistence/ddl-compiler');
const { controlScopeDigest, createMaterialControlExactTransferParticipant, createMaterialControlParticipant, materialKey } = require('../../src/helix/foundation/persistence/material-control');
const { createRepositoryDefinition } = require('../../src/helix/foundation/persistence/owner-repository');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));

const subjects = createRepositoryDefinition({
  repositoryId: 'subjects', owner: 'libra', schemaManifest,
  statements: { insert: { kind: 'insert', tableId: 'libra_subjects', columns: ['subject_id', 'structure_kind', 'status', 'created_at_ms'] } }
});
const shelves = createRepositoryDefinition({
  repositoryId: 'shelves', owner: 'arca', schemaManifest,
  statements: { insert: { kind: 'insert', tableId: 'arca_shelves', columns: ['shelf_id', 'name', 'status', 'created_at_ms'] } }
});
const deregistrations = createRepositoryDefinition({
  repositoryId: 'deregistrations', owner: 'arca', schemaManifest,
  statements: { insert: { kind: 'insert', tableId: 'arca_deregistrations', columns: ['deregistration_id', 'shelf_id', 'state', 'created_at_ms'] } }
});
const markers = createRepositoryDefinition({
  repositoryId: 'markers', owner: 'execution-foundation', schemaManifest,
  statements: {
    insert: { kind: 'insert', tableId: 'fx_commit_markers', columns: ['commit_marker', 'owner_domain', 'scope_type', 'scope_id', 'commit_digest', 'committed_at_ms'] }
  }
});

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-material-control-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  let clock = 1700000000500;
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => clock++ });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  try {
    return run({ databasePath, kernel, unitOfWork });
  } finally {
    kernel.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function identity(name) {
  const value = {
    schemaRef: 'helix://contracts/types/PhysicalMaterialIdentity/v1',
    schemaVersion: 1,
    mountScopeId: 'mount-1',
    inode: BigInt('0x' + digest('inode-' + name).slice(0, 15)).toString(),
    contentHashAlgorithm: 'sha256',
    contentHash: digest('content-' + name)
  };
  value.materialKey = materialKey(value);
  return value;
}

const scope = (ownerDomain, scopeType, scopeId) => ({ ownerDomain, scopeType, scopeId });

function handle(operationKind, ownerDomain, changes, overrides = {}) {
  return {
    schemaRef: 'helix://contracts/types/ResponsibilityControlCommitHandle/v1',
    schemaVersion: 1,
    handleId: overrides.handleId || 'control-handle-' + operationKind,
    operationKind,
    ownerDomain,
    processType: 'test-process',
    processId: overrides.processId || 'process-1',
    basisRef: { objectType: 'test-basis', objectId: 'basis-1', revision: 1, digest: digest('basis-ref') },
    basisDigest: digest('basis'),
    canonicalFactSetDigest: digest('facts'),
    bindingSetDigest: digest('bindings'),
    controlScopeDigest: overrides.controlScopeDigest || controlScopeDigest(changes),
    expectedControlRevisions: changes.map((change) => ({ materialKey: change.identity.materialKey, revision: change.expectedRevision })),
    receiptContract: 'helix://contracts/types/TestControlReceipt/v1',
    eventFenceDigest: digest('fence'),
    ...(operationKind === 'transfer' ? { receivingDomain: overrides.receivingDomain, transferPoint: overrides.transferPoint || 'handoff-b-accepted' } : {})
  };
}

function markerParticipant(ownerDomain, markerId) {
  return {
    participantId: 'foundation', owner: 'execution-foundation', boundBusinessOwner: ownerDomain, repositories: [markers],
    execute(context) {
      context.repository('markers').invoke('insert', {
        commit_marker: markerId, owner_domain: ownerDomain, scope_type: 'control', scope_id: markerId,
        commit_digest: digest(markerId), committed_at_ms: context.commitTimeMs
      });
    }
  };
}

test('acquire, cross-Domain transfer, and release CAS one current row with append-only revisions', () => {
  fixture(({ databasePath, kernel, unitOfWork }) => {
    const material = identity('inode-a');
    const libraScope = scope('libra', 'subject', 'subject-1');
    const arcaScope = scope('arca', 'shelf_entry', 'entry-1');
    const acquire = { action: 'acquire', identity: material, expectedRevision: 0, fromScope: null, toScope: libraScope };
    unitOfWork.execute([
      {
        participantId: 'libra', owner: 'libra', repositories: [subjects],
        execute(context) { context.repository('subjects').invoke('insert', { subject_id: 'subject-1', structure_kind: 'movie', status: 'active', created_at_ms: context.commitTimeMs }); }
      },
      createMaterialControlParticipant({ schemaManifest, handle: handle('acquire', 'libra', [acquire]), changes: [acquire], commitMarker: 'marker-acquire' }),
      markerParticipant('libra', 'marker-acquire')
    ]);
    const transfer = { action: 'transfer', identity: material, expectedRevision: 1, fromScope: libraScope, toScope: arcaScope };
    unitOfWork.execute([
      {
        participantId: 'arca', owner: 'arca', repositories: [shelves],
        execute(context) { context.repository('shelves').invoke('insert', { shelf_id: 'shelf-1', name: 'Shelf', status: 'active', created_at_ms: context.commitTimeMs }); }
      },
      createMaterialControlParticipant({
        schemaManifest,
        handle: handle('transfer', 'libra', [transfer], { receivingDomain: 'arca' }),
        changes: [transfer], commitMarker: 'marker-transfer'
      }),
      markerParticipant('arca', 'marker-transfer')
    ]);
    const release = { action: 'release', identity: material, expectedRevision: 2, fromScope: arcaScope, toScope: null };
    unitOfWork.execute([
      {
        participantId: 'arca', owner: 'arca', repositories: [deregistrations],
        execute(context) { context.repository('deregistrations').invoke('insert', { deregistration_id: 'dereg-1', shelf_id: 'shelf-1', state: 'active', created_at_ms: context.commitTimeMs }); }
      },
      createMaterialControlParticipant({ schemaManifest, handle: handle('release', 'arca', [release]), changes: [release], commitMarker: 'marker-release' }),
      markerParticipant('arca', 'marker-release')
    ]);
    kernel.close();
    const database = new Database(databasePath, { readonly: true });
    const current = database.prepare('SELECT owner_domain,owner_scope_id,control_revision,state FROM fx_material_controls').get();
    assert.deepEqual(current, { owner_domain: null, owner_scope_id: null, control_revision: 3, state: 'released' });
    assert.deepEqual(database.prepare('SELECT revision,operation_kind FROM fx_material_control_revisions ORDER BY revision').all(), [
      { revision: 1, operation_kind: 'acquire' }, { revision: 2, operation_kind: 'transfer' }, { revision: 3, operation_kind: 'release' }
    ]);
    database.close();
  });
});
const procurementProbe = createRepositoryDefinition({
  repositoryId: 'procurement_probe', owner: 'procurement', schemaManifest,
  statements: { read: { kind:'select-all', tableId:'proc_material_fields', columns:['field_id'] } }
});
const procurementParticipant = () => ({ participantId:'procurement_probe', owner:'procurement', repositories:[procurementProbe],
  execute(context) { context.repository('procurement_probe').invoke('read', {}); } });

test('Procurement admission can assert exact same-Field Control without inventing a revision', () => {
  fixture(({ databasePath, kernel, unitOfWork }) => {
    const material = identity('inode-same-field');
    const fieldScope = scope('procurement', 'material_field', 'field-1');
    const acquire = { action:'acquire', identity:material, expectedRevision:0, fromScope:null, toScope:fieldScope };
    unitOfWork.execute([
      procurementParticipant(),
      createMaterialControlParticipant({ schemaManifest, handle:handle('acquire', 'procurement', [acquire]), changes:[acquire], commitMarker:'marker-acquire' }),
      markerParticipant('procurement', 'marker-acquire')
    ]);
    const assertion = { action:'assert_same_field', identity:material, expectedRevision:1, fromScope:fieldScope, toScope:null };
    const selectionDigest = digest('selection-scope');
    const assertionHandle = handle('acquire', 'procurement', [assertion], { controlScopeDigest:selectionDigest });
    const result = unitOfWork.execute([
      procurementParticipant(),
      createMaterialControlParticipant({ schemaManifest, handle:assertionHandle, changes:[assertion],
        authorizedScopeDigest:selectionDigest, commitMarker:'marker-assert' }),
      markerParticipant('procurement', 'marker-assert')
    ]).material_control;
    assert.equal(result[0].action, 'assert_same_field');
    assert.equal(result[0].revision, 1);
    kernel.close();
    const database = new Database(databasePath, { readonly:true });
    assert.equal(database.prepare('SELECT control_revision FROM fx_material_controls').get().control_revision, 1);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_material_control_revisions').get().count, 1);
    database.close();
  });
});

test('exact Handoff transfer recovers Physical Identity only from the Control owner row', () => {
  fixture(({ databasePath, kernel, unitOfWork }) => {
    const material=identity('handoff-key-only'),from=scope('procurement','material_field','field-1'),to=scope('libra','subject','subject-1');
    const acquire={action:'acquire',identity:material,expectedRevision:0,fromScope:null,toScope:from};
    unitOfWork.execute([procurementParticipant(),createMaterialControlParticipant({schemaManifest,
      handle:handle('acquire','procurement',[acquire]),changes:[acquire],commitMarker:'marker-key-acquire'}),
    markerParticipant('procurement','marker-key-acquire')]);
    const projection=require('../../src/helix/foundation/persistence/material-control').createMaterialControlProjectionPort({schemaManifest,unitOfWork})
      .getMaterialControlProjection(material.materialKey);
    const exact={materialKey:material.materialKey,expectedRevision:1,expectedProjectionDigest:projection.projectionDigest,fromScope:from,toScope:to};
    const signed=handle('transfer','libra',[{action:'transfer',identity:material,expectedRevision:1,fromScope:from,toScope:to}],
      {receivingDomain:'libra',transferPoint:'handoff_a_accepted',controlScopeDigest:digest('accepted-scope')});
    signed.receiptContract={receiptSchemaRef:'SubjectAndTransferReceipt@1',controlRevisionSetSchemaRef:'libra.handoff-a-transferred-control-set@1'};
    unitOfWork.execute([{participantId:'libra',owner:'libra',repositories:[subjects],execute(context){context.repository('subjects').invoke('insert',
      {subject_id:'subject-1',structure_kind:'movie',status:'active',created_at_ms:context.commitTimeMs});}},
    createMaterialControlExactTransferParticipant({schemaManifest,handle:signed,changes:[exact],authorizedScopeDigest:digest('accepted-scope'),
      commitMarker:'marker-key-transfer'}),markerParticipant('libra','marker-key-transfer')]);
    kernel.close();const database=new Database(databasePath,{readonly:true});
    assert.deepEqual(database.prepare('SELECT owner_domain,owner_scope_type,owner_scope_id,control_revision FROM fx_material_controls').get(),
      {owner_domain:'libra',owner_scope_type:'subject',owner_scope_id:'subject-1',control_revision:2});
    database.close();
  });
});

test('stale CAS or wrong from-scope rolls back Domain and Foundation participants', () => {
  fixture(({ databasePath, kernel, unitOfWork }) => {
    const material = identity('inode-b');
    const libraScope = scope('libra', 'subject', 'subject-1');
    const acquire = { action: 'acquire', identity: material, expectedRevision: 0, fromScope: null, toScope: libraScope };
    unitOfWork.execute([
      { participantId: 'libra', owner: 'libra', repositories: [subjects], execute(context) { context.repository('subjects').invoke('insert', { subject_id: 'subject-1', structure_kind: 'movie', status: 'active', created_at_ms: context.commitTimeMs }); } },
      createMaterialControlParticipant({ schemaManifest, handle: handle('acquire', 'libra', [acquire]), changes: [acquire], commitMarker: 'marker-1' }),
      markerParticipant('libra', 'marker-1')
    ]);
    const stale = { action: 'transfer', identity: material, expectedRevision: 0, fromScope: libraScope, toScope: scope('arca', 'shelf_entry', 'entry-1') };
    assert.throws(() => unitOfWork.execute([
      { participantId: 'arca', owner: 'arca', repositories: [shelves], execute(context) { context.repository('shelves').invoke('insert', { shelf_id: 'stale-shelf', name: 'Stale', status: 'active', created_at_ms: context.commitTimeMs }); } },
      createMaterialControlParticipant({ schemaManifest, handle: handle('transfer', 'libra', [stale], { receivingDomain: 'arca' }), changes: [stale], commitMarker: 'marker-stale' }),
      markerParticipant('arca', 'marker-stale')
    ]), (error) => error.code === 'P3_CONTROL_CAS_CONFLICT');
    const wrongFrom = { ...stale, expectedRevision: 1, fromScope: scope('libra', 'subject', 'wrong-subject') };
    assert.throws(() => unitOfWork.execute([
      { participantId: 'arca', owner: 'arca', repositories: [shelves], execute(context) { context.repository('shelves').invoke('insert', { shelf_id: 'wrong-shelf', name: 'Wrong', status: 'active', created_at_ms: context.commitTimeMs }); } },
      createMaterialControlParticipant({ schemaManifest, handle: handle('transfer', 'libra', [wrongFrom], { receivingDomain: 'arca' }), changes: [wrongFrom], commitMarker: 'marker-wrong' })
    ]), (error) => error.code === 'P3_CONTROL_FROM_SCOPE_MISMATCH');
    kernel.close();
    const database = new Database(databasePath, { readonly: true });
    assert.equal(database.prepare('SELECT COUNT(*) count FROM arca_shelves').get().count, 0);
    assert.equal(database.prepare('SELECT control_revision FROM fx_material_controls').get().control_revision, 1);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_commit_markers').get().count, 1);
    database.close();
  });
});

test('replace_control_set is all-or-nothing across its exact expected revision set', () => {
  fixture(({ databasePath, kernel, unitOfWork }) => {
    const [first, second] = [identity('inode-c'), identity('inode-d')]
      .sort((left, right) => left.materialKey.localeCompare(right.materialKey));
    const libraScope = scope('libra', 'subject', 'subject-1');
    const acquire = { action: 'acquire', identity: first, expectedRevision: 0, fromScope: null, toScope: libraScope };
    unitOfWork.execute([
      { participantId: 'libra', owner: 'libra', repositories: [subjects], execute(context) { context.repository('subjects').invoke('insert', { subject_id: 'subject-1', structure_kind: 'movie', status: 'active', created_at_ms: context.commitTimeMs }); } },
      createMaterialControlParticipant({ schemaManifest, handle: handle('acquire', 'libra', [acquire]), changes: [acquire], commitMarker: 'marker-initial' }),
      markerParticipant('libra', 'marker-initial')
    ]);
    const changes = [
      { action: 'release', identity: first, expectedRevision: 1, fromScope: libraScope, toScope: null },
      { action: 'acquire', identity: second, expectedRevision: 1, fromScope: null, toScope: libraScope }
    ].sort((left, right) => left.identity.materialKey.localeCompare(right.identity.materialKey));
    assert.throws(() => unitOfWork.execute([
      { participantId: 'libra', owner: 'libra', repositories: [subjects], execute(context) { context.repository('subjects').invoke('insert', { subject_id: 'subject-2', structure_kind: 'movie', status: 'active', created_at_ms: context.commitTimeMs }); } },
      createMaterialControlParticipant({ schemaManifest, handle: handle('replace_control_set', 'libra', changes), changes, commitMarker: 'marker-replace' })
    ]), (error) => error.code === 'P3_CONTROL_CAS_CONFLICT');
    kernel.close();
    const database = new Database(databasePath, { readonly: true });
    assert.equal(database.prepare("SELECT state FROM fx_material_controls WHERE material_key=?").get(first.materialKey).state, 'controlled');
    assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_material_control_revisions').get().count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM libra_subjects WHERE subject_id='subject-2'").get().count, 0);
    database.close();
  });
});

test('invalid material key, incomplete expected set, or scope digest is rejected', () => {
  const material = identity('inode-e');
  const change = { action: 'acquire', identity: material, expectedRevision: 0, fromScope: null, toScope: scope('libra', 'subject', 'subject-1') };
  assert.throws(() => createMaterialControlParticipant({
    schemaManifest, handle: handle('acquire', 'libra', [change], { controlScopeDigest: digest('wrong-scope') }), changes: [change], commitMarker: 'marker'
  }), (error) => error.code === 'P3_CONTROL_SCOPE_DIGEST_MISMATCH');
  const incomplete = handle('acquire', 'libra', [change]);
  incomplete.expectedControlRevisions = [];
  assert.throws(() => createMaterialControlParticipant({ schemaManifest, handle: incomplete, changes: [change], commitMarker: 'marker' }),
    (error) => error.code === 'P3_CONTROL_EXPECTED_SET_MISMATCH');
  fixture(({ databasePath, kernel, unitOfWork }) => {
    const invalid = { ...change, identity: { ...material, materialKey: digest('wrong-material-key') } };
    const invalidHandle = handle('acquire', 'libra', [invalid]);
    assert.throws(() => unitOfWork.execute([
      { participantId: 'libra', owner: 'libra', repositories: [subjects], execute(context) { context.repository('subjects').invoke('insert', { subject_id: 'subject-invalid', structure_kind: 'movie', status: 'active', created_at_ms: context.commitTimeMs }); } },
      createMaterialControlParticipant({ schemaManifest, handle: invalidHandle, changes: [invalid], commitMarker: 'marker-invalid' })
    ]), (error) => error.code === 'P3_CONTROL_MATERIAL_KEY_MISMATCH');
    kernel.close();
    const database = new Database(databasePath, { readonly: true });
    assert.equal(database.prepare("SELECT COUNT(*) count FROM libra_subjects WHERE subject_id='subject-invalid'").get().count, 0);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_material_controls').get().count, 0);
    database.close();
  });
});

test('startup rejects current/revision history drift', () => {
  fixture(({ databasePath, kernel, unitOfWork }) => {
    const material = identity('inode-f');
    const acquire = { action: 'acquire', identity: material, expectedRevision: 0, fromScope: null, toScope: scope('libra', 'subject', 'subject-1') };
    unitOfWork.execute([
      { participantId: 'libra', owner: 'libra', repositories: [subjects], execute(context) { context.repository('subjects').invoke('insert', { subject_id: 'subject-1', structure_kind: 'movie', status: 'active', created_at_ms: context.commitTimeMs }); } },
      createMaterialControlParticipant({ schemaManifest, handle: handle('acquire', 'libra', [acquire]), changes: [acquire], commitMarker: 'marker' })
    ]);
    kernel.close();
    const changed = new Database(databasePath);
    changed.exec('UPDATE fx_material_controls SET control_revision=2');
    changed.close();
    assert.throws(() => openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest }),
      (error) => error.code === 'P3_SQLITE_MATERIAL_CONTROL_DRIFT');
  });
});
