'use strict';
const {FRAME,EMBED,CLUSTER,MATCH}=require('../model/us-adult-analysis-work');
const {createUsAdultAnalysisCapabilityPorts}=require('./us-adult-analysis-capability-ports');
const {createUsAdultCatalogueFrameCapabilityPorts}=require('./us-adult-catalogue-frame-capability-ports');
const {catalogueFrameWork}=require('../model/us-adult-catalogue-frame-work');

function catalogueFrameContext(options,context){
  if(!options?.usAdultCatalogueStore||context?.ownerScope?.domain!=='libra'||context.ownerScope.processType!=='libra_run')return null;
  const basis=options.usAdultCatalogueStore.getByRun(context.ownerScope.processId);
  if(!basis)return null;
  const snapshot=options.movieProductionReader.readRunSnapshot(basis.libraRunId);
  if(!snapshot)return null;
  return ['initial','supplement'].some(stage=>catalogueFrameWork(snapshot,basis,stage)?.workId===context.workId)?basis:null;
}
function createUsAdultSharedFrameCapabilityPorts(options){
  const analysis=createUsAdultAnalysisCapabilityPorts(options);
  const catalogue=typeof options.createCatalogueFramePort==='function'&&options.usAdultCatalogueStore
    ?createUsAdultCatalogueFrameCapabilityPorts(options):null;
  function choose(context){
    if(catalogue&&catalogueFrameContext(options,context))return catalogue;
    return analysis;
  }
  const refs=catalogue?[FRAME,EMBED,CLUSTER]:[FRAME,EMBED,CLUSTER,MATCH];
  const ports=Object.fromEntries(refs.map(ref=>[ref,Object.freeze({
    validateInputs(context){return choose(context)[ref].validateInputs(context);},
    validateResult(context,outcome){return choose(context)[ref].validateResult(context,outcome);},
    execute(context){return choose(context)[ref].execute(context);},
    observeEffectReality(context){
      const port=choose(context)[ref];
      return typeof port.observeEffectReality==='function'?port.observeEffectReality(context):
        Object.freeze({status:'unobservable',cleanupDeclared:false,evidenceDigest:null});
    },
  })]));
  if(!catalogue)ports[MATCH]=analysis[MATCH];
  else if(analysis[MATCH])ports[MATCH]=analysis[MATCH];
  return Object.freeze(ports);
}
module.exports=Object.freeze({createUsAdultSharedFrameCapabilityPorts,catalogueFrameContext});
