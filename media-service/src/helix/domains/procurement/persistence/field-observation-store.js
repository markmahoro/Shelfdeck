'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { validateCommittedPage } = require('../model/field-observation-contracts');
const {
  PROFILE_HINT_SCHEMA,
  createProfileHintSnapshot,
} = require('../model/field-profile-hint-contracts');

const PAGE_SCHEMA = 'helix://contracts/types/FieldObservationPage/v1';
const FACT_SCHEMA = 'helix://domains/procurement/facts/FieldObservationRevision/v1';
const RESULT_SCHEMA = 'helix://contracts/types/ObservationCommitResult/v1';

class FieldObservationStoreError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'FieldObservationStoreError'; this.code = code; this.details = details; }
}
function fail(code, message, details) { throw new FieldObservationStoreError(code, message, details); }
function toNumber(value, field) { const number = Number(value); if (!Number.isSafeInteger(number)) fail('P7_FIELD_OBSERVATION_INTEGER_RANGE', field + ' is outside safe range.'); return number; }

function definition(schemaManifest) {
  return createRepositoryDefinition({ repositoryId:'field_observation_repository', owner:'procurement', schemaManifest, statements:{
    find_field:{ kind:'select-one', tableId:'proc_material_fields', columns:['field_id','status','current_access_revision','current_profile_hint_revision','current_observation_revision'], keyColumns:['field_id'] },
    find_profile_hint:{ kind:'select-one', tableId:'proc_field_profile_hint_revisions', columns:['field_id','revision','content_profile_hint','hint_schema_ref','hint_digest'], keyColumns:['field_id','revision'] },
    find_access:{ kind:'select-one', tableId:'proc_field_access_revisions', columns:['field_id','revision','endpoint_id','root_location','mount_scope_id','mount_scope_revision','access_digest'], keyColumns:['field_id','revision'] },
    find_observation:{ kind:'select-one', tableId:'proc_field_observations', columns:['field_id','revision','observation_id','field_observation_work_id','access_revision','content_profile_hint','profile_hint_revision','profile_hint_digest','page_ordinal','expected_revision','cursor_in','cursor_out','page_digest','fact_digest','commit_marker','result_digest','observed_at_ms','completed'], keyColumns:['field_id','revision'] },
    find_observation_id:{ kind:'select-one', tableId:'proc_field_observations', columns:['field_id','revision','observation_id','field_observation_work_id','page_ordinal','page_digest','commit_marker'], keyColumns:['observation_id'] },
    insert_observation:{ kind:'insert', tableId:'proc_field_observations', columns:['field_id','revision','observation_id','field_observation_work_id','access_revision','content_profile_hint','profile_hint_revision','profile_hint_digest','page_ordinal','expected_revision','cursor_in','cursor_out','page_digest','fact_digest','commit_marker','result_digest','observed_at_ms','completed'] },
    advance_head:{ kind:'update', tableId:'proc_material_fields', setColumns:['current_observation_revision','updated_at_ms'], keyColumns:['field_id'], compareColumns:[
      { column:'current_observation_revision', parameter:'expected_observation_revision', nullSafe:true },
      { column:'current_access_revision', parameter:'expected_access_revision' },
      { column:'current_profile_hint_revision', parameter:'expected_profile_hint_revision' },
      { column:'status', parameter:'expected_status' }
    ] },
    find_material:{ kind:'select-one', tableId:'proc_field_materials', columns:['field_id','material_key','endpoint_id','access_revision','mount_scope_revision','current_location','binding_revision','reality_digest','last_snapshot_digest','eligibility_revision','eligibility_state','eligibility_reason_code','eligibility_basis_digest','eligibility_field_status','eligibility_observation_revision','eligibility_policy_revision','selection_basis_digest','control_projection','control_projection_revision','control_projection_digest','eligibility_reconciled_at_ms'], keyColumns:['field_id','material_key'], safeIntegers:true },
    insert_material:{ kind:'insert', tableId:'proc_field_materials', columns:['field_id','material_key','mount_scope_id','inode','content_hash_algorithm','content_hash','endpoint_id','access_revision','mount_scope_revision','size_bytes','mtime_ns','ctime_ns','hash_verified_at_ms','current_location','binding_revision','reality_digest','provenance_digest','last_snapshot_digest','last_observation_id','eligibility_revision','eligibility_state','eligibility_reason_code','eligibility_basis_digest','eligibility_field_status','eligibility_observation_revision','eligibility_policy_revision','selection_basis_digest','control_projection','control_projection_revision','control_projection_digest','eligibility_reconciled_at_ms'] },
    update_material:{ kind:'update', tableId:'proc_field_materials', setColumns:['mount_scope_id','inode','content_hash_algorithm','content_hash','endpoint_id','access_revision','mount_scope_revision','size_bytes','mtime_ns','ctime_ns','hash_verified_at_ms','current_location','binding_revision','reality_digest','provenance_digest','last_snapshot_digest','last_observation_id','eligibility_revision','eligibility_state','eligibility_reason_code','eligibility_basis_digest','eligibility_field_status','eligibility_observation_revision','eligibility_policy_revision','selection_basis_digest','control_projection','control_projection_revision','control_projection_digest','eligibility_reconciled_at_ms'], keyColumns:['field_id','material_key'] }
  }});
}

function validateHandle(handle, page) {
  if (!handle || handle.schemaRef !== 'helix://contracts/types/DomainFactCommitHandle/v1' || handle.schemaVersion !== 1 ||
      handle.ownerDomain !== 'procurement' || handle.aggregateType !== 'material_field_observation' || handle.aggregateId !== page.fieldId ||
      handle.factType !== 'FieldObservationPage' || handle.factSchemaRef !== FACT_SCHEMA || handle.resultSchemaRef !== RESULT_SCHEMA ||
      handle.expectedRevision !== page.expectedObservationRevision || handle.payloadDigest !== canonicalDigest(page)) {
    fail('P7_FIELD_OBSERVATION_HANDLE_MISMATCH', 'Domain Fact Commit Handle does not authorize this exact Field Observation Page.');
  }
}
function materialRow(snapshot, bindingRevision, eligibility) {
  return { field_id:snapshot.fieldId, material_key:snapshot.identity.materialKey, mount_scope_id:snapshot.identity.mountScopeId,
    inode:BigInt(snapshot.identity.inode), content_hash_algorithm:snapshot.identity.contentHashAlgorithm, content_hash:snapshot.identity.contentHash,
    endpoint_id:snapshot.endpointId, access_revision:snapshot.accessRevision, mount_scope_revision:snapshot.mountScopeRevision,
    size_bytes:snapshot.sizeBytes, mtime_ns:BigInt(snapshot.mtimeNs), ctime_ns:BigInt(snapshot.ctimeNs), hash_verified_at_ms:snapshot.hashVerifiedAtMs,
    current_location:snapshot.location, binding_revision:bindingRevision, reality_digest:snapshot.realityDigest,
    provenance_digest:snapshot.provenanceDigest, last_snapshot_digest:snapshot.snapshotDigest, last_observation_id:snapshot.observationId,
    eligibility_revision:eligibility.revision, eligibility_state:eligibility.state, eligibility_reason_code:eligibility.reasonCode,
    eligibility_basis_digest:eligibility.basisDigest, eligibility_field_status:eligibility.fieldStatus,
    eligibility_observation_revision:eligibility.observationRevision, eligibility_policy_revision:eligibility.policyRevision,
    selection_basis_digest:eligibility.selectionBasisDigest, control_projection:eligibility.controlProjection,
    control_projection_revision:eligibility.controlRevision, control_projection_digest:eligibility.controlDigest,
    eligibility_reconciled_at_ms:eligibility.reconciledAtMs };
}

function createFieldObservationStore(options) {
  if (!options || !options.schemaManifest) fail('P7_FIELD_OBSERVATION_DEPENDENCIES', 'Schema manifest is required.');
  const repository = definition(options.schemaManifest);
  function createParticipant(handle, page, commitMarker) {
    validateCommittedPage(page); validateHandle(handle, page);
    return { participantId:'procurement_field_observation', owner:'procurement', boundBusinessOwner:'procurement', repositories:[repository],
      execute(context) {
        const repo = context.repository(repository.repositoryId);
        const field = repo.invoke('find_field', { field_id:page.fieldId });
        if (!field || field.status !== 'active') fail('P7_FIELD_OBSERVATION_FIELD_INACTIVE', 'Material Field is absent or deregistered.');
        const currentRevision = field.current_observation_revision === null ? 0 : field.current_observation_revision;
        if (currentRevision !== page.expectedObservationRevision || field.current_access_revision !== page.accessRevision ||
            field.current_profile_hint_revision !== page.profileHintSnapshot.revision) fail('P7_FIELD_OBSERVATION_FENCE_CONFLICT', 'Field Access, Profile Hint, or Observation head is stale.');
        const access = repo.invoke('find_access', { field_id:page.fieldId, revision:page.accessRevision });
        if (!access) fail('P7_FIELD_OBSERVATION_ACCESS_MISSING', 'Field Access revision does not exist.');
        const hint = repo.invoke('find_profile_hint', {
          field_id: page.fieldId,
          revision: page.profileHintSnapshot.revision,
        });
        if (!hint || hint.hint_schema_ref !== PROFILE_HINT_SCHEMA ||
            canonicalJson(createProfileHintSnapshot({
              fieldId: hint.field_id,
              revision: hint.revision,
              contentProfileHint: hint.content_profile_hint,
              hintDigest: hint.hint_digest,
            })) !== canonicalJson(page.profileHintSnapshot)) {
          fail('PBF22_FIELD_OBSERVATION_PROFILE_HINT_STALE', 'Field Observation Profile Hint no longer matches the Owner row.');
        }
        for (const snapshot of page.materialObservations) if (snapshot.accessDigest !== access.access_digest || snapshot.endpointId !== access.endpoint_id ||
          snapshot.identity.mountScopeId !== access.mount_scope_id || snapshot.mountScopeRevision !== access.mount_scope_revision) fail('P7_FIELD_OBSERVATION_ACCESS_MISMATCH', 'Page snapshot does not match current Field Access.');
        const collision = repo.invoke('find_observation_id', { observation_id:page.observationId });
        if (collision) fail('P7_FIELD_OBSERVATION_ID_CONFLICT', 'Observation ID already belongs to a committed page.');
        const previous = currentRevision === 0 ? null : repo.invoke('find_observation', { field_id:page.fieldId, revision:currentRevision });
        if (page.pageOrdinal === 0) {
          if (page.cursorIn !== null || previous && !previous.completed) fail('P7_FIELD_OBSERVATION_WORK_CONTINUITY', 'New Observation Work requires a terminal predecessor and null cursor.');
        } else if (!previous || previous.completed || previous.field_observation_work_id !== page.fieldObservationWorkId ||
          previous.page_ordinal !== page.pageOrdinal - 1 || previous.cursor_out !== page.cursorIn ||
          previous.content_profile_hint !== page.profileHintSnapshot.contentProfileHint ||
          previous.profile_hint_revision !== page.profileHintSnapshot.revision ||
          previous.profile_hint_digest !== page.profileHintSnapshot.hintDigest) {
          fail('P7_FIELD_OBSERVATION_PAGE_CONTINUITY', 'Observation page does not continue the committed predecessor.');
        }
        const revision = page.expectedObservationRevision + 1;
        const acceptedMaterials = [];
        const materialWrites = [];
        for (const snapshot of page.materialObservations) {
          const existing = repo.invoke('find_material', { field_id:page.fieldId, material_key:snapshot.identity.materialKey });
          const oldBinding = existing ? toNumber(existing.binding_revision, 'bindingRevision') : 0;
          const rebound = existing && (existing.endpoint_id !== snapshot.endpointId || existing.current_location !== snapshot.location);
          const bindingRevision = existing ? oldBinding + (rebound ? 1 : 0) : 1;
          const changeKind = existing ? (rebound ? 'rebound' : 'refreshed') : 'inserted';
          const realityChanged = existing && existing.reality_digest !== snapshot.realityDigest;
          const reasonCode = !existing ? 'observation_pending_reconcile' : realityChanged ? 'reality_changed' : existing.eligibility_reason_code;
          const reset = !existing || realityChanged;
          const eligibility = reset ? { revision:existing ? toNumber(existing.eligibility_revision, 'eligibilityRevision') + 1 : 1,
            state:'unknown', reasonCode, basisDigest:canonicalDigest({ schema:'procurement.eligibility-unknown@1', materialKey:snapshot.identity.materialKey, reasonCode, realityDigest:snapshot.realityDigest }),
            fieldStatus:null, observationRevision:null, policyRevision:null, selectionBasisDigest:null, controlProjection:'unknown',
            controlRevision:null, controlDigest:null, reconciledAtMs:null } : {
            revision:toNumber(existing.eligibility_revision, 'eligibilityRevision'), state:existing.eligibility_state,
            reasonCode:existing.eligibility_reason_code, basisDigest:existing.eligibility_basis_digest,
            fieldStatus:existing.eligibility_field_status, observationRevision:existing.eligibility_observation_revision,
            policyRevision:existing.eligibility_policy_revision, selectionBasisDigest:existing.selection_basis_digest,
            controlProjection:existing.control_projection, controlRevision:existing.control_projection_revision,
            controlDigest:existing.control_projection_digest, reconciledAtMs:existing.eligibility_reconciled_at_ms };
          const row = materialRow(snapshot, bindingRevision, eligibility);
          materialWrites.push({ statement:existing ? 'update_material' : 'insert_material', row });
          acceptedMaterials.push(Object.freeze({ materialKey:snapshot.identity.materialKey, bindingRevision, changeKind,
            realityDigest:snapshot.realityDigest, snapshotDigest:snapshot.snapshotDigest }));
        }
        const acceptedMaterialSetDigest = canonicalDigest({ schema:'procurement.field-observation-accepted-materials@1', items:acceptedMaterials });
        const nextCursor = page.hasMore ? page.cursorOut : null;
        const factDigest = canonicalDigest({ schema:'procurement.field-observation-revision@1', fieldId:page.fieldId,
          committedObservationRevision:revision, observationId:page.observationId, fieldObservationWorkId:page.fieldObservationWorkId,
          accessRevision:page.accessRevision, profileHintSnapshot:page.profileHintSnapshot,
          pageOrdinal:page.pageOrdinal, pageDigest:page.pageDigest,
          acceptedMaterialSetDigest, nextCursor, hasMore:page.hasMore });
        const result = Object.freeze({ schemaRef:RESULT_SCHEMA, schemaVersion:1, factId:page.observationId, ownerDomain:'procurement',
          aggregateType:'material_field_observation', aggregateId:page.fieldId, revision, factSchemaRef:FACT_SCHEMA, factDigest,
          commitMarker, committedAtMs:context.commitTimeMs, observationId:page.observationId,
          fieldObservationWorkId:page.fieldObservationWorkId, fieldId:page.fieldId, accessRevision:page.accessRevision,
          profileHintSnapshot:page.profileHintSnapshot,
          pageOrdinal:page.pageOrdinal, committedObservationRevision:revision, pageDigest:page.pageDigest,
          acceptedMaterials:Object.freeze(acceptedMaterials), acceptedMaterialSetDigest, nextCursor, hasMore:page.hasMore });
        const resultDigest = canonicalDigest(result);
        if (Buffer.byteLength(canonicalJson(result), 'utf8') > 65536) fail('P7_FIELD_OBSERVATION_RESULT_TOO_LARGE', 'Observation Commit Result exceeds 64 KiB.');
        repo.invoke('insert_observation', { field_id:page.fieldId, revision, observation_id:page.observationId,
          field_observation_work_id:page.fieldObservationWorkId, access_revision:page.accessRevision, page_ordinal:page.pageOrdinal,
          content_profile_hint:page.profileHintSnapshot.contentProfileHint,
          profile_hint_revision:page.profileHintSnapshot.revision,
          profile_hint_digest:page.profileHintSnapshot.hintDigest,
          expected_revision:page.expectedObservationRevision, cursor_in:page.cursorIn, cursor_out:page.cursorOut,
          page_digest:page.pageDigest, fact_digest:factDigest, commit_marker:commitMarker,
          result_digest:resultDigest, observed_at_ms:page.observedAtMs, completed:page.hasMore ? 0 : 1 });
        for (const write of materialWrites) repo.invoke(write.statement, write.row);
        const changed = repo.invoke('advance_head', { current_observation_revision:revision, updated_at_ms:context.commitTimeMs,
          field_id:page.fieldId, expected_observation_revision:currentRevision === 0 ? null : currentRevision,
          expected_access_revision:page.accessRevision,
          expected_profile_hint_revision:page.profileHintSnapshot.revision,
          expected_status:'active' });
        if (changed.changes !== 1) fail('P7_FIELD_OBSERVATION_FENCE_CONFLICT', 'Field Observation head CAS failed.');
        return result;
      }
    };
  }
  return Object.freeze({ repositoryManifest:Object.freeze({ repositoryId:repository.repositoryId, tableIds:repository.tableIds }), createParticipant });
}

function createFieldObservationCommitRegistration(store) {
  if (!store || typeof store.createParticipant !== 'function') fail('P7_FIELD_OBSERVATION_STORE_REQUIRED', 'Field Observation Store is required.');
  return Object.freeze({ ownerDomain:'procurement', aggregateType:'material_field_observation', factType:'FieldObservationPage',
    factSchemaRef:FACT_SCHEMA, effectClass:'domain_fact_commit', revisionFence:true,
    createParticipant({ handle, payload, commitMarker }) { return store.createParticipant(handle, payload, commitMarker); } });
}

module.exports = Object.freeze({ FACT_SCHEMA, RESULT_SCHEMA, FieldObservationStoreError, createFieldObservationCommitRegistration, createFieldObservationStore });
