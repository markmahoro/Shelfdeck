'use strict';

const {
  canonicalDigest,
  canonicalJson,
} = require('../../../contracts/canonical-json');
const {
  createInboxCoordinator,
} = require('../../../foundation/persistence/outbox-inbox');
const {
  createMaterialControlProjectionPort,
} = require('../../../foundation/persistence/material-control');
const {
  createShelfQueryStore,
} = require('../persistence/shelf-query-store');
const {
  createHandoffBAcceptanceStore,
} = require('../persistence/handoff-b-acceptance-store');
const {
  createOnDeckStore,
} = require('../persistence/on-deck-store');
const {
  emptyArcaMaterialEpisodeClaims,
  fromProductMember,
} = require('../model/material-episode-claims');
const {
  ACCEPTED_OUTPUT_DYNAMIC_RANGE_KINDS,
  observeMandatoryMedia,
} = require('../model/mandatory-media-acceptance');
const { finalGapDecision, GAP_CODES_BY_CHECK } = require('../model/acceptance-gap-decision');

class MovieOnDeckCoordinatorError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MovieOnDeckCoordinatorError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new MovieOnDeckCoordinatorError(code, message, details);
}

function stable(schema, value) {
  return canonicalDigest({ schema, ...value });
}

function exactOffer(message) {
  const keys = [
    'acceptanceSpecId', 'dedupKey', 'libraRunId', 'messageId',
    'messageKind', 'offerId', 'onDeckPackageId', 'packageDigest',
    'packageRevision', 'shelfId', 'subjectId',
  ].sort();
  if (!message || canonicalJson(Object.keys(message).sort()) !==
      canonicalJson(keys) ||
      message.messageKind !== 'libra.product-offer.available@1' ||
      message.messageId !== message.dedupKey ||
      !Number.isSafeInteger(message.packageRevision) ||
      message.packageRevision < 1 ||
      !/^[0-9a-f]{64}$/.test(message.packageDigest || '') ||
      message.messageId !== stable('libra.product-offer-message-id@1', {
        offerId: message.offerId,
        packageDigest: message.packageDigest,
      })) {
    fail('P14_HANDOFF_B_OFFER_INVALID',
      'Arca accepts only the exact official Handoff B Offer message.');
  }
  return Object.freeze({ ...message });
}

function acceptanceCheck(input) {
  const base = {
    schemaRef: 'helix://contracts/types/AcceptanceCheck/v1',
    schemaVersion: 1,
    verificationId: stable('arca.acceptance-check-id@1', {
      acceptanceAttemptId: input.acceptanceAttemptId,
      checkKind: input.checkKind,
      basisDigest: input.basisDigest,
    }),
    verificationKind: 'shelf_acceptance',
    basisDigest: input.basisDigest,
    result: input.passed ? 'passed' : 'failed',
    reasonCodes: input.passed ? [] : [input.reasonCode],
    evidenceRefs: input.evidenceRefs,
    verifiedAtMs: input.verifiedAtMs,
    acceptanceAttemptId: input.acceptanceAttemptId,
    checkKind: input.checkKind,
    standardRevision: input.standardRevision,
    packageDigest: input.packageDigest,
    requirementDigest: input.requirementDigest,
    evidenceStatus: input.evidenceStatus || 'complete',
    actualGapCodes: Object.freeze([...(input.actualGapCodes || [])]),
    actualGapSetDigest: canonicalDigest({
      schema: 'arca.acceptance-check-actual-gap-set@1',
      checkKind: input.checkKind,
      items: input.actualGapCodes || [],
    }),
    primaryMediaObservations: Object.freeze([
      ...(input.primaryMediaObservations || []),
    ]),
    primaryMediaObservationSetDigest:
      input.primaryMediaObservationSetDigest || canonicalDigest({
        schema: 'arca.mandatory-media-primary-observation-set@1',
        items: [],
      }),
    authorizedDefectManifestDigestOrNull:
      input.authorizedDefectManifest?.manifestDigest || null,
    authorizedGapComparison: input.authorizedDefectManifest
      ? 'pending_final_union'
      : 'not_applicable',
  };
  return Object.freeze(base);
}

function exactRequirementSnapshot(packageValue, shelf) {
  const value = packageValue.productionProvenance
    ?.acceptanceRequirementSnapshot;
  const body = value && Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'snapshotDigest'));
  const structureKind = packageValue.productStructureSnapshot
    ?.structureKind === 'season' ? 'season' : 'single';
  if (!value || value.snapshotDigest !== canonicalDigest(body) ||
      value.acceptanceSpecId !== packageValue.acceptanceSpecRef?.id ||
      value.acceptanceSpecRecordDigest !==
        packageValue.acceptanceSpecRef?.recordDigest ||
      value.targetShelfId !== packageValue.shelfId ||
      value.structureKind !== structureKind ||
      value.shelfStandardRevision !== shelf.currentStandardRevision ||
      value.shelfStandardDigest !== shelf.standard.digest) {
    fail('P14_HANDOFF_B_REQUIREMENT_STALE',
      'Package Acceptance Requirement Snapshot is invalid or stale.');
  }
  return value;
}

function metadataGaps(packageValue, requirement) {
  const metadata = (packageValue.productFactManifest?.items || [])
    .find((item) => item.factKind === 'product_metadata')?.factValue || {};
  const identity = packageValue.resolvedIdentitySnapshot?.factValue
    ?.resolvedProductIdentity ||
    packageValue.resolvedIdentitySnapshot?.factValue || {};
  const relations = packageValue.mediaCastSnapshot?.relations || [];
  const identities = identity.providerIdentities || [];
  const descriptive = new Map((metadata.descriptiveFacts?.entries || [])
    .map((item) => [item.key, item.value]));
  const missingField = requirement.requiredFieldCodes.some((code) => {
    if (code === 'actor') return relations.length === 0;
    if (code === 'internal_identity') {
      return !identities.some((item) => item.namespace === 'internal_identity');
    }
    if (code === 'jav_code') {
      return !identities.some((item) => item.namespace === 'jav_code');
    }
    if (code === 'season_number') {
      return !identities.some((item) =>
        item.namespace === 'tmdb_series' && item.seasonNumber != null);
    }
    if (code === 'episode_number') {
      return !(packageValue.productMaterialManifest?.members || [])
        .some((item) => item.episodeClaims?.length);
    }
    if (code === 'tmdb_movie_id' || code === 'tmdb_series_id') {
      return !identities.some((item) =>
        item.namespace === code.replace('_id', ''));
    }
    const value = descriptive.get(code);
    return value == null || value === '' ||
      (Array.isArray(value) && value.length === 0);
  });
  const artifacts = packageValue.artifactManifest?.items || [];
  const verifiedKinds = new Set(artifacts.map((item) => item.artifactKind));
  return Object.freeze([
    ...(missingField ? ['metadata_field_unmet'] : []),
    ...(requirement.requiredArtifactKinds.some((kind) =>
      !verifiedKinds.has(kind)) ? ['metadata_artifact_unmet'] : []),
    ...(requirement.requireRenderableSidecar && !verifiedKinds.has('nfo')
      ? ['sidecar_unrenderable'] : []),
    ...(requirement.requireDecodableImages &&
      requirement.requiredArtifactKinds
        .filter((kind) => kind === 'poster' || kind === 'fanart')
        .some((kind) => !verifiedKinds.has(kind))
      ? ['image_undecodable'] : []),
  ]);
}

function ordinaryDimensionGaps(packageValue, snapshot) {
  const identity = packageValue.resolvedIdentitySnapshot?.factValue
    ?.resolvedProductIdentity ||
    packageValue.resolvedIdentitySnapshot?.factValue || {};
  const providers = identity.providerIdentities || [];
  const identityGaps = [];
  if (!identity.identityDigest ||
      snapshot.requirements.identity.identityKind === 'tmdb_movie' &&
        !providers.some((item) => item.namespace === 'tmdb_movie') ||
      snapshot.requirements.identity.identityKind === 'tmdb_series_season' &&
        !providers.some((item) => item.namespace === 'tmdb_series')) {
    identityGaps.push('identity_unmet');
  }
  if (snapshot.requirements.identity.requireSeasonNumber &&
      !(identity.seasonNumber >= 0)) identityGaps.push('season_identity_unmet');
  const structure = packageValue.productStructureSnapshot;
  const manifest = packageValue.productMaterialManifest;
  const primaries = (manifest.members || [])
    .filter((item) => item.role === 'primary_payload');
  const structureGaps = [];
  if (structure?.structureKind !== snapshot.requirements.structure.structureKind ||
      manifest.scopeKind !== (snapshot.requirements.structure.structureKind ===
        'season' ? 'episode_delivery' : 'single') || !primaries.length) {
    structureGaps.push('structure_unmet');
  }
  if (snapshot.requirements.structure.requireOnePrimaryPerEpisode &&
      primaries.some((item) => !item.episodeClaims?.length)) {
    structureGaps.push('episode_coverage_unmet');
  }
  const max = snapshot.requirements.space.maxSizeBytes;
  const bytes = primaries.reduce((sum, item) =>
    sum + Number(item.sizeBytes || 0), 0);
  return Object.freeze({
    identity: Object.freeze(identityGaps),
    structure: Object.freeze(structureGaps),
    metadata: metadataGaps(packageValue, snapshot.requirements.metadata),
    space: Object.freeze(Number.isSafeInteger(max) && bytes > max
      ? ['max_size_exceeded'] : []),
  });
}

function mandatoryRequirement(packageValue, snapshot) {
  const media = snapshot.requirements.mandatoryMedia;
  const body = {
    schemaRef: 'helix://contracts/domain-types/MandatoryRequirement/v1',
    schemaVersion: 1,
    requirementId: packageValue.shelfId + ':mandatory',
    revision: snapshot.shelfStandardRevision,
    shelfId: packageValue.shelfId,
    shelfStandardRevision: snapshot.shelfStandardRevision,
    shelfStandardDigest: snapshot.shelfStandardDigest,
    contentProfile: snapshot.contentProfile,
    mediaForm: media.mediaForm,
    videoCodec: media.videoCodec,
    container: media.container,
    fileExtension: media.fileExtension,
    minimumRasterClass: media.minimumRasterClass,
    acceptedPrimaryAudioClasses: Object.freeze([
      ...media.acceptedPrimaryAudioClasses,
    ]),
    maxSizeBytes: snapshot.requirements.space.maxSizeBytes,
    forbidSystemUpscaleFor4k: media.forbidSystemUpscaleFor4k,
    acceptedOutputDynamicRangeKinds: ACCEPTED_OUTPUT_DYNAMIC_RANGE_KINDS,
    sdrOutputPixelFormat: 'yuv420p',
    sdrOutputColorProfile: Object.freeze({
      range: 'limited', primaries: 'bt709', transfer: 'bt709', matrix: 'bt709',
    }),
    forbidDolbyVisionMetadataOnSdr: true,
    decodeSamplePointsPercent: Object.freeze([5, 50, 95]),
    requireAllDecodeSamples: true,
  };
  return Object.freeze({ ...body, digest: canonicalDigest(body) });
}

function bindingFromProduct(member, contentProfile) {
  return Object.freeze({
    materialKey: member.materialKey,
    role: 'product:' + member.role,
    physicalIdentity: member.physicalIdentity,
    episodeClaims: fromProductMember(member, contentProfile),
    endpointId: member.location.endpointId,
    location: member.workspaceMaterialHandle
      ? 'workspace://' + member.workspaceMaterialHandle.workspaceId + '/' +
        member.workspaceMaterialHandle.relativePath
      : member.location.location,
  });
}

function bindingFromContext(member) {
  return Object.freeze({
    materialKey: member.materialKey,
    role: 'offload:' + member.contextRole,
    physicalIdentity: member.physicalIdentity,
    episodeClaims: emptyArcaMaterialEpisodeClaims(),
    endpointId: member.endpointId,
    location: member.location,
  });
}

function createMovieOnDeckCoordinator(options) {
  if (!options?.schemaManifest || !options.unitOfWork ||
      !options.productDeliveryPort ||
      typeof options.productDeliveryPort.readPackage !== 'function' ||
      !options.inventoryPort ||
      typeof options.inventoryPort.assess !== 'function' ||
      typeof options.inventoryPort.prepare !== 'function' ||
      typeof options.inventoryPort.materialize !== 'function') {
    fail('P14_MOVIE_ONDECK_DEPENDENCIES',
      'Movie On-deck requires formal Product Delivery and Arca Inventory ports.');
  }
  const shelves = createShelfQueryStore(options);
  const controls = createMaterialControlProjectionPort(options);
  const acceptance = createHandoffBAcceptanceStore(options);
  const onDeck = createOnDeckStore(options);
  const inbox = createInboxCoordinator(options);
  const now = options.now || Date.now;

  async function acceptProductOffer(inputMessage) {
    const offer = exactOffer(inputMessage);
    const delivery = options.productDeliveryPort.readPackage({
      queryContract: 'libra.product-delivery@1',
      readPurpose: 'historical',
      offerId: offer.offerId,
      onDeckPackageId: offer.onDeckPackageId,
      expectedPackageRevision: offer.packageRevision,
      expectedPackageDigest: offer.packageDigest,
    });
    if (!delivery || delivery.resultKind !== 'found') {
      fail('P14_HANDOFF_B_DELIVERY_INELIGIBLE',
        'Product Delivery is absent for Handoff B.', {
          reasonCode: delivery?.reasonCode || 'delivery_unavailable',
        });
    }
    const packageValue = delivery.onDeckProductPackage;
    if (packageValue.onDeckPackageId !== offer.onDeckPackageId ||
        packageValue.packageDigest !== offer.packageDigest ||
        packageValue.packageRevision !== offer.packageRevision ||
        packageValue.libraRunId !== offer.libraRunId ||
        packageValue.subjectId !== offer.subjectId ||
        packageValue.shelfId !== offer.shelfId ||
        packageValue.acceptanceSpecRef.id !== offer.acceptanceSpecId) {
      fail('P14_HANDOFF_B_DELIVERY_MISMATCH',
        'Product Delivery does not conserve the official Offer identity.');
    }
    const shelf = shelves.getShelf(offer.shelfId);
    if (!shelf || shelf.status !== 'active') {
      fail('P14_HANDOFF_B_SHELF_INACTIVE',
        'Handoff B target Shelf is unavailable or inactive.');
    }
    const attemptId = stable('arca.acceptance-attempt-id@1', {
      offerId: offer.offerId,
      onDeckPackageId: offer.onDeckPackageId,
      packageDigest: offer.packageDigest,
      standardRevision: shelf.currentStandardRevision,
      placementRevision: shelf.currentPlacementRevision,
    });
    const historicalResponsibility =
      acceptance.deriveAcceptedResponsibility({
        acceptanceAttemptId: attemptId,
        offerId: offer.offerId,
        onDeckPackageId: offer.onDeckPackageId,
        packageDigest: offer.packageDigest,
        shelfId: shelf.shelfId,
        standardRevision: shelf.currentStandardRevision,
        placementRevision: shelf.currentPlacementRevision,
        checks: [],
      });
    const committedHistory = onDeck.readCommittedByPackage({
      onDeckPackageId: offer.onDeckPackageId,
      packageDigest: offer.packageDigest,
      shelfId: shelf.shelfId,
      custodyId: historicalResponsibility.custodyId,
    });
    const replayCommittedInventory = Boolean(committedHistory);
    const at = now();
    const feasibility = options.inventoryPort.assess({
      onDeckRunId: stable('arca.on-deck-run-preview@1', {
        offerId: offer.offerId,
      }),
      custodyId: stable('arca.on-deck-custody-preview@1', {
        offerId: offer.offerId,
      }),
      shelf,
      onDeckProductPackage: packageValue,
      observedAtMs: at,
      replayCommitted: replayCommittedInventory,
    });
    const structureKind = packageValue.productStructureSnapshot?.structureKind;
    const contentProfile = structureKind === 'season' ? 'series' : 'movie';
    const snapshot = exactRequirementSnapshot(packageValue, shelf);
    const dimensionGaps = ordinaryDimensionGaps(packageValue, snapshot);
    const mandatory = mandatoryRequirement(packageValue, snapshot);
    const observed = await observeMandatoryMedia({
      packageValue,
      requirement: mandatory,
      observedAtMs: at,
      mediaProbe: options.mediaProbe,
      mediaEffectPort: options.mediaEffectPort,
      computeBoundedMaterialFingerprint:
        options.computeBoundedMaterialFingerprint,
    });
    const authorizedDefectManifest = packageValue.productionAttestation
      ?.authorizedDefectManifest || null;
    const checkInputs = [
      {
        checkKind: 'identity',
        actualGapCodes: dimensionGaps.identity,
        reasonCode: 'identity_requirement_unmet',
        evidenceRefs: [
          packageValue.resolvedIdentitySnapshot?.productFactId ||
          packageValue.resolvedIdentitySnapshot?.factId,
        ].filter(Boolean),
        evidence: packageValue.resolvedIdentitySnapshot,
      },
      {
        checkKind: 'structure',
        actualGapCodes: dimensionGaps.structure,
        reasonCode: 'structure_requirement_unmet',
        evidenceRefs: [packageValue.productStructureSnapshot
          ?.productStructureId].filter(Boolean),
        evidence: packageValue.productStructureSnapshot,
      },
      {
        checkKind: 'metadata',
        actualGapCodes: dimensionGaps.metadata,
        reasonCode: 'metadata_requirement_unmet',
        evidenceRefs: [packageValue.productFactManifest.manifestId],
        evidence: packageValue.productFactManifest,
      },
      {
        checkKind: 'mandatory_media',
        actualGapCodes: observed.actualGapCodes,
        reasonCode: observed.evidenceStatus === 'stale_basis'
          ? 'stale_decision_basis' : 'mandatory_requirement_unmet',
        evidenceRefs: [packageValue.productionAttestation?.attestationId]
          .filter(Boolean),
        evidence: packageValue.productionAttestation,
      },
      {
        checkKind: 'space',
        actualGapCodes: dimensionGaps.space,
        reasonCode: 'space_requirement_unmet',
        evidenceRefs: [feasibility.evidenceId],
        evidence: feasibility,
      },
    ];
    const checks = checkInputs.map((item) => {
      const gaps = item.actualGapCodes || [];
      const dimensionCodes = GAP_CODES_BY_CHECK[item.checkKind];
      const passed = authorizedDefectManifest
        ? canonicalJson(gaps) === canonicalJson(dimensionCodes.filter((code) =>
          authorizedDefectManifest.waivedRequirementCodes.includes(code)))
        : gaps.length === 0;
      return acceptanceCheck({
      acceptanceAttemptId: attemptId,
      checkKind: item.checkKind,
      standardRevision: shelf.currentStandardRevision,
      packageDigest: packageValue.packageDigest,
      verifiedAtMs: at,
      passed: observed.evidenceStatus === 'stale_basis' &&
        item.checkKind === 'mandatory_media' ? false : passed,
      reasonCode: item.reasonCode,
      evidenceRefs: item.evidenceRefs,
      basisDigest: canonicalDigest({
        schema: 'arca.acceptance-check-basis@1',
        acceptanceAttemptId: attemptId,
        checkKind: item.checkKind,
        standardRevision: shelf.currentStandardRevision,
        placementRevision: shelf.currentPlacementRevision,
        packageDigest: packageValue.packageDigest,
        evidence: item.evidence,
      }),
      requirementDigest: item.checkKind === 'mandatory_media'
        ? mandatory.digest
        : canonicalDigest(snapshot.requirements[item.checkKind === 'mandatory_media'
          ? 'mandatoryMedia' : item.checkKind]),
      evidenceStatus: item.checkKind === 'mandatory_media'
        ? observed.evidenceStatus : 'complete',
      actualGapCodes: gaps,
      primaryMediaObservations: item.checkKind === 'mandatory_media'
        ? observed.primaryMediaObservations : [],
      primaryMediaObservationSetDigest: item.checkKind === 'mandatory_media'
        ? observed.primaryMediaObservationSetDigest : undefined,
      authorizedDefectManifest,
    });});
    const gapDecision = finalGapDecision({
      acceptanceChecks: checks,
      acceptanceAttemptId: attemptId,
      packageDigest: packageValue.packageDigest,
      standardRevision: shelf.currentStandardRevision,
      authorizedDefectManifest,
    });
    if (checks.some((item) => item.result !== 'passed') ||
        feasibility.outcome !== 'passed' ||
        !['exact_match', 'not_applicable']
          .includes(gapDecision.authorizedGapComparison)) {
      fail('P14_HANDOFF_B_ACCEPTANCE_REJECTED',
        'Product Package does not satisfy the current Shelf acceptance basis.',
        {
          reasons: checks.filter((item) => item.result !== 'passed')
            .flatMap((item) => item.reasonCodes),
        });
    }
    const persistedChecks = [
      ...checks.map((item) => Object.freeze({
        kind: item.checkKind,
        outcome: item.result,
        evidenceDigest: canonicalDigest(item),
      })),
      Object.freeze({
        kind: 'inventory_feasibility',
        outcome: feasibility.outcome,
        evidenceDigest: feasibility.payloadDigest,
      }),
    ].sort((left, right) =>
      Buffer.compare(Buffer.from(left.kind), Buffer.from(right.kind)));
    const assessment = acceptance.readAssessment(attemptId) ||
      acceptance.recordAssessment({
        acceptanceAttemptId: attemptId,
        offerId: offer.offerId,
        onDeckPackageId: offer.onDeckPackageId,
        packageDigest: offer.packageDigest,
        shelfId: offer.shelfId,
        standardRevision: shelf.currentStandardRevision,
        placementRevision: shelf.currentPlacementRevision,
        checks: persistedChecks,
      });
    const productMembers =
      packageValue.productMaterialManifest.members;
    const offloadMembers =
      packageValue.offloadContextManifest.members;
    const byKey = new Map();
    for (const member of [...productMembers, ...offloadMembers]) {
      if (!byKey.has(member.materialKey)) byKey.set(member.materialKey, member);
    }
    const keys = [...byKey.keys()].sort((left, right) =>
      Buffer.compare(Buffer.from(left), Buffer.from(right)));
    const responsibility =
      acceptance.deriveAcceptedResponsibility(assessment);
    const onDeckRunId = responsibility.onDeckRunId;
    const finalInventoryDecision = options.inventoryPort.prepare({
      onDeckRunId,
      custodyId: responsibility.custodyId,
      shelf,
      onDeckProductPackage: packageValue,
      observedAtMs: at,
      replayCommitted: replayCommittedInventory,
    });
    let accepted = acceptance.readAccepted({
      acceptanceAttemptId: attemptId,
      offerMessage: offer,
      libraRunId: offer.libraRunId,
      onDeckRunId,
      finalInventoryDecision,
    });
    if (!accepted) {
      const acceptanceFence = options.productDeliveryPort.readPackage({
        queryContract: 'libra.product-delivery@1',
        readPurpose: 'acceptance_fence',
        offerId: offer.offerId,
        onDeckPackageId: offer.onDeckPackageId,
        expectedPackageRevision: offer.packageRevision,
        expectedPackageDigest: offer.packageDigest,
      });
      if (!acceptanceFence ||
          acceptanceFence.resultKind !== 'found' ||
          acceptanceFence.deliveryFence?.eligibility !== 'eligible') {
        fail('P14_HANDOFF_B_DELIVERY_INELIGIBLE',
          'Product Delivery is no longer eligible for first Handoff B acceptance.', {
            reasonCode:
              acceptanceFence?.deliveryFence?.reasonCode ||
              acceptanceFence?.reasonCode || 'delivery_unavailable',
          });
      }
      const projections = controls.getMaterialControlProjections(keys);
      for (const projection of projections) {
        const member = byKey.get(projection.materialKey);
        const expectedRevision = member.committedControlRevision ??
          member.admittedControlRevision;
        const expectedDigest = member.committedControlProjectionDigest ??
          member.admittedControlProjectionDigest;
        if (projection.resultKind !== 'available' ||
            projection.controlState !== 'controlled' ||
            projection.ownerDomain !== 'libra' ||
            projection.controlRevision !== expectedRevision ||
            projection.projectionDigest !== expectedDigest) {
          fail('P14_HANDOFF_B_CONTROL_FENCE',
            'Product Delivery Control no longer matches the immutable Package.', {
              materialKey: projection.materialKey,
            });
        }
      }
      accepted = acceptance.accept({
        assessment,
        offerMessage: offer,
        libraRunId: offer.libraRunId,
        shelf,
        package: packageValue,
        onDeckRunId,
        finalInventoryDecision,
        targetLocation: feasibility.targetLocation,
        gapDecision,
        acceptanceChecks: gapDecision.acceptanceChecks,
        bindings: [
          ...productMembers.map((member) =>
            bindingFromProduct(member, contentProfile)),
          ...offloadMembers.map(bindingFromContext),
        ].sort((left, right) =>
          Buffer.compare(Buffer.from(left.materialKey),
            Buffer.from(right.materialKey)) ||
          Buffer.compare(Buffer.from(left.role), Buffer.from(right.role))),
        controlTransfers: projections.map((projection) => Object.freeze({
          materialKey: projection.materialKey,
          expectedRevision: projection.controlRevision,
          expectedProjectionDigest: projection.projectionDigest,
          fromScope: Object.freeze({
            ownerDomain: projection.ownerDomain,
            scopeType: projection.ownerScopeType,
            scopeId: projection.ownerScopeId,
          }),
        })),
      });
    }
    const consumed = inbox.consume({
      message: Object.freeze({
        messageId: offer.messageId,
        dedupKey: offer.dedupKey,
        consumerDomain: 'arca',
      }),
      resultDigest: accepted.receipt.receiptDigest,
      domainParticipant: acceptance.offerDeliveryParticipant({
        acceptanceDecisionId:
          accepted.decision.acceptanceDecisionId,
        offerId: offer.offerId,
        receiptDigest: accepted.receipt.receiptDigest,
      }),
    });
    const acknowledgement = inbox.acknowledge({
      messageId: offer.messageId,
      consumerDomain: 'arca',
    });
    if (typeof options.afterHandoffBAccepted === 'function') {
      options.afterHandoffBAccepted(Object.freeze({
        offerId: offer.offerId,
        acceptanceDecisionId: accepted.decision.acceptanceDecisionId,
        custodyId: accepted.custody.custodyId,
      }));
    }
    const prepared = onDeck.verifyAcceptedResponsibility({
      onDeckRunId,
      custodyId: accepted.custody.custodyId,
      shelf,
      package: packageValue,
      finalInventoryDecision,
      targetLocation: feasibility.targetLocation,
    });
    onDeck.setOffloading(onDeckRunId,
      finalInventoryDecision.decisionDigest);
    const staged = options.inventoryPort.materialize({
      onDeckRunId,
      custodyId: accepted.custody.custodyId,
      shelf,
      onDeckProductPackage: packageValue,
      finalInventoryDecision,
      observedAtMs: at,
      replayCommitted: replayCommittedInventory,
    });
    const stagedBasis = {
      schema: 'arca.staged-inventory-verification-basis@1',
      stagedInventoryManifestDigest: staged.manifest.manifestDigest,
      finalInventoryDecisionDigest: finalInventoryDecision.decisionDigest,
      members: staged.members.map((item) => ({
        sourceMaterialKey: item.sourceMaterialKey,
        materialKey: item.materialKey,
        episodeClaims: item.episodeClaims,
        outputDigest: item.outputDigest,
      })),
    };
    const stagedVerificationBase = {
      schemaRef:
        'helix://contracts/types/StagedInventoryVerification/v1',
      schemaVersion: 1,
      verificationId: stable('arca.staged-inventory-verification-id@1', {
        onDeckRunId,
        basisDigest: canonicalDigest(stagedBasis),
      }),
      verificationKind: 'staged_inventory',
      basisDigest: canonicalDigest(stagedBasis),
      result: 'passed',
      reasonCodes: [],
      evidenceRefs: staged.members.map((item) => item.effectId),
      verifiedAtMs: at,
      stagedInventoryManifestDigest: staged.manifest.manifestDigest,
      finalInventoryDecisionDigest: finalInventoryDecision.decisionDigest,
    };
    const stagedVerification = Object.freeze(stagedVerificationBase);
    const finalRealityDigest = canonicalDigest({
      schema: 'arca.final-inventory-reality@1',
      onDeckRunId,
      shelfId: shelf.shelfId,
      standardRevision: shelf.currentStandardRevision,
      placementRevision: shelf.currentPlacementRevision,
      stagedInventoryManifestDigest: staged.manifest.manifestDigest,
      members: staged.members,
    });
    const fulfillmentBasis = canonicalDigest({
      schema: 'arca.fulfillment-verification-basis@1',
      finalInventoryDecisionDigest: finalInventoryDecision.decisionDigest,
      stagedVerification: stagedVerification,
      shelfStandardRevision: shelf.currentStandardRevision,
      finalRealityDigest,
    });
    const fulfillmentBase = {
      schemaRef: 'helix://contracts/types/FulfillmentVerification/v1',
      schemaVersion: 1,
      verificationId: stable('arca.fulfillment-verification-id@1', {
        onDeckRunId,
        fulfillmentBasis,
      }),
      verificationKind: 'on_deck_fulfillment',
      basisDigest: fulfillmentBasis,
      result: 'passed',
      reasonCodes: [],
      evidenceRefs: [
        stagedVerification.verificationId,
        finalInventoryDecision.objectId,
      ],
      verifiedAtMs: at,
      finalInventoryDecisionDigest: finalInventoryDecision.decisionDigest,
      shelfStandardRevision: shelf.currentStandardRevision,
      finalRealityDigest,
    };
    const fulfillmentVerification =
      Object.freeze(fulfillmentBase);
    const fulfillmentVerificationDigest =
      canonicalDigest(fulfillmentVerification);
    let committed = onDeck.readCommitted({
      onDeckRunId,
      custodyId: accepted.custody.custodyId,
      finalInventoryDecisionDigest: finalInventoryDecision.decisionDigest,
      onDeckPackageId: packageValue.onDeckPackageId,
      packageDigest: packageValue.packageDigest,
      shelfId: shelf.shelfId,
    });
    if (!committed) {
      const custodyControls = controls.getMaterialControlProjections(keys);
      const targetKeys = staged.members.map((item) => item.materialKey)
        .sort((left, right) =>
          Buffer.compare(Buffer.from(left), Buffer.from(right)));
      const targetControls =
        controls.getMaterialControlProjections(targetKeys);
      committed = onDeck.commit({
        onDeckRunId,
        custodyId: accepted.custody.custodyId,
        shelf,
        package: packageValue,
        finalInventoryDecision,
        staged,
        stagedVerification,
        fulfillmentVerification,
        fulfillmentVerificationDigest,
        custodyControls,
        targetControls,
      });
    }
    if (typeof options.afterOnDeckCommit === 'function') {
      options.afterOnDeckCommit(Object.freeze({
        onDeckRunId,
        shelfEntryId:
          committed.result.onDeckCommitReceipt.shelfEntryId,
      }));
    }
    onDeck.finalize(onDeckRunId,
      finalInventoryDecision.decisionDigest);
    return Object.freeze({
      stage: 'movie_on_deck_committed',
      replayed: accepted.replayed && prepared.replayed &&
        committed.replayed,
      offerId: offer.offerId,
      onDeckPackageId: offer.onDeckPackageId,
      packageDigest: offer.packageDigest,
      handoffB: Object.freeze({
        replayed: accepted.replayed,
        acceptanceDecisionId:
          accepted.decision.acceptanceDecisionId,
        custodyId: accepted.custody.custodyId,
        receipt: accepted.receipt,
        acceptedMessage: accepted.acceptedMessage,
        offerDelivery: Object.freeze({
          replayed: consumed.replayed,
          acknowledgement,
        }),
      }),
      onDeck: Object.freeze({
        onDeckRunId,
        finalInventoryDecision,
        stagedInventoryManifest: staged.manifest,
        stagedVerification,
        fulfillmentVerification,
        result: committed.result,
      }),
    });
  }

  return Object.freeze({ acceptProductOffer });
}

module.exports = Object.freeze({
  MovieOnDeckCoordinatorError,
  createMovieOnDeckCoordinator,
});
