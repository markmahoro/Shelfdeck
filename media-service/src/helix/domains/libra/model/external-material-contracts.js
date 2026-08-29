'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { assertExactMediaRequirement } = require('./media-production-contracts');

class ExternalMaterialContractError extends Error {
  constructor(code, message) { super(message); this.name = 'ExternalMaterialContractError'; this.code = code; }
}
const fail = (code, message) => { throw new ExternalMaterialContractError(code, message); };
const DIGEST = /^[a-f0-9]{64}$/;
const text = (value, name) => { if (typeof value !== 'string' || !value) fail('P9_EXTERNAL_VALUE', name + ' is required.'); return value; };
const digest = (value, name) => { if (!DIGEST.test(value || '')) fail('P9_EXTERNAL_DIGEST', name + ' is invalid.'); return value; };
const integer = (value, name, minimum = 0) => { if (!Number.isSafeInteger(value) || value < minimum) fail('P9_EXTERNAL_INTEGER', name + ' is invalid.'); return value; };
const compare = (left, right) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
const clone = (value) => JSON.parse(canonicalJson(value));
const freeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const bounded = (value, maximum, code) => {
  if (Buffer.byteLength(canonicalJson(value), 'utf8') > maximum) fail(code, 'Canonical value exceeds the contract bound.');
  return freeze(value);
};
const without = (value, key) => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
const exactDigest = (value, key, code) => {
  if (canonicalDigest(without(value, key)) !== value[key]) fail(code, key + ' does not cover the complete value.');
};
const sortedUnique = (items, keyOf, code) => {
  for (let index = 1; index < items.length; index += 1) if (compare(keyOf(items[index - 1]), keyOf(items[index])) >= 0) fail(code, 'Collection is not canonically sorted and unique.');
};
const relativePath = (value) => {
  text(value, 'relativePath');
  const parts = value.split('/');
  if (value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value) || parts.some((part) => !part || part === '.' || part === '..'))
    fail('P9_EXTERNAL_PATH', 'Path must be canonical and Workspace-root-relative.');
  return value;
};

function assertProductStructure(value) {
  if (!value || !['single', 'season'].includes(value.structureKind) || !Array.isArray(value.episodeClaims) || value.episodeClaims.length > 256)
    fail('P9_EXTERNAL_STRUCTURE', 'Product Structure is invalid.');
  const claims = clone(value.episodeClaims);
  sortedUnique(claims, (item) => item.episodeKey, 'P9_EXTERNAL_STRUCTURE_ORDER');
  const expected = canonicalDigest({ schema:'libra.product-structure@1', subjectId:value.subjectId,
    structureKind:value.structureKind, episodeClaims:claims });
  if (value.structureDigest !== expected || value.digest !== expected || (value.structureKind === 'single' && claims.length !== 0))
    fail('P9_EXTERNAL_STRUCTURE', 'Product Structure continuity is invalid.');
  return value;
}

function identityAnchors(resolved) {
  const items = clone(resolved.providerIdentityAnchors || resolved.providerIdentities || []);
  if (items.length < 1 || items.length > 16) fail('P9_EXTERNAL_IDENTITY', 'Resolved Product Identity has no provider anchor.');
  items.sort((a, b) => compare([a.provider,a.namespace,a.providerKey,String(a.seasonNumber || 0).padStart(10,'0')].join('\0'),
    [b.provider,b.namespace,b.providerKey,String(b.seasonNumber || 0).padStart(10,'0')].join('\0')));
  sortedUnique(items, (item) => [item.provider,item.namespace,item.providerKey,String(item.seasonNumber || 0).padStart(10,'0')].join('\0'), 'P9_EXTERNAL_IDENTITY_ORDER');
  return items;
}

function buildAcquisitionPolicy(value) {
  const integrationId = text(value?.integrationId, 'integrationId');
  const revision = integer(value?.configRevision, 'configRevision', 1);
  const maxDownloadAttempts = integer(value?.maxDownloadAttempts, 'maxDownloadAttempts', 1);
  if (maxDownloadAttempts > 5) fail('P9_EXTERNAL_ATTEMPT_LIMIT', 'Download attempt limit exceeds five.');
  const body = { contractId:canonicalDigest({ schema:'libra.external-acquisition-policy-id@1', integrationId, revision }),
    revision, schemaRef:'AcquisitionPolicy@1', maxDownloadAttempts };
  body.policyDigest = canonicalDigest(body);
  return bounded(body, 1024, 'P9_EXTERNAL_POLICY_SIZE');
}

function buildAcquisitionQuery(value) {
  const identity = value?.resolvedProductIdentity, structure = assertProductStructure(value?.productStructure), context = value?.executionContext;
  if (!identity || !context || !['movie','series','jav','western_adult'].includes(identity.contentProfile))
    fail('P9_EXTERNAL_QUERY_INPUT', 'Query requires exact Product Identity and Run execution context.');
  const requirement=assertExactMediaRequirement(value?.mediaRequirement), policy=value?.acquisitionPolicy;
  if (!policy || policy.schemaRef !== 'AcquisitionPolicy@1' ||
      policy.policyDigest !== canonicalDigest(without(policy, 'policyDigest'))) {
    fail('P9_EXTERNAL_ACQUISITION_POLICY', 'Acquisition Policy is invalid.');
  }
  const anchors = identityAnchors(identity), episodes = structure.episodeClaims.map((item) => item.episodeKey), terms=[];
  for (const anchor of anchors) terms.push({ termKind:'provider_key', value:anchor.providerKey });
  const displayTitle = identity.title || identity.displayIdentity?.entries
    ?.find((item) => item.key === 'title')?.value || null;
  if (typeof displayTitle === 'string' && displayTitle.trim()) {
    terms.push({ termKind:'title', value:displayTitle.trim() });
  }
  const originalTitle = identity.originalTitle || identity.displayIdentity?.entries
    ?.find((item) => item.key === 'original_title')?.value || null;
  if (typeof originalTitle === 'string' && originalTitle.trim() &&
      originalTitle.trim() !== (typeof displayTitle === 'string' ? displayTitle.trim() : '')) {
    terms.push({ termKind:'title', value:originalTitle.trim() });
  }
  if (structure.structureKind === 'season') terms.push({ termKind:'season', value:String(anchors[0].seasonNumber) });
  const dedup=[]; for (const item of terms) if (!dedup.some((existing) => existing.termKind === item.termKind && existing.value === item.value)) dedup.push(item);
  const queryTerms=dedup.slice(0,32).map((item,ordinal)=>freeze({ ordinal,...item,
    termDigest:canonicalDigest({schema:'libra.external-acquisition-query-term@1',termKind:item.termKind,value:item.value}) }));
  const hardConstraints={requiredStructureKind:structure.structureKind,requiredEpisodeKeys:episodes,
    mediaRequirementDigest:requirement.requirementDigest};
  const common={libraRunId:text(context.libraRunId,'libraRunId'),runExecutionBasisDigest:digest(context.runExecutionBasisDigest,'runExecutionBasisDigest'),
    resolvedIdentityDigest:digest(identity.resolvedIdentityDigest || identity.identityDigest || identity.digest,'resolvedIdentityDigest'),productStructureDigest:structure.structureDigest,
    structureKind:structure.structureKind,contentProfile:identity.contentProfile,providerIdentityAnchors:anchors,requestedEpisodeKeys:episodes,
    mediaRequirement:requirement,mediaRequirementDigest:requirement.requirementDigest,
    acquisitionPolicyDigest:policy.policyDigest,maxDownloadAttempts:policy.maxDownloadAttempts,queryTerms,hardConstraints};
  const queryDigest=canonicalDigest({schema:'libra.external-acquisition-query@1',...common});
  const result={schemaRef:'helix://contracts/types/AcquisitionQuery/v1',schemaVersion:1,
    draftId:canonicalDigest({schema:'libra.external-acquisition-query-id@1',queryDigest}),draftKind:'external-acquisition-query',
    basisDigest:canonicalDigest({schema:'libra.external-acquisition-query-basis@1',runExecutionBasisDigest:common.runExecutionBasisDigest,
      resolvedIdentityDigest:common.resolvedIdentityDigest,productStructureDigest:common.productStructureDigest}),producedAtMs:integer(value.producedAtMs,'producedAtMs'),...common,queryDigest};
  result.draftDigest=canonicalDigest(result);
  return bounded(result,16*1024,'P9_EXTERNAL_QUERY_SIZE');
}

function assertCandidates(value) {
  if (!value || value.schemaRef !== 'helix://contracts/types/AcquisitionCandidates/v1' || value.schemaVersion !== 1 ||
      !Array.isArray(value.candidates) || value.candidates.length > 100) fail('P9_EXTERNAL_CANDIDATES','Candidate Evidence is invalid.');
  value.candidates.forEach((item,index)=>{ if (item.providerRank !== index || item.candidateDigest !== canonicalDigest(without(item,'candidateDigest')) ||
      !['compliant','unknown','noncompliant'].includes(item.requirementAssessment) || !item.advertisedMedia ||
      item.advertisedMedia.evidenceDigest!==canonicalDigest(without(item.advertisedMedia,'evidenceDigest')))
      fail('P9_EXTERNAL_CANDIDATE','Candidate rank, media claims, or digest is invalid.'); });
  sortedUnique(value.candidates,(item)=>String(item.providerRank).padStart(3,'0')+'\0'+item.candidateId,'P9_EXTERNAL_CANDIDATE_ORDER');
  const first=value.candidates[0];
  const expected=canonicalDigest({schema:'libra.external-acquisition-candidate-set@1',queryDigest:value.queryDigest,
    integrationId:first?.integrationId || value.integrationId,configRevision:first?.configRevision || value.configRevision,items:value.candidates});
  if(value.candidateSetDigest!==expected)fail('P9_EXTERNAL_CANDIDATES','Candidate set digest is invalid.');
  return value;
}

function buildSelectionCriteria(value) {
  const body={contractId:'',revision:integer(value?.revision,'revision',1),schemaRef:'SelectionCriteria@1',queryDigest:digest(value?.queryDigest,'queryDigest'),
    attemptOrdinal:integer(value?.attemptOrdinal??1,'attemptOrdinal',1),strategy:'requirement_compliant_then_unverified_provider_rank'};
  if(body.attemptOrdinal>5)fail('P9_EXTERNAL_ATTEMPT_LIMIT','Selection attempt exceeds five.');
  body.contractId=canonicalDigest({schema:'libra.external-selection-criteria-id@1',queryDigest:body.queryDigest,revision:body.revision,
    attemptOrdinal:body.attemptOrdinal});
  body.criteriaDigest=canonicalDigest(body); return bounded(body,16*1024,'P9_EXTERNAL_SELECTION_SIZE');
}

function selectCandidate(value) {
  const candidates=assertCandidates(value?.candidates), criteria=value?.selectionCriteria;
  if(!criteria||criteria.schemaRef!=='SelectionCriteria@1'||criteria.queryDigest!==candidates.queryDigest||criteria.criteriaDigest!==canonicalDigest(without(criteria,'criteriaDigest')))
    fail('P9_EXTERNAL_SELECTION_CRITERIA','Selection Criteria continuity is invalid.');
  const available=candidates.candidates.filter((item)=>item.availability==='available'),compliant=available.filter((item)=>item.requirementAssessment==='compliant'),
    pool=compliant.length?compliant:available.filter((item)=>item.requirementAssessment==='unknown'),selected=pool[criteria.attemptOrdinal-1]||null;
  const common={queryDigest:candidates.queryDigest,candidateSetDigest:candidates.candidateSetDigest,selectionCriteriaDigest:criteria.criteriaDigest};
  const result={schemaRef:'helix://contracts/types/SelectedCandidate/v1',schemaVersion:1,
    draftId:canonicalDigest({schema:'libra.external-selected-candidate-id@1',...common}),draftKind:'external-selected-candidate',
    basisDigest:canonicalDigest({schema:'libra.external-candidate-selection-basis@1',...common}),producedAtMs:integer(value.producedAtMs,'producedAtMs'),...common,
    result:selected?'selected':'not_selected',selectedCandidate:selected,selectedCandidateId:selected?.candidateId||null,
    selectionReasonCode:selected?(selected.requirementAssessment==='compliant'?'selected_compliant_claims':'selected_unverified_claims'):
      (available.some((item)=>item.requirementAssessment==='noncompliant')?'no_requirement_eligible_candidate':'no_available_candidate')};
  result.draftDigest=canonicalDigest(result); return bounded(result,64*1024,'P9_EXTERNAL_SELECTED_SIZE');
}

function buildAcquisitionObservation(value) {
  const receipt=value?.externalJobReceipt, snapshot=value?.providerSnapshot;
  if(!receipt||!snapshot||snapshot.state!=='ready'||snapshot.externalJobReceiptId!==receipt.receiptId||snapshot.requestDigest!==receipt.requestDigest)
    fail('P9_EXTERNAL_OBSERVATION_NOT_READY','Only a ready Provider snapshot can publish Acquisition Observation.');
  const phase=value.phase;
  if(!['download','transfer'].includes(phase))fail('P9_EXTERNAL_PHASE','Acquisition phase is invalid.');
  const observationDigest=canonicalDigest({schema:'libra.external-acquisition-observation@1',externalJobReceipt:receipt,phase,
    providerObservationRevision:snapshot.providerObservationRevision,outputSnapshot:snapshot.outputSnapshot});
  const basisDigest=canonicalDigest({schema:'libra.external-acquisition-observation-basis@1',externalJobReceiptId:receipt.receiptId,
    requestDigest:receipt.requestDigest,phase,integrationId:receipt.integrationId,configRevision:receipt.configRevision});
  const result={schemaRef:'helix://contracts/types/AcquisitionObservation/v1',schemaVersion:1,
    evidenceId:canonicalDigest({schema:'libra.external-acquisition-observation-id@1',basisDigest,observationDigest}),
    evidenceKind:'external_acquisition_observation',producerRef:text(value.producerRef,'producerRef'),basisDigest,payloadDigest:observationDigest,
    observedAtMs:integer(value.observedAtMs,'observedAtMs'),externalJobReceipt:clone(receipt),phase,
    providerObservationRevision:snapshot.providerObservationRevision,outputSnapshot:clone(snapshot.outputSnapshot),observationDigest};
  return bounded(result,64*1024,'P9_EXTERNAL_OBSERVATION_SIZE');
}

function buildExternalMaterialHandle(value) {
  const observation=value?.acquisitionObservation, structure=assertProductStructure(value?.productStructure);
  if(!observation||observation.outputSnapshot.structureKind!==structure.structureKind)fail('P9_EXTERNAL_OUTPUT_STRUCTURE','External output structure is incompatible.');
  const expected=new Set(structure.episodeClaims.map((item)=>item.episodeKey));
  const actual=new Set(observation.outputSnapshot.members.flatMap((item)=>item.episodeClaims.map((claim)=>claim.episodeKey)));
  if(structure.structureKind==='single' ? actual.size!==0 : [...actual].some((key)=>!expected.has(key)) || [...expected].some((key)=>!actual.has(key)))
    fail('P9_EXTERNAL_OUTPUT_EPISODES','External output Episode scope is incompatible.');
  const snapshot=clone(observation.outputSnapshot),handleId=canonicalDigest({schema:'libra.external-material-handle-id@1',
    integrationId:snapshot.integrationId,configRevision:snapshot.configRevision,externalObjectRef:snapshot.externalObjectRef,
    observationRevision:observation.providerObservationRevision,manifestDigest:snapshot.manifestDigest});
  return bounded({schemaRef:'helix://contracts/types/ExternalMaterialHandle/v1',schemaVersion:1,handleId,integrationId:snapshot.integrationId,
    configRevision:snapshot.configRevision,externalObjectRef:snapshot.externalObjectRef,endpointId:snapshot.endpointId,location:snapshot.location,
    landingBinding:clone(snapshot.landingBinding),structureKind:snapshot.structureKind,outputSnapshot:snapshot,manifestDigest:snapshot.manifestDigest,
    observationRevision:observation.providerObservationRevision,accessFenceDigest:canonicalDigest({schema:'libra.external-material-access-fence@1',
      handleId,endpointId:snapshot.endpointId,location:snapshot.location,landingBindingDigest:snapshot.landingBinding.bindingDigest,
      mountScopeId:snapshot.landingBinding.mountScopeId,mountScopeRevision:snapshot.landingBinding.mountScopeRevision,
      outputSnapshotDigest:snapshot.snapshotDigest})},64*1024,'P9_EXTERNAL_HANDLE_SIZE');
}

function buildStableEvidence(value) {
  const source=value?.externalMaterialHandle,current=value?.providerSnapshot?.outputSnapshot,revision=value?.providerSnapshot?.providerObservationRevision;
  if(!source||!current||current.integrationId!==source.integrationId||current.configRevision!==source.configRevision||
      current.externalObjectRef!==source.externalObjectRef||current.endpointId!==source.endpointId||current.location!==source.location||
      current.landingBinding?.bindingDigest!==source.landingBinding?.bindingDigest)
    fail('P9_EXTERNAL_STABILITY_FENCE','Stability observation escaped the frozen external Handle.');
  const quietWindowMs=integer(value.quietWindowMs,'quietWindowMs',1);
  if(quietWindowMs>86400000||current.observedAtMs-current.newestMutationAtMs<quietWindowMs)fail('P9_EXTERNAL_STABILITY_DEFERRED','External Material is not stable yet.');
  const episodeClaims=[...new Map(source.outputSnapshot.members.flatMap((item)=>item.episodeClaims)
    .map((item)=>[item.episodeKey,item])).values()].sort((left,right)=>compare(left.episodeKey,right.episodeKey));
  const derivedStructure={objectId:'external-scope-'+source.handleId,revision:1,subjectId:'external-scope-'+source.handleId,
    structureKind:source.structureKind,episodeClaims};
  derivedStructure.structureDigest=canonicalDigest({schema:'libra.product-structure@1',subjectId:derivedStructure.subjectId,
    structureKind:derivedStructure.structureKind,episodeClaims});
  derivedStructure.digest=derivedStructure.structureDigest;
  const handle=buildExternalMaterialHandle({acquisitionObservation:{outputSnapshot:current,providerObservationRevision:revision},
    productStructure:value.productStructure||derivedStructure});
  const basisDigest=canonicalDigest({schema:'libra.external-material-stability-basis@1',sourceExternalMaterialHandleId:source.handleId,
    currentSnapshotDigest:current.snapshotDigest,quietWindowMs});
  const result={schemaRef:'helix://contracts/types/StableExternalMaterialEvidence/v1',schemaVersion:1,
    verificationId:canonicalDigest({schema:'libra.external-material-stability-id@1',basisDigest}),verificationKind:'external_material_stability',
    basisDigest,result:'passed',reasonCodes:[],evidenceRefs:[source.handleId],verifiedAtMs:integer(value.verifiedAtMs,'verifiedAtMs'),
    sourceExternalMaterialHandleId:source.handleId,stableExternalMaterialHandle:handle,
    observationWindow:{startedAtMs:current.newestMutationAtMs,endedAtMs:current.observedAtMs,quietWindowMs,newestMutationAtMs:current.newestMutationAtMs}};
  result.stableDigest=canonicalDigest(result); return bounded(result,64*1024,'P9_EXTERNAL_STABLE_SIZE');
}

function verifyIdentity(value) {
  const stable=value?.stableEvidence,resolved=value?.resolvedProductIdentity,handle=stable?.stableExternalMaterialHandle;
  if(!stable||stable.stableDigest!==canonicalDigest(without(stable,'stableDigest'))||!resolved||!handle)
    fail('P9_EXTERNAL_IDENTITY_EVIDENCE','Stable Evidence integrity is invalid.');
  const observed=handle.outputSnapshot.identityAnchors||[],expected=identityAnchors(resolved),tuple=(item)=>[item.provider,item.namespace,item.providerKey,item.seasonNumber].join('\0');
  const matched=observed.some((item)=>expected.some((candidate)=>tuple(item)===tuple(candidate))),reasonCodes=matched?[]:[observed.length?'identity_mismatch':'identity_anchor_missing'];
  const expectedIdentityDigest=digest(resolved.resolvedIdentityDigest||resolved.identityDigest||resolved.digest,'expectedIdentityDigest');
  const observedIdentityDigest=canonicalDigest({schema:'libra.external-observed-identity@1',identityAnchors:observed,
    observedTitle:handle.outputSnapshot.observedTitle??null,releaseYear:handle.outputSnapshot.releaseYear??null});
  const basisDigest=canonicalDigest({schema:'libra.external-identity-verification-basis@1',stableDigest:stable.stableDigest,expectedIdentityDigest,observedIdentityDigest});
  return bounded({schemaRef:'helix://contracts/types/IdentityVerification/v1',schemaVersion:1,
    verificationId:canonicalDigest({schema:'libra.external-identity-verification-id@1',basisDigest}),verificationKind:'external_material_identity',basisDigest,
    result:matched?'passed':'failed',reasonCodes,evidenceRefs:[stable.verificationId],verifiedAtMs:integer(value.verifiedAtMs,'verifiedAtMs'),
    expectedIdentityDigest,observedIdentityDigest,strengthClass:matched?'exact_provider_identity':'unverified'},16*1024,'P9_EXTERNAL_IDENTITY_SIZE');
}

function verifyPackage(value) {
  const stable=value?.stableEvidence,identity=value?.identityVerification,delivery=value?.episodeDeliveryManifest,requirement=value?.identityRequirement,
    handle=stable?.stableExternalMaterialHandle,reasons=[];
  if(!stable||stable.stableDigest!==canonicalDigest(without(stable,'stableDigest'))||!handle||!delivery||!requirement)reasons.push('package_integrity_failure');
  if(identity?.result!=='passed'||identity?.expectedIdentityDigest!==requirement?.expectedIdentityDigest)reasons.push('identity_verification_failed');
  if(handle?.structureKind!==delivery?.structureKind)reasons.push('structure_mismatch');
  const deliveryKeys=new Set((delivery?.episodeClaims||[]).map((item)=>item.episodeKey)),members=handle?.outputSnapshot?.members||[],verifiedMemberIds=members.map((item)=>item.externalMemberId).sort(compare);
  const coverage=new Set(members.flatMap((item)=>item.episodeClaims.map((claim)=>claim.episodeKey)));
  const invalid=delivery?.structureKind==='single' ? members.length!==1||coverage.size!==0 :
    [...deliveryKeys].some((key)=>!coverage.has(key))||members.some((item)=>!item.episodeClaims.length||item.episodeClaims.some((claim)=>!deliveryKeys.has(claim.episodeKey)));
  if(invalid)reasons.push('episode_coverage_mismatch');
  const precedence=['identity_verification_failed','structure_mismatch','episode_coverage_mismatch','package_integrity_failure'],reasonCodes=precedence.filter((item)=>reasons.includes(item));
  const verifiedMemberSetDigest=canonicalDigest({schema:'libra.verified-external-package-members@1',items:verifiedMemberIds});
  const identityVerificationDigest=canonicalDigest(identity||null),stableManifestDigest=handle?.manifestDigest||'0'.repeat(64),episodeDeliveryManifestDigest=delivery?.deliveryDigest||delivery?.digest||'0'.repeat(64);
  const packageManifestDigest=canonicalDigest({schema:'libra.verified-external-package-manifest@1',stableManifestDigest,
    episodeDeliveryManifestDigest,identityVerificationDigest,verifiedMemberSetDigest});
  const basisDigest=canonicalDigest({schema:'libra.external-package-verification-basis@1',stableDigest:stable?.stableDigest||'0'.repeat(64),
    identityVerificationDigest,episodeDeliveryManifestDigest,identityRequirementDigest:requirement?.digest||'0'.repeat(64)});
  return bounded({schemaRef:'helix://contracts/types/VerifiedExternalPackage/v1',schemaVersion:1,
    verificationId:canonicalDigest({schema:'libra.external-package-verification-id@1',basisDigest,packageManifestDigest}),
    verificationKind:'external_material_package',basisDigest,result:reasonCodes.length?'failed':'passed',reasonCodes,
    evidenceRefs:[stable?.verificationId,identity?.verificationId].filter(Boolean),verifiedAtMs:integer(value.verifiedAtMs,'verifiedAtMs'),
    stableExternalMaterialHandleId:handle?.handleId||'',stableManifestDigest,episodeDeliveryManifestDigest,
    identityVerificationId:identity?.verificationId||'',identityVerificationDigest,verifiedMemberIds,verifiedMemberSetDigest,packageManifestDigest},16*1024,'P9_EXTERNAL_PACKAGE_SIZE');
}

function buildWorkspaceDeliveryContracts(value) {
  const verified=value?.verifiedExternalPackage,stable=value?.stableEvidence;
  if(!verified||verified.result!=='passed'||!stable||verified.stableExternalMaterialHandleId!==stable.stableExternalMaterialHandle.handleId)
    fail('P9_EXTERNAL_IMPORT_PACKAGE','Import planning requires the exact passed Package and Stable Evidence.');
  const verifiedPackageDigest=canonicalDigest(verified),targets=new Set();
  return freeze(verified.verifiedMemberIds.map((externalMemberId,index)=>{
    const member=stable.stableExternalMaterialHandle.outputSnapshot.members.find((item)=>item.externalMemberId===externalMemberId);
    if(!member)fail('P9_EXTERNAL_IMPORT_MEMBER','Verified member is absent from Stable Handle.');
    const targetRelativePath=relativePath(value.targetRelativePaths?.[externalMemberId]||'external/'+String(index).padStart(3,'0')+'-'+member.relativePath);
    if(targets.has(targetRelativePath))fail('P9_EXTERNAL_IMPORT_TARGET','Workspace target is duplicated.'); targets.add(targetRelativePath);
    const common={revision:1,schemaRef:'WorkspaceDeliveryContract@1',libraRunId:text(value.libraRunId,'libraRunId'),workspaceId:text(value.workspaceId,'workspaceId'),
      expectedWorkspaceRevision:integer(value.expectedWorkspaceRevision,'expectedWorkspaceRevision',1),expectedWorkspaceStateDigest:digest(value.expectedWorkspaceStateDigest,'expectedWorkspaceStateDigest'),
      rootSnapshot:clone(value.rootSnapshot),stableExternalMaterialHandleId:stable.stableExternalMaterialHandle.handleId,verifiedPackageDigest,
      memberSelector:'external_member_id',externalMemberId,targetRelativePath};
    const contractId=canonicalDigest({schema:'libra.workspace-external-import-contract-id@1',libraRunId:common.libraRunId,workspaceId:common.workspaceId,
      stableExternalMaterialHandleId:common.stableExternalMaterialHandleId,verifiedPackageDigest,memberSelector:common.memberSelector,externalMemberId,targetRelativePath});
    const contract={contractId,...common}; contract.digest=canonicalDigest(contract); return bounded(contract,32*1024,'P9_EXTERNAL_IMPORT_CONTRACT_SIZE');
  }));
}

function buildImportedWorkspaceMediaHandle(value) {
  const contract=value?.workspaceDeliveryContract,handle=value?.workspaceMaterialHandle;
  if(!contract||!handle||handle.workspaceId!==contract.workspaceId||handle.relativePath!==contract.targetRelativePath||
      handle.ownerDomain!=='libra'||handle.processId!==contract.libraRunId)
    fail('P9_EXTERNAL_IMPORTED_MEDIA_FENCE','Imported Workspace media does not match its frozen delivery contract.');
  const eventId=text(value.producingEventId,'producingEventId'),idempotencyKey=text(value.idempotencyKey,'idempotencyKey');
  const effectId=canonicalDigest(['workspace_write',idempotencyKey]);
  const effectReceiptDigest=canonicalDigest({schema:'libra.external-import-effect-evidence@1',effectId,
    contractDigest:contract.digest,workspaceMaterialHandleDigest:canonicalDigest(handle)});
  const sourceMaterialHandleDigest=canonicalDigest({schema:'libra.external-import-source@1',
    stableExternalMaterialHandleId:contract.stableExternalMaterialHandleId,externalMemberId:contract.externalMemberId,
    verifiedPackageDigest:contract.verifiedPackageDigest});
  const result={schemaRef:'helix://contracts/types/WorkspaceMediaHandle/v1',schemaVersion:1,workspaceMediaHandleId:'',
    sourceMaterialHandleDigest,workspaceMaterialHandle:handle,workspaceMaterialHandleDigest:canonicalDigest(handle),
    outputTargetId:contract.contractId,outputTargetDigest:contract.digest,producingEventId:eventId,
    productionIntentKind:'external_import',productionIntentDigest:contract.digest,executionDeviceRef:null,
    productionVideoProfile:null,
    effectReceiptRef:{effectId,effectReceiptId:canonicalDigest({schema:'libra.external-import-effect-receipt-id@1',effectId}),
      effectReceiptDigest}};
  result.workspaceMediaHandleId=canonicalDigest({schema:'libra.workspace-media-handle-id@1',sourceMaterialHandleDigest,
    workspaceMaterialHandleId:handle.handleId,outputTargetId:result.outputTargetId,producingEventId:eventId,
    productionIntentDigest:result.productionIntentDigest,executionDeviceRefOrNull:null});
  result.resultDigest=canonicalDigest(result);
  return bounded(result,16*1024,'P9_EXTERNAL_IMPORTED_MEDIA_SIZE');
}

module.exports=Object.freeze({ExternalMaterialContractError,buildAcquisitionPolicy,buildAcquisitionQuery,assertCandidates,buildSelectionCriteria,selectCandidate,
  buildAcquisitionObservation,buildExternalMaterialHandle,buildStableEvidence,verifyIdentity,verifyPackage,buildWorkspaceDeliveryContracts,
  buildImportedWorkspaceMediaHandle});
