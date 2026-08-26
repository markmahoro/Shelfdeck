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

function physicalIdentity(materialKey = D('material')) {
  return Object.freeze({ schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2', schemaVersion:2,
    materialKey, mountScopeId:'mount-1', inode:'1', sizeBytes:100,
    fingerprintAlgorithm:'middle-256k-sha256', fingerprintVersion:1,
    contentFingerprint:D('bytes') });
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

function fixture({ authorized = false, expired = false } = {}) {
  const runId='run-1',packageId=D('package'),specDigest=D('spec'),identity=physicalIdentity(),location='C:/canary/movie.mkv',
    memberBody={ordinal:0,materialKey:identity.materialKey,role:'primary_payload',physicalIdentity:identity,sizeBytes:100,
      location:Object.freeze({locationKind:'domain_binding',endpointId:'endpoint-1',location,rootHandleRef:null,relativePath:null}),
      bindingKind:'libra_material_binding',bindingRevision:1,originCandidateDeliveryRef:null,workspaceReferenceId:null,
      workspaceMaterialHandle:null,admittedControlRevision:1,admittedControlProjectionDigest:D('control'),bindingEvidenceDigest:D('binding'),
      episodeClaims:Object.freeze([]),episodeClaimSetDigest:D('claims'),outputRequirementDigest:D('product-output-requirement')},
    member=Object.freeze({...memberBody,memberDigest:canonicalDigest(memberBody)}),issuedAtMs=expired?NOW-86_400_001:NOW-100,
    expiresAtMs=issuedAtMs+86_400_000,basis={schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',schemaVersion:1,
      handleId:'',identity,ownerDomain:'libra',ownerScope:Object.freeze({scopeType:'on_deck_package',scopeId:packageId}),bindingRevision:1,
      endpointId:'endpoint-1',location,mountScopeRevision:1,expectedSizeBytes:100,expectedMtimeNs:1,expectedCtimeNs:1,
      fingerprintVerifiedAtMs:issuedAtMs,readScope:'shelf_acceptance_primary_probe_decode',expiresAtMs,fenceDigest:''};
  basis.handleId=canonicalDigest({schema:'libra.shelf-acceptance-primary-read-handle-id@1',onDeckPackageId:packageId,libraRunId:runId,
    readRole:'source_and_product_primary',materialKey:identity.materialKey,bindingRevision:1,productMemberDigest:member.memberDigest,
    acceptanceSpecRecordDigest:specDigest});
  basis.fenceDigest=canonicalDigest({schema:'libra.shelf-acceptance-primary-read-handle-fence@1',
    ...Object.fromEntries(Object.entries(basis).filter(([key])=>key!=='fenceDigest')),libraRunId:runId,
    runExecutionBasisDigest:D('run-basis'),acceptanceSpecId:'spec-1',acceptanceSpecRecordDigest:specDigest,
    productMemberDigest:member.memberDigest,readRole:'source_and_product_primary'});
  const handle=Object.freeze(basis),verification=Object.freeze({verificationId:D('media-verification'),libraRunId:runId,
    mediaRequirementDigest:D('media-requirement')}),
    itemBody={ordinal:0,materialKey:member.materialKey,productMemberDigest:member.memberDigest,productMediaVerification:verification,
      productMediaVerificationDigest:canonicalDigest(verification),sourceReadHandle:handle,sourceReadHandleDigest:canonicalDigest(handle),
      productReadHandle:handle,productReadHandleDigest:canonicalDigest(handle),samePhysicalMaterial:true},
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
      maxSizeBytes:null,forbidSystemUpscaleFor4k:true,acceptedOutputDynamicRangeKinds:Object.freeze(['sdr','hdr10_compatible','hlg','dolby_vision']),
      sdrOutputPixelFormat:'yuv420p',sdrOutputColorProfile:Object.freeze({range:'limited',primaries:'bt709',transfer:'bt709',matrix:'bt709'}),
      forbidDolbyVisionMetadataOnSdr:true,decodeSamplePointsPercent:Object.freeze([5,50,95]),requireAllDecodeSamples:true},
    requirement=Object.freeze({...requirementBody,digest:canonicalDigest(requirementBody)});
  return {packageValue,requirement,identity};
}

function ports(identity, codec='h264') {
  const probe=Object.freeze({resultKind:'probed',container:'matroska',videoStreams:Object.freeze([{streamIndex:0,dispositionDefault:true,
    codec,width:1920,height:1080,dynamicRangeKind:'hdr10_compatible',pixelFormat:'yuv420p10le',colorRange:'limited',
    colorPrimaries:'bt2020',colorTransfer:'pq',colorMatrix:'bt2020nc'}]),audioStreams:Object.freeze([]),subtitleStreams:Object.freeze([]),discTopology:null});
  return {mediaProbe:{async probe(handle){return Object.freeze({...probe,sourceHandleDigest:canonicalDigest(handle),payloadDigest:canonicalDigest(probe)});}},
    mediaEffectPort:{async verifyPlayback(){return Object.freeze({samplePointsPercent:[5,50,95],passedSamplePointsPercent:[5,50,95],decodeDigest:D('decode')});}},
    async computeBoundedMaterialFingerprint(){return Object.freeze({stat:Object.freeze({size:100n,ino:1n,mtimeNs:1_000_000n,ctimeNs:1_000_000n}),
      fingerprintAlgorithm:identity.fingerprintAlgorithm,fingerprintVersion:identity.fingerprintVersion,contentFingerprint:identity.contentFingerprint});}};
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
