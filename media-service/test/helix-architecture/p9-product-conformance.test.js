'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { buildProductConformanceFactSnapshot, buildProductConformanceInputSnapshot,
  evaluateProductConformance } = require('../../src/helix/domains/libra/model/product-conformance');
const { createProductConformanceCoordinator } = require('../../src/helix/domains/libra/application/media-production-coordinator');

const D = (value) => canonicalDigest({ value });
const complete = (value, field) => ({ ...value, [field]:canonicalDigest(value) });

function acceptanceSpec() {
  return { schemaRef:'libra.acceptance-spec@1', schemaVersion:1, draftId:'draft-1', draftKind:'acceptance_spec',
    basisDigest:D('basis'), draftDigest:D('draft'), producedAtMs:1, subjectId:'subject-1', targetShelfId:'shelf-1',
    contentProfile:'movie', structureKind:'single', productScope:{scopeKind:'product',episodeKeys:[],scopeDigest:D('scope')},
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
    physicalIdentity:{schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v1',schemaVersion:1,materialKey:D('material'),mountScopeId:'mount-1',
      inode:'1',contentHashAlgorithm:'sha256',contentHash:D('bytes')},sizeBytes:100,
    location:{locationKind:'domain_binding',endpointId:'endpoint-1',location:'movie.mkv',rootHandleRef:null,relativePath:null},
    bindingKind:'libra_material_binding',bindingRevision:1,bindingEvidenceDigest:D('binding'),originCandidateDeliveryRef:{intakeDecisionId:'intake-1',
      offerId:'offer-1',candidatePackageId:'candidate-1',packageRevision:1,packageDigest:D('candidate'),candidateDeliverySnapshotDigest:D('delivery'),
      relatedReferenceSetDigest:D('related')},workspaceReferenceId:null,workspaceMaterialHandle:null,admittedControlRevision:1,
    admittedControlProjectionDigest:D('admitted-control'),outputRequirementDigest:D('output-requirement'),episodeClaims:[],
    episodeClaimSetDigest:canonicalDigest({schema:'libra.production-material-episode-claims@1',items:[]}),controlOperation:'assert_existing_input',
    expectedControlRevision:1,expectedControlProjectionDigest:D('expected-control'),committedControlRevision:2,
    committedControlProjectionDigest:D('committed-control')}, 'memberDigest');
  return complete({manifestId:'material-manifest-1',manifestRole:'product_delivery',manifestRevision:1,libraRunId:'run-1',scopeKind:'single',members:[member],
    memberSetDigest:canonicalDigest({schema:'libra.production-material-members@1',items:[member]}),
    episodeScopeDigest:canonicalDigest({schema:'libra.production-episode-scope@1',items:[]})}, 'manifestDigest');
}

function snapshot() {
  const factSet = facts(), structure = complete({structureKind:'single',contentProfile:'movie',productScopeDigest:D('scope'),
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
    producingEventId:null,productMaterialHandleId:'handle-1',productMaterialHandleDigest:D('handle'),productMaterialFenceDigest:D('fence'),
    workspaceMediaHandleId:null,mediaRequirementId:'requirement-1',mediaRequirementDigest:D('requirement'),sourceProbeEvidenceId:'probe-1',
    sourceProbeEvidenceDigest:D('source-probe'),outputProbeEvidenceId:'probe-1',outputProbeEvidenceDigest:D('source-probe'),qualitySummary:{},spaceSummary:{}};
  const selected={schemaRef:'helix://contracts/types/SelectedProductOutput/v1',schemaVersion:1,draftId:'selected-1',draftKind:'selected_product_output',
    basisDigest:D('selection-basis'),draftDigest:D('selection'),producedAtMs:1,libraRunId:'run-1',acceptanceSpecId:'spec-1',
    mediaRequirementDigest:D('requirement'),criteriaId:'criteria-1',criteriaDigest:D('criteria'),candidateSetDigest:D('candidate-set'),result:'selected',
    selectedCandidateKind:'direct_input',selectedHandleId:'handle-1',selectedWorkspaceMediaHandleId:null,selectedVerificationId:'verification-1',
    selectedVerificationDigest:canonicalDigest(verification),selectionReasonCode:'selected_by_declared_rank'};
  return buildProductConformanceInputSnapshot({libraRunId:'run-1',runExecutionBasisDigest:D('run-basis'),acceptanceSpecId:'spec-1',
    acceptanceSpecRecordDigest:D('spec-record'),acceptanceSpec:acceptanceSpec(),resolvedIdentitySnapshot:factSet.resolved,
    productFactSnapshots:factSet.items,verifiedArtifactManifest:verified,artifactVerificationSnapshots:[],inventorySnapshot:inventory,
    selectedProducts:[{selectedProduct:selected,verification,workspaceHandleDigest:null}]});
}

test('assembles one closed conformance snapshot and deterministically passes all six rule groups',()=>{
  const input=snapshot(),first=evaluateProductConformance({input,verifiedAtMs:10}),second=evaluateProductConformance({input,verifiedAtMs:10});
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

test('Coordinator assembles only explicit Plan-bound Owner and Result reads and replays byte-identically',async()=>{
  const expected=snapshot(),calls=[];
  const reader=(name,resolve)=>({async readExact(ref){calls.push([name,JSON.parse(JSON.stringify(ref))]);return resolve(ref);}});
  const factById=new Map(expected.productFactSnapshots.map((item)=>[item.productFactId,item.factValue])),selected=expected.selectedProducts[0];
  const readers={
    runBasis:reader('runBasis',()=>({libraRunId:expected.libraRunId,runExecutionBasisDigest:expected.runExecutionBasisDigest})),
    acceptanceSpec:reader('acceptanceSpec',()=>expected.acceptanceSpec),productFact:reader('productFact',(ref)=>factById.get(ref.productFactId)),
    inventory:reader('inventory',()=>expected.inventorySnapshot),verifiedArtifactManifest:reader('verifiedArtifactManifest',()=>expected.verifiedArtifactManifest),
    artifactVerificationResult:reader('artifactVerificationResult',()=>{throw new Error('unexpected');}),
    selectedProductResult:reader('selectedProductResult',()=>selected.selectedProduct),
    productMediaVerificationResult:reader('productMediaVerificationResult',()=>selected.verification),
    directInputMaterial:reader('directInputMaterial',()=>({productMaterialHandleId:selected.verification.productMaterialHandleId})),
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
});

test('pure Conformance executor has no Repository, Store, Query port, latest read, or Runtime fallback',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../src/helix/domains/libra/model/product-conformance.js'),'utf8');
  assert.doesNotMatch(source,/repository|persistence|readLatest|readCurrent|queryPort|legacy|fallback|kairox/i);
});
