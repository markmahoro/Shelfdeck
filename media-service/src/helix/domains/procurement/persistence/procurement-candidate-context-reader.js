'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { activeTriageRule } = require('../model/procurement-run-contracts');

// Keep the persistence reader owner-local.  Reusing the planner module here would
// make a repository component depend on a planning component and would also make
// a candidate read accidentally inherit planning-time behavior.  This projection
// is deliberately the same immutable selection projection used by the planner,
// but it is rebuilt from the targeted durable snapshot.
function selectedFieldMaterialSet(snapshot) {
  const source = Array.isArray(snapshot.candidateMaterials) && snapshot.candidateMaterials.length
    ? snapshot.candidateMaterials : snapshot.materials;
  const members = source.map(({ member, identity }, ordinal) => {
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

function normalizedLocation(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
}

function fieldRelativeLocation(root, location) {
  const base = normalizedLocation(root);
  const value = normalizedLocation(location);
  const foldedBase = base.toLocaleLowerCase('en-US');
  const foldedValue = value.toLocaleLowerCase('en-US');
  if (foldedValue === foldedBase) return '';
  return foldedValue.startsWith(foldedBase + '/') ? value.slice(base.length + 1) : value;
}

function bdmvContainerKey(root, location) {
  const parts = fieldRelativeLocation(root, location).split('/').filter(Boolean);
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    if (parts[index].toUpperCase() === 'BDMV') return 'bdmv:' + parts.slice(0, index).join('/');
  }
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    if (parts[index].toUpperCase() === 'CERTIFICATE') return 'bdmv:' + parts.slice(0, index).join('/');
  }
  return null;
}

function bdmvRelative(root, location, groupKey) {
  const relative = fieldRelativeLocation(root, location);
  const group = String(groupKey || '').replace(/^bdmv:/i, '');
  const prefix = group ? group + '/' : '';
  const value = relative.toLocaleLowerCase('en-US');
  const foldedPrefix = prefix.toLocaleLowerCase('en-US');
  if (!value.startsWith(foldedPrefix)) return null;
  const rest = relative.slice(prefix.length).replace(/^\/+/g, '');
  const parts = rest.split('/').filter(Boolean);
  const bdmvIndex = parts.findIndex((part) => part.toUpperCase() === 'BDMV');
  if (bdmvIndex >= 0) return parts.slice(bdmvIndex + 1).join('/');
  const certificateIndex = parts.findIndex((part) => part.toUpperCase() === 'CERTIFICATE');
  if (certificateIndex >= 0) return parts.slice(certificateIndex).join('/');
  return null;
}

function scopeMembers(basis, scope) {
  const root = basis.access.root_location;
  const groupKey = scope.bdmvGroupKey;
  return basis.members.filter((member) => bdmvContainerKey(root, member.location) === groupKey);
}

function bdmvCandidateMembers(basis, scope, assessment, candidateMaterials = null) {
  if (!assessment || assessment.scopeDigest !== scope.scopeDigest || assessment.memberSetDigest !== scope.memberSetDigest ||
      assessment.topologyDigest !== scope.topologyDigest || assessment.selectedPayloadSetDigest !== scope.selectedPayloadSetDigest) {
    fail('P7_CANDIDATE_BDMV_EVIDENCE_MISSING', 'BDMV Candidate Context requires matching durable Assessment evidence.');
  }
  const all = scopeMembers(basis, scope);
  if (all.length !== Number(scope.memberCount)) fail('P7_CANDIDATE_BDMV_SCOPE_INCOMPLETE', 'BDMV Scope Reference does not cover its frozen members.');
  const derivedMemberSetDigest = canonicalDigest({ schema:'procurement.bdmv-member-set@1', items:all.map((member) => ({
    materialKey:member.material_key, relativeLocation:fieldRelativeLocation(basis.access.root_location, member.location), sizeBytes:Number(member.size_bytes),
    identity:{ schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2', schemaVersion:2,
      materialKey:member.material_key, mountScopeId:member.mount_scope_id, inode:String(member.inode), sizeBytes:Number(member.size_bytes),
      fingerprintAlgorithm:member.fingerprint_algorithm, fingerprintVersion:Number(member.fingerprint_version), contentFingerprint:member.content_fingerprint }
  })).sort((a,b)=>Buffer.compare(Buffer.from(a.relativeLocation),Buffer.from(b.relativeLocation))||Buffer.compare(Buffer.from(a.materialKey),Buffer.from(b.materialKey))) });
  if (derivedMemberSetDigest !== scope.memberSetDigest) fail('P7_CANDIDATE_BDMV_MEMBER_SET_DRIFT', 'BDMV Scope member digest no longer matches the Run Basis.');
  const selectedClipIds = new Set((assessment.selectedClipIds || []).map((value) => String(value).toUpperCase()));
  const selectedPlaylist = String(assessment.selectedPlaylist?.relativeLocation || '').toUpperCase();
  const materialByKey = candidateMaterials ? new Map(candidateMaterials.map((item) => [item.member.material_key, item])) : null;
  const members = [];
  for (const candidate of all) {
    const relative = bdmvRelative(basis.access.root_location, candidate.location, scope.bdmvGroupKey);
    if (!relative) continue;
    const upper = relative.toUpperCase();
    let role = null;
    const streamMatch = /^STREAM\/([^/]+)\.M2TS$/.exec(upper);
    if (streamMatch && selectedClipIds.has(streamMatch[1])) role = 'primary_payload';
    const clipInfoMatch = /^CLIPINF\/([^/]+)\.CLPI$/.exec(upper);
    if (!role && (upper === selectedPlaylist || /^INDEX\.BDMV$/.test(upper) || /^MOVIEOBJECT\.BDMV$/.test(upper) ||
        (clipInfoMatch && selectedClipIds.has(clipInfoMatch[1])))) role = 'structural_dependency';
    if (!role) continue;
    if (materialByKey && !materialByKey.has(candidate.material_key)) {
      fail('P7_CANDIDATE_BDMV_MEMBER_MISSING', 'BDMV Candidate Context could not hydrate a selected member.');
    }
    const value = { materialKey:candidate.material_key, bindingRevision:Number(candidate.binding_revision),
      admittedControlRevision:Number(candidate.admitted_control_revision), admittedControlProjectionDigest:candidate.admitted_control_projection_digest,
      role, episodeClaims:[] };
    value.memberClaimDigest = canonicalDigest(value);
    members.push(Object.freeze(value));
  }
  if (!members.some((member) => member.role === 'primary_payload')) fail('P7_CANDIDATE_BDMV_PRIMARY_MISSING', 'BDMV Scope has no selected primary payload.');
  return Object.freeze(members.sort((a,b)=>Buffer.compare(Buffer.from(a.materialKey),Buffer.from(b.materialKey))));
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
      const cached=basisCache.get(request.runId);
      let basis = cached?.basis || (typeof options.triageReader.readRunBasis === 'function'
        ? options.triageReader.readRunBasis(request.runId)
        : null);
      if (!basis && !entry.unit.memberScope && Array.isArray(entry.unit.members) && entry.unit.members.length) {
        const seed = options.triageReader.readCandidate(request.runId, [entry.unit.members[0].materialKey], null);
        basis = seed && Object.freeze({ run:seed.run, access:seed.access,
          members:Object.freeze((seed.materials || []).map((item) => item.member)), materials:Object.freeze(seed.materials || []) });
      }
      if (!basis) fail('P7_CANDIDATE_CONTEXT_BASIS_UNAVAILABLE', 'Candidate Context Run Basis is unavailable.');
      const assessment = entry.unit.memberScope && typeof options.evidenceIndex.findBdmvAssessment === 'function'
        ? options.evidenceIndex.findBdmvAssessment(request.evidenceWorkId, entry.unit.memberScope.scopeDigest) : null;
      const candidateMemberRefs = entry.unit.memberScope
        ? bdmvCandidateMembers(basis, entry.unit.memberScope, assessment)
        : null;
      const materialKeys = candidateMemberRefs
        ? candidateMemberRefs.map((member) => member.materialKey)
        : (entry.unit.members || []).map((member)=>member.materialKey);
      if (!materialKeys.length) fail('P7_CANDIDATE_CONTEXT_MEMBER_SCOPE_EMPTY', 'Candidate Context Unit has no material members.');
      // The immutable Run Basis is shared by every Candidate in the Run.
      // Caching by unitId would retain a full 256-member copy per Candidate.
      const snapshot=options.triageReader.readCandidate(request.runId,materialKeys,basis);
      if (!snapshot) return null;
      if (snapshot.run.run_basis_digest !== request.executionBasisDigest && request.executionBasisDigest) {
        fail('P7_CANDIDATE_CONTEXT_BASIS_STALE', 'Candidate Context Run Basis does not match the Work Basis.');
      }
      if (!cached) basisCache.set(request.runId,Object.freeze({ basis:Object.freeze({ run:basis.run, access:basis.access,
        members:Object.freeze(basis.members), materials:Object.freeze(snapshot.materials) }) }));
      const candidateMembers = candidateMemberRefs
        ? bdmvCandidateMembers(basis, entry.unit.memberScope, assessment, snapshot.candidateMaterials)
        : Object.freeze((entry.unit.members || []).map((member) => Object.freeze({ ...member })));
      const selected=selectedFieldMaterialSet(snapshot);
      const rule=activeTriageRule(options.triageRuleRegistry);
      return Object.freeze({
        snapshot:Object.freeze({ run:snapshot.run, access:snapshot.access, materials:snapshot.materials, candidateMaterials:snapshot.candidateMaterials }),
        structure:entry.structure,
        unit:entry.unit,
        candidateMembers,
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
