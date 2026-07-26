'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createWorkAdmission } = require('../../../foundation/execution/work-admission');
const {
  createCanonicalTransactionRegistry,
  createDomainCommitCoordinator,
  createDomainCommitRegistry,
} = require('../../../foundation/persistence/domain-commit-registry');
const { createSupportingResultStore } =
  require('../../../foundation/persistence/supporting-result-store');
const { projectMaterialControlRow } =
  require('../../../foundation/persistence/material-control');
const domainFactTransaction =
  require('../../../contracts/transaction-contracts/helix.transaction.domain-fact-commit/v1/contract.json');
const {
  buildMediaRequirement,
  buildProductMediaCandidateInput,
  buildProductMediaVerification,
  buildProductOutputSelectionInput,
  selectProductOutput,
} = require('../model/media-production-contracts');
const {
  buildArtifactManifestVerification,
  buildMediaCastDraft,
  buildMetadataFetchIntent,
  buildMetadataObservationBasis,
  buildProductFactHandle,
  buildProductMetadataDraft,
  buildResolvedProductIdentity,
  metadataSourceRef,
} = require('../model/product-fact-contracts');
const {
  buildProductConformanceFactSnapshot,
  buildProductConformanceInputSnapshot,
  evaluateProductConformance,
} = require('../model/product-conformance');
const {
  absentReferenceDigest,
  buildReferenceDecision,
  episodeScopeDigest,
} = require('../model/workspace-material-reference-contracts');
const {
  buildSpaceAdmissionRequest,
  buildWorkspaceAdmissionDecision,
  requiredFreeBytes,
  workspaceId,
} = require('../model/workspace-admission-contracts');
const {
  createDeliverablePromotionStore,
} = require('../persistence/deliverable-promotion-store');
const {
  createMovieProductionReader,
} = require('../persistence/movie-production-reader');
const {
  createProductDeliveryReader,
} = require('../persistence/product-delivery-reader');
const {
  createProductFactRegistrations,
} = require('../persistence/product-fact-store');
const {
  createWorkspaceAdmissionStore,
} = require('../persistence/workspace-admission-store');
const {
  createWorkspaceMaterialReferenceStore,
} = require('../persistence/workspace-material-reference-store');
const {
  onDeckProductPackageDigest,
} = require('../model/delivery-lifecycle-contracts');

const RESULT_SCHEMA = 'helix://contracts/types/OnDeckProductPackageCommitReceipt/v1';
const METADATA_SCHEMA = 'helix://contracts/types/MetadataObservation/v1';
const ARTIFACT_VERIFICATION_SCHEMA =
  'helix://contracts/types/ArtifactManifestVerification/v1';

class MovieProductionCoordinatorError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MovieProductionCoordinatorError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new MovieProductionCoordinatorError(code, message, details);
}

function stable(prefix, value) {
  return prefix + canonicalDigest(value);
}

function productOfferMessage(value) {
  const messageId = canonicalDigest({
    schema: 'libra.product-offer-message-id@1',
    offerId: value.offerId,
    packageDigest: value.packageDigest,
  });
  return Object.freeze({
    messageKind: 'libra.product-offer.available@1',
    messageId,
    offerId: value.offerId,
    onDeckPackageId: value.onDeckPackageId,
    packageRevision: value.packageRevision,
    packageDigest: value.packageDigest,
    libraRunId: value.libraRunId,
    subjectId: value.subjectId,
    shelfId: value.shelfId,
    acceptanceSpecId: value.acceptanceSpecId,
    dedupKey: messageId,
  });
}

function episodeClaimSetDigest(claims) {
  return canonicalDigest({
    schema: 'libra.production-material-episode-claims@1',
    items: claims,
  });
}

function complete(value, field) {
  const result = { ...value };
  result[field] = canonicalDigest(result);
  return Object.freeze(result);
}

function xml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function renderNfo(entries) {
  const values = new Map(entries.map((item) => [item.key, item.value]));
  const tags = [
    ['title', 'title'],
    ['tmdb_movie_id', 'tmdbid'],
    ['year_or_release_date', 'year'],
    ['release_date', 'releasedate'],
    ['plot', 'plot'],
    ['genre', 'genre'],
    ['director', 'director'],
  ];
  const lines = ['<movie>'];
  for (const [key, tag] of tags) {
    if (values.has(key)) lines.push('  <' + tag + '>' + xml(values.get(key)) + '</' + tag + '>');
  }
  if (values.has('actor')) {
    lines.push('  <actor><name>' + xml(values.get('actor')) + '</name></actor>');
  }
  lines.push('</movie>');
  return Buffer.from(lines.join('\n') + '\n', 'utf8');
}

function mediaProbeEvidence(raw, handle, observedAtMs) {
  const videoStreams = [...(raw.videoStreams || [])].map((item) => {
    const codedWidth = item.codedWidth || item.width || 0;
    const codedHeight = item.codedHeight || item.height || 0;
    const displayWidth = item.displayWidth || codedWidth;
    const displayHeight = item.displayHeight || codedHeight;
    return Object.freeze({
      streamIndex: item.streamIndex,
      dispositionDefault: item.dispositionDefault === true,
      codec: item.codec,
      codedWidth,
      codedHeight,
      sampleAspectRatio: item.sampleAspectRatio || '1:1',
      rotation: item.rotation || 0,
      displayWidth,
      displayHeight,
      longEdge: Math.max(displayWidth, displayHeight),
      shortEdge: Math.min(displayWidth, displayHeight),
    });
  }).sort((left, right) => left.streamIndex - right.streamIndex);
  const audioStreams = [...(raw.audioStreams || [])].map((item) => Object.freeze({
    streamIndex: item.streamIndex,
    dispositionDefault: item.dispositionDefault === true,
    codec: item.codec,
    profile: item.profile || null,
    channels: item.channels || 0,
    channelLayout: item.channelLayout || null,
    formatTags: Object.freeze([...(item.formatTags || [])]),
    normalizedAudioClass: item.normalizedAudioClass || 'other',
  })).sort((left, right) => left.streamIndex - right.streamIndex);
  const subtitleStreams = [...(raw.subtitleStreams || [])].map((item) =>
    Object.freeze({ streamIndex:item.streamIndex, codec:item.codec }))
    .sort((left, right) => left.streamIndex - right.streamIndex);
  const basis = {
    schemaRef: 'helix://contracts/types/MediaProbeEvidence/v1',
    schemaVersion: 1,
    evidenceId: stable('movie-media-probe-', {
      handleId: handle.handleId,
      sourceHandleDigest: canonicalDigest(handle),
    }),
    evidenceKind: 'media_probe',
    producerRef: 'shared.material.media.probe@1',
    basisDigest: canonicalDigest({
      schema: 'libra.movie-media-probe-basis@1',
      sourceHandleDigest: canonicalDigest(handle),
    }),
    payloadDigest: '',
    observedAtMs,
    sourceHandleDigest: canonicalDigest(handle),
    resultKind: raw.resultKind,
    sizeBytes: handle.expectedSizeBytes,
    videoStreams: Object.freeze(videoStreams),
    audioStreams: Object.freeze(audioStreams),
    subtitleStreams: Object.freeze(subtitleStreams),
  };
  if (raw.resultKind === 'probed') {
    basis.container = raw.container || 'matroska';
    basis.durationMs = raw.durationMs;
    basis.discTopology = raw.discTopology || null;
  } else {
    basis.reasonCode = 'probe_not_media';
  }
  basis.payloadDigest = canonicalDigest(Object.fromEntries(
    Object.entries(basis).filter(([key]) => key !== 'payloadDigest'),
  ));
  return Object.freeze(basis);
}

function providerIdentity(value) {
  const identity = {
    provider: value.provider,
    namespace: value.namespace,
    providerKey: value.providerKey,
    seasonNumber: value.seasonNumber ?? null,
  };
  identity.identityAnchorDigest = canonicalDigest(identity);
  return Object.freeze(identity);
}

function metadataObservation(intent, values, observedAtMs) {
  const entries = [...values.entries]
    .sort((left, right) => Buffer.compare(Buffer.from(left.key), Buffer.from(right.key)));
  const descriptiveFacts = {
    schemaRef: 'helix://contracts/records/descriptive-facts/v1',
    schemaVersion: 1,
    recordKind: 'descriptive-facts',
    recordDigest: '',
    entries,
  };
  descriptiveFacts.recordDigest = canonicalDigest(Object.fromEntries(
    Object.entries(descriptiveFacts).filter(([key]) => key !== 'recordDigest'),
  ));
  const identities = [...(values.providerIdentities || [])].sort((left, right) =>
    Buffer.compare(Buffer.from(left.identityAnchorDigest), Buffer.from(right.identityAnchorDigest)));
  const providerIdentitySet = {
    schemaRef: 'helix://contracts/records/provider-identity-set/v1',
    schemaVersion: 1,
    recordKind: 'provider-identity-set',
    recordDigest: '',
    entries: identities,
  };
  providerIdentitySet.recordDigest = canonicalDigest(Object.fromEntries(
    Object.entries(providerIdentitySet).filter(([key]) => key !== 'recordDigest'),
  ));
  const result = {
    schemaRef: METADATA_SCHEMA,
    schemaVersion: 1,
    evidenceId: stable('movie-metadata-observation-', {
      intentDigest: intent.intentDigest,
      descriptiveFactsDigest: descriptiveFacts.recordDigest,
      providerIdentitySetDigest: providerIdentitySet.recordDigest,
    }),
    evidenceKind: 'metadata_observation',
    producerRef: 'libra.product_metadata.fetch@1',
    basisDigest: intent.intentDigest,
    payloadDigest: '',
    observedAtMs,
    fetchIntentDigest: intent.intentDigest,
    sourceKind: intent.sourceKind,
    sourceRef: metadataSourceRef(intent),
    sourcePriority: intent.sourcePriority,
    identityDigest: intent.resolvedIdentityDigest,
    contentProfile: intent.contentProfile,
    descriptiveFacts: Object.freeze(descriptiveFacts),
    providerIdentitySet: Object.freeze(providerIdentitySet),
    peopleHints: Object.freeze([...(values.peopleHints || [])]),
    artifactHints: Object.freeze([...(values.artifactHints || [])]),
  };
  result.payloadDigest = canonicalDigest(Object.fromEntries(
    Object.entries(result).filter(([key]) => key !== 'payloadDigest'),
  ));
  return Object.freeze(result);
}

function workDefinition(run, value) {
  return Object.freeze({
    schemaRef: 'helix://foundation/types/SupportingWorkDefinition/v1',
    schemaVersion: 1,
    workId: value.workId,
    ownerDomain: 'libra',
    processType: 'libra_run',
    processId: run.libraRunId,
    workKind: value.workKind,
    workObjectiveTypeRef: value.objectiveRef,
    workObjectiveVersion: 1,
    executionBasisId: stable('movie-production-work-basis-', {
      workId: value.workId,
    }),
    executionBasisDigest: value.basisDigest,
    dependencyRefs: Object.freeze([]),
    priorityClass: 'normal_foreground',
    priorityRevision: 1,
    capabilityCatalogScope: 'libra',
    workspaceMaterialScope: Object.freeze([]),
    idempotencyKey: stable('movie-production-work-key-', {
      workId: value.workId,
      basisDigest: value.basisDigest,
    }),
    concurrencyScope: run.libraRunId + '/' + value.workKind + '/' + value.workId,
    outputContractRef: value.resultSchemaRef,
  });
}

function capabilityStep(value) {
  const demand = Object.freeze({ resourceKinds:Object.freeze(value.resourceKinds || ['disk_io']) });
  return Object.freeze({
    nodeId: value.nodeId,
    eventId: value.eventId,
    capabilityRef: value.capabilityRef,
    effectClass: value.effectClass,
    inputSchemaRef: value.inputSchemaRef,
    input: value.input,
    parametersSchemaRef: value.parametersSchemaRef,
    parameters: Object.freeze({}),
    fenceSchemaRef: value.fenceSchemaRef,
    fenceBasis: Object.freeze({
      basisDigest: value.basisDigest,
      eventFenceDigest: value.eventFenceDigest,
    }),
    resourceDemandSchemaRef: value.resourceDemandSchemaRef,
    resourceDemand: Object.freeze({
      ...demand,
      demandDigest: canonicalDigest(demand),
    }),
  });
}

function artifactRequirement(kind) {
  const mediaType = kind === 'nfo' ? 'application/xml' : 'image/jpeg';
  const value = {
    requirementId: '',
    revision: 1,
    schemaRef: kind === 'nfo'
      ? 'shelfdeck.product-artifact.nfo-renderable@1'
      : 'shelfdeck.product-artifact.image-decodable@1',
    artifactKind: kind,
    requirementPayload: Object.freeze({ mediaType }),
    requirementDigest: '',
  };
  value.requirementDigest = canonicalDigest({
    schema: 'shared.artifact-requirement@1',
    revision: value.revision,
    schemaRef: value.schemaRef,
    artifactKind: value.artifactKind,
    requirementPayload: value.requirementPayload,
  });
  value.requirementId = canonicalDigest({
    schema: 'shared.artifact-requirement-id@1',
    requirementDigest: value.requirementDigest,
  });
  return Object.freeze(value);
}

function artifactVerificationSnapshot(runId, role, material, artifact, requirement, verification) {
  const value = {
    verificationKind: 'artifact',
    materialRole: role,
    libraRunId: runId,
    workspaceMaterialHandleId: material.handleId,
    workspaceMaterialHandleDigest: canonicalDigest(material),
    workspaceMaterialFenceDigest: material.fenceDigest,
    schemaRef: 'ArtifactManifestVerification@1',
    verificationId: verification.verificationId,
    verificationValue: verification,
    verificationDigest: canonicalDigest(verification),
    artifactHandle: artifact,
    artifactRequirement: requirement,
  };
  value.snapshotDigest = canonicalDigest(value);
  return Object.freeze(value);
}

function verifiedArtifactItem(ordinal, artifact, requirement, verification, chain) {
  const resultRef = {
    workId: chain.workId,
    attemptId: chain.attemptId,
    planId: chain.planId,
    eventId: chain.eventId,
    resultId: chain.resultId,
    capabilityRef: chain.capabilityRef,
    resultSchemaRef: ARTIFACT_VERIFICATION_SCHEMA,
    resultDigest: canonicalDigest(verification),
    inputBindingDigest: chain.inputBindingDigest,
  };
  const value = {
    ordinal,
    artifactHandleId: artifact.artifactHandleId,
    artifactKind: artifact.artifactKind,
    artifactRevision: artifact.referenceRevision,
    artifactDigest: artifact.digestHex,
    requirementId: requirement.requirementId,
    requirementRevision: requirement.revision,
    requirementSchemaRef: requirement.schemaRef,
    requirementDigest: requirement.requirementDigest,
    verificationEvidenceId: verification.verificationId,
    verificationEvidenceDigest: verification.verificationDigest,
    verificationResultRef: resultRef,
  };
  value.referenceDigest = canonicalDigest(value);
  return Object.freeze(value);
}

function createMovieProductionCoordinator(options) {
  if (!options?.schemaManifest || !options.unitOfWork || !options.workRuntime ||
      !options.productionPort || !options.workspaceProductPort) {
    fail('P14_MOVIE_PRODUCTION_DEPENDENCIES',
      'Movie production requires clean persistence, ports, and Work runtime.');
  }
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const reader = createMovieProductionReader(options);
  const workspaceAdmission = createWorkspaceAdmissionStore(options);
  const referenceStore = createWorkspaceMaterialReferenceStore(options);
  const resultStore = createSupportingResultStore(options);
  const promotionStore = createDeliverablePromotionStore(options);
  const deliveryReader = createProductDeliveryReader(options);
  const factCoordinator = createDomainCommitCoordinator({
    schemaManifest: options.schemaManifest,
    unitOfWork: options.unitOfWork,
    registry: createDomainCommitRegistry({
      registrations: createProductFactRegistrations({
        schemaManifest: options.schemaManifest,
      }),
    }),
    transactionRegistry: createCanonicalTransactionRegistry({
      contracts: [domainFactTransaction],
    }),
  });

  function admitWork(run, definition) {
    const result = createWorkAdmission({
      schemaManifest: options.schemaManifest,
      unitOfWork: options.unitOfWork,
      eligibilityProvider: {
        check(request) {
          return Object.freeze({
            eligible: request.ownerDomain === 'libra' &&
              request.processType === 'libra_run' &&
              request.processId === run.libraRunId &&
              request.executionBasisDigest === definition.executionBasisDigest,
            basisDigest: definition.executionBasisDigest,
            reasonCode: 'P14_MOVIE_PRODUCTION_BASIS_STALE',
          });
        },
      },
      limits: Object.freeze({
        globalOpenWorks: 1000,
        ownerOpenWorks: 500,
        openEvents: 100000,
      }),
    }).submit(definition);
    if (result.kind !== 'admitted') {
      fail('P14_MOVIE_PRODUCTION_WORK_DEFERRED',
        'Movie production Supporting Work cannot be admitted.', { result });
    }
  }

  function runResultCapability(run, value) {
    const basisDigest = canonicalDigest({
      schema: 'libra.movie-production-capability-basis@1',
      runExecutionBasisDigest: run.executionBasisDigest,
      capabilityRef: value.capabilityRef,
      input: value.input,
    });
    const workId = stable('movie-production-work-', {
      libraRunId: run.libraRunId,
      capabilityRef: value.capabilityRef,
      basisDigest,
    });
    const eventId = stable('movie-production-event-', { workId, basisDigest });
    const eventFenceDigest = canonicalDigest({
      schema: 'libra.movie-production-event-fence@1',
      workId,
      eventId,
      basisDigest,
    });
    const definition = workDefinition(run, {
      workId,
      workKind: value.workKind,
      objectiveRef: value.objectiveRef,
      basisDigest,
      resultSchemaRef: value.resultSchemaRef,
    });
    admitWork(run, definition);
    const step = capabilityStep({
      nodeId: value.nodeId,
      eventId,
      capabilityRef: value.capabilityRef,
      effectClass: value.effectClass,
      inputSchemaRef: value.inputSchemaRef,
      input: value.input,
      parametersSchemaRef: value.parametersSchemaRef,
      fenceSchemaRef: value.fenceSchemaRef,
      basisDigest,
      eventFenceDigest,
      resourceDemandSchemaRef: value.resourceDemandSchemaRef,
      resourceKinds: value.resourceKinds,
    });
    const activation = options.workRuntime.activate({
      workId,
      ownerDomain: 'libra',
      basisDigest,
      plannerRef: 'libra.movie-product-planner@1',
      catalogDigest: canonicalDigest({
        schema: 'libra.movie-product-catalog@1',
        capabilities: [value.capabilityRef],
      }),
      steps: Object.freeze([step]),
    });
    const event = options.workRuntime.beginEvent(eventId);
    if (event.state === 'succeeded') {
      const stored = resultStore.readEventResult(eventId);
      if (!stored || stored.resultSchemaRef !== value.resultSchemaRef) {
        fail('P14_MOVIE_PRODUCTION_RESULT_REPLAY',
          'Succeeded Supporting Work lacks its exact typed Result.');
      }
      return Object.freeze({
        ownerDomain: 'libra',
        processType: 'libra_run',
        processId: run.libraRunId,
        workKind: value.workKind,
        workState: 'succeeded',
        capabilityRef: value.capabilityRef,
        resultSchemaRef: stored.resultSchemaRef,
        result: stored.result,
        resultId: stored.resultId,
        resultDigest: stored.resultDigest,
        evidenceDigest: stored.evidenceDigest,
        inputBindingDigest: canonicalDigest(value.input),
        workId,
        attemptId: workId + ':attempt:1',
        planId: workId + ':plan:1',
        planRevision: Number(activation.snapshot.plan.planner_version),
        planDigest: activation.snapshot.plan.graph_digest,
        eventId,
        replayed: true,
      });
    }
    const resultId = stable('movie-production-result-', {
      eventId,
      resultDigest: canonicalDigest(value.result),
    });
    resultStore.commit({
      resultId,
      eventId,
      ownerDomain: 'libra',
      capabilityRef: value.capabilityRef,
      resultSchemaRef: value.resultSchemaRef,
      result: value.result,
      evidenceSchemaRef: value.resultSchemaRef,
      evidence: value.result,
      evidenceDigest: value.evidenceDigest,
    });
    if (event.state !== 'succeeded') options.workRuntime.completeEvent(eventId, resultId);
    options.workRuntime.complete(workId);
    return Object.freeze({
      ownerDomain: 'libra',
      processType: 'libra_run',
      processId: run.libraRunId,
      workKind: value.workKind,
      workState: 'succeeded',
      capabilityRef: value.capabilityRef,
      resultSchemaRef: value.resultSchemaRef,
      result: value.result,
      resultId,
      resultDigest: canonicalDigest(value.result),
      evidenceDigest: value.evidenceDigest,
      inputBindingDigest: canonicalDigest(value.input),
      workId,
      attemptId: workId + ':attempt:1',
      planId: workId + ':plan:1',
      planRevision: Number(activation.snapshot.plan.planner_version),
      planDigest: activation.snapshot.plan.graph_digest,
      eventId,
    });
  }

  function commitFact(run, factKind, sourceBasis, payloadValue) {
    const existing = reader.readFact(run.libraRunId, factKind, 1);
    if (existing) return existing;
    const payload = Object.freeze({ ...payloadValue, sourceBasis });
    const payloadDigest = canonicalDigest(payload);
    const basisDigest = canonicalDigest({
      schema: 'libra.movie-product-fact-work@1',
      libraRunId: run.libraRunId,
      factKind,
      payloadDigest,
    });
    const workId = stable('movie-product-fact-work-', {
      libraRunId: run.libraRunId,
      factKind,
      payloadDigest,
    });
    const eventId = stable('movie-product-fact-event-', { workId, basisDigest });
    const eventFenceDigest = canonicalDigest({
      schema: 'libra.movie-product-fact-event-fence@1',
      libraRunId: run.libraRunId,
      factKind,
      eventId,
      payloadDigest,
    });
    const definition = workDefinition(run, {
      workId,
      workKind: 'product_fact',
      objectiveRef: 'helix://libra/work/ProductFactCommit/v1',
      basisDigest,
      resultSchemaRef: factKind === 'resolved_identity'
        ? 'helix://contracts/types/ResolvedProductIdentity/v1'
        : factKind === 'media_cast'
          ? 'helix://contracts/types/MediaCastFact/v1'
          : 'helix://contracts/types/ProductMetadataFact/v1',
    });
    admitWork(run, definition);
    const handle = buildProductFactHandle({
      libraRunId: run.libraRunId,
      factKind,
      expectedRevision: 0,
      payloadDigest,
      eventFenceDigest,
    });
    const step = capabilityStep({
      nodeId: 'product-fact-commit',
      eventId,
      capabilityRef: 'libra.product_fact.commit@1',
      effectClass: 'domain_fact_commit',
      inputSchemaRef: 'helix://contracts/capabilities/libra.product_fact.commit/v1/inputs',
      input: payload,
      parametersSchemaRef: 'helix://contracts/capabilities/libra.product_fact.commit/v1/parameters',
      fenceSchemaRef: 'helix://contracts/capabilities/libra.product_fact.commit/v1/fence',
      basisDigest,
      eventFenceDigest,
      resourceDemandSchemaRef:
        'helix://contracts/capabilities/libra.product_fact.commit/v1/resource-demand',
    });
    options.workRuntime.activate({
      workId,
      ownerDomain: 'libra',
      basisDigest,
      plannerRef: 'libra.movie-product-planner@1',
      catalogDigest: canonicalDigest({
        schema: 'libra.movie-product-catalog@1',
        capabilities: ['libra.product_fact.commit@1'],
      }),
      steps: Object.freeze([step]),
    });
    const event = options.workRuntime.beginEvent(eventId);
    const marker = stable('movie-product-fact-marker-', {
      libraRunId: run.libraRunId,
      factKind,
      payloadDigest,
    });
    const resultId = stable('movie-product-fact-result-', {
      libraRunId: run.libraRunId,
      factKind,
      payloadDigest,
    });
    const evidence = {
      schemaRef: 'helix://contracts/types/LibraProductFactEvidence/v1',
      schemaVersion: 1,
      evidenceId: stable('movie-product-fact-evidence-', {
        libraRunId: run.libraRunId,
        factKind,
        payloadDigest,
      }),
      evidenceDigest: canonicalDigest({
        schema: 'libra.movie-product-fact-evidence@1',
        libraRunId: run.libraRunId,
        factKind,
        payloadDigest,
      }),
    };
    factCoordinator.execute({
      transactionId: 'helix.transaction.domain-fact-commit',
      handle,
      payload,
      supportingWorkId: workId,
      outboxMessages: [],
      commitMarker: {
        commitMarker: marker,
        commitDigest: canonicalDigest({
          schema: 'libra.movie-product-fact-commit@1',
          handleId: handle.handleId,
          payloadDigest,
        }),
      },
      resultBinding: {
        resultId,
        eventId,
        evidenceSchemaRef: evidence.schemaRef,
        evidence,
      },
    });
    if (event.state !== 'succeeded') options.workRuntime.completeEvent(eventId, resultId);
    options.workRuntime.complete(workId);
    const fact = reader.readFact(run.libraRunId, factKind, 1);
    if (!fact) fail('P14_MOVIE_PRODUCT_FACT_MISSING',
      'Committed Product Fact cannot be read from its exact Owner row.');
    return fact;
  }

  function ensureWorkspace(snapshot) {
    const id = workspaceId(snapshot.run.libraRunId);
    let workspace = reader.readWorkspace(id);
    if (workspace) return workspace;
    const root = options.workspaceProductPort.rootSnapshot();
    const inputPrimaryTotalBytes = snapshot.member.sizeBytes;
    const request = buildSpaceAdmissionRequest({
      workspaceId: id,
      libraRunId: snapshot.run.libraRunId,
      executionBasisDigest: snapshot.run.executionBasisDigest,
      rootId: root.rootId,
      rootSnapshotDigest: root.snapshotDigest,
      inputPrimaryTotalBytes,
      requiredFreeBytes: requiredFreeBytes(inputPrimaryTotalBytes),
    });
    const observedAtMs = now();
    const evidence = options.workspaceProductPort.observeSpace({
      ...request,
      requiredBytes: request.requiredFreeBytes,
      observedAtMs,
    });
    const decision = buildWorkspaceAdmissionDecision({
      libraRunRef: {
        libraRunId: snapshot.run.libraRunId,
        stateRevision: snapshot.run.stateRevision,
        stateDigest: snapshot.run.stateDigest,
        executionBasisDigest: snapshot.run.executionBasisDigest,
      },
      workspaceId: id,
      platformWorkspaceRootSnapshot: root,
      spaceAdmissionEvidence: evidence,
    });
    workspaceAdmission.admit({
      decision,
      commitMarker: stable('movie-workspace-admission-marker-', {
        workspaceId: id,
        decisionDigest: decision.decisionDigest,
      }),
      resultId: stable('movie-workspace-admission-result-', {
        workspaceId: id,
        decisionDigest: decision.decisionDigest,
      }),
    });
    workspace = reader.readWorkspace(id);
    if (!workspace) fail('P14_MOVIE_WORKSPACE_MISSING',
      'Admitted Workspace cannot be reconstructed.');
    return workspace;
  }

  function stageArtifact(run, workspace, materialized, role, requirement, verification) {
    let current = reader.readWorkspace(workspace.workspaceId);
    let reference = current.references.find((item) =>
      item.workspaceMaterialHandle.handleId ===
        materialized.workspaceMaterialHandle.handleId);
    if (!reference) {
      const attach = buildReferenceDecision({
        operation: 'attach_working',
        libraRunId: run.libraRunId,
        workspaceId: current.workspaceId,
        expectedWorkspaceRevision: current.currentRevision,
        expectedWorkspaceStateDigest: current.stateDigest,
        expectedReference: {
          state: 'absent',
          revision: 0,
          digest: absentReferenceDigest(
            current.workspaceId,
            materialized.workspaceMaterialHandle.handleId,
          ),
        },
        workspaceMaterialHandle: materialized.workspaceMaterialHandle,
        episodeClaims: [],
        episodeScopeDigest: episodeScopeDigest([]),
        productVerificationRef: null,
      });
      referenceStore.commit({
        decision: attach,
        commitMarker: stable('movie-workspace-reference-marker-', {
          operation: attach.operation,
          decisionDigest: attach.decisionDigest,
        }),
        resultId: stable('movie-workspace-reference-result-', {
          operation: attach.operation,
          decisionDigest: attach.decisionDigest,
        }),
      });
      current = reader.readWorkspace(workspace.workspaceId);
      reference = current.references.find((item) =>
        item.workspaceMaterialHandle.handleId ===
          materialized.workspaceMaterialHandle.handleId);
    }
    if (reference.state === 'working') {
      const snapshot = artifactVerificationSnapshot(
        run.libraRunId,
        role,
        materialized.workspaceMaterialHandle,
        materialized.artifactHandle,
        requirement,
        verification,
      );
      const promote = buildReferenceDecision({
        operation: 'promote_to_product_staging',
        libraRunId: run.libraRunId,
        workspaceId: current.workspaceId,
        expectedWorkspaceRevision: current.currentRevision,
        expectedWorkspaceStateDigest: current.stateDigest,
        expectedReference: {
          state: 'present',
          revision: reference.referenceRevision,
          digest: reference.referenceDigest,
        },
        workspaceMaterialHandle: materialized.workspaceMaterialHandle,
        episodeClaims: [],
        episodeScopeDigest: episodeScopeDigest([]),
        productVerificationRef: snapshot,
      });
      referenceStore.commit({
        decision: promote,
        commitMarker: stable('movie-workspace-reference-marker-', {
          operation: promote.operation,
          decisionDigest: promote.decisionDigest,
        }),
        resultId: stable('movie-workspace-reference-result-', {
          operation: promote.operation,
          decisionDigest: promote.decisionDigest,
        }),
      });
      current = reader.readWorkspace(workspace.workspaceId);
      reference = current.references.find((item) =>
        item.workspaceMaterialHandle.handleId ===
          materialized.workspaceMaterialHandle.handleId);
    }
    if (!reference || reference.state !== 'product_staging' ||
        reference.productVerificationRef?.materialRole !== role) {
      fail('P14_MOVIE_ARTIFACT_NOT_STAGED',
        'Workspace Artifact did not reach exact Product Staging.', {
          role,
          referenceId: reference?.referenceId || null,
          referenceState: reference?.state || null,
          verificationKind:
            reference?.productVerificationRef?.verificationKind || null,
          verificationMaterialRole:
            reference?.productVerificationRef?.materialRole || null,
        });
    }
    return Object.freeze({ workspace:current, reference });
  }

  async function advance(libraRunId) {
    const snapshot = reader.readRun(libraRunId);
    const productionTimeMs = snapshot.run.createdAtMs;
    if (snapshot.run.packageRevisionHead > 0) {
      const published = reader.readPublishedDeliveryRef(
        libraRunId,
        snapshot.run.packageRevisionHead,
      );
      if (!published) {
        fail('P14_MOVIE_PACKAGE_REPLAY_MISSING',
          'Run Package head does not resolve to its exact immutable Product Delivery.');
      }
      const delivery = deliveryReader.readPackage({
        queryContract: 'libra.product-delivery@1',
        readPurpose: 'historical',
        offerId: published.offerId,
        onDeckPackageId: published.onDeckPackageId,
        expectedPackageRevision: published.packageRevision,
        expectedPackageDigest: published.packageDigest,
      });
      if (delivery.resultKind !== 'found') {
        fail('P14_MOVIE_PACKAGE_REPLAY_MISSING',
          'Immutable Product Delivery cannot be reconstructed on replay.');
      }
      return Object.freeze({
        stage: 'handoff_b_offer_open',
        replayed: true,
        libraRunId,
        workspaceId: null,
        targetShelfId: published.shelfId,
        acceptanceSpecId: published.acceptanceSpecId,
        onDeckPackageId: published.onDeckPackageId,
        packageRevision: published.packageRevision,
        packageDigest: published.packageDigest,
        offerId: published.offerId,
        offerMessage: productOfferMessage({
          ...published,
          subjectId:
            delivery.onDeckProductPackage.subjectId,
        }),
        productDelivery: delivery,
      });
    }
    const nfoReference = snapshot.relatedReferences.find((item) => item.role === 'nfo');
    if (!nfoReference) {
      return Object.freeze({
        stage: 'product_metadata_unresolved',
        libraRunId,
        reasonCode: 'related_nfo_unavailable',
      });
    }
    const readHandle = options.productionPort.issuePhysicalReadHandle({
      libraRunId,
      runExecutionBasisDigest: snapshot.run.executionBasisDigest,
      runCreatedAtMs: snapshot.run.createdAtMs,
      physicalIdentity: snapshot.member.physicalIdentity,
      sizeBytes: snapshot.member.sizeBytes,
      endpointId: snapshot.member.endpointId,
      location: snapshot.member.location,
      bindingRevision: snapshot.member.bindingRevision,
      mountScopeRevision: 1,
    });
    const probe = mediaProbeEvidence(
      await options.productionPort.probe(readHandle),
      readHandle,
      productionTimeMs,
    );
    const mediaRequirement = buildMediaRequirement(snapshot.spec);
    const mediaInput = buildProductMediaCandidateInput({
      candidateNodeId: 'direct-original',
      libraRunId,
      mediaRequirement,
      candidateKind: 'direct_input',
      sourceMaterialHandle: readHandle,
      sourceProbeEvidence: probe,
    });
    const mediaVerification = buildProductMediaVerification({
      input: mediaInput,
      verifiedAtMs: productionTimeMs,
    });
    const selectionInput = buildProductOutputSelectionInput({
      libraRunId,
      acceptanceSpecId: snapshot.spec.acceptanceSpecId,
      acceptanceSpecRecordDigest: snapshot.spec.recordDigest,
      mediaRequirementDigest: mediaRequirement.requirementDigest,
      rankedCandidates: [{
        rank: 1,
        candidateId: mediaInput.candidateId,
        candidateNodeId: mediaInput.candidateNodeId,
      }],
      candidates: [mediaVerification],
    });
    const selected = selectProductOutput({
      input: selectionInput,
      producedAtMs: productionTimeMs,
    });
    if (selected.result !== 'selected') {
      return Object.freeze({
        stage: 'product_media_unresolved',
        libraRunId,
        reasonCodes: mediaVerification.reasonCodes,
      });
    }
    const relatedNfo = options.productionPort.readRelatedNfo({
      primaryMaterialKey: snapshot.member.materialKey,
      reference: nfoReference,
    });
    const title = relatedNfo.entries.find((item) => item.key === 'title')?.value;
    if (!title) {
      return Object.freeze({
        stage: 'product_identity_unresolved',
        libraRunId,
        reasonCode: 'title_identity_evidence_unavailable',
      });
    }
    const providerSearch = await options.productionPort.searchProviderIdentity({
      operationId: 'shared.integration.search@1',
      contentProfile: 'movie',
      title,
      candidateDeliverySnapshotDigest:
        snapshot.member.originCandidateDeliveryRef.candidateDeliverySnapshotDigest,
    });
    const identity = buildResolvedProductIdentity({
      producerRef: 'shared.integration.search@1',
      basisDigest: canonicalDigest({
        schema: 'libra.movie-provider-identity-basis@1',
        title,
        candidateDeliverySnapshotDigest:
          snapshot.member.originCandidateDeliveryRef.candidateDeliverySnapshotDigest,
        provider: providerSearch.provider,
        namespace: providerSearch.namespace,
        providerKey: providerSearch.providerKey,
      }),
      observedAtMs: productionTimeMs,
      subjectId: snapshot.run.subjectId,
      structureKind: 'single',
      contentProfile: 'movie',
      identityKind: 'tmdb_movie',
      providerIdentities: [providerSearch],
      exactSeasonContinuityClaims: [],
      displayEntries: [{ key:'title', value:title }],
    });
    const requestedFields = [...snapshot.spec.requirements.metadata.requiredFieldCodes]
      .filter((item) => item !== 'actor')
      .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    const nfoIntent = buildMetadataFetchIntent({
      libraRunId,
      runExecutionBasisDigest: snapshot.run.executionBasisDigest,
      sourceKind: 'related_nfo',
      sourcePriority: 0,
      contentProfile: 'movie',
      resolvedIdentityDigest: identity.identityDigest,
      requestedFields,
      relatedReferenceId: nfoReference.referenceId,
      relatedReferenceDigest: nfoReference.referenceDigest,
      expectedChecksum: nfoReference.checksumHex,
    });
    const nfoObservation = metadataObservation(nfoIntent, {
      entries: relatedNfo.entries,
      providerIdentities: [],
      peopleHints: [],
      artifactHints: [{
        artifactKind: 'nfo',
        sourceRef: nfoReference.referenceId,
        evidenceDigest: nfoReference.referenceDigest,
      }],
    }, productionTimeMs);
    const nfoChain = runResultCapability(snapshot.run, {
      workKind: 'product_metadata_observation',
      objectiveRef: 'helix://libra/work/ProductMetadataObservation/v1',
      nodeId: 'related-nfo-metadata-fetch',
      capabilityRef: 'libra.product_metadata.fetch@1',
      effectClass: 'pure_observation',
      inputSchemaRef:
        'helix://contracts/capabilities/libra.product_metadata.fetch/v1/inputs',
      input: nfoIntent,
      parametersSchemaRef:
        'helix://contracts/capabilities/libra.product_metadata.fetch/v1/parameters',
      fenceSchemaRef:
        'helix://contracts/capabilities/libra.product_metadata.fetch/v1/fence',
      resourceDemandSchemaRef:
        'helix://contracts/capabilities/libra.product_metadata.fetch/v1/resource-demand',
      resultSchemaRef: METADATA_SCHEMA,
      result: nfoObservation,
      evidenceDigest: nfoObservation.payloadDigest,
    });
    const providerIntent = buildMetadataFetchIntent({
      libraRunId,
      runExecutionBasisDigest: snapshot.run.executionBasisDigest,
      sourceKind: 'provider',
      sourcePriority: 1,
      contentProfile: 'movie',
      resolvedIdentityDigest: identity.identityDigest,
      requestedFields,
      providerKind: 'tmdb',
      integrationId: providerSearch.integrationId || 'tmdb-main',
      configRevision: providerSearch.configRevision || 1,
    });
    const provider = await options.productionPort.fetchProvider(providerIntent);
    const tmdbIdentity = providerIdentity(providerSearch);
    const providerObservation = metadataObservation(providerIntent, {
      entries: provider.descriptiveEntries,
      providerIdentities: [tmdbIdentity],
      peopleHints: provider.peopleHints,
      artifactHints: [{
        artifactKind: 'poster',
        sourceRef: provider.sourceRef || metadataSourceRef(providerIntent),
        evidenceDigest: provider.payloadDigest ||
          canonicalDigest(provider.descriptiveEntries),
      }],
    }, productionTimeMs);
    const providerChain = runResultCapability(snapshot.run, {
      workKind: 'product_metadata_observation',
      objectiveRef: 'helix://libra/work/ProductMetadataObservation/v1',
      nodeId: 'provider-metadata-fetch',
      capabilityRef: 'libra.product_metadata.fetch@1',
      effectClass: 'pure_observation',
      inputSchemaRef:
        'helix://contracts/capabilities/libra.product_metadata.fetch/v1/inputs',
      input: providerIntent,
      parametersSchemaRef:
        'helix://contracts/capabilities/libra.product_metadata.fetch/v1/parameters',
      fenceSchemaRef:
        'helix://contracts/capabilities/libra.product_metadata.fetch/v1/fence',
      resourceDemandSchemaRef:
        'helix://contracts/capabilities/libra.product_metadata.fetch/v1/resource-demand',
      resultSchemaRef: METADATA_SCHEMA,
      result: providerObservation,
      evidenceDigest: providerObservation.payloadDigest,
    });
    const results = [nfoChain, providerChain];
    const identityBasis = buildMetadataObservationBasis({
      intents: [nfoIntent, providerIntent],
      results,
      factKind: 'resolved_identity',
      expectedRevision: 0,
    });
    const identityFact = commitFact(
      snapshot.run,
      'resolved_identity',
      identityBasis,
      {
        schema: 'libra.resolved-product-identity-commit-payload@1',
        resolvedProductIdentity: Object.freeze({
          ...identity,
          basisDigest: identityBasis.sourceBasisDigest,
          evidenceId: stable('movie-resolved-identity-evidence-', {
            subjectId: identity.subjectId,
            basisDigest: identityBasis.sourceBasisDigest,
            identityDigest: identity.identityDigest,
          }),
          payloadDigest: canonicalDigest({
            schema: 'libra.resolved-product-identity-evidence@1',
            subjectId: identity.subjectId,
            basisDigest: identityBasis.sourceBasisDigest,
            identityDigest: identity.identityDigest,
          }),
        }),
      },
    );
    const workspace = ensureWorkspace(snapshot);
    const metadataBasis = buildMetadataObservationBasis({
      intents: [nfoIntent, providerIntent],
      results,
      factKind: 'product_metadata',
      expectedRevision: 0,
    });
    const requirements = ['nfo', 'poster'].map(artifactRequirement);
    const metadataDraftResult = buildProductMetadataDraft({
      sourceBasis: metadataBasis,
      requiredFields: requestedFields,
      producedAtMs: productionTimeMs,
      providerIdentities: [tmdbIdentity],
      artifactRequirements: requirements,
    });
    if (!metadataDraftResult.ready) {
      return Object.freeze({
        stage: 'product_metadata_unresolved',
        libraRunId,
        missingFields: metadataDraftResult.missingFields,
      });
    }
    const mergedEntries = metadataDraftResult.draft.descriptiveFacts.entries;
    const materials = [];
    const artifactChains = [];
    for (const [ordinal, kind] of ['nfo', 'poster'].entries()) {
      const bytes = kind === 'nfo' ? renderNfo(mergedEntries) : provider.posterBytes;
      const role = kind === 'nfo' ? 'metadata_sidecar' : 'poster';
      const requirement = requirements.find((item) => item.artifactKind === kind);
      const materialized = options.workspaceProductPort.materializeArtifact({
        libraRunId,
        workspaceId: workspace.workspaceId,
        relativePath: 'product/' + (kind === 'nfo' ? 'movie.nfo' : 'poster.jpg'),
        artifactKind: kind,
        mediaType: kind === 'nfo' ? 'application/xml' : 'image/jpeg',
        bytes,
        provenanceRef: {
          objectType: 'libra_run',
          objectId: libraRunId,
          revision: 1,
          digest: kind === 'nfo'
            ? metadataDraftResult.draft.draftDigest
            : providerObservation.payloadDigest,
        },
      });
      const verification = buildArtifactManifestVerification({
        requirement,
        artifactHandles: [materialized.artifactHandle],
        verifiedAtMs: productionTimeMs,
      });
      const inputBindings = Object.freeze({
        artifactHandleList: Object.freeze([materialized.artifactHandle]),
        artifactRequirement: requirement,
      });
      const chain = runResultCapability(snapshot.run, {
        workKind: 'artifact_verification',
        objectiveRef: 'helix://libra/work/ArtifactVerification/v1',
        nodeId: 'verify-' + kind,
        capabilityRef: 'shared.artifact.manifest.verify@1',
        effectClass: 'pure_observation',
        inputSchemaRef:
          'helix://contracts/capabilities/shared.artifact.manifest.verify/v1/inputs',
        input: inputBindings,
        parametersSchemaRef:
          'helix://contracts/capabilities/shared.artifact.manifest.verify/v1/parameters',
        fenceSchemaRef:
          'helix://contracts/capabilities/shared.artifact.manifest.verify/v1/fence',
        resourceDemandSchemaRef:
          'helix://contracts/capabilities/shared.artifact.manifest.verify/v1/resource-demand',
        resultSchemaRef: ARTIFACT_VERIFICATION_SCHEMA,
        result: verification,
        evidenceDigest: verification.verificationDigest,
      });
      const staged = stageArtifact(
        snapshot.run,
        workspace,
        materialized,
        role,
        requirement,
        verification,
      );
      materials.push(Object.freeze({
        ordinal,
        kind,
        role,
        requirement,
        materialized,
        verification,
        reference: staged.reference,
      }));
      artifactChains.push(chain);
    }
    const verifiedItems = materials.map((item, ordinal) =>
      verifiedArtifactItem(
        ordinal,
        item.materialized.artifactHandle,
        item.requirement,
        item.verification,
        artifactChains[ordinal],
      ));
    const artifactSetDigest = canonicalDigest({
      schema: 'libra.verified-artifact-set@1',
      items: verifiedItems,
    });
    const verifiedArtifactManifest = {
      manifestId: canonicalDigest({
        schema: 'libra.verified-artifact-manifest-id@1',
        libraRunId,
        artifactSetDigest,
      }),
      libraRunId,
      items: verifiedItems,
      artifactSetDigest,
    };
    verifiedArtifactManifest.manifestDigest =
      canonicalDigest(verifiedArtifactManifest);
    const castBasis = buildMetadataObservationBasis({
      intents: [nfoIntent, providerIntent],
      results,
      factKind: 'media_cast',
      expectedRevision: 0,
    });
    const relations = provider.peopleHints.map((item) => ({
      relationId: stable('movie-cast-relation-', {
        subjectId: snapshot.run.subjectId,
        role: item.role,
        displayName: item.displayName,
        providerIdentities: item.providerIdentities || [],
      }),
      personId: null,
      displayName: item.displayName,
      displayNameNormalized: item.displayName.normalize('NFKC').toLowerCase(),
      role: item.role,
      source: 'tmdb',
      providerIdentities: item.providerIdentities || [],
      originEvidenceDigest: providerObservation.payloadDigest,
      confidenceClass: 'provider_asserted',
    })).sort((left, right) => Buffer.compare(Buffer.from(left.role), Buffer.from(right.role)) ||
      Buffer.compare(Buffer.from(left.displayNameNormalized), Buffer.from(right.displayNameNormalized)) ||
      Buffer.compare(Buffer.from(left.relationId), Buffer.from(right.relationId)));
    const castDraft = buildMediaCastDraft({
      subjectId: snapshot.run.subjectId,
      sourceBasis: castBasis,
      relations,
      producedAtMs: productionTimeMs,
    });
    const castFact = commitFact(snapshot.run, 'media_cast', castBasis, {
      schema: 'libra.media-cast-fact-commit-payload@1',
      mediaCastDraft: castDraft,
    });
    const metadataFact = commitFact(snapshot.run, 'product_metadata', metadataBasis, {
      schema: 'libra.product-metadata-fact-commit-payload@1',
      productMetadataDraft: metadataDraftResult.draft,
      verifiedArtifactManifest,
      mediaCastFactRef: {
        productFactId: castFact.productFactId,
        factRevision: castFact.factRevision,
        factDigest: castFact.factDigest,
      },
    });
    if (typeof options.afterProductFactsCommit === 'function') {
      options.afterProductFactsCommit(Object.freeze({
        libraRunId,
        identityFact,
        castFact,
        metadataFact,
      }));
    }
    const facts = [castFact, metadataFact, identityFact]
      .map((item) => buildProductConformanceFactSnapshot(item))
      .sort((left, right) => Buffer.compare(Buffer.from(left.factKind), Buffer.from(right.factKind)));
    const packageRevision = snapshot.run.packageRevisionHead + 1;
    const onDeckPackageId = canonicalDigest({
      schema: 'libra.on-deck-package-id@1',
      libraRunId,
      packageRevision,
    });
    const primaryMember = {
      ordinal: 0,
      materialKey: snapshot.member.materialKey,
      role: 'primary_payload',
      physicalIdentity: snapshot.member.physicalIdentity,
      sizeBytes: snapshot.member.sizeBytes,
      location: {
        locationKind: 'domain_binding',
        endpointId: snapshot.member.endpointId,
        location: snapshot.member.location,
        rootHandleRef: null,
        relativePath: null,
      },
      bindingKind: 'libra_material_binding',
      bindingRevision: snapshot.member.bindingRevision,
      bindingEvidenceDigest: snapshot.member.bindingEvidenceDigest,
      originCandidateDeliveryRef: snapshot.member.originCandidateDeliveryRef,
      workspaceReferenceId: null,
      workspaceMaterialHandle: null,
      admittedControlRevision: snapshot.member.admittedControlRevision,
      admittedControlProjectionDigest:
        snapshot.member.admittedControlProjectionDigest,
      outputRequirementDigest: mediaRequirement.requirementDigest,
      episodeClaims: [],
      episodeClaimSetDigest: episodeClaimSetDigest([]),
      controlOperation: 'assert_existing_input',
      expectedControlRevision: snapshot.member.admittedControlRevision,
      expectedControlProjectionDigest:
        snapshot.member.admittedControlProjectionDigest,
      committedControlRevision: snapshot.member.admittedControlRevision,
      committedControlProjectionDigest:
        snapshot.member.admittedControlProjectionDigest,
    };
    primaryMember.memberDigest = canonicalDigest(primaryMember);
    const productMembers = [primaryMember, ...materials.map((item) => {
      const handle = item.materialized.workspaceMaterialHandle;
      const value = {
        ordinal: 0,
        materialKey: handle.materialKey,
        role: item.role,
        physicalIdentity: {
          schemaRef: 'helix://contracts/types/PhysicalMaterialIdentity/v1',
          schemaVersion: 1,
          materialKey: handle.materialKey,
          ...handle.physicalIdentity,
        },
        sizeBytes: handle.sizeBytes,
        location: {
          locationKind: 'workspace_handle',
          endpointId: handle.endpointId,
          location: null,
          rootHandleRef: handle.rootHandleRef,
          relativePath: handle.relativePath,
        },
        bindingKind: 'workspace_material_reference',
        bindingRevision: item.reference.referenceRevision,
        bindingEvidenceDigest: item.reference.referenceDigest,
        originCandidateDeliveryRef: null,
        workspaceReferenceId: item.reference.referenceId,
        workspaceMaterialHandle: handle,
        admittedControlRevision: null,
        admittedControlProjectionDigest: null,
        outputRequirementDigest: item.requirement.requirementDigest,
        episodeClaims: [],
        episodeClaimSetDigest: episodeClaimSetDigest([]),
        controlOperation: 'acquire_workspace_product',
        expectedControlRevision: null,
        expectedControlProjectionDigest: null,
        committedControlRevision: 1,
        committedControlProjectionDigest: projectMaterialControlRow(
          handle.materialKey,
          {
            control_revision: 1,
            state: 'controlled',
            owner_domain: 'libra',
            owner_scope_type: 'on_deck_package',
            owner_scope_id: onDeckPackageId,
          },
        ).projectionDigest,
      };
      return value;
    })].sort((left, right) => Buffer.compare(Buffer.from(left.materialKey), Buffer.from(right.materialKey)));
    productMembers.forEach((item, ordinal) => {
      item.ordinal = ordinal;
      item.memberDigest = canonicalDigest(Object.fromEntries(
        Object.entries(item).filter(([key]) => key !== 'memberDigest'),
      ));
    });
    const productMaterialManifest = {
      manifestId: canonicalDigest({
        schema: 'libra.production-material-manifest-id@1',
        manifestRole: 'product_delivery',
        libraRunId,
        manifestRevision: packageRevision,
      }),
      manifestRole: 'product_delivery',
      manifestRevision: packageRevision,
      libraRunId,
      scopeKind: 'single',
      members: productMembers,
      memberSetDigest: canonicalDigest({
        schema: 'libra.production-material-members@1',
        items: productMembers,
      }),
      episodeScopeDigest: episodeScopeDigest([]),
    };
    productMaterialManifest.manifestDigest =
      canonicalDigest(productMaterialManifest);
    const artifactItems = materials.map((item) => {
      const artifact = item.materialized.artifactHandle;
      const value = {
        artifactHandleId: artifact.artifactHandleId,
        artifactKind: artifact.artifactKind,
        artifactRevision: artifact.referenceRevision,
        artifactDigest: artifact.digestHex,
        requirementDigest: item.requirement.requirementDigest,
        materializationState: 'included_product',
      };
      value.referenceDigest = canonicalDigest(value);
      return value;
    }).sort((left, right) =>
      Buffer.compare(Buffer.from(left.artifactKind), Buffer.from(right.artifactKind)) ||
      Buffer.compare(Buffer.from(left.artifactHandleId), Buffer.from(right.artifactHandleId)) ||
      left.artifactRevision - right.artifactRevision);
    const artifactManifest = {
      manifestId: canonicalDigest({
        schema: 'libra.product-submanifest-id@1',
        manifestKind: 'artifact',
        libraRunId,
        packageRevision,
      }),
      manifestRevision: packageRevision,
      libraRunId,
      items: artifactItems,
      artifactSetDigest: canonicalDigest({
        schema: 'libra.product-artifact-set@1',
        items: artifactItems,
      }),
    };
    artifactManifest.manifestDigest = canonicalDigest(artifactManifest);
    const productStructure = complete({
      structureKind: 'single',
      contentProfile: 'movie',
      productScopeDigest: snapshot.spec.productScope.scopeDigest,
      episodeScopeDigest: episodeScopeDigest([]),
      primaryMaterialCount: 1,
      structuralDependencyCount: 0,
    }, 'productStructureDigest');
    const inventory = {
      productStructureSnapshot: productStructure,
      productMaterialManifest,
      artifactManifest,
    };
    inventory.inventoryDigest = canonicalDigest(inventory);
    const artifactVerificationSnapshots = materials.map((item, ordinal) => ({
      ordinal,
      verifiedManifestItem: verifiedItems[ordinal],
      artifactManifestItem: artifactItems.find((candidate) =>
        candidate.artifactHandleId ===
          item.materialized.artifactHandle.artifactHandleId),
      verificationResultRef: verifiedItems[ordinal].verificationResultRef,
      verificationValue: item.verification,
      snapshotDigest: '',
    })).map((item) => Object.freeze({
      ...item,
      snapshotDigest: canonicalDigest(Object.fromEntries(
        Object.entries(item).filter(([key]) => key !== 'snapshotDigest'),
      )),
    }));
    const conformanceInput = buildProductConformanceInputSnapshot({
      libraRunId,
      runExecutionBasisDigest: snapshot.run.executionBasisDigest,
      acceptanceSpecId: snapshot.spec.acceptanceSpecId,
      acceptanceSpecRecordDigest: snapshot.spec.recordDigest,
      acceptanceSpec: snapshot.spec,
      resolvedIdentitySnapshot: facts.find((item) =>
        item.factKind === 'resolved_identity'),
      productFactSnapshots: facts,
      verifiedArtifactManifest,
      artifactVerificationSnapshots,
      inventorySnapshot: inventory,
      selectedProducts: [{
        selectedProduct: selected,
        verification: mediaVerification,
        workspaceHandleDigest: null,
      }],
    });
    const conformance = evaluateProductConformance({
      input: conformanceInput,
      verifiedAtMs: productionTimeMs,
    });
    if (conformance.result !== 'passed') {
      return Object.freeze({
        stage: 'product_conformance_failed',
        libraRunId,
        conformance,
      });
    }
    const factItems = facts.map((item) => {
      const reference = {
        productFactId: item.productFactId,
        factKind: item.factKind,
        factRevision: item.factRevision,
        schemaRef: item.schemaRef,
        factValue: item.factValue,
        factDigest: item.factDigest,
        evidenceDigest: item.evidenceDigest,
      };
      reference.referenceDigest = canonicalDigest(reference);
      return reference;
    }).sort((left, right) =>
      Buffer.compare(Buffer.from(left.factKind), Buffer.from(right.factKind)) ||
      Buffer.compare(Buffer.from(left.productFactId), Buffer.from(right.productFactId)) ||
      left.factRevision - right.factRevision);
    const productFactManifest = {
      manifestId: canonicalDigest({
        schema: 'libra.product-submanifest-id@1',
        manifestKind: 'product_fact',
        libraRunId,
        packageRevision,
      }),
      manifestRevision: packageRevision,
      libraRunId,
      items: factItems,
      factSetDigest: canonicalDigest({
        schema: 'libra.product-fact-set@1',
        items: factItems,
      }),
    };
    productFactManifest.manifestDigest =
      canonicalDigest(productFactManifest);
    const offloadMember = {
      ordinal: 0,
      materialKey: snapshot.member.materialKey,
      contextRole: 'original_input',
      physicalIdentity: snapshot.member.physicalIdentity,
      endpointId: snapshot.member.endpointId,
      location: snapshot.member.location,
      bindingRevision: snapshot.member.bindingRevision,
      bindingEvidenceDigest: snapshot.member.bindingEvidenceDigest,
      admittedControlRevision: snapshot.member.admittedControlRevision,
      admittedControlProjectionDigest:
        snapshot.member.admittedControlProjectionDigest,
      settlementExpectation: 'retain',
    };
    offloadMember.memberDigest = canonicalDigest(offloadMember);
    const offloadContextManifest = {
      manifestId: canonicalDigest({
        schema: 'libra.product-submanifest-id@1',
        manifestKind: 'offload_context',
        libraRunId,
        packageRevision,
      }),
      manifestRevision: packageRevision,
      libraRunId,
      members: [offloadMember],
      memberSetDigest: canonicalDigest({
        schema: 'libra.offload-context-members@1',
        items: [offloadMember],
      }),
    };
    offloadContextManifest.manifestDigest =
      canonicalDigest(offloadContextManifest);
    const stagingReferences = reader.readWorkspace(workspace.workspaceId)
      .references.filter((item) => item.state === 'product_staging')
      .sort((left, right) => Buffer.compare(
        Buffer.from(left.referenceId),
        Buffer.from(right.referenceId),
      ));
    const provenance = {
      libraRunId,
      runExecutionBasisDigest: snapshot.run.executionBasisDigest,
      acceptanceSpecRecordDigest: snapshot.spec.recordDigest,
      workflowPlanRefs: results.concat(artifactChains).map((item) => ({
        planId: item.planId,
        planRevision: item.planRevision,
        planDigest: item.planDigest,
      })).sort((left, right) =>
        Buffer.compare(Buffer.from(left.planId), Buffer.from(right.planId))),
      productVerificationRefs: [{
        verificationId: mediaVerification.verificationId,
        verificationDigest: canonicalDigest(mediaVerification),
      }],
      externalRealityObservationRefs: [{
        evidenceId: probe.evidenceId,
        evidenceDigest: probe.payloadDigest,
      }],
    };
    provenance.provenanceDigest = canonicalDigest(provenance);
    const attestation = {
      attestationId: canonicalDigest({
        schema: 'libra.production-attestation-id@1',
        libraRunId,
        onDeckPackageId,
        productConformanceEvidenceId: conformance.verificationId,
        productConformanceEvidenceDigest: canonicalDigest(conformance),
      }),
      libraRunId,
      onDeckPackageId,
      acceptanceSpecId: snapshot.spec.acceptanceSpecId,
      acceptanceSpecRecordDigest: snapshot.spec.recordDigest,
      productConformanceEvidenceId: conformance.verificationId,
      productConformanceEvidenceDigest: canonicalDigest(conformance),
      evaluatedRequirementSetDigest: conformance.evaluatedRequirementSetDigest,
      productSnapshotDigest: conformance.productSnapshotDigest,
      unmetRequirementCount: conformance.unmetRequirementCodes.length,
      attestedAtMs: productionTimeMs,
      attestationDigest: '',
    };
    attestation.attestationDigest = canonicalDigest(Object.fromEntries(
      Object.entries(attestation).filter(([key]) => key !== 'attestationDigest'),
    ));
    const controlItems = productMembers.map((item) =>
      item.controlOperation === 'assert_existing_input'
        ? Object.freeze({
          controlOperation: item.controlOperation,
          materialKey: item.materialKey,
          expectedControlRevision: item.expectedControlRevision,
          expectedControlProjectionDigest: item.expectedControlProjectionDigest,
          ownerDomain: 'libra',
          ownerScopeType: 'subject',
          ownerScopeId: snapshot.run.subjectId,
        })
        : Object.freeze({
          controlOperation: item.controlOperation,
          materialKey: item.materialKey,
          expectedControlState: 'absent',
          toOwnerDomain: 'libra',
          toOwnerScopeType: 'on_deck_package',
          toOwnerScopeId: onDeckPackageId,
        }));
    const controlCommitScope = {
      items: controlItems,
      controlScopeDigest: canonicalDigest({
        schema: 'libra.product-control-commit-scope@1',
        libraRunId,
        onDeckPackageId,
        items: controlItems,
      }),
    };
    const currentWorkspace = reader.readWorkspace(workspace.workspaceId);
    const decision = {
      decisionId: '',
      libraRunRef: {
        libraRunId,
        stateRevision: snapshot.run.stateRevision,
        stateDigest: snapshot.run.stateDigest,
        executionBasisDigest: snapshot.run.executionBasisDigest,
        runScopeDigest: snapshot.run.runScopeDigest,
        expectedPackageRevisionHead: snapshot.run.packageRevisionHead,
      },
      runMaterialManifestRef: {
        manifestId: snapshot.run.runMaterialManifestId,
        manifestDigest: snapshot.run.runMaterialManifestDigest,
      },
      workspaceRef: {
        workspaceId: currentWorkspace.workspaceId,
        libraRunId,
        workspaceRevision: currentWorkspace.currentRevision,
        workspaceStateDigest: currentWorkspace.stateDigest,
      },
      productStagingReferences: stagingReferences,
      acceptanceSpecRef: {
        acceptanceSpecId: snapshot.spec.acceptanceSpecId,
        recordDigest: snapshot.spec.recordDigest,
      },
      resolvedIdentitySnapshot: facts.find((item) =>
        item.factKind === 'resolved_identity'),
      productStructureSnapshot: productStructure,
      productFactManifest,
      artifactManifest,
      mediaCastSnapshot: {
        mediaCastFactId: castFact.productFactId,
        mediaCastFactRevision: castFact.factRevision,
        schemaRef: castFact.schemaRef,
        factValue: castFact.factValue,
        factDigest: castFact.factDigest,
        evidenceDigest: castFact.evidenceDigest,
        relations: castFact.factValue.relations,
        relationsDigest: castFact.factValue.relationsDigest,
      },
      productMaterialManifest,
      offloadContextManifest,
      productionProvenance: provenance,
      productionAttestation: attestation,
      controlCommitScope,
      onDeckPackageId,
      packageRevision,
      packageDigest: '',
      offerId: '',
      decisionDigest: '',
    };
    decision.packageDigest = onDeckProductPackageDigest(
      decision,
      snapshot.run.subjectId,
      snapshot.spec.targetShelfId || snapshot.spec.shelfId,
    );
    decision.offerId = canonicalDigest({
      schema: 'libra.product-offer-id@1',
      onDeckPackageId,
      packageDigest: decision.packageDigest,
    });
    decision.decisionId = canonicalDigest({
      schema: 'libra.deliverable-promotion-decision-id@1',
      libraRunId,
      packageRevision: decision.packageRevision,
      packageDigest: decision.packageDigest,
      controlScopeDigest: controlCommitScope.controlScopeDigest,
    });
    decision.decisionDigest = canonicalDigest(Object.fromEntries(
      Object.entries(decision).filter(([key]) => key !== 'decisionDigest'),
    ));
    const controlHandle = {
      schemaRef: 'helix://contracts/types/ResponsibilityControlCommitHandle/v1',
      schemaVersion: 1,
      handleId: stable('movie-promotion-control-', {
        libraRunId,
        decisionDigest: decision.decisionDigest,
      }),
      ownerDomain: 'libra',
      processType: 'libra_run',
      processId: libraRunId,
      operationKind: 'replace_control_set',
      basisRef: {
        objectType: 'deliverable_promotion',
        objectId: decision.decisionId,
        revision: decision.packageRevision,
        digest: decision.decisionDigest,
      },
      basisDigest: decision.decisionDigest,
      canonicalFactSetDigest: productFactManifest.factSetDigest,
      bindingSetDigest: productMaterialManifest.memberSetDigest,
      controlScopeDigest: controlCommitScope.controlScopeDigest,
      expectedControlRevisions: controlItems.map((item) => ({
        materialKey: item.materialKey,
        revision: item.controlOperation === 'assert_existing_input'
          ? item.expectedControlRevision
          : 0,
      })),
      receiptContract: RESULT_SCHEMA,
      eventFenceDigest: canonicalDigest({
        schema: 'libra.movie-promotion-event-fence@1',
        libraRunId,
        decisionDigest: decision.decisionDigest,
      }),
    };
    const published = promotionStore.publish({
      transactionId: 'helix.transaction.libra-deliverable-promotion',
      decision,
      controlCommitHandle: controlHandle,
      commitMarker: stable('movie-promotion-marker-', {
        libraRunId,
        decisionDigest: decision.decisionDigest,
      }),
      resultId: stable('movie-promotion-result-', {
        libraRunId,
        decisionDigest: decision.decisionDigest,
      }),
    });
    if (typeof options.afterPackageCommit === 'function') {
      options.afterPackageCommit(Object.freeze({
        libraRunId,
        onDeckPackageId,
        offerId: decision.offerId,
      }));
    }
    const delivery = deliveryReader.readPackage({
      queryContract: 'libra.product-delivery@1',
      readPurpose: 'historical',
      offerId: decision.offerId,
      onDeckPackageId,
      expectedPackageRevision: decision.packageRevision,
      expectedPackageDigest: decision.packageDigest,
    });
    if (delivery.resultKind !== 'found') {
      fail('P14_MOVIE_PRODUCT_DELIVERY_MISSING',
        'Published Product Delivery cannot be reconstructed.');
    }
    return Object.freeze({
      stage: 'handoff_b_offer_open',
      replayed: published.replayed,
      libraRunId,
      workspaceId: workspace.workspaceId,
      targetShelfId: snapshot.spec.targetShelfId || snapshot.spec.shelfId,
      acceptanceSpecId: snapshot.spec.acceptanceSpecId,
      onDeckPackageId,
      packageRevision: decision.packageRevision,
      packageDigest: decision.packageDigest,
      offerId: decision.offerId,
      offerMessage: productOfferMessage({
        offerId: decision.offerId,
        onDeckPackageId,
        packageRevision: decision.packageRevision,
        packageDigest: decision.packageDigest,
        libraRunId,
        subjectId: snapshot.run.subjectId,
        shelfId: snapshot.spec.targetShelfId || snapshot.spec.shelfId,
        acceptanceSpecId: snapshot.spec.acceptanceSpecId,
      }),
      productDelivery: delivery,
      conformance,
    });
  }

  return Object.freeze({ advance });
}

module.exports = Object.freeze({
  MovieProductionCoordinatorError,
  createMovieProductionCoordinator,
});
