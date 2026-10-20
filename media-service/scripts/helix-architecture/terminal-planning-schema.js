'use strict';
function terminalPlanningSchema(){
  const text=()=>({type:'string',minLength:1,maxLength:4096}),digest=()=>({type:'string',pattern:'^[a-f0-9]{64}$'}),
    positive=()=>({type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}),
    properties={blockerSource:{const:'plan_rejection'},workId:text(),planId:text(),workBasisDigest:digest(),workAttemptId:text(),
      plannerContractRef:text(),plannerVersion:positive(),catalogDigest:digest(),graphDigest:digest(),failureCode:text(),attemptCount:positive(),
      terminalEvidenceDigest:digest(),memberDigest:digest()};
  return {type:'object',additionalProperties:false,properties,required:Object.keys(properties)};
}
module.exports=Object.freeze({terminalPlanningSchema});
