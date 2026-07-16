'use strict';

const crypto = require('crypto');

const crashFixtures = Object.freeze({
  'handoff-a-accepted': ['continuity match前后、并发Subject/episode变化、Decision前、Subject/Binding participant后、Control participant前后、Outbox前', 'exact claim唯一命中且zero overlap才extension；0/N命中、缺失或overlap新建Subject；竞态使Basis失效后重算；要么全部不存在，要么Decision/Subject/claim snapshot/Binding/Control/Receipt全部成立；Procurement只异步消费Receipt', 8412],
  'procurement-failed-run-retry': ['Retry Intent commit前后、新Run建立前后、Intent consume前后', '旧Run始终sealed；一个Intent最多建立一个新Run；观察不伪造Basis revision；失败不会自动连锁重试', 8414],
  'libra-subject-abandon': ['Decision前、Subject terminal后、Primary Control release前后、Receipt/Outbox前', '要么Subject仍active且Control不变，要么abandoned/Primary released/Receipt全部成立；已有Run时Command稳定拒绝', 8415],
  'libra-deliverable-promotion': ['Workspace Identity计算后、Package participant后、Control acquire前后', 'Package可见时所有Product Material已有Libra Control；失败不发布Offer', 8416],
  'libra-run-discard': ['Decision前、Run terminal后、原始Input Control release前后、Cleanup Scope/Outbox前', '要么Run仍frozen且全部Control不变，要么discarded/原始Input released/Cleanup Scope完整成立；受Control Workspace Product不成为无Owner文件', 8417],
  'libra-workspace-cleanup': ['删除intent后、文件删除后Evidence前、Cleanup/Control commit前后', '删除效果幂等；只有Deletion Evidence成立的受Control Product释放Control；重启恢复同一Cleanup member', 8418],
  'handoff-b-accepted': ['Acceptance Decision、Custody/Binding、Control transfer、Receipt/Outbox各边界', 'Arca责任与Control一起成立；Libra Store不被Arca事务写入', 8419],
  'ondeck-fixed-transaction': ['Slot prepare、Stage、Switch、Final Primary verify、Settlement逐项、On-deck Commit', '已Settlement后只能向前恢复；Shelf Entry/Inventory/Deck/Control/Completion同一commit', 8420],
  'aftercare-basis-inventory': ['Standard/Placement/Decision Fact变化、Case create、Workspace output、Stage/Switch、Settlement、Inventory/Control commit', 'Case冻结完整Care Basis；旧Basis不能提交；原Shelf Entry/Identity/Deck持续；新Inventory revision与Control set一致', 8421],
  'offdeck-review-authorization': ['Review、Reservation、Scope、selection/escalation、Authorization/Case各边界', 'Authorization前不存在Case；Direct Intent不伪造Candidate；high-volume无独立Receipt不能授权；每Entry独立Scope/Case', 8422],
  'offdeck-destruction': ['Authorization后、逐Material delete、授权Identity被外部提前删除/被新Identity替换、Deletion verify、terminal commit', '授权Scope不扩张；已删Evidence不重做；授权Identity已不存在时Evidence必须证明精确absence且绝不触碰替代Identity；全部完成前Deck Fact不terminal，terminal时Control全部释放', 8423],
  'routing-template-publish': ['Preview后、revision insert后、current head切换前后、Shelf Standard refresh前后', 'Field只见一个current Routing Policy；Template current/binding可恢复；Arca不写Routing Priority', 8426],
  'command-idempotency': ['Owner业务修改后响应前崩溃、相同key同payload重试、相同key不同payload重试', 'Receipt与Owner修改同事务；同payload返回原result ref；不同payload稳定拒绝；不重复创建对象或推进revision', 8428],
  'shelf-deregistration': ['Release Manifest、逐Control CAS、administrative terminal commit', '不调用Delete；实际Physical data保持；Shelf/Entry terminal与Control release同事务', 8429],
  'effect-outbox-recovery': ['effect intent后、外部效果后receipt前、Outbox commit后dispatch前', '依据Effect Class reconcile，不统一重置ready；duplicate message/effect不重复提交', 8430]
});

const definitions = Object.freeze({
  'Domain Fact Commit': {
    commitClass: 'domain_fact_commit',
    writeTables: ['fx_commit_markers', 'fx_outbox'],
    dynamicTableRequirements: [{ participant: 'domain', selector: 'DomainFactCommitHandle.factSchemaRef', ownerConstraint: 'execution_owner' }],
    readTables: [], fixtureRefs: ['command-idempotency', 'effect-outbox-recovery'], hasOutbox: true
  },
  'Procurement Retry Intent Commit': {
    commitClass: 'domain_unit_of_work',
    writeTables: ['proc_procurement_retry_intents', 'fx_commit_markers', 'fx_outbox'],
    readTables: ['proc_procurement_runs', 'proc_material_fields', 'proc_field_materials'], fixtureRefs: ['procurement-failed-run-retry'], hasOutbox: true
  },
  'Field Routing Policy Publish': {
    commitClass: 'domain_unit_of_work',
    writeTables: ['libra_routing_policy_revisions', 'libra_routing_policy_targets', 'libra_field_routing_heads', 'fx_commit_markers', 'fx_outbox'],
    readTables: [], fixtureRefs: ['routing-template-publish'], hasOutbox: true
  },
  'Rule Template Publish': {
    commitClass: 'domain_unit_of_work',
    writeTables: ['arca_rule_template_revisions', 'arca_rule_templates', 'arca_shelf_standard_revisions', 'arca_shelves', 'fx_commit_markers', 'fx_outbox'],
    readTables: ['arca_rule_template_drafts'], fixtureRefs: ['routing-template-publish'], hasOutbox: true,
    forbiddenWriteTables: ['libra_routing_policy_revisions', 'libra_field_routing_heads']
  },
  'Handoff A Accepted': {
    commitClass: 'responsibility_control_commit',
    writeTables: ['libra_intake_decisions', 'libra_subjects', 'libra_subject_season_continuity_claims', 'libra_material_bindings', 'libra_handoff_a_receipts', 'fx_material_controls', 'fx_material_control_revisions', 'fx_commit_markers', 'fx_outbox'],
    readTables: ['libra_subjects', 'libra_subject_season_continuity_claims', 'libra_material_bindings'], fixtureRefs: ['handoff-a-accepted'], hasOutbox: true,
    forbiddenWritePrefixes: ['proc_']
  },
  'Libra Subject Abandon Commit': {
    commitClass: 'responsibility_control_commit',
    writeTables: ['libra_subject_abandon_decisions', 'libra_subjects', 'libra_subject_abandon_receipts', 'fx_material_controls', 'fx_material_control_revisions', 'fx_commit_markers', 'fx_outbox'],
    readTables: ['libra_runs', 'libra_material_bindings'], fixtureRefs: ['libra-subject-abandon'], hasOutbox: true
  },
  'Handoff B Accepted': {
    commitClass: 'responsibility_control_commit',
    writeTables: ['arca_acceptance_decisions', 'arca_ondeck_custodies', 'arca_material_bindings', 'arca_handoff_b_receipts', 'fx_material_controls', 'fx_material_control_revisions', 'fx_commit_markers', 'fx_outbox'],
    readTables: ['arca_acceptance_attempts', 'arca_acceptance_checks'], fixtureRefs: ['handoff-b-accepted'], hasOutbox: true,
    forbiddenWritePrefixes: ['libra_']
  },
  'Libra Deliverable Promotion': {
    commitClass: 'responsibility_control_commit',
    writeTables: ['libra_product_packages', 'libra_product_package_materials', 'fx_material_controls', 'fx_material_control_revisions', 'fx_commit_markers', 'fx_outbox'],
    readTables: ['libra_runs', 'libra_acceptance_specs', 'libra_product_fact_revisions'], fixtureRefs: ['libra-deliverable-promotion'], hasOutbox: true
  },
  'Libra Run Discard Commit': {
    commitClass: 'responsibility_control_commit',
    writeTables: ['libra_run_discard_decisions', 'libra_runs', 'libra_workspace_cleanup_scopes', 'libra_workspace_cleanup_members', 'libra_run_discard_receipts', 'fx_material_controls', 'fx_material_control_revisions', 'fx_commit_markers', 'fx_outbox'],
    readTables: ['libra_material_bindings', 'libra_workspace_material_refs'], fixtureRefs: ['libra-run-discard'], hasOutbox: true
  },
  'Libra Workspace Cleanup Commit': {
    commitClass: 'responsibility_control_commit',
    writeTables: ['libra_workspace_cleanup_members', 'libra_workspace_cleanup_scopes', 'fx_material_controls', 'fx_material_control_revisions', 'fx_commit_markers'],
    readTables: ['fx_workspace_materials'], fixtureRefs: ['libra-workspace-cleanup'], hasOutbox: false
  },
  'On-deck Commit': {
    commitClass: 'responsibility_control_commit',
    writeTables: ['arca_shelf_entries', 'arca_canonical_identity_revisions', 'arca_inventory_representations', 'arca_inventory_materials', 'arca_inventory_related_references', 'arca_inventory_product_facts', 'arca_inventory_person_relations', 'arca_deck_fact_revisions', 'arca_ondeck_commit_receipts', 'arca_offload_completions', 'fx_material_controls', 'fx_material_control_revisions', 'fx_commit_markers', 'fx_outbox'],
    readTables: ['arca_final_inventory_decisions', 'arca_ondeck_runs'], fixtureRefs: ['ondeck-fixed-transaction'], hasOutbox: true
  },
  'Aftercare Case Creation': {
    commitClass: 'domain_unit_of_work',
    writeTables: ['arca_aftercare_cases', 'arca_aftercare_case_basis_inputs', 'fx_commit_markers', 'fx_outbox'],
    readTables: ['arca_aftercare_assessments', 'arca_aftercare_findings', 'arca_shelf_entries'], fixtureRefs: ['aftercare-basis-inventory'], hasOutbox: true
  },
  'Aftercare Inventory Commit': {
    commitClass: 'responsibility_control_commit',
    writeTables: ['arca_inventory_representations', 'arca_inventory_materials', 'arca_inventory_related_references', 'arca_inventory_product_facts', 'arca_inventory_person_relations', 'arca_aftercare_inventory_commits', 'arca_shelf_entries', 'fx_material_controls', 'fx_material_control_revisions', 'fx_commit_markers'],
    readTables: ['arca_aftercare_cases'], fixtureRefs: ['aftercare-basis-inventory'], hasOutbox: false
  },
  'Off-deck Review Scope': {
    commitClass: 'domain_unit_of_work',
    writeTables: ['arca_offdeck_reviews', 'arca_offdeck_reservations', 'arca_offdeck_scopes', 'arca_offdeck_scope_materials', 'fx_commit_markers'],
    readTables: ['arca_shelf_entries', 'arca_inventory_materials'], fixtureRefs: ['offdeck-review-authorization'], hasOutbox: false,
    forbiddenWriteTables: ['arca_offdeck_authorizations', 'arca_offdeck_cases']
  },
  'Off-deck Batch Authorization Intent': {
    commitClass: 'domain_unit_of_work',
    writeTables: ['arca_offdeck_selection_receipts', 'arca_offdeck_escalation_receipts', 'arca_offdeck_authorization_batches', 'fx_commit_markers'],
    readTables: ['arca_offdeck_reviews', 'arca_offdeck_scopes', 'arca_offdeck_scope_materials'], fixtureRefs: ['offdeck-review-authorization'], hasOutbox: false,
    forbiddenWriteTables: ['arca_offdeck_authorizations', 'arca_offdeck_cases', 'arca_shelf_entries']
  },
  'Off-deck per-Entry Authorization/Case': {
    commitClass: 'domain_unit_of_work',
    writeTables: ['arca_offdeck_authorizations', 'arca_offdeck_cases', 'arca_offdeck_reviews', 'arca_offdeck_reservations', 'arca_offdeck_scopes', 'arca_shelf_entries', 'fx_commit_markers'],
    readTables: ['arca_offdeck_authorization_batches', 'arca_offdeck_selection_receipts'], fixtureRefs: ['offdeck-review-authorization'], hasOutbox: false
  },
  'Off-deck terminal': {
    commitClass: 'responsibility_control_commit',
    writeTables: ['arca_deck_fact_revisions', 'arca_shelf_entries', 'arca_offdeck_scopes', 'arca_offdeck_cases', 'arca_offdeck_terminal_receipts', 'fx_material_controls', 'fx_material_control_revisions', 'fx_commit_markers'],
    readTables: ['arca_offdeck_deletion_evidence', 'arca_offdeck_authorizations'], fixtureRefs: ['offdeck-destruction'], hasOutbox: false
  },
  'Shelf Deregistration Commit': {
    commitClass: 'responsibility_control_commit',
    writeTables: ['arca_deregistrations', 'arca_deregistration_releases', 'arca_deregistration_receipts', 'arca_shelves', 'arca_shelf_entries', 'arca_deck_fact_revisions', 'fx_material_controls', 'fx_material_control_revisions', 'fx_commit_markers'],
    readTables: ['arca_inventory_materials'], fixtureRefs: ['shelf-deregistration'], hasOutbox: false,
    forbiddenWriteTables: ['arca_offdeck_deletion_evidence'],
    forbiddenCapabilities: ['arca.offdeck.primary_material.delete@1', 'arca.offdeck.unreferenced_related.delete@1']
  }
});

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

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

function tableOwner(tableId) {
  if (tableId.startsWith('fx_material_control')) return 'material-control-authority';
  if (tableId.startsWith('fx_')) return 'execution-foundation';
  if (tableId.startsWith('proc_')) return 'procurement';
  if (tableId.startsWith('libra_')) return 'libra';
  if (tableId.startsWith('arca_')) return 'arca';
  if (tableId.startsWith('perception_')) return 'perception';
  if (tableId.startsWith('people_')) return 'people';
  if (tableId.startsWith('platform_')) return 'platform-settings';
  return null;
}

function participantsFor(owner, writeTables) {
  const groups = new Map();
  for (const table of writeTables) {
    const participantOwner = tableOwner(table);
    if (!groups.has(participantOwner)) groups.set(participantOwner, []);
    groups.get(participantOwner).push(table);
  }
  return [...groups].map(([participantOwner, tables]) => ({
    participantKind: participantOwner === 'execution-foundation' ? 'foundation' : participantOwner === 'material-control-authority' ? 'material-control' : 'domain',
    owner: participantOwner === 'domain' ? owner : participantOwner,
    access: 'write', tables
  }));
}

function buildCrashFixture(id) {
  const fixture = crashFixtures[id];
  if (!fixture) throw new Error(`Unknown crash fixture: ${id}`);
  return { fixtureId: id, faultInjectionPoints: fixture[0], requiredInvariant: fixture[1], source: { section: '8.9.7', line: fixture[2] } };
}

function buildTransactionContracts(entries) {
  return entries.map((entry) => {
    const definition = definitions[entry.id];
    if (!definition) throw new Error(`Missing transaction contract definition: ${entry.id}`);
    const writeTables = [...definition.writeTables];
    const materialControlRequired = definition.commitClass === 'responsibility_control_commit';
    const participants = participantsFor(entry.owner, writeTables);
    for (const dynamic of definition.dynamicTableRequirements || []) participants.unshift({
      participantKind: dynamic.participant,
      owner: dynamic.ownerConstraint,
      access: 'write',
      tables: [],
      dynamicTableSelector: dynamic.selector
    });
    return {
      transactionId: `helix.transaction.${slug(entry.id)}`,
      displayName: entry.id,
      ownerScope: entry.owner,
      commitClass: definition.commitClass,
      atomicFactSet: entry.atomicFactSet,
      participants,
      writeTables,
      readTables: definition.readTables,
      dynamicTableRequirements: definition.dynamicTableRequirements || [],
      forbiddenWriteTables: definition.forbiddenWriteTables || [],
      forbiddenWritePrefixes: definition.forbiddenWritePrefixes || [],
      forbiddenCapabilities: definition.forbiddenCapabilities || [],
      fenceContract: {
        domainRevisionFenceRequired: true,
        materialControlCasRequired: materialControlRequired,
        commitMarkerRequired: true,
        outboxRequired: definition.hasOutbox
      },
      rollbackInvariant: 'Any participant, revision fence, digest, or CAS failure leaves zero transaction writes visible; no commit marker, receipt, or outbox may survive alone.',
      crashFixtures: definition.fixtureRefs.map(buildCrashFixture),
      source: entry.source
    };
  });
}

module.exports = Object.freeze({ buildTransactionContracts, crashFixtures, definitions, digestValue, slug, tableOwner });
