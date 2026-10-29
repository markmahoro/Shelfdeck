'use strict';
// Experimental replay defaults stay outside the formal execution policy.
const implementation=require('../../../src/helix/integrations/buffalo-video-evidence');
const {samplingPoints}=require('../../../src/helix/domains/libra/model/us-adult-catalogue-sampling');
module.exports=Object.freeze({...implementation,samplingPoints,clusterFaces(faces,{threshold=0.6,ambiguityMargin=0.05,...options}={}){
  return implementation.clusterFaces(faces,{threshold,ambiguityMargin,...options});
}});
