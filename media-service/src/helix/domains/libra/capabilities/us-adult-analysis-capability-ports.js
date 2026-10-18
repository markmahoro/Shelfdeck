'use strict';
const {canonicalDigest, canonicalJson} = require('../../../contracts/canonical-json');
const {FRAME, EMBED, CLUSTER, MATCH, resultRef, frameWork, matchWork, exactResult} = require('../model/us-adult-analysis-work');
const EFFECTS = Object.freeze({[FRAME]:'workspace_write', [EMBED]:'workspace_write', [CLUSTER]:'workspace_write', [MATCH]:'pure_observation'});
function createUsAdultAnalysisCapabilityPorts(options) {
  const now = options.now || Date.now;
  function state(context) {
    const basis = options.usAdultAnalysisStore.getByRun(context.ownerScope.processId), snapshot = options.movieProductionReader.readRunSnapshot(context.ownerScope.processId);
    if (context.ownerScope.domain !== 'libra' || context.ownerScope.processType !== 'libra_run' || !basis ||
        snapshot?.run.executionBasisDigest !== basis.runExecutionBasisDigest || snapshot.spec.contentProfile !== 'western_adult') {
      throw new Error('US Adult analysis execution requires its frozen Libra Run basis.');
    }
    const frames = frameWork(snapshot, basis); let pageOrdinal = null;
    if (context.capabilityRef === MATCH) {
      const match = /^libra-us-adult-match-(\d+)-work-/.exec(context.workId); pageOrdinal = match ? Number(match[1]) : -1;
      if (context.workId !== matchWork(snapshot, basis, pageOrdinal).workId) throw new Error('US Adult reference matching Work was substituted.');
    } else if (context.workId !== frames.workId) throw new Error('US Adult frame analysis Work was substituted.');
    return {basis, snapshot, frames, pageOrdinal};
  }
  function equal(value, expected, message) { if (canonicalJson(value) !== canonicalJson(expected)) throw new Error(message); }
  function validate(context) {
    const current = state(context), input = context.namedInputs;
    switch (context.capabilityRef) {
      case FRAME:
        equal(input.physicalMaterialReadHandleOrWorkspaceMaterialHandle, current.basis.sourceHandle, 'US Adult source Handle changed.');
        equal(input.samplingPlan, current.basis.samplingPlan, 'US Adult frame sampling changed.');
        if (input.workspaceArtifactOutputTarget.libraRunId !== current.basis.libraRunId ||
            input.workspaceArtifactOutputTarget.workspaceId !== current.basis.workspaceId) throw new Error('US Adult frame target crossed its Workspace.');
        break;
      case EMBED: {
        const frames = exactResult(options, current.frames, FRAME).result;
        equal(input.artifactHandleList, [frames.frameSetArtifactHandle], 'US Adult frame Artifact changed before embedding.');
        equal(input.faceModelRef, current.basis.faceModelRef, 'US Adult embedding model changed.'); break;
      }
      case CLUSTER:
        equal(input.faceEmbeddingSetHandle, exactResult(options, current.frames, EMBED).result, 'US Adult embedding source changed.');
        equal(input.clusterParameters, current.basis.clusterParameters, 'US Adult clustering parameters changed.'); break;
      case MATCH:
        equal(input.faceClusterSetHandle, exactResult(options, current.frames, CLUSTER).result, 'US Adult matching source changed.');
        equal(input.personReferenceProjectionList, options.usAdultAnalysisStore.readPage(current.basis.analysisId, current.pageOrdinal).items.map(item => item.referenceProjection),
          'US Adult reference page changed.'); break;
      default: throw new Error('US Adult analysis Capability is not supported.');
    }
    return current;
  }
  const ports = Object.fromEntries(Object.keys(EFFECTS).map(capabilityRef => [capabilityRef, Object.freeze({
    validateInputs:validate,
    async execute(context) {
      const {basis, frames} = validate(context);
      if (typeof options.createUsAdultAnalysisPort !== 'function') throw Object.assign(new Error('The Service CPU analysis port is unavailable.'), {code:'US_ADULT_ANALYSIS_PORT_UNAVAILABLE'});
      const port = options.createUsAdultAnalysisPort({context, basis}), input = context.namedInputs; let result;
      switch (capabilityRef) {
        case FRAME: result = await port.extractFrames({sourceHandle:input.physicalMaterialReadHandleOrWorkspaceMaterialHandle,
          samplingPlan:input.samplingPlan, outputTarget:input.workspaceArtifactOutputTarget}); break;
        case EMBED: result = await port.computeEmbeddings({frameArtifactSet:exactResult(options, frames, FRAME).result, faceModelRef:input.faceModelRef}); break;
        case CLUSTER: result = await port.computeClusters({faceEmbeddingSetHandle:input.faceEmbeddingSetHandle, clusterParameters:input.clusterParameters}); break;
        case MATCH: result = await port.matchReferences({faceClusterSetHandle:input.faceClusterSetHandle, personReferenceProjectionList:input.personReferenceProjectionList}); break;
      }
      const digest = canonicalDigest(result), id = canonicalDigest({eventId:context.eventId, digest}).slice(0, 40);
      return Object.freeze({kind:'succeeded', resultSchemaRef:resultRef(capabilityRef), result,
        evidenceSchemaRef:resultRef(capabilityRef).replace(/\/result$/, '/evidence'),
        evidence:{evidenceId:'us-adult-analysis-evidence-' + id, evidenceKind:'us_adult_analysis', producerRef:capabilityRef,
          basisDigest:basis.basisDigest, payloadDigest:digest, observedAtMs:now()},
        ...(EFFECTS[capabilityRef] === 'workspace_write' ? {effectReceipt:{schemaRef:'helix://contracts/types/EffectReceipt/v1', schemaVersion:1,
          effectReceiptId:'us-adult-analysis-effect-' + id, effectId:canonicalDigest(['workspace_write', context.idempotencyKey]),
          effectClass:'workspace_write', idempotencyKey:context.idempotencyKey, commitMarker:'us-adult-analysis-marker-' + id,
          externalReceiptRef:null, outputDigest:digest, verificationEvidenceDigest:digest, committedAtMs:now()}} : {})});
    },
    validateResult(context, outcome) {
      const {basis} = state(context), result = outcome.result;
      if (capabilityRef === MATCH) {
        if (result.matches.length > 1 || result.matches.some(item => item.faceModelRefDigest !== basis.faceModelRef.digest ||
          item.referenceModelRefDigest !== basis.referenceModelRefDigest || item.score < item.threshold)) throw new Error('US Adult matching must publish one highest valid actor per page.');
      } else if (result.libraRunId !== basis.libraRunId || result.workspaceId !== basis.workspaceId ||
          [EMBED, CLUSTER].includes(capabilityRef) && result.faceModelRefDigest !== basis.faceModelRef.digest) {
        throw new Error('US Adult analysis Result crossed its Run, Workspace or frozen CPU model.');
      }
    },
  })]));
  return Object.freeze(ports);
}
function createUsAdultAnalysisCapabilityRegistrations({manifests, ports}) {
  return Object.freeze(Object.keys(manifests).map(capabilityRef => {
    const manifest = manifests[capabilityRef], port = ports[capabilityRef];
    if (!EFFECTS[capabilityRef] || manifest.effectClass !== EFFECTS[capabilityRef] || !port) throw new TypeError('US Adult Capability registration differs from its frozen Effect class.');
    return Object.freeze({manifest, executor:{version:1, execute:context => port.execute(context)}, semanticValidator:{ref:manifest.semanticValidatorRef,
      validateInputs:context => port.validateInputs(context), validateResult:(context, outcome) => port.validateResult(context, outcome)}});
  }));
}
module.exports = Object.freeze({EFFECTS, createUsAdultAnalysisCapabilityPorts, createUsAdultAnalysisCapabilityRegistrations});
