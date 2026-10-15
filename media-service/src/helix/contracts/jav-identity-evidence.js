'use strict';

const { javSourceSelectionSnapshotSchema } = require('./jav-source-contracts');
const digest=()=>({type:'string',pattern:'^[a-f0-9]{64}$'});
const text=(maxLength=256)=>({type:'string',minLength:1,maxLength});
const nullable=value=>({oneOf:[value,{type:'null'}]});
const integer=minimum=>({type:'integer',minimum,maximum:Number.MAX_SAFE_INTEGER});
const object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
function javIdentityFenceSchema() {
  return object({subjectId:text(),libraRunId:text(),runExecutionBasisDigest:digest(),expectedRunStateRevision:integer(1),
    expectedIdentityRevision:integer(0),expectedIdentityDigest:nullable(digest()),expectedSelectionIntentRevision:integer(0),
    selectionIntentId:nullable(text()),selectionIntentDigest:nullable(digest())});
}
function javQualificationSchema() {
  const identity=object({provider:{const:'jav'},namespace:{const:'jav_code'},providerKey:text(64),seasonNumber:{type:'null'},identityAnchorDigest:digest()});
  return object({schema:{const:'integration.jav-source-observation@1'},siteRef:text(64),endpointProfileDigest:digest(),networkRouteDigest:digest(),
    queryAnchorDigest:digest(),result:{const:'qualified'},pages:{type:'array',maxItems:5,items:object({resourceUrl:text(4096),byteDigest:digest()})},
    resourceKey:text(128),resourceUrl:text(4096),resolvedProviderIdentity:identity,
    descriptiveEntries:{type:'array',minItems:1,maxItems:256,items:object({key:text(128),value:text(16384)})},
    peopleHints:{type:'array',maxItems:64,items:object({displayName:text(1024),role:{const:'actor'},providerIdentities:{type:'array',maxItems:0}})},
    cover:object({locator:text(4096),byteDigest:digest(),byteCount:{type:'integer',minimum:1,maximum:16*1024*1024},
      format:{enum:['jpeg','png','webp']},width:integer(1),height:integer(1)}),observationDigest:digest()});
}
function javIdentityIntentSchema() {
  return object({intentId:text(),intentDigest:digest(),libraRunId:text(),subjectId:text(),runExecutionBasisDigest:digest(),
    contentProfile:{const:'jav'},sourceKind:{enum:['provider_exact','provider_search']},provider:{const:'jav'},namespace:{const:'jav_code'},
    sourceSnapshot:javSourceSelectionSnapshotSchema(),sourceOrdinal:{type:'integer',minimum:0,maximum:7},
    integrationId:text(),configRevision:integer(1),javSelectionFence:javIdentityFenceSchema(),
    resourceKey:nullable(text(128)),expectedTitle:nullable(text(16384)),expectedCoverDigest:nullable(digest())});
}
function javIdentityObservationSchema() {
  const common={schemaRef:{const:'helix://contracts/types/ProductIdentityEvidenceObservation/v1'},schemaVersion:{const:1},
    observationId:text(),intentId:text(),libraRunId:text(),subjectId:text(),sourceKind:{enum:['provider_exact','provider_search']},
    contentProfile:{const:'jav'},sourceSnapshot:javSourceSelectionSnapshotSchema(),sourceOrdinal:{type:'integer',minimum:0,maximum:7},
    javSelectionFence:javIdentityFenceSchema(),sourceAssociationDigest:digest(),evidenceDigest:digest(),observationDigest:digest()};
  const identity=object({provider:{const:'jav'},namespace:{const:'jav_code'},providerKey:text(64),displayTitle:text(16384),
    originalTitle:{type:'null'},releaseYear:nullable(integer(1800)),identityDigest:digest()});
  return {oneOf:[
    object({...common,result:{const:'resolved'},reasonCode:{type:'null'},candidates:{type:'array',maxItems:0},candidateMatchCount:{const:1},
      verifiedIdentity:identity,qualificationObservation:javQualificationSchema()}),
    object({...common,result:{enum:['not_found','ambiguous','conflicting']},reasonCode:text(128),
      candidates:{type:'array',maxItems:16,items:object({siteRef:text(64),resourceKey:text(128),javCode:text(64)})},
      candidateMatchCount:{type:'integer',minimum:0,maximum:16},verifiedIdentity:{type:'null'},qualificationObservation:{type:'null'}}),
  ]};
}
module.exports=Object.freeze({javIdentityFenceSchema,javQualificationSchema,javIdentityIntentSchema,javIdentityObservationSchema});
