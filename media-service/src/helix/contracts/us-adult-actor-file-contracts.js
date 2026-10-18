'use strict';
const DRAFT='https://json-schema.org/draft/2020-12/schema',BASE='helix://contracts/',
  CAPS=Object.freeze({assets:'arca.us_adult.assets.prepare@1',stage:'arca.us_adult.files.stage@1',publish:'arca.us_adult.files.publish@1',
    verify:'arca.us_adult.files.verify@1',commit:'arca.us_adult.inventory.commit@1',retire:'arca.us_adult.files.retire@1',close:'arca.us_adult.case.commit@1'});
const text=()=>({type:'string',minLength:1,maxLength:4096}),id=()=>({type:'string',minLength:1,maxLength:256}),digest=()=>({type:'string',pattern:'^[a-f0-9]{64}$'}),
  integer=(minimum=0)=>({type:'integer',minimum,maximum:Number.MAX_SAFE_INTEGER}),object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)}),
  ref=(name,version=1)=>({$ref:BASE+'types/'+name+'/v'+version}),nullable=value=>({oneOf:[value,{type:'null'}]}),
  schema=(name,kind,body,bytes)=>({$schema:DRAFT,$id:BASE+kind+'/'+name+'/v1',title:name+'@1','x-helix-ssotRefs':['6.6.8','8.6.18'],
    'x-helix-maxCanonicalBytes':bytes,...object({schemaRef:{const:BASE+kind+'/'+name+'/v1'},schemaVersion:{const:1},...body})});
const evidence=producer=>({evidenceId:id(),evidenceKind:text(),producerRef:producer,basisDigest:digest(),payloadDigest:digest(),observedAtMs:integer()});
function filePlanSchema(){return {...schema('UsAdultActorFilePlan','domain-types',{
  aftercareCaseId:id(),shelfEntryId:id(),intentId:digest(),intentDigest:digest(),selectionDigest:digest(),inventoryRevision:integer(1),representationDigest:digest(),
  canonicalIdentityDigest:digest(),placementDecisionDigest:digest(),target:object({endpointId:id(),rootLocation:text(),mountScopeId:id(),mountScopeRevision:integer(1)}),
  members:{type:'array',minItems:3,maxItems:1024,items:object({ordinal:integer(),role:id(),
    original:object({rootLocation:text(),location:text(),physicalIdentity:ref('PhysicalMaterialIdentity',2),bindingRevision:integer(1)}),
    retainedLocation:text(),targetEndpointId:id(),targetLocation:text(),source:{oneOf:[object({kind:{const:'retained_inventory'}}),
      object({kind:{const:'actor_artifact'},workspaceMaterialHandle:ref('WorkspaceMaterialHandle')})]}})},planDigest:digest()},2*1024*1024),
  'x-helix-role':'accepted-business-dto'};}
function executionInputSchema(){return {...schema('UsAdultActorExecutionInput','domain-types',{
  aftercareCaseId:id(),shelfEntryId:id(),intentId:digest(),intentDigest:digest(),action:{enum:['stage','publish','verify','commit','retire','close','unchanged']},
  assetsWorkId:nullable(id()),assetsResultDigest:nullable(digest()),planDigest:nullable(digest()),selectionDigest:nullable(digest()),
  stageWorkId:nullable(id()),stageResultDigest:nullable(digest()),publishWorkId:nullable(id()),publishResultDigest:nullable(digest()),
  verifyWorkId:nullable(id()),verifyResultDigest:nullable(digest()),commitWorkId:nullable(id()),commitResultDigest:nullable(digest()),
  retirementWorkId:nullable(id()),retirementResultDigest:nullable(digest()),completionDigest:nullable(digest()),inputDigest:digest()},16384),
  'x-helix-role':'accepted-business-dto'};}
function assetsSchema(){return {...schema('ArcaUsAdultAssetsPrepared','types',{
  ...evidence({const:CAPS.assets}),aftercareCaseId:id(),shelfEntryId:id(),intentId:digest(),intentDigest:digest(),selectionDigest:digest(),sourceResultDigest:digest(),
  factsHandle:ref('WorkspaceMaterialHandle'),nfoHandle:ref('WorkspaceMaterialHandle'),posterHandle:ref('WorkspaceMaterialHandle'),planHandle:ref('WorkspaceMaterialHandle'),planDigest:digest()},16384),
  'x-helix-envelopeRef':BASE+'types/EvidenceEnvelope/v1'};}
function receiptMember(final=false){return object({ordinal:integer(),role:id(),previousMaterialKey:digest(),location:text(),targetLocation:text(),endpointId:id(),
  physicalIdentity:ref('PhysicalMaterialIdentity',2),fullByteDigest:digest(),...(final?{bindingRevision:integer(1)}:{})});}
function fileReceiptSchema(){return {...schema('ArcaUsAdultFileReceipt','types',{
  ...evidence({enum:[CAPS.stage,CAPS.publish,CAPS.verify,CAPS.retire]}),aftercareCaseId:id(),shelfEntryId:id(),intentId:digest(),intentDigest:digest(),
  selectionDigest:digest(),planDigest:digest(),action:{enum:['stage','publish','verify','retire']},receipt:{oneOf:[
    object({schema:{const:'arca.us-adult-staged-files@1'},aftercareCaseId:id(),planDigest:digest(),directory:text(),members:{type:'array',minItems:3,maxItems:1024,items:receiptMember()},manifestDigest:digest()}),
    object({schema:{const:'arca.us-adult-final-files@1'},aftercareCaseId:id(),planDigest:digest(),stagedManifestDigest:digest(),members:{type:'array',minItems:3,maxItems:1024,items:receiptMember(true)},finalRealityDigest:digest()}),
    object({schema:{const:'arca.us-adult-retired-files@1'},aftercareCaseId:id(),planDigest:digest(),finalRealityDigest:digest(),deletedCount:integer()})]},receiptDigest:digest()},1024*1024),
  'x-helix-envelopeRef':BASE+'types/EvidenceEnvelope/v1'};}
function inventoryFactSchemas(){
  const common={shelfEntryId:id(),aftercareCaseId:id(),intentDigest:digest(),selectionDigest:digest(),canonicalIdentityDigest:digest(),sourceFactDigest:digest()},
    entry=object({key:id(),value:{oneOf:[{type:'string',maxLength:65536},{type:'number'},{type:'boolean'},{type:'null'},{type:'array',maxItems:1024,items:{type:'string',maxLength:4096}}]}}),
    relation=require('./types/MediaCastFact/v1/schema.json').properties.relations.items;
  return {ArcaUsAdultMetadataFact:schema('ArcaUsAdultMetadataFact','application-types',{...common,
    descriptiveFacts:object({entries:{type:'array',maxItems:1024,items:entry}}),factDigest:digest()},128*1024),
    ArcaUsAdultActorFact:schema('ArcaUsAdultActorFact','application-types',{...common,personSnapshotDigest:digest(),referenceAssetId:id(),
      sourceBasisKind:{const:'us_adult_actor_refresh'},relations:{type:'array',minItems:1,maxItems:1,items:relation},relationCount:{const:1},relationsDigest:digest(),factDigest:digest()},128*1024)};
}
module.exports=Object.freeze({CAPS,filePlanSchema,executionInputSchema,assetsSchema,fileReceiptSchema,inventoryFactSchemas});
