'use strict';

const declaration = require('./formation-reset-owner-retention.json');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');

// The Operator consumes a frozen, reviewable Owner declaration. A schema
// addition is an error until its retention rule has been explicitly classified.
function buildOwnerRetentionPolicy(manifest, { seriesRetention, metadataRetention } = {}) {
  if (manifest.ddlDigest !== declaration.schemaDigest || manifest.tables.length !== declaration.tables.length)
    throw Object.assign(new Error('Reset retention has not been reviewed for this schema.'), { code: 'RESET_RETENTION_SCHEMA_UNREVIEWED' });
  const byName = new Map(manifest.tables.map(t => [t.tableId, t]));
  const tables = Object.fromEntries(declaration.tables.map(t => {
    if (byName.get(t.table)?.owner !== t.owner) throw new Error('Reset retention Owner differs from schema.');
    return [t.table, { owner: t.owner, disposition: t.disposition, ...(t.resetColumns ? { resetColumns: t.resetColumns } : {}),
      ...(t.regenerate ? { regenerate: true } : {}) }];
  }));
  const edges = [];
  function edge(parent, child, pairs, where, required = false) {
    const columns = pairs.map(([from, to]) => ({ parent: from, child: to }));
    if (!byName.has(parent) || !byName.has(child) || columns.some(c =>
      !byName.get(parent).columns.includes(c.parent) || !byName.get(child).columns.includes(c.child)))
      throw Object.assign(new Error('Reset retention edge differs from schema.'), { code: 'RESET_RETENTION_EDGE_UNREVIEWED', details: { parent, child } });
    edges.push({ owner: tables[child].owner, parent, child, columns, required, ...(where ? { where } : {}) });
  }
  function children(parent, key, names) { for (const name of names) edge(parent, name, [[key, key]]); }
  children('arca_shelf_entries', 'shelf_entry_id', manifest.tables.filter(t => t.owner === 'arca' &&
    t.tableId !== 'arca_shelf_entries' && t.columns.includes('shelf_entry_id')).map(t => t.tableId));
  children('arca_ondeck_runs', 'on_deck_run_id', ['arca_final_inventory_decisions', 'arca_ondeck_settlement_approvals',
    'arca_series_presentation_commit_links', 'arca_series_presentation_reservations']);
  children('arca_acceptance_attempts', 'acceptance_attempt_id', ['arca_acceptance_checks', 'arca_acceptance_check_evidence']);
  children('arca_acceptance_decisions', 'acceptance_decision_id', ['arca_handoff_b_receipts']);
  children('arca_aftercare_cases', 'aftercare_case_id', ['arca_aftercare_case_basis_inputs', 'arca_aftercare_settlement_approvals']);
  children('arca_aftercare_assessments', 'assessment_id', ['arca_aftercare_findings']);
  children('arca_offdeck_cases', 'offdeck_case_id', ['arca_offdeck_terminal_receipts']);
  children('arca_offdeck_scopes', 'destruction_scope_id', ['arca_offdeck_scope_materials', 'arca_offdeck_deletion_evidence']);
  children('arca_series_presentation_scopes', 'scope_id', ['arca_series_presentation_versions']);
  edge('arca_series_presentation_versions', 'arca_series_presentation_builds', [['build_id', 'build_id']]);
  // Cross-domain references deliberately have no SQLite FK. They still form
  // required provenance, and an absent package must block the offline copy.
  for (const parent of ['arca_acceptance_decisions', 'arca_ondeck_custodies'])
    edge(parent, 'libra_product_packages', [['on_deck_package_id', 'on_deck_package_id']], undefined, true);
  for (const parent of ['arca_inventory_representations', 'arca_inventory_product_facts'])
    edge(parent, 'libra_product_packages', [['source_package_id', 'on_deck_package_id']], undefined, true);
  for (const parent of ['arca_ondeck_runs', 'arca_aftercare_cases']) {
    const id = parent === 'arca_ondeck_runs' ? 'on_deck_run_id' : 'aftercare_case_id';
    const process = parent === 'arca_ondeck_runs' ? 'arca_ondeck_run' : 'arca_aftercare_case';
    for (const child of ['arca_staged_manifest_records', 'arca_inventory_verification_records'])
      edge(parent, child, [[id, 'process_id']], { process_type: process });
  }

  children('libra_product_packages', 'on_deck_package_id', ['libra_delivery_receipts', 'libra_product_package_artifact_refs',
    'libra_product_package_fact_refs', 'libra_product_package_materials', 'libra_product_package_material_episode_claims',
    'libra_offload_context_materials']);
  children('libra_runs', 'libra_run_id', ['libra_run_revisions', 'libra_run_outcomes', 'libra_product_fact_revisions',
    'libra_product_identity_selection_intents', 'libra_acquisition_candidate_evidence', 'libra_us_adult_analysis_bases',
    'libra_us_adult_match_completions', 'libra_us_adult_catalogue_bases', 'libra_workspaces']);
  children('libra_run_material_manifests', 'run_material_manifest_id', ['libra_run_material_members', 'libra_run_material_episode_claims']);
  children('libra_product_fact_revisions', 'product_fact_id', ['libra_product_fact_source_refs']);
  // Run's exact immutable mapping FK selects only its confirmation and Review.
  // A newer unused Subject head cannot pull another unfinished Run into Reset.
  edge('libra_episode_metadata_mapping_intents', 'libra_episode_metadata_mapping_heads', [['intent_id','intent_id']]);
  children('libra_decision_basis_revisions', 'decision_basis_id', ['libra_decision_basis_inputs']);
  children('libra_intake_decisions', 'intake_decision_id', ['libra_handoff_a_receipts', 'libra_intake_resolution_match_witnesses',
    'libra_intake_resolution_episode_overlaps', 'libra_intake_rejection_reason_evidence']);
  // Identity revisions are provenance. Runs and intake memberships are not
  // selected by Subject: the package's exact material manifest selects them.
  children('libra_subjects', 'subject_id', ['libra_product_identity_revisions']);
  children('libra_workspaces', 'workspace_id', ['libra_workspace_revisions', 'libra_workspace_material_refs']);
  edge('libra_workspaces', 'fx_command_receipts', [['workspace_id', 'target_id']],
    { owner_domain: 'libra', command_contract: 'libra.fresh-reset-workspace-archive@1', target_type: 'libra_workspace' });
  edge('libra_workspaces', 'fx_workspace_registry', [['workspace_id', 'workspace_id']],
    { owner_domain: 'libra', process_type: 'libra_run' });

  children('proc_candidate_packages', 'candidate_package_id', ['proc_candidate_primary_materials',
    'proc_candidate_primary_material_episode_claims', 'proc_candidate_related_references', 'proc_candidate_season_continuity_claims',
    'proc_run_materials']);
  edge('libra_handoff_a_receipts', 'proc_candidate_deliveries', [['offer_id', 'offer_id']]);

  children('people_persons', 'person_id', ['people_aliases', 'people_person_revisions', 'people_preference_revisions',
    'people_provider_identities', 'people_reference_assets', 'people_reference_faces', 'people_reference_revisions', 'people_image_operations']);

  // Technical execution is retained only for exact business processes and
  // source evidence selected by the Owners above, never by a global time range.
  for (const [parent, id, owner, processType] of [
    ['libra_runs', 'libra_run_id', 'libra', 'libra_run'],
    ['libra_intake_decisions', 'intake_decision_id', 'libra', 'libra_intake'],
    ['arca_ondeck_runs', 'on_deck_run_id', 'arca', 'arca_ondeck_run'],
    ['arca_shelf_entries', 'shelf_entry_id', 'arca', 'arca_shelf_entry'],
    ['arca_acceptance_decisions', 'offer_id', 'arca', 'arca_acceptance'],
    ['arca_jav_identity_corrections', 'correction_id', 'arca', 'arca_jav_identity_correction'],
    ['arca_offdeck_cases', 'offdeck_case_id', 'arca', 'arca_offdeck_case'],
    ['proc_procurement_runs', 'procurement_run_id', 'procurement', 'procurement_run'],
    ['arca_series_presentation_builds', 'build_id', 'arca', 'arca_series_presentation'],
  ]) edge(parent, 'fx_supporting_works', [[id, 'process_id']], { owner_domain: owner, process_type: processType });
  // Retained collection maintenance still owns its workspace. Its active files
  // must be excluded from the Operator's temporary cleanup inventory.
  for (const [parent, id, processType] of [
    ['arca_aftercare_cases', 'aftercare_case_id', 'aftercare_case'],
    ['arca_series_presentation_builds', 'build_id', 'series_presentation'],
    ['arca_jav_identity_corrections', 'correction_id', 'jav_identity_correction'],
  ]) {
    edge(parent, 'fx_workspace_registry', [[id, 'process_id']], { owner_domain: 'arca', process_type: processType });
    edge(parent, 'fx_artifact_registry', [[id, 'owner_scope_id']], { owner_domain: 'arca', owner_scope_type: processType });
  }
  children('fx_workspace_registry', 'workspace_id', ['fx_workspace_materials']);
  for (const parent of ['libra_product_fact_source_refs', 'libra_acquisition_candidate_evidence',
    'arca_acceptance_check_evidence', 'arca_inventory_verification_records', 'arca_staged_manifest_records']) {
    const column = parent === 'libra_acquisition_candidate_evidence' ? 'search_work_id' : 'work_id';
    edge(parent, 'fx_supporting_works', [[column, 'work_id']]);
  }
  children('fx_supporting_works', 'work_id', ['fx_work_attempts', 'fx_workflow_events']);
  edge('fx_work_attempts', 'fx_workflow_plans', [['attempt_id', 'attempt_id']]);
  children('fx_workflow_plans', 'plan_id', ['fx_plan_nodes', 'fx_plan_edges', 'fx_plan_contracts', 'fx_plan_history_audits']);
  children('fx_workflow_events', 'event_id', ['fx_event_attempts', 'fx_event_result_bindings']);
  children('fx_event_attempts', 'event_attempt_id', ['fx_effect_journal']);
  children('fx_effect_journal', 'effect_id', ['fx_commit_markers']);
  for (const [parent, id, owner, type] of [
    ['libra_runs', 'libra_run_id', 'libra', 'libra_run'],
    ['libra_product_identity_selection_intents', 'selection_intent_id', 'libra', 'product_identity_selection_intent'],
    ['libra_episode_metadata_mapping_intents', 'intent_id', 'libra', 'episode_metadata_mapping'],
    ['libra_episode_metadata_reviews', 'review_id', 'libra', 'episode_metadata_review'],
    ['arca_shelf_entries', 'shelf_entry_id', 'arca', 'shelf_entry'],
    ['arca_shelves', 'shelf_id', 'arca', 'shelf'],
    ['arca_rule_templates', 'rule_template_id', 'arca', 'rule_template'],
    ['arca_series_presentation_builds', 'build_id', 'arca', 'series_presentation_build'],
    ['people_persons', 'person_id', 'people', 'person'],
    ['proc_material_fields', 'field_id', 'procurement', 'material_field'],
    ['proc_procurement_runs', 'procurement_run_id', 'procurement', 'procurement_run'],
  ]) {
    edge(parent, 'fx_command_receipts', [[id, 'target_id']], { owner_domain: owner, target_type: type });
    edge(parent, 'fx_audit_records', [[id, 'scope_id']], { owner_domain: owner, scope_type: type });
  }
  // A Subject may have unrelated old attempts. Preserve its retirement proof,
  // not every command and audit record ever addressed to that stable root.
  edge('libra_subjects', 'fx_command_receipts', [['subject_id', 'target_id']],
    { owner_domain: 'libra', target_type: 'subject', command_contract: 'libra.formation-retirement@1' });
  edge('fx_supporting_works', 'fx_command_receipts', [['work_id', 'target_id'], ['owner_domain', 'owner_domain']], { target_type: 'supporting_work' });
  edge('fx_command_receipts', 'fx_commit_markers', [['command_receipt_id', 'commit_marker']]);
  edge('fx_command_receipts', 'fx_audit_records', [['command_receipt_id', 'audit_id']]);
  for (const [parent, id, producer, aggregate] of [
    ['arca_ondeck_runs', 'on_deck_run_id', 'arca', 'on_deck_run'],
    ['arca_acceptance_decisions', 'acceptance_decision_id', 'arca', 'acceptance_decision'],
    ['libra_product_packages', 'on_deck_package_id', 'libra', 'on_deck_package'],
    ['libra_intake_decisions', 'intake_decision_id', 'libra', 'intake_decision'],
    ['proc_candidate_packages', 'candidate_package_id', 'procurement', 'candidate_package'],
    ['people_persons', 'person_id', 'people', 'person'],
  ]) edge(parent, 'fx_outbox', [[id, 'aggregate_id']], { producer_domain: producer, aggregate_type: aggregate, state: 'fully_acked' });
  children('fx_outbox', 'message_id', ['fx_outbox_deliveries', 'fx_inbox']);
  edge('arca_inventory_materials', 'fx_material_controls', [['material_key', 'material_key']]);
  children('fx_material_controls', 'material_key', ['fx_material_control_revisions']);
  for (const [parent, key, scope] of [['arca_shelf_entries', 'shelf_entry_id', 'shelf_entry'],
    ['arca_series_presentation_scopes', 'scope_id', 'series_presentation']]) {
    edge(parent, 'fx_material_controls', [[key, 'owner_scope_id']], { owner_domain: 'arca', owner_scope_type: scope });
  }
  for (const parent of ['libra_product_package_artifact_refs'])
    edge(parent, 'fx_artifact_registry', [['artifact_handle_id', 'artifact_handle_id']]);
  for (const dependency of require('../src/helix/domains/people/public').freshResetReferenceArtifactDependencies())
    edge(dependency.table, 'fx_artifact_registry', [[dependency.column, 'artifact_handle_id']], undefined, true);
  // A shared Artifact does not make every unrelated consumer collectible.
  // Reference retention follows the selected consumer, not the Artifact root.
  for (const [parent, id, owner, scope] of [
    ['libra_product_packages', 'on_deck_package_id', 'libra', 'on_deck_package'],
    ['libra_runs', 'libra_run_id', 'libra', 'libra_run'],
    ['arca_shelf_entries', 'shelf_entry_id', 'arca', 'shelf_entry'],
    ['arca_aftercare_cases', 'aftercare_case_id', 'arca', 'aftercare_case'],
    ['arca_series_presentation_builds', 'build_id', 'arca', 'series_presentation'],
    ['arca_jav_identity_corrections', 'correction_id', 'arca', 'jav_identity_correction'],
    ['people_persons', 'person_id', 'people', 'person'],
  ]) edge(parent, 'fx_artifact_references', [[id, 'consumer_scope_id']], { consumer_domain: owner, consumer_scope_type: scope });
  const seeds = [];
  if (seriesRetention) {
    const { digest, ...body } = seriesRetention;
    if (body.schemaRef !== 'arca.fresh-reset-series-retention@1' || canonicalDigest(body) !== digest)
      throw Object.assign(new Error('Arca retention description changed.'), { code: 'RESET_RETENTION_OWNER_DESCRIPTION_INVALID' });
    for (const row of body.preservedBuilders) seeds.push({ owner: 'arca', table: 'arca_series_presentation_builds', key: { build_id: row.buildId } });
  }
  if (seriesRetention?.metadataBases?.length && !metadataRetention)
    throw Object.assign(new Error('Retained shared presentation metadata provenance is missing.'), { code: 'RESET_RETENTION_OWNER_DESCRIPTION_INVALID' });
  if (metadataRetention) {
    const { digest, ...body } = metadataRetention;
    if (body.schemaRef !== 'libra.fresh-reset-metadata-retention@1' || canonicalDigest(body) !== digest ||
        body.dependencies.some(row => !seriesRetention?.metadataBases.some(basis => basis.buildId === row.buildId &&
          basis.basis.metadataEvidenceId === row.evidenceId && basis.basis.metadataObservationDigest === row.observationDigest)) ||
        seriesRetention?.metadataBases.some(basis => !body.dependencies.some(row => row.buildId === basis.buildId)))
      throw Object.assign(new Error('Libra retention description changed.'), { code: 'RESET_RETENTION_OWNER_DESCRIPTION_INVALID' });
    for (const row of body.dependencies) {
      // The shared basis consumes an immutable Observation, not the source
      // Run's current lifecycle. Retain the exact Result and its Foundation
      // FK chain; do not revive an unfinished Run or keep all of its work.
      seeds.push({ owner: 'execution-foundation', table: 'fx_event_result_bindings', key: { result_id: row.resultId } });
    }
  }
  const policy = { tables, edges, seeds, ...(seriesRetention ? { seriesRetentionDigest: seriesRetention.digest } : {}),
    ...(metadataRetention ? { metadataRetentionDigest: metadataRetention.digest } : {}) };
  return Object.freeze({ ...policy, policyDigest: canonicalDigest(policy) });
}

module.exports = Object.freeze({ buildOwnerRetentionPolicy });
