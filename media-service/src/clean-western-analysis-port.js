'use strict';

const { createHash } = require('node:crypto');
const { canonicalDigest, canonicalJson } =
  require('./helix/contracts/canonical-json');

class CleanWesternAnalysisPortError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CleanWesternAnalysisPortError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new CleanWesternAnalysisPortError(code, message, details);
}

function digestValue(value, field) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    fail('CLEAN_WESTERN_DIGEST_INVALID', field + ' must be one SHA-256 digest.');
  }
  return value;
}

function digestBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function exactKeys(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) {
    fail(code, 'Western analysis value is not the exact closed shape.');
  }
  return value;
}

function parsedArtifact(port, handle, expectedKind) {
  if (!handle || handle.artifactKind !== expectedKind ||
      handle.ownerDomain !== 'libra' ||
      handle.ownerScope?.scopeType !== 'libra_run') {
    fail('CLEAN_WESTERN_ARTIFACT_HANDLE_INVALID',
      'Western analysis requires the exact service-local Artifact Handle.', {
        expectedKind,
      });
  }
  const recovered = port.readArtifactBytes(handle);
  let payload;
  try {
    payload = JSON.parse(recovered.bytes.toString('utf8'));
  } catch {
    fail('CLEAN_WESTERN_ARTIFACT_PAYLOAD_INVALID',
      'Western analysis Artifact payload is not valid canonical JSON.');
  }
  if (canonicalJson(payload) !== recovered.bytes.toString('utf8')) {
    fail('CLEAN_WESTERN_ARTIFACT_PAYLOAD_INVALID',
      'Western analysis Artifact payload is not canonical JSON.');
  }
  return Object.freeze({ recovered, payload });
}

function frameComposite(port, handle) {
  const parsed = parsedArtifact(port, handle, 'western_frame_set');
  const payload = exactKeys(parsed.payload, [
    'frameMemberSetDigest',
    'memberPayloads',
    'members',
    'schema',
  ], 'CLEAN_WESTERN_FRAME_RESULT_INVALID');
  if (payload.schema !== 'libra.western-frame-composite@1' ||
      !Array.isArray(payload.members) ||
      !Array.isArray(payload.memberPayloads) ||
      payload.members.length < 1 ||
      payload.members.length > 1024 ||
      payload.memberPayloads.length !== payload.members.length) {
    fail('CLEAN_WESTERN_FRAME_RESULT_INVALID',
      'Western frame composite has an invalid closed root.');
  }
  payload.members.forEach((item, ordinal) => {
    exactKeys(item, [
      'contentDigest',
      'locator',
      'ordinal',
      'timestampMs',
    ], 'CLEAN_WESTERN_FRAME_RESULT_INVALID');
    const memberPayload = payload.memberPayloads[ordinal];
    exactKeys(memberPayload, [
      'bytesBase64',
      'contentDigest',
      'encoding',
      'ordinal',
    ], 'CLEAN_WESTERN_FRAME_RESULT_INVALID');
    if (item.ordinal !== ordinal ||
        memberPayload.ordinal !== ordinal ||
        !Number.isSafeInteger(item.timestampMs) ||
        item.timestampMs < 0 ||
        item.locator !== 'composite-member:' + ordinal ||
        memberPayload.encoding !== 'base64' ||
        item.contentDigest !== memberPayload.contentDigest) {
      fail('CLEAN_WESTERN_FRAME_RESULT_INVALID',
        'Western frame index and member payload are not a bijection.');
    }
    const bytes = Buffer.from(memberPayload.bytesBase64, 'base64');
    if (!bytes.length ||
        bytes.toString('base64') !== memberPayload.bytesBase64 ||
        digestBytes(bytes) !== item.contentDigest) {
      fail('CLEAN_WESTERN_FRAME_RESULT_INVALID',
        'Western frame member bytes do not match the index digest.');
    }
  });
  if (payload.frameMemberSetDigest !== canonicalDigest({
    schema: 'libra.western-frame-member-set@1',
    items: payload.members,
  })) {
    fail('CLEAN_WESTERN_FRAME_RESULT_INVALID',
      'Western frame member-set digest is invalid.');
  }
  return Object.freeze({ ...parsed, payload });
}

function typedParameters(values = []) {
  const result = [...values].map((item) => {
    exactKeys(item, ['parameter', 'valueType', 'value'],
      'CLEAN_WESTERN_PARAMETER_INVALID');
    if (typeof item.parameter !== 'string' || !item.parameter ||
        !['string', 'integer', 'number', 'boolean'].includes(item.valueType) ||
        (item.valueType === 'string' && typeof item.value !== 'string') ||
        (item.valueType === 'integer' && !Number.isSafeInteger(item.value)) ||
        (item.valueType === 'number' &&
          (typeof item.value !== 'number' || !Number.isFinite(item.value))) ||
        (item.valueType === 'boolean' && typeof item.value !== 'boolean')) {
      fail('CLEAN_WESTERN_PARAMETER_INVALID',
        'Western typed parameter type and value disagree.');
    }
    return Object.freeze({
      ...item,
      valueDigest: canonicalDigest({
        parameter: item.parameter,
        valueType: item.valueType,
        value: item.value,
      }),
    });
  }).sort((left, right) =>
    Buffer.compare(Buffer.from(left.parameter), Buffer.from(right.parameter)));
  if (result.length > 64 ||
      new Set(result.map((item) => item.parameter)).size !== result.length) {
    fail('CLEAN_WESTERN_PARAMETER_INVALID',
      'Western typed parameters must be bounded, sorted, and unique.');
  }
  return Object.freeze(result);
}

function modelConfiguration(value) {
  exactKeys(value, [
    'clusterDistanceThreshold',
    'clusterMinSize',
    'inputContractDigest',
    'licenseDigest',
    'modelDigest',
    'modelId',
    'modelRevision',
    'outputContractDigest',
  ], 'CLEAN_WESTERN_MODEL_PACK_INVALID');
  if (typeof value.modelId !== 'string' || !value.modelId ||
      !Number.isSafeInteger(value.modelRevision) || value.modelRevision < 1 ||
      typeof value.clusterDistanceThreshold !== 'number' ||
      !Number.isFinite(value.clusterDistanceThreshold) ||
      value.clusterDistanceThreshold < 0 ||
      value.clusterDistanceThreshold > 1 ||
      !Number.isSafeInteger(value.clusterMinSize) ||
      value.clusterMinSize < 1) {
    fail('CLEAN_WESTERN_MODEL_PACK_INVALID',
      'Western Model Pack metadata is invalid.');
  }
  [
    'modelDigest',
    'inputContractDigest',
    'outputContractDigest',
    'licenseDigest',
  ].forEach((field) => digestValue(value[field], field));
  const modelBasis = {
    contractId: canonicalDigest({
      schema: 'libra.western-face-model-contract-id@1',
      modelId: value.modelId,
      modelRevision: value.modelRevision,
      modelDigest: value.modelDigest,
    }),
    revision: 1,
    schemaRef: 'helix://contracts/domain-types/FaceModelRef/v1',
    mode: 'western_frame_set',
    modelId: value.modelId,
    modelRevision: value.modelRevision,
    modelDigest: value.modelDigest,
    runtimeKind: 'onnx',
    inputContractDigest: value.inputContractDigest,
    outputContractDigest: value.outputContractDigest,
    licenseDigest: value.licenseDigest,
    typedParameters: typedParameters([]),
  };
  const faceModelRef = Object.freeze({
    ...modelBasis,
    digest: canonicalDigest(modelBasis),
  });
  const clusterBasis = {
    parameterSetId: canonicalDigest({
      schema: 'libra.western-cluster-parameter-set-id@1',
      modelRefDigest: faceModelRef.digest,
      distanceThreshold: value.clusterDistanceThreshold,
      minClusterSize: value.clusterMinSize,
    }),
    revision: 1,
    schemaRef: 'helix://contracts/domain-types/ClusterParameters/v1',
    modelRefDigest: faceModelRef.digest,
    distanceMetric: 'cosine',
    distanceThreshold: value.clusterDistanceThreshold,
    minClusterSize: value.clusterMinSize,
    typedParameters: typedParameters([]),
  };
  return Object.freeze({
    faceModelRef,
    clusterParameters: Object.freeze({
      ...clusterBasis,
      digest: canonicalDigest(clusterBasis),
    }),
  });
}

function createCleanWesternAnalysisPort(options) {
  if (!options?.workspaceProductPort ||
      typeof options.workspaceProductPort.materializeArtifact !== 'function' ||
      typeof options.workspaceProductPort.openFrameCompositeSink !==
        'function' ||
      typeof options.workspaceProductPort.recoverMaterializedArtifact !==
        'function' ||
      typeof options.workspaceProductPort.readArtifactBytes !== 'function' ||
      !options.engine || typeof options.engine !== 'object') {
    fail('CLEAN_WESTERN_PORT_DEPENDENCIES',
      'Western analysis requires the clean Workspace Artifact port and one service-local engine.');
  }
  const requiredMethods = [
    'extractFrameSet',
    'computeEmbeddings',
    'computeClusters',
    'analyzeWestern',
    'matchReferences',
    'renderPoster',
  ];
  if (requiredMethods.some((method) => typeof options.engine[method] !== 'function')) {
    fail('CLEAN_WESTERN_ENGINE_INCOMPLETE',
      'The service-local Western engine is incomplete.');
  }
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const configuration = modelConfiguration(options.modelPack);
  const workspacePort = options.workspaceProductPort;

  function materialize(value) {
    return workspacePort.materializeArtifact(value);
  }

  async function extractFrames(request) {
    const source = request?.sourceHandle;
    const plan = request?.samplingPlan;
    const target = request?.outputTarget;
    if (!source || !plan || !target || target.outputKind !== 'frame_set' ||
        target.sourceInputDigest !== canonicalDigest({
          sourceHandle: source,
          samplingPlan: plan,
        }) ||
        target.libraRunId !== source.ownerScope?.scopeId ||
        plan.digest !== canonicalDigest(Object.fromEntries(
          Object.entries(plan).filter(([key]) => key !== 'digest'),
        ))) {
      fail('CLEAN_WESTERN_FRAME_INPUT_INVALID',
        'Frame extraction input does not match its frozen Plan target.');
    }
    const materializeRequest = {
      libraRunId: target.libraRunId,
      workspaceId: target.workspaceId,
      relativePath: target.targetRelativePath,
      artifactKind: 'western_frame_set',
      mediaType: 'application/vnd.shelfdeck.western-frame-set+json',
      provenanceRef: {
        objectType: 'western_frame_extract',
        objectId: target.targetId,
        revision: 1,
        digest: target.targetDigest,
      },
    };
    let materialized = workspacePort.recoverMaterializedArtifact(
      materializeRequest,
    );
    let composite;
    if (materialized) {
      composite = frameComposite(
        workspacePort,
        materialized.artifactHandle,
      ).payload;
    } else {
      const sink = workspacePort.openFrameCompositeSink({
        ...materializeRequest,
        maxFrames: plan.maxFrames,
      });
      const raw = await options.engine.extractFrameSet(Object.freeze({
        sourceHandle: source,
        samplingPlan: plan,
        outputSink: Object.freeze({
          contract: sink.contract,
          writeFrame: sink.writeFrame,
        }),
      }));
      exactKeys(raw, ['frameCount'],
        'CLEAN_WESTERN_FRAME_RESULT_INVALID');
      if (!Number.isSafeInteger(raw.frameCount) ||
          raw.frameCount < 1 || raw.frameCount > plan.maxFrames) {
        fail('CLEAN_WESTERN_FRAME_RESULT_INVALID',
          'Frame extraction returned an invalid bounded composite set.');
      }
      const committed = sink.commit();
      materialized = committed.materialized;
      composite = committed.composite;
      if (raw.frameCount !== composite.members.length) {
        fail('CLEAN_WESTERN_FRAME_RESULT_INVALID',
          'Frame engine count does not match bytes written to the sink.');
      }
    }
    if (composite?.schema !== 'libra.western-frame-composite@1' ||
        !Array.isArray(composite.members) ||
        !Array.isArray(composite.memberPayloads) ||
        composite.members.length < 1 ||
        composite.members.length > plan.maxFrames ||
        composite.frameMemberSetDigest !== canonicalDigest({
          schema: 'libra.western-frame-member-set@1',
          items: composite.members,
        })) {
      fail('CLEAN_WESTERN_FRAME_RESULT_INVALID',
        'Recovered Frame composite does not match the frozen contract.');
    }
    const handle = materialized.artifactHandle;
    const membersDigest = canonicalDigest({
      schema: 'libra.western-frame-artifact-set@1',
      items: [handle],
    });
    const basis = {
      schemaRef: 'helix://contracts/types/FrameArtifactSet/v1',
      schemaVersion: 1,
      manifestId: canonicalDigest({
        schema: 'libra.western-frame-artifact-set-id@1',
        libraRunId: target.libraRunId,
        sourceMaterialDigest: canonicalDigest(source),
        samplingPlanDigest: plan.digest,
        outputTargetDigest: target.targetDigest,
      }),
      manifestKind: 'western_frame_artifact_set',
      ownerDomain: 'libra',
      memberCount: 1,
      membersDigest,
      publishedAtMs: now(),
      libraRunId: target.libraRunId,
      workspaceId: target.workspaceId,
      sourceMaterialDigest: canonicalDigest(source),
      samplingPlanDigest: plan.digest,
      outputTargetDigest: target.targetDigest,
      frameCount: composite.members.length,
      frameMemberSetDigest: composite.frameMemberSetDigest,
      frameSetArtifactHandle: handle,
    };
    return Object.freeze({
      ...basis,
      manifestDigest: canonicalDigest(Object.fromEntries(
        Object.entries(basis).filter(([key]) => key !== 'publishedAtMs'),
      )),
    });
  }

  async function computeEmbeddings(request) {
    const frameSet = request?.frameArtifactSet;
    const model = request?.faceModelRef;
    if (!frameSet || !model ||
        canonicalJson(model) !== canonicalJson(configuration.faceModelRef) ||
        frameSet.frameSetArtifactHandle?.artifactKind !== 'western_frame_set') {
      fail('CLEAN_WESTERN_EMBEDDING_INPUT_INVALID',
        'Embedding input does not match the frame Result and Model Pack.');
    }
    const framePayload = frameComposite(
      workspacePort,
      frameSet.frameSetArtifactHandle,
    ).payload;
    const relativePath = 'analysis/embeddings/' +
      canonicalDigest({
        frameArtifactSetDigest: frameSet.manifestDigest,
        faceModelRefDigest: model.digest,
      }) + '.json';
    const provenanceRef = {
      objectType: 'western_face_embedding',
      objectId: frameSet.manifestId,
      revision: model.modelRevision,
      digest: canonicalDigest({
        frameArtifactSetDigest: frameSet.manifestDigest,
        faceModelRefDigest: model.digest,
      }),
    };
    const materializeRequest = {
      libraRunId: frameSet.libraRunId,
      workspaceId: frameSet.workspaceId,
      relativePath,
      artifactKind: 'face_embedding_set',
      mediaType: 'application/vnd.shelfdeck.face-embedding-set+json',
      provenanceRef,
    };
    let materialized = workspacePort.recoverMaterializedArtifact(
      materializeRequest,
    );
    let payload;
    if (materialized) {
      payload = parsedArtifact(
        workspacePort,
        materialized.artifactHandle,
        'face_embedding_set',
      ).payload;
    } else {
      const raw = await options.engine.computeEmbeddings(Object.freeze({
        frameArtifactSet: frameSet,
        frameComposite: framePayload,
        faceModelRef: model,
      }));
      if (!raw || !Number.isSafeInteger(raw.detectedFaceCount) ||
          raw.detectedFaceCount < 0 ||
          !Number.isSafeInteger(raw.vectorCount) ||
          raw.vectorCount !== raw.detectedFaceCount ||
          !Number.isSafeInteger(raw.dimension) || raw.dimension < 1 ||
          !Array.isArray(raw.vectors) ||
          raw.vectors.length !== raw.vectorCount) {
        fail('CLEAN_WESTERN_EMBEDDING_RESULT_INVALID',
          'Embedding engine returned an invalid bounded vector set.');
      }
      payload = Object.freeze({
        schema: 'shared.face-embedding-set@1',
        dimension: raw.dimension,
        vectors: Object.freeze(raw.vectors),
      });
      materialized = materialize({
        ...materializeRequest,
        bytes: Buffer.from(canonicalJson(payload), 'utf8'),
      });
    }
    if (payload?.schema !== 'shared.face-embedding-set@1' ||
        !Number.isSafeInteger(payload.dimension) ||
        payload.dimension < 1 || !Array.isArray(payload.vectors)) {
      fail('CLEAN_WESTERN_EMBEDDING_RESULT_INVALID',
        'Recovered embedding set does not match the frozen contract.');
    }
    const vectorCount = payload.vectors.length;
    const basis = {
      schemaRef: 'helix://contracts/types/FaceEmbeddingSetHandle/v1',
      schemaVersion: 1,
      artifactHandleId: materialized.artifactHandle.artifactHandleId,
      artifactHandle: materialized.artifactHandle,
      computationMode: 'western_frame_set',
      libraRunId: frameSet.libraRunId,
      workspaceId: frameSet.workspaceId,
      faceModelRefDigest: model.digest,
      sourceArtifactSetDigest: frameSet.manifestDigest,
      detectedFaceCount: vectorCount,
      vectorCount,
      dimension: payload.dimension,
      embeddingDigest: materialized.artifactHandle.digestHex,
    };
    return Object.freeze({ ...basis, handleDigest: canonicalDigest(basis) });
  }

  async function computeClusters(request) {
    const embedding = request?.faceEmbeddingSetHandle;
    const parameters = request?.clusterParameters;
    if (!embedding || !parameters ||
        canonicalJson(parameters) !==
          canonicalJson(configuration.clusterParameters) ||
        embedding.faceModelRefDigest !== parameters.modelRefDigest ||
        embedding.artifactHandle?.artifactKind !== 'face_embedding_set') {
      fail('CLEAN_WESTERN_CLUSTER_INPUT_INVALID',
        'Cluster input does not match the embedding and frozen parameters.');
    }
    const embeddingPayload = parsedArtifact(
      workspacePort,
      embedding.artifactHandle,
      'face_embedding_set',
    ).payload;
    const relativePath = 'analysis/clusters/' +
      canonicalDigest({
        embeddingDigest: embedding.embeddingDigest,
        clusterParameterDigest: parameters.digest,
      }) + '.json';
    const provenanceRef = {
      objectType: 'western_face_cluster',
      objectId: embedding.artifactHandleId,
      revision: 1,
      digest: canonicalDigest({
        embeddingDigest: embedding.embeddingDigest,
        clusterParameterDigest: parameters.digest,
      }),
    };
    const materializeRequest = {
      libraRunId: embedding.libraRunId,
      workspaceId: embedding.workspaceId,
      relativePath,
      artifactKind: 'face_cluster_set',
      mediaType: 'application/vnd.shelfdeck.face-cluster-set+json',
      provenanceRef,
    };
    let materialized = workspacePort.recoverMaterializedArtifact(
      materializeRequest,
    );
    let rawClusters;
    if (materialized) {
      const payload = parsedArtifact(
        workspacePort,
        materialized.artifactHandle,
        'face_cluster_set',
      ).payload;
      if (payload?.schema !== 'shared.face-cluster-set@1') {
        fail('CLEAN_WESTERN_CLUSTER_RESULT_INVALID',
          'Recovered cluster set has the wrong schema.');
      }
      rawClusters = payload.clusters;
    } else {
      const raw = await options.engine.computeClusters(Object.freeze({
        faceEmbeddingSetHandle: embedding,
        embeddingSet: embeddingPayload,
        clusterParameters: parameters,
      }));
      rawClusters = raw?.clusters;
    }
    if (!Array.isArray(rawClusters) || rawClusters.length > 1024) {
      fail('CLEAN_WESTERN_CLUSTER_RESULT_INVALID',
        'Cluster engine returned an invalid bounded cluster set.');
    }
    const clusters = rawClusters.map((item) => {
      if (!item || typeof item.clusterId !== 'string' || !item.clusterId ||
          item.clusterId.length > 256) {
        fail('CLEAN_WESTERN_CLUSTER_RESULT_INVALID',
          'Cluster identity is invalid.');
      }
      return Object.freeze({ ...item });
    }).sort((left, right) =>
      Buffer.compare(Buffer.from(left.clusterId), Buffer.from(right.clusterId)));
    if (new Set(clusters.map((item) => item.clusterId)).size !==
        clusters.length) {
      fail('CLEAN_WESTERN_CLUSTER_RESULT_INVALID',
        'Cluster identities must be unique.');
    }
    if (!materialized) {
      const payload = Object.freeze({
        schema: 'shared.face-cluster-set@1',
        clusters: Object.freeze(clusters),
      });
      materialized = materialize({
        ...materializeRequest,
        bytes: Buffer.from(canonicalJson(payload), 'utf8'),
      });
    }
    const basis = {
      schemaRef: 'helix://contracts/types/FaceClusterSetHandle/v1',
      schemaVersion: 1,
      artifactHandleId: materialized.artifactHandle.artifactHandleId,
      artifactHandle: materialized.artifactHandle,
      libraRunId: embedding.libraRunId,
      workspaceId: embedding.workspaceId,
      faceModelRefDigest: embedding.faceModelRefDigest,
      clusterParameterDigest: parameters.digest,
      sourceEmbeddingDigest: embedding.embeddingDigest,
      clusterCount: clusters.length,
      clusterDigest: materialized.artifactHandle.digestHex,
    };
    return Object.freeze({ ...basis, handleDigest: canonicalDigest(basis) });
  }

  async function requestAnalysis(request) {
    const frameSet = request?.frameArtifactSet;
    const embedding = request?.faceEmbeddingSetHandle;
    const clusters = request?.faceClusterSetHandle;
    const spec = request?.analysisSpec;
    const target = request?.outputTarget;
    if (!frameSet || !embedding || !clusters || !spec || !target ||
        target.outputKind !== 'western_analysis' ||
        target.sourceInputDigest !== canonicalDigest({
          frameArtifactSet: frameSet,
          faceEmbeddingSetHandle: embedding,
          faceClusterSetHandle: clusters,
          analysisSpec: spec,
        }) ||
        spec.frameArtifactSetDigest !== frameSet.manifestDigest ||
        spec.faceModelRefDigest !== embedding.faceModelRefDigest ||
        spec.clusterParameterDigest !== clusters.clusterParameterDigest ||
        target.libraRunId !== spec.libraRunId) {
      fail('CLEAN_WESTERN_ANALYSIS_REQUEST_INVALID',
        'Western Analysis Request does not conserve its upstream Results.');
    }
    const provenanceRef = {
      objectType: 'western_analysis_request',
      objectId: spec.specId,
      revision: spec.revision,
      digest: canonicalDigest({
        analysisSpecDigest: spec.specDigest,
        outputTargetDigest: target.targetDigest,
      }),
    };
    const materializeRequest = {
      libraRunId: target.libraRunId,
      workspaceId: target.workspaceId,
      relativePath: target.targetRelativePath,
      artifactKind: 'western_analysis',
      mediaType: 'application/vnd.shelfdeck.western-analysis+json',
      provenanceRef,
    };
    const recovered = workspacePort.recoverMaterializedArtifact(
      materializeRequest,
    );
    if (recovered) return recovered.artifactHandle;
    const clusterPayload = parsedArtifact(
      workspacePort,
      clusters.artifactHandle,
      'face_cluster_set',
    ).payload;
    const raw = await options.engine.analyzeWestern(Object.freeze({
      frameArtifactSet: frameSet,
      faceEmbeddingSetHandle: embedding,
      faceClusterSetHandle: clusters,
      clusterSet: clusterPayload,
      analysisSpec: spec,
    }));
    if (!raw || typeof raw.identityAnchor !== 'string' ||
        !raw.identityAnchor || raw.identityAnchor.length > 512 ||
        !Array.isArray(raw.descriptiveFacts)) {
      fail('CLEAN_WESTERN_ANALYSIS_RESULT_INVALID',
        'Western analysis engine returned invalid identity or metadata evidence.');
    }
    const descriptiveFacts = [...raw.descriptiveFacts]
      .map((item) => Object.freeze({
        key: item.key,
        value: item.value,
      }))
      .concat(raw.descriptiveFacts.some((item) =>
        item.key === 'internal_identity')
        ? []
        : [Object.freeze({
          key: 'internal_identity',
          value: raw.identityAnchor,
        })])
      .sort((left, right) =>
        Buffer.compare(Buffer.from(left.key), Buffer.from(right.key)));
    if (descriptiveFacts.some((item) =>
      typeof item.key !== 'string' || !item.key) ||
      new Set(descriptiveFacts.map((item) => item.key)).size !==
        descriptiveFacts.length) {
      fail('CLEAN_WESTERN_ANALYSIS_RESULT_INVALID',
        'Western descriptive facts must be sorted and unique.');
    }
    const payload = Object.freeze({
      schema: 'libra.western-analysis-artifact@1',
      analysisVariantRef: spec.analysisVariantRef,
      identityAnchor: raw.identityAnchor,
      descriptiveFacts: Object.freeze(descriptiveFacts),
      clusterIds: Object.freeze(clusterPayload.clusters
        .map((item) => item.clusterId)),
      analysisPayloadDigest: canonicalDigest({
        analysisVariantRef: spec.analysisVariantRef,
        identityAnchor: raw.identityAnchor,
        descriptiveFacts,
        clusterIds: clusterPayload.clusters.map((item) => item.clusterId),
      }),
    });
    return materialize({
      ...materializeRequest,
      bytes: Buffer.from(canonicalJson(payload), 'utf8'),
    }).artifactHandle;
  }

  function observeAnalysis(request) {
    const frameSet = request?.frameArtifactSet;
    const embedding = request?.faceEmbeddingSetHandle;
    const clusters = request?.faceClusterSetHandle;
    const spec = request?.analysisSpec;
    const artifact = request?.artifactHandle;
    const parsed = parsedArtifact(
      workspacePort,
      artifact,
      'western_analysis',
    );
    if (artifact.ownerScope.scopeId !== spec?.libraRunId ||
        frameSet?.manifestDigest !== spec?.frameArtifactSetDigest ||
        embedding?.handleDigest !== canonicalDigest(Object.fromEntries(
          Object.entries(embedding || {}).filter(([key]) =>
            key !== 'handleDigest'),
        )) ||
        clusters?.handleDigest !== canonicalDigest(Object.fromEntries(
          Object.entries(clusters || {}).filter(([key]) =>
            key !== 'handleDigest'),
        )) ||
        parsed.payload.analysisVariantRef !== spec.analysisVariantRef) {
      fail('CLEAN_WESTERN_ANALYSIS_OBSERVE_INVALID',
        'Western Analysis Observation input or Artifact provenance drifted.');
    }
    const resultArtifactHandleDigest = canonicalDigest(artifact);
    const basisDigest = canonicalDigest({
      schema: 'libra.western-analysis-observation-basis@1',
      libraRunId: spec.libraRunId,
      runExecutionBasisDigest: spec.runExecutionBasisDigest,
      frameArtifactSetDigest: frameSet.manifestDigest,
      embeddingSetDigest: embedding.handleDigest,
      clusterSetDigest: clusters.handleDigest,
      analysisSpecDigest: spec.specDigest,
      resultArtifactHandleDigest,
    });
    const domainPayload = {
      libraRunId: spec.libraRunId,
      runExecutionBasisDigest: spec.runExecutionBasisDigest,
      frameArtifactSetDigest: frameSet.manifestDigest,
      embeddingSetDigest: embedding.handleDigest,
      clusterSetDigest: clusters.handleDigest,
      analysisSpecDigest: spec.specDigest,
      analysisVariantRef: spec.analysisVariantRef,
      resultArtifactHandle: artifact,
    };
    const basis = {
      schemaRef: 'helix://contracts/types/WesternAnalysisResult/v1',
      schemaVersion: 1,
      evidenceId: canonicalDigest({
        schema: 'libra.western-analysis-evidence-id@1',
        basisDigest,
      }),
      evidenceKind: 'western_analysis_observation',
      producerRef: 'libra.western.analysis.observe@1',
      basisDigest,
      payloadDigest: canonicalDigest(domainPayload),
      observedAtMs: now(),
      ...domainPayload,
    };
    return Object.freeze({ ...basis, resultDigest: canonicalDigest(basis) });
  }

  function readAnalysisPayload(result) {
    if (!result || result.resultDigest !== canonicalDigest(Object.fromEntries(
      Object.entries(result).filter(([key]) => key !== 'resultDigest'),
    ))) {
      fail('CLEAN_WESTERN_ANALYSIS_RESULT_INVALID',
        'Western Analysis Result digest is invalid.');
    }
    return parsedArtifact(
      workspacePort,
      result.resultArtifactHandle,
      'western_analysis',
    ).payload;
  }

  async function matchReferences(request) {
    const clusters = request?.faceClusterSetHandle;
    const projections = [...(request?.personReferenceProjectionList || [])];
    if (!clusters || projections.length > 256 ||
        projections.some((item) => !item ||
          item.projectionContract !==
            'people.person-reference-projection@1')) {
      fail('CLEAN_WESTERN_MATCH_INPUT_INVALID',
        'Reference Match requires one exact cluster Result and bounded People projections.');
    }
    projections.sort((left, right) =>
      Buffer.compare(Buffer.from(left.personId), Buffer.from(right.personId)));
    if (new Set(projections.map((item) => item.personId)).size !==
        projections.length) {
      fail('CLEAN_WESTERN_MATCH_INPUT_INVALID',
        'People projections must be person-unique.');
    }
    const clusterPayload = parsedArtifact(
      workspacePort,
      clusters.artifactHandle,
      'face_cluster_set',
    ).payload;
    const projectionItems = projections.map((item) => ({
      personId: item.personId,
      personRevision: item.personRevision,
      projectionRevision: item.projectionRevision,
      projectionDigest: item.projectionDigest,
    }));
    const referenceProjectionSetDigest = canonicalDigest({
      schema: 'people.person-reference-projection-set@1',
      items: projectionItems,
    });
    const raw = await options.engine.matchReferences(Object.freeze({
      faceClusterSetHandle: clusters,
      clusters: clusterPayload.clusters,
      personReferenceProjections: Object.freeze(projections),
    }));
    if (!raw || !Array.isArray(raw.matches)) {
      fail('CLEAN_WESTERN_MATCH_RESULT_INVALID',
        'Reference Match engine returned an invalid result.');
    }
    const byPerson = new Map(projections.map((item) => [item.personId, item]));
    const clusterIds = clusterPayload.clusters.map((item) => item.clusterId);
    const seenClusters = new Set();
    const matches = raw.matches.map((item) => {
      const projection = byPerson.get(item.personId);
      if (!projection || !clusterIds.includes(item.clusterId) ||
          seenClusters.has(item.clusterId) ||
          !['exact', 'strong', 'weak'].includes(item.confidenceClass)) {
        fail('CLEAN_WESTERN_MATCH_RESULT_INVALID',
          'Reference Match result is outside its frozen input projections.');
      }
      seenClusters.add(item.clusterId);
      const value = {
        clusterId: item.clusterId,
        personId: item.personId,
        personRevision: projection.personRevision,
        projectionRevision: projection.projectionRevision,
        projectionDigest: projection.projectionDigest,
        confidenceClass: item.confidenceClass,
      };
      return Object.freeze({
        ...value,
        evidenceDigest: canonicalDigest({
          schema: 'shared.face-reference-match-evidence@1',
          ...value,
        }),
      });
    }).sort((left, right) =>
      Buffer.compare(Buffer.from(left.clusterId), Buffer.from(right.clusterId)) ||
      Buffer.compare(Buffer.from(left.personId), Buffer.from(right.personId)));
    const unmatchedClusterIds = clusterIds
      .filter((clusterId) => !seenClusters.has(clusterId))
      .sort((left, right) =>
        Buffer.compare(Buffer.from(left), Buffer.from(right)));
    const basisDigest = canonicalDigest({
      schema: 'shared.face-reference-match-basis@1',
      clusterSetDigest: clusters.handleDigest,
      referenceProjectionSetDigest,
    });
    const domainPayload = {
      clusterSetDigest: clusters.handleDigest,
      referenceProjectionSetDigest,
      matches: Object.freeze(matches),
      unmatchedClusterIds: Object.freeze(unmatchedClusterIds),
    };
    return Object.freeze({
      schemaRef: 'helix://contracts/types/PersonMatchEvidence/v1',
      schemaVersion: 1,
      evidenceId: canonicalDigest({
        schema: 'shared.face-reference-match-evidence-id@1',
        basisDigest,
      }),
      evidenceKind: 'face_reference_match',
      producerRef: 'shared.face.reference.match@1',
      basisDigest,
      payloadDigest: canonicalDigest(domainPayload),
      observedAtMs: now(),
      ...domainPayload,
    });
  }

  async function renderPoster(request) {
    const frameSet = request?.frameArtifactSet;
    const match = request?.personMatchEvidence;
    if (!frameSet || !match ||
        frameSet.frameSetArtifactHandle?.artifactKind !==
          'western_frame_set') {
      fail('CLEAN_WESTERN_POSTER_INPUT_INVALID',
        'Western Poster render requires exact Frame and Match Results.');
    }
    const materializeRequest = {
      libraRunId: frameSet.libraRunId,
      workspaceId: frameSet.workspaceId,
      relativePath: request.relativePath,
      artifactKind: 'poster',
      mediaType: 'image/jpeg',
      provenanceRef: {
        objectType: 'western_poster_render',
        objectId: match.evidenceId,
        revision: 1,
        digest: canonicalDigest({
          personMatchEvidenceDigest: match.payloadDigest,
          frameArtifactSetDigest: frameSet.manifestDigest,
        }),
      },
    };
    const recovered = workspacePort.recoverMaterializedArtifact(
      materializeRequest,
    );
    if (recovered) return recovered.artifactHandle;
    const framePayload = frameComposite(
      workspacePort,
      frameSet.frameSetArtifactHandle,
    ).payload;
    const bytes = await options.engine.renderPoster(Object.freeze({
      frameArtifactSet: frameSet,
      frameComposite: framePayload,
      personMatchEvidence: match,
    }));
    if (!Buffer.isBuffer(bytes) || !bytes.length) {
      fail('CLEAN_WESTERN_POSTER_RESULT_INVALID',
        'Western Poster renderer did not return image bytes.');
    }
    return materialize({
      ...materializeRequest,
      bytes,
    }).artifactHandle;
  }

  return Object.freeze({
    configuration: () => configuration,
    computeClusters,
    computeEmbeddings,
    extractFrames,
    matchReferences,
    observeAnalysis,
    readAnalysisPayload,
    renderPoster,
    requestAnalysis,
  });
}

module.exports = Object.freeze({
  CleanWesternAnalysisPortError,
  createCleanWesternAnalysisPort,
});
