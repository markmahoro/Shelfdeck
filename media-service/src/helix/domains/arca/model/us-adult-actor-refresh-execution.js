'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {readRequirement}=require('./us-adult-actor-refresh-objective');
const {SOURCE,RESULT}=require('../../../contracts/us-adult-inventory-analysis');
const SCOPE='helix://contracts/domain-types/UsAdultActorRefreshScope/v1',OBJECTIVE='helix://arca/work/us_adult_actor_source/v1';
function fail(message){throw Object.assign(new Error(message),{code:'ARCA_US_ADULT_REFRESH_EXECUTION_STALE'});}
function executionScope({context,care,intent,rootHandleRef}){
  const objective=readRequirement(care?.careRequirement);
  if(care?.state!=='active'||care.shelfEntryId!==intent.shelfEntryId||context?.shelfEntryId!==intent.shelfEntryId||context.raw.entry.status!=='active'||
      context.raw.shelf.status!=='active'||context.raw.correctionGate||context.raw.reservations.some(item=>item.state==='active')||
      !objective||objective.intentId!==intent.intentId||objective.intentDigest!==intent.intentDigest||care.careBasisDigest!==intent.careBasisDigest||
      context.basis.digest!==intent.careBasisDigest||context.knownBindings.digest!==intent.knownBindingsDigest||
      Number(context.raw.entry.current_inventory_revision)!==intent.inventoryRevision||context.raw.inventory.representation_digest!==intent.representationDigest||
      Number(context.raw.entry.current_deck_fact_revision)!==intent.deckFactRevision||Number(context.raw.entry.canonical_identity_revision)!==intent.canonicalIdentityRevision||
      context.raw.entry.canonical_identity_key!==intent.canonicalIdentityKey||context.raw.identity.identity_digest!==intent.canonicalIdentityDigest||
      !/^[a-f0-9]{64}$/.test(rootHandleRef||''))fail('Actor preparation requires its active Case, exact Inventory and registered Workspace root.');
  const body={schemaRef:SCOPE,schemaVersion:1,shelfEntryId:intent.shelfEntryId,aftercareCaseId:care.aftercareCaseId,intentId:intent.intentId,
    intentDigest:intent.intentDigest,careRequirementDigest:care.careRequirementDigest,inventoryRevision:intent.inventoryRevision,workspaceRootHandleRef:rootHandleRef};
  return Object.freeze({...body,scopeDigest:canonicalDigest(body)});
}
function sourceWork(intent,aftercareCaseId){
  const identity={intentId:intent.intentId,intentDigest:intent.intentDigest,aftercareCaseId},id=canonicalDigest(identity),
    dependencies=[{ownerDomain:'arca',objectType:'aftercare_case',objectId:aftercareCaseId,revision:1,digest:require('./us-adult-actor-refresh-objective').requirement(intent).digest},
      {ownerDomain:'arca',objectType:'us_adult_actor_refresh_intent',objectId:intent.intentId,revision:1,digest:intent.intentDigest}];
  return Object.freeze({schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1',schemaVersion:1,workId:'arca-us-source-work-'+id,
    ownerDomain:'arca',processType:'arca_shelf_entry',processId:intent.shelfEntryId,workKind:'us_adult_actor_source',workObjectiveTypeRef:OBJECTIVE,workObjectiveVersion:1,
    executionBasisId:'arca-us-basis-'+intent.intentId,executionBasisDigest:intent.intentDigest,dependencyRefs:dependencies,
    priorityClass:'normal_foreground',priorityRevision:1,capabilityCatalogScope:'arca',workspaceMaterialScope:[],idempotencyKey:'arca-us-source-'+id,
    concurrencyScope:'arca_shelf_entry/'+intent.shelfEntryId+'/us_adult_actor_source',outputContractRef:RESULT});
}
function scopeSchema(){
  const text={type:'string',minLength:1,maxLength:256},digest={type:'string',pattern:'^[a-f0-9]{64}$'},
    properties={schemaRef:{const:SCOPE},schemaVersion:{const:1},shelfEntryId:text,aftercareCaseId:text,intentId:digest,intentDigest:digest,
      careRequirementDigest:digest,inventoryRevision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},workspaceRootHandleRef:digest,scopeDigest:digest};
  return {$schema:'https://json-schema.org/draft/2020-12/schema',$id:SCOPE,title:'UsAdultActorRefreshScope@1','x-helix-ssotRefs':['6.6.8','8.6.18'],
    'x-helix-role':'accepted-business-dto','x-helix-maxCanonicalBytes':4096,type:'object',additionalProperties:false,properties,required:Object.keys(properties)};
}
function equalScope(value,expected){if(canonicalJson(value)!==canonicalJson(expected))fail('Actor execution scope changed from its exact Owner projection.');return value;}
module.exports=Object.freeze({SOURCE,RESULT,SCOPE,OBJECTIVE,executionScope,sourceWork,scopeSchema,equalScope});
