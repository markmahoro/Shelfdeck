'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PORTS = path.resolve(__dirname, '../../src/clean-us-adult-catalogue-ports.js');
const HOST = path.resolve(__dirname, '../../src/clean-service-host.js');

test('catalogue Host factories stop the Event CPU session in finally', () => {
  const source = fs.readFileSync(PORTS, 'utf8');
  assert.match(source, /async function stopSession/);
  assert.match(source, /withSessionStop/);
  assert.match(source, /finally\{await stopSession\(cpuSession\);\}/);
  assert.match(source, /extractFrames:withSessionStop/);
  assert.match(source, /computeEmbeddings:withSessionStop/);
  assert.match(source, /computeClusters:withSessionStop/);
  assert.match(source, /inspectRecovery:withSessionStop/);
});

test('People buffalo reference preparation creates a model-only CPU session', () => {
  const host = fs.readFileSync(HOST, 'utf8');
  const block = host.match(/buffaloPeoplePreparation[\s\S]*?createPeopleReferencePreparation/);
  assert.ok(block, 'buffaloPeoplePreparation wiring must exist');
  assert.match(block[0], /modelRoot:catalogueHostConfig\.buffaloModelRoot/);
  assert.doesNotMatch(block[0], /catalogueRoot:catalogueHostConfig\.catalogueRoot/);
  assert.doesNotMatch(block[0], /catalogueGeneration:/);
});

const {createHash} = require('node:crypto');
const {fixture} = require('./fixtures/us-adult-catalogue-basis');
const {buildCatalogueAnalysisBasis} = require('../../src/helix/domains/libra/model/us-adult-catalogue-analysis-basis');
const {catalogueFrameBatch} = require('../../src/helix/domains/libra/model/us-adult-catalogue-frame-work');
const {frameEvidence} = require('../../src/helix/contracts/buffalo-frame-evidence');
const {encodeBuffaloEmbeddingSet} = require('../../src/helix/contracts/buffalo-frame-artifact');
const {canonicalDigest, canonicalJson} = require('../../src/helix/contracts/canonical-json');
const {createUsAdultCataloguePortFactories} = require('../../src/clean-us-adult-catalogue-ports');

function noFaceBatch(basis) {
  const compiled = catalogueFrameBatch(basis, 'initial');
  const source = {
    basisDigest: basis.basisDigest,
    batchDigest: compiled.batchDigest,
    frameArtifactSetDigest: canonicalDigest('frames-initial'),
    frameMemberSetDigest: canonicalDigest('members-initial'),
    frameArtifactBytes: 1000,
    points: compiled.points,
  };
  const frames = compiled.points.map((point) => {
    const {compositeOrdinal, ...frame} = point;
    return frameEvidence({
      basisDigest: basis.basisDigest,
      frame: {...frame, imageDigest: canonicalDigest('initial-' + point.ordinal)},
      analysis: {
        coordinateSpace: {
          kind: 'corrected_canvas',
          sourceWidth: 1280,
          sourceHeight: 720,
          width: 1280,
          height: 720,
          rotationDegrees: 0,
          pixelDigest: canonicalDigest('pixels-' + point.ordinal),
        },
        faces: [],
      },
    });
  });
  const embeddingSet = encodeBuffaloEmbeddingSet({source, frames});
  return {
    compiled,
    source,
    embeddingSet,
    embeddingDigest: createHash('sha256').update(canonicalJson(embeddingSet)).digest('hex'),
  };
}

function hostFor(basis) {
  return {
    buffaloModelRoot: '/models',
    catalogueRoot: '/catalogue',
    catalogueConfiguration: {
      catalogueGeneration: basis.catalogueGeneration,
      catalogueSearchPolicy: basis.catalogueSearchPolicy,
    },
  };
}

test('successful catalogue observation stops the CPU session', async () => {
  const basis = buildCatalogueAnalysisBasis(fixture());
  const face = noFaceBatch(basis);
  let stops = 0;
  let validated = false;
  const factories = createUsAdultCataloguePortFactories({
    catalogueHost: hostFor(basis),
    createCpuSession() {
      return {
        faceModelRef: basis.faceModelRef,
        async groupFaces() { throw new Error('catalogue CPU must stay idle for no-face evidence'); },
        async loadCatalogue() { throw new Error('catalogue CPU must stay idle for no-face evidence'); },
        async searchCatalogue() { throw new Error('catalogue CPU must stay idle for no-face evidence'); },
        async analyzeEvidence() { throw new Error('catalogue CPU must stay idle for no-face evidence'); },
        async stop() { stops += 1; },
      };
    },
    frameExtractor: {},
    workspaceProductPort: {
      materializeArtifact() { throw new Error('materialize'); },
      recoverMaterializedArtifact() { return null; },
      readArtifactBytes() { return {bytes: Buffer.from(canonicalJson(face.embeddingSet))}; },
      rootSnapshot() { return {}; },
    },
    now: () => 1000,
  });
  const completedBatches = {
    mode: 'initial',
    batches: [{
      stage: 'initial',
      batchDigest: face.compiled.batchDigest,
      frameArtifactSet: {manifestDigest: face.source.frameArtifactSetDigest},
      faceEmbeddingSetHandle: {
        embeddingDigest: face.embeddingDigest,
        artifactHandle: {artifactKind: 'face_embedding_set'},
      },
    }],
  };
  const port = factories.createCatalogueObservationPort({
    context: {assertExecutionActive() {}, eventAttemptId: 'attempt', idempotencyKey: 'key', recoveryDecision: null},
    basis,
    completedBatches,
    capturePublicationFence() { return {}; },
    validateObservation() {
      validated = true;
      throw Object.assign(new Error('after compute'), {code: 'AFTER_COMPUTE'});
    },
  });
  const body = {
    libraRunId: basis.libraRunId,
    workspaceId: basis.workspaceId,
    outputKind: 'face_catalogue_observation',
    sourceInputDigest: canonicalDigest({
      usAdultCatalogueAnalysisBasis: basis,
      usAdultCatalogueCompletedBatchSet: completedBatches,
    }),
    targetRelativePath: 'analysis/catalogue/observation.json',
  };
  await assert.rejects(
    () => port.observe({basis, completedBatches, outputTarget: {...body, targetDigest: canonicalDigest(body)}}),
    {code: 'AFTER_COMPUTE'},
  );
  assert.equal(validated, true);
  assert.equal(stops, 1);
});

test('frame extract and recovery inspection stop the CPU session when they fail', async () => {
  const basis = buildCatalogueAnalysisBasis(fixture());
  const batch = catalogueFrameBatch(basis, 'initial');
  function openPort(stops) {
    return createUsAdultCataloguePortFactories({
      catalogueHost: hostFor(basis),
      createCpuSession() {
        return {
          faceModelRef: basis.faceModelRef,
          async analyzeEvidence() { throw new Error('unused'); },
          async groupFaces() { throw new Error('unused'); },
          async stop() { stops.count += 1; },
        };
      },
      frameExtractor: {async extractPoints() { throw new Error('unused'); }},
      workspaceProductPort: {
        materializeArtifact() { throw new Error('unused'); },
        openFrameCompositeSink() { throw new Error('sink'); },
        recoverMaterializedArtifact() { return null; },
        readArtifactBytes() { throw new Error('unused'); },
        rootSnapshot() { return {}; },
      },
      now: () => 1000,
    }).createCatalogueFramePort({
      context: {
        eventAttemptId: 'attempt',
        idempotencyKey: 'key',
        recoveryDecision: null,
        capabilityRef: 'libra.media.frames.extract@1',
        ownerScope: {domain: 'libra', processType: 'libra_run', processId: basis.libraRunId},
        assertExecutionActive() {},
      },
      basis,
      batch,
      capturePublicationFence() { return {}; },
    });
  }
  const extractStops = {count: 0};
  await assert.rejects(() => openPort(extractStops).extractFrames({
    sourceHandle: basis.sourceHandle,
    samplingPlan: batch.samplingPlan,
    outputTarget: {
      libraRunId: basis.libraRunId,
      workspaceId: basis.workspaceId,
      outputKind: 'frame_set',
      sourceInputDigest: canonicalDigest({sourceHandle: basis.sourceHandle, samplingPlan: batch.samplingPlan}),
      targetRelativePath: 'analysis/frames/initial.json',
    },
  }));
  assert.equal(extractStops.count, 1);
  const recoveryStops = {count: 0};
  await assert.rejects(() => openPort(recoveryStops).inspectRecovery({}));
  assert.equal(recoveryStops.count, 1);
});
