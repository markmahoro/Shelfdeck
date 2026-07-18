'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { digest } = require('../../src/helix/foundation/persistence/ddl-compiler');
const { controlScopeDigest, createMaterialControlParticipant, materialKey } = require('../../src/helix/foundation/persistence/material-control');
const { createRepositoryDefinition } = require('../../src/helix/foundation/persistence/owner-repository');
const { createOutboxParticipant } = require('../../src/helix/foundation/persistence/outbox-inbox');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const serviceRoot = path.resolve(__dirname, '../..');
const generatedRoot = path.join(serviceRoot, 'src/helix/foundation/persistence/generated');
const transactionRoot = path.join(serviceRoot, 'src/helix/contracts/transaction-contracts');
const tableRoot = path.join(serviceRoot, 'src/helix/contracts/table-contracts');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));
const tableManifest = new Map(schemaManifest.tables.map((entry) => [entry.tableId, entry]));
const tableContracts = new Map();
const SHA = digest('canonical-transaction-fixture');

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function tableContract(tableId) {
  if (!tableContracts.has(tableId)) {
    tableContracts.set(tableId, loadJson(path.join(tableRoot, tableId, 'v1/contract.json')).contract);
  }
  return tableContracts.get(tableId);
}

function contracts() {
  return fs.readdirSync(transactionRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => loadJson(path.join(transactionRoot, entry.name, 'v1/contract.json')).contract)
    .sort((left, right) => left.transactionId.localeCompare(right.transactionId));
}

function quote(identifier) {
  assert.match(identifier, /^[a-z][a-z0-9_]*$/);
  return '"' + identifier + '"';
}

function snapshot(databasePath, tableIds) {
  const database = new Database(databasePath, { readonly: true });
  try {
    return Object.fromEntries([...new Set(tableIds)].sort().map((tableId) => [
      tableId, database.prepare('SELECT * FROM ' + quote(tableId) + ' ORDER BY rowid').all()
    ]));
  } finally {
    database.close();
  }
}

function forbiddenTables(contract) {
  const result = new Set(contract.forbiddenWriteTables);
  for (const prefix of contract.forbiddenWritePrefixes) {
    for (const table of schemaManifest.tables) if (table.tableId.startsWith(prefix)) result.add(table.tableId);
  }
  return [...result].sort();
}

function orderedDomainTables(contract, owner) {
  const tables = contract.writeTables.filter((tableId) => tableManifest.get(tableId).owner === owner);
  if (contract.transactionId === 'helix.transaction.domain-fact-commit') tables.push('libra_subjects');
  const remaining = new Set(tables);
  const ordered = [];
  while (remaining.size > 0) {
    const ready = [...remaining].filter((tableId) => tableContract(tableId).foreignKeys.every((foreignKey) => foreignKey.deferrable ||
      !remaining.has(foreignKey.targetTable) || !foreignKey.columns.some((column) => tableContract(tableId).primaryKey.includes(column))
    )).sort();
    assert.ok(ready.length > 0, 'Domain fixture FK graph must be acyclic: ' + contract.transactionId);
    for (const tableId of ready) {
      remaining.delete(tableId);
      ordered.push(tableId);
    }
  }
  return ordered;
}

function columnIsNullableReference(contractTable, column) {
  if (contractTable.foreignKeys.some((foreignKey) => foreignKey.columns.includes(column) && !contractTable.primaryKey.includes(column))) return true;
  return contractTable.revisionContract.pointerTargets.some((pointer) => pointer.sourceColumns.includes(column));
}

function valueFor(tableId, column, definition, owner, sequence) {
  if (definition.enumValues.length > 0) return definition.enumValues[0];
  if (column.endsWith('_json')) return '{}';
  if (column.includes('digest') || column === 'content_hash' || column === 'material_key') return digest(tableId + '/' + column + '/' + sequence);
  if (column.endsWith('_schema_ref')) return 'helix://fixtures/' + tableId + '/v1';
  if (column.endsWith('_algorithm')) return 'sha256';
  if (column === 'owner_domain') return owner;
  if (definition.logicalType.startsWith('INTEGER')) return column.endsWith('_guard') ? 0 : 1;
  if (definition.logicalType === 'REAL' || definition.logicalType === 'INTEGER_OR_REAL') return 1;
  return tableId + '-' + column + '-' + sequence;
}

function domainRows(contract, owner) {
  const rows = new Map();
  let sequence = 0;
  for (const tableId of orderedDomainTables(contract, owner)) {
    sequence += 1;
    const contractTable = tableContract(tableId);
    const definitions = new Map(contractTable.columns.map((column) => [column.name, column]));
    for (const supportColumn of tableManifest.get(tableId).supportColumns) {
      definitions.set(supportColumn.name, { name: supportColumn.name, logicalType: 'INTEGER', enumValues: [] });
    }
    const row = {};
    for (const [column, definition] of definitions) {
      const foreignKey = contractTable.foreignKeys.find((candidate) => candidate.columns.includes(column));
      if (columnIsNullableReference(contractTable, column)) {
        row[column] = null;
        continue;
      }
      if (foreignKey && !rows.has(foreignKey.targetTable)) {
        row[column] = null;
        continue;
      }
      if (foreignKey && rows.has(foreignKey.targetTable)) {
        const offset = foreignKey.columns.indexOf(column);
        row[column] = rows.get(foreignKey.targetTable)[foreignKey.targetColumns[offset]];
        continue;
      }
      row[column] = valueFor(tableId, column, definition, owner, sequence);
    }
    if (tableId === 'people_registration_candidates') {
      row.candidate_json = JSON.stringify({ proposedName: row.proposed_name });
    }
    if (tableId === 'people_merge_candidates') {
      row.candidate_json = JSON.stringify({
        leftPersonRef: { personId: row.left_person_id, revision: row.left_person_revision },
        rightPersonRef: { personId: row.right_person_id, revision: row.right_person_revision }
      });
    }
    if (tableId === 'people_person_revisions') {
      const direct = contract.transactionId === 'helix.transaction.direct-person-registration';
      row.origin_kind = direct ? 'direct' : 'candidate';
      row.origin_decision_id = direct ? 'fixture-direct-registration' : null;
      row.origin_decision_digest = direct ? digest('fixture-direct-registration') : null;
      row.origin_candidate_kind = direct ? null : 'registration';
      row.origin_candidate_id = direct ? null : 'fixture-registration-candidate';
      row.origin_candidate_revision = direct ? null : 1;
      row.origin_candidate_payload_digest = direct ? null : digest('fixture-registration-candidate');
    }
    if (tableId === 'people_reference_assets' || tableId === 'people_reference_faces') {
      row.state = 'active';
      row.released_reference_revision = null;
      row.released_at_ms = null;
    }
    if (tableId === 'perception_resolution_revisions') {
      row.result_kind = 'not_found';
      row.winning_perception_id = null;
      row.reason_code = 'no_matching_record';
    }
    rows.set(tableId, row);
  }
  return rows;
}

function domainParticipant(contract, owner, expectedRevision = 0) {
  const rows = domainRows(contract, owner);
  const statements = {};
  let ordinal = 0;
  for (const [tableId, row] of rows) {
    ordinal += 1;
    statements['insert_' + String(ordinal).padStart(3, '0')] = { kind: 'insert', tableId, columns: Object.keys(row) };
  }
  const repository = createRepositoryDefinition({ repositoryId: 'fixture_domain', owner, schemaManifest, statements });
  return {
    participantId: 'fixture_domain', owner, repositories: [repository],
    execute(context) {
      if (expectedRevision !== 0) {
        const error = new Error('Fixture Domain revision fence failed');
        error.code = 'P3_FIXTURE_REVISION_FENCE';
        throw error;
      }
      let index = 0;
      for (const row of rows.values()) {
        index += 1;
        context.repository('fixture_domain').invoke('insert_' + String(index).padStart(3, '0'), row);
      }
      return rows.size;
    }
  };
}

function markerDefinition() {
  return createRepositoryDefinition({
    repositoryId: 'fixture_marker', owner: 'execution-foundation', schemaManifest,
    statements: { insert: { kind: 'insert', tableId: 'fx_commit_markers', columns: [
      'commit_marker', 'effect_id', 'owner_domain', 'scope_type', 'scope_id', 'commit_digest', 'committed_at_ms'
    ] } }
  });
}

function markerParticipant(contract, owner, marker) {
  const repository = markerDefinition();
  return {
    participantId: 'fixture_marker', owner: 'execution-foundation', boundBusinessOwner: owner, repositories: [repository],
    execute(context) {
      context.repository('fixture_marker').invoke('insert', {
        commit_marker: marker, effect_id: null, owner_domain: owner, scope_type: 'canonical_transaction',
        scope_id: contract.transactionId, commit_digest: digest(contract.transactionId), committed_at_ms: context.commitTimeMs
      });
    }
  };
}

function resultBindingParticipant(contract, owner) {
  const repository = createRepositoryDefinition({
    repositoryId: 'fixture_result_binding', owner: 'execution-foundation', schemaManifest,
    statements: { insert: { kind: 'insert', tableId: 'fx_event_result_bindings', columns: [
      'result_id', 'event_id', 'outcome_kind', 'result_schema_ref', 'result_json', 'result_digest',
      'evidence_schema_ref', 'evidence_json', 'evidence_digest', 'effect_receipt_id', 'committed_at_ms'
    ] } }
  });
  return {
    participantId: 'fixture_result_binding', owner: 'execution-foundation', boundBusinessOwner: owner, repositories: [repository],
    execute(context) {
      context.repository('fixture_result_binding').invoke('insert', {
        result_id: 'result-' + digest(contract.transactionId).slice(0, 16), event_id: null, outcome_kind: 'succeeded',
        result_schema_ref: 'helix://fixtures/CanonicalTransactionResult/v1', result_json: '{}', result_digest: digest('result/' + contract.transactionId),
        evidence_schema_ref: 'helix://fixtures/CanonicalTransactionEvidence/v1', evidence_json: '{}',
        evidence_digest: digest('evidence/' + contract.transactionId), effect_receipt_id: null, committed_at_ms: context.commitTimeMs
      });
    }
  };
}

function commandReceiptParticipant(contract, owner) {
  const repository = createRepositoryDefinition({
    repositoryId: 'fixture_command_receipt', owner: 'execution-foundation', schemaManifest,
    statements: { insert: { kind: 'insert', tableId: 'fx_command_receipts', columns: [
      'command_receipt_id', 'owner_domain', 'command_contract', 'caller_scope', 'idempotency_key',
      'request_digest', 'target_type', 'target_id', 'result_schema_ref', 'result_ref_json',
      'result_digest', 'committed_at_ms'
    ] } }
  });
  return {
    participantId: 'fixture_command_receipt', owner: 'execution-foundation', boundBusinessOwner: owner, repositories: [repository],
    execute(context) {
      const id = contract.transactionId;
      context.repository('fixture_command_receipt').invoke('insert', {
        command_receipt_id: 'receipt-' + digest(id).slice(0, 16), owner_domain: owner,
        command_contract: id, caller_scope: 'canonical-transaction-fixture', idempotency_key: id,
        request_digest: digest('request/' + id), target_type: 'person', target_id: 'fixture-person',
        result_schema_ref: 'helix://fixtures/CanonicalCommandResult/v1', result_ref_json: '{}',
        result_digest: digest('command-result/' + id), committed_at_ms: context.commitTimeMs
      });
    }
  };
}

function identity(label) {
  const result = {
    schemaRef: 'helix://contracts/types/PhysicalMaterialIdentity/v1', schemaVersion: 1,
    mountScopeId: 'fixture-mount', inode: BigInt('0x' + digest('inode/' + label).slice(0, 15)).toString(), contentHashAlgorithm: 'sha256', contentHash: digest('content/' + label)
  };
  result.materialKey = materialKey(result);
  return result;
}

function controlHandle(operationKind, ownerDomain, changes, suffix, extra = {}) {
  return {
    schemaRef: 'helix://contracts/types/ResponsibilityControlCommitHandle/v1', schemaVersion: 1,
    handleId: 'control-' + suffix, operationKind, ownerDomain, processType: 'canonical_transaction', processId: suffix,
    basisRef: { objectType: 'fixture', objectId: suffix, revision: 1, digest: digest('basis-ref/' + suffix) },
    basisDigest: digest('basis/' + suffix), canonicalFactSetDigest: digest('facts/' + suffix),
    bindingSetDigest: digest('bindings/' + suffix), controlScopeDigest: controlScopeDigest(changes),
    expectedControlRevisions: changes.map((change) => ({ materialKey: change.identity.materialKey, revision: change.expectedRevision })),
    receiptContract: 'helix://fixtures/ControlReceipt/v1', eventFenceDigest: digest('fence/' + suffix), ...extra
  };
}

function seedControl(unitOfWork, owner, material, suffix) {
  const target = { ownerDomain: owner, scopeType: 'fixture', scopeId: suffix };
  const change = { action: 'acquire', identity: material, expectedRevision: 0, fromScope: null, toScope: target };
  const anchorTable = schemaManifest.tables.find((table) => table.owner === owner);
  const anchorRepository = createRepositoryDefinition({
    repositoryId: 'seed_owner_anchor', owner, schemaManifest,
    statements: { read: { kind: 'select-all', tableId: anchorTable.tableId, columns: [anchorTable.columns[0]] } }
  });
  unitOfWork.execute([{
    participantId: 'seed_owner_anchor', owner, repositories: [anchorRepository], execute() {}
  }, createMaterialControlParticipant({
    schemaManifest, handle: controlHandle('acquire', owner, [change], 'seed-' + suffix), changes: [change],
    commitMarker: 'seed-' + suffix, participantId: 'seed_control'
  })]);
  return target;
}

function controlParticipant(contract, owner, unitOfWork, stale = false) {
  const id = contract.transactionId;
  const marker = 'marker-' + digest(id).slice(0, 16);
  const incoming = identity(id + '/incoming');
  let operationKind = 'acquire';
  let handleOwner = owner;
  let changes;
  let extra = {};
  if (id === 'helix.transaction.handoff-a-accepted' || id === 'helix.transaction.handoff-b-accepted') {
    const upstream = id.includes('handoff-a') ? 'procurement' : 'libra';
    const fromScope = seedControl(unitOfWork, upstream, incoming, id);
    const toScope = { ownerDomain: owner, scopeType: 'fixture', scopeId: id };
    operationKind = 'transfer';
    handleOwner = upstream;
    extra = { receivingDomain: owner, transferPoint: id.includes('handoff-a') ? 'handoff_a_accepted' : 'handoff_b_accepted' };
    changes = [{ action: 'transfer', identity: incoming, expectedRevision: stale ? 2 : 1, fromScope, toScope }];
  } else if (['libra-run-discard-commit', 'libra-subject-abandon-commit', 'libra-workspace-cleanup-commit',
    'off-deck-terminal', 'shelf-deregistration-commit'].some((name) => id.endsWith(name))) {
    const fromScope = seedControl(unitOfWork, owner, incoming, id);
    operationKind = 'release';
    changes = [{ action: 'release', identity: incoming, expectedRevision: stale ? 2 : 1, fromScope, toScope: null }];
  } else if (id.endsWith('aftercare-inventory-commit') || id.endsWith('on-deck-commit')) {
    const outgoing = identity(id + '/outgoing');
    const fromScope = seedControl(unitOfWork, owner, outgoing, id);
    operationKind = 'replace_control_set';
    changes = [
      { action: 'acquire', identity: incoming, expectedRevision: stale ? 1 : 0, fromScope: null,
        toScope: { ownerDomain: owner, scopeType: 'fixture', scopeId: id } },
      { action: 'release', identity: outgoing, expectedRevision: 1, fromScope, toScope: null }
    ];
  } else {
    changes = [{ action: 'acquire', identity: incoming, expectedRevision: stale ? 1 : 0, fromScope: null,
      toScope: { ownerDomain: owner, scopeType: 'fixture', scopeId: id } }];
  }
  return createMaterialControlParticipant({
    schemaManifest, handle: controlHandle(operationKind, handleOwner, changes, id, extra), changes,
    commitMarker: marker, participantId: 'fixture_control'
  });
}

function outboxParticipant(contract, owner) {
  const id = contract.transactionId;
  return createOutboxParticipant({
    schemaManifest, participantId: 'fixture_outbox', producerDomain: owner,
    messages: [{
      messageId: 'message-' + digest(id).slice(0, 16), producerDomain: owner, messageKind: 'canonical.transaction.committed',
      aggregateType: 'canonical_transaction', aggregateId: id, aggregateRevision: 1, dedupKey: id,
      intendedConsumers: [owner === 'perception' ? 'libra' : 'perception'],
      payloadSchemaRef: 'helix://fixtures/CanonicalTransactionCommitted/v1', payload: { transactionId: id, factDigest: SHA }
    }]
  });
}

function businessOwner(contract) {
  return contract.ownerScope === 'polymorphic-domain-owner' ? 'libra' : contract.ownerScope;
}

function participantsFor(contract, unitOfWork, options = {}) {
  const owner = businessOwner(contract);
  const result = [domainParticipant(contract, owner, options.expectedRevision || 0)];
  if (contract.fenceContract.materialControlCasRequired) result.push(controlParticipant(contract, owner, unitOfWork, options.staleControl));
  if (contract.writeTables.includes('fx_event_result_bindings')) result.push(resultBindingParticipant(contract, owner));
  if (contract.writeTables.includes('fx_command_receipts')) result.push(commandReceiptParticipant(contract, owner));
  if (contract.fenceContract.commitMarkerRequired) result.push(markerParticipant(contract, owner, 'marker-' + digest(contract.transactionId).slice(0, 16)));
  if (contract.fenceContract.outboxRequired) result.push(outboxParticipant(contract, owner));
  return result;
}

function withFault(participants, fault) {
  if (!fault) return participants;
  if (fault.kind === 'before_commit') {
    const repository = markerDefinition();
    return [...participants, {
      participantId: 'fixture_precommit_fault', owner: 'execution-foundation',
      boundBusinessOwner: participants[0].owner, repositories: [repository],
      execute() { throw Object.assign(new Error('fault before commit'), { code: 'P3_FIXTURE_FAULT' }); }
    }];
  }
  return participants.map((participant, index) => index !== fault.index ? participant : {
    ...participant,
    execute(context) {
      if (fault.kind === 'before') throw Object.assign(new Error('fault before participant'), { code: 'P3_FIXTURE_FAULT' });
      const result = participant.execute(context);
      throw Object.assign(new Error('fault after participant'), { code: 'P3_FIXTURE_FAULT', result });
    }
  });
}

function fixture(contract, run, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-canonical-transaction-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  let clock = 1700000000700;
  let kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => clock++ });
  try {
    const unitOfWork = createSqliteUnitOfWork({ kernel });
    const participants = participantsFor(contract, unitOfWork, options);
    const observedTables = [...new Set([...contract.writeTables,
      ...(contract.transactionId === 'helix.transaction.domain-fact-commit' ? ['libra_subjects'] : []), ...forbiddenTables(contract)])];
    const before = snapshot(databasePath, observedTables);
    const result = run({ before, databasePath, kernel, observedTables, participants, unitOfWork });
    return result;
  } finally {
    kernel.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const transactionContracts = contracts();

test('P2 canonical transaction inventory drives exactly 26 isolated contracts', () => {
  const inventory = loadJson(path.join(serviceRoot, 'src/helix/contracts/manifests/transaction-inventory.json'));
  const inventoryEntries = inventory.entryFiles.flatMap((file) =>
    loadJson(path.join(serviceRoot, 'src/helix/contracts/manifests', file)).entries
  );
  assert.equal(transactionContracts.length, 26);
  assert.equal(inventory.targetCount, 26);
  assert.deepEqual(transactionContracts.map((contract) => contract.transactionId),
    [...inventoryEntries].sort((left, right) => left.id.localeCompare(right.id)).map((entry) => entry.id));
  for (const contract of transactionContracts) {
    assert.equal(contract.rollbackInvariant.includes('zero transaction writes visible'), true, contract.transactionId);
    assert.equal(contract.fenceContract.domainRevisionFenceRequired, true, contract.transactionId);
    assert.equal(contract.fenceContract.commitMarkerRequired, contract.writeTables.includes('fx_commit_markers'), contract.transactionId);
  }
});

for (const contract of transactionContracts) {
  test(contract.transactionId + ' rolls back before/after every participant and before COMMIT', () => {
    const participantCount = fixture(contract, ({ participants }) => participants.length);
    const faults = [{ kind: 'before_commit' }];
    for (let index = 0; index < participantCount; index += 1) faults.push({ kind: 'before', index }, { kind: 'after', index });
    for (const fault of faults) fixture(contract, ({ before, databasePath, observedTables, participants, unitOfWork }) => {
      assert.throws(() => unitOfWork.execute(withFault(participants, fault)), (error) => error.code === 'P3_FIXTURE_FAULT');
      assert.deepEqual(snapshot(databasePath, observedTables), before, JSON.stringify({ transactionId: contract.transactionId, fault }));
    });
  });

  test(contract.transactionId + ' rejects revision-fence drift with zero visible writes', () => {
    fixture(contract, ({ before, databasePath, observedTables, participants, unitOfWork }) => {
      assert.throws(() => unitOfWork.execute(participants), (error) => error.code === 'P3_FIXTURE_REVISION_FENCE');
      assert.deepEqual(snapshot(databasePath, observedTables), before);
    }, { expectedRevision: 1 });
  });

  if (contract.fenceContract.materialControlCasRequired) {
    test(contract.transactionId + ' rejects stale Material Control CAS with zero visible writes', () => {
      fixture(contract, ({ before, databasePath, observedTables, participants, unitOfWork }) => {
        assert.throws(() => unitOfWork.execute(participants), (error) => error.code === 'P3_CONTROL_CAS_CONFLICT');
        assert.deepEqual(snapshot(databasePath, observedTables), before);
      }, { staleControl: true });
    });
  }

  test(contract.transactionId + ' exposes the full declared fact set after post-COMMIT crash', () => {
    fixture(contract, ({ before, databasePath, kernel, observedTables, participants, unitOfWork }) => {
      unitOfWork.execute(participants);
      const committed = snapshot(databasePath, observedTables);
      for (const tableId of contract.writeTables) assert.notDeepEqual(committed[tableId], before[tableId], tableId);
      if (contract.transactionId === 'helix.transaction.domain-fact-commit') {
        assert.notDeepEqual(committed.libra_subjects, before.libra_subjects);
      }
      for (const tableId of forbiddenTables(contract)) assert.deepEqual(committed[tableId], before[tableId], tableId);
      kernel.close();
      const reopened = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 1700000000900 });
      reopened.close();
      assert.deepEqual(snapshot(databasePath, observedTables), committed);
    });
  });
}

test('canonical crash harness is test-only and performs no external effect', () => {
  assert.equal(fs.existsSync(path.join(serviceRoot, 'src/helix/foundation/persistence/canonical-transaction-fixture.js')), false);
  assert.equal(fs.existsSync(path.join(serviceRoot, 'data/shelfdeck.db')), false);
});
