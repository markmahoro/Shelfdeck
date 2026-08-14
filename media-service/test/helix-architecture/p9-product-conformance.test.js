'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createCapabilityContractValidator } = require('../../src/helix/foundation/capability/contract-validator');
const { buildMediaRequirement } = require('../../src/helix/domains/libra/model/media-production-contracts');
const { buildProductConformanceFactSnapshot, buildProductConformanceInputSnapshot,
  evaluateProductConformance } = require('../../src/helix/domains/libra/model/product-conformance');
const { createProductConformanceCoordinator } = require('../../src/helix/domains/libra/application/media-production-coordinator');

const D = (value) => canonicalDigest({ value });
const complete = (value, field) => ({ ...value, [field]:canonicalDigest(value) });
const contractRoot=path.resolve(__dirname,'../../src/helix/contracts');
const schemas=['types','domain-types','application-types'].flatMap((group)=>fs.readdirSync(path.join(contractRoot,group)).map((name)=>{
  const version=fs.readdirSync(path.join(contractRoot,group,name)).find((entry)=>/^v[0-9]+$/.test(entry));
  return JSON.parse(fs.readFileSync(path.join(contractRoot,group,name,version,'schema.json'),'utf8'));
}));
const schemaValidator=createCapabilityContractValidator({schemas});
const valid=(ref,value)=>schemaValidator.validate(ref,value);

function acceptanceSpec() {
  return { schemaRef:'libra.acceptance-spec@1', schemaVersion:1, draftId:'draft-1', draftKind:'acceptance_spec',
    basisDigest:D('basis'), draftDigest:D('draft'), producedAtMs:1, subjectId:'subject-1', targetShelfId:'shelf-1',
    contentProfile:'movie', structureKind:'single', productScope:{scopeKind:'single',subjectId:'subject-1',subjectIntakeRevision:1,
      episodeKeys:[],scopeDigest:D('scope')},
    shelfRoutingProjectionRevision:1,shelfProjectionDigest:D('shelf-projection'),shelfStandardRevision:1,
    shelfStandardDigest:D('standard'),decisionBasisId:'decision-1',decisionBasisDigest:D('decision'),
    requirements:{identity:{identityKind:'internal_identity',requiredProvider:null,requireSeasonNumber:false},
      structure:{structureKind:'single',primaryModel:'single_primary',requireOnePrimaryPerEpisode:false},
      metadata:{requiredFieldCodes:['title'],requiredArtifactKinds:[],requireRenderableSidecar:false,requireDecodableImages:false},
      mandatoryMedia:{mediaForm:'stream_file',videoCodec:'hevc',container:'matroska',fileExtension:'mkv',minimumRasterClass:'none',
        acceptedPrimaryAudioClasses:[],forbidSystemUpscaleFor4k:true},space:{unit:'product',maxSizeGiB:null,maxSizeBytes:null},
      inventory:{requireDomainBinding:true,requireChecksum:true,requiredMaterializedArtifactKinds:[],layoutModel:'single'}},
    specDigest:D('spec'),acceptanceSpecId:'spec-1',specRevision:1,recordDigest:D('spec-record'),publishedAtMs:1 };
}

function facts() {
  const provider = complete({provider:'internal',namespace:'internal_identity',providerKey:'subject-1',seasonNumber:null},'identityAnchorDigest'),
    providerIdentities=[provider],providerIdentitySetDigest=canonicalDigest({schema:'libra.resolved-provider-identity-set@1',items:providerIdentities}),
    exactSeasonContinuityClaims=[],exactSeasonContinuitySetDigest=D('seasons'),
    displayIdentity={schemaRef:'display@1',schemaVersion:1,recordKind:'display-identity',recordDigest:D('display'),entries:[]};
  const identityValue = {schemaRef:'helix://contracts/types/ResolvedProductIdentity/v1',schemaVersion:1,evidenceId:'identity-1',
    evidenceKind:'resolved_product_identity',producerRef:'fixture',basisDigest:D('identity-basis'),payloadDigest:D('identity-payload'),observedAtMs:1,
    subjectId:'subject-1',structureKind:'single',contentProfile:'movie',identityKind:'internal_identity',providerIdentities,
    providerIdentitySetDigest,exactSeasonContinuityClaims,exactSeasonContinuitySetDigest,displayIdentity};
  identityValue.identityDigest=canonicalDigest({schema:'libra.resolved-product-identity@1',subjectId:identityValue.subjectId,
    structureKind:identityValue.structureKind,contentProfile:identityValue.contentProfile,identityKind:identityValue.identityKind,
    providerIdentities,providerIdentitySetDigest,exactSeasonContinuityClaims,exactSeasonContinuitySetDigest,displayIdentity});
  const metadataValue = {schemaRef:'helix://contracts/types/ProductMetadataFact/v1',schemaVersion:1,factId:'metadata-1',ownerDomain:'libra',
    aggregateType:'libra_product_fact',aggregateId:'metadata-aggregate',revision:1,factSchemaRef:'helix://contracts/types/ProductMetadataFact/v1',
    factDigest:'',commitMarker:'marker-1',committedAtMs:1,subjectId:'subject-1',resolvedIdentityDigest:identityValue.identityDigest,
    sourceBasisKind:'metadata_observation',sourceBasisDigest:D('source'),metadataObservationSetDigest:D('observations'),westernAnalysisVariantDigest:null,
    fieldProvenance:[],descriptiveFacts:{schemaRef:'descriptive@1',schemaVersion:1,recordKind:'descriptive-facts',recordDigest:D('descriptive'),
      entries:[{key:'title',value:'Movie'}]},providerIdentities:[provider],mediaCastFactRef:null,verifiedArtifactManifestDigest:D('verified-artifacts'),
    productMetadataDigest:''};
  const metadataBody={subjectId:metadataValue.subjectId,resolvedIdentityDigest:metadataValue.resolvedIdentityDigest,
    sourceBasisKind:metadataValue.sourceBasisKind,sourceBasisDigest:metadataValue.sourceBasisDigest,
    metadataObservationSetDigest:metadataValue.metadataObservationSetDigest,westernAnalysisVariantDigest:metadataValue.westernAnalysisVariantDigest,
    fieldProvenance:metadataValue.fieldProvenance,descriptiveFacts:metadataValue.descriptiveFacts,providerIdentities:metadataValue.providerIdentities,
    mediaCastFactRef:metadataValue.mediaCastFactRef,verifiedArtifactManifestDigest:metadataValue.verifiedArtifactManifestDigest};
  metadataValue.productMetadataDigest=canonicalDigest({schema:'libra.product-metadata@1',...metadataBody});metadataValue.factDigest=metadataValue.productMetadataDigest;
  const resolved = buildProductConformanceFactSnapshot({productFactId:'identity-fact-1',factKind:'resolved_identity',factRevision:1,
    factValue:identityValue,factDigest:identityValue.identityDigest,evidenceDigest:D('identity-evidence')});
  const metadata = buildProductConformanceFactSnapshot({productFactId:metadataValue.factId,factKind:'product_metadata',factRevision:1,
    factValue:metadataValue,factDigest:metadataValue.factDigest,evidenceDigest:D('metadata-evidence')});
  return { resolved, items:[metadata,resolved] };
}

function productMaterialManifest() {
  const member = complete({ordinal:0,materialKey:D('material'),role:'primary_payload',
    physicalIdentity:{schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,materialKey:D('material'),mountScopeId:'mount-1',
      inode:'1',sizeBytes:100,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:D('bytes')},sizeBytes:100,
    location:{locationKind:'domain_binding',endpointId:'endpoint-1',location:'movie.mkv',rootHandleRef:null,relativePath:null},
    bindingKind:'libra_material_binding',bindingRevision:1,bindingEvidenceDigest:D('binding'),originCandidateDeliveryRef:{intakeDecisionId:'intake-1',
      offerId:'offer-1',candidatePackageId:'candidate-1',packageRevision:1,packageDigest:D('candidate'),candidateDeliverySnapshotDigest:D('delivery'),
      relatedReferenceSetDigest:D('related')},workspaceReferenceId:null,workspaceMaterialHandle:null,admittedControlRevision:1,
    admittedControlProjectionDigest:D('admitted-control'),sourceRelatedReferenceId:null,derivedAuthorityDigest:null,
    outputRequirementDigest:D('output-requirement'),episodeClaims:[],
    episodeClaimSetDigest:canonicalDigest({schema:'libra.production-material-episode-claims@1',items:[]}),controlOperation:'assert_existing_input',
    expectedControlRevision:1,expectedControlProjectionDigest:D('expected-control'),committedControlRevision:2,
    committedControlProjectionDigest:D('committed-control')}, 'memberDigest');
  return complete({manifestId:'material-manifest-1',manifestRole:'product_delivery',manifestRevision:1,libraRunId:'run-1',scopeKind:'single',members:[member],
    memberSetDigest:canonicalDigest({schema:'libra.production-material-members@1',items:[member]}),
    episodeScopeDigest:canonicalDigest({schema:'libra.production-episode-scope@1',items:[]})}, 'manifestDigest');
}

function directMaterial(){return {schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',schemaVersion:1,handleId:'handle-1',
  identity:{schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,materialKey:D('material'),mountScopeId:'mount-1',inode:'1',
    sizeBytes:100,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:D('bytes')},ownerDomain:'libra',ownerScope:{scopeType:'libra_run',scopeId:'run-1'},bindingRevision:1,
  endpointId:'endpoint-1',location:'movie.mkv',mountScopeRevision:1,expectedSizeBytes:100,expectedMtimeNs:1,expectedCtimeNs:1,
  fingerprintVerifiedAtMs:1,readScope:'material_read',expiresAtMs:9999999999999,fenceDigest:D('fence')};}

function artifactRequirement(label){
  const requirement={revision:1,schemaRef:'artifact.nfo.renderability@1',artifactKind:'nfo',requirementPayload:{profile:label}};
  requirement.requirementDigest=canonicalDigest({schema:'shared.artifact-requirement@1',...requirement});
  requirement.requirementId=canonicalDigest({schema:'shared.artifact-requirement-id@1',requirementDigest:requirement.requirementDigest});
  return requirement;
}

function artifactContinuityFixture(manifestRequirement,verificationRequirement){
  const artifactDigest=D('artifact-bytes'),artifactHandleId='artifact-handle-1',artifactKind='nfo',artifactRevision=1;
  const verificationItem=complete({ordinal:0,artifactHandleId,artifactKind,artifactRevision,artifactDigest},'referenceDigest');
  const manifestDigest=canonicalDigest({schema:'shared.artifact-verification-input-manifest@1',
    requirementDigest:verificationRequirement.requirementDigest,items:[verificationItem]});
  const basisDigest=canonicalDigest({schema:'shared.artifact-manifest-verification-basis@1',manifestDigest,
    requirementDigest:verificationRequirement.requirementDigest});
  const verification={schemaRef:'helix://contracts/types/ArtifactManifestVerification/v1',schemaVersion:1,
    verificationId:canonicalDigest({schema:'shared.artifact-manifest-verification-id@1',manifestDigest,
      requirementDigest:verificationRequirement.requirementDigest,basisDigest}),verificationKind:'artifact_manifest_verification',basisDigest,
    result:'passed',reasonCodes:[],evidenceRefs:[],verifiedAtMs:1,manifestDigest,contractRef:'shared.artifact.manifest.verify@1',
    requirement:verificationRequirement,verifiedArtifacts:[verificationItem],artifactDigests:[artifactDigest]};
  verification.verificationDigest=canonicalDigest(verification);
  const verificationResultRef={workId:'work-1',attemptId:'attempt-1',planId:'plan-1',eventId:'event-1',resultId:verification.verificationId,
    capabilityRef:'shared.artifact.manifest.verify@1',resultSchemaRef:'helix://contracts/types/ArtifactManifestVerification/v1',
    resultDigest:canonicalDigest(verification),inputBindingDigest:D('artifact-input-binding')};
  const verifiedItem=complete({ordinal:0,artifactHandleId,artifactKind,artifactRevision,artifactDigest,
    requirementId:manifestRequirement.requirementId,requirementRevision:manifestRequirement.revision,
    requirementSchemaRef:manifestRequirement.schemaRef,requirementDigest:manifestRequirement.requirementDigest,
    verificationEvidenceId:verification.verificationId,verificationEvidenceDigest:verification.verificationDigest,verificationResultRef},'referenceDigest');
  const inventoryItem=complete({artifactHandleId,artifactKind,artifactRevision,artifactDigest,
    requirementDigest:manifestRequirement.requirementDigest,materializationState:'included_product'},'referenceDigest');
  return {verification,verificationResultRef,verifiedItem,inventoryItem};
}

function snapshot() {
  const spec=acceptanceSpec(),requirement=buildMediaRequirement(spec),materialHandle=directMaterial(),factSet = facts(), structure = complete({structureKind:'single',contentProfile:'movie',productScopeDigest:D('scope'),
    episodeScopeDigest:canonicalDigest({schema:'libra.production-episode-scope@1',items:[]}),primaryMaterialCount:1,structuralDependencyCount:0},
  'productStructureDigest'), material = productMaterialManifest(), artifact = complete({manifestId:'artifact-manifest-1',manifestRevision:1,
    libraRunId:'run-1',items:[],artifactSetDigest:canonicalDigest({schema:'libra.product-artifact-set@1',items:[]})},'manifestDigest'),
    inventory = complete({productStructureSnapshot:structure,productMaterialManifest:material,artifactManifest:artifact},'inventoryDigest'),
    verifiedSet=canonicalDigest({schema:'libra.verified-artifact-set@1',items:[]}),
    verified = complete({manifestId:canonicalDigest({schema:'libra.verified-artifact-manifest-id@1',libraRunId:'run-1',artifactSetDigest:verifiedSet}),
      libraRunId:'run-1',items:[],artifactSetDigest:verifiedSet},'manifestDigest');
  const verification={schemaRef:'helix://contracts/types/ProductMediaVerification/v1',schemaVersion:1,verificationId:'verification-1',
    verificationKind:'libra_product_media',basisDigest:D('media-basis'),result:'passed',reasonCodes:[],evidenceRefs:[],verifiedAtMs:1,
    candidateId:'candidate-media-1',candidateNodeId:'node-1',candidateBasisDigest:D('candidate-basis'),candidateKind:'direct_input',libraRunId:'run-1',
    producingEventId:null,productMaterialHandleId:materialHandle.handleId,productMaterialHandleDigest:canonicalDigest(materialHandle),productMaterialFenceDigest:materialHandle.fenceDigest,
    workspaceMediaHandleId:null,mediaRequirementId:requirement.requirementId,mediaRequirementDigest:requirement.requirementDigest,sourceProbeEvidenceId:'probe-1',
    sourceProbeEvidenceDigest:D('source-probe'),outputProbeEvidenceId:'probe-1',outputProbeEvidenceDigest:D('source-probe'),
    qualitySummary:{videoCodec:'hevc',container:'matroska',fileExtension:'mkv',displayRasterClass:'4k',primaryAudioClasses:[],
      sourceDisplayRasterClass:'4k',systemUpscaleDetected:false},spaceSummary:{unit:'product',actualSizeBytes:100,maxSizeBytes:null,withinLimit:true},
    dynamicRangeSummary:{sourceDynamicRangeKind:'sdr',outputDynamicRangeKind:'sdr',conversionOperation:'none',outputPixelFormat:'yuv420p',
      outputColorProfile:{range:'limited',primaries:'bt709',transfer:'bt709',matrix:'bt709'},dolbyVisionMetadataPresent:false},
    decodeSummary:{samplePointsPercent:[5,50,95],passedSamplePointsPercent:[5,50,95],decodeDigest:D('decode')}};
  verification.verificationId=canonicalDigest({schema:'libra.product-media-verification-id@1',candidateId:verification.candidateId,
    candidateNodeId:verification.candidateNodeId,candidateBasisDigest:verification.candidateBasisDigest,candidateKind:verification.candidateKind,
    libraRunId:verification.libraRunId,productMaterialHandleId:verification.productMaterialHandleId,
    productMaterialFenceDigest:verification.productMaterialFenceDigest,mediaRequirementDigest:verification.mediaRequirementDigest,
    sourceProbeEvidenceDigest:verification.sourceProbeEvidenceDigest,outputProbeEvidenceDigest:verification.outputProbeEvidenceDigest});
  const selected={schemaRef:'helix://contracts/types/SelectedProductOutput/v1',schemaVersion:1,draftId:'selected-1',draftKind:'selected_product_output',
    basisDigest:D('selection-basis'),draftDigest:D('selection'),producedAtMs:1,libraRunId:'run-1',acceptanceSpecId:'spec-1',
    mediaRequirementDigest:requirement.requirementDigest,criteriaId:'criteria-1',criteriaDigest:D('criteria'),candidateSetDigest:D('candidate-set'),result:'selected',
    selectedCandidateKind:'direct_input',selectedHandleId:'handle-1',selectedWorkspaceMediaHandleId:null,selectedVerificationId:verification.verificationId,
    selectedVerificationDigest:canonicalDigest(verification),selectionReasonCode:'selected_by_declared_rank'};
  return buildProductConformanceInputSnapshot({libraRunId:'run-1',runExecutionBasisDigest:D('run-basis'),acceptanceSpecId:'spec-1',
    acceptanceSpecRecordDigest:D('spec-record'),acceptanceSpec:spec,resolvedIdentitySnapshot:factSet.resolved,
    productFactSnapshots:factSet.items,verifiedArtifactManifest:verified,artifactVerificationSnapshots:[],inventorySnapshot:inventory,
    selectedProducts:[{selectedProduct:selected,verification,workspaceHandleDigest:null}]});
}

test('assembles one closed conformance snapshot and deterministically passes all six rule groups',()=>{
  const input=snapshot(),first=evaluateProductConformance({input,verifiedAtMs:10}),second=evaluateProductConformance({input,verifiedAtMs:10});
  valid('helix://contracts/domain-types/ProductConformanceInputSnapshot/v1',input);
  valid('helix://contracts/types/ProductConformanceEvidence/v1',first);
  assert.equal(first.result,'passed');assert.deepEqual(first.unmetRequirementCodes,[]);assert.deepEqual(first,second);
});

test('returns closed ordered business unmet codes without treating legal absence as integrity failure',()=>{
  const input=snapshot(),changed={...input,acceptanceSpec:{...input.acceptanceSpec,requirements:{...input.acceptanceSpec.requirements,
    metadata:{...input.acceptanceSpec.requirements.metadata,requiredFieldCodes:['actor','title'],requiredArtifactKinds:['nfo'],requireRenderableSidecar:true}}}};
  changed.snapshotDigest=canonicalDigest(Object.fromEntries(Object.entries(changed).filter(([key])=>key!=='snapshotDigest')));
  const result=evaluateProductConformance({input:changed,verifiedAtMs:11});
  assert.equal(result.result,'failed');assert.deepEqual(result.reasonCodes,[]);
  assert.deepEqual(result.unmetRequirementCodes,['metadata_field_unmet','metadata_artifact_unmet','sidecar_unrenderable']);
});

test('rejects a forged nested Product Fact as snapshot integrity failure',()=>{
  const input=snapshot(),forged=JSON.parse(JSON.stringify(input));forged.productFactSnapshots[0].factValue.descriptiveFacts.entries[0].value='Forged';
  forged.snapshotDigest=canonicalDigest(Object.fromEntries(Object.entries(forged).filter(([key])=>key!=='snapshotDigest')));
  const result=evaluateProductConformance({input:forged,verifiedAtMs:12});
  assert.equal(result.result,'failed');assert.deepEqual(result.reasonCodes,['snapshot_integrity_failure']);assert.deepEqual(result.unmetRequirementCodes,[]);
});

test('rejects an unrelated passed Artifact Requirement verification',()=>{
  const base=snapshot(),manifestRequirement=artifactRequirement('required'),foreignRequirement=artifactRequirement('foreign'),
    fixture=artifactContinuityFixture(manifestRequirement,foreignRequirement);
  const artifactManifest=complete({manifestId:'artifact-manifest-foreign',manifestRevision:1,libraRunId:base.libraRunId,
    items:[fixture.inventoryItem],artifactSetDigest:canonicalDigest({schema:'libra.product-artifact-set@1',items:[fixture.inventoryItem]})},'manifestDigest');
  const inventorySnapshot=complete({productStructureSnapshot:base.productStructureSnapshot,
    productMaterialManifest:base.inventorySnapshot.productMaterialManifest,artifactManifest},'inventoryDigest');
  const verifiedArtifactManifest=complete({manifestId:canonicalDigest({schema:'libra.verified-artifact-manifest-id@1',libraRunId:base.libraRunId,
    artifactSetDigest:canonicalDigest({schema:'libra.verified-artifact-set@1',items:[fixture.verifiedItem]})}),libraRunId:base.libraRunId,
    items:[fixture.verifiedItem],artifactSetDigest:canonicalDigest({schema:'libra.verified-artifact-set@1',items:[fixture.verifiedItem]})},'manifestDigest');
  const artifactVerificationSnapshot={ordinal:0,verifiedManifestItem:fixture.verifiedItem,artifactManifestItem:fixture.inventoryItem,
    verificationResultRef:fixture.verificationResultRef,verificationValue:fixture.verification};
  artifactVerificationSnapshot.snapshotDigest=canonicalDigest(artifactVerificationSnapshot);
  assert.throws(()=>buildProductConformanceInputSnapshot({libraRunId:base.libraRunId,runExecutionBasisDigest:base.runExecutionBasisDigest,
    acceptanceSpecId:base.acceptanceSpec.acceptanceSpecId,acceptanceSpecRecordDigest:base.acceptanceSpec.recordDigest,
    acceptanceSpec:base.acceptanceSpec,resolvedIdentitySnapshot:base.resolvedIdentitySnapshot,productFactSnapshots:base.productFactSnapshots,
    verifiedArtifactManifest,artifactVerificationSnapshots:[artifactVerificationSnapshot],inventorySnapshot,selectedProducts:base.selectedProducts}),
  (error)=>error.code==='P9_CONFORMANCE_ARTIFACT_REQUIREMENT');
});

test('rejects a valid Media Requirement derived from a foreign Acceptance Spec',()=>{
  const base=snapshot(),foreignSpec={...acceptanceSpec(),acceptanceSpecId:'spec-foreign',recordDigest:D('foreign-record'),
    requirements:{...acceptanceSpec().requirements,mandatoryMedia:{...acceptanceSpec().requirements.mandatoryMedia,videoCodec:'h264'}}},
    foreignRequirement=buildMediaRequirement(foreignSpec),verification={...base.selectedProducts[0].verification,
      mediaRequirementId:foreignRequirement.requirementId,mediaRequirementDigest:foreignRequirement.requirementDigest};
  verification.verificationId=canonicalDigest({schema:'libra.product-media-verification-id@1',candidateId:verification.candidateId,
    candidateNodeId:verification.candidateNodeId,candidateBasisDigest:verification.candidateBasisDigest,candidateKind:verification.candidateKind,
    libraRunId:verification.libraRunId,productMaterialHandleId:verification.productMaterialHandleId,
    productMaterialFenceDigest:verification.productMaterialFenceDigest,mediaRequirementDigest:verification.mediaRequirementDigest,
    sourceProbeEvidenceDigest:verification.sourceProbeEvidenceDigest,outputProbeEvidenceDigest:verification.outputProbeEvidenceDigest});
  const selectedProduct={...base.selectedProducts[0].selectedProduct,mediaRequirementDigest:foreignRequirement.requirementDigest,
    selectedVerificationId:verification.verificationId,selectedVerificationDigest:canonicalDigest(verification)};
  assert.throws(()=>buildProductConformanceInputSnapshot({libraRunId:base.libraRunId,runExecutionBasisDigest:base.runExecutionBasisDigest,
    acceptanceSpecId:base.acceptanceSpec.acceptanceSpecId,acceptanceSpecRecordDigest:base.acceptanceSpec.recordDigest,
    acceptanceSpec:base.acceptanceSpec,resolvedIdentitySnapshot:base.resolvedIdentitySnapshot,productFactSnapshots:base.productFactSnapshots,
    verifiedArtifactManifest:base.verifiedArtifactManifest,artifactVerificationSnapshots:[],inventorySnapshot:base.inventorySnapshot,
    selectedProducts:[{selectedProduct,verification,workspaceHandleDigest:null}]}),
  (error)=>error.code==='P9_CONFORMANCE_SELECTED_CONTINUITY');
});

test('Coordinator assembles only explicit Plan-bound Owner and Result reads and replays byte-identically',async()=>{
  const expected=snapshot(),calls=[];
  const reader=(name,resolve)=>({async readExact(ref){calls.push([name,JSON.parse(JSON.stringify(ref))]);return resolve(ref);}});
  const factById=new Map(expected.productFactSnapshots.map((item)=>[item.productFactId,item.factValue])),selected=expected.selectedProducts[0];
  let directEnvelope={libraRunId:expected.libraRunId,productMaterialHandle:directMaterial()};
  const readers={
    runBasis:reader('runBasis',()=>({libraRunId:expected.libraRunId,runExecutionBasisDigest:expected.runExecutionBasisDigest})),
    acceptanceSpec:reader('acceptanceSpec',()=>expected.acceptanceSpec),productFact:reader('productFact',(ref)=>factById.get(ref.productFactId)),
    inventory:reader('inventory',()=>expected.inventorySnapshot),verifiedArtifactManifest:reader('verifiedArtifactManifest',()=>expected.verifiedArtifactManifest),
    artifactVerificationResult:reader('artifactVerificationResult',()=>{throw new Error('unexpected');}),
    selectedProductResult:reader('selectedProductResult',()=>selected.selectedProduct),
    productMediaVerificationResult:reader('productMediaVerificationResult',()=>selected.verification),
    directInputMaterial:reader('directInputMaterial',()=>directEnvelope),
    stagingReference:reader('stagingReference',()=>{throw new Error('unexpected');})};
  const binding={runBasisRef:{libraRunId:expected.libraRunId,runExecutionBasisDigest:expected.runExecutionBasisDigest},
    acceptanceSpecRef:{acceptanceSpecId:expected.acceptanceSpec.acceptanceSpecId,specRevision:expected.acceptanceSpec.specRevision,
      recordDigest:expected.acceptanceSpec.recordDigest},inventoryRef:{manifestId:expected.inventorySnapshot.productMaterialManifest.manifestId,
      manifestRevision:expected.inventorySnapshot.productMaterialManifest.manifestRevision,inventoryDigest:expected.inventorySnapshot.inventoryDigest},
    verifiedArtifactManifestRef:{manifestId:expected.verifiedArtifactManifest.manifestId,manifestDigest:expected.verifiedArtifactManifest.manifestDigest},
    productFactRefs:expected.productFactSnapshots.map((item)=>({productFactId:item.productFactId,factKind:item.factKind,
      factRevision:item.factRevision,factDigest:item.factDigest,evidenceDigest:item.evidenceDigest})),artifactVerificationRefs:[],
    selectedProductRefs:[{selectedProductResultRef:{resultId:selected.selectedProduct.draftId,digest:selected.selectedProduct.draftDigest},
      verificationResultRef:{resultId:selected.verification.verificationId,digest:canonicalDigest(selected.verification)},
      provenanceRef:{libraRunId:expected.libraRunId,materialHandleId:selected.verification.productMaterialHandleId},workspaceHandleDigest:null}]};
  const coordinator=createProductConformanceCoordinator({readers}),first=await coordinator.assemble(binding),second=await coordinator.assemble(binding);
  assert.deepEqual(first,expected);assert.deepEqual(second,expected);
  assert.equal(calls.some(([,ref])=>Object.hasOwn(ref,'latest')||Object.hasOwn(ref,'current')),false);
  assert.deepEqual(calls.filter(([name])=>name==='productFact').slice(0,2).map(([,ref])=>ref.productFactId),
    expected.productFactSnapshots.map((item)=>item.productFactId));
  directEnvelope={libraRunId:expected.libraRunId,productMaterialHandle:{...directMaterial(),expectedMtimeNs:2}};
  await assert.rejects(()=>coordinator.assemble(binding),(error)=>error.code==='P9_CONFORMANCE_INPUT_REF');
  directEnvelope={libraRunId:expected.libraRunId,productMaterialHandle:{...directMaterial(),fenceDigest:D('foreign-fence')}};
  await assert.rejects(()=>coordinator.assemble(binding),(error)=>error.code==='P9_CONFORMANCE_INPUT_REF');
  directEnvelope={libraRunId:'run-foreign',productMaterialHandle:directMaterial()};
  await assert.rejects(()=>coordinator.assemble(binding),(error)=>error.code==='P9_CONFORMANCE_INPUT_REF');
});

test('pure Conformance executor has no Repository, Store, Query port, latest read, or Runtime fallback',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../src/helix/domains/libra/model/product-conformance.js'),'utf8');
  assert.doesNotMatch(source,/repository|persistence|readLatest|readCurrent|queryPort|legacy|fallback|kairox/i);
});
