'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { createWorkAdmission } = require('../../../foundation/execution/work-admission');
const { createCandidatePublicationStore } = require('../persistence/candidate-publication-store');
const { activeTriageRule } = require('../model/procurement-run-contracts');
const {
  buildPrimaryManifestDraft,
  inspectPlayability,
  inspectStructure,
  resolveIdentity,
} = require('../model/triage-contracts');
const { buildOffer } = require('../model/candidate-publication-contracts');

const CAPABILITY_REF = 'procurement.candidate.publish@1';

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
        columns: ['procurement_run_id', 'field_id', 'access_revision', 'access_digest', 'run_basis_digest',
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
    contentProfileHint: 'mixed', memberContexts: Object.freeze(contexts),
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

function workDefinition(draft) {
  const workId = stableId('movie-candidate-publication-work-', { draftId: draft.draftId, digest: draft.draftDigest });
  return Object.freeze({
    schemaRef: 'helix://foundation/types/SupportingWorkDefinition/v1', schemaVersion: 1, workId,
    ownerDomain: 'procurement', processType: 'procurement_run', processId: draft.procurementRunId,
    workKind: 'candidate_publication', workObjectiveTypeRef: 'helix://procurement/work/CandidatePublication/v1',
    workObjectiveVersion: 1, executionBasisId: stableId('movie-candidate-publication-basis-', { draftId: draft.draftId }),
    executionBasisDigest: draft.draftDigest, dependencyRefs: Object.freeze([]), priorityClass: 'normal_foreground',
    priorityRevision: 1, capabilityCatalogScope: 'procurement', workspaceMaterialScope: Object.freeze([]),
    idempotencyKey: stableId('movie-candidate-publication-idempotency-', { draftId: draft.draftId }),
    concurrencyScope: draft.procurementRunId + '/candidate-publication',
    outputContractRef: 'helix://contracts/types/CandidatePackage/v1',
  });
}

function capabilityStep(draft, workId) {
  const eventId = stableId('movie-candidate-publication-event-', { workId, digest: draft.draftDigest });
  const input = Object.freeze({ candidateDraft: draft });
  const demand = Object.freeze({ resourceKinds: Object.freeze(['disk_io']) });
  return Object.freeze({
    nodeId: 'candidate-publication', eventId, capabilityRef: CAPABILITY_REF, effectClass: 'domain_fact_commit',
    inputSchemaRef: 'helix://contracts/capabilities/procurement.candidate.publish/v1/inputs', input,
    parametersSchemaRef: 'helix://contracts/capabilities/procurement.candidate.publish/v1/parameters', parameters: Object.freeze({}),
    fenceSchemaRef: 'helix://contracts/capabilities/procurement.candidate.publish/v1/fence',
    fenceBasis: Object.freeze({ basisDigest: draft.draftDigest, eventFenceDigest: canonicalDigest({
      schema: 'procurement.movie-candidate-publication-fence@1', workId, draftDigest: draft.draftDigest,
    }) }),
    resourceDemandSchemaRef: 'helix://contracts/capabilities/procurement.candidate.publish/v1/resource-demand',
    resourceDemand: Object.freeze({ ...demand, demandDigest: canonicalDigest(demand) }),
  });
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
    const probes = [];
    for (const context of layout.primaryContexts) {
      probes.push(Object.freeze({
        row: context.row,
        probe: await options.mediaProbe.probe(readHandle(context.row)),
      }));
    }
    const batch = triageBatch(selected, probes);
    const playability = inspectPlayability(batch, rule, { observedAtMs: 0 });
    const structureRequest = structureInput(selected, batch, playability, snapshot, layout);
    const structure = inspectStructure(structureRequest, rule, { observedAtMs: 0 });
    if (structure.resultKind !== 'resolved' || structure.units.length !== 1) {
      return Object.freeze({ stage: 'triage_not_ready', procurementRunId, playability, structure });
    }
    const unit = structure.units[0];
    const identityClaim = resolveIdentity(Object.freeze({ unit, inputDigest: structure.payloadDigest,
      procurementRunId, runBasisDigest: snapshot.run.run_basis_digest }), rule, { producedAtMs: 0 });
    const manifestDraft = buildPrimaryManifestDraft({
      preallocatedManifestId: stableId('primary-input-manifest-', { procurementRunId, unitId: unit.unitId }),
      procurementRunId, runBasisDigest: snapshot.run.run_basis_digest,
      structureEvidencePayloadDigest: structure.payloadDigest, unit,
      selectedFieldMaterialSet: selected, inputDigest: structure.payloadDigest,
    }, rule, { producedAtMs: 0 });
    const draft = draftFor(unit, structure, selected, snapshot, rule, identityClaim, manifestDraft);
    const work = workDefinition(draft);
    const admission = createWorkAdmission({
      schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork,
      eligibilityProvider: { check: (request) => Object.freeze({
        eligible: request.ownerDomain === 'procurement' && request.processId === procurementRunId &&
          request.executionBasisDigest === draft.draftDigest,
        basisDigest: draft.draftDigest, reasonCode: 'P14_MOVIE_CANDIDATE_BASIS_STALE',
      }) },
      limits: Object.freeze({ globalOpenWorks: 1000, ownerOpenWorks: 500, openEvents: 100000 }),
    }).submit(work);
    if (admission.kind !== 'admitted') fail('P14_MOVIE_CANDIDATE_WORK_DEFERRED', 'Candidate publication Work cannot be admitted.');
    const step = capabilityStep(draft, work.workId);
    options.workRuntime.activate({ workId: work.workId, ownerDomain: 'procurement', basisDigest: draft.draftDigest,
      plannerRef: 'procurement.movie-triage-planner@1', catalogDigest: canonicalDigest({ schema: 'procurement.movie-triage-catalog@1', capabilities: [CAPABILITY_REF] }),
      steps: Object.freeze([step]) });
    const event = options.workRuntime.beginEvent(step.eventId);
    const request = Object.freeze({
      candidateDraft: draft,
      domainFactCommitHandle: Object.freeze({ schemaRef: 'helix://contracts/types/DomainFactCommitHandle/v1', schemaVersion: 1,
        handleId: stableId('movie-candidate-handle-', { draftId: draft.draftId }), ownerDomain: 'procurement',
        aggregateType: 'candidate_package', aggregateId: draft.candidatePackageId, factType: 'CandidateDraft',
        factSchemaRef: 'helix://contracts/domain-types/CandidateDraft/v1', expectedRevision: draft.expectedPackageRevision - 1,
        payloadDigest: canonicalDigest(draft), resultSchemaRef: 'helix://contracts/types/CandidatePackage/v1',
        commitIdempotencyKey: work.idempotencyKey, eventFenceDigest: step.fenceBasis.eventFenceDigest }),
      commitMarker: Object.freeze({ commitMarker: stableId('movie-candidate-marker-', { draftId: draft.draftId }),
        commitDigest: canonicalDigest({ schema: 'procurement.movie-candidate-publication-commit@1', draftDigest: draft.draftDigest }) }),
      resultBinding: Object.freeze({ resultId: stableId('movie-candidate-result-', { draftId: draft.draftId }), eventId: step.eventId,
        evidenceSchemaRef: structure.schemaRef, evidence: Object.freeze({ schemaRef: structure.schemaRef, schemaVersion: 1,
          evidenceId: structure.evidenceId, payloadDigest: structure.payloadDigest }) }),
    });
    const committed = candidatePublication.publish(request);
    if (event.state !== 'succeeded') options.workRuntime.completeEvent(step.eventId, request.resultBinding.resultId);
    options.workRuntime.complete(work.workId);
    const handoff = await options.offerCandidate(buildOffer(
      committed.typedResult,
      committed.acceptanceBasis,
    ).message);
    return Object.freeze({ stage: 'handoff_a_accepted', procurementRunId, candidatePackage: committed.typedResult,
      structure, handoff });
  }
  return Object.freeze({ advance });
}

module.exports = Object.freeze({
  MovieRunCoordinatorError,
  buildRunMaterialLayout: movieLayout,
  createMovieRunCoordinator,
});
