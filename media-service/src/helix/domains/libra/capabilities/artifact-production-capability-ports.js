'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { buildArtifactManifestVerification } = require('../model/product-fact-contracts');
const { workspaceId } = require('../model/workspace-admission-contracts');

const ACQUIRE = 'libra.product_artifact.acquire@1';
const SIDECAR = 'libra.product_sidecar.render@1';
const VERIFY = 'shared.artifact.manifest.verify@1';

function requireNamed(context, names) {
  for (const name of names) if (!context?.namedInputs || !Object.hasOwn(context.namedInputs, name)) {
    throw new TypeError('Artifact production Capability input is absent: ' + name);
  }
}

function evidence(capabilityRef, result, observedAtMs) {
  return Object.freeze({
    evidenceId: 'libra-artifact-evidence-' + canonicalDigest({ capabilityRef, result }).slice(0, 40),
    evidenceKind: 'artifact_production_result',
    producerRef: capabilityRef,
    basisDigest: canonicalDigest({ schema:'libra.artifact-capability-basis@1', capabilityRef, result }),
    payloadDigest: canonicalDigest(result),
    observedAtMs,
  });
}

function effectReceipt(context, result, now) {
  const outputDigest = canonicalDigest(result);
  const effectId = canonicalDigest(['workspace_write', context.idempotencyKey]);
  return Object.freeze({
    schemaRef: 'helix://contracts/types/EffectReceipt/v1',
    schemaVersion: 1,
    effectReceiptId: 'libra-artifact-effect-' + canonicalDigest({ eventId:context.eventId }).slice(0, 40),
    effectId,
    effectClass: 'workspace_write',
    idempotencyKey: context.idempotencyKey,
    commitMarker: 'libra-artifact-marker-' + canonicalDigest({ eventId:context.eventId, outputDigest }).slice(0, 40),
    externalReceiptRef: null,
    outputDigest,
    verificationEvidenceDigest: outputDigest,
    committedAtMs: now(),
  });
}

function succeeded(capabilityRef, result, now, withEffect) {
  return Object.freeze({
    kind: 'succeeded',
    resultSchemaRef: 'helix://contracts/capabilities/' + capabilityRef.replace('@1', '/v1/result'),
    result,
    evidenceSchemaRef: 'helix://contracts/capabilities/' + capabilityRef.replace('@1', '/v1/evidence'),
    evidence: evidence(capabilityRef, result, now()),
    ...(withEffect ? { effectReceipt:withEffect } : {}),
  });
}

function createArtifactProductionCapabilityPorts(options) {
  if (!options?.productProductionPort || !options.movieProductionReader) {
    throw new TypeError('Artifact production requires Product and Libra Owner ports.');
  }
  const now = options.now || Date.now;
  const ports = {
    [ACQUIRE]: Object.freeze({
      validateInputs(context) { requireNamed(context, ['productMetadataDraft', 'integrationHandle']); },
      async execute(context) {
        const draft = context.namedInputs.productMetadataDraft;
        const handle = context.namedInputs.integrationHandle;
        const artifactKind = context.parameters?.artifactKind;
        const snapshot = typeof options.movieProductionReader.readRunSnapshot === 'function'
          ? options.movieProductionReader.readRunSnapshot(context.ownerScope.processId)
          : options.movieProductionReader.readRun(context.ownerScope.processId);
        const related = snapshot?.relatedReferences?.find((item) => item.role === artifactKind);
        const runtimeEffectAuthority = Object.freeze({
          effectClass:'workspace_write',
          eventAttemptId:context.eventAttemptId,
          idempotencyKey:context.idempotencyKey,
        });
        if (related) {
          const result = options.productProductionPort.materializeRelatedArtifact({
            libraRunId: context.ownerScope.processId,
            workspaceId: workspaceId(context.ownerScope.processId),
            relativePath: 'product/' + artifactKind + '.jpg',
            artifactKind,
            reference: related,
            productMetadataDraft: draft,
            runtimeEffectAuthority,
          });
          return succeeded(ACQUIRE, result, now, effectReceipt(context, result, now));
        }
        const metadata = draft.fieldProvenance.find((item) => item.sourceKind === 'provider');
        const provenance = metadata
          ? Object.freeze({ objectId: metadata.sourceRef, digest: metadata.evidenceDigest })
          : Object.freeze({ objectId: draft.draftId, digest: draft.draftDigest });
        if (!provenance.objectId || !provenance.digest) {
          throw new TypeError('Provider Artifact acquisition lacks a frozen identity or Draft provenance.');
        }
        const result = await options.productProductionPort.acquireProviderArtifact({
          libraRunId: context.ownerScope.processId,
          workspaceId: workspaceId(context.ownerScope.processId),
          relativePath: 'product/' + artifactKind + '.jpg',
          artifactKind,
          integrationId: handle.integrationId,
          configRevision: handle.configRevision,
          integrationHandle: handle,
          productMetadataDraft: draft,
          metadataObservationId: provenance.objectId,
          metadataObservationDigest: provenance.digest,
          runtimeEffectAuthority,
        });
        return succeeded(ACQUIRE, result, now, effectReceipt(context, result, now));
      },
      validateResult(_context, outcome) {
        if (!['acquired', 'not_available'].includes(outcome?.result?.resultKind)) {
          throw new TypeError('Artifact Acquisition result is invalid.');
        }
      },
    }),
    [SIDECAR]: Object.freeze({
      validateInputs(context) { requireNamed(context, ['productMetadataDraft', 'mediaCastDraft', 'sidecarProfile']); },
      execute(context) {
        const snapshot = typeof options.movieProductionReader.readRunSnapshot === 'function'
          ? options.movieProductionReader.readRunSnapshot(context.ownerScope.processId)
          : options.movieProductionReader.readRun(context.ownerScope.processId);
        const relatedNfo = snapshot?.relatedReferences?.find((item) => item.role === 'nfo') || null;
        const contentProfile = snapshot?.spec?.contentProfile || 'movie';
        const result = options.productProductionPort.renderProductSidecar({
          productMetadataDraft: context.namedInputs.productMetadataDraft,
          mediaCastDraft: context.namedInputs.mediaCastDraft,
          sidecarProfile: context.namedInputs.sidecarProfile,
          libraRunId: context.ownerScope.processId,
          workspaceId: workspaceId(context.ownerScope.processId),
          relativePath: contentProfile === 'series' ? 'product/season.nfo' : 'product/movie.nfo',
          contentProfile,
          relatedReference: relatedNfo,
          runtimeEffectAuthority: Object.freeze({
            effectClass:'workspace_write',
            eventAttemptId:context.eventAttemptId,
            idempotencyKey:context.idempotencyKey,
          }),
        });
        return succeeded(SIDECAR, result, now, effectReceipt(context, result, now));
      },
      validateResult(_context, outcome) {
        if (!outcome?.result?.artifactHandleId || outcome.result.artifactKind !== 'nfo') {
          throw new TypeError('Rendered Product Sidecar is invalid.');
        }
      },
    }),
    [VERIFY]: Object.freeze({
      validateInputs(context) { requireNamed(context, ['artifactHandleList', 'artifactRequirement']); },
      execute(context) {
        const result = buildArtifactManifestVerification({
          requirement: context.namedInputs.artifactRequirement,
          artifactHandles: context.namedInputs.artifactHandleList,
          verifiedAtMs: now(),
        });
        return succeeded(VERIFY, result, now, null);
      },
      validateResult(_context, outcome) {
        if (outcome?.result?.result !== 'passed') throw new TypeError('Artifact Manifest verification did not pass.');
      },
    }),
  };
  return Object.freeze(ports);
}

module.exports = Object.freeze({ ACQUIRE, SIDECAR, VERIFY, createArtifactProductionCapabilityPorts });
