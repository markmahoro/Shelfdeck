'use strict';
const {createUsAdultActorRefreshCommand}=require('./us-adult-actor-refresh-command');
const {readUsAdultInventoryPresentation}=require('../model/us-adult-inventory-presentation');
const {readRequirement}=require('../model/us-adult-actor-refresh-objective');
function createUsAdultActorRefreshAdmin(options){
  if(typeof options?.actorPipelineQuery?.base!=='function')throw new TypeError('Actor refresh status requires its Owner pipeline authority query.');
  const reader=options.aftercareContextReader,command=createUsAdultActorRefreshCommand({...options,actorRefreshStore:options.actorRefreshSource.store,
    onAdmitted:options.onActorRefreshAdmitted});
  function read(shelfEntryId){
    const context=reader.read(shelfEntryId);
    if(!context)throw Object.assign(new Error('The active Shelf Entry is absent.'),{code:'ARCA_US_ADULT_REFRESH_ENTRY_NOT_FOUND'});
    const presentation=readUsAdultInventoryPresentation(context),history=reader.store.history(shelfEntryId),
      active=history.cases.find(item=>['queued','active'].includes(item.state)),latest=history.cases.find(item=>readRequirement(item.careRequirement)),
      record=latest&&options.actorRefreshSource.store.byCase(latest.aftercareCaseId);
    let progress=null;
    if(record){
      const works=['source','match','assets','stage','publish','verify','commit','retire','close','discard'].flatMap(phase=>
        options.workResultReader.listWorks({ownerDomain:'arca',processType:'arca_shelf_entry',processId:shelfEntryId,workKind:'us_adult_actor_'+phase}))
        .filter(row=>options.workResultReader.readDefinition(row.work_id)?.definition.dependencyRefs.some(ref=>ref.objectType==='aftercare_case'&&ref.objectId===latest.aftercareCaseId));
      let reasonCode=latest.terminalReasonCode||null;
      if(['queued','active'].includes(latest.state)){
        try{options.actorPipelineQuery.base(shelfEntryId,latest.aftercareCaseId);}
        catch(error){if(!['ARCA_US_ADULT_REFRESH_EXECUTION_STALE','ARCA_US_ADULT_PHASE_PROOF_INVALID'].includes(error.code))throw error;reasonCode=error.code;}
      }
      progress={aftercareCaseId:latest.aftercareCaseId,mode:record.intent.mode,state:latest.state,reasonCode,
        works:works.map(row=>({workId:row.work_id,phase:row.work_kind.replace('us_adult_actor_',''),state:row.state,
          failureCode:options.workResultReader.status(row.work_id)?.latestAttempt?.failure_code||null}))};
    }
    return Object.freeze({shelfEntryId,expectedInventoryRevision:context.raw.entry.current_inventory_revision,
      expectedRepresentationDigest:context.raw.inventory.representation_digest,currentActor:{personId:presentation.actor.personId,displayName:presentation.actor.displayName},
      canRefresh:!active&&context.raw.shelf.status==='active'&&!context.raw.correctionGate&&!context.raw.reservations.some(row=>row.state==='active'),
      blockingCaseId:active?.aftercareCaseId||null,progress});
  }
  return Object.freeze({read,request:command.request});
}
module.exports=Object.freeze({createUsAdultActorRefreshAdmin});
