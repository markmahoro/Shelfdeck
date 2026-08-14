'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const {
  buildProductMediaVerification,
  buildTranscodeInputVerification,
  buildWorkspaceMediaHandle,
  selectProductOutput,
} = require('../model/media-production-contracts');
const { evaluateProductConformance } = require('../model/product-conformance');

const BASE = 'helix://contracts/capabilities/';

function stable(prefix, value) {
  return prefix + canonicalDigest(value).slice(0, 40);
}

function evidence(capabilityRef, basisDigest, result, observedAtMs) {
  return Object.freeze({
    evidenceId: stable('libra-production-evidence-', {
      capabilityRef,
      basisDigest,
      resultDigest: canonicalDigest(result),
    }),
    evidenceKind: 'libra_production_capability_result',
    producerRef: capabilityRef,
    basisDigest,
    payloadDigest: canonicalDigest(result),
    observedAtMs,
  });
}

function succeeded(capabilityRef, result, observedAtMs, effectReceipt = null) {
  const basisDigest = canonicalDigest({
    schema: 'libra.production-capability-result-basis@1',
    capabilityRef,
    result,
  });
  return Object.freeze({
    kind: 'succeeded',
    resultSchemaRef: BASE + capabilityRef.replace('@1', '/v1/result'),
    result,
    evidenceSchemaRef: BASE + capabilityRef.replace('@1', '/v1/evidence'),
    evidence: evidence(capabilityRef, basisDigest, result, observedAtMs),
    ...(effectReceipt ? { effectReceipt } : {}),
  });
}

function requireNamed(context, names) {
  for (const name of names) {
    if (!context?.namedInputs || !Object.hasOwn(context.namedInputs, name)) {
      throw new TypeError('Libra production Capability input is absent: ' + name);
    }
  }
}

function effectReceipt(context, receipt, result, effectClass, now) {
  if (!receipt || typeof receipt !== 'object') {
    throw new TypeError('Libra media Effect did not return a receipt.');
  }
  const value = {
    schemaRef: 'helix://contracts/types/EffectReceipt/v1',
    schemaVersion: 1,
    effectReceiptId: receipt.effectReceiptId || stable('libra-media-effect-receipt-', {
      eventId: context.eventId,
      idempotencyKey: context.idempotencyKey,
    }),
    effectId: canonicalDigest([effectClass, context.idempotencyKey]),
    effectClass,
    idempotencyKey: context.idempotencyKey,
    commitMarker: receipt.commitMarker || stable('libra-media-effect-marker-', {
      eventId: context.eventId,
      outputDigest: canonicalDigest(result),
    }),
    externalReceiptRef: receipt.externalReceiptRef || null,
    outputDigest: canonicalDigest(result),
    verificationEvidenceDigest: receipt.verificationEvidenceDigest ||
      receipt.effectReceiptDigest || canonicalDigest(receipt),
    committedAtMs: receipt.committedAtMs || now(),
  };
  return Object.freeze(value);
}

function createMediaProductionCapabilityPorts(options) {
  const now = options?.now || Date.now;
  if (!options?.mediaEffectPort ||
      typeof options.mediaEffectPort.executeRemux !== 'function' ||
      typeof options.mediaEffectPort.executeTranscode !== 'function' ||
      typeof options.mediaEffectPort.verifyTranscodeInput !== 'function' ||
      typeof options.mediaEffectPort.verifyPlayback !== 'function' ||
      typeof options.resolveProductionSourceScope !== 'function') {
    throw new TypeError('Libra media Capability ports require typed media Effect and source-scope ports.');
  }

  const ports = {
    'libra.transcode.input.verify@1': {
      validateInputs(context) {
        requireNamed(context, ['physicalMaterialReadHandleOrWorkspaceMaterialHandle', 'mediaProbeEvidence',
          'encodeIntent', 'mediaExecutionDeviceSnapshot']);
      },
      async execute(context) {
        const input = context.namedInputs;
        const primary=(input.mediaProbeEvidence.videoStreams||[]).filter((item)=>item.dispositionDefault===true);
        const streams=primary.length?primary:(input.mediaProbeEvidence.videoStreams||[]).slice(0,1);
        const pipeline=(input.mediaExecutionDeviceSnapshot.capabilityPayload?.validatedVideoPipelines||[]).find((item)=>
          item.pipelineProfileId===input.encodeIntent.video.pipelineProfileId);
        const structurallyCompatible=Boolean(pipeline)&&
          (input.mediaExecutionDeviceSnapshot.capabilityPayload?.supportedRateControlModes||[]).includes(input.encodeIntent.video.rateControlMode)&&
          (input.encodeIntent.video.dynamicRangeOperation!=='tone_map_to_sdr_bt709'||streams.every((stream)=>
            stream.dynamicRangeKind==='dolby_vision'&&stream.dolbyVision?.blPresent&&stream.dolbyVision?.baseLayerKind==='pq_bt2020_compatible'));
        const preflight=structurallyCompatible?await options.mediaEffectPort.verifyTranscodeInput({
          sourceHandle:input.physicalMaterialReadHandleOrWorkspaceMaterialHandle,sourceProbeEvidence:input.mediaProbeEvidence,
          productionIntent:input.encodeIntent,deviceSnapshot:input.mediaExecutionDeviceSnapshot,
        }):Object.freeze({sampleCount:0,passedSampleCount:0,reasonCode:null,
          preflightDigest:canonicalDigest({schema:'libra.preflight-not-executed@1',intentDigest:input.encodeIntent.intentDigest})});
        const result = buildTranscodeInputVerification({
          sourceHandle: input.physicalMaterialReadHandleOrWorkspaceMaterialHandle,
          probeEvidence: input.mediaProbeEvidence,
          encodeIntent: input.encodeIntent,
          deviceSnapshot: input.mediaExecutionDeviceSnapshot,
          preflight,
          verifiedAtMs: now(),
        });
        return succeeded('libra.transcode.input.verify@1', result, now());
      },
      validateResult(_context, outcome) {
        if (!outcome?.result?.verificationId) throw new TypeError('Transcode input verification is absent.');
      },
    },
    'libra.media.remux@1': {
      validateInputs(context) {
        requireNamed(context, ['productionSourceScopeReference', 'remuxIntent', 'workspaceMediaOutputTarget']);
      },
      async execute(context) {
        const input = context.namedInputs;
        if (input.remuxIntent.sourceHandleDigest !== input.productionSourceScopeReference.sourceReferenceDigest) {
          throw new TypeError('Remux Intent does not bind the frozen Production Source Scope.');
        }
        const source = await options.resolveProductionSourceScope(input.productionSourceScopeReference);
        const receipt = await options.mediaEffectPort.executeRemux(Object.freeze({
          sourceScopeReference: input.productionSourceScopeReference,
          source,
          productionIntent: input.remuxIntent,
          outputTarget: input.workspaceMediaOutputTarget,
          producingEventId: context.eventId,
          idempotencyKey: context.idempotencyKey,
          runtimeEffectAuthority:Object.freeze({ effectClass:'workspace_write',
            eventAttemptId:context.eventAttemptId, idempotencyKey:context.idempotencyKey }),
        }));
        if (receipt.outputTargetId !== input.workspaceMediaOutputTarget.targetId ||
            receipt.outputTargetDigest !== input.workspaceMediaOutputTarget.targetDigest ||
            receipt.effectScopeDigest !== input.workspaceMediaOutputTarget.effectScopeDigest) {
          throw new TypeError('Remux Effect receipt does not bind the frozen output target.');
        }
        const result = buildWorkspaceMediaHandle({
          sourceHandle: source.primaryReadHandle,
          outputTarget: input.workspaceMediaOutputTarget,
          workspaceMaterialHandle: receipt.workspaceMaterialHandle,
          productionIntentKind: 'remux',
          productionIntent: input.remuxIntent,
          deviceSnapshot: null,
          producingEventId: context.eventId,
          effectReceipt: receipt,
        });
        return succeeded('libra.media.remux@1', result, now(),
          effectReceipt(context, receipt, result, 'workspace_write', now));
      },
      validateResult(_context, outcome) {
        if (!outcome?.result?.workspaceMediaHandleId) throw new TypeError('Remux Workspace output is absent.');
      },
    },
    'libra.media.transcode@1': {
      validateInputs(context) {
        requireNamed(context, ['materialHandle', 'encodeIntent', 'mediaExecutionDeviceSnapshot',
          'transcodeInputVerification', 'workspaceMediaOutputTarget']);
      },
      async execute(context) {
        const input = context.namedInputs;
        if (input.transcodeInputVerification.result !== 'passed') {
          throw new TypeError('Transcode requires a passed input verification.');
        }
        const receipt = await options.mediaEffectPort.executeTranscode(Object.freeze({
          sourceHandle: input.materialHandle,
          productionIntent: input.encodeIntent,
          deviceSnapshot: input.mediaExecutionDeviceSnapshot,
          transcodeInputVerification: input.transcodeInputVerification,
          outputTarget: input.workspaceMediaOutputTarget,
          producingEventId: context.eventId,
          idempotencyKey: context.idempotencyKey,
          runtimeEffectAuthority:Object.freeze({ effectClass:'workspace_write',
            eventAttemptId:context.eventAttemptId, idempotencyKey:context.idempotencyKey }),
        }));
        if (receipt.outputTargetId !== input.workspaceMediaOutputTarget.targetId ||
            receipt.outputTargetDigest !== input.workspaceMediaOutputTarget.targetDigest ||
            receipt.effectScopeDigest !== input.workspaceMediaOutputTarget.effectScopeDigest) {
          throw new TypeError('Transcode Effect receipt does not bind the frozen output target.');
        }
        const result = buildWorkspaceMediaHandle({
          sourceHandle: input.materialHandle,
          outputTarget: input.workspaceMediaOutputTarget,
          workspaceMaterialHandle: receipt.workspaceMaterialHandle,
          productionIntentKind: 'encode',
          productionIntent: input.encodeIntent,
          deviceSnapshot: input.mediaExecutionDeviceSnapshot,
          producingEventId: context.eventId,
          effectReceipt: receipt,
        });
        return succeeded('libra.media.transcode@1', result, now(),
          effectReceipt(context, receipt, result, 'workspace_write', now));
      },
      validateResult(_context, outcome) {
        if (!outcome?.result?.workspaceMediaHandleId) throw new TypeError('Transcode Workspace output is absent.');
      },
    },
    'libra.product_media.verify@1': {
      validateInputs(context) { requireNamed(context, ['productMediaCandidateInput']); },
      async execute(context) {
        const input=context.namedInputs.productMediaCandidateInput;
        const playbackVerification=input.candidateKind==='workspace_output'&&
          input.workspaceMediaHandle.productionVideoProfile?.dynamicRangeOperation==='tone_map_to_sdr_bt709'
          ?await options.mediaEffectPort.verifyPlayback({workspaceMediaHandle:input.workspaceMediaHandle,
            outputProbeEvidence:input.outputProbeEvidence}):undefined;
        const result = buildProductMediaVerification({ input,playbackVerification, verifiedAtMs:now() });
        return succeeded('libra.product_media.verify@1', result, now());
      },
      validateResult(_context, outcome) {
        if (!outcome?.result?.verificationId) throw new TypeError('Product media verification is absent.');
      },
    },
    'libra.product_output.select@1': {
      validateInputs(context) { requireNamed(context, ['productOutputSelectionInput']); },
      execute(context) {
        const result = selectProductOutput({ input:context.namedInputs.productOutputSelectionInput, producedAtMs:now() });
        return succeeded('libra.product_output.select@1', result, now());
      },
      validateResult(_context, outcome) {
        if (!outcome?.result?.draftId) throw new TypeError('Selected Product output is absent.');
      },
    },
    'libra.product.conformance.verify@1': {
      validateInputs(context) { requireNamed(context, ['productConformanceInputSnapshot']); },
      execute(context) {
        const result = evaluateProductConformance({ input:context.namedInputs.productConformanceInputSnapshot, verifiedAtMs:now() });
        return succeeded('libra.product.conformance.verify@1', result, now());
      },
      validateResult(_context, outcome) {
        if (!outcome?.result?.verificationId) throw new TypeError('Product conformance Evidence is absent.');
      },
    },
  };
  return Object.freeze(Object.fromEntries(Object.entries(ports).map(([key, value]) => [key, Object.freeze(value)])));
}

module.exports = Object.freeze({ createMediaProductionCapabilityPorts });
