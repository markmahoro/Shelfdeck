'use strict';
const {createUsAdultAnalysisCoordinator}=require('./us-adult-analysis-coordinator');
const {createUsAdultCatalogueCoordinator}=require('./us-adult-catalogue-coordinator');
const {createUsAdultCatalogueSettlementCoordinator}=require('./us-adult-catalogue-settlement-coordinator');
const {assertCatalogueConfigured}=require('./us-adult-catalogue-host-config');
const {readActorContext,productWork}=require('../model/us-adult-product-work');
const {
  recordUsAdultCatalogueSettlementFailure,
  clearUsAdultCatalogueSettlementFailure,
}=require('./us-adult-catalogue-settlement-failure-memo');

function createUsAdultProductCoordinator(options){
  const analysis=createUsAdultAnalysisCoordinator(options);
  const hostWiredCatalogue=typeof options.createCatalogueObservationPort==='function';
  const recordFailure=typeof options.recordUsAdultCatalogueSettlementFailure==='function'
    ?options.recordUsAdultCatalogueSettlementFailure:recordUsAdultCatalogueSettlementFailure;
  const clearFailure=typeof options.clearUsAdultCatalogueSettlementFailure==='function'
    ?options.clearUsAdultCatalogueSettlementFailure:clearUsAdultCatalogueSettlementFailure;
  return Object.freeze({reconcile(snapshot,identity,workspace){
    const choice=options.usAdultActorChoiceStore.current(snapshot.run.subjectId);
    let catalogueDecision=options.usAdultCatalogueDecisionStore?.getByRun?.(snapshot.run.libraRunId)||null;
    if(catalogueDecision)clearFailure(snapshot.run.libraRunId);
    if(hostWiredCatalogue&&!choice&&!catalogueDecision){
      assertCatalogueConfigured(options);
      const catalogue=createUsAdultCatalogueCoordinator(options).reconcile(snapshot,identity,workspace);
      if(catalogue.kind==='manual_choice_present'){
        // Manual Choice wins; continue into product with the current Choice.
      }else if(catalogue.kind==='catalogue_candidate'){
        const settled=createUsAdultCatalogueSettlementCoordinator(options).reconcile(catalogue);
        if(settled.kind==='settled'){
          clearFailure(snapshot.run.libraRunId);
          catalogueDecision=settled.decision;
        }else if(settled.kind==='manual_choice_present'){/* continue */}
        else if(settled.kind==='waiting_registration')
          return Object.freeze({kind:'waiting_product_identity',phase:settled.phase,libraRunId:snapshot.run.libraRunId,
            subjectId:snapshot.run.subjectId,reasonCode:settled.reasonCode,inputDigest:settled.inputDigest||null,
            personId:settled.personId||null,winnerName:settled.winnerName||null});
        else if(settled.kind==='unresolved'){
          // SSOT backup: local People reference match may still succeed after a complete catalogue miss.
        }else if(settled.kind==='failed'){
          recordFailure({libraRunId:snapshot.run.libraRunId,reasonCode:settled.reasonCode});
          return settled;
        }else if(settled.kind==='pending')return settled;
        else return settled;
      }else if(catalogue.kind==='catalogue_unresolved'){
        // Complete catalogue assessment without a qualified candidate; local backup may still settle.
      }else if(['pending','failed'].includes(catalogue.kind))return catalogue;
      else return catalogue;
    }
    const analyzed=analysis.reconcile(snapshot,identity,workspace);
    if(!['matched','unmatched'].includes(analyzed.kind))return analyzed;
    const context=readActorContext(options,snapshot.run.libraRunId);
    if(!context.selection){
      const catalogueBasis=options.usAdultCatalogueStore?.getByRun?.(snapshot.run.libraRunId);
      return Object.freeze({kind:'waiting_product_identity',phase:'us_adult_actor_confirmation',
        libraRunId:snapshot.run.libraRunId,subjectId:snapshot.run.subjectId,
        reasonCode:catalogueBasis?'us_adult_catalogue_unresolved':'us_adult_actor_unmatched',
        analysisId:analyzed.basis.analysisId,completionDigest:analyzed.completion.completionDigest,
        detectedFaceCount:analyzed.completion.detectedFaceCount});
    }
    const works=['analysis','normalize'].map(stage=>productWork(context,stage)),expected=new Set(works.map(work=>work.workId)),
      previous=options.workResultReader.listWorks({ownerDomain:'libra',processType:'libra_run',processId:snapshot.run.libraRunId,workKind:'us_adult_product'});
    // An unresolved film has no product Work and consumes the choice in place.
    // Once production consumed an actor, a new explicit choice replaces the Run
    // through the existing Owner admission path instead of overwriting Facts.
    if(previous.some(work=>!expected.has(work.work_id)))return Object.freeze({kind:'replacement_required',phase:'us_adult_actor_choice_changed',
      libraRunId:snapshot.run.libraRunId,subjectId:snapshot.run.subjectId,actorSelectionDigest:context.selection.selectionDigest,
      actorChoiceIntentId:context.selection.actorChoiceRecord?.intentId||null});
    for(const work of works){
      const submitted=options.submit(work),status=options.workResultReader.status(work.workId);
      if(status?.state==='succeeded')continue;
      return Object.freeze({kind:['failed','cancelled'].includes(status?.state)?'failed':'pending',phase:'us_adult_'+(work===works[0]?'product_analysis':'metadata_normalize'),
        libraRunId:snapshot.run.libraRunId,workId:work.workId,work,status,replayed:submitted.replayed});
    }
    return Object.freeze({kind:'ready',phase:'us_adult_product_metadata',selection:context.selection});
  }});
}
module.exports=Object.freeze({createUsAdultProductCoordinator});
