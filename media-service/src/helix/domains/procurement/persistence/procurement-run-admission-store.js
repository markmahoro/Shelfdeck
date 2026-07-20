'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createMaterialControlParticipant } = require('../../../foundation/persistence/material-control');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { createProcurementRunExecutionBasis } = require('../model/procurement-run-contracts');

const RESULT_SCHEMA = 'helix://contracts/types/ProcurementControlReceipt/v1';
const RUN_BASIS_SCHEMA = 'helix://contracts/application-types/ProcurementRunExecutionBasis/v1';
const SHA256 = /^[0-9a-f]{64}$/;

class ProcurementRunAdmissionStoreError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'ProcurementRunAdmissionStoreError'; this.code = code; this.details = details; }
}
class ProcurementRunAdmissionReplay extends Error {
  constructor(result, marker) { super('Procurement Run Admission replay'); this.result = result; this.marker = marker; }
}
function fail(code, message, details) { throw new ProcurementRunAdmissionStoreError(code, message, details); }
function text(value, field) { if (typeof value !== 'string' || value.length === 0) fail('P7_RUN_ADMISSION_FIELD_REQUIRED', field + ' is required.'); return value; }
function digest(value, field) { if (!SHA256.test(value || '')) fail('P7_RUN_ADMISSION_DIGEST_INVALID', field + ' must be SHA-256.'); return value; }
function toNumber(value, field) { const number = Number(value); if (!Number.isSafeInteger(number)) fail('P7_RUN_ADMISSION_INTEGER_RANGE', field + ' is outside the safe integer range.'); return number; }

function procurementRepository(schemaManifest) {
  const materialColumns = ['field_id','material_key','mount_scope_id','inode','content_hash_algorithm','content_hash','size_bytes','endpoint_id','binding_revision',
    'current_location','reality_digest','provenance_digest','last_snapshot_digest','last_observation_id','eligibility_revision','eligibility_state',
    'eligibility_basis_digest','eligibility_field_status','eligibility_observation_revision','eligibility_policy_revision','selection_basis_digest',
    'control_projection','control_projection_revision','control_projection_digest'];
  const runColumns = ['procurement_run_id','field_id','run_basis_schema_ref','access_revision','access_digest','terminal_observation_revision',
    'field_observation_work_id','extraction_policy_id','extraction_policy_revision','extraction_policy_digest','triage_rule_ref','triage_rule_revision',
    'triage_rule_schema_ref','triage_rule_digest','triage_rule_authority_digest','run_basis_digest','retry_intent_id','state','state_revision',
    'seal_outcome','seal_decision_id','seal_decision_digest','seal_evidence_digest','admission_commit_marker','admission_result_digest',
    'seal_commit_marker','seal_result_digest','priority_class','created_at_ms','finished_at_ms'];
  const runMaterialColumns = ['procurement_run_id','ordinal','material_key','selection_role','mount_scope_id','inode','content_hash_algorithm','content_hash','size_bytes','binding_revision','eligibility_revision',
    'eligibility_basis_digest','last_snapshot_digest','last_observation_id','endpoint_id','location','reality_digest','provenance_digest',
    'expected_control_revision','expected_control_state','expected_control_owner_domain','expected_control_owner_scope_type',
    'expected_control_owner_scope_id','expected_control_region_projection','expected_control_evidence_digest','expected_control_projection_digest',
    'admission_control_action','admitted_control_revision','admitted_control_projection_digest','basis_member_digest','selection_state',
    'candidate_package_id','terminal_disposition','terminal_evidence_digest','selected_at_ms','reservation_updated_at_ms'];
  return createRepositoryDefinition({ repositoryId:'procurement_run_admission', owner:'procurement', schemaManifest, statements:{
    find_run:{ kind:'select-one', tableId:'proc_procurement_runs', columns:['procurement_run_id','run_basis_digest','admission_commit_marker','admission_result_digest'], keyColumns:['procurement_run_id'] },
    find_field:{ kind:'select-one', tableId:'proc_material_fields', columns:['field_id','status','extraction_policy_id','extraction_policy_revision','current_access_revision','current_observation_revision'], keyColumns:['field_id'] },
    find_access:{ kind:'select-one', tableId:'proc_field_access_revisions', columns:['field_id','revision','access_digest'], keyColumns:['field_id','revision'] },
    find_observation:{ kind:'select-one', tableId:'proc_field_observations', columns:['field_id','revision','field_observation_work_id','access_revision','completed'], keyColumns:['field_id','revision'] },
    find_policy:{ kind:'select-one', tableId:'proc_extraction_policy_revisions', columns:['extraction_policy_id','revision','policy_digest'], keyColumns:['extraction_policy_id','revision'] },
    find_material:{ kind:'select-one', tableId:'proc_field_materials', columns:materialColumns, keyColumns:['field_id','material_key'], safeIntegers:true },
    insert_run:{ kind:'insert', tableId:'proc_procurement_runs', columns:runColumns },
    insert_run_material:{ kind:'insert', tableId:'proc_run_materials', columns:runMaterialColumns }
  } });
}
function foundationRepository(schemaManifest) {
  return createRepositoryDefinition({ repositoryId:'procurement_run_admission_foundation', owner:'execution-foundation', schemaManifest, statements:{
    find_marker:{ kind:'select-one', tableId:'fx_commit_markers', columns:['commit_marker','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest','committed_at_ms'], keyColumns:['commit_marker'] },
    insert_marker:{ kind:'insert', tableId:'fx_commit_markers', columns:['commit_marker','effect_id','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest','committed_at_ms'] },
    find_result:{ kind:'select-one', tableId:'fx_event_result_bindings', columns:['result_id','event_id','outcome_kind','result_schema_ref','result_json','result_digest','evidence_schema_ref','evidence_json','evidence_digest','effect_receipt_id','committed_at_ms'], keyColumns:['result_id'] },
    insert_result:{ kind:'insert', tableId:'fx_event_result_bindings', columns:['result_id','event_id','outcome_kind','result_schema_ref','result_json','result_digest','evidence_schema_ref','evidence_json','evidence_digest','effect_receipt_id','committed_at_ms'] }
  } });
}
function validateControlHandle(handle, basis) {
  const set = basis.selectedFieldMaterialSet;
  if (!handle || handle.schemaRef !== 'helix://contracts/types/ResponsibilityControlCommitHandle/v1' || handle.schemaVersion !== 1 ||
      handle.operationKind !== 'acquire' || handle.ownerDomain !== 'procurement' || handle.processType !== 'procurement_run' ||
      handle.processId !== basis.procurementRunId || !handle.basisRef || handle.basisRef.objectType !== 'procurement_run_execution_basis' ||
      handle.basisRef.objectId !== basis.procurementRunId || handle.basisRef.revision !== 1 || handle.basisRef.digest !== basis.basisDigest ||
      handle.basisDigest !== basis.basisDigest || handle.controlScopeDigest !== set.selectionDigest ||
      handle.bindingSetDigest !== set.selectionDigest || handle.receiptContract !== RESULT_SCHEMA ||
      !Array.isArray(handle.expectedControlRevisions) || handle.expectedControlRevisions.length !== set.members.length ||
      canonicalJson(handle.expectedControlRevisions) !== canonicalJson(set.members.map((member) => ({ materialKey:member.materialKey, revision:member.controlSnapshot.controlRevision })))) {
    fail('P7_RUN_ADMISSION_HANDLE_MISMATCH', 'Control Handle does not authorize this exact Run Basis and Selection.');
  }
}
function parseReplay(repo, marker, basis, commitDigest) {
  if (marker.owner_domain !== 'procurement' || marker.scope_type !== 'procurement_run' || marker.scope_id !== basis.procurementRunId ||
      marker.commit_digest !== commitDigest || marker.result_schema_ref !== RESULT_SCHEMA) fail('P7_RUN_ADMISSION_MARKER_CONFLICT', 'Commit marker is bound to a different admission.');
  const row = repo.invoke('find_result', { result_id:marker.result_id });
  if (!row || row.result_schema_ref !== RESULT_SCHEMA || row.result_digest !== marker.result_digest) fail('P7_RUN_ADMISSION_REPLAY_CORRUPT', 'Admission marker result binding is missing or corrupt.');
  let result; try { result = JSON.parse(row.result_json); } catch { fail('P7_RUN_ADMISSION_REPLAY_CORRUPT', 'Stored admission Result is not JSON.'); }
  if (canonicalDigest(result) !== row.result_digest || result.procurementRunId !== basis.procurementRunId ||
      result.runBasisDigest !== basis.basisDigest || result.selectedMaterialSetDigest !== basis.selectedFieldMaterialSet.selectionDigest) {
    fail('P7_RUN_ADMISSION_REPLAY_CORRUPT', 'Stored admission Result does not match the requested Basis.');
  }
  throw new ProcurementRunAdmissionReplay(Object.freeze(result), marker.commit_marker);
}

function createProcurementRunAdmissionStore(options) {
  if (!options || !options.schemaManifest || !options.unitOfWork || typeof options.unitOfWork.execute !== 'function' || !options.triageRegistry) {
    fail('P7_RUN_ADMISSION_DEPENDENCIES', 'Run Admission requires SQLite dependencies and the binary Triage Registry.');
  }
  const procurement = procurementRepository(options.schemaManifest); const foundation = foundationRepository(options.schemaManifest);
  return Object.freeze({ repositoryManifest:Object.freeze({ procurement:procurement.tableIds, foundation:foundation.tableIds }), admit(request) {
    if (!request || !request.basis || !request.controlHandle || !request.commitMarker || !request.resultBinding) fail('P7_RUN_ADMISSION_REQUEST_INVALID', 'Run Admission request is incomplete.');
    const basis = createProcurementRunExecutionBasis(request.basis, options.triageRegistry); validateControlHandle(request.controlHandle, basis);
    const commitMarker = text(request.commitMarker.commitMarker, 'commitMarker'); const commitDigest = digest(request.commitMarker.commitDigest, 'commitDigest');
    const resultId = text(request.resultBinding.resultId, 'resultId'); const eventId = text(request.resultBinding.eventId, 'eventId');
    const priorityClass = text(request.priorityClass || 'normal', 'priorityClass'); let prepared; let controlResults; let receipt;
    const preflight = { participantId:'procurement_run_preflight', owner:'execution-foundation', boundBusinessOwner:'procurement', repositories:[foundation], execute(context) {
      const repo = context.repository(foundation.repositoryId); const marker = repo.invoke('find_marker', { commit_marker:commitMarker });
      if (marker) parseReplay(repo, marker, basis, commitDigest);
    } };
    const validate = { participantId:'procurement_run_validate', owner:'procurement', repositories:[procurement], execute(context) {
      const repo = context.repository(procurement.repositoryId); const field = repo.invoke('find_field', { field_id:basis.fieldId });
      if (!field || field.status !== 'active' || field.current_access_revision !== basis.fieldAccess.revision ||
          field.current_observation_revision !== basis.terminalObservation.revision || field.extraction_policy_id !== basis.extractionPolicy.policyId ||
          field.extraction_policy_revision !== basis.extractionPolicy.revision) fail('P7_RUN_ADMISSION_HEAD_STALE', 'Field admission head is stale.');
      const access = repo.invoke('find_access', { field_id:basis.fieldId, revision:basis.fieldAccess.revision });
      const observation = repo.invoke('find_observation', { field_id:basis.fieldId, revision:basis.terminalObservation.revision });
      const policy = repo.invoke('find_policy', { extraction_policy_id:basis.extractionPolicy.policyId, revision:basis.extractionPolicy.revision });
      if (!access || access.access_digest !== basis.fieldAccess.digest || !observation || !observation.completed ||
          observation.field_observation_work_id !== basis.terminalObservation.fieldObservationWorkId || observation.access_revision !== basis.fieldAccess.revision ||
          !policy || policy.policy_digest !== basis.extractionPolicy.digest) fail('P7_RUN_ADMISSION_HEAD_STALE', 'Referenced Access, terminal Observation, or Policy is stale.');
      if (repo.invoke('find_run', { procurement_run_id:basis.procurementRunId })) fail('P7_RUN_ADMISSION_RUN_ID_CONFLICT', 'Procurement Run ID already exists without this marker replay.');
      const changes = [];
      for (const member of basis.selectedFieldMaterialSet.members) {
        const row = repo.invoke('find_material', { field_id:basis.fieldId, material_key:member.materialKey }); const snapshot = member.controlSnapshot;
        if (!row || row.eligibility_state !== 'eligible' || toNumber(row.binding_revision, 'bindingRevision') !== member.bindingRevision ||
            toNumber(row.eligibility_revision, 'eligibilityRevision') !== member.eligibilityRevision || row.eligibility_basis_digest !== member.eligibilityBasisDigest ||
            row.last_snapshot_digest !== member.lastSnapshotDigest || row.last_observation_id !== member.lastObservationId || row.endpoint_id !== member.endpointId ||
            row.current_location !== member.location || row.reality_digest !== member.realityDigest || row.provenance_digest !== member.provenanceDigest ||
            row.mount_scope_id !== member.physicalIdentity.mountScopeId || String(row.inode) !== member.physicalIdentity.inode ||
            row.content_hash_algorithm !== member.physicalIdentity.contentHashAlgorithm || row.content_hash !== member.physicalIdentity.contentHash ||
            toNumber(row.size_bytes, 'sizeBytes') !== member.sizeBytes ||
            row.eligibility_field_status !== 'active' || toNumber(row.eligibility_observation_revision, 'eligibilityObservationRevision') !== basis.terminalObservation.revision ||
            toNumber(row.eligibility_policy_revision, 'eligibilityPolicyRevision') !== basis.extractionPolicy.revision || row.control_projection_digest !== snapshot.projectionDigest) {
          fail('P7_RUN_ADMISSION_MEMBER_STALE', 'Selected Material no longer matches its frozen eligible snapshot.', { materialKey:member.materialKey });
        }
        const identity = { schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v1', schemaVersion:1, materialKey:member.materialKey,
          mountScopeId:row.mount_scope_id, inode:String(row.inode), contentHashAlgorithm:row.content_hash_algorithm, contentHash:row.content_hash };
        const fieldScope = { ownerDomain:'procurement', scopeType:'material_field', scopeId:basis.fieldId };
        changes.push({ action:member.admissionControlAction, identity, expectedRevision:snapshot.controlRevision,
          expectedProjectionDigest:snapshot.projectionDigest, fromScope:member.admissionControlAction === 'assert_same_field' ? fieldScope : null,
          toScope:member.admissionControlAction === 'acquire' ? fieldScope : null });
      }
      prepared = Object.freeze(changes); return changes.length;
    } };
    const control = createMaterialControlParticipant({ schemaManifest:options.schemaManifest, handle:request.controlHandle,
      changes:basis.selectedFieldMaterialSet.members.map((member) => ({ action:member.admissionControlAction,
        identity:{ schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v1', schemaVersion:1, materialKey:member.materialKey,
          mountScopeId:'pending', inode:'0', contentHashAlgorithm:'sha256', contentHash:'0'.repeat(64) }, expectedRevision:member.controlSnapshot.controlRevision,
        expectedProjectionDigest:member.controlSnapshot.projectionDigest,
        fromScope:member.admissionControlAction === 'assert_same_field' ? { ownerDomain:'procurement', scopeType:'material_field', scopeId:basis.fieldId } : null,
        toScope:member.admissionControlAction === 'acquire' ? { ownerDomain:'procurement', scopeType:'material_field', scopeId:basis.fieldId } : null })),
      authorizedScopeDigest:basis.selectedFieldMaterialSet.selectionDigest, commitMarker, participantId:'procurement_run_control' });
    const controlParticipant = { ...control, execute(context) {
      // Identity tuples are loaded and fenced by the preceding Procurement participant inside this same transaction.
      const actual = createMaterialControlParticipant({ schemaManifest:options.schemaManifest, handle:request.controlHandle, changes:prepared,
        authorizedScopeDigest:basis.selectedFieldMaterialSet.selectionDigest, commitMarker, participantId:'procurement_run_control_actual' });
      controlResults = actual.execute(context); return controlResults;
    } };
    const resultParticipant = { participantId:'procurement_run_result', owner:'execution-foundation', boundBusinessOwner:'procurement', repositories:[foundation], execute(context) {
      const items = controlResults.map((item) => ({ materialKey:item.materialKey, admittedControlRevision:item.revision,
        admittedControlProjectionDigest:item.projection.projectionDigest })).sort((left, right) => left.materialKey.localeCompare(right.materialKey));
      const acquiredMaterialCount = controlResults.filter((item) => item.action === 'acquire').length;
      const value = { schemaRef:RESULT_SCHEMA, schemaVersion:1, receiptId:resultId, receiptKind:'procurement_run_admission', ownerDomain:'procurement',
        scopeType:'procurement_run', scopeId:basis.procurementRunId, scopeDigest:basis.basisDigest, committedAtMs:context.commitTimeMs,
        procurementRunId:basis.procurementRunId, fieldId:basis.fieldId, runBasisDigest:basis.basisDigest,
        selectedMaterialCount:items.length, selectedMaterialSetDigest:basis.selectedFieldMaterialSet.selectionDigest,
        acquiredMaterialCount, assertedMaterialCount:items.length - acquiredMaterialCount,
        controlRevisionSetDigest:canonicalDigest({ schema:'procurement.admitted-control-set@1', items }) };
      receipt = Object.freeze(value); const json = canonicalJson(receipt); if (Buffer.byteLength(json, 'utf8') > 65536) fail('P7_RUN_ADMISSION_RESULT_TOO_LARGE', 'Procurement Control Receipt exceeds 64 KiB.');
      const resultDigest = canonicalDigest(receipt); context.repository(foundation.repositoryId).invoke('insert_result', {
        result_id:resultId, event_id:eventId, outcome_kind:'succeeded', result_schema_ref:RESULT_SCHEMA, result_json:json,
        result_digest:resultDigest, evidence_schema_ref:RESULT_SCHEMA, evidence_json:json, evidence_digest:resultDigest,
        effect_receipt_id:null, committed_at_ms:context.commitTimeMs }); return resultDigest;
    } };
    const markerParticipant = { participantId:'procurement_run_marker', owner:'execution-foundation', boundBusinessOwner:'procurement', repositories:[foundation], execute(context) {
      context.repository(foundation.repositoryId).invoke('insert_marker', { commit_marker:commitMarker, effect_id:request.commitMarker.effectId || null,
        owner_domain:'procurement', scope_type:'procurement_run', scope_id:basis.procurementRunId, commit_digest:commitDigest,
        result_id:resultId, result_schema_ref:RESULT_SCHEMA, result_digest:canonicalDigest(receipt), committed_at_ms:context.commitTimeMs });
    } };
    const write = { participantId:'procurement_run_write', owner:'procurement', repositories:[procurement], execute(context) {
      const repo = context.repository(procurement.repositoryId); const rule = basis.triageRule;
      repo.invoke('insert_run', { procurement_run_id:basis.procurementRunId, field_id:basis.fieldId, run_basis_schema_ref:RUN_BASIS_SCHEMA,
        access_revision:basis.fieldAccess.revision, access_digest:basis.fieldAccess.digest, terminal_observation_revision:basis.terminalObservation.revision,
        field_observation_work_id:basis.terminalObservation.fieldObservationWorkId, extraction_policy_id:basis.extractionPolicy.policyId,
        extraction_policy_revision:basis.extractionPolicy.revision, extraction_policy_digest:basis.extractionPolicy.digest,
        triage_rule_ref:rule.ruleRef, triage_rule_revision:rule.revision, triage_rule_schema_ref:rule.ruleSchemaRef,
        triage_rule_digest:rule.ruleDigest, triage_rule_authority_digest:rule.authorityDigest, run_basis_digest:basis.basisDigest,
        retry_intent_id:basis.sourceRetryIntentId || null, state:'active', state_revision:1, seal_outcome:null, seal_decision_id:null,
        seal_decision_digest:null, seal_evidence_digest:null, admission_commit_marker:commitMarker, admission_result_digest:canonicalDigest(receipt),
        seal_commit_marker:null, seal_result_digest:null, priority_class:priorityClass, created_at_ms:context.commitTimeMs, finished_at_ms:null });
      const resultByKey = new Map(controlResults.map((item) => [item.materialKey, item]));
      for (const member of basis.selectedFieldMaterialSet.members) { const admitted = resultByKey.get(member.materialKey); const controlSnapshot = member.controlSnapshot;
        repo.invoke('insert_run_material', { procurement_run_id:basis.procurementRunId, ordinal:member.ordinal, material_key:member.materialKey,
          selection_role:member.selectionRole, mount_scope_id:member.physicalIdentity.mountScopeId, inode:member.physicalIdentity.inode,
          content_hash_algorithm:member.physicalIdentity.contentHashAlgorithm, content_hash:member.physicalIdentity.contentHash,
          size_bytes:member.sizeBytes, binding_revision:member.bindingRevision, eligibility_revision:member.eligibilityRevision,
          eligibility_basis_digest:member.eligibilityBasisDigest, last_snapshot_digest:member.lastSnapshotDigest, last_observation_id:member.lastObservationId,
          endpoint_id:member.endpointId, location:member.location, reality_digest:member.realityDigest, provenance_digest:member.provenanceDigest,
          expected_control_revision:controlSnapshot.controlRevision, expected_control_state:controlSnapshot.controlState,
          expected_control_owner_domain:controlSnapshot.ownerDomain || null, expected_control_owner_scope_type:controlSnapshot.ownerScopeType || null,
          expected_control_owner_scope_id:controlSnapshot.ownerScopeId || null, expected_control_region_projection:controlSnapshot.regionProjection,
          expected_control_evidence_digest:controlSnapshot.evidenceDigest, expected_control_projection_digest:controlSnapshot.projectionDigest,
          admission_control_action:member.admissionControlAction, admitted_control_revision:admitted.revision,
          admitted_control_projection_digest:admitted.projection.projectionDigest, basis_member_digest:member.basisMemberDigest,
          selection_state:'run_selection', candidate_package_id:null, terminal_disposition:null, terminal_evidence_digest:null,
          selected_at_ms:context.commitTimeMs, reservation_updated_at_ms:context.commitTimeMs }); }
      return receipt;
    } };
    try {
      const results = options.unitOfWork.execute([preflight, validate, controlParticipant, resultParticipant, markerParticipant, write]);
      return Object.freeze({ replayed:false, typedResult:results.procurement_run_write, commitMarker });
    } catch (error) {
      if (error instanceof ProcurementRunAdmissionReplay) return Object.freeze({ replayed:true, typedResult:error.result, commitMarker:error.marker });
      throw error;
    }
  } });
}

module.exports = Object.freeze({ ProcurementRunAdmissionStoreError, RESULT_SCHEMA, RUN_BASIS_SCHEMA, createProcurementRunAdmissionStore, validateControlHandle });
