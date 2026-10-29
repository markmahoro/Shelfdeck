'use strict';
const assert=require('node:assert/strict');
const {setup}=require('./buffalo-frame-engine');
const {createValidator}=require('./catalogue-nominal-schemas');
const {canonicalDigest:D,canonicalJson}=require('../../../src/helix/contracts/canonical-json');
const {CAPABILITY,FRAME,EMBED,CLUSTER,resultRef}=require('../../../src/helix/contracts/us-adult-catalogue-work-types');
const {createUsAdultCatalogueStore}=require('../../../src/helix/domains/libra/persistence/us-adult-catalogue-store');
const {catalogueFrameBatch,catalogueFrameWork}=require('../../../src/helix/domains/libra/model/us-adult-catalogue-frame-work');
const {catalogueObservationWork}=require('../../../src/helix/domains/libra/model/us-adult-catalogue-observation-work');
const {readCompletedCatalogueBatches}=require('../../../src/helix/domains/libra/model/us-adult-catalogue-work-results');
const {catalogueObservationTarget,buildCatalogueObservationHandle}=require('../../../src/helix/domains/libra/model/us-adult-catalogue-observation-result');
const {createUsAdultCatalogueCoordinator}=require('../../../src/helix/domains/libra/application/us-adult-catalogue-coordinator');
const {sourceMediaObservationWork}=require('../../../src/helix/domains/libra/planning/media-production-work');
const {createBuffaloFrameEngine}=require('../../../src/helix/integrations/buffalo-frame-engine');
const {createBuffaloCatalogueObserver}=require('../../../src/helix/integrations/buffalo-catalogue-observer');
const {clusterFaces}=require('../../../src/helix/integrations/buffalo-video-evidence');
const {createCleanWesternFramePort}=require('../../../src/clean-western-analysis-port');
function coordination(t,overrides={}){
  const f=setup(t,overrides),validator=createValidator({includeProposed:true}),statuses=new Map(),records=new Map(),submissions=[],artifacts=new Map(),
    workspace={libraRunId:'run',workspaceId:'workspace',state:'active',currentRevision:1,stateDigest:D('workspace'),workspaceScopeDigest:D('scope')},
    identity={factValue:f.identity},store=createUsAdultCatalogueStore({...f.options,contractValidator:validator}),choice={current:null},
    source=sourceMediaObservationWork(f.args.snapshot),inputBindings={schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings:[]};
  function succeeded(work){statuses.set(work.workId,{state:'succeeded',latestAttempt:{attempt_id:'attempt-'+work.workId,state:'succeeded'}});}
  const record=(work,ref,result)=>({workId:work.workId,attemptId:'attempt-'+work.workId,planId:'plan-'+work.workId.slice(-64),
    eventId:'event-'+ref+'-'+work.workId.slice(-64),resultId:'result-'+ref+'-'+work.workId.slice(-64),capabilityRef:ref,
    resultSchemaRef:resultRef(ref),outcomeKind:'succeeded',result,resultDigest:D(result),inputBindings,inputBindingDigest:D(inputBindings)});
  succeeded(source);records.set(source.workId,[f.args.sourceProbeRecord]);
  const options={usAdultCatalogueStore:store,contractValidator:validator,catalogueConfiguration:f.args,
    usAdultActorChoiceStore:{current:()=>choice.current},
    movieProductionReader:{readRunSnapshot:()=>f.args.snapshot,readRun:()=>f.args.snapshot,readWorkspace:()=>workspace},
    productProductionPort:{issuePhysicalReadHandle:()=>f.basis.sourceHandle},
    workResultReader:{read:id=>records.get(id)||[],status:id=>statuses.get(id)||null},
    submit(work){submissions.push(work);return {replayed:statuses.has(work.workId)};},
    // The proposed fourth Artifact publisher is not activated in this branch.
    // These exact in-memory Observation handles isolate coordinator behavior;
    // the three source Artifacts use the real SQLite Registry/Workspace Port.
    workspaceProductPort:{readArtifactBytes(handle){
      const artifact=artifacts.get(handle.artifactHandleId);if(!artifact)return f.workspace.readArtifactBytes(handle);
      assert.equal(D(handle),D(artifact.handle));return {bytes:artifact.bytes};
    }},
  };
  async function completeFrames(stage){
    const batch=catalogueFrameBatch(f.basis,stage),work=catalogueFrameWork(f.args.snapshot,f.basis,stage);
    const engine=stage==='initial'?f.engine:createBuffaloFrameEngine({sourceHandle:f.basis.sourceHandle,frameBatch:batch,durationMs:f.basis.durationMs,
      faceModelRef:f.basis.faceModelRef,clusterParameters:f.basis.clusterParameters,resourceBudget:f.basis.resourceBudget,
      context:{ownerScope:{domain:'libra',processType:'libra_run',processId:'run'},assertExecutionActive(){}},cpuSession:f.cpuSession,now:()=>1000,deadlineAtMs:100000,
      frameExtractor:{async extractPoints({timestampsMs,onFrame}){for(const[index,timestampMs]of timestampsMs.entries())
        await onFrame({timestampMs,bytes:Buffer.from('supplement-'+index)});}}}),
      port=stage==='initial'?f.port:createCleanWesternFramePort({workspaceProductPort:f.workspace,engine,now:()=>1000,
        configuration:{faceModelRef:f.basis.faceModelRef,clusterParameters:f.basis.clusterParameters}}),
      frames=await port.extractFrames({sourceHandle:f.basis.sourceHandle,samplingPlan:batch.samplingPlan,
        outputTarget:{...f.target,sourceInputDigest:D({sourceHandle:f.basis.sourceHandle,samplingPlan:batch.samplingPlan}),targetRelativePath:'analysis/frames/'+stage+'.json'}}),
      embeddings=await port.computeEmbeddings({frameArtifactSet:frames,faceModelRef:f.basis.faceModelRef}),
      clusters=await port.computeClusters({faceEmbeddingSetHandle:embeddings,clusterParameters:f.basis.clusterParameters});
    records.set(work.workId,[record(work,FRAME,frames),record(work,EMBED,embeddings),record(work,CLUSTER,clusters)]);succeeded(work);return work;
  }
  async function completeObservation(mode,{match=true}={}){
    const completedBatches=readCompletedCatalogueBatches(options,f.args.snapshot,f.basis,mode),
      work=catalogueObservationWork({snapshot:f.args.snapshot,basis:f.basis,completedBatches,validator}),
      observer=createBuffaloCatalogueObserver({context:{assertExecutionActive(){}},deadlineAtMs:100000,operationDeadlineMs:60000,now:()=>1000,
        cpuSession:{faceModelRef:f.basis.faceModelRef,groupFaces:async(faces,parameters)=>clusterFaces(faces,parameters),async stop(){},
          async loadCatalogue(){return {generationDigest:f.basis.catalogueGeneration.generationDigest,policyDigest:f.basis.catalogueSearchPolicy.policyDigest,
            dimension:512,size:100,verificationDigest:D('verified')};},async searchCatalogue(){return {generationDigest:f.basis.catalogueGeneration.generationDigest,
            searchPolicyDigest:f.basis.catalogueSearchPolicy.policyDigest,raw:[{key:1,distance:match?0.1:0.8}],matches:match?[{key:1,uid:'catalogue:1',identityKey:'catalogue:1',
              name:'Example Performer',aliases:[],distance:0.1,combinedDistance:0.1}]:[],retiredSlots:[]};}}}),
      observation=await observer.observe({basisDigest:f.basis.basisDigest,mode,catalogueGeneration:f.basis.catalogueGeneration,
        searchPolicy:f.basis.catalogueSearchPolicy,clusterParameters:f.basis.clusterParameters,batches:completedBatches.batches.map(batch=>({
          stage:batch.stage,batchDigest:batch.batchDigest,frameArtifactSetDigest:batch.frameArtifactSet.manifestDigest,
          embeddingDigest:batch.faceEmbeddingSetHandle.embeddingDigest,
          embeddingSet:JSON.parse(f.workspace.readArtifactBytes(batch.faceEmbeddingSetHandle.artifactHandle).bytes)}))}),
      target=catalogueObservationTarget({basis:f.basis,completedBatches,workspace,rootSnapshot:f.workspace.rootSnapshot()}),bytes=Buffer.from(canonicalJson(observation)),
      artifact={...completedBatches.batches[0].frameArtifactSet.frameSetArtifactHandle,artifactHandleId:'proposed-'+work.workId,
        artifactKind:'face_catalogue_observation',storageRef:'workspace://workspace/'+target.targetRelativePath,digestHex:D(observation),sizeBytes:bytes.length,
        provenanceRef:{objectType:'us_adult_catalogue_observation',objectId:completedBatches.setDigest,revision:1,digest:target.targetDigest}},
      handle=buildCatalogueObservationHandle({basis:f.basis,completedBatches,snapshot:f.args.snapshot,validator,observation,outputTarget:target,artifactHandle:artifact});
    artifacts.set(artifact.artifactHandleId,{handle:artifact,bytes});records.set(work.workId,[record(work,CAPABILITY,handle)]);succeeded(work);
    return {work,completedBatches,handle,observation};
  }
  return {...f,options,workspaceOptions:f.options,store,validator,statuses,records,submissions,artifacts,workspaceState:workspace,identity,choice,source,
    completeFrames,completeObservation,reconcile:()=>createUsAdultCatalogueCoordinator(options).reconcile(f.args.snapshot,identity,workspace)};
}
module.exports=Object.freeze({coordination});
