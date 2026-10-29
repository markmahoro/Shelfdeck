'use strict';
const path=require('node:path');
const {fixture}=require('./us-adult-catalogue-store');
const {buildCatalogueAnalysisBasis}=require('../../../src/helix/domains/libra/model/us-adult-catalogue-analysis-basis');
const {canonicalDigest:D}=require('../../../src/helix/contracts/canonical-json');
const {catalogueFrameBatch}=require('../../../src/helix/domains/libra/model/us-adult-catalogue-frame-work');
const {createBuffaloFrameEngine}=require('../../../src/helix/integrations/buffalo-frame-engine');
const {clusterFaces}=require('../../../src/helix/integrations/buffalo-video-evidence');
const {createCleanWesternFramePort}=require('../../../src/clean-western-analysis-port');
const {createCleanWorkspaceProductPort}=require('../../../src/clean-workspace-product-port');
function setup(t,overrides={}){
  const f=fixture(t);
  if(overrides.durationMs){
    const probe=f.args.sourceProbeRecord.result,{payloadDigest,...payload}=probe;probe.durationMs=overrides.durationMs;
    probe.payloadDigest=D({...payload,durationMs:overrides.durationMs});f.args.sourceProbeRecord.resultDigest=D(probe);
  }
  const basis=overrides.workspaceBytes||overrides.durationMs?buildCatalogueAnalysisBasis({...f.args,resourceBudget:{...f.args.resourceBudget,
    maximumWorkspaceBytes:overrides.workspaceBytes||f.args.resourceBudget.maximumWorkspaceBytes}}):f.basis,
    batch=catalogueFrameBatch(basis,'initial'),counters={frames:0,images:0,groups:0,stops:0},
    clock={value:1000,active:true},vector=Array(512).fill(0);vector[0]=1;
  f.db.prepare('INSERT INTO fx_workspace_registry(workspace_id,owner_domain,process_type,process_id,root_handle_ref,state,created_at_ms) VALUES(?,?,?,?,?,?,?)')
    .run('workspace','libra','libra_run','run',D('root'),'active',1);
  const workspace=createCleanWorkspaceProductPort({...f.options,rootPath:path.join(f.root,'workspace-root')}),
    configuration={faceModelRef:basis.faceModelRef,clusterParameters:basis.clusterParameters},
    frameExtractor={async extractPoints({timestampsMs,onFrame}){
      for(const [index,timestampMs]of timestampsMs.entries()){
        counters.frames++;if(overrides.partial&&index===3)return;
        await onFrame({timestampMs,bytes:Buffer.from(overrides.repeated?'same-frame':'frame-'+index)});
      }
    }},cpuSession={
      async analyzeEvidence(bytes){counters.images++;if(overrides.late)clock.active=false;
        return {coordinateSpace:{kind:'corrected_canvas',sourceWidth:1280,sourceHeight:720,width:1280,height:720,rotationDegrees:0,pixelDigest:D(bytes.toString())},
          faces:overrides.noFaces?[]:[{rectangle:[40,40,140,140],landmarks:[[60,60],[100,60],[80,80],[60,110],[100,110]],confidence:0.95,vector,rotationApplied:0}]};},
      async groupFaces(faces,parameters){counters.groups++;return clusterFaces(faces,parameters);},
      async stop(){counters.stops++;},
    },engine=createBuffaloFrameEngine({sourceHandle:basis.sourceHandle,frameBatch:batch,durationMs:basis.durationMs,
      faceModelRef:basis.faceModelRef,clusterParameters:basis.clusterParameters,resourceBudget:basis.resourceBudget,
      context:{ownerScope:{domain:'libra',processType:'libra_run',processId:'run'},assertExecutionActive(){
        if(!clock.active)throw Object.assign(Error('Stopped'),{code:'STOPPED'});}},cpuSession,frameExtractor,now:()=>clock.value,deadlineAtMs:100000}),
    port=createCleanWesternFramePort({workspaceProductPort:workspace,configuration,engine,now:()=>1000}),
    target={libraRunId:'run',workspaceId:'workspace',outputKind:'frame_set',sourceInputDigest:D({sourceHandle:basis.sourceHandle,samplingPlan:batch.samplingPlan}),
      targetRelativePath:'analysis/frames/initial.json',targetId:D('target'),targetDigest:D('target-digest')};
  f.db.prepare('UPDATE fx_workspace_registry SET root_handle_ref=? WHERE workspace_id=?').run(workspace.rootSnapshot().rootHandleRef,'workspace');
  return {...f,basis,batch,workspace,engine,port,target,counters,clock,cpuSession,frameExtractor};
}
module.exports=Object.freeze({setup});
