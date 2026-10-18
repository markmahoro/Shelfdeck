'use strict';
const {canonicalJson}=require('../../../contracts/canonical-json');
const {createUsAdultActorRefreshStore}=require('../persistence/us-adult-actor-refresh-store');
const {assertIntent}=require('../model/us-adult-actor-refresh');
const {physicalIdentityFromInventoryRow}=require('../model/aftercare-contract');
const {executionScope}=require('../model/us-adult-actor-refresh-execution');
function fail(message){throw Object.assign(new Error(message),{code:'ARCA_US_ADULT_REFRESH_EXECUTION_STALE'});}
function createUsAdultActorRefreshSource(options){
  const reader=options.aftercareContextReader,store=options.actorRefreshStore||createUsAdultActorRefreshStore(options),
    root=reader.store.aftercareWorkspaceRootSnapshot;
  function read(shelfEntryId,aftercareCaseId){
    const record=store.byCase(aftercareCaseId),care=reader.store.getCase(aftercareCaseId),context=reader.read(shelfEntryId);
    if(!record||record.intent.shelfEntryId!==shelfEntryId||!context)fail('Source preparation requires its exact durable Actor Intent and current Entry.');
    assertIntent(record.intent,options.contractValidator);
    return {intent:record.intent,care,context,scope:executionScope({context,care,intent:record.intent,rootHandleRef:root.rootHandleRef})};
  }
  function assertAuthority(scope){
    const current=read(scope.shelfEntryId,scope.aftercareCaseId);
    if(scope.intentId!==current.intent.intentId||scope.intentDigest!==current.intent.intentDigest)return false;
    const control=options.materialControlProjectionPort?.getMaterialControlProjection(current.intent.sourceBinding.materialKey);
    return control?.resultKind==='available'&&control.controlState==='controlled'&&control.ownerDomain==='arca'&&
      control.ownerScopeType==='shelf_entry'&&control.ownerScopeId===scope.shelfEntryId;
  }
  function capture(shelfEntryId,aftercareCaseId){
    const current=read(shelfEntryId,aftercareCaseId),row=current.context.raw.materials.find(item=>item.role==='primary_payload'),
      context={ownerScope:{domain:'arca',processType:'arca_shelf_entry',processId:shelfEntryId},assertExecutionActive(){
        const fresh=read(shelfEntryId,aftercareCaseId);if(canonicalJson(fresh.scope)!==canonicalJson(current.scope))fail('Source preparation scope changed during capture.');
      }};
    if(typeof options.captureUsAdultInventorySource!=='function')throw new TypeError('Arca source capture requires its Root physical adapter.');
    return options.captureUsAdultInventorySource({intent:current.intent,aftercareCaseId,identity:physicalIdentityFromInventoryRow(row),
      binding:{endpointId:row.endpoint_id,bindingRevision:Number(row.binding_revision),location:row.location},
      target:reader.sourceTargetBinding(shelfEntryId,row),context,assertAuthority});
  }
  return Object.freeze({store,read,capture,assertAuthority,workspaceRoot:root});
}
module.exports=Object.freeze({createUsAdultActorRefreshSource});
