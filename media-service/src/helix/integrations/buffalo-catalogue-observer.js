'use strict';
const {createHash}=require('node:crypto');
const {canonicalDigest,canonicalJson}=require('../contracts/canonical-json');
const {assertGeneration}=require('../contracts/face-catalogue-generation');
const {assertCatalogueSearchPolicy}=require('../contracts/face-catalogue-search-policy');
const {assertBuffaloModelReference,buffaloModelReference}=require('../contracts/buffalo-model-reference');
const {restoreBuffaloEmbeddingSet}=require('../contracts/buffalo-frame-artifact');
const {createCatalogueObservation,assertCatalogueQueryResult,MAX_BYTES}=require('../contracts/buffalo-catalogue-observation');
const {frameFaces}=require('./buffalo-video-evidence');
function fail(message,code='BUFFALO_CATALOGUE_OBSERVER_INVALID'){throw Object.assign(new Error(message),{code});}
function createBuffaloCatalogueObserver({cpuSession,context,deadlineAtMs,operationDeadlineMs,now=Date.now}={}){
  if(!['groupFaces','loadCatalogue','searchCatalogue','stop'].every(method=>typeof cpuSession?.[method]==='function')||
    typeof context?.assertExecutionActive!=='function'||!Number.isSafeInteger(deadlineAtMs)||deadlineAtMs<=now()||
    !Number.isSafeInteger(operationDeadlineMs)||operationDeadlineMs<1||operationDeadlineMs>60000)
    fail('Catalogue observation requires a bounded CPU session and live execution authority.');
  assertBuffaloModelReference(cpuSession.faceModelRef,'western_frame_set');
  function active(){context.assertExecutionActive();if(context.abortSignal?.aborted||now()>=deadlineAtMs)
    fail('Catalogue observation was stopped or exceeded its deadline.','BUFFALO_CATALOGUE_OBSERVER_STOPPED');}
  async function cpu(method,args){
    active();try{
      const duration=method==='loadCatalogue'?180000:operationDeadlineMs,
        result=await cpuSession[method](...args,{deadlineAtMs:Math.min(deadlineAtMs,now()+duration),signal:context.abortSignal});
      active();return result;
    }catch(error){await cpuSession.stop();throw error;}
  }
  return Object.freeze({async observe(input){
    const serialized=canonicalJson(input);if(Buffer.byteLength(serialized)>50*1024*1024)
      fail('Catalogue source Artifacts exceed their explicit input budget.','BUFFALO_CATALOGUE_OBSERVATION_BUDGET_EXCEEDED');
    const {basisDigest,mode,catalogueGeneration,searchPolicy,clusterParameters,batches}=JSON.parse(serialized);
    active();assertGeneration(catalogueGeneration);assertCatalogueSearchPolicy(searchPolicy);
    const {digest,...parameters}=clusterParameters||{},model=buffaloModelReference('western_frame_set');
    if(!/^[a-f0-9]{64}$/.test(basisDigest||'')||!['initial','initial_and_supplement'].includes(mode)||
      !Array.isArray(batches)||batches.length!==(mode==='initial'?1:2)||clusterParameters?.modelRefDigest!==model.digest||
      canonicalDigest(parameters)!==digest||clusterParameters.distanceMetric!=='cosine'||clusterParameters.minClusterSize!==1||
      !clusterParameters.typedParameters?.some(item=>item.parameter==='algorithm'&&item.value==='nearest_centroid_guarded'))
      fail('Catalogue observation requires its exact source batches and frozen grouping policy.');
    const frames=[],sourceBatches=[];
    for(const [index,batch]of batches.entries()){
      active();if(batch.stage!==(index===0?'initial':'supplement')||
        createHash('sha256').update(canonicalJson(batch.embeddingSet)).digest('hex')!==batch.embeddingDigest)
        fail('Catalogue input lost the complete exact producer embedding bytes.');
      const restored=restoreBuffaloEmbeddingSet(batch.embeddingSet),source=restored.source;
      if(source.basisDigest!==basisDigest||source.batchDigest!==batch.batchDigest||source.frameArtifactSetDigest!==batch.frameArtifactSetDigest||
        restored.frames.some(frame=>frame.frame.stage!==batch.stage))fail('Catalogue input crossed its frozen source batch.');
      sourceBatches.push({stage:batch.stage,batchDigest:batch.batchDigest,frameArtifactSetDigest:batch.frameArtifactSetDigest,
        embeddingDigest:batch.embeddingDigest,frameCount:restored.frames.length});frames.push(...restored.frames);
    }
    if(frames.some((frame,index)=>frame.frame.ordinal!==index))fail('Catalogue batches lost their complete unique global frame ordering.');
    const faces=frameFaces(frames),frameEvidenceRefs=frames.map(frame=>({frameOrdinal:frame.frame.ordinal,stage:frame.frame.stage,stratum:frame.frame.stratum,
      timestampMs:frame.frame.timestampMs,imageDigest:frame.frame.imageDigest,frameEvidenceDigest:frame.evidenceDigest,
      faces:frame.faces.map(face=>({faceOrdinal:face.faceOrdinal,faceEvidenceDigest:face.faceEvidenceDigest,vectorDigest:canonicalDigest(face.vector)}))})),
      margin=clusterParameters.typedParameters.find(item=>item.parameter==='ambiguity_margin')?.value,
      groups=faces.length?await cpu('groupFaces',[faces,{threshold:clusterParameters.distanceThreshold,ambiguityMargin:margin}]):[],
      byKey=new Map(faces.map(face=>[face.frameOrdinal+':'+face.faceOrdinal,face]));
    let readProof=null,bytes=Buffer.byteLength(canonicalJson({groups,frameEvidenceRefs,sourceBatches}));const queries=[];
    if(faces.length){
      readProof=await cpu('loadCatalogue',[]);
      if(readProof?.generationDigest!==catalogueGeneration.generationDigest||readProof.policyDigest!==searchPolicy.policyDigest||readProof.dimension!==512)
        fail('The loaded catalogue differs from its frozen generation or search policy.');
      for(const group of groups)for(const key of group.representativeKeys){
        const face=byKey.get(key);if(!face)fail('A catalogue representative is outside its exact source Evidence.');
        const result=await cpu('searchCatalogue',[face.vector]);
        assertCatalogueQueryResult(result,{generationDigest:catalogueGeneration.generationDigest,policyDigest:searchPolicy.policyDigest});
        const query={faceKey:key,faceEvidenceDigest:face.faceEvidenceDigest,vectorDigest:canonicalDigest(face.vector),result,resultDigest:canonicalDigest(result)};
        bytes+=Buffer.byteLength(canonicalJson(query));
        if(queries.length>=1280||bytes+16384>MAX_BYTES)fail('Complete catalogue Evidence exceeds its explicit Artifact budget.','BUFFALO_CATALOGUE_OBSERVATION_BUDGET_EXCEEDED');
        queries.push(query);
      }
    }
    active();return createCatalogueObservation({basisDigest,mode,modelRefDigest:model.digest,catalogueGenerationDigest:catalogueGeneration.generationDigest,
      searchPolicyDigest:searchPolicy.policyDigest,clusterParameterDigest:clusterParameters.digest,sourceBatches,sourceSetDigest:canonicalDigest(sourceBatches),
      frameEvidenceRefs,groups,queries,catalogueReadProof:readProof,resultKind:faces.length?'observed':'no_faces',observedAtMs:now()});
  }});
}
module.exports=Object.freeze({createBuffaloCatalogueObserver});
