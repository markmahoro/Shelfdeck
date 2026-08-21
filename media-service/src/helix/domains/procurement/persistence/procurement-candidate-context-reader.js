'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { activeTriageRule } = require('../model/procurement-run-contracts');
const { normalized: normalizeScopeLocation, resolveBdmvContainerScope, relativeToBdmvRoot, relativeToBdmvContainer, isBdmvInternalRelative } = require('../model/bdmv-scope');

function normalizedLocation(value) { return normalizeScopeLocation(value); }

function fieldRelativeLocation(root, location) {
  const base = normalizedLocation(root);
  const value = normalizedLocation(location);
  const foldedBase = base.toLocaleLowerCase('en-US');
  const foldedValue = value.toLocaleLowerCase('en-US');
  if (foldedValue === foldedBase) return '';
  return foldedValue.startsWith(foldedBase + '/') ? value.slice(base.length + 1) : value;
}

function bdmvContainerKey(root, location, knownRelativeLocations = []) {
  const relative = fieldRelativeLocation(root, location);
  return resolveBdmvContainerScope(relative, knownRelativeLocations)?.groupKey || null;
}

function bdmvRelative(root, location, groupKey) {
  const relative = fieldRelativeLocation(root, location);
  const group = String(groupKey || '').replace(/^bdmv:/i, '');
  // The Candidate Context is reconstructed from the frozen Run Basis.  At
  // this point we intentionally do not have to rediscover the scope from a
  // single member: a CERTIFICATE member has no BDMV ancestor of its own and
  // therefore cannot be resolved by `resolveBdmvContainerScope(relative,
  // [relative])`.  Rebuild the already-admitted container scope directly from
  // its stable group key so sibling CERTIFICATE files are included exactly as
  // Structure planned them.
  const container = group || '.';
  const scope = {
    containerRelativeLocation: container,
    bdmvRootRelativeLocation: container === '.' ? 'BDMV' : container + '/BDMV',
    groupKey: 'bdmv:' + container,
  };
  if (scope.groupKey !== 'bdmv:' + group) return null;
  return relativeToBdmvRoot(relative, scope) ?? relativeToBdmvContainer(relative, scope);
}

function scopeMembers(basis, scope) {
  const groupKey = scope.bdmvGroupKey;
  return basis.members.filter((member) => member.selection_scope_kind === 'bdmv_container' &&
    member.selection_scope_key === groupKey);
}

function bdmvCandidateMembers(basis, scope, assessment, candidateMaterials = null) {
  if (!assessment || assessment.scopeDigest !== scope.scopeDigest || assessment.memberSetDigest !== scope.memberSetDigest ||
      assessment.topologyDigest !== scope.topologyDigest || assessment.selectedPayloadSetDigest !== scope.selectedPayloadSetDigest) {
    fail('P7_CANDIDATE_BDMV_EVIDENCE_MISSING', 'BDMV Candidate Context requires matching durable Assessment evidence.');
  }
  const all = scopeMembers(basis, scope);
  if (all.length !== Number(scope.memberCount)) fail('P7_CANDIDATE_BDMV_SCOPE_INCOMPLETE', 'BDMV Scope Reference does not cover its frozen members.');
  const derivedMemberSetDigest = canonicalDigest({ schema:'procurement.bdmv-member-set@1', items:all.map((member) => ({
    materialKey:member.material_key, relativeLocation:member.field_relative_location, sizeBytes:Number(member.size_bytes),
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
        (clipInfoMatch && selectedClipIds.has(clipInfoMatch[1])) || /^CERTIFICATE\//.test(upper))) role = 'structural_dependency';
    if (!role) continue;
    if (materialByKey && !materialByKey.has(candidate.material_key)) {
      fail('P7_CANDIDATE_BDMV_MEMBER_MISSING', 'BDMV Candidate Context could not hydrate a selected member.');
    }
    const hydrated = materialByKey && materialByKey.get(candidate.material_key);
    const value = { materialKey:candidate.material_key, bindingRevision:Number(candidate.binding_revision),
      admittedControlRevision:Number(candidate.admitted_control_revision), admittedControlProjectionDigest:candidate.admitted_control_projection_digest,
      role, ...(hydrated ? { physicalIdentity:hydrated.identity, sizeBytes:Number(hydrated.member.size_bytes) } : {}), episodeClaims:[] };
    value.memberClaimDigest = canonicalDigest(value);
    members.push(Object.freeze(value));
  }
  if (!members.some((member) => member.role === 'primary_payload')) fail('P7_CANDIDATE_BDMV_PRIMARY_MISSING', 'BDMV Scope has no selected primary payload.');
  return Object.freeze(members.sort((a,b)=>Buffer.compare(Buffer.from(a.materialKey),Buffer.from(b.materialKey))));
}

function baseName(location) { return normalizedLocation(location).split('/').at(-1) || ''; }
function parentOf(location) {
  const value = normalizedLocation(location); const index = value.lastIndexOf('/');
  return index < 0 ? '.' : value.slice(0, index) || '.';
}
function reconstructRelatedReferences({ basis, scope, candidateMembers, observed, observationRevision }) {
  const primary = candidateMembers.filter((member) => member.role === 'primary_payload');
  if (!primary.length || !scope) return Object.freeze([]);
  const knownLocations = observed.map((item) => item.relativeLocation || item.location);
  const primaryContexts = primary.map((member) => {
    const source = basis.members.find((item) => item.material_key === member.materialKey);
    const relative = source ? source.field_relative_location : '';
    const stem = baseName(relative).replace(/\.[^.]+$/, '').toLocaleLowerCase('en-US');
    return { materialKey:member.materialKey, stem, parent:parentOf(relative) };
  });
  const stems = new Set(primaryContexts.map((item) => item.stem).filter(Boolean));
  if (scope.stemKey && scope.stemKey !== '@candidate') stems.add(String(scope.stemKey).toLocaleLowerCase('en-US'));
  const candidateParents = new Set(primaryContexts.map((item) => item.parent));
  const allowedParents = scope.parentRelativeLocation === '@candidate'
    ? candidateParents : new Set([normalizedLocation(scope.parentRelativeLocation || '.')]);
  const result = new Map();
  for (const item of observed) {
    const relative = normalizedLocation(item.relativeLocation || fieldRelativeLocation(basis.access.root_location, item.location));
    const identity = item.identity;
    if (!identity || identity.fingerprintAlgorithm !== 'middle-256k-sha256' || identity.fingerprintVersion !== 1 ||
        primary.some((member) => member.materialKey === identity.materialKey)) continue;
    const resolved = resolveBdmvContainerScope(relative, knownLocations);
    const bdmvRelative = resolved ? relativeToBdmvRoot(relative, resolved) : null;
    // The whole BDMV/CERTIFICATE topology is one structural scope.  Even
    // CERTIFICATE files (which sit beside BDMV rather than below it) must not
    // leak into the external sidecar references.
    if (scope.scopeKind === 'bdmv_external_parent' && resolved &&
        resolved.containerRelativeLocation === scope.parentRelativeLocation) continue;
    if (resolved && bdmvRelative !== null && isBdmvInternalRelative(bdmvRelative)) continue;
    if (!allowedParents.has(parentOf(relative))) continue;
    const lower = baseName(relative).toLocaleLowerCase('en-US');
    const stem = lower.replace(/\.[^.]+$/, '');
    const extension = (lower.match(/\.[^.]+$/) || [''])[0];
    const standard = /^(movie|tvshow)\.nfo$/.test(lower) ||
      /^(poster|fanart|background|backdrop|banner|clearlogo|landscape|logo|discart)\.(jpg|jpeg|png|webp)$/.test(lower) ||
      /^season0*\d+-(poster|fanart|background|backdrop|banner|landscape)\.(jpg|jpeg|png|webp)$/.test(lower);
    const stemMatches = [...stems].some((value) => stem === value || stem.startsWith(value + '.') || stem.startsWith(value + '-') || stem.startsWith(value + '_'));
    const sidecar = /\.(srt|ass|ssa|vtt|aac|ac3|dts|flac|mka|chapters|xml)$/.test(lower);
    const mediaPayload = /\.(3gp|asf|avi|divx|flv|iso|m2ts|m4v|mkv|mov|mp4|mpeg|mpg|mts|mxf|ogm|rm|rmvb|ts|vob|webm|wmv)$/.test(lower);
    const associationMode = scope.associationMode;
    const allowed = associationMode === 'single_movie_directory' || associationMode === 'bdmv_external'
      ? stemMatches || standard
      : stemMatches;
    if (mediaPayload || !allowed) continue;
    const primaryContext = primaryContexts.find((value) => value.parent === parentOf(relative)) || primaryContexts[0];
    const role = extension === '.nfo' ? 'nfo' : /^poster\.(jpg|jpeg|png|webp)$/.test(lower) ? 'poster'
      : /^(fanart|background|backdrop)\.(jpg|jpeg|png|webp)$/.test(lower) ? 'fanart'
      : /\.(srt|ass|ssa|vtt)$/.test(extension) ? 'subtitle' : /\.(aac|ac3|dts|flac|mka)$/.test(extension) ? 'external_audio'
      : extension === '.chapters' || extension === '.xml' ? 'chapter' : 'sidecar';
    const referenceId = canonicalDigest({ schema:'procurement.related-material-reference-id@1', primaryMaterialKey:primaryContext.materialKey,
      role, relatedMaterialKey:identity.materialKey, endpointId:item.endpointId, location:item.location });
    const associationEvidenceDigest=canonicalDigest({ schema:'procurement.related-scope-association@1', scopeDigest:scope.scopeDigest,
      observationRevision:Number(observationRevision || scope.observationProjectionRevision || 1), entryDigest:item.entryDigest });
    const dispositionBasisDigest=canonicalDigest({ schema:'procurement.related-disposition-basis@1', referenceId,
      primaryMaterialKey:primaryContext.materialKey, role, identity, associationEvidenceDigest });
    const reference = { referenceId, primaryMaterialKey:primaryContext.materialKey, role, identity, endpointId:item.endpointId,
      location:item.location, fingerprintAlgorithm:identity.fingerprintAlgorithm, fingerprintVersion:identity.fingerprintVersion,
      contentFingerprint:identity.contentFingerprint,associationKind:'exclusive',dispositionRequired:true,
      associationEvidenceDigest,dispositionBasisDigest };
    result.set(referenceId, { ...reference, referenceDigest:canonicalDigest(reference) });
  }
  return Object.freeze([...result.values()].sort((a,b)=>Buffer.compare(Buffer.from(a.referenceId),Buffer.from(b.referenceId))));
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
  const observedCache = new Map();
  const contextCache = new Map();
  return Object.freeze({
    read(request) {
      if (!request || typeof request.runId !== 'string' || typeof request.evidenceWorkId !== 'string' || typeof request.unitId !== 'string') {
        fail('P7_CANDIDATE_CONTEXT_REQUEST', 'Candidate Context requires runId, evidenceWorkId and unitId.');
      }
      const contextCacheKey = typeof request.workId === 'string' && request.workId
        ? request.workId + ':' + request.unitId : null;
      if (contextCacheKey && contextCache.has(contextCacheKey)) return contextCache.get(contextCacheKey);
      const entry=options.evidenceIndex.find(request.evidenceWorkId,request.unitId);
      if (!entry) return null;
      const cached=basisCache.get(request.runId);
      let basis = cached?.basis || (typeof options.triageReader.readRunBasis === 'function'
        ? options.triageReader.readRunBasis(request.runId)
        : null);
      if (!basis && !entry.unit.memberScope && Array.isArray(entry.unit.members) && entry.unit.members.length) {
        const seed = options.triageReader.readCandidate(request.runId, [entry.unit.members[0].materialKey], null);
        basis = seed && Object.freeze({ run:seed.run, access:seed.access,
          members:Object.freeze(seed.runMembers || []), selectionScopes:seed.selectionScopes });
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
      // Caching by unitId would retain a full 1024-member Run Basis copy per Candidate.
      const snapshot=options.triageReader.readCandidate(request.runId,materialKeys,basis);
      if (!snapshot) return null;
      if (snapshot.run.run_basis_digest !== request.executionBasisDigest && request.executionBasisDigest) {
        fail('P7_CANDIDATE_CONTEXT_BASIS_STALE', 'Candidate Context Run Basis does not match the Work Basis.');
      }
      const candidateContexts = new Map(snapshot.candidateMaterials.map((item) => [item.member.material_key, item]));
      const candidateMembers = candidateMemberRefs
        ? bdmvCandidateMembers(basis, entry.unit.memberScope, assessment, snapshot.candidateMaterials)
        : Object.freeze((entry.unit.members || []).map((member) => {
          const hydrated=candidateContexts.get(member.materialKey);
          if(!hydrated)fail('P7_CANDIDATE_CONTEXT_MEMBER_MISSING','Candidate member could not be hydrated from the immutable Run Selection.');
          return Object.freeze({ ...member, physicalIdentity:hydrated.identity, sizeBytes:Number(hydrated.member.size_bytes) });
        }));
      if (!cached) basisCache.set(request.runId,Object.freeze({ basis:Object.freeze({ run:basis.run, access:basis.access,
        selectionScopes:basis.selectionScopes, members:Object.freeze(basis.members) }) }));
      const rule=activeTriageRule(options.triageRuleRegistry);
      const relatedScope = entry.unit.relatedScope;
      if (!relatedScope || relatedScope.scopeDigest !== canonicalDigest({
        schema:'procurement.related-scope@1', scopeKind:relatedScope.scopeKind,
        parentRelativeLocation:relatedScope.parentRelativeLocation, stemKey:relatedScope.stemKey,
        associationMode:relatedScope.associationMode, observationProjectionRevision:relatedScope.observationProjectionRevision,
        relatedRuleRevision:relatedScope.relatedRuleRevision,
      })) fail('P7_CANDIDATE_CONTEXT_RELATED_SCOPE', 'Candidate Unit Related Scope digest is invalid.');
      const observedScopeKey = request.runId + ':' + relatedScope.parentRelativeLocation;
      let observed = observedCache.get(observedScopeKey);
      if (!observed && typeof options.triageReader.listObservedMaterialsInScope === 'function') {
        observed = Object.freeze(options.triageReader.listObservedMaterialsInScope(request.runId, relatedScope.parentRelativeLocation));
        observedCache.set(observedScopeKey, observed);
      } else if (!observed && typeof options.triageReader.listObservedMaterials === 'function') {
        // Test and migration fixtures may only expose the older reader port.  The
        // production composition root always provides the bounded scope query.
        observed = Object.freeze(options.triageReader.listObservedMaterials(request.runId)
          .filter((item) => parentOf(item.relativeLocation || item.location) === normalizedLocation(relatedScope.parentRelativeLocation)));
        observedCache.set(observedScopeKey, observed);
      }
      const relatedReferences = reconstructRelatedReferences({ basis, scope:relatedScope, candidateMembers,
        observed:observed || [], observationRevision:relatedScope.observationProjectionRevision });
      const context = Object.freeze({
        snapshot:Object.freeze({ run:snapshot.run, access:snapshot.access, selectionScopes:snapshot.selectionScopes,
          candidateMaterials:snapshot.candidateMaterials }),
        structure:entry.structure,
        unit:entry.unit,
        candidateMembers,
        relatedReferences,
        ordinal:entry.ordinal,
        evidenceId:entry.evidenceId,
        evidencePayloadDigest:entry.payloadDigest,
        rule,
      });
      if (contextCacheKey) contextCache.set(contextCacheKey, context);
      return context;
    },
    clear() { basisCache.clear(); observedCache.clear(); contextCache.clear(); },
  });
}

module.exports = Object.freeze({ ProcurementCandidateContextReaderError, createProcurementCandidateContextReader });
