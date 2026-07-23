'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createMaterialControlProjectionReadParticipant } = require('../../../foundation/persistence/material-control');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { evaluateExtractionEligibility } = require('../model/extraction-eligibility');
const SHA256 = /^[0-9a-f]{64}$/;

class EligibilityReconcileStoreError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'EligibilityReconcileStoreError'; this.code = code; this.details = details; }
}
function fail(code, message, details) { throw new EligibilityReconcileStoreError(code, message, details); }
function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}
function definition(schemaManifest) {
  const materialColumns = ['field_id','material_key','access_revision','current_location','binding_revision','size_bytes','last_snapshot_digest','last_observation_id',
    'eligibility_revision','eligibility_state','eligibility_reason_code','eligibility_basis_digest','eligibility_field_status','eligibility_observation_revision',
    'eligibility_policy_revision','selection_basis_digest','control_projection','control_projection_revision','control_projection_digest','eligibility_reconciled_at_ms'];
  return createRepositoryDefinition({ repositoryId:'eligibility_reconcile_repository', owner:'procurement', schemaManifest, statements:{
    find_field:{ kind:'select-one', tableId:'proc_material_fields', columns:['field_id','status','extraction_policy_id','extraction_policy_revision','current_access_revision','current_observation_revision'], keyColumns:['field_id'] },
    find_access:{ kind:'select-one', tableId:'proc_field_access_revisions', columns:['field_id','revision','root_location','access_digest'], keyColumns:['field_id','revision'] },
    find_policy:{ kind:'select-one', tableId:'proc_extraction_policy_revisions', columns:['extraction_policy_id','revision','policy_schema_ref','policy_json','policy_digest'], keyColumns:['extraction_policy_id','revision'] },
    find_observation:{ kind:'select-one', tableId:'proc_field_observations', columns:['field_id','revision','observation_id','field_observation_work_id','access_revision','completed'], keyColumns:['field_id','revision'] },
    find_observation_id:{ kind:'select-one', tableId:'proc_field_observations', columns:['field_id','revision','observation_id','field_observation_work_id','access_revision','completed'], keyColumns:['observation_id'] },
    find_materials:{ kind:'select-in', tableId:'proc_field_materials', keyColumn:'material_key', fixedKeyColumns:['field_id'], maxItems:100, safeIntegers:true, columns:materialColumns },
    find_runs:{ kind:'select-all', tableId:'proc_procurement_runs', columns:['procurement_run_id','field_id','state'], keyColumns:['field_id'] },
    find_run_material:{ kind:'select-one', tableId:'proc_run_materials', columns:['procurement_run_id','material_key','selection_role','selection_state','binding_revision'], keyColumns:['procurement_run_id','material_key'] },
    apply_decision:{ kind:'update', tableId:'proc_field_materials', setColumns:['eligibility_revision','eligibility_state','eligibility_reason_code','eligibility_basis_digest',
      'eligibility_field_status','eligibility_observation_revision','eligibility_policy_revision','selection_basis_digest','control_projection','control_projection_revision',
      'control_projection_digest','eligibility_reconciled_at_ms'], keyColumns:['field_id','material_key'],
      compareColumns:[{ column:'eligibility_revision', parameter:'expected_eligibility_revision' }] }
  } });
}
function relativeLocation(root, location) {
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedLocation = location.replace(/\\/g, '/');
  const prefix = normalizedRoot + '/';
  if (!normalizedLocation.startsWith(prefix) ||
      normalizedLocation.length === prefix.length) return null;
  return normalizedLocation.slice(prefix.length);
}
function extension(location) { const name = location.slice(location.lastIndexOf('/') + 1); const index = name.lastIndexOf('.');
  return index < 0 ? '' : name.slice(index).replace(/[A-Z]/g, (character) => character.toLowerCase()); }
function policyValue(row) { const rules = JSON.parse(row.policy_json); return { extractionPolicyId:row.extraction_policy_id, revision:row.revision, ...rules, policyDigest:row.policy_digest }; }
function selectionSnapshot(repo, runs, material) {
  const activeSelections = runs.filter((run) => run.state !== 'sealed').map((run) => {
    const selected = repo.invoke('find_run_material', { procurement_run_id:run.procurement_run_id, material_key:material.material_key });
    return selected && ['run_selection', 'candidate_delivery'].includes(selected.selection_state) && {
      procurementRunId:run.procurement_run_id, runState:run.state,
      selectionRole:selected.selection_role, bindingRevision:selected.binding_revision
    };
  }).filter(Boolean).sort((left, right) => left.procurementRunId.localeCompare(right.procurementRunId) || left.selectionRole.localeCompare(right.selectionRole));
  const basis = { materialKey:material.material_key, activeSelections, hasConflict:activeSelections.length > 0 };
  return Object.freeze({ ...basis, selectionBasisDigest:canonicalDigest(basis) });
}

function createEligibilityReconcileStore(options) {
  if (!options || !options.schemaManifest || !options.unitOfWork || typeof options.unitOfWork.execute !== 'function') fail('P7_ELIGIBILITY_STORE_DEPENDENCIES', 'Eligibility Reconcile Store dependencies are required.');
  const repository = definition(options.schemaManifest);
  return Object.freeze({ repositoryManifest:Object.freeze({ repositoryId:repository.repositoryId, tableIds:repository.tableIds }), reconcile(batch) {
    const batchKeys = ['fieldId','accessRevision','terminalObservationRevision','policyRevision','decisions','batchDigest'];
    if (!exact(batch, batchKeys) || typeof batch.fieldId !== 'string' || !batch.fieldId ||
        !Number.isSafeInteger(batch.accessRevision) || batch.accessRevision < 1 ||
        !Number.isSafeInteger(batch.terminalObservationRevision) || batch.terminalObservationRevision < 1 ||
        !Number.isSafeInteger(batch.policyRevision) || batch.policyRevision < 1 || !SHA256.test(batch.batchDigest || '') ||
        !Array.isArray(batch.decisions) || batch.decisions.length < 1 || batch.decisions.length > 100 ||
        batch.decisions.some((decision) => !decision || typeof decision !== 'object' || !SHA256.test(decision.materialKey || '')) ||
        batch.decisions.some((decision, index) => index > 0 && batch.decisions[index - 1].materialKey.localeCompare(decision.materialKey) >= 0) ||
        batch.decisions.some((decision) => decision.fieldId !== batch.fieldId || decision.accessRevision !== batch.accessRevision ||
          decision.terminalObservationRevision !== batch.terminalObservationRevision ||
          !decision.extractionPolicy || decision.extractionPolicy.revision !== batch.policyRevision) ||
        canonicalDigest(Object.fromEntries(Object.entries(batch).filter(([key]) => key !== 'batchDigest'))) !== batch.batchDigest) {
      fail('P7_ELIGIBILITY_BATCH_INVALID', 'Eligibility Decision Batch is invalid, unsorted, or digest-mismatched.');
    }
    const keys = batch.decisions.map((decision) => decision.materialKey); let controls;
    const controlParticipant = createMaterialControlProjectionReadParticipant({ schemaManifest:options.schemaManifest, materialKeys:keys,
      accept(value) { controls = value; } });
    const procurementParticipant = { participantId:'procurement_eligibility_reconcile', owner:'procurement', repositories:[repository], execute(context) {
      const repo = context.repository(repository.repositoryId); const field = repo.invoke('find_field', { field_id:batch.fieldId });
      if (!field) fail('P7_ELIGIBILITY_FIELD_MISSING', 'Material Field does not exist.');
      const access = repo.invoke('find_access', { field_id:batch.fieldId, revision:field.current_access_revision });
      const policy = repo.invoke('find_policy', { extraction_policy_id:field.extraction_policy_id, revision:field.extraction_policy_revision });
      const head = field.current_observation_revision === null ? null : repo.invoke('find_observation', { field_id:batch.fieldId, revision:field.current_observation_revision });
      const rows = repo.invoke('find_materials', { field_id:batch.fieldId, values:keys });
      const byKey = new Map(rows.map((row) => [row.material_key, row])); const runs = repo.invoke('find_runs', { field_id:batch.fieldId });
      const controlByKey = new Map(controls.map((item) => [item.materialKey, item])); const applied=[]; const noOpMaterialKeys=[]; const staleMaterialKeys=[];
      for (const submitted of batch.decisions) {
        const material = byKey.get(submitted.materialKey);
        if (!material || !access || !policy || !head || !head.completed || head.access_revision !== field.current_access_revision) {
          staleMaterialKeys.push(submitted.materialKey); continue;
        }
        const lastObservation = repo.invoke('find_observation_id', { observation_id:material.last_observation_id });
        const relative = relativeLocation(access.root_location, material.current_location); const selection = selectionSnapshot(repo, runs, material);
        const control = controlByKey.get(submitted.materialKey); const currentPolicy = policyValue(policy);
        const currentInput = { fieldId:batch.fieldId, fieldStatus:field.status, materialKey:material.material_key,
          expectedEligibilityRevision:submitted.expectedEligibilityRevision, accessRevision:field.current_access_revision, accessDigest:access.access_digest,
          terminalObservationRevision:head.revision, fieldObservationWorkId:head.field_observation_work_id,
          materialBindingRevision:Number(material.binding_revision), lastSnapshotDigest:material.last_snapshot_digest, lastObservationId:material.last_observation_id,
          appearedInTerminalWork:Boolean(lastObservation && lastObservation.field_observation_work_id === head.field_observation_work_id),
          materialRelativeLocation:relative, sizeBytes:Number(material.size_bytes), observedExtension:relative === null ? '' : extension(relative),
          extractionPolicy:currentPolicy, selectionSnapshot:selection, controlSnapshot:control };
        let currentDecision; try { currentDecision = evaluateExtractionEligibility(currentInput); } catch (error) { staleMaterialKeys.push(submitted.materialKey); continue; }
        if (relative === null || canonicalJson(currentDecision) !== canonicalJson(submitted)) { staleMaterialKeys.push(submitted.materialKey); continue; }
        if (material.eligibility_basis_digest === submitted.basisDigest && material.eligibility_state === submitted.decisionState &&
            material.eligibility_reason_code === submitted.reasonCode && material.control_projection === submitted.controlProjection) {
          noOpMaterialKeys.push(submitted.materialKey); continue;
        }
        if (Number(material.eligibility_revision) !== submitted.expectedEligibilityRevision) {
          staleMaterialKeys.push(submitted.materialKey); continue;
        }
        const nextRevision = submitted.expectedEligibilityRevision + 1; const changed = repo.invoke('apply_decision', {
          eligibility_revision:nextRevision, eligibility_state:submitted.decisionState, eligibility_reason_code:submitted.reasonCode,
          eligibility_basis_digest:submitted.basisDigest, eligibility_field_status:submitted.fieldStatus,
          eligibility_observation_revision:submitted.terminalObservationRevision, eligibility_policy_revision:submitted.extractionPolicy.revision,
          selection_basis_digest:submitted.selectionSnapshot.selectionBasisDigest, control_projection:submitted.controlProjection,
          control_projection_revision:submitted.controlSnapshot.resultKind === 'available' && submitted.controlSnapshot.controlRevision > 0
            ? submitted.controlSnapshot.controlRevision : null,
          control_projection_digest:submitted.controlSnapshot.projectionDigest, eligibility_reconciled_at_ms:context.commitTimeMs,
          field_id:batch.fieldId, material_key:submitted.materialKey, expected_eligibility_revision:submitted.expectedEligibilityRevision });
        if (changed.changes !== 1) fail('P7_ELIGIBILITY_CAS_CONFLICT', 'Eligibility revision CAS failed.');
        applied.push(Object.freeze({ materialKey:submitted.materialKey, eligibilityRevision:nextRevision, decisionState:submitted.decisionState,
          controlProjection:submitted.controlProjection, reasonCode:submitted.reasonCode, basisDigest:submitted.basisDigest }));
      }
      const value = { fieldId:batch.fieldId, terminalObservationRevision:batch.terminalObservationRevision, policyRevision:batch.policyRevision,
        applied, noOpMaterialKeys, staleMaterialKeys }; return Object.freeze({ ...value, summaryDigest:canonicalDigest(value) });
    } };
    return options.unitOfWork.execute([controlParticipant, procurementParticipant]).procurement_eligibility_reconcile;
  } });
}

module.exports = Object.freeze({ EligibilityReconcileStoreError, createEligibilityReconcileStore });
