'use strict';

const crypto = require('crypto');

const OWNER_PREFIXES = Object.freeze({
  'execution-foundation': ['fx_'],
  'material-control-authority': ['fx_material_control'],
  procurement: ['proc_'],
  libra: ['libra_'],
  arca: ['arca_'],
  perception: ['perception_'],
  people: ['people_'],
  'platform-settings': ['platform_']
});
const BUSINESS_OWNERS = new Set(['procurement', 'libra', 'arca', 'perception', 'people']);
const FOREIGN_KEY_OVERRIDES = Object.freeze({
  'proc_procurement_retry_intents.failed_run_id': ['proc_procurement_runs', 'procurement_run_id'],
  'libra_subject_decision_heads.current_routing_decision_id': ['libra_routing_decisions', 'routing_decision_id'],
  'libra_subject_decision_heads.current_decision_basis_id': ['libra_decision_basis_revisions', 'decision_basis_id'],
  'libra_subject_decision_heads.current_acceptance_spec_id': ['libra_acceptance_specs', 'acceptance_spec_id'],
  'libra_routing_decisions.assessment_id': ['libra_routing_assessments', 'routing_assessment_id'],
  'perception_dedup_relations.left_perception_id': ['perception_records', 'perception_id'],
  'perception_dedup_relations.right_perception_id': ['perception_records', 'perception_id'],
  'perception_resolution_heads.current_resolution_id': ['perception_resolution_revisions', 'resolution_id'],
  'people_merge_candidates.left_person_id': ['people_persons', 'person_id'],
  'people_merge_candidates.right_person_id': ['people_persons', 'person_id'],
  'people_merge_records.source_person_id': ['people_persons', 'person_id'],
  'people_merge_records.target_person_id': ['people_persons', 'person_id']
});
const JSON_SCHEMA_COLUMN_OVERRIDES = Object.freeze({
  'fx_command_receipts.result_ref_json': 'result_schema_ref',
  'fx_plan_nodes.input_bindings_json': 'input_binding_schema_ref',
  'fx_plan_nodes.parameters_json': 'parameter_schema_ref',
  'fx_plan_nodes.fence_basis_json': 'fence_schema_ref',
  'libra_product_fact_revisions.fact_json': 'schema_ref'
});
const CURRENT_POINTER_TARGETS = Object.freeze({
  fx_workflow_events: [[['event_id', 'current_progress_revision'], 'fx_event_progress', ['event_id', 'revision']]],
  proc_material_fields: [[['field_id', 'current_access_revision'], 'proc_field_access_revisions', ['field_id', 'revision']]],
  libra_subjects: [[['subject_id', 'current_identity_revision'], 'libra_product_identity_revisions', ['subject_id', 'revision']]],
  libra_field_routing_heads: [[['current_routing_policy_id', 'current_policy_revision'], 'libra_routing_policy_revisions', ['routing_policy_id', 'revision']]],
  libra_subject_decision_heads: [
    [['current_routing_decision_id'], 'libra_routing_decisions', ['routing_decision_id']],
    [['current_decision_basis_id'], 'libra_decision_basis_revisions', ['decision_basis_id']],
    [['current_acceptance_spec_id'], 'libra_acceptance_specs', ['acceptance_spec_id']]
  ],
  arca_shelves: [
    [['shelf_id', 'current_standard_revision'], 'arca_shelf_standard_revisions', ['shelf_id', 'revision']],
    [['shelf_id', 'current_placement_revision'], 'arca_placement_policy_revisions', ['shelf_id', 'revision']]
  ],
  arca_rule_templates: [[['rule_template_id', 'current_revision'], 'arca_rule_template_revisions', ['rule_template_id', 'revision']]],
  arca_input_settlement_authorization_head: [[
    ['current_authorization_id', 'current_revision'], 'arca_input_settlement_authorizations', ['authorization_id', 'revision']
  ]],
  arca_shelf_entries: [
    [['shelf_entry_id', 'canonical_identity_revision'], 'arca_canonical_identity_revisions', ['shelf_entry_id', 'revision']],
    [['shelf_entry_id', 'current_inventory_revision'], 'arca_inventory_representations', ['shelf_entry_id', 'revision']],
    [['shelf_entry_id', 'current_deck_fact_revision'], 'arca_deck_fact_revisions', ['shelf_entry_id', 'revision']]
  ],
  arca_offdeck_policy_heads: [[['policy_id', 'current_revision'], 'arca_offdeck_policy_revisions', ['policy_id', 'revision']]],
  perception_sources: [[['perception_source_id', 'current_cursor_revision'], 'perception_source_cursors', ['perception_source_id', 'revision']]],
  perception_resolution_heads: [[['current_resolution_id'], 'perception_resolution_revisions', ['resolution_id'], ['current_revision']]],
  people_persons: [[['person_id', 'current_revision'], 'people_person_revisions', ['person_id', 'revision']]],
  platform_mount_scopes: [[['mount_scope_id', 'current_revision'], 'platform_mount_scope_revisions', ['mount_scope_id', 'revision']]],
  platform_resource_profiles: [[['profile_id', 'current_revision'], 'platform_resource_profile_revisions', ['profile_id', 'revision']]],
  platform_resource_operating_policy: [[
    ['singleton_key', 'current_revision'], 'platform_resource_operating_revisions', ['singleton_key', 'revision']
  ]],
  platform_compute_devices: [[['device_id', 'current_probe_revision'], 'platform_compute_device_probes', ['device_id', 'revision']]],
  platform_workers: [[['worker_id', 'current_revision'], 'platform_worker_revisions', ['worker_id', 'revision']]]
});

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
  return value;
}

function digestValue(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function splitBalanced(value, delimiter = ',') {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '(') depth += 1;
    else if (value[index] === ')') depth -= 1;
    else if (value[index] === delimiter && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function parseFunctionCalls(value, keyword) {
  const calls = [];
  const marker = `${keyword}(`;
  let cursor = 0;
  while ((cursor = value.indexOf(marker, cursor)) >= 0) {
    const start = cursor + marker.length;
    let depth = 1;
    let end = start;
    while (end < value.length && depth > 0) {
      if (value[end] === '(') depth += 1;
      else if (value[end] === ')') depth -= 1;
      end += 1;
    }
    if (depth !== 0) throw new Error(`Unclosed ${keyword} expression: ${value}`);
    calls.push(splitBalanced(value.slice(start, end - 1)));
    cursor = end;
  }
  return calls;
}

function stripCode(value) {
  const trimmed = value.trim();
  return trimmed.startsWith('`') && trimmed.endsWith('`') ? trimmed.slice(1, -1) : trimmed;
}

function logicalType(name) {
  if (name.endsWith('_json')) return 'TEXT_JSON';
  if (/(?:_at_ms|_ms|_ns|_revision|^revision$|_count|_bytes|_ordinal|^ordinal$|^rank$|_slots$)/.test(name)) return 'INTEGER';
  if (['enabled', 'current', 'completed', 'high_volume'].includes(name)) return 'INTEGER_BOOLEAN';
  if (['rate', 'deck_coverage_ratio', 'rating'].includes(name)) return 'REAL';
  if (['current_value', 'total_value', 'preference_level'].includes(name)) return 'INTEGER_OR_REAL';
  return 'TEXT';
}

function parseColumns(columnsContract) {
  const raw = stripCode(columnsContract);
  return splitBalanced(raw).map((token, ordinal) => {
    const match = token.match(/^([a-z][a-z0-9_]*)(?:\(([^)]*)\))?(?:\s+(PK\/FK|PK|FK))?$/);
    if (!match) throw new Error(`Unsupported column token: ${token}`);
    const marker = match[3] || null;
    return {
      ordinal: ordinal + 1,
      name: match[1],
      logicalType: logicalType(match[1]),
      enumValues: match[2] ? match[2].split('|') : [],
      primaryKeyPart: marker === 'PK' || marker === 'PK/FK',
      foreignKeyMarker: marker === 'FK' || marker === 'PK/FK'
    };
  });
}

function semanticClauses(constraintsContract) {
  return constraintsContract.split('；').map((value) => value.trim()).filter(Boolean);
}

function jsonLimitFor(tableId, column, constraintsContract) {
  const limits = [...constraintsContract.matchAll(/`?(16|64) KiB`?/g)].map((match) => Number(match[1]) * 1024);
  if (limits.length > 0) return { maxBytes: limits[0], source: 'table-row' };
  if (tableId === 'libra_routing_policy_targets' && column === 'match_rule_json') return { maxBytes: 16 * 1024, source: '8.5.9-hot-json' };
  if (tableId === 'arca_rule_template_drafts' && column === 'rules_json') return { maxBytes: 64 * 1024, source: '8.5.9-non-hot-json' };
  return null;
}

function primaryKey(columns, constraintsContract) {
  const declared = columns.filter((column) => column.primaryKeyPart).map((column) => column.name);
  const calls = parseFunctionCalls(constraintsContract, 'PK');
  if (declared.length > 0 && calls.length > 0) throw new Error('Primary key declared both inline and in constraints.');
  if (calls.length > 1) throw new Error('Multiple primary keys declared.');
  return declared.length > 0 ? declared : calls[0] || [];
}

function parseTableRows(entries) {
  return entries.map((entry) => {
    const columns = parseColumns(entry.columnsContract);
    const clauses = semanticClauses(entry.constraintsContract);
    const key = primaryKey(columns, entry.constraintsContract);
    const jsonContracts = columns.filter((column) => column.name.endsWith('_json')).map((column) => {
      const schemaColumn = JSON_SCHEMA_COLUMN_OVERRIDES[`${entry.id}.${column.name}`] || `${column.name.slice(0, -5)}_schema_ref`;
      return {
        column: column.name,
        schemaRefColumn: columns.some((candidate) => candidate.name === schemaColumn) ? schemaColumn : null,
        ...jsonLimitFor(entry.id, column.name, entry.constraintsContract),
        requiresJsonValidCheck: true
      };
    });
    return {
      tableId: entry.id,
      owner: entry.owner,
      prefix: Object.values(OWNER_PREFIXES).flat().sort((left, right) => right.length - left.length)
        .find((prefix) => entry.id.startsWith(prefix)) || null,
      columns,
      primaryKey: key,
      declaredForeignKeyColumns: columns.filter((column) => column.foreignKeyMarker).map((column) => column.name),
      uniqueConstraints: parseFunctionCalls(entry.constraintsContract, 'UNIQUE'),
      hotIndexes: parseFunctionCalls(entry.constraintsContract, 'INDEX'),
      partialUniqueRules: clauses.filter((clause) => /partial unique|至多一个|最多一份|unique while open|active unique|全局exclusive/.test(clause)),
      checkRules: [
        ...columns.filter((column) => column.enumValues.length > 0).map((column) => ({ column: column.name, enumValues: column.enumValues })),
        ...clauses.filter((clause) => /CHECK|check|non-negative|finite|枚举|范围/.test(clause)).map((clause) => ({ rule: clause }))
      ],
      revisionContract: {
        revisionColumns: columns.filter((column) => column.name === 'revision' || column.name.endsWith('_revision')).map((column) => column.name),
        currentPointerColumns: columns.filter((column) => /^current_(?:.*_)?(?:id|revision)$/.test(column.name) || column.name === 'canonical_identity_revision')
          .map((column) => column.name),
        pointerTargets: (CURRENT_POINTER_TARGETS[entry.id] || []).map(([sourceColumns, targetTable, targetColumns, consistencyColumns = []]) => ({
          sourceColumns, targetTable, targetColumns, consistencyColumns, deletePolicy: 'RESTRICT'
        })),
        pointerRules: clauses.filter((clause) => /(?:current|identity pointer|三个current).*(?:FK|指向|引用|pointer|revision)/i.test(clause))
      },
      jsonContracts,
      immutability: {
        immutable: /immutable|append-only|禁止更新|不能更新|不可更新/.test(entry.constraintsContract),
        rules: clauses.filter((clause) => /immutable|append-only|禁止更新|不能更新|不可更新/.test(clause))
      },
      deletion: {
        foreignKeyPolicy: 'ON DELETE RESTRICT',
        rules: clauses.filter((clause) => /不能.*删除|不可.*删除|不物理删除|禁止.*删除|GC只处理/.test(clause))
      },
      semanticRules: clauses,
      rawContract: { columns: entry.columnsContract, constraints: entry.constraintsContract },
      source: entry.source
    };
  });
}

function resolveForeignKeys(rows) {
  const simplePrimaryKeys = new Map();
  for (const row of rows) {
    if (row.primaryKey.length !== 1) continue;
    const column = row.primaryKey[0];
    if (!simplePrimaryKeys.has(column)) simplePrimaryKeys.set(column, []);
    simplePrimaryKeys.get(column).push(row);
  }
  return rows.map((row) => ({
    ...row,
    foreignKeys: row.declaredForeignKeyColumns.map((column) => {
      const override = FOREIGN_KEY_OVERRIDES[`${row.tableId}.${column}`];
      if (override) return { columns: [column], targetTable: override[0], targetColumns: [override[1]], deletePolicy: 'RESTRICT' };
      let candidates = (simplePrimaryKeys.get(column) || []).filter((candidate) => candidate.tableId !== row.tableId);
      const sameOwner = candidates.filter((candidate) => candidate.owner === row.owner);
      if (sameOwner.length > 0) candidates = sameOwner;
      if (column === 'subject_id') candidates = candidates.filter((candidate) => candidate.tableId === 'libra_subjects');
      if (column === 'rule_template_id') candidates = candidates.filter((candidate) => candidate.tableId === 'arca_rule_templates');
      if (candidates.length !== 1) return { columns: [column], targetTable: null, targetColumns: [column], resolutionCandidates: candidates.map((item) => item.tableId) };
      return { columns: [column], targetTable: candidates[0].tableId, targetColumns: [column], deletePolicy: 'RESTRICT' };
    })
  }));
}

function buildTableContracts(entries) {
  return resolveForeignKeys(parseTableRows(entries));
}

function allowedForeignKey(sourceOwner, targetOwner) {
  if (sourceOwner === 'execution-foundation') return targetOwner === 'execution-foundation';
  if (sourceOwner === 'material-control-authority') return targetOwner === 'material-control-authority';
  if (sourceOwner === 'platform-settings') return targetOwner === 'platform-settings';
  if (BUSINESS_OWNERS.has(sourceOwner)) return targetOwner === sourceOwner || ['execution-foundation', 'material-control-authority'].includes(targetOwner);
  return false;
}

module.exports = Object.freeze({
  BUSINESS_OWNERS, OWNER_PREFIXES, allowedForeignKey, buildTableContracts, digestValue, parseColumns, parseFunctionCalls, splitBalanced
});
