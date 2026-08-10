'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { inspectPlayability, inspectStructure, resolveIdentity,
  buildPrimaryManifestDraft } = require('../model/triage-contracts');
const { createCandidatePublicationStore } = require('../persistence/candidate-publication-store');

const BASE = 'helix://contracts/capabilities/';

function evidence(value) {
  return Object.freeze({ evidenceId:value.evidenceId, evidenceKind:value.evidenceKind,
    producerRef:value.producerRef, basisDigest:value.basisDigest,
    payloadDigest:value.payloadDigest, observedAtMs:value.observedAtMs });
}

function outcome(capabilityRef, result) {
  const typedEvidence=result.evidenceId?evidence(result):Object.freeze({
    evidenceId:'capability-evidence-'+canonicalDigest({capabilityRef,result}).slice(0,40),evidenceKind:'derived_draft',
    producerRef:capabilityRef,basisDigest:result.basisDigest||canonicalDigest(result),payloadDigest:canonicalDigest(result),
    observedAtMs:Number(result.producedAtMs||0),
  });
  return Object.freeze({ kind:'succeeded', resultSchemaRef:BASE + capabilityRef.replace('@1', '/v1/result'), result,
    evidenceSchemaRef:BASE + capabilityRef.replace('@1', '/v1/evidence'), evidence:typedEvidence });
}

function mediaEvidence(raw, handle, nowMs) {
  const value = {
    schemaRef:'helix://contracts/types/MediaProbeEvidence/v1', schemaVersion:1,
    evidenceId:'media-probe-evidence-' + canonicalDigest({ handle, raw }).slice(0, 40),
    evidenceKind:'media_probe', producerRef:'shared.material.media.probe@1',
    basisDigest:canonicalDigest(handle), payloadDigest:'', observedAtMs:nowMs,
    sourceHandleDigest:canonicalDigest(handle), resultKind:raw.resultKind,
    ...(raw.resultKind === 'not_media' ? { reasonCode:'probe_not_media' } : {
      container:raw.container || 'unknown', durationMs:Number(raw.durationMs || 0),
    }),
    sizeBytes:Number(raw.sizeBytes ?? handle.expectedSizeBytes),
    videoStreams:Object.freeze((raw.videoStreams || []).map((stream) => {
      const width = Number(stream.codedWidth || stream.width || 1), height = Number(stream.codedHeight || stream.height || 1);
      const rotation = Number(stream.rotation || 0), rotated = Math.abs(rotation) % 180 === 90;
      const displayWidth = Number(stream.displayWidth || (rotated ? height : width));
      const displayHeight = Number(stream.displayHeight || (rotated ? width : height));
      return Object.freeze({ streamIndex:Number(stream.streamIndex), dispositionDefault:Boolean(stream.dispositionDefault),
        codec:stream.codec || 'unknown', codedWidth:width, codedHeight:height,
        sampleAspectRatio:stream.sampleAspectRatio || '1:1', rotation, displayWidth, displayHeight,
        longEdge:Math.max(displayWidth, displayHeight), shortEdge:Math.min(displayWidth, displayHeight) });
    })),
    audioStreams:Object.freeze((raw.audioStreams || []).map((stream) => Object.freeze({
      streamIndex:Number(stream.streamIndex), dispositionDefault:Boolean(stream.dispositionDefault), codec:stream.codec || 'unknown',
      profile:stream.profile || 'unknown', channels:Math.max(1, Number(stream.channels || 1)),
      channelLayout:stream.channelLayout || 'unknown', formatTags:Object.freeze(stream.formatTags || []),
      normalizedAudioClass:stream.normalizedAudioClass || 'other', ...(stream.language ? { language:stream.language } : {}),
    }))),
    subtitleStreams:Object.freeze((raw.subtitleStreams || []).map((stream) => Object.freeze({
      streamIndex:Number(stream.streamIndex), codec:stream.codec || 'unknown', ...(stream.language ? { language:stream.language } : {}),
      ...(stream.title ? { title:stream.title } : {}),
    }))),
    ...(raw.discTopology ? { discTopology:raw.discTopology } : {}),
  };
  value.payloadDigest = canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'payloadDigest')));
  return Object.freeze(value);
}

function createTriageCapabilityPorts(options) {
  if (!options?.mediaProbe || typeof options.now !== 'function') {
    throw new TypeError('Triage Capability ports require typed read-only integrations.');
  }
  const publicationStore=createCandidatePublicationStore(options);
  const pure = (ref, execute) => Object.freeze({
    validateInputs(context) { if (!context?.namedInputs) throw new TypeError(ref + ' inputs are required.'); },
    async execute(context) { return outcome(ref, await execute(context.namedInputs)); },
    validateResult(_context, value) { if (value.result.payloadDigest && value.result.payloadDigest !== canonicalDigest(
      Object.fromEntries(Object.entries(value.result).filter(([key]) => key !== 'payloadDigest')))) {
      throw new TypeError(ref + ' payload digest is inconsistent.');
    } },
  });
  return Object.freeze({
    'shared.material.media.probe@1':pure('shared.material.media.probe@1', async ({ physicalMaterialReadHandleOrWorkspaceMaterialHandle:handle }) =>
      mediaEvidence(await options.mediaProbe.probe(handle), handle, options.now())),
    'procurement.triage.playability.inspect@1':pure('procurement.triage.playability.inspect@1', ({ triageMaterialProbeBatch, procurementTriageRuleSnapshot }) =>
      inspectPlayability(triageMaterialProbeBatch, procurementTriageRuleSnapshot, { observedAtMs:options.now() })),
    'procurement.triage.structure.inspect@1':pure('procurement.triage.structure.inspect@1', ({ triageStructureInspectionInput, procurementTriageRuleSnapshot }) =>
      inspectStructure(triageStructureInspectionInput, procurementTriageRuleSnapshot, { observedAtMs:options.now() })),
    'procurement.triage.identity_claim.resolve@1':pure('procurement.triage.identity_claim.resolve@1', ({ triageIdentityResolutionInput, procurementTriageRuleSnapshot }) =>
      resolveIdentity(triageIdentityResolutionInput, procurementTriageRuleSnapshot, { producedAtMs:options.now() })),
    'procurement.triage.primary_manifest.build@1':pure('procurement.triage.primary_manifest.build@1', ({ triageManifestBuildInput, procurementTriageRuleSnapshot }) =>
      buildPrimaryManifestDraft(triageManifestBuildInput, procurementTriageRuleSnapshot, { producedAtMs:options.now() })),
    'procurement.candidate.publish@1':Object.freeze({
      validateInputs(context){if(!context.namedInputs?.candidateDraft||!context.namedInputs?.domainFactCommitHandle)throw new TypeError('Candidate publication inputs are incomplete.');},
      execute(context){const draft=context.namedInputs.candidateDraft,handle=context.namedInputs.domainFactCommitHandle;
        const marker='candidate-marker-'+canonicalDigest({draftId:draft.draftId,draftDigest:draft.draftDigest}).slice(0,40);
        const effectId=canonicalDigest(['domain_fact_commit',context.idempotencyKey]);
        const commitDigest=canonicalDigest({schema:'procurement.candidate-publication-commit@1',draftDigest:draft.draftDigest});
        const effectReceiptId='candidate-effect-receipt-'+context.eventAttemptId;
        const structureEvidence=Object.freeze({schemaRef:'helix://contracts/types/TriageStructureEvidence/v1',schemaVersion:1,
          evidenceId:draft.structureEvidence.evidenceId,payloadDigest:draft.structureEvidence.payloadDigest});
        const committed=publicationStore.publish({candidateDraft:draft,domainFactCommitHandle:handle,
          commitMarker:Object.freeze({commitMarker:marker,effectId,commitDigest}),
          resultBinding:Object.freeze({resultId:'candidate-result-'+canonicalDigest({eventId:context.eventId}).slice(0,40),eventId:context.eventId,
            evidenceSchemaRef:'helix://contracts/types/TriageStructureEvidence/v1',evidence:structureEvidence,effectReceiptId})});
        const result=committed.typedResult;
        const effectReceipt=Object.freeze({schemaRef:'helix://contracts/types/EffectReceipt/v1',schemaVersion:1,
          effectReceiptId,effectId,effectClass:'domain_fact_commit',
          idempotencyKey:context.idempotencyKey,commitMarker:committed.commitMarker,externalReceiptRef:null,
          outputDigest:canonicalDigest(result),verificationEvidenceDigest:commitDigest,committedAtMs:result.publishedAtMs});
        const envelope=Object.freeze({evidenceId:'candidate-publication-evidence-'+canonicalDigest(result).slice(0,40),
          evidenceKind:'candidate_publication',producerRef:'procurement.candidate.publish@1',basisDigest:draft.draftDigest,
          payloadDigest:canonicalDigest(structureEvidence),observedAtMs:result.publishedAtMs});
        return Object.freeze({kind:'succeeded',resultSchemaRef:BASE+'procurement.candidate.publish/v1/result',result,
          evidenceSchemaRef:BASE+'procurement.candidate.publish/v1/evidence',evidence:envelope,effectReceipt});},
      validateResult(context,outcome){if(outcome.result.candidatePackageId!==context.namedInputs.candidateDraft.candidatePackageId)throw new TypeError('Candidate publication Result drifted.');},
    }),
  });
}

module.exports = Object.freeze({ createTriageCapabilityPorts });
