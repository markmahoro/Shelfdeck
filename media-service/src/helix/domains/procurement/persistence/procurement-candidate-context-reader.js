'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { activeTriageRule } = require('../model/procurement-run-contracts');

// Keep the persistence reader owner-local.  Reusing the planner module here would
// make a repository component depend on a planning component and would also make
// a candidate read accidentally inherit planning-time behavior.  This projection
// is deliberately the same immutable selection projection used by the planner,
// but it is rebuilt from the targeted durable snapshot.
function selectedFieldMaterialSet(snapshot) {
  const members = snapshot.materials.map(({ member, identity }, ordinal) => {
    const controlled = member.expected_control_state === 'controlled';
    const controlSnapshot = {
      materialKey: member.material_key,
      resultKind: 'available',
      controlRevision: Number(member.expected_control_revision),
      controlState: member.expected_control_state,
      ...(controlled ? {
        ownerDomain: member.expected_control_owner_domain,
        ownerScopeType: member.expected_control_owner_scope_type,
        ownerScopeId: member.expected_control_owner_scope_id,
      } : {}),
      regionProjection: member.expected_control_region_projection,
      evidenceDigest: member.expected_control_evidence_digest,
      projectionDigest: member.expected_control_projection_digest,
    };
    return Object.freeze({
      ordinal,
      materialKey: member.material_key,
      selectionRole: member.selection_role,
      physicalIdentity: identity,
      sizeBytes: Number(member.size_bytes),
      bindingRevision: Number(member.binding_revision),
      eligibilityRevision: Number(member.eligibility_revision),
      eligibilityBasisDigest: member.eligibility_basis_digest,
      lastSnapshotDigest: member.last_snapshot_digest,
      lastObservationId: member.last_observation_id,
      endpointId: member.endpoint_id,
      location: member.location,
      realityDigest: member.reality_digest,
      provenanceDigest: member.provenance_digest,
      controlSnapshot: Object.freeze(controlSnapshot),
      admissionControlAction: member.admission_control_action,
      basisMemberDigest: member.basis_member_digest,
    });
  });
  const value = {
    procurementRunId: snapshot.run.procurement_run_id,
    fieldId: snapshot.run.field_id,
    members: Object.freeze(members),
  };
  return Object.freeze({ ...value, selectionDigest: canonicalDigest({
    schema: 'procurement.selected-field-material-set@1', ...value,
  }) });
}

class ProcurementCandidateContextReaderError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'ProcurementCandidateContextReaderError'; this.code = code; this.details = details; }
}

function fail(code, message, details) { throw new ProcurementCandidateContextReaderError(code, message, details); }

function createProcurementCandidateContextReader(options) {
  if (!options?.triageReader || typeof options.triageReader.readCandidate !== 'function' ||
      !options.evidenceIndex || typeof options.evidenceIndex.find !== 'function' || !options.triageRuleRegistry) {
    fail('P7_CANDIDATE_CONTEXT_DEPENDENCIES', 'Candidate Context Reader requires targeted Triage facts, Evidence Index and Triage Rules.');
  }
  const basisCache = new Map();
  return Object.freeze({
    read(request) {
      if (!request || typeof request.runId !== 'string' || typeof request.evidenceWorkId !== 'string' || typeof request.unitId !== 'string') {
        fail('P7_CANDIDATE_CONTEXT_REQUEST', 'Candidate Context requires runId, evidenceWorkId and unitId.');
      }
      const entry=options.evidenceIndex.find(request.evidenceWorkId,request.unitId);
      if (!entry) return null;
      const materialKeys=(entry.unit.members||[]).map((member)=>member.materialKey);
      // The immutable Run Basis is shared by every Candidate in the Run.
      // Caching by unitId would retain a full 256-member copy per Candidate.
      const cacheKey=request.runId;
      const cached=basisCache.get(cacheKey);
      const snapshot=options.triageReader.readCandidate(request.runId,materialKeys,cached?.basis || null);
      if (!snapshot) return null;
      if (snapshot.run.run_basis_digest !== request.executionBasisDigest && request.executionBasisDigest) {
        fail('P7_CANDIDATE_CONTEXT_BASIS_STALE', 'Candidate Context Run Basis does not match the Work Basis.');
      }
      if (!cached) basisCache.set(cacheKey,Object.freeze({ basis:Object.freeze({ run:snapshot.run, access:snapshot.access,
        members:Object.freeze(snapshot.materials.map((item)=>item.member)), materials:snapshot.materials }) }));
      const selected=selectedFieldMaterialSet(snapshot);
      const rule=activeTriageRule(options.triageRuleRegistry);
      return Object.freeze({
        snapshot:Object.freeze({ run:snapshot.run, access:snapshot.access, materials:snapshot.materials, candidateMaterials:snapshot.candidateMaterials }),
        structure:entry.structure,
        unit:entry.unit,
        ordinal:entry.ordinal,
        evidenceId:entry.evidenceId,
        evidencePayloadDigest:entry.payloadDigest,
        selected,
        rule,
      });
    },
    clear() { basisCache.clear(); },
  });
}

module.exports = Object.freeze({ ProcurementCandidateContextReaderError, createProcurementCandidateContextReader });
