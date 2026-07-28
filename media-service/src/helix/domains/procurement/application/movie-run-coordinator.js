'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const candidateAssemblyBindingSchema = require(
  '../../../contracts/application-types/ProcurementCandidateAssemblyPlanBinding/v1/schema.json'
);
const {
  createCapabilityContractValidator,
} = require('../../../foundation/capability/contract-validator');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { createWorkAdmission } = require('../../../foundation/execution/work-admission');
const {
  createSupportingResultStore,
} = require('../../../foundation/persistence/supporting-result-store');
const { createCandidatePublicationStore } = require('../persistence/candidate-publication-store');
const { activeTriageRule } = require('../model/procurement-run-contracts');
const {
  buildPrimaryManifestDraft,
  inspectPlayability,
  inspectStructure,
  resolveIdentity,
} = require('../model/triage-contracts');
const {
  buildOffer,
  validateDraft,
} = require('../model/candidate-publication-contracts');

const CAPABILITY_REF = 'procurement.candidate.publish@1';
const PROBE_CAPABILITY_REF = 'shared.material.media.probe@1';
const PLAYABILITY_CAPABILITY_REF = 'procurement.triage.playability.inspect@1';
const STRUCTURE_CAPABILITY_REF = 'procurement.triage.structure.inspect@1';
const IDENTITY_CAPABILITY_REF = 'procurement.triage.identity_claim.resolve@1';
const MANIFEST_CAPABILITY_REF = 'procurement.triage.primary_manifest.build@1';
const RESULT_SCHEMAS = Object.freeze({
  probe: 'helix://contracts/capabilities/shared.material.media.probe/v1/result',
  playability: 'helix://contracts/capabilities/procurement.triage.playability.inspect/v1/result',
  structure: 'helix://contracts/capabilities/procurement.triage.structure.inspect/v1/result',
  identity: 'helix://contracts/capabilities/procurement.triage.identity_claim.resolve/v1/result',
  manifest: 'helix://contracts/capabilities/procurement.triage.primary_manifest.build/v1/result',
});
const PLAN_BINDING_SCHEMA =
  'helix://contracts/application-types/ProcurementCandidateAssemblyPlanBinding/v1';
const PLAN_JSON_LIMIT = 16 * 1024;
const planBindingValidator = createCapabilityContractValidator({
  schemas: [candidateAssemblyBindingSchema],
});

class MovieRunCoordinatorError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MovieRunCoordinatorError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new MovieRunCoordinatorError(code, message, details);
}

function without(value, ...fields) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key)));
}

function stableId(prefix, value) {
  return prefix + canonicalDigest(value).slice(0, 40);
}

function utf8(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function relativeLocation(root, location) {
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedLocation = location.replace(/\\/g, '/');
  const prefix = normalizedRoot + '/';
  if (!normalizedLocation.startsWith(prefix) || normalizedLocation.length === prefix.length) return null;
  return normalizedLocation.slice(prefix.length);
}

function fileContext(snapshot, row, selectionOrdinal) {
  const relative = relativeLocation(snapshot.access.root_location, row.location);
  if (relative === null) fail('P14_MOVIE_TRIAGE_LOCATION_OUTSIDE_FIELD',
    'Run Material location is outside its exact Field Access root.');
  const separator = relative.lastIndexOf('/');
  const baseName = separator < 0 ? relative : relative.slice(separator + 1);
  const extensionIndex = baseName.lastIndexOf('.');
  return Object.freeze({
    row,
    selectionOrdinal,
    materialKey: row.material_key,
    fieldRelativeLocation: relative,
    baseName,
    extension: extensionIndex < 0 ? '' : baseName.slice(extensionIndex).toLowerCase(),
    stem: extensionIndex < 0 ? baseName.toLowerCase() : baseName.slice(0, extensionIndex).toLowerCase(),
    parentSegments: Object.freeze((separator < 0 ? '' : relative.slice(0, separator))
      .split('/').filter((part) => part && part !== '.')),
  });
}

function sameDirectory(left, right) {
  return left.parentSegments.length === right.parentSegments.length &&
    left.parentSegments.every((part, index) => part === right.parentSegments[index]);
}

const PRIMARY_MEDIA_EXTENSIONS = new Set([
  '.3gp', '.asf', '.avi', '.divx', '.flv', '.iso', '.m2ts', '.m4v', '.mkv',
  '.mov', '.mp4', '.mpeg', '.mpg', '.mts', '.ogm', '.ogv', '.rm', '.rmvb',
  '.ts', '.vob', '.webm', '.wmv',
]);
const SEASON_TOKEN = /(?:^|[ ._-])S(\d{1,2})E\d{1,3}|(?:^|[ ._-])(\d{1,2})x\d{1,3}/i;

function seasonNumber(context) {
  const match = context.baseName.match(SEASON_TOKEN);
  return match ? Number(match[1] || match[2]) : null;
}

function isSameOrDescendantDirectory(parentSegments, childSegments) {
  return childSegments.length >= parentSegments.length &&
    parentSegments.every((part, index) => childSegments[index] === part);
}

function localSeasonGroupKey(primary) {
  return canonicalDigest({
    schema: 'procurement.local-series-season-topology@1',
    parentSegments: primary.parentSegments,
    seasonNumber: seasonNumber(primary),
  });
}

function uniqueLocalSeasonGroup(related, primaries, requiredSeason = null) {
  const local = primaries.filter((primary) =>
    isSameOrDescendantDirectory(related.parentSegments, primary.parentSegments) &&
    (requiredSeason === null || seasonNumber(primary) === requiredSeason));
  const groups = new Map();
  for (const primary of local) {
    const key = localSeasonGroupKey(primary);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(primary);
  }
  if (groups.size !== 1) return [];
  // The topology has already proved one local Season group. This stable anchor
  // only attaches a Candidate-level Related Reference; it does not choose
  // between ambiguous Series/Season groups or create continuity identity.
  return [[...groups.values()][0]
    .sort((left, right) => utf8(left.materialKey, right.materialKey))[0]];
}

function relatedCandidates(related, primaries) {
  const sameDirectoryPrimaries = primaries.filter((primary) => sameDirectory(primary, related));
  const stemMatches = sameDirectoryPrimaries.filter((primary) => primary.stem === related.stem);
  if (stemMatches.length > 0) return stemMatches;

  const lower = related.baseName.toLowerCase();
  const seasonArtwork = lower.match(/^season0*(\d+)-(?:poster|fanart|background|backdrop)\.(?:jpe?g|png|webp)$/);
  if (seasonArtwork) {
    return uniqueLocalSeasonGroup(related, primaries, Number(seasonArtwork[1]));
  }

  if (/^(?:movie|tvshow)\.nfo$/.test(lower) ||
      /^(?:poster|fanart|background|backdrop)\.(?:jpe?g|png|webp)$/.test(lower)) {
    return uniqueLocalSeasonGroup(related, primaries);
  }
  return [];
}

function layoutEntry(context, entryOrdinal) {
  const row = context.row;
  const value = {
    entryOrdinal,
    entryKind: 'file',
    relativeLocation: context.fieldRelativeLocation,
    baseName: context.baseName,
    extension: context.extension,
    identity: identity(row),
    endpointId: row.endpoint_id,
    location: row.location,
    sizeBytes: Number(row.size_bytes),
    checksumAlgorithm: 'sha256',
    checksumHex: row.content_hash,
  };
  return Object.freeze({ ...value, entryDigest: canonicalDigest(value) });
}

function layoutEvidence(snapshot, primary, related) {
  const entries = Object.freeze([...related]
    .sort((left, right) => utf8(left.materialKey, right.materialKey))
    .map(layoutEntry));
  const sourceHandleDigest = canonicalDigest({
    schema: 'procurement.movie-layout-source@1',
    fieldId: snapshot.run.field_id,
    accessRevision: Number(snapshot.run.access_revision),
    accessDigest: snapshot.run.access_digest,
    runBasisDigest: snapshot.run.run_basis_digest,
  });
  const boundedScopeDigest = canonicalDigest({
    schema: 'procurement.movie-related-scope@1',
    primaryMaterialKey: primary.materialKey,
    parentSegments: primary.parentSegments,
  });
  const entriesDigest = canonicalDigest({
    schema: 'procurement.movie-layout-entries@1',
    items: entries,
  });
  const basisDigest = canonicalDigest({
    schema: 'procurement.movie-related-association-basis@1',
    runBasisDigest: snapshot.run.run_basis_digest,
    primaryMaterialKey: primary.materialKey,
    relatedMaterialKeys: entries.map((entry) => entry.identity.materialKey),
  });
  const base = {
    schemaRef: 'helix://contracts/types/LayoutEvidence/v1',
    schemaVersion: 1,
    evidenceId: stableId('movie-layout-evidence-', {
      runId: snapshot.run.procurement_run_id,
      primaryMaterialKey: primary.materialKey,
      basisDigest,
    }),
    evidenceKind: 'field_layout',
    producerRef: 'procurement.movie-related-material-association@1',
    basisDigest,
    payloadDigest: '',
    observedAtMs: 0,
    sourceHandleDigest,
    boundedScopeDigest,
    entries,
    entriesDigest,
    layoutDigest: canonicalDigest({
      schema: 'procurement.movie-layout@1',
      sourceHandleDigest,
      boundedScopeDigest,
      entriesDigest,
    }),
  };
  return Object.freeze({ ...base, payloadDigest: canonicalDigest(without(base, 'payloadDigest')) });
}

function movieLayout(snapshot) {
  const contexts = snapshot.members.map((row, index) => fileContext(snapshot, row, index));
  const primaries = contexts.filter((context) => PRIMARY_MEDIA_EXTENSIONS.has(context.extension));
  const relatedMaterials = contexts.filter((context) => !PRIMARY_MEDIA_EXTENSIONS.has(context.extension));
  const relatedByPrimary = new Map(primaries.map((context) => [context.materialKey, []]));
  const unresolved = [];
  for (const related of relatedMaterials) {
    const candidates = relatedCandidates(related, primaries);
    if (candidates.length !== 1) {
      unresolved.push(Object.freeze({
        materialKey: related.materialKey,
        reasonCode: 'structure_ambiguous',
        candidatePrimaryCount: candidates.length,
      }));
      continue;
    }
    relatedByPrimary.get(candidates[0].materialKey).push(related);
  }
  const evidence = [];
  const primaryContexts = primaries.map((primary, selectionOrdinal) => {
    const related = relatedByPrimary.get(primary.materialKey);
    const item = related.length > 0 ? layoutEvidence(snapshot, primary, related) : null;
    if (item) evidence.push(item);
    return Object.freeze({
      row: primary.row,
      selectionOrdinal,
      materialKey: primary.materialKey,
      fieldRelativeLocation: primary.fieldRelativeLocation,
      baseName: primary.baseName,
      extension: primary.extension || '.unknown',
      parentSegments: primary.parentSegments,
      layoutEvidenceRefs: Object.freeze(item ? [Object.freeze({
        evidenceId: item.evidenceId,
        payloadDigest: item.payloadDigest,
        boundedScopeDigest: item.boundedScopeDigest,
      })] : []),
    });
  });
  return Object.freeze({
    primaryContexts: Object.freeze(primaryContexts),
    layoutEvidence: Object.freeze(evidence.sort((left, right) => utf8(left.evidenceId, right.evidenceId))),
    unresolved: Object.freeze(unresolved.sort((left, right) => utf8(left.materialKey, right.materialKey))),
  });
}

function definition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'movie_run_coordinator', owner: 'procurement', schemaManifest,
    statements: {
      find_run: { kind: 'select-one', tableId: 'proc_procurement_runs', safeIntegers: true,
        columns: ['procurement_run_id', 'field_id', 'access_revision', 'access_digest',
          'content_profile_hint', 'profile_hint_revision', 'profile_hint_digest', 'run_basis_digest',
          'triage_rule_ref', 'triage_rule_revision', 'triage_rule_authority_digest',
          'state', 'state_revision', 'candidate_package_revision_head'], keyColumns: ['procurement_run_id'] },
      find_access: { kind: 'select-one', tableId: 'proc_field_access_revisions', safeIntegers: true,
        columns: ['field_id', 'revision', 'root_location', 'access_digest'], keyColumns: ['field_id', 'revision'] },
      list_members: { kind: 'select-all', tableId: 'proc_run_materials', safeIntegers: true,
        columns: ['procurement_run_id', 'ordinal', 'material_key', 'mount_scope_id', 'inode',
          'content_hash_algorithm', 'content_hash', 'size_bytes', 'binding_revision',
          'admitted_control_revision', 'admitted_control_projection_digest', 'selection_state',
          'candidate_package_id', 'endpoint_id', 'location', 'reality_digest', 'provenance_digest',
          'last_snapshot_digest', 'last_observation_id'], keyColumns: ['procurement_run_id'] },
      find_candidate: { kind: 'select-one', tableId: 'proc_candidate_packages', safeIntegers: true,
        columns: ['candidate_package_id', 'procurement_run_id', 'package_revision', 'package_digest', 'state'],
        keyColumns: ['candidate_package_id'] },
      find_delivery: { kind: 'select-one', tableId: 'proc_candidate_deliveries', safeIntegers: true,
        columns: ['offer_id', 'candidate_package_id', 'package_revision', 'package_digest', 'acceptance_basis_digest', 'state',
          'handoff_decision_id', 'handoff_receipt_id', 'handoff_receipt_digest', 'terminal_evidence_digest'],
        keyColumns: ['candidate_package_id'] },
    },
  });
}

function identity(row) {
  return Object.freeze({
    schemaRef: 'helix://contracts/types/PhysicalMaterialIdentity/v1', schemaVersion: 1,
    materialKey: row.material_key, mountScopeId: row.mount_scope_id, inode: String(row.inode),
    contentHashAlgorithm: row.content_hash_algorithm, contentHash: row.content_hash,
  });
}

function readHandle(row) {
  return Object.freeze({
    identity: identity(row), bindingRevision: Number(row.binding_revision), location: row.location,
  });
}

function runSnapshot(options, repository, runId) {
  return options.unitOfWork.execute([{
    participantId: 'movie_run_snapshot', owner: 'procurement', repositories: [repository],
    execute(context) {
      const store = context.repository(repository.repositoryId);
      const run = store.invoke('find_run', { procurement_run_id: runId });
      if (!run) return null;
      const access = store.invoke('find_access', { field_id: run.field_id, revision: Number(run.access_revision) });
      const members = store.invoke('list_members', { procurement_run_id: runId })
        .sort((left, right) => Number(left.ordinal) - Number(right.ordinal));
      const packageIds = [...new Set(members.map((member) => member.candidate_package_id).filter(Boolean))];
      const candidate = packageIds.length === 1
        ? store.invoke('find_candidate', { candidate_package_id: packageIds[0] })
        : null;
      const delivery = candidate
        ? store.invoke('find_delivery', { candidate_package_id: candidate.candidate_package_id })
        : null;
      return Object.freeze({ run, access, members: Object.freeze(members), candidate, delivery });
    },
  }]).movie_run_snapshot;
}

function acceptedHandoffReplay(snapshot) {
  const candidateMembers = snapshot.candidate
    ? snapshot.members.filter((member) =>
      member.candidate_package_id === snapshot.candidate.candidate_package_id)
    : [];
  if (!snapshot.candidate || !snapshot.delivery || snapshot.delivery.state !== 'accepted' ||
      candidateMembers.length < 1 ||
      candidateMembers.some((member) => member.selection_state !== 'transferred') ||
      snapshot.members.some((member) => member.candidate_package_id !== null &&
        member.candidate_package_id !== snapshot.candidate.candidate_package_id)) return null;
  if (snapshot.delivery.handoff_decision_id === null || snapshot.delivery.handoff_receipt_id === null ||
      snapshot.delivery.handoff_receipt_digest === null ||
      snapshot.delivery.terminal_evidence_digest !== snapshot.delivery.handoff_receipt_digest) {
    fail('P14_MOVIE_HANDOFF_REPLAY_CORRUPT', 'Accepted Candidate Delivery has incomplete terminal Handoff evidence.');
  }
  return Object.freeze({
    stage: 'handoff_a_accepted', replayed: true,
    procurementRunId: snapshot.run.procurement_run_id,
    candidatePackage: Object.freeze({
      candidatePackageId: snapshot.candidate.candidate_package_id,
      packageRevision: Number(snapshot.candidate.package_revision),
      packageDigest: snapshot.candidate.package_digest,
      state: snapshot.candidate.state,
    }),
    offer: Object.freeze({
      schemaRef: 'helix://contracts/types/ProcurementCandidateOfferAvailableMessage/v1',
      schemaVersion: 1,
      messageKind: 'procurement_candidate_offer_available',
      offerId: snapshot.delivery.offer_id,
      candidatePackageId: snapshot.candidate.candidate_package_id,
      packageRevision: Number(snapshot.candidate.package_revision),
      packageDigest: snapshot.candidate.package_digest,
      acceptanceBasisDigest: snapshot.delivery.acceptance_basis_digest,
      acceptanceOwnerDomain: 'libra',
      targetContext: 'libra_intake',
    }),
  });
}

function openHandoffResume(snapshot) {
  const candidateMembers = snapshot.candidate
    ? snapshot.members.filter((member) =>
      member.candidate_package_id === snapshot.candidate.candidate_package_id)
    : [];
  if (!snapshot.candidate || !snapshot.delivery || snapshot.delivery.state !== 'open' ||
      candidateMembers.length < 1 ||
      candidateMembers.some((member) => member.selection_state !== 'candidate_delivery') ||
      snapshot.members.some((member) => member.candidate_package_id !== null &&
        member.candidate_package_id !== snapshot.candidate.candidate_package_id)) return null;
  if (snapshot.delivery.offer_id === null || snapshot.delivery.acceptance_basis_digest === null ||
      snapshot.delivery.package_digest !== snapshot.candidate.package_digest ||
      Number(snapshot.delivery.package_revision) !== Number(snapshot.candidate.package_revision)) {
    fail('P14_MOVIE_HANDOFF_RESUME_CORRUPT', 'Open Candidate Delivery cannot reconstruct its exact Handoff A Offer.');
  }
  return Object.freeze({
    offer: Object.freeze({
      schemaRef: 'helix://contracts/types/ProcurementCandidateOfferAvailableMessage/v1', schemaVersion: 1,
      messageKind: 'procurement_candidate_offer_available', offerId: snapshot.delivery.offer_id,
      candidatePackageId: snapshot.candidate.candidate_package_id,
      packageRevision: Number(snapshot.candidate.package_revision), packageDigest: snapshot.candidate.package_digest,
      acceptanceBasisDigest: snapshot.delivery.acceptance_basis_digest,
      acceptanceOwnerDomain: 'libra', targetContext: 'libra_intake',
    }),
    candidatePackage: Object.freeze({
      candidatePackageId: snapshot.candidate.candidate_package_id,
      packageRevision: Number(snapshot.candidate.package_revision),
      packageDigest: snapshot.candidate.package_digest, state: snapshot.candidate.state,
    }),
  });
}

function selection(snapshot, primaryContexts) {
  const members = primaryContexts.map(({ row }, ordinal) => Object.freeze({
    ordinal,
    materialKey: row.material_key,
    role: 'primary_payload',
    physicalIdentity: identity(row),
    sizeBytes: Number(row.size_bytes),
    bindingRevision: Number(row.binding_revision),
    admittedControlRevision: Number(row.admitted_control_revision),
    admittedControlProjectionDigest: row.admitted_control_projection_digest,
  }));
  const value = { procurementRunId: snapshot.run.procurement_run_id, fieldId: snapshot.run.field_id,
    runBasisDigest: snapshot.run.run_basis_digest, members };
  return Object.freeze({ ...value, selectionDigest: canonicalDigest({
      schema: 'procurement.movie-journey-selection@1', ...value,
  }) });
}

function triageBatch(value, probes) {
  const members = value.members.map((member, index) => {
    const handle = readHandle(probes[index].row);
    const item = {
      selectionOrdinal: index, materialKey: member.materialKey,
      bindingRevision: member.bindingRevision,
      admittedControlRevision: member.admittedControlRevision,
      admittedControlProjectionDigest: member.admittedControlProjectionDigest,
      readHandle: handle, mediaProbe: probes[index].probe,
    };
    return Object.freeze({ ...item, memberDigest: canonicalDigest(item) });
  });
  const valueWithoutDigest = {
    procurementRunId: value.procurementRunId, runBasisDigest: value.runBasisDigest,
    selectionDigest: value.selectionDigest, batchOrdinal: 0, members,
  };
  return Object.freeze({ ...valueWithoutDigest, batchDigest: canonicalDigest(valueWithoutDigest) });
}

function structureInput(selected, batch, playability, snapshot, layout) {
  const contexts = layout.primaryContexts.map((context) => Object.freeze({
    selectionOrdinal: context.selectionOrdinal,
    materialKey: context.materialKey,
    fieldRelativeLocation: context.fieldRelativeLocation,
    baseName: context.baseName,
    extension: context.extension,
    parentSegments: context.parentSegments,
    layoutEvidenceRefs: context.layoutEvidenceRefs,
  }));
  const contextValue = {
    fieldId: snapshot.run.field_id, accessRevision: Number(snapshot.run.access_revision),
    accessDigest: snapshot.run.access_digest,
    profileHintSnapshot: Object.freeze({
      fieldId: snapshot.run.field_id,
      revision: Number(snapshot.run.profile_hint_revision),
      contentProfileHint: snapshot.run.content_profile_hint,
      hintDigest: snapshot.run.profile_hint_digest,
    }),
    memberContexts: Object.freeze(contexts),
  };
  const materialFieldContext = Object.freeze({
    ...contextValue, contextDigest: canonicalDigest(contextValue),
  });
  const requestValue = { pageOrdinal: 0, cursorIn: null, maxUnits: 64 };
  const pageRequest = Object.freeze({ ...requestValue, requestDigest: canonicalDigest(requestValue) });
  const basis = {
    schema: 'procurement.triage-structure-input@1', selectionDigest: selected.selectionDigest,
    probeBatchDigests: [batch.batchDigest], playabilityPayloadDigests: [playability.payloadDigest],
    contextDigest: materialFieldContext.contextDigest, layoutPayloadDigests: [], pageRequest,
  };
  basis.layoutPayloadDigests = layout.layoutEvidence.map((item) => item.payloadDigest);
  return Object.freeze({
    selectedFieldMaterialSet: selected, probeBatches: Object.freeze([batch]),
    playabilityPages: Object.freeze([playability]), materialFieldContext,
    layoutEvidence: layout.layoutEvidence, pageRequest, inputDigest: canonicalDigest(basis),
  });
}

function draftFor(unit, structure, selected, snapshot, rule, identityClaim, manifestDraft) {
  const relatedReferences = Object.freeze([...unit.relatedReferences].sort((left, right) => utf8(left.referenceId, right.referenceId)));
  const controls = Object.freeze([...unit.members].sort((left, right) => utf8(left.materialKey, right.materialKey)).map((member) =>
    Object.freeze({ materialKey: member.materialKey, admittedControlRevision: member.admittedControlRevision,
      admittedControlProjectionDigest: member.admittedControlProjectionDigest })));
  const value = {
    draftId: stableId('movie-candidate-draft-', { runId: snapshot.run.procurement_run_id, unitId: unit.unitId }),
    draftKind: 'procurement_candidate', basisDigest: structure.payloadDigest, draftDigest: '',
    producedAtMs: 0,
    candidatePackageId: stableId('candidate-package-', {
      procurementRunId: snapshot.run.procurement_run_id, unitId: unit.unitId,
    }),
    expectedPackageRevision: Number(snapshot.run.candidate_package_revision_head) + 1,
    procurementRunId: snapshot.run.procurement_run_id, runBasisDigest: snapshot.run.run_basis_digest,
    triageRule: Object.freeze({ ruleRef: rule.ruleRef, revision: rule.revision, authorityDigest: rule.authorityDigest }),
    materialFieldContextRef: Object.freeze({ fieldId: snapshot.run.field_id,
      accessRevision: Number(snapshot.run.access_revision), contextDigest: structure.materialFieldContextDigest }),
    mediaType: unit.mediaType, contentProfile: unit.contentProfile, displayIdentity: unit.displayIdentity,
    identityMetadata: unit.identityMetadata, identityClaim,
    structureEvidence: Object.freeze({ evidenceId: structure.evidenceId, payloadDigest: structure.payloadDigest, unit }),
    primaryInputManifestDraft: manifestDraft,
    seasonContinuityClaims: unit.seasonContinuityClaims,
    seasonContinuityClaimSetDigest: unit.seasonContinuityClaimSetDigest,
    relatedReferences,
    relatedReferenceSetDigest: canonicalDigest({ schema: 'procurement.related-reference-set@1', items: relatedReferences }),
    memberControlEvidenceSetDigest: canonicalDigest({ schema: 'procurement.candidate-member-control-evidence@1', items: controls }),
    candidateDraftDigest: '',
  };
  value.candidateDraftDigest = canonicalDigest(without(value, 'draftDigest', 'candidateDraftDigest'));
  value.draftDigest = value.candidateDraftDigest;
  return Object.freeze(value);
}

function assemblyBasis(snapshot, selected, layout, rule) {
  const value = {
    schema: 'procurement.candidate-assembly-basis@1',
    procurementRunId: snapshot.run.procurement_run_id,
    runBasisDigest: snapshot.run.run_basis_digest,
    candidatePackageRevisionHead: Number(snapshot.run.candidate_package_revision_head),
    fieldId: snapshot.run.field_id,
    accessRevision: Number(snapshot.run.access_revision),
    accessDigest: snapshot.run.access_digest,
    triageRuleRef: rule.ruleRef,
    triageRuleRevision: rule.revision,
    triageRuleAuthorityDigest: rule.authorityDigest,
    selectionDigest: selected.selectionDigest,
    layoutEvidenceDigests: layout.layoutEvidence.map((item) => item.payloadDigest),
  };
  return Object.freeze({ ...value, assemblyBasisDigest: canonicalDigest(value) });
}

function workDefinition(basis, phase, phaseBasisDigest, outputContractRef) {
  const workId = stableId('movie-candidate-assembly-work-', {
    procurementRunId: basis.procurementRunId,
    assemblyBasisDigest: basis.assemblyBasisDigest,
    phase,
    phaseBasisDigest,
  });
  return Object.freeze({
    schemaRef: 'helix://foundation/types/SupportingWorkDefinition/v1', schemaVersion: 1, workId,
    ownerDomain: 'procurement', processType: 'procurement_run', processId: basis.procurementRunId,
    workKind: 'candidate_assembly_' + phase,
    workObjectiveTypeRef: 'helix://procurement/work/CandidateAssemblyPhase/v1',
    workObjectiveVersion: 1,
    executionBasisId: stableId('movie-candidate-assembly-phase-basis-', {
      procurementRunId: basis.procurementRunId,
      assemblyBasisDigest: basis.assemblyBasisDigest,
      phase,
      phaseBasisDigest,
    }),
    executionBasisDigest: phaseBasisDigest,
    dependencyRefs: Object.freeze([]), priorityClass: 'normal_foreground',
    priorityRevision: 1, capabilityCatalogScope: 'procurement', workspaceMaterialScope: Object.freeze([]),
    idempotencyKey: stableId('movie-candidate-assembly-phase-key-', {
      procurementRunId: basis.procurementRunId,
      assemblyBasisDigest: basis.assemblyBasisDigest,
      phase,
      phaseBasisDigest,
    }),
    concurrencyScope: basis.procurementRunId + '/candidate-assembly/' + phase,
    outputContractRef,
  });
}

function closedBinding(value) {
  const binding = {
    schemaRef: PLAN_BINDING_SCHEMA,
    schemaVersion: 1,
    ...value,
    bindingDigest: '',
  };
  binding.bindingDigest = canonicalDigest(without(binding, 'bindingDigest'));
  planBindingValidator.validate(PLAN_BINDING_SCHEMA, binding);
  if (Buffer.byteLength(JSON.stringify(binding), 'utf8') > PLAN_JSON_LIMIT) {
    fail('P14_CANDIDATE_PLAN_BINDING_TOO_LARGE',
      'Candidate assembly Plan binding exceeds the fixed 16 KiB construction limit.');
  }
  return Object.freeze(binding);
}

function resultRef(role, eventId, capabilityRef, resultSchemaRef, result) {
  return Object.freeze({
    role,
    eventId,
    resultId: stableId('candidate-assembly-result-', { eventId }),
    capabilityRef,
    resultSchemaRef,
    resultDigest: canonicalDigest(result),
  });
}

function resultIdentity(role, eventId, capabilityRef, resultSchemaRef) {
  return Object.freeze({
    role,
    eventId,
    resultId: stableId('candidate-assembly-result-', { eventId }),
    capabilityRef,
    resultSchemaRef,
  });
}

function capabilityStep(value) {
  const demand = Object.freeze({
    resourceKinds: Object.freeze(value.resourceKinds || ['cpu']),
  });
  const eventFenceDigest = canonicalDigest({
    schema: 'procurement.candidate-assembly-event-fence@1',
    workId: value.workId,
    eventId: value.eventId,
    capabilityRef: value.capabilityRef,
    bindingDigest: value.input.bindingDigest,
    outputIdentityDigest: canonicalDigest(value.outputIdentity),
  });
  return Object.freeze({
    nodeId: value.nodeId,
    eventId: value.eventId,
    capabilityRef: value.capabilityRef,
    effectClass: value.effectClass,
    inputSchemaRef: PLAN_BINDING_SCHEMA,
    input: value.input,
    parametersSchemaRef: value.contractBase + '/parameters',
    parameters: Object.freeze({}),
    fenceSchemaRef: value.contractBase + '/fence',
    fenceBasis: Object.freeze({
      basisDigest: value.basisDigest,
      eventFenceDigest,
    }),
    resourceDemandSchemaRef: value.contractBase + '/resource-demand',
    resourceDemand: Object.freeze({ ...demand, demandDigest: canonicalDigest(demand) }),
  });
}

function exactResultRef(actual, expected) {
  if (!actual || canonicalDigest(actual) !== expected.resultDigest) {
    fail('P14_CANDIDATE_ASSEMBLY_RESULT_DIGEST',
      'Candidate assembly Result does not match its frozen Plan reference.', {
        role: expected.role,
        eventId: expected.eventId,
      });
  }
}

function assertBinding(binding, kind, basisDigest) {
  planBindingValidator.validate(PLAN_BINDING_SCHEMA, binding);
  if (!binding || binding.schemaRef !== PLAN_BINDING_SCHEMA || binding.schemaVersion !== 1 ||
      binding.bindingKind !== kind || binding.assemblyBasisDigest !== basisDigest ||
      binding.bindingDigest !== canonicalDigest(without(binding, 'bindingDigest'))) {
    fail('P14_CANDIDATE_PLAN_BINDING_CORRUPT',
      'Candidate assembly Plan binding is absent, stale, or corrupt.', { kind });
  }
  if (Buffer.byteLength(JSON.stringify(binding), 'utf8') > PLAN_JSON_LIMIT) {
    fail('P14_CANDIDATE_PLAN_BINDING_TOO_LARGE',
      'Stored Candidate assembly Plan binding exceeds 16 KiB.', { kind });
  }
  return binding;
}

function assertResultReference(ref, expected) {
  const required = [
    'role', 'eventId', 'resultId', 'capabilityRef', 'resultSchemaRef', 'resultDigest',
  ];
  if (!ref || typeof ref !== 'object' || Array.isArray(ref) ||
      Object.keys(ref).length !== required.length ||
      required.some((key) => !Object.hasOwn(ref, key)) ||
      ref.role !== expected.role || ref.eventId !== expected.eventId ||
      ref.resultId !== expected.resultId ||
      ref.capabilityRef !== expected.capabilityRef ||
      ref.resultSchemaRef !== expected.resultSchemaRef ||
      !/^[0-9a-f]{64}$/.test(ref.resultDigest || '')) {
    fail('P14_CANDIDATE_ASSEMBLY_RESULT_REF_INVALID',
      'Candidate assembly Result reference violates its closed typed contract.', {
        role: expected.role,
      });
  }
  return ref;
}

function createMovieRunCoordinator(options) {
  if (!options?.schemaManifest || !options.unitOfWork || !options.triageRegistry || !options.workRuntime ||
      !options.mediaProbe || typeof options.mediaProbe.probe !== 'function' ||
      typeof options.offerCandidate !== 'function' ||
      typeof options.resumeAcceptedHandoff !== 'function') {
    fail('P14_MOVIE_RUN_COORDINATOR_DEPENDENCIES',
      'Movie journey requires Procurement persistence, Triage, Work, Probe, and formal Handoff ports.');
  }
  const repository = definition(options.schemaManifest);
  const rule = activeTriageRule(options.triageRegistry);
  const candidatePublication = createCandidatePublicationStore(options);
  const resultStore = createSupportingResultStore(options);
  const injectFault = typeof options.faultInjector === 'function'
    ? options.faultInjector
    : () => {};

  function admitPhase(work, phaseBasisDigest, procurementRunId) {
    const admission = createWorkAdmission({
      schemaManifest: options.schemaManifest,
      unitOfWork: options.unitOfWork,
      eligibilityProvider: {
        check(request) {
          return Object.freeze({
            eligible: request.ownerDomain === 'procurement' &&
              request.processId === procurementRunId &&
              request.executionBasisDigest === phaseBasisDigest,
            basisDigest: phaseBasisDigest,
            reasonCode: 'P14_CANDIDATE_ASSEMBLY_PHASE_STALE',
          });
        },
      },
      limits: Object.freeze({
        globalOpenWorks: 1000,
        ownerOpenWorks: 500,
        openEvents: 100000,
      }),
    }).submit(work);
    if (admission.kind !== 'admitted') {
      fail('P14_CANDIDATE_ASSEMBLY_WORK_DEFERRED',
        'Candidate assembly phase Work cannot be admitted.');
    }
  }

  function phasePlan(value) {
    const work = workDefinition(
      value.basis,
      value.phase,
      value.phaseBasisDigest,
      value.resultSchemaRef,
    );
    const eventId = stableId('candidate-assembly-event-', {
      workId: work.workId,
      phase: value.phase,
      capabilityRef: value.capabilityRef,
    });
    const outputIdentity = resultIdentity(
      value.role,
      eventId,
      value.capabilityRef,
      value.resultSchemaRef,
    );
    const binding = value.binding(outputIdentity);
    assertBinding(binding, value.bindingKind, value.basis.assemblyBasisDigest);
    admitPhase(work, value.phaseBasisDigest, value.basis.procurementRunId);
    const step = capabilityStep({
      workId: work.workId,
      nodeId: value.phase,
      eventId,
      capabilityRef: value.capabilityRef,
      effectClass: value.effectClass,
      contractBase: value.contractBase,
      input: binding,
      basisDigest: value.phaseBasisDigest,
      outputIdentity,
      resourceKinds: value.resourceKinds,
    });
    const activated = options.workRuntime.activate({
      workId: work.workId,
      ownerDomain: 'procurement',
      basisDigest: value.phaseBasisDigest,
      plannerRef: 'procurement.candidate-assembly-phase-planner@1',
      catalogDigest: canonicalDigest({
        schema: 'procurement.candidate-assembly-phase-catalog@1',
        capabilityRef: value.capabilityRef,
      }),
      steps: Object.freeze([step]),
    });
    if (activated.snapshot.pages.length !== 1 ||
        canonicalDigest(activated.snapshot.pages[0]) !== canonicalDigest(binding)) {
      fail('P14_CANDIDATE_PLAN_BINDING_RECONSTRUCTION',
        'Durable phase Plan does not reconstruct its exact validated binding.');
    }
    assertBinding(
      activated.snapshot.pages[0],
      value.bindingKind,
      value.basis.assemblyBasisDigest,
    );
    return Object.freeze({ work, eventId, outputIdentity, binding, step });
  }

  async function runFormalPhase(value) {
    const planned = phasePlan(value);
    const event = options.workRuntime.beginEvent(planned.eventId);
    const stored = resultStore.recoverCommittedEventResult({
      eventId: planned.eventId,
      resultId: planned.outputIdentity.resultId,
      ownerDomain: 'procurement',
      capabilityRef: planned.outputIdentity.capabilityRef,
      resultSchemaRef: planned.outputIdentity.resultSchemaRef,
    });
    if (stored) {
      const ref = resultRef(
        planned.outputIdentity.role,
        planned.eventId,
        planned.outputIdentity.capabilityRef,
        planned.outputIdentity.resultSchemaRef,
        stored.result,
      );
      if (ref.resultDigest !== stored.resultDigest) {
        fail('P14_CANDIDATE_ASSEMBLY_RESULT_DIGEST',
          'Stored phase Result does not match its canonical digest.');
      }
      if (event.state !== 'succeeded') {
        options.workRuntime.completeEvent(planned.eventId, planned.outputIdentity.resultId);
      }
      options.workRuntime.complete(planned.work.workId);
      return Object.freeze({ result: stored.result, ref, replayed: true });
    }
    if (event.state === 'succeeded') {
      fail('P14_CANDIDATE_ASSEMBLY_RESULT_REF_MISMATCH',
        'Succeeded phase Event does not own its stable typed Result identity.');
    }
    if (value.role === 'media_probe') {
      injectFault('after_formal_probe_event_begin_before_result', Object.freeze({
        workId: planned.work.workId,
        eventId: planned.eventId,
        ordinal: value.ordinal,
      }));
    }
    const result = await value.execute();
    const ref = resultRef(
      planned.outputIdentity.role,
      planned.eventId,
      planned.outputIdentity.capabilityRef,
      planned.outputIdentity.resultSchemaRef,
      result,
    );
    resultStore.commit({
      resultId: planned.outputIdentity.resultId,
      eventId: planned.eventId,
      ownerDomain: 'procurement',
      capabilityRef: planned.outputIdentity.capabilityRef,
      resultSchemaRef: planned.outputIdentity.resultSchemaRef,
      result,
      evidenceSchemaRef: planned.outputIdentity.resultSchemaRef,
      evidence: result,
    });
    if (value.role === 'media_probe') {
      injectFault('after_formal_probe_result_before_event_success', Object.freeze({
        workId: planned.work.workId,
        eventId: planned.eventId,
        ordinal: value.ordinal,
        resultId: planned.outputIdentity.resultId,
      }));
    }
    options.workRuntime.completeEvent(planned.eventId, planned.outputIdentity.resultId);
    options.workRuntime.complete(planned.work.workId);
    return Object.freeze({ result, ref, replayed: false });
  }

  async function advance(procurementRunId) {
    const snapshot = runSnapshot(options, repository, procurementRunId);
    if (!snapshot || !['active', 'waiting'].includes(snapshot.run.state) || !snapshot.access ||
        snapshot.members.length < 1 || snapshot.members.length > 1024) {
      fail('P14_MOVIE_RUN_NOT_ACTIVE', 'Movie journey requires one exact active Procurement Run and Field Access.');
    }
    const terminalReplay = acceptedHandoffReplay(snapshot);
    if (terminalReplay) return Object.freeze({
      stage: terminalReplay.stage,
      replayed: true,
      procurementRunId: terminalReplay.procurementRunId,
      candidatePackage: terminalReplay.candidatePackage,
      handoff: await options.resumeAcceptedHandoff(terminalReplay.offer),
    });
    const openResume = openHandoffResume(snapshot);
    if (openResume) return Object.freeze({
      stage: 'handoff_a_accepted', replayed: true, procurementRunId,
      candidatePackage: openResume.candidatePackage,
      handoff: await options.offerCandidate(openResume.offer),
    });
    const layout = movieLayout(snapshot);
    if (layout.primaryContexts.length < 1) {
      return Object.freeze({
        stage: 'triage_not_ready',
        procurementRunId,
        reasonCode: 'primary_material_unresolved',
        unresolvedMaterials: layout.unresolved,
      });
    }
    const selected = selection(snapshot, layout.primaryContexts);
    const basis = assemblyBasis(snapshot, selected, layout, rule);
    const probeRecords = [];
    const probeRefs = [];

    for (const [ordinal, context] of layout.primaryContexts.entries()) {
      const handle = readHandle(context.row);
      const phaseBasisDigest = canonicalDigest({
        schema: 'procurement.candidate-probe-phase-basis@1',
        assemblyBasisDigest: basis.assemblyBasisDigest,
        ordinal,
        readHandleDigest: canonicalDigest(handle),
      });
      const phase = await runFormalPhase({
        basis,
        phase: 'media-probe-' + String(ordinal).padStart(4, '0'),
        role: 'media_probe',
        bindingKind: 'media_probe',
        phaseBasisDigest,
        capabilityRef: PROBE_CAPABILITY_REF,
        resultSchemaRef: RESULT_SCHEMAS.probe,
        contractBase: 'helix://contracts/capabilities/shared.material.media.probe/v1',
        effectClass: 'pure_observation',
        resourceKinds: ['disk_io'],
        ordinal,
        binding(outputIdentity) {
          return closedBinding({
            bindingKind: 'media_probe',
            assemblyBasisDigest: basis.assemblyBasisDigest,
            ordinal,
            readHandle: handle,
            outputIdentity,
          });
        },
        execute: () => options.mediaProbe.probe(handle),
      });
      probeRefs.push(phase.ref);
      probeRecords.push(Object.freeze({ row: context.row, probe: phase.result }));
    }

    const batch = triageBatch(selected, probeRecords);
    const playabilityPhaseBasisDigest = canonicalDigest({
      schema: 'procurement.candidate-playability-phase-basis@1',
      assemblyBasisDigest: basis.assemblyBasisDigest,
      batchDigest: batch.batchDigest,
      ruleAuthorityDigest: rule.authorityDigest,
      sourceResultRefs: probeRefs,
    });
    const playabilityPhase = await runFormalPhase({
      basis,
      phase: 'playability',
      role: 'playability',
      bindingKind: 'playability',
      phaseBasisDigest: playabilityPhaseBasisDigest,
      capabilityRef: PLAYABILITY_CAPABILITY_REF,
      resultSchemaRef: RESULT_SCHEMAS.playability,
      contractBase: 'helix://contracts/capabilities/procurement.triage.playability.inspect/v1',
      effectClass: 'pure_observation',
      resourceKinds: ['cpu'],
      binding(outputIdentity) {
        return closedBinding({
          bindingKind: 'playability',
          assemblyBasisDigest: basis.assemblyBasisDigest,
          runRef: Object.freeze({
            procurementRunId,
            runBasisDigest: snapshot.run.run_basis_digest,
            selectionDigest: selected.selectionDigest,
          }),
          ruleRef: Object.freeze({
            ruleRef: rule.ruleRef,
            revision: rule.revision,
            authorityDigest: rule.authorityDigest,
          }),
          sourceResultRefs: Object.freeze(probeRefs),
          outputIdentity,
        });
      },
      execute: async () => inspectPlayability(batch, rule, { observedAtMs: 0 }),
    });
    const playability = playabilityPhase.result;
    const playabilityRef = playabilityPhase.ref;

    const structureRequest = structureInput(
      selected, batch, playability, snapshot, layout);
    const structureSourceRefs = Object.freeze([...probeRefs, playabilityRef]);
    const structurePhaseBasisDigest = canonicalDigest({
      schema: 'procurement.candidate-structure-phase-basis@1',
      assemblyBasisDigest: basis.assemblyBasisDigest,
      inputDigest: structureRequest.inputDigest,
      sourceResultRefs: structureSourceRefs,
    });
    const structurePhase = await runFormalPhase({
      basis,
      phase: 'structure',
      role: 'structure',
      bindingKind: 'structure',
      phaseBasisDigest: structurePhaseBasisDigest,
      capabilityRef: STRUCTURE_CAPABILITY_REF,
      resultSchemaRef: RESULT_SCHEMAS.structure,
      contractBase: 'helix://contracts/capabilities/procurement.triage.structure.inspect/v1',
      effectClass: 'pure_observation',
      resourceKinds: ['cpu'],
      binding(outputIdentity) {
        return closedBinding({
          bindingKind: 'structure',
          assemblyBasisDigest: basis.assemblyBasisDigest,
          runRef: Object.freeze({
            procurementRunId,
            runBasisDigest: snapshot.run.run_basis_digest,
            selectionDigest: selected.selectionDigest,
            materialFieldContextDigest: structureRequest.materialFieldContext.contextDigest,
            layoutEvidenceSetDigest: canonicalDigest(layout.layoutEvidence),
          }),
          structureInputDigest: structureRequest.inputDigest,
          sourceResultRefs: structureSourceRefs,
          outputIdentity,
        });
      },
      execute: async () => inspectStructure(
        structureRequest, rule, { observedAtMs: 0 }),
    });
    const structure = structurePhase.result;
    const structureRef = structurePhase.ref;
    if (structure.resultKind !== 'resolved' || structure.units.length !== 1) {
      return Object.freeze({ stage: 'triage_not_ready', procurementRunId, playability, structure });
    }
    const unit = structure.units[0];
    const identityInput = Object.freeze({
      unit,
      inputDigest: structure.payloadDigest,
      procurementRunId,
      runBasisDigest: snapshot.run.run_basis_digest,
    });
    const identityPhaseBasisDigest = canonicalDigest({
      schema: 'procurement.candidate-identity-phase-basis@1',
      assemblyBasisDigest: basis.assemblyBasisDigest,
      sourceResultRef: structureRef,
    });
    const identityPhase = await runFormalPhase({
      basis,
      phase: 'identity-claim',
      role: 'identity_claim',
      bindingKind: 'identity_claim',
      phaseBasisDigest: identityPhaseBasisDigest,
      capabilityRef: IDENTITY_CAPABILITY_REF,
      resultSchemaRef: RESULT_SCHEMAS.identity,
      contractBase: 'helix://contracts/capabilities/procurement.triage.identity_claim.resolve/v1',
      effectClass: 'pure_observation',
      resourceKinds: ['cpu'],
      binding(outputIdentity) {
        return closedBinding({
          bindingKind: 'identity_claim',
          assemblyBasisDigest: basis.assemblyBasisDigest,
          sourceResultRefs: Object.freeze([structureRef]),
          outputIdentity,
        });
      },
      execute: async () => resolveIdentity(
        identityInput, rule, { producedAtMs: 0 }),
    });
    const identityClaim = identityPhase.result;
    const identityRef = identityPhase.ref;

    const manifestInput = {
      preallocatedManifestId: stableId('primary-input-manifest-', { procurementRunId, unitId: unit.unitId }),
      procurementRunId, runBasisDigest: snapshot.run.run_basis_digest,
      structureEvidencePayloadDigest: structure.payloadDigest, unit,
      selectedFieldMaterialSet: selected, inputDigest: structure.payloadDigest,
    };
    const manifestPhaseBasisDigest = canonicalDigest({
      schema: 'procurement.candidate-manifest-phase-basis@1',
      assemblyBasisDigest: basis.assemblyBasisDigest,
      sourceResultRef: structureRef,
      selectionDigest: selected.selectionDigest,
    });
    const manifestPhase = await runFormalPhase({
      basis,
      phase: 'primary-manifest',
      role: 'primary_manifest',
      bindingKind: 'primary_manifest',
      phaseBasisDigest: manifestPhaseBasisDigest,
      capabilityRef: MANIFEST_CAPABILITY_REF,
      resultSchemaRef: RESULT_SCHEMAS.manifest,
      contractBase: 'helix://contracts/capabilities/procurement.triage.primary_manifest.build/v1',
      effectClass: 'pure_observation',
      resourceKinds: ['cpu'],
      binding(outputIdentity) {
        return closedBinding({
          bindingKind: 'primary_manifest',
          assemblyBasisDigest: basis.assemblyBasisDigest,
          selectionDigest: selected.selectionDigest,
          sourceResultRefs: Object.freeze([structureRef]),
          outputIdentity,
        });
      },
      execute: async () => buildPrimaryManifestDraft(
        manifestInput, rule, { producedAtMs: 0 }),
    });
    const manifestDraft = manifestPhase.result;
    const manifestRef = manifestPhase.ref;

    const draft = draftFor(unit, structure, selected, snapshot, rule, identityClaim, manifestDraft);
    validateDraft(draft, selected.members);
    const publicationPhaseBasisDigest = canonicalDigest({
      schema: 'procurement.candidate-publication-phase-basis@1',
      assemblyBasisDigest: basis.assemblyBasisDigest,
      sourceResultRefs: [structureRef, identityRef, manifestRef],
      draftDigest: draft.draftDigest,
    });
    const publicationPlanned = phasePlan({
      basis,
      phase: 'candidate-publication',
      role: 'candidate_publication',
      bindingKind: 'candidate_publication',
      phaseBasisDigest: publicationPhaseBasisDigest,
      capabilityRef: CAPABILITY_REF,
      resultSchemaRef: 'helix://contracts/types/CandidatePackage/v1',
      contractBase: 'helix://contracts/capabilities/procurement.candidate.publish/v1',
      effectClass: 'domain_fact_commit',
      resourceKinds: ['disk_io'],
      binding(outputIdentity) {
        return closedBinding({
          bindingKind: 'candidate_publication',
          assemblyBasisDigest: basis.assemblyBasisDigest,
          runRef: Object.freeze({
            procurementRunId,
            runBasisDigest: snapshot.run.run_basis_digest,
            candidatePackageRevisionHead: Number(snapshot.run.candidate_package_revision_head),
          }),
          ruleRef: Object.freeze({
            ruleRef: rule.ruleRef,
            revision: rule.revision,
            authorityDigest: rule.authorityDigest,
          }),
          sourceResultRefs: Object.freeze([structureRef, identityRef, manifestRef]),
          candidateDraftDigest: draft.draftDigest,
          outputIdentity,
        });
      },
    });
    injectFault('after_triage_results_before_publication', Object.freeze({
      workId: publicationPlanned.work.workId,
      candidateDraftDigest: draft.draftDigest,
    }));

    const durableStructure = resultStore.readEventResult(structureRef.eventId);
    const durableIdentity = resultStore.readEventResult(identityRef.eventId);
    const durableManifest = resultStore.readEventResult(manifestRef.eventId);
    if (!durableStructure || !durableIdentity || !durableManifest ||
        durableStructure.resultDigest !== structureRef.resultDigest ||
        durableIdentity.resultDigest !== identityRef.resultDigest ||
        durableManifest.resultDigest !== manifestRef.resultDigest) {
      fail('P14_CANDIDATE_PUBLICATION_SOURCE_RESULT_MISSING',
        'Candidate Publication requires every exact durable Triage Result.');
    }
    const assembledDraft = draftFor(
      durableStructure.result.units[0],
      durableStructure.result,
      selected,
      snapshot,
      rule,
      durableIdentity.result,
      durableManifest.result,
    );
    if (assembledDraft.draftDigest !==
        publicationPlanned.binding.candidateDraftDigest) {
      fail('P14_CANDIDATE_PUBLICATION_ASSEMBLY_MISMATCH',
        'Durable Triage Results do not assemble the frozen Candidate Draft.');
    }
    validateDraft(assembledDraft, selected.members);
    const event = options.workRuntime.beginEvent(publicationPlanned.eventId);
    const request = Object.freeze({
      candidateDraft: assembledDraft,
      domainFactCommitHandle: Object.freeze({ schemaRef: 'helix://contracts/types/DomainFactCommitHandle/v1', schemaVersion: 1,
        handleId: stableId('movie-candidate-handle-', { draftId: assembledDraft.draftId }), ownerDomain: 'procurement',
        aggregateType: 'candidate_package', aggregateId: assembledDraft.candidatePackageId, factType: 'CandidateDraft',
        factSchemaRef: 'helix://contracts/domain-types/CandidateDraft/v1',
        expectedRevision: assembledDraft.expectedPackageRevision - 1,
        payloadDigest: canonicalDigest(assembledDraft), resultSchemaRef: 'helix://contracts/types/CandidatePackage/v1',
        commitIdempotencyKey: publicationPlanned.work.idempotencyKey,
        eventFenceDigest: publicationPlanned.step.fenceBasis.eventFenceDigest }),
      commitMarker: Object.freeze({
        commitMarker: stableId('movie-candidate-marker-', { draftId: assembledDraft.draftId }),
        commitDigest: canonicalDigest({
          schema: 'procurement.movie-candidate-publication-commit@1',
          draftDigest: assembledDraft.draftDigest,
        }),
      }),
      resultBinding: Object.freeze({
        resultId: publicationPlanned.outputIdentity.resultId,
        eventId: publicationPlanned.eventId,
        evidenceSchemaRef: durableStructure.result.schemaRef,
        evidence: Object.freeze({
          schemaRef: durableStructure.result.schemaRef,
          schemaVersion: 1,
          evidenceId: durableStructure.result.evidenceId,
          payloadDigest: durableStructure.result.payloadDigest,
        }),
      }),
    });
    const committed = candidatePublication.publish(request);
    if (event.state !== 'succeeded') {
      options.workRuntime.completeEvent(
        publicationPlanned.eventId, request.resultBinding.resultId);
    }
    options.workRuntime.complete(publicationPlanned.work.workId);
    const handoff = await options.offerCandidate(buildOffer(
      committed.typedResult,
      committed.acceptanceBasis,
    ).message);
    return Object.freeze({ stage: 'handoff_a_accepted', procurementRunId, candidatePackage: committed.typedResult,
      structure: durableStructure.result, handoff });
  }
  return Object.freeze({ advance });
}

module.exports = Object.freeze({
  MovieRunCoordinatorError,
  buildRunMaterialLayout: movieLayout,
  createMovieRunCoordinator,
});
