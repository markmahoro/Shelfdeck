'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const {canonicalDigest:d}=require('../../src/helix/contracts/canonical-json');
const c=require('../../src/helix/domains/libra/model/delivery-lifecycle-contracts');
const {
  buildAuthorizedDefectManifest,
  buildDefectAdmissionCandidate,
}=require('../../src/helix/domains/libra/model/defect-admission-contracts');
const {createDeliveryLifecycleLedger}=require('../../src/helix/domains/libra/persistence/delivery-lifecycle-ledger');
const {CONTRACTS,createDeliveryLifecycleCapabilityRegistrations}=require('../../src/helix/domains/libra/capabilities/delivery-lifecycle-capability-registrations');
const h=(v)=>d({v}),NOW=1_700_000_000_000;
const EMPTY_EPISODE_CLAIMS=Object.freeze([]);
const EMPTY_EPISODE_CLAIM_SET_DIGEST=d({
  schema:'libra.production-material-episode-claims@1',
  items:EMPTY_EPISODE_CLAIMS
});
const EMPTY_EPISODE_SCOPE_DIGEST=d({
  schema:'libra.production-episode-scope@1',
  items:EMPTY_EPISODE_CLAIMS
});
const sealPromotion=(x)=>{
  x.packageDigest=c.onDeckProductPackageDigest(x,'subject-1','shelf-1');
  x.offerId=d({schema:'libra.product-offer-id@1',onDeckPackageId:x.onDeckPackageId,packageDigest:x.packageDigest});
  x.decisionDigest=d(Object.fromEntries(Object.entries(x).filter(([key])=>key!=='decisionDigest')));
  return x;
};

function promotion(){
  const packageId=d({schema:'libra.on-deck-package-id@1',libraRunId:'run-1',packageRevision:1});
  const x={decisionId:'promotion-1',libraRunRef:{libraRunId:'run-1',stateRevision:2,stateDigest:h('run'),executionBasisDigest:h('basis'),runScopeDigest:h('scope'),expectedPackageRevisionHead:0},
    runMaterialManifestRef:{manifestId:'manifest-1',manifestDigest:h('manifest')},workspaceRef:{workspaceId:'workspace-1',libraRunId:'run-1',workspaceRevision:3,workspaceStateDigest:h('workspace')},
    productStagingReferences:[{referenceId:'ref-1',workspaceId:'workspace-1',libraRunId:'run-1',materialHandleId:'handle-1',materialKey:h('material'),workspaceMaterialHandle:{handleId:'handle-1'},workspaceHandleDigest:h('handle'),referenceRevision:2,state:'product_staging',episodeClaims:[],episodeScopeDigest:h('episodes'),productVerificationRef:{verificationId:'verify-1',materialRole:'primary_payload',workspaceMaterialHandleId:'handle-1'},previousReferenceRevision:1,committedWorkspaceRevision:3,referenceDigest:h('ref')}],
    acceptanceSpecRef:{acceptanceSpecId:'spec-1',recordDigest:h('spec')},resolvedIdentitySnapshot:{productFactId:'identity-1',factRevision:1,schemaRef:'ResolvedProductIdentity@1',factValue:{schemaRef:'ResolvedProductIdentity@1',recordDigest:h('identity-record'),entries:[]},factDigest:h('identity'),evidenceDigest:h('identity-evidence')},
    productStructureSnapshot:{structureKind:'single',contentProfile:'movie',productScopeDigest:h('product-scope'),episodeScopeDigest:h('episodes'),primaryMaterialCount:1,structuralDependencyCount:0,productStructureDigest:h('structure')},
    productFactManifest:{manifestId:'facts-1',manifestRevision:1,libraRunId:'run-1',items:[],factSetDigest:h('facts'),manifestDigest:h('facts-manifest')},
    artifactManifest:{manifestId:'artifacts-1',manifestRevision:1,libraRunId:'run-1',items:[],artifactSetDigest:h('artifacts'),manifestDigest:h('artifact-manifest')},
    mediaCastSnapshot:{mediaCastFactId:'cast-1',mediaCastFactRevision:1,schemaRef:'MediaCastFact@1',factValue:{schemaRef:'MediaCastFact@1',recordDigest:h('cast-record'),entries:[]},factDigest:h('cast'),evidenceDigest:h('cast-evidence'),relations:[],relationsDigest:h('relations')},
    productMaterialManifest:{manifestId:'product-materials-1',manifestRole:'product_delivery',scopeKind:'single',members:[{
      materialKey:h('material'),role:'primary_payload',controlOperation:'acquire_workspace_product',
      workspaceReferenceId:'ref-1',workspaceMaterialHandle:{handleId:'handle-1'},
      sourceRelatedReferenceId:null,derivedAuthorityDigest:null,
      expectedControlRevision:null,expectedControlProjectionDigest:null,
      committedControlRevision:1,committedControlProjectionDigest:h('committed-control'),
      episodeClaims:EMPTY_EPISODE_CLAIMS,episodeClaimSetDigest:EMPTY_EPISODE_CLAIM_SET_DIGEST
    }],memberSetDigest:h('members'),manifestDigest:h('product-materials')},
    offloadContextManifest:{manifestId:'offload-1',manifestRevision:1,libraRunId:'run-1',members:[],memberSetDigest:h('offload-members'),manifestDigest:h('offload')},
    productionProvenance:{libraRunId:'run-1',runExecutionBasisDigest:h('basis'),acceptanceSpecRecordDigest:h('spec'),workflowPlanRefs:[],productVerificationRefs:[],externalRealityObservationRefs:[],provenanceDigest:h('provenance')},
    productionAttestation:{attestationId:'',libraRunId:'run-1',onDeckPackageId:packageId,acceptanceSpecId:'spec-1',
      acceptanceSpecRecordDigest:h('spec'),productConformanceEvidenceId:'conformance-1',
      productConformanceEvidenceDigest:h('conformance'),evaluatedRequirementSetDigest:h('requirements'),
      productSnapshotDigest:h('product-snapshot'),unmetRequirementCount:0,
      unmetRequirementCodes:[],acceptanceKind:'accepted',authorizedDefectManifest:null,
      attestedAtMs:NOW,attestationDigest:''},
    relatedAuthorityAssertions:[],relatedDispositionSetDigest:d({schema:'libra.related-disposition-set@1',items:[]}),
    controlCommitScope:{items:[{controlOperation:'acquire_workspace_product',materialKey:h('material'),expectedControlState:'absent',
      toOwnerDomain:'libra',toOwnerScopeType:'on_deck_package',toOwnerScopeId:packageId}],
      controlScopeDigest:h('control-scope')},onDeckPackageId:packageId,packageRevision:1,offerId:''};
  x.productionAttestation.attestationId=d({schema:'libra.production-attestation-id@1',libraRunId:'run-1',
    onDeckPackageId:packageId,productConformanceEvidenceId:x.productionAttestation.productConformanceEvidenceId,
    productConformanceEvidenceDigest:x.productionAttestation.productConformanceEvidenceDigest});
  x.productionAttestation.attestationDigest=d(Object.fromEntries(
    Object.entries(x.productionAttestation).filter(([key])=>key!=='attestationDigest')));
  return sealPromotion(x);
}

function actorDefectManifest(libraRunId='run-1'){
  const run=Object.freeze({libraRunId,state:'frozen',stateRevision:3,
    stateDigest:h('frozen')});
  const work=Object.freeze({workId:'work-actor',failureCode:'product_metadata_required_cast_missing',
    capabilityRef:'libra.product_metadata.fetch@1',failureClass:'business_unachievable',
    terminalEvidenceDigest:h('actor-terminal')});
  const terminalBody={blockedWorks:[work]};
  const candidate=buildDefectAdmissionCandidate({run,terminalEvidence:Object.freeze({...terminalBody,
    evidenceDigest:d(terminalBody)})});
  return buildAuthorizedDefectManifest({candidate,actorId:'admin',idempotencyKey:'p9-promotion-defect',
    acknowledged:true,decidedAtMs:NOW});
}

function withAuthorizedMetadataGap(value=promotion(),manifest=actorDefectManifest()){
  const body={...value.productionAttestation,unmetRequirementCount:1,
    unmetRequirementCodes:['metadata_field_unmet'],acceptanceKind:'accepted_with_defects',
    authorizedDefectManifest:manifest};
  delete body.attestationDigest;
  value.productionAttestation={...body,attestationDigest:d(body)};
  return sealPromotion(value);
}
function commitPromotion(value=promotion()){
  return c.buildPromotionCommit({decision:value,committedAtMs:NOW,subjectId:'subject-1',shelfId:'shelf-1',
    controlCommits:value.controlCommitScope.items.map((item)=>({materialKey:item.materialKey,
      controlOperation:item.controlOperation||'acquire_workspace_product',
      committedControlRevision:(item.expectedControlRevision??item.expectedRevision??0)+1,
      committedControlProjectionDigest:h('committed-control')}))});
}

test('promotion publishes immutable package, exact Control commits, receipt and one Offer',()=>{
  const committed=commitPromotion();
  assert.equal(committed.package.packageDigest,promotion().packageDigest);assert.equal(committed.controlCommits.length,1);assert.equal(committed.outbox.offerId,promotion().offerId);
  assert.throws(()=>commitPromotion({...promotion(),productionAttestation:{...promotion().productionAttestation,unmetRequirementCount:1}}),/conformant/);
  const wrongRole=promotion();wrongRole.productStagingReferences[0].productVerificationRef.materialRole='metadata_sidecar';
  wrongRole.productStagingReferences[0].episodeScopeDigest=EMPTY_EPISODE_SCOPE_DIGEST;
  assert.throws(()=>commitPromotion(wrongRole),/one-for-one/);
});

test('promotion accepts only the exact authorized defect gap set',()=>{
  const authorized=withAuthorizedMetadataGap();
  const committed=commitPromotion(authorized);
  assert.equal(committed.package.productionAttestation.acceptanceKind,'accepted_with_defects');
  assert.deepEqual(committed.package.productionAttestation.unmetRequirementCodes,
    ['metadata_field_unmet']);

  const wider=structuredClone(authorized);
  wider.productionAttestation.unmetRequirementCodes=['metadata_field_unmet','max_size_exceeded'];
  wider.productionAttestation.unmetRequirementCount=2;
  delete wider.productionAttestation.attestationDigest;
  wider.productionAttestation.attestationDigest=d(wider.productionAttestation);
  sealPromotion(wider);
  assert.throws(()=>commitPromotion(wider),/conformant/);

  const duplicated=structuredClone(authorized);
  duplicated.productionAttestation.unmetRequirementCodes=
    ['metadata_field_unmet','metadata_field_unmet'];
  duplicated.productionAttestation.unmetRequirementCount=2;
  delete duplicated.productionAttestation.attestationDigest;
  duplicated.productionAttestation.attestationDigest=d(duplicated.productionAttestation);
  sealPromotion(duplicated);
  assert.throws(()=>commitPromotion(duplicated),/conformant/);

  const foreign=withAuthorizedMetadataGap(promotion(),actorDefectManifest('run-other'));
  assert.throws(()=>commitPromotion(foreign),/conformant/);
});

test('promotion joins Product Staging references to Product members by materialKey rather than array position',()=>{
  const value=promotion(),secondKey=h('material-2');
  value.productStagingReferences=[
    {referenceId:'ref-2',workspaceId:'workspace-1',libraRunId:'run-1',materialHandleId:'handle-2',materialKey:secondKey,
      workspaceMaterialHandle:{handleId:'handle-2'},workspaceHandleDigest:h('handle-2'),referenceRevision:2,state:'product_staging',
      episodeClaims:EMPTY_EPISODE_CLAIMS,episodeScopeDigest:EMPTY_EPISODE_SCOPE_DIGEST,
      productVerificationRef:{verificationId:'verify-2',materialRole:'metadata_sidecar',
        workspaceMaterialHandleId:'handle-2'},previousReferenceRevision:1,committedWorkspaceRevision:3,referenceDigest:h('ref-2')},
    value.productStagingReferences[0]
  ];
  value.productMaterialManifest.members=[
    value.productMaterialManifest.members[0],
    {materialKey:secondKey,role:'metadata_sidecar',controlOperation:'acquire_workspace_product',
      workspaceReferenceId:'ref-2',workspaceMaterialHandle:{handleId:'handle-2'},
      episodeClaims:EMPTY_EPISODE_CLAIMS,episodeClaimSetDigest:EMPTY_EPISODE_CLAIM_SET_DIGEST}
  ];
  sealPromotion(value);
  assert.doesNotThrow(()=>c.assertPromotionDecision(value));

  const missing=structuredClone(value);missing.productStagingReferences.pop();
  assert.throws(()=>c.assertPromotionDecision(missing),/one-for-one/);

  const duplicate=structuredClone(value);duplicate.productMaterialManifest.members[1].materialKey=h('material');
  assert.throws(()=>c.assertPromotionDecision(duplicate),/unique material keys/);

  const wrongHandle=structuredClone(value);wrongHandle.productMaterialManifest.members[1].workspaceMaterialHandle.handleId='other-handle';
  assert.throws(()=>c.assertPromotionDecision(wrongHandle),/one-for-one/);
});

test('Related replacement maps one source to its verified successor without duplicating the Product member',()=>{
  const value=promotion(),posterKey=h('poster-product'),sourceKey=h('poster-source'),authority=h('related-authority');
  value.productStagingReferences.push({referenceId:'ref-poster',workspaceId:'workspace-1',libraRunId:'run-1',
    materialHandleId:'handle-poster',materialKey:posterKey,workspaceMaterialHandle:{handleId:'handle-poster'},
    workspaceHandleDigest:h('handle-poster'),referenceRevision:2,state:'product_staging',episodeClaims:EMPTY_EPISODE_CLAIMS,
    episodeScopeDigest:EMPTY_EPISODE_SCOPE_DIGEST,productVerificationRef:{verificationId:'verify-poster',
      materialRole:'poster',workspaceMaterialHandleId:'handle-poster'},previousReferenceRevision:1,
    committedWorkspaceRevision:3,referenceDigest:h('ref-poster')});
  value.productMaterialManifest.members.push({materialKey:posterKey,role:'poster',controlOperation:'acquire_workspace_product',
    workspaceReferenceId:'ref-poster',workspaceMaterialHandle:{handleId:'handle-poster'},sourceRelatedReferenceId:null,
    derivedAuthorityDigest:null,episodeClaims:EMPTY_EPISODE_CLAIMS,episodeClaimSetDigest:EMPTY_EPISODE_CLAIM_SET_DIGEST});
  const assertion={sourceRelatedReferenceId:'related-ref',primaryMaterialKey:h('primary-source'),role:'poster',
    sourceMaterialKey:sourceKey,finalProductMaterialKey:posterKey,associationEvidenceDigest:h('association'),
    dispositionBasisDigest:h('disposition'),bindingRevision:1,bindingEvidenceDigest:h('binding'),
    dispositionKind:'replaced_and_settled',derivedAuthorityDigest:authority};
  assertion.assertionDigest=d(assertion);
  value.relatedAuthorityAssertions=[assertion];
  value.relatedDispositionSetDigest=d({schema:'libra.related-disposition-set@1',items:value.relatedAuthorityAssertions});
  value.offloadContextManifest.members=[{materialKey:sourceKey,contextRole:'related_input',
    sourceRelatedReferenceId:'related-ref',finalProductMaterialKey:posterKey,dispositionKind:'replaced_and_settled',
    derivedAuthorityDigest:authority}];
  value.controlCommitScope.items.push({controlOperation:'acquire_workspace_product',materialKey:posterKey,
    expectedControlState:'absent',toOwnerDomain:'libra',toOwnerScopeType:'on_deck_package',toOwnerScopeId:value.onDeckPackageId});
  sealPromotion(value);
  assert.doesNotThrow(()=>c.assertPromotionDecision(value));
  assert.equal(value.productMaterialManifest.members.filter((item)=>item.role==='poster').length,1);

  const duplicated=structuredClone(value);
  duplicated.productMaterialManifest.members.push({materialKey:sourceKey,role:'poster',controlOperation:'assert_related_input',
    sourceRelatedReferenceId:'related-ref',derivedAuthorityDigest:authority,episodeClaims:EMPTY_EPISODE_CLAIMS,
    episodeClaimSetDigest:EMPTY_EPISODE_CLAIM_SET_DIGEST});
  assert.throws(()=>c.assertPromotionDecision(duplicated),/one-for-one/);
});

test('Arca rejection leaves package immutable and same-spec rework gets next revision',()=>{
  const p={...commitPromotion().package,offerId:'offer-1'},rejection={handoffKind:'libra_to_arca',offerId:'offer-1',deliverableId:p.onDeckPackageId,rejectionCode:'mandatory_media_unmet',acceptanceEvidenceSetDigest:h('evidence')};rejection.rejectionDigest=d(rejection);
  const plan=c.planRework({structuredRejection:rejection,publishedPackage:p,acceptanceSpecRecordDigest:p.acceptanceSpecRef.recordDigest});assert.equal(plan.nextPackageRevision,2);assert.equal(plan.preservePublishedPackage,true);
  assert.throws(()=>c.planRework({structuredRejection:rejection,publishedPackage:p,acceptanceSpecRecordDigest:h('changed')}),/replacement Run/);
});

test('discard requires explicit authorization, releases only Run inputs, and schedules Workspace cleanup',()=>{
  const authorization={authorizationId:'auth-1',authorizationDigest:h('auth'),decision:'discard',libraRunId:'run-1'},runSnapshot={libraRunId:'run-1',state:'frozen',stateRevision:4,stateDigest:h('frozen')},inputControls=[{materialKey:h('input'),ownerDomain:'libra',ownerScopeType:'libra_run',ownerScopeId:'run-1',revision:3}],workspaceMembers=[{materialHandleId:'workspace-handle-1',referenceId:'ref-1'}];
  const result=c.buildDiscardCommit({authorization,runSnapshot,inputControls,workspaceMembers,workspaceId:'workspace-1',decidedAtMs:NOW});assert.equal(result.receipt.terminalState,'discarded');assert.equal(result.releasedInputControls[0].committedDisposition,'uncontrolled');assert.equal(result.cleanupScope.state,'open');
  assert.throws(()=>c.buildDiscardCommit({authorization:{...authorization,decision:'keep'},runSnapshot,inputControls,workspaceMembers,workspaceId:'workspace-1',decidedAtMs:NOW}),/explicit user/);
});

test('off-load admission ignores wake signal, enforces 24h grace and last reference',()=>{
  const completedAtMs=NOW-24*60*60*1000,completion={packageId:'package-1',completedAtMs,completionDigest:h('completion')},trigger={kind:'offload_completed',triggerId:'offload-1',triggerDigest:completion.completionDigest,packageId:'package-1',offloadCompletion:completion},workspaceSnapshot={workspaceId:'workspace-1',libraRunId:'run-1',state:'active'},currentReferences=[{materialHandleId:'handle-1',referenceId:'ref-1',referenceRevision:2,referenceDigest:h('ref'),state:'product_staging',liveReferenceCount:1,controlFence:null},{materialHandleId:'shared',referenceId:'ref-2',referenceRevision:1,referenceDigest:h('shared'),state:'product_staging',liveReferenceCount:2,controlFence:null}];
  const scope=c.admitCleanupScope({trigger,workspaceSnapshot,currentReferences,nowMs:NOW});assert.deepEqual(scope.members.map((x)=>x.materialHandleId),['handle-1']);
  assert.throws(()=>c.admitCleanupScope({trigger:{...trigger,offloadCompletion:null},workspaceSnapshot,currentReferences,nowMs:NOW}),/Signal alone/);
  assert.throws(()=>c.admitCleanupScope({trigger,workspaceSnapshot,currentReferences,nowMs:NOW-1}),/grace/);
});

test('cleanup releases Reference and Control only after exact deletion evidence',()=>{
  const scope=c.buildCleanupScope({triggerKind:'run_discarded',triggerId:'discard-1',triggerDigest:h('discard'),libraRunId:'run-1',workspaceId:'workspace-1',eligibleAtMs:NOW,members:[{materialHandleId:'handle-1'}]}),member={materialHandleId:'handle-1',memberStateRevision:1,memberState:'pending',memberStateDigest:h('member')},handle={handleId:'handle-1',workspaceId:'workspace-1',fenceDigest:h('fence')},intent=c.buildCleanupEffectIntent({cleanupScope:scope,member,workspaceMaterialHandle:handle});
  const decision={decisionId:'cleanup-1',cleanupScopeId:scope.cleanupScopeId,expectedScopeStateRevision:scope.stateRevision,expectedScopeStateDigest:scope.stateDigest,workspaceId:'workspace-1',expectedWorkspaceRevision:1,expectedWorkspaceStateDigest:h('workspace'),materialHandleId:'handle-1',expectedReferenceRevision:1,expectedReferenceDigest:h('ref'),expectedMemberStateRevision:1,expectedMemberStateDigest:member.memberStateDigest,outcome:{kind:'deletion_verified',deletionEvidence:{effectIdempotencyKey:intent.effectIdempotencyKey,evidenceDigest:h('deletion')}},expectedControlFence:{materialKey:h('material'),controlDisposition:'libra_owned',revision:1,projectionDigest:h('control'),ownerDomain:'libra',ownerScopeType:'cleanup_scope',ownerScopeId:scope.cleanupScopeId}};decision.decisionDigest=d(decision);
  const result=c.commitCleanupOutcome({decision,cleanupScope:scope,member,effectIntent:intent,committedAtMs:NOW});assert.equal(result.receipt.referenceReleased,true);assert.equal(result.receipt.controlReleased,true);
  const blocked={...decision,outcome:{kind:'terminal_blocked',blockingEvidence:{reasonCode:'deletion_not_verified',evidenceDigest:h('blocked')}}};blocked.decisionDigest=d(Object.fromEntries(Object.entries(blocked).filter(([k])=>k!=='decisionDigest')));const blockedResult=c.commitCleanupOutcome({decision:blocked,cleanupScope:scope,member,effectIntent:intent,committedAtMs:NOW});assert.equal(blockedResult.receipt.controlReleased,false);
});

test('atomic delivery ledger rolls back crashes and replays byte-identical result',()=>{
  const ledger=createDeliveryLifecycleLedger(),decision=promotion(),commit=commitPromotion(decision),apply=(state)=>{state.packages[decision.onDeckPackageId]=commit.package;state.receipts[commit.receipt.receiptId]=commit.receipt;state.outbox[commit.outbox.messageId]=commit.outbox;return commit.receipt;};
  assert.throws(()=>ledger.commit({marker:'promotion-1',transactionId:'helix.transaction.libra-deliverable-promotion',commitDigest:decision.decisionDigest,apply,faultAt:'after-domain'}),/fault/);assert.deepEqual(ledger.snapshot().packages,{});
  const first=ledger.commit({marker:'promotion-1',transactionId:'helix.transaction.libra-deliverable-promotion',commitDigest:decision.decisionDigest,apply}),replay=ledger.commit({marker:'promotion-1',transactionId:'helix.transaction.libra-deliverable-promotion',commitDigest:decision.decisionDigest,apply});assert.deepEqual(replay,first);assert.equal(Object.keys(ledger.snapshot().outbox).length,1);
});

test('P9 transaction registry freezes exact atomic sets and forbids Arca writes in cleanup admission',()=>{
  const fs=require('node:fs'),base='../../src/helix/contracts/transaction-contracts/';
  for(const id of ['helix.transaction.libra-deliverable-promotion','helix.transaction.libra-run-discard-commit','helix.transaction.libra-workspace-cleanup-scope-admission','helix.transaction.libra-workspace-cleanup-commit']){const contract=require(base+id+'/v1/contract.json').contract;assert.equal(contract.fenceContract.commitMarkerRequired,true);assert.match(contract.rollbackInvariant,/zero transaction writes/);}
  const admission=require(base+'helix.transaction.libra-workspace-cleanup-scope-admission/v1/contract.json').contract;assert.deepEqual(admission.forbiddenWritePrefixes.sort(),['arca_','proc_']);
});

test('delivery lifecycle registers only the three frozen P9 capabilities',()=>{
  const manifests={},ports={};for(const [capabilityRef,effectClass] of Object.entries(CONTRACTS)){manifests[capabilityRef]={capabilityRef,ownerScope:'libra',effectClass,contractVersion:1,semanticValidatorRef:`validator:${capabilityRef}`};ports[capabilityRef]={execute(){},validateInputs(){},validateResult(){}};}
  assert.equal(createDeliveryLifecycleCapabilityRegistrations({manifests,ports}).length,3);
  assert.throws(()=>createDeliveryLifecycleCapabilityRegistrations({manifests,ports:{...ports,[Object.keys(ports)[0]]:null}}),/drifted/);
});
