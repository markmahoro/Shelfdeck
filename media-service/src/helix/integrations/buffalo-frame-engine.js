'use strict';
const {createHash}=require('node:crypto');
const {canonicalDigest,canonicalJson}=require('../contracts/canonical-json');
const {buffaloModelReference,assertBuffaloModelReference,pack}=require('../contracts/buffalo-model-reference');
const {frameEvidence}=require('../contracts/buffalo-frame-evidence');
const {encodeBuffaloEmbeddingSet,restoreBuffaloEmbeddingSet,encodeBuffaloClusterSet}=require('../contracts/buffalo-frame-artifact');
const {unit,frameFaces}=require('./buffalo-video-evidence');
const bytesDigest=bytes=>createHash('sha256').update(bytes).digest('hex');
function fail(message){throw Object.assign(new Error(message),{code:'BUFFALO_FRAME_ENGINE_INVALID'});}
function same(value,expected){return canonicalJson(value)===canonicalJson(expected);}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function createBuffaloFrameEngine(options){
  let {frameBatch:batch,sourceHandle,faceModelRef,clusterParameters,resourceBudget:budget}=options||{};
  const {context,cpuSession,frameExtractor}=options||{},now=options?.now||Date.now,deadlineAtMs=options?.deadlineAtMs;
  assertBuffaloModelReference(faceModelRef,'western_frame_set');
  const {batchDigest,...batchBody}=batch||{};
  if(!batch||canonicalDigest(batchBody)!==batchDigest||batch.schema!=='libra.us-adult-catalogue-frame-batch@1'||
    batch.sourceHandleDigest!==canonicalDigest(sourceHandle)||batch.faceModelRefDigest!==faceModelRef.digest||
    !Array.isArray(batch.points)||!batch.points.length||batch.points.length>20||
    !Number.isSafeInteger(options.durationMs)||options.durationMs<1||!budget||budget.maximumFrames!==40||budget.maximumFacesPerFrame!==32||
    !Number.isSafeInteger(budget.maximumFrameBytes)||budget.maximumFrameBytes<1||budget.maximumFrameBytes>10*1024*1024||
    !Number.isSafeInteger(budget.maximumWorkspaceBytes)||budget.maximumWorkspaceBytes<1||
    !Number.isSafeInteger(batch.workspaceByteBudget)||batch.workspaceByteBudget<1||batch.workspaceByteBudget>Math.floor(budget.maximumWorkspaceBytes/2)||
    !Number.isSafeInteger(budget.imageDeadlineMs)||budget.imageDeadlineMs<1||budget.imageDeadlineMs>60000||
    !Number.isSafeInteger(deadlineAtMs)||deadlineAtMs<=now()||deadlineAtMs>now()+budget.analysisDeadlineMs||
    typeof context?.assertExecutionActive!=='function'||context.ownerScope?.domain!=='libra'||context.ownerScope.processType!=='libra_run'||
    context.ownerScope.processId!==sourceHandle.ownerScope?.scopeId||sourceHandle.ownerDomain!=='libra'||
    sourceHandle.ownerScope?.scopeType!=='libra_run'||typeof frameExtractor?.extractPoints!=='function'||
    !['analyzeEvidence','groupFaces','stop'].every(method=>typeof cpuSession?.[method]==='function')||
    clusterParameters?.modelRefDigest!==faceModelRef.digest)fail('The bounded frame engine requires exact technical inputs and live Owner authority.');
  const frozen=freeze(JSON.parse(canonicalJson({batch,sourceHandle,faceModelRef,clusterParameters,budget}))),
    durationMs=options.durationMs,maximumCompositeBytes=Math.min(256*1024*1024,batch.workspaceByteBudget);
  ({batch,sourceHandle,faceModelRef,clusterParameters,budget}=frozen);
  function space(bytes,limit=batch.workspaceByteBudget){if(bytes>limit)throw Object.assign(new Error('The frame batch exceeds its frozen cumulative Workspace quota.'),
    {code:'BUFFALO_FRAME_WORKSPACE_BUDGET_EXCEEDED'});}
  function active(){
    context.assertExecutionActive();
    if(context.abortSignal?.aborted||now()>=deadlineAtMs)throw Object.assign(new Error('Frame analysis exceeded its active bounded execution.'),{code:'BUFFALO_FRAME_ENGINE_STOPPED'});
  }
  async function cpu(method,...args){
    active();
    try{const result=await cpuSession[method](...args,{deadlineAtMs:Math.min(deadlineAtMs,now()+budget.imageDeadlineMs),signal:context.abortSignal});active();return result;}
    catch(error){await cpuSession.stop();throw error;}
  }
  function validateFrameComposite({frameComposite:composite,samplingPlan=frozen.batch.samplingPlan,sourceHandle:source=frozen.sourceHandle}){
    active();
    if(!same(samplingPlan,frozen.batch.samplingPlan)||!same(source,frozen.sourceHandle)||composite?.schema!=='libra.western-frame-composite@1'||
      !Array.isArray(composite.members)||!Array.isArray(composite.memberPayloads)||composite.members.length!==batch.points.length||
      composite.memberPayloads.length!==batch.points.length||composite.frameMemberSetDigest!==canonicalDigest({schema:'libra.western-frame-member-set@1',items:composite.members}))
      fail('Frame bytes do not represent the complete frozen batch within its space budget.');
    space(Buffer.byteLength(canonicalJson(composite)),maximumCompositeBytes);
    composite.members.forEach((member,index)=>{
      const payload=composite.memberPayloads[index];
      if(member.ordinal!==index||member.timestampMs!==batch.points[index].timestampMs||member.locator!=='composite-member:'+index||
        payload?.ordinal!==index||payload.encoding!=='base64'||payload.contentDigest!==member.contentDigest||typeof payload.bytesBase64!=='string')
        fail('A sampled frame was missing, duplicated or replaced.');
      const bytes=Buffer.from(payload.bytesBase64,'base64');
      if(!bytes.length||bytes.length>budget.maximumFrameBytes||bytes.toString('base64')!==payload.bytesBase64||bytesDigest(bytes)!==member.contentDigest)
        fail('A frame lost its exact bounded original bytes.');
    });
    active();return composite;
  }
  function sourceFor(frameSet){
    const {manifestDigest,publishedAtMs,...manifest}=frameSet||{};
    if(frameSet?.libraRunId!==sourceHandle.ownerScope.scopeId||frameSet.frameCount!==batch.points.length||canonicalDigest(manifest)!==manifestDigest||
      frameSet.frameSetArtifactHandle?.artifactKind!=='western_frame_set'||frameSet.frameSetArtifactHandle.ownerScope?.scopeId!==sourceHandle.ownerScope.scopeId||
      frameSet.sourceMaterialDigest!==batch.sourceHandleDigest||frameSet.samplingPlanDigest!==frozen.batch.samplingPlan.digest)
      fail('The frame Result does not describe the frozen source and complete batch.');
    return {basisDigest:batch.basisDigest,batchDigest:batch.batchDigest,frameArtifactSetDigest:frameSet.manifestDigest,
      frameMemberSetDigest:frameSet.frameMemberSetDigest,frameArtifactBytes:frameSet.frameSetArtifactHandle.sizeBytes,points:frozen.batch.points};
  }
  function validateEmbeddingSet({embeddingSet,frameArtifactSet,frameComposite,faceModelRef:model}){
    active();assertBuffaloModelReference(model,'western_frame_set');validateFrameComposite({frameComposite});
    const restored=restoreBuffaloEmbeddingSet(embeddingSet,{expectedSource:sourceFor(frameArtifactSet)});
    space(restored.source.frameArtifactBytes+Buffer.byteLength(canonicalJson(embeddingSet)));
    if(frameArtifactSet.frameMemberSetDigest!==frameComposite.frameMemberSetDigest||
      restored.frames.some((frame,index)=>frame.frame.imageDigest!==frameComposite.members[index].contentDigest))
      fail('Embedding geometry is detached from its frame Artifact bytes.');
    active();return restored;
  }
  function facesFor(restored){
    return frameFaces(restored.frames);
  }
  function validateClusters({clusters,faceEmbeddingSetHandle:handle,embeddingSet,clusterParameters:parameters}){
    active();
    if(!same(parameters,frozen.clusterParameters)||handle?.faceModelRefDigest!==faceModelRef.digest||handle.dimension!==512||
      handle.embeddingDigest!==bytesDigest(Buffer.from(canonicalJson(embeddingSet)))||!Array.isArray(clusters)||clusters.length>640)
      fail('Clusters lost their exact embedding bytes or model/parameter scope.');
    const restored=restoreBuffaloEmbeddingSet(embeddingSet),source=restored.source,allFaces=facesFor(restored),
      faces=new Map(allFaces.map(face=>[face.frameOrdinal+':'+face.faceOrdinal,face])),seen=new Set(),ids=new Set();
    space(source.frameArtifactBytes+Buffer.byteLength(canonicalJson(embeddingSet))+
      Buffer.byteLength(canonicalJson(encodeBuffaloClusterSet({clusters,sourceEmbeddingDigest:handle.embeddingDigest,clusterParameterDigest:parameters.digest}))));
    if(source.basisDigest!==batch.basisDigest||source.batchDigest!==batch.batchDigest||!same(source.points,frozen.batch.points)||
      handle.libraRunId!==sourceHandle.ownerScope.scopeId||handle.sourceArtifactSetDigest!==source.frameArtifactSetDigest||
      handle.vectorCount!==allFaces.length||handle.detectedFaceCount!==allFaces.length)
      fail('Cluster embeddings belong to another video batch.');
    for(const cluster of clusters){
      const {clusterProof,vector,...group}=cluster||{},proof=clusterProof,{proofDigest,...body}=proof||{};
      if(!proof||proof.schema!=='shared.buffalo-cluster-proof@1'||proof.basisDigest!==batch.basisDigest||proof.batchDigest!==batch.batchDigest||
        proof.sourceEmbeddingDigest!==handle.embeddingDigest||proof.groupDigest!==canonicalDigest(group)||canonicalDigest(body)!==proofDigest||
        !Array.isArray(group.memberKeys)||!group.memberKeys.length||!Array.isArray(group.representativeKeys)||group.representativeKeys.length>3||
        new Set(group.representativeKeys).size!==group.representativeKeys.length||group.representativeKeys.some(key=>!group.memberKeys.includes(key))||
        ids.has(group.clusterId))fail('A recovered cluster lost its complete member proof or producer proof.');
      ids.add(group.clusterId);const members=group.memberKeys.map(key=>{
        const face=faces.get(key);if(!face||seen.has(key))fail('Clusters must conserve each face exactly once.');seen.add(key);return face;
      }),evidence=members.map(face=>face.faceEvidenceDigest),sum=Array(512).fill(0),frameIds=new Set();
      members.forEach(face=>{
        if(frameIds.has(face.frameOrdinal))fail('Co-occurring faces cannot be one identity group.');frameIds.add(face.frameOrdinal);
        face.vector.forEach((value,index)=>sum[index]+=value);
      });
      const images=new Map();for(const face of members)if(!images.has(face.imageDigest))images.set(face.imageDigest,face.stratum);
      const coverage=[...new Set(images.values())].sort((a,b)=>a-b);
      if(!same(evidence,proof.memberFaceEvidenceDigests)||!same(group.coverageStrata,coverage)||group.uniqueFrameCount!==frameIds.size||!same(vector,unit(sum)))
        fail('Cluster geometry, temporal coverage or feature summary changed.');
    }
    if(seen.size!==faces.size)fail('A completed grouping omitted a detected face.');
    active();return clusters;
  }
  return Object.freeze({
    validateFrameComposite,validateEmbeddingSet,validateClusters,
    async extractFrameSet({sourceHandle:source,samplingPlan,outputSink}){
      active();if(!same(source,frozen.sourceHandle)||!same(samplingPlan,frozen.batch.samplingPlan)||typeof outputSink?.writeFrame!=='function')
        fail('Frame extraction requires the exact batch Plan and Artifact sink.');
      let count=0,encodedBytes=0;
      await frameExtractor.extractPoints({sourceHandle:source,context,durationMs,timestampsMs:batch.points.map(point=>point.timestampMs),async onFrame(frame){
        active();if(count>=batch.points.length||frame.timestampMs!==batch.points[count].timestampMs||!Buffer.isBuffer(frame.bytes)||
          !frame.bytes.length||frame.bytes.length>budget.maximumFrameBytes)fail('The frame extractor returned an incomplete or changed sample.');
        encodedBytes+=4*Math.ceil(frame.bytes.length/3)+512;
        space(encodedBytes+1024,maximumCompositeBytes);
        await outputSink.writeFrame(frame);active();count++;
      }});
      active();if(count!==batch.points.length)fail('A partial frame batch cannot succeed.');return {frameCount:count};
    },
    async computeEmbeddings({frameArtifactSet,frameComposite,faceModelRef:model}){
      validateFrameComposite({frameComposite});assertBuffaloModelReference(model,'western_frame_set');const frames=[];
      for(const [index,member]of frameComposite.members.entries()){
        active();const analysis=await cpu('analyzeEvidence',Buffer.from(frameComposite.memberPayloads[index].bytesBase64,'base64'));
        if(!analysis?.coordinateSpace||!Array.isArray(analysis.faces)||analysis.faces.length>budget.maximumFacesPerFrame)
          fail('The CPU detector returned invalid complete frame Evidence.');
        const faces=analysis.faces.filter(face=>{
          if(!Array.isArray(face.rectangle)||face.rectangle.length!==4||face.rectangle.some(value=>!Number.isFinite(value)))fail('The CPU detector returned invalid face coordinates.');
          return Math.min(face.rectangle[2]-face.rectangle[0],face.rectangle[3]-face.rectangle[1])>=pack.minimumFaceSize;
        }),{compositeOrdinal,...point}=batch.points[index];
        frames.push(frameEvidence({basisDigest:batch.basisDigest,frame:{...point,imageDigest:member.contentDigest},analysis:{...analysis,faces}}));
      }
      const payload=encodeBuffaloEmbeddingSet({source:sourceFor(frameArtifactSet),frames});space(payload.frameGeometry.source.frameArtifactBytes+Buffer.byteLength(canonicalJson(payload)));active();
      return {dimension:512,vectorCount:payload.vectors.length,detectedFaceCount:payload.vectors.length,vectors:payload.vectors,frameGeometry:payload.frameGeometry};
    },
    async computeClusters({faceEmbeddingSetHandle:handle,embeddingSet,clusterParameters:parameters}){
      active();if(!same(parameters,frozen.clusterParameters))fail('The clustering policy changed.');
      const restored=restoreBuffaloEmbeddingSet(embeddingSet),faces=facesFor(restored),margin=parameters.typedParameters.find(item=>item.parameter==='ambiguity_margin')?.value,
        groups=await cpu('groupFaces',faces,{threshold:parameters.distanceThreshold,ambiguityMargin:margin}),byKey=new Map(faces.map(face=>[face.frameOrdinal+':'+face.faceOrdinal,face])),
        clusters=groups.map(group=>{
          const members=group.memberKeys.map(key=>byKey.get(key)),sum=Array(512).fill(0);
          if(members.some(face=>!face))fail('The CPU grouping returned a foreign member.');
          members.forEach(face=>face.vector.forEach((value,index)=>sum[index]+=value));
          const proof={schema:'shared.buffalo-cluster-proof@1',basisDigest:batch.basisDigest,batchDigest:batch.batchDigest,
            sourceEmbeddingDigest:handle.embeddingDigest,groupDigest:canonicalDigest(group),memberFaceEvidenceDigests:members.map(face=>face.faceEvidenceDigest)};
          return {...group,vector:unit(sum),clusterProof:{...proof,proofDigest:canonicalDigest(proof)}};
        });
      validateClusters({clusters,faceEmbeddingSetHandle:handle,embeddingSet,clusterParameters:parameters});return {clusters};
    },
    configuration:()=>({faceModelRef:buffaloModelReference('western_frame_set'),clusterParameters:frozen.clusterParameters}),
  });
}
module.exports=Object.freeze({createBuffaloFrameEngine});
