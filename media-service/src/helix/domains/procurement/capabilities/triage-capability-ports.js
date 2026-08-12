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
    sizeBytes:Number(raw.sizeBytes ?? handle.sizeBytes ??
      handle.physicalIdentity?.sizeBytes ?? handle.expectedSizeBytes),
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

function normalizedRelative(value) { return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').toUpperCase(); }

async function assessBdmv(input, options) {
  const scope = input && input.__bdmvScope;
  if (!scope || !scope.rootLocation || !Array.isArray(scope.members)) {
    throw new TypeError('BDMV Assessment requires a runtime-resolved frozen container scope.');
  }
  const expectedScopeDigest = canonicalDigest({ schema:'procurement.bdmv-scope@1', runId:input.runId, bdmvGroupKey:input.bdmvGroupKey,
    accessRevision:Number(input.accessRevision), memberSetDigest:input.memberSetDigest });
  if (expectedScopeDigest !== input.scopeDigest) throw new TypeError('BDMV Assessment scope digest is inconsistent.');
  const topologyReader = options.bdmvTopologyReader || options.mediaProbe.bdmvTopologyReader;
  if (!topologyReader || typeof topologyReader.inspect !== 'function') throw new TypeError('BDMV topology reader is unavailable.');
  const topology = await topologyReader.inspect(scope.rootLocation, {
    memberSetDigest:input.memberSetDigest,
    members:scope.members,
  });
  const base = { schemaRef:'helix://contracts/types/BdmvAssessmentEvidence/v1', schemaVersion:1,
    evidenceKind:'bdmv_assessment', producerRef:'procurement.triage.bdmv.assess@1', observedAtMs:options.now(),
    runId:input.runId, bdmvGroupKey:input.bdmvGroupKey, scopeDigest:input.scopeDigest, memberSetDigest:input.memberSetDigest,
    resultKind:'not_ready', discKind:'bdmv', titleCount:Number(topology?.titleCount || 0), selectedPlaylist:null, selectedClipIds:[],
    topologyDigest:topology?.topologyDigest || canonicalDigest({ schema:'procurement.bdmv-missing-topology@1', scopeDigest:input.scopeDigest }),
    selectedPayloadSetDigest:canonicalDigest({ schema:'procurement.bdmv-selected-payload-set@1', items:[] }), memberCount:scope.members.length,
    mediaSummary:{ probeState:'not_available', durationMs:0, videoClasses:[], audioClasses:[], subtitleClasses:[] }, evidenceDigest:'' };
  const finish = (value) => {
    value.basisDigest = canonicalDigest({ runId:value.runId, bdmvGroupKey:value.bdmvGroupKey, scopeDigest:value.scopeDigest, memberSetDigest:value.memberSetDigest });
    value.evidenceId = 'bdmv-assessment-evidence-' + canonicalDigest({ basis:value.basisDigest, topologyDigest:value.topologyDigest }).slice(0, 40);
    value.payloadDigest = '';
    value.evidenceDigest = canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key]) => !['payloadDigest','evidenceDigest'].includes(key))));
    value.payloadDigest = canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'payloadDigest')));
    return Object.freeze(value);
  };
  if (!topology) return finish({ ...base, reasonCode:'bdmv_topology_unavailable' });
  if (input.profileHint === 'series' || input.profileHint === 'jav' || input.profileHint === 'western_adult') {
    return finish({ ...base, titleCount:Number(topology.titleCount), selectedPlaylist:topology.selectedPlaylist || null,
      selectedClipIds:Object.freeze(topology.selectedPlaylist?.clipIds || []), reasonCode:'bdmv_series_unsupported' });
  }
  const selectedMembers = (topology.members || []).filter((member) => member.role === 'primary_payload');
  const handlesByRelative = new Map(scope.members.map((member) => [normalizedRelative(String(member.relativeLocation).replace(/^.*?\/BDMV\//i, '')), member.readHandle]));
  const primaryResults = [];
  for (const member of selectedMembers) {
    const handle = handlesByRelative.get(normalizedRelative(member.relativeLocation));
    if (!handle) return finish({ ...base, titleCount:Number(topology.titleCount), selectedPlaylist:topology.selectedPlaylist || null,
      selectedClipIds:Object.freeze(topology.selectedPlaylist?.clipIds || []), reasonCode:'bdmv_missing_dependency' });
    primaryResults.push(await options.mediaProbe.probe(handle));
  }
  const firstFailure = primaryResults.find((result) => result.resultKind !== 'probed' || !Array.isArray(result.videoStreams) || !result.videoStreams.length ||
    !Number.isFinite(result.durationMs) || result.durationMs <= 0);
  const selectedKeys = selectedMembers.map((member) => {
    const handle = handlesByRelative.get(normalizedRelative(member.relativeLocation));
    return handle?.identity?.materialKey || member.relativeLocation;
  }).sort();
  const mediaSummary = { probeState:firstFailure ? 'not_media' : 'probed', durationMs:primaryResults.reduce((sum, result) => sum + Number(result.durationMs || 0), 0),
    videoClasses:[...new Set(primaryResults.flatMap((result) => (result.videoStreams || []).map((stream) => stream.codec || 'unknown')))].sort(),
    audioClasses:[...new Set(primaryResults.flatMap((result) => (result.audioStreams || []).map((stream) => stream.normalizedAudioClass || stream.codec || 'other')))].sort(),
    subtitleClasses:[...new Set(primaryResults.flatMap((result) => (result.subtitleStreams || []).map((stream) => stream.codec || 'unknown')))].sort() };
  const selectedPayloadSetDigest = canonicalDigest({ schema:'procurement.bdmv-selected-payload-set@1', items:selectedKeys });
  return finish({ ...base, resultKind:firstFailure ? 'not_ready' : 'resolved', titleCount:Number(topology.titleCount),
    selectedPlaylist:topology.selectedPlaylist || null, selectedClipIds:Object.freeze(topology.selectedPlaylist?.clipIds || []),
    selectedPayloadSetDigest, mediaSummary, ...(firstFailure ? { reasonCode:'bdmv_missing_dependency' } : {}) });
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
    'procurement.triage.bdmv.assess@1':pure('procurement.triage.bdmv.assess@1', ({ bdmvAssessmentInput }) =>
      assessBdmv(bdmvAssessmentInput, options)),
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
          outputDigest:canonicalDigest(result),verificationEvidenceDigest:commitDigest,committedAtMs:result.committedAtMs});
        const envelope=Object.freeze({evidenceId:'candidate-publication-evidence-'+canonicalDigest(result).slice(0,40),
          evidenceKind:'candidate_publication',producerRef:'procurement.candidate.publish@1',basisDigest:draft.draftDigest,
          payloadDigest:canonicalDigest(structureEvidence),observedAtMs:result.committedAtMs});
        return Object.freeze({kind:'succeeded',resultSchemaRef:BASE+'procurement.candidate.publish/v1/result',result,
          evidenceSchemaRef:BASE+'procurement.candidate.publish/v1/evidence',evidence:envelope,effectReceipt});},
      validateResult(context,outcome){if(outcome.result.candidatePackageId!==context.namedInputs.candidateDraft.candidatePackageId)throw new TypeError('Candidate publication Result drifted.');},
    }),
  });
}

module.exports = Object.freeze({ createTriageCapabilityPorts });
