'use strict';
function createUsAdultActorSelectionQuery(options){
  if(!options.movieProductionReader||!options.usAdultActorChoiceStore||!options.usAdultAnalysisStore||!options.usAdultMatchCompletionStore)
    throw new TypeError('Actor selection query requires Libra Owner snapshots.');
  return Object.freeze({read(libraRunId){
    const snapshot=options.movieProductionReader.readRunSnapshot(libraRunId);
    if(snapshot?.spec.contentProfile!=='western_adult')throw Object.assign(new Error('Actor selection is available for US Adult films only.'),{code:'US_ADULT_ACTOR_CHOICE_INVALID'});
    const choice=options.usAdultActorChoiceStore.current(snapshot.run.subjectId),analysis=options.usAdultAnalysisStore.getByRun(libraRunId),
      completion=options.usAdultMatchCompletionStore.getByRun(libraRunId),
      catalogueDecision=typeof options.usAdultCatalogueDecisionStore?.getByRun==='function'
        ?options.usAdultCatalogueDecisionStore.getByRun(libraRunId):null,
      cataloguePerson=catalogueDecision?.personSnapshot||null,
      person=choice?.personSnapshot||cataloguePerson||completion?.winner?.personSnapshot||null,
      canChoose=['active','suspended'].includes(snapshot.run.state)&&snapshot.run.packageRevisionHead===0,
      selectionOrigin=choice?'user_choice':catalogueDecision?'automatic_catalogue':completion?.winner?'automatic_match':null,
      analysisState=completion||catalogueDecision?'completed':analysis||options.usAdultCatalogueStore?.getByRun?.(libraRunId)?'analyzing':'not_started';
    return Object.freeze({libraRunId,subjectId:snapshot.run.subjectId,expectedRunStateRevision:snapshot.run.stateRevision,
      expectedChoiceRevision:choice?.revision||0,canChoose,analysisState,
      detectedFaceCount:completion?.detectedFaceCount??null,selectionOrigin,
      selectedActor:person?Object.freeze({personId:person.personId,canonicalName:person.canonicalName,personRevision:person.personRevision,
        referenceRevision:person.referenceProjection.currentReferenceRevision}):null});
  }});
}
module.exports=Object.freeze({createUsAdultActorSelectionQuery});
