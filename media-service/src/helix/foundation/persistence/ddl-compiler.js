'use strict';

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const LOGICAL_TYPES = Object.freeze({
  TEXT: 'TEXT',
  TEXT_JSON: 'TEXT',
  INTEGER: 'INTEGER',
  INTEGER_BOOLEAN: 'INTEGER',
  REAL: 'REAL',
  INTEGER_OR_REAL: 'NUMERIC'
});
const NON_NEGATIVE_REVISION_COLUMNS = new Set([
  'proc_run_materials.expected_control_revision',
  'proc_procurement_retry_intent_materials.expected_control_revision',
  'libra_subject_continuity_heads.current_revision',
  'libra_intake_decisions.expected_continuity_head_revision',
  'libra_decision_basis_revisions.expected_head_revision',
  'libra_decision_basis_inputs.input_revision'
]);

// These are implementation-only projection guards. Their writers and startup
// consistency checks are introduced by later P3 work packages. Each guard is
// justified by a P2 rule whose predicate depends on another table's current state.
const SUPPORT_COLUMNS = Object.freeze({
  arca_inventory_materials: [{
    name: 'active_guard', type: 'INTEGER', defaultSql: '0',
    checks: ['"active_guard" IN (0, 1)'], ruleOrdinal: 1
  }],
  people_provider_identities: [{
    name: 'active_guard', type: 'INTEGER', defaultSql: '0',
    checks: ['"active_guard" IN (0, 1)'], ruleOrdinal: 1
  }]
});

const PARTIAL_UNIQUE = Object.freeze({
  arca_acceptance_attempts: [{ columns: ['package_digest', 'standard_revision', 'placement_revision'], where: '"finished_at_ms" IS NULL' }],
  arca_aftercare_cases: [{ columns: ['care_basis_digest', 'finding_set_digest', 'care_requirement_digest'], where: '"terminal_at_ms" IS NULL' }],
  arca_inventory_materials: [{ columns: ['material_key'], where: '"role" = \'primary\' AND "active_guard" = 1' }],
  arca_offdeck_reservations: [{ columns: ['shelf_entry_id'], where: '"state" = \'active\'' }],
  arca_offdeck_review_candidates: [{ columns: ['shelf_entry_id', 'policy_id', 'policy_revision', 'reason_digest'], where: '"state" = \'open\'' }],
  arca_rule_template_drafts: [{ columns: ['rule_template_id'], where: '1 = 1' }],
  arca_shelf_entries: [{ columns: ['shelf_id', 'canonical_identity_key'], where: '"status" = \'active\' AND "structure_kind" = \'season\'' }],
  fx_event_attempts: [{ columns: ['event_id'], where: '"state" = \'executing\'' }],
  fx_event_result_bindings: [{ columns: ['event_id'], where: '1 = 1' }],
  fx_work_attempts: [{ columns: ['work_id'], where: '"state" IN (\'ready\', \'running\', \'blocked\')' }],
  libra_intake_decisions: [{ columns: ['candidate_package_id', 'package_digest'], where: '"decision_kind" = \'accepted_resolution\'' }],
  libra_handoff_a_receipts: [{ columns: ['candidate_package_id', 'package_digest'], where: '"outcome" = \'accepted\'' }],
  libra_runs: [{ columns: ['subject_id', 'acceptance_spec_id', 'run_scope_digest'], where: '"terminal_at_ms" IS NULL' }],
  people_merge_candidates: [{ columns: ['left_person_id', 'right_person_id'], where: '"current_state" = \'open\'' }],
  people_provider_identities: [{ columns: ['provider', 'namespace', 'provider_key'], where: '"active_guard" = 1' }],
  people_registration_candidates: [{ columns: ['evidence_digest'], where: '"current_state" = \'open\'' }],
  perception_acquisitions: [{ columns: ['perception_source_id'], where: '"state" = \'active\'' }],
  proc_candidate_deliveries: [{ columns: ['candidate_package_id'], where: '"state" = \'open\'' }],
  proc_procurement_retry_intents: [{ columns: ['failed_run_id', 'failed_basis_digest'], where: '"state" IN (\'open\', \'consumed\')' }],
  proc_procurement_runs: [
    { columns: ['seal_decision_id'], where: '"seal_decision_id" IS NOT NULL' },
    { columns: ['retry_intent_id'], where: '"retry_intent_id" IS NOT NULL' }
  ],
  proc_run_materials: [{ columns: ['material_key'], where: '"selection_state" IN (\'run_selection\', \'candidate_delivery\')' }]
});

const FOREIGN_KEY_OVERRIDES = Object.freeze({
  people_persons: [{ columns: ['person_id', 'current_reference_revision'], targetTable: 'people_reference_revisions',
    targetColumns: ['person_id', 'revision'], deletePolicy: 'RESTRICT', deferrable: true }],
  people_reference_assets: [
    { columns: ['person_id', 'created_reference_revision'], targetTable: 'people_reference_revisions', targetColumns: ['person_id', 'revision'], deletePolicy: 'RESTRICT', deferrable: true },
    { columns: ['person_id', 'released_reference_revision'], targetTable: 'people_reference_revisions', targetColumns: ['person_id', 'revision'], deletePolicy: 'RESTRICT', deferrable: true }
  ],
  people_reference_faces: [
    { columns: ['person_id', 'created_reference_revision'], targetTable: 'people_reference_revisions', targetColumns: ['person_id', 'revision'], deletePolicy: 'RESTRICT', deferrable: true },
    { columns: ['person_id', 'released_reference_revision'], targetTable: 'people_reference_revisions', targetColumns: ['person_id', 'revision'], deletePolicy: 'RESTRICT', deferrable: true }
  ],
  people_reference_revisions: [
    { columns: ['reference_asset_id'], targetTable: 'people_reference_assets', targetColumns: ['reference_asset_id'], deletePolicy: 'RESTRICT' },
    { columns: ['reference_face_id'], targetTable: 'people_reference_faces', targetColumns: ['reference_face_id'], deletePolicy: 'RESTRICT' }
  ]
});

const TABLE_CHECKS = Object.freeze({
  libra_decision_basis_inputs: [
    '("input_kind" = \'decision_head_snapshot\' AND "input_revision" >= 0) OR ' +
      '("input_kind" <> \'decision_head_snapshot\' AND "input_revision" >= 1)'
  ],
  perception_records: [
    '"rating" IS NULL OR ("rating" = CAST("rating" AS INTEGER) AND "rating" BETWEEN 1 AND 5)',
    '"watched_state" IS NULL OR "watched_state" IN (0, 1)'
  ],
  perception_resolution_revisions: [
    '("result_kind" = \'found\' AND "winning_perception_id" IS NOT NULL AND "reason_code" IS NULL) OR ' +
      '("result_kind" = \'not_found\' AND "winning_perception_id" IS NULL AND "reason_code" IN ' +
      '(\'no_matching_record\', \'requested_fact_absent\', \'strongest_value_conflict\'))'
  ],
  people_registration_candidates: [
    '"proposed_name" = json_extract("candidate_json", \'$.proposedName\')'
  ],
  people_merge_candidates: [
    '"left_person_id" = json_extract("candidate_json", \'$.leftPersonRef.personId\')',
    '"left_person_revision" = json_extract("candidate_json", \'$.leftPersonRef.revision\')',
    '"right_person_id" = json_extract("candidate_json", \'$.rightPersonRef.personId\')',
    '"right_person_revision" = json_extract("candidate_json", \'$.rightPersonRef.revision\')'
  ],
  people_person_revisions: [
    '("origin_kind" = \'direct\' AND "origin_decision_id" IS NOT NULL AND "origin_decision_digest" IS NOT NULL AND ' +
      '"origin_candidate_kind" IS NULL AND "origin_candidate_id" IS NULL AND "origin_candidate_revision" IS NULL AND "origin_candidate_payload_digest" IS NULL) OR ' +
      '("origin_kind" = \'candidate\' AND "origin_decision_id" IS NULL AND "origin_decision_digest" IS NULL AND ' +
      '"origin_candidate_kind" IS NOT NULL AND "origin_candidate_id" IS NOT NULL AND "origin_candidate_revision" IS NOT NULL AND "origin_candidate_payload_digest" IS NOT NULL)'
  ],
  people_reference_assets: [
    '("state" = \'active\' AND "released_reference_revision" IS NULL AND "released_at_ms" IS NULL) OR ' +
      '("state" = \'released\' AND "released_reference_revision" IS NOT NULL AND "released_at_ms" IS NOT NULL)'
  ],
  people_reference_faces: [
    '("state" = \'active\' AND "released_reference_revision" IS NULL AND "released_at_ms" IS NULL) OR ' +
      '("state" = \'released\' AND "released_reference_revision" IS NOT NULL AND "released_at_ms" IS NOT NULL)'
  ]
});

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
  return value;
}

function digest(value) {
  const input = typeof value === 'string' ? value : JSON.stringify(canonicalize(value));
  const bytes = Array.from(new TextEncoder().encode(input));
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let shift = 56; shift >= 32; shift -= 8) bytes.push(0);
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((bitLength >>> shift) & 0xff);
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  const state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const rotateRight = (word, count) => (word >>> count) | (word << (32 - count));
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Array(64);
    for (let index = 0; index < 16; index += 1) {
      const base = offset + index * 4;
      words[index] = ((bytes[base] << 24) | (bytes[base + 1] << 16) | (bytes[base + 2] << 8) | bytes[base + 3]) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(words[index - 15], 7) ^ rotateRight(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rotateRight(words[index - 2], 17) ^ rotateRight(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const upper = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const first = (h + upper + choose + constants[index] + words[index]) >>> 0;
      const lower = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const second = (lower + majority) >>> 0;
      h = g; g = f; f = e; e = (d + first) >>> 0; d = c; c = b; b = a; a = (first + second) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0; state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0; state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0; state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0; state[7] = (state[7] + h) >>> 0;
  }
  return state.map((word) => word.toString(16).padStart(8, '0')).join('');
}

function quoteIdentifier(value) {
  if (!IDENTIFIER.test(value)) throw new Error('P3_DDL_INVALID_IDENTIFIER:' + value);
  return '"' + value + '"';
}

function requireColumns(contract, names, context) {
  const available = new Set([
    ...contract.columns.map((column) => column.name),
    ...(SUPPORT_COLUMNS[contract.tableId] || []).map((column) => column.name)
  ]);
  for (const name of names) {
    if (!available.has(name)) throw new Error('P3_DDL_UNKNOWN_COLUMN:' + context + ':' + name);
  }
}

function checkClauses(column, tableId) {
  const quoted = quoteIdentifier(column.name);
  const checks = [];
  if (column.enumValues.length > 0) {
    checks.push(quoted + ' IN (' + column.enumValues.map((value) => "'" + value.replaceAll("'", "''") + "'").join(', ') + ')');
  }
  if (column.logicalType === 'INTEGER_BOOLEAN') checks.push(quoted + ' IN (0, 1)');
  if (column.name.endsWith('_digest') || column.name === 'digest' || column.name.endsWith('digest_hex')) {
    checks.push('length(' + quoted + ') = 64 AND ' + quoted + " NOT GLOB '*[^0-9a-f]*'");
  }
  if (column.logicalType === 'INTEGER' && (['initial_cursor_revision', 'expected_cursor_revision', 'expected_revision'].includes(column.name) ||
      NON_NEGATIVE_REVISION_COLUMNS.has(tableId + '.' + column.name))) {
    checks.push(quoted + ' >= 0');
  } else if (column.logicalType === 'INTEGER' && (column.name === 'revision' || column.name.endsWith('_revision'))) {
    checks.push(quoted + ' >= 1');
  } else if (column.logicalType === 'INTEGER' && /(?:_at_ms|_ms|_ns|_count|_bytes|_ordinal|^ordinal$|^rank$|_slots$)/.test(column.name)) {
    checks.push(quoted + ' >= 0');
  }
  return checks;
}

function compileColumn(column, primaryKey, tableId) {
  const sqliteType = LOGICAL_TYPES[column.logicalType];
  if (!sqliteType) throw new Error('P3_DDL_UNSUPPORTED_LOGICAL_TYPE:' + column.logicalType);
  const parts = [quoteIdentifier(column.name), sqliteType];
  if (primaryKey.length === 1 && primaryKey[0] === column.name) parts.push('PRIMARY KEY');
  for (const check of checkClauses(column, tableId)) parts.push('CHECK (' + check + ')');
  return parts.join(' ');
}

function foreignKeysFor(contract) {
  const candidates = [
    ...contract.foreignKeys,
    ...(FOREIGN_KEY_OVERRIDES[contract.tableId] || []),
    ...contract.revisionContract.pointerTargets.map((pointer) => ({
      columns: pointer.sourceColumns,
      targetTable: pointer.targetTable,
      targetColumns: pointer.targetColumns,
      deletePolicy: pointer.deletePolicy,
      deferrable: pointer.deferrable
    }))
  ];
  const seen = new Set();
  return candidates.filter((foreignKey) => {
    if (!foreignKey.targetTable || foreignKey.deletePolicy !== 'RESTRICT') {
      throw new Error('P3_DDL_UNRESOLVED_FOREIGN_KEY:' + contract.tableId + ':' + foreignKey.columns.join('+'));
    }
    const key = JSON.stringify([foreignKey.columns, foreignKey.targetTable, foreignKey.targetColumns]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compileTable(contract, allContracts) {
  if (!IDENTIFIER.test(contract.tableId) || contract.columns.length === 0 || contract.primaryKey.length === 0) {
    throw new Error('P3_DDL_INVALID_TABLE_CONTRACT:' + (contract.tableId || '<missing>'));
  }
  const columnNames = contract.columns.map((column) => column.name);
  if (new Set(columnNames).size !== columnNames.length) throw new Error('P3_DDL_DUPLICATE_COLUMN:' + contract.tableId);
  requireColumns(contract, contract.primaryKey, contract.tableId + ':primary-key');
  for (const column of contract.columns.filter((item) => /(?:^|_)(?:state|status)$/.test(item.name))) {
    if (column.enumValues.length === 0 && column.logicalType !== 'INTEGER_BOOLEAN') {
      throw new Error('P3_DDL_UNBOUNDED_STATE:' + contract.tableId + '.' + column.name);
    }
  }

  const definitions = contract.columns.map((column) => compileColumn(column, contract.primaryKey, contract.tableId));
  const supportColumns = SUPPORT_COLUMNS[contract.tableId] || [];
  for (const column of supportColumns) {
    definitions.push(quoteIdentifier(column.name) + ' ' + column.type + ' NOT NULL DEFAULT ' + column.defaultSql + ' ' + column.checks.map((check) => 'CHECK (' + check + ')').join(' '));
  }
  if (contract.primaryKey.length > 1) definitions.push('PRIMARY KEY (' + contract.primaryKey.map(quoteIdentifier).join(', ') + ')');
  for (const unique of contract.uniqueConstraints) {
    requireColumns(contract, unique, contract.tableId + ':unique');
    definitions.push('UNIQUE (' + unique.map(quoteIdentifier).join(', ') + ')');
  }
  for (const json of contract.jsonContracts) {
    requireColumns(contract, [json.column], contract.tableId + ':json');
    if (!json.requiresJsonValidCheck || ![4096, 16384, 65536].includes(json.maxBytes)) {
      throw new Error('P3_DDL_UNSUPPORTED_JSON_CONTRACT:' + contract.tableId + '.' + json.column);
    }
    definitions.push('CHECK (json_valid(' + quoteIdentifier(json.column) + '))');
    definitions.push('CHECK (length(CAST(' + quoteIdentifier(json.column) + ' AS BLOB)) <= ' + json.maxBytes + ')');
    if (json.schemaRefColumn) requireColumns(contract, [json.schemaRefColumn], contract.tableId + ':json-schema-ref');
  }
  for (const check of TABLE_CHECKS[contract.tableId] || []) definitions.push('CHECK (' + check + ')');
  for (const foreignKey of foreignKeysFor(contract)) {
    requireColumns(contract, foreignKey.columns, contract.tableId + ':foreign-key');
    const target = allContracts.get(foreignKey.targetTable);
    if (!target) throw new Error('P3_DDL_UNKNOWN_FOREIGN_TABLE:' + contract.tableId + ':' + foreignKey.targetTable);
    requireColumns(target, foreignKey.targetColumns, contract.tableId + ':foreign-target');
    definitions.push('FOREIGN KEY (' + foreignKey.columns.map(quoteIdentifier).join(', ') + ') REFERENCES ' + quoteIdentifier(foreignKey.targetTable) + ' (' + foreignKey.targetColumns.map(quoteIdentifier).join(', ') + ') ON DELETE RESTRICT' +
      (foreignKey.deferrable ? ' DEFERRABLE INITIALLY DEFERRED' : ''));
  }
  const sql = 'CREATE TABLE ' + quoteIdentifier(contract.tableId) + ' (\n  ' + definitions.join(',\n  ') + '\n);';
  return { sql, supportColumns };
}

function compileIndexes(contract) {
  const indexes = [];
  contract.hotIndexes.forEach((columns, ordinal) => {
    const expressions = columns.map((value) => {
      if (IDENTIFIER.test(value)) {
        requireColumns(contract, [value], contract.tableId + ':hot-index');
        return quoteIdentifier(value);
      }
      const coalesce = value.match(/^COALESCE\(([a-z][a-z0-9_]*),([a-z][a-z0-9_]*)\)$/);
      if (!coalesce) throw new Error('P3_DDL_UNSUPPORTED_INDEX_EXPRESSION:' + contract.tableId + ':' + value);
      requireColumns(contract, coalesce.slice(1), contract.tableId + ':hot-index-expression');
      return 'COALESCE(' + quoteIdentifier(coalesce[1]) + ', ' + quoteIdentifier(coalesce[2]) + ')';
    });
    const name = 'idx_' + contract.tableId + '_hot_' + String(ordinal + 1).padStart(2, '0');
    indexes.push({
      kind: 'hot',
      name,
      sql: 'CREATE INDEX ' + quoteIdentifier(name) + ' ON ' + quoteIdentifier(contract.tableId) + ' (' + expressions.join(', ') + ');'
    });
  });
  const expectedRules = contract.partialUniqueRules.length;
  const rules = PARTIAL_UNIQUE[contract.tableId] || [];
  if (rules.length !== expectedRules) throw new Error('P3_DDL_UNSUPPORTED_PARTIAL_UNIQUE:' + contract.tableId + ':' + expectedRules + ':' + rules.length);
  rules.forEach((rule, ordinal) => {
    if (rule.columns) requireColumns(contract, rule.columns, contract.tableId + ':partial-unique');
    const expression = rule.expression || rule.columns.map(quoteIdentifier).join(', ');
    const name = 'uidx_' + contract.tableId + '_partial_' + String(ordinal + 1).padStart(2, '0');
    indexes.push({
      kind: 'partial-unique', name,
      sql: 'CREATE UNIQUE INDEX ' + quoteIdentifier(name) + ' ON ' + quoteIdentifier(contract.tableId) + ' (' + expression + ') WHERE ' + rule.where + ';'
    });
  });
  return indexes;
}

function compileSchema(inputContracts) {
  if (!Array.isArray(inputContracts) || inputContracts.length === 0) throw new Error('P3_DDL_EMPTY_CONTRACT_SET');
  const contracts = [...inputContracts].sort((left, right) => left.tableId.localeCompare(right.tableId));
  if (new Set(contracts.map((contract) => contract.tableId)).size !== contracts.length) throw new Error('P3_DDL_DUPLICATE_TABLE');
  const allContracts = new Map(contracts.map((contract) => [contract.tableId, contract]));
  const tables = contracts.map((contract) => {
    const compiled = compileTable(contract, allContracts);
    const indexes = compileIndexes(contract);
    return {
      tableId: contract.tableId,
      owner: contract.owner,
      contractId: 'helix://contracts/tables/' + contract.tableId + '/v1',
      contractDigest: digest(contract),
      sqlDigest: digest([compiled.sql, ...indexes.map((index) => index.sql)].join('\n')),
      columns: [
        ...contract.columns.map((column) => column.name),
        ...compiled.supportColumns.map((column) => column.name)
      ],
      immutable: contract.immutability.immutable,
      supportColumns: compiled.supportColumns.map((column) => ({ name: column.name, ruleOrdinal: column.ruleOrdinal })),
      indexes,
      sql: compiled.sql
    };
  });
  const ddl = [
    '-- Generated from the frozen Helix P2 table contracts. Do not edit.',
    '-- Clean generation only; no historical runtime objects are represented.',
    ...tables.flatMap((table) => ['', table.sql, ...table.indexes.map((index) => index.sql)]),
    ''
  ].join('\n');
  return {
    ddl,
    manifest: {
      schemaVersion: 1,
      compilerContract: 'helix-p3-deterministic-sqlite-ddl/v1',
      digestAlgorithm: 'sha256',
      tableCount: tables.length,
      tableContractAggregateDigest: digest(tables.map((table) => [table.tableId, table.contractDigest])),
      ddlDigest: digest(ddl),
      tables: tables.map(({ sql, indexes, ...table }) => ({
        ...table,
        indexes: indexes.map(({ sql: indexSql, ...index }) => ({ ...index, sqlDigest: digest(indexSql) }))
      }))
    }
  };
}

module.exports = Object.freeze({ PARTIAL_UNIQUE, SUPPORT_COLUMNS, compileSchema, digest });
