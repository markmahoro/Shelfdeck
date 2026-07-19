'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { utf8Compare } = require('./libra-intake-contracts');

const DIGEST = /^[a-f0-9]{64}$/;
const INPUT_ROLES = new Set(['primary_payload', 'structural_dependency']);
const PROFILES = new Set(['movie', 'series', 'jav', 'western_adult']);

class LibraRunAdmissionContractError extends Error {
  constructor(code, message, details = {}) {
    super(message); this.name = 'LibraRunAdmissionContractError'; this.code = code; this.details = details;
  }
}
function fail(code, message, details) { throw new LibraRunAdmissionContractError(code, message, details); }
function object(value, code) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code, 'A typed object is required.'); return value; }
function text(value, field) { if (typeof value !== 'string' || !value) fail('P9_RUN_TEXT', 'A non-empty string is required.', { field }); return value; }
function digest(value, field) { if (!DIGEST.test(value || '')) fail('P9_RUN_DIGEST', 'A lowercase SHA-256 digest is required.', { field }); return value; }
function integer(value, minimum, field) { if (!Number.isSafeInteger(value) || value < minimum) fail('P9_RUN_INTEGER', 'A bounded integer is required.', { field }); return value; }
function without(value, ...fields) { return Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key))); }
function bytes(value, maximum, code) { if (Buffer.byteLength(canonicalJson(value), 'utf8') > maximum) fail(code, 'Canonical value exceeds its byte limit.'); }
function physicalMaterialKey(identity) {
  object(identity, 'P9_RUN_PHYSICAL_IDENTITY');
  text(identity.mountScopeId, 'physicalIdentity.mountScopeId');
  if (!/^(0|[1-9][0-9]*)$/.test(text(identity.inode, 'physicalIdentity.inode')) || identity.contentHashAlgorithm !== 'sha256')
    fail('P9_RUN_PHYSICAL_IDENTITY', 'Physical identity is outside the clean contract.');
  digest(identity.contentHash, 'physicalIdentity.contentHash');
  return canonicalDigest({ schema: 'physical-material-identity@1', mountScopeId: identity.mountScopeId,
    inode: identity.inode, contentHashAlgorithm: identity.contentHashAlgorithm, contentHash: identity.contentHash });
}

function buildEpisodeClaims(value) {
  if (!Array.isArray(value) || value.length > 32) fail('P9_RUN_EPISODE_BOUND', 'Episode claims must contain 0..32 items.');
  const claims = value.map((item) => {
    object(item, 'P9_RUN_EPISODE_CLAIM');
    const claim = { episodeKey: text(item.episodeKey, 'episodeKey'), seasonClaimDigest: digest(item.seasonClaimDigest, 'seasonClaimDigest') };
    claim.claimDigest = canonicalDigest({ schema: 'libra.production-material-episode-claim@1',
      episodeKey: claim.episodeKey, seasonClaimDigest: claim.seasonClaimDigest });
    if (item.claimDigest !== undefined && item.claimDigest !== claim.claimDigest) fail('P9_RUN_EPISODE_DIGEST', 'Episode claim digest is invalid.');
    return Object.freeze(claim);
  });
  const sorted = [...claims].sort((a, b) => utf8Compare(a.episodeKey, b.episodeKey));
  if (sorted.some((item, index) => index > 0 && item.episodeKey === sorted[index - 1].episodeKey))
    fail('P9_RUN_EPISODE_DUPLICATE', 'Episode claims must be unique.');
  if (canonicalJson(sorted) !== canonicalJson(claims)) fail('P9_RUN_EPISODE_ORDER', 'Episode claims must be UTF-8 ordered.');
  return sorted;
}

function sortedUniqueText(values, field) {
  if (!Array.isArray(values)) fail('P9_RUN_REQUIREMENT_SCOPE', 'A typed text list is required.', { field });
  const sorted = [...values].sort(utf8Compare);
  if (sorted.some((item, index) => typeof item !== 'string' || !item || (index > 0 && item === sorted[index - 1]))
    || canonicalJson(sorted) !== canonicalJson(values)) fail('P9_RUN_REQUIREMENT_SCOPE', 'Text values must be unique and UTF-8 ordered.', { field });
  return sorted;
}

function buildOutputRequirement({ acceptanceSpec, manifestRole, materialKey, materialRole, episodeKeys }) {
  const spec = object(acceptanceSpec, 'P9_RUN_SPEC');
  const productScope = object(spec.productScope, 'P9_RUN_PRODUCT_SCOPE');
  const requirements = object(spec.requirements, 'P9_RUN_REQUIREMENTS');
  const requirementKeys = ['identity', 'structure', 'metadata', 'mandatoryMedia', 'space', 'inventory'];
  if (Object.keys(requirements).length !== requirementKeys.length || requirementKeys.some((key) => !Object.hasOwn(requirements, key)))
    fail('P9_RUN_REQUIREMENTS', 'Acceptance Spec must contain exactly six Requirement classes.');
  const productEpisodeKeys = sortedUniqueText(productScope.episodeKeys, 'acceptanceSpec.productScope.episodeKeys');
  if (productScope.scopeDigest !== spec.productScopeDigest) fail('P9_RUN_PRODUCT_SCOPE', 'Acceptance Spec Product Scope digest is inconsistent.');
  let kind;
  let scopedEpisodeKeys = [];
  if (materialRole === 'primary_payload') {
    if (productScope.scopeKind === 'single') {
      if (episodeKeys.length) fail('P9_RUN_REQUIREMENT_SCOPE', 'Single primary material cannot claim Episodes.');
      kind = 'product_scope';
    } else {
      if (episodeKeys.length < 1 || episodeKeys.length > 32 || episodeKeys.some((key) => !productEpisodeKeys.includes(key)))
        fail('P9_RUN_REQUIREMENT_SCOPE', 'Season primary material requires a non-empty Product Scope Episode subset.');
      kind = 'episode_subset'; scopedEpisodeKeys = episodeKeys;
    }
  } else if (materialRole === 'structural_dependency') {
    if (episodeKeys.length) fail('P9_RUN_REQUIREMENT_SCOPE', 'Structural material cannot claim Episodes.');
    kind = 'production_support';
  } else {
    if (!['metadata_sidecar', 'poster', 'fanart', 'subtitle', 'external_audio', 'chapter'].includes(materialRole) || manifestRole !== 'product_delivery')
      fail('P9_RUN_REQUIREMENT_ROLE', 'Material role is outside the closed requirement mapping.');
    kind = 'product_scope';
  }
  const acceptanceSpecRef = {
    acceptanceSpecId: text(spec.acceptanceSpecId, 'acceptanceSpecId'),
    specRevision: integer(spec.specRevision, 1, 'specRevision'),
    specDigest: digest(spec.specDigest, 'specDigest'), recordDigest: digest(spec.recordDigest, 'recordDigest'),
    productScopeDigest: digest(spec.productScopeDigest, 'productScopeDigest')
  };
  const applicationScope = { kind, episodeKeys: scopedEpisodeKeys,
    scopeDigest: canonicalDigest({ schema: 'libra.production-material-requirement-scope@1',
      productScopeDigest: spec.productScopeDigest, kind, episodeKeys: scopedEpisodeKeys }) };
  const requirement = { acceptanceSpecRef, manifestRole, materialKey, materialRole, applicationScope,
    acceptanceRequirementSetDigest: canonicalDigest({ schema: 'libra.acceptance-requirement-set@1', requirements }) };
  requirement.outputRequirementDigest = canonicalDigest(requirement);
  return Object.freeze(requirement);
}

function buildRunInputMember(value, ordinal, acceptanceSpec) {
  object(value, 'P9_RUN_MEMBER');
  const physicalIdentity = object(value.physicalIdentity, 'P9_RUN_PHYSICAL_IDENTITY');
  const materialKey = physicalMaterialKey(physicalIdentity);
  if (value.materialKey !== materialKey || !INPUT_ROLES.has(value.role)) fail('P9_RUN_MEMBER_IDENTITY', 'Run member identity or role is invalid.');
  const location = object(value.location, 'P9_RUN_LOCATION');
  if (location.locationKind !== 'domain_binding' || typeof location.location !== 'string' || !location.location
    || Object.hasOwn(location, 'rootHandleRef') || Object.hasOwn(location, 'relativePath'))
    fail('P9_RUN_LOCATION', 'Run input must use a domain binding location.');
  const origin = object(value.originCandidateDeliveryRef, 'P9_RUN_ORIGIN');
  const episodeClaims = buildEpisodeClaims(value.episodeClaims || []);
  if (value.role !== 'primary_payload' && episodeClaims.length) fail('P9_RUN_EPISODE_ROLE', 'Only primary payload members can carry Episode claims.');
  const member = {
    ordinal, materialKey, role: value.role,
    physicalIdentity: { mountScopeId: physicalIdentity.mountScopeId, inode: physicalIdentity.inode,
      contentHashAlgorithm: physicalIdentity.contentHashAlgorithm, contentHash: physicalIdentity.contentHash },
    sizeBytes: integer(value.sizeBytes, 0, 'sizeBytes'),
    location: { locationKind: 'domain_binding', endpointId: text(location.endpointId, 'location.endpointId'), location: location.location },
    bindingKind: value.bindingKind,
    bindingRevision: integer(value.bindingRevision, 1, 'bindingRevision'),
    bindingEvidenceDigest: digest(value.bindingEvidenceDigest, 'bindingEvidenceDigest'),
    originCandidateDeliveryRef: {
      intakeDecisionId: text(origin.intakeDecisionId, 'origin.intakeDecisionId'), offerId: text(origin.offerId, 'origin.offerId'),
      candidatePackageId: text(origin.candidatePackageId, 'origin.candidatePackageId'),
      packageRevision: integer(origin.packageRevision, 1, 'origin.packageRevision'), packageDigest: digest(origin.packageDigest, 'origin.packageDigest'),
      candidateDeliverySnapshotDigest: digest(origin.candidateDeliverySnapshotDigest, 'origin.candidateDeliverySnapshotDigest'),
      relatedReferenceSetDigest: digest(origin.relatedReferenceSetDigest, 'origin.relatedReferenceSetDigest')
    },
    admittedControlRevision: integer(value.admittedControlRevision, 1, 'admittedControlRevision'),
    admittedControlProjectionDigest: digest(value.admittedControlProjectionDigest, 'admittedControlProjectionDigest'),
    episodeClaims,
    episodeClaimSetDigest: canonicalDigest({ schema: 'libra.production-material-episode-claims@1', items: episodeClaims })
  };
  if (member.bindingKind !== 'libra_material_binding') fail('P9_RUN_BINDING_KIND', 'Run input must use a Libra Material Binding.');
  const outputRequirement = buildOutputRequirement({ acceptanceSpec, manifestRole: 'run_input', materialKey,
    materialRole: member.role, episodeKeys: episodeClaims.map((claim) => claim.episodeKey) });
  if (value.outputRequirementDigest !== undefined && value.outputRequirementDigest !== outputRequirement.outputRequirementDigest)
    fail('P9_RUN_REQUIREMENT_DIGEST', 'Caller-provided Output Requirement digest is invalid.');
  member.outputRequirementDigest = outputRequirement.outputRequirementDigest;
  member.memberDigest = canonicalDigest(member);
  return Object.freeze(member);
}

function buildProductionMaterialManifest(value, acceptanceSpec) {
  object(value, 'P9_RUN_MANIFEST');
  if (value.manifestRole !== 'run_input' || value.manifestRevision !== 1 || !['single', 'episode_delivery'].includes(value.scopeKind))
    fail('P9_RUN_MANIFEST_KIND', 'P9-02 only admits revision-one run input manifests.');
  text(value.libraRunId, 'libraRunId');
  if (!Array.isArray(value.members) || value.members.length < 1 || value.members.length > 1024) fail('P9_RUN_MEMBER_BOUND', 'Run input requires 1..1024 members.');
  const ordered = [...value.members].sort((a, b) => utf8Compare(a.materialKey || '', b.materialKey || ''));
  if (canonicalJson(ordered) !== canonicalJson(value.members)) fail('P9_RUN_MEMBER_ORDER', 'Run members must be UTF-8 material-key ordered.');
  const members = ordered.map((member, ordinal) => buildRunInputMember(member, ordinal, acceptanceSpec));
  if (members.some((member, index) => index > 0 && member.materialKey === members[index - 1].materialKey)) fail('P9_RUN_MEMBER_DUPLICATE', 'Run material keys must be unique.');
  const episodeByKey = new Map();
  for (const claim of members.flatMap((member) => member.episodeClaims)) {
    const existing = episodeByKey.get(claim.episodeKey);
    if (existing && canonicalJson(existing) !== canonicalJson(claim)) fail('P9_RUN_EPISODE_CONFLICT', 'Repeated Episode claims disagree.');
    episodeByKey.set(claim.episodeKey, claim);
  }
  const episodeScope = [...episodeByKey.values()].sort((a, b) => utf8Compare(a.episodeKey, b.episodeKey));
  if ((value.scopeKind === 'single' && episodeScope.length !== 0) || (value.scopeKind === 'episode_delivery' && episodeScope.length === 0))
    fail('P9_RUN_SCOPE_KIND', 'Manifest scope and Episode claims disagree.');
  const manifest = {
    manifestId: canonicalDigest({ schema: 'libra.production-material-manifest-id@1', manifestRole: 'run_input',
      libraRunId: value.libraRunId, manifestRevision: 1 }),
    manifestRole: 'run_input', manifestRevision: 1, libraRunId: value.libraRunId, scopeKind: value.scopeKind, members,
    memberSetDigest: canonicalDigest({ schema: 'libra.production-material-members@1', items: members }),
    episodeScopeDigest: canonicalDigest({ schema: 'libra.production-episode-scope@1', items: episodeScope })
  };
  manifest.manifestDigest = canonicalDigest(manifest);
  if (value.manifestId !== undefined && value.manifestId !== manifest.manifestId) fail('P9_RUN_MANIFEST_ID', 'Manifest identity is invalid.');
  if (value.manifestDigest !== undefined && value.manifestDigest !== manifest.manifestDigest) fail('P9_RUN_MANIFEST_DIGEST', 'Manifest digest is invalid.');
  return Object.freeze(manifest);
}

function buildRunExecutionBasis(value) {
  object(value, 'P9_RUN_BASIS');
  const subject = object(value.subjectSnapshot, 'P9_RUN_SUBJECT');
  if (!['single', 'season'].includes(subject.structureKind) || !PROFILES.has(subject.contentProfile)
    || (subject.contentProfile === 'series') !== (subject.structureKind === 'season')) fail('P9_RUN_SUBJECT', 'Subject profile and structure disagree.');
  const decisionHead = object(value.decisionHeadSnapshot, 'P9_RUN_DECISION_HEAD');
  const spec = object(value.acceptanceSpec, 'P9_RUN_SPEC');
  const shelf = object(value.shelfProjection, 'P9_RUN_SHELF');
  const manifest = buildProductionMaterialManifest(value.productionMaterialManifest, spec);
  if ((subject.structureKind === 'single') !== (manifest.scopeKind === 'single')) fail('P9_RUN_SCOPE_KIND', 'Subject and manifest scope disagree.');
  const basis = {
    subjectSnapshot: { subjectId: text(subject.subjectId, 'subjectId'), intakeRevision: integer(subject.intakeRevision, 1, 'intakeRevision'),
      structureKind: subject.structureKind, contentProfile: subject.contentProfile,
      continuitySetDigest: digest(subject.continuitySetDigest, 'continuitySetDigest'), episodeScopeDigest: digest(subject.episodeScopeDigest, 'subject.episodeScopeDigest') },
    decisionHeadSnapshot: decisionHead,
    acceptanceSpec: { acceptanceSpecId: text(spec.acceptanceSpecId, 'acceptanceSpecId'), specRevision: integer(spec.specRevision, 1, 'specRevision'),
      specDigest: digest(spec.specDigest, 'specDigest'), recordDigest: digest(spec.recordDigest, 'recordDigest'),
      productScopeDigest: digest(spec.productScopeDigest, 'productScopeDigest'), shelfId: text(spec.shelfId, 'shelfId') },
    shelfProjection: { routingProjectionRevision: integer(shelf.routingProjectionRevision, 1, 'routingProjectionRevision'),
      projectionDigest: digest(shelf.projectionDigest, 'projectionDigest'), standardRevision: integer(shelf.standardRevision, 1, 'standardRevision'),
      standardDigest: digest(shelf.standardDigest, 'standardDigest') },
    productionMaterialManifest: manifest
  };
  basis.executionBasisDigest = canonicalDigest(basis);
  if (value.executionBasisDigest !== undefined && value.executionBasisDigest !== basis.executionBasisDigest)
    fail('P9_RUN_BASIS_DIGEST', 'Execution Basis digest is invalid.');
  bytes(basis, 8 * 1024 * 1024, 'P9_RUN_BASIS_LIMIT'); return Object.freeze(basis);
}

function buildRunExecutionBasisRecord(basis) {
  const full = basis && basis.executionBasisDigest ? basis : buildRunExecutionBasis(basis);
  if (full.executionBasisDigest !== canonicalDigest(without(full, 'executionBasisDigest')))
    fail('P9_RUN_BASIS_DIGEST', 'Execution Basis digest is invalid.');
  const manifest = full.productionMaterialManifest;
  return Object.freeze({ ...without(full, 'productionMaterialManifest'), productionMaterialManifestRef: {
    manifestId: manifest.manifestId, manifestDigest: manifest.manifestDigest, memberCount: manifest.members.length,
    episodeScopeDigest: manifest.episodeScopeDigest
  } });
}

function runScopeDigest(basis) {
  const value = basis && basis.executionBasisDigest ? basis : buildRunExecutionBasis(basis);
  if (value.executionBasisDigest !== canonicalDigest(without(value, 'executionBasisDigest')))
    fail('P9_RUN_BASIS_DIGEST', 'Execution Basis digest is invalid.');
  return canonicalDigest({ schema: 'libra.run-scope@1', subjectId: value.subjectSnapshot.subjectId,
    structureKind: value.subjectSnapshot.structureKind, contentProfile: value.subjectSnapshot.contentProfile,
    productScopeDigest: value.acceptanceSpec.productScopeDigest, episodeScopeDigest: value.productionMaterialManifest.episodeScopeDigest,
    productionMaterialManifestDigest: value.productionMaterialManifest.manifestDigest });
}

function activeRunScopeSetDigest(subjectId, items) {
  text(subjectId, 'subjectId'); if (!Array.isArray(items)) fail('P9_RUN_SCOPE_SET', 'Active scope items are required.');
  const ordered = [...items].sort((a, b) => utf8Compare(a.libraRunId, b.libraRunId));
  if (canonicalJson(ordered) !== canonicalJson(items) || ordered.some((item, index) => index > 0 && item.libraRunId === ordered[index - 1].libraRunId))
    fail('P9_RUN_SCOPE_SET', 'Active scope items must be unique and UTF-8 ordered.');
  for (const item of ordered) { text(item.libraRunId, 'scope.libraRunId'); digest(item.runScopeDigest, 'scope.runScopeDigest'); integer(item.stateRevision, 1, 'scope.stateRevision'); digest(item.stateDigest, 'scope.stateDigest'); }
  return canonicalDigest({ schema: 'libra.active-run-scopes@1', subjectId, items: ordered });
}

function buildRunAdmissionDecision(value) {
  object(value, 'P9_RUN_ADMISSION');
  const head = object(value.expectedRunAdmissionHead, 'P9_RUN_ADMISSION_HEAD');
  integer(head.headRevision, 0, 'headRevision'); digest(head.activeScopeSetDigest, 'activeScopeSetDigest');
  if (!['absent', 'present'].includes(head.headState) || (head.headState === 'absent' && head.headRevision !== 0)
    || (head.headState === 'present' && head.headRevision < 1)) fail('P9_RUN_ADMISSION_HEAD', 'Run admission head snapshot is invalid.');
  const basis = value.runExecutionBasis && value.runExecutionBasis.executionBasisDigest
    ? value.runExecutionBasis : buildRunExecutionBasis(value.runExecutionBasis);
  if (basis.executionBasisDigest !== canonicalDigest(without(basis, 'executionBasisDigest')))
    fail('P9_RUN_BASIS_DIGEST', 'Execution Basis digest is invalid.');
  const subjectId = basis.subjectSnapshot.subjectId;
  if (value.subjectId !== subjectId || !['initial', 'replacement'].includes(value.admissionKind)) fail('P9_RUN_ADMISSION_KIND', 'Admission kind or Subject is invalid.');
  const admissionRevision = head.headRevision + 1;
  const libraRunId = canonicalDigest({ schema: 'libra.run-id@1', subjectId, admissionRevision });
  if (basis.productionMaterialManifest.libraRunId !== libraRunId) fail('P9_RUN_ID_CONTINUITY', 'Manifest Run identity does not match admission revision.');
  const priority = object(value.initialPriority, 'P9_RUN_PRIORITY');
  if (!['normal', 'expedited'].includes(priority.priorityClass)) fail('P9_RUN_PRIORITY', 'Priority class is invalid.');
  digest(priority.priorityIntentDigest, 'priorityIntentDigest');
  const emptyPriority = canonicalDigest({ schema: 'libra.priority-intent-empty@1' });
  const replacement = value.replacementOfRunRef || null;
  if (value.admissionKind === 'initial' && (replacement !== null || priority.priorityClass !== 'normal' || priority.priorityIntentDigest !== emptyPriority))
    fail('P9_RUN_INITIAL_PRIORITY', 'Initial admission has fixed empty normal priority.');
  if (value.admissionKind === 'replacement') {
    object(replacement, 'P9_RUN_REPLACEMENT');
    for (const field of ['libraRunId', 'acceptanceSpecId']) text(replacement[field], field);
    for (const field of ['stateDigest', 'runScopeDigest', 'executionBasisDigest']) digest(replacement[field], field);
    integer(replacement.stateRevision, 1, 'replacement.stateRevision');
    if (replacement.acceptanceSpecId === basis.acceptanceSpec.acceptanceSpecId && replacement.executionBasisDigest === basis.executionBasisDigest)
      fail('P9_RUN_REPLACEMENT_CHANGE', 'Replacement requires a changed Spec record or Execution Basis.');
  }
  const scopeDigest = runScopeDigest(basis);
  const decision = { admissionKind: value.admissionKind, subjectId, admissionRevision, libraRunId,
    expectedRunAdmissionHead: { headState: head.headState, headRevision: head.headRevision, activeScopeSetDigest: head.activeScopeSetDigest },
    runExecutionBasis: basis, initialPriority: { priorityClass: priority.priorityClass, priorityIntentDigest: priority.priorityIntentDigest },
    runScopeDigest: scopeDigest };
  if (replacement) decision.replacementOfRunRef = {
    libraRunId: replacement.libraRunId, stateRevision: replacement.stateRevision, stateDigest: replacement.stateDigest,
    runScopeDigest: replacement.runScopeDigest, acceptanceSpecId: replacement.acceptanceSpecId,
    executionBasisDigest: replacement.executionBasisDigest
  };
  decision.decisionId = canonicalDigest({ schema: 'libra.run-admission-decision-id@1', libraRunId,
    executionBasisDigest: basis.executionBasisDigest, priorityClass: priority.priorityClass,
    priorityIntentDigest: priority.priorityIntentDigest });
  decision.decisionDigest = canonicalDigest(decision);
  return Object.freeze(decision);
}

module.exports = Object.freeze({ LibraRunAdmissionContractError, activeRunScopeSetDigest, buildProductionMaterialManifest,
  buildOutputRequirement, buildRunAdmissionDecision, buildRunExecutionBasis, buildRunExecutionBasisRecord, runScopeDigest });
