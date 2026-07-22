'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const {canonicalDigest:d}=require('../../src/helix/contracts/canonical-json');
const c=require('../../src/helix/domains/libra/model/delivery-lifecycle-contracts');
const {createDeliveryLifecycleLedger}=require('../../src/helix/domains/libra/persistence/delivery-lifecycle-ledger');
const {CONTRACTS,createDeliveryLifecycleCapabilityRegistrations}=require('../../src/helix/domains/libra/capabilities/delivery-lifecycle-capability-registrations');
const h=(v)=>d({v}),NOW=1_700_000_000_000;

function promotion(){
  const x={decisionId:'promotion-1',libraRunRef:{libraRunId:'run-1',stateRevision:2,stateDigest:h('run'),executionBasisDigest:h('basis'),runScopeDigest:h('scope'),expectedPackageRevisionHead:0},
    runMaterialManifestRef:{manifestId:'manifest-1',manifestDigest:h('manifest')},workspaceRef:{workspaceId:'workspace-1',libraRunId:'run-1',workspaceRevision:3,workspaceStateDigest:h('workspace')},
    productStagingReferences:[{referenceId:'ref-1',workspaceId:'workspace-1',libraRunId:'run-1',materialHandleId:'handle-1',materialKey:h('material'),workspaceMaterialHandle:{handleId:'handle-1'},workspaceHandleDigest:h('handle'),referenceRevision:2,state:'product_staging',episodeClaims:[],episodeScopeDigest:h('episodes'),productVerificationRef:{verificationId:'verify-1'},previousReferenceRevision:1,committedWorkspaceRevision:3,referenceDigest:h('ref')}],
    acceptanceSpecRef:{acceptanceSpecId:'spec-1',recordDigest:h('spec')},resolvedIdentitySnapshot:{productFactId:'identity-1',factRevision:1,schemaRef:'ResolvedProductIdentity@1',factValue:{schemaRef:'ResolvedProductIdentity@1',recordDigest:h('identity-record'),entries:[]},factDigest:h('identity'),evidenceDigest:h('identity-evidence')},
    productStructureSnapshot:{structureKind:'single',contentProfile:'movie',productScopeDigest:h('product-scope'),episodeScopeDigest:h('episodes'),primaryMaterialCount:1,structuralDependencyCount:0,productStructureDigest:h('structure')},
    productFactManifest:{manifestId:'facts-1',manifestRevision:1,libraRunId:'run-1',items:[],factSetDigest:h('facts'),manifestDigest:h('facts-manifest')},
    artifactManifest:{manifestId:'artifacts-1',manifestRevision:1,libraRunId:'run-1',items:[],artifactSetDigest:h('artifacts'),manifestDigest:h('artifact-manifest')},
    mediaCastSnapshot:{mediaCastFactId:'cast-1',mediaCastFactRevision:1,schemaRef:'MediaCastFact@1',factValue:{schemaRef:'MediaCastFact@1',recordDigest:h('cast-record'),entries:[]},factDigest:h('cast'),evidenceDigest:h('cast-evidence'),relations:[],relationsDigest:h('relations')},
    productMaterialManifest:{manifestId:'product-materials-1',manifestRole:'product_delivery',scopeKind:'single',members:[],memberSetDigest:h('members'),manifestDigest:h('product-materials')},
    offloadContextManifest:{manifestId:'offload-1',manifestRevision:1,libraRunId:'run-1',members:[],memberSetDigest:h('offload-members'),manifestDigest:h('offload')},
    productionProvenance:{libraRunId:'run-1',runExecutionBasisDigest:h('basis'),acceptanceSpecRecordDigest:h('spec'),workflowPlanRefs:[],productVerificationRefs:[],externalRealityObservationRefs:[],provenanceDigest:h('provenance')},
    productionAttestation:{attestationId:'attest-1',libraRunId:'run-1',onDeckPackageId:'package-1',acceptanceSpecId:'spec-1',productConformanceEvidenceId:'conformance-1',productConformanceEvidenceDigest:h('conformance'),unmetRequirementCount:0,attestedAtMs:NOW,attestationDigest:h('attestation')},
    controlCommitScope:{items:[{materialKey:h('material'),expectedRevision:1,expectedProjectionDigest:h('control')}],controlScopeDigest:h('control-scope')},onDeckPackageId:'package-1',packageRevision:1,offerId:'offer-1'};
  x.packageDigest=d({schema:'libra.on-deck-product-package@1',libraRunRef:x.libraRunRef,acceptanceSpecRef:x.acceptanceSpecRef,resolvedIdentitySnapshot:x.resolvedIdentitySnapshot,productStructureSnapshot:x.productStructureSnapshot,productFactManifest:x.productFactManifest,artifactManifest:x.artifactManifest,mediaCastSnapshot:x.mediaCastSnapshot,productMaterialManifest:x.productMaterialManifest,offloadContextManifest:x.offloadContextManifest,productionProvenance:x.productionProvenance,productionAttestation:x.productionAttestation});
  x.decisionDigest=d(x);return x;
}

test('promotion publishes immutable package, exact Control commits, receipt and one Offer',()=>{
  const committed=c.buildPromotionCommit({decision:promotion(),committedAtMs:NOW});
  assert.equal(committed.package.packageDigest,promotion().packageDigest);assert.equal(committed.controlCommits.length,1);assert.equal(committed.outbox.offerId,'offer-1');
  assert.throws(()=>c.buildPromotionCommit({decision:{...promotion(),productionAttestation:{...promotion().productionAttestation,unmetRequirementCount:1}},committedAtMs:NOW}),/conformant/);
});

test('Arca rejection leaves package immutable and same-spec rework gets next revision',()=>{
  const p={...c.buildPromotionCommit({decision:promotion(),committedAtMs:NOW}).package,offerId:'offer-1'},rejection={handoffKind:'libra_to_arca',offerId:'offer-1',deliverableId:'package-1',rejectionCode:'mandatory_media_unmet',acceptanceEvidenceSetDigest:h('evidence')};rejection.rejectionDigest=d(rejection);
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
  const ledger=createDeliveryLifecycleLedger(),decision=promotion(),commit=c.buildPromotionCommit({decision,committedAtMs:NOW}),apply=(state)=>{state.packages[decision.onDeckPackageId]=commit.package;state.receipts[commit.receipt.receiptId]=commit.receipt;state.outbox[commit.outbox.messageId]=commit.outbox;return commit.receipt;};
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
