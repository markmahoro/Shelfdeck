'use strict';

const crypto = require('crypto');
const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
const typeId = (name) => `helix://contracts/application-types/${name}/v1`;
const text = (options = {}) => ({ type:'string', minLength:1, ...options });
const id = () => text({ maxLength:256 });
const digest = () => text({ pattern:'^[a-f0-9]{64}$' });
const positive = () => ({ type:'integer', minimum:1 });
const nonNegative = () => ({ type:'integer', minimum:0 });
const object = (properties, required = Object.keys(properties), options = {}) => ({ type:'object', additionalProperties:false, properties, required, ...options });
const ref = (name) => ({ $ref:typeId(name) });
const controlSnapshot = () => ({ oneOf:[
  object({materialKey:digest(),resultKind:{const:'available'},controlRevision:nonNegative(),controlState:{const:'uncontrolled'},regionProjection:{const:'uncontrolled'},evidenceDigest:digest(),projectionDigest:digest()}),
  object({materialKey:digest(),resultKind:{const:'available'},controlRevision:positive(),controlState:{const:'controlled'},ownerDomain:id(),ownerScopeType:id(),ownerScopeId:id(),regionProjection:{type:'string',enum:['procurement','production','finished_goods']},evidenceDigest:digest(),projectionDigest:digest()}),
  object({materialKey:digest(),resultKind:{const:'unavailable'},failureCode:id(),evidenceDigest:digest(),projectionDigest:digest()})
] });
const receiptEnvelope = (receiptKind) => ({ schemaRef:{ const:typeId(receiptKind) },schemaVersion:{ const:1 },receiptId:id(),receiptKind:{ const:receiptKind==='ProcurementRetryIntentReceipt'?'procurement_retry_intent_created':'procurement_retry_admission' },ownerDomain:{ const:'procurement' },scopeType:{ const:'procurement_retry_intent' },scopeId:id(),scopeDigest:digest(),committedAtMs:nonNegative() });
const profileHint = () => ({ type:'string', enum:['mixed','movie','series','jav','western_adult'] });
const profileHintSnapshotRef = () => ref('MaterialFieldProfileHintSnapshot');
function profileHintSnapshot() {
  return { $schema:DRAFT,$id:typeId('MaterialFieldProfileHintSnapshot'),title:'MaterialFieldProfileHintSnapshot@1',
    'x-helix-ssotRefs':['5.3.2','8.6.18'],...object({
      fieldId:id(),revision:positive(),contentProfileHint:profileHint(),hintDigest:digest()
    }) };
}
const extractionPolicy = () => object({
  extractionPolicyId:id(),revision:positive(),
  policySchemaRef:{const:'helix://contracts/domain-types/ExtractionPolicy/v1'},
  policy:object({
    includedDirectories:{type:'array',maxItems:128,uniqueItems:true,items:text()},
    excludedDirectories:{type:'array',maxItems:128,uniqueItems:true,items:text()},
    allowedExtensions:{type:'array',maxItems:64,uniqueItems:true,items:text({pattern:'^\\.[a-z0-9]+$'})},
    minimumSizeBytes:nonNegative(),
    excludedMaterialKeys:{type:'array',maxItems:128,uniqueItems:true,items:digest()}
  }),
  policyDigest:digest(),effectiveAtMs:nonNegative()
});
const accessProjection = () => object({
  fieldId:id(),revision:positive(),endpointId:id(),rootLocation:text(),mountScopeId:id(),mountScopeRevision:positive(),
  accessSchemaRef:id(),accessDigest:digest(),effectiveAtMs:nonNegative()
});
function materialFieldRegistrationCommand() {
  return { $schema:DRAFT,$id:typeId('MaterialFieldRegistrationCommand'),title:'MaterialFieldRegistrationCommand@1',
    'x-helix-ssotRefs':['8.6.18'],...object({
      fieldId:id(),name:text(),policy:extractionPolicy(),access:accessProjection(),
      contentProfileHint:profileHint(),idempotencyKey:id()
    }) };
}
function profileHintRevisionCommand() {
  return { $schema:DRAFT,$id:typeId('MaterialFieldProfileHintRevisionCommand'),title:'MaterialFieldProfileHintRevisionCommand@1',
    'x-helix-ssotRefs':['8.6.18'],...object({
      operation:{const:'revise_profile_hint'},fieldId:id(),expectedProfileHintRevision:positive(),
      newContentProfileHint:profileHint(),idempotencyKey:id(),requestDigest:digest()
    }) };
}
function materialFieldAdminProjection() {
  return { $schema:DRAFT,$id:typeId('MaterialFieldAdminProjection'),title:'MaterialFieldAdminProjection@1',
    'x-helix-ssotRefs':['8.6.18'],...object({
      fieldId:id(),name:text(),status:{type:'string',enum:['active','deregistered']},
      extractionPolicyId:id(),extractionPolicyRevision:positive(),currentAccessRevision:positive(),
      currentProfileHintSnapshot:profileHintSnapshotRef(),currentObservationRevision:positive(),
      createdAtMs:nonNegative(),updatedAtMs:nonNegative(),policy:extractionPolicy(),access:accessProjection(),projectionDigest:digest()
    },['fieldId','name','status','extractionPolicyId','extractionPolicyRevision','currentAccessRevision',
      'currentProfileHintSnapshot','createdAtMs','updatedAtMs','policy','access','projectionDigest']) };
}
function materialFieldAdminResult() {
  return { $schema:DRAFT,$id:typeId('ProcurementMaterialFieldAdminResult'),title:'ProcurementMaterialFieldAdminResult@1',
    'x-helix-ssotRefs':['8.6.18'],...object({
      materialField:ref('MaterialFieldAdminProjection'),commandReceiptId:id(),resultDigest:digest()
    }) };
}

function triageRuleSnapshot() {
  const payload = object({
    contractRefs:{ const:['helix.procurement.candidate-readiness@1','helix.procurement.profile-claim-baseline@1',
      'helix.procurement.primary-input-manifest@1','helix.procurement.related-material-reference@1'] },
    recallPriority:{ const:true }, maxPrimaryMaterials:{ const:1024 }, probeBatchSize:{ const:100 },
    playabilityRule:object({minimumDurationMs:{const:1},minimumVideoStreamCount:{const:1},
      reasonPrecedence:{const:['probe_not_media','no_video_stream','non_positive_duration']}}),
    profileResolutionRule:object({mixedPrecedence:{const:['series_episode_token','jav_code','movie_fallback']},westernAdultRequiresExplicitHint:{const:true}}),
    structureRule:object({maxUnitCanonicalBytes:{const:65536}}), identityRule:object({claimKinds:{const:['movie_title','series_season','jav_code','western_temporary']}}),
    manifestRule:object({minimumMembers:{const:1},maximumMembers:{const:1024},firstOrdinal:{const:0}})
  });
  return { $schema:DRAFT, $id:typeId('ProcurementTriageRuleSnapshot'), title:'ProcurementTriageRuleSnapshot@1',
    'x-helix-ssotRefs':['5.3.2','8.6.18'], 'x-helix-maxCanonicalBytes':16*1024,
    ...object({ ruleRef:id(), revision:positive(), ruleSchemaRef:{ const:'procurement.triage-rule.beta@1' },
      rulePayload:payload, ruleDigest:digest(), authorityDigest:digest() }) };
}
function triageRuleRegistry() {
  return { $schema:DRAFT, $id:typeId('ProcurementTriageRuleRegistry'), title:'ProcurementTriageRuleRegistry@1',
    'x-helix-ssotRefs':['5.3.2','8.6.18'], ...object({ registrySchemaRef:{ const:'procurement.triage-rule-registry@1' },
      registryVersion:positive(), activeRuleRef:id(), activeRuleRevision:positive(),
      entries:{ type:'array', minItems:1, items:ref('ProcurementTriageRuleSnapshot') }, registryDigest:digest() }) };
}
function runExecutionBasis() {
  return { $schema:DRAFT, $id:typeId('ProcurementRunExecutionBasis'), title:'ProcurementRunExecutionBasis@1',
    'x-helix-ssotRefs':['6.3.2','8.6.18'], ...object({ procurementRunId:id(), fieldId:id(), fieldStatus:{ const:'active' },
      fieldAccess:object({ revision:positive(), digest:digest() }), profileHintSnapshot:profileHintSnapshotRef(),
      terminalObservation:object({ revision:positive(), fieldObservationWorkId:id(), profileHintSnapshot:profileHintSnapshotRef() }),
      extractionPolicy:object({ policyId:id(), revision:positive(), digest:digest() }), triageRule:ref('ProcurementTriageRuleSnapshot'),
      sourceRetryIntentId:id(), selectedFieldMaterialSet:{ $ref:'helix://contracts/domain-types/SelectedFieldMaterialSet/v1' }, basisDigest:digest()
    }, ['procurementRunId','fieldId','fieldStatus','fieldAccess','profileHintSnapshot','terminalObservation','extractionPolicy','triageRule','selectedFieldMaterialSet','basisDigest']) };
}
function runSealDecision() {
  return { $schema:DRAFT,$id:typeId('ProcurementRunSealDecision'),title:'ProcurementRunSealDecision@1','x-helix-ssotRefs':['6.3.3','8.6.18'],
    ...object({decisionId:id(),procurementRunId:id(),expectedStateRevision:positive(),expectedRunBasisDigest:digest(),
      sealOutcome:{type:'string',enum:['completed','failed','partial_failure']},publishedCandidates:{type:'array',items:object({candidatePackageId:id(),packageDigest:digest(),manifestDigest:digest()})},
      releasedMembers:{type:'array',items:object({materialKey:digest(),disposition:{type:'string',enum:['completed_without_candidate','triage_failed']},evidenceDigest:digest()})},decisionDigest:digest()})};
}
function runSealReceipt(){return {$schema:DRAFT,$id:typeId('ProcurementRunSealReceipt'),title:'ProcurementRunSealReceipt@1','x-helix-ssotRefs':['8.6.18'],
  'x-helix-maxCanonicalBytes':64*1024,...object({schemaRef:{const:typeId('ProcurementRunSealReceipt')},schemaVersion:{const:1},receiptId:id(),receiptKind:{const:'procurement_run_sealed'},ownerDomain:{const:'procurement'},scopeType:{const:'procurement_run'},scopeId:id(),scopeDigest:digest(),committedAtMs:nonNegative(),procurementRunId:id(),sealedStateRevision:positive(),runBasisDigest:digest(),sealDecisionDigest:digest(),sealOutcome:{type:'string',enum:['completed','failed','partial_failure']},candidateReservationCount:nonNegative(),candidateReservationSetDigest:digest(),releasedMaterialCount:nonNegative(),releasedMaterialSetDigest:digest(),sealEvidenceDigest:digest()})};}
function retryAdmissionHead(){return {$schema:DRAFT,$id:typeId('ProcurementRetryAdmissionHead'),title:'ProcurementRetryAdmissionHead@1','x-helix-ssotRefs':['8.6.18'],'x-helix-maxCanonicalBytes':16*1024,...object({fieldId:id(),fieldStatus:{type:'string',enum:['active','deregistered']},profileHintSnapshot:profileHintSnapshotRef(),fieldAccess:object({revision:positive(),digest:digest()}),terminalObservation:{oneOf:[object({resultKind:{const:'available'},revision:positive(),fieldObservationWorkId:id(),profileHintSnapshot:profileHintSnapshotRef()}),object({resultKind:{const:'unavailable'}})]},extractionPolicy:object({policyId:id(),revision:positive(),digest:digest()}),triageRule:ref('ProcurementTriageRuleSnapshot'),headDigest:digest()})};}
function retryConsumeMemberSnapshot(){return {$schema:DRAFT,$id:typeId('ProcurementRetryConsumeMemberSnapshot'),title:'ProcurementRetryConsumeMemberSnapshot@1','x-helix-ssotRefs':['8.6.18'],'x-helix-maxCanonicalBytes':4*1024,...object({retryIntentId:id(),ordinal:nonNegative(),materialKey:digest(),currentAdmissionHeadDigest:digest(),materialState:{type:'string',enum:['present','missing']},currentBindingRevision:positive(),currentEligibilityRevision:positive(),currentEligibilityState:{type:'string',enum:['unknown','eligible','ineligible']},currentEligibilityBasisDigest:digest(),currentSelection:object({hasConflict:{type:'boolean'},selectionBasisDigest:digest()}),currentControlSnapshot:controlSnapshot(),consumeOutcome:{type:'string',enum:['matched','stale']},staleReasonCode:{type:'string',enum:['field_status_changed','field_profile_hint_changed','field_access_changed','terminal_observation_changed','extraction_policy_changed','triage_rule_changed','material_not_present','material_binding_changed','material_not_eligible','material_eligibility_changed','material_guard_conflict','material_control_unavailable','material_control_not_acquirable','material_control_changed']},snapshotDigest:digest()},['retryIntentId','ordinal','materialKey','currentAdmissionHeadDigest','materialState','currentSelection','currentControlSnapshot','consumeOutcome','snapshotDigest'],{allOf:[{if:{properties:{materialState:{const:'present'}}},then:{required:['currentBindingRevision','currentEligibilityRevision','currentEligibilityState','currentEligibilityBasisDigest']},else:{not:{anyOf:[{required:['currentBindingRevision']},{required:['currentEligibilityRevision']},{required:['currentEligibilityState']},{required:['currentEligibilityBasisDigest']}]}}},{if:{properties:{consumeOutcome:{const:'matched'}}},then:{not:{required:['staleReasonCode']}},else:{required:['staleReasonCode']}}]})};}
function retryIntent(){const member=object({ordinal:nonNegative(),materialKey:digest(),failedRunMaterialDigest:digest(),expectedBindingRevision:positive(),expectedEligibilityRevision:positive(),expectedEligibilityBasisDigest:digest(),expectedSelectionBasisDigest:digest(),expectedSelectionHasConflict:{const:false},expectedControlSnapshot:controlSnapshot(),memberPreconditionDigest:digest()});return {$schema:DRAFT,$id:typeId('ProcurementRetryIntent'),title:'ProcurementRetryIntent@1','x-helix-ssotRefs':['8.6.18'],...object({retryIntentId:id(),fieldId:id(),failedRunId:id(),failedRunBasisDigest:digest(),retryAdmissionHead:ref('ProcurementRetryAdmissionHead'),members:{type:'array',minItems:1,maxItems:1024,items:member},retryScopeDigest:digest(),preconditionSetDigest:digest(),actorId:id(),idempotencyKey:id(),intentDigest:digest()})};}
function retryIntentReceipt(){return {$schema:DRAFT,$id:typeId('ProcurementRetryIntentReceipt'),title:'ProcurementRetryIntentReceipt@1','x-helix-ssotRefs':['8.6.18'],...object({...receiptEnvelope('ProcurementRetryIntentReceipt'),retryIntentId:id(),fieldId:id(),failedRunId:id(),intentDigest:digest(),retryScopeDigest:digest(),preconditionSetDigest:digest(),intentState:{const:'open'}})};}
function retryIntentAvailableMessage(){return {$schema:DRAFT,$id:typeId('ProcurementRetryIntentAvailableMessage'),title:'ProcurementRetryIntentAvailableMessage@1','x-helix-ssotRefs':['8.6.18'],'x-helix-maxCanonicalBytes':16*1024,...object({messageKind:{const:'procurement_retry_intent_available'},retryIntentId:id(),fieldId:id(),failedRunId:id(),intentStateRevision:{const:1},intentDigest:digest(),retryScopeDigest:digest()})};}
function retryAdmissionResult(){const reasons=['field_status_changed','field_profile_hint_changed','field_access_changed','terminal_observation_changed','extraction_policy_changed','triage_rule_changed','material_not_present','material_binding_changed','material_not_eligible','material_eligibility_changed','material_guard_conflict','material_control_unavailable','material_control_not_acquirable','material_control_changed'];return {$schema:DRAFT,$id:typeId('ProcurementRetryAdmissionResult'),title:'ProcurementRetryAdmissionResult@1','x-helix-ssotRefs':['8.6.18'],'x-helix-maxCanonicalBytes':64*1024,...object({...receiptEnvelope('ProcurementRetryAdmissionResult'),retryIntentId:id(),intentDigest:digest(),terminalIntentState:{type:'string',enum:['consumed','stale']},resultKind:{type:'string',enum:['created','stale']},createdControlReceipt:{$ref:'helix://contracts/types/ProcurementControlReceipt/v1'},staleMaterialCount:positive(),staleMaterialSetDigest:digest(),staleReasonCodes:{type:'array',minItems:1,uniqueItems:true,items:{type:'string',enum:reasons}}},['schemaRef','schemaVersion','receiptId','receiptKind','ownerDomain','scopeType','scopeId','scopeDigest','committedAtMs','retryIntentId','intentDigest','terminalIntentState','resultKind'],{allOf:[{if:{properties:{resultKind:{const:'created'}}},then:{required:['createdControlReceipt'],properties:{terminalIntentState:{const:'consumed'}},not:{anyOf:[{required:['staleMaterialCount']},{required:['staleMaterialSetDigest']},{required:['staleReasonCodes']}]}},else:{required:['staleMaterialCount','staleMaterialSetDigest','staleReasonCodes'],properties:{terminalIntentState:{const:'stale'}},not:{required:['createdControlReceipt']}}}]})};}
function candidateAssemblyPlanBinding(){
  const schemaRef={const:typeId('ProcurementCandidateAssemblyPlanBinding')};
  const version={const:1};
  const resultIdentity=object({role:id(),eventId:id(),resultId:id(),capabilityRef:id(),resultSchemaRef:id()});
  const resultReference=object({...resultIdentity.properties,resultDigest:digest()});
  const refs=(minimum=1,maximum=1024)=>({type:'array',minItems:minimum,maxItems:maximum,items:resultReference});
  const ruleRef=object({ruleRef:id(),revision:positive(),authorityDigest:digest()});
  const runRef=object({procurementRunId:id(),runBasisDigest:digest(),selectionDigest:digest()});
  const physicalIdentity=object({schemaRef:{const:'helix://contracts/types/PhysicalMaterialIdentity/v1'},schemaVersion:{const:1},
    materialKey:digest(),mountScopeId:id(),inode:id(),contentHashAlgorithm:{const:'sha256'},contentHash:digest()});
  const readHandle=object({identity:physicalIdentity,bindingRevision:positive(),location:text()});
  const variant=(kind,properties,required=Object.keys(properties))=>object({
    schemaRef,schemaVersion:version,bindingKind:{const:kind},assemblyBasisDigest:digest(),...properties,bindingDigest:digest()
  },['schemaRef','schemaVersion','bindingKind','assemblyBasisDigest',...required,'bindingDigest']);
  return {$schema:DRAFT,$id:typeId('ProcurementCandidateAssemblyPlanBinding'),
    title:'ProcurementCandidateAssemblyPlanBinding@1','x-helix-ssotRefs':['8.5.11','8.6.20'],
    'x-helix-maxCanonicalBytes':16*1024,
    oneOf:[
      variant('media_probe',{ordinal:nonNegative(),readHandle,outputIdentity:resultIdentity}),
      variant('playability',{runRef,ruleRef,sourceResultRefs:refs(),outputIdentity:resultIdentity}),
      variant('structure',{runRef:object({...runRef.properties,materialFieldContextDigest:digest(),layoutEvidenceSetDigest:digest()}),
        structureInputDigest:digest(),sourceResultRefs:refs(2),outputIdentity:resultIdentity}),
      variant('identity_claim',{sourceResultRefs:refs(1,1),outputIdentity:resultIdentity}),
      variant('primary_manifest',{selectionDigest:digest(),sourceResultRefs:refs(1,1),outputIdentity:resultIdentity}),
      variant('candidate_publication',{runRef:object({procurementRunId:id(),runBasisDigest:digest(),candidatePackageRevisionHead:nonNegative()}),
        ruleRef,sourceResultRefs:refs(3,3),candidateDraftDigest:digest(),outputIdentity:resultIdentity})
    ]};
}
function buildProcurementApplicationSchemas() { return Object.freeze({
  MaterialFieldAdminProjection:materialFieldAdminProjection(),
  MaterialFieldProfileHintRevisionCommand:profileHintRevisionCommand(),
  MaterialFieldProfileHintSnapshot:profileHintSnapshot(),
  MaterialFieldRegistrationCommand:materialFieldRegistrationCommand(),
  ProcurementMaterialFieldAdminResult:materialFieldAdminResult(),
  ProcurementCandidateAssemblyPlanBinding:candidateAssemblyPlanBinding(),
  ProcurementRetryAdmissionHead:retryAdmissionHead(), ProcurementRetryAdmissionResult:retryAdmissionResult(), ProcurementRetryConsumeMemberSnapshot:retryConsumeMemberSnapshot(), ProcurementRetryIntent:retryIntent(), ProcurementRetryIntentAvailableMessage:retryIntentAvailableMessage(), ProcurementRetryIntentReceipt:retryIntentReceipt(),
  ProcurementRunExecutionBasis:runExecutionBasis(), ProcurementRunSealDecision:runSealDecision(), ProcurementRunSealReceipt:runSealReceipt(),
  ProcurementTriageRuleRegistry:triageRuleRegistry(), ProcurementTriageRuleSnapshot:triageRuleSnapshot()
}); }
function canonicalize(value) { if(Array.isArray(value))return value.map(canonicalize); if(value&&typeof value==='object')return Object.keys(value).sort().reduce((out,key)=>{out[key]=canonicalize(value[key]);return out;},{}); return value; }
function schemaDigest(value) { return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex'); }

module.exports = Object.freeze({ buildProcurementApplicationSchemas, schemaDigest, typeId });
