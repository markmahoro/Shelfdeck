'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Ajv2020 = require('ajv/dist/2020');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { observeMandatoryMedia } = require('../../src/helix/domains/arca/model/mandatory-media-acceptance');
const { createOnDeckCapabilityPorts } = require('../../src/helix/domains/arca/capabilities/on-deck-capability-ports');
const { CAPABILITY_REFS } = require('../../src/helix/domains/arca/model/on-deck-contract');
const { finalGapDecision } = require('../../src/helix/domains/arca/model/acceptance-gap-decision');
const schemaManifest = require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const acceptanceCheckSchema = require('../../src/helix/contracts/types/AcceptanceCheck/v1/schema.json');
const validateAcceptanceCheck = new Ajv2020({allErrors:true,strict:false})
  .compile(acceptanceCheckSchema);

const D = (value) => canonicalDigest({ value });
const NOW = 10_000;

function physicalIdentity(materialKey = D('material'), inode = '1', bytes = D('bytes')) {
  return Object.freeze({ schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2', schemaVersion:2,
    materialKey, mountScopeId:'mount-1', inode, sizeBytes:100,
    fingerprintAlgorithm:'middle-256k-sha256', fingerprintVersion:1,
    contentFingerprint:bytes });
}

function manifest(runId, codes) {
  const defects = Object.freeze([{ defectCode:'external_source_exhausted',
    waivedRequirementCodes:Object.freeze([...codes]) }]);
  const body = { schemaRef:'helix://contracts/application-types/AuthorizedDefectManifest/v1',
    schemaVersion:1, manifestId:D('manifest'), defectDecisionId:D('manifest'), libraRunId:runId,
    frozenRunRef:Object.freeze({ stateRevision:3 }), decidedAtMs:NOW - 10,
    defects, defectCount:defects.length, waivedRequirementCodes:Object.freeze([...codes]),
    acknowledgement:'accept_listed_defects' };
  return Object.freeze({ ...body, manifestDigest:canonicalDigest(body) });
}

function attestation(packageId, runId, specDigest, authorized = null) {
  const body = { attestationId:'', libraRunId:runId, onDeckPackageId:packageId,
    acceptanceSpecId:'spec-1', acceptanceSpecRecordDigest:specDigest,
    productConformanceEvidenceId:D('conformance-id'), productConformanceEvidenceDigest:D('conformance'),
    evaluatedRequirementSetDigest:D('requirement-set'), productSnapshotDigest:D('snapshot'),
    unmetRequirementCount:authorized?.waivedRequirementCodes.length || 0,
    unmetRequirementCodes:authorized?.waivedRequirementCodes || Object.freeze([]),
    acceptanceKind:authorized?'accepted_with_defects':'accepted', authorizedDefectManifest:authorized,
    attestedAtMs:NOW - 5 };
  body.attestationId=canonicalDigest({schema:'libra.production-attestation-id@1',libraRunId:runId,onDeckPackageId:packageId,
    productConformanceEvidenceId:body.productConformanceEvidenceId,productConformanceEvidenceDigest:body.productConformanceEvidenceDigest});
  return Object.freeze({ ...body, attestationDigest:canonicalDigest(body) });
}

function fixture({ authorized = false, expired = false, workspace = false,
  conversionOperation = workspace ? 'preserve' : 'none',
  sourceDynamicRangeKind = 'hdr10_compatible',
  outputDynamicRangeKind = sourceDynamicRangeKind } = {}) {
  const runId='run-1',packageId=D('package'),specDigest=D('spec'),identity=physicalIdentity(),
    sourceIdentity=workspace?physicalIdentity(D('source-material'),'2',D('source-bytes')):identity,
    location='C:/canary/movie.mkv',sourceLocation=workspace?'C:/canary/source.mkv':location,
    memberBody={ordinal:0,materialKey:identity.materialKey,role:'primary_payload',physicalIdentity:identity,sizeBytes:100,
      location:Object.freeze({locationKind:'domain_binding',endpointId:'endpoint-1',location,rootHandleRef:null,relativePath:null}),
      bindingKind:'libra_material_binding',bindingRevision:1,originCandidateDeliveryRef:null,workspaceReferenceId:null,
      workspaceMaterialHandle:null,admittedControlRevision:1,admittedControlProjectionDigest:D('control'),bindingEvidenceDigest:D('binding'),
      episodeClaims:Object.freeze([]),episodeClaimSetDigest:D('claims'),outputRequirementDigest:D('product-output-requirement')},
    member=Object.freeze({...memberBody,memberDigest:canonicalDigest(memberBody)}),issuedAtMs=expired?NOW-86_400_001:NOW-100,
    expiresAtMs=issuedAtMs+86_400_000;
  const makeHandle=(handleIdentity,handleLocation,readRole)=>{const basis={schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',schemaVersion:1,
    handleId:'',identity:handleIdentity,ownerDomain:'libra',ownerScope:Object.freeze({scopeType:'on_deck_package',scopeId:packageId}),bindingRevision:1,
    endpointId:'endpoint-1',location:handleLocation,mountScopeRevision:1,expectedSizeBytes:100,expectedMtimeNs:1,expectedCtimeNs:1,
    fingerprintVerifiedAtMs:issuedAtMs,readScope:'shelf_acceptance_primary_probe_decode',expiresAtMs,fenceDigest:''};
  basis.handleId=canonicalDigest({schema:'libra.shelf-acceptance-primary-read-handle-id@1',onDeckPackageId:packageId,libraRunId:runId,
    readRole,materialKey:handleIdentity.materialKey,bindingRevision:1,productMemberDigest:member.memberDigest,
    acceptanceSpecRecordDigest:specDigest});
  basis.fenceDigest=canonicalDigest({schema:'libra.shelf-acceptance-primary-read-handle-fence@1',
    ...Object.fromEntries(Object.entries(basis).filter(([key])=>key!=='fenceDigest')),libraRunId:runId,
    runExecutionBasisDigest:D('run-basis'),acceptanceSpecId:'spec-1',acceptanceSpecRecordDigest:specDigest,
    productMemberDigest:member.memberDigest,readRole});return Object.freeze(basis);};
  const sourceHandle=makeHandle(sourceIdentity,sourceLocation,workspace?'source_primary':'source_and_product_primary'),
    productHandle=workspace?makeHandle(identity,location,'product_primary'):sourceHandle,
    verification=Object.freeze({verificationId:D('media-verification'),libraRunId:runId,
      mediaRequirementDigest:D('media-requirement'),candidateKind:workspace?'workspace_output':'direct_input',
      dynamicRangeSummary:Object.freeze({sourceDynamicRangeKind,outputDynamicRangeKind,conversionOperation})}),
    itemBody={ordinal:0,materialKey:member.materialKey,productMemberDigest:member.memberDigest,productMediaVerification:verification,
      productMediaVerificationDigest:canonicalDigest(verification),sourceReadHandle:sourceHandle,sourceReadHandleDigest:canonicalDigest(sourceHandle),
      productReadHandle:productHandle,productReadHandleDigest:canonicalDigest(productHandle),samePhysicalMaterial:!workspace},
    item=Object.freeze({...itemBody,itemDigest:canonicalDigest(itemBody)}),primaryInputs=Object.freeze([item]),
    readBody={schemaRef:'helix://contracts/domain-types/ShelfAcceptancePrimaryReadSet/v1',schemaVersion:1,onDeckPackageId:packageId,
      libraRunId:runId,runExecutionBasisDigest:D('run-basis'),acceptanceSpecId:'spec-1',acceptanceSpecRecordDigest:specDigest,
      issuedAtMs,expiresAtMs,primaryInputs,primaryInputSetDigest:canonicalDigest({schema:'libra.shelf-acceptance-primary-input-set@1',items:primaryInputs})},
    readSet=Object.freeze({...readBody,readAuthorityDigest:canonicalDigest({schema:'libra.shelf-acceptance-primary-read-authority@1',...readBody})}),
    authorizedManifest=authorized?manifest(runId,['video_codec_unmet']):null,productionAttestation=attestation(packageId,runId,specDigest,authorizedManifest),
    snapshotBody={schemaRef:'helix://contracts/domain-types/AcceptanceRequirementSnapshot/v1',schemaVersion:1,
      acceptanceSpecId:'spec-1',acceptanceSpecRecordDigest:specDigest,targetShelfId:'shelf-1',contentProfile:'movie',structureKind:'single',
      shelfStandardRevision:1,shelfStandardDigest:D('standard'),requirements:Object.freeze({
        identity:Object.freeze({identityKind:'tmdb_movie',requiredProvider:'tmdb',requireSeasonNumber:false}),
        structure:Object.freeze({structureKind:'single',primaryModel:'single_primary',requireOnePrimaryPerEpisode:false}),
        metadata:Object.freeze({requiredFieldCodes:Object.freeze([]),requiredArtifactKinds:Object.freeze([]),requireRenderableSidecar:false,requireDecodableImages:false}),
        mandatoryMedia:Object.freeze({mediaForm:'stream_file',videoCodec:'hevc',container:'matroska',fileExtension:'mkv',minimumRasterClass:'none',acceptedPrimaryAudioClasses:Object.freeze([]),forbidSystemUpscaleFor4k:true}),
        space:Object.freeze({unit:'product',maxSizeGiB:null,maxSizeBytes:null}),
        inventory:Object.freeze({requireDomainBinding:true,requireChecksum:true,requiredMaterializedArtifactKinds:Object.freeze([]),layoutModel:'single'})})},
    acceptanceRequirementSnapshot=Object.freeze({...snapshotBody,snapshotDigest:canonicalDigest(snapshotBody)}),
    provenanceBody={libraRunId:runId,runExecutionBasisDigest:D('run-basis'),acceptanceSpecRecordDigest:specDigest,workflowPlanRefs:Object.freeze([]),
      productVerificationRefs:Object.freeze([{verificationId:productionAttestation.productConformanceEvidenceId,
        verificationDigest:productionAttestation.productConformanceEvidenceDigest},{verificationId:verification.verificationId,
        verificationDigest:canonicalDigest(verification)}]),externalRealityObservationRefs:Object.freeze([]),
      acceptanceRequirementSnapshot,shelfAcceptancePrimaryReadSet:readSet},productionProvenance=Object.freeze({...provenanceBody,provenanceDigest:canonicalDigest(provenanceBody)}),
    packageBody={schemaRef:'helix://contracts/types/OnDeckProductPackage/v1',schemaVersion:1,onDeckPackageId:packageId,packageRevision:1,
      libraRunId:runId,runStateRevision:4,runStateDigest:D('run-state'),runExecutionBasisDigest:D('run-basis'),subjectId:'subject-1',shelfId:'shelf-1',
      acceptanceSpecRef:Object.freeze({id:'spec-1',recordDigest:specDigest}),productStructureSnapshot:Object.freeze({structureKind:'single'}),
      productMaterialManifest:Object.freeze({members:Object.freeze([member])}),
      productionProvenance,productionAttestation},packageDigest=canonicalDigest(packageBody),
    packageValue=Object.freeze({...packageBody,manifestDigest:packageDigest,publishedAtMs:NOW-5,packageDigest}),requirementBody={
      schemaRef:'helix://contracts/domain-types/MandatoryRequirement/v1',schemaVersion:1,requirementId:'requirement-1',revision:1,
      shelfId:'shelf-1',shelfStandardRevision:1,shelfStandardDigest:D('standard'),contentProfile:'movie',mediaForm:'stream_file',
      videoCodec:'hevc',container:'matroska',fileExtension:'mkv',minimumRasterClass:'none',acceptedPrimaryAudioClasses:Object.freeze([]),
      maxSizeBytes:null,forbidSystemUpscaleFor4k:true,acceptedOutputDynamicRangeKinds:Object.freeze(['sdr','hdr10_compatible','hlg','dolby_vision','unknown']),
      sdrOutputPixelFormat:'yuv420p',sdrOutputColorProfile:Object.freeze({range:'limited',primaries:'bt709',transfer:'bt709',matrix:'bt709'}),
      forbidDolbyVisionMetadataOnSdr:true,decodeSamplePointsPercent:Object.freeze([5,50,95]),requireAllDecodeSamples:true},
    requirement=Object.freeze({...requirementBody,digest:canonicalDigest(requirementBody)});
  return {packageValue,requirement,identity,sourceIdentity};
}

function ports(identity, codec='h264', outputDynamicRangeKind='hdr10_compatible', sourceDynamicRangeKind=outputDynamicRangeKind, options={}) {
  const probe=(dynamicRangeKind,isProduct)=>{const badColor=isProduct&&options.badOutputColor,
    stream={streamIndex:0,dispositionDefault:true,codec,width:1920,height:1080,dynamicRangeKind,
      pixelFormat:badColor?'yuv420p10le':dynamicRangeKind==='sdr'?'yuv420p':'yuv420p10le',colorRange:'limited',
      colorPrimaries:badColor?'bt2020':dynamicRangeKind==='sdr'?'bt709':'unknown',
      colorTransfer:badColor?'pq':dynamicRangeKind==='sdr'?'bt709':'unknown',
      colorMatrix:badColor?'bt2020nc':dynamicRangeKind==='sdr'?'bt709':'unknown'};
    if(isProduct&&options.outputDolbyVision)stream.dolbyVision={profile:8,rpuPresent:true};
    return Object.freeze({resultKind:'probed',container:'matroska',videoStreams:Object.freeze([Object.freeze(stream)]),
      audioStreams:Object.freeze([]),subtitleStreams:Object.freeze([]),discTopology:null});};
  return {mediaProbe:{async probe(handle){const isProduct=handle.identity.materialKey===identity.materialKey,
    value=probe(isProduct?outputDynamicRangeKind:sourceDynamicRangeKind,isProduct);
    return Object.freeze({...value,sourceHandleDigest:canonicalDigest(handle),payloadDigest:canonicalDigest(value)});}},
    mediaEffectPort:{async verifyPlayback({physicalMaterialReadHandle}){const isProduct=physicalMaterialReadHandle.identity.materialKey===identity.materialKey,
      passedSamplePointsPercent=isProduct&&options.missingProductDecode?[5,50]:[5,50,95];
      return Object.freeze({samplePointsPercent:[5,50,95],passedSamplePointsPercent,decodeDigest:D('decode')});}},
    async computeBoundedMaterialFingerprint(location){const handleIdentity=String(location).endsWith('source.mkv')
      ?physicalIdentity(D('source-material'),'2',D('source-bytes')):identity;
      return Object.freeze({stat:Object.freeze({size:100n,ino:BigInt(handleIdentity.inode),mtimeNs:1_000_000n,ctimeNs:1_000_000n}),
        fingerprintAlgorithm:handleIdentity.fingerprintAlgorithm,fingerprintVersion:handleIdentity.fingerprintVersion,contentFingerprint:handleIdentity.contentFingerprint});}};
}

function emptyCheck(kind, value, authorizedManifest, acceptanceAttemptId='attempt-1') {
  const gaps=Object.freeze([]),observations=Object.freeze([]),body={schemaRef:'helix://contracts/types/AcceptanceCheck/v1',schemaVersion:1,
    verificationId:D('check-'+kind),verificationKind:'shelf_acceptance',basisDigest:D('basis-'+kind),result:'passed',reasonCodes:Object.freeze([]),
    evidenceRefs:Object.freeze([D('evidence-'+kind)]),verifiedAtMs:NOW,acceptanceAttemptId,checkKind:kind,standardRevision:1,
    packageDigest:value.packageDigest,requirementDigest:D('requirement-'+kind),evidenceStatus:'complete',actualGapCodes:gaps,
    actualGapSetDigest:canonicalDigest({schema:'arca.acceptance-check-actual-gap-set@1',checkKind:kind,items:gaps}),
    primaryMediaObservations:observations,primaryMediaObservationSetDigest:canonicalDigest({schema:'arca.mandatory-media-primary-observation-set@1',items:observations}),
    authorizedDefectManifestDigestOrNull:authorizedManifest?.manifestDigest||null,
    authorizedGapComparison:authorizedManifest?'pending_final_union':'not_applicable'};
  return Object.freeze(body);
}

for (const authorized of [false, true]) test(`UAT-131 ${authorized?'defect':'ordinary'} mandatory observation recomputes the same live media Gap`, async () => {
  const value=fixture({authorized}),runtime=ports(value.identity),result=await observeMandatoryMedia({...value,...runtime,observedAtMs:NOW});
  assert.equal(result.evidenceStatus,'complete');
  assert.deepEqual(result.actualGapCodes,['video_codec_unmet']);
  assert.equal(result.primaryMediaObservations.length,1);
  assert.deepEqual(result.primaryMediaObservations[0].sourceDecodeSummary.passedSamplePointsPercent,[5,50,95]);
});

test('UAT-131 expired read authority fails as stale basis without manufacturing a media Gap', async () => {
  const value=fixture({expired:true}),runtime=ports(value.identity),result=await observeMandatoryMedia({...value,...runtime,observedAtMs:NOW});
  assert.equal(result.evidenceStatus,'stale_basis');
  assert.deepEqual(result.actualGapCodes,[]);
  assert.deepEqual(result.primaryMediaObservations,[]);
});

test('UAT-135 proven ISO Source uses one topology-aware selected-payload observation', async () => {
  const value=fixture({workspace:true,conversionOperation:'preserve',sourceDynamicRangeKind:'sdr',outputDynamicRangeKind:'sdr'}),
    base=ports(value.identity,'hevc','sdr','sdr'),calls=[];
  const sourceStream=Object.freeze({streamIndex:0,dispositionDefault:true,codec:'h264',width:1920,height:1080,
    dynamicRangeKind:'sdr',pixelFormat:'yuv420p',colorRange:'limited',colorPrimaries:'bt709',
    colorTransfer:'bt709',colorMatrix:'bt709'}),
    productStream=Object.freeze({...sourceStream,codec:'hevc'}),
    topology=Object.freeze({discKind:'iso',topologyDigest:D('live-topology'),
      selectedPlaylist:Object.freeze({relativeLocation:'BDMV/PLAYLIST/00000.mpls',durationMs:1000,clipIds:Object.freeze(['00000'])})});
  const runtime={...base,
    mediaProbe:{async probe(handle){const source=handle.identity.materialKey===value.sourceIdentity.materialKey;
      calls.push(source?'probe-source-container':'probe-product');
      const body=source
        ? {resultKind:'not_media',durationMs:0,container:'unknown',videoStreams:Object.freeze([]),audioStreams:Object.freeze([]),
          subtitleStreams:Object.freeze([]),discTopology:topology}
        : {resultKind:'probed',durationMs:1000,container:'matroska',videoStreams:Object.freeze([productStream]),
          audioStreams:Object.freeze([]),subtitleStreams:Object.freeze([]),discTopology:null};
      return Object.freeze({...body,sourceHandleDigest:canonicalDigest(handle),payloadDigest:canonicalDigest(body)});
    }},
    mediaEffectPort:{
      async observeDiscPlayback({physicalMaterialReadHandle}){calls.push('observe-selected-payload');
        const body={resultKind:'probed',durationMs:1000,container:'mpegts',videoStreams:Object.freeze([sourceStream]),
          audioStreams:Object.freeze([]),subtitleStreams:Object.freeze([]),discTopology:topology};
        return Object.freeze({probeEvidence:Object.freeze({...body,
          sourceHandleDigest:canonicalDigest(physicalMaterialReadHandle),payloadDigest:canonicalDigest(body)}),
        samplePointsPercent:Object.freeze([5,50,95]),passedSamplePointsPercent:Object.freeze([5,50,95]),decodeDigest:D('iso-decode')});
      },
      async verifyPlayback(){calls.push('verify-product');return Object.freeze({samplePointsPercent:Object.freeze([5,50,95]),
        passedSamplePointsPercent:Object.freeze([5,50,95]),decodeDigest:D('product-decode')});},
    },
  };
  const observed=await observeMandatoryMedia({...value,...runtime,observedAtMs:NOW});
  assert.deepEqual(observed.actualGapCodes,[]);
  assert.deepEqual(calls,['probe-source-container','probe-product','observe-selected-payload','verify-product']);
  assert.equal(observed.primaryMediaObservations[0].dynamicRangeSummary.sourceDynamicRangeKind,'sdr');
  assert.deepEqual(observed.primaryMediaObservations[0].sourceDecodeSummary.passedSamplePointsPercent,[]);
});

test('UAT-135 proven ISO Source fails contract when topology-aware observation is absent', async () => {
  const value=fixture({workspace:true,conversionOperation:'preserve'}),base=ports(value.identity,'hevc'),
    topology=Object.freeze({discKind:'iso',topologyDigest:D('live-topology')});
  await assert.rejects(() => observeMandatoryMedia({...value,...base,observedAtMs:NOW,
    mediaProbe:{async probe(handle){const source=handle.identity.materialKey===value.sourceIdentity.materialKey,
      body=source?{resultKind:'not_media',durationMs:0,videoStreams:Object.freeze([]),audioStreams:Object.freeze([]),
        subtitleStreams:Object.freeze([]),discTopology:topology}:{resultKind:'probed',durationMs:1000,container:'matroska',
        videoStreams:Object.freeze([]),audioStreams:Object.freeze([]),subtitleStreams:Object.freeze([]),discTopology:null};
      return Object.freeze({...body,sourceHandleDigest:canonicalDigest(handle),payloadDigest:canonicalDigest(body)});
    }},mediaEffectPort:{verifyPlayback:base.mediaEffectPort.verifyPlayback}}),
  (error)=>error.code==='ARCA_MANDATORY_MEDIA_INVALID_CONTRACT');
});

test('UAT-135 an undecodable selected payload does not manufacture a dynamic-range Gap', async () => {
  const value=fixture({workspace:true,conversionOperation:'preserve',sourceDynamicRangeKind:'sdr',outputDynamicRangeKind:'sdr'}),
    base=ports(value.identity,'hevc','sdr','sdr'),topology=Object.freeze({discKind:'iso',topologyDigest:D('live-topology')}),
    productStream=Object.freeze({streamIndex:0,dispositionDefault:true,codec:'hevc',width:1920,height:1080,
      dynamicRangeKind:'sdr',pixelFormat:'yuv420p',colorRange:'limited',colorPrimaries:'bt709',colorTransfer:'bt709',colorMatrix:'bt709'}),
    notMedia=Object.freeze({resultKind:'not_media',durationMs:0,videoStreams:Object.freeze([]),audioStreams:Object.freeze([]),
      subtitleStreams:Object.freeze([]),discTopology:topology}),product=Object.freeze({resultKind:'probed',durationMs:1000,container:'matroska',
      videoStreams:Object.freeze([productStream]),audioStreams:Object.freeze([]),subtitleStreams:Object.freeze([]),discTopology:null});
  const observed=await observeMandatoryMedia({...value,...base,observedAtMs:NOW,
    mediaProbe:{async probe(handle){const body=handle.identity.materialKey===value.sourceIdentity.materialKey?notMedia:product;
      return Object.freeze({...body,sourceHandleDigest:canonicalDigest(handle),payloadDigest:canonicalDigest(body)});}},
    mediaEffectPort:{async observeDiscPlayback({physicalMaterialReadHandle}){return Object.freeze({probeEvidence:Object.freeze({...notMedia,
      sourceHandleDigest:canonicalDigest(physicalMaterialReadHandle),payloadDigest:canonicalDigest(notMedia)}),samplePointsPercent:Object.freeze([5,50,95]),
      passedSamplePointsPercent:Object.freeze([]),decodeDigest:D('iso-decode-failed')});},verifyPlayback:base.mediaEffectPort.verifyPlayback}});
  assert.deepEqual(observed.actualGapCodes,[]);
  assert.equal(observed.primaryMediaObservations[0].dynamicRangeSummary.sourceDynamicRangeKind,'unknown');
});

test('workspace Product playback Gap ignores Source decode samples', async () => {
  const value=fixture({workspace:true,conversionOperation:'preserve',sourceDynamicRangeKind:'sdr',outputDynamicRangeKind:'sdr'});
  const calls=[];
  const runtime=ports(value.identity,'hevc','sdr','sdr');
  runtime.mediaEffectPort={
    async verifyPlayback({physicalMaterialReadHandle}){
      const isProduct=physicalMaterialReadHandle.identity.materialKey===value.identity.materialKey;
      calls.push(isProduct?'product':'source');
      return Object.freeze({samplePointsPercent:Object.freeze([5,50,95]),
        passedSamplePointsPercent:Object.freeze(isProduct?[5,50,95]:[95]),decodeDigest:D('decode')});
    },
  };
  const observed=await observeMandatoryMedia({...value,...runtime,observedAtMs:NOW});
  assert.deepEqual(calls,['product']);
  assert.deepEqual(observed.actualGapCodes,[]);
  assert.deepEqual(observed.primaryMediaObservations[0].productDecodeSummary.passedSamplePointsPercent,[5,50,95]);
  assert.deepEqual(observed.primaryMediaObservations[0].sourceDecodeSummary.passedSamplePointsPercent,[]);
});

test('UAT-131 formal mandatory Capability executes independent observation on ordinary and defect Packages', async () => {
  for (const authorized of [false, true]) {
    const value=fixture({authorized}),runtime=ports(value.identity),capabilities=createOnDeckCapabilityPorts({
      schemaManifest,unitOfWork:{execute(){throw new Error('pure mandatory check must not write');}},now:()=>NOW,
      workResultReader:{readBindings(){return []; }},inventoryPort:{},...runtime,
      contextReader:{readOffer(){return Object.freeze({offer:Object.freeze({offerId:'offer-1',onDeckPackageId:value.packageValue.onDeckPackageId,
        packageDigest:value.packageValue.packageDigest}),shelf:Object.freeze({currentStandardRevision:1,currentPlacementRevision:1,
        standard:Object.freeze({digest:D('standard')})}),packageValue:value.packageValue});}}});
    const outcome=await capabilities[CAPABILITY_REFS.mandatory].execute({ownerScope:Object.freeze({processType:'arca_acceptance',processId:'offer-1'}),
      workId:'mandatory-work',namedInputs:Object.freeze({onDeckProductPackage:value.packageValue,mandatoryRequirement:value.requirement})});
    assert.equal(outcome.result.result,authorized?'passed':'failed');
    assert.deepEqual(outcome.result.actualGapCodes,['video_codec_unmet']);
    assert.equal(outcome.result.primaryMediaObservations.length,1);
    assert.equal(validateAcceptanceCheck(outcome.result),true,
      JSON.stringify(validateAcceptanceCheck.errors));
  }
});

test('UAT-131 Owner final union rejects forged Check evidence and accepts only the exact Manifest union', async () => {
  const value=fixture({authorized:true}),runtime=ports(value.identity),capabilities=createOnDeckCapabilityPorts({
    schemaManifest,unitOfWork:{execute(){throw new Error('pure mandatory check must not write');}},now:()=>NOW,
    workResultReader:{readBindings(){return []; }},inventoryPort:{},...runtime,
    contextReader:{readOffer(){return Object.freeze({offer:Object.freeze({offerId:'offer-1',onDeckPackageId:value.packageValue.onDeckPackageId,
      packageDigest:value.packageValue.packageDigest}),shelf:Object.freeze({currentStandardRevision:1,currentPlacementRevision:1,
      standard:Object.freeze({digest:D('standard')})}),packageValue:value.packageValue});}}});
  const mandatory=(await capabilities[CAPABILITY_REFS.mandatory].execute({ownerScope:Object.freeze({processType:'arca_acceptance',processId:'offer-1'}),
    workId:'mandatory-work',namedInputs:Object.freeze({onDeckProductPackage:value.packageValue,mandatoryRequirement:value.requirement})})).result;
  const manifestValue=value.packageValue.productionAttestation.authorizedDefectManifest,checks=[
    emptyCheck('identity',value.packageValue,manifestValue,mandatory.acceptanceAttemptId),emptyCheck('structure',value.packageValue,manifestValue,mandatory.acceptanceAttemptId),
    emptyCheck('metadata',value.packageValue,manifestValue,mandatory.acceptanceAttemptId),mandatory,emptyCheck('space',value.packageValue,manifestValue,mandatory.acceptanceAttemptId)];
  const decision=finalGapDecision({acceptanceChecks:checks,acceptanceAttemptId:mandatory.acceptanceAttemptId,packageDigest:value.packageValue.packageDigest,standardRevision:1,
    authorizedDefectManifest:manifestValue});
  assert.equal(decision.authorizedGapComparison,'exact_match');
  assert.deepEqual(decision.actualGapUnionCodes,['video_codec_unmet']);
  assert.throws(()=>finalGapDecision({acceptanceChecks:checks.slice(1),acceptanceAttemptId:mandatory.acceptanceAttemptId,packageDigest:value.packageValue.packageDigest,standardRevision:1,
    authorizedDefectManifest:manifestValue}),/incomplete/);
  const duplicate=Object.freeze({...mandatory,actualGapCodes:Object.freeze(['video_codec_unmet','video_codec_unmet'])});
  assert.throws(()=>finalGapDecision({acceptanceChecks:checks.map((item)=>item.checkKind==='mandatory_media'?duplicate:item),acceptanceAttemptId:mandatory.acceptanceAttemptId,
    packageDigest:value.packageValue.packageDigest,standardRevision:1,authorizedDefectManifest:manifestValue}),/canonical/);
  const wrongDigest=Object.freeze({...mandatory,actualGapSetDigest:D('wrong-gap-set')});
  assert.throws(()=>finalGapDecision({acceptanceChecks:checks.map((item)=>item.checkKind==='mandatory_media'?wrongDigest:item),acceptanceAttemptId:mandatory.acceptanceAttemptId,
    packageDigest:value.packageValue.packageDigest,standardRevision:1,authorizedDefectManifest:manifestValue}),/canonical/);
  const wrongObservation=Object.freeze({...mandatory,primaryMediaObservationSetDigest:D('wrong-observation-set')});
  assert.throws(()=>finalGapDecision({acceptanceChecks:checks.map((item)=>item.checkKind==='mandatory_media'?wrongObservation:item),acceptanceAttemptId:mandatory.acceptanceAttemptId,
    packageDigest:value.packageValue.packageDigest,standardRevision:1,authorizedDefectManifest:manifestValue}),/observation/);
});

test('UAT-131 a Manifest-authorized Gap missing from live reality fails its owning Check', async () => {
  const value=fixture({authorized:true}),runtime=ports(value.identity,'hevc'),capabilities=createOnDeckCapabilityPorts({
    schemaManifest,unitOfWork:{execute(){throw new Error('pure mandatory check must not write');}},now:()=>NOW,
    workResultReader:{readBindings(){return []; }},inventoryPort:{},...runtime,
    contextReader:{readOffer(){return Object.freeze({offer:Object.freeze({offerId:'offer-1',onDeckPackageId:value.packageValue.onDeckPackageId,
      packageDigest:value.packageValue.packageDigest}),shelf:Object.freeze({currentStandardRevision:1,currentPlacementRevision:1,
      standard:Object.freeze({digest:D('standard')})}),packageValue:value.packageValue});}}});
  const result=(await capabilities[CAPABILITY_REFS.mandatory].execute({ownerScope:Object.freeze({processType:'arca_acceptance',processId:'offer-1'}),
    workId:'mandatory-work',namedInputs:Object.freeze({onDeckProductPackage:value.packageValue,mandatoryRequirement:value.requirement})})).result;
  assert.deepEqual(result.actualGapCodes,[]);
  assert.equal(result.result,'failed');
});

test('UAT-132 direct HEVC with unknown dynamic-range labels remains an ordinary pass', async () => {
  const value=fixture({sourceDynamicRangeKind:'unknown',outputDynamicRangeKind:'unknown'}),
    runtime=ports(value.identity,'hevc','unknown','unknown'),
    observed=await observeMandatoryMedia({...value,...runtime,observedAtMs:NOW});
  assert.deepEqual(observed.actualGapCodes,[]);
  const capabilities=createOnDeckCapabilityPorts({schemaManifest,
    unitOfWork:{execute(){throw new Error('pure mandatory check must not write');}},now:()=>NOW,
    workResultReader:{readBindings(){return []; }},inventoryPort:{},...runtime,
    contextReader:{readOffer(){return Object.freeze({offer:Object.freeze({offerId:'offer-1',onDeckPackageId:value.packageValue.onDeckPackageId,
      packageDigest:value.packageValue.packageDigest}),shelf:Object.freeze({currentStandardRevision:1,currentPlacementRevision:1,
      standard:Object.freeze({digest:D('standard')})}),packageValue:value.packageValue});}}});
  const result=(await capabilities[CAPABILITY_REFS.mandatory].execute({ownerScope:Object.freeze({processType:'arca_acceptance',processId:'offer-1'}),
    workId:'mandatory-work',namedInputs:Object.freeze({onDeckProductPackage:value.packageValue,mandatoryRequirement:value.requirement})})).result;
  assert.equal(result.result,'passed');
  assert.deepEqual(result.actualGapCodes,[]);
  assert.equal(result.primaryMediaObservations[0].dynamicRangeSummary.outputDynamicRangeKind,'unknown');
});

for (const conversionOperation of ['none','preserve']) test(`UAT-132 workspace ${conversionOperation} preserves unknown reality`, async () => {
  const value=fixture({workspace:true,conversionOperation,sourceDynamicRangeKind:'unknown',outputDynamicRangeKind:'unknown'}),
    observed=await observeMandatoryMedia({...value,...ports(value.identity,'hevc','unknown','unknown'),observedAtMs:NOW});
  assert.deepEqual(observed.actualGapCodes,[]);
  assert.equal(observed.primaryMediaObservations[0].dynamicRangeSummary.conversionOperation,
    conversionOperation);
});

test('UAT-132 External no-conversion accepts a fresh product dynamic range different from the Run source', async () => {
  const value=fixture({workspace:true,conversionOperation:'none',sourceDynamicRangeKind:'unknown',outputDynamicRangeKind:'unknown'}),
    observed=await observeMandatoryMedia({...value,...ports(value.identity,'hevc','unknown','hdr10_compatible'),observedAtMs:NOW});
  assert.deepEqual(observed.actualGapCodes,[]);
});

test('UAT-137 no-conversion trusts fresh product reality over historical dynamic-range labels', async () => {
  const value=fixture({workspace:true,conversionOperation:'none',sourceDynamicRangeKind:'unknown',outputDynamicRangeKind:'sdr'}),
    observed=await observeMandatoryMedia({...value,...ports(value.identity,'hevc','unknown','hdr10_compatible'),observedAtMs:NOW});
  assert.deepEqual(observed.actualGapCodes,[]);
});

test('UAT-137 preserve accepts fresh SDR to SDR when historical Source range was unknown', async () => {
  const value=fixture({workspace:true,conversionOperation:'preserve',sourceDynamicRangeKind:'unknown',outputDynamicRangeKind:'sdr'}),
    observed=await observeMandatoryMedia({...value,...ports(value.identity,'hevc','sdr','sdr'),observedAtMs:NOW});
  assert.deepEqual(observed.actualGapCodes,[]);
});

test('UAT-137 preserve trusts matching fresh SDR reality over both historical labels', async () => {
  const value=fixture({workspace:true,conversionOperation:'preserve',
    sourceDynamicRangeKind:'unknown',outputDynamicRangeKind:'hdr10_compatible'}),
    observed=await observeMandatoryMedia({...value,...ports(value.identity,'hevc','sdr','sdr'),observedAtMs:NOW});
  assert.deepEqual(observed.actualGapCodes,[]);
});

test('UAT-132 preserve rejects fresh source/output dynamic-range drift', async () => {
  const value=fixture({workspace:true,conversionOperation:'preserve',sourceDynamicRangeKind:'unknown',outputDynamicRangeKind:'unknown'}),
    observed=await observeMandatoryMedia({...value,...ports(value.identity,'hevc','unknown','hdr10_compatible'),observedAtMs:NOW});
  assert.deepEqual(observed.actualGapCodes,['dynamic_range_conversion_unmet']);
});

test('UAT-137 preserve still rejects fresh SDR to HDR drift', async () => {
  const value=fixture({workspace:true,conversionOperation:'preserve',sourceDynamicRangeKind:'sdr',outputDynamicRangeKind:'sdr'}),
    observed=await observeMandatoryMedia({...value,...ports(value.identity,'hevc','hdr10_compatible','sdr'),observedAtMs:NOW});
  assert.deepEqual(observed.actualGapCodes,['dynamic_range_conversion_unmet']);
});

test('UAT-137 tone-map trusts fresh Dolby Vision to SDR reality over historical labels', async () => {
  const value=fixture({workspace:true,conversionOperation:'tone_map_to_sdr_bt709',
    sourceDynamicRangeKind:'unknown',outputDynamicRangeKind:'unknown'}),
    observed=await observeMandatoryMedia({...value,...ports(value.identity,'hevc','sdr','dolby_vision'),observedAtMs:NOW});
  assert.deepEqual(observed.actualGapCodes,[]);
});

test('UAT-137 tone-map still rejects a fresh non-Dolby-Vision Source', async () => {
  const value=fixture({workspace:true,conversionOperation:'tone_map_to_sdr_bt709',
    sourceDynamicRangeKind:'dolby_vision',outputDynamicRangeKind:'sdr'}),
    observed=await observeMandatoryMedia({...value,...ports(value.identity,'hevc','sdr','hdr10_compatible'),observedAtMs:NOW});
  assert.deepEqual(observed.actualGapCodes,['dynamic_range_conversion_unmet']);
});

for (const outputKind of ['unknown','hdr10_compatible','dolby_vision']) test(`UAT-132 tone-map rejects fresh ${outputKind} output`, async () => {
  const value=fixture({workspace:true,conversionOperation:'tone_map_to_sdr_bt709',
    sourceDynamicRangeKind:'dolby_vision',outputDynamicRangeKind:'sdr'}),
    observed=await observeMandatoryMedia({...value,...ports(value.identity,'hevc',outputKind,'dolby_vision'),observedAtMs:NOW});
  assert.ok(observed.actualGapCodes.includes('dynamic_range_conversion_unmet'));
  assert.equal(observed.primaryMediaObservations[0].dynamicRangeSummary.conversionOperation,
    'tone_map_to_sdr_bt709');
});

test('UAT-132 tone-map retains color, Dolby Vision metadata, and playback negative gates', async () => {
  const value=fixture({workspace:true,conversionOperation:'tone_map_to_sdr_bt709',
    sourceDynamicRangeKind:'dolby_vision',outputDynamicRangeKind:'sdr'}),
    badColor=await observeMandatoryMedia({...value,...ports(value.identity,'hevc','sdr','dolby_vision',{badOutputColor:true}),observedAtMs:NOW}),
    dovi=await observeMandatoryMedia({...value,...ports(value.identity,'hevc','sdr','dolby_vision',{outputDolbyVision:true}),observedAtMs:NOW}),
    decode=await observeMandatoryMedia({...value,...ports(value.identity,'hevc','sdr','dolby_vision',{missingProductDecode:true}),observedAtMs:NOW});
  assert.ok(badColor.actualGapCodes.includes('output_color_profile_unmet'));
  assert.ok(dovi.actualGapCodes.includes('dolby_vision_metadata_not_removed'));
  assert.ok(decode.actualGapCodes.includes('playback_decode_failed'));
});

test('UAT-132 rejects a caller-narrowed dynamic-range pseudo-policy and invalid Direct conversion variant', async () => {
  const value=fixture({sourceDynamicRangeKind:'unknown',outputDynamicRangeKind:'unknown'}),
    narrowedBody={...value.requirement,acceptedOutputDynamicRangeKinds:Object.freeze(['sdr','hdr10_compatible','hlg','dolby_vision'])};
  delete narrowedBody.digest;
  const narrowed=Object.freeze({...narrowedBody,digest:canonicalDigest(narrowedBody)});
  await assert.rejects(observeMandatoryMedia({...value,requirement:narrowed,
    ...ports(value.identity,'hevc','unknown','unknown'),observedAtMs:NOW}),
  (error)=>error.code==='ARCA_MANDATORY_MEDIA_INVALID_CONTRACT');
  const invalidVariant=fixture({conversionOperation:'tone_map_to_sdr_bt709',
    sourceDynamicRangeKind:'dolby_vision',outputDynamicRangeKind:'sdr'});
  await assert.rejects(observeMandatoryMedia({...invalidVariant,
    ...ports(invalidVariant.identity,'hevc','sdr','dolby_vision'),observedAtMs:NOW}),
  (error)=>error.code==='ARCA_MANDATORY_MEDIA_INVALID_CONTRACT');
});
