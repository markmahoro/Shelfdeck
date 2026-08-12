'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');

class DeliveryLifecycleContractError extends Error{constructor(code,message){super(message);this.name='DeliveryLifecycleContractError';this.code=code;}}
const fail=(code,message)=>{throw new DeliveryLifecycleContractError(code,message);};
const DIGEST=/^[a-f0-9]{64}$/;
const text=(value,name)=>{if(typeof value!=='string'||!value)fail('P9_DELIVERY_VALUE',name+' is required.');return value;};
const digest=(value,name)=>{if(!DIGEST.test(value||''))fail('P9_DELIVERY_DIGEST',name+' is invalid.');return value;};
const integer=(value,name,min=0)=>{if(!Number.isSafeInteger(value)||value<min)fail('P9_DELIVERY_INTEGER',name+' is invalid.');return value;};
const clone=(value)=>JSON.parse(canonicalJson(value));
const freeze=(value)=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const without=(value,key)=>Object.fromEntries(Object.entries(value).filter(([name])=>name!==key));
const withoutPackageDigestFields=(value)=>Object.fromEntries(Object.entries(value)
  .filter(([name])=>!['manifestDigest','publishedAtMs','packageDigest'].includes(name)));
const relative=(value)=>{text(value,'relativePath');const p=value.split('/');if(value.includes('\\')||value.startsWith('/')||/^[A-Za-z]:/.test(value)||p.some((x)=>!x||x==='.'||x==='..'))fail('P9_DELIVERY_PATH','Path must be canonical root-relative.');return value;};

function packageContentValue(decision,subjectId,shelfId){
  const members=decision.productMaterialManifest.members;
  const identity=decision.resolvedIdentitySnapshot;
  return {
    schemaRef:'helix://contracts/types/OnDeckProductPackage/v1',schemaVersion:1,
    manifestId:decision.onDeckPackageId,manifestKind:'on_deck_product_package',ownerDomain:'libra',
    memberCount:members.length,membersDigest:decision.productMaterialManifest.memberSetDigest,
    onDeckPackageId:decision.onDeckPackageId,packageRevision:decision.packageRevision,
    libraRunId:decision.libraRunRef.libraRunId,runStateRevision:decision.libraRunRef.stateRevision,
    runStateDigest:decision.libraRunRef.stateDigest,runExecutionBasisDigest:decision.libraRunRef.executionBasisDigest,
    subjectId:text(subjectId,'subjectId'),shelfId:text(shelfId,'shelfId'),
    acceptanceSpecRef:{id:decision.acceptanceSpecRef.acceptanceSpecId,recordDigest:decision.acceptanceSpecRef.recordDigest},
    resolvedIdentitySnapshot:{
      productFactId:identity.productFactId,factRevision:identity.factRevision,
      schemaRef:identity.schemaRef,factValue:clone(identity.factValue),
      factDigest:identity.factDigest,evidenceDigest:identity.evidenceDigest
    },
    productStructureSnapshot:clone(decision.productStructureSnapshot),
    runMaterialManifestRef:{id:decision.runMaterialManifestRef.manifestId,digest:decision.runMaterialManifestRef.manifestDigest},
    productMaterialManifest:clone(decision.productMaterialManifest),productFactManifest:clone(decision.productFactManifest),
    artifactManifest:clone(decision.artifactManifest),mediaCastSnapshot:clone(decision.mediaCastSnapshot),
    offloadContextManifest:clone(decision.offloadContextManifest),productionProvenance:clone(decision.productionProvenance),
    productionAttestation:clone(decision.productionAttestation)
  };
}

function onDeckProductPackageDigest(decision,subjectId,shelfId){
  return canonicalDigest(packageContentValue(decision,subjectId,shelfId));
}

function buildOnDeckProductPackage(decision,subjectId,shelfId,publishedAtMs){
  const content=packageContentValue(decision,subjectId,shelfId);
  const packageDigest=canonicalDigest(content);
  if(decision.packageDigest!==packageDigest)
    fail('P9_PROMOTION_PACKAGE_DIGEST','Promotion Package digest does not cover the complete nominal Package.');
  return freeze({...content,manifestDigest:packageDigest,publishedAtMs:integer(publishedAtMs,'publishedAtMs'),
    packageDigest});
}

function verifyOnDeckProductPackageDigest(value){
  const expected=canonicalDigest(withoutPackageDigestFields(value));
  if(value.manifestDigest!==expected||value.packageDigest!==expected)
    fail('P9_PRODUCT_DELIVERY_PACKAGE_DIGEST','Reconstructed Product Package content digest drifted.');
  return expected;
}

function assertPromotionDecision(value){
  if(!value||!Array.isArray(value.productStagingReferences)||value.productStagingReferences.some((item)=>item.state!=='product_staging')||
      value.productionAttestation?.unmetRequirementCount!==0||!Array.isArray(value.controlCommitScope?.items))
    fail('P9_PROMOTION_INPUT','Promotion requires staged, verified, conformant Product input.');
  const refs=value.productStagingReferences;
  if(new Set(refs.map((item)=>item.referenceId)).size!==refs.length||new Set(refs.map((item)=>item.materialKey)).size!==refs.length)
    fail('P9_PROMOTION_DUPLICATE','Promotion material references must be unique.');
  const members=value.productMaterialManifest?.members;
  if(!Array.isArray(members)||new Set(members.map((item)=>item.materialKey)).size!==members.length)
    fail('P9_PROMOTION_DUPLICATE','Promotion Product members must have unique material keys.');
  const assertions=value.relatedAuthorityAssertions;
  if(!Array.isArray(assertions)||assertions.length>1024||
      assertions.some((item,index)=>index>0&&Buffer.compare(Buffer.from(assertions[index-1].sourceRelatedReferenceId),
        Buffer.from(item.sourceRelatedReferenceId))>=0)||
      assertions.some((item)=>item.assertionDigest!==canonicalDigest(without(item,'assertionDigest')))||
      value.relatedDispositionSetDigest!==canonicalDigest({schema:'libra.related-disposition-set@1',items:assertions}))
    fail('P9_PROMOTION_RELATED_SCOPE','Promotion Related authority set is incomplete, unordered, or invalid.');
  const relatedMembers=members.filter((item)=>item.controlOperation==='assert_related_input');
  const relatedOffload=(value.offloadContextManifest?.members||[]).filter((item)=>item.contextRole==='related_input');
  if(relatedMembers.length!==assertions.length||relatedOffload.length!==assertions.length||assertions.some((assertion)=>{
    const member=relatedMembers.find((item)=>item.sourceRelatedReferenceId===assertion.sourceRelatedReferenceId);
    const offload=relatedOffload.find((item)=>item.sourceRelatedReferenceId===assertion.sourceRelatedReferenceId);
    return !member||!offload||member.materialKey!==assertion.finalProductMaterialKey||
      member.derivedAuthorityDigest!==assertion.derivedAuthorityDigest||offload.materialKey!==assertion.sourceMaterialKey||
      offload.finalProductMaterialKey!==assertion.finalProductMaterialKey||offload.dispositionKind!==assertion.dispositionKind||
      offload.derivedAuthorityDigest!==assertion.derivedAuthorityDigest;
  })) fail('P9_PROMOTION_RELATED_MAPPING','Related assertions must match Product and Off-load mappings one-for-one.');
  const emptyClaims=Object.freeze([]),
    emptyClaimSetDigest=canonicalDigest({schema:'libra.production-material-episode-claims@1',items:emptyClaims}),
    emptyEpisodeScopeDigest=canonicalDigest({schema:'libra.production-episode-scope@1',items:emptyClaims});
  if(members.some((member)=>!Array.isArray(member.episodeClaims)||
      (member.role!=='primary_payload'&&(member.episodeClaims.length!==0||
        member.episodeClaimSetDigest!==emptyClaimSetDigest)))||
      refs.some((ref)=>ref.productVerificationRef?.materialRole!=='primary_payload'&&
        (!Array.isArray(ref.episodeClaims)||ref.episodeClaims.length!==0||
          ref.episodeScopeDigest!==emptyEpisodeScopeDigest)))
    fail('P9_PROMOTION_EPISODE_ROLE',
      'Only Primary Product members may carry Episode claims.');
  const workspaceMembers=members.filter((item)=>item.controlOperation==='acquire_workspace_product');
  const memberByMaterialKey=new Map(workspaceMembers.map((item)=>[item.materialKey,item]));
  if(workspaceMembers.length!==refs.length||refs.some((ref)=>{
    const member=memberByMaterialKey.get(ref.materialKey);
    const memberHandleId=member?.workspaceMaterialHandle?.handleId;
    return !member||member.workspaceReferenceId!==ref.referenceId||
      memberHandleId!==ref.materialHandleId||
      ref.productVerificationRef?.materialRole!==member.role||
      ref.productVerificationRef?.workspaceMaterialHandleId!==memberHandleId;
  }))
    fail('P9_PROMOTION_STAGING_ROLE','Product Staging References must match Product members one-for-one by material and role.');
  if(value.workspaceRef===null){
    if(refs.length!==0||workspaceMembers.length!==0)
      fail('P9_PROMOTION_RUN','Direct-original Promotion cannot carry Workspace Product members.');
  }else if(!value.workspaceRef||
      refs.some((item)=>item.libraRunId!==value.libraRunRef.libraRunId||item.workspaceId!==value.workspaceRef.workspaceId)){
    fail('P9_PROMOTION_RUN','Promotion inputs cross a Run or Workspace boundary.');
  }
  const onDeckPackageId=canonicalDigest({schema:'libra.on-deck-package-id@1',
    libraRunId:value.libraRunRef.libraRunId,packageRevision:value.packageRevision});
  const attestation=value.productionAttestation;
  const attestationId=canonicalDigest({schema:'libra.production-attestation-id@1',
    libraRunId:value.libraRunRef.libraRunId,onDeckPackageId,
    productConformanceEvidenceId:attestation?.productConformanceEvidenceId,
    productConformanceEvidenceDigest:attestation?.productConformanceEvidenceDigest});
  if(value.onDeckPackageId!==onDeckPackageId||!DIGEST.test(value.packageDigest||'')||
      value.offerId!==canonicalDigest({schema:'libra.product-offer-id@1',onDeckPackageId,
        packageDigest:value.packageDigest})||
      attestation?.attestationId!==attestationId||
      attestation?.attestationDigest!==canonicalDigest(without(attestation||{},'attestationDigest'))||
      value.decisionDigest!==canonicalDigest(without(value,'decisionDigest')))
    fail('P9_PROMOTION_DIGEST','Promotion Decision digest continuity is invalid.');
  return value;
}

function buildPromotionCommit(value){
  const decision=assertPromotionDecision(value.decision),committedAtMs=integer(value.committedAtMs,'committedAtMs'),
    subjectId=text(value.subjectId,'subjectId'),shelfId=text(value.shelfId,'shelfId');
  const controlCommits=[...(value.controlCommits||[])].sort((left,right)=>
    Buffer.compare(Buffer.from(left.materialKey),Buffer.from(right.materialKey)));
  if(controlCommits.length!==decision.controlCommitScope.items.length||
      controlCommits.some((item,index)=>{
        const expected=decision.controlCommitScope.items[index];
        const member=decision.productMaterialManifest.members.find((candidate)=>
          candidate.materialKey===item.materialKey);
        return item.materialKey!==expected.materialKey||item.controlOperation!==expected.controlOperation||
          item.committedControlRevision!==(expected.controlOperation==='assert_existing_input'
            ? expected.expectedControlRevision:1)||!DIGEST.test(item.committedControlProjectionDigest||'')||
          !member||member.committedControlRevision!==item.committedControlRevision||
          member.committedControlProjectionDigest!==item.committedControlProjectionDigest;
      }))fail('P9_PROMOTION_CONTROL_RESULT','Committed Control set does not match the exact Promotion scope.');
  const controlRevisionSetDigest=canonicalDigest({schema:'libra.product-control-revision-set@1',
    onDeckPackageId:decision.onDeckPackageId,items:controlCommits});
  const packageValue=buildOnDeckProductPackage(decision,subjectId,shelfId,committedAtMs);
  const receipt={schemaRef:'helix://contracts/types/OnDeckProductPackageCommitReceipt/v1',schemaVersion:1,
    receiptId:canonicalDigest({schema:'libra.product-package-commit-receipt-id@1',
      onDeckPackageId:decision.onDeckPackageId,packageRevision:decision.packageRevision}),
    receiptKind:'libra_product_package_published',ownerDomain:'libra',scopeType:'on_deck_package',
    scopeId:decision.onDeckPackageId,scopeDigest:decision.decisionDigest,effectReceiptRef:null,committedAtMs,
    promotionDecisionDigest:decision.decisionDigest,onDeckPackageId:decision.onDeckPackageId,
    packageRevision:decision.packageRevision,packageDigest:decision.packageDigest,offerId:decision.offerId,
    libraRunId:decision.libraRunRef.libraRunId,verifiedRunStateRevision:decision.libraRunRef.stateRevision,
    verifiedRunStateDigest:decision.libraRunRef.stateDigest,
    productMaterialManifestDigest:decision.productMaterialManifest.manifestDigest,
    productFactSetDigest:decision.productFactManifest.factSetDigest,
    productFactManifestDigest:decision.productFactManifest.manifestDigest,
    artifactManifestDigest:decision.artifactManifest.manifestDigest,
    offloadContextDigest:decision.offloadContextManifest.manifestDigest,
    relatedDispositionSetDigest:decision.relatedDispositionSetDigest,controlRevisionSetDigest};
  receipt.receiptDigest=canonicalDigest(receipt);
  const messageId=canonicalDigest({schema:'libra.product-offer-message-id@1',offerId:decision.offerId,
    packageDigest:decision.packageDigest});
  const outbox={messageKind:'libra.product-offer.available@1',messageId,offerId:decision.offerId,
    onDeckPackageId:decision.onDeckPackageId,packageRevision:decision.packageRevision,
    packageDigest:decision.packageDigest,libraRunId:decision.libraRunRef.libraRunId,subjectId,shelfId,
    acceptanceSpecId:decision.acceptanceSpecRef.acceptanceSpecId,
    relatedDispositionSetDigest:decision.relatedDispositionSetDigest,dedupKey:messageId};
  return freeze({package:packageValue,receipt,outbox,controlCommits,controlRevisionSetDigest});
}

function planRework(value){
  const rejection=value?.structuredRejection,previous=value?.publishedPackage;
  if(!rejection||rejection.handoffKind!=='libra_to_arca'||rejection.offerId!==previous?.offerId||rejection.deliverableId!==previous?.onDeckPackageId||
      rejection.rejectionDigest!==canonicalDigest(without(rejection,'rejectionDigest')))fail('P9_REWORK_REJECTION','Rework requires the exact Arca rejection projection.');
  if(value.acceptanceSpecRecordDigest!==previous.acceptanceSpecRef.recordDigest)fail('P9_REWORK_SPEC_CHANGED','Changed Acceptance Spec requires a replacement Run, not same-Run rework.');
  return freeze({libraRunId:previous.libraRunId,sourcePackageId:previous.onDeckPackageId,sourcePackageRevision:previous.packageRevision,
    sourcePackageDigest:previous.packageDigest,nextPackageRevision:previous.packageRevision+1,rejectionDigest:rejection.rejectionDigest,
    preservePublishedPackage:true,reworkBasisDigest:canonicalDigest({schema:'libra.rejection-rework-basis@1',libraRunId:previous.libraRunId,
      sourcePackageId:previous.onDeckPackageId,sourcePackageRevision:previous.packageRevision,sourcePackageDigest:previous.packageDigest,rejectionDigest:rejection.rejectionDigest})});
}

function buildDiscardCommit(value){
  const run=value?.runSnapshot;
  if(!run||run.state!=='frozen'||value.authorization?.decision!=='discard'||value.authorization?.libraRunId!==run.libraRunId)
    fail('P9_DISCARD_AUTHORIZATION','Only an explicit user Discard Decision may discard a frozen Run.');
  const inputControls=clone(value.inputControls||[]),workspaceMembers=clone(value.workspaceMembers||[]);
  if(inputControls.some((item)=>item.ownerDomain!=='libra'||item.ownerScopeType!=='libra_run'||item.ownerScopeId!==run.libraRunId))
    fail('P9_DISCARD_CONTROL','Discard input Control set is not the exact Run scope.');
  const basis={libraRunId:run.libraRunId,expectedStateRevision:run.stateRevision,expectedStateDigest:run.stateDigest,
    authorizationId:text(value.authorization.authorizationId,'authorizationId'),authorizationDigest:digest(value.authorization.authorizationDigest,'authorizationDigest'),
    inputControlSetDigest:canonicalDigest({schema:'libra.run-discard-input-controls@1',items:inputControls}),
    workspaceMemberSetDigest:canonicalDigest({schema:'libra.run-discard-workspace-members@1',items:workspaceMembers})};
  const decision={decisionId:canonicalDigest({schema:'libra.run-discard-decision-id@1',...basis}),...basis,decidedAtMs:integer(value.decidedAtMs,'decidedAtMs')};decision.decisionDigest=canonicalDigest(decision);
  const cleanupScope=buildCleanupScope({triggerKind:'run_discarded',triggerId:decision.decisionId,triggerDigest:decision.decisionDigest,
    libraRunId:run.libraRunId,workspaceId:text(value.workspaceId,'workspaceId'),members:workspaceMembers,eligibleAtMs:decision.decidedAtMs});
  const releasedInputControls=inputControls.map((item)=>freeze({...item,committedRevision:item.revision+1,committedDisposition:'uncontrolled'}));
  const receipt={receiptId:canonicalDigest({schema:'libra.run-discard-receipt-id@1',decisionId:decision.decisionId}),libraRunId:run.libraRunId,
    decisionId:decision.decisionId,decisionDigest:decision.decisionDigest,terminalState:'discarded',releasedInputControls,cleanupScopeId:cleanupScope.cleanupScopeId,
    committedAtMs:decision.decidedAtMs};receipt.receiptDigest=canonicalDigest(receipt);
  return freeze({decision,receipt,cleanupScope,releasedInputControls});
}

function buildCleanupScope(value){
  const members=clone(value.members||[]).sort((a,b)=>Buffer.compare(Buffer.from(a.materialHandleId),Buffer.from(b.materialHandleId)));
  if(!members.length)fail('P9_CLEANUP_EMPTY','Cleanup Scope cannot be empty.');
  if(new Set(members.map((item)=>item.materialHandleId)).size!==members.length)fail('P9_CLEANUP_DUPLICATE','Cleanup members must be unique.');
  const triggerKind=value.triggerKind;
  if(!['run_discarded','offload_completed','superseded_orphan'].includes(triggerKind))fail('P9_CLEANUP_TRIGGER','Cleanup trigger is invalid.');
  const common={triggerKind,triggerId:text(value.triggerId,'triggerId'),triggerDigest:digest(value.triggerDigest,'triggerDigest'),
    libraRunId:text(value.libraRunId,'libraRunId'),workspaceId:text(value.workspaceId,'workspaceId'),members,
    memberSetDigest:canonicalDigest({schema:'libra.workspace-cleanup-members@1',items:members}),eligibleAtMs:integer(value.eligibleAtMs,'eligibleAtMs')};
  const cleanupScopeId=canonicalDigest({schema:'libra.workspace-cleanup-scope-id@1',triggerKind,triggerId:common.triggerId,triggerDigest:common.triggerDigest,workspaceId:common.workspaceId});
  const scope={cleanupScopeId,stateRevision:1,state:'open',...common};scope.stateDigest=canonicalDigest(scope);return freeze(scope);
}

function admitCleanupScope(value){
  const trigger=value?.trigger,workspace=value?.workspaceSnapshot,references=value?.currentReferences||[];
  if(!workspace||workspace.state!=='active')fail('P9_CLEANUP_WORKSPACE','Cleanup requires an active Workspace snapshot.');
  let eligibleAtMs;
  if(trigger.kind==='offload_completed'){
    if(!trigger.offloadCompletion||trigger.offloadCompletion.packageId!==trigger.packageId||trigger.offloadCompletion.completionDigest!==trigger.triggerDigest)
      fail('P9_CLEANUP_OFFLOAD','Signal alone cannot establish cleanup eligibility.');
    eligibleAtMs=trigger.offloadCompletion.completedAtMs+24*60*60*1000;
    if(value.nowMs<eligibleAtMs)fail('P9_CLEANUP_GRACE','Off-load cleanup grace has not elapsed.');
  }else if(trigger.kind==='superseded_orphan'){
    if(trigger.runState!=='superseded'||trigger.orphanPassCount<2)fail('P9_CLEANUP_ORPHAN','Orphan cleanup requires a terminal Run and two scans.');
    eligibleAtMs=value.nowMs;
  }else fail('P9_CLEANUP_TRIGGER','Discard scope is admitted only inside the Discard transaction.');
  const members=references.filter((item)=>item.state!=='released'&&item.liveReferenceCount===1).map((item)=>({materialHandleId:item.materialHandleId,
    referenceId:item.referenceId,expectedReferenceRevision:item.referenceRevision,expectedReferenceDigest:item.referenceDigest,
    expectedControlFence:item.controlFence||null,memberStateRevision:1,memberState:'pending'}));
  return buildCleanupScope({triggerKind:trigger.kind,triggerId:trigger.triggerId,triggerDigest:trigger.triggerDigest,
    libraRunId:workspace.libraRunId,workspaceId:workspace.workspaceId,members,eligibleAtMs});
}

function buildCleanupEffectIntent(value){
  const scope=value?.cleanupScope,member=value?.member,handle=value?.workspaceMaterialHandle;
  if(!scope||scope.state!=='open'||!member||member.memberState!=='pending'||handle?.handleId!==member.materialHandleId||handle.workspaceId!==scope.workspaceId)
    fail('P9_CLEANUP_EFFECT_INPUT','Cleanup Effect does not match the pending member.');
  const intent={cleanupScopeId:scope.cleanupScopeId,workspaceId:scope.workspaceId,materialHandleId:member.materialHandleId,
    workspaceMaterialHandle:clone(handle),effectIdempotencyKey:canonicalDigest({schema:'libra.workspace-cleanup-effect@1',cleanupScopeId:scope.cleanupScopeId,
      materialHandleId:member.materialHandleId,handleFenceDigest:handle.fenceDigest})};intent.intentDigest=canonicalDigest(intent);return freeze(intent);
}

function commitCleanupOutcome(value){
  const decision=value?.decision,scope=value?.cleanupScope,member=value?.member;
  if(!decision||decision.cleanupScopeId!==scope?.cleanupScopeId||decision.materialHandleId!==member?.materialHandleId||
      decision.expectedScopeStateRevision!==scope.stateRevision||decision.expectedScopeStateDigest!==scope.stateDigest||
      decision.expectedMemberStateRevision!==member.memberStateRevision||decision.expectedMemberStateDigest!==member.memberStateDigest||
      decision.decisionDigest!==canonicalDigest(without(decision,'decisionDigest')))fail('P9_CLEANUP_STALE','Cleanup decision fence is stale.');
  const completed=decision.outcome.kind==='deletion_verified';
  if(completed&&decision.outcome.deletionEvidence?.effectIdempotencyKey!==value.effectIntent.effectIdempotencyKey)
    fail('P9_CLEANUP_EVIDENCE','Deletion Evidence does not bind the exact Effect.');
  const nextMember={...clone(member),memberStateRevision:member.memberStateRevision+1,memberState:completed?'completed':'terminal_blocked',
    outcomeEvidenceDigest:canonicalDigest(decision.outcome)};nextMember.memberStateDigest=canonicalDigest(without(nextMember,'memberStateDigest'));
  const receipt={receiptId:canonicalDigest({schema:'libra.workspace-cleanup-receipt-id@1',decisionId:decision.decisionId}),decisionId:decision.decisionId,
    cleanupScopeId:scope.cleanupScopeId,materialHandleId:member.materialHandleId,outcome:nextMember.memberState,
    referenceReleased:completed,controlReleased:completed&&decision.expectedControlFence.controlDisposition==='libra_owned',committedAtMs:integer(value.committedAtMs,'committedAtMs')};receipt.receiptDigest=canonicalDigest(receipt);
  return freeze({member:nextMember,receipt});
}

module.exports=Object.freeze({DeliveryLifecycleContractError,assertPromotionDecision,buildPromotionCommit,buildOnDeckProductPackage,
  onDeckProductPackageDigest,verifyOnDeckProductPackageDigest,planRework,buildDiscardCommit,
  buildCleanupScope,admitCleanupScope,buildCleanupEffectIntent,commitCleanupOutcome,relative});
