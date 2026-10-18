'use strict';
const {createUsAdultAnalysisCoordinator}=require('./us-adult-analysis-coordinator');
const {readActorContext,productWork}=require('../model/us-adult-product-work');
function createUsAdultProductCoordinator(options){
  const analysis=createUsAdultAnalysisCoordinator(options);
  return Object.freeze({reconcile(snapshot,identity,workspace){
    const analyzed=analysis.reconcile(snapshot,identity,workspace);
    if(!['matched','unmatched'].includes(analyzed.kind))return analyzed;
    const context=readActorContext(options,snapshot.run.libraRunId);
    if(!context.selection)return Object.freeze({kind:'waiting_product_identity',phase:'us_adult_actor_confirmation',
      libraRunId:snapshot.run.libraRunId,subjectId:snapshot.run.subjectId,reasonCode:'us_adult_actor_unmatched',
      analysisId:analyzed.basis.analysisId,completionDigest:analyzed.completion.completionDigest,
      detectedFaceCount:analyzed.completion.detectedFaceCount});
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
