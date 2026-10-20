'use strict';

const id=()=>({type:'string',minLength:1,maxLength:256});
const digest=()=>({type:'string',pattern:'^[a-f0-9]{64}$'});
const integer=(minimum=0)=>({type:'integer',minimum,maximum:Number.MAX_SAFE_INTEGER});
const object=(properties,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const array=(items,maxItems)=>({type:'array',items,uniqueItems:true,...(maxItems===undefined?{}:{maxItems})});
const nullable=value=>({anyOf:[value,{type:'null'}]});
const typeId=name=>'helix://contracts/application-types/'+name+'/v1';
const root=(name,body)=>({$schema:'https://json-schema.org/draft/2020-12/schema',$id:typeId(name),title:name+'@1',
  'x-helix-ssotRefs':['5.6.7','8.5.13','8.6.21','9.5.3','9.5.4'],'x-helix-maxCanonicalBytes':65536,...body});
const header=name=>({schemaRef:{const:typeId(name)},schemaVersion:{const:1}});

function arcaGap() {
  const requiredValue={oneOf:[object({field:id(),required:{type:'boolean'}}),object({artifact:id(),required:{type:'boolean'}}),
    object({code:id(),value:{anyOf:[{type:'string',maxLength:256},integer(),{type:'null'},array(id())]}})]};
  return object({ownerDomain:{const:'arca'},shelfEntryId:id(),requirementCode:id(),targetKind:{enum:['media','artifact','metadata_field']},
    targetId:id(),requiredValue,requiredValueDigest:digest(),findingKind:id(),findingDigest:digest(),gapDigest:digest()});
}
function arcaSchemas() {
  const preview={shelfEntryId:id(),inventoryRevision:integer(1),careBasisDigest:digest(),authorizationRevision:integer(),
    gaps:array(arcaGap()),gapSetDigest:digest(),evidenceDigest:digest(),eligibility:{enum:['eligible','ineligible','evidence_pending']},
    missingEvidence:array(id()),ineligibleReasons:array(id()),candidateDigest:digest(),acceptedGaps:array(arcaGap()),
    repairableGapDigests:array(digest()),unavailableRepairs:array(object({findingKind:id(),reasonCode:id()}))};
  return {
    ArcaDefectAuthorization:root('ArcaDefectAuthorization',object({...header('ArcaDefectAuthorization'),shelfEntryId:id(),revision:integer(1),
      inventoryRevision:integer(1),careBasisDigest:digest(),gaps:array(arcaGap()),gapSetDigest:digest(),candidateDigest:nullable(digest()),actorId:id(),decidedAtMs:integer(),authorizationDigest:digest()})),
    ArcaDefectPreview:root('ArcaDefectPreview',object(preview)),
    ArcaDefectAuthorizationReceipt:root('ArcaDefectAuthorizationReceipt',object({shelfEntryId:id(),revision:integer(1),authorizationDigest:digest()})),
    ArcaDefectCommand:root('ArcaDefectCommand',object({expectedInventoryRevision:integer(1),expectedCareBasisDigest:digest(),expectedAuthorizationRevision:integer(),
      expectedCandidateDigest:digest(),acknowledged:{const:true},idempotencyKey:id()})),
    ArcaDefectRepairResult:root('ArcaDefectRepairResult',{oneOf:[object({resultKind:{const:'repair_requested'},aftercareCaseId:id(),replayed:{type:'boolean'}}),
      object({resultKind:{const:'repair_unavailable'},reasonCode:{const:'no_current_bounded_repair_path'}})]}),
  };
}
function libraSchemas() {
  const common={...header('LibraRunOutcome'),libraRunId:id(),subjectId:id(),stableInputDigest:digest(),requirementsDigest:digest(),
    conditionsDigest:digest(),committedAtMs:integer()};
  const onDeck=object({receiptId:id(),receiptKind:{const:'on_deck_committed'},ownerDomain:{const:'arca'},onDeckRunId:id(),onDeckPackageId:id(),packageDigest:digest(),
    shelfEntryId:id(),inventoryRevision:integer(1),deckFactRevision:integer(1),commitDigest:digest(),committedAtMs:integer()});
  return {
    LibraStrategyAvailability:root('LibraStrategyAvailability',object({schemaRef:{const:typeId('LibraStrategyAvailability')},
      libraRunId:id(),executionBasisDigest:digest(),strategyKind:{enum:['moviepilot','tmdb']},
      reasonCode:{enum:['moviepilot_integration_unavailable','product_metadata_integration_unavailable','product_metadata_provider_identity_absent']},
      conditionDigest:digest(),startedAtMs:integer(),checkedAtMs:integer(),checkOrdinal:{type:'integer',minimum:0,maximum:5},
      status:{enum:['waiting','unavailable']},policyRef:{const:'libra.strategy-availability.beta@1'},availabilityId:digest(),evidenceDigest:digest()})),
    LibraRunOutcome:root('LibraRunOutcome',{oneOf:[object({...common,outcome:{enum:['on_deck','on_deck_with_defects']},reasonCode:{enum:['requirements_met','accepted_defects']},
      onDeckCommitReceipt:onDeck,authorizedDefectManifest:nullable({$ref:typeId('AuthorizedDefectManifest')})}),
      object({...common,outcome:{const:'unable_to_on_deck'},reasonCode:{enum:['user_cancelled','processing_failed']},terminalEvidenceDigest:digest(),
        terminalReasons:array({oneOf:[object({failureClass:id(),failureCode:id(),capabilityRef:id()}),require('./terminal-planning-schema').terminalPlanningSchema()]}),
        terminalProductEvidence:nullable(object({libraRunId:id(),runStateRevision:integer(1),runStateDigest:digest(),
          verificationId:id(),verificationDigest:digest(),reasonCodes:array(id(),32)})),
        recoveryConditions:array(object({conditionKind:{enum:['moviepilot','tmdb','media_compute']},snapshotDigest:digest()}),8),
        responsibilityReceipt:{$ref:typeId('LibraRunDiscardReceipt')}})]}),
    LibraDefectAuthorization:root('LibraDefectAuthorization',object({authorizationId:id(),revision:integer(1),state:{enum:['enabled','revoked']},
      actorId:id(),effectiveAtMs:integer(),revokedAtMs:integer(),authorizationDigest:digest()})),
    LibraDefectAuthorizationResult:root('LibraDefectAuthorizationResult',object({authorizationId:id(),revision:integer()})),
    LibraReprocessReservation:root('LibraReprocessReservation',object({intentId:id(),offerId:id()})),
    LibraReprocessIntent:root('LibraReprocessIntent',object({intentId:id(),libraRunId:id(),previousOutcomeDigest:digest()})),
  };
}
module.exports=Object.freeze({arcaSchemas,libraSchemas});
