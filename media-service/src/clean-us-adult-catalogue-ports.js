'use strict';
const {createBuffaloCpuSession}=require('./helix/integrations/buffalo-cpu-session');
const {createBuffaloFrameEngine}=require('./helix/integrations/buffalo-frame-engine');
const {createBuffaloCatalogueObserver}=require('./helix/integrations/buffalo-catalogue-observer');
const {createCleanWesternFramePort}=require('./clean-western-analysis-port');
const {createCleanBuffaloCataloguePort}=require('./clean-buffalo-catalogue-port');
const {UNAVAILABLE}=require('./helix/domains/libra/application/us-adult-catalogue-host-config');

function failUnavailable(message){throw Object.assign(new Error(message),{code:UNAVAILABLE});}
async function stopSession(cpuSession){
  if(typeof cpuSession?.stop==='function')await cpuSession.stop();
}
function withSessionStop(cpuSession,method){
  return async(...args)=>{
    try{return await method(...args);}
    finally{await stopSession(cpuSession);}
  };
}
function createUsAdultCataloguePortFactories({catalogueHost,frameExtractor,workspaceProductPort,now=Date.now}){
  if(!catalogueHost)return Object.freeze({
    createCatalogueFramePort(){failUnavailable('Catalogue frame execution requires a configured buffalo catalogue root.');},
    createCatalogueObservationPort(){failUnavailable('Catalogue observation requires a configured buffalo catalogue root.');},
  });
  const {buffaloModelRoot,catalogueRoot,catalogueConfiguration}=catalogueHost;
  function createCpuSession(){
    return createBuffaloCpuSession({
      modelRoot:buffaloModelRoot,
      catalogueRoot,
      catalogueGeneration:catalogueConfiguration.catalogueGeneration,
      catalogueSearchPolicy:catalogueConfiguration.catalogueSearchPolicy,
    });
  }
  return Object.freeze({
    createCatalogueFramePort({context,basis,batch,capturePublicationFence}){
      const runtimeEffectAuthority=Object.freeze({effectClass:'workspace_write',eventAttemptId:context.eventAttemptId,
        idempotencyKey:context.idempotencyKey,recoveryDecision:context.recoveryDecision});
      const catalogueFrameScope=Object.freeze({analysisId:basis.analysisId,batchDigest:batch.batchDigest,stage:batch.stage,
        capabilityRef:context.capabilityRef,maximumBytes:Math.min(256*1024*1024,batch.workspaceByteBudget)});
      const scoped=Object.freeze({
        materializeArtifact:request=>workspaceProductPort.materializeArtifact({...request,runtimeEffectAuthority,catalogueFrameScope,capturePublicationFence}),
        openFrameCompositeSink:request=>workspaceProductPort.openFrameCompositeSink({...request,runtimeEffectAuthority,catalogueFrameScope,capturePublicationFence}),
        recoverMaterializedArtifact:request=>workspaceProductPort.recoverMaterializedArtifact({...request,runtimeEffectAuthority,catalogueFrameScope,capturePublicationFence}),
        readArtifactBytes:handle=>workspaceProductPort.readCatalogueFrameArtifactBytes
          ?workspaceProductPort.readCatalogueFrameArtifactBytes(handle,{libraRunId:basis.libraRunId,workspaceId:basis.workspaceId,maximumBytes:catalogueFrameScope.maximumBytes})
          :workspaceProductPort.readArtifactBytes(handle),
        readCatalogueFrameRecoveryCandidate:request=>workspaceProductPort.readCatalogueFrameRecoveryCandidate?.(request),
        rootSnapshot:()=>workspaceProductPort.rootSnapshot(),
      });
      const cpuSession=createCpuSession();
      const engine=createBuffaloFrameEngine({sourceHandle:basis.sourceHandle,frameBatch:batch,durationMs:basis.durationMs,
        faceModelRef:basis.faceModelRef,clusterParameters:basis.clusterParameters,resourceBudget:basis.resourceBudget,
        context,cpuSession,frameExtractor,now,deadlineAtMs:now()+basis.resourceBudget.analysisDeadlineMs});
      const port=createCleanWesternFramePort({workspaceProductPort:scoped,configuration:{faceModelRef:basis.faceModelRef,
        clusterParameters:basis.clusterParameters},engine,now});
      return Object.freeze({
        extractFrames:withSessionStop(cpuSession,request=>port.extractFrames(request)),
        computeEmbeddings:withSessionStop(cpuSession,request=>port.computeEmbeddings(request)),
        computeClusters:withSessionStop(cpuSession,request=>port.computeClusters(request)),
        inspectRecovery:request=>{
          try{return port.inspectRecovery(request);}
          finally{void stopSession(cpuSession);}
        },
      });
    },
    createCatalogueObservationPort({context,basis,completedBatches,capturePublicationFence,validateObservation}){
      const runtimeEffectAuthority=Object.freeze({effectClass:'workspace_write',eventAttemptId:context.eventAttemptId,
        idempotencyKey:context.idempotencyKey,recoveryDecision:context.recoveryDecision});
      const scoped=Object.freeze({
        materializeArtifact:request=>workspaceProductPort.materializeArtifact({...request,runtimeEffectAuthority,capturePublicationFence}),
        recoverMaterializedArtifact:request=>workspaceProductPort.recoverMaterializedArtifact({...request,runtimeEffectAuthority,capturePublicationFence}),
        readArtifactBytes:handle=>workspaceProductPort.readArtifactBytes(handle),
        rootSnapshot:()=>workspaceProductPort.rootSnapshot(),
      });
      const cpuSession=createCpuSession();
      const observer=createBuffaloCatalogueObserver({cpuSession,context,now,
        deadlineAtMs:now()+basis.resourceBudget.analysisDeadlineMs,operationDeadlineMs:Math.min(60000,basis.resourceBudget.imageDeadlineMs)});
      return createCleanBuffaloCataloguePort({context,workspaceProductPort:scoped,capturePublicationFence,validateObservation,
        async computeObservation(){
          try{
            const batches=[];
            for(const batch of completedBatches.batches){
              const bytes=scoped.readArtifactBytes(batch.faceEmbeddingSetHandle.artifactHandle).bytes;
              batches.push({stage:batch.stage,batchDigest:batch.batchDigest,frameArtifactSetDigest:batch.frameArtifactSet.manifestDigest,
                embeddingDigest:batch.faceEmbeddingSetHandle.embeddingDigest,embeddingSet:JSON.parse(bytes.toString('utf8'))});
            }
            return await observer.observe({basisDigest:basis.basisDigest,mode:completedBatches.mode,catalogueGeneration:basis.catalogueGeneration,
              searchPolicy:basis.catalogueSearchPolicy,clusterParameters:basis.clusterParameters,batches});
          }finally{await stopSession(cpuSession);}
        }});
    },
  });
}
module.exports=Object.freeze({createUsAdultCataloguePortFactories});
