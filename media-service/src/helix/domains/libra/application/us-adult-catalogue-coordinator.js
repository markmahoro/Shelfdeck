'use strict';
const {canonicalJson}=require('../../../contracts/canonical-json');
const {CAPABILITY,assertObservationHandle}=require('../../../contracts/us-adult-catalogue-work-types');
const {buildCatalogueAnalysisBasis}=require('../model/us-adult-catalogue-analysis-basis');
const {catalogueFrameWork}=require('../model/us-adult-catalogue-frame-work');
const {exactCatalogueResult,readCompletedCatalogueBatches}=require('../model/us-adult-catalogue-work-results');
const {catalogueObservationWork}=require('../model/us-adult-catalogue-observation-work');
const {readCatalogueObservationResult}=require('../model/us-adult-catalogue-observation-result');
const {sourceMediaObservationWork}=require('../planning/media-production-work');
const {readSourceMediaObservations}=require('../planning/source-media-observations');
function fail(message){throw Object.assign(new Error(message),{code:'US_ADULT_CATALOGUE_COORDINATION_INVALID'});}
function createUsAdultCatalogueCoordinator(options){
  if(!options?.usAdultCatalogueStore||typeof options.submit!=='function'||!options.workResultReader||!options.movieProductionReader||
    !options.contractValidator||typeof options.workspaceProductPort?.readArtifactBytes!=='function'||typeof options.usAdultActorChoiceStore?.current!=='function')
    throw new TypeError('Catalogue coordination requires live Libra storage, Work results, manual choices and controlled Artifact reads.');
  const manual=snapshot=>{
    const choice=options.usAdultActorChoiceStore.current(snapshot.run.subjectId);
    return choice?Object.freeze({kind:'manual_choice_present',phase:'us_adult_catalogue',libraRunId:snapshot.run.libraRunId,choice}):null;
  };
  function current(snapshot,identity,workspace,basis){
    const latest=options.movieProductionReader.readRunSnapshot(snapshot.run.libraRunId);
    if(!latest||latest.run.state!=='active'||latest.spec.contentProfile!=='western_adult'||latest.run.subjectId!==snapshot.run.subjectId||
      latest.run.executionBasisDigest!==snapshot.run.executionBasisDigest||identity.factValue.contentProfile!=='western_adult'||
      identity.factValue.subjectId!==snapshot.run.subjectId||workspace.libraRunId!==snapshot.run.libraRunId||workspace.state!=='active')
      fail('Catalogue coordination no longer owns its active Run, resolved identity and Workspace.');
    if(basis){
      const value=options.usAdultCatalogueStore.readForExecution({libraRunId:snapshot.run.libraRunId,expectedBasisDigest:basis.basisDigest});
      if(value.resolvedIdentityDigest!==identity.factValue.identityDigest||value.workspaceId!==workspace.workspaceId||
        value.sourceProbeRef.workId!==sourceMediaObservationWork(snapshot).workId||canonicalJson(value)!==canonicalJson(basis))
        fail('The current catalogue Basis differs from the exact Run identity or Workspace.');
    }
  }
  function advance(snapshot,identity,workspace,basis,work,phase){
    current(snapshot,identity,workspace,basis);const chosen=manual(snapshot);if(chosen)return chosen;
    const submitted=options.submit(work),status=options.workResultReader.status(work.workId);
    if(status?.state==='succeeded')return null;
    return Object.freeze({kind:['failed','cancelled'].includes(status?.state)?'failed':'pending',phase,
      libraRunId:snapshot.run.libraRunId,workId:work.workId,work,status,replayed:submitted.replayed});
  }
  return Object.freeze({reconcile(snapshot,identity,workspace){
    current(snapshot,identity,workspace);let chosen=manual(snapshot);if(chosen)return chosen;
    const probing=advance(snapshot,identity,workspace,null,sourceMediaObservationWork(snapshot),'us_adult_catalogue_source_probe');if(probing)return probing;
    let basis=options.usAdultCatalogueStore.getByRun(snapshot.run.libraRunId);
    if(!basis){
      const sources=readSourceMediaObservations(options,snapshot);if(sources.length!==1)fail('Catalogue recognition requires one exact Primary source.');
      basis=options.usAdultCatalogueStore.freeze(buildCatalogueAnalysisBasis({...options.catalogueConfiguration,
        snapshot:{...snapshot,resolvedIdentityDigest:identity.factValue.identityDigest},sourceHandle:sources[0].readHandle,
        sourceProbeRecord:sources[0].record,workspaceId:workspace.workspaceId,contractValidator:options.contractValidator}));
    }
    current(snapshot,identity,workspace,basis);
    for(const mode of ['initial','initial_and_supplement']){
      const stage=mode==='initial'?'initial':'supplement',frames=catalogueFrameWork(snapshot,basis,stage);
      if(!frames)fail('An empty supplemental batch must not be admitted.');
      const analyzing=advance(snapshot,identity,workspace,basis,frames,'us_adult_catalogue_'+stage+'_frames');if(analyzing)return analyzing;
      const completedBatches=readCompletedCatalogueBatches(options,snapshot,basis,mode),
        work=catalogueObservationWork({snapshot,basis,completedBatches,validator:options.contractValidator}),
        observing=advance(snapshot,identity,workspace,basis,work,'us_adult_catalogue_'+mode+'_observation');if(observing)return observing;
      const record=exactCatalogueResult(options,work,CAPABILITY);
      assertObservationHandle(record.result,{validator:options.contractValidator});
      const artifact=options.workspaceProductPort.readArtifactBytes(record.result.observationArtifactHandle),
        result=readCatalogueObservationResult({basis,completedBatches,snapshot,validator:options.contractValidator,handle:record.result,bytes:artifact.bytes});
      current(snapshot,identity,workspace,basis);chosen=manual(snapshot);if(chosen)return chosen;
      const qualified=result.assessment.status==='qualified_candidate',canSupplement=mode==='initial'&&catalogueFrameWork(snapshot,basis,'supplement')!==null;
      if(qualified||!canSupplement)return Object.freeze({kind:qualified?'catalogue_candidate':'catalogue_unresolved',phase:'us_adult_catalogue',
        libraRunId:basis.libraRunId,basis,completedBatches,work,record,...result});
      // Only the complete initial Owner assessment permits entering the next loop.
    }
    fail('Catalogue coordination exceeded its two frozen observation stages.');
  }});
}
module.exports=Object.freeze({createUsAdultCatalogueCoordinator});
