'use strict';
const {createUsAdultAnalysisPlanner,createUsAdultAnalysisProjections}=require('../planning/us-adult-analysis-planner');
const {createUsAdultCatalogueFramePlanner,createUsAdultCatalogueFrameProjections}=require('../planning/us-adult-catalogue-frame-planner');
const {createUsAdultCatalogueObservationPlanner,createUsAdultCatalogueObservationProjections}=require('../planning/us-adult-catalogue-observation-planner');

function isCatalogueFrames(request){
  return typeof request?.workObjectiveTypeRef==='string'&&
    /^helix:\/\/libra\/work\/us-adult-catalogue-(initial|supplement)-frames\/v1$/.test(request.workObjectiveTypeRef);
}
function isCatalogueObservation(request){
  return request?.workObjectiveTypeRef==='helix://libra/work/us-adult-catalogue-observation/v1';
}
function createUsAdultAnalysisDispatchPlanner(options){
  const analysis=createUsAdultAnalysisPlanner(options),
    frames=createUsAdultCatalogueFramePlanner(options),
    observation=createUsAdultCatalogueObservationPlanner(options);
  return Object.freeze({
    plannerContractRef:analysis.plannerContractRef,
    plannerVersion:analysis.plannerVersion,
    plan(request){
      if(isCatalogueObservation(request))return observation.plan(request);
      if(isCatalogueFrames(request))return frames.plan(request);
      return analysis.plan(request);
    },
  });
}
function createUsAdultAnalysisDispatchProjections(options){
  return Object.freeze([
    ...createUsAdultAnalysisProjections(options),
    ...createUsAdultCatalogueFrameProjections(options),
    ...createUsAdultCatalogueObservationProjections(options),
  ]);
}
module.exports=Object.freeze({createUsAdultAnalysisDispatchPlanner,createUsAdultAnalysisDispatchProjections,isCatalogueFrames,isCatalogueObservation});
